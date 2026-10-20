// 2D canvas renderer for composed games, with the default polish layer:
// pose-frame or procedural character animation, particles, screen shake,
// a smoothed look-ahead camera, parallax, shaded tiles and a styled HUD.
//
// render(ctx, state, options) is a function of (state, events). All visual
// state (animations, particles, camera) lives in render.fx, outside game
// state, so the simulation stays deterministic and replayable.
import {
  createAnim, stepAnim, bodyBob, breathe, pickFrame, paletteFrom, ambientTheme, rand, hashString,
  createParticles, addParticles, stepParticles, particlesFor, dustBurst, shakeFor, stepCamera, formatClock, hexToRgb,
} from './juice.js';

const HUD_FONT = '"Avenir Next", "Nunito", ui-rounded, "SF Pro Rounded", "Segoe UI", system-ui, sans-serif';
const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Generated art (spec.art) loads asynchronously; until an image is ready the
// renderer draws the placeholder glyph or color, so games are playable at once.
const images = new Map();
function image(url) {
  if (!url || typeof Image === 'undefined') return null;
  let entry = images.get(url);
  if (!entry) { const img = new Image(); entry = { img, ready: false }; img.onload = () => { entry.ready = true; }; img.src = url; images.set(url, entry); }
  return entry.ready ? entry.img : null;
}
function surface(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  return null;
}
// Emoji glyphs are rasterized once so they animate, flip and flash like sprites.
const glyphs = new Map();
function glyphImage(glyph) {
  if (!glyph) return null;
  if (glyphs.has(glyph)) return glyphs.get(glyph);
  const c = surface(128, 128);
  if (c) {
    const g = c.getContext('2d');
    g.font = '100px system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.fillText(glyph, 64, 70);
  }
  glyphs.set(glyph, c); return c;
}
const whites = new WeakMap(), averages = new WeakMap();
function whiteOf(img) {
  let c = whites.get(img); if (c !== undefined) return c;
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  c = surface(w, h);
  if (c) { const g = c.getContext('2d'); g.drawImage(img, 0, 0); g.globalCompositeOperation = 'source-atop'; g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); }
  whites.set(img, c); return c;
}
/** Average opaque color of an image (scaled by shade), for debris and haze that match the art. */
function colorOf(img, shade = 1) {
  if (!img) return null;
  if (!averages.has(img)) {
    let rgb = null;
    try {
      const c = surface(8, 8), g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, 8, 8);
      const d = g.getImageData(0, 0, 8, 8).data; let r = 0, gg = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
      if (n) rgb = [r / n, gg / n, b / n];
    } catch {}
    averages.set(img, rgb);
  }
  const rgb = averages.get(img);
  return rgb && `rgb(${rgb.map(v => Math.round(Math.min(255, v * shade))).join(',')})`;
}
const noise = t => Math.sin(t * 41.3) * 0.6 + Math.sin(t * 73.1 + 1.7) * 0.4;
const easeOut = t => 1 - (1 - t) * (1 - t);

function heartPath(ctx, cx, cy, size) {
  const s = size / 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.92);
  ctx.bezierCurveTo(cx - s * 1.55, cy - s * 0.05, cx - s * 0.75, cy - s * 1.3, cx, cy - s * 0.42);
  ctx.bezierCurveTo(cx + s * 0.75, cy - s * 1.3, cx + s * 1.55, cy - s * 0.05, cx, cy + s * 0.92);
  ctx.closePath();
}
function starPath(ctx, r) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU, rr = i % 2 ? r * 0.35 : r; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  ctx.closePath();
}

export function createRenderer(game, { fx } = {}) {
  const { spec, width, height } = game;
  const art = spec.art || {};
  const side = spec.view !== 'topdown';
  const palette = paletteFrom(spec.background);
  const theme = ambientTheme(spec);
  const pixel = /pixel/i.test(art.style || '');
  const mod = id => spec.modules.find(m => m.use === id);
  const runSpeed = mod('platformer')?.with?.runSpeed ?? mod('topdown')?.with?.speed ?? 8;
  const maxHp = mod('health') ? (mod('health').with?.hp ?? 3) : null;
  const hasTimer = !!mod('timer');
  const rows = spec.level.rows, legend = spec.level.legend;
  const levelKinds = new Set(rows.flatMap(row => [...row].map(ch => legend[ch]).filter(Boolean)));
  const kindWith = tag => Object.entries(spec.entities).find(([k, d]) => d.tags?.includes(tag) && levelKinds.has(k))?.[0];
  const pickupKind = kindWith('collectible'), enemyKind = kindWith('enemy');
  const showEnemies = !!enemyKind && !!(mod('patrol') || mod('shooter'));
  const kindAt = rows.map(row => [...row].map(ch => legend[ch]));
  const tileColors = kindAt.map(row => row.map(kind => kind && spec.entities[kind]?.solid ? spec.entities[kind].color || '#556' : null));
  const tileArt = { ground: art.tiles?.ground, platform: art.tiles?.platform };
  const ts = art.tileset?.url ? { cols: 2, rows: 2, inset: 0, ...art.tileset, cells: { groundTop: [0, 0], groundFill: [1, 0], platform: [0, 1], wall: [1, 1], ...(art.tileset.cells || {}) } } : null;
  const seed = hashString(spec.id || spec.title || 'game');
  const ridgeRand = rand(seed);
  const ridges = [0, 1].map(() => [0, 1, 2].map(i => ({ f: (0.004 + ridgeRand() * 0.006) * (i + 1), a: 1 / (i + 1.4), p: ridgeRand() * TAU })));
  const jagged = theme !== 'leaves' && theme !== 'bubbles';
  const [ar, ag, ab] = hexToRgb(palette.accent), accentA = a => `rgba(${ar},${ag},${ab},${a})`;
  const dustColor = side ? 'rgba(236,228,214,.85)' : 'rgba(220,220,220,.6)';

  const v = fx || {};
  const resetFx = () => Object.assign(v, {
    anims: new Map(), seen: new Map(), particles: createParticles(), ghosts: [], flyers: [], cam: null, trauma: 0,
    hud: { pick: 0, hp: null, lost: -1, lostT: 9, kills: 0, killPop: 0, pickupAt: null }, status: 'playing', statusT: 0, introPrev: 1, sparkT: 0,
  });
  if (!v.anims) { resetFx(); Object.assign(v, { time: 0, lastFrame: -1, specId: null, r: rand(seed || 1), ambient: null, ambientKey: '' }); }

  const solidAt = (state, x, y) => x < 0 || x >= width ? true : y < 0 || y >= height ? false : state.solid[y * width + x] === 1;
  const spriteOf = (kind, pose) => {
    const framed = pickFrame(art.frames?.[kind], pose);
    const img = (framed && image(framed)) || image(art.sprites?.[kind]);
    if (img) return { img, sprite: true };
    const g = glyphImage(spec.entities[kind]?.glyph);
    return g ? { img: g, sprite: false } : null;
  };
  const iconOf = kind => image(art.sprites?.[kind]) || glyphImage(spec.entities[kind]?.glyph);

  function ambientFor(w, h, reduced) {
    const key = `${Math.round(w)}x${Math.round(h)}:${reduced}`;
    if (v.ambientKey === key && v.ambient) return v.ambient;
    const r = rand(seed ^ 0x9e37), n = Math.round(clamp((w * h) / (theme === 'stars' ? 9000 : 14000), 18, theme === 'stars' ? 90 : 80) * (reduced ? 0.4 : 1));
    v.ambient = Array.from({ length: n }, () => ({ x: r() * w, y: r() * h, z: 0.3 + r() * 0.7, s: r() * TAU, k: r() }));
    v.ambientKey = key; return v.ambient;
  }

  function drawAmbient(ctx, list, w, h, dt, camDx, camDy, front, reduced) {
    const speed = reduced ? 0.4 : 1;
    for (const p of list) {
      if ((p.z >= 0.65) !== front && theme !== 'stars') continue;
      if (theme === 'stars' && front) continue;
      const z = p.z, par = theme === 'stars' ? 0.08 : 0.6;
      p.x -= camDx * z * par; p.y -= camDy * z * par * 0.5;
      const t = v.time * speed + p.s;
      let vx = 0, vy = 0;
      if (theme === 'snow') { vy = (18 + p.k * 32) * z; vx = Math.sin(t * 1.3) * 14 * z; }
      else if (theme === 'embers') { vy = -(16 + p.k * 30) * z; vx = Math.sin(t * 2.1) * 10 * z; }
      else if (theme === 'dust') { vx = (6 + p.k * 14) * z; vy = Math.sin(t * 0.7) * 4; }
      else if (theme === 'bubbles') { vy = -(12 + p.k * 26) * z; vx = Math.sin(t * 2.4) * 9 * z; }
      else if (theme === 'leaves') { vy = (12 + p.k * 18) * z; vx = (8 + Math.sin(t * 1.1) * 18) * z; }
      p.x += vx * dt * speed; p.y += vy * dt * speed;
      if (p.x < -20) p.x += w + 40; else if (p.x > w + 20) p.x -= w + 40;
      if (p.y < -20) p.y += h + 40; else if (p.y > h + 20) p.y -= h + 40;
      ctx.save(); ctx.translate(p.x, p.y);
      if (theme === 'snow') { ctx.globalAlpha = 0.5 + 0.4 * z; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, 1 + 2.4 * z * (0.6 + p.k * 0.6), 0, TAU); ctx.fill(); }
      else if (theme === 'embers') { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (0.4 + 0.5 * Math.abs(Math.sin(t * 5))) * z; ctx.fillStyle = p.k > 0.5 ? '#ffb347' : '#ff6a2a'; ctx.beginPath(); ctx.arc(0, 0, 0.8 + 2 * z, 0, TAU); ctx.fill(); }
      else if (theme === 'dust') { ctx.globalAlpha = 0.18 + 0.25 * z; ctx.fillStyle = '#fff1d6'; ctx.beginPath(); ctx.arc(0, 0, 0.8 + 1.6 * z, 0, TAU); ctx.fill(); }
      else if (theme === 'bubbles') { const r = 2 + 4.5 * z * (0.5 + p.k); ctx.globalAlpha = 0.25 + 0.35 * z; ctx.strokeStyle = '#e8fbff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-r * 0.35, -r * 0.35, r * 0.22, 0, TAU); ctx.fill(); }
      else if (theme === 'leaves') { ctx.rotate(t * 1.6); ctx.globalAlpha = 0.55 + 0.35 * z; ctx.fillStyle = p.k > 0.66 ? '#e8963a' : p.k > 0.33 ? '#c9d65a' : '#6fbf5b'; ctx.beginPath(); ctx.ellipse(0, 0, 2 + 3.5 * z, 1 + 1.5 * z, 0, 0, TAU); ctx.fill(); }
      else { ctx.globalAlpha = (0.3 + 0.7 * Math.abs(Math.sin(t * (reduced ? 0.4 : 1.4)))) * (0.4 + 0.6 * z); ctx.fillStyle = p.k > 0.8 ? '#ffe9b0' : '#ffffff'; ctx.fillRect(-0.5 - z, -0.5 - z, 1 + 2 * z, 1 + 2 * z); }
      ctx.restore();
    }
  }

  function render(ctx, state, o = {}) {
    const w = o.cssWidth ?? ctx.canvas.width, h = o.cssHeight ?? ctx.canvas.height;
    const reduced = !!o.reducedMotion;
    const dt = o.paused ? 0 : clamp(o.dt ?? 1 / 60, 0, 0.05);
    v.time += dt;
    const reset = o.snap || state.specId !== v.specId || state.frame < v.lastFrame;
    if (reset) resetFx();
    const events = o.events ?? (state.frame !== v.lastFrame ? state.events : []);
    v.lastFrame = state.frame; v.specId = state.specId;

    const tile = Math.max(8, Math.floor(Math.min(h / Math.min(height, 14), w / Math.min(width, 24))));
    const viewW = w / tile, viewH = h / tile;
    const player = state.entities.find(e => e.tags.includes('player'));
    const hp = state.vars.hp;
    const invuln = (state.modules.health?.invuln || 0) > 0;
    const hpDropped = v.hud.hp != null && hp != null && hp < v.hud.hp;
    if (hpDropped) { v.hud.lost = hp; v.hud.lostT = 0; }
    v.hud.hp = hp ?? null;

    // Removals since last frame: enemies pop into debris, pickups fly to the HUD.
    const removed = [];
    const now = new Set(state.entities.map(e => e.id));
    for (const [id, old] of v.seen) if (!now.has(id)) removed.push(old);
    v.seen = new Map(state.entities.map(e => [e.id, { id: e.id, kind: e.kind, tags: e.tags, x: e.x, y: e.y, w: e.w, h: e.h, face: e.face }]));
    for (const r of removed) r.color = spec.entities[r.kind]?.color || colorOf(spriteOf(r.kind, 'idle')?.img);
    const effective = events.filter(e => e.name !== 'hurt' || hpDropped);
    addParticles(v.particles, particlesFor({ events: effective, removed, player, r: v.r, palette }));
    if (!reduced) v.trauma = Math.min(1, v.trauma + shakeFor(effective));
    for (const r of removed) {
      v.anims.delete(r.id);
      if (r.tags.includes('enemy')) { v.ghosts.push({ ...r, t: 0 }); v.hud.killPop = 1; }
      if (r.tags.includes('collectible')) v.flyers.push({ kind: r.kind, wx: r.x + r.w / 2, wy: r.y + r.h / 2, t: 0, from: null });
    }

    // Animation state per entity (player and enemies).
    for (const e of state.entities) {
      const isPlayer = e.tags.includes('player');
      if (!isPlayer && !e.tags.includes('enemy')) continue;
      const prev = v.anims.get(e.id) || createAnim();
      const grounded = !side ? true : isPlayer ? !!e.data?.grounded : Math.abs(e.vy) < 0.01;
      const a = stepAnim(prev, e, { dt, grounded, invuln: isPlayer && invuln, side, runSpeed });
      if (isPlayer) {
        if (hpDropped) a.flash = 0.14;
        const fx0 = e.x + e.w / 2, fy0 = e.y + e.h;
        if (a.event === 'land') addParticles(v.particles, dustBurst(fx0, fy0, a.impact, v.r, dustColor));
        if (a.event === 'takeoff') addParticles(v.particles, dustBurst(fx0, fy0, 0.1, v.r, dustColor));
        const fast = Math.abs(e.vx) > runSpeed * 0.55, skid = Math.abs(e.vx) > 2 && Math.sign(e.vx) !== Math.sign(e.face);
        if (grounded && dt > 0 && (fast || skid)) {
          a.dust += dt;
          if (a.dust > (skid ? 0.04 : 0.09)) {
            a.dust = 0;
            addParticles(v.particles, dustBurst(fx0 - Math.sign(e.vx) * e.w * 0.4, fy0, 0.05, v.r, dustColor).slice(0, 2).map(p => ({ ...p, vx: -Math.sign(e.vx) * Math.abs(p.vx) * 0.6 })));
          }
        }
      }
      v.anims.set(e.id, a);
    }
    if (state.status !== v.status) { v.status = state.status; v.statusT = 0; }
    v.statusT += dt;

    // Intro drop-in: the player falls in from above and lands with a squash.
    const intro = o.intro ?? 1;
    if (player && v.introPrev < 1 && intro >= 1) {
      const a = v.anims.get(player.id); if (a) { a.sx = 1.3; a.sy = 0.72; }
      addParticles(v.particles, dustBurst(player.x + player.w / 2, player.y + player.h, 0.8, v.r, dustColor));
    }
    v.introPrev = intro;

    // Camera: smoothed follow with look-ahead and a vertical dead-zone.
    const prevCam = v.cam;
    if (o.attract) {
      const cx = width / 2 + Math.sin(v.time * 0.12) * Math.max(0, width - viewW) / 2;
      const cy = player ? player.y : height / 2;
      v.cam = stepCamera(null, { tx: cx, ty: cy, viewW, viewH, width, height, side });
    } else {
      const t = player ? { tx: player.x + player.w / 2, ty: player.y + player.h / 2, vx: player.vx, face: player.face, grounded: !!player.data?.grounded } : { tx: width / 2, ty: height / 2 };
      v.cam = stepCamera(v.cam, { ...t, dt: dt || 1 / 60, viewW, viewH, width, height, side, snap: !v.cam });
    }
    const camX = v.cam.x, camY = v.cam.y;
    const camDx = prevCam ? (camX - prevCam.x) * tile : 0, camDy = prevCam ? (camY - prevCam.y) * tile : 0;
    v.trauma = Math.max(0, v.trauma - dt * 1.7);
    const shake = reduced ? 0 : Math.pow(v.trauma, 1.5) * tile * 0.6;
    const shakeX = shake * noise(v.time), shakeY = shake * noise(v.time + 13.7);
    const sx = x => Math.round((x - camX) * tile), sy = y => Math.round((y - camY) * tile);

    ctx.imageSmoothingEnabled = !pixel; if (!pixel) ctx.imageSmoothingQuality = 'high';
    // ---- sky and background ----
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, palette.skyTop); sky.addColorStop(1, palette.skyBottom);
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    const ambient = ambientFor(w, h, reduced);
    ctx.save(); ctx.translate(shakeX * 0.3, shakeY * 0.3);
    const bg = image(art.background);
    if (bg) {
      const scale = Math.max(w / bg.width, h / bg.height) * 1.2;
      const bw = bg.width * scale, bh = bg.height * scale;
      const px = -((camX / Math.max(1, width - viewW)) || 0) * (bw - w), py = -((camY / Math.max(1, height - viewH)) || 0) * (bh - h);
      ctx.drawImage(bg, clamp(px, w - bw, 0), clamp(py, h - bh, 0), bw, bh);
    }
    if (theme === 'stars') drawAmbient(ctx, ambient, w, h, dt, camDx, camDy, false, reduced);
    if (side) { // tinted far layers: generated ridgelines at two depths
      // With painted scenery, the ridges take the art's own average color so they sit in it as distant hills.
      const layers = bg ? [[0.16, 0.66, 0.12, colorOf(bg, 0.86), colorOf(bg, 0.7), 0.85], [0.34, 0.78, 0.09, colorOf(bg, 0.66), colorOf(bg, 0.5), 0.9]]
        : [[0.16, 0.6, 0.13, palette.far, palette.skyBottom, 0.9], [0.34, 0.74, 0.1, palette.mid, palette.skyBottom, 0.95]];
      layers.forEach(([par, base, amp, color, low, alpha], li) => {
        const off = camX * tile * par, yb = h * base - camY * tile * par * 0.25;
        const grad = ctx.createLinearGradient(0, yb - h * amp, 0, h);
        grad.addColorStop(0, color); grad.addColorStop(1, low);
        ctx.globalAlpha = alpha; ctx.fillStyle = grad; ctx.beginPath(); ctx.moveTo(0, h);
        for (let x = 0; x <= w + 8; x += 8) {
          let y = 0; for (const r of ridges[li]) { const s = Math.sin((x + off) * r.f + r.p); y += r.a * (jagged ? 1 - Math.abs(s) * 2 : s); }
          ctx.lineTo(x, yb - y * h * amp * 0.6);
        }
        ctx.lineTo(w, h); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
      });
    }
    ctx.restore();
    if (theme !== 'stars') drawAmbient(ctx, ambient, w, h, dt, camDx, camDy, false, reduced);

    ctx.save(); ctx.translate(Math.round(shakeX), Math.round(shakeY));
    // ---- tiles ----
    const x0 = Math.max(0, Math.floor(camX)), x1 = Math.min(width, Math.ceil(camX + viewW));
    const y0 = Math.max(0, Math.floor(camY)), y1 = Math.min(height, Math.ceil(camY + viewH));
    const sheet = ts && image(ts.url);
    const cell = sheet && ((c) => { const cw = sheet.width / ts.cols, ch = sheet.height / ts.rows; return [(c[0] + ts.inset) * cw, (c[1] + ts.inset) * ch, cw * (1 - 2 * ts.inset), ch * (1 - 2 * ts.inset)]; });
    if (!side) { // top-down floor texture
      ctx.fillStyle = 'rgba(255,255,255,.035)';
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if ((x + y) % 2 && !solidAt(state, x, y)) ctx.fillRect(sx(x), sy(y), tile, tile);
    }
    const shadows = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const color = tileColors[y][x];
      if (!color || !state.solid[y * width + x]) continue;
      const kind = kindAt[y][x], above = solidAt(state, x, y - 1) && y > 0, below = solidAt(state, x, y + 1);
      const X = sx(x), Y = sy(y), S = tile + 1;
      if (sheet) {
        const c = !side ? ts.cells.wall : kind === 'platform' ? ts.cells.platform : above ? ts.cells.groundFill : ts.cells.groundTop;
        ctx.drawImage(sheet, ...cell(c), X, Y, S, S);
      } else {
        const tex = image(tileArt[kind]);
        if (tex) ctx.drawImage(tex, X, Y, S, S);
        else {
          ctx.fillStyle = color; ctx.fillRect(X, Y, S, S);
          ctx.fillStyle = 'rgba(0,0,0,.14)'; ctx.fillRect(X, Y + tile * 0.82, S, tile * 0.18 + 1);
          ctx.fillStyle = 'rgba(255,255,255,.07)'; const k = (x * 7 + y * 13) % 5; ctx.fillRect(X + tile * (0.15 + k * 0.13), Y + tile * (0.3 + (k % 3) * 0.18), Math.max(1, tile * 0.1), Math.max(1, tile * 0.1));
        }
      }
      // Ambient occlusion deeper inside ground, lit top edges, side edges.
      if (above) { let d = 1; while (d < 4 && solidAt(state, x, y - d - 1) && y - d - 1 >= 0) d++; ctx.fillStyle = `rgba(0,0,0,${0.06 * d})`; ctx.fillRect(X, Y, S, S); }
      else {
        ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.fillRect(X, Y, S, Math.max(2, tile * 0.12));
        ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.fillRect(X, Y, S, Math.max(1, Math.round(tile * 0.04)));
      }
      if (!solidAt(state, x - 1, y)) { ctx.fillStyle = 'rgba(0,0,0,.14)'; ctx.fillRect(X, Y, Math.max(1, tile * 0.06), S); }
      if (!solidAt(state, x + 1, y)) { ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(X + tile - Math.max(1, tile * 0.06), Y, Math.max(1, tile * 0.06) + 1, S); }
      if (!below && y + 1 < height) shadows.push(X, Y + tile, S);
    }
    for (let i = 0; i < shadows.length; i += 3) { // soft shadow under overhangs
      const X = shadows[i], Y = shadows[i + 1], S = shadows[i + 2];
      ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(X, Y, S, tile * 0.12);
      ctx.fillStyle = 'rgba(0,0,0,.11)'; ctx.fillRect(X, Y + tile * 0.12, S, tile * 0.14);
      ctx.fillStyle = 'rgba(0,0,0,.05)'; ctx.fillRect(X, Y + tile * 0.26, S, tile * 0.18);
    }

    // ---- goal glow and beacon ----
    const pulse = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(v.time * 3);
    const goals = state.entities.filter(e => e.tags.includes('goal'));
    for (const g of goals) {
      const gx = sx(g.x + g.w / 2), gy = sy(g.y + g.h / 2);
      if (gx < -tile * 4 || gx > w + tile * 4) continue;
      ctx.save();
      const beam = ctx.createLinearGradient(0, gy, 0, 0);
      beam.addColorStop(0, accentA(0.22 + 0.1 * pulse)); beam.addColorStop(1, accentA(0));
      ctx.fillStyle = beam; ctx.fillRect(gx - tile * 0.4, 0, tile * 0.8, gy);
      const r = tile * (1.25 + 0.3 * pulse), glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
      glow.addColorStop(0, accentA(0.75)); glow.addColorStop(0.45, accentA(0.3)); glow.addColorStop(1, accentA(0));
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(gx, gy, r, 0, TAU); ctx.fill();
      if (!reduced) { // a ring that pulses outward
        const k = (v.time * 0.8) % 1;
        ctx.strokeStyle = accentA(0.7 * (1 - k)); ctx.lineWidth = Math.max(1.5, tile * 0.08);
        ctx.beginPath(); ctx.arc(gx, gy, tile * (0.6 + 1.4 * k), 0, TAU); ctx.stroke();
      }
      ctx.restore();
      if (!reduced && dt > 0 && (v.sparkT += dt) > 0.22) { v.sparkT = 0; addParticles(v.particles, [{ x: g.x + v.r() * g.w, y: g.y + g.h * 0.8, vx: 0, vy: -1.6 - v.r(), g: 0, drag: 0.5, life: 1, max: 1, size: 0.08, shape: 'star', rot: 0, spin: 3, grow: 0, add: true, color: palette.accent }]); }
    }

    // ---- entities ----
    const layer = e => e.tags.includes('player') ? 5 : e.tags.includes('projectile') ? 4 : e.tags.includes('enemy') ? 3 : e.tags.includes('collectible') ? 2 : e.tags.includes('hazard') ? 1 : 0;
    const sorted = [...state.entities].sort((p, q) => layer(p) - layer(q));
    for (const e of sorted) {
      const def = spec.entities[e.kind] || {};
      const px = sx(e.x), py = sy(e.y), pw = e.w * tile, ph = e.h * tile;
      if (px + pw < -tile * 2 || py + ph < -tile * 8 || px > w + tile * 2 || py > h + tile * 2) continue;
      const isPlayer = e.tags.includes('player'), isEnemy = e.tags.includes('enemy'), isPickup = e.tags.includes('collectible');
      if (e.tags.includes('projectile') && !art.sprites?.[e.kind]) {
        const cx = px + pw / 2, cy = py + ph / 2, len = 0.045 * tile;
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
        ctx.strokeStyle = palette.accent; ctx.globalAlpha = 0.5; ctx.lineWidth = pw * 1.1;
        ctx.beginPath(); ctx.moveTo(cx - e.vx * len, cy - e.vy * len); ctx.lineTo(cx, cy); ctx.stroke();
        ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, pw * 0.45, 0, TAU); ctx.fill();
        ctx.restore(); continue;
      }
      const a = v.anims.get(e.id);
      const src = spriteOf(e.kind, a?.pose || 'idle');
      const size = Math.max(pw, ph) * (src?.sprite ? 1.35 : 1.25) * (e.tags.includes('goal') ? 1.5 : 1);
      let scx = 1, scy = 1, rot = 0, dy = 0, alpha = 1, white = 0;
      const phase = e.id * 1.7;
      if (isPlayer && a) {
        scx = a.sx; scy = a.sy * breathe(a, reduced); dy = -bodyBob(a, { reduced }) * tile; rot = side ? a.lean : 0;
        if (invuln) {
          if (a.flash > 0) { rot = -(e.face || 1) * 0.22; white = reduced ? 0 : 1; }
          alpha = reduced ? 0.6 : Math.floor(v.time * 16) % 2 ? 0.3 : 1;
        }
        if (state.status === 'won') { const t = v.statusT; dy -= Math.abs(Math.sin(t * 7)) * 0.7 * tile * (reduced ? 0 : 1); alpha = 1; }
        else if (state.status === 'lost' && !(state.counts.fell > 0 && e.y > height)) {
          const t = Math.min(v.statusT, 1.6); dy += (-7 * t + 22 * t * t) * tile * (reduced ? 0 : 1); rot += reduced ? 0 : t * 6; alpha = reduced ? 0.5 : 1;
        }
        if (intro < 1) dy -= (1 - intro * intro) * (py + ph + tile * 2);
      } else if (isEnemy && a) {
        const t = v.time * 11 + phase;
        if (Math.abs(e.vx) > 0.1 && !reduced) { rot = Math.sin(t) * 0.08; dy = -Math.abs(Math.sin(t)) * 0.05 * tile; }
        scy = 1 + (reduced ? 0 : Math.sin(v.time * 3 + phase) * 0.03);
      } else if (isPickup && !reduced) {
        dy = -(Math.sin(v.time * 3 + phase) * 0.1 + 0.08) * tile;
        scx = scy = 1 + Math.sin(v.time * 4 + phase) * 0.04;
        white = Math.pow(Math.max(0, Math.sin(v.time * 2.2 + phase)), 24) * 0.5;
      }
      // contact shadow
      if (isPlayer || isEnemy || isPickup) {
        let gyT = null;
        if (!side) gyT = e.y + e.h; else for (let ty = Math.floor(e.y + e.h - 0.01); ty < Math.min(height, Math.floor(e.y + e.h) + 8); ty++) { if (ty >= 0 && solidAt(state, Math.floor(e.x + e.w / 2), ty)) { gyT = ty; break; } }
        if (gyT != null) {
          const dist = Math.max(0, gyT - (e.y + e.h)) + (isPickup ? 0.25 : 0), k = Math.max(0, 1 - dist / 6);
          if (k > 0 && !(isPlayer && intro < 1)) { ctx.fillStyle = `rgba(0,0,0,${0.28 * k * alpha})`; ctx.beginPath(); ctx.ellipse(px + pw / 2, sy(gyT), pw * 0.5 * (0.5 + 0.5 * k) * scx, Math.max(1.5, tile * 0.09), 0, 0, TAU); ctx.fill(); }
        }
      }
      if (isPickup) { // soft glow behind pickups
        ctx.save();
        const g = ctx.createRadialGradient(px + pw / 2, py + ph / 2 + dy, 0, px + pw / 2, py + ph / 2 + dy, pw * 1.1);
        g.addColorStop(0, accentA(0.32)); g.addColorStop(1, accentA(0)); ctx.fillStyle = g; ctx.fillRect(px - pw, py - ph + dy, pw * 3, ph * 3); ctx.restore();
      }
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(px + pw / 2, py + ph + dy + size * (src?.sprite ? 0.06 : 0.04));
      ctx.rotate(rot);
      const flip = e.face < 0 && (isPlayer || (isEnemy && src?.sprite)) ? -1 : 1;
      ctx.scale(scx * flip, scy);
      if (src) {
        ctx.drawImage(src.img, -size / 2, -size, size, size);
        if (white > 0) { const wi = whiteOf(src.img); if (wi) { ctx.globalAlpha = alpha * white; ctx.drawImage(wi, -size / 2, -size, size, size); } }
      } else {
        ctx.fillStyle = def.color || '#ccc'; ctx.beginPath(); ctx.roundRect(-pw / 2, -ph, pw, ph, Math.min(pw, ph) / 4); ctx.fill();
      }
      ctx.restore();
    }

    // ---- defeated enemies: squish-flash, then pop ----
    v.ghosts = v.ghosts.filter(gh => (gh.t += dt) < 0.32);
    for (const gh of v.ghosts) {
      const src = spriteOf(gh.kind, 'hurt'); if (!src) continue;
      const pw = gh.w * tile, ph = gh.h * tile, size = Math.max(pw, ph) * (src.sprite ? 1.35 : 1.25);
      const squish = gh.t < 0.1, k = squish ? 0 : (gh.t - 0.1) / 0.22;
      ctx.save(); ctx.translate(sx(gh.x) + pw / 2, sy(gh.y) + ph + size * 0.05);
      ctx.globalAlpha = squish ? 1 : 1 - k;
      ctx.scale((squish ? 1.4 : 1.4 + k * 0.4) * (gh.face < 0 && src.sprite ? -1 : 1), squish ? 0.55 : 0.55 * (1 - k));
      ctx.drawImage(src.img, -size / 2, -size, size, size);
      if (!reduced) { const wi = whiteOf(src.img); if (wi) { ctx.globalAlpha = squish ? 0.85 : 0.5 * (1 - k); ctx.drawImage(wi, -size / 2, -size, size, size); } }
      ctx.restore();
    }

    // ---- particles ----
    stepParticles(v.particles, dt);
    for (const p of v.particles.list) {
      const k = p.life / p.max, r = Math.max(0.5, p.size * tile * (1 + p.grow * (1 - k)));
      const X = (p.x - camX) * tile, Y = (p.y - camY) * tile;
      if (X < -40 || Y < -40 || X > w + 40 || Y > h + 40) continue;
      ctx.save(); ctx.globalAlpha = p.shape === 'ring' ? k * 0.8 : Math.min(1, k * 1.6);
      if (p.add) ctx.globalCompositeOperation = 'lighter';
      ctx.translate(X, Y); ctx.fillStyle = ctx.strokeStyle = p.color;
      if (p.shape === 'square') { ctx.rotate(p.rot); ctx.fillRect(-r / 2, -r / 2, r, r); }
      else if (p.shape === 'confetti') { ctx.rotate(p.rot); ctx.scale(Math.cos(p.rot * 1.7), 1); ctx.fillRect(-r / 2, -r / 4, r, r / 2); }
      else if (p.shape === 'star') { ctx.rotate(p.rot); starPath(ctx, r); ctx.fill(); }
      else if (p.shape === 'spark') { ctx.lineWidth = Math.max(1, r); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-p.vx * tile * 0.03, -p.vy * tile * 0.03); ctx.stroke(); }
      else if (p.shape === 'ring') { ctx.lineWidth = Math.max(1, tile * 0.06); ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke(); }
      else { ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill(); }
      ctx.restore();
    }
    ctx.restore();
    drawAmbient(ctx, ambient, w, h, 0, 0, 0, true, reduced);

    // Vignette.
    if (!v.vig || v.vig.w !== w || v.vig.h !== h) {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.max(w, h) * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.32)'); v.vig = { w, h, g };
    }
    ctx.fillStyle = v.vig.g; ctx.fillRect(0, 0, w, h);

    if (o.hud !== false) drawHud(ctx, state, { w, h, dt, reduced, label: o.label, tile, camX, camY, goals });
    if (!o.screens && state.status !== 'playing') { // standalone hosts without screens
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, h / 2 - 40, w, 80);
      ctx.fillStyle = state.status === 'won' ? '#9cf6a4' : '#ff9c8a';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `800 28px ${HUD_FONT}`;
      ctx.fillText(state.status === 'won' ? 'You win!' : 'Game over', w / 2, h / 2 - 8);
      ctx.font = `600 14px ${HUD_FONT}`; ctx.fillStyle = '#fff';
      ctx.fillText('Press A / Space to play again', w / 2, h / 2 + 20);
    }
  }

  function pill(ctx, x, y, w, h) {
    ctx.fillStyle = palette.panel; ctx.strokeStyle = palette.edge; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, h / 2); ctx.fill(); ctx.stroke();
  }
  function text(ctx, str, x, y, size, color = palette.ink, align = 'left') {
    ctx.font = `800 ${Math.round(size)}px ${HUD_FONT}`; ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillText(str, x, y + Math.max(1, size * 0.08));
    ctx.fillStyle = color; ctx.fillText(str, x, y);
    return ctx.measureText(str).width;
  }

  function drawHud(ctx, state, { w, h, dt, reduced, label, tile, camX, camY, goals }) {
    const s = clamp(Math.min(w / 760, h / 430), 0.7, 1.5);
    const pad = 12 * s, H = 34 * s, top = pad;
    let x = pad;
    v.hud.lostT += dt; v.hud.pick = Math.max(0, v.hud.pick - dt * 4); v.hud.killPop = Math.max(0, v.hud.killPop - dt * 4);
    ctx.save();
    // Hearts.
    if (maxHp != null && state.vars.hp != null) {
      const hp = state.vars.hp, many = maxHp > 8, hs = 20 * s, gap = 6 * s, n = many ? 1 : maxHp;
      const pw = n * hs + (n - 1) * gap + 24 * s + (many ? 44 * s : 0);
      pill(ctx, x, top, pw, H);
      for (let i = 0; i < n; i++) {
        const cx = x + 12 * s + hs / 2 + i * (hs + gap), cy = top + H / 2 + 1 * s;
        const full = many ? hp > 0 : i < hp;
        let k = 1;
        if (!reduced && i === v.hud.lost && v.hud.lostT < 0.35) k = 1 + 0.5 * (1 - v.hud.lostT / 0.35);
        if (!reduced && full && hp === 1) k *= 1 + 0.12 * Math.pow(Math.max(0, Math.sin(v.time * 6)), 4);
        heartPath(ctx, cx, cy, hs * k);
        if (full) {
          const g = ctx.createLinearGradient(0, cy - hs / 2, 0, cy + hs / 2);
          g.addColorStop(0, palette.heart); g.addColorStop(1, palette.heartDark);
          ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = 'rgba(40,0,10,.55)'; ctx.lineWidth = 1.5 * s; ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.ellipse(cx - hs * 0.22 * k, cy - hs * 0.18 * k, hs * 0.11 * k, hs * 0.07 * k, -0.6, 0, TAU); ctx.fill();
        } else {
          ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.5 * s; ctx.stroke();
        }
      }
      if (many) text(ctx, `× ${hp}`, x + 12 * s + hs + 8 * s, top + H / 2, 17 * s);
      x += pw + 8 * s;
    }
    // Pickups.
    if (pickupKind && state.vars.collected != null) {
      const total = state.vars.collected + (state.vars.remaining ?? 0);
      const str = `${state.vars.collected}/${total}`;
      ctx.font = `800 ${Math.round(17 * s)}px ${HUD_FONT}`;
      const tw = ctx.measureText(str).width, icon = 22 * s, pw = 12 * s + icon + 8 * s + tw + 14 * s;
      pill(ctx, x, top, pw, H);
      const img = iconOf(pickupKind), k = 1 + v.hud.pick * 0.45, cx = x + 12 * s + icon / 2, cy = top + H / 2;
      v.hud.pickupAt = { x: cx, y: cy };
      if (img) ctx.drawImage(img, cx - icon * k / 2, cy - icon * k / 2, icon * k, icon * k);
      text(ctx, str, x + 12 * s + icon + 8 * s, cy, 17 * s * (1 + v.hud.pick * 0.15), v.hud.pick > 0.05 ? palette.accent : palette.ink);
      x += pw + 8 * s;
    } else v.hud.pickupAt = null;
    if (label) text(ctx, label, pad + 4 * s, top + H + 14 * s, 12 * s, palette.muted);
    // Timer.
    if (hasTimer && state.vars.time_left != null) {
      const left = state.vars.time_left, low = left <= 10, str = formatClock(left);
      ctx.font = `800 ${Math.round(18 * s)}px ${HUD_FONT}`;
      const pw = ctx.measureText('0:00').width + 46 * s, px = w / 2 - pw / 2;
      const k = low && !reduced ? 1 + 0.08 * Math.max(0, Math.sin(v.time * 9)) : 1;
      pill(ctx, px, top, pw, H);
      ctx.strokeStyle = low ? palette.danger : palette.ink; ctx.lineWidth = 2 * s;
      const cx = px + 18 * s, cy = top + H / 2; ctx.beginPath(); ctx.arc(cx, cy, 7 * s, 0, TAU); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - 4.5 * s); ctx.moveTo(cx, cy); ctx.lineTo(cx + 3.5 * s, cy); ctx.stroke();
      text(ctx, str, px + 30 * s, cy, 18 * s * k, low ? palette.danger : palette.ink);
    }
    // Enemies defeated.
    if (showEnemies) {
      const n = (state.vars.defeated_enemies || 0) + (state.vars.shots_hit || 0), str = `× ${n}`;
      ctx.font = `800 ${Math.round(17 * s)}px ${HUD_FONT}`;
      const tw = ctx.measureText(str).width, icon = 22 * s, pw = 12 * s + icon + 8 * s + tw + 14 * s, px = w - pad - pw;
      pill(ctx, px, top, pw, H);
      const img = iconOf(enemyKind), k = 1 + v.hud.killPop * 0.4, cx = px + 12 * s + icon / 2, cy = top + H / 2;
      if (img) ctx.drawImage(img, cx - icon * k / 2, cy - icon * k / 2, icon * k, icon * k);
      text(ctx, str, px + 12 * s + icon + 8 * s, cy, 17 * s);
    }
    // Offscreen goal beacon.
    for (const g of goals.slice(0, 1)) {
      const gx = (g.x + g.w / 2 - camX) * tile, gy = (g.y + g.h / 2 - camY) * tile, m = 34 * s;
      if (gx > -tile * 0.3 && gx < w + tile * 0.3 && gy > -tile * 0.3 && gy < h + tile * 0.3) continue;
      const dx = gx - w / 2, dy = gy - h / 2, t = Math.min((w / 2 - m) / Math.max(1e-6, Math.abs(dx)), (h / 2 - m - H) / Math.max(1e-6, Math.abs(dy)));
      const ax = w / 2 + dx * t, ay = h / 2 + dy * t, ang = Math.atan2(dy, dx), r = 15 * s * (1 + (reduced ? 0 : 0.08 * Math.sin(v.time * 5)));
      ctx.save(); ctx.translate(ax, ay);
      ctx.rotate(ang); ctx.fillStyle = palette.accent; ctx.beginPath(); ctx.moveTo(r + 10 * s, 0); ctx.lineTo(r - 1, -7 * s); ctx.lineTo(r - 1, 7 * s); ctx.closePath(); ctx.fill(); ctx.rotate(-ang);
      ctx.fillStyle = palette.panelSolid; ctx.strokeStyle = palette.accent; ctx.lineWidth = 2.5 * s; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill(); ctx.stroke();
      const img = iconOf(g.kind); if (img) ctx.drawImage(img, -r * 0.72, -r * 0.72, r * 1.44, r * 1.44);
      ctx.restore();
    }
    // Pickups flying to the counter.
    v.flyers = v.flyers.filter(f => {
      if (!f.from) f.from = { x: (f.wx - camX) * tile, y: (f.wy - camY) * tile };
      f.t += dt / 0.45;
      const to = v.hud.pickupAt || { x: f.from.x, y: f.from.y - 60 };
      if (f.t >= 1) { v.hud.pick = 1; return false; }
      const t = easeOut(f.t), cx = (f.from.x + to.x) / 2, cy = Math.min(f.from.y, to.y) - 60 * s;
      const x = (1 - t) * (1 - t) * f.from.x + 2 * (1 - t) * t * cx + t * t * to.x, y = (1 - t) * (1 - t) * f.from.y + 2 * (1 - t) * t * cy + t * t * to.y;
      const img = iconOf(f.kind), size = tile * 0.8 * (1 - 0.4 * t);
      if (img) ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
      return true;
    });
    ctx.restore();
  }

  render.fx = v;
  render.palette = palette;
  render.theme = theme;
  return render;
}
