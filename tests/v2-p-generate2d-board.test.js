import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, testSpace, run } from '../v2/kernel/testing.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import { preflight } from '../v2/kernel/document.js';
import { PRIMITIVES } from '../v2/primitives/index.js';
import { Raster } from '../v2/primitives/engine/generate2d-lib.js';
import { runs, hasMove } from '../v2/primitives/engine/generate-grid-board.js';

const ALL = [...PRIMITIVES, testSpace];
const KEY = 'spaces.b.generators[0]';
const BLOCKS = [{ id: 'rock', solid: true }, { id: 'forest', solid: false }, { id: 'jungle', solid: true }, { id: 'ocean', solid: true }, { id: 'mountain', solid: true },
  ...['coast', 'desert', 'plains', 'hills'].map(id => ({ id, solid: false })), ...['red', 'blue', 'green', 'yellow', 'purple'].map(id => ({ id, solid: false }))];
const doc = (w, size, { seed = 3, grid = {} } = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'board', title: 'Board', seed,
  spaces: [{ id: 'b', use: 'engine.space.grid', with: { size, ...grid }, generators: [{ use: 'engine.generate.grid.board', with: w }] }],
  content: { archetypes: [{ id: 'hero', components: {} }], blocks: BLOCKS }, player: { archetype: 'hero', at: [0, 0] },
});
const make = (...a) => { const { rt } = compile(doc(...a), { primitives: ALL }); run(rt, 1); return rt; };
const k = c => `${c[0]},${c[1]}`;

test('grid.board match: no run on the fill, a move always exists, across seeds', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const rt = make({ kind: 'match', size: [8, 8], fill: [{ piece: 'red' }, { piece: 'blue' }, { piece: 'green' }, { piece: 'yellow' }] }, [8, 8], { seed });
    const svc = rt.service('board');
    assert.deepEqual(rt.store(KEY).problems, []);
    assert.deepEqual(svc.findMatches(), [], `seed ${seed}`);
    assert.ok(svc.hasMove());
  }
  const g = new Raster(3, 3, 'a'); g.set(1, 1, 'b'); assert.equal(runs(g, 3).length, 4);
  const h = new Raster(3, 1, null); h.cells = ['a', 'b', 'c']; assert.equal(hasMove(h, 3), null);
});

test('grid.board tactics: symmetric terrain, every open cell joined, deploy strips reachable through the grid', () => {
  const rt = make({ kind: 'tactics', size: [16, 12], symmetry: 'rotate', density: 0.3 }, [16, 12]);
  const api = rt.space('b'), st = rt.store(KEY);
  assert.deepEqual(st.problems, []);
  for (let y = 0; y < 12; y++) for (let x = 0; x < 16; x++) {
    const a = api.getCell([x, y]), b = api.getCell([15 - x, 11 - y]);
    if (a === 'rock' || b === 'rock') assert.ok(a === b || y < 2 || y > 9, `rotational symmetry at ${x},${y}`);
  }
  const seen = api.reachable([0, 0], rt, {});
  assert.ok(seen.has('15,11'), 'team 2 strip reachable from team 1 per engine.space.grid');
  assert.ok(rt.test({ zone: 'deploy_1', who: 'player' }));
});

test('grid.board lanes: each lane alone joins the bases', () => {
  const rt = make({ kind: 'lanes', size: [30, 30], lanes: 3 }, [30, 30]);
  const st = rt.store(KEY);
  assert.deepEqual(st.problems, []);
  assert.equal(st.lanes.length, 3);
  assert.ok(rt.space('b').reachable([0, 0], rt, {}).has('29,29'));
});

test('grid.board hex-continent: starts on land, spaced, each with room to grow; hex neighbours match the grid', () => {
  const rt = make({ kind: 'hex-continent', size: [40, 30], continents: 3, starts: 4, minStartDistance: 6, landPerStart: 15 }, [40, 30], { grid: { topology: 'hex' } });
  const st = rt.store(KEY), api = rt.space('b');
  assert.deepEqual(st.problems, []);
  assert.equal(st.starts.length, 4);
  for (const s of st.starts) assert.notEqual(api.getCell(s), 'ocean');
  assert.deepEqual(rt.service('board').neighbors([5, 5]).map(k).sort(), api.neighbors('5,5').map(n => (typeof n === 'string' ? n : k(n))).sort());
});

test('grid.board: the proof fails honestly when the data cannot satisfy it', () => {
  const rt = make({ kind: 'hex-continent', size: [16, 12], continents: 1, land: 0.1, starts: 6, minStartDistance: 9, attempts: 1 }, [16, 12], { grid: { topology: 'hex' } });
  const codes = rt.store(KEY).problems.map(p => p.code);
  assert.ok(codes.includes('board_fallback') && codes.includes('start_crowded'), codes.join());
  assert.equal(rt.state.counts.generate_problem, codes.length);
});

test('grid.board: same seed replays exactly; another seed differs (test space too)', () => {
  const docT = seed => ({ ...doc({ kind: 'tactics', size: [12, 12] }, [12, 12], { seed }), spaces: [{ id: 'b', use: 'engine.space.test', with: { size: [12, 12, 1] }, generators: [{ use: 'engine.generate.grid.board', with: { kind: 'tactics', size: [12, 12] } }] }] });
  const a = compile(docT(1), { primitives: ALL }).rt, b = compile(docT(1), { primitives: ALL }).rt, c = compile(docT(2), { primitives: ALL }).rt;
  run(a, 5); run(b, 5); run(c, 5);
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.notDeepEqual(a.snapshot().spaces.b.cells, c.snapshot().spaces.b.cells);
});

test('grid.board: preflight rejects bad configs with stable codes', () => {
  const r = new Registry(ALL), logic = buildLogic(r, Logic), codes = d => preflight(d, r, logic).errors.map(e => e.code);
  assert.ok(codes(doc({ kind: 'match', fill: [{ piece: 'red' }, { piece: 'blue' }] }, [8, 8])).includes('board_pieces_few'));
  assert.ok(codes(doc({ kind: 'tactics', terrain: [] }, [8, 8])).includes('board_terrain_open'));
  assert.ok(codes(doc({ kind: 'chess' }, [8, 8])).includes('param_option'));
});
