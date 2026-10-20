// v2 game service: catalogue, games, versions, generation jobs and the event
// stream the UI subscribes to. Mounted by v2/server/index.mjs.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogue } from '../primitives/index.js';
import { createStore, hashOf } from './store.js';
import { createJobs, streamEvents } from './jobs.js';
import { createPipeline, verify } from '../planner/pipeline.js';
import { createOfflinePlanner } from '../planner/offline-planner.js';
import { createDesignPipeline } from '../planner/design-pipeline.js';
import { createArtGenerator } from '../planner/art.js';
import { createProceduralArt } from '../planner/art-procedural.js';
import { askQuestions } from '../planner/questions.js';
import { routeIdea } from '../planner/router.js';
import { createDecisions } from '../planner/decisions.js';
import { createExperimentService } from '../experiments/service.js';
import { createImprovementService } from '../improve/promote.js';
import { createLocalClaudeRunner } from '../improve/runners/local-claude.js';
import { loadKit } from '../kits/registry.js';
import { createOpenAIClient, loadOpenAIKey } from '../planner/openai.js';

const slug = text => (text.toLowerCase().match(/[a-z0-9]+/g) || ['game']).slice(0, 5).join('-').slice(0, 40);

export function createGameService({ root = fileURLToPath(new URL('../../local-data/v2/', import.meta.url)), planner, env = process.env } = {}) {
  const { registry, logic } = catalogue();
  const catalogHash = hashOf(registry.cards());
  const offline = createOfflinePlanner({ usable: doc => verify(doc, registry, logic, { solveBudgetMs: 50 }).ok });
  const active = planner || offline;
  if (active !== offline && !active.fallback) active.fallback = offline;
  const store = createStore(root);
  // With an OpenAI key, ideas become model-generated, playtested 2D games.
  const openaiKey = loadOpenAIKey(env, fileURLToPath(new URL('../../', import.meta.url)));
  const specModel = env.V2_OPENAI_DESIGN_MODEL || 'gpt-4.1-mini';
  const openai = openaiKey ? createOpenAIClient({ apiKey: openaiKey }) : null;
  // A decision model routes ideas: d1 locally, OpenAI Decisions when d1 isn't reachable (V2_DECISIONS).
  const decisions = createDecisions(env, { openaiKey });
  // Art is drawn in code from a model-written art direction; image generation is opt-in (V2_ART=images).
  const art = env.V2_ART === 'off' ? null : env.V2_ART === 'images' && openaiKey ? createArtGenerator({ apiKey: openaiKey, model: env.V2_ART_MODEL || 'gpt-image-1-mini', quality: env.V2_ART_QUALITY || 'low' })
    : createProceduralArt({ client: openai, model: env.V2_ART_DIRECTOR_MODEL || specModel });
  const pipeline = openai ? createDesignPipeline({ client: openai, model: specModel, art, decisions, names: env.V2_ORIGINAL_NAMES === 'on' ? 'original' : 'any' }) : createPipeline({ registry, logic, planner: active, catalogHash });
  const plannerName = openaiKey ? `openai:${specModel}` : active.version;
  // Tier 3: experiments (model-written mechanics, sandboxed). Tier 4: promotion into native mods by a coding agent.
  const experiments = openaiKey && env.V2_EXPERIMENTS !== 'off' ? createExperimentService({ client: createOpenAIClient({ apiKey: openaiKey, timeoutMs: 120000 }) }) : null;
  const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
  const improve = env.V2_IMPROVE === 'off' ? null : createImprovementService({ root: repoRoot, runner: createLocalClaudeRunner({ root: repoRoot }) });
  async function experimentJob(job, ctx) {
    const latest = await ctx.store.latest(job.gameId);
    if (!latest) throw Object.assign(Error('That game has no version yet.'), { status: 409 });
    const doc = latest.doc, current = doc.experiments || [];
    if (job.kind === 'experiment-remove') {
      const kept = current.filter(e => e.id !== job.experimentId);
      return ctx.publish({ doc: { ...doc, experiments: kept }, stage: 'experiment removed', report: { ...latest.report, change: null, changes: [], gaps: [] }, provenance: { ...latest.provenance, base: latest.version } });
    }
    ctx.stage('experimenting', { model: experiments.model });
    const { experiment, check } = await experiments.experiment({ record: latest, kit: await loadKit(doc.kit), request: job.change });
    if (!check?.ok) throw Object.assign(Error(`The experiment didn't pass its checks: ${(check?.problems || []).slice(0, 2).map(p => p.message || p).join('; ')}`), { status: 422 });
    return ctx.publish({
      doc: { ...doc, experiments: [...current.filter(e => e.id !== experiment.id), experiment] },
      stage: `experiment: ${experiment.label}`,
      report: { ...latest.report, change: job.change, changes: [`experimental: ${experiment.label}`], gaps: [], experiment: { id: experiment.id, label: experiment.label } },
      provenance: { ...latest.provenance, base: latest.version, experiment: experiment.id },
    });
  }
  const jobs = createJobs({ store, pipeline: (job, ctx) => job.kind === 'experiment' || job.kind === 'experiment-remove' ? experimentJob(job, ctx) : pipeline(job, ctx) });

  const routes = [
    ['GET', /^\/api\/v2\/catalog$/, async () => ({ catalogHash, primitives: registry.cards(), planner: plannerName })],
    ['GET', /^\/api\/v2\/games$/, async () => ({ games: await store.list(), running: jobs.running() })],
    ['POST', /^\/api\/v2\/games$/, async body => {
      const prompt = String(body?.prompt || '').trim();
      if (!prompt || prompt.length > 4000) throw Object.assign(Error('Describe your game in 1–4000 characters.'), { status: 400 });
      const id = `${slug(prompt)}-${Date.now().toString(36)}`;
      await store.createGame({ id, prompt, parent: body.parent || null });
      const answers = Array.isArray(body.answers) ? body.answers.slice(0, 8).map(a => ({ question: String(a.question || '').slice(0, 200), answer: String(a.answer || '').slice(0, 200) })) : [];
      // A route chosen with the questions skips routing in the pipeline; it is re-checked there.
      const route = body.route && typeof body.route.engine === 'string' ? { engine: String(body.route.engine).slice(0, 40), needs: String(body.route.needs || 'none').slice(0, 40), why: String(body.route.why || '').slice(0, 300), source: 'questions' } : null;
      const job = jobs.submit({ gameId: id, prompt, answers, route, seed: Number.isInteger(body.seed) ? body.seed : undefined, kind: 'create' });
      return { gameId: id, jobId: job.id };
    }],
    // Follow-up change: the model revises the game's design; a new version publishes and hot-loads.
    ['POST', /^\/api\/v2\/games\/([a-z0-9-]+)\/revise$/, async (body, m) => {
      const meta = await store.meta(m[1]);
      if (!meta?.latest) throw Object.assign(Error('That game has no version to change yet.'), { status: 409 });
      const change = String(body?.change || '').trim();
      if (!change || change.length > 1000) throw Object.assign(Error('Describe the change in 1–1000 characters.'), { status: 400 });
      if (!openai) throw Object.assign(Error('Changes need a model; set OPENAI_API_KEY.'), { status: 503 });
      await store.updateMeta(m[1], { status: 'generating' });
      const job = jobs.submit({ gameId: m[1], prompt: meta.prompt, change, base: meta.latest, kind: 'revise' });
      return { gameId: m[1], jobId: job.id };
    }],
    // Try a change as an experiment: model-written code, checked and sandboxed (v2/kits/EXTENDING.md).
    ['POST', /^\/api\/v2\/games\/([a-z0-9-]+)\/experiments$/, async (body, m) => {
      if (!experiments) throw Object.assign(Error('Experiments need a model; set OPENAI_API_KEY.'), { status: 503 });
      const request = String(body?.request || '').trim();
      if (!request || request.length > 500) throw Object.assign(Error('Describe the experiment in 1-500 characters.'), { status: 400 });
      const meta = await store.meta(m[1]);
      if (!meta?.latest) throw Object.assign(Error('That game has no version yet.'), { status: 409 });
      await store.updateMeta(m[1], { status: 'generating' });
      const job = jobs.submit({ gameId: m[1], prompt: meta.prompt, change: request, kind: 'experiment' });
      return { gameId: m[1], jobId: job.id };
    }],
    ['DELETE', /^\/api\/v2\/games\/([a-z0-9-]+)\/experiments\/([a-z0-9-]+)$/, async (_, m) => {
      const job = jobs.submit({ gameId: m[1], kind: 'experiment-remove', experimentId: m[2] });
      return { gameId: m[1], jobId: job.id };
    }],
    // Build an experiment properly: a coding agent turns it into a native, tested mod (a branch to review).
    ['POST', /^\/api\/v2\/games\/([a-z0-9-]+)\/promote$/, async (body, m) => {
      if (!improve) throw Object.assign(Error('Promotion is off (V2_IMPROVE=off).'), { status: 503 });
      const latest = await store.latest(m[1]);
      const experiment = (latest?.doc?.experiments || []).find(e => e.id === body?.experimentId);
      if (!experiment) throw Object.assign(Error('That experiment is not part of the latest version.'), { status: 404 });
      const job = await improve.start({ experiment, kitId: latest.doc.kit, gameId: m[1], gameVersion: latest.version, target: 'mod' });
      return { job };
    }],
    ['GET', /^\/api\/v2\/improve$/, async () => ({ jobs: improve ? improve.list() : [] })],
    ['GET', /^\/api\/v2\/improve\/([a-z0-9-]+)$/, async (_, m) => { const job = improve?.status(m[1]); if (!job) throw Object.assign(Error('No such job.'), { status: 404 }); return { job }; }],
    ['POST', /^\/api\/v2\/improve\/([a-z0-9-]+)\/cancel$/, async (_, m) => ({ job: await improve?.cancel(m[1]) })],
    // Apply a verified mod to this checkout (fast-forward only; never pushes). The server restarts to load it.
    ['POST', /^\/api\/v2\/improve\/([a-z0-9-]+)\/apply$/, async (_, m) => {
      const result = await improve.apply(m[1]);
      if (!result.ok) throw Object.assign(Error(result.reason), { status: 409 });
      return { ...result, restartNeeded: true };
    }],
    ['POST', /^\/api\/v2\/questions$/, async body => {
      const prompt = String(body?.prompt || '').trim();
      if (!prompt) throw Object.assign(Error('Describe your game first.'), { status: 400 });
      // Route first (a decision model, ~0.1 s), so the questions fit the genre; the route rides along with the build request.
      const route = await routeIdea({ client: openai, model: specModel, decisions, prompt });
      if (!openai) return { questions: [], route, ms: route.ms };
      const asked = await askQuestions(openai, specModel, prompt, route);
      return { ...asked, route };
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
    store, jobs, registry, logic, planner: active,
    async handle(req, res, path, readJson) {
      const asset = path.match(/^\/api\/v2\/games\/([a-z0-9-]+)\/assets\/([a-z0-9-]+\.(webp|svg))$/i);
      if (asset && req.method === 'GET') {
        const bytes = await store.asset(asset[1], asset[2]);
        if (!bytes) { res.writeHead(404).end(); return true; }
        // Painted SVGs are served inert: no scripts, no external loads.
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
