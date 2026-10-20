// Mirrored lattice mazes (Pac-Man family), ported from the maze kit with its
// guarantees: mirrored left to right; corridors exactly one tile wide (no 2×2
// open block) and no dead ends; hunter houses with doors, each ringed by a
// corridor (one at the classic size, more at larger sizes, on the axis or as
// mirrored pairs); wrapping side tunnels; every pellet reachable from the start.
// Corridors run along a lattice of columns and rows spaced ≥3 apart; the left
// half's lattice graph starts complete and edges are removed at random while
// every node keeps degree ≥2 and the half stays connected; the right half is
// the mirror. checkMaze() re-proves every invariant on the raster; a failing
// sub-seed is retried and the complete lattice (density 1) is the fallback.
// Sizes, styles and house layouts are data. Maze rows run top-down; `yUp`
// flips them into a y-up space.
import { withDefaults, drawSeed, spaceOf, cellWriter, addZones, publish, spawnAt, placeOn, problem } from './generate2d-lib.js';
import { seedFrom } from '../../kernel/rng.js';

const ID = 'engine.generate.grid.maze';
export const WALL = 0, OPEN = 1, DOOR = 2, HOUSE = 3, HOUSE_WALL = 4;
const HOUSE_W = 8, HOUSE_H = 5;
export const SIZES = {
  classic: { w: 28, h: 31, houses: [{ axis: true, cy: 0.5 }] },
  large: { w: 44, h: 47, houses: [{ axis: true, cy: 0.3 }, { axis: true, cy: 0.7 }] },
  huge: { w: 60, h: 63, houses: [{ axis: false, cy: 0.27 }, { axis: true, cy: 0.72 }] },
  vast: { w: 92, h: 95, houses: [{ axis: false, cy: 0.2 }, { axis: true, cy: 0.5 }, { axis: false, cy: 0.8 }] },
};
/** Lattice spacing per style; `inner` is the chance of the extra column next to the centre. */
export const STYLES = { classic: { gaps: [3, 4, 5], inner: 0.5 }, compact: { gaps: [3, 4], inner: 0.85 }, sprawling: { gaps: [4, 5, 6, 8], inner: 0.2 } };
const CLASSIC_AREA = 28 * 31;

function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function compositions(total, parts) {
  const out = [], rec = (left, acc) => { if (out.length > 400) return; if (left === 0) { out.push(acc); return; } for (const p of parts) if (p <= left) rec(left - p, [...acc, p]); };
  rec(total, []); return out;
}
function lines(from, to, parts, r) {
  let options = compositions(to - from, parts);
  if (!options.length) options = compositions(to - from, [3, 4, 5, 6, 7, 8, 9, 10]);
  const pick = options[Math.floor(r() * options.length)], out = [from];
  for (const g of pick) out.push(out[out.length - 1] + g);
  return out;
}
export const wrapX = (x, w) => ((x % w) + w) % w;

/** Power pellets: the classic-size count (even, 2..6), scaled with area at larger sizes. */
export function powerCountFor(powerPellets, dims, classic) {
  const base = Math.min(6, Math.max(2, 2 * Math.round((powerPellets ?? 4) / 2)));
  return classic ? base : 2 * Math.round((base * (dims.w * dims.h) / CLASSIC_AREA) / 2);
}

/** Houses for a size: wall rect, door, exit above the door, centre and hunter slots. */
export function housesFor(spec) {
  const { w, h } = spec, out = [];
  for (const q of spec.houses) {
    const y0 = Math.round(q.cy * (h - 1)) - 3, left = Math.round(w / 4) - 4;
    for (const x0 of q.axis ? [w / 2 - 4] : [left, w - left - HOUSE_W]) {
      const x1 = x0 + HOUSE_W - 1, y1 = y0 + HOUSE_H - 1, cx = x0 + 3.5, cy = y0 + 2;
      out.push({ axis: q.axis, side: q.axis ? 0 : x0 < w / 2 ? -1 : 1, x0, x1, y0, y1, door: [[x0 + 3, y0], [x0 + 4, y0]], exit: { x: cx, y: y0 - 1 }, center: { x: cx, y: cy },
        slots: [{ x: cx, y: y0 - 1 }, { x: cx, y: cy }, { x: cx - 2, y: cy }, { x: cx + 2, y: cy }, { x: cx - 1, y: cy }, { x: cx + 1, y: cy }] });
    }
  }
  return out;
}

/** Build a maze. params: { size, style, density, tunnels, powerPellets, sizes?, styles? }. Pure data out. */
export function buildMaze(params = {}, seed = 1) {
  const sizes = { ...SIZES, ...(params.sizes || {}) }, styles = { ...STYLES, ...(params.styles || {}) };
  const size = sizes[params.size] ? params.size : 'classic', spec = sizes[size], { w: MW, h: MH } = spec;
  const style = styles[params.style] ? params.style : 'classic';
  const density = Math.min(1, Math.max(0, Number.isFinite(params.density) ? params.density : 0.6));
  const tunnels = Math.min(2, Math.max(1, Math.round(params.tunnels ?? 1)));
  const powerCount = powerCountFor(params.powerPellets, spec, size === 'classic');
  const r = mulberry(typeof seed === 'number' ? seed : seedFrom(seed));
  const { gaps, inner } = styles[style], mirror = x => MW - 1 - x;
  const houses = housesFor(spec), leftHouses = houses.filter(q => q.side <= 0), axisHouses = houses.filter(q => q.axis);
  const main = [...axisHouses].sort((a, b) => Math.abs(a.center.y - (MH - 1) / 2) - Math.abs(b.center.y - (MH - 1) / 2) || b.center.y - a.center.y)[0];
  // Lattice columns: forced at x=1 and every house ring column, random lines between.
  const forcedX = [...new Set([1, ...leftHouses.flatMap(q => (q.axis ? [q.x0 - 1] : [q.x0 - 1, q.x1 + 1]))])].sort((a, b) => a - b);
  const xs = [forcedX[0]];
  for (let i = 0; i + 1 < forcedX.length; i++) xs.push(...lines(forcedX[i], forcedX[i + 1], gaps, r).slice(1));
  if (r() < inner) xs.push(MW / 2 - 2);
  // Rows: forced at the house rings (with the house's middle row between), random lines elsewhere.
  const spans = [...new Map(houses.map(q => [q.y0, [q.y0 - 1, q.y0 + 2, q.y1 + 1]])).values()].sort((a, b) => a[0] - b[0]);
  const ys = [1];
  let at = 1;
  for (const [topRow, middle, bottom] of spans) { ys.push(...lines(at, topRow, gaps, r).slice(1), middle, bottom); at = bottom; }
  ys.push(...lines(at, MH - 2, gaps, r).slice(1));
  const xl = xs[xs.length - 1];
  const inHouse = (x, y) => leftHouses.some(q => x >= q.x0 && x <= q.x1 && y >= q.y0 && y <= q.y1);
  const houseRows = new Set(spans.flat()), key = (x, y) => `${x},${y}`, nodes = new Map();
  for (const y of ys) for (const x of xs) if (!inHouse(x, y)) nodes.set(key(x, y), { x, y });
  const blocked = (x0, y0, x1, y1) => { for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) if (inHouse(x, y)) return true; return false; };
  // Edges: h/v join two left-half nodes; c crosses the centre to the node's mirror; t is a tunnel.
  const edges = [];
  for (const y of ys) {
    for (let i = 0; i + 1 < xs.length; i++) { const a = key(xs[i], y), b = key(xs[i + 1], y); if (nodes.has(a) && nodes.has(b) && !blocked(xs[i], y, xs[i + 1], y)) edges.push({ kind: 'h', a, b, x0: xs[i], x1: xs[i + 1], y }); }
    if (nodes.has(key(xl, y)) && !blocked(xl, y, mirror(xl), y)) edges.push({ kind: 'c', a: key(xl, y), b: null, x0: xl, x1: mirror(xl), y });
  }
  for (const x of xs) for (let j = 0; j + 1 < ys.length; j++) { const a = key(x, ys[j]), b = key(x, ys[j + 1]); if (nodes.has(a) && nodes.has(b) && !blocked(x, ys[j], x, ys[j + 1])) edges.push({ kind: 'v', a, b, x, y0: ys[j], y1: ys[j + 1] }); }
  // The start: a centre crossing nearest the middle (row 23 classic), clear of the houses.
  const target = size === 'classic' ? 23 : Math.round((MH - 1) / 2), crossing = new Set(edges.filter(e => e.kind === 'c').map(e => e.y));
  const startRow = ys.filter(y => y > 1 && y < MH - 2 && !houseRows.has(y) && crossing.has(y) && (size !== 'classic' || y > main.y1 + 1)).sort((p, q) => Math.abs(p - target) - Math.abs(q - target) || p - q)[0] ?? ys[ys.length - 1];
  const tunnelRows = [main.center.y];
  if (tunnels > 1) { const options = ys.filter(y => y !== 1 && y !== MH - 2 && !houseRows.has(y) && y !== startRow); if (options.length) tunnelRows.push(options[Math.floor(r() * options.length)]); }
  for (const y of tunnelRows) edges.push({ kind: 't', a: key(xs[0], y), b: null, y, required: true });
  for (const e of edges) {
    for (const q of leftHouses) {
      const ring = y => y === q.y0 - 1 || y === q.y1 + 1;
      if (e.kind === 'h' && ring(e.y) && e.x0 >= q.x0 - 1 && (q.axis || e.x1 <= q.x1 + 1)) e.required = true;
      if (e.kind === 'c' && q.axis && ring(e.y)) e.required = true;
      if (e.kind === 'v' && (e.x === q.x0 - 1 || (!q.axis && e.x === q.x1 + 1)) && e.y0 >= q.y0 - 1 && e.y1 <= q.y1 + 1) e.required = true;
    }
    if (e.kind === 'c' && e.y === startRow) e.required = true;
  }
  const live = new Set(edges), degree = new Map([...nodes.keys()].map(k => [k, 0]));
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
  const cells = new Array(MW * MH).fill(WALL), open = (x, y) => { cells[y * MW + x] = OPEN; cells[y * MW + mirror(x)] = OPEN; };
  for (const e of live) {
    if (e.kind === 'h' || e.kind === 'c') for (let x = e.x0; x <= e.x1; x++) open(x, e.y);
    else if (e.kind === 'v') for (let y = e.y0; y <= e.y1; y++) open(e.x, y);
    else for (let x = 0; x <= xs[0]; x++) open(x, e.y);
  }
  for (const q of houses) {
    for (let y = q.y0; y <= q.y1; y++) for (let x = q.x0; x <= q.x1; x++) cells[y * MW + x] = y === q.y0 || y === q.y1 || x === q.x0 || x === q.x1 ? HOUSE_WALL : HOUSE;
    for (const [x, y] of q.door) cells[y * MW + x] = DOOR;
  }
  // Pellets on every corridor tile except house rings, tunnel mouths and the start; power pellets by farthest-point picks.
  const start = { x: MW / 2 - 0.5, y: startRow }, pellets = [];
  const inRing = (x, y) => houses.some(q => x >= q.x0 - 1 && x <= q.x1 + 1 && y >= q.y0 - 1 && y <= q.y1 + 1);
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    if (cells[y * MW + x] !== OPEN || inRing(x, y) || x === 0 || x === MW - 1 || (y === startRow && (x === MW / 2 - 1 || x === MW / 2))) continue;
    pellets.push(y * MW + x);
  }
  const left = pellets.filter(i => i % MW < MW / 2), picks = [], picked = new Set();
  const d2 = (i, x, y) => (i % MW - x) ** 2 + (Math.floor(i / MW) - y) ** 2;
  for (let n = 0; n < powerCount / 2 && left.length; n++) {
    let best = -1, bestScore = -1;
    for (const i of left) { if (picked.has(i)) continue; let score = d2(i, main.center.x, main.center.y) * (picks.length ? 0.35 : 1); for (const p of picks) score = Math.min(score, d2(i, p % MW, Math.floor(p / MW))); if (score > bestScore) { bestScore = score; best = i; } }
    if (best < 0) break; picks.push(best); picked.add(best);
  }
  const power = picks.flatMap(i => { const y = Math.floor(i / MW), x = i % MW; return [i, y * MW + mirror(x)]; }).sort((a, b) => a - b);
  const noUp = [];
  for (const y of [...axisHouses.map(q => q.y0 - 1), startRow]) for (const x of [xl, mirror(xl)]) if (cells[(y - 1) * MW + x] === OPEN) noUp.push(y * MW + x);
  const bonusHouse = [...axisHouses].sort((a, b) => Math.abs(a.y1 + 1 - startRow) - Math.abs(b.y1 + 1 - startRow))[0];
  return { w: MW, h: MH, size, style, density, cells, pellets, power, tunnels: tunnelRows.sort((a, b) => a - b), start, houses,
    exit: main.exit, center: main.center, slots: main.slots, bonusAt: { x: MW / 2 - 0.5, y: bonusHouse.y1 + 1 }, noUp, lattice: { xs, ys } };
}

const DX = [0, -1, 0, 1], DY = [-1, 0, 1, 0];
/** Corridor tile test with tunnel wrap (only player-passable OPEN tiles). */
export function isOpen(maze, x, y) {
  if (y < 0 || y >= maze.h) return false;
  if (x < 0 || x >= maze.w) { if (!maze.tunnels.includes(y)) return false; x = wrapX(x, maze.w); }
  return maze.cells[y * maze.w + x] === OPEN;
}
const neighbours = (maze, x, y) => { const out = []; for (let d = 0; d < 4; d++) if (isOpen(maze, x + DX[d], y + DY[d])) out.push([wrapX(x + DX[d], maze.w), y + DY[d]]); return out; };

/** Re-prove the invariants on the raster: problems as { code, path, message }. expect: { w, h, powerPellets?, tunnels? }. */
export function checkMaze(maze, expect = {}, path = 'maze') {
  const problems = [], fail = (code, message) => problems.push(problem(code, path, message));
  const { cells, w: MW, h: MH } = maze;
  if ((expect.w && MW !== expect.w) || (expect.h && MH !== expect.h) || cells.length !== MW * MH || MW % 2) { fail('maze_size', `maze must be ${expect.w}×${expect.h} with an even width`); return problems; }
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW / 2; x++) if (cells[y * MW + x] !== cells[y * MW + (MW - 1 - x)]) { fail('maze_mirror', `tile (${x},${y}) differs from its mirror`); return problems; }
  let corridors = 0;
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    if (cells[y * MW + x] !== OPEN) continue;
    corridors++;
    if (x + 1 < MW && y + 1 < MH && isOpen(maze, x + 1, y) && isOpen(maze, x, y + 1) && isOpen(maze, x + 1, y + 1)) fail('maze_wide', `corridor wider than one tile at (${x},${y})`);
    if (neighbours(maze, x, y).length < 2) fail('maze_dead_end', `dead end at (${x},${y})`);
  }
  const sx = Math.floor(maze.start.x), sy = maze.start.y;
  if (!isOpen(maze, sx, sy) || !isOpen(maze, sx + 1, sy)) fail('maze_start', 'the player start is not on a corridor');
  const seen = new Uint8Array(MW * MH), queue = [[sx, sy]];
  if (isOpen(maze, sx, sy)) seen[sy * MW + sx] = 1;
  let reached = 0;
  while (queue.length) { const [x, y] = queue.pop(); reached++; for (const [nx, ny] of neighbours(maze, x, y)) if (!seen[ny * MW + nx]) { seen[ny * MW + nx] = 1; queue.push([nx, ny]); } }
  if (reached !== corridors) fail('maze_disconnected', `${corridors - reached} corridor tiles cannot be reached from the start`);
  const unreachable = [...maze.pellets, ...maze.power].filter(i => !seen[i]);
  if (unreachable.length) fail('pellet_unreachable', `${unreachable.length} pellets cannot be reached`);
  if (!maze.pellets.length) fail('no_pellets', 'the maze has no pellets');
  const pelletSet = new Set(maze.pellets);
  for (const i of maze.power) if (!pelletSet.has(i)) fail('power_misplaced', `power pellet at tile ${i} is not on a pellet tile`);
  if (expect.powerCount != null && maze.power.length !== expect.powerCount) fail('power_count', `expected ${expect.powerCount} power pellets, found ${maze.power.length}`);
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
  for (let y = 0; y < MH; y++) {
    const l = cells[y * MW] === OPEN, rr = cells[y * MW + MW - 1] === OPEN, listed = maze.tunnels.includes(y);
    if (l !== rr) fail('tunnel_mismatch', `row ${y} opens on one side only`);
    if (l && !listed) fail('tunnel_unlisted', `row ${y} opens at the edge but is not a tunnel`);
    if (listed && !l) fail('tunnel_closed', `tunnel row ${y} is walled off`);
  }
  if (expect.tunnels != null && maze.tunnels.length !== expect.tunnels) fail('tunnel_count', `expected ${expect.tunnels} tunnels, found ${maze.tunnels.length}`);
  return problems;
}

/** Generate with retries: sub-seeds first, then the complete lattice (density 1). */
export function generateMaze(params, seed) {
  const sizes = { ...SIZES, ...(params.sizes || {}) }, spec = sizes[params.size] || SIZES.classic;
  const expect = { w: spec.w, h: spec.h, tunnels: params.tunnels, powerCount: powerCountFor(params.powerPellets, spec, (params.size || 'classic') === 'classic') };
  let best = null;
  for (let attempt = 0; attempt <= params.attempts; attempt++) {
    const fallback = attempt === params.attempts;
    const maze = buildMaze(fallback ? { ...params, density: 1 } : params, attempt ? seedFrom(`${seed}:${attempt}`) : seed);
    const problems = checkMaze(maze, expect, '');
    if (!best || problems.length < best.problems.length) best = { maze, problems, attempts: attempt + 1, fallback };
    if (!problems.length) break;
  }
  return best;
}

export default {
  id: ID,
  card: {
    intent: 'Generates a mirrored, one-tile-wide, dead-end-free maze with hunter houses, wrapping tunnels and pellets, and proves every corridor and pellet reachable from the start.',
    views: ['td', 'board'],
    params: {
      size: { type: 'string', default: 'classic', effect: `maze size: ${Object.keys(SIZES).join('|')} or a key of params.sizes` },
      style: { type: 'string', default: 'classic', effect: `corridor shape: ${Object.keys(STYLES).join('|')} or a key of params.styles` },
      density: { type: 'number', min: 0, max: 1, default: 0.6, effect: '1 keeps every lattice corridor; lower removes more (never below degree 2)' },
      tunnels: { type: 'integer', min: 1, max: 2, default: 1 },
      powerPellets: { type: 'integer', min: 2, max: 6, default: 4, effect: 'classic-size count; larger sizes scale with area' },
      sizes: { type: 'json', default: {}, effect: 'extra sizes {name:{w,h,houses:[{axis,cy}]}} (w even)' },
      styles: { type: 'json', default: {}, effect: 'extra styles {name:{gaps:[i..], inner:n}}' },
      origin: { type: 'list', of: { type: 'integer' }, default: [0, 0], effect: 'space cell of the maze corner' },
      yUp: { type: 'boolean', default: true, effect: 'maze row 0 is the top row of the space region' },
      palette: { type: 'object', default: {}, fields: { wall: { type: 'string', default: 'wall' }, houseWall: { type: 'string', default: 'house_wall' }, door: { type: 'string', default: 'house_door' } } },
      pellet: { type: 'string', default: 'pellet', effect: 'archetype spawned on pellet tiles ("" for none)' },
      power: { type: 'string', default: 'power_pellet', effect: 'archetype spawned on power-pellet tiles ("" for none)' },
      pelletCounter: { type: 'string', default: 'pellets', effect: 'collectible counter of pellets (component collectible.counter)' },
      powerCounter: { type: 'string', default: 'power_pellets', effect: 'collectible counter of power pellets' },
      placePlayer: { type: 'boolean', default: true, effect: 'move the player to the maze start when it spawns' },
      attempts: { type: 'integer', min: 0, max: 16, default: 4, effect: 'sub-seeds before the complete-lattice fallback' },
    },
    provides: { events: ['generated', 'generated:*', 'generate_problem'], services: ['generation', 'maze'] },
    requires: { capabilities: ['position', 'editCells'] },
    problems: ['maze_size', 'maze_mirror', 'maze_wide', 'maze_dead_end', 'maze_start', 'maze_disconnected', 'pellet_unreachable', 'no_pellets', 'power_misplaced', 'power_count', 'house_missing', 'house_interior', 'house_door', 'house_slot', 'house_exit', 'bonus_spot', 'tunnel_mismatch', 'tunnel_unlisted', 'tunnel_closed', 'tunnel_count'],
    validates: ['maze_size_unknown', 'maze_style_unknown', 'maze_size_invalid', 'maze_outside_space'],
  },
  validate(raw, doc, ctx, inst = {}) {
    const config = withDefaults(this.card, raw);
    const errors = [], sizes = { ...SIZES, ...config.sizes }, styles = { ...STYLES, ...config.styles }, spec = sizes[config.size];
    if (!spec) errors.push(problem('maze_size_unknown', 'size', `unknown maze size '${config.size}'`, { hint: Object.keys(sizes).join(', ') }));
    if (!styles[config.style]) errors.push(problem('maze_style_unknown', 'style', `unknown maze style '${config.style}'`, { hint: Object.keys(styles).join(', ') }));
    for (const [name, s] of Object.entries(config.sizes || {})) if (!(Number.isInteger(s?.w) && Number.isInteger(s?.h) && s.w % 2 === 0 && s.w >= 20 && s.h >= 21 && Array.isArray(s.houses) && s.houses.length))
      errors.push(problem('maze_size_invalid', `sizes.${name}`, 'a size needs an even integer w ≥ 20, integer h ≥ 21 and at least one house {axis, cy}'));
    for (const [name, s] of Object.entries(config.styles || {})) if (!(Array.isArray(s?.gaps) && s.gaps.length && s.gaps.every(g => Number.isInteger(g) && g >= 3)))
      errors.push(problem('maze_size_invalid', `styles.${name}`, 'a style needs gaps: integers ≥ 3 (walls stay ≥ 2 thick)'));
    const sp = doc.spaces.find(s => s.id === inst.space) || doc.spaces.find(s => (s.generators || []).some(g => g.use === ID)), size = sp?.with?.size;
    if (spec && size && (config.origin[0] + spec.w > size[0] || config.origin[1] + spec.h > size[1])) errors.push(problem('maze_outside_space', 'origin', `a ${spec.w}×${spec.h} maze at ${config.origin} does not fit the ${size[0]}×${size[1]} space`));
    return errors;
  },
  install(rt, raw, instance) {
    const config = withDefaults(this.card, raw), space = spaceOf(rt, instance), seed = drawSeed(rt);
    const { maze, problems, attempts, fallback } = generateMaze(config, seed);
    const [ox, oy] = config.origin, { w: MW, h: MH } = maze;
    const toAt = (x, y) => [ox + x, config.yUp ? oy + (MH - 1 - y) : oy + y];
    const fromAt = at => { const x = Math.floor(at[0]) - ox, ry = Math.round(at[1]) - oy; return [x, config.yUp ? MH - 1 - ry : ry]; };
    const block = { [WALL]: config.palette.wall, [HOUSE_WALL]: config.palette.houseWall, [DOOR]: config.palette.door };
    const writer = cellWriter(rt, space);
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) writer.set(toAt(x, y), block[maze.cells[y * MW + x]] ?? null);
    writer.flush();
    const powerSet = new Set(maze.power);
    for (const i of maze.pellets) { const arch = powerSet.has(i) ? config.power : config.pellet; if (arch) spawnAt(rt, space, arch, toAt(i % MW, Math.floor(i / MW)), { collectible: { counter: powerSet.has(i) ? config.powerCounter : config.pelletCounter, value: 1 } }); }
    const pt = p => toAt(p.x, p.y);
    addZones(rt, space, maze.houses.map((q, i) => {
      const a = toAt(q.x0, q.y0), b = toAt(q.x1, q.y1);
      return { id: `maze_house_${i + 1}`, name: `House ${i + 1}`, rect: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]) + 1, Math.max(a[1], b[1]) + 1], tags: ['maze_house'] };
    }));
    if (config.placePlayer) rt.on('spawn', d => { if (d.id !== 'player') return; const p = rt.player(); if (p?.space === space.sid) placeOn(rt, space, p, pt(maze.start).map(Math.floor)); });
    const st = () => rt.store(instance.key);
    const api = {
      size: () => [MW, MH], start: () => pt(st().start), tunnels: () => st().tunnels.map(y => toAt(0, y)[1]),
      houses: () => st().houses.map(q => ({ door: q.door.map(([x, y]) => toAt(x, y)), exit: pt(q.exit), center: pt(q.center), slots: q.slots.map(pt), axis: q.axis })),
      bonusAt: () => pt(st().bonusAt), noUp: at => { const [x, y] = fromAt(at); return st().noUp.includes(y * MW + x); },
      isOpen: at => { const [x, y] = fromAt(at), m = st(); return isOpen({ ...m, cells: m.cells }, x, y); },
      wrap: at => [ox + wrapX(Math.floor(at[0]) - ox, MW), ...at.slice(1)], toAt, fromAt, problems: () => st().problems,
    };
    publish(rt, instance, space, ID, { ...maze, problems, attempts, fallback }, { maze: api });
  },
};
