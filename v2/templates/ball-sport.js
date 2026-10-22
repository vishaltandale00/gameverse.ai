// Ball sport (the football / soccer family): a top-down walled pitch with a goal mouth between posts at each end, the
// player's team of three against three, a ball the sports physics rolls (drag, bounces off the walls and posts, pushed
// by every body that runs into it), kicks that send it where the kicker aims, kickoffs after each goal, two timed
// halves and golden-goal overtime on a tie. Teammates and opponents
// (gameplay.ai.seek on the sports target service) run for the ball while it is live. Outscoring the other team wins.
const won = [{ do: 'end_game', outcome: 'won' }], lost = [{ do: 'end_game', outcome: 'lost' }], drawn = [{ do: 'end_game', outcome: 'neutral' }];

export default {
  id: 'ball-sport',
  concept: 'Ball sport (football, soccer): a team match on a pitch, run with the ball, pass and shoot past the other team into their goal; outscore them before the final whistle.',
  doc: {
    schema: 'gameverse.v2.game/0.2', id: 'ball-sport', title: 'Ball Sport', seed: 2,
    views: { primary: 'td' },
    // A 40 x 24 pitch; goal mouths y 8..16 behind each goal line, with a post at either side of each mouth.
    spaces: [{ id: 'pitch', use: 'engine.space.arena2d', with: { scenery: 'meadow', size: [40, 24], solids: [[0, 7.5, 1.5, 8], [0, 16, 1.5, 16.5], [38.5, 7.5, 40, 8], [38.5, 16, 40, 16.5]] },
      zones: [{ id: 'home_goal', name: 'Home goal', rect: [0, 8, 1, 16] }, { id: 'away_goal', name: 'Away goal', rect: [39, 8, 40, 16] }] }],
    systems: [
      { use: 'gameplay.move.walk', with: { run: 7 } },
      { use: 'gameplay.sports', with: { ball: 'ball', ballAt: [20, 12], physics: 'own', periodSec: 30, periods: 2, breakSec: 2, overtime: 'golden', kickoffSec: 0.5, resetSec: 1, drag: 0.6, bounce: 0.6,
        teams: [{ id: 'home', name: 'Home', members: ['player', 'teammate'], kickoff: [[17, 12], [12, 6], [12, 18]] }, { id: 'away', name: 'Away', members: ['opponent'], kickoff: [[24, 12], [28, 6], [28, 18]] }],
        goals: [{ zone: 'away_goal', scores: 'home' }, { zone: 'home_goal', scores: 'away' }], onWin: won, onLose: lost, onDraw: drawn, endGame: false } },
      { use: 'gameplay.ai.seek', with: { speed: 5 } },
      { use: 'engine.spawner', with: { intervalSec: 0, rules: [
        { id: 'mate_1', archetype: 'teammate', at: [12, 6] }, { id: 'mate_2', archetype: 'teammate', at: [12, 18] },
        { id: 'opp_1', archetype: 'opponent', at: [24, 12] }, { id: 'opp_2', archetype: 'opponent', at: [28, 6] }, { id: 'opp_3', archetype: 'opponent', at: [28, 18] },
      ].map(r => ({ ...r, unique: true, activation: 'always', respawnSec: 0 })) } },
    ],
    content: {
      archetypes: [
        { id: 'hero', name: 'Captain', components: { body: { size: [1, 1] } } },
        { id: 'teammate', name: 'Teammate', components: { body: { size: [1, 1] } } },
        { id: 'opponent', name: 'Opponent', components: { body: { size: [1, 1] } } },
        { id: 'ball', name: 'Ball', components: { body: { size: [0.6, 0.6] } } },
      ],
    },
    player: { archetype: 'hero', at: [17, 12] },
  },
  tune: ['engine.space.arena2d.scenery', 'gameplay.sports.periodSec', 'gameplay.sports.periods'],
};
