// Modes compose: a battle sub-mode (minigame -> separate engine.space.none -> turns) and a racing
// ladder (vehicle.core + vehicle.car + race + stage.sequence) built only from primitives.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, testSpace } from '../v2/kernel/testing.js';
import modes from '../v2/primitives/gameplay/modes.index.js';
import spaces2d from '../v2/primitives/engine/spaces2d.index.js';
import { stubHealth, drive } from '../v2/primitives/gameplay/modes-lib-testing.js';

const P = [...modes, ...spaces2d, testSpace, stubHealth];

test('compose: a wild battle is a minigame in a none space running simultaneous turns, then the player returns', () => {
  const d = {
    schema: 'gameverse.v2.game/0.2', id: 'wild', title: 'Wild battle', seed: 2,
    spaces: [{ id: 'route', use: 'engine.space.test', with: { size: [20, 20, 1] }, zones: [{ id: 'grass', rect: [5, 5, 8, 8] }] }, { id: 'battle', use: 'engine.space.none', zones: [{ id: 'field' }] }],
    systems: [
      { use: 'gameplay.combat.health' },
      { use: 'gameplay.turns', with: { order: 'simultaneous', autoStart: false, ap: 1, movePerAp: 0, overwatch: false, sides: [{ id: 'player', control: 'player', members: ['player'] }, { id: 'wild', control: 'ai' }],
        actions: [{ id: 'tackle', range: 99, los: false, hit: { base: 95, max: 95 }, onHit: [{ do: 'damage', who: 'target', amount: 4 }] }, { id: 'quick_attack', priority: 1, range: 99, los: false, hit: { base: 100, max: 100 }, onHit: [{ do: 'damage', who: 'target', amount: 2 }] }] } },
      { use: 'gameplay.minigame', with: { games: [{ id: 'wild_battle', space: 'battle', zone: 'field', freeze: true, onStart: [{ do: 'start_turns' }], win: { turn: true, state: 'over', winner: 'player' }, lose: { turn: true, state: 'over', winner: 'wild' }, onWin: [{ do: 'add_var', var: 'badges' }] }] } },
    ],
    content: { archetypes: [{ id: 'hero', components: { health: { max: 20 } } }, { id: 'rattle', components: { health: { max: 9 }, turns: { side: 'wild', speed: 5 } } }] },
    player: { archetype: 'hero', at: [6, 6, 0] },
  };
  const { rt } = compile(d, { primitives: P });
  rt.step();
  rt.run([{ do: 'start_minigame', game: 'wild_battle' }]);
  rt.spawn('rattle', { id: 'foe', space: 'battle', at: 'field' });
  rt.step();
  assert.equal(rt.player().space, 'battle');
  assert.ok(rt.test({ turn: true, state: 'active' }));
  assert.equal(rt.modal?.owner, 'gameplay.turns', 'the battle modal sits over the minigame');
  assert.ok(rt.modal.actions.includes('mg_quit') && rt.modal.actions.includes('turn_act'), 'outer actions stay available');
  for (let i = 0; i < 12 && rt.test({ minigame: 'wild_battle', state: 'active' }); i++) rt.step({ actions: { turn_act: { action: 'tackle', target: 'foe' } } });
  assert.ok(rt.test({ minigame: 'wild_battle', state: 'won' }), 'tackles win the battle');
  assert.equal(rt.player().space, 'route'); assert.deepEqual(rt.player().at, [6, 6, 0]);
  assert.equal(rt.state.vars.badges, 1);
  assert.equal(rt.modal, null, 'both modals closed in order');
});

test('compose: a two-track racing ladder is vehicle.car + race + stage.sequence', () => {
  const d = {
    schema: 'gameverse.v2.game/0.2', id: 'cup', title: 'Kart cup', seed: 6,
    spaces: [{ id: 'circuit', use: 'engine.space.test', with: { size: [60, 12, 1] }, zones: [{ id: 'grid', rect: [0, 0, 3, 12] }, { id: 'far', rect: [40, 0, 43, 12] }] }],
    systems: [
      { use: 'gameplay.vehicle.core' }, { use: 'gameplay.vehicle.car', with: { plane: 'xy', preset: 'kart' } },
      { use: 'gameplay.race', with: { laps: 1, checkpoints: ['grid', 'far'], autoStart: false, countdown: 0.2 } },
      { use: 'gameplay.stage.sequence', with: { introSec: 0, clearSec: 0.1, apply: [{ target: 'use:gameplay.race.laps', table: [1, 2] }],
        stages: [{ id: 'cup1', onStart: [{ do: 'reset_race' }, { do: 'start_race' }], clear: { race: 'race', state: 'finished' } }, { id: 'cup2', onStart: [{ do: 'reset_race' }, { do: 'start_race' }], clear: { race: 'race', state: 'finished' } }] } },
    ],
    content: { archetypes: [{ id: 'hero', components: {} }, { id: 'kart', components: { vehicle: { seats: 1, health: 100, fuel: 0 }, car: { maxSpeed: 90, accel: 14, preset: 'kart' } } }] },
    player: { archetype: 'hero', at: [1, 5, 0] },
  };
  const { rt } = compile(d, { primitives: P });
  rt.spawn('kart', { id: 'k', at: [1, 5, 0] }); rt.run([{ do: 'enter_vehicle', vehicle: 'k' }]);
  // Drive out to the far checkpoint and back to the start line, lap after lap.
  const lap = () => { for (let i = 0; i < 2000 && !rt.state.events.some(e => e.name === 'lap'); i++) { const k = rt.entity('k'), back = rt.store('gameplay.race:race').racers?.player?.next === 0; const h = k.components.drive?.heading ?? 0; rt.step({ axes: { move: [back ? (Math.cos(h) > -0.99 ? 1 : 0) : 0, 1] } }); } rt.step(); };
  lap();
  drive(rt, 10);
  assert.equal(rt.state.counts['stage_clear:cup1'], 1, 'finishing the race clears the stage');
  assert.equal(rt.doc.systems.find(s => s.use === 'gameplay.race').with.laps, 2, 'stage 2 table: two laps');
  assert.ok(rt.test({ stage: 'cup2' }));
});
