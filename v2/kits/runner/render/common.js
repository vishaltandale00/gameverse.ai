// Shared drawing for every runner mode: image cache, tile patterns, the
// particle system (juice.js bursts in screen pixels), shake and flashes,
// popups and mission toasts, the hero drawn from art.frames, and the HUD.
// Visual state only; nothing here touches game state.
import { createParticles, stepParticles, addParticles, dustBurst, sparkleBurst, sparkBurst, debrisBurst, confettiBurst, paletteFrom, rand, hexToRgb } from '../../../engine/juice.js';

export const TAU = Math.PI * 2;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const ease = t => 1 - (1 - clamp(t, 0, 1)) ** 3;
export const rgba = (hex, a) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };
export const mixHex = (a, b, t) => { const A = hexToRgb(a), B = hexToRgb(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`; };
const FONTS = { pixel: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', serif: 'Georgia, "Times New Roman", serif', hand: '"Comic Sans MS", "Chalkboard SE", "Marker Felt", cursive', bold: '"Avenir Next", "Helvetica Neue", Arial, sans-serif', rounded: '"Avenir Next", "Nunito", ui-rounded, "SF Pro Rounded", "Segoe UI", system-ui, sans-serif' };

// ---------- images ----------
const images = new Map();
export function image(url) {
  if (!url || typeof globalThis.Image !== 'function') return null;
  let img = images.get(url);
  if (!img) { img = new Image(); img.decoding = 'async'; img.src = url; images.set(url, img); }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

/** Visual context shared by mode renderers. */
export function createLook(game, art) {
  const content = game.content, dir = art.direction || {};
  const pal = paletteFrom(content.background);
  const tiles = dir.tiles || {}, scen = dir.scenery || {};
  const theme = scen.theme || themeFromText(`${content.title} ${content.artStyle}`);
  const time = scen.time || (/night|neon|dark/i.test(content.artStyle) ? 'night' : /sunset|dusk/i.test(content.artStyle) ? 'sunset' : 'day');
  const hero = dir.player?.colors || { primary: '#3a7bd5', secondary: '#f2d2a9', accent: '#d63c3c', eye: '#1f8a4c' };
  const foe = dir.enemy?.colors || { primary: '#6a7080', secondary: '#c8ccd8', accent: '#ff5a5a', eye: '#ff3b3b' };
  return {
    content, art, pal, theme, time, night: time === 'night' || theme === 'space' || theme === 'cave',
    font: FONTS[art.font || dir.font] || FONTS.rounded,
    ground: tiles.groundColor || '#6a4a2b', surface: tiles.surfaceColor || '#5fbf4a', platform: tiles.platformColor || '#c0603a',
    hero, foe, coinColor: dir.pickup?.color || '#f5c542', hazardColor: dir.hazard?.color || '#ff5a3a', goalColor: dir.goal?.color || '#9b5cff',
    pixel: /pixel/i.test(art.style || ''),
  };
}
function themeFromText(text) {
  const t = text.toLowerCase();
  for (const [k, re] of [['city', /city|urban|street|rooftop|rail|yard|neon/], ['space', /space|galax|star/], ['snow', /snow|ice|frost/], ['desert', /desert|sand/], ['haunted', /haunt|ghost|marsh|spook/], ['sky', /sky|cloud/], ['factory', /factory|cyber|circuit|tech/], ['forest', /forest|wood/], ['meadow', /meadow|farm|country/]]) if (re.test(t)) return k;
  return 'meadow';
}

// ---------- tile patterns ----------
const patterns = new WeakMap();
/** A CanvasPattern for one tileset cell (groundTop, groundFill, platform, wall), or null. */
export function tilePattern(ctx, art, cell) {
  const ts = art.tileset, img = image(ts?.url);
  if (!img || typeof document === 'undefined') return null;
  let byImg = patterns.get(img);
  if (!byImg) patterns.set(img, byImg = {});
  if (byImg[cell] !== undefined) return byImg[cell];
  const [cx, cy] = ts.cells?.[cell] || [0, 0], cols = ts.cols || 2, rows = ts.rows || 2, inset = ts.inset || 0;
  const cw = img.naturalWidth / cols, ch = img.naturalHeight / rows;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.drawImage(img, cx * cw + inset * cw, cy * ch + inset * ch, cw * (1 - 2 * inset), ch * (1 - 2 * inset), 0, 0, 64, 64);
  byImg[cell] = ctx.createPattern(c, 'repeat');
  return byImg[cell];
}
/** Fill a rect with a tile pattern scaled so one cell is `unit` px, anchored at (ox, oy). */
export function fillTiles(ctx, pattern, x, y, w, h, unit, ox = 0, oy = 0) {
  if (pattern.setTransform && typeof DOMMatrix === 'function') pattern.setTransform(new DOMMatrix([unit / 64, 0, 0, unit / 64, ox, oy]));
  ctx.fillStyle = pattern; ctx.fillRect(x, y, w, h);
}

// ---------- effects ----------
export function createFx(seed) {
  return { parts: createParticles(900), r: rand(seed || 1), trauma: 0, flash: null, popups: [], toasts: [], clock: 0, deathAt: null, nearAt: -9, powerAt: -9, state: null, coinPop: 0, lastScore: 0, shown: 0 };
}
/** Add juice bursts given in unit coords at screen (x, y) with `u` px per unit; world=true scrolls with the world. */
export function burst(fx, list, x, y, u, world = false) {
  for (const p of list) { p.x = x + p.x * u; p.y = y + p.y * u; p.vx *= u; p.vy *= u; p.g *= u; p.size *= u; p.grow *= u; p.w = world; }
  addParticles(fx.parts, list);
}
export const bursts = { dust: dustBurst, sparkle: sparkleBurst, spark: sparkBurst, debris: debrisBurst, confetti: confettiBurst };
export function stepFx(fx, dt, shiftX = 0, shiftY = 0) {
  if (shiftX || shiftY) for (const p of fx.parts.list) if (p.w) { p.x -= shiftX; p.y -= shiftY; }
  stepParticles(fx.parts, dt);
  fx.trauma = Math.max(0, fx.trauma - dt * 1.6);
  for (const p of fx.popups) p.t += dt;
  fx.popups = fx.popups.filter(p => p.t < p.life);
  for (const t of fx.toasts) t.t += dt;
  fx.toasts = fx.toasts.filter(t => t.t < 2.8);
  if (fx.flash) { fx.flash.t += dt; if (fx.flash.t > fx.flash.life) fx.flash = null; }
  fx.coinPop = Math.max(0, fx.coinPop - dt * 4);
}
export function drawParticles(ctx, fx) {
  for (const p of fx.parts.list) {
    const k = p.life / p.max, s = Math.max(0.5, p.size + p.grow * (1 - k));
    ctx.globalAlpha = clamp(k * 1.4, 0, 1);
    ctx.globalCompositeOperation = p.add ? 'lighter' : 'source-over';
    ctx.fillStyle = p.color; ctx.strokeStyle = p.color;
    if (p.shape === 'ring') { ctx.lineWidth = Math.max(1, s * 0.15); ctx.beginPath(); ctx.arc(p.x, p.y, s, 0, TAU); ctx.stroke(); }
    else if (p.shape === 'star') { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); star(ctx, s, s * 0.42, 4); ctx.fill(); ctx.restore(); }
    else if (p.shape === 'spark' || p.shape === 'line') { ctx.lineWidth = Math.max(1, s * 0.6); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); ctx.stroke(); }
    else if (p.shape === 'square' || p.shape === 'confetti') { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillRect(-s / 2, -s / (p.shape === 'confetti' ? 4 : 2), s, p.shape === 'confetti' ? s / 2 : s); ctx.restore(); }
    else { ctx.beginPath(); ctx.arc(p.x, p.y, s, 0, TAU); ctx.fill(); }
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}
export function star(ctx, R, r, n = 5) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + (i * Math.PI) / n, rr = i % 2 ? r : R; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  ctx.closePath();
}
export function shake(fx, reduced) {
  if (reduced || fx.trauma <= 0) return [0, 0];
  const t = fx.clock * 60, k = fx.trauma * fx.trauma * 14;
  return [Math.sin(t * 1.7) * k + Math.sin(t * 3.1) * k * 0.4, Math.cos(t * 1.3) * k + Math.sin(t * 2.3) * k * 0.4];
}
export const popup = (fx, text, x, y, color = '#fff', size = 1, life = 0.9) => fx.popups.push({ text, x, y, color, size, t: 0, life });
export const toast = (fx, title, body, color) => { fx.toasts.push({ title, body, color, t: 0 }); if (fx.toasts.length > 3) fx.toasts.shift(); };
export const flash = (fx, color, life = 0.25, alpha = 0.5) => { fx.flash = { color, life, alpha, t: 0 }; };

export function text(ctx, str, x, y, size, color, { align = 'center', font, weight = 800, stroke = 'rgba(0,0,0,.55)', base = 'middle' } = {}) {
  ctx.font = `${weight} ${Math.round(size)}px ${font}`;
  ctx.textAlign = align; ctx.textBaseline = base;
  if (stroke) { ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2, size * 0.16); ctx.strokeStyle = stroke; ctx.strokeText(str, x, y); }
  ctx.fillStyle = color; ctx.fillText(str, x, y);
}
export function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

export function drawOverlays(ctx, fx, look, w, h, reduced) {
  for (const p of fx.popups) {
    const k = p.t / p.life, rise = ease(Math.min(1, p.t / 0.5)) * 34;
    ctx.globalAlpha = 1 - Math.max(0, (k - 0.6) / 0.4);
    const pop = reduced ? 1 : 1 + 0.4 * Math.max(0, 1 - p.t / 0.15);
    text(ctx, p.text, p.x, p.y - rise, 18 * p.size * pop, p.color, { font: look.font });
  }
  ctx.globalAlpha = 1;
  if (fx.flash) {
    const k = 1 - fx.flash.t / fx.flash.life;
    ctx.fillStyle = rgba(fx.flash.color, fx.flash.alpha * k * (reduced ? 0.5 : 1));
    ctx.fillRect(0, 0, w, h);
  }
  // Mission toasts slide in from the top.
  fx.toasts.forEach((t, i) => {
    const inK = ease(t.t / 0.3), outK = t.t > 2.4 ? ease((t.t - 2.4) / 0.4) : 0;
    const bw = Math.min(w - 32, 360), bh = 50, x = (w - bw) / 2, y = 64 + i * 58 - (1 - inK + outK) * 90;
    ctx.globalAlpha = 1 - outK;
    roundRect(ctx, x, y, bw, bh, 14); ctx.fillStyle = look.pal.panel; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = t.color || look.pal.accent; ctx.stroke();
    ctx.fillStyle = t.color || look.pal.accent; ctx.beginPath(); ctx.arc(x + 26, y + bh / 2, 12, 0, TAU); ctx.fill();
    ctx.strokeStyle = look.pal.accentInk; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x + 20, y + bh / 2); ctx.lineTo(x + 25, y + bh / 2 + 5); ctx.lineTo(x + 33, y + bh / 2 - 5); ctx.stroke();
    text(ctx, t.title, x + 48, y + 17, 12, look.pal.muted, { align: 'left', font: look.font, weight: 700, stroke: null });
    text(ctx, t.body, x + 48, y + 34, 16, look.pal.ink, { align: 'left', font: look.font, stroke: null });
    ctx.globalAlpha = 1;
  });
}

/** React to this frame's game events with particles, shake, popups and toasts. at(e) gives a screen point. */
export function onEvents(fx, events, look, { hero, unit, reduced }) {
  const r = fx.r, pal = look.pal;
  for (const e of events) {
    switch (e.name) {
      case 'collect': burst(fx, sparkleBurst(0, 0, r, look.coinColor, 8), hero.x, hero.y - unit * 0.6, unit * 0.5, true); fx.coinPop = 1; if (e.combo >= 3) popup(fx, `x${e.combo}`, hero.x + unit * 0.6, hero.y - unit * 1.6, look.coinColor, 0.8, 0.6); break;
      case 'combo': popup(fx, `${e.n} COMBO`, hero.x, hero.y - unit * 2.4, pal.accent, 1.3); break;
      case 'near_miss': fx.nearAt = fx.clock; popup(fx, `CLOSE! +${look.content.scoring.nearMiss}`, hero.x, hero.y - unit * 2, '#ffffff', 1.1); if (!reduced) flash(fx, '#ffffff', 0.18, 0.22); fx.trauma = Math.min(1, fx.trauma + 0.12); break;
      case 'power': fx.powerAt = fx.clock; popup(fx, e.label || e.kind, hero.x, hero.y - unit * 2.2, pal.accent2, 1.3, 1.2); burst(fx, confettiBurst(0, 0, r, [pal.accent, pal.accent2, '#fff'], 28), hero.x, hero.y - unit, unit * 0.45, true); flash(fx, pal.accent2, 0.3, 0.3); break;
      case 'shield': popup(fx, 'SAVED!', hero.x, hero.y - unit * 2, pal.accent2, 1.3); burst(fx, sparkBurst(0, 0, r, '#bfefff', 16), hero.x, hero.y - unit * 0.8, unit * 0.6, true); fx.trauma = Math.min(1, fx.trauma + 0.5); break;
      case 'hurt': case 'stumble': fx.trauma = Math.min(1, fx.trauma + 0.55); burst(fx, sparkBurst(0, 0, r, '#ffe1e1', 12), hero.x, hero.y - unit * 0.8, unit * 0.6, true); flash(fx, '#ff3b3b', 0.3, 0.35); if (e.name === 'stumble') popup(fx, 'STUMBLE!', hero.x, hero.y - unit * 2, '#ffb0a0', 1.1); break;
      case 'hit': case 'crate': fx.trauma = Math.min(1, fx.trauma + 0.3); burst(fx, debrisBurst(0, 0, r, '#c89a5a', 10), hero.x + unit * 0.6, hero.y - unit * 0.5, unit * 0.5, true); break;
      case 'land': burst(fx, dustBurst(0, 0, e.impact ?? 0.5, r), hero.x, hero.y, unit * 0.55, true); break;
      case 'jump': if (look.content.mode !== 'flap') burst(fx, dustBurst(0, 0, 0.2, r), hero.x, hero.y, unit * 0.4, true); break;
      case 'defeated': fx.trauma = Math.min(1, fx.trauma + 0.3); popup(fx, '+50', hero.x, hero.y - unit * 2, pal.accent, 1); break;
      case 'mission': toast(fx, 'Mission complete', e.label, pal.accent); break;
      case 'level_up': toast(fx, 'All missions done', `Score multiplier x${e.mult}`, pal.accent2); burst(fx, confettiBurst(0, 0, r, [pal.accent, pal.accent2, '#fff', pal.heart], 50), hero.x, hero.y - unit * 2, unit * 0.5); break;
      case 'lost': fx.deathAt = fx.clock; fx.trauma = 1; flash(fx, '#ff2a2a', 0.5, 0.45); burst(fx, debrisBurst(0, 0, r, look.hero.primary, 18), hero.x, hero.y - unit * 0.7, unit * 0.7, true); burst(fx, sparkBurst(0, 0, r, '#fff', 14), hero.x, hero.y - unit * 0.7, unit * 0.7, true); break;
      case 'won': burst(fx, confettiBurst(0, 0, r, [pal.accent, pal.accent2, '#fff', pal.heart], 90), hero.x, hero.y - unit * 2, unit * 0.6); toast(fx, 'Level complete', look.content.cast.goal.name, pal.accent); break;
      case 'warn': fx.warnAt = fx.clock; break;
      case 'life_lost': fx.lifeAt = fx.clock; popup(fx, `${e.lives} LEFT`, hero.x, hero.y - unit * 2.2, pal.heart, 1.2, 1.1); break;
      default: break;
    }
  }
}

// ---------- the hero ----------
const RUN = ['runA', 'runB', 'runC', 'runD'];
export const runPose = phase => RUN[((Math.floor(phase) % 4) + 4) % 4];
/**
 * Draw a character frame with its feet at (x, y), `size` px tall box, optional flip, rotation
 * (about the body centre), squash/stretch and alpha. Falls back to a code-drawn figure.
 */
export function drawCharacter(ctx, art, kind, pose, x, y, size, { flip = false, rot = 0, sx = 1, sy = 1, alpha = 1, colors, tint } = {}) {
  const frames = art.frames?.[kind];
  const url = frames?.[pose] || frames?.[pose === 'idleB' ? 'idle' : pose] || frames?.idle || art.sprites?.[kind];
  const img = image(url);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y - size * 0.47);
  if (rot) ctx.rotate(rot);
  ctx.scale((flip ? -1 : 1) * sx, sy);
  if (img) ctx.drawImage(img, -size / 2, -size * 0.5, size, size);
  else fallbackFigure(ctx, pose, size, colors || { primary: '#3a7bd5', secondary: '#f2d2a9', accent: '#d63c3c' });
  if (tint) { ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = tint; ctx.fillRect(-size / 2, -size / 2, size, size); }
  ctx.restore();
}
function fallbackFigure(ctx, pose, size, c) {
  const u = size / 100, t = { runA: 1, runB: 0, runC: -1, runD: 0 }[pose] ?? 0;
  ctx.lineCap = 'round'; ctx.lineWidth = 9 * u; ctx.strokeStyle = '#1b1b2a';
  const leg = (s) => { ctx.beginPath(); ctx.moveTo(0, 22 * u); ctx.lineTo(s * 16 * u, 46 * u); ctx.stroke(); };
  if (pose === 'jump') { leg(0.8); leg(-0.3); } else if (pose === 'fall') { leg(0.5); leg(-0.6); } else { leg(t); leg(-t); }
  ctx.fillStyle = c.primary; roundRect(ctx, -22 * u, -26 * u, 44 * u, 52 * u, 18 * u); ctx.fill(); ctx.lineWidth = 3 * u; ctx.stroke();
  ctx.fillStyle = c.secondary; ctx.beginPath(); ctx.ellipse(6 * u, -8 * u, 13 * u, 11 * u, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(10 * u, -12 * u, 6 * u, 0, TAU); ctx.fill();
  ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(12 * u, -12 * u, pose === 'hurt' ? 1.5 * u : 3 * u, 0, TAU); ctx.fill();
  ctx.fillStyle = c.accent; roundRect(ctx, -24 * u, -30 * u, 48 * u, 10 * u, 5 * u); ctx.fill();
}

export function shadow(ctx, x, y, w, alpha = 0.28) {
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.beginPath(); ctx.ellipse(x, y, w, w * 0.28, 0, 0, TAU); ctx.fill();
}

/** A pickup sprite with a spin (scaleX from cos) and glint; falls back to a code-drawn coin. */
export function drawCoin(ctx, art, look, x, y, r, t, alpha = 1) {
  const img = image(art.sprites?.coin), spin = Math.cos(t * 5);
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.scale(Math.max(0.18, Math.abs(spin)), 1);
  if (img) ctx.drawImage(img, -r, -r, r * 2, r * 2);
  else {
    ctx.fillStyle = look.coinColor; ctx.beginPath(); ctx.arc(0, 0, r * 0.85, 0, TAU); ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.16); ctx.strokeStyle = 'rgba(80,50,0,.6)'; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.ellipse(-r * 0.25, -r * 0.3, r * 0.22, r * 0.12, -0.6, 0, TAU); ctx.fill();
  }
  ctx.restore();
  if (spin > 0.93) { ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = 'rgba(255,250,210,.8)'; ctx.save(); ctx.translate(x + r * 0.35, y - r * 0.35); star(ctx, r * 0.45, r * 0.12, 4); ctx.fill(); ctx.restore(); ctx.globalCompositeOperation = 'source-over'; }
}
export function drawSprite(ctx, art, kind, x, y, size, { alpha = 1, rot = 0 } = {}) {
  const img = image(art.sprites?.[kind]);
  if (!img) return false;
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); if (rot) ctx.rotate(rot); ctx.drawImage(img, -size / 2, -size / 2, size, size); ctx.restore();
  return true;
}

/** Power-up icons drawn in code. */
export function powerIcon(ctx, kind, x, y, r, color) {
  ctx.save(); ctx.translate(x, y); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = Math.max(2, r * 0.22); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (kind === 'magnet') { ctx.beginPath(); ctx.arc(0, -r * 0.05, r * 0.5, Math.PI, 0); ctx.lineTo(r * 0.5, r * 0.5); ctx.moveTo(-r * 0.5, -r * 0.05); ctx.lineTo(-r * 0.5, r * 0.5); ctx.stroke(); }
  else if (kind === 'shield') { ctx.beginPath(); ctx.moveTo(0, -r * 0.6); ctx.lineTo(r * 0.5, -r * 0.35); ctx.quadraticCurveTo(r * 0.5, r * 0.35, 0, r * 0.62); ctx.quadraticCurveTo(-r * 0.5, r * 0.35, -r * 0.5, -r * 0.35); ctx.closePath(); ctx.stroke(); }
  else if (kind === 'jetpack') { ctx.beginPath(); ctx.moveTo(0, -r * 0.6); ctx.quadraticCurveTo(r * 0.45, 0, 0, r * 0.62); ctx.quadraticCurveTo(-r * 0.45, 0, 0, -r * 0.6); ctx.fill(); }
  else if (kind === 'multiplier') { ctx.font = `900 ${Math.round(r * 0.95)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('x2', 0, r * 0.05); }
  else if (kind === 'superjump') { ctx.beginPath(); ctx.moveTo(-r * 0.45, r * 0.15); ctx.lineTo(0, -r * 0.45); ctx.lineTo(r * 0.45, r * 0.15); ctx.moveTo(-r * 0.45, r * 0.55); ctx.lineTo(0, r * 0.05); ctx.lineTo(r * 0.45, r * 0.55); ctx.stroke(); }
  else { ctx.beginPath(); ctx.moveTo(-r * 0.4, -r * 0.55); ctx.lineTo(r * 0.4, -r * 0.55); ctx.lineTo(-r * 0.4, r * 0.55); ctx.lineTo(r * 0.4, r * 0.55); ctx.closePath(); ctx.stroke(); }
  ctx.restore();
}

/** Score, distance, coins, multiplier and power-up timers. */
export function drawHud(ctx, state, look, fx, w, h, { distanceLabel, progress } = {}) {
  const pal = look.pal, s = clamp(Math.min(w, h) / 560, 0.75, 1.35), pad = 14 * s;
  // Score block.
  const scoreStr = String(state.score);
  ctx.font = `900 ${Math.round(30 * s)}px ${look.font}`;
  const sw = Math.max(ctx.measureText(scoreStr).width, 80 * s) + 28 * s;
  roundRect(ctx, pad, pad, sw, 58 * s, 14 * s); ctx.fillStyle = pal.panel; ctx.fill();
  text(ctx, scoreStr, pad + 14 * s, pad + 22 * s, 28 * s, pal.ink, { align: 'left', font: look.font, weight: 900, stroke: null });
  text(ctx, distanceLabel, pad + 14 * s, pad + 45 * s, 13 * s, pal.muted, { align: 'left', font: look.font, weight: 700, stroke: null });
  // Lives, when the run has more than one.
  const maxLives = look.content.rules?.lives || 1;
  if (maxLives > 1) for (let i = 0; i < maxLives; i++) {
    const hx = pad + 12 * s + i * 22 * s, hy = pad + 72 * s, full = i < state.lives;
    const lost = !full && i === state.lives && fx.clock - (fx.lifeAt ?? -9) < 0.5;
    ctx.save(); ctx.translate(hx, hy); const k = lost ? 1 + (fx.clock - fx.lifeAt) * 1.5 : 1; ctx.scale(k * s, k * s);
    ctx.beginPath(); ctx.moveTo(0, 7); ctx.bezierCurveTo(-10, -1, -6, -9, 0, -4); ctx.bezierCurveTo(6, -9, 10, -1, 0, 7); ctx.closePath();
    ctx.fillStyle = full ? pal.heart : 'rgba(255,255,255,.18)'; ctx.globalAlpha = lost ? 1 - (fx.clock - fx.lifeAt) * 2 : 1; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = full ? pal.heartDark : 'rgba(255,255,255,.3)'; ctx.stroke(); ctx.restore();
  }
  // Coins.
  const cstr = String(state.coins), cw = 70 * s + cstr.length * 13 * s;
  const cx = w - pad - cw;
  roundRect(ctx, cx, pad, cw, 40 * s, 20 * s); ctx.fillStyle = pal.panel; ctx.fill();
  drawCoin(ctx, look.art, look, cx + 22 * s, pad + 20 * s, 13 * s * (1 + fx.coinPop * 0.35), fx.clock * 0.6);
  text(ctx, cstr, cx + 42 * s, pad + 21 * s, 20 * s * (1 + fx.coinPop * 0.15), fx.coinPop > 0.1 ? look.coinColor : pal.ink, { align: 'left', font: look.font, stroke: null });
  // Multiplier.
  const mult = state.mult * (state.powers?.multiplier > 0 ? 2 : 1);
  if (mult > 1) {
    const mx = cx - 58 * s;
    roundRect(ctx, mx, pad, 48 * s, 40 * s, 14 * s); ctx.fillStyle = pal.accent; ctx.fill();
    text(ctx, `x${mult}`, mx + 24 * s, pad + 21 * s, 19 * s, pal.accentInk, { font: look.font, weight: 900, stroke: null });
  }
  // Power-up timers as rings under the coin counter.
  let i = 0;
  for (const [kind, left] of Object.entries(state.powers || {})) {
    const max = look.content.powerups.find(p => p.kind === kind)?.seconds || 10;
    const r = 17 * s, x = w - pad - r - i * (r * 2 + 10 * s), y = pad + 40 * s + 14 * s + r;
    ctx.fillStyle = pal.panel; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = pal.accent2; ctx.lineWidth = 3.5 * s; ctx.beginPath(); ctx.arc(x, y, r - 2 * s, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(left / max, 0, 1)); ctx.stroke();
    const blink = left < 2 && Math.floor(fx.clock * 8) % 2 === 0;
    powerIcon(ctx, kind, x, y, r * 0.95, blink ? pal.muted : pal.ink);
    i++;
  }
  // Rhythm progress bar.
  if (progress != null) {
    const bw = Math.min(w * 0.42, 360), bx = (w - bw) / 2, by = pad + 6 * s;
    roundRect(ctx, bx, by, bw, 12 * s, 6 * s); ctx.fillStyle = pal.panel; ctx.fill();
    roundRect(ctx, bx + 2, by + 2, Math.max(4, (bw - 4) * clamp(progress, 0, 1)), 12 * s - 4, 4 * s); ctx.fillStyle = pal.accent; ctx.fill();
    text(ctx, `${Math.floor(progress * 100)}%`, w / 2, by + 28 * s, 14 * s, pal.ink, { font: look.font });
  }
}

/** Active missions, shown during the intro and on demand. */
export function drawMissions(ctx, state, look, w, h, alpha) {
  if (alpha <= 0 || !state.missions?.length) return;
  const s = clamp(Math.min(w, h) / 560, 0.75, 1.3), active = state.missions.filter(m => !m.done).slice(0, 3);
  ctx.globalAlpha = alpha;
  active.forEach((m, i) => {
    const y = h - 16 * s - (active.length - i) * 30 * s, x = 14 * s;
    roundRect(ctx, x, y, 230 * s, 25 * s, 12 * s); ctx.fillStyle = look.pal.panel; ctx.fill();
    text(ctx, m.label, x + 12 * s, y + 13 * s, 13 * s, look.pal.ink, { align: 'left', font: look.font, weight: 700, stroke: null });
  });
  ctx.globalAlpha = 1;
}

/** The run intro: title card and GO!, eased out over the first seconds. */
export function drawIntro(ctx, state, look, w, h, reduced) {
  const t = state.time;
  if (t > 1.8 || state.status !== 'playing') return;
  const k = t < 1.1 ? 1 : 1 - (t - 1.1) / 0.7;
  ctx.globalAlpha = clamp(k, 0, 1);
  const s = clamp(Math.min(w, h) / 560, 0.8, 1.4);
  const go = t > 0.75;
  const pop = reduced ? 1 : go ? 1 + 0.5 * Math.max(0, 1 - (t - 0.75) / 0.2) : 1;
  text(ctx, go ? 'GO!' : look.content.title, w / 2, h * 0.38, (go ? 64 : 40) * s * pop, go ? look.pal.accent : '#ffffff', { font: look.font, weight: 900, stroke: 'rgba(0,0,0,.6)' });
  if (!go) text(ctx, look.content.logline || '', w / 2, h * 0.38 + 38 * s, 15 * s, look.pal.muted, { font: look.font, weight: 700 });
  ctx.globalAlpha = 1;
}

/** Radial vignette that pulses on near misses and while slowed. */
export function drawVignette(ctx, fx, w, h, strength) {
  if (strength <= 0.01) return;
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, `rgba(180,220,255,${0.35 * strength})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}
