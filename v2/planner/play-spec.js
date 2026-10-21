// @ts-check
// The play spec (decomposition.core): how the idea is played, in the idea's own terms. It names no mode and no
// genre: the core loop is the idea's core mechanics, selection maps them to primitives, and the game's loop is what
// those primitives' cards declare (loop.js). The spec keeps what only the idea can say: the interaction, the
// opponent, how the core loop is won and lost, the theme, and whether there is a story told in acts.
// A field the spec leaves undecided (null) is decided by the collection's declarations, never guessed from words.
import { isObj, isStr } from '../kernel/guards.js';

/**
 * The play spec. interaction null: the collection decides (its loops' declared interaction, or a base locomotion);
 * narrative null: the collection decides (a core mechanic mapped to the primitive that runs plot.storyboard).
 * @typedef {{ interaction: string | null, opponent: string, win: string, lose: string, theme: string, narrative: boolean | null, problems?: string[] }} Core
 */

export const PLAY_SPEC_VERSION = 'play-spec/0.2';
export const INTERACTIONS = ['avatar-realtime', 'avatar-grid', 'pieces-turns', 'cursor-board', 'menu'];
export const OPPONENTS = ['none', 'ai-rival', 'ai-side', 'hazards', 'clock'];
/** @param {unknown} interaction */
export const isAvatar = interaction => typeof interaction === 'string' && interaction.startsWith('avatar');

/** JSON schema of the decomposition's `core` (strict). */
export function coreSchema() {
  const str = { type: 'string' };
  return {
    type: 'object', additionalProperties: false, required: ['interaction', 'opponent', 'win', 'lose', 'theme', 'narrative'],
    properties: {
      interaction: { type: 'string', enum: INTERACTIONS, description: 'avatar-realtime: the player steers a character in real time; avatar-grid: a character stepping cell by cell; pieces-turns: the player moves pieces in turns; cursor-board: the player picks cells or pieces on a board; menu: the player picks options' },
      opponent: { type: 'string', enum: OPPONENTS, description: 'who plays against the player' },
      win: { ...str, description: "how the core loop is won, in the game's own terms" },
      lose: { ...str, description: "how it is lost, in the game's own terms ('' when it cannot be lost)" },
      theme: str,
      narrative: { type: 'boolean', description: 'true when the idea has a story told in acts (characters, plot, quests); false for a pure loop' },
    },
  };
}

/**
 * A model's play spec, narrowed. An unknown interaction or opponent is reported in `problems` and left undecided
 * (the collection decides), never replaced by a default. null when there is no spec.
 * @param {unknown} core @returns {Core | null}
 */
export function normalizeCore(core) {
  if (!isObj(core)) return null;
  /** @type {string[]} */
  const problems = [];
  const interaction = isStr(core.interaction) && INTERACTIONS.includes(core.interaction) ? core.interaction : null;
  if (core.interaction !== undefined && core.interaction !== null && !interaction) problems.push(`unknown interaction '${String(core.interaction).slice(0, 40)}'`);
  const opponent = isStr(core.opponent) && OPPONENTS.includes(core.opponent) ? core.opponent : 'none';
  if (isStr(core.opponent) && !OPPONENTS.includes(core.opponent)) problems.push(`unknown opponent '${core.opponent.slice(0, 40)}'`);
  return {
    interaction, opponent,
    win: String(core.win || '').slice(0, 200), lose: String(core.lose || '').slice(0, 200), theme: String(core.theme || '').slice(0, 120),
    narrative: typeof core.narrative === 'boolean' ? core.narrative : null,
    ...(problems.length ? { problems } : {}),
  };
}

/** The spec of a decomposition no model wrote: everything the collection decides is left undecided. @param {{ tone?: string }} decomposition @returns {Core} */
export const undecidedCore = decomposition => ({ interaction: null, opponent: 'none', win: '', lose: '', theme: String(decomposition.tone || ''), narrative: null });
