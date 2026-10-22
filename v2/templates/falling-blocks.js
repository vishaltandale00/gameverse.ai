// Falling blocks (the Tetris family): a 10-wide well with four hidden spawn rows, the seven tetrominoes from a
// 7-bag with SRS rotation and wall kicks, hold, a five-piece preview, ghost, lock delay, T-spins, combos and
// guideline scoring. Four levels in order (gameplay.stage.sequence): each asks for a number of cleared lines and
// drops the pieces faster; the second starts with rising rubble rows to dig through. Topping out loses; clearing
// the last level wins.
const PIECES = [['I', 'Beam'], ['O', 'Cube'], ['T', 'Tee'], ['S', 'Wave'], ['Z', 'Zag'], ['J', 'Hook'], ['L', 'Crook']];
const FALLING = 'gameplay.falling.pieces';

export default {
  id: 'falling-blocks',
  concept: 'Falling blocks: rotate and drop falling pieces to fill and clear rows before the stack tops out, level after level.',
  doc: {
    schema: 'gameverse.v2.game/0.2', id: 'falling-blocks', title: 'Falling Blocks', seed: 7,
    views: { primary: 'board' },
    spaces: [{ id: 'well', use: 'engine.space.grid', with: { scenery: 'sky', size: [10, 24] } }],
    systems: [
      { use: FALLING, with: { board: { name: 'well', at: [0, 0], size: [10, 24], axes: [0, 1], fall: -1 }, hidden: 4, next: 5, hold: true, ghost: true, randomizer: 'bag', levelEvery: 10,
        tokens: Object.fromEntries(PIECES.map(([k]) => [k, `piece_${k.toLowerCase()}`])), garbageToken: 'rubble' } },
      { use: 'gameplay.stage.sequence', with: { id: 'levels', introSec: 0, clearSec: 0, onComplete: [{ do: 'end_game', outcome: 'won' }], endOnComplete: false,
        stages: [
          { id: 'first_light', name: 'First Light', intro: 'Clear lines to finish the level.', goal: { kind: 'lines', target: 3 }, params: { [`use:${FALLING}.rowsPerSecond`]: 1 } },
          { id: 'rising_rubble', name: 'Rising Rubble', intro: 'Rubble rises from below: dig down through it.', goal: { kind: 'lines', target: 4 }, params: { [`use:${FALLING}.rowsPerSecond`]: 1.5 }, onStart: [{ do: 'add_garbage', rows: 2 }] },
          { id: 'quickening', name: 'Quickening', intro: 'The pieces fall faster now.', goal: { kind: 'lines', target: 4 }, params: { [`use:${FALLING}.rowsPerSecond`]: 2.5 } },
          { id: 'last_stand', name: 'Last Stand', intro: 'Hold steady at full speed.', goal: { kind: 'lines', target: 5 }, params: { [`use:${FALLING}.rowsPerSecond`]: 4 } },
        ] } },
    ],
    content: {
      archetypes: [],
      blocks: [...PIECES.map(([k, name]) => ({ id: `piece_${k.toLowerCase()}`, name, solid: true })), { id: 'rubble', name: 'Rubble', solid: true }],
    },
  },
  tune: ['engine.space.grid.scenery', `${FALLING}.next`, `${FALLING}.hold`, `${FALLING}.randomizer`],
};
