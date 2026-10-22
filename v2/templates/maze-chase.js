// Maze chase (the pellet-eating arcade family): a generated mirrored maze, four hunters with the classic
// personalities leaving a house through a door only they pass, a scatter/chase clock, power pellets that make
// touching a hunter defeat it, three lives. Clearing every pellet wins.
const won = [{ do: 'end_game', outcome: 'won' }], lost = [{ do: 'end_game', outcome: 'lost' }];
const HUNTERS = [['chaser', [25, 32], [13, 19]], ['ambusher', [2, 32], [13, 16]], ['whimsical', [27, -1], [12, 16]], ['shy', [0, -1], [15, 16]]];

export default {
  id: 'maze-chase',
  concept: 'Maze chase: eat every pellet in a maze while hunters chase you; power pellets turn the hunters into prey.',
  doc: {
    schema: 'gameverse.v2.game/0.2', id: 'maze-chase', title: 'Maze Chase', seed: 3, views: { primary: 'td' },
    spaces: [{ id: 'maze', use: 'engine.space.grid', with: { scenery: 'haunted', size: [28, 31], wrap: 'x', rules: { house_door: { pass: ['hunter'] } } },
      generators: [{ use: 'engine.generate.grid.maze', with: { size: 'classic', style: 'classic', density: 0.6 } }] }],
    systems: [
      { use: 'gameplay.move.grid', with: { mode: 'lane' } },
      { use: 'gameplay.combat.health' }, { use: 'gameplay.combat.status' }, { use: 'gameplay.score' },
      { use: 'gameplay.ai.brain', with: { tick: 0.05, modeSchedule: { table: [[7, 20, 7, 20, 5, 20, 5, -1]] } } },
      { use: 'gameplay.death', with: { lives: 3, respawn: 'start', respawnSec: 1, invulnSec: 2, gameOver: lost } },
      { use: 'gameplay.collectible', with: { counters: [
        { id: 'pellets', name: 'Pellets', includes: ['power_pellets'], points: 10, clearsLevel: true, onComplete: won },
        { id: 'power_pellets', name: 'Power pellets', points: 50, onCollect: HUNTERS.map(([archetype]) => ({ do: 'apply_status', status: 'frightened', archetype })) },
      ] } },
      { use: 'engine.spawner', with: { intervalSec: 0, rules: HUNTERS.map(([archetype, , at], i) => ({ id: `hunter_${i + 1}`, archetype, at, unique: true, activation: 'always', respawnSec: 0 })) } },
    ],
    content: {
      archetypes: [
        { id: 'hero', name: 'Hero', components: { health: { max: 1 } } },
        { id: 'pellet', name: 'Pellet', kind: 'pickup', components: {} },
        { id: 'power_pellet', name: 'Power pellet', kind: 'pickup', components: {} },
        ...HUNTERS.map(([personality, scatter]) => ({ id: personality, name: personality[0].toUpperCase() + personality.slice(1), kind: 'enemy',
          components: { body: { layer: 'hunter' }, health: { max: 1, respawn: { mode: 'spawn', sec: 3 } }, touch: { damage: 1 }, ai: { brain: [{ do: 'target-tile', personality, scatter }], speed: 7 } } })),
      ],
      statuses: [{ id: 'frightened', name: 'Frightened', duration: 6, mods: { 'stat.fright': 1 } }],
      blocks: [{ id: 'wall', name: 'Wall', solid: true, tile: 'brick', color: '#3a5cff' }, { id: 'house_wall', name: 'House wall', solid: true, tile: 'brick', color: '#3a5cff' }, { id: 'house_door', name: 'House door', solid: true, tile: 'wood', color: '#ff9ad8' }],
    },
    player: { archetype: 'hero' },
  },
  tune: ['engine.space.grid.scenery', 'engine.generate.grid.maze.style', 'engine.generate.grid.maze.density', 'gameplay.death.lives'],
};
