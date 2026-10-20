// falling: Tetris-style pieces fall through the play area of any grid world (size()), steered by
// following the player or drifting, optionally rotated with a free button. A piece passes over
// whatever is in its way and settles in the first open spot that rests on something solid: a wall,
// a brick, the floor. Where it lands it becomes part of the world:
//   - kits with terrain ('terrain'): new walls through setBlocked, never where they would cut off
//     any part of the area the player can reach (a flood fill checks first), so every pellet or
//     goal stays reachable;
//   - otherwise ('spawn'): new targets, such as breakout bricks, which must be broken to clear.
// With clearRows, a row filled edge to edge (bricks and pieces together) clears for points.
// Gravity follows the grid: size().gravity is +1 (down) by default, -1 where the stack is at the
// top (breakout's pieces rise and lock against the brick wall).
import { random, seedFrom } from '../../kernel/rng.js';
import { obj, bool, int, str, enumOf, clampInt, color, name, pick, tick, burst, ring, drawFx, badge, tileCenter, tileAt } from './fx.js';

const PIECES = ['none', 'tetromino', 'small', 'mixed'], STEER = ['follow', 'drift'];
const SHAPES = {
  tetromino: [[[0, 0], [1, 0], [2, 0], [3, 0]], [[0, 0], [1, 0], [0, 1], [1, 1]], [[0, 0], [1, 0], [2, 0], [1, 1]], [[1, 0], [2, 0], [0, 1], [1, 1]], [[0, 0], [1, 0], [1, 1], [2, 1]], [[0, 0], [1, 0], [2, 0], [0, 1]], [[0, 0], [1, 0], [2, 0], [2, 1]]],
  small: [[[0, 0]], [[0, 0], [1, 0]], [[0, 0], [1, 0], [2, 0]], [[0, 0], [1, 0], [0, 1]]],
};
SHAPES.mixed = [...SHAPES.tetromino, ...SHAPES.small];
const PALETTE = ['#4fd8ff', '#ffd23f', '#c77dff', '#5fe07a', '#ff5a5a', '#ff9a3a', '#4f7dff', '#7fffd4', '#ff8ad8', '#c8f05a', '#ffb86b'];
const FPS = 60, STEER_EVERY = 5;

const norm = cells => { const mx = Math.min(...cells.map(c => c[0])), my = Math.min(...cells.map(c => c[1])); return cells.map(([x, y]) => [x - mx, y - my]); };
const span = cells => [Math.max(...cells.map(c => c[0])) + 1, Math.max(...cells.map(c => c[1])) + 1];

/** Tiles the player can walk to from their tile, with `extra` tiles treated as walls. */
function reach(world, state, size, start, extra) {
  const { w, h } = size, seen = new Uint8Array(w * h), wraps = !!world.wrap;
  const open = (i, j) => !extra.has(j * w + i) && !world.blocked(state, ...tileCenter(size, i, j));
  if (!open(start[0], start[1])) return { count: 0, seen };
  const stack = [start[1] * w + start[0]];
  seen[stack[0]] = 1;
  let count = 0;
  while (stack.length) {
    const k = stack.pop(), i = k % w, j = (k - i) / w;
    count++;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let ni = i + dx; const nj = j + dy;
      if (nj < 0 || nj >= h) continue;
      if (ni < 0 || ni >= w) { if (!wraps) continue; ni = (ni + w) % w; }
      const nk = nj * w + ni;
      if (!seen[nk] && open(ni, nj)) { seen[nk] = 1; stack.push(nk); }
    }
  }
  return { count, seen };
}

export default {
  id: 'falling',
  summary: 'falling blocks (a Tetris mechanic): every `every` seconds a piece falls through the play area at `speed` tiles per second, steered by following the player (follow) or drifting, and locks where it first rests on something solid; landed pieces become new walls in worlds with terrain (never cutting off anything the player can reach) or new targets such as breakout bricks (which then must be broken); clearRows makes a full row clear for points; rotate puts piece rotation on a free button. pieces: tetromino (classic four-block), small (one to three blocks, best for narrow mazes) or mixed. Use for "Tetris", "falling blocks", "blocks drop from the sky".',
  requires: ['player', 'blocked', 'grid', ['terrain', 'spawn']],
  // A button only when the pieces rotate; without one the mod still runs (fighting has none free).
  button: c => c.rotate,
  schema: obj({
    pieces: enumOf(PIECES, 'none (off), tetromino, small or mixed.'),
    name: str('Themed name, e.g. "crystal blocks"; empty for "Blocks".'),
    every: int('2 to 30 seconds between pieces.'),
    speed: int('1 to 12 tiles per second.'),
    steer: enumOf(STEER, 'follow: the falling piece tracks the player\'s position; drift: it falls where it appears.'),
    rotate: bool('true: a free button rotates the falling piece.'),
    clearRows: bool('true: a row filled edge to edge with targets clears for points.'),
    color: str('Hex color for the HUD and glow, e.g. #4fd8ff.'),
  }),
  normalize(c = {}) {
    return { pieces: pick(c?.pieces, PIECES, 'none'), name: name(c?.name, 'Blocks'), every: clampInt(c?.every, 2, 30, 6), speed: clampInt(c?.speed, 1, 12, 4), steer: pick(c?.steer, STEER, 'follow'), rotate: c?.rotate === true, clearRows: c?.clearRows !== false, color: color(c?.color, '#4fd8ff') };
  },
  enabled: c => c.pieces !== 'none',
  label: c => `Rotate ${c.name.toLowerCase()}`,

  init(c, world, s, { seed = 1, caps = [], button = null } = {}) {
    return { rng: seedFrom(`falling:${seed}`), fill: caps.includes('terrain') ? 'terrain' : 'spawn', canRotate: !!button, t: Math.round(c.every * FPS * 0.5), piece: null, next: 0, landed: 0, rows: 0, level: world.level?.(s) ?? 0, pops: [], lines: [] };
  },

  step(m, input, c, { world, state, emit }) {
    m.pops = []; m.lines = [];
    const level = world.level?.(state) ?? 0;
    if (level !== m.level) { m.level = level; m.piece = null; m.t = Math.round(c.every * FPS * 0.5); }
    if (!world.active(state)) return;
    const size = world.size?.(state);
    if (!size) return;
    const { w, h } = size, g = size.gravity === -1 ? -1 : 1, shapes = SHAPES[c.pieces] || SHAPES.tetromino;
    m.cell = size.cell ? { ...size.cell } : null; m.gw = w;
    const p = world.player(state), pt = tileAt(size, p.x, p.y);
    if (!m.piece) {
      if (--m.t > 0) return;
      m.t = c.every * FPS;
      const k = m.next ?? 0, cells = norm(shapes[k % shapes.length]), [pw, ph] = span(cells);
      m.next = Math.floor(random(m) * shapes.length);
      const x = c.steer === 'follow' ? Math.max(0, Math.min(w - pw, pt[0] - Math.floor(pw / 2))) : Math.floor(random(m) * (w - pw + 1));
      m.piece = { cells, x, y: g > 0 ? -ph : h, k: 1, color: k % PALETTE.length, steer: 0 };
      emit('piece_spawn', { cells: cells.length });
    }
    const pc = m.piece;
    // Rotation (free button) and steering toward the player's column.
    if (input.pressed && m.canRotate) {
      const turned = norm(pc.cells.map(([x, y]) => [-y, x])), [tw] = span(turned);
      pc.cells = turned; pc.x = Math.max(0, Math.min(w - tw, pc.x));
      emit('piece_rotate', {});
    }
    const [pw] = span(pc.cells);
    if (c.steer === 'follow' && ++pc.steer >= STEER_EVERY) {
      pc.steer = 0;
      const want = Math.max(0, Math.min(w - pw, pt[0] - Math.floor(pw / 2)));
      if (want !== pc.x) pc.x += Math.sign(want - pc.x);
    }
    if (--pc.k > 0) return;
    pc.k = Math.max(1, Math.round(FPS / c.speed));
    // Occupancy: terrain, plus (spawn worlds) the targets standing in a tile.
    const targets = new Map();
    if (m.fill === 'spawn') for (const e of world.enemies?.(state) || []) {
      const [ei, ej] = tileAt(size, e.x, e.y), r = Math.ceil((e.radius ?? 0.4) / Math.min(size.cell?.w ?? 1, size.cell?.h ?? 1));
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        const [cx, cy] = tileCenter(size, ei + di, ej + dj);
        if (Math.abs(cx - e.x) <= Math.max(e.radius ?? 0.4, (size.cell?.w ?? 1) / 2) && Math.abs(cy - e.y) <= Math.max(e.radius ?? 0.4, (size.cell?.h ?? 1) / 2)) {
          const key = (ej + dj) * w + ei + di;
          if (!targets.has(key)) targets.set(key, []);
          targets.get(key).push(e.id);
        }
      }
    }
    const inside = (i, j) => i >= 0 && i < w && j >= 0 && j < h;
    const solid = (i, j) => targets.has(j * w + i) || world.blocked(state, ...tileCenter(size, i, j));
    const abs = dy => pc.cells.map(([x, y]) => [pc.x + x, pc.y + y + dy]);
    const cur = abs(0), next = abs(g);
    const resting = cur.every(([i, j]) => inside(i, j) && !solid(i, j)) && next.some(([i, j]) => (g > 0 ? j >= h : j < 0) || (inside(i, j) && solid(i, j)));
    if (resting && land(cur)) { m.piece = null; return; }
    if (next.every(([, j]) => (g > 0 ? j >= h : j < 0))) {
      m.piece = null;
      emit('piece_fizzle', {});
      return;
    }
    pc.y += g;

    function land(cells) {
      // Never on top of the player or an enemy.
      for (const [i, j] of cells) {
        const [x, y] = tileCenter(size, i, j);
        if (Math.hypot(x - p.x, y - p.y) < 1.2) return false;
        if (m.fill === 'terrain' && (world.enemies?.(state) || []).some(e => Math.hypot(e.x - x, e.y - y) < 1.2)) return false;
      }
      const placed = [];
      if (m.fill === 'terrain') {
        // Walls must not cut off anything the player can reach now.
        const start = [((pt[0] % w) + w) % w, Math.max(0, Math.min(h - 1, pt[1]))];
        const before = reach(world, state, size, start, new Set());
        const keys = new Set(cells.map(([i, j]) => j * w + i));
        const lost = cells.filter(([i, j]) => before.seen[j * w + i]).length;
        if (before.count && reach(world, state, size, start, keys).count !== before.count - lost) { emit('piece_blocked', {}); return false; }
        for (const [i, j] of cells) {
          if (world.setBlocked(state, i, j, true) === false) { for (const [a, b] of placed) world.setBlocked(state, a, b, false); return false; }
          placed.push([i, j]);
        }
      } else {
        for (const [i, j] of cells) {
          const [x, y] = tileCenter(size, i, j);
          if (world.spawn(state, { x, y, kind: 'block' }) != null) placed.push([i, j]);
        }
        if (!placed.length) return false;
      }
      m.landed++;
      for (const [i, j] of placed) m.pops.push(tileCenter(size, i, j));
      world.addScore?.(state, 10 * placed.length);
      emit('piece_land', { cells: placed.length, fill: m.fill });
      if (c.clearRows && m.fill === 'spawn') clearRows([...new Set(placed.map(([, j]) => j))]);
      return true;
    }
    function clearRows(rows) {
      const fresh = new Map();
      for (const e of world.enemies?.(state) || []) { const [i, j] = tileAt(size, e.x, e.y); if (inside(i, j)) fresh.set(j * w + i, e.id); }
      for (const j of rows) {
        let full = true;
        for (let i = 0; i < w && full; i++) full = fresh.has(j * w + i) || world.blocked(state, ...tileCenter(size, i, j));
        if (!full) continue;
        for (let i = 0; i < w; i++) { const id = fresh.get(j * w + i); if (id != null) world.defeat(state, id, { by: 'row' }); }
        const points = 100 * w;
        world.addScore?.(state, points);
        m.rows++;
        m.lines.push(tileCenter(size, 0, j)[1]);
        emit('row_clear', { row: j, points });
      }
    }
  },

  render(g, m, c, view, fx, frame) {
    tick(fx, frame);
    const { X, Y, s } = view, reduced = !!frame.reducedMotion;
    if (fx.pops !== m.pops) {
      fx.pops = m.pops;
      for (const [x, y] of m.pops) { burst(fx, x, y, c.color, 6, 3, { life: 0.45, size: 0.14 }); ring(fx, x, y, '#ffffff', 0.7, 0.3); }
      if (m.pops.length) fx.land = 1;
      for (const y of m.lines || []) { fx.sweep = { y, t: 0.6 }; for (let k = 0; k < (m.gw || 10); k++) burst(fx, tileCenter(m.cell ? { cell: m.cell } : null, k, 0)[0], y, PALETTE[k % PALETTE.length], 3, 6); }
    }
    const dt = frame.paused ? 0 : frame.dt ?? 1 / 60;
    if (fx.land > 0) fx.land = Math.max(0, fx.land - dt * 3);
    if (fx.sweep) { fx.sweep.t -= dt; if (fx.sweep.t <= 0) fx.sweep = null; }
    g.save();
    if (view.clip) { g.beginPath(); g.rect(view.clip.x, view.clip.y, view.clip.w, view.clip.h); g.clip(); }
    const pc = m.piece;
    if (pc) {
      const cell = m.cell || { w: 1, h: 1, x0: -0.5, y0: -0.5 };
      const col = PALETTE[pc.color % PALETTE.length];
      for (const [dx, dy] of pc.cells) {
        const i = pc.x + dx, j = pc.y + dy;
        const x0 = X(cell.x0 + i * cell.w), y0 = Y(cell.y0 + j * cell.h), x1 = X(cell.x0 + (i + 1) * cell.w), y1 = Y(cell.y0 + (j + 1) * cell.h);
        const pad = Math.max(1, (x1 - x0) * 0.06), bw = x1 - x0 - pad * 2, bh = y1 - y0 - pad * 2;
        if (!reduced) { g.shadowColor = col; g.shadowBlur = s * 0.4; }
        const grad = g.createLinearGradient ? g.createLinearGradient(0, y0, 0, y1) : null;
        if (grad) { grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.25, col); grad.addColorStop(1, col + 'aa'); }
        g.fillStyle = grad || col; g.globalAlpha = 0.92;
        g.beginPath(); if (g.roundRect) g.roundRect(x0 + pad, y0 + pad, bw, bh, Math.min(bw, bh) * 0.18); else g.rect(x0 + pad, y0 + pad, bw, bh); g.fill();
        g.shadowBlur = 0; g.globalAlpha = 1;
        g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = Math.max(1, s * 0.05); g.stroke();
      }
    }
    if (fx.sweep && view.clip) {
      const y = Y(fx.sweep.y), k = fx.sweep.t / 0.6;
      g.globalAlpha = k; g.fillStyle = '#ffffff'; g.fillRect(view.clip.x, y - s * 0.4 * k, view.clip.w, s * 0.8 * k); g.globalAlpha = 1;
    }
    drawFx(g, fx, view, reduced);
    g.restore();
    const next = pc ? 'FALLING' : `${Math.ceil(m.t / FPS)}s`;
    badge(g, view, `${c.name.toUpperCase()} ${next}${m.rows ? ` · ${m.rows} ROWS` : m.landed ? ` · ${m.landed}` : ''}`, c.color, { progress: pc ? null : 1 - m.t / (c.every * FPS), pop: fx.land || 0 });
  },
};
