// Maze generator and structural checks for the maze kit.
//
// Content never draws a maze; it picks a style and parameters per level and this
// builds one deterministically from them and a seed. The construction guarantees
// the classic invariants, and checkMaze() re-proves them on the raster:
// - 28×31 tiles, mirrored left to right;
// - corridors exactly one tile wide (no 2×2 open block) and no dead ends;
// - a ghost house with a door in the middle, ringed by a corridor;
// - side tunnels that wrap;
// - every pellet reachable from the player's start.
//
// How: corridors run along a lattice of columns and rows spaced 3 or more tiles
// apart (so walls are at least 2 thick). The left half's lattice graph starts
// complete; edges are removed at random while every node keeps degree ≥ 2 (no dead
// ends) and the half stays connected. The right half is the mirror, joined by
// corridors that cross the centre line and by the wrapping tunnels.
import { seedFrom } from '../../kernel/rng.js';

export const W = 28, H = 31;
export const WALL = 0, OPEN = 1, DOOR = 2, HOUSE = 3, HOUSE_WALL = 4;
/** House walls (inclusive tile rect); the interior is the rect inset by one. */
export const HOUSE_RECT = { x0: 10, x1: 17, y0: 12, y1: 16 };
export const DOOR_TILES = [[13, 12], [14, 12]];
/** Positions are tile centres (tile (x, y) has its centre at (x, y)); .5 sits between two tiles. */
export const EXIT = { x: 13.5, y: 11 };
export const HOUSE_CENTER = { x: 13.5, y: 14 };
export const SLOTS = [EXIT, HOUSE_CENTER, { x: 11.5, y: 14 }, { x: 15.5, y: 14 }, { x: 12.5, y: 14 }, { x: 14.5, y: 14 }];
export const BONUS_AT = { x: 13.5, y: 17 };
/** The ring corridor around the house: no pellets inside this rect. */
const RING = { x0: 9, x1: 18, y0: 11, y1: 17 };
const RING_LEFT = 9, RING_TOP = 11, RING_BOTTOM = 17, TUNNEL_ROW = 14;

/** Lattice spacing per style; `inner` is the chance of the extra column next to the centre. */
export const STYLES = {
  classic: { gaps: [3, 4, 5], inner: 0.5 },
  compact: { gaps: [3, 4], inner: 0.85 },
  sprawling: { gaps: [4, 5, 6, 8], inner: 0.2 },
};
export const STYLE_NAMES = Object.keys(STYLES);

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

const inHouse = (x, y) => x >= HOUSE_RECT.x0 && x <= HOUSE_RECT.x1 && y >= HOUSE_RECT.y0 && y <= HOUSE_RECT.y1;
const mirror = x => W - 1 - x;
export const wrapX = x => ((x % W) + W) % W;

/**
 * Build a maze. params: { style, density 0..1, tunnels 1..2, powerPellets 2..6 (even) }.
 * Returns plain data: cells (WALL/OPEN/DOOR/HOUSE/HOUSE_WALL per tile), pellet and
 * power-pellet tile indices, tunnel rows, the player's start, no-upward-turn tiles.
 */
export function buildMaze(params = {}, seed = 1) {
  const style = STYLES[params.style] ? params.style : 'classic';
  const density = Math.min(1, Math.max(0, Number.isFinite(params.density) ? params.density : 0.6));
  const tunnels = Math.min(2, Math.max(1, Math.round(params.tunnels ?? 1)));
  const powerCount = Math.min(6, Math.max(2, 2 * Math.round((params.powerPellets ?? 4) / 2)));
  const r = mulberry(typeof seed === 'number' ? seed : seedFrom(seed));
  const { gaps, inner } = STYLES[style];

  // Lattice: columns on the left half, rows top to bottom (11 and 17 ring the house, 14 is the tunnel).
  const xs = lines(1, RING_LEFT, gaps, r);
  if (r() < inner) xs.push(12);
  const ys = [...lines(1, RING_TOP, gaps, r), TUNNEL_ROW, ...lines(RING_BOTTOM, H - 2, gaps, r)];
  const xl = xs[xs.length - 1];

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
  // Tunnels: row 14 always, plus another lattice row for two tunnels.
  const startRow = ys.filter(y => y > RING_BOTTOM && y < H - 2).sort((p, q) => Math.abs(p - 23) - Math.abs(q - 23) || p - q)[0] ?? ys[ys.length - 1];
  const tunnelRows = [TUNNEL_ROW];
  if (tunnels > 1) {
    const options = ys.filter(y => y !== 1 && y !== H - 2 && y !== RING_TOP && y !== RING_BOTTOM && y !== TUNNEL_ROW && y !== startRow);
    if (options.length) tunnelRows.push(options[Math.floor(r() * options.length)]);
  }
  for (const y of tunnelRows) edges.push({ kind: 't', a: key(xs[0], y), b: null, y, required: true });

  // Required: the ring around the house and the crossing the player starts on.
  for (const e of edges) {
    if (e.kind === 'h' && (e.y === RING_TOP || e.y === RING_BOTTOM) && e.x0 >= RING_LEFT) e.required = true;
    if (e.kind === 'c' && (e.y === RING_TOP || e.y === RING_BOTTOM || e.y === startRow)) e.required = true;
    if (e.kind === 'v' && e.x === RING_LEFT && e.y0 >= RING_TOP && e.y1 <= RING_BOTTOM) e.required = true;
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
  const cells = new Array(W * H).fill(WALL);
  const open = (x, y) => { cells[y * W + x] = OPEN; cells[y * W + mirror(x)] = OPEN; };
  for (const e of live) {
    if (e.kind === 'h' || e.kind === 'c') for (let x = e.x0; x <= e.x1; x++) open(x, e.y);
    else if (e.kind === 'v') for (let y = e.y0; y <= e.y1; y++) open(e.x, y);
    else if (e.kind === 't') for (let x = 0; x <= xs[0]; x++) open(x, e.y);
  }
  for (let y = HOUSE_RECT.y0; y <= HOUSE_RECT.y1; y++) for (let x = HOUSE_RECT.x0; x <= HOUSE_RECT.x1; x++) {
    const edge = y === HOUSE_RECT.y0 || y === HOUSE_RECT.y1 || x === HOUSE_RECT.x0 || x === HOUSE_RECT.x1;
    cells[y * W + x] = edge ? HOUSE_WALL : HOUSE;
  }
  for (const [x, y] of DOOR_TILES) cells[y * W + x] = DOOR;

  // Pellets on every corridor tile except the ring around the house, the tunnel mouths and the start.
  const start = { x: 13.5, y: startRow };
  const pellets = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (cells[y * W + x] !== OPEN) continue;
    if (x >= RING.x0 && x <= RING.x1 && y >= RING.y0 && y <= RING.y1) continue;
    if (x === 0 || x === W - 1) continue;
    if (y === startRow && (x === 13 || x === 14)) continue;
    pellets.push(y * W + x);
  }
  // Power pellets: farthest-point picks on the left half, mirrored.
  const left = pellets.filter(i => i % W < W / 2);
  const picks = [];
  const d2 = (i, x, y) => (i % W - x) ** 2 + (Math.floor(i / W) - y) ** 2;
  for (let n = 0; n < powerCount / 2 && left.length; n++) {
    let best = -1, bestScore = -1;
    for (const i of left) {
      if (picks.includes(i)) continue;
      let score = d2(i, HOUSE_CENTER.x, HOUSE_CENTER.y) * (picks.length ? 0.35 : 1);
      for (const p of picks) score = Math.min(score, d2(i, p % W, Math.floor(p / W)));
      if (score > bestScore) { bestScore = score; best = i; }
    }
    picks.push(best);
  }
  const power = picks.flatMap(i => { const y = Math.floor(i / W), x = i % W; return [i, y * W + mirror(x)]; }).sort((a, b) => a - b);

  // Classic no-upward-turn tiles: the junctions where the house ring and the start row meet the inner column.
  const noUp = [];
  for (const y of [RING_TOP, startRow]) for (const x of [xl, mirror(xl)]) if (cells[(y - 1) * W + x] === OPEN) noUp.push(y * W + x);

  return {
    w: W, h: H, style, density, seed: typeof seed === 'number' ? seed : seedFrom(seed),
    cells, pellets, power, tunnels: tunnelRows.sort((a, b) => a - b), start, exit: EXIT, center: HOUSE_CENTER,
    slots: SLOTS, bonusAt: BONUS_AT, noUp, lattice: { xs, ys },
  };
}

const DX = [0, -1, 0, 1], DY = [-1, 0, 1, 0];
/** Corridor tile test with tunnel wrap (only player-passable OPEN tiles). */
export function isOpen(maze, x, y) {
  if (y < 0 || y >= H) return false;
  if (x < 0 || x >= W) { if (!maze.tunnels.includes(y)) return false; x = wrapX(x); }
  return maze.cells[y * W + x] === OPEN;
}
const neighbours = (maze, x, y) => {
  const out = [];
  for (let d = 0; d < 4; d++) if (isOpen(maze, x + DX[d], y + DY[d])) out.push([wrapX(x + DX[d]), y + DY[d]]);
  return out;
};

/**
 * Re-prove the invariants on the raster. Returns problems as { code, path, message, hint? }.
 * expect: { powerPellets?, tunnels? } to check against the requested parameters.
 */
export function checkMaze(maze, expect = {}, path = 'maze') {
  const problems = [];
  const fail = (code, message, hint) => problems.push({ code, path, message, ...(hint ? { hint } : {}) });
  const { cells } = maze;
  if (maze.w !== W || maze.h !== H || cells.length !== W * H) { fail('maze_size', `maze must be ${W}×${H}`); return problems; }
  for (let y = 0; y < H; y++) for (let x = 0; x < W / 2; x++) {
    const a = cells[y * W + x], b = cells[y * W + mirror(x)];
    if (a !== b) { fail('maze_mirror', `tile (${x},${y}) differs from its mirror`); return problems; }
  }
  let corridors = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (cells[y * W + x] !== OPEN) continue;
    corridors++;
    if (x + 1 < W && y + 1 < H && isOpen(maze, x + 1, y) && isOpen(maze, x, y + 1) && isOpen(maze, x + 1, y + 1)) fail('maze_wide', `corridor wider than one tile at (${x},${y})`);
    if (neighbours(maze, x, y).length < 2) fail('maze_dead_end', `dead end at (${x},${y})`);
  }
  // Connectivity from the start (the start sits between two tiles).
  const sx = Math.floor(maze.start.x), sy = maze.start.y;
  if (!isOpen(maze, sx, sy) || !isOpen(maze, sx + 1, sy)) fail('maze_start', 'the player start is not on a corridor');
  const seen = new Uint8Array(W * H), queue = [[sx, sy]];
  if (isOpen(maze, sx, sy)) seen[sy * W + sx] = 1;
  let reached = 0;
  while (queue.length) {
    const [x, y] = queue.pop(); reached++;
    for (const [nx, ny] of neighbours(maze, x, y)) if (!seen[ny * W + nx]) { seen[ny * W + nx] = 1; queue.push([nx, ny]); }
  }
  if (reached !== corridors) fail('maze_disconnected', `${corridors - reached} corridor tiles cannot be reached from the start`);
  const unreachable = [...maze.pellets, ...maze.power].filter(i => !seen[i]);
  if (unreachable.length) fail('pellet_unreachable', `${unreachable.length} pellets cannot be reached`);
  if (!maze.pellets.length) fail('no_pellets', 'the maze has no pellets');
  for (const i of maze.power) if (!maze.pellets.includes(i)) fail('power_misplaced', `power pellet at tile ${i} is not on a pellet tile`);
  if (expect.powerPellets != null && maze.power.length !== expect.powerPellets) fail('power_count', `expected ${expect.powerPellets} power pellets, found ${maze.power.length}`);
  // House and door.
  for (let y = HOUSE_RECT.y0 + 1; y < HOUSE_RECT.y1; y++) for (let x = HOUSE_RECT.x0 + 1; x < HOUSE_RECT.x1; x++) if (cells[y * W + x] !== HOUSE) fail('house_interior', `house interior tile (${x},${y}) is not open`);
  for (const [x, y] of DOOR_TILES) {
    if (cells[y * W + x] !== DOOR) fail('house_door', `door tile (${x},${y}) missing`);
    if (!isOpen(maze, x, y - 1)) fail('house_door', `the door at (${x},${y}) does not open onto a corridor`);
    if (cells[(y + 1) * W + x] !== HOUSE) fail('house_door', `the door at (${x},${y}) does not lead into the house`);
  }
  for (const s of maze.slots.slice(1)) if (cells[s.y * W + Math.floor(s.x)] !== HOUSE || cells[s.y * W + Math.ceil(s.x)] !== HOUSE) fail('house_slot', `hunter slot (${s.x},${s.y}) is outside the house`);
  // Tunnels: both mouths open on every tunnel row, and only there.
  for (let y = 0; y < H; y++) {
    const l = cells[y * W] === OPEN, rr = cells[y * W + W - 1] === OPEN, listed = maze.tunnels.includes(y);
    if (l !== rr) fail('tunnel_mismatch', `row ${y} opens on one side only`);
    if (l && !listed) fail('tunnel_unlisted', `row ${y} opens at the edge but is not a tunnel`);
    if (listed && !l) fail('tunnel_closed', `tunnel row ${y} is walled off`);
  }
  if (expect.tunnels != null && maze.tunnels.length !== expect.tunnels) fail('tunnel_count', `expected ${expect.tunnels} tunnels, found ${maze.tunnels.length}`);
  return problems;
}
