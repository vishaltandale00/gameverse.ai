// Helpers shared by the strategy library: decision points, board reading,
// simulation of a choice on a snapshot, multi-seed runs and result records.
import { applyOption, hold, optionLabels, hpOf, foes, vitality } from '../drive.js';
import { seedFrom } from '../../kernel/rng.js';
import { instancesOf, problem } from '../util.js';

/** Step empty input until the runtime offers options again (boards resolving), or the game ends. */
export function untilDecision(rt, max = 600, b = null) {
  let k = 0;
  while (rt.state.status === 'playing' && k < max && !rt.availableOptions().length) { rt.step({}); k++; }
  b?.step(k);
  return k;
}

/** Apply option index i from snapshot `snap` and run to the next decision; returns the rt (mutated). */
export function simulateOption(rt, snap, i, { rng = null, maxWait = 600, b = null } = {}) {
  rt.restore(snap);
  if (rng !== null) rt.state.rng = rng >>> 0 || 1;
  const o = rt.availableOptions()[i];
  if (!o) return rt;
  applyOption(rt, o, b);
  untilDecision(rt, maxWait, b);
  return rt;
}

/** Deterministic alternative RNG states for chance sampling. */
export const chanceSeeds = (rt, n, salt = '') => Array.from({ length: n }, (_, k) => seedFrom(`${rt.state.frame}:${rt.state.rng}:${salt}:${k}`));

/**
 * The board a puzzle primitive exposes: service `board` (or `board:<name>`) with
 * { w, h, get(x, y) } in board coordinates, y up; else the first space with
 * editCells and a `size`, read with getCell([x, y, 0]).
 */
export function boardOf(rt, name = null) {
  const svc = name ? `board:${name}` : 'board';
  if (rt.hasService(svc)) { const s = rt.service(svc); return { w: s.w, h: s.h, get: (x, y) => s.get(x, y), source: svc }; }
  for (const id of rt.spaces()) {
    const api = rt.space(id);
    // Only a 2D, board-scale cell space reads as a board (a voxel world or a large map is not one; puzzles declare a board service).
    const [w, h, d = 1] = Array.isArray(api.size) ? api.size : [];
    if (typeof api.getCell === 'function' && Number.isFinite(w) && Number.isFinite(h) && d <= 1 && w * h <= 64 * 64) return { w, h, get: (x, y) => api.getCell([x, y, 0]), source: `space:${id}` };
  }
  return null;
}
/** Snapshot a board into rows[y][x] (y = 0 bottom). */
export function readBoard(board) {
  const rows = [];
  for (let y = 0; y < board.h; y++) { const r = []; for (let x = 0; x < board.w; x++) r.push(board.get(x, y) ?? null); rows.push(r); }
  return rows;
}
export const filledCount = rows => rows.reduce((n, r) => n + r.filter(c => c !== null).length, 0);
/** Numeric value of a cell token ('8', 8, 'tile_8'); null when not numeric. */
export const numeric = c => { if (typeof c === 'number') return c; if (typeof c !== 'string') return null; const m = /-?\d+(\.\d+)?/.exec(c); return m ? Number(m[0]) : null; };

/**
 * Run `play(seed)` on every seed given, one run each (a play past the budget returns at once, marked budget); pass
 * when wins/runs ≥ passRate. A caller that names seeds gets a run per seed, never fewer.
 */
export function multiSeed(play, { seeds, passRate = 0.7, b }) {
  const out = [];
  for (const s of seeds) out.push(play(s));
  const wins = out.filter(r => r.won).length;
  return { runs: out, wins, rate: out.length ? wins / out.length : 0, ok: out.length > 0 && wins / out.length >= passRate };
}

/** Path of the first instance using a primitive id prefix (for problem paths). */
export function pathOf(doc, prefixes, fallback = 'systems') {
  const x = instancesOf(doc).find(i => prefixes.some(p => i.inst?.use === p || i.inst?.use?.startsWith(p + '.')));
  return x?.path || fallback;
}

/**
 * Document path of the primitive instance behind the current options: the one
 * whose card provides the options' action verbs (or the `board` service),
 * else the first instance matching a hint prefix, else 'systems'.
 */
export function ownerPath(ctx, rt, hints = []) {
  const xs = instancesOf(ctx.doc).map(x => ({ x, p: ctx.registry.get(x.inst?.use) })).filter(e => e.p);
  const verbs = new Set((rt?.availableOptions() || []).flatMap(o => Object.keys(o.actions || {})));
  const byVerb = xs.find(({ p }) => (p.card.provides?.actions || []).some(a => verbs.has(a)));
  if (byVerb) return byVerb.x.path;
  const byBoard = xs.find(({ p }) => (p.card.provides?.services || []).some(s => s === 'board' || s.startsWith('board:')));
  if (byBoard) return byBoard.x.path;
  return pathOf(ctx.doc, hints);
}

/** Document path for an entity: its archetype in content.archetypes, else the instance that spawned it by `with` data, else 'systems'. */
export function entityPath(doc, e) {
  const i = (doc.content?.archetypes || []).findIndex(a => a.id === e?.archetype);
  if (i >= 0) return `content.archetypes[${i}]`;
  const x = instancesOf(doc).find(x => JSON.stringify(x.inst.with || {}).includes(`"${e?.id}"`) || JSON.stringify(x.inst.with || {}).includes(`"archetype":"${e?.archetype}"`));
  return x ? `${x.path}.with` : 'systems';
}

/** Total hp of foes (non-player entities with health) in the player's space. */
export const foeHp = rt => foes(rt).reduce((s, e) => s + Math.max(0, hpOf(e) ?? 0), 0);
export const livingFoes = rt => foes(rt).filter(e => (hpOf(e) ?? 1) > 0);

export { optionLabels, hold, problem };

/**
 * When the player is in a space a bot cannot act in (its required capabilities: an encounter moved the player into a
 * battle screen, a space without positions), play that loop instead of crashing on the outer one's geometry: one
 * turn chosen among the options the game offers there (hints of what the controls issue), by the exchange each makes
 * when resolved on a snapshot (damage dealt minus taken, the objective's change, a won or lost end), taken through
 * the controls; with no option offered, wait a frame. -> true when the player was in such a space (the bot yielded).
 * @param {any} ctx @param {any} rt @param {string[]} caps the capabilities the bot needs @param {any} [b] its budget
 */
export function yieldToEncounter(ctx, rt, caps, b = null) {
  const p = rt.player(); if (!p) return false;
  const have = new Set(ctx.capabilities?.[p.space] || []);
  if (caps.every(c => have.has(c)) && Array.isArray(p.at)) return false;
  const options = rt.availableOptions();
  if (!options.length) { hold(rt, {}, 1, b); return true; }
  const snap = rt.snapshot(), own = () => vitality(rt).hp ?? 0, f0 = foeHp(rt), h0 = own(), score = rt.state.vars.score ?? 0;
  let best = -1, bestV = -Infinity;
  for (let i = 0; i < Math.min(options.length, 24); i++) {
    simulateOption(rt, snap, i, { b, maxWait: 240 });
    const v = (f0 - foeHp(rt)) - (h0 - own()) + ((rt.state.vars.score ?? 0) - score) + (rt.state.status === 'won' ? 1e6 : rt.state.status === 'lost' ? -1e6 : 0);
    if (v > bestV) { bestV = v; best = i; }
  }
  rt.restore(snap);
  applyOption(rt, rt.availableOptions()[best], b);
  return true;
}
