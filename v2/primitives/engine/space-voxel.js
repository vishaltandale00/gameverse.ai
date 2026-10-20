// Chunked, editable 3D voxel grid (Minecraft-like worlds). Infinite in x/z,
// [0, height) in y. Chunks are generated lazily and deterministically from the
// space seed by the generator layers in its WorldModel, so state holds only the
// seed and the edits (edit map + bounded edit log). Coordinates are metres;
// a cell is `cell` metres. Entities stand at their feet: `at` is the
// bottom-centre of the body box (components.body.size, default `body`).
import { worldModel, zoneHas, zoneCenter, zoneYRange, blockTable, astar, sharedService, entityOps, v3 } from './worlds3d-lib-world.js';

const DIRS6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const H8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const ckey = (cx, cy, cz) => ((cx + 32768) * 65536 + (cz + 32768)) * 128 + cy;

export default {
  id: 'engine.space.voxel',
  card: {
    intent: 'Chunked editable 3D block world (Minecraft-like). Terrain, caves, ores, water, roads, cities and structures come from its generators lazily per chunk; only edits are saved. Supports walking/jumping pathfinding, voxel raycasts, collide-and-slide bodies, light and optional flowing fluids.',
    views: ['1p', '3p', 'iso'],
    params: {
      chunk: { type: 'list', of: { type: 'integer', min: 8, max: 128 }, min: 3, max: 3, default: [16, 64, 16], effect: 'chunk size in cells [x, y, z]; generation and meshing work per chunk' },
      height: { type: 'integer', min: 32, max: 512, default: 128, unit: 'cells', effect: 'world height; y is in [0, height)' },
      seaLevel: { type: 'integer', min: 0, max: 512, default: 48, unit: 'cells', effect: 'sea level used by generators that do not set their own' },
      cell: { type: 'number', min: 0.25, max: 2, default: 1, unit: 'm', effect: 'size of one cell' },
      viewDistance: { type: 'integer', min: 2, max: 32, default: 8, unit: 'chunks', effect: 'chunk radius around the player that renderers and streaming keep loaded' },
      lightModel: { type: 'string', options: ['none', 'sky', 'full'], default: 'sky', effect: 'lightAt: none = always 15; sky = open-sky light; full = sky plus block light from emitting blocks' },
      fluid: { type: 'boolean', default: false, effect: 'fluids flow into neighbouring empty cells after edits (down, then sideways up to flowRange)' },
      flowRange: { type: 'integer', min: 1, max: 8, default: 4, unit: 'cells', effect: 'how far fluid spreads sideways from a source' },
      fluidBudget: { type: 'integer', min: 1, max: 4096, default: 64, effect: 'fluid cells updated per step (bounds the cost of a flood)' },
      gravity: { type: 'number', min: -100, max: 0, default: -9.8, unit: 'm/s²', effect: 'gravity vector y returned by gravityAt' },
      body: { type: 'list', of: { type: 'number', min: 0.05, max: 32 }, min: 3, max: 3, default: [0.6, 1.8, 0.6], unit: 'm', effect: 'default body size [w, h, d] for entities without components.body.size' },
      ground: { type: 'integer', min: 0, max: 512, default: 0, unit: 'cells', effect: 'when no terrain generator is present, cells below this y are groundBlock' },
      groundBlock: { type: 'string', default: 'stone', effect: 'block used for the fallback flat ground' },
      cacheChunks: { type: 'integer', min: 16, max: 65536, default: 1024, effect: 'generated chunks kept in memory (evicted chunks regenerate identically)' },
      logMax: { type: 'integer', min: 16, max: 1000000, default: 4096, effect: 'edit-log entries kept (the edit map itself is never truncated)' },
      maxFill: { type: 'integer', min: 1, max: 4194304, default: 65536, unit: 'cells', effect: 'largest volume fill() or cellsIn() will touch' },
      pathNodes: { type: 'integer', min: 100, max: 1000000, default: 20000, effect: 'A* / flood-fill node budget per query' },
    },
    provides: {
      capabilities: ['position', 'distance', 'overlap', 'raycast', 'pathfind', 'reachable', 'editCells', 'gravity', 'surface', 'chunks', 'light', 'procedural'],
      capabilityMethods: { chunks: ['chunkCells', 'chunkOf', 'chunksNear', 'blockDef'], light: ['lightAt'], procedural: ['model'] },
      events: ['enter_zone', 'leave_zone', 'cell_changed', 'generated', 'fluid_flow'],
      services: ['surface'],
    },
    reads: ['content.blocks'],
  },
  validate(config) {
    const errors = [];
    const [sx, sy, sz] = config.chunk || [];
    if (config.height % sy) errors.push({ code: 'voxel_height_chunk', path: 'with.height', message: `height ${config.height} must be a multiple of chunk y ${sy}`, hint: `try ${Math.ceil(config.height / sy) * sy}` });
    if (config.height / sy > 64) errors.push({ code: 'voxel_chunk_count', path: 'with.chunk', message: 'at most 64 chunks per column', hint: 'use a taller chunk' });
    if (config.seaLevel >= config.height) errors.push({ code: 'param_range', path: 'with.seaLevel', message: 'seaLevel must be below height' });
    if (config.ground >= config.height) errors.push({ code: 'param_range', path: 'with.ground', message: 'ground must be below height' });
    if (sx * sy * sz > 1 << 20) errors.push({ code: 'voxel_chunk_size', path: 'with.chunk', message: 'chunks larger than 1M cells' });
    return errors;
  },
  install(rt, config, instance) {
    const sid = instance.id, C = config.cell, [SX, SY, SZ] = config.chunk, H = config.height, NCY = H / SY;
    const model = worldModel(rt, sid, 'voxel', { seaLevel: config.seaLevel * C, height: H * C, cell: C });
    const st = () => rt.state.spaces[sid];
    rt.defineSpace(sid, null); // reserve state before drawing the seed
    st().seed ??= Math.floor(rt.random() * 4294967296) >>> 0 || 1;
    st().edits ??= {}; st().log ??= []; st().members ??= {}; st().fluidQueue ??= []; st().fluidLevel ??= {};

    // ----- palette and block table -----
    let defsDoc = null, defs = new Map();
    const palette = [null], index = new Map([[null, 0]]);
    let solidIdx = new Uint8Array(256), fluidIdx = new Uint8Array(256), opaqueIdx = new Uint8Array(256), lightIdx = new Uint8Array(256);
    const blockDef = id => { if (defsDoc !== rt.doc) { defsDoc = rt.doc; defs = blockTable(rt.doc); refreshFlags(); } return id == null ? null : defs.get(id) || { id, solid: true, transparent: false, fluid: false }; };
    const refreshFlags = () => { for (let i = 1; i < palette.length; i++) setFlags(i); };
    const setFlags = i => {
      if (i >= solidIdx.length) { const grow = a => { const b = new Uint8Array(a.length * 2); b.set(a); return b; }; solidIdx = grow(solidIdx); fluidIdx = grow(fluidIdx); opaqueIdx = grow(opaqueIdx); lightIdx = grow(lightIdx); }
      const d = defs.get(palette[i]) || { solid: true, transparent: false, fluid: false };
      solidIdx[i] = d.solid ? 1 : 0; fluidIdx[i] = d.fluid ? 1 : 0; opaqueIdx[i] = d.solid && !d.transparent ? 1 : 0;
      const raw = (rt.doc.content?.blocks || []).find(b => b.id === palette[i]); lightIdx[i] = Math.min(15, raw?.light || 0);
    };
    const idx = id => { if (id == null) return 0; let i = index.get(id); if (i === undefined) { blockDef(id); i = palette.length; palette.push(id); index.set(id, i); setFlags(i); } return i; };
    blockDef(null);

    // ----- chunks -----
    const chunks = new Map();
    let last = null, lastKey = -1;
    const editsByChunk = () => {
      if (model.cache.editsFor === st().edits) return model.cache.editsIdx;
      const m = new Map();
      for (const k of Object.keys(st().edits)) { const [x, y, z] = k.split(',').map(Number); const ck = ckey(Math.floor(x / SX), Math.floor(y / SY), Math.floor(z / SZ)); if (!m.has(ck)) m.set(ck, []); m.get(ck).push(k); }
      model.cache.editsFor = st().edits; model.cache.editsIdx = m; return m;
    };
    const columnCache = new Map();
    const columnHeights = (cx, cz) => {
      const k = cx * 100003 + cz; let col = columnCache.get(k);
      if (col) return col;
      col = new Float32Array(SX * SZ).fill(NaN);
      if (columnCache.size > config.cacheChunks) columnCache.clear();
      columnCache.set(k, col); return col;
    };
    function generate(cx, cy, cz) {
      model.ensure();
      const cells = new Uint16Array(SX * SY * SZ);
      if (cy < 0 || cy >= NCY) return { cells, cx, cy, cz };
      const x0 = cx * SX, y0 = cy * SY, z0 = cz * SZ, heights = columnHeights(cx, cz);
      const ctx = {
        cx, cy, cz, x0, y0, z0, sx: SX, sy: SY, sz: SZ, cell: C, worldHeight: H, seaLevel: config.seaLevel, cells, model,
        idx, name: i => palette[i], isSolid: i => solidIdx[i] === 1, isFluid: i => fluidIdx[i] === 1,
        get: (lx, ly, lz) => cells[lx + SX * (lz + SZ * ly)],
        set: (lx, ly, lz, i) => { cells[lx + SX * (lz + SZ * ly)] = i; },
        /** Terrain surface height in cells (top solid cell) for a local column, from the height field. */
        height(lx, lz) { const j = lx + SX * lz; let h = heights[j]; if (Number.isNaN(h)) { h = model.at('height', (x0 + lx + 0.5) * C, (z0 + lz + 0.5) * C, config.ground * C - C) / C; heights[j] = h; } return h; },
        biome: (lx, lz) => model.at('biome', (x0 + lx + 0.5) * C, (z0 + lz + 0.5) * C, null),
      };
      if (!model.layers.length || !model.has('height')) { // fallback flat ground
        const g = idx(config.groundBlock);
        for (let ly = 0; ly < SY && y0 + ly < config.ground; ly++) for (let j = 0; j < SX * SZ; j++) cells[j + SX * SZ * ly] = g;
      }
      for (const layer of model.layers) {
        if (layer.y && (y0 + SY <= layer.y[0] || y0 > layer.y[1])) continue;
        if (layer.bounds) { const [bx0, bz0, bx1, bz1] = layer.bounds; if ((x0 + SX) * C < bx0 || x0 * C > bx1 || (z0 + SZ) * C < bz0 || z0 * C > bz1) continue; }
        layer.chunk(ctx);
      }
      return { cells, cx, cy, cz };
    }
    let builtVersion = -1;
    function chunk(cx, cy, cz) {
      const k = ckey(cx, cy, cz);
      if (k === lastKey && last && model.version === builtVersion) return last;
      model.ensure();
      if (model.version !== builtVersion) { chunks.clear(); columnCache.clear(); builtVersion = model.version; }
      let c = chunks.get(k);
      if (!c) {
        c = generate(cx, cy, cz);
        for (const ek of editsByChunk().get(k) || []) { const [x, y, z] = ek.split(',').map(Number); c.cells[(x - cx * SX) + SX * ((z - cz * SZ) + SZ * (y - cy * SY))] = idx(st().edits[ek]); }
        if (chunks.size >= config.cacheChunks) { let n = Math.ceil(config.cacheChunks / 4); for (const key of chunks.keys()) { chunks.delete(key); if (--n <= 0) break; } }
        chunks.set(k, c);
      }
      last = c; lastKey = k; return c;
    }
    const cellIdx = (x, y, z) => {
      if (y < 0 || y >= H) return 0;
      const cx = Math.floor(x / SX), cy = Math.floor(y / SY), cz = Math.floor(z / SZ);
      return chunk(cx, cy, cz).cells[(x - cx * SX) + SX * ((z - cz * SZ) + SZ * (y - cy * SY))];
    };
    const solidCell = (x, y, z) => y < 0 || (y < H && solidIdx[cellIdx(x, y, z)] === 1);
    const fluidCell = (x, y, z) => y >= 0 && y < H && fluidIdx[cellIdx(x, y, z)] === 1;
    const toCell = at => [Math.floor((at[0] ?? 0) / C), Math.floor((at[1] ?? 0) / C), Math.floor((at[2] ?? 0) / C)];
    const toAt = (x, y, z) => [(x + 0.5) * C, y * C, (z + 0.5) * C];
    rt.onRestore(() => { chunks.clear(); last = null; lastKey = -1; model.cache.editsFor = null; });

    // ----- bodies and zones -----
    const ops = entityOps({ rt, sid, model, defaultBody: config.body, st }), { bodySize, boxOf, entities, zones, track } = ops;
    const boxHitsSolid = (min, max) => {
      const eps = 1e-6;
      const a = [Math.floor(min[0] / C), Math.floor(min[1] / C), Math.floor(min[2] / C)], b = [Math.floor((max[0] - eps) / C), Math.floor((max[1] - eps) / C), Math.floor((max[2] - eps) / C)];
      for (let y = a[1]; y <= b[1]; y++) for (let x = a[0]; x <= b[0]; x++) for (let z = a[2]; z <= b[2]; z++) if (solidCell(x, y, z)) return true;
      return false;
    };
    /** Feet cell free, head room free, and support below (solid, ladder, or water when swimming). */
    function standable(x, y, z, hc, swim) {
      if (y < 0 || y >= H || solidCell(x, y, z)) return false;
      for (let k = 1; k < hc; k++) if (solidCell(x, y + k, z)) return false;
      return solidCell(x, y - 1, z) || (swim && fluidCell(x, y, z)) || climbable(x, y, z);
    }
    const climbable = (x, y, z) => { const id = palette[cellIdx(x, y, z)]; if (!id) return false; const d = blockDef(id); return d.tags?.includes('climbable') || /ladder|vine/.test(id); };
    const columnTop = (x, z, yMax = H - 1, yMin = 0) => { for (let y = Math.min(yMax, H - 1); y >= yMin; y--) if (solidCell(x, y, z)) return y; return -1; };
    /** A standable spot for a zone: its `spawn`/`at`, else near its centre within its height range. */
    const anchor = zone => {
      if (zone.spawn || zone.at) { const a = zone.spawn || zone.at; return a.length === 2 ? surfaceAt(a[0], a[1]) : v3(a); }
      const c = zoneCenter(zone); if (!c) return null;
      const [y0, y1] = zoneYRange(zone), hc = Math.ceil(bodySize({ components: {} })[1] / C);
      const cx = Math.floor(c[0] / C), cz = Math.floor(c[1] / C);
      for (let r = 0; r <= 32; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = cx + dx, z = cz + dz, top = Math.min(H - 1, Math.floor((Number.isFinite(y1) ? y1 : H * C) / C) - 1), bot = Math.max(1, Math.ceil((Number.isFinite(y0) ? y0 : 0) / C));
        for (let y = top; y >= bot; y--) if (standable(x, y, z, hc, false) && zoneHas(zone, (x + 0.5) * C, y * C, (z + 0.5) * C)) return toAt(x, y, z);
      }
      return surfaceAt(c[0], c[1]);
    };
    const surfaceAt = (x, z) => { const cx = Math.floor(x / C), cz = Math.floor(z / C); return [x, (columnTop(cx, cz) + 1) * C, z]; };

    // ----- raycast (Amanatides-Woo DDA through cells, slab test against entity boxes) -----
    function raycast(from, dir, maxDist = 64, mask = {}) {
      const m = typeof mask === 'string' ? { cells: mask !== 'entities', entities: mask !== 'cells' } : mask;
      const o = v3(from), d = v3(dir), l = Math.hypot(...d) || 1, u = d.map(v => v / l);
      const ignore = new Set([].concat(m.ignore ?? []));
      let best = { hit: 'none', at: null, normal: null, dist: maxDist };
      if (m.cells !== false) {
        let x = Math.floor(o[0] / C), y = Math.floor(o[1] / C), z = Math.floor(o[2] / C);
        const step = u.map(v => (v > 0 ? 1 : v < 0 ? -1 : 0)), cell = [x, y, z];
        const tDelta = u.map(v => (v ? Math.abs(C / v) : Infinity));
        const tMax = u.map((v, i) => (v > 0 ? ((cell[i] + 1) * C - o[i]) / v : v < 0 ? (cell[i] * C - o[i]) / v : Infinity));
        let t = 0, normal = [0, 0, 0];
        const hits = (cx, cy, cz) => (m.fluids ? cellIdx(cx, cy, cz) !== 0 && cy >= 0 && cy < H : solidCell(cx, cy, cz) && cy >= 0);
        for (let n = 0; n < 4096 && t <= maxDist; n++) {
          if (hits(x, y, z)) { best = { hit: 'cell', at: o.map((v, i) => v + u[i] * t), normal, dist: t, cell: [x, y, z], block: palette[cellIdx(x, y, z)] }; break; }
          const a = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : (tMax[1] < tMax[2] ? 1 : 2);
          t = tMax[a]; tMax[a] += tDelta[a];
          if (a === 0) x += step[0]; else if (a === 1) y += step[1]; else z += step[2];
          normal = [0, 0, 0]; normal[a] = -step[a];
          if ((y < 0 && step[1] <= 0) || (y >= H && step[1] >= 0)) break;
        }
      }
      if (m.entities !== false) { const e = ops.rayEntities(o, u, best.dist, { ignore: [...ignore], filter: m.filter }); if (e) best = e; }
      return best;
    }

    // ----- pathfinding over standable cells (walk, step up, drop; swim/climb/fly abilities) -----
    const pathOpts = (o = {}) => {
      const abilities = new Set(Array.isArray(o) ? o : o.abilities || []);
      return { hc: Math.max(1, Math.ceil((o.height ?? config.body[1]) / C)), step: Math.max(0, Math.round((o.step ?? (abilities.has('jump') ? 1.25 : 1)) / C)), drop: Math.max(0, Math.round((o.drop ?? 3) / C)), swim: abilities.has('swim'), climb: true, fly: abilities.has('fly'), maxNodes: o.maxNodes ?? config.pathNodes, avoid: o.avoid };
    };
    function moves(n, p, push) {
      const [x, y, z] = n;
      if (p.fly) { for (const [dx, dy, dz] of [...DIRS6]) { const q = [x + dx, y + dy, z + dz]; if (q[1] >= 0 && q[1] < H && !solidCell(...q) && !solidCell(q[0], q[1] + 1, q[2])) push(q, 1); } return; }
      for (const [dx, dz] of H8) {
        const nx = x + dx, nz = z + dz, diag = dx && dz;
        if (diag) { let blockedDiag = false; for (let k = 0; k < p.hc && !blockedDiag; k++) blockedDiag = solidCell(x + dx, y + k, z) || solidCell(x, y + k, z + dz); if (blockedDiag) continue; }
        for (let ny = y + p.step; ny >= y - p.drop; ny--) {
          if (ny > y) { let head = true; for (let k = y + p.hc; k < ny + p.hc && head; k++) if (solidCell(x, k, z)) head = false; if (!head) continue; }
          if (!standable(nx, ny, nz, p.hc, p.swim)) continue;
          let clear = true; for (let k = ny + p.hc; k < Math.max(y, ny) + p.hc && clear; k++) if (solidCell(nx, k, nz)) clear = false;
          if (!clear) continue;
          if (p.avoid?.([nx, ny, nz])) break;
          push([nx, ny, nz], (diag ? 1.414 : 1) + (ny > y ? 0.5 * (ny - y) : 0.2 * (y - ny)) + (fluidCell(nx, ny, nz) ? 2 : 0));
          break;
        }
      }
      if (p.climb) for (const dy of [1, -1]) { const q = [x, y + dy, z]; if ((climbable(x, y, z) || climbable(...q)) && standable(...q, p.hc, true)) push(q, 1.5); }
      if (p.swim && fluidCell(x, y + 1, z) && !solidCell(x, y + p.hc, z)) push([x, y + 1, z], 1.5);
      if (p.swim && fluidCell(x, y - 1, z)) push([x, y - 1, z], 1.2);
    }
    const snap = (at, p) => {
      const [x, y, z] = toCell(v3(at));
      for (let dy = 0; dy <= p.drop + 2; dy++) for (const yy of [y - dy, y + dy]) if (yy >= 0 && yy < H && (p.fly ? !solidCell(x, yy, z) : standable(x, yy, z, p.hc, p.swim))) return [x, yy, z];
      return null;
    };
    const keyOf = c => `${c[0]},${c[1]},${c[2]}`;
    function path(from, to, o) {
      const p = pathOpts(o), a = snap(from, p), b = snap(to, p);
      if (!a || !b) return null;
      const r = astar({ start: a, isGoal: c => c[0] === b[0] && c[1] === b[1] && c[2] === b[2], neighbors: (n, push) => moves(n, p, push), h: c => Math.hypot(c[0] - b[0], (c[1] - b[1]) * 0.5, c[2] - b[2]), key: keyOf, maxNodes: p.maxNodes });
      return r.path ? r.path.map(c => toAt(...c)) : null;
    }
    function reachable(from, rtOrOpts, o) {
      const opts = rtOrOpts && !rtOrOpts.state ? rtOrOpts : o || {};
      const p = pathOpts(opts), a = snap(from, p), out = new Set();
      if (!a) return out;
      const seen = new Set([keyOf(a)]), queue = [a];
      for (let i = 0; i < queue.length && seen.size < p.maxNodes; i++) moves(queue[i], p, q => { const k = keyOf(q); if (!seen.has(k)) { seen.add(k); queue.push(q); } });
      for (const k of seen) out.add(k);
      const zs = zones(); for (const c of queue) for (const z of zs) if (!out.has(z.id) && zoneHas(z, (c[0] + 0.5) * C, c[1] * C, (c[2] + 0.5) * C)) out.add(z.id);
      out.truncated = seen.size >= p.maxNodes;
      return out;
    }

    // ----- light -----
    function lightAt(at) {
      if (config.lightModel === 'none') return 15;
      const [x, y, z] = toCell(v3(at));
      let sky = 15; for (let yy = y + 1; yy < H; yy++) if (opaqueIdx[cellIdx(x, yy, z)]) { sky = Math.max(0, 15 - Math.min(15, 4 + Math.floor((columnTop(x, z) - y) / 2))); break; }
      if (config.lightModel === 'sky') return sky;
      let block = 0;
      for (let dx = -14; dx <= 14; dx++) for (let dz = -14 + Math.abs(dx); dz <= 14 - Math.abs(dx); dz++) {
        const rest = 14 - Math.abs(dx) - Math.abs(dz);
        for (let dy = -rest; dy <= rest; dy++) { const L = lightIdx[cellIdx(x + dx, y + dy, z + dz)]; if (L) block = Math.max(block, L - Math.abs(dx) - Math.abs(dz) - Math.abs(dy)); }
      }
      return Math.max(sky, block);
    }

    // ----- fluids -----
    const enqueue = c => { if (config.fluid) st().fluidQueue.push(keyOf(c)); };
    function flowStep(rt) {
      const s = st(); if (!s.fluidQueue.length) return;
      const batch = s.fluidQueue.splice(0, config.fluidBudget), done = new Set();
      for (const k of batch) {
        if (done.has(k)) continue; done.add(k);
        const [x, y, z] = k.split(',').map(Number), i = cellIdx(x, y, z);
        if (!fluidIdx[i]) { for (const [dx, dy, dz] of DIRS6) if (dy >= 0 && fluidCell(x + dx, y + dy, z + dz)) s.fluidQueue.push(keyOf([x + dx, y + dy, z + dz])); continue; }
        const f = palette[i], level = s.fluidLevel[k] ?? 0;
        if (y > 0 && cellIdx(x, y - 1, z) === 0) { api.setCell(toAt(x, y - 1, z), f, rt, 'fluid'); s.fluidLevel[keyOf([x, y - 1, z])] = level; rt.emit('fluid_flow', { at: [x, y - 1, z], block: f }); continue; }
        if (level >= config.flowRange || !solidCell(x, y - 1, z) && !fluidCell(x, y - 1, z)) continue;
        for (const [dx, dz] of H8.slice(0, 4)) if (cellIdx(x + dx, y, z + dz) === 0) { api.setCell(toAt(x + dx, y, z + dz), f, rt, 'fluid'); s.fluidLevel[keyOf([x + dx, y, z + dz])] = level + 1; rt.emit('fluid_flow', { at: [x + dx, y, z + dz], block: f }); }
      }
    }

    // ----- surface -----
    function groundAt(x, z) {
      const cx = Math.floor(x / C), cz = Math.floor(z / C);
      let y = H - 1; while (y >= 0 && !solidCell(cx, y, cz)) y--;
      const top = y, hx = columnTop(cx + 1, cz, top + 8) - columnTop(cx - 1, cz, top + 8), hz = columnTop(cx, cz + 1, top + 8) - columnTop(cx, cz - 1, top + 8);
      const n = [-hx / 2, 1, -hz / 2], l = Math.hypot(...n);
      return { y: (top + 1) * C, normal: n.map(v => v / l), material: top >= 0 ? palette[cellIdx(cx, top, cz)] : null, biome: model.ensure().at('biome', x, z, null) };
    }
    const slopeAt = (x, z) => { const n = groundAt(x, z).normal; return +(Math.acos(Math.min(1, n[1])) * 180 / Math.PI).toFixed(3); };
    function waterDepthAt(x, z) {
      const cx = Math.floor(x / C), cz = Math.floor(z / C); let y = H - 1, depth = 0;
      while (y >= 0 && cellIdx(cx, y, cz) === 0) y--;
      while (y >= 0 && fluidCell(cx, y, cz)) { depth++; y--; }
      return depth * C;
    }

    const api = {
      kind: 'voxel', config, cell: C, chunkSize: [SX, SY, SZ], size: [Infinity, H * C, Infinity],
      model: () => model.ensure(),
      // position
      place(e, rt) {
        if (e.at == null) { const start = zones().find(z => (z.tags || []).includes('start')) || zones()[0]; e.at = (start && anchor(start)) || surfaceAt(0, 0); }
        e.at = e.at.length === 2 ? surfaceAt(e.at[0], e.at[1]) : v3(e.at); e.zone = null; track(e, rt);
      },
      remove(e) { ops.untrack(e); },
      pos: e => e.at,
      setPos(e, at, rt) { e.at = at.length === 2 ? surfaceAt(at[0], at[1]) : v3(at); track(e, rt); },
      entitiesAt: ops.entitiesAt, inZone: ops.inZone, zoneAt: ops.zoneAt,
      teleport(e, { zone, at }, rt) { const z = zone && zones().find(x => x.id === zone); const to = at ?? (z && anchor(z)); if (to) api.setPos(e, to, rt); },
      nearest: (e, target) => ops.nearest(e, target),
      // distance
      distance: (a, b, metric = 'euclid') => ops.distance(a, b, metric, path),
      // overlap
      overlap: (shape, filter) => ops.overlap(shape, filter),
      contacts(e) {
        const b = boxOf(e), out = [], s = 0.02;
        for (let i = 0; i < 3; i++) for (const sign of [-1, 1]) {
          const min = b.min.slice(), max = b.max.slice();
          if (sign < 0) { max[i] = b.min[i]; min[i] = b.min[i] - s; } else { min[i] = b.max[i]; max[i] = b.max[i] + s; }
          for (let x = Math.floor(min[0] / C); x <= Math.floor((max[0] - 1e-6) / C); x++) for (let y = Math.floor(min[1] / C); y <= Math.floor((max[1] - 1e-6) / C); y++) for (let z = Math.floor(min[2] / C); z <= Math.floor((max[2] - 1e-6) / C); z++) {
            if (solidCell(x, y, z)) { const normal = [0, 0, 0]; normal[i] = -sign; out.push({ cell: [x, y, z], normal, block: palette[cellIdx(x, y, z)] }); }
          }
        }
        for (const o of entities()) if (o !== e) { const c = boxOf(o); if (b.min.every((m, i) => m <= c.max[i] + s && b.max[i] >= c.min[i] - s)) { const d = v3(o.at).map((v, i) => v - v3(e.at)[i]); const l = Math.hypot(d[0], d[2]) || 1; out.push({ id: o.id, normal: [-d[0] / l, 0, -d[2] / l] }); } }
        return out;
      },
      raycast,
      path,
      reachable,
      canReach(a, b, o) { const opts = o && !o.state ? o : {}; return path(a, b, opts) !== null; },
      // editCells
      getCell: at => { const [x, y, z] = toCell(v3(at)); return palette[cellIdx(x, y, z)] ?? null; },
      setCell(at, block, rt, by = null) {
        const [x, y, z] = toCell(v3(at)); if (y < 0 || y >= H) return false;
        const from = palette[cellIdx(x, y, z)] ?? null, to = block ?? null; if (from === to) return false;
        const s = st(), k = keyOf([x, y, z]);
        // Store the edit (a fresh map object so the edit index is rebuilt lazily).
        const c = chunk(Math.floor(x / SX), Math.floor(y / SY), Math.floor(z / SZ));
        c.cells[(x - c.cx * SX) + SX * ((z - c.cz * SZ) + SZ * (y - c.cy * SY))] = idx(to);
        s.edits[k] = to;
        const list = model.cache.editsFor === s.edits && model.cache.editsIdx; if (list) { const ck = ckey(c.cx, c.cy, c.cz); if (!list.has(ck)) list.set(ck, []); if (!list.get(ck).includes(k)) list.get(ck).push(k); }
        s.log.push({ t: rt.state.frame, at: [x, y, z], from, to, by }); if (s.log.length > config.logMax) s.log.splice(0, s.log.length - config.logMax);
        if (by !== 'fluid') delete s.fluidLevel[k];
        rt.emit('cell_changed', { at: [x, y, z], from, to, by, space: sid });
        if (config.fluid) { enqueue([x, y, z]); for (const [dx, dy, dz] of DIRS6) if (fluidCell(x + dx, y + dy, z + dz)) enqueue([x + dx, y + dy, z + dz]); }
        return true;
      },
      fill(box, block, rt) {
        const [a, b] = box.map(p => toCell(v3(p))), vol = (b[0] - a[0] + 1) * (b[1] - a[1] + 1) * (b[2] - a[2] + 1);
        if (vol > config.maxFill || vol <= 0) return 0;
        let n = 0; for (let y = a[1]; y <= b[1]; y++) for (let x = a[0]; x <= b[0]; x++) for (let z = a[2]; z <= b[2]; z++) if (api.setCell(toAt(x, y, z), block, rt)) n++;
        return n;
      },
      cellsIn(box) {
        const [a, b] = box.map(p => toCell(v3(p))), out = [];
        if ((b[0] - a[0] + 1) * (b[1] - a[1] + 1) * (b[2] - a[2] + 1) > config.maxFill) return out;
        for (let y = Math.max(0, a[1]); y <= Math.min(H - 1, b[1]); y++) for (let x = a[0]; x <= b[0]; x++) for (let z = a[2]; z <= b[2]; z++) { const i = cellIdx(x, y, z); if (i) out.push({ at: [x, y, z], block: palette[i] }); }
        return out;
      },
      editLog: (since = -1) => st().log.filter(e => e.t > since),
      // gravity
      gravityAt: () => [0, config.gravity, 0],
      /** Collide-and-slide the body box by delta (metres), axis by axis in sub-steps, stepping up ledges up to body.step (default 0). */
      slide(e, delta, rt) {
        const d = v3(delta), p = v3(e.at), s = bodySize(e), stepH = e.components?.body?.step ?? 0;
        const n = Math.min(64, Math.max(1, Math.ceil(Math.max(...d.map(Math.abs)) / (0.45 * Math.min(C, s[0], s[2], s[1])))));
        const blocked = { x: false, y: false, z: false }; let normal = null;
        const half = [s[0] / 2, 0, s[2] / 2];
        const box = q => ({ min: [q[0] - half[0], q[1], q[2] - half[2]], max: [q[0] + half[0], q[1] + s[1], q[2] + half[2]] });
        const free = q => { const b = box(q); return !boxHitsSolid(b.min, b.max); };
        const wasGrounded = api.grounded(e);
        for (let k = 0; k < n; k++) for (const i of [0, 2, 1]) {
          const di = d[i] / n; if (!di) continue;
          const q = p.slice(); q[i] += di;
          if (free(q)) { p[i] = q[i]; continue; }
          if (i !== 1 && stepH > 0 && wasGrounded) {
            let lifted = false;
            for (let up = C / 8; up <= stepH + 1e-9; up += C / 8) { const r = q.slice(); r[1] += up; if (free(r)) { p[i] = r[i]; p[1] = r[1]; lifted = true; break; } }
            if (lifted) continue;
          }
          // flush against the blocking cell face
          if (i === 1) p[1] = di < 0 ? Math.floor(p[1] / C + 1e-9) * C : Math.ceil((p[1] + s[1]) / C - 1e-9) * C - s[1];
          else p[i] = di > 0 ? Math.ceil((p[i] + half[i]) / C - 1e-9) * C - half[i] - 1e-4 : Math.floor((p[i] - half[i]) / C + 1e-9) * C + half[i] + 1e-4;
          if (!free(p)) p[i] = v3(e.at)[i];
          blocked[i === 0 ? 'x' : i === 1 ? 'y' : 'z'] = true;
          normal = [0, 0, 0]; normal[i] = -Math.sign(di); d[i] = 0;
        }
        const before = v3(e.at), moved = p.some((v, i) => Math.abs(v - before[i]) > 1e-12);
        api.setPos(e, p.map(v => +v.toFixed(9)), rt);
        return { moved, blocked, grounded: api.grounded(e), normal };
      },
      grounded(e) { const b = boxOf(e); return boxHitsSolid([b.min[0] + 1e-4, b.min[1] - 0.05, b.min[2] + 1e-4], [b.max[0] - 1e-4, b.min[1], b.max[2] - 1e-4]); },
      // surface
      groundAt, slopeAt, waterDepthAt,
      // chunks (renderers, streaming)
      chunkCells(cx, cy, cz) { const c = chunk(cx, cy, cz); return { origin: [cx * SX, cy * SY, cz * SZ], size: [SX, SY, SZ], cells: c.cells, palette }; },
      chunkOf: at => { const [x, y, z] = toCell(v3(at)); return [Math.floor(x / SX), Math.floor(y / SY), Math.floor(z / SZ)]; },
      chunksNear(at, radius = config.viewDistance) {
        const [cx, , cz] = api.chunkOf(at), out = [];
        for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) if (dx * dx + dz * dz <= radius * radius) for (let cy = 0; cy < NCY; cy++) out.push([cx + dx, cy, cz + dz]);
        return out.sort((a, b) => ((a[0] - cx) ** 2 + (a[2] - cz) ** 2) - ((b[0] - cx) ** 2 + (b[2] - cz) ** 2) || a[1] - b[1]);
      },
      blockDef,
      lightAt,
      columnTop: (x, z) => (columnTop(Math.floor(x / C), Math.floor(z / C)) + 1) * C,
      loadedChunks: () => chunks.size,
    };
    rt.defineSpace(sid, api);
    sharedService(rt, 'surface', sid, { call: (x, z) => groundAt(x, z), groundAt, slopeAt, waterDepthAt }, ['groundAt', 'slopeAt', 'waterDepthAt']);
    if (config.fluid) rt.system('physics', flowStep, 'engine.space.voxel');
    model.surfaceY = (x, z) => (Math.floor(model.at('height', x, z, config.ground * C - C) / C) + 1) * C;
    model.onBuilt = m => { st().generated = { problems: m.problems.slice(0, 50), info: m.info.summary || {} }; rt.emit('generated', { space: sid, problems: m.problems.length }); };
  },
  extend(rt, config, added, instance) {
    if (added.zones.some(z => z.space === instance.id)) rt.caches[`worlds3d:model:${instance.id}`]?.reset();
  },
};
