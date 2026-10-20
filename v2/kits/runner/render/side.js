// Side-view drawing for side (rooftops / jetpack), flap and rhythm-dash.
// World units map to screen with a horizontal follow camera; the hero sits
// left of centre so the player sees what's coming.
import { SIDE, birdX, birdY, missileX } from '../modes/side.js';
import { FLAP, offsetOf } from '../modes/flap.js';
import { DASH, physics as dashPhysics } from '../modes/dash.js';
import { drawSky, drawLayer, drawMotes } from './backdrop.js';
import { image, tilePattern, fillTiles, drawCharacter, drawCoin, drawSprite, shadow, runPose, roundRect, rgba, mixHex, clamp, lerp, TAU, star, burst, bursts, text } from './common.js';

/** Camera and projection for this frame. */
export function sideView(state, look, w, h, cam) {
  const mode = state.mode, c = look.content, p = state.p;
  const fly = mode === 'side' && c.control === 'fly';
  const U = mode === 'flap' ? h / 13.2 : mode === 'rhythm-dash' ? h / 11 : fly ? h / 9.4 : h / 9.6;
  const viewW = w / U;
  const lead = mode === 'flap' ? 0.3 : 0.28;
  cam.x = p.x - viewW * lead;
  let bottom;
  if (mode === 'flap') bottom = -0.9;
  else if (mode === 'rhythm-dash') bottom = -1.7;
  else if (fly) bottom = -0.7;
  else { const target = Math.max(-1.6, p.y - 3.4); cam.y = cam.y == null ? target : lerp(cam.y, target, 0.08); bottom = cam.y; }
  return { U, bottom, X: x => (x - cam.x) * U, Y: y => h - (y - bottom) * U, viewW };
}

function speedLines(ctx, look, w, h, clock, k, reduced) {
  if (k <= 0.05 || reduced) return;
  ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineCap = 'round';
  const n = Math.round(6 + k * 18);
  for (let i = 0; i < n; i++) {
    const y = ((i * 0.6180339 * h * 7.3) % h), len = 40 + k * 140, sp = 1600 + i * 37;
    const x = w - (((clock * sp + i * 977) % (w + len * 2))) + len;
    ctx.globalAlpha = 0.08 + k * 0.25; ctx.lineWidth = 1 + (i % 3);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y); ctx.stroke();
  }
  ctx.restore();
}

// ---------- side (rooftops and jetpack) ----------
function drawBuilding(ctx, look, o, v, w, h, pat) {
  const x0 = v.X(o.x0), x1 = v.X(o.x1), top = v.Y(o.y1);
  if (x1 < -4 || x0 > w + 4) return;
  const facade = look.night ? mixHex(look.ground, '#0a0c18', 0.55) : mixHex(look.ground, '#2a2a3a', 0.35);
  ctx.fillStyle = facade; ctx.fillRect(x0, top, x1 - x0, h - top + 4);
  if (pat.wall) { ctx.globalAlpha = 0.35; fillTiles(ctx, pat.wall, x0, top, x1 - x0, h - top + 4, v.U, -v.X(0) % (v.U * 64), v.Y(0)); ctx.globalAlpha = 1; }
  // Windows.
  const U = v.U;
  for (let wy = top + U * 1.1; wy < h; wy += U * 0.9) for (let wx = x0 + U * 0.35; wx < x1 - U * 0.5; wx += U * 0.8) {
    const lit = look.night && ((Math.floor(wx / U * 3 + v.X(0)) * 13 + Math.floor(wy)) % 7 < 3);
    ctx.fillStyle = lit ? 'rgba(255,214,120,.75)' : 'rgba(0,0,0,.22)'; ctx.fillRect(wx, wy, U * 0.42, U * 0.5);
  }
  // Roof: surface tile strip and a ledge.
  if (pat.top) fillTiles(ctx, pat.top, x0, top, x1 - x0, U * 0.9, U, v.X(0), top);
  else { ctx.fillStyle = look.surface; ctx.fillRect(x0, top, x1 - x0, U * 0.32); }
  ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(x0, top, x1 - x0, 2);
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(x1 - 3, top, 3, h - top);
}

function drawCrate(ctx, x, y, s) {
  ctx.fillStyle = '#b07a3a'; ctx.fillRect(x - s / 2, y - s, s, s);
  ctx.strokeStyle = '#5a3a1a'; ctx.lineWidth = Math.max(2, s * 0.08); ctx.strokeRect(x - s / 2, y - s, s, s);
  ctx.beginPath(); ctx.moveTo(x - s / 2, y - s); ctx.lineTo(x + s / 2, y); ctx.moveTo(x + s / 2, y - s); ctx.lineTo(x - s / 2, y); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(x - s / 2, y - s, s, s * 0.12);
}
function drawSpike(ctx, look, x, y, s, up = 1, glow = false) {
  if (!glow && up > 0 && drawSprite(ctx, look.art, 'hazard', x, y - s * 0.42, s)) return;
  ctx.save(); ctx.translate(x, y); ctx.scale(1, up);
  ctx.beginPath(); ctx.moveTo(-s * 0.45, 0); ctx.lineTo(0, -s * 0.9); ctx.lineTo(s * 0.45, 0); ctx.closePath();
  if (glow) { ctx.shadowColor = look.pal.accent; ctx.shadowBlur = s * 0.35; ctx.fillStyle = '#0b0820'; ctx.fill(); ctx.lineWidth = Math.max(2, s * 0.08); ctx.strokeStyle = look.pal.accent; ctx.stroke(); }
  else { ctx.fillStyle = look.hazardColor; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.stroke(); }
  ctx.restore();
}
function drawPowerBox(ctx, look, x, y, s, clock) {
  const b = Math.sin(clock * 4) * s * 0.08;
  ctx.save(); ctx.translate(x, y + b);
  ctx.shadowColor = look.pal.accent2; ctx.shadowBlur = s * 0.6;
  roundRect(ctx, -s / 2, -s / 2, s, s, s * 0.2); ctx.fillStyle = look.pal.accent2; ctx.fill();
  ctx.shadowBlur = 0; ctx.lineWidth = Math.max(2, s * 0.08); ctx.strokeStyle = '#fff'; ctx.stroke();
  ctx.fillStyle = '#fff'; star(ctx, s * 0.3, s * 0.13, 5); ctx.fill();
  ctx.restore();
}
function drawLaser(ctx, look, x0, y0, x1, y1, clock) {
  const vertical = y1 - y0 > x1 - x0, flick = 0.75 + 0.25 * Math.sin(clock * 40);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const t = vertical ? x1 - x0 : y1 - y0;
  ctx.fillStyle = rgba('#ff3a6a', 0.3 * flick); ctx.fillRect(x0 - t, y0 - t * 0.2, x1 - x0 + t * 2, y1 - y0 + t * 0.4);
  ctx.fillStyle = rgba('#ff7a9a', 0.8 * flick); ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  ctx.fillStyle = '#ffffff'; if (vertical) ctx.fillRect(cx - t * 0.15, y0, t * 0.3, y1 - y0); else ctx.fillRect(x0, cy - t * 0.15, x1 - x0, t * 0.3);
  ctx.restore();
  ctx.fillStyle = '#3a3f4b'; ctx.strokeStyle = '#9aa3b0'; ctx.lineWidth = 2;
  const e = Math.max(t * 2.2, 10);
  for (const [ex, ey] of vertical ? [[cx, y0], [cx, y1]] : [[x0, cy], [x1, cy]]) { ctx.beginPath(); ctx.arc(ex, ey, e / 2, 0, TAU); ctx.fill(); ctx.stroke(); }
}
function drawMissile(ctx, look, x, y, U, clock) {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = '#d8dde6'; roundRect(ctx, -U * 0.5, -U * 0.18, U * 0.9, U * 0.36, U * 0.18); ctx.fill();
  ctx.fillStyle = '#e8402a'; ctx.beginPath(); ctx.moveTo(-U * 0.5, -U * 0.18); ctx.lineTo(-U * 0.75, 0); ctx.lineTo(-U * 0.5, U * 0.18); ctx.fill();
  ctx.fillStyle = '#5c6370'; ctx.fillRect(U * 0.3, -U * 0.3, U * 0.12, U * 0.6);
  ctx.globalCompositeOperation = 'lighter';
  const f = U * (0.35 + 0.15 * Math.sin(clock * 50));
  ctx.fillStyle = 'rgba(255,170,60,.9)'; ctx.beginPath(); ctx.moveTo(U * 0.42, -U * 0.12); ctx.lineTo(U * 0.42 + f, 0); ctx.lineTo(U * 0.42, U * 0.12); ctx.fill();
  ctx.restore();
}
function drawWarning(ctx, look, x, y, U, clock) {
  const on = Math.floor(clock * 8) % 2 === 0;
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = on ? '#ff3a3a' : '#ffd23a';
  ctx.beginPath(); ctx.moveTo(0, -U * 0.5); ctx.lineTo(U * 0.48, U * 0.38); ctx.lineTo(-U * 0.48, U * 0.38); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#1a1206'; ctx.fillRect(-U * 0.06, -U * 0.22, U * 0.12, U * 0.34); ctx.fillRect(-U * 0.06, U * 0.18, U * 0.12, U * 0.1);
  ctx.restore();
}

export function drawSide(ctx, state, look, fx, w, h, v, frame) {
  const c = look.content, p = state.p, fly = c.control === 'fly', U = v.U, clock = fx.clock;
  const pat = { top: tilePattern(ctx, look.art, 'groundTop'), wall: tilePattern(ctx, look.art, 'wall'), fill: tilePattern(ctx, look.art, 'groundFill') };
  const camPx = v.X(0);
  drawSky(ctx, look, w, h, -camPx * 0.06, 0);
  drawLayer(ctx, look, w, h, -camPx * 0.18, { base: h * 0.66, height: h * 0.34, depth: 0.2, color: mixHex(look.ground, look.night ? '#141a38' : '#9fb8d8', 0.62), alpha: 0.9, unit: U });
  drawLayer(ctx, look, w, h, -camPx * 0.4, { base: h * 0.8, height: h * 0.3, depth: 0.6, color: mixHex(look.ground, look.night ? '#0c1024' : '#506078', 0.5), unit: U });
  drawMotes(ctx, look, w, h, clock, -camPx, 0, frame.reducedMotion);
  if (fly) {
    const floor = v.Y(0), ceil = v.Y(SIDE.ceil);
    ctx.fillStyle = mixHex(look.ground, '#000', 0.25); ctx.fillRect(0, floor, w, h - floor);
    if (pat.top) fillTiles(ctx, pat.top, 0, floor, w, U, U, camPx, floor); else { ctx.fillStyle = look.surface; ctx.fillRect(0, floor, w, U * 0.25); }
    ctx.fillStyle = mixHex(look.ground, '#000', 0.4); ctx.fillRect(0, 0, w, ceil);
    if (pat.wall) fillTiles(ctx, pat.wall, 0, ceil - U, w, U, U, camPx, ceil);
    ctx.fillStyle = 'rgba(255,255,255,.15)'; ctx.fillRect(0, ceil - 2, w, 2);
    // Lab pillars in the background for speed reference.
    ctx.fillStyle = 'rgba(0,0,0,.18)';
    for (let i = Math.floor(-camPx / (U * 6)) - 1; i * U * 6 + camPx < w + U * 6; i++) ctx.fillRect(i * U * 6 + camPx, ceil, U * 0.8, floor - ceil);
  }
  for (const o of state.objs) { if (o.t === 'solid') drawBuilding(ctx, look, o, v, w, h, pat); }
  const vRef = c.speed.start;
  for (const o of state.objs) {
    if (o.t === 'solid') continue;
    const gone = state.gone[o.id];
    if (o.t === 'coin') {
      if (gone !== undefined) { const k = (state.time - gone) / 0.25; if (k < 1) drawCoin(ctx, look.art, look, lerp(v.X(o.x), v.X(p.x), k), lerp(v.Y(o.y), v.Y(p.y + 0.6), k), U * 0.32 * (1 - k * 0.5), clock); continue; }
      drawCoin(ctx, look.art, look, v.X(o.x), v.Y(o.y) + Math.sin(clock * 3 + o.x) * U * 0.06, U * 0.32, clock + o.x * 0.3);
    } else if (o.t === 'box') { if (gone === undefined) drawPowerBox(ctx, look, v.X(o.x), v.Y(o.y), U * 0.7, clock); }
    else if (o.t === 'crate') { if (gone === undefined) drawCrate(ctx, v.X(o.x), v.Y(o.y), U * 0.9); }
    else if (o.t === 'spike') drawSpike(ctx, look, v.X(o.x), v.Y(o.y), U * 0.95);
    else if (o.t === 'bird') {
      const bx = birdX(o, p.x), by = birdY(o, p.x, vRef);
      drawCharacter(ctx, look.art, 'chaser', runPose(clock * 10 + o.x), v.X(bx), v.Y(by - 0.55), U * 1.25, { flip: true, colors: look.foe });
    } else if (o.t === 'laser') drawLaser(ctx, look, v.X(o.x0), v.Y(o.y1), v.X(o.x1), v.Y(o.y0), clock);
    else if (o.t === 'missile') {
      const mx = missileX(o, p.x);
      if (mx - p.x > v.viewW * 0.72 && state.flag[`w${o.id}`] !== undefined) drawWarning(ctx, look, w - U * 0.8, v.Y(o.y), U, clock);
      else drawMissile(ctx, look, v.X(mx), v.Y(o.y), U, clock);
    }
  }
  drawHeroSide(ctx, state, look, fx, v, frame);
  speedLines(ctx, look, w, h, clock, clamp((state.speed - c.speed.start) / Math.max(1, c.speed.max - c.speed.start), 0, 1) * 0.8, frame.reducedMotion);
}

function deathPose(fx, clock) {
  const t = fx.deathAt == null ? 0 : clock - fx.deathAt;
  return { t, dy: -(6 * t - 14 * t * t), rot: t * 9 };
}

function drawHeroSide(ctx, state, look, fx, v, frame) {
  const p = state.p, U = v.U, c = look.content, fly = c.control === 'fly' || state.powers.jetpack > 0;
  let x = v.X(p.x), y = v.Y(p.y);
  let pose = p.ground ? runPose(p.x / 0.62) : p.vy > 1.5 ? 'jump' : 'fall';
  if (!p.ground && fly) pose = p.thrust ? 'jump' : 'fall';
  let rot = 0, sx = 1, sy = 1;
  if (state.status === 'lost') { const d = deathPose(fx, fx.clock); pose = 'hurt'; y += d.dy * U; rot = -d.rot; }
  else {
    const sq = fx.squash || 0;
    sx = 1 + sq * 0.18; sy = 1 - sq * 0.2;
    if (!p.ground && p.vy > 4) { sx = 0.94; sy = 1.08; }
  }
  if (p.ground || p.y < 0.05) shadow(ctx, x, v.Y(p.y) + 2, U * 0.42);
  // Jetpack flame.
  if (fly && p.thrust && state.status === 'playing') {
    burst(fx, [{ x: -0.25, y: -0.35, vx: -2 - fx.r() * 2, vy: 4, g: 0, drag: 2, life: 0.25, max: 0.25, size: 0.18, grow: 0.2, shape: 'dot', color: 'rgba(255,170,60,.9)', add: true, rot: 0, spin: 0 }], x, y, U, true);
  }
  if (state.invuln > 0 && Math.floor(fx.clock * 16) % 2 === 0 && state.status === 'playing') return;
  drawCharacter(ctx, look.art, 'hero', pose, x, y, U * 2.1, { rot, sx, sy, colors: look.hero });
  if (state.powers.shield > 0) bubble(ctx, look, x, y - U * 0.8, U * 1.05, fx.clock);
  if (state.powers.magnet > 0) magnetRing(ctx, look, x, y - U * 0.6, U * 1.6, fx.clock);
}
export function bubble(ctx, look, x, y, r, clock) {
  ctx.save(); ctx.globalAlpha = 0.5 + 0.15 * Math.sin(clock * 5);
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  g.addColorStop(0, 'rgba(255,255,255,.5)'); g.addColorStop(0.7, rgba(look.pal.accent2, 0.15)); g.addColorStop(1, rgba(look.pal.accent2, 0.6));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.restore();
}
export function magnetRing(ctx, look, x, y, r, clock) {
  ctx.save(); ctx.strokeStyle = rgba(look.coinColor, 0.4); ctx.lineWidth = 2; ctx.setLineDash([6, 8]); ctx.lineDashOffset = -clock * 40;
  ctx.beginPath(); ctx.arc(x, y, r * (0.9 + 0.1 * Math.sin(clock * 6)), 0, TAU); ctx.stroke(); ctx.restore();
}

// ---------- flap ----------
export function drawFlap(ctx, state, look, fx, w, h, v, frame) {
  const c = look.content, p = state.p, U = v.U, clock = fx.clock, vRef = c.speed.start;
  const camPx = v.X(0);
  drawSky(ctx, look, w, h, -camPx * 0.08, 0);
  drawLayer(ctx, look, w, h, -camPx * 0.2, { base: h * 0.72, height: h * 0.3, depth: 0.2, color: mixHex(look.ground, look.night ? '#141a38' : '#a8c0d8', 0.6), alpha: 0.85, unit: U });
  drawLayer(ctx, look, w, h, -camPx * 0.45, { base: h * 0.86, height: h * 0.22, depth: 0.7, color: mixHex(look.surface, look.night ? '#0a1020' : '#304030', 0.45), unit: U });
  drawMotes(ctx, look, w, h, clock, -camPx, 0, frame.reducedMotion);
  const pat = tilePattern(ctx, look.art, 'platform'), top = tilePattern(ctx, look.art, 'groundTop');
  for (const o of state.objs) {
    if (o.t === 'gate') {
      const x = v.X(o.x), half = FLAP.pipeHalf * U;
      if (x < -half * 2 || x > w + half * 2) continue;
      for (const pipe of o.pipes) {
        const off = offsetOf(pipe, p.x, vRef, o.x);
        const y0 = v.Y(pipe.y1 + off), y1 = v.Y(pipe.y0 + off);
        const moving = pipe.amp > 0;
        const body = moving ? mixHex(look.platform, look.pal.accent2, 0.35) : look.platform;
        ctx.fillStyle = body; ctx.fillRect(x - half, y0, half * 2, y1 - y0);
        if (pat) { ctx.globalAlpha = 0.55; fillTiles(ctx, pat, x - half, y0, half * 2, y1 - y0, U * 1.5, x - half, 0); ctx.globalAlpha = 1; }
        ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.fillRect(x - half + U * 0.18, y0, U * 0.2, y1 - y0);
        ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x + half - U * 0.25, y0, U * 0.25, y1 - y0);
        ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 2; ctx.strokeRect(x - half, y0, half * 2, y1 - y0);
        // Caps on the edges that face the gap.
        const capH = U * 0.55, capW = half + U * 0.18;
        for (const [edge, dir] of [[pipe.y0 + off, 1], [pipe.y1 + off, -1]]) {
          if (edge < -1 || edge > FLAP.height + 1) continue;
          const ey = v.Y(edge), cy = dir > 0 ? ey - capH : ey;
          ctx.fillStyle = mixHex(body, '#ffffff', 0.15); ctx.fillRect(x - capW, cy, capW * 2, capH);
          ctx.strokeRect(x - capW, cy, capW * 2, capH);
          if (moving) { ctx.fillStyle = rgba(look.pal.accent2, 0.5 + 0.4 * Math.sin(clock * 6)); ctx.fillRect(x - capW, dir > 0 ? cy : cy + capH - 3, capW * 2, 3); }
        }
      }
    } else if (o.t === 'coin' || o.t === 'box') {
      const gone = state.gone[o.id];
      if (o.t === 'coin') {
        if (gone !== undefined) { const k = (state.time - gone) / 0.25; if (k < 1) drawCoin(ctx, look.art, look, lerp(v.X(o.x), v.X(p.x), k), lerp(v.Y(o.y), v.Y(p.y), k), U * 0.32, clock); }
        else drawCoin(ctx, look.art, look, v.X(o.x), v.Y(o.y), U * 0.34, clock + o.x);
      } else if (gone === undefined) drawPowerBox(ctx, look, v.X(o.x), v.Y(o.y), U * 0.7, clock);
    }
  }
  // Ground strip.
  const gy = v.Y(0);
  ctx.fillStyle = mixHex(look.ground, '#000', 0.15); ctx.fillRect(0, gy, w, h - gy);
  if (top) fillTiles(ctx, top, 0, gy, w, U, U, camPx, gy); else { ctx.fillStyle = look.surface; ctx.fillRect(0, gy, w, U * 0.25); }
  // Hero: tilt with velocity like the classic.
  const x = v.X(p.x);
  let y = v.Y(p.y - 0.62), rot = clamp(-p.vy * 0.055, -0.45, 1.25), pose = p.flapT < 0.16 ? 'jump' : p.vy < -4 ? 'fall' : 'idle';
  if (state.status === 'lost') { const d = deathPose(fx, fx.clock); pose = 'hurt'; y += d.dy * U * 0.6; rot = d.rot; }
  if (frame.events.some(e => e.name === 'jump') && state.status === 'playing') burst(fx, bursts.dust(0, 0, 0.1, fx.r, 'rgba(255,255,255,.6)'), x - U * 0.35, v.Y(p.y), U * 0.22, true);
  const blink = state.invuln > 0 && Math.floor(fx.clock * 16) % 2 === 0;
  if (!blink) drawCharacter(ctx, look.art, 'hero', pose, x, y, U * 2.0, { rot, colors: look.hero, sx: p.flapT < 0.1 ? 1.08 : 1, sy: p.flapT < 0.1 ? 0.92 : 1 });
  if (state.powers.shield > 0) bubble(ctx, look, x, v.Y(p.y), U * 0.9, fx.clock);
  if (state.powers.magnet > 0) magnetRing(ctx, look, x, v.Y(p.y), U * 1.6, fx.clock);
  // Gate counter in big faint digits, like the classic.
  if (state.status === 'playing') text(ctx, String(p.gates), w / 2, h * 0.16, Math.min(w, h) * 0.12, 'rgba(255,255,255,.9)', { font: look.font, weight: 900, stroke: 'rgba(0,0,0,.45)' });
}

// ---------- rhythm-dash ----------
export function drawDash(ctx, state, look, fx, w, h, v, frame) {
  const c = look.content, p = state.p, U = v.U, clock = fx.clock, ph = dashPhysics(c);
  const beat = state.time / ph.beat, pulse = Math.max(0, 1 - (beat % 1) * 3.2), reduced = frame.reducedMotion;
  const camPx = v.X(0), accent = look.pal.accent, accent2 = look.pal.accent2;
  drawSky(ctx, look, w, h, -camPx * 0.05, 0);
  ctx.fillStyle = `rgba(6,4,20,${0.55 - pulse * 0.12})`; ctx.fillRect(0, 0, w, h);
  // Beat grid lines scrolling with the world, brighter on the bar.
  const cells = 4 * p.sf;
  ctx.save(); ctx.lineWidth = 1;
  for (let i = Math.floor(v.X(0) / -U / 4) - 2, n = 0; n < 40; i++, n++) {
    const x = v.X(i * 4); if (x > w + U * 4) break; if (x < -U * 4) continue;
    ctx.strokeStyle = rgba(accent2, i % 4 === 0 ? 0.16 + pulse * 0.2 : 0.06); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  ctx.restore();
  drawLayer(ctx, look, w, h, -camPx * 0.25, { base: h * 0.82, height: h * 0.3, depth: 0.3, color: rgba(accent2, 0.12 + pulse * 0.06), unit: U });
  void cells;
  const glowBlock = (x0, y0, x1, y1) => {
    const X0 = v.X(x0), X1 = v.X(x1), Y0 = v.Y(y1), Y1 = v.Y(y0);
    if (X1 < -4 || X0 > w + 4) return;
    ctx.fillStyle = 'rgba(10,6,30,.92)'; ctx.fillRect(X0, Y0, X1 - X0, Y1 - Y0);
    ctx.strokeStyle = rgba(accent, 0.12 + pulse * 0.1); ctx.lineWidth = 1;
    for (let gx = Math.ceil(x0); gx < x1; gx++) { ctx.beginPath(); ctx.moveTo(v.X(gx), Y0); ctx.lineTo(v.X(gx), Y1); ctx.stroke(); }
    for (let gy = Math.ceil(y0); gy < y1; gy++) { ctx.beginPath(); ctx.moveTo(X0, v.Y(gy)); ctx.lineTo(X1, v.Y(gy)); ctx.stroke(); }
    ctx.save(); ctx.shadowColor = accent; ctx.shadowBlur = reduced ? 0 : 10 + pulse * 10;
    ctx.strokeStyle = accent; ctx.lineWidth = 2 + pulse * 1.5; ctx.strokeRect(X0 + 1, Y0 + 1, X1 - X0 - 2, Y1 - Y0 - 2);
    ctx.restore();
  };
  for (const o of state.objs) {
    if (o.t === 'block') glowBlock(o.x0, o.y0, o.x1, Math.min(o.y1, 30));
  }
  for (const o of state.objs) {
    const x = v.X(o.x ?? o.x0);
    if (x < -U * 3 || x > w + U * 3) continue;
    if (o.t === 'spike') drawSpike(ctx, look, x, v.Y(o.y), U * 1.0, o.dir, true);
    else if (o.t === 'pad') {
      ctx.save(); ctx.shadowColor = '#ffd23a'; ctx.shadowBlur = 14; ctx.fillStyle = state.flag[`p${o.id}`] ? '#a08020' : '#ffd23a';
      ctx.beginPath(); ctx.ellipse(x, v.Y(0), U * 0.45, U * 0.22, 0, Math.PI, 0); ctx.fill(); ctx.restore();
    } else if (o.t === 'orb') {
      const used = state.flag[`o${o.id}`] !== undefined, r = U * (0.42 + pulse * 0.08);
      ctx.save(); ctx.shadowColor = '#ffe23a'; ctx.shadowBlur = used ? 0 : 16; ctx.strokeStyle = used ? 'rgba(255,226,58,.3)' : '#ffe23a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, v.Y(o.y), r, 0, TAU); ctx.stroke();
      ctx.setLineDash([5, 6]); ctx.lineDashOffset = clock * 30; ctx.beginPath(); ctx.arc(x, v.Y(o.y), r * 1.4, 0, TAU); ctx.stroke(); ctx.restore();
    } else if (o.t === 'portal') {
      const col = o.kind === 'gravity' ? (o.value < 0 ? '#ffd23a' : '#3ad0ff') : '#5fff8a';
      ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 18; ctx.strokeStyle = col; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(x, v.Y(o.kind === 'gravity' ? 3 : 1.5), U * 0.45, U * (o.kind === 'gravity' ? 3 : 1.6), 0, 0, TAU); ctx.stroke();
      if (o.kind === 'speed') { ctx.fillStyle = col; for (let i = 0; i < Math.round(o.value * 2); i++) { const ax = x - U * 0.3 + i * U * 0.25; ctx.beginPath(); ctx.moveTo(ax, v.Y(1.8)); ctx.lineTo(ax + U * 0.2, v.Y(1.5)); ctx.lineTo(ax, v.Y(1.2)); ctx.fill(); } }
      ctx.restore();
    } else if (o.t === 'coin') {
      const gone = state.gone[o.id];
      if (gone === undefined) drawCoin(ctx, look.art, look, x, v.Y(o.y), U * 0.34, clock + o.x);
    } else if (o.t === 'goal') {
      for (let i = 0; i < 10; i++) for (let j = 0; j < 2; j++) { ctx.fillStyle = (i + j) % 2 ? '#fff' : '#111'; ctx.fillRect(x + j * U * 0.3, v.Y(i * 0.6 + 0.6), U * 0.3, U * 0.6); }
      drawSprite(ctx, look.art, 'goal', x + U * 1.5, v.Y(1.2), U * 2.2);
    }
  }
  // Hero: run cycle on the ground, half-turn flips per beat in the air, afterimages, gravity flips it.
  let x = v.X(p.x), y = v.Y(p.y - DASH.half * p.grav);
  const inAir = !p.ground;
  let rot = inAir ? (p.airT / ph.beat) * Math.PI * p.grav : 0, pose = inAir ? 'jump' : runPose(p.x / 0.7);
  if (state.status === 'lost') { const d = deathPose(fx, fx.clock); pose = 'hurt'; y += d.dy * U; rot = d.rot; }
  if (inAir && state.status === 'playing' && !reduced) for (let i = 1; i <= 3; i++) {
    drawCharacter(ctx, look.art, 'hero', 'jump', x - i * U * 0.35, y, U * 1.45, { rot: rot - i * 0.25 * p.grav, sy: p.grav, alpha: 0.18 / i, colors: look.hero });
  }
  ctx.save(); ctx.shadowColor = accent2; ctx.shadowBlur = reduced ? 0 : 12 + pulse * 10;
  drawCharacter(ctx, look.art, 'hero', pose, x, y, U * 1.45, { rot, sy: p.grav * (1 + pulse * 0.04), sx: 1 + pulse * 0.04, colors: look.hero });
  ctx.restore();
  if (p.ground && state.status === 'playing' && Math.floor(fx.clock * 30) % 2 === 0) burst(fx, [{ x: -0.4, y: 0, vx: -6, vy: -1 * p.grav, g: 0, drag: 3, life: 0.3, max: 0.3, size: 0.07, grow: 0, shape: 'square', color: accent, add: true, rot: 0, spin: 3 }], x, v.Y(p.y - DASH.half * p.grav), U, true);
  if (frame.events.some(e => e.name === 'portal' || e.name === 'pad' || e.name === 'orb')) burst(fx, bursts.spark(0, 0, fx.r, accent2, 12), x, y - U * 0.6, U * 0.7, true);
}
