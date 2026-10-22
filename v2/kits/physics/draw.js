// Code-drawn pieces for the physics kit: materials (wood grain, stone,
// glass shine, metal, TNT, rock), bricks, pegs, capsules, the slingshot,
// flippers and bumpers. Everything draws in world units on an already
// transformed canvas; `px` is pixels per unit for hairline widths.
import { worldVerts } from './physics.js';

export const TAU = Math.PI * 2;
export const HUD_FONT = '"Avenir Next", "Nunito", ui-rounded, "SF Pro Rounded", "Segoe UI", system-ui, sans-serif';

// Generated art loads asynchronously; until an image is ready the code-drawn fallback shows.
const images = new Map();
export function image(url) {
  if (!url || typeof Image === 'undefined') return null;
  let e = images.get(url);
  if (!e) { const img = new Image(); e = { img, ready: false }; img.onload = () => { e.ready = true; }; img.src = url; images.set(url, e); }
  return e.ready ? e.img : null;
}

export const hash = (n) => { let h = (n * 2654435761) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13; return (h >>> 0) / 4294967296; };
export function hexToRgb(hex) { const h = String(hex || '#888888').replace('#', ''); const v = h.length === 3 ? [...h].map(c => c + c).join('') : h.padEnd(6, '0'); return [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16) || 0); }
export function shade(hex, k) { const [r, g, b] = hexToRgb(hex); const f = v => Math.round(Math.max(0, Math.min(255, k >= 0 ? v + (255 - v) * k : v * (1 + k)))); return `rgb(${f(r)},${f(g)},${f(b)})`; }
export const rgba = (hex, a) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };

export function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
/** Text at a world position and world-unit size (canvas fonts misbehave below 1px, so scale out first). */
export function worldText(ctx, text, x, y, size, px, color, { weight = 900, align = 'center', stroke = null } = {}) {
  ctx.save(); ctx.translate(x, y); ctx.scale(1 / px, 1 / px);
  ctx.font = `${weight} ${Math.max(1, size * px)}px ${HUD_FONT}`; ctx.textAlign = align; ctx.textBaseline = 'middle';
  if (stroke) { ctx.lineWidth = Math.max(2, size * px * 0.16); ctx.strokeStyle = stroke; ctx.lineJoin = 'round'; ctx.strokeText(text, 0, 0); }
  ctx.fillStyle = color; ctx.fillText(text, 0, 0); ctx.restore();
}
function polyPath(ctx, pts) { ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); }

/** Draw an image centered at (x, y) in a w-by-h box, optionally flipped and rotated. */
export function sprite(ctx, img, x, y, w, h, { rot = 0, flip = false, alpha = 1, squash = 1 } = {}) {
  if (!img) return false;
  ctx.save(); ctx.translate(x, y); if (rot) ctx.rotate(rot); if (flip) ctx.scale(-1, 1); ctx.scale(1 / squash, squash);
  ctx.globalAlpha *= alpha; ctx.drawImage(img, -w / 2, -h / 2, w, h); ctx.restore();
  return true;
}

// ---------- materials ----------
const MAT = {
  wood: { base: '#c07a3c', dark: '#7e4a1f', light: '#e3a965' },
  stone: { base: '#8f98a6', dark: '#5b626e', light: '#c3cad4' },
  glass: { base: '#a8dcf5', dark: '#5fa7d0', light: '#ffffff' },
  tnt: { base: '#d8322a', dark: '#7a1612', light: '#ff7b62' },
  rock: { base: '#6b5a4a', dark: '#3e3229', light: '#8f7b66' },
  metal: { base: '#9aa6b5', dark: '#56606e', light: '#e9eef5' },
};
export const materialColor = m => (MAT[m] || MAT.wood).base;

function cracks(ctx, seed, cx, cy, size, amount, px) {
  if (amount <= 0.05) return;
  ctx.save(); ctx.strokeStyle = 'rgba(30,18,10,0.7)'; ctx.lineWidth = Math.max(1, 1.4 / 1) / px; ctx.lineCap = 'round';
  const n = Math.ceil(amount * 4);
  for (let i = 0; i < n; i++) {
    let x = cx, y = cy, a = hash(seed + i * 7) * TAU;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let k = 0; k < 4; k++) { a += (hash(seed + i * 13 + k) - 0.5) * 1.6; x += Math.cos(a) * size * 0.22; y += Math.sin(a) * size * 0.22; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  ctx.restore();
}

/** A slingshot-structure piece (box, triangle or ball body) in its material, with damage cracks. */
export function drawPiece(ctx, b, px, { flash = 0 } = {}) {
  const d = b.data, mat = d.material || 'wood', M = MAT[mat] || MAT.wood;
  const dmg = d.max && Number.isFinite(d.max) ? 1 - Math.max(0, d.hp) / d.max : 0;
  ctx.save();
  if (b.shape === 'circle') { ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); }
  else polyPath(ctx, worldVerts(b));
  const g = ctx.createLinearGradient(b.x - b.bound, b.y - b.bound, b.x + b.bound, b.y + b.bound);
  g.addColorStop(0, M.light); g.addColorStop(0.45, M.base); g.addColorStop(1, M.dark);
  if (mat === 'glass') { ctx.fillStyle = 'rgba(168,220,245,0.42)'; ctx.fill(); ctx.strokeStyle = 'rgba(235,250,255,0.95)'; }
  else { ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = shade(M.dark, -0.35); }
  ctx.lineWidth = 2 / px; ctx.lineJoin = 'round';
  ctx.save(); ctx.clip();
  // Surface detail in the body's own frame.
  ctx.translate(b.x, b.y); ctx.rotate(b.a);
  const R = b.bound, seed = b.id * 31;
  if (mat === 'wood') {
    ctx.strokeStyle = rgba('#5a3314', 0.35); ctx.lineWidth = 1.2 / px;
    const long = (d.w || 1) >= (d.h || 1);
    for (let i = -6; i <= 6; i++) {
      const o = i * R / 5 + (hash(seed + i) - 0.5) * 0.06;
      ctx.beginPath();
      for (let t = -R; t <= R; t += R / 6) { const w = Math.sin(t * 3 + i + hash(seed) * 6) * 0.03; long ? ctx.lineTo(t, o + w) : ctx.lineTo(o + w, t); }
      ctx.stroke();
    }
    ctx.fillStyle = rgba('#3a210c', 0.45);
    const knots = 1 + Math.floor(hash(seed + 3) * 2);
    for (let k = 0; k < knots; k++) { ctx.beginPath(); ctx.ellipse((hash(seed + 9 + k) - 0.5) * R, (hash(seed + 5 + k) - 0.5) * R * 0.5, 0.07, 0.04, 0, 0, TAU); ctx.fill(); }
  } else if (mat === 'stone' || mat === 'rock') {
    for (let i = 0; i < 14; i++) { ctx.fillStyle = i % 2 ? rgba('#ffffff', 0.12) : rgba('#000000', 0.12); ctx.beginPath(); ctx.arc((hash(seed + i) - 0.5) * R * 2, (hash(seed + i + 40) - 0.5) * R * 2, 0.03 + hash(seed + i + 80) * 0.06, 0, TAU); ctx.fill(); }
    if (mat === 'rock') { ctx.fillStyle = '#5fa04a'; ctx.fillRect(-R * 2, -(d.h || 1) / 2 - 0.02, R * 4, 0.16); ctx.fillStyle = '#86c45c'; ctx.fillRect(-R * 2, -(d.h || 1) / 2 - 0.02, R * 4, 0.06); }
  } else if (mat === 'glass') {
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath(); ctx.moveTo(-R, -R * 0.2); ctx.lineTo(-R * 0.6, -R); ctx.lineTo(-R * 0.35, -R); ctx.lineTo(-R, -R * 0.0 + 0.15); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(-R, -R, R * 2, 0.06);
  } else if (mat === 'tnt') {
    ctx.fillStyle = rgba('#2a0806', 0.55); ctx.fillRect(-R, -0.08, R * 2, 0.16);
    const s = Math.min(d.w || 0.8, d.h || 0.8);
    worldText(ctx, 'TNT', 0, 0.01, s * 0.34, px, '#ffe9a8');
  }
  ctx.restore();
  ctx.stroke();
  // Bevel highlight.
  if (b.shape !== 'circle' && mat !== 'glass') { ctx.save(); ctx.clip(); ctx.strokeStyle = rgba('#ffffff', 0.18); ctx.lineWidth = 3 / px; ctx.stroke(); ctx.restore(); }
  if (b.shape === 'circle') { ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.arc(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.3, 0, TAU); ctx.fill(); }
  if (mat !== 'rock') cracks(ctx, seed, b.x, b.y, b.bound * 1.4, dmg, px);
  if (flash > 0) { ctx.globalAlpha = flash; ctx.fillStyle = '#ffffff'; if (b.shape === 'circle') { ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); } else polyPath(ctx, worldVerts(b)); ctx.fill(); }
  ctx.restore();
}

// ---------- breakout ----------
export const ROW_COLORS = ['#ff5d73', '#ff9f43', '#ffd84a', '#7bdc65', '#3ec7e6', '#6f86ff', '#c06cff', '#ff6fb5', '#f7f2e8', '#ff5d73', '#ff9f43', '#ffd84a'];
export function drawBrick(ctx, b, px, t, flash = 0) {
  const d = b.data, w = 0.96, h = 0.46, x = b.x - w / 2, y = b.y - h / 2;
  let base = ROW_COLORS[d.row % ROW_COLORS.length];
  if (d.kind === 'm') base = '#a7b2c2';
  else if (d.kind === 'x') base = '#ff4b2b';
  else if (d.max > 1) base = shade('#c9b8ff', -0.15 * (d.max - 2));
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, shade(base, 0.35)); g.addColorStop(0.5, base); g.addColorStop(1, shade(base, -0.35));
  roundRect(ctx, x, y, w, h, 0.08); ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 1.5 / px; ctx.strokeStyle = shade(base, -0.55); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; roundRect(ctx, x + 0.06, y + 0.05, w - 0.12, 0.09, 0.04); ctx.fill();
  if (d.kind === 'm') {
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.moveTo(x + w * 0.15, y + h); ctx.lineTo(x + w * 0.35, y); ctx.lineTo(x + w * 0.45, y); ctx.lineTo(x + w * 0.25, y + h); ctx.fill();
    ctx.fillStyle = shade(base, -0.5); for (const [ox, oy] of [[0.1, 0.12], [0.86, 0.12], [0.1, 0.34], [0.86, 0.34]]) { ctx.beginPath(); ctx.arc(x + ox, y + oy, 0.035, 0, TAU); ctx.fill(); }
  } else if (d.kind === 'x') {
    const pulse = 0.5 + 0.5 * Math.sin(t * 8 + b.id);
    ctx.fillStyle = `rgba(255,236,120,${0.5 + pulse * 0.5})`; ctx.beginPath(); ctx.arc(b.x, b.y, 0.11 + pulse * 0.03, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(60,10,0,0.6)'; ctx.lineWidth = 1.2 / px; for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; ctx.beginPath(); ctx.moveTo(b.x + Math.cos(a) * 0.15, b.y + Math.sin(a) * 0.12); ctx.lineTo(b.x + Math.cos(a) * 0.3, b.y + Math.sin(a) * 0.17); ctx.stroke(); }
  } else if (d.kind === 's') {
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; const dir = b.vx >= 0 ? 1 : -1;
    for (const o of [-0.18, 0.06]) { ctx.beginPath(); ctx.moveTo(b.x + o * dir, b.y - 0.1); ctx.lineTo(b.x + (o + 0.12) * dir, b.y); ctx.lineTo(b.x + o * dir, b.y + 0.1); ctx.fill(); }
  } else if (d.kind === 'p') {
    const tw = 0.5 + 0.5 * Math.sin(t * 5 + b.id);
    ctx.fillStyle = `rgba(255,255,255,${0.45 + tw * 0.5})`; star(ctx, b.x, b.y, 0.15); ctx.fill();
  }
  if (d.max > 1 && d.hp < d.max) cracks(ctx, b.id * 17, b.x, b.y, 0.6, 1 - d.hp / d.max, px);
  if (d.max > 1) { ctx.fillStyle = 'rgba(30,20,60,0.55)'; for (let i = 0; i < d.hp; i++) { ctx.beginPath(); ctx.arc(b.x - (d.hp - 1) * 0.07 + i * 0.14, b.y + 0.12, 0.04, 0, TAU); ctx.fill(); } }
  if (flash > 0) { ctx.globalAlpha = flash; ctx.fillStyle = '#fff'; roundRect(ctx, x, y, w, h, 0.08); ctx.fill(); ctx.globalAlpha = 1; }
}

export function star(ctx, x, y, r, points = 5, inner = 0.45) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) { const a = i / (points * 2) * TAU - Math.PI / 2, rr = i % 2 ? r * inner : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  ctx.closePath();
}

export const CAPSULE = { wide: ['#3e8bff', 'W'], catch: ['#46d17a', 'C'], multiball: ['#ffb02e', 'M'], laser: ['#ff4f5e', 'L'], slow: ['#a46bff', 'S'], life: ['#9aa7b8', '+'] };
export function drawCapsule(ctx, c, px, t) {
  const [col, letter] = CAPSULE[c.kind] || ['#ccc', '?'];
  ctx.save(); ctx.translate(c.x, c.y);
  const spin = Math.sin(t * 6 + c.x) * 0.15;
  ctx.scale(1, 1 - Math.abs(spin));
  const g = ctx.createLinearGradient(0, -0.2, 0, 0.2); g.addColorStop(0, shade(col, 0.5)); g.addColorStop(0.5, col); g.addColorStop(1, shade(col, -0.4));
  roundRect(ctx, -0.42, -0.19, 0.84, 0.38, 0.19); ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = shade(col, -0.6); ctx.lineWidth = 1.5 / px; ctx.stroke();
  worldText(ctx, letter, 0, 0.015, 0.3, px, '#ffffff');
  ctx.restore();
}

export function drawPaddle(ctx, x, y, w, h, color, px, { laser = false, catcher = false, squash = 0 } = {}) {
  ctx.save(); ctx.translate(x, y); ctx.scale(1 + squash * 0.08, 1 - squash * 0.25);
  const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2); g.addColorStop(0, shade(color, 0.45)); g.addColorStop(0.5, color); g.addColorStop(1, shade(color, -0.45));
  roundRect(ctx, -w / 2, -h / 2, w, h, h / 2); ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = shade(color, -0.6); ctx.lineWidth = 2 / px; ctx.stroke();
  // Silver end caps.
  for (const s of [-1, 1]) { const cx = s * (w / 2 - h * 0.55); const cg = ctx.createLinearGradient(0, -h / 2, 0, h / 2); cg.addColorStop(0, '#f4f7fb'); cg.addColorStop(1, '#7a8494'); ctx.fillStyle = cg; roundRect(ctx, cx - h * 0.5, -h / 2, h, h, h / 2); ctx.fill(); }
  ctx.fillStyle = 'rgba(255,255,255,0.45)'; roundRect(ctx, -w / 2 + h, -h / 2 + 0.04, w - 2 * h, 0.07, 0.04); ctx.fill();
  if (laser) for (const s of [-1, 1]) { ctx.fillStyle = '#ff4f5e'; ctx.fillRect(s * (w / 2 - 0.15) - 0.05, -h / 2 - 0.16, 0.1, 0.18); }
  if (catcher) { ctx.strokeStyle = 'rgba(120,255,170,0.85)'; ctx.lineWidth = 2 / px; ctx.beginPath(); ctx.moveTo(-w / 2 + h, -h / 2); ctx.lineTo(w / 2 - h, -h / 2); ctx.stroke(); }
  ctx.restore();
}

export function drawBall(ctx, x, y, r, color = '#f5f7fb', glow = null) {
  if (glow) { const gg = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 3); gg.addColorStop(0, glow); gg.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(x, y, r * 3, 0, TAU); ctx.fill(); }
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, color); g.addColorStop(1, shade(color, -0.55));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
}

export function drawTrail(ctx, pts, r, color) {
  if (!pts || pts.length < 2) return;
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (let i = 1; i < pts.length; i++) {
    const k = i / pts.length;
    ctx.strokeStyle = rgba(color, k * 0.45); ctx.lineWidth = r * 2 * k;
    ctx.beginPath(); ctx.moveTo(pts[i - 1][0], pts[i - 1][1]); ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke();
  }
  ctx.restore();
}

// ---------- peggle ----------
export const PEG_COLOR = { blue: '#3f8cff', orange: '#ff8a1c', green: '#36d36a', purple: '#b45cff' };
export function drawPeg(ctx, b, px, t, glowT = 0) {
  const d = b.data, col = PEG_COLOR[d.kind] || '#888', lit = d.lit;
  ctx.save();
  if (lit) { const gg = ctx.createRadialGradient(b.x, b.y, 0.05, b.x, b.y, 0.7); gg.addColorStop(0, rgba(col, 0.75)); gg.addColorStop(1, rgba(col, 0)); ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(b.x, b.y, 0.7, 0, TAU); ctx.fill(); }
  const top = lit ? shade(col, 0.75) : shade(col, 0.25), bot = lit ? shade(col, 0.15) : shade(col, -0.45);
  if (b.shape === 'circle') {
    const g = ctx.createRadialGradient(b.x - b.r * 0.4, b.y - b.r * 0.45, b.r * 0.1, b.x, b.y, b.r);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.3, top); g.addColorStop(1, bot);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
    ctx.strokeStyle = rgba('#000000', 0.35); ctx.lineWidth = 1.2 / px; ctx.stroke();
  } else {
    const v = worldVerts(b); polyPath(ctx, v);
    const g = ctx.createLinearGradient(b.x, b.y - 0.2, b.x, b.y + 0.2); g.addColorStop(0, top); g.addColorStop(1, bot);
    ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = rgba('#000000', 0.4); ctx.lineWidth = 1.2 / px; ctx.stroke();
    ctx.translate(b.x, b.y); ctx.rotate(b.a); ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fillRect(-0.33, -0.12, 0.66, 0.06);
  }
  if (d.kind === 'purple' && !lit) { ctx.restore(); ctx.save(); ctx.strokeStyle = `rgba(230,190,255,${0.4 + 0.4 * Math.sin(t * 6)})`; ctx.lineWidth = 2 / px; ctx.beginPath(); ctx.arc(b.x, b.y, 0.34, 0, TAU); ctx.stroke(); }
  if (d.kind === 'green' && !lit) { ctx.restore(); ctx.save(); ctx.fillStyle = 'rgba(255,255,255,0.85)'; star(ctx, b.x, b.y, 0.12, 4, 0.4); ctx.fill(); }
  ctx.restore();
}

// ---------- slingshot ----------
export function drawSlingshotFrame(ctx, x, groundY, px, back) {
  // back = the rear fork (drawn behind the projectile), front fork after.
  const wood = ctx.createLinearGradient(x - 0.3, 0, x + 0.3, 0); wood.addColorStop(0, '#6d3f1c'); wood.addColorStop(0.5, '#b0713b'); wood.addColorStop(1, '#6d3f1c');
  ctx.strokeStyle = wood; ctx.lineCap = 'round'; ctx.lineWidth = 0.32;
  ctx.beginPath();
  if (back) { ctx.moveTo(x, groundY); ctx.lineTo(x, groundY - 1.7); ctx.lineTo(x + 0.45, groundY - 2.8); }
  else { ctx.moveTo(x, groundY - 1.7); ctx.lineTo(x - 0.4, groundY - 2.75); }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 2 / px; ctx.stroke();
}

// ---------- pinball ----------
export function drawFlipper(ctx, b, color, px) {
  const v = worldVerts(b);
  ctx.save(); polyPath(ctx, v);
  const g = ctx.createLinearGradient(b.x, b.y - 0.3, b.x, b.y + 0.3); g.addColorStop(0, shade(color, 0.5)); g.addColorStop(1, shade(color, -0.4));
  ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = 2.2 / px; ctx.strokeStyle = '#1a1020'; ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2 / px; ctx.beginPath(); ctx.moveTo(v[1][0], v[1][1]); ctx.lineTo(v[2][0], v[2][1]); ctx.stroke();
  ctx.restore();
}

export function drawBumper(ctx, b, color, px, lit, t) {
  const r = b.r;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.arc(b.x + 0.08, b.y + 0.12, r * 1.05, 0, TAU); ctx.fill();
  const ring = lit ? '#fff7c2' : shade(color, -0.1);
  ctx.fillStyle = ring; ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, TAU); ctx.fill();
  ctx.lineWidth = 2 / px; ctx.strokeStyle = '#140b1c'; ctx.stroke();
  const cap = ctx.createRadialGradient(b.x - r * 0.3, b.y - r * 0.4, 0.05, b.x, b.y, r * 0.75);
  cap.addColorStop(0, '#ffffff'); cap.addColorStop(0.4, lit ? '#ffe36a' : shade(color, 0.4)); cap.addColorStop(1, lit ? '#ff9b2e' : shade(color, -0.4));
  ctx.fillStyle = cap; ctx.beginPath(); ctx.arc(b.x, b.y - 0.04, r * 0.72 * (lit ? 0.92 : 1), 0, TAU); ctx.fill();
  if (lit) { const gg = ctx.createRadialGradient(b.x, b.y, r * 0.3, b.x, b.y, r * 2.2); gg.addColorStop(0, 'rgba(255,240,150,0.6)'); gg.addColorStop(1, 'rgba(255,240,150,0)'); ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(b.x, b.y, r * 2.2, 0, TAU); ctx.fill(); }
  ctx.fillStyle = 'rgba(255,255,255,0.8)'; star(ctx, b.x, b.y - 0.04, r * 0.28); ctx.fill();
  ctx.restore();
}

export function polygon(ctx, pts) { polyPath(ctx, pts); }
