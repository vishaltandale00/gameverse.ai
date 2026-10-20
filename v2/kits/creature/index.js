// Creature-collector RPG kit (KIT_CONTRACT.md; genre design in CONTRACT.md).
//
// Content comes in two shapes:
//   - full content (CONTRACT.md §1), like the hand-written sample;
//   - a compact *journey* written by the model (generate/schema.js): cast, types, moves, species and
//     one chapter per gym. The journey is what a generated game stores, so revisions edit exactly
//     what the model writes; the kit expands it (fromModel + balance) into full content on demand.
import { validate as validateFull, settingsOf, gymOrder } from './content.js';
import { isModelShape, fromModel } from './generate/from-model.js';
import { balance } from './generate/balance.js';
import { tuneLeaders } from './generate/tune.js';
import { MODEL_SCHEMA, MODEL_PROMPT } from './generate/schema.js';
import { SAMPLE_CONTENT } from './fixtures/sample.js';
import { createGame as createFullGame, GAME_VERSION } from './game.js';
import { createRenderer } from './ui/renderer.js';
import { verify as verifyFull } from './verify/index.js';
import { cast as castFull } from './cast.js';

const EXPANDED = new WeakMap();

/** Validate either shape. For a journey, the stored content is the journey (settings filled). */
export function validate(input) {
  if (!isModelShape(input)) return validateFull(input);
  const journey = structuredClone(input);
  journey.settings = settingsOf(journey);
  const { content: full, fixes } = balance(fromModel(journey));
  let v = validateFull(full);
  // Simulation-tune leaders on the expanded game (the journey itself keeps the model's choices).
  if (v.ok) { fixes.push(...tuneLeaders(v.content)); v = validateFull(v.content); }
  if (v.ok) EXPANDED.set(journey, v.content);
  return {
    ok: v.ok, content: journey, fixes, full: v.content,
    errors: v.errors.map(e => ({ ...e, message: `${e.message} (in the expanded game)` })),
    warnings: v.warnings,
  };
}

/** Full, validated content for either shape (cached per journey object). */
export function expand(content) {
  if (!isModelShape(content)) return validateFull(content).content;
  if (EXPANDED.has(content)) return EXPANDED.get(content);
  const r = validate(content);
  const full = EXPANDED.get(r.content) || r.full;
  EXPANDED.set(content, full);
  return full;
}

export const cast = content => castFull(expand(content));
export const createGame = (content, opts) => createFullGame(expand(content), opts);
export const verify = (content, opts) => verifyFull(expand(content), opts);

export function goal(content) {
  const c = expand(content);
  const n = gymOrder(c).length;
  return `Choose a partner, catch wild creatures, earn ${n} badge${n === 1 ? '' : 's'} and defeat ${c.champion?.name || 'the champion'}.`;
}

/** Extra rows for the host's end screen. */
export const stats = state => [['Badges', String(state.badges?.length ?? 0)], ['Caught', String(Object.keys(state.caught || {}).length)]];

export default {
  id: 'creature',
  name: 'Creature collector RPG',
  version: GAME_VERSION,
  summary: 'Explore towns and routes, catch creatures in tall grass, battle with typed moves, level up and evolve, earn gym badges, beat your rival and the champion.',
  examples: ['Pokémon Red/Blue', 'Pokémon Gold/Silver', 'Pokémon Ruby/Sapphire'],
  content: { schema: MODEL_SCHEMA, prompt: MODEL_PROMPT, sample: SAMPLE_CONTENT },
  validate, cast, createGame, createRenderer, verify, goal, stats, expand,
  controls: [
    { input: 'move', label: 'Walk (hold B to run)' },
    { input: 'a', label: 'Talk, confirm' },
    { input: 'b', label: 'Back; tap to open the menu' },
  ],
};
