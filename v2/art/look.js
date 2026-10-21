// Art looks: a game's visual style as declared, checkable data. The art
// direction carries one `look` (a preset plus explicit overrides) and every
// painter follows it: one locked palette, one outline width, one pixel scale,
// banded shading, hazed depth layers, and a player that separates from the
// background by value first, then saturation, then rim light or glow.
//
// Everything here is pure and deterministic. Painters draw with paintOptions(look, class);
// styleAssets() then locks the painted SVGs to the palette and applies separation;
// verify/art-quality.js measures the result.
import { hex, hexToRgb, rgbToHsl, toLab, fromLab, mixLab } from './color.js';

export const LOOK_SCHEMA_ID = 'gameverse.v2.art-look/0.1';
export const LOOK_PRESET_NAMES = ['8-bit', '16-bit', 'coarse-pixel', 'monochrome-pixel', 'layered-silhouette', 'minimal-geometric', 'neon-vector', 'bold-comic', 'rubber-hose', 'black-figure'];
export const OUTLINE_MODES = ['none', 'dark-hue', 'black', 'colored'];
export const DITHERS = ['none', 'bayer4', 'bayer8'];
export const GLOWS = ['none', 'player', 'interactables'];
export const TEXTURES = ['none', 'grain', 'paper', 'halftone', 'scanlines', 'crackle'];
export const PLAYER_SHAPES = ['any', 'round', 'angular', 'tall', 'wide'];
export const UI_FRAMES = ['none', 'pixel-box', 'rounded', 'bold-panel', 'neon-line', 'ornament'];
export const UI_TEXTS = ['pixel', 'rounded', 'bold', 'serif', 'hand'];
export const FX_KINDS = ['pixel-burst', 'sparkle', 'ink-splash', 'neon-trail', 'smear', 'minimal'];
export const FORBIDS = ['gradients', 'translucency', 'pure-black', 'pure-white', 'glow'];
export const ROLES = ['player', 'enemy', 'pickup', 'hazard', 'goal', 'ground', 'sky'];

/** Reference pixels per tile. pixel.scale is reference pixels per art pixel, so a pixel look has 32 / scale art pixels per tile. */
export const REF_TILE_PX = 32;
/** Nominal display size in tiles of each asset class, as the 2D renderers draw them (engine/render2d.js draws sprites at
 * 1.35 tiles and goals 1.5 times that; the tileset atlas is 2.25 tiles of 32-unit cells with padding; a background spans
 * about 24 tiles of view). Pixel density and outline width are measured against these. */
export const DISPLAY_TILES = { character: 1.35, prop: 1.35, goal: 2.025, tileset: 2.25, background: 24, title: 24 };
const VIEWBOX = { character: 100, prop: 64, goal: 64, tileset: 72, background: 384, title: 384 };
const VECTOR_SIZE = { character: 256, prop: 128, goal: 128, tileset: 288, background: 1536, title: 1536 };

// Hardware-style palettes are facts about old machines; the rest of each preset is our own reading of the style.
const CONSOLE_8BIT = ['#000000', '#7c7c7c', '#bcbcbc', '#fcfcfc', '#0000fc', '#0078f8', '#3cbcfc', '#a4e4fc', '#881400', '#a81000', '#f83800', '#f87858', '#f0d0b0', '#005800', '#00a800', '#58d854', '#b8f818', '#503000', '#ac7c00', '#f8b800', '#fce0a8', '#6844fc', '#d800cc', '#f878f8'];
const HANDHELD_GREEN = ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'];
const NEON = ['#07060f', '#141432', '#2a1f5c', '#00f0ff', '#ff2bd6', '#fff200', '#39ff88', '#f4f4ff'];
const SEPIA_TOON = ['#1a1410', '#3b3027', '#6e5f4e', '#a89a82', '#e8dcc0', '#f7f0dc', '#c0392b'];
const POTTERY = ['#141010', '#5a1e14', '#c0632b', '#e08a4a', '#ecd9b0'];

const nullRoles = { player: null, enemy: null, pickup: null, hazard: null, goal: null, ground: null, sky: null };
const base = {
  palette: { size: 16, colors: null, roles: nullRoles },
  outline: { mode: 'dark-hue', width: 1 },
  shading: { bands: 3, hueShift: 0.5, dither: 'none' },
  pixel: null,
  separation: { playerValueGap: 0.2, rim: 0, glow: 'none', bgContrast: 0.6 },
  depth: { layers: 4, parallax: null, haze: 0.5, fog: 0 },
  texture: { kind: 'none', amount: 0 },
  silhouette: { playerShape: 'any', minDetail: 1 },
  ui: { frame: 'rounded', text: 'rounded' },
  fx: { kind: 'sparkle', reducedFlash: true },
  forbid: [],
};
const preset = (label, o) => ({ label, ...base, ...o, palette: { ...base.palette, ...o.palette, roles: { ...nullRoles, ...o.palette?.roles } } });

/** The shipped styles. A preset sets every field; explicit fields in a direction's look override it. */
export const LOOK_PRESETS = {
  '8-bit': preset('8-bit console pixel art: few flat colors, black outlines, chunky sprites', {
    palette: { size: 24, colors: CONSOLE_8BIT }, outline: { mode: 'black', width: 1 }, shading: { bands: 2, hueShift: 0.3, dither: 'none' }, pixel: { scale: 2 },
    separation: { playerValueGap: 0.25, rim: 0, glow: 'none', bgContrast: 0.7 }, depth: { layers: 3, parallax: null, haze: 0.2, fog: 0 },
    silhouette: { playerShape: 'round', minDetail: 1 }, ui: { frame: 'pixel-box', text: 'pixel' }, fx: { kind: 'pixel-burst', reducedFlash: true }, forbid: ['gradients', 'translucency'] }),
  '16-bit': preset('16-bit pixel art: rich ramps with warm lights and cool shadows, dark hued outlines', {
    palette: { size: 32 }, outline: { mode: 'dark-hue', width: 1 }, shading: { bands: 3, hueShift: 0.6, dither: 'none' }, pixel: { scale: 1 },
    separation: { playerValueGap: 0.2, rim: 0.4, glow: 'none', bgContrast: 0.6 }, depth: { layers: 5, parallax: null, haze: 0.5, fog: 0 },
    ui: { frame: 'pixel-box', text: 'pixel' }, fx: { kind: 'pixel-burst', reducedFlash: true }, forbid: ['gradients', 'translucency'] }),
  'coarse-pixel': preset('coarse low-resolution pixel art: big pixels, two-tone shading, bold shapes', {
    palette: { size: 16 }, outline: { mode: 'dark-hue', width: 1 }, shading: { bands: 2, hueShift: 0.4, dither: 'none' }, pixel: { scale: 3 },
    separation: { playerValueGap: 0.3, rim: 0, glow: 'none', bgContrast: 0.55 }, depth: { layers: 3, parallax: null, haze: 0.4, fog: 0 },
    silhouette: { playerShape: 'wide', minDetail: 1 }, ui: { frame: 'pixel-box', text: 'pixel' }, fx: { kind: 'pixel-burst', reducedFlash: true }, forbid: ['gradients', 'translucency'] }),
  'monochrome-pixel': preset('four-shade monochrome handheld pixel art with ordered dithering', {
    palette: { size: 4, colors: HANDHELD_GREEN }, outline: { mode: 'dark-hue', width: 1 }, shading: { bands: 2, hueShift: 0, dither: 'bayer4' }, pixel: { scale: 2 },
    separation: { playerValueGap: 0.35, rim: 0, glow: 'none', bgContrast: 0.45 }, depth: { layers: 3, parallax: null, haze: 0.6, fog: 0 },
    ui: { frame: 'pixel-box', text: 'pixel' }, fx: { kind: 'pixel-burst', reducedFlash: true }, forbid: ['gradients', 'translucency'] }),
  'layered-silhouette': preset('layered silhouettes: flat shapes fading into haze with distance, a dark readable hero', {
    palette: { size: 10, roles: { player: '#1c1a26', enemy: '#2e2433' } }, outline: { mode: 'none', width: 0 }, shading: { bands: 1, hueShift: 0.2, dither: 'none' },
    separation: { playerValueGap: 0.45, rim: 0.6, glow: 'none', bgContrast: 0.35 }, depth: { layers: 6, parallax: null, haze: 0.85, fog: 0.4 },
    texture: { kind: 'grain', amount: 0.15 }, silhouette: { playerShape: 'tall', minDetail: 2 }, ui: { frame: 'none', text: 'serif' }, fx: { kind: 'minimal', reducedFlash: true }, forbid: ['pure-white'] }),
  'minimal-geometric': preset('minimal flat geometry: few colors, no outlines, no gradients', {
    palette: { size: 8 }, outline: { mode: 'none', width: 0 }, shading: { bands: 1, hueShift: 0, dither: 'none' },
    separation: { playerValueGap: 0.3, rim: 0, glow: 'none', bgContrast: 0.5 }, depth: { layers: 3, parallax: null, haze: 0.4, fog: 0 },
    silhouette: { playerShape: 'round', minDetail: 2 }, ui: { frame: 'rounded', text: 'rounded' }, fx: { kind: 'minimal', reducedFlash: true }, forbid: ['gradients', 'translucency'] }),
  'neon-vector': preset('neon vector lines on a dark field: glowing interactables, bright colored outlines', {
    palette: { size: 8, colors: NEON, roles: { player: '#00f0ff', enemy: '#ff2bd6', pickup: '#fff200', hazard: '#ff2bd6', goal: '#39ff88', ground: '#2a1f5c', sky: '#07060f' } },
    outline: { mode: 'colored', width: 1.5 }, shading: { bands: 2, hueShift: 0.2, dither: 'none' },
    separation: { playerValueGap: 0.4, rim: 0.5, glow: 'interactables', bgContrast: 0.4 }, depth: { layers: 4, parallax: null, haze: 0.5, fog: 0.2 },
    texture: { kind: 'scanlines', amount: 0.3 }, silhouette: { playerShape: 'angular', minDetail: 1 }, ui: { frame: 'neon-line', text: 'bold' }, fx: { kind: 'neon-trail', reducedFlash: true }, forbid: ['pure-white'] }),
  'bold-comic': preset('bold comic cartoon: thick black ink lines, two-tone cel shading, punchy colors', {
    palette: { size: 16 }, outline: { mode: 'black', width: 2 }, shading: { bands: 2, hueShift: 0.4, dither: 'none' },
    separation: { playerValueGap: 0.25, rim: 0, glow: 'none', bgContrast: 0.6 }, depth: { layers: 4, parallax: null, haze: 0.5, fog: 0 },
    texture: { kind: 'halftone', amount: 0.3 }, ui: { frame: 'bold-panel', text: 'bold' }, fx: { kind: 'ink-splash', reducedFlash: true } }),
  'rubber-hose': preset('1930s rubber-hose cartoon: sepia and ink, round bouncy shapes, one red accent', {
    palette: { size: 7, colors: SEPIA_TOON, roles: { player: '#1a1410', enemy: '#3b3027', pickup: '#c0392b', hazard: '#3b3027', goal: '#c0392b', ground: '#6e5f4e', sky: '#e8dcc0' } },
    outline: { mode: 'black', width: 2 }, shading: { bands: 1, hueShift: 0, dither: 'none' },
    separation: { playerValueGap: 0.35, rim: 0, glow: 'none', bgContrast: 0.5 }, depth: { layers: 3, parallax: null, haze: 0.3, fog: 0 },
    texture: { kind: 'grain', amount: 0.35 }, silhouette: { playerShape: 'round', minDetail: 2 }, ui: { frame: 'ornament', text: 'hand' }, fx: { kind: 'smear', reducedFlash: true }, forbid: ['gradients', 'translucency'] }),
  'black-figure': preset('black-figure pottery: dark figures on terracotta with incised clay-colored lines', {
    palette: { size: 5, colors: POTTERY, roles: { player: '#141010', enemy: '#5a1e14', pickup: '#ecd9b0', hazard: '#5a1e14', goal: '#ecd9b0', ground: '#141010', sky: '#c0632b' } },
    outline: { mode: 'colored', width: 1 }, shading: { bands: 1, hueShift: 0, dither: 'none' },
    separation: { playerValueGap: 0.4, rim: 0, glow: 'none', bgContrast: 0.3 }, depth: { layers: 2, parallax: null, haze: 0, fog: 0 },
    texture: { kind: 'crackle', amount: 0.25 }, silhouette: { playerShape: 'angular', minDetail: 2 }, ui: { frame: 'ornament', text: 'serif' }, fx: { kind: 'minimal', reducedFlash: true }, forbid: ['gradients', 'translucency', 'pure-white'] }),
};

// Words in an idea or theme that point at a preset, checked in order (the first match wins).
const PRESET_WORDS = [
  ['monochrome-pixel', /game ?boy|monochrome|green ?screen|four[- ]shade|handheld|1-bit|one[- ]bit/],
  ['8-bit', /8[- ]?bit|nes\b|famicom|chiptune|arcade classic|retro console/],
  ['coarse-pixel', /lo-?fi|low[- ]?res|chunky pixel|coarse|big pixels?|blocky/],
  ['16-bit', /16[- ]?bit|snes|genesis|mega drive|32[- ]?bit|pixel/],
  ['neon-vector', /neon|synth|cyber|vector ?(graphics|display)|tron|laser|retro ?wave|glow/],
  ['black-figure', /greek|pottery|vase|amphora|myth|olymp|spartan|hoplite|ancient/],
  ['rubber-hose', /rubber[- ]?hose|1930|vintage cartoon|old cartoon|cuphead|steamboat|jazz age|sepia/],
  ['layered-silhouette', /silhouette|shadow|limbo|noir|misty|melanchol|eerie|lonely|dusk/],
  ['minimal-geometric', /minimal|geometric|abstract|shapes|flat design|zen|puzzle/],
  ['bold-comic', /comic|cartoon|cel[- ]?shad|punk|superhero|graffiti|bold/],
];
/** The preset an idea and theme suggest, or null when none of their words point at one. */
export function presetFor(text) {
  const t = String(text || '').toLowerCase();
  return PRESET_WORDS.find(([, re]) => re.test(t))?.[0] ?? null;
}

// ---------- normalization ----------
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const pick = (v, list, d) => (list.includes(v) ? v : d);
const num = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const int = (v, lo, hi, d) => Math.round(num(v, lo, hi, d));
const round2 = v => Math.round(v * 100) / 100;
/** Explicit fields of a look section (null and undefined mean "keep the preset's"). */
const given = v => (isObj(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null && x !== undefined)) : {});

/**
 * A complete look: the named preset (or the one `style` implies) with every explicit field laid over it, each
 * clamped to its range or enum. `pixel: false` turns a pixel preset into vector; null keeps the preset's.
 * Resolving a resolved look returns it unchanged.
 * Palette colors given here (4..32 hex) lock the palette; without them it is derived from the painted art to `size`.
 */
export function resolveLook(input, { style } = {}) {
  const i = isObj(input) ? input : {};
  const name = pick(i.preset, LOOK_PRESET_NAMES, style === 'pixel' ? '16-bit' : 'bold-comic');
  const p = LOOK_PRESETS[name];
  const pal = given(i.palette), roles = { ...p.palette.roles, ...given(pal.roles) };
  const ownColors = Array.isArray(pal.colors) ? [...new Set(pal.colors.map(c => hex(c, null)).filter(Boolean))].slice(0, 32) : [];
  const colors = ownColors.length >= 4 ? ownColors : p.palette.colors;
  const forbid = Array.isArray(i.forbid) ? [...new Set(i.forbid.filter(x => FORBIDS.includes(x)))] : p.forbid;
  const o = { ...p.outline, ...given(i.outline) }, sh = { ...p.shading, ...given(i.shading) }, sep = { ...p.separation, ...given(i.separation) };
  const dp = { ...p.depth, ...given(i.depth) }, tx = { ...p.texture, ...given(i.texture) }, si = { ...p.silhouette, ...given(i.silhouette) };
  const ui = { ...p.ui, ...given(i.ui) }, fx = { ...p.fx, ...given(i.fx) };
  // In a resolved look (one carrying the schema id) a null pixel means vector, so resolving again changes nothing.
  const px = i.pixel === false || (i.pixel === null && i.schema === LOOK_SCHEMA_ID) ? null : isObj(i.pixel) ? { ...(p.pixel || { scale: 2 }), ...given(i.pixel) } : p.pixel;
  const layers = int(dp.layers, 2, 6, 4);
  const parallax = Array.from({ length: layers }, (_, k) => round2(num(Array.isArray(dp.parallax) ? dp.parallax[k] : undefined, 0, 1, k / (layers - 1) * 0.8)));
  const outlineMode = pick(o.mode, OUTLINE_MODES, 'dark-hue');
  let palette = colors ? sanitizePalette(colors, forbid) : null;
  return {
    schema: LOOK_SCHEMA_ID, preset: name, label: p.label,
    palette: {
      size: palette ? palette.length : int(pal.size, 4, 32, p.palette.size), colors: palette,
      roles: Object.fromEntries(ROLES.map(r => [r, hex(roles[r], null)])),
    },
    outline: { mode: outlineMode, width: outlineMode === 'none' ? 0 : round2(num(o.width, 0, 4, 1)) },
    shading: { bands: int(sh.bands, 1, 4, 3), hueShift: round2(num(sh.hueShift, 0, 1, 0.5)), dither: pick(sh.dither, DITHERS, 'none') },
    pixel: px ? { scale: int(px.scale, 1, 8, 2) } : null,
    separation: { playerValueGap: round2(num(sep.playerValueGap, 0, 1, 0.2)), rim: round2(num(sep.rim, 0, 1, 0)), glow: forbid.includes('glow') ? 'none' : pick(sep.glow, GLOWS, 'none'), bgContrast: round2(num(sep.bgContrast, 0, 1, 0.6)) },
    depth: { layers, parallax, haze: round2(num(dp.haze, 0, 1, 0.5)), fog: forbid.includes('translucency') ? 0 : round2(num(dp.fog, 0, 1, 0)) },
    texture: { kind: pick(tx.kind, TEXTURES, 'none'), amount: round2(num(tx.amount, 0, 1, 0)) },
    silhouette: { playerShape: pick(si.playerShape, PLAYER_SHAPES, 'any'), minDetail: int(si.minDetail, 1, 8, 1) },
    ui: { frame: pick(ui.frame, UI_FRAMES, 'rounded'), text: pick(ui.text, UI_TEXTS, 'rounded') },
    fx: { kind: pick(fx.kind, FX_KINDS, 'sparkle'), reducedFlash: fx.reducedFlash !== false },
    forbid,
  };
}

/** A palette with forbidden extremes nudged off pure black and pure white. */
function sanitizePalette(colors, forbid) {
  const out = colors.map(c => (forbid.includes('pure-black') && c === '#000000' ? '#141018' : forbid.includes('pure-white') && c === '#ffffff' ? '#f4f0e6' : c));
  return [...new Set(out)];
}

// ---------- model-facing schema (strict structured output: every key present, null keeps the preset's value) ----------
const color = { type: 'string', description: 'hex color like #3a7bd5' };
const en = list => ({ type: 'string', enum: list });
const obj = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const orNull = schema => ({ anyOf: [schema, { type: 'null' }] });
const numberIn = (lo, hi, what) => ({ type: 'number', description: `${what} (${lo} to ${hi})` });
export const LOOK_SCHEMA = obj({
  preset: { ...en(LOOK_PRESET_NAMES), description: 'The visual style. Every other field may be null to keep this preset\'s value.' },
  palette: orNull(obj({ colors: { type: 'array', items: color, description: '4 to 32 colors that are the whole palette, or empty to derive one from the art' }, roles: orNull(obj(Object.fromEntries(ROLES.map(r => [r, orNull(color)])))) })),
  outline: orNull(obj({ mode: en(OUTLINE_MODES), width: numberIn(0, 4, 'outline width in art pixels') })),
  shading: orNull(obj({ bands: numberIn(1, 4, 'hard shading bands'), hueShift: numberIn(0, 1, 'warm light and cool shadow hue shift'), dither: en(DITHERS) })),
  pixel: orNull(obj({ scale: numberIn(1, 8, 'screen pixels per art pixel at a 32-pixel tile') })),
  separation: orNull(obj({ playerValueGap: numberIn(0, 1, 'lightness gap between player and background'), rim: numberIn(0, 1, 'rim light on the player'), glow: en(GLOWS), bgContrast: numberIn(0, 1, 'contrast kept in the background') })),
  depth: orNull(obj({ layers: numberIn(2, 6, 'background depth layers'), parallax: { type: 'array', items: { type: 'number' }, description: 'scroll factor per layer, far to near, 0..1' }, haze: numberIn(0, 1, 'atmospheric haze with distance'), fog: numberIn(0, 1, 'ground fog') })),
  texture: orNull(obj({ kind: en(TEXTURES), amount: numberIn(0, 1, 'texture strength') })),
  silhouette: orNull(obj({ playerShape: en(PLAYER_SHAPES), minDetail: numberIn(1, 8, 'smallest detail in art pixels') })),
  ui: orNull(obj({ frame: en(UI_FRAMES), text: en(UI_TEXTS) })),
  fx: orNull(obj({ kind: en(FX_KINDS), reducedFlash: { type: 'boolean' } })),
  forbid: { type: 'array', items: en(FORBIDS) },
});

// ---------- painting ----------
/**
 * Options for a painter drawing one asset class ('character', 'prop', 'goal', 'tileset', 'background', 'title') in a look:
 * { pixel, size (natural px), ink: { mode, width in box units }, shading, depth }. One pixel density and one outline
 * width hold across classes: pixel looks measure the outline in art pixels, vector looks in reference pixels.
 */
export function paintOptions(look, cls) {
  const span = DISPLAY_TILES[cls], box = VIEWBOX[cls], pixel = Boolean(look.pixel);
  const size = pixel ? Math.max(8, Math.round(span * REF_TILE_PX / look.pixel.scale)) : VECTOR_SIZE[cls];
  const unitsPerPx = pixel ? box / size : box / (span * REF_TILE_PX);
  return {
    pixel, size, unitsPerPx,
    ink: { mode: look.outline.mode, width: round2(look.outline.width * unitsPerPx) },
    shading: { bands: look.shading.bands, hueShift: look.shading.hueShift, stepped: pixel || look.forbid.includes('gradients') },
    depth: { layers: look.depth.layers, haze: look.depth.haze, fog: look.depth.fog },
  };
}

/** The direction with the look's role colors laid over the cast, ground and sky (explicit roles only). */
export function castColors(direction, look) {
  const r = look.palette.roles, d = { ...direction };
  for (const who of ['player', 'enemy']) if (r[who]) d[who] = { ...d[who], colors: { ...d[who]?.colors, primary: r[who] } };
  for (const what of ['pickup', 'hazard', 'goal']) if (r[what]) d[what] = { ...d[what], color: r[what] };
  if (r.ground) d.tiles = { ...d.tiles, groundColor: r.ground };
  if (r.sky) d.scenery = { ...d.scenery, sky: [mixLab(r.sky, '#000000', 0.12), r.sky, mixLab(r.sky, '#ffffff', 0.18)], land: d.scenery?.land };
  return d;
}

// ---------- SVG census and color transforms ----------
const COLOR_ATTR = /(fill|stroke|stop-color|flood-color)="(#[0-9a-fA-F]{6})"/g;
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`)); return m ? m[1] : null; };
const numAttr = (tag, name) => { const v = parseFloat(attr(tag, name) ?? ''); return Number.isFinite(v) ? v : 0; };
function bbox(nums) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let k = 0; k + 1 < nums.length; k += 2) { x0 = Math.min(x0, nums[k]); x1 = Math.max(x1, nums[k]); y0 = Math.min(y0, nums[k + 1]); y1 = Math.max(y1, nums[k + 1]); }
  return x1 >= x0 ? [x1 - x0, y1 - y0] : [0, 0];
}
const numbersIn = s => (String(s || '').match(/-?\d*\.?\d+(?:e-?\d+)?/g) || []).map(Number);
/** Rough painted area of one element (bounding boxes for paths; enough to weigh a census, not a rasterizer). */
function areaOf(name, tag, cap) {
  let a = 0;
  if (name === 'rect') a = numAttr(tag, 'width') * numAttr(tag, 'height');
  else if (name === 'circle') a = Math.PI * numAttr(tag, 'r') ** 2;
  else if (name === 'ellipse') a = Math.PI * numAttr(tag, 'rx') * numAttr(tag, 'ry');
  else { const [w, h] = bbox(numbersIn(attr(tag, name === 'path' ? 'd' : 'points'))); a = w * h * 0.5; }
  return Math.min(cap, a);
}
function strokeArea(name, tag) {
  const [w, h] = name === 'circle' ? [2 * numAttr(tag, 'r'), 2 * numAttr(tag, 'r')] : name === 'ellipse' ? [2 * numAttr(tag, 'rx'), 2 * numAttr(tag, 'ry')] : bbox(numbersIn(attr(tag, name === 'path' ? 'd' : 'points')));
  return Math.hypot(w, h) * numAttr(tag, 'stroke-width');
}
/** Gradient id → [[color, share, opacity]], shares by the span each stop covers. */
function gradients(svg) {
  const out = new Map();
  for (const m of svg.matchAll(/<(linearGradient|radialGradient)\s[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)) {
    const stops = [...m[3].matchAll(/<stop\s[^>]*>/g)].map(s => [parseFloat(attr(s[0], 'offset') ?? '0'), attr(s[0], 'stop-color'), parseFloat(attr(s[0], 'stop-opacity') ?? '1')]);
    const list = stops.map(([o, c, a], k) => [c, Math.max(0.02, ((stops[k + 1]?.[0] ?? 1) - (stops[k - 1]?.[0] ?? 0)) / 2), a]).filter(([c]) => /^#[0-9a-f]{6}$/i.test(c || ''));
    const total = list.reduce((s, x) => s + x[1], 0) || 1;
    out.set(m[2], list.map(([c, w, a]) => [c.toLowerCase(), w / total, a]));
  }
  return out;
}
/**
 * The colors an SVG paints, weighted by estimated area and opacity: Map hex → weight. Filled shapes count their fill
 * (their outline stroke is left out), unfilled strokes count their stroke, gradients count their stops.
 */
export function paintCensus(svg) {
  const grads = gradients(svg), out = new Map();
  const [, , vw = 100, vh = 100] = numbersIn(String(svg.match(/viewBox="([^"]*)"/)?.[1]));
  const cap = vw * vh;
  const body = svg.replace(/<defs>[\s\S]*?<\/defs>/g, '');
  const add = (c, w) => { if (w > 0) out.set(c, (out.get(c) || 0) + w); };
  for (const m of body.matchAll(/<(path|rect|circle|ellipse|polygon|polyline)\b[^>]*>/g)) {
    const [tag, name] = [m[0], m[1]];
    const alpha = parseFloat(attr(tag, 'opacity') ?? '1') * parseFloat(attr(tag, 'fill-opacity') ?? '1');
    const fill = attr(tag, 'fill'), stroke = attr(tag, 'stroke');
    let paint = fill, area = 0;
    if (fill && fill !== 'none') area = areaOf(name, tag, cap);
    else if (stroke && stroke !== 'none') { paint = stroke; area = Math.min(cap, strokeArea(name, tag)); }
    if (!paint || !area || !(alpha > 0)) continue;
    const ref = paint.match(/^url\(#([^)]+)\)$/);
    if (ref) for (const [c, share, a] of grads.get(ref[1]) || []) add(c, area * alpha * share * a);
    else if (/^#[0-9a-f]{6}$/i.test(paint)) add(paint.toLowerCase(), area * alpha);
  }
  return out;
}
/** Area-weighted median value (CIELAB L*) of what an SVG paints, or null when it paints nothing. */
export function svgValue(svg) {
  const list = [...paintCensus(svg)].map(([c, w]) => [toLab(c)[0], w]).sort((a, b) => a[0] - b[0]);
  const total = list.reduce((s, x) => s + x[1], 0);
  if (!total) return null;
  let acc = 0;
  for (const [v, w] of list) if ((acc += w) >= total / 2) return Math.round(v * 10) / 10;
  return list[list.length - 1][0];
}
/** Every distinct color an SVG paints (fills, strokes, gradient stops, filter floods). */
export const svgColors = svg => [...new Set([...svg.matchAll(COLOR_ATTR)].map(m => m[2].toLowerCase()))];
/** Replace every color an SVG paints through fn(hex) → hex. */
export const recolorSvg = (svg, fn) => svg.replace(COLOR_ATTR, (_, a, c) => `${a}="${fn(c.toLowerCase())}"`);
/** Opacities snapped to fully opaque or fully transparent (a look that forbids translucency). */
export const snapOpacity = svg => svg.replace(/(\s)(opacity|fill-opacity|stroke-opacity|stop-opacity|flood-opacity)="([\d.]+)"/g, (_, s, a, v) => `${s}${a}="${parseFloat(v) >= 0.5 ? 1 : 0}"`);

/** A function mapping any color to its nearest palette color. Near-monochrome palettes match by value alone. */
export function nearestIn(palette) {
  const labs = palette.map(c => [c, toLab(c)]);
  const chroma = labs.map(([, l]) => Math.hypot(l[1], l[2])), hues = labs.filter((_, k) => chroma[k] > 8).map(([, l]) => Math.atan2(l[2], l[1]));
  const monochrome = hues.length < 2 || Math.max(...hues) - Math.min(...hues) < 0.6;
  const cache = new Map();
  return c => {
    if (cache.has(c)) return cache.get(c);
    const [L, a, b] = toLab(c);
    let best = palette[0], bd = Infinity;
    for (const [p, [pl, pa, pb]] of labs) { const d = (L - pl) ** 2 + (monochrome ? 0.05 : 1) * ((a - pa) ** 2 + (b - pb) ** 2); if (d < bd) { bd = d; best = p; } }
    cache.set(c, best);
    return best;
  };
}

/**
 * A palette of `size` colors for groups of SVGs (one group per asset class, each weighing the same, so a
 * background's big areas cannot crowd out the tiles' or sprites' colors): weighted k-means in CIELAB over their
 * paint census, with the `seeds` (role colors) kept as fixed centers so the cast keeps its colors. Deterministic.
 */
export function derivePalette(groups, size, seeds = []) {
  const weights = new Map();
  for (const group of groups) {
    const census = new Map();
    for (const svg of group) for (const [c, w] of paintCensus(svg)) census.set(c, (census.get(c) || 0) + Math.sqrt(w));
    for (const svg of group) for (const c of svgColors(svg)) if (!census.has(c)) census.set(c, 0);
    const total = [...census.values()].reduce((a, b) => a + b, 0) || 1;
    for (const [c, w] of census) weights.set(c, (weights.get(c) || 0) + w / total + 0.002);
  }
  const items = [...weights].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([c, w]) => ({ c, w, lab: toLab(c) }));
  const fixed = [...new Set(seeds.filter(Boolean))].slice(0, size);
  if (items.length + fixed.length <= size) return [...new Set([...fixed, ...items.map(x => x.c)])];
  const d2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
  const centers = fixed.map(c => ({ lab: toLab(c), fixed: true }));
  if (!centers.length) centers.push({ lab: items[0].lab, fixed: false });
  while (centers.length < size) {
    let best = null, score = -1;
    for (const x of items) { const s = x.w * Math.min(...centers.map(k => d2(x.lab, k.lab))); if (s > score) { score = s; best = x; } }
    if (!best || score <= 0) break;
    centers.push({ lab: best.lab, fixed: false });
  }
  for (let round = 0; round < 8; round++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (const x of items) {
      let k = 0, bd = Infinity;
      centers.forEach((c, j) => { const d = d2(x.lab, c.lab); if (d < bd) { bd = d; k = j; } });
      const s = sums[k]; s[0] += x.lab[0] * x.w; s[1] += x.lab[1] * x.w; s[2] += x.lab[2] * x.w; s[3] += x.w;
    }
    centers.forEach((c, j) => { if (!c.fixed && sums[j][3] > 0) c.lab = [sums[j][0] / sums[j][3], sums[j][1] / sums[j][3], sums[j][2] / sums[j][3]]; });
  }
  return [...new Set([...fixed, ...centers.filter(c => !c.fixed).map(c => fromLab(c.lab))])].slice(0, size);
}

// ---------- separation ----------
const lightest = palette => palette.reduce((a, b) => (toLab(b)[0] > toLab(a)[0] ? b : a));
const vivid = palette => palette.reduce((a, b) => { const sa = rgbToHsl(hexToRgb(a)), sb = rgbToHsl(hexToRgb(b)); return sb[1] * (1 - Math.abs(sb[2] - 0.55)) > sa[1] * (1 - Math.abs(sa[2] - 0.55)) ? b : a; });
/** Wrap an SVG's content in a filter (rim light on the upper left edge, and/or a glow around the silhouette). */
function withFilter(svg, { rim, glow, px, pixel, strict }) {
  const parts = [], d = Math.max(0.5, px);
  if (glow) parts.push(pixel || strict
    ? `<feMorphology in="SourceAlpha" operator="dilate" radius="${round2(d)}" result="gw"/><feFlood flood-color="${glow}"/><feComposite in2="gw" operator="in" result="g"/>`
    : `<feMorphology in="SourceAlpha" operator="dilate" radius="${round2(d)}" result="gd"/><feGaussianBlur in="gd" stdDeviation="${round2(d * 1.5)}" result="gw"/><feFlood flood-color="${glow}" flood-opacity="0.85"/><feComposite in2="gw" operator="in" result="g"/>`);
  if (rim) parts.push(`<feOffset in="SourceAlpha" dx="${round2(d)}" dy="${round2(d)}" result="ro"/><feComposite in="SourceAlpha" in2="ro" operator="out" result="re"/><feFlood flood-color="${rim.color}"${strict ? '' : ` flood-opacity="${rim.amount}"`}/><feComposite in2="re" operator="in" result="r"/>`);
  if (!parts.length) return svg;
  const merge = `<feMerge>${glow ? '<feMergeNode in="g"/>' : ''}<feMergeNode in="SourceGraphic"/>${rim ? '<feMergeNode in="r"/>' : ''}</feMerge>`;
  const filter = `<defs><filter id="k0" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB">${parts.join('')}${merge}</filter></defs>`;
  return svg.replace(/^(<svg[^>]*>)([\s\S]*)(<\/svg>)$/, (_, open, inner, close) => `${open}${filter}<g filter="url(#k0)">${inner}</g>${close}`);
}

/**
 * Lock painted assets to a look. assets: [{ key, svg, cls, role, ... }] painted with paintOptions. Steps:
 * 1. translucency snapped when forbidden; 2. backgrounds hazed: their values re-centered `playerValueGap` away from
 * the player's and their range narrowed (the soft background, sharp playable layer), desaturating as they go; 3. the palette: the
 * declared colors or derived from the art; 4. every asset quantized to it; 5. the gap re-measured, hazing harder
 * while it is short, then pushing the player's own values away; 6. rim light and glow on the player and interactables.
 * Returns { assets, palette, separation: { player, background, gap, haze, hazeAmount } }.
 */
export function styleAssets(assets, look) {
  const strict = look.forbid.includes('translucency');
  const raw = assets.map(a => ({ ...a, svg: strict ? snapOpacity(a.svg) : a.svg }));
  const isBg = a => a.cls === 'background';
  const player = raw.find(a => a.role === 'player' && /-idle$/.test(a.key)) || raw.find(a => a.role === 'player');
  const bgRaw = raw.filter(isBg);
  const pv = player ? svgValue(player.svg) : null;
  const need = look.separation.playerValueGap * 100;
  // The haze color: the background's own hue at a value `need` (plus a margin) away from the player's.
  const bgLab = (() => {
    const census = new Map();
    for (const a of bgRaw) for (const [c, w] of paintCensus(a.svg)) census.set(c, (census.get(c) || 0) + w);
    let L = 0, A = 0, B = 0, W = 0;
    for (const [c, w] of census) { const [l, a2, b2] = toLab(c); L += l * w; A += a2 * w; B += b2 * w; W += w; }
    return W ? [L / W, A / W, B / W] : [50, 0, 0];
  })();
  // Prefer the side away from the player's own value; take the other when only it has room for the gap.
  // A locked palette bounds the values the background can reach.
  const fixedL = look.palette.colors ? look.palette.colors.map(c => toLab(c)[0]) : null;
  const lo = fixedL ? Math.max(4, Math.min(...fixedL)) : 4, hi = fixedL ? Math.min(96, Math.max(...fixedL)) : 96;
  const roomUp = pv === null ? 0 : hi - pv, roomDown = pv === null ? 0 : pv - lo, want = need + 12;
  const goDown = pv !== null && (pv >= 50 ? roomDown >= want || roomDown >= roomUp : roomUp < want && roomDown > roomUp);
  // The background keeps its own value when that is already far enough from the player's.
  const hazeL = pv === null || Math.abs(bgLab[0] - pv) >= want ? bgLab[0] : goDown ? Math.max(lo, pv - want) : Math.min(hi, pv + want);
  const haze = fromLab([hazeL, bgLab[1] * 0.4, bgLab[2] * 0.4]);
  // The background's values are re-centered on the haze value and their range narrowed by `amount` (detail stays,
  // contrast drops), and chroma fades with them: value first, then saturation.
  const hazeBg = c => { const [L, a2, b2] = toLab(c), k = 1 - amount; return fromLab([Math.min(100, Math.max(0, bgLab[0] + (hazeL - bgLab[0]) * Math.min(1, amount * 1.6) + (L - bgLab[0]) * k)), a2 * (1 - 0.5 * amount), b2 * (1 - 0.5 * amount)]); };
  let amount = round2(1 - look.separation.bgContrast), push = 0, palette = look.palette.colors, out = raw, gap = null, bgValue = null;
  const seeds = ROLES.map(r => look.palette.roles[r]);
  // The player's frames, pushed `push` away from the background's value when hazing alone cannot open the gap.
  const away = goDown ? 1 : -1;
  const pushed = c => { if (!push) return c; const [L, a2, b2] = toLab(c); return fromLab([Math.min(100, Math.max(0, L + away * push * 45)), a2, b2]); };
  for (let attempt = 0; attempt < 12; attempt++) {
    const hazed = raw.map(a => (isBg(a) ? { ...a, svg: recolorSvg(a.svg, hazeBg) } : a.role === 'player' && push ? { ...a, svg: recolorSvg(a.svg, pushed) } : a));
    palette ??= sanitizePalette(derivePalette([...new Set(hazed.map(a => a.cls))].map(cls => hazed.filter(a => a.cls === cls).map(a => a.svg)), look.palette.size, seeds), look.forbid);
    const near = nearestIn(palette);
    out = hazed.map(a => ({ ...a, svg: recolorSvg(a.svg, near) }));
    const q = out.find(a => a.key === player?.key);
    bgValue = svgValue(out.filter(isBg).map(a => a.svg).join(''));
    gap = q && bgValue !== null ? Math.abs((svgValue(q.svg) ?? 0) - bgValue) / 100 : null;
    if (gap === null || gap >= look.separation.playerValueGap || (amount >= 0.9 && push >= 0.6)) break;
    // Alternate: haze the background a step, then push the player a step, so neither flattens on its own.
    if ((attempt % 2 === 0 || push >= 0.6) && amount < 0.9) amount = round2(Math.min(0.9, amount + 0.15));
    else push = round2(Math.min(0.6, push + 0.15));
  }
  // Rim light and glow, drawn in palette colors.
  const glowRoles = look.separation.glow === 'player' ? ['player'] : look.separation.glow === 'interactables' ? ['player', 'pickup', 'goal'] : [];
  const rimColor = lightest(palette), near = nearestIn(palette);
  out = out.map(a => {
    const rim = a.role === 'player' && look.separation.rim > 0 ? { color: rimColor, amount: look.separation.rim } : null;
    const glow = glowRoles.includes(a.role) && a.cls !== 'title' ? near(look.palette.roles[a.role] || vivid(palette)) : null;
    if (!rim && !glow) return a;
    const o = paintOptions(look, a.cls);
    return { ...a, svg: withFilter(a.svg, { rim, glow, px: o.unitsPerPx, pixel: o.pixel, strict }) };
  });
  const finalPlayer = out.find(a => a.key === player?.key);
  return { assets: out, palette, separation: { player: finalPlayer ? svgValue(finalPlayer.svg) : null, background: bgValue, gap: gap === null ? null : round2(gap), haze, hazeAmount: amount, playerPush: push } };
}

// ---------- runtime primitives and image prompts ----------
/**
 * Configs for the 2D graphics primitives that carry the same look at runtime: graphics.post (palette quantization with
 * the look's dither, texture as grain or scanlines), graphics.sprite.pixel (outline and shading bands),
 * graphics.lighting.2d (glow lights on the player and interactables), and a depth/haze pass for
 * graphics.background.parallax layer lists (hazeLayers).
 */
export function lookPrimitives(look, palette = look.palette.colors) {
  const colors = palette || [];
  const glowColor = colors.length ? vivid(colors) : '#ffffff';
  const follow = look.separation.glow === 'player' ? ['player'] : look.separation.glow === 'interactables' ? ['player', 'collectible', 'goal'] : [];
  return {
    'graphics.post': { quantize: colors.length, palette: colors, dither: look.shading.dither, grain: look.texture.kind === 'grain' ? look.texture.amount : 0, scanlines: look.texture.kind === 'scanlines' && look.texture.amount > 0 },
    'graphics.sprite.pixel': { outline: look.outline.mode === 'none' ? 'none' : look.outline.mode === 'black' ? (colors.length ? colors.reduce((a, b) => (toLab(b)[0] < toLab(a)[0] ? b : a)) : '#000000') : 'auto', outlineWidth: Math.max(1, Math.min(2, Math.round(look.outline.width))), bands: look.shading.bands, palette: colors },
    'graphics.lighting.2d': { lights: follow.map(f => ({ follow: f, radius: f === 'player' ? 1.5 : 1, color: glowColor, flicker: 0, intensity: 0.6 })) },
  };
}
/** A parallax layer list (graphics.background.parallax) with the look's depth: scroll factors and haze toward hazeColor. */
export function hazeLayers(layers, look, hazeColor) {
  const n = layers.length;
  return layers.map((l, k) => ({ ...l, depth: look.depth.parallax[Math.min(look.depth.parallax.length - 1, Math.round(k / Math.max(1, n - 1) * (look.depth.parallax.length - 1)))], ...(look.depth.haze > 0 && k < n - 1 ? { fogColor: hazeColor } : {}), ...(l.color ? { color: mixLab(l.color, hazeColor, look.depth.haze * (1 - k / Math.max(1, n - 1)) * 0.8) } : {}) }));
}
/** The look as words, for image models that cannot be quantized afterwards (planner/art.js). */
export function describeLook(look) {
  const pal = look.palette.colors ? `a locked ${look.palette.colors.length}-color palette (${look.palette.colors.join(', ')})` : `a locked palette of at most ${look.palette.size} colors`;
  const ink = look.outline.mode === 'none' ? 'no outlines' : `${look.outline.width}px ${look.outline.mode === 'dark-hue' ? 'dark hue-matched' : look.outline.mode} outlines`;
  const px = look.pixel ? `pixel art at ${Math.round(REF_TILE_PX / look.pixel.scale)} pixels per tile, one pixel scale everywhere` : 'clean vector shapes';
  const sep = `the player separated from the background by a strong value gap${look.separation.rim ? ' and a rim light' : ''}${look.separation.glow !== 'none' ? `, with a glow on ${look.separation.glow === 'player' ? 'the player' : 'the player and interactable objects'}` : ''}`;
  return `${look.label}; ${pal}; ${ink}; ${look.shading.bands === 1 ? 'flat color' : `${look.shading.bands}-band hard cel shading with warm lights and cool shadows`}; ${px}; ${look.depth.layers} depth layers with atmospheric haze; ${sep}${look.forbid.length ? `; no ${look.forbid.join(', no ')}` : ''}`;
}
