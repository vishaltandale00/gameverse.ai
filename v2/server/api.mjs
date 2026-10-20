// v2 game service: catalogue, games, versions, generation jobs and the event
// stream the UI subscribes to. Mounted by v2/server/index.mjs.
// Every new game is a kernel document (gameverse.v2.game/0.2) built by the
// layered pipeline (planner/kernel-pipeline.js); nothing in this flow routes to
// a genre kit. Stored versions made by the retired arcade/kit engines still
// load and play, but they are not revised or extended any more.
import { fileURLToPath } from 'node:url';
import { createStore } from './store.js';
import { createJobs, streamEvents } from './jobs.js';
import { loadCatalogue, catalogHash } from '../planner/catalog.js';
import { createKernelPipeline, KERNEL_PIPELINE_VERSION, summarizeVerify } from '../planner/kernel-pipeline.js';
import { decomposeOffline } from '../planner/decompose.js';
import { askQuestions } from '../planner/questions.js';
import { createDecisions } from '../planner/decisions.js';
import { loadOpenAIKey } from '../planner/openai.js';
import { createWriters } from '../planner/writer.js';
import { contentDiff, changeSummary } from '../planner/revision-check.js';
import { verifyDocument } from '../planner/verify-adapter.js';
import { catalogueForDoc, withoutExperiment } from '../experiments/primitive.js';
import { createPrimitiveExperimentService } from '../experiments/primitive-service.js';
import { createImprovementService } from '../improve/promote.js';
import { createLocalClaudeRunner } from '../improve/runners/local-claude.js';
import { DOC_SCHEMA } from '../kernel/document.js';

const slug = text => (text.toLowerCase().match(/[a-z0-9]+/g) || ['game']).slice(0, 5).join('-').slice(0, 40);
const LEGACY = new Set(['gameverse.v2.game-spec/0.1', 'gameverse.v2.kit-game/0.1']);
const legacyError = () => Object.assign(Error('This game was made with the retired genre engine, so it can be played but not changed. Make it again to get a kernel game you can change.'), { status: 409 });

/**
 * createGameService({ root, env, writers?, decisions?, improve?, experiments? }) — writers/decisions/services
 * are injectable (tests pass fakes; production builds them from the environment).
 */
export function createGameService({ root = fileURLToPath(new URL('../../local-data/v2/', import.meta.url)), env = process.env, writers: injectedWriters, decisions: injectedDecisions, improve: injectedImprove, experiments: injectedExperiments, config = {} } = {}) {
  const store = createStore(root);
  const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
  const openaiKey = injectedWriters ? null : loadOpenAIKey(env, repoRoot);
  // A decision model picks primitives and confirms tweaks: d1 locally, OpenAI Decisions when d1 isn't reachable (V2_DECISIONS).
  const decisions = injectedDecisions !== undefined ? injectedDecisions : createDecisions(env, { openaiKey });
  const ready = (async () => {
    const base = await loadCatalogue();
    const writers = injectedWriters || await createWriters(env, { openaiKey });
    const experiments = injectedExperiments !== undefined ? injectedExperiments : writers.code && env.V2_EXPERIMENTS !== 'off' ? createPrimitiveExperimentService({ writer: writers.code }) : null;
    const catalogue = async doc => (doc?.experiments?.length ? catalogueForDoc(doc) : base);
    const pipeline = createKernelPipeline({ catalogue, writers, decisions, gapService: experiments, config: { gaps: env.V2_GAPS || 'offer', ...config } });
    return { base, writers, experiments, catalogue, pipeline };
  })();
  const improve = injectedImprove !== undefined ? injectedImprove : env.V2_IMPROVE === 'off' ? null : createImprovementService({ root: repoRoot, runner: createLocalClaudeRunner({ root: repoRoot }) });

  async function experimentJob(job, ctx) {
    const { experiments, catalogue } = await ready;
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

  const jobs = createJobs({ store, pipeline: async (job, ctx) => {
    if (job.kind === 'experiment' || job.kind === 'experiment-remove') return experimentJob(job, ctx);
    return (await ready).pipeline(job, ctx);
  } });

  const routes = [
    ['GET', /^\/api\/v2\/catalog$/, async () => { const { base, writers } = await ready; return { catalogHash: catalogHash(base.registry), primitives: base.registry.cards(), planner: KERNEL_PIPELINE_VERSION, writers: { spec: writers.spec?.model || null, code: writers.code?.model || null }, decisions: decisions?.provider || null }; }],
    ['GET', /^\/api\/v2\/games$/, async () => ({ games: await store.list(), running: jobs.running() })],
    ['POST', /^\/api\/v2\/games$/, async body => {
      const prompt = String(body?.prompt || '').trim();
      if (!prompt || prompt.length > 4000) throw Object.assign(Error('Describe your game in 1–4000 characters.'), { status: 400 });
      const id = `${slug(prompt)}-${Date.now().toString(36)}`;
      await store.createGame({ id, prompt, parent: body.parent || null });
      const answers = Array.isArray(body.answers) ? body.answers.slice(0, 8).map(a => ({ question: String(a.question || '').slice(0, 200), answer: String(a.answer || '').slice(0, 200) })) : [];
      const job = jobs.submit({ gameId: id, prompt, answers, seed: Number.isInteger(body.seed) ? body.seed : undefined, kind: 'create', submittedAt: Date.now() });
      return { gameId: id, jobId: job.id };
    }],
    // Follow-up change: a parameter tweak (no model) or targeted model ops; a new version publishes and hot-loads.
    ['POST', /^\/api\/v2\/games\/([a-z0-9-]+)\/revise$/, async (body, m) => {
      const meta = await store.meta(m[1]);
      if (!meta?.latest) throw Object.assign(Error('That game has no version to change yet.'), { status: 409 });
      const latest = await store.latest(m[1]);
      if (LEGACY.has(latest?.doc?.schema)) throw legacyError();
      const change = String(body?.change || '').trim();
      if (!change || change.length > 1000) throw Object.assign(Error('Describe the change in 1–1000 characters.'), { status: 400 });
      await store.updateMeta(m[1], { status: 'generating' });
      const job = jobs.submit({ gameId: m[1], prompt: meta.prompt, change, base: meta.latest, kind: 'revise' });
      return { gameId: m[1], jobId: job.id };
    }],
    // A mechanic no primitive covers, written as a new primitive and gated in the experiments sandbox.
    ['POST', /^\/api\/v2\/games\/([a-z0-9-]+)\/experiments$/, async (body, m) => {
      const { experiments } = await ready;
      if (!experiments) throw Object.assign(Error('Experiments need a code model; set OPENAI_API_KEY or Anthropic credentials.'), { status: 503 });
      const request = String(body?.request || '').trim();
      if (!request || request.length > 500) throw Object.assign(Error('Describe the experiment in 1-500 characters.'), { status: 400 });
      const meta = await store.meta(m[1]);
      if (!meta?.latest) throw Object.assign(Error('That game has no version yet.'), { status: 409 });
      if (LEGACY.has((await store.latest(m[1]))?.doc?.schema)) throw legacyError();
      await store.updateMeta(m[1], { status: 'generating' });
      const job = jobs.submit({ gameId: m[1], prompt: meta.prompt, change: request, kind: 'experiment' });
      return { gameId: m[1], jobId: job.id };
    }],
    ['DELETE', /^\/api\/v2\/games\/([a-z0-9-]+)\/experiments\/([a-z0-9-]+)$/, async (_, m) => {
      const job = jobs.submit({ gameId: m[1], kind: 'experiment-remove', experimentId: m[2] });
      return { gameId: m[1], jobId: job.id };
    }],
    // Build an experiment properly: a coding agent turns it into a native, tested primitive (a branch to review).
    ['POST', /^\/api\/v2\/games\/([a-z0-9-]+)\/promote$/, async (body, m) => {
      if (!improve) throw Object.assign(Error('Promotion is off (V2_IMPROVE=off).'), { status: 503 });
      const latest = await store.latest(m[1]);
      const experiment = (latest?.doc?.experiments || []).find(e => e.id === body?.experimentId);
      if (!experiment) throw Object.assign(Error('That experiment is not part of the latest version.'), { status: 404 });
      const { base } = await ready;
      const job = await improve.start({ target: 'primitive', experiment, doc: latest.doc, registry: base.registry, gameId: m[1], gameVersion: latest.version });
      return { job };
    }],
    ['GET', /^\/api\/v2\/improve$/, async () => ({ jobs: improve ? improve.list() : [] })],
    ['GET', /^\/api\/v2\/improve\/([a-z0-9-]+)$/, async (_, m) => { const job = improve?.status(m[1]); if (!job) throw Object.assign(Error('No such job.'), { status: 404 }); return { job }; }],
    ['POST', /^\/api\/v2\/improve\/([a-z0-9-]+)\/cancel$/, async (_, m) => ({ job: await improve?.cancel(m[1]) })],
    // Apply a verified primitive to this checkout (fast-forward only; never pushes). The server restarts to load it.
    ['POST', /^\/api\/v2\/improve\/([a-z0-9-]+)\/apply$/, async (_, m) => {
      const result = await improve.apply(m[1]);
      if (!result.ok) throw Object.assign(Error(result.reason), { status: 409 });
      return { ...result, restartNeeded: true };
    }],
    ['POST', /^\/api\/v2\/questions$/, async body => {
      const prompt = String(body?.prompt || '').trim();
      if (!prompt) throw Object.assign(Error('Describe your game first.'), { status: 400 });
      const started = performance.now();
      // The instant (offline) decomposition frames the questions; the real one runs in the build.
      const decomposition = decomposeOffline(prompt);
      const { writers } = await ready;
      if (!writers.spec || env.V2_QUESTIONS === 'off') return { questions: [], decomposition, ms: Math.round(performance.now() - started) };
      try { const asked = await askQuestions(writers.spec, undefined, prompt, decomposition); return { ...asked, decomposition }; }
      catch { return { questions: [], decomposition, ms: Math.round(performance.now() - started) }; }
    }],
    ['DELETE', /^\/api\/v2\/games\/([a-z0-9-]+)$/, async (_, m) => {
      if (jobs.running().some(j => j.gameId === m[1])) throw Object.assign(Error('That game is still being built.'), { status: 409 });
      await store.remove(m[1]); return { removed: m[1] };
    }],
    ['GET', /^\/api\/v2\/games\/([a-z0-9-]+)$/, async (_, m) => {
      const meta = await store.meta(m[1]);
      if (!meta) throw Object.assign(Error('No such game.'), { status: 404 });
      return { meta, latest: await store.latest(m[1]) };
    }],
    ['GET', /^\/api\/v2\/games\/([a-z0-9-]+)\/versions$/, async (_, m) => ({ versions: await store.versions(m[1]) })],
    ['GET', /^\/api\/v2\/games\/([a-z0-9-]+)\/v\/(\d+)$/, async (_, m) => {
      const v = await store.version(m[1], Number(m[2]));
      if (!v) throw Object.assign(Error('No such version.'), { status: 404 });
      return v;
    }],
  ];

  return {
    store, jobs, ready, improve,
    async handle(req, res, path, readJson) {
      const asset = path.match(/^\/api\/v2\/games\/([a-z0-9-]+)\/assets\/([a-z0-9-]+\.(webp|svg))$/i);
      if (asset && req.method === 'GET') {
        const bytes = await store.asset(asset[1], asset[2]);
        if (!bytes) { res.writeHead(404).end(); return true; }
        // Painted SVGs (legacy arcade games) are served inert: no scripts, no external loads.
        const svg = asset[3].toLowerCase() === 'svg';
        res.writeHead(200, { 'Content-Type': svg ? 'image/svg+xml' : 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable', ...(svg ? { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" } : {}) }).end(bytes); return true;
      }
      if (path === '/api/v2/events') {
        const game = new URL(req.url, 'http://x').searchParams.get('game');
        streamEvents(jobs, req, res, game); return true;
      }
      for (const [method, re, fn] of routes) {
        const m = path.match(re);
        if (!m || req.method !== method) continue;
        const body = method === 'POST' ? await readJson(req) : null;
        const result = await fn(body, m);
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
        return true;
      }
      return false;
    },
  };
}
