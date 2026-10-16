import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { padMask } from '../src/identity.js';
import { sampleStandardGamepad } from '../src/gamepad.js';

// Execute the actual host polling function with a small browser boundary fixture.
// This avoids importing the DOM application's startup and storage side effects.
const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const start = source.indexOf('function pollInput(now) {');
const end = source.indexOf('\nrequestAnimationFrame(pollInput);', start);
assert.ok(start >= 0 && end > start);
const pollingSource = source.slice(start, end);

function pad(index = 0) { return { index, id: `test-pad-${index}`, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) }; }
function fixture() {
  const status = { textContent: '' };
  const context = { pads: [pad()], clicks: 0, menuOpens: 0, inputs: [], focused: true, busy: false, dialog: null, resumes: 0, closes: 0,
    neighborhoodOpen: false, padArmed: false, padPrevious: [], keyboard: new Set(), inputMask: -1,
    shellPadDevice: null, shellPadIndex: null, lastPadAction: 0, session: undefined,
    nameEntry: { voice: { poll() {} }, back: () => false }, voice: { poll() {} }, padMask, sampleStandardGamepad, requestAnimationFrame() {}, focusDirection() {},
    $: selector => selector.startsWith('dialog[open]') ? context.dialog : context.elements[selector] || status,
  };
  context.elements = {
    '#resume-button': { hidden: false, disabled: false, click() { context.resumes++; context.session.state = 'playing'; context.dialog = null; } },
    '#world-resume': { disabled: false, click() { context.resumes++; context.dialog = null; } },
  };
  context.document = { hidden: false, hasFocus: () => context.focused, activeElement: { click: () => { context.clicks++; } } };
  context.navigator = { getGamepads: () => context.pads };
  context.clearInput = () => { context.keyboard.clear(); context.inputMask = -1; context.padArmed = false; context.session?.adapter.input(0); };
  context.openMenu = () => { if (context.session?.state === 'playing') { context.menuOpens++; context.session.state = 'paused'; context.dialog = { id: 'session-dialog' }; context.clearInput(); } };
  vm.createContext(context); vm.runInContext(pollingSource, context);
  return context;
}

test('hidden and unfocused host polling cannot rearm and activate menu buttons', () => {
  for (const hidden of [true, false]) {
    const context = fixture(); context.document.hidden = hidden; context.focused = false;
    context.pollInput(200);
    assert.equal(context.padArmed, false);
    context.pads[0].buttons[0].pressed = true;
    context.pollInput(500);
    assert.equal(context.clicks, 0);
    context.document.hidden = false; context.focused = true;
    context.pollInput(800);
    assert.equal(context.clicks, 0, 'held A cannot activate on focus restoration');
    context.pads[0].buttons[0].pressed = false; context.pollInput(900);
    context.pads[0].buttons[0].pressed = true; context.pollInput(1200);
    assert.equal(context.clicks, 1);
  }
});

function press(context, index, down = true) { context.pads[0].buttons[index] = { pressed: down, value: Number(down) }; }
function play(context) { context.session = { state: 'playing', adapter: { input: value => context.inputs.push(value) } }; context.pollInput(100); }

test('Y opens Gameverse pause while Start and Back remain GBA buttons', () => {
  const context = fixture(); play(context);
  press(context, 9); context.pollInput(200);
  assert.equal(context.inputs.at(-1), 8); assert.equal(context.menuOpens, 0);
  press(context, 9, false); press(context, 8); context.pollInput(300);
  assert.equal(context.inputs.at(-1), 4); assert.equal(context.menuOpens, 0);
  press(context, 8, false); press(context, 3); context.pollInput(400);
  assert.equal(context.menuOpens, 1); assert.equal(context.inputs.at(-1), 0);
  context.pollInput(700);
  assert.equal(context.menuOpens, 1); assert.equal(context.clicks, 0); assert.equal(context.resumes, 0);
});

test('B resumes the session dialog only after neutral and does not leak into FireRed', () => {
  const context = fixture(); play(context);
  press(context, 3); context.pollInput(200);
  press(context, 1); context.pollInput(500);
  assert.equal(context.resumes, 0, 'held menu-opening buttons cannot activate the next context');
  press(context, 3, false); press(context, 1, false); context.pollInput(600);
  press(context, 1); context.pollInput(900);
  assert.equal(context.resumes, 1); assert.equal(context.session.state, 'playing');
  context.pollInput(1100); assert.equal(context.inputs.at(-1), 0, 'held B must not reach GBA after resume');
  press(context, 1, false); context.pollInput(1200); press(context, 1); context.pollInput(1400);
  assert.equal(context.inputs.at(-1), 2);
});

test('B and Start resume world menu, and B cancels a character dialog', () => {
  for (const button of [1, 9]) {
    const context = fixture(); context.neighborhoodOpen = true; context.dialog = { id: 'world-menu' };
    context.pollInput(200); press(context, button); context.pollInput(500);
    assert.equal(context.resumes, 1); context.pollInput(800); assert.equal(context.resumes, 1);
  }
  const context = fixture(); context.dialog = { id: 'profile-dialog', close() { context.closes++; context.dialog = null; } };
  context.pollInput(200); press(context, 1); context.pollInput(500); context.pollInput(800);
  assert.equal(context.closes, 1);
});

test('busy saving cannot activate, resume or close a modal, including held input afterward', () => {
  const context = fixture(); play(context); context.openMenu();
  context.pollInput(300); context.busy = true; context.session.state = 'saving';
  press(context, 1); press(context, 0); context.pollInput(600);
  assert.equal(context.resumes, 0); assert.equal(context.clicks, 0);
  context.busy = false; context.session.state = 'paused'; context.pollInput(900);
  assert.equal(context.resumes, 0); assert.equal(context.clicks, 0);
});

test('A and B edges work immediately after navigation while direction repeats stay throttled', () => {
  for (const action of [0, 1]) {
    const context = fixture(); context.dialog = { id: 'session-dialog' };
    context.session = { state: 'paused', adapter: { input: value => context.inputs.push(value) } };
    let directions = 0; context.focusDirection = () => directions++;
    context.pollInput(100);
    press(context, 13); context.pollInput(200); context.pollInput(210);
    assert.equal(directions, 1, 'held direction must still be rate-limited');
    press(context, 13, false); context.pollInput(220);
    press(context, action); context.pollInput(230); context.pollInput(250);
    assert.equal(action === 0 ? context.clicks : context.resumes, 1, 'new button edge must not inherit directional debounce');
  }
});

test('Guide and both triggers retain host-pause fallback and require neutral after resume', () => {
  for (const chord of [[16], [6, 7]]) {
    const context = fixture(); play(context);
    for (const button of chord) press(context, button);
    context.pollInput(300); assert.equal(context.menuOpens, 1);
    context.session.state = 'playing'; context.dialog = null;
    context.pollInput(600); assert.equal(context.menuOpens, 1); assert.equal(context.inputs.at(-1), 0);
  }
});

test('a polled controller disappearance pauses GBA even without a disconnect event', () => {
  const context = fixture();
  context.session = { state: 'playing', adapter: { input: value => context.inputs.push(value) } };
  context.pollInput(100);
  context.pads[0].axes[1] = -1; context.pollInput(200);
  assert.ok(context.inputs.includes(64));
  context.pads = []; context.pollInput(300);
  assert.equal(context.menuOpens, 1); assert.equal(context.session.state, 'paused');
  assert.equal(context.inputs.at(-1), 0); assert.equal(context.padArmed, false);
});

test('shell navigation waits for both sticks and keeps the selected controller', () => {
  const context = fixture(); context.pads[0].axes[2] = 0.7;
  context.pollInput(200); assert.equal(context.padArmed, false);
  context.pads[0].axes[2] = 0; context.pollInput(300); assert.equal(context.padArmed, true);
  const original = context.pads[0]; context.pads = [pad(1), original];
  context.pollInput(400);
  assert.equal(context.shellPadIndex, 0); assert.equal(context.shellPadDevice, '0:test-pad-0');
});

test('name dictation owns cancelling B and review consumes B without closing the character dialog', () => {
  const context = fixture(); context.dialog = { id: 'profile-dialog', close() { context.closes++; } };
  context.nameEntry.voice.poll = () => true;
  context.pollInput(100); press(context, 1); context.pollInput(200);
  assert.equal(context.closes, 0, 'voice cancellation must not close character creation');
  press(context, 1, false); context.pollInput(300); context.nameEntry.voice.poll = () => false;
  let edits = 0; context.nameEntry.back = () => { edits++; return true; };
  press(context, 1); context.pollInput(400);
  assert.equal(edits, 1); assert.equal(context.closes, 0);
});
