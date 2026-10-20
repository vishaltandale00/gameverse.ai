// Random-policy stuck/escape check for physics toys (ported from the physics
// kit's pinball check). Seeded random play toggles every verb every few
// frames; every non-player body that has moved is watched: one that stays
// still for `stuckSeconds` while play continues is stuck, one that leaves
// the space bounds (or turns non-finite) escaped.
import { hold, velOf } from '../drive.js';
import { budget as makeBudget, prng } from '../util.js';
import { problem, entityPath } from './common.js';

const speed = e => Math.hypot(...velOf(e));
/** Space bounds from the space API (`size`, or `bounds` [min, max]); null if unknown. */
export function boundsOf(api) {
  if (Array.isArray(api.bounds) && Array.isArray(api.bounds[0])) return { min: api.bounds[0], max: api.bounds[1] };
  if (Array.isArray(api.size)) return { min: api.size.map(() => 0), max: api.size };
  return null;
}
/** Free bodies: non-player, positioned, not an agent or a threat (ai, attacks, hazard). */
const free = e => e.id !== 'player' && Array.isArray(e.at) && !e.components.ai && !e.components.attacks && !e.components.hazard;
const outside = (at, bd, margin) => at.some((v, i) => !Number.isFinite(v) || (bd && i < bd.min.length && (v < bd.min[i] - margin || v > bd.max[i] + margin)));

export default {
  id: 'random-policy',
  intent: 'Physics toys with free-moving bodies (pinball, marble runs, physics puzzles): random play must never leave a body stuck or let one escape the space.',
  requires: { capabilities: ['position'] },
  detect(ctx) { const rt = ctx.make(ctx.seed); hold(rt, {}, 20); return Object.values(rt.state.entities).some(e => free(e) && speed(e) > 0); },
  run(ctx, { runs = 4, seconds = 25, stuckSeconds = 3, toggleEvery = 6, pressRate = 0.3, slow = 0.01, margin = 1, budgetMs = 2000, maxSteps = Infinity } = {}) {
    const b = makeBudget({ ms: budgetMs, steps: maxSteps });
    const problems = [], stats = { runs: 0, seconds: 0, stuck: 0, escaped: 0 };
    for (let r = 0; r < runs && !b.over(); r++) {
      const rt = ctx.make(ctx.seed), rand = prng(`random-policy:${ctx.seed ?? ''}:${r}`), verbs = rt.actions();
      const still = {}, moved = new Set(), gone = new Set();
      let held = {};
      stats.runs++;
      for (let f = 0; f < seconds * 60 && rt.state.status === 'playing' && !b.over(); f++) {
        if (f % toggleEvery === 0) { held = {}; for (const v of verbs) if (rand() < pressRate) held[v] = true; }
        hold(rt, { actions: held, held }, 1, b);
        for (const e of Object.values(rt.state.entities)) {
          if (!free(e) || gone.has(e.id)) continue;
          const bd = boundsOf(rt.space(e.space));
          if (outside(e.at, bd, margin)) { gone.add(e.id); stats.escaped++; if (problems.filter(p => p.code === 'body_escaped').length < 4) problems.push(problem('body_escaped', entityPath(ctx.doc, e), `'${e.id}' (${e.archetype}) left the space at (${e.at.map(v => Number.isFinite(v) ? v.toFixed(1) : v).join(', ')}) in random run ${r + 1}`, { hint: 'close the walls or add a kill plane that despawns it' })); continue; }
          if (speed(e) >= slow) { moved.add(e.id); still[e.id] = 0; continue; }
          if (!moved.has(e.id)) continue;
          still[e.id] = (still[e.id] || 0) + 1 / 60;
          if (still[e.id] > stuckSeconds) { still[e.id] = -1e9; stats.stuck++; if (problems.filter(p => p.code === 'body_stuck').length < 4) problems.push(problem('body_stuck', entityPath(ctx.doc, e), `'${e.id}' (${e.archetype}) came to rest at (${e.at.map(v => v.toFixed(1)).join(', ')}) with no way out (random run ${r + 1})`, { severity: 'warning', hint: 'move bumpers, walls or targets apart, or slope the resting spot' })); }
        }
        stats.seconds += 1 / 60;
      }
    }
    stats.seconds = Math.round(stats.seconds);
    return { ok: !problems.some(p => p.severity === 'error'), proven: !problems.length ? [`${stats.runs} random runs (${stats.seconds} s) never left a body stuck or let one escape`] : [], problems, metrics: stats, exhaustive: false, budget: b.report() };
  },
};
