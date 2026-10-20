// Shared helpers for the flat (2D canvas) graphics primitives: math, seeded
// noise, color strings, offscreen surfaces and typography. Pure and safe to
// import in Node (surfaces return null without a DOM or OffscreenCanvas).
import { hexToRgb, rgbToHex, mix, shade, light, luminance, outlineOf, saturate, hueShift, hex, isHex } from '../../art/color.js';

export { hexToRgb, rgbToHex, mix, shade, light, luminance, outlineOf, saturate, hueShift, hex, isHex };
export const TAU = Math.PI * 2;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const clamp01 = v => clamp(v, 0, 1);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = t => t * t * (3 - 2 * t);
export const easeOut = t => 1 - (1 - clamp01(t)) ** 3;
export const easeOutBack = t => { const c = 1.70158, x = clamp01(t) - 1; return 1 + (c + 1) * x * x * x + c * x * x; };
/** Exponential smoothing factor for a per-frame fraction `k` (at 60 Hz) over dt seconds. */
export const damp = (k, dt) => 1 - Math.pow(1 - clamp(k, 0, 0.999), dt * 60);

/** Integer hash → [0,1). */
export function hash(n) { let h = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
export const hash2 = (x, y, s = 0) => hash(Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul(s | 0, 83492791));
/** String → 32-bit seed. */
export function seedOf(str) { let h = 2166136261; for (const c of String(str)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h >>> 0; }
/** Seeded RNG (mulberry32). Presentation only, but seeded so screenshots repeat. */
export function rng(seed) {
  let s = typeof seed === 'number' ? seed >>> 0 : seedOf(seed);
  return () => { let t = (s = (s + 0x6d2b79f5) >>> 0); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Smooth 1D value noise in [-1, 1]. */
export function noise1(x, seed = 0) { const i = Math.floor(x), f = x - i, a = hash(i + seed * 7919) * 2 - 1, b = hash(i + 1 + seed * 7919) * 2 - 1; return lerp(a, b, smooth(f)); }

export const rgba = (c, a) => { const [r, g, b] = hexToRgb(c); return `rgba(${r},${g},${b},${+clamp01(a).toFixed(3)})`; };
/** Parse '#rgb', '#rrggbb' or a named fallback. Returns '#rrggbb'. */
export const col = (c, fallback = '#888888') => hex(c, fallback);
/** Brighter, saturated version of a color for neon strokes. */
export function neon(c) { return saturate(light(col(c), 0.18), 0.3); }

/** An offscreen 2D surface: OffscreenCanvas, a DOM canvas, or null (Node). */
export function surface(w, h) {
  w = Math.max(1, Math.ceil(w)); h = Math.max(1, Math.ceil(h));
  if (typeof OffscreenCanvas !== 'undefined') { try { return new OffscreenCanvas(w, h); } catch { /* fall through */ } }
  if (typeof document !== 'undefined' && document.createElement) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  return null;
}
export const ctx2d = c => c?.getContext?.('2d') || null;

export function roundRect(g, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
export function polyPath(g, pts, close = true) { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); if (close) g.closePath(); }
export function starPath(g, x, y, R, r = R * 0.45, n = 5, rot = -Math.PI / 2) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) { const a = rot + (i * Math.PI) / n, rr = i % 2 ? r : R; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  g.closePath();
}

// ---------- typography ----------
export const FONTS = {
  rounded: '"Avenir Next", "Nunito", ui-rounded, "SF Pro Rounded", "Segoe UI", system-ui, sans-serif',
  pixel: '"Silkscreen", "Press Start 2P", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  bold: '"Avenir Next Condensed", "Helvetica Neue", Arial, system-ui, sans-serif',
  serif: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
  hand: '"Chalkboard SE", "Comic Sans MS", "Marker Felt", cursive',
};
export const fontOf = (style = 'rounded') => FONTS[style] || FONTS.rounded;
/** Outlined, shadowed text that reads on any background. */
export function label(g, str, x, y, { size = 14, weight = 800, color = '#ffffff', font = FONTS.rounded, align = 'center', base = 'middle', stroke = 'rgba(10,8,20,.75)', alpha = 1, maxW } = {}) {
  if (!g.fillText) return;
  g.save(); g.globalAlpha *= alpha;
  g.font = `${weight} ${Math.max(1, size)}px ${font}`; g.textAlign = align; g.textBaseline = base;
  if (stroke) { g.lineJoin = 'round'; g.lineWidth = Math.max(2, size * 0.22); g.strokeStyle = stroke; g.strokeText(str, x, y, maxW); }
  g.fillStyle = color; g.fillText(str, x, y, maxW);
  g.restore();
}

/** Whether the viewer asked for reduced motion (browser only). */
export function prefersReducedMotion() {
  try { return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}
/** Read a dotted path from an object ('components.move.range'). */
export const path = (obj, p) => String(p).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
/** Words of an id/name for keyword matching ('thorn_crawler' → ['thorn','crawler']). */
export const words = s => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
