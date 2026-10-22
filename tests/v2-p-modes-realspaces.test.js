// Modes primitives on the real 2D spaces (grid, none, track, tilemap), not only the test space.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../v2/kernel/testing.js';
import modes from '../v2/primitives/gameplay/modes.index.js';
import spaces2d from '../v2/primitives/engine/spaces2d.index.js';
import { stubHealth, drive } from '../v2/primitives/gameplay/modes-lib-testing.js';

const P = [...modes, ...spaces2d, stubHealth];
const base = (spaces, systems, archetypes, player) => ({ schema: 'gameverse.v2.game/0.2', id: 'real', title: 'Real spaces', seed: 9, spaces, systems, content: { archetypes }, player });

test('turns on engine.space.grid: grid paths, AP-limited moves, occupancy, line of sight shots, AI turn', () => {
  const d = base([{ id: 'board', use: 'engine.space.grid', with: { size: [8, 8] } }],
    [{ use: 'gameplay.combat.health' }, { use: 'gameplay.turns', with: { movePerAp: 3, sides: [{ id: 'player', control: 'player', members: ['player'] }, { id: 'enemy', control: 'ai' }], actions: [{ id: 'shoot', range: 4, hit: { base: 100, max: 100 }, onHit: [{ do: 'damage', who: 'target', amount: 3 }] }] } }],
    [{ id: 'hero', components: { health: { max: 10 } } }, { id: 'alien', components: { health: { max: 6 }, turns: { side: 'enemy' } } }], { archetype: 'hero', at: [1, 1] });
  const { rt } = compile(d, { primitives: P });
  rt.spawn('alien', { id: 'x1', at: [7, 1] }); rt.step();
  rt.step({ actions: { turn_move: [4, 1] } });
  assert.deepEqual(rt.player().at, [4, 1]);
  rt.step({ actions: { turn_act: { action: 'shoot', target: 'x1' } } });
  assert.equal(rt.entity('x1').components.health.hp, 3);
  drive(rt, 6);
  assert.ok(rt.state.counts['turn_action:shoot'] >= 2, 'the AI shot back on the grid');
  assert.ok(rt.test({ turn: 'player' }));
  rt.step({ actions: { turn_move: [7, 1] } });
  assert.ok(rt.state.events.some(e => e.name === 'turn_invalid' && e.reason === 'blocked'), 'cannot walk through the alien');
});

test('cards on engine.space.none: a roguelike battle with intents in slot zones', () => {
  const d = base([{ id: 'table', use: 'engine.space.none', zones: [{ id: 'hand' }, { id: 'arena' }] }],
    [{ use: 'gameplay.combat.health' }, { use: 'gameplay.turns', with: { actions: [], overwatch: false, movePerAp: 0, sides: [{ id: 'player', control: 'player', members: ['player'] }, { id: 'enemy', control: 'external' }] } }, { use: 'gameplay.cards', with: { deck: ['strike', 'strike', 'strike', 'strike', 'strike'] } }],
    [{ id: 'hero', components: { health: { max: 20 } } }, { id: 'slime', components: { health: { max: 12 }, turns: { side: 'enemy' }, cards: { intents: [{ kind: 'attack', value: 3 }] } } }], { archetype: 'hero', at: 'hand' });
  d.content.cards = [{ id: 'strike', name: 'Strike', cost: 1, type: 'attack', effects: [{ do: 'card_damage', amount: 6 }] }, { id: 'defend', name: 'Defend', cost: 1, type: 'skill', target: 'self', effects: [{ do: 'card_block', amount: 5 }] },
    { id: 'bash', name: 'Bash', cost: 2, type: 'attack', effects: [{ do: 'card_damage', amount: 9 }] }, { id: 'focus', name: 'Focus', cost: 0, type: 'skill', target: 'self', effects: [{ do: 'draw_cards', count: 1 }] }];
  const { rt } = compile(d, { primitives: P });
  rt.spawn('slime', { id: 's1', at: 'arena' }); rt.step();
  for (const c of rt.service('cards').view().hand.slice(0, 2)) rt.step({ actions: { play_card: { uid: c.uid, target: 's1' } } });
  assert.equal(rt.state.counts.turns_over, 1, 'two strikes kill the 12 hp slime');
});

test('race on engine.space.track: a looped circuit with track zones as checkpoints', () => {
  const d = base([{ id: 'rail', use: 'engine.space.track', with: { lanes: 3, length: 100, loop: true, window: [10, 60] }, zones: [{ id: 'line', range: [0, 5] }, { id: 'hairpin', range: [50, 55] }] }],
    [{ use: 'gameplay.race', with: { laps: 2, checkpoints: ['line', 'hairpin'], countdown: 0 } }],
    [{ id: 'runner', components: { body: { size: [0.8, 0.6, 1.8] } } }], { archetype: 'runner', at: [2, 1, 0] });
  const { rt } = compile(d, { primitives: P });
  rt.step();
  for (let i = 0; i < 230; i++) { const p = rt.player(); rt.space('rail').setPos(p, [p.at[0] + 1, 1, p.at[2]], rt); rt.step(); }
  assert.equal(rt.state.counts['checkpoint:hairpin'], 2);
  assert.equal(rt.state.counts['race_finished:player'], 1, 'two laps around the loop');
});

test('waves and stage.sequence on engine.space.tilemap', () => {
  const d = base([{ id: 'level', use: 'engine.space.tilemap', with: { size: [32, 16], mode: 'topdown' }, zones: [{ id: 'spawn', rect: [28, 6, 31, 10] }] }],
    [{ use: 'gameplay.combat.health' }, { use: 'gameplay.waves', with: { stagger: 0, waves: [{ spawn: [{ archetype: 'bat', count: 3, zone: 'spawn' }] }] } },
      { use: 'gameplay.stage.sequence', with: { introSec: 0, stages: [{ id: 'arena', goal: { kind: 'when', when: { wave: 'waves', cleared: 'w1' } } }] } }],
    [{ id: 'hero', components: {} }, { id: 'bat', components: { health: { max: 1 } } }], { archetype: 'hero', at: [2, 2] });
  const { rt } = compile(d, { primitives: P });
  drive(rt, 3);
  const bats = Object.values(rt.state.entities).filter(e => e.archetype === 'bat');
  assert.equal(bats.length, 3);
  assert.ok(bats.every(b => rt.test({ zone: 'spawn', who: b.id })), 'spawned in the zone');
  for (const b of bats) rt.run([{ do: 'kill', who: b.id }]);
  drive(rt, 3);
  assert.equal(rt.state.counts['stage_clear:arena'], 1);
});

test('vehicle.car on a top-down engine.space.tilemap: drives, and walls stop it (ray-probed, no slide)', () => {
  const d = base([{ id: 'town', use: 'engine.space.tilemap', with: { size: [40, 12], mode: 'topdown' } }],
    [{ use: 'gameplay.vehicle.core' }, { use: 'gameplay.vehicle.car', with: { plane: 'xy' } }],
    [{ id: 'hero', components: {} }, { id: 'kart', components: { body: { size: [1, 1] }, vehicle: { seats: 1, health: 50, fuel: 0 }, car: { maxSpeed: 60, accel: 12 } } }], { archetype: 'hero', at: [3.5, 5.5] });
  d.content.blocks = [{ id: 'brick', name: 'Brick', solid: true }];
  const { rt } = compile(d, { primitives: P });
  for (let y = 0; y < 12; y++) rt.space('town').setCell([20, y], 'brick', rt);
  rt.spawn('kart', { id: 'k', at: [4.5, 5.5] }); rt.run([{ do: 'enter_vehicle', vehicle: 'k' }]);
  drive(rt, 300, { axes: { move: [0, 1] } });
  const k = rt.entity('k');
  assert.ok(k.at[0] > 15 && k.at[0] < 20, `stopped before the wall at x=20 (x=${k.at[0]})`);
  assert.ok(rt.state.counts.crash >= 1);
});
