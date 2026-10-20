// Falling-mode bot: a placement search over every rotation and column for the
// current piece and the hold option, with one-piece lookahead on the next
// piece, scored by the El-Tetris weights (Dellacherie features: landing
// height, rows cleared, row and column transitions, holes, cumulative wells).
// It plays through the real step function with honest input timing: one
// rotation and one shift per press, a release frame between presses, and the
// level's gravity acting meanwhile. A placement is only chosen if a simulation
// of that input sequence under gravity actually reaches it.

const WEIGHTS = { landing: -4.500158825082766, cleared: 3.4181268101392694, rowT: -3.2178882868487753, colT: -9.348695305445199, holes: -7.899265427351652, wells: -3.3855972247263626 };
const pc = v => { v -= (v >>> 1) & 0x55555555; v = (v & 0x33333333) + ((v >>> 2) & 0x33333333); return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; };
const PRESS_FRAMES = 2; // a press and a release

export function createPlanner(game) {
  const { W, H } = game, FULL = (1 << W) - 1, WALLS = 1 | (1 << (W + 1)), TMASK = (1 << (W + 1)) - 1;
  // Per type and rotation: rows of the shape as [dy, mask at x = 0], and the column span.
  const shapes = game.types.map(T => T.states.map(cells => {
    const rows = new Map();
    for (const [cx, cy] of cells) rows.set(cy, (rows.get(cy) || 0) | (1 << (cx + 4)));
    const xs = cells.map(c => c[0]), ys = cells.map(c => c[1]);
    return { rows: [...rows].sort((a, b) => a[0] - b[0]), minX: Math.min(...xs), maxX: Math.max(...xs), midY: (Math.min(...ys) + Math.max(...ys)) / 2 };
  }));
  const rotations = game.types.map(T => T.kicks === 'O' ? 1 : new Set(T.states.map(c => c.map(p => p.join()).sort().join('|'))).size === 2 ? 2 : 4);
  const mask = (m, x) => x >= 4 ? m << (x - 4) : m >> (4 - x); // the stored mask is offset by 4 so x may be negative
  function collide(rows, t, r, x, y) {
    const sh = shapes[t][r];
    if (x + sh.minX < 0 || x + sh.maxX >= W) return true;
    for (const [dy, m] of sh.rows) { const yy = y + dy; if (yy < 0 || yy >= H || rows[yy] & mask(m, x)) return true; }
    return false;
  }
  const drop = (rows, t, r, x, y) => { while (!collide(rows, t, r, x, y + 1)) y++; return y; };
  function place(rows, t, r, x, y) {
    const out = rows.slice(), sh = shapes[t][r];
    for (const [dy, m] of sh.rows) out[y + dy] |= mask(m, x);
    let cleared = 0, w = H - 1;
    for (let yy = H - 1; yy >= 0; yy--) { if (out[yy] === FULL) cleared++; else out[w--] = out[yy]; }
    while (w >= 0) out[w--] = 0;
    return { rows: out, cleared, landing: H - (y + sh.midY) };
  }
  const runs = new Int32Array(W);
  let tall = 0; // extra weight on stack height when gravity is so fast that pieces must slide over the stack
  function evaluate(rows, landing, cleared) {
    let rowT = 0, colT = 0, holes = 0, wells = 0, above = 0, prev = 0, anyRun = false;
    runs.fill(0);
    for (let y = 0; y < H; y++) {
      const r = rows[y], m = (r << 1) | WALLS;
      rowT += pc((m ^ (m >>> 1)) & TMASK);
      colT += pc((r ^ prev) & FULL); prev = r;
      holes += pc(~r & above & FULL); above |= r;
      const wm = ~r & FULL & m & (m >>> 2);
      if (wm) { anyRun = true; for (let x = 0; x < W; x++) { if (wm >> x & 1) wells += ++runs[x]; else runs[x] = 0; } }
      else if (anyRun) { runs.fill(0); anyRun = false; }
    }
    colT += pc(~prev & FULL);
    let top = 0; if (tall) while (top < H && !rows[top]) top++;
    return (tall ? -tall * (H - top) * (H - top) : 0) + WEIGHTS.landing * landing + WEIGHTS.cleared * cleared + WEIGHTS.rowT * rowT + WEIGHTS.colT * colT + WEIGHTS.holes * holes + WEIGHTS.wells * wells;
  }

  // Simulate the bot's inputs from the spawn position under gravity g (rows per frame): one rotation
  // and/or one shift per press, PRESS_FRAMES apart. Returns true when the piece arrives at (r, x).
  function reachable(board, t, r, x, gravity, start) {
    let p = { r: start.r, x: start.x, y: start.y }, acc = gravity; // the first press comes a frame after the spawn
    const turns = (r - p.r + 4) % 4, dir = turns === 3 ? -1 : 1;
    let left = turns === 3 ? 1 : turns;
    for (let guard = 0; guard < 40; guard++) {
      if (left) { const q = game.rotateTry(board, t, p.r, p.x, p.y, dir); if (!q) return false; p = q; left--; }
      if (p.x !== x) { const nx = p.x + Math.sign(x - p.x); if (!game.fits(board, t, p.r, nx, p.y)) return false; p.x = nx; }
      if (!left && p.x === x && p.r === r) return true;
      acc += gravity * PRESS_FRAMES;
      while (acc >= 1) { acc -= 1; if (game.fits(board, t, p.r, p.x, p.y + 1)) p.y++; else { acc = 0; break; } }
    }
    return false;
  }

  function options(board, rows, t, gravity, check) {
    const T = game.types[t], start = { r: 0, x: T.spawnX, y: T.spawnY + (game.fits(board, t, 0, T.spawnX, T.spawnY + 1) ? 1 : 0) };
    const out = [];
    for (let r = 0; r < rotations[t]; r++) {
      const sh = shapes[t][r];
      for (let x = -sh.minX; x + sh.maxX < W; x++) {
        if (collide(rows, t, r, x, start.y)) continue;
        if (check && !reachable(board, t, r, x, gravity, start)) continue;
        const y = drop(rows, t, r, x, start.y), res = place(rows, t, r, x, y);
        out.push({ t, r, x, y, res, v: evaluate(res.rows, res.landing, res.cleared) });
      }
    }
    return out;
  }
  const rowsOf = board => { const rows = new Array(H).fill(0); for (let i = 0; i < W * H; i++) if (board[i]) rows[(i / W) | 0] |= 1 << (i % W); return rows; };

  /** Best move for the current state: { hold, r, x } (or null when nothing fits). depth 1 or 2. */
  function plan(s, { depth = 2, top = 8 } = {}) {
    const p = s.piece; if (!p) return null;
    const gravity = game.gravityRows(s.speed), rows = rowsOf(s.board);
    tall = gravity >= 5 ? 3 : 0;
    const firsts = [{ hold: false, t: p.t, next: s.queue[0] }];
    if (game.content.rules.hold && !s.holdUsed) firsts.push(s.hold >= 0 ? { hold: true, t: s.hold, next: s.queue[0] } : { hold: true, t: s.queue[0], next: s.queue[1] });
    let best = null;
    for (const f of firsts) {
      const cands = options(s.board, rows, f.t, gravity, true).sort((a, b) => b.v - a.v).slice(0, depth > 1 ? top : 1);
      for (const c of cands) {
        let v = c.v;
        if (depth > 1 && f.next !== undefined) {
          const board2 = new Array(W * H);
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) board2[y * W + x] = (c.res.rows[y] >> x) & 1;
          let b2 = -Infinity;
          for (const o of options(board2, c.res.rows, f.next, gravity, gravity > 0.05)) b2 = Math.max(b2, o.v + WEIGHTS.cleared * c.res.cleared);
          v = b2 === -Infinity ? -1e9 : b2 + WEIGHTS.landing * c.res.landing * 0.25;
        }
        if (!best || v > best.v) best = { hold: f.hold, t: f.t, r: c.r, x: c.x, v };
      }
    }
    return best;
  }
  return { plan, evaluate, rowsOf, options };
}

/**
 * Input source that plays the falling game. pace: frames to wait after spawn before a hard drop
 * (20 ≈ three pieces a second, a quick human); gravity keeps acting while it waits.
 */
export function fallingBot(game, { depth = 2, pace = 20, longDepth = 1, longAfter = 160 } = {}) {
  const planner = createPlanner(game);
  let plan = null, planFor = -1, held = false, tick = 0, since = 0;
  const idle = { x: 0, y: 0, a: false, b: false };
  return s => {
    if (s.phase !== 'play' || !s.piece) { tick = 0; return idle; }
    if (planFor !== s.piece.id) {
      if (!held) { plan = planner.plan(s, { depth: s.stats.pieces >= longAfter ? longDepth : depth }); since = 0; }
      planFor = s.piece.id;
      if (plan?.hold && !held) { held = true; tick = 0; return { ...idle, a: true, b: true }; }
      held = false;
    }
    since++;
    if (++tick % PRESS_FRAMES) return idle;
    const p = s.piece;
    if (!plan) return since >= pace ? { ...idle, y: -1 } : idle;
    const turns = (plan.r - p.r + 4) % 4;
    const inp = { ...idle };
    if (turns) { if (turns === 3) inp.b = true; else inp.a = true; }
    if (p.x !== plan.x) inp.x = Math.sign(plan.x - p.x);
    if (!turns && p.x === plan.x && since >= pace) inp.y = -1;
    return inp;
  };
}
