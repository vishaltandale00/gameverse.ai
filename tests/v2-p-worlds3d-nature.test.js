// Natural-world generators on voxel and mesh3d: terrain.noise, biomes, water, caves, ores.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, run } from '../v2/kernel/testing.js';
import { PRIMITIVES, catalogue } from '../v2/primitives/index.js';
import { preflight, mergePatch } from '../v2/kernel/document.js';

const BLOCKS = ['bedrock', 'stone', 'dirt', 'grass', 'sand', 'gravel', 'snow', 'water', 'lava', 'coal_ore'].map(id => ({ id, solid: !['water', 'lava'].includes(id) }));
const BIOMES = { biomes: [{ id: 'plains', temp: [0.3, 0.7], moist: [0, 0.6], surface: 'grass', sub: 'dirt' }, { id: 'tundra', temp: [0, 0.3], moist: [0, 1], surface: 'snow', sub: 'dirt' }, { id: 'desert', temp: [0.7, 1], moist: [0, 0.4], surface: 'sand', sub: 'sand' }], regions: [{ zone: 'meadow', biome: 'plains', blend: 8 }], blendWidth: 8 };
const isle = (gens = {}, seed = 5) => ({
  schema: 'gameverse.v2.game/0.2', id: 'isle', title: 'Isle', seed,
  spaces: [{
    id: 'isle', use: 'engine.space.voxel', with: { chunk: [16, 64, 16], height: 128, seaLevel: 40 },
    zones: [{ id: 'world', bounds: { min: [-160, 0, -160], max: [160, 128, 160] } }, { id: 'meadow', bounds: { min: [-30, 0, -30], max: [30, 128, 30] }, tags: ['start'] }, { id: 'deep', bounds: { min: [-60, 0, 40], max: [-20, 30, 80] } }],
    generators: [
      { use: 'engine.generate.terrain.noise', with: { octaves: 4, scale: 96, amplitude: 24, falloff: 'island', rivers: 2, erosion: 1, warp: 0.2, grid: 64, land: ['meadow'], ...gens.terrain } },
      { use: 'engine.generate.biomes', with: { ...BIOMES, ...gens.biomes } },
      { use: 'engine.generate.water', with: { lakes: 1, lakeRadius: [8, 12], flow: true, ...gens.water } },
      { use: 'engine.generate.caves', with: { density: 0.5, minY: 4, maxY: 36, worms: 12, caverns: 2, lavaLevel: 8, rooms: [{ zone: 'deep', at: [-40, 14, 60], size: [14, 8] }], ...gens.caves } },
      { use: 'engine.generate.ores', with: { veins: [{ block: 'coal_ore', minY: 4, maxY: 30, size: 8, perChunk: 6 }], ...gens.ores } },
    ],
  }],
  systems: [], content: { blocks: BLOCKS, archetypes: [{ id: 'hero', components: {} }] },
  player: { archetype: 'hero', space: 'isle' },
});
const vale = (seed = 9) => ({
  schema: 'gameverse.v2.game/0.2', id: 'vale', title: 'Vale', seed,
  spaces: [{
    id: 'vale', use: 'engine.space.mesh3d', with: { size: [1024, 1024], heightRes: 4 },
    zones: [{ id: 'town', center: [512, 512], r: 120, tags: ['start'] }, { id: 'peak', center: [800, 300], r: 100 }],
    generators: [
      { use: 'engine.generate.terrain.noise', with: { octaves: 5, scale: 400, amplitude: 120, ridged: 0.4, falloff: 'island', rivers: 3, erosion: 2, grid: 96, land: ['town', 'peak'] } },
      { use: 'engine.generate.biomes', with: { biomes: [{ id: 'meadow', temp: [0.3, 1], moist: [0, 1], surface: 'grass' }, { id: 'snow', temp: [0, 0.3], moist: [0, 1], surface: 'snow' }], regions: [{ zone: 'town', biome: 'meadow', blend: 40 }] } },
      { use: 'engine.generate.water', with: { lakes: 3 } },
    ],
  }],
  systems: [], content: { archetypes: [{ id: 'hero', components: {} }] },
  player: { archetype: 'hero', space: 'vale' },
});
const make = doc => compile(doc, { primitives: PRIMITIVES });
const { registry, logic } = catalogue();
const codes = doc => preflight(doc, registry, logic).errors.map(e => e.code);

test('nature: preflight accepts the worlds and rejects bad generator configs with stable codes', () => {
  assert.deepEqual(codes(isle()), []);
  assert.deepEqual(codes(vale()), []);
  assert.ok(codes(isle({ terrain: { blocks: { surface: 'moss', sub: 'dirt', stone: 'stone', bedrock: 'bedrock', shore: 'sand', underwater: 'gravel' } } })).includes('block_unknown'));
  assert.ok(codes(isle({ terrain: { extent: [10, 10, 0, 0] } })).includes('terrain_extent_invalid'));
  assert.ok(codes(isle({ terrain: { octaves: 12 } })).includes('param_range'));
  assert.ok(codes(isle({ biomes: { regions: [{ zone: 'meadow', biome: 'jungle' }] } })).includes('ref_unknown'));
  assert.ok(codes(isle({ biomes: { regions: [{ zone: 'atlantis', biome: 'plains' }] } })).includes('ref_unknown'));
  assert.ok(codes(isle({ biomes: { biomes: [{ id: 'a', temp: [0.9, 0.1] }, { id: 'a' }] } })).includes('biome_range_invalid'));
  assert.ok(codes(isle({ water: { lakeRadius: [30, 10] } })).includes('param_range'));
  assert.ok(codes(isle({ water: { block: 'goo' } })).includes('block_unknown'));
  assert.ok(codes(isle({ caves: { minY: 50, maxY: 10 } })).includes('param_range'));
  assert.ok(codes(isle({ caves: { lavaBlock: 'magma' } })).includes('block_unknown'));
  assert.ok(codes(isle({ ores: { veins: [{ block: 'mithril' }] } })).includes('ref_unknown'));
  const badPred = isle(); badPred.systems = [{ use: 'plot.storyboard' }]; badPred.plot = { storyboard: { acts: [{ id: 'a', beats: [{ id: 'b', when: { biome: 'swamp' }, do: [] }] }] } };
  assert.ok(codes(badPred).includes('ref_unknown'));
});

test('nature: voxel terrain is deterministic per seed and lazily identical in any order', () => {
  const a = make(isle()).rt, b = make(isle()).rt, c = make(isle({}, 6)).rt;
  const A = a.space('isle'), B = b.space('isle'), Cc = c.space('isle');
  const list = A.chunksNear([0, 0, 0], 2);
  const sig = (api, l) => l.map(k => { const ch = api.chunkCells(...k); let h = 0; for (let i = 0; i < ch.cells.length; i++) h = (h * 31 + (ch.cells[i] ? ch.palette[ch.cells[i]].length + ch.cells[i] : 0)) >>> 0; return h; });
  assert.deepEqual(sig(A, list), sig(B, [...list].reverse()).reverse());
  assert.notDeepEqual(sig(A, list), sig(Cc, list), 'another seed makes another world');
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.ok(a.state.spaces.isle.seed > 0 && a.state.spaces.isle.generated.problems.length >= 0);
});

test('nature: island falloff, land zones, column layers and biome surfaces on voxel', () => {
  const { rt } = make(isle());
  const api = rt.space('isle'), sea = 40;
  assert.ok(api.groundAt(155, 155).y < sea, 'the island edge is under the sea');
  assert.equal(api.getCell([155.5, sea - 1, 155.5]), 'water', 'the sea is filled with water');
  for (const [x, z] of [[0, 0], [20, -20], [-25, 25]]) assert.ok(api.groundAt(x, z).y >= sea + 2, `land zone keeps (${x}, ${z}) dry`);
  const g = api.groundAt(3.5, 3.5);
  assert.equal(api.getCell([3.5, 0.5, 3.5]), 'bedrock');
  assert.equal(rt.service('biomeAt')(3.5, 3.5), 'plains', 'pinned region');
  assert.ok(['grass', 'sand'].includes(g.material), `plains surface: ${g.material}`);
  assert.equal(api.getCell([3.5, g.y - 2.5, 3.5]), 'dirt', 'sub layer under the surface');
  // Every biome in the table is used by the climate somewhere or is pinned; the climate service is bounded.
  const c = rt.service('biomeAt').climate(100, -100);
  assert.ok(c.temp >= 0 && c.temp <= 1 && c.moist >= 0 && c.moist <= 1);
  assert.equal(rt.service('biomeAt').def('tundra').surface, 'snow');
});

test('nature: the biome predicate drives the story through rt.step', () => {
  const doc = isle(); doc.systems = [{ use: 'plot.storyboard' }];
  doc.plot = { storyboard: { acts: [{ id: 'a', beats: [{ id: 'in_plains', when: { biome: 'plains' }, do: [{ do: 'set_flag', flag: 'saw_plains' }] }, { id: 'in_desert', when: { biome: ['desert', 'tundra'] }, do: [{ do: 'set_flag', flag: 'saw_far' }] }] }] } };
  const { rt } = make(doc);
  rt.step();
  assert.equal(rt.state.flags.saw_plains, true);
  assert.equal(rt.state.flags.saw_far, undefined);
});

test('nature: rivers carve channels that hold flowing water; erosion reshapes the land', () => {
  const { rt } = make(isle());
  const rivers = rt.service('waterDepthAt').rivers();
  assert.ok(rivers.length >= 1, 'at least one river reached the sea');
  const r = rivers[0], mid = r.points[Math.floor(r.points.length / 2)];
  const w = rt.service('waterDepthAt');
  assert.ok(w.levelAt(mid[0], mid[2]) != null, 'water surface along the river');
  assert.ok(w(mid[0], mid[2]) > 0, 'the channel is deeper than the bank');
  const f = w.flowAt(mid[0], mid[2]);
  assert.ok(Math.hypot(...f) > 0, 'rivers flow');
  const flat = make(isle({ terrain: { erosion: 0, rivers: 0 } })).rt.space('isle');
  let diff = 0; for (let x = -100; x <= 100; x += 25) for (let z = -100; z <= 100; z += 25) diff += Math.abs(flat.groundAt(x, z).y - rt.space('isle').groundAt(x, z).y);
  assert.ok(diff > 0, 'erosion and rivers changed the surface');
});

test('nature: lakes are carved basins filled to a flat surface', () => {
  const { rt } = make(isle());
  const lakes = rt.service('waterDepthAt').lakes();
  assert.equal(lakes.length, 1);
  const [x, y, z] = lakes[0].at, api = rt.space('isle');
  assert.ok(rt.service('waterDepthAt')(x, z) > 1, 'deep at the centre');
  assert.equal(api.getCell([x, y - 0.5, z]), 'water');
  assert.ok(api.waterDepthAt(x, z) >= 1, 'the space counts water cells too');
});

test('nature: caves carve noise caverns, worms, lava and a reachable pinned room', () => {
  const { rt } = make(isle());
  const api = rt.space('isle'), caves = rt.service('caves');
  const room = caves.rooms()[0];
  assert.equal(room.zone, 'deep');
  assert.equal(api.getCell([-40, 15, 60]), null, 'room is hollow');
  assert.equal(caves(-40, 15, 60), 'room');
  assert.ok(room.entrance, 'the room has a surface entrance');
  // Prove the tunnel: a walker gets from daylight to the room floor.
  const top = api.standAt([room.entrance[0], api.groundAt(room.entrance[0], room.entrance[2]).y, room.entrance[2]]);
  const route = api.path(top, api.standAt([-40, 14, 60]), { maxNodes: 60000, envelope: { dropHeight: 4 } });
  assert.ok(route, 'room reachable on foot from the entrance');
  let air = 0, lava = 0, solid = 0;
  for (let x = -64; x < 64; x += 3) for (let z = -64; z < 64; z += 3) for (let y = 4; y < 34; y += 2) { const b = api.getCell([x + 0.5, y + 0.5, z + 0.5]); if (b === null) air++; else if (b === 'lava') lava++; else solid++; }
  assert.ok(air > 50 && solid > air, `caves hollow part of the underground (${air} air / ${solid} solid)`);
  assert.ok(lava > 0, 'lava below the lava level');
});

test('nature: ore veins replace only stone inside their depth band', () => {
  const { rt } = make(isle({ caves: { density: 0, worms: 0, caverns: 0, rooms: [] } }));
  const api = rt.space('isle');
  let ore = 0;
  for (const k of api.chunksNear([0, 0, 0], 1)) {
    const ch = api.chunkCells(...k);
    for (let i = 0; i < ch.cells.length; i++) if (ch.palette[ch.cells[i]] === 'coal_ore') { ore++; const y = ch.origin[1] + Math.floor(i / (16 * 16)); assert.ok(y >= 4 && y <= 30, `ore at y ${y}`); }
  }
  assert.ok(ore > 40, `${ore} ore cells`);
});

test('nature: mesh3d terrain, biome materials, slopes and water depth', () => {
  const { rt } = make(vale());
  const api = rt.space('vale'), p = rt.player();
  assert.equal(p.zone, 'town');
  assert.ok(api.groundAt(512, 512).y >= 2, 'land zone above the sea');
  assert.ok(api.groundAt(5, 5).y < 0, 'island edge under the sea');
  assert.ok(api.waterDepthAt(5, 5) > 0);
  assert.equal(api.groundAt(512, 512).material, 'grass');
  let maxSlope = 0, hi = -Infinity; for (let x = 100; x < 950; x += 37) for (let z = 100; z < 950; z += 37) { maxSlope = Math.max(maxSlope, api.slopeAt(x, z)); hi = Math.max(hi, api.groundAt(x, z).y); }
  assert.ok(maxSlope > 10 && hi > 30, `relief: slope ${maxSlope}, top ${hi}`);
  const b = make(vale()).rt.space('vale');
  assert.equal(api.heightSample(77, 91), b.heightSample(77, 91), 'deterministic');
  assert.notEqual(api.heightSample(77, 91), make(vale(10)).rt.space('vale').heightSample(77, 91));
  const lakes = rt.service('waterDepthAt').lakes();
  assert.ok(lakes.length >= 1 && rt.service('waterDepthAt')(lakes[0].at[0], lakes[0].at[2]) > 1);
});

test('nature: hot-loaded zones rebuild the world model and keep edits', () => {
  const { rt } = make(isle());
  const api = rt.space('isle');
  api.setCell([2.5, 60.5, 2.5], 'stone', rt);
  const { doc, added } = mergePatch(rt.doc, { spaces: [{ id: 'isle', zones: [{ id: 'cove', bounds: { min: [60, 0, 60], max: [90, 128, 90] } }] }] });
  const checked = preflight(doc, registry, logic);
  assert.ok(checked.ok, JSON.stringify(checked.errors));
  rt.extend(checked.doc, added);
  rt.run([{ do: 'teleport', zone: 'cove' }]);
  assert.ok(rt.test({ zone: 'cove' }));
  assert.equal(api.getCell([2.5, 60.5, 2.5]), 'stone', 'edits survive the rebuild');
  assert.ok(api.groundAt(0, 0).y >= 42, 'terrain regenerates identically');
});
