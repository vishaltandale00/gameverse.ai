// Shmup-kit renderer: code-drawn glowing vector ships, enemies and bosses (or
// crisp pixelated ones for pixel art), parallax backdrops from art.background,
// a warping neon grid in the arena, bullets with glow and trails, explosions
// with particles and shockwaves, shake, banners and the HUD. Everything here is
// visual: it reads the game state and events and never changes them.
import { TILE } from './world.js';
import { ROCK_R } from './game.js';

const TAU = Math.PI * 2;
const MODE_LABEL = { fixed: 'FORMATION ATTACK', vertical: 'SCROLLING ASSAULT', twinstick: 'ARENA SURVIVAL', asteroids: 'ASTEROID FIELD' };
const MODE_HINT = { fixed: 'Move left and right. Hold fire.', vertical: 'Move anywhere. Hold fire. Bomb clears bullets.', twinstick: 'Move to dodge. Fire auto-aims at the nearest foe.', asteroids: 'Left/right rotate, up thrusts, down jumps to hyperspace.' };
export const PICKUP_LOOK = { spread: { c: '#ffb02a', t: 'S' }, laser: { c: '#4fd8ff', t: 'L' }, homing: { c: '#7dff6a', t: 'H' }, shield: { c: '#7aa8ff', t: 'O' }, bomb: { c: '#ff4d6d', t: 'B' }, life: { c: '#ffffff', t: '1UP' } };
const WEAPON_NAME = { shot: 'BLASTER', spread: 'SPREAD', laser: 'LASER', homing: 'HOMING' };
const ROMAN = ['', 'I', 'II', 'III'];
const FONTS = { pixel: 'ui-monospace, "Courier New", monospace', rounded: 'ui-rounded, "Nunito", system-ui, sans-serif', bold: 'system-ui, "Segoe UI", sans-serif', serif: 'Georgia, "Times New Roman", serif', hand: '"Comic Sans MS", "Chalkboard SE", system-ui, sans-serif' };
const EBULLET = '#ff3f8e', BBULLET = '#ffa62a';

// ---------- color & small helpers ----------
function hexRgb(h) {
  let s = String(h || '').replace('#', '');
  if (s.length === 3) s = [...s].map(c => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(s)) s = 'ffffff';
  return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16));
}
const rgba = (h, a) => { const [r, g, b] = hexRgb(h); return `rgba(${r},${g},${b},${a})`; };
function mix(a, b, t) { const x = hexRgb(a), y = hexRgb(b); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join(''); }
const lighten = (c, t) => mix(c, '#ffffff', t), darken = (c, t) => mix(c, '#000000', t);
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// Offscreen surfaces need a DOM or OffscreenCanvas; headless (Node) rendering skips the cached glows.
const surface = (w, h) => typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: w, height: h }) : null;
const ease = t => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

// Own bitmap enemies for the retro shapes (two animation frames each).
const BITMAPS = {
  crab: [
    ['X.........X', '.X..XXX..X.', '..XXXXXXX..', '.XX.XXX.XX.', 'XXXXXXXXXXX', '..XX.X.XX..', '.X.......X.', 'X.........X'],
    ['.X.......X.', 'X...XXX...X', 'X.XXXXXXX.X', 'XXX.XXX.XXX', '.XXXXXXXXX.', '..XX.X.XX..', '..X.....X..', '.X.......X.'],
  ],
  squid: [
    ['...XX...', '..XXXX..', '.XXXXXX.', 'XX.XX.XX', 'XXXXXXXX', '..X..X..', '.X.XX.X.', 'X.X..X.X'],
    ['...XX...', '..XXXX..', '.XXXXXX.', 'XX.XX.XX', 'XXXXXXXX', '.X.XX.X.', 'X......X', '.X....X.'],
  ],
};

export function createRenderer(game, { art = {} } = {}) {
  const C = game.content;
  const pixel = /pixel/i.test(art.style || '') || art.direction?.style === 'pixel';
  const font = FONTS[art.direction?.font] || (pixel ? FONTS.pixel : FONTS.bold);
  const bg = C.background || '#0a0820';
  const accent = art.direction?.player?.colors?.accent || '#ffd23f';
  const shipColor = C.player.color || art.direction?.player?.colors?.primary || '#4fd8ff';
  const rockColor = art.direction?.tiles?.groundColor || '#8a7a6a';
  const images = new Map();
  const img = url => {
    if (!url || typeof Image === 'undefined') return null;
    let i = images.get(url);
    if (!i) { i = new Image(); i.decoding = 'async'; i.src = url; images.set(url, i); }
    return i.complete && i.naturalWidth ? i : null;
  };
  const glowCache = new Map(), rockCache = new Map();
  const V = {};
  function reset(s) {
    Object.assign(V, { ref: s, particles: [], rings: [], popups: [], warps: [], trails: new Map(), shake: 0, flash: 0, flashColor: '#ffffff', time: 0, lastStage: -1,
      scoreShown: s.score, r: mulberry(7), toast: null, livesShown: s.lives, buffer: null, bufferCtx: null, phaseFlash: 0, bossShown: 0 });
    const r = mulberry(99);
    V.stars = Array.from({ length: 110 }, () => ({ x: r(), y: r(), z: 0.15 + r() * 0.85, tw: r() * TAU, hue: r() }));
  }

  // ---------- glow sprites ----------
  function glowSprite(color) {
    const key = color + pixel;
    let c = glowCache.get(key);
    if (c) return c;
    const n = pixel ? 16 : 64;
    c = surface(n, n);
    if (!c) return null;
    const g = c.getContext('2d'), [r, gg, b] = hexRgb(color);
    if (pixel) {
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const d = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2);
        const a = d < 0.35 ? 0.9 : d < 0.65 ? 0.45 : d < 1 ? 0.15 : 0;
        if (a) { g.fillStyle = `rgba(${r},${gg},${b},${a})`; g.fillRect(x, y, 1, 1); }
      }
    } else {
      const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
      grad.addColorStop(0, `rgba(${r},${gg},${b},0.9)`); grad.addColorStop(0.25, `rgba(${r},${gg},${b},0.45)`); grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      g.fillStyle = grad; g.fillRect(0, 0, n, n);
    }
    glowCache.set(key, c);
    return c;
  }
  function glow(g, x, y, radius, color, alpha = 1) {
    if (radius <= 0 || alpha <= 0) return;
    if (pixel) { radius = Math.round(radius * 0.55); alpha *= 0.7; if (radius < 2) return; }
    const prev = g.globalCompositeOperation, pa = g.globalAlpha;
    g.globalCompositeOperation = 'lighter'; g.globalAlpha = pa * Math.min(1, alpha);
    const sprite = glowSprite(color);
    if (sprite) g.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
    g.globalCompositeOperation = prev; g.globalAlpha = pa;
  }

  // ---------- effects from events ----------
  const colorOfType = id => id === '$rock' ? rockColor : game.enemyType(id)?.color || game.bossType(id)?.color || '#ff5a7a';
  function burst(x, y, color, n, speed, life, size, kind = 'spark', extra = {}) {
    for (let i = 0; i < n; i++) {
      const a = V.r() * TAU, v = speed * (0.3 + V.r() * 0.7);
      V.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: life * (0.5 + V.r() * 0.5), max: life, size: size * (0.6 + V.r() * 0.6), color, kind, rot: V.r() * TAU, spin: (V.r() - 0.5) * 12, drag: 2.2, ...extra });
    }
  }
  const ring = (x, y, r0, r1, life, color, width = 2) => V.rings.push({ x, y, r0, r1, life, max: life, color, width });
  const popup = (x, y, text, color, size = 9, life = 0.9) => V.popups.push({ x, y, text, color, size, life, max: life });
  const shake = (amt, reduced) => { if (!reduced) V.shake = Math.min(1, V.shake + amt); };
  const warp = (x, y, str, life, R = 90) => V.warps.push({ x, y, str, life, max: life, R });

  function explode(x, y, r, color, big, reduced) {
    const n = big ? 60 : Math.round(10 + r * 1.4);
    burst(x, y, '#ffffff', Math.round(n * 0.3), 220 + r * 6, 0.35, 1.6, 'spark');
    burst(x, y, color, n, 140 + r * 5, 0.8, 2.2, 'spark');
    burst(x, y, lighten(color, 0.3), Math.round(n * 0.4), 70 + r * 3, 1.1, 2.6, 'debris', { drag: 1.2 });
    burst(x, y, darken(color, 0.55), Math.round(n * 0.25), 30, 1.4, 6 + r * 0.3, 'smoke', { drag: 1 });
    ring(x, y, r * 0.4, r * (big ? 5 : 2.6), big ? 0.7 : 0.4, color, big ? 4 : 2);
    if (big) ring(x, y, r * 0.2, r * 3.2, 0.5, '#ffffff', 2);
    V.particles.push({ x, y, vx: 0, vy: 0, life: 0.14, max: 0.14, size: r * (big ? 3 : 1.8), color: '#ffffff', kind: 'flash' });
    warp(x, y, big ? 40 : 10 + r * 0.6, big ? 0.9 : 0.5, big ? 160 : 90);
    shake(big ? 0.7 : 0.12 + r * 0.008, reduced);
  }

  function onEvents(s, events, reduced) {
    for (const ev of events) {
      switch (ev.name) {
        case 'shoot': if (V.r() < 0.5) burst(ev.x, ev.y, shipColor, 2, 60, 0.12, 1.2, 'spark'); break;
        case 'hit': burst(ev.x, ev.y, ev.boss ? '#ffffff' : '#fff3c0', ev.boss ? 3 : 4, 120, 0.2, 1.1, 'spark'); break;
        case 'block': burst(ev.x, ev.y, '#a0b8ff', 3, 90, 0.18, 1, 'spark'); break;
        case 'chip': burst(ev.x, ev.y, '#7dff6a', 4, 50, 0.4, 1.5, 'debris', { drag: 1.5 }); break;
        case 'defeated': {
          const color = colorOfType(ev.type);
          if (ev.boss) { explode(ev.x, ev.y, 40, color, true, reduced); V.flash = Math.max(V.flash, 0.9); V.flashColor = '#ffffff'; popup(ev.x, ev.y - 20, `+${ev.points}`, '#ffffff', 16, 1.8); break; }
          explode(ev.x, ev.y, ev.r || 8, color, false, reduced);
          if (ev.tier) burst(ev.x, ev.y, rockColor, 6 + ev.tier * 4, 80, 0.9, 2.5, 'debris', { drag: 0.8 });
          popup(ev.x, ev.y - 6, `${ev.points}`, ev.mult > 1 ? accent : '#ffffff', ev.mult > 1 ? 9 : 7);
          if (ev.mult > 1 && V.r() < 0.35) popup(ev.x, ev.y + 6, `x${ev.mult}`, accent, 7, 0.6);
          break;
        }
        case 'boss_blast': explode(ev.x, ev.y, 14, '#ffb02a', false, reduced); break;
        case 'boss_down': V.flash = 0.6; shake(0.6, reduced); break;
        case 'boss_phase': V.phaseFlash = 1; ring(ev.x, ev.y, 10, 160, 0.6, '#ffffff', 3); shake(0.35, reduced); break;
        case 'boss_warning': V.flashColor = '#ff2040'; V.flash = 0.35; break;
        case 'boss_charge': ring(ev.x, ev.y, 20, 60, 0.3, '#ff4060', 3); break;
        case 'hurt': explode(ev.x, ev.y, 18, shipColor, true, reduced); V.flash = 0.7; V.flashColor = '#ffffff'; break;
        case 'respawn': ring(ev.x, ev.y, 70, 6, 0.5, shipColor, 2); ring(ev.x, ev.y, 40, 4, 0.4, '#ffffff', 1.5); break;
        case 'shield_break': ring(ev.x, ev.y, 10, 70, 0.4, '#7aa8ff', 3); burst(ev.x, ev.y, '#7aa8ff', 18, 160, 0.5, 1.6); shake(0.25, reduced); break;
        case 'bomb': ring(ev.x, ev.y, 10, 520, 0.9, '#ffffff', 6); ring(ev.x, ev.y, 10, 380, 0.7, '#ff4d6d', 10); V.flash = 0.9; V.flashColor = '#fff0f4'; warp(ev.x, ev.y, 60, 1.2, 260); shake(0.8, reduced); break;
        case 'cancel': for (const [x, y] of ev.pts) { V.particles.push({ x, y, vx: 0, vy: -30, life: 0.5, max: 0.5, size: 2.5, color: accent, kind: 'star', rot: 0, spin: 6, drag: 1 }); } break;
        case 'power': case 'collect': {
          const look = PICKUP_LOOK[ev.kind] || PICKUP_LOOK.spread;
          ring(ev.x, ev.y, 4, 34, 0.35, look.c, 2); burst(ev.x, ev.y, look.c, 14, 120, 0.45, 1.5, 'star');
          const label = ev.points ? `+${ev.points}` : ev.kind === 'shield' ? 'SHIELD' : ev.kind === 'bomb' ? 'BOMB +1' : `${WEAPON_NAME[ev.kind]} ${ROMAN[ev.tier] || ''}`;
          popup(ev.x, ev.y - 10, label, look.c, 9, 1.1);
          break;
        }
        case 'extra_life': V.toast = { text: 'EXTRA SHIP', t: 0 }; if (ev.x != null) ring(ev.x, ev.y, 4, 40, 0.4, '#ffffff', 2); break;
        case 'split': ring(ev.x, ev.y, 4, 24, 0.25, '#ffffff', 1.5); break;
        case 'swallow': ring(ev.x, ev.y, 40, 4, 0.3, '#c8a0ff', 2); break;
        case 'burst': explode(ev.x, ev.y, ev.r || 20, '#c8a0ff', true, reduced); break;
        case 'spawn': burst(ev.x, ev.y, '#ffffff', 6, 70, 0.3, 1.2); break;
        case 'hyperspace': ring(ev.x, ev.y, 50, 4, 0.35, shipColor, 2); break;
        case 'stage_clear': V.flash = 0.4; V.flashColor = '#ffffff'; break;
        case 'dive': break;
      }
    }
  }

  function stepFx(dt, s) {
    for (const p of V.particles) {
      p.life -= dt;
      const d = Math.max(0, 1 - (p.drag || 0) * dt);
      p.vx *= d; p.vy *= d; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += (p.spin || 0) * dt;
      if (p.kind === 'smoke') p.size += 8 * dt;
    }
    V.particles = V.particles.filter(p => p.life > 0);
    if (V.particles.length > 900) V.particles.splice(0, V.particles.length - 900);
    for (const r of V.rings) r.life -= dt;
    V.rings = V.rings.filter(r => r.life > 0);
    for (const p of V.popups) { p.life -= dt; p.y -= 22 * dt; }
    V.popups = V.popups.filter(p => p.life > 0);
    for (const w of V.warps) w.life -= dt;
    V.warps = V.warps.filter(w => w.life > 0);
    V.shake = Math.max(0, V.shake - dt * 1.8);
    V.flash = Math.max(0, V.flash - dt * 2.2);
    V.phaseFlash = Math.max(0, V.phaseFlash - dt * 1.5);
    if (V.toast && (V.toast.t += dt) > 2) V.toast = null;
    V.scoreShown += (s.score - V.scoreShown) * Math.min(1, dt * 10);
    if (Math.abs(s.score - V.scoreShown) < 1) V.scoreShown = s.score;
    // Trails for moving enemies, engine sparks for the ship.
    const live = new Set();
    for (const e of s.enemies) {
      if (e.mv === 'rock' || e.mv === 'gravity' || e.mv === 'turret' || e.st === 'formation') continue;
      live.add(e.id);
      let t = V.trails.get(e.id);
      if (!t) V.trails.set(e.id, t = []);
      if (dt > 0) { t.push(e.x, e.y); if (t.length > 16) t.splice(0, 2); }
    }
    for (const id of V.trails.keys()) if (!live.has(id)) V.trails.delete(id);
    const p = s.player;
    if (p.alive && dt > 0 && V.r() < 0.8) {
      const back = p.ang + Math.PI, on = s.mode !== 'asteroids' || p.thrust;
      if (on) V.particles.push({ x: p.x + Math.cos(back) * 9 + (V.r() - 0.5) * 3, y: p.y + Math.sin(back) * 9, vx: Math.cos(back) * 60 + (V.r() - 0.5) * 20, vy: Math.sin(back) * 60 + (s.mode === 'vertical' ? 40 : 0), life: 0.25, max: 0.25, size: 1.6, color: lighten(shipColor, 0.4), kind: 'spark', rot: 0, spin: 0, drag: 3 });
    }
    const b = s.boss;
    if (b && dt > 0 && b.hp / b.maxHp < 0.5 && V.r() < (b.st === 'dying' ? 0.9 : 0.25)) {
      V.particles.push({ x: b.x + (V.r() - 0.5) * b.r * 1.6, y: b.y + (V.r() - 0.5) * b.r, vx: (V.r() - 0.5) * 10, vy: -20 - V.r() * 20, life: 1, max: 1, size: 4, color: '#3a3040', kind: 'smoke', rot: 0, spin: 0, drag: 0.5 });
    }
    for (const bl of s.pbullets) if (bl.k === 'missile' && dt > 0 && V.r() < 0.6) V.particles.push({ x: bl.x, y: bl.y, vx: 0, vy: 0, life: 0.35, max: 0.35, size: 1.6, color: '#c8ffc0', kind: 'smoke', rot: 0, spin: 0, drag: 0 });
  }

  // ---------- backdrop ----------
  function drawCover(g, image, x, y, w, h, alpha) {
    const ir = image.naturalWidth / image.naturalHeight, r = w / h;
    let sw = image.naturalWidth, sh = image.naturalHeight, sx = 0, sy = 0;
    if (ir > r) { sw = sh * r; sx = (image.naturalWidth - sw) / 2; } else { sh = sw / r; sy = (image.naturalHeight - sh) / 2; }
    g.globalAlpha = alpha; g.drawImage(image, sx, sy, sw, sh, x, y, w, h); g.globalAlpha = 1;
  }

  function drawOuter(ctx, cw, ch, s) {
    const grad = ctx.createLinearGradient(0, 0, 0, ch);
    grad.addColorStop(0, darken(bg, 0.5)); grad.addColorStop(1, darken(bg, 0.2));
    ctx.fillStyle = grad; ctx.fillRect(0, 0, cw, ch);
    const back = img(art.background);
    if (back) { ctx.imageSmoothingEnabled = !pixel; drawCover(ctx, back, 0, 0, cw, ch, 0.22); }
  }

  function drawField(g, s) {
    const { W, H } = s, p = s.player;
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, darken(bg, 0.35)); grad.addColorStop(1, mix(bg, '#000000', 0.1));
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    const back = img(art.background);
    if (back) {
      g.imageSmoothingEnabled = !pixel;
      if (s.mode === 'vertical') {
        // Mirror-tiled flyover: alternate tiles are flipped so every seam matches.
        const tw = W * 1.15, th = tw * back.naturalHeight / back.naturalWidth, x0 = (W - tw) / 2, off = (s.scroll * 0.6) % (th * 2);
        for (let y = off - th * 2; y < H; y += th * 2) {
          g.globalAlpha = 0.5;
          g.drawImage(back, x0, y + th, tw, th);
          g.save(); g.translate(0, y + th); g.scale(1, -1); g.drawImage(back, x0, 0, tw, th); g.restore();
        }
        g.globalAlpha = 1;
      } else {
        const px = s.mode === 'asteroids' ? 0 : (p.x / W - 0.5) * -14;
        drawCover(g, back, -10 + px, -8, W + 20, H + 16, s.mode === 'twinstick' ? 0.32 : 0.5);
      }
      g.fillStyle = rgba(darken(bg, 0.4), s.mode === 'twinstick' ? 0.55 : 0.45); g.fillRect(0, 0, W, H);
    }
    // Starfield parallax.
    for (const st of V.stars) {
      let x = st.x * W, y = st.y * H;
      if (s.mode === 'vertical') y = (y + V.time * (24 + st.z * 160) + s.scroll * st.z) % H;
      else if (s.mode === 'fixed') y = (y + V.time * (10 + st.z * 70)) % H;
      else if (s.mode === 'twinstick') { x = ((x - (p.x - W / 2) * st.z * 0.12) % W + W) % W; y = ((y - (p.y - H / 2) * st.z * 0.12) % H + H) % H; }
      else { x = ((x - p.x * st.z * 0.05) % W + W) % W; y = ((y - p.y * st.z * 0.05) % H + H) % H; }
      const tw = 0.55 + 0.45 * Math.sin(V.time * 3 + st.tw);
      const color = st.hue < 0.15 ? '#ffd0a0' : st.hue < 0.3 ? '#a0c8ff' : '#ffffff';
      g.globalAlpha = (0.25 + st.z * 0.75) * tw;
      g.fillStyle = color;
      if (s.mode === 'vertical' && st.z > 0.8 && !pixel) g.fillRect(x, y, 1, 4 + st.z * 6);
      else { const sz = pixel ? 1 : 0.6 + st.z * 1.2; g.fillRect(Math.round(x), Math.round(y), sz, sz); }
    }
    g.globalAlpha = 1;
    if (s.mode === 'twinstick') drawGrid(g, s);
    if (s.mode === 'asteroids') { g.strokeStyle = rgba(shipColor, 0.08); g.lineWidth = 1; g.strokeRect(0.5, 0.5, W - 1, H - 1); }
  }

  function drawGrid(g, s) {
    const { W, H } = s, step = 24, cols = Math.round(W / step), rows = Math.round(H / step);
    const sources = V.warps.map(w => ({ x: w.x, y: w.y, str: w.str * (w.life / w.max), R: w.R }));
    for (const e of s.enemies) if (e.mv === 'gravity') sources.push({ x: e.x, y: e.y, str: -(14 + e.r), R: 130 });
    if (s.boss) sources.push({ x: s.boss.x, y: s.boss.y, str: 6 + 3 * Math.sin(V.time * 4), R: 80 });
    const pt = (i, j) => {
      let x = i * step, y = j * step;
      for (const w of sources) {
        const dx = x - w.x, dy = y - w.y, d = Math.hypot(dx, dy);
        if (d < w.R && d > 0.01) { const k = w.str * Math.sin((1 - d / w.R) * Math.PI / 2) / d; x += dx * k; y += dy * k; }
      }
      return [x, y];
    };
    const pts = [];
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) pts.push(pt(i, j));
    const at = (i, j) => pts[j * (cols + 1) + i];
    g.lineWidth = pixel ? 1 : 0.7;
    for (let pass = 0; pass < 2; pass++) {
      g.strokeStyle = rgba(pass ? lighten(shipColor, 0.2) : mix(bg, shipColor, 0.6), pass ? 0.22 : 0.12);
      g.beginPath();
      for (let j = 0; j <= rows; j++) { if ((j % 4 === 0) !== !!pass) continue; for (let i = 0; i <= cols; i++) { const [x, y] = at(i, j); i ? g.lineTo(x, y) : g.moveTo(x, y); } }
      for (let i = 0; i <= cols; i++) { if ((i % 4 === 0) !== !!pass) continue; for (let j = 0; j <= rows; j++) { const [x, y] = at(i, j); j ? g.lineTo(x, y) : g.moveTo(x, y); } }
      g.stroke();
    }
    g.strokeStyle = rgba(shipColor, 0.45); g.lineWidth = 2; g.strokeRect(1, 1, W - 2, H - 2);
  }

  // ---------- ships ----------
  function shipPath(g, kind) {
    g.beginPath();
    if (kind === 'delta') { g.moveTo(0, -12); g.lineTo(11, 8); g.lineTo(4, 5); g.lineTo(0, 8); g.lineTo(-4, 5); g.lineTo(-11, 8); }
    else if (kind === 'twin') { g.moveTo(-5, -11); g.lineTo(-3, -4); g.lineTo(3, -4); g.lineTo(5, -11); g.lineTo(8, -2); g.lineTo(11, 7); g.lineTo(5, 5); g.lineTo(0, 8); g.lineTo(-5, 5); g.lineTo(-11, 7); g.lineTo(-8, -2); }
    else if (kind === 'needle') { g.moveTo(0, -15); g.lineTo(3, -2); g.lineTo(9, 6); g.lineTo(3, 5); g.lineTo(2, 9); g.lineTo(-2, 9); g.lineTo(-3, 5); g.lineTo(-9, 6); g.lineTo(-3, -2); }
    else if (kind === 'saucer') { g.ellipse(0, 1, 11, 6, 0, 0, TAU); }
    else { g.moveTo(0, -13); g.lineTo(4, -4); g.lineTo(11, 6); g.lineTo(4, 4); g.lineTo(0, 7); g.lineTo(-4, 4); g.lineTo(-11, 6); g.lineTo(-4, -4); }
    g.closePath();
  }
  function drawShip(g, s, x, y, ang, bank, thrust, alpha = 1, scale = 1) {
    const kind = C.player.ship, t = V.time;
    g.save(); g.translate(x, y); g.rotate(ang + Math.PI / 2); g.scale(scale * (1 - Math.abs(bank) * 0.22), scale); g.globalAlpha = alpha;
    // Engine flame.
    const flick = 0.7 + 0.3 * Math.sin(t * 50) + (thrust ? 0.6 : 0);
    if (kind !== 'saucer' || thrust) {
      glow(g, 0, 10, 8 * flick, lighten(shipColor, 0.3), 0.8);
      g.fillStyle = rgba('#ffffff', 0.9); g.beginPath(); g.moveTo(-2.5, 7); g.lineTo(0, 7 + 7 * flick); g.lineTo(2.5, 7); g.fill();
    }
    glow(g, 0, 0, 20, shipColor, 0.35);
    shipPath(g, kind);
    const body = g.createLinearGradient(-10, 0, 10, 0);
    body.addColorStop(0, darken(shipColor, 0.55)); body.addColorStop(0.5 + bank * 0.3, lighten(shipColor, 0.15)); body.addColorStop(1, darken(shipColor, 0.55));
    g.fillStyle = pixel ? darken(shipColor, 0.3) : body; g.fill();
    g.lineWidth = pixel ? 1 : 1.4; g.strokeStyle = lighten(shipColor, 0.55); g.stroke();
    // Cockpit and trim.
    g.fillStyle = kind === 'saucer' ? rgba('#ffffff', 0.85) : '#e8fbff';
    g.beginPath(); if (kind === 'saucer') g.ellipse(0, -2, 5, 4, 0, Math.PI, TAU); else g.ellipse(0, -3, 2, 3.6, 0, 0, TAU); g.fill();
    g.fillStyle = accent; if (kind !== 'saucer') { g.fillRect(-8, 3, 2.5, 2); g.fillRect(5.5, 3, 2.5, 2); } else for (let i = 0; i < 5; i++) { const a = t * 3 + i / 5 * TAU; g.fillRect(Math.cos(a) * 8 - 1, 2 + Math.sin(a) * 2 - 1, 2, 2); }
    g.restore();
  }

  // ---------- enemies ----------
  function bitmap(g, rows, R, color) {
    const h = rows.length, w = rows[0].length, cell = (R * 2) / Math.max(w, h);
    g.fillStyle = color;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (rows[j][i] === 'X') g.fillRect((i - w / 2) * cell, (j - h / 2) * cell, cell + 0.15, cell + 0.15);
  }
  function enemyBody(g, shape, R, color, e, t, frame2) {
    const dark = darken(color, 0.45), lite = lighten(color, 0.45);
    g.lineWidth = pixel ? 1 : Math.max(1, R * 0.12); g.strokeStyle = lite; g.lineJoin = 'round';
    const flap = 0.55 + 0.45 * Math.abs(Math.sin(t * 9 + e.id));
    switch (shape) {
      case 'bug': {
        g.fillStyle = rgba(lite, 0.75);
        for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(sx * R * 0.6, -R * 0.15, R * 0.55, R * 0.32 * flap + 0.5, sx * 0.5, 0, TAU); g.fill(); }
        g.fillStyle = color; g.beginPath(); g.ellipse(0, 0, R * 0.42, R * 0.78, 0, 0, TAU); g.fill(); g.stroke();
        g.fillStyle = dark; for (const y of [-0.3, 0.05]) g.fillRect(-R * 0.4, y * R, R * 0.8, R * 0.14);
        g.fillStyle = lite; g.beginPath(); g.arc(0, R * 0.62, R * 0.3, 0, TAU); g.fill();
        g.fillStyle = '#ffffff'; g.fillRect(-R * 0.2, R * 0.62, R * 0.14, R * 0.14); g.fillRect(R * 0.06, R * 0.62, R * 0.14, R * 0.14);
        g.beginPath(); g.moveTo(-R * 0.15, R * 0.85); g.lineTo(-R * 0.35, R * 1.15); g.moveTo(R * 0.15, R * 0.85); g.lineTo(R * 0.35, R * 1.15); g.stroke();
        break;
      }
      case 'moth': {
        for (const sx of [-1, 1]) {
          g.save(); g.scale(sx * flap, 1);
          g.fillStyle = color; g.beginPath(); g.moveTo(R * 0.1, -R * 0.2); g.quadraticCurveTo(R * 1.25, -R * 1.05, R * 1.05, R * 0.05); g.quadraticCurveTo(R * 0.6, R * 0.1, R * 0.1, R * 0.1); g.fill(); g.stroke();
          g.fillStyle = dark; g.beginPath(); g.moveTo(R * 0.1, R * 0.15); g.quadraticCurveTo(R * 0.9, R * 0.3, R * 0.6, R * 0.85); g.quadraticCurveTo(R * 0.3, R * 0.6, R * 0.1, R * 0.4); g.fill(); g.stroke();
          g.fillStyle = lite; g.beginPath(); g.arc(R * 0.65, -R * 0.35, R * 0.16, 0, TAU); g.fill();
          g.restore();
        }
        g.fillStyle = lite; g.beginPath(); g.ellipse(0, R * 0.05, R * 0.16, R * 0.7, 0, 0, TAU); g.fill();
        break;
      }
      case 'crab': case 'squid': bitmap(g, BITMAPS[shape][frame2 ? 1 : 0], R * 1.1, color); break;
      case 'saucer': {
        g.fillStyle = rgba(lite, 0.6); g.beginPath(); g.ellipse(0, -R * 0.25, R * 0.5, R * 0.45, 0, Math.PI, TAU); g.fill();
        g.fillStyle = color; g.beginPath(); g.ellipse(0, 0, R * 1.15, R * 0.42, 0, 0, TAU); g.fill(); g.stroke();
        g.fillStyle = dark; g.fillRect(-R * 0.9, -R * 0.02, R * 1.8, R * 0.12);
        for (let i = 0; i < 6; i++) { const a = t * 4 + i / 6 * TAU, on = Math.sin(a) > 0; if (!on) continue; g.fillStyle = i % 2 ? '#ffffff' : accent; g.fillRect(Math.cos(a) * R * 0.85 - 1, R * 0.08 - 1, 2.2, 2.2); }
        break;
      }
      case 'diamond': {
        const pulse = 1 + 0.12 * Math.sin(t * 6 + e.id);
        g.save(); g.scale(pulse, 1 / pulse);
        g.beginPath(); g.moveTo(0, -R); g.lineTo(R, 0); g.lineTo(0, R); g.lineTo(-R, 0); g.closePath(); g.fillStyle = rgba(color, 0.25); g.fill(); g.strokeStyle = color; g.lineWidth = pixel ? 1 : R * 0.18; g.stroke();
        g.beginPath(); g.moveTo(0, -R * 0.45); g.lineTo(R * 0.45, 0); g.lineTo(0, R * 0.45); g.lineTo(-R * 0.45, 0); g.closePath(); g.strokeStyle = lite; g.lineWidth = pixel ? 1 : R * 0.1; g.stroke();
        g.restore();
        break;
      }
      case 'pinwheel': {
        g.save(); g.rotate(e.spin || t * 4);
        for (let k = 0; k < 4; k++) { g.rotate(TAU / 4); g.beginPath(); g.moveTo(0, 0); g.lineTo(R, -R * 0.15); g.lineTo(R * 0.15, -R); g.closePath(); g.fillStyle = k % 2 ? color : rgba(color, 0.4); g.fill(); g.strokeStyle = lite; g.stroke(); }
        g.restore();
        break;
      }
      case 'fighter': {
        g.beginPath(); g.moveTo(0, R * 1.1); g.lineTo(R * 0.3, R * 0.2); g.lineTo(R * 1.1, -R * 0.35); g.lineTo(R * 1.0, -R * 0.65); g.lineTo(R * 0.25, -R * 0.45); g.lineTo(R * 0.35, -R * 0.95); g.lineTo(-R * 0.35, -R * 0.95); g.lineTo(-R * 0.25, -R * 0.45); g.lineTo(-R, -R * 0.65); g.lineTo(-R * 1.1, -R * 0.35); g.lineTo(-R * 0.3, R * 0.2); g.closePath();
        g.fillStyle = color; g.fill(); g.stroke();
        g.fillStyle = dark; g.beginPath(); g.ellipse(0, R * 0.25, R * 0.16, R * 0.35, 0, 0, TAU); g.fill();
        glow(g, 0, -R * 1.05, R * 0.7 * flap, '#ffb060', 0.8);
        break;
      }
      case 'orb': {
        const pulse = 1 + 0.08 * Math.sin(t * 5 + e.id);
        g.fillStyle = dark; g.beginPath(); g.arc(0, 0, R * 0.95 * pulse, 0, TAU); g.fill();
        const grd = pixel ? lite : (() => { const q = g.createRadialGradient(-R * 0.25, -R * 0.25, 0, 0, 0, R * 0.8); q.addColorStop(0, '#ffffff'); q.addColorStop(0.35, lite); q.addColorStop(1, color); return q; })();
        g.fillStyle = grd; g.beginPath(); g.arc(0, 0, R * 0.62 * pulse, 0, TAU); g.fill();
        g.strokeStyle = lite; g.lineWidth = pixel ? 1 : R * 0.14;
        for (let k = 0; k < 3; k++) { const a = t * 2.4 + k / 3 * TAU; g.beginPath(); g.arc(0, 0, R * 0.95, a, a + 1.2); g.stroke(); }
        break;
      }
      case 'drone': default: {
        g.save(); g.rotate(-(e.face - Math.PI / 2));
        g.beginPath(); for (let k = 0; k < 6; k++) { const a = k / 6 * TAU + Math.PI / 6; g.lineTo(Math.cos(a) * R, Math.sin(a) * R); } g.closePath();
        g.fillStyle = dark; g.fill(); g.stroke();
        g.fillStyle = color; g.beginPath(); g.arc(0, 0, R * 0.55, 0, TAU); g.fill();
        g.restore();
        g.fillStyle = lite; g.fillRect(-R * 0.16, 0, R * 0.32, R * 1.15);
        g.fillStyle = '#ffffff'; g.beginPath(); g.arc(0, 0, R * 0.2, 0, TAU); g.fill();
      }
    }
  }

  function rockVerts(seed, tier) {
    const key = `${seed}|${tier}`;
    let v = rockCache.get(key);
    if (!v) { const r = mulberry(seed + 1), n = 9 + tier * 2; v = Array.from({ length: n }, (_, i) => [i / n * TAU + (r() - 0.5) * 0.3, 0.72 + r() * 0.32]); v.craters = Array.from({ length: tier }, () => [(r() - 0.5) * 0.9, (r() - 0.5) * 0.9, 0.12 + r() * 0.12]); rockCache.set(key, v); }
    return v;
  }
  function drawRock(g, e) {
    const R = ROCK_R[e.tier] || e.r, v = rockVerts(e.seed, e.tier);
    g.save(); g.translate(e.x, e.y); g.rotate(e.face);
    g.beginPath(); v.forEach(([a, k], i) => { const x = Math.cos(a) * R * k, y = Math.sin(a) * R * k; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath();
    g.fillStyle = e.flash ? '#ffffff' : darken(rockColor, 0.45); g.fill();
    g.lineWidth = pixel ? 1 : 1.6; g.strokeStyle = lighten(rockColor, 0.35); g.stroke();
    g.strokeStyle = rgba(lighten(rockColor, 0.2), 0.5); g.lineWidth = 1;
    for (const [cx, cy, cr] of v.craters) { g.beginPath(); g.arc(cx * R, cy * R, cr * R, 0, TAU); g.stroke(); }
    g.restore();
  }

  function drawGravity(g, e, color) {
    const R = e.r, t = V.time;
    glow(g, e.x, e.y, R * 4, color, 0.35);
    g.save(); g.translate(e.x, e.y);
    for (let k = 0; k < 4; k++) {
      const f = ((t * 0.6 + k / 4) % 1), rr = R * (2.6 - f * 2);
      g.strokeStyle = rgba(lighten(color, 0.3), f * 0.6); g.lineWidth = pixel ? 1 : 1.5;
      g.beginPath(); g.arc(0, 0, rr, 0, TAU); g.stroke();
    }
    g.rotate(e.spin || t * 2);
    for (let k = 0; k < 3; k++) { g.rotate(TAU / 3); g.strokeStyle = rgba(color, 0.9); g.lineWidth = pixel ? 1 : R * 0.22; g.beginPath(); g.arc(0, 0, R * 0.85, 0, 1.6); g.stroke(); }
    g.fillStyle = '#05020c'; g.beginPath(); g.arc(0, 0, R * 0.6, 0, TAU); g.fill();
    g.strokeStyle = lighten(color, 0.5); g.lineWidth = 1; g.stroke();
    g.restore();
  }

  function drawEnemy(g, s, e) {
    if (e.mv === 'rock') return drawRock(g, e);
    const type = game.enemyType(e.type);
    const color = type?.color || '#ff5a7a', shape = type?.shape || 'bug';
    if (e.mv === 'gravity') { drawGravity(g, e, color); if (e.flash) glow(g, e.x, e.y, e.r * 1.5, '#ffffff', 0.8); return; }
    const t = V.time, R = e.r;
    const tr = V.trails.get(e.id);
    if (tr && tr.length > 4 && !pixel) {
      g.lineCap = 'round';
      for (let k = 2; k < tr.length; k += 2) { g.strokeStyle = rgba(color, (k / tr.length) * 0.35); g.lineWidth = R * 0.5 * (k / tr.length); g.beginPath(); g.moveTo(tr[k - 2], tr[k - 1]); g.lineTo(tr[k], tr[k + 1]); g.stroke(); }
    }
    if (e.segs) {
      for (let k = e.segs.length - 2; k >= 0; k -= 2) {
        const f = 1 - k / e.segs.length, rr = 4 + 4 * f;
        g.fillStyle = darken(color, 0.4 - f * 0.2); g.strokeStyle = lighten(color, 0.3); g.lineWidth = pixel ? 1 : 1.2;
        g.beginPath(); g.arc(e.segs[k], e.segs[k + 1], rr, 0, TAU); g.fill(); g.stroke();
        g.fillStyle = rgba(lighten(color, 0.5), 0.8); g.fillRect(e.segs[k] - 1, e.segs[k + 1] - 1, 2, 2);
      }
    }
    glow(g, e.x, e.y, R * 2.4, color, 0.3);
    g.save(); g.translate(e.x, e.y); g.rotate((e.face ?? Math.PI / 2) - Math.PI / 2);
    const frame2 = s.formation ? s.formation.frame : Math.floor(t * 3) % 2;
    const bob = e.st === 'formation' ? Math.sin(t * 3 + e.slot) * 0.6 : 0;
    g.translate(0, bob);
    enemyBody(g, shape, R, color, e, t, frame2);
    if (e.flash) { g.globalCompositeOperation = 'source-atop'; g.globalAlpha = 0.85; g.fillStyle = '#ffffff'; g.fillRect(-R * 1.6, -R * 1.6, R * 3.2, R * 3.2); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; }
    g.restore();
    if (e.flash) glow(g, e.x, e.y, R * 1.6, '#ffffff', 0.6);
    if (e.maxHp >= 4 && e.hp < e.maxHp && !e.mini) {
      g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(e.x - R, e.y - R - 5, R * 2, 2);
      g.fillStyle = color; g.fillRect(e.x - R, e.y - R - 5, R * 2 * Math.max(0, e.hp / e.maxHp), 2);
    }
  }

  // ---------- boss ----------
  function drawBoss(g, s) {
    const b = s.boss, def = game.bossType(b.type), color = def?.color || '#ff5ab0', t = V.time, R = b.r;
    const p = s.player, look = Math.atan2(p.y - b.y, p.x - b.x);
    const hurt = 1 - b.hp / b.maxHp, phaseCol = mix(color, '#ff2030', Math.min(0.6, b.phase * 0.25));
    const jitter = b.st === 'dying' ? (V.r() - 0.5) * 3 : 0;
    glow(g, b.x, b.y, R * 3.2, phaseCol, 0.35 + 0.15 * Math.sin(t * 4));
    g.save(); g.translate(b.x + jitter, b.y);
    const dark = darken(phaseCol, 0.55), lite = lighten(phaseCol, 0.4);
    g.lineWidth = pixel ? 1 : 2; g.strokeStyle = lite; g.lineJoin = 'round';
    switch (def?.shape) {
      case 'hive': {
        g.save(); g.rotate(t * 0.6);
        for (let k = 0; k < 6; k++) {
          const a = k / 6 * TAU, x = Math.cos(a) * R * 0.95, y = Math.sin(a) * R * 0.95;
          g.beginPath(); for (let q = 0; q < 6; q++) { const aa = q / 6 * TAU; g.lineTo(x + Math.cos(aa) * R * 0.36, y + Math.sin(aa) * R * 0.36); } g.closePath();
          g.fillStyle = k % 2 ? phaseCol : dark; g.fill(); g.stroke();
        }
        g.restore();
        g.beginPath(); for (let q = 0; q < 6; q++) { const aa = q / 6 * TAU + Math.PI / 6; g.lineTo(Math.cos(aa) * R * 0.62, Math.sin(aa) * R * 0.62); } g.closePath();
        g.fillStyle = dark; g.fill(); g.stroke();
        const pulse = 0.3 + 0.08 * Math.sin(t * 6);
        g.fillStyle = lite; g.beginPath(); g.arc(0, 0, R * pulse, 0, TAU); g.fill();
        glow(g, 0, 0, R * 0.7, '#ffffff', 0.5);
        break;
      }
      case 'eye': {
        for (let k = 0; k < 10; k++) {
          const a = k / 10 * TAU + Math.sin(t * 2 + k) * 0.08, l = R * (1.35 + 0.12 * Math.sin(t * 3 + k * 1.7));
          g.strokeStyle = dark; g.lineWidth = pixel ? 2 : 5; g.beginPath(); g.moveTo(Math.cos(a) * R * 0.8, Math.sin(a) * R * 0.8); g.lineTo(Math.cos(a) * l, Math.sin(a) * l); g.stroke();
        }
        g.fillStyle = '#f4ecf0'; g.beginPath(); g.arc(0, 0, R * 0.92, 0, TAU); g.fill(); g.strokeStyle = lite; g.lineWidth = pixel ? 1 : 2.5; g.stroke();
        g.strokeStyle = rgba('#ff3040', 0.5 + hurt * 0.5); g.lineWidth = 1;
        for (let k = 0; k < 6; k++) { const a = k / 6 * TAU + 0.3; g.beginPath(); g.moveTo(Math.cos(a) * R * 0.9, Math.sin(a) * R * 0.9); g.quadraticCurveTo(Math.cos(a + 0.3) * R * 0.6, Math.sin(a + 0.3) * R * 0.6, Math.cos(a + 0.1) * R * 0.45, Math.sin(a + 0.1) * R * 0.45); g.stroke(); }
        const ix = Math.cos(look) * R * 0.35, iy = Math.sin(look) * R * 0.35;
        g.fillStyle = phaseCol; g.beginPath(); g.arc(ix, iy, R * 0.45, 0, TAU); g.fill();
        g.fillStyle = '#100008'; g.beginPath(); g.ellipse(ix, iy, R * 0.12, R * 0.32, look + Math.PI / 2, 0, TAU); g.fill();
        g.fillStyle = '#ffffff'; g.beginPath(); g.arc(ix - R * 0.15, iy - R * 0.15, R * 0.08, 0, TAU); g.fill();
        const lid = 0.12 + 0.88 * Math.max(0, Math.sin(t * 0.7) > 0.97 ? 1 : 0);
        if (lid > 0.5) { g.fillStyle = dark; g.fillRect(-R, -R, R * 2, R * 0.9); }
        break;
      }
      case 'dreadnought': {
        g.beginPath(); g.moveTo(0, R * 1.05); g.lineTo(R * 0.55, R * 0.7); g.lineTo(R * 1.35, R * 0.1); g.lineTo(R * 1.35, -R * 0.45); g.lineTo(R * 0.8, -R * 0.85); g.lineTo(-R * 0.8, -R * 0.85); g.lineTo(-R * 1.35, -R * 0.45); g.lineTo(-R * 1.35, R * 0.1); g.lineTo(-R * 0.55, R * 0.7); g.closePath();
        g.fillStyle = dark; g.fill(); g.stroke();
        g.fillStyle = phaseCol; g.fillRect(-R * 0.35, -R * 0.75, R * 0.7, R * 1.2);
        g.fillStyle = '#20141a'; for (let k = -2; k <= 2; k++) g.fillRect(k * R * 0.28 - R * 0.06, -R * 0.82, R * 0.12, R * 0.08);
        for (const x of [-0.95, 0.95]) glow(g, x * R, -R * 0.85, R * 0.4 * (0.8 + 0.2 * Math.sin(t * 30)), '#ffb060', 0.9);
        for (const [x, y] of [[-0.85, 0], [0.85, 0], [0, 0.55]]) {
          g.save(); g.translate(x * R, y * R); g.rotate(Math.atan2(p.y - (b.y + y * R), p.x - (b.x + x * R)) - Math.PI / 2);
          g.fillStyle = lite; g.fillRect(-R * 0.06, 0, R * 0.12, R * 0.38);
          g.fillStyle = phaseCol; g.beginPath(); g.arc(0, 0, R * 0.17, 0, TAU); g.fill(); g.stroke();
          g.restore();
        }
        g.strokeStyle = rgba('#ffd040', 0.6); g.lineWidth = 1.5; g.setLineDash?.([3, 3]); g.beginPath(); g.moveTo(-R * 1.2, -R * 0.2); g.lineTo(R * 1.2, -R * 0.2); g.stroke(); g.setLineDash?.([]);
        break;
      }
      case 'mothership': default: {
        g.fillStyle = rgba(lighten(phaseCol, 0.6), 0.5); g.beginPath(); g.ellipse(0, -R * 0.25, R * 0.55, R * 0.5, 0, Math.PI, TAU); g.fill(); g.stroke();
        for (const sx of [-1, 1]) { g.fillStyle = dark; g.beginPath(); g.ellipse(sx * R * 1.25, R * 0.15, R * 0.28, R * 0.42, 0, 0, TAU); g.fill(); g.stroke(); glow(g, sx * R * 1.25, R * 0.5, R * 0.3, '#ffffff', 0.6); }
        g.fillStyle = phaseCol; g.beginPath(); g.ellipse(0, 0, R * 1.45, R * 0.45, 0, 0, TAU); g.fill(); g.stroke();
        g.fillStyle = dark; g.fillRect(-R * 1.2, -R * 0.02, R * 2.4, R * 0.1);
        for (let k = 0; k < 12; k++) { const a = t * 2 + k / 12 * TAU; if (Math.sin(a) < 0) continue; g.fillStyle = k % 3 ? '#ffffff' : accent; g.fillRect(Math.cos(a) * R * 1.2 - 1.5, R * 0.12 - 1.5, 3, 3); }
        glow(g, 0, R * 0.45, R * (0.5 + 0.1 * Math.sin(t * 7)), phaseCol, 0.9);
      }
    }
    // Damage cracks and phase-change flash.
    if (hurt > 0.33) { g.strokeStyle = rgba('#ffe0a0', 0.4 + 0.3 * Math.sin(t * 12)); g.lineWidth = 1; g.beginPath(); g.moveTo(-R * 0.6, -R * 0.2); g.lineTo(-R * 0.3, 0); g.lineTo(-R * 0.4, R * 0.25); if (hurt > 0.66) { g.moveTo(R * 0.5, -R * 0.3); g.lineTo(R * 0.2, -R * 0.05); g.lineTo(R * 0.35, R * 0.2); } g.stroke(); }
    if (b.flash || b.invuln > 0 && b.invuln % 6 < 3) glow(g, 0, 0, R * 1.6, '#ffffff', b.flash ? 0.7 : 0.35);
    g.restore();
    if (b.st === 'enter' || b.invuln > 0) { g.strokeStyle = rgba('#a0c8ff', 0.35 + 0.2 * Math.sin(t * 10)); g.lineWidth = pixel ? 1 : 1.5; g.beginPath(); g.arc(b.x, b.y, R * 1.5, 0, TAU); g.stroke(); }
  }

  // ---------- bullets, pickups, bunkers ----------
  function drawPlayerBullets(g, s) {
    for (const b of s.pbullets) {
      const v = Math.hypot(b.vx, b.vy) || 1, ux = b.vx / v, uy = b.vy / v;
      if (b.k === 'laser') {
        const len = 22;
        glow(g, b.x - ux * len / 2, b.y - uy * len / 2, b.r * 5, '#8ff0ff', 0.6);
        g.strokeStyle = rgba('#8ff0ff', 0.9); g.lineWidth = b.r * 1.6; g.lineCap = pixel ? 'butt' : 'round';
        g.beginPath(); g.moveTo(b.x, b.y); g.lineTo(b.x - ux * len, b.y - uy * len); g.stroke();
        g.strokeStyle = '#ffffff'; g.lineWidth = b.r * 0.6; g.stroke();
      } else if (b.k === 'missile') {
        glow(g, b.x, b.y, 8, '#7dff6a', 0.7);
        g.save(); g.translate(b.x, b.y); g.rotate(Math.atan2(uy, ux));
        g.fillStyle = '#d8ffd0'; g.fillRect(-4, -1.5, 7, 3); g.fillStyle = '#7dff6a'; g.fillRect(-5, -2.5, 2, 5);
        g.restore();
      } else {
        const c = b.k === 'spread' ? '#ffcf5a' : lighten(shipColor, 0.3), len = pixel ? 5 : 9;
        glow(g, b.x, b.y, 7, c, 0.55);
        g.strokeStyle = c; g.lineWidth = pixel ? 2 : 2.4; g.lineCap = pixel ? 'butt' : 'round';
        g.beginPath(); g.moveTo(b.x, b.y); g.lineTo(b.x - ux * len, b.y - uy * len); g.stroke();
        g.fillStyle = '#ffffff'; g.fillRect(b.x - 1, b.y - 1, 2, 2);
      }
    }
  }
  function drawEnemyBullets(g, s) {
    for (const b of s.ebullets) {
      const c = b.boss ? BBULLET : EBULLET, pulse = 1 + 0.15 * Math.sin(V.time * 20 + b.x);
      glow(g, b.x, b.y, b.r * 3.2 * pulse, c, 0.75);
      if (b.k === 'needle' || b.k === 'arrow') {
        const v = Math.hypot(b.vx, b.vy) || 1, ux = b.vx / v, uy = b.vy / v;
        g.strokeStyle = c; g.lineWidth = b.r * 1.5; g.lineCap = pixel ? 'butt' : 'round';
        g.beginPath(); g.moveTo(b.x + ux * b.r, b.y + uy * b.r); g.lineTo(b.x - ux * b.r * 2.2, b.y - uy * b.r * 2.2); g.stroke();
        g.strokeStyle = '#ffffff'; g.lineWidth = b.r * 0.6; g.stroke();
      } else {
        g.fillStyle = c; g.beginPath(); g.arc(b.x, b.y, b.r, 0, TAU); g.fill();
        g.fillStyle = '#ffffff'; g.beginPath(); g.arc(b.x, b.y, b.r * 0.55, 0, TAU); g.fill();
      }
    }
  }
  function drawPickups(g, s) {
    for (const u of s.pickups) {
      const look = PICKUP_LOOK[u.kind] || PICKUP_LOOK.spread, t = V.time, bob = Math.sin(t * 5 + u.id) * 1.5;
      const fade = s.mode === 'twinstick' || s.mode === 'asteroids' ? (u.t > 480 && u.t % 10 < 5 ? 0.3 : 1) : 1;
      g.globalAlpha = fade;
      glow(g, u.x, u.y + bob, 16, look.c, 0.6);
      g.save(); g.translate(u.x, u.y + bob);
      g.rotate(Math.sin(t * 2 + u.id) * 0.25);
      g.beginPath(); for (let k = 0; k < 6; k++) { const a = k / 6 * TAU + Math.PI / 6; g.lineTo(Math.cos(a) * 8, Math.sin(a) * 8); } g.closePath();
      g.fillStyle = darken(look.c, 0.6); g.fill(); g.strokeStyle = look.c; g.lineWidth = pixel ? 1 : 1.6; g.stroke();
      g.strokeStyle = rgba('#ffffff', 0.6); g.lineWidth = 1; g.beginPath(); g.arc(0, 0, 10 + Math.sin(t * 6) * 1, t * 3, t * 3 + 2); g.stroke();
      g.fillStyle = '#ffffff'; g.font = `800 ${look.t.length > 1 ? 6 : 9}px ${font}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(look.t, 0, 0.5);
      g.restore(); g.globalAlpha = 1;
    }
  }
  function drawBunkers(g, s) {
    for (const k of s.bunkers) {
      g.fillStyle = '#5fe08a';
      for (let r = 0; r < k.rows; r++) for (let c = 0; c < k.cols; c++) if (k.cells[r * k.cols + c]) g.fillRect(k.x + c * k.cell, k.y + r * k.cell, k.cell, k.cell);
      glow(g, k.x + k.cols * k.cell / 2, k.y + k.rows * k.cell / 2, 26, '#5fe08a', 0.12);
    }
  }
  function drawWarns(g, s) {
    for (const w of s.warns) {
      const f = 1 - w.t / w.total, color = colorOfType(w.type), r = 18 * (1 - f) + 6;
      g.strokeStyle = rgba(color, 0.4 + 0.5 * f); g.lineWidth = pixel ? 1 : 1.5;
      g.beginPath(); g.arc(w.x, w.y, r, 0, TAU); g.stroke();
      g.save(); g.translate(w.x, w.y); g.rotate(f * 4);
      for (let k = 0; k < 4; k++) { g.rotate(TAU / 4); g.beginPath(); g.moveTo(r + 2, 0); g.lineTo(r + 7, 0); g.stroke(); }
      g.restore();
      glow(g, w.x, w.y, 14 * f, color, 0.6);
    }
  }

  function drawPlayer(g, s) {
    const p = s.player;
    if (!p.alive) return;
    const blink = p.invuln > 0 && Math.floor(p.invuln / 4) % 2 === 0 ? 0.35 : 1;
    const bank = s.mode === 'asteroids' ? 0 : Math.max(-1, Math.min(1, p.vx / (C.player.speed || 1)));
    const at = (x, y) => {
      drawShip(g, s, x, y, p.ang, bank, s.mode === 'asteroids' ? p.thrust : p.vy < 0, blink);
      if (p.shield) {
        const t = V.time;
        g.strokeStyle = rgba('#9ac0ff', 0.55 + 0.25 * Math.sin(t * 8)); g.lineWidth = pixel ? 1 : 1.5;
        g.beginPath(); for (let k = 0; k <= 6; k++) { const a = k / 6 * TAU + t; g.lineTo(x + Math.cos(a) * 17, y + Math.sin(a) * 17); } g.stroke();
        glow(g, x, y, 24, '#7aa8ff', 0.25);
      }
    };
    at(p.x, p.y);
    if (s.mode === 'asteroids') { // wrap ghosts at the edges
      if (p.x < 16) at(p.x + s.W, p.y); else if (p.x > s.W - 16) at(p.x - s.W, p.y);
      if (p.y < 16) at(p.x, p.y + s.H); else if (p.y > s.H - 16) at(p.x, p.y - s.H);
    }
    if (s.mode === 'twinstick') { g.strokeStyle = rgba(shipColor, 0.35); g.lineWidth = 1; g.setLineDash?.([2, 4]); g.beginPath(); g.moveTo(p.x + Math.cos(p.ang) * 16, p.y + Math.sin(p.ang) * 16); g.lineTo(p.x + Math.cos(p.ang) * 46, p.y + Math.sin(p.ang) * 46); g.stroke(); g.setLineDash?.([]); }
    if (s.mode === 'vertical' || s.mode === 'fixed') { g.fillStyle = '#ffffff'; g.beginPath(); g.arc(p.x, p.y, 1.6, 0, TAU); g.fill(); }
    if (p.pulled) { g.strokeStyle = rgba('#c8a0ff', 0.5); g.lineWidth = 1; g.beginPath(); g.arc(p.x, p.y, 13 + Math.sin(V.time * 20) * 2, 0, TAU); g.stroke(); }
  }

  function drawParticles(g) {
    const prev = g.globalCompositeOperation;
    for (const p of V.particles) {
      const f = p.life / p.max;
      if (p.kind === 'smoke') { g.globalCompositeOperation = 'source-over'; g.globalAlpha = f * 0.35; g.fillStyle = p.color; g.beginPath(); g.arc(p.x, p.y, p.size, 0, TAU); g.fill(); continue; }
      g.globalCompositeOperation = 'lighter'; g.globalAlpha = Math.min(1, f * 1.4);
      if (p.kind === 'flash') { g.globalAlpha = f; glow(g, p.x, p.y, p.size * (1.5 - f * 0.5), p.color, 1); continue; }
      g.fillStyle = p.color;
      if (p.kind === 'debris') { g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.fillRect(-p.size, -p.size * 0.4, p.size * 2, p.size * 0.8); g.restore(); }
      else if (p.kind === 'star') { g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.fillRect(-p.size, -0.5, p.size * 2, 1); g.fillRect(-0.5, -p.size, 1, p.size * 2); g.restore(); }
      else if (pixel) g.fillRect(Math.round(p.x), Math.round(p.y), Math.max(1, Math.round(p.size)), Math.max(1, Math.round(p.size)));
      else { g.strokeStyle = p.color; g.lineWidth = p.size; g.lineCap = 'round'; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); g.stroke(); }
    }
    g.globalAlpha = 1;
    for (const r of V.rings) {
      const f = 1 - r.life / r.max, rad = r.r0 + (r.r1 - r.r0) * ease(f);
      g.globalCompositeOperation = 'lighter'; g.globalAlpha = (1 - f) * 0.9; g.strokeStyle = r.color; g.lineWidth = Math.max(pixel ? 1 : 0.5, r.width * (1 - f * 0.6));
      g.beginPath(); g.arc(r.x, r.y, Math.max(0.1, rad), 0, TAU); g.stroke();
    }
    g.globalCompositeOperation = prev; g.globalAlpha = 1;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const p of V.popups) {
      const f = p.life / p.max;
      g.globalAlpha = Math.min(1, f * 2.5);
      g.font = `800 ${p.size}px ${font}`;
      g.fillStyle = 'rgba(0,0,0,.6)'; g.fillText(p.text, p.x + 0.8, p.y + 0.8);
      g.fillStyle = p.color; g.fillText(p.text, p.x, p.y);
    }
    g.globalAlpha = 1;
  }

  function drawWorld(g, s) {
    drawField(g, s);
    drawBunkers(g, s);
    drawPickups(g, s);
    drawWarns(g, s);
    for (const e of s.enemies) drawEnemy(g, s, e);
    if (s.boss) drawBoss(g, s);
    drawPlayerBullets(g, s);
    drawPlayer(g, s);
    drawEnemyBullets(g, s);
    drawParticles(g);
    if (s.phase === 'warn') { g.fillStyle = rgba('#ff1030', 0.08 + 0.08 * Math.sin(V.time * 10)); g.fillRect(0, 0, s.W, s.H); }
    if (V.phaseFlash > 0) { g.fillStyle = rgba('#ffffff', V.phaseFlash * 0.25); g.fillRect(0, 0, s.W, s.H); }
  }

  // ---------- HUD & banners (CSS pixels over the playfield) ----------
  function text(ctx, str, x, y, size, color, align = 'left', weight = 800, shadow = true) {
    ctx.font = `${weight} ${size}px ${font}`; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
    if (shadow) { ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillText(str, x + Math.max(1, size * 0.08), y + Math.max(1, size * 0.08)); }
    ctx.fillStyle = color; ctx.fillText(str, x, y);
  }
  function miniShip(ctx, x, y, size, alpha = 1) {
    ctx.save(); ctx.translate(x, y); ctx.scale(size / 26, size / 26); ctx.globalAlpha = alpha;
    shipPath(ctx, C.player.ship); ctx.fillStyle = darken(shipColor, 0.25); ctx.fill(); ctx.strokeStyle = lighten(shipColor, 0.5); ctx.lineWidth = 1.6; ctx.stroke();
    ctx.restore();
  }

  function drawHud(ctx, s, ox, oy, pw, ph, sc, cw, ch, frame) {
    const u = Math.max(9, Math.min(17, pw / 26)), pad = u * 0.7, t = V.time;
    // Top strip.
    const strip = ctx.createLinearGradient(0, oy, 0, oy + u * 3.6);
    strip.addColorStop(0, 'rgba(0,0,0,.6)'); strip.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = strip; ctx.fillRect(ox, oy, pw, u * 3.6);
    text(ctx, 'SCORE', ox + pad, oy + u * 1.2, u * 0.62, rgba('#ffffff', 0.65));
    text(ctx, String(Math.round(V.scoreShown)).padStart(7, '0'), ox + pad, oy + u * 2.35, u * 1.05, '#ffffff');
    const hi = Math.max(s.best || 0, s.score);
    text(ctx, 'HI', ox + pw / 2, oy + u * 1.2, u * 0.62, rgba(accent, 0.85), 'center');
    text(ctx, String(hi).padStart(7, '0'), ox + pw / 2, oy + u * 2.35, u * 0.95, accent, 'center');
    text(ctx, `STAGE ${s.stage + 1}${s.loop ? `-${s.loop + 1}` : ''}`, ox + pw - pad, oy + u * 1.2, u * 0.62, rgba('#ffffff', 0.65), 'right');
    text(ctx, (C.stages[s.stage]?.name || '').toUpperCase().slice(0, 22), ox + pw - pad, oy + u * 2.3, u * 0.7, '#ffffff', 'right');
    // Chain multiplier.
    if (s.chain > 1) {
      const m = Math.min(8, 1 + Math.floor(s.chain / 6)), pop = 1 + Math.max(0, 0.3 - (100 - s.chainT) / 60);
      text(ctx, `x${m}`, ox + pad, oy + u * 3.9, u * 1.1 * pop, m > 1 ? accent : '#ffffff');
      text(ctx, `CHAIN ${s.chain}`, ox + pad + u * 2.4, oy + u * 3.75, u * 0.6, rgba('#ffffff', 0.8));
      ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(ox + pad + u * 2.4, oy + u * 4.0, u * 5, u * 0.22);
      ctx.fillStyle = accent; ctx.fillRect(ox + pad + u * 2.4, oy + u * 4.0, u * 5 * s.chainT / 100, u * 0.22);
    }
    // Boss bar.
    const b = s.boss;
    V.bossShown += ((b && b.st !== 'escape' ? 1 : 0) - V.bossShown) * Math.min(1, (frame.dt || 0.016) * 6);
    if (b && V.bossShown > 0.02) {
      const def = game.bossType(b.type), bw = pw * 0.72, bx = ox + (pw - bw) / 2, by = oy + u * 4.6, bh = u * 0.55;
      ctx.globalAlpha = V.bossShown;
      text(ctx, (def?.name || 'BOSS').toUpperCase(), bx, by - u * 0.3, u * 0.7, '#ffffff');
      if (b.st === 'fight' && b.fightT > 60 * 60) text(ctx, `${Math.max(0, Math.ceil((80 * 60 - b.fightT) / 60))}s`, bx + bw, by - u * 0.3, u * 0.7, '#ff6080', 'right');
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
      const f = b.hp / b.maxHp;
      const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0); grad.addColorStop(0, '#ff3050'); grad.addColorStop(1, def?.color || '#ffb02a');
      ctx.fillStyle = grad; ctx.fillRect(bx, by, bw * f, bh);
      if (b.flash) { ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fillRect(bx, by, bw * f, bh); }
      ctx.fillStyle = 'rgba(0,0,0,.7)';
      for (let k = 1; k < (def?.phases.length || 1); k++) ctx.fillRect(bx + bw * (1 - k / def.phases.length) - 1, by - 1, 2, bh + 2);
      ctx.globalAlpha = 1;
    }
    // Bottom: lives, bombs, weapon.
    const by2 = oy + ph - pad;
    const lives = Math.max(0, s.lives - (s.player.alive ? 1 : 0));
    for (let k = 0; k < Math.min(lives, 6); k++) miniShip(ctx, ox + pad + u * 0.6 + k * u * 1.35, by2 - u * 0.55, u * 1.1);
    if (lives > 6) text(ctx, `x${lives}`, ox + pad + u * 8.4, by2 - u * 0.15, u * 0.7, '#ffffff');
    for (let k = 0; k < s.bombs; k++) {
      const x = ox + pad + u * 0.55 + k * u * 1.2, y = by2 - u * 1.85;
      ctx.fillStyle = '#ff4d6d'; ctx.beginPath(); ctx.arc(x, y, u * 0.42, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.font = `800 ${u * 0.5}px ${font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('B', x, y + 0.5);
    }
    const w = s.weapon, look = PICKUP_LOOK[w.kind] || { c: shipColor };
    text(ctx, `${WEAPON_NAME[w.kind]} ${ROMAN[w.tier]}`, ox + pw - pad, by2 - u * 0.2, u * 0.75, look.c, 'right');
    for (let k = 0; k < 3; k++) { ctx.fillStyle = k < w.tier ? look.c : 'rgba(255,255,255,.2)'; ctx.fillRect(ox + pw - pad - (3 - k) * u * 0.75, by2 - u * 1.45, u * 0.6, u * 0.3); }
    if (s.player.shield) text(ctx, 'SHIELD', ox + pw - pad, by2 - u * 1.9, u * 0.6, '#9ac0ff', 'right');
    // Side panel: pilot portrait when there is room.
    const side = ox;
    if (side > u * 9) {
      const portrait = img(art.frames?.player?.[s.player.alive ? 'idle' : 'hurt'] || art.sprites?.player);
      const cx = side / 2, pw2 = Math.min(side * 0.7, u * 9);
      if (portrait) { ctx.imageSmoothingEnabled = !pixel; const bob = frame.reducedMotion ? 0 : Math.sin(t * 2) * 2; ctx.drawImage(portrait, cx - pw2 / 2, oy + ph * 0.3 + bob, pw2, pw2); }
      else miniShip(ctx, cx, oy + ph * 0.3 + pw2 / 2, pw2 * 0.8);
      text(ctx, C.player.name.toUpperCase(), cx, oy + ph * 0.3 + pw2 + u * 1.4, u * 0.8, '#ffffff', 'center');
      text(ctx, MODE_LABEL[s.mode], cx, oy + ph * 0.3 + pw2 + u * 2.6, u * 0.6, accent, 'center');
      const foe = img(art.frames?.enemy?.idle || art.sprites?.enemy);
      if (foe && cw - ox - pw > u * 9) { ctx.save(); ctx.translate(ox + pw + side / 2, 0); ctx.scale(-1, 1); ctx.globalAlpha = 0.8; ctx.drawImage(foe, -pw2 / 2, oy + ph * 0.3, pw2, pw2); ctx.restore(); ctx.globalAlpha = 1;
        text(ctx, (b ? game.bossType(b.type)?.name : game.enemyType(C.stages[s.stage]?.waves[0]?.enemy)?.name || 'THE SWARM').toUpperCase(), ox + pw + side / 2, oy + ph * 0.3 + pw2 + u * 1.4, u * 0.7, '#ff7a90', 'center'); }
    }
    drawBanners(ctx, s, ox, oy, pw, ph, u, frame);
    // Frame.
    ctx.strokeStyle = rgba(shipColor, 0.35); ctx.lineWidth = 1; ctx.strokeRect(ox + 0.5, oy + 0.5, pw - 1, ph - 1);
  }

  function drawBanners(ctx, s, ox, oy, pw, ph, u, frame) {
    const cx = ox + pw / 2, cy = oy + ph * 0.42, t = V.time, st = C.stages[s.stage];
    if (frame.attract) { ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(ox, oy, pw, ph); return; }
    if (s.phase === 'intro' && s.status === 'playing') {
      const f = s.phaseT / 150, inT = ease(f * 3), out = f > 0.85 ? (f - 0.85) / 0.15 : 0;
      ctx.globalAlpha = 1 - out;
      ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(ox, cy - u * 3.4, pw, u * 6.8);
      ctx.fillStyle = accent; ctx.fillRect(ox, cy - u * 3.4, pw * inT, 2); ctx.fillRect(ox + pw * (1 - inT), cy + u * 3.4 - 2, pw * inT, 2);
      text(ctx, MODE_LABEL[s.mode], cx, cy - u * 2, u * 0.7, accent, 'center');
      text(ctx, `STAGE ${s.stage + 1}`, cx - (1 - inT) * pw, cy, u * 2.2, '#ffffff', 'center');
      text(ctx, (st?.name || '').toUpperCase(), cx + (1 - inT) * pw, cy + u * 1.4, u * 0.95, lighten(shipColor, 0.3), 'center');
      const line = st?.intro || '', n = Math.floor(Math.max(0, f - 0.2) * 1.6 * line.length);
      text(ctx, line.slice(0, n), cx, cy + u * 2.6, u * 0.62, rgba('#ffffff', 0.85), 'center', 600);
      if (f > 0.55) text(ctx, MODE_HINT[s.mode], cx, oy + ph * 0.78, u * 0.58, rgba('#ffffff', 0.75), 'center', 600);
      if (f > 0.6 && Math.floor(t * 4) % 2 === 0) text(ctx, 'READY', cx, oy + ph * 0.7, u * 1.1, accent, 'center');
      ctx.globalAlpha = 1;
    } else if (s.phase === 'warn') {
      const f = s.phaseT / 150, def = game.bossType(st?.boss), h = u * 1.4, off = (t * 80) % (h * 2);
      ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, pw, ph); ctx.clip();
      for (const y of [cy - u * 3.2, cy + u * 3.2 - h]) {
        ctx.fillStyle = 'rgba(40,0,8,.8)'; ctx.fillRect(ox, y, pw, h);
        ctx.fillStyle = '#ff2040';
        for (let x = ox - h * 2 + (y < cy ? off : -off); x < ox + pw + h; x += h * 2) { ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x + h, y); ctx.lineTo(x + h * 1.7, y); ctx.lineTo(x + h * 0.7, y + h); ctx.fill(); }
      }
      ctx.restore();
      if (Math.floor(t * 5) % 2 === 0 || f > 0.8) text(ctx, 'WARNING', cx, cy + u * 0.4, u * 2.4, '#ff3050', 'center');
      text(ctx, `${(def?.name || 'BOSS').toUpperCase()} APPROACHING`, cx, cy + u * 1.8, u * 0.75, '#ffffff', 'center');
    } else if (s.phase === 'clear' && s.clear) {
      const f = s.phaseT / 200, k = s.clear, a = Math.min(1, f * 6) * (f > 0.9 ? (1 - f) / 0.1 : 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(ox + pw * 0.08, cy - u * 4, pw * 0.84, u * 8.4);
      ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.strokeRect(ox + pw * 0.08, cy - u * 4, pw * 0.84, u * 8.4);
      text(ctx, 'STAGE CLEAR', cx, cy - u * 2.2, u * 1.6, '#ffffff', 'center');
      const rows = [['KILLS', `${k.kills} / ${k.spawned}`], ['ACCURACY', `${k.accuracy}%`], ['NO-MISS', k.perfect ? '5000' : '-'], ['BONUS', String(Math.round(k.bonus * Math.min(1, f * 2.5)))]];
      rows.forEach(([l, v], i) => {
        if (f < 0.12 + i * 0.08) return;
        text(ctx, l, ox + pw * 0.16, cy - u * 0.5 + i * u * 1.2, u * 0.7, rgba('#ffffff', 0.75));
        text(ctx, v, ox + pw * 0.84, cy - u * 0.5 + i * u * 1.2, u * 0.8, i === 3 ? accent : '#ffffff', 'right');
      });
      ctx.globalAlpha = 1;
    }
    if (!s.player.alive && s.status === 'playing' && s.player.respawn < 40) text(ctx, 'READY', cx, oy + ph * 0.6, u * 1.1, accent, 'center');
    if (V.toast) { const a = Math.min(1, (2 - V.toast.t) * 2); ctx.globalAlpha = a; text(ctx, V.toast.text, cx, oy + ph * 0.28 - V.toast.t * u, u * 1.1, '#ffffff', 'center'); ctx.globalAlpha = 1; }
  }

  // ---------- frame ----------
  const render = function render(ctx, s, frame = {}) {
    if (!s || !s.player) { render.view = null; return; }
    if (V.ref !== s) reset(s);
    const reduced = !!frame.reducedMotion, dt = frame.paused ? 0 : Math.min(0.05, frame.dt || 1 / 60);
    V.time += dt;
    if (s.stage !== V.lastStage) { V.particles = []; V.rings = []; V.popups = []; V.warps = []; V.trails.clear(); V.lastStage = s.stage; }
    if (frame.events?.length) onEvents(s, frame.events, reduced);
    stepFx(dt, s);
    const cw = frame.cssWidth || ctx.canvas?.width || 640, ch = frame.cssHeight || ctx.canvas?.height || 480;
    const W = s.W, H = s.H, sc = Math.min(cw / W, ch / H), pw = W * sc, ph = H * sc, ox = (cw - pw) / 2, oy = (ch - ph) / 2;
    drawOuter(ctx, cw, ch, s);
    const k = reduced ? 0 : V.shake * V.shake * 7 * sc / 1.5, sx = (V.r() - 0.5) * 2 * k, sy = (V.r() - 0.5) * 2 * k;
    if (pixel && (V.buffer?.width === W && V.buffer?.height === H || (V.buffer = surface(W, H)))) {
      if (!V.bufferCtx || V.bufferCtx.canvas !== V.buffer) V.bufferCtx = V.buffer.getContext('2d');
      const g = V.bufferCtx;
      g.setTransform(1, 0, 0, 1, 0, 0); g.imageSmoothingEnabled = false; g.clearRect(0, 0, W, H);
      drawWorld(g, s);
      ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, pw, ph); ctx.clip();
      ctx.imageSmoothingEnabled = false; ctx.drawImage(V.buffer, ox + Math.round(sx), oy + Math.round(sy), pw, ph);
      ctx.restore();
    } else {
      ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, pw, ph); ctx.clip();
      ctx.translate(ox + sx, oy + sy); ctx.scale(sc, sc);
      drawWorld(ctx, s);
      ctx.restore();
    }
    if (V.flash > 0) { ctx.fillStyle = rgba(V.flashColor, Math.min(0.85, V.flash) * (reduced ? 0.4 : 0.6)); ctx.fillRect(ox, oy, pw, ph); }
    drawHud(ctx, s, ox, oy, pw, ph, sc, cw, ch, frame);
    // World-to-screen mapping for mods drawn on top (v2/kits/mods/compose.js), in world.js tiles.
    render.view = frame.attract ? null : { X: x => ox + sx + x * TILE * sc, Y: y => oy + sy + y * TILE * sc, s: TILE * sc, clip: { x: ox, y: oy, w: pw, h: ph }, hud: { x: ox + pw / 2, y: oy + Math.min(ph * 0.2, Math.max(70, ph * 0.13)), w: pw * 0.96 } };
  };
  return render;
}
