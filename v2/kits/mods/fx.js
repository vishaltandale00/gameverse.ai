// Drawing helpers shared by the mods: render-side particles, rings, the HUD badge and hp bars.
// Everything here is cosmetic and lives in the renderer's fx object, never in game state.
// Randomness is a small seeded generator, so even the effects never touch Math.random.
export const TAU = Math.PI * 2;

/**
 * World position of the centre of grid tile (i, j). Without a `cell` in size(), tiles are the
 * world units themselves (tile (3, 4) is centred at 3, 4); with one, tile (i, j) covers
 * [x0 + i·w, x0 + (i+1)·w] × [y0 + j·h, y0 + (j+1)·h].
 */
export function tileCenter(size, i, j) {
  const c = size?.cell;
  return c ? [c.x0 + (i + 0.5) * c.w, c.y0 + (j + 0.5) * c.h] : [i, j];
}
/** The grid tile containing world point (x, y); the inverse of tileCenter. */
export function tileAt(size, x, y) {
  const c = size?.cell;
  return c ? [Math.floor((x - c.x0) / c.w), Math.floor((y - c.y0) / c.h)] : [Math.round(x), Math.round(y)];
}

/** A tiny deterministic generator for cosmetic jitter (mulberry32). */
export function fxRandom(fx, seed = 7) {
  if (fx.seed == null) fx.seed = seed >>> 0 || 1;
  let t = (fx.seed = (fx.seed + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Advance the renderer clock; returns dt in seconds (0 while paused). */
export function tick(fx, frame) {
  const dt = frame.paused ? 0 : Math.min(0.1, frame.dt ?? 1 / 60);
  fx.t = (fx.t || 0) + dt;
  fx.parts ??= []; fx.rings ??= [];
  for (const p of fx.parts) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (p.g || 0) * dt; }
  fx.parts = fx.parts.filter(p => p.life > 0);
  for (const r of fx.rings) r.life -= dt;
  fx.rings = fx.rings.filter(r => r.life > 0);
  if (fx.flash > 0) fx.flash = Math.max(0, fx.flash - dt * 2.5);
  return dt;
}

/** A burst of n particles at world x, y (units: world units per second). */
export function burst(fx, x, y, color, n = 10, speed = 4, { life = 0.6, size = 0.18, g = 0 } = {}) {
  fx.parts ??= [];
  for (let i = 0; i < n && fx.parts.length < 400; i++) {
    const a = fxRandom(fx) * TAU, v = speed * (0.35 + fxRandom(fx) * 0.65);
    fx.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: life * (0.6 + fxRandom(fx) * 0.4), max: life, color, size: size * (0.6 + fxRandom(fx) * 0.6), g });
  }
}
/** An expanding ring at world x, y. */
export function ring(fx, x, y, color, r = 1.5, life = 0.45) { (fx.rings ??= []).push({ x, y, color, r, life, max: life }); }

/** Draw the particles and rings in world units through view. */
export function drawFx(g, fx, view, reduced = false) {
  const { X, Y, s } = view;
  for (const r of fx.rings || []) {
    const k = 1 - r.life / r.max;
    g.globalAlpha = Math.max(0, 1 - k) * 0.9;
    g.strokeStyle = r.color; g.lineWidth = Math.max(1, s * 0.12 * (1 - k));
    g.beginPath(); g.arc(X(r.x), Y(r.y), s * r.r * (0.3 + k), 0, TAU); g.stroke();
  }
  for (const p of fx.parts || []) {
    g.globalAlpha = Math.max(0, Math.min(1, p.life / p.max * 1.4));
    g.fillStyle = p.color;
    const r = Math.max(1, s * p.size * (reduced ? 0.8 : 1));
    g.beginPath(); g.arc(X(p.x), Y(p.y), r, 0, TAU); g.fill();
  }
  g.globalAlpha = 1;
}

/** Clip to the play area when the kit gives one. */
export function clipTo(g, view) {
  if (view.clip) { g.beginPath(); g.rect(view.clip.x, view.clip.y, view.clip.w, view.clip.h); g.clip(); }
}

const rounded = (g, x, y, w, h, r) => { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); };

/**
 * The mod's HUD badge in its slot (view.hud from composeRenderer): a pill with a label and an
 * optional progress bar (0..1) underneath. pop (0..1) briefly enlarges it.
 */
export function badge(g, view, label, color, { progress = null, pop = 0, alert = false } = {}) {
  if (!view.hud) return;
  const s = view.s, x = view.hud.x, y = view.hud.y, size = Math.max(10, Math.min(s * 0.7, 18)) * (1 + pop * 0.25);
  g.save();
  g.font = `800 ${size}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  const tw = g.measureText ? g.measureText(label).width : label.length * size * 0.6;
  const w = Math.min(view.hud.w || Infinity, tw + size * 1.6), h = size * 1.6;
  g.fillStyle = 'rgba(8,10,20,.74)'; rounded(g, x - w / 2, y - h / 2, w, h, h / 2); g.fill();
  if (alert) { g.strokeStyle = color; g.lineWidth = 1.5; g.stroke(); }
  g.fillStyle = color; g.fillText(label, x, y + 1, w - size * 0.6);
  if (progress != null) {
    const bw = w - h * 0.8, by = y + h / 2 - 3;
    g.fillStyle = 'rgba(255,255,255,.16)'; g.fillRect(x - bw / 2, by, bw, 2);
    g.fillStyle = color; g.fillRect(x - bw / 2, by, bw * Math.max(0, Math.min(1, progress)), 2);
  }
  g.restore();
}

/** An hp bar of width w (world units) centred above world x, y. */
export function hpBar(g, view, x, y, w, k, color = '#ff4b5c') {
  const { X, Y, s } = view, px = X(x), py = Y(y), bw = w * s, bh = Math.max(4, s * 0.22);
  g.fillStyle = 'rgba(0,0,0,.6)'; rounded(g, px - bw / 2 - 2, py - bh / 2 - 2, bw + 4, bh + 4, bh); g.fill();
  const grad = g.createLinearGradient ? g.createLinearGradient(px - bw / 2, 0, px + bw / 2, 0) : null;
  if (grad) { grad.addColorStop(0, k > 0.3 ? color : '#ffd23a'); grad.addColorStop(1, '#ffffff'); }
  g.fillStyle = grad || color; rounded(g, px - bw / 2, py - bh / 2, bw * Math.max(0, Math.min(1, k)), bh, bh / 2); g.fill();
}

/** Text in screen space with a soft glow. */
export function label(g, text, x, y, size, color, glow = 0) {
  g.save();
  g.font = `900 ${Math.max(9, size)}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  if (glow) { g.shadowColor = color; g.shadowBlur = glow; }
  g.fillStyle = color; g.fillText(text, x, y);
  g.restore();
}

/** Shared schema helpers for the mods' strict-mode fragments. */
export const str = description => ({ type: 'string', description });
export const int = description => ({ type: 'integer', description });
export const bool = description => ({ type: 'boolean', description });
export const enumOf = (list, description) => ({ type: 'string', enum: list, description });
export const obj = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
export const pick = (v, list, d) => list.includes(v) ? v : d;
export const clampInt = (v, lo, hi, d) => Math.round(Math.min(hi, Math.max(lo, Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d)));
export const color = (v, d) => /^#[0-9a-f]{6}$/i.test(v || '') ? v : d;
export const name = (v, d) => typeof v === 'string' && v.trim() ? v.trim().slice(0, 24) : d;
