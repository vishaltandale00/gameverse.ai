// Maze generator and structural checks for the maze kit.
//
// Content never draws a maze; it picks a size, a style and parameters per level
// and this builds one deterministically from them and a seed. The construction
// guarantees the classic invariants at every size, and checkMaze() re-proves them
// on the raster:
// - mirrored left to right (the width is even; the axis runs between the middle columns);
// - corridors exactly one tile wide (no 2×2 open block) and no dead ends;
// - hunter houses with doors, each ringed by a corridor: one in the middle at the
//   classic size, more at larger sizes (on the axis, or as mirrored pairs);
// - side tunnels that wrap;
// - every pellet reachable from the player's start.
//
// How: corridors run along a lattice of columns and rows spaced 3 or more tiles
// apart (so walls are at least 2 thick); the house rings are forced lattice lines.
// The left half's lattice graph starts complete; edges are removed at random while
// every node keeps degree ≥ 2 (no dead ends) and the half stays connected. The
// right half is the mirror, joined by corridors that cross the centre line and by
// the wrapping tunnels. At the classic size this draws exactly the same random
// numbers as the original generator, so existing games keep their mazes.
import { seedFrom } from '../../kernel/rng.js';

/** Classic dimensions; other sizes come from SIZES. */
export const W = 28, H = 31;
export const SIZES = { classic: { w: 28, h: 31 }, large: { w: 44, h: 47 }, huge: { w: 60, h: 63 }, vast: { w: 92, h: 95 } };
export const SIZE_NAMES = Object.keys(SIZES);
export const sizeOf = name => SIZES[name] || SIZES.classic;
/** Area relative to the classic maze. */
export const areaScale = name => { const z = sizeOf(name); return (z.w * z.h) / (W * H); };
export const WALL = 0, OPEN = 1, DOOR = 2, HOUSE = 3, HOUSE_WALL = 4;
const HOUSE_W = 8, HOUSE_H = 5;
/** Where houses sit: on the axis, or as a mirrored pair a quarter of the way in; cy is the vertical fraction. */
const LAYOUTS = {
  classic: [{ axis: true, cy: 0.5 }],
  large: [{ axis: true, cy: 0.3 }, { axis: true, cy: 0.7 }],
  huge: [{ axis: false, cy: 0.27 }, { axis: true, cy: 0.72 }],
  vast: [{ axis: false, cy: 0.2 }, { axis: true, cy: 0.5 }, { axis: false, cy: 0.8 }],
};
// The classic house as named constants (tests and older callers use them; the game reads maze.houses).
/** House walls (inclusive tile rect); the interior is the rect inset by one. */
export const HOUSE_RECT = { x0: 10, x1: 17, y0: 12, y1: 16 };
export const DOOR_TILES = [[13, 12], [14, 12]];
/** Positions are tile centres (tile (x, y) has its centre at (x, y)); .5 sits between two tiles. */
export const EXIT = { x: 13.5, y: 11 };
export const HOUSE_CENTER = { x: 13.5, y: 14 };
export const SLOTS = [EXIT, HOUSE_CENTER, { x: 11.5, y: 14 }, { x: 15.5, y: 14 }, { x: 12.5, y: 14 }, { x: 14.5, y: 14 }];
export const BONUS_AT = { x: 13.5, y: 17 };

/** Lattice spacing per style (the corridor shape); `inner` is the chance of the extra column next to the centre. */
export const STYLES = {
  classic: { gaps: [3, 4, 5], inner: 0.5 },
  compact: { gaps: [3, 4], inner: 0.85 },
  sprawling: { gaps: [4, 5, 6, 8], inner: 0.2 },
};
export const STYLE_NAMES = Object.keys(STYLES);

/** Power pellets in a level: the content's classic-size count, scaled with area at larger sizes (always even). */
export function powerCountFor(params = {}) {
  const base = Math.min(6, Math.max(2, 2 * Math.round((params.powerPellets ?? 4) / 2)));
  const size = SIZES[params.size] ? params.size : 'classic';
  return size === 'classic' ? base : 2 * Math.round((base * areaScale(size)) / 2);
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** All ways to write `total` as an ordered sum of `parts`. */
function compositions(total, parts) {
  const out = [];
  const rec = (left, acc) => {
    if (out.length > 400) return;
    if (left === 0) { out.push(acc); return; }
    for (const p of parts) if (p <= left) rec(left - p, [...acc, p]);
  };
  rec(total, []);
  return out;
}
/** Lattice lines from `from` to `to` inclusive, spaced by a random composition of the style's gaps. */
function lines(from, to, parts, r) {
  let options = compositions(to - from, parts);
  if (!options.length) options = compositions(to - from, [3, 4, 5, 6, 7, 8, 9, 10]);
  const pick = options[Math.floor(r() * options.length)];
  const out = [from];
  for (const g of pick) out.push(out[out.length - 1] + g);
  return out;
}

export const wrapX = (x, w = W) => ((x % w) + w) % w;

/** A size's houses: wall rect, door, exit (just above the door), centre and hunter slots. Mirrored pairs are both listed. */
export function housesFor(size, w = sizeOf(size).w, h = sizeOf(size).h) {
  const out = [];
  for (const spec of LAYOUTS[size] || LAYOUTS.classic) {
    const y0 = Math.round(spec.cy * (h - 1)) - 3;
    const left = Math.round(w / 4) - 4;
    const x0s = spec.axis ? [w / 2 - 4] : [left, w - left - HOUSE_W];
    for (const x0 of x0s) {
      const x1 = x0 + HOUSE_W - 1, y1 = y0 + HOUSE_H - 1, cx = x0 + 3.5, cy = y0 + 2;
      out.push({
        axis: spec.axis, side: spec.axis ? 0 : x0 < w / 2 ? -1 : 1, x0, x1, y0, y1,
        door: [[x0 + 3, y0], [x0 + 4, y0]], exit: { x: cx, y: y0 - 1 }, center: { x: cx, y: cy },
        slots: [{ x: cx, y: y0 - 1 }, { x: cx, y: cy }, { x: cx - 2, y: cy }, { x: cx + 2, y: cy }, { x: cx - 1, y: cy }, { x: cx + 1, y: cy }],
      });
    }
  }
  return out;
}

/**
 * Build a maze. params: { size, style, density 0..1, tunnels 1..2, powerPellets 2..6 (classic-size count) }.
 * Returns plain data: dimensions, cells (WALL/OPEN/DOOR/HOUSE/HOUSE_WALL per tile), pellet and
 * power-pellet tile indices, tunnel rows, houses, the player's start, the bonus spot, no-upward-turn tiles.
 */
export function buildMaze(params = {}, seed = 1) {
  const size = SIZES[params.size] ? params.size : 'classic';
  const { w: MW, h: MH } = SIZES[size];
  const style = STYLES[params.style] ? params.style : 'classic';
  const density = Math.min(1, Math.max(0, Number.isFinite(params.density) ? params.density : 0.6));
  const tunnels = Math.min(2, Math.max(1, Math.round(params.tunnels ?? 1)));
  const powerCount = powerCountFor({ ...params, size });
  const r = mulberry(typeof seed === 'number' ? seed : seedFrom(seed));
  const { gaps, inner } = STYLES[style];
  const mirror = x => MW - 1 - x;
  const houses = housesFor(size, MW, MH);
  const leftHouses = houses.filter(q => q.side <= 0);
  const axisHouses = houses.filter(q => q.axis);
  // The main house: on the axis, nearest the middle. Its middle row is the first tunnel.
  const main = [...axisHouses].sort((a, b) => Math.abs(a.center.y - (MH - 1) / 2) - Math.abs(b.center.y - (MH - 1) / 2) || b.center.y - a.center.y)[0];

  // Lattice columns on the left half: forced at x=1 and every house ring column, random lines between.
  const forcedX = [...new Set([1, ...leftHouses.flatMap(q => (q.axis ? [q.x0 - 1] : [q.x0 - 1, q.x1 + 1]))])].sort((a, b) => a - b);
  const xs = [forcedX[0]];
  for (let i = 0; i + 1 < forcedX.length; i++) xs.push(...lines(forcedX[i], forcedX[i + 1], gaps, r).slice(1));
  if (r() < inner) xs.push(MW / 2 - 2);
  // Rows: forced at the house rings (with the house's middle row between them), random lines elsewhere.
  const spans = [...new Map(houses.map(q => [q.y0, [q.y0 - 1, q.y0 + 2, q.y1 + 1]])).values()].sort((a, b) => a[0] - b[0]);
  const ys = [1];
  let at = 1;
  for (const [top, middle, bottom] of spans) { ys.push(...lines(at, top, gaps, r).slice(1), middle, bottom); at = bottom; }
  ys.push(...lines(at, MH - 2, gaps, r).slice(1));
  const xl = xs[xs.length - 1];

  const inHouse = (x, y) => leftHouses.some(q => x >= q.x0 && x <= q.x1 && y >= q.y0 && y <= q.y1);
  const houseRows = new Set(spans.flat());
  const key = (x, y) => `${x},${y}`;
  const nodes = new Map();
  for (const y of ys) for (const x of xs) if (!inHouse(x, y)) nodes.set(key(x, y), { x, y });
  const blocked = (x0, y0, x1, y1) => {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) if (inHouse(x, y)) return true;
    return false;
  };
  // Edges: 'h'/'v' join two left-half nodes; 'c' crosses the centre to the node's mirror; 't' is a tunnel.
  const edges = [];
  for (const y of ys) {
    for (let i = 0; i + 1 < xs.length; i++) {
      const a = key(xs[i], y), b = key(xs[i + 1], y);
      if (nodes.has(a) && nodes.has(b) && !blocked(xs[i], y, xs[i + 1], y)) edges.push({ kind: 'h', a, b, x0: xs[i], x1: xs[i + 1], y });
    }
    if (nodes.has(key(xl, y)) && !blocked(xl, y, mirror(xl), y)) edges.push({ kind: 'c', a: key(xl, y), b: null, x0: xl, x1: mirror(xl), y });
  }
  for (const x of xs) for (let j = 0; j + 1 < ys.length; j++) {
    const a = key(x, ys[j]), b = key(x, ys[j + 1]);
    if (nodes.has(a) && nodes.has(b) && !blocked(x, ys[j], x, ys[j + 1])) edges.push({ kind: 'v', a, b, x, y0: ys[j], y1: ys[j + 1] });
  }
  // The start: a centre crossing nearest the middle (row 23 at the classic size), clear of the houses.
  const target = size === 'classic' ? 23 : Math.round((MH - 1) / 2);
  const crossing = new Set(edges.filter(e => e.kind === 'c').map(e => e.y));
  const startRow = ys.filter(y => y > 1 && y < MH - 2 && !houseRows.has(y) && crossing.has(y) && (size !== 'classic' || y > main.y1 + 1))
    .sort((p, q) => Math.abs(p - target) - Math.abs(q - target) || p - q)[0] ?? ys[ys.length - 1];
  // Tunnels: the main house's middle row always, plus another lattice row for two tunnels.
  const tunnelRows = [main.center.y];
  if (tunnels > 1) {
    const options = ys.filter(y => y !== 1 && y !== MH - 2 && !houseRows.has(y) && y !== startRow);
    if (options.length) tunnelRows.push(options[Math.floor(r() * options.length)]);
  }
  for (const y of tunnelRows) edges.push({ kind: 't', a: key(xs[0], y), b: null, y, required: true });

  // Required: every house ring, and the crossing the player starts on.
  for (const e of edges) {
    for (const q of leftHouses) {
      const ring = y => y === q.y0 - 1 || y === q.y1 + 1;
      if (e.kind === 'h' && ring(e.y) && e.x0 >= q.x0 - 1 && (q.axis || e.x1 <= q.x1 + 1)) e.required = true;
      if (e.kind === 'c' && q.axis && ring(e.y)) e.required = true;
      if (e.kind === 'v' && (e.x === q.x0 - 1 || (!q.axis && e.x === q.x1 + 1)) && e.y0 >= q.y0 - 1 && e.y1 <= q.y1 + 1) e.required = true;
    }
    if (e.kind === 'c' && e.y === startRow) e.required = true;
  }

  const live = new Set(edges);
  const degree = new Map([...nodes.keys()].map(k => [k, 0]));
  for (const e of edges) { degree.set(e.a, degree.get(e.a) + 1); if (e.b) degree.set(e.b, degree.get(e.b) + 1); }
  const connected = () => {
    const adj = new Map([...nodes.keys()].map(k => [k, []]));
    for (const e of live) if (e.b) { adj.get(e.a).push(e.b); adj.get(e.b).push(e.a); }
    const start = nodes.keys().next().value, seen = new Set([start]), queue = [start];
    while (queue.length) for (const n of adj.get(queue.pop())) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    return seen.size === nodes.size;
  };
  // Remove edges at random; endpoints keep degree ≥ 2 and the half stays connected.
  const removable = edges.filter(e => !e.required);
  for (let i = removable.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [removable[i], removable[j]] = [removable[j], removable[i]]; }
  const chance = Math.min(0.95, 1 - density);
  for (const e of removable) {
    if (r() >= chance) continue;
    if (degree.get(e.a) < 3 || (e.b && degree.get(e.b) < 3)) continue;
    live.delete(e);
    if (e.b && !connected()) { live.add(e); continue; }
    degree.set(e.a, degree.get(e.a) - 1); if (e.b) degree.set(e.b, degree.get(e.b) - 1);
  }

  // Rasterize, mirrored.
  const cells = new Array(MW * MH).fill(WALL);
  const open = (x, y) => { cells[y * MW + x] = OPEN; cells[y * MW + mirror(x)] = OPEN; };
  for (const e of live) {
    if (e.kind === 'h' || e.kind === 'c') for (let x = e.x0; x <= e.x1; x++) open(x, e.y);
    else if (e.kind === 'v') for (let y = e.y0; y <= e.y1; y++) open(e.x, y);
    else if (e.kind === 't') for (let x = 0; x <= xs[0]; x++) open(x, e.y);
  }
  for (const q of houses) {
    for (let y = q.y0; y <= q.y1; y++) for (let x = q.x0; x <= q.x1; x++) {
      const edge = y === q.y0 || y === q.y1 || x === q.x0 || x === q.x1;
      cells[y * MW + x] = edge ? HOUSE_WALL : HOUSE;
    }
    for (const [x, y] of q.door) cells[y * MW + x] = DOOR;
  }

  // Pellets on every corridor tile except the rings around the houses, the tunnel mouths and the start.
  const start = { x: MW / 2 - 0.5, y: startRow };
  const pellets = [];
  const inRing = (x, y) => houses.some(q => x >= q.x0 - 1 && x <= q.x1 + 1 && y >= q.y0 - 1 && y <= q.y1 + 1);
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    if (cells[y * MW + x] !== OPEN) continue;
    if (inRing(x, y)) continue;
    if (x === 0 || x === MW - 1) continue;
    if (y === startRow && (x === MW / 2 - 1 || x === MW / 2)) continue;
    pellets.push(y * MW + x);
  }
  // Power pellets: farthest-point picks on the left half, mirrored.
  const left = pellets.filter(i => i % MW < MW / 2);
  const picks = [], picked = new Set();
  const d2 = (i, x, y) => (i % MW - x) ** 2 + (Math.floor(i / MW) - y) ** 2;
  for (let n = 0; n < powerCount / 2 && left.length; n++) {
    let best = -1, bestScore = -1;
    for (const i of left) {
      if (picked.has(i)) continue;
      let score = d2(i, main.center.x, main.center.y) * (picks.length ? 0.35 : 1);
      for (const p of picks) score = Math.min(score, d2(i, p % MW, Math.floor(p / MW)));
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) break;
    picks.push(best); picked.add(best);
  }
  const power = picks.flatMap(i => { const y = Math.floor(i / MW), x = i % MW; return [i, y * MW + mirror(x)]; }).sort((a, b) => a - b);

  // Classic no-upward-turn tiles: where the axis house rings and the start row meet the inner column.
  const noUp = [];
  for (const y of [...axisHouses.map(q => q.y0 - 1), startRow]) for (const x of [xl, mirror(xl)]) if (cells[(y - 1) * MW + x] === OPEN) noUp.push(y * MW + x);
  // The bonus spot: below the axis house nearest the start, at the centre.
  const bonusHouse = [...axisHouses].sort((a, b) => Math.abs(a.y1 + 1 - startRow) - Math.abs(b.y1 + 1 - startRow))[0];

  return {
    w: MW, h: MH, size, style, density, seed: typeof seed === 'number' ? seed : seedFrom(seed),
    cells, pellets, power, tunnels: tunnelRows.sort((a, b) => a - b), start, houses,
    exit: main.exit, center: main.center, slots: main.slots, bonusAt: { x: MW / 2 - 0.5, y: bonusHouse.y1 + 1 }, noUp, lattice: { xs, ys },
  };
}

const DX = [0, -1, 0, 1], DY = [-1, 0, 1, 0];
/** Corridor tile test with tunnel wrap (only player-passable OPEN tiles). */
export function isOpen(maze, x, y) {
  const w = maze.w, h = maze.h;
  if (y < 0 || y >= h) return false;
  if (x < 0 || x >= w) { if (!maze.tunnels.includes(y)) return false; x = wrapX(x, w); }
  return maze.cells[y * w + x] === OPEN;
}
const neighbours = (maze, x, y) => {
  const out = [];
  for (let d = 0; d < 4; d++) if (isOpen(maze, x + DX[d], y + DY[d])) out.push([wrapX(x + DX[d], maze.w), y + DY[d]]);
  return out;
};

/**
 * Re-prove the invariants on the raster. Returns problems as { code, path, message, hint? }.
 * expect: { size?, powerPellets?, tunnels? } to check against the requested parameters
 * (powerPellets is the content's classic-size count; larger sizes scale it).
 */
export function checkMaze(maze, expect = {}, path = 'maze') {
  const problems = [];
  const fail = (code, message, hint) => problems.push({ code, path, message, ...(hint ? { hint } : {}) });
  const { cells, w: MW, h: MH } = maze;
  const want = sizeOf(expect.size || maze.size);
  if (MW !== want.w || MH !== want.h || cells.length !== MW * MH || MW % 2) { fail('maze_size', `maze must be ${want.w}×${want.h}`); return problems; }
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW / 2; x++) {
    const a = cells[y * MW + x], b = cells[y * MW + (MW - 1 - x)];
    if (a !== b) { fail('maze_mirror', `tile (${x},${y}) differs from its mirror`); return problems; }
  }
  let corridors = 0;
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    if (cells[y * MW + x] !== OPEN) continue;
    corridors++;
    if (x + 1 < MW && y + 1 < MH && isOpen(maze, x + 1, y) && isOpen(maze, x, y + 1) && isOpen(maze, x + 1, y + 1)) fail('maze_wide', `corridor wider than one tile at (${x},${y})`);
    if (neighbours(maze, x, y).length < 2) fail('maze_dead_end', `dead end at (${x},${y})`);
  }
  // Connectivity from the start (the start sits between two tiles).
  const sx = Math.floor(maze.start.x), sy = maze.start.y;
  if (!isOpen(maze, sx, sy) || !isOpen(maze, sx + 1, sy)) fail('maze_start', 'the player start is not on a corridor');
  const seen = new Uint8Array(MW * MH), queue = [[sx, sy]];
  if (isOpen(maze, sx, sy)) seen[sy * MW + sx] = 1;
  let reached = 0;
  while (queue.length) {
    const [x, y] = queue.pop(); reached++;
    for (const [nx, ny] of neighbours(maze, x, y)) if (!seen[ny * MW + nx]) { seen[ny * MW + nx] = 1; queue.push([nx, ny]); }
  }
  if (reached !== corridors) fail('maze_disconnected', `${corridors - reached} corridor tiles cannot be reached from the start`);
  const unreachable = [...maze.pellets, ...maze.power].filter(i => !seen[i]);
  if (unreachable.length) fail('pellet_unreachable', `${unreachable.length} pellets cannot be reached`);
  if (!maze.pellets.length) fail('no_pellets', 'the maze has no pellets');
  const pelletSet = new Set(maze.pellets);
  for (const i of maze.power) if (!pelletSet.has(i)) fail('power_misplaced', `power pellet at tile ${i} is not on a pellet tile`);
  if (expect.powerPellets != null) {
    const n = powerCountFor({ powerPellets: expect.powerPellets, size: maze.size });
    if (maze.power.length !== n) fail('power_count', `expected ${n} power pellets, found ${maze.power.length}`);
  }
  // Houses and doors.
  if (!maze.houses?.length) fail('house_missing', 'the maze has no hunter house');
  for (const q of maze.houses || []) {
    for (let y = q.y0 + 1; y < q.y1; y++) for (let x = q.x0 + 1; x < q.x1; x++) if (cells[y * MW + x] !== HOUSE) fail('house_interior', `house interior tile (${x},${y}) is not open`);
    for (const [x, y] of q.door) {
      if (cells[y * MW + x] !== DOOR) fail('house_door', `door tile (${x},${y}) missing`);
      if (!isOpen(maze, x, y - 1)) fail('house_door', `the door at (${x},${y}) does not open onto a corridor`);
      if (cells[(y + 1) * MW + x] !== HOUSE) fail('house_door', `the door at (${x},${y}) does not lead into the house`);
    }
    for (const s of q.slots.slice(1)) if (cells[s.y * MW + Math.floor(s.x)] !== HOUSE || cells[s.y * MW + Math.ceil(s.x)] !== HOUSE) fail('house_slot', `hunter slot (${s.x},${s.y}) is outside the house`);
    if (!isOpen(maze, Math.floor(q.exit.x), q.exit.y) || !isOpen(maze, Math.ceil(q.exit.x), q.exit.y) || !seen[q.exit.y * MW + Math.floor(q.exit.x)]) fail('house_exit', `the house at (${q.x0},${q.y0}) exits onto no reachable corridor`);
  }
  const b = maze.bonusAt;
  if (b && (!isOpen(maze, Math.floor(b.x), b.y) || !isOpen(maze, Math.ceil(b.x), b.y))) fail('bonus_spot', 'the bonus spot is not on a corridor');
  // Tunnels: both mouths open on every tunnel row, and only there.
  for (let y = 0; y < MH; y++) {
    const l = cells[y * MW] === OPEN, rr = cells[y * MW + MW - 1] === OPEN, listed = maze.tunnels.includes(y);
    if (l !== rr) fail('tunnel_mismatch', `row ${y} opens on one side only`);
    if (l && !listed) fail('tunnel_unlisted', `row ${y} opens at the edge but is not a tunnel`);
    if (listed && !l) fail('tunnel_closed', `tunnel row ${y} is walled off`);
  }
  if (expect.tunnels != null && maze.tunnels.length !== expect.tunnels) fail('tunnel_count', `expected ${expect.tunnels} tunnels, found ${maze.tunnels.length}`);
  return problems;
}
