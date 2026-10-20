// engine.physics.character / body / rigid over the reference test space (gravity on, min-corner boxes).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile, run, testSpace } from '../v2/kernel/testing.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import { preflight } from '../v2/kernel/document.js';
import { checkFields } from '../v2/kernel/params.js';
import runtime from '../v2/primitives/engine/runtime.index.js';
import spaceGraph from '../v2/primitives/engine/space-graph.js';

const PRIMS = [testSpace, ...runtime];
const floor = (w = 40) => Array.from({ length: w }, (_, x) => [x, 0, 0]);
const doc = (systems, { solid = floor(), archetypes = [], gravity = 30, player = { archetype: 'hero', at: [2, 1, 0] } } = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'rt-phys', title: 'Runtime physics', seed: 5,
  spaces: [{ id: 'w', use: 'engine.space.test', with: { size: [40, 20, 1], gravity, solid } }],
  content: { archetypes: [{ id: 'hero', components: { body: { size: [0.8, 1.8, 1], layer: 'player' } } }, ...archetypes] },
  player, systems,
});
const make = (systems, opts) => compile(doc(systems, opts), { primitives: PRIMS });
const codes = d => { const r = new Registry(PRIMS); return preflight(d, r, buildLogic(r, Logic)).errors.map(e => e.code); };
const character = { use: 'engine.physics.character', with: { stepHeight: 1.05, fallHeight: 3 } };

test('engine.physics.character: falls under gravity, lands, walks, steps up ledges and stops at walls', () => {
  const solid = [...floor(), [6, 1, 0], [12, 1, 0], [12, 2, 0], [12, 3, 0]];
  const { rt } = make([character], { solid, player: { archetype: 'hero', at: [2, 6, 0] } });
  run(rt, 90);
  const p = rt.player();
  assert.equal(p.components.body.grounded, true);
  assert.ok(Math.abs(p.at[1] - 1) < 0.02, `on the floor, y=${p.at[1]}`);
  assert.equal(rt.state.counts.landed, 1);
  assert.equal(rt.state.counts.fell, 1, '5-cell drop counts as a fall');
  // Walk right: step onto the 1-high block at x=6, then stop at the 3-high wall at x=12.
  for (let i = 0; i < 150; i++) { p.components.body.vel[0] = 4; rt.step(); }
  assert.ok(p.at[0] > 10.9 && p.at[0] < 11.3, `stopped at wall, x=${p.at[0]}`);
  assert.equal(p.components.body.vel[0], 0);
  const svc = rt.service('character');
  svc.jump(p, 12); run(rt, 2);
  assert.equal(rt.state.counts.jumped, 1);
  assert.equal(rt.state.counts.left_ground, 2);
  assert.ok(svc.airTime(p) >= 1);
});

test('engine.physics.character: skips entities owned by another controller; move() steps up', () => {
  const solid = [...floor(), [4, 1, 0]];
  const { rt } = make([character], { solid, archetypes: [{ id: 'npc', components: { body: { size: [0.8, 1.8, 1], controller: 'move', vel: [0, 0, 0] } } }] });
  const npc = rt.spawn('npc', { at: [8, 5, 0] });
  run(rt, 30);
  assert.deepEqual(npc.at, [8, 5, 0], 'another controller owns it');
  const p = rt.player(); run(rt, 5);
  const r = rt.service('character').move(p, [2, 0, 0]);
  assert.equal(r.stepped, true);
  assert.ok(Math.abs(p.at[1] - 2) < 0.02 && p.at[0] < 5, `on the step, at=${p.at}`);
});

test('engine.physics.body: layer matrix, collide/separate events and push-apart', () => {
  const sys = [{ use: 'engine.physics.body', with: { origin: 'min', separate: true, matrix: [{ a: 'enemy', b: 'enemy', collide: false }] } }];
  const archetypes = [{ id: 'slime', components: { body: { size: [1, 1, 1], layer: 'enemy' } } }, { id: 'coin', components: { body: { size: [0.5, 0.5, 1], layer: 'pickup', sensor: true } } }];
  const { rt } = make(sys, { gravity: 0, archetypes, player: { archetype: 'hero', at: [2, 1, 0] } });
  rt.spawn('slime', { at: [10, 1, 0] }); rt.spawn('slime', { at: [10.5, 1, 0] });
  const coin = rt.spawn('coin', { at: [2.2, 1.5, 0] });
  run(rt, 1);
  assert.equal(rt.state.counts['collide:coin'], 1);
  assert.equal(rt.state.counts['collide:slime'] ?? 0, 0, 'enemy/enemy does not collide');
  assert.ok(rt.test({ touching: 'coin' }));
  assert.deepEqual(coin.at, [2.2, 1.5, 0], 'sensors are not pushed');
  rt.space('w').setPos(rt.player(), [9.6, 1, 0], rt); run(rt, 1);
  assert.equal(rt.state.counts['collide:slime'], 1);
  assert.equal(rt.state.counts.separate, 1);
  run(rt, 3);
  assert.ok(!rt.service('bodies').contacts('player').length, 'pushed apart');
  assert.equal(rt.service('bodies').collides('enemy', 'enemy'), false);
});

test('engine.physics.rigid: bodies fall, bounce, rest by friction, sleep, wake on impulse and stack', () => {
  const sys = [{ use: 'engine.physics.rigid', with: { origin: 'min', restitution: 0.5, sleepSec: 0.5 } }];
  const archetypes = [{ id: 'crate', components: { body: { size: [1, 1, 1] }, rigid: { mass: 2 } } }];
  const { rt } = make(sys, { archetypes, player: null });
  const a = rt.spawn('crate', { at: [5, 6, 0] }), b = rt.spawn('crate', { at: [5, 9, 0] });
  run(rt, 40);
  assert.ok(rt.state.counts['impact:world'] >= 1, 'hit the floor');
  run(rt, 200);
  assert.ok(Math.abs(a.at[1] - 1) < 0.02, `on the floor, y=${a.at[1]}`);
  assert.ok(Math.abs(b.at[1] - 2) < 0.06, `stacked, y=${b.at[1]}`);
  assert.ok(rt.test({ sleeping: a.id }));
  rt.run([{ do: 'impulse', who: a.id, v: [8, 0, 0] }]);
  assert.ok(!rt.test({ sleeping: a.id }));
  run(rt, 120);
  assert.ok(a.at[0] > 5.25, 'slid');
  assert.equal(a.components.body.vel[0], 0, 'friction stopped it');
});

test('engine.physics.rigid delegates to a space that reports dynamics', () => {
  const calls = [];
  const dynSpace = { ...testSpace, id: 'engine.space.dyn', install(rt, config, instance) { testSpace.install(rt, config, instance); const api = rt.space(instance.id); api.impulse = (e, v) => calls.push(['impulse', e.id, v]); api.setVelocity = (e, v) => calls.push(['set', e.id, v]); api.velocity = () => [1, 2]; } };
  const d = doc([{ use: 'engine.physics.rigid' }], { archetypes: [{ id: 'ball', components: { body: { size: [1, 1, 1] }, rigid: {} } }] });
  d.spaces[0].use = 'engine.space.dyn';
  const { rt } = compile(d, { primitives: [dynSpace, ...runtime] });
  const ball = rt.spawn('ball', { at: [5, 5, 0] }); run(rt, 10);
  assert.deepEqual(ball.at, [5, 5, 0], 'left to the space');
  rt.run([{ do: 'impulse', who: ball.id, v: [1, 0, 0] }]);
  assert.deepEqual(calls, [['impulse', ball.id, [1, 0, 0]]]);
  assert.deepEqual(rt.service('rigid').velocity(ball), [1, 2]);
});

test('physics primitives replay deterministically across snapshot/restore', () => {
  const sys = [character, { use: 'engine.physics.body', with: { origin: 'min' } }, { use: 'engine.physics.rigid', with: { origin: 'min' } }];
  const archetypes = [{ id: 'crate', components: { body: { size: [1, 1, 1] }, rigid: { mass: 1 } } }];
  const go = rt => { for (let i = 0; i < 4; i++) rt.spawn('crate', { at: [4 + i * 1.2, 3 + i, 0] }); return rt; };
  const a = go(make(sys, { archetypes }).rt), b = go(make(sys, { archetypes }).rt);
  for (let i = 0; i < 200; i++) { (a.player().components.body.vel ??= [0, 0, 0])[0] = i % 50 < 25 ? 3 : -3; a.step(); }
  for (let i = 0; i < 100; i++) { (b.player().components.body.vel ??= [0, 0, 0])[0] = i % 50 < 25 ? 3 : -3; b.step(); }
  const snap = b.snapshot(); run(b, 37); b.restore(snap);
  for (let i = 100; i < 200; i++) { (b.player().components.body.vel ??= [0, 0, 0])[0] = i % 50 < 25 ? 3 : -3; b.step(); }
  assert.deepEqual(a.snapshot(), b.snapshot());
});

test('preflight rejects bad physics configs with stable codes', () => {
  const bad = doc([{ use: 'engine.physics.body', with: { layers: ['a', 'a'], matrix: [{ a: 'a', b: 'zz', collide: true }] } }, { use: 'engine.physics.character', with: { slopeLimit: 120 } }],
    { archetypes: [{ id: 'x', components: { body: { layer: 'nope' } } }] });
  const c = codes(bad);
  for (const code of ['body_layer_duplicate', 'body_layer_unknown', 'param_range']) assert.ok(c.includes(code), code);
  const noGravity = doc([character]); noGravity.spaces[0].use = 'engine.space.graph';
  const r = new Registry([...PRIMS, spaceGraph]);
  assert.ok(preflight(noGravity, r, buildLogic(r, Logic)).errors.some(e => e.code === 'capability_missing'));
});

test('every engine.physics.* instance in v2/games has valid params', () => {
  let n = 0;
  for (const id of ['blockport', 'emberfall', 'hollow-lantern', 'quiet-manor']) {
    const g = JSON.parse(readFileSync(new URL(`../v2/games/${id}.json`, import.meta.url)));
    (g.systems || []).forEach((s, i) => {
      const p = runtime.find(x => x.id === s.use); if (!p || !s.use.startsWith('engine.physics')) return;
      const errors = []; checkFields(p.card.params, s.with || {}, `${id}.systems[${i}].with`, errors); n++;
      assert.deepEqual(errors, [], `${id} systems[${i}]`);
    });
  }
  assert.ok(n >= 7);
});
