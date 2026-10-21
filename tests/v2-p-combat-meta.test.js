// gameplay.death, gameplay.score, gameplay.powerup, gameplay.ability.active.
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
  schema: 'gameverse.v2.game/0.2', id: 'meta', title: 'Meta', seed: 31,
  spaces: [{ id: 'world', use: 'engine.space.test', with: { size: [30, 14, 1] }, zones: extra.zones || [] }],
  systems,
  content: { ...content, archetypes: [{ id: 'hero', kind: 'player', components: { health: { max: 100 }, body: { facing: 1 } } }, ...(content.archetypes || [])] },
  player: { archetype: 'hero', at: [2, 5, 0] },
  ...(extra.plot ? { plot: extra.plot } : {}),
});

// ---------- death ----------
const deathDoc = (d = {}, extra = {}) => base([
  { use: 'gameplay.resource', with: { pools: [{ id: 'stamina', max: 50, regen: 0 }] } },
  { use: 'gameplay.combat.health', with: { types: ['phys'], iframes: 0 } },
  { use: 'gameplay.score' },
  { use: 'gameplay.death', with: { respawn: 'checkpoint', respawnSec: 1, invulnSec: 2, lives: 4, extraLifeAt: [1000], penalty: { dropCurrency: 0.5, corpse: true, keepItems: true, loseXp: 0.25 }, gameOver: [{ do: 'set_flag', flag: 'over' }], ...d } },
], { archetypes: [{ id: 'shade', kind: 'enemy', components: { health: { max: 5 } } }, ...(extra.archetypes || [])] });

test('death: lives, respawn at the last checkpoint with invulnerability and refills, currency drop and corpse run', () => {
  const rt = make(deathDoc()), p = rt.player(), c = rt.service('combat');
  rt.state.vars['money.gold'] = 100; rt.state.vars.xp = 40;
  rt.emit('checkpoint_set', { at: [6, 5, 0] });
  rt.service('resources').spend(p, 'stamina', 30);
  rt.space().setPos(p, [12, 5, 0], rt);
  c.kill(p, { by: 'e9' });
  assert.equal(count(rt, 'player_died'), 1); assert.equal(rt.state.vars.lives, 3);
  assert.equal(rt.state.vars['money.gold'], 50); assert.equal(rt.state.vars.xp, 30);
  const corpse = Object.values(rt.state.entities).find(e => e.components.corpse);
  assert.deepEqual(corpse.at, [12, 5, 0]);
  run(rt, 61);
  assert.equal(count(rt, 'respawned'), 1);
  assert.deepEqual(p.at, [6, 5, 0]);
  assert.equal(p.components.health.dead, false); assert.equal(p.components.health.hp, 100);
  assert.ok(p.components.health.invulnerable > 1.9, 'invulnerable seconds after respawn');
  assert.equal(rt.service('resources').get(p, 'stamina'), 50, 'pools refilled');
  rt.space().setPos(p, [12, 5, 0], rt); rt.step();
  assert.equal(count(rt, 'retrieved'), 1); assert.equal(rt.state.vars['money.gold'], 100);
  // Dying again before retrieving loses the first drop.
  c.kill(p, {}); run(rt, 70); c.kill(p, {});
  assert.equal(count(rt, 'corpse_lost'), 1);
  run(rt, 70);
  rt.run([{ do: 'add_score', amount: 1200 }]); rt.step();
  assert.equal(count(rt, 'extra_life'), 1, 'extra life at 1000 points');
  assert.equal(rt.state.vars.lives, 2);
  c.kill(p, {}); run(rt, 70); c.kill(p, {});
  assert.equal(count(rt, 'game_over'), 1); assert.equal(rt.state.flags.over, true); assert.equal(rt.state.status, 'lost');
});

test('death: a hostile corpse (shade) must be defeated to retrieve; replay; bad configs', () => {
  const rt = make(deathDoc({ corpseArchetype: 'shade' })), p = rt.player(), c = rt.service('combat');
  rt.state.vars['money.ash'] = 80;
  c.kill(p, {}); run(rt, 61);
  const shade = Object.values(rt.state.entities).find(e => e.archetype === 'shade');
  assert.ok(shade); assert.equal(rt.state.vars['money.ash'], 40);
  rt.space().setPos(p, shade.at, rt); rt.step();
  assert.equal(count(rt, 'retrieved'), 0, 'touching is not enough');
  c.kill(shade, { by: 'player' });
  assert.equal(count(rt, 'retrieved'), 1); assert.equal(rt.state.vars['money.ash'], 80);
  same(() => { const r = make(deathDoc()); r.state.vars['money.gold'] = 10; r.service('combat').kill(r.player(), {}); return r; }, Array.from({ length: 90 }, () => ({})));
  const c1 = codes(deathDoc({ respawn: 'zone' })); assert.ok(c1.includes('death_zone_missing'), c1);
  assert.ok(codes(deathDoc({ extraLifeAt: [500, 100] })).includes('death_thresholds_order'));
  assert.ok(codes(deathDoc({ corpseArchetype: 'shade', penalty: { corpse: false } })).includes('death_corpse_unused'));
});

// ---------- score ----------
const scoreDoc = (s = {}) => base([
  { use: 'gameplay.combat.health', with: { types: ['phys'], iframes: 0 } },
  { use: 'gameplay.combat.status' },
  { use: 'gameplay.combat.projectile' },
  { use: 'gameplay.score', with: {
    points: [{ on: 'defeated:imp', points: 100 }, { on: 'defeated:ghost', chain: 'eat' }, { on: 'stage_clear', mult: false }],
    chains: [{ id: 'eat', on: ['defeated:ghost'], kind: 'geometric', base: 200, growth: 2, cap: 3, resetOn: ['status_applied:fright'] }, { id: 'kills', on: ['defeated:imp'], kind: 'step', divisor: 6, cap: 8, window: 1 }],
    nearMiss: { radius: 1, points: 50, of: 'projectiles', slowmoSec: 0.3, slowmo: 0.5 },
    zones: [{ zone: 'gold', mult: 3 }], timeBonus: { on: 'stage_clear', parSec: 10, perSec: 10 }, stars: [500, 2000, 5000], high: 1000, ...s,
  } },
], { statuses: [{ id: 'fright', duration: 5, mods: { 'stat.fright': 1 } }], archetypes: [{ id: 'imp', kind: 'enemy', components: { health: { max: 1 } } }, { id: 'ghost', kind: 'enemy', components: { health: { max: 1 } } }] }, { zones: [{ id: 'gold', rect: [20, 0, 30, 14] }] });

test('score: points by event, the maze eat chain 200·2^n, the shmup chain multiplier, windows and resets', () => {
  const rt = make(scoreDoc()), c = rt.service('combat');
  for (let i = 0; i < 5; i++) c.kill(rt.spawn('ghost', { at: [10, 5, 0] }), { by: 'player' });
  assert.equal(rt.state.vars.score, 200 + 400 + 800 + 1600 + 1600, 'capped at 2^3');
  rt.run([{ do: 'apply_status', who: 'player', status: 'fright' }]);
  assert.equal(count(rt, 'chain_broken'), 1);
  c.kill(rt.spawn('ghost', { at: [10, 5, 0] }), { by: 'player' });
  assert.equal(rt.state.vars.score, 4600 + 200, 'a new fright restarts the chain');
  const before = rt.state.vars.score;
  for (let i = 0; i < 6; i++) c.kill(rt.spawn('imp', { at: [10, 5, 0] }), { by: 'player' });
  assert.equal(rt.state.vars.score - before, 5 * 100 + 200, 'the sixth kill is worth ×2');
  assert.equal(rt.state.vars['score.mult.chain'], 2);
  run(rt, 61);
  assert.equal(rt.state.vars['score.chain'], 0, 'the chain window ran out');
  assert.equal(rt.state.vars['score.high'], rt.state.vars.score); assert.equal(count(rt, 'high_score'), 1);
  assert.equal(rt.state.vars.stars, 3, '5500 points clears the 5000 threshold');
});

test('score: zones multiply, time bonus, near misses, add_score with powerup multipliers', () => {
  const rt = make(scoreDoc({ high: 0 }));
  rt.run([{ do: 'teleport', at: [22, 5, 0] }]);
  rt.run([{ do: 'add_score', amount: 10, reason: 'coin' }]);
  assert.equal(rt.state.vars.score, 30, 'gold zone ×3');
  assert.equal(rt.state.events.find(e => e.name === 'scored').reason, 'coin');
  rt.state.vars['score.mult'] = 2; rt.run([{ do: 'add_score', amount: 10 }]);
  assert.equal(rt.state.vars.score, 90);
  rt.state.vars['score.mult'] = 1; rt.run([{ do: 'teleport', at: [2, 5, 0] }]);
  run(rt, 120); rt.emit('stage_clear', { points: 500 });
  assert.equal(rt.state.vars.score, 90 + 500 + Math.round((10 - 122 / 60) * 10));
  const before = rt.state.vars.score, e = rt.spawn('imp', { at: [25, 6, 0] });
  rt.service('projectiles').fire(e, { speed: 30, damage: 1, life: 2 }, { at: [12, 6.4, 0.5], dir: [-1, 0, 0] });
  run(rt, 40);
  assert.equal(count(rt, 'near_miss'), 1); assert.equal(rt.state.vars.score - before, 50);
});

test('score: a puzzle line clear scores through add_score', () => {
  const H = 24, rows = ['######....'];
  const solid = rows.flatMap((row, i) => [...row].map((ch, x) => (ch === '#' ? [x, rows.length - 1 - i, 0] : null)).filter(Boolean));
  const doc = {
    schema: 'gameverse.v2.game/0.2', id: 'well', title: 'Well', seed: 7,
    spaces: [{ id: 'well', use: 'engine.space.test', with: { size: [10, H, 1], solid } }],
    systems: [{ use: 'gameplay.falling.pieces', with: { board: { name: 'board', at: [0, 0, 0], size: [10, H], axes: [0, 1], fall: -1 }, clearFrames: 2 } }, { use: 'gameplay.score' }],
    content: { archetypes: [{ id: 'hero', components: {} }] },
  };
  const rt = make(doc);
  rt.step();
  rt.state.prim['gameplay.falling.pieces:board'].piece = { t: 0, r: 0, x: 3, y: 1, id: 99 };
  const s0 = rt.state.vars.score ?? 0;
  rt.step({ actions: { place: { r: 0, x: 6 } } });
  assert.equal(rt.state.counts.lines_cleared, 1);
  assert.ok(count(rt, 'scored') >= 1, 'falling pieces called add_score');
  assert.ok(rt.state.vars.score > 0);
  const scored = rt.state.events.filter(e => e.name === 'scored');
  assert.ok(scored.some(e => e.reason && e.reason !== 'effect'), 'the puzzle passes its reason');
  assert.equal(rt.state.vars.score - s0, scored.reduce((s, e) => s + e.amount, 0), 'the score var mirrors add_score totals');
});

test('score: deterministic replay and bad configs', () => {
  same(() => { const r = make(scoreDoc()); r.service('combat').kill(r.spawn('ghost', { at: [9, 5, 0] }), { by: 'player' }); return r; }, Array.from({ length: 70 }, () => ({})));
  const c = codes(scoreDoc({ chains: [{ id: 'a', on: ['x'] }, { id: 'a', on: [] }], points: [{ on: 'x', points: 'lots' }, { on: 'y', chain: 'zzz' }], stars: [10, 5] }));
  // Chains are a kind the card defines and the fields are typed: a repeated chain is id_duplicate, a chain without events
  // param_range (on: min 1), points that are no number param_type, an unknown chain ref_unknown (they were
  // score_chain_duplicate / score_chain_invalid / score_points_invalid / score_chain_unknown).
  for (const code of ['id_duplicate', 'param_range', 'param_type', 'ref_unknown', 'score_stars_order']) assert.ok(c.includes(code), `${code} in ${c}`);
  const eff = scoreDoc(); eff.systems.push({ use: 'gameplay.combat.boss', with: { bosses: [{ id: 'b', archetype: 'imp', phases: [{}], onDefeat: [{ do: 'add_score', points: 5 }] }] } });
  assert.ok(codes(eff).includes('effect_invalid'), 'add_score needs amount (frozen contract)');
});

// ---------- powerup ----------
const powerDoc = (extra = {}) => base([
  { use: 'gameplay.combat.health', with: { types: ['phys'], iframes: 0 } },
  { use: 'gameplay.combat.status' },
  { use: 'gameplay.combat.projectile', with: { weapons: [{ id: 'shot', preset: 'shot', unitScale: 0.05 }, { id: 'spread', preset: 'spread', unitScale: 0.05 }], playerWeapon: 'shot' } },
  { use: 'gameplay.score' },
  { use: 'gameplay.death', with: { lives: 3, respawn: 'here' } },
  { use: 'gameplay.ability.active', with: { abilities: [{ id: 'bomb', kind: 'bomb', charges: 1, cooldown: 0.5 }] } },
  { use: 'gameplay.powerup', with: { loseTierOnHit: true, powerups: [
    { id: 'magnet', kind: 'magnet', sec: 2, value: 6, radius: 5 },
    { id: 'x2', kind: 'multiplier', sec: 1, value: 2 },
    { id: 'bubble', kind: 'shield', sec: 0, radius: 3 },
    { id: 'star', kind: 'invulnerable', sec: 1 },
    { id: 'gun_shot', kind: 'weapon', weapon: 'shot', overflowPoints: 1000 },
    { id: 'gun_spread', kind: 'weapon', weapon: 'spread' },
    { id: 'slow', kind: 'slowmo', sec: 1, value: 0.65 },
    { id: 'haste', kind: 'stat', stat: 'stat.move', value: 0.5, sec: 1, stack: 'extend' },
    { id: 'hot', kind: 'status', status: 'burning', sec: 1 },
    { id: 'oneup', kind: 'life' },
    { id: 'bombs', kind: 'bomb', ability: 'bomb' },
  ] } },
], { statuses: [{ id: 'burning', duration: 3, tick: { dps: 1 } }], archetypes: [{ id: 'coin', components: { pickup: true } }, { id: 'orb', components: { powerup: 'x2' } }, { id: 'imp', kind: 'enemy', components: { health: { max: 10 } } }] });

test('powerup: timed buffs (magnet, multiplier, shield, invulnerable, slowmo, stat, status) and pickups', () => {
  const rt = make(powerDoc()), p = rt.player(), P = rt.service('powerup'), c = rt.service('combat');
  const coin = rt.spawn('coin', { at: [6, 5, 0] });
  rt.run([{ do: 'give_powerup', powerup: 'magnet' }]); run(rt, 30);
  assert.ok(coin.at[0] < 6, 'magnet pulls pickups');
  rt.spawn('orb', { at: [2.3, 5, 0] }); rt.step();
  assert.equal(count(rt, 'powerup:x2'), 1); assert.equal(rt.state.vars['score.mult'], 2);
  rt.run([{ do: 'add_score', amount: 10 }]); assert.equal(rt.state.vars.score, 20);
  run(rt, 61); assert.equal(rt.state.vars['score.mult'], 1); assert.equal(count(rt, 'powerup_end:x2'), 1);
  rt.run([{ do: 'give_powerup', powerup: 'bubble' }]);
  const imp = rt.spawn('imp', { at: [9, 5, 0] });
  assert.equal(c.hit(p, { amount: 30, by: imp.id }).reason, 'shield'); assert.equal(count(rt, 'shield_break'), 1);
  assert.equal(P.active(p, 'bubble'), false, 'the shield is used up');
  run(rt, 61);
  rt.run([{ do: 'give_powerup', powerup: 'star' }]);
  assert.equal(c.hit(p, { amount: 30, by: imp.id }).applied, false);
  rt.run([{ do: 'give_powerup', powerup: 'slow' }]); rt.step(); assert.equal(rt.state.vars['time.scale'], 0.65);
  run(rt, 61); assert.equal(rt.state.vars['time.scale'], 1);
  rt.run([{ do: 'give_powerup', powerup: 'haste' }, { do: 'give_powerup', powerup: 'haste' }]);
  assert.equal(rt.service('stats').get(p, 'stat.move'), 0.5); assert.ok(rt.state.vars['powerup.haste'] > 1.9, 'extend stacks duration');
  rt.run([{ do: 'give_powerup', powerup: 'hot' }]); assert.equal(rt.service('status').has(p, 'burning'), true);
  run(rt, 125); assert.equal(rt.service('stats').get(p, 'stat.move'), 0);
  assert.ok(rt.test({ powerup: 'haste' }) === false);
});

test('powerup: weapon tiers with overflow points and tier loss on hit; extra lives; bomb charges', () => {
  const rt = make(powerDoc()), p = rt.player();
  rt.step();
  for (let i = 0; i < 2; i++) rt.run([{ do: 'give_powerup', powerup: 'gun_shot' }]);
  assert.equal(p.components.ranged.tier, 3);
  rt.run([{ do: 'give_powerup', powerup: 'gun_shot' }]);
  assert.equal(count(rt, 'overflow'), 1); assert.equal(rt.state.vars.score, 1000);
  rt.run([{ do: 'give_powerup', powerup: 'gun_spread' }]);
  assert.deepEqual([p.components.ranged.weapon, p.components.ranged.tier], ['spread', 3], 'switching keeps the tier');
  rt.service('combat').hit(p, { amount: 5, by: rt.spawn('imp', { at: [9, 5, 0] }).id });
  assert.equal(p.components.ranged.tier, 2); assert.equal(count(rt, 'tier_lost'), 1);
  rt.run([{ do: 'give_powerup', powerup: 'oneup' }]); assert.equal(rt.state.vars.lives, 4);
  rt.run([{ do: 'give_powerup', powerup: 'bombs' }]); assert.equal(rt.service('abilities').charges(p, 'bomb'), 2);
  same(() => { const r = make(powerDoc()); r.run([{ do: 'give_powerup', powerup: 'magnet' }]); r.spawn('coin', { at: [6, 5, 0] }); return r; }, Array.from({ length: 60 }, () => ({})));
  const bad = powerDoc(); bad.systems.at(-1).with.powerups.push({ id: 'p1', kind: 'stat' }, { id: 'p2', kind: 'status' }, { id: 'p3', kind: 'weapon' }, { id: 'p4', kind: 'bomb' }, { id: 'p5', kind: 'teleport' });
  const c = codes(bad); assert.ok(c.includes('powerup_field_missing'), c); assert.ok(c.includes('param_option'), c);
});

// ---------- ability.active ----------
const abilityDoc = (abilities = null) => base([
  { use: 'gameplay.resource', with: { pools: [{ id: 'mana', max: 30, regen: 0 }] } },
  { use: 'gameplay.combat.health', with: { types: ['phys'], iframes: 0 } },
  { use: 'gameplay.combat.projectile' },
  { use: 'gameplay.ability.active', with: { abilities: abilities ?? [
    { id: 'bomb', kind: 'bomb', charges: 2, maxCharges: 3, rechargeSec: 2, cooldown: 0.5, radius: 0, damage: 8, iframes: 1.5 },
    { id: 'shield', kind: 'shield', sec: 1, cooldown: 3, cost: { resource: 'mana', amount: 20 } },
    { id: 'hyperspace', kind: 'hyperspace', cooldown: 0.2, area: [[1, 1, 0], [28, 12, 0]], safeRadius: 3, risk: 0 },
    { id: 'blink', kind: 'blink', distance: 4, cooldown: 0.1 },
  ] } },
], { archetypes: [{ id: 'imp', kind: 'enemy', components: { health: { max: 10 } } }, { id: 'boss', kind: 'boss', components: { health: { max: 1000 }, boss: { id: 'x' } } }] });

test('ability.active: bombs clear hostile shots and damage foes with i-frames; charges, cooldown, recharge', () => {
  const rt = make(abilityDoc()), p = rt.player(), proj = rt.service('projectiles');
  const imp = rt.spawn('imp', { at: [9, 5, 0] }), boss = rt.spawn('boss', { at: [15, 5, 0] });
  proj.fire(imp, { speed: 1, life: 5 }, { dir: [-1, 0, 0] }); proj.fire(p, { speed: 1, life: 5 });
  rt.step({ actions: { bomb: true } });
  assert.equal(count(rt, 'ability_used:bomb'), 1);
  assert.equal(imp.components.health.hp, 2); assert.equal(boss.components.health.hp, 1000 - 50, 'bosses take a share of max hp');
  assert.equal(Object.values(rt.state.entities).filter(e => e.components.projectile).length, 1, 'only the player’s shot survives');
  assert.ok(p.components.health.invulnerable > 1.4);
  rt.step({ actions: { bomb: true } }); assert.equal(count(rt, 'ability_used:bomb'), 1, 'cooldown');
  run(rt, 30); rt.step({ actions: { bomb: true } }); assert.equal(rt.state.vars['ability.bomb'], 0);
  run(rt, 30); rt.step({ actions: { bomb: true } }); assert.equal(count(rt, 'ability_empty'), 1);
  run(rt, 125); assert.equal(rt.state.vars['ability.bomb'], 1, 'recharged a charge');
});

test('ability.active: shield costs mana, hyperspace jumps clear of foes, blink, NPC use; replay; bad configs', () => {
  const rt = make(abilityDoc()), p = rt.player();
  rt.step({ actions: { shield: true } }); assert.ok(p.components.health.invulnerable > 0.9); assert.equal(rt.service('resources').get(p, 'mana'), 10);
  run(rt, 181); rt.step({ actions: { shield: true } }); assert.equal(count(rt, 'ability_empty'), 1, 'not enough mana');
  const imps = [[5, 5, 0], [20, 8, 0]].map(at => rt.spawn('imp', { at }));
  rt.step({ actions: { hyperspace: true } });
  assert.equal(count(rt, 'hyperspace'), 1);
  assert.ok(imps.every(i => Math.hypot(i.at[0] - p.at[0], i.at[1] - p.at[1]) >= 3), 'lands clear of foes');
  rt.space().setPos(p, [2, 5, 0], rt); rt.step({ actions: { blink: true } }); assert.deepEqual(p.at, [6, 5, 0]);
  rt.run([{ do: 'use_ability', who: imps[0].id, ability: 'blink' }]); assert.equal(count(rt, 'ability_used:blink'), 2);
  const risky = make(abilityDoc([{ id: 'hyperspace', kind: 'hyperspace', risk: 1, cooldown: 0 }]));
  risky.step({ actions: { hyperspace: true } }); assert.equal(risky.player().components.health.dead, true, 'risk 1 always fails re-entry');
  same(() => { const r = make(abilityDoc()); r.spawn('imp', { at: [5, 5, 0] }); return r; }, [{ actions: { hyperspace: true } }, {}, { actions: { bomb: true } }, { actions: { blink: true } }]);
  const c = codes(abilityDoc([{ id: 'a', kind: 'bomb', charges: 9, maxCharges: 2 }, { id: 'b', kind: 'blink', action: 'a' }, { id: 'c', kind: 'hyperspace', area: [1, 2] }]));
  // area is typed on the card (a [[min],[max]] list of points): a malformed one is the kernel's param_type at its path.
  for (const code of ['ability_charges_invalid', 'ability_action_duplicate', 'param_type']) assert.ok(c.includes(code), `${code} in ${c}`);
});
