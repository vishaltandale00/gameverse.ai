// A nested encounter's outcome acts on the outer participants, from declarations: the inner loop declares its
// encounter outcome (card.loop.outcome: each result's effects param and each side's fate), the preset writes the
// adapter's outcomes from it (presets.js encounterOutcomes) and their outer effects from what the document declares
// (configureEncounters: card.defeats for the defeated side, the outer loop's seated groups for the player's side).
// Three unrelated outer/inner pairs, run headless through the real runtime with the real catalogue:
//   board capture -> creature battle   a piece that loses the battle is taken off the board; the winner takes its cell;
//   overworld touch -> minigame        touching a brute starts a button-mash; beating it defeats the brute;
//   door -> race                       using a door starts a race on a course; losing it defeats the runner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogue } from '../v2/primitives/index.js';
import { preflight } from '../v2/kernel/document.js';
import { createWorld } from '../v2/kernel/world.js';
import { encounterOutcomes, configureEncounters } from '../v2/planner/presets.js';

const { registry, logic } = catalogue();
const NESTED = 'engine.adapt.nested';
const SCHEMA = 'gameverse.v2.game/0.2';

/** Write the encounter's outcomes and outer effects the way the preset does, from the declarations. */
function configure(doc, { outer = null, take = false } = {}) {
  const inst = doc.systems.find(s => s.use === NESTED);
  const { outcomes, problems } = encounterOutcomes(registry, doc.systems, { id: inst.with.id, inner: inst.with.inner });
  assert.deepEqual(problems, []);
  inst.with = { ...inst.with, outcomes, ...(take ? { take } : {}) };
  assert.deepEqual(configureEncounters(doc, registry, [{ id: inst.with.id, outer }]), []);
  return doc;
}
const boot = (doc, seed = 2) => { const r = preflight(doc, registry, logic); assert.ok(r.ok, JSON.stringify(r.errors)); return createWorld(r.doc, registry, logic, { seed }); };
const dead = (rt, id) => !rt.entity(id) || Boolean(rt.entity(id).components.health?.dead) || rt.entity(id).components.health?.hp <= 0;
const encounter = (rt, id) => rt.state.prim[`${NESTED}:${id}`];

// ---------- board capture -> creature battle ----------
const B = (hp, atk, def, spa, spd, spe) => ({ hp, atk, def, spa, spd, spe });
const CREATURES = {
  types: { fire: { grass: 2, water: 0.5, fire: 0.5 }, grass: { water: 2, fire: 0.5 }, normal: {} },
  moves: [{ id: 'ember', name: 'Ember', type: 'fire', category: 'special', power: 40, accuracy: 100, pp: 25 }, { id: 'vine', name: 'Vine', type: 'grass', category: 'special', power: 45, accuracy: 100, pp: 25 }],
  species: [
    { id: 'sprout', name: 'Sprout', types: ['grass'], base: B(45, 49, 49, 65, 65, 45), catchRate: 45, expYield: 64, growth: 'medium', learnset: [{ level: 1, move: 'vine' }] },
    { id: 'ember_pup', name: 'Ember Pup', types: ['fire'], base: B(39, 52, 43, 60, 50, 65), catchRate: 45, expYield: 62, growth: 'medium', learnset: [{ level: 1, move: 'ember' }] },
  ],
};
const boardDoc = ({ party }) => configure({
  schema: SCHEMA, id: 'capture-battle', title: 'Capture battle', seed: 5,
  spaces: [{ id: 'board', use: 'engine.space.grid', with: { size: [6, 6] } }, { id: 'arena', use: 'engine.space.none', zones: [{ id: 'ring' }] }],
  systems: [
    { use: 'gameplay.combat.health' },
    { use: 'gameplay.turns', space: 'board', with: { grain: 'side', ap: 1, movePerAp: 1, overwatch: false, hitChance: false,
      sides: [{ id: 'white', control: 'player', members: ['player'] }, { id: 'black', control: 'ai', members: ['pawn'] }],
      actions: [{ id: 'capture', range: 1, target: 'unit', los: false, ai: 0, onHit: [{ do: 'emit', event: 'capture', data: { attacker: '$actor', defender: '$target' } }] }] } },
    { use: 'gameplay.creature.party', with: { start: party } },
    { use: 'gameplay.creature.battle', with: { space: 'arena' } },
    { use: NESTED, with: { id: 'duel', on: 'capture', roles: { attacker: 'attacker', defender: 'defender' }, inner: ['gameplay.creature.battle'],
      start: [{ do: 'start_battle', kind: 'trainer', trainer: { id: 'board', name: 'The board' }, foe: [{ species: 'sprout', level: 3 }] }] } },
    { use: 'engine.spawner', with: { intervalSec: 0, rules: [
      { id: 'p1', archetype: 'pawn', space: 'board', at: [3, 3], unique: true, activation: 'always', respawnSec: 0 },
      { id: 'k2', archetype: 'squire', space: 'board', at: [3, 2], unique: true, activation: 'always', respawnSec: 0 }] } },
  ],
  content: { ...CREATURES, archetypes: [{ id: 'knight', components: { health: { max: 1 }, turns: { side: 'white' } } }, { id: 'squire', components: { health: { max: 1 }, turns: { side: 'white' } } }, { id: 'pawn', components: { health: { max: 1 }, turns: { side: 'black' } } }] },
  player: { archetype: 'knight', space: 'board', at: [0, 0] },
}, { outer: 'gameplay.turns', take: true });

function capture(rt, unit) {
  // Pieces placed after the first turn began act from the side's next turn.
  rt.step({}); rt.step({}); rt.step({ actions: { end_turn: true } });
  for (let i = 0; i < 20 && rt.state.prim['gameplay.turns'].current?.side !== 'white'; i++) rt.step({});
  rt.step({ actions: { turn_act: { unit, action: 'capture', target: 'p1' } } });
  assert.ok(encounter(rt, 'duel').active, 'the capture started the battle');
  for (let i = 0; encounter(rt, 'duel').active && i < 200; i++) { rt.step({ actions: { battle: { kind: 'move', index: 0 } } }); rt.step({}); }
}

test('board capture -> creature battle: the preset wrote outcomes from the battle declaration and the board', () => {
  const nested = boardDoc({ party: [{ species: 'ember_pup', level: 20 }] }).systems.find(s => s.use === NESTED).with;
  assert.deepEqual(nested.outcomes.map(o => [o.result, o.fates.player, o.fates.opponent]), [['won', 'keeps', 'defeated'], ['lost', 'defeated', 'keeps'], ['fled', 'keeps', 'keeps'], ['caught', 'keeps', 'defeated']]);
  assert.deepEqual(nested.outcomes.map(o => o.do), [[{ do: 'kill', who: '$loser' }], [{ do: 'kill', who: '$loser' }], [], [{ do: 'kill', who: '$loser' }]]);
  assert.deepEqual(nested.player, { component: 'turns', field: 'side', is: ['white'] });
});

test('board capture -> creature battle: the player\'s other piece wins the battle, takes the pawn off the board and its cell', () => {
  const rt = boot(boardDoc({ party: [{ species: 'ember_pup', level: 20 }] }));
  const cell = () => rt.entity('p1').at.slice();
  rt.step({});
  const pawnAt = cell();
  // The squire is not the player: it plays the battle on the player's side because it belongs to a white side.
  capture(rt, 'k2');
  assert.equal(encounter(rt, 'duel').last, 'won');
  assert.ok(dead(rt, 'p1'), 'the defeated pawn is out of play on the board');
  assert.ok(!dead(rt, 'k2'));
  assert.deepEqual(rt.entity('k2').at, pawnAt, 'the winner takes the captured cell');
});

test('board capture -> creature battle: losing the battle takes the attacking piece off the board', () => {
  const rt = boot(boardDoc({ party: [{ species: 'sprout', level: 2 }] }));
  capture(rt, 'k2');
  assert.equal(encounter(rt, 'duel').last, 'lost');
  assert.ok(dead(rt, 'k2'), 'the attacker lost and is out of play');
  assert.ok(!dead(rt, 'p1'), 'the pawn keeps its place');
});

// ---------- overworld touch -> minigame ----------
const fieldDoc = ({ timeSec = 0 } = {}) => configure({
  schema: SCHEMA, id: 'touch-brawl', title: 'Touch brawl', seed: 3,
  spaces: [{ id: 'field', use: 'engine.space.grid', with: { size: [8, 8] } }],
  systems: [
    { use: 'gameplay.combat.health' },
    { use: 'gameplay.minigame', with: { games: [{ id: 'brawl', kind: 'mash', timeSec, mash: { target: 3, decay: 0, perPress: 1 } }] } },
    // Touching the brute (its contact damage on the player) starts the brawl; the hurt player and the brute take part.
    { use: NESTED, with: { id: 'brawl', on: 'damaged', roles: { hero: 'who', brute: 'by' }, inner: ['gameplay.minigame'], start: [{ do: 'start_minigame', game: 'brawl' }] } },
    { use: 'engine.spawner', with: { intervalSec: 0, rules: [{ id: 'b1', archetype: 'brute', space: 'field', at: [3, 3], unique: true, activation: 'always', respawnSec: 0 }] } },
  ],
  content: { archetypes: [{ id: 'hero', components: { health: { max: 5 } } }, { id: 'brute', components: { health: { max: 5 }, touch: { damage: 1 } } }] },
  player: { archetype: 'hero', space: 'field', at: [3, 3] },
});

test('overworld touch -> minigame: beating the brawl defeats the brute in the overworld', () => {
  const nested = fieldDoc().systems.find(s => s.use === NESTED).with;
  assert.equal(nested.player, undefined, 'no outer groups: only the player is on the player\'s side');
  const rt = boot(fieldDoc());
  for (let i = 0; i < 5 && !encounter(rt, 'brawl')?.active; i++) rt.step({});
  assert.deepEqual(encounter(rt, 'brawl').active.roles, { hero: 'player', brute: 'b1' });
  for (let i = 0; i < 10 && encounter(rt, 'brawl').active; i++) rt.step({ actions: { mg_press: true } });
  assert.equal(rt.state.prim['gameplay.minigame'].results.brawl, 'won', 'three presses filled the meter');
  assert.equal(encounter(rt, 'brawl').last, 'won');
  assert.ok(dead(rt, 'b1'), 'the brute is defeated by the outcome (the minigame never touched its health)');
  assert.ok(!dead(rt, 'player'));
});

test('overworld touch -> minigame: running out of time defeats the player in the overworld', () => {
  const rt = boot(fieldDoc({ timeSec: 0.2 }));
  for (let i = 0; i < 40 && encounter(rt, 'brawl')?.last === undefined; i++) rt.step({});
  assert.equal(encounter(rt, 'brawl').last, 'lost');
  assert.ok(dead(rt, 'player'), 'the player is out of play');
  assert.ok(!dead(rt, 'b1'), 'the brute keeps its place');
});

// ---------- door -> race ----------
const LAP = []; for (let x = 1; x <= 11; x++) LAP.push([x, 1]); for (let y = 2; y <= 11; y++) LAP.push([11, y]); for (let x = 10; x >= 1; x--) LAP.push([x, 11]); for (let y = 10; y >= 1; y--) LAP.push([1, y]);
const doorDoc = () => configure({
  schema: SCHEMA, id: 'door-race', title: 'Door race', seed: 4,
  spaces: [{ id: 'yard', use: 'engine.space.grid', with: { size: [6, 6] } },
    { id: 'course', use: 'engine.space.grid', with: { size: [13, 13] }, zones: [{ id: 'start', rect: [0, 0, 3, 3] }, { id: 'east', rect: [10, 0, 13, 3] }, { id: 'north', rect: [10, 10, 13, 13] }, { id: 'west', rect: [0, 10, 3, 13] }] }],
  systems: [
    { use: 'gameplay.combat.health' },
    { use: 'gameplay.interact' },
    { use: 'gameplay.race', space: 'course', with: { autoStart: false, countdown: 0, laps: 1, checkpoints: ['start', 'east', 'north', 'west'], racers: ['rival'] } },
    // Using the door starts a race on the course: the runner is carried there and back; the door poses the challenge.
    { use: NESTED, with: { id: 'gate', on: 'interacted', roles: { runner: 'who', door: 'target' }, inner: ['gameplay.race'], space: 'course', carry: [{ role: 'runner', at: [1, 1] }], start: [{ do: 'start_race' }] } },
    { use: 'engine.spawner', with: { intervalSec: 0, rules: [
      { id: 'd1', archetype: 'door', space: 'yard', at: [2, 3], unique: true, activation: 'always', respawnSec: 0 },
      { id: 'r1', archetype: 'rival', space: 'course', at: [1, 1], unique: true, activation: 'always', respawnSec: 0 }] } },
  ],
  content: { archetypes: [{ id: 'runner', components: { health: { max: 3 } } }, { id: 'door', components: { health: { max: 1 }, interact: { prompt: 'Race for the gate', kind: 'use' } } }, { id: 'rival', components: {} }] },
  player: { archetype: 'runner', space: 'yard', at: [2, 2] },
});
/** Drive the racers round the lap: `every` steps per waypoint for each. */
function race(rt, speeds) {
  const t = {};
  for (let i = 0; i < 600 && encounter(rt, 'gate').active; i++) {
    for (const [id, every] of Object.entries(speeds)) { const e = rt.entity(id); if (e?.space === 'course' && i % every === 0) { t[id] = (t[id] ?? 0) + 1; rt.space('course').setPos(e, LAP[t[id] % LAP.length], rt); } }
    rt.step({});
  }
}
function enterDoor(rt) {
  rt.step({}); rt.step({ actions: { interact: true } }); rt.step({});
  assert.ok(encounter(rt, 'gate').active, 'using the door started the race');
  assert.equal(rt.player().space, 'course', 'the runner races on the course');
}

test('door -> race: winning the race defeats the door; the runner comes back to the yard', () => {
  const rt = boot(doorDoc());
  enterDoor(rt);
  race(rt, { player: 1, r1: 3 });
  assert.equal(encounter(rt, 'gate').last, 'won');
  assert.ok(dead(rt, 'd1'), 'the door is out of play');
  assert.equal(rt.player().space, 'yard');
  assert.ok(!dead(rt, 'player'));
});

test('door -> race: losing the race defeats the runner; the door stands', () => {
  const rt = boot(doorDoc());
  enterDoor(rt);
  race(rt, { player: 3, r1: 1 });
  assert.equal(encounter(rt, 'gate').last, 'lost');
  assert.ok(dead(rt, 'player'), 'the runner is out of play');
  assert.ok(!dead(rt, 'd1'));
});
