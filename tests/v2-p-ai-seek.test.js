// Drivers for loops that declare a target service (card.loop.targets / card.mode.targets): the real catalogue's race
// and ball sport name where each AI participant goes next (the next checkpoint, the ball), and gameplay.ai.seek
// (card.drives.targets) steers them there. Proven statically (the loop check fails without a driver; repairLoop adds
// the one the declarations name and the check passes) and through the real runtime (rivals complete laps, the other
// team goes for the ball).
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../v2/kernel/testing.js';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { loopProblems, LOOP_CODES, drivesOf } from '../v2/planner/loop-check.js';
import { cardLoop } from '../v2/planner/loop.js';
import { repairLoop } from '../v2/planner/presets.js';
import { PRIMITIVES } from '../v2/primitives/index.js';

const { registry, logic } = buildCatalogue();
const base = (zones, archetypes, systems, player, size) => ({
  schema: 'gameverse.v2.game/0.2', id: 'seek-test', title: 'Seek test', seed: 7,
  spaces: [{ id: 'world', use: 'engine.space.arena2d', with: { size }, zones }],
  systems, content: { archetypes: [{ id: 'hero', components: { body: { size: [1, 1], vel: [0, 0] } } }, ...archetypes] }, player,
  plot: { endings: [{ id: 'victory', outcome: 'won' }, { id: 'defeat', outcome: 'lost' }] },
});
const added = (before, after) => after.systems.map(s => s.use).filter(u => !before.systems.some(s => s.use === u));

// A square circuit of four checkpoint zones; the player idles on the start line while two rivals race.
const raceDoc = () => base(
  [{ id: 'start', rect: [0, 0, 3, 3] }, { id: 'east', rect: [17, 0, 20, 3] }, { id: 'north', rect: [17, 11, 20, 14] }, { id: 'west', rect: [0, 11, 3, 14] }],
  [{ id: 'rival', components: { body: { size: [1, 1] } } }, { id: 'rival_b', components: { body: { size: [1, 1] } } }],
  [{ use: 'engine.spawner', with: { rules: [{ id: 'rival_a', archetype: 'rival', zone: 'start', count: [1, 1] }, { id: 'rival_b', archetype: 'rival_b', zone: 'start', count: [1, 1] }] } },
    { use: 'gameplay.move.walk' },
    { use: 'gameplay.race', with: { laps: 2, checkpoints: ['start', 'east', 'north', 'west'], racers: ['player', 'rival', 'rival_b'], countdown: 1, dnfAfter: 0, onWin: [{ do: 'end_game', ending: 'victory' }], onLose: [{ do: 'end_game', ending: 'defeat' }] } }],
  { archetype: 'hero', at: [1, 1] }, [20, 14]);

// A pitch: the player's team (blue) against red, whose member nothing drives until the repair.
const pitchDoc = () => base(
  [{ id: 'left_goal', rect: [0, 6, 1, 10] }, { id: 'right_goal', rect: [29, 6, 30, 10] }],
  [{ id: 'ball', components: { body: { size: [0.5, 0.5], vel: [0, 0] } } }, { id: 'striker', components: { body: { size: [1, 1], vel: [0, 0] } } }],
  [{ use: 'engine.spawner', with: { rules: [{ id: 'reds', archetype: 'striker', at: [24, 3], count: [1, 1] }] } },
    { use: 'gameplay.sports', with: { ball: 'ball', ballAt: [15, 8], teams: [{ id: 'blue', members: ['player'] }, { id: 'red', members: ['striker'] }], goals: [{ zone: 'right_goal', scores: 'blue' }, { zone: 'left_goal', scores: 'red' }], kickoffSec: 0.2, periodSec: 60, onWin: [{ do: 'end_game', ending: 'victory' }], onLose: [{ do: 'end_game', ending: 'defeat' }] } }],
  { archetype: 'hero', at: [5, 8] }, [30, 16]);

test('the race and the ball sport declare target services, and gameplay.ai.seek declares that it drives by them', () => {
  assert.equal(cardLoop(registry.get('gameplay.race').card)?.targets, 'race.targets');
  assert.equal(cardLoop(registry.get('gameplay.sports').card)?.targets, 'sports.targets');
  for (const id of ['gameplay.race', 'gameplay.sports']) assert.ok(registry.get(id).card.provides.services.includes(cardLoop(registry.get(id).card)?.targets), id);
  const d = drivesOf(registry.get('gameplay.ai.seek').card);
  assert.deepEqual([d?.control, d?.targets, d?.movement, d?.components, d?.loops], ['ai', true, true, [], []]);
});

test('race: rivals nothing drives fail the loop check; repairLoop adds the target driver; the rivals then complete their laps', () => {
  const doc = raceDoc();
  const core = ['gameplay.race'];
  assert.deepEqual(loopProblems(doc, registry, { logic, core, opponent: 'ai-rival' }).map(p => [p.code, p.primitive]), [[LOOP_CODES.inert, 'gameplay.race']]);
  const fixed = repairLoop(doc, registry, { logic, core, opponent: 'ai-rival', idea: 'race rivals around the circuit' });
  assert.deepEqual(fixed.problems, []);
  assert.deepEqual(added(doc, fixed.doc), ['gameplay.ai.seek']);
  assert.ok(fixed.fixes.some(f => /card\.drives\.targets/.test(f.what)), JSON.stringify(fixed.fixes));

  const { rt } = compile(fixed.doc, { primitives: PRIMITIVES });
  const rivals = () => Object.values(rt.state.entities).filter(e => /^rival/.test(e.archetype)).map(e => e.id).sort();
  for (let i = 0; i < 60 * 40 && rt.state.status === 'playing'; i++) rt.step();
  assert.equal(rivals().length, 2);
  const s = rt.store('gameplay.race:race');
  for (const id of rivals()) {
    assert.equal(s.racers[id]?.lap, 2, `${id} ran both laps`);
    assert.equal(rt.state.counts[`race_finished:${id}`], 1, `${id} finished`);
  }
  // The idle player never left the start line: the race goes on for it (no DNF window).
  assert.equal(s.racers.player.lap, 0);
  assert.equal(rt.state.status, 'playing');
});

test('race on a looped track (the space the race declares first): the driven rival laps the circuit the short way round', () => {
  const doc = { schema: 'gameverse.v2.game/0.2', id: 'track-seek', title: 'Track seek', seed: 7,
    spaces: [{ id: 'world', use: 'engine.space.track', with: { lanes: 3, length: 60, loop: true }, zones: [{ id: 'start', range: [0, 4] }, { id: 'mid', range: [20, 24] }, { id: 'far', range: [40, 44] }] }],
    systems: [{ use: 'engine.spawner', with: { rules: [{ id: 'r', archetype: 'rival', zone: 'start', count: [1, 1] }] } },
      { use: 'gameplay.race', with: { laps: 2, checkpoints: ['start', 'mid', 'far'], racers: ['player', 'rival'], countdown: 0.5, dnfAfter: 0 } }, { use: 'gameplay.ai.seek', with: { speed: 8 } }],
    content: { archetypes: [{ id: 'hero', components: {} }, { id: 'rival', components: {} }] }, player: { archetype: 'hero', at: [1, 0, 0.5] } };
  const { rt } = compile(doc, { primitives: PRIMITIVES });
  for (let i = 0; i < 60 * 30 && rt.state.status === 'playing'; i++) rt.step();
  const rival = Object.values(rt.state.entities).find(e => e.archetype === 'rival');
  assert.equal(rt.store('gameplay.race:race').racers[rival.id].lap, 2);
  assert.equal(rt.state.counts[`race_finished:${rival.id}`], 1);
  assert.equal(rt.state.counts.wrong_way ?? 0, 0, 'never driven the wrong way');
});

test('ball sport: the other team nothing drives fails the loop check; repairLoop adds the target driver; its striker goes for the ball', () => {
  const doc = pitchDoc();
  const core = ['gameplay.sports'];
  assert.deepEqual(loopProblems(doc, registry, { logic, core, opponent: 'ai-side' }).map(p => [p.code, p.primitive]), [[LOOP_CODES.inert, 'gameplay.sports']]);
  const fixed = repairLoop(doc, registry, { logic, core, opponent: 'ai-side', idea: 'play football against a rival team' });
  assert.deepEqual(fixed.problems, []);
  assert.deepEqual(added(doc, fixed.doc), ['gameplay.ai.seek']);

  const { rt } = compile(fixed.doc, { primitives: PRIMITIVES });
  const striker = () => Object.values(rt.state.entities).find(e => e.archetype === 'striker');
  const gap = () => Math.hypot(striker().at[0] - rt.entity('ball').at[0], striker().at[1] - rt.entity('ball').at[1]);
  while (!rt.test({ sports: 'play' }) && rt.state.frame < 600) rt.step();
  const start = gap();
  for (let i = 0; i < 30; i++) rt.step();
  assert.ok(gap() < start - 1, `the striker closes on the ball (${start} -> ${gap()})`);
  for (let i = 0; i < 60 * 6 && gap() > 0.5; i++) rt.step();
  assert.ok(gap() <= 0.5, `the striker reaches the ball (${gap()})`);
  // The ball moves: the striker follows it.
  rt.space('world').setPos(rt.entity('ball'), [10, 12], rt);
  for (let i = 0; i < 60 * 3; i++) rt.step();
  assert.ok(gap() <= 0.5, `the striker follows the ball (${gap()})`);
  // While play is not live (no target) the striker gets no intent from the driver.
  const { rt: idle } = compile(fixed.doc, { primitives: PRIMITIVES });
  idle.step();
  assert.equal(Object.values(idle.state.entities).find(e => e.archetype === 'striker')?.components.moveTo, undefined);
});

test('a loop that declares no target service is never served by the target driver', () => {
  // The versus loop's fighters (ids, no target service): its rival stays undriven by gameplay.ai.seek.
  const doc = base([], [{ id: 'rival', components: { health: { max: 3 } } }],
    [{ use: 'engine.spawner', with: { rules: [{ id: 'r', archetype: 'rival', at: [12, 2], count: [1, 1] }] } }, { use: 'gameplay.combat.health' },
      { use: 'gameplay.rounds', with: { fighters: ['player', 'rival'], onWin: [{ do: 'end_game', ending: 'victory' }], onLose: [{ do: 'end_game', ending: 'defeat' }] } }],
    { archetype: 'hero', at: [2, 2] }, [16, 9]);
  assert.equal(cardLoop(registry.get('gameplay.rounds').card)?.targets, null);
  const fixed = repairLoop(doc, registry, { logic, core: ['gameplay.rounds'], opponent: 'ai-rival', idea: 'fight a rival' });
  assert.ok(!added(doc, fixed.doc).includes('gameplay.ai.seek'), JSON.stringify(added(doc, fixed.doc)));
});
