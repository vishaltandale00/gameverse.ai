// Experiment service for kernel games: generate, gate and attach a new primitive for a
// mechanic no registered primitive covers. Used by the pipeline's gap layer (fill) and
// by the studio's "Try it as an experiment" (experiment). Bounded concurrency.
import { generatePrimitiveExperiment, withExperiment } from './primitive.js';

export function createPrimitiveExperimentService({ writer, repairs = 2, maxConcurrent = 2, generate = generatePrimitiveExperiment } = {}) {
  if (!writer?.complete) throw Error('the primitive experiment service needs a code writer');
  let running = 0;
  async function experiment({ doc, request, gap = null }) {
    const text = String(request ?? '').trim().slice(0, 500);
    if (!text) throw Object.assign(Error('Say what the experiment should add.'), { status: 400 });
    if (running >= maxConcurrent) throw Object.assign(Error('Too many experiments are being made right now; try again in a moment.'), { status: 429 });
    running++;
    try { const r = await generate({ writer, doc, request: text, gap, repairs }); return { experiment: r.experiment, check: r.experiment.check, report: r.report }; }
    finally { running--; }
  }
  return {
    model: writer.model, experiment,
    /** -> { ok, doc?, experiment, problems } : the document with the experiment attached when it passed the gate. */
    async fill({ doc, request, gap = null }) {
      const r = await experiment({ doc, request, gap });
      if (!r.check?.ok) return { ok: false, experiment: r.experiment, problems: (r.check?.problems || []).map(p => p.code) };
      return { ok: true, experiment: r.experiment, doc: withExperiment(doc, r.experiment), report: r.report };
    },
  };
}
