// Maze kit rules: grid movement with buffered turns and cornering, pellets and
// power pellets, four hunter personalities with the classic targeting, the
// scatter/chase schedule, house release, bonus prizes, lives and levels.
//
// Pure and deterministic: step() advances exactly 1/60 s, uses kernel/rng.js with
// its state in state.rng, and keeps every timer in whole frames. step mutates the
// state in place and returns it, so `state = step(state, input)` and
// `step(state, input)` both work.
import { random, seedFrom } from '../../kernel/rng.js';
import { buildMaze, isOpen, wrapX, sizeOf, W, H } from './maze.js';

export const DX = [0, -1, 0, 1], DY = [-1, 0, 1, 0]; // up, left, down, right (also the classic tie order)
export const UP = 0, LEFT = 1, DOWN = 2, RIGHT = 3, NONE = -1;
const EPS = 1e-6, FPS = 60, STEP = 1 / FPS;
/** 100% speed in tiles per second (the arcade's 75.75 px/s over 8 px tiles). */
export const BASE_SPEED = 9.47;
/** How far from a tile centre a perpendicular turn is still taken (pre- and post-turn window). */
export const CORNER = 0.45;
export const READY_FIRST = 132, READY = 96, DYING = 120, DYING_FREEZE = 36, CLEAR = 120, EAT_PAUSE = 30, BONUS_TIME = 570;

// Classic tables: speed fractions by tier (level 1, 2–4, 5+), frightened seconds by level,
// scatter/chase schedule by tier, house dot limits by level, Elroy thresholds by level.
const SPEEDS = [
  { pac: 0.80, pacDots: 0.71, pacFright: 0.90, pacFrightDots: 0.79, ghost: 0.75, tunnel: 0.40, fright: 0.50, elroy1: 0.80, elroy2: 0.85 },
  { pac: 0.90, pacDots: 0.79, pacFright: 0.95, pacFrightDots: 0.83, ghost: 0.85, tunnel: 0.45, fright: 0.55, elroy1: 0.90, elroy2: 0.95 },
  { pac: 1.00, pacDots: 0.87, pacFright: 1.00, pacFrightDots: 0.87, ghost: 0.95, tunnel: 0.50, fright: 0.60, elroy1: 1.00, elroy2: 1.05 },
];
export const FRIGHT_SECONDS = [6, 5, 4, 3, 2, 5, 2, 2, 1, 5, 2, 1, 1, 3, 1, 1, 1, 1];
const SCHEDULES = [[7, 20, 7, 20, 5, 20, 5, Infinity], [7, 20, 7, 20, 5, 1033, 1 / 60, Infinity], [5, 20, 5, 20, 5, 1037, 1 / 60, Infinity]];
const DOT_LIMITS = [[0, 0, 30, 60, 90, 120, 150, 180], [0, 0, 0, 50, 80, 110, 140, 170], [0, 0, 0, 0, 0, 0, 0, 0]];
const GLOBAL_LIMITS = [0, 7, 17, 32, 47, 62];
const ELROY = [[20, 10], [30, 15], [40, 20], [40, 20], [40, 20], [50, 25], [50, 25], [50, 25], [60, 30], [60, 30], [60, 30], [80, 40]];
const CORNER_ORDER = ['chaser', 'ambusher', 'whimsical', 'shy'];
/** Scatter targets just outside the classic maze, as in the arcade. */
export const CORNERS = { chaser: [W - 3, -4], ambusher: [2, -4], whimsical: [W - 1, H + 1], shy: [0, H + 1] };
/**
 * Per size: hunters scale with area (×mult of the content's list, up to cap; extra ones are
 * numbered copies), and the frightened and bonus timers stretch a little because things are
 * farther apart. Tile speeds stay classic at every size.
 */
export const SIZE_RULES = {
  classic: { hunters: 1, cap: 6, fright: 1, bonus: 1 },
  large: { hunters: 1.5, cap: 6, fright: 1.15, bonus: 1.25 },
  huge: { hunters: 2, cap: 8, fright: 1.3, bonus: 1.5 },
  vast: { hunters: 2, cap: 8, fright: 1.5, bonus: 2 },
};
const NUMERALS = ['', ' II', ' III', ' IV'];

/**
 * A house's scatter box: its band of rows (split halfway between house rows) across the map,
 * or across its own half for a side house. At the classic size this is the whole maze, so the
 * corners are the arcade's.
 */
export function scatterCorners(maze, house) {
  const rows = [...new Set(maze.houses.map(q => q.center.y))].sort((a, b) => a - b), k = rows.indexOf(house.center.y);
  const y0 = k <= 0 ? 0 : Math.round((rows[k - 1] + rows[k]) / 2), y1 = k === rows.length - 1 ? maze.h - 1 : Math.round((rows[k] + rows[k + 1]) / 2);
  const x0 = house.side > 0 ? maze.w / 2 : 0, x1 = house.side < 0 ? maze.w / 2 - 1 : maze.w - 1;
  return { chaser: [x1 - 2, y0 - 4], ambusher: [x0 + 2, y0 - 4], whimsical: [x1, y1 + 2], shy: [x0, y1 + 2] };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const sign = v => (v > 0 ? 1 : v < 0 ? -1 : 0);
const rev = d => (d < 0 ? d : (d + 2) % 4);
const emit = (s, name, data = {}) => s.events.push({ name, ...data });
/** Distance between two positions, the short way round through the tunnels. */
export function wrapDist(a, b, w = W) {
  const dx = Math.abs(a.x - b.x), dy = a.y - b.y;
  const wx = Math.min(dx, w - dx);
  return Math.hypot(wx, dy);
}
export const tileOf = (e, w = W) => ({ x: wrapX(Math.round(e.x), w), y: Math.round(e.y) });

/** Which way the held stick asks for; on a diagonal, the axis that would turn. */
export function inputDir(input, dir) {
  const x = sign(input?.x || 0), y = sign(input?.y || 0);
  if (x && y) return dir === LEFT || dir === RIGHT ? (y < 0 ? UP : DOWN) : (x < 0 ? LEFT : RIGHT);
  if (x) return x < 0 ? LEFT : RIGHT;
  if (y) return y < 0 ? UP : DOWN;
  return NONE;
}

export function createGame(content, { seed = 1 } = {}) {
  const levels = content.levels;
  const mazes = new Map();
  const seedKey = String(seed);
  const sizeAt = i => levels[i % levels.length].maze.size || 'classic';
  /**
   * Level i's hunters: the content's list, scaled with the maze's area, spread over its houses
   * round-robin. The first hunter of each house starts outside; each takes its personality's
   * scatter corner of its house's region, or the next free one.
   */
  function rosterFor(i) {
    const maze = mazeFor(i), rule = SIZE_RULES[maze.size] || SIZE_RULES.classic, n = content.hunters.length;
    const count = Math.min(rule.cap, maze.size === 'classic' ? n : Math.max(n, Math.ceil(n * rule.hunters)));
    const used = maze.houses.map(() => new Set());
    return Array.from({ length: count }, (_, j) => {
      const base = content.hunters[j % n], home = j % maze.houses.length, slot = Math.floor(j / maze.houses.length);
      let k = used[home].has(base.personality) ? CORNER_ORDER.find(c => !used[home].has(c)) : base.personality;
      if (!k) k = CORNER_ORDER[used[home].size % 4];
      used[home].add(k);
      return { name: base.name + NUMERALS[Math.min(3, Math.floor(j / n))], personality: base.personality, color: base.color, home, slot, corner: scatterCorners(maze, maze.houses[home])[k] };
    });
  }

  /** Parameters of level i (0-based). Endless play cycles the content levels, a little faster each loop. */
  const infos = new Map();
  function levelInfo(i) { if (!infos.has(i)) infos.set(i, computeLevelInfo(i)); return infos.get(i); }
  function computeLevelInfo(i) {
    const n = levels.length, lv = levels[i % n], number = i + 1, rule = SIZE_RULES[sizeAt(i)] || SIZE_RULES.classic;
    const tier = number === 1 ? 0 : number <= 4 ? 1 : 2;
    const loop = Math.floor(i / n);
    const mult = lv.speed * Math.min(1.25, 1 + 0.05 * loop);
    const sp = Object.fromEntries(Object.entries(SPEEDS[tier]).map(([k, v]) => [k, v * BASE_SPEED * mult]));
    const bonus = content.bonus[Math.min(i, content.bonus.length - 1)];
    return {
      index: i, number, tier, speed: { ...sp, eyes: 2 * BASE_SPEED * mult, house: 0.5 * sp.ghost, leaving: 0.6 * sp.ghost },
      frightFrames: Math.round(FRIGHT_SECONDS[Math.min(i, FRIGHT_SECONDS.length - 1)] * FPS * rule.fright), bonusFrames: Math.round(BONUS_TIME * rule.bonus),
      schedule: SCHEDULES[tier].map(sec => (Number.isFinite(sec) ? Math.max(1, Math.round(sec * FPS)) : Infinity)),
      dotLimits: DOT_LIMITS[Math.min(i, 2)], idleFrames: (number < 5 ? 4 : 3) * FPS,
      elroy: ELROY[Math.min(i, ELROY.length - 1)], bonus,
    };
  }
  function mazeFor(i) {
    if (!mazes.has(i)) mazes.set(i, buildMaze(levels[i % levels.length].maze, seedFrom(`${seedKey}:maze:${i}`)));
    return mazes.get(i);
  }

  function resetActors(s) {
    const maze = mazeFor(s.level);
    s.player = { x: maze.start.x, y: maze.start.y, dir: LEFT, want: NONE, moving: true, face: -1, eatT: 0, travel: 0 };
    s.hunters = rosterFor(s.level).map((h, i) => {
      const slot = maze.houses[h.home].slots[Math.min(h.slot, 5)];
      return {
        index: i, name: h.name, personality: h.personality, color: h.color, corner: h.corner, home: h.home,
        x: slot.x, y: slot.y, dir: h.slot === 0 ? LEFT : h.slot % 2 ? DOWN : UP,
        state: h.slot === 0 ? 'active' : 'house', fright: false, dots: s.hunters?.[i]?.dots ?? 0,
      };
    });
    s.mode = 'scatter'; s.modeIdx = 0; s.modeT = 0;
    s.frightT = 0; s.frightTotal = 0; s.chain = 0; s.pauseT = 0; s.sinceEat = 0; s.bonus = null;
  }
  function loadLevel(s, i) {
    s.level = i;
    const maze = mazeFor(i);
    s.pellets = new Array(maze.w * maze.h).fill(0);
    for (const p of maze.pellets) s.pellets[p] = 1;
    for (const p of maze.power) s.pellets[p] = 2;
    s.pelletsTotal = maze.pellets.length; s.pelletsLeft = maze.pellets.length; s.pelletsEaten = 0;
    // Classic: at 70 and 170 pellets; bigger mazes keep the same fractions of the level.
    s.bonusAt = maze.size === 'classic' ? [Math.min(70, Math.floor(s.pelletsTotal * 0.3)), Math.min(170, Math.floor(s.pelletsTotal * 0.7))] : [Math.round(s.pelletsTotal * 0.29), Math.round(s.pelletsTotal * 0.7)];
    s.globalDots = null;
    s.hunters = null;
    resetActors(s);
    for (const h of s.hunters) h.dots = 0;
  }

  function createState({ high = 0 } = {}) {
    const s = {
      status: 'playing', score: 0, high: Math.max(0, Number(high) || 0), events: [], reason: null,
      rng: seedFrom(`${seedKey}:play`), frame: 0, level: 0, phase: 'ready', phaseT: READY_FIRST,
      lives: content.lives, extraGiven: false, killer: null, prevInput: { x: 0, y: 0, a: false, b: false },
    };
    loadLevel(s, 0);
    return s;
  }

  function addScore(s, n) {
    s.score += n;
    if (!s.extraGiven && content.extraLifeAt > 0 && s.score >= content.extraLifeAt) { s.extraGiven = true; s.lives++; emit(s, 'extra_life', { lives: s.lives }); }
  }

  // ---------- player ----------
  function tryTurn(p, maze) {
    const w = p.want;
    if (w < 0 || (w === p.dir && p.moving)) return;
    if (w === rev(p.dir)) { p.dir = w; p.moving = true; return; }
    const cx = Math.round(p.x), cy = Math.round(p.y);
    if (w === p.dir) { if (isOpen(maze, cx + DX[w], cy + DY[w])) p.moving = true; return; }
    const off = !p.moving || p.dir < 0 ? 0 : DX[p.dir] ? Math.abs(p.x - cx) : Math.abs(p.y - cy);
    if (off > CORNER || !isOpen(maze, cx + DX[w], cy + DY[w])) return;
    p.dir = w; p.moving = true;
  }
  function movePlayer(s, L, maze) {
    const p = s.player;
    tryTurn(p, maze);
    const eating = p.eatT > 0;
    if (p.eatT > 0) p.eatT--;
    if (!p.moving || p.dir < 0) return;
    const sp = s.frightT > 0 ? (eating ? L.speed.pacFrightDots : L.speed.pacFright) : (eating ? L.speed.pacDots : L.speed.pac);
    const d = sp * STEP, horiz = DX[p.dir] !== 0, sg = horiz ? DX[p.dir] : DY[p.dir];
    // Cornering: the cross axis eases onto the lane centre while moving, so turns cut the corner.
    if (horiz) p.y += clamp(Math.round(p.y) - p.y, -d, d); else p.x += clamp(Math.round(p.x) - p.x, -d, d);
    let a = horiz ? p.x : p.y;
    const c = sg > 0 ? Math.ceil(a - EPS) : Math.floor(a + EPS); // the centre at or ahead
    const ax = horiz ? c + sg : Math.round(p.x), ay = horiz ? Math.round(p.y) : c + sg;
    if (Math.abs(c - a) <= d && !isOpen(maze, ax, ay)) { p.travel += Math.abs(c - a); a = c; p.moving = false; }
    else { a += sg * d; p.travel += d; }
    if (horiz) { p.x = a; p.face = sg; } else p.y = a;
    if (p.x < -0.5) p.x += maze.w; else if (p.x >= maze.w - 0.5) p.x -= maze.w;
  }
  function eat(s, L, maze) {
    const p = s.player, t = tileOf(p, maze.w), i = t.y * maze.w + t.x, v = s.pellets[i];
    if (!v) return;
    s.pellets[i] = 0; s.pelletsLeft--; s.pelletsEaten++; s.sinceEat = 0; p.eatT = 8;
    if (v === 2) { addScore(s, 50); emit(s, 'power', { points: 50, x: t.x, y: t.y }); startFright(s, L); }
    else { addScore(s, 10); emit(s, 'collect', { item: 'pellet', points: 10, x: t.x, y: t.y }); }
    if (s.globalDots != null) s.globalDots++;
    else { const h = s.hunters.find(q => q.state === 'house'); if (h) h.dots++; }
    if (s.pelletsEaten === s.bonusAt[0] || s.pelletsEaten === s.bonusAt[1]) {
      s.bonus = { t: L.bonusFrames, name: L.bonus.name, points: L.bonus.points, x: maze.bonusAt.x, y: maze.bonusAt.y };
      emit(s, 'bonus_spawn', { prize: L.bonus.name, points: L.bonus.points });
    }
    if (s.pelletsLeft === 0) {
      s.phase = 'clear'; s.phaseT = 0; s.frightT = 0; s.bonus = null;
      for (const h of s.hunters) h.fright = false;
      emit(s, 'level_clear', { level: L.number });
    }
  }
  function startFright(s, L) {
    s.chain = 0;
    for (const h of s.hunters) {
      if (h.state === 'eyes' || h.state === 'entering') continue;
      if (h.state === 'active') h.dir = rev(h.dir);
      if (L.frightFrames > 0) h.fright = true;
    }
    s.frightT = L.frightFrames; s.frightTotal = L.frightFrames;
  }

  // ---------- hunters ----------
  /** The tile a hunter heads for right now (also used by tests). */
  function targetFor(s, h, L = levelInfo(s.level)) {
    const maze = mazeFor(s.level), home = maze.houses[h.home ?? 0];
    if (h.state === 'eyes') return [home.exit.x, home.exit.y];
    const p = tileOf(s.player, maze.w), pd = s.player.dir < 0 ? LEFT : s.player.dir;
    const elroy = h.personality === 'chaser' && s.pelletsLeft <= L.elroy[0];
    if (s.mode === 'scatter' && !elroy) return h.corner;
    switch (h.personality) {
      case 'ambusher': return [p.x + 4 * DX[pd], p.y + 4 * DY[pd]];
      case 'whimsical': {
        const pivot = [p.x + 2 * DX[pd], p.y + 2 * DY[pd]];
        const ref = s.hunters.find(q => q.personality === 'chaser' && q.home === h.home) || s.hunters.find(q => q.personality === 'chaser') || s.hunters[0];
        const c = tileOf(ref, maze.w);
        return [2 * pivot[0] - c.x, 2 * pivot[1] - c.y];
      }
      case 'shy': {
        const t = tileOf(h, maze.w);
        return Math.hypot(t.x - p.x, t.y - p.y) > 8 ? [p.x, p.y] : h.corner;
      }
      default: return [p.x, p.y];
    }
  }
  function decide(s, h, maze, L) {
    const cx = h.x, cy = h.y, options = [];
    const blockUp = content.noUpwardTurns && h.state === 'active' && !h.fright && maze.noUp.includes(cy * maze.w + cx);
    for (let d = 0; d < 4; d++) {
      if (h.dir >= 0 && d === rev(h.dir)) continue;
      if (d === UP && blockUp) continue;
      if (isOpen(maze, cx + DX[d], cy + DY[d])) options.push(d);
    }
    if (!options.length) { h.dir = h.dir >= 0 ? rev(h.dir) : LEFT; return; }
    if (h.fright && h.state === 'active') { h.dir = options[Math.floor(random(s) * options.length)]; return; }
    const [tx, ty] = targetFor(s, h, L);
    let best = options[0], bestD = Infinity;
    for (const d of options) {
      const dist = (cx + DX[d] - tx) ** 2 + (cy + DY[d] - ty) ** 2;
      if (dist < bestD - EPS) { bestD = dist; best = d; }
    }
    h.dir = best;
  }
  /** Scripted moves through the house: along x then y toward a point; returns leftover distance. */
  function toward(h, axis, target, d) {
    const cur = h[axis], delta = target - cur;
    if (Math.abs(delta) <= d) { h[axis] = target; return d - Math.abs(delta); }
    h[axis] = cur + Math.sign(delta) * d;
    h.dir = axis === 'x' ? (delta < 0 ? LEFT : RIGHT) : (delta < 0 ? UP : DOWN);
    return 0;
  }
  /** Scripted moves inside and through a hunter's own house (bobbing, leaving, eyes going back in). */
  function scripted(s, h, d, maze) {
    const { exit, center } = maze.houses[h.home ?? 0];
    if (h.state === 'house') {
      h.dir = h.dir === UP ? UP : DOWN;
      h.y += (h.dir === UP ? -1 : 1) * d;
      if (h.y <= center.y - 0.5) { h.y = center.y - 0.5; h.dir = DOWN; } else if (h.y >= center.y + 0.5) { h.y = center.y + 0.5; h.dir = UP; }
      return;
    }
    if (h.state === 'leaving') {
      if (Math.abs(h.x - exit.x) > EPS) { d = toward(h, 'y', center.y, d); if (d > 0) d = toward(h, 'x', exit.x, d); }
      if (d > 0) d = toward(h, 'y', exit.y, d);
      if (Math.abs(h.x - exit.x) < EPS && Math.abs(h.y - exit.y) < EPS) { h.state = 'active'; h.dir = LEFT; h.x = exit.x; h.y = exit.y; }
      return;
    }
    if (h.state === 'entering') {
      d = toward(h, 'x', exit.x, d);
      if (d > 0) d = toward(h, 'y', center.y, d);
      if (Math.abs(h.y - center.y) < EPS) { h.state = 'leaving'; h.fright = false; h.dir = UP; emit(s, 'revived', { hunter: h.name }); }
    }
  }
  function gridMove(s, h, d, maze, L) {
    let rem = d;
    for (let guard = 0; rem > EPS && guard < 4; guard++) {
      if (Math.abs(h.x - Math.round(h.x)) < EPS && Math.abs(h.y - Math.round(h.y)) < EPS) {
        h.x = wrapX(Math.round(h.x), maze.w); h.y = Math.round(h.y);
        const exit = maze.houses[h.home ?? 0].exit;
        if (h.state === 'eyes' && h.y === exit.y && Math.abs(h.x - exit.x) === 0.5) { h.state = 'entering'; scripted(s, h, rem, maze); return; }
        decide(s, h, maze, L);
      }
      const horiz = DX[h.dir] !== 0, sg = horiz ? DX[h.dir] : DY[h.dir], a = horiz ? h.x : h.y;
      if (horiz) h.y = Math.round(h.y); else h.x = Math.round(h.x); // stay on the lane
      const c = sg > 0 ? Math.floor(a + EPS) + 1 : Math.ceil(a - EPS) - 1; // next centre strictly ahead
      const step = Math.min(rem, Math.abs(c - a));
      if (horiz) h.x = a + sg * step; else h.y = a + sg * step;
      rem -= step;
    }
    if (h.x < -0.5) h.x += maze.w; else if (h.x >= maze.w - 0.5) h.x -= maze.w;
  }
  function hunterSpeed(s, h, maze, L) {
    if (h.state === 'eyes' || h.state === 'entering') return L.speed.eyes;
    if (h.state === 'house') return L.speed.house;
    if (h.state === 'leaving') return L.speed.leaving;
    if (h.fright) return L.speed.fright;
    const t = tileOf(h, maze.w);
    if (maze.tunnels.includes(t.y) && (t.x <= 4 || t.x >= maze.w - 5)) return L.speed.tunnel;
    if (h.personality === 'chaser') {
      if (s.pelletsLeft <= L.elroy[1]) return L.speed.elroy2;
      if (s.pelletsLeft <= L.elroy[0]) return L.speed.elroy1;
    }
    return L.speed.ghost;
  }
  function moveHunters(s, L, maze) {
    for (const h of s.hunters) {
      if (h.stunT > 0) { h.stunT--; continue; } // stunned (by a mod): frozen in place
      const d = hunterSpeed(s, h, maze, L) * STEP;
      if (h.state === 'active' || h.state === 'eyes') gridMove(s, h, d, maze, L);
      else scripted(s, h, d, maze);
    }
  }

  // ---------- timers, release, collisions ----------
  function timers(s, L, maze) {
    if (s.frightT > 0) {
      if (--s.frightT === 0) { for (const h of s.hunters) h.fright = false; emit(s, 'fright_end'); }
    } else if (++s.modeT >= L.schedule[s.modeIdx]) {
      s.modeIdx = Math.min(s.modeIdx + 1, L.schedule.length - 1); s.modeT = 0;
      s.mode = s.modeIdx % 2 ? 'chase' : 'scatter';
      for (const h of s.hunters) if (h.state === 'active') h.dir = rev(h.dir);
      emit(s, 'mode', { mode: s.mode });
    }
    if (s.bonus && --s.bonus.t <= 0) s.bonus = null;
    if (s.bonus && wrapDist(s.player, s.bonus, maze.w) < 0.7) {
      addScore(s, s.bonus.points);
      emit(s, 'collect', { item: 'bonus', prize: s.bonus.name, points: s.bonus.points, x: s.bonus.x, y: s.bonus.y });
      s.bonus = null;
    }
    s.sinceEat++;
    const h = s.hunters.find(q => q.state === 'house');
    if (!h) { s.globalDots = null; return; }
    let go = s.globalDots != null ? s.globalDots >= (GLOBAL_LIMITS[h.index] ?? 62 + 15 * (h.index - 5)) : h.dots >= L.dotLimits[h.index];
    if (s.sinceEat >= L.idleFrames) { go = true; s.sinceEat = 0; }
    if (go) { h.state = 'leaving'; emit(s, 'release', { hunter: h.name }); }
  }
  function collide(s, maze) {
    const p = s.player;
    for (const h of s.hunters) {
      if (!(h.state === 'active' || (h.state === 'leaving' && h.y < maze.houses[h.home ?? 0].y0)) || h.stunT > 0) continue;
      if (wrapDist(p, h, maze.w) >= 0.6) continue;
      if (h.fright) {
        const points = 200 * 2 ** Math.min(s.chain, 3);
        s.chain++;
        addScore(s, points);
        emit(s, 'defeated', { hunter: h.name, index: h.index, points, chain: s.chain, x: h.x, y: h.y });
        // Caught at the door on the way out: the eyes slip straight back in.
        h.state = h.state === 'leaving' ? 'entering' : 'eyes'; h.fright = false;
        s.pauseT = EAT_PAUSE;
      } else {
        s.phase = 'dying'; s.phaseT = 0; s.killer = h.name; s.bonus = null; s.frightT = 0;
        for (const q of s.hunters) q.fright = false;
        emit(s, 'hurt', { by: h.name, index: h.index, x: p.x, y: p.y });
        return;
      }
    }
  }
  function play(s) {
    if (s.pauseT > 0) { s.pauseT--; return; }
    const L = levelInfo(s.level), maze = mazeFor(s.level);
    movePlayer(s, L, maze);
    eat(s, L, maze);
    if (s.phase !== 'play') return;
    collide(s, maze);
    if (s.phase !== 'play' || s.pauseT > 0) return;
    timers(s, L, maze);
    moveHunters(s, L, maze);
    collide(s, maze);
  }

  function step(s, input = {}) {
    s.events = [];
    if (s.status !== 'playing') return s;
    s.frame++;
    const inp = { x: sign(input.x || 0), y: sign(input.y || 0), a: !!input.a, b: !!input.b };
    const want = inputDir(inp, s.player.dir);
    if (want >= 0) s.player.want = want;
    s.prevInput = inp;
    if (s.phase === 'ready') {
      if (--s.phaseT <= 0) { s.phase = 'play'; s.phaseT = 0; emit(s, 'start', { level: s.level + 1 }); }
    } else if (s.phase === 'play') play(s);
    else if (s.phase === 'dying') {
      if (++s.phaseT >= DYING) {
        s.lives--;
        if (s.lives <= 0) { s.status = 'lost'; s.reason = `Caught by ${s.killer}`; emit(s, 'lost', { reason: s.reason }); return s; }
        resetActors(s); s.globalDots = 0; s.phase = 'ready'; s.phaseT = READY;
      }
    } else if (s.phase === 'clear') {
      if (++s.phaseT >= CLEAR) {
        if (!content.endless && s.level + 1 >= levels.length) { s.status = 'won'; emit(s, 'won', { score: s.score }); return s; }
        loadLevel(s, s.level + 1); s.phase = 'ready'; s.phaseT = READY;
        emit(s, 'level_up', { level: s.level + 1 });
      }
    }
    return s;
  }

  const first = sizeOf(sizeAt(0));
  // width/height are level 1's; every level's own dimensions are on mazeFor(i).w/h.
  return { content, seed, width: first.w, height: first.h, levelCount: levels.length, createState, step, mazeFor, levelInfo, targetFor, addScore, rosterFor };
}
