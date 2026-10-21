// @ts-check
// v2 game service: catalogue, games, versions, generation jobs and the event
// stream the UI subscribes to. Mounted by v2/server/index.mjs.
// Every new game is a kernel document (gameverse.v2.game/0.2) built by the
// layered pipeline (planner/kernel-pipeline.js); nothing in this flow routes to
// a genre kit. Stored versions made by the retired arcade/kit engines still
// load and play, but they are not revised or extended any more.
import { fileURLToPath } from 'node:url';
import { createStore } from './store.js';
import { createJobs, streamEvents } from './jobs.js';
import { buildServices, runJob, legacyError } from './job-runner.mjs';
import { createIsolatedPipeline } from './isolate.js';
import { catalogHash } from '../planner/catalog.js';
import { KERNEL_PIPELINE_VERSION } from '../planner/kernel-pipeline.js';
import { askQuestions } from '../planner/questions.js';
import { createImprovementService } from '../improve/promote.js';
import { createLocalClaudeRunner } from '../improve/runners/local-claude.js';
import { isList, num, objects, prop, str } from '../kernel/guards.js';

/** @typedef {import('node:http').IncomingMessage} IncomingMessage */
/** @typedef {import('node:http').ServerResponse} ServerResponse */
/** @typedef {import('./job-runner.mjs').Env} Env */
/** @typedef {import('./jobs.js').Pipeline} Pipeline */
/**
 * The improvement service (improve/promote.js, not type-checked yet) as the routes use it.
 * @typedef {object} ImprovementService
 * @property {(request: Record<string, unknown>) => Promise<unknown>} start
 * @property {() => unknown[]} list
 * @property {(id: string) => unknown} status
 * @property {(id: string) => unknown} cancel
 * @property {(id: string) => Promise<{ ok: boolean, reason?: string } & Record<string, unknown>>} apply
 */
/**
 * @typedef {object} GameServiceOptions
 * @property {string} [root]
 * @property {Env} [env]
 * @property {import('../planner/types.js').Writers} [writers]
 * @property {import('./job-runner.mjs').Decisions} [decisions]
 * @property {ImprovementService | null} [improve]
 * @property {import('./job-runner.mjs').ExperimentService | null} [experiments]
 * @property {Record<string, unknown>} [config]
 * @property {boolean | import('./isolate.js').IsolationOptions} [isolation]
 */
/** A route: the request body (`unknown`: narrowed in the handler) and the path match. @typedef {(body: unknown, m: RegExpMatchArray) => Promise<unknown>} RouteHandler */

// improve/ is not type-checked yet: the option types inferred for these drop the options without defaults (root, runner).
const newImprovementService = /** @type {(options: { root: string, runner: unknown }) => ImprovementService} */ (/** @type {unknown} */ (createImprovementService));
const newLocalClaudeRunner = /** @type {(options: { root: string }) => unknown} */ (/** @type {unknown} */ (createLocalClaudeRunner));

/** @param {string} text */
const slug = text => (text.toLowerCase().match(/[a-z0-9]+/g) || ['game']).slice(0, 5).join('-').slice(0, 40);
const LEGACY = new Set(['gameverse.v2.game-spec/0.1', 'gameverse.v2.kit-game/0.1']);

/**
 * createGameService({ root, env, writers?, decisions?, improve?, experiments?, isolation? }) — writers/decisions/services
 * are injectable (tests pass fakes; production builds them from the environment).
 * isolation: every job (create, revise, experiments) runs in its own child process with a heap limit and a timeout
 * (isolate.js), so a runaway job fails instead of taking the server down. On by default; off when fakes are
 * injected (they can't cross a process) or V2_JOB_ISOLATION=off. Pass false, true, or { runner, heapMb, timeoutMs, forwardStderr }
 * (runner: a module URL exporting createJobRunner; tests use one with fake writers). Limits also come from
 * V2_JOB_HEAP_MB and V2_JOB_TIMEOUT_MS.
 * @param {GameServiceOptions} [options]
 */
export function createGameService({ root = fileURLToPath(new URL('../../local-data/v2/', import.meta.url)), env = process.env, writers: injectedWriters, decisions: injectedDecisions, improve: injectedImprove, experiments: injectedExperiments, config = {}, isolation } = {}) {
  const store = createStore(root);
  const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
  // The server keeps its own catalogue and clients for the catalog, questions and promote routes; isolated jobs build theirs in the child process.
  const { decisions, ready } = buildServices({ env, repoRoot, writers: injectedWriters, decisions: injectedDecisions, experiments: injectedExperiments, config });
  const improve = injectedImprove !== undefined ? injectedImprove : env.V2_IMPROVE === 'off' ? null : newImprovementService({ root: repoRoot, runner: newLocalClaudeRunner({ root: repoRoot }) });
  const injected = injectedWriters !== undefined || injectedDecisions !== undefined || injectedExperiments !== undefined;
  const isolate = isolation === undefined ? !injected && env.V2_JOB_ISOLATION !== 'off' : Boolean(isolation);
  /** @type {Pipeline} */
  const pipeline = isolate
    ? createIsolatedPipeline({ env, repoRoot, config, ...(typeof isolation === 'object' ? isolation : {}) })
    : (job, ctx) => runJob(ready, job, ctx);

  const jobs = createJobs({ store, pipeline });

  /** @type {[string, RegExp, RouteHandler][]} */
  const routes = [
    ['GET', /^\/api\/v2\/catalog$/, async () => { const { base, writers } = await ready; return { catalogHash: catalogHash(base.registry), primitives: base.registry.cards(), planner: KERNEL_PIPELINE_VERSION, writers: { spec: writers.spec?.model || null, code: writers.code?.model || null }, decisions: decisions?.provider || null, jobs: jobs.limits }; }],
    ['GET', /^\/api\/v2\/games$/, async () => ({ games: await store.list(), running: jobs.running() })],
    ['POST', /^\/api\/v2\/games$/, async body => {
      const prompt = String(prop(body, 'prompt') || '').trim();
      if (!prompt || prompt.length > 4000) throw Object.assign(Error('Describe your game in 1–4000 characters.'), { status: 400 });
      const id = `${slug(prompt)}-${Date.now().toString(36)}`;
      await store.createGame({ id, prompt, parent: str(prop(body, 'parent')) || null });
      const given = prop(body, 'answers'), seed = prop(body, 'seed');
      const answers = isList(given) ? given.slice(0, 8).map(a => ({ question: String(prop(a, 'question') || '').slice(0, 200), answer: String(prop(a, 'answer') || '').slice(0, 200) })) : [];
      const job = jobs.submit({ gameId: id, prompt, answers, seed: typeof seed === 'number' && Number.isInteger(seed) ? seed : undefined, kind: 'create', submittedAt: Date.now() });
      return { gameId: id, jobId: job.id };
    }],
    // The answer to the question a create job stopped with (the template path's readings: 409 'needs_answer'): the
    // job's failure record keeps the questions and the pick that asked them; each answer must be one of its question's
    // options; a create job for the same game then builds the reading chosen from that pick, asking nothing again.
    ['POST', /^\/api\/v2\/games\/([a-z0-9-]+)\/answers$/, async (body, m) => {
      const meta = await store.meta(m[1]);
      if (!meta) throw Object.assign(Error('No such game.'), { status: 404 });
      if (jobs.running().some(j => j.gameId === m[1])) throw Object.assign(Error('That game is still being built.'), { status: 409 });
      const record = await store.failure(m[1], num(meta.lastFailure));
      const asked = prop(record, 'question');
      if (str(prop(prop(record, 'error'), 'code')) !== 'needs_answer' || !asked) throw Object.assign(Error('That game is not waiting for an answer.'), { status: 409 });
      const questions = objects(prop(asked, 'questions')).map(q => ({ question: str(q.question), options: isList(q.options) ? q.options.map(String) : [] }));
      const given = prop(body, 'answers');
      const answers = isList(given) ? objects(given).map(a => ({ question: str(a.question).slice(0, 200), answer: str(a.answer).slice(0, 200) })) : [];
      for (const q of questions) {
        const a = answers.find(x => x.question === q.question);
        if (!a || !q.options.includes(a.answer)) throw Object.assign(Error(`Answer "${q.question}" with one of: ${q.options.join(' | ')}`), { status: 400 });
      }
      const before = objects(prop(record, 'answers')).map(a => ({ question: str(a.question), answer: str(a.answer) })).filter(a => !questions.some(q => q.question === a.question));
      const seed = prop(record, 'seed');
      await store.updateMeta(m[1], { status: 'generating' });
      const job = jobs.submit({ gameId: m[1], prompt: str(meta.prompt), answers: [...before, ...answers.filter(a => questions.some(q => q.question === a.question))], pick: prop(asked, 'pick'),
        ...(typeof seed === 'number' && Number.isInteger(seed) ? { seed } : {}), kind: 'create', submittedAt: Date.now() });
      return { gameId: m[1], jobId: job.id };
    }],
    // Follow-up change: a parameter tweak (no model) or targeted model ops; a new version publishes and hot-loads.
    ['POST', /^\/api\/v2\/games\/([a-z0-9-]+)\/revise$/, async (body, m) => {
      const meta = await store.meta(m[1]);
      if (!meta?.latest) throw Object.assign(Error('That game has no version to change yet.'), { status: 409 });
      const latest = await store.latest(m[1]);
      if (LEGACY.has(str(prop(latest?.doc, 'schema')))) throw legacyError();
      const change = String(prop(body, 'change') || '').trim();
      if (!change || change.length > 1000) throw Object.assign(Error('Describe the change in 1–1000 characters.'), { status: 400 });
      await store.updateMeta(m[1], { status: 'generating' });
      const job = jobs.submit({ gameId: m[1], prompt: str(meta.prompt), change, base: num(meta.latest), kind: 'revise' });
      return { gameId: m[1], jobId: job.id };
    }],
    // A mechanic no primitive covers, written as a new primitive and gated in the experiments sandbox.
    ['POST', /^\/api\/v2\/games\/([a-z0-9-]+)\/experiments$/, async (body, m) => {
      const { experiments } = await ready;
      if (!experiments) throw Object.assign(Error('Experiments need a code model; set OPENAI_API_KEY or Anthropic credentials.'), { status: 503 });
      const request = String(prop(body, 'request') || '').trim();
      if (!request || request.length > 500) throw Object.assign(Error('Describe the experiment in 1-500 characters.'), { status: 400 });
      const meta = await store.meta(m[1]);
      if (!meta?.latest) throw Object.assign(Error('That game has no version yet.'), { status: 409 });
      if (LEGACY.has(str(prop((await store.latest(m[1]))?.doc, 'schema')))) throw legacyError();
      await store.updateMeta(m[1], { status: 'generating' });
      const job = jobs.submit({ gameId: m[1], prompt: str(meta.prompt), change: request, kind: 'experiment' });
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
      const experiment = objects(prop(latest?.doc, 'experiments')).find(e => e.id === prop(body, 'experimentId'));
      if (!experiment || !latest) throw Object.assign(Error('That experiment is not part of the latest version.'), { status: 404 });
      const { base } = await ready;
      const job = await improve.start({ target: 'primitive', experiment, doc: latest.doc, registry: base.registry, gameId: m[1], gameVersion: latest.version });
      return { job };
    }],
    // Make a published version a template (improve target 'template'): derived from the version, checked by the whole
    // template contract against the live catalogue, written to v2/templates/promoted/<id>.json on success. Body:
    // { version?: the published version (the latest when absent), templateId?: the template's id (the game's id when absent) }.
    ['POST', /^\/api\/v2\/games\/([a-z0-9-]+)\/promote-template$/, async (body, m) => {
      if (!improve) throw Object.assign(Error('Promotion is off (V2_IMPROVE=off).'), { status: 503 });
      const asked = prop(body, 'version');
      const version = typeof asked === 'number' && Number.isInteger(asked) ? await store.version(m[1], asked) : await store.latest(m[1]);
      const doc = prop(version, 'doc');
      if (!version || !doc || typeof doc !== 'object') throw Object.assign(Error('That game has no such published version.'), { status: 404 });
      if (LEGACY.has(str(prop(doc, 'schema')))) throw legacyError();
      const { base } = await ready;
      const templateId = str(prop(body, 'templateId')) || null;
      const job = await improve.start({ target: 'template', doc, registry: base.registry, gameId: m[1], gameVersion: prop(version, 'version'), templateId });
      return { job };
    }],
    ['GET', /^\/api\/v2\/improve$/,async () => ({ jobs: improve ? improve.list() : [] })],
    ['GET', /^\/api\/v2\/improve\/([a-z0-9-]+)$/, async (_, m) => { const job = improve?.status(m[1]); if (!job) throw Object.assign(Error('No such job.'), { status: 404 }); return { job }; }],
    ['POST', /^\/api\/v2\/improve\/([a-z0-9-]+)\/cancel$/, async (_, m) => ({ job: await improve?.cancel(m[1]) })],
    // Apply a verified primitive to this checkout (fast-forward only; never pushes). The server restarts to load it.
    ['POST', /^\/api\/v2\/improve\/([a-z0-9-]+)\/apply$/, async (_, m) => {
      if (!improve) throw Object.assign(Error('Promotion is off (V2_IMPROVE=off).'), { status: 503 });
      const result = await improve.apply(m[1]);
      if (!result.ok) throw Object.assign(Error(result.reason), { status: 409 });
      return { ...result, restartNeeded: true };
    }],
    ['POST', /^\/api\/v2\/questions$/, async body => {
      const prompt = String(prop(body, 'prompt') || '').trim();
      if (!prompt) throw Object.assign(Error('Describe your game first.'), { status: 400 });
      const started = performance.now();
      // The questions are the model's, from the idea itself: no words of it are read as mechanics here (the
      // decomposition runs in the build, by the model).
      const { writers } = await ready;
      if (!writers.spec || env.V2_QUESTIONS === 'off') return { questions: [], ms: Math.round(performance.now() - started) };
      try { return await askQuestions(writers.spec, undefined, prompt, null); }
      catch { return { questions: [], ms: Math.round(performance.now() - started) }; }
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
    // Every finished job (done or failed) with its timings, and the full record of a failed one for reproducing it.
    ['GET', /^\/api\/v2\/games\/([a-z0-9-]+)\/runs$/, async (_, m) => ({ runs: await store.runs(m[1]) })],
    ['GET', /^\/api\/v2\/games\/([a-z0-9-]+)\/failures\/(\d+)$/, async (_, m) => {
      const f = await store.failure(m[1], Number(m[2]));
      if (!f) throw Object.assign(Error('No such failure record.'), { status: 404 });
      return f;
    }],
    ['GET', /^\/api\/v2\/games\/([a-z0-9-]+)\/v\/(\d+)$/, async (_, m) => {
      const v = await store.version(m[1], Number(m[2]));
      if (!v) throw Object.assign(Error('No such version.'), { status: 404 });
      return v;
    }],
  ];

  return {
    store, jobs, ready, improve,
    /**
     * @param {IncomingMessage} req @param {ServerResponse} res @param {string} path
     * @param {(req: IncomingMessage) => Promise<unknown>} readJson the request body, parsed (unknown: routes narrow it)
     */
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
        const game = new URL(req.url ?? '', 'http://x').searchParams.get('game');
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
