// Parallax backdrops: layered, seeded silhouette patterns that scroll with the
// camera at their depth, crossfade by zone and animate (drifting spores,
// flickering lanterns, caustics, rising sparks, twinkling stars, void swirls),
// plus the painted v2/art scenery with its live ambient features. Static
// silhouettes are cached as strips; animated parts draw live.
import { TAU, rgba, mix, light, shade, col, hash, rng, seedOf, surface, ctx2d, lerp, damp } from './flat-util.js';
import { sceneryImage, themeFor } from './flat-art.js';
import { createAmbient } from '../../art/ambient.js';
import { landOf } from '../../art/scenery.js';

export const PATTERNS = ['sky', 'scenery', 'mountains', 'hills', 'forest', 'city', 'clouds', 'stars', 'cave', 'rafters', 'lanterns', 'roots', 'spores', 'arches', 'caustics', 'pipes', 'sparks', 'pipes_organ', 'thorns', 'columns', 'shelves', 'void', 'ruins', 'waves', 'dunes', 'bubbles', 'grid', 'gradient'];
const STRIP = 512;
const strips = new Map();

/** A cached static strip (STRIP px wide, h tall) for a silhouette pattern. */
function strip(pattern, color, h, seed) {
  const key = `${pattern}|${color}|${Math.round(h)}|${seed}`;
  if (strips.has(key)) return strips.get(key);
  const c = surface(STRIP, h), g = ctx2d(c);
  if (g) paintStrip(g, pattern, col(color, '#22202c'), STRIP, h, rng(seedOf(key)));
  if (strips.size > 120) strips.clear();
  strips.set(key, g ? c : null);
  return g ? c : null;
}
function ridge(g, r, w, h, base, amp, jag, color) {
  g.fillStyle = color; g.beginPath(); g.moveTo(0, h);
  const n = 16, ys = Array.from({ length: n }, () => base - r() * amp);
  ys.push(ys[0]); // periodic so the strip tiles
  for (let i = 0; i <= n; i++) { const x = (i / n) * w; if (jag) g.lineTo(x, ys[i]); else { const px = ((i - 0.5) / n) * w; i ? g.quadraticCurveTo(px, ys[i - 1], (x + px) / 2 + w / n / 4, (ys[i] + ys[i - 1]) / 2) : g.lineTo(x, ys[i]); } }
  g.lineTo(w, ys[n]); g.lineTo(w, h); g.closePath(); g.fill();
}
function paintStrip(g, pattern, c, w, h, r) {
  const dark = shade(c, 0.25), lite = light(c, 0.12);
  g.fillStyle = c; g.strokeStyle = c;
  switch (pattern) {
    case 'mountains': ridge(g, r, w, h, h * 0.55, h * 0.3, true, c); g.globalAlpha = 0.35; ridge(g, r, w, h, h * 0.42, h * 0.08, true, lite); g.globalAlpha = 1; ridge(g, r, w, h, h * 0.7, h * 0.12, true, c); break;
    case 'hills': ridge(g, r, w, h, h * 0.7, h * 0.18, false, c); break;
    case 'forest': {
      ridge(g, r, w, h, h * 0.86, h * 0.04, false, c);
      for (let x = -10; x < w + 10; x += 10 + r() * 18) { const th = h * (0.18 + r() * 0.2), base = h * 0.88; if (r() < 0.6) { g.beginPath(); g.moveTo(x, base - th); g.lineTo(x + th * 0.32, base); g.lineTo(x - th * 0.32, base); g.fill(); } else { g.beginPath(); g.arc(x, base - th * 0.6, th * 0.35, 0, TAU); g.fill(); g.fillRect(x - 2, base - th * 0.4, 4, th * 0.4); } }
      break;
    }
    case 'city': {
      for (let x = 0; x < w;) { const bw = 18 + r() * 34, bh = h * (0.18 + r() * 0.45); g.fillStyle = c; g.fillRect(x, h - bh, bw, bh); if (r() < 0.3) g.fillRect(x + bw * 0.45, h - bh - 12, 3, 12); g.fillStyle = rgba(light(c, 0.5), 0.45); for (let y = h - bh + 6; y < h - 6; y += 9) for (let wx = x + 4; wx < x + bw - 5; wx += 7) if (r() < 0.35) g.fillRect(wx, y, 3, 4); x += bw + 2 + r() * 6; }
      break;
    }
    case 'cave': {
      for (let x = 0; x < w; x += 14 + r() * 22) { const len = h * (0.08 + r() * 0.22); g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 8 + r() * 8, len); g.lineTo(x + 18 + r() * 10, 0); g.fill(); }
      ridge(g, r, w, h, h * 0.86, h * 0.1, true, c);
      break;
    }
    case 'rafters': {
      const by = h * 0.16, bh = Math.max(6, h * 0.035);
      g.fillRect(0, by, w, bh); g.fillRect(0, by + h * 0.22, w, bh * 0.7);
      for (let x = 0; x < w; x += 128) { g.fillRect(x + 6, 0, bh * 1.2, by + h * 0.24); g.save(); g.translate(x + 6, by + bh); g.rotate(0.75); g.fillRect(0, 0, h * 0.24, bh * 0.6); g.restore(); g.save(); g.translate(x + 70, by + bh); g.rotate(2.4); g.fillRect(0, 0, h * 0.2, bh * 0.6); g.restore(); }
      g.fillStyle = lite; g.globalAlpha = 0.3; g.fillRect(0, by, w, 2); g.globalAlpha = 1;
      break;
    }
    case 'roots': {
      g.lineCap = 'round';
      for (let x = 0; x < w; x += 10 + r() * 16) { let px = x, py = 0; const len = h * (0.12 + r() * 0.4); g.lineWidth = 2 + r() * 5; g.beginPath(); g.moveTo(px, py); for (let k = 0; k < 6; k++) { px += (r() - 0.5) * 14; py += len / 6; g.lineTo(px, py); } g.stroke(); }
      ridge(g, r, w, h, h * 0.06, h * 0.04, false, c);
      g.save(); g.scale(1, -1); g.translate(0, -h); ridge(g, r, w, h, h * 0.9, h * 0.06, false, c); g.restore();
      break;
    }
    case 'arches': {
      const aw = 128, top = h * 0.18;
      g.fillRect(0, 0, w, top);
      for (let x = 0; x < w; x += aw) { g.fillRect(x, top, aw * 0.18, h); g.beginPath(); g.moveTo(x + aw * 0.18, top); g.lineTo(x + aw * 0.18, top + aw * 0.4); g.arc(x + aw * 0.59, top + aw * 0.4, aw * 0.41, Math.PI, 0); g.lineTo(x + aw, top); g.closePath(); g.fill(); g.fillStyle = lite; g.globalAlpha = 0.18; g.fillRect(x + 2, top, 2, h); g.globalAlpha = 1; g.fillStyle = c; }
      break;
    }
    case 'pipes': {
      g.lineCap = 'butt';
      for (const y of [h * 0.22, h * 0.31, h * 0.74]) { g.fillStyle = c; g.fillRect(0, y, w, 10); g.fillStyle = lite; g.globalAlpha = 0.25; g.fillRect(0, y + 1, w, 2); g.globalAlpha = 1; for (let x = 20 + r() * 40; x < w; x += 70 + r() * 60) { g.fillStyle = dark; g.fillRect(x, y - 3, 8, 16); } }
      for (let x = 30; x < w; x += 110 + r() * 60) { g.fillStyle = c; g.fillRect(x, 0, 12, h); g.fillStyle = dark; g.fillRect(x - 3, h * (0.3 + r() * 0.4), 18, 8); }
      break;
    }
    case 'pipes_organ': {
      let x = 0; const cnt = 22;
      for (let i = 0; i < cnt; i++) { const pw = w / cnt - 3, ph = h * (0.3 + 0.45 * (0.5 + 0.5 * Math.sin((i / cnt) * TAU * 2))), y = h - ph; g.fillStyle = c; g.fillRect(x, y, pw, ph); g.beginPath(); g.ellipse(x + pw / 2, y, pw / 2, 4, 0, 0, TAU); g.fill(); g.fillStyle = dark; g.fillRect(x + pw * 0.2, y + 10, pw * 0.6, 6); g.fillStyle = lite; g.globalAlpha = 0.25; g.fillRect(x + 2, y, 2, ph); g.globalAlpha = 1; x += pw + 3; }
      break;
    }
    case 'thorns': {
      g.lineCap = 'round';
      for (let k = 0; k < 7; k++) { let x = r() * w, y = h; g.lineWidth = 3 + r() * 4; g.beginPath(); g.moveTo(x, y); for (let s = 0; s < 8; s++) { x += (r() - 0.5) * 40; y -= h * 0.06 + r() * h * 0.04; g.lineTo(x, y); g.save(); g.translate(x, y); g.rotate(r() * TAU); g.fillRect(0, -1, 8, 2); g.restore(); } g.stroke(); }
      ridge(g, r, w, h, h * 0.9, h * 0.05, true, c);
      break;
    }
    case 'columns': {
      for (let x = 20; x < w; x += 128) { const cw = 26; g.fillRect(x, h * 0.12, cw, h); g.fillRect(x - 6, h * 0.1, cw + 12, 10); g.fillRect(x - 6, h * 0.86, cw + 12, 12); g.fillStyle = dark; for (let k = 1; k < 4; k++) g.fillRect(x + (cw * k) / 4, h * 0.14, 2, h * 0.7); g.fillStyle = c; }
      g.fillRect(0, h * 0.06, w, h * 0.05);
      break;
    }
    case 'shelves': {
      const sh = h / 6;
      for (let row = 1; row < 6; row++) { const y = row * sh; g.fillStyle = c; g.fillRect(0, y, w, 6); for (let x = 2; x < w - 8;) { const bw = 4 + r() * 6, bh = sh * (0.45 + r() * 0.4); g.fillStyle = r() < 0.5 ? c : r() < 0.5 ? dark : lite; g.fillRect(x, y - bh, bw, bh); x += bw + (r() < 0.12 ? 10 : 1); } }
      for (let x = 0; x < w; x += 128) { g.fillStyle = c; g.fillRect(x, 0, 8, h); }
      break;
    }
    case 'ruins': for (let x = 10; x < w; x += 60 + r() * 60) { const hh = h * (0.15 + r() * 0.35); g.fillRect(x, h - hh, 16 + r() * 18, hh); if (r() < 0.5) g.fillRect(x - 10, h - hh, 46, 8); } ridge(g, r, w, h, h * 0.94, h * 0.03, false, c); break;
    case 'dunes': ridge(g, r, w, h, h * 0.72, h * 0.12, false, c); ridge(g, r, w, h, h * 0.84, h * 0.08, false, shade(c, 0.1)); break;
    case 'waves': for (let k = 0; k < 4; k++) { const y = h * (0.62 + k * 0.1); g.fillStyle = k ? shade(c, k * 0.08) : c; g.beginPath(); g.moveTo(0, h); for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin((x / w) * TAU * 4 + k) * 4); g.lineTo(w, h); g.closePath(); g.fill(); } break;
    case 'clouds': g.fillStyle = rgba(c, 0.85); for (let k = 0; k < 6; k++) { const x = r() * w, y = h * (0.08 + r() * 0.35), s = 20 + r() * 30; for (const [dx, dy, rr] of [[-0.7, 0, 0.55], [0, -0.3, 0.7], [0.7, 0, 0.55], [0.2, 0.15, 0.6]]) { g.beginPath(); g.arc(x + dx * s, y + dy * s, rr * s, 0, TAU); g.fill(); g.beginPath(); g.arc(x + dx * s - w, y + dy * s, rr * s, 0, TAU); g.fill(); g.beginPath(); g.arc(x + dx * s + w, y + dy * s, rr * s, 0, TAU); g.fill(); } } break;
    default: break;
  }
}

// Live (animated) parts of patterns, drawn in screen space at a scroll offset.
const LIVE = {
  stars(g, L, F, ox, oy) { const r = rng(seedOf(L.key)); for (let i = 0; i < 90; i++) { const x = ((r() * F.w * 2 + ox * 0.3) % F.w + F.w) % F.w, y = r() * F.h * 0.8, tw = 0.5 + 0.5 * Math.sin(F.t * (1 + r() * 2) + i); g.fillStyle = rgba(L.colorLite, 0.25 + tw * 0.7); g.fillRect(x, y + oy * 0.2, r() < 0.1 ? 2 : 1, r() < 0.1 ? 2 : 1); } },
  lanterns(g, L, F, ox) {
    const step = 220, n = Math.ceil(F.w / step) + 2, start = Math.floor(-ox / step) - 1;
    for (let k = start; k < start + n; k++) {
      const x = k * step + ox + hash(k) * 80, len = F.h * (0.12 + hash(k * 7) * 0.25), sway = Math.sin(F.t * 0.8 + k) * 4, y = len;
      g.strokeStyle = rgba(L.color, 0.9); g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + sway, y); g.stroke();
      const fl = 0.75 + 0.25 * Math.sin(F.t * 9 + k * 3) * Math.sin(F.t * 3.3 + k);
      const gr = g.createRadialGradient ? g.createRadialGradient(x + sway, y + 8, 0, x + sway, y + 8, 60) : null;
      if (gr) { gr.addColorStop(0, rgba('#ffc870', 0.35 * fl)); gr.addColorStop(1, rgba('#ffc870', 0)); g.fillStyle = gr; g.fillRect(x + sway - 60, y - 52, 120, 120); }
      g.fillStyle = L.color; g.fillRect(x + sway - 6, y, 12, 4); g.fillStyle = rgba('#ffd890', 0.55 + 0.4 * fl); g.fillRect(x + sway - 5, y + 4, 10, 12); g.fillStyle = L.color; g.fillRect(x + sway - 6, y + 16, 12, 3);
    }
  },
  spores(g, L, F, ox, oy) { const r = rng(seedOf(L.key)); g.save(); g.globalCompositeOperation = 'lighter'; for (let i = 0; i < 40; i++) { const sp = 8 + r() * 14, x = ((r() * F.w + ox + Math.sin(F.t * 0.7 + i) * 18) % F.w + F.w) % F.w, y = (((r() * F.h - F.t * sp + oy) % F.h) + F.h) % F.h, a = 0.35 + 0.35 * Math.sin(F.t * 2 + i); g.fillStyle = rgba(L.colorLite, a); g.beginPath(); g.arc(x, y, 1 + r() * 2.2, 0, TAU); g.fill(); } g.restore(); },
  sparks(g, L, F, ox, oy) { const r = rng(seedOf(L.key)); g.save(); g.globalCompositeOperation = 'lighter'; for (let i = 0; i < 46; i++) { const sp = 30 + r() * 60, x = ((r() * F.w + ox + Math.sin(F.t * 2 + i) * 10) % F.w + F.w) % F.w, y = F.h - ((((r() * F.h + F.t * sp - oy) % F.h) + F.h) % F.h), life = y / F.h; g.fillStyle = rgba(mix('#ffd070', L.color, 0.3), life * 0.9); g.fillRect(x, y, 2, 2 + (1 - life) * 2); } g.restore(); },
  caustics(g, L, F, ox, oy) { g.save(); g.globalCompositeOperation = 'lighter'; g.strokeStyle = rgba(L.colorLite, 0.12); g.lineWidth = 3; for (let k = 0; k < 9; k++) { g.beginPath(); for (let x = -20; x <= F.w + 20; x += 20) { const y = F.h * (0.1 + k * 0.1) + Math.sin(x * 0.02 + F.t * 1.3 + k) * 14 + Math.sin(x * 0.05 - F.t * 0.9) * 6 + oy * 0.2; x === -20 ? g.moveTo(x + (ox % 20), y) : g.lineTo(x + (ox % 20), y); } g.stroke(); } g.restore(); },
  void(g, L, F, ox, oy) { g.save(); g.globalCompositeOperation = 'lighter'; for (let k = 0; k < 5; k++) { const a = F.t * 0.05 * (k % 2 ? 1 : -1) + k, x = F.w * (0.5 + Math.cos(a) * 0.35) + ox * 0.1, y = F.h * (0.5 + Math.sin(a * 1.3) * 0.3) + oy * 0.1, rr = F.h * (0.25 + 0.1 * Math.sin(F.t * 0.3 + k)); if (!g.createRadialGradient) continue; const gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, rgba(k % 2 ? '#7a2ad8' : '#2a1a6a', 0.14)); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2); } g.restore(); },
  bubbles(g, L, F, ox, oy) { const r = rng(seedOf(L.key)); g.strokeStyle = rgba(L.colorLite, 0.5); g.lineWidth = 1; for (let i = 0; i < 30; i++) { const sp = 14 + r() * 20, x = ((r() * F.w + ox + Math.sin(F.t * 1.6 + i) * 5) % F.w + F.w) % F.w, y = F.h - ((((r() * F.h + F.t * sp - oy) % F.h) + F.h) % F.h); g.beginPath(); g.arc(x, y, 1.5 + r() * 3, 0, TAU); g.stroke(); } },
  grid(g, L, F, ox, oy) { g.strokeStyle = rgba(L.colorLite, 0.18); g.lineWidth = 1; const s = 48; for (let x = ((ox % s) + s) % s; x < F.w; x += s) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, F.h); g.stroke(); } for (let y = ((oy % s) + s) % s; y < F.h; y += s) { g.beginPath(); g.moveTo(0, y); g.lineTo(F.w, y); g.stroke(); } },
};

/** Normalized layer list for a zone set: [{ key, zone, depth, pattern, color, drift, fogColor }]. */
export function normalizeLayers(list = []) {
  return list.map((l, i) => ({ key: `${l.zone || '*'}|${i}|${l.pattern}`, zone: l.zone || null, depth: l.depth ?? 0.4, pattern: PATTERNS.includes(l.pattern) ? l.pattern : 'hills', color: col(l.color, '#2a2838'), colorLite: light(col(l.color, '#2a2838'), 0.45), drift: l.drift || 0, fogColor: l.fogColor ? col(l.fogColor) : null, features: l.features || null, theme: l.theme || null, alpha: l.zone ? 0 : 1 }));
}

/** Draw a backdrop for frame F from normalized layers; mutates layer alphas for zone crossfades. */
export function drawBackdrop(F, layers, { base = null } = {}) {
  const g = F.ctx, zone = F.zone;
  const k = damp(0.06, F.realDt || 1 / 60);
  for (const L of layers) L.alpha = lerp(L.alpha, !L.zone || L.zone === zone ? 1 : 0, k);
  const shown = layers.filter(L => L.alpha > 0.01).sort((a, b) => a.depth - b.depth);
  // Base gradient from the farthest visible layer (or the given base color).
  const far = shown[0], top = base || (far ? (far.pattern === 'sky' ? far.color : shade(far.color, 0.35)) : '#16141e');
  if (g.createLinearGradient) { const gr = g.createLinearGradient(0, 0, 0, F.h); gr.addColorStop(0, shade(top, 0.25)); gr.addColorStop(1, light(top, 0.1)); g.fillStyle = gr; } else g.fillStyle = top;
  g.fillRect(0, 0, F.w, F.h);
  const camX = F.cam.x * F.unit, camY = F.cam.y * F.unit;
  for (const L of shown) {
    g.save(); g.globalAlpha = L.alpha;
    const ox = -camX * L.depth - F.t * L.drift * F.unit * 4, oy = camY * L.depth * 0.5;
    if (L.pattern === 'sky' || L.pattern === 'gradient') {
      if (g.createLinearGradient) { const gr = g.createLinearGradient(0, 0, 0, F.h); gr.addColorStop(0, L.color); gr.addColorStop(1, L.fogColor || light(L.color, 0.35)); g.fillStyle = gr; } else g.fillStyle = L.color;
      g.fillRect(0, 0, F.w, F.h);
      if (L.pattern === 'sky') { const s = strip('clouds', light(L.color, 0.5), F.h, L.key); if (s) tile(g, s, ox * 0.5, 0, F.w); }
    } else if (L.pattern === 'scenery') drawScenery(F, L, ox, oy);
    else if (LIVE[L.pattern]) LIVE[L.pattern](g, L, F, ox, oy);
    else { const s = strip(L.pattern, L.color, F.h, L.key); if (s) tile(g, s, ox, oy * 0.6, F.w); }
    if (L.fogColor && L.pattern !== 'sky') { if (g.createLinearGradient) { const gr = g.createLinearGradient(0, F.h * 0.4, 0, F.h); gr.addColorStop(0, rgba(L.fogColor, 0)); gr.addColorStop(1, rgba(L.fogColor, 0.35 * (1 - L.depth))); g.fillStyle = gr; g.fillRect(0, 0, F.w, F.h); } }
    g.restore();
  }
}
function tile(g, s, ox, oy, w) {
  const x0 = ((ox % STRIP) + STRIP) % STRIP - STRIP;
  for (let x = x0; x < w; x += STRIP) g.drawImage(s, Math.floor(x), Math.round(oy));
}
const ambients = new Map();
const SEAM_BLEND = 0.22;
const seamlessCache = new WeakMap();
/** A copy of an image whose left SEAM_BLEND fades in from transparent (null without an offscreen canvas). */
function seamless(src) {
  if (seamlessCache.has(src)) return seamlessCache.get(src);
  const W = src.naturalWidth || src.width, H = src.naturalHeight || src.height;
  if (!W || !H) return null; // not decoded yet: draw the plain image this frame and try again on the next
  let out = null;
  const c = surface(W, H), g = ctx2d(c);
  if (g && g.createLinearGradient) {
    g.drawImage(src, 0, 0, W, H);
    const gr = g.createLinearGradient(0, 0, W * SEAM_BLEND, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-in'; g.fillStyle = gr; g.fillRect(0, 0, W, H);
    out = c;
  }
  seamlessCache.set(src, out);
  return out;
}
function drawScenery(F, L, ox, oy) {
  const theme = L.theme || themeFor(F.doc, F.stage?.space); if (!theme) return; // a space that declares no scenery shows none
  const night = ['cave', 'space', 'haunted'].includes(theme);
  const img = sceneryImage({ theme, time: night ? 'night' : 'day', features: L.features || [] }, F.style === 'pixel', F.doc.id);
  const g = F.ctx, h = F.h * 1.08, w = h * 1.5;
  if (img) {
    // The painted scenery is not periodic, so butting copies together leaves a hard seam where its right edge
    // meets its left. Copies overlap by SEAM_BLEND of their width instead, and each copy's overlapping left
    // edge fades in over the previous copy's right edge, so clouds and ridges crossfade across the join.
    const faded = seamless(img.img), period = w * (faded ? 1 - SEAM_BLEND : 1);
    const p = ox * 0.5, y = F.h - h + oy * 0.2, ww = Math.ceil(w) + 1;
    for (let k = Math.floor(-p / period) - (faded ? 1 : 0); p + k * period < F.w; k++) g.drawImage(faded || img.img, Math.floor(p + k * period), y, ww, h);
  }
  const key = `${theme}|${JSON.stringify(L.features || [])}`;
  if (!ambients.has(key)) ambients.set(key, createAmbient(L.features?.length ? L.features : defaultFeatures(theme), { seed: F.doc.id, night }));
  const amb = ambients.get(key);
  if (amb) amb(g, { x: 0, y: 0, w: F.w, h: F.h }, F.t, { reduced: F.reduced, parallax: ox });
}
export function defaultFeatures(theme) {
  return { meadow: [{ kind: 'drifting-clouds', density: 0.4, depth: 'far' }, { kind: 'birds', density: 0.3, depth: 'far' }], forest: [{ kind: 'falling-leaves', density: 0.4, depth: 'near' }], snow: [{ kind: 'snow', density: 0.5, depth: 'near' }], volcano: [{ kind: 'embers', density: 0.6, depth: 'near' }], cave: [{ kind: 'embers', density: 0.15, depth: 'mid' }], city: [{ kind: 'drifting-clouds', density: 0.3, depth: 'far' }], haunted: [{ kind: 'fog', density: 0.5, depth: 'mid' }, { kind: 'fireflies', density: 0.3, depth: 'near' }], ocean: [{ kind: 'birds', density: 0.4, depth: 'far' }], jungle: [{ kind: 'fireflies', density: 0.3, depth: 'near' }, { kind: 'falling-leaves', density: 0.2, depth: 'near' }], space: [], sky: [{ kind: 'drifting-clouds', density: 0.7, depth: 'mid' }], desert: [], castle: [{ kind: 'birds', density: 0.2, depth: 'far' }], factory: [{ kind: 'embers', density: 0.2, depth: 'mid' }], candy: [{ kind: 'bubbles', density: 0.4, depth: 'near' }] }[theme] || [];
}

/**
 * Layers a space gets with no background primitive: its declared scenery (engine/spaces2d-scenery.js) painted, plus two
 * seeded silhouettes; none when the space declares no scenery (the plain base the backdrop always draws).
 */
export function defaultLayers(doc, kind = 'side', spaceId = null) {
  const theme = themeFor(doc, spaceId);
  if (!theme) return [];
  if (kind !== 'side') return normalizeLayers([{ pattern: 'gradient', depth: 0, color: shade(landOf(theme), 0.55), fogColor: null }]);
  const dark = ['cave', 'haunted', 'space', 'volcano'].includes(theme);
  return normalizeLayers([
    { pattern: 'scenery', depth: 0.08, color: '#000000', theme },
    ...(dark ? [{ pattern: theme === 'cave' ? 'cave' : 'ruins', depth: 0.35, color: theme === 'cave' ? '#1c1828' : '#1a1420' }] : [{ pattern: theme === 'city' ? 'city' : theme === 'desert' ? 'dunes' : theme === 'ocean' ? 'waves' : theme === 'forest' || theme === 'jungle' ? 'forest' : 'hills', depth: 0.3, color: { desert: '#b08048', snow: '#8aa0b8', city: '#3a4058', ocean: '#2a6a8a', forest: '#24502e', jungle: '#2a6a34', castle: '#4a5a6a', candy: '#d0609a', sky: '#9ab8e0', factory: '#3a3a44' }[theme] || '#5a8a6a', fogColor: '#c8dcf0', depth: 0.3 }].map(l => ({ ...l, color: mix(l.color, '#b8d0e0', 0.3) }))),
  ]);
}
