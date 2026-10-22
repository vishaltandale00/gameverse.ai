// graphics.sprite.vector — code-drawn vector sprites: arcade presets (invader
// bitmaps, bugs, moths, saucers, fighters, orbs, drones, pinwheels), seeded
// rocks, puzzle pieces (gems in six silhouettes, blobs, viruses, capsules),
// maze ghosts and the chomper, ships, coins, stars, hearts, keys, bullets,
// crates, bombs and glossy blocks — or a model's own shapes list. Assigns
// presets to archetypes that have no model.
import { hubOf } from './flat-stage.js';
import { PRESETS } from './flat-vector.js';
import { color, modelsData, docExample } from './model-lib.js';

export function checkVectorModels(doc) {
  const errs = [];
  for (const [id, m] of Object.entries(doc.content?.models || {})) {
    // color and shapes are declared on content.models; a vector model's preset is this rule (other kinds' presets differ).
    if (m?.kind !== 'vector') continue;
    if (m.preset && !PRESETS.includes(m.preset)) errs.push({ code: 'flat_vector_preset', path: `content.models.${id}.preset`, message: `unknown vector preset '${m.preset}'`, hint: PRESETS.join(', ') });
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
      presets: { type: 'object', default: {}, values: { type: 'string', options: PRESETS }, effect: 'archetype id → preset for archetypes without a model' },
      colors: { type: 'object', default: {}, values: color(), effect: 'archetype id → hex color for those presets' },
    },
    reads: ['content.models'],
    data: { 'content.models': modelsData(['kind', 'preset', 'color', 'shapes', 'palette']) },
    rules: {
      flat_vector_preset: { fields: ['content.models.*.preset', 'content.models.*.kind'], message: `a vector model's preset is one of ${PRESETS.join(', ')}`,
        example: docExample({ models: { blip: { kind: 'vector', preset: 'dragon' } } }) },
      flat_vector_archetype: { fields: ['presets'], message: 'each presets key is an archetype id of the document',
        example: { doc: { graphics: [{ use: 'graphics.sprite.vector', with: { presets: { no_such_archetype: 'blob' } } }] } } },
    },
  },
  validate(config, doc) {
    const errs = checkVectorModels(doc);
    const arch = new Set((doc.content?.archetypes || []).map(a => a.id));
    // The presets' values and the colors are declared; that a key names an archetype is this rule.
    for (const a of Object.keys(config.presets || {})) if (arch.size && !arch.has(a)) errs.push({ code: 'flat_vector_archetype', path: `presets.${a}`, message: `unknown archetype '${a}'` });
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
