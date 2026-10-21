// gameplay.ai.flock: boids for birds, fish, herds and swarms. Each flock
// spawns (or adopts entities with components.boid) and steers every member by
// separation, alignment and cohesion within a neighbour radius, plus a
// wander jitter, a leash to the flock's home, avoidance of predators (the
// player or archetypes) and look-ahead obstacle avoidance through raycasts.
// Ground herds move in the space's ground plane; flyers in 3D within an
// altitude band. Velocities live in rt.store, positions move through slide or
// setPos (or a steer intent for move.*-owned bodies).
import { ENTITY_KINDS } from '../../kernel/params.js';
import { ID_PATTERN } from '../../kernel/sections.js';
import { v3, add, sub, mul, len, norm, dot, r6, round6, spaceOf, can, continuous, planar, upAt, randomPoint, moverOwned, dead, between, displace, zonePoint, centerOf } from './ai-lib.js';

const ID = 'gameplay.ai.flock';
const st = rt => rt.store(ID);
const n = (d, extra = {}) => ({ type: 'number', default: d, ...extra });
const FLOCK = {
  id: { type: 'string', pattern: ID_PATTERN, required: true }, archetype: { type: 'ref', to: 'archetype', required: true },
  count: { type: 'integer', default: 8, min: 0, max: 400 }, at: { type: 'list', of: { type: 'number' }, min: 2, max: 3, effect: 'home position' }, zone: { type: 'ref', to: 'zone', effect: 'home zone (its point)' },
  spread: n(4, { min: 0 }), maxSpeed: n(5, { min: 0 }), maxForce: n(10, { min: 0 }), neighbor: n(5, { min: 0 }), sepDist: n(1.5, { min: 0 }),
  separation: n(1.6, { min: 0 }), alignment: n(1, { min: 0 }), cohesion: n(0.9, { min: 0 }), wander: n(0.3, { min: 0 }),
  leash: n(25, { min: 0, effect: 'pull back toward home beyond this distance (0 = free)' }), leashWeight: n(1, { min: 0 }),
  fly: { type: 'boolean', default: false }, altitude: { type: 'list', of: { type: 'number' }, min: 2, max: 2, effect: 'flyers: [min, max] height above home' },
  avoid: { type: 'list', default: [{ target: 'player', radius: 8, weight: 3 }], of: { type: 'object', fields: { target: { type: 'string', selects: ENTITY_KINDS, required: true, effect: "'player', an archetype id or an entity id" }, radius: n(8, { min: 0 }), weight: n(3, { min: 0 }) } } },
  obstacles: { type: 'boolean', default: true, effect: 'raycast ahead and steer off walls' },
};

export default {
  id: ID,
  card: {
    loop: { verbs: [], progress: ['flock_scatter'] },
    intent: 'Boids flocks (birds, fish, herds, swarms): separation, alignment, cohesion, wander, home leash, predator avoidance (player or archetypes) and look-ahead obstacle avoidance; ground herds or 3D flyers with an altitude band.',
    views: ['any'],
    params: {
      flocks: { type: 'list', default: [], of: { type: 'object', fields: FLOCK } },
      plane: { type: 'string', default: 'auto', options: ['auto', 'xy', 'xz', 'xyz'] },
      space: { type: 'ref', to: 'space' },
    },
    provides: { events: ['flock_spawn', 'flock_scatter'] },
    requires: { capabilities: ['position'] },
    reads: ['content.archetypes'],
    rules: {
      flock_duplicate: { fields: ['flocks[].id'], message: 'each flock has its own id' },
      flock_home: { fields: ['flocks[].at', 'flocks[].zone', 'flocks[].count'], message: 'a flock that spawns members (count > 0) has a home: at or zone',
        example: { flocks: [{ id: 'birds', archetype: 'ball', count: 4, at: null, zone: null, spread: null, maxSpeed: null, maxForce: null, neighbor: null, sepDist: null, separation: null, alignment: null, cohesion: null, wander: null, leash: null, leashWeight: null, fly: null, altitude: null, obstacles: null }] } },
      flock_altitude: { fields: ['flocks[].altitude'], message: 'altitude is [min, max] with min at most max',
        example: { flocks: [{ id: 'birds', archetype: 'ball', count: 4, at: [1, 1, 0], zone: null, spread: null, maxSpeed: null, maxForce: null, neighbor: null, sepDist: null, separation: null, alignment: null, cohesion: null, wander: null, leash: null, leashWeight: null, fly: null, altitude: [9, 2], obstacles: null }] } },
    },
  },
  validate(config) {
    const errors = [], ids = new Set();
    config.flocks.forEach((f, i) => {
      if (ids.has(f.id)) errors.push({ code: 'flock_duplicate', path: `flocks[${i}].id`, message: `duplicate flock '${f.id}'` }); ids.add(f.id);
      if (f.at === undefined && f.zone === undefined && f.count > 0) errors.push({ code: 'flock_home', path: `flocks[${i}]`, message: 'a flock that spawns needs at or zone' });
      if (f.altitude && f.altitude[0] > f.altitude[1]) errors.push({ code: 'flock_altitude', path: `flocks[${i}].altitude`, message: 'min above max' });
    });
    return errors;
  },
  install(rt, config) {
    rt.on('despawn', ({ id }, rt) => { const s = st(rt); if (s.v) delete s.v[id]; });
    rt.system('movement', rt => {
      const s = st(rt); s.v ??= {}; s.spawned ??= {};
      for (const f of config.flocks) {
        if (!s.spawned[f.id]) { s.spawned[f.id] = true; spawnFlock(rt, config, f); }
        const members = Object.values(rt.state.entities).filter(e => e.components.boid?.flock === f.id && continuous(e) && !dead(e));
        steerFlock(rt, config, f, members);
      }
    }, ID);
  },
};

function homeOf(rt, config, f) {
  const sid = config.space ?? rt.player()?.space ?? rt.doc.spaces[0].id;
  return { sid, at: f.at ? v3(f.at) : zonePoint(rt, sid, f.zone) };
}
function spawnFlock(rt, config, f) {
  const { sid, at } = homeOf(rt, config, f); if (!at || !rt.spaces().includes(sid)) return;
  const api = rt.space(sid);
  for (let k = 0; k < f.count; k++) {
    let p = randomPoint(rt, api, at, f.spread, f.fly ? 'xyz' : config.plane);
    if (f.fly && f.altitude) { const up = upAt(api, at) || [0, 0, 1]; p = add(sub(p, mul(up, dot(sub(p, at), up))), mul(up, between(rt, f.altitude[0], f.altitude[1]))); }
    if (can(api, 'getCell') && api.getCell(p)) continue;
    const e = rt.spawn(f.archetype, { space: sid, at: r6(p), components: { boid: { flock: f.id } } });
    st(rt).v[e.id] = r6(mul(norm(planar(api, e.at, [between(rt, -1, 1), between(rt, -1, 1), between(rt, -1, 1)], f.fly ? 'xyz' : config.plane, f.fly)), f.maxSpeed * 0.5));
  }
  rt.emit('flock_spawn', { flock: f.id, count: f.count });
}

function steerFlock(rt, config, f, members) {
  const s = st(rt), dt = rt.dt, plane = f.fly ? 'xyz' : config.plane;
  const { at: home } = homeOf(rt, config, f);
  let scattered = false;
  const vel = id => (s.v[id] ??= [0, 0, 0]);
  for (const e of members) {
    const api = spaceOf(rt, e); if (!api) continue;
    const here = centerOf(e, api), v = vel(e.id);
    let sep = [0, 0, 0], ali = [0, 0, 0], coh = [0, 0, 0], nb = 0;
    for (const o of members) {
      if (o === e || o.space !== e.space) continue;
      const d = sub(here, centerOf(o, api)), l = len(d);
      if (l > f.neighbor || l < 1e-9) continue;
      nb++; ali = add(ali, vel(o.id)); coh = add(coh, centerOf(o, api));
      if (l < f.sepDist) sep = add(sep, mul(norm(d), (f.sepDist - l) / f.sepDist));
    }
    let force = mul(sep, f.separation * f.maxForce);
    if (nb) {
      ali = sub(mul(ali, 1 / nb), v); force = add(force, mul(clampLen(ali, f.maxForce), f.alignment));
      coh = sub(mul(coh, 1 / nb), here); force = add(force, mul(clampLen(mul(coh, 2), f.maxForce), f.cohesion));
    }
    if (f.wander > 0) force = add(force, mul([between(rt, -1, 1), between(rt, -1, 1), between(rt, -1, 1)], f.wander * f.maxForce));
    if (home && f.leash > 0) { const off = sub(here, home), l = len(planar(api, e.at, off, plane, f.fly)); if (l > f.leash) force = add(force, mul(norm(mul(off, -1)), f.leashWeight * f.maxForce * Math.min(2, (l - f.leash) / f.leash + 0.5))); }
    for (const a of f.avoid) {
      const threats = a.target === 'player' ? [rt.player()].filter(Boolean) : Object.values(rt.state.entities).filter(o => o.archetype === a.target || o.id === a.target);
      for (const t of threats) {
        if (t.space !== e.space || t === e) continue;
        const d = sub(here, centerOf(t, api)), l = len(planar(api, e.at, d, plane, f.fly));
        if (l < a.radius && l > 1e-9) { force = add(force, mul(norm(d), a.weight * f.maxForce * (1 - l / a.radius) * 2)); scattered = true; }
      }
    }
    if (f.fly && f.altitude && home) { const up = upAt(api, here) || [0, 0, 1], h = dot(sub(here, home), up); if (h < f.altitude[0]) force = add(force, mul(up, f.maxForce)); else if (h > f.altitude[1]) force = add(force, mul(up, -f.maxForce)); }
    if (f.obstacles && can(api, 'raycast') && len(v) > 1e-6) {
      const look = Math.max(1, len(v) * 0.6), r = api.raycast(here, norm(v), look);
      if (r?.hit === 'cell') force = add(force, mul(r.normal && len(r.normal) > 0 ? r.normal : mul(norm(v), -1), f.maxForce * 2 * (1 - r.dist / look)));
    }
    force = clampLen(planar(api, e.at, force, plane, f.fly), f.maxForce * 3);
    let nv = clampLen(add(v, mul(force, dt)), f.maxSpeed);
    nv = r6(planar(api, e.at, nv, plane, f.fly));
    s.v[e.id] = nv;
    if (moverOwned(e)) { e.components.steer = { dir: r6(norm(nv)), speed: round6(len(nv)), fly: f.fly, by: 'ai' }; continue; }
    if (len(nv) > 1e-9) { displace(rt, e, mul(nv, dt), api); e.components.body = { ...(e.components.body || {}), facing: r6(norm(nv)) }; }
  }
  if (scattered && !s[`scatter:${f.id}`]) rt.emit('flock_scatter', { flock: f.id });
  s[`scatter:${f.id}`] = scattered;
}
function clampLen(v, m) { const l = len(v); return l > m && l > 0 ? mul(v, m / l) : v; }
