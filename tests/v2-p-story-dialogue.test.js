import test from 'node:test';
import assert from 'node:assert/strict';
import { storyDoc, make, check, codes, act, step, recorder } from '../v2/primitives/plot/story-testkit.js';

const dialogue = {
  talk: { speaker: 'elder', start: 'n1', nodes: {
    n1: { say: 'Welcome, traveller.', do: [{ do: 'set_flag', flag: 'welcomed' }], next: 'n2' },
    n2: { say: 'What brings you?', choices: [
      { text: 'Work.', next: 'work', once: true },
      { text: 'I have the key.', if: { item: 'key' }, next: 'key' },
      { text: 'Persuade me.', check: { stat: 'charm', gte: 5, fail: 'nope', failDo: [{ do: 'set_flag', flag: 'rebuffed' }] }, next: 'yes', do: [{ do: 'set_flag', flag: 'charmed' }] },
      { text: 'Bye.', end: true },
    ] },
    work: { say: 'Gather herbs.', do: [{ do: 'give_item', item: 'herb' }], next: 'n2' },
    key: { say: 'Open the door then.', if: { flag: 'door_known' }, else: 'what', end: true },
    what: { say: 'What door?', end: true },
    yes: { say: 'Fine.', end: true },
    nope: { say: 'No.', end: true },
  } },
  chain: { speaker: 'ranger', start: 'a', nodes: { a: { say: 'Second conversation.', once: true, do: [{ do: 'give_item', item: 'gem' }], end: true } } },
};
const doc = (w = {}) => { const d = storyDoc({ plot: { dialogue: structuredClone(dialogue) } }); d.systems[2].with = { lineSpeed: 0, ...w }; return d; };

test('lines, choices, once, conditions, else and effects through choose', () => {
  const { rt } = make(doc());
  const log = recorder(rt);
  rt.run([{ do: 'start_dialogue', dialogue: 'talk', with: 'elder' }]);
  assert.equal(rt.state.flags.welcomed, true);
  const line = log.find(e => e.name === 'dialogue_line');
  assert.deepEqual([line.dialogue, line.node, line.who, line.text, line.choices], ['talk', 'n1', 'elder', 'Welcome, traveller.', []]);
  assert.deepEqual(rt.availableOptions().map(o => o.actions), [{ choose: 'next' }]);
  act(rt, { choose: 'next' });
  const view = rt.service('dialogue').view();
  assert.deepEqual(view.choices.map(c => c.index), [0, 2, 3], 'the key choice is hidden without the key');
  act(rt, { choose: { index: 0 } });
  assert.equal(rt.test({ item: 'herb' }), true);
  assert.equal(rt.test({ said: 'talk', node: 'work' }), true);
  assert.equal(rt.test({ chose: 'talk', choice: 'work' }), true, 'chose by next node');
  assert.equal(rt.test({ chose: 'talk', choice: 'n2.0' }), true, 'chose by node.index');
  act(rt, { choose: 'next' });
  assert.deepEqual(rt.service('dialogue').view().choices.map(c => c.index), [2, 3], 'once choice gone');
  rt.run([{ do: 'give_item', item: 'key' }]);
  assert.equal(rt.service('dialogue').view().choices.length, 3, 'conditions re-evaluate live');
  act(rt, { choose: { index: 1 } });
  assert.equal(rt.service('dialogue').view().node, 'what', 'failed if jumps to else');
  act(rt, { choose: 'next' });
  assert.equal(rt.service('dialogue').active(), false);
  assert.equal(log.filter(e => e.name === 'dialogue_end').length, 1);
});

test('skill checks: deterministic threshold and seeded dice rolls', () => {
  const { rt } = make(doc());
  rt.run([{ do: 'start_dialogue', dialogue: 'talk' }]); act(rt, { choose: 'next' });
  act(rt, { choose: { index: 2 } });
  assert.equal(rt.state.flags.rebuffed, true); assert.equal(rt.service('dialogue').view().node, 'nope');
  act(rt, { choose: 'next' });
  rt.run([{ do: 'set_var', var: 'stat.charm', value: 5 }, { do: 'start_dialogue', dialogue: 'talk' }]);
  act(rt, { choose: 'next' }); act(rt, { choose: { index: 2 } });
  assert.equal(rt.state.flags.charmed, true); assert.equal(rt.service('dialogue').view().node, 'yes');
  const rolled = structuredClone(dialogue); rolled.talk.nodes.n2.choices[2].check = { stat: 'charm', gte: 7, roll: '2d6' };
  const outcome = seed => { const d = doc(); d.plot.dialogue = rolled; d.seed = seed; const { rt } = make(d); const log = recorder(rt); rt.run([{ do: 'start_dialogue', dialogue: 'talk' }]); act(rt, { choose: 'next' }); act(rt, { choose: { index: 2 } }); return log.find(e => e.name === 'skill_check'); };
  const a = outcome(1), b = outcome(1);
  assert.deepEqual(a, b, 'same seed, same roll');
  assert.ok(a.roll >= 2 && a.roll <= 12 && a.total === a.roll);
  const results = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(s => outcome(s).success));
  assert.equal(results.size, 2, 'dice can pass and fail across seeds');
});

test('queue, end_dialogue, once nodes, line timing and options for the solver', () => {
  const { rt } = make(doc({ lineSpeed: 10, interruptible: false }));
  rt.run([{ do: 'start_dialogue', dialogue: 'talk' }, { do: 'start_dialogue', dialogue: 'chain' }]);
  const opt = rt.availableOptions()[0];
  assert.equal(opt.steps, Math.ceil(19 / 10 * 60) + 1, 'non-interruptible line waits its read time');
  act(rt, { choose: 'next' });
  assert.equal(rt.service('dialogue').view().node, 'n1', 'too early to advance');
  for (let i = 0; i < opt.steps; i++) rt.step(i === opt.steps - 1 ? { actions: { choose: 'next' } } : {});
  assert.equal(rt.service('dialogue').view().node, 'n2');
  rt.run([{ do: 'end_dialogue' }]);
  assert.equal(rt.service('dialogue').view().dialogue, 'chain', 'queued dialogue starts after the first ends');
  assert.equal(rt.test({ item: 'gem' }), true);
  rt.run([{ do: 'end_dialogue' }, { do: 'start_dialogue', dialogue: 'chain' }]);
  assert.equal(rt.service('dialogue').view().node, 'a', 'repeat plays the line');
  assert.equal(rt.test({ item: 'gem', gte: 2 }), false, 'once node effects run once');
  const auto = make(doc({ autoAdvance: true, lineSpeed: 60 })).rt;
  auto.run([{ do: 'start_dialogue', dialogue: 'talk' }]);
  step(auto, 30);
  assert.equal(auto.service('dialogue').view().node, 'n2', 'autoAdvance reads through linear lines');
});

test('repeatSeen:false skips heard linear lines on replay', () => {
  const { rt } = make(doc({ repeatSeen: false }));
  const log = recorder(rt);
  rt.run([{ do: 'start_dialogue', dialogue: 'talk' }]); act(rt, { choose: 'next' }); act(rt, { choose: { index: 3 } });
  rt.run([{ do: 'start_dialogue', dialogue: 'talk' }]);
  assert.equal(rt.service('dialogue').view().node, 'n2', 'jumped past the heard greeting');
  assert.equal(log.filter(e => e.name === 'dialogue_line' && e.node === 'n1').length, 1);
});

test('deterministic replay of a conversation', () => {
  const play = () => { const { rt } = make(doc()); rt.run([{ do: 'start_dialogue', dialogue: 'talk' }]); for (const a of ["next", { index: 0 }, "next", { index: 2 }, "next"]) act(rt, { choose: a }); step(rt, 3); return rt.snapshot(); };
  assert.deepEqual(play(), play());
});

test('preflight rejects broken dialogue with stable codes', () => {
  const d = doc();
  d.plot.dialogue.bad = { speaker: 'nobody', start: 'zz', nodes: { a: { say: 'x', next: 'missing', choices: [{ text: '' , check: { gte: 'x', roll: 'd7' } }] }, b: { who: 'stranger' }, c: { say: 'y', mood: 1 } } };
  d.plot.dialogue.empty = { start: 'a', nodes: {} };
  const r = check(d);
  // Single-field rules are the declared shape's (card.data): an empty choice is param_pattern, a non-numeric gte
  // param_type, an unknown roll param_option, a line without say param_missing, an unknown field param_unknown.
  for (const c of ['speaker_unknown', 'dialogue_node_unknown', 'dialogue_invalid', 'check_invalid', 'param_unknown', 'param_pattern', 'param_type', 'param_option', 'param_missing']) assert.ok(codes(r).includes(c), c);
  const p = doc(); p.systems[2].with = { lineSpeed: 500 };
  assert.deepEqual(codes(check(p)), ['param_range']);
  const e = doc(); e.plot.storyboard.acts[0].beats.push({ id: 'b', do: [{ do: 'start_dialogue', dialogue: 'ghost' }] });
  assert.ok(codes(check(e)).includes('ref_unknown'));
});
