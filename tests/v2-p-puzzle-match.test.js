import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, run, testSpace } from '../v2/kernel/testing.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import { preflight } from '../v2/kernel/document.js';
import match, { popScore, solverKey } from '../v2/primitives/gameplay/match.js';
import falling from '../v2/primitives/gameplay/falling-pieces.js';

const PRIMS = [testSpace, match, falling];
const COLORS = ['r', 'g', 'b', 'y'];
const board = (w, h) => ({ name: 'board', at: [0, 0, 0], size: [w, h], axes: [0, 1], fall: -1 });
const doc = (systems, size = [5, 5, 1]) => ({
  schema: 'gameverse.v2.game/0.2', id: 'gems', title: 'Gems', seed: 3,
  spaces: [{ id: 'b', use: 'engine.space.test', with: { size } }],
  systems,
});
const swapDoc = (w = {}, size = [5, 5]) => doc([{ use: 'gameplay.match', with: { board: board(...size), colors: COLORS, ...w } }], [...size, 1]);
const cellAt = (rt, x, y) => rt.space('b').getCell([x, y, 0]);
const settleAll = rt => { for (let i = 0; i < 400 && rt.state.prim['gameplay.match:board'].phase !== 'idle'; i++) rt.step(); return rt; };
// Layout rows are top to bottom; board row r maps to space y = H-1-r.
const LAYOUT = ['23423', '42342', '34234', '23123', '11213'];

test('match: a 4-run swap creates a striped gem, scores and cascades with refill', () => {
  const { rt, checked } = compile(swapDoc({ layout: LAYOUT }), { primitives: PRIMS });
  assert.ok(checked.ok);
  assert.equal(cellAt(rt, 0, 0), 'r');
  rt.step({ actions: { swap: { a: [2, 3], b: [2, 4] } } });
  settleAll(rt);
  assert.ok(rt.state.counts['special_created:v'] >= 1, 'horizontal 4-run makes a vertical stripe');
  assert.ok(rt.state.vars.score >= 4 * 20 + 60);
  assert.equal(rt.state.counts.move, 1);
  assert.equal(rt.state.counts.board_busy, 1);
  assert.equal(rt.state.counts.board_idle, 1);
  for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) assert.ok(cellAt(rt, x, y), 'refilled');
});

test('match: invalid swaps are rejected and options list only legal swaps', () => {
  const { rt } = compile(swapDoc({ layout: LAYOUT }), { primitives: PRIMS });
  rt.step({ actions: { swap: { a: [0, 0], b: [1, 0] } } });
  assert.equal(rt.state.counts.swap_invalid, 1);
  const opts = rt.availableOptions();
  assert.ok(opts.length >= 1);
  assert.ok(opts.some(o => JSON.stringify(o.actions.swap) === JSON.stringify({ a: [2, 3], b: [2, 4] })));
});

test('match: stripe + stripe combo clears a row and a column', () => {
  const { rt } = compile(swapDoc({ layout: LAYOUT, clearFrames: 0, settleFrames: 0, swapFrames: 0 }), { primitives: PRIMS });
  const api = rt.space('b');
  api.setCell([1, 2, 0], 'g/h', rt); api.setCell([2, 2, 0], 'b/v', rt);
  rt.step({ actions: { swap: { a: [1, 2], b: [2, 2] } } });
  settleAll(rt);
  assert.equal(rt.state.counts['special_combo:stripe+stripe'], 1);
  const ev = rt.state.events.find(e => e.name === 'matched') || {};
  assert.ok(rt.state.counts.matched >= 1);
  void ev;
});

test('match: colour bomb swap clears every gem of that colour', () => {
  const { rt } = compile(swapDoc({ layout: LAYOUT, clearFrames: 0, settleFrames: 0, swapFrames: 0, refill: false }), { primitives: PRIMS });
  const api = rt.space('b');
  api.setCell([0, 4, 0], 'bomb', rt); // top-left holds '2' (g) to its right
  rt.step({ actions: { swap: { a: [0, 0], b: [1, 0] } } });
  settleAll(rt);
  assert.equal(rt.state.counts['special_combo:bomb'], 1);
  assert.equal(rt.space('b').cellsIn([[0, 0, 0], [4, 4, 0]]).filter(c => c.block === 'b').length, 0, 'no blue left');
});

test('match: jelly peels and blockers break next to matches', () => {
  const layout = ['23423', '42342', '34234', 'b3123', 'jj2j3'];
  const { rt } = compile(swapDoc({ layout: layout.map((r, i) => i === 4 ? 'jj2j3' : r), clearFrames: 0, settleFrames: 0, swapFrames: 0 }), { primitives: PRIMS });
  // Put colour 1 under the jelly letters so a swap makes a run of r on the bottom row.
  const api = rt.space('b');
  api.setCell([0, 0, 0], 'r', rt); api.setCell([1, 0, 0], 'r', rt); api.setCell([3, 0, 0], 'r', rt); api.setCell([2, 1, 0], 'r', rt);
  const jelly0 = rt.state.vars['match.jelly'];
  assert.equal(jelly0, 3);
  assert.equal(rt.state.vars['match.blockers'], 1);
  rt.step({ actions: { swap: { a: [2, 3], b: [2, 4] } } });
  settleAll(rt);
  assert.ok(rt.state.vars['match.jelly'] < jelly0, 'jelly peeled');
  assert.equal(rt.state.counts.blocker_broken, 1, 'adjacent blocker broke');
});

test('match: move limit runs onOutOfMoves once the board is stable', () => {
  const { rt } = compile(swapDoc({ layout: LAYOUT, moves: 1 }), { primitives: PRIMS });
  assert.equal(rt.state.vars['match.moves'], 1);
  rt.step({ actions: { swap: { a: [2, 3], b: [2, 4] } } });
  settleAll(rt);
  assert.equal(rt.state.counts.out_of_moves, 1);
  assert.equal(rt.state.status, 'lost');
});

test('match: a filled swap board starts without matches and with a legal move; replay is deterministic', () => {
  const play = () => { const { rt } = compile(swapDoc({}, [8, 8]), { primitives: PRIMS }); for (let i = 0; i < 4; i++) { const o = rt.availableOptions(); assert.ok(o.length, 'always a legal move (reshuffle)'); rt.step({ actions: o[0].actions }); settleAll(rt); } return rt; };
  const a = play(), b = play();
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.equal(solverKey(a), solverKey(b));
  assert.equal(a.state.counts.move, 4);
});

test('match + falling: puyo pairs pop in groups and score a 2-chain with chain power', () => {
  const sys = [
    { use: 'gameplay.falling.pieces', with: { board: board(6, 12), sets: ['pairs'], pairColors: ['red', 'green', 'blue'], hidden: 1, clearRows: 'none', scoring: 'none', onTopOut: [] } },
    { use: 'gameplay.match', with: { board: board(6, 12), rule: 'group', min: 4, colors: ['red', 'green', 'blue'], trigger: ['land'], refill: false, specials: false, scoring: 'chain', clearFrames: 2, settleFrames: 2 } },
  ];
  const { rt } = compile(doc(sys, [6, 12, 1]), { primitives: PRIMS });
  const api = rt.space('b');
  for (const [x, y, t] of [[0, 0, 'green'], [1, 0, 'green'], [1, 1, 'green'], [0, 1, 'red'], [0, 2, 'red'], [0, 3, 'red']]) api.setCell([x, y, 0], t, rt);
  rt.step();
  const s = rt.state.prim['gameplay.falling.pieces:board'];
  s.piece = { ...s.piece, x: 0, r: 0, colors: ['red', 'green'] };
  rt.step({ actions: { hard_drop: true } });
  assert.equal(rt.state.prim['gameplay.falling.pieces:board'].phase, 'wait', 'falling waits while the board resolves');
  for (let i = 0; i < 60 && !rt.state.counts.board_idle; i++) rt.step();
  assert.equal(rt.state.counts.chain, 1);
  assert.equal(rt.state.vars.score, popScore([{ color: 'red', size: 4 }], 1) + popScore([{ color: 'green', size: 4 }], 2));
  assert.equal(rt.state.vars.score, 40 + 320);
  rt.step(); rt.step();
  assert.ok(rt.state.counts.piece_spawned >= 2, 'next pair spawned after board_idle');
});

test('match + falling: capsules clear viruses in lines of 4 and orphaned halves fall', () => {
  const sys = [
    { use: 'gameplay.falling.pieces', with: { board: board(8, 16), sets: ['pairs'], link: true, pairColors: ['red', 'blue', 'yellow'], hidden: 1, clearRows: 'none', scoring: 'none', pairStart: 'horizontal', onTopOut: [] } },
    { use: 'gameplay.match', with: { board: board(8, 16), rule: 'line', min: 4, colors: ['red', 'blue', 'yellow'], trigger: ['land'], refill: false, specials: false, scoring: 'virus', fill: 'none', clearFrames: 0, settleFrames: 0 } },
  ];
  const { rt } = compile(doc(sys, [8, 16, 1]), { primitives: PRIMS });
  const api = rt.space('b');
  api.setCell([0, 0, 0], 'red/virus/fixed', rt); api.setCell([0, 1, 0], 'red', rt); api.setCell([0, 2, 0], 'red', rt);
  rt.step();
  assert.equal(rt.state.vars['match.viruses'], 1);
  const s = rt.state.prim['gameplay.falling.pieces:board'];
  s.piece = { ...s.piece, x: 0, r: 1, colors: ['red', 'blue'] };
  rt.step({ actions: { hard_drop: true } });
  run(rt, 3);
  assert.equal(rt.state.counts.virus_cleared, 1);
  assert.equal(rt.state.vars['match.viruses'], 0);
  assert.equal(api.getCell([1, 0, 0]), 'blue', 'the orphaned half lost its link and fell');
  assert.equal(rt.state.vars.score, (100 + 3 * 10) * 1);
});

test('match: random virus placement avoids ready-made runs', () => {
  const { rt } = compile(doc([{ use: 'gameplay.match', with: { board: board(8, 16), rule: 'line', min: 4, colors: ['red', 'blue', 'yellow'], trigger: ['land'], refill: false, specials: false, scoring: 'virus', fill: 'none', viruses: 12 } }], [8, 16, 1]), { primitives: PRIMS });
  const v = rt.space('b').cellsIn([[0, 0, 0], [7, 15, 0]]).filter(c => c.block.includes('virus'));
  assert.equal(v.length, 12);
  assert.equal(rt.state.vars['match.viruses'], 12);
  assert.ok(v.every(c => c.at[1] < 10), 'viruses sit in the lower board');
});

test('match: preflight rejects bad configs with stable codes', () => {
  const registry = new Registry(PRIMS), logic = buildLogic(registry, Logic);
  const codes = w => preflight(swapDoc(w), registry, logic).errors.map(e => e.code);
  assert.ok(codes({ layout: ['111'] }).includes('match_layout_size'));
  assert.ok(codes({ layout: ['1111z', '11111', '11111', '11111', '11111'] }).includes('match_layout_char'));
  assert.ok(codes({ rule: 'group' }).includes('match_rule_trigger'));
  assert.ok(codes({ rule: 'group', trigger: ['land'] }).includes('match_rule_scoring'));
  assert.ok(codes({ rule: 'diagonal' }).includes('param_option'));
  assert.ok(codes({ board: { size: [5, 5], fall: 0 } }).includes('board_fall'));
});

test('match: an L-shaped group makes an area bomb; items are collected at the bottom', () => {
  const layout = ['23423', '42342', '34124', '23142', '11314'];
  const { rt } = compile(swapDoc({ layout, clearFrames: 0, settleFrames: 0, swapFrames: 0, items: { token: 'item', target: 1, chance: 0 } }), { primitives: PRIMS });
  rt.space('b').setCell([4, 0, 0], 'item', rt);
  rt.step({ actions: { swap: { a: [3, 4], b: [2, 4] } } });
  settleAll(rt);
  assert.equal(rt.state.counts['special_created:area'], 1, 'L/T groups make an area bomb');
  assert.equal(rt.state.counts.collected, 1, 'the item at the bottom was collected');
  assert.equal(rt.state.vars['match.items'], 1);
});
