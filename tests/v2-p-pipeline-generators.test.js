// World generators: static declarations (generator card.spaces / provides.content / provides.extent, space
// card.needs.content, world-scale params), the planner's use of them (generatorsFor, planWorld, selection,
// furnishWorld), extents (fitExtents, extentProblems) and scaleWorld. The playtest agent (verifyDocument) is the
// backstop. Live regressions: a Mario Kart game on engine.space.mesh3d published with zero generators (a void);
// a Pac-Man maze filling a corner of a 64×32 tilemap with its tunnels opening into the rest. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { preflight } from '../v2/kernel/document.js';
import { createWorld } from '../v2/kernel/world.js';
import { buildCatalogue, isGenerator, isSpace } from '../v2/planner/catalog.js';
import { verifyDocument, viability } from '../v2/planner/verify-adapter.js';
import { verify } from '../v2/verify/index.js';
import { hashOf } from '../v2/server/store.js';
import { selectPrimitives, chooseSpaces } from '../v2/planner/select.js';
import {
  generatorsFor, planWorld, spaceNeeds, unfurnishable, configureGenerators, extentProblems, scaleWorld, spaceExtent,
  furnishWorld, addGenerator, contentOf, isEmpty, grows, generationProblems, worldProblems, needSetFor,
} from '../v2/planner/world.js';
import { fakeWriter, decomposition, buildWriter } from './v2-p-pipeline-fixtures.js';

const { registry, logic } = buildCatalogue();
const live = name => { const j = JSON.parse(readFileSync(new URL(`./fixtures/v2-live/${name}`, import.meta.url), 'utf8')); return j.doc || j; };
const CONTENT = ['cells', 'terrain', 'road-network', 'structures', 'course', 'rooms', 'zones', 'entities', 'water', 'props', 'biomes', 'caves', 'ores'];
const EXTENT = ['space', 'own', 'overlay'];
const spaceIds = () => registry.ids('engine').filter(isSpace), generatorIds = () => registry.ids('engine').filter(isGenerator);

test('every generator card declares the spaces it targets, the content it builds and the extent it fills', () => {
  const spaces = new Set(spaceIds());
  for (const id of generatorIds()) {
    const p = registry.get(id), card = p.card;
    assert.ok(Array.isArray(card.spaces) && card.spaces.length, `${id}: card.spaces`);
    for (const s of card.spaces) assert.ok(spaces.has(s), `${id}: ${s} is a registered space`);
    assert.ok(card.provides.content?.length && card.provides.content.every(c => CONTENT.includes(c)), `${id}: provides.content`);
    assert.ok(EXTENT.includes(card.provides.extent), `${id}: provides.extent`);
    if (card.provides.extent === 'own') assert.equal(typeof p.extentOf, 'function', `${id}: an own extent comes with extentOf`);
  }
});

test('every spatial space card declares the world content it needs, and the catalogue can build it', () => {
  for (const id of spaceIds()) {
    if (id === 'engine.space.none') { assert.deepEqual(spaceNeeds(registry, id), []); continue; }
    assert.ok(spaceNeeds(registry, id).length, `${id}: card.needs.content`);
    assert.deepEqual(unfurnishable(registry, id), [], `${id}: a registered generator builds every need`);
  }
});

test('generatorsFor reads only the declarations: graph and none get no 3D or cell generators', () => {
  const fits = use => generatorsFor(registry, { id: 's', use }).map(g => g.id);
  assert.deepEqual(fits('engine.space.graph'), ['engine.generate.graph.world']);
  assert.deepEqual(fits('engine.space.none'), []);
  for (const use of spaceIds()) for (const id of fits(use)) assert.ok(registry.get(id).card.spaces.includes(use), `${id} targets ${use}`);
  for (const id of ['engine.generate.caves', 'engine.generate.terrain.noise', 'engine.generate.water']) assert.ok(!fits('engine.space.graph').includes(id) && !fits('engine.space.tilemap').includes(id));
});

test('planWorld: each space kind gets generators for exactly what it needs', () => {
  const plan = (use, w = {}) => planWorld(registry, { id: 's', use, with: w }, { view: null }).generators;
  assert.deepEqual(plan('engine.space.mesh3d').sort(), ['engine.generate.roads', 'engine.generate.terrain.noise']);
  assert.deepEqual(plan('engine.space.voxel'), ['engine.generate.terrain.noise']);
  assert.deepEqual(plan('engine.space.track'), ['engine.generate.chunks']);
  assert.deepEqual(plan('engine.space.tilemap'), ['engine.generate.tilemap.rooms']);
  // A grid needs cells: the board that builds only cells, not a dungeon's rooms (which an 8×8 board cannot hold anyway).
  assert.deepEqual(plan('engine.space.grid'), ['engine.generate.grid.board']);
  assert.deepEqual(plan('engine.space.grid', { size: [64, 64] }), ['engine.generate.grid.board']);
  assert.deepEqual(plan('engine.space.arena2d'), ['engine.generate.layout.shapes']);
  assert.deepEqual(plan('engine.space.physics2d'), ['engine.generate.layout.shapes']);
  assert.deepEqual(plan('engine.space.graph'), ['engine.generate.graph.world']);
});

// ---------- extents: Pac-Man (local-data/v2/games/pac-man-in-a-haunted-mvhdwip9 v1, v2) ----------
/** Open cells the player reaches (4-neighbour walk over non-solid tiles), and how many are outside the maze's corridors. */
function reach(doc) {
  const pre = preflight(doc, registry, logic); assert.ok(pre.ok, JSON.stringify(pre.errors));
  const rt = createWorld(pre.doc, registry, logic, { seed: doc.seed }); for (let i = 0; i < 3; i++) rt.step();
  const api = rt.space(doc.player.space), maze = rt.service('maze'), [W, H] = api.size, p = rt.player();
  const open = (x, y) => x >= 0 && y >= 0 && x < W && y < H && api.collisionOf(api.getCell([x, y])) !== 'solid';
  const start = [Math.floor(p.at[0]), Math.floor(p.at[1])], seen = new Set([start.join()]), queue = [start];
  let outside = 0;
  while (queue.length) {
    const [x, y] = queue.pop(); if (!maze.isOpen([x, y])) outside++;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = [x + dx, y + dy]; if (open(...n) && !seen.has(n.join())) { seen.add(n.join()); queue.push(n); } }
  }
  return { size: api.size, maze: maze.size(), reachable: seen.size, outside };
}

test('Pac-Man v1: the classic maze in a corner of the 64×32 tilemap is flagged, then fitted: no reachable void', () => {
  const v1 = live('pacman-v1.json');
  assert.deepEqual(extentProblems(v1, registry).map(p => p.code), ['world_extent_mismatch']);
  const before = reach(v1);
  assert.deepEqual(before.maze, [28, 31]);
  assert.ok(before.outside > 1000, 'as published, the player walks out of the maze into the empty map');
  const doc = structuredClone(v1), fixes = configureGenerators(doc, registry);
  assert.deepEqual(fixes.map(f => f.code), ['world_extent_fit']);
  assert.deepEqual(extentProblems(doc, registry), []);
  const after = reach(doc);
  assert.deepEqual(after.maze, [64, 32], 'the maze fills the space');
  assert.equal(after.outside, 0, 'every reachable cell is a maze corridor');
  assert.ok(after.reachable > 500);
});

test('Pac-Man v2 ("Bigger world" set the map to 96×48 only) is fitted too; scaleWorld grows the maze with the map', () => {
  const v2 = structuredClone(live('pacman-v2.json'));
  configureGenerators(v2, registry);
  assert.deepEqual(reach(v2).maze, [96, 48]);
  const v1 = structuredClone(live('pacman-v1.json')); configureGenerators(v1, registry);
  const big = scaleWorld(v1, registry, 1.5);
  assert.deepEqual(big.doc.spaces[0].with.size, [96, 48]);
  assert.deepEqual(big.unscaled, []);
  assert.deepEqual(big.doc.spaces[0].zones.at(-1).rect, [72, 0, 96, 48], 'zones grow with the world');
  const r = reach(big.doc);
  assert.deepEqual(r.maze, [96, 48], 'a bigger maze, not a bigger empty map');
  assert.equal(r.outside, 0);
  assert.ok(r.reachable > reach(v1).reachable * 1.5);
  assert.deepEqual(extentProblems(big.doc, registry), []);
  assert.deepEqual(scaleWorld(v1, registry, 1).doc, v1, 'factor 1 changes nothing');
  assert.deepEqual(spaceExtent(registry, big.doc.spaces[0]), [0, 0, 96, 48]);
});

test('Pac-Man v1 fitted: the playtest agent runs it without a crash', async () => {
  const doc = structuredClone(live('pacman-v1.json')); configureGenerators(doc, registry);
  const v = await verifyDocument(doc, registry, logic, { budgetMs: 300 });
  assert.ok(v.preflight.ok);
  assert.equal(v.viable, true, v.viability);
});

// ---------- minimal documents, one per space kind ----------
const strips = (n, w, h) => Array.from({ length: n }, (_, i) => ({ id: `z${i}`, name: `Zone ${i}`, rect: [i * w, 0, (i + 1) * w, h] }));
const minimal = (space, move, player = {}, { view = 'side', last } = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: `min-${space.use.split('.').pop()}`, title: 'Minimal', seed: 7, views: { primary: view },
  spaces: [{ id: 'main', ...space }],
  systems: [{ use: 'engine.input.actions', with: { verbs: ['move', 'jump'], axes: ['move'] } }, ...move.map(m => ({ space: 'main', ...m })), { use: 'plot.storyboard' }],
  plot: { premise: 'Reach the end.', storyboard: { acts: [{ id: 'a1', beats: [{ id: 'won', when: { zone: last ?? space.zones.at(-1).id }, do: [{ do: 'end_game', ending: 'win' }] }] }] }, endings: [{ id: 'win', title: 'Win', text: 'Done.', outcome: 'won' }] },
  content: { archetypes: [{ id: 'hero', components: { name: 'Hero' } }, { id: 'coin', components: { name: 'Coin' } }, { id: 'crate', components: { name: 'Crate', body: { solid: true } } }] },
  player: { archetype: 'hero', space: 'main', ...player },
});
const platformer = [{ use: 'gameplay.move.platformer', with: { preset: 'runner' } }], walk = [{ use: 'gameplay.move.walk' }];
const box3 = (id, x0, x1) => ({ id, name: id, bounds: { min: [x0, 0, x0], max: [x1, 96, x1] } });
const DOCS = {
  tilemap: () => minimal({ use: 'engine.space.tilemap', with: { size: [48, 16], mode: 'side', gravity: -60 }, zones: strips(3, 16, 16) }, platformer, { at: [2, 2] }),
  tilemapTd: () => minimal({ use: 'engine.space.tilemap', with: { size: [40, 32], mode: 'topdown' }, zones: strips(2, 20, 32) }, [{ use: 'gameplay.move.grid' }], { at: [1, 1] }, { view: 'td' }),
  grid: () => minimal({ use: 'engine.space.grid', with: { size: [28, 24] }, zones: strips(3, 9, 24) }, [{ use: 'gameplay.move.grid' }], { at: [1, 1] }, { view: 'td' }),
  mesh3d: () => minimal({ use: 'engine.space.mesh3d', with: { size: [512, 512] }, zones: [{ id: 'start', name: 'Start', rect: [32, 32, 96, 96] }, { id: 'mid', name: 'Mid', rect: [192, 192, 320, 320] }, { id: 'goal', name: 'Goal', rect: [416, 416, 480, 480] }] }, walk, {}, { view: '3p' }),
  voxel: () => minimal({ use: 'engine.space.voxel', zones: [box3('start', 0, 32), box3('mid', 48, 112), box3('goal', 128, 160)] }, walk, {}, { view: '3p' }),
  track: () => minimal({ use: 'engine.space.track', with: { lanes: 3 }, zones: [{ id: 'start', name: 'Start', range: [0, 50] }, { id: 'mid', name: 'Mid', range: [50, 100] }, { id: 'goal', name: 'Goal', range: [100, 150] }] }, [{ use: 'gameplay.move.lanes' }], {}, { view: '3p' }),
  arena2d: () => minimal({ use: 'engine.space.arena2d', with: { size: [48, 18], gravity: -40 }, zones: strips(3, 16, 18) }, platformer, { at: [2, 2] }),
  physics2d: () => minimal({ use: 'engine.space.physics2d', with: { bounds: [48, 18] }, zones: strips(3, 16, 18) }, platformer, { at: [2, 2] }),
  graph: () => minimal({ use: 'engine.space.graph', zones: [{ id: 'start', name: 'Start' }, { id: 'mid', name: 'Mid' }, { id: 'end', name: 'End' }] }, walk, { at: 'start' }, { view: 'text' }),
  overworld: () => minimal({ use: 'engine.space.tilemap', with: { size: [256, 256], mode: 'topdown' }, zones: [{ id: 'z0', name: 'Wilds', rect: [0, 0, 256, 256] }] }, [{ use: 'gameplay.move.grid' }], {}, { view: 'td' }),
};
const is3d = kind => kind === 'mesh3d' || kind === 'voxel';
const boot = (doc, frames = 3) => { const pre = preflight(doc, registry, logic); assert.ok(pre.ok, JSON.stringify(pre.errors).slice(0, 600)); const rt = createWorld(pre.doc, registry, logic, { seed: doc.seed }); for (let i = 0; i < frames && rt.state.status === 'playing'; i++) rt.step(); return { rt, doc: pre.doc }; };
// The playtest agent. engine.space.voxel runs it without the strategy stage: the placement strategy's board probe
// (v2/verify/strategies/common.js boardOf) treats any space with getCell and a size as a board and scans the
// whole voxel world, which takes minutes (reported; not a generator fault).
async function playtest(doc, kind) {
  if (kind !== 'voxel') return verifyDocument(doc, registry, logic, { budgetMs: 250 });
  const r = await verify(doc, registry, logic, { budgetMs: 600, seed: doc.seed, strategies: false });
  return { preflight: r.preflight, problems: r.problems, ...viability(r.playtest, r.problems) };
}

test('every spatial space kind gets a real world from its declarations: preflight, content, no world problems, a playtest without a crash', async t => {
  const rows = [];
  for (const kind of ['tilemap', 'grid', 'mesh3d', 'track', 'arena2d', 'physics2d', 'voxel', 'graph']) {
    const doc = DOCS[kind](), f = furnishWorld(doc, registry, logic, { seed: 7 });
    const planned = planWorld(registry, doc.spaces[0], { view: doc.views.primary }).generators;
    assert.deepEqual(f.added.map(a => a.use).sort(), [...planned].sort(), `${kind}: furnished with the planned generators`);
    const { rt, doc: pre } = boot(f.doc), c = contentOf(rt, 'main');
    assert.ok(!isEmpty(c), `${kind}: content ${JSON.stringify(c)}`);
    assert.deepEqual(worldProblems(rt, pre, registry), [], kind);
    assert.deepEqual(generationProblems(rt, pre, 'main').filter(p => p.severity === 'error'), [], kind);
    const v = await playtest(f.doc, kind);
    assert.ok(v.preflight.ok, kind);
    assert.equal(v.viable, true, `${kind}: ${v.viability}`);
    rows.push(`${kind.padEnd(10)} ${f.added.map(a => a.use.replace('engine.generate.', '')).join(' + ').padEnd(28)} ${JSON.stringify(c)}  viable`);
  }
  t.diagnostic(`space kind | generators | content | playtest\n${rows.join('\n')}`);
});

// ---------- the generator × space matrix ----------
const S = undefined; // configured by the generator's scaffold
const BIOMES = { biomes: [{ id: 'meadow', temp: [0.3, 1], moist: [0, 1], surface: 'grass' }, { id: 'snow', temp: [0, 0.3], moist: [0, 1], surface: 'snow' }] };
const CHUNK_ROWS = ['.....', '..o..', '.###.'];
const MATRIX = [
  ['engine.generate.terrain.noise', 'mesh3d', S], ['engine.generate.terrain.noise', 'voxel', S],
  ['engine.generate.water', 'mesh3d', { lakes: 1, lakeRadius: [8, 12] }], ['engine.generate.water', 'voxel', {}],
  ['engine.generate.roads', 'mesh3d', S], ['engine.generate.roads', 'voxel', S],
  ['engine.generate.city', 'mesh3d', { districts: [{ zone: 'mid', density: 0.8 }], block: [32, 32] }], ['engine.generate.city', 'voxel', { districts: [{ zone: 'mid', density: 0.8 }], block: [24, 24] }],
  ['engine.generate.structures', 'mesh3d', { place: [{ id: 'huts', kind: 'hut', zone: 'mid', count: [2, 2] }] }], ['engine.generate.structures', 'voxel', { place: [{ id: 'huts', kind: 'hut', zone: 'mid', count: [2, 2] }] }],
  ['engine.generate.scatter', 'mesh3d', { props: [{ model: 'tree', per100m2: 0.2, collide: true }] }, { models: [{ id: 'tree', name: 'Tree' }] }],
  ['engine.generate.scatter', 'voxel', { props: [{ block: 'log', shape: 'tree', crown: 'leaves', per100m2: 0.5 }] }, { blocks: [{ id: 'log', name: 'Log' }, { id: 'leaves', name: 'Leaves' }] }],
  ['engine.generate.biomes', 'mesh3d', BIOMES], ['engine.generate.biomes', 'voxel', BIOMES],
  ['engine.generate.caves', 'voxel', { density: 0.4, worms: 4 }], ['engine.generate.ores', 'voxel', { veins: [{ block: 'coal_ore', minY: 4, maxY: 40 }] }, { blocks: [{ id: 'coal_ore', name: 'Coal ore' }] }],
  ['engine.generate.chunks', 'track', S],
  ['engine.generate.chunks', 'tilemap', { chunks: [{ id: 'step', rows: CHUNK_ROWS }], along: 'columns', axis: 'x', cross: 'y', origin: [0, 1], firstAt: 8, end: 44 }],
  ['engine.generate.chunks', 'arena2d', { chunks: [{ id: 'crates', rows: CHUNK_ROWS }], legend: { '.': {}, o: { archetype: 'coin' }, '#': { archetype: 'crate', blocks: true } }, along: 'columns', axis: 'x', cross: 'y', origin: [0, 0], firstAt: 8, end: 44 }],
  ['engine.generate.layout.shapes', 'arena2d', S], ['engine.generate.layout.shapes', 'physics2d', S],
  ['engine.generate.dungeon.rooms', 'grid', S], ['engine.generate.dungeon.rooms', 'tilemapTd', S], ['engine.generate.dungeon.rooms', 'mesh3d', S],
  ['engine.generate.graph.world', 'graph', S],
  ['engine.generate.grid.board', 'grid', {}],
  ['engine.generate.grid.maze', 'grid', {}], ['engine.generate.grid.maze', 'tilemapTd', {}],
  ['engine.generate.tilemap.overworld', 'overworld', { areas: [
    { id: 'home', kind: 'town', services: ['heal', 'shop'], connects: [{ to: 'route1' }] },
    { id: 'route1', kind: 'route', length: 30, connects: [{ to: 'home' }, { to: 'city' }], items: ['potion'] },
    { id: 'city', kind: 'town', services: ['heal'], connects: [{ to: 'route1' }] }] }],
  ['engine.generate.tilemap.rooms', 'tilemap', S],
];
const USE = { tilemapTd: 'engine.space.tilemap', overworld: 'engine.space.tilemap' };

test('the matrix covers every space every generator card declares', () => {
  const have = new Set(MATRIX.map(([id, kind]) => `${id}@${USE[kind] ?? `engine.space.${kind}`}`));
  for (const id of generatorIds()) for (const s of registry.get(id).card.spaces) assert.ok(have.has(`${id}@${s}`), `${id} on ${s} has a case`);
});

test('generator × space matrix: preflight, real content, a clean generation proof, deterministic replay, a playtest without a crash', async t => {
  const rows = [], failures = [];
  for (const [id, kind, config, content = {}] of MATRIX) {
    const base = DOCS[kind]();
    for (const [k, list] of Object.entries(content)) base.content[k] = [...(base.content[k] || []), ...list];
    let doc = is3d(kind) && id !== 'engine.generate.terrain.noise' ? addGenerator(base, registry, 0, 'engine.generate.terrain.noise') : base; // 3D overlays stand on terrain
    const ground = doc;
    doc = addGenerator(doc, registry, 0, id, config);
    const row = { id: id.replace('engine.generate.', ''), space: kind, ok: false, why: '' };
    try {
      assert.ok(doc, 'the scaffold declined');
      configureGenerators(doc, registry);
      assert.deepEqual(extentProblems(doc, registry), [], 'extent');
      const before = contentOf(boot(ground).rt, 'main'), { rt, doc: pre } = boot(doc), after = contentOf(rt, 'main');
      assert.ok(grows(before, after), `no content: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
      const gen = generationProblems(rt, pre, 'main').filter(p => p.severity === 'error');
      assert.deepEqual(gen.map(p => p.code), [], `generation proof: ${JSON.stringify(gen).slice(0, 300)}`);
      const hash = () => hashOf(boot(doc, 20).rt.snapshot());
      assert.equal(hash(), hash(), 'same seed, same state');
      const v = await playtest(doc, kind);
      assert.ok(v.preflight.ok, 'playtest preflight');
      assert.equal(v.viable, true, v.viability);
      row.ok = true; row.why = JSON.stringify(after);
    } catch (error) { row.why = String(error.message).split('\n')[0].slice(0, 200); failures.push(`${row.id} × ${kind}: ${row.why}`); }
    rows.push(`${row.id.padEnd(18)} ${kind.padEnd(10)} ${row.ok ? 'pass' : 'FAIL'}  ${row.why}`);
  }
  t.diagnostic(`generator × space\n${rows.join('\n')}`);
  assert.deepEqual(failures, []);
});

// ---------- the planner: selection and live documents ----------
test('selection plans a world for every space a mover or vehicle uses; a dungeon idea on mesh3d gets rooms', async () => {
  const pick = async (space, mechanics, primitives, premise, kind = 'continuous-3d') => {
    const d = decomposition(mechanics, { views: ['3p'], spaces: [{ role: 'world', kind }], zones: 4, acts: 1 });
    d.premise = premise;
    // The model builds on the space and picks the listed primitives, one mechanic at a time (build.js).
    return selectPrimitives({ decomposition: d, registry, writer: buildWriter({ space: [space], picks: Object.fromEntries(mechanics.map((m, i) => [`m${i}`, [...primitives, space]])) }) });
  };
  const kart = await pick('engine.space.mesh3d', ['drive a shopping cart around the track'], ['gameplay.vehicle.car', 'gameplay.race'], 'Mario Kart with shopping carts');
  assert.equal(kart.spaces[0].use, 'engine.space.mesh3d');
  assert.deepEqual(kart.generators.map(g => g.id).sort(), ['engine.generate.roads', 'engine.generate.terrain.noise']);
  const zelda = await pick('engine.space.mesh3d', ['explore the clockwork dungeon'], ['gameplay.move.walk', 'gameplay.combat.melee'], '3D Zelda-style dungeon inside a giant clock');
  assert.deepEqual(zelda.generators.map(g => g.id), ['engine.generate.dungeon.rooms']);
  const track = await pick('engine.space.track', ['race down the lanes'], ['gameplay.move.lanes'], 'An endless lane racer', 'continuous-2d');
  assert.deepEqual(track.generators.map(g => g.id), ['engine.generate.chunks']);
  // A space kind no registered generator can furnish is not chosen while something moves through the world.
  const bare = buildCatalogue([], ['engine.space.mesh3d', 'engine.space.tilemap', 'engine.space.none', 'gameplay.move.walk'].map(id => registry.get(id)));
  const r = chooseSpaces(bare.registry, ['gameplay.move.walk'], { spaces: [{ kind: 'continuous-3d' }], views: ['3p'] });
  assert.ok(r.excluded.some(e => e.use === 'engine.space.mesh3d' && e.missing.includes('terrain')), JSON.stringify(r.excluded));
  assert.ok(r.excluded.some(e => e.use === 'engine.space.tilemap'));
  assert.equal(r.spaces[0].use, 'engine.space.none');
});

test('need sets: the idea picks a declared alternative only when a generator for it is relevant', () => {
  const space = { id: 'w', use: 'engine.space.mesh3d' };
  assert.deepEqual(needSetFor(registry, space, { intent: 'Mario Kart with shopping carts' }), ['terrain', 'road-network']);
  assert.deepEqual(needSetFor(registry, space, { intent: '3D Zelda-style dungeon inside a giant clock' }), ['rooms']);
  assert.deepEqual(needSetFor(registry, space, { have: ['rooms'] }), ['rooms']);
});

test('live documents: Mario Kart (track and the 3D outline), the platformer and the 3D Zelda dungeon get real worlds', async t => {
  const rows = [];
  const cases = [['kart.json', 'race_tracks'], ['kart3d-outline.json', 'race_track'], ['platformer.json', 'tower_climb'], ['zelda3d-standin.json', 'clock_dungeon']];
  for (const [file, sid] of cases) {
    const doc = structuredClone(live(file));
    configureGenerators(doc, registry); // the planner's pass over a draft, then furnishing
    const f = furnishWorld(doc, registry, logic, { seed: doc.seed });
    const { rt, doc: pre } = boot(f.doc), c = contentOf(rt, sid);
    assert.ok(!isEmpty(c), `${file}: ${JSON.stringify(c)}`);
    assert.deepEqual(worldProblems(rt, pre, registry).filter(p => p.severity === 'error'), [], file);
    assert.deepEqual(generationProblems(rt, pre, sid).filter(p => p.severity === 'error'), [], file);
    const v = await verifyDocument(f.doc, registry, logic, { budgetMs: 300 });
    assert.equal(v.viable, true, `${file}: ${v.viability}`);
    rows.push(`${file.padEnd(22)} ${(f.doc.spaces.find(s => s.id === sid).generators || []).map(g => g.use.replace('engine.generate.', '')).join(' + ').padEnd(26)} ${JSON.stringify(c)}`);
    if (file === 'kart.json') {
      assert.equal(f.doc.spaces[0].with.length, 200, 'the course has a real length from its zones');
      assert.ok(c.entities >= 3, 'barriers and pickups');
    }
    if (file === 'kart3d-outline.json') {
      assert.ok(c.terrain && c.roads >= 4, 'terrain and a road through the race checkpoints');
      const links = f.doc.spaces[0].generators.find(g => g.use === 'engine.generate.roads').with.links.map(l => `${l.from}>${l.to}`);
      assert.deepEqual(links, ['launch_pad>kart_gate', 'kart_gate>glory_yard', 'glory_yard>redemption_ruins', 'redemption_ruins>glory_grove']);
    }
    if (file === 'zelda3d-standin.json') {
      const dungeon = rt.service('dungeon');
      assert.ok(dungeon.rooms().length >= 9, 'rooms');
      assert.ok(c.objects > 50, 'walls and doors as colliders');
      const of = a => Object.values(rt.state.entities).filter(e => e.archetype === a).length;
      assert.ok(of('clockwork_guardian') >= 5, 'guards placed');
      assert.ok(dungeon.locks().length >= 1 && of('key') >= 1, 'locked doors and their keys');
      const [W, D] = f.doc.spaces[0].with.size, cell = f.doc.spaces[0].generators[0].with.cell, rooms = dungeon.rooms().map(r => r.rect);
      assert.ok(Math.max(...rooms.map(r => r[2])) * cell > W * 0.8 && Math.max(...rooms.map(r => r[3])) * cell > D * 0.8, 'the dungeon spans the world');
    }
  }
  t.diagnostic(rows.join('\n'));
});
