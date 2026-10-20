// Endless runner and one-touch kit (see v2/kits/KIT_CONTRACT.md). One kit,
// six modes chosen by content.mode: lanes, side, flap, climb, rhythm-dash, hop.
import { SCHEMA, PROMPT, validate, LOOKS, PROP_KEYS } from './content.js';
import { SAMPLE, SAMPLES } from './samples.js';
import { createGame as createWorld } from './world.js';
import { verify } from './verify.js';
import { createRenderer } from './render/index.js';
import { worldAdapter } from './adapter.js';

const CONTROLS = {
  lanes: [{ input: 'move', label: 'Switch lanes, jump (up), slide (down)' }, { input: 'a', label: 'Jump' }],
  side: [{ input: 'a', label: 'Jump (hold to jump higher)' }],
  'side-fly': [{ input: 'a', label: 'Hold to fly' }],
  flap: [{ input: 'a', label: 'Flap' }],
  climb: [{ input: 'move', label: 'Steer' }, { input: 'a', label: 'Shoot' }],
  hop: [{ input: 'move', label: 'Hop' }, { input: 'a', label: 'Hop forward' }],
  'rhythm-dash': [{ input: 'a', label: 'Jump (hold to keep jumping)' }],
};
const GOALS = {
  lanes: c => `Outrun ${c.cast.chaser.name}: dodge trains, jump barriers, slide under gates and grab ${c.cast.coin.name.toLowerCase()}s.`,
  side: c => c.control === 'fly' ? `Fly as far as you can past lasers and missiles. Watch for the warnings.` : `Run the rooftops as far as you can. Jump the gaps; crates slow you down.`,
  flap: c => `Flap through as many gates as you can.`,
  climb: c => `Bounce as high as you can. Stomp or shoot ${c.cast.chaser.name}s and don't fall.`,
  hop: c => `Hop across roads, rivers and rails. Keep moving or ${c.cast.chaser.name} swoops in.`,
  'rhythm-dash': c => `Jump on the beat and reach ${c.cast.goal.name}.`,
};
const modeKey = c => (c.mode === 'side' && c.control === 'fly' ? 'side-fly' : c.mode);
let lastMode = 'lanes';

const kit = {
  id: 'runner',
  name: 'Endless runner',
  version: '0.1.0',
  summary: 'Endless runners and one-touch games: 3-lane chases, rooftop sprints, jetpack flights, flappy gates, bounce climbers, beat dashes and lane hoppers.',
  examples: ['Subway Surfers', 'Temple Run', 'Canabalt', 'Jetpack Joyride', 'Chrome Dino', 'Flappy Bird', 'Doodle Jump', 'Geometry Dash', 'Crossy Road'],
  content: { schema: SCHEMA, prompt: PROMPT, sample: SAMPLE },
  samples: SAMPLES,
  validate,
  cast(content) {
    const c = validate(content).content || content;
    return {
      brief: {
        player: { name: c.cast.hero.name, glyph: LOOKS[c.cast.hero.look] },
        enemy: { name: c.cast.chaser.name, glyph: LOOKS[c.cast.chaser.look] },
        pickup: { name: c.cast.coin.name, glyph: PROP_KEYS[c.cast.coin.kind] },
        hazard: { name: c.cast.hazard.name, glyph: PROP_KEYS[c.cast.hazard.kind] },
        goal: { name: c.cast.goal.name, glyph: PROP_KEYS[c.cast.goal.kind] },
      },
      entities: { hero: { tags: ['player'] }, chaser: { tags: ['enemy'] }, coin: { tags: ['collectible'] }, hazard: { tags: ['hazard'] }, goal: { tags: ['goal'] } },
    };
  },
  createGame(content, { seed = 1 } = {}) {
    const checked = validate(content);
    const game = createWorld(checked.ok ? checked.content : content, { seed });
    lastMode = modeKey(game.content);
    return game;
  },
  createRenderer,
  verify,
  // What cross-genre mods (v2/kits/mods) can see and do. Scrolling modes report x relative to the hero.
  world: {
    capabilities: ['player', 'enemies', 'blocked', 'defeat', 'lives'],
    buttons: ['a'], // every mode uses a (jump, flap, shoot, hop); b is free for mods
    adapter: worldAdapter,
  },
  // The host reads controls after createGame; they follow the loaded game's mode.
  get controls() { return CONTROLS[lastMode] || CONTROLS.lanes; },
  controlsFor: content => CONTROLS[modeKey(validate(content).content || content)],
  goal: content => { const c = validate(content).content; return c ? GOALS[c.mode](c) : kit.summary; },
  stats: state => {
    const rows = [['Distance', `${Math.floor(state.distance || 0)} ${state.mode === 'hop' ? 'rows' : 'm'}`], ['Coins', String(state.coins || 0)], ['Near misses', String(state.stats?.near_misses || 0)]];
    if (state.mode === 'rhythm-dash' && state.progress != null) rows.unshift(['Progress', `${state.progress}%`]);
    return rows;
  },
};
export default kit;
