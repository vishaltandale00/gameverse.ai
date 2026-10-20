// Lanes drawing: a pseudo-3D rail track seen from behind the hero, drawn in
// code. The track bends and rolls (curve and hill offsets measured from the
// camera's tangent so the near track stays straight), with sleepers and
// rails per lane, fogged side buildings and lamps, 3D-box barriers and
// trains, billboard coins, the hero and the chaser.
import { LANES, zOf, mid } from '../modes/lanes.js';
import { drawSky, drawLayer } from './backdrop.js';
import { drawCharacter, drawCoin, roundRect, rgba, mixHex, clamp, lerp, TAU, runPose, star, burst, bursts } from './common.js';

const LW = 1.7, FAR = 95, SEG = 2.5, BACK = 5.2;
const hash = n => { let x = Math.imul(n | 0, 0x9e3779b1) ^ 0x85ebca6b; x = Math.imul(x ^ (x >>> 15), 0xc2b2ae35); return ((x ^ (x >>> 13)) >>> 0) / 4294967296; };
const curve = z => 9 * Math.sin(z / 130) + 4.5 * Math.sin(z / 53 + 1.3);
const curveD = z => (9 / 130) * Math.cos(z / 130) + (4.5 / 53) * Math.cos(z / 53 + 1.3);
const hill = z => 2.4 * Math.sin(z / 95 + 0.4) + 1.1 * Math.sin(z / 41);
const hillD = z => (2.4 / 95) * Math.cos(z / 95 + 0.4) + (1.1 / 41) * Math.cos(z / 41);

export function lanesView(state, look, w, h, cam, lock = false) {
  const p = state.p;
  const zc = p.z - BACK;
  // With mods on, the camera locks to the hero's lane so shots fly straight up the screen.
  const targetX = p.x * LW * (lock ? 1 : 0.55);
  cam.x = cam.x == null || lock ? targetX : lerp(cam.x, targetX, 0.12);
  const H = 2.7 + p.y * 0.45;
  cam.h = cam.h == null ? H : lerp(cam.h, H, 0.15);
  const F = Math.min(h * 1.1, w * 0.95), horizon = h * 0.34;
  const c0 = curve(zc), cd = curveD(zc), h0 = hill(zc), hd = hillD(zc);
  const proj = (X, Y, Z) => {
    const dz = Z - zc;
    if (dz < 0.25) return null;
    const ox = curve(Z) - c0 - cd * dz, oy = hill(Z) - h0 - hd * dz, k = F / dz;
    return [w / 2 + (X + ox - cam.x) * k, horizon + (cam.h - Y - oy) * k, k];
  };
  return { zc, F, horizon, proj, heading: cd, camX: cam.x, camH: cam.h };
}

function quad(ctx, a, b, c, d, fill) {
  if (!a || !b || !c || !d) return;
  ctx.fillStyle = fill; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.closePath(); ctx.fill();
}
const fog = (color, haze, dz) => mixHex(color, haze, clamp((dz - 12) / (FAR - 12), 0, 0.92));

/** A box with visible faces only: side faces, top, then front. */
function box(ctx, v, X0, X1, Y0, Y1, Z0, Z1, colors, haze, decorate) {
  const z0 = Math.max(Z0, v.zc + 0.6);
  if (Z1 <= z0) return;
  const P = (x, y, z) => v.proj(x, y, z);
  const f00 = P(X0, Y0, z0), f10 = P(X1, Y0, z0), f11 = P(X1, Y1, z0), f01 = P(X0, Y1, z0);
  const b00 = P(X0, Y0, Z1), b10 = P(X1, Y0, Z1), b11 = P(X1, Y1, Z1), b01 = P(X0, Y1, Z1);
  if (!f00) return;
  const dz = z0 - v.zc;
  const ox = curve(z0) - curve(v.zc) - v.heading * dz;
  if (X0 + ox > v.camX) quad(ctx, f00, b00, b01, f01, fog(colors.side, haze, dz));
  if (X1 + ox < v.camX) quad(ctx, f10, b10, b11, f11, fog(colors.side, haze, dz));
  if (Y1 < v.camH) quad(ctx, f01, f11, b11, b01, fog(colors.top, haze, dz));
  quad(ctx, f00, f10, f11, f01, fog(colors.front, haze, dz));
  if (decorate && Z0 >= v.zc + 0.6) decorate(f00, f10, f11, f01, dz);
}

function stripes(ctx, a, b, c, d, color, n) {
  ctx.save(); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.closePath(); ctx.clip();
  const w = b[0] - a[0], hh = a[1] - d[1];
  ctx.fillStyle = color;
  for (let i = -1; i < n + 1; i++) { const x = a[0] + (i / n) * w; ctx.beginPath(); ctx.moveTo(x, a[1]); ctx.lineTo(x + w / n / 2, a[1]); ctx.lineTo(x + w / n / 2 + hh * 0.6, d[1]); ctx.lineTo(x + hh * 0.6, d[1]); ctx.fill(); }
  ctx.restore();
}

export function drawLanes(ctx, state, look, fx, w, h, v, frame) {
  const p = state.p, clock = fx.clock, c = look.content, M = mid(c), HW = LW * (M + 0.5);
  const haze = look.night ? '#2a3058' : look.time === 'sunset' ? '#f0a888' : '#c8dcf0';
  // Sky slides with the track's heading; skyline sits on the horizon.
  drawSky(ctx, look, w, h * 0.62, -v.heading * 900 + p.z * 0.4, 0, 1.1);
  const hz = v.proj(0, 0, v.zc + FAR)?.[1] ?? v.horizon;
  drawLayer(ctx, look, w, h, -v.heading * 1400 + p.z * 1.2, { base: hz + 2, height: h * 0.16, depth: 0.15, color: mixHex(look.ground, haze, 0.55), unit: h / 22 });
  // Ground and track, far to near.
  const side = look.theme === 'city' || look.theme === 'factory' ? mixHex(look.ground, '#555560', 0.5) : look.surface;
  const bed = mixHex('#7a7068', look.ground, 0.3), tie = '#5a4030', rail = '#d8dde6';
  ctx.fillStyle = fog(side, haze, FAR); ctx.fillRect(0, hz, w, h - hz);
  const z0 = Math.floor((v.zc + 1) / SEG) * SEG;
  for (let Z = z0 + FAR; Z >= v.zc + 0.5; Z -= SEG) {
    const za = Z, zb = Math.max(v.zc + 0.4, Z - SEG), dz = za - v.zc;
    const A = (x, y = 0) => v.proj(x, y, za), B = (x, y = 0) => v.proj(x, y, zb);
    const stripe = Math.floor(za / (SEG * 2)) % 2 === 0;
    const a = A(-60), bq = A(60), cq = B(60), d = B(-60);
    quad(ctx, a, bq, cq, d, fog(stripe ? side : mixHex(side, '#000000', 0.08), haze, dz));
    const E = HW + 0.55;
    quad(ctx, A(-E - 0.5, 0.25), A(E + 0.5, 0.25), B(E + 0.5, 0.25), B(-E - 0.5, 0.25), fog(mixHex(side, '#ffffff', 0.18), haze, dz));
    quad(ctx, A(-E), A(E), B(E), B(-E), fog(stripe ? bed : mixHex(bed, '#000000', 0.07), haze, dz));
  }
  // Sleepers and rails (separate pass so they sit on the bed).
  const tieGap = 1.25;
  for (let Z = Math.floor((v.zc + FAR * 0.7) / tieGap) * tieGap; Z >= v.zc + 0.6; Z -= tieGap) {
    const dz = Z - v.zc;
    for (let lane = -M; lane <= M; lane++) {
      const X = lane * LW;
      quad(ctx, v.proj(X - 0.68, 0.02, Z), v.proj(X + 0.68, 0.02, Z), v.proj(X + 0.68, 0.02, Z - 0.28), v.proj(X - 0.68, 0.02, Z - 0.28), fog(tie, haze, dz));
    }
  }
  ctx.lineCap = 'round';
  for (let Z = v.zc + FAR * 0.8; Z >= v.zc + 0.6; Z -= SEG) {
    const zb = Math.max(v.zc + 0.5, Z - SEG), dz = Z - v.zc, col = fog(rail, haze, dz);
    for (let lane = -M; lane <= M; lane++) for (const s of [-0.45, 0.45]) {
      const X = lane * LW + s;
      quad(ctx, v.proj(X - 0.045, 0.07, Z), v.proj(X + 0.045, 0.07, Z), v.proj(X + 0.045, 0.07, zb), v.proj(X - 0.045, 0.07, zb), col);
    }
  }
  // Drawables sorted far to near.
  const items = [];
  const bStep = 13;
  for (let i = Math.floor((v.zc + FAR) / bStep); i * bStep > v.zc - bStep; i--) for (const sgn of [-1, 1]) {
    const r = hash(i * 2 + (sgn > 0 ? 1 : 0));
    const Z = i * bStep + r * 4, x0 = sgn * (HW + 3.2 + r * 2.5), bw = 3 + r * 4, bh = 5 + hash(i * 7 + sgn) * 10;
    items.push({ z: Z + 6, draw: () => building(ctx, v, sgn > 0 ? x0 : x0 - bw, sgn > 0 ? x0 + bw : x0, bh, Z, Z + 10, look, haze) });
    if (hash(i * 11 + sgn) > 0.45) items.push({ z: Z, draw: () => lamp(ctx, v, sgn * (HW + 1.3), Z, look, haze) });
  }
  for (const o of state.objs) {
    const gone = state.gone[o.id];
    if (o.t === 'coin') {
      if (gone !== undefined) { const k = (state.time - gone) / 0.22; if (k < 1) items.push({ z: lerp(o.z, p.z, k), draw: () => { const q = v.proj(lerp((o.lane - M) * LW, p.x * LW, k), lerp(o.y, p.y + 1, k), lerp(o.z, p.z, k)); if (q) drawCoin(ctx, look.art, look, q[0], q[1], 0.36 * q[2] * (1 - k * 0.4), clock); } }); continue; }
      if (o.z - v.zc > FAR * 0.85) continue;
      items.push({ z: o.z, draw: () => { const q = v.proj((o.lane - M) * LW, o.y + Math.sin(clock * 3 + o.z) * 0.06, o.z); if (q) drawCoin(ctx, look.art, look, q[0], q[1], 0.36 * q[2], clock + o.z * 0.2, clamp((FAR * 0.85 - (o.z - v.zc)) / 10, 0, 1)); } });
    } else if (o.t === 'box') {
      if (gone !== undefined) continue;
      items.push({ z: o.z, draw: () => { const q = v.proj((o.lane - M) * LW, 0.75, o.z); if (!q) return; const s = 0.75 * q[2]; ctx.save(); ctx.translate(q[0], q[1] + Math.sin(clock * 4) * s * 0.08); ctx.rotate(Math.sin(clock * 2) * 0.2); ctx.shadowColor = look.pal.accent2; ctx.shadowBlur = 16; roundRect(ctx, -s / 2, -s / 2, s, s, s * 0.2); ctx.fillStyle = look.pal.accent2; ctx.fill(); ctx.shadowBlur = 0; ctx.fillStyle = '#fff'; star(ctx, s * 0.32, s * 0.14); ctx.fill(); ctx.restore(); } });
    } else {
      const z = zOf(o, p.z);
      if (z - v.zc > FAR) continue;
      if (gone !== undefined && state.time - gone > 0.6) continue;
      if (z + (o.len || 0.5) < p.z - 1.2) continue; // passed: never balloon in front of the camera
      items.push({ z: z + (o.t === 'wall' || o.t === 'mover' ? 0.01 : 0), draw: () => obstacle(ctx, v, o, z, look, haze, gone === undefined ? 0 : state.time - gone, clock) });
    }
  }
  items.push({ z: p.z, draw: () => hero(ctx, state, look, fx, v, frame) });
  if (p.chaseT > 0 || (state.status === 'lost' && /Caught/.test(state.reason))) items.push({ z: p.z - 2.6, draw: () => chaser(ctx, state, look, fx, v) });
  items.sort((a, b) => b.z - a.z);
  for (const it of items) it.draw();
  // Speed lines from the vanishing point.
  const k = clamp((state.speed - c.speed.start) / Math.max(1, c.speed.max - c.speed.start), 0, 1);
  if (k > 0.15 && !frame.reducedMotion && state.status === 'playing') {
    const vp = v.proj(0, 1, v.zc + FAR) || [w / 2, v.horizon];
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.55)';
    for (let i = 0; i < 6 + k * 16; i++) {
      const a = hash(i * 13) * TAU, ph = (clock * (1.2 + hash(i) * 0.8) + hash(i * 7)) % 1;
      const r0 = Math.max(w, h) * (0.25 + ph * 0.6), r1 = r0 + 30 + k * 90;
      ctx.globalAlpha = 0.12 + k * 0.25; ctx.lineWidth = 1 + (i % 3);
      ctx.beginPath(); ctx.moveTo(vp[0] + Math.cos(a) * r0, vp[1] + Math.sin(a) * r0); ctx.lineTo(vp[0] + Math.cos(a) * r1, vp[1] + Math.sin(a) * r1); ctx.stroke();
    }
    ctx.restore();
  }
}

function building(ctx, v, X0, X1, H, Z0, Z1, look, haze) {
  const base = look.night ? mixHex(look.ground, '#10142a', 0.55) : mixHex(look.ground, '#8a8aa0', 0.35);
  const colors = { front: base, side: mixHex(base, '#000000', 0.22), top: mixHex(base, '#ffffff', 0.15) };
  box(ctx, v, X0, X1, 0, H, Z0, Z1, colors, haze, (a, b, c, d, dz) => {
    if (dz > 70) return;
    const lit = look.night ? 'rgba(255,214,120,.8)' : 'rgba(30,40,60,.35)';
    ctx.fillStyle = fog(lit.startsWith('rgba(255') ? '#ffd678' : '#3a4660', haze, dz);
    const cols = 3, rows = Math.max(2, Math.floor(H / 2));
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      if (look.night && hash(i * 5 + j * 11 + Math.round(Z0)) < 0.4) continue;
      const u0 = (i + 0.25) / cols, u1 = (i + 0.7) / cols, v0 = (j + 0.3) / rows, v1 = (j + 0.75) / rows;
      const P = (u, vv) => [lerp(lerp(a[0], b[0], u), lerp(d[0], c[0], u), vv), lerp(lerp(a[1], b[1], u), lerp(d[1], c[1], u), vv)];
      const q = [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)];
      ctx.beginPath(); q.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.fill();
    }
  });
}
function lamp(ctx, v, X, Z, look, haze) {
  const a = v.proj(X, 0, Z), b = v.proj(X, 4.2, Z);
  if (!a || !b) return;
  const dz = Z - v.zc;
  ctx.strokeStyle = fog('#3a3f4b', haze, dz); ctx.lineWidth = Math.max(1, a[2] * 0.12);
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  ctx.fillStyle = look.night ? '#fff0b0' : fog('#e8e8f0', haze, dz);
  ctx.beginPath(); ctx.arc(b[0], b[1], Math.max(1.5, b[2] * 0.22), 0, TAU); ctx.fill();
  if (look.night && dz < 60) { const g = ctx.createRadialGradient(b[0], b[1], 0, b[0], b[1], b[2] * 2.2); g.addColorStop(0, 'rgba(255,220,140,.35)'); g.addColorStop(1, 'rgba(255,220,140,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b[0], b[1], b[2] * 2.2, 0, TAU); ctx.fill(); }
}

function obstacle(ctx, v, o, z, look, haze, goneT, clock) {
  const X = (o.lane - mid(look.content)) * LW, dz = z - v.zc;
  if (goneT > 0) { ctx.save(); ctx.globalAlpha = clamp(1 - goneT / 0.6, 0, 1); }
  if (o.t === 'low') {
    const lift = goneT > 0 ? goneT * 3 : 0;
    box(ctx, v, X - 0.72, X + 0.72, 0.15 + lift, 0.85 + lift, z, z + 0.25, { front: '#e8402a', side: '#a02a1a', top: '#ff7a5a' }, haze, (a, b, c, d) => stripes(ctx, a, b, c, d, fog('#ffffff', haze, dz), 4));
    for (const s of [-0.62, 0.52]) box(ctx, v, X + s, X + s + 0.1, 0, 0.2, z + 0.05, z + 0.2, { front: '#3a3f4b', side: '#2a2d36', top: '#5c6370' }, haze);
  } else if (o.t === 'high') {
    for (const s of [-0.78, 0.66]) box(ctx, v, X + s, X + s + 0.12, 0, 1.95, z, z + 0.15, { front: '#5c6370', side: '#3a3f4b', top: '#9aa3b0' }, haze);
    box(ctx, v, X - 0.78, X + 0.78, 1.1, 1.85, z, z + 0.15, { front: '#f5c542', side: '#b08a20', top: '#ffe08a' }, haze, (a, b, c, d) => stripes(ctx, a, b, c, d, fog('#1a1a22', haze, dz), 5));
    const q = v.proj(X, 2.1, z);
    if (q && dz < 50) { const on = Math.floor(clock * 4 + o.z) % 2 === 0; ctx.fillStyle = on ? '#ff3a3a' : '#5a2020'; ctx.beginPath(); ctx.arc(q[0], q[1], Math.max(1.5, q[2] * 0.12), 0, TAU); ctx.fill(); }
  } else {
    const mover = o.t === 'mover';
    const base = mover ? mixHex(look.pal.accent, '#d83a2a', 0.5) : mixHex(look.platform, '#3a6a8a', 0.4);
    const colors = { front: mixHex(base, '#ffffff', 0.08), side: mixHex(base, '#000000', 0.25), top: mixHex(base, '#ffffff', 0.25) };
    box(ctx, v, X - 0.78, X + 0.78, 0.05, 2.75, z, z + o.len, colors, haze, (a, b, c, d, dzz) => {
      const P = (u, vv) => [lerp(lerp(a[0], b[0], u), lerp(d[0], c[0], u), vv), lerp(lerp(a[1], b[1], u), lerp(d[1], c[1], u), vv)];
      const poly = (pts, fill) => { ctx.fillStyle = fill; ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.fill(); };
      poly([P(0.14, 0.52), P(0.86, 0.52), P(0.86, 0.85), P(0.14, 0.85)], fog('#1a2a3a', haze, dzz));
      poly([P(0.18, 0.78), P(0.5, 0.78), P(0.4, 0.84), P(0.18, 0.84)], 'rgba(255,255,255,.25)');
      poly([P(0, 0.3), P(1, 0.3), P(1, 0.36), P(0, 0.36)], fog('#f5c542', haze, dzz));
      const r = Math.abs(b[0] - a[0]) * 0.09;
      for (const u of [0.2, 0.8]) { const [hx, hy] = P(u, 0.15); ctx.fillStyle = mover ? '#fff6c0' : fog('#ffe08a', haze, dzz); ctx.beginPath(); ctx.arc(hx, hy, r, 0, TAU); ctx.fill(); }
      if (mover) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        for (const u of [0.2, 0.8]) { const [hx, hy] = P(u, 0.15); const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, r * 6); g.addColorStop(0, 'rgba(255,240,180,.6)'); g.addColorStop(1, 'rgba(255,240,180,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(hx, hy, r * 6, 0, TAU); ctx.fill(); }
        ctx.restore();
      }
    });
  }
  if (goneT > 0) ctx.restore();
}

function hero(ctx, state, look, fx, v, frame) {
  const p = state.p, X = p.x * LW;
  const g = v.proj(X, 0, p.z), q = v.proj(X, p.y, p.z);
  if (!g || !q) return;
  const size = 2.0 * q[2];
  // Shadow shrinks while airborne.
  ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(g[0], g[1], size * 0.28 / (1 + p.y * 0.4), size * 0.07, 0, 0, TAU); ctx.fill();
  let pose = p.y > 0.05 ? (p.vy > 0 ? 'jump' : 'fall') : runPose(p.z / 1.15), rot = 0, sx = 1, sy = 1, y = q[1];
  if (p.slideT > 0) { pose = 'jump'; rot = -1.25; sy = 0.95; y = g[1] + size * 0.05; }
  if (state.powers.jetpack > 0) pose = 'jump';
  if (state.status === 'lost') {
    const t = fx.deathAt == null ? 0 : fx.clock - fx.deathAt;
    pose = 'hurt'; y -= (5 * t - 9 * t * t) * size * 0.5; rot = -t * 4;
  } else { const sq = fx.squash || 0; sx = 1 + sq * 0.15; sy *= 1 - sq * 0.18; }
  const leaning = p.lane - mid(look.content) - p.x;
  if (state.powers.shield > 0 && state.status === 'playing') {
    ctx.save(); ctx.translate(q[0], q[1] + size * 0.02); ctx.rotate(leaning * 0.25);
    ctx.shadowColor = look.pal.accent2; ctx.shadowBlur = 12;
    roundRect(ctx, -size * 0.36, -size * 0.04, size * 0.72, size * 0.09, size * 0.045); ctx.fillStyle = look.pal.accent2; ctx.fill();
    ctx.restore();
  }
  if (state.powers.jetpack > 0 && state.status === 'playing') burst(fx, [{ x: (fx.r() - 0.5) * 0.3, y: -0.4, vx: (fx.r() - 0.5) * 1.5, vy: 6, g: 0, drag: 2, life: 0.3, max: 0.3, size: 0.25, grow: 0.3, shape: 'dot', color: 'rgba(255,170,60,.9)', add: true, rot: 0, spin: 0 }], q[0], q[1], q[2], false);
  const blink = state.invuln > 0 && Math.floor(fx.clock * 16) % 2 === 0 && state.status === 'playing';
  if (!blink) drawCharacter(ctx, look.art, 'hero', pose, q[0], y, size, { flip: leaning < -0.05, rot: rot + leaning * 0.18, sx, sy, colors: look.hero });
  if (state.powers.magnet > 0) { ctx.save(); ctx.strokeStyle = rgba(look.coinColor, 0.45); ctx.lineWidth = 2; ctx.setLineDash([6, 8]); ctx.lineDashOffset = -fx.clock * 40; ctx.beginPath(); ctx.ellipse(q[0], q[1] - size * 0.4, size * 0.7, size * 0.55, 0, 0, TAU); ctx.stroke(); ctx.restore(); }
  // Dust from the feet while running.
  if (p.y === 0 && state.status === 'playing' && !frame.paused && Math.floor(fx.clock * 20) % 5 === 0) burst(fx, bursts.dust(0, 0, 0.15, fx.r), g[0], g[1], q[2] * 0.22, false);
}

function chaser(ctx, state, look, fx, v) {
  const p = state.p;
  const caught = state.status === 'lost' && /Caught/.test(state.reason);
  const t = caught ? clamp((fx.clock - (fx.deathAt ?? fx.clock)) / 0.5, 0, 1) : 0;
  const closing = clamp(1 - p.chaseT / LANES.chase, 0, 1);
  const z = caught ? lerp(p.z - 2.2, p.z - 0.6, t) : p.z - 2.9 + Math.sin(fx.clock * 2) * 0.25 + closing * 0.6;
  const X = p.x * LW + (caught ? 0 : -0.7 + Math.sin(fx.clock * 1.3) * 0.3);
  const q = v.proj(X, 0, z);
  if (!q) return;
  ctx.save(); ctx.globalAlpha = caught ? 1 : clamp(p.chaseT * 2, 0, 1) * 0.95;
  drawCharacter(ctx, look.art, 'chaser', runPose(fx.clock * 9), q[0], q[1], 2.2 * q[2], { colors: look.foe });
  ctx.restore();
}
