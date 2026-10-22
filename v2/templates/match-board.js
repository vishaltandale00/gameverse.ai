// Match board (the Bejeweled / Candy Crush family): an 8x8 board of five gem colours, generated with no ready-made
// matches and at least one swap that makes one. Swap two neighbouring gems to line up three or more; four in a line
// makes a striped gem that clears its row or column, an L or T an area bomb, five a colour bomb, and swapping two
// specials fires a combination. Cleared gems fall and new ones drop in, cascades multiply the score, dead boards
// reshuffle. Twenty moves to reach the target score (15000): running out of moves first loses.
const GEMS = [['red', 'Ruby'], ['orange', 'Amber'], ['yellow', 'Topaz'], ['green', 'Emerald'], ['blue', 'Sapphire']];

export default {
  id: 'match-board',
  concept: 'Match-3: swap neighbouring gems to line up three or more of a colour, set off specials and cascades, and reach the target score within the move limit.',
  doc: {
    schema: 'gameverse.v2.game/0.2', id: 'match-board', title: 'Match Board', seed: 5,
    views: { primary: 'board' },
    spaces: [{ id: 'board', use: 'engine.space.grid', with: { scenery: 'candy', size: [8, 8] },
      generators: [{ use: 'engine.generate.grid.board', with: { kind: 'match', fill: GEMS.map(([piece]) => ({ piece })), fillNoMatch: true, matchLength: 3, ensureMove: true } }] }],
    systems: [
      { use: 'gameplay.match', with: { board: { name: 'gems', at: [0, 0], size: [8, 8], axes: [0, 1], fall: -1 }, rule: 'line', min: 3, colors: GEMS.map(([c]) => c), specials: true, scoring: 'match3', moves: 20, onOutOfMoves: [{ do: 'end_game', outcome: 'lost' }] } },
      { use: 'plot.ending' },
    ],
    content: {
      archetypes: [],
      blocks: GEMS.map(([id, name]) => ({ id, name, solid: true })),
    },
    plot: { endings: [{ id: 'target_score', title: 'Target reached', epilogue: 'The board sparkles: target score reached.', outcome: 'won', when: { var: 'score', gte: 15000 } }] },
  },
  tune: ['engine.space.grid.scenery', { path: 'gameplay.match.swapFrames', max: 20 }],
};
