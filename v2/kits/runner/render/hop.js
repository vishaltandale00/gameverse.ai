// Hop drawing: rows as horizontal bands seen from a high three-quarter
// camera; grass with trees, roads with code-drawn cars, rivers with logs,
// rails with flashing warning lights and trains. The hawk swoops on idlers.
import { HOP, nearest, trainAt } from '../modes/hop.js';
import { tilePattern, fillTiles, drawCharacter, drawCoin, shadow, roundRect, rgba, mixHex, clamp, lerp, TAU, burst, bursts } from './common.js';
import { bubble } from './side.js';

const hash = n => { let x = Math.imul(n | 0, 0x9e3779b1) ^ 0x85ebca6b; x = Math.imul(x ^ (x >>> 15), 0xc2b2ae35); return ((x ^ (x >>> 13)) >>> 0) / 4294967296; };
const CAR_COLORS = ['#e8402a', '#3a7bd5', '#f5c542', '#5fbf4a', '#9b5cff', '#ff8a3a', '#e8e8f0'];

export function hopView(state, look, w, h, cam) {
  const C = look.content.rules.width, U = Math.min(w / (C + 2), h / 11.5), p = state.p;
  const hopR = p.hopping ? lerp(p.fr, p.tr, clamp(p.hopT, 0, 1)) : p.r;
  const target = Math.max(hopR, p.cam + 2.4);
  cam.r = cam.r == null ? target : lerp(cam.r, target, 0.08);
  const cx = w / 2 - ((C - 1) / 2) * U;
  return { C, U, X: x => cx + x * U, Y: r => h * 0.68 - (r - cam.r) * U, camR: cam.r, hopR };
}

function tree(ctx, look, x, y, U, seed) {
  const s = U * (0.8 + hash(seed) * 0.25);
  shadow(ctx, x, y + U * 0.3, s * 0.45, 0.25);
  ctx.fillStyle = '#6b4325'; ctx.fillRect(x - s * 0.08, y - s * 0.1, s * 0.16, s * 0.4);
  const g = look.theme === 'snow' ? '#e8f4ff' : mixHex(look.surface, '#1a4a1a', 0.35);
  for (let i = 0; i < 3; i++) { ctx.fillStyle = mixHex(g, '#ffffff', i * 0.1); ctx.beginPath(); ctx.arc(x, y - s * (0.25 + i * 0.22), s * (0.42 - i * 0.09), 0, TAU); ctx.fill(); }
  ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y - s * 0.25, s * 0.42, 0, TAU); ctx.stroke();
}
function car(ctx, x, y, len, U, dir, color) {
  const L = len * U, H = U * 0.62;
  ctx.save(); ctx.translate(x, y); ctx.scale(dir, 1);
  ctx.fillStyle = 'rgba(0,0,0,.28)'; roundRect(ctx, -L / 2 + 3, -H / 2 + 6, L, H, U * 0.15); ctx.fill();
  ctx.fillStyle = color; roundRect(ctx, -L / 2, -H / 2, L, H, U * 0.15); ctx.fill();
  ctx.fillStyle = mixHex(color, '#000000', 0.25); roundRect(ctx, -L / 2, H * 0.1, L, H * 0.4, U * 0.12); ctx.fill();
  ctx.fillStyle = 'rgba(190,230,255,.9)'; roundRect(ctx, -L * 0.15, -H * 0.42, Math.min(L * 0.45, U * 0.8), H * 0.45, U * 0.08); ctx.fill();
  ctx.fillStyle = '#fff6b0'; ctx.fillRect(L / 2 - U * 0.08, -H * 0.38, U * 0.08, H * 0.22); ctx.fillRect(L / 2 - U * 0.08, H * 0.12, U * 0.08, H * 0.22);
  ctx.fillStyle = '#1a1a22'; for (const wx of [-L * 0.32, L * 0.32]) { ctx.fillRect(wx - U * 0.12, -H / 2 - U * 0.06, U * 0.24, U * 0.1); ctx.fillRect(wx - U * 0.12, H / 2 - U * 0.04, U * 0.24, U * 0.1); }
  ctx.restore();
}
function log(ctx, x, y, len, U) {
  const L = len * U, H = U * 0.6;
  ctx.fillStyle = 'rgba(0,0,0,.2)'; roundRect(ctx, x - L / 2 + 2, y - H / 2 + 5, L, H, H / 2); ctx.fill();
  ctx.fillStyle = '#8a5a2b'; roundRect(ctx, x - L / 2, y - H / 2, L, H, H / 2); ctx.fill();
  ctx.fillStyle = '#a8743c'; ctx.fillRect(x - L / 2 + H / 2, y - H * 0.38, L - H, H * 0.16);
  ctx.fillStyle = '#d8b07a'; ctx.beginPath(); ctx.ellipse(x + L / 2 - H * 0.3, y, H * 0.22, H * 0.42, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#8a5a2b'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(x + L / 2 - H * 0.3, y, H * 0.1, H * 0.22, 0, 0, TAU); ctx.stroke();
}

export function drawHop(ctx, state, look, fx, w, h, v, frame) {
  const p = state.p, U = v.U, clock = fx.clock, t = state.time;
  ctx.fillStyle = mixHex(look.surface, '#000', 0.2); ctx.fillRect(0, 0, w, h);
  const rows = new Map();
  for (const o of state.objs) if (o.t === 'row') rows.set(o.r, o);
  const r0 = Math.floor(v.camR - (h * 0.32) / U) - 1, r1 = Math.ceil(v.camR + (h * 0.68) / U) + 1;
  const pat = tilePattern(ctx, look.art, 'groundTop');
  // Bands.
  for (let r = r1; r >= r0; r--) {
    const row = rows.get(r) || { kind: 'grass', trees: [], r };
    const y = v.Y(r), top = y - U / 2;
    if (row.kind === 'grass') {
      ctx.fillStyle = r % 2 ? look.surface : mixHex(look.surface, '#ffffff', 0.1); ctx.fillRect(0, top, w, U + 1);
      if (pat) { ctx.globalAlpha = 0.25; fillTiles(ctx, pat, 0, top, w, U, U, v.X(0), top); ctx.globalAlpha = 1; }
    } else if (row.kind === 'road') {
      ctx.fillStyle = '#3a3d48'; ctx.fillRect(0, top, w, U + 1);
      if (rows.get(r + 1)?.kind === 'road') { ctx.fillStyle = 'rgba(255,255,255,.55)'; for (let x = -1; x < 12; x++) ctx.fillRect(v.X(x) - U * 0.25, top - 1, U * 0.5, 3); }
      ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(0, top + U - 4, w, 4);
    } else if (row.kind === 'river') {
      const g = ctx.createLinearGradient(0, top, 0, top + U); g.addColorStop(0, '#3a8ae8'); g.addColorStop(1, '#2a6ac8');
      ctx.fillStyle = g; ctx.fillRect(0, top, w, U + 1);
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 2;
      for (let i = 0; i < 8; i++) { const x = ((hash(r * 9 + i) * w + row.dir * clock * row.v * U * 0.7) % w + w) % w; ctx.beginPath(); ctx.moveTo(x, top + U * (0.3 + hash(i + r) * 0.4)); ctx.lineTo(x + U * 0.4, top + U * (0.3 + hash(i + r) * 0.4)); ctx.stroke(); }
    } else if (row.kind === 'rail') {
      ctx.fillStyle = '#7a6a5a'; ctx.fillRect(0, top, w, U + 1);
      ctx.fillStyle = '#5a4030'; for (let x = -1; x < 12; x += 0.5) ctx.fillRect(v.X(x) - U * 0.08, top + U * 0.12, U * 0.16, U * 0.76);
      ctx.fillStyle = '#c9d0da'; ctx.fillRect(0, top + U * 0.25, w, U * 0.07); ctx.fillRect(0, top + U * 0.68, w, U * 0.07);
    }
    if (v.X(0) - U / 2 > 0) { ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(0, top, v.X(0) - U / 2, U + 1); ctx.fillRect(v.X(v.C - 1) + U / 2, top, w, U + 1); }
  }
  // Contents, back to front.
  for (let r = r1; r >= r0; r--) {
    const row = rows.get(r);
    const y = v.Y(r);
    if (row?.kind === 'grass') { row.trees.forEach((tr, i) => { if (tr) tree(ctx, look, v.X(i), y, U, r * 31 + i); }); if (r < -1) for (const i of [-1, v.C]) tree(ctx, look, v.X(i), y, U, r * 7 + i); }
    if (row?.kind === 'grass' && r >= 0) for (const i of [-1, v.C]) if (hash(r * 3 + i) > 0.4) tree(ctx, look, v.X(i), y, U, r * 5 + i);
    if (row?.kind === 'road' || row?.kind === 'river') {
      const base = row.off + row.dir * row.v * t;
      for (let k = Math.floor((-4 - base) / row.period); base + k * row.period < v.C + 4; k++) {
        const cx = base + k * row.period;
        if (row.kind === 'road') car(ctx, v.X(cx), y, row.size, U, row.dir, CAR_COLORS[Math.floor(hash(r * 17 + k) * CAR_COLORS.length)]);
        else log(ctx, v.X(cx), y, row.size, U);
      }
    }
    if (row?.kind === 'rail') {
      const tr = trainAt(row, t);
      const on = tr.warn && Math.floor(clock * 6) % 2 === 0;
      ctx.fillStyle = '#3a3f4b'; ctx.fillRect(v.X(-0.9) - 2, y - U * 0.9, 4, U * 0.9);
      ctx.fillStyle = on ? '#ff3a3a' : '#5a2020'; ctx.beginPath(); ctx.arc(v.X(-0.9), y - U * 0.9, U * 0.16, 0, TAU); ctx.fill();
      if (on) { ctx.fillStyle = 'rgba(255,60,60,.25)'; ctx.beginPath(); ctx.arc(v.X(-0.9), y - U * 0.9, U * 0.45, 0, TAU); ctx.fill(); }
      if (tr.front !== null) {
        const back = row.dir > 0 ? tr.front - row.size : tr.front + row.size;
        const x0 = v.X(Math.min(tr.front, back)), x1 = v.X(Math.max(tr.front, back));
        ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(x0, y - U * 0.25, x1 - x0, U * 0.7);
        ctx.fillStyle = '#d8352a'; roundRect(ctx, x0, y - U * 0.55, x1 - x0, U * 0.85, U * 0.12); ctx.fill();
        ctx.fillStyle = 'rgba(190,230,255,.85)'; for (let x = x0 + U * 0.4; x < x1 - U * 0.6; x += U * 0.9) ctx.fillRect(x, y - U * 0.4, U * 0.5, U * 0.25);
        ctx.fillStyle = '#f5c542'; ctx.fillRect(x0, y + U * 0.05, x1 - x0, U * 0.08);
      }
    }
  }
  for (const o of state.objs) {
    if ((o.t !== 'coin' && o.t !== 'box') || state.gone[o.id] !== undefined) continue;
    const y = v.Y(o.r);
    if (o.t === 'coin') drawCoin(ctx, look.art, look, v.X(o.x), y - U * 0.15 + Math.sin(clock * 3 + o.x) * U * 0.06, U * 0.3, clock + o.r);
    else { ctx.save(); ctx.translate(v.X(o.x), y - U * 0.2); ctx.shadowColor = look.pal.accent2; ctx.shadowBlur = 12; roundRect(ctx, -U * 0.28, -U * 0.28, U * 0.56, U * 0.56, U * 0.1); ctx.fillStyle = look.pal.accent2; ctx.fill(); ctx.restore(); }
  }
  // Hero with a hop arc, squash on landing.
  const k = p.hopping ? clamp(p.hopT, 0, 1) : 1;
  const hx = v.X(p.x), hy = v.Y(v.hopR), arc = p.hopping ? Math.sin(k * Math.PI) * U * 0.55 : 0;
  let pose = p.hopping ? 'jump' : Math.floor(clock * 2) % 2 ? 'idle' : 'idleB', sx = 1, sy = 1, rot = 0, alpha = 1, dy = 0;
  if (p.squash > 0) { sx = 1.2; sy = 0.82; }
  const reason = state.reason || '';
  if (state.status === 'lost') {
    const dt = fx.deathAt == null ? 0 : fx.clock - fx.deathAt;
    pose = 'hurt';
    if (/Flattened|Hit by/.test(reason)) { sy = 0.3; sx = 1.5; }
    else if (/Fell into|Swept/.test(reason)) { alpha = clamp(1 - dt / 0.6, 0, 1); dy = dt * U * 0.6; }
    else if (/Snatched/.test(reason)) {
      const sw = clamp(dt / 0.45, 0, 1), up = Math.max(0, dt - 0.45);
      const ex = lerp(hx + U * 3, hx, sw), ey = lerp(-U * 2, hy - U * 0.6, sw) - up * U * 9;
      drawCharacter(ctx, look.art, 'chaser', Math.floor(clock * 12) % 2 ? 'runA' : 'runC', ex, ey, U * 2.6, { flip: true, colors: look.foe });
      dy = -up * U * 9;
    }
  }
  shadow(ctx, hx, hy + U * 0.3, U * 0.32 * (1 - arc / (U * 1.2)), 0.3);
  const blink = state.invuln > 0 && Math.floor(fx.clock * 16) % 2 === 0 && state.status === 'playing';
  if (!blink) drawCharacter(ctx, look.art, 'hero', pose, hx, hy + U * 0.32 - arc + dy, U * 1.25, { flip: p.face < 0, sx, sy, rot, alpha, colors: look.hero });
  if (state.powers.shield > 0) bubble(ctx, look, hx, hy - arc - U * 0.2, U * 0.7, clock);
  // The hawk's line: the bottom edge darkens as the camera catches up.
  const danger = clamp(1 - (v.hopR - (p.cam - HOP.behind)) / 2.5, 0, 1) + clamp((p.idleT - 5) / 3, 0, 1);
  if (danger > 0 && state.status === 'playing') { const g = ctx.createLinearGradient(0, h, 0, h * 0.55); g.addColorStop(0, `rgba(160,0,0,${0.45 * Math.min(1, danger)})`); g.addColorStop(1, 'rgba(160,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, h * 0.55, w, h * 0.45); }
  if (frame.events.some(e => e.name === 'lost') && /Fell into|Swept/.test(reason)) burst(fx, bursts.spark(0, 0, fx.r, '#bfe4ff', 18), hx, hy, U * 0.8, false);
  void nearest; void rgba;
}
