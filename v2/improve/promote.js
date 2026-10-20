// Tier-4 promotion service (v2/kits/EXTENDING.md): a background job turns a sandboxed experiment into
// a native, tested mod. The runner codes; the job verifies (scope gate + its own commands) and decides.
// Results are a branch improve/<jobId> plus a report; nothing is applied without an explicit apply().
import { EventEmitter } from 'node:events';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveConfig, configRef } from './config.js';
import { createJobStore, newJob, transition, timingReport, TERMINAL } from './jobs.js';
import { buildPrompt, repairPrompt, modPaths } from './prompt.js';
import { fastForward } from './runners/git.js';
import { redact } from './runners/proc.js';
import { availableKits, loadKit } from '../kits/registry.js';
import { MODS } from '../kits/mods/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const CHECKER = join(HERE, 'check-mod.mjs');
const ID = /^[a-z0-9][a-z0-9-]{3,63}$/;
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '').slice(0, 32).replace(/-+$/, '');

/** Scope gate over the change list: allowed paths, add-only outside `modifiable`, and the required deliverables. */
export function scopeCheck(files, scope, modId) {
  const problems = [], outside = [];
  const p = modPaths(modId);
  for (const f of files) {
    const inside = scope.allowedPrefixes.some(prefix => f.path.startsWith(prefix));
    if (!inside) { outside.push(f.path); if (!scope.allowOutside) { problems.push(`${f.path}: outside the allowed paths (${scope.allowedPrefixes.join(', ')})`); continue; } }
    if (f.status !== 'A' && !scope.modifiable.includes(f.path)) problems.push(`${f.path}: ${f.status === 'D' ? 'deletes' : 'modifies'} an existing file; only ${scope.modifiable.join(', ')} may be changed, everything else may only be added`);
  }
  const has = (path, status) => files.some(f => f.path === path && (!status || f.status === status));
  if (!has(p.mod, 'A')) problems.push(`missing deliverable: new file ${p.mod}`);
  if (!has(p.test, 'A')) problems.push(`missing deliverable: new file ${p.test}`);
  if (!has(p.index)) problems.push(`missing deliverable: register the mod in ${p.index}`);
  return { ok: !problems.length, problems, outside };
}

const substitute = (argv, vars) => argv.map(a => a.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)));
const tail = (s, n) => { s = String(s || ''); return s.length > n ? '…' + s.slice(-n) : s; };

export function createImprovementService({ root, runner, config: overrides = {}, dataDir = null } = {}) {
  if (!root) throw Error('improvement service: root (the git checkout) is required');
  if (!runner) throw Error('improvement service: a runner is required');
  const config = resolveConfig({ runner: runner.id, ...overrides });
  const L = config.limits;
  const store = createJobStore(dataDir || join(root, 'local-data/v2/improve'));
  const events = new EventEmitter();
  const active = new Map(); // jobId -> { ac }
  const waiters = new Map(); // jobId -> [resolve]
  let described = null;

  const emit = (job, type, data = {}, persist = true) => {
    const e = { type, jobId: job.id, gameId: job.gameId, userId: job.userId, at: Date.now(), ...data };
    if (persist) store.append(job.id, e);
    events.emit('event', e); events.emit(type, e);
    return e;
  };
  const view = job => job && {
    id: job.id, state: job.state, target: job.target, kitId: job.kitId, kitVersion: job.kitVersion, gameId: job.gameId, gameVersion: job.gameVersion,
    userId: job.userId, modId: job.modId, experiment: job.experiment,
    createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt,
    outcome: job.outcome, reason: job.reason, cancelRequested: job.cancelRequested,
    queuePosition: job.state === 'queued' ? store.all().filter(j => j.state === 'queued').findIndex(j => j.id === job.id) + 1 : null,
    attempts: job.attempts.map(a => ({ n: a.n, kind: a.kind, coding: a.coding, verify: a.verify && { ok: a.verify.ok, ms: a.verify.ms, checks: a.verify.checks } })),
    result: job.result, applied: job.applied,
    report: timingReport(job),
    logs: { dir: store.logDir(job.id), events: join(store.jobDir(job.id), 'events.jsonl'), report: join(store.jobDir(job.id), 'report.json') },
  };
  const move = (job, state, opts) => { transition(job, state, Date.now(), opts); store.save(job); emit(job, 'improve_state', { state, attempt: opts?.attempt ?? null }); };
  const finish = (job, state, reason) => {
    if (TERMINAL.has(job.state)) return;
    if (job.state === 'queued' && state !== 'cancelled' && state !== 'failed') state = 'failed';
    transition(job, state, Date.now());
    job.reason = reason ?? null;
    store.save(job);
    emit(job, 'improve_done', { state, outcome: job.outcome, reason: job.reason, report: timingReport(job) });
    for (const fn of waiters.get(job.id) || []) fn(view(job));
    waiters.delete(job.id);
  };

  // ---------- admission: one active job per user and per game, a global cap, FIFO otherwise ----------
  function admissible(job) {
    const running = [...active.keys()].map(id => store.get(id));
    if (running.length >= L.maxActiveJobs) return false;
    if (job.userId != null && running.filter(j => j.userId === job.userId).length >= L.maxActivePerUser) return false;
    return running.filter(j => j.gameId === job.gameId).length < L.maxActivePerGame;
  }
  function pump() {
    for (const job of store.all()) {
      if (job.state !== 'queued' || active.has(job.id) || !admissible(job)) continue;
      const ac = new AbortController();
      active.set(job.id, { ac });
      execute(job, ac).finally(() => { active.delete(job.id); pump(); });
    }
  }

  // ---------- one job ----------
  async function execute(job, ac) {
    const { signal } = ac;
    const deadline = setTimeout(() => ac.abort(Object.assign(Error(`job timeout after ${L.jobTimeoutMs} ms`), { code: 'timeout' })), L.jobTimeoutMs);
    let workspace = null, outcome = null, reason = null;
    const logs = store.logDir(job.id);
    try {
      move(job, 'preparing');
      described ??= await runner.describe?.(config).catch(() => null) ?? null;
      job.context.runner = { id: runner.id, version: runner.version };
      job.context.toolchain = described?.toolchain ?? null;
      workspace = await bounded(runner.prepare({ job, signal }), L.prepareTimeoutMs, 'preparing', ac);
      job.context.sourceCommit = workspace.base;
      store.save(job);
      const kits = (await availableKits()).map(({ kit }) => kit);
      const kit = kits.find(k => k.id === job.kitId);
      const experiment = experiments.get(job.id);
      const ref = rel => readFileSync(join(HERE, '..', rel), 'utf8');
      const firstPrompt = buildPrompt({ experiment, kitId: job.kitId, kit, kits, modId: job.modId, extending: ref('kits/EXTENDING.md'),
        weaponSource: ref('kits/mods/weapon.js'), composeSource: ref('kits/mods/compose.js'), scope: config.scope });
      writeFileSync(join(logs, 'prompt-0.txt'), firstPrompt);
      let session = null, feedback = null;
      for (let n = 0; n <= L.maxRepairAttempts; n++) {
        if (signal.aborted) throw signal.reason;
        const attempt = { n, kind: n ? 'repair' : 'initial', coding: null, verify: null };
        job.attempts.push(attempt);
        move(job, 'coding', { attempt: n });
        const resume = n > 0 && config.agent.resumeForRepairs && session;
        const prompt = n === 0 ? firstPrompt : repairPrompt({ attempt: n, maxRepairs: L.maxRepairAttempts, failures: feedback, modId: job.modId, kitId: job.kitId, scope: config.scope, fresh: !resume });
        if (n) writeFileSync(join(logs, `prompt-${n}.txt`), prompt);
        const started = Date.now();
        const coding = await runner.code({ workspace, job, prompt, attempt: n, config, resumeSession: resume ? session : null, signal,
          logFile: join(logs, `agent-${n}.jsonl`), onProgress: p => emit(job, 'improve_progress', { attempt: n, ...p }, false) });
        attempt.coding = { ms: Date.now() - started, exitCode: coding.exitCode ?? null, timedOut: !!coding.timedOut, turns: coding.turns ?? null, costUsd: coding.costUsd ?? null,
          subtype: coding.subtype ?? null, isError: coding.isError ?? null, model: coding.model ?? null, summary: coding.resultText ?? null };
        session = coding.sessionId || session;
        store.save(job);
        if (signal.aborted) throw signal.reason;
        if (!coding.completed && !coding.timedOut && (coding.spawnError || coding.exitCode !== 0)) {
          throw Object.assign(Error(`the agent did not run (exit ${coding.exitCode ?? coding.spawnError}): ${tail(redact(coding.stderrTail || ''), 400)}`), { code: 'agent' });
        }
        move(job, 'verifying', { attempt: n });
        attempt.verify = await verify(job, workspace, n, signal);
        store.save(job);
        if (signal.aborted) throw signal.reason;
        if (attempt.verify.ok) {
          const fin = await runner.finalize({ workspace, success: true, message: commitMessage(job) });
          workspace = null;
          job.result = { ...job.result, branch: fin.branch, commit: fin.commit };
          outcome = 'succeeded';
          return;
        }
        feedback = attempt.verify.feedback;
      }
      const last = job.attempts.at(-1).verify;
      const scopeFail = last.checks.find(c => c.id === 'scope' && !c.ok);
      outcome = 'failed';
      reason = scopeFail ? `refused: ${scopeFail.problems.join('; ')}` : `verification failed after ${job.attempts.length} attempt(s): ${last.checks.filter(c => !c.ok).map(c => c.id).join(', ')}`;
    } catch (error) {
      const cancelled = job.cancelRequested;
      outcome = cancelled ? 'cancelled' : 'failed';
      reason = cancelled ? 'cancelled' : error?.code === 'timeout' ? error.message : `${error?.message || error}`;
    } finally {
      clearTimeout(deadline);
      if (workspace) {
        try { await runner.finalize({ workspace, success: false }); }
        catch (error) { job.cleanupError = redact(String(error.message || error)).slice(0, 500); }
      }
      // A cancel that arrives after the job's commit leaves it succeeded: the branch stands, and apply() is explicit anyway.
      finish(job, outcome || 'failed', reason);
    }
  }

  async function bounded(promise, ms, what, ac) {
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { const e = Object.assign(Error(`${what} timed out after ${ms} ms`), { code: 'timeout' }); ac.abort(e); reject(e); }, ms); });
    // A workspace that arrives after the timeout is cleaned up rather than leaked.
    promise.then(ws => { if (ac.signal.aborted && ws) runner.finalize({ workspace: ws, success: false }).catch(() => {}); }, () => {});
    try { return await Promise.race([promise, timeout]); } finally { clearTimeout(timer); }
  }

  async function verify(job, workspace, n, signal) {
    const started = Date.now(), checks = [];
    const p = modPaths(job.modId);
    const changes = await runner.changes({ workspace });
    job.result = { branch: null, commit: null, files: changes.files, diffstat: changes.diffstat };
    writeFileSync(join(store.jobDir(job.id), 'changes.patch'), changes.patch || '');
    const scope = scopeCheck(changes.files, config.scope, job.modId);
    if (scope.outside.length && config.scope.allowOutside) job.result.outsideScopeAllowed = scope.outside;
    checks.push({ id: 'scope', ok: scope.ok, ms: Date.now() - started, problems: scope.problems });
    emit(job, 'improve_check', { attempt: n, id: 'scope', ok: scope.ok, ms: Date.now() - started, problems: scope.problems });
    const vars = { modTest: p.test, kitTest: config.kitTests[job.kitId] || config.kitTests.pattern.replace('{kitId}', job.kitId), kitId: job.kitId, modId: job.modId, checker: workspace.checker || CHECKER, workdir: workspace.dir || '.' };
    let output = '';
    // Out-of-scope or missing deliverables: nothing else runs (the scope gate refuses the result as it is).
    if (scope.ok) for (const cmd of config.verification) {
      if (signal.aborted) break;
      const argv = substitute(cmd.argv, vars);
      const res = await runner.exec({ workspace, argv, timeoutMs: L.verifyCommandTimeoutMs, signal });
      const ok = res.code === 0 && !res.timedOut && !res.aborted;
      const text = redact(`${res.stdout || ''}${res.stderr ? `\n[stderr]\n${res.stderr}` : ''}`);
      output += `\n===== ${cmd.id}: ${argv.join(' ')} → exit ${res.code}${res.timedOut ? ' (timed out)' : ''} in ${res.ms} ms\n${text}\n`;
      checks.push({ id: cmd.id, argv, ok, code: res.code ?? null, timedOut: !!res.timedOut, ms: res.ms ?? null, ...(ok ? {} : { tail: tail(text, 1500) }) });
      emit(job, 'improve_check', { attempt: n, id: cmd.id, ok, ms: res.ms ?? null });
    }
    writeFileSync(join(store.logDir(job.id), `verify-${n}.log`), output);
    const failed = checks.filter(c => !c.ok);
    const per = Math.max(400, Math.floor(L.maxFeedbackChars / Math.max(1, failed.length)));
    const feedback = failed.map(c => c.id === 'scope'
      ? `## scope: the result was refused\n${c.problems.map(x => `- ${x}`).join('\n')}\nRevert or move those changes.`
      : `## ${c.id} failed (exit ${c.code}${c.timedOut ? ', timed out' : ''})\n$ ${c.argv.join(' ')}\n${tail(c.tail, per)}`).join('\n\n');
    return { ok: !failed.length, ms: Date.now() - started, checks, feedback: feedback.slice(0, L.maxFeedbackChars + 200) };
  }

  const commitMessage = job => `Promote experiment ${JSON.stringify(job.experiment.label || job.experiment.id || 'experiment')} to the ${job.modId} mod\n\n` +
    `Improvement job ${job.id}; loop ${config.id}@${config.version}; runner ${runner.id}@${runner.version}; kit ${job.kitId}@${job.kitVersion}; base ${job.context.sourceCommit}.\n` +
    `Verified by the job: ${config.verification.map(c => c.id).join(', ')}.`;

  const experiments = new Map(); // the experiment code is kept in memory and in experiment.json, not in report.json

  return {
    config, events,
    /** The persisted events of one job (events.jsonl), oldest first. */
    eventsOf: id => (ID.test(String(id)) && store.get(id) ? store.events(id) : []),
    /** Subscribe to every event; returns an unsubscribe function. */
    subscribe(fn) { events.on('event', fn); return () => events.off('event', fn); },

    async start({ experiment, kitId, gameId, gameVersion = null, userId = null, target = 'mod', modId = null } = {}) {
      if (target !== 'mod') throw Error(`unsupported promotion target '${target}' (only 'mod')`);
      if (!experiment || typeof experiment.code !== 'string' || !experiment.code.trim()) throw Error('experiment.code is required');
      if (experiment.code.length > L.maxExperimentCodeChars) throw Error(`experiment code is over ${L.maxExperimentCodeChars} characters`);
      if (typeof gameId !== 'string' || !gameId) throw Error('gameId is required');
      const kit = await loadKit(kitId);
      if (!kit.world) throw Error(`kit '${kitId}' has no world adapter, so it cannot host mods`);
      if (store.all().filter(j => j.state === 'queued').length >= L.maxQueuedJobs) throw Error(`the promotion queue is full (${L.maxQueuedJobs})`);
      let id = modId ? slug(modId) : slug(experiment.id || experiment.label) || 'promoted';
      if (!/^[a-z]/.test(id)) id = `mod-${id}`;
      const taken = name => MODS.some(m => m.id === name) || existsSync(join(root, 'v2/kits/mods', `${name}.js`)) || store.all().some(j => j.modId === name && !['failed', 'cancelled'].includes(j.state));
      if (!modId) { const base = id; for (let i = 2; taken(id); i++) id = `${base}-${i}`; }
      else if (taken(id)) throw Error(`mod id '${id}' is already in use`);
      const jobId = `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(4).toString('hex')}`;
      const codeSha256 = createHash('sha256').update(experiment.code).digest('hex');
      const job = newJob({ id: jobId, now: Date.now(), experiment, codeSha256, kitId, kitVersion: kit.version, gameId, gameVersion, userId, target, modId: id,
        config: configRef(config), runner: { id: runner.id, version: runner.version } });
      store.create(job);
      writeFileSync(join(store.jobDir(jobId), 'experiment.json'), JSON.stringify({ id: experiment.id ?? null, label: experiment.label ?? null, request: experiment.request ?? null, code: experiment.code }, null, 2));
      experiments.set(jobId, { id: experiment.id, label: experiment.label, request: experiment.request, code: experiment.code });
      emit(job, 'improve_queued', { kitId, modId: id, position: store.all().filter(j => j.state === 'queued').length });
      pump();
      return view(job);
    },

    status: id => (ID.test(String(id)) ? view(store.get(id)) : null),
    list: ({ gameId = null, userId = null } = {}) => store.all().filter(j => (!gameId || j.gameId === gameId) && (!userId || j.userId === userId)).reverse().map(view),

    /** Resolves with the job view once it is succeeded, failed or cancelled. */
    wait(id) {
      const job = store.get(id);
      if (!job) return Promise.resolve(null);
      if (TERMINAL.has(job.state)) return Promise.resolve(view(job));
      return new Promise(resolve => waiters.set(id, [...(waiters.get(id) || []), resolve]));
    },

    cancel(id) {
      const job = ID.test(String(id)) ? store.get(id) : null;
      if (!job) return null;
      if (TERMINAL.has(job.state)) return view(job);
      job.cancelRequested = true;
      store.save(job);
      emit(job, 'improve_cancel_requested', { state: job.state });
      if (job.state === 'queued' && !active.has(job.id)) { finish(job, 'cancelled', 'cancelled before it started'); pump(); }
      else active.get(job.id)?.ac.abort(Object.assign(Error('cancelled'), { code: 'cancelled' }));
      return view(job);
    },

    /** Fast-forward the checkout's current branch to a succeeded job's branch. Explicit only; never pushes. */
    async apply(id) {
      const job = ID.test(String(id)) ? store.get(id) : null;
      if (!job) return { ok: false, reason: 'no such job' };
      if (job.state !== 'succeeded') return { ok: false, reason: `only a succeeded job can be applied (this one is ${job.state})` };
      if (job.applied) return { ok: false, reason: `already applied to ${job.applied.into} at ${job.applied.commit}` };
      if (!job.result?.branch) return { ok: false, reason: 'the job has no result branch' };
      const res = await fastForward(root, job.result.branch);
      if (!res.ok) { emit(job, 'improve_apply_refused', { reason: res.reason }); return res; }
      job.applied = { at: Date.now(), into: res.into, commit: res.commit };
      store.save(job);
      emit(job, 'improve_applied', { into: res.into, commit: res.commit });
      return { ok: true, into: res.into, commit: res.commit, job: view(job) };
    },
  };
}
