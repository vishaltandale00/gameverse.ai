// Renderer for the physics kit: one scene per mode, a shared HUD, level intro
// and clear cards, particles, trails, screen shake and slow-motion zooms.
// All visual state lives here (never in game state).
import { createFx, stepFx, shake, flash, shakeOffset, sparks, ring, dust, shards, confetti, stars, smoke, floatText, drawFx } from './fx.js';
import {
  TAU, HUD_FONT, image, sprite, shade, rgba, roundRect, worldText, star, drawPiece, drawBrick, ROW_COLORS, drawCapsule, CAPSULE, drawPaddle, drawBall, drawTrail,
  drawPeg, PEG_COLOR, drawSlingshotFrame, drawFlipper, drawBumper, materialColor, polygon,
} from './draw.js';
import { worldVerts, findBody } from './physics.js';
import { INTRO_TIME, CLEAR_TIME } from './game.js';
import * as B from './modes/breakout.js';
import * as P from './modes/peggle.js';
import * as SL from './modes/slingshot.js';
import * as PB from './modes/pinball.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const fmt = n => Math.round(n).toLocaleString('en-US');
const MODE_LABEL = { breakout: 'Brick breaker', peggle: 'Peg shot', slingshot: 'Slingshot', pinball: 'Pinball' };
const MODE_HINT = {
  breakout: '←/→ move · Space launch · catch the capsules',
  peggle: '←/→ aim · ↑/↓ fine aim · Space shoot',
  slingshot: '↑/↓ angle · ←/→ pull · Space release · Space again for the ability · hold X to look ahead',
  pinball: '←/→ or Z/X flippers · hold ↓ plunger · ↑ nudge',
};
const PROJECTILE_COLOR = { normal: '#ff5a4a', split: '#4aa8ff', boost: '#ffd23a', bomb: '#2c2f3a', heavy: '#8d96a6' };

export function createRenderer(game, { art = {} } = {}) {
  const dir = art.direction || {};
  const heroColor = dir.player?.colors?.primary || '#3a7bd5';
  const heroAccent = dir.player?.colors?.accent || '#ffcf4a';
  const foeColor = dir.enemy?.colors?.primary || '#d8352a';
  const prizeColor = dir.pickup?.color || '#ffd23a';
  const pixel = /pixel/i.test(art.style || '');
  const frameOf = (kind, pose) => image(art.frames?.[kind]?.[pose]) || image(art.frames?.[kind]?.idle) || image(art.sprites?.[kind]);
  const v = { fx: createFx(), trails: new Map(), cam: null, key: '', time: 0, score: 0, scorePop: 0, bodyFlash: new Map(), squash: 0, zap: [], zoom: 1, zoomTo: null, lastLives: null, livesPop: 0, laneLight: 0, shotTrail: [] };

  function reset(S) {
    v.fx = createFx(); v.trails = new Map(); v.cam = null; v.bodyFlash = new Map(); v.zap = []; v.zoom = 1; v.zoomTo = null; v.camY = null;
    v.key = `${S.level}:${S.attempt}`;
  }

  // ---------- view transforms ----------
  function viewFor(S, w, h) {
    const top = 50, m = S.m;
    if (S.mode === 'slingshot') {
      // Zoom out to show the slingshot and the whole fort when it fits; big worlds pan with the camera.
      const span = (m.right + 3) + 5, scale = clamp(w / span, h / 34, h / 13), viewW = w / scale, viewH = h / scale;
      return { scale, viewW, viewH, top: 0, world: true };
    }
    const size = S.mode === 'breakout' ? [m.w, m.h] : S.mode === 'peggle' ? [m.W, m.H] : [PB.W, m.H + 0.6];
    const avail = [w - 24, h - top - 14];
    const fit = Math.min(avail[0] / size[0], avail[1] / size[1]);
    if (S.mode === 'pinball' && m.E) {
      // A tall table is shown about one normal table high, and the camera follows the lowest ball.
      const scale = Math.min(avail[0] / size[0], avail[1] / 21.2), viewH = avail[1] / scale;
      const balls = m.balls.map(id => findBody(S.world, id)).filter(Boolean);
      const focus = balls.length ? Math.max(...balls.map(b => b.y)) : m.H;
      const want = clamp(focus - viewH * 0.62, 0, Math.max(0, size[1] - viewH));
      v.camY = v.camY == null ? want : lerp(v.camY, want, 1 - Math.exp(-(1 / 60) * 6));
      return { scale, ox: (w - size[0] * scale) / 2, oy: top - v.camY * scale, size, clipTop: top, clipH: avail[1] };
    }
    return { scale: fit, ox: (w - size[0] * fit) / 2, oy: top + (avail[1] - size[1] * fit) / 2, size };
  }

  // ---------- events → effects ----------
  function onEvents(S, events, reduced) {
    const fx = v.fx, m = S.m;
    for (const e of events) {
      switch (e.name) {
        case 'break':
          if (S.mode === 'breakout') { const col = e.kind === 'x' ? '#ff5b2b' : ROW_COLORS[(e.row ?? 0) % ROW_COLORS.length]; shards(fx, e.x, e.y, col, 9, { speed: 6, size: 0.16, g: 16, w: 0.9, h: 0.4 }); sparks(fx, e.x, e.y, '#ffffff', 5, 5); ring(fx, e.x, e.y, col, 0.2, 3.5); shake(fx, 0.12, reduced); }
          else if (S.mode === 'slingshot') {
            const col = materialColor(e.material);
            shards(fx, e.x, e.y, col, e.material === 'glass' ? 16 : 12, { speed: e.material === 'glass' ? 7 : 5, size: e.material === 'stone' ? 0.24 : 0.2, g: 20, floor: 0, glass: e.material === 'glass', w: Math.min(2.5, e.w || 1), h: Math.min(2.5, e.h || 1) });
            dust(fx, e.x, e.y, 6, e.material === 'stone' ? 'rgba(190,190,200,0.7)' : 'rgba(225,200,160,0.7)', Math.min(2, e.w || 1));
            shake(fx, e.material === 'stone' ? 0.22 : 0.14, reduced);
          } else { shards(fx, e.x, e.y, '#ffd84a', 8, { speed: 5, size: 0.14 }); sparks(fx, e.x, e.y, '#fff2a0', 8); shake(fx, 0.1, reduced); }
          break;
        case 'hit':
          if (e.kind === 'metal') sparks(fx, e.x, e.y, '#dfe9ff', 8, 6);
          else if (e.kind === 'hard') { sparks(fx, e.x, e.y, '#e8dcff', 6, 5); }
          else if (e.kind === 'boss') { sparks(fx, e.x, e.y, '#ffe6a0', 10, 8); shake(fx, 0.15, reduced); }
          else if (e.kind === 'target') { stars(fx, e.x, e.y - 0.4, '#fff4a0', 4, 3); }
          else if (e.kind === 'bumper' || e.kind === 'flipper') sparks(fx, e.x, e.y, '#fff8d0', e.kind === 'bumper' ? 8 : 3, 6);
          else if (S.mode === 'peggle') { const col = PEG_COLOR[e.kind] || '#fff'; ring(fx, e.x, e.y, col, 0.25, 3, 0.3); sparks(fx, e.x, e.y, shade(col, 0.6), 4, 4); if (e.kind === 'orange' || e.kind === 'purple') shake(fx, 0.04, reduced); }
          break;
        case 'explode': ring(fx, e.x, e.y, '#ffd27a', 0.4, (e.r || 2) * 6, 0.35); ring(fx, e.x, e.y, '#ffffff', 0.2, (e.r || 2) * 4, 0.22); smoke(fx, e.x, e.y, 16, (e.r || 2) * 0.45); sparks(fx, e.x, e.y, '#ffb347', 22, (e.r || 2) * 6); flash(v.fx, '#ffcf80', 0.2, 0.4); shake(fx, 0.55, reduced); break;
        case 'bounce': v.squash = 1; sparks(fx, e.x, e.y, '#ffffff', 4, 4); break;
        case 'wall': sparks(fx, e.x, e.y, '#c8e0ff', 2, 3); break;
        case 'points': floatText(fx, e.x, e.y, `+${fmt(e.value)}`, e.value >= 5000 ? '#ffe36a' : '#ffffff', e.value >= 5000 ? 1.5 : e.value >= 500 ? 1.15 : 0.9); break;
        case 'collect': if (e.x != null) { stars(fx, e.x, e.y, prizeColor, 10, 5); ring(fx, e.x, e.y, '#ffffff', 0.3, 5); } break;
        case 'power': if (e.x != null) { ring(fx, e.x, e.y, '#7dff9c', 0.3, 7, 0.45); stars(fx, e.x, e.y, '#9dffb0', 12, 6); } break;
        case 'extra_life': v.livesPop = 1; break;
        case 'hurt': flash(v.fx, '#ff3b3b', 0.28, 0.35); shake(fx, 0.5, reduced); break;
        case 'drain': if (S.mode !== 'slingshot') { sparks(fx, e.x, e.y - 0.3, '#ff7a6a', 10, 6); } break;
        case 'shoot':
          if (S.mode === 'slingshot') { dust(fx, e.x, e.y + 0.2, 6, 'rgba(255,255,255,0.6)', 0.6); shake(fx, 0.08, reduced); }
          else if (S.mode === 'peggle') { smoke(fx, e.x, e.y, 6, 0.35, 'rgba(255,255,255,0.5)'); sparks(fx, e.x, e.y, '#fff2b0', 6, 5); }
          else if (e.kind === 'laser') sparks(fx, e.x, e.y, '#ff6a6a', 4, 3);
          else if (e.by === 'boss') ring(fx, e.x, e.y, '#ff6a3a', 0.2, 3);
          break;
        case 'pop': ring(fx, e.x, e.y, PEG_COLOR[e.kind] || '#fff', 0.2, 2.5, 0.25); sparks(fx, e.x, e.y, shade(PEG_COLOR[e.kind] || '#ffffff', 0.5), 3, 3); break;
        case 'zap': v.zap.push({ x: e.x, y: e.y, to: e.to, t: 0 }); flash(v.fx, '#c8ffd0', 0.15, 0.25); break;
        case 'fever': confetti(fx, m.W / 2, m.H * 0.4, ['#ff8a1c', '#ffd23a', '#36d36a', '#3f8cff', '#b45cff', '#ffffff'], 90, 16); flash(v.fx, '#fff3c0', 0.35, 0.45); shake(fx, 0.4, reduced); break;
        case 'jackpot': stars(fx, e.x, e.y, '#ffe36a', 14, 7); confetti(fx, e.x, e.y, ['#ffd23a', '#ffffff', '#ff8a1c'], 24, 9); break;
        case 'defeated':
          if (S.mode === 'slingshot') { smoke(fx, e.x, e.y, 14, (e.r || 0.5) * 1.6, 'rgba(235,235,235,0.75)'); stars(fx, e.x, e.y, '#ffe36a', 10, 6); shards(fx, e.x, e.y, foeColor, 8, { speed: 5, size: 0.16, floor: 0 }); shake(fx, 0.3, reduced); }
          else { smoke(fx, e.x, e.y, 20, 1.4); sparks(fx, e.x, e.y, '#ffb347', 30, 10); confetti(fx, e.x, e.y, ['#ffd23a', '#ff5a4a', '#ffffff'], 50, 12); flash(v.fx, '#ffffff', 0.3, 0.5); shake(fx, 0.8, reduced); }
          break;
        case 'impact': dust(fx, e.x, e.y, Math.min(10, 3 + (e.speed | 0) / 3), 'rgba(240,230,210,0.75)', 0.5); sparks(fx, e.x, e.y, '#fff5d0', Math.min(10, (e.speed | 0) / 2), 5); ring(fx, e.x, e.y, '#ffffff', 0.15, 3 + e.speed * 0.15, 0.2); shake(fx, Math.min(0.4, e.speed * 0.02), reduced); break;
        case 'thud': dust(fx, e.x, e.y, 4, 'rgba(225,210,180,0.6)', 0.4); break;
        case 'crack': shards(fx, e.x, e.y, materialColor(e.material), 3, { speed: 3, size: 0.1, floor: 0, glass: e.material === 'glass' }); break;
        case 'bumper': ring(fx, e.x, e.y, '#fff7b0', 0.55, 4, 0.25); shake(fx, 0.05, reduced); break;
        case 'sling': sparks(fx, e.x, e.y, '#ffffff', 6, 5); shake(fx, 0.06, reduced); break;
        case 'launch': smoke(fx, e.x, e.y + 0.4, 5, 0.25, 'rgba(255,255,255,0.5)'); break;
        case 'ramp': { const r = m.ramps[e.index]; stars(fx, r.entry[0], r.entry[1], '#9ff0ff', 8, 4); break; }
        case 'multiball': confetti(fx, e.x, e.y, ['#ffd23a', '#ff5a4a', '#3ad0e8', '#ffffff'], 40, 9); flash(v.fx, '#ffffff', 0.2, 0.3); break;
        case 'lock': ring(fx, e.x, e.y, '#9ff0ff', 0.3, 4); break;
        case 'tilt': flash(v.fx, '#ff2020', 0.6, 0.35); shake(fx, 0.6, reduced); break;
        case 'nudge': shake(fx, 0.25, reduced); break;
        case 'mission': case 'level_up': if (S.mode !== 'slingshot') confetti(fx, ...(centerOf(S)), ['#ffd23a', '#ff5a4a', '#3ad0e8', '#7dff9c', '#ffffff'], 60, 13); break;
        case 'stars': confetti(fx, ...centerOf(S), ['#ffd23a', '#ffffff', '#ff8a1c', '#7dff9c'], 70, 12); break;
        default: break;
      }
    }
  }
  function centerOf(S) {
    if (S.mode === 'breakout') return [S.m.w / 2, S.m.h * 0.45];
    if (S.mode === 'peggle') return [S.m.W / 2, S.m.H * 0.45];
    if (S.mode === 'pinball') return [PB.W / 2, PB.H * 0.4];
    return [v.cam?.x ?? 10, -4];
  }

  // ---------- background ----------
  function drawBackdrop(ctx, S, w, h, camX = 0) {
    const bg = image(art.background);
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    const base = S.mode === 'pinball' ? PB.PRESETS[S.m.preset]?.color || '#20183a' : '#1d2440';
    sky.addColorStop(0, shade(base, 0.15)); sky.addColorStop(1, shade(base, -0.5));
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    if (bg) {
      const ar = bg.width / bg.height;
      let bh = h, bw = bh * ar;
      if (bw < w) { bw = w; bh = bw / ar; }
      if (S.mode === 'slingshot') {
        // Parallax: the scenery is a bit wider than the view and slides slower than the world.
        bw = Math.max(bw, w * 1.3); bh = Math.max(bh, bw / ar);
        const off = -clamp((camX + 5) * 3, 0, bw - w);
        ctx.drawImage(bg, off, h - bh, bw, bh);
      } else { ctx.globalAlpha = S.mode === 'pinball' ? 0.35 : 0.85; ctx.drawImage(bg, (w - bw) / 2, (h - bh) / 2, bw, bh); ctx.globalAlpha = 1; }
    }
    if (S.mode !== 'slingshot') { ctx.fillStyle = 'rgba(8,10,24,0.38)'; ctx.fillRect(0, 0, w, h); }
  }

  // ---------- breakout ----------
  function drawBreakout(ctx, S, px, t) {
    const m = S.m, W = m.w, H = m.h;
    // Playfield panel and rails.
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(14,18,44,0.82)'); g.addColorStop(1, 'rgba(26,14,40,0.88)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H + 0.4);
    ctx.strokeStyle = 'rgba(120,150,255,0.07)'; ctx.lineWidth = 1 / px;
    for (let x = 1; x < W; x++) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 1; y < H; y++) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    const rail = ctx.createLinearGradient(-0.35, 0, 0, 0); rail.addColorStop(0, '#4c5670'); rail.addColorStop(0.5, '#d6deea'); rail.addColorStop(1, '#5c6680');
    ctx.fillStyle = rail; ctx.fillRect(-0.35, -0.35, 0.35, H + 0.75); ctx.save(); ctx.translate(W + 0.35, 0); ctx.scale(-1, 1); ctx.fillRect(0, -0.35, 0.35, H + 0.75); ctx.restore();
    ctx.fillStyle = '#9aa6bb'; ctx.fillRect(-0.35, -0.35, W + 0.7, 0.35);
    for (const b of S.world.bodies) if (b.tag === 'brick' && !b.dead) drawBrick(ctx, b, px, t, v.bodyFlash.get(b.id) || 0);
    // Boss.
    if (m.boss) {
      const boss = findBody(S.world, m.boss.id);
      if (boss) {
        const bob = Math.sin(t * 3) * 0.08;
        ctx.save(); ctx.translate(boss.x, boss.y + bob);
        roundRect(ctx, -1.85, -1.15, 3.7, 2.3, 0.35); const bg = ctx.createLinearGradient(0, -1.1, 0, 1.1); bg.addColorStop(0, shade(foeColor, 0.2)); bg.addColorStop(1, shade(foeColor, -0.55));
        ctx.fillStyle = bg; ctx.fill(); ctx.lineWidth = 3 / px; ctx.strokeStyle = '#140a14'; ctx.stroke();
        const img = frameOf('foe', m.boss.flash > 0 ? 'hurt' : (Math.floor(t * 2) % 2 ? 'idleB' : 'idle'));
        if (!sprite(ctx, img, 0, -0.05, 2.3, 2.3, { flip: true })) { ctx.fillStyle = '#ffe36a'; ctx.beginPath(); ctx.arc(-0.5, -0.2, 0.25, 0, TAU); ctx.arc(0.5, -0.2, 0.25, 0, TAU); ctx.fill(); }
        if (m.boss.flash > 0) { ctx.globalAlpha = m.boss.flash * 4; ctx.fillStyle = '#fff'; roundRect(ctx, -1.85, -1.15, 3.7, 2.3, 0.35); ctx.fill(); ctx.globalAlpha = 1; }
        ctx.restore();
        // HP bar above.
        const k = m.boss.hp / m.boss.max;
        roundRect(ctx, boss.x - 1.8, boss.y - 1.6, 3.6, 0.22, 0.11); ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fill();
        roundRect(ctx, boss.x - 1.76, boss.y - 1.56, 3.52 * k, 0.14, 0.07); ctx.fillStyle = k > 0.3 ? '#ff5a4a' : '#ffd23a'; ctx.fill();
      }
    }
    for (const s of m.shots) {
      const img = image(art.sprites?.hazard);
      if (!sprite(ctx, img, s.x, s.y, 0.7, 0.7, { rot: t * 6 })) { drawBall(ctx, s.x, s.y, 0.22, '#ff6a3a', 'rgba(255,90,40,0.5)'); }
    }
    for (const c of m.capsules) drawCapsule(ctx, c, px, t);
    for (const l of m.lasers) { ctx.fillStyle = 'rgba(255,80,90,0.35)'; ctx.fillRect(l.x - 0.09, l.y - 0.1, 0.18, 0.8); ctx.fillStyle = '#ffe0e0'; ctx.fillRect(l.x - 0.04, l.y, 0.08, 0.6); }
    // Paddle.
    const p = findBody(S.world, m.paddle);
    if (p) {
      v.squash = Math.max(0, v.squash - 0.12);
      drawPaddle(ctx, p.x, p.y, m.pw, 0.34, heroColor, px, { laser: m.powers.laser > 0, catcher: m.powers.catch > 0, squash: v.squash });
      if (m.held) {
        const ang = m.held.off * 0.9;
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.setLineDash([0.12, 0.14]); ctx.lineWidth = 2 / px;
        const bx = p.x + m.held.off * m.pw / 2, by = p.y - 0.4;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + Math.sin(ang) * 2.2, by - Math.cos(ang) * 2.2); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    drawBalls(ctx, S, '#f5f7fb', B.BALL_R, 'rgba(160,200,255,0.35)');
  }

  function drawBalls(ctx, S, color, r, glow) {
    const ids = S.mode === 'peggle' ? S.m.ballIds : S.m.balls;
    const live = new Set();
    for (const id of ids || []) {
      const b = findBody(S.world, id);
      if (!b) continue;
      live.add(id);
      let tr = v.trails.get(id); if (!tr) v.trails.set(id, tr = []);
      tr.push([b.x, b.y]); if (tr.length > 14) tr.shift();
      drawTrail(ctx, tr, r * 0.9, S.mode === 'pinball' ? '#bfe6ff' : '#ffffff');
      drawBall(ctx, b.x, b.y, r, color, glow);
    }
    for (const id of v.trails.keys()) if (!live.has(id)) v.trails.delete(id);
  }

  // ---------- peggle ----------
  function drawPeggle(ctx, S, px, t, reduced) {
    const m = S.m;
    roundRect(ctx, 0, 0, m.W, m.H + 0.2, 0.4);
    const g = ctx.createLinearGradient(0, 0, 0, m.H); g.addColorStop(0, 'rgba(18,30,70,0.55)'); g.addColorStop(1, 'rgba(10,16,40,0.75)');
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 3 / px; ctx.stroke();
    // Aim guide.
    if (m.phase === 'aim' && S.phase === 'play') {
      const gd = P.guide(S);
      ctx.fillStyle = m.guide > 0 ? 'rgba(140,255,170,0.85)' : 'rgba(255,255,255,0.75)';
      gd.pts.forEach(([x, y], i) => { const k = 1 - i / gd.pts.length; ctx.globalAlpha = 0.25 + 0.75 * k; ctx.beginPath(); ctx.arc(x, y, 0.07 * (0.6 + k * 0.6), 0, TAU); ctx.fill(); });
      ctx.globalAlpha = 1;
      if (gd.hit) { ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2 / px; ctx.beginPath(); ctx.arc(gd.hit[0], gd.hit[1], 0.42 + Math.sin(t * 8) * 0.04, 0, TAU); ctx.stroke(); }
    }
    for (const b of S.world.bodies) if (b.tag === 'peg' && !b.dead) drawPeg(ctx, b, px, t);
    // Zap arcs.
    for (const z of v.zap) {
      ctx.strokeStyle = `rgba(170,255,190,${1 - z.t / 0.4})`; ctx.lineWidth = 3 / px;
      for (const [x, y] of z.to) { ctx.beginPath(); ctx.moveTo(z.x, z.y); for (let i = 1; i <= 5; i++) { const k = i / 5; ctx.lineTo(lerp(z.x, x, k) + (i < 5 ? Math.sin(t * 50 + i * 7 + x) * 0.15 : 0), lerp(z.y, y, k) + (i < 5 ? Math.cos(t * 40 + i * 5 + y) * 0.15 : 0)); } ctx.stroke(); }
    }
    // Bucket or fever slots.
    if (m.fever) {
      P.FEVER_SLOTS.forEach((val, i) => {
        const x0 = i * m.W / 5, hit = m.slotHits.includes(i);
        const gg = ctx.createLinearGradient(0, m.H - 1.2, 0, m.H + 0.2); gg.addColorStop(0, rgba(['#3f8cff', '#36d36a', '#ff8a1c', '#36d36a', '#3f8cff'][i], hit ? 0.95 : 0.55)); gg.addColorStop(1, 'rgba(0,0,0,0.2)');
        ctx.fillStyle = gg; ctx.fillRect(x0 + 0.1, m.H - 1.1, m.W / 5 - 0.2, 1.3);
        worldText(ctx, val >= 100000 ? '100K' : `${val / 1000}K`, x0 + m.W / 10, m.H - 0.5, 0.42, px, '#ffffff', { stroke: 'rgba(0,0,0,0.5)' });
      });
      for (const b of S.world.bodies) if (b.tag === 'divider') { ctx.strokeStyle = '#e8ecff'; ctx.lineWidth = 0.16; const [a, c] = worldVerts(b); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.stroke(); }
    } else {
      const bx = m.bucket.x, by = m.H - 0.45;
      ctx.save(); ctx.translate(bx, by);
      const bg = ctx.createLinearGradient(0, -0.4, 0, 0.4); bg.addColorStop(0, shade(heroAccent, 0.3)); bg.addColorStop(1, shade(heroAccent, -0.45));
      ctx.fillStyle = bg; ctx.beginPath(); ctx.moveTo(-1.42, -0.35); ctx.lineTo(1.42, -0.35); ctx.lineTo(1.2, 0.45); ctx.lineTo(-1.2, 0.45); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = shade(heroAccent, -0.7); ctx.lineWidth = 2 / px; ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(-1.2, -0.3, 2.4, 0.12);
      ctx.fillStyle = 'rgba(255,255,255,0.4)'; for (let i = -2; i <= 2; i++) ctx.fillRect(i * 0.5 - 0.03, -0.18, 0.06, 0.55);
      ctx.restore();
      const goal = image(art.sprites?.goal);
      sprite(ctx, goal, bx, by - 0.95, 0.8, 0.8, { alpha: 0.9 });
    }
    // Cannon with the hero beside it.
    ctx.save(); ctx.translate(m.cannon.x, m.cannon.y); ctx.rotate(-m.aim);
    const cg = ctx.createLinearGradient(-0.3, 0, 0.3, 0); cg.addColorStop(0, shade(heroColor, -0.5)); cg.addColorStop(0.5, shade(heroColor, 0.35)); cg.addColorStop(1, shade(heroColor, -0.5));
    roundRect(ctx, -0.3, 0, 0.6, m.cannon.len + 0.1, 0.18); ctx.fillStyle = cg; ctx.fill(); ctx.strokeStyle = '#120c18'; ctx.lineWidth = 2 / px; ctx.stroke();
    ctx.fillStyle = shade(heroAccent, 0.1); ctx.fillRect(-0.34, m.cannon.len - 0.15, 0.68, 0.18);
    ctx.restore();
    ctx.fillStyle = shade(heroColor, -0.3); ctx.beginPath(); ctx.arc(m.cannon.x, m.cannon.y, 0.55, 0, TAU); ctx.fill(); ctx.strokeStyle = '#120c18'; ctx.lineWidth = 2 / px; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.arc(m.cannon.x - 0.15, m.cannon.y - 0.18, 0.16, 0, TAU); ctx.fill();
    const pose = m.fever ? (Math.floor(t * 6) % 2 ? 'jump' : 'idle') : m.phase === 'shot' ? 'runA' : Math.floor(t * 1.5) % 2 ? 'idleB' : 'idle';
    sprite(ctx, frameOf('hero', pose), m.cannon.x - 1.6, m.cannon.y + 0.1, 1.5, 1.5, { squash: 1 + Math.sin(t * 3) * 0.02 });
    drawBalls(ctx, S, '#f2f4f8', P.BALL_R, m.fever ? 'rgba(255,220,120,0.5)' : 'rgba(255,255,255,0.25)');
  }

  // ---------- slingshot ----------
  function slingCamera(S, viewW, dt) {
    const m = S.m, left = -5, home = left + viewW / 2, structure = Math.max(home, m.right - viewW / 2 + 3);
    let target = home;
    if (S.phase === 'intro') target = lerp(structure, home, ease((S.phaseT - 0.4) / (INTRO_TIME - 0.6)));
    else if (m.phase === 'aim') target = S.prev?.b ? structure : home;
    else {
      const lead = m.active.map(id => findBody(S.world, id)).find(Boolean);
      target = lead ? clamp(lead.x + viewW * 0.12, home, structure + 4) : (v.cam?.x ?? home);
    }
    target = clamp(target, home, Math.max(home, structure + 4));
    if (!v.cam) v.cam = { x: S.phase === 'intro' ? structure : target };
    v.cam.x = lerp(v.cam.x, target, 1 - Math.exp(-dt * (m.phase === 'flight' ? 6 : 2.4)));
    return v.cam.x;
  }

  function drawSlingshot(ctx, S, px, t, view) {
    const m = S.m, x0 = v.cam.x - view.viewW / 2, x1 = x0 + view.viewW;
    // Ground.
    const gg = ctx.createLinearGradient(0, 0, 0, 4); gg.addColorStop(0, '#6d4a2e'); gg.addColorStop(1, '#3a2716');
    ctx.fillStyle = gg; ctx.fillRect(x0 - 1, 0, view.viewW + 2, 6);
    ctx.fillStyle = '#5fae4a'; ctx.fillRect(x0 - 1, -0.12, view.viewW + 2, 0.3);
    ctx.fillStyle = '#8bd462'; ctx.fillRect(x0 - 1, -0.12, view.viewW + 2, 0.08);
    ctx.fillStyle = '#4b8f3a'; for (let x = Math.floor(x0); x < x1 + 1; x += 0.5) { ctx.beginPath(); ctx.moveTo(x, -0.1); ctx.lineTo(x + 0.12, -0.32 - ((x * 7) % 3) * 0.05); ctx.lineTo(x + 0.24, -0.1); ctx.fill(); }
    // Previous shot's path.
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    for (const [x, y] of m.lastTrail || []) { ctx.beginPath(); ctx.arc(x, y, 0.06, 0, TAU); ctx.fill(); }
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    (m.trail || []).forEach(([x, y], i) => { ctx.beginPath(); ctx.arc(x, y, i % 3 === 0 ? 0.11 : 0.06, 0, TAU); ctx.fill(); });
    // Ropes.
    for (const j of S.world.joints) if (j.tag === 'rope') {
      const b = findBody(S.world, j.b); if (!b) continue;
      const c = Math.cos(b.a), s = Math.sin(b.a), ax = b.x + c * j.lb[0] - s * j.lb[1], ay = b.y + s * j.lb[0] + c * j.lb[1];
      ctx.strokeStyle = '#d9c08a'; ctx.lineWidth = 0.07; ctx.beginPath(); ctx.moveTo(j.la[0], j.la[1]); ctx.lineTo(ax, ay); ctx.stroke();
      ctx.fillStyle = '#6b5a4a'; ctx.fillRect(j.la[0] - 0.3, j.la[1] - 0.12, 0.6, 0.16);
    }
    // Structure and foes.
    for (const b of S.world.bodies) if ((b.tag === 'block' || b.tag === 'rock') && !b.dead) drawPiece(ctx, b, px, { flash: b.data.hurt > 0.25 ? (b.data.hurt - 0.25) * 3 : 0 });
    for (const b of S.world.bodies) if (b.tag === 'target' && !b.dead) {
      const hurt = b.data.hurt > 0 || b.data.hp < b.data.max * 0.5;
      const pose = b.data.hurt > 0 ? 'hurt' : Math.floor(t * 1.6 + b.id) % 2 ? 'idleB' : 'idle';
      const img = frameOf('foe', pose), size = b.r * 2.5;
      const breath = 1 + Math.sin(t * 3 + b.id) * 0.03;
      if (!sprite(ctx, img, b.x, b.y - b.r * 0.15, size, size, { rot: b.a * 0.35, flip: true, squash: breath })) {
        ctx.fillStyle = foeColor; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill(); ctx.strokeStyle = shade(foeColor, -0.6); ctx.lineWidth = 2 / px; ctx.stroke();
        ctx.fillStyle = '#fff'; for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(b.x + s * b.r * 0.35, b.y - b.r * 0.15, b.r * 0.22, 0, TAU); ctx.fill(); }
      }
      if (b.data.armor === 'helmet') { ctx.fillStyle = '#9aa6b5'; ctx.strokeStyle = '#3a404a'; ctx.lineWidth = 1.5 / px; ctx.beginPath(); ctx.arc(b.x, b.y - b.r * 0.55, b.r * 0.85, Math.PI * 1.05, Math.PI * 1.95); ctx.closePath(); ctx.fill(); ctx.stroke(); }
      if (hurt) { ctx.fillStyle = 'rgba(80,140,255,0.8)'; ctx.beginPath(); ctx.arc(b.x - b.r * 0.6, b.y - b.r * 0.8, 0.06, 0, TAU); ctx.fill(); }
    }
    // Slingshot, bands, pouch.
    const sx = SL.POUCH.x, base = 0;
    const aiming = m.phase === 'aim' && m.queue.length && S.phase !== 'clear';
    const pull = aiming ? m.power * SL.MAX_PULL : 0;
    const pouch = [SL.POUCH.x - Math.cos(m.angle) * pull, SL.POUCH.y + Math.sin(m.angle) * pull];
    drawSlingshotFrame(ctx, sx, base, px, true);
    ctx.strokeStyle = '#4a2a14'; ctx.lineWidth = 0.13; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(sx + 0.45, -2.8); ctx.lineTo(pouch[0], pouch[1]); ctx.stroke();
    if (aiming) {
      // Preview arc.
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      SL.preview(m.angle, m.power, (0.5 + m.power * 0.4) * Math.min(1.6, (m.speedMax || 22) / 22), m.speedMax).forEach(([x, y], i) => { ctx.globalAlpha = 1 - i / 16; ctx.beginPath(); ctx.arc(x, y, 0.08, 0, TAU); ctx.fill(); });
      ctx.globalAlpha = 1;
      drawProjectile(ctx, m.queue[0], pouch[0], pouch[1], SL.PROJECTILE[m.queue[0]].r, 0, 'idle', px, t);
    }
    // Waiting projectiles on the ground.
    m.queue.slice(aiming ? 1 : 0).forEach((k, i) => { const r = SL.PROJECTILE[k].r, hop = Math.max(0, Math.sin(t * 4 - i * 0.9)) * 0.18; drawProjectile(ctx, k, -1.4 - i * 1.15, -r - hop, r, 0, 'idle', px, t); });
    for (const b of S.world.bodies) if (b.tag === 'projectile' && !b.dead) {
      const flying = Math.hypot(b.vx, b.vy) > 2;
      drawProjectile(ctx, b.data.kind, b.x, b.y, b.r, b.a, b.data.impacts ? 'hurt' : flying ? 'jump' : 'idle', px, t, flying);
    }
    ctx.strokeStyle = '#5a3218'; ctx.lineWidth = 0.13;
    ctx.beginPath(); ctx.moveTo(sx - 0.4, -2.75); ctx.lineTo(pouch[0], pouch[1]); ctx.stroke();
    drawSlingshotFrame(ctx, sx, base, px, false);
    if (aiming) { ctx.fillStyle = '#3a200e'; ctx.beginPath(); ctx.ellipse(pouch[0], pouch[1], 0.22, 0.12, -m.angle, 0, TAU); ctx.fill(); }
  }

  function drawProjectile(ctx, kind, x, y, r, a, pose, px, t, flying = false) {
    const col = PROJECTILE_COLOR[kind] || '#ff5a4a';
    ctx.save(); ctx.translate(x, y);
    if (flying) { ctx.fillStyle = rgba(col, 0.25); ctx.beginPath(); ctx.arc(0, 0, r * 1.35, 0, TAU); ctx.fill(); }
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
    g.addColorStop(0, shade(col, 0.55)); g.addColorStop(1, shade(col, -0.35));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill(); ctx.lineWidth = 2 / px; ctx.strokeStyle = shade(col, -0.65); ctx.stroke();
    if (kind === 'bomb') { ctx.strokeStyle = '#c9a36a'; ctx.lineWidth = 0.06; ctx.beginPath(); ctx.moveTo(0, -r); ctx.quadraticCurveTo(r * 0.4, -r * 1.5, r * 0.2, -r * 1.7); ctx.stroke(); ctx.fillStyle = Math.floor(t * 12) % 2 ? '#ffe36a' : '#ff7a2a'; ctx.beginPath(); ctx.arc(r * 0.2, -r * 1.75, 0.07, 0, TAU); ctx.fill(); }
    if (kind === 'heavy') { ctx.fillStyle = 'rgba(0,0,0,0.25)'; for (const [ox, oy] of [[-0.5, 0.3], [0.45, 0.35], [0.1, -0.55]]) { ctx.beginPath(); ctx.arc(ox * r, oy * r, r * 0.12, 0, TAU); ctx.fill(); } }
    const img = frameOf('hero', pose);
    sprite(ctx, img, 0, 0, r * 2.1, r * 2.1, { rot: a * 0.6 });
    ctx.restore();
  }

  // ---------- pinball ----------
  function drawPinball(ctx, S, px, t) {
    const m = S.m, preset = PB.PRESETS[m.preset], base = preset.color;
    // Playfield wood/neon surface inside the shell.
    ctx.save();
    ctx.beginPath(); ctx.moveTo(0.3, 20.8 + m.E); ctx.lineTo(0.3, 5.9); ctx.arc(6, 5.9, 5.7, Math.PI, Math.PI * 2); ctx.lineTo(11.7, 20.8 + m.E); ctx.closePath();
    const pf = ctx.createLinearGradient(0, 0, 0, 20); pf.addColorStop(0, shade(base, 0.25)); pf.addColorStop(1, shade(base, -0.35));
    ctx.fillStyle = pf; ctx.fill(); ctx.clip();
    const bg = image(art.background); if (bg) { ctx.globalAlpha = 0.18; ctx.drawImage(bg, 0, 0, 12, 21 + m.E); ctx.globalAlpha = 1; }
    // Playfield art: radial glow, inserts, the foe as the table's boss decal.
    const glow = ctx.createRadialGradient(6, 9, 0.5, 6, 9, 8); glow.addColorStop(0, rgba(heroAccent, 0.25)); glow.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = glow; ctx.fillRect(0, 0, 12, 21 + m.E);
    sprite(ctx, frameOf('foe', Math.floor(t * 1.2) % 2 ? 'idleB' : 'idle'), 5.65, 13.4 + m.E * 0.5, 2.6, 2.6, { alpha: 0.32 });
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 0.05; for (let r = 1; r < 9; r += 1.4) { ctx.beginPath(); ctx.arc(5.65, 13.4 + m.E * 0.5, r, 0, TAU); ctx.stroke(); }
    // Arrow inserts toward ramps; lit when the mission wants them.
    const cur = m.missions[m.mission];
    m.ramps.forEach((r, i) => {
      const on = (cur?.kind === 'ramps' || m.multiball) && Math.floor(t * 4 + i) % 2;
      ctx.save(); ctx.translate(r.entry[0], r.entry[1] + 1.4); ctx.rotate(i ? 0.2 : -0.2);
      ctx.fillStyle = on ? '#ffe36a' : 'rgba(255,227,106,0.25)'; ctx.beginPath(); ctx.moveTo(0, -0.5); ctx.lineTo(0.35, 0.1); ctx.lineTo(-0.35, 0.1); ctx.closePath(); ctx.fill(); ctx.restore();
    });
    ctx.restore();
    // Walls and posts.
    for (const b of S.world.bodies) {
      if (b.shape !== 'seg' || b.dead || b.sensor) continue;
      const [a, c] = worldVerts(b);
      if (b.tag === 'gate') { ctx.strokeStyle = '#c8d0e0'; ctx.lineWidth = 0.08; }
      else if (b.tag === 'plunger') continue;
      else { ctx.strokeStyle = '#d6dff0'; ctx.lineWidth = Math.max(0.16, b.r * 2 + 0.1); }
      ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(40,30,70,0.8)'; ctx.lineWidth = 0.05;
    for (const b of S.world.bodies) if (b.shape === 'seg' && b.tag === 'wall') { const [a, c] = worldVerts(b); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.stroke(); }
    // Slingshots.
    for (const b of S.world.bodies) if (b.tag === 'sling') {
      const vts = worldVerts(b), lit = (m.flash[b.id] || 0) > 0;
      polygon(ctx, vts); ctx.fillStyle = lit ? '#fff3a0' : shade(heroColor, -0.1); ctx.fill(); ctx.lineWidth = 0.09; ctx.strokeStyle = lit ? '#ffffff' : '#e8ecf6'; ctx.stroke();
    }
    // Bumpers, drop targets, rollovers, lock.
    for (const b of S.world.bodies) if (b.tag === 'bumper') drawBumper(ctx, b, foeColor, px, (m.flash[b.id] || 0) > 0, t);
    const bank = PB.PRESETS[m.preset].bank;
    for (let i = 0; i < m.targets; i++) {
      const off = (i - (m.targets - 1) / 2) * 0.72, x = bank.x + bank.dir[0] * off, y = bank.y + bank.dir[1] * off, w = bank.dir[0] ? 0.58 : 0.22, h = bank.dir[0] ? 0.22 : 0.58;
      const up = m.bank.some(id => { const b = findBody(S.world, id); return b && b.data.index === i; });
      roundRect(ctx, x - w / 2, y - h / 2, w, h, 0.05); ctx.fillStyle = up ? prizeColor : 'rgba(0,0,0,0.45)'; ctx.fill(); ctx.strokeStyle = up ? shade(prizeColor, -0.6) : 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1.5 / px; ctx.stroke();
    }
    for (const b of S.world.bodies) if (b.tag === 'rollover') {
      const lit = m.lanes[b.data.index];
      ctx.fillStyle = lit ? '#7dff9c' : 'rgba(125,255,156,0.18)'; ctx.beginPath(); ctx.arc(b.x, b.y + 0.55, 0.16, 0, TAU); ctx.fill();
      if (lit) { ctx.fillStyle = 'rgba(125,255,156,0.25)'; ctx.beginPath(); ctx.arc(b.x, b.y + 0.55, 0.35, 0, TAU); ctx.fill(); }
    }
    const lock = S.world.bodies.find(b => b.tag === 'lock');
    if (lock) {
      ctx.fillStyle = '#0a0612'; ctx.beginPath(); ctx.arc(lock.x, lock.y, 0.36, 0, TAU); ctx.fill();
      ctx.strokeStyle = m.lockLit ? (Math.floor(t * 5) % 2 ? '#9ff0ff' : '#ffffff') : 'rgba(159,240,255,0.3)'; ctx.lineWidth = 0.07; ctx.stroke();
      sprite(ctx, image(art.sprites?.prize), lock.x, lock.y - 0.75, 0.6, 0.6, { alpha: m.lockLit ? 1 : 0.4 });
      for (let i = 0; i < m.lockCount; i++) { ctx.fillStyle = i < m.locked ? '#9ff0ff' : 'rgba(159,240,255,0.2)'; ctx.beginPath(); ctx.arc(lock.x - (m.lockCount - 1) * 0.2 + i * 0.4, lock.y + 0.6, 0.1, 0, TAU); ctx.fill(); }
    }
    // Plunger lane.
    const pl = m.laneFloor + m.plunge * 0.7;
    ctx.fillStyle = '#0d0a14'; ctx.fillRect(11.02, 7.2, 0.66, 13.4 + m.E);
    ctx.strokeStyle = '#b8c2d4'; ctx.lineWidth = 0.05; ctx.beginPath(); for (let y = pl; y < 20.6 + m.E; y += 0.12) { ctx.lineTo(11.15, y); ctx.lineTo(11.55, y + 0.06); } ctx.stroke();
    ctx.fillStyle = '#e8402a'; ctx.fillRect(11.06, pl - 0.04, 0.58, 0.12);
    // Flippers and balls.
    for (const f of m.flippers) { const b = findBody(S.world, f.body); if (b) drawFlipper(ctx, b, m.tilted ? '#666' : heroAccent, px); }
    drawBalls(ctx, S, '#dfe6f2', PB.BALL_R, null);
    // Ramp rails over everything, with riding balls.
    const ramps = m.ramps;
    ramps.forEach((r, i) => {
      const rail = cur?.kind === 'ramps' ? '#9ff0ff' : '#c8d6ff';
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 0.62; strokePath(ctx, r.path, 0.12, 0.18);
      ctx.strokeStyle = rgba(rail, 0.28); ctx.lineWidth = 0.56; strokePath(ctx, r.path);
      ctx.strokeStyle = rgba(rail, 0.85); ctx.lineWidth = 0.05; strokePath(ctx, r.path.map(([x, y]) => [x - 0.24, y])); strokePath(ctx, r.path.map(([x, y]) => [x + 0.24, y]));
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 0.08; ctx.beginPath(); ctx.arc(r.entry[0], r.entry[1], 0.55, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
    });
    for (const r of m.rides) { const [x, y] = PB.rideAt(m, r); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.arc(x + 0.15, y + 0.22, PB.BALL_R, 0, TAU); ctx.fill(); drawBall(ctx, x, y, PB.BALL_R * 1.15, '#dfe6f2', 'rgba(159,240,255,0.4)'); }
    if (m.saveT > 0 && Math.floor(t * 4) % 2) worldText(ctx, 'SAVE', 5.65, 19.6 + m.E, 0.42, px, '#7dff9c', { stroke: 'rgba(0,0,0,0.6)' });
    if (m.tilted) worldText(ctx, 'TILT', 5.65, 11 + m.E * 0.5, 1.4, px, '#ff4a4a', { stroke: '#000' });
  }
  function strokePath(ctx, pts, dx = 0, dy = 0) { ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x + dx, y + dy) : ctx.moveTo(x + dx, y + dy)); ctx.stroke(); }

  // ---------- HUD ----------
  function drawHud(ctx, S, w, h, dt) {
    const m = S.m;
    if (S.score !== v.score) { v.scorePop = 1; v.score = S.score; }
    v.scorePop = Math.max(0, v.scorePop - dt * 4);
    if (v.lastLives != null && S.lives < v.lastLives) v.livesPop = -1;
    v.lastLives = S.lives; v.livesPop = v.livesPop > 0 ? Math.max(0, v.livesPop - dt * 2) : Math.min(0, v.livesPop + dt * 2);
    const bar = ctx.createLinearGradient(0, 0, 0, 46); bar.addColorStop(0, 'rgba(6,8,20,0.82)'); bar.addColorStop(1, 'rgba(6,8,20,0.35)');
    ctx.fillStyle = bar; ctx.fillRect(0, 0, w, 46);
    ctx.textBaseline = 'middle';
    // Score.
    ctx.save(); ctx.translate(16, 23); ctx.scale(1 + v.scorePop * 0.12, 1 + v.scorePop * 0.12);
    ctx.font = `900 22px ${HUD_FONT}`; ctx.textAlign = 'left'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.strokeText(fmt(S.score), 0, 1); ctx.fillStyle = '#fff6dc'; ctx.fillText(fmt(S.score), 0, 1);
    ctx.restore();
    // Level name and mode.
    const level = game.levels[S.level];
    ctx.textAlign = 'center'; ctx.font = `800 14px ${HUD_FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillText(`${S.level + 1}/${game.levels.length} · ${level.name}`, w / 2, 16);
    ctx.font = `700 12px ${HUD_FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillText(modeStatus(S), w / 2, 34);
    // Lives as hero heads.
    const icon = frameOf('hero', 'idle'), n = Math.min(S.lives, 9);
    for (let i = 0; i < n; i++) {
      const x = w - 22 - i * 26, pop = i === n - 1 && v.livesPop > 0 ? 1 + v.livesPop * 0.5 : 1;
      ctx.save(); ctx.translate(x, 23); ctx.scale(pop, pop);
      if (!sprite(ctx, icon, 0, 0, 28, 28)) { ctx.fillStyle = heroColor; ctx.beginPath(); ctx.arc(0, 0, 9, 0, TAU); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); }
      ctx.restore();
    }
    if (v.livesPop < 0) { ctx.globalAlpha = -v.livesPop; ctx.fillStyle = '#ff5a4a'; ctx.beginPath(); ctx.arc(w - 22 - n * 26, 23, 10 * (1 - v.livesPop), 0, TAU); ctx.fill(); ctx.globalAlpha = 1; }
    // Mode panels.
    if (S.mode === 'breakout') {
      const powers = Object.entries(m.powers);
      powers.forEach(([k, left], i) => {
        const [col, letter] = CAPSULE[k] || ['#ccc', '?'], x = 16 + i * 64, y = 58;
        roundRect(ctx, x, y, 58, 20, 10); ctx.fillStyle = rgba(col, 0.85); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = `900 12px ${HUD_FONT}`; ctx.textAlign = 'left'; ctx.fillText(`${letter} ${Math.ceil(left)}s`, x + 9, y + 10.5);
      });
    } else if (S.mode === 'peggle') {
      // Orange meter on the left, balls on the right.
      const total = m.total, done = total - m.orangeLeft, mh = Math.min(h - 120, 320), x = 14, y = 70;
      roundRect(ctx, x, y, 16, mh, 8); ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fill();
      for (let i = 0; i < total; i++) {
        const sy = y + mh - 6 - (i + 1) * ((mh - 8) / total), lit = i < done;
        ctx.fillStyle = lit ? (i >= total * 0.88 ? '#ff4a4a' : i >= total * 0.76 ? '#ff7a2a' : i >= total * 0.6 ? '#ffb02e' : i >= total * 0.4 ? '#ffd23a' : '#ff8a1c') : 'rgba(255,138,28,0.18)';
        ctx.fillRect(x + 3, sy + 1, 10, (mh - 8) / total - 2);
      }
      ctx.font = `900 18px ${HUD_FONT}`; ctx.textAlign = 'center'; ctx.fillStyle = '#ffe36a'; ctx.fillText(`x${m.multiplier}`, x + 8, y + mh + 18);
      const bx = w - 30;
      roundRect(ctx, bx - 10, 70, 20, Math.min(h - 120, 18 * 15 + 8), 10); ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fill();
      for (let i = 0; i < Math.min(m.balls, 15); i++) drawBall(ctx, bx, 70 + 13 + i * 18, 6.5, '#e8ecf4');
      ctx.font = `900 13px ${HUD_FONT}`; ctx.fillStyle = '#fff'; ctx.fillText(String(m.balls), bx, 70 + Math.min(h - 120, 18 * 15 + 8) + 14);
    } else if (S.mode === 'slingshot') {
      const potential = m.potential || 1, k = clamp(S.levelScore / potential, 0, 1);
      const x = 16, y = 58, bw = 150;
      roundRect(ctx, x, y, bw, 10, 5); ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fill();
      roundRect(ctx, x, y, Math.max(10, bw * k), 10, 5); ctx.fillStyle = '#ffd23a'; ctx.fill();
      for (const [i, f] of [0.42, 0.62, 0.9].entries()) { ctx.fillStyle = k >= f || (i === 0 && m.targetsLeft === 0) ? '#ffe36a' : 'rgba(255,255,255,0.3)'; star(ctx, x + bw * Math.min(f, 0.95), y + 5, 8); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.5; ctx.stroke(); }
    } else if (S.mode === 'pinball') {
      const cur = m.missions[m.mission], y = h - 34;
      if (cur) {
        const pw = Math.min(360, w - 32), x = (w - pw) / 2;
        roundRect(ctx, x, y, pw, 26, 13); ctx.fillStyle = 'rgba(8,6,20,0.78)'; ctx.fill(); ctx.strokeStyle = 'rgba(159,240,255,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
        const k = cur.count ? cur.progress / cur.count : 0;
        roundRect(ctx, x + 3, y + 3, (pw - 6) * k, 20, 10); ctx.fillStyle = 'rgba(80,200,255,0.35)'; ctx.fill();
        ctx.font = `800 12px ${HUD_FONT}`; ctx.textAlign = 'center'; ctx.fillStyle = '#e8fbff';
        ctx.fillText(`MISSION ${m.mission + 1}/${m.missions.length}: ${cur.name.toUpperCase()}  ${cur.kind === 'score' ? fmt(cur.progress) : cur.progress}/${cur.kind === 'score' ? fmt(cur.count) : cur.count}`, w / 2, y + 13.5);
      }
    }
  }
  function modeStatus(S) {
    const m = S.m;
    if (S.mode === 'breakout') return `${m.bricksLeft} bricks${m.boss ? ` · boss ${m.boss.hp}/${m.boss.max}` : ''}`;
    if (S.mode === 'peggle') return `${m.orangeLeft} orange left · ${m.balls} balls${m.guide > 0 ? ' · super guide' : ''}`;
    if (S.mode === 'slingshot') return `${m.targetsLeft} ${S.cast.foe} left · ${m.queue.length} shots`;
    return `bonus ${fmt(m.bonus)} x${m.bonusX}${m.multiball ? ' · MULTIBALL' : ''}${m.lockLit ? ' · lock lit' : ''}${m.tilt > 1.6 && !m.tilted ? ' · DANGER' : ''}`;
  }

  // ---------- cards ----------
  function card(ctx, w, h, k, draw) {
    if (k <= 0) return;
    ctx.save();
    ctx.globalAlpha = clamp(k, 0, 1);
    ctx.fillStyle = 'rgba(4,6,16,0.45)'; ctx.fillRect(0, 0, w, h);
    ctx.translate(w / 2, h / 2 - (1 - ease(k)) * 40);
    draw();
    ctx.restore();
  }
  function drawCards(ctx, S, w, h) {
    const level = game.levels[S.level];
    if (S.phase === 'intro') {
      const t = S.phaseT, k = Math.min(1, t / 0.35) * Math.min(1, (INTRO_TIME - t) / 0.35);
      card(ctx, w, h, k, () => {
        const pw = Math.min(520, w - 40), ph = 168;
        roundRect(ctx, -pw / 2, -ph / 2, pw, ph, 22); ctx.fillStyle = 'rgba(14,16,36,0.92)'; ctx.fill(); ctx.strokeStyle = rgba(heroAccent, 0.8); ctx.lineWidth = 3; ctx.stroke();
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `800 13px ${HUD_FONT}`; ctx.fillStyle = heroAccent; ctx.fillText(`LEVEL ${S.level + 1} · ${MODE_LABEL[level.mode].toUpperCase()}`, 0, -52);
        ctx.font = `900 ${Math.min(40, pw / 11)}px ${HUD_FONT}`; ctx.fillStyle = '#fff8e8'; ctx.fillText(level.name, 0, -16);
        ctx.font = `700 16px ${HUD_FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.86)'; ctx.fillText(S.attempt ? 'Try again!' : level.intro || '', 0, 22);
        ctx.font = `600 12px ${HUD_FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillText(MODE_HINT[level.mode], 0, 54);
      });
    } else if (S.phase === 'clear') {
      const t = S.phaseT, k = Math.min(1, t / 0.3) * Math.min(1, (CLEAR_TIME - t) / 0.3);
      card(ctx, w, h, k, () => {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `900 ${Math.min(54, w / 10)}px ${HUD_FONT}`; ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.strokeText('LEVEL CLEAR', 0, -30); ctx.fillStyle = '#ffe36a'; ctx.fillText('LEVEL CLEAR', 0, -30);
        ctx.font = `800 18px ${HUD_FONT}`; ctx.fillStyle = '#ffffff'; ctx.fillText(`+${fmt(S.levelScore)} points`, 0, 14);
        if (S.mode === 'slingshot') for (let i = 0; i < 3; i++) {
          const on = i < S.m.stars, pop = clamp((t - 0.3 - i * 0.25) / 0.25, 0, 1), s = 26 * (on ? ease(pop) * (1 + (1 - pop) * 0.6) : 0.8);
          ctx.fillStyle = on ? '#ffe36a' : 'rgba(255,255,255,0.2)'; star(ctx, (i - 1) * 64, 66 - (i === 1 ? 10 : 0), Math.max(1, s)); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 3; ctx.stroke();
        }
        const trophy = image(art.sprites?.goal);
        if (S.mode !== 'slingshot') sprite(ctx, trophy, 0, 70, 56, 56);
      });
    } else if (S.phase === 'fail') {
      const t = S.phaseT, k = Math.min(1, t / 0.3);
      card(ctx, w, h, k, () => {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `900 ${Math.min(46, w / 12)}px ${HUD_FONT}`; ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.strokeText('SO CLOSE!', 0, -18); ctx.fillStyle = '#ff8a6a'; ctx.fillText('SO CLOSE!', 0, -18);
        ctx.font = `700 16px ${HUD_FONT}`; ctx.fillStyle = '#ffffff'; ctx.fillText(S.note || '', 0, 22);
      });
    }
    if (S.banner && S.phase === 'play') {
      const t = S.banner.t, k = Math.min(1, t / 0.15) * Math.min(1, (2 - t) / 0.3), s = 1 + (1 - Math.min(1, t / 0.2)) * 0.6;
      ctx.save(); ctx.globalAlpha = clamp(k, 0, 1); ctx.translate(w / 2, h * 0.3); ctx.scale(s, s);
      const col = { power: '#7dff9c', fever: '#ffb02e', good: '#9ff0ff', bad: '#ff5a4a', stars: '#ffe36a' }[S.banner.kind] || '#ffffff';
      ctx.font = `900 ${Math.min(44, w / 12)}px ${HUD_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.strokeText(S.banner.text, 0, 0); ctx.fillStyle = col; ctx.fillText(S.banner.text, 0, 0);
      ctx.restore();
    }
  }

  // ---------- frame ----------
  function render(ctx, S, frame = {}) {
    const w = frame.cssWidth ?? ctx.canvas.width, h = frame.cssHeight ?? ctx.canvas.height;
    const reduced = !!frame.reducedMotion, dt = frame.paused ? 0 : clamp(frame.dt ?? 1 / 60, 0, 0.05);
    const t = (v.time += dt);
    if (!S?.m || !S.world) return;
    if (v.key !== `${S.level}:${S.attempt}`) reset(S);
    onEvents(S, frame.events ?? S.events ?? [], reduced);
    const slow = S.timeScale || 1;
    stepFx(v.fx, dt * slow);
    for (const z of v.zap) z.t += dt; v.zap = v.zap.filter(z => z.t < 0.4);
    ctx.save();
    ctx.imageSmoothingEnabled = !pixel;
    const view = viewFor(S, w, h);
    const camX = S.mode === 'slingshot' ? slingCamera(S, view.viewW, dt) : 0;
    drawBackdrop(ctx, S, w, h, camX);
    const [sx, sy, srot] = reduced ? [0, 0, 0] : shakeOffset(v.fx, 14);
    ctx.save();
    ctx.translate(w / 2 + sx, h / 2 + sy); ctx.rotate(srot); ctx.translate(-w / 2, -h / 2);
    let px;
    if (S.mode === 'slingshot') {
      px = view.scale;
      ctx.translate(w / 2, h * 0.84); ctx.scale(px, px); ctx.translate(-camX, 0);
    } else {
      px = view.scale;
      ctx.translate(view.ox, view.oy); ctx.scale(px, px);
      // Peggle's dramatic zoom toward the ball near the last orange peg.
      if (S.mode === 'peggle') {
        const want = slow < 1 && !reduced ? 1.7 : 1;
        v.zoom = lerp(v.zoom, want, 1 - Math.exp(-dt * 5));
        const ball = S.m.ballIds.map(id => findBody(S.world, id)).find(Boolean);
        if (ball && want > 1) v.zoomTo = [ball.x, ball.y];
        if (v.zoom > 1.01 && v.zoomTo) { const [zx, zy] = v.zoomTo; ctx.translate(zx, zy); ctx.scale(v.zoom, v.zoom); ctx.translate(-zx, -zy); px *= v.zoom; }
      }
    }
    if (S.mode === 'breakout') drawBreakout(ctx, S, px, t);
    else if (S.mode === 'peggle') drawPeggle(ctx, S, px, t, reduced);
    else if (S.mode === 'slingshot') drawSlingshot(ctx, S, px, t, view);
    else drawPinball(ctx, S, px, t);
    drawFx(ctx, v.fx, px);
    for (const f of v.fx.floats) {
      const k = f.t / f.life;
      ctx.globalAlpha = 1 - k * k;
      worldText(ctx, f.text, f.x, f.y - k * 1.2, 0.45 * f.size * (S.mode === 'slingshot' ? 1.3 : 1), px, f.color, { stroke: 'rgba(0,0,0,0.6)' });
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    if (slow < 1 && !reduced) {
      // Letterbox bars and a vignette while time is slowed.
      const k = clamp((1 - slow) * 1.4, 0, 1) * 0.9;
      ctx.fillStyle = `rgba(0,0,0,${0.55 * k})`; ctx.fillRect(0, 0, w, h * 0.06); ctx.fillRect(0, h * 0.94, w, h * 0.06);
      const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(0,0,0,${0.5 * k})`);
      ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
    }
    if (v.fx.flash) { const f = v.fx.flash; ctx.fillStyle = rgba(f.color, f.alpha * (1 - f.t / f.life)); ctx.fillRect(0, 0, w, h); }
    if (!frame.attract) { drawHud(ctx, S, w, h, dt); drawCards(ctx, S, w, h); }
    ctx.restore();
    // World units to CSS pixels, so cross-genre mods draw in the same space.
    if (S.mode === 'slingshot') {
      const s = view.scale;
      render.view = { X: x => w / 2 + (x - camX) * s + sx, Y: y => h * 0.84 + y * s + sy, s, clip: { x: 0, y: 0, w, h }, hud: { x: w / 2, y: 64 } };
    } else {
      const s = view.scale, [fw, fh] = view.size;
      render.view = { X: x => view.ox + x * s + sx, Y: y => view.oy + y * s + sy, s, clip: view.clipTop != null ? { x: view.ox, y: view.clipTop, w: fw * s, h: view.clipH } : { x: view.ox, y: view.oy, w: fw * s, h: fh * s }, hud: { x: view.ox + fw * s / 2, y: Math.min(h - 12, view.oy + fh * s + 10), w: Math.max(fw * s, w * 0.6) } };
    }
  }
  return render;
}
