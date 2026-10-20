// Pure helpers for the default polish layer: palette, ambient theme, the
// per-entity animation state machine, particle emission from game events,
// camera follow, hit-stop, screen shake, and end-of-run summaries.
// Nothing here touches game state or its RNG, so simulation stays
// deterministic; the renderer and player host keep the visual state.

// ---------- small math ----------
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;

/** Tiny seeded PRNG (mulberry32) for visual-only randomness. */
export function rand(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const hashString = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

// ---------- color ----------
export function hexToRgb(hex) {
  let h = String(hex || '').replace('#', '');
  if (h.length === 3 || h.length === 4) h = [...h.slice(0, 3)].map(x => x + x).join('');
  if (!/^[0-9a-f]{6}/i.test(h)) h = '101820';
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}
export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
export function hslToHex(h, s, l) {
  s = clamp(s, 0, 1); l = clamp(l, 0, 1);
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return '#' + [f(0), f(8), f(4)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const rgba = (hex, a) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };
export const luminance = hex => { const [r, g, b] = hexToRgb(hex).map(v => v / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

/** A HUD and screen palette derived from the game's background color. */
export function paletteFrom(background = '#101820') {
  const [h, s, l] = rgbToHsl(hexToRgb(background));
  const dark = l < 0.55, grey = s < 0.12;
  const accent = grey ? '#ffcf4a' : hslToHex((h + 180) % 360, 0.9, 0.62);
  const accent2 = grey ? '#7fe3ff' : hslToHex((h + 140) % 360, 0.85, 0.68);
  const base = hslToHex(h, Math.min(s, 0.55), dark ? 0.07 : 0.14);
  return {
    background, dark, hue: h, accent, accent2,
    accentInk: luminance(accent) > 0.45 ? '#1a1206' : '#ffffff',
    ink: '#fffaf0', muted: 'rgba(255,250,240,.72)',
    panel: rgba(base, 0.74), panelSolid: base, edge: rgba(hslToHex(h, s * 0.6 + 0.1, 0.62), 0.38),
    skyTop: hslToHex(h, s, dark ? l * 0.55 : l + 0.08), skyBottom: hslToHex(h, s, dark ? l + 0.12 : l - 0.04),
    far: hslToHex(h, s * 0.7 + 0.05, dark ? l + 0.11 : l - 0.14),
    mid: hslToHex(h, s * 0.8 + 0.05, dark ? l + 0.04 : l - 0.24),
    heart: '#ff4d6d', heartDark: '#b3123a', danger: '#ff6b5a',
  };
}

// ---------- ambient theme ----------
const THEMES = {
  snow: ['snow', 'ice', 'icy', 'frozen', 'frost', 'winter', 'penguin', 'arctic', 'glacier', 'blizzard', 'yeti', 'polar', 'igloo', 'christmas', 'tundra'],
  embers: ['lava', 'fire', 'flame', 'ember', 'volcan', 'magma', 'inferno', 'hell', 'dragon', 'forge', 'burn', 'ash', 'molten', 'phoenix', 'blaze'],
  dust: ['desert', 'sand', 'dust', 'ruin', 'canyon', 'western', 'cowboy', 'mine', 'cave', 'cavern', 'tomb', 'pyramid', 'wasteland', 'factory', 'steampunk', 'street', 'temple'],
  bubbles: ['ocean', 'sea', 'underwater', 'bubble', 'fish', 'reef', 'aqua', 'coral', 'submarine', 'diver', 'mermaid', 'shark', 'lagoon', 'water', 'swamp', 'deep'],
  leaves: ['forest', 'jungle', 'garden', 'leaf', 'leaves', 'tree', 'autumn', 'wood', 'grove', 'meadow', 'farm', 'park', 'fairy', 'elf', 'nature', 'bloom', 'flower'],
  stars: ['space', 'star', 'night', 'galaxy', 'cosmic', 'moon', 'planet', 'alien', 'ghost', 'haunt', 'manor', 'spooky', 'dream', 'midnight', 'astro', 'rocket', 'nebula', 'neon', 'cyber'],
};
export const AMBIENT_THEMES = Object.keys(THEMES);
const themeRegex = Object.fromEntries(Object.entries(THEMES).map(([k, words]) => [k, new RegExp(`\\b(${words.join('|')})`, 'g')]));

/** Pick snow, embers, dust, bubbles, leaves or stars from the game's words; title and pitch count double. */
export function ambientTheme(spec = {}, extra = '') {
  const strong = `${spec.title || ''} ${spec.pitch || ''}`;
  const text = `${strong} ${strong} ${spec.art?.style || ''} ${Object.keys(spec.entities || {}).join(' ').replace(/-/g, ' ')} ${extra}`.toLowerCase();
  let best = null, bestScore = 0;
  for (const theme of AMBIENT_THEMES) {
    const score = (text.match(themeRegex[theme]) || []).length;
    if (score > bestScore) { best = theme; bestScore = score; }
  }
  return best || (luminance(spec.background || '#101820') < 0.2 ? 'stars' : 'dust');
}

// ---------- animation state machine ----------
export const POSES = ['idle', 'runA', 'runB', 'jump', 'hurt'];
export function createAnim() {
  return { pose: 'idle', t: 0, sx: 1, sy: 1, vsx: 0, vsy: 0, run: 0, lean: 0, grounded: true, vy: 0, flash: 0, air: 0, dust: 0, event: null, impact: 0 };
}

/**
 * Advance one entity's visual animation. Returns a new anim object.
 * ctx: { dt, grounded, invuln, side, runSpeed }.
 * anim.event is 'takeoff' or 'land' on the frame it happens (with anim.impact 0..1).
 */
export function stepAnim(prev, e, { dt = 1 / 60, grounded = true, invuln = false, side = true, runSpeed = 8 } = {}) {
  const a = { ...prev, event: null, impact: 0 };
  a.t += dt;
  if (side) {
    if (prev.grounded && !grounded && e.vy < -1) { a.sx = 0.78; a.sy = 1.24; a.vsx = a.vsy = 0; a.event = 'takeoff'; }
    else if (!prev.grounded && grounded && prev.air > 0.08) {
      const impact = clamp(prev.vy / 22, 0.2, 1);
      a.sx = 1 + 0.32 * impact; a.sy = 1 - 0.3 * impact; a.vsx = a.vsy = 0; a.event = 'land'; a.impact = impact;
    }
    a.air = grounded ? 0 : prev.air + dt;
  }
  // Critically damped-ish spring back to 1.
  const k = 320, d = 22;
  a.vsx += ((1 - a.sx) * k - a.vsx * d) * dt; a.sx += a.vsx * dt;
  a.vsy += ((1 - a.sy) * k - a.vsy * d) * dt; a.sy += a.vsy * dt;
  const speed = Math.abs(e.vx || 0) + (side ? 0 : Math.abs(e.vy || 0));
  a.run = (grounded || !side) && speed > 0.4 ? prev.run + speed * dt * 0.9 : 0;
  const leanTarget = side ? clamp((e.vx || 0) / Math.max(1, runSpeed), -1, 1) * 0.12 : 0;
  a.lean = lerp(prev.lean, leanTarget, Math.min(1, dt * 12));
  a.flash = Math.max(0, prev.flash - dt);
  a.pose = invuln ? 'hurt' : side && !grounded ? 'jump' : speed > 0.5 ? (Math.floor(a.run) % 2 ? 'runB' : 'runA') : 'idle';
  // Finer frame for rigs that paint more poses: a four-frame run, rise vs fall, a two-frame idle.
  a.frame = a.pose === 'runA' || a.pose === 'runB' ? RUN_FRAMES[Math.floor(a.run * 2) % 4]
    : a.pose === 'jump' ? ((e.vy || 0) > 1.5 ? 'fall' : 'jump') : a.pose;
  a.grounded = grounded; a.vy = e.vy || 0;
  return a;
}

/** Vertical body offset in tiles: idle breathing, or a step bob while running. */
export function bodyBob(a, { reduced = false, planted = false } = {}) {
  if (reduced) return 0;
  if (planted && a.frame?.startsWith('run')) return 0; // rigged run frames carry their own stride bob
  if (a.pose === 'runA' || a.pose === 'runB') return Math.abs(Math.sin(a.run * Math.PI)) * 0.07;
  if (a.pose === 'idle') return (Math.sin(a.t * 2.6) + 1) * 0.012;
  return 0;
}
/** Idle breathing as a y-scale multiplier. */
export const breathe = (a, reduced = false) => a.pose === 'idle' && !reduced ? 1 + Math.sin(a.t * 2.6) * 0.025 : 1;

const RUN_FRAMES = ['runA', 'runB', 'runC', 'runD'];
const FALLBACK = { idle: ['idle', 'runA'], idleB: ['idleB', 'idle', 'runA'], runA: ['runA', 'idle'], runB: ['runB', 'runA', 'idle'], runC: ['runC', 'runA', 'idle'], runD: ['runD', 'runB', 'runA', 'idle'],
  jump: ['jump', 'runB', 'runA', 'idle'], fall: ['fall', 'jump', 'runB', 'idle'], hurt: ['hurt', 'jump', 'idle', 'runA'] };
/** The best available pose frame URL for a pose, or null. */
export function pickFrame(frames, pose) {
  if (!frames) return null;
  for (const key of FALLBACK[pose] || [pose, 'idle']) if (frames[key]) return frames[key];
  return null;
}

// ---------- particles ----------
export function createParticles(max = 700) { return { list: [], max }; }
export function addParticles(ps, items) {
  for (const p of items) { if (ps.list.length >= ps.max) ps.list.shift(); ps.list.push(p); }
}
export function stepParticles(ps, dt) {
  let n = 0;
  for (const p of ps.list) {
    p.life -= dt; if (p.life <= 0) continue;
    p.vy += (p.g || 0) * dt;
    const drag = Math.max(0, 1 - (p.drag || 0) * dt);
    p.vx *= drag; p.vy *= drag;
    p.x += p.vx * dt; p.y += p.vy * dt; p.rot = (p.rot || 0) + (p.spin || 0) * dt;
    ps.list[n++] = p;
  }
  ps.list.length = n;
}
const P = (o) => ({ g: 0, drag: 0, rot: 0, spin: 0, grow: 0, add: false, shape: 'dot', ...o, max: o.life });

/** Landing dust: a puff to both sides of the feet, scaled by impact 0..1. */
export function dustBurst(x, y, impact, r, color = 'rgba(235,228,214,.85)') {
  const n = Math.round(4 + impact * 8), out = [];
  for (let i = 0; i < n; i++) {
    const dir = i % 2 ? 1 : -1;
    out.push(P({ x: x + dir * r() * 0.2, y: y - 0.05, vx: dir * (1 + r() * 3.5) * (0.6 + impact), vy: -(0.3 + r() * 1.4), drag: 3.5, g: 1.5, life: 0.3 + r() * 0.35, size: 0.1 + r() * 0.16 * (0.6 + impact), grow: 0.25, color }));
  }
  return out;
}
export function sparkleBurst(x, y, r, color = '#fff3a8', n = 12) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + r() * 0.4, sp = 2 + r() * 4;
    out.push(P({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, drag: 4, life: 0.35 + r() * 0.3, size: 0.12 + r() * 0.12, shape: 'star', spin: (r() - 0.5) * 10, color, add: true }));
  }
  out.push(P({ x, y, vx: 0, vy: 0, life: 0.3, size: 0.2, grow: 3.2, shape: 'ring', color }));
  return out;
}
export function sparkBurst(x, y, r, color = '#fff', n = 9) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const ang = r() * Math.PI * 2, sp = 6 + r() * 8;
    out.push(P({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, drag: 6, life: 0.16 + r() * 0.16, size: 0.05 + r() * 0.04, shape: 'spark', color, add: true }));
  }
  return out;
}
export function debrisBurst(x, y, r, color = '#ddd', n = 12) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const ang = -Math.PI / 2 + (r() - 0.5) * 2.6, sp = 3 + r() * 6;
    out.push(P({ x: x + (r() - 0.5) * 0.4, y: y + (r() - 0.5) * 0.4, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g: 30, drag: 0.6, life: 0.55 + r() * 0.4, size: 0.1 + r() * 0.14, shape: 'square', spin: (r() - 0.5) * 18, color }));
  }
  out.push(P({ x, y, vx: 0, vy: 0, life: 0.28, size: 0.3, grow: 4, shape: 'ring', color: '#fff' }));
  return out;
}
export function confettiBurst(x, y, r, colors, n = 56) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const ang = -Math.PI / 2 + (r() - 0.5) * 2.4, sp = 8 + r() * 12;
    out.push(P({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g: 12, drag: 1.8, life: 1.4 + r() * 1, size: 0.16 + r() * 0.14, shape: 'confetti', spin: (r() - 0.5) * 16, color: colors[i % colors.length] }));
  }
  return out;
}

export const HIT_STOP = { stomp: 3, hit: 2, hurt: 4, defeated: 4 };
export const SHAKE = { hurt: 0.5, stomp: 0.32, hit: 0.22, defeated: 0.8 };
/** Frames (2–4) to freeze the simulation after impactful events. */
export const hitStopFor = events => (events || []).reduce((m, e) => Math.max(m, HIT_STOP[e.name] || 0), 0);
/** Screen-shake trauma (0..1) to add for these events. */
export const shakeFor = events => Math.min(1, (events || []).reduce((s, e) => s + (SHAKE[e.name] || 0), 0));

const center = e => ({ x: e.x + e.w / 2, y: e.y + e.h / 2 });
/**
 * Particles for one batch of game events. removed lists entities that
 * disappeared since the last frame ({ kind, tags, x, y, w, h, color }).
 */
export function particlesFor({ events = [], removed = [], player = null, r = rand(1), palette = paletteFrom() } = {}) {
  const out = [];
  for (const e of removed) {
    const c = center(e);
    if (e.tags?.includes('enemy')) { out.push(...debrisBurst(c.x, c.y, r, e.color || palette.accent2), ...sparkBurst(c.x, c.y, r, '#fff', 6)); }
    else if (e.tags?.includes('collectible')) out.push(...sparkleBurst(c.x, c.y, r, palette.accent));
    else if (e.tags?.includes('projectile')) out.push(...sparkBurst(c.x, c.y, r, palette.accent, 5));
  }
  const pc = player && center(player);
  for (const ev of events) {
    if (!pc) break;
    if (ev.name === 'hurt') out.push(...sparkBurst(pc.x, pc.y, r, '#ffe1e1', 10));
    else if (ev.name === 'shoot') out.push(...sparkBurst(pc.x + (player.face || 1) * player.w * 0.6, pc.y, r, palette.accent, 4));
    else if (ev.name === 'respawn') out.push(...sparkleBurst(pc.x, pc.y, r, '#ffffff', 16));
    else if (ev.name === 'reach_goal') out.push(...confettiBurst(pc.x, pc.y - 0.5, r, [palette.accent, palette.accent2, '#ffffff', palette.heart]));
    else if (ev.name === 'defeated') out.push(...debrisBurst(pc.x, pc.y, r, palette.heart, 16));
  }
  return out;
}

// ---------- camera ----------
const clampView = (center, view, size) => size <= view ? (size - view) / 2 : Math.max(0, Math.min(size - view, center - view / 2));
/**
 * Smoothed follow camera with look-ahead in the travel direction and a
 * vertical dead-zone. Returns a new camera { cx, cy, look, x, y } where
 * x, y is the clamped top-left corner in tiles.
 */
export function stepCamera(cam, { tx, ty, vx = 0, face = 1, dt = 1 / 60, viewW, viewH, width, height, side = true, grounded = true, snap = false }) {
  const lookTarget = (Math.abs(vx) > 0.5 ? Math.sign(vx) : face || 1) * viewW * (Math.abs(vx) > 0.5 ? 0.16 : 0.08);
  if (!cam || snap) {
    const look = lookTarget;
    return { cx: tx + look, cy: ty, fy: ty, look, x: clampView(tx + look, viewW, width), y: clampView(ty, viewH, height) };
  }
  const look = lerp(cam.look, lookTarget, 1 - Math.exp(-dt * 2.2));
  const dz = viewH * (side ? 0.14 : 0.06);
  let fy = cam.fy;
  if (ty < fy - dz) fy = ty + dz; else if (ty > fy + dz) fy = ty - dz;
  if (side && grounded) fy = lerp(fy, ty, 1 - Math.exp(-dt * 1.6));
  const cx = lerp(cam.cx, tx + look, 1 - Math.exp(-dt * 7));
  const cy = lerp(cam.cy, fy, 1 - Math.exp(-dt * 6));
  return { cx, cy, fy, look, x: clampView(cx, viewW, width), y: clampView(cy, viewH, height) };
}

// ---------- run summaries ----------
const pretty = kind => String(kind || '').replace(/-/g, ' ');
/** Why the run ended, from the events seen during it (most recent last). */
export function lossReason(history = [], spec = {}) {
  const theme = ambientTheme(spec);
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i];
    if (e.name === 'time_up') return 'Time ran out';
    if (e.name === 'fell') return theme === 'embers' ? 'Fell into the lava' : theme === 'bubbles' ? 'Sank into the depths' : theme === 'snow' ? 'Fell through the ice' : 'Fell into a pit';
    if (e.name === 'hurt' && e.from) {
      const tags = spec.entities?.[e.from]?.tags || [];
      return tags.includes('enemy') ? `Taken down by the ${pretty(e.from)}` : `Hit the ${pretty(e.from)}`;
    }
  }
  return 'Out of health';
}

/** End-of-run tallies from state (and the run's starting state for totals). */
export function tally(state, start = null) {
  const v = state.vars || {};
  const startEnemies = start ? start.entities.filter(e => e.tags.includes('enemy')).length : null;
  return {
    seconds: +(state.time || 0).toFixed(2),
    pickups: v.collected ?? null,
    pickupsTotal: v.collected != null ? v.collected + (v.remaining ?? 0) : null,
    enemies: (v.defeated_enemies || 0) + (v.shots_hit || 0),
    enemiesTotal: startEnemies,
    hp: v.hp ?? null,
  };
}

export const bestKey = id => `gameverse.v2.best.${id}`;
/** Store a best (lowest) completion time; storage errors are ignored. */
export function recordBest(storage, id, seconds) {
  let best = null;
  try { const raw = storage?.getItem(bestKey(id)); best = raw == null ? null : Number(raw); } catch {}
  if (!Number.isFinite(best)) best = null;
  const isNew = best == null || seconds < best;
  if (isNew) { best = seconds; try { storage?.setItem(bestKey(id), String(seconds)); } catch {} }
  return { best, isNew };
}
export const formatTime = s => { s = Math.max(0, s); const m = Math.floor(s / 60), r = s - m * 60; return `${m}:${r < 10 ? '0' : ''}${r.toFixed(2)}`; };
export const formatClock = s => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** A one-line objective from the win predicate. */
export function objective(spec = {}) {
  const goal = Object.entries(spec.entities || {}).find(([, d]) => d.tags?.includes('goal'))?.[0];
  const pickup = Object.entries(spec.entities || {}).find(([, d]) => d.tags?.includes('collectible'))?.[0];
  const all = JSON.stringify(spec.win || {}).includes('"remaining"');
  if (goal && all && pickup) return `Collect every ${pretty(pickup)}, then reach the ${pretty(goal)}`;
  if (goal) return `Reach the ${pretty(goal)}`;
  return 'Complete the level';
}
