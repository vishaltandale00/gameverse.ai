// Slingshot launcher (the Angry Birds family) on 2D rigid-body physics: a sling at the left of the field, a queue of
// three shots (a plain bird, a splitter, a bomb that blasts shortly after its first hit) and, to the right, structures
// laid out by the layout generator: a stone wall, a two-storey wooden tower behind it, a stack of glass panes, a low
// stone wall and a stone pyramid, with guards sheltering inside and on top. Pull back and release to launch; impacts
// and collapses damage every piece by the impulse it takes (wood, glass and stone break at their own strength, guards
// are soft), blasts hurt everything in range. Defeating every guard wins; running out of shots first loses.
const lost = [{ do: 'end_game', outcome: 'lost' }];
const piece = (material, density, friction, restitution) => ({ body: { density, friction, restitution }, destructible: { material } });

export default {
  id: 'launcher',
  concept: 'Slingshot physics: pull back and launch projectiles at destructible structures to knock them down and defeat every target with the shots you have.',
  doc: {
    schema: 'gameverse.v2.game/0.2', id: 'launcher', title: 'Launcher', seed: 6,
    views: { primary: 'side' },
    spaces: [{ id: 'field', use: 'engine.space.physics2d', with: { gravity: [0, -10], bounds: [44, 18] },
      generators: [{ use: 'engine.generate.layout.shapes', with: { groups: [
        { id: 'tower', shape: 'tower', archetype: 'wood_beam', material: 'wood', x: 26, y: 0, count: 2, size: 3, pieceSize: [0.6, 2.2] },
        { id: 'panes', shape: 'stack', archetype: 'glass_pane', material: 'glass', x: 32, y: 0, count: 3, pieceSize: [1, 1] },
        { id: 'wall', shape: 'pieces', archetype: 'stone_block', material: 'stone', pieces: [{ x: 21, y: 0, w: 0.8, h: 3.2 }, { x: 30, y: 0, w: 0.8, h: 2.4 }] },
        { id: 'pyramid', shape: 'pyramid', archetype: 'stone_block', material: 'stone', x: 38, y: 0, count: 2, pieceSize: [1.4, 0.8] },
        { id: 'guards', shape: 'pieces', archetype: 'guard', material: 'wood', pieces: [{ x: 26, y: 0, w: 0.9, h: 0.9 }, { x: 26, y: 5, w: 0.9, h: 0.9 }, { x: 32, y: 3, w: 0.9, h: 0.9 }, { x: 38, y: 1.6, w: 0.9, h: 0.9 }] },
      ] } }] }],
    systems: [
      { use: 'gameplay.launcher', with: { mode: 'sling', origin: [4, 3], forward: [1, 0], aim: [-0.4, 1.3], speed: 24, maxPull: 1.9, motion: 'space', bounds: [-2, -2, 46, 40],
        shots: [{ archetype: 'bird' }, { archetype: 'splitter', ability: 'split' }, { archetype: 'bomber', ability: 'bomb' }], onEmpty: lost } },
      { use: 'gameplay.destructible', with: { settleFrames: 60 } },
      { use: 'gameplay.score' },
      { use: 'plot.ending' },
    ],
    content: {
      archetypes: [
        { id: 'bird', name: 'Bird', kind: 'projectile', components: { body: { size: [0.84, 0.84], shape: { kind: 'circle', r: 0.42 }, density: 2.6, bullet: true } } },
        { id: 'splitter', name: 'Splitter', kind: 'projectile', components: { body: { size: [0.68, 0.68], shape: { kind: 'circle', r: 0.34 }, density: 2.6, bullet: true } } },
        { id: 'bomber', name: 'Bomber', kind: 'projectile', components: { body: { size: [1, 1], shape: { kind: 'circle', r: 0.5 }, density: 2.3, bullet: true } } },
        { id: 'wood_beam', name: 'Wooden beam', kind: 'prop', components: piece('wood', 0.7, 0.7, 0.08) },
        { id: 'glass_pane', name: 'Glass pane', kind: 'prop', components: piece('glass', 1, 0.35, 0.1) },
        { id: 'stone_block', name: 'Stone block', kind: 'prop', components: piece('stone', 2.2, 0.85, 0.04) },
        { id: 'guard', name: 'Guard', kind: 'enemy', components: { body: { density: 0.8, friction: 0.8, restitution: 0.15 }, destructible: { material: 'target' } } },
      ],
    },
    plot: { endings: [{ id: 'guards_down', title: 'Guards down', epilogue: 'Every guard is down.', outcome: 'won', when: { count: 'destroyed:target', gte: 4 } }] },
  },
  tune: [{ path: 'gameplay.launcher.aimSpeed', min: 0.3, max: 3 }, { path: 'gameplay.launcher.quietSec', min: 0.2, max: 2 }],
};
