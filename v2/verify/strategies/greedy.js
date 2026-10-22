// Greedy simulate-move for any options-driven board (ported from the puzzle
// kit's match-3 and chain bots): every option is resolved to the next
// decision point on a snapshot, with the RNG swapped for a scratch value so
// refills are not peeked at, and scored by the document's objective plus the
// number of cells it changed; one-option lookahead over the top candidates.
// Also checks that the board starts with at least one move.
import { boardOf, readBoard, simulateOption, untilDecision, multiSeed, ownerPath, problem, seedBudgets } from './common.js';
import { prng } from '../util.js';
import { objective } from '../objective.js';

const changed = (a, b) => { let n = 0; for (let y = 0; y < a.length; y++) for (let x = 0; x < a[y].length; x++) if (a[y][x] !== b[y]?.[x]) n++; return n; };

export function chooseGreedy(rt, board, score, { lookahead = 1, top = 4, scratch } = {}) {
  const snap = rt.snapshot(), before = readBoard(board), base = score(rt), n = rt.availableOptions().length;
  const cands = [];
  for (let i = 0; i < n; i++) {
    simulateOption(rt, snap, i, { rng: scratch });
    const v = rt.state.status === 'lost' ? -1e9 : (score(rt) - base) * 100 + changed(before, readBoard(board)) + (rt.state.status === 'won' ? 1e9 : 0);
    cands.push({ i, v, snap: rt.snapshot() });
  }
  cands.sort((x, y) => y.v - x.v);
  if (!lookahead || !cands.length) { rt.restore(snap); return cands[0] || null; }
  const heads = cands.slice(0, top);
  for (const c of heads) {
    rt.restore(c.snap);
    const m = rt.state.status === 'playing' && rt.availableOptions().length ? chooseGreedy(rt, board, score, { lookahead: lookahead - 1, top, scratch: (scratch * 31 + 7) >>> 0 }) : null;
    c.v2 = c.v + 0.5 * (m ? m.v : 0);
  }
  rt.restore(snap);
  return heads.reduce((m, c) => (c.v2 > m.v2 ? c : m));
}

export default {
  id: 'greedy',
  intent: 'Options-driven boards (match, chain, swap): greedy resolve-and-score with one-move lookahead; every level starts with a move and the goal is met in most runs.',
  requires: { options: true, board: true },
  hints: ['gameplay.match'],
  /** Applies when choices rewrite the board (a cell space whose options only move the player is not a board game). */
  detect(ctx) {
    const rt = ctx.make(ctx.seed); untilDecision(rt, 600);
    const board = boardOf(rt), n = rt.availableOptions().length;
    if (!board || !n) return false;
    const snap = rt.snapshot(), before = readBoard(board);
    for (let i = 0; i < Math.min(n, 6); i++) { simulateOption(rt, snap, i); if (changed(before, readBoard(board)) > 0) return true; }
    return false;
  },
  run(ctx, { maxMoves = 400, seeds = [1, 2, 3, 4, 5, 6, 7, 8], passRate = 0.7, lookahead = 1, maxSteps = Infinity } = {}) {
    const sb = seedBudgets(maxSteps);
    /** The budget of the seed being played (seedBudgets: one per seed). @type {any} */
    let b = null;
    const probe = ctx.make(ctx.seed); untilDecision(probe, 600);
    const { score } = objective(ctx.doc, ctx.registry, ctx.logic);
    const problems = [], path = ownerPath(ctx, probe, ['gameplay.match', 'gameplay.puzzle']);
    const play = seed => {
      const rt = (b = sb.budget()).meter(ctx.make(seed)), board = boardOf(rt), rand = prng(`greedy:${seed}`);
      untilDecision(rt, 600);
      if (rt.state.status === 'playing' && !rt.availableOptions().length && !problems.some(p => p.code === 'no_start_move')) problems.push(problem('no_start_move', path, 'the board starts with no valid move', { hint: 'use fewer holes and blockers so pieces can line up' }));
      let moves = 0;
      while (rt.state.status === 'playing' && moves < maxMoves && !b.over()) {
        const c = chooseGreedy(rt, board, score, { lookahead, scratch: Math.floor(rand() * 2 ** 32) });
        if (!c) break;
        simulateOption(rt, rt.snapshot(), c.i);
        moves++;
        if (!rt.availableOptions().length && rt.state.status === 'playing') break;
      }
      return { seed, won: rt.state.status === 'won', status: rt.state.status, ending: rt.state.ending, moves, budget: rt.state.status === 'playing' && b.hit };
    };
    const r = multiSeed(play, { seeds, passRate });
    const finished = r.runs.filter(x => !x.budget);
    if (!finished.length) problems.push(problem('budget_exhausted', path, 'greedy play ran out of budget before a run finished', { severity: 'warning' }));
    else if (finished.filter(x => x.won).length / finished.length < passRate) {
      const fail = finished.filter(x => !x.won).map(x => x.ending || x.status);
      problems.push(problem('goal_unreached', path, `a greedy bot met the goal in ${finished.filter(x => x.won).length}/${finished.length} runs; it usually ended '${fail[0]}'`, { hint: 'a lower target, more moves, or fewer blockers' }));
    }
    return { ok: !problems.some(p => p.severity === 'error'), proven: r.ok ? [`a greedy bot met the goal in ${r.wins}/${r.runs.length} runs`] : [], problems, metrics: { runs: r.runs, rate: r.rate }, exhaustive: false, budget: sb.report() };
  },
};
