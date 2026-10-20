// Shared helpers for the spaces2d workstream (tilemap, grid, physics2d, arena2d,
// track, none). Nothing here is space-specific: zone membership tracking with
// typed enter/leave events, lazy per-document zone indexes, entity lookups,
// a binary heap for A*, rect geometry and the shared wrap/bounds/kinematics
// vocabularies so every space gives the same method names the same meaning.

export const key2 = (x, y) => `${x},${y}`;
export const unkey = k => k.split(',').map(Number);
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const mod = (v, n) => ((v % n) + n) % n;

/**
 * Zones of space `sid`: the document's zones plus zones generators added at
 * runtime with addZone (kept in rt.state.spaces[sid].zones, so they snapshot).
 * Re-indexed when rt.doc or the runtime list changes; document zones win on id.
 */
export function zoneIndex(rt, sid) {
  let doc = null, extra = null, n = -1, list = [], byId = new Map();
  return () => {
    const st = rt.state.spaces[sid]?.zones;
    if (doc !== rt.doc || extra !== st || (st?.length ?? 0) !== n) {
      doc = rt.doc; extra = st; n = st?.length ?? 0;
      const own = rt.doc.spaces.find(s => s.id === sid)?.zones || [], ids = new Set(own.map(z => z.id));
      list = [...own, ...(st || []).filter(z => !ids.has(z.id))]; byId = new Map(list.map(z => [z.id, z]));
    }
    return { list, byId };
  };
}

/** addZone(zone, rt) for generators: validates the id and appends to the space's runtime zones. */
export function addZoneTo(rt, sid, zones, zone, check = () => null) {
  if (!zone || typeof zone.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(zone.id)) throw Error(`addZone: zone id must be a lowercase slug`);
  const bad = check(zone); if (bad) throw Error(`addZone '${zone.id}': ${bad}`);
  if (zones().byId.has(zone.id)) return false;
  (rt.state.spaces[sid].zones ??= []).push(structuredClone(zone));
  rt.emit('zone_added', { space: sid, zone: zone.id });
  return true;
}

/**
 * Zone membership tracking. contains(zone, at) decides membership; size(zone)
 * ranks nested zones so entity.zone is the most specific one. Membership lives in
 * rt.state.spaces[sid].inside[entityId] (JSON) so enter/leave survive snapshots.
 * Emits typed enter_zone / leave_zone for every membership change.
 */
export function zoneTracker(rt, sid, zones, contains, size = () => 0) {
  const inside = () => (rt.state.spaces[sid].inside ??= {});
  const containing = at => zones().list.filter(z => contains(z, at));
  const zoneAt = at => { let best = null, bs = Infinity; for (const z of containing(at)) { const s = size(z); if (s < bs) { best = z; bs = s; } } return best?.id ?? null; };
  return {
    containing, zoneAt,
    track(e, rt) {
      const was = inside()[e.id] || [], now = containing(e.at).map(z => z.id);
      if (was.length === now.length && was.every((z, i) => z === now[i])) { e.zone = zoneAt(e.at); return; }
      if (now.length) inside()[e.id] = now; else delete inside()[e.id];
      e.zone = zoneAt(e.at);
      for (const z of was) if (!now.includes(z)) rt.emitTyped('leave_zone', z, { who: e.id, zone: z });
      for (const z of now) if (!was.includes(z)) rt.emitTyped('enter_zone', z, { who: e.id, zone: z });
    },
    forget(e) { delete inside()[e.id]; },
  };
}

/** Entities living in space sid (insertion order: deterministic). */
export const inSpace = (rt, sid, filter) => Object.values(rt.state.entities).filter(e => e.space === sid && (!filter || filter(e)));

/** Nearest distance from e to an entity id/archetype, using dist(a, b); null when none. */
export function nearestEntity(rt, sid, e, target, dist) {
  let best = null;
  for (const o of Object.values(rt.state.entities)) if (o !== e && o.space === sid && (o.id === target || o.archetype === target)) { const d = dist(e.at, o.at); if (Number.isFinite(d) && (best === null || d < best)) best = d; }
  return best;
}

/** The body component (created on demand) with the documented fields. */
export function bodyOf(e, defaults = {}) {
  const b = (e.components.body ??= {});
  b.size ??= defaults.size ?? [1, 1]; b.vel ??= [0, 0]; b.grounded ??= false; b.facing ??= 1;
  return b;
}

// ---------- rects [x0, y0, x1, y1], half-open ----------
export const rectHas = (r, p) => p[0] >= r[0] && p[1] >= r[1] && p[0] < r[2] && p[1] < r[3];
export const rectsOverlap = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
export const rectArea = r => (r[2] - r[0]) * (r[3] - r[1]);
export const rectCenter = r => [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];
/** Box of a centered body: [x0,y0,x1,y1]. */
export const boxAround = (at, size) => [at[0] - size[0] / 2, at[1] - size[1] / 2, at[0] + size[0] / 2, at[1] + size[1] / 2];
/** Distance from point p to rect r (0 inside). */
export const rectDist = (r, p) => Math.hypot(Math.max(r[0] - p[0], 0, p[0] - r[2]), Math.max(r[1] - p[1], 0, p[1] - r[3]));

/** Ray (origin o, unit dir d) vs rect: entry distance or Infinity. Starting inside returns 0. */
export function rayRect(o, d, r, maxDist) {
  let t0 = 0, t1 = maxDist;
  for (let i = 0; i < 2; i++) {
    if (Math.abs(d[i]) < 1e-12) { if (o[i] < r[i] || o[i] > r[i + 2]) return Infinity; continue; }
    let a = (r[i] - o[i]) / d[i], b = (r[i + 2] - o[i]) / d[i]; if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) return Infinity;
  }
  return t0;
}

/** Shape (catalog §1 overlap) → test against a rect. Supports aabb (at = min corner unless centered), circle/sphere, point. */
export function shapeHitsRect(shape, r) {
  const at = shape.at;
  if (shape.kind === 'circle' || shape.kind === 'sphere') return rectDist(r, at) <= (shape.r ?? 0);
  if (shape.kind === 'cone') {
    const c = rectCenter(r), dx = c[0] - at[0], dy = c[1] - at[1], d = Math.hypot(dx, dy);
    if (d > (shape.r ?? 1) + Math.hypot(r[2] - r[0], r[3] - r[1]) / 2) return false;
    if (d < 1e-9) return true;
    const dir = shape.dir || [1, 0], dl = Math.hypot(dir[0], dir[1]) || 1;
    return (dx * dir[0] + dy * dir[1]) / (d * dl) >= Math.cos(((shape.angle ?? 90) / 2) * Math.PI / 180);
  }
  const s = shape.size || [0, 0];
  const box = shape.centered ? boxAround(at, s) : [at[0], at[1], at[0] + s[0], at[1] + s[1]];
  if (s[0] === 0 && s[1] === 0) return rectHas(r, at) || (at[0] === r[2] && at[1] >= r[1] && at[1] < r[3]);
  return rectsOverlap(box, r);
}

// ---------- binary min-heap keyed by f ----------
export class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(item, f) {
    const a = this.a; a.push([f, item]); let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top[1];
  }
}

/**
 * Generic A* over string node keys. neighbors(k) → [[k2, cost]]; h(k) heuristic;
 * goal(k) → bool. Returns key list or null. maxNodes bounds the search.
 * Ties break by insertion order (deterministic).
 */
export function astar(start, goal, neighbors, h, maxNodes = 200000) {
  const g = new Map([[start, 0]]), prev = new Map([[start, null]]), open = new Heap(), closed = new Set();
  let n = 0;
  open.push(start, h(start));
  while (open.size) {
    const k = open.pop();
    if (closed.has(k)) continue;
    if (goal(k)) { const out = []; for (let c = k; c !== null; c = prev.get(c)) out.unshift(c); return out; }
    closed.add(k); if (++n > maxNodes) return null;
    for (const [m, cost] of neighbors(k)) {
      const ng = g.get(k) + cost;
      if (ng < (g.get(m) ?? Infinity)) { g.set(m, ng); prev.set(m, k); open.push(m, ng + h(m)); }
    }
  }
  return null;
}

/** Breadth-first flood from start keys; returns the visited Set. */
export function flood(starts, neighbors, maxNodes = 1000000) {
  const seen = new Set(starts), q = [...starts];
  for (let i = 0; i < q.length && seen.size <= maxNodes; i++) for (const [m] of neighbors(q[i])) if (!seen.has(m)) { seen.add(m); q.push(m); }
  return seen;
}

/** Capability methods added by the spaces2d workstream (KERNEL_API §3 "Adding capabilities"); same meaning in every space. */
export const BOUNDS_CAPS = {
  bounds: ['bounds', 'inBounds'],      // bounds() → {min, max, wrap:[bool..]} current play window; inBounds(at, margin=0) → b
  wrap: ['wrapPos', 'delta'],          // wrapPos(at) → at folded into the space; delta(a, b) → shortest displacement a→b
  dynamics: ['impulse', 'velocity', 'setVelocity'], // impulse(e, v, rt, at?) adds v/mass; velocity(e) → v; setVelocity(e, v, rt)
};

// ---------- edge vocabulary shared by bounded continuous spaces ----------
// Each side of a bounds rect is one of: solid (clamp, zero velocity), open
// (nothing), kill (emit out_of_bounds once the body is fully outside), wrap.
export const EDGE_MODES = ['solid', 'open', 'kill', 'wrap'];
export const edgesParam = (dflt = 'solid') => ({
  type: 'object', default: { left: dflt, right: dflt, bottom: dflt, top: dflt },
  fields: Object.fromEntries(['left', 'right', 'bottom', 'top'].map(s => [s, { type: 'string', options: EDGE_MODES, default: dflt }])),
  effect: 'what each side of the bounds does: solid walls, open, kill (out_of_bounds event) or wrap-around',
});
/** Validate wrap edges come in pairs (left+right, bottom+top). */
export function checkEdges(edges, path) {
  const errors = [];
  if (!edges) return errors;
  for (const [a, b] of [['left', 'right'], ['bottom', 'top']]) if ((edges[a] === 'wrap') !== (edges[b] === 'wrap')) errors.push({ code: 'edges_wrap_unpaired', path, message: `edge '${a}' and '${b}' must both wrap or neither`, hint: `set both ${a} and ${b} to 'wrap'` });
  return errors;
}

/** Shortest displacement a→b on a (possibly) wrapped extent of size w (0 = no wrap). */
export const wrapDelta = (a, b, w) => { let d = b - a; if (w > 0) { d = mod(d + w / 2, w) - w / 2; } return d; };

/** JSON-safe number cleanup (avoid -0 and float noise in persisted state). */
export const tidy = v => (Math.abs(v) < 1e-12 ? 0 : +v.toFixed(9));

// ---------- layered cell store (tilemap, grid) ----------
// Cells are persisted compactly in rt.state.spaces[sid]: a palette of block ids
// and, per layer, one string per row whose char codes index the palette (row
// strings clone fast in snapshots and stay JSON). Edits after game_start append
// {t, at, layer, from, to, by} to the edit log and emit cell_changed; bake() and
// edits made while generators install form the unlogged baseline.
const BASE = 0x30;
export function cellStore(rt, sid, { W, H, layers, wrapX = false, wrapY = false }) {
  let started = false;
  rt.on('game_start', () => { started = true; });
  rt.onRestore(() => { started = true; });
  const st = () => { const s = rt.state.spaces[sid]; s.palette ??= [null]; s.cells ??= Object.fromEntries(layers.map(l => [l, []])); s.log ??= []; return s; };
  const norm = (x, y) => [wrapX ? mod(x, W) : x, wrapY ? mod(y, H) : y];
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const index = (s, block) => { let i = s.palette.indexOf(block); if (i < 0) { i = s.palette.length; s.palette.push(block); } return i; };
  const read = (s, layer, x, y) => { const row = s.cells[layer]?.[y]; return row ? s.palette[row.charCodeAt(x) - BASE] ?? null : null; };
  const write = (s, layer, x, y, block) => {
    const rows = s.cells[layer] ??= [];
    let row = rows[y]; if (!row) { if (block == null) return; row = String.fromCharCode(BASE).repeat(W); }
    const ch = String.fromCharCode(BASE + (block == null ? 0 : index(s, block)));
    row = row.slice(0, x) + ch + row.slice(x + 1);
    rows[y] = /^0+$/.test(row) ? null : row;
  };
  const store = {
    layers,
    get(at, layer = layers[0]) { const [x, y] = norm(Math.floor(at[0]), Math.floor(at[1])); return inside(x, y) ? read(st(), layer, x, y) : null; },
    /** Returns false when unchanged or out of bounds. */
    set(at, block, rt, by = null, layer = layers[0]) {
      if (!layers.includes(layer)) return false;
      const [x, y] = norm(Math.floor(at[0]), Math.floor(at[1])); if (!inside(x, y)) return false;
      const s = st(), from = read(s, layer, x, y); block ??= null; if (from === block) return false;
      write(s, layer, x, y, block);
      if (started) { const entry = { t: rt.state.frame, at: [x, y], layer, from, to: block, by }; s.log.push(entry); rt.emit('cell_changed', { at: [x, y], layer, from, to: block, by }); }
      return true;
    },
    /** Bulk baseline: cells [{at, block, layer?}] or fn(at, layer) → block over box (inclusive, default all). */
    bake(cells, { layer = layers[0], box = [[0, 0], [W - 1, H - 1]] } = {}) {
      const s = st(); let n = 0;
      if (typeof cells === 'function') {
        for (let y = Math.max(0, box[0][1]); y <= Math.min(H - 1, box[1][1]); y++) for (let x = Math.max(0, box[0][0]); x <= Math.min(W - 1, box[1][0]); x++) { const b = cells([x, y], layer); if (b !== undefined && read(s, layer, x, y) !== (b ?? null)) { write(s, layer, x, y, b ?? null); n++; } }
      } else for (const c of cells) { const [x, y] = norm(Math.floor(c.at[0]), Math.floor(c.at[1])), l = c.layer ?? layer; if (inside(x, y) && layers.includes(l)) { write(s, l, x, y, c.block ?? null); n++; } }
      return n;
    },
    /** Non-empty cells in an inclusive box. */
    cellsIn(box, layer = layers[0]) {
      const s = st(), out = [], rows = s.cells[layer] || [];
      const [a, b] = box, x0 = Math.max(0, Math.floor(Math.min(a[0], b[0]))), x1 = Math.min(W - 1, Math.floor(Math.max(a[0], b[0])));
      for (let y = Math.max(0, Math.floor(Math.min(a[1], b[1]))); y <= Math.min(H - 1, Math.floor(Math.max(a[1], b[1]))); y++) {
        const row = rows[y]; if (!row) continue;
        for (let x = x0; x <= x1; x++) { const c = row.charCodeAt(x) - BASE; if (c) out.push({ at: [x, y], block: s.palette[c] }); }
      }
      return out;
    },
    fill(box, block, rt, by = null, layer = layers[0]) { const [a, b] = box; let n = 0; for (let y = Math.min(a[1], b[1]); y <= Math.max(a[1], b[1]); y++) for (let x = Math.min(a[0], b[0]); x <= Math.max(a[0], b[0]); x++) if (store.set([x, y], block, rt, by, layer)) n++; return n; },
    log: (since = -1) => st().log.filter(e => e.t > since),
  };
  return store;
}
