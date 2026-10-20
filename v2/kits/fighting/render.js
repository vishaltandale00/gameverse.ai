// Canvas renderer for the fighting kit: stage backdrop with a perspective floor, the skeletal
// fighters, projectiles and particles, the HUD (health with delayed damage, super meter, timer,
// round medals, combo counter, announcer), and the menu, select, VS, continue and ending screens.
// All visual state lives in `fx` (outside game state) so the simulation stays deterministic.
import { drawFighter, poseFor, paletteFor, POSES, mixHex, shadeHex, lightHex } from './rig.js';
import { phaseOf, SUPER_COST } from './moves.js';
import { ARENA, useArenaOf } from './arena.js';
import { TILE } from './world.js';
import { paintScenery } from '../../art/scenery.js';
import { createAmbient } from '../../art/ambient.js';

const FONT = '"Avenir Next", "Nunito", ui-rounded, "SF Pro Rounded", "Segoe UI", system-ui, sans-serif';
const DISPLAY = '"Avenir Next Condensed", "Arial Narrow", "Roboto Condensed", Impact, sans-serif';
const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const LEVEL_NAMES = ['', 'Easy', 'Normal', 'Hard', 'Expert', 'Master'];
export const MOTION_TEXT = { qcf: '↓↘→', qcb: '↓↙←', dp: '→↓↘', rdp: '←↓↙', hcf: '←↙↓↘→', hcb: '→↘↓↙←', 'charge-bf': '[←] →', 'charge-du': '[↓] ↑', 'tap-dd': '↓ ↓', 'tap-bf': '← →', qcf2: '↓↘→↓↘→' };
const FLOOR = { meadow: '#5f8f3e', forest: '#4a5a32', desert: '#c89a5a', snow: '#d8e4f0', cave: '#4a4058', volcano: '#4a2a22', city: '#5a5a66', castle: '#6a6474', space: '#3a3058', ocean: '#c8b07a', jungle: '#4a6a32', haunted: '#3a3448', factory: '#5a5650', sky: '#e8eef8', candy: '#f0a8c8' };

// ---------- images ----------
const images = new Map();
function image(url) {
  if (!url || typeof Image === 'undefined') return null;
  let e = images.get(url);
  if (!e) { const img = new Image(); e = { img, ready: false }; img.onload = () => { e.ready = true; }; img.src = url; images.set(url, e); }
  return e.ready ? e.img : null;
}
const painted = new Map(), ambients = new Map();
/** The stage's moving parts (traffic, leaves, weather), cached per stage. */
function stageAmbient(stage) {
  const key = `${stage.id}|${JSON.stringify(stage.features || [])}|${stage.time}`;
  if (!ambients.has(key)) ambients.set(key, createAmbient(stage.features || [], { seed: stage.id, night: stage.time === 'night' }));
  return ambients.get(key);
}
function stageImage(stage, art) {
  if (!stage) return null;
  const dir = art?.direction;
  if (art?.background && (!dir || dir.scenery?.theme === stage.theme) && !stage.features?.length) return image(art.background);
  if (typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return null;
  const key = `${stage.id}|${stage.theme}|${stage.time}|${dir?.style || ''}|${JSON.stringify(stage.features || [])}`;
  if (!painted.has(key)) {
    try { painted.set(key, URL.createObjectURL(new Blob([paintScenery({ theme: stage.theme, time: stage.time, features: stage.features || [] }, { pixel: dir?.style === 'pixel', seed: stage.id })], { type: 'image/svg+xml' }))); }
    catch { painted.set(key, null); }
  }
  return image(painted.get(key));
}

// ---------- particles ----------
function burst(fx, x, y, opts) { fx.parts.push({ kind: 'burst', x, y, t: 0, life: opts.life || 14, size: opts.size || 26, color: opts.color || '#fff6c0', spikes: opts.spikes || 8, rot: fx.rnd() * TAU }); }
function sparks(fx, x, y, n, color, speed = 5, life = 18, grav = 0.2) {
  for (let i = 0; i < n; i++) { const a = fx.rnd() * TAU, v = speed * (0.4 + fx.rnd()); fx.parts.push({ kind: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: life * (0.6 + fx.rnd() * 0.6), size: 2 + fx.rnd() * 2, color, grav }); }
}
function dust(fx, x, y, n = 6, dirn = 0) {
  for (let i = 0; i < n; i++) fx.parts.push({ kind: 'dust', x: x + (fx.rnd() - 0.5) * 30, y: y + 2, vx: (fx.rnd() - 0.5) * 2 + dirn * 1.5, vy: fx.rnd() * 1.2, t: 0, life: 22 + fx.rnd() * 14, size: 6 + fx.rnd() * 8, color: 'rgba(230,220,200,.5)', grav: -0.02 });
}
function popup(fx, x, y, text, color) { fx.parts.push({ kind: 'text', x, y, vy: 0.8, t: 0, life: 50, text, color }); }
function stepParts(fx, k) {
  for (const p of fx.parts) {
    p.t += k;
    if (p.vx != null) { p.x += p.vx * k; p.y += p.vy * k; p.vy -= (p.grav || 0) * k; p.vx *= 0.96 ** k; }
    if (p.kind === 'text') p.y += p.vy * k;
  }
  fx.parts = fx.parts.filter(p => p.t < p.life);
  if (fx.parts.length > 500) fx.parts.splice(0, fx.parts.length - 500);
}

function rnd(seed = 7) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function createRenderer(game, { art = {} } = {}) {
  const roster = game.roster, content = game.content;
  const pals = roster.map((F, i) => ({
    base: paletteFor(F.look, { direction: i === 0 ? art.direction?.player : i === game.bossIdx ? art.direction?.enemy : null }),
    mirror: paletteFor(F.look, { mirror: true }),
  }));
  const white = Object.fromEntries(['skin', 'primary', 'secondary', 'accent', 'hairColor', 'outline', 'skinShade', 'primaryShade', 'secondaryShade', 'accentShade'].map(k => [k, '#ffffff']));
  const fx = { parts: [], shake: 0, lag: [1, 1], lagHold: [0, 0], shownHp: [1, 1], combo: null, cam: null, rnd: rnd(game.seed || 7), flash: 0, hitFlash: [0, 0], ghosts: [[], []], time: 0, demo: null, demoAcc: 0, slowFlash: 0, finisher: null, lastMatch: null };

  const look = i => ({ outfit: roster[i].look.outfit, hair: roster[i].look.hair, headwear: roster[i].look.headwear, build: roster[i].build });
  const palOf = f => f.mirror ? pals[f.fid].mirror : pals[f.fid].base;

  function render(ctx, real, frame) {
    const W = frame.cssWidth, H = frame.cssHeight, dt = Math.min(0.1, frame.dt || 1 / 60), k = dt * 60;
    fx.time += k;
    let state = real;
    if (frame.attract) state = demoState(dt);
    else if (fx.demo) fx.demo = null;
    ctx.save();
    ctx.fillStyle = '#0c0c16'; ctx.fillRect(0, 0, W, H);
    const fighting = !!state.match && !['menu', 'select', 'vs', 'continue', 'ending'].includes(state.phase);
    if (fighting) {
      if (fx.lastMatch !== state.match) { fx.lastMatch = state.match; fx.cam = null; }
      if (!frame.paused) handleEvents(state, frame.attract ? state.events : frame.events, frame);
      if (!frame.paused) stepParts(fx, state.slow ? k / 3 : k);
      drawFight(ctx, state, W, H, k, frame);
      // World-to-screen mapping for mods drawn on top (world units are TILE kit units, y up).
      const c = fx.lastCam;
      render.view = frame.attract ? null : { X: x => c.sx(x * TILE), Y: y => c.sy(y * TILE), s: c.zoom * TILE, hud: { x: W / 2, y: H - 64 * clamp(W / 900, 0.6, 1.5) } };
    } else {
      fx.parts = []; fx.combo = null; render.view = null;
      if (state.phase === 'menu') drawMenu(ctx, state, W, H);
      else if (state.phase === 'select') drawSelect(ctx, state, W, H);
      else if (state.phase === 'vs') drawVs(ctx, state, W, H);
      else if (state.phase === 'continue') drawContinue(ctx, state, W, H);
      else if (state.phase === 'ending') drawEnding(ctx, state, W, H);
    }
    ctx.restore();
  }

  // Attract mode: a CPU-vs-CPU exhibition behind the host's title screen.
  function demoState(dt) {
    if (!fx.demo || fx.demo.status !== 'playing') {
      const s = game.createState();
      const p1 = game.selectable[0] ?? 0, p2 = game.bossIdx ?? 1;
      game.startMatch(s, { p1, p2, stage: game.stageIdx.get(content.boss.stage) ?? 0, cpuBoth: true, levels: [3, 3] });
      fx.demo = s; fx.demoAcc = 0;
    }
    const events = [];
    fx.demoAcc = Math.min(fx.demoAcc + dt, 0.25);
    while (fx.demoAcc >= 1 / 60) { fx.demoAcc -= 1 / 60; game.step(fx.demo, {}); events.push(...fx.demo.events); }
    return { ...fx.demo, events };
  }

  // ---------- events → effects ----------
  function handleEvents(state, events, frame) {
    const reduced = frame.reducedMotion;
    fx.reduced = !!reduced;
    for (const e of events || []) {
      switch (e.name) {
        case 'hit': {
          const heavy = e.strength !== 'light', sup = e.strength === 'super';
          const col = e.counter ? '#ff6a3a' : sup ? '#ffe36a' : heavy ? '#fff0a0' : '#ffffff';
          burst(fx, e.x, e.y, { size: sup ? 44 : heavy ? 34 : 22, color: col, spikes: heavy ? 10 : 7, life: heavy ? 16 : 11 });
          sparks(fx, e.x, e.y, reduced ? 3 : heavy ? 12 : 6, col, heavy ? 6 : 4);
          const d = 1 - e.slot; fx.hitFlash[d] = 4;
          if (!reduced) fx.shake = Math.max(fx.shake, sup ? 7 : heavy ? 5 : 2.5);
          break;
        }
        case 'block': burst(fx, e.x, e.y, { size: 24, color: '#9fd8ff', spikes: 5, life: 10 }); sparks(fx, e.x, e.y, reduced ? 2 : 6, '#c8ecff', 4, 12); fx.parts.push({ kind: 'shield', x: e.x, y: e.y, t: 0, life: 12, slot: e.slot }); break;
        case 'counter': popup(fx, e.x, e.y + 34, 'COUNTER', '#ff7a3a'); break;
        case 'parry': fx.parts.push({ kind: 'ring', x: e.x, y: e.y, t: 0, life: 20, size: 70, color: '#bff4ff' }); popup(fx, e.x, e.y + 40, 'PARRY', '#7ae8ff'); if (!reduced) fx.flash = 6; break;
        case 'tech': popup(fx, e.x, e.y + 40, 'TECH', '#b8ff7a'); sparks(fx, e.x, e.y, 8, '#e8ffd0', 4); break;
        case 'clash': burst(fx, e.x, e.y, { size: 40, color: '#ffffff', spikes: 12, life: 16 }); fx.parts.push({ kind: 'ring', x: e.x, y: e.y, t: 0, life: 16, size: 60, color: '#fff' }); break;
        case 'shoot': { const f = state.fighters[e.slot]; sparks(fx, f.x + f.facing * 40, f.y + 56, 6, accentOf(f), 3, 12, 0); break; }
        case 'teleport': for (let i = 0; i < 14; i++) fx.parts.push({ kind: 'dust', x: e.x + (fx.rnd() - 0.5) * 40, y: e.y + fx.rnd() * 90, vx: 0, vy: 0.6, t: 0, life: 26, size: 8, color: 'rgba(190,170,255,.55)', grav: 0 }); break;
        case 'land': case 'down': { const f = state.fighters[e.slot]; if (f) dust(fx, f.x, f.y, e.heavy ? 12 : 6); if (e.name === 'down' && !reduced) fx.shake = Math.max(fx.shake, 3); break; }
        case 'throw': { const f = state.fighters[e.slot]; if (f) dust(fx, f.x, f.y, 5); break; }
        case 'shake': if (!reduced) fx.shake = Math.max(fx.shake, e.power); break;
        case 'combo': fx.combo = { slot: e.slot, hits: e.hits, damage: e.damage, t: 0 }; break;
        case 'ko': fx.slowFlash = reduced ? 0 : 16; burst(fx, e.x, e.y, { size: 70, color: '#ffffff', spikes: 14, life: 26 }); if (!reduced) fx.shake = 9; break;
        case 'blast': fx.parts.push({ kind: 'blast', x: e.x, y: e.y, t: 0, life: 40, color: accentOf(state.fighters[e.slot]) }); if (!reduced) fx.shake = 10; break;
        case 'finisher': fx.finisher = { style: e.style, x: e.x, y: e.y, t: 0, slot: e.slot }; break;
        case 'super': fx.superT = 0; break;
        case 'round': fx.lag = state.fighters.map(f => f.hp / f.maxHp); fx.combo = null; break;
      }
    }
  }
  const accentOf = f => palOf(f).accent;

  // ---------- camera ----------
  function camera(state, W, H, k) {
    const fs = state.fighters;
    let tx, ty, zoom;
    if (game.platform) {
      const live = fs.filter(f => !f.hidden);
      const xs = live.length ? live.map(f => f.x) : [ARENA.P.center], ys = live.length ? live.map(f => f.y) : [0];
      const x0 = Math.min(...xs, ARENA.P.main.x0 + 60) - 90, x1 = Math.max(...xs, ARENA.P.main.x1 - 60) + 90;
      const y0 = Math.min(...ys, 0) - 70, y1 = Math.max(...ys, 120) + 150;
      zoom = clamp(Math.min(W / (x1 - x0), H / (y1 - y0)), W / 1000, W / 420);
      tx = (x0 + x1) / 2; ty = (y0 + y1) / 2;
    } else {
      zoom = Math.min(W / 460, H / 300);
      const half = W / zoom / 2, mid = (fs[0].x + fs[1].x) / 2;
      tx = (ARENA.T.right - ARENA.T.left) < half * 2 ? ARENA.T.center : clamp(mid, ARENA.T.left + half, ARENA.T.right - half);
      ty = Math.max(0, Math.max(fs[0].y, fs[1].y) - 120) * 0.6;
    }
    if (!fx.cam) fx.cam = { x: tx, y: ty, zoom };
    const s = 1 - 0.82 ** k;
    fx.cam.x = lerp(fx.cam.x, tx, s); fx.cam.y = lerp(fx.cam.y, ty, s); fx.cam.zoom = lerp(fx.cam.zoom, zoom, s * 0.6);
    const floorY = game.platform ? H / 2 + (fx.cam.y) * fx.cam.zoom : H - Math.max(36, H * 0.12);
    const c = fx.cam;
    return { zoom: c.zoom, floorY, sx: x => (x - c.x) * c.zoom + W / 2, sy: y => floorY - (y - (game.platform ? 0 : c.y)) * c.zoom, cx: c.x };
  }

  // ---------- the fight ----------
  function drawFight(ctx, state, W, H, k, frame) {
    useArenaOf(state);
    const cam = camera(state, W, H, k), z = cam.zoom, fs = state.fighters, m = state.match;
    fx.lastCam = cam;
    const stage = content.stages[m.stage] || content.stages[0];
    let sx = 0, sy = 0;
    if (fx.shake > 0.2 && !frame.reducedMotion) { sx = (fx.rnd() - 0.5) * fx.shake * 2; sy = (fx.rnd() - 0.5) * fx.shake * 2; }
    fx.shake *= 0.86 ** k;
    ctx.save(); ctx.translate(sx, sy);
    drawStage(ctx, state, stage, cam, W, H);
    // Super flash dims the world behind the fighters.
    if (state.flash) { ctx.fillStyle = `rgba(6,4,18,${0.62 * Math.min(1, (36 - state.flash.t + 4) / 8)})`; ctx.fillRect(-20, -20, W + 40, H + 40); }
    // Shadows.
    for (const f of fs) if (!f.hidden) {
      const gy = game.platform ? groundUnder(f) : 0;
      if (gy == null) continue;
      const hgt = Math.max(0, f.y - gy), r = 26 * z * game.roster[f.fid].phys.scale * clamp(1 - hgt / 220, 0.35, 1);
      ctx.fillStyle = `rgba(0,0,0,${0.32 * clamp(1 - hgt / 260, 0.2, 1)})`;
      ctx.beginPath(); ctx.ellipse(cam.sx(f.x), cam.sy(gy) + 2, r, r * 0.22, 0, 0, TAU); ctx.fill();
    }
    for (const p of state.projectiles) drawProjectile(ctx, state, p, cam);
    // The attacker draws in front.
    const order = [...fs].sort((a, b) => (a.st === 'attack' || a.st === 'throw' ? 1 : 0) - (b.st === 'attack' || b.st === 'throw' ? 1 : 0));
    for (const f of order) drawOne(ctx, state, f, cam, k);
    drawParts(ctx, cam);
    if (fx.finisher) drawFinisher(ctx, state, cam, k);
    ctx.restore();
    if (fx.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${fx.flash / 14})`; ctx.fillRect(0, 0, W, H); fx.flash -= k; }
    if (fx.slowFlash > 0) { ctx.fillStyle = `rgba(255,255,255,${fx.slowFlash / 40})`; ctx.fillRect(0, 0, W, H); fx.slowFlash -= k; }
    if (state.flash) drawCutIn(ctx, state, W, H);
    if (!frame.attract) { if (game.platform) drawPlatformHud(ctx, state, W, H, k); else drawHud(ctx, state, W, H, k); }
    else drawAttractHud(ctx, state, W, H);
    drawBanner(ctx, state, W, H);
  }

  function groundUnder(f) {
    let best = null;
    if (f.x >= ARENA.P.main.x0 && f.x <= ARENA.P.main.x1 && f.y >= -2) best = 0;
    for (const p of ARENA.P.soft) if (f.x >= p.x0 && f.x <= p.x1 && f.y >= p.y - 2 && (best == null || p.y > best)) best = p.y;
    return best;
  }

  function drawStage(ctx, state, stage, cam, W, H) {
    const img = stageImage(stage, art), floorC = FLOOR[stage.theme] || '#5a5a66';
    const horizon = game.platform ? H * 0.75 : cam.floorY;
    if (img) {
      const scale = Math.max(W * 1.3 / img.width, (horizon + 30) / (img.height * 0.86));
      const iw = img.width * scale, ih = img.height * scale;
      const px = W / 2 - iw / 2 - (cam.cx - 500) * cam.zoom * 0.22;
      const py = horizon - ih * 0.86 + (game.platform ? 0 : fx.cam.y * cam.zoom * 0.3);
      ctx.drawImage(img, clamp(px, W - iw, 0), py, iw, ih);
      stageAmbient(stage)?.(ctx, { x: clamp(px, W - iw, 0), y: py, w: iw, h: ih }, fx.time / 60, { reduced: !!fx.reduced });
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, horizon);
      g.addColorStop(0, shadeHex(floorC, 0.7)); g.addColorStop(1, lightHex(floorC, 0.3));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, horizon + 2);
    }
    if (game.platform) { drawPlatforms(ctx, stage, cam, floorC); return; }
    // Perspective floor: bands and rails converging on a vanishing point above the horizon.
    const y0 = cam.floorY, g = ctx.createLinearGradient(0, y0, 0, H);
    g.addColorStop(0, shadeHex(floorC, 0.05)); g.addColorStop(1, shadeHex(floorC, 0.45));
    ctx.fillStyle = g; ctx.fillRect(0, y0 - 1, W, H - y0 + 2);
    ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.fillRect(0, y0 - 1, W, 2);
    ctx.strokeStyle = 'rgba(0,0,0,.16)'; ctx.lineWidth = 1;
    const vp = W / 2;
    for (let x = ARENA.T.left; x <= ARENA.T.right; x += 46) {
      const top = cam.sx(x), bot = vp + (top - vp) * 2.4;
      ctx.beginPath(); ctx.moveTo(top, y0); ctx.lineTo(bot, H); ctx.stroke();
    }
    for (let i = 1; i < 4; i++) { const yy = y0 + (H - y0) * (i * i) / 10; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke(); }
    // Stage edge posts mark the walls.
    for (const x of [ARENA.T.left, ARENA.T.right]) { const px = cam.sx(x); if (px > -20 && px < W + 20) { ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(px - 3, y0 - 70 * cam.zoom, 6, 70 * cam.zoom); } }
  }

  function drawPlatforms(ctx, stage, cam, floorC) {
    const M = ARENA.P.main, top = lightHex(floorC, 0.25), side = shadeHex(floorC, 0.35), O = shadeHex(floorC, 0.75);
    const x0 = cam.sx(M.x0), x1 = cam.sx(M.x1), y = cam.sy(0), d = 26 * cam.zoom;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.lineTo(x1 - d * 0.6, y + d); ctx.lineTo(lerp(x0, x1, 0.65), y + d * 3.2); ctx.lineTo(lerp(x0, x1, 0.4), y + d * 3.6); ctx.lineTo(x0 + d * 0.6, y + d); ctx.closePath();
    ctx.fillStyle = side; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = O; ctx.stroke();
    ctx.fillStyle = top; ctx.fillRect(x0, y - 2, x1 - x0, 9 * cam.zoom); ctx.strokeRect(x0, y - 2, x1 - x0, 9 * cam.zoom);
    for (const p of ARENA.P.soft) {
      const a = cam.sx(p.x0), b = cam.sx(p.x1), py = cam.sy(p.y);
      ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fillRect(a, py - 2, b - a, 6 * cam.zoom);
      ctx.fillStyle = 'rgba(120,200,255,.35)'; ctx.fillRect(a, py + 6 * cam.zoom - 2, b - a, 3 * cam.zoom);
      ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1.5; ctx.strokeRect(a, py - 2, b - a, 6 * cam.zoom);
    }
  }

  function viewOf(state, f) {
    const F = roster[f.fid], v = { st: f.st, t: f.t, crouch: false, walk: Math.sign(f.vx) * f.facing || 1, winPose: f.fid, jumpVy: f.vy, idleT: fx.time + f.slot * 37, air: f.air, counterStrike: f.counterStrike };
    v.crouch = f.st === 'crouch' || ((f.st === 'guard' || f.st === 'block') && (f.prev.y === 1 || f.blockLow)) || (f.st === 'hit' && f.crouchHit);
    if (f.st === 'attack') {
      const m = F.moves[f.move];
      v.anim = m.anim; v.phase = phaseOf(m, f.mf);
      if (v.phase === 'startup') v.prog = f.mf / Math.max(1, m.startup);
      else if (v.phase === 'active') v.prog = (f.mf - m.startup) / Math.max(1, m.active);
      else v.prog = clamp((f.mf - m.startup - m.active) / Math.max(1, m.recovery), 0, 1);
      if (m.behavior === 'dive' && !f.diving) { v.phase = 'startup'; v.prog = 0.4; }
      if (m.behavior === 'dive' && f.diving) v.phase = 'active';
      if (m.behavior === 'hop' && f.air && v.phase === 'startup') v.prog = Math.min(v.prog, 0.64);
    }
    return v;
  }

  function faceOf(f, pose) {
    if (f.st === 'ko' || f.st === 'flourished') return 'ko';
    if (['hit', 'launch', 'knockdown', 'thrown', 'dazed'].includes(f.st)) return 'hurt';
    if (pose.shout || f.st === 'throw') return 'shout';
    if (f.st === 'attack' || f.st === 'block' || f.st === 'guard') return 'fight';
    if (f.st === 'win') return 'calm';
    return 'fight';
  }

  function drawOne(ctx, state, f, cam, k) {
    const F = roster[f.fid], z = cam.zoom * F.phys.scale;
    const gh = fx.ghosts[f.slot];
    const fast = f.st === 'dash' || (f.st === 'attack' && ['travel', 'dive', 'rise'].includes(F.moves[f.move].behavior) && phaseOf(F.moves[f.move], f.mf) === 'active');
    if (fast) { gh.push({ x: f.x, y: f.y, life: 10 }); if (gh.length > 5) gh.shift(); }
    for (const g of gh) g.life -= k;
    fx.ghosts[f.slot] = gh.filter(g => g.life > 0);
    if (f.hidden) return;
    const view = viewOf(state, f);
    let pose = poseFor(view);
    if (f.st === 'thrown') {
      const o = state.fighters[1 - f.slot];
      pose = { ...pose, y: -Math.min(30, o.t * 2) };
    }
    const pal = palOf(f), lk = look(f.fid), face = faceOf(f, pose);
    const opts = { pal, ...lk, face, time: fx.time };
    let alpha = 1;
    if ((f.invuln > 0 && (f.st === 'wakeup' || f.st === 'respawn' || f.st === 'idle')) && Math.floor(fx.time / 3) % 2) alpha = 0.55;
    if (f.st === 'attack' && F.moves[f.move].behavior === 'teleport') { const m = F.moves[f.move]; alpha = f.mf <= m.startup ? 1 - f.mf / m.startup : clamp((f.mf - m.startup - m.active) / 6, 0, 1); }
    let scaleX = f.facing;
    if (pose.spin) scaleX *= Math.cos(fx.time * 0.9) >= 0 ? 1 : -1;
    const place = (x, y, a, p, o) => { ctx.save(); ctx.globalAlpha = a; ctx.translate(cam.sx(x), cam.sy(y)); ctx.scale(scaleX * z, z); drawFighter(ctx, p, o); ctx.restore(); };
    for (const g of fx.ghosts[f.slot]) place(g.x, g.y, alpha * 0.22 * (g.life / 10), pose, { ...opts, pal: { ...pal, outline: pal.accent } });
    // Counter stance and super aura.
    if (f.st === 'attack' && (F.moves[f.move].behavior === 'counter' && phaseOf(F.moves[f.move], f.mf) === 'active' || F.moves[f.move].kind === 'super')) {
      const g = ctx.createRadialGradient(cam.sx(f.x), cam.sy(f.y + 50), 4, cam.sx(f.x), cam.sy(f.y + 50), 80 * z);
      g.addColorStop(0, `${lightHex(pal.accent, 0.4)}88`); g.addColorStop(1, `${pal.accent}00`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cam.sx(f.x), cam.sy(f.y + 50), 80 * z, 0, TAU); ctx.fill();
    }
    place(f.x, f.y, alpha, pose, opts);
    if (fx.hitFlash[f.slot] > 0) { place(f.x, f.y, 0.32 * fx.hitFlash[f.slot] / 4, pose, { ...opts, pal: white }); fx.hitFlash[f.slot] -= k; }
    if (f.st === 'dazed' || (f.st === 'knockdown' && f.t > 10 && f.combo > 6)) {
      for (let i = 0; i < 3; i++) {
        const a = fx.time * 0.12 + i * TAU / 3, hx = cam.sx(f.x + Math.cos(a) * 18), hy = cam.sy(f.y + (f.st === 'dazed' ? 112 : 26)) + Math.sin(a) * 5 * z;
        star(ctx, hx, hy, 5 * z, '#ffe46a');
      }
    }
  }

  function star(ctx, x, y, r, color) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = '#5a3a00'; ctx.stroke();
  }

  function drawProjectile(ctx, state, p, cam) {
    const owner = state.fighters[p.owner], pal = palOf(owner), c = lightHex(pal.accent, 0.15), z = cam.zoom;
    const x = cam.sx(p.x), y = cam.sy(p.y), dirn = Math.sign(p.vx);
    if (fx.rnd() < 0.7) fx.parts.push({ kind: 'spark', x: p.x - dirn * p.w * 0.4, y: p.y + (fx.rnd() - 0.5) * p.h * 0.6, vx: -dirn * (1 + fx.rnd()), vy: (fx.rnd() - 0.5), t: 0, life: 14, size: 3 + fx.rnd() * 3, color: c, grav: 0 });
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    if (p.kind === 'wave') {
      for (let i = 0; i < 4; i++) {
        const hx = x - dirn * i * 10 * z, hh = (p.h + 10 - i * 5) * z * (0.8 + 0.2 * Math.sin(fx.time * 0.5 + i));
        ctx.fillStyle = `${c}${['ff', 'bb', '88', '55'][i]}`;
        ctx.beginPath(); ctx.moveTo(hx - 8 * z, y); ctx.lineTo(hx, y - hh); ctx.lineTo(hx + 8 * z, y); ctx.closePath(); ctx.fill();
      }
    } else {
      const big = p.kind === 'beam', rx = (big ? p.w * 0.9 : p.w * 0.62) * z, ry = p.h * 0.55 * z;
      const g = ctx.createRadialGradient(x, y, 1, x, y, rx * 1.6);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.25, lightHex(c, 0.5)); g.addColorStop(0.55, `${c}cc`); g.addColorStop(1, `${c}00`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x - dirn * rx * 0.2, y, rx * 1.6, ry * 1.5, 0, 0, TAU); ctx.fill();
      // Flickering flame tongues trail behind.
      for (let i = 0; i < 5; i++) {
        const a = fx.time * 0.6 + i * 1.3, l = rx * (1.1 + 0.4 * Math.sin(a));
        ctx.fillStyle = `${c}66`; ctx.beginPath(); ctx.ellipse(x - dirn * l * 0.9, y + Math.sin(a) * ry * 0.5, l * 0.6, ry * 0.35, 0, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(x + dirn * rx * 0.1, y, rx * 0.45, ry * 0.5, 0, 0, TAU); ctx.fill();
      if (big) { ctx.fillStyle = `${c}33`; ctx.fillRect(Math.min(x, cam.sx(owner.x)), y - ry * 0.6, Math.abs(x - cam.sx(owner.x)), ry * 1.2); }
    }
    ctx.restore();
  }

  function drawParts(ctx, cam) {
    const z = cam.zoom;
    for (const p of fx.parts) {
      const x = cam.sx(p.x), y = cam.sy(p.y), u = p.t / p.life;
      ctx.save();
      switch (p.kind) {
        case 'burst': {
          ctx.globalCompositeOperation = 'lighter';
          const r = p.size * z * (0.5 + ease(u) * 0.9);
          ctx.globalAlpha = 1 - u;
          ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x, y, r * 0.35 * (1 - u), 0, TAU); ctx.fill();
          ctx.fillStyle = p.color;
          for (let i = 0; i < p.spikes; i++) {
            const a = p.rot + i * TAU / p.spikes, l = r * (i % 2 ? 0.7 : 1.15), w = r * 0.13;
            ctx.beginPath(); ctx.moveTo(x + Math.cos(a + 1.57) * w, y + Math.sin(a + 1.57) * w); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.lineTo(x + Math.cos(a - 1.57) * w, y + Math.sin(a - 1.57) * w); ctx.closePath(); ctx.fill();
          }
          break;
        }
        case 'spark': ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1 - u; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(x, y, p.size * z * 0.5 * (1 - u * 0.5), 0, TAU); ctx.fill(); break;
        case 'dust': ctx.globalAlpha = (1 - u) * 0.8; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(x, y, p.size * z * (0.5 + u), 0, TAU); ctx.fill(); break;
        case 'ring': ctx.globalAlpha = 1 - u; ctx.strokeStyle = p.color; ctx.lineWidth = 4 * (1 - u) + 1; ctx.beginPath(); ctx.arc(x, y, p.size * z * ease(u), 0, TAU); ctx.stroke(); break;
        case 'shield': ctx.globalAlpha = (1 - u) * 0.9; ctx.strokeStyle = '#bfe8ff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, (16 + u * 14) * z, -1.1, 1.1); ctx.stroke(); ctx.beginPath(); ctx.arc(x, y, (16 + u * 14) * z, Math.PI - 1.1, Math.PI + 1.1); ctx.stroke(); break;
        case 'text': {
          ctx.globalAlpha = u < 0.75 ? 1 : (1 - u) * 4;
          const s = 1 + Math.max(0, 0.4 - u * 3);
          ctx.font = `italic 900 ${Math.round(15 * s * clamp(z, 1, 2.2))}px ${DISPLAY}`; ctx.textAlign = 'center';
          ctx.lineWidth = 4; ctx.strokeStyle = '#1a0a04'; ctx.strokeText(p.text, x, y); ctx.fillStyle = p.color; ctx.fillText(p.text, x, y);
          break;
        }
        case 'blast': {
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1 - u;
          const l = 600 * ease(u), wd = 60 * (1 - u) + 6;
          const a = Math.atan2(cam.sy(250) - y, cam.sx(500) - x);
          ctx.translate(x, y); ctx.rotate(a);
          const g = ctx.createLinearGradient(0, 0, l, 0); g.addColorStop(0, '#ffffff'); g.addColorStop(0.3, p.color); g.addColorStop(1, `${p.color}00`);
          ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, -wd); ctx.lineTo(l, -wd * 0.2); ctx.lineTo(l, wd * 0.2); ctx.lineTo(0, wd); ctx.closePath(); ctx.fill();
          break;
        }
        case 'petal': case 'confetti': case 'shard': {
          ctx.globalAlpha = Math.min(1, (1 - u) * 2); ctx.translate(x, y); ctx.rotate(p.rot + p.t * 0.2); ctx.fillStyle = p.color;
          if (p.kind === 'petal') { ctx.beginPath(); ctx.ellipse(0, 0, p.size * z, p.size * z * 0.5, 0, 0, TAU); ctx.fill(); }
          else if (p.kind === 'shard') { ctx.beginPath(); ctx.moveTo(0, -p.size * z); ctx.lineTo(p.size * z * 0.5, 0); ctx.lineTo(0, p.size * z); ctx.lineTo(-p.size * z * 0.5, 0); ctx.closePath(); ctx.fill(); }
          else ctx.fillRect(-p.size * z / 2, -p.size * z / 4, p.size * z, p.size * z / 2);
          break;
        }
        case 'star': ctx.globalAlpha = 1 - u; star(ctx, x, y, p.size * z * (1 - u * 0.4), p.color); break;
      }
      ctx.restore();
    }
  }

  // The stylized, non-gory finishing flourish.
  function drawFinisher(ctx, state, cam, k) {
    const F = fx.finisher; F.t += k;
    const loser = state.fighters[1 - F.slot], x = loser.x, y = loser.y + 50, z = cam.zoom;
    const emit = (kind, n, colors, speed = 4) => { for (let i = 0; i < n; i++) { const a = fx.rnd() * TAU, v = speed * (0.4 + fx.rnd()); fx.parts.push({ kind, x: x + (fx.rnd() - 0.5) * 30, y: y + (fx.rnd() - 0.5) * 60, vx: Math.cos(a) * v, vy: Math.sin(a) * v + 1, t: 0, life: 50 + fx.rnd() * 30, size: 3 + fx.rnd() * 4, color: colors[i % colors.length], rot: fx.rnd() * TAU, grav: kind === 'confetti' ? 0.06 : 0.02 }); } };
    const t = F.t;
    if (F.style === 'lightning' && t < 50 && Math.floor(t) % 8 === 0) {
      ctx.save(); ctx.strokeStyle = '#fff8a0'; ctx.lineWidth = 5; ctx.shadowColor = '#ffe84a'; ctx.shadowBlur = 16; ctx.beginPath();
      let lx = cam.sx(x), ly = 0; ctx.moveTo(lx, ly); while (ly < cam.sy(loser.y)) { lx += (fx.rnd() - 0.5) * 40; ly += 30; ctx.lineTo(lx, ly); } ctx.stroke(); ctx.restore();
      if (t < 2) fx.flash = 10;
    }
    if (Math.floor(t) === 2 || Math.floor(t) === 3) {
      if (F.style === 'starburst') { for (let i = 0; i < 24; i++) { const a = i * TAU / 24; fx.parts.push({ kind: 'star', x, y, vx: Math.cos(a) * 5, vy: Math.sin(a) * 5, t: 0, life: 60, size: 7, color: i % 2 ? '#ffe46a' : '#ff9ad0', grav: 0 }); } }
      if (F.style === 'petal_storm') emit('petal', 60, ['#ffb0d8', '#ffd0e8', '#ff7ab0'], 5);
      if (F.style === 'freeze') emit('shard', 40, ['#d8f4ff', '#9ad8ff', '#ffffff'], 3);
      if (F.style === 'confetti') emit('confetti', 80, ['#ff5a5a', '#ffd23a', '#3ad0ff', '#7aff7a', '#d07aff'], 6);
      if (F.style === 'lightning') emit('spark', 30, ['#fff8a0', '#ffffff'], 6);
    }
    // The loser's stylized fate drawn over them.
    const lx = cam.sx(loser.x), ly = cam.sy(loser.y);
    ctx.save();
    if (F.style === 'freeze') { ctx.globalAlpha = Math.min(0.75, t / 30); ctx.fillStyle = '#bfe8ff'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(lx - 34 * z, ly); ctx.lineTo(lx - 30 * z, ly - 110 * z); ctx.lineTo(lx, ly - 125 * z); ctx.lineTo(lx + 32 * z, ly - 105 * z); ctx.lineTo(lx + 34 * z, ly); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    if (F.style === 'petal_storm' || F.style === 'starburst' || F.style === 'confetti') { ctx.globalAlpha = Math.min(0.9, t / 40); const g = ctx.createRadialGradient(lx, ly - 50 * z, 4, lx, ly - 50 * z, 90 * z); g.addColorStop(0, '#ffffff'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(lx, ly - 50 * z, 90 * z, 0, TAU); ctx.fill(); }
    if (F.style === 'lightning' && t > 20) { ctx.globalAlpha = Math.min(0.7, (t - 20) / 20); ctx.fillStyle = '#2a2a30'; ctx.beginPath(); ctx.ellipse(lx, ly - 50 * z, 30 * z, 56 * z, 0, 0, TAU); ctx.fill(); for (let i = 0; i < 3; i++) { ctx.fillStyle = 'rgba(160,160,170,.4)'; ctx.beginPath(); ctx.arc(lx + (i - 1) * 14 * z, ly - (110 + ((t * 0.8 + i * 20) % 40)) * z, 10 * z, 0, TAU); ctx.fill(); } }
    ctx.restore();
  }

  // ---------- HUD ----------
  function drawHud(ctx, state, W, H, k) {
    const fs = state.fighters, m = state.match, s = clamp(W / 900, 0.6, 1.5);
    const top = 14 * s, barH = 20 * s, gap = 70 * s, side = 18 * s, barW = (W - gap - side * 2) / 2;
    for (const f of fs) {
      const i = f.slot, ratio = f.hp / f.maxHp;
      if (ratio < fx.shownHp[i] - 0.0001) { fx.lagHold[i] = 34; }
      fx.shownHp[i] = ratio;
      if (fx.lagHold[i] > 0) fx.lagHold[i] -= k; else fx.lag[i] = Math.max(ratio, fx.lag[i] - 0.012 * k);
      if (fx.lag[i] < ratio) fx.lag[i] = ratio;
      const x0 = i === 0 ? side : W - side - barW;
      const fill = (r0, r1, style) => { const w = barW * (r1 - r0); const x = i === 0 ? x0 + barW * (1 - r1) : x0 + barW * r0; ctx.fillStyle = style; ctx.fillRect(x, top, w, barH); };
      // Frame, empty, delayed red chunk, then health (anchored at the outer edge).
      ctx.fillStyle = 'rgba(10,8,20,.8)'; roundRect(ctx, x0 - 3 * s, top - 3 * s, barW + 6 * s, barH + 6 * s, 4 * s); ctx.fill();
      ctx.fillStyle = '#2a1018'; ctx.fillRect(x0, top, barW, barH);
      const toBar = r => i === 0 ? [1 - r, 1] : [0, r];
      const [la, lb] = toBar(fx.lag[i]); fill(la, lb, '#e8322a');
      const g = ctx.createLinearGradient(0, top, 0, top + barH);
      const low = ratio < 0.25 && Math.floor(fx.time / 8) % 2;
      g.addColorStop(0, low ? '#ffb07a' : '#fff27a'); g.addColorStop(0.5, low ? '#ff6a2a' : '#ffc82a'); g.addColorStop(1, low ? '#c8401a' : '#e8901a');
      const [ha, hb] = toBar(ratio); fill(ha, hb, g);
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(x0, top + 2 * s, barW, 3 * s);
      // Name, round medals and super meter.
      const F = roster[f.fid];
      ctx.font = `italic 800 ${Math.round(14 * s)}px ${FONT}`; ctx.textBaseline = 'top';
      ctx.textAlign = i === 0 ? 'left' : 'right';
      outlineText(ctx, F.name.toUpperCase(), i === 0 ? x0 : x0 + barW, top + barH + 6 * s, '#ffffff');
      for (let w = 0; w < game.toWin; w++) {
        const cx = i === 0 ? x0 + barW - 10 * s - w * 22 * s : x0 + 10 * s + w * 22 * s, cy = top + barH + 14 * s;
        ctx.beginPath(); ctx.arc(cx, cy, 7 * s, 0, TAU); ctx.fillStyle = w < f.wins ? '#ffd23a' : 'rgba(0,0,0,.45)'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = w < f.wins ? '#7a4a00' : 'rgba(255,255,255,.4)'; ctx.stroke();
        if (w < f.wins) star(ctx, cx, cy, 4.5 * s, '#fff6c0');
      }
      meter(ctx, f, i, W, H, s);
    }
    // Timer.
    const secs = Math.ceil(m.timer / 60), tx = W / 2;
    ctx.fillStyle = 'rgba(10,8,20,.85)'; roundRect(ctx, tx - 30 * s, top - 6 * s, 60 * s, 46 * s, 8 * s); ctx.fill();
    ctx.font = `900 ${Math.round(32 * s)}px ${DISPLAY}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    outlineText(ctx, String(Math.max(0, secs)).padStart(2, '0'), tx, top + 17 * s, secs <= 10 && Math.floor(fx.time / 10) % 2 ? '#ff5a4a' : '#ffffff');
    if (state.arcade) { ctx.font = `700 ${Math.round(11 * s)}px ${FONT}`; outlineText(ctx, state.vs?.boss ? 'FINAL BOSS' : `STAGE ${state.arcade.rung + 1}/${state.arcade.list.length}`, tx, top + 50 * s, '#ffd23a'); }
    if (!m.cpuBoth) { ctx.font = `700 ${Math.round(12 * s)}px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; outlineText(ctx, `SCORE ${state.score.toLocaleString('en-US')}`, side, top + barH + 30 * s, '#cfe6ff'); }
    drawCombo(ctx, state, W, H, s, k);
  }

  function meter(ctx, f, i, W, H, s) {
    const w = Math.min(220 * s, W * 0.3), h = 12 * s, y = H - 26 * s, x = i === 0 ? 18 * s : W - 18 * s - w, full = f.meter >= SUPER_COST;
    ctx.fillStyle = 'rgba(10,8,20,.8)'; roundRect(ctx, x - 3, y - 3, w + 6, h + 6, 4); ctx.fill();
    const r = f.meter / SUPER_COST, g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, '#2a7aff'); g.addColorStop(1, full ? '#9af0ff' : '#5ab0ff');
    ctx.fillStyle = g; ctx.fillRect(i === 0 ? x : x + w * (1 - r), y, w * r, h);
    if (full) { ctx.fillStyle = `rgba(255,255,255,${0.25 + 0.25 * Math.sin(fx.time * 0.3)})`; ctx.fillRect(x, y, w, h); }
    ctx.font = `italic 900 ${Math.round(13 * s)}px ${DISPLAY}`; ctx.textBaseline = 'bottom'; ctx.textAlign = i === 0 ? 'left' : 'right';
    outlineText(ctx, full ? 'SUPER  ↓↘→↓↘→ + B' : 'SUPER', i === 0 ? x : x + w, y - 4, full ? '#9af0ff' : '#8aa8d8');
  }

  function drawCombo(ctx, state, W, H, s, k) {
    const c = fx.combo;
    if (!c) return;
    c.t += k;
    const d = state.fighters[1 - c.slot];
    if (d.combo === 0 && c.t > 70) { fx.combo = null; return; }
    if (c.hits < 2) return;
    const a = d.combo === 0 ? clamp(1 - (c.t - 40) / 30, 0, 1) : 1, pop = 1 + Math.max(0, 0.35 - c.t * 0.05);
    ctx.save(); ctx.globalAlpha = a;
    const x = c.slot === 0 ? 24 * s : W - 24 * s, y = H * 0.32;
    ctx.textAlign = c.slot === 0 ? 'left' : 'right'; ctx.textBaseline = 'middle';
    ctx.font = `italic 900 ${Math.round(44 * s * pop)}px ${DISPLAY}`; outlineText(ctx, String(c.hits), x, y, '#ffd23a', 6);
    ctx.font = `italic 900 ${Math.round(18 * s)}px ${DISPLAY}`; outlineText(ctx, 'HITS', x + (c.slot === 0 ? 1 : -1) * (String(c.hits).length * 24 * s + 8 * s), y + 6 * s, '#ffffff');
    ctx.font = `700 ${Math.round(12 * s)}px ${FONT}`; outlineText(ctx, `${c.damage} damage`, x, y + 30 * s, '#ffe0b0');
    ctx.restore();
  }

  function drawPlatformHud(ctx, state, W, H, k) {
    const s = clamp(W / 900, 0.6, 1.5), fs = state.fighters, m = state.match;
    for (const f of fs) {
      const F = roster[f.fid], w = 170 * s, h = 64 * s, x = f.slot === 0 ? W / 2 - w - 30 * s : W / 2 + 30 * s, y = H - h - 12 * s;
      ctx.fillStyle = 'rgba(10,8,20,.75)'; roundRect(ctx, x, y, w, h, 10 * s); ctx.fill();
      ctx.save(); ctx.beginPath(); ctx.arc(x + 32 * s, y + h / 2, 24 * s, 0, TAU); ctx.fillStyle = palOf(f).accent; ctx.fill(); ctx.clip();
      ctx.translate(x + 32 * s, y + h / 2 + 34 * s); ctx.scale(0.62 * s, 0.62 * s); drawFighter(ctx, POSES.guard, { pal: palOf(f), ...look(f.fid), face: 'calm', time: fx.time }); ctx.restore();
      const pct = f.percent, col = mixHex('#ffffff', '#ff3a2a', clamp(pct / 150, 0, 1));
      const jig = f.st === 'launch' ? (fx.rnd() - 0.5) * 3 : 0;
      ctx.font = `italic 900 ${Math.round(30 * s)}px ${DISPLAY}`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      outlineText(ctx, `${Math.floor(pct)}%`, x + w - 12 * s + jig, y + h * 0.42, col, 5);
      ctx.font = `700 ${Math.round(11 * s)}px ${FONT}`; ctx.textAlign = 'left'; outlineText(ctx, F.name.toUpperCase(), x + 62 * s, y + h - 12 * s, '#ffffff');
      for (let i = 0; i < f.stocks; i++) { ctx.beginPath(); ctx.arc(x + 66 * s + i * 13 * s, y + 13 * s, 4.5 * s, 0, TAU); ctx.fillStyle = palOf(f).primary; ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke(); }
    }
    const secs = Math.max(0, Math.ceil(m.timer / 60));
    ctx.font = `900 ${Math.round(22 * s)}px ${DISPLAY}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    outlineText(ctx, `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`, W / 2, 12 * s, '#ffffff');
    if (!m.cpuBoth) { ctx.font = `700 ${Math.round(12 * s)}px ${FONT}`; ctx.textAlign = 'left'; outlineText(ctx, `SCORE ${state.score.toLocaleString('en-US')}`, 16 * s, 14 * s, '#cfe6ff'); }
    drawCombo(ctx, state, W, H, s, k);
  }

  function drawAttractHud(ctx, state, W, H) {
    const s = clamp(W / 900, 0.6, 1.5);
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(0, 0, W, H);
    ctx.font = `italic 900 ${Math.round(14 * s)}px ${DISPLAY}`; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    outlineText(ctx, 'EXHIBITION MATCH', W - 16 * s, H - 14 * s, 'rgba(255,255,255,.7)');
  }

  function drawBanner(ctx, state, W, H) {
    const b = state.banner;
    if (!b) return;
    const age = state.frame - b.at, s = clamp(W / 900, 0.6, 1.6);
    const dur = { round: 70, fight: 40, ko: 120, perfect: 110, time: 100, finish: 330, flourish: 200, match: 400 }[b.kind] || 90;
    if (age > dur) return;
    const pop = age < 8 ? 1.6 - ease(age / 8) * 0.6 : 1, a = age > dur - 12 ? (dur - age) / 12 : 1;
    const color = { ko: '#ff3a2a', perfect: '#ffd23a', finish: '#ff4a8a', flourish: '#ffd23a', fight: '#ffe14a', match: '#ffffff', time: '#ffffff' }[b.kind] || '#ffffff';
    const size = { ko: 110, fight: 92, round: 70, perfect: 84, finish: 96, match: 46, flourish: 52, time: 70 }[b.kind] || 70;
    ctx.save(); ctx.globalAlpha = clamp(a, 0, 1);
    ctx.translate(W / 2, H * (b.kind === 'match' ? 0.36 : 0.42)); ctx.scale(pop, pop); ctx.rotate(-0.04);
    ctx.font = `italic 900 ${Math.round(size * s)}px ${DISPLAY}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const g = ctx.createLinearGradient(0, -size * s / 2, 0, size * s / 2);
    g.addColorStop(0, lightHex(color, 0.5)); g.addColorStop(0.5, color); g.addColorStop(1, shadeHex(color, 0.4));
    ctx.lineWidth = 10 * s; ctx.strokeStyle = '#120812'; ctx.lineJoin = 'round'; ctx.strokeText(b.text, 0, 0);
    ctx.fillStyle = g; ctx.fillText(b.text, 0, 0);
    if (b.sub) {
      ctx.rotate(0.04); ctx.font = `italic 700 ${Math.round(17 * s)}px ${FONT}`;
      const lines = wrap(ctx, b.kind === 'match' ? `"${b.sub}"` : b.sub, W * 0.7);
      lines.forEach((l, i) => outlineText(ctx, l, 0, size * s * 0.62 + i * 22 * s, '#fff6dc', 5));
    }
    ctx.restore();
  }

  function drawCutIn(ctx, state, W, H) {
    const f = state.fighters[state.flash.slot], age = 36 - state.flash.t, s = clamp(W / 900, 0.6, 1.6);
    const slide = ease(clamp(age / 8, 0, 1)), y = H * 0.18, h = 90 * s;
    ctx.save();
    ctx.translate(0, y);
    ctx.fillStyle = `${palOf(f).accent}dd`;
    ctx.beginPath(); ctx.moveTo(-40 + (1 - slide) * W * (f.slot ? 1 : -1), 0); ctx.lineTo(W + 40 + (1 - slide) * W * (f.slot ? 1 : -1), -20 * s); ctx.lineTo(W + 40, h - 20 * s); ctx.lineTo(-40, h); ctx.closePath(); ctx.fill();
    for (let i = 0; i < 8; i++) { ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(((fx.time * 18 + i * 140) % (W + 200)) - 100, 10 * s + i * 9 * s, 80 * s, 2 * s); }
    ctx.font = `italic 900 ${Math.round(38 * s)}px ${DISPLAY}`; ctx.textAlign = f.slot ? 'right' : 'left'; ctx.textBaseline = 'middle';
    outlineText(ctx, roster[f.fid].moves.super.name.toUpperCase(), f.slot ? W - 40 * s : 40 * s, h * 0.42, '#ffffff', 7);
    ctx.restore();
  }

  // ---------- menus ----------
  function backdrop(ctx, W, H, stageIdx, dim = 0.55) {
    const st = content.stages[stageIdx] || content.stages[0], img = stageImage(st, art);
    if (img) { const sc = Math.max(W / img.width, H / img.height); ctx.drawImage(img, (W - img.width * sc) / 2, (H - img.height * sc) / 2, img.width * sc, img.height * sc); }
    else { const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#1a1438'); g.addColorStop(1, '#3a1a3a'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
    ctx.fillStyle = `rgba(8,6,20,${dim})`; ctx.fillRect(0, 0, W, H);
  }
  function bigFighter(ctx, fid, x, y, size, facing, st = 'idle', t = fx.time, mirror = false) {
    const F = roster[fid], pose = poseFor({ st, t, idleT: fx.time + fid * 20, winPose: fid, walk: 1, jumpVy: 0 });
    ctx.save(); ctx.translate(x, y); ctx.scale(facing * size / 100 * F.phys.scale, size / 100 * F.phys.scale);
    drawFighter(ctx, pose, { pal: mirror ? pals[fid].mirror : pals[fid].base, ...look(fid), face: st === 'win' ? 'calm' : 'fight', time: fx.time });
    ctx.restore();
  }

  function drawMenu(ctx, state, W, H) {
    const s = clamp(Math.min(W / 900, H / 560), 0.55, 1.6);
    backdrop(ctx, W, H, game.stageIdx.get(content.boss.stage) ?? 0, 0.45);
    bigFighter(ctx, game.selectable[0] ?? 0, W * 0.2, H * 0.96, H * 0.62, 1);
    if (game.bossIdx != null) bigFighter(ctx, game.bossIdx, W * 0.8, H * 0.96, H * 0.66, -1);
    ctx.save(); ctx.translate(W / 2, H * 0.24); ctx.rotate(-0.04);
    ctx.font = `italic 900 ${Math.round(64 * s)}px ${DISPLAY}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const g = ctx.createLinearGradient(0, -36 * s, 0, 36 * s); g.addColorStop(0, '#fff6b0'); g.addColorStop(0.5, '#ffb52a'); g.addColorStop(1, '#c84a1a');
    ctx.lineWidth = 12 * s; ctx.strokeStyle = '#1a0610'; ctx.lineJoin = 'round'; ctx.strokeText(content.title.toUpperCase(), 0, 0); ctx.fillStyle = g; ctx.fillText(content.title.toUpperCase(), 0, 0);
    ctx.restore();
    const items = ['ARCADE', 'VERSUS CPU'], sub = ['Climb the ladder to the final boss', 'One match, your pick of rival and level'];
    items.forEach((label, i) => {
      const y = H * 0.5 + i * 62 * s, on = state.menu.cursor === i, w = 300 * s;
      ctx.fillStyle = on ? 'rgba(255,190,60,.92)' : 'rgba(10,8,24,.72)';
      ctx.beginPath(); ctx.moveTo(W / 2 - w / 2 + 14 * s, y - 24 * s); ctx.lineTo(W / 2 + w / 2 + 14 * s, y - 24 * s); ctx.lineTo(W / 2 + w / 2 - 14 * s, y + 24 * s); ctx.lineTo(W / 2 - w / 2 - 14 * s, y + 24 * s); ctx.closePath(); ctx.fill();
      ctx.font = `italic 900 ${Math.round(26 * s)}px ${DISPLAY}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      outlineText(ctx, label, W / 2, y - 3 * s, on ? '#1a0a00' : '#ffffff', on ? 0 : 4);
      if (on) { ctx.font = `600 ${Math.round(12 * s)}px ${FONT}`; ctx.fillStyle = '#3a1a00'; ctx.fillText(sub[i], W / 2, y + 14 * s); }
    });
    hint(ctx, W, H, s, 'Arrows choose   ·   Space / Z confirm');
  }

  function drawSelect(ctx, state, W, H) {
    const s = clamp(Math.min(W / 900, H / 560), 0.55, 1.6), sel = state.sel;
    const list = sel.step === 'p1' ? game.selectable : roster.map((_, i) => i);
    const hover = sel.step === 'level' ? sel.cpu : list[sel.cursor];
    const F = roster[hover];
    backdrop(ctx, W, H, game.stageIdx.get(F.fighter.stage) ?? 0, 0.62);
    ctx.font = `italic 900 ${Math.round(30 * s)}px ${DISPLAY}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    outlineText(ctx, sel.step === 'p1' ? 'SELECT YOUR FIGHTER' : sel.step === 'cpu' ? 'CHOOSE YOUR OPPONENT' : 'CPU LEVEL', W / 2, 14 * s, sel.step === 'p1' ? '#ffd23a' : '#ff7a6a', 6);
    // Big preview with stats.
    const mirror = sel.step !== 'p1' && hover === sel.p1;
    bigFighter(ctx, hover, W * 0.24, H * 0.74, H * 0.5, 1, 'idle', fx.time, mirror);
    if (sel.p1 != null && sel.step !== 'p1') bigFighter(ctx, sel.p1, W * 0.08, H * 0.74, H * 0.32, 1, 'idle');
    const px = W * 0.46, py = H * 0.15, pw = W * 0.5;
    ctx.fillStyle = 'rgba(10,8,24,.78)'; roundRect(ctx, px, py, pw, H * 0.5, 12 * s); ctx.fill();
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.font = `italic 900 ${Math.round(28 * s)}px ${DISPLAY}`; outlineText(ctx, F.name.toUpperCase(), px + 16 * s, py + 12 * s, '#ffffff');
    ctx.font = `700 ${Math.round(11 * s)}px ${FONT}`; ctx.fillStyle = '#ffd23a'; ctx.fillText(`${F.style.toUpperCase()}  ·  ${F.build.toUpperCase()}${hover === game.bossIdx ? '  ·  BOSS' : ''}`, px + 16 * s, py + 46 * s);
    const st = F.fighter.stats, bars = [['HEALTH', (st.health - 700) / 600], ['SPEED', st.walkSpeed / 10], ['JUMP', st.jump / 10], ['WEIGHT', st.weight / 10]];
    bars.forEach(([label, v], i) => {
      const by = py + 66 * s + i * 17 * s;
      ctx.font = `700 ${Math.round(10 * s)}px ${FONT}`; ctx.fillStyle = '#cfd6ff'; ctx.fillText(label, px + 16 * s, by);
      ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(px + 80 * s, by + 2 * s, pw * 0.34, 8 * s);
      ctx.fillStyle = '#5ad0ff'; ctx.fillRect(px + 80 * s, by + 2 * s, pw * 0.34 * clamp(v, 0.05, 1), 8 * s);
    });
    const mx = px + 16 * s + pw * 0.34 + 80 * s;
    ctx.font = `700 ${Math.round(10 * s)}px ${FONT}`; ctx.fillStyle = '#ffd23a'; ctx.fillText('MOVES', Math.min(mx, px + pw * 0.62), py + 66 * s);
    const moves = [...F.fighter.specials.map(sp => [sp.name, `${MOTION_TEXT[sp.motion]} + A/B${sp.archetype === 'air_dive' ? ' (air)' : ''}`]), [F.fighter.super.name, `${MOTION_TEXT.qcf2} + B`], ['Throw', '→ + A+B']];
    moves.forEach(([n, mo], i) => {
      const yy = py + 82 * s + i * 15 * s, xx = Math.min(mx, px + pw * 0.62);
      ctx.font = `700 ${Math.round(10.5 * s)}px ${FONT}`; ctx.fillStyle = '#ffffff'; ctx.fillText(n, xx, yy);
      ctx.font = `600 ${Math.round(10.5 * s)}px ${FONT}`; ctx.fillStyle = '#9ad8ff'; ctx.textAlign = 'right'; ctx.fillText(mo, px + pw - 14 * s, yy); ctx.textAlign = 'left';
    });
    ctx.font = `italic 600 ${Math.round(12 * s)}px ${FONT}`; ctx.fillStyle = '#f0e6d0';
    wrap(ctx, F.fighter.intro, pw - 32 * s).slice(0, 3).forEach((l, i) => ctx.fillText(l, px + 16 * s, py + H * 0.5 - 52 * s + i * 15 * s));
    // Portrait grid.
    const cols = Math.min(8, list.length), cw = Math.min(84 * s, (W - 40 * s) / cols - 8 * s), ch = cw * 1.1, gx = W / 2 - (cols * (cw + 8 * s) - 8 * s) / 2, gy = H - ch - 40 * s;
    list.forEach((fid, i) => {
      const x = gx + (i % cols) * (cw + 8 * s), y = gy - Math.floor(i / cols) * (ch + 8 * s), on = i === sel.cursor && sel.step !== 'level';
      ctx.save(); roundRect(ctx, x, y, cw, ch, 8 * s); ctx.fillStyle = on ? (sel.step === 'p1' ? '#ffb52a' : '#ff5a4a') : 'rgba(20,16,40,.85)'; ctx.fill(); ctx.clip();
      const pal = pals[fid].base;
      const g = ctx.createLinearGradient(x, y, x, y + ch); g.addColorStop(0, `${pal.accent}55`); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(x, y, cw, ch);
      ctx.translate(x + cw / 2, y + ch * 1.72); ctx.scale(cw / 62 * roster[fid].phys.scale, cw / 62 * roster[fid].phys.scale);
      drawFighter(ctx, { ...POSES.guard, sN: 20, eN: 40, sF: 10, eF: 40, lean: 4, head: -4 }, { pal, ...look(fid), face: on ? 'fight' : 'calm', time: fx.time });
      ctx.restore();
      ctx.lineWidth = on ? 3 * s : 1.5; ctx.strokeStyle = on ? '#ffffff' : 'rgba(255,255,255,.25)'; roundRect(ctx, x, y, cw, ch, 8 * s); ctx.stroke();
      if (fid === game.bossIdx) { ctx.font = `900 ${Math.round(9 * s)}px ${FONT}`; ctx.textAlign = 'center'; outlineText(ctx, 'BOSS', x + cw / 2, y + 4 * s, '#ffd23a', 3); }
    });
    if (sel.step === 'level') {
      const y = H * 0.7, lv = sel.level;
      ctx.fillStyle = 'rgba(10,8,24,.85)'; roundRect(ctx, W / 2 - 160 * s, y - 34 * s, 320 * s, 68 * s, 12 * s); ctx.fill();
      ctx.font = `italic 900 ${Math.round(34 * s)}px ${DISPLAY}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      outlineText(ctx, `◀  ${lv} ${LEVEL_NAMES[lv].toUpperCase()}  ▶`, W / 2, y, '#ffd23a', 6);
    }
    hint(ctx, W, H, s, sel.step === 'level' ? '← → level   ·   Space / Z fight   ·   X back' : 'Arrows move   ·   Space / Z select   ·   X back');
  }

  function drawVs(ctx, state, W, H) {
    const v = state.vs, s = clamp(Math.min(W / 900, H / 560), 0.55, 1.6), age = state.pt;
    const p1 = roster[v.p1], p2 = roster[v.p2], slide = ease(clamp(age / 18, 0, 1));
    backdrop(ctx, W, H, v.stage, 0.3);
    ctx.save();
    ctx.fillStyle = `${pals[v.p1].base.accent}cc`; ctx.beginPath(); ctx.moveTo(-W * (1 - slide), 0); ctx.lineTo(W * 0.56 - W * (1 - slide), 0); ctx.lineTo(W * 0.44 - W * (1 - slide), H); ctx.lineTo(-W * (1 - slide), H); ctx.closePath(); ctx.fill();
    ctx.fillStyle = `${(v.p1 === v.p2 ? pals[v.p2].mirror : pals[v.p2].base).accent}cc`; ctx.beginPath(); ctx.moveTo(W * 0.56 + W * (1 - slide), 0); ctx.lineTo(W * 2, 0); ctx.lineTo(W * 2, H); ctx.lineTo(W * 0.44 + W * (1 - slide), H); ctx.closePath(); ctx.fill();
    ctx.restore();
    bigFighter(ctx, v.p1, W * 0.25 - W * (1 - slide), H * 0.92, H * 0.66, 1, 'win', age);
    bigFighter(ctx, v.p2, W * 0.75 + W * (1 - slide), H * 0.92, H * 0.66, -1, 'idle', age, v.p1 === v.p2);
    ctx.font = `italic 900 ${Math.round(30 * s)}px ${DISPLAY}`; ctx.textBaseline = 'top';
    ctx.textAlign = 'left'; outlineText(ctx, p1.name.toUpperCase(), 24 * s, 24 * s, '#ffffff', 6);
    ctx.textAlign = 'right'; outlineText(ctx, p2.name.toUpperCase(), W - 24 * s, 24 * s, '#ffffff', 6);
    const vsPop = age < 20 ? 0 : 1 + Math.max(0, 0.8 - (age - 20) * 0.08);
    if (vsPop) {
      ctx.save(); ctx.translate(W / 2, H * 0.45); ctx.scale(vsPop, vsPop); ctx.rotate(-0.08);
      ctx.font = `italic 900 ${Math.round(110 * s)}px ${DISPLAY}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const g = ctx.createLinearGradient(0, -50 * s, 0, 50 * s); g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, '#ffd23a'); g.addColorStop(1, '#e8501a');
      ctx.lineWidth = 14 * s; ctx.strokeStyle = '#140610'; ctx.strokeText('VS', 0, 0); ctx.fillStyle = g; ctx.fillText('VS', 0, 0);
      ctx.restore();
    }
    const stage = content.stages[v.stage];
    ctx.fillStyle = 'rgba(8,6,20,.8)'; ctx.fillRect(0, H - 54 * s, W, 54 * s);
    ctx.font = `italic 800 ${Math.round(15 * s)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tag = v.boss ? 'FINAL BOSS' : v.of ? `STAGE ${v.rung + 1} OF ${v.of}` : `${LEVEL_NAMES[v.level].toUpperCase()} CPU`;
    outlineText(ctx, `${tag}   ·   ${stage?.name?.toUpperCase() || ''}`, W / 2, H - 38 * s, '#ffd23a');
    ctx.font = `italic 600 ${Math.round(12 * s)}px ${FONT}`; ctx.fillStyle = '#f0e6d0'; ctx.fillText(p2.fighter.intro, W / 2, H - 17 * s);
  }

  function drawContinue(ctx, state, W, H) {
    const s = clamp(Math.min(W / 900, H / 560), 0.55, 1.6), left = Math.max(0, 9 - Math.floor(state.pt / 60));
    backdrop(ctx, W, H, state.vs?.stage ?? 0, 0.75);
    bigFighter(ctx, state.arcade.p1, W / 2, H * 0.95, H * 0.5, 1, 'dazed');
    ctx.font = `italic 900 ${Math.round(56 * s)}px ${DISPLAY}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    outlineText(ctx, 'CONTINUE?', W / 2, H * 0.2, '#ffffff', 8);
    const pop = 1 + (1 - (state.pt % 60) / 60) * 0.3;
    ctx.save(); ctx.translate(W / 2, H * 0.4); ctx.scale(pop, pop); ctx.font = `900 ${Math.round(90 * s)}px ${DISPLAY}`; outlineText(ctx, String(left), 0, 0, '#ffd23a', 10); ctx.restore();
    hint(ctx, W, H, s, 'Space / Z continue   ·   X give up');
  }

  function drawEnding(ctx, state, W, H) {
    const s = clamp(Math.min(W / 900, H / 560), 0.55, 1.6), fid = state.arcade.p1, F = roster[fid];
    backdrop(ctx, W, H, game.stageIdx.get(F.fighter.stage) ?? 0, 0.4);
    bigFighter(ctx, fid, W * 0.28, H * 0.95, H * 0.7, 1, 'win', state.pt);
    const px = W * 0.48, pw = W * 0.46, a = clamp(state.pt / 40, 0, 1);
    ctx.save(); ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(8,6,20,.82)'; roundRect(ctx, px, H * 0.22, pw, H * 0.46, 12 * s); ctx.fill();
    ctx.font = `italic 900 ${Math.round(28 * s)}px ${DISPLAY}`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    outlineText(ctx, `${F.name.toUpperCase()}'S ENDING`, px + 18 * s, H * 0.22 + 14 * s, '#ffd23a');
    ctx.font = `italic 600 ${Math.round(15 * s)}px ${FONT}`; ctx.fillStyle = '#fff6e0';
    const chars = Math.floor(Math.max(0, state.pt - 30) * 1.6);
    wrap(ctx, F.fighter.ending.slice(0, chars), pw - 36 * s).forEach((l, i) => ctx.fillText(l, px + 18 * s, H * 0.22 + 56 * s + i * 21 * s));
    ctx.restore();
    if (state.pt > 120) { ctx.font = `italic 900 ${Math.round(40 * s)}px ${DISPLAY}`; ctx.textAlign = 'center'; outlineText(ctx, 'CHAMPION', px + pw / 2, H * 0.8, '#ffffff', 7); }
  }

  render.fx = fx;
  return render;
}

// ---------- drawing helpers ----------
function ease(t) { return t * t * (3 - 2 * t); }
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function outlineText(ctx, text, x, y, color, width = 4) {
  if (width) { ctx.lineWidth = width; ctx.strokeStyle = '#100810'; ctx.lineJoin = 'round'; ctx.strokeText(text, x, y); }
  ctx.fillStyle = color; ctx.fillText(text, x, y);
}
function wrap(ctx, text, max) {
  const words = String(text || '').split(/\s+/), out = []; let line = '';
  for (const w of words) { const t = line ? `${line} ${w}` : w; if (ctx.measureText(t).width > max && line) { out.push(line); line = w; } else line = t; }
  if (line) out.push(line);
  return out;
}
function hint(ctx, W, H, s, text) {
  ctx.font = `600 ${Math.round(12 * s)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fillText(text, W / 2, H - 10 * s);
}
