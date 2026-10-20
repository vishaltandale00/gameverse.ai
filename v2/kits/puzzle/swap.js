// Swap mode (match-3): an 8x8 board with a cursor; select a gem and push a
// direction to swap. Matches of 3+ clear with cascades and refill; line 4 makes
// a striped gem, line 5 a color bomb, L/T shapes an area bomb, and specials
// combine when swapped together. Jelly, blockers and collectible items drive
// level goals; dead boards reshuffle. Gems: color 1-6 | ITEM 7, special << 3.
import { edges, autoShift, emit, baseState, rint, lose, win, levelAt, isLastLevel, starsFor, DT } from './common.js';
import { random } from '../../kernel/rng.js';

const dims = b => [b.W, b.H, b.W * b.H];
export const ITEM = 7;
export const SP = { NONE: 0, HSTRIPE: 1, VSTRIPE: 2, AREA: 3, BOMB: 4 };
export const col = g => g & 7;
export const spOf = g => g >> 3;
export const gem = (c, s = 0) => c | (s << 3);
export const SWAP_FRAMES = 9, CLEAR_FRAMES = 16, SHUFFLE_FRAMES = 44, BONUS_FRAMES = 7, DONE_FRAMES = 60, INTRO_FRAMES = 100, HINT_FRAMES = 300;
const isColor = c => c >= 1 && c <= 6;

const playable = (b, i) => !b.hole[i] && !b.block[i];
const xy = (b, i) => [i % b.W, Math.floor(i / b.W)];

/** Horizontal and vertical runs of ≥3 same-colored gems. */
export function findRuns(b) {
  const runs = [], [W, H] = dims(b);
  for (let pass = 0; pass < 2; pass++) for (let a = 0; a < (pass ? W : H); a++) {
    const len = pass ? H : W;
    let k = 0;
    while (k < len) {
      const i = pass ? k * W + a : a * W + k, c = col(b.gems[i]);
      if (!playable(b, i) || !isColor(c)) { k++; continue; }
      let e = k + 1;
      while (e < len) { const j = pass ? e * W + a : a * W + e; if (playable(b, j) && col(b.gems[j]) === c) e++; else break; }
      if (e - k >= 3) runs.push({ dir: pass ? 'v' : 'h', color: c, cells: Array.from({ length: e - k }, (_, t) => pass ? (k + t) * W + a : a * W + k + t) });
      k = e;
    }
  }
  return runs;
}

/** Runs merged into shapes, each with the special it creates and where. */
export function findGroups(b, prefer = []) {
  const runs = findRuns(b), owner = new Map(), groups = [];
  runs.forEach(run => {
    const hit = new Set(run.cells.map(i => owner.get(i)).filter(g => g !== undefined));
    let g;
    if (!hit.size) { g = { runs: [], cells: new Set(), color: run.color }; groups.push(g); }
    else {
      const list = [...hit].map(k => groups[k]); g = list[0];
      for (const o of list.slice(1)) { o.runs.forEach(r => g.runs.push(r)); o.cells.forEach(c => g.cells.add(c)); o.dead = true; }
    }
    g.runs.push(run); run.cells.forEach(c => g.cells.add(c));
    const id = groups.indexOf(g);
    g.cells.forEach(c => owner.set(c, id));
  });
  return groups.filter(g => !g.dead).map(g => {
    const max = Math.max(...g.runs.map(r => r.cells.length));
    const hasH = g.runs.some(r => r.dir === 'h'), hasV = g.runs.some(r => r.dir === 'v');
    let special = SP.NONE;
    if (max >= 5) special = SP.BOMB;
    else if (hasH && hasV) special = SP.AREA;
    else if (max === 4) special = g.runs.find(r => r.cells.length === 4).dir === 'h' ? SP.VSTRIPE : SP.HSTRIPE;
    let at = -1;
    if (special) {
      at = prefer.find(i => g.cells.has(i)) ?? -1;
      if (at < 0 && special === SP.AREA) { const h = g.runs.filter(r => r.dir === 'h').flatMap(r => r.cells), v = new Set(g.runs.filter(r => r.dir === 'v').flatMap(r => r.cells)); at = h.find(i => v.has(i)) ?? -1; }
      if (at < 0) { const long = g.runs.reduce((m, r) => (r.cells.length > m.cells.length ? r : m)); at = long.cells[Math.floor((long.cells.length - 1) / 2)]; }
    }
    return { cells: [...g.cells], color: g.color, special, at, size: g.cells.size };
  });
}

function mostCommonColor(b) {
  const N = b.W * b.H;
  const n = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < N; i++) if (playable(b, i) && isColor(col(b.gems[i]))) n[col(b.gems[i])]++;
  let best = 1; for (let c = 2; c <= 6; c++) if (n[c] > n[best]) best = c;
  return best;
}

// Expand a clear set with the effects of every special inside it.
function expand(b, clear, hits, effects) {
  const [W, H, N] = dims(b);
  const queue = [...clear], done = new Set();
  const add = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = y * W + x; if (b.hole[i]) return;
    if (b.block[i]) { hits.add(i); return; }
    if (!clear.has(i)) { clear.add(i); queue.push(i); }
  };
  while (queue.length) {
    const i = queue.shift(); if (done.has(i)) continue; done.add(i);
    const g = b.gems[i], s = spOf(g), [x, y] = xy(b, i);
    if (s === SP.HSTRIPE) { effects.push({ kind: 'row', x, y, color: col(g) }); for (let k = 0; k < W; k++) add(k, y); }
    else if (s === SP.VSTRIPE) { effects.push({ kind: 'col', x, y, color: col(g) }); for (let k = 0; k < H; k++) add(x, k); }
    else if (s === SP.AREA) { effects.push({ kind: 'area', x, y, r: 1, color: col(g) }); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) add(x + dx, y + dy); }
    else if (s === SP.BOMB) {
      const c = mostCommonColor(b); effects.push({ kind: 'bomb', x, y, color: c });
      for (let k = 0; k < N; k++) if (playable(b, k) && col(b.gems[k]) === c) add(k % W, Math.floor(k / W));
    }
  }
}

/** What a cascade step clears: matched groups (creating specials) plus everything their specials hit. */
export function computeClear(b, prefer = []) {
  const [W, H] = dims(b);
  const groups = findGroups(b, prefer);
  const clear = new Set(), hits = new Set(), effects = [], creates = [];
  for (const g of groups) {
    g.cells.forEach(i => clear.add(i));
    if (g.special) creates.push([g.at, g.special === SP.BOMB ? gem(0, SP.BOMB) : gem(g.color, g.special)]);
    for (const i of g.cells) { const [x, y] = xy(b, i); for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) { if (nx >= 0 && ny >= 0 && nx < W && ny < H && b.block[ny * W + nx]) hits.add(ny * W + nx); } }
  }
  expand(b, clear, hits, effects);
  return { clear: [...clear], hits: [...hits], effects, creates, groups: groups.map(g => ({ size: g.size, special: g.special, color: g.color, at: g.at })) };
}

/** Swapping two specials (or a color bomb with anything) fires a combination. Returns null when not a combo. */
export function comboClear(b, from, to, r) {
  const ga = b.gems[to], gb = b.gems[from]; // after the swap: the moved gem sits at `to`
  const sa = spOf(ga), sb = spOf(gb);
  if (!(sa === SP.BOMB || sb === SP.BOMB || (sa && sb))) return null;
  if (col(ga) === ITEM || col(gb) === ITEM) return null;
  const [W, H, N] = dims(b);
  const clear = new Set([from, to]), hits = new Set(), effects = [];
  const [x, y] = xy(b, to);
  const area = (rad, kind) => { effects.push({ kind, x, y, r: rad }); for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H) { const i = ny * W + nx; if (b.hole[i]) continue; if (b.block[i]) hits.add(i); else clear.add(i); } } };
  const line = (row, colX) => { if (row >= 0 && row < H) { effects.push({ kind: 'row', x, y: row }); for (let k = 0; k < W; k++) { const i = row * W + k; if (b.block[i]) hits.add(i); else if (!b.hole[i]) clear.add(i); } } if (colX >= 0 && colX < W) { effects.push({ kind: 'col', x: colX, y }); for (let k = 0; k < H; k++) { const i = k * W + colX; if (b.block[i]) hits.add(i); else if (!b.hole[i]) clear.add(i); } } };
  // Strip the two swapped specials so the expansion does not fire them again.
  b.gems[from] = col(gb) || 1; b.gems[to] = col(ga) || 1;
  let kind;
  if (sa === SP.BOMB && sb === SP.BOMB) { kind = 'bomb+bomb'; area(Math.max(W, H), 'board'); }
  else if (sa === SP.BOMB || sb === SP.BOMB) {
    const other = sa === SP.BOMB ? gb : ga, c = col(other), so = spOf(other);
    kind = so ? `bomb+${so === SP.AREA ? 'area' : 'stripe'}` : 'bomb';
    effects.push({ kind: 'bomb', x, y, color: c });
    for (let i = 0; i < N; i++) if (playable(b, i) && col(b.gems[i]) === c && i !== from && i !== to) {
      if (so === SP.AREA) b.gems[i] = gem(c, SP.AREA);
      else if (so) b.gems[i] = gem(c, random(r) < 0.5 ? SP.HSTRIPE : SP.VSTRIPE);
      clear.add(i);
    }
  } else if (sa === SP.AREA && sb === SP.AREA) { kind = 'area+area'; area(2, 'area'); }
  else if (sa === SP.AREA || sb === SP.AREA) { kind = 'area+stripe'; for (let d = -1; d <= 1; d++) line(y + d, x + d); }
  else { kind = 'stripe+stripe'; line(y, x); }
  expand(b, clear, hits, effects);
  return { clear: [...clear], hits: [...hits], effects, creates: [], groups: [], combo: kind };
}

/** Apply a clear: remove gems, peel jelly, damage blockers, place created specials. Returns progress counts. */
export function applyClear(b, res, cascade) {
  let jelly = 0, broken = 0, cleared = 0, items = 0;
  for (const i of res.clear) {
    if (!b.gems[i]) continue;
    if (col(b.gems[i]) === ITEM) continue; // items are only collected at the bottom
    b.gems[i] = 0; cleared++;
    if (b.jelly[i] > 0) { b.jelly[i]--; jelly++; }
  }
  for (const i of res.hits) if (b.block[i] > 0) { b.block[i]--; if (!b.block[i]) broken++; }
  for (const [i, g] of res.creates) b.gems[i] = g;
  const bonus = res.creates.reduce((t, [, g]) => t + [0, 60, 60, 100, 200][spOf(g)], 0);
  const score = (cleared * 20 + jelly * 100 + broken * 80 + bonus) * cascade + (res.combo ? 300 : 0);
  return { jelly, broken, cleared, items, score };
}

/** Compact each column segment downward and refill from its top. fall (optional) records rows to fall. */
export function gravity(b, r, colors, spawnItem, fall) {
  const [W, H] = dims(b);
  for (let x = 0; x < W; x++) {
    let y = H - 1;
    while (y >= 0) {
      if (!playable(b, y * W + x)) { y--; continue; }
      let top = y; while (top - 1 >= 0 && playable(b, (top - 1) * W + x)) top--;
      // segment rows top..y
      let write = y;
      for (let k = y; k >= top; k--) {
        const i = k * W + x;
        if (b.gems[i]) {
          if (write !== k) { const j = write * W + x; b.gems[j] = b.gems[i]; b.gems[i] = 0; if (fall) fall[j] = (fall[i] || 0) + (write - k); if (fall) fall[i] = 0; }
          write--;
        }
      }
      const empties = write - top + 1;
      for (let k = write; k >= top; k--) {
        const i = k * W + x;
        b.gems[i] = top === 0 && spawnItem && spawnItem() ? ITEM : 1 + Math.floor(random(r) * colors);
        if (fall) fall[i] = empties;
      }
      y = top - 1;
    }
  }
}

/** Items that reached the bottom of their column are collected. */
export function collectItems(b) {
  const got = [], [W, H] = dims(b);
  for (let x = 0; x < W; x++) for (let y = H - 1; y >= 0; y--) {
    const i = y * W + x;
    if (b.hole[i]) continue;
    if (b.block[i]) break;
    if (col(b.gems[i]) === ITEM) { b.gems[i] = 0; got.push(i); }
    break;
  }
  return got;
}

function matchAt(b, i) {
  const c = col(b.gems[i]); if (!isColor(c) || !playable(b, i)) return false;
  const [W, H] = dims(b), [x, y] = xy(b, i), same = (xx, yy) => xx >= 0 && yy >= 0 && xx < W && yy < H && playable(b, yy * W + xx) && col(b.gems[yy * W + xx]) === c;
  let h = 1; for (let k = x - 1; same(k, y); k--) h++; for (let k = x + 1; same(k, y); k++) h++;
  if (h >= 3) return true;
  let v = 1; for (let k = y - 1; same(x, k); k--) v++; for (let k = y + 1; same(x, k); k++) v++;
  return v >= 3;
}
export function swapValid(b, i, j) {
  if (!playable(b, i) || !playable(b, j) || !b.gems[i] || !b.gems[j]) return false;
  const gi = b.gems[i], gj = b.gems[j];
  if ((spOf(gi) === SP.BOMB && col(gj) !== ITEM) || (spOf(gj) === SP.BOMB && col(gi) !== ITEM)) return true;
  if (spOf(gi) && spOf(gj)) return true;
  b.gems[i] = gj; b.gems[j] = gi;
  const ok = matchAt(b, i) || matchAt(b, j);
  b.gems[i] = gi; b.gems[j] = gj;
  return ok;
}
export function allMoves(b) {
  const out = [], [W, , N] = dims(b);
  for (let i = 0; i < N; i++) {
    const x = i % W;
    if (x < W - 1 && swapValid(b, i, i + 1)) out.push([i, i + 1]);
    if (i + W < N && swapValid(b, i, i + W)) out.push([i, i + W]);
  }
  return out;
}
export const hasMove = b => { const [W, , N] = dims(b); for (let i = 0; i < N; i++) { if (i % W < W - 1 && swapValid(b, i, i + 1)) return true; if (i + W < N && swapValid(b, i, i + W)) return true; } return false; };

function fillNoMatch(b, r, colors) {
  const [W, , N] = dims(b);
  for (let i = 0; i < N; i++) {
    if (!playable(b, i)) { b.gems[i] = 0; continue; }
    if (b.gems[i] && (col(b.gems[i]) === ITEM || spOf(b.gems[i]))) continue;
    const [x, y] = xy(b, i), banned = new Set();
    if (x >= 2 && col(b.gems[i - 1]) === col(b.gems[i - 2]) && playable(b, i - 1) && playable(b, i - 2)) banned.add(col(b.gems[i - 1]));
    if (y >= 2 && col(b.gems[i - W]) === col(b.gems[i - 2 * W]) && playable(b, i - W) && playable(b, i - 2 * W)) banned.add(col(b.gems[i - W]));
    let c; do { c = 1 + Math.floor(random(r) * colors); } while (banned.has(c) && banned.size < colors);
    b.gems[i] = c;
  }
}
/** Rearrange the gems until there are no matches and at least one move. */
export function reshuffle(b, r, colors) {
  const N = b.W * b.H;
  const cells = []; for (let i = 0; i < N; i++) if (playable(b, i) && b.gems[i] && col(b.gems[i]) !== ITEM) cells.push(i);
  for (let t = 0; t < 40; t++) {
    const vals = cells.map(i => b.gems[i]);
    for (let k = vals.length - 1; k > 0; k--) { const j = Math.floor(random(r) * (k + 1)); [vals[k], vals[j]] = [vals[j], vals[k]]; }
    cells.forEach((i, k) => { b.gems[i] = vals[k]; });
    if (!findRuns(b).length && hasMove(b)) return true;
  }
  for (let t = 0; t < 40; t++) { cells.forEach(i => { if (!spOf(b.gems[i])) b.gems[i] = 0; }); fillNoMatch(b, r, colors); if (hasMove(b)) return true; }
  return false;
}

export function createSwap(content, { seed = 1, startAt = 0, fast = false } = {}) {
  const colors = content.rules.colors, W = content.rules.width, H = content.rules.height, N = W * H;
  const T = k => fast ? 1 : k;

  function itemPolicy(s) {
    const L = levelAt(content, s.level);
    if (L.goal !== 'collect') return null;
    return () => {
      const on = s.gems.filter(g => col(g) === ITEM).length;
      if (s.collected + on >= L.target || on >= 2) return false;
      return random(s) < (on ? 0.1 : 0.5);
    };
  }
  function startLevel(s, i) {
    const L = levelAt(content, i);
    Object.assign(s, { level: i, levelT: 0, levelScore: 0, moves: L.moves, cascade: 0, collected: 0, sel: -1, hint: null, idleT: 0, pending: null, stars: 0 });
    s.gems = new Array(N).fill(0); s.jelly = new Array(N).fill(0); s.block = new Array(N).fill(0); s.hole = new Array(N).fill(0); s.fall = new Array(N).fill(0);
    L.layout.forEach((row, y) => [...row].forEach((ch, x) => {
      const k = y * W + x;
      if (ch === 'x') s.hole[k] = 1; else if (ch === 'j') s.jelly[k] = 1; else if (ch === 'J') s.jelly[k] = 2; else if (ch === 'b') s.block[k] = 1; else if (ch === 'B') s.block[k] = 2;
    }));
    fillNoMatch(s, s, colors);
    if (L.goal === 'collect') { const tops = []; for (let x = 0; x < W; x++) if (playable(s, x)) tops.push(x); if (tops.length) s.gems[tops[rint(s, tops.length)]] = ITEM; }
    if (!hasMove(s)) reshuffle(s, s, colors);
    s.totals = left(s);
    for (let k = 0; k < N; k++) if (s.gems[k]) s.fall[k] = fast ? 0 : 8 + (H - Math.floor(k / W)) * 0.6;
    s.cursor = { x: Math.floor(W / 2) - 1, y: Math.floor(H / 2) };
    s.phase = 'intro'; s.phaseT = T(INTRO_FRAMES);
  }
  function createState() {
    const s = Object.assign(baseState('swap', seed), { W, H, shiftX: { dir: 0, t: 0 }, shiftY: { dir: 0, t: 0 }, fallV: 0, stats: { moves: 0, specials: 0, combos: 0, bestCascade: 0, shuffles: 0 } });
    startLevel(s, startAt);
    return s;
  }
  const left = s => ({ jelly: s.jelly.reduce((t, v) => t + v, 0), blockers: s.block.filter(Boolean).length });
  function goalMet(s) {
    const L = levelAt(content, s.level);
    if (L.goal === 'score') return s.levelScore >= L.target;
    if (L.goal === 'jelly') return left(s).jelly === 0;
    if (L.goal === 'blockers') return left(s).blockers === 0;
    if (L.goal === 'collect') return s.collected >= L.target;
    return false;
  }
  function beginClear(s, res) {
    s.pending = res; s.phase = 'clear'; s.phaseT = T(CLEAR_FRAMES);
    s.stats.bestCascade = Math.max(s.stats.bestCascade, s.cascade);
    const specials = res.creates.length;
    s.stats.specials += specials;
    emit(s, 'match', { cascade: s.cascade, cells: res.clear.map(i => [i % W, Math.floor(i / W), s.gems[i]]), effects: res.effects, creates: res.creates, combo: res.combo || null, groups: res.groups });
    emit(s, 'collect', { cascade: s.cascade });
    if (res.combo) { s.stats.combos++; emit(s, 'power', { combo: res.combo }); }
    else if (specials) emit(s, 'special', { kinds: res.creates.map(([, g]) => spOf(g)) });
  }
  function startFall(s) {
    s.fall.fill(0);
    gravity(s, s, colors, itemPolicy(s), s.fall);
    if (fast) s.fall.fill(0);
    s.phase = 'fall'; s.fallV = 0.18;
  }
  function settled(s) {
    const got = collectItems(s);
    if (got.length) {
      s.collected += got.length; const pts = 1000 * got.length; s.score += pts; s.levelScore += pts;
      emit(s, 'item', { cells: got.map(i => [i % W, Math.floor(i / W)]), points: pts }); emit(s, 'power');
      startFall(s); return;
    }
    if (findRuns(s).length) { s.cascade++; beginClear(s, computeClear(s)); return; }
    s.cascade = 0;
    if (goalMet(s)) { s.phase = 'bonus'; s.phaseT = T(DONE_FRAMES / 2); emit(s, 'goal'); return; }
    const L = levelAt(content, s.level);
    if (L.moves && s.moves <= 0) { lose(s, 'Out of moves'); return; }
    if (!hasMove(s)) { s.phase = 'shuffle'; s.phaseT = T(SHUFFLE_FRAMES); emit(s, 'shuffle'); return; }
    s.phase = 'idle'; s.idleT = 0; s.hint = null;
  }
  function levelDone(s) {
    const L = levelAt(content, s.level);
    s.stars = Math.max(1, starsFor(L, s.levelScore));
    emit(s, 'stars', { stars: s.stars });
    if (isLastLevel(content, s.level)) { win(s); return; }
    startLevel(s, s.level + 1);
    const nx = levelAt(content, s.level);
    emit(s, 'level_up', { level: s.level, title: nx.name, intro: nx.intro });
  }
  function trySwap(s, a, b) {
    if (b < 0 || b >= N || !playable(s, a) || !playable(s, b) || !s.gems[a] || !s.gems[b]) { emit(s, 'bump'); return; }
    s.swapA = a; s.swapB = b; s.valid = swapValid(s, a, b);
    s.phase = 'swap'; s.phaseT = T(SWAP_FRAMES); s.sel = -1; s.hint = null;
    s.cursor = { x: b % W, y: Math.floor(b / W) };
    emit(s, 'swap', { a, b, valid: s.valid });
  }
  function idle(s, e) {
    const L = levelAt(content, s.level);
    if (L.timeSec && s.levelT >= L.timeSec * 60) { if (goalMet(s)) { s.phase = 'bonus'; s.phaseT = T(30); } else lose(s, 'Time up'); return; }
    s.idleT++;
    if (s.idleT === HINT_FRAMES) { const m = allMoves(s)[0]; s.hint = m || null; }
    const dx = autoShift(s.shiftX, e.x), dy = autoShift(s.shiftY, e.y);
    const c = s.cursor;
    if (s.sel >= 0 && (dx || dy)) {
      const [sx, sy] = xy(s, s.sel), tx = sx + (dx || 0), ty = sy + (dx ? 0 : dy);
      if (tx >= 0 && ty >= 0 && tx < W && ty < H) trySwap(s, s.sel, ty * W + tx); else emit(s, 'bump');
      return;
    }
    if (dx || dy) {
      const nx = Math.max(0, Math.min(W - 1, c.x + dx)), ny = Math.max(0, Math.min(H - 1, c.y + dy));
      if (nx !== c.x || ny !== c.y) { s.cursor = { x: nx, y: ny }; emit(s, 'cursor'); s.idleT = Math.min(s.idleT, HINT_FRAMES - 1); }
    }
    const here = s.cursor.y * W + s.cursor.x;
    if (e.aP) {
      if (s.sel === here) { s.sel = -1; emit(s, 'deselect'); }
      else if (s.sel >= 0 && Math.abs((s.sel % W) - s.cursor.x) + Math.abs(Math.floor(s.sel / W) - s.cursor.y) === 1) trySwap(s, s.sel, here);
      else if (playable(s, here) && s.gems[here]) { s.sel = here; emit(s, 'select', { i: here }); }
      else emit(s, 'bump');
    } else if (e.bP && s.sel >= 0) { s.sel = -1; emit(s, 'deselect'); }
  }

  function step(s, input) {
    s.events = [];
    if (s.status !== 'playing') return s;
    const e = edges(s, input);
    s.frame++; s.time += DT;
    if (s.phase === 'intro') {
      s.fallV = Math.min(0.8, s.fallV + 0.02);
      for (let i = 0; i < N; i++) if (s.fall[i] > 0) s.fall[i] = Math.max(0, s.fall[i] - s.fallV);
      if (--s.phaseT <= 0) { s.fall.fill(0); s.phase = 'idle'; s.idleT = 0; emit(s, 'go'); }
      return s;
    }
    s.levelT++;
    switch (s.phase) {
      case 'idle': idle(s, e); break;
      case 'swap':
        if (--s.phaseT > 0) break;
        if (!s.valid) { s.phase = 'back'; s.phaseT = T(SWAP_FRAMES); emit(s, 'invalid'); break; }
        { const a = s.swapA, b = s.swapB; [s.gems[a], s.gems[b]] = [s.gems[b], s.gems[a]];
          if (levelAt(content, s.level).moves) s.moves--;
          s.stats.moves++; s.cascade = 1;
          beginClear(s, comboClear(s, a, b, s) || computeClear(s, [b, a])); }
        break;
      case 'back': if (--s.phaseT <= 0) { s.phase = 'idle'; s.idleT = 0; } break;
      case 'clear':
        if (--s.phaseT > 0) break;
        { const r = applyClear(s, s.pending, s.cascade); s.score += r.score; s.levelScore += r.score; s.pending = null;
          if (r.jelly) emit(s, 'jelly', { count: r.jelly }); if (r.broken) emit(s, 'broken', { count: r.broken });
          startFall(s); }
        break;
      case 'fall': {
        s.fallV = Math.min(0.9, s.fallV + 0.06);
        let any = false;
        for (let i = 0; i < N; i++) if (s.fall[i] > 0) { s.fall[i] = Math.max(0, s.fall[i] - s.fallV); any = true; }
        if (!any) { emit(s, 'land'); settled(s); }
        break;
      }
      case 'shuffle': if (--s.phaseT <= 0) { reshuffle(s, s, colors); s.stats.shuffles++; s.phase = 'idle'; s.idleT = 0; } break;
      case 'bonus':
        if (--s.phaseT > 0) break;
        if (s.moves > 0) { s.moves--; const pts = 250 * (s.level + 1); s.score += pts; s.levelScore += pts; s.phaseT = T(BONUS_FRAMES); emit(s, 'bonus', { points: pts, i: rint(s, N) }); }
        else { s.phase = 'done'; s.phaseT = T(DONE_FRAMES); }
        break;
      case 'done': if (--s.phaseT <= 0) levelDone(s); break;
    }
    return s;
  }

  return { mode: 'swap', content, W, H, createState, step, goalMet, left };
}

// ---------- greedy bot ----------
function cloneBoard(s) { return { W: s.W, H: s.H, gems: s.gems.slice(), jelly: s.jelly.slice(), block: s.block.slice(), hole: s.hole }; }
/** Resolve a swap to completion on a copy (refills from a scratch generator, so the bot cannot peek). */
export function simulateSwap(s, a, b, colors, scratch) {
  const B = cloneBoard(s);
  [B.gems[a], B.gems[b]] = [B.gems[b], B.gems[a]];
  let res = comboClear(B, a, b, scratch) || computeClear(B, [b, a]);
  let cascade = 1, score = 0, jelly = 0, broken = 0, items = 0, specials = 0;
  for (let guard = 0; guard < 30 && res.clear.length; guard++) {
    specials += res.creates.length;
    const r = applyClear(B, res, cascade); score += r.score; jelly += r.jelly; broken += r.broken;
    gravity(B, scratch, colors, null);
    items += collectItems(B).length;
    cascade++;
    res = computeClear(B);
  }
  // Item progress: how far down the items now sit.
  let depth = 0; for (let i = 0; i < B.gems.length; i++) if (col(B.gems[i]) === ITEM) depth += Math.floor(i / B.W);
  return { score, jelly, broken, items, depth, specials, cascade: cascade - 1 };
}
export function bestSwap(game, s) {
  const moves = allMoves(s);
  if (!moves.length) return null;
  const goal = levelAt(game.content, s.level).goal, scratch = { rng: (s.rng ^ 0x9e3779b9) >>> 0 || 1 };
  let best = null;
  for (const [i, j] of moves) for (const [a, b] of [[i, j], [j, i]]) {
    const r = simulateSwap(s, a, b, game.content.rules.colors, scratch);
    const v = r.score + r.specials * 150 + (goal === 'jelly' ? r.jelly * 400 : 0) + (goal === 'blockers' ? r.broken * 500 : 0) + (goal === 'collect' ? r.items * 5000 + r.depth * 150 : 0);
    if (!best || v > best.v) best = { a, b, v };
  }
  return best;
}
export function swapBot(game) {
  const W = game.W;
  let plan = null, planAt = -1, tick = 0;
  const idle = { x: 0, y: 0, a: false, b: false };
  return s => {
    if (s.phase !== 'idle') { plan = null; return idle; }
    if (!plan || planAt !== s.stats.moves) { plan = bestSwap(game, s); planAt = s.stats.moves; }
    if (++tick % 2 || !plan) return idle;
    const ax = plan.a % W, ay = Math.floor(plan.a / W);
    if (s.sel !== plan.a) {
      if (s.sel >= 0) return { ...idle, b: true };
      if (s.cursor.x !== ax) return { ...idle, x: Math.sign(ax - s.cursor.x) };
      if (s.cursor.y !== ay) return { ...idle, y: Math.sign(ay - s.cursor.y) };
      return { ...idle, a: true };
    }
    const bx = plan.b % W, by = Math.floor(plan.b / W);
    return bx !== ax ? { ...idle, x: Math.sign(bx - ax) } : { ...idle, y: Math.sign(by - ay) };
  };
}
