import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, testSpace, run } from '../v2/kernel/testing.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import { preflight } from '../v2/kernel/document.js';
import { PRIMITIVES } from '../v2/primitives/index.js';
import { buildMaze, checkMaze, SIZES, OPEN, WALL } from '../v2/primitives/engine/generate-grid-maze.js';

const ALL = [...PRIMITIVES, testSpace];
const doc = ({ space = 'engine.space.test', size = 'classic', w = {}, seed = 4 } = {}) => {
  const s = SIZES[size];
  return {
    schema: 'gameverse.v2.game/0.2', id: 'maze', title: 'Maze', seed,
    spaces: [{ id: 'm', use: space, with: space === 'engine.space.test' ? { size: [s.w, s.h, 1] } : { size: [s.w, s.h], wrap: 'x' }, generators: [{ use: 'engine.generate.grid.maze', with: { size, ...w } }] }],
    content: { archetypes: [{ id: 'hero', components: {} }, { id: 'pellet', components: {} }, { id: 'power_pellet', components: {} }], blocks: [{ id: 'wall', solid: true }, { id: 'house_wall', solid: true }, { id: 'house_door', solid: true }] },
    player: { archetype: 'hero' },
  };
};
const KEY = 'spaces.m.generators[0]';

test('grid.maze: every size builds a maze that passes its own proof', () => {
  for (const size of Object.keys(SIZES)) for (const style of size === 'vast' ? ['sprawling'] : ['classic', 'compact', 'sprawling']) for (const seed of size === 'classic' ? [1, 7] : [2]) {
    const m = buildMaze({ size, style, tunnels: 2 }, seed);
    assert.deepEqual(checkMaze(m, { w: SIZES[size].w, h: SIZES[size].h, tunnels: 2 }), [], `${size}/${style}/${seed}`);
    assert.equal(m.houses.length, { classic: 1, large: 2, huge: 3, vast: 5 }[size]);
  }
  // The proof is real: break the raster and it says how.
  const m = buildMaze({}, 3), codes = mz => checkMaze(mz, { w: 28, h: 31 }).map(p => p.code);
  const holed = { ...m, cells: m.cells.slice() }; holed.cells[1 * 28 + 1] = WALL; holed.cells[1 * 28 + 26] = WALL;
  assert.ok(codes(holed).includes('maze_dead_end') || codes(holed).includes('maze_disconnected'));
  const lop = { ...m, cells: m.cells.slice() }; lop.cells[1 * 28 + 1] = WALL;
  assert.ok(codes(lop).includes('maze_mirror'));
  const wide = { ...m, cells: m.cells.slice() }; const i = m.cells.findIndex((c, k) => c === OPEN && m.cells[k + 1] === OPEN && m.cells[k + 28] === WALL && k % 28 < 13 && m.cells[k + 29] === WALL);
  wide.cells[i + 28] = OPEN; wide.cells[i + 29] = OPEN; wide.cells[(Math.floor(i / 28) + 1) * 28 + (27 - (i % 28))] = OPEN; wide.cells[(Math.floor(i / 28) + 1) * 28 + (26 - (i % 28))] = OPEN;
  assert.ok(codes(wide).includes('maze_wide'));
});

test('grid.maze: writes walls, spawns pellets, places the player and proves it on the test space', () => {
  const { rt } = compile(doc(), { primitives: ALL });
  run(rt, 2);
  const st = rt.store(KEY), api = rt.space('m'), maze = rt.service('maze');
  assert.deepEqual(st.problems, []);
  assert.equal(rt.state.counts['generated:m'], 1);
  assert.equal(rt.query('collectible').length, st.pellets.length);
  assert.equal(rt.query('collectible').filter(e => e.components.collectible.counter === 'power_pellets').length, 4);
  assert.deepEqual(rt.player().at.slice(0, 2), maze.start().map(Math.floor));
  assert.equal(api.getCell([0, 0]), 'wall');
  assert.ok(maze.isOpen(rt.player().at));
  assert.equal(maze.houses()[0].door.every(d => api.getCell(d) === 'house_door'), true);
  assert.ok(rt.test({ zone: 'maze_house_1', who: 'player' }) === false);
  assert.equal(maze.wrap([-1, maze.tunnels()[0]])[0], 27);
});

test('grid.maze: on the grid space every pellet is reachable through the space\'s own pathing', () => {
  const { rt } = compile(doc({ space: 'engine.space.grid', size: 'large', w: { tunnels: 2 } }), { primitives: ALL });
  const api = rt.space('m'), st = rt.store(KEY);
  assert.deepEqual(st.problems, []);
  const seen = api.reachable(rt.player().at, rt, {});
  const missed = rt.query('collectible').filter(e => !seen.has(api.cellOf(e)));
  assert.equal(missed.length, 0, `${missed.length} pellets unreachable per engine.space.grid`);
});

test('grid.maze: same seed replays exactly; another seed differs', () => {
  const a = compile(doc(), { primitives: ALL }).rt, b = compile(doc(), { primitives: ALL }).rt, c = compile(doc({ seed: 5 }), { primitives: ALL }).rt;
  run(a, 20); run(b, 20); run(c, 20);
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.notDeepEqual(a.store(KEY).cells, c.store(KEY).cells);
});

test('grid.maze: preflight rejects bad configs with stable codes', () => {
  const r = new Registry(ALL), logic = buildLogic(r, Logic), codes = d => preflight(d, r, logic).errors.map(e => e.code);
  const d = doc(); Object.assign(d.spaces[0].generators[0].with, { size: 'gigantic', style: 'wavy' });
  // A style is one of the declared styles (card params.style options); a size is a preset or one the instance declares.
  assert.ok(codes(d).includes('maze_size_unknown')); assert.ok(codes(d).includes('param_option'));
  const e = doc(); Object.assign(e.spaces[0].generators[0].with, { sizes: { odd: { w: 27, h: 31, houses: [] } } });
  assert.deepEqual(codes(e).filter(c => c === 'param_range'), ['param_range', 'param_range'], 'an odd width and no house: the declared shape of a size (card params.sizes)');
  const f = doc(); f.spaces[0].with.size = [20, 20, 1];
  assert.ok(codes(f).includes('maze_outside_space'));
  const g = doc(); g.spaces[0].generators[0].with.density = 3;
  assert.ok(codes(g).includes('param_range'));
});
