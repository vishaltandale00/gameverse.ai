// Fractal heightfield terrain for 3D spaces (voxel and mesh3d): warped fBm
// blended with ridged multifractal, island/radial falloff, droplet hydraulic
// plus thermal erosion on a coarse grid, and rivers traced downhill and
// carved into the field. Defines the WorldModel `height` field; on voxel it
// also adds the cell layer that fills columns with bedrock/stone/sub/surface
// blocks (biome-aware when engine.generate.biomes is present).
import { fbm2, ridged2, warp2, smoothstep, clamp, subSeed, Rng } from './worlds3d-lib-noise.js';
import { STAGES, withDefaults, generatorModel, chaikin, segDist2, checkBlocks, zoneBox, zoneInnerDistance } from './worlds3d-lib-world.js';

const card = {
  intent: 'Fractal terrain heightfield: rolling hills to ridged mountains, optional island or radial falloff, domain warp, hydraulic/thermal erosion and downhill rivers. Fills voxel columns with stone, subsoil and surface blocks.',
  views: ['any'],
  spaces: ['engine.space.mesh3d', 'engine.space.voxel'],
  params: {
    octaves: { type: 'integer', min: 1, max: 8, default: 5, effect: 'noise detail layers' },
    scale: { type: 'number', min: 16, max: 4096, default: 256, unit: 'm', effect: 'horizontal size of the largest hills' },
    amplitude: { type: 'number', min: 1, max: 600, default: 40, unit: 'm', effect: 'height range of the terrain' },
    ridged: { type: 'number', min: 0, max: 1, default: 0, effect: 'blend toward sharp ridged mountains' },
    falloff: { type: 'string', options: ['none', 'island', 'radial'], default: 'none', effect: 'island: land sinks into sea at the edges; radial: one central massif' },
    seaLevel: { type: 'number', min: -1000, max: 10000, unit: 'm', effect: 'sea level the terrain is shaped around (default: the space sea level, 0 on mesh3d)' },
    rivers: { type: 'integer', min: 0, max: 64, default: 0, effect: 'rivers traced from high ground down to the sea and carved in' },
    erosion: { type: 'integer', min: 0, max: 8, default: 0, effect: 'hydraulic + thermal erosion passes on the coarse grid' },
    warp: { type: 'number', min: 0, max: 1, default: 0, effect: 'domain warp strength: twisted, less grid-like landforms' },
    landBias: { type: 'number', min: -3, max: 3, default: 0.2, effect: 'shifts terrain up (+) or down (-) relative to sea level, in amplitudes' },
    lacunarity: { type: 'number', min: 1.5, max: 3, default: 2, effect: 'frequency multiplier per octave' },
    gain: { type: 'number', min: 0.2, max: 0.8, default: 0.5, effect: 'amplitude multiplier per octave' },
    extent: { type: 'list', of: { type: 'number' }, min: 4, max: 4, effect: 'world box [x0, z0, x1, z1] for falloff and rivers (default: space size, or the union of zones)' },
    land: { type: 'list', of: { type: 'ref', to: 'zone' }, default: [], effect: 'zones guaranteed to be dry land (raised above sea level, rising from the zone edge)' },
    landHeight: { type: 'number', min: 0, max: 200, default: 2, unit: 'm', effect: 'minimum height above sea inside land zones' },
    grid: { type: 'integer', min: 32, max: 512, default: 160, effect: 'coarse grid resolution (per side) used for erosion and river tracing' },
    riverWidth: { type: 'number', min: 1, max: 200, default: 8, unit: 'm', effect: 'river width at the mouth (sources are narrower)' },
    riverDepth: { type: 'number', min: 0.5, max: 50, default: 3, unit: 'm', effect: 'channel depth below the water surface' },
    subDepth: { type: 'integer', min: 0, max: 16, default: 3, unit: 'cells', effect: 'voxel: depth of the sub-surface layer (dirt under grass)' },
    blocks: {
      type: 'object', default: { surface: 'grass', sub: 'dirt', stone: 'stone', bedrock: 'bedrock', shore: 'sand', underwater: 'gravel' }, effect: 'voxel block ids (biomes override surface/sub)',
      fields: {
        surface: { type: 'string', default: 'grass' }, sub: { type: 'string', default: 'dirt' }, stone: { type: 'string', default: 'stone' },
        bedrock: { type: 'string', default: 'bedrock' }, shore: { type: 'string', default: 'sand' }, underwater: { type: 'string', default: 'gravel' },
      },
    },
  },
  provides: { content: ['terrain'], events: ['generated'], services: ['surface'] },
  reads: [],
};

/** Droplet hydraulic erosion + one thermal relaxation, in place on a coarse grid. */
function erode(hm, N, cellM, passes, seed, amplitude) {
  const rng = new Rng(seed), idx = (x, z) => x + N * z;
  const sample = (x, z) => { const ix = Math.floor(x), iz = Math.floor(z), u = x - ix, v = z - iz, a = hm[idx(ix, iz)], b = hm[idx(ix + 1, iz)], c = hm[idx(ix, iz + 1)], d = hm[idx(ix + 1, iz + 1)]; return { h: (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v, gx: (b - a) * (1 - v) + (d - c) * v, gz: (c - a) * (1 - u) + (d - b) * u }; };
  const inertia = 0.05, capacityK = 4, deposit = 0.3, erodeK = 0.3, evaporate = 0.02, minSlope = 0.01, scale = amplitude / cellM;
  for (let pass = 0; pass < passes; pass++) {
    const drops = Math.floor((N * N) / 3);
    for (let n = 0; n < drops; n++) {
      let x = rng.range(1, N - 2), z = rng.range(1, N - 2), dx = 0, dz = 0, speed = 1, water = 1, sed = 0;
      for (let life = 0; life < 48; life++) {
        const ix = Math.floor(x), iz = Math.floor(z), u = x - ix, v = z - iz, s = sample(x, z);
        dx = dx * inertia - s.gx * (1 - inertia); dz = dz * inertia - s.gz * (1 - inertia);
        const l = Math.hypot(dx, dz); if (l < 1e-9) break; dx /= l; dz /= l;
        x += dx; z += dz;
        if (x < 1 || z < 1 || x >= N - 2 || z >= N - 2) break;
        const dh = sample(x, z).h - s.h, cap = Math.max(-dh * scale, minSlope) * speed * water * capacityK;
        const put = amt => { hm[idx(ix, iz)] += amt * (1 - u) * (1 - v); hm[idx(ix + 1, iz)] += amt * u * (1 - v); hm[idx(ix, iz + 1)] += amt * (1 - u) * v; hm[idx(ix + 1, iz + 1)] += amt * u * v; };
        if (sed > cap || dh > 0) { const amt = dh > 0 ? Math.min(dh, sed) : (sed - cap) * deposit; sed -= amt; put(amt); }
        else { const amt = Math.min((cap - sed) * erodeK, -dh); sed += amt; put(-amt); }
        speed = Math.sqrt(Math.max(0, speed * speed - dh * scale)); water *= 1 - evaporate;
      }
    }
    // thermal: material slides off slopes steeper than the talus angle
    const talus = cellM * 1.2, out = hm.slice();
    for (let z = 1; z < N - 1; z++) for (let x = 1; x < N - 1; x++) {
      const h = hm[idx(x, z)];
      for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const d = h - hm[idx(x + ox, z + oz)]; if (d > talus) { const m = (d - talus) * 0.25; out[idx(x, z)] -= m; out[idx(x + ox, z + oz)] += m; } }
    }
    hm.set(out);
  }
}

const TERRAIN_BLOCKS = [['bedrock', '#2b2b2b'], ['stone', '#7d7d7d'], ['dirt', '#7a5532'], ['grass', '#5f9e3a'], ['sand', '#d8c78a'], ['gravel', '#8a8580']];

export default {
  id: 'engine.generate.terrain.noise',
  card,
  /**
   * Planner hook (v2/planner/world.js): rolling ground for a mesh3d or voxel space, every zone kept dry land, gentle
   * enough for roads and vehicles. On a voxel document that lists its blocks, the terrain blocks it lacks are declared.
   */
  scaffold(space, doc) {
    if (!card.spaces.includes(space.use)) return null;
    const voxel = space.use === 'engine.space.voxel', land = (space.zones || []).filter(z => zoneBox(z)).map(z => z.id);
    const out = { with: { amplitude: voxel ? 10 : 12, scale: voxel ? 96 : 256, landBias: 0.6, ...(land.length ? { land } : {}) } };
    const known = new Set((doc.content?.blocks || []).map(b => b?.id));
    if (voxel && known.size) { const add = TERRAIN_BLOCKS.filter(([id]) => !known.has(id)).map(([id, color]) => ({ id, name: id[0].toUpperCase() + id.slice(1), solid: true, color })); if (add.length) out.content = { blocks: add }; }
    return out;
  },
  validate(config, doc, ctx, inst) {
    const errors = checkBlocks(doc, inst, Object.entries(config.blocks || {}).map(([k, id]) => [`with.blocks.${k}`, id]));
    if (config.extent && !(config.extent[2] > config.extent[0] && config.extent[3] > config.extent[1])) errors.push({ code: 'terrain_extent_invalid', path: 'with.extent', message: 'extent must be [x0, z0, x1, z1] with x1 > x0 and z1 > z0' });
    return errors;
  },
  install(rt, raw, instance) {
    const config = withDefaults(card, raw), model = generatorModel(rt, instance);
    if (!model) return;
    model.contribute(`terrain#${instance.key}`, STAGES.terrain, (m, seed) => {
      const ext = config.extent || m.extent(), [x0, z0, x1, z1] = ext;
      const sea = config.seaLevel ?? m.opts.seaLevel ?? 0, amp = config.amplitude, inv = 1 / config.scale;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hx = (x1 - x0) / 2, hz = (z1 - z0) / 2;
      const sN = subSeed(seed, 'n'), sR = subSeed(seed, 'r'), sW = subSeed(seed, 'w');
      const base = (x, z) => {
        const [wx, wz] = warp2(sW, x * inv, z * inv, config.warp * 1.5);
        let n = 1.9 * fbm2(sN, wx, wz, config.octaves, config.lacunarity, config.gain); // fBm spans about ±0.5; scale to about ±1
        if (config.ridged > 0) n = n * (1 - config.ridged) + (ridged2(sR, wx, wz, config.octaves, config.lacunarity, config.gain) * 2.4 - 1) * config.ridged;
        let h = n + config.landBias;
        if (config.falloff !== 'none') {
          const d = Math.hypot((x - cx) / hx, (z - cz) / hz);
          if (config.falloff === 'island') { const f = smoothstep(0.62, 1.02, d); h = h * (1 - f) - 0.7 * f; }
          else h = h * 0.6 + (1 - Math.min(1.2, d)) * 0.9 - 0.25;
        }
        return sea + amp * h;
      };
      // Coarse grid for erosion and rivers.
      const N = config.grid, gx = (x1 - x0) / (N - 1), gz = (z1 - z0) / (N - 1), cellM = Math.max(gx, gz);
      const needGrid = config.erosion > 0 || config.rivers > 0;
      let delta = null, grid = null;
      if (needGrid) {
        grid = new Float32Array(N * N);
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) grid[i + N * j] = base(x0 + i * gx, z0 + j * gz);
        if (config.erosion > 0) {
          const before = grid.slice();
          erode(grid, N, cellM, config.erosion, subSeed(seed, 'erosion'), amp);
          delta = new Float32Array(N * N); for (let k = 0; k < N * N; k++) delta[k] = grid[k] - before[k];
        }
      }
      const bilinear = (arr, x, z) => {
        const fx = clamp((x - x0) / gx, 0, N - 1.001), fz = clamp((z - z0) / gz, 0, N - 1.001), i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
        return (arr[i + N * j] * (1 - u) + arr[i + 1 + N * j] * u) * (1 - v) + (arr[i + N * (j + 1)] * (1 - u) + arr[i + 1 + N * (j + 1)] * u) * v;
      };
      const height = delta ? (x, z) => base(x, z) + (x >= x0 && x <= x1 && z >= z0 && z <= z1 ? bilinear(delta, x, z) : 0) : base;
      m.define('height', height);
      // Land zones: raise the inside above the sea, ramping up from the zone edge over a fifth of its size.
      for (const id of config.land) {
        const z = m.zone(id); if (!z) { m.problem('zone_missing', `land zone '${id}' is not in space '${m.sid}'`, { generator: instance.use }); continue; }
        const b = zoneBox(z), ramp = Math.max(8, Math.min(b[2] - b[0], b[3] - b[1]) / 5), floor = sea + config.landHeight;
        m.modify('height', { bounds: b, priority: 1, apply(x, zz, h) { const d = zoneInnerDistance(z, x, zz); if (d <= 0 || h >= floor) return h; return Math.max(h, sea - 1 + (floor - sea + 1) * smoothstep(0, ramp, d)); } });
      }
      m.info.sea = sea; m.info.terrain = { amplitude: amp, sea };

      // Rivers: from high, spaced sources follow steepest descent on the eroded grid to the sea or the edge.
      const rivers = [];
      if (config.rivers > 0) {
        const rng = new Rng(subSeed(seed, 'rivers')), cand = [];
        for (let k = 0; k < 400; k++) { const i = rng.int(2, N - 3), j = rng.int(2, N - 3); cand.push([grid[i + N * j], i, j]); }
        cand.sort((a, b) => b[0] - a[0] || a[1] - b[1] || a[2] - b[2]);
        const minSep = (N / Math.sqrt(config.rivers + 1)) * 0.6, sources = [];
        for (const c of cand) { if (sources.length >= config.rivers) break; if (c[0] <= sea + amp * 0.2) break; if (sources.every(s => Math.hypot(s[1] - c[1], s[2] - c[2]) >= minSep)) sources.push(c); }
        const wet = new Uint8Array(N * N);
        for (const [, si, sj] of sources) {
          let i = si, j = sj; const cells = [[i, j]], seen = new Set([i + N * j]);
          for (let steps = 0; steps < N * 4; steps++) {
            let best = null;
            for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
              const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= N || nj >= N || seen.has(ni + N * nj)) continue;
              const h = grid[ni + N * nj] + (di && dj ? 0.0001 : 0);
              if (!best || h < best[0]) best = [h, ni, nj];
            }
            if (!best) break;
            [, i, j] = best; seen.add(i + N * j); cells.push([i, j]);
            if (wet[i + N * j] || grid[i + N * j] <= sea || i === 0 || j === 0 || i === N - 1 || j === N - 1) break;
          }
          if (cells.length < 4) continue;
          for (const [a, b] of cells) wet[a + N * b] = 1;
          // Water surface descends monotonically along the course.
          let level = Infinity;
          const pts = chaikin(cells.map(([a, b]) => [x0 + a * gx, z0 + b * gz]), 2).map(([x, z]) => { level = Math.min(level, Math.max(sea, height(x, z) - 0.5)); return [x, level, z]; });
          rivers.push({ id: `river${rivers.length + 1}`, points: pts.map(p => p.map(v => +v.toFixed(2))) });
        }
        // Carve channels; set the water field along them.
        for (const r of rivers) {
          const pts = r.points;
          for (let k = 1; k < pts.length; k++) {
            const a = pts[k - 1], b = pts[k], t0 = (k - 1) / (pts.length - 1), t1 = k / (pts.length - 1);
            const wA = config.riverWidth * (0.35 + 0.65 * t0), wB = config.riverWidth * (0.35 + 0.65 * t1), bank = Math.max(wA, wB) * 1.5 + config.riverDepth * 2;
            const bounds = [Math.min(a[0], b[0]) - bank, Math.min(a[2], b[2]) - bank, Math.max(a[0], b[0]) + bank, Math.max(a[2], b[2]) + bank];
            const profile = (x, z) => { const s = segDist2(x, z, a[0], a[2], b[0], b[2]); const w = wA + (wB - wA) * s.t; return { d: Math.sqrt(s.d2), w, level: a[1] + (b[1] - a[1]) * s.t }; };
            m.modify('height', { bounds, priority: 10, apply(x, z, h) {
              const p = profile(x, z), half = p.w / 2; if (p.d > half + bank) return h;
              const bed = p.level - config.riverDepth * (1 - smoothstep(0, half, p.d) * 0.7);
              if (p.d <= half) return Math.min(h, bed);
              return Math.min(h, p.level + (h - p.level) * smoothstep(half, half + bank, p.d) + 0.0);
            } });
            m.modify('water', { bounds, priority: 10, apply(x, z, v) { const p = profile(x, z); return p.d <= p.w / 2 ? Math.max(v ?? -Infinity, p.level) : v; } });
          }
        }
        m.info.rivers = rivers;
        if (rivers.length < config.rivers) m.problem('rivers_short', `${rivers.length} of ${config.rivers} rivers found a course to the sea`, { generator: instance.use });
      }
      m.info.summary = { ...(m.info.summary || {}), rivers: rivers.length, erosionPasses: config.erosion };

      if (m.kind === 'voxel') {
        const known = new Set((rt.doc.content?.blocks || []).map(b => b.id));
        if (known.size) for (const [k, id] of Object.entries(config.blocks)) if (!known.has(id)) m.problem('block_unknown', `terrain block '${id}' (${k}) is not in content.blocks`, { generator: instance.use });
        const B = config.blocks, seaC = sea;
        m.addLayer({
          id: 'terrain', order: 0,
          chunk(ctx) {
            const { sx, sy, sz, y0, cell } = ctx, bed = ctx.idx(B.bedrock), stone = ctx.idx(B.stone), shore = ctx.idx(B.shore), under = ctx.idx(B.underwater);
            const seaCell = seaC / cell, cache = new Map();
            const pal = (biome, key, dflt) => { const k = `${biome}|${key}`; let v = cache.get(k); if (v === undefined) { const d = biome && m.info.biomeDefs?.[biome]; v = ctx.idx((d && d[key]) || dflt); cache.set(k, v); } return v; };
            for (let lz = 0; lz < sz; lz++) for (let lx = 0; lx < sx; lx++) {
              const hc = ctx.height(lx, lz), top = Math.floor(hc);
              if (top < y0) continue;
              const biome = m.has('biome') ? ctx.biome(lx, lz) : null;
              const wl = m.at('water', (ctx.x0 + lx + 0.5) * cell, (ctx.z0 + lz + 0.5) * cell, null);
              const wet = wl != null && wl / cell > top + 0.5;
              const surf = wet || top < seaCell - 1 ? (biome && m.info.biomeDefs?.[biome]?.underwater ? pal(biome, 'underwater', B.underwater) : under) : top <= seaCell + 1 ? (biome && m.info.biomeDefs?.[biome]?.shore ? pal(biome, 'shore', B.shore) : shore) : pal(biome, 'surface', B.surface);
              const sub = top <= seaCell + 1 ? shore : pal(biome, 'sub', B.sub);
              const yEnd = Math.min(top, y0 + sy - 1);
              for (let y = y0; y <= yEnd; y++) {
                const i = y === 0 ? bed : y === top ? surf : y > top - config.subDepth - 1 ? sub : stone;
                ctx.cells[lx + sx * (lz + sz * (y - y0))] = i;
              }
            }
          },
        });
      }
    });
  },
};
