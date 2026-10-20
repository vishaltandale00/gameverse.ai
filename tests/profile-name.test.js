import test from 'node:test';
import assert from 'node:assert/strict';
import { createProfileNameEntry } from '../src/profile-name.js';

function fixture() {
  let focused, transitions = 0;
  class Element extends EventTarget {
    constructor() { super(); this.value = ''; this.children = []; this.hidden = false; this.open = true; this.textContent = ''; }
    append(child) { this.children.push(child); }
    focus() { focused = this; }
    setAttribute() {}
    setCustomValidity(message) { this.validationMessage = message; }
    reportValidity() { return !this.validationMessage; }
    click() { this.onclick?.(); }
  }
  class Voice {
    constructor(options) { Object.assign(this, options); this.active = false; this.state = 'idle'; this.pad = { reset() {} }; }
    async configure() { return {}; }
    cancel() { this.active = false; this.changed({ state: 'idle' }); }
    toggle() { this.active = true; this.changed({ state: 'recording' }); }
  }
  const elements = new Map(), root = { createElement: () => new Element(), querySelector: id => {
    if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id);
  } };
  const entry = createProfileNameEntry({ root, Voice, canStart: () => true, onTransition: () => transitions++ });
  entry.reset();
  return { entry, $: root.querySelector, focus: () => focused, transitions: () => transitions };
}

test('voice only fills a draft; exact name and companion require a second submit', () => {
  const f = fixture(); f.entry.voice.changed({ state: 'received', text: '  Vishal  ' });
  assert.equal(f.$('#character-name').value, 'Vishal');
  assert.equal(f.entry.confirm('🦊'), null);
  assert.equal(f.$('#profile-review-name').textContent, 'Vishal');
  assert.equal(f.$('#profile-edit').hidden, true);
  assert.equal(f.focus(), f.$('#profile-confirm'));
  assert.equal(f.entry.confirm('🦊'), 'Vishal');
});

test('B from review returns to editing; changed name or companion requires review again', () => {
  const f = fixture(); f.$('#character-name').value = 'Vishal'; f.entry.confirm('🦊');
  assert.equal(f.entry.back(), true); assert.equal(f.$('#profile-edit').hidden, false);
  f.$('#character-name').value = 'Vish'; f.$('#character-name').dispatchEvent(new Event('input'));
  assert.equal(f.entry.confirm('🦊'), null);
  assert.equal(f.entry.confirm('🐸'), null);
  assert.equal(f.entry.confirm('🐸'), 'Vish');
});

test('controller letters, case, spacing and deletion work after voice permission failure', () => {
  const f = fixture(); f.entry.voice.changed({ state: 'error', message: 'Microphone permission denied.' });
  assert.match(f.$('#name-status').textContent, /controller keyboard/);
  const key = name => f.$('#letters').children.find(button => button.textContent === name).click();
  key('A'); f.$('#name-case').click(); key('l'); f.$('#name-space').click(); key('b');
  assert.equal(f.$('#character-name').value, 'Al b');
  f.$('#name-backspace').click(); f.$('#name-backspace').click();
  assert.equal(f.$('#character-name').value, 'Al');
  assert.equal(f.entry.confirm('🦊'), null); assert.equal(f.entry.confirm('🦊'), 'Al');
});

test('manual input cancels capture and preserves the previous draft until edited', () => {
  const f = fixture(); f.$('#character-name').value = 'Al'; f.entry.voice.active = true;
  f.entry.voice.changed({ state: 'recording', text: 'Unfinished speech' });
  assert.equal(f.entry.confirm('🦊'), null); assert.equal(f.$('#character-name').value, 'Al');
  f.$('#letters').children[0].click();
  assert.equal(f.entry.voice.active, false); assert.equal(f.$('#character-name').value, 'AlA');
  assert.equal(f.$('#character-name').readOnly, false);
});

test('overlong dictated names are not silently truncated or confirmed; blank names fail too', () => {
  const f = fixture(), longName = 'A'.repeat(25);
  f.entry.voice.changed({ state: 'received', text: longName });
  assert.equal(f.$('#character-name').value, longName); assert.equal(f.entry.confirm('🦊'), null);
  f.$('#letters').children[0].click(); assert.equal(f.$('#character-name').value, longName);
  f.$('#name-backspace').click(); assert.equal(f.entry.confirm('🦊'), null);
  assert.equal(f.entry.confirm('🦊'), 'A'.repeat(24));
  f.entry.back(); f.$('#name-clear').click(); assert.equal(f.entry.confirm('🦊'), null);
});

test('closing the profile dialog releases voice and reopening cannot reuse confirmation', () => {
  const f = fixture(); f.$('#character-name').value = 'Alex'; f.entry.confirm('🦊');
  f.entry.voice.active = true; f.$('#profile-dialog').dispatchEvent(new Event('close'));
  assert.equal(f.entry.voice.active, false);
  f.entry.reset(); f.$('#character-name').value = 'Alex';
  assert.equal(f.entry.confirm('🦊'), null);
});
