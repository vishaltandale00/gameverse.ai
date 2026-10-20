// Slide mode (2048-like): slide every tile with x/y, equal tiles merge once
// per move, a 2 (or sometimes a 4) spawns after every move that changed the
// board, levels ask for ever larger tiles, and endless play keeps going after
// the last target. Optional fixed rocks split lines.
import { edges, emit, baseState, rint, lose, win, levelAt, isLastLevel, DT } from './common.js';
import { random } from '../../kernel/rng.js';

export const SLIDE_FRAMES = 7, INTRO_FRAMES = 70;
const DIRS = { left: 0, right: 1, up: 2, down: 3 };

/** Ordered cell lines for a direction: each line lists cells from the edge tiles move toward. */
export function linesFor(n, dir) {
  const out = [];
  for (let a = 0; a < n; a++) {
    const line = [];
    for (let k = 0; k < n; k++) {
      const j = dir === 1 || dir === 3 ? n - 1 - k : k;
      line.push(dir < 2 ? a * n + j : j * n + a);
    }
    out.push(line);
  }
  return out;
}

/** Slide plain values (0 = empty, -1 = rock). Returns { grid, moved, gained, merges: [[to, value]], moves: [[from, to]] }. */
export function slideGrid(grid, n, dir) {
  const out = grid.slice(), moves = [], merges = [];
  let moved = false, gained = 0;
  for (const line of linesFor(n, dir)) {
    let seg = [];
    const flush = () => {
      const vals = seg.filter(i => grid[i] > 0);
      let w = 0, lastMerged = true;
      for (const from of vals) {
        const v = grid[from];
        if (w > 0 && !lastMerged && out[seg[w - 1]] === v) {
          const to = seg[w - 1]; out[to] = v * 2; gained += v * 2; merges.push([to, v * 2]); moves.push([from, to]); lastMerged = true; if (from !== to) moved = true; continue;
        }
        const to = seg[w++]; out[to] = v; moves.push([from, to]); lastMerged = false; if (from !== to) moved = true;
      }
      for (let k = w; k < seg.length; k++) out[seg[k]] = 0;
      seg = [];
    };
    for (const i of line) { if (grid[i] === -1) flush(); else seg.push(i); }
    flush();
  }
  return { grid: out, moved: moved || merges.length > 0, gained, merges, moves };
}
export const canMove = (grid, n) => [0, 1, 2, 3].some(d => slideGrid(grid, n, d).moved);

export function createSlide(content, { seed = 1, startAt = 0, fast = false } = {}) {
  const n = content.rules.width, spawnFour = content.rules.spawnFour;
  const frames = fast ? 0 : SLIDE_FRAMES;

  const gridOf = s => { const g = new Array(n * n).fill(0); s.rocks.forEach(i => { g[i] = -1; }); s.tiles.forEach(t => { g[t.y * n + t.x] = t.v; }); return g; };
  function spawnTile(s) {
    const g = gridOf(s), empty = g.map((v, i) => v === 0 ? i : -1).filter(i => i >= 0);
    if (!empty.length) return null;
    const i = empty[rint(s, empty.length)], v = random(s) < spawnFour ? 4 : 2;
    const t = { id: s.nextId++, v, x: i % n, y: Math.floor(i / n), fx: i % n, fy: Math.floor(i / n), merged: false, born: true };
    s.tiles.push(t);
    emit(s, 'spawn_tile', { x: t.x, y: t.y, v });
    return t;
  }
  function createState() {
    const s = Object.assign(baseState('slide', seed), { n, tiles: [], ghosts: [], rocks: [], nextId: 1, anim: 0, queued: -1, moves: 0, maxTile: 0, reached: false, stats: { moves: 0, merges: 0, biggestMerge: 0 } });
    const L0 = levelAt(content, startAt);
    L0.layout.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === 'x') s.rocks.push(y * n + x); }));
    for (let k = 0; k < L0.obstacles && s.rocks.length < n - 2; k++) {
      for (let t = 0; t < 30; t++) { const i = rint(s, n * n); if (!s.rocks.includes(i)) { s.rocks.push(i); break; } }
    }
    s.level = startAt; s.moves = L0.moves;
    spawnTile(s); spawnTile(s);
    s.maxTile = Math.max(...s.tiles.map(t => t.v));
    s.events = [];
    s.phase = 'intro'; s.phaseT = fast ? 1 : INTRO_FRAMES;
    return s;
  }
  function goalMet(s, L) { return L.goal === 'tile' ? s.maxTile >= L.target : s.levelScore >= L.target; }
  function checkLevels(s) {
    for (let guard = 0; guard < 20; guard++) {
      const L = levelAt(content, s.level);
      if (!goalMet(s, L)) return;
      if (isLastLevel(content, s.level)) { win(s); return; }
      if (s.level >= content.levels.length - 1) s.reached = true;
      s.level++; s.levelT = 0; s.levelScore = 0;
      const N = levelAt(content, s.level);
      s.moves = N.moves;
      emit(s, 'level_up', { level: s.level, title: N.name, intro: N.intro, tile: L.target });
    }
  }
  function doMove(s, dir) {
    const g = gridOf(s), r = slideGrid(g, n, dir);
    if (!r.moved) { emit(s, 'bump', { dir }); return false; }
    const at = new Map(s.tiles.map(t => [t.y * n + t.x, t]));
    const next = new Map(), ghosts = [];
    for (const [from, to] of r.moves) {
      const t = at.get(from);
      t.fx = t.x; t.fy = t.y; t.merged = false; t.born = false;
      if (next.has(to)) { ghosts.push({ v: t.v, fx: t.x, fy: t.y, x: to % n, y: Math.floor(to / n) }); continue; }
      t.x = to % n; t.y = Math.floor(to / n); next.set(to, t);
    }
    for (const [to, v] of r.merges) { const t = next.get(to); t.v = v; t.merged = true; }
    s.tiles = [...next.values()]; s.ghosts = ghosts;
    s.score += r.gained; s.levelScore += r.gained;
    s.stats.moves++; s.stats.merges += r.merges.length;
    if (r.merges.length) {
      const top = Math.max(...r.merges.map(m => m[1]));
      s.stats.biggestMerge = Math.max(s.stats.biggestMerge, top);
      emit(s, 'merge', { merges: r.merges.map(([to, v]) => [to % n, Math.floor(to / n), v]), points: r.gained, top });
      emit(s, 'collect');
      if (top >= 128 && top > s.maxTile) emit(s, 'power', { tile: top });
    }
    s.maxTile = Math.max(s.maxTile, ...s.tiles.map(t => t.v));
    emit(s, 'slide', { dir });
    spawnTile(s);
    s.anim = frames;
    const L = levelAt(content, s.level);
    if (L.moves) s.moves--;
    checkLevels(s);
    if (s.status !== 'playing') return true;
    if (!canMove(gridOf(s), n)) { if (s.reached) win(s); else lose(s, 'No moves left'); }
    else if (L.moves && s.moves <= 0 && !goalMet(s, levelAt(content, s.level))) lose(s, 'Out of moves');
    return true;
  }

  function step(s, input) {
    s.events = [];
    if (s.status !== 'playing') return s;
    const e = edges(s, input);
    s.frame++; s.time += DT;
    if (s.phase === 'intro') { if (--s.phaseT <= 0) { s.phase = 'play'; emit(s, 'go'); } return s; }
    s.levelT++;
    const L = levelAt(content, s.level);
    if (L.timeSec && s.levelT >= L.timeSec * 60) { lose(s, 'Time up'); return s; }
    const dir = e.left ? DIRS.left : e.right ? DIRS.right : e.up ? DIRS.up : e.down ? DIRS.down : -1;
    if (s.anim > 0) { s.anim--; if (dir >= 0) s.queued = dir; return s; }
    const d = dir >= 0 ? dir : s.queued;
    s.queued = -1;
    if (d >= 0) doMove(s, d);
    return s;
  }

  return { mode: 'slide', content, n, createState, step, gridOf };
}

// ---------- bot: expectimax over spawns with a per-line heuristic ----------
// Each row and column scores empties, mergeable neighbors, monotonicity and
// the total (the well-known 2048 line heuristic), memoized per line.
export function slideBot(game, { depth = 2 } = {}) {
  const n = game.n, memo = new Map();
  const line = new Array(n);
  const lineScore = ranks => {
    let key = 0;
    for (const r of ranks) key = key * 32 + (r < 0 ? 31 : r);
    let v = memo.get(key);
    if (v !== undefined) return v;
    let empty = 0, merges = 0, prev = 0, counter = 0, sum = 0, monoL = 0, monoR = 0;
    for (const r of ranks) {
      if (r < 0) continue;
      sum += Math.pow(r, 3.5);
      if (!r) empty++;
      else { if (prev === r) counter++; else if (counter > 0) { merges += 1 + counter; counter = 0; } prev = r; }
    }
    if (counter > 0) merges += 1 + counter;
    for (let i = 1; i < ranks.length; i++) {
      const a = Math.max(0, ranks[i - 1]), b = Math.max(0, ranks[i]);
      if (a > b) monoL += a ** 4 - b ** 4; else monoR += b ** 4 - a ** 4;
    }
    v = 200000 + 270 * empty + 700 * merges - 47 * Math.min(monoL, monoR) - 11 * sum;
    memo.set(key, v);
    return v;
  };
  const rankOf = v => v > 0 ? 31 - Math.clz32(v) : v < 0 ? -1 : 0;
  const evaluate = g => {
    let t = 0;
    for (let a = 0; a < n; a++) {
      for (let k = 0; k < n; k++) line[k] = rankOf(g[a * n + k]);
      t += lineScore(line);
      for (let k = 0; k < n; k++) line[k] = rankOf(g[k * n + a]);
      t += lineScore(line);
    }
    return t;
  };
  const chance = (g, d) => {
    const empties = [];
    for (let i = 0; i < g.length; i++) if (g[i] === 0) empties.push(i);
    if (!empties.length) return evaluate(g);
    const pick = empties.length > 6 && d > 1 ? empties.filter((_, k) => k % 2 === 0) : empties;
    let t = 0;
    for (const i of pick) for (const [v, p] of [[2, 0.9], [4, 0.1]]) {
      g[i] = v; t += p * (d > 1 ? maxNode(g, d - 1) : evaluate(g)); g[i] = 0;
    }
    return t / pick.length;
  };
  const maxNode = (g, d) => {
    let best = 0;
    for (let dir = 0; dir < 4; dir++) { const r = slideGrid(g, n, dir); if (r.moved) best = Math.max(best, chance(r.grid, d)); }
    return best;
  };
  const choose = g => {
    let bestD = -1, bestV = -Infinity;
    const empties = g.filter(v => v === 0).length, dd = empties <= 3 ? depth + 1 : depth;
    for (let dir = 0; dir < 4; dir++) {
      const r = slideGrid(g, n, dir); if (!r.moved) continue;
      const v = chance(r.grid, dd - 1 || 1);
      if (v > bestV) { bestV = v; bestD = dir; }
    }
    return bestD;
  };
  let tick = 0;
  const idle = { x: 0, y: 0, a: false, b: false };
  return s => {
    if (s.phase !== 'play' || s.anim > 0) return idle;
    if (++tick % 2) return idle;
    const d = choose(game.gridOf(s));
    return d === 0 ? { ...idle, x: -1 } : d === 1 ? { ...idle, x: 1 } : d === 2 ? { ...idle, y: -1 } : d === 3 ? { ...idle, y: 1 } : idle;
  };
}
