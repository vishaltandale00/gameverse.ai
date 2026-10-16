import test from 'node:test';
import assert from 'node:assert/strict';
import { NeighborhoodController } from '../src/neighborhood-controller.js';

function fixture(t, initialPad) {
  const original = Object.fromEntries(['window', 'document', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const window = new EventTarget(), document = new EventTarget();
  document.pointerLockElement = null; document.hidden = false;
  const pads = initialPad ? [initialPad] : [];
  for (const [key, value] of Object.entries({ window, document, navigator: { getGamepads: () => pads } })) {
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  const position = () => ({ x: 0, y: 0, z: 0, set(x, y, z) { Object.assign(this, { x, y, z }); } });
  const canvas = Object.assign(new EventTarget(), { focus() {} });
  const camera = { position: position(), lookAt() {} };
  const world = { colliders: [], heightAt: () => 0, avatar: { root: { position: position(), rotation: {} }, animate() {} } };
  const calls = { pause: 0, interact: 0 };
  const controller = new NeighborhoodController(canvas, camera, world, () => calls.pause++, { x: 0, z: 0, yaw: 0, pitch: 0.24 }, () => calls.interact++);
  t.after(() => {
    controller.dispose();
    for (const [key, descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  return { controller, pads, calls, world, window };
}

function pad(index = 0) {
  return { id: `Xbox-${index}`, index, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
}
function press(pad, index, pressed = true) { pad.buttons[index] = { pressed, value: Number(pressed) }; }

test('standard Xbox input moves the actual world controller, orbits camera, and interacts once per press', t => {
  const xbox = pad(), { controller, calls } = fixture(t, xbox);
  controller.update(1 / 60); // Neutral before gameplay input is accepted.
  xbox.axes = [0, -1, 0.7, 0];
  for (let frame = 0; frame < 30; frame++) controller.update(1 / 60);
  assert.ok(Math.hypot(controller.position.x, controller.position.z) > 0.5, 'Xbox left stick should move the player');
  assert.ok(controller.yaw < -0.1, 'Xbox right stick should orbit the camera');
  press(xbox, 0); controller.update(1 / 60); controller.update(1 / 60);
  assert.equal(calls.interact, 1, 'held A must produce only one interaction');
  press(xbox, 0, false); controller.update(1 / 60); press(xbox, 0); controller.update(1 / 60);
  assert.equal(calls.interact, 2);
});

test('connect and resume require neutral buttons and both sticks before activation', t => {
  const xbox = pad(); press(xbox, 0);
  const { controller, calls } = fixture(t, xbox);
  controller.update(1 / 60);
  assert.equal(calls.interact, 0);
  assert.equal(controller.observe().gamepad.armed, false);
  press(xbox, 0, false); xbox.axes[2] = 1;
  controller.update(1 / 60);
  assert.equal(controller.yaw, 0, 'held right stick must not move camera before neutral');
  xbox.axes[2] = 0; controller.update(1 / 60);
  assert.equal(controller.observe().gamepad.armed, true);
  press(xbox, 0); controller.update(1 / 60);
  assert.equal(calls.interact, 1);
  controller.setPaused(true); controller.update(1 / 60); controller.setPaused(false);
  controller.update(1 / 60);
  assert.equal(calls.interact, 1, 'held A cannot carry across a menu/subgame');
  press(xbox, 0, false); press(xbox, 4); xbox.axes[1] = -1;
  controller.update(1 / 60);
  assert.equal(controller.speed, 0, 'LB and left stick must also return to neutral');
  press(xbox, 4, false); xbox.axes[1] = 0; controller.update(1 / 60);
  press(xbox, 0); controller.update(1 / 60);
  assert.equal(calls.interact, 2);
});

test('Start pauses once, clears motion, and requires release after resume', t => {
  const xbox = pad(), { controller, calls } = fixture(t, xbox);
  xbox.axes[1] = -1; controller.update(0.1);
  assert.ok(controller.speed > 0);
  press(xbox, 9); controller.update(1 / 60);
  assert.equal(calls.pause, 1); assert.equal(controller.paused, true); assert.equal(controller.speed, 0);
  controller.setPaused(false); controller.update(1 / 60);
  assert.equal(calls.pause, 1); assert.equal(controller.speed, 0);
  xbox.axes[1] = 0; press(xbox, 9, false); controller.update(1 / 60);
  press(xbox, 9); controller.update(1 / 60);
  assert.equal(calls.pause, 2);
});

test('polling disconnect and switching device pause and clear input', t => {
  const xbox = pad(), { controller, pads, calls } = fixture(t, xbox);
  xbox.axes[1] = -1; controller.update(0.1);
  pads[0] = null; controller.update(1 / 60);
  assert.equal(calls.pause, 1); assert.equal(controller.paused, true); assert.equal(controller.speed, 0);
  assert.equal(controller.observe().gamepad.connected, false);
  const replacement = pad(1); press(replacement, 0); pads[1] = replacement;
  controller.setPaused(false); controller.update(1 / 60);
  assert.equal(calls.interact, 0);
  press(replacement, 0, false); controller.update(1 / 60);
  press(replacement, 0); controller.update(1 / 60);
  assert.equal(calls.interact, 1);
  pads[1] = pad(2); controller.update(1 / 60);
  assert.equal(calls.pause, 2, 'loss of active device pauses even if another is connected');
});

test('disconnect events and focus loss immediately pause without waiting for another frame', t => {
  const xbox = pad(), { controller, window, calls } = fixture(t, xbox);
  xbox.axes[1] = -1; controller.update(0.1);
  window.dispatchEvent(Object.assign(new Event('gamepaddisconnected'), { gamepad: xbox }));
  assert.equal(calls.pause, 1); assert.equal(controller.speed, 0);
  assert.equal(controller.observe().gamepad.connected, false);
  controller.setPaused(false); window.dispatchEvent(new Event('blur'));
  assert.equal(calls.pause, 2); assert.equal(controller.paused, true);
});

test('deadzone, analog speed, diagonal bounds, D-pad, and sprint reach real movement', t => {
  const xbox = pad(), { controller } = fixture(t, xbox);
  xbox.axes = [0.1, -0.1, 0.1, -0.1]; controller.update(0.1);
  assert.equal(controller.speed, 0); assert.equal(controller.yaw, 0);
  const settle = () => { for (let i = 0; i < 60; i++) controller.update(1 / 60); return controller.speed; };
  xbox.axes = [0, -0.5, 0, 0]; const analog = settle();
  xbox.axes[1] = -1; const full = settle();
  assert.ok(analog > 0 && analog < full * 0.5, 'stick magnitude must survive movement normalization');
  xbox.axes[0] = 1; const diagonal = settle();
  assert.ok(diagonal <= full + 0.001, 'diagonal must not boost speed');
  xbox.axes = [0, 0, 0, 0]; press(xbox, 12); const dpad = settle();
  assert.ok(Math.abs(dpad - full) < 0.001);
  press(xbox, 4); const sprint = settle();
  assert.ok(sprint > full * 2);
});

test('right-stick orbit scales with elapsed seconds, not frame count', t => {
  const xbox = pad(), { controller } = fixture(t, xbox);
  xbox.axes[2] = 0.5; xbox.axes[3] = 0.3;
  for (let i = 0; i < 30; i++) controller.update(1 / 30);
  const first = controller.pose(); controller.yaw = 0; controller.pitch = 0.24;
  for (let i = 0; i < 120; i++) controller.update(1 / 120);
  assert.ok(Math.abs(controller.yaw - first.yaw) < 1e-10);
  assert.ok(Math.abs(controller.pitch - first.pitch) < 1e-10);
});

test('gamepad movement still collides and keyboard still works without a gamepad', t => {
  const { controller, pads, world, window } = fixture(t);
  window.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyD' }));
  controller.update(0.1); assert.ok(controller.position.x > 0);
  controller.clear(); controller.position = { x: 0, z: 0 };
  const xbox = pad(); pads[0] = xbox; controller.update(1 / 60);
  world.colliders.push({ minX: -5, maxX: 5, minZ: -1.1, maxZ: -1, minY: 0, maxY: 5 });
  xbox.axes[1] = -1; press(xbox, 4);
  for (let i = 0; i < 120; i++) controller.update(1 / 60);
  assert.ok(controller.position.z >= -0.680001, 'left stick must respect the same collision as WASD');
  const observed = controller.observe(); observed.gamepad.move.y = 999; observed.gamepad.buttons[4] = false;
  assert.equal(controller.observe().gamepad.move.y, -1); assert.equal(controller.observe().gamepad.buttons[4], true);
});
