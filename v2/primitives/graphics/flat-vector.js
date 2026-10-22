// Vector sprites drawn in code: arcade enemy shapes, invader bitmaps, seeded
// rocks, puzzle pieces (gems, blobs, viruses, capsules), maze ghosts and the
// chomper, ships, pickups. Every preset draws centered at the origin inside
// radius R (CSS px, y down) and animates from `t`. Shapes lists let a model
// compose its own sprite from circles, rects, polygons and stars.
import { TAU, rgba, light, shade, col, hash, rng, roundRect, starPath, polyPath, surface, ctx2d } from './flat-util.js';

export const BITMAPS = {
  crab: [
    ['X.........X', '.X..XXX..X.', '..XXXXXXX..', '.XX.XXX.XX.', 'XXXXXXXXXXX', '..XX.X.XX..', '.X.......X.', 'X.........X'],
    ['.X.......X.', 'X...XXX...X', 'X.XXXXXXX.X', 'XXX.XXX.XXX', '.XXXXXXXXX.', '..XX.X.XX..', '..X.....X..', '.X.......X.'],
  ],
  squid: [
    ['...XX...', '..XXXX..', '.XXXXXX.', 'XX.XX.XX', 'XXXXXXXX', '..X..X..', '.X.XX.X.', 'X.X..X.X'],
    ['...XX...', '..XXXX..', '.XXXXXX.', 'XX.XX.XX', 'XXXXXXXX', '.X.XX.X.', 'X......X', '.X....X.'],
  ],
  octopus: [
    ['....XXXX....', '.XXXXXXXXXX.', 'XXXXXXXXXXXX', 'XXX..XX..XXX', 'XXXXXXXXXXXX', '...XX..XX...', '..XX.XX.XX..', 'XX........XX'],
    ['....XXXX....', '.XXXXXXXXXX.', 'XXXXXXXXXXXX', 'XXX..XX..XXX', 'XXXXXXXXXXXX', '..XXX..XXX..', '.XX..XX..XX.', '..XX....XX..'],
  ],
};
export const GEM_SHAPES = ['circle', 'diamond', 'triangle', 'hexagon', 'star', 'drop'];
export const PRESETS = ['invader-crab', 'invader-squid', 'invader-octopus', 'bug', 'moth', 'saucer', 'diamond', 'pinwheel', 'fighter', 'orb', 'drone', 'rock', 'gem', 'blob', 'virus', 'capsule', 'ghost', 'chomp', 'ship', 'coin', 'star', 'heart', 'key', 'bullet', 'crate', 'bomb', 'block', 'shapes'];

const glowCache = new Map();
/** Additive soft glow (cached gradient sprite). */
export function glow(g, x, y, r, color, a = 1) {
  if (r <= 0 || a <= 0 || !g.drawImage) return;
  let s = glowCache.get(color);
  if (s === undefined) {
    s = surface(64, 64); const c = ctx2d(s);
    if (c?.createRadialGradient) { const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, rgba(color, 0.9)); gr.addColorStop(0.3, rgba(color, 0.4)); gr.addColorStop(1, rgba(color, 0)); c.fillStyle = gr; c.fillRect(0, 0, 64, 64); } else s = null;
    glowCache.set(color, s);
  }
  const op = g.globalCompositeOperation, ga = g.globalAlpha;
  g.globalCompositeOperation = 'lighter'; g.globalAlpha = ga * Math.min(1, a);
  if (s) g.drawImage(s, x - r, y - r, r * 2, r * 2); else { g.fillStyle = rgba(color, 0.25); g.beginPath(); g.arc(x, y, r * 0.6, 0, TAU); g.fill(); }
  g.globalCompositeOperation = op; g.globalAlpha = ga;
}

function bitmap(g, rows, R, color) {
  const h = rows.length, w = rows[0].length, cell = (R * 2) / Math.max(w, h);
  g.fillStyle = color;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (rows[j][i] === 'X') g.fillRect((i - w / 2) * cell, (j - h / 2) * cell, cell + 0.15, cell + 0.15);
}
export function gemPath(g, kind, R) {
  g.beginPath();
  if (kind === 'circle') g.arc(0, 0, R, 0, TAU);
  else if (kind === 'diamond') { g.moveTo(0, -R * 1.08); g.lineTo(R, 0); g.lineTo(0, R * 1.08); g.lineTo(-R, 0); g.closePath(); }
  else if (kind === 'triangle') { g.moveTo(0, -R * 1.05); g.lineTo(R * 1.05, R * 0.8); g.lineTo(-R * 1.05, R * 0.8); g.closePath(); }
  else if (kind === 'hexagon') { for (let k = 0; k < 6; k++) { const a = (TAU * k) / 6 + Math.PI / 6; g[k ? 'lineTo' : 'moveTo'](Math.cos(a) * R, Math.sin(a) * R); } g.closePath(); }
  else if (kind === 'star') starPath(g, 0, 0, R * 1.08, R * 0.55);
  else { g.moveTo(0, -R * 1.1); g.bezierCurveTo(R * 0.9, -R * 0.2, R, R * 0.9, 0, R * 0.95); g.bezierCurveTo(-R, R * 0.9, -R * 0.9, -R * 0.2, 0, -R * 1.1); g.closePath(); }
}
const radial = (g, R, stops) => { if (!g.createRadialGradient) return stops[1][1]; const q = g.createRadialGradient(-R * 0.35, -R * 0.4, R * 0.08, 0, 0, R * 1.1); for (const [o, c] of stops) q.addColorStop(o, c); return q; };
function shine(g, x, y, rx, ry, a = 0.8) { g.fillStyle = `rgba(255,255,255,${a})`; g.beginPath(); g.ellipse(x, y, rx, ry, -0.6, 0, TAU); g.fill(); }

function eyesPair(g, R, dir = [1, 0], { pupil = '#1d3bff', small = false } = {}) {
  for (const sx of [-1, 1]) {
    const cx = sx * R * 0.38, cy = -R * 0.18;
    g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(cx + dir[0] * R * 0.08, cy + dir[1] * R * 0.08, R * (small ? 0.2 : 0.27), R * (small ? 0.24 : 0.34), 0, 0, TAU); g.fill();
    g.fillStyle = pupil; g.beginPath(); g.arc(cx + dir[0] * R * 0.2, cy + dir[1] * R * 0.2, R * (small ? 0.1 : 0.14), 0, TAU); g.fill();
  }
}
const rockCache = new Map();
export function rockVerts(seed, n = 11) {
  const key = `${seed}|${n}`;
  if (!rockCache.has(key)) { const r = rng(seed + 1); const v = Array.from({ length: n }, (_, i) => [(i / n) * TAU + (r() - 0.5) * 0.3, 0.72 + r() * 0.32]); v.craters = Array.from({ length: 3 }, () => [(r() - 0.5) * 0.9, (r() - 0.5) * 0.9, 0.12 + r() * 0.12]); rockCache.set(key, v); }
  return rockCache.get(key);
}

/**
 * Draw a preset. opts: { t, dir:[dx,dy] screen unit vector, frame2, flash, seed, idx, mood:'frightened'|'eyes',
 *   pixel, glow (true for neon looks), accent, shapes (for 'shapes'), mouth (0..1 chomp opening) }
 */
export function drawVector(g, preset, R, color, opts = {}) {
  const t = opts.t || 0, c = col(color, '#ff5a7a'), dark = shade(c, 0.45), lite = light(c, 0.45), seed = opts.seed ?? 1;
  const dir = opts.dir || [1, 0], frame2 = opts.frame2 ?? Math.floor(t * 3) % 2 === 1, px = opts.pixel;
  g.save();
  g.lineJoin = 'round'; g.lineCap = 'round'; g.lineWidth = px ? 1 : Math.max(1, R * 0.12); g.strokeStyle = lite;
  const flap = 0.55 + 0.45 * Math.abs(Math.sin(t * 9 + seed));
  switch (preset) {
    case 'invader-crab': case 'invader-squid': case 'invader-octopus': bitmap(g, BITMAPS[preset.slice(8)][frame2 ? 1 : 0], R * 1.1, c); break;
    case 'bug': {
      g.fillStyle = rgba(lite, 0.75);
      for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(sx * R * 0.6, -R * 0.15, R * 0.55, R * 0.32 * flap + 0.5, sx * 0.5, 0, TAU); g.fill(); }
      g.fillStyle = c; g.beginPath(); g.ellipse(0, 0, R * 0.42, R * 0.78, 0, 0, TAU); g.fill(); g.stroke();
      g.fillStyle = dark; for (const y of [-0.3, 0.05]) g.fillRect(-R * 0.4, y * R, R * 0.8, R * 0.14);
      g.fillStyle = lite; g.beginPath(); g.arc(0, R * 0.62, R * 0.3, 0, TAU); g.fill();
      g.fillStyle = '#ffffff'; g.fillRect(-R * 0.2, R * 0.62, R * 0.14, R * 0.14); g.fillRect(R * 0.06, R * 0.62, R * 0.14, R * 0.14);
      break;
    }
    case 'moth': {
      for (const sx of [-1, 1]) {
        g.save(); g.scale(sx * flap, 1);
        g.fillStyle = c; g.beginPath(); g.moveTo(R * 0.1, -R * 0.2); g.quadraticCurveTo(R * 1.25, -R * 1.05, R * 1.05, R * 0.05); g.quadraticCurveTo(R * 0.6, R * 0.1, R * 0.1, R * 0.1); g.fill(); g.stroke();
        g.fillStyle = dark; g.beginPath(); g.moveTo(R * 0.1, R * 0.15); g.quadraticCurveTo(R * 0.9, R * 0.3, R * 0.6, R * 0.85); g.quadraticCurveTo(R * 0.3, R * 0.6, R * 0.1, R * 0.4); g.fill(); g.stroke();
        g.fillStyle = lite; g.beginPath(); g.arc(R * 0.65, -R * 0.35, R * 0.16, 0, TAU); g.fill();
        g.restore();
      }
      g.fillStyle = lite; g.beginPath(); g.ellipse(0, R * 0.05, R * 0.16, R * 0.7, 0, 0, TAU); g.fill();
      break;
    }
    case 'saucer': {
      g.fillStyle = rgba(lite, 0.6); g.beginPath(); g.ellipse(0, -R * 0.25, R * 0.5, R * 0.45, 0, Math.PI, TAU); g.fill();
      g.fillStyle = c; g.beginPath(); g.ellipse(0, 0, R * 1.15, R * 0.42, 0, 0, TAU); g.fill(); g.stroke();
      g.fillStyle = dark; g.fillRect(-R * 0.9, -R * 0.02, R * 1.8, R * 0.12);
      for (let i = 0; i < 6; i++) { const a = t * 4 + (i / 6) * TAU; if (Math.sin(a) <= 0) continue; g.fillStyle = i % 2 ? '#ffffff' : (opts.accent || '#ffd23f'); g.fillRect(Math.cos(a) * R * 0.85 - 1, R * 0.08 - 1, 2.2, 2.2); }
      break;
    }
    case 'diamond': {
      const pulse = 1 + 0.12 * Math.sin(t * 6 + seed);
      g.scale(pulse, 1 / pulse);
      g.beginPath(); g.moveTo(0, -R); g.lineTo(R, 0); g.lineTo(0, R); g.lineTo(-R, 0); g.closePath(); g.fillStyle = rgba(c, 0.25); g.fill(); g.strokeStyle = c; g.lineWidth = px ? 1 : R * 0.18; g.stroke();
      g.beginPath(); g.moveTo(0, -R * 0.45); g.lineTo(R * 0.45, 0); g.lineTo(0, R * 0.45); g.lineTo(-R * 0.45, 0); g.closePath(); g.strokeStyle = lite; g.lineWidth = px ? 1 : R * 0.1; g.stroke();
      break;
    }
    case 'pinwheel': {
      g.rotate(t * 4 + seed);
      for (let k = 0; k < 4; k++) { g.rotate(TAU / 4); g.beginPath(); g.moveTo(0, 0); g.lineTo(R, -R * 0.15); g.lineTo(R * 0.15, -R); g.closePath(); g.fillStyle = k % 2 ? c : rgba(c, 0.4); g.fill(); g.strokeStyle = lite; g.stroke(); }
      break;
    }
    case 'fighter': {
      g.rotate(Math.atan2(dir[1], dir[0]) - Math.PI / 2);
      polyPath(g, [[0, R * 1.1], [R * 0.3, R * 0.2], [R * 1.1, -R * 0.35], [R * 1.0, -R * 0.65], [R * 0.25, -R * 0.45], [R * 0.35, -R * 0.95], [-R * 0.35, -R * 0.95], [-R * 0.25, -R * 0.45], [-R, -R * 0.65], [-R * 1.1, -R * 0.35], [-R * 0.3, R * 0.2]]);
      g.fillStyle = c; g.fill(); g.stroke();
      g.fillStyle = dark; g.beginPath(); g.ellipse(0, R * 0.25, R * 0.16, R * 0.35, 0, 0, TAU); g.fill();
      glow(g, 0, -R * 1.05, R * 0.7 * flap, '#ffb060', 0.8);
      break;
    }
    case 'orb': {
      const pulse = 1 + 0.08 * Math.sin(t * 5 + seed);
      g.fillStyle = dark; g.beginPath(); g.arc(0, 0, R * 0.95 * pulse, 0, TAU); g.fill();
      g.fillStyle = radial(g, R * 0.8, [[0, '#ffffff'], [0.35, lite], [1, c]]); g.beginPath(); g.arc(0, 0, R * 0.62 * pulse, 0, TAU); g.fill();
      g.strokeStyle = lite; g.lineWidth = px ? 1 : R * 0.14;
      for (let k = 0; k < 3; k++) { const a = t * 2.4 + (k / 3) * TAU; g.beginPath(); g.arc(0, 0, R * 0.95, a, a + 1.2); g.stroke(); }
      break;
    }
    case 'drone': {
      g.save(); g.rotate(t * 1.5 + seed);
      g.beginPath(); for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU + Math.PI / 6; g.lineTo(Math.cos(a) * R, Math.sin(a) * R); } g.closePath();
      g.fillStyle = dark; g.fill(); g.stroke(); g.restore();
      g.fillStyle = c; g.beginPath(); g.arc(0, 0, R * 0.55, 0, TAU); g.fill();
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(dir[0] * R * 0.2, dir[1] * R * 0.2, R * 0.2, 0, TAU); g.fill();
      break;
    }
    case 'rock': {
      const v = rockVerts(seed);
      g.rotate(t * 0.4 * (hash(seed) - 0.5));
      g.beginPath(); v.forEach(([a, k], i) => { const x = Math.cos(a) * R * k, y = Math.sin(a) * R * k; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath();
      g.fillStyle = radial(g, R, [[0, light(c, 0.2)], [0.5, c], [1, shade(c, 0.4)]]); g.fill();
      g.lineWidth = px ? 1 : Math.max(1, R * 0.08); g.strokeStyle = shade(c, 0.55); g.stroke();
      g.strokeStyle = rgba(shade(c, 0.3), 0.7); g.lineWidth = Math.max(1, R * 0.05);
      for (const [cx, cy, cr] of v.craters) { g.beginPath(); g.arc(cx * R, cy * R, cr * R, 0, TAU); g.stroke(); }
      shine(g, -R * 0.3, -R * 0.35, R * 0.22, R * 0.1, 0.35);
      break;
    }
    case 'gem': {
      const kind = GEM_SHAPES[((opts.idx ?? seed) % GEM_SHAPES.length + GEM_SHAPES.length) % GEM_SHAPES.length];
      const RR = R * 0.92;
      g.save(); if (g.shadowColor !== undefined) { g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = R * 0.15; g.shadowOffsetY = R * 0.1; }
      gemPath(g, kind, RR); g.fillStyle = shade(c, 0.3); g.fill(); g.restore();
      gemPath(g, kind, RR * 0.94); g.fillStyle = radial(g, RR, [[0, light(c, 0.55)], [0.45, c], [1, shade(c, 0.35)]]); g.fill();
      g.save(); g.translate(0, -RR * 0.04); gemPath(g, kind, RR * 0.5); g.fillStyle = rgba(light(c, 0.4), 0.55); g.fill(); g.restore();
      g.save(); gemPath(g, kind, RR * 0.94); g.clip(); g.fillStyle = 'rgba(255,255,255,.28)'; g.beginPath(); g.ellipse(-RR * 0.15, -RR * 0.55, RR * 0.75, RR * 0.35, -0.3, 0, TAU); g.fill(); shine(g, -RR * 0.3, -RR * 0.3, RR * 0.14, RR * 0.09, 0.9); g.restore();
      // A traveling glint.
      const gl = (t * 0.5 + hash(seed)) % 3; if (gl < 0.4) { g.save(); gemPath(g, kind, RR * 0.94); g.clip(); g.fillStyle = 'rgba(255,255,255,.5)'; g.rotate(0.6); g.fillRect(-RR * 1.4 + gl * RR * 7, -RR * 1.5, RR * 0.22, RR * 3); g.restore(); }
      gemPath(g, kind, RR * 0.94); g.lineWidth = Math.max(1, R * 0.07); g.strokeStyle = rgba(shade(c, 0.55), 0.9); g.stroke();
      break;
    }
    case 'blob': {
      const sq = opts.squash ?? Math.sin(t * 3 + seed) * 0.05;
      g.scale(1 + sq, 1 - sq);
      g.fillStyle = radial(g, R, [[0, light(c, 0.5)], [0.5, c], [1, shade(c, 0.35)]]); g.beginPath(); g.arc(0, 0, R * 0.9, 0, TAU); g.fill();
      g.lineWidth = Math.max(1, R * 0.08); g.strokeStyle = rgba(shade(c, 0.55), 0.85); g.stroke();
      shine(g, -R * 0.36, -R * 0.4, R * 0.2, R * 0.12, 0.75);
      if (opts.eyes !== false) for (const ex of [-0.3, 0.3]) {
        const blink = (t + hash(seed) * 5) % 4 < 0.12;
        g.fillStyle = '#fff'; g.beginPath(); g.ellipse(ex * R, -R * 0.02, R * 0.18, blink ? R * 0.03 : R * 0.23, 0, 0, TAU); g.fill();
        if (!blink) { g.fillStyle = '#1a1626'; g.beginPath(); g.arc(ex * R + dir[0] * R * 0.06, R * 0.05 + dir[1] * R * 0.04, R * 0.1, 0, TAU); g.fill(); }
      }
      break;
    }
    case 'virus': {
      const wob = Math.sin(t * 7 + seed) * 0.08; g.scale(1 + wob, 1 - wob);
      g.beginPath(); for (let k = 0; k < 16; k++) { const a = (TAU * k) / 16 + t * 0.6, r = k % 2 ? R * 0.74 : R * 0.95; g[k ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); } g.closePath();
      g.fillStyle = radial(g, R, [[0, light(c, 0.35)], [1, shade(c, 0.3)]]); g.fill(); g.lineWidth = Math.max(1, R * 0.08); g.strokeStyle = shade(c, 0.6); g.stroke();
      const hurt = opts.mood === 'hurt';
      g.fillStyle = '#fff'; for (const ex of [-0.3, 0.3]) { g.beginPath(); g.ellipse(ex * R, -R * 0.1, R * 0.17, hurt ? R * 0.05 : R * 0.2, 0, 0, TAU); g.fill(); }
      g.fillStyle = '#16121e'; if (!hurt) for (const ex of [-0.3, 0.3]) { g.beginPath(); g.arc(ex * R + Math.sin(t * 2) * R * 0.04, -R * 0.05, R * 0.08, 0, TAU); g.fill(); }
      g.strokeStyle = '#16121e'; g.lineWidth = Math.max(1, R * 0.08);
      g.beginPath(); g.moveTo(-R * 0.48, -R * 0.38); g.lineTo(-R * 0.14, -R * 0.26); g.moveTo(R * 0.48, -R * 0.38); g.lineTo(R * 0.14, -R * 0.26); g.stroke();
      g.beginPath(); g.arc(0, R * 0.42, R * 0.2, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
      break;
    }
    case 'capsule': {
      const ang = Math.atan2(dir[1], dir[0]); g.rotate(ang);
      const w = R * 1.9, h = R * 0.95, c2 = opts.accent ? col(opts.accent) : light(c, 0.1);
      g.save(); roundRect(g, -w / 2, -h / 2, w, h, h / 2); g.clip();
      for (const [x0, cc] of [[-w / 2, c], [0, c2]]) { const gr = g.createLinearGradient ? g.createLinearGradient(0, -h / 2, 0, h / 2) : cc; if (gr.addColorStop) { gr.addColorStop(0, light(cc, 0.4)); gr.addColorStop(0.5, cc); gr.addColorStop(1, shade(cc, 0.3)); } g.fillStyle = gr; g.fillRect(x0, -h / 2, w / 2, h); }
      g.restore();
      roundRect(g, -w / 2, -h / 2, w, h, h / 2); g.lineWidth = Math.max(1, R * 0.08); g.strokeStyle = rgba(shade(c, 0.6), 0.9); g.stroke();
      g.beginPath(); g.moveTo(0, -h / 2); g.lineTo(0, h / 2); g.stroke();
      shine(g, -w * 0.25, -h * 0.2, w * 0.14, h * 0.1, 0.55);
      break;
    }
    case 'ghost': {
      const fright = opts.mood === 'frightened', eyesOnly = opts.mood === 'eyes';
      const body = fright ? (Math.floor(t * 6) % 2 && opts.ending ? '#f2f4ff' : '#2a3cff') : c;
      if (!eyesOnly) {
        g.fillStyle = body; g.beginPath(); g.moveTo(-R, R * 0.85); g.lineTo(-R, -R * 0.05); g.arc(0, -R * 0.05, R, Math.PI, 0); g.lineTo(R, R * 0.85);
        const n = 6, wave = Math.floor(t * 8) % 2;
        for (let k = 1; k <= n; k++) g.lineTo(R - (2 * R * k) / n, (k + wave) % 2 ? R * 0.55 : R * 0.95);
        g.closePath(); g.fill();
        if (!fright) shine(g, -R * 0.45, -R * 0.55, R * 0.18, R * 0.1, 0.35);
      }
      if (fright) {
        g.fillStyle = '#ffd0d0'; for (const sx of [-1, 1]) { g.beginPath(); g.arc(sx * R * 0.34, -R * 0.2, R * 0.12, 0, TAU); g.fill(); }
        g.strokeStyle = '#ffd0d0'; g.lineWidth = Math.max(1, R * 0.1); g.beginPath(); for (let k = 0; k <= 6; k++) g.lineTo(-R * 0.6 + (k * R * 1.2) / 6, R * 0.3 + (k % 2 ? -R * 0.12 : 0)); g.stroke();
      } else eyesPair(g, R, dir, { small: eyesOnly });
      break;
    }
    case 'chomp': {
      const mouth = opts.mouth ?? (0.05 + 0.33 * Math.abs(Math.sin(t * 14)));
      const ang = Math.atan2(dir[1], dir[0]);
      g.fillStyle = radial(g, R, [[0, light(c, 0.35)], [0.6, c], [1, shade(c, 0.2)]]);
      g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R, ang + mouth * Math.PI * 0.5, ang + TAU - mouth * Math.PI * 0.5); g.closePath(); g.fill();
      const ea = Math.cos(ang) < -0.1 ? ang + 1.2 : ang - 1.2;
      g.fillStyle = '#1a1626'; g.beginPath(); g.arc(Math.cos(ea) * R * 0.5, Math.sin(ea) * R * 0.5, R * 0.1, 0, TAU); g.fill();
      break;
    }
    case 'ship': {
      g.rotate(Math.atan2(dir[1], dir[0]) + Math.PI / 2);
      const s = R / 13; g.scale(s, s);
      const kind = opts.variant || 'arrow';
      const flick = 0.7 + 0.3 * Math.sin(t * 50);
      glow(g, 0, 10, 8 * flick, light(c, 0.3), 0.8);
      g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.moveTo(-2.5, 7); g.lineTo(0, 7 + 7 * flick); g.lineTo(2.5, 7); g.fill();
      g.beginPath();
      if (kind === 'delta') { g.moveTo(0, -12); g.lineTo(11, 8); g.lineTo(4, 5); g.lineTo(0, 8); g.lineTo(-4, 5); g.lineTo(-11, 8); }
      else if (kind === 'needle') { g.moveTo(0, -15); g.lineTo(3, -2); g.lineTo(9, 6); g.lineTo(3, 5); g.lineTo(2, 9); g.lineTo(-2, 9); g.lineTo(-3, 5); g.lineTo(-9, 6); g.lineTo(-3, -2); }
      else { g.moveTo(0, -13); g.lineTo(4, -4); g.lineTo(11, 6); g.lineTo(4, 4); g.lineTo(0, 7); g.lineTo(-4, 4); g.lineTo(-11, 6); g.lineTo(-4, -4); }
      g.closePath();
      const body = g.createLinearGradient ? g.createLinearGradient(-10, 0, 10, 0) : c; if (body.addColorStop) { body.addColorStop(0, shade(c, 0.55)); body.addColorStop(0.5, light(c, 0.15)); body.addColorStop(1, shade(c, 0.55)); }
      g.fillStyle = px ? shade(c, 0.3) : body; g.fill(); g.lineWidth = px ? 1 : 1.4; g.strokeStyle = light(c, 0.55); g.stroke();
      g.fillStyle = '#e8fbff'; g.beginPath(); g.ellipse(0, -3, 2, 3.6, 0, 0, TAU); g.fill();
      g.fillStyle = opts.accent || '#ffd23f'; g.fillRect(-8, 3, 2.5, 2); g.fillRect(5.5, 3, 2.5, 2);
      break;
    }
    case 'coin': {
      const spin = Math.cos(t * 4 + seed), w = Math.max(0.12, Math.abs(spin));
      g.scale(w, 1);
      g.fillStyle = radial(g, R, [[0, '#fff6c0'], [0.5, c], [1, shade(c, 0.35)]]); g.beginPath(); g.arc(0, 0, R * 0.85, 0, TAU); g.fill();
      g.lineWidth = Math.max(1, R * 0.12); g.strokeStyle = shade(c, 0.45); g.stroke();
      g.strokeStyle = rgba(light(c, 0.5), 0.9); g.lineWidth = Math.max(1, R * 0.08); g.beginPath(); g.arc(0, 0, R * 0.55, 0, TAU); g.stroke();
      if (spin > 0) shine(g, -R * 0.3, -R * 0.35, R * 0.18, R * 0.1, 0.8);
      break;
    }
    case 'star': {
      g.rotate(Math.sin(t * 2 + seed) * 0.15);
      starPath(g, 0, 0, R, R * 0.48); g.fillStyle = radial(g, R, [[0, '#ffffff'], [0.4, c], [1, shade(c, 0.3)]]); g.fill();
      g.lineWidth = Math.max(1, R * 0.1); g.strokeStyle = shade(c, 0.5); g.stroke(); break;
    }
    case 'heart': {
      const b = 1 + 0.08 * Math.max(0, Math.sin(t * 6));
      g.scale(b, b); g.beginPath(); g.moveTo(0, R * 0.85); g.bezierCurveTo(-R * 1.25, -R * 0.05, -R * 0.55, -R * 1.05, 0, -R * 0.4); g.bezierCurveTo(R * 0.55, -R * 1.05, R * 1.25, -R * 0.05, 0, R * 0.85); g.closePath();
      g.fillStyle = radial(g, R, [[0, light(c, 0.45)], [0.5, c], [1, shade(c, 0.3)]]); g.fill(); g.lineWidth = Math.max(1, R * 0.1); g.strokeStyle = shade(c, 0.5); g.stroke();
      shine(g, -R * 0.4, -R * 0.35, R * 0.16, R * 0.1, 0.8); break;
    }
    case 'key': {
      g.rotate(-0.6 + Math.sin(t * 2) * 0.1); g.strokeStyle = shade(c, 0.45); g.fillStyle = c; g.lineWidth = Math.max(1, R * 0.1);
      g.beginPath(); g.arc(-R * 0.45, 0, R * 0.4, 0, TAU); g.fill(); g.stroke();
      g.fillStyle = shade(c, 0.6); g.beginPath(); g.arc(-R * 0.45, 0, R * 0.15, 0, TAU); g.fill();
      g.fillStyle = c; g.fillRect(-R * 0.1, -R * 0.12, R * 1.1, R * 0.24); g.fillRect(R * 0.65, 0, R * 0.16, R * 0.38); g.fillRect(R * 0.35, 0, R * 0.14, R * 0.3); break;
    }
    case 'bullet': {
      glow(g, 0, 0, R * 2.6, c, 0.7);
      const ang = Math.atan2(dir[1], dir[0]); g.rotate(ang);
      roundRect(g, -R * 1.1, -R * 0.45, R * 2.2, R * 0.9, R * 0.45); g.fillStyle = lite; g.fill();
      g.fillStyle = '#ffffff'; roundRect(g, -R * 0.4, -R * 0.22, R * 1.3, R * 0.44, R * 0.22); g.fill(); break;
    }
    case 'crate': {
      const w = R * 1.8; roundRect(g, -w / 2, -w / 2, w, w, w * 0.1); g.fillStyle = c; g.fill(); g.strokeStyle = shade(c, 0.45); g.lineWidth = Math.max(1, R * 0.08); g.stroke();
      g.save(); roundRect(g, -w / 2, -w / 2, w, w, w * 0.1); g.clip(); g.strokeStyle = rgba(shade(c, 0.35), 0.8);
      for (let k = 1; k < 3; k++) { g.beginPath(); g.moveTo(-w / 2, -w / 2 + (w * k) / 3); g.lineTo(w / 2, -w / 2 + (w * k) / 3); g.stroke(); }
      g.lineWidth = Math.max(1.5, R * 0.14); g.strokeStyle = rgba(light(c, 0.2), 0.9); g.beginPath(); g.moveTo(-w / 2, -w / 2); g.lineTo(w / 2, w / 2); g.stroke(); g.restore(); break;
    }
    case 'bomb': {
      const pulse = 0.5 + 0.5 * Math.sin(t * 10);
      g.fillStyle = radial(g, R, [[0, '#6a6a7a'], [1, '#141420']]); g.beginPath(); g.arc(0, R * 0.1, R * 0.8, 0, TAU); g.fill();
      g.strokeStyle = '#a0805a'; g.lineWidth = Math.max(1, R * 0.12); g.beginPath(); g.moveTo(R * 0.3, -R * 0.55); g.quadraticCurveTo(R * 0.6, -R * 1.0, R * 0.9, -R * 0.85); g.stroke();
      glow(g, R * 0.9, -R * 0.85, R * (0.5 + pulse * 0.4), '#ffb040', 0.9); shine(g, -R * 0.3, -R * 0.2, R * 0.2, R * 0.12, 0.5); break;
    }
    case 'block': {
      const s = R * 1.9, b = Math.max(1.5, s * 0.13), r = s * 0.14; g.translate(-s / 2, -s / 2);
      roundRect(g, 0, 0, s, s, r); g.fillStyle = shade(c, 0.38); g.fill();
      g.save(); g.clip(); g.fillStyle = light(c, 0.38); g.beginPath(); g.moveTo(0, 0); g.lineTo(s, 0); g.lineTo(s - b, b); g.lineTo(b, b); g.lineTo(b, s - b); g.lineTo(0, s); g.closePath(); g.fill();
      roundRect(g, b, b, s - 2 * b, s - 2 * b, r * 0.5); g.fillStyle = c; g.fill();
      g.fillStyle = 'rgba(255,255,255,.3)'; roundRect(g, b * 1.2, b * 1.1, s - 2.4 * b, s * 0.3, r * 0.5); g.fill(); g.restore(); break;
    }
    case 'shapes': drawShapes(g, opts.shapes || [], R, c, t); break;
    default: drawVector(g, 'blob', R, c, opts);
  }
  if (opts.flash > 0) { g.globalCompositeOperation = 'source-atop'; g.globalAlpha = Math.min(1, opts.flash); g.fillStyle = '#ffffff'; g.fillRect(-R * 1.8, -R * 1.8, R * 3.6, R * 3.6); }
  g.restore();
}

/** Author-composed shapes in unit coordinates (-1..1, y down) scaled to R. */
export function drawShapes(g, shapes, R, base, t = 0) {
  for (const s of shapes) {
    const fill = s.color ? col(s.color) : base, [x, y] = (s.at || [0, 0]).map(v => v * R);
    g.save(); g.translate(x, y); if (s.rot) g.rotate((s.rot * Math.PI) / 180); if (s.spin) g.rotate(t * s.spin);
    g.beginPath();
    if (s.shape === 'rect') { const [w, h] = (s.size || [1, 1]).map(v => v * R); roundRect(g, -w / 2, -h / 2, w, h, (s.round || 0) * R); }
    else if (s.shape === 'ellipse') { const [w, h] = (s.size || [1, 1]).map(v => v * R); g.ellipse(0, 0, w / 2, h / 2, 0, 0, TAU); }
    else if (s.shape === 'poly') polyPath(g, (s.points || []).map(([px, py]) => [px * R, py * R]));
    else if (s.shape === 'star') starPath(g, 0, 0, (s.r || 0.5) * R, (s.r || 0.5) * R * (s.inner || 0.45), s.n || 5);
    else g.arc(0, 0, (s.r || 0.5) * R, 0, TAU);
    if (s.fill !== false) { g.fillStyle = s.gradient === false ? fill : radial(g, (s.r || 0.6) * R, [[0, light(fill, 0.35)], [0.55, fill], [1, shade(fill, 0.3)]]); g.fill(); }
    if (s.stroke !== false) { g.lineWidth = Math.max(1, R * (s.lineWidth || 0.08)); g.strokeStyle = s.stroke ? col(s.stroke) : shade(fill, 0.55); g.stroke(); }
    g.restore();
  }
}
