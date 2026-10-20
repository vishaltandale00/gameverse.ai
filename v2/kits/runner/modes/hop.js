// Hop mode (Crossy Road): hop one cell per press across grass (trees block),
// roads (cars), rivers (ride logs; water and the screen edge kill) and rails
// (trains after a flashing warning). The camera creeps forward; fall behind it
// or idle too long and the eagle takes you. Traffic speeds up along the run.
// Lanes are periodic in time, so every row is analytic and cheap to search.

export const HOP = { cols: 9, hopTime: 0.13, idle: 8, behind: 2.2, train: 30, warn: 1.25, carHalf: 0.32 };
const DIRS = { up: [0, 1], down: [0, -1], left: [-1, 0], right: [1, 0] };

function compile(content, chars) {
  return content.chunks.map(k => {
    // Rows are a picture: the bottom row is the nearest.
    const rows = k.rows.slice().reverse().map((row, r) => {
      const cells = [...row];
      const lane = cells.map(ch => chars.get(ch)).find(Boolean);
      const coins = cells.map((ch, i) => ch === 'o' ? i : -1).filter(i => i >= 0);
      const boxes = cells.map((ch, i) => ch === '*' ? i : -1).filter(i => i >= 0);
      if (!lane) return { kind: 'grass', trees: cells.map(ch => ch === 'T'), coins, boxes };
      // Direction and phase come from the chunk itself, so the structural check sees the real layout.
      const dir = r % 2 ? -1 : 1, seed = (r * 2.39 + k.id.length * 0.77) % 1;
      return { kind: lane.kind, name: lane.name, dir, speed: lane.speed, size: lane.size, period: lane.period, phase: seed, coins, boxes };
    });
    return { id: k.id, tier: k.tier, rows, length: rows.length + 1 };
  });
}

function place(s, chunk, at, G) {
  // Density sets how many safe meadow rows separate chunks.
  const safe = s.game.content.rules.density < 0.8 ? 2 : 1;
  if (safe > 1) G.add(s, [{ t: 'row', r: at, kind: 'grass', trees: Array(s.game.content.rules.width).fill(false), coins: [], p: at, e: at + 0.5 }]);
  at += safe - 1;
  const f = 1 + 0.5 * Math.min(1, (s.trial ? s.trial.time : s.time) / s.game.content.speed.rampSeconds);
  const C = s.game.content.rules.width;
  const list = [{ t: 'row', r: at, kind: 'grass', trees: Array(C).fill(false), coins: [], p: at, e: at + 0.5, join: true }];
  chunk.rows.forEach((row, i) => {
    const r = at + 1 + i;
    const o = { ...row, t: 'row', r, p: r, e: r + 0.5 };
    if (row.kind === 'road' || row.kind === 'river') { o.v = row.speed * f; o.off = row.phase * row.period; }
    if (row.kind === 'rail') { o.off = row.phase * row.period; o.pass = (row.size + C + 6) / HOP.train; o.cols = C; }
    list.push(o);
    for (const c of row.coins) list.push({ t: 'coin', r, x: c, p: r + 0.1, e: r + 0.6 });
    for (const c of row.boxes) list.push({ t: 'box', r, x: c, p: r + 0.1, e: r + 0.6, power: G.pickPower(s) });
  });
  G.add(s, list);
  return chunk.length + safe - 1;
}

// ---------- lane state at time t ----------
const mod = (a, n) => ((a % n) + n) % n;
/** Signed distance from x to the nearest car/log centre in a periodic lane. */
export function nearest(o, x, t) {
  const u = mod(x - o.off - o.dir * o.v * t, o.period);
  return u <= o.period / 2 ? u : u - o.period;
}
/** Train state: { on: front x or null, warn } at time t. */
export function trainAt(o, t) {
  const cyc = mod(t - o.off, o.period);
  const warn = cyc > o.period - HOP.warn;
  if (cyc < o.pass) { const front = -6 + HOP.train * cyc; return { front: o.dir > 0 ? front : o.cols - 1 + 6 - HOP.train * cyc, warn: false }; }
  return { front: null, warn };
}

function rowAt(s, r) {
  for (const o of s.objs) { if (o.p > r) break; if (o.t === 'row' && o.r === r) return o; }
  return null;
}

function init(s, G, { trial = false } = {}) {
  const C = s.game.content.rules.width, x0 = Math.floor(C / 2);
  s.p = { x: x0, r: 0, fx: x0, fr: 0, tx: x0, tr: 0, hopT: 1, hopping: false, queue: null, maxRow: 0, idleT: 0, cam: trial ? -2 : -3, face: 1, ride: 0, bump: 0, squash: 0 };
  // A safe meadow behind and at the start.
  const list = [];
  for (let r = trial ? -3 : -6; r <= (trial ? -1 : 2); r++) list.push({ t: 'row', r, kind: 'grass', trees: Array.from({ length: C }, (_, i) => !trial && r < 0 && (i === 0 || i === C - 1 || (r === -2 && i % 3 === 1))), coins: [], p: r, e: r + 0.5 });
  G.add(s, list);
  if (trial) s.p = { ...s.p, r: -1, fr: -1, tr: -1, maxRow: -1 };
  s.nextAt = trial ? 0 : 3;
}

function trialEnd(s, G) {
  const list = [];
  for (let r = s.trial.end; r < s.trial.end + 4; r++) list.push({ t: 'row', r, kind: 'grass', trees: Array(s.game.content.rules.width).fill(false), coins: [], p: r, e: r + 0.5 });
  G.add(s, list);
}

function tryHop(s, dir, G) {
  const p = s.p, [dx, dr] = DIRS[dir];
  const to = rowAt(s, p.r + dr);
  let tx = p.x + dx;
  const toGround = !to || to.kind === 'grass' || to.kind === 'road' || to.kind === 'rail';
  if (toGround) tx = Math.round(tx);
  if (tx < -0.01 || tx > s.game.content.rules.width - 0.99 || !to) { p.bump = 0.15; return; }
  if (to.kind === 'grass' && to.trees[Math.round(tx)]) { p.bump = 0.15; G.emit(s, 'bump'); return; }
  p.fx = p.x; p.fr = p.r; p.tx = tx; p.tr = p.r + dr; p.hopT = 0; p.hopping = true; p.face = dx || p.face;
  G.count(s, 'hops'); G.emit(s, 'jump');
}

function step(s, inp, press, dt, G) {
  const p = s.p, c = s.game.content;
  let want = null;
  if (press.y < 0 || press.a) want = 'up'; else if (press.y > 0) want = 'down'; else if (press.x < 0) want = 'left'; else if (press.x > 0) want = 'right';
  if (want) { if (p.hopping) p.queue = want; else tryHop(s, want, G); }
  if (p.bump > 0) p.bump -= dt;
  if (p.squash > 0) p.squash -= dt;
  const cur = rowAt(s, p.r);
  if (p.hopping) {
    p.hopT += dt / HOP.hopTime;
    // Logs keep carrying the landing spot while airborne.
    const dest = rowAt(s, p.tr);
    if (dest?.kind === 'river') p.tx += dest.dir * dest.v * dt;
    const k = Math.min(1, p.hopT);
    p.x = p.fx + (p.tx - p.fx) * k;
    if (k >= 0.5) p.r = p.tr;
    if (p.hopT >= 1) {
      p.hopping = false; p.x = p.tx; p.squash = 0.12;
      G.emit(s, 'land');
      if (p.r > p.maxRow) { p.maxRow = p.r; p.idleT = 0; }
      const row = rowAt(s, p.r);
      if (row?.kind === 'river' && Math.abs(nearest(row, p.x, s.time)) > row.size / 2 + 0.05) { if (!G.hit(s, `Fell into the ${row.name}`)) return; p.x = Math.round(p.x); }
      if (p.queue) { const q = p.queue; p.queue = null; tryHop(s, q, G); }
    }
  } else if (cur?.kind === 'river') {
    p.x += cur.dir * cur.v * dt;
    const C = c.rules.width;
    if (p.x < -0.6 || p.x > C - 0.4) { if (!G.hit(s, `Swept away by the ${cur.name}`)) return; p.x = Math.max(0, Math.min(C - 1, Math.round(p.x))); }
  }
  // Traffic on the current row.
  const row = rowAt(s, p.r);
  if (row?.kind === 'road') {
    const d = nearest(row, p.x, s.time);
    if (Math.abs(d) < row.size / 2 + HOP.carHalf && s.invuln <= 0) { if (!G.hit(s, `Flattened by a ${row.name}`)) return; }
    else if (Math.abs(d) < row.size / 2 + HOP.carHalf + 0.4 && s.flag[`n${row.id}`] === undefined) G.nearMiss(s, row);
  } else if (row?.kind === 'rail') {
    const tr = trainAt(row, s.time);
    if (tr.front !== null) {
      const back = row.dir > 0 ? tr.front - row.size : tr.front + row.size;
      const lo = Math.min(tr.front, back), hi = Math.max(tr.front, back);
      if (p.x > lo - 0.4 && p.x < hi + 0.4 && s.invuln <= 0) { if (!G.hit(s, `Hit by the ${row.name}`)) return; }
    }
  }
  // Coins and power-ups at the hero's cell.
  for (const o of s.objs) {
    if (o.p > p.r + 1) break;
    if ((o.t === 'coin' || o.t === 'box') && s.gone[o.id] === undefined) {
      const near = s.powers.magnet > 0 ? Math.abs(o.r - p.r) <= 1 && Math.abs(o.x - p.x) <= 2 : o.r === p.r && Math.abs(o.x - p.x) < 0.6;
      if (near) o.t === 'coin' ? G.collect(s, o) : G.power(s, o);
    }
  }
  // Camera creep and the eagle.
  p.cam = Math.max(p.cam + s.speed * dt, p.r - 4);
  p.idleT += dt;
  if (p.idleT > HOP.idle || p.r < p.cam - HOP.behind) G.die(s, `Snatched by the ${c.cast.chaser.name}`);
}

export default {
  id: 'hop', ahead: 18, behind: 7, compile, place, init, step, trialEnd, slowmo: false,
  progress: s => Math.max(0, s.p.maxRow),
  // A lost life puts the hero back on the nearest meadow row behind it.
  respawn(s) {
    const p = s.p;
    let safe = null;
    for (const o of s.objs) if (o.t === 'row' && o.kind === 'grass' && o.r <= p.r && (!safe || o.r > safe.r)) safe = o;
    if (safe) { p.r = p.fr = p.tr = safe.r; let x = Math.max(0, Math.min(s.game.content.rules.width - 1, Math.round(p.x))); if (safe.trees[x]) x = safe.trees.findIndex(t => !t); p.x = p.fx = p.tx = x; }
    p.hopping = false; p.queue = null; p.idleT = 0; p.cam = Math.min(p.cam, p.r - 1);
  },
  solver: {
    every: 8,
    actions: [{}, { y: -1, tap: true }, { x: -1, tap: true }, { x: 1, tap: true }, { y: 1, tap: true }],
    bucket: s => `${Math.round(s.p.x)}|${s.p.r}`,
    key: s => `${Math.round(s.p.x * 4)}|${s.p.r}|${s.p.hopping ? Math.round(s.p.tx * 4) : 'g'}|${s.p.maxRow}|${s.invuln > 0 ? 1 : 0}`,
    score: s => s.p.maxRow * 3 + s.p.r - Math.abs(s.p.x - (s.game.content.rules.width - 1) / 2) * 0.1 + s.coins * 0.05 - (s.p.idleT > 5 ? 3 : 0),
    entries: () => [0],
  },
};
