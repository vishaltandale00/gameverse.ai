import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, run, testSpace } from '../v2/kernel/testing.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import { preflight } from '../v2/kernel/document.js';
import falling, { solverKey, gravityRows } from '../v2/primitives/gameplay/falling-pieces.js';

const PRIMS = [testSpace, falling];
const ST = 'gameplay.falling.pieces:board';

/** rows: board rows top (r=0) to bottom; '#' solid. Converted to y-up space cells. */
const solidFrom = (rows, H) => rows.flatMap((row, i) => [...row].map((ch, x) => ch === '#' ? [x, rows.length - 1 - i, 0] : null).filter(Boolean));
const doc = (withCfg = {}, { size = [10, 24, 1], solid = [], player = null, extra = {} } = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'well', title: 'Well', seed: 7,
  spaces: [{ id: 'well', use: 'engine.space.test', with: { size, solid } }],
  systems: [{ use: 'gameplay.falling.pieces', with: { board: { name: 'board', at: [0, 0, 0], size: [size[0], size[1]], axes: [0, 1], fall: -1 }, ...withCfg } }],
  content: { archetypes: [{ id: 'hero', components: {} }, { id: 'brick', components: {} }] },
  ...(player ? { player: { archetype: 'hero', space: 'well', at: player } } : {}),
  ...extra,
});
const st = rt => rt.state.prim[ST];
const cell = (rt, x, y) => rt.space('well').getCell([x, y, 0]);

test('falling: preflights and spawns from a 7-bag with a next queue', () => {
  const { rt, checked } = compile(doc(), { primitives: PRIMS });
  assert.ok(checked.ok);
  rt.step();
  const s = st(rt);
  assert.ok(s.piece, 'a piece is in play');
  const first7 = [s.piece.t, ...s.queue.slice(0, 6)];
  assert.deepEqual([...first7].sort(), [0, 1, 2, 3, 4, 5, 6], 'the first seven pieces are one of each type');
  assert.equal(rt.state.counts.piece_spawned, 1);
});

test('falling: hard drop lands cells at the bottom and scores 2 per row', () => {
  const { rt } = compile(doc({ next: 3 }), { primitives: PRIMS });
  rt.step();
  rt.step({ actions: { hard_drop: true } });
  assert.equal(rt.state.counts.piece_locked, 1);
  const filled = []; for (let x = 0; x < 10; x++) if (cell(rt, x, 0)) filled.push(x);
  assert.ok(filled.length >= 1, 'something landed on the floor row');
  assert.ok(rt.state.vars.score > 0 && rt.state.vars.score % 2 === 0);
  assert.equal(rt.state.counts.move, 1);
});

test('falling: a line clear collapses rows and scores guideline points', () => {
  const H = 24, solid = solidFrom(['######....'], H);
  const { rt } = compile(doc({ clearFrames: 2 }, { solid }), { primitives: PRIMS });
  rt.step();
  // Put an I piece in play and place it flat in columns 6..9.
  st(rt).piece = { t: 0, r: 0, x: 3, y: 1, id: 99 };
  rt.step({ actions: { place: { r: 0, x: 6 } } });
  assert.equal(rt.state.counts.lines_cleared, 1);
  const ev = rt.state.events.find(e => e.name === 'lines_cleared');
  assert.equal(ev.count, 1);
  run(rt, 3);
  for (let x = 0; x < 10; x++) assert.equal(cell(rt, x, 0), null, 'the row cleared');
  assert.equal(rt.state.vars['falling.lines'], 1);
  assert.ok(rt.state.vars.score >= 100);
});

test('falling: T-spin double through an SRS rotation is detected and scored', () => {
  const H = 24;
  const rows = ['...#.#....', '###...####', '####.#####', '#########.'];
  const { rt } = compile(doc({ clearFrames: 0 }, { solid: solidFrom(rows, H) }), { primitives: PRIMS });
  rt.step();
  st(rt).piece = { t: 2, r: 1, x: 3, y: 20, id: 99 }; st(rt).lowest = 20;
  rt.step({ actions: { rotate_cw: true } });
  assert.equal(st(rt).piece.r, 2, 'rotated with the first kick test');
  rt.step({ actions: { hard_drop: true } });
  const ev = rt.state.events.find(e => e.name === 'lines_cleared');
  assert.equal(ev.spin, 'full');
  assert.equal(ev.count, 2);
  assert.equal(ev.points, 1200);
  assert.equal(rt.state.counts['tspin:full'], 1);
});

test('falling: hold swaps the piece once per drop', () => {
  const { rt } = compile(doc(), { primitives: PRIMS });
  rt.step();
  const t0 = st(rt).piece.t;
  rt.step({ actions: { hold: true } });
  assert.equal(st(rt).hold, t0);
  const t1 = st(rt).piece.t;
  rt.step({}); rt.step({ actions: { hold: true } });
  assert.equal(st(rt).piece.t, t1, 'second hold before locking is ignored');
});

test('falling: DAS/ARR shifts once, waits 10 frames, then repeats every 2', () => {
  const { rt } = compile(doc({ level: 1 }), { primitives: PRIMS });
  rt.step();
  const x0 = st(rt).piece.x, xs = [];
  for (let i = 0; i < 14; i++) { rt.step({ held: { shift_right: true } }); xs.push(st(rt).piece.x - x0); }
  assert.equal(xs[0], 1, 'moves on press');
  assert.equal(xs[8], 1, 'no repeat before DAS');
  assert.ok(xs[13] > 1, 'auto-repeat after DAS');
});

test('falling: lock delay is 30 frames when resting', () => {
  const { rt } = compile(doc({ rowsPerSecond: 60 }), { primitives: PRIMS });
  rt.step();
  let frames = 0; while (!rt.state.counts.piece_locked && frames < 200) { rt.step(); frames++; }
  assert.ok(frames > 30 && frames < 60, `locked after ${frames} frames`);
  assert.equal(gravityRows(1), 1 / 60);
});

test('falling: same seed and inputs replay identically; options enumerate placements', () => {
  const play = () => { const { rt } = compile(doc(), { primitives: PRIMS }); rt.step(); for (let i = 0; i < 6; i++) { const o = rt.availableOptions(); rt.step({ actions: o[i % o.length].actions }); run(rt, 2); } return rt; };
  const a = play(), b = play();
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.equal(solverKey(a), solverKey(b));
  assert.ok(a.state.counts.piece_locked >= 6);
  const opts = a.availableOptions();
  assert.ok(opts.length >= 9 && opts.length <= 40, `${opts.length} placements`);
});

test('falling: snapshot/restore resumes the same game', () => {
  const { rt } = compile(doc(), { primitives: PRIMS });
  run(rt, 5); const snap = rt.snapshot();
  rt.step({ actions: { hard_drop: true } }); run(rt, 10); const after = rt.snapshot();
  rt.restore(snap); rt.step({ actions: { hard_drop: true } }); run(rt, 10);
  assert.deepEqual(rt.snapshot(), after);
});

test('falling: pairs split and settle; linked capsule halves carry link tags', () => {
  const H = 12;
  const { rt } = compile(doc({ sets: ['pairs'], settle: true, clearRows: 'none', scoring: 'none', hidden: 1, pairStart: 'horizontal' }, { size: [6, H, 1], solid: [[2, 0, 0]] }), { primitives: PRIMS });
  rt.step();
  st(rt).piece = { ...st(rt).piece, x: 2, r: 1 }; // halves over columns 2 and 3
  rt.step({ actions: { hard_drop: true } });
  assert.ok(cell(rt, 2, 1), 'left half rests on the block');
  assert.ok(cell(rt, 3, 0), 'right half fell to the floor (split)');
  const cap = compile(doc({ sets: ['pairs'], link: true, clearRows: 'none', scoring: 'none', hidden: 1 }, { size: [6, H, 1] }), { primitives: PRIMS }).rt;
  cap.step(); cap.step({ actions: { hard_drop: true } });
  const cells = cap.space('well').cellsIn([[0, 0, 0], [5, H - 1, 0]]).map(c => c.block);
  assert.equal(cells.length, 2);
  assert.ok(cells.some(t => t.includes('link:u')) && cells.some(t => t.includes('link:d')));
});

test('falling: in a level, landings never bury the player and the guard keeps areas reachable', () => {
  // Board 3x4 at the bottom of a room; player at bottom-left.
  const rows = ['...', '...', '#.#', '...'];
  const { rt } = compile(doc({ hidden: 0, sets: ['small'], steer: 'drift', guard: 'reachable', passThrough: true, scoring: 'flat', clearRows: 'none', onTopOut: [] }, { size: [3, 4, 1], solid: solidFrom(rows, 4), player: [0, 0, 0] }), { primitives: PRIMS });
  rt.step();
  st(rt).piece = { t: 0, r: 0, x: 1, y: -1, id: 50 }; // a single cell over the middle column
  rt.step({ actions: { place: { r: 0, x: 1 } } });
  assert.equal(cell(rt, 1, 0), null, 'the cell that would cut off the right pocket stays open');
  assert.ok(rt.state.events.some(e => e.name === 'piece_blocked' && e.reason === 'cuts_off'));
  st(rt).piece = { t: 0, r: 0, x: 0, y: -1, id: 51 };
  rt.step({ actions: { place: { r: 0, x: 0 } } });
  assert.equal(cell(rt, 0, 0), null, 'never lands on the player');
});

test('falling: land = spawn makes brick entities that stack and clear as rows', () => {
  const { rt } = compile(doc({ hidden: 0, sets: ['small'], land: 'spawn', archetype: 'brick', clearRows: 'remove', clearFrames: 0, scoring: 'flat', onTopOut: [] }, { size: [2, 4, 1] }), { primitives: PRIMS });
  rt.step();
  st(rt).piece = { t: 0, r: 0, x: 0, y: -1, id: 1 }; // single cell at column 0
  rt.step({ actions: { place: { r: 0, x: 0 } } });
  st(rt).piece = { t: 0, r: 0, x: 0, y: -1, id: 2 };
  rt.step({ actions: { place: { r: 0, x: 0 } } });
  const bricks = () => Object.values(rt.state.entities).filter(e => e.archetype === 'brick').map(e => e.at.join(','));
  assert.deepEqual(bricks().sort(), ['0,0,0', '0,1,0'], 'second brick rests on the first');
  st(rt).piece = { t: 0, r: 0, x: 1, y: -1, id: 3 };
  rt.step({ actions: { place: { r: 0, x: 1 } } });
  assert.deepEqual(bricks(), ['0,1,0'], 'the full bottom row cleared');
  assert.equal(rt.state.counts['row_cleared_entity:brick'], 2);
});

test('falling: add_garbage pushes holed rows up from the bottom', () => {
  const { rt } = compile(doc({ garbage: 2 }), { primitives: PRIMS });
  let n = 0; for (let x = 0; x < 10; x++) if (cell(rt, x, 0) === 'garbage') n++;
  assert.equal(n, 9, 'one hole per row');
  rt.run([{ do: 'add_garbage', rows: 1 }]);
  let m = 0; for (let x = 0; x < 10; x++) if (cell(rt, x, 2) === 'garbage') m++;
  assert.equal(m, 9);
});

test('falling: top-out ends the game', () => {
  const full = Array.from({ length: 22 }, () => '#########.');
  const { rt } = compile(doc({}, { solid: solidFrom(full, 24) }), { primitives: PRIMS });
  run(rt, 3); rt.step({ actions: { hard_drop: true } }); run(rt, 3);
  assert.equal(rt.state.status, 'lost');
  assert.ok(rt.state.counts.top_out >= 1);
});

test('falling: preflight rejects bad configs with stable codes', () => {
  const registry = new Registry(PRIMS), logic = buildLogic(registry, Logic);
  const codes = w => preflight(doc(w), registry, logic).errors.map(e => e.code);
  assert.ok(codes({ board: { fall: 0 } }).includes('board_fall'));
  assert.ok(codes({ sets: ['pairs', 'standard'] }).includes('pieces_pairs_exclusive'));
  assert.ok(codes({ sets: ['custom'], custom: [{ id: 'x', rows: ['#.', '.#'] }] }).includes('piece_shape'));
  assert.ok(codes({ sets: ['custom'] }).includes('pieces_custom_missing'));
  assert.ok(codes({ steer: 'mouse' }).includes('param_option'));
  assert.ok(codes({ land: 'spawn' }).includes('falling_archetype'));
  assert.ok(codes({ lockDelay: -1 }).includes('param_range'));
  const flat = { id: 'engine.space.flat', card: { intent: 'no cells', provides: { capabilities: ['position'] } }, install(rt, c, i) { rt.defineSpace(i.id, {}); } };
  const reg2 = new Registry([...PRIMS, flat]);
  const r = preflight({ ...doc(), spaces: [{ id: 'well', use: 'engine.space.flat' }] }, reg2, buildLogic(reg2, Logic));
  assert.ok(r.errors.some(e => e.code === 'capability_missing'));
});
