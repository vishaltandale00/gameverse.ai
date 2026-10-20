// Shared helpers for the generate2d workstream's generators (engine.generate.*).
// Generators are space-agnostic: they plan on a local raster, prove what they
// promise on that raster, then write through whatever the bound space offers:
// - cells: api.bake(cells, rt) when present (base layer, no edit log), else
//   api.setCell(at, block, rt, 'generate');
// - zones: api.addZone(zone, rt) when present, else a copy of rt.doc with the
//   zones appended (re-applied after hot-loads; see kernel/requests/generate2d.md);
// - entities: rt.spawn; services: rt.provide(name) and rt.provide(`${name}:${space}`).
// Determinism: one draw from rt.random() seeds every sub-stream (attempt, area,
// room...), so retries never consume the world RNG unpredictably.
import { seedFrom, random } from '../../kernel/rng.js';
import { checkFields } from '../../kernel/params.js';

/**
 * Generator configs with defaults applied. Kernel preflight normalizes `with`
 * for spaces/systems/graphics but returns generators' raw `with`
 * (kernel/requests/generate2d.md), so every generator install calls this.
 */
export function withDefaults(card, config = {}) {
  // Defaults are fed back through the schema so nested defaults (list items, object fields) apply too.
  const params = card.params || {}, filled = { ...config };
  for (const [k, s] of Object.entries(params)) if (filled[k] === undefined && s.default !== undefined) filled[k] = structuredClone(s.default);
  return checkFields(params, filled, '', [], null, true);
}

/** One world-RNG draw → a base seed for this generator instance. */
export const drawSeed = rt => Math.floor(rt.random() * 4294967296) >>> 0;

/** Local deterministic stream for (seed, ...parts): r() in [0,1) plus int/range/pick/chance/shuffle. */
export function stream(...parts) {
  const s = { rng: seedFrom(parts.join(':')) };
  const r = () => random(s);
  r.int = n => Math.floor(random(s) * n);
  r.range = (a, b) => a + Math.floor(random(s) * (b - a + 1));
  r.pick = list => list[Math.floor(random(s) * list.length)];
  r.chance = p => random(s) < p;
  r.shuffle = list => { for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(random(s) * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; } return list; };
  r.weighted = (list, w = x => x.weight ?? 1) => { const total = list.reduce((n, x) => n + Math.max(0, w(x)), 0); let t = random(s) * total; for (const x of list) { t -= Math.max(0, w(x)); if (t < 0) return x; } return list[list.length - 1]; };
  return r;
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const key = (x, y) => `${x},${y}`;

/** A w×h raster of small ints or strings (row-major, y up or down as the caller decides). */
export class Raster {
  constructor(w, h, fill = 0) { this.w = w; this.h = h; this.cells = new Array(w * h).fill(fill); }
  in(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  get(x, y, outside = undefined) { return this.in(x, y) ? this.cells[y * this.w + x] : outside; }
  set(x, y, v) { if (this.in(x, y)) this.cells[y * this.w + x] = v; }
  rect(x, y, w, h, v) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, v); }
  rows(map = v => v) { const out = []; for (let y = 0; y < this.h; y++) { let s = ''; for (let x = 0; x < this.w; x++) s += map(this.get(x, y)); out.push(s); } return out; }
}

/** Breadth-first search; neighbors(node) → nodes; id(node) → string. Returns Map(id → {node, d, prev}). */
export function bfs(starts, neighbors, id = n => String(n)) {
  const seen = new Map(), q = [];
  for (const s of [].concat(starts)) if (!seen.has(id(s))) { seen.set(id(s), { node: s, d: 0, prev: null }); q.push(s); }
  for (let i = 0; i < q.length; i++) {
    const n = q[i], d = seen.get(id(n)).d;
    for (const m of neighbors(n)) { const k = id(m); if (!seen.has(k)) { seen.set(k, { node: m, d: d + 1, prev: id(n) }); q.push(m); } }
  }
  return seen;
}

/** The space this generator is bound to: api, doc entry, 2D size and zone lookups. */
export function spaceOf(rt, instance) {
  const sid = instance.space ?? rt.doc.spaces?.[0]?.id, api = rt.space(sid);
  const entry = () => rt.doc.spaces.find(s => s.id === sid) || {};
  const size = api.size || entry().with?.size || null;
  const zones = () => { const doc = entry().zones || [], gen = rt.state.spaces[sid]?.zones; return Array.isArray(gen) ? [...doc, ...gen.filter(z => !doc.some(d => d.id === z.id))] : doc; };
  return { sid, api, entry, size, zones, zone: id => zones().find(z => z.id === id) };
}

/** A zone's 2D rect [x0,y0,x1,y1) on a plane ('xy' or 'xz'), from rect or bounds. */
export function zoneRect(z, plane = 'xy') {
  if (!z) return null;
  if (Array.isArray(z.rect)) return z.rect.slice(0, 4);
  if (z.bounds?.min && z.bounds?.max) { const [a, b] = plane === 'xz' ? [0, 2] : [0, 1]; return [z.bounds.min[a], z.bounds.min[b], z.bounds.max[a], z.bounds.max[b]]; }
  return null;
}

/** Map a planar (u, v) to the space's coordinate: [u, v] on 'xy', [u, floor, v] on 'xz'. */
export const planeAt = (plane, u, v, floor = 0) => (plane === 'xz' ? [u, floor, v] : [u, v]);

/**
 * Cell writer. set(at, block) records the cell; flush() writes all of them once,
 * through api.bake when the space has it (no edit log), else setCell. A null
 * block clears the cell only where something is there.
 */
export function cellWriter(rt, space) {
  const { api } = space, out = [];
  return {
    can: typeof api.bake === 'function' || typeof api.setCell === 'function',
    set(at, block) { out.push({ at, block: block ?? null }); },
    flush() {
      if (typeof api.bake === 'function') { if (out.length) api.bake(out, rt); }
      else if (typeof api.setCell === 'function') for (const c of out) { if (c.block == null && api.getCell?.(c.at) == null) continue; api.setCell(c.at, c.block, rt, 'generate'); }
      const n = out.length; out.length = 0; return n;
    },
  };
}

/** Add generated zones to the space: api.addZone when present, else through a fresh copy of rt.doc. */
export function addZones(rt, space, zones) {
  if (!zones.length) return;
  if (typeof space.api.addZone === 'function') { for (const z of zones) space.api.addZone(z, rt); return; }
  const apply = () => {
    const doc = rt.doc, s = doc.spaces.find(x => x.id === space.sid); if (!s) return;
    const have = new Set((s.zones || []).map(z => z.id)), add = zones.filter(z => !have.has(z.id));
    if (add.length) rt.doc = { ...doc, spaces: doc.spaces.map(x => (x === s ? { ...s, zones: [...(s.zones || []), ...structuredClone(add)] } : x)) };
  };
  apply();
  rt.on('content_added', apply); // rt.extend replaces rt.doc with the planner's doc; put generated zones back
}

/** Replace existing zone entries (e.g. exits appended to doc zones) in rt.doc, keeping identity fresh. */
export function patchZones(rt, space, byId) {
  const apply = () => {
    const doc = rt.doc, s = doc.spaces.find(x => x.id === space.sid); if (!s) return;
    rt.doc = { ...doc, spaces: doc.spaces.map(x => (x === s ? { ...s, zones: (s.zones || []).map(z => (byId[z.id] ? { ...z, ...structuredClone(byId[z.id]) } : z)) } : x)) };
  };
  apply(); rt.on('content_added', apply);
}

/** Store the result, publish services and announce: generated + generated:<space>. */
/** Document path of a generator instance: spaces[i].generators[j] (instance.key is spaces.<id>.generators[j]). */
export function docPath(rt, instance) {
  const si = rt.doc.spaces.findIndex(s => s.id === instance.space), gj = /generators\[(\d+)\]$/.exec(instance.key || '')?.[1];
  return si >= 0 && gj !== undefined ? `spaces[${si}].generators[${gj}]` : instance.key;
}
const WARNINGS = new Set(['exit_unmatched', 'chunk_impassable', 'chunk_tier_missing', 'role_shortfall', 'dungeon_cramped', 'start_crowded', 'warp_unpaired']);
const INFO = new Set(['graph_fallback', 'board_fallback', 'dungeon_fallback', 'chunks_fallback']);

/**
 * Store the result, publish services and announce: generated + generated:<space>.
 * Problems take verify()'s shape {code, path, message, hint?, severity}, with
 * paths made absolute (spaces[i].generators[j].with.…); every generator's
 * problems are also listed by the shared `generation` service.
 */
export function publish(rt, instance, space, id, result, services = {}) {
  const st = rt.store(instance.key), base = `${docPath(rt, instance)}.with`;
  result.problems = (result.problems || []).map(p => ({ ...p, path: p.path && !p.path.startsWith('spaces[') ? `${base}.${p.path}` : p.path || base, severity: p.severity || (WARNINGS.has(p.code) ? 'warning' : INFO.has(p.code) ? 'info' : 'error'), generator: id }));
  Object.assign(st, result);
  const reg = (rt.caches.generation ??= []); if (!reg.includes(instance.key)) reg.push(instance.key);
  rt.provide('generation', { instances: () => reg.slice(), problems: () => reg.flatMap(k => rt.store(k).problems || []) });
  for (const [name, api] of Object.entries(services)) { rt.provide(name, api); rt.provide(`${name}:${space.sid}`, api); }
  rt.emitTyped('generated', space.sid, { generator: id, key: instance.key, problems: (result.problems || []).length, attempts: result.attempts ?? 1, fallback: Boolean(result.fallback) });
  for (const p of result.problems) rt.emit('generate_problem', { ...p });
}

/**
 * Generators plan in cells; entities are anchored as the space says (KERNEL_API §3):
 * 'center' spaces take the body-box centre, 'min'/'cell' the cell itself, 'slot' a zone id.
 */
export function entityAt(space, cell, size) {
  if (!Array.isArray(cell) || space.api.anchor !== 'center') return cell;
  return cell.map((v, i) => v + (size?.[i] ?? 1) / 2);
}
/** The cell an entity's body-box minimum sits in (inverse of entityAt). */
export function cellOfEntity(space, e) {
  if (!Array.isArray(e?.at)) return e?.at;
  const size = e.components?.body?.size;
  return e.at.map((v, i) => Math.floor((space.api.anchor === 'center' ? v - (size?.[i] ?? 1) / 2 : v) + 1e-6));
}
/** Move an entity so its body sits on `cell`. */
export const placeOn = (rt, space, e, cell) => space.api.setPos(e, entityAt(space, cell, e.components?.body?.size), rt);

/** Spawn at a cell (converted to the space's anchor); never collides with an existing id. */
export function spawnAt(rt, space, archetype, cell, components = {}, id) {
  const free = id && !rt.state.entities[id] ? id : undefined;
  const size = components.body?.size ?? rt.archetype(archetype)?.components?.body?.size;
  return rt.spawn(archetype, { space: space.sid, at: entityAt(space, cell, size), components, id: free });
}

export const problem = (code, path, message, extra = {}) => ({ code, path, message, ...extra });
export const rectsOverlap = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
export const inRect = (r, x, y) => x >= r[0] && y >= r[1] && x < r[2] && y < r[3];
