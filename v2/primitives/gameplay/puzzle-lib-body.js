// Body helpers shared by gameplay.paddle, gameplay.launcher and gameplay.destructible.
//
// They program against capabilities only. In physics spaces (engine.space.physics2d)
// the space integrates components.body.vel and reports `contact` events
// {a, b, impulse, normal, at, speed, begin, sensor}. Changing motion goes through
// api.setVelocity / api.impulse when the space has them, else body.vel.
// In spaces without dynamics (grids, tilemaps, the test space) a primitive can
// choose motion 'self': it integrates its own bodies with gravityAt + slide and
// emits the same `contact` events, so destructibles behave the same everywhere.

/** Anchor convention of entity positions: physics spaces use centres; cell spaces box corners. */
import { bodyBox } from '../../kernel/testing.js';

export const sizeOf = e => { const s = e.components.body?.size || [1, 1]; return [s[0] ?? 1, s[1] ?? 1]; };
const anchored = (api, e) => ({ ...e, at: api.pos ? api.pos(e) : e.at, components: { ...e.components, body: { ...(e.components.body || {}), size: sizeOf(e) } } });
/** Centre of an entity's body box, honoring api.anchor through the kernel's bodyBox. */
export function centerOf(api, e) { const b = bodyBox(anchored(api, e), api); return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2]; }
/** Position an entity so its body box is centred on c (keeping any 3rd coordinate). */
export function placeCenter(rt, api, e, c) {
  const s = sizeOf(e), at = (api.pos ? api.pos(e) : e.at) || [0, 0];
  const p = api.anchor === 'center' ? [c[0], c[1]] : [c[0] - s[0] / 2, c[1] - s[1] / 2];
  api.setPos(e, at.length > 2 ? [p[0], p[1], ...at.slice(2)] : p, rt);
}
export const velOf = (api, e) => (api.velocity ? api.velocity(e) : null) || e.components.body?.vel || [0, 0];
export function setVel(rt, api, e, v) {
  if (api.setVelocity) api.setVelocity(e, v, rt);
  (e.components.body ??= {}).vel = [v[0], v[1]];
}
export const massOf = e => e.components.body?.mass ?? (e.components.body?.density ?? 1) * sizeOf(e)[0] * sizeOf(e)[1];
export function impulse(rt, api, e, p) {
  if (api.impulse) return api.impulse(e, p, rt);
  if (api.applyImpulse) return api.applyImpulse(e, p, rt);
  const m = Math.max(1e-3, massOf(e)), v = velOf(api, e);
  setVel(rt, api, e, [v[0] + p[0] / m, v[1] + p[1] / m]);
}
const isStatic = e => e.components.body?.static || e.components.body?.type === 'static';

/**
 * Self motion for spaces that do not integrate bodies. Applies gravity (gravityAt,
 * scaled by gravityScale), slides, reflects blocked axes with `restitution`, and
 * reports hits on solid cells and on overlapping entities as `contact` events.
 * Returns { cells: [{cell, normal}], ids: [id] } for this step.
 */
export function stepSelf(rt, api, e, { dt = rt.dt, gravity = true, restitution = 1, friction = 0, contactMemo, filter = () => true } = {}) {
  let v = velOf(api, e).slice();
  if (gravity && api.gravityAt) { const g = api.gravityAt(e.at), k = e.components.body?.gravityScale ?? 1; v[0] += (g[0] || 0) * k * dt; v[1] += (g[1] || 0) * k * dt; }
  const out = { cells: [], ids: [] }, m = massOf(e);
  const at0 = (api.pos ? api.pos(e) : e.at).slice();
  const res = api.slide ? api.slide(e, [v[0] * dt, v[1] * dt, 0], rt) : (api.setPos(e, [at0[0] + v[0] * dt, at0[1] + v[1] * dt, ...at0.slice(2)], rt), { blocked: {} });
  const s = sizeOf(e), c = centerOf(api, e);
  for (const [axis, i] of [['x', 0], ['y', 1]]) {
    if (!res.blocked?.[axis]) continue;
    const dir = Math.sign(v[i]) || 1, probe = c.slice();
    probe[i] += dir * (s[i] / 2 + Math.abs(v[i]) * dt + 0.02); // the slide stops short of the wall by up to one step
    const cell = probe.map(Math.floor), normal = [0, 0]; normal[i] = -dir;
    const speed = Math.abs(v[i]);
    out.cells.push({ cell, normal, speed });
    // Resting contact (gravity re-pressing each step) is not an impact.
    if (speed > 0.5) rt.emit('contact', { a: e.id, b: null, cell, impulse: m * speed * (1 + restitution), normal: [-normal[0], -normal[1]], at: probe, speed, begin: true, sensor: false });
    v[i] = speed > 0.5 ? -v[i] * restitution : 0;
    v[1 - i] *= 1 - friction;
  }
  if (api.overlap) {
    const box = { kind: 'aabb', at: [c[0] - s[0] / 2, c[1] - s[1] / 2, 0], size: [s[0], s[1], 1] };
    const touching = api.overlap(box, o => o.id !== e.id && filter(o));
    const memo = contactMemo || {};
    for (const id of touching) {
      out.ids.push(id);
      const pair = `${e.id}|${id}`; if (memo[pair]) continue; memo[pair] = true;
      const o = rt.entity(id), oc = centerOf(api, o), d = [oc[0] - c[0], oc[1] - c[1]], l = Math.hypot(...d) || 1, n = [d[0] / l, d[1] / l];
      const approach = Math.max(0, v[0] * n[0] + v[1] * n[1]);
      rt.emit('contact', { a: e.id, b: id, impulse: m * approach * (1 + restitution), normal: n, at: [(c[0] + oc[0]) / 2, (c[1] + oc[1]) / 2], speed: approach, begin: true, sensor: false });
      if (isStatic(o) || o.components.destructible) { const i = Math.abs(n[0]) > Math.abs(n[1]) ? 0 : 1; if (v[i] * n[i] > 0) v[i] = -v[i] * restitution; }
    }
    if (contactMemo) for (const k of Object.keys(contactMemo)) if (k.startsWith(`${e.id}|`) && !touching.includes(k.slice(e.id.length + 1))) delete contactMemo[k];
  }
  (e.components.body ??= {}).vel = v;
  return out;
}

/** Radial blast: impulse to dynamic bodies in range (kit: strength·k·min(2.5, m+0.3), lifted 0.35) and an `explosion` event. */
export function explode(rt, spaceId, at, r, strength, cause) {
  const api = rt.space(spaceId);
  for (const e of Object.values(rt.state.entities)) {
    if (e.space !== spaceId || !e.components.body || isStatic(e)) continue;
    const c = centerOf(api, e), d = [c[0] - at[0], c[1] - at[1]], dist = Math.hypot(...d), bound = Math.max(...sizeOf(e)) / 2;
    if (dist > r + bound) continue;
    const k = Math.max(0, 1 - Math.max(0, dist - bound) / r), n = dist > 1e-6 ? [d[0] / dist, d[1] / dist] : [0, 1];
    const m = Math.min(2.5, massOf(e) + 0.3);
    impulse(rt, api, e, [n[0] * strength * k * m, (n[1] + 0.35) * strength * k * m]);
  }
  rt.emit('explosion', { space: spaceId, at, r, strength, cause });
}
