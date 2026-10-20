// Generation jobs and the event stream the UI listens to. A job runs a staged
// pipeline; each stage reports progress and may publish a playable version.
// Events: job_started, stage, version, job_done, job_failed (per game id).
// The pipeline may run in-process or in a supervised worker (isolate.js); either
// way every store write happens here. A failed job keeps a failure record
// (failed-<n>.json) with what is needed to reproduce it, and every run, failed
// or not, appends a timing line to runs.jsonl (AGENTS.md: retain failed runs).

/** An error as a plain record: message, status, code and the first 20 stack frames. */
export const serializeError = error => ({
  message: String(error?.message || error),
  ...(error?.status ? { status: error.status } : {}),
  ...(error?.code ? { code: String(error.code) } : {}),
  stack: typeof error?.stack === 'string' ? error.stack.split('\n').slice(0, 21).join('\n') : null,
});

export function createJobs({ store, pipeline, maxConcurrent = 2 }) {
  const listeners = new Set(); // (event) => void
  const running = new Map();   // gameId -> job
  const queue = [];
  const broadcast = event => { const e = { at: Date.now(), ...event }; for (const fn of listeners) { try { fn(e); } catch {} } };
  const limits = pipeline.limits || { isolation: 'in-process' };

  async function run(job) {
    running.set(job.gameId, job);
    job.queuedMs = Date.now() - job.submittedAt; // queue time, kept apart from execution (AGENTS.md)
    const started = performance.now();
    const published = [];
    broadcast({ type: 'job_started', gameId: job.gameId, jobId: job.id, prompt: job.prompt, queuedMs: job.queuedMs, runner: limits });
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
      const next = queue.shift(); if (next) run(next);
    }
  }

  return {
    limits,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    running: () => [...running.values()].map(j => ({ gameId: j.gameId, jobId: j.id, stages: j.stages })),
    submit(job) {
      const full = { id: `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, stages: [], ...job, checkpoints: {}, submittedAt: Date.now() };
      if (running.size < maxConcurrent) run(full); else { queue.push(full); broadcast({ type: 'queued', gameId: full.gameId, jobId: full.id, position: queue.length }); }
      return full;
    },
  };
}

/** Attach an SSE stream at res; filters to one game when gameId is given. */
export function streamEvents(jobs, req, res, gameId = null) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.write(`event: hello\ndata: ${JSON.stringify({ running: jobs.running() })}\n\n`);
  const unsubscribe = jobs.subscribe(event => { if (!gameId || event.gameId === gameId) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`); });
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => { clearInterval(ping); unsubscribe(); });
}
