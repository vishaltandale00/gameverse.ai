// Discrete boards for grid spaces, one generator with four kinds:
// - match: piece fills for swap/match games. fillNoMatch draws each cell from
//   the weighted pieces excluding any that would complete a run of
//   `matchLength`; the proof re-scans for runs and requires at least one swap
//   that makes a match (`ensureMove`), reshuffling with a sub-seed otherwise.
// - tactics: weighted terrain with obstacles, optional mirror/rotational
//   symmetry for fairness and deploy strips per team; proof: every open cell
//   connected (closed pockets are filled) and every deploy strip reachable.
// - lanes: bases at opposite corners joined by `lanes` corridors through a
//   filled field (MOBA/tower-defense); proof: each lane alone joins the bases.
// - hex-continent: odd-r offset hexes; continents grown from seeds to a land
//   fraction, biomes by coast distance and moisture noise, player starts
//   spread by farthest-point picks; proof: starts on land, spaced, each with
//   enough land on its continent.
// Pieces, terrain and biomes are data (block ids); empty/open is null.
import { withDefaults, drawSeed, stream, Raster, spaceOf, cellWriter, addZones, publish, problem } from './generate2d-lib.js';

const ID = 'engine.generate.grid.board';
const piece = { type: 'object', fields: { piece: { type: 'string', required: true }, weight: { type: 'number', min: 0, default: 1 } } };
const terrain = { type: 'object', fields: { block: { type: 'string', required: true }, weight: { type: 'number', min: 0, default: 1 }, blocks: { type: 'boolean', default: false, effect: 'impassable' } } };
const biome = { type: 'object', fields: { block: { type: 'string', required: true }, elevation: { type: 'list', of: { type: 'number' }, min: 2, max: 2, default: [0, 1] }, moisture: { type: 'list', of: { type: 'number' }, min: 2, max: 2, default: [0, 1] }, blocks: { type: 'boolean', default: false } } };

export const HEX_DIRS = { even: [[1, 0], [-1, 0], [0, -1], [-1, -1], [0, 1], [-1, 1]], odd: [[1, 0], [-1, 0], [1, -1], [0, -1], [1, 1], [0, 1]] };
export const hexNeighbors = (x, y) => HEX_DIRS[y & 1 ? 'odd' : 'even'].map(([dx, dy]) => [x + dx, y + dy]);
const sqNeighbors = (x, y) => [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
const hexDist = (a, b) => { const cube = ([x, y]) => { const q = x - (y - (y & 1)) / 2; return [q, y, -q - y]; }; const p = cube(a), q = cube(b); return Math.max(...p.map((v, i) => Math.abs(v - q[i]))); };

export default {
  id: ID,
  card: {
    intent: 'Generates grid boards: match-3 fills with no initial matches and a guaranteed move, symmetric tactics maps with deploy zones, lane fields joining two bases, and hex continents with spread starts; each kind proves its guarantee.',
    views: ['board', 'td', 'iso'],
    params: {
      kind: { type: 'string', options: ['tactics', 'lanes', 'match', 'hex-continent'], default: 'tactics' },
      size: { type: 'list', of: { type: 'integer', min: 2, max: 256 }, min: 2, max: 2, effect: 'board [w,h]; default: the space size' },
      origin: { type: 'list', of: { type: 'integer' }, default: [0, 0] },
      fill: { type: 'list', of: piece, default: [{ piece: 'red' }, { piece: 'blue' }, { piece: 'green' }, { piece: 'yellow' }, { piece: 'purple' }], effect: 'match: weighted pieces' },
      fillNoMatch: { type: 'boolean', default: true }, matchLength: { type: 'integer', min: 2, max: 6, default: 3 }, ensureMove: { type: 'boolean', default: true },
      terrain: { type: 'list', of: terrain, default: [{ block: 'rock', weight: 1, blocks: true }, { block: 'forest', weight: 2 }], effect: 'tactics: obstacle/feature terrain' },
      density: { type: 'number', min: 0, max: 0.8, default: 0.18, effect: 'tactics: share of cells given terrain; lanes: field fill' },
      symmetry: { type: 'string', options: ['none', 'mirror', 'rotate'], default: 'rotate' },
      teams: { type: 'integer', min: 1, max: 4, default: 2 }, deployDepth: { type: 'integer', min: 1, max: 8, default: 2 },
      lanes: { type: 'integer', min: 1, max: 5, default: 3 }, laneWidth: { type: 'integer', min: 1, max: 4, default: 1 }, wall: { type: 'string', default: 'jungle', effect: 'lanes: field block' },
      continents: { type: 'integer', min: 1, max: 12, default: 2 }, land: { type: 'number', min: 0.1, max: 0.9, default: 0.45 },
      water: { type: 'string', default: 'ocean' },
      biomes: { type: 'list', of: biome, default: [{ block: 'coast', elevation: [0, 0.15] }, { block: 'desert', elevation: [0.15, 0.7], moisture: [0, 0.3] }, { block: 'plains', elevation: [0.15, 0.7], moisture: [0.3, 0.65] }, { block: 'forest', elevation: [0.15, 0.7], moisture: [0.65, 1] }, { block: 'hills', elevation: [0.7, 0.9] }, { block: 'mountain', elevation: [0.9, 1], blocks: true }] },
      starts: { type: 'integer', min: 0, max: 16, default: 2 }, minStartDistance: { type: 'integer', min: 1, max: 64, default: 6 }, landPerStart: { type: 'integer', min: 1, default: 20 },
      attempts: { type: 'integer', min: 0, max: 16, default: 8 },
    },
    provides: { events: ['generated', 'generated:*', 'generate_problem'], services: ['generation', 'board'] },
    requires: { capabilities: ['position', 'editCells'] },
    problems: ['board_has_match', 'board_no_move', 'cells_disconnected', 'deploy_unreachable', 'lane_broken', 'start_on_water', 'start_crowded', 'start_land_short', 'board_fallback'],
    validates: ['board_size_missing', 'board_pieces_few', 'board_terrain_open'],
  },
  validate(raw, doc, ctx, inst = {}) {
    const config = withDefaults(this.card, raw);
    const errors = [], sp = doc.spaces.find(s => s.id === inst.space) || doc.spaces.find(s => (s.generators || []).some(g => g.use === ID));
    if (!config.size && !Array.isArray(sp?.with?.size)) errors.push(problem('board_size_missing', 'size', 'give size or bind to a space with a size'));
    if (config.kind === 'match' && config.fillNoMatch && config.fill.filter(p => p.weight > 0).length < 3) errors.push(problem('board_pieces_few', 'fill', 'a no-match fill needs at least 3 pieces'));
    if (config.kind === 'tactics' && !config.terrain.length) errors.push(problem('board_terrain_open', 'terrain', 'tactics boards need terrain'));
    return errors;
  },
  install(rt, raw, instance) {
    const config = withDefaults(this.card, raw), space = spaceOf(rt, instance), seed = drawSeed(rt);
    const [W, H] = config.size || space.size || [8, 8], [ox, oy] = config.origin;
    const gen = { match, tactics, lanes, 'hex-continent': hex }[config.kind];
    let best = null;
    for (let attempt = 0; attempt <= config.attempts; attempt++) {
      const res = gen(config, W, H, stream(seed, config.kind, attempt), attempt === config.attempts);
      if (!best || res.problems.length < best.problems.length) best = { ...res, attempts: attempt + 1, fallback: attempt === config.attempts };
      if (!res.problems.length) break;
    }
    if (best.problems.length) best.problems.unshift(problem('board_fallback', 'kind', `no clean '${config.kind}' board in ${config.attempts} attempts; kept the best`));
    const writer = cellWriter(rt, space);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) writer.set([ox + x, oy + y], best.grid.get(x, y));
    writer.flush();
    addZones(rt, space, (best.zones || []).map(z => ({ ...z, rect: [z.rect[0] + ox, z.rect[1] + oy, z.rect[2] + ox, z.rect[3] + oy] })));
    const st = () => rt.store(instance.key);
    const { grid, ...rest } = best;
    publish(rt, instance, space, ID, { ...rest, kind: config.kind, size: [W, H], origin: [ox, oy], starts: (best.starts || []).map(([x, y]) => [x + ox, y + oy]) }, { board: {
      kind: () => config.kind, size: () => st().size, starts: () => st().starts, lanes: () => st().lanes, problems: () => st().problems,
      neighbors: at => (config.kind === 'hex-continent' ? hexNeighbors : sqNeighbors)(at[0] - ox, at[1] - oy).filter(([x, y]) => x >= 0 && y >= 0 && x < W && y < H).map(([x, y]) => [x + ox, y + oy]),
      findMatches: () => runs(readGrid(space.api, W, H, ox, oy), config.matchLength), hasMove: () => hasMove(readGrid(space.api, W, H, ox, oy), config.matchLength),
    } });
  },
};

const readGrid = (api, W, H, ox, oy) => { const g = new Raster(W, H, null); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) g.set(x, y, api.getCell([ox + x, oy + y])); return g; };

/** Runs of ≥ n equal non-null cells: [{cells:[[x,y]..], piece}]. */
export function runs(g, n) {
  const out = [];
  for (const [dx, dy] of [[1, 0], [0, 1]]) for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const v = g.get(x, y); if (v == null || g.get(x - dx, y - dy) === v) continue;
    let k = 0; while (g.get(x + dx * k, y + dy * k) === v) k++;
    if (k >= n) out.push({ piece: v, cells: Array.from({ length: k }, (_, i) => [x + dx * i, y + dy * i]) });
  }
  return out;
}
/** First adjacent swap that creates a run, or null. */
export function hasMove(g, n) {
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) for (const [dx, dy] of [[1, 0], [0, 1]]) {
    const a = g.get(x, y), b = g.get(x + dx, y + dy); if (a == null || b == null || a === b) continue;
    g.set(x, y, b); g.set(x + dx, y + dy, a); const hit = runs(g, n).length > 0; g.set(x, y, a); g.set(x + dx, y + dy, b);
    if (hit) return [[x, y], [x + dx, y + dy]];
  }
  return null;
}

function match(config, W, H, r) {
  const g = new Raster(W, H, null), pieces = config.fill.filter(p => p.weight > 0), n = config.matchLength;
  const makes = (x, y, v) => [[1, 0], [0, 1]].some(([dx, dy]) => { let k = 1; for (let i = 1; g.get(x - dx * i, y - dy * i) === v; i++) k++; return k >= n; });
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ok = config.fillNoMatch ? pieces.filter(p => !makes(x, y, p.piece)) : pieces;
    g.set(x, y, r.weighted(ok.length ? ok : pieces).piece);
  }
  const problems = [];
  if (config.fillNoMatch && runs(g, n).length) problems.push(problem('board_has_match', 'fill', `the fill starts with ${runs(g, n).length} matches`));
  if (config.ensureMove && !hasMove(g, n)) problems.push(problem('board_no_move', 'fill', 'no swap makes a match'));
  return { grid: g, problems };
}

/** Flood fill over cells passing `open`; returns Set of 'x,y'. */
const flood = (W, H, starts, open, nb = sqNeighbors) => { const seen = new Set(), q = []; for (const [x, y] of starts) if (open(x, y)) { seen.add(`${x},${y}`); q.push([x, y]); } while (q.length) { const [x, y] = q.pop(); for (const [nx, ny] of nb(x, y)) { const k = `${nx},${ny}`; if (nx >= 0 && ny >= 0 && nx < W && ny < H && !seen.has(k) && open(nx, ny)) { seen.add(k); q.push([nx, ny]); } } } return seen; };

function tactics(config, W, H, r, plain) {
  const g = new Raster(W, H, null), blocking = new Set(config.terrain.filter(t => t.blocks).map(t => t.block)), D = config.deployDepth;
  const mirrorOf = (x, y) => (config.symmetry === 'mirror' ? [[W - 1 - x, y]] : config.symmetry === 'rotate' ? [[W - 1 - x, H - 1 - y]] : []);
  const deploy = Array.from({ length: config.teams }, (_, t) => (t === 0 ? [0, 0, W, D] : t === 1 ? [0, H - D, W, H] : t === 2 ? [0, 0, D, H] : [W - D, 0, W, H]));
  const inDeploy = (x, y) => deploy.some(d => x >= d[0] && y >= d[1] && x < d[2] && y < d[3]);
  const density = plain ? config.density / 2 : config.density;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (g.get(x, y) != null || inDeploy(x, y) || !r.chance(density)) continue;
    const t = r.weighted(config.terrain).block; g.set(x, y, t); for (const [mx, my] of mirrorOf(x, y)) if (!inDeploy(mx, my)) g.set(mx, my, t);
  }
  const open = (x, y) => !blocking.has(g.get(x, y));
  const main = flood(W, H, [[Math.floor(W / 2), 0], ...Array.from({ length: W }, (_, x) => [x, 0])], open);
  // Closed pockets become obstacles (they could never be entered); a broken board stays broken for the proof.
  const fillBlock = [...blocking][0];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (open(x, y) && !main.has(`${x},${y}`) && !inDeploy(x, y) && fillBlock) g.set(x, y, fillBlock);
  const problems = [], reach = flood(W, H, [[0, 0]], open);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (open(x, y) && !reach.has(`${x},${y}`)) { problems.push(problem('cells_disconnected', 'terrain', `open cell (${x},${y}) is cut off`)); y = H; break; }
  deploy.forEach((d, t) => { let ok = false; for (let y = d[1]; y < d[3] && !ok; y++) for (let x = d[0]; x < d[2] && !ok; x++) ok = reach.has(`${x},${y}`); if (!ok) problems.push(problem('deploy_unreachable', `teams`, `team ${t + 1}'s deploy strip is cut off`)); });
  return { grid: g, problems, zones: deploy.map((d, t) => ({ id: `deploy_${t + 1}`, name: `Team ${t + 1} deploy`, rect: d, tags: ['deploy'] })) };
}

function lanes(config, W, H, r) {
  const g = new Raster(W, H, config.wall), lw = config.laneWidth, B = Math.max(2, Math.min(4, Math.floor(Math.min(W, H) / 5)));
  const carve = (x, y) => { for (let j = 0; j < lw; j++) for (let i = 0; i < lw; i++) g.set(x + i, y + j, null); };
  g.rect(0, 0, B, B, null); g.rect(W - B, H - B, B, B, null);
  const laneCells = [];
  // Lane k bends through waypoint k of a fan from the top-left corner to the bottom-right one.
  for (let k = 0; k < config.lanes; k++) {
    const f = config.lanes === 1 ? 0.5 : k / (config.lanes - 1), wx = Math.round((W - lw) * (1 - f)), wy = Math.round((H - lw) * f);
    const way = [[B - 1, B - 1], [clampI(wx + r.range(-1, 1), 0, W - lw), clampI(wy + r.range(-1, 1), 0, H - lw)], [W - B, H - B]], cells = new Set();
    for (let s = 1; s < way.length; s++) { let [x, y] = way[s - 1]; const [tx, ty] = way[s]; while (x !== tx || y !== ty) { carve(x, y); for (let j = 0; j < lw; j++) for (let i = 0; i < lw; i++) cells.add(`${x + i},${y + j}`); if (x !== tx && (y === ty || r.chance(0.5))) x += Math.sign(tx - x); else y += Math.sign(ty - y); } carve(x, y); for (let j = 0; j < lw; j++) for (let i = 0; i < lw; i++) cells.add(`${x + i},${y + j}`); }
    laneCells.push(cells);
  }
  // Field noise: open a few clearings off the lanes (jungle camps) without touching the lanes.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g.get(x, y) != null && r.chance((1 - config.density) * 0.15)) g.set(x, y, null);
  const problems = [], inBase = (x, y, b) => (b ? x >= W - B && y >= H - B : x < B && y < B);
  laneCells.forEach((cells, k) => {
    const open = (x, y) => (cells.has(`${x},${y}`) || inBase(x, y, 0) || inBase(x, y, 1)) && g.get(x, y) == null;
    const seen = flood(W, H, [[0, 0]], open);
    if (!seen.has(`${W - 1},${H - 1}`)) problems.push(problem('lane_broken', `lanes`, `lane ${k + 1} does not join the bases`));
  });
  return { grid: g, problems, lanes: laneCells.map(c => [...c].map(k => k.split(',').map(Number))), zones: [{ id: 'base_1', name: 'Base 1', rect: [0, 0, B, B], tags: ['base'] }, { id: 'base_2', name: 'Base 2', rect: [W - B, H - B, W, H], tags: ['base'] }] };
}
const clampI = (v, a, b) => Math.max(a, Math.min(b, v));

function hex(config, W, H, r) {
  const land = new Raster(W, H, -1), target = Math.round(W * H * config.land), seeds = [];
  for (let c = 0; c < config.continents; c++) { const x = r.range(1, W - 2), y = r.range(1, H - 2); seeds.push([x, y]); land.set(x, y, c); }
  // Grow continents in turn from their frontier; a continent never touches another (one water hex apart).
  const front = seeds.map(s => [s]);
  for (let n = seeds.length; n < target && front.some(f => f.length);) {
    for (let c = 0; c < front.length && n < target; c++) {
      const f = front[c]; if (!f.length) continue;
      const i = r.int(f.length), [x, y] = f[i], opts = hexNeighbors(x, y).filter(([nx, ny]) => nx > 0 && ny > 0 && nx < W - 1 && ny < H - 1 && land.get(nx, ny) === -1 && hexNeighbors(nx, ny).every(([ax, ay]) => land.get(ax, ay, -1) === -1 || land.get(ax, ay) === c));
      if (!opts.length) { f.splice(i, 1); continue; }
      const [nx, ny] = r.pick(opts); land.set(nx, ny, c); f.push([nx, ny]); n++;
    }
  }
  // Elevation from distance to the coast; moisture from smoothed noise.
  const dist = new Raster(W, H, 0), q = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (land.get(x, y) >= 0 && hexNeighbors(x, y).some(([a, b]) => land.get(a, b, -1) < 0)) { dist.set(x, y, 1); q.push([x, y]); }
  for (let i = 0; i < q.length; i++) { const [x, y] = q[i]; for (const [a, b] of hexNeighbors(x, y)) if (land.get(a, b, -1) >= 0 && !dist.get(a, b)) { dist.set(a, b, dist.get(x, y) + 1); q.push([a, b]); } }
  const maxD = Math.max(1, ...dist.cells), moist = new Raster(W, H, 0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) moist.set(x, y, r());
  for (let it = 0; it < 3; it++) { const c = moist.cells.slice(); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const ns = hexNeighbors(x, y).filter(([a, b]) => moist.in(a, b)); c[y * W + x] = (moist.get(x, y) + ns.reduce((s, [a, b]) => s + moist.get(a, b), 0)) / (ns.length + 1); } moist.cells = c; }
  const [mlo, mhi] = [Math.min(...moist.cells), Math.max(...moist.cells)];
  const g = new Raster(W, H, config.water), blocking = new Set(config.biomes.filter(b => b.blocks).map(b => b.block));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (land.get(x, y) < 0) continue;
    const e = (dist.get(x, y) - 1) / Math.max(1, maxD - 1), m = (moist.get(x, y) - mlo) / Math.max(1e-9, mhi - mlo);
    const b = config.biomes.find(b => e >= b.elevation[0] && e <= b.elevation[1] && m >= b.moisture[0] && m <= b.moisture[1]) || config.biomes.find(b => !b.blocks) || config.biomes[0];
    g.set(x, y, b?.block ?? 'land');
  }
  // Starts: farthest-point picks over walkable land, largest continents first.
  const walk = (x, y) => land.get(x, y, -1) >= 0 && !blocking.has(g.get(x, y));
  const cand = []; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (walk(x, y)) cand.push([x, y]);
  const starts = [];
  if (cand.length) starts.push(cand[r.int(cand.length)]);
  while (starts.length < config.starts && cand.length) { let best = null, bd = -1; for (const c of cand) { const d = Math.min(...starts.map(s => hexDist(s, c))); if (d > bd) { bd = d; best = c; } } if (!best || bd === 0) break; starts.push(best); }
  const problems = [], size = new Map();
  for (const v of land.cells) if (v >= 0) size.set(v, (size.get(v) || 0) + 1);
  starts.forEach((s, i) => {
    if (!walk(...s)) problems.push(problem('start_on_water', 'starts', `start ${i + 1} is not on walkable land`));
    for (let j = 0; j < i; j++) if (hexDist(s, starts[j]) < config.minStartDistance) problems.push(problem('start_crowded', 'starts', `starts ${j + 1} and ${i + 1} are ${hexDist(s, starts[j])} apart (< ${config.minStartDistance})`));
    const c = land.get(...s), sharing = starts.filter(t => land.get(...t) === c).length;
    if ((size.get(c) || 0) / sharing < config.landPerStart) problems.push(problem('start_land_short', 'starts', `start ${i + 1} has ${Math.floor((size.get(c) || 0) / sharing)} land hexes (< ${config.landPerStart})`));
  });
  if (starts.length < config.starts) problems.push(problem('start_crowded', 'starts', `only ${starts.length} of ${config.starts} starts fit`));
  return { grid: g, problems, starts, continents: [...size.entries()].map(([id, n]) => ({ id, size: n })), zones: starts.map(([x, y], i) => ({ id: `start_${i + 1}`, name: `Start ${i + 1}`, rect: [x, y, x + 1, y + 1], tags: ['start'] })) };
}
