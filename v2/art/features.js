// Composable scenery features. A scene is a theme plus features ("leafy forest, dense", "street
// with traffic, near"), so environment requests map to real parts instead of a single theme word.
// Static parts are painted into the background SVG here; moving parts (cars, leaves, birds,
// weather) are animated live by ambient.js in the same 384×256 layout.
import { f, pt } from './svg.js';
import { light, shade, mix } from './color.js';

export const W = 384, H = 256;
/** Baselines per depth, as fractions of height. Kits hide roughly the bottom 14% behind their floor. */
export const DEPTH_Y = { far: 0.56, mid: 0.68, near: 0.8 };
/** The street band, where traffic and pedestrians move. */
export const STREET = { top: 0.745, bottom: 0.84 };

export const STATIC_FEATURES = ['leafy-forest', 'pine-forest', 'palms', 'bushes', 'flowers', 'tall-grass', 'skyline', 'houses', 'street', 'neon-signs', 'street-lamps', 'bridge', 'mountains', 'hills', 'cliffs', 'river', 'lake', 'ocean', 'waterfall', 'castle', 'ruins', 'windmills', 'fences', 'market-stalls'];
export const MOVING_FEATURES = ['traffic', 'pedestrians', 'birds', 'falling-leaves', 'fireflies', 'rain', 'snow', 'fog', 'drifting-clouds', 'embers', 'bubbles', 'train'];
export const FEATURES = [...STATIC_FEATURES, ...MOVING_FEATURES];
export const DEPTHS = ['far', 'mid', 'near'];
// Moving features that need a static base.
const NEEDS = { traffic: 'street', pedestrians: 'street', train: 'bridge' };

/** Normalize a feature list: known kinds, density 0..1, depth, and the static bases moving parts need. */
export function normalizeFeatures(list) {
  const out = [];
  for (const x of Array.isArray(list) ? list.slice(0, 16) : []) {
    if (!FEATURES.includes(x?.kind)) continue;
    out.push({ kind: x.kind, density: Math.min(1, Math.max(0.05, Number(x.density) || 0.6)), depth: DEPTHS.includes(x.depth) ? x.depth : x.kind === 'street' || NEEDS[x.kind] ? 'near' : 'mid', color: /^#[0-9a-f]{6}$/i.test(x.color || '') ? x.color : null });
  }
  for (const x of [...out]) if (NEEDS[x.kind] && !out.some(y => y.kind === NEEDS[x.kind])) out.push({ kind: NEEDS[x.kind], density: 0.7, depth: 'near', color: null });
  return out;
}

const DEPTH_ORDER = { far: 0, mid: 1, near: 2 };
/** Paint the static features into SVG, far to near. ctx: { r (rng), haze, night, land, foliage, d (defs) }. */
export function paintFeatures(features, ctx) {
  const list = normalizeFeatures(features).filter(x => STATIC_FEATURES.includes(x.kind)).sort((a, b) => DEPTH_ORDER[a.depth] - DEPTH_ORDER[b.depth] || (a.kind === 'street') - (b.kind === 'street'));
  return list.map(x => (PAINT[x.kind] || (() => ''))({ ...x, ...ctx, atmos: { far: 0.6, mid: 0.35, near: 0.12 }[x.depth] })).join('');
}

const n = (density, max) => Math.max(1, Math.round(max * density));
const tint = (c, ctx) => mix(c, ctx.haze, ctx.atmos);

function canopy(r, x, y, size, color, night) {
  // A broadleaf crown: overlapping lobes with a lit upper side and a shaded underside.
  const lit = light(color, night ? 0.05 : 0.22), dark = shade(color, 0.28);
  let s = `<path d="M${pt(x, y)}V${f(y - size * 0.5)}" stroke="${shade(color, 0.6)}" stroke-width="${f(size * 0.12)}" stroke-linecap="round"/>`;
  const lobes = 5 + Math.floor(r() * 3);
  for (let i = 0; i < lobes; i++) { const a = (i / lobes) * Math.PI * 2, rr = size * (0.3 + r() * 0.12); s += `<circle cx="${f(x + Math.cos(a) * size * 0.3)}" cy="${f(y - size * 0.72 + Math.sin(a) * size * 0.2)}" r="${f(rr)}" fill="${dark}"/>`; }
  for (let i = 0; i < lobes - 1; i++) { const a = (i / lobes) * Math.PI * 2 + 0.4, rr = size * (0.24 + r() * 0.1); s += `<circle cx="${f(x + Math.cos(a) * size * 0.24)}" cy="${f(y - size * 0.8 + Math.sin(a) * size * 0.14)}" r="${f(rr)}" fill="${color}"/>`; }
  s += `<circle cx="${f(x - size * 0.1)}" cy="${f(y - size * 0.95)}" r="${f(size * 0.2)}" fill="${lit}"/>`;
  return s;
}

const PAINT = {
  'leafy-forest'(x) {
    const { r } = x, base = H * DEPTH_Y[x.depth], size = { far: 26, mid: 40, near: 58 }[x.depth];
    const green = tint(x.color || x.foliage || '#3f8f3a', x);
    let s = `<path d="M0 ${f(base - size * 0.5)}${Array.from({ length: 25 }, (_, i) => `Q${f(i * 16 + 8)} ${f(base - size * (0.75 + r() * 0.3))} ${f(i * 16 + 16)} ${f(base - size * 0.5)}`).join('')}V${H}H0Z" fill="${shade(green, 0.2)}"/>`;
    const count = n(x.density, Math.round(W / (size * 0.42)));
    for (let i = 0; i < count; i++) s += canopy(r, (i + r() * 0.8) * (W / count), base + r() * 6, size * (0.75 + r() * 0.45), r() < 0.25 ? mix(green, '#7ab84a', 0.35) : green, x.night);
    return s;
  },
  'pine-forest'(x) {
    const { r } = x, base = H * DEPTH_Y[x.depth], size = { far: 30, mid: 46, near: 64 }[x.depth], c = tint(x.color || '#2a6a48', x);
    let s = '';
    const count = n(x.density, Math.round(W / (size * 0.32)));
    for (let i = 0; i < count; i++) {
      const cx = (i + r()) * (W / count), h = size * (0.7 + r() * 0.5), y = base + r() * 4;
      s += `<path d="M${pt(cx, y - h)}L${pt(cx + h * 0.3, y - h * 0.4)}L${pt(cx + h * 0.16, y - h * 0.42)}L${pt(cx + h * 0.38, y)}L${pt(cx - h * 0.38, y)}L${pt(cx - h * 0.16, y - h * 0.42)}L${pt(cx - h * 0.3, y - h * 0.4)}Z" fill="${r() < 0.3 ? shade(c, 0.12) : c}"/><path d="M${pt(cx, y - h)}L${pt(cx - h * 0.3, y - h * 0.4)}L${pt(cx, y - h * 0.45)}Z" fill="${light(c, 0.12)}" opacity=".7"/>`;
    }
    return s;
  },
  palms(x) {
    const { r } = x, base = H * DEPTH_Y[x.depth], size = { far: 30, mid: 44, near: 62 }[x.depth], c = tint(x.color || '#3a9a4a', x), trunk = tint('#8a6a3a', x);
    let s = '';
    for (let i = 0, k = n(x.density, 8); i < k; i++) {
      const cx = (i + r() * 0.7) * (W / k), y = base, lean = (r() - 0.5) * size * 0.3, tx = cx + lean, ty = y - size;
      s += `<path d="M${pt(cx, y)}Q${pt(cx + lean * 0.2, y - size * 0.5)} ${pt(tx, ty)}" stroke="${trunk}" stroke-width="${f(size * 0.07)}" fill="none" stroke-linecap="round"/>`;
      for (const a of [-2.6, -2, -1.2, -0.6, 0, 0.5]) s += `<path d="M${pt(tx, ty)}q${f(Math.cos(a) * size * 0.3)} ${f(Math.sin(a) * size * 0.25 - size * 0.08)} ${f(Math.cos(a) * size * 0.5)} ${f(Math.sin(a) * size * 0.3 + size * 0.12)}" stroke="${c}" stroke-width="${f(size * 0.08)}" fill="none" stroke-linecap="round"/>`;
    }
    return s;
  },
  bushes(x) {
    const { r } = x, base = H * DEPTH_Y[x.depth], c = tint(x.color || x.foliage || '#4a9a3a', x);
    let s = '';
    for (let i = 0, k = n(x.density, 18); i < k; i++) { const cx = r() * W, sz = 6 + r() * 8; s += `<ellipse cx="${f(cx)}" cy="${f(base)}" rx="${f(sz * 1.3)}" ry="${f(sz * 0.8)}" fill="${shade(c, 0.15)}"/><ellipse cx="${f(cx - sz * 0.2)}" cy="${f(base - sz * 0.3)}" rx="${f(sz * 0.8)}" ry="${f(sz * 0.55)}" fill="${c}"/>`; }
    return s;
  },
  flowers(x) {
    const { r } = x, base = H * DEPTH_Y[x.depth];
    let s = '';
    const colors = ['#ff6fa8', '#ffd23f', '#ffffff', '#b07aff', '#ff8a3a'];
    for (let i = 0, k = n(x.density, 60); i < k; i++) s += `<circle cx="${f(r() * W)}" cy="${f(base - r() * 10)}" r="${f(1 + r() * 1.3)}" fill="${tint(x.color || colors[i % colors.length], x)}"/>`;
    return s;
  },
  'tall-grass'(x) {
    const { r } = x, base = H * DEPTH_Y[x.depth], c = tint(x.color || '#5aa83a', x);
    let d = '';
    for (let i = 0, k = n(x.density, 120); i < k; i++) { const gx = r() * W, h = 5 + r() * 9; d += `M${pt(gx, base)}q${f((r() - 0.5) * 4)} ${f(-h * 0.6)} ${f((r() - 0.5) * 6)} ${f(-h)}`; }
    return `<path d="${d}" stroke="${c}" stroke-width="1.2" fill="none" stroke-linecap="round"/>`;
  },
  skyline(x) {
    const { r } = x, base = H * DEPTH_Y[x.depth], c = tint(x.color || x.land || '#3a4058', x), lit = x.night ? '#ffe28a' : null;
    let s = '', bx = -4;
    const tall = { far: 70, mid: 95, near: 120 }[x.depth] * (0.6 + x.density * 0.6);
    while (bx < W) {
      const w = 12 + r() * 22, h = tall * (0.35 + r() * 0.65);
      s += `<rect x="${f(bx)}" y="${f(base - h)}" width="${f(w)}" height="${f(h + 60)}" fill="${r() < 0.3 ? shade(c, 0.08) : c}"/><rect x="${f(bx)}" y="${f(base - h)}" width="${f(w * 0.18)}" height="${f(h + 60)}" fill="${light(c, 0.08)}" opacity=".6"/>`;
      if (r() < 0.25) s += `<rect x="${f(bx + w * 0.45)}" y="${f(base - h - 9)}" width="1.5" height="9" fill="${c}"/>`;
      for (let wy = base - h + 4; wy < base - 3; wy += 6) for (let wx = bx + 2.5; wx < bx + w - 3; wx += 4.5) if (r() < (lit ? 0.42 : 0.18)) s += `<rect x="${f(wx)}" y="${f(wy)}" width="2" height="2.6" fill="${lit || light(c, 0.3)}" opacity="${f(0.5 + r() * 0.5)}"/>`;
      bx += w + 1 + r() * 3;
    }
    return s;
  },
  houses(x) {
    const { r } = x, base = H * DEPTH_Y[x.depth], size = { far: 18, mid: 26, near: 36 }[x.depth];
    const walls = ['#e8d6b0', '#d8a878', '#c8d8e8', '#e8c0b0', '#f0e8d0'], roofs = ['#a04a3a', '#5a4a6a', '#3a5a7a', '#8a5a3a'];
    let s = '';
    for (let i = 0, k = n(x.density, Math.round(W / (size * 1.3))); i < k; i++) {
      const hx = (i + r() * 0.3) * (W / k), w = size * (0.9 + r() * 0.4), h = size * (0.7 + r() * 0.3), wall = tint(walls[i % walls.length], x), roof = tint(roofs[(i * 3) % roofs.length], x);
      s += `<rect x="${f(hx)}" y="${f(base - h)}" width="${f(w)}" height="${f(h)}" fill="${wall}"/><path d="M${pt(hx - 2, base - h)}L${pt(hx + w / 2, base - h - size * 0.5)}L${pt(hx + w + 2, base - h)}Z" fill="${roof}"/>`;
      s += `<rect x="${f(hx + w * 0.4)}" y="${f(base - h * 0.45)}" width="${f(w * 0.2)}" height="${f(h * 0.45)}" fill="${shade(wall, 0.4)}"/><rect x="${f(hx + w * 0.12)}" y="${f(base - h * 0.75)}" width="${f(w * 0.18)}" height="${f(h * 0.2)}" fill="${x.night ? '#ffd870' : light(wall, 0.4)}"/>`;
    }
    return s;
  },
  street(x) {
    const top = H * STREET.top, bottom = H * STREET.bottom, road = x.color || (x.night ? '#2a2c38' : '#4a4c58');
    let s = `<rect y="${f(top - 5)}" width="${W}" height="5" fill="${x.night ? '#5a5a68' : '#a8a8b0'}"/><rect y="${f(top - 5)}" width="${W}" height="1.2" fill="#ffffff" opacity=".35"/>`;
    s += `<rect y="${f(top)}" width="${W}" height="${f(bottom - top)}" fill="${road}"/><rect y="${f(top)}" width="${W}" height="2" fill="${shade(road, 0.4)}"/>`;
    const mid = (top + bottom) / 2;
    for (let lx = 4; lx < W; lx += 22) s += `<rect x="${lx}" y="${f(mid - 0.7)}" width="11" height="1.4" fill="#f0d870" opacity=".85"/>`;
    s += `<rect y="${f(bottom)}" width="${W}" height="4" fill="${x.night ? '#5a5a68' : '#a8a8b0'}"/>`;
    return s + PAINT['street-lamps']({ ...x, base: top - 5 });
  },
  'street-lamps'(x) {
    const { r } = x, base = x.base ?? H * DEPTH_Y[x.depth], gap = 70 - x.density * 30;
    let s = '';
    for (let lx = 20 + r() * 20; lx < W; lx += gap) {
      s += `<path d="M${pt(lx, base)}V${f(base - 26)}q0 -4 6 -4" stroke="#2a2c36" stroke-width="1.6" fill="none"/>`;
      if (x.night) s += `<circle cx="${f(lx + 6)}" cy="${f(base - 29)}" r="16" fill="${x.d.radial([[0, '#ffe8a0', 0.45], [1, '#ffe8a0', 0]])}"/>`;
      s += `<circle cx="${f(lx + 6)}" cy="${f(base - 29)}" r="2" fill="${x.night ? '#fff4c8' : '#e8e8e8'}"/>`;
    }
    return s;
  },
  'neon-signs'(x) {
    const { r } = x, base = H * DEPTH_Y[x.depth];
    const colors = ['#ff3ea5', '#3af0ff', '#ffe23a', '#7a5aff', '#4aff8a'];
    let s = '';
    for (let i = 0, k = n(x.density, 10); i < k; i++) {
      const sx = r() * (W - 30), sy = base - 30 - r() * 50, w = 14 + r() * 22, c = colors[i % colors.length];
      s += `<rect x="${f(sx)}" y="${f(sy)}" width="${f(w)}" height="7" rx="2" fill="none" stroke="${c}" stroke-width="1.6"/><rect x="${f(sx - 3)}" y="${f(sy - 3)}" width="${f(w + 6)}" height="13" rx="4" fill="${c}" opacity=".18"/>`;
    }
    return s;
  },
  bridge(x) {
    const y = H * (DEPTH_Y[x.depth] - 0.08), c = tint(x.color || '#6a6a78', x);
    let s = `<rect y="${f(y)}" width="${W}" height="5" fill="${c}"/><rect y="${f(y)}" width="${W}" height="1.2" fill="${light(c, 0.3)}"/>`;
    for (let bx = 10; bx < W; bx += 48) s += `<rect x="${bx}" y="${f(y + 5)}" width="6" height="${f(H - y)}" fill="${shade(c, 0.2)}"/>`;
    return s;
  },
  mountains(x) {
    const { r } = x, base = H * DEPTH_Y[x.depth], amp = { far: 70, mid: 55, near: 40 }[x.depth] * (0.6 + x.density * 0.6), c = tint(x.color || '#6a7a9a', x);
    let d = `M0 ${H}L0 ${f(base)}`;
    for (let px = 0; px <= W; px += 24) d += `L${f(px + 12)} ${f(base - amp * (0.4 + r() * 0.6))}L${f(px + 24)} ${f(base - amp * r() * 0.3)}`;
    return `<path d="${d}L${W} ${H}Z" fill="${c}"/>`;
  },
  hills(x) {
    const { r } = x, base = H * DEPTH_Y[x.depth], c = tint(x.color || x.land || '#5aa84a', x);
    let d = `M0 ${H}L0 ${f(base)}`;
    for (let px = 0; px <= W; px += 48) d += `Q${f(px + 24)} ${f(base - 18 - r() * 22 * (0.5 + x.density))} ${f(px + 48)} ${f(base)}`;
    return `<path d="${d}L${W} ${H}Z" fill="${c}"/>`;
  },
  cliffs(x) {
    const base = H * DEPTH_Y[x.depth], c = tint(x.color || '#8a7a6a', x);
    return `<path d="M0 ${H}V${f(base - 60)}L${f(W * 0.12)} ${f(base - 70)}L${f(W * 0.22)} ${f(base - 30)}V${H}Z" fill="${c}"/><path d="M${W} ${H}V${f(base - 55)}L${f(W * 0.86)} ${f(base - 64)}L${f(W * 0.78)} ${f(base - 26)}V${H}Z" fill="${shade(c, 0.1)}"/>`;
  },
  river(x) {
    const y = H * (DEPTH_Y[x.depth] - 0.02), c = tint(x.color || '#4a8ae0', x);
    return `<path d="M0 ${f(y)}Q${f(W * 0.3)} ${f(y - 6)} ${f(W * 0.55)} ${f(y + 2)}T${W} ${f(y)}V${f(y + 10)}Q${f(W * 0.5)} ${f(y + 16)} 0 ${f(y + 10)}Z" fill="${c}"/><path d="M20 ${f(y + 4)}h30M140 ${f(y + 6)}h40M260 ${f(y + 4)}h30" stroke="#ffffff" stroke-width="1" opacity=".5"/>`;
  },
  lake(x) { const y = H * DEPTH_Y[x.depth] - 8, c = tint(x.color || '#4a8ae0', x); return `<ellipse cx="${f(W * 0.5)}" cy="${f(y)}" rx="${f(W * 0.35)}" ry="10" fill="${c}"/><path d="M${f(W * 0.3)} ${f(y)}h40M${f(W * 0.55)} ${f(y + 3)}h30" stroke="#ffffff" stroke-width="1" opacity=".5"/>`; },
  ocean(x) {
    const y = H * (DEPTH_Y[x.depth] - 0.1), c = tint(x.color || '#2a7ab8', x);
    return `<rect y="${f(y)}" width="${W}" height="${f(H - y)}" fill="${x.d.linear([[0, light(c, 0.15)], [1, shade(c, 0.35)]])}"/>` + Array.from({ length: 14 }, () => `<path d="M${f(x.r() * W)} ${f(y + 4 + x.r() * (H - y - 10))}h${f(8 + x.r() * 18)}" stroke="#ffffff" stroke-width="1" opacity=".45"/>`).join('');
  },
  waterfall(x) { const base = H * DEPTH_Y[x.depth], cx = W * (0.25 + x.r() * 0.5); return `<rect x="${f(cx - 10)}" y="${f(base - 90)}" width="20" height="90" fill="${x.d.linear([[0, '#d8f0ff'], [1, '#7ac0f0']])}" opacity=".9"/><ellipse cx="${f(cx)}" cy="${f(base)}" rx="22" ry="5" fill="#ffffff" opacity=".7"/>`; },
  castle(x) {
    const base = H * DEPTH_Y[x.depth], cx = W * (0.55 + x.r() * 0.2), c = tint(x.color || '#8a8aa0', x), s = { far: 0.7, mid: 1, near: 1.3 }[x.depth];
    return `<path d="M${f(cx - 50 * s)} ${f(base)}V${f(base - 40 * s)}h${f(10 * s)}v${f(-8 * s)}h${f(8 * s)}v${f(8 * s)}h${f(14 * s)}v${f(-40 * s)}h${f(-4 * s)}l${f(10 * s)} ${f(-16 * s)}l${f(10 * s)} ${f(16 * s)}h${f(-4 * s)}v${f(40 * s)}h${f(14 * s)}v${f(-8 * s)}h${f(8 * s)}v${f(8 * s)}h${f(10 * s)}V${f(base)}Z" fill="${c}"/><rect x="${f(cx - 4 * s)}" y="${f(base - 54 * s)}" width="${f(5 * s)}" height="${f(7 * s)}" fill="${x.night ? '#ffd060' : shade(c, 0.3)}"/>`;
  },
  ruins(x) {
    const { r } = x, base = H * DEPTH_Y[x.depth], c = tint(x.color || '#a89a80', x);
    let s = '';
    for (let i = 0, k = n(x.density, 7); i < k; i++) { const cx = (i + r()) * (W / k), h = 20 + r() * 40; s += `<rect x="${f(cx)}" y="${f(base - h)}" width="7" height="${f(h)}" fill="${c}"/><rect x="${f(cx - 2)}" y="${f(base - h)}" width="11" height="3" fill="${light(c, 0.15)}"/>`; }
    return s;
  },
  windmills(x) {
    const { r } = x, base = H * DEPTH_Y[x.depth], c = tint(x.color || '#e8e0d0', x);
    let s = '';
    for (let i = 0, k = n(x.density, 3); i < k; i++) { const cx = (i + 0.3 + r() * 0.4) * (W / k); s += `<path d="M${pt(cx - 6, base)}L${pt(cx - 3, base - 40)}H${f(cx + 3)}L${pt(cx + 6, base)}Z" fill="${c}"/>` + [0, 90, 180, 270].map(a => `<path d="M${pt(cx, base - 40)}l${f(Math.cos((a + 20) * Math.PI / 180) * 22)} ${f(Math.sin((a + 20) * Math.PI / 180) * 22)}" stroke="${shade(c, 0.3)}" stroke-width="3"/>`).join(''); }
    return s;
  },
  fences(x) { const base = H * DEPTH_Y[x.depth], c = tint(x.color || '#a07a4a', x); let s = `<rect y="${f(base - 8)}" width="${W}" height="1.6" fill="${c}"/><rect y="${f(base - 4)}" width="${W}" height="1.6" fill="${c}"/>`; for (let px = 3; px < W; px += 10) s += `<rect x="${px}" y="${f(base - 11)}" width="2" height="11" fill="${c}"/>`; return s; },
  'market-stalls'(x) {
    const { r } = x, base = H * DEPTH_Y[x.depth], tops = ['#e8402a', '#3a7ad8', '#f0b429', '#4aae5a'];
    let s = '';
    for (let i = 0, k = n(x.density, 7); i < k; i++) { const cx = (i + r() * 0.4) * (W / k), w = 26; s += `<rect x="${f(cx)}" y="${f(base - 16)}" width="${w}" height="16" fill="${tint('#8a6a4a', x)}"/><path d="M${pt(cx - 3, base - 16)}L${pt(cx + w / 2, base - 26)}L${pt(cx + w + 3, base - 16)}Z" fill="${tint(tops[i % 4], x)}"/>`; }
    return s;
  },
};
