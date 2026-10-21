// @ts-check
// Modes: the loop a game is built around, as the catalogue declares it (card.mode, see
// v2/primitives/gameplay/modes-lib-mode.js; catalog.js modeCatalogue lists them). This module adds the
// planner's side: the play-spec vocabulary the decomposition uses (interaction, opponent, mashup relations),
// the strict schema of `core`, and the offline mapping from a sentence to a mode.
// Nothing here names a primitive or a genre.
import { modeCatalogue as declared } from './catalog.js';
import { relevance } from './select.js';
import { isObj, isStr, list } from '../kernel/guards.js';

/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/**
 * A declared mode: `id` is the loop, `use` the primitive owning it (the params win/lose/participants name live on `via` when set).
 * @typedef {{ id: string, use: string, intent: string, interaction?: string, opponent?: string, space?: Array<string | string[]>,
 *   needs?: { content?: string[], participants?: unknown }, win?: Record<string, any>, lose?: Record<string, any>, bot?: string,
 *   via?: string, wraps?: boolean, applies?: { param: string, field?: string, is: unknown } }} Mode
 */
/** @typedef {{ mode: string, relation: string, why: string }} Secondary */
/**
 * The play spec (decomposition.core).
 * @typedef {{ mode: string, interaction: string, opponent: string, win: string, lose: string, theme: string, narrative: boolean, secondary: Secondary[] }} Core
 */

export const MODES_VERSION = 'modes/0.1';
export const INTERACTIONS = ['avatar-realtime', 'avatar-grid', 'pieces-turns', 'cursor-board', 'menu'];
export const OPPONENTS = ['none', 'ai-rival', 'ai-side', 'hazards', 'clock'];
export const RELATIONS = ['nested', 'union', 'skin'];
/** The mode whose loop is the story (plot.storyboard declares it). */
export const STORY = 'story';
/** @param {unknown} interaction */
export const isAvatar = interaction => typeof interaction === 'string' && interaction.startsWith('avatar');

/** Every declared mode, as the planner reads it. @param {RegistryLike} registry @returns {Mode[]} */
export function modeCatalogue(registry) {
  return declared(registry).map(m => /** @type {Mode} */ (/** @type {unknown} */ ({ ...m, id: String(m.mode), use: String(m.card), intent: String(m.intent || '') })));
}

/** The mode ids a decomposition may name. @param {RegistryLike} registry @returns {string[]} */
export const modeIds = registry => { const ids = [...new Set(modeCatalogue(registry).map(m => m.id))]; return ids.includes(STORY) ? ids : [...ids, STORY]; };

/** The mode entry for an id (or the primitive owning it); null when unknown. @param {RegistryLike} registry @param {unknown} id @returns {Mode | null} */
export function modeOf(registry, id) {
  if (!isStr(id) || !id) return null;
  return modeCatalogue(registry).find(m => m.id === id || m.use === id) || null;
}

/** JSON schema of the decomposition's `core` (strict): the mode enum comes from the catalogue. @param {RegistryLike} registry */
export function coreSchema(registry) {
  const ids = modeIds(registry);
  const str = { type: 'string' };
  return {
    type: 'object', additionalProperties: false, required: ['mode', 'interaction', 'opponent', 'win', 'lose', 'theme', 'narrative', 'secondary'],
    properties: {
      mode: { type: 'string', enum: ids, description: 'the core loop the game is built around' },
      interaction: { type: 'string', enum: INTERACTIONS, description: 'avatar-realtime: the player steers a character in real time; avatar-grid: a character stepping cell by cell; pieces-turns: the player moves pieces in turns (board games, tactics); cursor-board: the player picks cells or pieces on a board (match-3, puzzles, placing towers); menu: the player picks options (cards, battle menus)' },
      opponent: { type: 'string', enum: OPPONENTS, description: 'who plays against the player' },
      win: str, lose: str, theme: str,
      narrative: { type: 'boolean', description: 'true when the idea has a story told in acts (characters, plot, quests); false for a pure loop' },
      secondary: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['mode', 'relation', 'why'], properties: {
        mode: { type: 'string', enum: ids }, relation: { type: 'string', enum: RELATIONS, description: 'nested: a sub-mode entered from the primary (a battle screen); union: both loops in one space; skin: only content and cast' }, why: str } } },
    },
  };
}

const MOVE = /\b(walk\w*|run\w*|jump\w*|climb\w*|explor\w*|roam\w*|wander\w*|travel\w*|platform\w*|driv\w*|steer\w*|race|racing|fly\w*|swim\w*|sneak\w*|dodge\w*|navigat\w*)\b/;
const TURNS = /\b(turn[- ]based|turns?|chess|checkers|board game|tactic\w*|pieces?|checkmate)\b/;
const CURSOR = /\b(match[- ]?3|match three|swap\w*|tiles?|puzzle\w*|tetromino\w*|falling|towers?)\b/;
const MENU = /\b(cards?|deck\w*|menu\w*|choices?|visual novel)\b/;
const STORYISH = /\b(story|stories|narrative|plot|quest\w*|mystery|detective|chapter\w*|suspects?|clues?|adventure)\b/;

/**
 * The offline core: the declared mode whose card best matches the core mechanics (lexical), the interaction from what
 * the player does (the mode's own when one matched), narrative from story words. Deterministic.
 * @param {{ mechanics?: Array<{ verb: string, description: string, importance: string }>, tone?: string }} decomposition
 * @param {RegistryLike} registry @param {string} [text] @returns {Core}
 */
export function coreOffline(decomposition, registry, text = '') {
  const core = (decomposition.mechanics || []).filter(m => m.importance === 'core');
  // What the player does: the prompt and the core mechanics (supporting ones are the offline path's own additions).
  const lower = `${text} ${core.map(m => `${m.verb} ${m.description}`).join(' ')}`.toLowerCase();
  const guessed = TURNS.test(lower) ? 'pieces-turns' : CURSOR.test(lower) && !MOVE.test(lower) ? 'cursor-board' : MENU.test(lower) && !MOVE.test(lower) ? 'menu' : 'avatar-realtime';
  // A loop must match clearly, be played the way the idea is (avatar or not), and match better than the story does.
  const all = modeCatalogue(registry);
  const storyMode = all.find(m => m.id === STORY);
  const storyCard = storyMode && registry.get(storyMode.use)?.card;
  const rel = (/** @type {any} */ card, /** @type {string} */ id) => Math.max(0, ...core.map(x => relevance(/** @type {any} */ (x), /** @type {any} */ ({ ...card, id }))));
  const bar = Math.max(1, storyCard && storyMode ? rel(storyCard, storyMode.use) : 0);
  /** @type {{ score: number, mode: Mode } | null} */
  let best = null;
  // The mode's own name in the idea ("race", "match", "card") counts; the exact interaction is preferred.
  const named = (/** @type {Mode} */ m) => m.id.split(/[^a-z0-9]+/).filter(w => w.length > 2 && new RegExp(`\\b${w}`).test(lower)).length;
  for (const m of all) {
    if (m.id === STORY || m.wraps || isAvatar(m.interaction) !== isAvatar(guessed)) continue;
    const card = registry.get(m.use)?.card; if (!card) continue;
    const score = rel(card, m.use) + named(m) * 2 + (m.interaction === guessed ? 1 : 0);
    if (score > bar + 1 && (!best || score > best.score)) best = { score, mode: m };
  }
  const own = best?.mode.interaction;
  const interaction = own && INTERACTIONS.includes(own) && !(isAvatar(own) && isAvatar(guessed)) ? own : guessed;
  const narrative = STORYISH.test(lower) || (!best && isAvatar(interaction));
  const opp = best?.mode.opponent;
  return { mode: best?.mode.id || STORY, interaction, opponent: opp && OPPONENTS.includes(opp) ? opp : 'none', win: '', lose: '', theme: String(decomposition.tone || ''), narrative, secondary: [] };
}

/** A decomposition's core normalized against the catalogue; null when absent. @param {unknown} core @param {RegistryLike} registry @returns {Core | null} */
export function normalizeCore(core, registry) {
  if (!isObj(core)) return null;
  const ids = new Set(modeIds(registry));
  const mode = isStr(core.mode) && ids.has(core.mode) ? core.mode : STORY;
  return {
    mode,
    interaction: isStr(core.interaction) && INTERACTIONS.includes(core.interaction) ? core.interaction : 'avatar-realtime',
    opponent: isStr(core.opponent) && OPPONENTS.includes(core.opponent) ? core.opponent : 'none',
    win: String(core.win || '').slice(0, 200), lose: String(core.lose || '').slice(0, 200), theme: String(core.theme || '').slice(0, 120),
    narrative: Boolean(core.narrative),
    secondary: list(core.secondary).filter(isObj).filter(s => isStr(s.mode) && ids.has(s.mode) && s.mode !== mode).slice(0, 3)
      .map(s => ({ mode: String(s.mode), relation: isStr(s.relation) && RELATIONS.includes(s.relation) ? s.relation : 'skin', why: String(s.why || '').slice(0, 160) })),
  };
}
