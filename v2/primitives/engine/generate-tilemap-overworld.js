// Top-down RPG overworlds from an area graph (towns, routes, caves, gyms,
// leagues, interiors), ported from the creature kit's map generator. Area
// `connects` become edge exits (outdoor ↔ outdoor, sides assigned by walking
// the area graph from the start, forward edges north first) or doors (a town
// building ↔ a gym, league or interior). Towns get streets, buildings from
// their services plus houses, gate guards on gated exits; routes and caves a
// winding 2-wide spine between openings with clearings, tall grass crossing
// the path, ledges, ponds, trainers beside the path facing it and pickups in
// far corners; gyms a switch-and-barrier puzzle with trainer lanes. Every map
// is checked: every entrance reaches every other, every door, trainer, item
// and NPC is reachable (gyms: with the barrier lowered, the switch with it
// raised); a failing map retries sub-seeds, late attempts drop risky decor,
// and the best map is kept with its problems. Maps are packed into an atlas in
// the bound space; areas and built interiors become zones; warps pair openings
// tile-for-tile and doors with mats, and the whole warp graph is proven
// connected from the start. Tiles are roles mapped to blocks by `tiles`
// (walkable roles default to empty), so the look is data.
import { withDefaults, drawSeed, stream, Raster, clamp, spaceOf, zoneRect, cellWriter, addZones, publish, spawnAt, placeOn, cellOfEntity, problem } from './generate2d-lib.js';

const ID = 'engine.generate.tilemap.overworld';
const ROOM = new Set(['gym', 'interior', 'league']);
const WALKABLE = new Set(['ground', 'path', 'grass', 'flower', 'door', 'floor', 'mat', 'switch', 'carpet']);
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const SIDE_DIR = { N: 'up', S: 'down', E: 'right', W: 'left' }, OPP = { N: 'S', S: 'N', E: 'W', W: 'E' };
export const BUILDINGS = { center: { w: 5, roof: 'center' }, mart: { w: 4, roof: 'mart' }, lab: { w: 6, roof: 'lab' }, gym: { w: 6, roof: 'gym' }, league: { w: 6, roof: 'gym' }, interior: { w: 4, roof: 'house' }, house: { w: 4, roof: 'house' } };
const SERVICE_BUILDING = { heal: 'center', mart: 'mart' };
const DEFAULT_TILES = { tree: 'tree', rock: 'rock', wall: 'wall', roof: 'roof', window: 'window', water: 'water', fence: 'fence', sign: 'sign', counter: 'counter', shelf: 'shelf', statue: 'statue', barrier: 'barrier', ledge: 'ledge', boulder: 'boulder', pc: 'pc', heal: 'heal_machine', table: 'table' };
const DEFAULT_ROLES = { npc: 'npc', trainer: 'trainer', guard: 'guard', nurse: 'nurse', clerk: 'clerk', mentor: 'mentor', item: 'item_ball', leader: 'leader', champion: 'champion', starter: 'starter', resident: 'npc' };

const area = { type: 'object', fields: {
  id: { type: 'string', required: true }, kind: { type: 'string', options: ['town', 'route', 'cave', 'gym', 'league', 'interior'], required: true },
  name: { type: 'string' }, description: { type: 'string' }, theme: { type: 'string' }, zone: { type: 'ref', to: 'zone', effect: 'place the map at this zone\'s rect (it must fit)' },
  length: { type: 'integer', min: 24, max: 160, effect: 'routes/caves: tiles along the travel axis (default 50)' },
  connects: { type: 'list', default: [], of: { type: 'object', fields: { to: { type: 'string', required: true }, gate: { type: 'predicate' } } } },
  services: { type: 'list', of: { type: 'string' }, default: [], effect: 'heal, mart, pc (town buildings or room counters)' },
  npcs: { type: 'list', default: [], of: { type: 'object', open: true, fields: { id: { type: 'string' }, ref: { type: 'string', effect: 'archetype or character id' }, name: { type: 'string' }, lines: { type: 'list', of: { type: 'string' } } } } },
  trainers: { type: 'list', default: [], of: { type: 'object', open: true, fields: { id: { type: 'string', required: true }, ref: { type: 'string' }, name: { type: 'string' } } } },
  leader: { type: 'object', open: true, fields: { id: { type: 'string', required: true }, ref: { type: 'string' }, name: { type: 'string' } } },
  items: { type: 'list', of: { type: 'string' }, default: [], effect: 'pickups placed in far corners (routes, caves)' },
  encounterRate: { type: 'number', min: 0, max: 1, default: 0.1 },
} };

export default {
  id: ID,
  card: {
    intent: 'Generates a top-down RPG overworld from an area graph: towns with buildings and interiors, winding routes and caves with grass, ledges, trainers and items, gyms with switch puzzles, leagues; warps link them and every map and warp is proven reachable.',
    views: ['td'],
    spaces: ['engine.space.tilemap'],
    params: {
      areas: { type: 'list', of: area, min: 1, required: true },
      start: { type: 'string', effect: 'starting area id (default the first)' },
      startBuildings: { type: 'list', of: { type: 'string' }, default: ['lab'], effect: 'extra buildings in the start town' },
      starters: { type: 'list', of: { type: 'string' }, default: [], effect: 'archetypes set out in the start lab' },
      buildings: { type: 'json', default: {}, effect: 'building kind → {w, roof}; extends the defaults' },
      tiles: { type: 'object', open: true, default: {}, fields: Object.fromEntries(Object.keys(DEFAULT_TILES).map(k => [k, { type: 'string' }])), effect: 'tile role → block (walkable roles: ground path grass flower door floor mat switch carpet default to empty)' },
      roles: { type: 'object', open: true, default: {}, fields: Object.fromEntries(Object.keys(DEFAULT_ROLES).map(k => [k, { type: 'string' }])), effect: 'entity role → archetype' },
      origin: { type: 'list', of: { type: 'integer' }, default: [0, 0] },
      gap: { type: 'integer', min: 1, max: 32, default: 4, effect: 'tiles between packed maps' },
      rowWidth: { type: 'integer', min: 32, effect: 'atlas row width (default the space width)' },
      yUp: { type: 'boolean', default: true, effect: 'map row 0 (north) is the top of the space' },
      attempts: { type: 'integer', min: 1, max: 20, default: 10 }, plainAfter: { type: 'integer', min: 0, max: 20, default: 6, effect: 'attempts from here drop ledges and ponds' },
      autoWarp: { type: 'boolean', default: true, effect: 'stepping on an exit or door tile moves the walker to its pair' },
      placePlayer: { type: 'boolean', default: true },
    },
    provides: { content: ['cells', 'rooms', 'zones', 'entities'], extent: 'own', events: ['generated', 'generated:*', 'generate_problem', 'warp', 'warp:*'], services: ['generation', 'overworld'] },
    requires: { capabilities: ['position', 'editCells'] },
    defines: [{ kind: 'zone', in: 'areas' }], // each area's map becomes a zone named after the area (unless bound to a doc zone)
    problems: ['exit_unreachable', 'door_unreachable', 'switch_unreachable', 'trainer_unreachable', 'item_unreachable', 'npc_unreachable', 'leader_unreachable', 'champion_unreachable', 'map_unreachable', 'warp_unpaired', 'area_too_big'],
    validates: ['area_duplicate', 'connect_unknown', 'start_unknown', 'gym_leader_missing'],
  },
  /**
   * provides.extent 'own': the maps are packed into an atlas whose height depends on the generated map sizes, so
   * the extent is known only after generation (null here; the maps are walled and joined by warps, never by open edges).
   */
  extentOf() { return null; },
  validate(raw) {
    const config = withDefaults(this.card, raw);
    const errors = [], ids = new Set(config.areas.map(a => a.id)), seen = new Set();
    config.areas.forEach((a, i) => {
      if (seen.has(a.id)) errors.push(problem('area_duplicate', `areas[${i}].id`, `duplicate area '${a.id}'`)); seen.add(a.id);
      a.connects.forEach((c, j) => { if (!ids.has(c.to)) errors.push(problem('connect_unknown', `areas[${i}].connects[${j}].to`, `unknown area '${c.to}'`)); });
      if (a.kind === 'gym' && !a.leader) errors.push(problem('gym_leader_missing', `areas[${i}].leader`, `gym '${a.id}' needs a leader`));
    });
    if (config.start && !ids.has(config.start)) errors.push(problem('start_unknown', 'start', `unknown start area '${config.start}'`));
    return errors;
  },
  install(rt, raw, instance) {
    const config = withDefaults(this.card, raw), space = spaceOf(rt, instance), seed = drawSeed(rt);
    const world = generateOverworld(config, seed);
    // Atlas: maps bound to zones go to their rect; the rest pack in rows.
    const W = config.rowWidth || space.size?.[0] || 256, [ox, oy] = config.origin, placed = new Map();
    let cx = 0, cy = 0, rowH = 0;
    for (const m of Object.values(world.maps)) {
      const z = m.zoneRef && zoneRect(space.zone(m.zoneRef));
      if (z) { if (z[2] - z[0] < m.w || z[3] - z[1] < m.h) world.problems.push(problem('area_too_big', `areas.${m.area}`, `map '${m.id}' (${m.w}×${m.h}) does not fit zone '${m.zoneRef}'`)); placed.set(m.id, { zone: z }); continue; }
      if (cx && cx + m.w > W) { cx = 0; cy += rowH + config.gap; rowH = 0; }
      placed.set(m.id, { ax: cx, ay: cy }); cx += m.w + config.gap; rowH = Math.max(rowH, m.h);
    }
    const atlasH = cy + rowH;
    const at = (mapId, x, y) => {
      const p = placed.get(mapId), m = world.maps[mapId];
      if (p.zone) return [p.zone[0] + x, config.yUp ? p.zone[1] + (m.h - 1 - y) : p.zone[1] + y];
      return [ox + p.ax + x, config.yUp ? oy + (atlasH - 1 - (p.ay + y)) : oy + p.ay + y];
    };
    const tiles = { ...DEFAULT_TILES, ...config.tiles }, roles = { ...DEFAULT_ROLES, ...config.roles };
    const writer = cellWriter(rt, space);
    for (const m of Object.values(world.maps)) for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) writer.set(at(m.id, x, y), tiles[m.tiles[y][x]] ?? null);
    writer.flush();
    addZones(rt, space, Object.values(world.maps).filter(m => !placed.get(m.id).zone).map(m => {
      const a = at(m.id, 0, 0), b = at(m.id, m.w - 1, m.h - 1);
      return { id: m.id, name: m.name, rect: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]) + 1, Math.max(a[1], b[1]) + 1], tags: [m.kind, ...(m.dark ? ['dark'] : [])], rules: { encounter: m.encounter, encounterRate: m.encounterRate } };
    }));
    const characters = new Map((rt.doc.plot?.characters || []).map(c => [c.id, c]));
    for (const m of Object.values(world.maps)) for (const e of m.entities) {
      const ch = characters.get(e.ref), archetype = ch ? ch.archetype ?? e.ref : e.ref || roles[e.kind] || e.kind;
      spawnAt(rt, space, archetype, at(m.id, e.x, e.y), { overworld: { kind: e.kind, map: m.id, facing: e.facing, name: e.name, sight: e.sight ?? 0, lines: e.lines || [], gate: e.gate ?? null, aside: e.aside ? at(m.id, e.aside.x, e.aside.y) : null, item: e.item ?? null, trainer: e.trainer ?? null } }, ch ? e.ref : e.id);
    }
    const warps = world.warps.map(w => ({ ...w, from: at(w.map, w.x, w.y), to: at(w.to, w.tx, w.ty) }));
    const key = p => `${Math.floor(p[0])},${Math.floor(p[1])}`, warpAt = new Map(warps.map(w => [key(w.from), w]));
    const st = () => rt.store(instance.key);
    if (config.autoWarp) rt.system('late', rt => {
      const s = st(); s.last ??= {};
      for (const e of Object.values(rt.state.entities)) {
        if (e.space !== space.sid || !Array.isArray(e.at) || !(e.id === 'player' || e.components.overworld?.walker)) continue;
        const k = key(cellOfEntity(space, e)); if (s.last[e.id] === k) continue;
        s.last[e.id] = k;
        const w = warpAt.get(k); if (!w) continue;
        placeOn(rt, space, e, [...w.to, ...(e.at.length > 2 ? [cellOfEntity(space, e)[2]] : [])]); s.last[e.id] = key(w.to);
        rt.emitTyped('warp', w.to_map ?? w.toMap, { who: e.id, from: w.map, to: w.toMap, kind: w.kind });
      }
    }, ID);
    const spawn = world.spawn;
    if (config.placePlayer) rt.on('spawn', d => { if (d.id !== 'player') return; const p = rt.player(); if (p?.space === space.sid) placeOn(rt, space, p, at(spawn.map, spawn.x, spawn.y)); });
    const grass = Object.values(world.maps).flatMap(m => m.encounter === 'grass' ? m.tiles.flatMap((row, y) => row.flatMap((t, x) => (t === 'grass' ? [key(at(m.id, x, y))] : []))) : []);
    const cave = Object.values(world.maps).filter(m => m.encounter === 'floor').map(m => m.id);
    let gs = null; const grassSet = () => (gs ??= new Set(grass));
    const signs = Object.values(world.maps).flatMap(m => Object.entries(m.signs).map(([k, text]) => { const [x, y] = k.split(',').map(Number); return { at: at(m.id, x, y), text }; }));
    publish(rt, instance, space, ID, { problems: world.problems, attempts: world.attempts, fallback: world.fallback, links: world.links, warps,
      maps: Object.values(world.maps).map(m => ({ id: m.id, area: m.area, kind: m.kind, name: m.name, size: [m.w, m.h], origin: at(m.id, 0, 0), attempt: m.attempt, problems: m.problems.length })),
      spawn: at(spawn.map, spawn.x, spawn.y), respawns: Object.fromEntries(Object.entries(world.respawns).map(([a, r]) => [a, at(r.map, r.x, r.y)])), ledges: Object.values(world.maps).flatMap(m => m.tiles.flatMap((row, y) => row.flatMap((t, x) => (t === 'ledge' ? [at(m.id, x, y)] : [])))), signs }, {
      overworld: {
        maps: () => st().maps, warps: () => st().warps, spawn: () => st().spawn, respawn: area => st().respawns[area] ?? st().spawn,
        warpAt: p => warpAt.get(key(p)) ?? null, isGrass: p => grassSet().has(key(p)), signAt: p => st().signs.find(s => key(s.at) === key(p))?.text ?? null,
        isLedge: p => st().ledges.some(l => key(l) === key(p)), caveMaps: () => cave, problems: () => st().problems,
      },
    });
  },
};

// ---------------------------------------------------------------- generation (pure)

function planLinks(areas) {
  const byId = new Map(areas.map(a => [a.id, a])), pairs = new Map();
  for (const a of areas) for (const c of a.connects || []) {
    if (!byId.has(c.to) || c.to === a.id) continue;
    const [x, y] = [a.id, c.to].sort(), k = `${x}|${y}`, link = pairs.get(k) || { a: x, b: y, gate: {} };
    if (c.gate) link.gate[a.id] = c.gate;
    pairs.set(k, link);
  }
  const links = [...pairs.values()];
  for (const l of links) {
    const ka = byId.get(l.a).kind, kb = byId.get(l.b).kind;
    if (ROOM.has(ka) !== ROOM.has(kb) && (ka === 'town' || kb === 'town')) { l.type = 'door'; l.host = ka === 'town' ? l.a : l.b; l.room = l.host === l.a ? l.b : l.a; } else l.type = 'edge';
  }
  const used = new Map(areas.map(a => [a.id, { N: 0, S: 0, E: 0, W: 0 }])), seen = new Set([areas[0].id]), queue = [areas[0].id], order = new Map(areas.map((a, i) => [a.id, i])), done = new Set();
  while (queue.length) {
    const id = queue.shift();
    for (const l of links.filter(l => (l.a === id || l.b === id) && !done.has(l)).sort((p, q) => order.get(p.a === id ? p.b : p.a) - order.get(q.a === id ? q.b : q.a))) {
      done.add(l); const other = l.a === id ? l.b : l.a;
      if (l.type === 'edge') {
        const kid = byId.get(id).kind, kother = byId.get(other).kind;
        let side;
        if (ROOM.has(kother)) side = 'N'; else if (ROOM.has(kid)) side = 'S';
        else { const prefs = !seen.has(other) ? ['N', 'E', 'W', 'S'] : ['S', 'W', 'E', 'N']; side = prefs.find(s => !used.get(id)[s] && !used.get(other)[OPP[s]]) || prefs.find(s => !used.get(other)[OPP[s]] && used.get(id)[s] < 2) || prefs[0]; }
        l.sides = { [id]: side, [other]: OPP[side] }; used.get(id)[side]++; used.get(other)[OPP[side]]++;
      }
      if (!seen.has(other)) { seen.add(other); queue.push(other); }
    }
  }
  return links.filter(l => l.type === 'door' || l.sides);
}

const walkable = t => WALKABLE.has(t);
function neighbors(map, x, y, blocked) {
  const out = [];
  for (const [dir, [dx, dy]] of Object.entries(DIRS)) {
    const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
    const t = map.tiles[ny][nx];
    if (t === 'ledge') { if (dir === 'down' && ny + 1 < map.h && walkable(map.tiles[ny + 1][nx]) && !blocked?.has(`${nx},${ny + 1}`)) out.push([nx, ny + 1]); continue; }
    if (walkable(t) && !blocked?.has(`${nx},${ny}`)) out.push([nx, ny]);
  }
  return out;
}
export function reach(map, from, blocked) {
  const dist = new Map([[`${from[0]},${from[1]}`, 0]]), q = [from];
  for (let i = 0; i < q.length; i++) { const [x, y] = q[i], d = dist.get(`${x},${y}`); for (const [nx, ny] of neighbors(map, x, y, blocked)) { const k = `${nx},${ny}`; if (!dist.has(k)) { dist.set(k, d + 1); q.push([nx, ny]); } } }
  return dist;
}
const blockers = map => new Set(map.entities.filter(e => e.solid !== false).map(e => `${e.x},${e.y}`));
const adjacentReached = (dist, x, y) => [[0, -1], [0, 1], [-1, 0], [1, 0]].some(([dx, dy]) => dist.has(`${x + dx},${y + dy}`));

/** Problems with one map: entrances that cannot reach each other; doors, trainers, items, NPCs out of reach. */
export function checkMap(input) {
  const problems = [], map = input.puzzle ? { ...input, tiles: input.tiles.map(row => row.map(t => (t === 'barrier' ? 'floor' : t))) } : input;
  const blocked = blockers(map);
  for (const e of map.entities) if (e.kind === 'guard') blocked.delete(`${e.x},${e.y}`);
  for (const d of [...map.doors, ...map.mats]) blocked.add(`${d.x},${d.y}`);
  const entries = [...map.openings.map(o => o.inner[0]), ...map.mats.map(m => m.inner)];
  if (!entries.length) return problems;
  const dists = entries.map(p => reach(map, p, blocked));
  entries.forEach((p, i) => entries.forEach((q, j) => { if (i !== j && !dists[i].has(`${q[0]},${q[1]}`)) problems.push(problem('exit_unreachable', `maps.${map.id}`, `map '${map.id}': entrance ${JSON.stringify(q)} unreachable from ${JSON.stringify(p)}`)); }));
  if (input.puzzle && !reach(input, entries[0], blocked).has(`${input.puzzle.switch.x},${input.puzzle.switch.y}`)) problems.push(problem('switch_unreachable', `maps.${map.id}`, `map '${map.id}': the barrier switch is unreachable`));
  for (const d of map.doors) if (!dists[0].has(`${d.x},${d.y + 1}`)) problems.push(problem('door_unreachable', `maps.${map.id}`, `map '${map.id}': door to '${d.to}' unreachable`));
  for (const e of map.entities) {
    if (e.kind === 'guard' || e.kind === 'starter') continue;
    if (['trainer', 'leader', 'champion', 'item', 'npc'].includes(e.kind) && !adjacentReached(dists[0], e.x, e.y)) problems.push(problem(`${e.kind}_unreachable`, `maps.${map.id}`, `map '${map.id}': ${e.kind} '${e.id}' unreachable`));
  }
  return problems;
}

function entity(map, local, props) { const e = { id: props.id || `${map.id}-${local}`, facing: 'down', solid: true, ...props }; map.entities.push(e); return e; }
function newMap(id, a, kind, w, h, fill, extra = {}) {
  const g = new Raster(w, h, fill);
  return { g, map: { id, area: a.id, zoneRef: extra.zoneRef ?? null, name: extra.name || a.name || a.id, kind, theme: a.theme || '', w, h, tiles: null, entities: [], signs: {}, warps: [], openings: [], doors: [], mats: [], encounter: null, encounterRate: a.encounterRate ?? 0.1, dark: false, buildings: [], ...extra } };
}
const rows = g => Array.from({ length: g.h }, (_, y) => Array.from({ length: g.w }, (_, x) => g.get(x, y)));
const finish = (g, map) => { map.tiles = rows(g); return map; };

function placeOpenings(r, w, h, exits, margin = 3) {
  const out = [];
  for (const side of ['N', 'S', 'E', 'W']) {
    const list = exits.filter(e => e.side === side), len = side === 'N' || side === 'S' ? w : h;
    list.forEach((ex, i) => {
      let pos = Math.floor((len * (i + 1)) / (list.length + 1)) - 1;
      if (list.length === 1) pos += r.range(-Math.floor(len / 6), Math.floor(len / 6));
      pos = clamp(pos, margin, len - margin - 2);
      const tiles = [0, 1].map(k => (side === 'N' ? [pos + k, 0] : side === 'S' ? [pos + k, h - 1] : side === 'E' ? [w - 1, pos + k] : [0, pos + k]));
      const [dx, dy] = DIRS[SIDE_DIR[side]];
      out.push({ ...ex, tiles, inner: tiles.map(([x, y]) => [x - dx, y - dy]) });
    });
  }
  return out;
}

function genTown(cfg, a, exits, roomDoors, r, isStart) {
  const B = { ...BUILDINGS, ...cfg.buildings }, want = [];
  if (isStart) for (const k of cfg.startBuildings) want.push({ kind: k });
  for (const d of roomDoors) want.push({ kind: d.roomKind === 'interior' ? 'interior' : d.roomKind, target: d.room, gate: d.gate });
  for (const s of a.services) if (SERVICE_BUILDING[s]) want.push({ kind: SERVICE_BUILDING[s] });
  for (let i = 0, n = 1 + r.int(2); i < n; i++) want.push({ kind: 'house', n: i + 1 });
  const H = 22; let W = 24, layout = null;
  while (!layout) {
    const cx = Math.floor(W / 2) - 1, segs = [[2, cx - 1, 3], [cx + 2, W - 2, 3], [2, cx - 1, 11], [cx + 2, W - 2, 11]].map(([p, q, y]) => ({ x: p + 1, end: q, y })), placed = [];
    let ok = true;
    for (const b of want) { const bw = (B[b.kind] || B.house).w, seg = segs.find(s => s.x + bw <= s.end); if (!seg) { ok = false; break; } placed.push({ ...b, x: seg.x, y: seg.y, w: bw, h: 4 }); seg.x += bw + 1 + (r() < 0.4 ? 1 : 0); }
    if (ok) layout = { cx, placed }; else W += 6;
  }
  const { cx, placed } = layout, { g, map } = newMap(a.id, a, 'town', W, H, 'ground', { zoneRef: a.zone });
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) g.set(x, y, 'tree');
  g.rect(2, 8, W - 4, 2, 'path'); g.rect(2, 16, W - 4, 2, 'path'); g.rect(cx, 8, 2, 10, 'path');
  const openings = [], bySide = s => exits.filter(e => e.side === s);
  bySide('N').forEach((ex, i) => { const x = i === 0 ? cx : clamp(cx - 6 * i, 3, W - 5); g.rect(x, 0, 2, 8, 'path'); openings.push({ ...ex, tiles: [[x, 0], [x + 1, 0]], inner: [[x, 1], [x + 1, 1]], lane: { x, y0: 2, axis: 'v' } }); });
  bySide('S').forEach((ex, i) => { const x = i === 0 ? cx : clamp(cx + 6 * i, 3, W - 5); g.rect(x, 17, 2, H - 17, 'path'); openings.push({ ...ex, tiles: [[x, H - 1], [x + 1, H - 1]], inner: [[x, H - 2], [x + 1, H - 2]], lane: { x, y0: H - 3, axis: 'v' } }); });
  bySide('E').forEach((ex, i) => { const y = i % 2 === 0 ? 8 : 16; g.rect(W - 2, y, 2, 2, 'path'); openings.push({ ...ex, tiles: [[W - 1, y], [W - 1, y + 1]], inner: [[W - 2, y], [W - 2, y + 1]], lane: { y, x0: W - 3, axis: 'h' } }); });
  bySide('W').forEach((ex, i) => { const y = i % 2 === 0 ? 16 : 8; g.rect(0, y, 2, 2, 'path'); openings.push({ ...ex, tiles: [[0, y], [0, y + 1]], inner: [[1, y], [1, y + 1]], lane: { y, x0: 2, axis: 'h' } }); });
  map.openings = openings;
  for (const b of placed) {
    g.rect(b.x, b.y, b.w, 2, 'roof'); g.rect(b.x, b.y + 2, b.w, 2, 'wall');
    const dx = b.x + Math.floor(b.w / 2), dy = b.y + 3;
    g.set(dx, dy, 'door'); g.set(dx, dy + 1, 'path');
    for (const wx of [b.x + 1, b.x + b.w - 2]) if (wx !== dx) g.set(wx, b.y + 2, 'window');
    const local = b.kind === 'house' ? `house-${b.n}` : b.kind, target = b.target || `${a.id}-${local}`;
    map.buildings.push({ kind: b.kind, roof: (B[b.kind] || B.house).roof, x: b.x, y: b.y, w: b.w, h: b.h, door: { x: dx, y: dy }, target });
    map.doors.push({ x: dx, y: dy, to: target, kind: b.kind });
    if (dx + 2 < b.x + b.w + 1 && g.get(dx + 2, dy + 1) === 'ground') { g.set(dx + 2, dy + 1, 'sign'); map.signs[`${dx + 2},${dy + 1}`] = `${b.kind}:${target}`; }
    if (b.gate) entity(map, `gate-${b.target}`, { kind: 'guard', x: dx, y: dy + 1, name: 'Guard', gate: b.gate, aside: { x: dx - 1, y: dy + 1 } });
  }
  for (let x = 2; x < W - 2; x++) for (const y of [2, 10, 18, 19]) if (g.get(x, y) === 'ground' && r() < (y === 10 ? 0.12 : 0.22)) g.set(x, y, 'flower');
  const px = 3 + r.int(3);
  if ([0, 1, 2].every(i => [18, 19].every(y => ['ground', 'flower'].includes(g.get(px + i, y)))) && px + 2 < cx - 1) g.rect(px, 18, 3, 2, 'water');
  const fx = cx + 3 + r.int(2), flen = Math.min(W - 3 - fx, 3 + r.int(4));
  for (let x = fx; x < fx + flen; x++) if (g.get(x, 18) !== 'path') g.set(x, 18, 'fence');
  if (g.get(cx - 1, 10) !== 'path') { g.set(cx - 1, 10, 'sign'); map.signs[`${cx - 1},10`] = `${a.name || a.id}. ${a.description || ''}`.trim(); }
  a.npcs.forEach((n, i) => { const y = i % 2 ? 16 : 9, x = clamp(3 + ((i * 7 + 4) % (W - 6)), 3, W - 4); entity(map, n.id || `npc-${i}`, { kind: 'npc', id: n.id, ref: n.ref, x: x === cx || x === cx + 1 ? x + 3 : x, y, name: n.name, lines: n.lines, wander: 2 }); });
  for (const o of openings) {
    if (!o.gate) continue;
    if (o.lane.axis === 'v') { const y = o.lane.y0; entity(map, `gate-${o.to}`, { kind: 'guard', x: o.lane.x, y, facing: o.side === 'N' ? 'down' : 'up', gate: o.gate, aside: { x: o.lane.x - 1, y } }); g.set(o.lane.x + 1, y, 'fence'); if (g.get(o.lane.x - 1, y) !== 'path') g.set(o.lane.x - 1, y, 'ground'); }
    else { const x = o.lane.x0; entity(map, `gate-${o.to}`, { kind: 'guard', x, y: o.lane.y, facing: o.side === 'E' ? 'left' : 'right', gate: o.gate, aside: { x, y: o.lane.y - 1 } }); g.set(x, o.lane.y + 1, 'fence'); g.set(x, o.lane.y - 1, 'ground'); }
  }
  return finish(g, map);
}

function genOutdoor(cfg, a, exits, r, { cave, attempt }) {
  const vertical = !exits.length || exits.some(e => e.side === 'N' || e.side === 'S');
  const len = Math.max(24, Math.min(160, Math.round((a.length || 50) * (cave ? 0.75 : 1)) + r.range(-3, 3))), across = Math.max(0, Math.round((len - 50) / 8));
  const [w, h] = vertical ? [(cave ? 24 : 22) + r.int(5) + across, len] : [len, (cave ? 22 : 20) + r.int(3) + across];
  const FILL = cave ? 'rock' : 'tree', OPEN = cave ? 'floor' : 'ground', PATH = cave ? 'floor' : 'path';
  const { g, map } = newMap(a.id, a, cave ? 'cave' : 'route', w, h, FILL, { dark: Boolean(cave), zoneRef: a.zone });
  map.encounter = cave ? 'floor' : 'grass';
  const plain = attempt >= cfg.plainAfter, openings = placeOpenings(r, w, h, exits);
  map.openings = openings;
  const inside = (x, y) => x >= 2 && y >= 2 && x <= w - 3 && y <= h - 3, pathTiles = [], onPath = new Set();
  const brush = (x, y) => { for (const [i, j] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const px = x + i, py = y + j; if (px >= 1 && py >= 1 && px <= w - 2 && py <= h - 2) { g.set(px, py, PATH); const k = `${px},${py}`; if (!onPath.has(k)) { onPath.add(k); pathTiles.push([px, py]); } } } };
  for (const o of openings) for (const [x, y] of [...o.tiles, ...o.inner]) g.set(x, y, PATH);
  const anchor = o => { const [x, y] = o.inner[0]; return [clamp(x, 2, w - 4), clamp(y, 2, h - 4)]; };
  const carve = (p, q) => {
    const [ax, ay] = p, [bx, by] = q, primaryY = Math.abs(by - ay) >= Math.abs(bx - ax), n = Math.max(1, Math.ceil(Math.abs(primaryY ? by - ay : bx - ax) / 7)), pts = [p];
    for (let k = 1; k < n; k++) { const t = k / n; pts.push(primaryY ? [clamp(Math.round(ax + (bx - ax) * t) + r.range(-5, 5), 3, w - 5), Math.round(ay + (by - ay) * t)] : [Math.round(ax + (bx - ax) * t), clamp(Math.round(ay + (by - ay) * t) + r.range(-4, 4), 3, h - 5)]); }
    pts.push(q);
    for (let k = 1; k < pts.length; k++) {
      let [x, y] = pts[k - 1]; const [tx, ty] = pts[k], secondaryFirst = r() < 0.5;
      const stepX = () => { while (x !== tx) { brush(x, y); x += Math.sign(tx - x); } }, stepY = () => { while (y !== ty) { brush(x, y); y += Math.sign(ty - y); } };
      if (primaryY === secondaryFirst) { stepY(); stepX(); } else { stepX(); stepY(); }
      brush(x, y);
    }
  };
  const hub = openings[0] ? anchor(openings[0]) : [Math.floor(w / 2), Math.floor(h / 2)];
  for (const o of openings.slice(1)) carve(hub, anchor(o));
  if (openings.length <= 1) carve(hub, [Math.floor(w / 2), Math.floor(h / 2)]);
  for (const o of openings) brush(...anchor(o));
  let rad = 2;
  pathTiles.forEach(([x, y], i) => { if (i % 3 === 0) rad = clamp(rad + r.range(-1, 1), 1, cave ? 3 : 4); for (let j = -rad; j <= rad; j++) for (let k = -rad; k <= rad; k++) { const px = x + k, py = y + j; if (inside(px, py) && g.get(px, py) === FILL) g.set(px, py, OPEN); } });
  const isOpen = (x, y) => g.get(x, y) === OPEN;
  const nearPath = (x, y, d) => { for (let j = -d; j <= d; j++) for (let k = -d; k <= d; k++) if (onPath.has(`${x + k},${y + j}`)) return true; return false; };
  const nearOpening = (x, y) => openings.some(o => o.inner.some(([ix, iy]) => Math.abs(ix - x) + Math.abs(iy - y) < 5));
  if (!cave) for (let p = 0, patches = 4 + r.int(4); p < patches; p++) {
    const idx = clamp(Math.floor((pathTiles.length * (p + 0.5)) / patches) + r.range(-4, 4), 0, pathTiles.length - 1), [px, py] = pathTiles[idx], crossing = p % 2 === 0;
    const cx = px + (crossing ? 0 : r.pick([-4, -3, 3, 4])), cy = py + (crossing ? 0 : r.range(-2, 2)), rx = r.range(2, 4), ry = r.range(2, 3);
    for (let j = -ry; j <= ry; j++) for (let k = -rx; k <= rx; k++) { const x = cx + k, y = cy + j; if ((k * k) / (rx * rx) + (j * j) / (ry * ry) > 1.05 || !inside(x, y) || nearOpening(x, y)) continue; if (g.get(x, y) === OPEN || g.get(x, y) === PATH) g.set(x, y, 'grass'); }
  }
  if (!cave && vertical && !plain) for (let k = 0, n = 1 + r.int(2); k < n; k++) {
    const [px, py] = pathTiles[Math.floor(pathTiles.length * (0.3 + 0.4 * r()))]; let x = px - 1;
    while (x > 1 && g.get(x, py) === PATH) x--;
    const run = []; while (x > 1 && isOpen(x, py) && isOpen(x, py + 1) && !onPath.has(`${x},${py}`)) { run.push(x); x--; }
    if (run.length >= 3) for (const lx of run) g.set(lx, py, 'ledge');
  }
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) { if (!isOpen(x, y) || nearPath(x, y, 1) || nearOpening(x, y)) continue; const v = r(); if (v < (cave ? 0.05 : 0.035)) g.set(x, y, cave ? 'boulder' : 'tree'); else if (!cave && v < 0.08) g.set(x, y, 'flower'); }
  if (!plain) for (let tries = 0; tries < 30; tries++) { const x = r.range(3, w - 7), y = r.range(3, h - 6); let ok = true; for (let j = -1; j <= 2 && ok; j++) for (let k = -1; k <= 3 && ok; k++) if (!isOpen(x + k, y + j) || nearPath(x + k, y + j, 1)) ok = false; if (ok) { g.rect(x, y, 3, 2, 'water'); break; } }
  a.trainers.forEach((t, i) => {
    for (let shift = 0; shift < 12; shift++) {
      const idx = clamp(Math.floor((pathTiles.length * (i + 1)) / (a.trainers.length + 1)) + shift * (shift % 2 ? 1 : -1) * 2, 6, pathTiles.length - 7), [px, py] = pathTiles[idx] || pathTiles[0];
      const ahead = pathTiles[Math.min(pathTiles.length - 1, idx + 4)], goingV = Math.abs(ahead[1] - py) >= Math.abs(ahead[0] - px);
      let done = false;
      for (const s of (i + shift) % 2 ? [-1, 1] : [1, -1]) {
        const tx = goingV ? (s < 0 ? px - 3 : px + 4) : px, ty = goingV ? py : s < 0 ? py - 3 : py + 4, facing = goingV ? (s < 0 ? 'right' : 'left') : s < 0 ? 'down' : 'up';
        if (!inside(tx, ty) || nearOpening(tx, ty) || map.entities.some(e => Math.abs(e.x - tx) + Math.abs(e.y - ty) < 4)) continue;
        const [dx, dy] = DIRS[facing], line = [1, 2].map(k => [tx + dx * k, ty + dy * k]);
        if (line.some(([x, y]) => !inside(x, y))) continue;
        g.set(tx, ty, OPEN); for (const [x, y] of line) if (!walkable(g.get(x, y))) g.set(x, y, OPEN);
        entity(map, t.id, { kind: 'trainer', id: t.id, ref: t.ref, trainer: t.id, x: tx, y: ty, facing, name: t.name, sight: 4 }); done = true; break;
      }
      if (done) break;
    }
  });
  if (openings[0] && !cave) { const [ax, ay] = anchor(openings[0]); for (const [sx, sy] of [[ax - 1, ay - 2], [ax + 2, ay - 2], [ax - 1, ay + 2], [ax + 2, ay + 2], [ax - 2, ay], [ax + 3, ay]]) if (inside(sx, sy) && isOpen(sx, sy) && !nearOpening(sx, sy - 6)) { g.set(sx, sy, 'sign'); map.signs[`${sx},${sy}`] = `${a.name || a.id}. ${a.description || ''}`.trim(); break; } }
  finish(g, map);
  if (openings[0] && a.items.length) {
    const dist = reach(map, openings[0].inner[0], blockers(map));
    const far = [...dist.entries()].map(([k, d]) => { const [x, y] = k.split(',').map(Number); return { x, y, d }; }).filter(p => map.tiles[p.y][p.x] === OPEN && !onPath.has(`${p.x},${p.y}`) && !nearOpening(p.x, p.y)).sort((p, q) => q.d - p.d || p.y - q.y || p.x - q.x);
    a.items.forEach((it, i) => { const spot = far.find(p => map.entities.every(e => Math.abs(e.x - p.x) + Math.abs(e.y - p.y) > 6)); if (spot) entity(map, `item-${i}`, { kind: 'item', item: it, x: spot.x, y: spot.y }); });
  }
  return map;
}

function walled(g, w, h) { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x === 0 || x === w - 1 || y < 2 || y === h - 1) g.set(x, y, 'wall'); }
function roomEntrance(g, map, exits, doorLinked, cx, h) {
  if (doorLinked) { g.set(cx, h - 1, 'wall'); g.set(cx, h - 2, 'mat'); map.mats.push({ x: cx, y: h - 2, inner: [cx, h - 3] }); }
  exits.filter(e => e.side === 'S').forEach((ex, i) => { const x = clamp(cx - (doorLinked ? 3 : 0) + i * 3, 1, map.w - 3); g.set(x, h - 1, 'floor'); g.set(x + 1, h - 1, 'floor'); map.openings.push({ ...ex, tiles: [[x, h - 1], [x + 1, h - 1]], inner: [[x, h - 2], [x + 1, h - 2]] }); });
}
function genGym(cfg, a, exits, doorLinked, r) {
  const blocks = Math.max(1, Math.ceil(a.trainers.length / 2)), w = 15, h = 9 + blocks * 5, cx = 7;
  const { g, map } = newMap(a.id, a, 'gym', w, h, 'floor', { zoneRef: a.zone });
  walled(g, w, h); g.rect(cx - 1, 2, 3, 3, 'carpet'); g.set(cx - 3, 2, 'statue'); g.set(cx + 3, 2, 'statue'); g.rect(1, 5, w - 2, 1, 'barrier');
  for (let b = 0; b < blocks; b++) {
    const top = 6 + b * 5, py = top + 4;
    if (py < h - 3) { g.rect(1, py, w - 2, 1, 'shelf'); for (const gx of b % 2 ? [w - 4, w - 3] : [2, 3]) g.set(gx, py, 'floor'); g.set(cx, py, 'floor'); }
    a.trainers.slice(b * 2, b * 2 + 2).forEach((t, k) => entity(map, t.id, { kind: 'trainer', id: t.id, ref: t.ref, trainer: t.id, x: k === 0 ? 3 : w - 4, y: top + 1 + k, facing: k === 0 ? 'right' : 'left', name: t.name, sight: 4 }));
  }
  const sx = r() < 0.5 ? 1 : w - 2, sy = h - 3;
  g.set(sx, sy, 'switch'); g.set(cx - 2, h - 3, 'statue'); g.set(cx + 2, h - 3, 'statue');
  map.puzzle = { switch: { x: sx, y: sy }, barrier: 5, flag: `switch:${a.id}` };
  entity(map, a.leader.id, { kind: 'leader', id: a.leader.id, ref: a.leader.ref, trainer: a.leader.id, x: cx, y: 3, name: a.leader.name, sight: 0 });
  entity(map, 'guide', { kind: 'npc', x: cx - 3, y: h - 3, name: 'Guide', lines: [`switch:${sx < cx ? 'left' : 'right'}`] });
  roomEntrance(g, map, exits, doorLinked, cx, h);
  return finish(g, map);
}
function genLeague(cfg, a, exits, doorLinked) {
  const w = 13, h = 16, cx = 6, { g, map } = newMap(a.id, a, 'league', w, h, 'floor', { zoneRef: a.zone });
  walled(g, w, h); g.rect(cx, 2, 1, h - 3, 'carpet');
  for (const y of [4, 7, 10]) { g.set(cx - 3, y, 'statue'); g.set(cx + 3, y, 'statue'); }
  entity(map, a.leader?.id || 'champion', { kind: 'champion', id: a.leader?.id, ref: a.leader?.ref, x: cx, y: 3, name: a.leader?.name, sight: 0 });
  if (a.services.includes('heal')) { g.rect(1, h - 5, 3, 1, 'counter'); entity(map, 'nurse', { kind: 'nurse', x: 2, y: h - 6, reach: 2 }); }
  if (a.services.includes('pc')) g.set(w - 2, h - 5, 'pc');
  roomEntrance(g, map, exits, doorLinked, cx, h);
  return finish(g, map);
}
function genInterior(cfg, a, exits, doorLinked) {
  const w = 11, h = 9, cx = 5, { g, map } = newMap(a.id, a, 'interior', w, h, 'floor', { zoneRef: a.zone });
  walled(g, w, h); g.rect(1, 2, 3, 1, 'shelf');
  a.npcs.forEach((n, i) => entity(map, n.id || `npc-${i}`, { kind: 'npc', id: n.id, ref: n.ref, x: 3 + i * 2, y: 4, name: n.name, lines: n.lines }));
  if (a.services.includes('heal')) { g.rect(cx - 1, 3, 3, 1, 'counter'); entity(map, 'nurse', { kind: 'nurse', x: cx, y: 2, reach: 2 }); }
  roomEntrance(g, map, exits, doorLinked, cx, h);
  return finish(g, map);
}
function genBuilt(cfg, town, kind, id, r) {
  const sizes = { center: [11, 8], mart: [9, 8], lab: [11, 10], house: [8, 7] }, [w, h] = sizes[kind] || sizes.house, cx = Math.floor(w / 2);
  const { g, map } = newMap(id, town, 'interior', w, h, 'floor', { name: `${town.name || town.id} ${kind}`, room: kind });
  walled(g, w, h);
  if (kind === 'center') { g.rect(cx - 2, 3, 5, 1, 'counter'); g.set(cx + 2, 2, 'heal'); entity(map, 'nurse', { kind: 'nurse', x: cx, y: 2, reach: 2 }); if (town.services.includes('pc')) g.set(w - 2, 2, 'pc'); g.set(1, 2, 'shelf'); map.respawn = { x: cx, y: 4 }; }
  else if (kind === 'mart') { g.rect(1, 3, 2, 1, 'counter'); g.set(2, 4, 'counter'); entity(map, 'clerk', { kind: 'clerk', x: 1, y: 4, facing: 'right', reach: 2 }); g.rect(w - 4, 3, 2, 1, 'shelf'); g.rect(w - 4, 5, 2, 1, 'shelf'); }
  else if (kind === 'lab') { g.rect(1, 2, 3, 1, 'shelf'); g.rect(w - 4, 2, 3, 1, 'shelf'); g.rect(cx - 1, 5, 3, 1, 'table'); entity(map, 'mentor', { kind: 'mentor', x: cx, y: 3 }); cfg.starters.slice(0, 3).forEach((sp, i) => entity(map, `starter-${i}`, { kind: 'starter', ref: sp, x: cx - 1 + i, y: 5 })); map.spawn = { x: cx, y: 6 }; }
  else { g.set(1, 2, 'shelf'); g.rect(cx - 1, 3, 2, 1, 'table'); entity(map, 'resident', { kind: 'resident', x: cx + 2, y: 4, wander: 1 }); }
  g.set(cx, h - 1, 'wall'); g.set(cx, h - 2, 'mat'); map.mats.push({ x: cx, y: h - 2, inner: [cx, h - 3] });
  return finish(g, map);
}

/** Every map, warps, spawn and problems. Deterministic for (config, seed). */
export function generateOverworld(cfg, seed) {
  const areas = cfg.start ? [cfg.areas.find(a => a.id === cfg.start), ...cfg.areas.filter(a => a.id !== cfg.start)] : cfg.areas;
  const links = planLinks(areas), byId = new Map(areas.map(a => [a.id, a])), start = areas[0];
  const exitsOf = id => links.filter(l => l.type === 'edge' && (l.a === id || l.b === id)).map(l => ({ side: l.sides[id], to: l.a === id ? l.b : l.a, gate: l.gate[id] || null }));
  const roomDoorsOf = id => links.filter(l => l.type === 'door' && l.host === id).map(l => ({ room: l.room, roomKind: byId.get(l.room).kind, gate: l.gate[id] || null }));
  const doorLinked = id => links.some(l => l.type === 'door' && l.room === id);
  const maps = {}, problems = [];
  let attempts = 0, fallback = false;
  for (const a of areas) {
    const exits = exitsOf(a.id);
    let best = null;
    for (let attempt = 0; attempt < cfg.attempts; attempt++) {
      const r = stream(seed, a.id, attempt); attempts++;
      const map = a.kind === 'town' ? genTown(cfg, a, exits, roomDoorsOf(a.id), r, a === start) : a.kind === 'route' || a.kind === 'cave' ? genOutdoor(cfg, a, exits, r, { cave: a.kind === 'cave', attempt })
        : a.kind === 'gym' ? genGym(cfg, a, exits, doorLinked(a.id), r) : a.kind === 'league' ? genLeague(cfg, a, exits, doorLinked(a.id)) : genInterior(cfg, a, exits, doorLinked(a.id));
      map.problems = checkMap(map); map.attempt = attempt;
      if (!best || map.problems.length < best.problems.length) best = map;
      if (!map.problems.length) break;
    }
    if (best.attempt >= cfg.plainAfter) fallback = true;
    maps[a.id] = best; problems.push(...best.problems);
    if (a.kind === 'town') for (const b of best.buildings) if (b.target.startsWith(`${a.id}-`)) maps[b.target] = genBuilt(cfg, a, b.kind, b.target, stream(seed, b.target)), maps[b.target].problems = checkMap(maps[b.target]), problems.push(...maps[b.target].problems);
  }
  // Warps: edge openings pair tile-for-tile; doors pair with their room's mat (or bottom opening).
  const warps = [], add = (map, x, y, to, tx, ty, facing, kind) => { const w = { map: map.id, x, y, toMap: to, to, tx, ty, facing, kind }; map.warps.push(w); warps.push(w); };
  for (const map of Object.values(maps)) {
    for (const o of map.openings) {
      const other = maps[o.to], back = other?.openings.find(p => p.to === map.area && p.side === OPP[o.side]) || other?.openings.find(p => p.to === map.area);
      if (!back) { problems.push(problem('warp_unpaired', `maps.${map.id}`, `map '${map.id}' exit to '${o.to}' has no opening back`)); continue; }
      o.tiles.forEach(([x, y], i) => { const [tx, ty] = back.inner[Math.min(i, back.inner.length - 1)]; add(map, x, y, other.id, tx, ty, SIDE_DIR[o.side], 'edge'); });
    }
    for (const d of map.doors) {
      const room = maps[d.to]; if (!room) { problems.push(problem('warp_unpaired', `maps.${map.id}`, `door to '${d.to}' leads nowhere`)); continue; }
      const mat = room.mats[0] || null, open = room.openings[0] || null;
      if (mat) { add(map, d.x, d.y, room.id, mat.inner[0], mat.inner[1], 'up', 'door'); if (!room.warps.some(w => w.kind === 'mat')) add(room, mat.x, mat.y, map.id, d.x, d.y + 1, 'down', 'mat'); }
      else if (open) add(map, d.x, d.y, room.id, open.inner[0][0], open.inner[0][1], 'up', 'door');
    }
  }
  // Whole-world proof: walking inside maps and taking warps reaches every map from the spawn.
  const lab = Object.values(maps).find(m => m.room === 'lab'), spawn = lab ? { map: lab.id, ...lab.spawn } : { map: start.id, ...firstWalkable(maps[start.id]) };
  const seenMaps = new Set(), seenTiles = new Map(), q = [[spawn.map, spawn.x, spawn.y]];
  while (q.length) {
    const [mid, x, y] = q.shift(), map = maps[mid], k = `${x},${y}`;
    if (!map || (seenTiles.get(mid) || new Set()).has(k)) continue;
    const dist = reach(map, [x, y], new Set(map.entities.filter(e => e.kind !== 'guard' && e.solid !== false).map(e => `${e.x},${e.y}`)));
    seenMaps.add(mid); const set = seenTiles.get(mid) || new Set(); for (const t of dist.keys()) set.add(t); seenTiles.set(mid, set);
    for (const w of map.warps) if (set.has(`${w.x},${w.y}`) || [[0, 1], [1, 0], [0, -1], [-1, 0]].some(([dx, dy]) => set.has(`${w.x + dx},${w.y + dy}`))) if (!(seenTiles.get(w.to) || new Set()).has(`${w.tx},${w.ty}`)) q.push([w.to, w.tx, w.ty]);
  }
  for (const id of Object.keys(maps)) if (!seenMaps.has(id)) problems.push(problem('map_unreachable', `maps.${id}`, `map '${id}' cannot be reached from the spawn`));
  const respawns = Object.fromEntries(Object.values(maps).filter(m => m.respawn).map(m => [m.area, { map: m.id, ...m.respawn }]));
  return { maps, warps, spawn, respawns, links: links.map(l => ({ a: l.a, b: l.b, type: l.type, gate: l.gate })), problems, attempts, fallback };
}
function firstWalkable(map) { const y0 = Math.floor(map.h / 2); for (let d = 0; d < map.h; d++) for (const y of [y0 + d, y0 - d]) for (let x = 0; x < map.w; x++) if (map.tiles[y]?.[x] && walkable(map.tiles[y][x])) return { x, y }; return { x: 0, y: 0 }; }
