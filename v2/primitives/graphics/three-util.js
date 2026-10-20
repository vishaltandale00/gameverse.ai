// Small dependency-free helpers shared by the three workstream's modules.

/** Deterministic hash of a string to [0,1) (presentation variety: hues, jitter). */
export function hash01(str, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** '#rrggbb' (sRGB) -> linear [r,g,b] floats, the space three.js vertex colors live in. */
export function colorOf(hex) {
  const h = String(hex || '#888888').replace('#', '');
  const v = parseInt((h.length === 3 ? h.split('').map(c => c + c).join('') : h).padEnd(6, '0').slice(0, 6), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map(c => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
}
export const isHex = s => typeof s === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s);

/** Integer lattice hash in [0,1) for per-cell/per-position variation. */
export function hash3(x, y, z, seed = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 1442695041) + Math.imul(seed | 0, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth 2D value noise in [0,1), deterministic. */
export function noise2(x, z, seed = 0) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash3(xi, 0, zi, seed), b = hash3(xi + 1, 0, zi, seed), c = hash3(xi, 0, zi + 1, seed), d = hash3(xi + 1, 0, zi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm2(x, z, octaves = 4, seed = 0) { let s = 0, a = 0.5, f = 1, n = 0; for (let i = 0; i < octaves; i++) { s += a * noise2(x * f, z * f, seed + i * 17); n += a; a *= 0.5; f *= 2; } return s / n; }

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a || 1e-9), 0, 1); return t * t * (3 - 2 * t); };
