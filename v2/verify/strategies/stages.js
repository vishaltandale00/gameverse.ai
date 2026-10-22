// Levels mode bot (gameplay.stage.sequence): the stages wrap another mode, so
// the bot of the wrapped mode plays them in order on one world (each stage's
// goal, parameters and spawns come from the sequence as play goes on). The
// wrapped bot is the card.mode.bot of another mode in the document, else the
// strategy detection picks one. The sequence must complete (status won).
import { modesIn } from '../../primitives/gameplay/modes-lib-mode.js';
import { problem, pathOf } from './common.js';

const STAGES = 'gameplay.stage.sequence';

/** stages strategy over a strategy lookup and a detection fallback (both from the registry in index.js). */
export function stagesStrategy(lookup, detected) {
  return {
    id: 'stages',
    intent: 'Stage sequences: the bot of the wrapped mode must clear every stage in order (the sequence completes).',
    requires: {},
    hints: [STAGES],
    detect(ctx) { return modesIn(ctx.doc, ctx.registry).some(m => m.use === STAGES); },
    run(ctx, opts = {}) {
      const inner = modesIn(ctx.doc, ctx.registry).map(m => !m.mode.wraps && lookup(m.mode.bot)).find(Boolean) || detected(ctx).find(s => s.id !== 'stages') || null;
      const where = pathOf(ctx.doc, [STAGES]);
      if (!inner) return { ok: false, proven: [], problems: [problem('too_hard', where, 'no bot plays the mode these stages wrap', { hint: 'add the mode the stages are levels of' })], metrics: { inner: null, runs: [] }, exhaustive: false, budget: null };
      // The stages play the world the caller names: its seeds (the gate's world) go to the wrapped bot.
      const r = inner.run(ctx, { ...(opts.maxSteps !== undefined ? { maxSteps: opts.maxSteps } : {}), ...(opts[inner.id] || {}), ...(opts.inner || {}), ...(opts.seeds ? { seeds: opts.seeds } : {}) });
      const runs = (r.metrics?.runs || []).map(x => ({ ...x, won: x.status ? x.status === 'won' : Boolean(x.won) }));
      const wins = runs.filter(x => x.won).length, problems = [...r.problems];
      if (runs.length && !wins && !problems.some(p => p.severity === 'error')) problems.push(problem('too_hard', where, `the ${inner.id} bot never completed the stage sequence in ${runs.length} runs`, { hint: 'easier stage goals, more moves or time, or fewer stages' }));
      return { ok: !problems.some(p => p.severity === 'error'), proven: wins ? [`the ${inner.id} bot completed the stage sequence (${wins}/${runs.length} runs)`, ...r.proven] : [], problems, metrics: { inner: inner.id, runs, rate: runs.length ? wins / runs.length : 0, innerMetrics: { ...r.metrics, runs: undefined } }, exhaustive: false, budget: r.budget };
    },
  };
}
