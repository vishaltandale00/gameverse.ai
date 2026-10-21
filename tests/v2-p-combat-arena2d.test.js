// Combat on the real engine.space.arena2d (centre anchor, per-pose box sets,
// blast rect, dynamics): melee frame data with authored hit/hurt boxes, versus
// fighters, platform knockback blast KOs and projectiles against solids.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, run } from '../v2/kernel/testing.js';
import { PRIMITIVES } from '../v2/primitives/index.js';

const make = d => compile(d, { primitives: PRIMITIVES }).rt;
const count = (rt, n) => rt.state.counts[n] ?? 0;
const same = (build, inputs) => { const a = build(), b = build(); for (const i of inputs) { a.step(i); b.step(i); } assert.deepEqual(a.snapshot(), b.snapshot()); };
const fighter = specials => ({ build: 'average', stats: { walkSpeed: 5, jump: 5, weight: 5, health: 1000 }, specials, super: { archetype: 'rising' } });
// Local boxes [x, y, w, h] from the body centre, x forward (arena2d mirrors by facing).
const poses = {
  idle: { hurt: [[-0.19, -0.5, 0.38, 1]] },
  crouch: { hurt: [[-0.19, -0.5, 0.38, 0.55]] },
  jab: { hurt: [[-0.19, -0.5, 0.38, 1]], hit: [[0.08, 0.1, 0.46, 0.18]] },
};
const arenaDoc = (systems, archetypes, space = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'arena', title: 'Arena', seed: 6,
  spaces: [{ id: 'stage', use: 'engine.space.arena2d', with: { size: [9.2, 6], ...space } }],
  systems, content: { archetypes }, player: { archetype: 'p1', at: [4, 0.5] },
});
const versusDoc = () => arenaDoc([
  { use: 'gameplay.combat.health', with: { types: ['phys'], iframes: 0 } },
  { use: 'gameplay.combat.melee', with: { fighterScale: 0.01 } },
  { use: 'gameplay.combat.versus', with: { walls: [0, 9.2], maxSep: 3.6, floor: 0 } },
], [
  { id: 'p1', kind: 'player', components: { health: { max: 1000 }, melee: { fighter: fighter([{ archetype: 'uppercut', motion: 'dp' }]) }, versus: {}, body: { facing: 1, size: [0.38, 1], poses } } },
  { id: 'p2', kind: 'enemy', components: { health: { max: 1000 }, melee: { fighter: fighter([]) }, versus: {}, body: { facing: -1, size: [0.38, 1], poses } } },
]);

test('arena2d: authored pose hit boxes connect against hurt boxes; crouching shrinks the hurt box', () => {
  const rt = make(versusDoc()), p = rt.player(), cpu = rt.spawn('p2', { at: [4.5, 0.5] }), m = rt.service('melee');
  rt.space('stage').setPos(cpu, [4.5, 0.5], rt);
  m.start(p, '5A'); run(rt, 4);
  assert.equal(p.components.body.pose, 'jab', 'the move pose carries the hit box');
  run(rt, 1);
  assert.equal(cpu.components.health.hp, 970);
  assert.deepEqual(rt.space('stage').boxesOf(p, 'hit').length, 1);
  run(rt, 30);
  assert.equal(p.components.body.pose, 'idle');
  // A high box over a crouching hurt box whiffs.
  run(rt, 30);
  const hp = cpu.components.health.hp;
  const crouch = () => { cpu.components.melee.intent = { dir: 2 }; rt.step(); };
  crouch(); crouch();
  assert.equal(cpu.components.body.pose, 'crouch');
  m.start(p, '5A'); for (let i = 0; i < 8; i++) crouch();
  assert.equal(cpu.components.health.hp, hp, 'the jab passes over the crouch');
});

test('arena2d: versus fighters stand on the floor with the centre anchor, launch and land', () => {
  const rt = make(versusDoc()), p = rt.player(), cpu = rt.spawn('p2', { at: [4.45, 0.5] }), m = rt.service('melee');
  run(rt, 2);
  assert.equal(p.at[1], 0.5, 'feet on the floor (centre at half height)');
  assert.equal(p.components.body.grounded, true);
  m.start(p, 'sp0a'); run(rt, 6);
  assert.equal(cpu.components.versus.st, 'launch');
  assert.ok(cpu.at[1] > 0.5);
  run(rt, 150);
  assert.equal(count(rt, 'knockdown'), 1);
  assert.equal(cpu.at[1], 0.5);
  same(() => { const r = make(versusDoc()); r.spawn('p2', { at: [4.45, 0.5] }); return r; }, Array.from({ length: 90 }, (_, i) => ({ actions: i % 11 === 0 ? { attack: true } : {}, axes: { move: [i < 45 ? 1 : -1, 0] } })));
});

test('arena2d: platform knockback launches through the dynamics capability and KOs at the blast rect', () => {
  const rt = make(arenaDoc([
    { use: 'gameplay.combat.health', with: { types: ['phys'], iframes: 0 } },
    { use: 'gameplay.combat.knockback', with: { kb: [6, 0.2, 40], speedScale: 2, gravity: 5, stocks: 1 } },
  ], [{ id: 'p1', kind: 'player', components: { health: { max: 100 }, body: { size: [0.4, 1] } } }, { id: 'puff', kind: 'enemy', components: { health: { max: 100 }, knockback: { weight: 2 }, body: { size: [0.4, 1] } } }],
  { edges: { left: 'open', right: 'open', top: 'open', bottom: 'solid' }, blast: [-1, -1, 10.2, 7] }));
  const puff = rt.spawn('puff', { at: [5, 0.5] });
  puff.components.knockback.percent = 200;
  rt.service('combat').hit(puff, { amount: 10, by: 'player' });
  assert.equal(count(rt, 'launched'), 1);
  assert.ok(rt.space('stage').velocity(puff)[0] > 0);
  run(rt, 120);
  assert.equal(count(rt, 'blasted') >= 1, true);
  assert.equal(count(rt, 'blast_ko'), 1);
  assert.equal(count(rt, 'defeated:puff'), 1);
});

test('arena2d: projectiles stop at solids and hit hurt boxes', () => {
  const rt = make(arenaDoc([
    { use: 'gameplay.combat.health', with: { types: ['phys'], iframes: 0 } },
    { use: 'gameplay.combat.projectile', with: { weapons: [{ id: 'blaster', speed: 12, damage: 5, rate: 10, radius: 0.1 }], playerWeapon: 'blaster' } },
  ], [{ id: 'p1', kind: 'player', components: { health: { max: 100 }, body: { facing: 1, size: [0.4, 1] } } }, { id: 'drone', kind: 'enemy', components: { health: { max: 20 }, body: { size: [0.6, 0.6] } } }],
  { solids: [[6, 0, 6.5, 3]] }));
  const p = rt.player(), drone = rt.spawn('drone', { at: [5, 0.5] });
  rt.step({ actions: { fire: true } }); run(rt, 15);
  assert.equal(drone.components.health.hp, 15);
  rt.despawn(drone.id);
  rt.step({ actions: { fire: true } }); run(rt, 30);
  assert.equal(count(rt, 'projectile_hit'), 2, 'the second shot stops at the solid');
  assert.equal(Object.values(rt.state.entities).filter(e => e.components.projectile).length, 0);
  assert.equal(p.components.health.hp, 100, 'player shots never hurt the shooter');
});

// A CPU fighter acts only through its controls (components.input, the player's input shape, written by
// gameplay.ai.versus): the same walk, presses, held guard, motion specials and double-tap dash a person gets.
test('arena2d: an NPC fighter with controls walks, presses, does motion specials and dashes through components.input', () => {
  for (const layer of [[], [{ use: 'engine.input.actions', with: { verbs: ['move', 'attack', 'heavy', 'special', 'super', 'throw', 'block'] } }]]) {
    const d = versusDoc();
    d.systems.unshift(...layer, { use: 'engine.input.motions', with: { buttons: ['attack', 'heavy'] } });
    d.content.archetypes[1].components.melee.fighter = fighter([{ archetype: 'uppercut', motion: 'dp' }]);
    const rt = make(d), cpu = rt.spawn('p2', { at: [7, 0.5] }), started = [];
    rt.on('attack_started', e => { if (e.who === cpu.id) started.push(e.move); });
    const feed = (input, n = 1) => { for (let i = 0; i < n; i++) { cpu.components.input = structuredClone(input); rt.step({}); } };
    const idle = { axes: { move: [0, 0] }, held: {}, actions: {} };
    feed(idle, 2);
    const x0 = cpu.at[0];
    feed({ axes: { move: [-1, 0] }, held: {}, actions: {} }, 20);
    assert.ok(cpu.at[0] < x0 - 0.3, `${layer.length ? 'input layer' : 'raw input'}: walked toward the player (${x0} -> ${cpu.at[0]})`);
    feed(idle, 30);
    feed({ axes: { move: [0, 0] }, held: { attack: true }, actions: { attack: 1 } }); feed(idle, 40);
    assert.deepEqual(started, ['5A'], 'a press is the jab');
    // Dragon punch facing left (forward = -x): forward, down, down-forward + press.
    for (const [x, y, press] of [[-1, 0], [0, -1], [-1, -1, true]]) feed({ axes: { move: [x, y] }, held: press ? { attack: true } : {}, actions: press ? { attack: 1 } : {} });
    feed(idle, 80);
    assert.deepEqual(started, ['5A', 'sp0a'], 'the motion and its press are one special, not a normal');
    const before = rt.state.counts.dash ?? 0;
    for (const x of [-1, 0, -1]) feed({ axes: { move: [x, 0] }, held: {}, actions: {} });
    feed(idle, 2);
    assert.equal((rt.state.counts.dash ?? 0) - before, 1, 'a double tap forward dashes');
  }
});

test('versus: a KO\'d fighter that is revived (a new round) fights again', () => {
  const d = versusDoc(); d.systems[0].with.corpse = true;
  const rt = make(d), cpu = rt.spawn('p2', { at: [7, 0.5] });
  run(rt, 2);
  rt.service('combat').kill(cpu, { by: 'player' });
  run(rt, 2);
  assert.equal(cpu.components.versus.st, 'ko');
  rt.service('combat').revive(cpu);
  run(rt, 2);
  assert.equal(cpu.components.versus.st, 'free');
});

test('facing: in 2D the heading movement keeps in body.dir is the facing; without it, the side-view sign', async () => {
  const { facingOf } = await import('../v2/primitives/gameplay/combat-lib.js');
  assert.deepEqual(facingOf({ components: { body: { facing: 1, dir: [0, 1] } } }), [0, 1, 0], 'a ship heading up the screen');
  assert.deepEqual(facingOf({ components: { body: { facing: -1 } } }), [-1, 0, 0]);
  assert.deepEqual(facingOf({ components: { body: { facing: [0, 0, 1], dir: [1, 0, 0] } } }), [0, 0, 1], '3D facing vectors are kept');
});
