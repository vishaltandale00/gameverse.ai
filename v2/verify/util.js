// Shared helpers for the verification layer: stable hashing, a seeded PRNG
// for search decisions (never the game's own RNG), budgets, problem records
// and document walking. Nothing here is specific to any game or primitive.
import { seedFrom } from '../kernel/rng.js';

/** JSON with sorted object keys; NaN/Infinity are kept distinguishable. */
export function stableStringify(value) {
  const seen = new WeakSet();
  const walk = v => {
    if (typeof v === 'number') return Number.isFinite(v) ? JSON.stringify(v) : `"#${v}"`;
    if (v === undefined) return 'null';
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (seen.has(v)) return '"#cycle"';
    seen.add(v);
    const out = Array.isArray(v) ? `[${v.map(walk).join(',')}]` : `{${Object.keys(v).sort().filter(k => v[k] !== undefined && typeof v[k] !== 'function').map(k => `${JSON.stringify(k)}:${walk(v[k])}`).join(',')}}`;
    seen.delete(v);
    return out;
  };
  return walk(value);
}

/** 64-bit FNV-1a (two 32-bit lanes) of a string, as 16 hex chars. */
export function hashString(s) {
  let a = 0x811c9dc5, b = 0xcbf29ce4;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193 ^ 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/** Hash of a full game state (the determinism benchmark's "state hash"). */
export const stateHash = state => hashString(stableStringify(state));

/** Seeded PRNG for search decisions (mulberry32). */
export function prng(seed) {
  let a = seedFrom(seed);
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  next.int = n => Math.floor(next() * n);
  next.pick = list => list[Math.floor(next() * list.length)];
  return next;
}

const clock = () => globalThis.performance?.now?.() ?? Date.now();
/** Wall time, for measurements (timings, reports) only: nothing that decides what is played reads it. */
export const now = clock;

const METERED = Symbol('metered');

/**
 * A budget over the work a search does: states (decisions it keeps) and steps (frames it simulates). Both are counted
 * from the play itself, so the same document, seed and budget always give the same search and the same verdict, on a
 * loaded machine or across a laptop's sleep. Steps are counted where frames are simulated: `meter(rt)` makes every
 * rt.step of that runtime count (lookahead on snapshots included), so nothing simulates past the budget unseen.
 * Wall time decides nothing here (there is no `ms`): a caller that must cap total time does it between whole stages and
 * marks what it skipped as budget-limited (verify/index.js wallMs), never inside a search.
 * @param {{ states?: number, steps?: number }} [limits]
 */
export function budget(limits = {}) {
  if ('ms' in limits) throw Error('budget: wall time decides nothing a search plays (its limits are states and steps); cap total time between stages');
  const { states = Infinity, steps = Infinity } = limits;
  const started = clock();
  const b = {
    states, steps, usedStates: 0, usedSteps: 0, hit: /** @type {null | 'states' | 'steps'} */ (null),
    /** Wall time since the budget began (a measurement for reports). */
    elapsed: () => clock() - started,
    over() {
      if (b.usedStates >= states) b.hit ??= 'states';
      else if (b.usedSteps >= steps) b.hit ??= 'steps';
      return b.hit !== null;
    },
    state(n = 1) { b.usedStates += n; },
    /** Count every frame `rt` simulates from now on against this budget (once per runtime). @template T @param {T} rt @returns {T} */
    meter(rt) {
      const r = /** @type {any} */ (rt);
      if (r[METERED] === b) return rt;
      const step = r.step;
      r.step = (/** @type {any} */ input) => { b.usedSteps++; return step.call(r, input); };
      r[METERED] = b;
      return rt;
    },
    /** A maker whose worlds are metered. @param {(seed?: any) => any} make */
    metered: make => (/** @type {any} */ seed) => b.meter(make(seed)),
    /** What the search used; `ms` is a measurement, never a limit. */
    report: () => ({ states: b.usedStates, steps: b.usedSteps, limit: b.hit, ms: Math.round(clock() - started) }),
  };
  return b;
}

export const SEVERITIES = ['error', 'warning', 'info'];
/** A problem record the planner's repair loop can act on. */
export function problem(code, path, message, { hint, severity = 'error', ...extra } = {}) {
  const p = { code, path: path || '$', message, severity };
  if (hint) p.hint = hint;
  return Object.assign(p, extra);
}

/** Every primitive instance of a document with its path and install key (same keys as kernel createWorld). */
export function instancesOf(doc) {
  const out = [];
  (doc.spaces || []).forEach((s, i) => {
    out.push({ inst: s, path: `spaces[${i}]`, key: `spaces.${s.id}`, space: s.id });
    (s.generators || []).forEach((g, j) => out.push({ inst: g, path: `spaces[${i}].generators[${j}]`, key: `spaces.${s.id}.generators[${j}]`, space: s.id }));
  });
  (doc.systems || []).forEach((s, i) => out.push({ inst: s, path: `systems[${i}]`, key: `systems[${i}]`, space: s.space ?? doc.spaces?.[0]?.id }));
  (doc.graphics || []).forEach((g, i) => out.push({ inst: g, path: `graphics[${i}]`, key: `graphics[${i}]`, space: g.space ?? doc.spaces?.[0]?.id }));
  return out;
}

/** Primitive ids used by a document. */
export const usedPrimitives = doc => new Set(instancesOf(doc).map(x => x.inst?.use).filter(Boolean));

/** Visit every object in a JSON tree with its dotted/bracketed path. */
export function walkJson(value, fn, path = '') {
  if (!value || typeof value !== 'object') return;
  fn(value, path);
  if (Array.isArray(value)) value.forEach((v, i) => walkJson(v, fn, `${path}[${i}]`));
  else for (const [k, v] of Object.entries(value)) walkJson(v, fn, path ? `${path}.${k}` : k);
}

/** Normalize a reachable-set member: zone id, cell array or 'x,y[,z]' key → { zone?, cell? }. */
export function memberOf(m) {
  if (Array.isArray(m)) return { cell: m.map(Number) };
  if (typeof m === 'string' && /^-?\d+(\.\d+)?(,-?\d+(\.\d+)?)+$/.test(m)) return { cell: m.split(',').map(Number) };
  return { zone: m };
}
export const cellKey = at => Array.isArray(at) ? at.map(v => Math.floor(v)).join(',') : String(at);
/** Pad a cell to the length of a reference (testSpace keys are 3D, positions may be 2D). */
export const padCell = (c, n) => { const out = c.slice(0, n); while (out.length < n) out.push(0); return out; };
