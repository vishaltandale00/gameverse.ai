import test from 'node:test';
import assert from 'node:assert/strict';
import { spaceConformance, compile, run, bodyBox } from '../v2/kernel/testing.js';
import { PRIMITIVES } from '../v2/primitives/index.js';

// Flat ground at y = 10 (no terrain generator), 256 m square.
const flat = (withExtra = {}, extra = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'mesh', title: 'Mesh', seed: 11,
  spaces: [{ id: 'land', use: 'engine.space.mesh3d', with: { size: [256, 256], heightRes: 2, baseHeight: 10, ...withExtra }, zones: [{ id: 'meadow', center: [64, 64], r: 20 }, { id: 'hall', bounds: { min: [150, 0, 150], max: [200, 30, 200] } }, { id: 'yard', polygon: [[0, 200], [40, 200], [40, 250], [0, 250]] }] }],
  systems: [],
  content: { archetypes: [{ id: 'hero', components: {} }, { id: 'ball', components: { body: { size: [1, 1, 1] } } }] },
  player: { archetype: 'hero', at: [100, 100] },
  ...extra,
});
const faller = {
  id: 'gameplay.test.worlds3d-faller',
  card: { intent: 'test helper: integrate gravity and walking through slide', requires: { capabilities: ['gravity'] } },
  install(rt) {
    rt.system('physics', rt => {
      for (const e of Object.values(rt.state.entities)) {
        const api = rt.space(e.space), b = e.components.body; if (!b) continue;
        b.vel[1] += api.gravityAt(e.at)[1] * rt.dt;
        const mv = e.id === 'player' ? rt.input.axes?.move || [0, 0] : [0, 0];
        const r = api.slide(e, [mv[0] * 5 * rt.dt, b.vel[1] * rt.dt, mv[1] * 5 * rt.dt], rt);
        if (r.blocked.y) b.vel[1] = 0;
        if (r.blocked.x) rt.state.vars['blocked.x'] = (rt.state.vars['blocked.x'] || 0) + 1;
      }
    });
  },
};
const make = (doc = flat(), extra = []) => compile(doc, { primitives: PRIMITIVES, extra });

spaceConformance(test, assert, { name: 'engine.space.mesh3d', primitives: PRIMITIVES, doc: () => flat(), free: [100, 10.9, 100], other: [120, 10.9, 110] });

test('mesh3d: preflight rejects zones without shapes and bad sizes with stable codes', () => {
  const codes = (w, zones) => { const d = flat(w); if (zones) d.spaces[0].zones = zones; try { make(d); return []; } catch (e) { return e.errors.map(x => x.code); } };
  assert.ok(codes({}, [{ id: 'nowhere' }]).includes('zone_shape_missing'));
  assert.ok(codes({}, [{ id: 'dot', center: [1, 1] }]).includes('zone_shape_invalid'));
  assert.ok(codes({ size: [32, 256] }).includes('param_range'));
  assert.ok(codes({ heightRes: 'x' }).includes('param_type'));
  assert.deepEqual(codes({}), []);
});

test('mesh3d: [x, z] positions stand on the ground; surface, bounds and heightfield tiles', () => {
  const { rt } = make();
  const api = rt.space('land'), p = rt.player();
  assert.equal(api.anchor, 'center');
  assert.deepEqual(p.at, [100, 10.9, 100]);
  assert.equal(api.groundAt(5, 5).y, 10);
  assert.deepEqual(api.groundAt(5, 5).normal, [0, 1, 0]);
  assert.equal(api.slopeAt(5, 5), 0);
  assert.equal(api.waterDepthAt(5, 5), 0);
  assert.deepEqual(api.bounds(), { min: [0, 10, 0], max: [256, 10, 256] });
  assert.equal(api.inBounds([300, 0, 3]), false);
  const t = api.heightTile(0, 0);
  assert.deepEqual(t.n, [65, 65]); assert.equal(t.heights[0], 10); assert.equal(api.heightSample(3, 4), 10);
  assert.equal(rt.service('surface').groundAt(1, 1).y, 10);
});

test('mesh3d: runtime colliders block, slide and support bodies through rt.step', () => {
  const doc = flat(); doc.systems = [{ use: 'gameplay.test.worlds3d-faller' }]; doc.player.at = [100, 15, 100];
  const { rt } = make(doc, [faller]);
  const api = rt.space('land'), p = rt.player();
  run(rt, 80);
  assert.ok(Math.abs(bodyBox(p, api).min[1] - 10) < 1e-6, `landed: ${p.at}`);
  assert.equal(p.components.body.grounded, true);
  // A 3 m wall across +x (rotated 0) at x = 104.
  const wall = api.addObject({ kind: 'wall', shape: 'box', at: [104, 10, 100], size: [1, 3, 10], rot: 0 }, rt);
  assert.equal(rt.state.counts.object_added, 1);
  run(rt, 60, { axes: { move: [1, 0] } });
  assert.ok(Math.abs(p.at[0] - (103.5 - 0.3)) < 0.01, `stopped at the wall: ${p.at[0]}`);
  assert.ok(rt.state.vars['blocked.x'] > 0);
  // Diagonal input slides along the wall face.
  const z0 = p.at[2]; run(rt, 30, { axes: { move: [1, 1] } });
  assert.ok(p.at[2] > z0 + 1 && p.at[0] < 103.3);
  // A low crate (0.3 m) is stepped onto; a cylinder pillar is walked around by the path finder.
  api.removeObject(wall, rt);
  api.addObject({ id: 'crate', kind: 'crate', shape: 'box', at: [106, 10, p.at[2]], size: [2, 0.3, 2], rot: 0.4 }, rt);
  run(rt, 40, { axes: { move: [1, 0] } });
  assert.ok(p.at[0] > 105 && bodyBox(p, api).min[1] > 10.1, `on the crate: ${p.at}`);
  assert.ok(api.objects().some(o => o.id === 'crate'));
  assert.equal(api.objects().some(o => o.id === wall), false, 'removed');
});

test('mesh3d: raycasts hit terrain, oriented boxes, cylinders and entities', () => {
  const { rt } = make();
  const api = rt.space('land');
  const down = api.raycast([50, 20, 50], [0, -1, 0], 50);
  assert.equal(down.hit, 'terrain'); assert.ok(Math.abs(down.dist - 10) < 1e-3); assert.deepEqual(down.normal, [0, 1, 0]);
  api.addObject({ id: 'slab', shape: 'box', at: [60, 10, 50], size: [2, 4, 2], rot: Math.PI / 4 }, rt);
  const box = api.raycast([50, 12, 50], [1, 0, 0], 50);
  assert.equal(box.hit, 'object'); assert.equal(box.id, 'slab');
  assert.ok(Math.abs(box.dist - (10 - Math.SQRT2)) < 1e-6, `diamond corner at ${box.dist}`);
  api.addObject({ id: 'post', shape: 'cylinder', at: [50, 10, 60], r: 1, h: 5 }, rt);
  const cyl = api.raycast([50, 12, 50], [0, 0, 1], 50);
  assert.equal(cyl.id, 'post'); assert.ok(Math.abs(cyl.dist - 9) < 1e-6); assert.deepEqual(cyl.normal.map(v => Math.round(v)), [0, 0, -1]);
  const top = api.raycast([50, 20, 60], [0, -1, 0], 50);
  assert.equal(top.id, 'post'); assert.ok(Math.abs(top.dist - 5) < 1e-6);
  const ball = rt.spawn('ball', { at: [50, 12, 55] });
  assert.equal(api.raycast([50, 12, 50], [0, 0, 1], 50).id, ball.id);
  assert.equal(api.raycast([50, 12, 50], [0, 0, 1], 50, { entities: false }).id, 'post');
  assert.deepEqual(api.overlap({ kind: 'circle', at: [50, 0, 55], r: 0.6 }), [ball.id]);
});

test('mesh3d: grid A* routes around colliders; reachable keys, zones and canReach', () => {
  const { rt } = make();
  const api = rt.space('land');
  for (let z = 80; z <= 120; z += 2) api.addObject({ id: `w${z}`, shape: 'box', at: [110, 10, z], size: [1, 4, 2], rot: 0 }, rt);
  const route = api.path([100, 10.9, 100], [120, 10.9, 100], { cell: 1 });
  assert.ok(route && route.length > 2, 'detour');
  assert.ok(route.some(q => q[2] < 80 || q[2] > 120), 'goes round the wall end');
  assert.ok(route.every(q => Math.abs(q[1] - 10.9) < 1e-9), 'waypoints are body centres on the ground');
  assert.deepEqual(route.at(-1), [120, 10.9, 100]);
  // Enclose a box: unreachable inside.
  for (const [x, z, w, d] of [[30, 20, 21, 1], [30, 40, 21, 1], [20, 30, 1, 21], [40, 30, 1, 21]]) api.addObject({ shape: 'box', at: [x, 10, z], size: [w, 5, d], rot: 0 }, rt);
  assert.equal(api.path([100, 10.9, 100], [30, 10.9, 30], { cell: 1 }), null);
  const set = api.reachable(rt.player().at, rt, {});
  assert.ok(set.has('meadow') && set.has('hall') && set.has('yard'));
  assert.ok(set.has(api.cellOf(rt.player())));
  assert.equal(api.zoneAt(api.cellOf([64, 0, 64])), 'meadow');
  assert.ok(api.canReach(rt.player().at, 'yard', rt, {}));
  assert.ok(api.canReach([100, 0, 100], [200, 0, 30], rt, {}));
  // A tall, steep mound blocks walkers but not climbers.
  assert.equal(api.distance([0, 0, 0], [3, 0, 4]), 5);
});

test('mesh3d: zones (circle, bounds, polygon) and teleport into a bounded zone', () => {
  const { rt } = make();
  rt.run([{ do: 'teleport', zone: 'hall' }]);
  assert.ok(rt.test({ zone: 'hall' }));
  rt.run([{ do: 'teleport', zone: 'yard' }]);
  assert.ok(rt.test({ zone: 'yard' }));
  assert.equal(rt.player().zone, 'yard');
  rt.run([{ do: 'teleport', at: [64, 10.9, 64] }]);
  assert.ok(rt.test({ zone: 'meadow' }));
  assert.ok(rt.state.counts['enter_zone:meadow'] >= 1 && rt.state.counts['leave_zone'] >= 2);
});

test('mesh3d: object overlay is state; snapshots restore and replay', () => {
  const { rt } = make();
  const api = rt.space('land');
  const snap = rt.snapshot();
  api.addObject({ id: 'tent', shape: 'box', at: [10, 30], size: [2, 2, 2] }, rt);
  assert.deepEqual(api.objects().find(o => o.id === 'tent').at, [10, 10, 30]);
  rt.step(); const after = rt.snapshot();
  rt.restore(snap); assert.equal(api.objects().length, 0);
  api.addObject({ id: 'tent', shape: 'box', at: [10, 30], size: [2, 2, 2] }, rt); rt.step();
  assert.deepEqual(rt.snapshot(), after);
});
