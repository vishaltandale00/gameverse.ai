// Caves for voxel worlds: "cheese" caverns from thresholded 3D noise
// (sampled on a 4-cell lattice and interpolated), "worm" tunnels from random
// walks, large ellipsoid caverns, pinned rooms per zone (domes with a flat
// floor) and optional tunnels connecting each room to the surface. A lava
// level floods the deepest carved cells. Features are placed once per seed
// and bucketed by column; chunks carve them lazily.
import { fbm3, Rng, subSeed } from './worlds3d-lib-noise.js';
import { STAGES, withDefaults, generatorModel, sharedService, zoneBox, checkBlocks } from './worlds3d-lib-world.js';

const B = 16; // feature bucket size (cells)
const card = {
  intent: 'Carves caves into a voxel world: noise caverns, winding worm tunnels, big chambers, lava at depth, and pinned rooms for zones (optionally tunnelled to the surface so they can be reached).',
  views: ['any'],
  params: {
    density: { type: 'number', min: 0, max: 1, default: 0.3, effect: 'how much of the underground the noise caverns hollow out' },
    minY: { type: 'integer', min: 1, max: 512, default: 4, unit: 'cells', effect: 'lowest carved cell' },
    maxY: { type: 'integer', min: 1, max: 512, default: 64, unit: 'cells', effect: 'highest carved cell' },
    worms: { type: 'integer', min: 0, max: 2000, default: 0, effect: 'winding tunnels across the world' },
    caverns: { type: 'integer', min: 0, max: 200, default: 0, effect: 'large ellipsoid chambers' },
    lavaLevel: { type: 'integer', min: 0, max: 512, unit: 'cells', effect: 'carved cells below this become lava' },
    lavaBlock: { type: 'string', default: 'lava', effect: 'block used for lava' },
    rooms: {
      type: 'list', default: [], effect: 'pinned chambers: floor centre `at` (m) and size [width, height] or [width, height, depth] (m)',
      of: { type: 'object', fields: { zone: { type: 'ref', to: 'zone', required: true }, at: { type: 'list', of: { type: 'number' }, min: 3, max: 3 }, size: { type: 'list', of: { type: 'number', min: 2, max: 400 }, min: 2, max: 3, default: [24, 12] }, connect: { type: 'boolean', default: true, effect: 'dig a walkable tunnel from the room to the surface' } } },
    },
    wormRadius: { type: 'list', of: { type: 'number', min: 0.5, max: 16 }, min: 2, max: 2, default: [1.4, 3.2], unit: 'cells' },
    wormLength: { type: 'list', of: { type: 'integer', min: 4, max: 2000 }, min: 2, max: 2, default: [40, 160], unit: 'cells' },
    cavernRadius: { type: 'list', of: { type: 'number', min: 2, max: 64 }, min: 2, max: 2, default: [6, 14], unit: 'cells' },
    crust: { type: 'integer', min: 0, max: 32, default: 4, unit: 'cells', effect: 'noise caverns stay this far below the surface (worms may break through)' },
  },
  provides: { services: ['caves'], events: [] },
  reads: [],
};

export default {
  id: 'engine.generate.caves',
  card,
  validate(config, doc, ctx, inst) {
    const e = config.lavaLevel != null ? checkBlocks(doc, inst, [['with.lavaBlock', config.lavaBlock]]) : [];
    if (config.minY > config.maxY) e.push({ code: 'param_range', path: 'with.minY', message: 'minY must be at most maxY' });
    return e;
  },
  install(rt, raw, instance) {
    const config = withDefaults(card, raw), model = generatorModel(rt, instance);
    if (!model) return;
    let inside = () => false;
    model.contribute(`caves#${instance.key}`, STAGES.caves, (m, seed) => {
      if (m.kind !== 'voxel') { m.problem('space_unsupported', 'engine.generate.caves carves voxel spaces only', { generator: instance.use }); return; }
      const C = m.opts.cell || 1, H = Math.round((m.opts.height || 128 * C) / C), [x0, z0, x1, z1] = m.extent().map(v => v / C);
      const yLo = Math.max(1, config.minY), yHi = Math.min(H - 2, config.maxY), rng = new Rng(subSeed(seed, 'features'));
      const buckets = new Map(), feats = [];
      const add = f => {
        f.bx0 = f.x - f.rx; f.bx1 = f.x + f.rx; f.bz0 = f.z - f.rz; f.bz1 = f.z + f.rz; feats.push(f);
        for (let bx = Math.floor(f.bx0 / B); bx <= Math.floor(f.bx1 / B); bx++) for (let bz = Math.floor(f.bz0 / B); bz <= Math.floor(f.bz1 / B); bz++) { const k = bx * 65536 + bz; if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(f); }
      };
      const sphere = (x, y, z, r, kind) => add({ x, y, z, rx: r, ry: r, rz: r, kind });
      const surface = (x, z) => (m.surfaceY ? m.surfaceY(x * C, z * C) / C : H / 2);
      const worm = (x, y, z, yaw, pitch, len, r0, r1, kind, toSurface = false) => {
        for (let s = 0; s < len; s++) {
          const t = s / len, r = r0 + (r1 - r0) * Math.sin(Math.PI * t);
          sphere(x, y, z, Math.max(0.8, r), kind);
          x += Math.cos(yaw) * Math.cos(pitch); z += Math.sin(yaw) * Math.cos(pitch); y += Math.sin(pitch);
          if (toSurface) { if (y > surface(x, z) + 1) break; continue; }
          yaw += (rng.next() - 0.5) * 0.5; pitch = Math.max(-0.6, Math.min(0.6, pitch * 0.85 + (rng.next() - 0.5) * 0.3));
          if (y < yLo + r) pitch = Math.abs(pitch) + 0.05; if (y > yHi - r) pitch = -Math.abs(pitch) - 0.05;
        }
      };
      for (let i = 0; i < config.worms; i++) worm(rng.range(x0, x1), rng.range(yLo, yHi), rng.range(z0, z1), rng.range(0, Math.PI * 2), rng.range(-0.3, 0.3), rng.int(...config.wormLength), ...config.wormRadius, 'worm');
      for (let i = 0; i < config.caverns; i++) { const r = rng.range(...config.cavernRadius); add({ x: rng.range(x0, x1), y: rng.range(yLo + r * 0.5, yHi - r * 0.5), z: rng.range(z0, z1), rx: r * rng.range(1, 1.6), ry: r * 0.55, rz: r * rng.range(1, 1.6), kind: 'cavern' }); }
      const rooms = [];
      config.rooms.forEach((room, i) => {
        const zone = m.zone(room.zone);
        if (!zone) { m.problem('zone_missing', `cave room zone '${room.zone}' is not in space '${m.sid}'`, { generator: instance.use }); return; }
        const box = zoneBox(zone), at = room.at ? room.at.map(v => v / C) : [(box[0] + box[2]) / 2 / C, (yLo + yHi) / 2, (box[1] + box[3]) / 2 / C];
        const [w, h, d = room.size[0]] = room.size.map(v => v / C);
        add({ x: at[0], y: at[1], z: at[2], rx: w / 2, ry: h, rz: d / 2, floor: Math.floor(at[1]), kind: 'room' });
        const rec = { id: `${room.zone}_room${i + 1}`, zone: room.zone, at: [at[0] * C, Math.floor(at[1]) * C, at[2] * C], size: [w * C, h * C, d * C], entrance: null };
        if (room.connect) {
          // A straight ramp (rise 0.55 per cell) from the room edge to daylight.
          const yaw = rng.range(0, Math.PI * 2), sx = at[0] + Math.cos(yaw) * (w / 2 - 2), sz = at[2] + Math.sin(yaw) * (d / 2 - 2);
          const pitch = Math.atan(0.55), len = Math.ceil(((surface(sx, sz) - at[1]) / 0.55 + 24) * 1.2);
          worm(sx, at[1] + 1.6, sz, yaw, pitch, Math.max(8, len), 2.2, 2.2, 'tunnel', true);
          const last = feats[feats.length - 1]; rec.entrance = [last.x * C, surface(last.x, last.z) * C, last.z * C];
        }
        rooms.push(rec);
      });
      m.info.caves = { rooms }; m.info.summary = { ...(m.info.summary || {}), caveFeatures: feats.length };
      // Threshold so about density x 20% of the band is hollow: fbm3 (2 octaves) is close to normal with sigma 0.2.
      const pTail = Math.max(1e-4, config.density * 0.2), tq = Math.sqrt(-2 * Math.log(pTail)), zq = tq - (2.515517 + 0.802853 * tq + 0.010328 * tq * tq) / (1 + 1.432788 * tq + 0.189269 * tq * tq + 0.001308 * tq ** 3);
      const sN = subSeed(seed, 'cheese'), thr = 0.2 * zq, lava = config.lavaLevel;
      const inFeature = (f, x, y, z) => { if (f.floor !== undefined && y < f.floor) return false; const dx = (x - f.x) / f.rx, dy = (y - f.y) / f.ry, dz = (z - f.z) / f.rz; return dx * dx + dy * dy + dz * dz <= 1; };
      // Noise caverns: fbm sampled on a world-aligned 4-cell lattice, trilinearly interpolated (chunks reuse lattice rows).
      const L = 4, latN = (i, j, k) => fbm3(sN, (i * L) / 28, (j * L) / 18, (k * L) / 28, 2);
      const tri = (g, u, v, w) => ((g[0] * (1 - u) + g[1] * u) * (1 - w) + (g[2] * (1 - u) + g[3] * u) * w) * (1 - v) + ((g[4] * (1 - u) + g[5] * u) * (1 - w) + (g[6] * (1 - u) + g[7] * u) * w) * v;
      const cheeseAt = (x, y, z) => { const i = Math.floor(x / L), j = Math.floor(y / L), k = Math.floor(z / L); return tri([latN(i, j, k), latN(i + 1, j, k), latN(i, j, k + 1), latN(i + 1, j, k + 1), latN(i, j + 1, k), latN(i + 1, j + 1, k), latN(i, j + 1, k + 1), latN(i + 1, j + 1, k + 1)], (x - i * L) / L, (y - j * L) / L, (z - k * L) / L); };
      const hcell = (x, z) => m.at('height', (x + 0.5) * C, (z + 0.5) * C, 0) / C;
      inside = (x, y, z) => { for (const f of buckets.get(Math.floor(x / B) * 65536 + Math.floor(z / B)) || []) if (inFeature(f, x + 0.5, y + 0.5, z + 0.5)) return f.kind; return config.density > 0 && y >= yLo && y <= yHi && y < hcell(x, z) - config.crust && cheeseAt(x, y, z) > thr ? 'cheese' : false; };
      const known = new Set((rt.doc.content?.blocks || []).map(b => b.id));
      if (lava != null && known.size && !known.has(config.lavaBlock)) m.problem('block_unknown', `lava block '${config.lavaBlock}' is not in content.blocks`, { generator: instance.use });
      m.addLayer({
        id: 'caves', order: 60, y: [1, Math.max(yHi, ...feats.map(f => Math.ceil(f.y + f.ry)))],
        chunk(ctx) {
          const { sx, sy, sz, x0: cx0, y0, z0: cz0, cells } = ctx, air = 0, lavaI = lava != null ? ctx.idx(config.lavaBlock) : 0;
          const carve = (lx, ly, lz, kind) => {
            const y = y0 + ly; if (y < 1) return;
            const k = lx + sx * (lz + sz * ly), c = cells[k]; if (!c || ctx.isFluid(c)) return;
            const top = ctx.height(lx, lz);
            if (y >= top - 1 && m.at('water', (cx0 + lx + 0.5) * C, (cz0 + lz + 0.5) * C, null) > (top + 1) * C) return; // never drain the sea or a lake
            if (ly + 1 < sy && ctx.isFluid(cells[k + sx * sz])) return;
            cells[k] = lava != null && y < lava && kind !== 'room' && kind !== 'tunnel' ? lavaI : air;
          };
          // features
          const seen = new Set();
          for (let bx = Math.floor(cx0 / B); bx <= Math.floor((cx0 + sx - 1) / B); bx++) for (let bz = Math.floor(cz0 / B); bz <= Math.floor((cz0 + sz - 1) / B); bz++) for (const f of buckets.get(bx * 65536 + bz) || []) {
            if (seen.has(f)) continue; seen.add(f);
            const ya = Math.max(y0, Math.floor(f.y - f.ry), f.floor ?? -Infinity), yb = Math.min(y0 + sy - 1, Math.ceil(f.y + f.ry)); if (ya > yb) continue;
            const xa = Math.max(cx0, Math.floor(f.bx0)), xb = Math.min(cx0 + sx - 1, Math.ceil(f.bx1)), za = Math.max(cz0, Math.floor(f.bz0)), zb = Math.min(cz0 + sz - 1, Math.ceil(f.bz1));
            for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) for (let z = za; z <= zb; z++) if (inFeature(f, x + 0.5, y + 0.5, z + 0.5)) carve(x - cx0, y - y0, z - cz0, f.kind);
          }
          // noise caverns
          if (config.density > 0 && y0 <= yHi && y0 + sy > yLo) {
            const i0 = Math.floor(cx0 / L), j0 = Math.floor(y0 / L), k0 = Math.floor(cz0 / L);
            const nx = Math.floor((cx0 + sx - 1) / L) - i0 + 2, ny = Math.floor((y0 + sy - 1) / L) - j0 + 2, nz = Math.floor((cz0 + sz - 1) / L) - k0 + 2, lat = new Float32Array(nx * ny * nz);
            for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) lat[i + nx * (k + nz * j)] = latN(i0 + i, j0 + j, k0 + k);
            const g = new Float32Array(8), at = (a, b, c) => lat[a + nx * (c + nz * b)];
            for (let ly = Math.max(0, yLo - y0); ly < Math.min(sy, yHi - y0 + 1); ly++) {
              const y = y0 + ly, j = Math.floor(y / L) - j0, v = (y - (j + j0) * L) / L;
              for (let lz = 0; lz < sz; lz++) {
                const z = cz0 + lz, k = Math.floor(z / L) - k0, w = (z - (k + k0) * L) / L;
                for (let lx = 0; lx < sx; lx++) {
                  if (y >= ctx.height(lx, lz) - config.crust) continue;
                  const x = cx0 + lx, i = Math.floor(x / L) - i0, u = (x - (i + i0) * L) / L;
                  g[0] = at(i, j, k); g[1] = at(i + 1, j, k); g[2] = at(i, j, k + 1); g[3] = at(i + 1, j, k + 1); g[4] = at(i, j + 1, k); g[5] = at(i + 1, j + 1, k); g[6] = at(i, j + 1, k + 1); g[7] = at(i + 1, j + 1, k + 1);
                  if (tri(g, u, v, w) > thr) carve(lx, ly, lz, 'cheese');
                }
              }
            }
          }
        },
      });
    });
    sharedService(rt, 'caves', model.sid, {
      call: (x, y, z) => { model.ensure(); const C = model.opts.cell || 1; return inside(Math.floor(x / C), Math.floor(y / C), Math.floor(z / C)); },
      rooms: () => model.ensure().info.caves?.rooms || [],
    }, ['rooms']);
  },
};
