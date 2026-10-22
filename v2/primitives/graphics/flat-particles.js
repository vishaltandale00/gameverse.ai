// 2D particle engine for presentation. Particles live in WORLD units of one
// space (y up), update on the presentation clock and draw in two passes:
// normal (dust, smoke, debris, leaves, rain, snow, splash, shards, confetti)
// under the lighting layer, additive (sparks, embers, glows, rings, stars)
// above it. Seeded, budgeted, and free of rt.state.
import { TAU, rgba, light, shade, col, rng, clamp01 } from './flat-util.js';

export const SHAPES = ['dust', 'spark', 'smoke', 'debris', 'rain', 'snow', 'ember', 'leaf', 'splash', 'glow', 'confetti', 'ring', 'star', 'shard', 'bubble'];
const ADDITIVE = new Set(['spark', 'ember', 'glow', 'ring', 'star']);
// Per-shape emission: spread (radians around dir), speed jitter, size (units), drag, grow, upward bias.
const LOOK = {
  dust: { spread: Math.PI * 0.9, up: 0.6, size: 0.18, drag: 3, grow: 1.6, fade: 'out' },
  spark: { spread: TAU, up: 0, size: 0.06, drag: 2.5, grow: -0.5, fade: 'out' },
  smoke: { spread: Math.PI * 0.6, up: 1, size: 0.3, drag: 1.4, grow: 2.2, fade: 'inout' },
  debris: { spread: Math.PI * 1.1, up: 0.8, size: 0.12, drag: 0.6, grow: 0, fade: 'late' },
  rain: { spread: 0.08, up: -1, size: 0.05, drag: 0, grow: 0, fade: 'none' },
  snow: { spread: 0.6, up: -1, size: 0.07, drag: 1.2, grow: 0, fade: 'late' },
  ember: { spread: Math.PI * 0.5, up: 1, size: 0.06, drag: 1, grow: -0.3, fade: 'flicker' },
  leaf: { spread: 0.8, up: -0.6, size: 0.12, drag: 1.5, grow: 0, fade: 'late' },
  splash: { spread: Math.PI * 0.55, up: 1, size: 0.07, drag: 0.4, grow: 0, fade: 'late' },
  glow: { spread: TAU, up: 0.2, size: 0.22, drag: 1.8, grow: 0.4, fade: 'inout' },
  confetti: { spread: Math.PI * 0.7, up: 1, size: 0.1, drag: 1.6, grow: 0, fade: 'late' },
  ring: { spread: 0, up: 0, size: 0.2, drag: 0, grow: 9, fade: 'out' },
  star: { spread: TAU, up: 0.4, size: 0.14, drag: 2.2, grow: -0.4, fade: 'out' },
  shard: { spread: Math.PI * 1.2, up: 0.9, size: 0.16, drag: 0.3, grow: 0, fade: 'late' },
  bubble: { spread: 0.5, up: 1, size: 0.09, drag: 1, grow: 0.3, fade: 'late' },
};
const CONFETTI = ['#ff5a7a', '#ffd23f', '#5fe36a', '#4fd8ff', '#c86bff', '#ff9a3a'];

/** Built-in presets (the juice every game gets). */
export const DEFAULT_PRESETS = [
  { id: 'land_dust', shape: 'dust', color: '#c8bca8', count: 8, life: 0.45, speed: 2.2, gravity: 0.5 },
  { id: 'jump_puff', shape: 'dust', color: '#d8d0c0', count: 5, life: 0.35, speed: 1.6, gravity: 0.3 },
  { id: 'run_dust', shape: 'dust', color: '#c8bca8', count: 1, life: 0.35, speed: 0.8, gravity: 0.4 },
  { id: 'sparkle', shape: 'star', color: '#fff2a0', count: 10, life: 0.55, speed: 3, gravity: -0.5 },
  { id: 'impact', shape: 'spark', color: '#fff0c0', count: 10, life: 0.24, speed: 9, gravity: 0 },
  { id: 'hurt', shape: 'spark', color: '#ff5a5a', count: 8, life: 0.3, speed: 6, gravity: 2 },
  { id: 'defeat', shape: 'debris', color: '#9a8a9a', count: 14, life: 0.8, speed: 6, gravity: 14 },
  { id: 'defeat_ring', shape: 'ring', color: '#ffffff', count: 1, life: 0.35, speed: 0, gravity: 0 },
  { id: 'poof', shape: 'smoke', color: '#d8d0e8', count: 6, life: 0.6, speed: 1.4, gravity: -0.3 },
  { id: 'break', shape: 'debris', color: '#8a7a6a', count: 10, life: 0.7, speed: 5, gravity: 16 },
  { id: 'shards', shape: 'shard', color: '#bfe8ff', count: 12, life: 0.9, speed: 6, gravity: 14 },
  { id: 'muzzle', shape: 'spark', color: '#ffe080', count: 4, life: 0.12, speed: 5, gravity: 0 },
  { id: 'confetti', shape: 'confetti', color: '#ffffff', count: 40, life: 1.6, speed: 7, gravity: 6 },
];
export const DEFAULT_BINDS = [
  { event: 'jump', preset: 'jump_puff', at: 'feet' }, { event: 'jumped', preset: 'jump_puff', at: 'feet' },
  { event: 'land', preset: 'land_dust', at: 'feet' }, { event: 'landed', preset: 'land_dust', at: 'feet' },
  { event: 'collect', preset: 'sparkle', at: 'source' }, { event: 'item_gained', preset: 'sparkle', at: 'self' },
  { event: 'hit', preset: 'impact', at: 'target' }, { event: 'hurt', preset: 'hurt', at: 'self' }, { event: 'damaged', preset: 'hurt', at: 'target' },
  { event: 'stomp', preset: 'land_dust', at: 'target' }, { event: 'defeated', preset: 'defeat', at: 'target' }, { event: 'defeated', preset: 'defeat_ring', at: 'target' }, { event: 'defeated', preset: 'poof', at: 'target' },
  { event: 'shoot', preset: 'muzzle', at: 'self' }, { event: 'explode', preset: 'defeat', at: 'self' }, { event: 'explode', preset: 'poof', at: 'self' },
  { event: 'reach_goal', preset: 'confetti', at: 'self' }, { event: 'game_end', preset: 'confetti', at: 'player' },
];

export function createParticles({ budget = 3000, seed = 7 } = {}) {
  const r = rng(seed);
  const P = {
    list: [], budget,
    emit(preset, at, space, { dir = null, count, color, speed, scale = 1 } = {}) {
      const L = LOOK[preset.shape] || LOOK.dust;
      const n = Math.max(1, Math.round((count ?? preset.count ?? 6) * scale));
      const base = col(color || preset.color, '#ffffff');
      const sp = speed ?? preset.speed ?? 3;
      const a0 = dir ? Math.atan2(dir[1], dir[0]) : Math.PI / 2;
      for (let i = 0; i < n && P.list.length < P.budget; i++) {
        const a = L.spread >= TAU - 0.01 ? r() * TAU : a0 + (r() - 0.5) * L.spread;
        const v = sp * (0.35 + r() * 0.65);
        let vx = Math.cos(a) * v, vy = Math.sin(a) * v;
        if (!dir) vy += L.up * sp * 0.3;
        const life = (preset.life ?? 0.6) * (0.6 + r() * 0.5);
        const c = preset.shape === 'confetti' ? CONFETTI[Math.floor(r() * CONFETTI.length)] : r() < 0.3 ? light(base, 0.25) : r() < 0.3 ? shade(base, 0.2) : base;
        P.list.push({ x: at[0] + (r() - 0.5) * 0.2, y: at[1] + (r() - 0.5) * 0.15, vx, vy, life, max: life, size: (preset.size ?? L.size) * (0.7 + r() * 0.6) * (scale > 1 ? Math.sqrt(scale) : 1), color: c, shape: preset.shape || 'dust', g: preset.gravity ?? 0, drag: preset.drag ?? L.drag, grow: L.grow, fade: L.fade, rot: r() * TAU, spin: (r() - 0.5) * 10, space, seed: r() });
      }
    },
    update(dt) {
      for (const p of P.list) {
        p.life -= dt;
        const d = Math.exp(-p.drag * dt);
        p.vx *= d; p.vy = p.vy * d - p.g * dt;
        if (p.shape === 'snow' || p.shape === 'leaf') p.vx += Math.sin((p.max - p.life) * 3 + p.seed * 10) * dt * 1.5;
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.spin * dt;
        p.size = Math.max(0.005, p.size * (1 + p.grow * dt));
      }
      P.list = P.list.filter(p => p.life > 0);
    },
    /** Draw particles of a space. pass: 'normal' | 'additive'. */
    draw(F, space, pass) {
      const g = F.ctx, u = F.unit;
      const add = pass === 'additive';
      g.save();
      if (add) g.globalCompositeOperation = 'lighter';
      for (const p of P.list) {
        if (p.space !== space || ADDITIVE.has(p.shape) !== add) continue;
        const k = clamp01(p.life / p.max), [x, y] = F.toScreen([p.x, p.y]), s = Math.max(0.6, p.size * u);
        if (x < -40 || y < -40 || x > F.w + 40 || y > F.h + 40) continue;
        const a = p.fade === 'out' ? k : p.fade === 'inout' ? Math.sin(k * Math.PI) : p.fade === 'flicker' ? k * (0.6 + 0.4 * Math.sin(p.life * 40 + p.seed * 9)) : p.fade === 'late' ? Math.min(1, k * 3) : 1;
        g.globalAlpha = clamp01(a);
        switch (p.shape) {
          case 'spark': { const len = Math.min(1.8, Math.hypot(p.vx, p.vy) * 0.035) * u; const ang = Math.atan2(-p.vy, p.vx); g.strokeStyle = p.color; g.lineWidth = Math.max(1, s); g.lineCap = 'round'; g.beginPath(); g.moveTo(x, y); g.lineTo(x - Math.cos(ang) * len, y - Math.sin(ang) * len); g.stroke(); break; }
          case 'rain': g.strokeStyle = rgba(p.color, 0.7); g.lineWidth = Math.max(1, s * 0.6); g.beginPath(); g.moveTo(x, y); g.lineTo(x - p.vx * 0.03 * u, y + p.vy * 0.03 * u); g.stroke(); break;
          case 'smoke': case 'dust': case 'glow': case 'bubble': case 'snow': case 'ember': {
            if (p.shape === 'glow' && g.createRadialGradient) { const gr = g.createRadialGradient(x, y, 0, x, y, s * 2); gr.addColorStop(0, rgba(p.color, 0.9)); gr.addColorStop(1, rgba(p.color, 0)); g.fillStyle = gr; g.beginPath(); g.arc(x, y, s * 2, 0, TAU); g.fill(); break; }
            if (p.shape === 'bubble') { g.strokeStyle = rgba(p.color, 0.7); g.lineWidth = 1; g.beginPath(); g.arc(x, y, s, 0, TAU); g.stroke(); break; }
            g.fillStyle = p.shape === 'smoke' ? rgba(p.color, 0.35) : p.color; g.beginPath(); g.arc(x, y, s, 0, TAU); g.fill(); break;
          }
          case 'ring': g.strokeStyle = p.color; g.lineWidth = Math.max(1, u * 0.08 * k); g.beginPath(); g.arc(x, y, s, 0, TAU); g.stroke(); break;
          case 'star': { g.fillStyle = p.color; g.save(); g.translate(x, y); g.rotate(p.rot); g.beginPath(); g.moveTo(0, -s); g.lineTo(s * 0.25, -s * 0.25); g.lineTo(s, 0); g.lineTo(s * 0.25, s * 0.25); g.lineTo(0, s); g.lineTo(-s * 0.25, s * 0.25); g.lineTo(-s, 0); g.lineTo(-s * 0.25, -s * 0.25); g.closePath(); g.fill(); g.restore(); break; }
          case 'leaf': g.fillStyle = p.color; g.save(); g.translate(x, y); g.rotate(p.rot); g.beginPath(); g.ellipse(0, 0, s, s * 0.45, 0, 0, TAU); g.fill(); g.restore(); break;
          case 'shard': g.fillStyle = p.color; g.save(); g.translate(x, y); g.rotate(p.rot); g.beginPath(); g.moveTo(-s, -s * 0.4); g.lineTo(s, -s * 0.1); g.lineTo(-s * 0.2, s * 0.7); g.closePath(); g.fill(); g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 1; g.stroke(); g.restore(); break;
          case 'confetti': g.fillStyle = p.color; g.save(); g.translate(x, y); g.rotate(p.rot); g.scale(1, Math.abs(Math.cos(p.rot * 2))); g.fillRect(-s, -s * 0.5, s * 2, s); g.restore(); break;
          default: g.fillStyle = p.color; g.save(); g.translate(x, y); g.rotate(p.rot); g.fillRect(-s, -s * 0.6, s * 2, s * 1.2); g.restore();
        }
      }
      g.restore();
    },
    clear() { P.list.length = 0; },
  };
  return P;
}

