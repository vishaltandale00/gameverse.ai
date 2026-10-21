// Story mode bot: the plot solver (v2/verify/solve.js) searches the real runtime over the player's options (travel
// macros included) for a path to a winning ending; the bot then plays that path on the world of each seed it is given
// through the controls a person has (ctx.make is controlled: v2/verify/controls.js). An option is taken by issuing its
// actions (a key, or the UI that lists the options); a travel macro, which the solver may realize by warping, is taken
// the way a person travels: the travel verb toward its zone (a choice verb, issued by the UI the host mounts), then
// waiting until the player is there. When verify() already solved the plot (ctx.plot) for the gate's seed, that search
// is reused instead of searching again.
import { solve } from '../solve.js';
import { withTravel } from '../macros.js';
import { applyOption, hold, optionLabels } from '../drive.js';
import { budget as makeBudget } from '../util.js';
import { problem } from './common.js';

/** Winning ending paths of a solver result: [[ending, path]] shortest first. */
export const winningEndings = r => Object.entries(r?.endings || {}).filter(([k]) => r.outcomes?.[k] === 'won').sort((a, b) => a[1].length - b[1].length);

/** Play a path of option labels on a fresh controlled world of `seed`: -> { rt, ok, at } */
export function playPath(ctx, seed, path, { settleSteps = 2, wait = 600, travelFrames = 900 } = {}) {
  const rt = withTravel(ctx.make, ctx.registry, { mode: 'steer' }).make(seed);
  hold(rt, {}, settleSteps);
  for (let i = 0; i < path.length; i++) {
    let options = rt.availableOptions(), j = optionLabels(options).indexOf(path[i]);
    for (let k = 0; j < 0 && k < wait && rt.state.status === 'playing'; k++) { rt.step({}); options = rt.availableOptions(); j = optionLabels(options).indexOf(path[i]); }
    if (j < 0 || rt.state.status !== 'playing') return { rt, ok: false, at: i };
    const o = options[j];
    if (o.zone !== undefined && typeof o.apply === 'function') {
      // A travel macro: the travel verb toward its zone, then wait for the player to arrive.
      hold(rt, { actions: { travel: o.zone } }, 1);
      const p = () => rt.player(), there = () => p() && rt.space(p().space).inZone?.(p(), o.zone, rt);
      for (let k = 0; k < travelFrames && rt.state.status === 'playing' && !there(); k++) rt.step({});
    } else applyOption(rt, o);
    hold(rt, {}, settleSteps);
  }
  return { rt, ok: true, at: path.length };
}

export default {
  id: 'story',
  intent: 'Story games: the plot solver finds a path of player options to a winning ending, and the bot plays it through the controls on every world seed it is given.',
  requires: {},
  hints: ['plot.storyboard'],
  detect(ctx) { return (ctx.doc.plot?.storyboard?.acts || []).length > 0; },
  run(ctx, { search = 'best-first', budgetMs = 2000, maxStates = 20000, settleSteps = 2, seeds = [ctx.seed ?? 1], ...rest } = {}) {
    const b = makeBudget({ ms: budgetMs });
    const problems = [], runs = [];
    let exhaustive = false;
    for (const seed of seeds) {
      // The plot stage of verify() already searched the gate's world (and reported its own problems): reuse it.
      const reuse = ctx.plot?.endings && seed === ctx.seed ? ctx.plot : null;
      const r = reuse || solve(ctx.doc, ctx.registry, ctx.logic, { seed, search, budgetMs, maxStates, settleSteps, ...rest });
      exhaustive = exhaustive || Boolean(r.exhaustive);
      const wins = winningEndings(r);
      if (!wins.length) {
        if (!reuse) problems.push(problem(r.exhaustive ? 'plot_uncompletable' : 'plot_unproven', 'plot.storyboard', r.exhaustive ? 'no sequence of player options reaches a winning ending' : `no winning ending found within the search budget (${r.states} states)`, { severity: r.exhaustive ? 'error' : 'warning', hint: 'check beat triggers, gates and the ending conditions' }));
        runs.push({ seed, won: false, status: 'playing', ending: null, path: [], states: r.states, exhaustive: r.exhaustive, reused: r === reuse });
        continue;
      }
      const [ending, path] = wins[0], played = playPath(ctx, seed, path, { settleSteps });
      const status = played.rt.state.status, won = status === 'won';
      if (!won) problems.push(problem('plot_unproven', 'plot.storyboard', `seed ${seed}: the path to '${ending}' (${path.length} options) did not win when played through the controls (${played.ok ? status : `stopped at step ${played.at}: '${path[played.at]}' was not offered`})`, { severity: 'error', hint: 'the solver found the ending; the controls a person has must reach it too' }));
      runs.push({ seed, won, status, ending: played.rt.state.ending, path, states: r.states, exhaustive: r.exhaustive, reused: r === reuse });
    }
    const wins = runs.filter(x => x.won).length;
    return {
      ok: !problems.some(p => p.severity === 'error'), proven: wins ? runs.filter(x => x.won).map(x => `seed ${x.seed}: the solver's path to '${x.ending}' (${x.path.length} options) won through the controls`) : [], problems,
      metrics: { runs, rate: runs.length ? wins / runs.length : 0 }, exhaustive, budget: b.report(),
    };
  },
};
