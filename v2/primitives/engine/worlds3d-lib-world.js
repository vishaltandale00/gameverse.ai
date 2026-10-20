// Shared world model for 3D spaces and their generators (worlds3d workstream).
//
// A 3D space (voxel or mesh3d) owns one WorldModel. Generators never write
// generated content into the edit log; they *contribute* to the model:
//   - fields: named scalar functions of (x, z) with bounded modifiers
//     (height, biome, water level...). Roads, districts and lakes flatten or
//     carve by adding height modifiers.
//   - layers (voxel): cell passes run per chunk, lazily and deterministically.
//   - objects (mesh3d, and the index for voxel): placed colliders and props,
//     eager lists plus lazy per-tile object layers.
// Contributions are registered at install and built lazily, in stage order,
// the first time the space is queried, from the space seed kept in state.
// Only runtime edits are persisted (edit log / object overlay), so a snapshot
// stays small however large the world is.
import { checkFields } from '../../kernel/params.js';
import { subSeed } from './worlds3d-lib-noise.js';

export const STAGES = { terrain: 0, erosion: 5, biomes: 10, water: 20, city: 30, roads: 40, structures: 50, caves: 60, ores: 70, scatter: 80 };

/** Apply card defaults to a generator config (preflight normalises only space configs). */
export function withDefaults(card, config) { return checkFields(card.params || {}, config || {}, '', [], null); }

// ---------- zone geometry (bounds | center+r | polygon | rect) ----------
const inPoly = (poly, x, z) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
/** Axis-aligned [x0, z0, x1, z1] footprint of a zone, or null when it has no spatial shape. */
export function zoneBox(z) {
  if (z?.bounds?.min) return [z.bounds.min[0], z.bounds.min[2] ?? z.bounds.min[1], z.bounds.max[0], z.bounds.max[2] ?? z.bounds.max[1]];
  const c = z?.center || z?.bounds?.center;
  if (c) { const r = z.r ?? z.bounds?.r ?? 0; return [c[0] - r, c[1] - r, c[0] + r, c[1] + r]; }
  if (z?.polygon?.length) { const xs = z.polygon.map(p => p[0]), zs = z.polygon.map(p => p[1]); return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]; }
  if (z?.rect) return z.rect.slice(0, 4);
  return null;
}
/** Vertical range [y0, y1] of a zone (bounds zones only; others span all heights). */
export const zoneYRange = z => (z?.bounds?.min && z.bounds.min.length === 3 ? [z.bounds.min[1], z.bounds.max[1]] : [-Infinity, Infinity]);
export function zoneHas(z, x, y, zz) {
  if (z?.bounds?.min) {
    const [x0, z0, x1, z1] = zoneBox(z), [y0, y1] = zoneYRange(z);
    return x >= x0 && x < x1 && zz >= z0 && zz < z1 && (y === undefined || (y >= y0 && y < y1));
  }
  const c = z?.center || z?.bounds?.center;
  if (c) { const r = z.r ?? z.bounds?.r ?? 0; return (x - c[0]) ** 2 + (zz - c[1]) ** 2 <= r * r; }
  if (z?.polygon?.length) return inPoly(z.polygon, x, zz);
  if (z?.rect) return x >= z.rect[0] && x < z.rect[2] && zz >= z.rect[1] && zz < z.rect[3];
  return false;
}
export function zoneCenter(z) {
  const c = z?.center || z?.bounds?.center;
  if (c) return [c[0], c[1]];
  if (z?.polygon?.length) return [z.polygon.reduce((s, p) => s + p[0], 0) / z.polygon.length, z.polygon.reduce((s, p) => s + p[1], 0) / z.polygon.length];
  const b = zoneBox(z);
  return b ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : null;
}
export function zoneArea(z) {
  const c = z?.center || z?.bounds?.center;
  if (c) return Math.PI * (z.r ?? z.bounds?.r ?? 0) ** 2;
  if (z?.polygon?.length) { let a = 0; for (let i = 0, j = z.polygon.length - 1; i < z.polygon.length; j = i++) a += (z.polygon[j][0] + z.polygon[i][0]) * (z.polygon[j][1] - z.polygon[i][1]); return Math.abs(a / 2); }
  const b = zoneBox(z);
  return b ? (b[2] - b[0]) * (b[3] - b[1]) : Infinity;
}
/** Horizontal distance from (x, z) to the zone's shape: 0 inside. */
export function zoneDistance(z, x, y, zz) {
  if (zoneHas(z, x, y, zz)) return 0;
  const c = z?.center || z?.bounds?.center;
  if (c) return Math.max(0, Math.hypot(x - c[0], zz - c[1]) - (z.r ?? z.bounds?.r ?? 0));
  const b = zoneBox(z); if (!b) return Infinity;
  const dx = Math.max(b[0] - x, 0, x - b[2]), dz = Math.max(b[1] - zz, 0, zz - b[3]);
  const [y0, y1] = zoneYRange(z), dy = y === undefined ? 0 : Math.max(y0 - y, 0, y - y1);
  return Math.hypot(dx, dy, dz);
}
/** Nearest-first sort key for nested zones: the smallest containing zone is the entity's zone. */
export const zonesContaining = (zones, x, y, z) => zones.filter(zn => zoneHas(zn, x, y, z)).sort((a, b) => zoneArea(a) - zoneArea(b));

// ---------- geometry helpers ----------
export function segDist2(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  const qx = ax + t * dx, qz = az + t * dz;
  return { d2: (px - qx) ** 2 + (pz - qz) ** 2, t };
}
/** Ramer-Douglas-Peucker simplification of [[x,z]...] points. */
export function simplify(points, eps) {
  if (points.length < 3) return points.slice();
  let idx = -1, best = 0;
  const [a, b] = [points[0], points[points.length - 1]];
  for (let i = 1; i < points.length - 1; i++) { const d = segDist2(points[i][0], points[i][1], a[0], a[1], b[0], b[1]).d2; if (d > best) { best = d; idx = i; } }
  if (best <= eps * eps) return [a, b];
  return [...simplify(points.slice(0, idx + 1), eps).slice(0, -1), ...simplify(points.slice(idx), eps)];
}
/** Chaikin corner cutting, keeps the end points. */
export function chaikin(points, iterations = 2) {
  let p = points;
  for (let k = 0; k < iterations && p.length > 2; k++) {
    const out = [p[0]];
    for (let i = 0; i < p.length - 1; i++) { const [a, b] = [p[i], p[i + 1]]; out.push(a.map((v, j) => 0.75 * v + 0.25 * b[j]), a.map((v, j) => 0.25 * v + 0.75 * b[j])); }
    out.push(p[p.length - 1]); p = out;
  }
  return p;
}
export const polylineLength = pts => pts.reduce((s, p, i) => (i ? s + Math.hypot(...p.map((v, j) => v - pts[i - 1][j])) : 0), 0);
/** Offset a polyline sideways (x,z plane) by `offset`; keeps y if present. */
export function offsetPolyline(pts, offset) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const xi = 0, zi = p.length === 3 ? 2 : 1;
    const dx = b[xi] - a[xi], dz = b[zi] - a[zi], l = Math.hypot(dx, dz) || 1;
    const q = p.slice(); q[xi] += (-dz / l) * offset; q[zi] += (dx / l) * offset; return q;
  });
}

// ---------- min-heap and A* ----------
export class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v, top = v[0], lk = k.pop(), lv = v.pop(), n = k.length;
    if (n) {
      let i = 0;
      for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && k[c + 1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c; }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}
/**
 * Generic A* over string-keyed nodes. neighbors(node, push(next, cost)).
 * Returns { path: node[] | null, expanded, truncated }. Deterministic: ties
 * break by insertion order through a monotonic epsilon.
 */
export function astar({ start, isGoal, neighbors, h, key, maxNodes = 20000 }) {
  const open = new MinHeap(), g = new Map(), prev = new Map(), nodes = new Map(), closed = new Set();
  const sk = key(start); g.set(sk, 0); nodes.set(sk, start); open.push(h(start), sk);
  let expanded = 0, tie = 0;
  while (open.size) {
    const ck = open.pop(); if (closed.has(ck)) continue;
    const cur = nodes.get(ck);
    if (isGoal(cur)) { const path = []; for (let k = ck; k !== undefined; k = prev.get(k)) path.unshift(nodes.get(k)); return { path, expanded, truncated: false }; }
    closed.add(ck);
    if (++expanded > maxNodes) return { path: null, expanded, truncated: true };
    const gc = g.get(ck);
    neighbors(cur, (n, cost) => {
      const nk = key(n); if (closed.has(nk)) return;
      const ng = gc + cost;
      if (ng < (g.get(nk) ?? Infinity)) { g.set(nk, ng); prev.set(nk, ck); nodes.set(nk, n); open.push(ng + h(n) + (tie++) * 1e-9, nk); }
    });
  }
  return { path: null, expanded, truncated: false };
}

// ---------- multi-space shared services ----------
/**
 * Services are global names (rt.provide); a game can have several 3D spaces.
 * A shared service keeps one implementation per space: calling it (or its
 * methods) uses the space named by the last argument, else the first space.
 */
export function sharedService(rt, name, sid, impl, methods = []) {
  const reg = (rt.caches[`worlds3d:svc:${name}`] ??= { bySpace: new Map(), first: null });
  reg.bySpace.set(sid, impl); reg.first ??= sid;
  if (rt.hasService(name) && rt.service(name).__worlds3d) return rt.service(name);
  const pick = s => reg.bySpace.get(s && reg.bySpace.has(s) ? s : reg.first);
  const svc = (...args) => { const s = args.length && typeof args[args.length - 1] === 'string' && reg.bySpace.has(args[args.length - 1]) ? args.pop() : null; return pick(s).call(...args); };
  svc.__worlds3d = true;
  svc.of = s => reg.bySpace.get(s) || null;
  svc.spaces = () => [...reg.bySpace.keys()];
  for (const m of methods) svc[m] = (...args) => { const s = args.length && typeof args[args.length - 1] === 'string' && reg.bySpace.has(args[args.length - 1]) ? args.pop() : null; return pick(s)[m](...args); };
  rt.provide(name, svc);
  return svc;
}

// ---------- the world model ----------
const BUCKET = 64;
export class WorldModel {
  constructor(rt, sid, kind, opts = {}) {
    this.rt = rt; this.sid = sid; this.kind = kind; this.opts = opts;
    this.contributions = []; this.reset();
  }
  reset() {
    this.built = false; this.building = false; this.seedUsed = null;
    this.fields = new Map(); this.mods = new Map();
    this.layers = []; this.objects = []; this.objectLayers = []; this.objectIndex = null;
    this.problems = []; this.info = {}; this.cache = {}; this.version = (this.version || 0) + 1;
  }
  get state() { return this.rt.state.spaces[this.sid]; }
  get seed() { return this.state.seed; }
  zones() { return this.rt.doc.spaces.find(s => s.id === this.sid)?.zones || []; }
  zone(id) { return this.zones().find(z => z.id === id) || null; }
  /** World x/z extent [x0, z0, x1, z1]: the space's own bounds, else the union of zone footprints. */
  extent() {
    if (this.opts.extent) return this.opts.extent;
    const boxes = this.zones().map(zoneBox).filter(Boolean);
    if (!boxes.length) return [-256, -256, 256, 256];
    return [Math.min(...boxes.map(b => b[0])), Math.min(...boxes.map(b => b[1])), Math.max(...boxes.map(b => b[2])), Math.max(...boxes.map(b => b[3]))];
  }
  /** Register a deterministic build step: build(model, seed) runs once per seed, in stage order. */
  contribute(id, stage, build) { this.contributions.push({ id, stage, order: this.contributions.length, build }); if (this.built) this.reset(); }
  ensure() {
    if (this.built && this.seedUsed === this.seed) return this;
    if (this.building) return this;
    if (this.built) this.reset();
    this.building = true; this.seedUsed = this.seed;
    const list = [...this.contributions].sort((a, b) => a.stage - b.stage || a.order - b.order);
    for (const c of list) c.build(this, subSeed(this.seed, c.id));
    this.building = false; this.built = true;
    this.objectIndex = null;
    this.onBuilt?.(this);
    return this;
  }
  // fields
  define(name, base) { this.fields.set(name, base); }
  has(name) { return this.fields.has(name); }
  /** Add a modifier: { bounds:[x0,z0,x1,z1], priority?, apply(x, z, value) -> value }. */
  modify(name, mod) {
    const m = this.mods.get(name) || { list: [], buckets: new Map(), seq: 0 };
    mod.seq = m.seq++; mod.priority ??= 0; m.list.push(mod);
    const [x0, z0, x1, z1] = mod.bounds;
    for (let bx = Math.floor(x0 / BUCKET); bx <= Math.floor(x1 / BUCKET); bx++) for (let bz = Math.floor(z0 / BUCKET); bz <= Math.floor(z1 / BUCKET); bz++) {
      const k = bx * 73856093 ^ bz * 19349663; let b = m.buckets.get(k); if (!b) m.buckets.set(k, (b = []));
      b.push(mod);
    }
    m.dirty = true; this.mods.set(name, m);
  }
  at(name, x, z, fallback = null) {
    const base = this.fields.get(name);
    let v = base ? base(x, z) : fallback;
    const m = this.mods.get(name); if (!m) return v;
    if (m.dirty) { for (const b of m.buckets.values()) b.sort((p, q) => p.priority - q.priority || p.seq - q.seq); m.dirty = false; }
    const b = m.buckets.get(Math.floor(x / BUCKET) * 73856093 ^ Math.floor(z / BUCKET) * 19349663);
    if (b) for (const mod of b) { const [x0, z0, x1, z1] = mod.bounds; if (x >= x0 && x <= x1 && z >= z0 && z <= z1) v = mod.apply(x, z, v); }
    return v;
  }
  // voxel cell layers
  addLayer(layer) { layer.order ??= 0; layer.seq = this.layers.length; this.layers.push(layer); this.layers.sort((a, b) => a.order - b.order || a.seq - b.seq); }
  // objects
  addObjects(list) { for (const o of list) this.objects.push(o); this.objectIndex = null; }
  addObjectLayer(layer) { this.objectLayers.push(layer); }
  problem(code, message, data = {}) { this.problems.push({ code, message, ...data }); }
}

/** The model for a space: created by the space at install, found by its generators. */
export function worldModel(rt, sid, kind, opts) {
  const k = `worlds3d:model:${sid}`;
  if (!rt.caches[k]) rt.caches[k] = new WorldModel(rt, sid, kind, opts);
  else if (kind) { rt.caches[k].kind = kind; Object.assign(rt.caches[k].opts, opts || {}); }
  return rt.caches[k];
}

/** Resolve a generator instance to its space and model; null when the space is not a worlds3d space. */
export function generatorModel(rt, instance) {
  const sid = instance.space ?? rt.doc.spaces?.[0]?.id;
  const m = rt.caches[`worlds3d:model:${sid}`];
  return m ? m : null;
}

/** Block definitions from content.blocks: unknown ids are solid and opaque. */
export function blockTable(doc) {
  const defs = new Map();
  for (const b of doc.content?.blocks || []) defs.set(b.id, { id: b.id, solid: b.solid !== false, transparent: Boolean(b.transparent), fluid: b.fluid ?? (b.solid === false && /water|lava|acid|oil|fluid/.test(b.id)), color: b.color, tags: b.tags || [] });
  return defs;
}

// ---------- entity operations shared by 3D spaces ----------
export const v3 = a => [a?.[0] ?? 0, a?.[1] ?? 0, a?.[2] ?? 0];
/**
 * Position, zone, overlap and entity-raycast operations over entities whose
 * `at` is the bottom-centre (feet) of an axis-aligned body box. Zone
 * membership is tracked per entity in space state (`members`), so nested
 * zones each get enter/leave events; entity.zone is the smallest containing zone.
 */
export function entityOps({ rt, sid, model, defaultBody, st }) {
  const bodySize = e => v3(e.components?.body?.size || defaultBody);
  const boxOf = (e, at = e.at) => { const s = bodySize(e), p = v3(at); return { min: [p[0] - s[0] / 2, p[1], p[2] - s[2] / 2], max: [p[0] + s[0] / 2, p[1] + s[1], p[2] + s[2] / 2] }; };
  const entities = () => Object.values(rt.state.entities).filter(e => e.space === sid && Array.isArray(e.at));
  const zones = () => model.zones();
  const ops = {
    bodySize, boxOf, entities, zones,
    track(e, rt) {
      const p = v3(e.at), inside = zonesContaining(zones(), p[0], p[1], p[2]).map(z => z.id);
      const s = st(); s.members ??= {};
      const before = s.members[e.id] || [];
      for (const z of before) if (!inside.includes(z)) rt.emit('leave_zone', { who: e.id, zone: z });
      for (const z of inside) if (!before.includes(z)) rt.emitTyped('enter_zone', z, { who: e.id, zone: z });
      s.members[e.id] = inside; e.zone = inside[0] ?? null;
    },
    untrack(e) { delete st().members?.[e.id]; },
    inZone: (e, zone) => { const z = zones().find(x => x.id === zone); const p = v3(e.at); return Boolean(z) && zoneHas(z, p[0], p[1], p[2]); },
    zoneAt: at => { const p = v3(at); return zonesContaining(zones(), p[0], p[1], p[2])[0]?.id ?? null; },
    entitiesAt: at => { const p = v3(at); return entities().filter(e => { const b = boxOf(e); return p.every((v, i) => v >= b.min[i] - 1e-9 && v <= b.max[i] + 1e-9); }).map(e => e.id); },
    nearest(e, target) {
      const p = v3(e.at), z = zones().find(x => x.id === target);
      if (z) return zoneDistance(z, p[0], p[1], p[2]);
      let best = null;
      for (const o of entities()) if (o !== e && (o.id === target || o.archetype === target)) { const d = Math.hypot(...v3(o.at).map((v, i) => v - p[i])); if (best === null || d < best) best = d; }
      return best;
    },
    /** shape: {kind:'aabb'|'sphere'|'circle'|'cone', at, size?, r?, dir?, angle?}; aabb spans at..at+size grown by r (as engine.space.test). */
    overlap(shape, filter = () => true) {
      const at = v3(shape.at), r = shape.r ?? 0, kind = shape.kind || (shape.size ? 'aabb' : 'sphere');
      return entities().filter(filter).filter(e => {
        const b = boxOf(e), closest = at.map((v, i) => Math.max(b.min[i], Math.min(v, b.max[i])));
        if (kind === 'aabb') { const sz = v3(shape.size || [0, 0, 0]); return b.min.every((m, i) => m <= at[i] + sz[i] + r && b.max[i] >= at[i] - r); }
        if (kind === 'circle') return Math.hypot(closest[0] - at[0], closest[2] - at[2]) <= r;
        const dist = Math.hypot(...closest.map((v, i) => v - at[i]));
        if (dist > r) return false;
        if (kind === 'cone') {
          const dir = v3(shape.dir || [0, 0, 1]), c = b.min.map((m, i) => (m + b.max[i]) / 2 - at[i]), lc = Math.hypot(...c) || 1, ld = Math.hypot(...dir) || 1;
          return dist === 0 || (c[0] * dir[0] + c[1] * dir[1] + c[2] * dir[2]) / (lc * ld) >= Math.cos(((shape.angle ?? 45) * Math.PI) / 180);
        }
        return true;
      }).map(e => e.id);
    },
    /** Nearest entity box hit along unit ray u from o within maxDist (slab test). */
    rayEntities(o, u, maxDist, { ignore = [], filter } = {}) {
      const skip = new Set([].concat(ignore)); let best = null;
      for (const e of entities()) {
        if (skip.has(e.id) || (filter && !filter(e))) continue;
        const b = boxOf(e); let t0 = 0, t1 = best ? best.dist : maxDist, axis = -1;
        for (let i = 0; i < 3 && t0 <= t1; i++) {
          if (!u[i]) { if (o[i] < b.min[i] || o[i] > b.max[i]) t0 = Infinity; continue; }
          let ta = (b.min[i] - o[i]) / u[i], tb = (b.max[i] - o[i]) / u[i]; if (ta > tb) [ta, tb] = [tb, ta];
          if (ta > t0) { t0 = ta; axis = i; } t1 = Math.min(t1, tb);
        }
        if (t0 <= t1 && t0 <= (best ? best.dist : maxDist)) { const normal = [0, 0, 0]; if (axis >= 0) normal[axis] = -Math.sign(u[axis]); best = { hit: 'entity', id: e.id, at: o.map((v, i) => v + u[i] * t0), normal, dist: t0 }; }
      }
      return best;
    },
    distance(a, b, metric, pathFn) {
      const p = v3(a), q = v3(b);
      if (metric === 'manhattan') return p.reduce((s, v, i) => s + Math.abs(v - q[i]), 0);
      if (metric === 'path') { const r = pathFn(p, q); if (!r) return Infinity; let s = 0; for (let i = 1; i < r.length; i++) s += Math.hypot(...r[i].map((v, j) => v - r[i - 1][j])); return s; }
      return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    },
  };
  return ops;
}
