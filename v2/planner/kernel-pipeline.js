// The ARCHITECTURE.md §4 generation pipeline for kernel documents, end to end:
//   decompose -> select (capability-aware) -> outline (preflight + repair rounds)
//   -> first playable (no model, <1 s) -> detail patches per zone in parallel
//   (each repaired, guarded, verified, then published for hosts to hot-load)
//   -> gaps (new primitives through the experiments sandbox) -> complete.
// Revisions: tweak (params, no model, <1 s) else targeted model ops, both behind
// the revision-check guards. Every stage reports measured durations; values that
// were not measured are null, never zero (AGENTS.md).
import { hashOf } from '../server/store.js';
import { seedFrom } from '../kernel/rng.js';
import { decomposeIdea, decomposeOffline } from './decompose.js';
import { selectPrimitives } from './select.js';
import { writeOutline, ensureAgency } from './outline.js';
import { firstPlayable } from './first-playable.js';
import { detailTasks, writeDetail, acceptPatch } from './detail.js';
import { tweakDocument, reviseDocument, applyOps, guardRevision } from './doc-revise.js';
import { repairDocument, describeErrors } from './repair.js';
import { verifyDocument, regressed } from './verify-adapter.js';
import { catalogHash } from './catalog.js';

export const KERNEL_PIPELINE_VERSION = 'v2-kernel/0.1';
export const PIPELINE_CONFIG = Object.freeze({
  detailConcurrency: 3, maxDetailTasks: 8, detailRepairs: 1, outlineRepairRounds: 2, reviseRepairs: 2,
  solveBudgetMs: 800, gaps: 'offer', maxGapPrimitives: 1,
});

const ms = t => Math.round(performance.now() - t);
const gapNote = g => ({ capability: g.description, why: g.why, kind: g.kind === 'capability' ? 'capability' : 'unsupported', mechanic: g.mechanic, importance: g.importance });

/**
 * createKernelPipeline({ catalogue(doc?) -> { registry, logic }, writers: { spec, code }, decisions, gapService?, config })
 * catalogue(doc) returns the registry for a document (registered + promoted + its experiment primitives).
 */
export function createKernelPipeline({ catalogue, writers = {}, decisions = null, gapService = null, config = {} }) {
  const cfg = { ...PIPELINE_CONFIG, ...config };
  const spec = writers.spec || null;

  async function create(job, ctx) {
    const t0 = performance.now(), timings = { queueMs: job.queuedMs ?? null };
    const { registry, logic } = await catalogue(null);
    const seed = job.seed ?? seedFrom(job.prompt);
    ctx.stage('decomposing', { model: spec?.model || 'offline' });
    let t = performance.now();
    const decomposition = await decomposeIdea({ writer: spec, prompt: job.prompt, answers: job.answers || [] });
    timings.decomposeMs = ms(t);
    ctx.stage('decomposed', { ms: timings.decomposeMs, source: decomposition.source, references: decomposition.references.map(r => r.name), mechanics: decomposition.mechanics.map(m => m.description), ...(decomposition.error ? { error: decomposition.error } : {}) });
    t = performance.now();
    const chosen = await selectPrimitives({ decomposition, registry, decisions });
    const agency = await ensureAgency({ decomposition, selection: chosen, registry, logic, seed, prompt: job.prompt });
    const selection = agency.selection;
    timings.selectMs = ms(t);
    ctx.stage('selected', { ms: timings.selectMs, provider: selection.provider || 'lexical', spaces: selection.spaces.map(s => s.use), systems: selection.systems, gaps: selection.gaps.map(g => g.description), agency: agency.agency, agencyAttempts: agency.attempts });
    ctx.stage('outlining', { model: spec?.model || 'procedural' });
    t = performance.now();
    const outline = await writeOutline({ writer: spec, prompt: job.prompt, answers: job.answers || [], decomposition, selection, registry, logic, seed, maxRounds: cfg.outlineRepairRounds });
    timings.outlineMs = ms(t); timings.outlineModelMs = spec ? outline.modelMs : null;
    ctx.stage('outlined', { ms: timings.outlineMs, source: outline.source, rounds: outline.rounds, firstPassOk: outline.firstPassOk, fellBack: Boolean(outline.fellBack) });
    if (!outline.ok) throw Object.assign(Error(`The outline failed checks: ${outline.errors.slice(0, 3).map(e => `${e.code} ${e.path}`).join('; ')}`), { status: 422 });

    // Layer 2: first playable, zero model calls.
    t = performance.now();
    const fp = firstPlayable(outline.doc, registry, logic, { seed });
    timings.firstPlayableBuildMs = ms(t);
    if (!fp.ok) throw Object.assign(Error(`The first playable would not start: ${[...fp.errors, ...fp.problems].slice(0, 3).map(e => e.message || e.code).join('; ')}`), { status: 422 });
    let current = fp.doc;
    const gaps = [...selection.gaps.map(gapNote), ...[...(outline.removed || []), ...fp.removed].map(r => ({ capability: r.use, why: r.why, kind: r.kind === 'capability' ? 'capability' : 'removed' }))];
    await ctx.store.updateMeta(job.gameId, { title: current.title, kind: 'kernel' });
    const common = { kind: 'kernel', decomposition, selection: { mechanics: selection.mechanics, spaces: selection.spaces, systems: selection.systems, graphics: selection.graphics, gaps: selection.gaps, provider: selection.provider }, gaps, summary: current.logline || decomposition.premise };
    const provenance = extra => ({ pipeline: KERNEL_PIPELINE_VERSION, catalogHash: catalogHash(registry), models: { spec: spec?.model || null, decisions: decisions?.provider || null }, seed, prompt: job.prompt, answers: job.answers || [], outlineSource: outline.source, decompositionHash: hashOf(decomposition), ...extra });
    // Publish before full verification: preflight passed and the world booted; the verifier's report follows.
    timings.requestToFirstPlayableMs = ms(t0);
    await ctx.publish({ doc: current, stage: 'first_playable', report: { ...common, verified: null, verification: { ok: true, source: 'preflight', pending: true, preflightMs: null }, outline: { source: outline.source, rounds: outline.rounds, firstPassOk: outline.firstPassOk, fellBack: Boolean(outline.fellBack) }, firstPlayable: { ms: fp.ms, start: fp.start, options: fp.options, stateHash: fp.stateHash }, timings: { ...timings } }, provenance: provenance({ outlineHash: hashOf(current) }) });
    ctx.stage('first_playable', { ms: timings.requestToFirstPlayableMs, buildMs: timings.firstPlayableBuildMs });
    t = performance.now();
    const base = await verifyDocument(current, registry, logic, { budgetMs: cfg.solveBudgetMs });
    timings.firstVerifyMs = ms(t);
    ctx.stage('verified', { ms: timings.firstVerifyMs, verification: summarizeVerify(base) });

    // Layer 3: detail patches in parallel; merges are serialized in completion order.
    const tasks = detailTasks(current, { max: cfg.maxDetailTasks });
    const detail = { proposed: 0, accepted: 0, rejected: [], tasks: [] };
    let merging = Promise.resolve(), baseVerify = base;
    const runTask = async task => {
      const tt = performance.now();
      ctx.stage('detail', { task: task.id });
      let written;
      try { written = await writeDetail({ writer: spec, doc: current, task, registry, logic }); }
      catch (error) { detail.tasks.push({ task: task.id, ok: false, reason: 'writer', error: String(error.message || error).slice(0, 120), ms: ms(tt) }); detail.proposed++; detail.rejected.push({ task: task.id, reason: 'writer' }); return; }
      detail.proposed++;
      await (merging = merging.then(async () => {
        // A patch never takes the pipeline down: anything that throws while checking it is a rejection.
        const accept = patch => acceptPatch({ current, patch, task, registry, logic, baseVerify, budgetMs: cfg.solveBudgetMs })
          .catch(error => ({ ok: false, reason: 'threw', errors: [{ code: 'patch_threw', path: '$', message: String(error?.message || error).slice(0, 200) }], patch }));
        let result = await accept(written.patch);
        for (let r = 0; !result.ok && spec && r < cfg.detailRepairs && result.reason !== 'empty'; r++) {
          try { written = await writeDetail({ writer: spec, doc: current, task, registry, logic, errors: result.errors, previous: result.patch }); } catch { break; }
          result = await accept(written.patch);
        }
        const entry = { task: task.id, ok: result.ok, source: written.source, modelMs: written.ms ?? null, ms: ms(tt), ...(result.ok ? { fixes: result.fixes.length } : { reason: result.reason, errors: (result.errors || []).slice(0, 4).map(e => e.code || e.message) }) };
        detail.tasks.push(entry);
        if (!result.ok) { detail.rejected.push({ task: task.id, reason: result.reason }); ctx.stage('detail_rejected', { task: task.id, reason: result.reason }); return; }
        current = result.doc; baseVerify = result.verify; detail.accepted++;
        await ctx.publish({ doc: current, stage: `detail:${task.zone}`, report: { ...common, added: result.added, verified: true, verification: summarizeVerify(result.verify), detail: entry, timings: { ...timings, sinceRequestMs: ms(t0) } }, provenance: provenance({ task: task.id }) });
      }));
    };
    const queue = [...tasks];
    await Promise.all(Array.from({ length: Math.min(cfg.detailConcurrency, queue.length) }, async () => { while (queue.length) await runTask(queue.shift()); }));
    await merging;
    timings.detailMs = ms(t0) - timings.requestToFirstPlayableMs;

    // Layer 4: gaps -> new primitives (background, bounded by config).
    const filled = [];
    if (cfg.gaps === 'auto' && gapService) {
      for (const g of selection.gaps.filter(g => g.importance === 'core').slice(0, cfg.maxGapPrimitives)) {
        const tg = performance.now();
        ctx.stage('gap', { mechanic: g.mechanic });
        try {
          const r = await gapService.fill({ doc: current, request: g.description, gap: g });
          if (r.ok) {
            current = r.doc; filled.push({ mechanic: g.mechanic, experiment: r.experiment.id, ms: ms(tg) });
            await ctx.publish({ doc: current, stage: `gap:${g.mechanic}`, report: { ...common, gaps: common.gaps.filter(x => x.mechanic !== g.mechanic), experiment: { id: r.experiment.id, label: r.experiment.label }, changes: [`experimental: ${r.experiment.label}`], timings: { ...timings, sinceRequestMs: ms(t0) } }, provenance: provenance({ experiment: r.experiment.id }) });
          } else filled.push({ mechanic: g.mechanic, ok: false, problems: r.problems, ms: ms(tg) });
        } catch (error) { filled.push({ mechanic: g.mechanic, ok: false, error: String(error.message || error).slice(0, 160), ms: ms(tg) }); }
      }
    }
    timings.totalMs = ms(t0);
    ctx.stage('complete', { timings, detail: { proposed: detail.proposed, accepted: detail.accepted, rejected: detail.rejected }, gaps: filled });
    return { doc: current, timings, detail, gaps: filled, firstVerification: summarizeVerify(base), decomposition, selection, outline: { source: outline.source, rounds: outline.rounds, firstPassOk: outline.firstPassOk, fellBack: Boolean(outline.fellBack) }, base };
  }

  async function revise(job, ctx) {
    const t0 = performance.now(), timings = {};
    const previous = await ctx.store.version(job.gameId, job.base);
    if (!previous?.doc) throw Object.assign(Error('That version is missing.'), { status: 404 });
    const before = previous.doc;
    const { registry, logic } = await catalogue(before);
    ctx.stage('revising', { change: job.change });
    // Layer 5 first: a parameter tweak with no model.
    let t = performance.now();
    const tweak = await tweakDocument(before, job.change, { registry, decisions });
    timings.tweakMs = ms(t);
    let after = null, unsupported = [], path = null, modelMs = null, opsApplied = [];
    if (tweak.matched) { after = tweak.doc; path = 'tweak'; opsApplied = tweak.ops; ctx.stage('tweaked', { ms: timings.tweakMs, ops: tweak.ops.length, source: tweak.source }); }
    if (!after && spec) {
      t = performance.now();
      let r = await reviseDocument({ writer: spec, doc: before, change: job.change, registry, logic });
      modelMs = r.ms; unsupported = r.unsupported;
      let applied = applyOps(before, r.ops), repaired = repairDocument(applied.doc, { registry, logic, rounds: 4 });
      for (let n = 0; !repaired.ok && n < cfg.reviseRepairs; n++) {
        r = await reviseDocument({ writer: spec, doc: before, change: job.change, registry, logic, errors: describeErrors(repaired.errors), previous: r.ops });
        modelMs += r.ms; unsupported = r.unsupported;
        applied = applyOps(before, r.ops); repaired = repairDocument(applied.doc, { registry, logic, rounds: 4 });
      }
      timings.reviseMs = ms(t); timings.reviseModelMs = modelMs;
      if (!repaired.ok) throw Object.assign(Error(`The change failed checks: ${repaired.errors.slice(0, 3).map(e => `${e.code} ${e.path}`).join('; ')}`), { status: 422 });
      after = repaired.doc; path = 'model'; opsApplied = applied.applied;
      ctx.stage('revised', { ms: timings.reviseMs, ops: applied.applied.length, failed: applied.failed.length });
    }
    if (!after) {
      // Nothing can carry the change out here: no tweakable param matched and no writer is connected.
      after = before; path = 'none';
      unsupported = [{ request: job.change, why: 'No parameter of this game matches that change, and no model is connected to write it.' }];
    }
    t = performance.now();
    const guard = await guardRevision({ before, after, change: job.change, decisions, unsupported });
    timings.guardMs = ms(t);
    if (!guard.ok) throw Object.assign(Error(guard.reason === 'dropped_content' ? `That change would remove ${guard.dropped.map(d => d.path).join(', ')}, which the request didn't ask for.` : 'That change would repaint the game, which the request didn\'t ask for.'), { status: 422, code: guard.reason });
    t = performance.now();
    const v = await verifyDocument(after, registry, logic, { budgetMs: cfg.solveBudgetMs });
    const vBefore = await verifyDocument(before, registry, logic, { budgetMs: cfg.solveBudgetMs });
    timings.verifyMs = ms(t);
    if (!v.ok) throw Object.assign(Error('The changed game failed checks.'), { status: 422 });
    if (regressed(vBefore, v)) throw Object.assign(Error('That change would make the game impossible to finish.'), { status: 422, code: 'plot_regressed' });
    const notApplied = guard.revisionCheck?.notApplied || (guard.diff === 0);
    const gaps = [...(unsupported || []).map(u => ({ capability: String(u.request).slice(0, 160), why: String(u.why || '').slice(0, 240), kind: 'unsupported' })),
      ...(notApplied && !(unsupported || []).length ? [guard.diff
        ? { capability: job.change, why: `Changed ${guard.changes.join(', ')}, but the checker isn't sure that fully does what you asked.`, kind: 'partial' }
        : { capability: job.change, why: 'Nothing in this game changed for that request: no primitive here has a setting for it yet.', kind: 'unsupported' }] : [])];
    timings.totalMs = ms(t0);
    return ctx.publish({
      doc: v.doc, stage: `revision: ${job.change}`,
      report: { kind: 'kernel', change: job.change, path, ops: opsApplied.slice(0, 20), changes: guard.changes, diffLines: guard.lines, revisionCheck: guard.revisionCheck, gaps, verified: true, verification: summarizeVerify(v), hot: path === 'tweak' ? 'params' : 'reload', timings },
      provenance: { ...previous.provenance, pipeline: KERNEL_PIPELINE_VERSION, base: job.base, change: job.change, revisePath: path, models: { spec: path === 'model' ? spec?.model : null, decisions: decisions?.provider || null } },
    });
  }

  const pipeline = (job, ctx) => (job.kind === 'revise' ? revise(job, ctx) : create(job, ctx));
  pipeline.version = KERNEL_PIPELINE_VERSION;
  pipeline.create = create; pipeline.revise = revise;
  return pipeline;
}

export function summarizeVerify(v) {
  if (!v) return null;
  return { ok: v.ok, source: v.source, completable: v.completable, exhaustive: v.exhaustive, ms: v.ms, preflightMs: v.preflight?.ms ?? null, warnings: (v.preflight?.warnings || []).length,
    endings: v.solve ? Object.keys(v.solve.endings || {}) : null, beatsNeverFired: v.solve?.beatsNeverFired?.slice(0, 10) ?? null, states: v.solve?.states ?? null, problems: (v.problems || []).slice(0, 5) };
}

export { decomposeOffline };
