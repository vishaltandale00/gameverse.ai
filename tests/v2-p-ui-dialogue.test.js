import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../v2/kernel/testing.js';
import { preflight } from '../v2/kernel/document.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import dialogue, { createDialogueMachine, lineFrom, subtitleSeconds } from '../v2/primitives/graphics/ui-dialogue.js';
import { mount } from './v2-p-ui-dom.js';
import { baseDoc, BASE, gameInstances, ownErrors } from './v2-p-ui-fixtures.js';

// A minimal conversation runner speaking the plot.dialogue contract (events + `choose`).
export const talker = {
  id: 'plot.fixture.dialogue',
  card: { intent: 'Fixture conversation runner.', provides: { events: ['dialogue_line', 'dialogue_start', 'dialogue_end'], actions: ['talk', 'choose'] }, reads: ['plot.dialogue'] },
  install(rt) {
    const st = () => rt.store('fixture.dialogue');
    const emitNode = () => { const s = st(), d = rt.doc.plot.dialogue[s.id], n = d.nodes[s.node]; rt.emit('dialogue_line', { dialogue: s.id, node: s.node, who: n.who, text: n.say, choices: (n.choices || []).map((c, i) => ({ index: i, text: c.text, enabled: !c.locked })) }); };
    rt.action('talk', id => { Object.assign(st(), { id, node: rt.doc.plot.dialogue[id].start }); rt.emit('dialogue_start', { dialogue: id }); emitNode(); });
    rt.action('choose', v => {
      const s = st(); if (!s.id) return;
      const n = rt.doc.plot.dialogue[s.id].nodes[s.node];
      const to = v === 'next' ? n.next : n.choices?.[v.index]?.next;
      (s.log ??= []).push(v === 'next' ? v : v.index);
      if (!to) { rt.emit('dialogue_end', { dialogue: s.id }); s.id = null; return; }
      s.node = to; emitNode();
    });
  },
};
const plot = {
  characters: [{ id: 'mara', name: 'Mara', model: 'mara' }],
  dialogue: { hello: { speaker: 'mara', start: 'n1', nodes: {
    n1: { who: 'mara', say: 'Hello, traveller. Cold night.', next: 'n2' },
    n2: { who: 'mara', say: 'Will you help?', choices: [{ text: 'Yes', next: 'n3' }, { text: 'Locked', locked: true }, { text: 'No' }] },
    n3: { who: 'mara', say: 'Thank you.' } } } },
};
const content = { models: { mara: { kind: 'pixel', size: [16, 22], palette: { r: '#6b2a3a', s: '#d9b99b' }, parts: [{ name: 'body', rect: [3, 2, 10, 13], c: 'r' }, { name: 'head', rect: [5, 15, 6, 6], c: 's' }] } } };
const P = [...BASE, talker, dialogue];
const doc = (w = {}) => baseDoc({ plot, content, systems: [{ use: 'plot.fixture.dialogue' }], graphics: [{ use: 'graphics.ui.dialogue', with: w }] });

test('dialogue machine: typewriter with punctuation pauses, skip, advance and choices', () => {
  const m = createDialogueMachine({ cps: 10 });
  m.show({ key: 'a', who: 'mara', text: 'Hi. Yes', choices: [] });
  assert.equal(m.phase, 'typing');
  assert.equal(m.tick(0.3), 3); assert.equal(m.visible, 'Hi.');
  m.tick(0.2); assert.equal(m.visible, 'Hi.', 'holds after a full stop');
  m.tick(0.5); assert.equal(m.phase, 'waiting'); assert.equal(m.visible, 'Hi. Yes');
  assert.deepEqual(m.confirm(), { kind: 'advance' });
  m.show({ key: 'b', text: 'Pick one', choices: [{ index: 0, text: 'A', enabled: false }, { index: 1, text: 'B' }, { index: 2, text: 'C' }] });
  assert.deepEqual(m.confirm(), { kind: 'skip' }); assert.equal(m.phase, 'choosing');
  assert.equal(m.focus, 1, 'focus starts on the first enabled choice');
  m.move('down'); assert.equal(m.focus, 2); m.move('down'); assert.equal(m.focus, 1, 'wraps and skips disabled');
  assert.equal(m.pick(1), null, 'disabled choices cannot be picked');
  assert.deepEqual(m.pick(3), { kind: 'choose', index: 2 });
  assert.equal(m.show({ key: 'b', text: 'Pick one', choices: [] }), false, 'same key does not restart typing');
  m.end(0.2); m.tick(0.25); assert.equal(m.phase, 'hidden');
  assert.deepEqual(lineFrom({ dialogue: 'd', node: 'n', who: 'x', text: 't', choices: ['a'] }).choices, [{ index: 0, text: 'a' }]);
  assert.ok(subtitleSeconds('one two') >= 2.2 && subtitleSeconds('w '.repeat(100)) <= 7);
});

test('dialogue: plays a conversation end to end through view.act and gates gameplay input', () => {
  const m = mount(doc({ cps: 400 }), { primitives: P });
  m.view.input = () => ({ actions: { jump: true }, axes: { move: [1, 0] } });
  m.frame(1, { actions: { talk: 'hello' } });
  assert.equal(m.text('.gv-dlg-name'), 'Mara');
  assert.ok(m.q('.gv-dlg-portrait svg'), 'portrait painted from the pixel model');
  assert.equal(m.view.modal, 'dialogue');
  assert.deepEqual(m.view.input().actions, {}, 'gameplay input is gated while the box is open');
  m.frame(2);
  assert.ok(m.text('.gv-dlg-text span').length < 29, 'still typing');
  m.frame(40);
  assert.equal(m.text('.gv-dlg-text span'), 'Hello, traveller. Cold night.');
  assert.ok(m.q('.gv-dlg-next').classList.contains('is-on'));
  m.key('Enter'); m.frame(1);
  assert.deepEqual(m.acts.at(-1), { choose: 'next' });
  m.frame(20);
  assert.equal(m.qa('.gv-choice').length, 3);
  assert.ok(m.q('.gv-choice button.is-focus').textContent.includes('Yes'));
  m.key('ArrowDown'); m.frame(1);
  assert.ok(m.q('.gv-choice button.is-focus').textContent.includes('No'), 'skips the locked choice');
  m.key('1'); m.frame(2);
  assert.deepEqual(m.acts.at(-1), { choose: { index: 0 } });
  m.frame(30); assert.equal(m.text('.gv-dlg-text span'), 'Thank you.');
  m.key(' '); m.frame(1); m.frame(30);
  assert.ok(m.q('.gv-dialogue').classList.contains('gv-hide'));
  assert.equal(m.view.modal, null);
  assert.equal(m.view.input().actions.jump, true, 'input flows again after the conversation');
  assert.deepEqual(m.rt.state.prim['fixture.dialogue'].log, ['next', 0, 'next']);
});

test('dialogue: barks and say lines show as subtitles without taking input', () => {
  const m = mount(doc(), { primitives: P });
  m.frame(1, { actions: { emit: { name: 'bark', data: { channel: 'radio', character: 'mara', text: 'Storm coming in.' } } } });
  assert.match(m.text('.gv-subtitles'), /Mara.*Storm coming in/);
  assert.equal(m.q('.gv-sub').getAttribute('data-channel'), 'radio');
  assert.equal(m.view.modal ?? null, null);
});

test('dialogue: replay is deterministic and identical to headless', () => {
  const inputs = [{ actions: { talk: 'hello' } }, {}, { actions: { choose: 'next' } }, { actions: { choose: { index: 2 } } }];
  const a = mount(doc(), { primitives: P });
  for (const i of inputs) a.frame(1, i);
  const { rt } = compile(doc(), { primitives: P });
  for (const i of inputs) rt.step(i);
  assert.deepEqual(a.rt.snapshot(), rt.snapshot());
});

test('dialogue: preflight rejects bad configs and accepts every game instance', () => {
  const codes = w => { try { compile(doc(w), { primitives: P }); return []; } catch (e) { return e.errors.map(x => x.code); } };
  assert.ok(codes({ style: 'baroque' }).includes('param_option'));
  assert.ok(codes({ cps: -3 }).includes('param_range'));
  assert.ok(codes({ portraits: true }).includes('param_unknown'));
  const registry = new Registry(P), logic = buildLogic(registry, Logic);
  const list = gameInstances('graphics.ui.dialogue');
  assert.ok(list.length >= 3);
  for (const { file, doc: d } of list) assert.deepEqual(ownErrors(preflight(d, registry, logic).errors), [], file);
});
