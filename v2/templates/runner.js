// Endless runner (the side-scrolling auto-runner family: Canabalt, Chrome Dino, Mario-style runners), ported from the
// runner kit's side mode: the runner auto-runs to +x on a side-view tile map (the kit's jump: apex 3.3, gravity 62,
// jump cut, coyote time and input buffer, the platformer's 'runner' preset). The course is endless: authored chunks
// stream ahead of the runner, tiered by a speed curve, and are cleared behind it. Crates to jump over, spikes and pits
// to clear, coins in the air and on the ground; touching spikes or a pit costs a life (three lives, back where you fell
// with a moment of invulnerability). Running the goal distance along the course wins (the course owns the distance:
// engine.generate.chunks `goal`, wired to a won ending through its onGoal).
const won = [{ do: 'end_game', outcome: 'won' }], lost = [{ do: 'end_game', outcome: 'lost' }];
// Chunks are side-view pictures (top row first, read left to right); the map's bottom edge is the ground.
const CHUNKS = [
  { id: 'crates', tier: 1, spacing: 1, rows: ['....oo.......', '.............', '...#.....##..'] },
  { id: 'coin_arc', tier: 1, spacing: 1, rows: ['....ooo....', '...o...o...', '..o.....o..', '...........'] },
  { id: 'spikes', tier: 1, spacing: 1, rows: ['......o.....', '............', '..^.....^^..'] },
  { id: 'pit', tier: 2, spacing: 1, rows: ['....oo.....', '...........', '...~~~.....'] },
  { id: 'steps', tier: 2, spacing: 1, rows: ['.......o.......', '......###......', '..#...###...^..'] },
  { id: 'gauntlet', tier: 3, spacing: 1, rows: ['...o.......o....', '................', '..##...~~...#^..'] },
];

export default {
  id: 'runner',
  concept: 'Endless runner: an auto-running side-scroller where you jump over obstacles, spikes and pits on an endless course and grab coins; run far enough to win.',
  doc: {
    schema: 'gameverse.v2.game/0.2', id: 'runner', title: 'Runner', seed: 6,
    views: { primary: 'side' },
    spaces: [{ id: 'course', use: 'engine.space.tilemap', with: { size: [4096, 10], mode: 'side' },
      generators: [{ use: 'engine.generate.chunks', with: {
        chunks: CHUNKS, along: 'columns', axis: 'x', cross: 'y', origin: [0, 0], firstAt: 12,
        legend: { '.': {}, '#': { block: 'crate', blocks: true }, '^': { block: 'spikes', hazard: true }, '~': { block: 'pit', hazard: true }, o: { archetype: 'coin' } },
        speed: { start: 9, max: 9, rampSeconds: 60 }, density: 1, gap: { base: 6, min: 3 }, ahead: 40, behind: 12,
        goal: 240, onGoal: won,
      } }] }],
    systems: [
      { use: 'gameplay.move.platformer', with: { preset: 'runner' } },
      { use: 'gameplay.combat.health' },
      { use: 'gameplay.hazard', with: { types: [{ id: 'spikes', damage: 1 }, { id: 'pit', damage: 1 }] } },
      { use: 'gameplay.death', with: { lives: 3, respawn: 'here', respawnSec: 0.5, invulnSec: 1.5, gameOver: lost } },
      { use: 'gameplay.collectible', with: { counters: [{ id: 'coins', points: 10 }] } },
      { use: 'gameplay.score' },
    ],
    content: {
      archetypes: [
        { id: 'runner', name: 'Runner', components: { health: { max: 1 }, body: { size: [0.7, 1.1] } } },
        { id: 'coin', name: 'Coin', kind: 'pickup', components: { collectible: { counter: 'coins' }, body: { size: [0.6, 0.6] } } },
      ],
      blocks: [{ id: 'crate', name: 'Crate', solid: true }, { id: 'spikes', name: 'Spikes', solid: false, hazard: 'spikes' }, { id: 'pit', name: 'Pit', solid: false, hazard: 'pit' }],
    },
    player: { archetype: 'runner', at: [2, 0.55] },
  },
  tune: ['engine.generate.chunks.goal', 'engine.generate.chunks.density', 'gameplay.death.lives'],
};
