// graphics.sprite.vector — code-drawn vector sprites: arcade presets (invader
// bitmaps, bugs, moths, saucers, fighters, orbs, drones, pinwheels), seeded
// rocks, puzzle pieces (gems in six silhouettes, blobs, viruses, capsules),
// maze ghosts and the chomper, ships, coins, stars, hearts, keys, bullets,
// crates, bombs and glossy blocks — or a model's own shapes list. Assigns
// presets to archetypes that have no model.
import { hubOf } from './flat-stage.js';
import { PRESETS } from './flat-vector.js';
import { isHex } from './flat-util.js';

export function checkVectorModels(doc) {
  const errs = [];
  for (const [id, m] of Object.entries(doc.content?.models || {})) {
    if (m?.kind !== 'vector') continue;
    if (m.preset && !PRESETS.includes(m.preset)) errs.push({ code: 'flat_vector_preset', path: `content.models.${id}.preset`, message: `unknown vector preset '${m.preset}'`, hint: PRESETS.join(', ') });
    if (m.color && !isHex(m.color)) errs.push({ code: 'flat_color', path: `content.models.${id}.color`, message: `'${m.color}' is not a hex color` });
    if (m.shapes !== undefined && !Array.isArray(m.shapes)) errs.push({ code: 'flat_vector_shapes', path: `content.models.${id}.shapes`, message: 'shapes must be a list' });
  }
  return errs;
}

export default {
  id: 'graphics.sprite.vector',
  card: {
    intent: 'Vector sprites drawn in code from presets (invaders, bugs, saucers, rocks, gems, blobs, viruses, capsules, ghosts, chomper, ships, coins...) or author shapes, animated (flapping, pulsing, spinning, glints) and optionally neon-glowing.',
    views: ['any'],
    params: {
      glow: { type: 'boolean', default: false, effect: 'additive neon glow behind every vector sprite (top-down arenas glow anyway)' },
      presets: { type: 'object', default: {}, open: true, effect: 'archetype id → preset for archetypes without a model' },
      colors: { type: 'object', default: {}, open: true, effect: 'archetype id → hex color for those presets' },
    },
    reads: ['content.models'],
  },
  validate(config, doc) {
    const errs = checkVectorModels(doc);
    const arch = new Set((doc.content?.archetypes || []).map(a => a.id));
    for (const [a, p] of Object.entries(config.presets)) {
      if (!PRESETS.includes(p)) errs.push({ code: 'flat_vector_preset', path: `presets.${a}`, message: `unknown vector preset '${p}'`, hint: PRESETS.join(', ') });
      if (arch.size && !arch.has(a)) errs.push({ code: 'ref_unknown', path: `presets.${a}`, message: `unknown archetype '${a}'` });
    }
    for (const [a, c] of Object.entries(config.colors)) if (!isHex(c)) errs.push({ code: 'flat_color', path: `colors.${a}`, message: `'${c}' is not a hex color` });
    return errs;
  },
  install(rt, config) {
    if (rt.headless || !rt.view) return;
    const H = hubOf(rt);
    H.cfg.vector = config;
    // Archetypes assigned a preset look like a vector model of it.
    if (Object.keys(config.presets).length) {
      H.looks?.clear();
      const models = rt.doc.content?.models || {};
      for (const a of rt.doc.content?.archetypes || []) {
        const p = config.presets[a.id];
        if (!p || (typeof a.components?.model === 'string' && models[a.components.model])) continue;
        H.vectorModels ??= {}; H.vectorModels[a.id] = { kind: 'vector', preset: p, color: config.colors[a.id] };
      }
    }
  },
};
