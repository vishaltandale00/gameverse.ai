// Built-world generators on mesh3d and voxel: roads, city, structures, scatter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../v2/kernel/testing.js';
import { PRIMITIVES, catalogue } from '../v2/primitives/index.js';
import { preflight } from '../v2/kernel/document.js';
import { footprintsOverlap } from '../v2/primitives/engine/worlds3d-lib-prefab.js';

// Two islands (land zones) in a shallow sea, a city on the west one, a keep and huts on the east.
const harbor = (over = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'harbor', title: 'Harbor', seed: 3,
  spaces: [{
    id: 'sea', use: 'engine.space.mesh3d', with: { size: [512, 512], heightRes: 2 },
    zones: [{ id: 'west', center: [110, 256], r: 80, tags: ['start'] }, { id: 'east', center: [400, 256], r: 70 }, { id: 'reef', center: [256, 60], r: 30 }],
    generators: [
      { use: 'engine.generate.terrain.noise', with: { octaves: 3, scale: 64, amplitude: 1, landBias: -2, land: ['west', 'east', 'reef'], landHeight: 2 } },
      { use: 'engine.generate.water', with: { level: 0 } },
      { use: 'engine.generate.city', with: { districts: [{ zone: 'west', density: 0.8, floors: [2, 6], style: 'brick', grid: 'regular', landmarks: ['clocktower', 'market'] }], block: [36, 36], roadWidth: 8, sidewalk: 2, interiors: false, streetProps: ['lamp', 'bench'], ...over.city } },
      { use: 'engine.generate.roads', with: { links: [{ from: 'west', to: 'east', width: 7, surface: 'asphalt', curviness: 0.2, bridge: true }, { from: 'east', to: 'reef', width: 4, surface: 'gravel', bridge: false, lanes: 1 }], ...over.roads } },
      { use: 'engine.generate.structures', with: { place: [{ id: 'keep', kind: 'house', zone: 'east', at: [400, 256], size: [14, 12], floors: [2, 2], style: 'stone', interior: true, spawns: ['guard', 'guard'], tags: ['keep'] }, { id: 'huts', kind: 'hut', zone: 'east', count: [3, 3], style: 'thatch' }, { id: 'shrine', kind: 'shrine', zone: 'reef', at: [256, 60] }], ...over.structures } },
      { use: 'engine.generate.scatter', with: { props: [{ model: 'tree', per100m2: 1.5, zones: ['east'], minSpacing: 5, clump: 0.3, slopeMax: 30, collide: true, scale: [0.8, 1.2] }], ...over.scatter } },
    ],
  }],
  systems: [], content: { models: { tree: {}, lamp: {} }, archetypes: [{ id: 'hero', components: {} }, { id: 'guard', components: {} }] },
  player: { archetype: 'hero', space: 'sea' },
});
const make = doc => compile(doc, { primitives: PRIMITIVES });
const { registry, logic } = catalogue();
const codes = doc => preflight(doc, registry, logic).errors.map(e => e.code);

test('settlements: preflight rejects bad roads, districts, structures and props with stable codes', () => {
  assert.deepEqual(codes(harbor()), []);
  assert.ok(codes(harbor({ roads: { links: [{ from: 'west', to: 'west' }] } })).includes('road_link_self'));
  assert.ok(codes(harbor({ roads: { links: [{ from: 'west', to: 'mars' }] } })).includes('ref_unknown'));
  assert.ok(codes(harbor({ city: { districts: [{ zone: 'west', floors: [9, 2] }] } })).includes('range_reversed'));
  assert.ok(codes(harbor({ city: { districts: [{ zone: 'west', grid: 'hex' }] } })).includes('param_option'));
  assert.ok(codes(harbor({ structures: { place: [{ id: 'x', kind: 'castle', zone: 'east', at: [1, 1] }] } })).includes('param_option'));
  assert.ok(codes(harbor({ structures: { place: [{ id: 'x', kind: 'hut', zone: 'east' }] } })).includes('structure_position_missing'));
  assert.ok(codes(harbor({ structures: { place: [{ id: 'x', kind: 'hut', zone: 'east', at: [1, 1], count: [1, 2] }] } })).includes('structure_position_ambiguous'));
  assert.ok(codes(harbor({ structures: { place: [{ id: 'x', kind: 'hut', zone: 'east', at: [1, 1] }, { id: 'x', kind: 'hut', zone: 'east', at: [2, 2] }] } })).includes('structure_duplicate'));
  assert.ok(codes(harbor({ structures: { place: [{ id: 'x', kind: 'hut', zone: 'east', at: [1, 1], spawns: ['dragon'] }] } })).includes('ref_unknown'));
  assert.ok(codes(harbor({ scatter: { props: [{ per100m2: 1 }] } })).includes('scatter_prop_kind'));
  assert.ok(codes(harbor({ scatter: { props: [{ model: 'boulder' }] } })).includes('ref_unknown'));
});

test('settlements: roads route across the sea on bridges, split at crossings and carry lanes', () => {
  const { rt } = make(harbor());
  const rg = rt.service('roadgraph'), g = rg(), api = rt.space('sea');
  const link = g.edges.filter(e => e.kind === 'road');
  assert.ok(link.length >= 1);
  assert.ok(link.some(e => e.bridge.some(Boolean)), 'the west-east road bridges the sea');
  assert.ok(api.objects().some(o => o.kind === 'bridge' && o.role === 'deck'), 'bridge decks are colliders');
  const deck = api.objects().find(o => o.kind === 'bridge' && o.role === 'deck');
  assert.equal(api.raycast([deck.at[0], 30, deck.at[2]], [0, -1, 0], 60).hit, 'object', 'you can stand on a bridge deck');
  // Endpoints snap to the district's street grid.
  const westEnd = g.edges.find(e => e.kind === 'road' && (rg.node(e.from).zone === 'west' || rg.node(e.to).zone === 'west'));
  assert.ok(westEnd && [rg.node(westEnd.from).kind, rg.node(westEnd.to).kind].includes('street'));
  // Lanes: right-hand traffic, points ordered in travel direction.
  const e = link[0], [f, b] = e.lanes;
  assert.equal(f.dir, 1); assert.equal(b.dir, -1); assert.ok(f.offset < 0 && b.offset > 0);
  assert.ok(Math.hypot(f.points[0][0] - e.points[0][0], f.points[0][2] - e.points[0][2]) < e.width);
  assert.equal(b.from, e.to);
  assert.ok(g.nodes.some(n => n.light), 'signalised junctions in the city grid');
  const route = rg.route([110, 0, 256], [400, 0, 256]);
  assert.ok(route && route.points.length > 3 && route.length > 250);
  assert.ok(rg.lanesFrom(route.nodes[0]).length > 0);
  assert.ok(rg.nearest([200, 0, 256], 100).dist < 100);
  // The bridge-less link to the reef cannot be routed through water: reported, laid straight, flagged wet.
  const problems = rt.state.spaces.sea.generated.problems.map(p => p.code);
  assert.ok(problems.includes('road_unroutable') || problems.includes('road_wet'));
  // Roads set the ground material.
  const mid = link[0].points[2];
  assert.equal(api.groundAt(mid[0], mid[2]).material, 'asphalt');
});

test('settlements: city districts level the ground into lots, buildings and landmarks; lotAt answers', () => {
  const { rt } = make(harbor());
  const api = rt.space('sea'), lots = rt.service('lotAt').lots('west');
  assert.ok(lots.length > 8, `${lots.length} lots`);
  const built = lots.filter(l => l.building);
  assert.ok(built.length > 5 && built.every(l => l.building.floors >= 2 && l.building.floors <= 6));
  assert.deepEqual(built.filter(l => l.building.landmark).map(l => l.building.landmark).sort(), ['clocktower', 'market']);
  const l = built[0];
  assert.equal(rt.service('lotAt')(l.center[0], l.center[1]).id, l.id);
  assert.equal(rt.service('lotAt')(400, 256), null);
  const parts = api.objects().filter(o => o.group === l.building.id);
  assert.ok(parts.some(o => o.role === 'wall' && o.shape === 'box'));
  assert.ok(Math.abs(api.groundAt(l.center[0] + 0.1, l.center[1]).y - l.y) < 1e-6, 'levelled plaza');
  assert.ok(rt.service('lotAt').props().some(p => p.prop === 'bench'), 'street props are listed');
  assert.ok(api.objects().some(o => o.prop === 'lamp' && o.model === 'lamp'));
  // Buildings are solid: a ray at head height into one stops at its wall.
  const b = parts.find(o => o.role === 'wall');
  assert.equal(api.raycast([b.at[0] - 40, b.at[1] + 1.5, b.at[2]], [1, 0, 0], 80, { entities: false }).hit, 'object');
});

test('settlements: structures are placed, levelled, enterable and spawn occupants at game start', () => {
  const { rt } = make(harbor());
  const api = rt.space('sea'), s = rt.service('structures');
  const keep = s.get('keep');
  assert.equal(keep.interior, true); assert.ok(keep.door && keep.rooms.length === 2);
  assert.equal(s.tagged('keep')[0].id, 'keep');
  assert.equal(s.at(400, 256).id, 'keep');
  const huts = s().filter(x => x.group === 'huts');
  assert.equal(huts.length, 3);
  for (let i = 0; i < huts.length; i++) for (let j = i + 1; j < huts.length; j++) assert.equal(footprintsOverlap({ at: huts[i].at, rot: huts[i].rot, w: huts[i].size[0], d: huts[i].size[1] }, { at: huts[j].at, rot: huts[j].rot, w: huts[j].size[0], d: huts[j].size[1] }), false);
  const guards = Object.values(rt.state.entities).filter(e => e.archetype === 'guard');
  assert.equal(guards.length, 2);
  assert.ok(guards.every(gd => rt.test({ zone: 'east', who: gd.id })));
  // Through the door into the ground-floor room.
  const room = keep.rooms[0], inside = [(room.min[0] + room.max[0]) / 2, room.min[1], (room.min[2] + room.max[2]) / 2];
  const out = [keep.door[0] + Math.sin(keep.rot) * 6, 0, keep.door[2] + Math.cos(keep.rot) * 6];
  assert.ok(api.path(api.standAt([out[0], api.groundAt(out[0], out[2]).y, out[2]]), api.standAt(inside), { cell: 0.5 }), 'the keep can be entered through its door');
  const blockedWall = api.raycast([keep.at[0] - 20, keep.at[1] + 1.2, keep.at[2]], [1, 0, 0], 40, { entities: false });
  assert.equal(blockedWall.hit, 'object');
  // Second run: same structures (deterministic), and the snapshot is small.
  const again = make(harbor()).rt;
  assert.deepEqual(again.service('structures')(), s());
  assert.ok(JSON.stringify(rt.snapshot().spaces).length < 4000);
});

test('settlements: scatter keeps exact spacing, filters, avoids buildings and is tile independent', () => {
  const { rt } = make(harbor());
  const api = rt.space('sea');
  const region = { min: [300, 160], max: [500, 360] };
  const trees = api.objects(region).filter(o => o.model === 'tree');
  assert.ok(trees.length > 30, `${trees.length} trees`);
  for (let i = 0; i < trees.length; i++) for (let j = i + 1; j < trees.length; j++) assert.ok(Math.hypot(trees[i].at[0] - trees[j].at[0], trees[i].at[2] - trees[j].at[2]) >= 5 - 1e-9);
  assert.ok(trees.every(t => Math.hypot(t.at[0] - 400, t.at[2] - 256) <= 70), 'only inside the east zone');
  for (const st of rt.service('structures')().filter(x => x.zone === 'east')) assert.ok(trees.every(t => Math.hypot(t.at[0] - st.at[0], t.at[2] - st.at[2]) > Math.hypot(st.size[0], st.size[1]) / 2), `no tree inside ${st.id}`);
  // Two overlapping queries agree on their overlap (lazy tiles are pure).
  const inA = o => o.at[0] >= 350 && o.at[0] <= 420 && o.at[2] >= 200 && o.at[2] <= 300;
  const a = make(harbor()).rt.space('sea').objects({ min: [350, 200], max: [420, 300] }).filter(o => o.model === 'tree' && inA(o)).map(o => o.id).sort();
  const b = trees.filter(inA).map(o => o.id).sort();
  assert.deepEqual(a, b);
  // Colliding props block slides.
  const t = trees[0];
  assert.equal(api.raycast([t.at[0] - 5, t.at[1] + 0.5, t.at[2]], [1, 0, 0], 10, { entities: false, terrain: false }).id, t.id);
});

// Voxel town: the same generators stamp cells.
const town = () => ({
  schema: 'gameverse.v2.game/0.2', id: 'town', title: 'Town', seed: 4,
  spaces: [{
    id: 'town', use: 'engine.space.voxel', with: { chunk: [16, 64, 16], height: 128, seaLevel: 10 },
    zones: [{ id: 'center', bounds: { min: [-60, 0, -60], max: [60, 128, 60] }, tags: ['start'] }, { id: 'fields', bounds: { min: [100, 0, -40], max: [180, 128, 40] } }],
    generators: [
      { use: 'engine.generate.terrain.noise', with: { octaves: 3, scale: 128, amplitude: 4, seaLevel: 10, landBias: 1 } },
      { use: 'engine.generate.city', with: { districts: [{ zone: 'center', density: 0.9, floors: [1, 3], style: 'brick', grid: 'organic', landmarks: ['hall'] }], block: [32, 32], roadWidth: 6, sidewalk: 1, interiors: true, streetProps: ['lamp'] } },
      { use: 'engine.generate.roads', with: { links: [{ from: 'center', to: 'fields', width: 5, surface: 'gravel' }] } },
      { use: 'engine.generate.structures', with: { place: [{ id: 'barn', kind: 'house', zone: 'fields', at: [140, 0], size: [10, 8], floors: [1, 1], style: 'timber', interior: true }] } },
      { use: 'engine.generate.scatter', with: { props: [{ block: 'log', shape: 'tree', crown: 'leaves', per100m2: 2, zones: ['fields'], minSpacing: 4 }] } },
    ],
  }],
  systems: [], content: { blocks: ['bedrock', 'stone', 'dirt', 'grass', 'sand', 'gravel', 'water', 'planks', 'brick', 'glass', 'log', 'leaves', 'cobblestone', 'asphalt', 'concrete', 'road_line', 'lamp', 'ladder'].map(id => ({ id, solid: !['water', 'ladder'].includes(id), transparent: ['glass', 'leaves'].includes(id) })), archetypes: [{ id: 'hero', components: {} }] },
  player: { archetype: 'hero', space: 'town' },
});

test('settlements: voxel cities, roads, structures and trees become cells', () => {
  assert.deepEqual(codes(town()), []);
  const { rt } = make(town());
  const api = rt.space('town'), count = {};
  for (const k of api.chunksNear([0, 0, 0], 3)) { const ch = api.chunkCells(...k); for (const v of ch.cells) if (v) count[ch.palette[v]] = (count[ch.palette[v]] || 0) + 1; }
  for (const b of ['brick', 'glass', 'asphalt', 'concrete', 'planks', 'ladder']) assert.ok(count[b] > 0, `${b} cells: ${count[b]}`);
  // The barn is enterable on foot through its door.
  const barn = rt.service('structures').get('barn');
  const door = barn.door, out = [door[0] + Math.sin(barn.rot) * 4, 0, door[2] + Math.cos(barn.rot) * 4];
  const room = barn.rooms[0], inside = [(room.min[0] + room.max[0]) / 2, room.min[1], (room.min[2] + room.max[2]) / 2];
  assert.ok(api.path(api.standAt([out[0], api.groundAt(out[0], out[2]).y, out[2]]), api.standAt(inside), { maxNodes: 40000 }), 'walk into the barn');
  // Trees in the fields: trunks with leaf crowns.
  let logs = 0, leaves = 0;
  for (const k of api.chunksNear([140, 0, 0], 2)) { const ch = api.chunkCells(...k); for (const v of ch.cells) { if (ch.palette[v] === 'log') logs++; if (ch.palette[v] === 'leaves') leaves++; } }
  assert.ok(logs > 20 && leaves > logs, `${logs} log / ${leaves} leaves`);
  // Roads pave the surface; lots and street lamps are listed.
  const e = rt.service('roadgraph')().edges.find(x => x.kind === 'road'), p = e.points[Math.floor(e.points.length / 2)];
  assert.ok(['gravel', 'planks'].includes(api.groundAt(p[0], p[2]).material), `road surface: ${api.groundAt(p[0], p[2]).material}`);
  assert.ok(rt.service('lotAt').lots().some(l => l.building?.landmark === 'hall'));
  assert.ok(api.objects({ min: [-60, -60], max: [60, 60] }).some(o => o.prop === 'lamp'));
});
