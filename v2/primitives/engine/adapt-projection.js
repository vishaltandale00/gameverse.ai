// engine.adapt.projection: a space kind projected onto a region of another space (ARCHITECTURE.md §1.3).
// A board on a patch of a tile overworld, a race track laid along a path through a tilemap or a 3D city, a
// side-view plane standing inside a 3D world. The instance's `id` names a sub-space of the projected kind:
// primitives bound to that id (instance.space) and entities living in it get every capability of the
// projected kind (position, distance, navigate, pathfind, reachable, occupancy, los...), because the kind's
// own space primitive runs the region in its local coordinates. The host supplies the rest:
//  - placement: region coordinates map to host coordinates through a linear frame (origin + axes) or along a
//    host polyline (`path`: projected axis 0 runs along it, the others across it), so toHost/fromHost relate
//    the two, and every region entity mirrors its host position in components.projected {space, at};
//  - terrain: cell kinds (grid, tilemap) sample the host's cells through its editCells interface (getCell),
//    optionally renaming blocks, and resample when the host's cells change;
//  - zones: region zones are the kind's own (in region coordinates); a zone the region lacks is asked of the
//    host at the entity's host position, so host zones still mean something inside the region.
// Nothing here knows a game: the kind, its params, the frame and the zones all come from the document.
import { checkFields } from '../../kernel/params.js';
import grid from './space-grid.js';
import tilemap from './space-tilemap.js';
import arena2d from './space-arena2d.js';
import track from './space-track.js';

const ID = 'engine.adapt.projection';
const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/**
 * The kinds a region can be: how each lays its local axes into a host (engine knowledge, not game knowledge).
 * plane: the default host plane in a 3D host ('ground' = x/z, 'vertical' = x/y); path: axis 0 runs along a host
 * polyline; center/units: the region coordinate that sits on the frame origin or path, and the host length of
 * one unit along each local axis (a track's lanes are laneWidth apart); sample: cells come from the host.
 */
export const KINDS = {
  [grid.id]: { space: grid, plane: 'ground', sample: true },
  [tilemap.id]: { space: tilemap, plane: 'vertical', sample: true, offset: 0.5 },
  [arena2d.id]: { space: arena2d, plane: 'vertical' },
  [track.id]: { space: track, path: true, center: c => [0, (c.lanes - 1) / 2, 0], units: c => [1, c.laneWidth, 1] },
};
const union = (/** @type {string[][]} */ lists) => [...new Set(lists.flat())].sort();
/** Every capability some projectable kind provides: what the adapter can project, declared statically. */
export const PROJECTABLE_CAPS = union(Object.values(KINDS).map(k => k.space.card.provides.capabilities));
const EVENTS = union(Object.values(KINDS).map(k => k.space.card.provides.events || []));
/**
 * The projectable kinds' own rules, as this adapter reports them: the kind validates its config (with.config) and the
 * region's zones (with.zones) as if the region were one of its spaces (validate below), so its codes are this card's.
 */
const KIND_RULES = Object.fromEntries(Object.values(KINDS).flatMap(k => Object.entries(k.space.card.rules || {}).map(([code, r]) => [code, {
  fields: r.fields.map(f => (f === 'zones' || f.startsWith('zones[') || f.startsWith('zones.') ? f : `config.${f}`)),
  message: `${r.message} (the projected kind's rule, ${k.space.id})`,
}])));

const r6 = x => Math.round(x * 1e6) / 1e6 + 0;
const dot = (a, b) => a.reduce((s, v, i) => s + v * (b[i] ?? 0), 0);
const len = a => Math.hypot(...a);
const pad = (a, n, fill = 0) => Array.from({ length: n }, (_, i) => (Array.isArray(a) && Number.isFinite(a[i]) ? a[i] : fill));

/** Default kind config and capabilities for a projected kind (the kind's own card decides). */
export function kindConfig(kind, config = {}) {
  const p = KINDS[kind]?.space; if (!p) return null;
  return checkFields(p.card.params || {}, config || {}, '', [], null);
}
export function kindCaps(kind, config = {}) {
  const p = KINDS[kind]?.space; if (!p) return [];
  const full = kindConfig(kind, config);
  return p.capabilities ? p.capabilities(full) : p.card.provides.capabilities || [];
}

/**
 * The frame mapping region coordinates to host coordinates. dims: host dimensions (2 or 3).
 * Without a path: host = origin + Σ (at[i] - center[i]) · units[i] · scale · axes[i].
 * With a path: axis 0 is arc length along the polyline (scaled), axes i ≥ 1 are coefficients in the local
 * frame (tangent, left normal, up) at that point.
 */
export function frameOf(config, kindCfg, dims) {
  const K = KINDS[config.kind], n = dims === 3 ? 3 : 2;
  const center = config.center.length ? pad(config.center, 3) : pad(K.center ? K.center(kindCfg) : [], 3);
  const units = pad(K.units ? K.units(kindCfg) : [], 3, 1);
  const up = n === 3 ? [0, 1, 0] : null;
  if (config.path.length >= 2) {
    const pts = config.path.map(p => pad(p, n));
    const segs = []; let total = 0;
    for (let i = 1; i < pts.length; i++) { const d = pts[i].map((v, j) => v - pts[i - 1][j]), l = len(d); if (l > 0) { segs.push({ a: pts[i - 1], d, l, s0: total }); total += l; } }
    const length = kindCfg.length > 0 ? kindCfg.length : 0;
    const scale = config.scale > 0 ? config.scale : (length > 0 && total > 0 ? total / length : 1);
    const axes = config.axes.length ? config.axes.map(a => pad(a, 3)) : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const local = t => { const u = t.map(v => v / (len(t) || 1)); return n === 3 ? [u, norm3(cross(up, u)), up] : [u, [-u[1], u[0]], [0, 0]]; };
    const at = s => {
      const loop = kindCfg.loop && total > 0 ? ((s % total) + total) % total : Math.min(Math.max(s, 0), total);
      const g = segs.find(x => loop <= x.s0 + x.l) || segs[segs.length - 1], k = (loop - g.s0) / g.l;
      return { p: g.a.map((v, j) => v + g.d[j] * k), f: local(g.d) };
    };
    const toHost = r => {
      const a = pad(r, 3), { p, f } = at((a[0] - center[0]) * units[0] * scale);
      for (let i = 1; i < 3; i++) { const off = (a[i] - center[i]) * units[i] * scale; if (!off) continue; const v = [0, 1, 2].reduce((acc, j) => acc.map((x, q) => x + (axes[i][j] || 0) * (f[j][q] ?? 0)), new Array(n).fill(0)); for (let q = 0; q < n; q++) p[q] += off * v[q]; }
      return p.map(r6);
    };
    const fromHost = h => {
      const q = pad(h, n); let best = null;
      for (const g of segs) { const k = Math.min(1, Math.max(0, dot(q.map((v, j) => v - g.a[j]), g.d) / (g.l * g.l))), p = g.a.map((v, j) => v + g.d[j] * k), d = len(q.map((v, j) => v - p[j])); if (!best || d < best.d) best = { d, s: g.s0 + k * g.l, p, f: local(g.d) }; }
      if (!best) return center.slice();
      const out = [best.s / (units[0] * scale) + center[0], center[1], center[2]], rel = q.map((v, j) => v - best.p[j]);
      for (let i = 1; i < 3; i++) { const v = [0, 1, 2].reduce((acc, j) => acc.map((x, w) => x + (axes[i][j] || 0) * (best.f[j][w] ?? 0)), new Array(n).fill(0)), l2 = dot(v, v); if (l2 > 0) out[i] = dot(rel, v) / (l2 * units[i] * scale) + center[i]; }
      return out.map(r6);
    };
    return { toHost, fromHost, footprint: () => pts.map(p => p.map(r6)), scale, dims: n };
  }
  const scale = config.scale > 0 ? config.scale : 1;
  const plane = n === 3 ? (K.plane === 'ground' ? [[1, 0, 0], [0, 0, 1], [0, 1, 0]] : [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) : [[1, 0], [0, 1], [0, 0]];
  const axes = config.axes.length ? config.axes.map(a => pad(a, n)) : plane;
  const origin = config.origin.length ? pad(config.origin, n) : new Array(n).fill(0).map((_, i) => (axes.slice(0, 2).some(a => a[i]) ? (K.offset ?? 0.5) : 0));
  const toHost = r => { const a = pad(r, 3), p = origin.slice(); for (let i = 0; i < axes.length; i++) { const off = (a[i] - center[i]) * units[i] * scale; if (off) for (let q = 0; q < n; q++) p[q] += off * axes[i][q]; } return p.map(r6); };
  const fromHost = h => { const rel = pad(h, n).map((v, q) => v - origin[q]); return [0, 1, 2].map(i => { const ax = axes[i]; const l2 = ax ? dot(ax, ax) : 0; return r6(l2 > 0 ? dot(rel, ax) / (l2 * units[i] * scale) + center[i] : center[i]); }); };
  const size = kindCfg.size || [0, 0];
  const footprint = () => [[0, 0], [size[0], 0], [size[0], size[1]], [0, size[1]]].map(c => toHost([c[0] - 0.5, c[1] - 0.5]));
  return { toHost, fromHost, footprint, scale, dims: n };
}
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm3(a) { const l = len(a) || 1; return a.map(v => v / l); }

/** Host dimensions: from its bounds (min corner), else its size, else 2. */
const hostDims = host => { try { const b = host.bounds?.(); if (b?.min?.length) return b.min.length; } catch { /* no bounds */ } return Array.isArray(host?.size) && host.size.length === 3 ? 3 : 2; };

export default {
  id: ID,
  card: {
    intent: 'Space projection adapter: a region of the host space becomes a sub-space of another kind (a board on part of a tile overworld, a race track laid along a path through a tilemap or 3D city, a 2D plane inside a 3D world). Primitives bound to the region get every capability of the projected kind; terrain and zones come from the host and region entities mirror their host positions.',
    views: ['any'],
    params: {
      kind: { type: 'string', options: Object.keys(KINDS), required: true, effect: 'the space kind projected onto the host' },
      config: { type: 'object', open: true, default: {}, effect: "the projected kind's own params (size, lanes, length, loop, topology...)" },
      zones: { type: 'list', default: [], of: { type: 'object', open: true, fields: { id: { type: 'string', required: true } } }, effect: "zones of the region in the projected kind's coordinates (rect/cells for boards, range for tracks)" },
      origin: { type: 'list', of: { type: 'number' }, default: [], effect: 'host position of the region coordinate `center` (default: the host origin, at cell centres)' },
      axes: { type: 'list', of: { type: 'list', of: { type: 'number' } }, default: [], effect: 'host vector of one unit along each region axis (with a path: coefficients in the path frame tangent/normal/up); default: the host plane the kind lies in' },
      path: { type: 'list', of: { type: 'list', of: { type: 'number' } }, default: [], effect: 'host polyline the region runs along (tracks, lanes, rails): region axis 0 is distance along it' },
      center: { type: 'list', of: { type: 'number' }, default: [], effect: 'region coordinate placed on the origin or path (default: the kind’s centre line, e.g. the middle lane)' },
      scale: { type: 'number', default: 0, min: 0, max: 1e4, effect: 'host units per region unit (0 = 1, or the path length over the kind’s length)' },
      sample: { type: 'boolean', default: true, effect: 'cell kinds take their cells from the host (editCells getCell) and follow host edits' },
      layer: { type: 'string', default: '', effect: 'host cell layer sampled (default: the host’s default layer)' },
      blocks: { type: 'object', open: true, default: {}, effect: 'host block -> region block when sampling (null clears); unmapped blocks keep their id' },
      mirror: { type: 'boolean', default: true, effect: 'region entities keep components.projected = {space, at} with their host position' },
    },
    provides: { events: EVENTS },
    requires: { capabilities: ['position'] },
    defines: [{ kind: 'zone', in: 'zones' }],
    components: { projected: { type: 'object', fields: { space: { type: 'ref', to: 'space', effect: 'the host space' }, at: { type: 'json', effect: 'the host position' } }, effect: 'host space and host position of an entity living in a projected region (owned by engine.adapt.projection)' } },
    rules: {
      ...KIND_RULES,
      projection_id: { fields: ['id'], message: 'the instance has an id (a lowercase slug) naming the region space, and no document space has that id', example: { doc: { systems: [{ use: ID, with: { kind: 'engine.space.grid', config: { size: [4, 4] } } }] } } },
      projection_path: { fields: ['path', 'kind'], message: 'a kind laid along a host path (engine.space.track) has a path of at least two points' },
      projection_frame: { fields: ['axes', 'path', 'origin'], message: 'every axis, and every path point, has the same number of components; origin has the dimension of the axes', example: { doc: { systems: [{ use: ID, id: 'board', with: { kind: 'engine.space.grid', config: { size: [4, 4] }, axes: [[1, 0], [0, 1, 0]] } }] } } },
    },
    adapts: {
      provides: { capabilities: PROJECTABLE_CAPS, content: [], services: [] },
      from: { capabilities: ['position'] },
      projection: 'a region of the host becomes a sub-space of the projected kind: a linear frame or a host path maps region coordinates to host ones, cells are sampled from the host, entities mirror their host positions',
      relation: 'union',
      subspace: { kind: 'kind', config: 'config', content: ['cells', 'course'] },
    },
  },
  /**
   * Adapter resolution (planner/adapters.js): the configuration that projects what a host space lacks. Picks the
   * projectable kind covering the missing capabilities, preferring the space a needy card's mode names; sizes it
   * from the kind's defaults within the host's extent. Returns null when no kind covers them.
   */
  adapt({ space, missing, neededBy }) {
    const wanted = neededBy.flatMap(n => (Array.isArray(n.card?.mode?.space) ? n.card.mode.space : typeof n.card?.mode?.space === 'string' ? [n.card.mode.space] : []).filter(x => typeof x === 'string'));
    const order = [...new Set([...wanted.filter(k => KINDS[k]), ...Object.keys(KINDS)])];
    const kind = order.find(k => missing.capabilities.every(c => kindCaps(k).includes(c)));
    if (!kind) return null;
    const def = kindConfig(kind), hostSize = Array.isArray(space.with?.size) ? space.with.size : null;
    const config = {};
    if (Array.isArray(def.size) && hostSize) config.size = def.size.map((v, i) => Math.max(1, Math.min(v, (hostSize[i] ?? v) - 2)));
    const with_ = { kind, config };
    if (KINDS[kind].path) {
      const [W, H] = hostSize || [16, 16];
      with_.path = [[1, H / 2], [Math.max(2, W - 1), H / 2]];
    } else if (hostSize) with_.origin = [1.5, 1.5];
    return { id: `${kind.split('.').pop()}-on-${space.id}`.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 64), with: with_ };
  },
  validate(config, doc, ctx, inst) {
    const errors = [];
    const id = inst?.id, host = inst?.space ?? doc.spaces?.[0]?.id;
    if (typeof id !== 'string' || !SLUG.test(id)) errors.push({ code: 'projection_id', path: `${inst?.path ?? 'systems'}.id`, message: 'a projection instance needs an id: the region space id primitives and entities bind to', hint: 'add "id": "board" (a lowercase slug)' });
    else if ((doc.spaces || []).some(s => s.id === id)) errors.push({ code: 'projection_id', path: `${inst?.path ?? 'systems'}.id`, message: `region id '${id}' is already a document space` });
    const K = KINDS[config.kind]; if (!K) return errors;
    const full = checkFields(K.space.card.params || {}, config.config || {}, 'with.config', errors, ctx);
    if (K.path && config.path.length < 2) errors.push({ code: 'projection_path', path: 'with.path', message: `a ${config.kind} region runs along a host path: give at least two points` });
    const dimsOf = list => new Set(list.map(a => a.length));
    if (dimsOf(config.axes).size > 1) errors.push({ code: 'projection_frame', path: 'with.axes', message: 'every axis needs the same number of components' });
    if (dimsOf(config.path).size > 1) errors.push({ code: 'projection_frame', path: 'with.path', message: 'every path point needs the same number of components' });
    if (config.origin.length && config.axes.length && !K.path && config.origin.length !== config.axes[0].length) errors.push({ code: 'projection_frame', path: 'with.origin', message: 'origin and axes must have the host dimension' });
    // The kind validates its own config and zones, as if the region were one of its spaces.
    if (K.space.validate && typeof id === 'string') {
      const fake = { ...doc, spaces: [{ id, use: config.kind, with: full, zones: config.zones }] };
      let found = [];
      try { found = K.space.validate(full, fake, ctx, { path: 'with.config', id, use: config.kind, space: id }) || []; } catch { found = []; }
      for (const e of found) errors.push({ ...e, path: String(e.path || 'with.config').replace(/^spaces\[0\]\.zones/, 'with.zones').replace(/^spaces\[0\]/, 'with').replace(/^with\.(?!zones|config)/, 'with.config.') });
    }
    return errors;
  },
  install(rt, config, instance) {
    const id = instance.id, hostId = instance.space ?? rt.doc.spaces?.[0]?.id, K = KINDS[config.kind];
    const kindCfg = checkFields(K.space.card.params || {}, config.config || {}, '', [], null);
    const st = () => rt.store(`${ID}:${id}`);
    // Region zones live in the region's space state (the kind reads them like runtime-added zones).
    rt.state.spaces[id] ??= {};
    if (config.zones.length && !rt.state.spaces[id].zones) rt.state.spaces[id].zones = structuredClone(config.zones);
    K.space.install(rt, kindCfg, { key: `${instance.key}:space`, use: config.kind, id, with: kindCfg });
    const api = rt.space(id), host = () => rt.space(hostId);
    const frame = frameOf(config, kindCfg, hostDims(host()));
    const kindInZone = api.inZone;
    Object.assign(api, {
      projected: { host: hostId, kind: config.kind, adapter: ID },
      toHost: at => frame.toHost(at), fromHost: at => frame.fromHost(at), footprint: () => frame.footprint(),
      /** Region zones first; a zone only the host has is tested at the entity's host position. */
      inZone(e, zone, r = rt) {
        if (api.zones?.has?.(zone)) return kindInZone(e, zone, r);
        const h = host(); return Boolean(h?.inZone) && h.inZone({ ...e, space: hostId, at: frame.toHost(e.at) }, zone, r);
      },
    });

    // Terrain: a cell kind takes its cells from the host's cells under it (and follows host edits).
    const cellKind = K.sample && config.sample && typeof api.setCell === 'function' && Array.isArray(kindCfg.size);
    const resample = () => {
      const h = host(); if (typeof h?.getCell !== 'function') return 0;
      const [W, H] = kindCfg.size; let n = 0;
      for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
        let b = null;
        try { b = config.layer ? h.getCell(frame.toHost([c, r]), config.layer) : h.getCell(frame.toHost([c, r])); } catch { b = null; }
        if (b !== null && b !== undefined && Object.prototype.hasOwnProperty.call(config.blocks, b)) b = config.blocks[b];
        b ??= null;
        if ((api.getCell([c, r]) ?? null) !== b) { api.setCell([c, r], b, rt, 'projection'); n++; }
      }
      return n;
    };
    if (cellKind) {
      resample();
      rt.on('cell_changed', d => { if (d?.by !== 'projection') st().dirty = true; });
    }
    rt.system('late', rt => {
      const s = st();
      if (cellKind && s.dirty) { s.dirty = false; resample(); }
      if (!config.mirror) return;
      for (const e of Object.values(rt.state.entities)) if (e.space === id && Array.isArray(e.at)) e.components.projected = { space: hostId, at: frame.toHost(e.at) };
    }, ID);
  },
};
