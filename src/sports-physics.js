import { encodeGrid, SAFETY_GRID } from './neighborhood-safety.js';
import { certifiedSeparator } from './neighborhood-certified.generated.js';
import { certifiedSportsMove, certifiedSportsFlight, certifiedSportsCollision, certifiedSportsFloor, certifiedSportsPair } from './sports-certified.generated.js';

// Audited bridge/TCB: exact IEEE-754 -> 2^16 grid encoding is shared with city
// safety. Every accepted displacement, free-flight step and contact velocity
// passes the generated Lean predicate. The engine's kicks, AI, contact witness
// selection, camera and rendering remain outside the proof.
const GRID = BigInt(SAFETY_GRID), TICK = 60n;
const vec = v => [encodeGrid(v.x), encodeGrid(v.y ?? 0), encodeGrid(v.z)];
const decode = a => ({ x: Number(a[0]) / SAFETY_GRID, y: Number(a[1]) / SAFETY_GRID, z: Number(a[2]) / SAFETY_GRID });
const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0n);
const abs = n => n < 0n ? -n : n;
const counters = { moveChecks: 0, moveClamps: 0, flightChecks: 0, floorChecks: 0, collisionChecks: 0, pairChecks: 0, separationChecks: 0, rejectedContacts: 0 };
export function sportsPhysicsObservations() { return { ...counters, grid: SAFETY_GRID, hz: 60, kernel: 'lean-sports-v1' }; }

export function certifySportsMove(previous, proposed, maxDistance) {
  if (!Number.isFinite(maxDistance) || maxDistance < 0) throw new RangeError('Sports displacement limit must be nonnegative and finite.');
  const a = vec(previous), b = vec(proposed), limit = encodeGrid(maxDistance, 'floor');
  const accept = next => { counters.moveChecks++; return certifiedSportsMove([...a, ...next, limit]); };
  if (accept(b)) return decode(b);
  counters.moveClamps++;
  // Direction choice uses floating arithmetic only as a proposal. The exact
  // generated checker decides the accepted point, including all fallback paths.
  const delta = b.map((n, i) => Number(n - a[i]));
  const length = Math.hypot(...delta), scale = Math.max(0, Number(limit) - 3) / Math.max(1, length);
  const candidate = delta.map((n, i) => a[i] + BigInt(Math.trunc(n * Math.min(1, scale))));
  if (accept(candidate)) return decode(candidate);
  if (!accept(a)) throw new Error('Sports movement kernel rejected its stationary fallback.');
  return decode(a);
}

export function certifySportsCollision(before, proposed) {
  const a = vec(before), b = vec(proposed); counters.collisionChecks++;
  if (certifiedSportsCollision([...a, ...b])) return decode(b);
  counters.rejectedContacts++;
  const stopped = [0n, 0n, 0n];
  if (!certifiedSportsCollision([...a, ...stopped])) throw new Error('Sports collision kernel rejected its dissipative fallback.');
  return decode(stopped);
}

export function certifySportsPairCollision(beforeA, beforeB, proposedA, proposedB) {
  const a = vec(beforeA), b = vec(beforeB), pa = vec(proposedA), pb = vec(proposedB);
  // Restore the incoming center-of-mass velocity while keeping the proposed
  // relative impulse (apart from a one-grid rounding residual). Acceptance
  // still requires total energy loss; rejected contacts preserve both inputs.
  for (let i = 0; i < 3; i++) {
    const residual = a[i] + b[i] - pa[i] - pb[i];
    pa[i] += residual / 2n; pb[i] += residual - residual / 2n;
  }
  counters.pairChecks++;
  if (certifiedSportsPair([...a, ...b, ...pa, ...pb])) return { a: decode(pa), b: decode(pb) };
  counters.rejectedContacts++;
  if (!certifiedSportsPair([...a, ...b, ...a, ...b])) throw new Error('Sports pair kernel rejected its unchanged fallback.');
  return { a: decode(a), b: decode(b) };
}

export function stepSportsBall(ball, dt = 1 / 60, { gravity = 9.81, floor = .32, restitution = .55, friction = .98 } = {}) {
  if (dt !== 1 / 60) throw new RangeError('Certified sports flight requires the fixed 60 Hz simulation step.');
  if (!Number.isFinite(gravity) || gravity < 0 || !Number.isFinite(restitution) || restitution < 0 || restitution > 1
    || !Number.isFinite(friction) || friction < 0 || friction > 1) throw new RangeError('Invalid sports gravity or dissipative contact coefficients.');
  const p = vec(ball), v = vec({ x: ball.vx, y: ball.vy, z: ball.vz });
  const g = encodeGrid(gravity), ground = encodeGrid(floor, 'ceil');
  const nv = [v[0], v[1] - g / TICK, v[2]], np = p.map((n, i) => n + nv[i] / TICK);
  counters.flightChecks++;
  if (!certifiedSportsFlight([...p, ...v, ...np, ...nv, g, TICK])) throw new Error('Sports free-flight kernel rejected a numerical step.');
  let finalVelocity = nv;
  if (np[1] <= ground && nv[1] <= 0n) {
    np[1] = ground;
    const drag = encodeGrid(friction, 'floor'), bounce = encodeGrid(restitution, 'floor');
    finalVelocity = [nv[0] * drag / GRID, abs(nv[1]) * bounce / GRID, nv[2] * drag / GRID];
    // Remove a tiny bounce at contact instead of accumulating a perpetual jitter.
    if (finalVelocity[1] < encodeGrid(.2)) finalVelocity[1] = 0n;
    counters.floorChecks++;
    if (!certifiedSportsFloor([...nv, ...finalVelocity])) throw new Error('Sports floor kernel rejected a nondissipative response.');
  }
  const position = decode(np), velocity = decode(finalVelocity);
  // Extra simulation metadata (ownership/spin/touch) is deliberately untouched.
  return { x: position.x, y: position.y, z: position.z, vx: velocity.x, vy: velocity.y, vz: velocity.z };
}

// True proves separation of quantized sphere centers along their entire linear
// relative sweep. False means no certificate was found, not necessarily contact.
// Impact-time selection and curved trajectories are outside this predicate.
export function certifySportsSeparation(a0, a1, b0, b1, radiusSum) {
  if (!Number.isFinite(radiusSum) || radiusSum <= 0) throw new RangeError('Sports contact radius must be positive.');
  const aa = vec(a0), ac = vec(a1), ba = vec(b0), bc = vec(b1);
  const a = aa.map((n, i) => n - ba[i]), c = ac.map((n, i) => n - bc[i]);
  const radius = encodeGrid(radiusSum, 'ceil'), zero = [0n, 0n, 0n];
  const check = n => { counters.separationChecks++; return certifiedSeparator([...a, ...c, ...zero, ...zero, radius, ...n]); };
  for (const n of [a, c]) if (check(n)) return true;
  const d = c.map((n, i) => n - a[i]), dd = dot(d, d), ad = dot(a, d);
  if (dd > 0n && check(a.map((n, i) => n * dd - d[i] * ad))) return true;
  return false;
}
