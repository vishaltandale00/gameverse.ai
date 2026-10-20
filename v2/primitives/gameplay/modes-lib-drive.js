// Shared kinematics for vehicle motion primitives (car, boat, aircraft).
// A driven vehicle keeps its motion in components.drive:
//   { heading (rad, 0 = +u, steer +1 turns clockwise), vf (forward m/s),
//     vl (lateral m/s, + = left), vy (vertical m/s), speed (|v| m/s),
//     airborne, control? (written by AI drivers) , ... per-primitive fields }
// and mirrors world velocity into components.body.vel for other primitives.
import { has, planeFor, planeUW, fromPlane, r6, sign } from './modes-lib-util.js';

export function initDrive(v) {
  const d = (v.components.drive ??= {});
  d.heading ??= typeof v.components.body?.facing === 'number' ? v.components.body.facing : 0;
  d.vf ??= 0; d.vl ??= 0; d.vy ??= 0; d.speed ??= 0; d.airborne ??= false;
  return d;
}

/** Forward and left unit vectors in the plane for heading h. */
export const axes = h => ({ f: [Math.cos(h), Math.sin(h)], l: [-Math.sin(h), Math.cos(h)] });

/** Rotate planar velocity (vf, vl) from heading h0 into heading h1 (inertia). */
export function reproject(d, h0, h1) {
  const a = axes(h0), b = axes(h1);
  const wu = a.f[0] * d.vf + a.l[0] * d.vl, ww = a.f[1] * d.vf + a.l[1] * d.vl;
  d.vf = wu * b.f[0] + ww * b.f[1];
  d.vl = wu * b.l[0] + ww * b.l[1];
}

/** Ground height under a position, or null when the space has no ground query for this plane. */
export function groundY(api, plane, at) {
  if (plane !== 'xz') return null;
  if (has(api, 'groundAt')) return api.groundAt(at[0], at[2]).y;
  return null;
}
export function material(api, plane, at) {
  if (plane === 'xz' && has(api, 'groundAt')) return api.groundAt(at[0], at[2]).material ?? null;
  if (has(api, 'getCell')) return api.getCell(at) ?? null;
  return null;
}
export function waterDepth(api, plane, at) {
  if (!has(api, 'waterDepthAt')) return 0;
  const [u, w] = planeUW(plane, at);
  return api.waterDepthAt(u, w) || 0;
}
export function gravityY(api, at) {
  if (has(api, 'gravityAt')) { const g = api.gravityAt(at); return g?.[1] ?? -9.8; }
  return -9.8;
}

/**
 * Move a vehicle by its planar velocity plus vertical motion. In the xz plane
 * with a ground query it follows terrain: steps up to stepUp are climbed, a
 * drop beyond the ground slope makes it airborne (ramp jumps), landings are
 * reported. Collisions come from the space's slide() when it has one.
 * Returns { blockedU, blockedW, landed, impactY, tookOff }.
 */
export function moveVehicle(rt, v, api, plane, d, dt, { stepUp = 1.05, gravity = true, keepY = null } = {}) {
  const { f, l } = axes(d.heading);
  const du = (f[0] * d.vf + l[0] * d.vl) * dt, dw = (f[1] * d.vf + l[1] * d.vl) * dt;
  const at = v.at.slice(), out = { blockedU: false, blockedW: false, landed: false, impactY: 0, tookOff: false };
  let dy = 0;
  const gNow = groundY(api, plane, at);
  if (plane === 'xz' && keepY !== null) dy = keepY - at[1];
  else if (plane === 'xz' && gNow !== null) {
    const next = [at[0] + du, at[1], at[2] + dw], gNext = groundY(api, plane, next);
    if (!d.airborne) {
      const rise = gNext - at[1];
      if (rise > 0 && rise <= stepUp) { dy = rise; d.vy = rise / dt; }
      else if (rise < -0.35 && gravity) { d.airborne = true; out.tookOff = true; d.vy = Math.max(0, d.vy); }
      else if (rise <= 0) { dy = Math.max(rise, -0.35); d.vy = dy / dt; }
    }
    if (d.airborne) {
      d.vy += gravityY(api, at) * dt; dy = d.vy * dt;
      const floor = Math.max(gNow, gNext);
      if (at[1] + dy <= floor) { dy = floor - at[1]; out.landed = true; out.impactY = -d.vy; d.vy = 0; d.airborne = false; }
    }
  }
  const delta = fromPlane(plane, du, dw, dy, at.length);
  if (has(api, 'slide')) {
    // Vertical first so climbing a step does not read as a wall.
    if (plane === 'xz' && dy) api.setPos(v, [at[0], r6(at[1] + dy), at[2]], rt);
    const flat = plane === 'xz' ? [delta[0], 0, delta[2]] : delta;
    const res = api.slide(v, flat, rt);
    out.blockedU = Boolean(res.blocked?.x);
    out.blockedW = Boolean(plane === 'xz' ? res.blocked?.z : res.blocked?.y);
  } else api.setPos(v, at.map((x, i) => r6(x + (delta[i] ?? 0))), rt);
  if (Array.isArray(v.at)) v.at = v.at.map(r6);
  return out;
}

/**
 * Resolve wall hits: zero the world-velocity component along each blocked axis
 * (with a small bounce) and return the impact speed.
 */
export function resolveBlock(d, hit, restitution = 0.2) {
  if (!hit.blockedU && !hit.blockedW) return 0;
  const { f, l } = axes(d.heading);
  let wu = f[0] * d.vf + l[0] * d.vl, ww = f[1] * d.vf + l[1] * d.vl, impact = 0;
  if (hit.blockedU) { impact = Math.max(impact, Math.abs(wu)); wu = -wu * restitution; }
  if (hit.blockedW) { impact = Math.max(impact, Math.abs(ww)); ww = -ww * restitution; }
  d.vf = wu * f[0] + ww * f[1]; d.vl = wu * l[0] + ww * l[1];
  return impact;
}

/** Publish world velocity and rounded drive fields. */
export function publish(v, plane, d) {
  const { f, l } = axes(d.heading);
  const wu = f[0] * d.vf + l[0] * d.vl, ww = f[1] * d.vf + l[1] * d.vl;
  for (const k of ['heading', 'vf', 'vl', 'vy']) d[k] = r6(d[k]);
  d.speed = r6(Math.hypot(d.vf, d.vl) * (sign(d.vf) || 1));
  const body = (v.components.body ??= {});
  body.vel = r6v3(fromPlane(plane, wu, ww, d.vy, Array.isArray(v.at) ? v.at.length : 3));
}
const r6v3 = a => a.map(r6);

/** Vehicles of a motion kind in deterministic order. */
export const motionVehicles = (rt, kind) => Object.values(rt.state.entities).filter(e => e.components[kind] && e.components.vehicle && Array.isArray(e.at)).sort((a, b) => (a.id < b.id ? -1 : 1));
export { planeFor };
