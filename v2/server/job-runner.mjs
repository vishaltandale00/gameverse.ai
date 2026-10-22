// @ts-check
// What a generation job runs: the kernel pipeline (create / revise) and the
// experiment jobs, built from the environment or from injected fakes. The
// studio runs it in-process (tests with fakes) or once per job inside a worker
// thread (v2/server/job-worker.mjs, supervised by v2/server/isolate.js), so the
// registry, logic and model clients are always built where the job runs.
import { loadCatalogue } from '../planner/catalog.js';
import { createKernelPipeline, summarizeVerify, qualityReport, revisionProvenance, PIPELINE_CONFIG } from '../planner/kernel-pipeline.js';
import { gateVersion, gateError } from '../planner/version-gate.js';
import { catalogHash } from '../planner/catalog.js';
import { hashOf } from './store.js';
import { createDecisions } from '../planner/decisions.js';
import { loadOpenAIKey } from '../planner/openai.js';
import { createWriters } from '../planner/writer.js';
import { contentDiff, changeSummary } from '../planner/revision-check.js';
import { catalogueForDoc, withoutExperiment } from '../experiments/primitive.js';
import { createPrimitiveExperimentService } from '../experiments/primitive-service.js';
import { DOC_SCHEMA } from '../kernel/document.js';
import { isObj, list, obj, prop } from '../kernel/guards.js';

/** @typedef {import('../planner/types.js').Writers} Writers */
/** @typedef {import('./jobs.js').JobSpec} JobSpec */
/** @typedef {import('./jobs.js').JobContext} JobContext */
/** @typedef {Record<string, string | undefined>} Env */
/** @typedef {Awaited<ReturnType<typeof loadCatalogue>>} Catalogue */
/** @typedef {ReturnType<typeof createDecisions>} Decisions */
/**
 * The experiment service (experiments/primitive-service.js, not type-checked yet) as the server uses it. An experiment
 * is model-written: its fields are read with guards.
 * @typedef {{ ok: boolean, doc?: unknown, experiment: Record<string, unknown>, problems?: unknown[], report?: { attempts?: unknown[] } }} ExperimentFill
 * @typedef {{ model: string, fill(request: { doc: unknown, request?: string, gap?: unknown }): Promise<ExperimentFill> }} ExperimentService
 */
// Unchecked module: the options type inferred for it drops `writer` (it has no default), and its result loses fields.
const experimentService = /** @type {(options: { writer: import('../planner/types.js').Writer }) => ExperimentService} */ (/** @type {unknown} */ (createPrimitiveExperimentService));
/**
 * @typedef {object} ServiceOptions
 * @property {Env} [env]
 * @property {string} [repoRoot]
 * @property {Writers} [writers]
 * @property {Decisions} [decisions]
 * @property {ExperimentService | null} [experiments]
 * @property {Record<string, unknown>} [config]
 * @property {boolean} [log]
 */
/** @typedef {Awaited<ReturnType<typeof buildServices>['ready']>} Services */

export const legacyError = () => Object.assign(Error('This game was made with the retired genre engine, so it can be played but not changed. Make it again to get a kernel game you can change.'), { status: 409 });

/**
 * buildServices({ env, repoRoot, writers?, decisions?, experiments?, config, log }) ->
 * { openaiKey, decisions, ready: Promise<{ base, writers, experiments, catalogue, pipeline }> }.
 * Injected values (tests) replace the ones built from the environment.
 * @param {ServiceOptions} [options]
 */
export function buildServices({ env = process.env, repoRoot, writers: injectedWriters, decisions: injectedDecisions, experiments: injectedExperiments, config = {}, log = true } = {}) {
  const openaiKey = injectedWriters ? null : loadOpenAIKey(env, repoRoot);
  // A decision model picks primitives and confirms tweaks: d1 locally, OpenAI Decisions when d1 isn't reachable (V2_DECISIONS).
  // No key must not fall back to env.OPENAI_API_KEY (createDecisions' default): '' is "no key" there, as null was.
  const decisions = injectedDecisions !== undefined ? injectedDecisions : createDecisions(env, { openaiKey });
  const ready = (async () => {
    const base = await loadCatalogue();
    const writers = injectedWriters || await createWriters(env, { openaiKey });
    if (!injectedWriters && log) console.log(JSON.stringify({ operation: 'v2_writers', spec: writers.spec ? `${writers.spec.provider}:${writers.spec.model}` : null, code: writers.code ? `${writers.code.provider}:${writers.code.model}` : null, decisions: decisions?.provider || null }));
    const experiments = injectedExperiments !== undefined ? injectedExperiments : writers.code && env.V2_EXPERIMENTS !== 'off' ? experimentService({ writer: writers.code }) : null;
    /** The catalogue for a document: the base one, or with the experiment primitives it carries. @param {unknown} doc @returns {Promise<Catalogue>} */
    const catalogue = async doc => (list(prop(doc, 'experiments')).length ? catalogueForDoc(doc) : base);
    const pipeline = createKernelPipeline({ catalogue, writers, decisions, gapService: experiments, config: { gaps: env.V2_GAPS || 'offer', ...config } });
    return { base, writers, experiments, catalogue, pipeline, config: { ...PIPELINE_CONFIG, ...config } };
  })();
  return { openaiKey, decisions, ready };
}

/**
 * An experiment job: a new version with a sandboxed primitive added (or one removed). Each is a new version and passes
 * the version gate (planner/version-gate.js) like every other; adding one is also held to the version it changes (no
 * feature that worked stops working, every named bot that won it still wins). Removing one is what the request asks:
 * the version without it is gated as it is. The document published is the gated document (the host adds its input and
 * UI when it mounts it).
 * @param {Services} services @param {JobSpec} job @param {JobContext} ctx
 */
async function experimentJob({ experiments, catalogue, config }, job, ctx) {
  // A stored version (read back from disk, or across the job process boundary): narrowed here; the gate preflights its document.
  const latest = await ctx.store.latest(job.gameId);
  if (!isObj(latest) || !isObj(latest.doc)) throw Object.assign(Error('That game has no version yet.'), { status: 409 });
  const doc = latest.doc, mechanics = prop(prop(latest.report, 'selection'), 'mechanics');
  // What the new version's report carries from the latest one: not the latest's bot proof (it proves that document).
  const { proof: baseProof, ...report } = obj(latest.report);
  if (doc.schema !== DOC_SCHEMA) throw legacyError();
  const budgets = { playable: true };
  if (job.kind === 'experiment-remove') {
    const next = withoutExperiment(doc, job.experimentId);
    const { registry, logic } = await catalogue(next);
    const g = await gateVersion(next, { registry, logic, ...budgets });
    if (!g.ok || !g.doc || !g.verification) throw gateError(g, 'The game without that experiment');
    const v = g.verification;
    return ctx.publish({ doc: g.doc, stage: 'experiment removed', report: { ...report, change: null, changes: changeSummary(contentDiff(doc, g.doc)), gaps: [], quality: qualityReport(v, registry, logic, { mechanics }), verification: summarizeVerify(v), features: v.features ?? null, hot: 'restart' },
      provenance: revisionProvenance(latest, { catalogHash: catalogHash(registry), base: latest.version, baseHash: hashOf(doc), change: `remove experiment ${String(job.experimentId)}`, removedExperiment: job.experimentId }) });
  }
  if (!experiments) throw Object.assign(Error('Experiments need a code model; set OPENAI_API_KEY or Anthropic credentials.'), { status: 503 });
  ctx.stage('experimenting', { model: experiments.model });
  const t = performance.now();
  const filled = await experiments.fill({ doc, request: job.change });
  if (!filled.ok) throw Object.assign(Error(`The experiment didn't pass its checks: ${(filled.problems || []).slice(0, 3).join(', ')}`), { status: 422 });
  const { registry, logic } = await catalogue(filled.doc);
  // The version it changes, in the catalogue with the experiment (a superset of the one it was made in).
  const before = await gateVersion(doc, { registry, logic, ...budgets });
  const g = await gateVersion(filled.doc, { registry, logic, ...budgets, ...(before.ok && before.doc && before.verification ? { base: { doc: before.doc, verification: before.verification, proof: baseProof } } : {}) });
  if (!g.ok || !g.doc || !g.verification) throw gateError(g, 'The game with that experiment');
  const v = g.verification;
  const experiment = filled.experiment, primitive = prop(experiment.card, 'id');
  ctx.stage('experimented', { ms: Math.round(performance.now() - t), attempts: filled.report?.attempts?.length ?? null });
  return ctx.publish({
    doc: g.doc, stage: `experiment: ${experiment.label}`,
    report: { ...report, kind: 'kernel', change: job.change, changes: [`experimental primitive: ${experiment.label} (${primitive})`], gaps: [], experiment: { id: experiment.id, label: experiment.label, primitive, check: prop(experiment.check, 'report') }, quality: qualityReport(v, registry, logic, { mechanics }), verification: summarizeVerify(v), features: v.features ?? null, ...(g.proof ? { proof: g.proof } : {}), hot: 'restart', timings: { experimentMs: Math.round(performance.now() - t), gate: g.ms, modelAttempts: filled.report?.attempts?.length ?? null } },
    provenance: revisionProvenance(latest, { catalogHash: catalogHash(registry), base: latest.version, baseHash: hashOf(doc), change: job.change, experiment: experiment.id }),
  });
}

/** Run one job against built services: experiments, experiment removal, or the kernel pipeline. @param {Promise<Services>} ready @param {JobSpec} job @param {JobContext} ctx */
export async function runJob(ready, job, ctx) {
  const services = await ready;
  if (job.kind === 'experiment' || job.kind === 'experiment-remove') return experimentJob(services, job, ctx);
  return services.pipeline(job, ctx);
}

/**
 * Worker-side entry (job-worker.mjs): build everything from the environment, then run.
 * @param {{ env: Env, repoRoot?: string, config: Record<string, unknown> }} options
 */
export async function createJobRunner({ env, repoRoot, config }) {
  const { ready } = buildServices({ env, repoRoot, config, log: false });
  await ready;
  /** @param {JobSpec} job @param {JobContext} ctx */
  const run = (job, ctx) => runJob(ready, job, ctx);
  return { run };
}
