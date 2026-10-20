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
import { withDefaults, drawSeed, stream, Raster, spaceOf, zoneRect, cellWriter, planeAt, publish, spawnAt, placeOn, cellOfEntity, problem, inRect } from './generate2d-lib.js';

const ID = 'engine.generate.dungeon.rooms';
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export default {
  id: ID,
  card: {
    intent: 'Generates a room-and-corridor dungeon with keys always placed before their locks, a boss room, loot in dead ends, and proves it solvable from the start.',
    views: ['td', '3p', 'iso', 'side'],
    params: {
      rooms: { type: 'integer', min: 3, max: 80, default: 12 },
      branching: { type: 'number', min: 0, max: 1, default: 0.3, effect: '0 long paths, 1 bushy; also loop chance inside a region' },
      keys: { type: 'list', of: { type: 'ref', to: 'item' }, default: [], effect: 'one lock per key, in order along the path to the boss' },
      loot: { type: 'string', effect: 'loot table id recorded on dead-end chests' },
      boss: { type: 'ref', to: 'archetype', effect: 'spawned in the boss room' },
      zone: { type: 'ref', to: 'zone', effect: 'area to fill (rect or bounds); default the whole space' },
      area: { type: 'list', of: { type: 'number' }, min: 4, max: 4, effect: '[x0,y0,x1,y1) on the plane, overrides zone' },
      plane: { type: 'string', options: ['xy', 'xz'], default: 'xy', effect: 'xz for 3D spaces (y = floor)' },
      floor: { type: 'number', default: 0, effect: 'height for the xz plane' },
      roomSize: { type: 'list', of: { type: 'integer', min: 3 }, min: 2, max: 2, default: [5, 9], effect: 'room side range in cells' },
      corridor: { type: 'integer', min: 1, max: 4, default: 1, effect: 'corridor width in cells' },
      palette: { type: 'object', default: {}, fields: { wall: { type: 'string', default: 'stone' }, door: { type: 'string', default: 'locked_door' } } },
      archetypes: { type: 'object', default: {}, fields: { key: { type: 'string', default: 'key' }, lock: { type: 'string', default: 'locked_door' }, chest: { type: 'string', default: 'chest' } } },
      autoPickup: { type: 'boolean', default: true, effect: 'the player picks up a key by stepping on it (give_item if the inventory exists, else flag has:<item>)' },
      autoUnlock: { type: 'boolean', default: true, effect: 'a lock opens when the player reaches it holding its key' },
      placePlayer: { type: 'boolean', default: true },
      attempts: { type: 'integer', min: 0, max: 16, default: 6 },
    },
    provides: { events: ['generated', 'generated:*', 'generate_problem', 'unlocked', 'unlocked:*', 'key_found', 'key_found:*'], services: ['generation', 'dungeon'] },
    requires: { capabilities: ['position'] },
    defines: [],
    problems: ['dungeon_unsolvable', 'room_unreachable', 'key_behind_lock', 'cells_unreachable', 'dungeon_cramped', 'dungeon_fallback'],
    validates: ['dungeon_area_missing', 'dungeon_area_small', 'dungeon_keys_many'],
  },
  logic(logic) {
    logic.effect('open_lock', { run: (e, rt) => rt.caches.dungeonLocks?.get(e.lock)?.(rt) });
  },
  validate(raw, doc, ctx, inst = {}) {
    const config = withDefaults(this.card, raw);
    const errors = [], sp = doc.spaces.find(s => s.id === inst.space) || doc.spaces.find(s => (s.generators || []).some(g => g.use === ID));
    const area = config.area || zoneRect((sp?.zones || []).find(z => z.id === config.zone), config.plane) || (sp?.with?.size ? [0, 0, sp.with.size[0], sp.with.size[config.plane === 'xz' ? 2 : 1] ?? sp.with.size[1]] : null);
    if (!area) errors.push(problem('dungeon_area_missing', 'zone', 'give area, a zone with a rect/bounds, or a space with a size'));
    else { const slot = config.roomSize[1] + 3, cap = Math.floor((area[2] - area[0]) / slot) * Math.floor((area[3] - area[1]) / slot); if (cap < config.rooms && !config.zone) errors.push(problem('dungeon_area_small', 'rooms', `the area fits ${cap} room slots; ${config.rooms} rooms requested`, { hint: 'enlarge the area or shrink roomSize' })); }
    if (config.keys.length > config.rooms - 2) errors.push(problem('dungeon_keys_many', 'keys', `${config.keys.length} keys need at least ${config.keys.length + 2} rooms`));
    return errors;
  },
  install(rt, raw, instance) {
    const config = withDefaults(this.card, raw), space = spaceOf(rt, instance), seed = drawSeed(rt);
    const sz = space.size || [64, 64, 64];
    const area = config.area || zoneRect(space.zone(config.zone), config.plane) || [0, 0, sz[0], config.plane === 'xz' ? sz[2] ?? sz[1] : sz[1]];
    const carve = typeof space.api.setCell === 'function' || typeof space.api.bake === 'function';
    const d = generateDungeon(config, area, seed, carve);
    const at = (u, v) => planeAt(config.plane, u, v, config.floor);
    if (carve) { const w = cellWriter(rt, space); for (const c of d.cells) w.set(at(c[0], c[1]), c[2]); w.flush(); }
    const center = r => at(Math.floor((r.rect[0] + r.rect[2]) / 2), Math.floor((r.rect[1] + r.rect[3]) / 2));
    for (const k of d.keys) spawnAt(rt, space, config.archetypes.key, at(...k.at), { pickup: { item: k.item, count: 1, dungeon: instance.key } }, `${instance.key.replace(/[^a-z0-9]+/gi, '_')}_key_${k.lock}`.toLowerCase());
    for (const l of d.locks) spawnAt(rt, space, config.archetypes.lock, at(...l.at), { lock: { key: l.key, id: l.id, open: false } }, l.id);
    for (const c of d.chests) spawnAt(rt, space, config.archetypes.chest, at(...c.at), { loot: { table: config.loot ?? null }, chest: { room: c.room } });
    if (config.boss) spawnAt(rt, space, config.boss, center(d.rooms[d.boss]), { boss: { dungeon: instance.key } });
    const st = () => rt.store(instance.key);
    // Locks: opened by the open_lock effect or (autoUnlock) when the player arrives holding the key.
    const hasItem = (item) => rt.logic.predicates.has('item') ? rt.test({ item }) : Boolean(rt.state.flags[`has:${item}`]);
    const open = id => rt => {
      const s = st(), l = s.locks.find(x => x.id === id); if (!l || s.opened.includes(id)) return;
      s.opened.push(id);
      if (carve) { const w = cellWriter(rt, space); for (const c of l.cells) w.set(at(c[0], c[1]), null); w.flush(); }
      const e = rt.entity(id); if (e) { e.components.lock.open = true; rt.despawn(id); }
      rt.emitTyped('unlocked', id, { key: l.key });
    };
    (rt.caches.dungeonLocks ??= new Map());
    for (const l of d.locks) rt.caches.dungeonLocks.set(l.id, open(l.id));
    const near = (e, p, r = 1.5) => { const a = cellOfEntity(space, e); return Math.hypot(...[0, 1, 2].map(i => (a[i] ?? 0) - (p[i] ?? 0))) <= r; };
    rt.system('interaction', rt => {
      const p = rt.player(), s = st(); if (!p || p.space !== space.sid) return;
      if (config.autoPickup) for (const k of s.keys) if (!s.found.includes(k.item) && near(p, at(...k.at), 1)) {
        s.found.push(k.item);
        if (rt.logic.effects.has('give_item')) rt.run([{ do: 'give_item', item: k.item }]); else rt.state.flags[`has:${k.item}`] = true;
        const id = `${instance.key.replace(/[^a-z0-9]+/gi, '_')}_key_${k.lock}`.toLowerCase(); if (rt.entity(id)) rt.despawn(id);
        rt.emitTyped('key_found', k.item, { lock: k.lock });
      }
      if (config.autoUnlock) for (const l of s.locks) if (!s.opened.includes(l.id) && near(p, at(...l.at), 1.6) && hasItem(l.key)) open(l.id)(rt);
    }, ID);
    if (config.placePlayer) rt.on('spawn', ev => { if (ev.id !== 'player') return; const p = rt.player(); if (p?.space === space.sid) placeOn(rt, space, p, center(d.rooms[d.start])); });
    const { cells, ...data } = d;
    publish(rt, instance, space, ID, { ...data, opened: [], found: [], carved: carve, plane: config.plane }, { dungeon: {
      rooms: () => st().rooms, start: () => st().start, boss: () => st().boss, locks: () => st().locks, keys: () => st().keys,
      roomAt: p => { const u = p[0], v = config.plane === 'xz' ? p[2] : p[1]; return st().rooms.findIndex(r => inRect(r.rect, Math.floor(u), Math.floor(v))); },
      isOpen: id => st().opened.includes(id), problems: () => st().problems,
    } });
  },
};

/** Pure generation with proof and retries. area = [x0,y0,x1,y1) on the plane. */
export function generateDungeon(config, area, seed, carve = true) {
  let best = null;
  for (let attempt = 0; attempt <= config.attempts; attempt++) {
    const fallback = attempt === config.attempts, r = stream(seed, 'dungeon', attempt);
    const d = build(config, area, r, fallback, carve);
    if (fallback) d.problems.unshift(problem('dungeon_fallback', 'branching', 'no solvable layout from the sub-seeds; using a straight chain'));
    if (!best || d.problems.length < best.problems.length) best = { ...d, attempts: attempt + 1, fallback };
    if (!d.problems.length) break;
  }
  return best;
}

function build(config, area, r, chain, carve) {
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
  // 8. Cell proof: walk open cells from the start room, doors passable once their key cell was reached.
  if (carve) {
    const doorOf = new Map(); lockList.forEach((l, k) => l.cells.forEach(([x, y]) => doorOf.set(cellKey(x, y), k)));
    const keyAt = new Map(keys.map(k => [cellKey(cx(rooms[k.room]), cy(rooms[k.room])), k.lock]));
    const seenC = new Set(), have = new Set(), blockedQ = [];
    let q = [cellKey(cx(rooms[0]), cy(rooms[0]))]; seenC.add(q[0]);
    while (q.length) {
      for (let i = 0; i < q.length; i++) {
        const [x, y] = q[i].split(',').map(Number); if (keyAt.has(q[i])) have.add(keyAt.get(q[i]));
        for (const [dx, dy] of DIRS) { const k = cellKey(x + dx, y + dy); if (!open.has(k) || seenC.has(k)) continue; if (doorOf.has(k) && !have.has(doorOf.get(k))) { blockedQ.push(k); continue; } seenC.add(k); q.push(k); }
      }
      q = blockedQ.filter(k => !seenC.has(k) && have.has(doorOf.get(k))); q.forEach(k => seenC.add(k)); blockedQ.length = 0;
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
