// @ts-check
// Idea decomposition (ARCHITECTURE.md §4, step 0): a request names games,
// genres, settings and characters; each reference contributes mechanics. The
// result is catalogue-independent on purpose (mechanics are written as verbs
// and structures, not primitive ids), so a mechanic no primitive covers shows
// up as a gap instead of being silently bent into something that exists.
import { parseReply } from './writer.js';
import { coreSchema, normalizeCore, undecidedCore, isAvatar } from './play-spec.js';
import { obj, list, objects, isStr, messageOf } from '../kernel/guards.js';

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
 * @property {string} movement  ground | air | water | track | none (MOVEMENT)
 * @property {number} acts
 * @property {number} zones
 * @property {import('./play-spec.js').Core} [core]  the play spec (with a registry)
 */
/** decomposeIdea()'s result: the decomposition plus where it came from. @typedef {Decomposition & { source: string, ms: number, error?: string, attempts?: number }} DecompositionResult */

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
  required: ['title', 'premise', 'references', 'mechanics', 'spaces', 'views', 'movement', 'acts', 'zones', 'tone'],
  properties: {
    title: str, premise: str, tone: str,
    references: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'kind', 'keeps'], properties: {
      name: str, kind: { type: 'string', enum: ['game', 'genre', 'setting', 'character', 'other'] }, keeps: { type: 'array', items: str } } } },
    mechanics: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'verb', 'description', 'from', 'importance'], properties: {
      id: str, verb: str, description: str, from: str, importance: { type: 'string', enum: ['core', 'supporting', 'flavor'] } } } },
    spaces: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['role', 'kind', 'description'], properties: {
      role: str, kind: { type: 'string', enum: SPACE_KINDS }, description: str } } },
    views: { type: 'array', items: { type: 'string', enum: VIEWS } },
    movement: { type: 'string', enum: MOVEMENT },
    acts: { type: 'integer' }, zones: { type: 'integer' },
  },
};

const SYSTEM = `You decompose a player's game idea into what it is made of, before any game is built.
- references: every game, genre, setting or character the idea names or clearly implies. For each, "keeps" lists what the idea takes from it (its core loop and defining mechanics, or only its setting/characters/look).
- mechanics: the concrete mechanics the game needs, as short verb-led phrases that make sense in any game ("real-time melee combat with stamina and dodge rolls", "catch wild creatures and keep a party", "turn-based battles between party members", "mine and place blocks", "drive vehicles", "talk to characters with dialogue choices"). A mashup keeps the defining mechanics of EVERY game it references, unless the idea says otherwise. Mark the core loop "core". Don't invent mechanics the idea doesn't need. id is a lowercase slug.
- spaces: the kinds of space the game is played in (an overworld and a separate battle screen are two spaces). kind: continuous-3d, continuous-2d, tiles-side (side view), tiles-topdown, board (discrete turn-based grid), locations (rooms/places joined by exits), none (cards, menus, dialogue).
- views: camera/presentation views (1p 3p td side iso board ui text). The FIRST view is the game's main camera: keep the genre's own (a platformer is side, a top-down farm is td, a 3D adventure is 3p, a board or puzzle grid is board, a card game is ui).
- movement: how the player's avatar moves most of the time: ground (walking, running, jumping, driving on foot-level terrain), air (flying is the core loop), water (swimming/sailing is the core loop), track (lanes or a fixed course), none (no avatar: cards, boards, falling pieces, menus).
- acts and zones: a sensible size for a first version (acts 2-4, zones 3-8).
- title: an evocative working title. premise: two sentences. tone: a few words.
Example names are illustrations only; decompose THIS idea.`;

const CORE = `- core: the play spec, in the idea's own terms. The core loop itself is the "core" mechanics above (a mashup keeps the core mechanics of BOTH ideas); here say only how it is played. interaction: how the player plays it (avatar-realtime, avatar-grid, pieces-turns, cursor-board, menu). opponent: who plays against the player. win / lose: how the core loop is won and lost (checkmate, finish first, clear every line, catch the culprit, a full harvest). narrative: true only when the idea has a story told in acts. mashup: for a mashup, how each joined idea's core mechanics (by id) relate to the rest: nested (a loop entered from the other, e.g. a creature battle deciding a chess capture), union (both loops in one space), skin (only its content and cast); [] for a single idea.`;

/** The decomposition schema; with a registry it includes the play spec (`core`). @param {RegistryLike | null} [registry] */
export function decompositionSchema(registry = null) {
  if (!registry) return DECOMPOSITION_SCHEMA;
  return { ...DECOMPOSITION_SCHEMA, required: [...DECOMPOSITION_SCHEMA.required, 'core'], properties: { ...DECOMPOSITION_SCHEMA.properties, core: coreSchema() } };
}

/**
 * Decompose with a writer (strict schema). A failing call is asked again, up to `attempts` calls; when every one
 * fails the decomposition fails with what each attempt reported (a 422 naming the stage), never an offline guess in
 * its place. Without a writer the offline decomposition is the explicit offline mode.
 * @param {{ writer?: Writer | null, prompt: string, answers?: Answer[], registry?: RegistryLike | null, attempts?: number }} options
 * @returns {Promise<DecompositionResult>}
 */
export async function decomposeIdea({ writer = null, prompt, answers = [], registry = null, attempts = 2 }) {
  const started = performance.now();
  const user = `Idea: ${prompt}${answers.length ? `\nPreferences: ${answers.map(a => `${a.question}: ${a.answer}`).join('; ')}` : ''}`;
  if (writer) {
    /** @type {string[]} */
    const failed = [];
    for (let i = 0; i < Math.max(1, attempts); i++) {
      try {
        const ask = failed.length ? `${user}\n\nYour previous reply failed (${failed[failed.length - 1]}). Reply with the decomposition as one JSON object.` : user;
        const reply = await writer.complete({ system: registry ? `${SYSTEM}\n${CORE}` : SYSTEM, user: ask, schema: { name: 'decomposition', schema: registry ? decompositionSchema(registry) : DECOMPOSITION_SCHEMA } });
        const d = normalize(parseReply(reply.text), prompt, registry);
        if (!d.mechanics.some(m => m.importance === 'core')) { failed.push('no core mechanic: the core loop is the idea\'s core mechanics'); continue; }
        return { ...d, source: reply.model, ms: Math.round(performance.now() - started), ...(failed.length ? { attempts: failed.length + 1 } : {}) };
      } catch (error) { failed.push(String(messageOf(error) || error).slice(0, 160)); }
    }
    throw Object.assign(Error(`The idea could not be decomposed after ${failed.length} attempt(s): ${failed.join('; ')}`), { status: 422, code: 'decomposition_failed', attempts: failed });
  }
  return { ...decomposeOffline(prompt, answers, registry), ms: Math.round(performance.now() - started) };
}

/** @param {unknown} s */
const slug = s => (String(s || '').toLowerCase().match(/[a-z0-9]+/g) || ['x']).join('_').slice(0, 40);
/** @param {unknown} v @param {number} lo @param {number} hi @param {number} d @returns {number} */
const clampInt = (v, lo, hi, d) => typeof v === 'number' && Number.isInteger(v) ? Math.max(lo, Math.min(hi, v)) : d;

/**
 * A decomposition from model output (or the offline path): `d` is unknown and narrowed field by field.
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
    references: objects(d.references).slice(0, 8).map(r => ({ name: String(r.name || '').slice(0, 80), kind: String(r.kind || 'other'), keeps: list(r.keeps).map(String).slice(0, 8) })),
    mechanics: mechanics.slice(0, 16),
    spaces: objects(d.spaces).slice(0, 4).map(s => ({ role: String(s.role || 'world').slice(0, 40), kind: SPACE_KINDS.includes(s.kind) ? String(s.kind) : 'locations', description: String(s.description || '').slice(0, 200) })),
    views: list(d.views).filter(v => VIEWS.includes(v)).map(String),
    movement: isStr(d.movement) && MOVEMENT.includes(d.movement) ? d.movement : movementFrom(JSON.stringify(mechanics).toLowerCase()),
    acts: clampInt(d.acts, 1, 6, 3), zones: clampInt(d.zones, 2, 12, 5),
  };
  // The play spec: the model's (narrowed); without one (the offline mode) the collection decides what it would have said.
  if (registry) {
    out.core = normalizeCore(d.core) || undecidedCore(out);
    // Mashup relations name mechanics by the ids the model wrote: the same slugs as the mechanics.
    out.core.mashup = out.core.mashup.map(m => ({ ...m, mechanics: m.mechanics.map(slug).filter(id => mechanics.some(x => x.id === id)) })).filter(m => m.mechanics.length);
    // No avatar, no avatar movement: the medium follows the interaction (an undecided one decides nothing here).
    if (out.core.interaction && !isAvatar(out.core.interaction)) out.movement = 'none';
  }
  return out;
}

/** The avatar's medium from mechanic text when no model said: ground unless the idea flies, swims or runs a track. @param {string} text @returns {string} */
export const movementFrom = text => /\b(fly|flying|flight|soar\w*|jetpack|airship|plane)\b/.test(text) ? 'air' : /\b(swim\w*|underwater|dive|diving|sail\w*)\b/.test(text) ? 'water' : /\b(runner|lanes?)\b/.test(text) ? 'track' : 'ground';

/** @param {string} prompt */
const titleFrom = prompt => (prompt.match(/[A-Za-z0-9']+/g) || ['Untitled']).slice(0, 5).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');

// A generic verb vocabulary for the offline path: what a sentence asks the player to DO.
// It is not a genre table; each entry is a mechanic any game may combine with any other.
/** @type {Array<[string, string, RegExp]>} */
const VERBS = [
  ['explore', 'explore places and travel between them', /\b(explor\w*|wander\w*|travel\w*|journey\w*|adventur\w*|map|world|roam\w*)\b/],
  ['talk', 'talk to characters', /\b(talk\w*|dialog\w*|conversation\w*|chat\w*|npcs?|villagers?|interrogat\w*|persuad\w*)\b/],
  ['story', 'follow a story with chapters and an ending', /\b(story|stories|narrative|plot|quest\w*|mystery|detective|chapter\w*|tale)\b/],
  ['collect', 'find and collect items', /\b(collect\w*|gather\w*|pick\w* up|loot\w*|treasure\w*|coins?|keys?|items?|find\w*)\b/],
  ['fight', 'fight enemies in real time', /\b(fight\w*|combat|battl\w*|attack\w*|swords?|enem(y|ies)|boss\w*|duel\w*|souls?like|monsters?)\b/],
  ['shoot', 'shoot projectiles at targets', /\b(shoot\w*|guns?|blast\w*|lasers?|rifles?|snip\w*|bullets?|shooter)\b/],
  ['jump', 'run and jump across platforms', /\b(jump\w*|platform\w*|leap\w*|hop\w*)\b/],
  ['build', 'build and place structures or blocks', /\b(build\w*|construct\w*|place\w* blocks?|blocks?|sandbox|voxel\w*)\b/],
  ['mine', 'mine or dig terrain for resources', /\b(min(e|ing)|dig\w*|excavat\w*|ores?)\b/],
  ['craft', 'craft items from recipes', /\b(craft\w*|recipes?|forg(e|ing)|brew\w*|cook\w*)\b/],
  ['drive', 'drive or pilot vehicles', /\b(driv\w*|cars?|vehicles?|rac(e|ing)|kart\w*|pilot\w*|ships?|steer\w*)\b/],
  ['catch', 'catch or recruit creatures and keep a party', /\b(catch\w*|captur\w*|tam(e|ing)|recruit\w*|creatures?|pets?|party)\b/],
  ['turns', 'take turns in tactical or turn-based encounters', /\b(turn[- ]based|tactic\w*|turns?|chess|board ?game|grid)\b/],
  ['puzzle', 'solve puzzles and open locks', /\b(puzzl\w*|riddl\w*|solv\w*|locks?|levers?|switch\w*|match[- ]?3)\b/],
  ['sneak', 'sneak past guards unseen', /\b(sneak\w*|stealth\w*|hid(e|ing)|guards?|spy|spies)\b/],
  ['trade', 'buy and sell with shops and currency', /\b(shops?|trad(e|ing)|buy\w*|sell\w*|merchants?|money|gold|econom\w*)\b/],
  ['survive', 'survive hazards, hunger or a timer', /\b(surviv\w*|hunger|thirst|zombies?|hazards?|timer|countdown|escape)\b/],
  ['grow', 'level up, gain abilities and upgrades', /\b(level\w* up|xp|experience|upgrad\w*|abilit(y|ies)|skills?|rpg)\b/],
  ['farm', 'grow crops and tend animals', /\b(farm\w*|crops?|harvest\w*|garden\w*|plant\w*)\b/],
];

/**
 * Offline decomposition: references split from the sentence, mechanics from the verb vocabulary. Deterministic.
 * @param {string} prompt @param {Answer[]} [answers] @param {RegistryLike | null} [registry] @returns {Decomposition & { source: string }}
 */
export function decomposeOffline(prompt, answers = [], registry = null) {
  const text = `${prompt} ${answers.map(a => a.answer).join(' ')}`;
  const lower = text.toLowerCase();
  const parts = prompt.split(/\s*(?:×|\bx\b|\+|\bmeets\b|\bcrossed with\b|\bmixed with\b|\bwith\b|\bin the style of\b|\bplus\b|,|&)\s*/i).map(s => s.trim()).filter(s => s.length > 1);
  const references = parts.length > 1 ? parts.slice(0, 6).map(name => ({ name: name.slice(0, 80), kind: 'other', keeps: [] })) : [];
  const mechanics = VERBS.filter(([, , re]) => re.test(lower)).map(([id, description]) => ({ id, verb: id, description, from: '', importance: 'core' }));
  // Only what the sentence asks for: no exploring or story is added to an idea that does not name them.
  const views = [/\bfirst[- ]person\b|\bfps\b/.test(lower) && '1p', /\bthird[- ]person\b|\b3d\b/.test(lower) && '3p', /\btop[- ]down\b/.test(lower) && 'td', /\bside[- ]?scroll\w*\b|\bplatform\w*\b/.test(lower) && 'side', /\btext\b|\bstory\b|\bmystery\b/.test(lower) && 'text'].filter(Boolean);
  return { ...normalize({ title: titleFrom(prompt), premise: prompt, references, mechanics, spaces: [], views, acts: 3, zones: 5, tone: '' }, prompt, registry), source: 'offline' };
}
