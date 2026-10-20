// Chain mode: falling pairs that pop in same-color groups with gravity cascades,
// a chain counter and the classic chain-power scoring (Puyo-like); or the
// virus variant: capsules whose halves clear in lines and must wipe out fixed
// viruses (Dr. Mario-like). Cells are ints: color 1-5 | GARB 7, VIRUS bit 8, link<<4.
import { edges, autoShift, emit, baseState, rint, lose, win, levelAt, isLastLevel, DT } from './common.js';
import { maxViruses } from './content.js';

export const GARB = 7, VIRUS = 8;
export const LINK = { L: 1, R: 2, U: 3, D: 4 };
const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0]; // child offset by r: up, right, down, left
const LINK_OF_DIR = [LINK.U, LINK.R, LINK.D, LINK.L];
const OPP = { 1: 2, 2: 1, 3: 4, 4: 3 };
const LINK_DELTA = W => ({ 1: -1, 2: 1, 3: -W, 4: W });
export const color = c => c & 7;
export const isVirus = c => !!(c & VIRUS);
export const linkOf = c => (c >> 4) & 7;
export const POP_FRAMES = 26, LOCK_FRAMES = 18, MOVE_RESETS = 8, INTRO_FRAMES = 100;
const CHAIN_POWER = [0, 0, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 480, 512];
const COLOR_BONUS = [0, 0, 3, 6, 12, 24];
const groupBonus = n => n < 5 ? 0 : n >= 11 ? 10 : n - 3;

export function chainDims(content) { return { W: content.rules.width, H: content.rules.height + 1 }; } // row 0 hidden
export const framesPerRow = speed => Math.max(2, Math.round(36 * Math.pow(0.86, speed - 1)));

/** Gravity until stable. Bonded halves fall together; viruses never fall. off (optional) accumulates fall distances. */
export function settle(board, W, H, off) {
  let moved = false, changed = true;
  const mv = (i, j) => { board[j] = board[i]; board[i] = 0; if (off) { off[j] = off[i] + 1; off[i] = 0; } };
  while (changed) {
    changed = false;
    for (let y = H - 2; y >= 0; y--) for (let x = 0; x < W; x++) {
      const i = y * W + x, c = board[i];
      if (!c || c & VIRUS) continue;
      const lk = linkOf(c);
      if (lk === LINK.L || lk === LINK.D) continue; // the partner moves the unit
      if (lk === LINK.R) {
        if (x + 1 < W && !board[i + W] && !board[i + 1 + W]) { mv(i, i + W); mv(i + 1, i + 1 + W); changed = moved = true; }
      } else if (lk === LINK.U) {
        if (!board[i + W] && y > 0) { mv(i, i + W); mv(i - W, i); changed = moved = true; }
      } else if (!board[i + W]) { mv(i, i + W); changed = moved = true; }
    }
  }
  return moved;
}

/** Cells that pop now. Classic: 4-connected groups of ≥ groupSize plus touching garbage. Virus: lines of ≥ groupSize. */
export function findPops(board, W, H, groupSize, virusMode) {
  const pop = new Set(), groups = [];
  if (virusMode) {
    const run = (cells) => {
      let start = 0;
      for (let k = 1; k <= cells.length; k++) {
        const a = color(board[cells[start]]);
        if (k < cells.length && a && a !== GARB && color(board[cells[k]]) === a) continue;
        if (a && a !== GARB && k - start >= groupSize) { const g = cells.slice(start, k); g.forEach(i => pop.add(i)); groups.push({ color: a, size: g.length }); }
        start = k;
      }
    };
    for (let y = 1; y < H; y++) run(Array.from({ length: W }, (_, x) => y * W + x));
    for (let x = 0; x < W; x++) run(Array.from({ length: H - 1 }, (_, y) => (y + 1) * W + x));
    return { cells: [...pop], groups };
  }
  const seen = new Uint8Array(W * H);
  for (let i = W; i < W * H; i++) {
    const c = color(board[i]);
    if (!c || c === GARB || seen[i]) continue;
    const g = [i]; seen[i] = 1;
    for (let k = 0; k < g.length; k++) {
      const j = g[k], x = j % W;
      for (const n of [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, j - W >= W ? j - W : -1, j + W < W * H ? j + W : -1]) {
        if (n >= 0 && !seen[n] && color(board[n]) === c) { seen[n] = 1; g.push(n); }
      }
    }
    if (g.length >= groupSize) { g.forEach(j => pop.add(j)); groups.push({ color: c, size: g.length }); }
  }
  for (const j of [...pop]) {
    const x = j % W;
    for (const n of [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, j - W >= W ? j - W : -1, j + W < W * H ? j + W : -1]) if (n >= 0 && color(board[n]) === GARB) pop.add(n);
  }
  return { cells: [...pop], groups };
}

/** Whether cell i is part of something that pops (a cheap local version of findPops). */
export function popsAt(board, W, H, groupSize, virusMode, i) {
  const c = color(board[i]);
  if (!c || c === GARB || i < W) return false;
  const x = i % W;
  if (virusMode) {
    let h = 1; for (let k = x - 1; k >= 0 && color(board[i - x + k]) === c; k--) h++; for (let k = x + 1; k < W && color(board[i - x + k]) === c; k++) h++;
    if (h >= groupSize) return true;
    let v = 1; for (let k = i - W; k >= W && color(board[k]) === c; k -= W) v++; for (let k = i + W; k < W * H && color(board[k]) === c; k += W) v++;
    return v >= groupSize;
  }
  const seen = new Set([i]), g = [i];
  for (let k = 0; k < g.length && g.length < groupSize; k++) {
    const j = g[k], jx = j % W;
    for (const n of [jx > 0 ? j - 1 : -1, jx < W - 1 ? j + 1 : -1, j - W >= W ? j - W : -1, j + W < W * H ? j + W : -1]) if (n >= 0 && !seen.has(n) && color(board[n]) === c) { seen.add(n); g.push(n); }
  }
  return g.length >= groupSize;
}

export function removeCells(board, W, cells) {
  const d = LINK_DELTA(W);
  let viruses = 0, garbage = 0;
  for (const i of cells) {
    const c = board[i]; if (!c) continue;
    if (c & VIRUS) viruses++;
    if (color(c) === GARB) garbage++;
    const lk = linkOf(c);
    if (lk) { const j = i + d[lk]; if (board[j] && !cells.includes(j)) board[j] &= ~(7 << 4); }
    board[i] = 0;
  }
  return { viruses, garbage };
}

export function popScore(groups, chain) {
  const n = groups.reduce((t, g) => t + g.size, 0);
  const colors = new Set(groups.map(g => g.color)).size;
  const bonus = Math.max(1, Math.min(999, (CHAIN_POWER[Math.min(chain, CHAIN_POWER.length - 1)] || 0) + COLOR_BONUS[colors] + groups.reduce((t, g) => t + groupBonus(g.size), 0)));
  return 10 * n * bonus;
}

export function createChain(content, { seed = 1, fixedSpeed = 0, startAt = 0, fast = false } = {}) {
  const R = content.rules, virusMode = R.variant === 'virus';
  const { W, H } = chainDims(content);
  const spawnAt = { x: Math.floor(W / 2) - 1, y: 1, r: virusMode ? 1 : 0 };
  const popFrames = fast ? 1 : POP_FRAMES;

  const inside = (x, y) => x >= 0 && x < W && y >= 0 && y < H;
  const free = (board, x, y) => inside(x, y) && !board[y * W + x];
  const fits = (board, x, y, r) => free(board, x, y) && free(board, x + DX[r], y + DY[r]);
  const newPair = s => ({ a: rint(s, R.colors) + 1, b: rint(s, R.colors) + 1 });
  const refill = s => { while (s.queue.length < 3) s.queue.push(newPair(s)); };

  function startLevel(s, i) {
    const L = levelAt(content, i);
    Object.assign(s, { level: i, levelT: 0, levelScore: 0, maxChain: 0, board: new Array(W * H).fill(0), off: new Array(W * H).fill(0), pair: null, chain: 0, popping: [], virusesLeft: 0, garbageLeft: 0, dropViruses: 0 });
    s.speed = L.speed;
    if (virusMode) placeViruses(s, L.obstacles);
    else {
      const rows = [...L.layout.map(row => [...row].map(ch => ch === 'g' ? GARB : ch === '.' ? 0 : +ch)), ...Array.from({ length: L.obstacles }, () => new Array(W).fill(GARB))];
      rows.forEach((row, k) => { const y = H - rows.length + k; row.forEach((v, x) => { s.board[y * W + x] = v; }); });
      settle(s.board, W, H);
    }
    s.virusesLeft = s.board.filter(isVirus).length;
    s.garbageLeft = s.board.filter(c => color(c) === GARB).length;
    s.garbageTotal = s.garbageLeft;
    s.phase = 'intro'; s.phaseT = fast ? 1 : INTRO_FRAMES;
  }
  function placeViruses(s, count) {
    const top = H - Math.max(4, Math.round((H - 1) * (count > maxViruses({ W, H: H - 1 }) * 0.8 ? 0.72 : 0.62)));
    const run = (x, y, c, dx, dy) => { let n = 0; for (let k = 1; k < 3; k++) { const xx = x + dx * k, yy = y + dy * k; if (inside(xx, yy) && color(s.board[yy * W + xx]) === c) n++; else break; } return n; };
    for (let v = 0; v < count; v++) {
      const c = (v % R.colors) + 1;
      for (let tries = 0; tries < 200; tries++) {
        const x = rint(s, W), y = top + rint(s, H - top), i = y * W + x;
        if (s.board[i]) continue;
        if (run(x, y, c, 1, 0) + run(x, y, c, -1, 0) >= 2 || run(x, y, c, 0, 1) + run(x, y, c, 0, -1) >= 2) continue;
        s.board[i] = c | VIRUS; break;
      }
    }
  }
  function createState() {
    const s = Object.assign(baseState('chain', seed), { variant: R.variant, W, H, queue: [], pair: null, pairId: 0, grav: 0, lockT: 0, lockMoves: 0, shift: { dir: 0, t: 0 }, fallV: 0, stats: { pairs: 0, pops: 0, bestChain: 0, viruses: 0 } });
    refill(s);
    startLevel(s, startAt);
    return s;
  }
  function spawn(s) {
    const sp = spawnAt;
    if (s.board[sp.y * W + sp.x] || s.board[(sp.y + DY[sp.r]) * W + sp.x + DX[sp.r]]) { lose(s, virusMode ? 'The jar is full' : 'Stacked to the top'); return; }
    const q = s.queue.shift(); refill(s);
    s.pair = { ...q, x: sp.x, y: sp.y, r: sp.r, id: s.pairId++ };
    s.grav = 0; s.lockT = 0; s.lockMoves = 0; s.phase = 'play';
    emit(s, 'piece');
  }
  function moved(s) { if (s.lockT > 0 && s.lockMoves < MOVE_RESETS) { s.lockT = 0; s.lockMoves++; } }
  function rotate(s, dir) {
    const p = s.pair, to = (p.r + dir + 4) % 4;
    const tries = [[0, 0], [-DX[to], -DY[to]]];
    for (const [kx, ky] of tries) if (fits(s.board, p.x + kx, p.y + ky, to)) { p.x += kx; p.y += ky; p.r = to; moved(s); emit(s, 'rotate', { dir }); return true; }
    const flip = (p.r + 2) % 4; // boxed in on both sides: quick turn
    if (DX[to] && fits(s.board, p.x, p.y, flip)) { p.r = flip; moved(s); emit(s, 'rotate', { dir }); return true; }
    if (DX[to] && fits(s.board, p.x, p.y - DY[flip], flip)) { p.y -= DY[flip]; p.r = flip; moved(s); emit(s, 'rotate', { dir }); return true; }
    return false;
  }
  function place(s) {
    const p = s.pair, i = p.y * W + p.x, j = (p.y + DY[p.r]) * W + p.x + DX[p.r];
    if (virusMode) { s.board[i] = p.a | (LINK_OF_DIR[p.r] << 4); s.board[j] = p.b | (OPP[LINK_OF_DIR[p.r]] << 4); }
    else { s.board[i] = p.a; s.board[j] = p.b; }
    s.stats.pairs++;
    emit(s, 'land', { cells: [i, j] });
    s.pair = null; s.chain = 0; s.dropViruses = 0;
    beginSettle(s);
  }
  function beginSettle(s) {
    s.off.fill(0);
    const movedAny = settle(s.board, W, H, s.off);
    if (fast) s.off.fill(0);
    s.phase = 'settle'; s.fallV = 0.12;
    if (!movedAny) checkPops(s);
  }
  function checkPops(s) {
    const { cells, groups } = findPops(s.board, W, H, R.groupSize, virusMode);
    if (!cells.length) { endChain(s); return; }
    s.chain++;
    s.maxChain = Math.max(s.maxChain, s.chain); s.stats.bestChain = Math.max(s.stats.bestChain, s.chain);
    const viruses = cells.filter(i => isVirus(s.board[i])).length;
    let pts;
    if (virusMode) {
      pts = 0;
      for (let k = 0; k < viruses; k++) pts += 100 * 2 ** Math.min(5, s.dropViruses++);
      pts = (pts + 10 * (cells.length - viruses)) * s.chain * (1 + Math.floor((s.level) / 3));
    } else pts = popScore(groups, s.chain);
    s.score += pts; s.levelScore += pts; s.stats.pops++;
    s.popping = cells; s.phase = 'pop'; s.phaseT = popFrames;
    emit(s, 'pop', { cells: cells.map(i => [i % W, Math.floor(i / W), s.board[i]]), chain: s.chain, points: pts, viruses, groups });
    emit(s, 'collect', { chain: s.chain });
    if (s.chain >= 2) emit(s, 'chain', { chain: s.chain });
    if (viruses) emit(s, 'defeated', { count: viruses });
  }
  function finishPop(s) {
    const r = removeCells(s.board, W, s.popping);
    s.virusesLeft -= r.viruses; s.garbageLeft -= r.garbage; s.stats.viruses += r.viruses;
    s.popping = [];
    beginSettle(s);
  }
  function goalMet(s) {
    const L = levelAt(content, s.level);
    if (L.goal === 'score') return s.levelScore >= L.target;
    if (L.goal === 'chain') return s.maxChain >= L.target;
    if (L.goal === 'viruses') return s.virusesLeft <= 0;
    if (L.goal === 'blockers') return s.garbageLeft <= 0;
    if (L.goal === 'survive') return s.levelT >= L.timeSec * 60;
    return false;
  }
  function endChain(s) {
    if (goalMet(s)) { levelDone(s); return; }
    spawn(s);
  }
  function levelDone(s) {
    if (isLastLevel(content, s.level)) { win(s); return; }
    startLevel(s, s.level + 1);
    const N = levelAt(content, s.level);
    emit(s, 'level_up', { level: s.level, title: N.name, intro: N.intro });
  }

  function step(s, input) {
    s.events = [];
    if (s.status !== 'playing') return s;
    const e = edges(s, input);
    s.frame++; s.time += DT;
    if (s.phase === 'intro') { if (--s.phaseT <= 0) { spawn(s); emit(s, 'go'); } return s; }
    s.levelT++;
    const L = levelAt(content, s.level);
    if (L.timeSec && L.goal !== 'survive' && s.levelT >= L.timeSec * 60) { lose(s, 'Time up'); return s; }
    if (s.phase === 'settle') {
      s.fallV = Math.min(0.9, s.fallV + 0.05);
      let any = false;
      for (let i = 0; i < s.off.length; i++) if (s.off[i] > 0) { s.off[i] = Math.max(0, s.off[i] - s.fallV); any = true; }
      if (!any) { if (s.fallV > 0.12) emit(s, 'settled'); checkPops(s); }
      return s;
    }
    if (s.phase === 'pop') { if (--s.phaseT <= 0) finishPop(s); return s; }
    if (s.phase !== 'play' || !s.pair) return s;
    if (L.goal === 'survive' && goalMet(s)) { levelDone(s); return s; }
    const p = s.pair;
    if (e.aP) rotate(s, 1); else if (e.bP) rotate(s, -1);
    const dx = autoShift(s.shift, e.x);
    if (dx) { if (fits(s.board, p.x + dx, p.y, p.r)) { p.x += dx; moved(s); emit(s, 'move', { dx }); } else emit(s, 'bump', { dx }); }
    if (e.up) {
      let d = 0; while (fits(s.board, p.x, p.y + 1, p.r)) { p.y++; d++; }
      s.score += d; s.levelScore += d;
      emit(s, 'hit', { dist: d });
      place(s); return s;
    }
    const soft = e.y > 0;
    s.grav += soft ? 0.5 : 1 / framesPerRow(fixedSpeed || s.speed);
    while (s.grav >= 1) {
      s.grav -= 1;
      if (fits(s.board, p.x, p.y + 1, p.r)) { p.y++; if (soft) { s.score += 1; s.levelScore += 1; } }
      else { s.grav = 0; break; }
    }
    if (!fits(s.board, p.x, p.y + 1, p.r)) { if (++s.lockT >= LOCK_FRAMES || s.lockMoves >= MOVE_RESETS) place(s); }
    return s;
  }

  return { mode: 'chain', content, W, H, virusMode, spawnAt, DX, DY, createState, step, fits };
}

// ---------- greedy bot ----------
/** Drop a pair spec onto a copy of the board and resolve every chain. */
export function simulatePlacement(game, board, { a, b, x, r }) {
  const { W, H, virusMode } = game, R = game.content.rules;
  const y0 = r === 0 ? 1 : 1;
  if (!game.fits(board, x, y0, r)) return null;
  const B = board.slice();
  let y = y0; while (game.fits(B, x, y + 1, r)) y++;
  let i = y * W + x, j = (y + DY[r]) * W + x + DX[r];
  if (virusMode) { B[i] = a | (LINK_OF_DIR[r] << 4); B[j] = b | (OPP[LINK_OF_DIR[r]] << 4); }
  else {
    B[i] = a; B[j] = b;
    if (DX[r]) { // a flat pair splits: each half falls down its own column
      while (i + W < W * H && !B[i + W]) { B[i + W] = B[i]; B[i] = 0; i += W; }
      while (j + W < W * H && !B[j + W]) { B[j + W] = B[j]; B[j] = 0; j += W; }
    }
  }
  if (!popsAt(B, W, H, R.groupSize, virusMode, i) && !popsAt(B, W, H, R.groupSize, virusMode, j)) return { board: B, chain: 0, score: 0, viruses: 0, garbage: 0 };
  let chain = 0, score = 0, viruses = 0, garbage = 0;
  for (;;) {
    const { cells, groups } = findPops(B, W, H, R.groupSize, virusMode);
    if (!cells.length) break;
    chain++;
    score += virusMode ? cells.length * 10 : popScore(groups, chain);
    const rm = removeCells(B, W, cells); viruses += rm.viruses; garbage += rm.garbage;
    settle(B, W, H);
  }
  return { board: B, chain, score, viruses, garbage };
}

function heights(B, W, H) {
  const h = new Array(W).fill(0);
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (B[y * W + x]) { h[x] = H - y; break; }
  return h;
}

export function evaluateChain(game, res, goal) {
  const { W, H, virusMode } = game, B = res.board, h = heights(B, W, H);
  let v = 0, adj = 0;
  for (let i = W; i < W * H; i++) {
    const c = color(B[i]); if (!c || c === GARB) continue;
    if (i % W < W - 1 && color(B[i + 1]) === c) adj++;
    if (i + W < W * H && color(B[i + W]) === c) adj++;
  }
  v += adj * (virusMode ? 6 : 14);
  if (virusMode) for (let i = W; i < W * (H - 1); i++) { // keep columns single-colored: mismatched stacking buries things
    const c = color(B[i]), d = color(B[i + W]);
    if (c && d && !isVirus(B[i])) v += c === d ? 8 : -10;
  }
  v -= h.reduce((t, k) => t + k * k, 0) * (virusMode ? 0.35 : 0.5);
  const sx = game.spawnAt.x, danger = virusMode ? Math.max(h[sx], h[sx + 1]) : h[sx];
  if (danger >= H - 4) v -= 4000;
  if (virusMode) {
    v += res.viruses * 900 + res.score;
    for (let i = W; i < W * H; i++) {
      if (!isVirus(B[i])) continue;
      const c = color(B[i]);
      let k = i - W, run = 0;
      while (k >= W && B[k] && color(B[k]) === c) { run++; k -= W; }
      v += run * 45;
      let cover = 0;
      while (k >= W && B[k]) { cover++; k -= W; }
      v -= cover * 30;
      const x = i % W; // same color beside it also lines up
      if (x > 0 && color(B[i - 1]) === c) v += 15;
      if (x < W - 1 && color(B[i + 1]) === c) v += 15;
    }
  } else {
    v += res.score * (goal === 'chain' && res.chain < 2 && danger < H - 6 ? 0.05 : 0.6) + (res.chain >= 2 ? 1500 * res.chain : 0) + res.garbage * 300;
  }
  return v;
}

/** Best (x, r) for the current pair, with a one-pair lookahead on the top candidates. */
export function bestPair(game, s) {
  const p = s.pair; if (!p) return null;
  const goal = levelAt(game.content, s.level).goal;
  const cands = [];
  for (let r = 0; r < 4; r++) for (let x = 0; x < game.W; x++) {
    const res = simulatePlacement(game, s.board, { a: p.a, b: p.b, x, r });
    if (res) cands.push({ x, r, res, v: evaluateChain(game, res, goal) });
  }
  if (!cands.length) return null;
  cands.sort((m, n) => n.v - m.v);
  const next = s.queue[0];
  if (next) for (const c of cands.slice(0, 5)) {
    let best = -Infinity;
    for (let r = 0; r < 4; r++) for (let x = 0; x < game.W; x++) {
      const res = simulatePlacement(game, c.res.board, { a: next.a, b: next.b, x, r });
      if (res) best = Math.max(best, evaluateChain(game, res, goal) + res.score * 0.3 + res.chain * 400);
    }
    c.v2 = c.v * 0.5 + (best === -Infinity ? -9999 : best);
  }
  const top = cands.slice(0, 5).reduce((m, c) => (c.v2 > m.v2 ? c : m));
  return { x: top.x, r: top.r };
}

export function chainBot(game) {
  let plan = null, planFor = -1, tick = 0, stuck = 0;
  const idle = { x: 0, y: 0, a: false, b: false };
  return s => {
    if (s.phase !== 'play' || !s.pair) return idle;
    if (planFor !== s.pair.id) { plan = bestPair(game, s); planFor = s.pair.id; stuck = 0; }
    if (++tick % 2) return idle;
    const p = s.pair;
    if (!plan) return { ...idle, y: -1 };
    stuck++;
    if (p.r !== plan.r && stuck < 10) return (plan.r - p.r + 4) % 4 === 3 ? { ...idle, b: true } : { ...idle, a: true };
    if (p.x !== plan.x && stuck < 30) return { ...idle, x: Math.sign(plan.x - p.x) };
    return { ...idle, y: -1 };
  };
}
