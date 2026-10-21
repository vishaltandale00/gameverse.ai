// Room-and-corridor dungeons with a lock/key graph (Zelda/Isaac/chalice style).
// Rooms grow as a tree over a slot grid from the start room (`branching` 0 →
// long winding paths, 1 → bushy); the boss sits in the farthest leaf; one lock
// per key is placed on the start→boss path, splitting it into regions; each
// key goes into a room of an earlier region (preferring a side branch of the
// region just before its lock), so every key is placed before its lock; loops
// are added only inside a region so no lock can be bypassed; dead ends get loot.
// Proof: a fixpoint walk from the start that opens a lock only when its key
// has been reached must visit every room (logical graph), and on spaces with
// editCells the carved cells are walked the same way (doors block until their
// key). Failing sub-seeds retry; the fallback is a straight chain.
// Works on any space with `position`: cells are carved when the space has
// editCells; positions map onto the 'xy' or 'xz' plane.
import { withDefaults, bodyCells, drawSeed, stream, Raster, spaceOf, zoneRect, cellWriter, planeAt, publish, spawnAt, placeOn, cellOfEntity, vocabulary, problem, inRect, docSpace } from './generate2d-lib.js';

const ID = 'engine.generate.dungeon.rooms';
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export default {
  id: ID,
  card: {
    intent: 'Generates a room-and-corridor dungeon with keys always placed before their locks, a boss room, loot in dead ends, and proves it solvable from the start.',
    views: ['td', '3p', 'iso', 'side'],
    spaces: ['engine.space.tilemap', 'engine.space.grid', 'engine.space.mesh3d'],
    // The crawl: explore the rooms, pick up the keys, open their locks and defeat the boss its boss room holds. It exists
    // only where the dungeon holds a boss (applies: boss given); a dungeon without one is a world, not a game of its own.
    // The win is the boss encounter's (gameplay.combat.boss bosses[].onDefeat); defeat comes from health and death
    // rules. Its bot plays it on cell spaces (navigate: it plans over the walker's moves and the space's cells).
    mode: { loop: 'crawl', applies: { param: 'boss', given: true }, via: 'gameplay.combat.boss', interaction: 'avatar-grid', opponent: 'hazards', space: ['engine.space.grid', ['navigate']], needs: { content: ['content.archetypes'], participants: null },
      progress: ['key_found', 'unlocked'],
      win: { param: 'bosses.onDefeat', reads: { component: 'health', of: 'opponents', by: { events: ['died'], effects: ['damage'] } } }, lose: { param: null }, bot: 'crawl' },
    params: {
      rooms: { type: 'integer', min: 3, max: 80, default: 12, scale: 'world', per: 'area' },
      branching: { type: 'number', min: 0, max: 1, default: 0.3, effect: '0 long paths, 1 bushy; also loop chance inside a region' },
      keys: { type: 'list', of: { type: 'ref', to: 'item' }, default: [], effect: 'one lock per key, in order along the path to the boss' },
      loot: { type: 'ref', to: 'table', effect: 'loot table recorded on dead-end chests' },
      boss: { type: 'ref', to: 'archetype', effect: 'spawned in the boss room' },
      zone: { type: 'ref', to: 'zone', effect: 'area to fill (rect or bounds); default the whole space' },
      area: { type: 'list', of: { type: 'number' }, min: 4, max: 4, scale: 'world', effect: '[x0,y0,x1,y1) on the plane, overrides zone' },
      plane: { type: 'string', options: ['xy', 'xz'], default: 'xy', effect: 'xz for 3D spaces (y = floor)' },
      floor: { type: 'number', default: 0, effect: 'height for the xz plane' },
      cell: { type: 'number', min: 0.5, max: 512, default: 4, unit: 'm', scale: 'world', effect: '3D world models (mesh3d): metres per dungeon cell; walls become box colliders' },
      wallHeight: { type: 'number', min: 1, max: 200, default: 6, unit: 'm', effect: '3D world models: wall and door height' },
      guards: { type: 'ref', to: 'archetype', effect: 'spawned in every room but the start (guardsPerRoom each)' },
      guardsPerRoom: { type: 'integer', min: 0, max: 8, default: 1 },
      roomSize: { type: 'list', of: { type: 'integer', min: 3 }, min: 2, max: 2, default: [5, 9], effect: 'room side range in cells' },
      corridor: { type: 'integer', min: 1, max: 4, default: 1, effect: 'corridor width in cells' },
      palette: { type: 'object', default: {}, fields: { wall: { type: 'ref', to: 'block', default: 'stone', effect: 'dungeon walls' }, door: { type: 'ref', to: 'block', default: 'locked_door', effect: 'locked doors' } } },
      archetypes: { type: 'object', default: {}, fields: { key: { type: 'ref', to: 'archetype', default: 'key', effect: 'spawned for each key' }, lock: { type: 'ref', to: 'archetype', default: 'locked_door', effect: 'spawned at each lock' }, chest: { type: 'ref', to: 'archetype', default: 'chest', effect: 'spawned in dead ends' } } },
      autoPickup: { type: 'boolean', default: true, effect: 'the player picks up a key by stepping on it (give_item if the inventory exists, else flag has:<item>)' },
      autoUnlock: { type: 'boolean', default: true, effect: 'a lock opens when the player reaches it holding its key' },
      placePlayer: { type: 'boolean', default: true },
      attempts: { type: 'integer', min: 0, max: 16, default: 6 },
    },
    provides: { content: ['cells', 'rooms', 'entities'], extent: 'own', events: ['generated', 'generated:*', 'generate_problem', 'unlocked', 'unlocked:*', 'key_found', 'key_found:*'], services: ['generation', 'dungeon'] },
    requires: { capabilities: ['position'] },
    reads: ['content.tables'], // loot names a table
    defines: [],
    // The guarantee: the published `targets` (every room centre) are reachable from `from` by the player's body, keys
    // before their locks.
    traversal: { mover: 'player', problems: ['cells_unreachable', 'dungeon_unsolvable', 'room_unreachable'] },
    problems: ['dungeon_unsolvable', 'room_unreachable', 'key_behind_lock', 'cells_unreachable', 'dungeon_cramped', 'dungeon_fallback'],
    rules: {
      dungeon_area_small: { fields: ['rooms', 'roomSize', 'area'], message: 'rooms is at most the room slots the area holds (each slot is roomSize[1] + 3 cells a side)' },
      dungeon_keys_many: { fields: ['rooms', 'keys'], message: 'rooms is at least the number of keys + 2 (a lock per key needs a room before it and the boss room after it)' },
    },
  },
  /**
   * Planner hook (v2/planner/world.js), grid and top-down tilemap spaces: as many rooms as the space's slot grid
   * holds (3..12, room sides shrunk until at least three fit), walls of the document's first plain solid block
   * (else a declared 'stone'), chests declared when the document has none. null on a side-view tilemap.
   */
  scaffold(space, doc, { registry = null } = {}) {
    if (!this.card.spaces.includes(space.use)) return null;
    const config = { ...(registry ? Object.fromEntries(Object.entries(registry.get(space.use)?.card.params || {}).filter(([, v]) => v.default !== undefined).map(([k, v]) => [k, v.default])) : {}), ...(space.with || {}) };
    if (space.use === 'engine.space.tilemap' && config.mode !== 'topdown') return null;
    const archetypes = doc.content?.archetypes || [], add = { blocks: [], archetypes: [], items: [] };
    const need = (id, name) => { if (!archetypes.some(a => a?.id === id) && !add.archetypes.some(a => a.id === id)) add.archetypes.push({ id, components: { name } }); };
    const finish = out => { const content = Object.fromEntries(Object.entries(add).filter(([, v]) => v.length)); return { ...out, ...(Object.keys(content).length ? { content } : {}) }; };
    need('chest', 'Chest');
    // An adversary the document declares (an archetype other than the player's with ai or health) guards the rooms and the boss room.
    const foe = archetypes.find(a => a?.id && a.id !== doc.player?.archetype && (a.components?.ai || a.components?.brain))?.id ?? archetypes.find(a => a?.id && a.id !== doc.player?.archetype && a.components?.health)?.id;
    if (space.use === 'engine.space.mesh3d') {
      // Rooms over the whole world: a slot grid of `cols` × `cols` slots of 12 cells, the cell sized so it spans the space.
      const [W, D] = Array.isArray(config.size) ? config.size : [2048, 2048], zones = (space.zones || []).length;
      const rooms = Math.max(9, Math.min(36, (zones || 4) * 4)), cols = Math.ceil(Math.sqrt(rooms)), cell = Math.floor((Math.min(W, D) / (cols * 12)) * 100) / 100;
      const keys = rooms >= 9 ? ['dungeon_key_1', 'dungeon_key_2'] : [];
      for (const [i, id] of keys.entries()) if (!(doc.content?.items || []).some(x => x?.id === id)) add.items.push({ id, name: `Dungeon key ${i + 1}` });
      if (keys.length) { need('key', 'Key'); need('locked_door', 'Locked door'); }
      return finish({ with: { plane: 'xz', rooms, roomSize: [5, 9], cell, wallHeight: +Math.max(4, Math.min(40, cell * 0.4)).toFixed(2), keys, ...(foe ? { guards: foe, guardsPerRoom: 1, boss: foe } : {}) } });
    }
    const [W, H] = Array.isArray(config.size) ? config.size : [0, 0];
    let pick = null;
    for (const max of [9, 7, 5, 4]) { const slot = max + 3, cap = Math.floor(W / slot) * Math.floor(H / slot); if (cap >= 3) { pick = { roomSize: [Math.min(5, max), max], rooms: Math.min(12, cap) }; break; } }
    if (!pick) return null;
    const blocks = doc.content?.blocks || [];
    const wall = blocks.find(b => b?.id && b.solid !== false && !(b.tags || []).some(t => ['hazard', 'liquid', 'one_way', 'oneway'].includes(t)))?.id ?? (add.blocks.push({ id: 'stone', name: 'Stone', solid: true }), 'stone');
    return finish({ with: { ...pick, palette: { wall } } });
  },
  /** The area the dungeon fills on its plane: area, else its zone's rect, else the whole space (provides.extent: 'own'). */
  extentOf(raw, space) {
    const config = withDefaults(this.card, raw), size = space?.with?.size;
    return config.area || zoneRect((space?.zones || []).find(z => z.id === config.zone), config.plane) || (Array.isArray(size) ? [0, 0, size[0], config.plane === 'xz' ? size[2] ?? size[1] : size[1]] : null);
  },
  /** Params that make the dungeon fill rect [x0, y0, x1, y1): that area, with as many rooms as it holds (3..80). */
  fit(raw, rect) {
    const config = withDefaults(this.card, raw), slot = config.roomSize[1] + 3, cap = Math.floor((rect[2] - rect[0]) / slot) * Math.floor((rect[3] - rect[1]) / slot);
    return cap >= 3 ? { area: rect.slice(0, 4), rooms: Math.max(3, Math.min(80, cap, config.rooms)) } : null;
  },
  logic(logic) {
    logic.effect('open_lock', { run: (e, rt) => rt.caches.dungeonLocks?.get(e.lock)?.(rt) });
  },
  validate(raw, doc, ctx, inst = {}) {
    const config = withDefaults(this.card, raw);
    // The area: area, else its zone's rect, else the whole space (every space it fills has a size, declared or default).
    const errors = [], { space: sp, config: spc } = docSpace(doc, ctx, inst, ID);
    const mesh = sp?.use === 'engine.space.mesh3d', plane = mesh ? 'xz' : config.plane, size = spc.size;
    const metres = config.area || zoneRect((sp?.zones || []).find(z => z.id === config.zone), plane) || (Array.isArray(size) ? [0, 0, size[0], mesh ? size[1] : size[plane === 'xz' ? 2 : 1] ?? size[1]] : null);
    const area = metres && mesh ? metres.map(v => v / config.cell) : metres;
    if (area) { const slot = config.roomSize[1] + 3, cap = Math.floor((area[2] - area[0]) / slot) * Math.floor((area[3] - area[1]) / slot); if (cap < config.rooms && !config.zone) errors.push(problem('dungeon_area_small', 'rooms', `the area fits ${cap} room slots; ${config.rooms} rooms requested`, { hint: 'enlarge the area or shrink roomSize' })); }
    if (config.keys.length > config.rooms - 2) errors.push(problem('dungeon_keys_many', 'keys', `${config.keys.length} keys need at least ${config.keys.length + 2} rooms`));
    return errors;
  },
  install(rt, raw, instance) {
    const config = withDefaults(this.card, raw), space = spaceOf(rt, instance), seed = drawSeed(rt);
    // A 3D world model (mesh3d): plan on a grid of `cell`-metre cells over the xz plane; walls and doors become box objects.
    const model3d = rt.caches[`worlds3d:model:${space.sid}`] || null, C = model3d ? config.cell : 1, plane = model3d ? 'xz' : config.plane;
    const sz = model3d ? [space.api.size[0], 0, space.api.size[1]] : space.size || [64, 64, 64];
    const metres = config.area || zoneRect(space.zone(config.zone), plane) || [0, 0, sz[0], plane === 'xz' ? sz[2] ?? sz[1] : sz[1]];
    const area = model3d ? [Math.ceil(metres[0] / C), Math.ceil(metres[1] / C), Math.floor(metres[2] / C), Math.floor(metres[3] / C)] : metres;
    const carve = !model3d && (typeof space.api.setCell === 'function' || typeof space.api.bake === 'function');
    // The cell proof walks the player's body (card.traversal): its footprint in plan cells on the plane.
    const body = bodyCells(rt, space, { axes: plane === 'xz' ? [0, 2] : [0, 1], unit: C });
    const d = generateDungeon(config, area, seed, carve || Boolean(model3d), body);
    const at = model3d ? (u, v) => [(u + 0.5) * C, config.floor, (v + 0.5) * C] : (u, v) => planeAt(config.plane, u, v, config.floor);
    if (carve) { const w = cellWriter(rt, space); for (const c of d.cells) w.set(at(c[0], c[1]), c[2]); w.flush(); }
    const doorIds = new Map();
    if (model3d) {
      const wall = new Set(d.cells.filter(c => c[2] === config.palette.wall).map(c => `${c[0]},${c[1]}`)), objs = [], key = instance.key.replace(/[^a-z0-9]+/gi, '_');
      const box = (id, kind, u0, v0, nu, nv) => ({ id, kind, group: key, role: kind, shape: 'box', at: [(u0 + nu / 2) * C, 0, (v0 + nv / 2) * C], size: [nu * C, config.wallHeight, nv * C], rot: 0 });
      // Horizontal runs of two or more wall cells, then the single cells left merged into vertical runs.
      const rows = new Map(); for (const k of wall) { const [u, v] = k.split(',').map(Number); (rows.get(v) || rows.set(v, []).get(v)).push(u); }
      const single = new Set();
      for (const [v, us] of [...rows].sort((a, b) => a[0] - b[0])) {
        us.sort((a, b) => a - b);
        for (let i = 0; i < us.length;) { let j = i; while (j + 1 < us.length && us[j + 1] === us[j] + 1) j++; if (j > i) objs.push(box(`${key}~wall${objs.length}`, 'wall', us[i], v, j - i + 1, 1)); else single.add(`${us[i]},${v}`); i = j + 1; }
      }
      const cols = new Map(); for (const k of single) { const [u, v] = k.split(',').map(Number); (cols.get(u) || cols.set(u, []).get(u)).push(v); }
      for (const [u, vs] of [...cols].sort((a, b) => a[0] - b[0])) { vs.sort((a, b) => a - b); for (let i = 0; i < vs.length;) { let j = i; while (j + 1 < vs.length && vs[j + 1] === vs[j] + 1) j++; objs.push(box(`${key}~wall${objs.length}`, 'wall', u, vs[i], 1, j - i + 1)); i = j + 1; } }
      for (const l of d.locks) l.cells.forEach(([u, v], k) => { const id = `${l.id}~door${k}`; objs.push(box(id, 'door', u, v, 1, 1)); (doorIds.get(l.id) || doorIds.set(l.id, []).get(l.id)).push(id); });
      model3d.contribute(`dungeon#${instance.key}`, 50, m => m.addObjects(objs.map(o => ({ ...o, at: [o.at[0], (m.surfaceY ? m.surfaceY(o.at[0], o.at[2]) : 0) + config.floor, o.at[2]] }))));
    }
    const center = r => at(Math.floor((r.rect[0] + r.rect[2]) / 2), Math.floor((r.rect[1] + r.rect[3]) / 2));
    for (const k of d.keys) spawnAt(rt, space, config.archetypes.key, at(...k.at), { pickup: { item: k.item, count: 1, dungeon: instance.key } }, `${instance.key.replace(/[^a-z0-9]+/gi, '_')}_key_${k.lock}`.toLowerCase());
    for (const l of d.locks) spawnAt(rt, space, config.archetypes.lock, at(...l.at), { lock: { key: l.key, id: l.id, open: false } }, l.id);
    for (const c of d.chests) spawnAt(rt, space, config.archetypes.chest, at(...c.at), { loot: { table: config.loot ?? null }, chest: { room: c.room } });
    if (config.boss) spawnAt(rt, space, config.boss, center(d.rooms[d.boss]), { boss: { dungeon: instance.key } });
    if (config.guards && config.guardsPerRoom) {
      const g = stream(seed, 'guards');
      d.rooms.forEach((rm, i) => { if (i === d.start) return; for (let n = 0; n < config.guardsPerRoom; n++) { const [x0, y0, x1, y1] = rm.rect; spawnAt(rt, space, config.guards, at(x0 + 1 + g.int(Math.max(1, x1 - x0 - 2)), y0 + 1 + g.int(Math.max(1, y1 - y0 - 2))), { guard: { room: rm.id, dungeon: instance.key } }); } });
    }
    const st = () => rt.store(instance.key);
    // Locks: opened by the open_lock effect or (autoUnlock) when the player arrives holding the key.
    const items = () => vocabulary(rt, 'predicate', 'item') && vocabulary(rt, 'effect', 'give_item');
    const hasItem = item => (items() ? rt.test({ item }) : Boolean(rt.state.flags[`has:${item}`]));
    const open = id => rt => {
      const s = st(), l = s.locks.find(x => x.id === id); if (!l || s.opened.includes(id)) return;
      s.opened.push(id);
      if (carve) { const w = cellWriter(rt, space); for (const c of l.cells) w.set(at(c[0], c[1]), null); w.flush(); }
      for (const door of doorIds.get(id) || []) space.api.removeObject?.(door, rt);
      const e = rt.entity(id); if (e) { e.components.lock.open = true; rt.despawn(id); }
      rt.emitTyped('unlocked', id, { key: l.key });
    };
    (rt.caches.dungeonLocks ??= new Map());
    for (const l of d.locks) rt.caches.dungeonLocks.set(l.id, open(l.id));
    const near = model3d ? (e, p, r = 1.5) => Math.hypot(e.at[0] - p[0], e.at[2] - p[2]) <= r * C : (e, p, r = 1.5) => { const a = cellOfEntity(space, e); return Math.hypot(...[0, 1, 2].map(i => (a[i] ?? 0) - (p[i] ?? 0))) <= r; };
    rt.system('interaction', rt => {
      const p = rt.player(), s = st(); if (!p || p.space !== space.sid) return;
      if (config.autoPickup) for (const k of s.keys) if (!s.found.includes(k.item) && near(p, at(...k.at), 1)) {
        s.found.push(k.item);
        if (items()) rt.run([{ do: 'give_item', item: k.item }]); else rt.state.flags[`has:${k.item}`] = true;
        const id = `${instance.key.replace(/[^a-z0-9]+/gi, '_')}_key_${k.lock}`.toLowerCase(); if (rt.entity(id)) rt.despawn(id);
        rt.emitTyped('key_found', k.item, { lock: k.lock });
      }
      if (config.autoUnlock) for (const l of s.locks) if (!s.opened.includes(l.id) && near(p, at(...l.at), 1.6) && hasItem(l.key)) open(l.id)(rt);
    }, ID);
    if (config.placePlayer) rt.on('spawn', ev => { if (ev.id !== 'player') return; const p = rt.player(); if (p?.space === space.sid) placeOn(rt, space, p, center(d.rooms[d.start])); });
    const { cells, ...data } = d;
    const centreCell = rm => [Math.floor((rm.rect[0] + rm.rect[2]) / 2), Math.floor((rm.rect[1] + rm.rect[3]) / 2)];
    const proof = carve ? { from: at(...centreCell(d.rooms[d.start])), targets: d.rooms.map(rm => ({ id: `room_${rm.id}`, cells: [at(...centreCell(rm))] })) } : {};
    publish(rt, instance, space, ID, { ...data, ...proof, opened: [], found: [], carved: carve, built: Boolean(model3d), cell: C, plane }, { dungeon: {
      rooms: () => st().rooms, start: () => st().start, boss: () => st().boss, locks: () => st().locks, keys: () => st().keys,
      roomAt: p => { const u = p[0] / C, v = (plane === 'xz' ? p[2] : p[1]) / C; return st().rooms.findIndex(r => inRect(r.rect, Math.floor(u), Math.floor(v))); },
      isOpen: id => st().opened.includes(id), problems: () => st().problems,
    } });
  },
};

/** Pure generation with proof and retries. area = [x0,y0,x1,y1) on the plane. */
export function generateDungeon(config, area, seed, carve = true, body = [1, 1]) {
  let best = null;
  for (let attempt = 0; attempt <= config.attempts; attempt++) {
    const fallback = attempt === config.attempts, r = stream(seed, 'dungeon', attempt);
    const d = build(config, area, r, fallback, carve, body);
    if (fallback) d.problems.unshift(problem('dungeon_fallback', 'branching', 'no solvable layout from the sub-seeds; using a straight chain'));
    if (!best || d.problems.length < best.problems.length) best = { ...d, attempts: attempt + 1, fallback };
    if (!d.problems.length) break;
  }
  return best;
}

function build(config, area, r, chain, carve, body = [1, 1]) {
  const slot = config.roomSize[1] + 3, C = Math.max(1, Math.floor((area[2] - area[0]) / slot)), R = Math.max(1, Math.floor((area[3] - area[1]) / slot));
  const N = Math.min(config.rooms, C * R), problems = [];
  if (N < config.rooms) problems.push(problem('dungeon_cramped', 'rooms', `only ${N} of ${config.rooms} rooms fit the area`));
  // 1. Tree growth over slots.
  const slots = [], at = new Map(), edges = [], key = (c, rr) => `${c},${rr}`;
  const add = (c, rr, parent) => { const i = slots.length; slots.push({ c, r: rr, parent, depth: parent === null ? 0 : slots[parent].depth + 1 }); at.set(key(c, rr), i); if (parent !== null) edges.push({ a: parent, b: i, lock: null }); return i; };
  add(Math.floor(C / 2), chain ? 0 : Math.floor(R / 2), null);
  let last = 0;
  for (let guard = 0; slots.length < N && guard < N * 50; guard++) {
    const from = chain || !r.chance(config.branching) ? last : r.int(slots.length);
    const free = DIRS.map(([dx, dy]) => [slots[from].c + dx, slots[from].r + dy]).filter(([c, rr]) => c >= 0 && rr >= 0 && c < C && rr < R && !at.has(key(c, rr)));
    if (!free.length) { last = r.int(slots.length); continue; }
    const [c, rr] = chain ? free.sort((p, q) => (q[1] - p[1]) || (p[0] - q[0]))[0] : r.pick(free);
    last = add(c, rr, from);
  }
  const n = slots.length, kids = slots.map(() => []);
  for (const e of edges) kids[e.a].push(e.b);
  // 2. Boss: the deepest leaf. Main path start→boss.
  const leaves = slots.map((s, i) => i).filter(i => i && !kids[i].length);
  const boss = (leaves.length ? leaves : [n - 1]).reduce((a, b) => (slots[b].depth > slots[a].depth ? b : a));
  const path = []; for (let i = boss; i !== null; i = slots[i].parent) path.unshift(i);
  // 3. Locks on main-path edges, evenly spaced; regions by locks crossed from the start.
  const K = Math.min(config.keys.length, Math.max(0, path.length - 2)), locks = [];
  for (let k = 0; k < K; k++) {
    const idx = Math.max(1, Math.min(path.length - 1, Math.round(((k + 1) * path.length) / (K + 1))));
    const e = edges.find(x => x.b === path[idx]); if (e && e.lock === null) { e.lock = k; locks.push({ k, edge: e }); }
  }
  if (K < config.keys.length) problems.push(problem('dungeon_cramped', 'keys', `only ${K} of ${config.keys.length} locks fit the path to the boss`));
  const region = slots.map(() => 0);
  const order = [0]; for (let i = 0; i < order.length; i++) for (const b of kids[order[i]]) { const e = edges.find(x => x.a === order[i] && x.b === b); region[b] = region[order[i]] + (e.lock !== null ? 1 : 0); order.push(b); }
  // 4. Keys: lock k's key in region ≤ k, preferring region k off the main path, deepest first.
  const onPath = new Set(path), used = new Set([0, boss]), keys = [];
  for (const { k } of locks.sort((a, b) => a.k - b.k)) {
    const cands = slots.map((s, i) => i).filter(i => !used.has(i) && region[i] <= k);
    const score = i => (region[i] === k ? 100 : 0) + (onPath.has(i) ? 0 : 50) + (kids[i].length ? 0 : 20) + slots[i].depth;
    const pick = cands.sort((a, b) => score(b) - score(a) || a - b)[0] ?? 0;
    used.add(pick); keys.push({ lock: k, item: config.keys[k], room: pick });
  }
  // 5. Loops inside a region only.
  if (!chain) for (let i = 0; i < n; i++) for (const [dx, dy] of [[1, 0], [0, 1]]) {
    const j = at.get(key(slots[i].c + dx, slots[i].r + dy)); if (j === undefined || j < i || region[i] !== region[j]) continue;
    if (!edges.some(e => (e.a === i && e.b === j) || (e.a === j && e.b === i)) && r.chance(config.branching * 0.35)) edges.push({ a: i, b: j, lock: null, loop: true });
  }
  // 6. Logical proof: fixpoint walk opening a lock only once its key's room is reached.
  const solve = () => {
    const seen = new Set([0]), have = new Set(); let grew = true;
    while (grew) { grew = false; for (const k of keys) if (seen.has(k.room) && !have.has(k.lock)) { have.add(k.lock); grew = true; }
      for (const e of edges) { const open = e.lock === null || have.has(e.lock); if (!open) continue; for (const [x, y] of [[e.a, e.b], [e.b, e.a]]) if (seen.has(x) && !seen.has(y)) { seen.add(y); grew = true; } } }
    return { seen, have };
  };
  const { seen } = solve();
  for (let i = 0; i < n; i++) if (!seen.has(i)) problems.push(problem('room_unreachable', `rooms`, `room ${i} cannot be reached`));
  for (const k of keys) if (region[k.room] > k.lock) problems.push(problem('key_behind_lock', `keys[${k.lock}]`, `key '${k.item}' lies behind its own lock`));
  if (!seen.has(boss)) problems.push(problem('dungeon_unsolvable', 'keys', 'the boss room cannot be reached'));
  // 7. Geometry: rooms inside slots, corridors between room centres; lock cells sit where a corridor leaves the parent room.
  const rooms = slots.map((s, i) => {
    const w = r.range(config.roomSize[0], config.roomSize[1]), h = r.range(config.roomSize[0], config.roomSize[1]);
    const x0 = area[0] + s.c * slot + 1 + r.int(slot - w - 1), y0 = area[1] + s.r * slot + 1 + r.int(slot - h - 1);
    return { id: i, rect: [x0, y0, x0 + w, y0 + h], depth: s.depth, region: region[i], kind: i === 0 ? 'start' : i === boss ? 'boss' : keys.some(k => k.room === i) ? 'key' : kids[i].length ? 'room' : 'dead_end' };
  });
  const cx = rm => Math.floor((rm.rect[0] + rm.rect[2]) / 2), cy = rm => Math.floor((rm.rect[1] + rm.rect[3]) / 2);
  const open = new Set(), cellKey = (x, y) => `${x},${y}`, lockCells = new Map();
  for (const rm of rooms) for (let y = rm.rect[1]; y < rm.rect[3]; y++) for (let x = rm.rect[0]; x < rm.rect[2]; x++) open.add(cellKey(x, y));
  const inRoom = (x, y, rm) => inRect(rm.rect, x, y);
  for (const e of edges) {
    const A = rooms[e.a], B = rooms[e.b], cw = config.corridor, horizontal = Math.abs(slots[e.a].c - slots[e.b].c) > 0;
    let x = cx(A), y = cy(A); const tx = cx(B), ty = cy(B), trail = [];
    const dig = () => { for (let j = 0; j < cw; j++) for (let i = 0; i < cw; i++) { const k = cellKey(horizontal ? x : x + i, horizontal ? y + j : y); open.add(k); trail.push(k); } };
    if (horizontal) { while (x !== tx) { dig(); x += Math.sign(tx - x); } while (y !== ty) { dig(); y += Math.sign(ty - y); } }
    else { while (y !== ty) { dig(); y += Math.sign(ty - y); } while (x !== tx) { dig(); x += Math.sign(tx - x); } }
    dig();
    if (e.lock !== null) { // the first corridor cells outside the parent room become the door
      const first = trail.find(k => { const [px, py] = k.split(',').map(Number); return !inRoom(px, py, A) && !inRoom(px, py, B); });
      if (first) { const [fx, fy] = first.split(',').map(Number); const door = trail.filter(k => { const [px, py] = k.split(',').map(Number); return horizontal ? px === fx : py === fy; }); lockCells.set(e.lock, door.map(k => k.split(',').map(Number))); }
    }
  }
  const lockList = locks.sort((a, b) => a.k - b.k).map(({ k, edge }) => ({ id: `lock_${k + 1}`, key: config.keys[k], room: edge.b, from: edge.a, cells: lockCells.get(k) || [], at: (lockCells.get(k) || [[cx(rooms[edge.b]), cy(rooms[edge.b])]])[0] }));
  // 8. Cell proof: walk the player's body (its footprint `body` [columns, rows] from its corner cell) over open cells
  // from the start room, doors passable once their key cell was covered; a cell is reached when the body covers it.
  if (carve) {
    const doorOf = new Map(); lockList.forEach((l, k) => l.cells.forEach(([x, y]) => doorOf.set(cellKey(x, y), k)));
    const keyAt = new Map(keys.map(k => [cellKey(cx(rooms[k.room]), cy(rooms[k.room])), k.lock]));
    const foot = (x, y) => { const out = []; for (let j = 0; j < body[1]; j++) for (let i = 0; i < body[0]; i++) out.push(cellKey(x + i, y + j)); return out; };
    const fits = (x, y) => foot(x, y).every(k => open.has(k)), locked = (x, y) => foot(x, y).some(k => doorOf.has(k) && !have.has(doorOf.get(k)));
    const seenC = new Set(), at = new Set(), have = new Set(), blockedQ = [];
    const cover = (x, y) => { for (const k of foot(x, y)) { seenC.add(k); if (keyAt.has(k)) have.add(keyAt.get(k)); } };
    const [sx, sy] = [cx(rooms[0]), cy(rooms[0])];
    let q = fits(sx, sy) ? [cellKey(sx, sy)] : []; q.forEach(k => at.add(k));
    while (q.length) {
      for (let i = 0; i < q.length; i++) {
        const [x, y] = q[i].split(',').map(Number); cover(x, y);
        for (const [dx, dy] of DIRS) { const k = cellKey(x + dx, y + dy); if (at.has(k) || !fits(x + dx, y + dy)) continue; if (locked(x + dx, y + dy)) { blockedQ.push(k); continue; } at.add(k); q.push(k); }
      }
      q = blockedQ.filter(k => { const [x, y] = k.split(',').map(Number); return !at.has(k) && !locked(x, y); }); q.forEach(k => at.add(k)); blockedQ.length = 0;
      if (!q.length) break;
    }
    const lost = rooms.filter(rm => !seenC.has(cellKey(cx(rm), cy(rm))));
    if (lost.length) problems.push(problem('cells_unreachable', 'rooms', `${lost.length} room centres cannot be walked to (rooms ${lost.map(x => x.id).join(', ')})`));
  }
  // Cells: walls ring every open cell; doors as door blocks; everything else untouched.
  const cells = [];
  if (carve) {
    const doors = new Map(); lockList.forEach(l => l.cells.forEach(([x, y]) => doors.set(cellKey(x, y), l)));
    const walls = new Set();
    for (const k of open) { const [x, y] = k.split(',').map(Number); for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const n2 = cellKey(x + i, y + j); if (!open.has(n2)) walls.add(n2); } }
    for (const k of walls) { const [x, y] = k.split(',').map(Number); cells.push([x, y, config.palette.wall]); }
    for (const k of open) { const [x, y] = k.split(',').map(Number); cells.push([x, y, doors.has(k) ? config.palette.door : null]); }
  }
  const chests = rooms.filter(rm => rm.kind === 'dead_end').map(rm => ({ room: rm.id, at: [cx(rm), cy(rm)] }));
  return { rooms, edges: edges.map(e => ({ a: e.a, b: e.b, lock: e.lock === null ? null : `lock_${e.lock + 1}`, loop: Boolean(e.loop) })), start: 0, boss, path,
    keys: keys.map(k => ({ ...k, at: [cx(rooms[k.room]), cy(rooms[k.room])] })), locks: lockList, chests, cells, problems };
}
