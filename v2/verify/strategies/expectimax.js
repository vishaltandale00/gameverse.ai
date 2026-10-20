// Expectimax for any stochastic slide/merge board (ported from the puzzle
// kit's 2048 bot). Max nodes are the runtime's options; chance nodes sample
// the game's own randomness by reseeding state.rng on a snapshot, so spawns
// are drawn the way the game draws them, without peeking at the real next
// draw. Leaves use the standard line heuristic on numeric cells (empty cells,
// mergeable neighbours, monotonicity, a penalty on large scattered tiles),
// scored on rows and columns. Depth grows as the board crowds.
import { boardOf, readBoard, numeric, simulateOption, untilDecision, chanceSeeds, multiSeed, ownerPath, problem } from './common.js';
import { budget as makeBudget, stableStringify } from '../util.js';

const rank = v => (v > 0 ? Math.log2(v) : 0);
function lineHeuristic(line) {
  let empty = 0, merges = 0, prev = 0, counter = 0, sum = 0, monoL = 0, monoR = 0;
  for (const x of line) {
    sum += Math.pow(x, 3.5);
    if (!x) empty++;
    else { if (prev === x) counter++; else if (counter > 0) { merges += 1 + counter; counter = 0; } prev = x; }
  }
  if (counter > 0) merges += 1 + counter;
  for (let j = 1; j < line.length; j++) { const a = line[j - 1], b = line[j]; if (a > b) monoL += a ** 4 - b ** 4; else monoR += b ** 4 - a ** 4; }
  return 200000 + 270 * empty + 700 * merges - 47 * Math.min(monoL, monoR) - 11 * sum;
}
/** Heuristic of a numeric board (rows[y][x]); non-numeric cells (rocks) count as 0. */
export function slideHeuristic(rows) {
  const g = rows.map(r => r.map(c => { const v = numeric(c); return v === null ? 0 : rank(v); }));
  let t = 0;
  for (const r of g) t += lineHeuristic(r);
  for (let x = 0; x < (g[0]?.length || 0); x++) t += lineHeuristic(g.map(r => r[x]));
  return t;
}
const maxTile = rows => Math.max(0, ...rows.flat().map(c => numeric(c) ?? 0));

export function chooseExpectimax(rt, board, { depth = 2, samples = 3, b = null, memo = new Map() } = {}) {
  const value = (d) => {
    if (rt.state.status !== 'playing') return rt.state.status === 'won' ? 1e12 : 0;
    const rows = readBoard(board), key = `${d}:${stableStringify(rows)}`;
    if (d <= 0) return slideHeuristic(rows);
    if (memo.has(key)) return memo.get(key);
    const snap = rt.snapshot(), n = rt.availableOptions().length;
    let best = n ? -Infinity : slideHeuristic(rows) * 0.5;
    for (let i = 0; i < n; i++) {
      let total = 0;
      const seeds = chanceSeeds(rt, samples, i);
      for (const s of seeds) { simulateOption(rt, snap, i, { rng: s, b }); total += value(d - 1); }
      best = Math.max(best, total / seeds.length);
    }
    rt.restore(snap);
    memo.set(key, best);
    return best;
  };
  const snap = rt.snapshot(), n = rt.availableOptions().length, rows = readBoard(board);
  const empties = rows.flat().filter(c => c === null).length, distinct = new Set(rows.flat().filter(c => c !== null)).size;
  const d = Math.min(depth, empties >= 4 ? 1 : distinct >= 10 || empties <= 1 ? depth : 2);
  let bestI = -1, bestV = -Infinity;
  for (let i = 0; i < n; i++) {
    let total = 0;
    const seeds = chanceSeeds(rt, samples, `top${i}`);
    for (const s of seeds) { simulateOption(rt, snap, i, { rng: s, b }); total += value(d - 1); }
    if (total / seeds.length > bestV) { bestV = total / seeds.length; bestI = i; }
  }
  rt.restore(snap);
  return bestI;
}

export default {
  id: 'expectimax',
  intent: 'Stochastic slide/merge boards: expectimax over options with chance sampled from the game RNG; reaches the goal tile in most runs.',
  requires: { options: true, board: true },
  hints: ['gameplay.slide'],
  /** Applies when board cells are numeric and an option's outcome depends on the RNG. */
  detect(ctx) {
    const rt = ctx.make(ctx.seed); untilDecision(rt, 600);
    const board = boardOf(rt), n = rt.availableOptions().length;
    if (!board || !n) return false;
    const cells = readBoard(board).flat().filter(c => c !== null);
    if (!cells.length || cells.filter(c => numeric(c) !== null).length < cells.length * 0.6) return false;
    const snap = rt.snapshot(), seen = new Set();
    for (const s of chanceSeeds(rt, 4, 'detect')) { simulateOption(rt, snap, 0, { rng: s }); seen.add(stableStringify(readBoard(board))); }
    return seen.size > 1;
  },
  run(ctx, { depth = 2, samples = 3, maxMoves = 3000, seeds = [1, 2, 3, 4, 5, 6, 7, 8], passRate = 0.7, budgetMs = 2000, maxSteps = Infinity } = {}) {
    const b = makeBudget({ ms: budgetMs, steps: maxSteps });
    const probe = ctx.make(ctx.seed); untilDecision(probe, 600);
    const play = seed => {
      const rt = ctx.make(seed), board = boardOf(rt), memo = new Map();
      let moves = 0;
      untilDecision(rt, 600, b);
      while (rt.state.status === 'playing' && moves < maxMoves && !b.over()) {
        if (memo.size > 50000) memo.clear();
        const i = chooseExpectimax(rt, board, { depth, samples, b, memo });
        if (i < 0) break;
        simulateOption(rt, rt.snapshot(), i, { b });
        moves++;
      }
      return { seed, won: rt.state.status === 'won', status: rt.state.status, moves, maxTile: maxTile(readBoard(board)), budget: rt.state.status === 'playing' && b.hit };
    };
    const r = multiSeed(play, { seeds, passRate, b });
    const finished = r.runs.filter(x => !x.budget);
    const path = ownerPath(ctx, probe, ['gameplay.slide', 'gameplay.puzzle']);
    const problems = [];
    if (!finished.length) problems.push(problem('budget_exhausted', path, 'expectimax ran out of budget before a run finished', { severity: 'warning' }));
    else if (finished.filter(x => x.won).length / finished.length < passRate) {
      const sorted = finished.map(x => x.maxTile).sort((x, y) => y - x), fair = sorted[Math.max(0, Math.ceil(sorted.length * passRate) - 1)];
      problems.push(problem('goal_unreached', path, `an expectimax bot reached the goal in ${finished.filter(x => x.won).length}/${finished.length} runs (best tile ${sorted[0]})`, { hint: `a lower target (about ${fair}) or more moves` }));
    }
    return { ok: !problems.some(p => p.severity === 'error'), proven: r.ok ? [`an expectimax bot (depth ≤ ${depth}, ${samples} chance samples) met the goal in ${r.wins}/${r.runs.length} runs`] : [], problems, metrics: { runs: r.runs, rate: r.rate }, exhaustive: false, budget: b.report() };
  },
};
