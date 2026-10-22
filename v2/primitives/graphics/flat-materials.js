// Physical materials for body renderers (ported and generalized from the
// physics kit): wood grain with knots, speckled stone and rock with a grass
// cap, translucent glass with shine, brushed metal with rivets, ice, rubber,
// TNT crates with a stenciled label, glossy balls — plus damage cracks and an
// impact flash. Drawing happens in screen space over a path the caller built.
import { TAU, rgba, light, shade, mix, hash } from './flat-util.js';

export const MATERIALS = {
  wood: { base: '#c07a3c', dark: '#7e4a1f', light: '#e3a965' },
  stone: { base: '#8f98a6', dark: '#5b626e', light: '#c3cad4' },
  glass: { base: '#a8dcf5', dark: '#5fa7d0', light: '#ffffff' },
  tnt: { base: '#d8322a', dark: '#7a1612', light: '#ff7b62' },
  rock: { base: '#6b5a4a', dark: '#3e3229', light: '#8f7b66' },
  metal: { base: '#9aa6b5', dark: '#56606e', light: '#e9eef5' },
  ice: { base: '#cfeeff', dark: '#8ac4e8', light: '#ffffff' },
  rubber: { base: '#3a3f4b', dark: '#1e2128', light: '#6a7080' },
  ball: { base: '#f5f7fb', dark: '#9aa3b0', light: '#ffffff' },
  plastic: { base: '#ff6a5a', dark: '#b03a30', light: '#ffb0a0' },
};
/** A body's material: the one given, else the one its body declares, else by its shape (never guessed from words). */
export function materialFor(arch = {}, body = {}, explicit = null) {
  if (explicit && MATERIALS[explicit]) return explicit;
  if (MATERIALS[body.material]) return body.material;
  return body.shape?.kind === 'circle' ? 'ball' : 'wood';
}
/** Material colors, tinted toward a custom color when given. */
export function materialColors(mat, tint) {
  const M = MATERIALS[mat] || MATERIALS.wood;
  return tint ? { base: mix(M.base, tint, 0.65), dark: shade(mix(M.base, tint, 0.65), 0.35), light: light(mix(M.base, tint, 0.65), 0.3) } : M;
}

function cracks(g, seed, cx, cy, size, amount) {
  if (amount <= 0.05) return;
  g.save(); g.strokeStyle = 'rgba(30,18,10,0.7)'; g.lineWidth = Math.max(1, size * 0.02); g.lineCap = 'round';
  const n = Math.ceil(amount * 5);
  for (let i = 0; i < n; i++) {
    let x = cx, y = cy, a = hash(seed + i * 7) * TAU;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 4; k++) { a += (hash(seed + i * 13 + k) - 0.5) * 1.6; x += Math.cos(a) * size * 0.2; y += Math.sin(a) * size * 0.2; g.lineTo(x, y); }
    g.stroke();
  }
  g.restore();
}

/**
 * Fill and decorate the current path. o: { mat, colors, cx, cy (screen center), R (screen bound radius),
 *   angle (screen radians), seed, damage 0..1, flash 0..1, circle (bool), w, h (screen size along the body axes), label }
 */
export function paintMaterial(g, buildPath, o) {
  const { mat, cx, cy, R } = o, M = o.colors || MATERIALS[mat] || MATERIALS.wood;
  g.save();
  buildPath();
  if (mat === 'glass' || mat === 'ice') { g.fillStyle = rgba(M.base, mat === 'ice' ? 0.7 : 0.42); g.fill(); }
  else if (mat === 'ball' || o.circle) { const gr = g.createRadialGradient ? g.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R) : null; if (gr) { gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.35, M.base); gr.addColorStop(1, M.dark); } g.fillStyle = gr || M.base; g.fill(); }
  else { const gr = g.createLinearGradient ? g.createLinearGradient(cx - R, cy - R, cx + R, cy + R) : null; if (gr) { gr.addColorStop(0, M.light); gr.addColorStop(0.45, M.base); gr.addColorStop(1, M.dark); } g.fillStyle = gr || M.base; g.fill(); }
  // Surface detail in the body's frame, clipped to its shape.
  g.save(); g.clip();
  g.translate(cx, cy); g.rotate(o.angle || 0);
  const seed = o.seed || 1, w = o.w || R * 2, h = o.h || R * 2;
  if (mat === 'wood') {
    g.strokeStyle = rgba('#5a3314', 0.35); g.lineWidth = Math.max(1, Math.min(w, h) * 0.03);
    const long = w >= h, L = Math.max(w, h) / 2, S = Math.min(w, h) / 2;
    for (let i = -6; i <= 6; i++) { const off = (i / 6) * S + (hash(seed + i) - 0.5) * S * 0.1; g.beginPath(); for (let t = -L; t <= L; t += L / 6) { const wv = Math.sin(t / L * 6 + i + hash(seed) * 6) * S * 0.04; long ? g.lineTo(t, off + wv) : g.lineTo(off + wv, t); } g.stroke(); }
    g.fillStyle = rgba('#3a210c', 0.45);
    for (let k = 0; k < 1 + Math.floor(hash(seed + 3) * 2); k++) { g.beginPath(); g.ellipse((hash(seed + 9 + k) - 0.5) * w * 0.7, (hash(seed + 5 + k) - 0.5) * h * 0.5, Math.max(1.5, S * 0.12), Math.max(1, S * 0.07), 0, 0, TAU); g.fill(); }
    g.strokeStyle = rgba('#3a210c', 0.5); g.lineWidth = Math.max(1, Math.min(w, h) * 0.04); { const m = Math.min(w, h) * 0.12; g.strokeRect(-w / 2 + m, -h / 2 + m, w - 2 * m, h - 2 * m); }
  } else if (mat === 'stone' || mat === 'rock') {
    for (let i = 0; i < Math.min(160, 16 * Math.max(1, Math.round(Math.max(w, h) / Math.max(1, Math.min(w, h))))); i++) { g.fillStyle = i % 2 ? rgba('#ffffff', 0.12) : rgba('#000000', 0.12); g.beginPath(); g.arc((hash(seed + i) - 0.5) * w, (hash(seed + i + 40) - 0.5) * h, Math.min(w, h) * (0.03 + hash(seed + i + 80) * 0.06), 0, TAU); g.fill(); }
    if (mat === 'rock') { g.fillStyle = '#5fa04a'; g.fillRect(-w, -h / 2 - 1, w * 2, Math.max(2, h * 0.16)); g.fillStyle = '#86c45c'; g.fillRect(-w, -h / 2 - 1, w * 2, Math.max(1, h * 0.06)); }
  } else if (mat === 'glass' || mat === 'ice') {
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.moveTo(-w / 2, -h * 0.1); g.lineTo(-w * 0.3, -h / 2); g.lineTo(-w * 0.15, -h / 2); g.lineTo(-w / 2, h * 0.1); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(-w / 2, -h / 2, w, Math.max(1, h * 0.06));
  } else if (mat === 'metal') {
    g.strokeStyle = rgba('#ffffff', 0.12); g.lineWidth = 1; for (let i = -8; i <= 8; i++) { g.beginPath(); g.moveTo(-w / 2, (i / 8) * h / 2); g.lineTo(w / 2, (i / 8) * h / 2 + h * 0.05); g.stroke(); }
    g.fillStyle = M.dark; for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { g.beginPath(); g.arc(sx * (w / 2 - R * 0.14), sy * (h / 2 - R * 0.14), Math.max(1, R * 0.05), 0, TAU); g.fill(); }
  } else if (mat === 'tnt') {
    g.fillStyle = rgba('#2a0806', 0.55); g.fillRect(-w / 2, -h * 0.08, w, h * 0.16);
    if (g.fillText) { g.font = `900 ${Math.max(6, Math.min(w, h) * 0.34)}px "Avenir Next", system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#ffe9a8'; g.fillText(o.label || 'TNT', 0, 1); }
  } else if (mat === 'rubber') {
    g.strokeStyle = rgba('#ffffff', 0.15); g.lineWidth = Math.max(1, R * 0.08); g.beginPath(); g.arc(0, 0, R * 0.7, 0, TAU); g.stroke();
  }
  // Damage cracks stay inside the shape.
  if (mat !== 'rock') cracks(g, seed, 0, 0, Math.min(R * 1.4, Math.min(o.w || R * 2, o.h || R * 2) * 1.2), o.damage || 0);
  g.restore();
  // Outline and bevel (rebuild the path: the details above replaced it).
  buildPath();
  g.lineJoin = 'round';
  const minSide = Math.min(o.w || R * 2, o.h || R * 2);
  g.strokeStyle = mat === 'glass' || mat === 'ice' ? 'rgba(235,250,255,0.95)' : shade(M.dark, 0.35); g.lineWidth = Math.min(4, Math.max(1, minSide * 0.05)); g.stroke();
  if (!o.circle && mat !== 'glass') { g.save(); g.clip(); g.strokeStyle = rgba('#ffffff', 0.2); g.lineWidth = Math.min(6, Math.max(2, minSide * 0.1)); g.stroke(); g.restore(); }
  if (o.circle) { g.fillStyle = 'rgba(255,255,255,0.3)'; g.beginPath(); g.arc(cx - R * 0.35, cy - R * 0.35, R * 0.28, 0, TAU); g.fill(); }
  if (o.flash > 0) { g.globalAlpha = Math.min(1, o.flash); g.fillStyle = '#ffffff'; buildPath(); g.fill(); }
  g.restore();
}

