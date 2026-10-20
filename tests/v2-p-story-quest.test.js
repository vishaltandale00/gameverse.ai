import test from 'node:test';
import assert from 'node:assert/strict';
import { storyDoc, make, check, codes, act, step, goTo, moveTo, recorder } from '../v2/primitives/plot/story-testkit.js';

const quests = () => [
  { id: 'q_main', title: 'Main', kind: 'main', giver: 'elder', autoStart: true, objectives: [
    { id: 'o_talk', kind: 'talk', character: 'elder' },
    { id: 'o_herbs', kind: 'collect', item: 'herb', count: 2 },
    { id: 'o_give', kind: 'deliver', item: 'herb', count: 1, to: 'elder' },
    { id: 'o_forest', kind: 'reach', zone: 'forest' },
  ], rewards: { items: [{ item: 'gem', count: 2 }] }, onComplete: [{ do: 'set_flag', flag: 'main_done' }] },
  { id: 'q_hunt', title: 'Hunt', kind: 'side', giver: 'ranger', prereq: ['q_main'], order: 'any', objectives: [
    { id: 'o_wolves', kind: 'defeat', archetype: 'wolf', count: 2, zone: 'forest' },
    { id: 'o_lever', kind: 'use', interactable: 'lever' },
    { id: 'o_tea', kind: 'craft', recipe: 'r_tea' },
    { id: 'o_grove', kind: 'discover', tag: 'grove' },
    { id: 'o_build', kind: 'build', block: 'plank', count: 3, zone: 'village' },
    { id: 'o_flag', kind: 'until', when: { flag: 'signal' } },
    { id: 'o_spot', kind: 'reach', at: [25, 5, 0], radius: 1.5, optional: true },
  ] },
  { id: 'q_escort', title: 'Escort', kind: 'side', objectives: [
    { id: 'o_walk', kind: 'escort', who: 'ranger', to: 'village' },
    { id: 'o_hold', kind: 'survive', seconds: 0.5 },
    { id: 'o_ride', kind: 'drive', vehicle: 'cart', distance: 3, to: 'cave' },
  ], offer: 'script' },
  { id: 'q_timed', title: 'Timed', kind: 'challenge', timeLimit: 0.25, objectives: [{ id: 'o', kind: 'until', when: { flag: 'never' } }], onFail: [{ do: 'set_flag', flag: 'too_slow' }], offer: 'script' },
  { id: 'q_doom', title: 'Doom', kind: 'side', fail: { flag: 'doom' }, objectives: [{ id: 'o', kind: 'until', when: { flag: 'never' } }], offer: 'script' },
  { id: 'q_rep', title: 'Bounty', kind: 'bounty', repeatable: true, objectives: [{ id: 'o', kind: 'defeat', archetype: 'wolf', count: 1 }], rewards: { items: [{ item: 'key' }] } },
  { id: 'q_branch', title: 'Choice', kind: 'side', objectives: [{ id: 'o', kind: 'until', when: { flag: 'decided' } }], branches: [{ id: 'br_a', label: 'A', when: { flag: 'pick_a' } }, { id: 'br_b', label: 'B' }], offer: 'script' },
  { id: 'q_locked', title: 'Locked', kind: 'side', objectives: [{ id: 'o', kind: 'until', when: { flag: 'x' } }] },
];
const doc = (w = {}) => {
  const d = storyDoc({ plot: { quests: quests(), gates: [{ id: 'vault', requires: { flag: 'vault_ok' }, hint: 'later', locks: ['quest:q_locked'] }],
    storyboard: { acts: [{ id: 'a1', beats: [{ id: 'b_obj', when: { objective: 'o_herbs', quest: 'q_main', state: 'done' }, do: [{ do: 'set_flag', flag: 'herbs_seen' }] }, { id: 'b_q', when: { quest: 'q_main', objective: 'o_forest' }, do: [{ do: 'set_flag', flag: 'forest_obj' }] }] }] } } });
  d.systems[3].with = w;
  return d;
};
const qs = rt => rt.service('quests');

test('a sequential main quest: talk, collect, deliver (consumes), reach, rewards', () => {
  const { rt } = make(doc());
  const log = recorder(rt);
  step(rt);
  assert.equal(qs(rt).state('q_main'), 'active', 'autoStart');
  assert.equal(qs(rt).tracked(), 'q_main');
  assert.equal(rt.test({ objective: 'o_talk', quest: 'q_main', state: 'active' }), true);
  assert.equal(rt.test({ objective: 'o_herbs', quest: 'q_main', state: 'active' }), false, 'sequential: one at a time');
  rt.run([{ do: 'give_item', item: 'herb', count: 2 }]); step(rt);
  assert.equal(rt.test({ objective: 'o_herbs', quest: 'q_main' }), false, 'collect is not active before talk is done');
  act(rt, { talk: 'elder' }); step(rt);
  assert.equal(rt.test({ objective: 'o_herbs', quest: 'q_main' }), true, 'herbs already held complete at once');
  assert.equal(rt.state.flags.herbs_seen, true);
  assert.equal(rt.test({ item: 'herb', gte: 2 }), true, 'still holding both: deliver needs a talk');
  act(rt, { choose: 'next' }); act(rt, { talk: 'elder' }); step(rt);
  assert.equal(rt.test({ item: 'herb', gte: 2 }), false, 'deliver consumed one');
  assert.equal(rt.test({ item: 'herb' }), true);
  goTo(rt, 'forest'); step(rt);
  assert.equal(qs(rt).state('q_main'), 'complete');
  assert.equal(rt.test({ quest: 'q_main', state: 'complete' }), true);
  assert.equal(rt.test({ item: 'gem', gte: 2 }), true, 'item rewards');
  assert.equal(rt.state.flags.main_done && rt.state.flags.forest_obj, true);
  assert.deepEqual(log.filter(e => e.name === 'objective_done').map(e => e.objective), ['o_talk', 'o_herbs', 'o_give', 'o_forest']);
  assert.equal(rt.state.vars['quests.active'], 0);
  const entry = qs(rt).list().find(q => q.id === 'q_main');
  assert.deepEqual(entry.objectives.map(o => [o.id, o.state]), [['o_talk', 'done'], ['o_herbs', 'done'], ['o_give', 'done'], ['o_forest', 'done']]);
});

test('an any-order quest offered by its giver: defeat (zone), use, craft, discover (tag), build (zone), until, optional', () => {
  const { rt } = make(doc());
  rt.run([{ do: 'complete_quest', quest: 'q_main' }]); step(rt);
  assert.equal(qs(rt).state('q_hunt'), 'available');
  act(rt, { accept_quest: 'q_hunt' });
  assert.equal(qs(rt).state('q_hunt'), 'available', 'giver out of range');
  assert.ok(!rt.availableOptions().some(o => o.actions.accept_quest === 'q_hunt'));
  moveTo(rt, [11, 0, 0]); step(rt);
  assert.ok(rt.availableOptions().some(o => o.actions.accept_quest === 'q_hunt'), 'accept is a solver option near the giver');
  act(rt, { accept_quest: 'q_hunt' });
  assert.equal(qs(rt).state('q_hunt'), 'active');
  rt.emitTyped('defeated', 'wolf', { id: 'w1', zone: 'cave' });
  rt.emitTyped('defeated', 'wolf', { id: 'w2', zone: 'forest' });
  rt.emitTyped('defeated', 'slime', { id: 's1', zone: 'forest' });
  step(rt);
  assert.equal(qs(rt).objective('q_hunt', 'o_wolves').n, 1, 'only wolves in the forest count');
  rt.emitTyped('defeated', 'wolf', { id: 'w3' }); // no zone in the event: the player's zone (forest)
  rt.emitTyped('used', 'lever', {}); rt.emitTyped('crafted', 'r_tea', {}); rt.emitTyped('discovered', 'forest', {});
  rt.emitTyped('block_placed', 'plank', { at: [2, 2, 0] }); rt.emitTyped('block_placed', 'plank', { at: [2, 3, 0] });
  rt.emitTyped('block_placed', 'plank', { at: [15, 3, 0] }); rt.emitTyped('block_placed', 'stone', { at: [2, 4, 0] });
  step(rt);
  const st = id => qs(rt).objective('q_hunt', id).state;
  assert.deepEqual(['o_wolves', 'o_lever', 'o_tea', 'o_grove', 'o_build'].map(st), ['done', 'done', 'done', 'done', 'active']);
  assert.equal(qs(rt).objective('q_hunt', 'o_build').n, 2, 'plank outside the zone and stone do not count');
  rt.emitTyped('block_placed', 'plank', { at: [3, 3, 0] }); rt.run([{ do: 'set_flag', flag: 'signal' }]); step(rt);
  assert.equal(qs(rt).state('q_hunt'), 'complete', 'optional objective not needed');
  assert.equal(st('o_spot'), 'active');
});

test('escort, survive and drive; time limits, fail predicates, onFail', () => {
  const { rt } = make(doc());
  const log = recorder(rt);
  rt.run([{ do: 'start_quest', quest: 'q_escort' }, { do: 'start_quest', quest: 'q_timed' }, { do: 'start_quest', quest: 'q_doom' }]);
  rt.space('world').setPos(rt.entity('ranger'), [3, 3, 0], rt); step(rt);
  assert.equal(qs(rt).objective('q_escort', 'o_walk').state, 'done');
  step(rt, 15);
  assert.equal(qs(rt).state('q_timed'), 'failed'); assert.equal(rt.state.flags.too_slow, true);
  assert.equal(log.find(e => e.name === 'quest_failed').reason, 'time');
  step(rt, 20);
  assert.equal(qs(rt).objective('q_escort', 'o_hold').state, 'done', 'survived 0.5 s');
  rt.spawn('cart', { id: 'cart1', space: 'world', at: [21, 1, 0] });
  rt.emit('vehicle_entered', { who: 'player', vehicle: 'cart1' });
  for (const x of [22, 23, 24, 25]) { rt.space('world').setPos(rt.entity('cart1'), [x, 1, 0], rt); moveTo(rt, [x, 1, 0]); step(rt); }
  assert.equal(qs(rt).state('q_escort'), 'complete', 'drove 3 units into the cave');
  rt.run([{ do: 'set_flag', flag: 'doom' }]); step(rt);
  assert.equal(qs(rt).state('q_doom'), 'failed');
  // escortee death fails the quest
  const b = make(doc()).rt;
  b.run([{ do: 'start_quest', quest: 'q_escort' }, { do: 'set_alive', character: 'ranger', alive: false }]); step(b);
  assert.equal(b.service('quests').state('q_escort'), 'failed');
});

test('repeatable, branches, gate locks, set_objective, maxActive and tracking', () => {
  const { rt } = make(doc({ maxActive: 2 }));
  step(rt);
  assert.equal(qs(rt).state('q_rep'), 'available');
  assert.ok(rt.availableOptions().some(o => o.actions.accept_quest === 'q_rep'), 'no giver: offered anywhere');
  act(rt, { accept_quest: 'q_rep' });
  rt.emitTyped('defeated', 'wolf', {}); step(rt);
  assert.equal(qs(rt).state('q_rep'), 'available', 'repeatable returns to available');
  assert.equal(rt.test({ quest: 'q_rep', gte: 1 }), true);
  act(rt, { accept_quest: 'q_rep' }); rt.emitTyped('defeated', 'wolf', {}); step(rt);
  assert.equal(rt.test({ quest: 'q_rep', gte: 2 }), true); assert.equal(rt.test({ item: 'key', gte: 2 }), true, 'rewards every time');
  rt.run([{ do: 'start_quest', quest: 'q_branch' }]);
  assert.equal(rt.state.vars['quests.active'], 2, 'q_main and q_branch');
  act(rt, { accept_quest: 'q_rep' });
  assert.equal(qs(rt).state('q_rep'), 'available', 'maxActive 2 refuses a third accepted quest');
  assert.ok(rt.state.events.some(e => e.name === 'quest_blocked'), 'quest_blocked reports the cap');
  rt.run([{ do: 'set_flag', flag: 'decided' }]); step(rt);
  assert.equal(rt.test({ quest: 'q_branch', branch: 'br_b' }), true, 'fallback branch without when');
  assert.equal(qs(rt).state('q_locked'), 'locked');
  rt.run([{ do: 'set_flag', flag: 'vault_ok' }]); step(rt);
  assert.equal(qs(rt).state('q_locked'), 'available', 'gate opened');
  rt.run([{ do: 'set_objective', quest: 'q_main', objective: 'o_talk', state: 'done' }, { do: 'track_quest', quest: 'q_main' }]); step(rt);
  assert.equal(rt.test({ objective: 'o_herbs', quest: 'q_main', state: 'active' }), true);
  assert.equal(qs(rt).tracked(), 'q_main');
});

test('deterministic replay and restore', () => {
  const play = () => { const { rt } = make(doc()); step(rt); act(rt, { talk: 'elder' }); rt.run([{ do: 'give_item', item: 'herb', count: 2 }]); step(rt, 3); rt.emitTyped('defeated', 'wolf', {}); goTo(rt, 'forest'); step(rt, 5); return rt; };
  const a = play(), b = play();
  assert.deepEqual(a.snapshot(), b.snapshot());
  const snap = a.snapshot(); a.run([{ do: 'complete_quest', quest: 'q_main' }]); a.restore(snap);
  assert.equal(a.service('quests').state('q_main'), snap.prim['plot.quest'].q.q_main.state);
});

test('preflight rejects broken quests with stable codes', () => {
  const d = doc();
  d.plot.quests.push(
    { id: 'b1', title: 'B1', kind: 'epic', order: 'random', giver: 'nobody', prereq: ['ghost', 'b1'], objectives: [{ id: 'o', kind: 'teleport' }, { id: 'o', kind: 'reach' }, { id: 'p', kind: 'collect', item: 'herb', count: 0, extra: 1 }, { id: 'q', kind: 'deliver', item: 'herb', to: 'mars' }, { id: 'r', kind: 'talk', character: 'elder', node: 'n9' }, { id: 's', kind: 'craft' }] },
    { id: 'b2', objectives: [] },
    { id: 'b3', title: 'B3', prereq: ['b4'], objectives: [{ id: 'o', kind: 'until', when: { flag: 'x' }, optional: true }] },
    { id: 'b4', title: 'B4', prereq: ['b3'], timeLimit: -1, rewards: { xp: 5, coins: 3 }, objectives: [{ id: 'o', kind: 'defeat' }] },
  );
  const r = check(d);
  for (const c of ['quest_invalid', 'ref_unknown', 'quest_cycle', 'objective_kind_unknown', 'id_duplicate', 'objective_invalid', 'param_range', 'param_unknown', 'param_missing', 'field_unknown']) assert.ok(codes(r).includes(c), c);
  assert.ok(r.errors.some(e => ['effect_unknown', 'vocabulary_owner_missing'].includes(e.code) && /give_xp/.test(e.message)), 'xp rewards need a progression primitive');
  const p = doc({ maxActive: 0 });
  assert.deepEqual(codes(check(p)), ['param_range']);
  const bad = doc(); bad.plot.storyboard.acts[0].beats[0].when = { quest: 'q_main', state: 'finished' };
  assert.ok(codes(check(bad)).includes('predicate_invalid'));
  const bad2 = doc(); bad2.plot.storyboard.acts[0].beats[0].when = { objective: 'o_nope', quest: 'q_main' };
  assert.ok(codes(check(bad2)).includes('ref_unknown'));
});
