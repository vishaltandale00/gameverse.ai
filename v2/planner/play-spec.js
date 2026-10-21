// @ts-check
// The play spec (decomposition.core): how the idea is played, in the idea's own terms. It names no mode and no
// genre: the core loop is the idea's core mechanics, selection maps them to primitives, and the game's loop is what
// those primitives' cards declare (loop.js). The spec keeps what only the idea can say: the interaction, the
// opponent, how the core loop is won and lost, the theme, whether there is a story told in acts, and for a mashup
// how the ideas' core mechanics join (nested, union, skin): adapters realise each relation (card.adapts.relation).
// A field the spec leaves undecided (null) is decided by the collection's declarations, never guessed from words.
import { isObj, isStr } from '../kernel/guards.js';
import { cardLoop } from './loop.js';

/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */

/**
 * How a mashup's ideas join: `mechanics` (core mechanic ids of the joined idea) relate to the rest as nested (a loop
 * entered from the other, e.g. a creature battle deciding a capture), union (both loops in one space) or skin (only
 * its content and cast fill the other's slots).
 * @typedef {{ relation: string, mechanics: string[], why: string }} Mashup
 */
/**
 * The play spec. interaction null: the collection decides (its loops' declared interaction, or a base locomotion);
 * narrative null: the collection decides (a core mechanic mapped to the primitive that runs plot.storyboard).
 * @typedef {{ interaction: string | null, opponent: string, win: string, lose: string, theme: string, narrative: boolean | null, mashup: Mashup[], problems?: string[] }} Core
 */

export const PLAY_SPEC_VERSION = 'play-spec/0.2';
export const INTERACTIONS = ['avatar-realtime', 'avatar-grid', 'pieces-turns', 'cursor-board', 'menu'];
export const OPPONENTS = ['none', 'ai-rival', 'ai-side', 'hazards', 'clock'];
export const RELATIONS = ['nested', 'union', 'skin'];
/** @param {unknown} interaction */
export const isAvatar = interaction => typeof interaction === 'string' && interaction.startsWith('avatar');

/** JSON schema of the decomposition's `core` (strict). */
export function coreSchema() {
  const str = { type: 'string' };
  return {
    type: 'object', additionalProperties: false, required: ['interaction', 'opponent', 'win', 'lose', 'theme', 'narrative', 'mashup'],
    properties: {
      interaction: { type: 'string', enum: INTERACTIONS, description: 'avatar-realtime: the player steers a character in real time; avatar-grid: a character stepping cell by cell; pieces-turns: the player moves pieces in turns; cursor-board: the player picks cells or pieces on a board; menu: the player picks options' },
      opponent: { type: 'string', enum: OPPONENTS, description: 'who plays against the player' },
      win: { ...str, description: "how the core loop is won, in the game's own terms" },
      lose: { ...str, description: "how it is lost, in the game's own terms ('' when it cannot be lost)" },
      theme: str,
      narrative: { type: 'boolean', description: 'true when the idea has a story told in acts (characters, plot, quests); false for a pure loop' },
      mashup: { type: 'array', description: 'one entry per joined idea when the idea combines two or more concepts (games, genres) that each bring their own loop: how that idea\'s mechanics relate to the primary idea\'s; [] only for a single idea', items: { type: 'object', additionalProperties: false, required: ['relation', 'mechanics', 'why'], properties: {
        relation: { type: 'string', enum: RELATIONS, description: 'nested: its loop is entered from the other (a creature battle deciding a chess capture); union: both loops run in one space; skin: only its content and cast fill the other\'s slots' },
        mechanics: { type: 'array', items: str, description: 'ids (exactly as in mechanics[].id) of the joined idea\'s mechanics, its own loop first' }, why: str } } },
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
    mashup: normalizeMashup(core.mashup),
    ...(problems.length ? { problems } : {}),
  };
}

/** The spec of a decomposition no model wrote: everything the collection decides is left undecided. @param {{ tone?: string }} decomposition @returns {Core} */
export const undecidedCore = decomposition => ({ interaction: null, opponent: 'none', win: '', lose: '', theme: String(decomposition.tone || ''), narrative: null, mashup: [] });

/** A model's mashup list, narrowed: entries with a known relation, mechanic ids as strings. @param {unknown} value @returns {Mashup[]} */
export const normalizeMashup = value => (Array.isArray(value) ? value : []).filter(isObj).filter(m => isStr(m.relation) && RELATIONS.includes(m.relation)).slice(0, 4)
  .map(m => ({ relation: String(m.relation), mechanics: (Array.isArray(m.mechanics) ? m.mechanics : []).filter(isStr).map(x => x.slice(0, 60)).slice(0, 6), why: String(m.why || '').slice(0, 160) }));

/** A reference name as a grouping key (mechanic.from): lowercase words joined by '_'; '' when it names none. @param {unknown} from */
const ideaKey = from => (String(from || '').toLowerCase().match(/[a-z0-9]+/g) || []).join('_');

/**
 * What a mashup check found: the joined ideas whose loops each declare their own win, and which of them no relation links.
 * @typedef {{ code: 'mashup_missing', ideas: Array<{ from: string, mechanics: string[], loops: string[] }>, unlinked: string[], message: string }} MashupProblem
 */

/**
 * The play spec's deterministic post-check, once mechanics are mapped to primitives: an idea that combines concepts
 * whose mechanics map to loops that each declare their own win (card.loop.win) must say how those loops relate
 * (core.mashup: nested | union | skin over mechanic ids). Mechanics are grouped into ideas by the reference they come
 * from (mechanic.from); core and supporting mechanics count (a joined idea's loop is often marked supporting, e.g.
 * creature battles in chess × Pokémon), flavour does not. Incomplete when two or more distinct win-declaring loops
 * come from two or more ideas and more than one of those ideas has no mechanic named by a mashup relation (the
 * primary idea is the one the others relate to). null when the spec is complete or there is no spec.
 * @param {{ mechanics: Array<{ id: string, from: string, importance: string }>, core?: Core | null }} decomposition
 * @param {(mechanic: string) => string[]} primitivesOf  the primitive ids a mechanic is mapped to
 * @param {RegistryLike} registry
 * @returns {MashupProblem | null}
 */
export function mashupProblem(decomposition, primitivesOf, registry) {
  const core = decomposition.core;
  if (!core) return null;
  /** @type {Map<string, { from: string, mechanics: string[], loops: string[] }>} */
  const ideas = new Map();
  /** @type {Set<string>} */
  const loops = new Set();
  for (const m of decomposition.mechanics) {
    const from = ideaKey(m.from);
    if (m.importance === 'flavor' || !from) continue;
    const own = primitivesOf(m.id).filter(id => Boolean(cardLoop(registry.get(id)?.card)?.win));
    if (!own.length) continue;
    const idea = ideas.get(from) || { from, mechanics: [], loops: [] };
    idea.mechanics.push(m.id);
    for (const id of own) { loops.add(id); if (!idea.loops.includes(id)) idea.loops.push(id); }
    ideas.set(from, idea);
  }
  if (loops.size < 2 || ideas.size < 2) return null;
  const fromOf = new Map(decomposition.mechanics.map(m => [m.id, ideaKey(m.from)]));
  const linked = new Set(core.mashup.flatMap(x => x.mechanics.map(id => fromOf.get(id))).filter(Boolean));
  const unlinked = [...ideas.keys()].filter(k => !linked.has(k));
  if (unlinked.length < 2) return null;
  const list = [...ideas.values()];
  return { code: 'mashup_missing', ideas: list, unlinked,
    message: `the idea combines ${list.map(i => `${i.from} (${i.mechanics.join(', ')} -> ${i.loops.join(', ')})`).join(' and ')}, whose loops each declare their own win (card.loop.win), but no mashup relation links ${unlinked.join(', ')}: core.mashup must say how the joined idea's mechanics relate (nested | union | skin, by mechanic id)` };
}
