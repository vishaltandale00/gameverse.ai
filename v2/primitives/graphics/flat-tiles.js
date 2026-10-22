// Procedural tile painting. Every pattern is computed from WORLD pixel
// coordinates, so neighbouring tiles join without seams; autotile features
// (open edges, outer and inner corners from flat-autotile) add lit top lips,
// grass/moss/snow caps, shaded undersides, rounded or chamfered corners and an
// outline that traces the terrain silhouette. A theme is { pattern, palette:{a
// base, b highlight, c dark}, edge: soft|sharp|warm|glow|none }.
import { hexToRgb, rgbToHex, mix as mix0, light as light0, shade as shade0, col, hash2 } from './flat-util.js';
import { features } from './flat-autotile.js';

// Color ramps are memoized: patterns return few distinct colors, painted per pixel.
const memo = new Map();
const cached = (k, f) => { let v = memo.get(k); if (v === undefined) { if (memo.size > 50000) memo.clear(); v = f(); memo.set(k, v); } return v; };
const shade = (c, k) => cached(`s${c}${k}`, () => shade0(c, k));
const light = (c, k) => cached(`l${c}${k}`, () => light0(c, k));
const mix = (a, b, t) => cached(`m${a}${b}${t}`, () => mix0(a, b, t));

export const PATTERNS = ['canopy', 'rock', 'brick', 'moss', 'wood', 'ice', 'metal', 'crystal', 'soil', 'ash', 'grass', 'sand', 'snow', 'dirt', 'stone', 'lava', 'water', 'tech', 'candy', 'checker', 'plain'];
export const EDGES = ['soft', 'sharp', 'warm', 'glow', 'none'];
/** A block's tile pattern: the one it declares (`tile`, one of PATTERNS), never one guessed from its id, name or tags. */
export function patternFor(block = {}) {
  return PATTERNS.includes(block.tile) ? block.tile : 'rock';
}
/** Theme from a block's own color when no tileset theme applies. */
export function themeFromBlock(block = {}, edge = 'soft') {
  const a = col(block.color, '#7a6a5a');
  return { id: `block:${block.id}`, pattern: patternFor(block), palette: { a, b: light(a, 0.35), c: shade(a, 0.55) }, edge };
}
export function normalizeTheme(t = {}) {
  const a = col(t.palette?.a, '#6a6070');
  return { id: t.id, pattern: PATTERNS.includes(t.pattern) ? t.pattern : 'rock', edge: EDGES.includes(t.edge) ? t.edge : 'soft', palette: { a, b: col(t.palette?.b, light(a, 0.4)), c: col(t.palette?.c, shade(a, 0.55)) } };
}

// Precomputed color ramps per palette object (patterns run per pixel).
const ramps = new WeakMap();
const rampOf = p => { let r = ramps.get(p); if (!r) { r = { dark: shade0(p.a, 0.13), lite: light0(p.a, 0.07), seam: shade0(p.c, 0.05), mossA: shade0(p.a, 0.05) }; for (const k of ['dark', 'lite']) { r[`${k}Rim`] = light0(r[k], 0.12); r[`${k}Low`] = shade0(r[k], 0.12); r[`${k}Pit`] = shade0(r[k], 0.2); } r.aRim = light0(p.a, 0.12); r.aLow = shade0(p.a, 0.12); r.aPit = shade0(p.a, 0.2); r.mossP = { a: r.mossA, b: p.b, c: p.c }; ramps.set(p, r); } return r; };
// Per-pattern pixel color at world pixel (X, Y) (Y grows down on screen). Returns a hex or null (transparent).
const P = {
  rock(X, Y, p, T) {
    // Cobbled stones: nearest of jittered points (Worley); seams where two stones meet, a lit upper rim on each.
    const S = Math.max(4, T * 0.55), gx = Math.floor(X / S), gy = Math.floor(Y / S);
    let d1 = 1e9, d2 = 1e9, id = 0, fy = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cx = gx + i, cy = gy + j, fx = (cx + 0.15 + hash2(cx, cy, 5) * 0.7) * S, fyy = (cy + 0.15 + hash2(cx, cy, 9) * 0.7) * S;
      const d = (X - fx) ** 2 + ((Y - fyy) * 1.25) ** 2;
      if (d < d1) { d2 = d1; d1 = d; id = hash2(cx, cy, 11); fy = fyy; } else if (d < d2) d2 = d;
    }
    const edge = Math.sqrt(d2) - Math.sqrt(d1), R = rampOf(p);
    if (edge < 1.1) return R.seam;
    const t = id < 0.3 ? 'dark' : id > 0.75 ? 'lite' : 'a';
    if (edge < 2.2) return Y < fy ? R[`${t}Rim`] : R[`${t}Low`];
    return hash2(X, Y, 3) < 0.03 ? R[`${t}Pit`] : t === 'a' ? p.a : R[t];
  },
  stone(X, Y, p, T) { return P.rock(X, Y, p, T); },
  brick(X, Y, p, T) {
    const bh = Math.max(3, Math.round(T / 4)), bw = bh * 2, row = Math.floor(Y / bh), off = row % 2 ? bw / 2 : 0, bx = Math.floor((X + off) / bw);
    const ly = Y - row * bh, lx = (X + off) - bx * bw;
    if (ly === bh - 1 || lx === bw - 1) return p.c;
    const tone = hash2(bx, row, 5); const base = tone < 0.3 ? shade(p.a, 0.1) : tone > 0.8 ? light(p.a, 0.07) : p.a;
    return ly === 0 ? light(base, 0.12) : hash2(X, Y, 9) < 0.05 ? shade(base, 0.2) : base;
  },
  moss(X, Y, p, T) { const n = hash2(Math.floor(X / 3), Math.floor(Y / 3), 21); return n > 0.82 ? (hash2(X, Y, 2) > 0.5 ? mix(p.b, p.a, 0.25) : mix(p.b, p.a, 0.55)) : P.rock(X, Y, rampOf(p).mossP, T); },
  wood(X, Y, p, T) {
    const ph = Math.max(3, Math.round(T / 4)), plank = Math.floor(Y / ph), ly = Y - plank * ph, seam = Math.floor((X + plank * 7) / (T * 1.5));
    if (ly === ph - 1) return p.c;
    if ((X + plank * 7) % Math.round(T * 1.5) === 0) return shade(p.a, 0.3);
    const grain = Math.sin((X + hash2(seam, plank) * 40) * 0.35 + ly * 1.7) > 0.82;
    return grain ? shade(p.a, 0.16) : ly === 0 ? light(p.a, 0.1) : p.a;
  },
  ice(X, Y, p, T) { const d = ((X + Y) % Math.max(6, T)) ; return d === 0 || d === 1 ? light(p.b, 0.25) : hash2(X, Y, 4) < 0.04 ? '#ffffff' : mix(p.a, p.b, Math.round((0.25 + 0.15 * Math.sin((X - Y) * 0.2)) * 20) / 20); },
  metal(X, Y, p, T) {
    const lx = ((X % T) + T) % T, ly = ((Y % T) + T) % T;
    if (lx === 0 || ly === 0) return p.c; if (lx === T - 1 || ly === T - 1) return shade(p.a, 0.2);
    if ((lx === 2 || lx === T - 3) && (ly === 2 || ly === T - 3)) return p.b;
    const streak = hash2(Math.floor(X / 2), Math.floor(Y / 7), 8) > 0.86;
    return streak ? mix(p.a, p.b, 0.35) : ly === 1 ? light(p.a, 0.1) : p.a;
  },
  crystal(X, Y, p, T) { const cx = Math.floor(X / 5), cy = Math.floor(Y / 7), h = hash2(cx, cy, 31), f = (X - cx * 5) + (Y - cy * 7); return f < 2 ? light(p.b, 0.2) : h > 0.7 ? p.b : h < 0.25 ? shade(p.a, 0.15) : mix(p.a, p.b, 0.25); },
  soil(X, Y, p) { const v = hash2(X, Y, 13), b = hash2(Math.floor(X / 4), Math.floor(Y / 3), 17); return v < 0.05 ? shade(p.a, 0.3) : v > 0.97 ? light(p.a, 0.2) : b > 0.75 ? light(p.a, 0.07) : b < 0.2 ? shade(p.a, 0.1) : p.a; },
  dirt(X, Y, p) { return P.soil(X, Y, p); },
  ash(X, Y, p, T) { const crack = Math.abs(Math.sin(X * 0.31 + Math.floor(Y / T) * 2.1) + Math.cos(Y * 0.43 + X * 0.07)) < 0.08; const v = hash2(X, Y, 23); return crack ? p.c : v > 0.97 ? mix(p.a, p.b, 0.5) : v < 0.1 ? shade(p.a, 0.12) : p.a; },
  grass(X, Y, p) { return P.soil(X, Y, p); },
  sand(X, Y, p) { const r = Math.sin(X * 0.4 + Math.sin(Y * 0.3) * 2) > 0.85; return r ? light(p.a, 0.12) : hash2(X, Y, 6) < 0.05 ? shade(p.a, 0.18) : p.a; },
  snow(X, Y, p) { return hash2(X, Y, 7) < 0.05 ? mix(p.a, '#a8c8e8', 0.4) : p.a; },
  lava(X, Y, p) { const v = Math.sin(X * 0.3 + Math.sin(Y * 0.25) * 3) + Math.cos(Y * 0.2 - X * 0.1); return v > 1.1 ? '#ffe070' : v > 0.4 ? p.b : p.a; },
  water(X, Y, p) { return Math.sin(X * 0.3 + Y * 0.2) > 0.9 ? p.b : p.a; },
  tech(X, Y, p, T) { const lx = ((X % T) + T) % T, ly = ((Y % T) + T) % T; if (lx === 0 || ly === 0) return p.c; if ((lx === Math.floor(T / 2) && ly > 2 && ly < T - 3) || (ly === Math.floor(T / 2) && lx > T / 2)) return p.b; return lx < 2 || ly < 2 ? light(p.a, 0.08) : p.a; },
  candy(X, Y, p) { return Math.floor((X + Y) / 4) % 2 ? p.a : p.b; },
  checker(X, Y, p, T) { const h = Math.max(2, T / 2); return (Math.floor(X / h) + Math.floor(Y / h)) % 2 ? p.a : shade(p.a, 0.18); },
  plain(X, Y, p) { return p.a; },
};
const CAP = { moss: 'moss', grass: 'grass', snow: 'snow', soil: 'grass', dirt: 'grass', sand: 'sand', candy: 'frosting' };

const rgbCache = new Map();
const rgb = c => { let v = rgbCache.get(c); if (!v) { v = hexToRgb(c); rgbCache.set(c, v); } return v; };

/**
 * Paint one tile into an RGBA buffer region (buffer w×h, tile at bx,by in buffer pixels, T px square).
 * wx, wy: world cell (wy counted DOWN the screen) for seamless patterns. mask: blob47/wang16 mask.
 * opts: { mode, background (dim/flat back layer), oneway (thin plank top), cap (override) }
 */
export function paintTile(buf, bw, bx, by, T, theme, wx, wy, mask, opts = {}) {
  const th = theme, p = th.palette, fn = P[th.pattern] || P.rock, F = features(mask, opts.mode || 'blob47');
  const bg = opts.background, soft = th.edge === 'soft', glowEdge = th.edge === 'glow', warm = th.edge === 'warm';
  const lip = warm ? mix(p.b, '#ffd080', 0.4) : glowEdge ? light(p.b, 0.2) : light(p.b, 0.05);
  const cap = opts.cap ?? CAP[th.pattern];
  const capColor = cap === 'snow' ? '#f4f8ff' : cap === 'sand' ? light(p.a, 0.2) : cap === 'frosting' ? '#ffd0e8' : p.b;
  const hgt = opts.oneway ? Math.max(2, Math.round(T / 4)) : T;
  const deep = !opts.oneway && mask === 255, bgK = bg ? (typeof bg === 'number' ? bg : 0.45) : 0;
  if (th.pattern === 'canopy') return paintCanopy(buf, bw, bx, by, T, p, wx, wy, F, bg);
  for (let y = 0; y < hgt; y++) for (let x = 0; x < T; x++) {
    // Rounded (soft) or chamfered (sharp) outer corners.
    const cr = soft ? 2 : th.edge === 'none' ? 0 : 1;
    const inCorner = (cx, cy) => { const dx = cx ? T - 1 - x : x, dy = cy ? T - 1 - y : y; return dx + dy < cr; };
    if ((F.outer.nw && inCorner(0, 0)) || (F.outer.ne && inCorner(1, 0)) || (!opts.oneway && ((F.outer.sw && inCorner(0, 1)) || (F.outer.se && inCorner(1, 1))))) continue;
    let c = fn(wx * T + x, wy * T + y, p, T);
    if (c == null) continue;
    // Edges: lit top lip, cap, shaded underside, side light from the upper left.
    if (F.open.n && y < 2) c = y === 0 ? (cap ? capColor : lip) : cap ? mix(capColor, c, 0.35) : mix(lip, c, 0.5);
    else if (F.open.n && cap && y < 4 && hash2(wx * T + x, wy, 41) > 0.45) c = mix(capColor, c, 0.4);
    if (F.open.s && y >= hgt - 2) c = y === hgt - 1 ? p.c : shade(c, 0.25);
    if (F.open.w && x === 0) c = F.open.n && y < 2 ? c : light(c, 0.08);
    if (F.open.e && x === T - 1) c = shade(c, 0.22);
    if (F.inner.ne && x === T - 1 && y === 0) c = p.c;
    if (F.inner.nw && x === 0 && y === 0) c = p.c;
    if (F.inner.se && x === T - 1 && y === T - 1) c = shade(c, 0.3);
    if (F.inner.sw && x === 0 && y === T - 1) c = shade(c, 0.3);
    // Top-down walls show a front face on their open south side.
    if (opts.face && F.open.s) { const fh = Math.round(T * 0.38); if (y >= T - fh) c = y === T - fh ? light(p.a, 0.12) : shade(fn(wx * T + x, wy * T + y * 2, p, T) ?? p.a, 0.3); }
    if (glowEdge && (F.open.n && y === 0)) c = light(p.b, 0.35);
    // Interior depth and back-layer dimming are numeric (no per-pixel color strings).
    const [r, g, b] = rgb(c), i = ((by + y) * bw + bx + x) * 4, k = (deep ? 0.86 : 1) * (bg ? 1 - bgK : 1), add = bg ? bgK * 10 : 0;
    buf[i] = r * k + add; buf[i + 1] = g * k + add * 0.8; buf[i + 2] = b * k + add * 1.8; buf[i + 3] = 255;
  }
  // Silhouette outline along open edges (front layers only).
  if (!bg && th.edge !== 'none') {
    const o = rgb(shade(p.c, 0.3));
    const put = (x, y) => { const i = ((by + y) * bw + bx + x) * 4; buf[i] = o[0]; buf[i + 1] = o[1]; buf[i + 2] = o[2]; buf[i + 3] = 255; };
    if (F.open.s && !opts.oneway) for (let x = 0; x < T; x++) if (buf[((by + T - 1) * bw + bx + x) * 4 + 3]) put(x, T - 1);
    if (F.open.e) for (let y = 0; y < hgt; y++) if (buf[((by + y) * bw + bx + T - 1) * 4 + 3]) put(T - 1, y);
  }
  // Grass/moss tufts hanging over the top edge are drawn by the caller above the tile (decorations()).
  return F;
}

/** Tree crowns: a lumpy leafy disc that merges toward connected neighbours, lit from the upper left. */
function paintCanopy(buf, bw, bx, by, T, p, wx, wy, F, bg) {
  const R = T * 0.5, c = T / 2;
  const lite = rgb(light(p.a, 0.22)), mid = rgb(p.a), dark = rgb(shade(p.a, 0.25)), edge = rgb(shade(p.c, 0.2)), trunk = rgb('#5a3a22');
  const put = (x, y, v) => { const i = ((by + y) * bw + bx + x) * 4; const k = bg ? 0.55 : 1; buf[i] = v[0] * k; buf[i + 1] = v[1] * k; buf[i + 2] = v[2] * k; buf[i + 3] = 255; };
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    // Distance to the crown, stretched toward connected sides so neighbouring trees form one canopy.
    let dx = x + 0.5 - c, dy = y + 0.5 - c;
    if (!F.open.e && dx > 0) dx = 0; if (!F.open.w && dx < 0) dx = 0; if (!F.open.n && dy < 0) dy = 0; if (!F.open.s && dy > 0) dy = 0;
    const wob = (hash2(wx * T + x >> 2, wy * T + y >> 2, 77) - 0.5) * 2.2;
    const d = Math.hypot(dx, dy) + wob;
    if (d > R) { if (F.open.s && y > T * 0.62 && Math.abs(x + 0.5 - c) < T * 0.09) put(x, y, trunk); continue; }
    const leaf = hash2(wx * T + x, wy * T + y, 31);
    const shadeK = (dx + dy) / (R * 2);
    put(x, y, d > R - 1.2 ? edge : shadeK < -0.18 && leaf > 0.25 ? lite : shadeK > 0.22 || leaf < 0.12 ? dark : mid);
  }
  return F;
}

/** Overhanging decorations above an exposed top edge: tufts, icicles below undersides. Returns [{x,y,c}] tile-local pixels (y may be negative). */
export function decorations(theme, wx, wy, T, F) {
  const out = [], p = theme.palette, cap = CAP[theme.pattern];
  if (F.open.n && (cap === 'grass' || cap === 'moss')) for (let x = 0; x < T; x++) { const h = hash2(wx * T + x, wy, 51); if (h > 0.62) { out.push({ x, y: -1, c: p.b }); if (h > 0.86) out.push({ x, y: -2, c: light(p.b, 0.15) }); } }
  if (F.open.s && (theme.pattern === 'ice' || theme.pattern === 'crystal')) for (let x = 1; x < T - 1; x++) { const h = hash2(wx * T + x, wy, 61); if (h > 0.8) { const len = 1 + Math.floor(h * 4); for (let k = 0; k < len; k++) out.push({ x, y: T + k, c: k === len - 1 ? '#ffffff' : light(p.b, 0.2) }); } }
  if (F.open.s && theme.pattern === 'moss') for (let x = 0; x < T; x++) { const h = hash2(wx * T + x, wy, 71); if (h > 0.84) { const len = 1 + Math.floor(h * 5); for (let k = 0; k < len; k++) out.push({ x, y: T + k, c: shade(p.b, 0.1 * k) }); } }
  return out;
}

/** Background-wall color for a space from its themes (dark, desaturated). */
export function wallTone(theme) { return mix(theme.palette.a, '#06040c', 0.62); }
export const toHex = rgbToHex;
