// Slide and merge (the 2048 family): a 4x4 board that starts with two tiles. Every move slides all tiles toward one
// edge; two equal tiles that meet merge into their sum (once per move) and score it, and after every move that changed
// the board a new 2 (one time in ten a 4) appears in an empty cell. Making the target tile wins; a full board with no
// move left loses.
export default {
  id: 'slide-merge',
  concept: 'Slide and merge (2048): slide every tile toward an edge so equal numbers merge into bigger ones, and make the target tile before the board fills up.',
  doc: {
    schema: 'gameverse.v2.game/0.2', id: 'slide-merge', title: 'Slide and Merge', seed: 4,
    views: { primary: 'board' },
    spaces: [{ id: 'tray', use: 'engine.space.grid', with: { size: [4, 4] } }],
    systems: [
      { use: 'gameplay.slide.merge', with: { board: { name: 'tray', at: [0, 0], size: [4, 4], axes: [0, 1], fall: -1 }, start: 2, spawnFour: 0.1, target: 256,
        onTarget: [{ do: 'end_game', outcome: 'won' }], onStuck: [{ do: 'end_game', outcome: 'lost' }] } },
    ],
    content: {
      archetypes: [],
      blocks: [2, 4, 8, 16, 32, 64, 128, 256].map(v => ({ id: String(v), name: `Tile ${v}`, solid: true })),
    },
  },
  tune: ['gameplay.slide.merge.spawnFour', 'gameplay.slide.merge.slideFrames'],
};
