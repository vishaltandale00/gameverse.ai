// gameplay.ai.traffic: ambient vehicles on the road graph. Cars spawn on lanes
// around the player (density by hour), follow lane polylines lane to lane, keep
// a time-headway gap to whatever is ahead (other cars, the player, any vehicle
// in the lane), stop at red lights (two-phase signals by approach axis, with an
// amber stop rule), yield at unsignalled junctions (first come, first served),
// and panic on gunfire or crime: faster, running lights and yields. Running
// into something at speed emits traffic_collision. Lane motion is kinematic
// through the space API (setPos), honoring the space anchor.
import { v3, sub, add, mul, len, norm, dot, r6, round6, upAt, weighted, onEvents, dead } from './ai-lib.js';
import { roadGraph, along, nextLane } from './ai-lib-roads.js';

const ID = 'gameplay.ai.traffic';
const st = rt => rt.store(ID);
const n = (d, extra = {}) => ({ type: 'number', default: d, ...extra });

export default {
  id: ID,
  card: {
    loop: { verbs: [], progress: ['traffic_collision'] },
    intent: 'Ambient traffic on the road graph: cars spawn around the player by density and hour, follow lanes, keep gaps (cars, player, vehicles), obey two-phase traffic lights, yield at junctions, panic on gunfire/crime, and report collisions.',
    views: ['3p', 'td', 'iso'],
    params: {
      density: n(0.5, { min: 0, max: 1 }), maxCars: { type: 'integer', default: 30, min: 0, max: 500 },
      speed: n(50, { min: 1, unit: 'km/h', effect: 'default speed limit (lanes/edges may set their own)' }),
      lanes: { type: 'boolean', default: true, effect: 'spawn on every lane of multi-lane roads (else lane index 0 only)' },
      lights: { type: 'boolean', default: true }, panic: { type: 'boolean', default: true },
      archetypes: { type: 'list', min: 1, required: true, of: { type: 'object', fields: { archetype: { type: 'ref', to: 'archetype', required: true }, weight: n(1, { min: 0 }) } } },
      laneWidth: n(3, { min: 0.5, effect: 'lane width when the road graph has no lane geometry' }),
      spawnRadius: { type: 'list', of: { type: 'number', min: 0 }, default: [40, 140], min: 2, max: 2 }, despawnRadius: n(180, { min: 1 }),
      minGap: n(5, { min: 0, effect: 'bumper gap kept at a standstill (m)' }), headway: n(1.2, { min: 0, unit: 's' }),
      accel: n(3, { min: 0.1 }), brake: n(7, { min: 0.1 }),
      lightCycle: n(18, { min: 1, unit: 's', effect: 'green time per approach axis' }), amber: n(3, { min: 0, unit: 's' }), junctionRadius: n(6, { min: 0 }),
      panicEvents: { type: 'list', of: { type: 'string' }, default: ['shots_fired', 'fired', 'explosion', 'crime'] }, panicRadius: n(40, { min: 0 }), panicSec: n(8, { min: 0 }),
      byHour: { type: 'list', default: [], of: { type: 'object', fields: { from: n(0, { min: 0, max: 24 }), to: n(24, { min: 0, max: 24 }), density: n(1, { min: 0, max: 1 }) } }, effect: 'density multipliers by var time.hour' },
      space: { type: 'ref', to: 'space', effect: 'space whose road graph to drive (default: the player\'s)' },
    },
    provides: { events: ['traffic_spawn', 'traffic_collision', 'traffic_panic', 'light_changed'], vars: ['traffic.cars'] },
    requires: { capabilities: ['position'], services: ['roadgraph'] },
    reads: ['content.archetypes'],
  },
  validate(config) {
    const errors = [];
    if (config.spawnRadius[0] > config.spawnRadius[1]) errors.push({ code: 'param_range', path: 'spawnRadius', message: 'min above max' });
    if (config.despawnRadius < config.spawnRadius[1]) errors.push({ code: 'traffic_despawn_radius', path: 'despawnRadius', message: 'despawnRadius must be at least the outer spawn radius' });
    return errors;
  },
  install(rt, config) {
    rt.on('despawn', ({ id }, rt) => { const s = st(rt); if (s.cars) delete s.cars[id]; });
    if (config.panic) onEvents(rt, config.panicEvents, (name, data, rt) => {
      const src = Array.isArray(data.at) ? v3(data.at) : rt.entity(data.who ?? data.by)?.at; if (!src) return;
      const s = st(rt); let k = 0;
      for (const [id, c] of Object.entries(s.cars || {})) { const e = rt.entity(id); if (e && len(sub(e.at, src)) <= config.panicRadius) { c.panic = round6(rt.state.time + config.panicSec); k++; } }
      if (k) rt.emit('traffic_panic', { at: r6(v3(src)), cars: k, cause: name });
    });
    rt.system('ai', rt => tick(rt, config), ID);
  },
};

function densityNow(rt, config) {
  const h = rt.state.vars['time.hour'];
  const m = Number.isFinite(h) ? config.byHour.find(b => (b.from <= b.to ? h >= b.from && h < b.to : h >= b.from || h < b.to)) : null;
  return config.density * (m ? m.density : 1);
}
const greenAxis = (rt, config) => Math.floor(rt.state.time / config.lightCycle) % 2;
/** Approach axis of a heading: 0 = mostly x, 1 = mostly the other ground axis (z with y up, else y). */
function axisOf(dir, up) { const other = up && Math.abs(up[1]) > 0.5 ? Math.abs(dir[2]) : Math.abs(dir[1]); return Math.abs(dir[0]) >= other ? 0 : 1; }
const spaceIdOf = (rt, config) => config.space ?? rt.player()?.space ?? rt.doc.spaces?.[0]?.id;

function tick(rt, config) {
  const p = rt.player(); if (!p) return;
  const sid = spaceIdOf(rt, config), api = rt.space(sid), up = upAt(api, p.at);
  const G = roadGraph(rt, { spaceId: sid, up, laneWidth: config.laneWidth }); if (!G || !G.lanes.size) return;
  const s = st(rt); s.cars ??= {}; s.junction ??= {};
  const ga = greenAxis(rt, config);
  if (config.lights && s.green !== ga) { if (s.green !== undefined) rt.emit('light_changed', { axis: ga }); s.green = ga; }
  for (const id of Object.keys(s.cars)) { const e = rt.entity(id); if (!e || e.space !== p.space || len(sub(e.at, p.at)) > config.despawnRadius) { delete s.cars[id]; if (e) rt.despawn(id); } }
  const target = Math.round(config.maxCars * densityNow(rt, config));
  if (p.space === sid && Object.keys(s.cars).length < target) spawnCar(rt, config, G, api, p);
  const cars = Object.entries(s.cars).map(([id, c]) => ({ id, c, e: rt.entity(id) })).filter(x => x.e);
  for (const x of cars) drive(rt, config, G, api, x, cars, up);
  rt.state.vars['traffic.cars'] = cars.length;
}

function spawnCar(rt, config, G, api, p) {
  const [lo, hi] = config.spawnRadius, ids = [...G.lanes.keys()].filter(id => config.lanes || G.lanes.get(id).index === 0);
  for (let tries = 0; tries < 6 && ids.length; tries++) {
    const lane = G.lanes.get(ids[Math.floor(rt.random() * ids.length)]), sAt = round6(rt.random() * lane.length);
    const { at } = along(lane, sAt), d = len(sub(at, p.at)); if (d < lo || d > hi) continue;
    if (Object.values(st(rt).cars).some(c => c.lane === lane.id && Math.abs(c.s - sAt) < config.minGap * 2)) continue;
    const pick = weighted(rt, config.archetypes); if (!pick) return;
    const e = rt.spawn(pick.archetype, { space: p.space, at: placeAt(api, at, rt.archetype(pick.archetype)?.components?.body), components: { traffic: true } });
    st(rt).cars[e.id] = { lane: lane.id, s: sAt, v: round6(limit(config, lane) * 0.6), panic: 0 };
    rt.emit('traffic_spawn', { who: e.id, archetype: pick.archetype, lane: lane.id });
    return;
  }
}
const limit = (config, lane) => lane.speed ?? config.speed / 3.6;
/** Entity `at` for a vehicle standing on road point p: lift by half its height in 'center'-anchored spaces with up. */
function placeAt(api, p, body) {
  const up = upAt(api, p), h = body?.size?.[1] ?? 0;
  return r6(up && (api.anchor ?? 'center') === 'center' ? add(p, mul(up, h / 2)) : p);
}

/** Quadratic connector across a junction from the end of lane a to the start of lane b, controlled by the node. */
function connector(a, b, node) {
  const p0 = a.points[a.points.length - 1], p2 = b.points[0], p1 = node ? v3(node) : mul(add(p0, p2), 0.5);
  const straight = len(sub(p2, p0)) < 1e-6 || Math.abs(dot(norm(sub(p1, p0)), norm(sub(p2, p1)))) > 0.999;
  const ctrl = straight ? mul(add(p0, p2), 0.5) : p1;
  let length = 0, prev = p0; for (let k = 1; k <= 8; k++) { const q = bez(p0, ctrl, p2, k / 8); length += len(sub(q, prev)); prev = q; }
  return { to: b.id, p0, p1: r6(ctrl), p2, length: round6(Math.max(length, 1e-3)) };
}
const bez = (a, b, c, t) => add(add(mul(a, (1 - t) ** 2), mul(b, 2 * (1 - t) * t)), mul(c, t * t));
function turnPoint(turn, s) { const t = Math.min(1, s / turn.length), at = r6(bez(turn.p0, turn.p1, turn.p2, t)); const d = norm(add(mul(sub(turn.p1, turn.p0), 2 * (1 - t)), mul(sub(turn.p2, turn.p1), 2 * t))); return { at, dir: r6(d) }; }

function drive(rt, config, G, api, { id, c, e }, cars, up) {
  let lane = G.lanes.get(c.lane);
  if (!lane) { rt.despawn(id); return; }
  const now = rt.state.time, panic = c.panic > now, vmax = limit(config, lane) * (panic ? 1.6 : 1);
  const here = c.turn ? turnPoint(c.turn, c.s) : along(lane, c.s), fwd = here.dir;
  // Leader: nearest car ahead in the lane, or the player / any vehicle in the lane corridor.
  let gap = Infinity, leaderV = 0, blocker = null;
  const laneKey = x => (x.turn ? `turn:${x.turn.to}` : x.lane);
  for (const o of cars) if (o.id !== id && laneKey(o.c) === laneKey(c) && o.c.s > c.s && o.c.s - c.s < gap) { gap = o.c.s - c.s; leaderV = o.c.v; blocker = o.id; }
  // Entering a lane: a car still near its start is ahead of one crossing the junction into it.
  if (c.turn) for (const o of cars) if (o.id !== id && o.c.lane === c.turn.to && !o.c.turn && c.turn.length - c.s + o.c.s < gap) { gap = c.turn.length - c.s + o.c.s; leaderV = o.c.v; blocker = o.id; }
  for (const o of Object.values(rt.state.entities)) {
    if (o === e || o.components.traffic || o.space !== e.space || dead(o) || !(o.id === 'player' || o.components.vehicle)) continue;
    const rel = sub(o.at, e.at), ahead = dot(rel, fwd), across = len(sub(rel, mul(fwd, ahead)));
    if (ahead > 0 && ahead < gap && across < config.laneWidth * 0.6) { gap = ahead; leaderV = 0; blocker = o.id; }
  }
  // Stop line: a red/amber signal, or a junction another car holds.
  const node = c.turn ? null : G.nodes.get(lane.to), toEnd = lane.length - c.s, junction = node && (node.light || node.out.length >= 3);
  let mustStop = false;
  if (junction && !panic) {
    if (config.lights && node.light) {
      const tail = along(lane, lane.length).dir, green = greenAxis(rt, config) === axisOf(tail, up);
      const amber = green && (rt.state.time % config.lightCycle) > config.lightCycle - config.amber;
      if (!green || (amber && toEnd > (c.v * c.v) / (2 * config.brake))) mustStop = true;
    } else if (!node.light) {
      const holder = st(rt).junction[node.id];
      if (holder && holder !== id && rt.entity(holder)) { if (toEnd < config.junctionRadius * 2) mustStop = true; }
      else if (toEnd < config.junctionRadius) st(rt).junction[node.id] = id;
    }
  }
  if (mustStop && toEnd < gap) { gap = Math.max(0, toEnd - 0.5); leaderV = 0; blocker = blocker ?? `stop:${node.id}`; }
  // Car following (Gipps-style safe speed): stop within the free gap at the comfortable brake, with a reaction headway.
  const free = gap - config.minGap, bt = config.brake * (leaderV > 0.1 ? config.headway : 0.25); // stopped obstacles and stop lines: brake to a halt
  const want = free <= 0.25 ? 0 : Math.min(vmax, -bt + Math.sqrt(bt * bt + leaderV * leaderV + 2 * config.brake * free));
  c.v = round6(c.v < want ? Math.min(want, c.v + config.accel * rt.dt) : Math.max(want, c.v - config.brake * rt.dt));
  if (gap < 1 && c.v > 2 && blocker && !String(blocker).startsWith('stop:') && rt.entity(blocker)) { rt.emit('traffic_collision', { who: id, with: blocker, speed: round6(c.v) }); c.v = 0; }
  c.s = round6(c.s + c.v * rt.dt);
  // Lane end: release the junction, then cross it on a curved connector into a lane leaving the node.
  let pos = null;
  for (let guard = 0; guard < 4; guard++) {
    if (c.turn) {
      if (c.s < c.turn.length) { pos = turnPoint(c.turn, c.s); break; }
      c.s = round6(c.s - c.turn.length); c.lane = c.turn.to; c.turn = null; lane = G.lanes.get(c.lane);
      if (!lane) { rt.despawn(id); return; }
    }
    if (c.s < lane.length) break;
    if (st(rt).junction[lane.to] === id) delete st(rt).junction[lane.to];
    const nx = nextLane(rt, G, lane); if (!nx) { c.s = lane.length; c.v = 0; break; }
    c.s = round6(c.s - lane.length); c.turn = connector(lane, nx, G.nodes.get(lane.to)?.at);
  }
  pos ??= along(lane, c.s);
  e.components.body = { ...(e.components.body || {}), facing: pos.dir, vel: r6(mul(pos.dir, c.v)) };
  const at = typeof api.standAt === 'function' ? r6(v3(api.standAt(pos.at, e))) : placeAt(api, pos.at, e.components.body); // feet on the lane surface
  api.setPos(e, e.at.length === 2 ? at.slice(0, 2) : at, rt);
}
