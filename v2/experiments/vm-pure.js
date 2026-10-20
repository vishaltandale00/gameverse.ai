// node:vm host for a primitive experiment (server checks, headless verification, tests).
// A fresh context with no code generation from strings and no WebAssembly; only JSON
// strings cross the boundary and every call has a time limit. Calls are synchronous,
// so headless runs are deterministic and replayable.
import vm from 'node:vm';
import { pureHarnessSource } from './harness.js';

export const PURE_TIME = { loadMs: 50, initMs: 50, callMs: 20 };

/** -> { meta, init(arg), step(arg), draw(arg) } where each call returns { ok, value?, error?, ms, timeout? }; or { error }. */
export function loadPureVm(code, { time = PURE_TIME } = {}) {
  const ctx = vm.createContext(Object.create(null), { name: 'gameverse-primitive-experiment', codeGeneration: { strings: false, wasm: false } });
  Object.defineProperty(ctx, '__arg', { value: '', writable: true, configurable: false, enumerable: false });
  Object.defineProperty(ctx, '__gv', { value: null, writable: true, configurable: false, enumerable: false });
  const calls = { meta: new vm.Script('__gv.meta()'), init: new vm.Script('__gv.init(__arg)'), step: new vm.Script('__gv.step(__arg)'), draw: new vm.Script('__gv.draw(__arg)') };
  const run = (name, arg, timeout) => {
    const t = performance.now();
    try {
      ctx.__arg = arg;
      const out = calls[name].runInContext(ctx, { timeout, breakOnSigint: false });
      const ms = performance.now() - t;
      if (typeof out !== 'string') return { ok: false, error: `${name} returned a non-string`, ms };
      const value = JSON.parse(out);
      return value && typeof value.error === 'string' ? { ok: false, error: value.error, ms } : { ok: true, value, ms };
    } catch (error) {
      const ms = performance.now() - t, timedOut = /timed out/i.test(error?.message || '');
      return { ok: false, error: timedOut ? `${name} took longer than ${timeout} ms` : String(error?.message || error).slice(0, 300), ms, timeout: timedOut };
    }
  };
  let script;
  try { script = new vm.Script(`__gv = ${pureHarnessSource(code)};`, { filename: 'primitive-experiment.js' }); }
  catch (error) { return { error: error instanceof SyntaxError ? `syntax error: ${error.message}` : String(error.message || error) }; }
  try { script.runInContext(ctx, { timeout: time.loadMs }); }
  catch (error) { return { error: /timed out/i.test(error?.message || '') ? `loading took longer than ${time.loadMs} ms` : String(error?.message || error).slice(0, 300) }; }
  const meta = run('meta', '', time.callMs);
  if (!meta.ok) return { error: meta.error };
  return {
    meta: meta.value, lagged: false,
    init: arg => run('init', JSON.stringify(arg), time.initMs),
    step: arg => run('step', JSON.stringify(arg), time.callMs),
    draw: arg => run('draw', JSON.stringify(arg), time.callMs),
  };
}
