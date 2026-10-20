// Falling-block mode (Tetris guideline rules): a 10x20 well with 4 hidden rows,
// SRS rotation with wall kicks, 7-bag randomizer, hold, next queue, ghost,
// DAS/ARR, soft and hard drop, lock delay with move reset, T-spin detection,
// combos, back-to-back and guideline scoring. Custom polyomino sets are supported.
import { edges, autoShift, emit, baseState, shuffleInPlace, rint, lose, win, levelAt, isLastLevel, DT } from './common.js';
import { parseShape, STANDARD_KEYS } from './content.js';

export const HIDDEN = 4; // rows above the visible well where pieces spawn
export const GARBAGE = 100;
export const LOCK_DELAY = 30, MOVE_RESETS = 15, CLEAR_FRAMES = 22, SOFT_FACTOR = 20, INTRO_FRAMES = 100;

const STANDARD = {
  I: ['....', 'IIII', '....', '....'], O: ['OO', 'OO'], T: ['.T.', 'TTT', '...'], S: ['.SS', 'SS.', '...'],
  Z: ['ZZ.', '.ZZ', '...'], J: ['J..', 'JJJ', '...'], L: ['..L', 'LLL', '...'],
};
// SRS kicks, written y-up as in the guideline and flipped to y-down below. Key: `${from}${to}` with 0,1(R),2,3(L).
const yDown = t => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.map(([x, y]) => [x, -y])]));
const KICKS = {
  JLSTZ: yDown({
    '01': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]], '10': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '12': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]], '21': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '23': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]], '32': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '30': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]], '03': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  }),
  I: yDown({
    '01': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]], '10': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '12': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]], '21': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '23': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]], '32': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '30': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]], '03': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  }),
};
const GENERIC = [[0, 0], [-1, 0], [1, 0], [0, -1], [-1, -1], [1, -1], [-2, 0], [2, 0], [0, 1]];
const kicksFor = (type, from, to) => type.kicks === 'O' ? [[0, 0]] : KICKS[type.kicks]?.[`${from}${to}`] || GENERIC;

// Guideline gravity: seconds per row = (0.8 − (L−1)·0.007)^(L−1).
export const gravityRows = level => Math.min(40, 1 / (60 * Math.pow(0.8 - (level - 1) * 0.007, level - 1)));

function rotateCells(cells, n) { return cells.map(([x, y]) => [n - 1 - y, x]); }
function makeType(key, name, color, cells, n, kicks, W) {
  const states = [cells];
  for (let r = 1; r < 4; r++) states.push(rotateCells(states[r - 1], n));
  const minY = Math.min(...cells.map(c => c[1]));
  return { key, name, color, n, kicks, states, spawnX: Math.floor((W - n) / 2), spawnY: 2 - minY, size: cells.length };
}

/** The piece types in play for this content (standard 7, custom, or both). */
export function buildTypes(content) {
  const types = [], W = content.rules.width;
  if (content.rules.pieceSet !== 'custom') STANDARD_KEYS.forEach((k, i) => {
    const rows = STANDARD[k], cells = [];
    rows.forEach((row, y) => [...row].forEach((c, x) => { if (c !== '.') cells.push([x, y]); }));
    types.push(makeType(k, content.palette[i]?.name || k, content.palette[i]?.color || '#888', cells, rows.length, k === 'I' ? 'I' : k === 'O' ? 'O' : 'JLSTZ', W));
  });
  if (content.rules.pieceSet !== 'standard') content.customPieces.forEach((p, i) => {
    const cells = parseShape(p.rows), w = Math.max(...cells.map(c => c[0])) + 1, h = Math.max(...cells.map(c => c[1])) + 1;
    const n = Math.max(w, h), ox = Math.floor((n - w) / 2), oy = Math.floor((n - h) / 2);
    const square = w === h && cells.length === w * h;
    types.push(makeType(`C${i}`, p.name, p.color, cells.map(([x, y]) => [x + ox, y + oy]), n, square ? 'O' : n === 3 ? 'JLSTZ' : n === 4 ? 'I' : 'G', W));
  });
  return types;
}

// Options for verification: startAt plays one level in isolation, stay keeps playing that level after
// its goal is met (s.goalMet records it), fast skips the intro banner only (clears keep real timing).
export function createFalling(content, { seed = 1, startAt = 0, fast = false, stay = false } = {}) {
  const types = buildTypes(content);
  const R = content.rules, W = R.width, H = R.height + HIDDEN;
  const clearFrames = CLEAR_FRAMES;

  const cellsOf = (p, r = p.r, x = p.x, y = p.y) => types[p.t].states[r].map(([cx, cy]) => [x + cx, y + cy]);
  function fits(board, t, r, x, y) {
    for (const [cx, cy] of types[t].states[r]) {
      const bx = x + cx, by = y + cy;
      if (bx < 0 || bx >= W || by < 0 || by >= H || board[by * W + bx]) return false;
    }
    return true;
  }
  const fitsP = (s, p, r = p.r, x = p.x, y = p.y) => fits(s.board, p.t, r, x, y);
  function dropY(board, t, r, x, y) { while (fits(board, t, r, x, y + 1)) y++; return y; }
  const ghostY = s => s.piece ? dropY(s.board, s.piece.t, s.piece.r, s.piece.x, s.piece.y) : 0;

  function refill(s) {
    while (s.queue.length < 7) {
      if (!s.bag.length) s.bag = shuffleInPlace(s, types.map((_, i) => i));
      s.queue.push(s.bag.shift());
    }
  }
  function spawn(s, t) {
    if (t === undefined) { t = s.queue.shift(); refill(s); }
    const T = types[t], p = { t, r: 0, x: T.spawnX, y: T.spawnY, id: s.pieceId++ };
    s.piece = p; s.grav = 0; s.lockT = 0; s.lockMoves = 0; s.last = null; s.kick = 0;
    if (!fitsP(s, p)) { lose(s, 'Topped out'); return; }
    if (fitsP(s, p, p.r, p.x, p.y + 1)) p.y++;
    s.lowest = p.y;
    emit(s, 'piece', { t });
  }

  function pushRows(s, rows) {
    if (!rows.length) return;
    const n = rows.length;
    for (let i = 0; i < n * W; i++) if (s.board[i]) { lose(s, 'Pushed over the top'); return; }
    s.board = [...s.board.slice(n * W), ...rows.flat()];
    if (s.piece && !fitsP(s, s.piece)) { // nudge the falling piece up out of the new rows
      let y = s.piece.y; while (y > 0 && !fitsP(s, s.piece, s.piece.r, s.piece.x, y)) y--;
      s.piece.y = y; s.lowest = Math.min(s.lowest, y);
    }
    emit(s, 'garbage', { rows: n });
  }
  function startLevel(s, i) {
    const L = levelAt(content, i);
    s.level = i; s.levelT = 0; s.levelLines = 0; s.levelScore = 0;
    s.speed = L.speed;
    const rows = L.layout.map(row => [...row].map(c => c === '#' ? GARBAGE : 0));
    let hole = rint(s, W);
    for (let k = 0; k < L.obstacles; k++) {
      if (k && rint(s, 10) < 3) hole = (hole + 1 + rint(s, W - 1)) % W;
      rows.push(Array.from({ length: W }, (_, x) => x === hole ? 0 : GARBAGE));
    }
    pushRows(s, rows);
  }

  function createState() {
    const s = Object.assign(baseState('falling', seed), {
      board: new Array(W * H).fill(0), bag: [], queue: [], piece: null, pieceId: 0,
      hold: -1, holdUsed: false, grav: 0, lockT: 0, lockMoves: 0, lowest: 0, shift: { dir: 0, t: 0 }, last: null, kick: 0,
      lines: 0, levelLines: 0, speed: 1, combo: -1, b2b: false, clearRows: [], lastClear: null, goalMet: null,
      stats: { pieces: 0, singles: 0, doubles: 0, triples: 0, tetrises: 0, tspins: 0, maxCombo: 0, perfect: 0 },
    });
    refill(s);
    startLevel(s, startAt);
    s.phase = 'intro'; s.phaseT = fast ? 1 : INTRO_FRAMES;
    return s;
  }

  function moved(s) {
    if (s.lockT > 0 || !fitsP(s, s.piece, s.piece.r, s.piece.x, s.piece.y + 1)) {
      if (s.lockMoves < MOVE_RESETS) { s.lockT = 0; s.lockMoves++; }
    }
  }
  function shift(s, dx) {
    const p = s.piece;
    if (!fitsP(s, p, p.r, p.x + dx, p.y)) { emit(s, 'bump', { dx }); return false; }
    p.x += dx; s.last = 'move'; moved(s); emit(s, 'move', { dx });
    return true;
  }
  function rotate(s, dir) {
    const p = s.piece, T = types[p.t], to = (p.r + dir + 4) % 4;
    const kicks = kicksFor(T, p.r, to);
    for (let i = 0; i < kicks.length; i++) {
      const [kx, ky] = kicks[i];
      if (fitsP(s, p, to, p.x + kx, p.y + ky)) {
        p.r = to; p.x += kx; p.y += ky; s.last = 'rotate'; s.kick = i;
        if (p.y > s.lowest) { s.lowest = p.y; s.lockMoves = 0; }
        moved(s); emit(s, 'rotate', { dir, kick: i });
        return true;
      }
    }
    return false;
  }
  function doHold(s) {
    if (!R.hold || s.holdUsed) return;
    const cur = s.piece.t;
    s.holdUsed = true;
    emit(s, 'hold', { t: cur });
    if (s.hold < 0) { s.hold = cur; spawn(s); } else { const h = s.hold; s.hold = cur; spawn(s, h); }
  }

  // 3-corner T-spin rule; mini unless both front corners are filled or the last kick was the 5th test.
  function tspinKind(s, p) {
    if (types[p.t].key !== 'T' || s.last !== 'rotate') return null;
    const filled = (x, y) => x < 0 || x >= W || y >= H || y < 0 || !!s.board[y * W + x];
    const c = [[p.x, p.y], [p.x + 2, p.y], [p.x + 2, p.y + 2], [p.x, p.y + 2]].map(([x, y]) => filled(x, y)); // TL TR BR BL
    if (c.filter(Boolean).length < 3) return null;
    const front = [[0, 1], [1, 2], [2, 3], [3, 0]][p.r];
    return (c[front[0]] && c[front[1]]) || s.kick === 4 ? 'full' : 'mini';
  }

  function lock(s) {
    const p = s.piece, cells = cellsOf(p);
    for (const [x, y] of cells) s.board[y * W + x] = p.t + 1;
    s.stats.pieces++;
    emit(s, 'land', { cells, t: p.t });
    s.piece = null; s.holdUsed = false;
    if (cells.every(([, y]) => y < HIDDEN)) { lose(s, 'Locked out above the well'); return; }
    const spin = tspinKind(s, p);
    const rows = [];
    for (let y = 0; y < H; y++) { let full = true; for (let x = 0; x < W; x++) if (!s.board[y * W + x]) { full = false; break; } if (full) rows.push(y); }
    const n = rows.length, mult = s.level + 1;
    let pts = 0, label = '';
    const NAMES = ['', 'Single', 'Double', 'Triple', 'Tetris', 'Pentris'];
    if (spin === 'full') { pts = [400, 800, 1200, 1600, 2000][n] ?? 2000; label = `T-Spin ${NAMES[n] || ''}`.trim(); }
    else if (spin === 'mini') { pts = [100, 200, 400][n] ?? 400; label = `Mini T-Spin ${NAMES[n] || ''}`.trim(); }
    else if (n) { pts = [0, 100, 300, 500, 800, 1200][n] ?? 1200; label = NAMES[n] || `${n} lines`; }
    const difficult = n >= 4 || (spin && n > 0);
    let b2b = false;
    if (n) {
      if (difficult && s.b2b) { pts = Math.round(pts * 1.5); b2b = true; }
      s.b2b = difficult;
      s.combo++;
      s.stats.maxCombo = Math.max(s.stats.maxCombo, s.combo);
      if (s.combo > 0) pts += 50 * s.combo;
      s.stats[['', 'singles', 'doubles', 'triples', 'tetrises', 'tetrises'][Math.min(5, n)]]++;
    } else s.combo = -1;
    if (spin) s.stats.tspins++;
    let perfect = false;
    if (n) {
      const set = new Set(rows);
      perfect = s.board.every((v, i) => !v || set.has(Math.floor(i / W)));
      if (perfect) { pts += [0, 800, 1200, 1800, 2000, 2400][Math.min(5, n)]; s.stats.perfect++; }
    }
    const gained = pts * mult;
    s.score += gained; s.levelScore += gained;
    if (n || spin) {
      s.lastClear = { n, spin, b2b, combo: s.combo, perfect, label, points: gained };
      emit(s, 'lines', { count: n, rows, spin, b2b, combo: s.combo, perfect, label, points: gained, cells: rows.flatMap(y => Array.from({ length: W }, (_, x) => [x, y, s.board[y * W + x]])) });
      if (n) emit(s, 'collect', { count: n });
      if (n >= 4 || spin) emit(s, 'power');
    }
    if (n) { s.phase = 'clear'; s.phaseT = clearFrames; s.clearRows = rows; return; }
    afterLock(s);
  }
  function finishClear(s) {
    const set = new Set(s.clearRows), n = set.size, keep = [];
    for (let y = 0; y < H; y++) if (!set.has(y)) keep.push(...s.board.slice(y * W, y * W + W));
    s.board = [...new Array(n * W).fill(0), ...keep];
    s.lines += n; s.levelLines += n; s.clearRows = [];
    s.phase = 'play';
    afterLock(s);
  }
  function goalMet(s) {
    const L = levelAt(content, s.level);
    if (L.goal === 'lines') return s.levelLines >= L.target;
    if (L.goal === 'score') return s.levelScore >= L.target;
    if (L.goal === 'survive') return s.levelT >= L.timeSec * 60;
    return false;
  }
  function checkLevel(s) {
    if (!goalMet(s)) return;
    if (stay) { if (!s.goalMet) { s.goalMet = { pieces: s.stats.pieces, frames: s.levelT }; emit(s, 'goal'); } return; }
    if (isLastLevel(content, s.level)) { win(s); return; }
    const L = levelAt(content, s.level), carry = L.goal === 'lines' ? s.levelLines - L.target : 0;
    startLevel(s, s.level + 1);
    s.levelLines = Math.max(0, carry);
    const N = levelAt(content, s.level);
    emit(s, 'level_up', { level: s.level, title: N.name, intro: N.intro });
  }
  function afterLock(s) {
    checkLevel(s);
    if (s.status === 'playing') spawn(s);
  }

  function step(s, input) {
    s.events = [];
    if (s.status !== 'playing') return s;
    const e = edges(s, input);
    s.frame++; s.time += DT;
    if (s.phase === 'intro') {
      if (--s.phaseT <= 0) { s.phase = 'play'; spawn(s); emit(s, 'go'); }
      return s;
    }
    s.levelT++;
    const L = levelAt(content, s.level);
    if (L.goal === 'survive' && s.levelT >= L.timeSec * 60) { checkLevel(s); if (s.status !== 'playing') return s; }
    else if (L.timeSec && L.goal !== 'survive' && !s.goalMet && s.levelT >= L.timeSec * 60) { lose(s, 'Time up'); return s; }
    if (s.phase === 'clear') { if (--s.phaseT <= 0) finishClear(s); return s; }
    if (!s.piece) { spawn(s); if (s.status !== 'playing') return s; }
    const p = s.piece;
    if (R.hold && ((e.aP && e.b) || (e.bP && e.a))) { doHold(s); return s; }
    if (e.aP) rotate(s, 1);
    else if (e.bP) rotate(s, -1);
    const dx = autoShift(s.shift, e.x);
    if (dx) shift(s, dx);
    if (e.up) {
      const y0 = p.y, y1 = ghostY(s), from = cellsOf(p);
      p.y = y1;
      if (y1 > y0) { s.last = 'drop'; s.score += 2 * (y1 - y0); s.levelScore += 2 * (y1 - y0); }
      emit(s, 'hit', { dist: y1 - y0, from, cells: cellsOf(p), t: p.t });
      lock(s);
      return s;
    }
    const soft = e.y > 0;
    const g = soft ? Math.max(gravityRows(s.speed) * SOFT_FACTOR, 0.34) : gravityRows(s.speed);
    s.grav += g;
    while (s.grav >= 1) {
      s.grav -= 1;
      if (fitsP(s, p, p.r, p.x, p.y + 1)) {
        p.y++; s.last = 'drop';
        if (soft) { s.score += 1; s.levelScore += 1; }
        if (p.y > s.lowest) { s.lowest = p.y; s.lockMoves = 0; s.lockT = 0; }
      } else { s.grav = 0; break; }
    }
    if (!fitsP(s, p, p.r, p.x, p.y + 1)) {
      s.lockT++;
      if (s.lockT >= LOCK_DELAY || s.lockMoves >= MOVE_RESETS) lock(s);
    }
    return s;
  }

  /** Where a rotation would put a piece on this board (with kicks), or null. Used by the bot's path check. */
  function rotateTry(board, t, r, x, y, dir) {
    const to = (r + dir + 4) % 4, kicks = kicksFor(types[t], r, to);
    for (const [kx, ky] of kicks) if (fits(board, t, to, x + kx, y + ky)) return { r: to, x: x + kx, y: y + ky };
    return null;
  }

  return { mode: 'falling', content, types, W, H, HIDDEN, createState, step, fits, dropY, ghostY, cellsOf, gravityRows, rotateTry };
}

export { fallingBot } from './falling-bot.js';
