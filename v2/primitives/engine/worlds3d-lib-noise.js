// Deterministic seeded noise for 3D world generation (worlds3d workstream).
// Pure functions of (seed, coordinates): chunks and terrain tiles can be
// generated lazily, in any order, and always come out identical. Seeds come
// from rt.random() once at install (KERNEL_API.md §2) and live in space state.
//
// - hash2/hash3/hashStr: integer hashes -> uint32; rand01 helpers.
// - perlin2/perlin3: improved gradient noise in [-1, 1] with a seeded permutation.
// - fbm/ridged/billow: fractal sums; warp: domain warping.
// - Rng: a tiny local generator for eager feature placement inside a generator
//   (seeded from a hash, never Math.random).

export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h >>> 0;
}
function mix(h) {
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16; return h >>> 0;
}
export const hash1 = (seed, a) => mix((seed ^ Math.imul(a | 0, 0x9e3779b1)) >>> 0);
export const hash2 = (seed, a, b) => mix((hash1(seed, a) ^ Math.imul(b | 0, 0x85ebca77)) >>> 0);
export const hash3 = (seed, a, b, c) => mix((hash2(seed, a, b) ^ Math.imul(c | 0, 0xc2b2ae3d)) >>> 0);
export const rand2 = (seed, a, b) => hash2(seed, a, b) / 4294967296;
export const rand3 = (seed, a, b, c) => hash3(seed, a, b, c) / 4294967296;
/** Derive a child seed from a seed and a label. */
export const subSeed = (seed, label) => mix((seed ^ hashStr(String(label))) >>> 0) || 1;

/** Local deterministic generator (mulberry32) for eager placement. */
export class Rng {
  constructor(seed) { this.s = seed >>> 0 || 1; }
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
  pick(list) { return list[Math.floor(this.next() * list.length)]; }
}

const perms = new Map();
/** Seeded permutation table (512 entries, doubled), cached per seed. */
function perm(seed) {
  let p = perms.get(seed);
  if (p) return p;
  p = new Uint8Array(512);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  const r = new Rng(seed);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r.next() * (i + 1)); const t = base[i]; base[i] = base[j]; base[j] = t; }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  if (perms.size > 256) perms.clear();
  perms.set(seed, p);
  return p;
}
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;
// 8 gradient directions in 2D, 12 edge directions in 3D (improved noise).
const G2F = new Float64Array([1, 0, -1, 0, 0, 1, 0, -1, 0.7071, 0.7071, -0.7071, 0.7071, 0.7071, -0.7071, -0.7071, -0.7071]);
function grad3(h, x, y, z) {
  switch (h & 15) {
    case 0: return x + y; case 1: return -x + y; case 2: return x - y; case 3: return -x - y;
    case 4: return x + z; case 5: return -x + z; case 6: return x - z; case 7: return -x - z;
    case 8: return y + z; case 9: return -y + z; case 10: return y - z; case 11: return -y - z;
    case 12: return x + y; case 13: return -x + y; case 14: return -y + z; default: return -y - z;
  }
}

/** Permutation tables for octaves seed, seed + stride, ... (cached: one lookup per fractal call). */
const octaveCache = new Map();
function octavePerms(seed, n, stride) {
  const k = seed * 64 + n + (stride === 7919 ? 32 : 0); let t = octaveCache.get(k);
  if (!t) { t = Array.from({ length: n }, (_, o) => perm(seed + o * stride)); if (octaveCache.size > 512) octaveCache.clear(); octaveCache.set(k, t); }
  return t;
}
/** 2D gradient noise in about [-1, 1]. */
export const perlin2 = (seed, x, y) => perlin2p(perm(seed), x, y);
function perlin2p(p, x, y) {
  const xf = Math.floor(x), yf = Math.floor(y);
  const X = xf & 255, Y = yf & 255, dx = x - xf, dy = y - yf;
  const u = fade(dx), v = fade(dy);
  const g = (h, gx, gy) => { const i = (h & 7) * 2; return G2F[i] * gx + G2F[i + 1] * gy; };
  const aa = p[p[X] + Y], ab = p[p[X] + Y + 1], ba = p[p[X + 1] + Y], bb = p[p[X + 1] + Y + 1];
  return 1.4142 * lerp(lerp(g(aa, dx, dy), g(ba, dx - 1, dy), u), lerp(g(ab, dx, dy - 1), g(bb, dx - 1, dy - 1), u), v);
}

/** 3D gradient noise in about [-1, 1]. */
export const perlin3 = (seed, x, y, z) => perlin3p(perm(seed), x, y, z);
function perlin3p(p, x, y, z) {
  const xf = Math.floor(x), yf = Math.floor(y), zf = Math.floor(z);
  const X = xf & 255, Y = yf & 255, Z = zf & 255, dx = x - xf, dy = y - yf, dz = z - zf;
  const u = fade(dx), v = fade(dy), w = fade(dz);
  const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z, B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
  return lerp(
    lerp(lerp(grad3(p[AA], dx, dy, dz), grad3(p[BA], dx - 1, dy, dz), u), lerp(grad3(p[AB], dx, dy - 1, dz), grad3(p[BB], dx - 1, dy - 1, dz), u), v),
    lerp(lerp(grad3(p[AA + 1], dx, dy, dz - 1), grad3(p[BA + 1], dx - 1, dy, dz - 1), u), lerp(grad3(p[AB + 1], dx, dy - 1, dz - 1), grad3(p[BB + 1], dx - 1, dy - 1, dz - 1), u), v), w);
}

/** Fractal Brownian motion, normalised to about [-1, 1]. */
export function fbm2(seed, x, y, octaves = 5, lacunarity = 2, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0, f = 1; const ps = octavePerms(seed, octaves, 1013);
  for (let o = 0; o < octaves; o++) { sum += amp * perlin2p(ps[o], x * f, y * f); norm += amp; amp *= gain; f *= lacunarity; }
  return sum / norm;
}
export function fbm3(seed, x, y, z, octaves = 3, lacunarity = 2, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0, f = 1; const ps = octavePerms(seed, octaves, 1013);
  for (let o = 0; o < octaves; o++) { sum += amp * perlin3p(ps[o], x * f, y * f, z * f); norm += amp; amp *= gain; f *= lacunarity; }
  return sum / norm;
}
/** Ridged multifractal in [0, 1]: sharp crests where noise crosses zero (mountain ridges). */
export function ridged2(seed, x, y, octaves = 5, lacunarity = 2, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0, f = 1, weight = 1; const ps = octavePerms(seed, octaves, 7919);
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(perlin2p(ps[o], x * f, y * f));
    n *= n * weight; weight = Math.min(1, Math.max(0, n * 2));
    sum += amp * n; norm += amp; amp *= gain; f *= lacunarity;
  }
  return sum / norm;
}
/** Domain warp: returns [x', y'] displaced by low-frequency noise of strength `amount` (in input units). */
export function warp2(seed, x, y, amount, octaves = 3) {
  if (!amount) return [x, y];
  return [x + amount * fbm2(seed ^ 0x51ed, x, y, octaves), y + amount * fbm2(seed ^ 0x2c1b, x + 5.2, y + 1.3, octaves)];
}
export const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
