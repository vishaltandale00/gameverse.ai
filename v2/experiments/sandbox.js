// Shared by the headless check (node:vm) and the browser runtime (Worker): the
// harness that hosts an experiment module (v2/kits/EXTENDING.md, tier 3), the
// realm hardening it runs first, and the validators the host applies to what
// comes back. Nothing here touches Node or DOM APIs, so both sides load it.
import { snapshot } from '../kits/mods/compose.js';

export const EXPERIMENT_SCHEMA = 'gameverse.v2.experiment/0.1';
export const LIMITS = { codeBytes: 48 * 1024, stateBytes: 256 * 1024, opsPerStep: 64, drawsPerFrame: 400, polyPoints: 48, textChars: 60 };
export const BUTTONS = ['a', 'b'];

// Globals an experiment must never reach. Removed from the realm (own property and prototype chain)
// before the experiment's code is evaluated. node:vm contexts lack most of these; Workers have them.
export const FORBIDDEN_GLOBALS = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'EventSource', 'WebTransport', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel',
  'Worker', 'SharedWorker', 'ServiceWorker', 'MessageChannel', 'MessagePort', 'RTCPeerConnection', 'Notification', 'navigator', 'location', 'origin',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'setImmediate', 'clearImmediate', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
  'Date', 'performance', 'eval', 'Function', 'WebAssembly', 'SharedArrayBuffer', 'Atomics', 'crypto', 'require', 'process', 'module', 'exports', 'Buffer',
  'FinalizationRegistry', 'WeakRef', 'postMessage', 'close', 'onmessage', 'addEventListener', 'removeEventListener', 'dispatchEvent', 'reportError',
  'Promise', 'structuredClone', 'FileReader', 'FileReaderSync', 'Request', 'Response', 'Headers', 'OffscreenCanvas', 'createImageBitmap', 'fonts', 'scheduler',
];

/** The experiment's ES module as a function body: no imports, exactly one `export default`, no other exports. Throws a readable Error. */
export function moduleBody(code) {
  const src = String(code ?? '');
  if (!src.trim()) throw Error('the experiment has no code');
  if (src.length > LIMITS.codeBytes) throw Error(`the code is ${src.length} bytes; keep it under ${LIMITS.codeBytes}`);
  if (/^\s*import\b(?!\s*\()/m.test(src) || /\bimport\s*\(/.test(src) || /\bimport\.meta\b/.test(src)) throw Error('experiments cannot import anything; put everything in one module');
  if (/\basync\s*(function\b|\(|[\w$]+\s*(\(|=>))/.test(src) || /\bawait\b/.test(src)) throw Error('experiments are synchronous: no async functions, await or promises');
  const defaults = src.match(/\bexport\s+default\b/g) || [];
  if (defaults.length !== 1) throw Error(`the module must have exactly one "export default" (found ${defaults.length})`);
  if (/\bexport\s+(?!default\b)/.test(src)) throw Error('only "export default" is allowed; no named exports');
  return `${src.replace(/\bexport\s+default\b/, 'const __default__ =')}\n;return __default__;`;
}

// The harness runs inside the sandbox realm, before the experiment code. It captures what it needs,
// strips forbidden globals, replaces Math.random, freezes the intrinsics and returns an api whose
// methods take and return JSON strings, never throw, and keep the experiment state as plain JSON.
// `__BODY__` is replaced by moduleBody(code), wrapped in a strict function so it gets no `this`.
const HARNESS = `(function (FORBIDDEN, SEED, LIMITS) {
  'use strict';
  const G = globalThis, stringify = JSON.stringify, parse = JSON.parse, isFinite_ = Number.isFinite, freeze = Object.freeze;
  const getProto = Object.getPrototypeOf, ownDesc = Object.getOwnPropertyDescriptor, define = Object.defineProperty, ownNames = Object.getOwnPropertyNames;
  // A seeded generator the experiment receives in init (mulberry32).
  let seed = SEED >>> 0;
  const rng = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const blockedRandom = () => { throw Error('Math.random is not available in experiments; use the rng passed to init'); };
  define(Math, 'random', { value: blockedRandom, writable: false, configurable: false });
  const intrinsics = [Object, Array, Math, JSON, String, Number, Boolean, Symbol, Map, Set, WeakMap, WeakSet, Promise, RegExp, Reflect, Error, TypeError, RangeError, SyntaxError, ReferenceError, BigInt,
    getProto(function () {}), getProto(function* () {}), getProto(async function () {}), getProto([][Symbol.iterator]())];
  // No promises: experiments are synchronous, so nothing can queue work past a call's time limit.
  try { delete Array.fromAsync; } catch {}
  for (const name of FORBIDDEN) {
    for (let o = G; o && o !== Object.prototype; o = getProto(o)) { try { if (ownDesc(o, name)?.configurable) delete o[name]; } catch {} }
    try { if (!ownDesc(G, name) || ownDesc(G, name).configurable) define(G, name, { value: undefined, writable: false, configurable: false }); } catch {}
  }
  for (const x of intrinsics) { try { freeze(x); if (x.prototype) freeze(x.prototype); } catch {} }
  const deepCheck = (key, value) => {
    if (typeof value === 'number' && !isFinite_(value)) throw Error('a number became ' + String(value) + (key ? ' at "' + key + '"' : ''));
    if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') throw Error('state must be plain JSON; "' + key + '" is a ' + typeof value);
    return value;
  };
  const json = (value, limit) => { const s = stringify(value === undefined ? null : value, deepCheck); if (s.length > limit) throw Error('the value is ' + s.length + ' bytes; keep state under ' + limit); return s; };
  const fail = e => { let m = 'error'; try { m = String(e && e.message !== undefined ? e.message : e); } catch {} return stringify({ error: m.slice(0, 300) }); };
  const make = function () { __BODY__ };
  let exp = null, state = null, loadError = null;
  try { exp = make.call(undefined); } catch (e) { loadError = e; }
  const api = freeze({
    meta() {
      if (loadError) return fail(loadError);
      try {
        if (!exp || typeof exp !== 'object') return stringify({ error: 'the default export must be an object { label, button, init, step, draw }' });
        const missing = ['init', 'step', 'draw'].filter(k => typeof exp[k] !== 'function');
        if (missing.length) return stringify({ error: 'the default export is missing ' + missing.join(', ') });
        return stringify({ label: typeof exp.label === 'string' ? exp.label.slice(0, 40) : '', button: exp.button === true });
      } catch (e) { return fail(e); }
    },
    init(snapshotJson) {
      try {
        const out = exp.init(parse(snapshotJson), rng);
        if (out && typeof out.then === 'function') throw Error('init must return the state synchronously, not a promise');
        state = parse(json(out, LIMITS.stateBytes));
        return stringify({ ok: true });
      } catch (e) { return fail(e); }
    },
    step(argJson) {
      try {
        const arg = parse(argJson);
        const out = exp.step(state, { snapshot: arg.snapshot, input: arg.input });
        if (out && typeof out.then === 'function') throw Error('step must return { state, ops } synchronously, not a promise');
        if (!out || typeof out !== 'object' || !('state' in out)) throw Error('step must return { state, ops }');
        state = parse(json(out.state, LIMITS.stateBytes));
        const ops = out.ops === undefined ? [] : out.ops;
        return stringify({ ops: parse(json(ops, 65536)) });
      } catch (e) { return fail(e); }
    },
    draw(snapshotJson) {
      try {
        const out = exp.draw(state, parse(snapshotJson));
        if (out && typeof out.then === 'function') throw Error('draw must return a list synchronously');
        return stringify({ draws: parse(json(out === undefined ? [] : out, 262144)) });
      } catch (e) { return fail(e); }
    },
    state() { try { return stringify({ state }); } catch (e) { return fail(e); } },
  });
  return api;
})`;

/** Source of an expression that, evaluated in a fresh realm, hardens it and yields the experiment api. */
export function harnessSource(code, { seed = 1 } = {}) {
  const body = moduleBody(code);
  return `${HARNESS.replace('__BODY__', () => body)}(${JSON.stringify(FORBIDDEN_GLOBALS)}, ${Number(seed) >>> 0}, ${JSON.stringify(LIMITS)})`;
}

// ---------- validation of what an experiment returns (the host trusts none of it) ----------
const num = v => typeof v === 'number' && Number.isFinite(v);
const color = v => typeof v === 'string' && v.length > 0 && v.length <= 40;
const OPS = {
  spawn: o => num(o.x) && num(o.y) && (o.kind === undefined || typeof o.kind === 'string') && (o.hp === undefined || num(o.hp)),
  setBlocked: o => num(o.x) && num(o.y) && typeof o.on === 'boolean',
  score: o => num(o.n),
  hurt: o => o.by === undefined || typeof o.by === 'string',
  defeat: o => o.id !== undefined && o.id !== null && (typeof o.id === 'number' || typeof o.id === 'string'),
  stun: o => o.id !== undefined && o.id !== null && num(o.frames),
  emit: o => typeof o.name === 'string' && o.name.length > 0 && (o.data === undefined || (o.data && typeof o.data === 'object' && !Array.isArray(o.data))),
};
export const OP_NAMES = Object.keys(OPS);

/** Keep the well-formed operations. Returns { ops, malformed, problems }. */
export function cleanOps(ops) {
  if (ops === null || ops === undefined) return { ops: [], malformed: 0, problems: [] };
  if (!Array.isArray(ops)) return { ops: [], malformed: 1, problems: ['ops must be an array'] };
  const out = [], problems = [];
  let malformed = 0;
  for (const o of ops.slice(0, LIMITS.opsPerStep)) {
    const ok = o && typeof o === 'object' && OPS[o.op]?.(o);
    if (ok) out.push(o);
    else { malformed++; if (problems.length < 3) problems.push(`malformed op ${JSON.stringify(o)?.slice(0, 120)}${OPS[o?.op] ? '' : ` (op must be one of ${OP_NAMES.join(', ')})`}`); }
  }
  if (ops.length > LIMITS.opsPerStep) { malformed += ops.length - LIMITS.opsPerStep; problems.push(`${ops.length} ops in one step; at most ${LIMITS.opsPerStep}`); }
  return { ops: out, malformed, problems };
}

const alpha = o => o.alpha === undefined || (num(o.alpha) && o.alpha >= 0 && o.alpha <= 1);
const DRAWS = {
  rect: o => num(o.x) && num(o.y) && num(o.w) && num(o.h) && color(o.color) && alpha(o),
  circle: o => num(o.x) && num(o.y) && num(o.r) && o.r >= 0 && color(o.color) && alpha(o),
  line: o => num(o.x1) && num(o.y1) && num(o.x2) && num(o.y2) && color(o.color) && (o.width === undefined || (num(o.width) && o.width >= 0)) && alpha(o),
  poly: o => Array.isArray(o.points) && o.points.length >= 2 && o.points.length <= LIMITS.polyPoints && o.points.every(p => Array.isArray(p) && num(p[0]) && num(p[1])) && color(o.color) && alpha(o),
  text: o => num(o.x) && num(o.y) && (typeof o.text === 'string' || num(o.text)) && color(o.color) && (o.size === undefined || (num(o.size) && o.size > 0)) && alpha(o),
};
export const DRAW_TYPES = Object.keys(DRAWS);

/** Keep the well-formed display-list items. Returns { draws, malformed, problems }. */
export function cleanDraws(list) {
  if (list === null || list === undefined) return { draws: [], malformed: 0, problems: [] };
  if (!Array.isArray(list)) return { draws: [], malformed: 1, problems: ['draw must return an array'] };
  const out = [], problems = [];
  let malformed = 0;
  for (const d of list.slice(0, LIMITS.drawsPerFrame)) {
    if (d && typeof d === 'object' && DRAWS[d.t]?.(d)) out.push(d);
    else { malformed++; if (problems.length < 3) problems.push(`malformed draw ${JSON.stringify(d)?.slice(0, 120)}${DRAWS[d?.t] ? '' : ` (t must be one of ${DRAW_TYPES.join(', ')})`}`); }
  }
  if (list.length > LIMITS.drawsPerFrame) { malformed += list.length - LIMITS.drawsPerFrame; problems.push(`${list.length} draws in one frame; at most ${LIMITS.drawsPerFrame}`); }
  return { draws: out, malformed, problems };
}

/** The world an experiment sees: the kit's adapter, or a read-only stand-in for kits without one (snapshots then carry no player or enemies). */
export function experimentWorld(kit, game) {
  if (kit.world?.adapter) return kit.world.adapter(game);
  return { active: s => s?.status === 'playing', blocked: () => false, defeat: () => 0, lives: s => (Number.isFinite(s?.lives) ? s.lives : null) };
}

/** Buttons an experiment may take: not used by the kit, nor by an active mod. */
export function freeButtons(kit, game) {
  const taken = new Set([...(kit.world?.buttons || (kit.world ? [] : BUTTONS)), ...(game?.mods || []).map(m => m.button).filter(Boolean)]);
  return BUTTONS.filter(b => !taken.has(b));
}

/** Experiment input from host input: movement plus the experiment's own button as held/pressed. */
export function experimentInput(input, button, previous) {
  const held = button ? !!input?.[button] : false;
  return { x: Math.sign(Number(input?.x) || 0), y: Math.sign(Number(input?.y) || 0), held, pressed: held && !previous };
}

/** compose.js's snapshot(), but never throws: some adapters can't report a player outside play (fighting before the bout). */
export function safeSnapshot(kit, world, state, events = []) {
  try { return snapshot(kit, world, state, events); }
  catch {
    let active = false, lives = null;
    try { active = !!world.active(state); } catch {}
    try { lives = world.lives?.(state) ?? null; } catch {}
    return { frame: state?.frame ?? null, active, size: null, player: null, enemies: [], blocked: null, lives, events: events.map(e => ({ ...e })), capabilities: [...(kit.world?.capabilities || [])] };
  }
}
