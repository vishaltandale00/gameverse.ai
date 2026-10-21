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
import { verifyDocument } from '../v2/planner/verify-adapter.js';
import {
  generatorsFor, planWorld, spaceNeeds, unfurnishable, configureGenerators, extentProblems, scaleWorld, spaceExtent,
} from '../v2/planner/world.js';

const { registry, logic } = buildCatalogue();
const live = name => JSON.parse(readFileSync(new URL(`./fixtures/v2-live/${name}`, import.meta.url), 'utf8')).doc;
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
  assert.deepEqual(plan('engine.space.grid'), ['engine.generate.dungeon.rooms']);
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
