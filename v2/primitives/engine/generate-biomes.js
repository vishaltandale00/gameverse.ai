// Climate-driven biomes for 3D spaces. Temperature and moisture are smooth
// noise fields (temperature falls with altitude); each biome claims a
// temperature x moisture box and the best match wins. Zones can pin a biome
// (`regions`), blending into the climate over `blend` metres with a dithered
// edge. Defines the WorldModel `biome` field (terrain surface blocks and
// mesh3d ground materials follow it), the `biomeAt` service and the `biome`
// predicate.
import { fbm2, rand2, clamp, subSeed } from './worlds3d-lib-noise.js';
import { STAGES, withDefaults, generatorModel, sharedService, zoneDistance, zoneArea } from './worlds3d-lib-world.js';

const range = { type: 'list', of: { type: 'number', min: 0, max: 1 }, min: 2, max: 2 };
const card = {
  intent: 'Assigns biomes (plains, forest, desert, snow, swamp...) from temperature and moisture, with zones pinned to chosen biomes. Biomes set surface blocks/materials and tree density, and are queryable with biomeAt and the biome predicate.',
  views: ['any'],
  params: {
    biomes: {
      type: 'list', min: 1, required: true, effect: 'biome table',
      of: { type: 'object', fields: {
        id: { type: 'string', required: true }, temp: { ...range, default: [0, 1] }, moist: { ...range, default: [0, 1] },
        surface: { type: 'string', effect: 'voxel surface block / mesh3d ground material' }, sub: { type: 'string', effect: 'voxel block under the surface' },
        shore: { type: 'string', effect: 'surface near sea level' }, underwater: { type: 'string', effect: 'surface below water' },
        trees: { type: 'number', min: 0, max: 1, default: 0, effect: 'tree density hint for scatter and renderers' }, color: { type: 'string', effect: 'map/minimap colour' },
        altitude: { type: 'list', of: { type: 'number' }, min: 2, max: 2, effect: 'optional [min, max] height (m) the biome is limited to' },
      } },
    },
    regions: {
      type: 'list', default: [], effect: 'zones pinned to a biome',
      of: { type: 'object', fields: { zone: { type: 'ref', to: 'zone', required: true }, biome: { type: 'ref', to: 'biome', required: true }, blend: { type: 'number', min: 0, max: 2000, default: 24, unit: 'm' } } },
    },
    blendWidth: { type: 'number', min: 1, max: 200, default: 24, unit: 'm', effect: 'width of the dithered transition between climate biomes' },
    climateScale: { type: 'number', min: 32, max: 20000, default: 600, unit: 'm', effect: 'size of climate cells (larger = broader biomes)' },
    lapse: { type: 'number', min: 0, max: 2, default: 0.35, effect: 'temperature drop per terrain amplitude of altitude above sea' },
  },
  provides: { services: ['biomeAt'], events: [] },
  defines: [{ kind: 'biome', in: 'biomes' }],
  reads: [],
};

export default {
  id: 'engine.generate.biomes',
  card,
  logic(logic) {
    logic.predicate('biome', {
      check(p, path, errors) { if (typeof p.biome !== 'string' && !Array.isArray(p.biome)) errors.push({ code: 'predicate_invalid', path: `${path}.biome`, message: 'biome must be a biome id or a list of ids' }); },
      refs: p => [].concat(p.biome || []).map(b => ['biome', b]),
      test(p, rt, c) {
        const e = rt.resolve(p.who, c); if (!e?.space || !Array.isArray(e.at) || !rt.hasService('biomeAt')) return false;
        const svc = rt.service('biomeAt').of(e.space); if (!svc) return false;
        const at = e.at.length === 2 ? [e.at[0], 0, e.at[1]] : e.at, b = svc.call(at[0], at[2]);
        return [].concat(p.biome).includes(b);
      },
    });
  },
  validate(config) {
    const errors = [], ids = new Set();
    config.biomes?.forEach((b, i) => {
      if (ids.has(b.id)) errors.push({ code: 'id_duplicate', path: `with.biomes[${i}].id`, message: `duplicate biome '${b.id}'` });
      ids.add(b.id);
      for (const k of ['temp', 'moist']) if (b[k] && b[k][0] > b[k][1]) errors.push({ code: 'biome_range_invalid', path: `with.biomes[${i}].${k}`, message: `${k} range must be [low, high]` });
    });
    return errors;
  },
  install(rt, raw, instance) {
    const config = withDefaults(card, raw), model = generatorModel(rt, instance);
    if (!model) return;
    const defs = Object.fromEntries(config.biomes.map(b => [b.id, b]));
    let fn = () => null, climateFn = () => ({ temp: 0.5, moist: 0.5 });
    model.contribute(`biomes#${instance.key}`, STAGES.biomes, (m, seed) => {
      const sT = subSeed(seed, 't'), sM = subSeed(seed, 'm'), sJ = subSeed(seed, 'j'), inv = 1 / config.climateScale;
      const sea = m.info.sea ?? 0, amp = m.info.terrain?.amplitude ?? 1;
      const climate = (x, z) => {
        // Jitter the sample point so climate borders are ragged over blendWidth.
        const jx = x + config.blendWidth * fbm2(sJ, x / 37, z / 37, 2), jz = z + config.blendWidth * fbm2(sJ ^ 0x9e37, x / 37, z / 37, 2);
        const h = m.has('height') ? m.at('height', x, z, sea) : sea;
        return { temp: clamp(0.5 + 0.75 * fbm2(sT, jx * inv, jz * inv, 3) - config.lapse * Math.max(0, (h - sea) / amp), 0, 1), moist: clamp(0.5 + 0.75 * fbm2(sM, jx * inv, jz * inv, 3), 0, 1), h };
      };
      const pick = (t, mo, h) => {
        let best = null, bestScore = Infinity;
        for (const b of config.biomes) {
          if (b.altitude && (h < b.altitude[0] || h > b.altitude[1])) continue;
          const dt = Math.max(b.temp[0] - t, 0, t - b.temp[1]), dm = Math.max(b.moist[0] - mo, 0, mo - b.moist[1]);
          const score = (dt + dm) * 10 + (b.temp[1] - b.temp[0]) * (b.moist[1] - b.moist[0]);
          if (score < bestScore) { bestScore = score; best = b.id; }
        }
        return best ?? config.biomes[0].id;
      };
      const regions = config.regions.map(r => ({ ...r, zoneDef: m.zone(r.zone) })).filter(r => r.zoneDef).sort((a, b) => zoneArea(a.zoneDef) - zoneArea(b.zoneDef));
      for (const r of config.regions) if (!m.zone(r.zone)) m.problem('zone_missing', `biome region zone '${r.zone}' is not in space '${m.sid}'`, { generator: instance.use });
      fn = (x, z) => {
        for (const r of regions) {
          const d = zoneDistance(r.zoneDef, x, undefined, z);
          if (d === 0) return r.biome;
          if (d < r.blend && rand2(sJ, Math.floor(x), Math.floor(z)) < 1 - d / r.blend) return r.biome;
        }
        const c = climate(x, z); return pick(c.temp, c.moist, c.h);
      };
      climateFn = (x, z) => { const c = climate(x, z); return { temp: +c.temp.toFixed(4), moist: +c.moist.toFixed(4) }; };
      m.define('biome', fn);
      m.info.biomeDefs = { ...(m.info.biomeDefs || {}), ...defs };
    });
    sharedService(rt, 'biomeAt', model.sid, {
      call: (x, z) => model.ensure().at('biome', x, z, null),
      def: id => defs[id] || null,
      climate: (x, z) => { model.ensure(); return climateFn(x, z); },
      list: () => config.biomes.map(b => b.id),
    }, ['def', 'climate', 'list']);
  },
};
