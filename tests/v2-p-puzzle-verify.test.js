// The verify strategies (v2/verify/strategies) play puzzle primitives through rt only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogue } from '../v2/primitives/index.js';
import { preflight } from '../v2/kernel/document.js';
import { select, strategies } from '../v2/verify/strategies/index.js';
import { maker } from '../v2/verify/drive.js';

const cat = catalogue();
const ctxOf = doc => {
  const r = preflight(doc, cat.registry, cat.logic);
  assert.ok(r.ok, JSON.stringify(r.errors));
  return { doc: r.doc, registry: cat.registry, logic: cat.logic, make: maker(r.doc, cat.registry, cat.logic), seed: 1, capabilities: r.capabilities, used: new Set(r.doc.systems.map(s => s.use)), playerSpace: r.doc.spaces[0].id };
};
const board = (w, h) => ({ name: 'board', at: [0, 0], size: [w, h], axes: [0, 1], fall: -1 });
const grid = (w, h, systems) => ({ schema: 'gameverse.v2.game/0.2', id: 'v', title: 'V', seed: 1, spaces: [{ id: 'g', use: 'engine.space.grid', with: { size: [w, h] } }], systems });

test('verify: placement strategy is chosen for falling pieces and survives through the real step', () => {
  const ctx = ctxOf(grid(10, 22, [{ use: 'gameplay.falling.pieces', with: { board: board(10, 22), clearFrames: 0, next: 1 } }]));
  assert.deepEqual(select(ctx).chosen.map(c => c.s.id), ['placement']);
  const r = strategies.get('placement').run(ctx, { pieces: 30, depth: 1, seeds: [1], budgetMs: 20000 });
  assert.equal(r.metrics.runs[0].pieces, 30, JSON.stringify(r.problems));
  assert.equal(r.ok, true);
});

test('verify: expectimax plays slide boards by sampling the game rng', () => {
  const ctx = ctxOf(grid(4, 4, [{ use: 'gameplay.slide.merge', with: { board: board(4, 4), slideFrames: 0, target: 64 } }]));
  assert.deepEqual(select(ctx).chosen.map(c => c.s.id), ['expectimax']);
  const r = strategies.get('expectimax').run(ctx, { seeds: [1, 2], depth: 1, samples: 2, budgetMs: 20000 });
  assert.ok(r.metrics.runs.every(x => x.maxTile >= 32 || x.won), JSON.stringify(r.metrics.runs.map(x => ({ ...x, trace: undefined }))));
});

test('verify: greedy plays match boards through swap options', () => {
  const ctx = ctxOf(grid(8, 8, [{ use: 'gameplay.match', with: { board: board(8, 8), moves: 10, clearFrames: 0, settleFrames: 0, swapFrames: 0, onOutOfMoves: [{ do: 'end_game', outcome: 'won' }] } }]));
  assert.deepEqual(select(ctx).chosen.map(c => c.s.id), ['greedy']);
  const r = strategies.get('greedy').run(ctx, { seeds: [1, 2], maxMoves: 10, budgetMs: 20000 });
  assert.ok(r.metrics.runs.length >= 1, JSON.stringify(r.problems));
  assert.ok(!r.problems.some(p => p.code === 'no_start_move'));
});
