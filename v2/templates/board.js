// Board game (the chess / checkers family): two sides of pieces face each other across a generated board (an 8 by 8
// grid, a few impassable squares placed with rotational symmetry so neither side is favoured, each side's two home
// rows kept clear). Sides alternate turns, and a turn is one action with any one piece: move it (soldiers step one
// square, riders up to two, in any of eight directions) or capture an adjacent opposing piece. Captured pieces leave
// the board. The opposing side is played by the game's AI; capturing all of its pieces wins, losing all of yours loses.
// Its loop is gameplay.turns, whose capture is a hit (card.loop.involves: attack_hit names attacker and defender), so
// a nested game (a creature battle) can decide each capture.
const won = [{ do: 'end_game', outcome: 'won' }], lost = [{ do: 'end_game', outcome: 'lost' }];
const PIECES = [
  ['light_rider_1', 'light_rider', [1, 0]], ['light_rider_2', 'light_rider', [6, 0]],
  ...[2, 3, 4, 5].map(x => [`light_soldier_${x - 1}`, 'light_soldier', [x, 1]]),
  ['dark_rider_1', 'dark_rider', [6, 7]], ['dark_rider_2', 'dark_rider', [1, 7]],
  ...[5, 4, 3, 2].map((x, i) => [`dark_soldier_${i + 1}`, 'dark_soldier', [x, 6]]),
];
const piece = (id, name, side, ap) => ({ id, name, kind: 'piece', components: { health: { max: 1 }, turns: { side, ap } } });

export default {
  id: 'board',
  concept: 'Board game: two sides of pieces take turns on a board, moving one piece a turn and capturing the opponent\'s pieces; capture them all to win.',
  doc: {
    schema: 'gameverse.v2.game/0.2', id: 'board', title: 'Board', seed: 1,
    views: { primary: 'board' },
    spaces: [{ id: 'board', use: 'engine.space.grid', with: { scenery: 'castle', size: [8, 8], diagonals: true, exclusive: true },
      generators: [{ use: 'engine.generate.grid.board', with: { kind: 'tactics', terrain: [{ block: 'pillar', weight: 1, blocks: true }], density: 0.08, symmetry: 'rotate', teams: 2, deployDepth: 2 } }] }],
    systems: [
      { use: 'gameplay.combat.health', with: { iframes: 0 } },
      // The pieces are on the board before the first turn starts (the spawner runs before the turn order).
      { use: 'engine.spawner', with: { intervalSec: 0, rules: PIECES.map(([id, archetype, at]) => ({ id, archetype, at, unique: true, activation: 'always', respawnSec: 0 })) } },
      { use: 'gameplay.turns', with: {
        sides: [{ id: 'light', name: 'Light', control: 'player' }, { id: 'dark', name: 'Dark', control: 'ai' }], ap: 1, movePerAp: 1, actionsPerTurn: 1,
        overwatch: false, hitChance: false, despawnFallen: true,
        actions: [{ id: 'capture', label: 'Capture', range: 1.5, los: false, onHit: [{ do: 'damage', who: 'target', amount: 1 }] }],
        onVictory: won, onDefeat: lost } },
    ],
    content: {
      archetypes: [
        piece('light_soldier', 'Light soldier', 'light', 1), piece('light_rider', 'Light rider', 'light', 2),
        piece('dark_soldier', 'Dark soldier', 'dark', 1), piece('dark_rider', 'Dark rider', 'dark', 2),
      ],
      blocks: [{ id: 'pillar', name: 'Pillar', solid: true, tile: 'rock', color: '#8a8478' }],
    },
  },
  tune: ['engine.space.grid.scenery', 'engine.space.grid.diagonals', 'engine.generate.grid.board.symmetry'],
};
