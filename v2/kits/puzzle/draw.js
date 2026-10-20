// Canvas drawing primitives for the puzzle kit: glossy beveled blocks (cached
// per color and size), gems, blobs, viruses, capsules, tiles, panels and text.
// Everything is drawn in code; no emoji, no external images required.
import { light, shade, hexToRgb, mix, luminance } from '../../art/color.js';

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOut = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const easeOutBack = t => { t = clamp(t, 0, 1); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
export const rgba = (c, a) => { const [r, g, b] = hexToRgb(c); return `rgba(${r},${g},${b},${a})`; };
export { light, shade, mix, luminance };

export const FONTS = {
  pixel: '"Press Start 2P", "Courier New", monospace', rounded: '"Nunito", "Trebuchet MS", "Arial Rounded MT Bold", system-ui, sans-serif',
  bold: '"Arial Black", Impact, system-ui, sans-serif', serif: 'Georgia, "Times New Roman", serif', hand: '"Comic Sans MS", "Marker Felt", "Chalkboard SE", cursive',
};

/** Rounded rectangle path with one radius or [tl, tr, br, bl]. */
export function rr(ctx, x, y, w, h, r) {
  const [a, b, c, d] = (Array.isArray(r) ? r : [r, r, r, r]).map(v => Math.max(0, Math.min(v, w / 2, h / 2)));
  ctx.beginPath();
  ctx.moveTo(x + a, y); ctx.lineTo(x + w - b, y); ctx.quadraticCurveTo(x + w, y, x + w, y + b);
  ctx.lineTo(x + w, y + h - c); ctx.quadraticCurveTo(x + w, y + h, x + w - c, y + h);
  ctx.lineTo(x + d, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - d);
  ctx.lineTo(x, y + a); ctx.quadraticCurveTo(x, y, x + a, y); ctx.closePath();
}

export function text(ctx, str, x, y, { size = 16, weight = 800, color = '#fff', align = 'center', base = 'middle', stroke = null, strokeW = 0, font, alpha = 1, maxW } = {}) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.font = `${weight} ${Math.round(size)}px ${font || FONTS.rounded}`;
  ctx.textAlign = align; ctx.textBaseline = base;
  if (maxW) { const w = ctx.measureText(str).width; if (w > maxW) { ctx.font = `${weight} ${Math.max(8, Math.floor(size * maxW / w))}px ${font || FONTS.rounded}`; } }
  if (stroke) { ctx.lineJoin = 'round'; ctx.lineWidth = strokeW || size * 0.18; ctx.strokeStyle = stroke; ctx.strokeText(str, x, y); }
  ctx.fillStyle = color; ctx.fillText(str, x, y);
  ctx.restore();
}

// ---------- cached sprites ----------
const cache = new Map();
function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  return null;
}
function cached(ctx, key, s, paint) {
  const scale = Math.max(1, ctx.getTransform?.().a || 1), size = Math.round(s * 10) / 10, k = `${key}|${size}|${scale.toFixed(2)}`;
  let sp = cache.get(k);
  if (sp === undefined) {
    const px = Math.ceil(size * scale) + 2, cv = makeCanvas(px, px);
    if (cv) { const g = cv.getContext('2d'); g.scale(scale, scale); g.translate(1 / scale, 1 / scale); paint(g, size); }
    sp = cv;
    if (cache.size > 600) cache.clear();
    cache.set(k, sp);
  }
  return { sp, scale, size };
}
function stamp(ctx, key, x, y, s, paint) {
  const { sp, scale } = cached(ctx, key, s, paint);
  if (!sp) { ctx.save(); ctx.translate(x, y); paint(ctx, s); ctx.restore(); return; }
  ctx.drawImage(sp, x - 1 / scale, y - 1 / scale, sp.width / scale, sp.height / scale);
}

function paintBlock(g, s, c, kind) {
  const b = Math.max(1.5, s * 0.13), r = s * 0.14;
  g.save();
  rr(g, 0, 0, s, s, r); g.fillStyle = shade(c, 0.38); g.fill();
  g.clip();
  g.fillStyle = light(c, 0.38);
  g.beginPath(); g.moveTo(0, 0); g.lineTo(s, 0); g.lineTo(s - b, b); g.lineTo(b, b); g.lineTo(b, s - b); g.lineTo(0, s); g.closePath(); g.fill();
  const face = g.createLinearGradient(0, b, 0, s - b);
  face.addColorStop(0, light(c, 0.16)); face.addColorStop(0.55, c); face.addColorStop(1, shade(c, 0.1));
  rr(g, b, b, s - 2 * b, s - 2 * b, r * 0.5); g.fillStyle = face; g.fill();
  if (kind === 'garbage') {
    g.strokeStyle = rgba(shade(c, 0.45), 0.55); g.lineWidth = s * 0.08;
    for (let k = -1; k < 3; k++) { g.beginPath(); g.moveTo(b + k * s * 0.33, s - b); g.lineTo(b + k * s * 0.33 + s * 0.45, b); g.stroke(); }
  }
  const gloss = g.createLinearGradient(0, b, 0, s * 0.5);
  gloss.addColorStop(0, 'rgba(255,255,255,.42)'); gloss.addColorStop(1, 'rgba(255,255,255,0)');
  rr(g, b * 1.2, b * 1.1, s - 2.4 * b, s * 0.38, [r * 0.5, r * 0.5, s * 0.2, s * 0.2]); g.fillStyle = gloss; g.fill();
  g.fillStyle = 'rgba(255,255,255,.75)'; g.beginPath(); g.ellipse(b + s * 0.13, b + s * 0.12, s * 0.07, s * 0.045, -0.6, 0, TAU); g.fill();
  g.restore();
  rr(g, 0.5, 0.5, s - 1, s - 1, r); g.strokeStyle = rgba(shade(c, 0.6), 0.9); g.lineWidth = 1; g.stroke();
}
/** A glossy beveled block. */
export function block(ctx, x, y, s, c, kind = 'block') { stamp(ctx, `b|${c}|${kind}`, x, y, s, (g, sz) => paintBlock(g, sz, c, kind)); }

export function ghostBlock(ctx, x, y, s, c, alpha = 1) {
  const i = s * 0.08;
  ctx.save(); ctx.globalAlpha *= alpha;
  rr(ctx, x + i, y + i, s - 2 * i, s - 2 * i, s * 0.14); ctx.fillStyle = rgba(c, 0.16); ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.07); ctx.strokeStyle = rgba(light(c, 0.2), 0.7); ctx.stroke();
  ctx.restore();
}

// ---------- gems (swap mode): one silhouette per color for readability ----------
const SHAPES = ['circle', 'diamond', 'triangle', 'hexagon', 'star', 'drop'];
function shapePath(g, kind, cx, cy, R) {
  g.beginPath();
  if (kind === 'circle') g.arc(cx, cy, R, 0, TAU);
  else if (kind === 'diamond') { g.moveTo(cx, cy - R * 1.08); g.lineTo(cx + R, cy); g.lineTo(cx, cy + R * 1.08); g.lineTo(cx - R, cy); g.closePath(); }
  else if (kind === 'triangle') { g.moveTo(cx, cy - R * 1.05); g.lineTo(cx + R * 1.05, cy + R * 0.8); g.lineTo(cx - R * 1.05, cy + R * 0.8); g.closePath(); }
  else if (kind === 'hexagon') { for (let k = 0; k < 6; k++) { const a = TAU * k / 6 + Math.PI / 6; g[k ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * R, cy + Math.sin(a) * R); } g.closePath(); }
  else if (kind === 'star') { for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + TAU * k / 10, rr2 = k % 2 ? R * 0.55 : R * 1.08; g[k ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rr2, cy + Math.sin(a) * rr2); } g.closePath(); }
  else { g.moveTo(cx, cy - R * 1.1); g.bezierCurveTo(cx + R * 0.9, cy - R * 0.2, cx + R, cy + R * 0.9, cx, cy + R * 0.95); g.bezierCurveTo(cx - R, cy + R * 0.9, cx - R * 0.9, cy - R * 0.2, cx, cy - R * 1.1); g.closePath(); }
}
function paintGem(g, s, c, idx) {
  const cx = s / 2, cy = s / 2, R = s * 0.38, kind = SHAPES[(idx - 1) % SHAPES.length];
  g.save();
  g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = s * 0.08; g.shadowOffsetY = s * 0.05;
  shapePath(g, kind, cx, cy, R); g.fillStyle = shade(c, 0.3); g.fill();
  g.restore();
  const grad = g.createRadialGradient(cx - R * 0.35, cy - R * 0.45, R * 0.1, cx, cy, R * 1.15);
  grad.addColorStop(0, light(c, 0.55)); grad.addColorStop(0.45, c); grad.addColorStop(1, shade(c, 0.35));
  shapePath(g, kind, cx, cy, R * 0.94); g.fillStyle = grad; g.fill();
  // facet: inner smaller shape, lighter
  shapePath(g, kind, cx, cy - R * 0.04, R * 0.5); g.fillStyle = rgba(light(c, 0.4), 0.55); g.fill();
  g.save(); shapePath(g, kind, cx, cy, R * 0.94); g.clip();
  g.fillStyle = 'rgba(255,255,255,.28)'; g.beginPath(); g.ellipse(cx - R * 0.15, cy - R * 0.55, R * 0.75, R * 0.35, -0.3, 0, TAU); g.fill();
  g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.ellipse(cx - R * 0.3, cy - R * 0.3, R * 0.14, R * 0.09, -0.7, 0, TAU); g.fill();
  g.restore();
  shapePath(g, kind, cx, cy, R * 0.94); g.lineWidth = Math.max(1, s * 0.035); g.strokeStyle = rgba(shade(c, 0.55), 0.9); g.stroke();
}
export function gemSprite(ctx, x, y, s, c, idx) { stamp(ctx, `g|${c}|${idx}`, x, y, s, (g, sz) => paintGem(g, sz, c, idx)); }

export function colorBomb(ctx, x, y, s, t, colors) {
  const cx = x + s / 2, cy = y + s / 2, R = s * 0.38;
  const grad = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.4, R * 0.1, cx, cy, R);
  grad.addColorStop(0, '#5a4a78'); grad.addColorStop(1, '#141020');
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fillStyle = grad; ctx.fill();
  for (let k = 0; k < 12; k++) {
    const a = t * 1.6 + k * 2.4, r = R * (0.25 + (k * 37 % 10) / 15);
    ctx.fillStyle = colors[k % colors.length];
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r * 0.85, cy + Math.sin(a) * r * 0.85, s * 0.045, 0, TAU); ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.beginPath(); ctx.ellipse(cx - R * 0.4, cy - R * 0.45, R * 0.18, R * 0.1, -0.7, 0, TAU); ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.04); ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
}

// ---------- chain mode: blobs, viruses and capsules ----------
export function blob(ctx, cx, cy, R, c, { eyes = true, look = 0, squash = 0, alpha = 1 } = {}) {
  ctx.save(); ctx.globalAlpha *= alpha;
  ctx.translate(cx, cy); ctx.scale(1 + squash, 1 - squash);
  const grad = ctx.createRadialGradient(-R * 0.35, -R * 0.4, R * 0.1, 0, 0, R * 1.1);
  grad.addColorStop(0, light(c, 0.5)); grad.addColorStop(0.5, c); grad.addColorStop(1, shade(c, 0.35));
  ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fillStyle = grad; ctx.fill();
  ctx.lineWidth = Math.max(1, R * 0.08); ctx.strokeStyle = rgba(shade(c, 0.55), 0.85); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.beginPath(); ctx.ellipse(-R * 0.4, -R * 0.45, R * 0.22, R * 0.13, -0.7, 0, TAU); ctx.fill();
  if (eyes) {
    for (const ex of [-0.32, 0.32]) {
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(ex * R, -R * 0.02, R * 0.2, R * 0.25, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#1a1626'; ctx.beginPath(); ctx.arc(ex * R + look * R * 0.07, R * 0.06, R * 0.11, 0, TAU); ctx.fill();
    }
  }
  ctx.restore();
}
export function virus(ctx, cx, cy, R, c, t, hurt = false) {
  ctx.save(); ctx.translate(cx, cy);
  const wob = Math.sin(t * 7) * 0.08;
  ctx.scale(1 + wob, 1 - wob);
  ctx.beginPath();
  for (let k = 0; k < 16; k++) { const a = TAU * k / 16 + t * 0.6, r = k % 2 ? R * 0.78 : R; ctx[k ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); }
  ctx.closePath();
  const grad = ctx.createRadialGradient(-R * 0.3, -R * 0.3, R * 0.1, 0, 0, R);
  grad.addColorStop(0, light(c, 0.35)); grad.addColorStop(1, shade(c, 0.3));
  ctx.fillStyle = grad; ctx.fill(); ctx.lineWidth = Math.max(1, R * 0.08); ctx.strokeStyle = shade(c, 0.6); ctx.stroke();
  // angry face
  ctx.fillStyle = '#fff';
  for (const ex of [-0.3, 0.3]) { ctx.beginPath(); ctx.ellipse(ex * R, -R * 0.1, R * 0.17, hurt ? R * 0.05 : R * 0.2, 0, 0, TAU); ctx.fill(); }
  ctx.fillStyle = '#16121e';
  if (!hurt) for (const ex of [-0.3, 0.3]) { ctx.beginPath(); ctx.arc(ex * R + Math.sin(t * 2) * R * 0.04, -R * 0.05, R * 0.08, 0, TAU); ctx.fill(); }
  ctx.strokeStyle = '#16121e'; ctx.lineWidth = Math.max(1, R * 0.08); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-R * 0.48, -R * 0.38); ctx.lineTo(-R * 0.14, -R * 0.26); ctx.moveTo(R * 0.48, -R * 0.38); ctx.lineTo(R * 0.14, -R * 0.26); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, R * 0.42, R * 0.2, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
  ctx.restore();
}
/** One half of a capsule; side is the link direction (1 L, 2 R, 3 U, 4 D) that stays square. */
export function capsuleHalf(ctx, x, y, s, c, side) {
  const i = s * 0.07, w = s - 2 * i, R = w * 0.5;
  const radii = { 0: [R, R, R, R], 1: [2, R, R, 2], 2: [R, 2, 2, R], 3: [2, 2, R, R], 4: [R, R, 2, 2] }[side] || [R, R, R, R];
  const ext = { 1: [-i, 0, i, 0], 2: [0, 0, i, 0], 3: [0, -i, 0, i], 4: [0, 0, 0, i] }[side] || [0, 0, 0, 0];
  const X = x + i + ext[0], Y = y + i + ext[1], Wd = w + ext[2], Ht = w + ext[3];
  const grad = ctx.createLinearGradient(X, Y, X + Wd, Y + Ht);
  grad.addColorStop(0, light(c, 0.4)); grad.addColorStop(0.5, c); grad.addColorStop(1, shade(c, 0.3));
  rr(ctx, X, Y, Wd, Ht, radii); ctx.fillStyle = grad; ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.05); ctx.strokeStyle = rgba(shade(c, 0.6), 0.9); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.ellipse(X + Wd * 0.32, Y + Ht * 0.3, Wd * 0.16, Ht * 0.09, -0.6, 0, TAU); ctx.fill();
}
export function garbageBlob(ctx, cx, cy, R, alpha = 1) {
  ctx.save(); ctx.globalAlpha *= alpha;
  const grad = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.1, cx, cy, R);
  grad.addColorStop(0, '#f2f0f6'); grad.addColorStop(1, '#8e8a9c');
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.92, 0, TAU); ctx.fillStyle = grad; ctx.fill();
  ctx.lineWidth = Math.max(1, R * 0.08); ctx.strokeStyle = '#5c586a'; ctx.stroke();
  ctx.fillStyle = '#5c586a';
  for (const ex of [-0.28, 0.28]) { ctx.beginPath(); ctx.arc(cx + ex * R, cy - R * 0.05, R * 0.08, 0, TAU); ctx.fill(); }
  ctx.fillRect(cx - R * 0.2, cy + R * 0.28, R * 0.4, Math.max(1, R * 0.07));
  ctx.restore();
}

// ---------- obstacles ----------
export function crate(ctx, x, y, s, hp) {
  const i = s * 0.06, w = s - 2 * i, c = hp > 1 ? '#8a5a34' : '#b07a44';
  rr(ctx, x + i, y + i, w, w, s * 0.1); ctx.fillStyle = c; ctx.fill();
  ctx.strokeStyle = shade(c, 0.45); ctx.lineWidth = Math.max(1, s * 0.05); ctx.stroke();
  ctx.save(); rr(ctx, x + i, y + i, w, w, s * 0.1); ctx.clip();
  ctx.strokeStyle = rgba(shade(c, 0.35), 0.8); ctx.lineWidth = Math.max(1, s * 0.04);
  for (let k = 1; k < 3; k++) { ctx.beginPath(); ctx.moveTo(x + i, y + i + w * k / 3); ctx.lineTo(x + i + w, y + i + w * k / 3); ctx.stroke(); }
  ctx.lineWidth = Math.max(1.5, s * 0.08); ctx.strokeStyle = rgba(light(c, 0.2), 0.9);
  ctx.beginPath(); ctx.moveTo(x + i, y + i); ctx.lineTo(x + i + w, y + i + w); ctx.stroke();
  if (hp > 1) { ctx.fillStyle = '#c9ced8'; ctx.fillRect(x + i, y + i + w * 0.08, w, w * 0.12); ctx.fillRect(x + i, y + i + w * 0.8, w, w * 0.12); ctx.fillStyle = '#6c7382'; for (const fx of [0.15, 0.85]) for (const fy of [0.14, 0.86]) { ctx.beginPath(); ctx.arc(x + i + w * fx, y + i + w * fy, s * 0.035, 0, TAU); ctx.fill(); } }
  ctx.restore();
}
export function rock(ctx, x, y, s) {
  const cx = x + s / 2, cy = y + s / 2, R = s * 0.42;
  ctx.beginPath();
  for (let k = 0; k < 9; k++) { const a = TAU * k / 9, r = R * (0.86 + ((k * 53) % 7) / 40); ctx[k ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.92); }
  ctx.closePath();
  const grad = ctx.createLinearGradient(x, y, x + s, y + s); grad.addColorStop(0, '#a8adb9'); grad.addColorStop(1, '#4e5260');
  ctx.fillStyle = grad; ctx.fill(); ctx.lineWidth = Math.max(1, s * 0.04); ctx.strokeStyle = '#30333d'; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.beginPath(); ctx.ellipse(cx - R * 0.3, cy - R * 0.35, R * 0.3, R * 0.14, -0.5, 0, TAU); ctx.fill();
}
export function itemToken(ctx, cx, cy, R, t) {
  ctx.save(); ctx.translate(cx, cy + Math.sin(t * 3) * R * 0.08);
  ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU);
  const grad = ctx.createRadialGradient(-R * 0.3, -R * 0.35, R * 0.1, 0, 0, R); grad.addColorStop(0, '#fff2a8'); grad.addColorStop(1, '#c98a1a');
  ctx.fillStyle = grad; ctx.fill(); ctx.lineWidth = Math.max(1, R * 0.12); ctx.strokeStyle = '#7a4c08'; ctx.stroke();
  ctx.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + TAU * k / 10, r = k % 2 ? R * 0.28 : R * 0.6; ctx[k ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath();
  ctx.fillStyle = '#fffbe0'; ctx.fill();
  ctx.restore();
}

// ---------- panels ----------
export function panel(ctx, x, y, w, h, pal, { glow = 0 } = {}) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
  rr(ctx, x, y, w, h, Math.min(16, w * 0.08)); ctx.fillStyle = pal.panel; ctx.fill();
  ctx.restore();
  rr(ctx, x + 0.5, y + 0.5, w - 1, h - 1, Math.min(16, w * 0.08)); ctx.lineWidth = 1.5; ctx.strokeStyle = glow ? rgba(pal.accent, 0.4 + glow * 0.5) : pal.edge; ctx.stroke();
}
export function starShape(ctx, cx, cy, R, fill, stroke) {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + TAU * k / 10, r = k % 2 ? R * 0.45 : R; ctx[k ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
  ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.lineWidth = Math.max(1, R * 0.15); ctx.strokeStyle = stroke; ctx.stroke(); }
}
