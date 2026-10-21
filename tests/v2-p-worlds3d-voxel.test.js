import test from 'node:test';
import assert from 'node:assert/strict';
import { spaceConformance, compile, run, bodyBox } from '../v2/kernel/testing.js';
import { PRIMITIVES } from '../v2/primitives/index.js';

// Flat stone ground (cells y < 4), 64 cells tall; a yard zone and a high loft zone.
const flat = (withExtra = {}, extra = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'vox', title: 'Voxel', seed: 7,
  spaces: [{ id: 'world', use: 'engine.space.voxel', with: { chunk: [16, 32, 16], height: 64, ground: 4, ...withExtra }, zones: [{ id: 'yard', bounds: { min: [0, 0, 0], max: [8, 64, 8] } }, { id: 'loft', bounds: { min: [40, 10, 40], max: [44, 14, 44] } }] }],
  systems: [],
  content: { blocks: [{ id: 'stone', solid: true }, { id: 'water', solid: false, transparent: true }, { id: 'ladder', solid: false, tags: ['climbable'] }, { id: 'lamp', solid: true, light: 14 }], archetypes: [{ id: 'hero', components: {} }, { id: 'crate', components: { body: { size: [1, 1, 1] } } }] },
  player: { archetype: 'hero', at: [20.5, 4.9, 20.5] },
  ...extra,
});

/** Test-only physics: gravity plus move axes through the space's collide-and-slide. */
const faller = {
  id: 'gameplay.test.worlds3d-faller',
  card: { intent: 'test helper: integrate gravity and walking through slide', requires: { capabilities: ['gravity'] } },
  install(rt) {
    rt.system('physics', rt => {
      for (const e of Object.values(rt.state.entities)) {
        const api = rt.space(e.space), b = e.components.body; if (!b || !api.slide) continue;
        b.vel[1] += api.gravityAt(e.at)[1] * rt.dt;
        const mv = e.id === 'player' ? rt.input.axes?.move || [0, 0] : [0, 0];
        const r = api.slide(e, [mv[0] * 4 * rt.dt, b.vel[1] * rt.dt, mv[1] * 4 * rt.dt], rt);
        if (r.blocked.y) b.vel[1] = 0;
        rt.state.vars[`blocked.${e.id}`] = (r.blocked.x ? 1 : 0) + (r.blocked.z ? 2 : 0);
      }
    });
  },
};
const make = (doc = flat(), extra = []) => compile(doc, { primitives: PRIMITIVES, extra });

spaceConformance(test, assert, { name: 'engine.space.voxel', primitives: PRIMITIVES, doc: () => flat(), free: [20.5, 4.9, 20.5], other: [24.5, 4.9, 22.5], solid: [20.5, 2, 20.5], block: 'stone' });

test('voxel: preflight rejects bad chunking and ranges with stable codes', () => {
  const codes = w => { try { make(flat(w)); return []; } catch (e) { return e.errors.map(x => x.code); } };
  assert.ok(codes({ height: 72 }).includes('voxel_height_chunk'));
  assert.ok(codes({ seaLevel: 64 }).includes('voxel_level_range'));
  assert.ok(codes({ chunk: [16, 32] }).includes('param_range'));
  assert.ok(codes({ lightModel: 'rtx' }).includes('param_option'));
  assert.deepEqual(codes({}), []);
});

test('voxel: centre anchor, body defaults, ground and surface queries', () => {
  const { rt } = make();
  const api = rt.space('world'), p = rt.player();
  assert.equal(api.anchor, 'center');
  assert.deepEqual(p.components.body.size, [0.6, 1.8, 0.6]);
  assert.deepEqual(bodyBox(p, api).min.map(v => +v.toFixed(3)), [20.2, 4, 20.2]);
  assert.equal(api.groundAt(5, 5).y, 4);
  assert.equal(api.groundAt(5, 5).material, 'stone');
  assert.equal(api.slopeAt(5, 5), 0);
  assert.equal(rt.service('surface').groundAt(5, 5).y, 4);
  // Spawned inside the ground: lifted out.
  const e = rt.spawn('hero', { at: [3.5, 2, 3.5] });
  assert.ok(bodyBox(e, api).min[1] >= 4 - 1e-9);
  // [x, z] stands on the surface.
  api.setPos(e, [6.5, 6.5], rt);
  assert.deepEqual(e.at, [6.5, 4.9, 6.5]);
  assert.deepEqual(api.standAt([1, 4, 1]), [1, 4.9, 1]);
});

test('voxel: gravity and collide-and-slide through rt.step (fall, land, wall, step-up)', () => {
  const doc = flat(); doc.player.at = [20.5, 12, 20.5]; doc.systems = [{ use: 'gameplay.test.worlds3d-faller' }];
  const { rt } = make(doc, [faller]);
  const api = rt.space('world');
  run(rt, 90);
  const p = rt.player();
  assert.ok(Math.abs(bodyBox(p, api).min[1] - 4) < 1e-6, `landed at ${p.at}`);
  assert.equal(api.grounded(p), true);
  assert.equal(p.components.body.grounded, true);
  // Wall two cells high at x = 23: walking +x stops flush against it.
  api.fill([[23, 4, 18], [23, 5, 23]], 'stone', rt);
  run(rt, 60, { axes: { move: [1, 0] } });
  assert.ok(Math.abs(p.at[0] - (23 - 0.3 - 1e-4)) < 1e-3, `flush at ${p.at[0]}`);
  assert.equal(rt.state.vars['blocked.player'] & 1, 1);
  // With a step height of 1 m it climbs a single-cell ledge instead.
  api.fill([[23, 5, 18], [23, 5, 23]], null, rt); api.fill([[24, 4, 18], [30, 4, 23]], 'stone', rt); // a wide one-cell ledge
  p.components.body.step = 1;
  run(rt, 40, { axes: { move: [1, 0] } });
  assert.ok(p.at[0] > 23.5 && Math.abs(bodyBox(p, api).min[1] - 5) < 1e-6, `stepped onto the ledge: ${p.at}`);
});

test('voxel: cell edits via setCell, fill, cellsIn, edit log, cell predicate and cell_changed events', () => {
  const { rt } = make();
  const api = rt.space('world');
  assert.equal(api.getCell([1, 3, 1]), 'stone');
  assert.equal(api.setCell([1, 3, 1], null, rt, 'player'), true);
  assert.equal(api.setCell([1, 3, 1], null, rt), false, 'no-op edit is refused');
  assert.equal(api.getCell([1.9, 3.5, 1.2]), null);
  assert.equal(api.fill([[0, 4, 0], [1, 4, 1]], 'stone', rt), 4);
  assert.equal(api.cellsIn([[0, 4, 0], [3, 4, 3]]).length, 4);
  assert.equal(api.editLog().length, 5);
  assert.deepEqual(api.editLog()[0], { t: 0, at: [1, 3, 1], from: 'stone', to: null, by: 'player' });
  assert.equal(rt.state.counts.cell_changed, 5);
  assert.ok(rt.test({ cell: [0, 4, 0], block: 'stone' }));
  assert.ok(rt.test({ cell: [1, 3, 1], block: null }));
  // Only edits are stored: generated cells are not.
  assert.equal(Object.keys(rt.state.spaces.world.edits).length, 5);
  assert.equal(api.setCell([0, 64, 0], 'stone', rt), false, 'outside the world height');
});

test('voxel: lazy chunks are deterministic, order independent and survive cache eviction', () => {
  const a = make(flat({ cacheChunks: 16 })).rt, b = make(flat({ cacheChunks: 16 })).rt;
  const A = a.space('world'), B = b.space('world');
  A.setCell([5, 4, 5], 'lamp', a); B.setCell([5, 4, 5], 'lamp', b);
  const list = A.chunksNear([0, 0, 0], 3);
  const ca = list.map(c => Array.from(A.chunkCells(...c).cells).join(''));
  const cb = [...list].reverse().map(c => Array.from(B.chunkCells(...c).cells).join('')).reverse();
  assert.deepEqual(ca, cb);
  assert.ok(A.loadedChunks() <= 16, 'cache bounded');
  const c0 = A.chunkCells(0, 0, 0);
  assert.equal(c0.palette[c0.cells[5 + 16 * (5 + 16 * 4)]], 'lamp', 'edit survives eviction');
  assert.deepEqual(A.chunkOf([17, 40, -1]), [1, 1, -1]);
});

test('voxel: DDA raycast hits cells and entities with face normals', () => {
  const { rt } = make();
  const api = rt.space('world');
  const down = api.raycast([10.5, 10, 10.5], [0, -1, 0], 20);
  assert.equal(down.hit, 'cell'); assert.deepEqual(down.cell, [10, 3, 10]); assert.deepEqual(down.normal, [0, 1, 0]);
  assert.ok(Math.abs(down.dist - 6) < 1e-9);
  api.setCell([14, 4, 10], 'stone', rt);
  const side = api.raycast([10.5, 4.5, 10.5], [1, 0, 0], 20);
  assert.deepEqual(side.cell, [14, 4, 10]); assert.deepEqual(side.normal, [-1, 0, 0]);
  assert.ok(Math.abs(side.dist - 3.5) < 1e-9);
  const crate = rt.spawn('crate', { at: [12.5, 4.5, 10.5] });
  const hitE = api.raycast([10.5, 4.5, 10.5], [1, 0, 0], 20);
  assert.equal(hitE.hit, 'entity'); assert.equal(hitE.id, crate.id); assert.ok(Math.abs(hitE.dist - 1.5) < 1e-9);
  assert.equal(api.raycast([10.5, 4.5, 10.5], [1, 0, 0], 20, { ignore: crate.id }).hit, 'cell');
  assert.equal(api.raycast([10.5, 4.5, 10.5], [1, 0, 0], 1).hit, 'none');
  assert.deepEqual(api.overlap({ kind: 'sphere', at: [12.5, 4.5, 10.5], r: 0.1 }), [crate.id]);
  assert.deepEqual(api.entitiesAt([12.5, 4.2, 10.5]), [crate.id]);
  assert.ok(api.contacts(crate).some(c => c.cell && c.normal[1] === 1), 'touches the floor');
});

test('voxel: 3D A* walks around walls, steps one cell, jumps with the envelope, swims and climbs', () => {
  const { rt } = make();
  const api = rt.space('world');
  api.fill([[24, 4, 10], [24, 7, 30]], 'stone', rt); // wall 4 high
  const route = api.path([20.5, 4.9, 20.5], [28.5, 4.9, 20.5]);
  assert.ok(route, 'route around the wall');
  assert.ok(route.length > 10 && route.every(q => !api.getCell([q[0], q[1] - 0.9, q[2]])), 'waypoints are free body centres');
  assert.deepEqual(route.at(-1), [28.5, 4.9, 20.5]);
  api.setCell([30, 4, 20], 'stone', rt); // one-cell step
  assert.ok(api.path([28.5, 4.9, 20.5], [30.5, 5.9, 20.5]));
  api.fill([[34, 4, 20], [34, 5, 20]], 'stone', rt); // two-cell pillar
  assert.equal(api.path([28.5, 4.9, 20.5], [34.5, 6.9, 20.5]), null);
  assert.ok(api.path([28.5, 4.9, 20.5], [34.5, 6.9, 20.5], { envelope: { jumpHeight: 2 } }));
  // A ladder up the pillar side makes it climbable for everyone.
  api.fill([[33, 4, 20], [33, 6, 20]], 'ladder', rt);
  assert.ok(api.path([28.5, 4.9, 20.5], [34.5, 6.9, 20.5]));
  // A moat of deep water: only swimmers cross.
  const r0 = make().rt, w = r0.space('world');
  w.fill([[0, 1, 0], [60, 3, 60]], null, r0); w.fill([[0, 1, 0], [60, 3, 60]], 'water', r0); w.fill([[0, 0, 0], [60, 0, 60]], 'stone', r0);
  w.fill([[10, 1, 10], [12, 3, 12]], 'stone', r0); // island
  assert.equal(w.path([11.5, 4.9, 11.5], [40.5, 2, 40.5]), null);
  assert.ok(w.path([11.5, 4.9, 11.5], [40.5, 2, 40.5], { abilities: ['swim'] }));
});

test('voxel: reachable returns cellOf keys and zone ids; canReach takes zones; verifier conventions', () => {
  const { rt } = make();
  const api = rt.space('world');
  api.fill([[34, 4, 18], [38, 8, 22]], 'stone', rt); api.fill([[35, 4, 19], [37, 6, 21]], null, rt); // a sealed room
  const set = api.reachable(rt.player().at, rt, { maxNodes: 5000 });
  assert.ok(set.has(api.cellOf(rt.player())), 'the player cell is reachable');
  assert.ok(set.has('yard'), 'zone ids are members');
  assert.equal(set.has('loft'), false);
  assert.equal(api.zoneAt(api.cellOf([3.5, 4, 3.5])), 'yard');
  assert.ok(api.canReach(rt.player().at, 'yard', rt, {}));
  assert.equal(api.canReach(rt.player().at, [36.5, 4.9, 20.5], rt, { maxNodes: 4000 }), false);
  assert.ok(api.canReach(rt.player().at, [32.5, 4.9, 20.5], rt, {}));
  assert.equal(api.inBounds([20, 5, 20]), true);
  assert.equal(api.inBounds([20, 99, 20]), false);
});

test('voxel: zone events for nested zones, teleport to bounded zones, near and distance metrics', () => {
  const { rt } = make();
  const api = rt.space('world');
  rt.step();
  rt.run([{ do: 'teleport', zone: 'yard' }]);
  assert.equal(rt.player().zone, 'yard');
  assert.equal(rt.state.counts['enter_zone:yard'], 1);
  api.fill([[40, 9, 40], [43, 9, 43]], 'stone', rt); // a floor inside the loft
  rt.run([{ do: 'teleport', zone: 'loft' }]);
  assert.ok(rt.test({ zone: 'loft' }), `teleported into the loft: ${rt.player().at}`);
  assert.equal(rt.state.counts.leave_zone, 1);
  assert.ok(rt.test({ near: 'yard', within: 60 }));
  assert.equal(api.distance([0, 0, 0], [3, 4, 0]), 5);
  assert.equal(api.distance([0, 0, 0], [3, 4, 0], 'manhattan'), 7);
  assert.ok(api.distance([1.5, 4.9, 1.5], [6.5, 4.9, 1.5], 'path') >= 5);
});

test('voxel: sky and block light', () => {
  const sky = make(flat({ lightModel: 'sky' })).rt, full = make(flat({ lightModel: 'full' })).rt;
  for (const rt of [sky, full]) rt.space('world').fill([[0, 8, 0], [10, 8, 10]], 'stone', rt);
  assert.equal(sky.space('world').lightAt([20.5, 5, 20.5]), 15);
  assert.ok(sky.space('world').lightAt([5.5, 5, 5.5]) < 15, 'roofed');
  full.space('world').setCell([5, 4, 5], 'lamp', full);
  assert.ok(full.space('world').lightAt([5.5, 5, 6.5]) >= 12, 'lamp lights the room');
  assert.equal(make(flat({ lightModel: 'none' })).rt.space('world').lightAt([5, 5, 5]), 15);
});

test('voxel: fluids flow into dug-out cells and replay deterministically', () => {
  const doc = flat({ fluid: true, flowRange: 3 });
  const go = () => {
    const { rt } = make(structuredClone(doc));
    const api = rt.space('world');
    api.fill([[0, 1, 0], [6, 3, 6]], null, rt); // a pit
    api.setCell([3, 5, 3], 'water', rt); // a source above it
    run(rt, 40);
    return rt;
  };
  const a = go(), b = go();
  assert.ok(a.state.counts.fluid_flow > 5);
  assert.equal(a.space('world').getCell([3, 1, 3]), 'water', 'water fell to the bottom');
  assert.ok(a.space('world').editLog().some(e => e.by === 'fluid'));
  assert.deepEqual(a.snapshot(), b.snapshot());
});

test('voxel: snapshot/restore keeps edits, members and replays', () => {
  const { rt } = make();
  const api = rt.space('world');
  const snap = rt.snapshot();
  api.setCell([9, 4, 9], 'stone', rt); rt.step();
  const after = rt.snapshot();
  rt.restore(snap); assert.equal(api.getCell([9, 4, 9]), null);
  api.setCell([9, 4, 9], 'stone', rt); rt.step();
  assert.deepEqual(rt.snapshot(), after);
  assert.ok(JSON.stringify(after.spaces.world).length < 2000, 'space state holds only seed and edits');
  // Restoring a state that has an edit the cache lacks (and vice versa) patches the cached chunk.
  api.setCell([9, 4, 9], null, rt); api.setCell([1, 2, 1], null, rt);
  assert.equal(api.getCell([9, 4, 9]), null);
  rt.restore(after);
  assert.equal(api.getCell([9, 4, 9]), 'stone'); assert.equal(api.getCell([1, 2, 1]), 'stone');
});
