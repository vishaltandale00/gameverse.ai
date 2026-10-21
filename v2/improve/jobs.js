// Promotion job store: one directory per job under local-data/v2/improve/<jobId>/ with an
// append-only events.jsonl, a report.json (the job record plus its timing report, rewritten on every
// change) and logs/. Failed and cancelled jobs are kept. Measurements follow AGENTS.md: a value that
// was not measured is null and named in `unavailable` with the reason; it is never recorded as zero.
import { mkdirSync, appendFileSync, writeFileSync, readFileSync, readdirSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

export const JOB_SCHEMA = 'gameverse.v2.improve-job/0.1';
export const REPORT_SCHEMA = 'gameverse.v2.improve-report/0.1';
export const STATES = ['queued', 'preparing', 'coding', 'verifying', 'succeeded', 'failed', 'cancelled'];
export const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);
const NEXT = {
  queued: ['preparing', 'cancelled', 'failed'],
  preparing: ['coding', 'verifying', 'failed', 'cancelled'], // → verifying: the template target has no coding phase
  coding: ['verifying', 'failed', 'cancelled'],
  verifying: ['coding', 'succeeded', 'failed', 'cancelled'], // back to coding = a repair round
};

export const machineContext = () => {
  const cpus = os.cpus();
  return { platform: os.platform(), release: os.release(), arch: os.arch(), cpuModel: cpus[0]?.model || null, cpuCount: cpus.length || null,
    memoryGb: Math.round(os.totalmem() / 2 ** 30), node: process.version };
};

export function createJobStore(dir) {
  mkdirSync(dir, { recursive: true });
  const jobs = new Map();
  const jobDir = id => join(dir, id);
  const writeReport = job => {
    const file = join(jobDir(job.id), 'report.json'), tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ ...job, report: timingReport(job) }, null, 2));
    renameSync(tmp, file);
  };

  // Reload retained jobs. A job that was mid-flight when the host stopped is failed as interrupted, never resumed silently.
  for (const id of readdirSync(dir)) {
    const file = join(jobDir(id), 'report.json');
    if (!existsSync(file)) continue;
    try {
      const { report, ...job } = JSON.parse(readFileSync(file, 'utf8'));
      if (job.schema !== JOB_SCHEMA) continue;
      jobs.set(job.id, job);
      if (!TERMINAL.has(job.state)) {
        const at = Date.now();
        closePhase(job, at);
        Object.assign(job, { state: 'failed', outcome: 'failed', reason: 'interrupted: the host stopped while the job was running', finishedAt: at });
        appendFileSync(join(jobDir(id), 'events.jsonl'), JSON.stringify({ type: 'job_done', jobId: id, at, state: 'failed', reason: job.reason }) + '\n');
        writeReport(job);
      }
    } catch { /* an unreadable job dir is left as is */ }
  }

  return {
    dir, jobDir,
    logDir(id) { const d = join(jobDir(id), 'logs'); mkdirSync(d, { recursive: true }); return d; },
    create(job) {
      mkdirSync(jobDir(job.id), { recursive: true });
      jobs.set(job.id, job);
      writeReport(job);
      return job;
    },
    get: id => jobs.get(id) || null,
    all: () => [...jobs.values()].sort((a, b) => a.createdAt - b.createdAt),
    save: job => writeReport(job),
    append(id, event) { appendFileSync(join(jobDir(id), 'events.jsonl'), JSON.stringify(event) + '\n'); },
    events(id) {
      const file = join(jobDir(id), 'events.jsonl');
      return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
    },
  };
}

export function newJob({ id, now, experiment, codeSha256, kitId, kitVersion, gameId, gameVersion, userId, target, modId, config, runner }) {
  return {
    schema: JOB_SCHEMA, id, state: 'queued', target, kitId, kitVersion, gameId, gameVersion: gameVersion ?? null, userId: userId ?? null,
    experiment: { id: experiment.id ?? null, label: experiment.label ?? null, request: experiment.request ?? null, codeSha256 },
    modId, branch: `improve/${id}`,
    createdAt: now, startedAt: null, finishedAt: null,
    phases: [{ name: 'queued', attempt: null, startedAt: now, endedAt: null }],
    attempts: [], outcome: null, reason: null, cancelRequested: false,
    result: null, applied: null,
    context: { sourceCommit: null, config, runner, machine: machineContext(), toolchain: null },
  };
}

function closePhase(job, at) {
  const open = job.phases.at(-1);
  if (open && open.endedAt == null) open.endedAt = at;
}

/** Move a job to a new state, closing the open phase and opening the next one. Throws on an illegal transition. */
export function transition(job, state, at, { attempt = null } = {}) {
  if (!(NEXT[job.state] || []).includes(state)) throw Error(`illegal job transition ${job.state} -> ${state}`);
  closePhase(job, at);
  job.state = state;
  if (job.startedAt == null && state === 'preparing') job.startedAt = at;
  if (TERMINAL.has(state)) { job.finishedAt = at; job.outcome = state; }
  else job.phases.push({ name: state, attempt, startedAt: at, endedAt: null });
  return job;
}

const sum = list => list.reduce((a, p) => a + (p.endedAt - p.startedAt), 0);

/** The AGENTS.md timing record for one job. Phases are sequential: queue + preparing + coding + verifying ≈ total (no overlap). */
export function timingReport(job) {
  const unavailable = {};
  const phase = name => job.phases.filter(p => p.name === name && p.endedAt != null);
  const measure = (key, list, reason) => {
    if (list.length) return sum(list);
    unavailable[key] = reason; return null;
  };
  const reached = name => job.phases.some(p => p.name === name);
  const why = name => reached(name) ? `${name} still running` : `the job ${TERMINAL.has(job.state) ? 'ended' : 'has not yet reached'} before ${name}`;
  const queueMs = measure('queueMs', phase('queued'), 'still queued');
  const preparingMs = measure('preparingMs', phase('preparing'), why('preparing'));
  const codingMs = measure('codingMs', phase('coding'), job.target === 'template' ? 'the template target has no coding phase' : why('coding'));
  const verifyingMs = measure('verifyingMs', phase('verifying'), why('verifying'));
  let totalMs = null;
  if (job.finishedAt != null) totalMs = job.finishedAt - job.createdAt; else unavailable.totalMs = 'job not finished';
  let runMs = null;
  if (job.finishedAt != null && job.startedAt != null) runMs = job.finishedAt - job.startedAt; else unavailable.runMs = job.startedAt == null ? 'job never left the queue' : 'job not finished';
  const coded = job.attempts.filter(a => a.coding);
  const costs = coded.map(a => a.coding.costUsd).filter(Number.isFinite);
  const turns = coded.map(a => a.coding.turns).filter(Number.isFinite);
  if (!costs.length) unavailable.reportedCostUsd = coded.length ? 'the runner did not report cost' : 'no agent attempt ran';
  if (!turns.length) unavailable.agentTurns = coded.length ? 'the runner did not report turns' : 'no agent attempt ran';
  if (!job.context.sourceCommit) unavailable.sourceCommit = 'not resolved before the job ended';
  if (job.gameVersion == null) unavailable.gameVersion = 'not provided by the caller';
  if (!job.context.toolchain) unavailable.toolchain = job.startedAt == null ? 'the job never started' : 'the runner did not describe its toolchain';
  return {
    schema: REPORT_SCHEMA,
    runId: job.id, outcome: job.outcome, state: job.state, reason: job.reason,
    queueMs, preparingMs, codingMs, verifyingMs, runMs, totalMs,
    nesting: 'queueMs + runMs = totalMs; runMs = preparingMs + codingMs + verifyingMs (+ cleanup/commit not separately timed); coding and verifying sum every attempt',
    attempts: job.attempts.length,
    repairs: Math.max(0, job.attempts.length - 1),
    agentTurns: turns.length ? turns.reduce((a, b) => a + b, 0) : null,
    reportedCostUsd: costs.length ? Math.round(costs.reduce((a, b) => a + b, 0) * 1e4) / 1e4 : null,
    perAttempt: job.attempts.map(a => ({ n: a.n, kind: a.kind, codingMs: a.coding?.ms ?? null, verifyMs: a.verify?.ms ?? null, ok: a.verify?.ok ?? null,
      checks: (a.verify?.checks || []).map(c => ({ id: c.id, ok: c.ok, ms: c.ms })) })),
    filesChanged: job.result?.files?.map(f => f.path) ?? null,
    diffstat: job.result?.diffstat ?? null,
    sourceCommit: job.context.sourceCommit, kitId: job.kitId, kitVersion: job.kitVersion, gameId: job.gameId, gameVersion: job.gameVersion,
    loopConfig: { id: job.context.config.id, version: job.context.config.version },
    runner: job.context.runner, machine: job.context.machine, toolchain: job.context.toolchain,
    unavailable,
  };
}
