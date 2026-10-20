import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeGrid, SAFETY_GRID } from '../src/neighborhood-safety.js';
import { certifiedSportsMove, certifiedSportsFlight, certifiedSportsCollision, certifiedSportsFloor, certifiedSportsPair } from '../src/sports-certified.generated.js';
import { certifySportsMove, certifySportsCollision, certifySportsPairCollision, stepSportsBall, certifySportsSeparation, sportsPhysicsObservations } from '../src/sports-physics.js';

const v = (x, y = 0, z = 0) => ({ x, y, z });
const grid = p => [encodeGrid(p.x), encodeGrid(p.y), encodeGrid(p.z)];
const energy = p => grid(p).reduce((sum, x) => sum + x * x, 0n);
const ball = extra => ({ x: 0, y: 10, z: 0, vx: 12, vy: 5, vz: -3, ...extra });

test('runtime movement rejects a teleport and bounds diagonal displacement in exact grid units', () => {
  const before = v(4, 0, -2), result = certifySportsMove(before, v(100, 0, 100), 9.5 / 60);
  assert.ok(certifiedSportsMove([...grid(before), ...grid(result), encodeGrid(9.5 / 60, 'floor')]));
  assert.ok(Math.hypot(result.x - before.x, result.z - before.z) > .15, 'clamp should preserve useful speed');
  assert.deepEqual(certifySportsMove(before, v(99, 0, 99), 0), before);
  assert.equal(certifiedSportsMove([0n,0n,0n, 4n,4n,0n, 5n]), false, 'per-axis speed checks would miss this excessive diagonal');
});

test('actual free-flight bridge obeys checked gravity and semi-implicit equations including negative velocities', () => {
  const before = ball(), next = stepSportsBall(before);
  const args = [...grid(before), ...grid(v(before.vx,before.vy,before.vz)), ...grid(next), ...grid(v(next.vx,next.vy,next.vz)), encodeGrid(9.81), 60n];
  assert.equal(certifiedSportsFlight(args), true);
  assert.ok(next.vy < before.vy); assert.ok(next.y > before.y); assert.ok(next.z < before.z);
  args[9] += 1n;
  assert.equal(certifiedSportsFlight(args), false, 'unmodeled horizontal acceleration is rejected');
  args[9] -= 1n; args[7] += 2n;
  assert.equal(certifiedSportsFlight(args), false, 'position error beyond quantization allowance is rejected');
  assert.throws(() => stepSportsBall(before, 1 / 30), /60 Hz/);
});

test('floor restitution and rolling friction dissipate energy and point away from the floor', () => {
  const before = ball({ y: .32, vy: -8 }), next = stepSportsBall(before, 1 / 60, { restitution: .6, friction: .8 });
  const incoming = v(before.vx, Number(encodeGrid(before.vy) - encodeGrid(9.81) / 60n) / SAFETY_GRID, before.vz);
  const outgoing = v(next.vx, next.vy, next.vz);
  assert.equal(certifiedSportsFloor([...grid(incoming), ...grid(outgoing)]), true);
  assert.ok(next.y >= .32); assert.ok(next.vy > 0); assert.ok(energy(outgoing) < energy(incoming));
  const rolling = stepSportsBall(ball({ y: .32, vy: 0 }), 1 / 60, { restitution: .6, friction: .8 });
  assert.equal(rolling.vy, 0); assert.ok(rolling.vx < before.vx);
  assert.equal(certifiedSportsFloor([1n,-2n,0n, 1n,-1n,0n]), false, 'downward floor response is rejected');
  assert.throws(() => stepSportsBall(before, 1/60, { restitution: 1.01 }), /coefficients/);
});

test('wall-response guard permits reflection and rejects an energy-creating response', () => {
  const incoming = v(12, 2, -4);
  const reflected = certifySportsCollision(incoming, v(-10, 1, -3));
  assert.ok(certifiedSportsCollision([...grid(incoming), ...grid(reflected)]));
  assert.equal(reflected.x, -10);
  assert.deepEqual(certifySportsCollision(incoming, v(99, 2, -4)), v(0));
});

test('equal-mass contact transfers momentum to a stationary athlete without creating pair energy', () => {
  const a = v(8), b = v(0), response = certifySportsPairCollision(a, b, v(2), v(6));
  assert.deepEqual(response, { a: v(2), b: v(6) });
  assert.equal(certifiedSportsPair([...grid(a), ...grid(b), ...grid(response.a), ...grid(response.b)]), true);
  assert.equal(response.a.x + response.b.x, 8); assert.ok(energy(response.a)+energy(response.b) < energy(a)+energy(b));
  const rejected = certifySportsPairCollision(a,b,v(-8),v(16));
  assert.deepEqual(rejected, { a,b });
  const corrected = certifySportsPairCollision(a,b,v(2.123456),v(5.876543));
  assert.equal(encodeGrid(corrected.a.x)+encodeGrid(corrected.b.x), encodeGrid(8));
});

test('relative sweep certificate rejects crossing athletes even when both endpoint pairs are separated', () => {
  assert.equal(certifySportsSeparation(v(-5),v(5),v(5),v(-5),1), false);
  assert.equal(certifySportsSeparation(v(-5,0,2),v(5,0,2),v(5),v(-5),1), true);
  assert.equal(certifySportsSeparation(v(-5,0,.5),v(5,0,.5),v(0),v(0),1), false);
  assert.equal(certifySportsSeparation(v(-5,0,1),v(5,0,1),v(0),v(0),1), true, 'tangency is outside the open contact sphere');
});

test('bridge rejects nonfinite inputs and preserves caller-owned ball metadata', () => {
  assert.throws(() => certifySportsMove(v(0),v(NaN),.1), /finite/);
  assert.throws(() => certifySportsCollision(v(1),v(Infinity)), /finite/);
  assert.throws(() => certifySportsMove(v(0),v(40000),.1), /range/);
  const original = ball({ owner: 4, spin: .8 }), updated = { ...original, ...stepSportsBall(original) };
  assert.equal(updated.owner,4); assert.equal(updated.spin,.8); assert.equal(original.y,10);
  const observations = sportsPhysicsObservations();
  assert.ok(observations.moveChecks > 0); assert.ok(observations.flightChecks > 0); assert.ok(observations.floorChecks > 0); assert.ok(observations.pairChecks > 0);
});
