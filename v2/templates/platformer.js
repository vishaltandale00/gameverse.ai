// Platformer (the side-scrolling Super Mario family): a side-view level of four generated rooms in a row, run and jump
// from the start on the left to the goal flag at the far right. The rooms hold pits lined with spikes, spikes on the
// floor, platforms you jump up through, coins to collect, walkers that pace their ground (touching one hurts; landing on one stomps
// it and bounces you off) and a checkpoint flag halfway. One hit loses a life and returns you to the last checkpoint;
// three lives. Reaching the goal flag wins.
const won = [{ do: 'end_game', outcome: 'won' }], lost = [{ do: 'end_game', outcome: 'lost' }];
const H = 16, W = 30;
const ROOMS = [['start_area', 'Start area', 'hall'], ['lowlands', 'Lowlands', 'hall'], ['high_road', 'High road', 'hall'], ['finish', 'Finish', 'hall']];
const rect = i => [i * W, 0, (i + 1) * W, H];

export default {
  id: 'platformer',
  concept: 'Platformer (side-scroller like Super Mario or Sonic): run and jump through a side-view level past pits, spikes and enemies you can stomp, collect coins, and reach the goal at the end.',
  doc: {
    schema: 'gameverse.v2.game/0.2', id: 'platformer', title: 'Platformer', seed: 1,
    views: { primary: 'side', alternates: [] },
    spaces: [{ id: 'level', use: 'engine.space.tilemap', with: { size: [W * ROOMS.length, H], mode: 'side', gravity: -60 },
      zones: ROOMS.map(([id, name], i) => ({ id, name, rect: rect(i) })),
      generators: [{ use: 'engine.generate.tilemap.rooms', with: {
        mode: 'side', movement: { jumpHeight: 3, jumpDistance: 4 }, oneWayPlatforms: true,
        palette: { wall: 'stone', ground: 'ground', platform: 'ledge', rung: 'ledge', hazard: 'spikes', door: 'stone' },
        rooms: ROOMS.map(([id, , style], i) => ({
          id, zone: id, rect: rect(i), style,
          ...(i === 0 ? { platforms: 2, gaps: 0 } : { platforms: 3, gaps: i, hazards: ['spikes'] }),
          exits: [...(i > 0 ? [{ side: 'l' }] : []), ...(i < ROOMS.length - 1 ? [{ side: 'r' }] : [])],
          features: [
            { kind: 'spawn', ref: 'coin', count: 4 },
            ...(i > 0 ? [{ kind: 'spawn', ref: 'walker', count: Math.min(i, 2) }] : []),
            ...(i === 2 ? [{ kind: 'spawn', ref: 'checkpoint_flag' }] : []),
            ...(i === ROOMS.length - 1 ? [{ kind: 'spawn', ref: 'goal_flag', at: [(i + 1) * W - 3, 3] }] : []),
          ],
        })),
      } }] }],
    systems: [
      { use: 'gameplay.move.platformer' },
      { use: 'gameplay.combat.health', with: { iframes: 1 } },
      { use: 'gameplay.death', with: { lives: 3, respawn: 'checkpoint', respawnSec: 1, invulnSec: 2, gameOver: lost } },
      { use: 'gameplay.checkpoint', with: { touch: true, save: false } },
      { use: 'gameplay.hazard', with: { types: [{ id: 'spikes', damage: 1 }] } },
      { use: 'gameplay.score' },
      { use: 'gameplay.collectible', with: { counters: [{ id: 'coins', points: 10 }] } },
      { use: 'gameplay.ai.brain', with: { tick: 0.1 } },
      { use: 'gameplay.goal', with: { onReach: won } },
    ],
    content: {
      archetypes: [
        { id: 'hero', name: 'Hero', components: { health: { max: 1 }, body: { size: [0.8, 0.95] } } },
        { id: 'walker', name: 'Walker', kind: 'enemy', components: { health: { max: 1 }, touch: { damage: 1, stomp: true }, body: { size: [0.9, 0.9] }, move: {},
          ai: { brain: [{ do: 'wander', range: 3, pause: [0.2, 0.8] }], speed: 2, perception: { sight: 0, fov: 360, memory: 0 } } } },
        { id: 'coin', name: 'Coin', kind: 'pickup', components: { collectible: { counter: 'coins', points: 10 }, body: { size: [0.6, 0.6] } } },
        { id: 'checkpoint_flag', name: 'Checkpoint flag', kind: 'prop', components: { checkpoint: { touch: true }, body: { size: [0.6, 2] } } },
        { id: 'goal_flag', name: 'Goal flag', kind: 'prop', components: { goal: true, body: { size: [1, 3] } } },
      ],
      blocks: [
        { id: 'stone', name: 'Stone', solid: true }, { id: 'ground', name: 'Ground', solid: true }, 
        { id: 'ledge', name: 'Ledge', solid: false, tags: ['one_way'] }, { id: 'spikes', name: 'Spikes', solid: false, tags: ['hazard'], hazard: 'spikes' },
      ],
    },
    player: { archetype: 'hero', at: [3, 3] },
  },
  tune: ['gameplay.death.lives', 'gameplay.move.platformer.feel'],
};
