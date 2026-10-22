// plot.relationship, plot.journal, plot.barks, plot.events.random, plot.investigation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { storyDoc, make, check, codes, act, step, goTo, recorder } from '../v2/primitives/plot/story-testkit.js';
import { solve } from '../v2/verify/solve.js';

const plot = () => ({
  factions: [{ id: 'folk', name: 'Folk', rep: 5, ranks: [{ at: 0, title: 'Stranger' }, { at: 20, title: 'Friend' }], hostileBelow: 0 }],
  entries: [{ id: 'e1', title: 'One', text: '.', tag: 'lore' }, { id: 'e2', title: 'Two', text: '.', tag: 'lore' }, { id: 'e3', title: 'Auto', text: '.', tag: 'note', when: { zone: 'cave' } }],
  barks: [
    { channel: 'ambient', when: { zone: 'village' }, say: 'Birds sing.', cooldown: 2 },
    { channel: 'ambient', when: { zone: 'village' }, say: 'Wind.', cooldown: 2 },
    { channel: 'character', character: 'elder', say: 'Welcome!', once: true },
  ],
  randomEvents: [
    { id: 'ev_trader', text: 'A trader.', weight: 3, choices: [{ text: 'Trade', do: [{ do: 'give_item', item: 'gem' }] }, { text: 'Rob', if: { flag: 'evil' }, then: 'ev_guard' }] },
    { id: 'ev_rain', text: 'Rain.', weight: 1, once: true, do: [{ do: 'set_flag', flag: 'wet' }] },
    { id: 'ev_guard', text: 'Guards!', draw: false, do: [{ do: 'add_rep', faction: 'folk', delta: -10 }] },
  ],
  clues: [{ id: 'c_mud', title: 'Muddy boots' }, { id: 'c_note', title: 'A note', when: { item: 'key' } }, { id: 'c_lie', title: 'A lie', tags: ['testimony'] }],
  deductions: [
    { id: 'd_butler', title: 'The butler did it', clues: ['c_mud', 'c_note'], do: [{ do: 'set_flag', flag: 'solved' }], conclusion: 'The butler.' },
    { id: 'd_maid', title: 'The maid did it', clues: ['c_lie'], wrong: true },
  ],
});
const doc = (w = {}) => storyDoc({ plot: plot(), extraSystems: [
  { use: 'plot.relationship', with: { repRange: [-50, 50], decayPerDay: 2, ...w.rel } }, { use: 'plot.journal' },
  { use: 'plot.barks', with: { channels: ['ambient', 'character'], interval: 0.5, channelGap: 0, ...w.barks } },
  { use: 'plot.events.random', with: { rate: 0, ...w.ev } }, { use: 'plot.investigation', with: { maxWrong: 0, ...w.inv } },
] });

test('relationship: clamped rep and affinity vars, ranks, hostility, daily decay', () => {
  const { rt } = make(doc());
  const log = recorder(rt);
  assert.equal(rt.state.vars['rep.folk'], 5, 'starting rep');
  rt.run([{ do: 'add_rep', faction: 'folk', delta: 30 }]);
  assert.equal(rt.state.vars['rep.folk'], 35);
  assert.equal(rt.test({ rank: 'folk', title: 'Friend' }), true);
  assert.ok(log.some(e => e.name === 'rank_changed:folk' && e.rank === 'Friend'));
  rt.run([{ do: 'add_rep', faction: 'folk', delta: 500 }]); assert.equal(rt.state.vars['rep.folk'], 50, 'clamped');
  rt.run([{ do: 'add_rep', faction: 'folk', delta: -60 }]);
  assert.equal(rt.test({ hostile: 'folk' }), true); assert.ok(log.some(e => e.name === 'faction_hostile:folk'));
  assert.equal(rt.test({ var: 'rep.folk', lt: 0 }), true, 'plain var predicates read rep');
  rt.run([{ do: 'add_affinity', character: 'elder', delta: 7 }]); rt.emit('new_day');
  assert.equal(rt.state.vars['affinity.elder'], 5); assert.equal(rt.state.vars['rep.folk'], -8, 'decay toward zero');
});

test('journal: add_entry once, known, entries by tag, entries learned by condition', () => {
  const { rt } = make(doc());
  const log = recorder(rt);
  rt.run([{ do: 'add_entry', entry: 'e1' }, { do: 'add_entry', entry: 'e1' }]);
  assert.equal(log.filter(e => e.name === 'journal_added').length, 1);
  assert.equal(rt.test({ known: 'e1' }), true);
  assert.equal(rt.test({ entries: 'lore', gte: 2 }), false);
  rt.run([{ do: 'add_entry', entry: 'e2' }]); assert.equal(rt.test({ entries: 'lore', gte: 2 }), true);
  goTo(rt, 'cave'); step(rt);
  assert.equal(rt.test({ known: 'e3' }), true);
  assert.deepEqual(rt.service('journal').list().map(e => e.id), ['e1', 'e2', 'e3']);
});

test('barks: channels, predicates, cooldowns, once, seeded choice, bark effect', () => {
  const { rt } = make(doc());
  const log = recorder(rt);
  step(rt, 240);
  const ambient = log.filter(e => e.name === 'bark' && e.channel === 'ambient');
  assert.ok(ambient.length >= 3 && ambient.length <= 6, `cooldowns limit ambient barks (${ambient.length})`);
  assert.equal(log.filter(e => e.name === 'bark' && e.channel === 'character').length, 1, 'once');
  goTo(rt, 'forest'); const before = log.length; step(rt, 120);
  assert.equal(log.slice(before).filter(e => e.name === 'bark' && e.channel === 'ambient').length, 0, 'predicates gate barks');
  rt.run([{ do: 'bark', channel: 'ambient', line: 'Scripted!' }]);
  assert.equal(log.at(-1).text, 'Scripted!');
  const seq = () => { const r = make(doc()).rt, l = recorder(r); step(r, 240); return l.filter(e => e.name === 'bark').map(e => e.text); };
  assert.deepEqual(seq(), seq(), 'same seed, same barks');
});

test('random events: weighted seeded draws, once, choices with conditions and chains', () => {
  const { rt } = make(doc({ ev: { rate: 60, minGap: 0 } }));
  const log = recorder(rt);
  step(rt, 61);
  assert.ok(rt.service('randomEvents').pending() || rt.state.flags.wet, 'rate 60/min draws within a second');
  const play = () => { const r = make(doc({ ev: { rate: 30, minGap: 1 } })).rt, l = recorder(r); for (let i = 0; i < 1200; i++) { r.step(); const p = r.service('randomEvents').pending(); if (p) r.step({ actions: { event_choice: { index: 0 } } }); } return l.filter(e => e.name === 'random_event').map(e => e.event); };
  const seq = play();
  assert.deepEqual(seq, play(), 'deterministic');
  assert.ok(seq.filter(e => e === 'ev_rain').length <= 1, 'once');
  assert.ok(!seq.includes('ev_guard'), 'draw:false events are never drawn');
  const b = make(doc()).rt;
  b.run([{ do: 'trigger_event', event: 'ev_trader' }]);
  assert.deepEqual(b.availableOptions().filter(o => 'event_choice' in o.actions).map(o => o.label), ['event ev_trader.0: Trade'], 'conditional choice hidden');
  b.run([{ do: 'set_flag', flag: 'evil' }]);
  act(b, { event_choice: { index: 1 } });
  assert.equal(b.state.vars['rep.folk'], -5, 'chained into the guard event');
  assert.equal(b.test({ random_event: 'ev_guard' }), true);
  void log;
});

test('investigation: clues by effect and condition, deductions as options, wrong theories fail the case', () => {
  const { rt } = make(doc());
  const log = recorder(rt);
  rt.run([{ do: 'add_clue', clue: 'c_mud' }]);
  assert.equal(rt.availableOptions().some(o => o.actions.deduce), false, 'needs every clue');
  rt.run([{ do: 'give_item', item: 'key' }]); step(rt);
  assert.equal(rt.test({ clue: 'c_note' }), true, 'clue found by condition');
  assert.deepEqual(rt.availableOptions().filter(o => o.actions.deduce).map(o => o.actions.deduce), ['d_butler']);
  act(rt, { deduce: 'd_butler' });
  assert.equal(rt.state.flags.solved, true); assert.equal(rt.test({ deduced: 'd_butler' }), true);
  assert.equal(rt.test({ clues: '*', gte: 2 }), true);
  rt.run([{ do: 'add_clue', clue: 'c_lie' }]); act(rt, { deduce: 'd_maid' });
  assert.equal(log.some(e => e.name === 'investigation_failed'), false, 'maxWrong 0: wrong theories never end the case');
  const b = make(doc({ inv: { maxWrong: 1 } })).rt, bl = recorder(b);
  b.run([{ do: 'add_clue', clue: 'c_lie' }, { do: 'add_clue', clue: 'c_mud' }, { do: 'give_item', item: 'key' }]); step(b);
  act(b, { deduce: 'd_maid' });
  assert.ok(bl.some(e => e.name === 'investigation_failed'));
  assert.equal(b.availableOptions().some(o => o.actions.deduce), false, 'a failed case offers no deductions');
});

test('solver explores random event choices and deductions', () => {
  const d = doc();
  d.plot.endings = [{ id: 'e_solved', title: 'Solved', when: { all: [{ flag: 'solved' }, { item: 'gem' }] }, epilogue: '.' }];
  d.systems.push({ use: 'plot.ending' });
  d.plot.storyboard.acts[0].beats = [{ id: 'b0', do: [{ do: 'add_clue', clue: 'c_mud' }, { do: 'give_item', item: 'key' }, { do: 'trigger_event', event: 'ev_trader' }] }];
  const { registry, logic, checked } = make(d);
  const s = solve(checked.doc, registry, logic);
  assert.equal(s.completable, true, JSON.stringify(s));
  assert.ok(s.endings.e_solved.includes('deduce d_butler') && s.endings.e_solved.includes('event ev_trader.0: Trade'));
});

test('deterministic replay across all five', () => {
  const play = () => { const { rt } = make(doc({ ev: { rate: 20, minGap: 0 } })); rt.run([{ do: 'add_rep', faction: 'folk', delta: 3 }, { do: 'add_clue', clue: 'c_mud' }]); step(rt, 300); return rt.snapshot(); };
  assert.deepEqual(play(), play());
});

test('preflight rejects bad data with stable codes', () => {
  const d = doc();
  d.plot.factions.push({ id: 'f2', ranks: [{ at: 'x' }], hostileBelow: 'low', mood: 1 });
  d.plot.entries.push({ id: 'e9' });
  d.plot.barks.push({ channel: 'radio', say: '' , cooldown: -1, character: 'nobody' });
  d.plot.randomEvents.push({ id: 'ev_bad', weight: -1, choices: [{ then: 'ev_none' }] });
  d.plot.deductions.push({ id: 'd_bad', clues: ['c_none'] }, { id: 'd_empty', clues: [] });
  d.plot.storyboard.acts[0].beats.push({ id: 'b', when: { entries: 'nonexistent_tag' }, do: [{ do: 'bark', channel: 'tv', line: 'x' }, { do: 'add_rep', faction: 'nobody', delta: 'x' }] });
  const r = check(d);
  // Single-field rules are the declared shapes' (card.data): missing names, titles and texts are param_missing, wrong
  // types param_type, an empty line param_pattern, negative weights param_range, unknown fields param_unknown.
  for (const c of ['param_missing', 'param_type', 'param_unknown', 'param_pattern', 'param_range', 'ref_unknown', 'bark_channel_unknown', 'effect_invalid']) assert.ok(codes(r).includes(c), c);
  // repRange's two ends are a rule across them (rep_range_invalid), not the kernel's param_range.
  const p = doc({ rel: { repRange: [5, 1] }, barks: { interval: 0 } });
  assert.deepEqual(codes(check(p)).sort(), ['param_range', 'rep_range_invalid']);
});
