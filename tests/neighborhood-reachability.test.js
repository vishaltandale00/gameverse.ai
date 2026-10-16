import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NeighborhoodController } from '../src/neighborhood-controller.js';
import { SPAWN, SPORT_ENTRANCES, nearestEntrance, PLAYER_RADIUS } from '../src/neighborhood-math.js';

// Construct the actual scene and its collision map. Only GPU environment baking
// and rasterized texture drawing are replaced; geometry/collider authoring and
// the player, gamepad, movement, camera, and exact safety guards are unchanged.
const threeURL = import.meta.resolve('three');
const shimURL = `data:text/javascript,${encodeURIComponent(`export * from '${threeURL}'; export class PMREMGenerator { fromScene(){return {texture:null,dispose(){}};} dispose(){} }`)}`;
const worldSource = (await readFile(new URL('../src/neighborhood-world.js', import.meta.url), 'utf8'))
  .replace("'/runtime/three/three.module.js'", JSON.stringify(shimURL))
  .replace("'./neighborhood-math.js'", JSON.stringify(new URL('../src/neighborhood-math.js', import.meta.url).href));
const { createNeighborhoodWorld } = await import(`data:text/javascript,${encodeURIComponent(worldSource)}`);

function environment(t) {
  const originals = Object.fromEntries(['window', 'document', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const window = new EventTarget(), document = new EventTarget();
  document.pointerLockElement = null;
  document.createElement = () => ({ getContext: () => new Proxy({
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    createRadialGradient: () => ({ addColorStop() {} }),
  }, { get: (object, key) => object[key] ?? (() => {}) }) });
  const pad = { id: 'reachability-controller', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  for (const [key, value] of Object.entries({ window, document, navigator: { getGamepads: () => [pad] } })) {
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  t.after(() => { for (const [key, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  } });
  return pad;
}

function walkTo(controller, pad, target, tolerance = .4, limit = 900) {
  pad.buttons[4] = { pressed: true, value: 1 }; // Existing world LB sprint.
  for (let frame = 0; frame < limit; frame++) {
    const dx = target.x - controller.position.x, dz = target.z - controller.position.z, distance = Math.hypot(dx, dz);
    if (distance < tolerance) return true;
    // Convert a world-space waypoint to the same camera-relative axes a person
    // supplies. Never assign player pose, velocity, camera, or collision state.
    const x = dx / distance, z = dz / distance, yaw = controller.yaw;
    pad.axes[0] = Math.cos(yaw) * x - Math.sin(yaw) * z;
    pad.axes[1] = Math.sin(yaw) * x + Math.cos(yaw) * z;
    controller.update(1 / 30);
  }
  return false;
}

function controllerFor(world, pad, onInteract) {
  pad.axes = [0, 0, 0, 0];
  pad.buttons = pad.buttons.map(() => ({ pressed: false, value: 0 }));
  const canvas = Object.assign(new EventTarget(), { focus() {} });
  const position = { x: 0, y: 0, z: 0, set(x, y, z) { Object.assign(this, { x, y, z }); } };
  return new NeighborhoodController(canvas, { position, lookAt() {} }, world, () => {}, SPAWN, onInteract);
}

test('both sports entrances are reachable from spawn with real world colliders and controller input', t => {
  const pad = environment(t), world = createNeighborhoodWorld(null);
  t.after(() => world.dispose());
  assert.ok(world.colliders.length > 90, 'exercise the populated scene, not an empty collision fixture');
  for (const venue of SPORT_ENTRANCES) {
    let activated = null;
    const controller = controllerFor(world, pad, () => {
      const entrance = nearestEntrance(controller.position);
      if (entrance.distance <= entrance.radius) activated = entrance.gameId;
    });
    try {
      for (const waypoint of [{ x: -48, z: 5 }, { x: 22, z: 5 }, venue]) {
        assert.ok(walkTo(controller, pad, waypoint), `${venue.gameId} route blocked at ${JSON.stringify(controller.position)}`);
      }
      for (const box of world.colliders) {
        const dx = controller.position.x - Math.max(box.minX, Math.min(box.maxX, controller.position.x));
        const dz = controller.position.z - Math.max(box.minZ, Math.min(box.maxZ, controller.position.z));
        assert.ok(Math.hypot(dx, dz) >= PLAYER_RADIUS, 'arrival must not bypass a solid collider');
      }
      pad.axes = [0, 0, 0, 0]; pad.buttons[0] = { pressed: true, value: 1 };
      controller.update(1 / 30);
      assert.equal(activated, venue.gameId, 'A must select the sports entrance reached by walking');
    } finally { controller.dispose(); }
  }
});

test('reachability probe rejects an actually obstructed route', t => {
  const pad = environment(t), world = createNeighborhoodWorld(null);
  t.after(() => world.dispose());
  const blockedWorld = { ...world, colliders: [...world.colliders,
    { minX: -83, maxX: 83, minZ: 7, maxZ: 8, minY: 0, maxY: 4 }] };
  const controller = controllerFor(blockedWorld, pad, () => {});
  try {
    assert.equal(walkTo(controller, pad, { x: -48, z: 5 }, .4, 90), false,
      'the test must fail to reach a waypoint when actual movement is stopped by a wall');
    assert.ok(controller.position.z > 8 + PLAYER_RADIUS);
  } finally { controller.dispose(); }
});
