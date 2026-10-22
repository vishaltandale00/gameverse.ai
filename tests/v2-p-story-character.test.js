import test from 'node:test';
import assert from 'node:assert/strict';
import { storyDoc, make, check, codes, act, moveTo, recorder, step } from '../v2/primitives/plot/story-testkit.js';

const doc = () => storyDoc({ plot: {
  characters: [
    { id: 'hero_c', name: 'You', role: 'player', archetype: 'hero' },
    { id: 'elder', name: 'Elder', archetype: 'villager', model: 'm_elder', home: 'village', at: [2, 1, 0], faction: 'folk', schedule: [{ from: 6, to: 18, zone: 'village', doing: 'sweep' }], dialogue: [{ when: { flag: 'night' }, id: 'elder_night' }, { id: 'elder_day' }] },
    { id: 'ranger', name: 'Ranger', archetype: 'villager', home: 'forest' },
    { id: 'ghost', name: 'Ghost', spawn: false },
  ],
  factions: [{ id: 'folk', name: 'Village folk' }],
  dialogue: {
    elder_day: { speaker: 'elder', start: 'n1', nodes: { n1: { say: 'Good day.', end: true } } },
    elder_night: { speaker: 'elder', start: 'n1', nodes: { n1: { say: 'Go home.', end: true } } },
  },
  storyboard: { acts: [{ id: 'a1', beats: [{ id: 'b_met', when: { met: 'elder' }, do: [{ do: 'set_flag', flag: 'greeted' }] }, { id: 'b_rest', when: { not: { alive: 'ranger' } }, do: [{ do: 'set_flag', flag: 'mourning' }] }] }] },
}, extraSystems: [{ use: 'plot.relationship' }], content: { models: { m_elder: { kind: 'voxel' } } } });

test('characters spawn as entities with their id, archetype, model, schedule and home', () => {
  const { rt } = make(doc());
  const elder = rt.entity('elder'), ranger = rt.entity('ranger');
  assert.equal(elder.archetype, 'villager');
  assert.equal(elder.components.model, 'm_elder');
  assert.deepEqual(elder.components.schedule[0].doing, 'sweep');
  assert.equal(elder.components.character.faction, 'folk');
  assert.deepEqual(elder.at, [2, 1, 0], 'explicit at wins');
  assert.equal(ranger.zone, 'forest', 'no at: placed in the home zone');
  assert.equal(rt.entity('hero_c'), undefined, 'the player character is the player, not a second entity');
  assert.equal(rt.entity('ghost'), undefined, 'spawn:false is not spawned');
});

test('talk: range check, met, talked:<id>, first matching dialogue', () => {
  const { rt } = make(doc());
  const log = recorder(rt);
  act(rt, { talk: 'ranger' });
  assert.equal(rt.state.counts['talked:ranger'], undefined, 'ranger is out of range');
  const opts = rt.availableOptions().map(o => o.label);
  assert.ok(opts.includes('talk elder') && !opts.includes('talk ranger'), opts.join(','));
  act(rt, { talk: 'elder' });
  assert.equal(rt.state.counts['talked:elder'], 1);
  assert.equal(rt.state.flags.greeted, true, 'met predicate drove a beat');
  assert.equal(log.find(e => e.name === 'dialogue_start').dialogue, 'elder_day');
  act(rt, { choose: 'next' });
  rt.run([{ do: 'set_flag', flag: 'night' }]);
  act(rt, { talk: 'elder' });
  assert.equal(log.filter(e => e.name === 'dialogue_start').pop().dialogue, 'elder_night', 'first entry whose when holds');
  moveTo(rt, [11, 0, 0]); act(rt, { choose: 'next' }); act(rt, { talk: 'ranger' });
  assert.equal(rt.state.counts['talked:ranger'], 1, 'in range after moving');
});

test('a conversation opened by talking ends when the player walks out of talk range; one an effect opens does not', () => {
  const { rt } = make(doc());
  const log = recorder(rt), dlg = () => rt.service('dialogue');
  act(rt, { talk: 'elder' });
  assert.equal(dlg().active(), true, 'talking opened the elder\'s dialogue');
  moveTo(rt, [11, 0, 0]); step(rt, 1);
  assert.equal(dlg().active(), false, 'walking away ended it');
  assert.equal(log.filter(e => e.name === 'dialogue_end').pop()?.dialogue, 'elder_day');
  assert.ok(rt.availableOptions().some(o => o.actions?.talk === 'ranger'), 'the character in front of the player can be talked to');
  rt.run([{ do: 'start_dialogue', dialogue: 'elder_day', with: 'elder' }]);
  step(rt, 3);
  assert.equal(dlg().active(), true, 'an effect-opened conversation is not tied to the talk range');
  // Replays: the same inputs give the same state.
  const play = () => { const { rt: r } = make(doc()); act(r, { talk: 'elder' }); moveTo(r, [11, 0, 0]); step(r, 2); return r.snapshot(); };
  assert.deepEqual(play(), play());
});

test('set_alive despawns and revives; alive drives beats; deaths from combat count', () => {
  const { rt } = make(doc());
  rt.run([{ do: 'set_alive', character: 'ranger', alive: false }]);
  assert.equal(rt.entity('ranger'), undefined);
  step(rt);
  assert.equal(rt.state.flags.mourning, true);
  assert.equal(rt.test({ alive: 'ranger' }), false);
  rt.run([{ do: 'set_alive', character: 'ranger', alive: true }]);
  assert.equal(rt.entity('ranger').zone, 'forest');
  assert.equal(rt.test({ alive: 'ranger' }), true);
  rt.emit('died', { id: 'elder' });
  assert.equal(rt.test({ alive: 'elder' }), false, 'a died event for a character marks it dead');
  assert.equal(rt.test({ alive: true, who: 'player' }), true, 'combat.health form {alive: true, who}');
  assert.equal(rt.service('character').alive('ghost'), true, 'never spawned is alive until killed');
});

test('deterministic replay and snapshot restore', () => {
  const run = () => { const { rt } = make(doc()); act(rt, { talk: 'elder' }); act(rt, { choose: 'next' }); rt.run([{ do: 'set_alive', character: 'ranger', alive: false }]); step(rt, 5); return rt; };
  const a = run(), b = run();
  assert.deepEqual(a.snapshot(), b.snapshot());
  const snap = a.snapshot(); act(a, { talk: 'elder' }); a.restore(snap);
  assert.deepEqual(a.snapshot(), snap);
  assert.equal(a.service('character').met('elder'), true, 'service reads restored state');
});

test('preflight rejects bad characters with stable codes', () => {
  const bad = doc();
  bad.plot.characters.push({ id: 'x1', name: 'X', archetype: 'nope', home: 'moon', model: 'missing', dialogue: [{ id: 'nodlg' }], schedule: [{ from: 30, to: 2 }], faction: 'nobody', mood: 'odd' });
  bad.plot.characters.push({ id: 'x2', archetype: 'villager' });
  bad.plot.characters.push({ id: 'x3', name: 'Floating' });
  const r = check(bad);
  // Single-field rules are the declared shape's (card.data): an unknown field is param_unknown, a missing name
  // param_missing, an hour past 24 param_range; the rules across fields keep their codes.
  for (const c of ['ref_unknown', 'schedule_invalid', 'param_unknown', 'param_missing', 'param_range', 'character_unspawnable']) assert.ok(codes(r).includes(c), c);
  assert.ok([...r.errors, ...r.warnings].some(e => e.path === 'plot.characters[4].home'));
  const badParam = doc(); badParam.systems[1].with = { talkRange: -1, chatty: true };
  assert.deepEqual(codes(check(badParam)).sort(), ['param_range', 'param_unknown']);
  const badAlive = doc(); badAlive.plot.storyboard.acts[0].beats[0].when = { alive: 'nobody' };
  assert.ok(codes(check(badAlive)).includes('ref_unknown'));
});
