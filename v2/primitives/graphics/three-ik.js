// IK solvers over plain [x,y,z] arrays (no three.js), shared by graphics.anim.ik,
// graphics.anim.secondary and graphics.anim.ragdoll. Pure and deterministic.

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = a => Math.hypot(a[0], a[1], a[2]);
export const dist = (a, b) => len(sub(a, b));
export const norm = a => { const l = len(a); return l > 1e-9 ? scale(a, 1 / l) : [0, 0, 0]; };
export const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Analytic two-bone IK (hip-knee-ankle, shoulder-elbow-wrist).
 * root, mid, end: current joint positions (only their lengths are used);
 * target: where the end should go; pole: a point the middle joint bends toward.
 * Returns { mid, end, reached, stretch } with end clamped to the reachable shell.
 */
export function solveTwoBone(root, mid, end, target, pole) {
  const l1 = dist(root, mid), l2 = dist(mid, end);
  const toT = sub(target, root);
  const dRaw = len(toT);
  const dMin = Math.abs(l1 - l2) + 1e-4, dMax = l1 + l2 - 1e-4;
  const d = clamp(dRaw, dMin, dMax);
  const dir = dRaw > 1e-9 ? scale(toT, 1 / dRaw) : norm(sub(end, root));
  // Bend direction: the pole projected onto the plane perpendicular to dir.
  let bend = sub(sub(pole, root), scale(dir, dot(sub(pole, root), dir)));
  if (len(bend) < 1e-6) { bend = sub(sub(mid, root), scale(dir, dot(sub(mid, root), dir))); }
  if (len(bend) < 1e-6) bend = Math.abs(dir[1]) < 0.9 ? cross(dir, [0, 1, 0]) : cross(dir, [1, 0, 0]);
  bend = norm(bend);
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const newMid = add(root, add(scale(dir, cosA * l1), scale(bend, sinA * l1)));
  const newEnd = add(root, scale(dir, d));
  return { mid: newMid, end: newEnd, reached: dRaw <= dMax && dRaw >= dMin, stretch: dRaw / dMax };
}

/**
 * FABRIK for chains of any length. joints: [[x,y,z]...] (root first).
 * opts: { iterations=8, tolerance=1e-3, fixedRoot=true }.
 * Returns { joints, iterations, error, reached }. Bone lengths are preserved.
 */
export function solveFabrik(joints, target, opts = {}) {
  const { iterations = 8, tolerance = 1e-3, fixedRoot = true } = opts;
  const n = joints.length, p = joints.map(j => j.slice());
  const lengths = []; for (let i = 0; i < n - 1; i++) lengths.push(dist(p[i], p[i + 1]));
  const total = lengths.reduce((s, l) => s + l, 0), root = p[0].slice();
  if (fixedRoot && dist(root, target) >= total) {
    const dir = norm(sub(target, root));
    for (let i = 1; i < n; i++) p[i] = add(p[i - 1], scale(dir, lengths[i - 1]));
    return { joints: p, iterations: 0, error: dist(p[n - 1], target), reached: false };
  }
  let it = 0, error = dist(p[n - 1], target);
  while (it < iterations && error > tolerance) {
    // Backward: end to target, walk to root.
    p[n - 1] = target.slice();
    for (let i = n - 2; i >= 0; i--) p[i] = add(p[i + 1], scale(norm(sub(p[i], p[i + 1])), lengths[i]));
    // Forward: root back to its anchor.
    if (fixedRoot) p[0] = root.slice();
    for (let i = 1; i < n; i++) p[i] = add(p[i - 1], scale(norm(sub(p[i], p[i - 1])), lengths[i - 1]));
    error = dist(p[n - 1], target); it++;
  }
  return { joints: p, iterations: it, error, reached: error <= tolerance };
}

/**
 * Head/eye look-at with joint limits. forward and up are the head's rest axes in
 * world space; returns { yaw, pitch } (radians) clamped to maxYaw/maxPitch, and
 * weight 0 when the target is behind beyond the limits (so the head eases back).
 */
export function lookAtAngles(origin, forward, up, target, maxYaw, maxPitch) {
  const f = norm(forward), u = norm(up), r = norm(cross(u, f));
  const to = norm(sub(target, origin));
  const x = dot(to, r), y = dot(to, u), z = dot(to, f);
  const yaw = Math.atan2(x, z), pitch = Math.atan2(y, Math.hypot(x, z));
  const behind = Math.abs(yaw) > maxYaw + 0.6;
  return { yaw: clamp(yaw, -maxYaw, maxYaw), pitch: clamp(pitch, -maxPitch, maxPitch), weight: behind ? 0 : 1 };
}

/**
 * Foot planting: given ankle positions from the animation and a ground sampler
 * groundAt(x, z) → { y, normal }, returns per-foot targets and the pelvis drop
 * needed so the lower foot still reaches (pelvisAdjust).
 * feet: [{ ankle:[x,y,z], height }] where height is ankle height above the sole.
 * rootY: the character's ground reference (entity y).
 */
export function plantFeet(feet, groundAt, rootY, { maxStep = 0.5 } = {}) {
  const out = feet.map(f => {
    const g = groundAt(f.ankle[0], f.ankle[2]) || { y: rootY, normal: [0, 1, 0] };
    const lift = f.ankle[1] - f.height - rootY; // animated lift above the reference ground (swing phase)
    const gy = clamp(g.y, rootY - maxStep, rootY + maxStep);
    return { target: [f.ankle[0], gy + f.height + Math.max(0, lift), f.ankle[2]], offset: gy - rootY, normal: g.normal || [0, 1, 0] };
  });
  const pelvis = Math.min(0, ...out.map(o => o.offset));
  return { feet: out, pelvis };
}

/** Spring-bone chain step (hair, capes, tails). Verlet with stiffness toward the animated pose. */
export function springStep(state, rest, dt, { stiffness = 0.4, damping = 0.6, gravity = [0, -9.8, 0], lengths } = {}) {
  // state: { pos:[[x,y,z]...], prev:[[x,y,z]...] }; rest: animated joint positions; pos[0] follows rest[0].
  const n = rest.length;
  if (!state.pos) { state.pos = rest.map(r => r.slice()); state.prev = rest.map(r => r.slice()); }
  const L = lengths || rest.slice(1).map((r, i) => dist(r, rest[i]));
  state.pos[0] = rest[0].slice(); state.prev[0] = rest[0].slice();
  const keep = 1 - clamp(damping, 0, 1) * 0.5;
  for (let i = 1; i < n; i++) {
    const p = state.pos[i], q = state.prev[i];
    const vel = scale(sub(p, q), keep);
    const pull = scale(sub(rest[i], p), clamp(stiffness, 0, 1) * 0.35); // per 60 Hz step: 1 = snappy, 0 = free
    const next = add(add(p, vel), add(pull, scale(gravity, dt * dt * (1 - stiffness))));
    state.prev[i] = p; state.pos[i] = next;
  }
  for (let i = 1; i < n; i++) state.pos[i] = add(state.pos[i - 1], scale(norm(sub(state.pos[i], state.pos[i - 1])), L[i - 1]));
  return state;
}

/**
 * Simplified ragdoll: verlet particles (one per joint) with distance constraints
 * along bones, gravity, ground collision with friction and a sleep test.
 * body: { pos, prev, links:[[i,j,len]], radius }.
 */
export function ragdollStep(body, dt, groundAt, { gravity = -9.8, iterations = 6, friction = 0.6, bounce = 0.1 } = {}) {
  const { pos, prev, links } = body, n = pos.length, r = body.radius ?? 0.06;
  let motion = 0;
  const start = pos.map(p => p.slice());
  for (let i = 0; i < n; i++) {
    const p = pos[i], q = prev[i];
    const v = sub(p, q);
    prev[i] = p.slice();
    pos[i] = add(add(p, scale(v, 0.995)), [0, gravity * dt * dt, 0]);
  }
  for (let k = 0; k < iterations; k++) {
    for (const [a, b, L] of links) {
      const d = sub(pos[b], pos[a]), l = len(d) || 1e-6, diff = (l - L) / l * 0.5;
      pos[a] = add(pos[a], scale(d, diff)); pos[b] = sub(pos[b], scale(d, diff));
    }
    for (let i = 0; i < n; i++) {
      const g = groundAt(pos[i][0], pos[i][2]); const gy = (g?.y ?? -Infinity) + r;
      if (pos[i][1] < gy) {
        const vy = pos[i][1] - prev[i][1];
        pos[i][1] = gy; prev[i][1] = gy + vy * bounce;
        prev[i][0] = pos[i][0] - (pos[i][0] - prev[i][0]) * (1 - friction);
        prev[i][2] = pos[i][2] - (pos[i][2] - prev[i][2]) * (1 - friction);
      }
    }
  }
  for (let i = 0; i < n; i++) motion = Math.max(motion, dist(pos[i], start[i]));
  body.asleep = motion < 2e-4;
  return body;
}

/** Quaternion [x,y,z,w] rotating unit vector a onto unit vector b. */
export function quatFromTo(a, b) {
  const u = norm(a), v = norm(b), d = dot(u, v);
  if (d < -0.999999) { let axis = cross([1, 0, 0], u); if (len(axis) < 1e-6) axis = cross([0, 1, 0], u); axis = norm(axis); return [axis[0], axis[1], axis[2], 0]; }
  const c = cross(u, v), q = [c[0], c[1], c[2], 1 + d], l = Math.hypot(...q);
  return q.map(x => x / l);
}
