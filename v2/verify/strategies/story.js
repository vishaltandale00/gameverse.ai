// Story mode bot: the plot solver (v2/verify/solve.js) searches the real
// runtime over the player's options (travel macros included) for a path to a
// winning ending, and the path is replayed from a fresh world. When verify()
// already solved the plot (ctx.plot), that result is reused instead of
// searching again.
import { solve } from '../solve.js';
import { budget as makeBudget } from '../util.js';
import { problem } from './common.js';

/** Winning ending paths of a solver result: [[ending, path]] shortest first. */
export const winningEndings = r => Object.entries(r?.endings || {}).filter(([k]) => r.outcomes?.[k] === 'won').sort((a, b) => a[1].length - b[1].length);

export default {
  id: 'story',
  intent: 'Story games: the plot solver must find a path of player options to a winning ending, and that path must replay.',
  requires: {},
  hints: ['plot.storyboard'],
  detect(ctx) { return (ctx.doc.plot?.storyboard?.acts || []).length > 0; },
  run(ctx, { search = 'best-first', budgetMs = 2000, maxStates = 20000, settleSteps = 2, ...rest } = {}) {
    const b = makeBudget({ ms: budgetMs });
    const reuse = ctx.plot?.endings ? ctx.plot : null;
    // The plot stage of verify() already searched (and reported its own problems): reuse it rather than search twice.
    const r = reuse || solve(ctx.doc, ctx.registry, ctx.logic, { seed: ctx.seed, search, budgetMs, maxStates, settleSteps, ...rest });
    const wins = winningEndings(r), problems = [];
    const won = wins.length > 0 && r.replayed !== false;
    if (!wins.length && !reuse) problems.push(problem(r.exhaustive ? 'plot_uncompletable' : 'plot_unproven', 'plot.storyboard', r.exhaustive ? 'no sequence of player options reaches a winning ending' : `no winning ending found within the search budget (${r.states} states)`, { severity: r.exhaustive ? 'error' : 'warning', hint: 'check beat triggers, gates and the ending conditions' }));
    else if (wins.length && r.replayed === false && !reuse) problems.push(problem('nondeterministic', 'plot.storyboard', `the path to '${wins[0][0]}' did not replay to the same ending`));
    return {
      ok: !problems.some(p => p.severity === 'error'), proven: won ? [`the plot solver reached '${wins[0][0]}' in ${wins[0][1].length} options and it replays`] : [], problems,
      metrics: { runs: [{ seed: ctx.seed ?? null, won, ending: wins[0]?.[0] ?? null, path: wins[0]?.[1] ?? [], states: r.states, exhaustive: r.exhaustive, reused: r === reuse }], rate: won ? 1 : 0 },
      exhaustive: Boolean(r.exhaustive), budget: b.report(),
    };
  },
};
