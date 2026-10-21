// Squad tactics (the XCOM / Fire Emblem family): a generated battlefield on a grid with walls (full cover, block
// sight), crates (half cover) and rubble (costs double to cross), rotated for fairness with a deploy strip per side.
// The player's squad of three takes side turns with two action points per unit: move, shoot with a cover-aware hit
// chance and flank crits, or set overwatch to fire on enemies that move in sight. An alien side answers with its
// own AI (claws up close, acid spit at range). Permadeath; wiping out the aliens wins, losing the squad loses.
const won = [{ do: 'end_game', outcome: 'won' }], lost = [{ do: 'end_game', outcome: 'lost' }];
// Spawn cells sit in the deploy strips (the bottom and top two rows), which the board generator never fills.
const SQUAD = [['rifleman_1', 'rifleman', [5, 0]], ['rifleman_2', 'rifleman', [8, 1]]];
const ALIENS = [['drone_1', 'drone', [3, 11]], ['drone_2', 'drone', [8, 11]], ['brute_1', 'brute', [6, 10]]];

export default {
  id: 'tactics',
  concept: 'Squad tactics: command a squad in turns on a battlefield grid, move between cover, shoot with hit chances and overwatch, and wipe out the enemy squad.',
  doc: {
    schema: 'gameverse.v2.game/0.2', id: 'tactics', title: 'Tactics', seed: 1,
    views: { primary: 'td' },
    spaces: [{ id: 'field', use: 'engine.space.grid', with: { size: [12, 12], exclusive: true, cover: true, rules: { wall: { cover: 2, opaque: true }, crate: { cover: 1 }, rubble: { cost: 2 } } },
      generators: [{ use: 'engine.generate.grid.board', with: { kind: 'tactics', terrain: [{ block: 'wall', weight: 1, blocks: true }, { block: 'crate', weight: 2, blocks: true }, { block: 'rubble', weight: 1 }], density: 0.18, symmetry: 'rotate', teams: 2, deployDepth: 2 } }] }],
    systems: [
      { use: 'gameplay.combat.health', with: { iframes: 0, playerDeath: 'none' } },
      // The squads are on the board before the first turn starts (the spawner runs before the turn order).
      { use: 'engine.spawner', with: { intervalSec: 0, rules: [...SQUAD, ...ALIENS].map(([id, archetype, at]) => ({ id, archetype, at, unique: true, activation: 'always', respawnSec: 0 })) } },
      { use: 'gameplay.turns', with: {
        sides: [{ id: 'squad', control: 'player' }, { id: 'aliens', control: 'ai' }], ap: 2, movePerAp: 4, overwatch: true, overwatchPenalty: 15,
        actions: [
          { id: 'shoot', label: 'Shoot', range: 7, hit: { base: 75, cover: [0, 25, 45], flank: 10 }, crit: { chance: 10, flankBonus: 40 }, onHit: [{ do: 'damage', who: 'target', amount: 3 }], onCrit: [{ do: 'damage', who: 'target', amount: 2 }] },
          { id: 'claw', label: 'Claw', range: 1.5, hit: { base: 85, cover: [0, 0, 0] }, onHit: [{ do: 'damage', who: 'target', amount: 4 }] },
          { id: 'spit', label: 'Acid spit', range: 5, hit: { base: 60, cover: [0, 20, 40] }, onHit: [{ do: 'damage', who: 'target', amount: 2 }] },
        ],
        onVictory: won, onDefeat: lost } },
    ],
    content: {
      archetypes: [
        { id: 'captain', name: 'Captain', components: { health: { max: 10 }, turns: { side: 'squad', aim: 5, actions: ['shoot'] } } },
        { id: 'rifleman', name: 'Rifleman', components: { health: { max: 8 }, turns: { side: 'squad', actions: ['shoot'] } } },
        { id: 'drone', name: 'Drone', kind: 'enemy', components: { health: { max: 6 }, turns: { side: 'aliens', actions: ['claw', 'spit'] } } },
        { id: 'brute', name: 'Brute', kind: 'enemy', components: { health: { max: 9 }, turns: { side: 'aliens', defense: 10, actions: ['claw'] } } },
      ],
      blocks: [{ id: 'wall', name: 'Wall', solid: true, tile: 'brick', color: '#6a6e80' }, { id: 'crate', name: 'Crate', solid: true, tile: 'wood', color: '#a0703a' }, { id: 'rubble', name: 'Rubble', solid: false, tile: 'rock', color: '#7a7468' }],
    },
    player: { archetype: 'captain', at: [2, 0] },
  },
  tune: ['engine.generate.grid.board.density', 'engine.generate.grid.board.symmetry', 'gameplay.turns.overwatch'],
};
