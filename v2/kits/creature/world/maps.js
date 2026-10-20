// Deterministic map generation (CONTRACT.md §3). Every content area becomes a tile grid; `connects`
// become edge exits (outdoor ↔ outdoor) or doors (a town's building ↔ a gym, interior or league).
// Towns also get built-in interiors: a heal center, a mart, the mentor's lab (start town) and houses.
//
// generateMaps(content, seed) → { maps: { [mapId]: Tilemap }, warps, spawns, links }
// Tilemap: { id, area, name, kind, theme, w, h, tiles: string[], entities, signs, warps, encounter, dark }
// Generation is checked: every exit is reachable from every entrance and every trainer and item can be
// reached (generation retries with another sub-seed, then falls back to a plainer layout).
import { seedFrom, random } from '../../../kernel/rng.js';
import { indexContent, areaStages } from '../content.js';
import { T, grid, walkable, isLedge, DIRS, OPPOSITE_SIDE, SIDE_DIR } from './tiles.js';

export const MAPGEN_VERSION = 'creature-maps/0.1';
const ROOM = new Set(['gym', 'interior', 'league']);

function localRng(...parts) {
  const s = { rng: seedFrom(parts.join(':')) };
  const r = () => random(s);
  r.int = n => Math.floor(random(s) * n);
  r.range = (a, b) => a + Math.floor(random(s) * (b - a + 1));
  r.pick = list => list[Math.floor(random(s) * list.length)];
  return r;
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------- link planning

/** Undirected links between areas, typed edge or door, with per-direction gates and assigned sides. */
export function planLinks(content) {
  const { areas } = indexContent(content);
  const pairs = new Map();
  for (const a of content.areas) for (const c of a.connects || []) {
    if (!areas.has(c.to) || c.to === a.id) continue;
    const [x, y] = [a.id, c.to].sort();
    const key = `${x}|${y}`;
    const link = pairs.get(key) || { a: x, b: y, gate: {} };
    if (c.gate && (c.gate.badge || c.gate.flag)) link.gate[a.id] = c.gate;
    pairs.set(key, link);
  }
  const links = [...pairs.values()];
  for (const l of links) {
    const ka = areas.get(l.a).kind, kb = areas.get(l.b).kind;
    if (ROOM.has(ka) !== ROOM.has(kb) && (ka === 'town' || kb === 'town')) { l.type = 'door'; l.host = ka === 'town' ? l.a : l.b; l.room = l.host === l.a ? l.b : l.a; }
    else l.type = 'edge';
  }
  // Assign exit sides by walking the area graph from the start, forward edges going north first.
  const used = new Map(content.areas.map(a => [a.id, { N: 0, S: 0, E: 0, W: 0 }]));
  const seen = new Set([content.areas[0].id]), queue = [content.areas[0].id];
  const order = new Map(content.areas.map((a, i) => [a.id, i]));
  const done = new Set();
  while (queue.length) {
    const id = queue.shift();
    const mine = links.filter(l => (l.a === id || l.b === id) && !done.has(l)).sort((p, q) => order.get(p.a === id ? p.b : p.a) - order.get(q.a === id ? q.b : q.a));
    for (const l of mine) {
      done.add(l);
      const other = l.a === id ? l.b : l.a;
      if (l.type === 'edge') {
        const kid = areas.get(id).kind, kother = areas.get(other).kind;
        let side;
        if (ROOM.has(kother)) side = 'N';
        else if (ROOM.has(kid)) side = 'S';
        else {
          const forward = !seen.has(other);
          const prefs = forward ? ['N', 'E', 'W', 'S'] : ['S', 'W', 'E', 'N'];
          side = prefs.find(s => !used.get(id)[s] && !used.get(other)[OPPOSITE_SIDE[s]])
            || prefs.find(s => !used.get(other)[OPPOSITE_SIDE[s]] && used.get(id)[s] < 2) || prefs[0];
        }
        l.sides = { [id]: side, [other]: OPPOSITE_SIDE[side] };
        used.get(id)[side]++; used.get(other)[OPPOSITE_SIDE[side]]++;
      }
      if (!seen.has(other)) { seen.add(other); queue.push(other); }
    }
  }
  return links.filter(l => l.type === 'door' || l.sides);
}

// ---------------------------------------------------------------- reachability

/** Passable neighbors with ledge rules: a ledge is entered only moving down and lands one tile below. */
export function neighbors(map, x, y, blocked) {
  const out = [];
  for (const [dir, [dx, dy]] of Object.entries(DIRS)) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
    const ch = map.tiles[ny][nx];
    if (isLedge(ch)) {
      if (dir !== 'down') continue;
      const ly = ny + 1;
      if (ly < map.h && walkable(map.tiles[ly][nx]) && !blocked?.has(`${nx},${ly}`)) out.push([nx, ly]);
      continue;
    }
    if (!walkable(ch) || blocked?.has(`${nx},${ny}`)) continue;
    out.push([nx, ny]);
  }
  return out;
}

/** BFS distances from a tile; returns Map('x,y' → steps). */
export function reach(map, from, blocked) {
  const dist = new Map([[`${from[0]},${from[1]}`, 0]]);
  const q = [from];
  while (q.length) {
    const [x, y] = q.shift(), d = dist.get(`${x},${y}`);
    for (const [nx, ny] of neighbors(map, x, y, blocked)) {
      const k = `${nx},${ny}`;
      if (!dist.has(k)) { dist.set(k, d + 1); q.push([nx, ny]); }
    }
  }
  return dist;
}

const blockers = map => new Set(map.entities.filter(e => e.solid !== false).map(e => `${e.x},${e.y}`));
const adjacentReached = (dist, x, y) => [[0, -1], [0, 1], [-1, 0], [1, 0]].some(([dx, dy]) => dist.has(`${x + dx},${y + dy}`));

/** Problems with one map: exits unreachable from entrances, trainers or items unreachable. */
export function checkMap(input) {
  const problems = [];
  // Gyms are checked with the barrier lowered; the switch itself must be reachable with it raised.
  const map = input.puzzle ? { ...input, tiles: input.tiles.map(row => row.replaceAll(T.barrier, T.floor)) } : input;
  const blocked = blockers(map);
  // Gate guards stand aside once open; check with the open layout.
  for (const e of map.entities) if (e.kind === 'guard') blocked.delete(`${e.x},${e.y}`);
  const entries = [...map.openings.map(o => o.inner[0]), ...map.mats.map(m => m.inner)];
  if (!entries.length) return problems;
  const dists = entries.map(p => reach(map, p, blocked));
  entries.forEach((p, i) => entries.forEach((q, j) => { if (i !== j && !dists[i].has(`${q[0]},${q[1]}`)) problems.push({ code: 'exit_unreachable', map: map.id, from: p, to: q }); }));
  if (input.puzzle) {
    const closed = reach(input, entries[0], blocked);
    if (!closed.has(`${input.puzzle.switch.x},${input.puzzle.switch.y}`)) problems.push({ code: 'switch_unreachable', map: map.id });
  }
  for (const d of map.doors) if (!adjacentReached(dists[0], d.x, d.y) && !dists[0].has(`${d.x},${d.y + 1}`)) problems.push({ code: 'door_unreachable', map: map.id, door: d.to });
  for (const e of map.entities) {
    if (e.kind === 'guard' || e.kind === 'starter') continue;
    const ok = e.kind === 'trainer' || e.kind === 'leader' || e.kind === 'champion' || e.kind === 'item' || e.kind === 'npc' ? adjacentReached(dists[0], e.x, e.y) : true;
    if (!ok) problems.push({ code: `${e.kind}_unreachable`, map: map.id, id: e.id });
  }
  return problems;
}

// ---------------------------------------------------------------- shared pieces

const BUILDING_W = { center: 5, mart: 4, lab: 6, gym: 6, league: 6, interior: 4, house: 4 };
const ROOF = { center: 'center', mart: 'mart', lab: 'lab', gym: 'gym', league: 'gym', interior: 'house', house: 'house' };

function entity(map, local, props) {
  const e = { id: `${map.id}:${local}`, facing: 'down', solid: true, ...props };
  map.entities.push(e);
  return e;
}
function newMap(id, area, kind, w, h, fill, extra = {}) {
  const g = grid(w, h, fill);
  return { g, map: { id, area: area.id, name: extra.name || area.name, kind, theme: area.theme || '', w, h, tiles: null, entities: [], signs: {}, warps: [], openings: [], doors: [], mats: [], encounter: null, encounterRate: area.encounterRate ?? 0.1, encounters: area.encounters || [], dark: false, buildings: [], ...extra } };
}
function finish(g, map) { map.tiles = g.rows(); delete map.g; return map; }

/** Openings for exits on one side: 2-wide gaps on the border, evenly spread, with jitter. */
function placeOpenings(r, w, h, exits, { margin = 3 } = {}) {
  const out = [];
  for (const side of ['N', 'S', 'E', 'W']) {
    const list = exits.filter(e => e.side === side);
    const len = side === 'N' || side === 'S' ? w : h;
    list.forEach((ex, i) => {
      let pos = Math.floor(len * (i + 1) / (list.length + 1)) - 1;
      if (list.length === 1) pos += r.range(-Math.floor(len / 6), Math.floor(len / 6));
      pos = clamp(pos, margin, len - margin - 2);
      const tiles = [0, 1].map(k => side === 'N' ? [pos + k, 0] : side === 'S' ? [pos + k, h - 1] : side === 'E' ? [w - 1, pos + k] : [0, pos + k]);
      const [dx, dy] = DIRS[SIDE_DIR[side]];
      const inner = tiles.map(([x, y]) => [x - dx, y - dy]);
      out.push({ ...ex, tiles, inner });
    });
  }
  return out;
}

// ---------------------------------------------------------------- towns

function genTown(content, area, exits, roomDoors, r, { isStart }) {
  const want = [];
  if (isStart) want.push({ kind: 'lab' });
  for (const d of roomDoors) want.push({ kind: d.roomKind === 'interior' ? 'interior' : d.roomKind, target: d.room, gate: d.gate });
  if (area.services?.includes('heal')) want.push({ kind: 'center' });
  if (area.services?.includes('mart')) want.push({ kind: 'mart' });
  const houses = 1 + r.int(2);
  for (let i = 0; i < houses; i++) want.push({ kind: 'house', n: i + 1 });

  const H = 22;
  let W = 24, layout = null;
  while (!layout) {
    const cx = Math.floor(W / 2) - 1;
    const segs = [[2, cx - 1, 3], [cx + 2, W - 2, 3], [2, cx - 1, 11], [cx + 2, W - 2, 11]].map(([a, b, y]) => ({ x: a + 1, end: b, y }));
    const placed = [];
    let ok = true;
    for (const b of want) {
      const bw = BUILDING_W[b.kind];
      const seg = segs.find(s => s.x + bw <= s.end);
      if (!seg) { ok = false; break; }
      placed.push({ ...b, x: seg.x, y: seg.y, w: bw, h: 4 });
      seg.x += bw + 1 + (r() < 0.4 ? 1 : 0);
    }
    if (ok) layout = { cx, placed }; else W += 6;
  }
  const { cx, placed } = layout;
  const { g, map } = newMap(area.id, area, 'town', W, H, T.ground);
  // Tree border, two thick.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) g.set(x, y, T.tree);
  // Streets: two east-west rows joined by a north-south street.
  g.rect(2, 8, W - 4, 2, T.path); g.rect(2, 16, W - 4, 2, T.path); g.rect(cx, 8, 2, 10, T.path);
  // Exits.
  const openings = [];
  const bySide = s => exits.filter(e => e.side === s);
  bySide('N').forEach((ex, i) => { const x = i === 0 ? cx : clamp(cx - 6 * i, 3, W - 5); g.rect(x, 0, 2, 8, T.path); openings.push({ ...ex, tiles: [[x, 0], [x + 1, 0]], inner: [[x, 1], [x + 1, 1]], lane: { x, y0: 2, axis: 'v' } }); });
  bySide('S').forEach((ex, i) => { const x = i === 0 ? cx : clamp(cx + 6 * i, 3, W - 5); g.rect(x, 17, 2, H - 17, T.path); openings.push({ ...ex, tiles: [[x, H - 1], [x + 1, H - 1]], inner: [[x, H - 2], [x + 1, H - 2]], lane: { x, y0: H - 3, axis: 'v' } }); });
  bySide('E').forEach((ex, i) => { const y = i % 2 === 0 ? 8 : 16; g.rect(W - 2, y, 2, 2, T.path); openings.push({ ...ex, tiles: [[W - 1, y], [W - 1, y + 1]], inner: [[W - 2, y], [W - 2, y + 1]], lane: { y, x0: W - 3, axis: 'h' } }); });
  bySide('W').forEach((ex, i) => { const y = i % 2 === 0 ? 16 : 8; g.rect(0, y, 2, 2, T.path); openings.push({ ...ex, tiles: [[0, y], [0, y + 1]], inner: [[1, y], [1, y + 1]], lane: { y, x0: 2, axis: 'h' } }); });
  map.openings = openings;
  // Buildings: two roof rows, two wall rows, a door centered in the bottom wall and a doorstep path.
  for (const b of placed) {
    g.rect(b.x, b.y, b.w, 2, T.roof);
    g.rect(b.x, b.y + 2, b.w, 2, T.wall);
    const dx = b.x + Math.floor(b.w / 2), dy = b.y + 3;
    g.set(dx, dy, T.door);
    g.set(dx, dy + 1, T.path);
    for (const wx of [b.x + 1, b.x + b.w - 2]) if (wx !== dx) g.set(wx, b.y + 2, T.window);
    const local = b.kind === 'house' ? `house-${b.n}` : b.kind;
    const building = { kind: b.kind, roof: ROOF[b.kind], x: b.x, y: b.y, w: b.w, h: b.h, door: { x: dx, y: dy }, target: b.target || `${area.id}/${local}` };
    map.buildings.push(building);
    map.doors.push({ x: dx, y: dy, to: building.target, kind: b.kind });
    const signText = { center: `${area.name} Heal Center: we restore your tired creatures!`, mart: `${area.name} Mart: balls, tonics and more.`, gym: `${content.areas.find(a => a.id === b.target)?.name || 'Gym'}: leader ${content.areas.find(a => a.id === b.target)?.leader?.name || ''}.`, lab: `${content.mentor?.name || 'The professor'}'s lab.` }[b.kind];
    if (signText && dx + 2 < b.x + b.w + 1 && g.get(dx + 2, dy + 1) === T.ground) { g.set(dx + 2, dy + 1, T.sign); map.signs[`${dx + 2},${dy + 1}`] = signText; }
    if (b.gate) entity(map, `gate-${b.target}`, { kind: 'guard', x: dx, y: dy + 1, facing: 'down', name: 'Guard', gate: b.gate, aside: { x: dx - 1, y: dy + 1 }, look: 'a guard in a blue uniform' });
  }
  // Garden and decor below the south street.
  for (let x = 2; x < W - 2; x++) for (const y of [2, 10, 18, 19]) if (g.get(x, y) === T.ground && r() < (y === 10 ? 0.12 : 0.22)) g.set(x, y, T.flower);
  const px = 3 + r.int(3);
  if ([0, 1, 2].every(i => [18, 19].every(y => g.get(px + i, y) === T.ground || g.get(px + i, y) === T.flower)) && px + 2 < cx - 1) g.rect(px, 18, 3, 2, T.water);
  const fx = cx + 3 + r.int(2), flen = Math.min(W - 3 - fx, 3 + r.int(4));
  for (let x = fx; x < fx + flen; x++) if (g.get(x, 18) !== T.path) g.set(x, 18, T.fence);
  const signX = cx - 1, signY = 10;
  if (g.get(signX, signY) !== T.path) { g.set(signX, signY, T.sign); map.signs[`${signX},${signY}`] = `${area.name}. ${area.description || ''}`.trim(); }
  // Content NPCs walk the streets.
  (area.npcs || []).forEach((n, i) => {
    const y = i % 2 ? 16 : 9, x = clamp(3 + ((i * 7 + 4) % (W - 6)), 3, W - 4);
    entity(map, n.id, { kind: 'npc', npc: n.id, x: x === cx || x === cx + 1 ? x + 3 : x, y, facing: 'down', name: n.name, look: n.look, lines: n.lines, wander: 2 });
  });
  // Gate guards on gated exits.
  for (const o of openings) {
    if (!o.gate) continue;
    if (o.lane.axis === 'v') {
      const y = o.lane.y0;
      entity(map, `gate-${o.to}`, { kind: 'guard', x: o.lane.x, y, facing: o.side === 'N' ? 'down' : 'up', name: 'Guard', gate: o.gate, aside: { x: o.lane.x - 1, y }, look: 'a guard in a blue uniform' });
      g.set(o.lane.x + 1, y, T.fence);
      if (g.get(o.lane.x - 1, y) !== T.path) g.set(o.lane.x - 1, y, T.ground);
    } else {
      const x = o.lane.x0;
      entity(map, `gate-${o.to}`, { kind: 'guard', x, y: o.lane.y, facing: o.side === 'E' ? 'left' : 'right', name: 'Guard', gate: o.gate, aside: { x, y: o.lane.y - 1 }, look: 'a guard in a blue uniform' });
      g.set(x, o.lane.y + 1, T.fence);
      g.set(x, o.lane.y - 1, T.ground);
    }
  }
  finish(g, map);
  return map;
}

// ---------------------------------------------------------------- routes and caves

function genOutdoor(content, area, exits, r, { cave, attempt }) {
  const vertical = !exits.length || exits.some(e => e.side === 'N' || e.side === 'S');
  let w, h;
  if (cave) { if (vertical) { w = 24 + r.int(5); h = 30 + r.int(11); } else { w = 30 + r.int(11); h = 22 + r.int(4); } }
  else if (vertical) { w = 22 + r.int(5); h = 40 + r.int(17); }
  else { w = 40 + r.int(17); h = 20 + r.int(3); }
  const FILL = cave ? T.rock : T.tree, OPEN = cave ? T.floor : T.ground, PATH = cave ? T.floor : T.path;
  const { g, map } = newMap(area.id, area, cave ? 'cave' : 'route', w, h, FILL, { dark: !!cave });
  map.encounter = cave ? 'floor' : 'grass';
  const plain = attempt >= 6; // late attempts drop the riskier decor
  const openings = placeOpenings(r, w, h, exits);
  map.openings = openings;
  const inside = (x, y) => x >= 2 && y >= 2 && x <= w - 3 && y <= h - 3;
  const pathTiles = [], onPath = new Set();
  const brush = (x, y) => { for (const [i, j] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const px = x + i, py = y + j; if (px >= 1 && py >= 1 && px <= w - 2 && py <= h - 2) { g.set(px, py, PATH); const k = `${px},${py}`; if (!onPath.has(k)) { onPath.add(k); pathTiles.push([px, py]); } } } };
  for (const o of openings) for (const [x, y] of [...o.tiles, ...o.inner]) { g.set(x, y, PATH); }
  // A winding spine from the first opening to every other opening.
  const anchor = o => { const [x, y] = o.inner[0]; return [clamp(x, 2, w - 4), clamp(y, 2, h - 4)]; };
  const carve = (a, b) => {
    const [ax, ay] = a, [bx, by] = b;
    const primaryY = Math.abs(by - ay) >= Math.abs(bx - ax);
    const n = Math.max(1, Math.ceil(Math.abs(primaryY ? by - ay : bx - ax) / 7));
    const pts = [a];
    for (let k = 1; k < n; k++) {
      const t = k / n;
      pts.push(primaryY ? [clamp(Math.round(ax + (bx - ax) * t) + r.range(-5, 5), 3, w - 5), Math.round(ay + (by - ay) * t)] : [Math.round(ax + (bx - ax) * t), clamp(Math.round(ay + (by - ay) * t) + r.range(-4, 4), 3, h - 5)]);
    }
    pts.push(b);
    for (let k = 1; k < pts.length; k++) {
      let [x, y] = pts[k - 1];
      const [tx, ty] = pts[k];
      const secondaryFirst = r() < 0.5;
      const stepX = () => { while (x !== tx) { brush(x, y); x += Math.sign(tx - x); } };
      const stepY = () => { while (y !== ty) { brush(x, y); y += Math.sign(ty - y); } };
      if (primaryY === secondaryFirst) { stepY(); stepX(); } else { stepX(); stepY(); }
      brush(x, y);
    }
  };
  const hub = openings[0] ? anchor(openings[0]) : [Math.floor(w / 2), Math.floor(h / 2)];
  for (const o of openings.slice(1)) carve(hub, anchor(o));
  if (openings.length === 1) carve(hub, [Math.floor(w / 2), Math.floor(h / 2)]);
  for (const o of openings) brush(...anchor(o));
  // Clearings around the path with a slowly varying radius.
  let rad = 2;
  pathTiles.forEach(([x, y], i) => {
    if (i % 3 === 0) rad = clamp(rad + r.range(-1, 1), 1, cave ? 3 : 4);
    for (let j = -rad; j <= rad; j++) for (let k = -rad; k <= rad; k++) {
      const px = x + k, py = y + j;
      if (inside(px, py) && g.get(px, py) === FILL) g.set(px, py, OPEN);
    }
  });
  const isOpen = (x, y) => g.get(x, y) === OPEN;
  const nearPath = (x, y, d) => { for (let j = -d; j <= d; j++) for (let k = -d; k <= d; k++) if (onPath.has(`${x + k},${y + j}`)) return true; return false; };
  const nearOpening = (x, y) => openings.some(o => o.inner.some(([ix, iy]) => Math.abs(ix - x) + Math.abs(iy - y) < 5));
  // Tall grass patches; at least one crosses the path so the critical path has encounters.
  if (!cave) {
    const patches = 4 + r.int(4);
    for (let p = 0; p < patches; p++) {
      const idx = clamp(Math.floor(pathTiles.length * (p + 0.5) / patches) + r.range(-4, 4), 0, pathTiles.length - 1);
      const [px, py] = pathTiles[idx];
      const crossing = p % 2 === 0;
      const cx = px + (crossing ? 0 : r.pick([-4, -3, 3, 4])), cy = py + (crossing ? 0 : r.range(-2, 2));
      const rx = r.range(2, 4), ry = r.range(2, 3);
      for (let j = -ry; j <= ry; j++) for (let k = -rx; k <= rx; k++) {
        const x = cx + k, y = cy + j;
        if ((k * k) / (rx * rx) + (j * j) / (ry * ry) > 1.05 || !inside(x, y) || nearOpening(x, y)) continue;
        const ch = g.get(x, y);
        if (ch === OPEN || ch === PATH) g.set(x, y, T.grass);
      }
    }
  }
  // Ledges (vertical routes): a one-way drop beside the path.
  if (!cave && vertical && !plain) {
    const n = 1 + r.int(2);
    for (let k = 0; k < n; k++) {
      const idx = Math.floor(pathTiles.length * (0.3 + 0.4 * r()));
      const [px, py] = pathTiles[idx];
      let x = px - 1;
      while (x > 1 && g.get(x, py) === PATH) x--;
      const run = [];
      while (x > 1 && isOpen(x, py) && isOpen(x, py + 1) && !onPath.has(`${x},${py}`)) { run.push(x); x--; }
      if (run.length >= 3) for (const lx of run) g.set(lx, py, T.ledge);
    }
  }
  // Decor: single trees or boulders, flowers, a pond.
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
    if (!isOpen(x, y) || nearPath(x, y, 1) || nearOpening(x, y)) continue;
    const v = r();
    if (v < (cave ? 0.05 : 0.035)) g.set(x, y, cave ? T.boulder : T.tree);
    else if (!cave && v < 0.08) g.set(x, y, T.flower);
  }
  if (!plain) {
    for (let tries = 0; tries < 30; tries++) {
      const x = r.range(3, w - 7), y = r.range(3, h - 6);
      let ok = true;
      for (let j = -1; j <= 2 && ok; j++) for (let k = -1; k <= 3 && ok; k++) if (!isOpen(x + k, y + j) || nearPath(x + k, y + j, 1)) ok = false;
      if (ok) { g.rect(x, y, 3, 2, T.water); break; }
    }
  }
  // Trainers stand beside the path, facing it, so their sight line crosses it.
  const trainers = area.trainers || [];
  trainers.forEach((t, i) => {
    for (let shift = 0; shift < 12; shift++) {
      const idx = clamp(Math.floor(pathTiles.length * (i + 1) / (trainers.length + 1)) + shift * (shift % 2 ? 1 : -1) * 2, 6, pathTiles.length - 7);
      const [px, py] = pathTiles[idx] || pathTiles[0];
      const ahead = pathTiles[Math.min(pathTiles.length - 1, idx + 4)];
      const goingV = Math.abs(ahead[1] - py) >= Math.abs(ahead[0] - px);
      const sides = (i + shift) % 2 ? [-1, 1] : [1, -1];
      let placed = false;
      for (const s of sides) {
        // Trainer three tiles off the 2-wide path; sight 4 covers both path columns.
        const tx = goingV ? (s < 0 ? px - 3 : px + 4) : px, ty = goingV ? py : (s < 0 ? py - 3 : py + 4);
        const facing = goingV ? (s < 0 ? 'right' : 'left') : (s < 0 ? 'down' : 'up');
        if (!inside(tx, ty) || nearOpening(tx, ty) || map.entities.some(e => Math.abs(e.x - tx) + Math.abs(e.y - ty) < 4)) continue;
        const [dx, dy] = DIRS[facing];
        const line = [1, 2].map(k => [tx + dx * k, ty + dy * k]);
        if (line.some(([x, y]) => !inside(x, y))) continue;
        g.set(tx, ty, OPEN);
        for (const [x, y] of line) if (!walkable(g.get(x, y))) g.set(x, y, OPEN);
        entity(map, t.id, { kind: 'trainer', trainer: t.id, x: tx, y: ty, facing, name: `${t.class} ${t.name}`, look: t.look, sight: 4 });
        placed = true; break;
      }
      if (placed) break;
    }
  });
  // A route sign by the first entrance.
  if (openings[0] && !cave) {
    const [ax, ay] = anchor(openings[0]);
    for (const [sx, sy] of [[ax - 1, ay - 2], [ax + 2, ay - 2], [ax - 1, ay + 2], [ax + 2, ay + 2], [ax - 2, ay], [ax + 3, ay]]) {
      if (inside(sx, sy) && isOpen(sx, sy) && !nearOpening(sx, sy - 6)) { g.set(sx, sy, T.sign); map.signs[`${sx},${sy}`] = `${area.name}. ${area.description || ''}`.trim(); break; }
    }
  }
  map.tiles = g.rows();
  // Items: one or two pickups in far corners of the clearings.
  const balls = (content.items || []).filter(i => i.kind === 'ball').sort((a, b) => a.price - b.price);
  const heals = (content.items || []).filter(i => i.kind === 'heal' || i.kind === 'revive' || i.kind === 'status').sort((a, b) => a.price - b.price);
  const loot = [heals[r.int(Math.min(2, heals.length))] || balls[0], r() < 0.6 ? balls[Math.min(balls.length - 1, r.int(2))] : null].filter(Boolean);
  if (openings[0]) {
    const dist = reach(map, openings[0].inner[0], blockers(map));
    const far = [...dist.entries()].map(([k, d]) => { const [x, y] = k.split(',').map(Number); return { x, y, d }; })
      .filter(p => map.tiles[p.y][p.x] === OPEN && !onPath.has(`${p.x},${p.y}`) && !nearOpening(p.x, p.y)).sort((a, b) => b.d - a.d || a.y - b.y || a.x - b.x);
    loot.forEach((it, i) => {
      const spot = far.find(p => map.entities.every(e => Math.abs(e.x - p.x) + Math.abs(e.y - p.y) > 6));
      if (spot) entity(map, `item-${i}`, { kind: 'item', item: it.id, count: 1, x: spot.x, y: spot.y, name: it.name });
    });
  }
  return map;
}

// ---------------------------------------------------------------- rooms

function genGym(content, area, exits, doorLinked, r) {
  const trainers = area.trainers || [];
  const blocks = Math.max(1, Math.ceil(trainers.length / 2));
  const w = 15, h = 9 + blocks * 5, cx = 7;
  const { g, map } = newMap(area.id, area, 'gym', w, h, T.floor);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x === 0 || x === w - 1 || y < 2 || y === h - 1) g.set(x, y, T.wall);
  // Leader's dais and the switch-barrier puzzle.
  g.rect(cx - 1, 2, 3, 3, T.carpet);
  g.set(cx - 3, 2, T.statue); g.set(cx + 3, 2, T.statue);
  g.rect(1, 5, w - 2, 1, T.barrier);
  // Lanes: partitions with gaps that alternate sides.
  for (let b = 0; b < blocks; b++) {
    const top = 6 + b * 5;
    const py = top + 4;
    if (py < h - 3) { g.rect(1, py, w - 2, 1, T.shelf); const gap = b % 2 ? [w - 4, w - 3] : [2, 3]; for (const gx of gap) g.set(gx, py, T.floor); g.set(cx, py, T.floor); }
    const pair = trainers.slice(b * 2, b * 2 + 2);
    pair.forEach((t, k) => {
      const left = k === 0, tx = left ? 3 : w - 4, ty = top + 1 + k;
      entity(map, t.id, { kind: 'trainer', trainer: t.id, x: tx, y: ty, facing: left ? 'right' : 'left', name: `${t.class} ${t.name}`, look: t.look, sight: 4 });
    });
  }
  const sx = r() < 0.5 ? 1 : w - 2, sy = h - 3;
  g.set(sx, sy, T.switch);
  g.set(cx - 2, h - 3, T.statue); g.set(cx + 2, h - 3, T.statue);
  map.puzzle = { switch: { x: sx, y: sy }, barrier: 5, flag: `switch:${area.id}` };
  entity(map, area.leader.id, { kind: 'leader', trainer: area.leader.id, x: cx, y: 3, facing: 'down', name: area.leader.name, look: area.leader.look, sight: 0 });
  entity(map, 'guide', { kind: 'npc', x: cx + 1, y: h - 3, facing: 'down', name: 'Gym Guide', look: 'a cheerful guide in a cap', lines: gymGuideLines(content, area, sx < cx) });
  roomEntrance(g, map, exits, doorLinked, cx, h);
  return finish(g, map);
}

function gymGuideLines(content, area, switchLeft) {
  const t = area.leader.type;
  const strong = (content.types || []).filter(x => (content.chart?.[x.id]?.[t] ?? 1) > 1).map(x => x.name);
  const typeName = content.types.find(x => x.id === t)?.name || t;
  return [`This is ${area.name}! ${area.leader.name} uses ${typeName}-type creatures.`, strong.length ? `${strong.join(' and ')} moves hit them hard!` : 'Bring your strongest team!', `A switch on the ${switchLeft ? 'left' : 'right'} lowers the barrier.`];
}

/** Bottom-center entrance: a mat (door-linked rooms) or a 2-wide opening (edge-linked). */
function roomEntrance(g, map, exits, doorLinked, cx, h) {
  if (doorLinked) {
    g.set(cx, h - 1, T.wall);
    g.set(cx, h - 2, T.mat);
    map.mats.push({ x: cx, y: h - 2, inner: [cx, h - 3] });
  }
  const south = exits.filter(e => e.side === 'S');
  south.forEach((ex, i) => {
    const x = clamp(cx - (doorLinked ? 3 : 0) + i * 3, 1, map.w - 3);
    g.set(x, h - 1, T.floor); g.set(x + 1, h - 1, T.floor);
    map.openings.push({ ...ex, tiles: [[x, h - 1], [x + 1, h - 1]], inner: [[x, h - 2], [x + 1, h - 2]] });
  });
}

function genLeague(content, area, exits, doorLinked) {
  const w = 13, h = 16, cx = 6;
  const { g, map } = newMap(area.id, area, 'league', w, h, T.floor);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x === 0 || x === w - 1 || y < 2 || y === h - 1) g.set(x, y, T.wall);
  g.rect(cx, 2, 1, h - 3, T.carpet);
  for (const y of [4, 7, 10]) { g.set(cx - 3, y, T.statue); g.set(cx + 3, y, T.statue); }
  entity(map, 'champion', { kind: 'champion', x: cx, y: 3, facing: 'down', name: content.champion?.name || 'Champion', look: content.champion?.look, sight: 0 });
  if (area.services?.includes('heal')) {
    g.rect(1, h - 5, 3, 1, T.counter);
    entity(map, 'nurse', { kind: 'nurse', x: 2, y: h - 6, facing: 'down', name: 'Nurse', look: 'a nurse in a pink uniform', reach: 2 });
  }
  if (area.services?.includes('pc')) { g.set(w - 2, h - 5, T.pc); }
  roomEntrance(g, map, exits, doorLinked, cx, h);
  return finish(g, map);
}

function genInteriorArea(content, area, exits, doorLinked) {
  const w = 11, h = 9, cx = 5;
  const { g, map } = newMap(area.id, area, 'interior', w, h, T.floor);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x === 0 || x === w - 1 || y < 2 || y === h - 1) g.set(x, y, T.wall);
  g.rect(1, 2, 3, 1, T.shelf);
  (area.npcs || []).forEach((n, i) => entity(map, n.id, { kind: 'npc', npc: n.id, x: 3 + i * 2, y: 4, facing: 'down', name: n.name, look: n.look, lines: n.lines }));
  if (area.services?.includes('heal')) { g.rect(cx - 1, 3, 3, 1, T.counter); entity(map, 'nurse', { kind: 'nurse', x: cx, y: 2, facing: 'down', name: 'Nurse', look: 'a nurse', reach: 2 }); }
  roomEntrance(g, map, exits, doorLinked, cx, h);
  return finish(g, map);
}

// Built-in town interiors.
function genBuilt(content, town, kind, id, r, n) {
  const area = { id: town.id, name: town.name, theme: town.theme };
  const sizes = { center: [11, 8], mart: [9, 8], lab: [11, 10], house: [8, 7] };
  const [w, h] = sizes[kind];
  const cx = Math.floor(w / 2);
  const name = { center: `${town.name} Heal Center`, mart: `${town.name} Mart`, lab: `${content.mentor?.name || 'Professor'}'s Lab`, house: `${town.name} house` }[kind];
  const { g, map } = newMap(id, area, 'interior', w, h, T.floor, { name, room: kind });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x === 0 || x === w - 1 || y < 2 || y === h - 1) g.set(x, y, T.wall);
  if (kind === 'center') {
    g.rect(cx - 2, 3, 5, 1, T.counter);
    g.set(cx + 2, 2, T.heal);
    entity(map, 'nurse', { kind: 'nurse', x: cx, y: 2, facing: 'down', name: 'Nurse', look: 'a nurse in a pink uniform', reach: 2 });
    if (town.services?.includes('pc')) g.set(w - 2, 2, T.pc);
    g.set(1, 2, T.shelf);
    map.respawn = { x: cx, y: 4, facing: 'up' };
  } else if (kind === 'mart') {
    g.rect(1, 3, 2, 1, T.counter); g.set(2, 4, T.counter);
    entity(map, 'clerk', { kind: 'clerk', x: 1, y: 4, facing: 'right', name: 'Clerk', look: 'a clerk in a blue apron', reach: 2 });
    g.rect(w - 4, 3, 2, 1, T.shelf); g.rect(w - 4, 5, 2, 1, T.shelf);
  } else if (kind === 'lab') {
    g.rect(1, 2, 3, 1, T.shelf); g.rect(w - 4, 2, 3, 1, T.shelf);
    g.rect(cx - 1, 5, 3, 1, T.table);
    entity(map, 'mentor', { kind: 'mentor', x: cx, y: 3, facing: 'down', name: content.mentor?.name || 'Professor', look: content.mentor?.look });
    (content.starters || []).slice(0, 3).forEach((sp, i) => entity(map, `starter-${i}`, { kind: 'starter', species: sp, index: i, x: cx - 1 + i, y: 5, facing: 'down', name: 'Orb' }));
    entity(map, 'aide', { kind: 'npc', x: w - 3, y: 6, facing: 'left', name: 'Aide', look: 'a lab aide with glasses', lines: [`${content.mentor?.name || 'The professor'} studies how creatures grow and evolve.`, 'Creatures in tall grass get stronger the farther you travel.'], wander: 1 });
    map.spawn = { x: cx, y: 6, facing: 'up' };
  } else {
    g.set(1, 2, T.shelf); g.rect(cx - 1, 3, 2, 1, T.table);
    entity(map, 'resident', { kind: 'npc', x: cx + 2, y: 4, facing: 'down', name: 'Resident', look: r.pick(['an old man with a cane', 'a girl with braids', 'a woman with a sunhat', 'a boy with a cap']), lines: residentLines(content, town, r, n), wander: 1 });
  }
  g.set(cx, h - 1, T.wall); g.set(cx, h - 2, T.mat);
  map.mats.push({ x: cx, y: h - 2, inner: [cx, h - 3] });
  return finish(g, map);
}

function residentLines(content, town, r, n) {
  const tips = [
    'Weaken a wild creature before you throw a ball. Sleep or paralysis helps too!',
    'Holding B lets you run. Tap B while standing still to open your menu.',
    'Trainers who see you will challenge you. Look out for their gaze!',
    'Types matter: a strong match deals double damage.',
    `${content.region?.description || 'This region is full of creatures.'}`,
    'Visit the Heal Center whenever your team is tired. It\'s free!',
  ];
  return [tips[(n + r.int(tips.length)) % tips.length]];
}

// ---------------------------------------------------------------- top level

/** Generate every map for the content. Deterministic for (content, seed). */
export function generateMaps(content, seed = 1) {
  const links = planLinks(content);
  const { areas } = indexContent(content);
  const start = content.areas[0];
  const exitsOf = id => links.filter(l => l.type === 'edge' && (l.a === id || l.b === id)).map(l => { const to = l.a === id ? l.b : l.a; return { side: l.sides[id], to, gate: l.gate[id] || null, link: l }; });
  const roomDoorsOf = id => links.filter(l => l.type === 'door' && l.host === id).map(l => ({ room: l.room, roomKind: areas.get(l.room).kind, gate: l.gate[id] || null }));
  const doorLinked = id => links.some(l => l.type === 'door' && l.room === id);
  const maps = {};
  for (const area of content.areas) {
    const exits = exitsOf(area.id);
    let best = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const r = localRng(MAPGEN_VERSION, seed, area.id, attempt);
      let map;
      if (area.kind === 'town') map = genTown(content, area, exits, roomDoorsOf(area.id), r, { isStart: area.id === start.id });
      else if (area.kind === 'route' || area.kind === 'cave') map = genOutdoor(content, area, exits, r, { cave: area.kind === 'cave', attempt });
      else if (area.kind === 'gym' && area.leader) map = genGym(content, area, exits, doorLinked(area.id), r);
      else if (area.kind === 'league') map = genLeague(content, area, exits, doorLinked(area.id));
      else map = genInteriorArea(content, area, exits, doorLinked(area.id));
      const problems = checkMap(map);
      if (!problems.length) { best = map; break; }
      if (!best || problems.length < best.problems.length) best = Object.assign(map, { problems });
    }
    maps[area.id] = best;
    if (area.kind === 'town') {
      for (const b of best.buildings) {
        if (!b.target.startsWith(`${area.id}/`)) continue;
        const kind = b.kind === 'house' ? 'house' : b.kind;
        maps[b.target] = genBuilt(content, area, kind, b.target, localRng(MAPGEN_VERSION, seed, b.target), Number(b.target.split('-').pop()) || 0);
      }
    }
  }
  // Warps: edge openings pair tile-for-tile; doors pair with their room's mat (or bottom opening).
  const warps = [];
  const addWarp = (map, x, y, to, tx, ty, facing, kind) => { const w = { map: map.id, x, y, to, tx, ty, facing, kind }; map.warps.push(w); warps.push(w); };
  for (const map of Object.values(maps)) {
    for (const o of map.openings) {
      const other = maps[o.to];
      const back = other?.openings.find(p => p.to === map.area && p.side === OPPOSITE_SIDE[o.side]) || other?.openings.find(p => p.to === map.area);
      if (!back) continue;
      o.tiles.forEach(([x, y], i) => { const [tx, ty] = back.inner[Math.min(i, back.inner.length - 1)]; addWarp(map, x, y, other.id, tx, ty, SIDE_DIR[o.side], 'edge'); });
    }
    for (const d of map.doors) {
      const room = maps[d.to];
      if (!room) continue;
      const mat = room.mats[0];
      if (mat) {
        addWarp(map, d.x, d.y, room.id, mat.inner[0], mat.inner[1], 'up', 'door');
        if (!room.warps.some(w => w.kind === 'mat')) addWarp(room, mat.x, mat.y, map.id, d.x, d.y + 1, 'down', 'mat');
      }
    }
  }
  const lab = Object.values(maps).find(m => m.room === 'lab');
  const startMap = lab || maps[start.id];
  const spawn = lab ? { map: lab.id, ...lab.spawn } : { map: start.id, x: Math.floor(startMap.w / 2), y: Math.floor(startMap.h / 2), facing: 'down' };
  const respawns = Object.fromEntries(Object.values(maps).filter(m => m.respawn).map(m => [m.area, { map: m.id, ...m.respawn }]));
  return { version: MAPGEN_VERSION, maps, warps, spawns: { start: spawn, respawns }, links, stages: Object.fromEntries(areaStages(content)) };
}
