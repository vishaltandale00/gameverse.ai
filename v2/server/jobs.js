// @ts-check
// Generation jobs and the event stream the UI listens to. A job runs a staged
// pipeline; each stage reports progress and may publish a playable version.
// Events: job_started, stage, version, job_done, job_failed (per game id).
// The pipeline may run in-process or in a supervised worker (isolate.js); either
// way every store write happens here. A failed job keeps a failure record
// (failed-<n>.json) with what is needed to reproduce it, and every run, failed
// or not, appends a timing line to runs.jsonl (AGENTS.md: retain failed runs).

import { isList, isNum, isStr, obj, objects, str } from '../kernel/guards.js';

/** @typedef {import('./store.js').Store} Store */
/** @typedef {import('./store.js').PublishPayload} PublishPayload */
/** @typedef {import('./store.js').VersionRecord} VersionRecord */
/** @typedef {{ question: string, answer: string }} Answer */
/**
 * What a route submits: the game, the kind of job ('create' | 'revise' | 'experiment' | 'experiment-remove')
 * and that kind's inputs.
 * @typedef {object} JobInput
 * @property {string} gameId
 * @property {string} kind
 * @property {string} [prompt]
 * @property {string} [change]
 * @property {number} [base] the version a revise starts from
 * @property {number} [seed]
 * @property {Answer[]} [answers]
 * @property {unknown} [pick] a create job answering the template pick's question: the pick that asked it (from the asking job's
 *   failure record; untyped until the pipeline checks it like a model answer, templates.js checkPick)
 * @property {string} [experimentId]
 * @property {number} [submittedAt]
 */
/** A submitted job as a pipeline sees it (and as it crosses into a job process). @typedef {JobInput & { id: string, submittedAt?: number, queuedMs?: number }} JobSpec */
/** @typedef {{ name: string, at: number } & Record<string, unknown>} JobStage */
/** Where jobs run: 'in-process', or 'process' with its limits (isolate.js). @typedef {{ isolation: string, heapMb?: number, timeoutMs?: number }} RunnerLimits */
/** @typedef {RunnerLimits & { startMs: number | null, setupMs: number | null, memory: unknown }} RunnerInfo */
/** @typedef {JobSpec & { stages: JobStage[], checkpoints: Record<string, unknown>, submittedAt: number, runner?: RunnerInfo }} Job */
/**
 * The store calls a job may make. Values come back from disk (or across a process boundary) as `unknown`.
 * @typedef {object} JobStore
 * @property {(id: string, patch: Record<string, unknown>) => Promise<unknown>} updateMeta
 * @property {(id: string, version: number) => Promise<unknown>} version
 * @property {(id: string) => Promise<unknown>} latest
 * @property {(id: string) => Promise<unknown>} meta
 * @property {(id: string, name: string, bytes: string | Uint8Array) => Promise<unknown>} saveAsset
 * @property {(id: string, name: string) => Promise<unknown>} asset
 */
/**
 * What a pipeline gets besides its job: progress reports, a publish and the store.
 * @typedef {object} JobContext
 * @property {JobSpec} job
 * @property {(name: string, detail?: Record<string, unknown>) => void} stage
 * @property {(data: Record<string, unknown>) => void} [draft] live preview of work in progress
 * @property {(name: string, value: unknown) => void} [checkpoint] intermediate results kept to explain a failure
 * @property {(payload: PublishPayload) => Promise<unknown>} publish
 * @property {JobStore} store
 */
/** @typedef {((job: Job, ctx: JobContext) => Promise<unknown>) & { limits?: RunnerLimits }} Pipeline */
/** @typedef {{ type: string, at: number, gameId?: string } & Record<string, unknown>} JobEvent */
/** @typedef {{ message: string, status?: unknown, code?: string, stack: string | null }} SerializedError */

/** An error as a plain record: message, status, code and the first 20 stack frames. @param {unknown} error @returns {SerializedError} */
export const serializeError = error => {
  const e = obj(error);
  return {
    message: String(e.message || error),
    ...(e.status ? { status: e.status } : {}),
    ...(e.code ? { code: String(e.code) } : {}),
    stack: typeof e.stack === 'string' ? e.stack.split('\n').slice(0, 21).join('\n') : null,
  };
};

/**
 * A job as it arrives in a job process (job-worker.mjs): narrowed field by field.
 * @param {unknown} value @returns {JobSpec}
 */
export function jobSpecOf(value) {
  const o = obj(value);
  return {
    id: str(o.id), gameId: str(o.gameId), kind: str(o.kind),
    ...(isStr(o.prompt) ? { prompt: o.prompt } : {}),
    ...(isStr(o.change) ? { change: o.change } : {}),
    ...(isNum(o.base) ? { base: o.base } : {}),
    ...(isNum(o.seed) ? { seed: o.seed } : {}),
    ...(isList(o.answers) ? { answers: objects(o.answers).map(a => ({ question: str(a.question), answer: str(a.answer) })) } : {}),
    ...(o.pick !== undefined ? { pick: o.pick } : {}),
    ...(isStr(o.experimentId) ? { experimentId: o.experimentId } : {}),
    ...(isNum(o.submittedAt) ? { submittedAt: o.submittedAt } : {}),
    ...(isNum(o.queuedMs) ? { queuedMs: o.queuedMs } : {}),
  };
}

/** @param {{ store: Store, pipeline: Pipeline, maxConcurrent?: number }} options */
export function createJobs({ store, pipeline, maxConcurrent = 2 }) {
  /** @type {Set<(event: JobEvent) => void>} */
  const listeners = new Set();
  /** @type {Map<string, Job>} gameId -> job */
  const running = new Map();
  /** @type {Job[]} */
  const queue = [];
  /** @param {{ type: string } & Record<string, unknown>} event */
  const broadcast = event => { const e = { at: Date.now(), ...event }; for (const fn of listeners) { try { fn(e); } catch {} } };
  /** @type {RunnerLimits} */
  const limits = pipeline.limits || { isolation: 'in-process' };

  /** @param {Job} job */
  async function run(job) {
    running.set(job.gameId, job);
    job.queuedMs = Date.now() - job.submittedAt; // queue time, kept apart from execution (AGENTS.md)
    const started = performance.now();
    /** @type {number[]} */
    const published = [];
    broadcast({ type: 'job_started', gameId: job.gameId, jobId: job.id, prompt: job.prompt, queuedMs: job.queuedMs, runner: limits });
    /** @type {JobContext} */
    const ctx = {
      job, store,
      stage(name, detail = {}) { job.stages.push({ name, at: Math.round(performance.now() - started), ...detail }); broadcast({ type: 'stage', gameId: job.gameId, jobId: job.id, stage: name, ...detail, ms: Math.round(performance.now() - started) }); },
      /** Live preview of work in progress (e.g. a partially written level). */
      draft(data) { broadcast({ type: 'draft', gameId: job.gameId, jobId: job.id, ms: Math.round(performance.now() - started), ...data }); },
      /** Intermediate results (decomposition, selection, outline, provenance) kept only to explain a failure. */
      checkpoint(name, value) { job.checkpoints[name] = value; },
      async publish(payload) {
        const record = await store.publish(job.gameId, payload);
        published.push(record.version);
        broadcast({ type: 'version', gameId: job.gameId, jobId: job.id, version: record.version, stage: payload.stage, ms: Math.round(performance.now() - started), report: record.report });
        return record;
      },
    };
    /** @param {Record<string, unknown>} extra */
    const runRecord = extra => ({ jobId: job.id, kind: job.kind, at: new Date().toISOString(), queuedMs: job.queuedMs, ms: Math.round(performance.now() - started), published, runner: job.runner || limits, ...extra });
    try {
      await pipeline(job, ctx);
      await store.updateMeta(job.gameId, { status: 'ready', error: null, errorCode: null });
      await store.appendRun(job.gameId, runRecord({ outcome: 'done' })).catch(() => {});
      broadcast({ type: 'job_done', gameId: job.gameId, jobId: job.id, ms: Math.round(performance.now() - started), runner: job.runner || limits });
    } catch (error) {
      const err = serializeError(error);
      const stageReached = job.stages.at(-1)?.name ?? null;
      let failure = null;
      try {
        failure = await store.recordFailure(job.gameId, {
          gameId: job.gameId, jobId: job.id, kind: job.kind, prompt: job.prompt ?? null, change: job.change ?? null, base: job.base ?? null, seed: job.seed ?? null, answers: job.answers ?? [],
          at: new Date().toISOString(), stageReached, error: err, published, queuedMs: job.queuedMs, ms: Math.round(performance.now() - started), runner: job.runner || limits,
          stages: job.stages, ...job.checkpoints,
        });
      } catch {}
      await store.updateMeta(job.gameId, { status: 'failed', error: err.message, errorCode: err.code || null, ...(failure ? { lastFailure: failure } : {}) }).catch(() => {});
      await store.appendRun(job.gameId, runRecord({ outcome: 'failed', code: err.code || null, error: err.message.slice(0, 300), stageReached, failure })).catch(() => {});
      broadcast({ type: 'job_failed', gameId: job.gameId, jobId: job.id, error: err.message, code: err.code || null, stage: stageReached, failure });
    } finally {
      job.checkpoints = {};
      running.delete(job.gameId);
      // The next queued job whose game has none running: one game's jobs run one at a time, in order, so each builds
      // on the versions the one before it published (never two versions made from the same base, the later one
      // silently dropping the earlier one's change).
      const i = queue.findIndex(j => !running.has(j.gameId));
      if (i >= 0) run(queue.splice(i, 1)[0]);
    }
  }

  return {
    limits,
    /** @param {(event: JobEvent) => void} fn */
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    running: () => [...running.values()].map(j => ({ gameId: j.gameId, jobId: j.id, stages: j.stages })),
    /** @param {JobInput} job @returns {Job} */
    submit(job) {
      /** @type {Job} */
      const full = { id: `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, stages: [], ...job, checkpoints: {}, submittedAt: Date.now() };
      if (running.size < maxConcurrent && !running.has(full.gameId) && !queue.some(j => j.gameId === full.gameId)) run(full);
      else { queue.push(full); broadcast({ type: 'queued', gameId: full.gameId, jobId: full.id, position: queue.length }); }
      return full;
    },
  };
}

/** Attach an SSE stream at res; filters to one game when gameId is given. */
/**
 * @param {ReturnType<typeof createJobs>} jobs @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res @param {string | null} [gameId]
 */
export function streamEvents(jobs, req, res, gameId = null) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.write(`event: hello\ndata: ${JSON.stringify({ running: jobs.running() })}\n\n`);
  const unsubscribe = jobs.subscribe(event => { if (!gameId || event.gameId === gameId) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`); });
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => { clearInterval(ping); unsubscribe(); });
}
