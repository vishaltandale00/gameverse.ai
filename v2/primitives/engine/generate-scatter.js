// Density-based props for 3D spaces: trees, rocks, flora, crops, debris,
// chests, campfires. Candidates come from a jittered grid (one cell per
// minSpacing), are thinned by density and a clumping noise field, and keep
// an exact minimum spacing by deterministic priority against neighbouring
// candidates. Filters: zones, biomes, slope, water, roads, lots and
// structures. Everything is a pure function of (seed, cell), so mesh3d
// object tiles and voxel chunks generate lazily and identically. Voxel props
// can be single cells, columns, trees (trunk + crown), bushes or boulders.
import { hash3, fbm2, subSeed } from './worlds3d-lib-noise.js';
import { STAGES, withDefaults, generatorModel, zoneHas, checkBlocks } from './worlds3d-lib-world.js';
import { roadNet, nearestRoad } from './worlds3d-lib-roads.js';

const card = {
  intent: 'Scatters props by density: forests, rocks, crops, bushes, debris or pickups such as chests and campfires, filtered by zone, biome, slope and water, clumped or evenly spaced, kept off roads and buildings.',
  views: ['any'],
  params: {
    props: {
      type: 'list', min: 1, required: true, effect: 'prop kinds',
      of: { type: 'object', fields: {
        model: { type: 'ref', to: 'model', effect: 'model id (mesh3d objects / renderer)' }, block: { type: 'ref', to: 'block', effect: 'voxel block' },
        per100m2: { type: 'number', min: 0, max: 50, default: 1, effect: 'props per 100 m²' },
        zones: { type: 'list', of: { type: 'ref', to: 'zone' }, effect: 'only inside these zones' }, biomes: { type: 'list', of: { type: 'ref', to: 'biome' }, effect: 'only in these biomes' },
        slopeMax: { type: 'number', min: 0, max: 90, default: 90, unit: 'deg' }, clump: { type: 'number', min: 0, max: 1, default: 0, effect: '0 even, 1 tight clumps' },
        minSpacing: { type: 'number', min: 0, max: 2000, default: 1, unit: 'm' }, scale: { type: 'list', of: { type: 'number', min: 0.05, max: 20 }, min: 2, max: 2, default: [1, 1] },
        shape: { type: 'string', options: ['cell', 'column', 'tree', 'bush', 'boulder'], default: 'cell', effect: 'voxel: how a block prop is built' },
        crown: { type: 'string', default: 'leaves', effect: 'voxel: crown block for trees and bushes' },
        collide: { type: 'boolean', default: false, effect: 'mesh3d: props are cylinder colliders' },
        water: { type: 'boolean', default: false, effect: 'allow props under water' },
      } },
    },
    avoid: { type: 'boolean', default: true, effect: 'keep props off roads, built lots and structures' },
    maxPerTile: { type: 'integer', min: 1, max: 1000000, default: 20000, effect: 'cap per generated tile (bounds lazy generation cost)' },
  },
  provides: { events: [] },
  reads: [],
};

export default {
  id: 'engine.generate.scatter',
  card,
  validate(config, doc, ctx, inst) {
    return (config.props || []).flatMap((p, i) => [
      ...(!p.model === !p.block ? [{ code: 'scatter_prop_kind', path: `with.props[${i}]`, message: 'each prop needs exactly one of model or block' }] : []),
      ...(p.block && ['tree', 'bush'].includes(p.shape) ? checkBlocks(doc, inst, [[`with.props[${i}].crown`, p.crown]]) : []),
    ]);
  },
  install(rt, raw, instance) {
    const config = withDefaults(card, raw), model = generatorModel(rt, instance);
    if (!model) return;
    model.contribute(`scatter#${instance.key}`, STAGES.scatter, (m, seed) => {
      const C = m.opts.cell || 1, voxel = m.kind === 'voxel';
      const ground = (x, z) => (m.surfaceY ? m.surfaceY(x, z) : m.at('height', x, z, 0));
      const height = (x, z) => m.at('height', x, z, 0);
      const specs = config.props.map((p, pi) => {
        const c0 = Math.sqrt(80 / Math.max(p.per100m2, 1e-6)), cellM = Math.max(p.minSpacing, Math.min(c0, 256), voxel ? C : 0.25), prob = Math.min(1, (p.per100m2 * cellM * cellM) / 100);
        if ((p.per100m2 * cellM * cellM) / 100 > 1.001) m.problem('scatter_density_capped', `prop ${p.model || p.block}: minSpacing ${p.minSpacing} m caps density below ${p.per100m2}/100 m²`, { generator: instance.use });
        if (voxel && p.model && !p.block) m.problem('scatter_model_on_voxel', `prop model '${p.model}' is listed as a placed object only on voxel spaces`, { generator: instance.use });
        return { ...p, pi, cellM, prob, seed: subSeed(seed, `prop${pi}`), zoneDefs: p.zones?.map(z => m.zone(z)).filter(Boolean) };
      });
      const net = m.data.roads ? roadNet(m) : null, structures = m.data.structures || [], lots = m.data.lots || [];
      /** Raw candidate in grid cell (gx, gz): {x, z, pri} or null — depends only on seed and cell. */
      const raw = (s, gx, gz) => {
        const h = hash3(s.seed, gx, gz, 1), pri = h / 4294967296;
        const x = (gx + hash3(s.seed, gx, gz, 2) / 4294967296) * s.cellM, z = (gz + hash3(s.seed, gx, gz, 3) / 4294967296) * s.cellM;
        let p = s.prob; if (s.clump > 0) { const n = 0.5 + 0.5 * fbm2(s.seed ^ 0x3c6e, x / 40, z / 40, 3); p *= (1 - s.clump) + s.clump * 3 * n * n; }
        return hash3(s.seed, gx, gz, 4) / 4294967296 < p ? { x, z, pri } : null;
      };
      const accepted = (s, gx, gz) => {
        const c = raw(s, gx, gz); if (!c) return null;
        if (s.minSpacing > 0) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
          if (!dx && !dz) continue; const o = raw(s, gx + dx, gz + dz);
          if (o && Math.hypot(o.x - c.x, o.z - c.z) < s.minSpacing && (o.pri < c.pri || (o.pri === c.pri && (dx < 0 || (dx === 0 && dz < 0))))) return null;
        }
        // placement filters
        if (s.zoneDefs && !s.zoneDefs.some(z => zoneHas(z, c.x, undefined, c.z))) return null;
        if (s.biomes && !s.biomes.includes(m.at('biome', c.x, c.z, null))) return null;
        if (!s.water) { const w = m.at('water', c.x, c.z, null); if (w != null && w > height(c.x, c.z) + 0.1) return null; }
        if (s.slopeMax < 90) { const e = Math.max(1, C), gx2 = height(c.x + e, c.z) - height(c.x - e, c.z), gz2 = height(c.x, c.z + e) - height(c.x, c.z - e); if ((Math.atan(Math.hypot(gx2, gz2) / (2 * e)) * 180) / Math.PI > s.slopeMax) return null; }
        if (config.avoid) {
          if (net?.edges.length) { const r = nearestRoad(net, c.x, c.z, 16); if (r) { const e = net.edges.find(x => x.id === r.edge) || (net.raw || []).find(x => x.id === r.edge); if (r.dist < (e?.width ?? 6) / 2 + (e?.sidewalk ?? 0) + 1) return null; } }
          for (const st of structures) if (Math.abs(st.at[0] - c.x) < st.size[0] / 2 + Math.max(st.size[0], st.size[1]) / 2 + 2 && Math.abs(st.at[2] - c.z) < st.size[1] / 2 + Math.max(st.size[0], st.size[1]) / 2 + 2 && Math.hypot(st.at[0] - c.x, st.at[2] - c.z) < Math.hypot(st.size[0], st.size[1]) / 2 + 1.5) return null;
          for (const l of lots) if (l.building && c.x >= l.rect[0] && c.x <= l.rect[2] && c.z >= l.rect[1] && c.z <= l.rect[3]) return null;
        }
        const u = hash3(s.seed, gx, gz, 5) / 4294967296;
        return { ...c, gx, gz, scale: +(s.scale[0] + (s.scale[1] - s.scale[0]) * u).toFixed(3), rot: +((hash3(s.seed, gx, gz, 6) / 4294967296) * Math.PI * 2).toFixed(4) };
      };
      const inRect = (s, x0, z0, x1, z1, pad = 0) => {
        const out = []; let n = 0;
        for (let gx = Math.floor((x0 - pad) / s.cellM); gx <= Math.floor((x1 + pad) / s.cellM); gx++) for (let gz = Math.floor((z0 - pad) / s.cellM); gz <= Math.floor((z1 + pad) / s.cellM); gz++) {
          const c = accepted(s, gx, gz); if (!c) continue;
          if (c.x < x0 - pad || c.x >= x1 + pad || c.z < z0 - pad || c.z >= z1 + pad) continue;
          out.push(c); if (++n >= config.maxPerTile) return out;
        }
        return out;
      };
      m.info.scatter = specs.map(s => ({ prop: s.model || s.block, cell: s.cellM, probability: s.prob }));
      if (!voxel) {
        m.addObjectLayer({
          id: `scatter#${instance.key}`,
          objects([x0, z0, x1, z1]) {
            const out = [];
            for (const s of specs) for (const c of inRect(s, x0, z0, x1, z1)) out.push({ id: `sc${s.pi}_${c.gx}_${c.gz}`, kind: 'prop', ...(s.model ? { model: s.model } : { block: s.block }), at: [+c.x.toFixed(3), +ground(c.x, c.z).toFixed(3), +c.z.toFixed(3)], rot: c.rot, scale: c.scale, shape: s.collide ? 'cylinder' : 'none', r: +(0.4 * c.scale).toFixed(3), h: +(2 * c.scale).toFixed(3) });
            return out;
          },
        });
        return;
      }
      const known = new Set((rt.doc.content?.blocks || []).map(b => b.id));
      for (const s of specs) if (s.block && (s.shape === 'tree' || s.shape === 'bush') && known.size && !known.has(s.crown)) m.problem('block_unknown', `crown block '${s.crown}' is not in content.blocks`, { generator: instance.use });
      m.addLayer({
        id: 'scatter', order: 80,
        chunk(ctx) {
          const { sx, sy, sz, x0, y0, z0, cells } = ctx, wx0 = x0 * C, wz0 = z0 * C, wx1 = (x0 + sx) * C, wz1 = (z0 + sz) * C;
          const put = (x, y, z, i) => { if (x < x0 || x >= x0 + sx || z < z0 || z >= z0 + sz || y < y0 || y >= y0 + sy) return; const k = (x - x0) + sx * ((z - z0) + sz * (y - y0)); if (cells[k] === 0) cells[k] = i; };
          for (const s of specs) {
            if (!s.block) continue;
            const blk = ctx.idx(s.block), crown = ctx.idx(s.crown), pad = s.shape === 'tree' ? 3 * C * Math.max(1, s.scale[1]) : s.shape === 'boulder' ? 3 * C * s.scale[1] : 1.5 * C;
            for (const c of inRect(s, wx0, wz0, wx1, wz1, pad)) {
              const cx = Math.floor(c.x / C), cz = Math.floor(c.z / C), base = Math.round(ground(c.x, c.z) / C);
              if (s.shape === 'cell') put(cx, base, cz, blk);
              else if (s.shape === 'column') { const n = Math.max(1, Math.round(c.scale)); for (let k = 0; k < n; k++) put(cx, base + k, cz, blk); }
              else if (s.shape === 'tree') {
                const H = Math.max(3, Math.round(5 * c.scale)), r = Math.max(1, Math.round(2 * c.scale)), top = base + H;
                for (let k = 0; k < H; k++) put(cx, base + k, cz, blk);
                for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (dx * dx + dy * dy * 1.5 + dz * dz <= r * r + 0.5 && (dx || dz || dy > 0)) put(cx + dx, top - 1 + dy, cz + dz, crown);
              } else if (s.shape === 'bush') { for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (Math.abs(dx) + Math.abs(dz) < 2) put(cx + dx, base, cz + dz, crown); put(cx, base + 1, cz, crown); }
              else { const r = Math.max(1, Math.round(1.5 * c.scale)); for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (dx * dx + dy * dy + dz * dz <= r * r) put(cx + dx, base - 1 + dy, cz + dz, blk); }
            }
          }
        },
      });
    });
  },
};
