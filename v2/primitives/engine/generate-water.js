// Sea, lakes and river water for 3D spaces. Defines the WorldModel `water`
// field (absolute water-surface height, or null where dry): the sea at
// `level` everywhere the ground is lower, plus inland lakes whose basins are
// carved into the terrain (with a low rim so they hold water). Rivers traced
// by engine.generate.terrain.noise contribute their own surface. On voxel the
// water layer fills empty cells under the surface with the water block.
// Provides the `waterDepthAt` service (depth, level, flow along rivers).
import { Rng, smoothstep, subSeed } from './worlds3d-lib-noise.js';
import { STAGES, withDefaults, generatorModel, sharedService, segDist2, zoneDistance, checkBlocks } from './worlds3d-lib-world.js';

const card = {
  intent: 'Water: sea up to a level, inland lakes carved into basins, and river water (with flow direction). Fills voxel worlds with water blocks; answers waterDepthAt for swimming, boats and navigation.',
  views: ['any'],
  spaces: ['engine.space.mesh3d', 'engine.space.voxel'],
  params: {
    level: { type: 'number', min: -1000, max: 10000, unit: 'm', effect: 'sea surface height (default: the terrain/space sea level)' },
    lakes: { type: 'integer', min: 0, max: 256, default: 0, effect: 'inland lakes placed in local low ground above sea level' },
    flow: { type: 'boolean', default: false, effect: 'rivers report a flow direction and speed (flowAt) for currents and boats' },
    sea: { type: 'boolean', default: true, effect: 'flood everything below level (false: only lakes and rivers hold water)' },
    lakeRadius: { type: 'list', of: { type: 'number', min: 2, max: 2000 }, min: 2, max: 2, default: [16, 60], unit: 'm', effect: 'lake radius range' },
    lakeDepth: { type: 'number', min: 0.5, max: 100, default: 5, unit: 'm', effect: 'depth at a lake centre' },
    flowSpeed: { type: 'number', min: 0, max: 20, default: 1.5, unit: 'm/s', effect: 'river current speed at the source (slows toward the mouth)' },
    block: { type: 'string', default: 'water', effect: 'voxel block used for water cells' },
  },
  provides: { content: ['water'], services: ['waterDepthAt'], events: [] },
  reads: [],
};

export default {
  id: 'engine.generate.water',
  card,
  validate(config, doc, ctx, inst) {
    return [...checkBlocks(doc, inst, [['with.block', config.block]]), ...(config.lakeRadius && config.lakeRadius[0] > config.lakeRadius[1] ? [{ code: 'param_range', path: 'with.lakeRadius', message: 'lakeRadius must be [min, max]' }] : [])];
  },
  install(rt, raw, instance) {
    const config = withDefaults(card, raw), model = generatorModel(rt, instance);
    if (!model) return;
    const ground = (x, z) => (model.surfaceY ? model.surfaceY(x, z) : model.at('height', x, z, 0));
    model.contribute(`water#${instance.key}`, STAGES.water, (m, seed) => {
      const level = config.level ?? m.info.sea ?? m.opts.seaLevel ?? 0;
      m.info.sea = level;
      if (config.sea) m.define('water', () => level);
      const [x0, z0, x1, z1] = m.extent(), rng = new Rng(subSeed(seed, 'lakes')), lakes = [];
      const h = (x, z) => m.at('height', x, z, level);
      for (let tries = 0; lakes.length < config.lakes && tries < config.lakes * 60; tries++) {
        const r = rng.range(config.lakeRadius[0], config.lakeRadius[1]), x = rng.range(x0 + r * 2, x1 - r * 2), z = rng.range(z0 + r * 2, z1 - r * 2);
        const c = h(x, z); if (c < level + 2) continue;
        // Prefer local low ground: the centre must sit below the mean of a ring around it.
        let ring = 0; for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; ring += h(x + Math.cos(a) * r * 1.6, z + Math.sin(a) * r * 1.6); }
        if (c > ring / 8 + 0.5) continue;
        if (lakes.some(l => Math.hypot(l.at[0] - x, l.at[2] - z) < (l.r + r) * 1.8)) continue;
        if (m.zones().some(zn => (zn.tags || []).includes('start') && zoneDistance(zn, x, undefined, z) < r * 2)) continue; // keep the start area dry
        lakes.push({ id: `lake${lakes.length + 1}`, at: [+x.toFixed(2), +(c - 0.5).toFixed(2), +z.toFixed(2)], r: +r.toFixed(2) });
      }
      if (lakes.length < config.lakes) m.problem('lakes_short', `placed ${lakes.length} of ${config.lakes} lakes`, { generator: instance.use });
      for (const l of lakes) {
        const [lx, surface, lz] = l.at, rim = l.r * 1.4, bounds = [lx - rim, lz - rim, lx + rim, lz + rim];
        m.modify('height', { bounds, priority: 5, apply(x, z, v) {
          const d = Math.hypot(x - lx, z - lz);
          if (d <= l.r) return Math.min(v, surface - config.lakeDepth * (1 - (d / l.r) ** 2) - 0.6);
          if (d <= rim) return Math.max(v, surface + 0.4 * (1 - smoothstep(l.r, rim, d)));
          return v;
        } });
        m.modify('water', { bounds, priority: 5, apply: (x, z, v) => (Math.hypot(x - lx, z - lz) <= l.r ? Math.max(v ?? -Infinity, surface) : v) });
      }
      m.info.lakes = lakes;
      m.info.summary = { ...(m.info.summary || {}), lakes: lakes.length, seaLevel: level };
      if (m.kind === 'voxel') {
        const known = new Set((rt.doc.content?.blocks || []).map(b => b.id));
        if (known.size && !known.has(config.block)) m.problem('block_unknown', `water block '${config.block}' is not in content.blocks`, { generator: instance.use });
        m.addLayer({
          id: 'water', order: 5,
          chunk(ctx) {
            const w = ctx.idx(config.block), { sx, sy, sz, x0: cx0, y0, z0: cz0, cell } = ctx;
            for (let lz = 0; lz < sz; lz++) for (let lx = 0; lx < sx; lx++) {
              const wl = m.at('water', (cx0 + lx + 0.5) * cell, (cz0 + lz + 0.5) * cell, null); if (wl == null) continue;
              const top = Math.ceil(wl / cell) - 1; if (top < y0) continue;
              for (let y = Math.max(y0, Math.floor(ctx.height(lx, lz)) + 1); y <= Math.min(top, y0 + sy - 1); y++) { const k = lx + sx * (lz + sz * (y - y0)); if (ctx.cells[k] === 0) ctx.cells[k] = w; }
            }
          },
        });
      }
    });
    const levelAt = (x, z) => model.ensure().at('water', x, z, null);
    const space = () => rt.spaces().includes(model.sid) ? rt.space(model.sid) : null;
    const depthAt = (x, z) => { const s = space(); if (s?.waterDepthAt) return s.waterDepthAt(x, z); const l = levelAt(x, z); return l == null ? 0 : Math.max(0, l - ground(x, z)); };
    /** River current at (x, z): [vx, vz] m/s along the nearest river segment, zero off rivers or when flow is off. */
    const flowAt = (x, z) => {
      if (!config.flow) return [0, 0];
      const rivers = model.ensure().info.rivers || [];
      for (const r of rivers) for (let k = 1; k < r.points.length; k++) {
        const a = r.points[k - 1], b = r.points[k], s = segDist2(x, z, a[0], a[2], b[0], b[2]);
        if (s.d2 <= 16 && levelAt(x, z) != null) { const dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz) || 1, v = config.flowSpeed * (1 - 0.5 * (k / r.points.length)); return [+(dx / l * v).toFixed(4), +(dz / l * v).toFixed(4)]; }
      }
      return [0, 0];
    };
    sharedService(rt, 'waterDepthAt', model.sid, { call: depthAt, levelAt, flowAt, lakes: () => model.ensure().info.lakes || [], rivers: () => model.ensure().info.rivers || [] }, ['levelAt', 'flowAt', 'lakes', 'rivers']);
  },
};
