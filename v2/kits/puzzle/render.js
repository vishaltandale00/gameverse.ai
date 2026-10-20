// Puzzle-kit renderer: one polished frame for every mode. The simulation state
// is read-only here; all visual state (particles, popups, interpolation,
// shake, mascot reactions) lives in this closure.
import { paletteFrom } from '../../engine/juice.js';
import { TAU, clamp, lerp, easeOut, easeOutBack, rgba, light, shade, luminance, mix, FONTS, rr, text, block, ghostBlock, gemSprite, colorBomb, blob, virus, capsuleHalf, garbageBlob, crate, rock, itemToken, panel, starShape } from './draw.js';
import { HIDDEN, GARBAGE, CLEAR_FRAMES as F_CLEAR, INTRO_FRAMES as F_INTRO, LOCK_DELAY } from './falling.js';
import { color as cColor, isVirus, linkOf, GARB, POP_FRAMES, INTRO_FRAMES as C_INTRO } from './chain.js';
import { col as gCol, spOf, SP, ITEM, SWAP_FRAMES, CLEAR_FRAMES as S_CLEAR, INTRO_FRAMES as S_INTRO } from './swap.js';
import { SLIDE_FRAMES, INTRO_FRAMES as L_INTRO } from './slide.js';
import { levelAt, starsFor } from './common.js';
import { goalText } from './content.js';

const INTRO = { falling: F_INTRO, chain: C_INTRO, swap: S_INTRO, slide: L_INTRO };
const CHEERS = ['Nice!', 'Great!', 'Super!', 'Wow!', 'Amazing!', 'Incredible!'];

export function createPuzzleRenderer(game, { art = {} } = {}) {
  const content = game.content, mode = game.mode;
  const pal = paletteFrom(content.background);
  const font = FONTS[art.font] || FONTS.rounded;
  const colors = content.palette.map(p => p.color);
  const virusMode = mode === 'chain' && content.rules.variant === 'virus';
  const images = new Map();
  const image = url => {
    if (!url || typeof Image === 'undefined') return null;
    if (!images.has(url)) { const im = new Image(); im.decoding = 'async'; im.src = url; images.set(url, im); }
    const im = images.get(url);
    return im.complete && im.naturalWidth ? im : null;
  };
  const frames = kind => art.frames?.[kind] || (art.sprites?.[kind] ? { idle: art.sprites[kind] } : null);
  let fx = freshFx();
  function freshFx() {
    return { t: 0, parts: [], pops: [], beams: [], rings: [], trails: [], flashes: [], shake: 0, nudge: { x: 0, y: 0 }, banner: null, mascot: { pose: null, until: 0, bubble: null, bubbleUntil: 0 }, rivalHurt: 0, score: 0, lastFrame: -1, lastLevel: -1, piece: null, pair: null, born: new Map(), merged: new Map(), lastMoves: -1, lostT: 0, flash: 0 };
  }

  // ---------- layout ----------
  const dims = () => {
    if (mode === 'falling') return { cols: game.W, rows: game.H - HIDDEN, top: 1.4, off: HIDDEN };
    if (mode === 'chain') return { cols: game.W, rows: game.H - 1, top: 0.6, off: 1 };
    if (mode === 'swap') return { cols: game.W, rows: game.H, top: 0, off: 0 };
    return { cols: game.n, rows: game.n, top: 0, off: 0 };
  };
  function layout(W, H) {
    const d = dims(), pad = clamp(Math.min(W, H) * 0.035, 8, 28), gap = clamp(W * 0.018, 8, 22);
    const portrait = W / H < 0.82;
    const ratio = mode === 'falling' ? 0.52 : mode === 'chain' ? (virusMode ? 0.55 : 0.75) : 0.5;
    let bw, panels;
    if (!portrait) {
      bw = Math.min((H - 2 * pad) * d.cols / (d.rows + d.top), (W - 2 * pad - 2 * gap) / (1 + 2 * ratio));
      const cell = bw / d.cols, bh = cell * d.rows;
      const pw = Math.min(260, (W - 2 * pad - 2 * gap - bw) / 2);
      const bx = (W - bw) / 2, by = (H - bh - d.top * cell) / 2 + d.top * cell;
      panels = { left: { x: bx - gap - pw, y: by, w: pw, h: bh }, right: { x: bx + bw + gap, y: by, w: pw, h: bh } };
      return { portrait, cell, bx, by, bw, bh, ...panels, off: d.off, cols: d.cols, rows: d.rows, W, H };
    }
    const topH = clamp(H * 0.16, 64, 124);
    bw = Math.min(W - 2 * pad, (H - 2 * pad - topH - gap) * d.cols / (d.rows + d.top));
    const cell = bw / d.cols, bh = cell * d.rows, half = (W - 2 * pad - gap) / 2;
    const by = pad + topH + gap + d.top * cell + Math.max(0, (H - 2 * pad - topH - gap - bh - d.top * cell) / 2);
    return { portrait, cell, bx: (W - bw) / 2, by, bw, bh, left: { x: pad, y: pad, w: half, h: topH }, right: { x: pad + half + gap, y: pad, w: half, h: topH }, off: d.off, cols: d.cols, rows: d.rows, W, H };
  }
  const center = (L, x, y) => [L.bx + (x + 0.5) * L.cell, L.by + (y - L.off + 0.5) * L.cell];

  // ---------- effects ----------
  const rnd = (() => { let a = 0x2545f491; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  function burst(x, y, color, n, { speed = 160, size = 5, life = 0.7, g = 420, shape = 'sq', up = 60 } = {}) {
    for (let k = 0; k < n && fx.parts.length < 700; k++) {
      const a = rnd() * TAU, v = speed * (0.35 + rnd() * 0.75);
      fx.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - up, life: life * (0.6 + rnd() * 0.6), max: life, size: size * (0.6 + rnd() * 0.8), color, shape, rot: rnd() * TAU, vr: (rnd() - 0.5) * 12, g });
    }
  }
  function confetti(L, n = 70) { for (let k = 0; k < n; k++) burst(L.bx + rnd() * L.bw, L.by - 10, colors[k % colors.length] || pal.accent, 1, { speed: 120, size: 7, life: 1.8, g: 260, shape: 'conf', up: -40 }); }
  function popup(textStr, x, y, { size = 26, color = '#fff', life = 1.1, big = false, sub = null } = {}) { fx.pops.push({ text: textStr, x, y, size, color, life, t: 0, big, sub }); if (fx.pops.length > 14) fx.pops.shift(); }
  const shake = (frame, amount) => { if (!frame.reducedMotion) fx.shake = Math.min(14, fx.shake + amount); };
  function cheer(pose = 'jump', secs = 0.8, bubble = null) {
    fx.mascot.pose = pose; fx.mascot.until = fx.t + secs;
    if (bubble) { fx.mascot.bubble = bubble; fx.mascot.bubbleUntil = fx.t + 1.4; }
  }

  function onEvents(s, L, frame) {
    for (const e of frame.events || []) {
      switch (e.name) {
        case 'lines': {
          const label = e.count === 4 && !e.spin ? 'TETRIS!' : e.label ? `${e.label.toUpperCase()}${e.spin ? '!' : ''}` : '';
          const rows = e.rows || [];
          for (const [x, y, v] of e.cells || []) { const [cx, cy] = center(L, x, y); const c = v === GARBAGE ? '#9aa0b4' : game.types[v - 1]?.color || pal.accent; burst(cx, cy, c, 4, { speed: 220, size: L.cell * 0.22, life: 0.8 }); burst(cx, cy, '#ffffff', 1, { speed: 90, size: L.cell * 0.12, life: 0.5, shape: 'spark' }); }
          const midY = rows.length ? center(L, 0, rows.reduce((t, r) => t + r, 0) / rows.length)[1] : L.by + L.bh / 2;
          if (label) popup(label, L.bx + L.bw / 2, midY - L.cell * 0.8, { size: L.cell * (e.count >= 4 || e.spin ? 1.25 : 0.95), color: e.spin ? '#e8a6ff' : e.count >= 4 ? '#7ff5ff' : '#fff6c8', big: true, sub: e.b2b ? 'BACK-TO-BACK' : null });
          if (e.combo > 0) popup(`COMBO ×${e.combo}`, L.bx + L.bw / 2, midY + L.cell * 0.7, { size: L.cell * 0.7, color: '#ffd36a' });
          if (e.perfect) popup('PERFECT CLEAR!', L.bx + L.bw / 2, L.by + L.bh * 0.35, { size: L.cell * 1.1, color: '#ffffff', big: true, life: 1.8 });
          if (e.points) popup(`+${e.points.toLocaleString('en-US')}`, L.bx + L.bw / 2, midY + L.cell * (e.combo > 0 ? 1.6 : 0.8), { size: L.cell * 0.6, color: pal.accent });
          shake(frame, e.count * 1.6 + (e.count >= 4 ? 5 : 0) + (e.spin ? 3 : 0));
          if (e.count >= 4 || e.spin || e.perfect) { cheer('dance', 1.3, e.count >= 4 ? 'Tetris!' : 'Spin!'); fx.flash = 0.5; } else if (e.count) cheer('jump', 0.7, e.combo > 1 ? `Combo ${e.combo}!` : null);
          break;
        }
        case 'hit': {
          if (mode === 'falling' && e.cells) {
            const byCol = new Map();
            e.from.forEach(([x, y]) => byCol.set(x, Math.min(byCol.get(x) ?? 99, y)));
            for (const [x, y0] of byCol) { const y1 = Math.max(...e.cells.filter(c => c[0] === x).map(c => c[1])); fx.trails.push({ x, y0, y1, t: 0, life: 0.22, color: game.types[e.t]?.color || '#fff' }); }
            for (const [x, y] of e.cells) { if (!e.cells.some(c => c[0] === x && c[1] === y + 1)) { const [cx, cy] = center(L, x, y); burst(cx, cy + L.cell * 0.5, 'rgba(240,240,255,.8)', 2, { speed: 90, size: L.cell * 0.14, life: 0.4, g: 200, shape: 'dot', up: 40 }); } }
          }
          shake(frame, clamp(1.4 + (e.dist || 0) * 0.16, 1, 5));
          break;
        }
        case 'land': if (mode === 'falling') fx.flashes.push({ cells: e.cells, t: 0, life: 0.16 }); break;
        case 'garbage': shake(frame, 4); break;
        case 'level_up':
          if (s.phase !== 'intro') fx.banner = { title: e.title || `Level ${e.level + 1}`, kicker: mode === 'slide' && e.tile ? `${e.tile} reached!` : `Level ${e.level + 1}`, sub: e.intro || '', t: 0, life: 2.4 };
          confetti(L, 50); cheer('dance', 1.4, 'Level up!');
          break;
        case 'pop': {
          let sx = 0, sy = 0;
          for (const [x, y, v] of e.cells) {
            const [cx, cy] = center(L, x, y); sx += cx; sy += cy;
            const c = cColor(v) === GARB ? '#d8d4e4' : colors[cColor(v) - 1] || '#fff';
            burst(cx, cy, c, 5, { speed: 200, size: L.cell * 0.18, life: 0.75, shape: 'dot' });
          }
          const n = e.cells.length || 1;
          if (e.chain >= 2) { popup(`${e.chain} CHAIN!`, sx / n, sy / n - L.cell * 0.4, { size: L.cell * (0.8 + Math.min(4, e.chain) * 0.12), color: '#ffe36a', big: true }); shake(frame, 2 + e.chain * 1.5); cheer(e.chain >= 3 ? 'dance' : 'jump', 1, CHEERS[Math.min(CHEERS.length - 1, e.chain - 2)]); }
          else cheer('jump', 0.5);
          if (e.points) popup(`+${e.points.toLocaleString('en-US')}`, sx / n, sy / n + L.cell * 0.5, { size: L.cell * 0.55, color: pal.accent, life: 0.9 });
          if (e.viruses) { fx.rivalHurt = fx.t + 0.7; for (let k = 0; k < e.viruses; k++) fx.rings.push({ x: sx / n, y: sy / n, t: 0, life: 0.5, color: '#ffffff', r: L.cell * 1.2 }); }
          break;
        }
        case 'match': {
          for (const [x, y, g] of e.cells) {
            const [cx, cy] = center(L, x, y), c = colors[gCol(g) - 1] || '#ffffff';
            burst(cx, cy, c, 4, { speed: 180, size: L.cell * 0.13, life: 0.6, shape: 'shard' });
          }
          for (const ef of e.effects || []) {
            if (ef.kind === 'row' || ef.kind === 'col') fx.beams.push({ kind: ef.kind, x: ef.x, y: ef.y, t: 0, life: 0.42, color: colors[(ef.color || 1) - 1] || '#fff' });
            else if (ef.kind === 'area') { const [ax, ay] = center(L, ef.x, ef.y); fx.rings.push({ x: ax, y: ay, t: 0, life: 0.5, color: '#fff6c0', r: L.cell * (1.6 + (ef.r || 1)) }); }
            else if (ef.kind === 'bomb') { const [cx, cy] = center(L, ef.x, ef.y); fx.beams.push({ kind: 'bolt', cx, cy, targets: e.cells.filter(([, , g]) => gCol(g) === ef.color).map(([x, y]) => center(L, x, y)), t: 0, life: 0.45, color: colors[ef.color - 1] || '#fff' }); }
            else if (ef.kind === 'board') fx.flash = 0.8;
          }
          const n = e.cells.length || 1, cx = e.cells.reduce((t, c) => t + c[0], 0) / n, cy = e.cells.reduce((t, c) => t + c[1], 0) / n;
          const [px, py] = center(L, cx, cy);
          popup(`+${(e.cells.length * 20 * e.cascade).toLocaleString('en-US')}`, px, py, { size: L.cell * 0.42, color: '#fff', life: 0.8 });
          if (e.combo) { popup(e.combo === 'bomb+bomb' ? 'BOARD WIPE!' : 'SUPER COMBO!', L.bx + L.bw / 2, L.by + L.bh * 0.4, { size: L.cell * 0.9, color: '#ffd36a', big: true }); shake(frame, 8); cheer('dance', 1.4, 'Whoa!'); }
          else if (e.cascade >= 2) { popup(CHEERS[Math.min(CHEERS.length - 1, e.cascade - 2)].toUpperCase(), L.bx + L.bw / 2, L.by + L.bh * 0.42, { size: L.cell * (0.7 + e.cascade * 0.08), color: '#ffe680', big: true }); shake(frame, 1 + e.cascade); cheer(e.cascade >= 3 ? 'dance' : 'jump', 0.9); }
          if ((e.creates || []).length) { shake(frame, 2); for (const [i] of e.creates) { const [qx, qy] = center(L, i % game.W, Math.floor(i / game.W)); fx.rings.push({ x: qx, y: qy, t: 0, life: 0.45, color: '#ffffff', r: L.cell * 0.9 }); } }
          if (e.effects?.some(f => f.kind !== 'bolt')) shake(frame, 3);
          break;
        }
        case 'item': for (const [x, y] of e.cells) { const [cx, cy] = center(L, x, y); burst(cx, cy, '#ffd34a', 18, { speed: 220, size: L.cell * 0.14, life: 0.9, shape: 'star' }); popup('+1000', cx, cy - L.cell * 0.5, { size: L.cell * 0.5, color: '#ffd34a' }); } cheer('dance', 1, 'Got it!'); break;
        case 'broken': shake(frame, 2); break;
        case 'invalid': fx.nudge.x = 6; break;
        case 'shuffle': fx.banner = { title: 'No moves left', kicker: 'Shuffling', sub: '', t: 0, life: 1.4 }; break;
        case 'bonus': { const i = e.i ?? 0, [cx, cy] = center(L, i % game.W, Math.floor(i / game.W)); burst(cx, cy, colors[i % colors.length] || '#fff', 10, { speed: 200, size: L.cell * 0.14, life: 0.8, shape: 'star' }); popup(`+${e.points}`, cx, cy, { size: L.cell * 0.45, color: '#ffe680', life: 0.7 }); break; }
        case 'goal': fx.banner = { title: mode === 'swap' ? 'Level clear!' : 'Goal!', kicker: 'Sweet', sub: '', t: 0, life: 1.6 }; confetti(L, 60); cheer('dance', 1.6, 'We did it!'); break;
        case 'stars': popup(`${e.stars} STAR${e.stars === 1 ? '' : 'S'}`, L.bx + L.bw / 2, L.by + L.bh * 0.62, { size: L.cell * 0.8, color: '#ffd34a', big: true, life: 1.4 }); break;
        case 'merge': {
          for (const [x, y, v] of e.merges) {
            const [cx, cy] = center(L, x, y), c = tileColor(v);
            if (v >= 16) burst(cx, cy, light(c, 0.2), v >= 128 ? 14 : 6, { speed: 160, size: L.cell * 0.06, life: 0.6, shape: 'star', up: 20 });
            if (v >= 128) { fx.rings.push({ x: cx, y: cy, t: 0, life: 0.5, color: light(c, 0.3), r: L.cell * 0.9 }); popup(String(v), cx, cy - L.cell * 0.55, { size: L.cell * 0.3, color: '#fff', life: 0.8 }); }
          }
          if (e.top >= 128) { shake(frame, 2 + Math.log2(e.top) - 7); cheer(e.top >= 512 ? 'dance' : 'jump', 0.9, e.top >= 256 ? `${e.top}!` : null); }
          break;
        }
        case 'bump': if (mode === 'slide') { const d = [[-1, 0], [1, 0], [0, -1], [0, 1]][e.dir] || [0, 0]; fx.nudge = { x: d[0] * 5, y: d[1] * 5 }; } break;
        case 'won': confetti(L, 120); cheer('dance', 3, 'You did it!'); break;
        case 'lost': fx.lostT = 0.001; break;
      }
    }
  }

  function stepFx(dt) {
    fx.t += dt;
    for (const p of fx.parts) { p.life -= dt; p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - 1.2 * dt; p.rot += p.vr * dt; }
    fx.parts = fx.parts.filter(p => p.life > 0);
    for (const list of [fx.pops, fx.beams, fx.rings, fx.trails, fx.flashes]) for (const o of list) o.t += dt;
    fx.pops = fx.pops.filter(o => o.t < o.life); fx.beams = fx.beams.filter(o => o.t < o.life); fx.rings = fx.rings.filter(o => o.t < o.life);
    fx.trails = fx.trails.filter(o => o.t < o.life); fx.flashes = fx.flashes.filter(o => o.t < o.life);
    if (fx.banner) { fx.banner.t += dt; if (fx.banner.t > fx.banner.life) fx.banner = null; }
    fx.shake *= Math.pow(0.0015, dt); if (fx.shake < 0.05) fx.shake = 0;
    fx.nudge.x *= Math.pow(0.0005, dt); fx.nudge.y *= Math.pow(0.0005, dt);
    fx.flash = Math.max(0, fx.flash - dt * 2.2);
    if (fx.lostT) fx.lostT += dt;
  }

  // ---------- background ----------
  function background(ctx, L, frame) {
    const { W, H } = L, im = image(art.background);
    if (im) {
      const sc = Math.max(W / im.naturalWidth, H / im.naturalHeight), w = im.naturalWidth * sc, h = im.naturalHeight * sc;
      const drift = frame.reducedMotion ? 0 : Math.sin(fx.t * 0.05) * 8;
      ctx.drawImage(im, (W - w) / 2 + drift, (H - h) / 2, w, h);
      ctx.fillStyle = 'rgba(8,10,22,.42)'; ctx.fillRect(0, 0, W, H);
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, pal.skyTop); g.addColorStop(1, pal.skyBottom);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(8,10,22,.25)'; ctx.fillRect(0, 0, W, H);
    }
    // soft floating motes
    for (let k = 0; k < 16; k++) {
      const sp = 6 + (k * 7) % 11, x = ((k * 197.3) % W + Math.sin(fx.t * 0.3 + k) * 20 + W) % W, y = H - ((fx.t * sp + k * 131) % (H + 80)) + 40;
      ctx.fillStyle = rgba(k % 2 ? pal.accent : pal.accent2, 0.06); ctx.beginPath(); ctx.arc(x, y, 10 + (k % 5) * 6, 0, TAU); ctx.fill();
    }
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.45)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  }
  function boardFrame(ctx, L, danger) {
    const p = Math.max(6, L.cell * 0.22);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 28; ctx.shadowOffsetY = 10;
    rr(ctx, L.bx - p, L.by - p, L.bw + 2 * p, L.bh + 2 * p, p * 1.6); ctx.fillStyle = 'rgba(10,12,26,.82)'; ctx.fill();
    ctx.restore();
    rr(ctx, L.bx - p + 1, L.by - p + 1, L.bw + 2 * p - 2, L.bh + 2 * p - 2, p * 1.5);
    ctx.lineWidth = 2; ctx.strokeStyle = danger ? rgba('#ff4a5a', 0.5 + 0.4 * Math.sin(fx.t * 9)) : rgba(pal.accent, 0.35); ctx.stroke();
  }
  function grid(ctx, L) {
    ctx.strokeStyle = 'rgba(255,255,255,.045)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < L.cols; x++) { ctx.moveTo(L.bx + x * L.cell, L.by); ctx.lineTo(L.bx + x * L.cell, L.by + L.bh); }
    for (let y = 1; y < L.rows; y++) { ctx.moveTo(L.bx, L.by + y * L.cell); ctx.lineTo(L.bx + L.bw, L.by + y * L.cell); }
    ctx.stroke();
  }

  // ---------- falling ----------
  const typeColor = v => v === GARBAGE ? '#7d8396' : game.types[v - 1]?.color || '#999';
  function miniPiece(ctx, t, cx, cy, size, alpha = 1) {
    const T = game.types[t]; if (!T) return;
    const cells = T.states[0], xs = cells.map(c => c[0]), ys = cells.map(c => c[1]);
    const w = Math.max(...xs) - Math.min(...xs) + 1, h = Math.max(...ys) - Math.min(...ys) + 1;
    const cs = Math.min(size / Math.max(w, 2.6), size * 0.36);
    ctx.save(); ctx.globalAlpha *= alpha;
    for (const [x, y] of cells) block(ctx, cx - w * cs / 2 + (x - Math.min(...xs)) * cs, cy - h * cs / 2 + (y - Math.min(...ys)) * cs, cs, T.color);
    ctx.restore();
  }
  function drawFalling(ctx, s, L, dt) {
    const { cell } = L, W = game.W;
    const top = HIDDEN;
    let highest = game.H;
    for (let i = 0; i < s.board.length; i++) if (s.board[i]) { highest = Math.floor(i / W); break; }
    const danger = highest < top + 4 && s.status === 'playing';
    boardFrame(ctx, L, danger); grid(ctx, L);
    const clearing = s.phase === 'clear' ? new Set(s.clearRows) : null, cp = clearing ? 1 - s.phaseT / F_CLEAR : 0;
    const lostFade = fx.lostT ? clamp(fx.lostT * 1.2, 0, 1) : 0;
    for (let y = top; y < game.H; y++) for (let x = 0; x < W; x++) {
      const v = s.board[y * W + x]; if (!v) continue;
      const px = L.bx + x * cell, py = L.by + (y - top) * cell;
      if (clearing?.has(y)) {
        const k = easeOut(cp), sz = cell * (1 - k * 0.7);
        block(ctx, px + (cell - sz) / 2, py + (cell - sz) / 2, sz, typeColor(v));
        ctx.fillStyle = `rgba(255,255,255,${0.85 * (1 - Math.abs(cp * 2 - 1) * 0.6)})`; rr(ctx, px + (cell - sz) / 2, py + (cell - sz) / 2, sz, sz, sz * 0.15); ctx.fill();
        continue;
      }
      const row = y - top, gray = lostFade && row >= game.H - top - Math.floor(lostFade * (game.H - top + 1));
      block(ctx, px, py, cell, gray ? '#5a5e6c' : typeColor(v), v === GARBAGE ? 'garbage' : 'block');
    }
    if (clearing) for (const y of clearing) {
      const py = L.by + (y - top) * cell, sx = L.bx + easeOut(cp) * L.bw;
      const g = ctx.createLinearGradient(sx - cell * 3, 0, sx + cell * 0.5, 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,.95)');
      ctx.fillStyle = g; ctx.fillRect(Math.max(L.bx, sx - cell * 3), py, Math.min(cell * 3.5, sx - L.bx + cell * 0.5), cell);
    }
    for (const f of fx.flashes) { ctx.fillStyle = `rgba(255,255,255,${0.55 * (1 - f.t / f.life)})`; for (const [x, y] of f.cells) if (y >= top) { rr(ctx, L.bx + x * cell, L.by + (y - top) * cell, cell, cell, cell * 0.14); ctx.fill(); } }
    for (const tr of fx.trails) {
      const a = 1 - tr.t / tr.life, x = L.bx + tr.x * cell, y0 = L.by + (Math.max(top - 1, tr.y0) - top) * cell, y1 = L.by + (tr.y1 - top + 1) * cell;
      const g = ctx.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, rgba(tr.color, 0)); g.addColorStop(1, rgba(light(tr.color, 0.3), 0.55 * a));
      ctx.fillStyle = g; ctx.fillRect(x + cell * 0.12, y0, cell * 0.76, y1 - y0);
    }
    const p = s.piece;
    if (p && s.status === 'playing' && s.phase === 'play') {
      const T = game.types[p.t];
      if (!fx.piece || fx.piece.id !== p.id) fx.piece = { id: p.id, x: p.x, y: p.y };
      const k = 1 - Math.exp(-dt * 38);
      fx.piece.x = lerp(fx.piece.x, p.x, k); fx.piece.y = lerp(fx.piece.y, p.y, k);
      if (Math.abs(fx.piece.x - p.x) > 2.5) fx.piece.x = p.x;
      if (Math.abs(fx.piece.y - p.y) > 3) fx.piece.y = p.y;
      if (content.rules.ghost) { const gy = game.ghostY(s); if (gy > p.y) for (const [cx, cy] of T.states[p.r]) if (gy + cy >= top) ghostBlock(ctx, L.bx + (p.x + cx) * cell, L.by + (gy + cy - top) * cell, cell, T.color, 0.9); }
      const lockGlow = s.lockT > 0 ? s.lockT / LOCK_DELAY : 0;
      ctx.save();
      ctx.beginPath(); ctx.rect(L.bx - 4, L.by - cell * 1.4, L.bw + 8, L.bh + cell * 1.4); ctx.clip();
      for (const [cx, cy] of T.states[p.r]) {
        const py = L.by + (fx.piece.y + cy - top) * cell, px = L.bx + (fx.piece.x + cx) * cell;
        if (py < L.by - cell * 1.4) continue;
        ctx.globalAlpha = py < L.by ? 0.55 : 1;
        block(ctx, px, py, cell, T.color);
        if (lockGlow) { ctx.fillStyle = `rgba(255,255,255,${0.28 * lockGlow * (0.6 + 0.4 * Math.sin(fx.t * 30))})`; rr(ctx, px, py, cell, cell, cell * 0.14); ctx.fill(); }
      }
      ctx.restore();
    }
    // spawn line
    ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(L.bx, L.by - 1, L.bw, 1);
    return danger;
  }
  function fallingPanels(s) {
    const L0 = levelAt(content, s.level);
    const hold = { kind: 'box', title: 'HOLD', h: 0.72, draw: (ctx, x, y, w, h) => { if (s.hold >= 0) miniPiece(ctx, s.hold, x + w / 2, y + h / 2 + 6, Math.min(w, h) * 0.8, s.holdUsed ? 0.35 : 1); else text(ctx, content.rules.hold ? 'A + B' : 'off', x + w / 2, y + h / 2 + 6, { size: h * 0.16, color: pal.muted, font }); } };
    const next = { kind: 'box', title: 'NEXT', h: 0.45 + content.rules.nextCount * 0.32, draw: (ctx, x, y, w, h) => {
      const n = content.rules.nextCount, first = h * 0.3, rest = (h - first - 22) / Math.max(1, n - 1);
      miniPiece(ctx, s.queue[0], x + w / 2, y + 20 + first / 2, Math.min(w * 0.8, first * 1.4));
      for (let k = 1; k < n; k++) miniPiece(ctx, s.queue[k], x + w / 2, y + 20 + first + (k - 0.5) * rest, Math.min(w * 0.55, rest * 1.25), 0.85);
    } };
    const goal = L0.goal === 'lines' ? { kind: 'bar', label: 'LINES', value: s.levelLines, max: L0.target } : L0.goal === 'score' ? { kind: 'bar', label: 'GOAL', value: s.levelScore, max: L0.target } : { kind: 'bar', label: 'SURVIVE', value: Math.floor(s.levelT / 60), max: L0.timeSec };
    const time = L0.timeSec && L0.goal !== 'survive' ? [{ kind: 'stat', label: 'TIME', value: fmtTime(Math.max(0, L0.timeSec - s.levelT / 60)) }] : [];
    return {
      left: [hold, { kind: 'stat', label: 'LEVEL', value: String(s.level + 1) }, goal, ...time, { kind: 'mascot' }],
      right: [next, { kind: 'stat', label: 'SCORE', value: fx.score, big: true }, { kind: 'stat', label: 'LINES', value: String(s.lines) }],
      compactLeft: [{ kind: 'stat', label: 'SCORE', value: fx.score, big: true }, goal],
      compactRight: [{ kind: 'box', title: 'NEXT', draw: (ctx, x, y, w, h) => miniPiece(ctx, s.queue[0], x + w / 2, y + h / 2 + 6, Math.min(w, h) * 0.75) }, hold],
    };
  }

  // ---------- chain ----------
  function drawChain(ctx, s, L, dt) {
    const { cell } = L, W = game.W, H = game.H;
    const top = s.board.slice(W, W * 4).some(Boolean);
    boardFrame(ctx, L, top && s.status === 'playing');
    if (virusMode) { rr(ctx, L.bx, L.by, L.bw, L.bh, cell * 0.4); ctx.fillStyle = 'rgba(120,180,255,.05)'; ctx.fill(); } else grid(ctx, L);
    if (!virusMode) { // the death square
      const [dx, dy] = center(L, game.spawnAt.x, game.spawnAt.y), r = cell * 0.28;
      ctx.strokeStyle = rgba('#ff5a6a', 0.35 + (top ? 0.4 * Math.sin(fx.t * 8) : 0)); ctx.lineWidth = Math.max(2, cell * 0.08); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(dx - r, dy - r); ctx.lineTo(dx + r, dy + r); ctx.moveTo(dx + r, dy - r); ctx.lineTo(dx - r, dy + r); ctx.stroke();
    }
    const popping = s.phase === 'pop' ? new Set(s.popping) : null, pp = popping ? 1 - s.phaseT / POP_FRAMES : 0;
    const yOf = i => Math.floor(i / W) - (s.off?.[i] || 0);
    ctx.save(); ctx.beginPath(); ctx.rect(L.bx - 2, L.by - 2, L.bw + 4, L.bh + 4); ctx.clip();
    // links between same-colored neighbors (classic)
    if (!virusMode) for (let i = W; i < W * H; i++) {
      const c = cColor(s.board[i]); if (!c || c === GARB || s.off?.[i] || popping?.has(i)) continue;
      const x = i % W, y = Math.floor(i / W), col = colors[c - 1];
      for (const [j, horiz] of [[i + 1, true], [i + W, false]]) {
        if ((horiz && x === W - 1) || j >= W * H || cColor(s.board[j]) !== c || s.off?.[j] || popping?.has(j)) continue;
        const [ax, ay] = center(L, x, y), bx2 = horiz ? ax + cell : ax, by2 = horiz ? ay : ay + cell, t = cell * 0.56;
        ctx.fillStyle = shade(col, 0.05);
        if (horiz) { rr(ctx, ax, ay - t / 2, bx2 - ax, t, t * 0.3); } else { rr(ctx, ax - t / 2, ay, t, by2 - ay, t * 0.3); }
        ctx.fill();
      }
    }
    for (let i = W; i < W * H; i++) {
      const v = s.board[i]; if (!v) continue;
      const x = i % W, [cx, cy] = center(L, x, yOf(i)), c = cColor(v);
      let scale = 1, alpha = 1;
      if (popping?.has(i)) { if (pp < 0.55 && Math.floor(pp * 14) % 2) alpha = 0.35; if (pp >= 0.55) { const q = (pp - 0.55) / 0.45; scale = 1 + q * 0.35; alpha = 1 - q; } }
      ctx.save(); ctx.globalAlpha = alpha; ctx.translate(cx, cy); ctx.scale(scale, scale); ctx.translate(-cx, -cy);
      if (c === GARB) garbageBlob(ctx, cx, cy, cell * 0.46);
      else if (isVirus(v)) virus(ctx, cx, cy, cell * 0.42, colors[c - 1], fx.t + i * 0.37, fx.t < fx.rivalHurt);
      else if (virusMode) capsuleHalf(ctx, cx - cell / 2, cy - cell / 2, cell, colors[c - 1], linkOf(v));
      else blob(ctx, cx, cy, cell * 0.45, colors[c - 1], { look: Math.sin(fx.t * 0.7 + i) * 1.5, squash: s.off?.[i] ? -0.06 : 0 });
      if (popping?.has(i) && pp < 0.55) { ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.beginPath(); ctx.arc(cx, cy, cell * 0.46, 0, TAU); ctx.fill(); }
      ctx.restore();
    }
    const p = s.pair;
    if (p && s.phase === 'play' && s.status === 'playing') {
      const ang = (p.r - 1) * Math.PI / 2;
      if (!fx.pair || fx.pair.id !== p.id) fx.pair = { id: p.id, x: p.x, y: p.y, ang };
      const k = 1 - Math.exp(-dt * 30);
      fx.pair.x = lerp(fx.pair.x, p.x, k); fx.pair.y = lerp(fx.pair.y, p.y, k);
      let da = ang - fx.pair.ang; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
      fx.pair.ang += da * (1 - Math.exp(-dt * 28));
      const [px, py] = center(L, fx.pair.x, fx.pair.y), qx = px + Math.cos(fx.pair.ang) * cell, qy = py + Math.sin(fx.pair.ang) * cell;
      if (virusMode) {
        const settledTurn = Math.abs(da) < 0.2;
        capsuleHalf(ctx, px - cell / 2, py - cell / 2, cell, colors[p.a - 1], settledTurn ? [3, 2, 4, 1][p.r] : 0);
        capsuleHalf(ctx, qx - cell / 2, qy - cell / 2, cell, colors[p.b - 1], settledTurn ? [4, 1, 3, 2][p.r] : 0);
      } else {
        blob(ctx, px, py, cell * 0.45, colors[p.a - 1], { look: 0 });
        blob(ctx, qx, qy, cell * 0.45, colors[p.b - 1], { look: 0 });
        ctx.strokeStyle = `rgba(255,255,255,${0.5 + 0.3 * Math.sin(fx.t * 8)})`; ctx.lineWidth = Math.max(1.5, cell * 0.06);
        ctx.beginPath(); ctx.arc(px, py, cell * 0.5, 0, TAU); ctx.stroke();
      }
    }
    ctx.restore();
    return top;
  }
  function pairPreview(ctx, q, x, y, w, h) {
    if (!q) return;
    const s2 = Math.min(w * 0.36, h * 0.42), cx = x + w / 2, cy = y + h / 2;
    if (virusMode) { capsuleHalf(ctx, cx - s2, cy - s2 / 2, s2, colors[q.a - 1], 2); capsuleHalf(ctx, cx, cy - s2 / 2, s2, colors[q.b - 1], 1); }
    else { blob(ctx, cx, cy + s2 * 0.5, s2 * 0.48, colors[q.a - 1]); blob(ctx, cx, cy - s2 * 0.5, s2 * 0.48, colors[q.b - 1]); }
  }
  function chainPanels(s) {
    const L0 = levelAt(content, s.level);
    const next = { kind: 'box', title: 'NEXT', h: virusMode ? 0.5 : 0.95, draw: (ctx, x, y, w, h) => { pairPreview(ctx, s.queue[0], x, y + 10, w, (h - 10) * (virusMode ? 1 : 0.62)); if (!virusMode) pairPreview(ctx, s.queue[1], x + w * 0.22, y + 10 + (h - 10) * 0.55, w * 0.56, (h - 10) * 0.42); } };
    const goal = L0.goal === 'viruses' ? { kind: 'viruses', label: content.cast.rival.toUpperCase(), value: s.virusesLeft }
      : L0.goal === 'chain' ? { kind: 'bar', label: `${L0.target}-CHAIN`, value: s.maxChain, max: L0.target }
      : L0.goal === 'blockers' ? { kind: 'bar', label: content.cast.blocker.toUpperCase(), value: Math.max(0, s.garbageTotal - s.garbageLeft), max: s.garbageTotal || 1, text: `${s.garbageLeft} left` }
      : L0.goal === 'survive' ? { kind: 'bar', label: 'SURVIVE', value: Math.floor(s.levelT / 60), max: L0.timeSec }
      : { kind: 'bar', label: 'GOAL', value: s.levelScore, max: L0.target };
    return {
      left: [next, { kind: 'stat', label: 'LEVEL', value: String(s.level + 1) }, goal, { kind: 'mascot' }],
      right: [{ kind: 'stat', label: 'SCORE', value: fx.score, big: true }, { kind: 'stat', label: 'BEST CHAIN', value: String(s.stats.bestChain) }, ...(virusMode ? [{ kind: 'rival' }] : [])],
      compactLeft: [{ kind: 'stat', label: 'SCORE', value: fx.score, big: true }, goal],
      compactRight: [next, { kind: 'stat', label: 'LEVEL', value: String(s.level + 1) }],
    };
  }

  // ---------- swap ----------
  function gemAt(ctx, g, x, y, s2, t, i) {
    const c = gCol(g), sp = spOf(g);
    if (c === ITEM) { const im = image(art.sprites?.item); if (im) { const b = Math.sin(t * 3 + i) * s2 * 0.04; ctx.drawImage(im, x + s2 * 0.1, y + s2 * 0.1 + b, s2 * 0.8, s2 * 0.8); } else itemToken(ctx, x + s2 / 2, y + s2 / 2, s2 * 0.34, t + i); return; }
    if (sp === SP.BOMB) { colorBomb(ctx, x, y, s2, t, colors); return; }
    const color = colors[c - 1] || '#ccc';
    if (sp === SP.AREA) { const pulse = 0.5 + 0.5 * Math.sin(t * 6 + i); ctx.fillStyle = rgba(light(color, 0.4), 0.25 + 0.25 * pulse); rr(ctx, x + s2 * 0.04, y + s2 * 0.04, s2 * 0.92, s2 * 0.92, s2 * 0.24); ctx.fill(); ctx.strokeStyle = rgba('#ffffff', 0.5 + 0.4 * pulse); ctx.lineWidth = Math.max(1.5, s2 * 0.06); ctx.stroke(); }
    gemSprite(ctx, x, y, s2, color, c);
    if (sp === SP.HSTRIPE || sp === SP.VSTRIPE) {
      ctx.save(); ctx.beginPath(); ctx.arc(x + s2 / 2, y + s2 / 2, s2 * 0.38, 0, TAU); ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      for (let k = -1; k <= 1; k++) { if (sp === SP.HSTRIPE) ctx.fillRect(x, y + s2 / 2 + k * s2 * 0.2 - s2 * 0.045, s2, s2 * 0.09); else ctx.fillRect(x + s2 / 2 + k * s2 * 0.2 - s2 * 0.045, y, s2 * 0.09, s2); }
      ctx.restore();
    }
  }
  function drawSwap(ctx, s, L) {
    const { cell } = L, W = game.W, N = W * game.H;
    boardFrame(ctx, L, false);
    for (let i = 0; i < N; i++) {
      if (s.hole[i]) continue;
      const x = i % W, y = Math.floor(i / W), px = L.bx + x * cell, py = L.by + y * cell;
      ctx.fillStyle = (x + y) % 2 ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.12)'; rr(ctx, px + 1, py + 1, cell - 2, cell - 2, cell * 0.12); ctx.fill();
      if (s.jelly[i]) { const wob = Math.sin(fx.t * 3 + i) * cell * 0.02; ctx.fillStyle = s.jelly[i] > 1 ? 'rgba(255,90,190,.55)' : 'rgba(255,140,210,.38)'; rr(ctx, px + 2 - wob, py + 2 + wob, cell - 4 + 2 * wob, cell - 4 - 2 * wob, cell * 0.22); ctx.fill(); ctx.strokeStyle = 'rgba(255,220,240,.6)'; ctx.lineWidth = 1.5; ctx.stroke(); }
    }
    const clearing = s.phase === 'clear' && s.pending ? new Set(s.pending.clear) : null, cp = clearing ? 1 - s.phaseT / S_CLEAR : 0;
    const swapping = s.phase === 'swap' || s.phase === 'back', sp = swapping ? easeOut(1 - s.phaseT / SWAP_FRAMES) : 0;
    const hint = s.hint && s.phase === 'idle' ? new Set(s.hint) : null;
    ctx.save(); ctx.beginPath(); ctx.rect(L.bx, L.by, L.bw, L.bh); ctx.clip();
    for (let i = 0; i < N; i++) {
      if (s.block[i]) { crate(ctx, L.bx + (i % W) * cell, L.by + Math.floor(i / W) * cell, cell, s.block[i]); continue; }
      const g = s.gems[i]; if (!g) continue;
      let x = i % W, y = Math.floor(i / W) - (s.fall[i] || 0);
      if (swapping && (i === s.swapA || i === s.swapB)) {
        const o = i === s.swapA ? s.swapB : s.swapA, ox = o % W, oy = Math.floor(o / W);
        const t = s.phase === 'swap' ? sp : 1 - sp;
        x = lerp(i % W, ox, t); y = lerp(Math.floor(i / W), oy, t);
      }
      let size = cell, ang = 0;
      if (clearing?.has(i)) { const k = easeOut(cp); size = cell * (1 + 0.25 * Math.sin(k * Math.PI)) * (1 - k * 0.85); }
      if (i === s.sel) size = cell * (1.08 + 0.05 * Math.sin(fx.t * 10));
      if (hint?.has(i)) ang = Math.sin(fx.t * 14) * 0.18;
      if (s.phase === 'shuffle') ang = (1 - s.phaseT / 44) * TAU;
      const px = L.bx + x * cell + (cell - size) / 2, py = L.by + y * cell + (cell - size) / 2;
      if (ang) { ctx.save(); ctx.translate(px + size / 2, py + size / 2); ctx.rotate(ang); ctx.translate(-(px + size / 2), -(py + size / 2)); }
      gemAt(ctx, g, px, py, size, fx.t, i);
      if (clearing?.has(i) && cp < 0.5) { ctx.fillStyle = `rgba(255,255,255,${0.6 * (1 - cp * 2)})`; ctx.beginPath(); ctx.arc(px + size / 2, py + size / 2, size * 0.4, 0, TAU); ctx.fill(); }
      if (ang) ctx.restore();
    }
    ctx.restore();
    for (const b of fx.beams) {
      const a = 1 - b.t / b.life;
      if (b.kind === 'row' || b.kind === 'col') {
        const g = b.kind === 'row' ? ctx.createLinearGradient(0, L.by + b.y * cell, 0, L.by + (b.y + 1) * cell) : ctx.createLinearGradient(L.bx + b.x * cell, 0, L.bx + (b.x + 1) * cell, 0);
        g.addColorStop(0, rgba(b.color, 0)); g.addColorStop(0.5, `rgba(255,255,255,${0.95 * a})`); g.addColorStop(1, rgba(b.color, 0));
        ctx.fillStyle = g;
        const grow = 0.3 + 0.7 * easeOut(b.t / 0.12);
        if (b.kind === 'row') ctx.fillRect(L.bx + (b.x + 0.5) * cell * (1 - grow), L.by + b.y * cell, L.bw * grow, cell);
        else ctx.fillRect(L.bx + b.x * cell, L.by + (b.y + 0.5) * cell * (1 - grow), cell, L.bh * grow);
      } else if (b.kind === 'bolt') {
        ctx.strokeStyle = `rgba(255,255,255,${a})`; ctx.lineWidth = Math.max(1.5, cell * 0.06); ctx.shadowColor = b.color; ctx.shadowBlur = 12;
        for (const [tx, ty] of b.targets) { ctx.beginPath(); ctx.moveTo(b.cx, b.cy); const mx = (b.cx + tx) / 2 + (rnd() - 0.5) * cell * 0.6, my = (b.cy + ty) / 2 + (rnd() - 0.5) * cell * 0.6; ctx.lineTo(mx, my); ctx.lineTo(tx, ty); ctx.stroke(); }
        ctx.shadowBlur = 0;
      }
    }
    if (s.phase === 'idle' || s.phase === 'intro') { // cursor
      const cx = L.bx + s.cursor.x * cell, cy = L.by + s.cursor.y * cell, pulse = 0.5 + 0.5 * Math.sin(fx.t * 6);
      ctx.lineWidth = Math.max(2, cell * 0.07); ctx.strokeStyle = s.sel >= 0 ? `rgba(255,214,90,${0.8 + 0.2 * pulse})` : `rgba(255,255,255,${0.55 + 0.4 * pulse})`;
      rr(ctx, cx + 2, cy + 2, cell - 4, cell - 4, cell * 0.2); ctx.stroke();
      if (s.sel >= 0) {
        const sx = L.bx + (s.sel % W + 0.5) * cell, sy = L.by + (Math.floor(s.sel / W) + 0.5) * cell, d = cell * (0.62 + 0.05 * pulse), r = cell * 0.1;
        ctx.fillStyle = '#ffd65a';
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ax = sx + dx * d, ay = sy + dy * d; ctx.beginPath(); ctx.moveTo(ax + dx * r, ay + dy * r); ctx.lineTo(ax - dy * r - dx * r * 0.4, ay + dx * r - dy * r * 0.4); ctx.lineTo(ax + dy * r - dx * r * 0.4, ay - dx * r - dy * r * 0.4); ctx.closePath(); ctx.fill(); }
      }
    }
  }
  function swapPanels(s) {
    const L0 = levelAt(content, s.level), left = game.left(s), tot = s.totals || left;
    const goal = L0.goal === 'score' ? { kind: 'bar', label: 'TARGET', value: s.levelScore, max: L0.target }
      : L0.goal === 'jelly' ? { kind: 'bar', label: 'JELLY', value: tot.jelly - left.jelly, max: tot.jelly || 1, text: `${left.jelly} left` }
      : L0.goal === 'blockers' ? { kind: 'bar', label: content.cast.blocker.toUpperCase(), value: tot.blockers - left.blockers, max: tot.blockers || 1, text: `${left.blockers} left` }
      : { kind: 'bar', label: content.cast.item.toUpperCase(), value: s.collected, max: L0.target, icon: 'item' };
    const moves = L0.moves ? { kind: 'stat', label: 'MOVES', value: String(s.moves), big: true, warn: s.moves <= 3 } : { kind: 'stat', label: 'TIME', value: fmtTime(Math.max(0, L0.timeSec - s.levelT / 60)), big: true };
    return {
      left: [moves, goal, { kind: 'stars', level: L0, score: s.levelScore }, { kind: 'mascot' }],
      right: [{ kind: 'stat', label: 'SCORE', value: fx.score, big: true }, { kind: 'stat', label: 'LEVEL', value: `${s.level + 1} / ${content.levels.length}` }, { kind: 'text', value: goalText(content, L0) }],
      compactLeft: [moves, goal], compactRight: [{ kind: 'stat', label: 'SCORE', value: fx.score, big: true }, { kind: 'stars', level: L0, score: s.levelScore }],
    };
  }

  // ---------- slide ----------
  function tileColor(v) {
    const r = Math.max(1, Math.log2(v)), n = colors.length, f = (r - 1) / 2.2;
    const i = Math.floor(f) % n, j = (i + 1) % n, c = mix(colors[i], colors[j], f - Math.floor(f));
    return r >= 9 ? light(c, 0.12) : r <= 2 ? mix(c, '#f4efe8', 0.55) : c;
  }
  function drawSlide(ctx, s, L) {
    const { cell } = L, n = game.n, g = cell * 0.08;
    boardFrame(ctx, L, false);
    for (let i = 0; i < n * n; i++) { const x = i % n, y = Math.floor(i / n); ctx.fillStyle = 'rgba(255,255,255,.08)'; rr(ctx, L.bx + x * cell + g, L.by + y * cell + g, cell - 2 * g, cell - 2 * g, cell * 0.12); ctx.fill(); }
    for (const i of s.rocks) rock(ctx, L.bx + (i % n) * cell, L.by + Math.floor(i / n) * cell, cell);
    if (s.stats.moves !== fx.lastMoves) {
      fx.lastMoves = s.stats.moves;
      for (const t of s.tiles) { if (t.merged) fx.merged.set(t.id, fx.t + SLIDE_FRAMES / 60); if (t.born) fx.born.set(t.id, fx.t + SLIDE_FRAMES / 60); }
    }
    const p = s.anim > 0 ? easeOut(1 - s.anim / SLIDE_FRAMES) : 1;
    const tile = (v, x, y, sc, alpha = 1) => {
      const sz = (cell - 2 * g) * sc, px = L.bx + x * cell + cell / 2 - sz / 2, py = L.by + y * cell + cell / 2 - sz / 2, c = tileColor(v);
      ctx.save(); ctx.globalAlpha = alpha;
      if (v >= 128) { ctx.shadowColor = light(c, 0.3); ctx.shadowBlur = cell * (0.15 + Math.min(0.3, (Math.log2(v) - 7) * 0.06)) * (0.8 + 0.2 * Math.sin(fx.t * 4)); }
      const grad = ctx.createLinearGradient(px, py, px, py + sz); grad.addColorStop(0, light(c, 0.18)); grad.addColorStop(1, shade(c, 0.12));
      rr(ctx, px, py, sz, sz, sz * 0.14); ctx.fillStyle = grad; ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,.22)'; rr(ctx, px + sz * 0.06, py + sz * 0.05, sz * 0.88, sz * 0.32, [sz * 0.1, sz * 0.1, sz * 0.2, sz * 0.2]); ctx.fill();
      ctx.lineWidth = Math.max(1, sz * 0.025); ctx.strokeStyle = rgba(shade(c, 0.45), 0.8); rr(ctx, px, py, sz, sz, sz * 0.14); ctx.stroke();
      const str = String(v), fs = sz * (str.length <= 2 ? 0.46 : str.length === 3 ? 0.38 : str.length === 4 ? 0.3 : 0.24);
      text(ctx, str, px + sz / 2, py + sz / 2 + fs * 0.04, { size: fs, color: luminance(c) > 0.6 ? '#3a2e3e' : '#ffffff', font, weight: 900 });
      ctx.restore();
    };
    for (const gh of s.ghosts || []) if (p < 1) tile(gh.v / 1, lerp(gh.fx, gh.x, p), lerp(gh.fy, gh.y, p), 1, 1);
    for (const t of s.tiles) {
      let sc = 1;
      const bornAt = fx.born.get(t.id), mergeAt = fx.merged.get(t.id);
      if (t.born && bornAt !== undefined) { const q = (fx.t - bornAt) / 0.14; sc = q < 0 ? 0 : Math.min(1, easeOutBack(q)); }
      if (t.merged && mergeAt !== undefined) { const q = (fx.t - mergeAt) / 0.16; if (q >= 0 && q < 1) sc = 1 + 0.18 * Math.sin(q * Math.PI); }
      if (sc <= 0) continue;
      tile(t.merged && p < 1 ? t.v / 2 : t.v, lerp(t.fx, t.x, p), lerp(t.fy, t.y, p), sc);
    }
  }
  function slidePanels(s) {
    const L0 = levelAt(content, s.level);
    const goal = L0.goal === 'tile' ? { kind: 'bar', label: `REACH ${L0.target}`, value: Math.log2(Math.max(2, s.maxTile)), max: Math.log2(L0.target), text: `best ${s.maxTile}` } : { kind: 'bar', label: 'GOAL', value: s.levelScore, max: L0.target };
    return {
      left: [{ kind: 'stat', label: 'SCORE', value: fx.score, big: true }, { kind: 'stat', label: 'BEST', value: String(Math.max(s.best || 0, s.score)) }, goal, { kind: 'mascot' }],
      right: [{ kind: 'stat', label: 'LEVEL', value: String(s.level + 1) }, ...(L0.moves ? [{ kind: 'stat', label: 'MOVES', value: String(s.moves), warn: s.moves <= 5 }] : [{ kind: 'stat', label: 'MOVES', value: String(s.stats.moves) }]), { kind: 'text', value: goalText(content, L0) }],
      compactLeft: [{ kind: 'stat', label: 'SCORE', value: fx.score, big: true }, goal], compactRight: [{ kind: 'stat', label: 'BEST', value: String(Math.max(s.best || 0, s.score)) }, { kind: 'stat', label: 'LEVEL', value: String(s.level + 1) }],
    };
  }

  // ---------- HUD items ----------
  const fmtTime = sec => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  function mascot(ctx, s, x, y, w, h, danger) {
    const fr = frames('hero');
    let pose = Math.floor(fx.t * 2.2) % 2 ? 'idleB' : 'idle', bounce = 0;
    if (s.status === 'lost') pose = 'hurt';
    else if (s.status === 'won') { pose = 'jump'; bounce = Math.abs(Math.sin(fx.t * 7)); }
    else if (fx.t < fx.mascot.until) {
      if (fx.mascot.pose === 'dance') { pose = ['runA', 'runB', 'runC', 'runD'][Math.floor(fx.t * 10) % 4]; bounce = Math.abs(Math.sin(fx.t * 12)) * 0.6; }
      else { pose = 'jump'; bounce = Math.sin(clamp((fx.mascot.until - fx.t) / 0.8, 0, 1) * Math.PI); }
    } else if (danger) pose = 'fall';
    const size = Math.min(w * 0.9, h * 0.92), cx = x + w / 2, base = y + h - size * 0.06;
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(cx, base, size * 0.3 * (1 - bounce * 0.25), size * 0.06, 0, 0, TAU); ctx.fill();
    const im = image(fr?.[pose]) || image(fr?.idle);
    const yy = base - size - bounce * size * 0.14 + size * 0.04;
    if (im) ctx.drawImage(im, cx - size / 2, yy, size, size);
    else blob(ctx, cx, yy + size * 0.6, size * 0.32, pal.accent, { look: Math.sin(fx.t) * 2, squash: bounce * -0.08 });
    if (fx.mascot.bubble && fx.t < fx.mascot.bubbleUntil && w > 70) {
      const a = clamp((fx.mascot.bubbleUntil - fx.t) * 4, 0, 1), bw = Math.min(w * 0.95, 150), bh = 26, bx = cx - bw / 2, by = Math.max(y - 4, yy - bh - 2);
      ctx.save(); ctx.globalAlpha = a;
      rr(ctx, bx, by, bw, bh, 12); ctx.fillStyle = '#fffaf0'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx - 6, by + bh); ctx.lineTo(cx + 2, by + bh + 8); ctx.lineTo(cx + 8, by + bh); ctx.fill();
      text(ctx, fx.mascot.bubble, cx, by + bh / 2 + 1, { size: 14, color: '#2a2238', font, maxW: bw - 12 });
      ctx.restore();
    }
  }
  function rivalBox(ctx, s, x, y, w, h) {
    const fr = frames('rival'), hurt = fx.t < fx.rivalHurt;
    const im = image(fr?.[hurt ? 'hurt' : Math.floor(fx.t * 3) % 2 ? 'runA' : 'idle']) || image(fr?.idle);
    const size = Math.min(w * 0.75, h * 0.8), cx = x + w / 2, cy = y + h / 2 + (hurt ? Math.sin(fx.t * 50) * 3 : 0);
    if (im) ctx.drawImage(im, cx - size / 2, cy - size / 2, size, size);
    else virus(ctx, cx, cy, size * 0.35, colors[0], fx.t, hurt);
  }
  function drawItems(ctx, s, items, box, compact, danger) {
    if (!items.length || box.w < 40) return;
    const u = clamp(box.w / 190, 0.62, 1.25);
    if (compact) {
      panel(ctx, box.x, box.y, box.w, box.h, pal);
      const n = items.length, cw = box.w / n;
      items.forEach((it, k) => drawItem(ctx, s, it, box.x + k * cw + 6, box.y + 6, cw - 12, box.h - 12, Math.min(u, box.h / 90), true, danger));
      return;
    }
    const heights = items.map(it => it.kind === 'mascot' ? 0 : it.kind === 'box' ? box.w * (it.h || 0.7) : it.kind === 'stat' ? (it.big ? 64 : 52) * u : it.kind === 'bar' ? 58 * u : it.kind === 'stars' ? 46 * u : it.kind === 'viruses' ? 56 * u : it.kind === 'rival' ? box.w * 0.7 : it.kind === 'text' ? 54 * u : 40 * u);
    const gap = 10 * u, fixed = heights.reduce((t, h) => t + h, 0) + gap * (items.length - 1);
    const rest = Math.max(0, box.h - fixed);
    let y = box.y;
    items.forEach((it, k) => {
      let h = heights[k];
      if (it.kind === 'mascot') { h = rest; if (h < 60) return; drawItem(ctx, s, it, box.x, y, box.w, h, u, false, danger); y += h + gap; return; }
      if (y + h > box.y + box.h + 1) return;
      panel(ctx, box.x, y, box.w, h, pal);
      drawItem(ctx, s, it, box.x + 10 * u, y + 6 * u, box.w - 20 * u, h - 12 * u, u, false, danger);
      y += h + gap;
    });
  }
  function drawItem(ctx, s, it, x, y, w, h, u, compact, danger) {
    const label = (str, yy) => text(ctx, str, x + w / 2, yy, { size: 11 * u + 1, color: pal.muted, font, weight: 800, maxW: w });
    switch (it.kind) {
      case 'stat': {
        label(it.label, y + 9 * u);
        const val = typeof it.value === 'number' ? Math.round(it.value).toLocaleString('en-US') : it.value;
        text(ctx, val, x + w / 2, y + h * 0.62, { size: (it.big ? 30 : 24) * u * (compact ? 0.85 : 1), color: it.warn ? `rgba(255,${120 + 80 * Math.sin(fx.t * 8)},110,1)` : '#fffaf0', font, weight: 900, maxW: w, stroke: 'rgba(0,0,0,.35)', strokeW: 3 });
        break;
      }
      case 'bar': {
        label(it.label, y + 9 * u);
        const f = clamp(it.max ? it.value / it.max : 0, 0, 1), bh = Math.max(8, 12 * u), by = y + h * 0.48;
        rr(ctx, x, by, w, bh, bh / 2); ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fill();
        if (f > 0) { const g = ctx.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, pal.accent2); g.addColorStop(1, pal.accent); rr(ctx, x, by, Math.max(bh, w * f), bh, bh / 2); ctx.fillStyle = g; ctx.fill(); }
        ctx.fillStyle = 'rgba(255,255,255,.35)'; rr(ctx, x + 2, by + 1, Math.max(0, w * f - 4), bh * 0.35, bh * 0.2); ctx.fill();
        text(ctx, it.text || `${Math.floor(Math.min(it.value, it.max)).toLocaleString('en-US')} / ${it.max.toLocaleString('en-US')}`, x + w / 2, by + bh + 10 * u, { size: 12 * u + 1, color: '#fffaf0', font, maxW: w });
        break;
      }
      case 'box': {
        if (!compact) label(it.title, y + 8 * u); else text(ctx, it.title, x + 4, y + 8, { size: 10 * u + 1, color: pal.muted, font, align: 'left' });
        it.draw(ctx, x, y, w, h);
        break;
      }
      case 'viruses': {
        label(it.label, y + 9 * u);
        virus(ctx, x + w * 0.3, y + h * 0.62, Math.min(h * 0.26, 16 * u), colors[Math.floor(fx.t) % colors.length], fx.t, fx.t < fx.rivalHurt);
        text(ctx, String(it.value), x + w * 0.62, y + h * 0.62, { size: 26 * u, color: '#fffaf0', font, weight: 900 });
        break;
      }
      case 'stars': {
        const n = starsFor(it.level, it.score), R = Math.min(h * 0.36, w / 8);
        for (let k = 0; k < 3; k++) { const on = k < n, cx = x + w / 2 + (k - 1) * R * 2.6, cy = y + h / 2 + (k === 1 ? -R * 0.2 : 0); starShape(ctx, cx, cy, R * (on ? 1 + 0.06 * Math.sin(fx.t * 5 + k) : 1), on ? '#ffd34a' : 'rgba(255,255,255,.15)', on ? '#a8740c' : 'rgba(255,255,255,.25)'); }
        break;
      }
      case 'text': text(ctx, it.value, x + w / 2, y + h / 2, { size: 13 * u + 1, color: '#fffaf0', font, maxW: w, weight: 700 }); break;
      case 'mascot': mascot(ctx, s, x, y, w, h, danger); break;
      case 'rival': rivalBox(ctx, s, x, y, w, h); break;
    }
  }

  // ---------- overlays ----------
  function drawParticles(ctx) {
    for (const p of fx.parts) {
      const a = clamp(p.life / p.max, 0, 1);
      ctx.save(); ctx.globalAlpha = a; ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.color;
      if (p.shape === 'dot') { ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, TAU); ctx.fill(); }
      else if (p.shape === 'star') starShape(ctx, 0, 0, p.size, p.color);
      else if (p.shape === 'spark') { ctx.fillRect(-p.size, -p.size * 0.15, p.size * 2, p.size * 0.3); }
      else if (p.shape === 'conf') { ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); }
      else if (p.shape === 'shard') { ctx.beginPath(); ctx.moveTo(0, -p.size); ctx.lineTo(p.size * 0.6, 0); ctx.lineTo(0, p.size); ctx.lineTo(-p.size * 0.6, 0); ctx.closePath(); ctx.fill(); }
      else { ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size); ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.3); }
      ctx.restore();
    }
    for (const r of fx.rings) { const q = r.t / r.life; ctx.strokeStyle = rgba(r.color.startsWith('#') ? r.color : '#ffffff', 1 - q); ctx.lineWidth = 3 * (1 - q) + 1; ctx.beginPath(); ctx.arc(r.x, r.y, r.r * easeOut(q), 0, TAU); ctx.stroke(); }
  }
  function drawPops(ctx) {
    for (const p of fx.pops) {
      const q = p.t / p.life, sc = p.big ? easeOutBack(Math.min(1, p.t / 0.25)) : 1, a = q > 0.7 ? 1 - (q - 0.7) / 0.3 : 1, rise = (p.big ? 18 : 34) * easeOut(q);
      ctx.save(); ctx.translate(p.x, p.y - rise); ctx.scale(sc, sc);
      text(ctx, p.text, 0, 0, { size: p.size, color: p.color, font, weight: 900, alpha: a, stroke: 'rgba(20,10,40,.85)', strokeW: Math.max(3, p.size * 0.16) });
      if (p.sub) text(ctx, p.sub, 0, p.size * 0.85, { size: p.size * 0.42, color: '#ffffff', font, weight: 900, alpha: a, stroke: 'rgba(20,10,40,.85)', strokeW: 3 });
      ctx.restore();
    }
  }
  function drawBanner(ctx, s, L, frame) {
    let b = null, p = 0;
    if (s.phase === 'intro' && !frame.attract) {
      const total = INTRO[mode], L0 = levelAt(content, s.level);
      p = 1 - s.phaseT / total;
      b = { kicker: `Level ${s.level + 1}${content.rules.endless || s.level < content.levels.length ? '' : ''}`, title: L0.name, sub: L0.intro, goal: goalText(content, L0) };
    } else if (fx.banner) { b = fx.banner; p = b.t / b.life; }
    if (!b) return;
    const inA = easeOutBack(Math.min(1, p / 0.18)), outA = p > 0.82 ? 1 - (p - 0.82) / 0.18 : 1, a = Math.min(1, inA) * outA;
    const cx = L.bx + L.bw / 2, cy = L.by + L.bh * 0.42, w = Math.min(L.W * 0.9, Math.max(L.bw * 1.15, 300)), h = clamp(L.cell * 3.6, 110, Math.min(180, L.bh * 0.55));
    ctx.save(); ctx.globalAlpha = clamp(a, 0, 1);
    const slide = frame.reducedMotion ? 0 : (1 - Math.min(1, inA)) * -60;
    ctx.translate(slide, 0);
    const g = ctx.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
    g.addColorStop(0, 'rgba(12,10,30,0)'); g.addColorStop(0.15, 'rgba(12,10,30,.88)'); g.addColorStop(0.85, 'rgba(12,10,30,.88)'); g.addColorStop(1, 'rgba(12,10,30,0)');
    ctx.fillStyle = g; ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
    ctx.fillStyle = rgba(pal.accent, 0.8); ctx.fillRect(cx - w * 0.35, cy - h / 2, w * 0.7, 2); ctx.fillRect(cx - w * 0.35, cy + h / 2 - 2, w * 0.7, 2);
    text(ctx, (b.kicker || '').toUpperCase(), cx, cy - h * 0.3, { size: h * 0.13, color: pal.accent, font, weight: 900 });
    text(ctx, b.title, cx, cy - h * 0.06, { size: h * 0.25, color: '#fffaf0', font, weight: 900, maxW: w * 0.8, stroke: 'rgba(0,0,0,.4)', strokeW: 4 });
    if (b.goal) text(ctx, b.goal, cx, cy + h * 0.19, { size: h * 0.12, color: '#ffe08a', font, weight: 800, maxW: w * 0.8 });
    if (b.sub) text(ctx, b.sub, cx, cy + h * (b.goal ? 0.36 : 0.22), { size: h * 0.1, color: pal.muted, font, weight: 700, maxW: w * 0.8 });
    ctx.restore();
    if (s.phase === 'intro' && !frame.attract && p > 0.78) {
      const q = (p - 0.78) / 0.22;
      text(ctx, q < 0.55 ? 'READY' : 'GO!', cx, L.by + L.bh * 0.72, { size: L.cell * (q < 0.55 ? 1 : 1.5) * easeOutBack(Math.min(1, (q % 0.55) * 5)), color: q < 0.55 ? '#ffffff' : '#7dffb0', font, weight: 900, stroke: 'rgba(10,10,30,.8)', strokeW: 6 });
    }
  }

  return function render(ctx, s, frame) {
    const W = frame.cssWidth, H = frame.cssHeight;
    const dt = clamp(frame.dt || 1 / 60, 0, 0.05);
    if (s.frame < fx.lastFrame || (s.frame === 0 && fx.lastFrame > 0)) fx = freshFx();
    fx.lastFrame = s.frame;
    const L = layout(W, H);
    if (!frame.paused) { onEvents(s, L, frame); stepFx(dt); }
    fx.score = Math.abs(fx.score - s.score) < 1 ? s.score : lerp(fx.score, s.score, 1 - Math.exp(-dt * 10));
    ctx.save();
    background(ctx, L, frame);
    const sx = fx.shake ? (rnd() - 0.5) * 2 * fx.shake : 0, sy = fx.shake ? (rnd() - 0.5) * 2 * fx.shake : 0;
    ctx.save(); ctx.translate(sx + fx.nudge.x, sy + fx.nudge.y);
    let danger = false;
    if (mode === 'falling') danger = drawFalling(ctx, s, L, dt);
    else if (mode === 'chain') danger = drawChain(ctx, s, L, dt);
    else if (mode === 'swap') drawSwap(ctx, s, L);
    else drawSlide(ctx, s, L);
    ctx.restore();
    const items = mode === 'falling' ? fallingPanels(s) : mode === 'chain' ? chainPanels(s) : mode === 'swap' ? swapPanels(s) : slidePanels(s);
    if (L.portrait) { drawItems(ctx, s, items.compactLeft, L.left, true, danger); drawItems(ctx, s, items.compactRight, L.right, true, danger); }
    else { drawItems(ctx, s, items.left, L.left, false, danger); drawItems(ctx, s, items.right, L.right, false, danger); }
    drawParticles(ctx);
    if (fx.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${(frame.reducedMotion ? 0.08 : 0.22) * fx.flash})`; ctx.fillRect(0, 0, W, H); }
    drawPops(ctx);
    drawBanner(ctx, s, L, frame);
    ctx.restore();
  };
}
