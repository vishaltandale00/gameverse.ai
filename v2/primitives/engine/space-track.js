// A track: one progress axis with a lane × height cross-section. Endless
// runners (lanes, jump, slide under, ride on top of trains), lane racers and
// rail shooters. Bodies are 3D boxes [length, width in lanes, height] centred
// on e.at; slide() resolves against solid bodies (block ahead, land on top),
// the ground and the lane edges. A window around the leader gives `bounds`,
// culls passed obstacles and reports `passed` (near-miss and combo scoring);
// looped tracks wrap progress and count laps.
import { zonesData } from './runtime-lib.js';
import { zoneIndex, zoneTracker, zoneEditor, ownSpaces, inSpace, bodyOf, clamp, mod, wrapDelta, BOUNDS_CAPS, obstacleOf, obstaclesIn } from './spaces2d-lib.js';
import { SCENERY_PARAM } from './spaces2d-scenery.js';

const EPS = 1e-6;
const STICK = 0.5; // a rider stays on the body it stands on if that body rose at most this far since its last slide
const v3 = a => [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0];

/** A rule example: the race's circuit as one plain space (its zones kept) with these zones added. */
const CIRCUIT_ZONES = [['start_line', 'Start line', [0, 6]], ['first_bend', 'First bend', [25, 31]], ['back_straight', 'Back straight', [50, 56]], ['hairpin', 'Hairpin', [75, 81]], ['chicane', 'Chicane', [100, 106]], ['long_sweep', 'Long sweep', [125, 131]], ['final_bend', 'Final bend', [150, 156]], ['home_straight', 'Home straight', [175, 181]]].map(([id, name, range]) => ({ id, name, range }));
const circuitWith = (...zones) => ({ doc: { spaces: [{ id: 'circuit', use: 'engine.space.track', with: { lanes: 5, laneWidth: 1, length: 200, loop: true }, zones: [...CIRCUIT_ZONES, ...zones] }] } });

export default {
  id: 'engine.space.track',
  card: {
    intent: 'A track with a progress axis and a lane/height cross-section: endless runners (switch lanes, jump, slide, ride on obstacles), lane racers and rail shooters. Optional loop with lap counting; a window around the leader culls passed obstacles.',
    views: ['3p', 'side', 'td'],
    // The coordinate frame (runtime-lib-frame.js): `up` the axis pointing up (null: a plane seen from above, the viewer
    // up), `handed` whether x, y, up (or x, y, toward the viewer) is a right- or left-handed frame.
    frame: { up: 2, handed: 'left' },
    needs: { content: ['course'] },
    params: {
      scenery: SCENERY_PARAM,
      lanes: { type: 'integer', min: 1, max: 16, default: 3, effect: 'number of lanes (lane index 0..lanes-1; positions may be fractional mid-switch)' },
      laneWidth: { type: 'number', min: 0.1, max: 100, default: 1, unit: 'u', effect: 'lane spacing in track units (distance and rendering)' },
      length: { type: 'number', min: 0, default: 0, unit: 'u', scale: 'world', effect: 'track length; 0 = endless' },
      loop: { type: 'boolean', default: false, effect: 'progress wraps at length (circuits); emits lap' },
      gravity: { type: 'number', default: -30, unit: 'u/s²', effect: 'gravity along the height axis' },
      ceiling: { type: 'number', min: 0.1, default: 8, unit: 'u', effect: 'maximum height' },
      window: { type: 'list', of: { type: 'number', min: 0 }, min: 2, max: 2, default: [10, 60], unit: 'u', effect: '[behind, ahead] of the leader: the bounds window' },
      leader: { type: 'string', default: 'player', effect: 'entity whose progress defines the window' },
    },
    provides: {
      capabilities: ['position', 'distance', 'overlap', 'raycast', 'gravity', 'dynamics', 'bounds', 'wrap'],
      capabilityMethods: { ...BOUNDS_CAPS },
      events: ['enter_zone', 'leave_zone', 'enter_zone:*', 'leave_zone:*', 'passed', 'culled', 'lap', 'landed', 'zone_added', 'zone_removed', 'zone_moved'],
    },
    at: 'At = [progress, lane, height], the centre of the body box; components.body.size = [length, width in lanes, height] (default [1, 0.8, 1]). Resting on the ground means height = size[2] / 2.',
    zones: 'Zone = {id, name?, range:[p0,p1), lanes?:[l0,l1] inclusive, tags?, rules?} — track segments (tunnel, bridge, finish)',
    data: zonesData('range', 'lanes', 'tags'),
    rules: {
      track_loop_length: { fields: ['loop', 'length'], message: 'a looped track has a length > 0' },
      zone_range_invalid: { fields: ['zones[].range'], message: 'a track zone has range [p0, p1) with p1 > p0', example: circuitWith({ id: 'pit', name: 'Pit', range: [40, 30] }) },
      zone_lanes_invalid: { fields: ['zones[].lanes', 'lanes'], message: 'zone lanes [l0, l1] lie within 0..lanes-1 with l0 ≤ l1', example: circuitWith({ id: 'pit', name: 'Pit', range: [30, 40], lanes: [3, 7] }) },
    },
    state: 'rt.state.spaces[id] = {laps:{entity:n}, passed:{obstacle:true}, inside, zones?}',
    notes: 'slide blocked keys x/y/z are progress/lane/height. Solid bodies (body.solid) block and can be stood on, one-way ones (body.oneWay) only stood on; riders (body.standingOn) move with ballistic movers and with setPos(e, at, rt, {carry:true}); body.obstacle marks things the leader can pass (passed event, used for near-miss); body.cull despawns them once behind the window; body.ballistic bodies are integrated (oncoming trains: gravityScale 0, vel [-v,0,0]).',
  },
  capabilities(config) { const caps = ['position', 'distance', 'overlap', 'raycast', 'gravity', 'dynamics', 'bounds']; if (config.loop) caps.push('wrap'); return caps; },
  validate(config, doc, ctx, inst) {
    const errors = [];
    if (config.loop && !(config.length > 0)) errors.push({ code: 'track_loop_length', path: 'with.length', message: 'a looped track needs a positive length' });
    for (const [s, i] of ownSpaces(doc, 'engine.space.track', config, inst)) (s.zones || []).forEach((z, j) => {
      const r = z.range, path = `spaces[${i}].zones[${j}]`;
      if (!Array.isArray(r) || !(r[1] > r[0])) errors.push({ code: 'zone_range_invalid', path: `${path}.range`, message: `zone '${z.id}' needs range [p0, p1) with p1 > p0` });
      if (Array.isArray(z.lanes) && (z.lanes[0] < 0 || z.lanes[1] > config.lanes - 1 || z.lanes[1] < z.lanes[0])) errors.push({ code: 'zone_lanes_invalid', path: `${path}.lanes`, message: `lanes must lie within 0..${config.lanes - 1}` });
    });
    return errors;
  },
  install(rt, config, instance) {
    const sid = instance.id, L = config.length, loop = config.loop, LW = config.laneWidth, maxLane = config.lanes - 1;
    const sst = () => rt.state.spaces[sid];
    const zones = zoneIndex(rt, sid);
    const dp = (a, b) => wrapDelta(a, b, loop ? L : 0);
    const zoneHas = (z, at) => { const p = loop ? mod(at[0], L) : at[0]; return Boolean(z.range) && p >= z.range[0] && p < z.range[1] && (!z.lanes || (Math.round(at[1]) >= z.lanes[0] && Math.round(at[1]) <= z.lanes[1])); };
    const tracker = zoneTracker(rt, sid, zones, zoneHas, z => (z.range ? (z.range[1] - z.range[0]) * (z.lanes ? z.lanes[1] - z.lanes[0] + 1 : config.lanes) : Infinity));
    const size = e => { const b = bodyOf(e, { size: [1, 0.8, 1] }); if (b.size.length < 3) b.size = [b.size[0], b.size[1] ?? 0.8, b.size[1] ?? 1]; if (b.vel.length < 3) b.vel = v3(b.vel); return b.size; };
    const box = (at, s) => [at[0] - s[0] / 2, at[1] - s[1] / 2, at[2] - s[2] / 2, at[0] + s[0] / 2, at[1] + s[1] / 2, at[2] + s[2] / 2];
    const boxOf = e => box(e.at, size(e));
    // Overlap along progress is loop-aware: compare against the other box shifted by the short way round.
    const overlap3 = (a, b, m = 0) => { const s = loop ? dp((a[0] + a[3]) / 2, (b[0] + b[3]) / 2) - ((b[0] + b[3]) / 2 - (a[0] + a[3]) / 2) : 0; return a[0] < b[3] + s + m && b[0] + s < a[3] + m && a[1] < b[4] + m && b[1] < a[4] + m && a[2] < b[5] + m && b[2] < a[5] + m; };
    const leader = () => rt.entity(config.leader) || null;
    const clampAt = (at, s) => [at[0], clamp(at[1], 0, maxLane), clamp(at[2], s[2] / 2, Math.max(s[2] / 2, config.ceiling - s[2] / 2))];
    // setPos(e, at, rt, {carry}): with carry, bodies standing on e (body.standingOn) move with it.
    const setPos = (e, at, rt, o = {}) => {
      const s = size(e), p = clampAt(v3(at), s), from = e.at && e.at.slice();
      if (o.carry && from && obstacleOf(e)) { const d = [dp(from[0], p[0]), p[1] - from[1], p[2] - from[2]]; if (d.some(Boolean)) for (const r of inSpace(rt, sid, x => x !== e && x.components.body?.standingOn === e.id)) { slide(r, d, rt, { ignore: [e.id], keepSupport: true }); r.components.body.grounded = true; r.components.body.standingOn = e.id; } }
      if (loop) { const before = e.at?.[0], next = mod(p[0], L); if (before != null && p[0] >= L && before < L) { const laps = (sst().laps ??= {}); laps[e.id] = (laps[e.id] || 0) + 1; rt.emit('lap', { who: e.id, lap: laps[e.id] }); } p[0] = next; }
      e.at = p; tracker.track(e, rt);
    };
    // Entity obstacles for one slide: body.solid (block every axis, stand on top) and body.oneWay (stand on
    // top only). Ones already overlapping the mover are ignored, except its support, which only holds it up.
    const obstaclesFor = (e, o = {}) => {
      const start = boxOf(e), on = e.components.body?.standingOn;
      return obstaclesIn(rt, sid, e, o.ignore).map(x => ({ id: x.id, kind: obstacleOf(x), box: boxOf(x) }))
        .filter(x => x.id === on || x.kind === 'oneway' || !overlap3(start, x.box, -EPS))
        .map(x => (x.id === on && overlap3(start, x.box, -EPS) ? { ...x, kind: 'oneway' } : x));
    };

    function slide(e, d, rt, opts = {}) {
      const s = size(e), b = bodyOf(e), at = e.at.slice(), blocked = { x: false, y: false, z: false };
      let grounded = false, normal = null, landedOn = null;
      const others = opts.ghost ? [] : obstaclesFor(e, opts), on = b.standingOn ?? null, touched = [];
      // One-way tops count only when falling onto them from above (their support may have risen up to STICK).
      const hits = (p, k, bottom) => others.find(o => overlap3(box(p, s), o.box, -EPS) && (o.kind === 'solid' || (k === 2 && d[2] < 0 && bottom >= o.box[5] - (o.id === on ? STICK : EPS)))) || null;
      // Progress, then lanes, then height (axis-separated; small sub-steps so thin obstacles still block).
      for (const k of [0, 1, 2]) {
        const n = Math.max(1, Math.ceil(Math.abs(d[k] || 0) / Math.max(0.05, s[k] / 2)));
        const s0 = at[k];
        for (let i = 0; i < n && d[k]; i++) {
          const next = at.slice(); next[k] = s0 + d[k] * (i + 1) / n; // exact end point, no drift
          const lim = clampAt(next, s); if (k && lim[k] !== next[k]) { next[k] = lim[k]; blocked[k ? (k === 1 ? 'y' : 'z') : 'x'] = true; if (k === 2 && d[k] < 0) grounded = true; }
          const o = hits(next, k, at[2] - s[2] / 2);
          if (o) {
            const ob = o.box; if (!touched.includes(o.id)) touched.push(o.id);
            if (k === 2 && d[2] < 0) { next[2] = ob[5] + s[2] / 2; grounded = true; landedOn = o.id; normal = [0, 0, 1]; at[2] = next[2]; }
            else if (k === 2) { next[2] = ob[2] - s[2] / 2 - EPS; normal = [0, 0, -1]; at[2] = next[2]; }
            else normal = k === 0 ? [-Math.sign(d[0]), 0, 0] : [0, -Math.sign(d[1]), 0];
            blocked[['x', 'y', 'z'][k]] = true; break;
          }
          at[k] = next[k];
          if (blocked[['x', 'y', 'z'][k]]) break;
        }
      }
      if (!grounded) { const g = groundedAt(e, at, s, others); grounded = Boolean(g); if (g?.id) landedOn = g.id; }
      const moved = at.some((v, i) => v !== e.at[i]);
      b.grounded = grounded;
      if (landedOn && grounded) b.standingOn = landedOn; else if (!opts.keepSupport) delete b.standingOn;
      setPos(e, at, rt, { carry: Boolean(obstacleOf(e)) });
      return { moved, blocked, grounded, normal, on: b.standingOn ?? null, touched };
    }
    /** Ground (true / {}) or the entity top under the body ({id}), else null. */
    function groundedAt(e, at, s, list = obstaclesFor(e)) {
      if (at[2] - s[2] / 2 <= EPS) return {};
      const probe = at.slice(); probe[2] -= 0.02;
      const o = list.find(o => overlap3(box(probe, s), o.box, -EPS) && Math.abs(o.box[5] - (at[2] - s[2] / 2)) < 0.03);
      return o ? { id: o.id } : null;
    }
    const window = () => { const l = leader(), p = l ? l.at[0] : 0; return [p - config.window[0], p + config.window[1]]; };

    const api = {
      kind: 'track', anchor: 'center', size: [L, config.lanes], config,
      get zones() { return zones().byId; },
      place(e, rt) { size(e); if (e.at == null) { const z = zones().list[0]; e.at = [z ? z.range[0] : 0, Math.floor(config.lanes / 2), 0]; } e.at = v3(e.at); if (e.at[2] < size(e)[2] / 2) e.at[2] = size(e)[2] / 2; setPos(e, e.at, rt); },
      remove(e, rt) { for (const z of sst().inside?.[e.id] || []) rt.emitTyped('leave_zone', z, { who: e.id, zone: z }); tracker.forget(e); e.zone = null; },
      pos: e => e.at, setPos,
      entitiesAt: at => { const p = v3(at); return inSpace(rt, sid, e => { const b = boxOf(e); return overlap3([p[0], p[1], p[2], p[0], p[1], p[2]], b, EPS); }).map(e => e.id); },
      inZone: (e, zone) => { const z = zones().byId.get(zone); return Boolean(z) && zoneHas(z, e.at); },
      zoneAt: at => tracker.zoneAt(typeof at === 'string' ? at.split(',').map(Number) : v3(at)),
      cellOf: e => `${Math.round(e.at[0])},${Math.round(e.at[1])}`,
      teleport(e, { zone, at }, rt) { const z = zone && zones().byId.get(zone); const p = at ?? (z ? [z.range[0], z.lanes ? z.lanes[0] : e.at[1], size(e)[2] / 2] : e.at); bodyOf(e).vel = [0, 0, 0]; setPos(e, p, rt); },
      nearest(e, target, rt) {
        const z = zones().byId.get(target);
        if (z) { if (zoneHas(z, e.at)) return 0; const a = dp(e.at[0], z.range[0]), b = dp(e.at[0], z.range[1]); return Math.min(Math.abs(a), Math.abs(b)); }
        let best = null; for (const o of inSpace(rt, sid)) if (o !== e && (o.id === target || o.archetype === target)) { const d = api.distance(e.at, o.at); if (best === null || d < best) best = d; }
        return best;
      },
      distance(a, b, metric = 'euclid') {
        a = v3(a); b = v3(b); const d = [dp(a[0], b[0]), (b[1] - a[1]) * LW, b[2] - a[2]];
        return metric === 'progress' ? Math.abs(d[0]) : metric === 'manhattan' ? Math.abs(d[0]) + Math.abs(d[1]) + Math.abs(d[2]) : Math.hypot(...d);
      },
      wrapPos: at => { const p = v3(at); return [loop ? mod(p[0], L) : p[0], p[1], p[2]]; },
      delta: (a, b) => [dp(v3(a)[0], v3(b)[0]), v3(b)[1] - v3(a)[1], v3(b)[2] - v3(a)[2]],
      bounds: () => { const w = window(); return { min: [w[0], 0, 0], max: [w[1], maxLane, config.ceiling], wrap: [loop, false, false] }; },
      inBounds: (at, m = 0) => { const w = window(), p = v3(at), x = loop ? w[0] + mod(p[0] - w[0], L) : p[0]; return x >= w[0] - m && x <= w[1] + m && p[1] >= -m && p[1] <= maxLane + m; },
      overlap(shape, filter) {
        const f = typeof filter === 'function' ? filter : null, at = v3(shape.at);
        if (shape.kind === 'circle' || shape.kind === 'sphere') {
          const r = shape.r ?? 0;
          return inSpace(rt, sid, e => {
            if (f && !f(e)) return false;
            const b = boxOf(e), shift = loop ? dp(at[0], e.at[0]) - (e.at[0] - at[0]) : 0; // nearest copy round a loop
            const q = [clamp(at[0], b[0] + shift, b[3] + shift), clamp(at[1], b[1], b[4]), clamp(at[2], b[2], b[5])];
            return Math.hypot(q[0] - at[0], (q[1] - at[1]) * LW, q[2] - at[2]) <= r;
          }).map(e => e.id);
        }
        const s = v3(shape.size || [0, 0, 0]);
        const probe = shape.centered ? box(at, s) : [at[0], at[1], at[2], at[0] + s[0], at[1] + s[1], at[2] + s[2]];
        return inSpace(rt, sid, e => (!f || f(e)) && overlap3(probe, boxOf(e), EPS)).map(e => e.id);
      },
      contacts(e) { const b = boxOf(e); return inSpace(rt, sid, o => o !== e && overlap3(b, boxOf(o), 0.01)).map(o => { const d = api.delta(o.at, e.at); const k = [Math.abs(d[0]), Math.abs(d[1] * LW), Math.abs(d[2])].indexOf(Math.max(Math.abs(d[0]), Math.abs(d[1] * LW), Math.abs(d[2]))); const n = [0, 0, 0]; n[k] = Math.sign(d[k]) || 1; return { id: o.id, normal: n }; }); },
      raycast(from, dir, maxDist, mask = {}) {
        const o = v3(from), u0 = v3(dir), l = Math.hypot(...u0) || 1, u = u0.map(v => v / l);
        let best = { hit: 'none', at: null, normal: null, dist: maxDist };
        if (mask.cells !== false && u[2] < 0) { const t = (0 - o[2]) / u[2]; if (t >= 0 && t <= best.dist) best = { hit: 'cell', at: o.map((v, i) => v + u[i] * t), normal: [0, 0, 1], dist: t, cell: 'ground' }; }
        if (mask.entities !== false) for (const e of inSpace(rt, sid)) {
          if (e.id === mask.ignore || (typeof mask.entities === 'function' && !mask.entities(e))) continue;
          const b = boxOf(e), shift = loop ? dp(o[0], e.at[0]) - (e.at[0] - o[0]) : 0;
          let t0 = 0, t1 = best.dist, ax = -1;
          for (let i = 0; i < 3; i++) {
            const lo = b[i] + (i ? 0 : shift), hi = b[i + 3] + (i ? 0 : shift);
            if (Math.abs(u[i]) < 1e-12) { if (o[i] < lo || o[i] > hi) { t0 = Infinity; break; } continue; }
            let a = (lo - o[i]) / u[i], c = (hi - o[i]) / u[i]; if (a > c) [a, c] = [c, a];
            if (a > t0) { t0 = a; ax = i; } t1 = Math.min(t1, c); if (t0 > t1) { t0 = Infinity; break; }
          }
          if (t0 < best.dist || (t0 === best.dist && best.hit === 'none' && t0 < Infinity)) { const n = [0, 0, 0]; if (ax >= 0) n[ax] = -Math.sign(u[ax]); best = { hit: 'entity', at: o.map((v, i) => v + u[i] * t0), normal: n, dist: t0, id: e.id }; }
        }
        return best;
      },
      gravityAt: () => [0, 0, config.gravity],
      slide,
      grounded: e => Boolean(groundedAt(e, e.at, size(e))),
      impulse(e, v) { const b = bodyOf(e), m = b.mass || 1; size(e); b.vel = v3(b.vel).map((x, i) => x + (v[i] ?? 0) / m); },
      velocity: e => { size(e); return bodyOf(e).vel.slice(); },
      setVelocity(e, v) { bodyOf(e).vel = v3(v); },
      laps: e => sst().laps?.[e.id] ?? 0,
      ...zoneEditor(rt, sid, zones, z => (Array.isArray(z.range) && z.range.length === 2 ? null : 'needs range [p0, p1]'), rt => { for (const e of inSpace(rt, sid)) tracker.track(e, rt); }),
    };
    api.applyImpulse = api.impulse;
    rt.defineSpace(sid, api);

    rt.system('physics', rt => {
      const dt = rt.dt;
      for (const e of inSpace(rt, sid, e => e.components.body?.ballistic)) {
        size(e); const b = e.components.body, gs = b.gravityScale ?? 1, was = b.grounded;
        b.vel = [b.vel[0], b.vel[1], b.vel[2] + config.gravity * gs * dt];
        const vz = b.vel[2], r = b.collide === false ? (setPos(e, e.at.map((v, i) => v + b.vel[i] * dt), rt, { carry: true }), { blocked: {}, grounded: false }) : slide(e, b.vel.map(v => v * dt), rt, { ghost: Boolean(obstacleOf(e)) });
        if (r.blocked.z || (r.grounded && vz < 0)) b.vel[2] = 0;
        if (r.grounded && !was) rt.emit('landed', { who: e.id, speed: -vz });
      }
      // The leader passes obstacles; obstacles left behind the window are culled.
      const l = leader(); if (!l || l.space !== sid) return;
      const w = window(), passed = (sst().passed ??= {});
      for (const e of inSpace(rt, sid, e => e !== l)) {
        const b = e.components.body; if (!b) continue;
        const behind = dp(l.at[0], e.at[0]) + size(e)[0] / 2 < -size(l)[0] / 2;
        if (b.obstacle && behind && !passed[e.id]) { passed[e.id] = true; rt.emit('passed', { who: e.id, by: l.id, lane: Math.round(e.at[1]), gap: +Math.abs(e.at[1] - l.at[1]).toFixed(6) }); }
        if (b.cull && dp(w[0], e.at[0]) + size(e)[0] / 2 < 0) { delete passed[e.id]; rt.emit('culled', { who: e.id }); rt.despawn(e.id); }
      }
    }, sid);
  },
};
