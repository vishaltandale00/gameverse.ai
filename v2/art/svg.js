// Small SVG authoring helpers shared by the painters. Painters work in a fixed
// unit box; `document()` sets the natural pixel size, which is what makes the
// pixel style: a small natural size with crisp edges, upscaled without smoothing.
import { light, shade } from './color.js';

export const f = n => (Math.round(n * 100) / 100).toString();
export const pt = (x, y) => `${f(x)},${f(y)}`;

/** Seeded RNG (mulberry32) for deterministic scatter. */
export function rng(seed) {
  let s = typeof seed === 'number' ? seed >>> 0 : [...String(seed)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
  return () => { let t = (s = (s + 0x6d2b79f5) >>> 0); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Collects <defs> (gradients, clips) with unique ids per document. */
export function defs(prefix = 'd') {
  const items = [], cache = new Map();
  let n = 0;
  const add = (key, make) => { if (cache.has(key)) return cache.get(key); const id = `${prefix}${n++}`; items.push(make(id)); cache.set(key, id); return id; };
  return {
    /** Cel shading: a radial light from the upper left with a hard terminator. */
    cel(color, { soft = false } = {}) {
      return `url(#${add(`cel|${color}|${soft}`, id => soft
        ? `<radialGradient id="${id}" cx=".34" cy=".28" r=".85"><stop offset="0" stop-color="${light(color, 0.3)}"/><stop offset=".55" stop-color="${color}"/><stop offset="1" stop-color="${shade(color, 0.35)}"/></radialGradient>`
        : `<radialGradient id="${id}" cx=".36" cy=".3" r=".8"><stop offset="0" stop-color="${light(color, 0.28)}"/><stop offset=".22" stop-color="${light(color, 0.28)}"/><stop offset=".23" stop-color="${color}"/><stop offset=".68" stop-color="${color}"/><stop offset=".69" stop-color="${shade(color, 0.3)}"/><stop offset="1" stop-color="${shade(color, 0.36)}"/></radialGradient>`)})`;
    },
    linear(stops, { x1 = 0, y1 = 0, x2 = 0, y2 = 1 } = {}) {
      return `url(#${add(`lin|${JSON.stringify(stops)}|${x1}${y1}${x2}${y2}`, id => `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}"${a < 1 ? ` stop-opacity="${a}"` : ''}/>`).join('')}</linearGradient>`)})`;
    },
    radial(stops, { cx = 0.5, cy = 0.5, r = 0.5 } = {}) {
      return `url(#${add(`rad|${JSON.stringify(stops)}|${cx}${cy}${r}`, id => `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}"${a < 1 ? ` stop-opacity="${a}"` : ''}/>`).join('')}</radialGradient>`)})`;
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
