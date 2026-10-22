// @ts-check
// The ARCHITECTURE.md §4 generation pipeline for kernel documents, end to end:
//   template pick -> composition -> extensions -> content -> gate (the template path), or, for a game or genre no
//   template is, the step path: decompose -> select (capability-aware) -> outline (preflight + repair rounds)
//   -> first playable (no model, <1 s) -> gate -> gaps (new primitives through the experiments sandbox) -> complete.
// No post-publish pass adds content the declarations did not ask for (ARCHITECTURE §5).
// Revisions: a tweak (one strict model choice among the declared params) else targeted model ops, both behind
// the revision-check guards. Every stage reports measured durations; values that
// were not measured are null, never zero (AGENTS.md).
import { hashOf } from '../server/store.js';
import { seedFrom } from '../kernel/rng.js';
import { preflight } from '../kernel/document.js';
import { decomposeIdea } from './decompose.js';
import { selectPrimitives, MODEL_MISSING } from './select.js';
import { writeOutline } from './outline.js';
import { applySkins, mashupAdapterProblems } from './adapters.js';
import { firstPlayable } from './first-playable.js';
import { engageDocument } from './engage.js';
import { tweakDocument, reviseDocument, applyOps, reviewChange, routeWorldScale, REVISE_VERSION } from './doc-revise.js';
import { gateVersion, gateError, versionTemplate, tuneLimits, VERSION_GATE_VERSION } from './version-gate.js';
import { contentGrowth } from './revision-check.js';
import { describeErrors } from './repair.js';
import { verifyDocument, regressed } from './verify-adapter.js';
import { coreLoopProblems } from './core-loop.js';
import { loopProblems } from './loop-check.js';
import { loopCore } from './presets.js';
import { catalogHash } from './catalog.js';
import { quality as measureQuality } from '../verify/quality.js';
import { obj, prop, str, list, isObj } from '../kernel/guards.js';
import { TEMPLATES } from '../templates/registry.js';
import { TEMPLATE_PATH_VERSION, askPick, composeTemplates, writeContent, offeredTemplates, instancesIn, narrowPick, checkPick, chooseReading, templateLoops } from './templates.js';
import { EXTEND_VERSION, extendDocument, extensionFaults, paramsForm, recordingWriter, unengaged } from './extend.js';
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
/** @typedef {import('../server/jobs.js').JobSpec} JobSpec */
/** @typedef {import('../server/jobs.js').JobContext} JobContext */
/** The registry and logic for a document (catalog.js). @typedef {{ registry: RegistryLike, logic: LogicLike }} Catalogue */
/** New primitives for a gap (the experiments sandbox). Its document is the service's output, checked by the caller's next stage. @typedef {{ fill(request: { doc: unknown, request: string, gap: unknown }): Promise<{ ok: boolean, doc?: unknown, experiment: Record<string, unknown>, problems?: unknown[] }> }} GapService */
/**
 * Limits: modelAttempts bounds the calls for one question (a failing call is asked again, then the stage fails);
 * outlineRepairRounds bounds the model's field repairs of the step path's outline; stepPathMs is the step path's time
 * box (its decomposition, build and extension steps ask nothing after it; 0: none); maxGapPrimitives bounds the
 * primitives the gap layer writes (only with gaps 'auto'). When they are exhausted the build fails with what it tried
 * and what is missing.
 * @typedef {{ outlineRepairRounds: number, reviseRepairs: number,
 *   gaps: string, maxGapPrimitives: number, qualityMs: number, stepPathMs: number, modelAttempts: number }} PipelineConfig
 */
/** Stage durations: null when not measured (AGENTS.md). @typedef {Record<string, number | null>} Timings */

export const KERNEL_PIPELINE_VERSION = 'v2-kernel/0.1';
export const PIPELINE_CONFIG = Object.freeze(/** @type {PipelineConfig} */ ({
  outlineRepairRounds: 2, reviseRepairs: 2,
  gaps: 'offer', maxGapPrimitives: 1, qualityMs: 250, stepPathMs: 180000, modelAttempts: 2,
}));

const ms = (/** @type {number} */ t) => Math.round(performance.now() - t);
/** A thrown value's message (or the value), as text. @param {unknown} error */
const errorText = error => String(prop(error, 'message') || error);

/**
 * The quality report for a verification that already passed the publish gate (v2/verify/quality.js). It never
 * blocks: it reuses the gate's playtest, is bounded by simulated frames (quality.js QUALITY_STEPS), and a failure is recorded as { error }.
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
    /** @type {{ pick: import('./templates.js').Pick, stepPath: string[], calls: number, unnamed: Array<{ name: string, says: string, why: string }>, unreadable: Array<{ name: string, kind: string, why: string }> }} */
    let picked;
    if (job.pick !== undefined) {
      const pick = narrowPick(job.pick), checked = checkPick(pick, { templates, registry, prompt });
      if (checked.problems.length) throw fail('pick_resume_invalid', 'pick', checked.problems.map(p => ({ code: p.code, path: p.field, message: p.message })));
      picked = { pick, stepPath: checked.stepPath, calls: 0, unnamed: [], unreadable: [] };
    } else picked = await askPick({ writer, escalate, attempts: cfg.modelAttempts, prompt, templates, registry, calls, clock });
    timings.pickMs = ms(t);
    clock.codeMs = 0; // composeMs counts the code after the pick: composition, content applied and checked
    checkpoint('templatePick', { pick: picked.pick, stepPath: picked.stepPath, calls, unnamed: picked.unnamed, unreadable: picked.unreadable });
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
    // The publish gate plays what an extension adds (its feature checks: pressing its verbs does what they declare): a
    // pick whose own primitive fails them does not work in this game, so it is dropped and its mechanic's step asked
    // again without it (the step's convention), the content kept and only the new pick's params asked. The retries end
    // when the step runs out of valid options (the build fails naming the mechanic) or the step path's time box.
    const interactions = [...new Set(templateLoops(composed.parts[0].template, registry).loops.flatMap(l => l.interactions))];
    // The extension steps are the step path's machinery: time-boxed (cfg.stepPathMs) and reported (stepPath).
    const deadline = cfg.stepPathMs > 0 ? performance.now() + cfg.stepPathMs : null;
    /** Per mechanic, the extension picks the gate proved do not work in the game. @type {Map<string, Array<{ id: string, why: string }>>} */
    const dropped = new Map();
    const header = `Game idea: ${prompt}\nThe game: ${pick.title}: ${pick.premise}\nBuilt from the verified templates ${composed.parts.map(p => `'${p.template.id}' (${p.template.concept})`).join(' and ')}, played as ${interactions.join(' or ') || 'its loops are'}.`;
    const base0 = { registry, logic };
    /** @type {Awaited<ReturnType<typeof extendDocument>>} */
    let ext;
    /** @type {Awaited<ReturnType<typeof writeContent>> | null} */
    let content = null;
    /** @type {Awaited<ReturnType<typeof gateVersion>>} */
    let gate;
    /** @type {ReturnType<typeof firstPlayable>} */
    let fp;
    let extensionCalls = 0, contentRounds = 0;
    /** @type {Record<string, unknown>} */
    let stepUse = {};
    for (;;) {
      ({ registry, logic } = base0);
      t = performance.now();
      const before = calls.length;
      ext = await extendDocument({ deadline, doc: composed.doc, mechanics: pick.mechanics, registry, logic, writer: recordingWriter(writer, calls), attempts: cfg.modelAttempts, interactions,
        header, gaps: { mode: cfg.gaps, service: gapService, max: cfg.maxGapPrimitives }, catalogue, stage: (name, detail) => ctx.stage(name, detail), dropped });
      if (pick.mechanics.length) timings.extendMs = (timings.extendMs ?? 0) + ms(t);
      else timings.extendMs = null;
      extensionCalls += calls.length - before;
      stepUse = { used: ext.coverage.some(c => c.by !== 'template'), mechanics: ext.coverage.filter(c => c.by !== 'template').map(c => c.mechanic), budgetMs: cfg.stepPathMs || null, ms: timings.extendMs, calls: extensionCalls };
      if (stepUse.used) ctx.stage('step_path', { during: 'extension', mechanics: stepUse.mechanics, budgetMs: stepUse.budgetMs, ms: stepUse.ms, calls: extensionCalls });
      checkpoint('extensions', { coverage: ext.coverage, added: ext.added, dropped: Object.fromEntries(dropped) });
      if (ext.missing.length) throw fail('extension_missing', 'extension', ext.missing.map(c => ({ code: 'extension_missing', path: `mechanics.${c.mechanic}`, message: `"${c.mechanic}" (${c.importance}${c.verb !== 'none' ? `, verb '${c.verb}'` : ''}) is still missing: ${c.why}${dropped.has(c.mechanic) ? `; dropped as not working in the game: ${(dropped.get(c.mechanic) ?? []).map(d => `${d.id} (${d.why})`).join('; ')}` : ''}` })));
      ({ registry, logic } = ext);
      const extended = ext.doc;
      const extUses = new Set(ext.coverage.filter(c => c.by === 'extension' || c.by === 'gap').flatMap(c => c.primitives));
      /** @type {NonNullable<ReturnType<typeof paramsForm>>[]} */
      const paramForms = [];
      for (const use of ext.added) { const f = paramsForm(extended, use, { registry, logic }); if (f) paramForms.push(f); }
      t = performance.now();
      content = await writeContent({ writer, escalate, attempts: cfg.modelAttempts, template, doc: composed.doc, pick, themes: composed.themes, registry, logic, calls, clock, parts: composed.parts, onto: extended,
        extra: paramForms.map(f => ({ ...f, mechanic: ext.coverage.find(c => c.primitives[0] === f.use)?.mechanic ?? f.use })), reuse: content?.answers ?? null });
      timings.contentMs = (timings.contentMs ?? 0) + ms(t);
      contentRounds += content.rounds;
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
      fp = firstPlayable(pre.doc, registry, logic, { seed, protect: new Set(instancesIn(pre.doc).map(i => String(i.use))), maxIsolations: 0, furnish: false });
      clock.codeMs += performance.now() - tc;
      if (!fp.ok) throw fail(defect, 'first_playable', [...fp.errors, ...fp.problems]);
      timings.composeMs = Math.round(clock.codeMs);
      // The version gate every new version passes (version-gate.js): the same checks a revision of it will pass.
      const tg = performance.now();
      gate = await gateVersion(fp.doc, { registry, logic, playable: true, template });
      timings.gateMs = (timings.gateMs ?? 0) + ms(tg);
      if (gate.ok && gate.doc && gate.verification) break;
      const faults = extensionFaults(gate.problems, ext.coverage);
      if (!faults.length || (deadline !== null && performance.now() > deadline)) throw fail(gate.stage === 'gate' ? 'not_playable' : defect, gate.stage ?? 'gate', gate.problems);
      for (const f of faults) dropped.set(f.mechanic, [...(dropped.get(f.mechanic) ?? []), { id: f.id, why: f.why }]);
      ctx.stage('extension_dropped', { picks: faults });
    }
    const v = gate.verification;
    t = performance.now();
    const quality = qualityReport(v, registry, logic, { budgetMs: cfg.qualityMs });
    timings.qualityMs = quality ? ms(t) : null;
    timings.firstPlayableBuildMs = fp.ms;
    timings.requestToFirstPlayableMs = ms(t0);
    const modelCalls = calls.length, modelRounds = picked.calls + extensionCalls + contentRounds;
    const doc = gate.doc;
    await ctx.store.updateMeta(job.gameId, { title: doc.title, kind: 'kernel' });
    const report = { kind: 'kernel', path: 'template', templates: used, joins: composed.joins, pick, unnamedMechanics: picked.unnamed, invalidReadings: picked.unreadable, themes: composed.themes, mechanics: ext.coverage, extensionCalls, stepPath: stepUse, content: content.forms, calls, modelCalls, modelRounds,
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

  /**
   * The step path (ARCHITECTURE §5): for a game or genre concept no template is, time-boxed (cfg.stepPathMs) and
   * reported. Decomposition, then the iterative build (select.js, build.js: the space first, then one mechanic at a
   * time, each a small model choice among the options code proved valid by declarations, in declaration order, with the
   * checks after every pick; a pick that fails them is dropped and the step asked again without it), then the gap layer
   * for the mechanics nothing in the catalogue covers ("none fits": cfg.gaps 'auto', within cfg.maxGapPrimitives), then
   * the outline (field-level repair rounds), engagement, the loop check, first playable, the mashup relations and the
   * publish gate, once. A stage that fails fails the build with its problems: the collection is never re-planned
   * around them, nothing is substituted and nothing is dropped.
   * @param {JobSpec} job @param {JobContext} ctx
   * @param {{ registry: RegistryLike, logic: LogicLike, seed: number, prompt: string, t0: number, timings: Timings, why: { pick: import('./templates.js').Pick, stepPath: string[], why: string, calls: number } }} run
   */
  async function stepCreate(job, ctx, { registry, logic, seed, prompt, t0, timings, why: routed }) {
    const writer = /** @type {Writer} */ (spec);
    const checkpoint = (/** @type {string} */ name, /** @type {unknown} */ value) => ctx.checkpoint?.(name, value);
    const started = performance.now();
    const deadline = cfg.stepPathMs > 0 ? started + cfg.stepPathMs : null;
    /** How the step path was used (reported on the published version and on a failure). */
    const use = { why: routed.why, stepPath: routed.stepPath, budgetMs: cfg.stepPathMs || null, ms: /** @type {number | null} */ (null), calls: /** @type {number | null} */ (null), stage: 'decompose' };
    ctx.stage('step_path', { why: routed.why, stepPath: routed.stepPath, budgetMs: use.budgetMs });
    /** @param {string} stage @param {string} code @param {Array<{ code?: unknown, path?: unknown, message?: unknown }>} problems */
    const fail = (stage, code, problems) => {
      use.ms = ms(started); use.stage = stage;
      const missing = problems.slice(0, 8).map(p => `${String(p.code ?? '')} ${String(p.path ?? '')}: ${String(p.message ?? '').slice(0, 200)}`);
      checkpoint('figure', { path: 'step', stage, code, stepPath: use, problems: problems.slice(0, 20) });
      ctx.stage('not_buildable', { path: 'step', stage, code, missing });
      return Object.assign(Error(`This isn't the game you asked for yet: the step path failed at ${stage}: ${missing.slice(0, 4).join('; ')}`), { status: 422, code, report: { path: 'step', stage, problems: problems.slice(0, 40), stepPath: use } });
    };
    /** A question the time box or the model failed: the build fails at that stage, saying which. @param {string} stage @param {unknown} error */
    const failed = (stage, error) => fail(stage, String(prop(error, 'code') || 'step_failed'), [{ code: prop(error, 'code') || 'step_failed', path: stage, message: errorText(error) }]);
    ctx.stage('decomposing', { model: writer.model || null });
    let t = performance.now();
    let decomposition;
    try { decomposition = await decomposeIdea({ writer, escalate: writers.code || null, prompt, answers: job.answers || [], registry, attempts: cfg.modelAttempts }); }
    catch (error) { throw failed('decompose', error); }
    timings.decomposeMs = ms(t);
    checkpoint('decomposition', decomposition);
    ctx.stage('decomposed', { ms: timings.decomposeMs, source: decomposition.source, ...(decomposition.calls ? { calls: decomposition.calls.length } : {}), references: decomposition.references.map(r => r.name), mechanics: decomposition.mechanics.map(m => m.description) });
    t = performance.now();
    use.stage = 'select';
    /** @type {Selection} */
    let selection;
    try { selection = await selectPrimitives({ decomposition, registry, writer, attempts: cfg.modelAttempts, deadline }); }
    catch (error) { throw failed('select', error); }
    timings.selectMs = ms(t);
    use.calls = (decomposition.calls?.length ?? 0) + (selection.build?.calls ?? 0);
    checkpoint('selection', { mechanics: selection.mechanics, spaces: selection.spaces, systems: selection.systems, graphics: selection.graphics, gaps: selection.gaps, provider: selection.provider, build: selection.build || null });
    ctx.stage('selected', { ms: timings.selectMs, provider: selection.provider, spaces: selection.spaces.map(s => s.use), systems: selection.systems, gaps: selection.gaps.map(g => g.description) });
    // "None fits": what the catalogue cannot serve, the gap layer writes (cfg.gaps 'auto', within cfg.maxGapPrimitives),
    // each held to the build's checks again; a core mechanic nothing covers fails the build naming it.
    /** @type {unknown[]} */
    const experiments = [];
    /** @type {Array<Record<string, unknown>>} */
    const filled = [];
    let written = 0;
    for (const g of selection.gaps.filter(x => x.importance === 'core')) {
      if (cfg.gaps !== 'auto' || !gapService || written >= cfg.maxGapPrimitives) continue;
      written++;
      const tg = performance.now();
      ctx.stage('gap', { mechanic: g.mechanic, during: 'build' });
      const request = `${g.signature || g.description}. It must work on ${selection.spaces.map(s => s.use).join(', ') || 'the chosen space'}${decomposition.core?.interaction ? `, be played as ${decomposition.core.interaction}` : ''} and declare its loop (card.loop: verbs, progress events${g.kind === 'win' ? ', win' : ''}).`.slice(0, 700);
      try {
        const r = await gapService.fill({ doc: { schema: 'gameverse.v2.game/0.2', id: 'draft', title: decomposition.title, spaces: [], systems: [] }, request, gap: g });
        if (!r.ok || !r.doc) { filled.push({ mechanic: g.mechanic, ok: false, problems: r.problems ?? [], ms: ms(tg) }); continue; }
        ({ registry, logic } = await catalogue(r.doc));
        const ids = list(prop(r.doc, 'systems')).map(x => prop(x, 'use')).filter(/** @returns {x is string} */ x => typeof x === 'string' && registry.has(x) && !selection.systems.includes(x));
        if (!ids.length) { filled.push({ mechanic: g.mechanic, ok: false, problems: ['the gap layer added no primitive'], ms: ms(tg) }); continue; }
        experiments.push(...list(prop(r.doc, 'experiments')).filter(x => isObj(x) && !experiments.includes(x)));
        selection.systems.push(...ids);
        const m = selection.mechanics.find(x => x.id === g.mechanic); if (m) m.primitives = [...m.primitives, ...ids];
        selection.gaps = selection.gaps.filter(x => x !== g);
        filled.push({ mechanic: g.mechanic, ok: true, primitives: ids, experiment: r.experiment?.id ?? null, ms: ms(tg) });
      } catch (error) { filled.push({ mechanic: g.mechanic, ok: false, error: errorText(error).slice(0, 160), ms: ms(tg) }); }
    }
    const known = selection.gaps.filter(g => g.importance === 'core');
    if (known.length) throw fail('selection', 'not_buildable', known.map(g => ({ code: `gap_${g.kind}`, path: g.mechanic, message: `${g.description}: ${g.why}` })));
    ctx.stage('outlining', { model: writer.model || null });
    t = performance.now();
    use.stage = 'outline';
    const outline = await writeOutline({ writer, prompt, answers: job.answers || [], decomposition, selection, registry, logic, seed, maxRounds: cfg.outlineRepairRounds, escalate: writers.code || null });
    timings.outlineMs = ms(t); timings.outlineModelMs = outline.modelMs;
    checkpoint('outline', { ok: outline.ok, source: outline.source, rounds: outline.rounds, firstPassOk: outline.firstPassOk, errors: (outline.errors || []).slice(0, 20), removed: outline.removed || [], content: (outline.content || []).map(p => `${p.code} ${p.path}: ${p.message}`).slice(0, 20), doc: outline.doc });
    if (!outline.ok) throw fail('outline', 'not_buildable', outline.errors);
    // The preset may have found what the selection did not (a win nothing declares, a primitive no space hosts).
    const later = selection.gaps.filter(g => g.importance === 'core');
    if (later.length) throw fail('structure', 'not_buildable', later.map(g => ({ code: `gap_${g.kind}`, path: g.mechanic, message: `${g.description}: ${g.why}` })));
    ctx.stage('outlined', { ms: timings.outlineMs, source: outline.source, rounds: outline.rounds, firstPassOk: outline.firstPassOk });
    // Last document step before play: wire the player and AI participants into the chosen mechanics (card.engage).
    const engaged = engageDocument(applySkins(outline.doc, registry), registry, logic);
    // The static loop check of the document that will be played (loop-check.js): its declared win must be reachable.
    const structural = loopProblems(engaged.doc, registry, { logic, core: loopCore(decomposition, selection, registry), opponent: decomposition.core?.opponent ?? null });
    if (structural.length) throw fail('loop', 'not_buildable', structural);
    const fp = firstPlayable(engaged.doc, registry, logic, { seed, protect: new Set((engaged.doc.systems || []).map(x => x.use)), maxIsolations: 0 });
    if (!fp.ok) throw fail('first_playable', 'not_buildable', [...fp.errors, ...fp.problems]);
    timings.firstPlayableBuildMs = fp.ms;
    const built = experiments.length ? /** @type {Doc} */ ({ ...fp.doc, experiments }) : fp.doc;
    // The mashup relations the build's adapter steps realised are in the document that would publish (every entry
    // with a relation has its adapter instances), or the build fails with that gap.
    const lost = mashupAdapterProblems(built, decomposition, selection, registry);
    if (lost.length) throw fail('mashup', 'not_buildable', lost);
    // The version gate every new version passes (version-gate.js): the static checks on the document a person plays, then
    // a playtest agent plays it through the controls; nothing may crash and the declared loop must happen.
    const tg = performance.now();
    const gate = await gateVersion(built, { registry, logic, playable: true });
    timings.gateMs = ms(tg);
    if (!gate.ok || !gate.doc || !gate.verification) throw fail(gate.stage ?? 'gate', gate.stage === 'gate' ? 'not_playable' : 'not_buildable', gate.problems);
    const base = gate.verification, doc = gate.doc;
    const core = coreLoopProblems(doc, selection.mechanics, registry);
    if (core.length) throw fail('core_loop', 'not_buildable', core);
    use.ms = ms(started); use.stage = 'published'; timings.stepPathMs = use.ms;
    /** @type {GapNote[]} */
    const gaps = [...selection.gaps.map(gapNote), ...[...(outline.removed || []), ...fp.removed].map(r => ({ capability: r.use, why: r.why, kind: r.kind === 'capability' ? 'capability' : 'removed' }))];
    await ctx.store.updateMeta(job.gameId, { title: doc.title, kind: 'kernel' });
    const report = { kind: 'kernel', path: 'step', why: routed.why, templatePick: routed, stepPath: use, decomposition, selection: { mechanics: selection.mechanics, spaces: selection.spaces, systems: selection.systems, graphics: selection.graphics, gaps: selection.gaps, provider: selection.provider }, gaps, gapsFilled: filled, summary: doc.logline || decomposition.premise };
    const provenance = { pipeline: KERNEL_PIPELINE_VERSION, catalogHash: catalogHash(registry), models: { spec: writer.model || null, specProvider: writer.provider || null }, seed, prompt: job.prompt, answers: job.answers || [], path: 'step', outlineSource: outline.source, decompositionHash: hashOf(decomposition), outlineHash: hashOf(doc) };
    checkpoint('gate', { viable: Boolean(base.viable), viability: base.viability || null, playtest: base.playtest || null, problems: (base.problems || []).slice(0, 20) });
    // Quality is measured only once the gate passed, and never changes what publishes.
    t = performance.now();
    const quality = qualityReport(base, registry, logic, { mechanics: selection.mechanics, budgetMs: cfg.qualityMs });
    timings.qualityMs = quality ? ms(t) : null;
    timings.requestToFirstPlayableMs = ms(t0);
    const outlineReport = { source: outline.source, structure: outline.structure ?? null, rounds: outline.rounds, firstPassOk: outline.firstPassOk };
    await ctx.publish({ doc, stage: 'first_playable', report: { ...report, verified: true, verification: summarizeVerify(base), playtest: base.playtest, quality, outline: outlineReport, firstPlayable: { ms: fp.ms, start: fp.start, options: fp.options, stateHash: fp.stateHash }, timings: { ...timings } }, provenance });
    ctx.stage('first_playable', { ms: timings.requestToFirstPlayableMs, buildMs: timings.firstPlayableBuildMs, gateMs: timings.gateMs, path: 'step', stepPathMs: use.ms });
    ctx.stage('verified', { ms: timings.gateMs, verification: summarizeVerify(base) });
    timings.totalMs = ms(t0);
    ctx.stage('complete', { timings, path: 'step', gaps: filled });
    return { doc, timings, gaps: filled, path: 'step', stepPath: use, firstVerification: summarizeVerify(base), decomposition, selection, outline: outlineReport, base };
  }

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
    ctx.checkpoint?.('provenance', { pipeline: KERNEL_PIPELINE_VERSION, catalogHash: catalogHash(registry), models: { spec: spec?.model || null, specProvider: spec?.provider || null }, seed, prompt: job.prompt, answers: job.answers || [] });
    // The model writes the judgement (the template pick, the step path's choices, content): without one nothing is
    // chosen, and no offline guess stands in.
    if (!spec) {
      ctx.stage('not_buildable', { stage: 'model', code: MODEL_MISSING });
      throw Object.assign(Error('No model is connected: the template pick, the step path\'s choices and the content are the model\'s, and nothing stands in for them.'), { status: 422, code: MODEL_MISSING });
    }
    // The template path first (ARCHITECTURE §5): one pick decides whether templates build the idea. A game or genre
    // concept no template is goes to the step path, for the whole idea, and says so.
    const routed = await templateCreate(job, ctx, { registry, logic, seed, prompt, t0, timings });
    if (routed.path === 'template') return routed.result;
    return stepCreate(job, ctx, { registry, logic, seed, prompt, t0, timings, why: routed.pick });
  }

  /**
   * A revision: a new immutable version checked like a new game (ARCHITECTURE §4). The change applies to the version
   * the job names, else to the game's latest version when the job runs (a change queued behind another builds on it).
   * A parameter tweak (one strict model choice among the declared params; on a template game its tune slots within the ranges its template tunes them) else the model's ops,
   * preflighted (a failing draft goes back to the model with the errors; nothing is repaired around, stubbed or
   * dropped). Then the version gate (version-gate.js) on the document a person plays, against the base version
   * verified with the same budgets: preflight, the template's tune ranges, composition, loop, controls, the publish
   * gate with its feature checks, no feature that worked stops working, and every named bot that won the base still
   * wins. A failing gate refuses the version (422) with its stage and problems. The version published is the revised
   * document itself (the host adds its input and UI when it mounts it); its provenance names the base, the change and
   * every op that turns the base into it.
   * @param {JobSpec} job @param {JobContext} ctx
   */
  async function revise(job, ctx) {
    /** @type {Timings} */
    const timings = {};
    const t0 = performance.now();
    // A stored version (from disk, or across the job process boundary): narrowed here. Its document is checked by
    // the revision stages and verified (preflight) below.
    const previous = obj(job.base !== undefined && job.base !== null ? await ctx.store.version(job.gameId, Number(job.base)) : await ctx.store.latest(job.gameId));
    if (!previous.doc) throw Object.assign(Error('That version is missing.'), { status: 404 });
    const baseVersion = Number(previous.version ?? job.base);
    const { registry, logic } = await catalogue(previous.doc);
    // The stored document becomes a Doc through preflight (published versions are preflighted documents, so this is
    // the same document unless the catalogue changed since).
    const stored = preflight(previous.doc, registry, logic);
    if (!stored.ok) throw Object.assign(Error(`That version no longer passes checks: ${stored.errors.slice(0, 3).map(e => `${e.code} ${e.path}`).join('; ')}`), { status: 422 });
    const before = stored.doc;
    // The template the game was built from (its provenance names it): its tune ranges bound the change.
    const template = versionTemplate(previous.provenance, /** @type {readonly Template[]} */ (TEMPLATES));
    // A revise job carries its change (api.mjs); a missing one is written to the models as empty.
    const change = str(job.change);
    ctx.stage('revising', { change: job.change, base: baseVersion });
    // A parameter tweak first: one small strict model choice among the declared params (doc-revise.js tweakDocument).
    let t = performance.now();
    const tweak = await tweakDocument(before, job.change, { registry, writer: spec, attempts: cfg.modelAttempts, limits: template ? tuneLimits(template, before, { registry, logic }) : null });
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
      /** @type {Awaited<ReturnType<typeof reviseDocument>> | null} */
      let r = null;
      /** @type {ReturnType<typeof preflight> | null} */
      let checked = null;
      let applied = applyOps(before, []);
      // The model's ops, checked against the card-derived schemas; a failing draft goes back with its errors.
      for (let n = 0; n <= cfg.reviseRepairs && !checked?.ok; n++) {
        r = await reviseDocument({ writer: spec, doc: before, change, registry, logic, ...(checked ? { errors: describeErrors(checked.errors), previous: r?.ops } : {}) });
        modelMs = (modelMs ?? 0) + r.ms; unsupported = r.unsupported;
        // Ops that only resize a space's extent become scaleWorld, so the generated content grows with the container.
        const routed = routeWorldScale(before, r.ops, registry);
        scaled = routed.scaled.length ? { factor: routed.scaled[0].factor, spaces: routed.scaled } : null;
        applied = applyOps(routed.doc, routed.ops);
        checked = preflight(applied.doc, registry, logic);
      }
      timings.reviseMs = ms(t); timings.reviseModelMs = modelMs;
      if (!checked?.ok) {
        const errors = checked?.errors ?? [];
        ctx.checkpoint?.('revision', { base: baseVersion, change: job.change, path: 'model', ops: (r?.ops || []).slice(0, 50), unsupported, errors: errors.slice(0, 20), timings: { ...timings }, doc: applied.doc });
        throw Object.assign(Error(`The change failed checks: ${errors.slice(0, 3).map(e => `${e.code} ${e.path}`).join('; ')}`), { status: 422, code: 'revision_invalid' });
      }
      after = checked.doc; path = 'model'; opsApplied = applied.applied;
      ctx.stage('revised', { ms: timings.reviseMs, ops: applied.applied.length, failed: applied.failed.length });
    }
    if (!after) {
      // Nothing can carry the change out here: no tweakable param matched and no writer is connected.
      after = before; path = 'none';
      unsupported = [{ request: job.change, why: 'No parameter of this game matches that change, and no model is connected to write it.' }];
    }
    t = performance.now();
    ctx.checkpoint?.('revision', { base: baseVersion, change: job.change, path, ops: opsApplied.slice(0, 50), unsupported, timings: { ...timings }, doc: after });
    // The version gate, against the base verified with the same budgets (comparable baselines; made only once the
    // static stages pass).
    const budgets = { playable: true };
    const gate = await gateVersion(after, { registry, logic, ...budgets, template, base: { doc: before, verify: () => verifyDocument(before, registry, logic, budgets), proof: prop(previous.report, 'proof') } });
    timings.gateMs = ms(t); timings.botsMs = gate.ms.bots ?? null;
    if (!gate.ok || !gate.doc || !gate.verification) {
      ctx.checkpoint?.('versionGate', { stage: gate.stage, problems: gate.problems.slice(0, 20), ms: gate.ms, baseProof: gate.baseProof, proof: gate.proof });
      throw gateError(gate, 'That change');
    }
    const v = gate.verification, published = gate.doc, vBefore = gate.baseVerification;
    t = performance.now();
    const guard = await reviewChange({ before, after: published, change, decisions, unsupported, verifyBefore: vBefore, verifyAfter: v });
    timings.guardMs = ms(t); timings.verifyMs = timings.gateMs;
    if (guard.block) throw Object.assign(Error(guard.block.message), { status: 422, code: guard.block.code });
    // A world-size request is done only when the generated content grew (cells, entities, zones, rooms), not a container param.
    let growth = null;
    // The revision check as published: the checker's, or (when the world did not grow) at least notApplied and why.
    /** @type {Partial<import('./revision-check.js').RevisionCheck> | null} */
    let revisionCheck = guard.revisionCheck;
    if (scaled) {
      growth = contentGrowth(before, published, registry, logic);
      const wantGrow = scaled.factor > 1;
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
    // The named bots' proof of this version (when the gate played them), kept for the next revision of it.
    const proof = gate.proof ?? null;
    return ctx.publish({
      doc: published, stage: `revision: ${job.change}`,
      // hot 'restart': a new version is checked from its start, so a running session restarts on it (the state of
      // another version is never carried into it: a revised start, such as lives or seed counts, applies at once).
      report: { kind: 'kernel', change: job.change, base: baseVersion, path, ...(growth ? { growth: { grew: growth.grew, what: growth.what, before: growth.before, after: growth.after } } : {}), ops: opsApplied.slice(0, 20), changes: guard.changes, notes: guard.notes || [], diffLines: guard.lines, revisionCheck, gaps, verified: true, verification: summarizeVerify(v), features: v.features ?? null, gate: { version: VERSION_GATE_VERSION, ms: gate.ms }, ...(proof ? { proof } : {}), quality, ...(selection ? { selection } : {}), hot: 'restart', timings },
      provenance: revisionProvenance(previous, { pipeline: KERNEL_PIPELINE_VERSION, catalogHash: catalogHash(registry), base: baseVersion, baseHash: hashOf(previous.doc), change: job.change, revisePath: path, ops: opsApplied, ...(scaled ? { scaled } : {}), gate: VERSION_GATE_VERSION, revise: REVISE_VERSION,
        models: { spec: path === 'model' ? spec?.model : null, specProvider: path === 'model' ? spec?.provider || null : null, decisions: decisions?.provider || null } }),
    });
  }

  const pipeline = (/** @type {JobSpec} */ job, /** @type {JobContext} */ ctx) => (job.kind === 'revise' ? revise(job, ctx) : create(job, ctx));
  pipeline.version = KERNEL_PIPELINE_VERSION;
  pipeline.create = create; pipeline.revise = revise;
  return pipeline;
}

/**
 * A revision's provenance: what made the game (the prompt, seed, answers, templates and models of its creation, carried
 * from version to version) and how this version was made from its base (`extra`: the base, its hash, the change, every
 * op, the catalogue and pipeline versions now). What described how the base itself was made (its document hash, the
 * detail task, experiment or run that produced it) is the base's, never this version's.
 * @param {Record<string, unknown>} previous the stored base version @param {Record<string, unknown>} extra
 */
export function revisionProvenance(previous, extra) {
  const { outlineHash: _doc, task: _task, experiment: _experiment, runner: _runner, scaled: _scaled, ...origin } = obj(previous.provenance);
  return { ...origin, ...extra };
}

/** @param {Verification | null | undefined} v */
export function summarizeVerify(v) {
  if (!v) return null;
  return { ok: v.ok, source: v.source, completable: v.completable, exhaustive: v.exhaustive, ms: v.ms, preflightMs: v.preflight?.ms ?? null, warnings: (v.preflight?.warnings || []).length,
    endings: v.solve ? Object.keys(v.solve.endings || {}) : null, beatsNeverFired: v.solve?.beatsNeverFired?.slice(0, 10) ?? null, states: v.solve?.states ?? null, problems: (v.problems || []).slice(0, 5),
    playtest: v.playtest ?? null, quality: v.quality ?? null, features: v.features?.table ?? null };
}

