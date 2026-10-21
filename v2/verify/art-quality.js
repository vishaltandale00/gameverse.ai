// Art quality: whether painted art keeps its declared look (art/look.js). Like quality.js it never blocks
// publishing; it measures and reports info findings. Measured statically from the SVGs the painters wrote:
//   palette     distinct paint colors across all assets (fills, strokes, gradient stops, filter floods) ≤ the look's N
//   contrast    player-to-background value gap (CIELAB L*, area-weighted median of each side's paints) ≥ the declared gap
//   pixelScale  art pixels per tile, from each asset's natural size and its class's display size, the same everywhere
//   outline     the outline width (the most common stroke width of filled, stroked shapes) the same on every sprite
// The census estimates areas from shapes (bounding boxes for paths) and does not rasterize: anti-aliased edges and
// overlapping shapes are not counted. A value that was not measured is null, never 0; `unmeasured` says why.
import { DISPLAY_TILES, REF_TILE_PX, svgColors, svgValue } from '../art/look.js';

export const ART_QUALITY_VERSION = 'art-quality/0.1';
export const ART_QUALITY_CODES = {
  art_palette_over: 'the art paints more colors than the look\'s palette allows',
  art_contrast_low: 'the player\'s value is closer to the background\'s than the look\'s declared gap',
  art_pixel_scale_mixed: 'assets are drawn at different pixel densities',
  art_outline_mixed: 'sprites are outlined at different widths',
};
/** Tolerances for rounding natural sizes to whole pixels; they decide findings only. */
export const ART_QUALITY_TOLERANCE = Object.freeze({ pixelSpread: 1.08, outlinePx: 0.15 });

const SPRITES = ['character', 'prop', 'goal'];
const round = (v, d = 2) => (Number.isFinite(v) ? +v.toFixed(d) : null);
const finding = (code, path, message, extra = {}) => ({ code, path, message, severity: 'info', ...extra });
const rootNum = (svg, name) => parseFloat(svg.match(new RegExp(`^<svg[^>]*\\s${name}="([^"]*)"`))?.[1] ?? 'NaN');
const viewWidth = svg => parseFloat((svg.match(/^<svg[^>]*\sviewBox="([^"]*)"/)?.[1] ?? '').split(/\s+/)[2] ?? 'NaN');

/** The most common stroke width of shapes that are both filled and stroked (the outline), in box units, or null. */
export function outlineUnits(svg) {
  const counts = new Map();
  for (const m of svg.replace(/<defs>[\s\S]*?<\/defs>/g, '').matchAll(/<(path|rect|circle|ellipse|polygon)\b[^>]*>/g)) {
    const tag = m[0], fill = tag.match(/\sfill="([^"]*)"/)?.[1], sw = tag.match(/\sstroke-width="([^"]*)"/)?.[1];
    if (!fill || fill === 'none' || sw === undefined || !/\sstroke="(?!none)/.test(tag)) continue;
    counts.set(sw, (counts.get(sw) || 0) + 1);
  }
  let best = null, n = 0;
  for (const [w, c] of counts) if (c > n) { n = c; best = w; }
  return best === null ? null : parseFloat(best);
}

/**
 * artQuality(assets, look) → { version, palette, contrast, pixelScale, outline, findings, unmeasured }.
 * assets: [{ key, svg, cls, role }] as paintGameArt returns them; look: a resolved look (art/look.js resolveLook).
 */
export function artQuality(assets, look) {
  const findings = [], unmeasured = {};
  if (!look) return { version: ART_QUALITY_VERSION, palette: null, contrast: null, pixelScale: null, outline: null, findings, unmeasured: { all: 'the art direction declares no look' } };

  // Palette.
  const used = new Set(), perAsset = {};
  for (const a of assets) { const c = svgColors(a.svg); perAsset[a.key] = c.length; for (const x of c) used.add(x); }
  const palette = { declared: look.palette.colors?.length ?? look.palette.size, used: used.size, maxPerAsset: Math.max(0, ...Object.values(perAsset)) };
  if (palette.used > palette.declared) findings.push(finding('art_palette_over', 'look.palette', `${palette.used} colors painted across ${assets.length} assets; the look allows ${palette.declared}`));

  // Player-to-background value gap.
  const player = assets.find(a => a.role === 'player' && /-idle$/.test(a.key)) || assets.find(a => a.role === 'player');
  const bg = assets.filter(a => a.cls === 'background');
  let contrast = null;
  if (!player) unmeasured.contrast = 'no player sprite';
  else if (!bg.length) unmeasured.contrast = 'no background';
  else {
    const p = svgValue(player.svg), b = svgValue(bg.map(a => a.svg).join(''));
    if (p === null || b === null) unmeasured.contrast = 'the player or background paints nothing measurable';
    else {
      contrast = { player: round(p, 1), background: round(b, 1), gap: round(Math.abs(p - b) / 100), declared: look.separation.playerValueGap };
      if (contrast.gap < contrast.declared) findings.push(finding('art_contrast_low', 'look.separation.playerValueGap', `the player (value ${contrast.player}) and background (${contrast.background}) differ by ${contrast.gap}; the look asks for ${contrast.declared}`));
    }
  }

  // Pixel scale: art pixels per tile for every world-scale asset (the title is screen-sized key art).
  let pixelScale = null;
  if (!look.pixel) unmeasured.pixelScale = 'vector look';
  else {
    const values = {};
    for (const a of assets) if (DISPLAY_TILES[a.cls] && a.cls !== 'title') values[a.key] = round(rootNum(a.svg, 'width') / DISPLAY_TILES[a.cls], 1);
    const list = Object.values(values).filter(v => v !== null);
    const spread = list.length ? round(Math.max(...list) / Math.min(...list)) : null;
    pixelScale = { declared: round(REF_TILE_PX / look.pixel.scale, 1), spread, values };
    if (spread !== null && (spread > ART_QUALITY_TOLERANCE.pixelSpread || Math.abs(Math.max(...list) / pixelScale.declared - 1) > ART_QUALITY_TOLERANCE.pixelSpread - 1))
      findings.push(finding('art_pixel_scale_mixed', 'look.pixel.scale', `pixel densities range ${Math.min(...list)}–${Math.max(...list)} art px per tile; the look declares ${pixelScale.declared}`));
  }

  // Outline width on sprites, in art pixels (pixel looks) or reference pixels (vector looks).
  const widths = {};
  for (const a of assets) {
    if (!SPRITES.includes(a.cls)) continue;
    const u = outlineUnits(a.svg), box = viewWidth(a.svg);
    if (u === null || !box) continue;
    widths[a.key] = round(look.pixel ? u * rootNum(a.svg, 'width') / box : u * DISPLAY_TILES[a.cls] * REF_TILE_PX / box);
  }
  const wl = Object.values(widths).filter(v => v !== null);
  let outline = null;
  if (!wl.length) unmeasured.outline = 'no outlined sprite shapes';
  else {
    outline = { declared: look.outline.width, min: Math.min(...wl), max: Math.max(...wl), values: widths };
    if (outline.max - outline.min > ART_QUALITY_TOLERANCE.outlinePx || Math.abs(outline.max - outline.declared) > ART_QUALITY_TOLERANCE.outlinePx)
      findings.push(finding('art_outline_mixed', 'look.outline.width', `sprite outlines range ${outline.min}–${outline.max} px; the look declares ${outline.declared}`));
  }
  return { version: ART_QUALITY_VERSION, preset: look.preset, palette, contrast, pixelScale, outline, findings, unmeasured };
}
