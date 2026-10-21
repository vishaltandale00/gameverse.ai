// Striker for ball sports (gameplay.sports): through the player's real
// controls it runs to a spot behind the ball on the line to the goal its team
// scores in (each step choosing, on snapshots, the held direction that ends
// nearest that spot), and kicks toward the goal mouth when the ball is in
// range. It must win the match (outscore the other teams before the clock).
import { hold, posOf, DIRS8 } from '../drive.js';
import { budget as makeBudget, stateHash } from '../util.js';
import { modesIn } from '../../primitives/gameplay/modes-lib-mode.js';
import { multiSeed, problem, pathOf } from './common.js';

const SPORTS = 'gameplay.sports';
const sub = (a, b) => a.map((v, i) => v - (b[i] ?? 0)), len = v => Math.hypot(...v);
const centreOf = (rt, e) => { const api = rt.space(e.space), at = posOf(rt, e); if (api.anchor !== 'min') return at; const s = e.components.body?.size || [1, 1, 1]; return at.map((v, i) => v + (s[i] ?? 0) / 2); };

/** Goal mouth (zone centre) the player's team scores in, or null. */
export function goalFor(rt, doc, config) {
  const team = config.teams.find(t => (t.members || []).some(m => m === 'player' || m === rt.player()?.archetype))?.id;
  const zone = config.goals.find(g => g.scores === team)?.zone;
  const z = (doc.spaces || []).flatMap(sp => sp.zones || []).find(x => x.id === zone);
  return Array.isArray(z?.rect) ? [(z.rect[0] + z.rect[2]) / 2, (z.rect[1] + z.rect[3]) / 2] : null;
}

export default {
  id: 'striker',
  intent: 'Ball sports: a striker that runs behind the ball and kicks it at the goal through the real controls must win the match.',
  requires: { capabilities: ['position'] },
  hints: [SPORTS],
  detect(ctx) { return modesIn(ctx.doc, ctx.registry).some(m => m.use === SPORTS); },
  run(ctx, { seeds = [1], passRate = 1, every = 6, behind = 0.9, maxFrames = 36000, budgetMs = 2000, maxSteps = Infinity } = {}) {
    const b = makeBudget({ ms: budgetMs, steps: maxSteps });
    const inst = modesIn(ctx.doc, ctx.registry).find(m => m.use === SPORTS), where = pathOf(ctx.doc, [SPORTS]);
    if (!inst) return { ok: true, proven: [], problems: [], metrics: { skipped: 'no sports' }, exhaustive: false, budget: b.report() };
    const config = inst.config, ballId = config.ballId ?? 'ball';
    const play = seed => {
      const rt = ctx.make(seed), path = [], goal = goalFor(rt, ctx.doc, config);
      while (rt.state.status === 'playing' && rt.state.frame < maxFrames && !b.over() && goal) {
        const p = rt.player(), ball = rt.entity(ballId);
        if (!p || !ball || !rt.test({ sports: 'play' })) { hold(rt, {}, every, b); path.push('wait'); continue; }
        const bc = centreOf(rt, ball).slice(0, 2), pc = centreOf(rt, p).slice(0, 2), toGoal = sub(goal, bc), l = len(toGoal) || 1, dir = toGoal.map(v => v / l);
        const spot = bc.map((v, i) => v - dir[i] * behind);
        // Kick when in range and roughly behind the ball (the ball sits between the player and the goal).
        const behindBall = len(sub(pc, bc)) <= config.kickRange && (bc[0] - pc[0]) * dir[0] + (bc[1] - pc[1]) * dir[1] > 0;
        if (behindBall) { hold(rt, { actions: { kick: { dir: [...dir, 0] } } }, 1, b); path.push('kick'); continue; }
        const snap = rt.snapshot();
        let best = null;
        for (const [x, y] of DIRS8.slice(1)) {
          rt.restore(snap); hold(rt, { axes: { move: [x, y] } }, every, b); b.state();
          const q = rt.player(); if (!q) continue;
          const d = len(sub(centreOf(rt, q).slice(0, 2), spot));
          if (!best || d < best.d) best = { d, x, y };
        }
        rt.restore(snap);
        if (!best) break;
        hold(rt, { axes: { move: [best.x, best.y] } }, every, b); path.push(`move ${best.x},${best.y}`);
      }
      const won = rt.state.status === 'won' || rt.test({ sports: 'won' });
      return { seed, won, status: rt.state.status, score: Object.fromEntries(config.teams.map(t => [t.id, rt.state.vars[`score.${t.id}`] ?? 0])), frames: rt.state.frame, path, hash: stateHash(rt.state), budget: !won && Boolean(b.hit) };
    };
    const r = multiSeed(play, { seeds, passRate, b });
    const finished = r.runs.filter(x => !x.budget), problems = [];
    if (!finished.length) problems.push(problem('budget_exhausted', where, 'the striker ran out of budget before the match ended', { severity: 'warning' }));
    else if (finished.filter(x => x.won).length / finished.length < passRate) problems.push(problem('too_hard', where, `a striker won ${finished.filter(x => x.won).length}/${finished.length} matches (last score ${JSON.stringify(finished[finished.length - 1].score)})`, { hint: 'bigger goals, a longer clock, a lower kick range need, or fewer defenders' }));
    return { ok: !problems.some(p => p.severity === 'error'), proven: r.ok ? [`a striker won ${r.wins}/${r.runs.length} matches`] : [], problems, metrics: { runs: r.runs, rate: r.rate }, exhaustive: false, budget: b.report() };
  },
};
