// Real-time strategy (the StarCraft family): two bases at opposite corners of a generated field of rock outcrops
// (rotationally symmetric, each base's strip kept clear). Each side starts with a headquarters that takes in minerals
// and trains workers, a barracks that trains marines, three workers and a mineral field beside the base. Workers
// gather minerals and carry them home; minerals pay for more workers and marines; marines fight what they see under
// fog of war. The other side is an AI faction that gathers, trains and attacks once its army is large enough.
// Destroying every enemy unit and building wins; losing all of yours loses.
const won = [{ do: 'end_game', outcome: 'won' }], lost = [{ do: 'end_game', outcome: 'lost' }];
const UNITS = {
  worker: { health: { max: 4 }, rts: { speed: 3, sight: 5, worker: true, carry: 5, gatherRate: 2.5 } },
  marine: { health: { max: 8 }, rts: { speed: 3, sight: 7, attack: { range: 3, cooldown: 0.6, effects: [{ do: 'damage', who: 'target', amount: 2 }] } } },
  headquarters: { health: { max: 20 }, rts: { building: true, dropoff: true, sight: 6, produces: [{ archetype: 'worker', cost: { minerals: 40 }, time: 3 }] } },
  barracks: { health: { max: 14 }, rts: { building: true, sight: 5, produces: [{ archetype: 'marine', cost: { minerals: 50 }, time: 3 }] } },
  minerals: { rts: { node: { resource: 'minerals', amount: 400 } } },
};
// One base per side in the generator's deploy strips (the bottom and top four rows, which it never fills); the AI's
// base is the player's turned half way round the field.
const BASE = [['headquarters', 'hq', [2, 1]], ['barracks', 'barracks', [6, 1]], ['minerals', 'minerals_a', [1, 3]], ['minerals', 'minerals_b', [3, 3]],
  ['worker', 'worker_1', [4, 2]], ['worker', 'worker_2', [5, 2]], ['worker', 'worker_3', [4, 3]]];
const N = 16, rotate = ([x, y]) => [N - 1 - x, N - 1 - y];
const placed = (faction, prefix, at) => BASE.map(([archetype, id, p]) => ({ id: `${prefix}${id}`, archetype, at: at(p),
  ...(archetype === 'minerals' ? {} : { components: { rts: { ...UNITS[archetype].rts, faction } } }) }));

export default {
  id: 'rts',
  concept: 'Real-time strategy: gather resources with workers, train an army at your buildings and destroy the enemy faction\'s base.',
  doc: {
    schema: 'gameverse.v2.game/0.2', id: 'rts', title: 'RTS', seed: 1,
    views: { primary: 'td' },
    spaces: [{ id: 'field', use: 'engine.space.grid', with: { size: [N, N] },
      generators: [{ use: 'engine.generate.grid.board', with: { kind: 'tactics', terrain: [{ block: 'rock', weight: 1, blocks: true }], density: 0.12, symmetry: 'rotate', teams: 2, deployDepth: 4 } }] }],
    systems: [
      { use: 'gameplay.combat.health', with: { iframes: 0 } },
      { use: 'engine.spawner', with: { intervalSec: 0, rules: [...placed('player', '', p => p), ...placed('enemy', 'enemy_', rotate)].map(r => ({ ...r, unique: true, activation: 'always', respawnSec: 0 })) } },
      { use: 'gameplay.rts', with: { factions: [{ id: 'player', control: 'player', start: { minerals: 100 } }, { id: 'enemy', control: 'ai', start: { minerals: 50 } }],
        resources: ['minerals'], fog: true, ai: { attackAt: 8, workers: 3 }, onVictory: won, onDefeat: lost } },
    ],
    content: {
      archetypes: [
        { id: 'worker', name: 'Worker', components: UNITS.worker },
        { id: 'marine', name: 'Marine', components: UNITS.marine },
        { id: 'headquarters', name: 'Headquarters', components: UNITS.headquarters },
        { id: 'barracks', name: 'Barracks', components: UNITS.barracks },
        { id: 'minerals', name: 'Mineral field', components: UNITS.minerals },
      ],
      blocks: [{ id: 'rock', name: 'Rock', solid: true }],
    },
  },
  tune: [{ path: 'engine.generate.grid.board.symmetry', options: ['mirror', 'rotate'] }],
};
