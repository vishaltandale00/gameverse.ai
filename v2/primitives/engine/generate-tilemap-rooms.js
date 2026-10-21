// Authored-topology 2D rooms: the document fixes each room's rect, zone, style
// and exits; this fills them in (walls, ground, platforms, pits, water,
// hazards, one-way rungs, features) from a seed and PROVES every room traversable for
// the stated movement abilities: every exit reaches every other exit and every
// feature is reachable (side view: jump arcs, falls, one-way rungs, climb, swim — see
// generate2d-reach.js; top-down: 4-neighbour walking). Failed rooms retry with
// sub-seeds, then fall back to a plain layout (flat floor, staircase platforms,
// rungs under high exits) which is proven too. Declare the rung block one_way in content.blocks for
// real platformer spaces (testSpace treats every block as solid but only the proof walks it). Styles and palettes are data.
// Coordinates are tiles, y up; rect = [x0, y0, x1, y1) as space zones.
import { withDefaults, drawSeed, stream, Raster, clamp, spaceOf, zoneRect, cellWriter, publish, spawnAt, placeOn, cellOfEntity, problem, rectsOverlap, inRect } from './generate2d-lib.js';
import { ROLE, reachSide, reachTop, movementFor, ABILITY_EFFECTS } from './generate2d-reach.js';

const { EMPTY, SOLID, HAZARD, WATER, LADDER, ONEWAY } = ROLE;
const ID = 'engine.generate.tilemap.rooms';

/** Style recipes: ground depth below the floor, cave noise, water fraction, ceiling, default platforms. */
export const ROOM_STYLES = {
  hall: { ground: 1, platforms: 2, platformWidth: [3, 6] },
  cave: { ground: 1, noise: 0.42, smooth: 3, platforms: 2, platformWidth: [2, 5] },
  shaft: { ground: 1, platforms: 4, platformWidth: [3, 5], climb: true },
  arena: { ground: 1, platforms: 0, platformWidth: [4, 6], ledges: true },
  corridor: { ground: 1, ceiling: 6, platforms: 1, platformWidth: [3, 5] },
  village: { ground: 2, platforms: 0, platformWidth: [3, 6] },
  flooded: { ground: 1, water: 0.35, platforms: 3, platformWidth: [3, 5] },
};
const DEFAULT_PALETTE = { wall: 'stone', ground: 'stone', platform: 'plank', rung: 'rung', hazard: 'spikes', water: 'water', door: 'door' };

const feature = { type: 'object', open: true, fields: {
  kind: { type: 'string', required: true, effect: 'marker kind (bench, chest, npc, spawn, door, lever...)' },
  id: { type: 'string', effect: 'entity id for the marker' },
  at: { type: 'list', of: { type: 'number' }, effect: 'absolute tile position; omitted = a reachable floor tile chosen by the seed' },
  ref: { type: 'string', effect: 'archetype or character id (spawn, npc, boss_spawn)' },
  count: { type: 'integer', min: 1, max: 64, effect: 'copies to place' },
} };
const room = { type: 'object', fields: {
  id: { type: 'string', required: true },
  zone: { type: 'ref', to: 'zone', required: true },
  rect: { type: 'list', of: { type: 'integer' }, min: 4, max: 4, required: true, effect: '[x0,y0,x1,y1) in tiles' },
  style: { type: 'string', default: 'hall', effect: `one of the styles (${Object.keys(ROOM_STYLES).join('|')} or a key of params.styles)` },
  theme: { type: 'string', effect: 'palette override key in params.themes' },
  platforms: { type: 'integer', min: 0, max: 40 },
  gaps: { type: 'integer', min: 0, max: 12, effect: 'pits in the floor, never wider than the jump distance' },
  hazards: { type: 'list', of: { type: 'string' }, effect: 'hazard block ids placed on the floor' },
  features: { type: 'list', of: feature, default: [] },
  exits: { type: 'list', default: [], of: { type: 'object', fields: {
    side: { type: 'string', options: ['l', 'r', 't', 'b'], required: true },
    to: { type: 'ref', to: 'zone', effect: 'zone it leads to; unmatched exits become doors for a portal' },
    gate: { type: 'predicate', effect: 'progression gate (recorded on the exit; enforced by gate/portal primitives)' },
  } } },
  requiresAbilities: { type: 'list', of: { type: 'string' }, default: [], effect: 'extra abilities assumed inside this room' },
} };

export default {
  id: ID,
  card: {
    intent: 'Fills authored 2D room rects (side view or top-down) with walls, platforms, pits, water, hazards and features, and proves every room traversable for the stated movement abilities.',
    views: ['side', 'td'],
    params: {
      rooms: { type: 'list', of: room, min: 1, required: true },
      requiresAbilities: { type: 'list', of: { type: 'string' }, default: [], effect: 'abilities the proof assumes everywhere' },
      mode: { type: 'string', options: ['side', 'topdown'], default: 'side' },
      movement: { type: 'object', default: {}, fields: {
        jumpHeight: { type: 'number', min: 0, max: 20, unit: 'tiles' }, jumpDistance: { type: 'number', min: 0, max: 30, unit: 'tiles' },
        doubleJump: { type: 'boolean' }, dash: { type: 'number', min: 0, max: 20, unit: 'tiles' }, climb: { type: 'boolean' }, wallJump: { type: 'boolean' }, swim: { type: 'boolean' }, fly: { type: 'boolean' },
      }, effect: 'base movement the proof uses (tilemap ability names)' },
      abilities: { type: 'json', default: {}, effect: 'ability id → movement deltas, e.g. {"briar_grip":{"climb":true},"ember_step":{"dash":3}}' },
      styles: { type: 'json', default: {}, effect: 'extra or overriding style recipes' },
      palette: { type: 'object', open: true, default: {}, fields: Object.fromEntries(Object.keys(DEFAULT_PALETTE).map(k => [k, { type: 'string' }])), effect: 'role → block id' },
      themes: { type: 'json', default: {}, effect: 'theme → palette overrides' },
      exitSize: { type: 'integer', min: 1, max: 8, default: 3, unit: 'tiles' },
      attempts: { type: 'integer', min: 1, max: 32, default: 6, effect: 'sub-seeds tried per room before the plain fallback' },
      oneWayPlatforms: { type: 'boolean', default: false, effect: 'platforms can be jumped through from below (needs a one_way block)' },
      spawnFeatures: { type: 'boolean', default: true },
      doorWarp: { type: 'boolean', default: true, effect: 'stepping onto a door tile moves the player to the paired door (exit gates apply)' },
      keepClear: { type: 'list', default: [], of: { type: 'list', of: { type: 'integer' }, min: 4, max: 4 }, effect: 'rects [x0,y0,x1,y1) in tiles left empty (regions other primitives own, e.g. a falling-piece board); each must be reachable from the start' },
    },
    provides: { events: ['generated', 'generated:*', 'generate_problem', 'room_door', 'room_door:*', 'blocked'], services: ['generation', 'rooms'] },
    requires: { capabilities: ['position', 'editCells'] },
    problems: ['exit_unreachable', 'feature_unreachable', 'room_unreachable', 'room_isolated', 'exit_unmatched', 'door_unpaired', 'start_blocked', 'clear_unreachable'],
    validates: ['room_rect_invalid', 'room_overlap', 'room_outside_zone', 'room_outside_space', 'room_style_unknown', 'ability_unknown', 'room_duplicate'],
  },
  /**
   * Planner hook (v2/planner/world.js): a config that builds a world for a space that has none yet,
   * derived from the space's own zones. One room per zone rect (skipping zones too small for a room or
   * overlapping one already kept), an exit to every room it touches, tall side-view rooms as climbable
   * shafts, and the proof's movement taken from the document's movement envelope, so the generator only
   * builds what the player's real movement can traverse. -> { with, content? } or null.
   */
  scaffold(space, doc, { envelope = {}, reserve = [] } = {}) {
    const E = this.card.params.exitSize.default, mode = space.with?.mode === 'topdown' ? 'topdown' : 'side';
    const [W, H] = Array.isArray(space.with?.size) ? space.with.size : [Infinity, Infinity];
    const rooms = [];
    for (const z of space.zones || []) {
      const r = zoneRect(z); if (!r || !r.every(Number.isFinite)) continue;
      const rect = [Math.max(0, Math.ceil(r[0])), Math.max(0, Math.ceil(r[1])), Math.min(W, Math.floor(r[2])), Math.min(H, Math.floor(r[3]))];
      if (rect[2] - rect[0] < E + 2 || rect[3] - rect[1] < E + 3 || rooms.some(o => rectsOverlap(o.rect, rect))) continue;
      const tall = mode === 'side' && rect[3] - rect[1] >= 1.5 * (rect[2] - rect[0]);
      rooms.push({ id: z.id, zone: z.id, rect, style: tall ? 'shaft' : 'hall' });
    }
    if (!rooms.length) return null;
    const span = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);
    for (const a of rooms) a.exits = rooms.filter(b => b !== a).flatMap(b => {
      const [ax0, ay0, ax1, ay1] = a.rect, [bx0, by0, bx1, by1] = b.rect;
      const side = bx0 === ax1 ? 'r' : bx1 === ax0 ? 'l' : by0 === ay1 ? 't' : by1 === ay0 ? 'b' : null;
      const overlap = side === 'l' || side === 'r' ? span(ay0, ay1, by0, by1) : side ? span(ax0, ax1, bx0, bx1) : 0;
      return overlap >= E + 2 ? [{ side, to: b.zone }] : [];
    });
    // The proof's movement: the envelope's reach in whole tiles (rounded down, so the proof never assumes more
    // than the controller does). Wall climbing counts only for controllers that climb any wall.
    const tiles = (v, max) => Math.max(0, Math.min(max, Math.floor(v)));
    const movement = {};
    if (Number.isFinite(envelope.jumpHeight)) movement.jumpHeight = tiles(envelope.jumpHeight, 20);
    if (Number.isFinite(envelope.jumpGap)) movement.jumpDistance = tiles(envelope.jumpGap, 30);
    if (Number.isFinite(envelope.dash) && envelope.dash > 0) movement.dash = tiles(envelope.dash, 20);
    for (const k of ['doubleJump', 'wallJump', 'swim', 'fly']) if (envelope[k]) movement[k] = true;
    if (envelope.climb && envelope.climbSurfaces === 'any') movement.climb = true;
    // Palette from the document's own blocks where they fit, else blocks this config adds.
    const blocks = doc.content?.blocks || [], add = [];
    const tagged = (b, ...t) => (b.tags || []).some(x => t.includes(x));
    const solid = blocks.find(b => b?.id && b.solid !== false && !b.oneWay && !b.slope && !tagged(b, 'hazard', 'liquid', 'one_way', 'oneway'))?.id
      ?? (add.push({ id: 'stone', name: 'Stone', solid: true }), 'stone');
    const ledge = blocks.find(b => b?.id && (b.oneWay || tagged(b, 'one_way', 'oneway')))?.id
      ?? (add.push({ id: 'ledge', name: 'Ledge', solid: false, tags: ['one_way'] }), 'ledge');
    // A start on the built floor of the player's room (else the first room): the zone corner an outline
    // places the player at is inside the shell and the ground.
    const p = doc.player, here = p && (p.space ?? doc.spaces?.[0]?.id) === space.id;
    const at = here && Array.isArray(p.at) ? p.at : null;
    const room = (at && rooms.find(r => inRect(r.rect, Math.floor(at[0]), Math.floor(at[1])))) || rooms[0];
    const [x0, y0, x1, y1] = room.rect, floor = mode === 'side' ? 1 + (ROOM_STYLES[room.style].ground ?? 1) : 1;
    // Outside the regions other primitives keep clear when the room has room for it (nearest column to the old start).
    const sy = mode === 'side' ? y0 + floor + 1 : clamp(Math.floor(at?.[1] ?? y0 + 2), y0 + 2, y1 - 3);
    const want = clamp(Math.floor(at?.[0] ?? x0 + 2), x0 + 1, x1 - 2), kept = x => reserve.some(c => inRect(c, x, sy));
    const cols = Array.from({ length: x1 - x0 - 2 }, (_, i) => x0 + 1 + i).sort((a, b) => Math.abs(a - want) - Math.abs(b - want) || a - b);
    const cx = (cols.find(x => !kept(x)) ?? want) + 0.5;
    const start = mode === 'side' ? [cx, sy] : [cx, sy + 0.5];
    return {
      with: { mode, rooms, movement, palette: { wall: solid, ground: solid, platform: solid, rung: ledge }, ...(reserve.length ? { keepClear: reserve.map(r => r.map(Math.round)) } : {}) },
      ...(add.length ? { content: { blocks: add } } : {}),
      ...(here ? { start } : {}),
    };
  },
  validate(raw, doc, ctx, inst = {}) {
    const config = withDefaults(this.card, raw);
    const errors = [], styles = { ...ROOM_STYLES, ...config.styles }, sp = doc.spaces.find(s => s.id === inst.space) || doc.spaces.find(s => (s.zones || []).some(z => z.id === config.rooms[0]?.zone)) || null;
    const size = sp?.with?.size, zones = new Map((sp?.zones || []).map(z => [z.id, z])), ids = new Set();
    const known = a => a in (config.abilities || {}) || a in ABILITY_EFFECTS;
    config.requiresAbilities.forEach((a, i) => { if (!known(a)) errors.push(problem('ability_unknown', `requiresAbilities[${i}]`, `ability '${a}' has no movement effect`, { hint: 'map it in params.abilities' })); });
    config.rooms.forEach((r, i) => {
      const path = `rooms[${i}]`, [x0, y0, x1, y1] = r.rect || [];
      if (ids.has(r.id)) errors.push(problem('room_duplicate', `${path}.id`, `duplicate room '${r.id}'`)); ids.add(r.id);
      if (!(x1 - x0 >= config.exitSize + 2 && y1 - y0 >= config.exitSize + 3)) errors.push(problem('room_rect_invalid', `${path}.rect`, `room '${r.id}' must be at least ${config.exitSize + 2}×${config.exitSize + 3}`));
      if (!styles[r.style]) errors.push(problem('room_style_unknown', `${path}.style`, `unknown style '${r.style}'`, { hint: Object.keys(styles).join(', ') }));
      const z = zoneRect(zones.get(r.zone));
      if (z && !(x0 >= z[0] && y0 >= z[1] && x1 <= z[2] && y1 <= z[3])) errors.push(problem('room_outside_zone', `${path}.rect`, `room '${r.id}' extends outside zone '${r.zone}' ${JSON.stringify(z)}`));
      if (size && (x0 < 0 || y0 < 0 || x1 > size[0] || y1 > size[1])) errors.push(problem('room_outside_space', `${path}.rect`, `room '${r.id}' is outside the ${size[0]}×${size[1]} space`));
      (r.requiresAbilities || []).forEach((a, k) => { if (!known(a)) errors.push(problem('ability_unknown', `${path}.requiresAbilities[${k}]`, `ability '${a}' has no movement effect`, { hint: 'map it in params.abilities' })); });
      config.rooms.slice(0, i).forEach(o => { if (o.rect && r.rect && rectsOverlap(o.rect, r.rect)) errors.push(problem('room_overlap', `${path}.rect`, `room '${r.id}' overlaps '${o.id}'`)); });
    });
    return errors;
  },
  install(rt, raw, instance) {
    const config = withDefaults(this.card, raw), space = spaceOf(rt, instance), seed = drawSeed(rt);
    const result = generateRooms(config, seed, playerStart(rt, space));
    const writer = cellWriter(rt, space);
    for (const c of result.cells) writer.set(c.at, c.block);
    writer.flush();
    delete result.cells;
    if (config.spawnFeatures) for (const r of result.rooms) for (const f of r.features) if (f.at) spawnFeature(rt, space, r, f);
    const st = () => rt.store(instance.key);
    const api = {
      list: () => st().rooms,
      get: id => st().rooms.find(r => r.id === id) || null,
      roomAt: at => st().rooms.find(r => inRect(r.rect, Math.floor(at[0]), Math.floor(at[1])))?.id ?? null,
      graph: () => st().graph,
      problems: () => st().problems,
      doors: () => st().rooms.flatMap(r => r.exits.filter(e => e.door).map(e => ({ room: r.id, to: e.to, port: e.port, pair: e.pair ?? null, gate: e.gate ?? null }))),
    };
    // Doors: stepping onto a door's inner tile takes the walker to its partner's (gates permitting).
    if (config.doorWarp) {
      const at = new Map(result.rooms.flatMap(r => r.exits.filter(e => e.door && e.pair).map(e => [e.port.join(','), e])));
      rt.system('late', rt => {
        const s = st(); s.lastCell ??= {};
        for (const e of [rt.player()].filter(Boolean)) {
          if (e.space !== space.sid) continue;
          const k = cellOfEntity(space, e).slice(0, 2).join(','); if (s.lastCell[e.id] === k) continue;
          s.lastCell[e.id] = k;
          const d = at.get(k); if (!d) continue;
          if (d.gate && !rt.test(d.gate, { self: e.id })) { rt.emit('blocked', { who: e.id, to: d.to }); continue; }
          placeOn(rt, space, e, d.pair.port); s.lastCell[e.id] = d.pair.port.join(',');
          rt.emitTyped('room_door', d.to, { who: e.id, to: d.pair.room });
        }
      }, ID);
    }
    publish(rt, instance, space, ID, result, { rooms: api });
  },
};

function playerStart(rt, space) {
  const p = rt.doc.player;
  return p && (p.space ?? rt.doc.spaces[0].id) === space.sid && Array.isArray(p.at) ? p.at : null;
}

function spawnFeature(rt, space, r, f) {
  const kind = f.kind, ref = f.ref;
  const archetype = (kind === 'spawn' || kind === 'boss_spawn' || kind === 'npc') && ref ? (rt.doc.plot?.characters?.find(c => c.id === ref)?.archetype ?? ref) : (f.spec.archetype || kind);
  const id = kind === 'npc' && ref ? ref : f.id;
  spawnAt(rt, space, archetype, f.at, { feature: { ...f.spec, room: r.id, kind } }, id);
}

/** Pure generation: returns { rooms, graph, problems, cells, attempts, fallback }. Exported for tools and tests. */
export function generateRooms(config, seed, start = null) {
  const styles = { ...ROOM_STYLES, ...config.styles }, E = config.exitSize;
  const rooms = config.rooms.map(r => ({ ...r, style: styles[r.style] ? r.style : 'hall' }));
  const ground = r => (config.mode === "side" ? 1 + Math.max(styles[r.style].ground ?? 1, r.gaps ? 2 : 0) : 1);
  // 1. Openings from geometry (no RNG), identical on both sides of a shared wall.
  const openings = new Map(rooms.map(r => [r.id, []])), links = [], problems = [];
  const touching = (a, side) => rooms.filter(b => b !== a && (
    side === 'r' ? b.rect[0] === a.rect[2] : side === 'l' ? b.rect[2] === a.rect[0] : side === 't' ? b.rect[1] === a.rect[3] : b.rect[3] === a.rect[1]))
    .map(b => ({ b, lo: side === 'l' || side === 'r' ? Math.max(a.rect[1], b.rect[1]) : Math.max(a.rect[0], b.rect[0]), hi: side === 'l' || side === 'r' ? Math.min(a.rect[3], b.rect[3]) : Math.min(a.rect[2], b.rect[2]) }))
    .filter(o => o.hi - o.lo >= E + 2);
  const OPP = { l: 'r', r: 'l', t: 'b', b: 't' };
  const done = new Set();
  rooms.forEach((a, ai) => a.exits.forEach((ex, ei) => {
    const cands = touching(a, ex.side), byZone = cands.filter(o => !ex.to || o.b.zone === ex.to);
    const pick = (byZone.length ? byZone : ex.to ? [] : cands).sort((p, q) => (q.hi - q.lo) - (p.hi - p.lo) || p.b.id.localeCompare(q.b.id))[0];
    if (!pick) {
      openings.get(a.id).push({ side: ex.side, door: true, exit: ei, to: ex.to ?? null, gate: ex.gate ?? null });
      if (!ex.to) problems.push(problem('exit_unmatched', `rooms[${ai}].exits[${ei}]`, `room '${a.id}' exit '${ex.side}' has no neighbouring room and no 'to' zone`, { room: a.id }));
      return;
    }
    const b = pick.b, pair = [a.id, b.id, ex.side].join('|'), back = [b.id, a.id, OPP[ex.side]].join('|');
    if (done.has(back) || done.has(pair)) { const o = openings.get(a.id).find(o => o.peer === b.id && o.side === ex.side); if (o) { o.exit = ei; o.gate ??= ex.gate ?? null; } return; }
    done.add(pair);
    let span;
    if ((ex.side === 'l' || ex.side === 'r') && config.mode === 'side') { const bottom = Math.max(a.rect[1] + ground(a), b.rect[1] + ground(b), pick.lo + 1); span = [bottom, Math.min(bottom + E, pick.hi - 1)]; }
    else { const mid = Math.floor((pick.lo + pick.hi) / 2), x0 = clamp(mid - Math.floor(E / 2), pick.lo + 1, pick.hi - 1 - E); span = [x0, x0 + E]; }
    const gate = ex.gate ?? b.exits.find(x => x.side === OPP[ex.side])?.gate ?? null;
    openings.get(a.id).push({ side: ex.side, span, peer: b.id, exit: ei, to: b.zone, gate });
    openings.get(b.id).push({ side: OPP[ex.side], span, peer: a.id, exit: b.exits.findIndex(x => x.side === OPP[ex.side]), to: a.zone, gate });
    links.push({ from: a.id, to: b.id, side: ex.side, gate });
  }));
  // 2. Each room: attempts with sub-seeds, then the plain fallback; keep the first proven layout.
  const cells = [], out = [], built = [];
  let attemptsTotal = 0, anyFallback = false;
  rooms.forEach((r, ri) => {
    const theme = { ...DEFAULT_PALETTE, ...config.palette, ...(config.themes?.[r.theme] || {}) };
    const m = movementFor(config.movement, [...config.requiresAbilities, ...(r.requiresAbilities || [])], config.abilities);
    let best = null;
    for (let attempt = 0; attempt <= config.attempts; attempt++) {
      const plain = attempt === config.attempts;
      const built = buildRoom(r, styles[r.style], openings.get(r.id), m, config, theme, stream(seed, r.id, attempt), { plain, ground: ground(r), start: start && inRect(r.rect, Math.floor(start[0]), Math.floor(start[1])) ? start : null });
      attemptsTotal++;
      if (!best || built.problems.length < best.problems.length) best = { ...built, attempt, plain };
      if (!built.problems.length) break;
    }
    if (best.plain) anyFallback = true;
    built.push(best);
    problems.push(...best.problems.map(p => ({ ...p, path: `rooms[${ri}]${p.path ? '.' + p.path : ''}` })));
    for (let y = 0; y < best.grid.h; y++) for (let x = 0; x < best.grid.w; x++) cells.push({ at: [r.rect[0] + x, r.rect[1] + y], block: best.blocks[y * best.grid.w + x] });
    out.push({ id: r.id, zone: r.zone, rect: r.rect, style: r.style, attempt: best.attempt, fallback: best.plain,
      exits: openings.get(r.id).map(o => ({ side: o.side, to: o.to, peer: o.peer ?? null, gate: o.gate, door: Boolean(o.door), cells: o.cells, ...(o.door ? { port: o.port } : {}) })), features: best.features });
  });
  // 3. The composed map, proven as a whole: from the player start (else the first room's first exit)
  // with every ability the document mentions, every room and every exit must be reached. Unmatched
  // exits with a `to` zone are doors: each pairs with the nearest door of that zone leading back (else
  // any door there), and reaching a door continues from its partner's inner tile.
  const all = movementFor(config.movement, [...config.requiresAbilities, ...rooms.flatMap(r => r.requiresAbilities || [])], config.abilities);
  const bx0 = Math.min(...rooms.map(r => r.rect[0])), by0 = Math.min(...rooms.map(r => r.rect[1]));
  const BW = Math.max(...rooms.map(r => r.rect[2])) - bx0, BH = Math.max(...rooms.map(r => r.rect[3])) - by0;
  const big = new Raster(BW, BH, SOLID), goals = new Map(), portStarts = new Map();
  out.forEach((r, ri) => {
    const b = built[ri], ox = r.rect[0] - bx0, oy = r.rect[1] - by0;
    for (let y = 0; y < b.grid.h; y++) for (let x = 0; x < b.grid.w; x++) big.set(ox + x, oy + y, b.grid.get(x, y));
    b.goals.forEach((port, i) => goals.set((oy + ((i / b.grid.w) | 0)) * BW + ox + (i % b.grid.w), `${r.id}#${port}`));
    portStarts.set(r.id, b.starts.map(s0 => ({ ...s0, x: s0.x + ox, y: s0.y + oy })));
  });
  const doors = out.flatMap(r => r.exits.map((e, pi) => ({ r, e, pi })).filter(d => d.e.door && d.e.to));
  const mid = r => [(r.rect[0] + r.rect[2]) / 2, (r.rect[1] + r.rect[3]) / 2], gap = (a, b) => Math.hypot(mid(a)[0] - mid(b)[0], mid(a)[1] - mid(b)[1]);
  for (const d of doors) {
    const there = doors.filter(o => o.r !== d.r && o.r.zone === d.e.to), back = there.filter(o => o.e.to === d.r.zone);
    const pick = (back.length ? back : there).sort((a, b) => gap(a.r, d.r) - gap(b.r, d.r) || a.r.id.localeCompare(b.r.id))[0];
    if (pick) d.e.pair = { room: pick.r.id, exit: pick.pi, port: pick.e.port };
    else problems.push(problem('door_unpaired', `rooms[${out.indexOf(d.r)}].exits[${d.pi}]`, `room '${d.r.id}': the door to '${d.e.to}' has no door in that zone to lead to`, { room: d.r.id }));
  }
  const reachG = config.mode === 'side' ? reachSide : reachTop;
  const startRoom = out.find(r => start && inRect(r.rect, Math.floor(start[0]), Math.floor(start[1]))) || out[0];
  let starts = start && startRoom === out.find(r => inRect(r.rect, Math.floor(start[0]), Math.floor(start[1]))) ? [{ x: Math.floor(start[0]) - bx0, y: Math.floor(start[1]) - by0 }] : portStarts.get(startRoom.id).slice(0, 1);
  const hit = new Set(), nodes = new Set(), entered = new Set([startRoom.id]);
  if (start && reachG(big, all, starts).nodes.size === 0) problems.push(problem('start_blocked', 'rooms', `the player start ${JSON.stringify(start)} has no foothold`));
  for (let pass = 0; pass < rooms.length + 1 && starts.length; pass++) {
    const res = reachG(big, all, starts, goals);
    res.hit.forEach(h => hit.add(h)); res.nodes.forEach(n => nodes.add(n));
    starts = [];
    for (const d of doors) if (d.e.pair && hit.has(`${d.r.id}#${d.pi}`)) { const k = `${d.e.pair.room}#${d.e.pair.exit}`; if (!entered.has(k)) { entered.add(k); hit.add(k); starts.push(portStarts.get(d.e.pair.room)[d.e.pair.exit]); } }
  }
  out.forEach((r, ri) => {
    const ox = r.rect[0] - bx0, oy = r.rect[1] - by0, b = built[ri];
    let any = false; for (let y = 0; y < b.grid.h && !any; y++) for (let x = 0; x < b.grid.w && !any; x++) any = nodes.has((oy + y) * BW + ox + x);
    if (!any) problems.push(problem('room_unreachable', `rooms[${ri}]`, `room '${r.id}' cannot be reached from '${startRoom.id}' even with every ability`, { room: r.id }));
    else r.exits.forEach((e, pi) => { if (!hit.has(`${r.id}#${pi}`)) problems.push(problem('exit_unreachable', `rooms[${ri}]`, `room '${r.id}': exit '${e.side}' is never reached in the composed map`, { room: r.id })); });
  });
  // Kept-clear regions must be reachable from the start (the player uses what fills them: stacked pieces...).
  (config.keepClear || []).forEach((c, ci) => {
    let any = false;
    for (let y = Math.max(by0, c[1]); y < Math.min(by0 + BH, c[3]) && !any; y++) for (let x = Math.max(bx0, c[0]); x < Math.min(bx0 + BW, c[2]) && !any; x++) any = nodes.has((y - by0) * BW + (x - bx0));
    if (!any && out.some(r => rectsOverlap(r.rect, c))) problems.push(problem('clear_unreachable', `keepClear[${ci}]`, `kept-clear region ${JSON.stringify(c)} is not reachable from the start`));
  });
  const first = startRoom;
  return { rooms: out, graph: { start: first.id, edges: links }, problems, cells, attempts: attemptsTotal, fallback: anyFallback, seed };
}

/** Paint one room on a local raster (y up) and prove it. */
function buildRoom(r, style, openings, m, config, palette, rnd, { plain, ground: g, start }) {
  const W = r.rect[2] - r.rect[0], H = r.rect[3] - r.rect[1], side = config.mode === 'side', E = config.exitSize;
  const grid = new Raster(W, H, EMPTY), blocks = new Array(W * H).fill(null);
  const put = (x, y, role, block) => { if (!grid.in(x, y)) return; grid.set(x, y, role); blocks[y * W + x] = block ?? null; };
  const box = (x, y, w, h, role, block) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) put(i, j, role, block); };
  const wall = palette.wall, floor = side ? g : 1;
  // Shell: border walls, ground below the floor line.
  for (let x = 0; x < W; x++) { put(x, 0, SOLID, wall); put(x, H - 1, SOLID, wall); }
  for (let y = 0; y < H; y++) { put(0, y, SOLID, wall); put(W - 1, y, SOLID, wall); }
  if (side) box(1, 1, W - 2, g - 1, SOLID, palette.ground);
  const hasTop = openings.some(o => o.side === 't');
  let top = H - 2; // highest interior row
  if (side && !plain && style.ceiling && !hasTop) { top = Math.min(H - 2, floor + style.ceiling + rnd.int(3)); box(1, top + 1, W - 2, H - 2 - top, SOLID, wall); }
  const near = start ? [Math.floor(start[0]) - r.rect[0], Math.floor(start[1]) - r.rect[1]] : null;
  const reserved = (x, y) => (near && Math.abs(x - near[0]) <= 2 && Math.abs(y - near[1]) <= 3) || openings.some(o => o.span && ((o.side === 'l' && x <= 3 || o.side === 'r' && x >= W - 4) && y >= o.span[0] - r.rect[1] - 1 && y <= o.span[1] - r.rect[1] + 1 || (o.side === 't' || o.side === 'b') && x >= o.span[0] - r.rect[0] - 1 && x <= o.span[1] - r.rect[0]));
  if (!plain) {
    // Cave noise: blobs smoothed by a cellular automaton, kept off the floor line and the openings.
    if (style.noise) {
      const n = new Raster(W, H, 0);
      for (let y = floor + 2; y < top; y++) for (let x = 2; x < W - 2; x++) if (!reserved(x, y) && rnd() < style.noise) n.set(x, y, 1);
      for (let it = 0; it < (style.smooth ?? 2); it++) { const c = n.cells.slice(); for (let y = floor + 2; y < top; y++) for (let x = 2; x < W - 2; x++) { let k = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (i || j) k += n.get(x + i, y + j, 0); c[y * W + x] = k >= 5 ? 1 : k <= 2 ? 0 : n.get(x, y); } n.cells = c; }
      for (let y = floor + 2; y < top; y++) for (let x = 2; x < W - 2; x++) if (n.get(x, y) && !reserved(x, y)) put(x, y, SOLID, wall);
    }
    if (side && style.water) { const wy = floor + Math.max(1, Math.floor(style.water * (top - floor))); for (let y = floor; y < wy; y++) for (let x = 1; x < W - 1; x++) if (grid.get(x, y) === EMPTY) put(x, y, WATER, palette.water); }
    // Pits: carved through the ground, never wider than a jump clears; hazards line the bottom when the room has any.
    if (side) for (let k = 0; k < (r.gaps || 0); k++) {
      const gw = clamp(rnd.range(1, Math.max(1, Math.floor(m.D) - 1)), 1, Math.max(1, W - 8)), gx = rnd.range(3, Math.max(3, W - 4 - gw));
      if (reserved(gx, floor) || reserved(gx + gw - 1, floor)) continue;
      for (let x = gx; x < gx + gw; x++) { for (let y = 2; y < g; y++) put(x, y, EMPTY); put(x, 1, r.hazards?.length ? HAZARD : EMPTY, r.hazards?.length ? r.hazards[0] : null); }
    }
    for (const kind of r.hazards || []) for (let k = 0, n = 1 + rnd.int(2); k < n; k++) {
      const hx = rnd.range(3, W - 4), hy = side ? floor : rnd.range(2, H - 3);
      if (!reserved(hx, hy) && grid.get(hx, hy) === EMPTY && (!side || grid.get(hx, hy - 1) === SOLID)) put(hx, hy, HAZARD, palette.hazards?.[kind] ?? kind);
    }
  }
  // Platforms: shafts stack them within jump height, alternating sides; elsewhere scattered (plain: a staircase).
  const count = r.platforms ?? style.platforms ?? 0, [pw0, pw1] = style.platformWidth || [3, 5], prole = config.oneWayPlatforms ? ONEWAY : SOLID;
  if (side && count) {
    const step = clamp(Math.floor(m.h) || 1, 1, Math.max(1, Math.floor(m.h))), stair = plain || style.climb;
    for (let k = 0; k < count; k++) {
      const pw = clamp(rnd.range(pw0, pw1), 2, Math.max(2, W - 4));
      const py = stair ? floor + step * (k + 1) - 1 : floor + rnd.range(1, Math.max(1, Math.floor(m.h))) - 1 + (k % 2) * rnd.int(Math.max(1, top - floor - 3));
      if (py >= top - 1) break;
      const px = stair ? (k % 2 ? W - 2 - pw - rnd.int(2) : 1 + rnd.int(2)) : rnd.range(2, Math.max(2, W - 2 - pw));
      for (let x = px; x < px + pw; x++) if (!reserved(x, py) && grid.get(x, py) !== HAZARD) put(x, py, prole, palette.platform);
    }
  }
  // Routes up to high side exits: a staircase of short platforms along that wall, each rise within the jump.
  if (side && !plain) for (const o of openings) {
    if (o.door || (o.side !== 'l' && o.side !== 'r')) continue;
    const y0 = o.span[0] - r.rect[1], step = Math.max(1, Math.floor(m.h) - 1), reach = clamp(Math.floor(m.D) - 1, 1, 3);
    if (y0 - 1 <= floor + Math.floor(m.h) - 1) continue;
    const xs = k => { const off = k % 2 ? reach + rnd.int(2) : 0; return o.side === 'l' ? 1 + off : W - 4 - off; };
    for (let y = y0 - 1, k = 0; y > floor + step - 1; y -= step, k++) for (let x = xs(k); x < xs(k) + 3; x++) if (x > 0 && x < W - 1) put(x, y, prole, palette.platform);
  }
  if (!side && !plain) for (let k = 0; k < (r.platforms ?? 0); k++) { const bx = rnd.range(2, W - 4), by = rnd.range(2, H - 4); if (!reserved(bx, by)) box(bx, by, 2, 2, SOLID, wall); }
  // Openings: cut matched spans through the wall; unmatched exits become doors with a reachable step inside.
  const goals = new Map(), starts = [];
  openings.forEach((o, oi) => {
    const cellsOut = [];
    const mark = (x, y) => { goals.set(y * W + x, oi); cellsOut.push([r.rect[0] + x, r.rect[1] + y]); };
    if (o.door) { // a door block in the wall at floor level (or mid-ceiling/floor), its inner cell is the port
      const dx = o.side === 'l' ? 0 : o.side === 'r' ? W - 1 : Math.floor(W / 2), dy = o.side === 't' ? H - 1 : o.side === 'b' ? (side ? 0 : 0) : floor;
      put(dx, dy, SOLID, palette.door);
      const ix = o.side === 'l' ? 1 : o.side === 'r' ? W - 2 : dx, iy = o.side === 't' ? top : o.side === 'b' ? floor : floor;
      if (grid.get(ix, iy) !== EMPTY && grid.get(ix, iy) !== LADDER) put(ix, iy, EMPTY);
      mark(ix, iy); starts.push({ x: ix, y: iy, port: oi }); o.port = [r.rect[0] + ix, r.rect[1] + iy];
    } else if (o.side === 'l' || o.side === 'r') {
      const x = o.side === 'l' ? 0 : W - 1, inner = o.side === 'l' ? 1 : W - 2, y0 = o.span[0] - r.rect[1], y1 = o.span[1] - r.rect[1];
      for (let y = y0; y < y1; y++) { put(x, y, EMPTY); if (grid.get(inner, y) === SOLID) put(inner, y, EMPTY); mark(x, y); }
      if (grid.get(x, y0 - 1) !== SOLID) put(x, y0 - 1, SOLID, wall); // a sill to stand on
      starts.push({ x, y: y0, port: oi });
    } else {
      const x0 = o.span[0] - r.rect[0], x1 = o.span[1] - r.rect[0];
      for (let x = x0; x < x1; x++) {
        if (o.side === 't') { put(x, H - 1, EMPTY); mark(x, H - 1); for (let y = top + 1; y < H - 1; y++) put(x, y, EMPTY); }
        else { for (let y = 0; y < (side ? g : 1); y++) { put(x, y, EMPTY); mark(x, y); } }
      }
      if (o.side === 't') starts.push({ x: x0, y: H - 1, port: oi });
      else starts.push({ x: x0, y: 0, port: oi, launch: side });
    }
    o.cells = cellsOut;
  });
  // Climb aids are one-way rungs (jump up through, stand on top), so they need no ability in any
  // platformer space. Vertical links always get a rung stack spanning the shared wall: the lower room
  // from the opening down to the floor, the upper room inside its floor hole; consecutive rungs rise
  // at most jumpHeight − 1, across the wall too. The plain fallback also stacks rungs under mid-wall
  // side exits and ceiling doors. Rungs cut through platforms and cave noise.
  const step = Math.max(1, Math.floor(m.h) - 1);
  const rungs = (x0, x1, yTop, yLow) => {
    for (let y = yLow; y <= yTop; y++) for (let x = Math.max(1, x0); x < Math.min(W - 1, x1); x++) if (y >= floor && y < H - 1 && grid.get(x, y) !== EMPTY) put(x, y, EMPTY); // a clear shaft
    for (let y = yTop; y >= yLow; y -= step) for (let x = x0; x < x1; x++) if (x > 0 && x < W - 1 || y >= H - 1 || y < g) put(x, y, ONEWAY, palette.rung);
  };
  if (side) openings.forEach(o => {
    if (o.door) { if (plain && o.side === 't') rungs(Math.floor(W / 2) - 1, Math.floor(W / 2) + 2, top - 1, floor); return; }
    if (o.side === 't') rungs(o.span[0] - r.rect[0], o.span[1] - r.rect[0], H - 2, floor);
    else if (o.side === 'b') rungs(o.span[0] - r.rect[0], o.span[1] - r.rect[0], g - 1, 0);
    else if (plain) { const x0 = o.side === 'l' ? 1 : W - 4; rungs(x0, x0 + 3, o.span[0] - r.rect[1] - 1, floor); }
  });
  // Regions other primitives own stay empty (after everything above painted, before the proof sees the room).
  for (const [cx0, cy0, cx1, cy1] of config.keepClear || []) for (let y = Math.max(0, cy0 - r.rect[1]); y < Math.min(H, cy1 - r.rect[1]); y++) for (let x = Math.max(0, cx0 - r.rect[0]); x < Math.min(W, cx1 - r.rect[0]); x++) put(x, y, EMPTY);
  // Proof: every port reaches every other port; features reachable from the first port.
  const reach = side ? reachSide : reachTop, problems = [];
  const fromPort = starts.map(s => reach(grid, m, [s.launch && grid.get(s.x, s.y) === ONEWAY ? { x: s.x, y: s.y + 1 } : s], goals));
  for (const [i, s] of starts.entries()) for (const t of starts) if (t.port !== s.port && !fromPort[i].hit.has(t.port))
    problems.push(problem('exit_unreachable', `exits[${openings[t.port].exit}]`, `room '${r.id}': exit '${openings[t.port].side}' unreachable from exit '${openings[s.port].side}'`, { room: r.id }));
  const reached = starts.length ? fromPort.reduce((acc, x) => (x.nodes.forEach(n => acc.add(n)), acc), new Set()) : null;
  if (!starts.length) problems.push(problem('room_isolated', '', `room '${r.id}' has no exits`, { room: r.id }));
  // Features: explicit positions must be reachable; others pick reachable floor tiles spread by the seed.
  const anchor = start ? [Math.floor(start[0]) - r.rect[0], Math.floor(start[1]) - r.rect[1]] : null;
  const pool = reached ? [...reached] : anchor ? [...reach(grid, m, [{ x: anchor[0], y: anchor[1] }]).nodes] : [];
  const free = pool.filter(i => !goals.has(i) && grid.cells[i] !== WATER).sort((a, b) => a - b);
  const taken = new Set(), features = [];
  (r.features || []).forEach((f, fi) => {
    const { kind, id, at, count = 1, ...spec } = f;
    for (let c = 0; c < count; c++) {
      let pos = null;
      if (at && c === 0) {
        const lx = Math.floor(at[0]) - r.rect[0], ly = Math.floor(at[1]) - r.rect[1];
        if (!reached || !reached.has(ly * W + lx)) problems.push(problem('feature_unreachable', `features[${fi}].at`, `room '${r.id}': ${kind} at ${JSON.stringify(at)} is not reachable`, { room: r.id }));
        pos = [at[0], at[1]];
      } else if (free.length) {
        let i = free[rnd.int(free.length)]; for (let k = 0; taken.has(i) && k < free.length; k++) i = free[(free.indexOf(i) + 1) % free.length];
        taken.add(i); pos = [r.rect[0] + (i % W), r.rect[1] + Math.floor(i / W)];
      } else problems.push(problem('feature_unreachable', `features[${fi}]`, `room '${r.id}': no reachable tile for ${kind}`, { room: r.id }));
      features.push({ kind, id: count > 1 && id ? `${id}_${c + 1}` : id, ref: spec.ref, at: pos, spec: { ...spec, ...(id ? { id } : {}) } });
    }
  });
  return { grid, blocks, problems, features, starts, goals };
}
