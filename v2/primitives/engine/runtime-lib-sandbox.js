// Sandbox host for engine.script.sandbox: model-written mechanic code runs
// in an isolated realm and only exchanges JSON strings with the host.
// Generalized from v2/experiments (node:vm check, hardened Worker harness):
// the realm is stripped of I/O, timers, clocks and code generation,
// Math.random throws, intrinsics are frozen, and the module is
// re-instantiated on every call so it cannot keep hidden state; all script
// state goes in and out as JSON (and lives in rt.state), which keeps runs
// deterministic and snapshot/restore exact. Calls are synchronous.
//
// Realms: node:vm (Node, with a per-call timeout), else ShadowRealm when the
// platform has it (no timeout). Without either, createHost returns
// { error: 'no_sandbox' } and the primitive disables the script.

export const LIMITS = { codeBytes: 48 * 1024, stateBytes: 64 * 1024, effectsBytes: 32 * 1024, worldBytes: 512 * 1024 };

export const FORBIDDEN_GLOBALS = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'EventSource', 'WebTransport', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel',
  'Worker', 'SharedWorker', 'ServiceWorker', 'MessageChannel', 'MessagePort', 'RTCPeerConnection', 'Notification', 'navigator', 'location', 'origin',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'setImmediate', 'clearImmediate', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
  'Date', 'performance', 'eval', 'Function', 'WebAssembly', 'SharedArrayBuffer', 'Atomics', 'crypto', 'require', 'process', 'module', 'exports', 'Buffer',
  'FinalizationRegistry', 'WeakRef', 'postMessage', 'close', 'onmessage', 'addEventListener', 'removeEventListener', 'dispatchEvent', 'reportError',
  'Promise', 'structuredClone', 'FileReader', 'FileReaderSync', 'Request', 'Response', 'Headers', 'OffscreenCanvas', 'createImageBitmap', 'fonts', 'scheduler',
  'document', 'window', 'self', 'parent', 'top', 'frames', 'localStorage', 'sessionStorage', 'console',
];

/** Static checks on a script module. Returns { body } or { code, message } (stable codes for preflight). */
export function moduleBody(code) {
  const src = String(code ?? '');
  if (!src.trim()) return { code: 'script_empty', message: 'the script has no code' };
  if (src.length > LIMITS.codeBytes) return { code: 'script_size', message: `the code is ${src.length} bytes; keep it under ${LIMITS.codeBytes}` };
  if (/^\s*import\b(?!\s*\()/m.test(src) || /\bimport\s*\(/.test(src) || /\bimport\.meta\b/.test(src)) return { code: 'script_import', message: 'scripts cannot import anything; put everything in one module' };
  if (/\basync\s*(function\b|\(|[\w$]+\s*(\(|=>))/.test(src) || /\bawait\b/.test(src)) return { code: 'script_async', message: 'scripts are synchronous: no async functions, await or promises' };
  const defaults = src.match(/\bexport\s+default\b/g) || [];
  if (defaults.length !== 1) return { code: 'script_export', message: `the module must have exactly one "export default" (found ${defaults.length})` };
  if (/\bexport\s+(?!default\b)/.test(src)) return { code: 'script_export', message: 'only "export default" is allowed' };
  return { body: `${src.replace(/\bexport\s+default\b/, 'const __default__ =')}\n;return __default__;` };
}

// Evaluated in the fresh realm: hardens it, then returns call(method, argJson) -> resultJson.
// The module factory runs anew on every call, so module-level variables never carry over.
const HARNESS = `(function (FORBIDDEN, LIMITS) {
  'use strict';
  const G = globalThis, stringify = JSON.stringify, parse = JSON.parse, isFinite_ = Number.isFinite, freeze = Object.freeze;
  const getProto = Object.getPrototypeOf, ownDesc = Object.getOwnPropertyDescriptor, define = Object.defineProperty, imul = Math.imul;
  define(Math, 'random', { value: () => { throw Error('Math.random is not available; use the rng argument'); }, writable: false, configurable: false });
  const intrinsics = [Object, Array, Math, JSON, String, Number, Boolean, Symbol, Map, Set, WeakMap, WeakSet, RegExp, Reflect, Error, TypeError, RangeError, SyntaxError, ReferenceError, BigInt,
    getProto(function () {}), getProto(function* () {}), getProto([][Symbol.iterator]())];
  try { delete Array.fromAsync; } catch {}
  for (const name of FORBIDDEN) {
    for (let o = G; o && o !== Object.prototype; o = getProto(o)) { try { if (ownDesc(o, name)?.configurable) delete o[name]; } catch {} }
    try { if (!ownDesc(G, name) || ownDesc(G, name).configurable) define(G, name, { value: undefined, writable: false, configurable: false }); } catch {}
  }
  for (const x of intrinsics) { try { freeze(x); if (x.prototype) freeze(x.prototype); } catch {} }
  const check = (key, value) => {
    if (typeof value === 'number' && !isFinite_(value)) throw Error('a number became ' + String(value) + (key ? ' at "' + key + '"' : ''));
    if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') throw Error('values must be plain JSON; "' + key + '" is a ' + typeof value);
    return value;
  };
  const json = (value, limit, what) => { const s = stringify(value === undefined ? null : value, check); if (s.length > limit) throw Error(what + ' is ' + s.length + ' bytes; keep it under ' + limit); return s; };
  const fail = e => { let m = 'error'; try { m = String(e && e.message !== undefined ? e.message : e); } catch {} return stringify({ error: m.slice(0, 300) }); };
  const make = function () { __BODY__ };
  // mulberry32 over a seed that round-trips through the host's state.
  const rngFrom = seed0 => { const box = { s: seed0 >>> 0 }; const rng = () => { box.s = (box.s + 0x6D2B79F5) >>> 0; let t = box.s; t = imul(t ^ (t >>> 15), t | 1); t ^= t + imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; return { rng, box }; };
  // No hidden state between calls: existing globals become read-only and their objects frozen (host slots
  // excepted); globals a call adds are deleted after it, and a call that adds one it cannot delete fails.
  const HOST = new Set(['__gv', '__m', '__arg']);
  for (const name of Object.getOwnPropertyNames(G)) {
    if (HOST.has(name)) continue;
    try { const d = ownDesc(G, name); if ('value' in d) { if (d.configurable || d.writable) define(G, name, { value: d.value, writable: false, enumerable: d.enumerable, configurable: false }); const v = d.value; if (v && (typeof v === 'object' || typeof v === 'function')) { freeze(v); if (v.prototype) freeze(v.prototype); } } } catch {}
  }
  const baseline = new Set(Object.getOwnPropertyNames(G));
  const sweep = () => { for (const name of Object.getOwnPropertyNames(G)) if (!baseline.has(name) && !HOST.has(name)) { if (!delete G[name]) throw Error('scripts cannot define globals (' + name + ')'); } };
  let broken = null;
  const load = () => { const m = make.call(undefined); if (!m || typeof m !== 'object' || typeof m.step !== 'function') throw Error('the default export must be an object with step(state, world, input, rng)'); return m; };
  return function call(method, argJson) {
    try { return run(method, argJson); } finally { try { sweep(); } catch (e) { broken = String(e.message); } }
  };
  function run(method, argJson) {
    if (broken) return fail(Error(broken));
    try {
      const arg = parse(argJson), m = load(), r = rngFrom(arg.seed);
      if (method === 'meta') return stringify({ ok: true, init: typeof m.init === 'function', label: typeof m.label === 'string' ? m.label.slice(0, 40) : '' });
      if (method === 'init') {
        const out = typeof m.init === 'function' ? m.init(arg.world, r.rng) : {};
        if (out && typeof out.then === 'function') throw Error('init must return the state synchronously');
        return stringify({ state: parse(json(out === undefined ? {} : out, LIMITS.stateBytes, 'state')), seed: r.box.s });
      }
      const out = m.step(arg.state, arg.world, arg.input, r.rng);
      if (out && typeof out.then === 'function') throw Error('step must return { state, effects } synchronously');
      if (!out || typeof out !== 'object' || !('state' in out)) throw Error('step must return { state, effects }');
      return stringify({ state: parse(json(out.state, LIMITS.stateBytes, 'state')), effects: parse(json(out.effects === undefined ? [] : out.effects, LIMITS.effectsBytes, 'effects')), seed: r.box.s });
    } catch (e) { return fail(e); }
  }
})`;

export function harnessSource(body) {
  return `${HARNESS.replace('__BODY__', () => body)}(${JSON.stringify(FORBIDDEN_GLOBALS)}, ${JSON.stringify(LIMITS)})`;
}

// node:vm when running under Node (headless sim, server checks, tests); never imported in browsers.
const vm = typeof globalThis.process?.versions?.node === 'string' ? await import('node:vm') : null;
export const sandboxKind = () => (vm ? 'vm' : typeof globalThis.ShadowRealm === 'function' ? 'shadowrealm' : null);

/** Syntax check without running anything (Node only; elsewhere returns null = unchecked). */
export function syntaxError(code) {
  const m = moduleBody(code); if (m.code) return m.message;
  if (!vm) return null;
  try { new vm.Script(harnessSource(m.body), { filename: 'script.js' }); return null; } catch (e) { return String(e.message || e); }
}

/** Load a script. Returns { call(method, arg) -> { ok, value?, error?, timeout? } } or { error }. */
export function createHost(code, { timeoutMs = 25 } = {}) {
  const m = moduleBody(code); if (m.code) return { error: m.message };
  const src = harnessSource(m.body);
  if (vm) {
    const ctx = vm.createContext(Object.create(null), { name: 'gameverse-script', codeGeneration: { strings: false, wasm: false } });
    Object.defineProperty(ctx, '__arg', { value: '', writable: true, configurable: false, enumerable: false });
    Object.defineProperty(ctx, '__m', { value: '', writable: true, configurable: false, enumerable: false });
    Object.defineProperty(ctx, '__gv', { value: null, writable: true, configurable: false, enumerable: false });
    try { new vm.Script(`__gv = ${src};`, { filename: 'script.js' }).runInContext(ctx, { timeout: timeoutMs * 4 }); }
    catch (e) { return { error: e instanceof SyntaxError ? `syntax error: ${e.message}` : String(e?.message || e).slice(0, 300) }; }
    const invoke = new vm.Script('__gv(__m, __arg)');
    return { kind: 'vm', call(method, arg) {
      try { ctx.__m = method; ctx.__arg = JSON.stringify(arg); const out = invoke.runInContext(ctx, { timeout: timeoutMs, breakOnSigint: false }); return parseOut(out); }
      catch (e) { const t = /timed out/i.test(e?.message || ''); return { ok: false, error: t ? `${method} took longer than ${timeoutMs} ms` : String(e?.message || e).slice(0, 300), timeout: t }; }
    } };
  }
  if (typeof globalThis.ShadowRealm === 'function') {
    let fn;
    try { fn = new globalThis.ShadowRealm().evaluate(src); } catch (e) { return { error: String(e?.message || e).slice(0, 300) }; }
    return { kind: 'shadowrealm', call(method, arg) { try { return parseOut(fn(method, JSON.stringify(arg))); } catch (e) { return { ok: false, error: String(e?.message || e).slice(0, 300) }; } } };
  }
  return { error: 'no_sandbox' };
}

function parseOut(out) {
  if (typeof out !== 'string') return { ok: false, error: 'the sandbox returned a non-string' };
  const v = JSON.parse(out);
  return typeof v?.error === 'string' ? { ok: false, error: v.error } : { ok: true, value: v };
}
