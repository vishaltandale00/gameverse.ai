// graphics.sprite.pixel — palette-indexed pixel sprites from part lists
// (content.models kind 'pixel'). Each animation frame is generated from the
// parts by name-aware procedural motion (legs stride, wings flap, held items
// swing, bodies breathe, death dissolves), shaded with a top-left light and
// outlined. Renderers draw these at the tileset's pixel density.
import { hubOf } from './flat-stage.js';
import { isHex } from './flat-util.js';
import { color, modelsData, docExample, HEX_COLOR } from './model-lib.js';

export function checkPixelModels(doc) {
  const errs = [];
  for (const [id, m] of Object.entries(doc.content?.models || {})) {
    if (m?.kind !== 'pixel') continue;
    const at = `content.models.${id}`;
    // The shapes (palette hexes, rect [x, y, w, h], anim frames) are the card's (content.models); what a pixel sprite
    // must have is these rules.
    if (!Array.isArray(m.size) || m.size.length !== 2 || !m.size.every(v => Number.isInteger(v) && v > 0 && v <= 256)) errs.push({ code: 'flat_pixel_size', path: `${at}.size`, message: 'size must be [w, h] integers 1..256' });
    const pal = m.palette && typeof m.palette === 'object' ? m.palette : {};
    (Array.isArray(m.parts) ? m.parts : []).forEach((p, i) => {
      if (!p || typeof p !== 'object') return;
      if (p.rect === undefined) errs.push({ code: 'flat_pixel_part', path: `${at}.parts[${i}].rect`, message: 'a pixel part needs rect [x, y, w, h]' });
      if (p.c !== undefined && !(p.c in pal) && !isHex(p.c)) errs.push({ code: 'flat_pixel_color', path: `${at}.parts[${i}].c`, message: `color '${p.c}' is not in the palette`, hint: `palette keys: ${Object.keys(pal).join(', ')}` });
    });
  }
  return errs;
}

export default {
  id: 'graphics.sprite.pixel',
  card: {
    intent: 'Pixel-art sprites built from content.models part lists (kind pixel): every named animation generated procedurally from the parts, shaded and outlined, with optional ground shadows.',
    views: ['side', 'td', 'iso', 'board'],
    params: {
      outline: { type: 'string', default: 'auto', pattern: `^(auto|none|${HEX_COLOR.slice(1, -1)})$`, effect: "outline color: a hex, 'auto' (a dark of the sprite's own color) or 'none'" },
      shadow: { type: 'boolean', default: true, effect: 'soft ground shadow under every entity' },
      shading: { type: 'boolean', default: true, effect: 'top-left light ramp on each part' },
      outlineWidth: { type: 'integer', default: 1, min: 1, max: 2, unit: 'px', effect: "outline rings around each sprite (an art look's outline width)" },
      bands: { type: 'integer', default: 3, min: 1, max: 4, effect: "shading tones per part (an art look's bands; 1 = flat)" },
      palette: { type: 'list', default: [], of: color(), effect: "a locked palette (an art look's colors) every sprite pixel snaps to" },
    },
    reads: ['content.models'],
    data: { 'content.models': modelsData(['kind', 'palette', 'parts', 'size', 'anims', 'pivot']) },
    rules: {
      flat_pixel_size: { fields: ['content.models.*.size', 'content.models.*.kind'], message: 'a pixel model has size [w, h]: integers 1..256',
        example: docExample({ models: { bat: { kind: 'pixel', size: [16], parts: [] } } }) },
      flat_pixel_part: { fields: ['content.models.*.parts[].rect', 'content.models.*.kind'], message: 'every part of a pixel model has rect [x, y, w, h]',
        example: docExample({ models: { bat: { kind: 'pixel', size: [16, 16], parts: [{ c: '#202030' }] } } }) },
      flat_pixel_color: { fields: ['content.models.*.parts[].c', 'content.models.*.palette'], message: "a pixel part's c is a key of the model's palette or a hex color",
        example: docExample({ models: { bat: { kind: 'pixel', size: [16, 16], palette: { k: '#202030' }, parts: [{ rect: [0, 0, 4, 4], c: 'wing' }] } } }) },
    },
  },
  validate(config, doc) {
    // outline and palette are declared (patterns): the models of kind pixel are checked here.
    return checkPixelModels(doc);
  },
  install(rt, config) {
    if (rt.headless || !rt.view) return;
    const H = hubOf(rt);
    H.cfg.sprite = { ...config, outline: config.outline === 'auto' ? undefined : config.outline === 'none' ? '' : config.outline };
    H.pixelCache?.clear();
  },
};
