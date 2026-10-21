// engine.adapt.nested: (b) a board capture starts a creature battle whose result decides the capture,
// run headless through the real runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogue } from '../v2/primitives/index.js';
import { preflight } from '../v2/kernel/document.js';
import { createWorld } from '../v2/kernel/world.js';

const { registry, logic } = catalogue();
const won = [{ do: 'end_game', outcome: 'won' }], lost = [{ do: 'end_game', outcome: 'lost' }];
const B = (hp, atk, def, spa, spd, spe) => ({ hp, atk, def, spa, spd, spe });
const CREATURES = {
  types: { fire: { grass: 2, water: 0.5, fire: 0.5 }, water: { fire: 2, grass: 0.5 }, grass: { water: 2, fire: 0.5 }, normal: {} },
  moves: [{ id: 'tackle', name: 'Tackle', type: 'normal', category: 'physical', power: 40, accuracy: 100, pp: 35 }, { id: 'ember', name: 'Ember', type: 'fire', category: 'special', power: 40, accuracy: 100, pp: 25 }, { id: 'vine', name: 'Vine', type: 'grass', category: 'special', power: 45, accuracy: 100, pp: 25 }],
  species: [
    { id: 'sprout', name: 'Sprout', types: ['grass'], base: B(45, 49, 49, 65, 65, 45), catchRate: 45, expYield: 64, growth: 'medium', learnset: [{ level: 1, move: 'vine' }] },
    { id: 'ember_pup', name: 'Ember Pup', types: ['fire'], base: B(39, 52, 43, 60, 50, 65), catchRate: 45, expYield: 62, growth: 'medium', learnset: [{ level: 1, move: 'ember' }] },
  ],
};
// The pieces: what species each piece fights as (a value map; a skin can provide it as components.skin.id).
const AS_SPECIES = { pawn: 'sprout', rook: 'ember_pup' };
const doc = ({ party = [{ species: 'ember_pup', level: 20 }], nested = {} } = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'capture-battle', title: 'Capture battle', seed: 5,
  spaces: [{ id: 'board', use: 'engine.space.grid', with: { size: [6, 6] } }, { id: 'arena', use: 'engine.space.none', zones: [{ id: 'ring' }] }],
  systems: [
    { use: 'gameplay.combat.health' },
    { use: 'gameplay.turns', space: 'board', with: { grain: 'unit', ap: 1, movePerAp: 1, overwatch: false, hitChance: false,
      sides: [{ id: 'white', control: 'player', members: ['player'] }, { id: 'black', control: 'ai', members: ['pawn', 'rook'] }],
      // A capture does not kill by itself: it asks for a duel, whose outcome decides it.
      actions: [{ id: 'capture', range: 1, target: 'unit', los: false, ai: 0, onHit: [{ do: 'emit', event: 'capture', data: { attacker: '$actor', defender: '$target' } }] }],
      onVictory: won, onDefeat: lost } },
    { use: 'gameplay.creature.party', with: { start: party } },
    { use: 'gameplay.creature.battle', with: { space: 'arena' } },
    { use: 'engine.adapt.nested', with: { id: 'duel', on: 'capture', roles: { attacker: 'attacker', defender: 'defender' }, inner: ['gameplay.creature.battle'],
      start: [{ do: 'start_battle', kind: 'trainer', trainer: { id: 'board', name: 'The board' }, foe: [{ species: 'sprout', level: 3 }] }],
      fill: [{ path: '0.foe.0.species', role: 'defender', field: 'archetype', map: AS_SPECIES }],
      outcomes: [{ on: 'battle_end:win', result: 'captured', do: [{ do: 'kill', who: '$defender' }] }, { on: 'battle_end:lose', result: 'repelled', do: [{ do: 'kill', who: '$attacker' }] }], ...nested } },
    { use: 'engine.spawner', with: { intervalSec: 0, rules: [{ id: 'p1', archetype: 'pawn', space: 'board', at: [2, 3], unique: true, activation: 'always', respawnSec: 0 }, { id: 'r1', archetype: 'rook', space: 'board', at: [5, 5], unique: true, activation: 'always', respawnSec: 0 }] } },
  ],
  content: { ...CREATURES, archetypes: [{ id: 'knight', components: { health: { max: 1 }, turns: { side: 'white' } } }, { id: 'pawn', components: { health: { max: 1 }, turns: { side: 'black' } } }, { id: 'rook', components: { health: { max: 1 }, turns: { side: 'black' } } }] },
  player: { archetype: 'knight', space: 'board', at: [2, 2] },
});
const boot = d => { const r = preflight(d, registry, logic); assert.ok(r.ok, JSON.stringify(r.errors)); return () => createWorld(r.doc, registry, logic, { seed: 2 }); };
const codes = d => preflight(d, registry, logic).errors.map(e => e.code);
const dead = (rt, id) => !rt.entity(id) || Boolean(rt.entity(id).components.health?.dead) || rt.entity(id).components.health?.hp <= 0;

/** Capture p1, then fight with the first move until the battle ends; returns the frames spent in battle. */
function captureAndFight(rt) {
  rt.step({}); rt.step({});
  rt.step({ actions: { turn_act: { unit: 'player', action: 'capture', target: 'p1' } } });
  let frames = 0;
  while (rt.state.prim['engine.adapt.nested:duel']?.active && frames < 200) { rt.step({ actions: { battle: { kind: 'move', index: 0 } } }); rt.step({}); frames += 2; }
  return frames;
}

test('(b) a board capture starts a creature battle with the pieces carried in; winning it captures', () => {
  const rt = boot(doc())();
  rt.step({}); rt.step({});
  rt.step({ actions: { turn_act: { unit: 'player', action: 'capture', target: 'p1' } } });
  const nested = rt.state.prim['engine.adapt.nested:duel'];
  assert.ok(nested.active, 'the capture started the encounter');
  assert.deepEqual(nested.active.roles, { attacker: 'player', defender: 'p1' });
  const start = rt.state.counts['battle_start:trainer'];
  assert.equal(start, 1, 'the battle started');
  assert.equal(rt.player().space, 'arena', 'the attacker fights in the battle space');
  assert.equal(rt.modal.owner, 'engine.adapt.nested');
  assert.deepEqual(rt.modal.actions, ['battle']);
  // The outer loop is held: the black rook does not move and the turn does not advance while the duel runs.
  const rook = rt.entity('r1').at.slice(), turn = structuredClone(rt.state.prim['gameplay.turns'].current);
  for (let i = 0; i < 10; i++) rt.step({ actions: { turn_move: { unit: 'player', to: [0, 0] } } });
  assert.deepEqual(rt.entity('r1').at, rook);
  assert.deepEqual(rt.state.prim['gameplay.turns'].current, turn);
  // Fight: ember vs a grass sprout (the pawn's species, filled into start_battle).
  let frames = 0;
  while (rt.state.prim['engine.adapt.nested:duel'].active && frames < 200) { rt.step({ actions: { battle: { kind: 'move', index: 0 } } }); frames++; }
  assert.equal(rt.state.prim['engine.adapt.nested:duel'].last, 'captured');
  assert.ok(rt.state.events.some(e => e.name === 'battle_end:win') || rt.state.counts['battle_end:win'] === 1);
  assert.ok(dead(rt, 'p1'), 'the captured pawn is gone');
  assert.ok(!dead(rt, 'player'));
  assert.equal(rt.player().space, 'board', 'the attacker is back on the board');
  assert.equal(rt.modal?.owner, 'gameplay.turns', 'the turn loop has its modal back');
  // Released: the outer loop moves on (turns advance again; the rook takes its next turn).
  const turns = rt.state.counts.turn_start;
  for (let i = 0; i < 3; i++) rt.step({});
  rt.step({ actions: { end_turn: true } });
  for (let i = 0; i < 4; i++) rt.step({});
  assert.ok(rt.state.counts.turn_start > turns, 'turns advance after the duel');
  assert.notDeepEqual(rt.entity('r1').at, rook, 'the rook moves once the duel is over');
});

test('(b) losing the duel repels the capture and costs the attacker', () => {
  const rt = boot(doc({ party: [{ species: 'sprout', level: 2 }] }))();
  captureAndFight(rt);
  assert.equal(rt.state.prim['engine.adapt.nested:duel'].last, 'repelled');
  assert.ok(!dead(rt, 'p1'), 'the pawn survives');
  assert.ok(dead(rt, 'player'), 'the attacking piece is lost');
  for (let i = 0; i < 3; i++) rt.step({});
  assert.equal(rt.state.status, 'lost');
});

test('(b) the defender species is filled from the board piece', () => {
  const rt = boot(doc())();
  const foes = [];
  rt.on('battle_start', d => foes.push(...d.foe));
  captureAndFight(rt);
  assert.deepEqual(foes, ['sprout']);
});

test('(b) deterministic replay', () => {
  const make = boot(doc());
  const play = () => { const rt = make(); captureAndFight(rt); for (let i = 0; i < 20; i++) rt.step({}); return JSON.stringify(rt.snapshot()); };
  assert.equal(play(), play());
});

test('(b) preflight rejects bad encounters with stable codes', () => {
  assert.ok(codes(doc({ nested: { inner: ['gameplay.cards'] } })).includes('nested_inner_unknown'));
  assert.ok(codes(doc({ nested: { fill: [{ path: '0.foes.0.species', role: 'defender', field: 'archetype' }] } })).includes('nested_fill_path'));
  assert.ok(codes(doc({ nested: { fill: [{ path: '0.foe.0.species', role: 'victim', field: 'archetype' }] } })).includes('nested_role_unknown'));
  assert.ok(codes(doc({ nested: { fill: [{ path: '0.foe.0.species', role: 'defender', field: 'archetype', map: { pawn: 'dragon' } }] } })).includes('ref_unknown'), 'mapped values are checked like the effect');
  assert.ok(codes(doc({ nested: { carry: [{ role: 'attacker' }] } })).includes('nested_space'));
});
