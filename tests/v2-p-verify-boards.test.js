import test from 'node:test';
import assert from 'node:assert/strict';
import { select, strategies } from '../v2/verify/strategies/index.js';
import { features, evaluatePlacement } from '../v2/verify/strategies/placement.js';
import { slideHeuristic } from '../v2/verify/strategies/expectimax.js';
import { maker } from '../v2/verify/drive.js';
import { verify } from '../v2/verify/index.js';
import { fixtureCatalogue, normalized, cellDoc } from './v2-p-verify-fixtures.js';

const cat = fixtureCatalogue();
const ctxOf = doc => { const n = normalized(doc, cat); return { doc: n.doc, registry: cat.registry, logic: cat.logic, make: maker(n.doc, cat.registry, cat.logic), seed: 1, capabilities: n.checked.capabilities, used: new Set(n.doc.systems.map(s => s.use)), playerSpace: n.doc.spaces[0].id }; };
const chosen = ctx => select(ctx).chosen.map(c => c.s.id);
const fallingDoc = (w, h, goal, types) => cellDoc({ id: 'fall', size: [w, h, 1], at: [0, h - 1, 0], systems: [{ use: 'gameplay.fixture.falling', with: { goal, ...(types ? { types } : {}) } }] });
const slideDoc = (target, moves = 1000) => cellDoc({ id: 'slide', size: [1, 1, 1], systems: [{ use: 'gameplay.fixture.slide', with: { target, moves } }] });
const matchDoc = (w = {}) => cellDoc({ id: 'match', size: [1, 1, 1], systems: [{ use: 'gameplay.fixture.match', with: w }] });

test('Dellacherie features read any rows[y][x] board (y up)', () => {
  const _ = null, X = 'b';
  const rows = [[_, X, _, X], [X, X, _, X], [_, _, _, X]];
  const f = features(rows);
  assert.equal(f.holes, 1, 'the empty cell under column 0');
  assert.equal(f.maxH, 3);
  assert.ok(f.wells >= 1);
  const before = [[X, X, X, _], [_, _, _, _]], after = [[_, _, _, _], [_, _, _, _]];
  assert.equal(evaluatePlacement(before, after, 1).cleared, 1, 'a full row cleared');
  assert.ok(slideHeuristic([['2', '2'], [null, null]]) > slideHeuristic([['2', null], [null, '2']]), 'mergeable neighbours score higher');
});

test('board strategies are selected by behavior, not by genre names', () => {
  assert.deepEqual(chosen(ctxOf(fallingDoc(8, 14, 10))), ['placement']);
  assert.deepEqual(chosen(ctxOf(slideDoc(64))), ['expectimax']);
  assert.deepEqual(chosen(ctxOf(matchDoc())), ['greedy']);
  assert.ok(strategies.get('placement').requires.board);
});

test('placement (El-Tetris) meets a line goal through the real step function', () => {
  const ctx = ctxOf(fallingDoc(8, 14, 4));
  const r = strategies.get('placement').run(ctx, { depth: 2, seeds: [1] });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.equal(r.metrics.runs[0].status, 'won');
  assert.ok(r.metrics.runs[0].maxHeight <= 8);
});

test('placement flags an unplayable board as level_too_hard with a hint', () => {
  const ctx = ctxOf(fallingDoc(5, 8, 20, ['O'])); // an odd width of 2×2 pieces can never fill a row
  const r = strategies.get('placement').run(ctx, { depth: 1, seeds: [1, 2, 3] });
  assert.equal(r.ok, false);
  const p = r.problems[0];
  assert.equal(p.code, 'level_too_hard');
  assert.equal(p.path, 'systems[0]');
  assert.ok(p.hint);
});

test('expectimax samples the game RNG for chance and reaches the target tile', () => {
  const r = strategies.get('expectimax').run(ctxOf(slideDoc(64)), { seeds: [1, 2, 3, 4], depth: 2, samples: 3 });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.ok(r.metrics.rate >= 0.75);
  const hard = strategies.get('expectimax').run(ctxOf(slideDoc(256, 30)), { seeds: [1, 2] });
  assert.equal(hard.problems[0].code, 'goal_unreached');
  assert.match(hard.problems[0].hint, /lower target/);
});

test('greedy resolves swaps without peeking at refills; checks the first move', () => {
  const ok = strategies.get('greedy').run(ctxOf(matchDoc({ target: 30, moves: 20 })), { seeds: [1, 2, 3] });
  assert.equal(ok.ok, true, JSON.stringify(ok.problems));
  const hard = strategies.get('greedy').run(ctxOf(matchDoc({ target: 500, moves: 4 })), { seeds: [1, 2, 3] });
  assert.equal(hard.problems[0].code, 'goal_unreached');
  const stuck = [['r', 'g', 'b', 'y'], ['b', 'y', 'r', 'g'], ['r', 'g', 'b', 'y'], ['b', 'y', 'r', 'g']]; // no swap lines up three
  const none = strategies.get('greedy').run(ctxOf(matchDoc({ w: 4, h: 4, colors: ['r', 'g', 'b', 'y'], layout: stuck })), { seeds: [1] });
  assert.ok(none.problems.some(p => p.code === 'no_start_move' && p.path === 'systems[0]'));
});

test('verify runs the chosen board strategy and reports it', async () => {
  const r = await verify(slideDoc(64), cat.registry, cat.logic, { budgetMs: 4000, plot: { maxStates: 300 }, playtest: { maxRounds: 100 } });
  assert.equal(r.strategies.ran.length, 1);
  assert.equal(r.strategies.ran[0].id, 'expectimax');
  assert.equal(r.strategies.ran[0].ok, true);
  assert.equal(r.invariants.checks.deterministic, true);
  assert.equal(r.invariants.checks.roundTrip, true);
});
