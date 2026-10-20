// Generation jobs and the event stream the UI listens to. A job runs a staged
// pipeline; each stage reports progress and may publish a playable version.
// Events: job_started, stage, version, job_done, job_failed (per game id).
export function createJobs({ store, pipeline, maxConcurrent = 2 }) {
  const listeners = new Set(); // (event) => void
  const running = new Map();   // gameId -> job
  const queue = [];
  const broadcast = event => { const e = { at: Date.now(), ...event }; for (const fn of listeners) { try { fn(e); } catch {} } };

  async function run(job) {
    running.set(job.gameId, job);
    job.queuedMs = Date.now() - job.submittedAt; // queue time, kept apart from execution (AGENTS.md)
    const started = performance.now();
    broadcast({ type: 'job_started', gameId: job.gameId, jobId: job.id, prompt: job.prompt, queuedMs: job.queuedMs });
    const ctx = {
      job, store,
      stage(name, detail = {}) { job.stages.push({ name, at: Math.round(performance.now() - started), ...detail }); broadcast({ type: 'stage', gameId: job.gameId, jobId: job.id, stage: name, ...detail, ms: Math.round(performance.now() - started) }); },
      /** Live preview of work in progress (e.g. a partially written level). */
      draft(data) { broadcast({ type: 'draft', gameId: job.gameId, jobId: job.id, ms: Math.round(performance.now() - started), ...data }); },
      async publish(payload) {
        const record = await store.publish(job.gameId, payload);
        broadcast({ type: 'version', gameId: job.gameId, jobId: job.id, version: record.version, stage: payload.stage, ms: Math.round(performance.now() - started), report: record.report });
        return record;
      },
      /** Live preview of work in progress (e.g. a partially written level). */
    };
    try {
      await pipeline(job, ctx);
      await store.updateMeta(job.gameId, { status: 'ready', error: null });
      broadcast({ type: 'job_done', gameId: job.gameId, jobId: job.id, ms: Math.round(performance.now() - started) });
    } catch (error) {
      await store.updateMeta(job.gameId, { status: 'failed', error: String(error?.message || error) }).catch(() => {});
      broadcast({ type: 'job_failed', gameId: job.gameId, jobId: job.id, error: String(error?.message || error) });
    } finally {
      running.delete(job.gameId);
      const next = queue.shift(); if (next) run(next);
    }
  }

  return {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    running: () => [...running.values()].map(j => ({ gameId: j.gameId, jobId: j.id, stages: j.stages })),
    submit(job) {
      const full = { id: `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, stages: [], ...job, submittedAt: Date.now() };
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
