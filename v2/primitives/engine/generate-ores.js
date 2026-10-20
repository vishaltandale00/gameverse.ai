// Ore veins for voxel worlds. Each 16x16 column region gets `perChunk`
// veins of each ore (fractional counts are probabilities) at a hashed
// position between minY and maxY; a vein is a compact random-walk blob of
// `size` cells that only replaces host blocks (stone by default). Veins are
// pure functions of (seed, region), so chunks place them lazily and veins
// that straddle a chunk border come out whole.
import { hash3, Rng } from './worlds3d-lib-noise.js';
import { STAGES, withDefaults, generatorModel } from './worlds3d-lib-world.js';

const R = 16; // vein region size (cells)
const card = {
  intent: 'Places ore veins (coal, iron, gold, crystals...) inside stone at chosen depths, optionally only under certain biomes, so mining has a depth/rarity curve.',
  views: ['any'],
  params: {
    veins: {
      type: 'list', min: 1, required: true, effect: 'ore table',
      of: { type: 'object', fields: {
        block: { type: 'ref', to: 'block', required: true }, minY: { type: 'integer', min: 0, max: 512, default: 1 }, maxY: { type: 'integer', min: 0, max: 512, default: 64 },
        size: { type: 'integer', min: 1, max: 64, default: 8, unit: 'cells' }, perChunk: { type: 'number', min: 0, max: 40, default: 2, effect: 'veins per 16x16 column' },
        biome: { type: 'ref', to: 'biome', effect: 'only under this biome' }, replace: { type: 'list', of: { type: 'string' }, default: ['stone'], effect: 'host blocks the vein may replace' },
      } },
    },
  },
  provides: { events: [] },
  reads: [],
};

export default {
  id: 'engine.generate.ores',
  card,
  validate(config) {
    return (config.veins || []).flatMap((v, i) => (v.minY > v.maxY ? [{ code: 'param_range', path: `with.veins[${i}].minY`, message: 'minY must be at most maxY' }] : []));
  },
  install(rt, raw, instance) {
    const config = withDefaults(card, raw), model = generatorModel(rt, instance);
    if (!model) return;
    model.contribute(`ores#${instance.key}`, STAGES.ores, (m, seed) => {
      if (m.kind !== 'voxel') { m.problem('space_unsupported', 'engine.generate.ores places veins in voxel spaces only', { generator: instance.use }); return; }
      const C = m.opts.cell || 1;
      /** Cells of every vein started in region (rx, rz): [{block, cells:[[x,y,z]...], replace:Set}]. Deterministic. */
      const regionVeins = (rx, rz) => {
        const out = [];
        config.veins.forEach((v, vi) => {
          const rng = new Rng(hash3(seed, rx, rz, vi + 1));
          const n = Math.floor(v.perChunk) + (rng.next() < v.perChunk % 1 ? 1 : 0);
          for (let k = 0; k < n; k++) {
            let x = rx * R + rng.int(0, R - 1), z = rz * R + rng.int(0, R - 1), y = rng.int(v.minY, v.maxY);
            if (v.biome && m.at('biome', (x + 0.5) * C, (z + 0.5) * C, null) !== v.biome) { rng.next(); continue; }
            const cells = [[x, y, z]], sx = x, sz = z, sy = y;
            for (let s = 1; s < v.size; s++) {
              const d = rng.int(0, 5), step = d & 1 ? -1 : 1;
              if (d < 2) x += step; else if (d < 4) y += step; else z += step;
              // keep blobs compact (and within one neighbouring region)
              x = Math.max(sx - 4, Math.min(sx + 4, x)); z = Math.max(sz - 4, Math.min(sz + 4, z)); y = Math.max(Math.max(v.minY, sy - 4), Math.min(Math.min(v.maxY, sy + 4), y));
              cells.push([x, y, z]);
            }
            out.push({ block: v.block, cells, replace: v.replace });
          }
        });
        return out;
      };
      m.info.summary = { ...(m.info.summary || {}), oreKinds: config.veins.length };
      m.addLayer({
        id: 'ores', order: 70, y: [Math.min(...config.veins.map(v => v.minY)), Math.max(...config.veins.map(v => v.maxY))],
        chunk(ctx) {
          const { sx, sy, sz, x0, y0, z0, cells } = ctx;
          for (let rx = Math.floor((x0 - 4) / R); rx <= Math.floor((x0 + sx + 3) / R); rx++) for (let rz = Math.floor((z0 - 4) / R); rz <= Math.floor((z0 + sz + 3) / R); rz++) {
            for (const vein of regionVeins(rx, rz)) {
              const ore = ctx.idx(vein.block), hosts = new Set(vein.replace.map(id => ctx.idx(id)));
              for (const [x, y, z] of vein.cells) {
                if (x < x0 || x >= x0 + sx || y < y0 || y >= y0 + sy || z < z0 || z >= z0 + sz) continue;
                const k = (x - x0) + sx * ((z - z0) + sz * (y - y0));
                if (hosts.has(cells[k])) cells[k] = ore;
              }
            }
          }
        },
      });
    });
  },
};
