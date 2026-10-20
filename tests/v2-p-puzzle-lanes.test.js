import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, run, testSpace } from '../v2/kernel/testing.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import { preflight } from '../v2/kernel/document.js';
import lanes, { nearest, trainAt } from '../v2/primitives/gameplay/lanes-periodic.js';

const PRIMS = [testSpace, lanes];
const LANES = [
  { id: 'road', row: 1, kind: 'road', dir: 1, speed: 3, period: 6, size: 1, archetype: 'car' },
  { id: 'river', row: 2, kind: 'river', dir: -1, speed: 2, period: 4, size: 2.5 },
  { id: 'rail', row: 3, kind: 'rail', dir: 1, period: 5, size: 8, phase: 0.5 },
];
const doc = (w = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'hop', title: 'Hop', seed: 2,
  spaces: [{ id: 'w', use: 'engine.space.test', with: { size: [10, 8, 1] } }],
  systems: [{ use: 'gameplay.lanes.periodic', with: { lanes: LANES, width: [0, 9], onHit: [{ do: 'add_var', var: 'hits' }], onIdle: [{ do: 'add_var', var: 'eagle' }], idle: { sec: 0, creep: 0 }, ...w } }],
  content: { archetypes: [{ id: 'hero', components: {} }, { id: 'car', components: {} }] },
  player: { archetype: 'hero', space: 'w', at: [4, 0, 0] },
});
const put = (rt, x, y) => rt.space('w').setPos(rt.player(), [x, y, 0], rt);

test('lanes: cars hit, near misses count once, movers follow the analytic lane', () => {
  const { rt, checked } = compile(doc(), { primitives: PRIMS });
  assert.ok(checked.ok);
  put(rt, 1.0, 1); rt.step();
  assert.equal(rt.state.counts['near_miss:road'], 1);
  rt.step(); assert.equal(rt.state.counts['near_miss:road'], 1, 'once per visit');
  const shift = rt.state.prim['gameplay.lanes.periodic'].shift.road;
  put(rt, shift, 1); rt.step();
  assert.equal(rt.state.counts['lane_hit:road'], 1);
  assert.equal(rt.state.vars.hits, 1);
  const cars = Object.values(rt.state.entities).filter(e => e.archetype === 'car');
  assert.ok(cars.length >= 2);
  const s = rt.state.prim['gameplay.lanes.periodic'];
  for (const c of cars) assert.ok(Math.abs(nearest({ ...LANES[0], phase: 0 }, c.at[0], s.shift.road)) < 1e-6 && c.at[1] === 1, 'car entities sit on mover centres');
  assert.equal(rt.service('lanes').dangerAt([s.shift.road, 1]), 'car');
});

test('lanes: logs carry the subject; open water drowns', () => {
  const { rt } = compile(doc(), { primitives: PRIMS });
  put(rt, 0, 2); rt.step();
  assert.equal(rt.state.counts.carried, 1);
  assert.ok(rt.player().at[0] < 0, 'carried along the river direction');
  put(rt, 2, 2); rt.step();
  assert.equal(rt.state.counts['lane_hit:river'], 1);
});

test('lanes: trains are announced by a warning and then hit', () => {
  const { rt } = compile(doc(), { primitives: PRIMS });
  put(rt, 4, 3);
  for (let i = 0; i < 400 && !rt.state.counts['lane_hit:rail']; i++) rt.step();
  assert.equal(rt.state.counts['train_warning:rail'], 1);
  assert.equal(rt.state.counts['lane_hit:rail'], 1);
  assert.ok(rt.state.time > 2.5 && rt.state.time < 3.1, `hit at ${rt.state.time}`);
  assert.equal(trainAt(LANES[2], 2, [0, 9], 30, 1.25).front, null);
  assert.equal(trainAt(LANES[2], 2, [0, 9], 30, 1.25).warn, true);
});

test('lanes: the eagle catches idlers and anyone behind the creeping line', () => {
  const { rt } = compile(doc({ idle: { sec: 2, creep: 0 } }), { primitives: PRIMS });
  run(rt, 60); put(rt, 4, 1.0 + 3); // jump forward to row 4 (no lane): progress
  rt.step();
  assert.ok(rt.state.counts.progress >= 1);
  run(rt, 125);
  assert.equal(rt.state.vars.eagle, 1);
  const c = compile(doc({ idle: { sec: 0, creep: 1, behind: 1, lead: 1 } }), { primitives: PRIMS }).rt;
  run(c, 150);
  assert.ok(c.state.vars.eagle >= 1, 'the creeping line caught a subject that never moved');
});

test('lanes: deterministic replay and speed ramp', () => {
  const play = () => { const { rt } = compile(doc(), { primitives: PRIMS }); put(rt, 0, 2); run(rt, 200); return rt; };
  const a = play(), b = play();
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.ok(a.state.vars['lanes.speed'] > 1);
});

test('lanes: preflight rejects bad configs with stable codes', () => {
  const registry = new Registry(PRIMS), logic = buildLogic(registry, Logic);
  const codes = w => preflight(doc(w), registry, logic).errors.map(e => e.code);
  assert.ok(codes({ axis: 0 }).includes('lanes_axes'));
  assert.ok(codes({ width: [5, 1] }).includes('lanes_width'));
  assert.ok(codes({ lanes: [LANES[0], { ...LANES[1], row: 1 }] }).includes('lanes_row_duplicate'));
  assert.ok(codes({ lanes: [{ id: 'x', row: 1, kind: 'lava' }] }).includes('param_option'));
  assert.ok(codes({ lanes: [{ ...LANES[0], dir: 0 }] }).includes('lanes_dir'));
});
