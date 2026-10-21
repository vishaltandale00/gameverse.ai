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
 * How a mashup's ideas join: `mechanics` relate mechanics ACROSS concepts (mechanic.from): first the mechanic of the
 * idea it joins into (the outer side: the primary idea's loop), then the joined idea's mechanics (the inner side, its
 * own loop first), related as nested (the inner loop entered from the outer, e.g. a creature battle deciding a
 * capture), union (both loops in one space) or skin (only the inner's content and cast fill the outer's slots).
 * @typedef {{ relation: string, mechanics: string[], why: string }} Mashup
 */
/**
 * The play spec. interaction null: the collection decides (its loops' declared interaction, or a base locomotion);
 * narrative null: the collection decides (a core mechanic mapped to the primitive that runs plot.storyboard).
 * @typedef {{ loop?: string, interaction: string | null, opponent: string, win: string, lose: string, theme: string, narrative: boolean | null, mashup: Mashup[], problems?: string[] }} Core
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
    type: 'object', additionalProperties: false, required: ['loop', 'interaction', 'opponent', 'win', 'lose', 'theme', 'narrative', 'mashup'],
    properties: {
      loop: { type: 'string', description: "the id (exactly as in mechanics[].id) of the core mechanic the game is built around: the loop the player repeats" },
      interaction: { type: 'string', enum: INTERACTIONS, description: 'avatar-realtime: the player steers a character in real time; avatar-grid: a character stepping cell by cell; pieces-turns: the player moves pieces in turns; cursor-board: the player picks cells or pieces on a board; menu: the player picks options' },
      opponent: { type: 'string', enum: OPPONENTS, description: 'who plays against the player' },
      win: { ...str, description: "how the core loop is won, in the game's own terms" },
      lose: { ...str, description: "how it is lost, in the game's own terms ('' when it cannot be lost)" },
      theme: str,
      narrative: { type: 'boolean', description: 'true when the idea has a story told in acts (characters, plot, quests); false for a pure loop' },
      mashup: { type: 'array', description: 'exactly one entry per additional game or genre concept (each has its own loop; the entry says how this idea uses it), and one per content concept that skins the primary: how its mechanics relate ACROSS to the primary concept\'s (an entry naming mechanics of one concept only is rejected); [] only for a single game or genre with nothing to skin', items: { type: 'object', additionalProperties: false, required: ['relation', 'mechanics', 'why'], properties: {
        relation: { type: 'string', enum: RELATIONS, description: 'nested: its loop runs inside the primary\'s, entered on the primary mechanic named first (a creature battle deciding a chess capture); union: both loops run in one space; skin: only its content and cast fill the primary\'s slots, its loop is not played' },
        mechanics: { type: 'array', items: str, description: 'ids (exactly as in mechanics[].id) from BOTH concepts: first the primary concept\'s mechanic it joins into (for nested, the primary event that enters its loop), then the joined concept\'s own loop mechanic (whatever the relation), then its other mechanics' }, why: str } } },
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
    ...(isStr(core.loop) && core.loop ? { loop: core.loop.slice(0, 60) } : {}),
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
 * The two sides of a mashup entry, by concept (mechanic.from): `outer` the mechanics of its first mechanic's concept
 * (the idea joined into), `inner` the rest (the joined idea). An entry within one concept has no outer side.
 * @param {Mashup} entry @param {Array<{ id: string, from: string }>} mechanics @returns {{ outer: string[], inner: string[] }}
 */
export function mashupSides(entry, mechanics) {
  const fromOf = new Map(mechanics.map(m => [m.id, ideaKey(m.from)]));
  const first = fromOf.get(entry.mechanics[0]) || '';
  const outer = entry.mechanics.filter(id => (fromOf.get(id) || '') === first);
  return outer.length === entry.mechanics.length ? { outer: [], inner: [...entry.mechanics] } : { outer, inner: entry.mechanics.filter(id => !outer.includes(id)) };
}

/** @typedef {'mashup_unknown_mechanic' | 'mashup_within_concept' | 'mashup_joined_concepts' | 'mashup_outer' | 'mashup_loop_missing' | 'mashup_relation_loop' | 'mashup_duplicate' | 'mashup_missing'} ConceptMashupCode */

/**
 * The decomposition's own mashup check (decompose.js, step 3), run before any primitive is mapped: the same rule as
 * mashupProblem over the idea's concepts instead of mapped loops. A concept has a loop when it declares one
 * (concept.loop: the id of its loop mechanic; every game and genre concept does, whatever the idea does with it), and
 * the primary concept is the one whose loop is the spec's `loop`. Every entry names known mechanic ids and relates them
 * ACROSS concepts (mechanic.from = concept id): first the primary's mechanic it joins into, then ONE joined concept's
 * mechanics, which include that concept's loop mechanic when it has one, whatever the relation; nested and union need
 * a loop on the joined side (a content concept joins as skin); and every concept with a loop other than the primary is
 * joined by exactly one entry (no concept by two). null when the mashup is complete.
 * @param {{ concepts: Array<{ id: string, loop?: string }>, mechanics: Array<{ id: string, from: string }>, mashup: Mashup[], loop?: string }} spec
 * @returns {{ code: ConceptMashupCode, message: string } | null}
 */
export function conceptMashupProblem({ concepts, mechanics, mashup, loop = '' }) {
  const fromOf = new Map(mechanics.map(m => [m.id, ideaKey(m.from)]));
  /** concept key -> its loop mechanic id. @type {Map<string, string>} */
  const loops = new Map(concepts.filter(c => isStr(c.loop) && c.loop).map(c => [ideaKey(c.id), String(c.loop)]));
  const primary = [...loops].find(([, id]) => id === loop)?.[0] || null;
  /** @type {Array<{ code: ConceptMashupCode, message: string }>} */
  const found = [];
  /** joined concept key -> how many entries join it. @type {Map<string, number>} */
  const joins = new Map();
  const label = (/** @type {Mashup} */ x) => `${x.relation} [${x.mechanics.join(', ')}]`;
  for (const x of mashup) {
    const unknown = x.mechanics.filter(id => !fromOf.has(id));
    if (unknown.length) { found.push({ code: 'mashup_unknown_mechanic', message: `${label(x)} names ${unknown.join(', ')}, which are not mechanic ids` }); continue; }
    const sides = mashupSides(x, mechanics);
    if (!sides.outer.length) { found.push({ code: 'mashup_within_concept', message: `${label(x)} relates mechanics of one concept only (${fromOf.get(x.mechanics[0]) || 'none'}): an entry relates mechanics ACROSS concepts` }); continue; }
    const outer = fromOf.get(sides.outer[0]) || '', inner = [...new Set(sides.inner.map(id => fromOf.get(id) || ''))];
    if (inner.length > 1) { found.push({ code: 'mashup_joined_concepts', message: `${label(x)} joins ${inner.join(' and ')} at once: one entry per joined concept` }); continue; }
    const joined = inner[0];
    joins.set(joined, (joins.get(joined) || 0) + 1);
    if (primary && outer !== primary) { found.push({ code: 'mashup_outer', message: `${label(x)} joins ${joined} into ${outer}, but the primary concept is ${primary} (its loop ${loop}): an entry joins a concept into the primary, its first id a mechanic of ${primary}` }); continue; }
    if (!loops.has(outer)) { found.push({ code: 'mashup_relation_loop', message: `${label(x)} needs a loop from ${outer}, which has only content: an entry joins INTO the primary concept's loop (put its mechanic first)` }); continue; }
    const own = loops.get(joined);
    if (own && !x.mechanics.includes(own)) found.push({ code: 'mashup_loop_missing', message: `${label(x)} joins ${joined} without its loop mechanic ${own}: name ${own} right after the primary's mechanic, whatever the relation (skin leaves it unplayed)` });
    else if (!own && x.relation !== 'skin') found.push({ code: 'mashup_relation_loop', message: `${label(x)} needs a loop from ${joined}, which has only content: a concept without a loop of its own joins as skin, or not at all` });
  }
  const twice = [...joins].filter(([, n]) => n > 1).map(([k]) => k);
  if (twice.length) found.push({ code: 'mashup_duplicate', message: `${twice.join(', ')} ${twice.length === 1 ? 'is' : 'are'} joined by more than one entry: exactly one entry per joined concept` });
  // With the primary known, every other concept with a loop is joined; without it, each is linked on some side.
  const linked = primary ? new Set([primary, ...joins.keys()]) : new Set(mashup.filter(x => mashupSides(x, mechanics).outer.length).flatMap(x => x.mechanics.map(id => fromOf.get(id) || '')));
  const unlinked = [...loops.keys()].filter(c => !linked.has(c));
  if (loops.size >= 2 && unlinked.length) found.push({ code: 'mashup_missing', message: `${[...loops.keys()].join(', ')} each have their own loop (${[...loops.values()].join(', ')}), but no entry links ${unlinked.join(', ')}: give exactly one entry per joined game or genre concept, first the primary concept's mechanic it joins into, then the joined concept's loop mechanic, then its other mechanics, related nested, union or skin` });
  return found.length ? { code: found[0].code, message: found.map(f => f.message).join('; ') } : null;
}

/**
 * The loop mechanics the idea does not play: a concept's own loop (concept.loop) that a skin relation marked flavor
 * (decompose.js). Selection never builds them (build.js worklist, select.js). Read from ids and importance only.
 * @param {{ concepts?: Array<{ loop?: string }>, mechanics?: Array<{ id: string, importance: string }> }} decomposition @returns {Set<string>}
 */
export const unplayedLoops = decomposition => new Set((decomposition.concepts || []).map(c => c.loop)
  .filter(/** @returns {id is string} */ id => isStr(id) && (decomposition.mechanics || []).some(m => m.id === id && m.importance === 'flavor')));

/**
 * What a mashup check found: the joined ideas whose loops each declare their own win, which of them no relation
 * across concepts links (mashup_missing), and the entries that relate mechanics within one concept only
 * (mashup_within_concept: rejected, the field is asked again).
 * @typedef {{ code: 'mashup_missing' | 'mashup_within_concept', ideas: Array<{ from: string, mechanics: string[], loops: string[] }>, unlinked: string[], within: Mashup[], message: string }} MashupProblem
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
  // Only an entry that relates mechanics across concepts links them; one within a single concept relates nothing.
  const concepts = (/** @type {Mashup} */ x) => new Set(x.mechanics.map(id => fromOf.get(id)).filter(Boolean));
  const across = core.mashup.filter(x => concepts(x).size >= 2), within = core.mashup.filter(x => concepts(x).size < 2);
  const linked = new Set(across.flatMap(x => [...concepts(x)]));
  const unlinked = [...ideas.keys()].filter(k => !linked.has(k));
  if (!unlinked.length && !within.length) return null;
  const list = [...ideas.values()];
  const what = `the idea combines ${list.map(i => `${i.from} (${i.mechanics.join(', ')} -> ${i.loops.join(', ')})`).join(' and ')}, whose loops each declare their own win (card.loop.win)`;
  const how = 'each core.mashup entry relates mechanics ACROSS concepts: first the primary idea\'s mechanic it joins into, then the joined idea\'s mechanics (nested | union | skin, by mechanic id)';
  if (within.length) return { code: 'mashup_within_concept', ideas: list, unlinked, within,
    message: `${what}, but ${within.map(x => `${x.relation} [${x.mechanics.join(', ')}]`).join(' and ')} relate${within.length === 1 ? 's' : ''} mechanics of one concept only (${within.map(x => [...concepts(x)].join(', ') || 'none').join('; ')}): ${how}` };
  return { code: 'mashup_missing', ideas: list, unlinked, within,
    message: `${what}, but no mashup relation links ${unlinked.join(', ')} across concepts: ${how}` };
}
