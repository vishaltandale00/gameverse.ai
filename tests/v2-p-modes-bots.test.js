// Game modes (card.mode) and their bots: every mode a card declares names a
// bot in v2/verify/strategies, and that bot wins a minimal valid document of
// the mode through the real runtime, deterministically. Strategy selection
// prefers the bots a document's modes name over detection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { primitives } from '../v2/primitives/plot/story-testkit.js';
import { manor, withExitGate } from '../v2/primitives/plot/story-testkit.js';
import { preflight } from '../v2/kernel/document.js';
import { maker } from '../v2/verify/drive.js';
import { usedPrimitives, stateHash } from '../v2/verify/util.js';
import { strategies, select } from '../v2/verify/strategies/index.js';
import { replayMacros } from '../v2/verify/strategies/turn-board.js';
import { replayRace } from '../v2/verify/strategies/race.js';
import { modeCatalogue, liveCatalogue } from '../v2/planner/catalog.js';
import { modeShapeErrors, modesIn, modeApplies } from '../v2/primitives/gameplay/modes-lib-mode.js';
import { interactionsOf, appliesTo } from '../v2/planner/loop.js';
import { fitsInteraction } from '../v2/planner/select.js';
import { checkComposition } from '../v2/planner/compose-check.js';

// The live catalogue (promoted primitives included, with the reference test space): every card.mode is held to these checks.
const { registry, logic } = await liveCatalogue({ base: primitives() });
const ctxOf = doc => {
  const r = preflight(doc, registry, logic);
  assert.ok(r.ok, JSON.stringify(r.errors));
  const make = maker(r.doc, registry, logic);
  return { doc: r.doc, registry, logic, make, seed: 1, capabilities: r.capabilities, used: usedPrimitives(r.doc), playerSpace: make(1).player()?.space ?? r.doc.spaces[0].id };
};
const base = (id, spaces, systems, content, extra = {}) => ({ schema: 'gameverse.v2.game/0.2', id, title: id, seed: 9, spaces, systems, content, ...extra });
const spawn = rules => ({ use: 'engine.spawner', with: { intervalSec: 0, rules: rules.map(r => ({ unique: true, activation: 'always', respawnSec: 0, ...r })) } });
const won = [{ do: 'end_game', outcome: 'won' }], lost = [{ do: 'end_game', outcome: 'lost' }];
const board = (w, h) => ({ name: 'board', at: [0, 0], size: [w, h], axes: [0, 1], fall: -1 });
const grid = (id, w, h, systems, extra = {}) => base(id, [{ id: 'g', use: 'engine.space.grid', with: { size: [w, h] } }], systems, { archetypes: [] }, extra);

// ---------- one minimal document per mode ----------
const DOCS = {
  tactics: () => base('tactics', [{ id: 'board', use: 'engine.space.grid', with: { size: [8, 8] } }],
    [{ use: 'gameplay.combat.health' }, { use: 'gameplay.turns', with: { movePerAp: 3, sides: [{ id: 'player', control: 'player', members: ['player'] }, { id: 'enemy', control: 'ai', members: ['alien'] }], actions: [{ id: 'shoot', range: 4, hit: { base: 75 }, onHit: [{ do: 'damage', who: 'target', amount: 3 }] }], onVictory: won, onDefeat: lost } },
      spawn([{ id: 'x1', archetype: 'alien', at: [6, 5] }, { id: 'x2', archetype: 'alien', at: [6, 2] }])],
    { archetypes: [{ id: 'hero', components: { health: { max: 12 } } }, { id: 'alien', components: { health: { max: 6 }, turns: { side: 'enemy' } } }] }, { player: { archetype: 'hero', at: [1, 1] } }),
  'card-battle': () => base('cards', [{ id: 'table', use: 'engine.space.none', zones: [{ id: 'hand' }, { id: 'arena' }] }],
    [{ use: 'gameplay.combat.health' }, { use: 'gameplay.turns', with: { actions: [], overwatch: false, movePerAp: 0, sides: [{ id: 'player', control: 'player', members: ['player'] }, { id: 'enemy', control: 'external', members: ['slime'] }], onVictory: won, onDefeat: lost } },
      { use: 'gameplay.cards', with: { deck: ['strike', 'strike', 'strike', 'defend', 'defend'] } }, { use: 'plot.character' }],
    { archetypes: [{ id: 'hero', components: { health: { max: 20 } } }, { id: 'slime', components: { health: { max: 24 }, cards: { intents: [{ kind: 'attack', value: 5 }, { kind: 'attack', value: 8 }] } } }],
      cards: [{ id: 'strike', name: 'Strike', cost: 1, type: 'attack', effects: [{ do: 'card_damage', amount: 6 }] }, { id: 'defend', name: 'Defend', cost: 1, type: 'skill', target: 'self', effects: [{ do: 'card_block', amount: 5 }] }] },
    { plot: { characters: [{ id: 's1', name: 'Slime', archetype: 'slime', home: 'arena' }] }, player: { archetype: 'hero', at: 'hand' } }),
  rts: () => {
    const marine = { health: { max: 6 }, rts: { speed: 4, sight: 8, attack: { range: 3, cooldown: 0.5, effects: [{ do: 'damage', who: 'target', amount: 2 }] } } };
    return base('rts', [{ id: 'field', use: 'engine.space.grid', with: { size: [24, 24] } }],
      [{ use: 'gameplay.combat.health' }, { use: 'gameplay.rts', with: { factions: [{ id: 'blue', control: 'player', start: { minerals: 60 } }, { id: 'red', control: 'ai' }], ai: { attackAt: 9, workers: 0 }, onVictory: won, onDefeat: lost } },
        spawn([{ id: 'hq', archetype: 'base', at: [2, 2], components: { rts: { building: true, faction: 'blue', sight: 8, produces: [{ archetype: 'marine', cost: { minerals: 30 }, time: 1 }] } } },
          { id: 'b1', archetype: 'marine', at: [3, 4], components: { rts: { ...marine.rts, faction: 'blue' } } },
          { id: 'r1', archetype: 'marine', at: [18, 18], components: { rts: { ...marine.rts, faction: 'red' } } }, { id: 'r2', archetype: 'marine', at: [19, 18], components: { rts: { ...marine.rts, faction: 'red' } } }])],
      { archetypes: [{ id: 'marine', components: marine }, { id: 'base', components: { health: { max: 30 }, rts: { building: true } } }] });
  },
  launcher: () => base('sling', [{ id: 'f', use: 'engine.space.test', with: { size: [40, 20, 1], gravity: 10 } }],
    [{ use: 'gameplay.launcher', with: { mode: 'sling', origin: [2, 3], forward: [1, 0], aim: [-0.5, 1.4], speed: 22, shots: [{ archetype: 'bird', count: 3 }], motion: 'self', onEmpty: lost } },
      { use: 'gameplay.destructible' }, { use: 'plot.ending' }, spawn([{ id: 'g1', archetype: 'glass_block', at: [15, 0, 0] }, { id: 'g2', archetype: 'glass_block', at: [24, 0, 0] }])],
    { archetypes: [{ id: 'hero', components: {} }, { id: 'bird', kind: 'projectile', components: { body: { size: [0.8, 0.8, 1] } } }, { id: 'shard', components: { body: { size: [0.2, 0.2, 1] } } }, { id: 'glass_block', components: { body: { size: [1, 2, 1] }, destructible: { material: 'glass' } } }] },
    { plot: { endings: [{ id: 'smashed', title: 'Smashed', when: { count: 'destroyed:glass', gte: 2 }, outcome: 'won' }] }, player: { archetype: 'hero', at: [1, 1, 0] } }),
  race: () => base('race', [{ id: 'track', use: 'engine.space.arena2d', with: { size: [64, 32] }, zones: [{ id: 'start', rect: [2, 10, 8, 22] }, { id: 'turn', rect: [50, 10, 58, 22] }] }],
    [{ use: 'gameplay.vehicle.core' }, { use: 'gameplay.vehicle.car', with: { plane: 'xy' } },
      { use: 'gameplay.race', with: { laps: 1, checkpoints: ['start', 'turn'], racers: ['rival'], countdown: 1, timeLimit: 90, onWin: won, onLose: lost } },
      spawn([{ id: 'car1', archetype: 'coupe', at: [6, 16] }, { id: 'r1', archetype: 'rival', at: [4, 12] }])],
    { archetypes: [{ id: 'hero', components: { body: { size: [0.8, 0.8, 1] } } }, { id: 'rival', components: { body: { size: [0.8, 0.8, 1] } } },
      { id: 'coupe', kind: 'vehicle', components: { vehicle: { seats: 1, health: 100, fuel: 0 }, car: { maxSpeed: 40, accel: 12, grip: 1, steer: 40 }, body: { size: [1.6, 1, 1] } } }] },
    { player: { archetype: 'hero', at: [5, 16] } }),
  'ball-sport': () => base('football', [{ id: 'pitch', use: 'engine.space.arena2d', with: { size: [30, 16] }, zones: [{ id: 'left_goal', rect: [0, 5, 1.5, 11] }, { id: 'right_goal', rect: [28.5, 5, 30, 11] }] }],
    [{ use: 'gameplay.move.walk' },
      { use: 'gameplay.sports', with: { ball: 'ball', ballAt: [15, 8], periodSec: 30, periods: 1, overtime: 'none', kickoffSec: 0.5, resetSec: 0.5, physics: 'own',
        teams: [{ id: 'blue', members: ['player'], kickoff: [[10, 8]] }, { id: 'red', members: ['rival'], kickoff: [[22, 4]] }], goals: [{ zone: 'right_goal', scores: 'blue' }, { zone: 'left_goal', scores: 'red' }] } },
      spawn([{ id: 'r1', archetype: 'rival', at: [22, 4] }])],
    { archetypes: [{ id: 'hero', components: { body: { size: [1, 1] } } }, { id: 'rival', components: { body: { size: [1, 1] } } }, { id: 'ball', components: { body: { size: [0.5, 0.5] } } }] },
    { player: { archetype: 'hero', at: [10, 8] } }),
  versus: () => {
    const strike = { name: 'Strike', damage: 3, reach: 1.2, arc: 100, startup: 8, active: 6, recovery: 14, hitstun: 18, units: 'world' };
    return base('duel', [{ id: 'ring', use: 'engine.space.arena2d', with: { size: [16, 8], gravity: -30 } }],
      [{ use: 'gameplay.combat.health', with: { iframes: 0 } }, { use: 'gameplay.move.walk' }, { use: 'gameplay.combat.melee' }, { use: 'gameplay.ai.brain', with: { tick: 0.1 } }, { use: 'gameplay.ai.attacks' },
        { use: 'gameplay.rounds', with: { fighters: ['player', 'brute'], bestOf: 1, roundSec: 60, introSec: 0.5, fightCallSec: 0.3, koSec: 0.5, roundEndSec: 0.5, spawns: [[4, 0.8], [11, 0.8]], endGame: true } },
        spawn([{ id: 'cpu', archetype: 'brute', at: [11, 0.8] }])],
      { archetypes: [{ id: 'hero', components: { health: { max: 30 }, melee: { moves: { w1: strike } }, body: { size: [0.8, 1.6], facing: 1 } } },
        { id: 'brute', components: { health: { max: 12 }, body: { size: [0.8, 1.6], facing: -1 }, ai: { brain: [{ do: 'chase', target: 'player' }], speed: 2, perception: { sight: 40, fov: 360, memory: 5 } }, attacks: [{ id: 'bite', range: 1.2, windup: 0.5, active: 0.2, recover: 0.3, cooldown: 1, damage: 2 }] } }] },
      { player: { archetype: 'hero', at: [4, 0.8] } });
  },
  'creature-battle': () => {
    const B = (hp, atk, def, spa, spd, spe) => ({ hp, atk, def, spa, spd, spe });
    return base('monsters', [{ id: 'town', use: 'engine.space.grid', with: { size: [6, 6] } }, { id: 'arena', use: 'engine.space.none', zones: [{ id: 'ring' }] }],
      [{ use: 'gameplay.inventory', with: { start: [{ item: 'tonic', count: 2 }] } }, { use: 'gameplay.creature.party', with: { start: [{ species: 'sprout', level: 8 }] } },
        { use: 'gameplay.creature.battle', with: { space: 'arena', onWin: won, onLose: lost } }, { use: 'plot.storyboard' }],
      { types: { fire: { grass: 2, water: 0.5, fire: 0.5 }, water: { fire: 2, grass: 0.5 }, grass: { water: 2, fire: 0.5 }, normal: {} },
        moves: [{ id: 'tackle', name: 'Tackle', type: 'normal', category: 'physical', power: 40, accuracy: 100, pp: 35 }, { id: 'growl', name: 'Growl', type: 'normal', category: 'status', power: 0, accuracy: 100, pp: 40, effect: { kind: 'stat', stat: 'atk', stages: -1, target: 'foe' } },
          { id: 'vine', name: 'Vine', type: 'grass', category: 'special', power: 45, accuracy: 100, pp: 25 }, { id: 'ember', name: 'Ember', type: 'fire', category: 'special', power: 40, accuracy: 100, pp: 25 }],
        species: [{ id: 'sprout', name: 'Sprout', types: ['grass'], base: B(45, 49, 49, 65, 65, 45), catchRate: 45, expYield: 64, growth: 'medium', learnset: [{ level: 1, move: 'tackle' }, { level: 3, move: 'growl' }, { level: 7, move: 'vine' }] },
          { id: 'ember_pup', name: 'Ember Pup', types: ['fire'], base: B(39, 52, 43, 60, 50, 65), catchRate: 45, expYield: 62, growth: 'medium', learnset: [{ level: 1, move: 'tackle' }, { level: 4, move: 'ember' }] }],
        items: [{ id: 'tonic', name: 'Tonic', creature: { kind: 'heal', value: 20 } }], archetypes: [{ id: 'hero', components: {} }] },
      { plot: { storyboard: { acts: [{ id: 'a1', beats: [{ id: 'rival', do: [{ do: 'start_battle', kind: 'trainer', trainer: { id: 'kit', name: 'Kit' }, foe: [{ species: 'ember_pup', level: 6 }] }] }] }] } }, player: { archetype: 'hero', space: 'town', at: [1, 1] } });
  },
  'falling-blocks': () => grid('falling', 10, 22, [{ use: 'gameplay.falling.pieces', with: { board: board(10, 22), clearFrames: 0, next: 1 } }, { use: 'plot.ending' }],
    { plot: { endings: [{ id: 'cleared', title: 'Lines cleared', when: { var: 'falling.lines', gte: 2 }, outcome: 'won' }] } }),
  'match-board': () => grid('match', 6, 6, [{ use: 'gameplay.match', with: { board: board(6, 6), moves: 12, clearFrames: 0, settleFrames: 0, swapFrames: 0 } }, { use: 'plot.ending' }],
    { plot: { endings: [{ id: 'scored', title: 'Score', when: { var: 'score', gte: 600 }, outcome: 'won' }] } }),
  'slide-merge': () => grid('slide', 4, 4, [{ use: 'gameplay.slide.merge', with: { board: board(4, 4), slideFrames: 0, target: 32, onTarget: won } }]),
  collect: () => {
    const pellets = [];
    for (let x = 0; x < 7; x++) for (let y = 0; y < 7; y++) if ((x + y) % 2 === 1 && !([2, 4].includes(x) && [2, 4].includes(y))) pellets.push([x, y]);
    return base('maze', [{ id: 'maze', use: 'engine.space.grid', with: { size: [9, 7] } }],
      [{ use: 'gameplay.move.grid' }, { use: 'gameplay.combat.health' }, { use: 'gameplay.ai.brain', with: { tick: 0.1 } },
        { use: 'gameplay.collectible', with: { counters: [{ id: 'pellet', total: pellets.length, clearsLevel: true, onComplete: won }] } },
        { use: 'engine.spawner', with: { intervalSec: 0, rules: [{ id: 'pellets', archetype: 'pellet', at: pellets, count: [pellets.length, pellets.length], activation: 'always', respawnSec: 0 }, { id: 'ghost', archetype: 'ghost', at: [8, 6], unique: true, activation: 'always', respawnSec: 0 }] } }],
      { archetypes: [{ id: 'hero', components: { health: { max: 1 } } }, { id: 'pellet', components: { collectible: { counter: 'pellet' } } },
        { id: 'ghost', components: { ai: { brain: [{ do: 'patrol', route: [[8, 6], [8, 0]] }], speed: 1, perception: { sight: 40, fov: 360, memory: 5 } }, touch: { damage: 1 } } }] },
      { player: { archetype: 'hero', at: [0, 0] } });
  },
  story: () => withExitGate(manor()),
  crawl: () => base('crawl', [{ id: 'd', use: 'engine.space.grid', with: { size: [24, 24], exclusive: true },
    generators: [{ use: 'engine.generate.dungeon.rooms', with: { rooms: 3, keys: ['key_1'], roomSize: [5, 5], boss: 'ogre' } }] }],
    [{ use: 'gameplay.move.grid' }, { use: 'gameplay.combat.health' }, { use: 'gameplay.combat.melee' },
      { use: 'gameplay.combat.boss', with: { bosses: [{ id: 'ogre', archetype: 'ogre', start: 'sight', phases: [{ at: 1 }], onDefeat: won }] } }],
    { archetypes: [{ id: 'hero', components: { health: { max: 10 }, melee: { moves: { w1: { name: 'Sweep', damage: 2, reach: 1.2, arc: 360, startup: 6, active: 6, recovery: 12, units: 'world' } } } } },
      { id: 'ogre', kind: 'boss', components: { health: { max: 6 } } }, { id: 'key', components: {} }, { id: 'locked_door', components: {} }, { id: 'chest', components: {} }],
    items: [{ id: 'key_1', name: 'Key' }], blocks: [{ id: 'stone', solid: true }, { id: 'locked_door', solid: true }] }, { player: { archetype: 'hero' } }),
  farm: () => base('farm', [{ id: 'plot', use: 'engine.space.grid', with: { size: [6, 5] }, generators: [{ use: 'engine.generate.grid.board', with: { kind: 'tactics', terrain: [{ block: 'dirt' }], density: 0.8, symmetry: 'none', teams: 1, deployDepth: 1 } }] }],
    [{ use: 'gameplay.move.grid' }, { use: 'gameplay.inventory', with: { start: [{ item: 'hoe' }, { item: 'bean_seed', count: 2 }, { item: 'leek_seed', count: 1 }] } },
      { use: 'gameplay.farming', with: { crops: [{ item: 'bean', seed: 'bean_seed', days: 1 }, { item: 'leek', seed: 'leek_seed', days: 2 }], tillable: ['dirt'], daySec: 2 } }, { use: 'plot.ending' }],
    { items: [{ id: 'hoe', name: 'Hoe', kind: 'tool', tool: { kind: 'hoe', tier: 0 } }, { id: 'bean_seed', name: 'Bean seed', kind: 'material' }, { id: 'bean', name: 'Bean', kind: 'food' }, { id: 'leek_seed', name: 'Leek seed', kind: 'material' }, { id: 'leek', name: 'Leek', kind: 'food' }],
      blocks: [{ id: 'dirt', name: 'Dirt', solid: false }, { id: 'farmland', name: 'Farmland', solid: false }], archetypes: [{ id: 'hero', components: {} }] },
    { plot: { endings: [{ id: 'harvest', title: 'Harvest', when: { count: 'harvested', gte: 3 }, outcome: 'won' }] }, player: { archetype: 'hero', at: [0, 0] } }),
  platformer: () => base('platformer', [{ id: 'lvl', use: 'engine.space.tilemap', with: { size: [40, 10], mode: 'side' }, zones: [{ id: 'near', rect: [0, 0, 20, 10] }, { id: 'far', rect: [20, 0, 40, 10] }],
    generators: [{ use: 'engine.generate.tilemap.rooms', with: { movement: { jumpHeight: 3, jumpDistance: 4 }, rooms: [{ id: 'near', zone: 'near', rect: [0, 0, 20, 10], platforms: 0, exits: [{ side: 'r' }] },
      { id: 'far', zone: 'far', rect: [20, 0, 40, 10], gaps: 1, hazards: ['spikes'], platforms: 1, exits: [{ side: 'l' }], features: [{ kind: 'spawn', ref: 'flag', at: [37, 3] }] }] } }] }],
    [{ use: 'gameplay.move.platformer' }, { use: 'gameplay.combat.health' }, { use: 'gameplay.hazard', with: { types: [{ id: 'spikes', damage: 1 }] } }, { use: 'gameplay.goal', with: { onReach: won } }],
    { archetypes: [{ id: 'hero', components: { health: { max: 3 }, body: { size: [0.8, 0.95] } } }, { id: 'flag', components: { goal: true, body: { size: [1, 2] } } }],
      blocks: [{ id: 'stone', solid: true }, { id: 'plank', solid: true }, { id: 'spikes', solid: false, tags: ['hazard'], hazard: 'spikes' }] }, { player: { archetype: 'hero', at: [2, 3] } }),
  runner: () => base('runner', [{ id: 'run', use: 'engine.space.tilemap', with: { size: [256, 8], mode: 'side' },
    generators: [{ use: 'engine.generate.chunks', with: { chunks: [{ id: 'hop', rows: ['..o...', '......', '..#..^'] }], along: 'columns', axis: 'x', cross: 'y', origin: [0, 0], firstAt: 8,
      legend: { '.': {}, '#': { block: 'crate', blocks: true }, '^': { block: 'spikes', hazard: true }, o: { archetype: 'coin' } }, gap: { base: 4, min: 3 }, goal: 50, onGoal: won } }] }],
    [{ use: 'gameplay.move.platformer', with: { preset: 'runner' } }, { use: 'gameplay.combat.health' }, { use: 'gameplay.hazard', with: { types: [{ id: 'spikes', damage: 1 }] } }],
    { archetypes: [{ id: 'hero', components: { health: { max: 1 }, body: { size: [0.7, 1.1] } } }, { id: 'coin', components: { body: { size: [0.6, 0.6] } } }],
      blocks: [{ id: 'crate', solid: true }, { id: 'spikes', solid: false, hazard: 'spikes' }] }, { player: { archetype: 'hero', at: [2, 0.55] } }),
  waves: () => base('shooter', [{ id: 'sky', use: 'engine.space.arena2d', with: { size: [200, 300], edges: { left: 'open', right: 'open', bottom: 'open', top: 'open' }, cull: ['projectile'], solids: [[0, 140, 12, 160]] } }],
    [{ use: 'gameplay.move.ship', with: { mode: 'eightway', speed: 190, heading: 90, margin: 10 } }, { use: 'gameplay.combat.health' },
      { use: 'gameplay.combat.projectile', with: { weapons: [{ id: 'blaster', preset: 'shot' }], playerWeapon: 'blaster' } },
      { use: 'gameplay.ai.motion', with: { down: [0, -1], bounds: { min: [0, 0], max: [200, 300] }, edges: 'exit', speed: 40 } },
      { use: 'gameplay.waves', with: { mustClear: true, stagger: 0.2, lanes: [{ id: 'top', at: [100, 280] }],
        waves: [{ id: 'w1', spawn: [{ archetype: 'drone', count: 3, lane: 'top', pattern: 'line', spacing: 40 }] }, { id: 'w2', delay: 0.5, spawn: [{ archetype: 'drone', count: 2, lane: 'top', pattern: 'line', spacing: 60 }] }], onComplete: won } }],
    { archetypes: [{ id: 'ship', components: { body: { size: [14, 14] }, health: { max: 3 } } },
      { id: 'drone', kind: 'enemy', components: { body: { size: [16, 16] }, health: { max: 2 }, touch: { damage: 1 }, motion: { kind: 'straight', speed: 40 } } }] },
    { player: { archetype: 'ship', at: [100, 30] } }),
  levels: () => grid('levels', 10, 22, [{ use: 'gameplay.falling.pieces', with: { board: board(10, 22), clearFrames: 0, next: 1 } },
    { use: 'gameplay.stage.sequence', with: { introSec: 0, clearSec: 0.1, stages: [{ id: 'l1', goal: { kind: 'lines', target: 1 } }, { id: 'l2', goal: { kind: 'lines', target: 1 } }] } }]),
};
// The interactions a mode is played in (card.mode.interaction, one or a set): a mode declared for more than one has a
// minimal document here for each other one, played that way (its locomotion fits it: select.js fitsInteraction).
const withMove = (doc, move) => ({ ...doc, systems: doc.systems.map(s => (/^gameplay\.move\./.test(s.use) ? { use: move } : s)) });
const PLAYED_AS = {
  collect: { 'avatar-realtime': () => withMove(DOCS.collect(), 'gameplay.move.walk') },
  story: { 'avatar-grid': () => base('shrine', [{ id: 'g', use: 'engine.space.grid', with: { size: [12, 6] }, zones: [{ id: 'home', rect: [0, 0, 4, 6] }, { id: 'shrine', rect: [8, 0, 12, 6] }] }],
    [{ use: 'gameplay.move.grid' }, { use: 'plot.storyboard', with: { sequentialActs: false } }, { use: 'plot.ending' }], { archetypes: [{ id: 'hero', components: {} }] },
    { plot: { storyboard: { acts: [{ id: 'a', beats: [{ id: 'b_shrine', when: { zone: 'shrine' }, do: [{ do: 'set_var', var: 'prayed', value: 1 }] }] }] }, endings: [{ id: 'blessed', title: 'Blessed', when: { beat: 'b_shrine' }, outcome: 'won', epilogue: '.' }] },
      player: { archetype: 'hero', space: 'g', at: [1, 1] } }) },
  farm: { 'avatar-realtime': () => withMove(DOCS.farm(), 'gameplay.move.walk') },
};
const docFor = (loop, interaction) => PLAYED_AS[loop]?.[interaction] ?? DOCS[loop];
// Fast settings per bot (a few seeds, shallow searches).
const OPTS = {
  'turn-board': { seeds: [1] }, race: {}, striker: {}, versus: { seeds: [1, 2] }, balance: { seeds: [1, 2, 3] },
  placement: { seeds: [1], depth: 1, pieces: 60 }, greedy: { seeds: [1] }, expectimax: { seeds: [1], depth: 1, samples: 2 }, 'danger-field': {}, story: {}, crawl: {},
  stages: { placement: { seeds: [1], depth: 1, pieces: 60 } }, farm: {}, platformer: {}, beam: {}, dodge: { every: 8 },
};
const runsOf = r => r.metrics.runs ?? r.metrics.matches;
const strip = runs => runs.map(({ budget, ...x }) => x);

/** Play a mode's minimal document (or `make`, one played another way) with the bot its card names: chosen by select, wins, replays. */
function playMode(loop, make = DOCS[loop]) {
  const ctx = ctxOf(make()), modes = modesIn(ctx.doc, registry), mine = modes.find(m => m.mode.loop === loop);
  assert.ok(mine, `the ${loop} document declares the mode`);
  const chosen = select(ctx).chosen.map(c => c.s.id);
  assert.ok(chosen.includes(mine.mode.bot) && chosen.every(id => modes.some(m => m.mode.bot === id)), `select() picks the bots of the document's modes (${chosen})`);
  const bot = strategies.get(mine.mode.bot), opts = { budgetMs: 60000, ...OPTS[bot.id] };
  const a = bot.run(ctx, opts), b = bot.run(ctx, opts);
  assert.equal(a.ok, true, `${loop}: ${JSON.stringify(a.problems)}`);
  const runs = runsOf(a);
  assert.ok(runs.length && runs[0].won, `${loop}: the bot won (${JSON.stringify(runs[0]).slice(0, 300)})`);
  if (bot.id !== 'versus' && bot.id !== 'balance') assert.equal(runs[0].status ?? 'won', 'won', `${loop}: the game ended won`);
  assert.deepEqual(strip(runsOf(b)), strip(runs), `${loop}: the same document and seeds replay to the same result`);
  return { ctx, a, bot, runs };
}

test('modes: every card.mode is well formed, names a registered bot, and has a document here', () => {
  const cat = modeCatalogue(registry), bots = new Set(strategies.keys());
  assert.ok(cat.length >= 14, `modes: ${cat.map(m => m.mode).join(', ')}`);
  for (const m of cat) {
    assert.deepEqual(modeShapeErrors(m.card, { ...m, loop: m.mode }, bots), []);
    assert.ok(DOCS[m.mode], `no minimal document for mode '${m.mode}' (${m.card})`);
    if (m.via) assert.ok(registry.has(m.via), `${m.card}: via ${m.via}`);
    for (const k of ['win', 'lose']) if (m[k].param && !m[k].param.includes('.')) assert.ok((registry.get(m.via ?? m.card).card.params[m[k].param])?.type === 'effects', `${m.card}: ${k}.param '${m[k].param}' is an effects param`);
    for (const k of ['win', 'lose']) if (m[k].end) assert.equal(registry.get(m.card).card.params[m[k].end]?.type, 'boolean', `${m.card}: ${k}.end`);
    if (m.needs.participants) assert.ok(registry.get(m.via ?? m.card).card.params[m.needs.participants], `${m.card}: participants param '${m.needs.participants}'`);
  }
  assert.deepEqual(cat.map(m => m.mode), [...cat.map(m => m.mode)].sort(), 'sorted by mode');
  const collect = registry.get('gameplay.collectible').card.mode;
  assert.equal(modeApplies(collect, { counters: [{ id: 'coins' }] }), false, 'collect is a mode only when a counter clears the level');
  assert.equal(modeApplies(collect, { counters: [{ id: 'coins', clearsLevel: true }] }), true);
  const crawl = registry.get('engine.generate.dungeon.rooms').card.mode;
  assert.equal(modeApplies(crawl, { rooms: 8 }), false, 'a dungeon without a boss is a world, not a crawl');
  assert.equal(modeApplies(crawl, { rooms: 8, boss: 'warden' }), true, 'given: the dungeon holds a boss');
  assert.deepEqual([{}, { boss: 'warden' }].map(c => appliesTo(crawl.applies, c)), [false, true], 'the loop reads `given` the same way');
});

test('modes: a wrapper mode plays its wrapped mode; without modes, detection still selects', () => {
  const ctx = ctxOf(DOCS.levels());
  assert.deepEqual(select(ctx).chosen.map(c => c.s.id), ['stages'], 'stages wrap falling blocks: one bot');
  assert.deepEqual(select(ctx, { modes: false }).chosen.map(c => c.s.id), ['placement'], 'detection ignores mode-only bots');
  assert.deepEqual(select(ctx, { only: ['placement'] }).chosen.map(c => c.s.id), ['placement'], 'an allow-list without the mode bot falls back to detection');
});

for (const loop of ['tactics', 'card-battle', 'rts', 'launcher']) test(`mode ${loop}: the turn-board search wins and its path replays`, () => {
  const { ctx, a, runs } = playMode(loop);
  const w = replayMacros(ctx.make, runs[0].seed, runs[0].path, { realtime: a.metrics.realtime });
  assert.equal(w.state.status, 'won');
  assert.equal(stateHash(w.state), runs[0].hash, 'replaying the chosen options reproduces the final state');
});

test('mode race: the lookahead driver enters the car, finishes first and replays', () => {
  const { ctx, runs } = playMode('race');
  assert.equal(runs[0].place, 1);
  assert.ok(runs[0].path.includes('enter car1'), 'drove the car');
  const w = replayRace(ctx.make, 1, runs[0].path);
  assert.equal(w.state.status, 'won');
  assert.equal(stateHash(w.state), runs[0].hash);
});

test('mode ball-sport: the striker outscores the other team', () => {
  const { runs } = playMode('ball-sport');
  assert.ok(runs[0].score.blue > runs[0].score.red, JSON.stringify(runs[0].score));
});

test('mode versus: the scripted fighter wins the rounds match', () => {
  const { runs } = playMode('versus');
  assert.ok(runs.every(x => x.won && x.status === 'won'), JSON.stringify(runs));
});

test('mode creature-battle: the greedy battler wins the trainer battle the story starts', () => {
  const { a } = playMode('creature-battle');
  assert.equal(a.metrics.rate, 1, JSON.stringify(a.metrics.runs));
});

test('mode waves: the rollout dodger shoots down every wave through the controls to the win', () => {
  const { runs } = playMode('waves');
  assert.equal(runs[0].status, 'won');
  assert.equal(runs[0].fire, 'fire', 'it found the fire verb');
});

for (const loop of ['falling-blocks', 'match-board', 'slide-merge', 'collect', 'levels', 'crawl', 'platformer', 'runner']) test(`mode ${loop}: its bot reaches the win`, () => { playMode(loop); });

test('mode farm: the farming bot tills, plants, waters and harvests through the controls to the win', () => {
  const { runs } = playMode('farm');
  for (const verb of ['till', 'plant', 'water', 'harvest']) assert.ok(runs[0].presses[verb] > 0, `pressed ${verb}: ${JSON.stringify(runs[0].presses)}`);
  assert.equal(runs[0].harvested, 3);
});

test('mode story: the plot solver reaches a winning ending that replays', () => {
  const { runs } = playMode('story');
  assert.ok(runs[0].path.length > 0);
  assert.equal(runs[0].reused, false, 'no plot stage ran: the bot searched itself');
});

test('modes: every interaction a mode declares is one it is played in here, with locomotion and an input serving it', () => {
  const inputs = registry.ids('engine').filter(id => id.startsWith('engine.input.'));
  for (const m of modeCatalogue(registry)) {
    const played = interactionsOf(m.interaction);
    assert.ok(played.length || (m.wraps && m.interaction === 'any'), `${m.card}: declares the interactions it is played in`);
    assert.deepEqual(Object.keys(PLAYED_AS[m.mode] || {}).filter(i => !played.includes(i)), [], `${m.card}: a document played in an interaction it does not declare`);
    assert.equal(new Set(played.map(i => docFor(m.mode, i))).size, played.length, `${m.card}: one minimal document per declared interaction (${played.join(', ')})`);
    for (const i of played) {
      const doc = docFor(m.mode, i)();
      assert.ok(inputs.some(id => (registry.get(id).card.interactions || []).includes(i)), `${m.card}: an input serves ${i}`);
      for (const s of doc.systems) assert.ok(fitsInteraction(registry.get(s.use)?.card, i), `${m.card} ${i}: ${s.use} moves another way`);
      const r = checkComposition({ spaces: doc.spaces, systems: doc.systems.map(s => s.use) }, registry, { interaction: i });
      assert.ok(!r.failures.some(f => /^mode_input/.test(f.code)), `${m.card} ${i}: ${JSON.stringify(r.failures)}`);
    }
  }
});

// The documents played another way than the mode's own one (above): the mode's bot wins them too.
for (const [loop, ways] of Object.entries(PLAYED_AS)) for (const [interaction, make] of Object.entries(ways))
  test(`mode ${loop} played ${interaction}: its bot reaches the win`, () => { playMode(loop, make); });
