// @ts-check
// Child-process side of an isolated generation job (forked by isolate.js with a
// heap limit). It imports a runner module (default: job-runner.mjs), builds the
// pipeline from its environment here, and runs exactly one job. Progress (stage,
// draft, checkpoint) is sent to the parent; every store access (publish,
// updateMeta, version, ...) is a request the parent answers, so all writes stay
// in the parent.
import { serializeError, jobSpecOf } from './jobs.js';
import { isStr, num, obj, prop, str } from '../kernel/guards.js';

/** @typedef {import('./jobs.js').JobSpec} JobSpec */
/** @typedef {import('./jobs.js').JobContext} JobContext */
/**
 * A runner module (default: job-runner.mjs; tests load their own). Code, not data: the parent names it.
 * @typedef {{ createJobRunner(options: { env: NodeJS.ProcessEnv, repoRoot?: string, config: Record<string, unknown> }): Promise<{ run(job: JobSpec, ctx: JobContext): Promise<unknown> }> }} RunnerModule
 */

const t0 = performance.now();
/** @type {Map<number, { resolve: (value: unknown) => void, reject: (error: unknown) => void }>} */
const pending = new Map();
let nextId = 0;

/** @param {unknown} message */
const send = message => {
  try { process.send?.(message); }
  // Anything the serializer refuses (functions, class instances) goes as its JSON form, as the store would write it.
  catch { process.send?.(JSON.parse(JSON.stringify(message))); }
};
/** @param {string} method @param {unknown[]} args @returns {Promise<unknown>} */
const call = (method, ...args) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  send({ type: 'call', id, method, args });
});
const memory = () => {
  const m = process.memoryUsage();
  return { heapUsedMb: Math.round(m.heapUsed / 1048576), rssMb: Math.round(m.rss / 1048576), maxRssMb: Math.round(process.resourceUsage().maxRSS / 1024) };
};

/** @param {Record<string, unknown>} message the parent's start message: { job, runner, repoRoot, config } */
async function start(message) {
  const job = jobSpecOf(message.job), runner = str(message.runner), config = obj(message.config);
  const repoRoot = isStr(message.repoRoot) ? message.repoRoot : undefined;
  /** @type {JobContext} */
  const ctx = {
    job,
    stage: (name, detail = {}) => send({ type: 'stage', name, detail }),
    draft: data => send({ type: 'draft', data }),
    checkpoint: (name, value) => send({ type: 'checkpoint', name, value }),
    publish: payload => call('publish', payload),
    store: {
      updateMeta: (id, patch) => call('updateMeta', id, patch),
      version: (id, v) => call('version', id, v),
      latest: id => call('latest', id),
      meta: id => call('meta', id),
      saveAsset: (id, name, bytes) => call('saveAsset', id, name, bytes),
      asset: (id, name) => call('asset', id, name),
    },
  };
  try {
    const mod = /** @type {RunnerModule} */ (await import(runner));
    const built = await mod.createJobRunner({ env: process.env, repoRoot, config });
    send({ type: 'ready', setupMs: Math.round(performance.now() - t0) });
    await built.run(job, ctx);
    send({ type: 'done', memory: memory() });
  } catch (error) {
    send({ type: 'failed', error: serializeError(error), memory: memory() });
  }
}

process.on('message', received => {
  const message = obj(received);
  if (message.type === 'start') { start(message); return; }
  if (message.type !== 'reply') return;
  const id = num(message.id), p = pending.get(id); if (!p) return;
  pending.delete(id);
  if (message.ok) p.resolve(message.value); else p.reject(Object.assign(Error(str(prop(message.error, 'message')) || 'store call failed'), obj(message.error)));
});
// The server went away (or killed the job): stop rather than run on unsupervised.
process.on('disconnect', () => process.exit(1));
