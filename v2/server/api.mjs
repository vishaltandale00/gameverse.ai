// v2 game service: catalogue, games, versions, generation jobs and the event
// stream the UI subscribes to. Mounted by v2/server/index.mjs.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogue } from '../primitives/index.js';
import { createStore, hashOf } from './store.js';
import { createJobs, streamEvents } from './jobs.js';
import { createPipeline, verify } from '../planner/pipeline.js';
import { createOfflinePlanner } from '../planner/offline-planner.js';

const slug = text => (text.toLowerCase().match(/[a-z0-9]+/g) || ['game']).slice(0, 5).join('-').slice(0, 40);

export function createGameService({ root = fileURLToPath(new URL('../../local-data/v2/', import.meta.url)), planner, env = process.env } = {}) {
  const { registry, logic } = catalogue();
  const catalogHash = hashOf(registry.cards());
  const offline = createOfflinePlanner({ usable: doc => verify(doc, registry, logic, { solveBudgetMs: 50 }).ok });
  const active = planner || offline;
  if (active !== offline && !active.fallback) active.fallback = offline;
  const store = createStore(root);
  const jobs = createJobs({ store, pipeline: createPipeline({ registry, logic, planner: active, catalogHash }) });

  const routes = [
    ['GET', /^\/api\/v2\/catalog$/, async () => ({ catalogHash, primitives: registry.cards(), planner: active.version })],
    ['GET', /^\/api\/v2\/games$/, async () => ({ games: await store.list(), running: jobs.running() })],
    ['POST', /^\/api\/v2\/games$/, async body => {
      const prompt = String(body?.prompt || '').trim();
      if (!prompt || prompt.length > 4000) throw Object.assign(Error('Describe your game in 1–4000 characters.'), { status: 400 });
      const id = `${slug(prompt)}-${Date.now().toString(36)}`;
      await store.createGame({ id, prompt, parent: body.parent || null });
      const job = jobs.submit({ gameId: id, prompt, seed: Number.isInteger(body.seed) ? body.seed : undefined, kind: 'create' });
      return { gameId: id, jobId: job.id };
    }],
    ['GET', /^\/api\/v2\/games\/([a-z0-9-]+)$/, async (_, m) => {
      const meta = await store.meta(m[1]);
      if (!meta) throw Object.assign(Error('No such game.'), { status: 404 });
      return { meta, latest: await store.latest(m[1]) };
    }],
    ['GET', /^\/api\/v2\/games\/([a-z0-9-]+)\/v\/(\d+)$/, async (_, m) => {
      const v = await store.version(m[1], Number(m[2]));
      if (!v) throw Object.assign(Error('No such version.'), { status: 404 });
      return v;
    }],
  ];

  return {
    store, jobs, registry, logic, planner: active,
    async handle(req, res, path, readJson) {
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
