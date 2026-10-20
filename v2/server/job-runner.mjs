// What a generation job runs: the kernel pipeline (create / revise) and the
// experiment jobs, built from the environment or from injected fakes. The
// studio runs it in-process (tests with fakes) or once per job inside a worker
// thread (v2/server/job-worker.mjs, supervised by v2/server/isolate.js), so the
// registry, logic and model clients are always built where the job runs.
import { loadCatalogue } from '../planner/catalog.js';
import { createKernelPipeline, summarizeVerify } from '../planner/kernel-pipeline.js';
import { createDecisions } from '../planner/decisions.js';
import { loadOpenAIKey } from '../planner/openai.js';
import { createWriters } from '../planner/writer.js';
import { contentDiff, changeSummary } from '../planner/revision-check.js';
import { verifyDocument } from '../planner/verify-adapter.js';
import { catalogueForDoc, withoutExperiment } from '../experiments/primitive.js';
import { createPrimitiveExperimentService } from '../experiments/primitive-service.js';
import { DOC_SCHEMA } from '../kernel/document.js';

export const legacyError = () => Object.assign(Error('This game was made with the retired genre engine, so it can be played but not changed. Make it again to get a kernel game you can change.'), { status: 409 });

/**
 * buildServices({ env, repoRoot, writers?, decisions?, experiments?, config, log }) ->
 * { openaiKey, decisions, ready: Promise<{ base, writers, experiments, catalogue, pipeline }> }.
 * Injected values (tests) replace the ones built from the environment.
 */
export function buildServices({ env = process.env, repoRoot, writers: injectedWriters, decisions: injectedDecisions, experiments: injectedExperiments, config = {}, log = true } = {}) {
  const openaiKey = injectedWriters ? null : loadOpenAIKey(env, repoRoot);
  // A decision model picks primitives and confirms tweaks: d1 locally, OpenAI Decisions when d1 isn't reachable (V2_DECISIONS).
  const decisions = injectedDecisions !== undefined ? injectedDecisions : createDecisions(env, { openaiKey });
  const ready = (async () => {
    const base = await loadCatalogue();
    const writers = injectedWriters || await createWriters(env, { openaiKey });
    if (!injectedWriters && log) console.log(JSON.stringify({ operation: 'v2_writers', spec: writers.spec ? `${writers.spec.provider}:${writers.spec.model}` : null, code: writers.code ? `${writers.code.provider}:${writers.code.model}` : null, decisions: decisions?.provider || null }));
    const experiments = injectedExperiments !== undefined ? injectedExperiments : writers.code && env.V2_EXPERIMENTS !== 'off' ? createPrimitiveExperimentService({ writer: writers.code }) : null;
    const catalogue = async doc => (doc?.experiments?.length ? catalogueForDoc(doc) : base);
    const pipeline = createKernelPipeline({ catalogue, writers, decisions, gapService: experiments, config: { gaps: env.V2_GAPS || 'offer', ...config } });
    return { base, writers, experiments, catalogue, pipeline };
  })();
  return { openaiKey, decisions, ready };
}

async function experimentJob({ experiments, catalogue }, job, ctx) {
  const latest = await ctx.store.latest(job.gameId);
  if (!latest) throw Object.assign(Error('That game has no version yet.'), { status: 409 });
  const doc = latest.doc;
  if (doc.schema !== DOC_SCHEMA) throw legacyError();
  if (job.kind === 'experiment-remove') {
    const next = withoutExperiment(doc, job.experimentId);
    const { registry, logic } = await catalogue(next);
    const v = await verifyDocument(next, registry, logic, { budgetMs: 600 });
    return ctx.publish({ doc: v.doc || next, stage: 'experiment removed', report: { ...latest.report, change: null, changes: changeSummary(contentDiff(doc, next)), gaps: [], verification: summarizeVerify(v), hot: 'reload' }, provenance: { ...latest.provenance, base: latest.version } });
  }
  if (!experiments) throw Object.assign(Error('Experiments need a code model; set OPENAI_API_KEY or Anthropic credentials.'), { status: 503 });
  ctx.stage('experimenting', { model: experiments.model });
  const t = performance.now();
  const filled = await experiments.fill({ doc, request: job.change });
  if (!filled.ok) throw Object.assign(Error(`The experiment didn't pass its checks: ${(filled.problems || []).slice(0, 3).join(', ')}`), { status: 422 });
  const { registry, logic } = await catalogue(filled.doc);
  const v = await verifyDocument(filled.doc, registry, logic, { budgetMs: 800 });
  ctx.stage('experimented', { ms: Math.round(performance.now() - t), attempts: filled.report?.attempts?.length ?? null });
  return ctx.publish({
    doc: v.doc || filled.doc, stage: `experiment: ${filled.experiment.label}`,
    report: { ...latest.report, kind: 'kernel', change: job.change, changes: [`experimental primitive: ${filled.experiment.label} (${filled.experiment.card.id})`], gaps: [], experiment: { id: filled.experiment.id, label: filled.experiment.label, primitive: filled.experiment.card.id, check: filled.experiment.check.report }, verification: summarizeVerify(v), hot: 'reload', timings: { experimentMs: Math.round(performance.now() - t), modelAttempts: filled.report?.attempts?.length ?? null } },
    provenance: { ...latest.provenance, base: latest.version, experiment: filled.experiment.id },
  });
}

/** Run one job against built services: experiments, experiment removal, or the kernel pipeline. */
export async function runJob(ready, job, ctx) {
  const services = await ready;
  if (job.kind === 'experiment' || job.kind === 'experiment-remove') return experimentJob(services, job, ctx);
  return services.pipeline(job, ctx);
}

/** Worker-side entry (job-worker.mjs): build everything from the environment, then run. */
export async function createJobRunner({ env, repoRoot, config }) {
  const { ready } = buildServices({ env, repoRoot, config, log: false });
  await ready;
  return { run: (job, ctx) => runJob(ready, job, ctx) };
}
