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


// ---------- bot: expectimax over spawns ----------
// The board is n row keys (4 bits per cell: the tile's log2, 0 empty, 15 rock). Row slides and the
// standard line heuristic (empty cells, mergeable neighbors, monotonicity, a penalty on large
// scattered tiles) are memoized per row key, and scored on rows and columns so big tiles gather
// in a corner. Search: max over moves, chance over every spawn (2 at 90%, 4 at 10%), depth from
// how crowded the board is, a probability cutoff and a transposition table.
const ROCK = 15, TABLES = new Map(); // per board size, shared by every bot (row results never change)
function tablesFor(n) {
  if (!TABLES.has(n)) { const SIZE = 16 ** n, typed = n <= 5; TABLES.set(n, { typed, leftT: typed ? new Int32Array(SIZE).fill(-1) : new Map(), rightT: typed ? new Int32Array(SIZE).fill(-1) : new Map(), heurT: typed ? new Float64Array(SIZE).fill(NaN) : new Map() }); }
  return TABLES.get(n);
}
export function slideBot(game, { maxDepth = 3 } = {}) {
  const n = game.n, N = n * n, { typed, leftT, rightT, heurT } = tablesFor(n);
  const nib = (k, j) => (k >>> (4 * j)) & 15;
  const rev = k => { let r = 0; for (let j = 0; j < n; j++) r |= nib(k, j) << (4 * (n - 1 - j)); return r; };
  function slideLeft(k) {
    const out = new Array(n).fill(0);
    let seg = 0;
    while (seg < n) {
      if (nib(k, seg) === ROCK) { out[seg] = ROCK; seg++; continue; }
      let end = seg; while (end < n && nib(k, end) !== ROCK) end++;
      let w = seg, last = 0;
      for (let j = seg; j < end; j++) { const x = nib(k, j); if (!x) continue; if (last === x) { out[w - 1] = Math.min(14, x + 1); last = 0; } else { out[w++] = x; last = x; } }
      seg = end;
    }
    let v = 0; for (let j = 0; j < n; j++) v |= out[j] << (4 * j);
    return v;
  }
  const get = (T, k) => typed ? T[k] : T.get(k);
  const left = k => { let v = get(leftT, k); if (v === undefined || v === -1) { v = slideLeft(k); typed ? (leftT[k] = v) : leftT.set(k, v); } return v; };
  const right = k => { let v = get(rightT, k); if (v === undefined || v === -1) { v = rev(slideLeft(rev(k))); typed ? (rightT[k] = v) : rightT.set(k, v); } return v; };
  function heur(k) {
    let v = get(heurT, k);
    if (v !== undefined && !Number.isNaN(v)) return v;
    let empty = 0, merges = 0, prev = 0, counter = 0, sum = 0, monoL = 0, monoR = 0;
    for (let j = 0; j < n; j++) {
      const x = nib(k, j) === ROCK ? 0 : nib(k, j);
      sum += Math.pow(x, 3.5);
      if (!x) empty++;
      else { if (prev === x) counter++; else if (counter > 0) { merges += 1 + counter; counter = 0; } prev = x; }
    }
    if (counter > 0) merges += 1 + counter;
    for (let j = 1; j < n; j++) { const a = nib(k, j - 1) === ROCK ? 0 : nib(k, j - 1), b = nib(k, j) === ROCK ? 0 : nib(k, j); if (a > b) monoL += a ** 4 - b ** 4; else monoR += b ** 4 - a ** 4; }
    v = 200000 + 270 * empty + 700 * merges - 47 * Math.min(monoL, monoR) - 11 * sum;
    typed ? (heurT[k] = v) : heurT.set(k, v);
    return v;
  }
  const colKey = (rows, j) => { let c = 0; const sh = 4 * j; for (let i = 0; i < n; i++) c |= ((rows[i] >>> sh) & 15) << (4 * i); return c; };
  function move(rows, dir) {
    let out = null;
    if (dir < 2) {
      for (let i = 0; i < n; i++) { const k = rows[i], r = dir === 0 ? left(k) : right(k); if (r !== k) { if (!out) out = rows.slice(); out[i] = r; } }
      return out;
    }
    for (let j = 0; j < n; j++) {
      const k = colKey(rows, j), r = dir === 2 ? left(k) : right(k);
      if (r === k) continue;
      if (!out) out = rows.slice();
      const sh = 4 * j, clear = ~(15 << sh);
      for (let i = 0; i < n; i++) out[i] = (out[i] & clear) | (((r >>> (4 * i)) & 15) << sh);
    }
    return out;
  }
  const evaluate = rows => { let t = 0; for (let i = 0; i < n; i++) t += heur(rows[i]) + heur(colKey(rows, i)); return t; };
  // transposition table: open addressing on two 32-bit hashes of the rows
  const TT = 1 << 18, tKey1 = new Int32Array(TT), tKey2 = new Int32Array(TT), tDepth = new Int8Array(TT), tGen = new Int32Array(TT), tVal = new Float64Array(TT);
  let gen = 0;
  let h1 = 0, h2 = 0;
  const hashes = rows => { let a = 0x811c9dc5 | 0, b = 0x01000193 | 0; for (let i = 0; i < n; i++) { a = Math.imul(a ^ rows[i], 0x01000193); b = Math.imul(b + rows[i], 0x9e3779b1) ^ (b >>> 13); } h1 = a; h2 = b; };
  function chance(rows, depth, prob) {
    if (depth <= 0 || prob < 0.0001) return evaluate(rows);
    hashes(rows);
    const k1 = h1, k2 = h2, slot = (k1 ^ (k2 >>> 7)) & (TT - 1);
    if (tGen[slot] === gen && tKey1[slot] === k1 && tKey2[slot] === k2 && tDepth[slot] >= depth) return tVal[slot];
    let total = 0, count = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (nib(rows[i], j)) continue;
      count++;
      const r = rows[i];
      rows[i] = r | (1 << (4 * j)); total += 0.9 * maxNode(rows, depth, prob * 0.9);
      rows[i] = r | (2 << (4 * j)); total += 0.1 * maxNode(rows, depth, prob * 0.1);
      rows[i] = r;
    }
    const v = count ? total / count : evaluate(rows);
    tGen[slot] = gen; tKey1[slot] = k1; tKey2[slot] = k2; tDepth[slot] = depth; tVal[slot] = v;
    return v;
  }
  function maxNode(rows, depth, prob) {
    let best = 0;
    for (let d = 0; d < 4; d++) { const m = move(rows, d); if (m) best = Math.max(best, chance(m, depth - 1, prob)); }
    return best;
  }
  function choose(grid) {
    const rows = new Array(n).fill(0);
    let empty = 0; const seen = new Set();
    for (let i = 0; i < N; i++) { const v = grid[i], r = v > 0 ? 31 - Math.clz32(v) : v < 0 ? ROCK : 0; rows[Math.floor(i / n)] |= r << (4 * (i % n)); if (!r) empty++; else if (r !== ROCK) seen.add(r); }
    // Open boards need little lookahead; crowded ones (few empties, many distinct tiles) get the most.
    const depth = Math.min(maxDepth, empty >= 4 ? 1 : seen.size >= 10 || empty <= 1 ? maxDepth : 2);
    if (!gen) gen = 1; // the table persists across moves: a board and depth always score the same
    let bestD = -1, bestV = -Infinity;
    for (let d = 0; d < 4; d++) { const m = move(rows, d); if (!m) continue; const v = chance(m, depth, 1); if (v > bestV) { bestV = v; bestD = d; } }
    return bestD;
  }
  let tick = 0;
  const idle = { x: 0, y: 0, a: false, b: false };
  const bot = s => {
    if (s.phase !== 'play' || s.anim > 0) return idle;
    if (++tick % 2) return idle;
    const d = choose(game.gridOf(s));
    return d === 0 ? { ...idle, x: -1 } : d === 1 ? { ...idle, x: 1 } : d === 2 ? { ...idle, y: -1 } : d === 3 ? { ...idle, y: 1 } : idle;
  };
  bot.choose = choose;
  return bot;
}
