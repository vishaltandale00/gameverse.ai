// Climb drawing: a 9-unit field centred on screen with a rising camera,
// platforms per kind (moving, breaking, spring, vanishing), enemies from the
// chaser's art frames, swirling holes and wraparound at the edges.
import { CLIMB, xOf } from '../modes/climb.js';
import { drawSky } from './backdrop.js';
import { tilePattern, fillTiles, drawCharacter, drawCoin, roundRect, rgba, mixHex, clamp, lerp, TAU, burst, star } from './common.js';
import { bubble } from './side.js';

const hash = n => { let x = Math.imul(n | 0, 0x9e3779b1) ^ 0x85ebca6b; x = Math.imul(x ^ (x >>> 15), 0xc2b2ae35); return ((x ^ (x >>> 13)) >>> 0) / 4294967296; };

export function climbView(state, look, w, h, cam) {
  const W = look.content.rules.width, U = Math.min(w / W, h / 13.5), FW = U * W, ox = (w - FW) / 2;
  cam.y = cam.y == null ? state.p.cam : lerp(cam.y, state.p.cam, 0.12);
  const base = h * 0.6;
  return { U, ox, FW, W, X: x => ox + x * U, Y: y => base - (y - cam.y) * U, camY: cam.y };
}

function platform(ctx, look, o, x, y, U, state, clock, pat) {
  const w = o.w * U, th = U * 0.34, gone = state.gone[o.id];
  const colors = { platform: look.platform, moving: mixHex(look.platform, '#3a9aff', 0.55), breaking: mixHex(look.platform, '#7a4a20', 0.6), spring: look.platform, vanishing: '#f4f6ff' };
  let alpha = 1, dy = 0, split = 0;
  if (gone !== undefined) {
    const t = state.time - gone;
    if (o.t === 'breaking') { split = t; dy = 9 * t * t * U; alpha = clamp(1 - t / 0.7, 0, 1); }
    else if (o.t === 'vanishing') { alpha = clamp(1 - t / 0.3, 0, 1); }
    if (alpha <= 0) return;
  }
  ctx.save(); ctx.globalAlpha = alpha * (o.t === 'vanishing' ? 0.82 + 0.12 * Math.sin(clock * 5 + o.y) : 1);
  const draw = (dx, rot) => {
    ctx.save(); ctx.translate(x + dx, y + dy); if (rot) ctx.rotate(rot);
    roundRect(ctx, -w / 2, 0, w, th, th / 2); ctx.fillStyle = colors[o.t] || look.platform; ctx.fill();
    if (pat && o.t !== 'vanishing') { ctx.save(); ctx.clip(); ctx.globalAlpha *= 0.5; fillTiles(ctx, pat, -w / 2, 0, w, th, U, 0, 0); ctx.restore(); }
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(-w / 2 + th / 2, th * 0.12, w - th, th * 0.18);
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,.45)'; roundRect(ctx, -w / 2, 0, w, th, th / 2); ctx.stroke();
    if (o.t === 'breaking') { ctx.strokeStyle = 'rgba(40,20,0,.6)'; ctx.beginPath(); ctx.moveTo(-w * 0.1, 0); ctx.lineTo(w * 0.05, th * 0.5); ctx.lineTo(-w * 0.05, th); ctx.stroke(); }
    ctx.restore();
  };
  if (split > 0) { ctx.save(); ctx.beginPath(); ctx.rect(x - w, y - U, w, U * 3); ctx.clip(); draw(-split * U * 1.2, -split * 1.5); ctx.restore(); ctx.save(); ctx.beginPath(); ctx.rect(x, y - U, w, U * 3); ctx.clip(); draw(split * U * 1.2, split * 1.5); ctx.restore(); }
  else draw(0, 0);
  if (o.t === 'moving') { ctx.fillStyle = 'rgba(255,255,255,.7)'; for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x + s * (w / 2 + U * 0.12), y + th / 2); ctx.lineTo(x + s * (w / 2 + U * 0.02), y + th * 0.15); ctx.lineTo(x + s * (w / 2 + U * 0.02), y + th * 0.85); ctx.fill(); } }
  if (o.t === 'spring') {
    const used = state.flag[`s${o.id}`], k = used ? clamp((state.time - used) / 0.25, 0, 1) : 1, ext = U * (0.15 + 0.25 * k);
    ctx.strokeStyle = '#c9d0da'; ctx.lineWidth = 3;
    ctx.beginPath(); for (let i = 0; i <= 4; i++) ctx.lineTo(x + (i % 2 ? 6 : -6), y - (ext * i) / 4); ctx.stroke();
    ctx.fillStyle = '#e8402a'; roundRect(ctx, x - U * 0.3, y - ext - U * 0.14, U * 0.6, U * 0.16, U * 0.08); ctx.fill();
  }
  ctx.restore();
}

function hole(ctx, x, y, r, clock) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 1.6);
  g.addColorStop(0, '#000'); g.addColorStop(0.5, 'rgba(30,0,60,.9)'); g.addColorStop(1, 'rgba(60,0,120,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 1.6, 0, TAU); ctx.fill();
  ctx.save(); ctx.translate(x, y); ctx.rotate(-clock * 3);
  ctx.strokeStyle = 'rgba(180,120,255,.65)'; ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) { ctx.rotate(TAU / 3); ctx.beginPath(); ctx.arc(0, 0, r * (0.5 + i * 0.25), 0, 2.2); ctx.stroke(); }
  ctx.restore();
}

export function drawClimb(ctx, state, look, fx, w, h, v, frame) {
  const p = state.p, U = v.U, clock = fx.clock, f = state.speed;
  drawSky(ctx, look, w, h, 0, (v.camY * U * 0.05) % h, 1.2);
  // Parallax puffs drifting past as you climb.
  ctx.save();
  for (let i = Math.floor((v.camY - 10) / 3); i < (v.camY + 20) / 3; i++) {
    const wy = i * 3, sy = h * 0.6 - (wy - v.camY * 0.6) * U * 0.6, sx = hash(i) * w;
    if (sy < -U * 3 || sy > h + U * 3) continue;
    ctx.globalAlpha = look.night ? 0.12 : 0.35; ctx.fillStyle = look.night ? '#8a9ad8' : '#ffffff';
    for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(sx + k * U * 0.8, sy + (k % 2) * U * 0.2, U * (0.8 + hash(i * 7 + k) * 0.6), 0, TAU); ctx.fill(); }
  }
  ctx.restore();
  // Field edges.
  ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(0, 0, v.ox, h); ctx.fillRect(v.ox + v.FW, 0, w - v.ox - v.FW, h);
  ctx.save(); ctx.beginPath(); ctx.rect(v.ox, 0, v.FW, h); ctx.clip();
  const pat = tilePattern(ctx, look.art, 'platform');
  const copies = x => (x < 1.5 ? [x, x + v.W] : x > v.W - 1.5 ? [x, x - v.W] : [x]);
  for (const o of state.objs) {
    const sy = v.Y(o.y);
    if (sy < -U * 2 || sy > h + U * 2) continue;
    const ox = xOf(o, state.time, f, v.W);
    for (const x of copies(ox)) {
      const sx = v.X(x);
      if (['platform', 'moving', 'breaking', 'spring', 'vanishing'].includes(o.t)) platform(ctx, look, o, sx, sy, U, state, clock, pat);
      else if (o.t === 'coin') { const gone = state.gone[o.id]; if (gone === undefined) drawCoin(ctx, look.art, look, sx, sy, U * 0.3, clock + o.y); }
      else if (o.t === 'box') { if (state.gone[o.id] === undefined) { ctx.save(); ctx.translate(sx, sy); ctx.shadowColor = look.pal.accent2; ctx.shadowBlur = 14; roundRect(ctx, -U * 0.3, -U * 0.3, U * 0.6, U * 0.6, U * 0.12); ctx.fillStyle = look.pal.accent2; ctx.fill(); ctx.fillStyle = '#fff'; star(ctx, U * 0.2, U * 0.09); ctx.fill(); ctx.restore(); } }
      else if (o.t === 'hole') hole(ctx, sx, sy, o.r * U, clock);
      else if (o.t === 'enemy') {
        const gone = state.gone[o.id];
        if (gone !== undefined) { const t = state.time - gone; if (t < 0.8) drawCharacter(ctx, look.art, 'chaser', 'hurt', sx, sy + U * 0.4 + t * t * 14 * U, U * 1.3, { rot: t * 8, alpha: 1 - t / 0.8, colors: look.foe }); continue; }
        const bob = Math.sin(clock * 4 + o.y) * U * 0.1;
        drawCharacter(ctx, look.art, 'chaser', Math.floor(clock * 3 + o.y) % 2 ? 'idle' : 'idleB', sx, sy + U * 0.45 + bob, U * 1.35, { flip: Math.cos(state.time * o.speed * f / Math.max(0.1, o.range) + o.phase) < 0, colors: look.foe });
      }
    }
  }
  for (const sh of p.shots) { const sx = v.X(sh.x), sy = v.Y(sh.y); ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = look.pal.accent; ctx.beginPath(); ctx.arc(sx, sy, U * 0.13, 0, TAU); ctx.fill(); ctx.fillStyle = rgba(look.pal.accent, 0.3); ctx.fillRect(sx - U * 0.06, sy, U * 0.12, U * 0.5); ctx.restore(); }
  // Hero.
  let pose = p.vy > 0 ? 'jump' : 'fall', rot = 0, x = v.X(p.x), y = v.Y(p.y), sx = 1, sy = 1;
  if (state.status === 'lost') { const t = fx.deathAt == null ? 0 : fx.clock - fx.deathAt; pose = 'hurt'; rot = t * 6; }
  else { const sq = fx.squash || 0; sx = 1 + sq * 0.25; sy = 1 - sq * 0.25; if (p.vy > 8) { sx = 0.92; sy = 1.1; } }
  if (state.powers.jetpack > 0 && state.status === 'playing') {
    burst(fx, [{ x: 0, y: 0, vx: (fx.r() - 0.5) * 2, vy: 9, g: 0, drag: 2, life: 0.3, max: 0.3, size: 0.2, grow: 0.25, shape: 'dot', color: 'rgba(255,170,60,.9)', add: true, rot: 0, spin: 0 }], x, y, U, false);
    ctx.fillStyle = '#c9d0da'; ctx.fillRect(x - U * 0.4, y - U * 1.05, U * 0.8, U * 0.08);
  }
  const blink = state.invuln > 0 && Math.floor(fx.clock * 16) % 2 === 0 && state.status === 'playing';
  for (const cx of copies(p.x)) if (!blink) drawCharacter(ctx, look.art, 'hero', pose, v.X(cx), y, U * 1.8, { flip: p.face < 0, rot, sx, sy, colors: look.hero });
  if (state.powers.shield > 0) bubble(ctx, look, x, y - U * 0.55, U * 0.85, clock);
  ctx.restore();
  // Rising speed lines on springs and rockets.
  if ((p.vy > 18 || state.powers.jetpack > 0) && !frame.reducedMotion) {
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 2;
    for (let i = 0; i < 14; i++) { const lx = v.ox + hash(i * 3) * v.FW, ly = ((hash(i * 5) * h + clock * 1400) % (h + 120)) - 60; ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx, ly + 60); ctx.stroke(); }
    ctx.restore();
  }
  void lerp;
}
