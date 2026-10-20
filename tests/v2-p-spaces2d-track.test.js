import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spaceConformance, compile, run } from '../v2/kernel/testing.js';
import { checkFields } from '../v2/kernel/params.js';
import { preflight } from '../v2/kernel/document.js';
import { catalogue } from '../v2/primitives/index.js';
import spaces2d from '../v2/primitives/engine/spaces2d.index.js';

const track = spaces2d.find(p => p.id === 'engine.space.track');
const doc = (w = {}, extra = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'run', title: 'Runner', seed: 8,
  spaces: [{ id: 'rail', use: 'engine.space.track', with: { lanes: 3, window: [5, 40], ...w }, zones: [{ id: 'start', range: [0, 10] }, { id: 'tunnel', range: [20, 30], lanes: [0, 1] }] }],
  content: { archetypes: [{ id: 'runner', components: { body: { size: [0.8, 0.6, 1.8] } } },
    { id: 'barrier', components: { body: { size: [0.5, 1, 1], obstacle: true, cull: true } } },
    { id: 'train', components: { body: { size: [6, 1, 3], solid: true, obstacle: true, cull: true } } }] },
  player: { archetype: 'runner', at: [2, 1, 0] }, ...extra,
});
const make = (w, extra) => compile(doc(w, extra), { primitives: spaces2d }).rt;

spaceConformance(test, assert, { name: 'engine.space.track', primitives: spaces2d, doc: () => doc(), free: [2, 1, 0.9], other: [5, 1, 0.9] });

test('track: lanes clamp, jumps land on the ground and on top of solid trains, trains block ahead', () => {
  const rt = make(), api = rt.space('rail'), p = rt.player();
  assert.deepEqual(p.at, [2, 1, 0.9], 'placed resting on the ground');
  let r = api.slide(p, [0, 5, 0], rt);
  assert.equal(p.at[1], 2); assert.equal(r.blocked.y, true, 'outer lane edge');
  api.slide(p, [0, -2, 0], rt); assert.equal(p.at[1], 0);
  r = api.slide(p, [0, 0, 2], rt); assert.ok(p.at[2] > 2 && !r.grounded);
  r = api.slide(p, [0, 0, -5], rt); assert.ok(r.grounded && Math.abs(p.at[2] - 0.9) < 1e-9 && r.blocked.z);
  rt.spawn('train', { at: [10, 0, 1.5], id: 'train' });
  r = api.slide(p, [8, 0, 0], rt);
  assert.equal(r.blocked.x, true); assert.ok(p.at[0] < 7 - 0.4 + 1e-6, `stopped at the train's end: ${p.at}`);
  api.setPos(p, [9, 0, 5], rt);
  r = api.slide(p, [0, 0, -3], rt);
  assert.ok(r.grounded && r.on === 'train' && Math.abs(p.at[2] - 3.9) < 1e-6, `rides on the roof: ${p.at}`);
  assert.equal(api.grounded(p), true);
  r = api.slide(p, [0, 1, 0], rt);
  assert.equal(r.grounded, false, 'stepping off the roof sideways');
});

test('track: leader passes obstacles (near-miss gap), passed ones are culled behind the window', () => {
  const rt = make(), api = rt.space('rail'), p = rt.player();
  rt.spawn('barrier', { at: [6, 0, 0.5], id: 'b1' }); rt.spawn('barrier', { at: [9, 2, 0.5], id: 'b2' });
  const passed = []; rt.on('passed', e => passed.push(e));
  for (let i = 0; i < 60; i++) { api.slide(p, [0.25, 0, 0], rt); rt.step(); }
  assert.deepEqual(passed.map(e => [e.who, e.gap]), [['b1', 1], ['b2', 1]]);
  assert.equal(rt.entity('b1'), undefined, 'culled once behind the window');
  assert.equal(rt.state.counts.culled, 2);
  const b = api.bounds();
  assert.deepEqual([b.min[0], b.max[0], b.max[1]], [p.at[0] - 5, p.at[0] + 40, 2]);
  assert.equal(api.inBounds([p.at[0] - 6, 1, 0]), false);
});

test('track: ballistic oncoming trains move and stay solid; raycast finds what is ahead in a lane', () => {
  const rt = make(), api = rt.space('rail'), p = rt.player();
  const t = rt.spawn('train', { at: [30, 1, 1.5], id: 't', components: { body: { size: [6, 1, 3], solid: true, ballistic: true, gravityScale: 0, vel: [-10, 0, 0] } } });
  run(rt, 60);
  assert.ok(Math.abs(t.at[0] - 20) < 1e-6 && t.at[2] === 1.5, `train drove 10 units: ${t.at}`);
  let h = api.raycast(p.at, [1, 0, 0], 50, { ignore: 'player' });
  assert.equal(h.hit, 'entity'); assert.equal(h.id, 't'); assert.ok(Math.abs(h.dist - 15) < 1e-6);
  assert.equal(api.raycast([p.at[0], 0, p.at[2]], [1, 0, 0], 50, { ignore: 'player' }).hit, 'none', 'lane 0 is clear');
  h = api.raycast([2, 1, 5], [0, 0, -1], 10, { entities: false });
  assert.equal(h.hit, 'cell'); assert.equal(h.dist, 5);
  assert.deepEqual(api.overlap({ kind: 'sphere', at: [17, 1, 1], r: 0.1 }), ['t']);
  assert.deepEqual(api.overlap({ kind: 'aabb', at: [0, 0, 0], size: [4, 3, 2] }), ['player']);
  assert.ok(api.contacts(p).length === 0);
});

test('track: looped circuits wrap progress, count laps and measure the short way round', () => {
  const rt = make({ loop: true, length: 100 }), api = rt.space('rail'), p = rt.player();
  for (let i = 0; i < 25; i++) api.slide(p, [9, 0, 0], rt);
  assert.ok(p.at[0] >= 0 && p.at[0] < 100);
  assert.equal(api.laps(p), 2); assert.equal(rt.state.counts.lap, 2);
  assert.equal(api.distance([99, 1, 0], [1, 1, 0]), 2);
  assert.deepEqual(api.wrapPos([105, 1, 0]), [5, 1, 0]);
  rt.spawn('barrier', { at: [1, 1, 0.5], id: 'near' });
  assert.ok(api.raycast([98, 1, 0.5], [1, 0, 0], 10).id === 'near', 'raycast across the seam');
  assert.ok(compile(doc({ loop: true, length: 50 }), { primitives: spaces2d }).checked.capabilities.rail.includes('wrap'));
});

test('track: zones are track segments with optional lanes', () => {
  const rt = make(), api = rt.space('rail'), p = rt.player();
  assert.equal(p.zone, 'start');
  api.setPos(p, [25, 0, 0.9], rt);
  assert.equal(p.zone, 'tunnel'); assert.ok(rt.state.events.some(e => e.name === 'enter_zone:tunnel'));
  api.setPos(p, [25, 2, 0.9], rt);
  assert.equal(p.zone, null, 'lane 2 is outside the tunnel');
  rt.run([{ do: 'teleport', zone: 'tunnel' }]);
  assert.ok(rt.test({ zone: 'tunnel' }));
  assert.equal(api.nearest(p, 'start', rt), 10);
});

test('track: a gate blocks its lane until opened; one-way moving platforms carry riders', () => {
  const rt = make(), api = rt.space('rail'), p = rt.player();
  const gate = rt.spawn('barrier', { id: 'gate', at: [6, 1, 1.5], components: { mechanism: 'g1', body: { size: [0.4, 1, 3], solid: true } } });
  let r = api.slide(p, [10, 0, 0], rt);
  assert.equal(r.blocked.x, true); assert.deepEqual(r.touched, ['gate']);
  assert.equal(api.raycast(p.at, [1, 0, 0], 20, { ignore: 'player' }).id, 'gate');
  gate.components.body.solid = false;
  r = api.slide(p, [10, 0, 0], rt); assert.equal(r.blocked.x, false, 'opened');
  // A one-way hover platform moving along the track: jump through it from below, ride it from above.
  const hover = rt.spawn('barrier', { id: 'hover', at: [14, 1, 2], components: { body: { size: [4, 1, 0.4], solid: true, oneWay: true, ballistic: true, collide: false, gravityScale: 0, vel: [0, 0, 0] } } });
  api.setPos(p, [14, 1, 0.9], rt);
  r = api.slide(p, [0, 0, 3], rt); assert.equal(r.blocked.z, false, 'through from below');
  r = api.slide(p, [0, 0, -3], rt);
  assert.ok(r.grounded && r.on === 'hover' && Math.abs(p.at[2] - 3.1) < 1e-9, `lands on top: ${p.at}`);
  r = api.slide(p, [3, 0, 0], rt); assert.equal(r.blocked.x, false, 'one-way does not block along the track');
  api.setPos(p, [14, 1, 3.1], rt); api.slide(p, [0, 0, -0.1], rt);
  hover.components.body.vel = [6, 0, 0.5]; run(rt, 30);
  assert.ok(Math.abs(hover.at[0] - 17) < 1e-6 && Math.abs(p.at[0] - 17) < 1e-6 && Math.abs(p.at[2] - 3.35) < 1e-6, `rider carried: ${p.at}`);
});

test('track: removeZone and moveZone', () => {
  const rt = make(), api = rt.space('rail');
  api.moveZone('tunnel', { range: [0, 5], lanes: [1, 1] }, rt);
  assert.ok(rt.test({ zone: 'tunnel' }) && rt.state.events.some(e => e.name === 'enter_zone:tunnel'));
  api.removeZone('tunnel', rt);
  assert.equal(rt.test({ zone: 'tunnel' }), false);
  assert.throws(() => api.moveZone('start', { range: 3 }, rt));
});

test('track: deterministic replay', () => {
  const go = () => { const rt = make(); for (let i = 0; i < 5; i++) rt.spawn(i % 2 ? 'train' : 'barrier', { at: [8 + i * 7, i % 3, 1.5] }); const api = rt.space('rail'); for (let i = 0; i < 80; i++) { api.slide(rt.player(), [0.3, i % 20 === 0 ? 1 : 0, 0], rt); rt.step(); } return rt.snapshot(); };
  assert.deepEqual(go(), go());
});

test('track: preflight rejects bad configs with stable codes', () => {
  const { registry, logic } = catalogue();
  const codes = (w, z) => { const d = doc(w); if (z) d.spaces[0].zones.push(z); return preflight(d, registry, logic).errors.map(e => e.code); };
  assert.ok(codes({ loop: true }).includes('track_loop_length'));
  assert.ok(codes({}, { id: 'bad', range: [5, 2] }).includes('zone_range_invalid'));
  assert.ok(codes({}, { id: 'wide', range: [0, 2], lanes: [0, 5] }).includes('zone_lanes_invalid'));
  assert.ok(codes({ lanes: 0 }).includes('param_range'));
  assert.ok(codes({ window: [5] }).includes('param_range'));
});

test('track: every instance in v2/games preflights its params with zero errors', () => {
  for (const f of readdirSync('v2/games').filter(f => f.endsWith('.json'))) {
    const g = JSON.parse(readFileSync(`v2/games/${f}`, 'utf8'));
    for (const s of g.spaces || []) if (s.use === track.id) { const errors = []; errors.push(...track.validate(checkFields(track.card.params, s.with || {}, 'with', errors, null), g, {})); assert.deepEqual(errors, [], `${f} ${s.id}`); }
  }
});
