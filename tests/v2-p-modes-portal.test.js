import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, testSpace } from '../v2/kernel/testing.js';
import { preflight } from '../v2/kernel/document.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import modes from '../v2/primitives/gameplay/modes.index.js';
import portal, { rotateOnto } from '../v2/primitives/gameplay/portal.js';
import { doc, drive } from '../v2/primitives/gameplay/modes-lib-testing.js';

const P = [...modes, testSpace];
const walls = [...Array.from({ length: 20 }, (_, y) => [10, y, 0]), ...Array.from({ length: 10 }, (_, x) => [x, 15, 0])];
const pdoc = w => doc({ with: { size: [20, 20, 1], solid: walls }, archetypes: [{ id: 'ball', components: { body: { size: [1, 1, 1], vel: [0, 0, 0] } } }], player: { archetype: 'hero', at: [2, 5, 0], components: { body: { size: [1, 1, 1], facing: [1, 0, 0], vel: [0, 0, 0] } } },
  systems: [{ use: 'gameplay.portal', with: w || {} }] });
const portals = rt => rt.store('gameplay.portal').portals;

test('portal: rotateOnto maps entry to exit faces and conserves speed', () => {
  assert.deepEqual(rotateOnto([5, 0, 0], [1, 0, 0], [0, -1, 0]).map(v => +v.toFixed(9)), [0, -5, 0]);
  assert.deepEqual(rotateOnto([5, 0, 0], [1, 0, 0], [-1, 0, 0]).map(v => +v.toFixed(9) + 0), [-5, 0, 0], 'opposite faces send it back');
  const v = rotateOnto([3, 4, 1], [0, 0, 1], [1, 0, 0]); assert.ok(Math.abs(Math.hypot(...v) - Math.hypot(3, 4, 1)) < 1e-9);
});

test('portal: fire onto walls, pass through with momentum rotated, cooldown prevents ping-pong', () => {
  const { rt } = compile(pdoc(), { primitives: P });
  rt.step({ actions: { fire_portal: 'blue' } });
  assert.deepEqual(portals(rt).blue.normal, [-1, 0, 0]);
  assert.deepEqual(portals(rt).blue.at, [10, 5.5, 0.5]);
  rt.step({ actions: { fire_portal: { color: 'orange', dir: [0, 1, 0] } } });
  assert.deepEqual(portals(rt).orange.normal, [0, -1, 0]);
  const ball = rt.spawn('ball', { id: 'b', at: [9, 5, 0], components: { body: { size: [1, 1, 1], vel: [5, 0, 0] } } });
  rt.step();
  assert.equal(rt.state.counts.portal_entered, 1);
  assert.deepEqual(rt.entity('b').components.body.vel, [0, -5, 0], 'came out of the ceiling portal going down at the same speed');
  assert.ok(rt.entity('b').at[1] < 15 && rt.entity('b').at[1] > 12);
  rt.space('world').setPos(ball, [2, 14, 0], rt); rt.entity('b').components.body.vel = [0, 5, 0]; rt.step();
  assert.equal(rt.state.counts.portal_entered, 1, 'cooldown');
  drive(rt, 20); rt.space('world').setPos(rt.entity('b'), [2, 14, 0], rt); rt.entity('b').components.body.vel = [0, 5, 0]; rt.step();
  assert.equal(rt.state.counts.portal_entered, 2, 'back through after the cooldown');
  assert.deepEqual(rt.entity('b').components.body.vel, [-5, 0, 0]);
});

test('portal: surface rules fizzle; overlapping portals fizzle; removing the wall closes the portal', () => {
  const { rt } = compile(pdoc({ surfaces: ['white'] }), { primitives: P });
  rt.step({ actions: { fire_portal: 'blue' } });
  assert.equal(rt.state.counts.portal_fizzle, 1); assert.equal(portals(rt).blue, undefined);
  rt.space('world').setCell([10, 5, 0], 'white', rt);
  rt.step({ actions: { fire_portal: 'blue' } }); assert.ok(portals(rt).blue);
  rt.step({ actions: { fire_portal: 'orange' } });
  assert.equal(rt.state.counts.portal_fizzle, 2, 'cannot stack both portals on one spot');
  rt.space('world').setCell([10, 5, 0], null, rt); rt.step();
  assert.equal(portals(rt).blue, undefined); assert.equal(rt.state.counts.portal_closed, 1);
});

test('portal: fixed pairs, deterministic replay and preflight codes', () => {
  const fixed = [{ color: 'blue', at: [5, 2, 0.5], normal: [1, 0, 0] }, { color: 'orange', at: [5, 10, 0.5], normal: [0, 1, 0] }];
  const play = () => { const { rt } = compile(pdoc({ fixed }), { primitives: P }); const b = rt.spawn('ball', { id: 'b', at: [5, 1.5, 0], components: { body: { size: [1, 1, 1], vel: [-3, 0, 0] } } }); drive(rt, 3); return rt.snapshot(); };
  const a = play(); assert.deepEqual(a, play());
  assert.deepEqual(a.entities.b.components.body.vel, [0, 3, 0]);
  const registry = new Registry(P), logic = buildLogic(registry, Logic);
  const codes = new Set(preflight(pdoc({ colors: ['red', 'red'], fixed: [{ color: 'green', at: [0, 0, 0], normal: [0, 0, 0] }] }), registry, logic).errors.map(e => e.code));
  for (const c of ['portal_colors', 'portal_normal']) assert.ok(codes.has(c), c);
  void portal;
});
