import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraRelativeInput, moveWithCollision, cameraDistance, PLAYER_RADIUS, WORLD_BOUNDS } from '../src/neighborhood-math.js';

const wall = { minX: 2, maxX: 2.1, minZ: -10, maxZ: 10, minY: 0, maxY: 5 };
test('camera-relative walking keeps diagonal speed bounded and rotates with the view', () => {
  const diagonal = cameraRelativeInput(1, 1, 0);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.z) - 1) < 1e-10);
  const forward = cameraRelativeInput(0, 1, Math.PI / 2);
  assert.ok(Math.abs(forward.x + 1) < 1e-10); assert.ok(Math.abs(forward.z) < 1e-10);
});

test('a long sprint step cannot tunnel through a thin building wall', () => {
  const next = moveWithCollision({ x: 0, z: 0 }, 9, 0, [wall]);
  assert.ok(next.x <= wall.minX - PLAYER_RADIUS + 1e-8);
  assert.equal(next.z, 0);
});

test('walking into a wall slides along it instead of freezing both axes', () => {
  const next = moveWithCollision({ x: 1.5, z: 0 }, 2, 3, [wall]);
  assert.ok(next.x <= wall.minX - PLAYER_RADIUS + 1e-8);
  assert.ok(next.z > 2.9);
});

test('world bounds remain solid and an embedded pose can recover', () => {
  const edge = moveWithCollision({ x: 82, z: 58 }, 5, 5, []);
  assert.ok(edge.x <= WORLD_BOUNDS.maxX - PLAYER_RADIUS);
  assert.ok(edge.z <= WORLD_BOUNDS.maxZ - PLAYER_RADIUS);
  const recovered = moveWithCollision({ x: 2.05, z: 0 }, 0, 0, [wall]);
  assert.ok(recovered.x <= wall.minX - PLAYER_RADIUS || recovered.x >= wall.maxX + PLAYER_RADIUS);
});

test('camera boom retracts before a building and passes above low street props', () => {
  const target = { x: 0, y: 1.6, z: 0 }, direction = { x: 1, y: 0, z: 0 };
  const distance = cameraDistance(target, direction, 6, [wall]);
  assert.ok(distance > 1.6 && distance < 1.75);
  assert.equal(cameraDistance(target, direction, 6, [{ ...wall, maxY: 0.5 }]), 6);
  assert.equal(cameraDistance(target, { x: 0, y: 0, z: 1 }, 6, [wall]), 6);
});
