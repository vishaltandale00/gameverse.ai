// Color math for the procedural painters. Colors are '#rrggbb' strings.
const clamp01 = v => Math.min(1, Math.max(0, v));

export function hexToRgb(hex) {
  let h = String(hex || '#888888').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h.slice(0, 6).padEnd(6, '0'), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgbToHex = ([r, g, b]) => '#' + [r, g, b].map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
export const isHex = s => /^#[0-9a-f]{6}$/i.test(s || '') || /^#[0-9a-f]{3}$/i.test(s || '');
export const hex = (s, fallback) => isHex(s) ? rgbToHex(hexToRgb(s)) : fallback;

export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
export function hslToRgb([h, s, l]) {
  h = ((h % 360) + 360) % 360 / 360;
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

export function mix(a, b, t) {
  const x = hexToRgb(a), y = hexToRgb(b);
  return rgbToHex(x.map((v, i) => v + (y[i] - v) * t));
}
/** Shade toward a hue-shifted dark (warm light, cool shadow), the way pixel artists ramp colors.
 * hueShift 0..1 scales the hue rotation (0.5 is the painters' default). */
export function shade(c, amount = 0.25, hueShift = 0.5) {
  const [h, s, l] = rgbToHsl(hexToRgb(c));
  const towardBlue = h > 60 && h < 240 ? 1 : -1;
  return rgbToHex(hslToRgb([h + towardBlue * 48 * amount * hueShift, clamp01(s + 0.08 * amount), clamp01(l - amount * 0.55)]));
}
export function light(c, amount = 0.25, hueShift = 0.5) {
  const [h, s, l] = rgbToHsl(hexToRgb(c));
  const towardYellow = h > 60 && h < 240 ? -1 : 1;
  return rgbToHex(hslToRgb([h + towardYellow * 40 * amount * hueShift, clamp01(s - 0.05 * amount), clamp01(l + amount * 0.5)]));
}
export const luminance = c => { const [r, g, b] = hexToRgb(c).map(v => v / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
/** A dark outline color that belongs to the fill rather than flat black. */
export const outlineOf = c => { const [h, s] = rgbToHsl(hexToRgb(c)); return rgbToHex(hslToRgb([h, Math.min(0.6, s), 0.13])); };
/** The outline color for an art look's outline mode: 'dark-hue' (a dark of the fill's own hue), 'black', or 'colored' (a bright line in the fill's hue). */
export const inkOf = (mode, c) => mode === 'black' ? '#000000' : mode === 'colored' ? saturate(light(c, 0.3), 0.3) : outlineOf(mix(c, '#000000', 0.35));
export function saturate(c, amount) { const [h, s, l] = rgbToHsl(hexToRgb(c)); return rgbToHex(hslToRgb([h, clamp01(s + amount), l])); }
export function hueShift(c, deg) { const [h, s, l] = rgbToHsl(hexToRgb(c)); return rgbToHex(hslToRgb([h + deg, s, l])); }

// CIELAB (D65): L* is perceived value 0..100, which is what value-gap and palette matching are measured in.
const lin = v => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const gam = v => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const labF = t => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
const labInv = t => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
export function toLab(c) {
  const [r, g, b] = hexToRgb(c).map(lin);
  const x = labF((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), y = labF(0.2126 * r + 0.7152 * g + 0.0722 * b), z = labF((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export function fromLab([L, a, b]) {
  const fy = (L + 16) / 116, x = labInv(fy + a / 500) * 0.95047, y = labInv(fy), z = labInv(fy - b / 200) * 1.08883;
  return rgbToHex([3.2406 * x - 1.5372 * y - 0.4986 * z, -0.9689 * x + 1.8758 * y + 0.0415 * z, 0.0557 * x - 0.204 * y + 1.057 * z].map(v => gam(clamp01(v))));
}
/** Mix in CIELAB, which keeps hazed and compressed colors perceptually even. */
export function mixLab(a, b, t) { const x = toLab(a), y = toLab(b); return fromLab(x.map((v, i) => v + (y[i] - v) * t)); }
