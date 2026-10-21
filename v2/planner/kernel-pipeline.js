// @ts-check
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
import { preflight } from '../kernel/document.js';
import { decomposeIdea, decomposeOffline } from './decompose.js';
import { selectPrimitives } from './select.js';
import { writeOutline, ensureAgency, coreOf, proceduralOutline } from './outline.js';
import { firstPlayable } from './first-playable.js';
import { engageDocument } from './engage.js';
import { detailTasks, writeDetail, acceptPatch } from './detail.js';
import { tweakDocument, reviseDocument, applyOps, reviewChange, worldScaleRequest, routeWorldScale } from './doc-revise.js';
import { contentGrowth } from './revision-check.js';
import { modeOf } from './modes.js';
import { repairDocument, describeErrors } from './repair.js';
import { verifyDocument, regressed } from './verify-adapter.js';
import { coreLoopProblems } from './core-loop.js';
import { catalogHash } from './catalog.js';
import { quality as measureQuality } from '../verify/quality.js';
import { obj, prop, str } from '../kernel/guards.js';

/** @typedef {import('../kernel/types.js').Doc} Doc */
/** @typedef {import('../kernel/types.js').Problem} Problem */
/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** @typedef {import('../kernel/types.js').LogicLike} LogicLike */
/** @typedef {import('./types.js').Writer} Writer */
/** @typedef {import('./verify-adapter.js').Verification} Verification */
/** @typedef {import('./decisions.js').DecisionClient} DecisionClient */
/** @typedef {import('./select.js').Selection} Selection */
/** @typedef {import('./detail.js').DetailTask} DetailTask */
/** @typedef {import('../server/jobs.js').JobSpec} JobSpec */
/** @typedef {import('../server/jobs.js').JobContext} JobContext */
/** The registry and logic for a document (catalog.js). @typedef {{ registry: RegistryLike, logic: LogicLike }} Catalogue */
/** New primitives for a gap (the experiments sandbox). Its document is the service's output, checked by the caller's next stage. @typedef {{ fill(request: { doc: unknown, request: string, gap: unknown }): Promise<{ ok: boolean, doc?: unknown, experiment: Record<string, unknown>, problems?: unknown[] }> }} GapService */
/**
 * @typedef {{ detailConcurrency: number, maxDetailTasks: number, playtestMs: number, detailRepairs: number, outlineRepairRounds: number, reviseRepairs: number,
 *   solveBudgetMs: number, gaps: string, maxGapPrimitives: number, qualityMs: number, presetFirst: boolean, presetPlaytestMs: number }} PipelineConfig
 */
/** Stage durations: null when not measured (AGENTS.md). @typedef {Record<string, number | null>} Timings */
/** @typedef {{ code: string, path?: string, message: string }} PatchProblem */
/**
 * What acceptPatch (detail.js) resolves to, and the rejection a throwing check becomes.
 * @typedef {{ ok: true, doc: Doc, added: import('../kernel/types.js').Added, verify: Verification, fixes: unknown[], patch: unknown } | { ok: false, reason: string, errors: PatchProblem[], patch: unknown }} PatchResult
 */

export const KERNEL_PIPELINE_VERSION = 'v2-kernel/0.1';
export const PIPELINE_CONFIG = Object.freeze(/** @type {PipelineConfig} */ ({
  detailConcurrency: 3, maxDetailTasks: 8, playtestMs: 1500, detailRepairs: 1, outlineRepairRounds: 2, reviseRepairs: 2,
  solveBudgetMs: 800, gaps: 'offer', maxGapPrimitives: 1, qualityMs: 250, presetFirst: true, presetPlaytestMs: 300,
}));

const ms = (/** @type {number} */ t) => Math.round(performance.now() - t);
/** A thrown value's message (or the value), as text. @param {unknown} error */
const errorText = error => String(prop(error, 'message') || error);

/**
 * The quality report for a verification that already passed the publish gate (v2/verify/quality.js). It never
 * blocks: it reuses the gate's playtest, is bounded by `budgetMs`, and a failure is recorded as { error }.
 * Sets v.quality so summarizeVerify keeps it. Returns null when quality is off (budgetMs 0) or there is no document.
 * @param {Verification | null | undefined} v @param {RegistryLike} registry @param {LogicLike} logic
 * @param {{ mechanics?: unknown, budgetMs?: number }} [opts] mechanics: selection.mechanics (a stored report's on revisions)
 * @returns {Record<string, unknown> | null}
 */
export function qualityReport(v, registry, logic, { mechanics = null, budgetMs = PIPELINE_CONFIG.qualityMs } = {}) {
  if (!v?.doc || !budgetMs) return null;
  const t = performance.now();
  /** @type {Record<string, unknown>} */
  let q;
  try { q = measureQuality(v.doc, registry, logic, { playtest: v.playtestRun || null, mechanics, budgetMs }); }
  catch (error) { q = { error: errorText(error).slice(0, 200), findings: [] }; }
  q.ms = ms(t);
  v.quality = q;
  return q;
}
/** @typedef {{ capability: unknown, why: unknown, kind: string, mechanic?: unknown, importance?: unknown }} GapNote */
/** @param {{ description: unknown, why: unknown, kind?: unknown, mechanic: unknown, importance: unknown }} g @returns {GapNote} */
const gapNote = g => ({ capability: g.description, why: g.why, kind: g.kind === 'capability' ? 'capability' : 'unsupported', mechanic: g.mechanic, importance: g.importance });

/**
 * createKernelPipeline({ catalogue(doc?) -> { registry, logic }, writers: { spec, code }, decisions, gapService?, config })
 * catalogue(doc) returns the registry for a document (registered + promoted + its experiment primitives).
 * @param {{ catalogue: (doc: unknown) => Promise<Catalogue>, writers?: { spec?: Writer | null, code?: Writer | null }, decisions?: DecisionClient | null, gapService?: GapService | null, config?: Partial<PipelineConfig> }} options
 */
export function createKernelPipeline({ catalogue, writers = {}, decisions = null, gapService = null, config = {} }) {
  /** @type {PipelineConfig} */
  const cfg = { ...PIPELINE_CONFIG, ...config };
  const spec = writers.spec || null;

  /** @param {JobSpec} job @param {JobContext} ctx */
  async function create(job, ctx) {
    /** @type {Timings} */
    const timings = { queueMs: job.queuedMs ?? null };
    const t0 = performance.now();
    const { registry, logic } = await catalogue(null);
    const seed = job.seed ?? seedFrom(job.prompt);
    // A create job carries its prompt (api.mjs); a missing one is written to the models as empty.
    const prompt = str(job.prompt);
    // Checkpoints are what a failure record keeps to reproduce the run (server/jobs.js); hosts without them ignore them.
    const checkpoint = (/** @type {string} */ name, /** @type {unknown} */ value) => ctx.checkpoint?.(name, value);
    checkpoint('provenance', { pipeline: KERNEL_PIPELINE_VERSION, catalogHash: catalogHash(registry), models: { spec: spec?.model || null, specProvider: spec?.provider || null, decisions: decisions?.provider || null }, seed, prompt: job.prompt, answers: job.answers || [] });
    ctx.stage('decomposing', { model: spec?.model || 'offline' });
    let t = performance.now();
    const decomposition = await decomposeIdea({ writer: spec, prompt, answers: job.answers || [], registry });
    timings.decomposeMs = ms(t);
    checkpoint('decomposition', decomposition);
    ctx.stage('decomposed', { ms: timings.decomposeMs, source: decomposition.source, references: decomposition.references.map(r => r.name), mechanics: decomposition.mechanics.map(m => m.description), ...(decomposition.error ? { error: decomposition.error } : {}) });
    t = performance.now();
    const chosen = await selectPrimitives({ decomposition, registry, decisions, writer: spec });
    const agency = await ensureAgency({ decomposition, selection: chosen, registry, logic, seed, prompt });
    // Cast: ensureAgency (outline.js) has no @returns, so the gap it may add widens Gap.kind to string; at runtime
    // it is a Selection. Remove once outline.js declares its result.
    const selection = /** @type {Selection} */ (agency.selection);
    timings.selectMs = ms(t);
    checkpoint('selection', { mechanics: selection.mechanics, spaces: selection.spaces, systems: selection.systems, graphics: selection.graphics, gaps: selection.gaps, provider: selection.provider, completeness: selection.completeness || null, agency: agency.agency, agencyAttempts: agency.attempts });
    ctx.stage('selected', { ms: timings.selectMs, provider: selection.provider || 'lexical', spaces: selection.spaces.map(s => s.use), systems: selection.systems, gaps: selection.gaps.map(g => g.description), agency: agency.agency, agencyAttempts: agency.attempts });
    const protect = coreOf({ ...selection, mode: decomposition.core ? modeOf(registry, decomposition.core.mode) : null }, registry);
    // The preset first: the game's structure with its content packs (code only) boots and publishes in about a second;
    // the themed outline replaces it when the model's small forms are in. Without a model the outline is the preset.
    /** @type {{ doc: Doc, ms: number } | null} */
    let presetVersion = null;
    if (spec && cfg.presetFirst) {
      const tp = performance.now();
      const pre = proceduralOutline({ decomposition, selection, registry, logic, seed, prompt });
      if (pre.ok) {
        const pfp = firstPlayable(engageDocument(pre.doc, registry, logic).doc, registry, logic, { seed, protect });
        if (pfp.ok && pfp.doc) {
          const pv = await verifyDocument(pfp.doc, registry, logic, { budgetMs: 300, playtestMs: cfg.presetPlaytestMs });
          if (pv.viable && !coreLoopProblems(pfp.doc, selection.mechanics, registry).length) {
            timings.presetMs = ms(tp); timings.requestToFirstPlayableMs = ms(t0);
            await ctx.store.updateMeta(job.gameId, { title: pfp.doc.title, kind: 'kernel' });
            await ctx.publish({ doc: pfp.doc, stage: 'first_playable', report: { kind: 'kernel', decomposition, selection: { mechanics: selection.mechanics, spaces: selection.spaces, systems: selection.systems, graphics: selection.graphics, gaps: selection.gaps, provider: selection.provider }, gaps: selection.gaps.map(gapNote), summary: pfp.doc.logline || decomposition.premise, verified: true, verification: summarizeVerify(pv), outline: { source: 'preset', structure: /** @type {any} */ (pre).structure ?? null }, timings: { ...timings } }, provenance: { pipeline: KERNEL_PIPELINE_VERSION, catalogHash: catalogHash(registry), seed, prompt: job.prompt, outlineSource: 'preset' } });
            ctx.stage('first_playable', { ms: timings.requestToFirstPlayableMs, source: 'preset' });
            presetVersion = { doc: pfp.doc, ms: timings.requestToFirstPlayableMs };
          }
        }
      }
      if (!presetVersion) timings.presetMs = ms(tp);
    }
    ctx.stage('outlining', { model: spec?.model || 'procedural' });
    t = performance.now();
    const outline = await writeOutline({ writer: spec, prompt, answers: job.answers || [], decomposition, selection, registry, logic, seed, maxRounds: cfg.outlineRepairRounds, escalate: writers.code || null });
    timings.outlineMs = ms(t); timings.outlineModelMs = spec ? outline.modelMs : null;
    checkpoint('outline', { ok: outline.ok, source: outline.source, rounds: outline.rounds, firstPassOk: outline.firstPassOk, fellBack: Boolean(outline.fellBack), isolated: Boolean(outline.isolated), errors: (outline.errors || []).slice(0, 20), removed: outline.removed || [], content: (outline.content || []).map(p => `${p.code} ${p.path}: ${p.message}`).slice(0, 20), doc: outline.doc });
    ctx.stage('outlined', { ms: timings.outlineMs, source: outline.source, rounds: outline.rounds, firstPassOk: outline.firstPassOk, fellBack: Boolean(outline.fellBack) });
    if (!outline.ok) throw Object.assign(Error(`The outline failed checks: ${outline.errors.slice(0, 3).map(e => `${prop(e, 'code')} ${prop(e, 'path')}`).join('; ')}`), { status: 422 });

    // Layer 2: first playable, zero model calls.
    t = performance.now();
    // Last document step before play: wire the player and AI participants into the chosen mechanics (card.engage).
    const engaged = engageDocument(outline.doc, registry, logic);
    checkpoint('engage', { ok: engaged.ok, applied: engaged.applied, skipped: engaged.skipped, errors: engaged.errors });
    const fp = firstPlayable(engaged.doc, registry, logic, { seed, protect });
    timings.firstPlayableBuildMs = ms(t);
    if (!fp.ok) checkpoint('firstPlayable', { ok: false, ms: fp.ms, errors: (fp.errors || []).slice(0, 20), problems: (fp.problems || []).slice(0, 20), removed: fp.removed || [] });
    if (!fp.ok) throw Object.assign(Error(`The first playable would not start: ${[...fp.errors, ...fp.problems].slice(0, 3).map(e => e.message || e.code).join('; ')}`), { status: 422 });
    let current = fp.doc;
    /** @type {GapNote[]} */
    const gaps = [...selection.gaps.map(gapNote), ...[...(outline.removed || []), ...fp.removed].map(r => ({ capability: r.use, why: r.why, kind: r.kind === 'capability' ? 'capability' : 'removed' }))];
    await ctx.store.updateMeta(job.gameId, { title: current.title, kind: 'kernel' });
    const common = { kind: 'kernel', decomposition, selection: { mechanics: selection.mechanics, spaces: selection.spaces, systems: selection.systems, graphics: selection.graphics, gaps: selection.gaps, provider: selection.provider }, gaps, summary: current.logline || decomposition.premise };
    const provenance = (/** @type {Record<string, unknown>} */ extra) => ({ pipeline: KERNEL_PIPELINE_VERSION, catalogHash: catalogHash(registry), models: { spec: spec?.model || null, specProvider: spec?.provider || null, decisions: decisions?.provider || null }, seed, prompt: job.prompt, answers: job.answers || [], outlineSource: outline.source, decompositionHash: hashOf(decomposition), ...extra });
    // The publish gate: a playtest agent must play this exact document to a winning ending, and nothing may crash.
    t = performance.now();
    const base = outline.verification && hashOf(outline.verification.doc ?? null) === hashOf(current) ? outline.verification
      : await verifyDocument(current, registry, logic, { budgetMs: cfg.solveBudgetMs, playtestMs: cfg.playtestMs });
    timings.gateMs = ms(t);
    checkpoint('gate', { viable: Boolean(base.viable), viability: base.viability || null, playtest: base.playtest || null, problems: (base.problems || []).slice(0, 20) });
    if (!base.viable) throw Object.assign(Error(`No playable game yet: ${base.viability}`), { status: 422, code: 'not_playable' });
    const core = coreLoopProblems(current, selection.mechanics, registry);
    checkpoint('coreLoop', { problems: core });
    // Offline (no model) builds are a development path: report the gap, the model-written path enforces it.
    if (spec && core.length) throw Object.assign(Error(`This isn't the game you asked for yet: ${core.slice(0, 3).map(p => p.message).join('; ')}`), { status: 422, code: core[0].code });
    // Quality is measured only once the gate passed, and never changes what publishes.
    t = performance.now();
    const quality = qualityReport(base, registry, logic, { mechanics: selection.mechanics, budgetMs: cfg.qualityMs });
    timings.qualityMs = quality ? ms(t) : null;
    if (presetVersion) timings.requestToThemedMs = ms(t0); else timings.requestToFirstPlayableMs = ms(t0);
    await ctx.publish({ doc: current, stage: presetVersion ? 'themed' : 'first_playable', report: { ...common, verified: true, verification: summarizeVerify(base), playtest: base.playtest, quality, outline: { source: outline.source, structure: /** @type {any} */ (outline).structure ?? null, rounds: outline.rounds, firstPassOk: outline.firstPassOk, fellBack: Boolean(outline.fellBack), isolated: Boolean(outline.isolated) }, firstPlayable: { ms: fp.ms, start: fp.start, options: fp.options, stateHash: fp.stateHash }, timings: { ...timings } }, provenance: provenance({ outlineHash: hashOf(current) }) });
    ctx.stage(presetVersion ? 'themed' : 'first_playable', { ms: presetVersion ? timings.requestToThemedMs : timings.requestToFirstPlayableMs, buildMs: timings.firstPlayableBuildMs, gateMs: timings.gateMs });
    ctx.stage('verified', { ms: timings.gateMs, verification: summarizeVerify(base) });

    // Layer 3: detail patches in parallel; merges are serialized in completion order.
    const tasks = detailTasks(current, { max: cfg.maxDetailTasks });
    /** @type {{ proposed: number, accepted: number, rejected: Array<{ task: string, reason: string | undefined }>, tasks: Array<Record<string, unknown>> }} */
    const detail = { proposed: 0, accepted: 0, rejected: [], tasks: [] };
    /** @type {Promise<void>} */
    let merging = Promise.resolve();
    let baseVerify = base;
    /** @param {DetailTask} task */
    const runTask = async task => {
      const tt = performance.now();
      ctx.stage('detail', { task: task.id });
      /** @type {Awaited<ReturnType<typeof writeDetail>>} */
      let written;
      try { written = await writeDetail({ writer: spec, doc: current, task, registry, logic }); }
      catch (error) { detail.tasks.push({ task: task.id, ok: false, reason: 'writer', error: errorText(error).slice(0, 120), ms: ms(tt) }); detail.proposed++; detail.rejected.push({ task: task.id, reason: 'writer' }); return; }
      detail.proposed++;
      await (merging = merging.then(async () => {
        // A patch never takes the pipeline down: anything that throws while checking it is a rejection.
        // Cast: acceptPatch (detail.js) does not declare its result, so `ok` widens to boolean and does not narrow;
        // PatchResult is what it returns. Remove once detail.js declares it.
        /** @param {unknown} patch @returns {Promise<PatchResult>} */
        const accept = patch => acceptPatch({ current, patch, task, registry, logic, baseVerify, budgetMs: cfg.solveBudgetMs })
          .then(r => /** @type {PatchResult} */ (r))
          .catch(error => ({ ok: false, reason: 'threw', errors: [{ code: 'patch_threw', path: '$', message: errorText(error).slice(0, 200) }], patch }));
        let result = await accept(written.patch);
        for (let r = 0; !result.ok && spec && r < cfg.detailRepairs && result.reason !== 'empty'; r++) {
          // Cast: writeDetail (detail.js) takes Problem[], while acceptPatch's errors include verification problems
          // whose path is optional. Remove once writeDetail accepts PatchProblem[].
          try { written = await writeDetail({ writer: spec, doc: current, task, registry, logic, errors: /** @type {Problem[]} */ (result.errors), previous: result.patch }); } catch { break; }
          result = await accept(written.patch);
        }
        /** @type {Record<string, unknown>} */
        const entry = { task: task.id, ok: result.ok, source: written.source, modelMs: written.ms ?? null, ms: ms(tt), ...(result.ok ? { fixes: result.fixes.length } : { reason: result.reason, errors: (result.errors || []).slice(0, 4).map(e => e.code || e.message) }) };
        detail.tasks.push(entry);
        if (!result.ok) { detail.rejected.push({ task: task.id, reason: result.reason }); ctx.stage('detail_rejected', { task: task.id, reason: result.reason }); return; }
        current = result.doc; baseVerify = result.verify; detail.accepted++;
        const tq = performance.now(), quality = qualityReport(result.verify, registry, logic, { mechanics: selection.mechanics, budgetMs: cfg.qualityMs });
        entry.qualityMs = quality ? ms(tq) : null;
        await ctx.publish({ doc: current, stage: `detail:${task.zone}`, report: { ...common, added: result.added, verified: true, verification: summarizeVerify(result.verify), quality, detail: entry, timings: { ...timings, sinceRequestMs: ms(t0) } }, provenance: provenance({ task: task.id }) });
      }));
    };
    const queue = [...tasks];
    await Promise.all(Array.from({ length: Math.min(cfg.detailConcurrency, queue.length) }, async () => { while (queue.length) await runTask(/** @type {DetailTask} */ (queue.shift())); }));
    await merging;
    timings.detailMs = ms(t0) - Number(timings.requestToFirstPlayableMs);

    // Layer 4: gaps -> new primitives (background, bounded by config). A gap's document comes from the experiments
    // service (its own checks ran there): it is published and handed on as it is.
    /** @type {unknown} */
    let latest = current;
    /** @type {Array<Record<string, unknown>>} */
    const filled = [];
    if (cfg.gaps === 'auto' && gapService) {
      for (const g of selection.gaps.filter(g => g.importance === 'core').slice(0, cfg.maxGapPrimitives)) {
        const tg = performance.now();
        ctx.stage('gap', { mechanic: g.mechanic });
        try {
          const r = await gapService.fill({ doc: latest, request: g.description, gap: g });
          if (r.ok) {
            latest = r.doc; filled.push({ mechanic: g.mechanic, experiment: r.experiment.id, ms: ms(tg) });
            await ctx.publish({ doc: latest, stage: `gap:${g.mechanic}`, report: { ...common, gaps: common.gaps.filter(x => x.mechanic !== g.mechanic), experiment: { id: r.experiment.id, label: r.experiment.label }, changes: [`experimental: ${r.experiment.label}`], timings: { ...timings, sinceRequestMs: ms(t0) } }, provenance: provenance({ experiment: r.experiment.id }) });
          } else filled.push({ mechanic: g.mechanic, ok: false, problems: r.problems, ms: ms(tg) });
        } catch (error) { filled.push({ mechanic: g.mechanic, ok: false, error: errorText(error).slice(0, 160), ms: ms(tg) }); }
      }
    }
    timings.totalMs = ms(t0);
    ctx.stage('complete', { timings, detail: { proposed: detail.proposed, accepted: detail.accepted, rejected: detail.rejected }, gaps: filled });
    return { doc: latest, timings, detail, gaps: filled, firstVerification: summarizeVerify(base), decomposition, selection, outline: { source: outline.source, structure: /** @type {any} */ (outline).structure ?? null, rounds: outline.rounds, firstPassOk: outline.firstPassOk, fellBack: Boolean(outline.fellBack), isolated: Boolean(outline.isolated) }, base };
  }

  /** @param {JobSpec} job @param {JobContext} ctx */
  async function revise(job, ctx) {
    /** @type {Timings} */
    const timings = {};
    const t0 = performance.now();
    // A stored version (from disk, or across the job process boundary): narrowed here. Its document is checked by
    // the revision stages and verified (preflight) below.
    const previous = obj(await ctx.store.version(job.gameId, Number(job.base)));
    if (!previous.doc) throw Object.assign(Error('That version is missing.'), { status: 404 });
    const { registry, logic } = await catalogue(previous.doc);
    // The stored document becomes a Doc through preflight (published versions are preflighted documents, so this is
    // the same document unless the catalogue changed since).
    const stored = preflight(previous.doc, registry, logic);
    if (!stored.ok) throw Object.assign(Error(`That version no longer passes checks: ${stored.errors.slice(0, 3).map(e => `${e.code} ${e.path}`).join('; ')}`), { status: 422 });
    const before = stored.doc;
    // A revise job carries its change (api.mjs); a missing one is written to the models as empty.
    const change = str(job.change);
    ctx.stage('revising', { change: job.change });
    // Layer 5 first: a parameter tweak with no model.
    let t = performance.now();
    const tweak = await tweakDocument(before, job.change, { registry, decisions });
    timings.tweakMs = ms(t);
    /** @type {Doc | null} */
    let after = null;
    /** @type {Array<{ request: unknown, why?: unknown }>} */
    let unsupported = [];
    /** @type {string | null} */
    let path = null;
    /** @type {number | null} */
    let modelMs = null;
    /** @type {unknown[]} */
    let opsApplied = [];
    /** A world-size change (doc-revise scaleWorld): its factor and the spaces it scaled. @type {{ factor: number, [k: string]: unknown } | null} */
    let scaled = tweak.scaled || null;
    if (tweak.matched) { after = tweak.doc; path = tweak.scaled ? 'scale' : 'tweak'; opsApplied = tweak.ops; ctx.stage('tweaked', { ms: timings.tweakMs, ops: tweak.ops.length, source: tweak.source }); }
    if (!after && spec) {
      t = performance.now();
      let r = await reviseDocument({ writer: spec, doc: before, change, registry, logic });
      modelMs = r.ms; unsupported = r.unsupported;
      // Ops that only resize a space's extent become scaleWorld, so the generated content grows with the container.
      let routed = routeWorldScale(before, r.ops, registry); if (routed.scaled.length) scaled = { factor: routed.scaled[0].factor, spaces: routed.scaled };
      let applied = applyOps(routed.doc, routed.ops), repaired = repairDocument(applied.doc, { registry, logic, rounds: 4 });
      for (let n = 0; !repaired.ok && n < cfg.reviseRepairs; n++) {
        r = await reviseDocument({ writer: spec, doc: before, change, registry, logic, errors: describeErrors(repaired.errors), previous: r.ops });
        modelMs = (modelMs ?? 0) + r.ms; unsupported = r.unsupported;
        routed = routeWorldScale(before, r.ops, registry); if (routed.scaled.length) scaled = { factor: routed.scaled[0].factor, spaces: routed.scaled };
        applied = applyOps(routed.doc, routed.ops); repaired = repairDocument(applied.doc, { registry, logic, rounds: 4 });
      }
      timings.reviseMs = ms(t); timings.reviseModelMs = modelMs;
      if (!repaired.ok) ctx.checkpoint?.('revision', { base: job.base, change: job.change, path: 'model', ops: (r.ops || []).slice(0, 50), unsupported, errors: repaired.errors.slice(0, 20), timings: { ...timings }, doc: repaired.doc });
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
    ctx.checkpoint?.('revision', { base: job.base, change: job.change, path, ops: opsApplied.slice(0, 50), unsupported, timings: { ...timings }, doc: after });
    const v = await verifyDocument(after, registry, logic, { budgetMs: cfg.solveBudgetMs, playtestMs: cfg.playtestMs });
    const vBefore = await verifyDocument(before, registry, logic, { budgetMs: cfg.solveBudgetMs });
    const guard = await reviewChange({ before, after, change, decisions, unsupported, verifyBefore: vBefore, verifyAfter: v });
    timings.guardMs = ms(t); timings.verifyMs = timings.guardMs;
    if (guard.block) throw Object.assign(Error(guard.block.message), { status: 422, code: guard.block.code });
    // A world-size request is done only when the generated content grew (cells, entities, zones, rooms), not a container param.
    let growth = null;
    // The revision check as published: the checker's, or (when the world did not grow) at least notApplied and why.
    /** @type {Partial<import('./revision-check.js').RevisionCheck> | null} */
    let revisionCheck = guard.revisionCheck;
    if (scaled || worldScaleRequest(job.change)) {
      growth = contentGrowth(before, after, registry, logic);
      const wantGrow = (scaled?.factor ?? worldScaleRequest(job.change) ?? 1) > 1;
      if (wantGrow && !growth.grew) revisionCheck = { ...(revisionCheck || {}), notApplied: true, why: 'Only the world\'s container grew: nothing it generates (cells, rooms, zones, entities) got bigger.' };
    }
    const notApplied = revisionCheck?.notApplied || (guard.diff === 0);
    const gaps = [...(unsupported || []).map(u => ({ capability: String(u.request).slice(0, 160), why: String(u.why || '').slice(0, 240), kind: 'unsupported' })),
      ...(notApplied && !(unsupported || []).length ? [guard.diff
        ? { capability: job.change, why: `Changed ${guard.changes.join(', ')}, but the checker isn't sure that fully does what you asked.`, kind: 'partial' }
        : { capability: job.change, why: 'Nothing in this game changed for that request: no primitive here has a setting for it yet.', kind: 'unsupported' }] : [])];
    // Selected mechanics carry forward from the version revised, so every version's quality can check coverage.
    const selection = prop(previous.report, 'selection') ?? null;
    t = performance.now();
    const quality = qualityReport(v, registry, logic, { mechanics: prop(selection, 'mechanics') ?? null, budgetMs: cfg.qualityMs });
    timings.qualityMs = quality ? ms(t) : null;
    timings.totalMs = ms(t0);
    return ctx.publish({
      doc: v.doc, stage: `revision: ${job.change}`,
      report: { kind: 'kernel', change: job.change, path, ...(growth ? { growth: { grew: growth.grew, what: growth.what, before: growth.before, after: growth.after } } : {}), ops: opsApplied.slice(0, 20), changes: guard.changes, notes: guard.notes || [], diffLines: guard.lines, revisionCheck, gaps, verified: true, verification: summarizeVerify(v), quality, ...(selection ? { selection } : {}), hot: path === 'tweak' ? 'params' : 'reload', timings },
      provenance: { ...obj(previous.provenance), pipeline: KERNEL_PIPELINE_VERSION, base: job.base, change: job.change, revisePath: path, models: { spec: path === 'model' ? spec?.model : null, specProvider: path === 'model' ? spec?.provider || null : null, decisions: decisions?.provider || null } },
    });
  }

  const pipeline = (/** @type {JobSpec} */ job, /** @type {JobContext} */ ctx) => (job.kind === 'revise' ? revise(job, ctx) : create(job, ctx));
  pipeline.version = KERNEL_PIPELINE_VERSION;
  pipeline.create = create; pipeline.revise = revise;
  return pipeline;
}

/** @param {Verification | null | undefined} v */
export function summarizeVerify(v) {
  if (!v) return null;
  return { ok: v.ok, source: v.source, completable: v.completable, exhaustive: v.exhaustive, ms: v.ms, preflightMs: v.preflight?.ms ?? null, warnings: (v.preflight?.warnings || []).length,
    endings: v.solve ? Object.keys(v.solve.endings || {}) : null, beatsNeverFired: v.solve?.beatsNeverFired?.slice(0, 10) ?? null, states: v.solve?.states ?? null, problems: (v.problems || []).slice(0, 5),
    playtest: v.playtest ?? null, quality: v.quality ?? null };
}

export { decomposeOffline };
