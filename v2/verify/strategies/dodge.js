// Rollout dodger for continuous bullet games (ported from the shmup kit's
// dodging bots). Each decision tries the nine move directions (with the fire
// verb held) as real rollouts on a snapshot and scores them at increasing
// horizons: losing hp or a life costs the most, ending close to a threat
// costs in proportion. Distances come from the space's own `distance`, so a
// wrapping space dodges across its edges. The fire verb is discovered, not
// named: the verb whose press spawns entities. While it fires, a rollout that
// ends with a living foe close to its line of fire (the player's facing) costs
// less, a little: safety decides, aiming breaks the ties, so a stage whose win
// is destroying what it sends can be won and not only survived.
import { DIRS8, hold, threats, vitality, posOf, velOf, foes, hpOf, pressableVerbs } from '../drive.js';
import { facingOf } from '../../primitives/gameplay/combat-lib.js';
import { multiSeed, problem, seedBudgets } from './common.js';

export const HORIZONS = [2, 5, 9, 14], WEIGHTS = [8, 6, 4, 2.5], AIM = 1;

/** How far off the player's line of fire the best-lined-up living foe ahead is: the sine of its angle (0 on the line, 1 with none ahead). */
export function aimOffset(rt) {
  const p = rt.player(); if (!p) return 1;
  const at = posOf(rt, p), f = facingOf(p);
  let best = 1;
  for (const o of foes(rt)) {
    if (!Array.isArray(o.at) || !((hpOf(o) ?? 1) > 0)) continue;
    const d = [0, 1, 2].map(i => (o.at[i] ?? 0) - (at[i] ?? 0)), l = Math.hypot(...d); if (l < 1e-9) continue;
    const along = d[0] * f[0] + d[1] * f[1] + d[2] * f[2]; if (along <= 0) continue;
    best = Math.min(best, Math.sqrt(Math.max(0, 1 - (along / l) ** 2)));
  }
  return best;
}

/** The verb whose press spawns entities (projectiles), or null: more spawns than idling the same frames does (waves, spawners). */
export function fireVerb(rt) {
  const snap = rt.snapshot(), spawns = input => { rt.restore(snap); const before = rt.state.counts.spawn || 0; hold(rt, input, 3); return (rt.state.counts.spawn || 0) - before; };
  const idle = spawns({});
  for (const v of pressableVerbs(rt)) if (spawns({ actions: { [v]: true } }) > idle) { rt.restore(snap); return v; }
  rt.restore(snap);
  return null;
}

/** Cost of holding `input` from snap: real rollout checked at HORIZONS. */
export function rolloutCost(rt, snap, input, { radius = 1.5, aim = false } = {}) {
  rt.restore(snap);
  const v0 = vitality(rt);
  let cost = 0, f = 0;
  for (let h = 0; h < HORIZONS.length; h++) {
    f += hold(rt, input, HORIZONS[h] - (h ? HORIZONS[h - 1] : 0));
    const v = vitality(rt);
    if (!v.alive || (v.hp !== null && v0.hp !== null && v.hp < v0.hp) || (v.lives !== null && v0.lives !== null && v.lives < v0.lives) || !rt.player()) { cost += WEIGHTS[h] * 10 * (HORIZONS.length - h); break; }
    const p = rt.player(), api = rt.space(p.space), at = posOf(rt, p);
    for (const t of threats(rt)) { const d = api.distance(at, t.at); if (d < radius * 2) cost += WEIGHTS[h] * (1 - d / (radius * 2)); }
    if (aim && h === HORIZONS.length - 1) cost += AIM * aimOffset(rt);
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
  run(ctx, { seconds = 30, every = 4, seeds = [1], survive = 0.5, maxSteps = Infinity, radius = 1.5 } = {}) {
    const sb = seedBudgets(maxSteps);
    /** The budget of the seed being played (seedBudgets: one per seed). @type {any} */
    let b = null;
    const target = Math.round(seconds * 60);
    const play = seed => {
      const rt = (b = sb.budget()).meter(ctx.make(seed)), fire = fireVerb(rt), start = foes(rt).length;
      let hits = 0, last = vitality(rt);
      while (rt.state.status === 'playing' && rt.state.frame < target && !b.over()) {
        const snap = rt.snapshot();
        let best = null;
        for (const [x, y] of DIRS8) {
          const input = { axes: { move: [x, y] }, actions: fire ? { [fire]: true } : {} };
          const c = rolloutCost(rt, snap, input, { radius, aim: Boolean(fire) }) + (x || y ? 0.01 : 0);
          if (!best || c < best.c) best = { c, input };
        }
        rt.restore(snap);
        hold(rt, best.input, every);
        const v = vitality(rt);
        if ((v.hp !== null && last.hp !== null && v.hp < last.hp) || (v.lives !== null && last.lives !== null && v.lives < last.lives)) hits++;
        last = v;
      }
      const survived = rt.state.status === 'won' ? 1 : Math.min(1, rt.state.frame / target);
      return { seed, won: rt.state.status === 'won' || (rt.state.status === 'playing' && survived >= 1) || survived >= survive, status: rt.state.status, survived: +survived.toFixed(2), hits, kills: Math.max(0, start - foes(rt).length), fire, budget: rt.state.status === 'playing' && rt.state.frame < target && Boolean(b.hit) };
    };
    const r = multiSeed(play, { seeds, passRate: 1 / seeds.length });
    const best = r.runs.reduce((m, x) => (x.survived > (m?.survived ?? -1) ? x : m), null);
    const problems = [];
    if (best && !best.won && !best.budget) problems.push(problem('bot_failed', 'systems', `a rollout dodger survived ${Math.round(best.survived * 100)}% of ${seconds} s (${best.status}, ${best.hits} hits)`, { hint: 'fewer or slower bullets, a smaller player hitbox, or more lives' }));
    if (best?.budget) problems.push(problem('budget_exhausted', 'systems', `dodging stopped by its budget at ${Math.round(best.survived * 100)}%`, { severity: 'warning' }));
    return { ok: !problems.some(p => p.severity === 'error'), proven: r.ok ? [`a rollout dodger survived ${Math.round(best.survived * 100)}% of ${seconds} s`] : [], problems, metrics: { runs: r.runs }, exhaustive: false, budget: sb.report() };
  },
};
