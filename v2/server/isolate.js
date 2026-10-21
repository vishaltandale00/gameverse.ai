// @ts-check
// Runs each generation job in its own child process with a heap limit and a
// wall-clock timeout, so a runaway job (an infinite loop, unbounded allocation)
// fails that job instead of taking the studio server down. The child builds the
// pipeline itself (job-worker.mjs + a runner module); the parent keeps every
// store write and answers the child's store calls, so a killed child can never
// leave a half-written file, and versions already published stay playable.
//
// A process, not a worker thread: worker_threads resourceLimits only end a worker
// gracefully when the heap creeps up; one large allocation past the limit (e.g. a
// 40 MB array) is a process-wide V8 fatal error that kills the server too
// (checked on Node 24). A child process's fatal OOM only ends the child.
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isNum, isStr, list, obj, prop, str } from '../kernel/guards.js';

/** @typedef {import('./jobs.js').Job} Job */
/** @typedef {import('./jobs.js').JobContext} JobContext */
/** @typedef {import('./jobs.js').RunnerInfo} RunnerInfo */
/** @typedef {Record<string, string | undefined>} Env */
/**
 * @typedef {object} IsolationOptions
 * @property {string} [runner] module URL exporting createJobRunner({ env, repoRoot, config }) -> { run(job, ctx) }
 * @property {Env} [env] the child's whole environment
 * @property {string | null} [repoRoot]
 * @property {Record<string, unknown>} [config]
 * @property {number} [heapMb]
 * @property {number} [timeoutMs]
 * @property {boolean} [forwardStderr]
 */

const ENTRY = fileURLToPath(new URL('./job-worker.mjs', import.meta.url));
export const DEFAULT_RUNNER = new URL('./job-runner.mjs', import.meta.url).href;
// 1 GB of old-generation heap per job: an offline create job ends with ~20-50 MB
// of heap and peaks at ~250 MB RSS (Node 24, M-series Mac; each run reports its own
// in job_done / runs.jsonl: runner.memory), and two concurrent jobs plus the server
// stay well inside a laptop's memory. 15 min covers a create with model calls,
// detail patches and a gap experiment. No numeric budget is implied beyond these limits.
export const ISOLATION_DEFAULTS = Object.freeze({ heapMb: 1024, timeoutMs: 15 * 60 * 1000 });
const TAIL = 4096;

/**
 * Limits from options, else V2_JOB_HEAP_MB / V2_JOB_TIMEOUT_MS, else the defaults.
 * @param {Env} [env] @param {{ heapMb?: unknown, timeoutMs?: unknown }} [options] @returns {{ heapMb: number, timeoutMs: number }}
 */
export function isolationLimits(env = {}, { heapMb, timeoutMs } = {}) {
  /** @param {unknown} v @param {number} fallback */
  const num = (v, fallback) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : fallback);
  return { heapMb: num(heapMb ?? env.V2_JOB_HEAP_MB, ISOLATION_DEFAULTS.heapMb), timeoutMs: num(timeoutMs ?? env.V2_JOB_TIMEOUT_MS, ISOLATION_DEFAULTS.timeoutMs) };
}

/** @param {Env} env @returns {Record<string, string>} */
const stringEnv = env => Object.fromEntries(Object.entries(env || {}).filter(/** @returns {e is [string, string]} */ e => typeof e[1] === 'string'));
/** @param {string} message @param {string} code @param {Record<string, unknown>} [extra] */
const runError = (message, code, extra = {}) => Object.assign(Error(message), { code, ...extra });
/** @param {number} ms */
const seconds = ms => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
/** @param {unknown} error */
const replyError = error => { const e = obj(error); return { message: String(e.message || error), ...(e.status ? { status: e.status } : {}), ...(e.code ? { code: String(e.code) } : {}) }; };

/**
 * A store call from the child, its arguments narrowed (the child is another process: its messages are data).
 * @param {JobContext['store']} store @param {string} method @param {unknown[]} args @returns {Promise<unknown>}
 */
function storeCall(store, method, [id, a, b]) {
  switch (method) {
    case 'updateMeta': return store.updateMeta(str(id), obj(a));
    case 'version': return store.version(str(id), Number(a));
    case 'latest': return store.latest(str(id));
    case 'meta': return store.meta(str(id));
    case 'saveAsset':
      if (!isStr(b) && !(b instanceof Uint8Array)) throw Error('saveAsset needs the asset bytes');
      return store.saveAsset(str(id), str(a), b);
    case 'asset': return store.asset(str(id), str(a));
    default: throw Error(`unknown store call ${method}`);
  }
}

/**
 * createIsolatedPipeline({ runner?, env, repoRoot, config, heapMb?, timeoutMs?, forwardStderr? }) -> (job, ctx) => Promise.
 * `runner` is a module URL exporting createJobRunner({ env, repoRoot, config }) -> { run(job, ctx) }.
 * `env` becomes the child's whole environment. Sets job.runner = { isolation, heapMb, timeoutMs,
 * startMs, setupMs, memory } for the job's timing report.
 * @param {IsolationOptions} [options]
 */
export function createIsolatedPipeline({ runner = DEFAULT_RUNNER, env = {}, repoRoot = null, config = {}, heapMb, timeoutMs, forwardStderr = true } = {}) {
  const limits = isolationLimits(env, { heapMb, timeoutMs });
  const childEnv = stringEnv(env);
  /** @param {Job} job @param {JobContext} ctx @returns {Promise<void>} */
  const pipeline = (job, ctx) => new Promise((resolve, reject) => {
    const spawned = performance.now();
    // startMs: fork until the runner is ready (process start + setupMs); setupMs: the child's module load + runner build (catalogue, clients).
    /** @type {RunnerInfo} */
    const info = job.runner = { isolation: 'process', heapMb: limits.heapMb, timeoutMs: limits.timeoutMs, startMs: null, setupMs: null, memory: null };
    const { stages, checkpoints, runner: _r, ...plainJob } = job;
    const child = fork(ENTRY, [], {
      env: childEnv, serialization: 'advanced', stdio: ['ignore', 'inherit', 'pipe', 'ipc'],
      execArgv: [`--max-old-space-size=${limits.heapMb}`],
    });
    // The child's stderr passes through; its tail and V8's fatal-error line are kept for the failure record
    // (the native stack trace V8 prints after that line is longer than the tail).
    /** @type {string | null} */
    let fatal = null;
    let stderr = '';
    child.stderr?.on('data', chunk => {
      if (forwardStderr) process.stderr.write(chunk);
      const text = stderr + chunk;
      fatal ??= text.match(/FATAL ERROR:[^\n]*/)?.[0] ?? null;
      stderr = text.slice(-TAIL);
    });
    /** @type {Set<Promise<void>>} */
    const calls = new Set();
    let finished = false;
    /** @param {import('node:child_process').Serializable} message */
    const send = message => { if (!finished && child.connected) child.send(message, () => {}); };
    /** @param {Error | null} error */
    const finish = async error => {
      if (finished) return; finished = true;
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      // Store writes the child asked for finish before the job's outcome is recorded (updateMeta is read-modify-write).
      await Promise.allSettled([...calls]);
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() => finish(runError(`The build took longer than ${seconds(limits.timeoutMs)} and was stopped. Versions already published are still playable.`, 'job_timeout')), limits.timeoutMs);
    /** @param {unknown} id @param {string} method @param {unknown[]} args */
    const answer = async (id, method, args) => {
      try {
        let value;
        if (method === 'publish') {
          const p = obj(args[0]), report = obj(p.report);
          value = await ctx.publish({ ...p, doc: p.doc, stage: str(p.stage), report: { ...report, timings: { ...obj(report.timings), jobStartMs: info.startMs, jobSetupMs: info.setupMs } }, provenance: { ...obj(p.provenance), runner: { isolation: 'process', heapMb: limits.heapMb, timeoutMs: limits.timeoutMs } } });
        } else value = await storeCall(ctx.store, method, args);
        send({ type: 'reply', id, ok: true, value });
      } catch (error) { send({ type: 'reply', id, ok: false, error: replyError(error) }); }
    };
    child.on('message', received => {
      if (finished) return;
      const message = obj(received);
      switch (message.type) {
        case 'stage': ctx.stage(str(message.name), obj(message.detail)); break;
        case 'draft': ctx.draft?.(obj(message.data)); break;
        case 'checkpoint': ctx.checkpoint?.(str(message.name), message.value); break;
        case 'ready': info.setupMs = isNum(message.setupMs) ? message.setupMs : null; info.startMs = Math.round(performance.now() - spawned); break;
        case 'call': { const p = answer(message.id, str(message.method), list(message.args)); calls.add(p); p.finally(() => calls.delete(p)); break; }
        case 'done': info.memory = message.memory || null; finish(null); break;
        case 'failed': info.memory = message.memory || null; finish(Object.assign(Error(str(prop(message.error, 'message')) || 'The build failed.'), obj(message.error))); break;
        default: break;
      }
    });
    child.on('error', error => finish(runError(`The build could not run: ${String(error?.message || error).slice(0, 300)}`, 'job_crashed', { stack: error?.stack })));
    // 'close', not 'exit': it follows the last IPC message and the end of stderr.
    child.on('close', (code, signal) => {
      if (finished) return;
      if (/heap out of memory|heap limit/i.test(fatal || '')) finish(runError(`The build ran out of memory (over its ${limits.heapMb} MB limit) and was stopped. Versions already published are still playable.`, 'job_out_of_memory', { stack: [fatal, stderr.slice(-1500)].join('\n') }));
      else finish(runError(`The build stopped unexpectedly (exit ${code ?? signal}).`, 'job_crashed', { stack: [fatal, stderr.slice(-1500)].filter(Boolean).join('\n') || null }));
    });
    send({ type: 'start', job: plainJob, runner, repoRoot, config });
  });
  pipeline.limits = { isolation: 'process', ...limits };
  return pipeline;
}
