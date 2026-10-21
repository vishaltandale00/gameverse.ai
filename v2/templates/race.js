// Checkpoint race: a ring circuit of eight checkpoint zones around an infield wall, the player drives a car against three rivals steered to
// their next checkpoint by the race's target service, three laps after a countdown. Finishing first wins.
const won = [{ do: 'end_game', outcome: 'won' }], lost = [{ do: 'end_game', outcome: 'lost' }];
const RIVALS = [['rival_1', [6, 21]], ['rival_2', [6, 27]], ['rival_3', [4, 24]]];

export default {
  id: 'race',
  concept: 'Racing: drive laps of a circuit through its checkpoints against rival racers; finish first.',
  doc: {
    schema: 'gameverse.v2.game/0.2', id: 'race', title: 'Race', seed: 9,
    // A ring road around an infield wall; eight checkpoints keep every leg on the ring.
    spaces: [{ id: 'circuit', use: 'engine.space.arena2d', with: { size: [80, 48], solids: [[18, 16, 62, 32]] },
      zones: [['start_line', 'Start line', [2, 16, 14, 32]], ['north_west', 'North-west bend', [2, 34, 16, 46]], ['north_straight', 'North straight', [34, 34, 46, 46]],
        ['north_east', 'North-east bend', [64, 34, 78, 46]], ['east_straight', 'East straight', [64, 16, 78, 32]], ['south_east', 'South-east bend', [64, 2, 78, 14]],
        ['south_straight', 'South straight', [34, 2, 46, 14]], ['south_west', 'South-west bend', [2, 2, 16, 14]]].map(([id, name, rect]) => ({ id, name, rect })) }],
    systems: [
      { use: 'gameplay.vehicle.core' }, { use: 'gameplay.vehicle.car', with: { plane: 'xy' } },
      { use: 'gameplay.race', with: { laps: 3, checkpoints: ['start_line', 'north_west', 'north_straight', 'north_east', 'east_straight', 'south_east', 'south_straight', 'south_west'], racers: RIVALS.map(([id]) => id), countdown: 3, timeLimit: 0, onWin: won, onLose: lost } },
      { use: 'gameplay.ai.seek', with: { speed: 12 } },
      { use: 'engine.spawner', with: { intervalSec: 0, rules: [{ id: 'car', archetype: 'car', at: [8, 24], unique: true, activation: 'always', respawnSec: 0 },
        ...RIVALS.map(([id, at]) => ({ id, archetype: 'rival', at, unique: true, activation: 'always', respawnSec: 0 }))] } },
    ],
    content: {
      archetypes: [
        { id: 'hero', name: 'Driver', components: { body: { size: [0.8, 0.8, 1] } } },
        { id: 'rival', name: 'Rival', components: { body: { size: [1.2, 1.2, 1] } } },
        { id: 'car', name: 'Car', kind: 'vehicle', components: { vehicle: { seats: 1, health: 100, fuel: 0 }, car: { maxSpeed: 40, accel: 12, grip: 1, steer: 40 }, body: { size: [1.6, 1, 1] } } },
      ],
    },
    player: { archetype: 'hero', at: [7, 24] },
  },
  tune: ['gameplay.race.laps', 'gameplay.ai.seek.speed'],
};
