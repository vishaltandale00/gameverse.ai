// Dungeon crawl (the top-down Zelda family): a generated dungeon of rooms on a grid, a guard in every room but the
// start, keys that open the locked doors on the way to the boss room, a sword sweep the player swings at what stands
// next to it, three lives. Defeating the boss wins.
const won = [{ do: 'end_game', outcome: 'won' }], lost = [{ do: 'end_game', outcome: 'lost' }];

export default {
  id: 'dungeon',
  concept: 'Dungeon crawl: explore a dungeon of rooms, fight its monsters, find the keys that open its locked doors and defeat the boss.',
  doc: {
    schema: 'gameverse.v2.game/0.2', id: 'dungeon', title: 'Dungeon', seed: 4,
    // One body per cell: the space's own passability (canMove) is what blocks a step, as the grid movement does.
    spaces: [{ id: 'dungeon', use: 'engine.space.grid', with: { size: [40, 40], exclusive: true },
      generators: [{ use: 'engine.generate.dungeon.rooms', with: { rooms: 8, branching: 0.3, keys: ['bronze_key', 'iron_key'], roomSize: [5, 7], boss: 'warden', guards: 'skeleton', guardsPerRoom: 1, palette: { wall: 'stone', door: 'locked_door' } } }] }],
    systems: [
      { use: 'gameplay.move.grid', with: { mode: 'step' } },
      { use: 'gameplay.inventory' },
      { use: 'gameplay.combat.health' }, { use: 'gameplay.combat.melee' },
      { use: 'gameplay.ai.brain', with: { tick: 0.1 } }, { use: 'gameplay.ai.attacks' },
      { use: 'gameplay.death', with: { lives: 3, respawn: 'start', respawnSec: 1, invulnSec: 2, gameOver: lost } },
      { use: 'gameplay.combat.boss', with: { bosses: [{ id: 'warden', archetype: 'warden', name: 'Warden', start: 'sight', sightRange: 6, phases: [{ at: 1, pattern: ['slam'] }], onDefeat: won }] } },
    ],
    content: {
      archetypes: [
        { id: 'hero', name: 'Hero', components: { health: { max: 10 }, melee: { moves: { w1: { name: 'Sweep', damage: 2, reach: 1.2, arc: 360, startup: 6, active: 6, recovery: 12, hitstun: 18, units: 'world' } } } } },
        { id: 'skeleton', name: 'Skeleton', kind: 'enemy', components: { health: { max: 4 }, move: {},
          ai: { brain: [{ do: 'chase', target: 'player', when: { near: 'player', within: 5 } }, { do: 'wander', range: 2 }], speed: 2, perception: { sight: 8, fov: 360, memory: 3 } },
          attacks: [{ id: 'claw', range: 1.2, windup: 0.3, active: 0.2, recover: 0.5, cooldown: 0.8, damage: 1, shape: 'x' }] } },
        { id: 'warden', name: 'Warden', kind: 'boss', components: { health: { max: 16 }, move: {},
          ai: { brain: [{ do: 'chase', target: 'player' }], speed: 1.5, perception: { sight: 10, fov: 360, memory: 5 } },
          attacks: [{ id: 'slam', range: 1.2, windup: 0.4, active: 0.2, recover: 0.6, cooldown: 0.8, damage: 2, shape: 'x' }] } },
        { id: 'key', name: 'Key', kind: 'pickup', components: {} },
        { id: 'locked_door', name: 'Locked door', components: {} },
        { id: 'chest', name: 'Chest', components: {} },
      ],
      items: [{ id: 'bronze_key', name: 'Bronze key' }, { id: 'iron_key', name: 'Iron key' }],
      blocks: [{ id: 'stone', name: 'Stone', solid: true }, { id: 'locked_door', name: 'Locked door', solid: true }],
    },
    player: { archetype: 'hero' },
  },
  tune: ['engine.generate.dungeon.rooms.guardsPerRoom', 'gameplay.death.lives'],
};
