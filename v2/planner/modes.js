// Modes: the loop a game is built around, as the catalogue declares it. A loop-owning primitive declares
//   card.mode = { loop, interaction, opponent, space, needs: { content, participants, zones? }, win: { param }, lose: { param }, bot }
// (FABLE design, step 2). This module reads those declarations: the catalogue of modes (catalog.js's
// modeCatalogue when present, else the cards themselves), the play-spec vocabulary the decomposition uses
// (interaction, opponent, mashup relations), and the offline mapping from a sentence to a mode.
// Nothing here names a primitive or a genre.
import * as catalog from './catalog.js';
import { relevance } from './select.js';

export const MODES_VERSION = 'modes/0.1';
export const INTERACTIONS = ['avatar-realtime', 'avatar-grid', 'pieces-turns', 'cursor-board', 'menu'];
export const OPPONENTS = ['none', 'ai-rival', 'ai-side', 'hazards', 'clock'];
export const RELATIONS = ['nested', 'union', 'skin'];
/** The mode of a game whose loop is its story (walking places, talking, quests): the storyboard's preset. */
export const STORY = 'story';
export const isAvatar = interaction => typeof interaction === 'string' && interaction.startsWith('avatar');

/** [{ id, use, loop, interaction, opponent, space, needs, win, lose, bot, intent }] for every card that declares a mode. */
export function modeCatalogue(registry) {
  if (typeof catalog.modeCatalogue === 'function') {
    try { const list = catalog.modeCatalogue(registry); if (Array.isArray(list)) return list.map(m => ({ ...m, id: m.id || m.loop || m.use, use: m.use || m.id })); } catch { /* fall back to the cards */ }
  }
  const out = [];
  for (const c of registry.cards()) {
    const m = c.mode; if (!m || typeof m !== 'object') continue;
    out.push({ ...m, id: String(m.loop || c.id), use: c.id, intent: c.intent });
  }
  // One entry per mode id (the first card that declares it owns it).
  return out.filter((m, i) => out.findIndex(x => x.id === m.id) === i);
}

/** The mode ids a decomposition may name: every declared loop, plus the story mode. */
export const modeIds = registry => [...new Set([...modeCatalogue(registry).map(m => m.id), STORY])];

/** The mode entry for an id (or the primitive that owns it); null for the story mode or an unknown id. */
export function modeOf(registry, id) {
  if (!id || id === STORY) return null;
  return modeCatalogue(registry).find(m => m.id === id || m.use === id) || null;
}

/** JSON schema of the decomposition's `core` (strict): the mode enum comes from the catalogue. */
export function coreSchema(registry) {
  const ids = modeIds(registry);
  const str = { type: 'string' };
  return {
    type: 'object', additionalProperties: false, required: ['mode', 'interaction', 'opponent', 'win', 'lose', 'theme', 'narrative', 'secondary'],
    properties: {
      mode: { type: 'string', enum: ids, description: 'the core loop the game is built around' },
      interaction: { type: 'string', enum: INTERACTIONS, description: 'avatar-realtime: the player steers a character in real time; avatar-grid: a character stepping cell by cell; pieces-turns: the player moves pieces in turns (board games, tactics); cursor-board: the player picks cells/pieces on a board (match-3, puzzles); menu: the player picks options (cards, dialogue)' },
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
const CURSOR = /\b(match[- ]?3|match three|swap\w*|tiles?|puzzle\w*|tetromino\w*|falling)\b/;
const MENU = /\b(cards?|deck\w*|menu\w*|dialog\w*|choices?|visual novel)\b/;
const STORYISH = /\b(story|stories|narrative|plot|quest\w*|mystery|detective|chapter\w*|suspects?|clues?|adventure)\b/;

/**
 * The offline core: the declared mode whose card best matches the mechanics (lexical), the interaction from what
 * the player does, narrative from story words. Deterministic; the model's decomposition replaces it when present.
 */
export function coreOffline(decomposition, registry, text = '') {
  const lower = `${text} ${(decomposition.mechanics || []).map(m => `${m.verb} ${m.description}`).join(' ')}`.toLowerCase();
  const modes = modeCatalogue(registry);
  const core = (decomposition.mechanics || []).filter(m => m.importance === 'core');
  let best = null;
  for (const m of modes) {
    const card = registry.get(m.use)?.card; if (!card) continue;
    const score = Math.max(0, ...core.map(x => relevance(x, { id: m.use, ...card })));
    if (score >= 0.75 && (!best || score > best.score)) best = { id: m.id, score, mode: m };
  }
  const interaction = best?.mode.interaction && INTERACTIONS.includes(best.mode.interaction) ? best.mode.interaction
    : TURNS.test(lower) ? 'pieces-turns' : CURSOR.test(lower) && !MOVE.test(lower) ? 'cursor-board' : MENU.test(lower) && !MOVE.test(lower) ? 'menu' : MOVE.test(lower) || STORYISH.test(lower) ? 'avatar-realtime' : 'avatar-realtime';
  const narrative = STORYISH.test(lower);
  return { mode: best?.id || STORY, interaction, opponent: best?.mode.opponent && OPPONENTS.includes(best.mode.opponent) ? best.mode.opponent : 'none', win: best?.mode.win?.text || '', lose: best?.mode.lose?.text || '', theme: decomposition.tone || '', narrative: narrative || (!best && isAvatar(interaction)), secondary: [] };
}

/** A decomposition's core, normalized against the catalogue (unknown modes fall back to the story mode). */
export function normalizeCore(core, registry) {
  if (!core || typeof core !== 'object') return null;
  const ids = new Set(modeIds(registry));
  return {
    mode: ids.has(core.mode) ? core.mode : STORY,
    interaction: INTERACTIONS.includes(core.interaction) ? core.interaction : 'avatar-realtime',
    opponent: OPPONENTS.includes(core.opponent) ? core.opponent : 'none',
    win: String(core.win || '').slice(0, 200), lose: String(core.lose || '').slice(0, 200), theme: String(core.theme || '').slice(0, 120),
    narrative: Boolean(core.narrative),
    secondary: (Array.isArray(core.secondary) ? core.secondary : []).filter(s => ids.has(s?.mode) && s.mode !== core.mode).slice(0, 3).map(s => ({ mode: s.mode, relation: RELATIONS.includes(s.relation) ? s.relation : 'skin', why: String(s.why || '').slice(0, 160) })),
  };
}
