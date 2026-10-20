// Procedural scenery: layered backgrounds by theme and time of day. Distant
// layers are mixed toward the sky color (atmospheric perspective), so depth
// reads at a glance and characters stay legible in front.
import { defs as makeDefs, document, f, pt, rng } from './svg.js';
import { hex, light, shade, mix, hexToRgb, rgbToHsl } from './color.js';
import { paintFeatures } from './features.js';

export const THEMES = ['meadow', 'forest', 'desert', 'snow', 'cave', 'volcano', 'city', 'castle', 'space', 'ocean', 'jungle', 'haunted', 'factory', 'sky', 'candy'];
export const TIMES = ['day', 'sunset', 'night', 'dawn'];

const W = 384, H = 256;

const SKIES = {
  day: ['#4aa3ff', '#8fd0ff', '#d8f0ff'], sunset: ['#3a2a6a', '#e0607a', '#ffc070'],
  night: ['#070b22', '#18205a', '#33407a'], dawn: ['#5a78c8', '#f0a0b0', '#ffe2b0'],
};
const THEME_SKY = { cave: ['#0b0a12', '#1c1828', '#2a2438'], space: ['#04030c', '#120a30', '#2a1450'], volcano: ['#2a0a0a', '#7a2210', '#e0602a'], haunted: ['#0c0a1e', '#2a2050', '#5a4a7a'], candy: ['#ff9ad0', '#ffc8e8', '#fff0f8'], factory: ['#3a3a48', '#6a6a78', '#a8a0a0'] };
const FOLIAGE = { meadow: '#4a9e3a', forest: '#2a6a34', jungle: '#2a8a3a', snow: '#2a5a48', desert: '#5a9a4a', haunted: '#2a2238', volcano: '#2a1a1a', candy: '#ff6aa8', castle: '#3a6a3a' };
const THEME_LAND = { meadow: '#4fae4a', forest: '#2f7a3a', desert: '#e0a85a', snow: '#e8f0fa', cave: '#3a3048', volcano: '#4a2420', city: '#3a4058', castle: '#5a6078', space: '#3a2a60', ocean: '#2a7ab8', jungle: '#2f8a3a', haunted: '#2a2440', factory: '#4a4a58', sky: '#ffffff', candy: '#ff7ab8' };

/** A horizontal silhouette across the width: sum of seeded sine waves, optionally jagged. */
function ridge(r, base, amp, { jag = false, freq = 1, step = 4 } = {}) {
  const waves = [0, 1, 2].map(i => ({ f: (0.012 + r() * 0.02) * (i + 1) * freq, a: amp / (i + 1.2), p: r() * 7 }));
  let d = `M0 ${H}`;
  for (let x = 0; x <= W; x += step) {
    let y = 0; for (const w of waves) { const s = Math.sin(x * w.f + w.p); y += w.a * (jag ? 1 - Math.abs(s) * 2 : s); }
    d += `L${f(x)} ${f(base - y)}`;
  }
  return d + `L${W} ${H}Z`;
}

function clouds(r, y0, color, n, scale = 1, alpha = 1) {
  let s = '';
  for (let i = 0; i < n; i++) {
    const x = r() * W, y = y0 + r() * 30, w = (24 + r() * 30) * scale;
    s += `<g opacity="${alpha}"><ellipse cx="${f(x)}" cy="${f(y + w * 0.12)}" rx="${f(w)}" ry="${f(w * 0.22)}" fill="${shade(color, 0.08)}"/>`
      + [[-0.45, 0, 0.32], [0, -0.14, 0.42], [0.42, -0.02, 0.3], [0.15, 0.04, 0.3]].map(([dx, dy, rr]) => `<circle cx="${f(x + dx * w)}" cy="${f(y + dy * w)}" r="${f(rr * w)}" fill="${color}"/>`).join('')
      + `<ellipse cx="${f(x - w * 0.1)}" cy="${f(y - w * 0.22)}" rx="${f(w * 0.22)}" ry="${f(w * 0.07)}" fill="#ffffff" opacity=".5"/></g>`;
  }
  return s;
}

function trees(r, baseY, color, kind, n, size, trunk = shade(color, 0.35)) {
  let s = '';
  for (let i = 0; i < n; i++) {
    const x = (i + r() * 0.8) * (W / n), h = size * (0.7 + r() * 0.6), y = baseY + r() * 6;
    if (kind === 'pine') s += `<path d="M${pt(x, y - h)}L${pt(x + h * 0.32, y - h * 0.35)}L${pt(x + h * 0.18, y - h * 0.38)}L${pt(x + h * 0.4, y)}L${pt(x - h * 0.4, y)}L${pt(x - h * 0.18, y - h * 0.38)}L${pt(x - h * 0.32, y - h * 0.35)}Z" fill="${color}"/>`;
    else if (kind === 'palm') s += `<path d="M${pt(x, y)}Q${pt(x + h * 0.15, y - h * 0.5)} ${pt(x + h * 0.05, y - h)}" stroke="${shade(color, 0.2)}" stroke-width="${f(h * 0.08)}" fill="none"/>` + [-1, -0.4, 0.4, 1].map(k => `<path d="M${pt(x + h * 0.05, y - h)}q${f(k * h * 0.3)} ${f(-h * 0.15)} ${f(k * h * 0.5)} ${f(h * 0.15)}" stroke="${color}" stroke-width="${f(h * 0.1)}" fill="none" stroke-linecap="round"/>`).join('');
    else if (kind === 'dead') s += `<path d="M${pt(x, y)}V${f(y - h * 0.7)}M${pt(x, y - h * 0.45)}l${f(h * 0.25)} ${f(-h * 0.25)}M${pt(x, y - h * 0.6)}l${f(-h * 0.22)} ${f(-h * 0.2)}" stroke="${color}" stroke-width="${f(h * 0.07)}" stroke-linecap="round" fill="none"/>`;
    else if (kind === 'cactus') s += `<path d="M${pt(x, y)}V${f(y - h * 0.8)}M${pt(x, y - h * 0.4)}h${f(-h * 0.2)}v${f(-h * 0.2)}M${pt(x, y - h * 0.5)}h${f(h * 0.2)}v${f(-h * 0.22)}" stroke="${color}" stroke-width="${f(h * 0.14)}" stroke-linecap="round" fill="none"/>`;
    else if (kind === 'lollipop') s += `<path d="M${pt(x, y)}V${f(y - h * 0.6)}" stroke="#ffffff" stroke-width="${f(h * 0.06)}"/><circle cx="${f(x)}" cy="${f(y - h * 0.7)}" r="${f(h * 0.25)}" fill="${color}"/>`;
    else s += `<path d="M${pt(x, y)}V${f(y - h * 0.45)}" stroke="${trunk}" stroke-width="${f(h * 0.1)}"/><circle cx="${f(x)}" cy="${f(y - h * 0.6)}" r="${f(h * 0.3)}" fill="${color}"/><circle cx="${f(x - h * 0.15)}" cy="${f(y - h * 0.5)}" r="${f(h * 0.22)}" fill="${color}"/><circle cx="${f(x + h * 0.16)}" cy="${f(y - h * 0.48)}" r="${f(h * 0.2)}" fill="${color}"/><circle cx="${f(x - h * 0.06)}" cy="${f(y - h * 0.72)}" r="${f(h * 0.12)}" fill="${light(color, 0.15)}"/>`;
  }
  return s;
}

function skyline(r, baseY, color, lit, n) {
  let s = '', x = -4;
  while (x < W) {
    const w = 14 + r() * 22, h = 30 + r() * 70;
    s += `<rect x="${f(x)}" y="${f(baseY - h)}" width="${f(w)}" height="${f(h + 60)}" fill="${color}"/>`;
    if (r() < 0.3) s += `<rect x="${f(x + w * 0.4)}" y="${f(baseY - h - 10)}" width="2" height="10" fill="${color}"/>`;
    if (lit) for (let wy = baseY - h + 5; wy < baseY - 4; wy += 7) for (let wx = x + 3; wx < x + w - 4; wx += 5) if (r() < 0.35) s += `<rect x="${f(wx)}" y="${f(wy)}" width="2.2" height="3" fill="${lit}" opacity="${f(0.5 + r() * 0.5)}"/>`;
    x += w + 1 + r() * 4;
  }
  return s;
}

/**
 * Paint a background. opts.theme ∈ THEMES, opts.time ∈ TIMES; colors optional.
 * Returns a standalone SVG string (natural size 1536×1024, or 384×256 for pixel style).
 */
export function paintScenery(input = {}, { pixel = false, seed = 'scenery' } = {}) {
  const theme = THEMES.includes(input.theme) ? input.theme : 'meadow';
  let time = TIMES.includes(input.time) ? input.time : 'day';
  if (theme === 'space' || theme === 'cave') time = 'night';
  const r = rng(`${seed}|${theme}|${time}`), d = makeDefs('s');
  const sky = input.sky?.length === 3 ? input.sky.map((c, i) => hex(c, SKIES[time][i])) : (THEME_SKY[theme] || SKIES[time]);
  // Land must read as land: reject a land color whose hue sits on the sky's (blue hills under a blue sky).
  const hsl = c => rgbToHsl(hexToRgb(c));
  const [lh, ls] = hsl(hex(input.land, THEME_LAND[theme])), [sh, ss] = hsl(sky[1]);
  const hueGap = Math.min(Math.abs(lh - sh), 360 - Math.abs(lh - sh));
  const land = input.land && !(hueGap < 35 && ls > 0.25 && ss > 0.25 && !['ocean', 'sky', 'space', 'snow'].includes(theme)) ? hex(input.land, THEME_LAND[theme]) : THEME_LAND[theme];
  const foliage = FOLIAGE[theme] || land;
  const haze = sky[2];
  const far = (k) => mix(land, haze, k); // atmospheric perspective
  const farFoliage = (k) => mix(foliage, haze, k);
  const out = [`<rect width="${W}" height="${H}" fill="${d.linear([[0, sky[0]], [0.55, sky[1]], [1, sky[2]]])}"/>`];
  const night = time === 'night';

  // Stars, sun or moon.
  if (night || theme === 'space') for (let i = 0; i < 90; i++) { const s = r() < 0.1 ? 1.4 : 0.7; out.push(`<circle cx="${f(r() * W)}" cy="${f(r() * H * 0.7)}" r="${f(s * (0.5 + r() * 0.6))}" fill="#ffffff" opacity="${f(0.4 + r() * 0.6)}"/>`); }
  if (theme === 'space') {
    out.push(`<ellipse cx="${f(W * 0.3)}" cy="${f(H * 0.35)}" rx="140" ry="60" fill="${d.radial([[0, '#b05aff', 0.45], [1, '#b05aff', 0]])}"/><ellipse cx="${f(W * 0.75)}" cy="${f(H * 0.55)}" rx="120" ry="70" fill="${d.radial([[0, '#3ad0ff', 0.3], [1, '#3ad0ff', 0]])}"/>`);
    out.push(`<circle cx="300" cy="70" r="34" fill="${d.cel('#e8a05a', { soft: true })}"/><ellipse cx="300" cy="70" rx="56" ry="10" fill="none" stroke="#ffe0b0" stroke-width="3" opacity=".7" transform="rotate(-15 300 70)"/><circle cx="70" cy="190" r="16" fill="${d.cel('#5ab0e8', { soft: true })}"/>`);
  } else if (theme !== 'cave') {
    const sx = time === 'sunset' ? W * 0.72 : time === 'dawn' ? W * 0.22 : W * 0.78, sy = time === 'sunset' || time === 'dawn' ? H * 0.52 : H * 0.18;
    const sc = night ? '#f4f0dc' : time === 'day' ? '#fff6c8' : '#ffd890';
    out.push(`<circle cx="${f(sx)}" cy="${f(sy)}" r="${night ? 60 : 90}" fill="${d.radial([[0, sc, night ? 0.25 : 0.55], [1, sc, 0]])}"/><circle cx="${f(sx)}" cy="${f(sy)}" r="${night ? 14 : 20}" fill="${sc}"/>`);
    if (night) out.push(`<circle cx="${f(sx + 5)}" cy="${f(sy - 3)}" r="12" fill="${sky[1]}" opacity=".35"/>`);
  }

  // Far layer.
  const cloudColor = night ? '#4a5590' : time === 'sunset' ? '#ffb0a0' : time === 'dawn' ? '#ffe0e8' : '#ffffff';
  if (!['cave', 'space'].includes(theme)) out.push(clouds(r, H * 0.12, mix(cloudColor, haze, 0.2), 4, 1.1, 0.8));
  if (theme === 'city' || theme === 'factory') out.push(skyline(r, H * 0.66, far(0.62), night ? '#ffe28a' : null, 0), skyline(r, H * 0.78, far(0.38), night ? '#ffd060' : null, 0));
  else if (theme === 'castle' || theme === 'haunted') {
    out.push(`<path d="${ridge(r, H * 0.62, 18, { jag: true })}" fill="${far(0.7)}"/>`);
    const cx = W * 0.62, cy = H * 0.5, c = far(0.5);
    out.push(`<path d="M${cx - 50} ${H}V${cy}h10v-8h8v8h10v-30h-4l10-16l10 16h-4v30h10v-8h8v8h10V${H}Z" fill="${c}"/><rect x="${cx - 6}" y="${cy - 6}" width="5" height="8" fill="${night ? '#ffd060' : shade(c, 0.2)}"/>`);
  } else if (theme === 'desert') {
    out.push(`<path d="M40 ${H}L60 ${f(H * 0.5)}H120L140 ${H}Z" fill="${far(0.6)}"/><path d="M250 ${H}L262 ${f(H * 0.56)}H300L312 ${H}Z" fill="${far(0.6)}"/>`, `<path d="${ridge(r, H * 0.72, 10)}" fill="${far(0.45)}"/>`);
  } else if (theme === 'volcano') {
    out.push(`<path d="M120 ${H}L196 ${f(H * 0.32)}H218L300 ${H}Z" fill="${far(0.45)}"/><path d="M196 ${f(H * 0.32)}H218L214 ${f(H * 0.4)}H200Z" fill="#ff7a1a"/><ellipse cx="207" cy="${f(H * 0.22)}" rx="40" ry="18" fill="#5a3a3a" opacity=".6"/><ellipse cx="225" cy="${f(H * 0.12)}" rx="50" ry="20" fill="#4a2a2a" opacity=".45"/>`);
  } else if (theme === 'cave') {
    let st = ''; for (let x = 0; x < W; x += 14 + r() * 18) { const h = 20 + r() * 50; st += `<path d="M${f(x)} 0L${f(x + 6 + r() * 6)} ${f(h)}L${f(x + 14 + r() * 8)} 0Z" fill="${far(0.3)}"/>`; }
    out.push(st, `<path d="${ridge(r, H * 0.7, 20, { jag: true })}" fill="${far(0.55)}"/>`);
    for (let i = 0; i < 6; i++) { const x = r() * W, y = H * 0.6 + r() * 60, c = i % 2 ? '#7ad7ff' : '#c06cff'; out.push(`<circle cx="${f(x)}" cy="${f(y)}" r="22" fill="${d.radial([[0, c, 0.45], [1, c, 0]])}"/><path d="M${f(x - 4)} ${f(y + 6)}L${f(x)} ${f(y - 10)}L${f(x + 4)} ${f(y + 6)}Z" fill="${c}"/>`); }
  } else if (theme === 'ocean' || theme === 'sky') {
    if (theme === 'ocean') out.push(`<rect y="${f(H * 0.62)}" width="${W}" height="${f(H * 0.38)}" fill="${d.linear([[0, far(0.35)], [1, shade(land, 0.3)]])}"/>` + Array.from({ length: 10 }, () => `<path d="M${f(r() * W)} ${f(H * 0.66 + r() * 70)}h${f(10 + r() * 20)}" stroke="#ffffff" stroke-width="1.2" opacity=".5"/>`).join(''));
    else out.push(clouds(r, H * 0.62, '#ffffff', 6, 1.8, 1));
  } else if (theme !== 'space') {
    // Mountains; snowy themes get caps on the highest peaks.
    const caps = theme === 'snow' || theme === 'meadow';
    out.push(`<path d="${ridge(r, H * 0.5, 30, { jag: caps })}" fill="${caps ? d.linear([[0, mix('#ffffff', haze, 0.3)], [0.16, mix('#ffffff', haze, 0.3)], [0.17, far(0.7)], [1, far(0.7)]]) : far(0.7)}"/>`);
  }

  // Mid and near layers.
  if (!['cave', 'space', 'ocean', 'sky', 'city', 'factory'].includes(theme)) {
    out.push(`<path d="${ridge(r, H * 0.66, 14)}" fill="${far(0.45)}"/>`);
    const treeKind = { snow: 'pine', forest: 'pine', desert: 'cactus', haunted: 'dead', jungle: 'palm', candy: 'lollipop', volcano: 'dead' }[theme] || 'round';
    out.push(trees(r, H * 0.7, farFoliage(0.42), treeKind, 9, 34, mix('#5a3a22', haze, 0.45)));
    out.push(`<path d="${ridge(r, H * 0.8, 8)}" fill="${far(0.22)}"/>`);
    out.push(trees(r, H * 0.84, farFoliage(0.18), treeKind, 6, 46, mix('#5a3a22', haze, 0.2)));
  }
  if (theme === 'city' || theme === 'factory') out.push(`<rect y="${f(H * 0.86)}" width="${W}" height="${f(H * 0.14)}" fill="${far(0.2)}"/>`);
  out.push(clouds(r, H * 0.28, mix(cloudColor, haze, 0.05), 3, 0.8, theme === 'cave' || theme === 'space' ? 0 : 0.95));
  // Composed features ("leafy forest, dense", "street") on top of the theme's own layers.
  if (Array.isArray(input.features) && input.features.length) out.push(paintFeatures(input.features, { r: rng(`${seed}|features`), haze, night, land, foliage, d }));
  // A soft vignette keeps edges calm.
  out.push(`<rect width="${W}" height="${H}" fill="${d.radial([[0.6, '#000000', 0], [1, '#000000', 0.28]], { r: 0.75 })}"/>`);
  const scale = pixel ? 1 : 4;
  return document({ width: W * scale, height: H * scale, viewBox: `0 0 ${W} ${H}`, defs: d.toString(), body: out.join(''), crisp: false });
}
