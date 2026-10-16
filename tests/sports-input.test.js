import test from 'node:test';
import assert from 'node:assert/strict';
import { SportsInput, SPORTS_KEYS } from '../src/sports-input.js';
const keys = (...codes) => new Set(codes);
const pad = (id = 'Xbox', index = 0) => ({ id, index, mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) });
const press = (controller, index, down = true) => { controller.buttons[index] = { pressed: down, value: Number(down) }; };
const setup = game => { const input = new SportsInput(game), controller = pad(); input.sample(keys(), [controller]); return { input, controller }; };

test('entry and resume require neutral buttons and both sticks without inherited actions', () => {
  const input = new SportsInput(), controller = pad(); press(controller, 0); controller.axes = [1, 0, 0, 1];
  let frame = input.sample(keys(), [controller]); assert.equal(frame.armed, false); assert.equal(frame.pressed.confirm, false);
  assert.deepEqual(frame.move, { x: 0, y: 0 }); assert.equal(frame.gesture, null);
  press(controller, 0, false); controller.axes[0] = 0; assert.equal(input.sample(keys(), [controller]).armed, false);
  controller.axes[3] = 0; assert.equal(input.sample(keys(), [controller]).armed, true);
  press(controller, 1); assert.equal(input.sample(keys(), [controller]).pressed.shoot, true);
  input.reset(); frame = input.sample(keys(), [controller]);
  assert.equal(frame.held.shoot, false); assert.equal(frame.released.shoot, false);
  press(controller, 1, false); input.sample(keys(), [controller]); press(controller, 1);
  assert.equal(input.sample(keys(), [controller]).pressed.shoot, true);
});

test('soccer A pass, B shot, X lob and Y through charge independently and release once', () => {
  for (const [button, action] of [[0, 'pass'], [1, 'shoot'], [2, 'lob'], [3, 'through']]) {
    const { input, controller } = setup('soccer'); press(controller, button);
    let frame = input.sample(keys(), [controller]); assert.equal(frame.pressed[action], true); assert.equal(frame.held[action], true);
    frame = input.sample(keys(), [controller]); assert.equal(frame.pressed[action], false); assert.equal(frame.held[action], true);
    press(controller, button, false); assert.equal(input.sample(keys(), [controller]).released[action], true);
    assert.equal(input.sample(keys(), [controller]).released[action], false);
  }
});

test('left stick is the only controller movement and targeting direction; right stick only flicks skills', () => {
  for (const game of ['soccer', 'football']) {
    const { input, controller } = setup(game); controller.axes = [.6, 0, 0, -1];
    let frame = input.sample(keys(), [controller]); assert.ok(frame.move.x > 0 && frame.move.x < 1); assert.deepEqual(frame.aim, frame.move);
    assert.equal(frame.aim.y, 0); assert.deepEqual(frame.gesture, { x: 0, y: -1 }); assert.equal(frame.pressed.skill, true);
    controller.axes = [0, 0, 0, 1]; frame = input.sample(keys(), [controller]);
    assert.deepEqual(frame.aim, { x: 0, y: 0 }); assert.equal(frame.gesture, null, 'must return RS to center');
  }
});

test('standalone RS skill triggers once per centered flick, with a fresh direction and no RB requirement', () => {
  const { input, controller } = setup('soccer'); controller.axes[2] = 1;
  let frame = input.sample(keys(), [controller]); assert.equal(frame.pressed.skill, true); assert.deepEqual(frame.skillDirection, { x: 1, y: 0 });
  frame = input.sample(keys(), [controller]); assert.equal(frame.pressed.skill, false); assert.equal(frame.gesture, null); assert.equal(frame.skillDirection, null);
  controller.axes[2] = .1; input.sample(keys(), [controller]); controller.axes[2] = -1;
  frame = input.sample(keys(), [controller]); assert.deepEqual(frame.gesture, { x: -1, y: 0 }); assert.equal(frame.pressed.skill, true);
  assert.equal(frame.held.skill, false, 'a flick is an event, not a held skill modifier');
});

test('RB is soccer finesse/driven modifier and LB is context-owned switch/run request', () => {
  const { input, controller } = setup('soccer'); press(controller, 5); press(controller, 4);
  let frame = input.sample(keys(), [controller]); assert.equal(frame.held.finesse, true); assert.equal(frame.held.driven, true);
  assert.equal(frame.pressed.skill, false); assert.equal(frame.held.skill, false); assert.equal(frame.pressed.switch, true); assert.equal(frame.pressed.runRequest, true);
  press(controller, 1); frame = input.sample(keys(), [controller]); assert.equal(frame.held.shoot, true); assert.equal(frame.held.tackle, true);
  press(controller, 1, false); press(controller, 2); frame = input.sample(keys(), [controller]); assert.equal(frame.held.lob, true); assert.equal(frame.held.tackle, true);
});

test('LT protect/strafe and RT sprint never charge a shot or pass together', () => {
  for (const game of ['soccer', 'football']) {
    const { input, controller } = setup(game); press(controller, 6); press(controller, 7);
    let frame = input.sample(keys(), [controller]); assert.equal(frame.held.sprint, true);
    assert.equal(frame.held[game === 'soccer' ? 'shield' : 'strafe'], true);
    for (const action of ['pass', 'shoot', 'receiverA', 'receiverB', 'receiverX']) assert.equal(frame.held[action], false);
    press(controller, 6, false); frame = input.sample(keys(), [controller]); assert.equal(frame.held.sprint, true); assert.equal(frame.released.shoot, false); assert.equal(frame.released.pass, false);
  }
});

test('trigger hysteresis avoids sprint chatter without a hidden precision chord', () => {
  const { input, controller } = setup('football');
  const amount = value => { controller.buttons[7] = { value, pressed: value > .5 }; };
  amount(.31); assert.equal(input.sample(keys(), [controller]).pressed.sprint, true);
  for (const value of [.28, .24, .19, .27]) { amount(value); const frame = input.sample(keys(), [controller]); assert.equal(frame.held.sprint, true); assert.equal(frame.released.sprint, false); }
  amount(.17); assert.equal(input.sample(keys(), [controller]).released.sprint, true);
});

test('football receiver A/B/X expose hold and release alongside possession-specific aliases', () => {
  for (const [button, receiver, alias] of [[0, 'receiverA', 'stiffArm'], [1, 'receiverB', 'spin'], [2, 'receiverX', 'tackle']]) {
    const { input, controller } = setup('football'); press(controller, button);
    let frame = input.sample(keys(), [controller]); assert.equal(frame.pressed[receiver], true); assert.equal(frame.pressed[alias], true);
    if (button === 0) { assert.equal(frame.held.pass, true); assert.equal(frame.held.conservativeTackle, true); }
    if (button === 1) assert.equal(frame.pressed.switch, true);
    if (button === 2) assert.equal(frame.held.shoot, true);
    frame = input.sample(keys(), [controller]); assert.equal(frame.held[receiver], true); assert.equal(frame.pressed[receiver], false);
    press(controller, button, false); assert.equal(input.sample(keys(), [controller]).released[receiver], true);
  }
});

test('football RB protects, LT strafes and RS juke does not require RB', () => {
  const { input, controller } = setup('football'); press(controller, 5); press(controller, 6); controller.axes[2] = -1;
  const frame = input.sample(keys(), [controller]); assert.equal(frame.held.shield, true); assert.equal(frame.held.strafe, true);
  assert.equal(frame.held.finesse, false); assert.equal(frame.pressed.skill, true); assert.deepEqual(frame.skillDirection, { x: -1, y: 0 });
});

test('voice-owned B is suppressed until release and cancels rather than releases a charged B action', () => {
  for (const game of ['soccer', 'football']) {
    const { input, controller } = setup(game), action = game === 'soccer' ? 'shoot' : 'receiverB';
    press(controller, 1); assert.equal(input.sample(keys(), [controller]).held[action], true);
    let frame = input.sample(keys(), [controller], true); assert.equal(frame.held[action], false); assert.equal(frame.released[action], false); assert.equal(frame.cancelled[action], true);
    frame = input.sample(keys(), [controller], false); assert.equal(frame.pressed[action], false); assert.equal(frame.released[action], false);
    press(controller, 1, false); input.sample(keys(), [controller]); press(controller, 1);
    assert.equal(input.sample(keys(), [controller]).pressed[action], true);
  }
});

test('voice B mask leaves keyboard tackle and non-B controller actions available', () => {
  const { input, controller } = setup('soccer'); press(controller, 1); press(controller, 0); controller.axes[0] = 1;
  const frame = input.sample(keys('KeyL'), [controller], true);
  assert.equal(frame.held.shoot, false); assert.equal(frame.held.pass, true); assert.equal(frame.pressed.tackle, true); assert.equal(frame.aim.x, 1);
});

test('B released on the same sample as voice capture cancels the charged action', () => {
  for (const game of ['soccer', 'football']) {
    const { input, controller } = setup(game), action = game === 'soccer' ? 'shoot' : 'receiverB';
    press(controller, 1); input.sample(keys(), [controller]); press(controller, 1, false);
    const frame = input.sample(keys(), [controller], true);
    assert.equal(frame.cancelled[action], true); assert.equal(frame.released[action], false);
  }
});

test('Start Guide and R3 remain reserved while Y is a soccer through ball', () => {
  const { input, controller } = setup('soccer'); for (const button of [9, 11, 16]) press(controller, button);
  assert.ok(Object.values(input.sample(keys(), [controller]).held).every(value => !value));
  press(controller, 3); assert.equal(input.sample(keys(), [controller]).pressed.through, true);
});

test('D-pad and arrow play selection cannot change movement or kick aim', () => {
  const { input, controller } = setup('football'); press(controller, 15);
  let frame = input.sample(keys(), [controller]); assert.equal(frame.pressed.right, true); assert.deepEqual(frame.aim, { x: 0, y: 0 });
  assert.equal(input.sample(keys(), [controller]).pressed.right, false);
  press(controller, 15, false); frame = input.sample(keys('ArrowLeft'), [controller]);
  assert.equal(frame.pressed.left, true); assert.deepEqual(frame.move, { x: 0, y: 0 }); assert.deepEqual(frame.aim, { x: 0, y: 0 }); assert.equal(frame.gesture, null);
});

test('WASD supplies movement and aim, E plus arrows supplies skills, and keyboard actions follow familiar aliases', () => {
  const input = new SportsInput('soccer'); input.sample(keys(), []);
  let frame = input.sample(keys('KeyD', 'KeyS', 'KeyE', 'ArrowUp', 'KeyF', 'KeyU', 'KeyI'), []);
  assert.ok(Math.abs(Math.hypot(frame.move.x, frame.move.y) - 1) < 1e-12); assert.deepEqual(frame.aim, frame.move);
  assert.deepEqual(frame.gesture, { x: 0, y: -1 }); assert.equal(frame.held.finesse, true); assert.equal(frame.held.through, true); assert.equal(frame.held.lob, true);
  assert.equal(input.sample(keys('KeyE', 'ArrowUp'), []).gesture, null);
  const football = new SportsInput('football'); football.sample(keys(), []);
  frame = football.sample(keys('KeyJ', 'KeyU', 'KeyK', 'KeyQ', 'KeyC', 'KeyV', 'ShiftLeft'), []);
  for (const action of ['receiverA', 'receiverB', 'receiverX', 'switch', 'shield', 'strafe', 'sprint']) assert.equal(frame.held[action], true);
  for (const code of ['KeyU', 'KeyI', 'KeyF', 'KeyV']) assert.equal(SPORTS_KEYS.has(code), true);
});

test('disconnect/replacement never releases receiver holds and new device must neutralize', () => {
  const { input, controller } = setup('football'); press(controller, 1); input.sample(keys(), [controller]);
  const replacement = pad('DualSense', 1); press(replacement, 1);
  let frame = input.sample(keys(), [replacement]); assert.equal(frame.disconnected, true); assert.equal(frame.armed, false); assert.equal(frame.released.receiverB, false); assert.equal(frame.pressed.receiverB, false);
  press(replacement, 1, false); input.sample(keys(), [replacement]); press(replacement, 1);
  assert.equal(input.sample(keys(), [replacement]).pressed.receiverB, true);
});

test('keyboard ownership reset requires neutral and drops previously held charges and skills', () => {
  const input = new SportsInput('soccer'); assert.equal(input.sample(keys('KeyK'), []).held.shoot, false);
  input.sample(keys(), []); assert.equal(input.sample(keys('KeyK'), []).pressed.shoot, true);
  assert.equal(input.sample(keys(), []).released.shoot, true);
  input.reset(); const frame = input.sample(keys('KeyJ', 'KeyE', 'ArrowUp', 'KeyW'), []);
  assert.equal(frame.held.pass, false); assert.equal(frame.pressed.skill, false); assert.equal(frame.gesture, null); assert.deepEqual(frame.move, { x: 0, y: 0 });
});
