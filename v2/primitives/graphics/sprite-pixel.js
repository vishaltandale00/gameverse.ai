// graphics.sprite.pixel — palette-indexed pixel sprites from part lists
// (content.models kind 'pixel'). Each animation frame is generated from the
// parts by name-aware procedural motion (legs stride, wings flap, held items
// swing, bodies breathe, death dissolves), shaded with a top-left light and
// outlined. Renderers draw these at the tileset's pixel density.
import { hubOf } from './flat-stage.js';
import { isHex } from './flat-util.js';

export function checkPixelModels(doc) {
  const errs = [];
  for (const [id, m] of Object.entries(doc.content?.models || {})) {
    if (m?.kind !== 'pixel') continue;
    const at = `content.models.${id}`;
    if (!Array.isArray(m.size) || m.size.length !== 2 || !m.size.every(v => Number.isInteger(v) && v > 0 && v <= 256)) errs.push({ code: 'flat_pixel_size', path: `${at}.size`, message: 'size must be [w, h] integers 1..256' });
    const pal = m.palette || {};
    for (const [k, c] of Object.entries(pal)) if (!isHex(c)) errs.push({ code: 'flat_color', path: `${at}.palette.${k}`, message: `'${c}' is not a hex color` });
    (m.parts || []).forEach((p, i) => {
      if (!Array.isArray(p.rect) || p.rect.length !== 4 || !p.rect.every(Number.isFinite)) errs.push({ code: 'flat_pixel_part', path: `${at}.parts[${i}].rect`, message: 'rect must be [x, y, w, h]' });
      if (p.c !== undefined && !(p.c in pal) && !isHex(p.c)) errs.push({ code: 'flat_pixel_color', path: `${at}.parts[${i}].c`, message: `color '${p.c}' is not in the palette`, hint: `palette keys: ${Object.keys(pal).join(', ')}` });
    });
    for (const [a, info] of Object.entries(m.anims || {})) if (!(Number.isInteger(info?.frames) && info.frames > 0)) errs.push({ code: 'flat_pixel_anim', path: `${at}.anims.${a}.frames`, message: 'frames must be a positive integer' });
  }
  return errs;
}

export default {
  id: 'graphics.sprite.pixel',
  card: {
    intent: 'Pixel-art sprites built from content.models part lists (kind pixel): every named animation generated procedurally from the parts, shaded and outlined, with optional ground shadows.',
    views: ['side', 'td', 'iso', 'board'],
    params: {
      outline: { type: 'string', default: 'auto', effect: "outline color: a hex, 'auto' (a dark of the sprite's own color) or 'none'" },
      shadow: { type: 'boolean', default: true, effect: 'soft ground shadow under every entity' },
      shading: { type: 'boolean', default: true, effect: 'top-left light ramp on each part' },
      outlineWidth: { type: 'integer', default: 1, min: 1, max: 2, unit: 'px', effect: "outline rings around each sprite (an art look's outline width)" },
      bands: { type: 'integer', default: 3, min: 1, max: 4, effect: "shading tones per part (an art look's bands; 1 = flat)" },
      palette: { type: 'list', default: [], of: { type: 'string' }, effect: "a locked palette (an art look's colors) every sprite pixel snaps to" },
    },
    reads: ['content.models'],
  },
  validate(config, doc) {
    const errs = [];
    if (!['auto', 'none'].includes(config.outline) && !isHex(config.outline)) errs.push({ code: 'flat_color', path: 'outline', message: `'${config.outline}' is not a hex color, 'auto' or 'none'` });
    (config.palette || []).forEach((c, i) => { if (!isHex(c)) errs.push({ code: 'flat_color', path: `palette[${i}]`, message: `'${c}' is not a hex color` }); });
    return errs.concat(checkPixelModels(doc));
  },
  install(rt, config) {
    if (rt.headless || !rt.view) return;
    const H = hubOf(rt);
    H.cfg.sprite = { ...config, outline: config.outline === 'auto' ? undefined : config.outline === 'none' ? '' : config.outline };
    H.pixelCache?.clear();
  },
};
