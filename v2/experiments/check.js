// Headless check for an experiment (v2/kits/EXTENDING.md, tier 3): compose the real kit game,
// play 600 frames with varied inputs, feed the experiment real snapshots, apply the operations it
// returns through the world adapter, and validate everything that comes back. Runs in a
// worker_threads isolate with a memory cap and a wall-clock limit; the code itself runs in node:vm.
import { Worker } from 'node:worker_threads';
import { composeGame, applyOps } from '../kits/mods/compose.js';
import { cleanOps, cleanDraws, experimentWorld, freeButtons, experimentInput, safeSnapshot as snapshot } from './sandbox.js';
import { loadVmExperiment, TIME } from './vm-sandbox.js';

export const BUDGET = { frames: 600, stepAvgMs: 5, drawAvgMs: 5, wallMs: 15000, heapMb: 256 };
const STATUSES = new Set(['playing', 'won', 'lost']);

/** Same rule the overworld host applies to kit states (src/generated-adapter.js). */
export function kitStateProblems(state) {
  if (!state || !STATUSES.has(state.status)) return ['the game state has no valid status'];
  if (!Number.isFinite(state.score ?? 0)) return ['the score is not a number'];
  try { JSON.stringify(state); } catch { return ['the game state is not serializable']; }
  return [];
}

// Varied, deterministic input: held directions for 10–40 frames, frequent taps of a and b.
function inputScript(seed, frames) {
  let s = (seed * 2654435761) >>> 0;
  const r = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const out = [];
  let x = 0, y = 0, left = 0;
  for (let i = 0; i < frames; i++) {
    if (left-- <= 0) { x = [-1, 0, 1][Math.floor(r() * 3)]; y = r() < 0.6 ? 0 : [-1, 1][Math.floor(r() * 2)]; left = 10 + Math.floor(r() * 30); }
    out.push({ x, y, a: r() < 0.12 || (i % 45) < 3, b: r() < 0.08 });
  }
  return out;
}

const round = v => Math.round(v * 1000) / 1000;
const problem = (code, message, hint) => ({ code, message, ...(hint ? { hint } : {}) });

/** In-process check. `experiment` is { code, label?, button? }. Returns { ok, problems, warnings, report }. */
export function runCheck(experiment, { kit, content, seed = 1, frames = BUDGET.frames, mods = {}, time = TIME, budget = BUDGET } = {}) {
  const started = performance.now();
  const problems = [], warnings = [];
  const report = { frames: 0, restarts: 0, label: null, button: null, kit: kit?.id ?? null, kitVersion: kit?.version ?? null,
    ops: { returned: 0, applied: 0, dropped: 0, malformed: 0, byOp: {} }, draws: { total: 0, maxPerFrame: 0, malformed: 0, byType: {} },
    timings: { loadMs: null, initMs: null, stepAvgMs: null, stepMaxMs: null, drawAvgMs: null, drawMaxMs: null, gameMs: null, totalMs: null }, errors: 0 };
  const finish = () => { report.timings.totalMs = round(performance.now() - started); return { ok: problems.length === 0, problems, warnings, report }; };

  const checked = kit.validate ? kit.validate(content) : { ok: true, content };
  if (!checked.ok) { problems.push(problem('bad_content', `the game content failed ${kit.id} validation: ${checked.errors?.[0]?.message || 'invalid'}`)); return finish(); }
  const game = composeGame(kit, checked.content, { seed, mods });
  const world = experimentWorld(kit, game);
  const box = loadVmExperiment(experiment.code, { seed, time });
  report.timings.loadMs = box.loadMs != null ? round(box.loadMs) : null;
  if (box.error) { problems.push(problem('load', `the module did not load: ${box.error}`)); return finish(); }
  report.label = box.meta.label || experiment.label || null; report.button = box.meta.button;
  if (!box.meta.label) warnings.push('the default export has no label');
  const button = box.meta.button ? (freeButtons(kit, game)[0] ?? null) : null;
  if (box.meta.button && !button) warnings.push(`the experiment wants a button but ${kit.id} with these mods has none free; it runs without one`);

  const errors = new Map();
  const error = (where, frame, message, timeout) => {
    report.errors++;
    const key = `${where}: ${message}`;
    if (!errors.has(key)) { errors.set(key, frame); if (errors.size <= 4) problems.push(problem(timeout ? 'timeout' : 'throws', `${where} ${timeout ? '' : 'threw '}at frame ${frame}: ${message}`, timeout ? (where === 'init' ? `keep init under ${time.initMs} ms` : `keep ${where} under ${time.callMs} ms per call and ${where === 'step' ? budget.stepAvgMs : budget.drawAvgMs} ms on average`) : undefined)); }
  };
  let state = game.createState();
  const init = s => {
    const r = box.init(snapshot(kit, world, s, []));
    report.timings.initMs = Math.max(report.timings.initMs ?? 0, round(r.ms));
    if (!r.ok) error('init', s.frame ?? 0, r.error, r.timeout);
    return r.ok;
  };
  if (!init(state)) return finish();

  const inputs = inputScript(seed, frames);
  let stepMs = 0, stepMax = 0, drawMs = 0, drawMax = 0, gameMs = 0, prevHeld = false, timeouts = 0, kitFailed = false;
  for (let i = 0; i < frames && timeouts < 3 && report.errors < 50; i++) {
    const input = inputs[i];
    const kitInput = button ? { ...input, [button]: false } : input;
    const g0 = performance.now();
    game.step(state, kitInput);
    gameMs += performance.now() - g0;
    const events = [...(state.events || [])];
    const snap = snapshot(kit, world, state, events);
    const xin = experimentInput(input, button, prevHeld); prevHeld = xin.held;
    const r = box.step(snap, xin);
    stepMs += r.ms; stepMax = Math.max(stepMax, r.ms);
    if (!r.ok) { error('step', i, r.error, r.timeout); if (r.timeout) timeouts++; }
    else {
      const raw = r.value.ops || [];
      report.ops.returned += Array.isArray(raw) ? raw.length : 1;
      const clean = cleanOps(raw);
      report.ops.malformed += clean.malformed;
      for (const p of clean.problems) if (problems.length < 12 && !problems.some(q => q.message === p)) problems.push(problem('bad_op', p, 'ops are { op: spawn|setBlocked|score|hurt|defeat|stun|emit, ... } with finite numbers'));
      for (const o of clean.ops) report.ops.byOp[o.op] = (report.ops.byOp[o.op] || 0) + 1;
      const applied = applyOps(kit, world, state, clean.ops, (name, data) => (state.events ||= []).push({ ...data, name, experiment: true }));
      report.ops.applied += applied.applied; report.ops.dropped += applied.dropped;
    }
    const d = box.draw(snap);
    drawMs += d.ms; drawMax = Math.max(drawMax, d.ms);
    if (!d.ok) { error('draw', i, d.error, d.timeout); if (d.timeout) timeouts++; }
    else {
      const clean = cleanDraws(d.value.draws);
      report.draws.malformed += clean.malformed;
      for (const p of clean.problems) if (problems.length < 12 && !problems.some(q => q.message === p)) problems.push(problem('bad_draw', p, 'draws are { t: rect|circle|line|poly|text, ... } in world units with a color string'));
      report.draws.total += clean.draws.length; report.draws.maxPerFrame = Math.max(report.draws.maxPerFrame, clean.draws.length);
      for (const x of clean.draws) report.draws.byType[x.t] = (report.draws.byType[x.t] || 0) + 1;
    }
    report.frames = i + 1;
    if (i % 30 === 29 || state.status !== 'playing') {
      const bad = kitStateProblems(state);
      if (bad.length) { problems.push(problem('kit_state', `after the experiment's operations at frame ${i}: ${bad[0]}`)); kitFailed = true; break; }
    }
    if (state.status !== 'playing') { state = game.createState(); report.restarts++; if (!init(state)) break; prevHeld = false; }
  }
  const n = Math.max(1, report.frames);
  Object.assign(report.timings, { stepAvgMs: round(stepMs / n), stepMaxMs: round(stepMax), drawAvgMs: round(drawMs / n), drawMaxMs: round(drawMax), gameMs: round(gameMs) });
  if (!kitFailed) {
    const final = box.state();
    if (!final.ok) problems.push(problem('state', `the experiment state is not plain JSON: ${final.error}`));
  }
  if (report.timings.stepAvgMs > budget.stepAvgMs) problems.push(problem('slow', `step averaged ${report.timings.stepAvgMs} ms; the budget is ${budget.stepAvgMs} ms`, 'do less work per frame'));
  if (report.timings.drawAvgMs > budget.drawAvgMs) problems.push(problem('slow', `draw averaged ${report.timings.drawAvgMs} ms; the budget is ${budget.drawAvgMs} ms`, 'return fewer draws'));
  if (report.ops.dropped > 10 && report.ops.dropped > report.ops.applied) {
    const caps = kit.world?.capabilities || [];
    problems.push(problem('dropped_ops', `${report.ops.dropped} of ${report.ops.returned} operations were dropped because ${kit.id} does not support them (capabilities: ${caps.join(', ') || 'none'})`, 'use only the operations this kit declares; simulate the rest in your own state and draw it'));
  }
  if (problems.length === 0 && report.draws.total === 0 && report.ops.applied === 0) problems.push(problem('no_effect', 'in 600 frames the experiment drew nothing and changed nothing in the game', 'draw the mechanic and act on the game through operations'));
  return finish();
}

/** Check an experiment. Isolated in a worker thread (memory cap, wall-clock limit) when the kit is a registry kit; `isolate: false` runs in-process. */
export async function checkExperiment(experiment, { kit, content, seed = 1, frames = BUDGET.frames, mods = {}, isolate = true, budget = BUDGET } = {}) {
  const known = isolate && kit?.id && (await import('../kits/registry.js')).KIT_IDS.includes(kit.id);
  if (!known) return runCheck(experiment, { kit, content, seed, frames, mods, budget });
  const started = performance.now();
  return new Promise(resolve => {
    const worker = new Worker(new URL('./check-worker.js', import.meta.url), {
      workerData: { experiment: { code: String(experiment.code ?? ''), label: experiment.label, button: experiment.button }, kitId: kit.id, content, seed, frames, mods, budget },
      resourceLimits: { maxOldGenerationSizeMb: budget.heapMb, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
      stdout: true, stderr: true,
    });
    let done = false;
    const end = result => { if (done) return; done = true; clearTimeout(timer); worker.terminate().catch(() => {}); result.report ??= {}; result.report.timings = { ...(result.report.timings || {}), isolateMs: Math.round(performance.now() - started) }; resolve(result); };
    const fail = (code, message) => end({ ok: false, problems: [problem(code, message)], warnings: [], report: { kit: kit.id, kitVersion: kit.version } });
    const timer = setTimeout(() => fail('timeout', `the check did not finish within ${budget.wallMs} ms`), budget.wallMs);
    worker.once('message', result => end(result));
    worker.once('error', error => fail(error?.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'memory' : 'crash', error?.code === 'ERR_WORKER_OUT_OF_MEMORY' ? `the experiment used more than ${budget.heapMb} MB of memory` : `the check crashed: ${String(error?.message || error).slice(0, 200)}`));
    worker.once('exit', code => fail('crash', `the check exited (${code})`));
  });
}
