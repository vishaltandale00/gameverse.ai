import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NeighborhoodController } from '../src/neighborhood-controller.js';
import { SPAWN, PLAYER_RADIUS, CREATOR_KIOSK, CREATOR_LOT, creatorVenues, nearestEntrance } from '../src/neighborhood-math.js';

// Same construction as neighborhood-reachability.test.js: the real scene and
// collision map with only GPU baking and canvas drawing replaced.
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
  const pad = { id: 'creator-lot-controller', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  for (const [key, value] of Object.entries({ window, document, navigator: { getGamepads: () => [pad] } })) {
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  t.after(() => { for (const [key, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  } });
  return pad;
}

function walkTo(controller, pad, target, tolerance = .4, limit = 1500) {
  pad.buttons[4] = { pressed: true, value: 1 };
  for (let frame = 0; frame < limit; frame++) {
    const dx = target.x - controller.position.x, dz = target.z - controller.position.z, distance = Math.hypot(dx, dz);
    if (distance < tolerance) return true;
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

test('the kiosk and made-game venues are reachable from spawn through Alder Street', t => {
  const pad = environment(t), world = createNeighborhoodWorld(null);
  t.after(() => world.dispose());
  const base = world.colliders;
  const venues = creatorVenues(Array.from({ length: 10 }, (_, i) => ({ id: `gen-made-${i}`, name: `Made ${i}`, version: 1 })));
  assert.deepEqual(world.setCreatorVenues(venues), { venues: 10, colliders: 10 });
  assert.ok(Object.isFrozen(world.colliders) && world.colliders !== base, 'venue colliders replace, never mutate, the frozen proxy list');
  assert.deepEqual(world.colliders.slice(0, base.length), [...base]);
  const extra = [CREATOR_KIOSK, ...venues];
  for (const [target, route] of [
    [CREATOR_KIOSK, [{ x: -48, z: 5 }, { x: 60, z: 2 }, { x: 88, z: 0 }]],
    [venues[1], [{ x: -48, z: 5 }, { x: 60, z: 2 }, { x: 110, z: 0 }]],
    // Outer aisle: between the main-aisle buildings, then behind them.
    [venues[9], [{ x: -48, z: 5 }, { x: 60, z: 2 }, { x: 109, z: 0 }, { x: 109, z: -23.5 }, { x: 109, z: -37.5 }]],
  ]) {
    let activated = null;
    const controller = controllerFor(world, pad, () => {
      const entrance = nearestEntrance(controller.position, ['firered', 'soccer', 'football'], extra);
      if (entrance.distance <= entrance.radius) activated = entrance.gameId;
    });
    try {
      for (const waypoint of [...route, target]) assert.ok(walkTo(controller, pad, waypoint), `${target.gameId} route blocked at ${JSON.stringify(controller.position)}`);
      for (const box of world.colliders) {
        const dx = controller.position.x - Math.max(box.minX, Math.min(box.maxX, controller.position.x));
        const dz = controller.position.z - Math.max(box.minZ, Math.min(box.maxZ, controller.position.z));
        assert.ok(Math.hypot(dx, dz) >= PLAYER_RADIUS, 'arrival must not bypass a solid collider');
      }
      pad.axes = [0, 0, 0, 0]; pad.buttons[0] = { pressed: true, value: 1 };
      controller.update(1 / 30);
      assert.equal(activated, target.gameId);
    } finally { controller.dispose(); }
  }
});

test('outside the street opening the east edge and the lot stay closed', t => {
  const pad = environment(t), world = createNeighborhoodWorld(null);
  t.after(() => world.dispose());
  world.setCreatorVenues([]);
  const controller = controllerFor(world, pad, () => {});
  try {
    for (const waypoint of [{ x: -48, z: 5 }, { x: 80, z: 5 }, { x: 80, z: 14 }]) assert.ok(walkTo(controller, pad, waypoint));
    assert.equal(walkTo(controller, pad, { x: 100, z: 14 }, .4, 240), false, 'the old east hedge still bounds Market Quarter');
    assert.ok(controller.position.x < 82.2);
    assert.ok(walkTo(controller, pad, { x: 80, z: 2 }) && walkTo(controller, pad, { x: 130, z: 0 }));
    assert.equal(walkTo(controller, pad, { x: 130, z: 55 }, .4, 240), false, 'the lot hedge closes the south side');
    assert.ok(controller.position.z < CREATOR_LOT.maxZ - 0.5);
  } finally { controller.dispose(); }
});
