// node:vm host for an experiment (server-side check and Node tests). The code runs in a
// fresh context with no code generation from strings, no WebAssembly, no promises (the
// harness removes Promise and the module may not use async/await, so no work outlives a
// call), and a time limit on every call. Only strings cross the boundary: the
// host passes JSON in and parses JSON out, so no host object or function is reachable.
import vm from 'node:vm';
import { applyOps } from '../kits/mods/compose.js';
import { harnessSource, cleanOps, cleanDraws } from './sandbox.js';

export const TIME = { loadMs: 50, initMs: 50, callMs: 25 };

/** Load an experiment. Returns { meta, init(snapshot), step(snapshot, input), draw(snapshot), state() }; each call returns { ok, value?, error?, ms, timeout? }. */
export function loadVmExperiment(code, { seed = 1, time = TIME } = {}) {
  const ctx = vm.createContext(Object.create(null), { name: 'gameverse-experiment', codeGeneration: { strings: false, wasm: false } });
  // Host-owned slots first, non-configurable, so experiment code can't turn them into accessors.
  Object.defineProperty(ctx, '__arg', { value: '', writable: true, configurable: false, enumerable: false });
  Object.defineProperty(ctx, '__gv', { value: null, writable: true, configurable: false, enumerable: false });
  const calls = {
    meta: new vm.Script('__gv.meta()'), init: new vm.Script('__gv.init(__arg)'), step: new vm.Script('__gv.step(__arg)'),
    draw: new vm.Script('__gv.draw(__arg)'), state: new vm.Script('__gv.state()'),
  };
  const run = (name, arg, timeout) => {
    const t = performance.now();
    try {
      ctx.__arg = arg;
      const out = calls[name].runInContext(ctx, { timeout, breakOnSigint: false });
      const ms = performance.now() - t;
      if (typeof out !== 'string') return { ok: false, error: `${name} returned a non-string from the harness`, ms };
      const value = JSON.parse(out);
      return value && typeof value.error === 'string' ? { ok: false, error: value.error, ms } : { ok: true, value, ms };
    } catch (error) {
      const ms = performance.now() - t, timeout_ = /timed out/i.test(error?.message || '');
      return { ok: false, error: timeout_ ? `${name} took longer than ${timeout} ms` : String(error?.message || error).slice(0, 300), ms, timeout: timeout_ };
    }
  };
  let script;
  try { script = new vm.Script(`__gv = ${harnessSource(code, { seed })};`, { filename: 'experiment.js' }); }
  catch (error) { return { error: error instanceof SyntaxError ? `syntax error: ${error.message}` : String(error.message || error) }; }
  const t = performance.now();
  try { script.runInContext(ctx, { timeout: time.loadMs }); }
  catch (error) { return { error: /timed out/i.test(error?.message || '') ? `loading the module took longer than ${time.loadMs} ms` : String(error?.message || error).slice(0, 300), loadMs: performance.now() - t }; }
  const loadMs = performance.now() - t;
  const meta = run('meta', '', time.callMs);
  if (!meta.ok) return { error: meta.error, loadMs };
  return {
    meta: meta.value, loadMs,
    init: snapshot => run('init', JSON.stringify(snapshot), time.initMs),
    step: (snapshot, input) => run('step', JSON.stringify({ snapshot, input }), time.callMs),
    draw: snapshot => run('draw', JSON.stringify(snapshot), time.callMs),
    state: () => run('state', '', time.callMs),
  };
}

/** The composer's sandbox interface over node:vm (same contract as runtime.js's Worker sandbox, but synchronous). */
export function createVmSandboxedExperiment(experiment, { kit, world, seed = 1, onNote = () => {}, maxErrors = 3 } = {}) {
  const status = { disabled: false, note: '', label: String(experiment.label || 'Experiment').slice(0, 40), errors: 0, steps: 0, applied: 0, dropped: 0, malformed: 0 };
  const box = loadVmExperiment(experiment.code, { seed });
  let pending = null, draws = [], ready = false;
  const disable = note => { if (status.disabled) return; status.disabled = true; status.note = note; draws = []; pending = null; try { onNote(`Experiment “${status.label}” stopped: ${note}`); } catch {} };
  const failed = (where, message) => { status.errors++; if (where === 'init' || status.errors >= maxErrors) disable(`it kept failing (${message})`); };
  if (box.error) disable(`it did not load (${box.error})`);
  return {
    label: status.label, button: experiment.button === true, status,
    get draws() { return status.disabled ? [] : draws; },
    reset(snapshot) { if (status.disabled) return; pending = null; draws = []; const r = box.init(snapshot); ready = r.ok; if (!r.ok) failed('init', r.error); },
    applyPending(state, emit) {
      if (status.disabled || !pending?.length) return { applied: 0, dropped: 0 };
      const r = applyOps(kit, world, state, pending, emit); pending = null; status.applied += r.applied; status.dropped += r.dropped; return r;
    },
    post(snapshot, input) {
      if (status.disabled || !ready) return;
      const s = box.step(snapshot, input);
      if (!s.ok) { failed('step', s.error); return; }
      const d = box.draw(snapshot);
      if (!d.ok) { failed('draw', d.error); return; }
      status.steps++; status.errors = 0;
      const ops = cleanOps(s.value.ops), list = cleanDraws(d.value.draws);
      status.malformed += ops.malformed + list.malformed;
      pending = ops.ops; draws = list.draws;
    },
    dispose() { status.disabled = true; status.note ||= 'closed'; },
  };
}
