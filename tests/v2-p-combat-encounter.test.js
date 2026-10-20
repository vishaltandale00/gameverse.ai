// gameplay.combat.boss, gameplay.combat.stealth, gameplay.element, gameplay.vision.mode.
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
const make = d => compile(d, { primitives: ALL }).rt;
const count = (rt, n) => rt.state.counts[n] ?? 0;
const same = (build, inputs) => { const a = build(), b = build(); for (const i of inputs) { a.step(i); b.step(i); } assert.deepEqual(a.snapshot(), b.snapshot()); };
const base = (systems, content = {}, extra = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'enc', title: 'Encounter', seed: 21,
  spaces: [{ id: 'world', use: 'engine.space.test', with: { size: [30, 14, 1], solid: extra.solid || [] }, zones: extra.zones || [] }],
  systems,
  content: { ...content, archetypes: [{ id: 'hero', kind: 'player', components: { health: { max: 100 }, body: { facing: 1 } } }, ...(content.archetypes || [])] },
  player: { archetype: 'hero', at: [2, 5, 0] },
});

// ---------- boss ----------
const bossDoc = (b = {}, extra = {}) => base([
  { use: 'gameplay.combat.health', with: { types: ['phys'], iframes: 0 } },
  { use: 'gameplay.combat.projectile' },
  { use: 'gameplay.combat.boss', with: { retryReset: true, bosses: [{
    id: 'ogre', archetype: 'ogre', name: 'Grum', arena: 'pit', required: true,
    phases: [{ at: 1, pattern: ['smash'], speed: 1 }, { at: 0.5, pattern: ['smash', 'roar'], speed: 1.3, summon: ['imp'], fx: [{ do: 'set_flag', flag: 'phase2' }], invulnSec: 1 }],
    cancelBullets: true, onStart: [{ do: 'set_flag', flag: 'fight' }], onDefeat: [{ do: 'set_flag', flag: 'ogre_dead' }],
    tire: { every: 2, daze: 1, touchFrac: 0.1, touchCooldown: 0.5 }, enrage: { afterSec: 4, speed: 2 }, ...b,
  }] } },
], { archetypes: [
  { id: 'ogre', kind: 'boss', name: 'Grum', components: { health: { max: 100 }, attacks: [{ id: 'smash' }, { id: 'roar' }], touch: { damage: 5 } } },
  { id: 'imp', kind: 'enemy', components: { health: { max: 5 } } },
] }, { zones: [{ id: 'pit', rect: [10, 0, 20, 10] }], ...extra });

test('boss: starts on entering the arena, phases by hp, phase invulnerability, adds, bullets cancelled, vars', () => {
  const rt = make(bossDoc()), c = rt.service('combat');
  const ogre = rt.spawn('ogre', { at: [16, 5, 0] });
  rt.run([{ do: 'teleport', at: [11, 5, 0] }]);
  assert.equal(count(rt, 'boss_start:ogre'), 1);
  assert.equal(rt.state.flags.fight, true);
  rt.step();
  assert.equal(rt.state.vars['boss.hp'], 100); assert.equal(rt.state.vars['boss.hp.max'], 100); assert.equal(rt.state.vars['boss.id'], 'ogre');
  assert.deepEqual(ogre.components.boss.pattern, ['smash']);
  rt.service('projectiles').fire(ogre, { speed: 1, life: 10 }, { dir: [-1, 0, 0] });
  c.hit(ogre, { amount: 55, by: 'player' }); rt.step();
  assert.equal(count(rt, 'boss_phase:ogre'), 1); assert.equal(rt.state.vars['boss.phase'], 1);
  assert.deepEqual(ogre.components.boss.pattern, ['smash', 'roar']); assert.equal(ogre.components.boss.speed, 1.3);
  assert.equal(rt.state.flags.phase2, true);
  assert.equal(Object.values(rt.state.entities).filter(e => e.archetype === 'imp').length, 1, 'summons adds');
  assert.equal(count(rt, 'cancelled'), 1, 'the boss side’s bullets are cancelled');
  assert.equal(c.hit(ogre, { amount: 10, by: 'player' }).reason, 'boss_invulnerable');
  run(rt, 61);
  assert.equal(c.hit(ogre, { amount: 10, by: 'player' }).applied, true);
  assert.ok(rt.test({ boss: 'ogre', state: 'active' }));
  assert.equal(rt.state.vars['bosses.remaining'], 1);
  c.kill(ogre, { by: 'player' }); rt.step();
  assert.equal(count(rt, 'boss_defeated:ogre'), 1);
  assert.equal(rt.state.flags.ogre_dead, true); assert.equal(rt.state.flags.boss_ogre_defeated, true);
  assert.equal(rt.state.vars['bosses.remaining'], 0);
  assert.ok(rt.test({ boss: 'ogre', state: 'defeated' }));
});

test('boss: arena lock, tiring and dazed stomps, enrage, retry reset, time limit', () => {
  const rt = make(bossDoc()), p = rt.player(), ogre = rt.spawn('ogre', { at: [16, 5, 0] });
  rt.run([{ do: 'teleport', at: [11, 5, 0] }]); rt.step();
  rt.space().setPos(p, [5, 5, 0], rt);
  assert.deepEqual(p.at, [11, 5, 0], 'leaving the arena mid-fight is blocked');
  run(rt, 125);
  assert.equal(count(rt, 'boss_dazed'), 1);
  assert.ok(ogre.components.boss.dazed && ogre.components.health.stun > 0);
  const hpBefore = p.components.health.hp;
  rt.space().setPos(p, [16.5, 5, 0], rt); rt.step();
  assert.equal(count(rt, 'boss_hit'), 1, 'touching a dazed boss hurts it');
  assert.equal(ogre.components.health.hp, 90);
  assert.equal(p.components.health.hp, hpBefore, 'a dazed boss is harmless');
  rt.space().setPos(p, [11, 5, 0], rt);
  run(rt, 120);
  assert.equal(count(rt, 'boss_enraged'), 1); assert.equal(ogre.components.boss.speed, 2);
  rt.service('combat').kill(p, {});
  assert.equal(count(rt, 'boss_reset:ogre'), 1);
  assert.equal(ogre.components.health.hp, 100);
  const t = make(bossDoc({ timeLimit: 1, onTimeout: [{ do: 'set_flag', flag: 'escaped' }] }));
  t.spawn('ogre', { at: [16, 5, 0] }); t.run([{ do: 'start_boss', boss: 'ogre' }]); run(t, 61);
  assert.equal(t.state.counts['boss_escaped:ogre'], 1); assert.equal(t.state.flags.escaped, true);
  same(() => { const r = make(bossDoc()); r.spawn('ogre', { at: [16, 5, 0] }); r.run([{ do: 'start_boss', boss: 'ogre' }]); return r; }, Array.from({ length: 200 }, () => ({})));
});

test('boss: bad configs', () => {
  const d = bossDoc({ phases: [{ at: 0.5, pattern: ['smash'] }, { at: 0.9, pattern: ['laser'] }] });
  const c = codes(d);
  assert.ok(c.includes('boss_phase_order'), c); assert.ok(c.includes('boss_pattern_unknown'), c);
  const e = bossDoc({ archetype: 'imp' }); e.content.archetypes.find(a => a.id === 'imp').components = {};
  assert.ok(codes(e).includes('boss_health_missing'));
  assert.ok(codes(bossDoc({ arena: 'nowhere' })).includes('ref_unknown'));
});

// ---------- stealth ----------
const stealthDoc = (cfg = {}) => base([
  { use: 'gameplay.combat.health', with: { types: ['phys'] } },
  { use: 'gameplay.combat.stealth', with: { sightRange: 10, fov: 90, fillRate: 1.5, decayRate: 1, takedownRange: 1.5, ...cfg } },
], { archetypes: [{ id: 'guard', kind: 'enemy', components: { health: { max: 30 }, stealth: {}, body: { facing: -1 } } }] }, { solid: [[20, 5, 0]] });

test('stealth: watchers fill toward detection, crouching slows it, losing sight decays it, noise alerts', () => {
  const rt = make(stealthDoc()), p = rt.player();
  rt.spawn('guard', { at: [8, 5, 0] });
  run(rt, 30);
  assert.ok(rt.state.vars['stealth.alert'] > 0.3); assert.equal(count(rt, 'suspicious'), 1);
  run(rt, 40);
  assert.equal(count(rt, 'detected:guard'), 1); assert.ok(rt.test({ detected: 'any' })); assert.ok(rt.test({ detected: 'guard' }));
  rt.space().setPos(p, [12, 5, 0], rt); // behind the guard
  run(rt, 70);
  assert.equal(count(rt, 'lost_target'), 1);
  const c = make(stealthDoc()); c.spawn('guard', { at: [8, 5, 0] }); run(c, 30, { held: { crouch: true } });
  assert.ok(c.state.vars['stealth.alert'] < rt.state.vars['stealth.alert'] + 1 && c.state.vars['stealth.alert'] < 0.3, 'crouching halves visibility');
  const n = make(stealthDoc()), ng = n.spawn('guard', { at: [8, 5, 0] }); n.space().setPos(n.player(), [12, 5, 0], n);
  n.emit('fired', { who: 'player' }); n.step();
  assert.equal(n.state.counts.noise_heard, 1); assert.ok(n.service('stealth').meter(ng) >= 0.5);
});

test('stealth: takedowns from behind on unaware watchers; replay; bad config', () => {
  const rt = make(stealthDoc()), g = rt.spawn('guard', { at: [8, 5, 0] });
  rt.space().setPos(rt.player(), [9, 5, 0], rt); // behind the guard (it faces -x)
  rt.step({ actions: { takedown: true } });
  assert.equal(count(rt, 'takedown'), 1); assert.equal(g.components.health.dead, true);
  same(() => { const r = make(stealthDoc()); r.spawn('guard', { at: [8, 5, 0] }); return r; }, Array.from({ length: 90 }, (_, i) => ({ held: { crouch: i % 2 === 0 } })));
  assert.ok(codes(stealthDoc({ noise: [{ event: 'fired' }, { event: 'fired' }] })).includes('stealth_noise_duplicate'));
});

// ---------- element ----------
const elementDoc = () => base([
  { use: 'gameplay.combat.health', with: { types: ['phys', 'fire'], iframes: 0 } },
  { use: 'gameplay.combat.status' },
  { use: 'gameplay.element', with: { reactions: [
    { a: 'fire', b: 'grass', result: [{ do: 'ignite', at: 'target', r: 2 }], spread: 0.5 },
    { a: 'fire', b: 'ice', result: [{ do: 'apply_status', who: 'target', status: 'melting' }] },
    { a: 'water', b: 'fire', result: [{ do: 'clear_status', who: 'target', status: 'burning' }] },
  ], burn: { sec: 2, tickSec: 0.5, damage: 4, type: 'fire', element: 'fire', into: 'ash' } } },
], {
  blocks: [{ id: 'turf', name: 'Turf', tags: ['grass'] }, { id: 'ash', name: 'Ash' }],
  statuses: [{ id: 'burning', duration: 5, tick: { dps: 1, type: 'fire' }, tags: ['fire'] }, { id: 'soaked', duration: 2, tags: ['water'] }, { id: 'melting', duration: 2 }],
  archetypes: [{ id: 'bush', components: { health: { max: 10 }, tags: ['grass'] } }, { id: 'yeti', kind: 'enemy', components: { health: { max: 40 }, element: 'ice' } }],
});

test('element: typed hits react with tags, fire spreads over grass cells and burns out, water puts out burning', () => {
  const rt = make(elementDoc()), space = rt.space(), c = rt.service('combat');
  for (let x = 4; x <= 12; x++) space.setCell([x, 4, 0], 'turf', rt);
  const bush = rt.spawn('bush', { at: [5, 5, 0] }), yeti = rt.spawn('yeti', { at: [20, 5, 0] });
  c.hit(yeti, { amount: 2, type: 'fire', by: 'player' });
  assert.equal(count(rt, 'reaction:fire_ice'), 1); assert.ok(rt.service('status').has(yeti, 'melting'));
  c.hit(bush, { amount: 1, type: 'fire', by: 'player' });
  assert.equal(count(rt, 'reaction:fire_grass'), 1);
  assert.ok(count(rt, 'ignited') >= 2, 'grass cells around the bush ignite');
  run(rt, 200);
  console.log('DBG', count(rt, 'ignited'), count(rt, 'burned_out'), rt.service('element').burning()); assert.ok(count(rt, 'ignited') > 5, 'fire spreads to neighbouring grass');
  assert.ok(count(rt, 'burned_out') >= 3); assert.equal(space.getCell([5, 4, 0]), 'ash');
  rt.service('status').apply(yeti, 'burning'); rt.service('status').apply(yeti, 'soaked');
  assert.equal(count(rt, 'reaction:water_fire'), 1); assert.equal(rt.service('status').has(yeti, 'burning'), false);
  assert.ok(rt.test({ element: 'ice', who: yeti.id }));
});

test('element: deterministic replay and bad configs', () => {
  same(() => { const r = make(elementDoc()); for (let x = 4; x <= 12; x++) r.space().setCell([x, 4, 0], 'turf', r); r.run([{ do: 'ignite', at: [5, 4, 0], r: 1 }]); return r; }, Array.from({ length: 150 }, () => ({})));
  const d = elementDoc(); d.systems[2].with.reactions.push({ a: 'fire', b: 'grass' }, { a: 'mud', b: 'mud' });
  const c = codes(d); assert.ok(c.includes('element_reaction_duplicate'), c); assert.ok(c.includes('element_reaction_invalid'), c);
});

// ---------- vision.mode ----------
const visionDoc = (cfg = {}) => base([
  { use: 'gameplay.resource', with: { pools: [{ id: 'focus', max: 10, regen: 0 }] } },
  { use: 'gameplay.vision.mode', with: { range: 10, tags: ['clue', 'trace'], cooldown: 1, ...cfg } },
], { archetypes: [{ id: 'footprint', components: { tags: ['trace'] } }, { id: 'letter', components: { clue: true } }, { id: 'rock', components: {} }] });

test('vision.mode: reveals and records tagged entities in range, cooldown, duration and resource drain', () => {
  const rt = make(visionDoc()), near = rt.spawn('footprint', { at: [6, 5, 0] }), letter = rt.spawn('letter', { at: [4, 5, 0] });
  rt.spawn('footprint', { at: [25, 5, 0] }); rt.spawn('rock', { at: [3, 5, 0] });
  rt.step({ actions: { sense: true } });
  assert.equal(rt.state.vars['vision.active'], 1);
  assert.deepEqual(rt.service('vision').revealed(), [near.id, letter.id].sort());
  assert.equal(count(rt, 'scanned:footprint'), 1); assert.equal(count(rt, 'scanned:letter'), 1);
  assert.ok(rt.test({ scanned: 'trace' })); assert.ok(rt.test({ scanned: near.id }));
  rt.step({ actions: { sense: true } }); rt.step({ actions: { sense: true } });
  assert.equal(rt.state.vars['vision.active'], 0, 'cooldown blocks an immediate re-toggle');
  const d = make(visionDoc({ drain: { resource: 'focus', perSec: 5 } })); d.step({ actions: { sense: true } }); run(d, 130);
  assert.equal(d.state.counts.vision_off, 1, 'ends when focus runs out');
  const s = make(visionDoc({ sec: 1, cooldown: 0 })); s.step({ actions: { sense: true } }); run(s, 61);
  assert.equal(s.state.vars['vision.active'], 0);
  same(() => { const r = make(visionDoc()); r.spawn('footprint', { at: [6, 5, 0] }); return r; }, [{ actions: { sense: true } }, {}, {}, { actions: { sense: true } }]);
  assert.ok(codes(visionDoc({ tags: ['a', 'a'] })).includes('vision_tags_duplicate'));
  assert.ok(codes(visionDoc({ range: 1 })).includes('param_range'));
});
