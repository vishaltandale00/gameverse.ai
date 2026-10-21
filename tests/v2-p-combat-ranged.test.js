// gameplay.combat.projectile, gameplay.combat.target, gameplay.combat.cover, gameplay.combat.aim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, run, testSpace } from '../v2/kernel/testing.js';
import { PRIMITIVES } from '../v2/primitives/index.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import { preflight } from '../v2/kernel/document.js';
import { WEAPON_DPS } from '../v2/primitives/gameplay/combat-projectile.js';

const ALL = [...PRIMITIVES, testSpace];
const reg = new Registry(ALL), lg = buildLogic(reg, Logic);
const codes = d => preflight(d, reg, lg).errors.map(e => e.code);
const make = d => compile(d, { primitives: ALL }).rt;
const count = (rt, n) => rt.state.counts[n] ?? 0;
const same = (build, inputs) => { const a = build(), b = build(); for (const i of inputs) { a.step(i); b.step(i); } assert.deepEqual(a.snapshot(), b.snapshot()); };
const shots = rt => Object.values(rt.state.entities).filter(e => e.components.projectile);

const rangedDoc = (proj = {}, extra = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'ranged', title: 'Ranged', seed: 13,
  spaces: [{ id: 'field', use: 'engine.space.test', with: { size: [30, 14, 1], solid: extra.solid || [] } }],
  systems: [
    { use: 'gameplay.inventory', with: { start: [{ item: 'arrow', count: 2 }] } },
    { use: 'gameplay.combat.health', with: { types: ['phys', 'fire'], iframes: 0 } },
    { use: 'gameplay.combat.status' },
    { use: 'gameplay.combat.projectile', with: { maxLive: 40, playerWeapon: 'blaster', weapons: [
      { id: 'blaster', speed: 12, damage: 5, rate: 4, radius: 0.2, life: 3 },
      { id: 'shot', preset: 'shot', unitScale: 0.02, maxTier: 3 },
      { id: 'spread', preset: 'spread', unitScale: 0.02 },
      { id: 'laser', preset: 'laser', unitScale: 0.02 },
      { id: 'homing', preset: 'homing', unitScale: 0.02 },
      { id: 'ring', pattern: 'ring', count: 8, speed: 6, damage: 1 },
      { id: 'bomb', speed: 0, damage: 3, life: 3, blast: { shape: 'plus', range: 3, fuse: 1, breaks: ['crate'], stunSec: 0 }, ammo: { from: 'start', count: 1 } },
      { id: 'zapper', speed: 20, damage: 2, ammo: { from: 'event', count: 2, events: ['power'] }, status: 'shocked' },
      ...(proj.weapons || []),
    ], ...(proj.with || {}) } },
    ...(extra.systems || []),
  ],
  content: {
    items: [{ id: 'arrow', name: 'Arrow', kind: 'ammo' }, { id: 'bow', name: 'Bow', kind: 'weapon', weapon: { damage: 10, type: 'phys' }, ranged: { projectile: 'arrow_shot', speed: 20, gravity: 9.8, spread: 0, ammo: 'arrow', draw: 0.5 } }],
    statuses: [{ id: 'shocked', duration: 1, mods: { 'stat.stun': 1 } }],
    archetypes: [
      { id: 'hero', kind: 'player', components: { health: { max: 100 }, body: { facing: 1 } } },
      { id: 'drone', kind: 'enemy', components: { health: { max: 50 } } },
      { id: 'arrow_shot', kind: 'projectile', components: {} },
      ...(extra.archetypes || []),
    ],
  },
  player: { archetype: 'hero', at: [2, 5, 0] },
});
const fire = (rt, n = 1) => { rt.step({ actions: { fire: true } }); run(rt, n - 1); };

test('projectile: shots fly, hit hostiles through the combat service, respect fire rate and stop at walls', () => {
  const rt = make(rangedDoc({}, { solid: [[20, 5, 0]] })), drone = rt.spawn('drone', { at: [8, 5, 0] });
  fire(rt, 2); fire(rt, 2);
  assert.equal(count(rt, 'fired'), 1, 'cooldown: 4 volleys/s');
  run(rt, 40);
  assert.equal(drone.components.health.hp, 45);
  assert.equal(count(rt, 'projectile_hit'), 1);
  rt.despawn(drone.id);
  fire(rt, 100);
  assert.equal(shots(rt).length, 0, 'the second shot stopped at the solid cell');
  assert.equal(count(rt, 'projectile_hit'), 2);
});

test('projectile: shmup presets match WEAPON_DPS per volley; tiers, lanes, spread, pierce, homing, ring', () => {
  const rt = make(rangedDoc()), P = rt.service('projectiles'), p = rt.player();
  for (const kind of ['shot', 'spread', 'homing']) for (const t of [1, 2, 3]) assert.ok(Math.abs(P.volleyDamage(kind, t) - WEAPON_DPS[kind][t - 1]) < 1e-9, `${kind} tier ${t}`);
  P.setTier(p, 'shot', 3); assert.equal(P.fire(p, P.weapon('shot', 3)).length, 3, 'three lanes at tier 3');
  assert.equal(P.fire(p, P.weapon('spread', 2)).length, 5);
  for (const s of shots(rt)) rt.despawn(s.id);
  // Pierce: a laser passes through a line of drones.
  const line = [6, 8, 10].map(x => rt.spawn('drone', { at: [x, 5, 0] }));
  P.fire(p, P.weapon('laser', 1));
  run(rt, 40);
  assert.ok(line.every(d => d.components.health.hp < 50), 'laser pierces');
  // Homing: a missile curves up to an off-axis target.
  const high = rt.spawn('drone', { at: [12, 11, 0] });
  for (const d of line) rt.despawn(d.id);
  const [m] = P.fire(p, { speed: 6, damage: 4, life: 5, homing: { turn: 270, range: 40 } });
  run(rt, 150);
  assert.ok(high.components.health.hp < 50, 'the missile homed in');
  assert.equal(rt.entity(m), undefined);
  assert.equal(P.fire(p, P.weapon('ring')).length, 8, 'ring volley');
});

test('projectile: gravity arcs, drawn bows with item ammo, bombs blast in a plus and break crates', () => {
  const rt = make(rangedDoc({ with: { playerWeapon: 'bow' } }, { solid: [[2, 3, 0]] })), p = rt.player();
  // Bow: hold fire to draw; release fires an arrow that consumes inventory ammo and falls.
  rt.step({ actions: { fire: true }, held: { fire: true } }); run(rt, 20, { held: { fire: true } }); rt.step({});
  assert.equal(count(rt, 'fired'), 1);
  assert.equal(rt.state.prim['gameplay.inventory'].player.arrow, 1);
  const arrow = shots(rt)[0]; assert.equal(arrow.archetype, 'arrow_shot');
  const y0 = arrow.at[1]; run(rt, 20); assert.ok(rt.entity(arrow.id) ? arrow.at[1] < y0 : true, 'gravity pulls the arrow down');
  run(rt, 60);
  rt.step({ actions: { fire: true } }); rt.step({}); run(rt, 40);
  rt.step({ actions: { fire: true } }); rt.step({}); run(rt, 40);
  assert.equal(count(rt, 'fired'), 2);
  assert.equal(count(rt, 'empty'), 1, 'out of arrows');
  // Bomb: plus-shaped blast along open cells, stopped by stone, breaking crates.
  const space = rt.space('field');
  space.setCell([10, 5, 0], 'crate', rt); space.setCell([8, 7, 0], 'stone', rt);
  rt.run([{ do: 'set_ranged', weapon: 'bomb' }]);
  rt.space('field').setPos(p, [8, 5, 0], rt);
  const near = rt.spawn('drone', { at: [6, 5, 0] }), behind = rt.spawn('drone', { at: [8, 8, 0] });
  fire(rt, 70);
  assert.equal(count(rt, 'blast'), 1);
  assert.equal(space.getCell([10, 5, 0]), null, 'crate broken');
  assert.equal(space.getCell([8, 7, 0]), 'stone', 'stone stops the blast');
  assert.equal(near.components.health.hp, 47);
  assert.equal(behind.components.health.hp, 50);
  fire(rt, 2); assert.equal(count(rt, 'empty') >= 2, true, 'one bomb per life');
});

test('projectile: event ammo reloads, status on hit, cancel, maxLive, NPC intent and the fire effect', () => {
  const rt = make(rangedDoc({ with: { maxLive: 5 } })), p = rt.player(), P = rt.service('projectiles');
  rt.run([{ do: 'set_ranged', weapon: 'zapper' }]);
  fire(rt, 2); assert.equal(count(rt, 'empty'), 1);
  rt.emit('power', { who: 'player' });
  assert.equal(P.ammo(p, 'zapper'), 2);
  const d = rt.spawn('drone', { at: [6, 5, 0] });
  fire(rt, 20);
  assert.equal(rt.service('status').has(d, 'shocked'), true);
  for (let i = 0; i < 8; i++) P.fire(p, P.weapon('ring'));
  assert.ok(shots(rt).length <= 5, 'maxLive caps live shots');
  const live = shots(rt).length;
  assert.equal(P.cancel({ team: 'player' }), live);
  assert.equal(shots(rt).length, 0); assert.equal(count(rt, 'cancelled'), 1);
  d.components.ranged = { weapon: 'blaster', intent: { fire: true, dir: [-1, 0, 0] } };
  run(rt, 30);
  assert.ok(p.components.health.hp < 100, 'NPC shot through components.ranged.intent');
  rt.run([{ do: 'fire', who: d.id, weapon: 'blaster', target: 'player', free: true }]);
  assert.equal(shots(rt).length, 1);
});

test('projectile: deterministic replay and bad configs', () => {
  same(() => { const rt = make(rangedDoc()); rt.spawn('drone', { at: [9, 5, 0] }); return rt; }, Array.from({ length: 80 }, (_, i) => ({ actions: i % 5 === 0 ? { fire: true } : {} })));
  const bad = rangedDoc({ weapons: [{ id: 'w1', ammo: { from: 'item' } }, { id: 'w2', ammo: { from: 'event' } }, { id: 'w3', lanes: [[0], 'x'] }, { id: 'w4', tiers: [{}, {}], maxTier: 1 }], with: { playerWeapon: 'nothing' } });
  bad.content.archetypes.push({ id: 'gunner', components: { ranged: { weapon: 'phaser' } } });
  const c = codes(bad);
  for (const code of ['projectile_ammo_invalid', 'projectile_tier_invalid', 'projectile_weapon_unknown']) assert.ok(c.includes(code), `${code} in ${c}`);
  assert.ok(c.includes('param_type'), 'lanes is a declared list of offset lists: a non-list lane is param_type (was projectile_lanes_invalid)');
  assert.ok(codes(rangedDoc({ weapons: [{ id: 'w5', pattern: 'zigzag' }] })).includes('param_option'));
});

// ---------- target ----------
const targetDoc = (cfg = {}, solid = []) => rangedDoc({}, { solid, systems: [{ use: 'gameplay.combat.target', with: { range: 10, fov: 120, breakDist: 14, ...cfg } }] });

test('target: lock the best visible hostile, cycle, face it, switch on death, break with distance', () => {
  const rt = make(targetDoc({}, [[5, 8, 0]])), p = rt.player();
  p.components.body.facing = [1, 0, 0]; // a free-aim (vector) facing turns toward the target
  const a = rt.spawn('drone', { at: [6, 5, 0] }), b = rt.spawn('drone', { at: [8, 7, 0] }), behind = rt.spawn('drone', { at: [0, 5, 0] });
  rt.spawn('drone', { at: [8, 11, 0] }); // hidden behind the wall cell at [5,8]? (out of LOS or range)
  rt.step({ actions: { lock: true } });
  assert.equal(rt.state.vars.target, a.id);
  assert.ok(rt.test({ locked: true }));
  rt.step({ actions: { cycle: 1 } });
  assert.equal(rt.state.vars.target, b.id);
  assert.ok(p.components.body.facing[1] > 0, 'faces the target');
  assert.ok(!rt.service('target').candidates(p).includes(behind.id), 'behind the locker is outside the view cone');
  rt.service('combat').kill(b, { by: 'player' }); rt.step();
  assert.equal(rt.state.vars.target, a.id, 'switched on death');
  rt.space('field').setPos(a, [25, 5, 0], rt); rt.step();
  assert.equal(rt.state.vars.target, '', 'broke with distance');
  assert.equal(count(rt, 'unlocked'), 2);
  same(() => { const r = make(targetDoc()); r.spawn('drone', { at: [6, 5, 0] }); return r; }, [{ actions: { lock: true } }, {}, { actions: { cycle: 1 } }, {}]);
  assert.ok(codes(targetDoc({ range: 20, breakDist: 5 })).includes('target_break_invalid'));
});

test('target: projectiles aim at the locked target', () => {
  const rt = make(targetDoc()), d = rt.spawn('drone', { at: [7, 9, 0] });
  rt.step({ actions: { lock: true } });
  fire(rt, 60);
  assert.ok(d.components.health.hp < 50);
});

// ---------- cover ----------
const coverDoc = (cfg = {}) => rangedDoc({}, { solid: [[4, 5, 0]], systems: [{ use: 'gameplay.combat.cover', with: { reduction: 0.5, snapRange: 3, ...cfg } }] });

test('cover: snap to a wall; hits from the covered side are reduced or blocked; moving away leaves cover', () => {
  const rt = make(coverDoc()), p = rt.player(), c = rt.service('combat');
  const front = rt.spawn('drone', { at: [12, 5, 0] }), back = rt.spawn('drone', { at: [0, 5, 0] });
  rt.step({ actions: { cover: true } });
  assert.equal(count(rt, 'cover_enter'), 1);
  assert.ok(rt.test({ in_cover: true }));
  assert.equal(c.hit(p, { amount: 10, by: front.id, source: 'projectile' }).damage, 5, 'half cover');
  assert.equal(c.hit(p, { amount: 10, by: back.id, source: 'projectile' }).damage, 10, 'exposed side');
  assert.equal(c.hit(p, { amount: 10, by: front.id, source: 'melee' }).damage, 10, 'cover does not stop melee by default');
  p.components.cover.level = 2;
  assert.equal(c.hit(p, { amount: 10, by: front.id, source: 'projectile' }).reason, 'cover');
  rt.space('field').setPos(p, [1, 5, 0], rt); rt.step();
  assert.equal(count(rt, 'cover_exit'), 1);
  same(() => make(coverDoc()), [{ actions: { cover: true } }, {}, { actions: { cover: true } }]);
  assert.ok(codes(coverDoc({ sources: [] })).includes('param_range')); // sources declares min: 1
  assert.ok(codes(coverDoc({ sources: ['laser'] })).includes('param_option'));
});

// ---------- aim ----------
const aimDoc = (cfg = {}) => rangedDoc({}, { systems: [{ use: 'gameplay.combat.aim', with: { cost: 25, points: 60, damage: 20, baseChance: 0.95, falloff: 0.05, ...cfg } }] });

test('aim: slow motion, queued shots with hit chances, action points, seeded rolls, mark mode', () => {
  const rt = make(aimDoc()), a = rt.spawn('drone', { at: [5, 5, 0] }), b = rt.spawn('drone', { at: [15, 5, 0] });
  rt.step({ actions: { aim: true } });
  assert.equal(rt.state.vars['time.scale'], 0.1);
  rt.step({ actions: { mark: a.id } }); rt.step({ actions: { mark: b.id } }); rt.step({ actions: { mark: a.id } });
  assert.equal(count(rt, 'aim_marked'), 2); assert.equal(count(rt, 'aim_no_points'), 1, 'only 60 points');
  const marks = rt.store('gameplay.combat.aim').queue;
  assert.ok(marks[0].chance > marks[1].chance, 'nearer is likelier');
  rt.step({ actions: { execute: true } });
  assert.equal(count(rt, 'aim_shot') + count(rt, 'aim_miss'), 2);
  assert.equal(rt.state.vars['aim.active'], 0); assert.equal(rt.state.vars['time.scale'], 1);
  run(rt, 120);
  assert.ok(rt.state.vars['aim.points'] >= 25, 'points regenerate outside aim (10 left + 2 s x 10/s)');
  const mk = make(aimDoc({ mode: 'mark' }));
  mk.spawn('drone', { at: [5, 5, 0] });
  mk.step({ actions: { aim: true } }); mk.step({ actions: { mark: true } }); mk.step({ actions: { aim: true } });
  assert.equal(mk.state.counts.aim_shot + (mk.state.counts.aim_miss ?? 0), 1, 'marks fire when aim mode ends');
  same(() => { const r = make(aimDoc()); r.spawn('drone', { at: [5, 5, 0] }); return r; }, [{ actions: { aim: true } }, { actions: { mark: true } }, { actions: { execute: true } }, {}]);
  assert.ok(codes(aimDoc({ minChance: 0.99, baseChance: 0.5 })).includes('aim_chance_invalid'));
});
