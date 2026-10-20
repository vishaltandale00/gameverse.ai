// Continuous 3D world: heightfield terrain + placed colliders (boxes and
// cylinders) + an on-demand navigation grid. For open worlds, cities, racing
// and 3D action. World x ∈ [0, size[0]], z ∈ [0, size[1]], y up, metres.
// The heightfield comes from the space's WorldModel `height` field (terrain
// generators, flattened by roads/cities/lakes) sampled every `heightRes`
// metres in lazily built tiles. Generated objects are deterministic from the
// seed; state stores only the seed and a runtime object overlay
// (added/removed), so snapshots stay small.
//
// Entities stand at their feet: `at` is the bottom-centre of the body box. An
// `at` with two numbers [x, z] is placed on the ground. Bodies collide with
// objects as upright cylinders (radius = half the larger of width/depth).
// Object `rot` is a yaw in radians with the three.js rotation.y convention:
// an object's local +z axis faces world (sin rot, cos rot).
import { worldModel, zoneHas, zoneCenter, astar, sharedService, entityOps, v3 } from './worlds3d-lib-world.js';

const TILE = 64; // height samples per tile edge
const OBJ_CELL = 32; // object spatial hash cell (m)
const H8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** Footprint radius of an object for broad phase. */
const objRadius = o => (o.shape === 'cylinder' ? o.r ?? 0.5 : o.shape === 'box' ? Math.hypot(o.size[0], o.size[2]) / 2 : 0);
const objHeight = o => (o.shape === 'cylinder' ? o.h ?? 1 : o.shape === 'box' ? o.size[1] : 0);

/** Push a circle (x, z, r) out of an object footprint; returns [nx, nz, depth] or null. */
function circlePush(o, x, z, r) {
  if (o.shape === 'cylinder') {
    const dx = x - o.at[0], dz = z - o.at[2], d = Math.hypot(dx, dz), R = (o.r ?? 0.5) + r;
    if (d >= R) return null;
    return d > 1e-9 ? [dx / d, dz / d, R - d] : [1, 0, R];
  }
  const c = Math.cos(o.rot || 0), s = Math.sin(o.rot || 0), dx = x - o.at[0], dz = z - o.at[2];
  const lx = dx * c - dz * s, lz = dx * s + dz * c, hw = o.size[0] / 2, hd = o.size[2] / 2;
  const qx = Math.max(-hw, Math.min(hw, lx)), qz = Math.max(-hd, Math.min(hd, lz));
  let nx, nz, depth;
  if (qx === lx && qz === lz) { // centre inside: leave along the shallowest side
    const px = hw - Math.abs(lx), pz = hd - Math.abs(lz);
    if (px < pz) { nx = Math.sign(lx) || 1; nz = 0; depth = px + r; } else { nx = 0; nz = Math.sign(lz) || 1; depth = pz + r; }
  } else {
    const ex = lx - qx, ez = lz - qz, d = Math.hypot(ex, ez); if (d >= r) return null;
    nx = ex / d; nz = ez / d; depth = r - d;
  }
  const ci = Math.cos(-(o.rot || 0)), si = Math.sin(-(o.rot || 0));
  return [nx * ci - nz * si, nx * si + nz * ci, depth];
}
/** Ray vs object; returns {t, normal} or null. o = origin, u = unit direction. */
function rayObject(obj, o, u, maxT) {
  const h = objHeight(obj), y0 = obj.at[1], y1 = y0 + h;
  if (obj.shape === 'cylinder') {
    const R = obj.r ?? 0.5, ox = o[0] - obj.at[0], oz = o[2] - obj.at[2];
    let best = null;
    const a = u[0] * u[0] + u[2] * u[2];
    if (a > 1e-12) {
      const b = 2 * (ox * u[0] + oz * u[2]), c = ox * ox + oz * oz - R * R, disc = b * b - 4 * a * c;
      if (disc >= 0) { const t = (-b - Math.sqrt(disc)) / (2 * a), y = o[1] + u[1] * t; if (t >= 0 && t <= maxT && y >= y0 && y <= y1) best = { t, normal: [(ox + u[0] * t) / R, 0, (oz + u[2] * t) / R] }; }
    }
    if (Math.abs(u[1]) > 1e-12) for (const [cy, ny] of [[y1, 1], [y0, -1]]) {
      const t = (cy - o[1]) / u[1]; if (t < 0 || t > maxT || (best && t >= best.t)) continue;
      const px = ox + u[0] * t, pz = oz + u[2] * t; if (px * px + pz * pz <= R * R) best = { t, normal: [0, ny, 0] };
    }
    return best;
  }
  const c = Math.cos(obj.rot || 0), s = Math.sin(obj.rot || 0);
  const lo = [(o[0] - obj.at[0]) * c - (o[2] - obj.at[2]) * s, o[1] - y0, (o[0] - obj.at[0]) * s + (o[2] - obj.at[2]) * c];
  const lu = [u[0] * c - u[2] * s, u[1], u[0] * s + u[2] * c];
  const min = [-obj.size[0] / 2, 0, -obj.size[2] / 2], max = [obj.size[0] / 2, obj.size[1], obj.size[2] / 2];
  let t0 = 0, t1 = maxT, axis = -1;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(lu[i]) < 1e-12) { if (lo[i] < min[i] || lo[i] > max[i]) return null; continue; }
    let ta = (min[i] - lo[i]) / lu[i], tb = (max[i] - lo[i]) / lu[i]; if (ta > tb) [ta, tb] = [tb, ta];
    if (ta > t0) { t0 = ta; axis = i; } t1 = Math.min(t1, tb); if (t0 > t1) return null;
  }
  const ln = [0, 0, 0]; if (axis >= 0) ln[axis] = -Math.sign(lu[axis]);
  const ci = Math.cos(-(obj.rot || 0)), si = Math.sin(-(obj.rot || 0));
  return { t: t0, normal: [ln[0] * ci - ln[2] * si, ln[1], ln[0] * si + ln[2] * ci] };
}

export default {
  id: 'engine.space.mesh3d',
  card: {
    intent: 'Continuous 3D world: heightfield terrain plus placed box/cylinder colliders and props, with ground/slope/water queries, terrain+collider raycasts, collide-and-slide bodies and grid navigation. For open worlds, cities, racing and 3D action.',
    views: ['1p', '3p', 'iso', 'td'],
    params: {
      size: { type: 'list', of: { type: 'number', min: 64, max: 16384 }, min: 2, max: 2, default: [2048, 2048], unit: 'm', effect: 'world extent [x, z]; x and z run from 0 to size' },
      heightRes: { type: 'number', min: 0.5, max: 8, default: 2, unit: 'm', effect: 'heightfield sample spacing' },
      gravity: { type: 'number', min: -100, max: 0, default: -9.8, unit: 'm/s²', effect: 'gravity vector y' },
      navCell: { type: 'number', min: 0.25, max: 4, default: 1, unit: 'm', effect: 'finest navigation grid cell (long paths coarsen automatically)' },
      streamRadius: { type: 'number', min: 100, max: 4000, default: 600, unit: 'm', effect: 'radius around the player that renderers and streaming keep loaded' },
      baseHeight: { type: 'number', min: -1000, max: 10000, default: 0, unit: 'm', effect: 'ground height when no terrain generator is present' },
      body: { type: 'list', of: { type: 'number', min: 0.05, max: 64 }, min: 3, max: 3, default: [0.6, 1.8, 0.6], unit: 'm', effect: 'default body size [w, h, d]' },
      stepHeight: { type: 'number', min: 0, max: 4, default: 0.4, unit: 'm', effect: 'ledge height bodies and paths step onto without jumping (body.step overrides)' },
      slopeLimit: { type: 'number', min: 0, max: 89, default: 45, unit: 'deg', effect: 'steepest walkable terrain for slide and navigation' },
      wade: { type: 'number', min: 0, max: 10, default: 0.9, unit: 'm', effect: 'deepest water navigation walks through without the swim ability' },
      objectTile: { type: 'number', min: 16, max: 2048, default: 128, unit: 'm', effect: 'tile size for lazily generated objects (scatter)' },
      cacheTiles: { type: 'integer', min: 8, max: 65536, default: 512, effect: 'height and object tiles kept in memory' },
      pathNodes: { type: 'integer', min: 100, max: 1000000, default: 20000, effect: 'A* / flood-fill node budget per query' },
    },
    provides: {
      capabilities: ['position', 'distance', 'overlap', 'raycast', 'pathfind', 'reachable', 'gravity', 'surface', 'placement', 'heightfield', 'procedural'],
      capabilityMethods: { placement: ['objects', 'addObject', 'removeObject', 'objectsIn'], heightfield: ['heightSample', 'heightTile', 'bounds'], procedural: ['model'] },
      events: ['enter_zone', 'leave_zone', 'generated', 'object_added', 'object_removed'],
      services: ['surface'],
    },
    reads: [],
  },
  validate(config, doc) {
    const errors = [];
    (doc.spaces || []).forEach((s, i) => {
      if (s.use !== 'engine.space.mesh3d') return;
      (s.zones || []).forEach((z, j) => {
        if (!z.bounds && !z.center && !z.polygon && !z.rect) errors.push({ code: 'zone_shape_missing', path: `spaces[${i}].zones[${j}]`, message: `zone '${z.id}' needs bounds, center+r, polygon or rect` });
        if (z.center && !(z.r > 0)) errors.push({ code: 'zone_shape_invalid', path: `spaces[${i}].zones[${j}].r`, message: `zone '${z.id}' with a center needs r > 0` });
        if (z.polygon && (!Array.isArray(z.polygon) || z.polygon.length < 3)) errors.push({ code: 'zone_shape_invalid', path: `spaces[${i}].zones[${j}].polygon`, message: 'polygon needs at least 3 [x, z] points' });
      });
    });
    return errors;
  },
  install(rt, config, instance) {
    const sid = instance.id, [W, D] = config.size, R = config.heightRes, NX = Math.ceil(W / R), NZ = Math.ceil(D / R);
    const model = worldModel(rt, sid, 'mesh3d', { extent: [0, 0, W, D], seaLevel: 0, cell: R });
    const st = () => rt.state.spaces[sid];
    rt.defineSpace(sid, null);
    st().seed ??= Math.floor(rt.random() * 4294967296) >>> 0 || 1;
    st().members ??= {}; st().added ??= {}; st().removed ??= {}; st().nextObject ??= 1;
    const ops = entityOps({ rt, sid, model, defaultBody: config.body, st }), { bodySize, boxOf, entities, zones, track } = ops;

    // ----- heightfield -----
    let version = -1;
    const tiles = new Map(), objTiles = new Map();
    const sync = () => { model.ensure(); if (model.version !== version) { tiles.clear(); objTiles.clear(); version = model.version; } };
    const rawHeight = (x, z) => model.at('height', x, z, config.baseHeight);
    function tile(tx, tz) {
      const k = tx * 65536 + tz; let t = tiles.get(k);
      if (t) return t;
      t = new Float32Array((TILE + 1) * (TILE + 1));
      for (let j = 0; j <= TILE; j++) for (let i = 0; i <= TILE; i++) t[i + (TILE + 1) * j] = rawHeight(Math.min(NX, tx * TILE + i) * R, Math.min(NZ, tz * TILE + j) * R);
      if (tiles.size >= config.cacheTiles) { let n = Math.ceil(config.cacheTiles / 4); for (const key of tiles.keys()) { tiles.delete(key); if (--n <= 0) break; } }
      tiles.set(k, t); return t;
    }
    function heightSample(ix, iz) {
      ix = Math.max(0, Math.min(NX, ix)); iz = Math.max(0, Math.min(NZ, iz));
      if (!model.built) return rawHeight(ix * R, iz * R); // during generation: no caching while modifiers are added
      sync();
      const tx = Math.min(Math.floor(ix / TILE), Math.floor((NX - 1) / TILE)), tz = Math.min(Math.floor(iz / TILE), Math.floor((NZ - 1) / TILE));
      return tile(tx, tz)[(ix - tx * TILE) + (TILE + 1) * (iz - tz * TILE)];
    }
    const terrainY = (x, z) => {
      if (model.building) return rawHeight(Math.max(0, Math.min(W, x)), Math.max(0, Math.min(D, z)));
      sync();
      const fx = Math.max(0, Math.min(W, x)) / R, fz = Math.max(0, Math.min(D, z)) / R, ix = Math.min(NX - 1, Math.floor(fx)), iz = Math.min(NZ - 1, Math.floor(fz)), u = fx - ix, v = fz - iz;
      const a = heightSample(ix, iz), b = heightSample(ix + 1, iz), c = heightSample(ix, iz + 1), d = heightSample(ix + 1, iz + 1);
      return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
    };
    const normalAt = (x, z) => { const e = R, hx = terrainY(x + e, z) - terrainY(x - e, z), hz = terrainY(x, z + e) - terrainY(x, z - e), n = [-hx / (2 * e), 1, -hz / (2 * e)], l = Math.hypot(...n); return n.map(v => v / l); };
    const waterLevelAt = (x, z) => model.at('water', x, z, null);
    const groundAt = (x, z) => {
      const biome = model.ensure().at('biome', x, z, null);
      const material = model.at('material', x, z, null) ?? (biome && model.info.biomeDefs?.[biome]?.surface) ?? null;
      return { y: terrainY(x, z), normal: normalAt(x, z), material, biome };
    };
    const slopeAt = (x, z) => +(Math.acos(Math.min(1, normalAt(x, z)[1])) * 180 / Math.PI).toFixed(3);
    const waterDepthAt = (x, z) => { const w = waterLevelAt(x, z); return w == null ? 0 : Math.max(0, w - terrainY(x, z)); };

    // ----- objects -----
    const eagerIndex = () => {
      sync();
      if (model.objectIndex) return model.objectIndex;
      const grid = new Map();
      for (const o of model.objects) addToGrid(grid, o);
      return (model.objectIndex = grid);
    };
    const addToGrid = (grid, o) => {
      const r = objRadius(o);
      for (let gx = Math.floor((o.at[0] - r) / OBJ_CELL); gx <= Math.floor((o.at[0] + r) / OBJ_CELL); gx++) for (let gz = Math.floor((o.at[2] - r) / OBJ_CELL); gz <= Math.floor((o.at[2] + r) / OBJ_CELL); gz++) {
        const k = gx * 65536 + gz; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(o);
      }
    };
    function objTile(tx, tz) {
      const k = tx * 65536 + tz; let t = objTiles.get(k);
      if (t) return t;
      const box = [tx * config.objectTile, tz * config.objectTile, (tx + 1) * config.objectTile, (tz + 1) * config.objectTile];
      const list = model.objectLayers.flatMap(layer => layer.objects(box, { groundAt, slopeAt, waterDepthAt, model }) || []);
      const grid = new Map(); for (const o of list) addToGrid(grid, o);
      t = { list, grid };
      if (objTiles.size >= config.cacheTiles) { let n = Math.ceil(config.cacheTiles / 4); for (const key of objTiles.keys()) { objTiles.delete(key); if (--n <= 0) break; } }
      objTiles.set(k, t); return t;
    }
    /** Objects whose footprint may touch the rectangle [x0, z0, x1, z1] (eager, lazy tiles and runtime additions, minus removals). */
    function objectsIn(x0, z0, x1, z1, { lazy = true } = {}) {
      const grid = eagerIndex(), out = new Set(), removed = st().removed;
      for (let gx = Math.floor(x0 / OBJ_CELL); gx <= Math.floor(x1 / OBJ_CELL); gx++) for (let gz = Math.floor(z0 / OBJ_CELL); gz <= Math.floor(z1 / OBJ_CELL); gz++) for (const o of grid.get(gx * 65536 + gz) || []) out.add(o);
      if (lazy && model.objectLayers.length) {
        const T = config.objectTile;
        for (let tx = Math.floor(Math.max(0, x0) / T); tx <= Math.floor(Math.min(W, x1) / T); tx++) for (let tz = Math.floor(Math.max(0, z0) / T); tz <= Math.floor(Math.min(D, z1) / T); tz++) {
          const t = objTile(tx, tz);
          for (let gx = Math.floor(x0 / OBJ_CELL); gx <= Math.floor(x1 / OBJ_CELL); gx++) for (let gz = Math.floor(z0 / OBJ_CELL); gz <= Math.floor(z1 / OBJ_CELL); gz++) for (const o of t.grid.get(gx * 65536 + gz) || []) out.add(o);
        }
      }
      for (const o of Object.values(st().added)) { const r = objRadius(o); if (o.at[0] + r >= x0 && o.at[0] - r <= x1 && o.at[2] + r >= z0 && o.at[2] - r <= z1) out.add(o); }
      return [...out].filter(o => !removed[o.id]);
    }
    const colliders = (x0, z0, x1, z1) => objectsIn(x0, z0, x1, z1).filter(o => o.shape === 'box' || o.shape === 'cylinder');

    // ----- bodies -----
    const radiusOf = e => { const s = bodySize(e); return Math.max(s[0], s[2]) / 2; };
    const stepOf = e => e.components?.body?.step ?? config.stepHeight;
    /** Highest support under a circle at (x, z) with feet at y: terrain or collider tops within step reach. */
    function supportAt(x, z, r, y, reach) {
      let best = terrainY(x, z);
      for (const o of colliders(x - r, z - r, x + r, z + r)) {
        const top = o.at[1] + objHeight(o);
        if (top <= y + reach + 1e-6 && top > best && circlePush(o, x, z, r * 0.999)) best = top;
      }
      return best;
    }
    const tooSteep = (x, z) => slopeAt(x, z) > config.slopeLimit;

    // ----- navigation grid -----
    const navOpts = (o = {}) => { const abilities = new Set(Array.isArray(o) ? o : o.abilities || []); return { swim: abilities.has('swim'), climb: abilities.has('climb'), fly: abilities.has('fly'), r: o.radius ?? config.body[0] / 2, step: o.step ?? config.stepHeight, slope: o.slopeMax ?? config.slopeLimit, maxNodes: o.maxNodes ?? config.pathNodes, avoid: o.avoid, cell: o.cell }; };
    function walkableFn(p, cs) {
      const memo = new Map();
      return (ix, iz) => {
        const k = ix * 1048576 + iz; let v = memo.get(k);
        if (v !== undefined) return v;
        const x = (ix + 0.5) * cs, z = (iz + 0.5) * cs;
        v = x >= 0 && z >= 0 && x <= W && z <= D;
        if (v && !p.fly) {
          if (!p.climb && slopeAt(x, z) > p.slope) v = false;
          else if (!p.swim && waterDepthAt(x, z) > config.wade) v = false;
          else { const g = terrainY(x, z); for (const o of colliders(x - p.r, z - p.r, x + p.r, z + p.r)) if (o.at[1] + objHeight(o) > g + p.step && o.at[1] < g + config.body[1] && circlePush(o, x, z, p.r)) { v = false; break; } }
        }
        if (v && p.avoid?.([x, terrainY(x, z), z])) v = false;
        memo.set(k, v); return v;
      };
    }
    const navCellFor = (p, a, b) => p.cell ?? Math.max(config.navCell, Math.hypot(b[0] - a[0], b[2] - a[2]) / 160);
    function path(from, to, o) {
      const p = navOpts(o), a = v3(norm(from)), b = v3(norm(to)), cs = navCellFor(p, a, b), ok = walkableFn(p, cs);
      const s = [Math.floor(a[0] / cs), Math.floor(a[2] / cs)], g = [Math.floor(b[0] / cs), Math.floor(b[2] / cs)];
      if (!ok(...g) || !ok(...s)) return null;
      const r = astar({
        start: s, isGoal: c => c[0] === g[0] && c[1] === g[1], key: c => `${c[0]},${c[1]}`, maxNodes: p.maxNodes,
        h: c => Math.hypot(c[0] - g[0], c[1] - g[1]) * cs,
        neighbors(c, push) {
          for (const [dx, dz] of H8) {
            const n = [c[0] + dx, c[1] + dz]; if (!ok(...n) || (dx && dz && (!ok(c[0] + dx, c[1]) || !ok(c[0], c[1] + dz)))) continue;
            const rise = Math.abs(terrainY((n[0] + 0.5) * cs, (n[1] + 0.5) * cs) - terrainY((c[0] + 0.5) * cs, (c[1] + 0.5) * cs));
            push(n, Math.hypot(dx, dz) * cs + rise * 0.5);
          }
        },
      });
      if (!r.path) return null;
      const pts = r.path.map(c => [(c[0] + 0.5) * cs, 0, (c[1] + 0.5) * cs]);
      pts[0] = [a[0], 0, a[2]]; pts[pts.length - 1] = [b[0], 0, b[2]];
      const out = pts.filter((q, i) => i === 0 || i === pts.length - 1 || (pts[i - 1][0] - q[0]) * (pts[i + 1][2] - q[2]) - (pts[i - 1][2] - q[2]) * (pts[i + 1][0] - q[0]) !== 0);
      return out.map(q => [q[0], terrainY(q[0], q[2]), q[2]]);
    }
    function reachable(from, rtOrOpts, o) {
      const opts = rtOrOpts && !rtOrOpts.state ? rtOrOpts : o || {};
      const p = navOpts(opts), a = v3(norm(from)), cs = p.cell ?? Math.max(config.navCell, Math.min(W, D) / 256), ok = walkableFn(p, cs), out = new Set();
      const s = [Math.floor(a[0] / cs), Math.floor(a[2] / cs)];
      out.cell = cs; out.truncated = false;
      if (!ok(...s)) return out;
      const seen = new Set([`${s[0]},${s[1]}`]), queue = [s];
      for (let i = 0; i < queue.length; i++) {
        if (seen.size >= p.maxNodes) { out.truncated = true; break; }
        const c = queue[i];
        for (const [dx, dz] of H8.slice(0, 4)) { const n = [c[0] + dx, c[1] + dz], k = `${n[0]},${n[1]}`; if (!seen.has(k) && ok(...n)) { seen.add(k); queue.push(n); } }
      }
      for (const k of seen) out.add(k);
      const zs = zones();
      for (const c of queue) { const x = (c[0] + 0.5) * cs, z = (c[1] + 0.5) * cs; for (const zn of zs) if (!out.has(zn.id) && zoneHas(zn, x, undefined, z)) out.add(zn.id); }
      return out;
    }

    // ----- raycast -----
    function raycast(from, dir, maxDist = 500, mask = {}) {
      const m = typeof mask === 'string' ? { terrain: mask !== 'entities', objects: mask !== 'entities', entities: mask !== 'cells' && mask !== 'terrain' } : mask;
      const o = v3(from), d = v3(dir), l = Math.hypot(...d) || 1, u = d.map(v => v / l);
      let best = { hit: 'none', at: null, normal: null, dist: maxDist };
      if (m.terrain !== false) {
        const step = R * 0.5; let prev = 0, prevAbove = o[1] - terrainY(o[0], o[2]);
        if (prevAbove < 0) best = { hit: 'terrain', at: o, normal: normalAt(o[0], o[2]), dist: 0 };
        else for (let t = step; t <= maxDist + step; t += step) {
          const tt = Math.min(t, maxDist), x = o[0] + u[0] * tt, y = o[1] + u[1] * tt, z = o[2] + u[2] * tt, above = y - terrainY(x, z);
          if (above <= 0) {
            let lo = prev, hi = tt;
            for (let k = 0; k < 16; k++) { const mid = (lo + hi) / 2; if (o[1] + u[1] * mid - terrainY(o[0] + u[0] * mid, o[2] + u[2] * mid) > 0) lo = mid; else hi = mid; }
            const at = o.map((v, i) => v + u[i] * hi);
            best = { hit: 'terrain', at, normal: normalAt(at[0], at[2]), dist: hi, material: groundAt(at[0], at[2]).material };
            break;
          }
          prev = tt; prevAbove = above; if (tt >= maxDist) break;
        }
      }
      if (m.objects !== false) {
        const reach = best.dist, ex = [o[0], o[2], o[0] + u[0] * reach, o[2] + u[2] * reach];
        for (const obj of colliders(Math.min(ex[0], ex[2]), Math.min(ex[1], ex[3]), Math.max(ex[0], ex[2]), Math.max(ex[1], ex[3]))) {
          const h = rayObject(obj, o, u, best.dist);
          if (h && h.t < best.dist) best = { hit: 'object', id: obj.id, at: o.map((v, i) => v + u[i] * h.t), normal: h.normal, dist: h.t, kind: obj.kind };
        }
      }
      if (m.entities !== false) { const e = ops.rayEntities(o, u, best.dist, { ignore: m.ignore, filter: m.filter }); if (e) best = e; }
      return best;
    }

    // ----- positions -----
    const norm = at => (at.length === 2 ? [at[0], terrainY(at[0], at[1]), at[1]] : v3(at));
    const anchor = zone => {
      const a = zone.spawn || zone.at;
      if (a) return norm(a);
      const c = zoneCenter(zone); if (!c) return null;
      const p = navOpts({}), ok = walkableFn(p, Math.max(config.navCell, 2));
      for (let r = 0; r <= 32; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const cs = Math.max(config.navCell, 2), ix = Math.floor(c[0] / cs) + dx, iz = Math.floor(c[1] / cs) + dz, x = (ix + 0.5) * cs, z = (iz + 0.5) * cs;
        if (ok(ix, iz) && zoneHas(zone, x, undefined, z)) { const y = supportAt(x, z, config.body[0] / 2, terrainY(x, z), config.stepHeight); if (!zone.bounds?.min || zoneHas(zone, x, y, z)) return [x, y, z]; }
      }
      return norm(c);
    };

    const api = {
      kind: 'mesh3d', config, size: [W, D], heightRes: R,
      model: () => model.ensure(),
      bounds() { let lo = Infinity, hi = -Infinity; for (let iz = 0; iz <= NZ; iz += Math.max(1, Math.floor(NZ / 64))) for (let ix = 0; ix <= NX; ix += Math.max(1, Math.floor(NX / 64))) { const h = heightSample(ix, iz); lo = Math.min(lo, h); hi = Math.max(hi, h); } return { min: [0, lo, 0], max: [W, hi, D] }; },
      // position
      place(e, rt) {
        if (e.at == null) { const start = zones().find(z => (z.tags || []).includes('start')) || zones()[0]; e.at = (start && anchor(start)) || norm([W / 2, D / 2]); }
        e.at = norm(e.at); e.zone = null; track(e, rt);
      },
      remove: e => ops.untrack(e),
      pos: e => e.at,
      setPos(e, at, rt) { e.at = norm(at); track(e, rt); },
      entitiesAt: ops.entitiesAt, inZone: ops.inZone, zoneAt: ops.zoneAt,
      teleport(e, { zone, at }, rt) { const z = zone && zones().find(x => x.id === zone); const to = at ?? (z && anchor(z)); if (to) api.setPos(e, to, rt); },
      nearest: (e, target) => ops.nearest(e, target),
      distance: (a, b, metric = 'euclid') => ops.distance(norm(a), norm(b), metric, path),
      overlap: (shape, filter) => ops.overlap(shape, filter),
      contacts(e) {
        const p = v3(e.at), r = radiusOf(e), h = bodySize(e)[1], out = [];
        for (const o of colliders(p[0] - r - 0.05, p[2] - r - 0.05, p[0] + r + 0.05, p[2] + r + 0.05)) {
          if (o.at[1] > p[1] + h || o.at[1] + objHeight(o) < p[1]) continue;
          const push = circlePush(o, p[0], p[2], r + 0.05); if (push) out.push({ id: o.id, object: true, normal: [push[0], 0, push[1]] });
        }
        if (p[1] - terrainY(p[0], p[2]) < 0.05) out.push({ terrain: true, normal: normalAt(p[0], p[2]) });
        for (const o of entities()) if (o !== e) { const a = boxOf(e), b = boxOf(o); if (a.min.every((m, i) => m <= b.max[i] + 0.02 && a.max[i] >= b.min[i] - 0.02)) { const d = v3(o.at).map((v, i) => v - p[i]), l = Math.hypot(d[0], d[2]) || 1; out.push({ id: o.id, normal: [-d[0] / l, 0, -d[2] / l] }); } }
        return out;
      },
      raycast, path, reachable,
      canReach(a, b, o) { const opts = o && !o.state ? o : {}; return path(a, b, opts) !== null; },
      // gravity
      gravityAt: () => [0, config.gravity, 0],
      /**
       * Collide-and-slide: horizontal motion is resolved against collider
       * footprints (pushing out along the contact normal, so bodies slide along
       * walls) and against terrain steeper than slopeLimit; vertical motion
       * lands on terrain or collider tops and stops under collider bottoms.
       * Ledges up to body.step (default stepHeight) are stepped onto.
       */
      slide(e, delta, rt) {
        const d = v3(delta), p = v3(e.at), r = radiusOf(e), h = bodySize(e)[1], step = stepOf(e);
        const n = Math.min(64, Math.max(1, Math.ceil(Math.max(Math.hypot(d[0], d[2]) / Math.max(0.05, r * 0.5), Math.abs(d[1]) / 0.5))));
        const blocked = { x: false, y: false, z: false }; let normal = null;
        let grounded = p[1] - supportAt(p[0], p[2], r, p[1], step) < 0.05;
        for (let k = 0; k < n; k++) {
          let qx = p[0] + d[0] / n, qz = p[2] + d[2] / n;
          // terrain too steep to climb
          if ((d[0] || d[2]) && tooSteep(qx, qz) && terrainY(qx, qz) > p[1] + step) {
            const nn = normalAt(qx, qz); normal = nn;
            if (Math.abs(nn[0]) > 1e-6) blocked.x = true; if (Math.abs(nn[2]) > 1e-6) blocked.z = true;
            // slide along the slope contour
            const l = Math.hypot(nn[0], nn[2]) || 1, tx = -nn[2] / l, tz = nn[0] / l, along = (d[0] / n) * tx + (d[2] / n) * tz;
            qx = p[0] + tx * along; qz = p[2] + tz * along;
            if (tooSteep(qx, qz) && terrainY(qx, qz) > p[1] + step) { qx = p[0]; qz = p[2]; }
          }
          // colliders
          for (let it = 0; it < 4; it++) {
            let pushed = false;
            for (const o of colliders(qx - r, qz - r, qx + r, qz + r)) {
              const top = o.at[1] + objHeight(o);
              if (o.at[1] >= p[1] + h || top <= p[1] + 1e-6) continue; // no vertical overlap
              if (top - p[1] <= step + 1e-6 && grounded) continue; // step onto it below
              const push = circlePush(o, qx, qz, r); if (!push) continue;
              qx += push[0] * (push[2] + 1e-4); qz += push[1] * (push[2] + 1e-4); pushed = true;
              normal = [push[0], 0, push[1]]; if (Math.abs(push[0]) > 0.3) blocked.x = true; if (Math.abs(push[1]) > 0.3) blocked.z = true;
            }
            if (!pushed) break;
          }
          p[0] = Math.max(0, Math.min(W, qx)); p[2] = Math.max(0, Math.min(D, qz));
          // vertical
          let ny = p[1] + d[1] / n;
          const floor = supportAt(p[0], p[2], r, Math.max(p[1], ny), grounded ? step : 0);
          if (ny < floor) { if (d[1] < 0 || floor - p[1] > step) blocked.y = d[1] < 0 || blocked.y; ny = floor; if (d[1] <= 0) { normal ??= [0, 1, 0]; } d[1] = Math.min(0, d[1]); }
          if (d[1] > 0) for (const o of colliders(p[0] - r, p[2] - r, p[0] + r, p[2] + r)) if (o.at[1] >= p[1] + h - 1e-6 && ny + h > o.at[1] && circlePush(o, p[0], p[2], r * 0.999)) { ny = o.at[1] - h; blocked.y = true; normal = [0, -1, 0]; d[1] = 0; }
          p[1] = ny;
          grounded = p[1] - supportAt(p[0], p[2], r, p[1], step) < 0.05;
        }
        const before = v3(e.at), moved = p.some((v, i) => Math.abs(v - before[i]) > 1e-12);
        e.at = p.map(v => +v.toFixed(9)); track(e, rt);
        return { moved, blocked, grounded, normal };
      },
      grounded(e) { const p = v3(e.at), r = radiusOf(e); return p[1] - supportAt(p[0], p[2], r, p[1], 0.05) < 0.05; },
      // surface
      groundAt, slopeAt, waterDepthAt, waterLevelAt,
      // heightfield (renderers)
      heightSample,
      heightTile(tx, tz) { const heights = new Float32Array((TILE + 1) * (TILE + 1)); for (let j = 0; j <= TILE; j++) for (let i = 0; i <= TILE; i++) heights[i + (TILE + 1) * j] = heightSample(tx * TILE + i, tz * TILE + j); return { origin: [tx * TILE * R, tz * TILE * R], res: R, n: [TILE + 1, TILE + 1], heights }; },
      // placement
      objects(region) {
        if (!region) { sync(); const removed = st().removed; return [...model.objects, ...Object.values(st().added)].filter(o => !removed[o.id]); }
        return objectsIn(region.min[0], region.min[1], region.max[0], region.max[1]);
      },
      objectsIn: (x0, z0, x1, z1) => objectsIn(x0, z0, x1, z1),
      /** Add a runtime object (kept in state); returns its id. */
      addObject(obj, rt) {
        const s = st(), id = obj.id || `obj${s.nextObject++}`;
        const o = { shape: 'box', size: [1, 1, 1], rot: 0, scale: 1, ...structuredClone(obj), id };
        if (o.at.length === 2) o.at = norm(o.at);
        s.added[id] = o; delete s.removed[id]; rt.emit('object_added', { id, space: sid, kind: o.kind ?? null }); return id;
      },
      removeObject(id, rt) {
        const s = st(); if (s.removed[id]) return false;
        if (s.added[id]) delete s.added[id]; else s.removed[id] = true;
        rt.emit('object_removed', { id, space: sid }); return true;
      },
      supportAt: (x, z, y) => supportAt(x, z, 0.01, y ?? Infinity, Infinity),
    };
    rt.defineSpace(sid, api);
    sharedService(rt, 'surface', sid, { call: (x, z) => groundAt(x, z), groundAt, slopeAt, waterDepthAt }, ['groundAt', 'slopeAt', 'waterDepthAt']);
    model.surfaceY = (x, z) => rawHeight(x, z);
    model.onBuilt = m => { st().generated = { problems: m.problems.slice(0, 50), info: { objects: m.objects.length, ...m.info.summary } }; rt.emit('generated', { space: sid, problems: m.problems.length }); };
  },
  extend(rt, config, added, instance) {
    if (added.zones.some(z => z.space === instance.id)) rt.caches[`worlds3d:model:${instance.id}`]?.reset();
  },
};
