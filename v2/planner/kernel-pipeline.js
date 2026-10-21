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
import { writeOutline, ensureAgency } from './outline.js';
import { diagnose, replan, gapRequest, addedBy, experimentsOf, missingText } from './replan.js';
import { applySkins, mashupAdapterProblems } from './adapters.js';
import { firstPlayable } from './first-playable.js';
import { engageDocument } from './engage.js';
import { detailTasks, writeDetail, acceptPatch } from './detail.js';
import { tweakDocument, reviseDocument, applyOps, reviewChange, worldScaleRequest, routeWorldScale } from './doc-revise.js';
import { contentGrowth } from './revision-check.js';
import { repairDocument, describeErrors } from './repair.js';
import { verifyDocument, regressed } from './verify-adapter.js';
import { coreLoopProblems } from './core-loop.js';
import { loopProblems } from './loop-check.js';
import { loopCore } from './presets.js';
import { catalogHash } from './catalog.js';
import { quality as measureQuality } from '../verify/quality.js';
import { obj, prop, str } from '../kernel/guards.js';
import { TEMPLATES } from '../templates/registry.js';
import { TEMPLATE_PATH_VERSION, askPick, composeTemplates, writeContent, offeredTemplates, instancesIn, narrowPick, checkPick, chooseReading, templateLoops } from './templates.js';
import { EXTEND_VERSION, extendDocument, paramsForm, recordingWriter, unengaged } from './extend.js';
import { cardLoop } from './loop.js';
import { instanceVerbs } from '../primitives/engine/runtime-lib-controls.js';

/** @typedef {import('../kernel/types.js').Doc} Doc */
/** @typedef {import('../kernel/types.js').Problem} Problem */
/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** @typedef {import('../kernel/types.js').LogicLike} LogicLike */
/** @typedef {import('./types.js').Writer} Writer */
/** @typedef {import('./templates.js').Template} Template */
/** @typedef {import('./verify-adapter.js').Verification} Verification */
/** @typedef {import('./decisions.js').DecisionClient} DecisionClient */
/** @typedef {import('./select.js').Selection} Selection */
/** @typedef {import('./detail.js').DetailTask} DetailTask */
/** @typedef {import('../server/jobs.js').JobSpec} JobSpec */
/** @typedef {import('../server/jobs.js').JobContext} JobContext */
/** The registry and logic for a document (catalog.js). @typedef {{ registry: RegistryLike, logic: LogicLike }} Catalogue */
/** New primitives for a gap (the experiments sandbox). Its document is the service's output, checked by the caller's next stage. @typedef {{ fill(request: { doc: unknown, request: string, gap: unknown }): Promise<{ ok: boolean, doc?: unknown, experiment: Record<string, unknown>, problems?: unknown[] }> }} GapService */
/**
 * Limits: modelAttempts bounds the calls for the play spec and the catalogue mapping (a failing call is asked again, then
 * the stage fails); outlineRepairRounds bounds the model's field repairs inside one build attempt; replanAttempts bounds the build
 * attempts (each after diagnosing and re-planning a failure); maxGapPrimitives bounds the primitives the gap layer
 * writes (only with gaps 'auto'). When they are exhausted the build fails with what it tried and what is missing.
 * @typedef {{ detailConcurrency: number, maxDetailTasks: number, detailRepairs: number, outlineRepairRounds: number, reviseRepairs: number,
 *   gaps: string, maxGapPrimitives: number, qualityMs: number, replanAttempts: number, modelAttempts: number }} PipelineConfig
 */
/** Stage durations: null when not measured (AGENTS.md). @typedef {Record<string, number | null>} Timings */
/** @typedef {{ code: string, path?: string, message: string }} PatchProblem */
/**
 * What acceptPatch (detail.js) resolves to, and the rejection a throwing check becomes.
 * @typedef {{ ok: true, doc: Doc, added: import('../kernel/types.js').Added, verify: Verification, fixes: unknown[], patch: unknown } | { ok: false, reason: string, errors: PatchProblem[], patch: unknown }} PatchResult
 */

export const KERNEL_PIPELINE_VERSION = 'v2-kernel/0.1';
export const PIPELINE_CONFIG = Object.freeze(/** @type {PipelineConfig} */ ({
  detailConcurrency: 3, maxDetailTasks: 8, detailRepairs: 1, outlineRepairRounds: 2, reviseRepairs: 2,
  gaps: 'offer', maxGapPrimitives: 1, qualityMs: 250, replanAttempts: 3, modelAttempts: 2,
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

  /**
   * The template path (ARCHITECTURE §5): pick (1 call) -> compose (code) -> content forms (parallel) -> preflight ->
   * loop check -> first playable -> the publish gate -> publish. Templates are complete verified documents: a check
   * failing after composition is a template defect and the build fails with its problems (never repaired around,
   * never substituted). A pick naming a game or genre no template is routes the whole idea to the step path.
   * Readings: a pick that names a concept the idea can mean two ways (templates.js `readings`) stops with a question
   * (409 'needs_answer': the questions and the pick are kept as the checkpoint 'question'); the job that carries the
   * answers and that pick (job.pick, held to the same checks) builds the reading chosen, asking nothing again.
   * Extensions: the mechanics the pick names that the composed templates do not give are added onto the composed
   * document (extend.js), each checked, their params written in the content round; a mechanic nothing covers fails the
   * build naming it (422 'extension_missing') before any content is asked.
   * Timings are measured (null when not): pickMs, extendMs, contentMs, composeMs (code composing the pick into a
   * document, content applied and checked, excluding model calls, the extension steps and the gate), gateMs,
   * requestToFirstPlayableMs; modelCalls counts every call, modelRounds the sequential ones (the pick's calls, the
   * extension steps' questions, then the most calls any parallel content form made).
   * @param {JobSpec} job @param {JobContext} ctx
   * @param {{ registry: RegistryLike, logic: LogicLike, seed: number | string, prompt: string, t0: number, timings: Timings }} run
   * @returns {Promise<{ path: 'template', result: Record<string, unknown> } | { path: 'step', pick: { pick: import('./templates.js').Pick, stepPath: string[], why: string, calls: number } }>}
   */
  async function templateCreate(job, ctx, { registry, logic, seed, prompt, t0, timings }) {
    const writer = /** @type {Writer} */ (spec), escalate = writers.code || null;
    const checkpoint = (/** @type {string} */ name, /** @type {unknown} */ value) => ctx.checkpoint?.(name, value);
    const templates = offeredTemplates(/** @type {readonly Template[]} */ (TEMPLATES), registry);
    /** @type {import('./templates.js').TemplateCall[]} */
    const calls = [];
    const clock = { codeMs: 0 };
    ctx.stage('picking_templates', { model: writer.model, templates: templates.map(t => t.id) });
    const fail = (/** @type {string} */ code, /** @type {string} */ stage, /** @type {Array<{ code?: unknown, path?: unknown, message?: unknown }>} */ problems) => {
      checkpoint('templateFailure', { stage, code, problems: problems.slice(0, 20), calls });
      ctx.stage('not_buildable', { path: 'template', stage, code, missing: problems.slice(0, 8).map(p => `${p.code} ${p.path ?? ''}: ${String(p.message ?? '').slice(0, 200)}`) });
      return Object.assign(Error(`This isn't the game you asked for yet: the template path failed at ${stage}: ${problems.slice(0, 4).map(p => `${p.code} ${p.path ?? ''}: ${String(p.message ?? '').slice(0, 200)}`).join('; ')}`), { status: 422, code, report: { path: 'template', stage, problems, calls } });
    };
    let t = performance.now();
    // A job answering the pick's question carries that pick (kept by the job that asked): it is held to the pick's
    // checks like a model answer, and never asked again.
    /** @type {{ pick: import('./templates.js').Pick, stepPath: string[], calls: number }} */
    let picked;
    if (job.pick !== undefined) {
      const pick = narrowPick(job.pick), checked = checkPick(pick, { templates, registry });
      if (checked.problems.length) throw fail('pick_resume_invalid', 'pick', checked.problems.map(p => ({ code: p.code, path: p.field, message: p.message })));
      picked = { pick, stepPath: checked.stepPath, calls: 0 };
    } else picked = await askPick({ writer, escalate, attempts: cfg.modelAttempts, prompt, templates, registry, calls, clock });
    timings.pickMs = ms(t);
    clock.codeMs = 0; // composeMs counts the code after the pick: composition, content applied and checked
    checkpoint('templatePick', { pick: picked.pick, stepPath: picked.stepPath, calls });
    // Never guess between readings: a concept the idea can mean two ways is the player's choice.
    const read = chooseReading(picked.pick, job.answers || [], { templates, registry });
    if (read.unanswered.length) {
      const questions = read.questions.map(({ id, question, options }) => ({ id, question, options }));
      checkpoint('question', { questions, pick: picked.pick });
      ctx.stage('question', { questions });
      throw Object.assign(Error(`Which game did you mean? ${read.unanswered.map(q => `${q.question} ${q.options.map(o => `"${o}"`).join(' or ')}`).join('; ')}`), { status: 409, code: 'needs_answer', report: { path: 'template', stage: 'reading', questions, pick: picked.pick, calls } });
    }
    if (!read.pick) throw fail('pick_reading_invalid', 'reading', read.problems.map(p => ({ code: p.code, path: p.field, message: p.message })));
    const pick = read.pick;
    const stepPath = checkPick(pick, { templates, registry }).stepPath;
    if (stepPath.length) {
      const why = `no template is ${stepPath.map(n => `'${n}'`).join(', ')}: the step path builds the whole idea`;
      ctx.stage('templates_picked', { ms: timings.pickMs, path: 'step', why, stepPath, calls: calls.length });
      return { path: 'step', pick: { pick, stepPath, why, calls: calls.length } };
    }
    let tc = performance.now();
    const composed = composeTemplates(pick, { templates, registry, logic });
    clock.codeMs += performance.now() - tc;
    if (!composed.doc || !composed.template) throw fail(composed.problems[0]?.code ?? 'template_composition_failed', 'composition', composed.problems);
    const template = composed.template;
    const used = composed.parts.map(p => p.template.id);
    // A check failing after composition is a defect of the template, or of the composition of several (never repaired around).
    const defect = used.length > 1 ? 'composition_defect' : 'template_defect';
    composed.doc.seed = seed;
    // The composed document must preflight before the content forms change it: a failure here is the template's defect.
    tc = performance.now();
    const base = preflight(structuredClone(composed.doc), registry, logic);
    clock.codeMs += performance.now() - tc;
    if (!base.ok) throw fail(defect, 'preflight', base.errors);
    ctx.stage('templates_picked', { ms: timings.pickMs, path: 'template', templates: used, joins: composed.joins, themes: composed.themes.map(x => x.name), calls: calls.length });
    // The idea's mechanics the templates do not give, added onto the composed document one by one, each checked.
    t = performance.now();
    const before = calls.length;
    const interactions = [...new Set(templateLoops(composed.parts[0].template, registry).loops.flatMap(l => l.interactions))];
    const ext = await extendDocument({ doc: composed.doc, mechanics: pick.mechanics, registry, logic, writer: recordingWriter(writer, calls), attempts: cfg.modelAttempts, interactions,
      header: `Game idea: ${prompt}\nThe game: ${pick.title}: ${pick.premise}\nBuilt from the verified templates ${composed.parts.map(p => `'${p.template.id}' (${p.template.concept})`).join(' and ')}, played as ${interactions.join(' or ') || 'its loops are'}.`,
      gaps: { mode: cfg.gaps, service: gapService, max: cfg.maxGapPrimitives }, catalogue, stage: (name, detail) => ctx.stage(name, detail) });
    timings.extendMs = pick.mechanics.length ? ms(t) : null;
    const extensionCalls = calls.length - before;
    checkpoint('extensions', { coverage: ext.coverage, added: ext.added });
    if (ext.missing.length) throw fail('extension_missing', 'extension', ext.missing.map(c => ({ code: 'extension_missing', path: `mechanics.${c.mechanic}`, message: `"${c.mechanic}" (${c.importance}${c.verb !== 'none' ? `, verb '${c.verb}'` : ''}) is still missing: ${c.why}` })));
    ({ registry, logic } = ext);
    const extended = ext.doc;
    const extUses = new Set(ext.coverage.filter(c => c.by === 'extension' || c.by === 'gap').flatMap(c => c.primitives));
    /** @type {NonNullable<ReturnType<typeof paramsForm>>[]} */
    const paramForms = [];
    for (const use of ext.added) { const f = paramsForm(extended, use, { registry, logic }); if (f) paramForms.push(f); }
    t = performance.now();
    const content = await writeContent({ writer, escalate, attempts: cfg.modelAttempts, template, doc: composed.doc, pick, themes: composed.themes, registry, logic, calls, clock, parts: composed.parts, onto: extended,
      extra: paramForms.map(f => ({ ...f, mechanic: ext.coverage.find(c => c.primitives[0] === f.use)?.mechanic ?? f.use })) });
    timings.contentMs = ms(t);
    ctx.stage('content_written', { ms: timings.contentMs, forms: content.forms });
    // Checks of the document that will be played: preflight, the loop check, first playable. A template is complete,
    // so nothing of it is engaged, furnished or isolated here; an extension's primitives are engaged as their cards
    // declare (engage.js `only`), and the player must get their verbs.
    tc = performance.now();
    /** @type {Record<string, any>} */
    let played = content.doc;
    if (extUses.size) {
      const unfilled = unengaged(played, [...extUses], { registry, logic });
      if (unfilled.length) throw fail('extension_unengaged', 'extension', unfilled.map(u => ({ code: 'extension_unengaged', path: u.use, message: u.message })));
      const engaged = engageDocument(/** @type {Doc} */ (played), registry, logic, { only: extUses });
      if (!engaged.ok) throw fail('extension_unengaged', 'extension', engaged.errors);
      played = engaged.doc;
      const unusable = ext.added.filter(use => { const card = registry.get(use)?.card; return (cardLoop(card)?.verbs ?? []).length > 0 && !instancesIn(played).some(i => i.use === use && instanceVerbs(card, i, played).length > 0); });
      if (unusable.length) throw fail('extension_unusable', 'extension', unusable.map(use => ({ code: 'extension_unusable', path: use, message: `the player gets none of ${use}'s verbs` })));
    }
    const pre = preflight(played, registry, logic);
    if (!pre.ok) throw fail(defect, 'preflight', pre.errors);
    const loop = loopProblems(pre.doc, registry, { logic });
    if (loop.length) throw fail(defect, 'loop', loop);
    const fp = firstPlayable(pre.doc, registry, logic, { seed, protect: new Set(instancesIn(pre.doc).map(i => String(i.use))), maxIsolations: 0, furnish: false });
    clock.codeMs += performance.now() - tc;
    if (!fp.ok) throw fail(defect, 'first_playable', [...fp.errors, ...fp.problems]);
    timings.composeMs = Math.round(clock.codeMs);
    const tg = performance.now();
    const v = await verifyDocument(fp.doc, registry, logic, { playable: true });
    timings.gateMs = ms(tg);
    if (!v.viable) throw fail('not_playable', 'gate', [{ code: 'not_playable', path: '$', message: String(v.viability || 'not viable') }, ...(v.problems || []).filter(p => p.severity === 'error').slice(0, 8)]);
    t = performance.now();
    const quality = qualityReport(v, registry, logic, { budgetMs: cfg.qualityMs });
    timings.qualityMs = quality ? ms(t) : null;
    timings.firstPlayableBuildMs = fp.ms;
    timings.requestToFirstPlayableMs = ms(t0);
    const modelCalls = calls.length, modelRounds = picked.calls + extensionCalls + content.rounds;
    const doc = fp.doc;
    await ctx.store.updateMeta(job.gameId, { title: doc.title, kind: 'kernel' });
    const report = { kind: 'kernel', path: 'template', templates: used, joins: composed.joins, pick, themes: composed.themes, mechanics: ext.coverage, extensionCalls, content: content.forms, calls, modelCalls, modelRounds,
      summary: doc.logline || pick.premise, gaps: [], verified: true, verification: summarizeVerify(v), features: v.features ?? null, playtest: v.playtest, quality,
      firstPlayable: { ms: fp.ms, start: fp.start, options: fp.options, stateHash: fp.stateHash }, timings: { ...timings } };
    const provenance = { pipeline: KERNEL_PIPELINE_VERSION, templatePath: TEMPLATE_PATH_VERSION, catalogHash: catalogHash(registry), models: { spec: writer.model || null, specProvider: writer.provider || null, code: escalate?.model || null },
      seed, prompt: job.prompt, answers: job.answers || [], templates: used, extend: EXTEND_VERSION, pickHash: hashOf(pick), outlineHash: hashOf(doc) };
    checkpoint('gate', { viable: Boolean(v.viable), viability: v.viability || null, playtest: v.playtest || null, problems: (v.problems || []).slice(0, 20) });
    await ctx.publish({ doc, stage: 'first_playable', report, provenance });
    ctx.stage('first_playable', { ms: timings.requestToFirstPlayableMs, buildMs: fp.ms, gateMs: timings.gateMs, path: 'template', modelCalls, modelRounds, pickMs: timings.pickMs, contentMs: timings.contentMs, composeMs: timings.composeMs });
    ctx.stage('verified', { ms: timings.gateMs, verification: summarizeVerify(v) });
    timings.totalMs = ms(t0);
    ctx.stage('complete', { timings, path: 'template', modelCalls, modelRounds });
    return { path: 'template', result: { doc, path: 'template', templates: used, pick, mechanics: ext.coverage, timings, modelCalls, modelRounds, calls, firstVerification: summarizeVerify(v), base: v } };
  }

  /** @param {JobSpec} job @param {JobContext} ctx */
  async function create(job, ctx) {
    /** @type {Timings} */
    const timings = { queueMs: job.queuedMs ?? null };
    const t0 = performance.now();
    let { registry, logic } = await catalogue(null);
    const seed = job.seed ?? seedFrom(job.prompt);
    // A create job carries its prompt (api.mjs); a missing one is written to the models as empty.
    const prompt = str(job.prompt);
    // Checkpoints are what a failure record keeps to reproduce the run (server/jobs.js); hosts without them ignore them.
    const checkpoint = (/** @type {string} */ name, /** @type {unknown} */ value) => ctx.checkpoint?.(name, value);
    checkpoint('provenance', { pipeline: KERNEL_PIPELINE_VERSION, catalogHash: catalogHash(registry), models: { spec: spec?.model || null, specProvider: spec?.provider || null, decisions: decisions?.provider || null }, seed, prompt: job.prompt, answers: job.answers || [] });
    // The template path first (ARCHITECTURE §5): with a writer, one pick decides whether templates build the idea.
    // A game or genre concept no template is goes to the step path below, for the whole idea, and says so.
    /** @type {{ pick: import('./templates.js').Pick, stepPath: string[], why: string, calls: number } | null} */
    let templatePick = null;
    if (spec) {
      const routed = await templateCreate(job, ctx, { registry, logic, seed, prompt, t0, timings });
      if (routed.path === 'template') return routed.result;
      templatePick = routed.pick;
    }
    ctx.stage('decomposing', { model: spec?.model || 'offline' });
    let t = performance.now();
    const decomposition = await decomposeIdea({ writer: spec, escalate: writers.code || null, prompt, answers: job.answers || [], registry, attempts: cfg.modelAttempts });
    timings.decomposeMs = ms(t);
    checkpoint('decomposition', decomposition);
    ctx.stage('decomposed', { ms: timings.decomposeMs, source: decomposition.source, ...(decomposition.calls ? { calls: decomposition.calls.length } : {}), references: decomposition.references.map(r => r.name), mechanics: decomposition.mechanics.map(m => m.description), ...(decomposition.error ? { error: decomposition.error } : {}) });
    t = performance.now();
    const chosen = await selectPrimitives({ decomposition, registry, decisions, writer: spec, attempts: cfg.modelAttempts });
    const agency = await ensureAgency({ decomposition, selection: chosen, registry, logic, seed, prompt });
    // Cast: ensureAgency (outline.js) has no @returns, so the gap it may add widens Gap.kind to string; at runtime
    // it is a Selection. Remove once outline.js declares its result.
    let selection = /** @type {Selection} */ (agency.selection);
    timings.selectMs = ms(t);
    checkpoint('selection', { mechanics: selection.mechanics, spaces: selection.spaces, systems: selection.systems, graphics: selection.graphics, gaps: selection.gaps, provider: selection.provider, build: /** @type {any} */ (selection).build || null, agency: agency.agency, agencyAttempts: agency.attempts });
    ctx.stage('selected', { ms: timings.selectMs, provider: selection.provider || 'lexical', spaces: selection.spaces.map(s => s.use), systems: selection.systems, gaps: selection.gaps.map(g => g.description), agency: agency.agency, agencyAttempts: agency.attempts });
    ctx.stage('outlining', { model: spec?.model || 'procedural' });
    t = performance.now();

    // Build, verify, and when a stage fails figure out how to make the game (replan.js): diagnose the problems, re-plan
    // the collection or repair the fields again, or have the gap layer write the missing primitive, then verify again.
    // Bounded by cfg.replanAttempts (and cfg.maxGapPrimitives for written primitives); nothing is ever substituted.
    /** @type {Array<Record<string, unknown>>} */
    const attempts = [];
    /** @type {Map<string, Set<string>>} */
    const tried = new Map();
    /** @type {unknown[]} */
    const experiments = [];
    let writtenGaps = 0;
    /** @param {Selection} sel */
    const attempt = async sel => {
      // Core gaps the selection already knows about cost no model call: they are re-planned first.
      const known = sel.gaps.filter(g => g.importance === 'core');
      if (known.length) return { ok: /** @type {const} */ (false), stage: 'selection', problems: known.map(g => ({ code: `gap_${g.kind}`, path: 'systems', message: g.description })), doc: null, outline: null };
      const outline = await writeOutline({ writer: spec, prompt, answers: job.answers || [], decomposition, selection: sel, registry, logic, seed, maxRounds: cfg.outlineRepairRounds, escalate: writers.code || null });
      if (!outline.ok) return { ok: /** @type {const} */ (false), stage: 'outline', problems: outline.errors, doc: outline.doc, outline };
      // The preset may have found what the selection did not (a win nothing declares, a primitive no space hosts).
      const later = sel.gaps.filter(g => g.importance === 'core');
      if (later.length) return { ok: /** @type {const} */ (false), stage: 'structure', problems: later.map(g => ({ code: `gap_${g.kind}`, path: 'systems', message: g.description })), doc: outline.doc, outline };
      // Last document step before play: wire the player and AI participants into the chosen mechanics (card.engage).
      const engaged = engageDocument(applySkins(outline.doc, registry), registry, logic);
      // The static loop check of the document that will be played (loop-check.js): its declared win must be reachable.
      const structural = loopProblems(engaged.doc, registry, { logic, core: loopCore(decomposition, sel, registry), opponent: decomposition.core?.opponent ?? null });
      if (structural.length) return { ok: /** @type {const} */ (false), stage: 'loop', problems: structural, doc: engaged.doc, outline, engaged };
      const keep = new Set((engaged.doc.systems || []).map(s => s.use));
      const fp = firstPlayable(engaged.doc, registry, logic, { seed, protect: keep, maxIsolations: 0 });
      if (!fp.ok) return { ok: /** @type {const} */ (false), stage: 'first_playable', problems: [...fp.errors, ...fp.problems], doc: engaged.doc, outline, engaged };
      const doc = experiments.length ? /** @type {Doc} */ ({ ...fp.doc, experiments }) : fp.doc;
      // The mashup relations the build's adapter steps realised are in the document that would publish (every entry
      // with a relation has its adapter instances), or the build fails with that gap.
      const lost = mashupAdapterProblems(doc, decomposition, sel, registry);
      if (lost.length) return { ok: /** @type {const} */ (false), stage: 'mashup', problems: lost, doc, outline, engaged };
      // The publish gate: a playtest agent plays this exact document; nothing may crash and the declared loop must happen.
      const tg = performance.now();
      const base = outline.verification && hashOf(outline.verification.doc ?? null) === hashOf(doc) ? outline.verification
        : await verifyDocument(doc, registry, logic, { playable: true });
      timings.gateMs = ms(tg);
      if (!base.viable) return { ok: /** @type {const} */ (false), stage: 'gate', problems: [{ code: 'not_playable', path: '$', message: String(base.viability || 'not viable') }, ...(base.problems || []).filter(p => p.severity === 'error').slice(0, 8)], doc, outline, base };
      const core = coreLoopProblems(doc, sel.mechanics, registry);
      if (core.length) return { ok: /** @type {const} */ (false), stage: 'core_loop', problems: core, doc, outline, base };
      return { ok: /** @type {const} */ (true), doc, outline, engaged, fp, base };
    };
    let built = await attempt(selection);
    for (let n = 1; ; n++) {
      const entry = { attempt: n, systems: [...selection.systems], stage: built.ok ? 'published' : built.stage, problems: built.ok ? [] : built.problems.slice(0, 8).map(p => `${prop(p, 'code')} ${prop(p, 'path') ?? ''}: ${String(prop(p, 'message') ?? '').slice(0, 160)}`) };
      attempts.push(entry);
      if (built.ok) break;
      /** @param {string[]} missing @param {string} [stopped] why the build stopped before its last attempt */
      const fail = (missing, stopped = '') => {
        checkpoint('figure', { attempts, missing, ...(stopped ? { stopped } : {}) });
        ctx.stage('not_buildable', { attempts: attempts.length, missing, ...(stopped ? { stopped } : {}) });
        return Object.assign(Error(`This isn't the game you asked for yet. Tried ${attempts.length} time(s): ${attempts.map(a => `#${a.attempt} ${a.stage}${Array.isArray(a.actions) && a.actions.length ? ` → ${a.actions.map(x => prop(x, 'text')).join(', ')}` : ''}`).join('; ')}.${stopped ? ` ${stopped}.` : ''} Still missing: ${missing.slice(0, 4).join('; ')}`), { status: 422, code: 'not_buildable', report: { attempts, missing, ...(stopped ? { stopped } : {}) } });
      };
      // A mashup relation the document lost is the pipeline's own gap: no re-planned pick restores an adapter instance.
      if (built.stage === 'mashup') throw fail(built.problems.map(p => `gap (adapter): ${String(prop(p, 'message'))}`));
      const diagnoses = diagnose(built.problems, { selection, registry, doc: built.doc, core: loopCore(decomposition, selection, registry), opponent: decomposition.core?.opponent ?? null });
      Object.assign(entry, { diagnoses: diagnoses.map(d => ({ kind: d.kind, mechanic: d.mechanic ?? null, primitive: d.primitive ?? null, codes: d.codes })) });
      if (n >= cfg.replanAttempts) throw fail(missingText(diagnoses));
      const plan = await replan(selection, diagnoses, { registry, decomposition, tried, writer: spec, attempts: cfg.modelAttempts });
      /** @type {Array<{ text: string } & Record<string, unknown>>} */
      const actions = plan.actions.map(a => ({ ...a, text: a.action === 'replace' ? `${a.primitive} → ${a.by}` : a.action === 'add' ? `+${a.primitive}` : 'repair fields' }));
      // What the catalogue cannot serve: the gap layer writes it (cfg.gaps 'auto'), within cfg.maxGapPrimitives.
      for (const d of plan.unresolved) {
        if (cfg.gaps !== 'auto' || !gapService || writtenGaps >= cfg.maxGapPrimitives) continue;
        writtenGaps++;
        const { request, gap } = gapRequest(d, plan.selection, decomposition);
        ctx.stage('gap', { mechanic: gap.mechanic, during: 'build' });
        try {
          const r = await gapService.fill({ doc: built.doc ?? { schema: 'gameverse.v2.game/0.2', id: 'draft', title: decomposition.title, spaces: [], systems: [] }, request, gap });
          if (!r.ok || !r.doc) { actions.push({ action: 'write', text: `gap layer could not write ${String(gap.mechanic)}`, problems: r.problems ?? [] }); continue; }
          ({ registry, logic } = await catalogue(r.doc));
          const ids = addedBy(r.doc, plan.selection, registry);
          experiments.push(...experimentsOf(r.doc).filter(e => !experiments.includes(e)));
          for (const id of ids) {
            plan.selection.systems.push(id);
            const m = plan.selection.mechanics.find(x => x.id === d.mechanic); if (m) m.primitives = [...m.primitives, id];
          }
          plan.selection.gaps = plan.selection.gaps.filter(g => g.mechanic !== d.mechanic || g.importance !== 'core');
          actions.push({ action: 'write', text: `wrote ${ids.join(', ') || 'a primitive'}`, primitives: ids, experiment: r.experiment?.id ?? null });
          plan.unresolved = plan.unresolved.filter(x => x !== d);
        } catch (error) { actions.push({ action: 'write', text: `gap layer failed: ${errorText(error).slice(0, 120)}` }); }
      }
      Object.assign(entry, { actions });
      // Nothing left to change: the problems are what is missing. Re-asking the model only helps once it has written
      // something (the outline ran); a gap in the collection needs another primitive. Another attempt on the same
      // selection would fail the same way, so the build stops here, before its last attempt, and says so: each
      // diagnosis re-planning took no action for is reported with its reason (replan.js `reason`).
      const changes = plan.actions.filter(a => a.action !== 'repair' || (built.stage !== 'selection' && built.stage !== 'structure'));
      if (!changes.length && !actions.some(a => a.action === 'write' && Array.isArray(a.primitives))) {
        const stopped = `Stopped after attempt ${n} of ${cfg.replanAttempts}: re-planning found no action for ${plan.unresolved.length || diagnoses.length} diagnosis(es)${plan.actions.length ? ` (only ${plan.actions.map(a => a.action).join(', ')}, which cannot change a ${built.stage} failure)` : ''}`;
        Object.assign(entry, { stopped });
        ctx.stage('replanned', { attempt: n, actions: actions.map(a => a.text), unresolved: missingText(plan.unresolved), stopped });
        throw fail(missingText(plan.unresolved.length ? plan.unresolved : diagnoses), stopped);
      }
      selection = plan.selection;
      ctx.stage('replanned', { attempt: n, actions: actions.map(a => a.text), unresolved: missingText(plan.unresolved) });
      built = await attempt(selection);
    }
    const { outline, fp, base } = built;
    timings.outlineMs = ms(t); timings.outlineModelMs = spec ? outline.modelMs : null;
    timings.buildAttempts = attempts.length;
    checkpoint('outline', { ok: outline.ok, source: outline.source, rounds: outline.rounds, firstPassOk: outline.firstPassOk, errors: (outline.errors || []).slice(0, 20), removed: outline.removed || [], content: (outline.content || []).map(p => `${p.code} ${p.path}: ${p.message}`).slice(0, 20), doc: outline.doc, attempts });
    ctx.stage('outlined', { ms: timings.outlineMs, source: outline.source, rounds: outline.rounds, firstPassOk: outline.firstPassOk, attempts: attempts.length });
    timings.firstPlayableBuildMs = fp.ms;
    let current = built.doc;
    /** @type {GapNote[]} */
    const gaps = [...selection.gaps.map(gapNote), ...[...(outline.removed || []), ...fp.removed].map(r => ({ capability: r.use, why: r.why, kind: r.kind === 'capability' ? 'capability' : 'removed' }))];
    await ctx.store.updateMeta(job.gameId, { title: current.title, kind: 'kernel' });
    const common = { kind: 'kernel', decomposition, selection: { mechanics: selection.mechanics, spaces: selection.spaces, systems: selection.systems, graphics: selection.graphics, gaps: selection.gaps, provider: selection.provider }, gaps, summary: current.logline || decomposition.premise };
    const provenance = (/** @type {Record<string, unknown>} */ extra) => ({ pipeline: KERNEL_PIPELINE_VERSION, catalogHash: catalogHash(registry), models: { spec: spec?.model || null, specProvider: spec?.provider || null, decisions: decisions?.provider || null }, seed, prompt: job.prompt, answers: job.answers || [], outlineSource: outline.source, decompositionHash: hashOf(decomposition), ...extra });
    checkpoint('gate', { viable: Boolean(base.viable), viability: base.viability || null, playtest: base.playtest || null, problems: (base.problems || []).slice(0, 20) });
    checkpoint('coreLoop', { problems: [] });
    // Quality is measured only once the gate passed, and never changes what publishes.
    t = performance.now();
    const quality = qualityReport(base, registry, logic, { mechanics: selection.mechanics, budgetMs: cfg.qualityMs });
    timings.qualityMs = quality ? ms(t) : null;
    timings.requestToFirstPlayableMs = ms(t0);
    await ctx.publish({ doc: current, stage: 'first_playable', report: { ...common, ...(templatePick ? { path: 'step', why: templatePick.why, templatePick } : {}), verified: true, verification: summarizeVerify(base), playtest: base.playtest, quality, outline: { source: outline.source, structure: outline.structure ?? null, rounds: outline.rounds, firstPassOk: outline.firstPassOk, attempts }, firstPlayable: { ms: fp.ms, start: fp.start, options: fp.options, stateHash: fp.stateHash }, timings: { ...timings } }, provenance: provenance({ outlineHash: hashOf(current) }) });
    ctx.stage('first_playable', { ms: timings.requestToFirstPlayableMs, buildMs: timings.firstPlayableBuildMs, gateMs: timings.gateMs });
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
        const accept = patch => acceptPatch({ current, patch, task, registry, logic, baseVerify })
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
    return { doc: latest, timings, detail, gaps: filled, firstVerification: summarizeVerify(base), decomposition, selection, outline: { source: outline.source, structure: outline.structure ?? null, rounds: outline.rounds, firstPassOk: outline.firstPassOk, attempts }, base };
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
    const v = await verifyDocument(after, registry, logic, { playable: true });
    const vBefore = await verifyDocument(before, registry, logic);
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
    playtest: v.playtest ?? null, quality: v.quality ?? null, features: v.features?.table ?? null };
}

export { decomposeOffline };
