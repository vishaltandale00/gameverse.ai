// Progressive generation pipeline. Stage 1 publishes a verified, playable
// first version as fast as possible; detail tasks then run in parallel and
// each verified patch is published as a new version (the UI hot-loads it).
// The planner is injected: Claude-backed (planner/claude-planner.js) or
// offline (planner/offline-planner.js).
import { preflight, mergePatch } from '../kernel/document.js';
import { solve } from '../verify/solve.js';
import { hashOf } from '../server/store.js';

export const PIPELINE_VERSION = 'v2-pipeline/0.1';

export function verify(doc, registry, logic, { solveBudgetMs = 1500 } = {}) {
  const t0 = performance.now();
  const checked = preflight(doc, registry, logic);
  const report = { preflight: { ok: checked.ok, errors: checked.errors, warnings: checked.warnings, ms: checked.ms } };
  if (!checked.ok) return { ok: false, report, doc: null };
  const t1 = performance.now();
  try {
    const solved = solve(checked.doc, registry, logic, { budgetMs: solveBudgetMs });
    report.solve = { ...solved, ms: Math.round(performance.now() - t1) };
  } catch (error) {
    report.solve = { error: String(error?.message || error) };
  }
  report.ms = Math.round(performance.now() - t0);
  return { ok: true, report, doc: checked.doc };
}

export function createPipeline({ registry, logic, planner, catalogHash, detailConcurrency = 3, solveBudgetMs = 1500 }) {
  const provenance = (job, extra = {}, doc = null) => ({ pipeline: PIPELINE_VERSION, planner: planner.version, models: planner.models || null, catalogHash, seed: doc?.seed ?? job.seed ?? null, prompt: job.prompt, ...extra });

  async function draft(job, ctx, produce, repairLabel) {
    let result = await produce();
    let checked = verify(result.doc, registry, logic, { solveBudgetMs });
    for (let attempt = 0; !checked.ok && attempt < (planner.repairs ?? 1); attempt++) {
      ctx.stage('repair', { what: repairLabel, errors: checked.report.preflight.errors.length });
      result = await planner.repair(result, checked.report.preflight.errors, job);
      checked = verify(result.doc, registry, logic, { solveBudgetMs });
    }
    return { result, checked };
  }

  return async function pipeline(job, ctx) {
    // Stage 1: outline + first playable.
    ctx.stage('outline', { planner: planner.version });
    let { result: outline, checked } = await draft(job, ctx, () => planner.outline(job), 'outline');
    if (!checked.ok && planner.fallback) {
      ctx.stage('fallback', { reason: 'outline failed checks' });
      ({ result: outline, checked } = await draft(job, ctx, () => planner.fallback.outline(job), 'fallback'));
    }
    if (!checked.ok) throw Object.assign(Error('could not produce a valid game'), { report: checked.report });
    ctx.stage('verified', { completable: checked.report.solve?.completable ?? null, ms: checked.report.ms });
    let current = checked.doc;
    await ctx.publish({ doc: current, report: checked.report, stage: 'first_playable', provenance: provenance(job, { outlineHash: hashOf(current) }, current) });

    // Stage 2: detail tasks in parallel; patches merge and publish in completion order.
    const tasks = [...(outline.details || [])];
    let published = 0;
    async function worker() {
      while (tasks.length) {
        const task = tasks.shift();
        ctx.stage('detail', { task: task.id, kind: task.kind });
        let patch;
        try { patch = await planner.detail(current, task, job); }
        catch (error) { ctx.stage('detail_failed', { task: task.id, error: String(error?.message || error) }); continue; }
        const { doc: merged, added } = mergePatch(current, patch);
        const v = verify(merged, registry, logic, { solveBudgetMs });
        if (!v.ok) { ctx.stage('detail_rejected', { task: task.id, errors: v.report.preflight.errors.slice(0, 5) }); continue; }
        current = v.doc; published++;
        await ctx.publish({ doc: current, report: { ...v.report, added }, stage: `detail:${task.id}`, provenance: provenance(job, { task: task.id }, current) });
      }
    }
    await Promise.all(Array.from({ length: Math.min(detailConcurrency, tasks.length) }, worker));
    ctx.stage('complete', { versions: 1 + published });
  };
}
