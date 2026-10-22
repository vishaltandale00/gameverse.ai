// @ts-check
// Idea decomposition (ARCHITECTURE.md §4, step 0): a request names games,
// genres, settings and characters; each reference contributes mechanics. The
// result is catalogue-independent on purpose (mechanics are written as verbs
// and structures, not primitive ids), so a mechanic no primitive covers shows
// up as a gap instead of being silently bent into something that exists.
import { parseReply } from './writer.js';
import { coreSchema, normalizeCore, normalizeMashup, undecidedCore, isAvatar, conceptMashupProblem, INTERACTIONS, OPPONENTS, RELATIONS } from './play-spec.js';
import { fieldForm } from './outline-form.js';
import { obj, list, objects, isStr, isObj, messageOf, prop } from '../kernel/guards.js';

/** @typedef {import('./types.js').Writer} Writer */
/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** @typedef {{ question: string, answer: string }} Answer */
/** @typedef {{ name: string, kind: string, keeps: string[] }} Reference */
/** @typedef {'core' | 'supporting' | 'flavor'} Importance */
/** @typedef {{ id: string, verb: string, description: string, from: string, importance: Importance }} Mechanic */
/** @typedef {{ role: string, kind: string, description: string }} SpaceRole */
/**
 * normalize()'s result: catalogue-independent and safe to read (every field narrowed from model output).
 * @typedef {object} Decomposition
 * @property {string} version
 * @property {string} title
 * @property {string} premise
 * @property {string} tone
 * @property {Reference[]} references
 * @property {Mechanic[]} mechanics
 * @property {SpaceRole[]} spaces
 * @property {string[]} views
 * @property {string} movement  ground | air | water | track | none (MOVEMENT); '' when the model did not say
 * @property {number} [acts]  the story's acts: only for a narrative idea, as the model wrote them (never a default)
 * @property {number} [zones]  the story's places: only for a narrative idea, as the model wrote them (never a default)
 * @property {Concept[]} concepts  the idea's source concepts (decomposeIdea step 1); a mechanic's `from` is a concept id
 * @property {import('./play-spec.js').Core} [core]  the play spec (decomposeIdea always writes one; normalize() adds an undecided one with a registry)
 */
/** decomposeIdea()'s result: the decomposition plus where it came from and its model calls. @typedef {Decomposition & { source: string, ms: number, error?: string, calls?: DecomposeCall[] }} DecompositionResult */

export const DECOMPOSITION_VERSION = 'decompose/0.2';
/** @type {readonly unknown[]} */
const SPACE_KINDS = ['continuous-3d', 'continuous-2d', 'tiles-side', 'tiles-topdown', 'board', 'locations', 'none'];
/** @type {readonly unknown[]} */
const VIEWS = ['1p', '3p', 'td', 'side', 'iso', 'board', 'ui', 'text'];
// How the player's avatar moves (movement cards declare the same `medium`); none = no avatar moves (cards, boards, menus).
export const MOVEMENT = ['ground', 'air', 'water', 'track', 'none'];
const str = { type: 'string' };
export const DECOMPOSITION_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['title', 'premise', 'references', 'mechanics', 'spaces', 'views', 'movement', 'tone'],
  properties: {
    title: str, premise: str, tone: str,
    references: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'kind', 'keeps'], properties: {
      name: str, kind: { type: 'string', enum: ['game', 'genre', 'setting', 'character', 'other'] }, keeps: { type: 'array', items: str } } } },
    mechanics: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'verb', 'description', 'from', 'importance'], properties: {
      id: str, verb: str, description: str, from: { type: 'string', description: 'the reference (references[].name) this mechanic comes from' }, importance: { type: 'string', enum: ['core', 'supporting', 'flavor'] } } } },
    spaces: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['role', 'kind', 'description'], properties: {
      role: str, kind: { type: 'string', enum: SPACE_KINDS }, description: str } } },
    views: { type: 'array', items: { type: 'string', enum: VIEWS } },
    movement: { type: 'string', enum: MOVEMENT },
    acts: { type: 'integer' }, zones: { type: 'integer' },
  },
};

const SYSTEM = `You decompose a player's game idea into what it is made of, before any game is built.
- references: every game, genre, setting or character the idea names or clearly implies. For each, "keeps" lists what the idea takes from it (its core loop and defining mechanics, or only its setting/characters/look).
- mechanics: the concrete mechanics the game needs, as short verb-led phrases that make sense in any game ("real-time melee combat with stamina and dodge rolls", "catch wild creatures and keep a party", "turn-based battles between party members", "mine and place blocks", "drive vehicles", "talk to characters with dialogue choices"). A mashup keeps the defining mechanics of EVERY game it references, unless the idea says otherwise, and each joined idea's own loop (how it is played out and won: a creature battle, a race, checkmate) is a mechanic of its own. Mark the core loop of every joined idea "core". "from" names the reference the mechanic comes from. Don't invent mechanics the idea doesn't need. id is a lowercase slug.
- spaces: the kinds of space the game is played in (an overworld and a separate battle screen are two spaces). kind: continuous-3d, continuous-2d, tiles-side (side view), tiles-topdown, board (discrete turn-based grid), locations (rooms/places joined by exits), none (cards, menus, dialogue).
- views: camera/presentation views (1p 3p td side iso board ui text). The FIRST view is the game's main camera: keep the genre's own (a platformer is side, a top-down farm is td, a 3D adventure is 3p, a board or puzzle grid is board, a card game is ui).
- movement: how the player's avatar moves most of the time: ground (walking, running, jumping, driving on foot-level terrain), air (flying is the core loop), water (swimming/sailing is the core loop), track (lanes or a fixed course), none (no avatar: cards, boards, falling pieces, menus).
- acts and zones (a narrative idea only): the story's size for a first version (acts 2-4, zones 3-8).
- title: an evocative working title. premise: two sentences. tone: a few words.
Example names are illustrations only; decompose THIS idea.`;

const CORE = `- core: the play spec, in the idea's own terms. The core loop itself is the "core" mechanics above (a mashup keeps the core mechanics of BOTH ideas); here say only how it is played. interaction: how the player plays it (avatar-realtime, avatar-grid, pieces-turns, cursor-board, menu). opponent: who plays against the player. win / lose: how the core loop is won and lost (checkmate, finish first, clear every line, catch the culprit, a full harvest). narrative: true only when the idea has a story told in acts. mashup: an idea that combines two or more concepts (two games, a game and a genre) each with its own loop IS a mashup: give one entry per joined idea, naming mechanic ids (exactly as in mechanics) from BOTH ideas, first the primary idea's mechanic it joins into, then the joined idea's loop mechanic and its others (an entry within one idea relates nothing and is rejected), and how they relate: nested (its loop runs inside the primary's, entered on the primary mechanic named first, e.g. a creature battle deciding a chess capture), union (both loops run in one space), skin (only its content and cast fill the primary's slots, e.g. Pokémon as the chess pieces; its loop is not played). [] only for a single idea.`;

/** The decomposition schema; with a registry it includes the play spec (`core`). @param {RegistryLike | null} [registry] */
export function decompositionSchema(registry = null) {
  if (!registry) return DECOMPOSITION_SCHEMA;
  return { ...DECOMPOSITION_SCHEMA, required: [...DECOMPOSITION_SCHEMA.required, 'core'], properties: { ...DECOMPOSITION_SCHEMA.properties, core: coreSchema() } };
}

// ---------------------------------------------------------------------------------------------------------------
// The iterative decomposition: small strict forms, each followed by a deterministic check, every enum built from the
// ids the steps before it produced. A failing check re-asks only the field it names (fieldForm); a form the default
// model fails `attempts` times is asked once of the escalation writer (outline.js's rule); a step still failing fails
// the decomposition (422 decomposition_failed) with the step and every finding.
//   1. concepts: the source concepts (games, genres, themes, settings) the idea names or implies, each with its kind.
//      What a concept IS decides whether it has a loop: every game and genre has its own (LOOP_KINDS), the other kinds
//      bring content only. How the idea USES a game's loop is not asked here (step 3);
//   2. mechanics, per concept and in parallel: each game or genre concept's own loop mechanic (always exactly one) and
//      the other mechanics of every concept, from = that concept;
//   3. the play spec, with every loop known: interaction, opponent, the core loop (an enum of the loop mechanics), win
//      and lose as sentences, and the mashup: one entry per additional game or genre concept (relation and mechanic
//      id enums, its loop mechanic named), checked by conceptMashupProblem and, for skin, by skinProblems; a skinned
//      loop is then marked flavor and never selected (play-spec.js unplayedLoops);
//   4. the rest: title/premise/tone, spaces/views(/movement for an avatar), and acts/zones only for a narrative.
// ---------------------------------------------------------------------------------------------------------------

export const CONCEPT_KINDS = ['game', 'genre', 'theme', 'setting', 'character', 'other'];
/** The kinds that always have a loop of their own (a declaration of the concept, not a decision about the idea). */
export const LOOP_KINDS = ['game', 'genre'];
/** Does a concept of this kind have its own loop? @param {{ kind: string }} concept */
export const hasLoop = concept => LOOP_KINDS.includes(concept.kind);
/** A mechanic's role in its concept: its own core loop (one per game or genre concept), or how much the idea needs it. */
export const ROLES = ['loop', 'core', 'supporting', 'flavor'];
// The decomposition's own limits (normalize keeps at most 8 references and 16 mechanics): checked, never truncated.
const MAX_CONCEPTS = 8, MAX_MECHANICS = 16;

/** A concept; `loop` is the id of its loop mechanic (game and genre concepts, from step 2). @typedef {{ id: string, name: string, quote: string, kind: string, keeps: string[], loop?: string }} Concept */
/** @typedef {{ id: string, verb: string, description: string, from: string, role: string }} ConceptMechanic */
/** @typedef {{ loop: string, interaction: string, opponent: string, win: string, lose: string, theme: string, narrative: boolean | null, mashup: import('./play-spec.js').Mashup[] }} SpecDraft */
/** A failing check: the form field it names (re-asked alone) and why. @typedef {{ field: string, message: string }} StepProblem */
/** One model call. @typedef {{ step: string, concept?: string, fields?: string[], model: string | null, ms: number, chars: number, escalated?: boolean, problems?: string[], error?: string }} DecomposeCall */
/** @typedef {{ name: string, schema: Record<string, any> }} StepSchema */

const PREAMBLE = `You decompose a player's game idea into what it is made of, one small step at a time; the earlier steps are given. Example names are illustrations only; decompose THIS idea.`;
const STEP_CONCEPTS = `Step: the idea's source concepts. references: every game, genre, theme, setting or character the idea names or clearly implies, as the idea names it, each with the id of the concept it belongs to. concepts: what those references bring to the idea; a game, genre or theme the idea joins is a concept of its own (an idea that joins two games has two concepts, and "X in a haunted library" has X and the haunted library), while a feature of one concept ("a platformer with double jumps") is not. id: a lowercase slug. name: as the idea names it. quote: the words of the idea that name or imply it, verbatim. kind: what the concept IS: game (a game the idea names), genre (a kind of game), theme, setting, character or other (anything else). A game or genre always has its own core loop; how this idea uses it (its loop, or only its content) is decided in a later step, not here. keeps: what the idea takes from it.`;
const STEP_MECHANICS = `Step: the mechanics ONE concept brings to this idea, as short verb-led phrases that make sense in any game ("catch wild creatures and keep a party", "turn-based battles between party members", "drive vehicles"). Only this concept's own mechanics (every one has from = this concept's id); the other concepts give theirs separately. A game or genre concept always has exactly one mechanic with role "loop": its own core loop as that game is played (how a round of it is played out and won: a chess match, a creature battle, a race), even when the idea may use only its content (a later step decides that); then its other defining mechanics the idea keeps (role core, supporting or flavor). A theme, setting, character or other concept has no loop mechanic: only the mechanics its content needs, often none ([]). Don't invent mechanics the idea doesn't need. id: a lowercase slug, unique in the game.`;
const STEP_SPEC = `Step: the play spec, in the idea's own terms, with every concept's loop given. interaction: how the player plays (avatar-realtime: steers a character in real time; avatar-grid: a character stepping cell by cell; pieces-turns: moves pieces in turns; cursor-board: picks cells or pieces on a board; menu: picks options). opponent: who plays against the player. loop: the loop mechanic the game is built around (the primary concept's). win and lose: each a sentence in the game's own terms saying how the player wins and how the player loses ("checkmate the rival's king", "your king is checkmated"), never an id; lose is '' only when the game cannot be lost. theme: a few words. narrative: true only when the idea has a story told in acts. mashup: how the idea uses each other game or genre concept: exactly one entry per additional game or genre concept, relating mechanics ACROSS concepts: first the primary concept's mechanic it joins into, then the joined concept's own loop mechanic (always, whatever the relation), then its other mechanics; relation nested (its loop runs inside the primary's, entered on the primary mechanic named first: name the primary event that enters it, e.g. a creature battle deciding a chess capture), union (both loops run in one space) or skin (only its content and cast fill the primary's slots, e.g. creatures as the chess pieces; its loop is then not played at all, so the win, the lose and the primary's mechanics must not depend on it). A theme or setting joins as skin or not at all. [] for one game or genre and nothing to skin.`;
/** The SYSTEM rules for the rest (spaces, views, movement, acts and zones, title), one source for both prompts. @param {string[]} keys */
const rules = keys => SYSTEM.split('\n').filter(l => keys.some(k => l.startsWith(`- ${k}`))).join('\n');

/** Step 1's form. @returns {StepSchema} */
export function conceptsSchema() {
  return { name: 'idea_concepts', schema: { type: 'object', additionalProperties: false, required: ['references', 'concepts'], properties: {
    references: { type: 'array', description: 'every game, genre, theme, setting or character the idea names or clearly implies, as the idea names it, with the id of the concept it belongs to', items: { type: 'object', additionalProperties: false, required: ['name', 'concept'], properties: {
      name: str, concept: { type: 'string', description: 'the id of the concept (concepts[].id) it belongs to' } } } },
    concepts: { type: 'array', description: 'every game, genre, theme, setting or character the idea names or clearly implies, each its own concept', items: { type: 'object', additionalProperties: false, required: ['id', 'name', 'quote', 'kind', 'keeps'], properties: {
      id: { type: 'string', description: 'a lowercase slug' }, name: str, quote: { type: 'string', description: 'the words of the idea that name or imply it, verbatim' },
      kind: { type: 'string', enum: CONCEPT_KINDS, description: 'what the concept is: a game or genre always has its own loop; theme, setting, character and other bring content only' },
      keeps: { type: 'array', items: str, description: 'what the idea takes from it' } } } } } } };
}

/** Step 2's form, for one concept: from is that concept's id; only a game or genre concept has the loop role. @param {Concept} concept @returns {StepSchema} */
export function mechanicsSchema(concept) {
  return { name: 'concept_mechanics', schema: { type: 'object', additionalProperties: false, required: ['mechanics'], properties: {
    mechanics: { type: 'array', description: `the mechanics ${concept.id} brings to the idea${hasLoop(concept) ? `, exactly one with role loop (a ${concept.kind} always has its own loop)` : ` (no loop: a ${concept.kind} brings only content)`}`, items: { type: 'object', additionalProperties: false, required: ['id', 'verb', 'description', 'from', 'role'], properties: {
      id: { type: 'string', description: 'a lowercase slug, unique in the game' }, verb: str, description: str, from: { type: 'string', enum: [concept.id] },
      role: { type: 'string', enum: hasLoop(concept) ? ROLES : ROLES.slice(1), description: 'loop: this concept\'s own core loop; core, supporting, flavor: how much the idea needs it' } } } } } } };
}

/** Step 3's form: the play spec with enums of the loop mechanics (loop) and of every mechanic (mashup). @param {string[]} loops @param {string[]} ids @returns {StepSchema} */
export function playSpecSchema(loops, ids) {
  const core = coreSchema(), p = core.properties, items = p.mashup.items;
  return { name: 'play_spec', schema: { ...core, properties: { ...p,
    loop: { ...p.loop, enum: loops, description: 'the loop mechanic the game is built around' },
    win: { type: 'string', description: "how the player wins, as a sentence in the game's own terms, never an id" },
    lose: { type: 'string', description: "how the player loses, as a sentence in the game's own terms, different from win ('' only when the game cannot be lost)" },
    mashup: { ...p.mashup, items: { ...items, properties: { ...items.properties, mechanics: { ...items.properties.mechanics, items: { type: 'string', enum: ids } } } } } } } };
}

/** Step 4's forms: title, premise and tone; spaces and views (movement only with an avatar); acts and zones (narrative only). @param {boolean} avatar */
export function restSchemas(avatar) {
  return {
    about: { name: 'idea_about', schema: { type: 'object', additionalProperties: false, required: ['title', 'premise', 'tone'], properties: { title: str, premise: str, tone: str } } },
    where: { name: 'idea_spaces', schema: { type: 'object', additionalProperties: false, required: ['spaces', 'views', ...(avatar ? ['movement'] : [])], properties: {
      spaces: DECOMPOSITION_SCHEMA.properties.spaces, views: DECOMPOSITION_SCHEMA.properties.views, ...(avatar ? { movement: DECOMPOSITION_SCHEMA.properties.movement } : {}) } } },
    story: { name: 'idea_story', schema: { type: 'object', additionalProperties: false, required: ['acts', 'zones'], properties: { acts: { type: 'integer' }, zones: { type: 'integer' } } } },
  };
}

/** Lowercase words without diacritics (Pokémon = pokemon). @param {unknown} text @returns {string[]} */
const wordsOf = text => String(text || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/[a-z0-9]+/g) || [];
/**
 * Step 1's check, on declarations and the answer alone: concepts exist (at most MAX_CONCEPTS) with unique ids and a known
 * kind; at least one is a game or genre (the kinds that have a loop); and every reference the answer itself names
 * (references[].concept) maps to one of its concepts, so a model that names Pokémon but folds it into chess is asked again.
 * @param {Concept[]} concepts @param {Array<{ name: string, concept: string }>} references @returns {StepProblem[]}
 */
export function conceptProblems(concepts, references) {
  /** @type {string[]} */
  const why = [];
  if (!concepts.length) why.push('no concept: list the games, genres, themes or settings the idea names or implies');
  if (concepts.length > MAX_CONCEPTS) why.push(`${concepts.length} concepts: at most ${MAX_CONCEPTS}`);
  const dup = concepts.map(c => c.id).filter((id, i, a) => a.indexOf(id) !== i);
  if (dup.length) why.push(`ids ${[...new Set(dup)].join(', ')} are used twice: each concept has its own id`);
  const kindless = concepts.filter(c => !CONCEPT_KINDS.includes(c.kind));
  if (kindless.length) why.push(`${kindless.map(c => `${c.id} ('${c.kind.slice(0, 30)}')`).join(', ')} ha${kindless.length === 1 ? 's' : 've'} no kind (${CONCEPT_KINDS.join(', ')})`);
  if (concepts.length && !kindless.length && !concepts.some(hasLoop)) why.push(`no concept is a ${LOOP_KINDS.join(' or ')}: the game or genre whose loop the idea plays is a concept of its own`);
  /** @type {StepProblem[]} */
  const out = why.map(message => ({ field: 'concepts', message }));
  if (!references.length) out.push({ field: 'references', message: 'empty: name every game, genre, theme, setting or character the idea names or implies, with its concept' });
  const ids = new Set(concepts.map(c => c.id));
  const unmapped = references.filter(r => !ids.has(r.concept));
  // Re-asked together: the missing concept is added, or the reference names the concept it belongs to.
  if (unmapped.length) for (const field of ['concepts', 'references']) out.push({ field, message: `${unmapped.map(r => `'${r.name}' (concept '${r.concept}')`).join(', ')} map${unmapped.length === 1 ? 's' : ''} to no concept: every reference the idea names belongs to one of the concepts (give it its own concept, or the id of the one it belongs to)` });
  return out;
}

/**
 * Step 2's check for one concept: every mechanic is from this concept with a known role; a game or genre concept has
 * exactly one loop mechanic (always: what the concept is), any other kind none; ids are unique (within the concept and against `taken`,
 * the other concepts' ids); at most `budget` mechanics (the shape's 16 shared across concepts).
 * @param {ConceptMechanic[]} mechanics @param {Concept} concept @param {number} budget @param {Map<string, string>} [taken] id -> concept
 * @returns {StepProblem[]}
 */
export function mechanicProblems(mechanics, concept, budget, taken = new Map()) {
  /** @type {string[]} */
  const why = [];
  const foreign = mechanics.filter(m => m.from !== concept.id);
  if (foreign.length) why.push(`${foreign.map(m => `${m.id} (from '${m.from}')`).join(', ')} ${foreign.length === 1 ? 'is' : 'are'} not ${concept.id}'s: this form asks only for ${concept.id}'s own mechanics, each with from '${concept.id}'`);
  const unroled = mechanics.filter(m => !ROLES.includes(m.role));
  if (unroled.length) why.push(`${unroled.map(m => m.id).join(', ')} ha${unroled.length === 1 ? 's' : 've'} no role (${ROLES.join(', ')})`);
  const loops = mechanics.filter(m => m.role === 'loop');
  if (hasLoop(concept) && loops.length !== 1) why.push(`${concept.id} is a ${concept.kind}, which always has its own loop, so exactly one of its mechanics has role loop (its core loop, whether or not this idea plays it); it has ${loops.length}${loops.length ? ` (${loops.map(m => m.id).join(', ')})` : ''}`);
  if (!hasLoop(concept) && loops.length) why.push(`${concept.id} is a ${concept.kind}, which brings only content, so it has no loop mechanic (${loops.map(m => m.id).join(', ')})`);
  const dup = mechanics.map(m => m.id).filter((id, i, a) => a.indexOf(id) !== i);
  if (dup.length) why.push(`ids ${[...new Set(dup)].join(', ')} are used twice`);
  const clash = mechanics.filter(m => taken.has(m.id));
  if (clash.length) why.push(`${clash.map(m => `${m.id} is already ${taken.get(m.id)}'s`).join(', ')}: give ${concept.id}'s own mechanics, with ids of their own`);
  const blank = mechanics.filter(m => !m.description.trim());
  if (blank.length) why.push(`${blank.map(m => m.id).join(', ')} ha${blank.length === 1 ? 's' : 've'} no description`);
  if (mechanics.length > budget) why.push(`${mechanics.length} mechanics: at most ${budget} for this concept (the game keeps ${MAX_MECHANICS} across its concepts)`);
  return why.map(message => ({ field: 'mechanics', message }));
}

/**
 * Is a win/lose text written in words rather than as an id? Not empty, and not an id-like token (one token without
 * spaces, such as a slug, or a mechanic or concept id). null when it is. @param {string} text @param {Set<string>} ids @returns {string | null}
 */
export function notASentence(text, ids) {
  const t = text.trim();
  if (!t) return 'empty';
  if (!/\s/.test(t) || ids.has(slug(t))) return `'${t.slice(0, 60)}' is an id-like token`;
  return null;
}

/** Each game or genre concept with its loop mechanic's id (step 2's role loop). @param {Concept[]} concepts @param {ConceptMechanic[]} mechanics @returns {Concept[]} */
export const withLoops = (concepts, mechanics) => concepts.map(c => {
  const loop = hasLoop(c) ? mechanics.find(m => m.from === c.id && m.role === 'loop')?.id : undefined;
  const { loop: _, ...rest } = c;
  return loop ? { ...rest, loop } : rest;
});

/** Does a text name an id (its words, joined by '_', contain the id's)? @param {string} text @param {string} id */
const names = (text, id) => `_${wordsOf(text).join('_')}_`.includes(`_${id}_`);

/**
 * The skin consistency check, on ids and roles only: a skin entry says the joined concept's loop is not played, so
 * nothing the spec keeps may depend on it. When the win or lose sentence, or the description of a core (or loop)
 * mechanic of another concept, names the joined concept's loop mechanic id or one of its mechanic ids with role core,
 * skin is inconsistent and the mashup is asked again. Entries are read as conceptMashupProblem passed them.
 * @param {SpecDraft} spec @param {{ concepts: Concept[], mechanics: ConceptMechanic[] }} so @returns {StepProblem[]}
 */
export function skinProblems(spec, { concepts, mechanics }) {
  /** @type {StepProblem[]} */
  const out = [];
  for (const x of spec.mashup.filter(e => e.relation === 'skin')) {
    const joined = withLoops(concepts, mechanics).find(c => c.loop && c.loop !== spec.loop && x.mechanics.includes(c.loop));
    if (!joined?.loop) continue;
    const ids = [joined.loop, ...mechanics.filter(m => m.from === joined.id && m.role === 'core').map(m => m.id)];
    const named = (/** @type {string} */ text) => ids.filter(id => names(text, id));
    /** @type {string[]} */
    const found = [];
    for (const field of /** @type {const} */ (['win', 'lose'])) { const n = named(spec[field]); if (n.length) found.push(`${field} ('${spec[field].slice(0, 80)}') names ${n.join(', ')}`); }
    for (const m of mechanics.filter(m => m.from !== joined.id && ['loop', 'core'].includes(m.role))) { const n = named(m.description); if (n.length) found.push(`the ${m.role} mechanic ${m.id} names ${n.join(', ')} in its description`); }
    if (found.length) out.push({ field: 'mashup', message: `skin [${x.mechanics.join(', ')}] leaves ${joined.id}'s loop ${joined.loop} unplayed, but ${found.join('; ')}: the game plays it, so relate ${joined.id} as nested (its loop runs inside the primary's, entered on the primary mechanic named first) or union` });
  }
  return out;
}

/**
 * Step 3's check: the loop is a loop mechanic; interaction, opponent and narrative are set; win and lose are sentences
 * in the game's terms and differ (lose may be '' when the game cannot be lost); every mashup entry has a known relation
 * and passes the concept-level mashup check (play-spec.js conceptMashupProblem: one entry per additional game or genre
 * concept, naming its loop mechanic) and, for skin, the consistency check (skinProblems).
 * @param {SpecDraft} spec @param {{ concepts: Concept[], mechanics: ConceptMechanic[] }} so @returns {StepProblem[]}
 */
export function specProblems(spec, { concepts, mechanics }) {
  /** @type {StepProblem[]} */
  const out = [];
  const loops = mechanics.filter(m => m.role === 'loop').map(m => m.id);
  const ids = new Set([...mechanics.map(m => m.id), ...concepts.map(c => c.id)]);
  if (!loops.includes(spec.loop)) out.push({ field: 'loop', message: `'${spec.loop.slice(0, 40)}' is not a loop mechanic (${loops.join(', ')})` });
  if (!INTERACTIONS.includes(spec.interaction)) out.push({ field: 'interaction', message: `'${spec.interaction.slice(0, 40)}' is not one of ${INTERACTIONS.join(', ')}` });
  if (!OPPONENTS.includes(spec.opponent)) out.push({ field: 'opponent', message: `'${spec.opponent.slice(0, 40)}' is not one of ${OPPONENTS.join(', ')}` });
  if (spec.narrative === null) out.push({ field: 'narrative', message: 'true or false' });
  const win = notASentence(spec.win, ids);
  if (win) out.push({ field: 'win', message: `${win}: say how the player wins as a sentence in the game's own terms` });
  const lose = spec.lose.trim() ? notASentence(spec.lose, ids) : null;
  if (lose) out.push({ field: 'lose', message: `${lose}: say how the player loses as a sentence in the game's own terms ('' only when the game cannot be lost)` });
  else if (spec.lose.trim() && wordsOf(spec.lose).join(' ') === wordsOf(spec.win).join(' ')) out.push({ field: 'lose', message: `lose is the same as win ('${spec.win.slice(0, 60)}'): say how the player loses ('' only when the game cannot be lost)` });
  const bad = spec.mashup.filter(x => !RELATIONS.includes(x.relation));
  const mashup = bad.length ? { message: `${bad.map(x => `'${x.relation}'`).join(', ')} ${bad.length === 1 ? 'is' : 'are'} not a relation (${RELATIONS.join(', ')})` } : conceptMashupProblem({ concepts: withLoops(concepts, mechanics), mechanics, mashup: spec.mashup, loop: spec.loop });
  if (mashup) out.push({ field: 'mashup', message: mashup.message });
  else out.push(...skinProblems(spec, { concepts, mechanics }));
  return out;
}

/** Step 1's reply, narrowed (a kind is kept as written: the check reports an unknown one). @param {unknown} v @returns {{ references: Array<{ name: string, concept: string }>, concepts: Concept[] }} */
const narrowConcepts = v => ({ references: objects(prop(v, 'references')).map(r => ({ name: String(r.name || '').slice(0, 80), concept: slug(r.concept) })),
  concepts: objects(prop(v, 'concepts')).map(c => ({ id: slug(c.id || c.name), name: String(c.name || c.id || '').slice(0, 80), quote: String(c.quote || '').slice(0, 120),
  kind: String(c.kind || ''), keeps: list(c.keeps).map(String).slice(0, 8) })) });
/** Step 2's reply, narrowed. @param {unknown} v @returns {{ mechanics: ConceptMechanic[] }} */
const narrowMechanics = v => ({ mechanics: objects(prop(v, 'mechanics')).map(m => ({ id: slug(m.id || m.verb || m.description), verb: String(m.verb || '').slice(0, 60), description: String(m.description || m.verb || '').slice(0, 240), from: String(m.from || ''), role: String(m.role || '') })) });
/** Step 3's reply, narrowed (relations kept as written: the check reports an unknown one, nothing drops it). @param {unknown} v @returns {SpecDraft} */
const narrowSpec = v => {
  const d = obj(v);
  return { loop: isStr(d.loop) && d.loop ? slug(d.loop) : '', interaction: String(d.interaction || ''), opponent: String(d.opponent || ''), win: String(d.win || '').slice(0, 200), lose: String(d.lose || '').slice(0, 200), theme: String(d.theme || '').slice(0, 120),
    narrative: typeof d.narrative === 'boolean' ? d.narrative : null,
    mashup: objects(d.mashup).slice(0, 4).map(m => ({ relation: String(m.relation || ''), mechanics: list(m.mechanics).filter(isStr).map(slug).slice(0, 6), why: String(m.why || '').slice(0, 160) })) };
};

/**
 * One step: its form, then its check; a failing check re-asks only the fields it names (fieldForm over the step's own
 * schema), up to `attempts` calls of the default writer, then once of the escalation writer (effort low, that form
 * only). `start` begins with a field re-ask of a value a later check rejected. Still failing: 422 decomposition_failed.
 * @template {Record<string, unknown>} T
 * @param {{ writer: Writer, escalate: Writer | null, attempts: number, calls: DecomposeCall[], step: string, concept?: string, system: string, user: string,
 *   schema: StepSchema, narrow: (value: unknown) => T, check: (value: T) => StepProblem[], start?: { value: T, problems: StepProblem[] } }} args
 * @returns {Promise<T>}
 */
async function askStep({ writer, escalate, attempts, calls, step, concept, system, user, schema, narrow, check, start }) {
  /** @type {T | null} */
  let value = start ? start.value : null;
  let problems = start ? start.problems : [];
  /** @type {string[]} */
  const failed = [];
  const own = Math.max(1, attempts);
  for (let i = 0; i < own + (escalate ? 1 : 0); i++) {
    const w = i >= own && escalate ? escalate : writer;
    const fields = value && problems.length ? fieldForm(schema, [...new Set(problems.map(p => p.field))]) : null;
    const current = value;
    const ask = fields && current
      ? `${user}\n\nYour answer failed these checks:\n${problems.map(p => `- ${p.field}: ${p.message}`).join('\n')}\nFix ONLY these fields. Current values: ${JSON.stringify(Object.fromEntries(fields.slots.map(s => [s.path, current[s.path]])))}`
      : failed.length ? `${user}\n\nYour previous reply failed (${failed[failed.length - 1]}). Reply with one JSON object.` : user;
    const form = fields ? fields.schema : schema;
    const t0 = performance.now();
    /** @type {DecomposeCall} */
    const call = { step, ...(concept ? { concept } : {}), ...(fields ? { fields: fields.slots.map(s => s.path) } : {}), model: null, ms: 0, chars: system.length + ask.length + JSON.stringify(form.schema).length, ...(w === escalate ? { escalated: true } : {}) };
    calls.push(call);
    try {
      const reply = await w.complete({ system, user: ask, schema: form, ...(w === escalate ? { effort: 'low' } : {}) });
      call.model = reply.model || w.model; call.ms = Math.round(performance.now() - t0);
      const parsed = parseReply(reply.text);
      value = narrow(fields && current ? fields.apply(current, parsed) : parsed);
      problems = check(value);
      if (!problems.length) return value;
      call.problems = problems.map(p => `${p.field}: ${p.message}`.slice(0, 300));
      failed.push(call.problems.join('; '));
    } catch (error) {
      call.ms = Math.round(performance.now() - t0);
      call.error = String(messageOf(error) || error).slice(0, 160);
      failed.push(call.error);
    }
  }
  throw Object.assign(Error(`The idea could not be decomposed: step ${step}${concept ? ` (${concept})` : ''} failed its check after ${failed.length} call(s): ${failed.join(' | ')}`),
    { status: 422, code: 'decomposition_failed', step, ...(concept ? { concept } : {}), attempts: failed, problems: problems.map(p => `${p.field}: ${p.message}`) });
}

/**
 * Decompose an idea, iteratively (the steps above). A writer is required: without one it fails (422
 * step_path_model_missing); nothing reads the idea's words instead. `escalate` is the writer a form the default model fails `attempts` times is asked of, once.
 * @param {{ writer?: Writer | null, escalate?: Writer | null, prompt: string, answers?: Answer[], registry?: RegistryLike | null, attempts?: number }} options
 * @returns {Promise<DecompositionResult>}
 */
export async function decomposeIdea({ writer = null, escalate = null, prompt, answers = [], registry = null, attempts = 2 }) {
  const started = performance.now();
  // The decomposition is the model's: without one nothing is read from the idea's words.
  if (!writer) throw Object.assign(Error('Decomposing the idea needs a model: no words of the idea are read as its mechanics.'), { status: 422, code: 'step_path_model_missing' });
  const idea = `Idea: ${prompt}${answers.length ? `\nPreferences: ${answers.map(a => `${a.question}: ${a.answer}`).join('; ')}` : ''}`;
  /** @type {DecomposeCall[]} */
  const calls = [];
  const base = { writer, escalate, attempts, calls };

  // 1. Concepts.
  const { concepts } = await askStep({ ...base, step: 'concepts', system: `${PREAMBLE}\n${STEP_CONCEPTS}`, user: idea, schema: conceptsSchema(), narrow: narrowConcepts, check: v => conceptProblems(v.concepts, v.references) });
  const has = (/** @type {Concept} */ c) => (hasLoop(c) ? 'has its own loop' : 'content only');
  const conceptList = concepts.map(c => `- ${c.id} (${c.kind}, ${has(c)}): ${c.name}${c.keeps.length ? `; keeps ${c.keeps.join(', ')}` : ''}`).join('\n');

  // 2. Each concept's mechanics, in parallel; then ids unique across concepts (a clash re-asks the later concept).
  const budget = Math.max(1, Math.floor(MAX_MECHANICS / concepts.length));
  const askMechanics = (/** @type {Concept} */ c, /** @type {Map<string, string>} */ taken, /** @type {{ value: { mechanics: ConceptMechanic[] }, problems: StepProblem[] } | undefined} */ start) => askStep({ ...base, step: 'mechanics', concept: c.id, start,
    system: `${PREAMBLE}\n${STEP_MECHANICS}`, user: `${idea}\nConcepts:\n${conceptList}\n\nConcept: ${c.id} (${c.name}; ${c.kind}, ${has(c)}). Its mechanics in this idea.`,
    schema: mechanicsSchema(c), narrow: narrowMechanics, check: v => mechanicProblems(v.mechanics, c, budget, taken) });
  const own = await Promise.all(concepts.map(c => askMechanics(c, new Map(), undefined)));
  /** @type {Map<string, string>} */
  const taken = new Map();
  for (let i = 0; i < concepts.length; i++) {
    const c = concepts[i];
    const clash = mechanicProblems(own[i].mechanics, c, budget, taken);
    if (clash.length) own[i] = await askMechanics(c, new Map(taken), { value: own[i], problems: clash });
    for (const m of own[i].mechanics) taken.set(m.id, c.id);
  }
  // Each concept's loop first, then its others, concepts in the idea's order.
  const mechanics = concepts.flatMap((_, i) => [...own[i].mechanics].sort((a, b) => Number(b.role === 'loop') - Number(a.role === 'loop')));
  const mechanicList = mechanics.map(m => `- ${m.id} [${m.from}, ${m.role}]: ${m.description}`).join('\n');
  const looped = withLoops(concepts, mechanics);
  const loopList = looped.filter(c => c.loop).map(c => `- ${c.id}: ${c.loop}: ${mechanics.find(m => m.id === c.loop)?.description || ''}`).join('\n');

  // 3. The play spec, with every loop known and enums of the ids above; its mashup is checked across concepts.
  const spec = await askStep({ ...base, step: 'play_spec', system: `${PREAMBLE}\n${STEP_SPEC}`,
    user: `${idea}\nConcepts:\n${conceptList}\nMechanics (id [concept, role]: description):\n${mechanicList}\nEach game or genre concept's own loop (concept: loop mechanic: description); every one but the primary's gets exactly one mashup entry naming its loop mechanic:\n${loopList}`,
    schema: playSpecSchema(mechanics.filter(m => m.role === 'loop').map(m => m.id), mechanics.map(m => m.id)), narrow: narrowSpec, check: v => specProblems(v, { concepts, mechanics }) });
  // A skin relation leaves the joined concept's loop unplayed: it is flavor, and selection never builds it.
  const unplayed = new Set(spec.mashup.filter(x => x.relation === 'skin').flatMap(x => looped.filter(c => c.loop && c.loop !== spec.loop && x.mechanics.includes(c.loop)).map(c => String(c.loop))));

  // 4. The rest, as small forms in parallel given the above.
  const so = `${idea}\nConcepts:\n${conceptList}\nMechanics:\n${mechanicList}\nPlay spec: ${JSON.stringify(spec)}`;
  const forms = restSchemas(isAvatar(spec.interaction));
  const nonEmpty = (/** @type {Record<string, unknown>} */ v, /** @type {string[]} */ keys) => keys.filter(k => !String(v[k] || '').trim()).map(field => ({ field, message: 'empty' }));
  const [about, where, story] = await Promise.all([
    askStep({ ...base, step: 'about', system: `${PREAMBLE}\n${rules(['title'])}`, user: so, schema: forms.about, narrow: obj, check: v => nonEmpty(v, ['title', 'premise']) }),
    askStep({ ...base, step: 'spaces', system: `${PREAMBLE}\n${rules(['spaces', 'views', ...(isAvatar(spec.interaction) ? ['movement'] : [])])}`, user: so, schema: forms.where, narrow: obj, check: v => [
      ...(!objects(v.spaces).length || objects(v.spaces).length > 4 || objects(v.spaces).some(s => !SPACE_KINDS.includes(s.kind)) ? [{ field: 'spaces', message: `1-4 spaces, each of kind ${SPACE_KINDS.join(', ')}` }] : []),
      ...(!list(v.views).length || list(v.views).some(x => !VIEWS.includes(x)) ? [{ field: 'views', message: `1 or more of ${VIEWS.join(', ')}, the main camera first` }] : []),
      ...(isAvatar(spec.interaction) && !(isStr(v.movement) && MOVEMENT.includes(v.movement)) ? [{ field: 'movement', message: `one of ${MOVEMENT.join(', ')}` }] : [])] }),
    spec.narrative ? askStep({ ...base, step: 'story', system: `${PREAMBLE}\n${rules(['acts and zones'])}`, user: so, schema: forms.story, narrow: obj, check: v => [
      ...(clampInt(v.acts, 1, 6, 0) !== v.acts ? [{ field: 'acts', message: 'an integer from 1 to 6' }] : []), ...(clampInt(v.zones, 2, 12, 0) !== v.zones ? [{ field: 'zones', message: 'an integer from 2 to 12' }] : [])] }) : Promise.resolve({}),
  ]);

  const d = normalize({ ...story, ...where, ...about, concepts: looped, references: concepts.map(c => ({ name: c.name, kind: c.kind, keeps: c.keeps })),
    mechanics: mechanics.map(m => ({ ...m, importance: m.role === 'loop' ? (unplayed.has(m.id) ? 'flavor' : 'core') : m.role })), core: spec }, prompt, registry);
  return { ...d, source: calls.find(c => c.model)?.model || writer.model, ms: Math.round(performance.now() - started), calls };
}

/** @param {unknown} s */
const slug = s => (String(s || '').toLowerCase().match(/[a-z0-9]+/g) || ['x']).join('_').slice(0, 40);
/** @param {unknown} v @param {number} lo @param {number} hi @param {number} d @returns {number} */
const clampInt = (v, lo, hi, d) => typeof v === 'number' && Number.isInteger(v) ? Math.max(lo, Math.min(hi, v)) : d;

/**
 * A decomposition from model output: `d` is unknown and narrowed field by field.
 * @param {unknown} input @param {string} [prompt] @param {RegistryLike | null} [registry] @returns {Decomposition}
 */
export function normalize(input, prompt = '', registry = null) {
  const d = obj(input);
  const seen = new Set();
  /** @type {readonly unknown[]} */
  const IMPORTANCE = ['core', 'supporting', 'flavor'];
  const mechanics = objects(d.mechanics).map(m => {
    let id = slug(m.id || m.verb || m.description);
    while (seen.has(id)) id += '_';
    seen.add(id);
    return { id, verb: String(m.verb || '').slice(0, 60), description: String(m.description || m.verb || '').slice(0, 240), from: String(m.from || '').slice(0, 80), importance: IMPORTANCE.includes(m.importance) ? /** @type {Importance} */ (m.importance) : 'supporting' };
  });
  /** @type {Decomposition} */
  const out = {
    version: DECOMPOSITION_VERSION,
    title: String(d.title || titleFrom(prompt)).slice(0, 80),
    premise: String(d.premise || prompt).slice(0, 600),
    tone: String(d.tone || '').slice(0, 80),
    concepts: objects(d.concepts).slice(0, MAX_CONCEPTS).map(c => ({ id: slug(c.id || c.name), name: String(c.name || c.id || '').slice(0, 80), quote: String(c.quote || '').slice(0, 120), kind: String(c.kind || 'other'), keeps: list(c.keeps).map(String).slice(0, 8), ...(isStr(c.loop) && c.loop ? { loop: slug(c.loop) } : {}) })),
    references: objects(d.references).slice(0, 8).map(r => ({ name: String(r.name || '').slice(0, 80), kind: String(r.kind || 'other'), keeps: list(r.keeps).map(String).slice(0, 8) })),
    mechanics: mechanics.slice(0, 16),
    spaces: objects(d.spaces).slice(0, 4).map(s => ({ role: String(s.role || 'world').slice(0, 40), kind: SPACE_KINDS.includes(s.kind) ? String(s.kind) : 'locations', description: String(s.description || '').slice(0, 200) })),
    views: list(d.views).filter(v => VIEWS.includes(v)).map(String),
    // As the model said it (the spaces form asks it for an avatar); '' when nothing said it: never read from the words.
    movement: isStr(d.movement) && MOVEMENT.includes(d.movement) ? d.movement : '',
  };
  // The play spec: the model's (narrowed); without one (a hand-written decomposition) the collection decides what it would have said.
  if (registry || isObj(d.core)) {
    out.core =normalizeCore(d.core) || undecidedCore(out);
    out.core.mashup = linkMashup(out.core.mashup, mechanics);
    // No avatar, no avatar movement: the medium follows the interaction (an undecided one decides nothing here).
    if (out.core.interaction && !isAvatar(out.core.interaction)) out.movement = 'none';
  }
  // The story's size exists only for a narrative idea (not one the play spec says is a pure loop), and only as the
  // model wrote it: no act or zone count is ever invented. Place counts come from declarations (presets.js placesFor).
  if (out.core?.narrative !== false) {
    const acts = clampInt(d.acts, 1, 6, 0), zones = clampInt(d.zones, 2, 12, 0);
    if (acts) out.acts = acts;
    if (zones) out.zones = zones;
  }
  return out;
}

/**
 * Mashup relations name mechanics by the ids the model wrote: the same slugs as the mechanics; entries naming none are dropped.
 * @param {import('./play-spec.js').Mashup[]} mashup @param {Array<{ id: string }>} mechanics @returns {import('./play-spec.js').Mashup[]}
 */
export const linkMashup = (mashup, mechanics) => mashup.map(m => ({ ...m, mechanics: m.mechanics.map(slug).filter(id => mechanics.some(x => x.id === id)) })).filter(m => m.mechanics.length);

/**
 * Field-level repair of the play spec's mashup (outline-form fieldForm): when the post-check (play-spec.js
 * mashupProblem, run once mechanics are mapped) finds joined ideas whose loops each declare their own win and no
 * relation links them, only core.mashup goes back to the model, with the check's finding. `recheck` judges each answer
 * (null = complete). Up to `attempts` calls; an answer that still fails is never completed by a guess: the spec fails
 * (422 play_spec_incomplete) with what each attempt reported.
 * @param {{ writer: Writer, decomposition: Decomposition, registry: RegistryLike, problem: { message: string }, recheck: (mashup: import('./play-spec.js').Mashup[]) => { message: string } | null, attempts?: number }} options
 * @returns {Promise<{ mashup: import('./play-spec.js').Mashup[], attempts: number, model: string, ms: number }>}
 */
export async function askMashup({ writer, decomposition, registry, problem, recheck, attempts = 2 }) {
  const started = performance.now();
  const form = fieldForm({ name: 'decomposition', schema: decompositionSchema(registry) }, ['core.mashup']);
  const current = decomposition.core?.mashup || [];
  const facts = `Idea: ${decomposition.title}. ${decomposition.premise}\nReferences: ${decomposition.references.map(r => `${r.name} (${r.kind}; keeps ${r.keeps.join(', ') || 'nothing named'})`).join('; ') || 'none'}\nMechanics (id [from, importance]: description):\n${decomposition.mechanics.map(m => `- ${m.id} [${m.from || '?'}, ${m.importance}]: ${m.description}`).join('\n')}\nPlay spec: ${JSON.stringify({ ...decomposition.core, mashup: undefined })}`;
  /** @type {string[]} */
  const failed = [];
  let finding = problem.message;
  let last = current;
  for (let i = 0; i < Math.max(1, attempts); i++) {
    try {
      const user = `${facts}\n\nThe decomposition is complete except core.mashup, which failed a check: ${finding}\nFix ONLY this field. Current value: ${JSON.stringify(last)}`;
      const reply = await writer.complete({ system: `${SYSTEM}\n${CORE}`, user, schema: form.schema });
      const filled = form.apply({ core: { mashup: current } }, parseReply(reply.text));
      const mashup = linkMashup(normalizeMashup(obj(filled.core).mashup), decomposition.mechanics);
      const still = recheck(mashup);
      last = mashup;
      if (!still) return { mashup, attempts: i + 1, model: reply.model, ms: Math.round(performance.now() - started) };
      finding = still.message;
      failed.push(still.message.slice(0, 200));
    } catch (error) { failed.push(String(messageOf(error) || error).slice(0, 160)); }
  }
  throw Object.assign(Error(`The play spec is incomplete: core.mashup was asked again ${failed.length} time(s) and still fails: ${failed.join('; ')}`), { status: 422, code: 'play_spec_incomplete', attempts: failed });
}

/** @param {string} prompt */
const titleFrom = prompt => (prompt.match(/[A-Za-z0-9']+/g) || ['Untitled']).slice(0, 5).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
