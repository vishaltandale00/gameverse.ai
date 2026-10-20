// Rollout dodger for continuous bullet games (ported from the shmup kit's
// dodging bots). Each decision tries the nine move directions (with the fire
// verb held) as real rollouts on a snapshot and scores them at increasing
// horizons: losing hp or a life costs the most, ending close to a threat
// costs in proportion. Distances come from the space's own `distance`, so a
// wrapping space dodges across its edges. The fire verb is discovered, not
// named: the verb whose press spawns entities.
import { DIRS8, hold, threats, vitality, posOf, velOf, foes } from '../drive.js';
import { budget as makeBudget } from '../util.js';
import { multiSeed, problem } from './common.js';

export const HORIZONS = [2, 5, 9, 14], WEIGHTS = [8, 6, 4, 2.5];

/** The verb that spawns entities when pressed (projectiles), or null. */
export function fireVerb(rt) {
  const snap = rt.snapshot();
  for (const v of rt.actions()) {
    rt.restore(snap);
    const before = rt.state.counts.spawn || 0;
    hold(rt, { actions: { [v]: true } }, 3);
    if ((rt.state.counts.spawn || 0) > before) { rt.restore(snap); return v; }
  }
  rt.restore(snap);
  return null;
}

/** Cost of holding `input` from snap: real rollout checked at HORIZONS. */
export function rolloutCost(rt, snap, input, { radius = 1.5, b = null } = {}) {
  rt.restore(snap);
  const v0 = vitality(rt);
  let cost = 0, f = 0;
  for (let h = 0; h < HORIZONS.length; h++) {
    f += hold(rt, input, HORIZONS[h] - (h ? HORIZONS[h - 1] : 0), b);
    const v = vitality(rt);
    if (!v.alive || (v.hp !== null && v0.hp !== null && v.hp < v0.hp) || (v.lives !== null && v0.lives !== null && v.lives < v0.lives) || !rt.player()) { cost += WEIGHTS[h] * 10 * (HORIZONS.length - h); break; }
    const p = rt.player(), api = rt.space(p.space), at = posOf(rt, p);
    for (const t of threats(rt)) { const d = api.distance(at, t.at); if (d < radius * 2) cost += WEIGHTS[h] * (1 - d / (radius * 2)); }
  }
  return cost;
}

export default {
  id: 'dodge',
  intent: 'Continuous action with moving threats (bullets, rocks, swarms): a rollout dodger that fires while dodging must survive most of the stage.',
  requires: { capabilities: ['distance', 'position'] },
  detect(ctx) {
    const rt = ctx.make(ctx.seed); const p = rt.player();
    if (!p || !Array.isArray(p.at)) return false;
    hold(rt, {}, 30);
    return threats(rt).some(t => velOf(t).some(v => v !== 0));
  },
  run(ctx, { seconds = 30, every = 4, seeds = [1], survive = 0.5, budgetMs = 2000, maxSteps = Infinity, radius = 1.5 } = {}) {
    const b = makeBudget({ ms: budgetMs, steps: maxSteps });
    const target = Math.round(seconds * 60);
    const play = seed => {
      const rt = ctx.make(seed), fire = fireVerb(rt), start = foes(rt).length;
      let hits = 0, last = vitality(rt);
      while (rt.state.status === 'playing' && rt.state.frame < target && !b.over()) {
        const snap = rt.snapshot();
        let best = null;
        for (const [x, y] of DIRS8) {
          const input = { axes: { move: [x, y] }, actions: fire ? { [fire]: true } : {} };
          const c = rolloutCost(rt, snap, input, { radius, b }) + (x || y ? 0.01 : 0);
          if (!best || c < best.c) best = { c, input };
        }
        rt.restore(snap);
        hold(rt, best.input, every, b);
        const v = vitality(rt);
        if ((v.hp !== null && last.hp !== null && v.hp < last.hp) || (v.lives !== null && last.lives !== null && v.lives < last.lives)) hits++;
        last = v;
      }
      const survived = rt.state.status === 'won' ? 1 : Math.min(1, rt.state.frame / target);
      return { seed, won: rt.state.status === 'won' || (rt.state.status === 'playing' && survived >= 1) || survived >= survive, status: rt.state.status, survived: +survived.toFixed(2), hits, kills: Math.max(0, start - foes(rt).length), fire, budget: rt.state.status === 'playing' && rt.state.frame < target && Boolean(b.hit) };
    };
    const r = multiSeed(play, { seeds, passRate: 1 / seeds.length, b });
    const best = r.runs.reduce((m, x) => (x.survived > (m?.survived ?? -1) ? x : m), null);
    const problems = [];
    if (best && !best.won && !best.budget) problems.push(problem('bot_failed', 'systems', `a rollout dodger survived ${Math.round(best.survived * 100)}% of ${seconds} s (${best.status}, ${best.hits} hits)`, { hint: 'fewer or slower bullets, a smaller player hitbox, or more lives' }));
    if (best?.budget) problems.push(problem('budget_exhausted', 'systems', `dodging stopped by its budget at ${Math.round(best.survived * 100)}%`, { severity: 'warning' }));
    return { ok: !problems.some(p => p.severity === 'error'), proven: r.ok ? [`a rollout dodger survived ${Math.round(best.survived * 100)}% of ${seconds} s`] : [], problems, metrics: { runs: r.runs }, exhaustive: false, budget: b.report() };
  },
};
