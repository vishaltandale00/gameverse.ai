// Small SVG authoring helpers shared by the painters. Painters work in a fixed
// unit box; `document()` sets the natural pixel size, which is what makes the
// pixel style: a small natural size with crisp edges, upscaled without smoothing.
import { light, shade, mix } from './color.js';

export const f = n => (Math.round(n * 100) / 100).toString();
export const pt = (x, y) => `${f(x)},${f(y)}`;

/** Seeded RNG (mulberry32) for deterministic scatter. */
export function rng(seed) {
  let s = typeof seed === 'number' ? seed >>> 0 : [...String(seed)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
  return () => { let t = (s = (s + 0x6d2b79f5) >>> 0); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Gradient stops resampled into `n` hard bands (each band the color at its center). Pure. */
export function stepStops(stops, n) {
  const at = t => {
    const s = [...stops].sort((a, b) => a[0] - b[0]);
    const i = s.findIndex(x => x[0] >= t);
    if (i <= 0) return i === 0 ? s[0] : s[s.length - 1];
    const [o0, c0, a0 = 1] = s[i - 1], [o1, c1, a1 = 1] = s[i], k = o1 > o0 ? (t - o0) / (o1 - o0) : 0;
    return [t, mix(c0, c1, k), a0 + (a1 - a0) * k];
  };
  const out = [];
  for (let b = 0; b < n; b++) { const [, c, a = 1] = at((b + 0.5) / n); out.push([b / n, c, a], [(b + 1) / n, c, a]); }
  return out;
}
// Cel ramps by band count: [offset, light (+) or shade (-) amount] pairs, upper left lit.
const CEL_BANDS = { 2: [[0, 0], [0.6, 0], [0.6, -0.3], [1, -0.36]], 3: [[0, 0.28], [0.22, 0.28], [0.23, 0], [0.68, 0], [0.69, -0.3], [1, -0.36]], 4: [[0, 0.5], [0.12, 0.5], [0.12, 0.28], [0.3, 0.28], [0.3, 0], [0.68, 0], [0.68, -0.3], [1, -0.36]] };

/** Collects <defs> (gradients, clips) with unique ids per document.
 * shading (an art look's): { bands 1..4 cel bands, hueShift 0..1, stepped: linear and radial gradients become hard bands }.
 * Without it the painters' original three-band cel and smooth gradients are drawn. */
export function defs(prefix = 'd', shading = null) {
  const items = [], cache = new Map();
  let n = 0;
  const add = (key, make) => { if (cache.has(key)) return cache.get(key); const id = `${prefix}${n++}`; items.push(make(id)); cache.set(key, id); return id; };
  const bands = shading ? Math.max(1, Math.min(4, Math.round(shading.bands ?? 3))) : null, hs = shading?.hueShift ?? 0.5;
  const stops = list => (shading?.stepped ? stepStops(list, Math.max(2, bands * 2)) : list).map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}"${a < 1 ? ` stop-opacity="${shading ? Math.round(a * 1000) / 1000 : a}"` : ''}/>`).join('');
  return {
    /** Cel shading: a radial light from the upper left with a hard terminator. */
    cel(color, { soft = false } = {}) {
      if (bands === 1) return color;
      if (bands) {
        const ramp = CEL_BANDS[bands].map(([o, k]) => `<stop offset="${o}" stop-color="${k > 0 ? light(color, k, hs) : k < 0 ? shade(color, -k, hs) : color}"/>`).join('');
        return `url(#${add(`cel|${color}|b${bands}`, id => `<radialGradient id="${id}" cx=".36" cy=".3" r=".8">${ramp}</radialGradient>`)})`;
      }
      return `url(#${add(`cel|${color}|${soft}`, id => soft
        ? `<radialGradient id="${id}" cx=".34" cy=".28" r=".85"><stop offset="0" stop-color="${light(color, 0.3)}"/><stop offset=".55" stop-color="${color}"/><stop offset="1" stop-color="${shade(color, 0.35)}"/></radialGradient>`
        : `<radialGradient id="${id}" cx=".36" cy=".3" r=".8"><stop offset="0" stop-color="${light(color, 0.28)}"/><stop offset=".22" stop-color="${light(color, 0.28)}"/><stop offset=".23" stop-color="${color}"/><stop offset=".68" stop-color="${color}"/><stop offset=".69" stop-color="${shade(color, 0.3)}"/><stop offset="1" stop-color="${shade(color, 0.36)}"/></radialGradient>`)})`;
    },
    linear(list, { x1 = 0, y1 = 0, x2 = 0, y2 = 1 } = {}) {
      return `url(#${add(`lin|${JSON.stringify(list)}|${x1}${y1}${x2}${y2}`, id => `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops(list)}</linearGradient>`)})`;
    },
    radial(list, { cx = 0.5, cy = 0.5, r = 0.5 } = {}) {
      return `url(#${add(`rad|${JSON.stringify(list)}|${cx}${cy}${r}`, id => `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops(list)}</radialGradient>`)})`;
    },
    clip(key, body) { return `url(#${add(`clip|${key}`, id => `<clipPath id="${id}">${body}</clipPath>`)})`; },
    raw(key, make) { return add(key, make); },
    toString() { return items.length ? `<defs>${items.join('')}</defs>` : ''; },
  };
}

/** Wrap content as a standalone SVG file. */
export function document({ width, height, viewBox, body, defs: d = '', crisp = false }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}"${crisp ? ' shape-rendering="crispEdges"' : ''}>${d}${body}</svg>`;
}

/** A smooth closed path through points (Catmull-Rom to cubic Bézier). */
export function smoothPath(points, closed = true) {
  const p = points, n = p.length;
  if (n < 3) return `M${p.map(([x, y]) => pt(x, y)).join('L')}${closed ? 'Z' : ''}`;
  const at = i => closed ? p[(i + n) % n] : p[Math.max(0, Math.min(n - 1, i))];
  let d = `M${pt(...p[0])}`;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    d += `C${pt(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)} ${pt(p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)} ${pt(...p2)}`;
  }
  return d + (closed ? 'Z' : '');
}
