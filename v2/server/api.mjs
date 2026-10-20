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
import { createD1Client } from '../planner/d1.js';
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
  // d1, the local decision model, routes ideas and classifies changes (V2_D1=off disables it).
  const d1 = env.V2_D1 === 'off' ? null : createD1Client({ base: env.LITELLM_BASE || undefined, apiKey: env.LITELLM_API_KEY || '' });
  // Art is drawn in code from a model-written art direction; image generation is opt-in (V2_ART=images).
  const art = env.V2_ART === 'off' ? null : env.V2_ART === 'images' && openaiKey ? createArtGenerator({ apiKey: openaiKey, model: env.V2_ART_MODEL || 'gpt-image-1-mini', quality: env.V2_ART_QUALITY || 'low' })
    : createProceduralArt({ client: openai, model: env.V2_ART_DIRECTOR_MODEL || specModel });
  const pipeline = openai ? createDesignPipeline({ client: openai, model: specModel, art, d1 }) : createPipeline({ registry, logic, planner: active, catalogHash });
  const plannerName = openaiKey ? `openai:${specModel}` : active.version;
  const jobs = createJobs({ store, pipeline });

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
    ['POST', /^\/api\/v2\/questions$/, async body => {
      const prompt = String(body?.prompt || '').trim();
      if (!prompt) throw Object.assign(Error('Describe your game first.'), { status: 400 });
      // Route first (d1, ~0.1 s), so the questions fit the genre; the route rides along with the build request.
      const route = await routeIdea({ client: openai, model: specModel, d1, prompt });
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
