// plot.gate, plot.ending, plot.cutscene and the storyboard extensions (act predicate, beat locks).
import test from 'node:test';
import assert from 'node:assert/strict';
import { storyDoc, make, check, codes, act, step, goTo, recorder } from '../v2/primitives/plot/story-testkit.js';
import { solve } from '../v2/verify/solve.js';

const plot = () => ({
  gates: [
    { id: 'g_key', requires: { item: 'key' }, hint: 'Find the key.', locks: ['beat:b_vault', 'exit:village>cave', 'portal:p1'] },
    { id: 'g_story', requires: { flag: 'never' }, hint: 'Ask the elder.' },
  ],
  cutscenes: {
    cs_intro: { steps: [{ camera: { pos: [0, 5], look: [0, 0], sec: 0.5 } }, { say: { character: 'elder', text: 'Hm.', sec: 0.25 } }, { move: { who: 'elder', to: 'forest', sec: 0.25 } }, { wait: 0.25 }, { fx: [{ do: 'set_flag', flag: 'intro_done' }] }] },
    cs_end: { skippable: false, steps: [{ wait: 0.5 }, { fx: [{ do: 'set_flag', flag: 'credits' }] }] },
  },
  endings: [
    { id: 'e_good', title: 'Good', when: { all: [{ flag: 'won' }, { gate: 'g_key' }] }, epilogue: 'Peace.', cutscene: 'cs_end', do: [{ do: 'set_flag', flag: 'epilogue_shown' }] },
    { id: 'e_bad', title: 'Bad', when: { flag: 'lost' }, outcome: 'lost', epilogue: 'Ruin.' },
  ],
  storyboard: { acts: [
    { id: 'a1', beats: [{ id: 'b_start', do: [{ do: 'play_cutscene', cutscene: 'cs_intro' }] }, { id: 'b_vault', when: { flag: 'at_vault' }, do: [{ do: 'set_flag', flag: 'vault_opened' }] }] },
    { id: 'a2', beats: [{ id: 'b_two', when: { act: 'a1', state: 'done' }, do: [{ do: 'set_flag', flag: 'act2' }] }] },
  ] },
});
const doc = () => { const d = storyDoc({ plot: plot(), extraSystems: [{ use: 'plot.cutscene' }, { use: 'plot.ending' }] }); d.systems[5].with = { sequentialActs: true }; return d; };

test('gates: requires, unlock/lock overrides, locks on beats, gate service and events', () => {
  const { rt } = make(doc());
  const log = recorder(rt);
  rt.run([{ do: 'set_flag', flag: 'at_vault' }]); step(rt);
  assert.equal(rt.state.flags.vault_opened, undefined, 'beat locked by g_key');
  const gates = rt.service('gates');
  assert.equal(gates.allows('exit:village>cave'), false);
  assert.equal(log.find(e => e.name === 'gate_blocked:g_key') !== undefined, true);
  assert.equal(log.find(e => e.name === 'gate_blocked').hint, 'Find the key.');
  assert.equal(gates.allows('exit:village>forest'), true, 'unlocked targets pass');
  rt.run([{ do: 'give_item', item: 'key' }]); step(rt);
  assert.equal(rt.state.flags.vault_opened, true);
  assert.ok(log.some(e => e.name === 'gate_opened:g_key'));
  assert.equal(gates.exit('village', 'cave'), true);
  rt.run([{ do: 'lock', gate: 'g_key' }]);
  assert.equal(rt.test({ gate: 'g_key' }), false, 'lock forces shut');
  assert.equal(rt.test({ gate: 'g_key', open: false }), true);
  rt.run([{ do: 'release_gate', gate: 'g_key' }, { do: 'unlock', gate: 'g_story' }]);
  assert.equal(rt.test({ gate: 'g_key' }), true); assert.equal(rt.test({ gate: 'g_story' }), true, 'unlock forces open');
});

test('cutscenes run headless as timed steps; moves snap; skip; act predicate', () => {
  const { rt } = make(doc());
  const log = recorder(rt);
  step(rt);
  assert.equal(rt.service('cutscene').playing(), 'cs_intro');
  assert.ok(log.some(e => e.name === 'camera' && e.cutscene === 'cs_intro'));
  assert.deepEqual(rt.availableOptions().map(o => o.label), ['skip cs_intro']);
  const remaining = rt.service('cutscene').remaining();
  assert.equal(remaining, 30 + 15 + 15 + 15 - 1);
  step(rt, remaining + 1);
  assert.equal(rt.state.flags.intro_done, true);
  assert.equal(rt.entity('elder').zone, 'forest', 'move step snapped its actor to the destination');
  assert.ok(log.some(e => e.name === 'say' && e.text === 'Hm.'));
  assert.ok(log.some(e => e.name === 'cutscene_end:cs_intro'));
  assert.equal(rt.test({ cutscene: 'cs_intro' }), true);
  // skipping runs the remaining effects at once
  const b = make(doc()).rt; step(b); act(b, { skip_cutscene: true });
  assert.equal(b.state.flags.intro_done, true); assert.equal(b.entity('elder').zone, 'forest');
  // sequential acts: act a2 waits for a1's beats (b_vault needs the key)
  assert.equal(b.test({ act: 'a1', state: 'active' }), true);
  b.run([{ do: 'give_item', item: 'key' }, { do: 'set_flag', flag: 'at_vault' }]); step(b, 2);
  assert.equal(b.test({ act: 'a1' }), true); assert.equal(b.state.flags.act2, true);
});

test('endings: first matching ending plays its cutscene, then ends the game with its outcome', () => {
  const { rt } = make(doc());
  const log = recorder(rt);
  step(rt); act(rt, { skip_cutscene: true });
  rt.run([{ do: 'set_flag', flag: 'won' }]); step(rt);
  assert.equal(rt.test({ ending_available: 'e_good' }), false, 'gate still shut');
  rt.run([{ do: 'give_item', item: 'key' }]); step(rt);
  const reached = log.find(e => e.name === 'ending_reached');
  assert.deepEqual([reached.ending, reached.epilogue, reached.outcome], ['e_good', 'Peace.', 'won']);
  assert.equal(rt.state.status, 'playing', 'waits for the ending cutscene');
  assert.deepEqual(rt.availableOptions().map(o => o.label), ['watch cs_end'], 'unskippable cutscene is a timed option');
  assert.equal(rt.availableOptions()[0].steps, 31);
  act(rt, { skip_cutscene: true }); assert.equal(rt.service('cutscene').playing(), 'cs_end', 'not skippable');
  step(rt, 40);
  assert.equal(rt.state.status, 'won'); assert.equal(rt.state.ending, 'e_good'); assert.equal(rt.state.flags.credits, true);
  const b = make(doc()).rt; step(b); b.run([{ do: 'set_flag', flag: 'lost' }]); step(b);
  assert.equal(b.state.status, 'lost'); assert.equal(b.state.ending, 'e_bad');
});

test('the plot solver reaches the endings through cutscene, gate and ending options', () => {
  const d = doc();
  d.plot.dialogue = { elder_talk: { speaker: 'elder', start: 'n1', nodes: { n1: { say: 'Choose.', choices: [{ text: 'Take the key', do: [{ do: 'give_item', item: 'key' }, { do: 'set_flag', flag: 'won' }], end: true }, { text: 'Refuse', do: [{ do: 'set_flag', flag: 'lost' }], end: true }] } } } };
  d.plot.characters[0].dialogue = [{ id: 'elder_talk' }];
  d.plot.cutscenes.cs_intro.steps = d.plot.cutscenes.cs_intro.steps.filter(s => !s.move); // keep the elder in reach
  const r = check(d);
  assert.ok(r.ok, JSON.stringify(r.errors));
  const s = solve(r.doc, ...(() => { const { registry, logic } = make(d); return [registry, logic]; })());
  assert.equal(s.completable, true);
  assert.equal(s.exhaustive, true, 'states dedupe: no frame stamps in plot state');
  assert.deepEqual(Object.keys(s.endings).sort(), ['e_bad', 'e_good']);
  assert.ok(s.endings.e_good.some(l => l.startsWith('choose elder_talk')));
});

test('deterministic replay', () => {
  const play = () => { const { rt } = make(doc()); step(rt, 20); rt.run([{ do: 'give_item', item: 'key' }, { do: 'set_flag', flag: 'won' }]); step(rt, 80); return rt.snapshot(); };
  assert.deepEqual(play(), play());
});

test('preflight rejects bad gates, cutscenes and endings with stable codes', () => {
  const d = doc();
  d.plot.gates.push({ id: 'g_bad', hint: 'x', locks: ['nonsense', 'exit:village', 'exit:village>moon', 'beat:b_ghost', 'portal:anything'] });
  d.plot.cutscenes.cs_bad = { steps: [{ dance: 1 }, { say: { character: 'nobody' } }, { move: { to: 'moon' } }, { wait: -1 }] };
  d.plot.cutscenes.cs_long = { steps: [{ wait: 500 }] };
  d.plot.endings.push({ id: 'e_x', title: 'X', outcome: 'draw', cutscene: 'cs_none' });
  const r = check(d);
  // Single-field rules are the declared shapes' (card.data): a gate without requires is param_missing, an unknown step
  // key param_unknown, an outcome outside the set param_option; the rules across fields keep their own codes.
  for (const c of ['param_missing', 'gate_target_invalid', 'gate_target_unknown', 'ref_unknown', 'param_unknown', 'param_range', 'param_option', 'cutscene_step_invalid', 'cutscene_actor_unknown', 'cutscene_too_long', 'ending_invalid']) assert.ok(codes(r).includes(c), c);
  assert.ok(![...r.errors, ...r.warnings].some(e => /portal:anything/.test(e.message)), 'portal ids are checked only when a primitive defines the kind');
  // plot.endings declares at least one entry (min 1): an empty list is the shape's param_range.
  const e = doc(); e.plot.endings = [];
  assert.ok(codes(check(e)).includes('param_range'));
});
