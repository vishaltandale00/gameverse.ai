import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spaceConformance, compile, run } from '../v2/kernel/testing.js';
import { checkFields } from '../v2/kernel/params.js';
import { preflight } from '../v2/kernel/document.js';
import { catalogue } from '../v2/primitives/index.js';
import spaces2d from '../v2/primitives/engine/spaces2d.index.js';

const grid = spaces2d.find(p => p.id === 'engine.space.grid');
const painter = { id: 'engine.generate.testboard', card: { intent: 'test board painter', params: { rows: { type: 'list', of: { type: 'string' }, default: [] }, legend: { type: 'object', open: true, default: {} }, layer: { type: 'string', default: 'terrain' } } },
  // rows are written top line = highest row index (y up)
  install(rt, cfg, inst) { const H = cfg.rows.length; rt.space(inst.space).bake(cfg.rows.flatMap((line, i) => [...line].map((ch, x) => ({ at: [x, H - 1 - i], block: cfg.legend[ch] ?? null })).filter(c => c.block)), rt, { layer: cfg.layer }); } };
const prims = [...spaces2d, painter];

// A small maze: wrap-around tunnel on row 3, a ghost house with a door at (4,2), a no-up tile at (2,4).
const MAZE = [
  '#########',
  '#.......#',
  '#.u.....#',
  'tt.....tt',
  '#..#d#..#',
  '#..#.#..#',
  '#########',
];
const BLOCKS = [{ id: 'wall', solid: true }, { id: 'door', solid: true }, { id: 'tunnel', solid: false }, { id: 'noup', solid: false }, { id: 'pellet', solid: false },
  { id: 'mud', solid: false }, { id: 'low', solid: true }, { id: 'high', solid: true }, { id: 'gem', solid: false }, { id: 'rock', solid: true }];
const mazeDoc = (w = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'maze', title: 'Maze', seed: 5,
  spaces: [{ id: 'board', use: 'engine.space.grid', with: { size: [9, 7], wrap: 'x', layers: ['terrain', 'items'],
    rules: { door: { pass: ['ghost'] }, noup: { noExit: ['up'], appliesTo: ['ghost'], except: ['frightened'] }, tunnel: { speed: 0.5, appliesTo: ['ghost'] } }, ...w },
  generators: [{ use: 'engine.generate.testboard', with: { rows: MAZE, legend: { '#': 'wall', d: 'door', t: 'tunnel', u: 'noup' } } }],
  zones: [{ id: 'house', cells: [[4, 1], [4, 2]] }, { id: 'left', rect: [0, 0, 4, 7] }, { id: 'corner', rect: [1, 1, 3, 3] }] }],
  content: { blocks: BLOCKS, archetypes: [{ id: 'pac', components: {} }, { id: 'ghost', components: { body: { layer: 'ghost' } } }] },
  player: { archetype: 'pac', at: [1, 1] },
});
const makeMaze = w => compile(mazeDoc(w), { primitives: prims }).rt;

spaceConformance(test, assert, { name: 'engine.space.grid', primitives: prims, doc: () => mazeDoc(), free: [1, 1], other: [2, 1], solid: [0, 0], block: 'wall' });

test('grid: wrap-around tunnels with wrap-aware distance and paths', () => {
  const rt = makeMaze(), api = rt.space('board');
  assert.equal(api.distance([0, 3], [8, 3]), 1);
  assert.equal(api.distance([0, 3], [8, 3], 'steps'), 1);
  assert.deepEqual(api.delta([8, 3], [0, 3]), [1, 0]);
  const p = api.path([1, 3], [7, 3]);
  assert.deepEqual(p, [[1, 3], [0, 3], [8, 3], [7, 3]], 'short way through the tunnel');
  api.setPos(rt.player(), [-0.4, 3], rt);
  assert.deepEqual(rt.player().at.map(v => +v.toFixed(6)), [8.6, 3], 'fractional lane positions fold');
  assert.equal(api.cellOf(rt.player()), '0,3', 'rounded cell, wrapped');
});

test('grid: class passability (house door), one-way cells (no-up) and speed rules', () => {
  const rt = makeMaze(), api = rt.space('board'), pac = rt.player();
  const ghost = rt.spawn('ghost', { at: [4, 1], id: 'blinky' });
  assert.equal(api.passable([4, 2], pac), false, 'door shuts out the player');
  assert.equal(api.passable([4, 2], ghost), true, 'ghosts use the door');
  assert.ok(api.path([4, 1], [4, 4], { who: ghost }), 'ghost leaves the house');
  assert.equal(api.path([1, 1], [4, 1], { who: pac }), null, 'player cannot enter the house');
  assert.equal(api.canReach([1, 1], 'house', rt), false);
  assert.equal(api.canReach([4, 4], 'house', { who: ghost }), true);
  api.setPos(ghost, [2, 4], rt);
  assert.equal(api.canMove(ghost, [2, 5], rt), false, 'no turning up on a no-up tile');
  assert.equal(api.move(ghost, [2, 5], rt), false); assert.equal(rt.state.counts.blocked, 1);
  assert.equal(api.canMove(ghost, [3, 4], rt), true);
  ghost.components.body.tags = ['frightened'];
  assert.equal(api.canMove(ghost, [2, 5], rt), true, 'frightened ghosts are exempt');
  api.setPos(pac, [2, 4], rt); assert.equal(api.canMove(pac, [2, 5], rt), true, 'rule applies to ghosts only');
  assert.equal(api.speedAt([0, 3], ghost), 0.5); assert.equal(api.speedAt([0, 3], pac), 1);
  assert.deepEqual(api.ruleAt([0, 3], ghost), { speed: 0.5, appliesTo: ['ghost'] });
  assert.equal(api.moveCost([1, 3], [0, 3], ghost), 2);
  assert.equal(api.move(pac, [2, 3], rt), true);
  assert.equal(rt.state.events.find(e => e.name === 'moved').dir, 'down');
});

test('grid: zones (rect and cell lists) emit typed enter/leave; teleport picks an enterable cell', () => {
  const rt = makeMaze(), api = rt.space('board'), pac = rt.player();
  assert.equal(pac.zone, 'corner');
  api.move(pac, [1, 2], rt); api.move(pac, [1, 3], rt);
  assert.ok(rt.state.events.some(e => e.name === 'leave_zone:corner'));
  assert.ok(rt.test({ zone: 'left' }) && !rt.test({ zone: 'corner' }));
  const ghost = rt.spawn('ghost', { at: [6, 5] });
  rt.run([{ do: 'teleport', who: ghost.id, zone: 'house' }]);
  assert.equal(ghost.zone, 'house');
  assert.ok(rt.test({ near: 'house', within: 0, who: ghost.id }));
});

const tactics = (w = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'tactics', title: 'Tactics', seed: 9,
  spaces: [{ id: 'field', use: 'engine.space.grid', with: { size: [6, 6], exclusive: true, cover: true, diagonals: true, rules: { low: { cover: 1, opaque: false }, high: { cover: 2 }, mud: { cost: 2 } }, ...w },
    generators: [{ use: 'engine.generate.testboard', with: { rows: ['......', '..H...', '..L...', '.MM...', '......', '......'], legend: { H: 'high', L: 'low', M: 'mud' } } }],
    zones: [{ id: 'deploy', rect: [0, 0, 2, 2] }] }],
  content: { blocks: BLOCKS, archetypes: [{ id: 'soldier', components: {} }] },
  player: { archetype: 'soldier', at: [0, 0] },
});

test('grid: tactics movement ranges with costs, exclusive occupancy, line of sight and cover', () => {
  const { rt } = compile(tactics(), { primitives: prims }), api = rt.space('field'), me = rt.player();
  const enemy = rt.spawn('soldier', { at: [2, 5], id: 'enemy' });
  const range = api.cellsInRange([0, 0], 2, 'steps', { passable: true, who: me });
  const has = c => range.some(q => q[0] === c[0] && q[1] === c[1]);
  assert.ok(has([2, 0]) && has([1, 1]), 'two moves on open ground');
  assert.ok(!has([1, 2]), 'mud costs 2 (plus diagonal) so is out of range');
  assert.equal(api.passable([2, 3], me), false, 'low wall is not walkable');
  api.setPos(me, [2, 1], rt);
  assert.deepEqual(api.los([2, 1], [2, 5]), { clear: false, cover: 0 }, 'high wall blocks sight');
  const shot = api.los([5, 0], [2, 2]);
  assert.equal(shot.clear, true);
  assert.equal(api.coverAt([2, 3], 'up'), 2, 'the high wall above');
  assert.equal(api.coverAt([2, 2], 'up'), 1, 'the low wall above');
  assert.equal(api.coverAt([1, 3], [1, 0]), 1, 'low wall to the right covers against attacks from the right');
  assert.equal(api.los([5, 3], [1, 3]).cover, 1);
  // Exclusive cells.
  rt.spawn('soldier', { at: [3, 1], id: 'ally' });
  assert.equal(api.canMove(me, [3, 1], rt), false, 'occupied');
  const p = api.path([2, 1], [2, 5], { who: me });
  assert.ok(p && p.at(-1)[0] === 2 && p.at(-1)[1] === 5, 'path may end on the occupied target');
  assert.equal(api.occupant([2, 5]), 'enemy');
  assert.deepEqual(api.overlap({ kind: 'circle', at: [2, 2], r: 1 }), ['player'], 'circle by cell centres (the diagonal ally at 1.41 is excluded)');
  assert.deepEqual(api.overlap({ kind: 'circle', at: [2, 2], r: 1.5 }).sort(), ['ally', 'player']);
  assert.deepEqual(api.overlap({ kind: 'aabb', at: [2, 4], size: [2, 2] }), ['enemy']);
  assert.ok(api.visibleFrom([0, 5], 3).length > 3);
  assert.ok(api.contacts(me).some(c => c.id === 'ally'));
  void enemy;
});

test('grid: hex topology (odd-r) neighbours, step distance and paths', () => {
  const d = tactics({ topology: 'hex', diagonals: false, exclusive: false, size: [7, 7] });
  d.spaces[0].generators = [];
  const { rt, checked } = compile(d, { primitives: prims }), api = rt.space('field');
  assert.equal(api.neighbors([3, 3]).length, 6);
  assert.equal(api.distance([0, 0], [3, 3], 'steps'), 5);
  assert.equal(api.distance([3, 3], [0, 0], 'steps'), 5);
  assert.equal(api.distance([0, 0], [0, 1], 'steps'), 1, 'even row: north-east is the same column');
  assert.equal(api.distance([1, 1], [2, 2], 'steps'), 1, 'odd row: north-east shifts right');
  assert.equal(api.path([0, 0], [3, 3]).length, 6);
  assert.deepEqual(api.cellCenter([1, 1]), [1.5, Math.sqrt(3) / 2]);
  assert.ok(checked.capabilities.field.includes('occupancy'));
  assert.ok(Math.abs(api.distance([0, 0], [1, 0]) - 1) < 1e-9);
});

const puzzle = (w = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'drop', title: 'Drop', seed: 2,
  spaces: [{ id: 'well', use: 'engine.space.grid', with: { size: [4, 5], layers: ['pieces'], rules: { rock: { fixed: true } }, ...w },
    generators: [{ use: 'engine.generate.testboard', with: { layer: 'pieces', rows: ['gg.g', '.g..', 'g.R.', '....', '...g'], legend: { g: 'gem', R: 'rock' } } }] }],
  content: { blocks: BLOCKS, archetypes: [{ id: 'cursor', components: {} }] }, player: { archetype: 'cursor', at: [0, 0] },
});

test('grid: settle drops cell contents column-wise, stops on fixed blocks, logs edits', () => {
  const { rt } = compile(puzzle(), { primitives: prims }), api = rt.space('well');
  assert.equal(api.settled(), false);
  const moves = api.settle(rt);
  assert.ok(moves.length > 0);
  const col = x => [0, 1, 2, 3, 4].map(y => api.getCell([x, y]));
  assert.deepEqual(col(0), ['gem', 'gem', null, null, null]);
  assert.deepEqual(col(1), ['gem', 'gem', null, null, null]);
  assert.deepEqual(col(2), [null, null, 'rock', null, null], 'fixed rock stays and nothing above it falls past');
  assert.deepEqual(col(3), ['gem', 'gem', null, null, null]);
  assert.equal(api.settled(), true);
  assert.equal(rt.state.counts.settled, 1);
  assert.ok(api.editLog().every(e => e.by === 'settle'));
  // Rows growing downward: 'down' means increasing row.
  const d = compile(puzzle({ yAxis: 'down' }), { primitives: prims }).rt, a2 = d.space('well');
  a2.settle(d);
  assert.deepEqual([0, 1, 2, 3, 4].map(y => a2.getCell([0, y])), [null, null, null, 'gem', 'gem']);
  a2.settle(d, { dir: 'left' });
  assert.equal(a2.settled({ dir: 'left' }), true);
});

test('grid: deterministic replay', () => {
  const go = () => { const rt = makeMaze(), api = rt.space('board'); const g = rt.spawn('ghost', { at: [4, 1] }); for (const c of api.path([4, 1], [7, 5], { who: g }).slice(1)) { api.move(g, c, rt); run(rt, 2); } api.setCell([5, 5], 'pellet', rt, null, 'items'); return rt.snapshot(); };
  assert.deepEqual(go(), go());
});

test('grid: preflight rejects bad configs with stable codes', () => {
  const { registry, logic } = catalogue([painter]);
  const codes = (w, d = mazeDoc) => preflight(d(w), registry, logic).errors.map(e => e.code);
  assert.ok(codes({ topology: 'triangle' }).includes('param_option'));
  assert.ok(codes({ rules: { door: { pass: ['ghost'], glow: 1 } } }).includes('param_unknown'));
  assert.ok(codes({ rules: { noup: { noExit: ['north'] } } }).includes('param_option'));
  assert.ok(codes({ topology: 'hex', diagonals: true }).includes('grid_hex_diagonals'));
  assert.ok(codes({ topology: 'hex', wrap: 'y' }).includes('grid_hex_wrap'));
  const bad = mazeDoc(); bad.spaces[0].zones.push({ id: 'oops', rect: [3, 3, 2, 2] }, { id: 'big', rect: [0, 0, 20, 2] }, { id: 'none' });
  const c = preflight(bad, registry, logic).errors.map(e => e.code);
  assert.ok(c.includes('zone_rect_invalid') && c.includes('zone_outside'));
});

test('grid: every instance in v2/games preflights its params with zero errors', () => {
  for (const f of readdirSync('v2/games').filter(f => f.endsWith('.json'))) {
    const g = JSON.parse(readFileSync(`v2/games/${f}`, 'utf8'));
    for (const s of g.spaces || []) if (s.use === grid.id) {
      const errors = []; const cfg = checkFields(grid.card.params, s.with || {}, 'with', errors, null);
      errors.push(...grid.validate(cfg, g, {}));
      assert.deepEqual(errors, [], `${f} ${s.id}`);
    }
  }
});
