import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraRelativeInput, moveWithCollision, cameraDistance, smoothCameraDistance, ARCADE_FRONTAGE, PLAYER_RADIUS, WORLD_BOUNDS } from '../src/neighborhood-math.js';
import { SAFETY_GRID, SAFETY_MARGIN } from '../src/neighborhood-safety.js';
const gridTolerance = SAFETY_MARGIN + 2 / SAFETY_GRID;

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

test('a grazing rounded corner stays free and a diagonal impact slides without axis bias', () => {
  const box = { minX: 0, maxX: 2, minZ: 0, maxZ: 2 };
  const grazing = moveWithCollision({ x: -1, z: -0.31 }, 0.8, 0, [box]);
  assert.ok(Math.abs(grazing.x + 0.2) < 1 / SAFETY_GRID, 'empty space outside the rounded corner must remain walkable');
  const a = moveWithCollision({ x: -1, z: -0.1 }, 2, 1, [box]);
  const b = moveWithCollision({ x: -0.1, z: -1 }, 1, 2, [box]);
  assert.ok(Math.abs(a.x - b.z) < 1e-8 && Math.abs(a.z - b.x) < 1e-8, 'swapping axes must produce the same contact response');
  assert.ok(Math.hypot(a.x - Math.max(0, Math.min(2, a.x)), a.z - Math.max(0, Math.min(2, a.z))) >= PLAYER_RADIUS - 1e-7);
});

test('inside corners stop motion and reversing input immediately escapes', () => {
  const walls = [wall, { minX: -10, maxX: 10, minZ: 2, maxZ: 2.1 }];
  const corner = moveWithCollision({ x: 0, z: 0 }, 10, 10, walls);
  assert.ok(Math.abs(corner.x - (2 - PLAYER_RADIUS)) < gridTolerance);
  assert.ok(Math.abs(corner.z - (2 - PLAYER_RADIUS)) < gridTolerance);
  const escaped = moveWithCollision(corner, -1, -1, walls);
  assert.ok(Math.abs(escaped.x - (corner.x - 1)) < 1e-8 && Math.abs(escaped.z - (corner.z - 1)) < 1e-8);
});

test('overlapping planter/trunk proxies and boundary contacts recover without trapping', () => {
  const boxes = [{ minX: 0, maxX: 2, minZ: 0, maxZ: 2 }, { minX: 0.9, maxX: 1.1, minZ: -0.1, maxZ: 2.1 }];
  const recovered = moveWithCollision({ x: 1, z: 1 }, 0, 0, boxes);
  for (const box of boxes) assert.ok(Math.hypot(recovered.x - Math.max(box.minX, Math.min(box.maxX, recovered.x)), recovered.z - Math.max(box.minZ, Math.min(box.maxZ, recovered.z))) >= PLAYER_RADIUS - 1e-7);
  const escaped = moveWithCollision(recovered, -2, -2, boxes);
  assert.ok(Math.hypot(escaped.x - recovered.x, escaped.z - recovered.z) > 1);
});

test('camera sweeps handle oblique walls, thin poles, and an embedded target', () => {
  const target = { x: 0, y: 1.6, z: 0 }, diagonal = { x: Math.SQRT1_2, y: 0, z: Math.SQRT1_2 };
  const pole = { minX: 2, maxX: 2.12, minZ: 2, maxZ: 2.12, minY: 0, maxY: 5 };
  assert.ok(cameraDistance(target, diagonal, 6, [pole]) < 2.5);
  assert.equal(cameraDistance({ x: 2.05, y: 1.6, z: 2.05 }, diagonal, 6, [pole]), 0.12);
  assert.equal(cameraDistance(target, { x: -1, y: 0, z: 0 }, 6, [pole]), 6);
});


test('camera release is monotonic and frame-rate independent while retraction is immediate', () => {
  assert.equal(smoothCameraDistance(6, 0.6, 1 / 60), 0.6);
  let thirty = 0.6, oneTwenty = 0.6;
  for (let i = 0; i < 30; i++) { const next = smoothCameraDistance(thirty, 5.2, 1 / 30); assert.ok(next > thirty && next < 5.2); thirty = next; }
  for (let i = 0; i < 120; i++) oneTwenty = smoothCameraDistance(oneTwenty, 5.2, 1 / 120);
  assert.ok(Math.abs(thirty - oneTwenty) < 1e-10);
  assert.ok(thirty > 5.1);
});


test('arcade frontage keeps the player and camera ahead of projecting door frames', () => {
  const player = moveWithCollision({ x: -43, z: -19.8 }, 1.7, -4, [ARCADE_FRONTAGE]);
  assert.ok(Math.abs(player.z - (ARCADE_FRONTAGE.maxZ + PLAYER_RADIUS)) < gridTolerance);
  const target = { ...player, y: 1.55 }, yaw = -1.8, pitch = 0.24;
  const boom = { x: Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch) };
  const distance = cameraDistance(target, boom, 5.2, [ARCADE_FRONTAGE]);
  assert.ok(target.z + boom.z * distance >= ARCADE_FRONTAGE.maxZ + 0.25, 'camera sphere remains outside the actual frontage');
  assert.equal(cameraDistance(target, { x: 0, y: 0, z: 1 }, 5.2, [ARCADE_FRONTAGE]), 5.2, 'turning back to the street releases the boom');
});

test('overhead awnings retract the camera without blocking the walking pavement', () => {
  const canopy = { minX: -48.275, maxX: -37.725, minZ: -21.865, maxZ: -19.995, minY: 3.07, maxY: 4.44 };
  const player = moveWithCollision({ x: -43, z: -18 }, 0, -1.8, [ARCADE_FRONTAGE]);
  assert.ok(Math.abs(player.z + 19.8) < 1 / SAFETY_GRID);
  const target = { ...player, y: 1.55 }, boom = { x: 0, y: Math.SQRT1_2, z: -Math.SQRT1_2 };
  const distance = cameraDistance(target, boom, 5.2, [ARCADE_FRONTAGE, canopy]);
  assert.ok(distance > 1 && distance < 2, 'camera must stop beneath the marquee');
});

test('sports have distinct reachable pavement venues and nearest-game discovery', async () => {
  const { SPORT_ENTRANCES, nearestEntrance } = await import('../src/neighborhood-math.js');
  for (const venue of SPORT_ENTRANCES) {
    assert.equal(nearestEntrance(venue).gameId, venue.gameId);
    assert.equal(nearestEntrance(venue).distance, 0);
    assert.equal(nearestEntrance(venue, ['firered']).gameId, 'firered');
  }
});
