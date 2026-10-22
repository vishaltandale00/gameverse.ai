// Kinematic character controller over the space's `gravity` capability.
// Integrates entities whose components.body.controller is 'character' (and
// the player when `player` is set and it has no other controller): gravity
// from gravityAt while airborne (per-entity gravityScale, clamped to
// maxFall), collide-and-slide through space.slide with step-up and a slope
// limit, ceiling and wall stops, and landed / fell / left_ground events.
// Movement primitives either let it integrate (they write body.vel in the
// `movement` phase) or own integration themselves (body.controller = 'move')
// and call the `character` service's move() for slides with step-up.
import { isVec, v3, round, sweep, BODY } from './runtime-lib.js';

const ID = 'engine.physics.character';

export default {
  id: ID,
  card: {
    intent: 'Kinematic character controller for any space with gravity: gravity, collide-and-slide, step-up, slope limit, ceilings, landing and fall events. Movement primitives set desired velocity (body.vel) or call its move() service for their own slides.',
    views: ['any'],
    params: {
      radius: { type: 'number', default: 0.35, min: 0.01, max: 50, unit: 'm', effect: 'capsule radius (default body size x/z = 2r)' },
      height: { type: 'number', default: 1.8, min: 0.01, max: 100, unit: 'm', effect: 'capsule height (default body size y)' },
      stepHeight: { type: 'number', default: 0.4, min: 0, max: 10, unit: 'm', effect: 'ledges up to this high are stepped onto' },
      slopeLimit: { type: 'number', default: 50, min: 0, max: 89, unit: 'deg', effect: 'steeper ground does not count as standing (the character slides)' },
      skin: { type: 'number', default: 0.02, min: 0, max: 1, unit: 'm', effect: 'contact offset used by the step-down probe' },
      gravityScale: { type: 'number', default: 1, min: 0, max: 10, effect: 'multiplier on the space\'s gravity' },
      maxFall: { type: 'number', default: 55, min: 0.1, max: 1000, unit: 'm/s', effect: 'terminal fall speed' },
      fallHeight: { type: 'number', default: 4, min: 0, unit: 'm', effect: 'landing after a drop at least this high also emits fell' },
      snap: { type: 'boolean', default: true, effect: 'stick to the ground when walking down small steps' },
      player: { type: 'boolean', default: true, effect: 'drive the player when it has no other body.controller' },
    },
    provides: { events: ['landed', 'fell', 'left_ground', 'jumped', 'head_hit'], services: ['character'] },
    requires: { capabilities: ['gravity'] },
    components: { body: BODY },
  },
  install(rt, config) {
    const st = () => rt.store(ID);
    const settings = e => {
      const o = e.components.body?.character || {};
      return { radius: o.radius ?? config.radius, height: o.height ?? config.height, stepHeight: o.stepHeight ?? config.stepHeight, slopeLimit: o.slopeLimit ?? config.slopeLimit, gravityScale: o.gravityScale ?? config.gravityScale, maxFall: o.maxFall ?? config.maxFall, skin: config.skin };
    };
    const driven = e => { const c = e.components.body?.controller; return c === 'character' || (config.player && e.id === 'player' && c === undefined); };
    const body = e => {
      const b = (e.components.body ??= {});
      if (!b.size) { const s = settings(e); b.size = Array.isArray(e.at) && e.at.length === 2 ? [s.radius * 2, s.height] : [s.radius * 2, s.height, s.radius * 2]; }
      b.vel ??= Array.isArray(e.at) ? e.at.map(() => 0) : [0, 0, 0];
      return b;
    };
    const steep = (api, e) => {
      if (!api.slopeAt || !isVec(e.at) || e.at.length < 3) return false;
      return api.slopeAt(e.at[0], e.at[2]) > settings(e).slopeLimit;
    };
    /** Collide-and-slide `delta` with step-up; returns the space's slide result (+ stepped, steep). */
    const move = (e, delta, rt_ = rt) => {
      const api = rt_.space(e.space), s = settings(e), d = v3(delta).slice(0, Array.isArray(e.at) ? Math.max(2, e.at.length) : 3);
      const before = v3(e.at), grounded = Boolean(e.components.body?.grounded);
      let r = sweep(api, e, d, rt_, { stepHeight: s.stepHeight });
      const horiz = [0, 2].filter(i => i < d.length && d[i] && r.blocked[['x', 'y', 'z'][i]]);
      // Step-up: lift, move horizontally, drop back; keep it only if the horizontal move got further.
      if (horiz.length && grounded && s.stepHeight > 0) {
        const at0 = v3(e.at), lift = Array(d.length).fill(0); lift[1] = s.stepHeight;
        const up = api.slide(e, lift, rt_);
        const side = d.map((v, i) => (i === 1 ? 0 : v - (at0[i] - before[i]))); // what the blocked slide did not cover
        const moved = api.slide(e, side, rt_);
        const down = Array(d.length).fill(0); down[1] = -(v3(e.at)[1] - at0[1]) - s.skin;
        const land = sweep(api, e, down, rt_);
        const gained = horiz.some(i => Math.abs(v3(e.at)[i] - at0[i]) > 1e-6);
        if (up.moved && moved.moved && gained && land.grounded) r = { ...land, blocked: { ...moved.blocked, y: false }, moved: true, grounded: true, stepped: true };
        else api.setPos(e, at0.slice(0, d.length), rt_);
      }
      const isSteep = r.grounded && steep(api, e);
      if (e.components.body) e.components.body.grounded = Boolean(r.grounded) && !isSteep;
      return { ...r, grounded: Boolean(r.grounded) && !isSteep, steep: isSteep, delta: v3(e.at).map((v, i) => round(v - before[i], 1e6)) };
    };
    const service = {
      settings, move,
      grounded: e => Boolean(e?.components.body?.grounded),
      airTime: e => st()[e?.id]?.air ?? 0,
      jump(e, speed) { const b = body(e); b.vel[1] = speed; const s = (st()[e.id] ??= {}); s.jumped = true; rt.emit('jumped', { who: e.id, speed }); },
      setGravityScale(e, scale) { const b = body(e); (b.character ??= {}).gravityScale = scale; },
    };
    rt.provide('character', service);
    rt.system('physics', rt => {
      const dt = rt.dt, store = st();
      for (const e of Object.values(rt.state.entities)) {
        if (!driven(e) || !e.space || !isVec(e.at)) continue;
        const api = rt.space(e.space); if (!api.slide || !api.gravityAt) continue;
        const b = body(e), s = settings(e), m = (store[e.id] ??= {}), wasGrounded = Boolean(b.grounded);
        const g = v3(api.gravityAt(e.at));
        if (!wasGrounded || b.vel[1] > 0) {
          for (let i = 0; i < b.vel.length; i++) b.vel[i] += g[i] * s.gravityScale * dt;
          if (b.vel[1] < -s.maxFall) b.vel[1] = -s.maxFall;
        } else if (b.vel[1] < 0) b.vel[1] = 0;
        let delta = b.vel.map(v => v * dt);
        if (wasGrounded && b.vel[1] <= 0 && config.snap) delta[1] -= s.stepHeight > 0 ? Math.min(s.stepHeight, 0.05 + Math.abs(g[1]) * dt * dt) : 0;
        const yBefore = e.at[1];
        const r = move(e, delta, rt);
        // Walking off a ledge with snap: undo the probe if it found no ground below.
        if (wasGrounded && !r.grounded && config.snap && b.vel[1] <= 0 && delta[1] < b.vel[1] * dt) { const p = e.at.slice(); p[1] = Math.max(p[1], yBefore + b.vel[1] * dt); api.setPos(e, p, rt); }
        if (r.blocked.x) b.vel[0] = 0; if (r.blocked.z && b.vel.length > 2) b.vel[2] = 0;
        if (r.blocked.y && b.vel[1] > 0) { b.vel[1] = 0; rt.emit('head_hit', { who: e.id }); }
        if (r.grounded) {
          if (!wasGrounded) {
            const speed = round(Math.abs(Math.min(0, b.vel[1])), 1000), height = round(Math.max(0, (m.peak ?? e.at[1]) - e.at[1]), 1000);
            rt.emit('landed', { who: e.id, speed, height });
            if (height >= config.fallHeight) rt.emit('fell', { who: e.id, height });
          }
          if (b.vel[1] < 0) b.vel[1] = 0;
          m.air = 0; m.peak = e.at[1]; m.jumped = false;
        } else {
          if (wasGrounded) { rt.emit('left_ground', { who: e.id, jumped: Boolean(m.jumped) }); m.peak = e.at[1]; }
          m.air = (m.air ?? 0) + 1; m.peak = Math.max(m.peak ?? e.at[1], e.at[1]);
          if (r.blocked.y && b.vel[1] < 0) b.vel[1] = 0;
        }
        b.grounded = Boolean(r.grounded);
      }
      for (const id of Object.keys(store)) if (!rt.entity(id)) delete store[id];
    }, ID);
  },
};
