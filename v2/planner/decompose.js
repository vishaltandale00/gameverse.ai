// Idea decomposition (ARCHITECTURE.md §4, step 0): a request names games,
// genres, settings and characters; each reference contributes mechanics. The
// result is catalogue-independent on purpose (mechanics are written as verbs
// and structures, not primitive ids), so a mechanic no primitive covers shows
// up as a gap instead of being silently bent into something that exists.
import { parseReply } from './writer.js';

export const DECOMPOSITION_VERSION = 'decompose/0.1';
const SPACE_KINDS = ['continuous-3d', 'continuous-2d', 'tiles-side', 'tiles-topdown', 'board', 'locations', 'none'];
const VIEWS = ['1p', '3p', 'td', 'side', 'iso', 'board', 'ui', 'text'];
const str = { type: 'string' };
export const DECOMPOSITION_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['title', 'premise', 'references', 'mechanics', 'spaces', 'views', 'acts', 'zones', 'tone'],
  properties: {
    title: str, premise: str, tone: str,
    references: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'kind', 'keeps'], properties: {
      name: str, kind: { type: 'string', enum: ['game', 'genre', 'setting', 'character', 'other'] }, keeps: { type: 'array', items: str } } } },
    mechanics: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'verb', 'description', 'from', 'importance'], properties: {
      id: str, verb: str, description: str, from: str, importance: { type: 'string', enum: ['core', 'supporting', 'flavor'] } } } },
    spaces: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['role', 'kind', 'description'], properties: {
      role: str, kind: { type: 'string', enum: SPACE_KINDS }, description: str } } },
    views: { type: 'array', items: { type: 'string', enum: VIEWS } },
    acts: { type: 'integer' }, zones: { type: 'integer' },
  },
};

const SYSTEM = `You decompose a player's game idea into what it is made of, before any game is built.
- references: every game, genre, setting or character the idea names or clearly implies. For each, "keeps" lists what the idea takes from it (its core loop and defining mechanics, or only its setting/characters/look).
- mechanics: the concrete mechanics the game needs, as short verb-led phrases that make sense in any game ("real-time melee combat with stamina and dodge rolls", "catch wild creatures and keep a party", "turn-based battles between party members", "mine and place blocks", "drive vehicles", "talk to characters with dialogue choices"). A mashup keeps the defining mechanics of EVERY game it references, unless the idea says otherwise. Mark the core loop "core". Don't invent mechanics the idea doesn't need. id is a lowercase slug.
- spaces: the kinds of space the game is played in (an overworld and a separate battle screen are two spaces). kind: continuous-3d, continuous-2d, tiles-side (side view), tiles-topdown, board (discrete turn-based grid), locations (rooms/places joined by exits), none (cards, menus, dialogue).
- views: camera/presentation views (1p 3p td side iso board ui text).
- acts and zones: a sensible size for a first version (acts 2-4, zones 3-8).
- title: an evocative working title. premise: two sentences. tone: a few words.
Example names are illustrations only; decompose THIS idea.`;

/** Decompose with a writer (strict schema), falling back to the offline decomposition on any failure. */
export async function decomposeIdea({ writer = null, prompt, answers = [] }) {
  const started = performance.now();
  const user = `Idea: ${prompt}${answers.length ? `\nPreferences: ${answers.map(a => `${a.question}: ${a.answer}`).join('; ')}` : ''}`;
  if (writer) {
    try {
      const reply = await writer.complete({ system: SYSTEM, user, schema: { name: 'decomposition', schema: DECOMPOSITION_SCHEMA } });
      const d = normalize(parseReply(reply.text), prompt);
      return { ...d, source: reply.model, ms: Math.round(performance.now() - started) };
    } catch (error) {
      return { ...decomposeOffline(prompt, answers), ms: Math.round(performance.now() - started), error: String(error.message || error).slice(0, 160) };
    }
  }
  return { ...decomposeOffline(prompt, answers), ms: Math.round(performance.now() - started) };
}

const slug = s => (String(s || '').toLowerCase().match(/[a-z0-9]+/g) || ['x']).join('_').slice(0, 40);
const clampInt = (v, lo, hi, d) => Number.isInteger(v) ? Math.max(lo, Math.min(hi, v)) : d;

export function normalize(d, prompt = '') {
  const seen = new Set();
  const mechanics = (Array.isArray(d?.mechanics) ? d.mechanics : []).map(m => {
    let id = slug(m.id || m.verb || m.description);
    while (seen.has(id)) id += '_';
    seen.add(id);
    return { id, verb: String(m.verb || '').slice(0, 60), description: String(m.description || m.verb || '').slice(0, 240), from: String(m.from || '').slice(0, 80), importance: ['core', 'supporting', 'flavor'].includes(m.importance) ? m.importance : 'supporting' };
  });
  return {
    version: DECOMPOSITION_VERSION,
    title: String(d?.title || titleFrom(prompt)).slice(0, 80),
    premise: String(d?.premise || prompt).slice(0, 600),
    tone: String(d?.tone || '').slice(0, 80),
    references: (Array.isArray(d?.references) ? d.references : []).slice(0, 8).map(r => ({ name: String(r.name || '').slice(0, 80), kind: r.kind || 'other', keeps: (r.keeps || []).map(String).slice(0, 8) })),
    mechanics: mechanics.slice(0, 16),
    spaces: (Array.isArray(d?.spaces) ? d.spaces : []).slice(0, 4).map(s => ({ role: String(s.role || 'world').slice(0, 40), kind: SPACE_KINDS.includes(s.kind) ? s.kind : 'locations', description: String(s.description || '').slice(0, 200) })),
    views: (Array.isArray(d?.views) ? d.views : []).filter(v => VIEWS.includes(v)),
    acts: clampInt(d?.acts, 1, 6, 3), zones: clampInt(d?.zones, 2, 12, 5),
  };
}

const titleFrom = prompt => (prompt.match(/[A-Za-z0-9']+/g) || ['Untitled']).slice(0, 5).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');

// A generic verb vocabulary for the offline path: what a sentence asks the player to DO.
// It is not a genre table; each entry is a mechanic any game may combine with any other.
const VERBS = [
  ['explore', 'explore places and travel between them', /\b(explor\w*|wander\w*|travel\w*|journey\w*|adventur\w*|map|world|roam\w*)\b/],
  ['talk', 'talk to characters', /\b(talk\w*|dialog\w*|conversation\w*|chat\w*|npcs?|villagers?|interrogat\w*|persuad\w*)\b/],
  ['story', 'follow a story told in acts and beats', /\b(story|stories|narrative|plot|quest\w*|mystery|detective|chapter\w*|tale)\b/],
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

/** Offline decomposition: references split from the sentence, mechanics from the verb vocabulary. Deterministic. */
export function decomposeOffline(prompt, answers = []) {
  const text = `${prompt} ${answers.map(a => a.answer).join(' ')}`;
  const lower = text.toLowerCase();
  const parts = prompt.split(/\s*(?:×|\bx\b|\+|\bmeets\b|\bcrossed with\b|\bmixed with\b|\bwith\b|\bin the style of\b|\bplus\b|,|&)\s*/i).map(s => s.trim()).filter(s => s.length > 1);
  const references = parts.length > 1 ? parts.slice(0, 6).map(name => ({ name: name.slice(0, 80), kind: 'other', keeps: [] })) : [];
  const mechanics = VERBS.filter(([, , re]) => re.test(lower)).map(([id, description]) => ({ id, verb: id, description, from: '', importance: 'core' }));
  if (!mechanics.some(m => m.id === 'explore')) mechanics.push({ id: 'explore', verb: 'explore', description: 'explore places and travel between them', from: '', importance: mechanics.length ? 'supporting' : 'core' });
  if (!mechanics.some(m => m.id === 'story')) mechanics.push({ id: 'story', verb: 'story', description: 'follow a story told in acts and beats', from: '', importance: 'supporting' });
  const views = [/\bfirst[- ]person\b|\bfps\b/.test(lower) && '1p', /\bthird[- ]person\b|\b3d\b/.test(lower) && '3p', /\btop[- ]down\b/.test(lower) && 'td', /\bside[- ]?scroll\w*\b|\bplatform\w*\b/.test(lower) && 'side', /\btext\b|\bstory\b|\bmystery\b/.test(lower) && 'text'].filter(Boolean);
  return { ...normalize({ title: titleFrom(prompt), premise: prompt, references, mechanics, spaces: [], views, acts: 3, zones: 5, tone: '' }, prompt), source: 'offline' };
}
