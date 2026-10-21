// Kart race: a looped circuit (engine.space.track, the space the race declares first; drawn by graphics.render.track as a
// bending road behind the player's kart) with eight checkpoint segments, cones marking its edges, the player and three
// rivals each driving a kart. The rivals are steered to their next checkpoint by the race's target service (ai.seek
// writes their movement intents, the kart each sits in carries them out). Three laps after a countdown; finishing
// first wins.
const won = [{ do: 'end_game', outcome: 'won' }], lost = [{ do: 'end_game', outcome: 'lost' }];
const LENGTH = 200, LANES = 5;
const CHECKPOINTS = [['start_line', 'Start line'], ['first_bend', 'First bend'], ['back_straight', 'Back straight'], ['hairpin', 'Hairpin'],
  ['chicane', 'Chicane'], ['long_sweep', 'Long sweep'], ['final_bend', 'Final bend'], ['home_straight', 'Home straight']];
// The starting grid: [driver, lane, progress]; the player's kart starts on the line beside them.
const RIVALS = [['rival_1', 1, 4], ['rival_2', 3, 4], ['rival_3', 0, 1]];
const PLAYER = [2, 2, 0.5];
const kartAt = (lane, p) => [p, lane, 0.3];

export default {
  id: 'race',
  concept: 'Racing: drive a kart for laps of a circuit through its checkpoints against rival racers; finish first.',
  doc: {
    schema: 'gameverse.v2.game/0.2', id: 'race', title: 'Race', seed: 9,
    views: { primary: '3p' },
    spaces: [{ id: 'circuit', use: 'engine.space.track', with: { lanes: LANES, laneWidth: 1, length: LENGTH, loop: true },
      zones: CHECKPOINTS.map(([id, name], i) => ({ id, name, range: [i * LENGTH / CHECKPOINTS.length, i * LENGTH / CHECKPOINTS.length + 6] })),
      // The course: cones on the outer lanes, every chunk leaving the racing line free (origin: lane j is the centre of
      // a cone's cell, whose generator anchors entities at cell + size / 2).
      generators: [{ use: 'engine.generate.chunks', with: { chunks: [
        { id: 'gate', spacing: 3, rows: ['X...X'] }, { id: 'left_cones', spacing: 3, rows: ['X....', 'X....'] }, { id: 'right_cones', spacing: 3, rows: ['....X', '....X'] },
      ], legend: { '.': {}, X: { archetype: 'cone', blocks: true } }, axis: 'x', cross: 'y', origin: [0, -0.3, 0], firstAt: 14, gap: { base: 12, min: 8 } } }] }],
    systems: [
      { use: 'gameplay.vehicle.core' }, { use: 'gameplay.vehicle.car', with: { plane: 'xy' } },
      { use: 'gameplay.race', with: { laps: 3, checkpoints: CHECKPOINTS.map(([id]) => id), racers: RIVALS.map(([id]) => id), countdown: 3, timeLimit: 0, onWin: won, onLose: lost } },
      { use: 'gameplay.ai.seek', with: { speed: 16 } },
      // Every racer sits in its own kart from the first step.
      { use: 'engine.spawner', with: { intervalSec: 0, rules: [
        { id: 'kart', archetype: 'kart', at: kartAt(PLAYER[1], PLAYER[0]), unique: true, activation: 'always', respawnSec: 0, onSpawn: [{ do: 'enter_vehicle', vehicle: 'kart', force: true }] },
        ...RIVALS.flatMap(([id, lane, p]) => [
          { id, archetype: 'rival', at: [p, lane, 0.5], unique: true, activation: 'always', respawnSec: 0 },
          { id: `${id}_kart`, archetype: 'kart', at: kartAt(lane, p), unique: true, activation: 'always', respawnSec: 0, onSpawn: [{ do: 'enter_vehicle', who: id, vehicle: `${id}_kart`, force: true }] },
        ]),
      ] } },
    ],
    content: {
      archetypes: [
        { id: 'hero', name: 'Driver', components: { body: { size: [0.8, 0.6, 1] } } },
        { id: 'rival', name: 'Rival', components: { body: { size: [0.8, 0.6, 1] } } },
        { id: 'kart', name: 'Kart', kind: 'vehicle', components: { vehicle: { seats: 1, health: 100, fuel: 0 }, car: { preset: 'kart', maxSpeed: 72, accel: 16, grip: 1.2, steer: 24 }, body: { size: [1.4, 0.8, 0.6] } } },
        { id: 'cone', name: 'Cone', kind: 'prop', components: { body: { size: [0.6, 0.6, 0.6], solid: true, obstacle: true } } },
      ],
    },
    player: { archetype: 'hero', at: PLAYER },
  },
  tune: [{ path: 'gameplay.race.laps', min: 1, max: 5 }, { path: 'gameplay.ai.seek.speed', min: 8, max: 16 }],
};
