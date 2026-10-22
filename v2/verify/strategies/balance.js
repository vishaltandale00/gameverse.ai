// Balance simulation for turn-based battles (ported from the creature kit's
// battle sim). Each option is one turn; a greedy one-ply policy resolves
// every option on a snapshot to the next decision point and keeps the one
// with the best exchange (damage dealt minus damage taken, defeats, the
// objective). Battles are played on many seeds; the win rate must reach the
// pass rate, and battles that never end are stalemates.
import { hpOf, foes, vitality } from '../drive.js';
import { simulateOption, untilDecision, multiSeed, problem, foeHp, livingFoes, seedBudgets } from './common.js';
import { objective } from '../objective.js';

const ownHp = rt => { const v = vitality(rt); return v.hp ?? 0; };

/** Best option index by one-ply exchange value. */
export function chooseTurn(rt, score) {
  const snap = rt.snapshot(), n = rt.availableOptions().length, f0 = foeHp(rt), h0 = ownHp(rt), k0 = livingFoes(rt).length, s0 = score(rt);
  let best = -1, bestV = -Infinity;
  for (let i = 0; i < n; i++) {
    simulateOption(rt, snap, i);
    const v = (f0 - foeHp(rt)) - (h0 - ownHp(rt)) + 50 * (k0 - livingFoes(rt).length) + (score(rt) - s0) + (rt.state.status === 'won' ? 1e6 : rt.state.status === 'lost' ? -1e6 : 0);
    if (v > bestV) { bestV = v; best = i; }
  }
  rt.restore(snap);
  return best;
}

export default {
  id: 'balance',
  intent: 'Turn-based battles (options are turns, opponents have health): a greedy policy must win at the pass rate over seeded battles, and battles must end.',
  requires: { options: true },
  detect(ctx) { const rt = ctx.make(ctx.seed); untilDecision(rt, 600); return rt.availableOptions().length > 0 && foes(rt).some(e => hpOf(e) > 0); },
  run(ctx, { seeds = Array.from({ length: 20 }, (_, i) => i + 1), passRate = 0.7, maxTurns = 120, maxSteps = Infinity } = {}) {
    const sb = seedBudgets(maxSteps);
    /** The budget of the seed being played (seedBudgets: one per seed). @type {any} */
    let b = null;
    const { score } = objective(ctx.doc, ctx.registry, ctx.logic);
    const play = seed => {
      const rt = (b = sb.budget()).meter(ctx.make(seed));
      untilDecision(rt, 600);
      // Battles whose opponents are not entities with health (creature parties inside a battle service) run while options last.
      let turns = 0; const entityFoes = livingFoes(rt).length > 0;
      while (rt.state.status === 'playing' && turns < maxTurns && (entityFoes ? livingFoes(rt).length : rt.availableOptions().length) && vitality(rt).alive && !b.over()) {
        const i = chooseTurn(rt, score); if (i < 0) break;
        simulateOption(rt, rt.snapshot(), i); turns++;
      }
      const won = rt.state.status === 'won' || (entityFoes && !livingFoes(rt).length && vitality(rt).alive);
      const lost = rt.state.status === 'lost' || !vitality(rt).alive;
      return { seed, won, lost, status: rt.state.status, frames: rt.state.frame, turns, stalemate: !won && !lost && turns >= maxTurns, budget: !won && !lost && turns < maxTurns && Boolean(b.hit), hp: ownHp(rt) };
    };
    const r = multiSeed(play, { seeds, passRate });
    const finished = r.runs.filter(x => !x.budget), stale = finished.filter(x => x.stalemate).length;
    const rate = finished.length ? finished.filter(x => x.won).length / finished.length : 0;
    const problems = [];
    if (!finished.length) problems.push(problem('budget_exhausted', 'systems', 'balance simulation ran out of budget before a battle finished', { severity: 'warning' }));
    else if (rate < passRate) problems.push(problem('encounter_too_hard', 'systems', `a greedy player wins ${Math.round(rate * 100)}% of ${finished.length} seeded battles (needs ${Math.round(passRate * 100)}%)`, { hint: 'lower opponent stats or level, or give the player a type/move advantage or healing' }));
    if (stale) problems.push(problem('battle_stalemate', 'systems', `${stale} of ${finished.length} battles did not end within ${maxTurns} turns`, { severity: 'warning', hint: 'raise damage or add a turn limit' }));
    return { ok: !problems.some(p => p.severity === 'error'), proven: rate >= passRate ? [`a greedy player wins ${Math.round(rate * 100)}% of ${finished.length} seeded battles`] : [], problems, metrics: { rate, battles: finished.length, avgTurns: finished.length ? +(finished.reduce((s, x) => s + x.turns, 0) / finished.length).toFixed(1) : 0, runs: r.runs }, exhaustive: false, budget: sb.report() };
  },
};
