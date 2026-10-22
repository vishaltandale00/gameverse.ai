// gameplay.resource, gameplay.combat.health, gameplay.combat.status.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, run, testSpace } from '../v2/kernel/testing.js';
import { PRIMITIVES } from '../v2/primitives/index.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import { preflight } from '../v2/kernel/document.js';

const ALL = [...PRIMITIVES, testSpace];
const reg = new Registry(ALL), lg = buildLogic(reg, Logic);
const codes = d => preflight(d, reg, lg).errors.map(e => e.code);
const base = (systems, content = {}, extra = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'core', title: 'Core', seed: 11,
  spaces: [{ id: 'arena', use: 'engine.space.test', with: { size: [24, 12, 1] }, zones: extra.zones || [] }],
  systems,
  content: { ...content, archetypes: [{ id: 'hero', kind: 'player', components: { health: { max: 100 }, body: { facing: 1 } } }, ...(content.archetypes || [])] },
  player: { archetype: 'hero', at: [2, 1, 0], ...(extra.player || {}) },
});
const make = d => compile(d, { primitives: ALL }).rt;
const same = (build, inputs) => { const a = build(), b = build(); for (const i of inputs) { a.step(i); b.step(i); } assert.deepEqual(a.snapshot(), b.snapshot()); return a; };

// ---------- gameplay.resource ----------
const resDoc = () => base([
  { use: 'gameplay.resource', with: { pools: [
    { id: 'stamina', max: 100, regen: 30, regenDelay: 0.5, exhaustLock: true, unlockAt: 0.5, drainTags: ['sprint', 'attack'], onDepleted: [{ do: 'set_flag', flag: 'winded' }] },
    { id: 'oxygen', max: 10, regen: 2, drains: [{ when: { flag: 'underwater' }, rate: 5 }], onDepleted: [{ do: 'damage', who: 'self', amount: 5, type: 'void' }] },
    { id: 'hunger', max: 50, regen: -1, player: true },
  ] } },
  { use: 'gameplay.combat.health', with: { types: ['phys', 'void'], iframes: 0 } },
], { archetypes: [{ id: 'wolf', kind: 'enemy', components: { health: { max: 30 }, resources: { stamina: { max: 40 } } } }] });

test('resource: pools publish vars, spend by tag, regen after a delay, lock out when exhausted', () => {
  const rt = make(resDoc()), p = rt.player(), r = rt.service('resources');
  rt.step();
  assert.equal(rt.state.vars['res.stamina'], 100);
  assert.equal(rt.state.vars['res.stamina.max'], 100);
  assert.equal(r.spend(p, 'attack', 60), true);
  rt.step();
  assert.equal(rt.state.vars['res.stamina'], 40, 'regen waits for regenDelay');
  r.spend(p, 'sprint', 60);
  assert.equal(r.get(p, 'stamina'), 0);
  assert.equal(rt.state.flags.winded, true, 'onDepleted ran');
  assert.equal(rt.state.counts['depleted:stamina'], 1);
  assert.equal(r.spend(p, 'attack', 5), false, 'locked while exhausted');
  run(rt, 30 + 105);
  assert.ok(r.get(p, 'stamina') >= 50 && !r.locked(p, 'stamina'), 'unlocks after refilling to unlockAt');
  run(rt, 200);
  assert.equal(rt.state.counts['restored:stamina'], 1);
  assert.ok(rt.state.vars['res.hunger'] < 50, 'negative regen drains');
});

test('resource: predicate drains, NPC pools, effects and the resource predicate', () => {
  const rt = make(resDoc()), p = rt.player();
  const wolf = rt.spawn('wolf', { at: [8, 1, 0] });
  rt.run([{ do: 'set_flag', flag: 'underwater' }]);
  run(rt, 60 * 4);
  assert.equal(rt.state.counts['depleted:oxygen'], 1);
  assert.equal(p.components.health.hp, 95, 'drowning damage from onDepleted');
  assert.equal(rt.service('resources').max(wolf, 'stamina'), 40, 'archetype override');
  assert.equal(rt.service('resources').has(wolf, 'oxygen'), false, 'NPCs carry only listed pools');
  rt.run([{ do: 'spend', resource: 'stamina', amount: 30, who: wolf.id }]);
  assert.equal(rt.service('resources').get(wolf, 'stamina'), 10);
  assert.ok(rt.test({ resource: 'stamina', who: wolf.id, lt: 11 }));
  assert.ok(rt.test({ resource: 'stamina', frac: true, gte: 0.99 }));
  rt.run([{ do: 'set_max', resource: 'stamina', value: 150 }, { do: 'refill', resource: 'stamina' }]);
  assert.equal(rt.service('resources').get(p, 'stamina'), 150);
});

test('resource: deterministic replay and bad configs', () => {
  same(() => make(resDoc()), Array.from({ length: 90 }, (_, i) => ({ actions: {} })));
  const bad = resDoc(); bad.systems[0].with.pools.push({ id: 'stamina', max: 5 }, { id: 'mana', max: 5, start: 10 });
  const c = codes(bad);
  assert.ok(c.includes('id_duplicate'), c); // pools define the kind 'pool': a repeated id is the kernel's id_duplicate (was resource_duplicate)
  assert.ok(c.includes('resource_start_invalid'), c);
  const missing = resDoc(); missing.systems[0].with.pools.push({ max: 3 });
  assert.ok(codes(missing).includes('param_missing'));
});

// ---------- gameplay.combat.health ----------
const healthDoc = (h = {}) => base([
  { use: 'gameplay.combat.health', with: { types: ['phys', 'fire', 'ice'], iframes: 0.5, knockback: 1, regenDelay: 1, impactDamage: { enabled: true, events: ['impact'], minSpeed: 5, perSpeed: 2, type: 'phys' }, ...h } },
  { use: 'gameplay.combat.status' },
], {
  statuses: [{ id: 'exposed', duration: 5, mods: { 'stat.vulnerable': 1, 'hp.max': -20 } }],
  archetypes: [
    { id: 'golem', kind: 'enemy', components: { health: { max: 50, armor: { phys: 2 }, regen: 6 }, resist: { fire: 0.5, ice: -0.5 } } },
    { id: 'ghost', kind: 'enemy', components: { health: { max: 10, respawn: { mode: 'home', sec: 2 } }, touch: { damage: 7, type: 'phys' } } },
    { id: 'rock', kind: 'enemy', components: { health: { max: 4, splitOnDeath: { into: 'pebble', count: 2, spread: 90 } }, body: { vel: [3, 0, 0] } } },
    { id: 'pebble', kind: 'enemy', components: { health: { max: 1 } } },
    { id: 'shade', kind: 'enemy', components: { health: { max: 5, respawn: { mode: 'spawn' } } } },
  ],
});

test('health: resistances, armor, weakness, i-frames, stats, knockback and typed events', () => {
  const rt = make(healthDoc()), g = rt.spawn('golem', { at: [6, 1, 0] }), c = rt.service('combat');
  assert.equal(c.hit(g, { amount: 10, type: 'fire', by: 'player' }).damage, 5, 'fire 10 × (1-0.5); armor is phys only');
  assert.equal(c.hit(g, { amount: 10, type: 'fire', by: 'player' }).reason, 'iframes');
  run(rt, 31);
  assert.equal(c.hit(g, { amount: 10, type: 'ice', by: 'player' }).damage, 15, 'weakness: 10 × 1.5');
  run(rt, 31);
  rt.run([{ do: 'apply_status', who: g.id, status: 'exposed' }]);
  assert.equal(c.maxHp(g), 30, 'hp.max modifier');
  assert.equal(c.hit(g, { amount: 10, type: 'phys', by: 'player' }).damage, 13, 'stat.vulnerable +50%');
  assert.equal(rt.state.counts['damaged:golem'], 3);
  assert.ok(g.components.health.push, 'knockback push queued');
  const x0 = g.at[0]; run(rt, 10);
  assert.ok(g.at[0] > x0, 'pushed away from the attacker');
  assert.equal(c.hit(g, { amount: 5, by: g.id }).reason, 'friendly', 'self/team damage is ignored');
});

test('health: regen after delay, impact damage, contact damage, death rules (home, spawn, split, despawn)', () => {
  const rt = make(healthDoc()), c = rt.service('combat'), p = rt.player();
  const g = rt.spawn('golem', { at: [6, 1, 0] });
  c.hit(g, { amount: 22, type: 'phys', by: 'player' });
  run(rt, 30); assert.equal(g.components.health.hp, 30, 'no regen during regenDelay');
  run(rt, 60); assert.ok(g.components.health.hp > 30, 'regen resumes');
  rt.emit('impact', { who: 'player', speed: 9 });
  assert.equal(p.components.health.hp, 92, '(9-5)×2 impact damage');
  assert.equal(rt.state.vars.hp, 92);
  const ghost = rt.spawn('ghost', { at: [2, 1, 0] });
  rt.step();
  assert.equal(rt.state.counts['damaged:hero'] >= 1, true, 'touch damage hits the overlapping player');
  rt.space().setPos(ghost, [10, 1, 0], rt);
  c.kill(ghost, { by: 'player' });
  assert.equal(ghost.components.health.state, 'returning');
  assert.deepEqual(ghost.components.moveTo.at, [2, 1, 0], 'walks home via move_to');
  assert.equal(c.hit(ghost, { amount: 1, by: 'player' }).reason, 'intangible');
  run(rt, 125);
  assert.equal(ghost.components.health.dead, false);
  assert.equal(rt.state.counts['revived:ghost'], 1);
  const rock = rt.spawn('rock', { at: [12, 4, 0] });
  c.kill(rock, { by: 'player' });
  assert.equal(rt.state.counts.split, 1);
  assert.equal(rt.query('health').filter(e => e.archetype === 'pebble').length, 2);
  rt.step();
  assert.equal(rt.entity(rock.id), undefined, 'non-corpse dead NPCs despawn');
  const shade = rt.spawn('shade', { at: [15, 1, 0] });
  c.kill(shade, { by: 'player' });
  assert.equal(rt.state.counts['defeated:shade'], 1);
  run(rt, 181);
  assert.equal(shade.components.health.dead, false, 'respawn: spawn revives after sec');
});

test('health: effects, predicates, player death ends the game without gameplay.death', () => {
  const rt = make(healthDoc()), p = rt.player();
  rt.run([{ do: 'damage', who: 'player', amount: 40, type: 'fire' }]);
  assert.ok(rt.test({ health: 'player', lt: 61 }));
  assert.ok(rt.test({ health: 'player', frac: true, lte: 0.6 }));
  rt.run([{ do: 'heal', who: 'player', amount: 15 }]);
  assert.equal(p.components.health.hp, 75);
  assert.equal(p.components.health.dead, false);
  rt.run([{ do: 'kill', who: 'player' }]);
  assert.equal(rt.state.status, 'lost');
  assert.equal(rt.state.counts['died:hero'], 1);
  assert.equal(rt.state.counts.defeated ?? 0, 0, 'the player is not "defeated"');
});

test('health: deterministic replay and bad configs', () => {
  same(() => { const rt = make(healthDoc()); rt.spawn('ghost', { at: [3, 1, 0] }); rt.spawn('golem', { at: [6, 1, 0] }); return rt; }, Array.from({ length: 120 }, () => ({})));
  const bad = healthDoc({ types: ['phys', 'phys'] });
  bad.content.archetypes.push({ id: 'blob', components: { health: { max: -3, respawn: 'teleport', splitOnDeath: { into: 'nope' } }, resist: { acid: 1 } } });
  const c = codes(bad);
  for (const code of ['health_types_invalid', 'health_type_unknown']) assert.ok(c.includes(code), `${code} in ${c}`);
  // max, respawn and splitOnDeath.into are checked by the health component's declared shape (card.components), reported
  // as section-shape findings.
  const r = preflight(bad, reg, lg), at = [...r.errors, ...r.warnings].map(e => `${e.code}@${e.path}`), blob = 'content.archetypes[' + (bad.content.archetypes.length - 1) + '].components.health';
  for (const x of [`param_range@${blob}.max`, `param_type@${blob}.respawn`, `ref_unknown@${blob}.splitOnDeath.into`]) assert.ok(at.includes(x), `${x} in ${at}`);
  assert.ok(codes(healthDoc({ iframes: 99 })).includes('param_range'));
});

// ---------- gameplay.combat.status ----------
const statusDoc = () => base([
  { use: 'gameplay.resource', with: { pools: [{ id: 'mana', max: 50, regen: 0 }] } },
  { use: 'gameplay.combat.health', with: { types: ['phys', 'fire', 'poison'], iframes: 0 } },
  { use: 'gameplay.combat.status', with: { tickSec: 1 } },
], {
  statuses: [
    { id: 'poison', duration: 3, tick: { dps: 2, type: 'poison' }, stacks: 3, refresh: 'reset', tags: ['toxin'] },
    { id: 'burning', duration: 2, tick: { dps: 5, type: 'fire' }, tags: ['fire'], onEnd: [{ do: 'set_flag', flag: 'burnt_out' }] },
    { id: 'stunned', duration: 1, mods: { 'stat.stun': 1 } },
    { id: 'aegis', duration: 10, shield: { hits: 2 } },
    { id: 'ward', duration: 10, shield: { amount: 15 } },
    { id: 'ghostly', duration: 2, mods: { 'stat.invulnerable': 1 } },
    { id: 'drain', duration: 2, mods: { 'res.mana': -10 } },
    { id: 'hasted', duration: 5, mods: { 'stat.move': 0.25 } },
  ],
  archetypes: [{ id: 'bug', kind: 'enemy', components: { health: { max: 40 }, immune: ['toxin'] } }],
});

test('status: stacks, ticks, refresh, onEnd, stun, invulnerability, shields, resource drains, stats service', () => {
  const rt = make(statusDoc()), p = rt.player(), s = rt.service('status');
  rt.run([{ do: 'apply_status', status: 'poison' }, { do: 'apply_status', status: 'poison' }]);
  assert.equal(s.stacks(p, 'poison'), 2);
  assert.ok(rt.test({ status: 'poison', gte: 2 }));
  run(rt, 60);
  assert.equal(p.components.health.hp, 96, '2 dps × 2 stacks for one second');
  rt.run([{ do: 'apply_status', status: 'burning' }]);
  run(rt, 121);
  assert.equal(rt.state.flags.burnt_out, true);
  assert.equal(rt.state.counts['status_ended:burning'], 1);
  rt.run([{ do: 'apply_status', status: 'stunned' }]);
  rt.step();
  assert.ok(p.components.health.stun > 0, 'stun keeps health.stun up');
  rt.run([{ do: 'apply_status', status: 'aegis' }]);
  const c = rt.service('combat'), hp = p.components.health.hp;
  c.hit(p, { amount: 30 }); c.hit(p, { amount: 30 });
  assert.equal(p.components.health.hp, hp, 'two hits absorbed');
  assert.equal(s.has(p, 'aegis'), false, 'shield breaks after its hits');
  rt.run([{ do: 'apply_status', status: 'ward' }]);
  c.hit(p, { amount: 20 });
  assert.equal(p.components.health.hp, hp - 5, 'amount shield absorbs 15 of 20');
  rt.run([{ do: 'apply_status', status: 'ghostly' }]);
  assert.equal(c.hit(p, { amount: 20 }).reason, 'invulnerable');
  rt.service('resources').refill(p);
  rt.run([{ do: 'apply_status', status: 'drain' }]);
  run(rt, 60);
  assert.ok(Math.abs(rt.service('resources').get(p, 'mana') - 40) < 0.01, 'res.<pool> drains per second');
  rt.run([{ do: 'apply_status', status: 'hasted' }]);
  assert.equal(rt.service('stats').get(p, 'stat.move'), 0.25);
  assert.deepEqual(s.list(p).map(x => x.id).sort(), ['drain', 'ghostly', 'hasted', 'poison'].sort().filter(id => s.has(p, id)));
  rt.run([{ do: 'clear_status', tag: 'toxin' }]);
  assert.equal(s.has(p, 'poison'), false);
});

test('status: immunity, archetype-wide application, deaths clear statuses', () => {
  const rt = make(statusDoc());
  const a = rt.spawn('bug', { at: [6, 1, 0] }), b = rt.spawn('bug', { at: [8, 1, 0] });
  rt.run([{ do: 'apply_status', archetype: 'bug', status: 'poison' }]);
  assert.equal(rt.state.counts.status_resisted, 2);
  rt.run([{ do: 'apply_status', archetype: 'bug', status: 'burning' }]);
  assert.ok(rt.service('status').has(a, 'burning') && rt.service('status').has(b, 'burning'));
  rt.service('combat').kill(a, { by: 'player' });
  rt.step();
  assert.equal(rt.state.counts['status_ended:burning'] >= 1, true);
});

test('status: deterministic replay and bad configs', () => {
  same(() => { const rt = make(statusDoc()); rt.run([{ do: 'apply_status', status: 'poison', stacks: 3 }, { do: 'apply_status', status: 'drain' }]); return rt; }, Array.from({ length: 200 }, () => ({})));
  const bad = statusDoc();
  bad.content.statuses.push({ id: 'broken', duration: 0, stacks: 0.5, refresh: 'sometimes', tick: { dps: 'x', type: 'acid' }, mods: { 'stat.x': 'big' } });
  const c = codes(bad);
  assert.ok(c.includes('status_type_unknown'), `status_type_unknown in ${c}`);
  // duration, stacks, refresh, tick.dps and mods are content.statuses' declared shape (card.data), reported at their
  // paths where status_*_invalid were.
  const r = preflight(bad, reg, lg), at = [...r.errors, ...r.warnings].map(e => `${e.code}@${e.path}`), st = `content.statuses[${bad.content.statuses.length - 1}]`;
  for (const x of [`param_range@${st}.duration`, `param_type@${st}.stacks`, `param_option@${st}.refresh`, `param_type@${st}.tick.dps`, `param_type@${st}.mods.stat.x`]) assert.ok(at.includes(x), `${x} in ${at}`);
  const ref = statusDoc(); ref.systems.push({ use: 'gameplay.combat.melee', with: { moves: [] } });
  ref.content.statuses[0].onEnd = [{ do: 'apply_status', status: 'nope' }];
  assert.ok(codes(ref).includes('ref_unknown'));
});
