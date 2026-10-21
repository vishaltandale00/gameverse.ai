// Placement evaluator for any falling-pieces board (ported from the puzzle
// kit's El-Tetris bot). Every option is a placement; each is simulated on a
// snapshot through the real step function and the resulting board is scored
// with the Dellacherie features and El-Tetris weights (landing height, rows
// cleared, row and column transitions, holes, cumulative wells), with a
// one-piece lookahead over the best candidates. Works on any board exposed by
// the `board` service or an editCells space; y is up (row 0 at the bottom).
import { boardOf, readBoard, filledCount, simulateOption, untilDecision, multiSeed, ownerPath, problem, seedBudgets } from './common.js';

export const WEIGHTS = { landing: -4.500158825082766, cleared: 3.4181268101392694, rowT: -3.2178882868487753, colT: -9.348695305445199, holes: -7.899265427351652, wells: -3.3855972247263626 };

/** Dellacherie features of a board (rows[y][x], y up). */
export function features(rows) {
  const H = rows.length, W = rows[0]?.length || 0, full = (x, y) => x < 0 || x >= W || y < 0 || (y < H && rows[y][x] !== null);
  let rowT = 0, colT = 0, holes = 0, wells = 0, maxH = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x <= W; x++) if (full(x - 1, y) !== full(x, y)) rowT++;
  for (let x = 0; x < W; x++) {
    let top = -1;
    for (let y = H - 1; y >= 0; y--) if (rows[y][x] !== null) { top = y; break; }
    maxH = Math.max(maxH, top + 1);
    for (let y = 0; y <= top; y++) if (rows[y][x] === null) holes++;
    for (let y = 0; y < H; y++) if (full(x, y - 1) !== full(x, y)) colT++;
    if (full(x, H - 1)) colT++; // the space above the board counts as empty
    let run = 0;
    for (let y = H - 1; y >= 0; y--) { if (!full(x, y) && full(x - 1, y) && full(x + 1, y)) wells += ++run; else run = 0; }
  }
  return { rowT, colT, holes, wells, maxH };
}

/** Score the board after a placement. pieceCells = the piece size (cells a placement adds when nothing clears). */
export function evaluatePlacement(before, after, pieceCells) {
  const W = after[0]?.length || 1;
  const cleared = Math.max(0, Math.round((filledCount(before) + pieceCells - filledCount(after)) / W));
  let sy = 0, n = 0;
  for (let y = 0; y < after.length; y++) for (let x = 0; x < W; x++) if (after[y][x] !== null && before[y]?.[x] === null) { sy += y; n++; }
  const landing = n ? sy / n + 0.5 : after.length;
  const f = features(after);
  return { v: WEIGHTS.landing * landing + WEIGHTS.cleared * cleared + WEIGHTS.rowT * f.rowT + WEIGHTS.colT * f.colT + WEIGHTS.holes * f.holes + WEIGHTS.wells * f.wells, cleared, maxH: f.maxH };
}

const mode = list => { const c = new Map(); for (const v of list) c.set(v, (c.get(v) || 0) + 1); return [...c].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 0; };

/** Candidates from the current decision point: [{ i, after, v, cleared }]. */
function candidates(rt, board) {
  const snap = rt.snapshot(), before = readBoard(board), n = rt.availableOptions().length, raw = [];
  for (let i = 0; i < n; i++) { simulateOption(rt, snap, i); raw.push({ i, after: readBoard(board), status: rt.state.status, snap: rt.snapshot() }); }
  rt.restore(snap);
  const piece = Math.max(1, mode(raw.map(r => filledCount(r.after) - filledCount(before)).filter(d => d > 0)));
  return raw.map(r => { const e = evaluatePlacement(before, r.after, piece); return { ...r, ...e, v: r.status === 'won' ? 1e9 : r.status === 'lost' ? -1e9 : e.v }; });
}

/** Choose the best option index at a decision point, with optional one-piece lookahead. */
export function choosePlacement(rt, board, { depth = 2, top = 5 } = {}) {
  const first = candidates(rt, board).sort((x, y) => y.v - x.v);
  if (!first.length) return null;
  if (depth < 2) return first[0];
  const snap = rt.snapshot();
  let best = null;
  for (const c of first.slice(0, top)) {
    rt.restore(c.snap);
    let v = c.v;
    if (c.status === 'playing' && rt.availableOptions().length) {
      const next = candidates(rt, board);
      v = next.length ? Math.max(...next.map(x => x.v)) + WEIGHTS.cleared * c.cleared + 0.25 * c.v : -1e9;
    }
    if (!best || v > best.v) best = { ...c, v };
  }
  rt.restore(snap);
  return best;
}

export default {
  id: 'placement',
  intent: 'Falling-pieces boards: placement search with El-Tetris weights and next-piece lookahead; survives a number of pieces and meets the goal.',
  requires: { options: true, board: true },
  hints: ['gameplay.falling'],
  /** Applies when placements fill the board: most options add cells. */
  detect(ctx) {
    const rt = ctx.make(ctx.seed); untilDecision(rt, 600);
    const board = boardOf(rt); const n = rt.availableOptions().length;
    if (!board || !n) return false;
    const snap = rt.snapshot(), before = filledCount(readBoard(board));
    let grew = 0;
    for (let i = 0; i < Math.min(n, 6); i++) { simulateOption(rt, snap, i); if (filledCount(readBoard(board)) > before) grew++; }
    return grew >= Math.min(n, 6) * 0.8;
  },
  run(ctx, { pieces = 150, depth = 2, seeds = [1, 2, 3], maxSteps = Infinity } = {}) {
    const sb = seedBudgets(maxSteps);
    /** The budget of the seed being played (seedBudgets: one per seed). @type {any} */
    let b = null;
    const probe = ctx.make(ctx.seed); untilDecision(probe, 600);
    const play = seed => {
      const rt = (b = sb.budget()).meter(ctx.make(seed)), board = boardOf(rt);
      let placed = 0, cleared = 0, maxH = 0;
      untilDecision(rt, 600);
      while (rt.state.status === 'playing' && placed < pieces && !b.over()) {
        const c = choosePlacement(rt, board, { depth });
        if (!c) break;
        simulateOption(rt, rt.snapshot(), c.i); // the real move: same simulation, kept
        placed++; cleared += c.cleared; maxH = Math.max(maxH, c.maxH);
      }
      const won = rt.state.status === 'won' || (rt.state.status === 'playing' && placed >= pieces);
      return { seed, won, status: rt.state.status, pieces: placed, cleared, maxHeight: maxH, budget: b.hit && !won };
    };
    // Every seed it is given is played (one run per seed): one seed must win, several at two in three.
    const r = multiSeed(play, { seeds, passRate: seeds.length > 1 ? 2 / 3 : 1 });
    const path = ownerPath(ctx, probe, ['gameplay.falling', 'gameplay.puzzle']);
    const problems = [];
    const finished = r.runs.filter(x => !x.budget);
    if (!finished.length) problems.push(problem('budget_exhausted', path, 'placement search ran out of budget before a run finished', { severity: 'warning' }));
    else if (!r.ok) { const f = finished.find(x => !x.won) || finished[0]; problems.push(problem('level_too_hard', path, `a placement-search bot ${f.status === 'lost' ? `topped out after ${f.pieces} pieces` : `did not meet the goal in ${f.pieces} pieces`} in ${r.runs.length - r.wins}/${r.runs.length} runs`, { hint: 'lower the fall speed, use fewer garbage rows or a shorter starting layout' })); }
    return { ok: !problems.some(p => p.severity === 'error'), proven: r.ok ? [`a placement bot (El-Tetris weights, lookahead ${depth - 1}) met the goal or survived ${pieces} pieces in ${r.wins}/${r.runs.length} runs`] : [], problems, metrics: { runs: r.runs }, exhaustive: false, budget: sb.report() };
  },
};
