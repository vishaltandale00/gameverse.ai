// Maze kit renderer: neon double-line walls traced from the maze in code, the
// painted hero and hunters (tinted per hunter), pellets that pulse, glowing
// power pellets, particles, score popups, shake, the death animation, the
// level-clear flash and the HUD. All visual state lives in render.fx; the game
// state is only read.
import { createParticles, addParticles, stepParticles, sparkleBurst, sparkBurst, confettiBurst, rand, hexToRgb, rgbToHsl, hslToHex } from '../../engine/juice.js';
import { W, H, WALL, HOUSE_RECT, DOOR_TILES } from './maze.js';

const TAU = Math.PI * 2;
const HUD_TOP = 3, HUD_BOTTOM = 2.2;
const HUD_FONT = '"Avenir Next", "Nunito", ui-rounded, "SF Pro Rounded", "Segoe UI", system-ui, sans-serif';
const RUN = ['runA', 'runB', 'runC', 'runD'];
const FRIGHT_BLUE = '#2a3cff', FRIGHT_FLASH = '#f2f4ff';
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const DXY = [[0, -1], [-1, 0], [0, 1], [1, 0]];

// ---------- colors ----------
const rgba = (hex, a) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };
const mixHex = (a, b, t) => { const p = hexToRgb(a), q = hexToRgb(b); return '#' + p.map((v, i) => Math.round(v + (q[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
/** A saturated, bright version of a color, for neon. */
function neon(hex, fallback) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return fallback;
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  return s < 0.08 ? hslToHex(h, 0, clamp(l, 0.7, 0.9)) : hslToHex(h, Math.max(0.7, s), clamp(l, 0.52, 0.62));
}
function deepen(hex, fallback, light = 0.06) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return fallback;
  const [h, s] = rgbToHsl(hexToRgb(hex));
  return hslToHex(h, Math.min(0.6, s * 0.7 + 0.1), light);
}
function pastel(hex, fallback) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return fallback;
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  return hslToHex(h, Math.min(1, s * 0.9 + 0.1), Math.max(0.74, l));
}

// ---------- images ----------
const images = new Map();
function image(url) {
  if (!url || typeof Image === 'undefined') return null;
  let e = images.get(url);
  if (!e) { const img = new Image(); e = { img, ready: false }; img.onload = () => { e.ready = true; }; img.src = url; images.set(url, e); }
  return e.ready ? e.img : null;
}
function surface(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  return null;
}
const boxes = new WeakMap();
/** The opaque bounding box of an image as fractions [x0, y0, x1, y1], so rigs of any body plan fit a tile. */
function boxOf(img) {
  if (!img) return [0, 0, 1, 1];
  if (boxes.has(img)) return boxes.get(img);
  let box = [0, 0, 1, 1];
  const N = 64, c = surface(N, N);
  try {
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, N, N);
    const a = g.getImageData(0, 0, N, N).data;
    let x0 = N, y0 = N, x1 = -1, y1 = -1;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (a[(y * N + x) * 4 + 3] > 24) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    if (x1 >= x0) box = [x0 / N, y0 / N, (x1 + 1) / N, (y1 + 1) / N];
  } catch {}
  boxes.set(img, box);
  return box;
}
const tints = new Map();
/** The image recolored to `color`, keeping its shading and outlines (luminance × color). */
function tinted(img, color) {
  const key = `${img.src}|${color}`;
  if (tints.has(key)) return tints.get(key);
  const N = 160, c = surface(N, N);
  if (!c) { tints.set(key, img); return img; }
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, N, N);
  try {
    const d = g.getImageData(0, 0, N, N), px = d.data, [r, gg, b] = hexToRgb(color);
    for (let i = 0; i < px.length; i += 4) {
      if (!px[i + 3]) continue;
      const L = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255;
      const k = Math.min(1.05, 0.12 + L * 1.0), hi = Math.max(0, L - 0.9) * 5;
      px[i] = Math.min(255, r * k * (1 - hi) + 255 * hi); px[i + 1] = Math.min(255, gg * k * (1 - hi) + 255 * hi); px[i + 2] = Math.min(255, b * k * (1 - hi) + 255 * hi);
    }
    g.putImageData(d, 0, 0);
  } catch {
    g.globalCompositeOperation = 'source-atop'; g.globalAlpha = 0.6; g.fillStyle = color; g.fillRect(0, 0, N, N);
  }
  tints.set(key, c);
  return c;
}

// ---------- walls ----------
/**
 * Trace the wall regions' outlines and offset them `inset` tiles into the walls.
 * Out-of-bounds counts as wall (a 1-tile pad) except on tunnel rows, and beyond the
 * pad as open, so every loop closes; drawing clips to the maze. House walls are
 * drawn separately, so they count as open here.
 */
export function wallLoops(maze, inset = 0.5) {
  const wall = (i, j) => {
    if (i < -1 || i > W || j < -1 || j > H) return false;
    if (i < 0 || i >= W || j < 0 || j >= H) return !maze.tunnels.includes(j);
    return maze.cells[j * W + i] === WALL;
  };
  const starts = new Map(), all = [];
  const add = (x, y, dx, dy) => { const e = { x, y, dx, dy, used: false }; all.push(e); const k = `${x},${y}`; (starts.get(k) || starts.set(k, []).get(k)).push(e); };
  for (let j = -1; j <= H; j++) for (let i = -1; i <= W; i++) {
    if (!wall(i, j)) continue;
    if (!wall(i, j - 1)) add(i, j, 1, 0);
    if (!wall(i + 1, j)) add(i + 1, j, 0, 1);
    if (!wall(i, j + 1)) add(i + 1, j + 1, -1, 0);
    if (!wall(i - 1, j)) add(i, j + 1, 0, -1);
  }
  const loops = [];
  for (const e0 of all) {
    if (e0.used) continue;
    const pts = [];
    let e = e0;
    for (let guard = 0; guard < 20000; guard++) {
      e.used = true;
      const ex = e.x + e.dx, ey = e.y + e.dy, next = (starts.get(`${ex},${ey}`) || []).filter(n => !n.used || n === e0);
      // Prefer a right turn (keeps hugging the same wall where two touch at a corner), then straight, then left.
      const pick = next.find(n => n.dx === -e.dy && n.dy === e.dx) || next.find(n => n.dx === e.dx && n.dy === e.dy) || next[0];
      if (!pick) break;
      if (pick.dx !== e.dx || pick.dy !== e.dy) pts.push({ x: ex, y: ey, inX: e.dx, inY: e.dy, outX: pick.dx, outY: pick.dy });
      if (pick === e0) break;
      e = pick;
    }
    if (pts.length >= 4) loops.push(pts.map(p => ({ x: p.x + inset * (-p.inY - p.outY), y: p.y + inset * (p.inX + p.outX) })));
  }
  return loops;
}
function roundedLoop(g, pts, s, ox, oy, radius) {
  const n = pts.length, P = i => pts[(i + n) % n];
  const mid = { x: (P(-1).x + P(0).x) / 2, y: (P(-1).y + P(0).y) / 2 };
  g.moveTo(ox + mid.x * s, oy + mid.y * s);
  for (let i = 0; i < n; i++) {
    const a = P(i - 1), b = P(i), c = P(i + 1);
    const r = Math.min(radius, Math.hypot(b.x - a.x, b.y - a.y) / 2, Math.hypot(c.x - b.x, c.y - b.y) / 2);
    g.arcTo(ox + b.x * s, oy + b.y * s, ox + c.x * s, oy + c.y * s, r * s);
  }
  g.closePath();
}
function roundRect(g, x, y, w, h, r) {
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

/** Draw the static maze (floor, walls, house) at tile size s with its top-left at (ox, oy). */
function paintMaze(g, loops, s, ox, oy, colors, flash) {
  const wall = flash ? '#ffffff' : colors.wall;
  g.save();
  g.beginPath(); g.rect(ox, oy, W * s, H * s); g.clip();
  g.fillStyle = colors.floor; g.fillRect(ox, oy, W * s, H * s);
  if (g.createRadialGradient) {
    const glow = g.createRadialGradient(ox + W * s / 2, oy + H * s / 2, s, ox + W * s / 2, oy + H * s / 2, H * s * 0.7);
    glow.addColorStop(0, rgba(colors.wall, 0.07)); glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = glow; g.fillRect(ox, oy, W * s, H * s);
  }
  g.beginPath();
  for (const loop of loops) roundedLoop(g, loop, s, ox, oy, 0.42);
  g.fillStyle = rgba(wall, flash ? 0.28 : 0.1); g.fill('evenodd');
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.shadowColor = wall; g.shadowBlur = s * 0.55; g.strokeStyle = wall; g.lineWidth = Math.max(1.5, s * 0.3); g.stroke();
  g.shadowBlur = 0; g.strokeStyle = flash ? mixHex(colors.wall, '#ffffff', 0.5) : colors.core; g.lineWidth = Math.max(0.6, s * 0.11); g.stroke();
  // The house: a double line with a gap for the door.
  const hx = ox + HOUSE_RECT.x0 * s, hy = oy + HOUSE_RECT.y0 * s, hw = (HOUSE_RECT.x1 - HOUSE_RECT.x0 + 1) * s, hh = (HOUSE_RECT.y1 - HOUSE_RECT.y0 + 1) * s;
  g.beginPath(); roundRect(g, hx + s * 0.22, hy + s * 0.22, hw - s * 0.44, hh - s * 0.44, s * 0.3); roundRect(g, hx + s * 0.72, hy + s * 0.72, hw - s * 1.44, hh - s * 1.44, s * 0.15);
  g.shadowColor = wall; g.shadowBlur = s * 0.4; g.strokeStyle = wall; g.lineWidth = Math.max(1, s * 0.13); g.stroke(); g.shadowBlur = 0;
  const dx = ox + DOOR_TILES[0][0] * s, dy = oy + DOOR_TILES[0][1] * s;
  g.fillStyle = colors.floor; g.fillRect(dx - s * 0.05, dy, s * 2.1, s * 0.95);
  g.fillStyle = colors.door; g.shadowColor = colors.door; g.shadowBlur = s * 0.3; g.fillRect(dx, dy + s * 0.38, s * 2, s * 0.22); g.shadowBlur = 0;
  g.restore();
}

// ---------- characters drawn in code (fallbacks) ----------
function chomp(g, r, angle, mouth, color) {
  g.fillStyle = color;
  g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, r, angle + mouth, angle + TAU - mouth); g.closePath(); g.fill();
  g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.arc(-r * 0.3, -r * 0.35, r * 0.28, 0, TAU); g.fill();
}
function ghostBody(g, r, color, wave) {
  g.fillStyle = color;
  g.beginPath(); g.moveTo(-r, r * 0.85); g.lineTo(-r, -r * 0.05); g.arc(0, -r * 0.05, r, Math.PI, 0); g.lineTo(r, r * 0.85);
  const n = 6;
  for (let k = 1; k <= n; k++) g.lineTo(r - (2 * r * k) / n, (k + wave) % 2 ? r * 0.55 : r * 0.95);
  g.closePath(); g.fill();
}
function eyes(g, r, dir, small = false) {
  const [ex, ey] = DXY[dir < 0 ? 1 : dir];
  for (const sx of [-1, 1]) {
    const cx = sx * r * 0.38, cy = -r * 0.18;
    g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(cx + ex * r * 0.08, cy + ey * r * 0.08, r * (small ? 0.2 : 0.27), r * (small ? 0.24 : 0.34), 0, 0, TAU); g.fill();
    g.fillStyle = '#1d3bff'; g.beginPath(); g.arc(cx + ex * r * 0.2, cy + ey * r * 0.2, r * (small ? 0.1 : 0.14), 0, TAU); g.fill();
  }
}
function scaredFace(g, r, color) {
  g.fillStyle = color; g.strokeStyle = color; g.lineWidth = Math.max(1, r * 0.1); g.lineJoin = 'round';
  for (const sx of [-1, 1]) { g.beginPath(); g.arc(sx * r * 0.34, -r * 0.2, r * 0.12, 0, TAU); g.fill(); }
  g.beginPath();
  for (let k = 0; k <= 6; k++) g.lineTo(-r * 0.6 + (k * r * 1.2) / 6, r * 0.3 + (k % 2 ? -r * 0.12 : 0));
  g.stroke();
}
function fruit(g, r, color) {
  g.strokeStyle = '#5fbf4a'; g.lineWidth = Math.max(1, r * 0.14); g.lineCap = 'round';
  g.beginPath(); g.moveTo(-r * 0.35, r * 0.1); g.quadraticCurveTo(-r * 0.1, -r * 0.7, r * 0.4, -r * 0.8); g.moveTo(r * 0.4, r * 0.2); g.quadraticCurveTo(r * 0.3, -r * 0.4, r * 0.4, -r * 0.8); g.stroke();
  for (const [x, y] of [[-r * 0.38, r * 0.35], [r * 0.38, r * 0.45]]) {
    g.fillStyle = color; g.beginPath(); g.arc(x, y, r * 0.42, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,.6)'; g.beginPath(); g.arc(x - r * 0.14, y - r * 0.14, r * 0.12, 0, TAU); g.fill();
  }
}
const BONUS_COLORS = ['#ff3b5c', '#ffb03a', '#c86bff', '#5fe36a', '#ffd23f', '#3ad8e8'];

/** Little stars circling a stunned hunter's head. */
function stunStars(g, r, t, reduced) {
  for (let i = 0; i < 3; i++) {
    const a = (reduced ? 0 : t * 5) + (i * TAU) / 3, x = Math.cos(a) * r * 0.9, y = -r * 1.05 + Math.sin(a) * r * 0.25;
    g.save(); g.translate(x, y); g.fillStyle = '#ffe14a'; starPath(g, r * 0.22); g.fill(); g.restore();
  }
}
function starPath(g, r) {
  g.beginPath();
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU, rr = i % 2 ? r * 0.38 : r; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  g.closePath();
}

export function createRenderer(game, { art } = {}) {
  art = art || {};
  const direction = art.direction || {};
  const colors = {
    wall: neon(direction.tiles?.platformColor, '#2f5bff'),
    floor: deepen(direction.scenery?.sky?.[0] || direction.scenery?.land, '#05070f'),
    pellet: pastel(direction.pickup?.color, '#ffd9b0'),
    power: pastel(direction.goal?.color || direction.pickup?.color, '#ffe8c8'),
    door: '#ffb8de',
    hero: direction.player?.colors?.primary || '#ffd23f',
  };
  colors.core = mixHex(colors.floor, colors.wall, 0.18);
  colors.letterbox = mixHex(colors.floor, '#000000', 0.45);
  colors.label = mixHex(colors.wall, '#ffffff', 0.45);
  const pixel = direction.style === 'pixel' || /pixel/i.test(art.style || '');
  const heroBlob = direction.player?.body === 'blob';
  const heroFrames = art.frames?.hero || null, hunterFrames = art.frames?.hunter || null;
  const content = game.content;

  const fx = {
    t: 0, particles: createParticles(600), popups: [], trauma: 0, r: rand(97), loops: new Map(), layers: new Map(),
    score: 0, scorePop: 0, lifePop: 0, faces: [], deathBurst: false, lastPhase: null,
  };
  const loopsFor = level => { if (!fx.loops.has(level)) fx.loops.set(level, wallLoops(game.mazeFor(level))); return fx.loops.get(level); };
  function layer(level, s, dpr, flash) {
    const key = `${level}|${Math.round(s * dpr * 100)}|${flash ? 1 : 0}`;
    if (fx.layers.has(key)) return fx.layers.get(key);
    const c = surface(Math.ceil(W * s * dpr), Math.ceil(H * s * dpr));
    if (!c) return null;
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    paintMaze(g, loopsFor(level), s, 0, 0, colors, flash);
    if (fx.layers.size > 8) fx.layers.clear();
    fx.layers.set(key, c);
    return c;
  }

  /** Score popups; ones that would overlap a live popup stack upward. */
  const popup = (x, y, text, color, life) => {
    let lift = 0;
    while (fx.popups.some(p => Math.abs(p.x - x) < 1.5 && Math.abs(p.y - lift - y) < 0.7 && p.t < 0.5)) lift += 0.9;
    fx.popups.push({ x, y: y - lift, text, color, t: 0, life });
  };
  function onEvents(events, state) {
    const r = fx.r;
    for (const e of events) {
      if (e.name === 'collect' && e.item === 'pellet') addParticles(fx.particles, sparkBurst(e.x, e.y, r, colors.pellet, 3));
      else if (e.name === 'collect' && e.item === 'bonus') {
        addParticles(fx.particles, confettiBurst(e.x, e.y, r, BONUS_COLORS, 22).map(p => ({ ...p, g: 6, life: p.life * 0.6 })));
        popup(e.x, e.y, String(e.points), '#ffb8ff', 1.4);
      } else if (e.name === 'power') { addParticles(fx.particles, sparkleBurst(e.x, e.y, r, colors.power, 14)); fx.trauma = Math.min(1, fx.trauma + 0.12); }
      else if (e.name === 'defeated') {
        const color = state.hunters[e.index]?.color || '#ffffff';
        addParticles(fx.particles, sparkleBurst(e.x, e.y, r, color, 16));
        popup(e.x, e.y, String(e.points), '#7ff6ff', 1.1);
        fx.trauma = Math.min(1, fx.trauma + 0.3);
      } else if (e.name === 'hurt') { addParticles(fx.particles, sparkBurst(e.x, e.y, r, '#ffe1e1', 12)); fx.trauma = Math.min(1, fx.trauma + 0.85); fx.deathBurst = false; }
      else if (e.name === 'extra_life') fx.lifePop = 1;
      else if (e.name === 'level_clear') addParticles(fx.particles, sparkleBurst(state.player.x, state.player.y, r, '#ffffff', 18));
      else if (e.name === 'level_up') fx.particles.list.length = 0;
    }
  }

  /** Draw a square sprite so that `box` (its opaque bounds, from the idle frame) is `size` across, centred on (x, y). */
  function drawSprite(ctx, img, x, y, size, { box = [0, 0, 1, 1], flip = false, rot = 0, alpha = 1, scale = 1 } = {}) {
    const S = size / Math.max(0.2, box[2] - box[0], box[3] - box[1]);
    ctx.save(); ctx.translate(x, y); if (rot) ctx.rotate(rot); ctx.scale((flip ? -1 : 1) * scale, scale);
    ctx.globalAlpha *= alpha; ctx.imageSmoothingEnabled = !pixel;
    ctx.drawImage(img, -S * (box[0] + box[2]) / 2, -S * (box[1] + box[3]) / 2, S, S);
    ctx.restore();
  }

  function drawHero(ctx, state, X, Y, s, reduced) {
    const p = state.player, x = X(p.x), y = Y(p.y), size = s * 1.6, moving = p.moving && state.phase === 'play';
    let alpha = 1, scale = 1, spin = 0, q = 0;
    if (state.phase === 'dying') {
      const t = state.phaseT;
      q = clamp((t - 36) / 72, 0, 1);
      if (q >= 1) {
        if (!fx.deathBurst) { fx.deathBurst = true; addParticles(fx.particles, sparkleBurst(p.x, p.y, fx.r, colors.hero, 18)); }
        return;
      }
    }
    const angle = p.dir >= 0 ? Math.atan2(DXY[p.dir][1], DXY[p.dir][0]) : Math.PI;
    const pose = state.phase === 'dying' && q > 0 ? 'hurt' : moving ? RUN[Math.floor(p.travel * 2.2) % 4] : Math.floor(fx.t * 1.6) % 2 ? 'idleB' : 'idle';
    const img = image(heroFrames?.[pose]) || image(heroFrames?.idle) || image(art.sprites?.hero);
    for (const off of wraps(p.x)) {
      const xx = x + off * s;
      if (img) {
        if (q > 0) { spin = q * TAU * 2; scale = 1 - q * 0.85; alpha = 1 - q * 0.6; }
        const bob = reduced || !moving ? 1 : 1 + Math.sin(p.travel * Math.PI * 2.2) * 0.05;
        let rot = spin, flip = p.face < 0;
        if (heroBlob && (p.dir === 0 || p.dir === 2)) { rot += p.dir === 0 ? -Math.PI / 2 : Math.PI / 2; flip = false; }
        drawSprite(ctx, img, xx, y, size, { box: boxOf(image(heroFrames?.idle) || img), flip, rot, alpha, scale: scale * bob });
      } else {
        ctx.save(); ctx.translate(xx, y);
        const mouth = q > 0 ? 0.25 + q * (Math.PI - 0.25) : moving || state.phase !== 'play' ? 0.04 + 0.32 * Math.abs(Math.sin(p.travel * Math.PI * 1.1)) : 0.3;
        chomp(ctx, s * 0.7, q > 0 ? -Math.PI / 2 : angle, mouth, colors.hero);
        ctx.restore();
      }
    }
  }

  function drawHunter(ctx, state, h, X, Y, s, reduced) {
    const x = X(h.x), y = Y(h.y), size = s * 1.55, r = s * 0.72;
    if (h.dir === 1) fx.faces[h.index] = -1; else if (h.dir === 3) fx.faces[h.index] = 1;
    const face = fx.faces[h.index] || 1;
    const flashing = h.fright && state.frightT < Math.min(120, state.frightTotal * 0.4) && Math.floor(fx.t * 7) % 2 === 0;
    const eyesOnly = h.state === 'eyes' || h.state === 'entering';
    const wobble = h.fright && !reduced ? Math.sin(fx.t * 18 + h.index) * 0.12 : 0;
    const bob = reduced ? 0 : Math.sin(fx.t * 9 + h.index * 1.7) * s * 0.05;
    const pose = RUN[Math.floor(fx.t * 8 + h.index) % 4];
    const img = !eyesOnly && (image(hunterFrames?.[pose]) || image(hunterFrames?.idle) || image(art.sprites?.hunter));
    for (const off of wraps(h.x)) {
      const xx = x + off * s;
      ctx.save(); ctx.translate(xx, y + bob);
      if (eyesOnly) eyes(ctx, r, h.dir);
      else if (img) {
        const color = h.fright ? (flashing ? FRIGHT_FLASH : FRIGHT_BLUE) : h.stunT > 0 ? '#cfeaff' : h.color;
        if (!reduced) { ctx.shadowColor = color; ctx.shadowBlur = s * 0.35; }
        drawSprite(ctx, tinted(img, color), 0, 0, size, { box: boxOf(image(hunterFrames?.idle) || img), flip: face < 0, rot: wobble });
        ctx.shadowBlur = 0;
        if (h.fright) scaredFace(ctx, r * 0.8, flashing ? '#ff4d6d' : '#ffd9c8');
        if (h.stunT > 0) stunStars(ctx, r, fx.t, reduced);
      } else {
        ctx.rotate(wobble);
        ghostBody(ctx, r, h.fright ? (flashing ? FRIGHT_FLASH : FRIGHT_BLUE) : h.color, Math.floor(fx.t * 8) % 2);
        if (h.fright) scaredFace(ctx, r, flashing ? '#ff4d6d' : '#ffd9c8'); else eyes(ctx, r, h.dir);
        if (h.stunT > 0) stunStars(ctx, r, fx.t, reduced);
      }
      ctx.restore();
    }
  }
  const wraps = x => (x < 0.6 ? [0, W] : x > W - 1.6 ? [0, -W] : [0]);

  function drawParticles(ctx, X, Y, s) {
    for (const p of fx.particles.list) {
      const k = p.life / p.max, rr = Math.max(0.5, (p.size + p.grow * (1 - k)) * s);
      ctx.save(); ctx.translate(X(p.x), Y(p.y));
      ctx.globalAlpha = p.shape === 'ring' ? k * 0.8 : Math.min(1, k * 1.6);
      if (p.add) ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = p.color; ctx.strokeStyle = p.color;
      if (p.shape === 'square' || p.shape === 'confetti') { ctx.rotate(p.rot); ctx.fillRect(-rr / 2, -rr / 4, rr, rr / 2); }
      else if (p.shape === 'star') { ctx.rotate(p.rot); starPath(ctx, rr); ctx.fill(); }
      else if (p.shape === 'spark') { ctx.lineWidth = Math.max(1, rr); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-p.vx * s * 0.03, -p.vy * s * 0.03); ctx.stroke(); }
      else if (p.shape === 'ring') { ctx.lineWidth = Math.max(1, s * 0.08); ctx.beginPath(); ctx.arc(0, 0, rr, 0, TAU); ctx.stroke(); }
      else { ctx.beginPath(); ctx.arc(0, 0, rr, 0, TAU); ctx.fill(); }
      ctx.restore();
    }
  }

  function text(ctx, str, x, y, size, color, { align = 'center', glow = 0, weight = 800 } = {}) {
    ctx.font = `${weight} ${Math.round(size)}px ${HUD_FONT}`; ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillText(str, x, y + Math.max(1, size * 0.07));
    if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
    ctx.fillStyle = color; ctx.fillText(str, x, y); ctx.shadowBlur = 0;
  }

  function lifeIcon(ctx, x, y, s) {
    const img = image(heroFrames?.idle) || image(art.sprites?.hero);
    if (img) drawSprite(ctx, img, x, y, s * 1.3, { box: boxOf(img) });
    else { ctx.save(); ctx.translate(x, y); chomp(ctx, s * 0.55, 0, 0.5, colors.hero); ctx.restore(); }
  }
  function bonusIcon(ctx, x, y, s, index) {
    const img = image(art.sprites?.bonus);
    const color = BONUS_COLORS[index % BONUS_COLORS.length];
    if (img) {
      ctx.save(); ctx.translate(x, y); ctx.imageSmoothingEnabled = !pixel;
      drawSprite(ctx, tinted(img, color), 0, 0, s * 1.1, { box: boxOf(img) }); ctx.restore();
    } else { ctx.save(); ctx.translate(x, y); fruit(ctx, s * 0.6, color); ctx.restore(); }
  }

  function drawHud(ctx, state, ox, oy, s, mazeBottom) {
    const score = state.score, high = Math.max(state.high || 0, score);
    if (score !== fx.score) { if (score > fx.score) fx.scorePop = 1; fx.score = score; }
    const pop = 1 + fx.scorePop * 0.12, cx = ox + (W * s) / 2;
    text(ctx, 'SCORE', ox + s * 1, oy + s * 1, s * 0.72, colors.label, { align: 'left' });
    text(ctx, String(score), ox + s * 1, oy + s * 2.15, s * 1.15 * pop, '#ffffff', { align: 'left' });
    text(ctx, 'HIGH SCORE', cx, oy + s * 1, s * 0.72, colors.label);
    text(ctx, String(high), cx, oy + s * 2.15, s * 1.15, high > (state.high || 0) && score > 0 ? '#ffe14a' : '#ffffff');
    const total = content.endless ? '' : ` / ${game.levelCount}`;
    text(ctx, 'LEVEL', ox + W * s - s, oy + s * 1, s * 0.72, colors.label, { align: 'right' });
    text(ctx, `${state.level + 1}${total}`, ox + W * s - s, oy + s * 2.15, s * 1.15, '#ffffff', { align: 'right' });
    // Reserve lives and the level's bonus prizes.
    const by = mazeBottom + s * 1.15, reserve = Math.max(0, state.lives - 1);
    for (let i = 0; i < Math.min(reserve, 6); i++) {
      const k = i === reserve - 1 && fx.lifePop > 0 ? 1 + fx.lifePop * 0.6 : 1;
      ctx.save(); ctx.translate(ox + s * (1.6 + i * 1.8), by); ctx.scale(k, k); lifeIcon(ctx, 0, 0, s); ctx.restore();
    }
    const first = Math.max(0, state.level - 6);
    for (let i = state.level, n = 0; i >= first; i--, n++) bonusIcon(ctx, ox + W * s - s * (1.6 + n * 1.8), by, s, Math.min(i, content.bonus.length - 1));
  }

  function render(ctx, state, frame = {}) {
    const dt = frame.paused ? 0 : clamp(frame.dt ?? 1 / 60, 0, 0.1);
    const reduced = !!frame.reducedMotion;
    fx.t += dt;
    const cw = frame.cssWidth ?? ctx.canvas?.width ?? 448, ch = frame.cssHeight ?? ctx.canvas?.height ?? 576;
    const s = Math.max(1, Math.min(cw / W, ch / (H + HUD_TOP + HUD_BOTTOM)));
    const ox = Math.round((cw - W * s) / 2), oy = Math.round((ch - (H + HUD_TOP + HUD_BOTTOM) * s) / 2), my = oy + HUD_TOP * s;
    if (fx.lastPhase !== state.phase && state.phase === 'ready') fx.deathBurst = false;
    fx.lastPhase = state.phase;
    onEvents(frame.events ?? state.events ?? [], state);
    stepParticles(fx.particles, dt);
    fx.trauma = Math.max(0, fx.trauma - dt * 1.8); fx.scorePop = Math.max(0, fx.scorePop - dt * 4); fx.lifePop = Math.max(0, fx.lifePop - dt * 1.5);
    fx.popups = fx.popups.filter(p => (p.t += dt) < p.life);

    ctx.save();
    ctx.fillStyle = colors.letterbox; ctx.fillRect(0, 0, cw, ch);
    const shake = reduced ? 0 : fx.trauma * fx.trauma * s * 0.6;
    const sx = shake * Math.sin(fx.t * 53.1) * 0.8, sy = shake * Math.cos(fx.t * 61.7) * 0.8;
    ctx.translate(sx, sy);
    const X = x => ox + (x + 0.5) * s, Y = y => my + (y + 0.5) * s;

    // Maze: cached per level, size and flash state.
    const flash = state.phase === 'clear' && state.phaseT > 24 && Math.floor((state.phaseT - 24) / 12) % 2 === 0;
    const dpr = Math.max(1, ctx.getTransform?.().a || 1);
    const cache = layer(state.level, s, dpr, flash);
    if (cache) ctx.drawImage(cache, ox, my, W * s, H * s);
    else paintMaze(ctx, loopsFor(state.level), s, ox, my, colors, flash);

    ctx.save();
    ctx.beginPath(); ctx.rect(ox, my, W * s, H * s); ctx.clip();
    // Pellets: one path, a gentle shimmer travelling across the maze.
    const pel = state.pellets;
    ctx.fillStyle = colors.pellet; ctx.beginPath();
    for (let i = 0; i < pel.length; i++) {
      if (pel[i] !== 1) continue;
      const x = i % W, y = (i / W) | 0, k = reduced ? 1 : 1 + 0.2 * Math.sin(fx.t * 4 - (x + y) * 0.55), rr = s * 0.12 * k;
      ctx.moveTo(X(x) + rr, Y(y)); ctx.arc(X(x), Y(y), rr, 0, TAU);
    }
    ctx.fill();
    const blink = state.phase !== 'play' || Math.floor(fx.t * 3.5) % 2 === 0;
    for (let i = 0; i < pel.length; i++) {
      if (pel[i] !== 2) continue;
      const x = X(i % W), y = Y((i / W) | 0), rr = s * (0.36 + (reduced ? 0 : 0.04 * Math.sin(fx.t * 6)));
      ctx.globalAlpha = blink ? 1 : 0.35;
      if (ctx.createRadialGradient) {
        const g = ctx.createRadialGradient(x, y, rr * 0.4, x, y, rr * 2.2);
        g.addColorStop(0, rgba(colors.power, 0.55)); g.addColorStop(1, rgba(colors.power, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rr * 2.2, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = colors.power; ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.beginPath(); ctx.arc(x - rr * 0.3, y - rr * 0.3, rr * 0.3, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
    // Bonus prize.
    if (state.bonus && (state.bonus.t > 120 || Math.floor(fx.t * 6) % 2 === 0)) {
      const b = state.bonus, bob = reduced ? 0 : Math.sin(fx.t * 3) * s * 0.12;
      ctx.save(); ctx.translate(X(b.x), Y(b.y) + bob);
      if (!reduced) ctx.rotate(Math.sin(fx.t * 2.2) * 0.12);
      bonusIcon(ctx, 0, 0, s * 1.3, Math.min(state.level, content.bonus.length - 1));
      ctx.restore();
    }
    // Hunters, then the hero on top.
    const hideHunters = (state.phase === 'dying' && state.phaseT >= 36) || state.phase === 'clear';
    if (!hideHunters) for (const h of state.hunters) drawHunter(ctx, state, h, X, Y, s, reduced);
    if (state.pauseT > 0) { /* the hero hides while the score for an eaten hunter shows */ } else drawHero(ctx, state, X, Y, s, reduced);
    drawParticles(ctx, X, Y, s);
    for (const p of fx.popups) {
      const k = p.t / p.life;
      ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      text(ctx, p.text, X(p.x), Y(p.y) - k * s * 0.9, s * (0.85 + (k < 0.15 ? (0.15 - k) * 3 : 0)), p.color, { glow: s * 0.4 });
      ctx.globalAlpha = 1;
    }
    if (state.phase === 'ready') {
      const pulse = reduced ? 1 : 0.8 + 0.2 * Math.sin(fx.t * 6);
      ctx.globalAlpha = pulse;
      text(ctx, 'READY!', X(13.5), Y(17), s * 1.1, '#ffe14a', { glow: s * 0.5 });
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    ctx.restore();
    drawHud(ctx, state, ox, oy, s, my + H * s);
    // World-to-screen mapping for mods drawn on top (v2/kits/mods/compose.js).
    render.view = { X: x => X(x) + sx, Y: y => Y(y) + sy, s, clip: { x: ox, y: my, w: W * s, h: H * s }, hud: { x: ox + (W * s) / 2, y: my + H * s + s * 1.15 } };
  }
  render.fx = fx;
  return render;
}
