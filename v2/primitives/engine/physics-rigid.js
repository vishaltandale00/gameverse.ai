// Dynamic rigid bodies (crates, barrels, debris, balls) in any space.
// Entities with components.rigid {mass, restitution?, friction?, static?}
// keep velocity in components.body.vel. Spaces that run their own solver
// report the `dynamics` capability (impulse / velocity / setVelocity): this
// primitive leaves their bodies to them and routes impulses there. Elsewhere
// it integrates bodies itself in substeps: gravity from gravityAt, damping,
// collide-and-slide against the static world (bounce by restitution,
// Coulomb friction on contact), impulse resolution between bodies (moving
// characters and other solid non-rigid bodies push as infinite mass), and
// sleeping for bodies at rest.
import { isVec, v3, boxOf, boxShape, round, sweep, BODY } from './runtime-lib.js';

const ID = 'engine.physics.rigid';
const SLOP = 0.004, PERCENT = 0.8, AXES = ['x', 'y', 'z'];

export default {
  id: ID,
  card: {
    intent: 'Dynamic rigid bodies that fall, bounce, slide with friction, collide and push each other, sleep at rest and take impulses (explosions, kicks). Delegates to a space\'s own solver when it has one.',
    views: ['any'],
    params: {
      substeps: { type: 'integer', default: 2, min: 1, max: 8, effect: 'integration substeps per step' },
      maxBodies: { type: 'integer', default: 400, min: 1, max: 5000, effect: 'awake bodies simulated per step (id order)' },
      sleepSec: { type: 'number', default: 1, min: 0, max: 30, unit: 's', effect: 'at rest this long -> sleep (0 = never)' },
      sleepSpeed: { type: 'number', default: 0.05, min: 0, unit: 'm/s' },
      gravityScale: { type: 'number', default: 1, min: 0, max: 10 },
      damping: { type: 'number', default: 0.02, min: 0, max: 10, unit: '1/s', effect: 'linear velocity damping' },
      restitution: { type: 'number', default: 0.2, min: 0, max: 1, effect: 'default bounciness' },
      friction: { type: 'number', default: 0.5, min: 0, max: 2, effect: 'default Coulomb friction' },
      bounceSpeed: { type: 'number', default: 0.5, min: 0, unit: 'm/s', effect: 'slower impacts do not bounce' },
      impactSpeed: { type: 'number', default: 2, min: 0, unit: 'm/s', effect: 'impacts at least this fast emit impact' },
    },
    provides: { events: ['impact', 'impact:*', 'woke', 'slept'], services: ['rigid'] },
    requires: { capabilities: ['overlap', 'gravity'] },
    components: {
      body: BODY,
      rigid: { type: 'object', effect: 'a dynamic rigid body (velocity in components.body.vel)', fields: {
        mass: { type: 'number', min: 0.000001, effect: 'default 1' }, restitution: { type: 'number', min: 0, max: 1, effect: 'bounciness (default the body, else params.restitution)' },
        friction: { type: 'number', min: 0, max: 2, effect: 'Coulomb friction (default the body, else params.friction)' }, static: { type: 'boolean', effect: 'never moves (infinite mass)' },
        sleeping: { type: 'boolean', effect: 'at rest until touched or pushed' },
      } },
    },
  },
  logic(logic) {
    const codes = kind => [{ code: 'rigid_effect_invalid', fields: ['v'], message: 'v is a velocity vector (a list of numbers)', example: { do: kind, v: 'up' } }];
    const vec = (e, path, errors) => { if (!Array.isArray(e.v) || !e.v.every(Number.isFinite)) errors.push({ code: 'rigid_effect_invalid', path, message: `${e.do} needs v: a velocity vector` }); };
    logic.effect('impulse', { codes: codes('impulse'), check: vec, run: (e, rt, c) => { const t = rt.resolve(e.who, c); if (t) rt.service('rigid').impulse(t, e.v, { add: e.add !== false }); } });
    logic.effect('set_velocity', { codes: codes('set_velocity'), check: vec, run: (e, rt, c) => { const t = rt.resolve(e.who, c); if (t) rt.service('rigid').impulse(t, e.v, { add: false, raw: true }); } });
    logic.predicate('sleeping', { test: (p, rt, c) => Boolean(rt.resolve(p.sleeping, c)?.components.rigid?.sleeping) });
  },
  install(rt, config) {
    const st = () => rt.store(ID);
    const delegated = e => typeof rt.space(e.space).impulse === 'function';
    const isRigid = e => e.components.rigid && e.space && isVec(e.at) && !e.components.ghost;
    const body = e => { const b = (e.components.body ??= {}); b.size ??= e.at.map(() => 1); b.vel ??= e.at.map(() => 0); return b; };
    const mat = e => { const r = e.components.rigid; return { e: r.restitution ?? e.components.body?.restitution ?? config.restitution, mu: r.friction ?? e.components.body?.friction ?? config.friction }; };
    const invMass = e => (e.components.rigid ? (e.components.rigid.static ? 0 : 1 / Math.max(1e-6, e.components.rigid.mass ?? 1)) : 0);
    const wake = e => { const r = e.components.rigid; if (r?.sleeping) { r.sleeping = false; r.rest = 0; rt.emit('woke', { who: e.id }); } };
    const api = {
      /** Add (or set, with add:false) a velocity change v; mass-scaled unless raw. */
      impulse(e, v, { add = true, raw = false } = {}) {
        if (!e?.space) return;
        const sp = rt.space(e.space);
        if (delegated(e)) { if (add) sp.impulse(e, v, rt); else sp.setVelocity(e, v, rt); return; }
        const b = body(e), im = raw || !e.components.rigid ? 1 : invMass(e);
        b.vel = b.vel.map((x, i) => (add ? x + (v[i] ?? 0) * im : (v[i] ?? 0)));
        wake(e);
      },
      velocity: e => (delegated(e) ? rt.space(e.space).velocity(e) : body(e).vel.slice()),
      bodies: () => Object.values(rt.state.entities).filter(isRigid).map(e => e.id),
    };
    rt.provide('rigid', api);
    const impact = (e, other, speed) => { if (speed >= config.impactSpeed) rt.emitTyped('impact', other ? other.archetype : 'world', { who: e.id, other: other?.id ?? null, speed: round(speed, 100) }); };
    rt.system('physics', rt => {
      // Spaces with their own dynamics integrate rigid bodies themselves: hand them the body's material
      // (kinematic 2D spaces integrate only bodies marked ballistic; physics2d ignores the flag).
      for (const e of Object.values(rt.state.entities)) {
        if (!isRigid(e) || !delegated(e)) continue;
        const b = body(e), r = e.components.rigid, m = mat(e);
        if (b.ballistic === undefined) Object.assign(b, { ballistic: !r.static, mass: b.mass ?? r.mass ?? 1, bounce: b.bounce ?? m.e, friction: b.friction ?? m.mu });
      }
      const list = Object.values(rt.state.entities).filter(e => isRigid(e) && !delegated(e)).sort((a, b) => (a.id < b.id ? -1 : 1));
      // Sleeping bodies touched by something moving wake up.
      for (const e of list) {
        if (!e.components.rigid.sleeping) continue;
        const sp = rt.space(e.space), b = boxOf(sp, e);
        const shape = { kind: 'aabb', at: b.min.map(v => v - 0.02), size: b.max.map((v, i) => v - b.min[i] + 0.04), centered: false };
        if (sp.overlap(shape, o => o.id !== e.id && (o.components.rigid ? !o.components.rigid.sleeping && (o.components.rigid.speed ?? 0) > config.sleepSpeed : Math.hypot(...(o.components.body?.vel || [0])) > config.sleepSpeed)).length) wake(e);
      }
      const awake = list.filter(e => !e.components.rigid.sleeping && !e.components.rigid.static).slice(0, config.maxBodies);
      if (!awake.length) return;
      const h = rt.dt / config.substeps, start = new Map(awake.map(e => [e.id, e.at.slice()]));
      for (let step = 0; step < config.substeps; step++) {
        for (const e of awake) {
          const sp = rt.space(e.space), b = body(e), g = v3(sp.gravityAt(e.at)), { e: rest, mu } = mat(e);
          for (let i = 0; i < b.vel.length; i++) b.vel[i] = (b.vel[i] + g[i] * config.gravityScale * h) * (1 - Math.min(1, config.damping * h));
          const before = b.vel.slice(), r = sweep(sp, e, b.vel.map(v => v * h), rt);
          for (let i = 0; i < b.vel.length; i++) {
            if (!r.blocked[AXES[i]]) continue;
            const speed = Math.abs(before[i]); impact(e, null, speed);
            b.vel[i] = speed > config.bounceSpeed ? -before[i] * rest : 0;
            // Coulomb friction on the other axes, proportional to the normal speed lost (or gravity while resting).
            const normal = Math.max(speed, Math.abs(g[i]) * h);
            for (let j = 0; j < b.vel.length; j++) if (j !== i && b.vel[j]) { const dv = Math.min(Math.abs(b.vel[j]), mu * normal); b.vel[j] -= Math.sign(b.vel[j]) * dv; }
          }
        }
        // Body-body: candidates from the space's overlap, resolved with impulses along the least-penetration axis.
        const seen = new Set();
        for (const a of awake) {
          const sp = rt.space(a.space), ba = boxOf(sp, a);
          const ids = sp.overlap(boxShape(sp, a), o => o.id !== a.id && o.components.body && !o.components.ghost && !o.components.body.sensor && o.components.body.solid !== false);
          for (const id of ids) {
            const key = a.id < id ? `${a.id}|${id}` : `${id}|${a.id}`; if (seen.has(key)) continue; seen.add(key);
            const o = rt.entity(id), bo = boxOf(sp, o);
            let axis = -1, pen = Infinity;
            for (let i = 0; i < a.at.length && i < 3; i++) { const p = Math.min(ba.max[i], bo.max[i]) - Math.max(ba.min[i], bo.min[i]); if (p > 0 && p < pen) { pen = p; axis = i; } }
            if (axis < 0) continue;
            const n = (ba.min[axis] + ba.max[axis]) < (bo.min[axis] + bo.max[axis]) ? 1 : -1; // from a toward o
            const ia = invMass(a), io = invMass(o); if (!ia && !io) continue;
            const va = body(a).vel, vo = o.components.body.vel || a.at.map(() => 0);
            const vn = ((vo[axis] ?? 0) - (va[axis] ?? 0)) * n;
            if (vn < 0) {
              const e_ = Math.min(mat(a).e, o.components.rigid ? mat(o).e : (o.components.body.restitution ?? config.restitution));
              const j = (-(1 + e_) * vn) / (ia + io);
              va[axis] -= j * ia * n; if (o.components.rigid && io) { vo[axis] += j * io * n; wake(o); }
              impact(a, o, -vn); if (o.components.rigid) impact(o, a, -vn);
            }
            const corr = Math.max(0, pen - SLOP) * PERCENT / (ia + io);
            const shift = (e, s) => { if (!s) return; const d = e.at.map(() => 0); d[axis] = s; sp.slide(e, d, rt); };
            shift(a, -corr * ia * n); if (o.components.rigid) shift(o, corr * io * n);
          }
        }
      }
      // Sleep bodies that stayed slow.
      const limit = Math.round(config.sleepSec * 60);
      if (limit) for (const e of awake) {
        const r = e.components.rigid, from = start.get(e.id), speed = Math.hypot(...e.at.map((v, i) => v - from[i])) / rt.dt;
        r.speed = round(speed, 1000); // measured, read by the wake test of neighbours
        r.rest = speed < config.sleepSpeed ? (r.rest ?? 0) + 1 : 0;
        if (r.rest >= limit) { r.sleeping = true; body(e).vel = body(e).vel.map(() => 0); rt.emit('slept', { who: e.id }); }
      }
    }, ID);
  },
};
