// Tier-4 promotion service (v2/kits/EXTENDING.md): a background job turns a sandboxed experiment into
// a native, tested mod. The runner codes; the job verifies (scope gate + its own commands) and decides.
// Results are a branch improve/<jobId> plus a report; nothing is applied without an explicit apply().
import { EventEmitter } from 'node:events';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveConfig, configRef } from './config.js';
import { createJobStore, newJob, transition, timingReport, TERMINAL } from './jobs.js';
import { buildPrompt, repairPrompt, modPaths, primitivePaths, primitiveSlug, buildPrimitivePrompt, primitiveRepairPrompt } from './prompt.js';
import { fastForward, headCommit } from './runners/git.js';
import { redact, run as runProcess, minimalEnv } from './runners/proc.js';
import { deriveTemplate, templatePaths, promotedFile, TEMPLATE_DERIVATION_VERSION } from './template.js';
import { TEMPLATES } from '../templates/registry.js';
import { ID_PATTERN, CONTRACT_VERSION } from '../templates/contract.js';
import { availableKits, loadKit } from '../kits/registry.js';
import { MODS } from '../kits/mods/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const CHECKER = join(HERE, 'check-mod.mjs');
export const PRIMITIVE_CHECKER = join(HERE, 'check-primitive.mjs');
export const TEMPLATE_CHECKER = join(HERE, 'check-template.mjs');
/** Writes a promoted template into the checkout (tests pass a fake: { write(relPath, text) }). */
export const fileWriter = root => ({ write(rel, text) { const file = join(root, rel); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); } });
const ID = /^[a-z0-9][a-z0-9-]{3,63}$/;
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '').slice(0, 32).replace(/-+$/, '');

/** Scope gate over the change list: allowed paths, add-only outside `modifiable`, and the required deliverables. */
export function scopeCheck(files, scope, modId, target = 'mod') {
  const problems = [], outside = [];
  const p = target === 'primitive' ? { ...primitivePaths(modId), mod: primitivePaths(modId).primitive } : modPaths(modId);
  for (const f of files) {
    const inside = scope.allowedPrefixes.some(prefix => f.path.startsWith(prefix));
    if (!inside) { outside.push(f.path); if (!scope.allowOutside) { problems.push(`${f.path}: outside the allowed paths (${scope.allowedPrefixes.join(', ')})`); continue; } }
    if (f.status !== 'A' && !scope.modifiable.includes(f.path)) problems.push(`${f.path}: ${f.status === 'D' ? 'deletes' : 'modifies'} an existing file; only ${scope.modifiable.join(', ')} may be changed, everything else may only be added`);
  }
  const has = (path, status) => files.some(f => f.path === path && (!status || f.status === status));
  if (!has(p.mod, 'A')) problems.push(`missing deliverable: new file ${p.mod}`);
  if (!has(p.test, 'A')) problems.push(`missing deliverable: new file ${p.test}`);
  if (!has(p.index)) problems.push(`missing deliverable: register the ${target === 'primitive' ? 'primitive' : 'mod'} in ${p.index}`);
  return { ok: !problems.length, problems, outside };
}

const substitute = (argv, vars) => argv.map(a => a.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)));
const tail = (s, n) => { s = String(s || ''); return s.length > n ? '…' + s.slice(-n) : s; };

export function createImprovementService({ root, runner, config: overrides = {}, dataDir = null, templateWriter = null } = {}) {
  if (!root) throw Error('improvement service: root (the git checkout) is required');
  if (!runner) throw Error('improvement service: a runner is required');
  const config = resolveConfig({ runner: runner.id, ...overrides });
  const L = config.limits;
  const writer = templateWriter || fileWriter(root);
  // What each target may touch and how the job checks it (the mod target keeps the original top-level config).
  const targetOf = job => (job.target === 'primitive' ? { scope: config.targets.primitive.scope, verification: config.targets.primitive.verification } : { scope: config.scope, verification: config.verification });
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
    userId: job.userId, modId: job.modId, primitiveId: job.primitiveId ?? null, templateId: job.templateId ?? null, experiment: job.experiment,
    createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt,
    outcome: job.outcome, reason: job.reason, cancelRequested: job.cancelRequested,
    queuePosition: job.state === 'queued' ? store.all().filter(j => j.state === 'queued').findIndex(j => j.id === job.id) + 1 : null,
    attempts: job.attempts.map(a => ({ n: a.n, kind: a.kind, coding: a.coding, verify: a.verify && { ok: a.verify.ok, ms: a.verify.ms, checks: a.verify.checks }, stoppedEarly: a.stoppedEarly ?? null })),
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
      (job.target === 'template' ? executeTemplate(job, ac) : execute(job, ac)).finally(() => { active.delete(job.id); pump(); });
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
      const experiment = experiments.get(job.id);
      const ref = rel => readFileSync(join(HERE, '..', rel), 'utf8');
      let firstPrompt;
      if (job.target === 'primitive') {
        const doc = experiment.doc || {};
        const gameSummary = { title: doc.title, spaces: (doc.spaces || []).map(s => s.use), systems: (doc.systems || []).map(s => s.use) };
        firstPrompt = buildPrimitivePrompt({ experiment, primitiveId: job.primitiveId, kernelApi: ref('KERNEL_API.md'), hostSource: ref('experiments/primitive-host.js'), scope: targetOf(job).scope, gameSummary });
      } else {
        const kits = (await availableKits()).map(({ kit }) => kit);
        const kit = kits.find(k => k.id === job.kitId);
        firstPrompt = buildPrompt({ experiment, kitId: job.kitId, kit, kits, modId: job.modId, extending: ref('kits/EXTENDING.md'),
          weaponSource: ref('kits/mods/weapon.js'), composeSource: ref('kits/mods/compose.js'), scope: config.scope });
      }
      writeFileSync(join(logs, 'prompt-0.txt'), firstPrompt);
      let session = null, feedback = null;
      for (let n = 0; n <= L.maxRepairAttempts; n++) {
        if (signal.aborted) throw signal.reason;
        const attempt = { n, kind: n ? 'repair' : 'initial', coding: null, verify: null };
        job.attempts.push(attempt);
        move(job, 'coding', { attempt: n });
        const resume = n > 0 && config.agent.resumeForRepairs && session;
        const prompt = n === 0 ? firstPrompt : job.target === 'primitive'
          ? primitiveRepairPrompt({ attempt: n, maxRepairs: L.maxRepairAttempts, failures: feedback, primitiveId: job.primitiveId, scope: targetOf(job).scope, fresh: !resume })
          : repairPrompt({ attempt: n, maxRepairs: L.maxRepairAttempts, failures: feedback, modId: job.modId, kitId: job.kitId, scope: config.scope, fresh: !resume });
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
        const previous = job.attempts.at(-2)?.verify;
        if (n > 0 && config.repair.stopWhenUnchanged && previous && previous.patchSha256 === attempt.verify.patchSha256) {
          attempt.stoppedEarly = 'the repair round left the diff unchanged';
          break;
        }
      }
      const last = job.attempts.at(-1).verify;
      const scopeFail = last.checks.find(c => c.id === 'scope' && !c.ok);
      outcome = 'failed';
      reason = scopeFail ? `refused: ${scopeFail.problems.join('; ')}` : `verification failed after ${job.attempts.length} attempt(s): ${last.checks.filter(c => !c.ok).map(c => c.id).join(', ')}${job.attempts.at(-1).stoppedEarly ? ` (stopped early: ${job.attempts.at(-1).stoppedEarly})` : ''}`;
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

  // ---------- target 'template': derive, run the contract in its own process, write on success ----------
  // queued → preparing (derive the template from the version) → verifying (check-template.mjs: the whole template
  // contract against the live catalogue) → succeeded (the promoted file written) | failed (the problems reported).
  async function executeTemplate(job, ac) {
    const { signal } = ac;
    const deadline = setTimeout(() => ac.abort(Object.assign(Error(`job timeout after ${L.jobTimeoutMs} ms`), { code: 'timeout' })), L.jobTimeoutMs);
    let outcome = null, reason = null;
    try {
      move(job, 'preparing');
      job.context.sourceCommit = await headCommit(root).catch(() => null);
      const input = templateInputs.get(job.id);
      const attempt = { n: 0, kind: 'initial', coding: null, verify: null };
      job.attempts.push(attempt);
      const derived = deriveTemplate({ doc: input.doc }, { id: job.templateId, registry: input.registry });
      if (!derived.template) {
        job.result = { problems: derived.problems };
        outcome = 'failed'; reason = `the version cannot be a template: ${derived.problems.map(p => `${p.code}: ${p.message}`).join('; ')}`;
        return;
      }
      if (signal.aborted) throw signal.reason;
      const candidate = join(store.jobDir(job.id), 'template.json');
      writeFileSync(candidate, JSON.stringify(derived.template));
      move(job, 'verifying', { attempt: 0 });
      const started = Date.now();
      const res = await runProcess([process.execPath, TEMPLATE_CHECKER, '--template', candidate], { cwd: HERE, env: minimalEnv(), timeoutMs: L.verifyCommandTimeoutMs, signal });
      writeFileSync(join(store.logDir(job.id), 'verify-0.log'), redact(`${res.stdout || ''}${res.stderr ? `\n[stderr]\n${res.stderr}` : ''}`));
      if (signal.aborted) throw signal.reason;
      let out = null;
      try { out = JSON.parse(String(res.stdout || '').trim().split('\n').at(-1)); } catch { out = null; }
      const ok = res.code === 0 && !res.timedOut && out?.ok === true;
      const problems = out?.problems ?? [{ code: res.timedOut ? 'check_timed_out' : 'check_crashed', message: res.timedOut ? `the contract did not finish in ${L.verifyCommandTimeoutMs} ms` : tail(redact(res.stderr || res.stdout || ''), 800) }];
      attempt.verify = { ok, ms: Date.now() - started, checks: [{ id: 'template-contract', ok, ms: res.ms ?? null, code: res.code ?? null, timedOut: !!res.timedOut, ...(ok ? {} : { problems: problems.map(p => `${p.code}: ${p.message}`.slice(0, 300)) }) }] };
      // The checked template: the derived one with the tune the checker proved (check-template.mjs provenTune).
      const checkedTemplate = out?.template ?? derived.template;
      job.result = { template: { id: job.templateId, tune: checkedTemplate.tune, concept: checkedTemplate.concept }, tuneDropped: out?.tuneDropped ?? [], problems: ok ? [] : problems, evidence: out?.evidence ?? null };
      store.save(job);
      emit(job, 'improve_check', { attempt: 0, id: 'template-contract', ok, ms: res.ms ?? null });
      if (!ok) { outcome = 'failed'; reason = `the template contract failed: ${[...new Set(problems.map(p => p.code))].join(', ')}`; return; }
      const file = templatePaths(job.templateId).file;
      const provenance = { job: job.id, derivation: TEMPLATE_DERIVATION_VERSION, contract: CONTRACT_VERSION, gameId: job.gameId, gameVersion: job.gameVersion, sourceDocSha256: job.experiment.codeSha256,
        sourceCommit: job.context.sourceCommit, catalogHash: out.catalogHash ?? null, loop: { id: config.id, version: config.version }, promotedAt: new Date().toISOString(),
        evidence: { ms: out.evidence?.ms ?? null, gate: out.evidence?.gate ?? null, bots: out.evidence?.bots ?? [] } };
      await writer.write(file, promotedFile(checkedTemplate, provenance));
      job.result.file = file;
      outcome = 'succeeded';
    } catch (error) {
      const cancelled = job.cancelRequested;
      outcome = cancelled ? 'cancelled' : 'failed';
      reason = cancelled ? 'cancelled' : error?.code === 'timeout' ? error.message : `${error?.message || error}`;
    } finally {
      clearTimeout(deadline);
      templateInputs.delete(job.id);
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
    const p = job.target === 'primitive' ? { ...primitivePaths(job.primitiveId), mod: primitivePaths(job.primitiveId).primitive } : modPaths(job.modId);
    const { scope: tScope, verification } = targetOf(job);
    const changes = await runner.changes({ workspace });
    job.result = { branch: null, commit: null, files: changes.files, diffstat: changes.diffstat };
    writeFileSync(join(store.jobDir(job.id), 'changes.patch'), changes.patch || '');
    const scope = scopeCheck(changes.files, tScope, job.target === 'primitive' ? job.primitiveId : job.modId, job.target);
    if (scope.outside.length && tScope.allowOutside) job.result.outsideScopeAllowed = scope.outside;
    checks.push({ id: 'scope', ok: scope.ok, ms: Date.now() - started, problems: scope.problems });
    emit(job, 'improve_check', { attempt: n, id: 'scope', ok: scope.ok, ms: Date.now() - started, problems: scope.problems });
    const vars = { modTest: p.test, kitTest: job.kitId ? config.kitTests[job.kitId] || config.kitTests.pattern.replace('{kitId}', job.kitId) : '', kitId: job.kitId || '', modId: job.modId, checker: workspace.checker || CHECKER, workdir: workspace.dir || '.',
      primitiveTest: p.test, primitiveId: job.primitiveId || '', docFile: join(store.jobDir(job.id), 'game.json'), primitiveChecker: workspace.primitiveChecker || PRIMITIVE_CHECKER };
    let output = '';
    // Out-of-scope or missing deliverables: nothing else runs (the scope gate refuses the result as it is).
    if (scope.ok) for (const cmd of verification) {
      if (signal.aborted) break;
      const argv = substitute(cmd.argv, vars);
      const res = await runner.exec({ workspace, argv, timeoutMs: cmd.timeoutLimit ? L[cmd.timeoutLimit] : L.verifyCommandTimeoutMs, signal });
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
    return { ok: !failed.length, ms: Date.now() - started, checks, patchSha256: createHash('sha256').update(changes.patch || '').digest('hex'), feedback: feedback.slice(0, L.maxFeedbackChars + 200) };
  }

  const commitMessage = job => (job.target === 'primitive'
    ? `Promote experiment ${JSON.stringify(job.experiment.label || job.experiment.id || 'experiment')} to the ${job.primitiveId} primitive\n\n` +
      `Improvement job ${job.id}; loop ${config.id}@${config.version}; runner ${runner.id}@${runner.version}; game ${job.gameId}@${job.gameVersion ?? '?'}; base ${job.context.sourceCommit}.\n` +
      `Verified by the job: ${targetOf(job).verification.map(c => c.id).join(', ')}.`
    : `Promote experiment ${JSON.stringify(job.experiment.label || job.experiment.id || 'experiment')} to the ${job.modId} mod\n\n` +
      `Improvement job ${job.id}; loop ${config.id}@${config.version}; runner ${runner.id}@${runner.version}; kit ${job.kitId}@${job.kitVersion}; base ${job.context.sourceCommit}.\n` +
      `Verified by the job: ${config.verification.map(c => c.id).join(', ')}.`);

  const experiments = new Map(); // the experiment code is kept in memory and in experiment.json, not in report.json

  /** Target 'primitive': an experiment primitive (card + sandboxed module) becomes a native primitive under v2/primitives/promoted. */
  async function startPrimitive({ experiment, gameId, gameVersion, userId, doc, registry }) {
    if (!experiment?.card?.id || typeof experiment.code !== 'string' || !experiment.code.trim()) throw Error('a primitive experiment (card and code) is required');
    if (experiment.code.length > L.maxExperimentCodeChars) throw Error(`experiment code is over ${L.maxExperimentCodeChars} characters`);
    if (typeof gameId !== 'string' || !gameId) throw Error('gameId is required');
    if (!doc || typeof doc !== 'object') throw Error('the game document is required (the gate replays it with the native primitive)');
    if (store.all().filter(j => j.state === 'queued').length >= L.maxQueuedJobs) throw Error(`the promotion queue is full (${L.maxQueuedJobs})`);
    const primitiveId = experiment.card.id;
    if (registry?.has?.(primitiveId) && !registry.get(primitiveId)?.card?.experimental) throw Error(`primitive '${primitiveId}' is already registered`);
    if (existsSync(join(root, primitivePaths(primitiveId).primitive))) throw Error(`primitive '${primitiveId}' already exists in v2/primitives/promoted`);
    if (store.all().some(j => j.primitiveId === primitiveId && !['failed', 'cancelled'].includes(j.state))) throw Error(`a promotion of '${primitiveId}' is already running or done`);
    const jobId = `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(4).toString('hex')}`;
    const codeSha256 = createHash('sha256').update(experiment.code).digest('hex');
    const job = newJob({ id: jobId, now: Date.now(), experiment, codeSha256, kitId: null, kitVersion: null, gameId, gameVersion, userId, target: 'primitive', modId: primitiveSlug(primitiveId),
      config: configRef(config), runner: { id: runner.id, version: runner.version } });
    job.primitiveId = primitiveId;
    store.create(job);
    const record = { id: experiment.id ?? null, label: experiment.label ?? null, request: experiment.request ?? null, card: experiment.card, code: experiment.code, instance: experiment.instance || null, schema: experiment.schema || null };
    writeFileSync(join(store.jobDir(jobId), 'experiment.json'), JSON.stringify(record, null, 2));
    writeFileSync(join(store.jobDir(jobId), 'game.json'), JSON.stringify(doc));
    experiments.set(jobId, { ...record, doc });
    emit(job, 'improve_queued', { target: 'primitive', primitiveId, position: store.all().filter(j => j.state === 'queued').length });
    pump();
    return view(job);
  }

  const templateInputs = new Map(); // jobId -> { doc, registry }: the version and the catalogue it is derived against

  /** Target 'template': a published game version becomes a template under v2/templates/promoted (see executeTemplate). */
  function startTemplate({ gameId, gameVersion, userId, doc, registry, templateId }) {
    if (typeof gameId !== 'string' || !gameId) throw Error('gameId is required');
    if (!doc || typeof doc !== 'object') throw Error('the published game document is required');
    if (typeof registry?.get !== 'function') throw Error('the live catalogue registry is required (the template\'s tune is derived from its cards)');
    const id = templateId ?? gameId;
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw Error(`template id ${JSON.stringify(id)} is not a lowercase slug (${ID_PATTERN}); name one with templateId`);
    if (TEMPLATES.some(t => t.id === id)) throw Error(`template '${id}' already exists`);
    if (existsSync(join(root, templatePaths(id).file))) throw Error(`template '${id}' already exists in v2/templates/promoted`);
    if (store.all().some(j => j.target === 'template' && j.templateId === id && !['failed', 'cancelled'].includes(j.state))) throw Error(`a promotion of template '${id}' is already running or done`);
    if (store.all().filter(j => j.state === 'queued').length >= L.maxQueuedJobs) throw Error(`the promotion queue is full (${L.maxQueuedJobs})`);
    const jobId = `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(4).toString('hex')}`;
    const docSha256 = createHash('sha256').update(JSON.stringify(doc)).digest('hex');
    const job = newJob({ id: jobId, now: Date.now(), experiment: { id: null, label: `template ${id}`, request: null }, codeSha256: docSha256, kitId: null, kitVersion: null, gameId, gameVersion, userId, target: 'template', modId: id,
      config: configRef(config), runner: { id: 'template-contract', version: CONTRACT_VERSION } });
    job.templateId = id;
    store.create(job);
    writeFileSync(join(store.jobDir(jobId), 'game.json'), JSON.stringify(doc));
    templateInputs.set(jobId, { doc, registry });
    emit(job, 'improve_queued', { target: 'template', templateId: id, position: store.all().filter(j => j.state === 'queued').length });
    pump();
    return view(job);
  }

  return {
    config, events,
    /** The persisted events of one job (events.jsonl), oldest first. */
    eventsOf: id => (ID.test(String(id)) && store.get(id) ? store.events(id) : []),
    /** Subscribe to every event; returns an unsubscribe function. */
    subscribe(fn) { events.on('event', fn); return () => events.off('event', fn); },

    async start({ experiment, kitId, gameId, gameVersion = null, userId = null, target = 'mod', modId = null, doc = null, registry = null, templateId = null } = {}) {
      if (target === 'primitive') return startPrimitive({ experiment, gameId, gameVersion, userId, doc, registry });
      if (target === 'template') return startTemplate({ gameId, gameVersion, userId, doc, registry, templateId: templateId ?? undefined });
      if (target !== 'mod') throw Error(`unsupported promotion target '${target}' (mod, primitive or template)`);
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
      if (job.target === 'template') return { ok: false, reason: `a template promotion writes ${templatePaths(job.templateId).file} when it succeeds; there is nothing to apply (restart the server to load it)` };
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
