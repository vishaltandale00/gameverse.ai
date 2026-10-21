// @ts-check
// Primitive selection (ARCHITECTURE.md §4): decomposed mechanics -> primitives
// from registry.cards(), then spaces chosen to provide what the chosen
// primitives require (capability-aware, including space configurations whose
// capabilities depend on params). Mechanics nothing covers become gaps.
// A decision model (d1 / OpenAI Decisions) picks among lexical candidates
// when available; otherwise the lexical ranking decides.
import { Logic } from '../kernel/logic.js';
import { isSpace, isGenerator, isGraphics, spaceVariants, requirementsOf, satisfying } from './catalog.js';
import { cardLoop, endsGame } from './loop.js';
import { isAvatar, mashupProblem } from './play-spec.js';
import { askMashup } from './decompose.js';
import { resolveAdapters } from './adapters.js';
import { planWorld, unfurnishable, needSets, contentOfGenerator, targets, isMovement, OUTLINE_AUTHORS } from './world.js';
import { str, messageOf } from '../kernel/guards.js';
import { buildSelection } from './build.js';
import { checkComposition } from './compose-check.js';

/** @typedef {import('../kernel/types.js').CardInput} CardInput */
/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** @typedef {import('../kernel/types.js').RegisteredPrimitive} RegisteredPrimitive */
/** @typedef {import('./types.js').Writer} Writer */
/** @typedef {import('./decompose.js').Decomposition} Decomposition */
/** @typedef {import('./decompose.js').Mechanic} Mechanic */
/** @typedef {import('./decisions.js').DecisionClient} DecisionClient */
/** @typedef {import('./decisions.js').DecisionAnswer} DecisionAnswer */
/** @typedef {CardInput & { id: string }} IdCard */
/** @typedef {{ id: string, score: number }} Candidate */
/** A decomposed mechanic with what selection made of it. @typedef {Mechanic & { candidates: Candidate[], primitives: string[], source: string, score: number }} SelectedMechanic */
/** A chosen space: instance id, primitive, its configuration, the role it plays and the capabilities it then provides. @typedef {{ id: string, use: string, with: Record<string, unknown>, role: string, caps: string[] }} SpaceChoice */
/** @typedef {{ id: string, missing: string[], why: string }} Unmet */
/** @typedef {import('./compose-check.js').AdapterSpec} AdapterSpec */
/** @typedef {import('./compose-check.js').AdapterInstance} AdapterInstance */
/**
 * An uncovered mechanic ('win': the collection declares no way to win). 'adapter' gaps name the primitive no chosen space can host and the adapter that would
 * project it (`signature` a one-line description; `adapter` compose-check's adapter card when it produced one).
 * @typedef {{ mechanic: string, description: string, importance: string, kind: 'no_primitive' | 'capability' | 'adapter' | 'win', why: string, primitive?: string, signature?: string, verdict?: string, adapter?: AdapterSpec }} Gap
 */
/** @typedef {{ view: string | null, medium: string | null, removed: string[], added: string | null, gap?: string }} LocomotionResult */
/** A mechanic's primitive that does not serve the play spec's interaction, and what serves the mechanic instead. @typedef {{ mechanic: string, removed: string, by: string | null, why: string }} InteractionChange */
/** The interaction fit of the mapping (fitInteraction). @typedef {{ interaction: string | null, changes: InteractionChange[] }} InteractionFit */
/** The play spec's mashup post-check (play-spec.js mashupProblem) and its field re-ask. @typedef {{ problem: string, asked: number, mashup: import('./play-spec.js').Mashup[], model?: string, ms?: number, unresolved?: boolean }} MashupCheck */
/** @typedef {{ id: string, space: string | undefined, auto?: boolean }} GeneratorChoice */
/**
 * The iterative build as the selection report keeps it: the space step, every mechanic step (candidates, asks, checks,
 * outcome), the content contracts recorded, model calls and time. @typedef {Omit<import('./build.js').BuildResult, 'mapping' | 'systems' | 'adapters' | 'bind' | 'gaps' | 'space'>} BuildReport
 */
/** A space kind not offered because no registered generator can furnish what it needs. @typedef {{ use: string, missing: string[], why: string }} ExcludedSpace */
/** A generator a mechanic named that targets none of the chosen spaces. @typedef {{ id: string, why: string }} DroppedGenerator */
/**
 * selectPrimitives()'s result.
 * @typedef {object} Selection
 * @property {string} version
 * @property {SelectedMechanic[]} mechanics
 * @property {string[]} systems
 * @property {GeneratorChoice[]} generators
 * @property {Array<{ id: string, space?: string }>} graphics
 * @property {SpaceChoice[]} spaces
 * @property {Record<string, string>} bind  primitive id -> space id (primitives not on the first space)
 * @property {Gap[]} gaps
 * @property {string | null} provider
 * @property {{ locomotion: LocomotionResult, interaction?: InteractionFit, mashup?: MashupCheck }} completeness
 * @property {BuildReport} [build]  the iterative build's step log (build.js), when a model built the collection
 * @property {DroppedGenerator[]} [droppedGenerators]
 * @property {ExcludedSpace[]} [excludedSpaces]
 * @property {AdapterInstance[]} [adapters]  adapter instances (with their config) the preset writes into the document's systems
 * @property {number} ms
 */

export const SELECT_VERSION = 'select/0.1';
export const LEXICAL_ACCEPT = 0.75;    // calibrated in tests/v2-p-pipeline-select.test.js
export const DECISION_ACCEPT = 0.4;

const STOP = new Set('a an the of in on with and or to for from by as at is are be it its into that this their them they you your player players game games can each every any one two three when where which who what than then there these those over under up down out about via per such so not no only also more most some between'.split(' '));
/** @param {string} w */
const stem = w => w.length > 4 ? w.replace(/(ings|ing|ers|er|ed|es|ions|ion|ments|ment|ies|s)$/, m => m === 'ies' ? 'y' : '') : w;
/** @param {unknown} text @returns {string[]} */
export const tokens = text => (String(text || '').toLowerCase().match(/[a-z][a-z0-9]*/g) || []).filter(w => !STOP.has(w) && w.length > 1).map(stem);

// Generic semantic neighbours (mechanic words, not genres): lets "talk to villagers" reach a dialogue card.
const GROUPS = [
  'fight combat attack battle melee hit damage enemy weapon sword strike',
  'shoot projectile ranged gun bullet fire aim',
  'talk dialogue conversation speak say chat line',
  'collect item inventory pickup gather loot carry bag',
  'explore zone location travel room place map exit navigate region',
  'story plot act narrative quest scene',
  'move walk run jump platform movement locomotion',
  'build place block construct structure',
  'mine dig block terrain cell',
  'craft recipe station',
  'drive vehicle car steer ride',
  'catch capture creature party tame recruit',
  'turn tactic board grid initiative',
  'puzzle lock key switch lever solve gate',
  'sneak stealth hide detect vision guard',
  'trade shop buy sell currency money economy price',
  'survive hazard timer health hunger',
  'grow level xp ability upgrade progression stat skill',
  'farm crop plant harvest',
].map(g => g.split(' ').map(stem));
/** @param {string} t */
const neighbours = t => [...new Set(GROUPS.filter(g => g.includes(t)).flat())].filter(x => x !== t);

/** @type {WeakMap<object, Map<string, number>>} */
const cardWeights = new WeakMap();
/** @param {IdCard} card @returns {Map<string, number>} */
function weightsOf(card) {
  const cached = cardWeights.get(card); if (cached) return cached;
  /** @type {Map<string, number>} */
  const w = new Map(), put = (/** @type {string} */ text, /** @type {number} */ weight) => { for (const t of tokens(text)) w.set(t, Math.max(w.get(t) || 0, weight)); };
  put(card.id.split('.').slice(1).join(' '), 3);
  put((card.provides?.actions || []).join(' '), 3);
  put(card.intent, 1);
  put((card.provides?.events || []).map(e => e.replace(/[:_*]/g, ' ')).join(' '), 1.5);
  put((card.provides?.vars || []).join(' ').replace(/\./g, ' '), 1);
  put((card.reads || []).join(' ').replace(/\./g, ' '), 1);
  put(Object.keys(card.params || {}).join(' ').replace(/([a-z])([A-Z])/g, '$1 $2'), 0.5);
  cardWeights.set(card, w);
  return w;
}

/**
 * Lexical relevance of a card to a mechanic (0 = unrelated; ≥ LEXICAL_ACCEPT = a match).
 * @param {{ verb: string, description: string }} mechanic @param {IdCard} card @returns {number}
 */
export function relevance(mechanic, card) {
  const direct = [...new Set(tokens(`${mechanic.verb} ${mechanic.description}`))];
  if (!direct.length) return 0;
  const w = weightsOf(card);
  let total = 0;
  for (const t of direct) total += Math.max(w.get(t) || 0, ...neighbours(t).map(n => (w.get(n) || 0) * 0.5));
  return +(total / Math.sqrt(direct.length)).toFixed(3);
}

/** @param {{ verb: string, description: string }} mechanic @param {IdCard[]} cards @param {number} [limit] @returns {Candidate[]} */
export function rankCandidates(mechanic, cards, limit = 6) {
  return cards.map(card => ({ id: card.id, score: relevance(mechanic, card) })).filter(c => c.score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
}

/**
 * Does a card serve the play spec's interaction, by its declarations? Locomotion cards (card.locomotion) move an
 * avatar: they serve avatar interactions only. Cards that list the interactions they serve (card.interactions, e.g.
 * input) serve those. Nothing else is constrained here; an undecided interaction constrains nothing.
 * @param {any} card @param {string | null | undefined} interaction
 */
export function servesInteraction(card, interaction) {
  if (!interaction || !card) return true;
  if (card.locomotion) return isAvatar(interaction);
  if (Array.isArray(card.interactions)) return card.interactions.includes(interaction);
  return true;
}

/** @param {string[]} names verbs or event names @returns {string[]} */
const nameTokens = names => tokens(names.join(' ').replace(/[:_*.]/g, ' '));

/**
 * How well a card's declarations fit a mechanic played the play spec's way, or null when they do not. Required: a
 * declared loop (card.loop / card.mode with verbs or progress), the interaction served (servesInteraction), and, for a
 * loop declared for another interaction that would own the game (a game-ending win: falling pieces for chess), a
 * mechanic a mashup relation joins (`joined`). The score is the declarations first: the loop's verbs and progress events
 * fitting the mechanic, its verbs doing what `verbs` did (the primitive being replaced), the loop declared for this
 * interaction, how participants take part (card.engage: joining a side without an avatar, the player entity with one);
 * then the card's lexical relevance. A card with no fit at all scores null.
 * @param {{ verb: string, description: string }} mechanic @param {any} card
 * @param {{ interaction?: string | null, joined?: boolean, verbs?: string[] }} [options]
 * @returns {number | null}
 */
export function declaredFit(mechanic, card, { interaction = null, joined = false, verbs = [] } = {}) {
  const loop = cardLoop(card);
  if (!loop || (!loop.verbs.length && !loop.progress.length) || !servesInteraction(card, interaction)) return null;
  const other = Boolean(interaction && loop.interaction && loop.interaction !== interaction);
  if (other && endsGame(loop.win) && !joined) return null;
  const direct = [...new Set(tokens(`${mechanic.verb} ${mechanic.description}`))];
  const hits = (/** @type {string[]} */ words) => { const w = new Set(words); return direct.filter(t => w.has(t) || neighbours(t).some(n => w.has(n))).length; };
  const own = nameTokens(loop.verbs), was = new Set(nameTokens(verbs));
  const declared = hits(own) * 2 + hits(nameTokens(loop.progress)) + Math.min(2, own.filter(t => was.has(t)).length * 2)
    + (interaction && loop.interaction === interaction ? 3 : other ? -1 : 0)
    + (interaction && card.engage ? (isAvatar(interaction) ? (card.engage.player ? 1 : 0) : (card.engage.join ? 1 : 0)) : 0);
  const score = declared + relevance(mechanic, card);
  return score > 0 ? +score.toFixed(3) : null;
}

/** Does a card's loop do what the given verbs did (shares a verb token)? @param {any} card @param {string[]} verbs */
export const sharesVerbs = (card, verbs) => { const was = new Set(nameTokens(verbs)); return nameTokens(cardLoop(card)?.verbs || []).some(t => was.has(t)); };

/**
 * The mapping fits the play spec's interaction (card declarations): a primitive mapped to a mechanic that does not
 * serve the interaction (avatar locomotion for pieces moved in turns) is removed from it, and what it did is served by
 * the primitive whose loop is declared for the interaction and does it (its loop verbs share the removed one's: piece
 * movement belongs to the turns loop's move, never to avatar steps). Already mapped first, else the best declared fit
 * in the catalogue (declaredFit). Mutates the mechanics' primitive lists; returns what it changed.
 * @param {{ mechanics: SelectedMechanic[], interaction: string | null, registry: RegistryLike, cards: IdCard[], joined?: (mechanic: string) => boolean }} options
 * @returns {InteractionFit}
 */
export function fitInteraction({ mechanics, interaction, registry, cards, joined = () => false }) {
  /** @type {InteractionChange[]} */
  const changes = [];
  if (!interaction) return { interaction, changes };
  for (const m of mechanics) {
    const off = m.primitives.filter(id => !servesInteraction(registry.get(id)?.card, interaction));
    if (!off.length) continue;
    m.primitives = m.primitives.filter(id => !off.includes(id));
    for (const id of off) {
      const card = registry.get(id)?.card;
      const was = cardLoop(card)?.verbs || [];
      const playedHere = (/** @type {any} */ c) => cardLoop(c)?.interaction === interaction && (!was.length || sharesVerbs(c, was));
      const kept = m.primitives.find(x => playedHere(registry.get(x)?.card));
      const found = kept ? null : cards.filter(c => /^(gameplay|plot)\./.test(c.id) && playedHere(c))
        .map(c => ({ id: c.id, score: declaredFit(m, c, { interaction, joined: joined(m.id), verbs: was }) }))
        .filter(c => c.score !== null).sort((a, b) => Number(b.score) - Number(a.score) || a.id.localeCompare(b.id))[0]?.id || null;
      if (found) m.primitives.push(found);
      const by = kept || found;
      const how = card?.locomotion ? 'is avatar locomotion (card.locomotion)' : `serves ${(card?.interactions || []).join(', ') || 'other interactions'} (card.interactions)`;
      changes.push({ mechanic: m.id, removed: id, by, why: `${id} ${how}; the play spec is ${interaction}${by ? `: ${by} declares the loop played that way (card.loop verbs ${(cardLoop(registry.get(by)?.card)?.verbs || []).join(', ')})` : ': no catalogue primitive declares a loop played that way that does it'}` });
    }
  }
  return { interaction, changes };
}

/** @typedef {{ predicates: Record<string, string>, effects: Record<string, string> }} VocabIndex */
/** @type {WeakMap<object, VocabIndex>} */
const vocabCache = new WeakMap();
/** Which primitive registers each predicate and effect kind (kernel built-ins excluded). @param {RegistryLike} registry @returns {VocabIndex} */
export function vocabIndex(registry) {
  const cached = vocabCache.get(registry); if (cached) return cached;
  const base = new Logic(), builtinP = new Set(base.predicates.keys()), builtinE = new Set(base.effects.keys());
  /** @type {VocabIndex} */
  const out = { predicates: {}, effects: {} };
  for (const id of registry.ids()) {
    const p = /** @type {RegisteredPrimitive} */ (registry.get(id)); if (!p.logic) continue;
    const l = new Logic();
    try { p.logic(l); } catch { continue; }
    for (const k of l.predicates.keys()) if (!builtinP.has(k)) out.predicates[k] ??= id;
    for (const k of l.effects.keys()) if (!builtinE.has(k)) out.effects[k] ??= id;
  }
  vocabCache.set(registry, out);
  return out;
}

// Structural hints for a decomposed space kind: capabilities and views it implies (generic, not genre).
/** @type {Record<string, { caps: string[], views: string[] }>} */
export const KIND_HINTS = {
  'continuous-3d': { caps: ['surface', 'raycast', 'gravity'], views: ['1p', '3p', 'iso'] },
  'continuous-2d': { caps: ['overlap'], views: ['td', 'side'] },
  'tiles-side': { caps: ['gravity', 'editCells'], views: ['side'] },
  'tiles-topdown': { caps: ['editCells'], views: ['td'] },
  board: { caps: ['occupancy', 'los'], views: ['board', 'td', 'iso'] },
  locations: { caps: ['navigate'], views: ['text', 'map'] },
  none: { caps: [], views: ['ui'] },
};

/** @param {unknown} role @param {number} i */
export const spaceSlug = (role, i) => ((String(role || 'world').toLowerCase().match(/[a-z0-9]+/g) || ['world']).join('_').slice(0, 30) || 'world') + (i ? `_${i}` : '');

/**
 * Choose spaces so every chosen primitive's required capabilities are provided. The primary
 * space satisfies the most primitives; primitives it can't host are bound to a second space
 * (a variant of any space primitive) that can, and only then reported as unmet.
 * @param {RegistryLike} registry @param {string[]} primitiveIds
 * @param {{ views?: string[], spaces?: Decomposition['spaces'] }} [decomposition]
 * @param {string[]} [prefer] @param {string[]} [exclude]
 * @returns {{ spaces: SpaceChoice[], bind: Record<string, string>, unmet: Unmet[], excluded: ExcludedSpace[] }}
 */
export function chooseSpaces(registry, primitiveIds, decomposition = {}, prefer = [], exclude = []) {
  let spaceIds = registry.ids('engine').filter(id => isSpace(id) && !exclude.includes(id));
  // Something moves through the world: a space kind whose declared needs (card.needs.content) no registered
  // generator can build would be a void, so it is not offered (when another space kind can be).
  /** @type {ExcludedSpace[]} */
  const excluded = [];
  if (primitiveIds.some(id => isMovement(registry, id))) {
    const ok = spaceIds.filter(id => { const missing = unfurnishable(registry, id); if (missing.length) excluded.push({ use: id, missing, why: `no registered generator builds ${missing.join(', ')} for ${id}` }); return !missing.length; });
    if (ok.length) spaceIds = ok; else excluded.length = 0;
  }
  const variants = spaceIds.flatMap(id => spaceVariants(registry, id).map(v => ({ use: id, ...v, card: /** @type {RegisteredPrimitive} */ (registry.get(id)).card })));
  /** @typedef {typeof variants[number]} Variant */
  /** @typedef {{ id: string, caps: string[] }} Needer */
  const needers = primitiveIds.filter(id => !isSpace(id)).map(id => ({ id, caps: requirementsOf(registry, id).capabilities }));
  const wantViews = new Set([...(decomposition.views || []), ...(decomposition.spaces || []).flatMap(s => KIND_HINTS[s.kind]?.views || [])]);
  const hint = decomposition.spaces?.[0] ? KIND_HINTS[decomposition.spaces[0].kind] : null;
  /** @param {Variant} v @param {Needer} n */
  const fits = (v, n) => n.caps.every(c => v.caps.has(c));
  /** @param {Variant} v @param {Needer[]} pool @param {string | undefined} kind */
  const score = (v, pool, kind) => {
    const k = kind ? KIND_HINTS[kind] : hint;
    const views = (v.card.views || []).filter(x => wantViews.has(x) || x === 'any').length;
    const kindFit = k ? k.caps.filter(c => v.caps.has(c)).length - (k.caps.length && !k.caps.some(c => v.caps.has(c)) ? 2 : 0) : 0;
    return pool.filter(n => fits(v, n)).length * 10 + views * 2 + kindFit * 3 + (prefer.includes(v.use) ? 6 : 0) - v.caps.size * 0.05 - Object.keys(v.with).length * 0.5;
  };
  /** @param {Needer[]} pool @param {string | undefined} kind */
  const pick = (pool, kind) => variants.map(v => ({ v, s: score(v, pool, kind) })).sort((a, b) => b.s - a.s || a.v.use.localeCompare(b.v.use))[0]?.v || null;
  /** @type {SpaceChoice[]} */
  const spaces = [];
  /** @type {Record<string, string>} */
  const bind = {};
  /** @type {Unmet[]} */
  const unmet = [];
  if (!variants.length) return { spaces, bind, excluded, unmet: needers.map(n => ({ id: n.id, missing: n.caps, why: 'no space primitive is registered' })) };
  // pick() returns null only when there are no variants, handled above.
  const primary = /** @type {Variant} */ (pick(needers, decomposition.spaces?.[0]?.kind));
  spaces.push({ id: spaceSlug(decomposition.spaces?.[0]?.role, 0), use: primary.use, with: primary.with, role: decomposition.spaces?.[0]?.role || 'world', caps: [...primary.caps] });
  let rest = needers.filter(n => !fits(primary, n));
  for (let i = 1; rest.length && i < 3; i++) {
    const role = decomposition.spaces?.[i];
    const next = /** @type {Variant} */ (pick(rest, role?.kind));
    const hosted = rest.filter(n => fits(next, n));
    if (!hosted.length) break;
    const id = spaceSlug(role?.role || hosted[0].id.split('.').pop(), spaces.some(s => s.id === spaceSlug(role?.role || hosted[0].id.split('.').pop(), 0)) ? i : 0);
    spaces.push({ id, use: next.use, with: next.with, role: role?.role || hosted.map(h => h.id.split('.').pop()).join('+'), caps: [...next.caps] });
    for (const h of hosted) bind[h.id] = id;
    rest = rest.filter(n => !hosted.includes(n));
  }
  for (const n of rest) {
    const best = spaces.map(s => ({ s, missing: n.caps.filter(c => !s.caps.includes(c)) })).sort((a, b) => a.missing.length - b.missing.length)[0];
    unmet.push({ id: n.id, missing: best?.missing || n.caps, why: `no registered space provides ${n.caps.join(', ')}` });
  }
  // Extra space roles the idea asks for (an overworld and an interior) that nothing bound yet stay one space: the outline may add more.
  return { spaces, bind, unmet, excluded };
}

/**
 * Best renderer per space and overlay UI: graphics cards that name the space, then view overlap.
 * @param {RegistryLike} registry @param {SpaceChoice[]} spaces @returns {Array<{ id: string, space?: string }>}
 */
export function chooseGraphics(registry, spaces) {
  /** @type {Array<{ id: string, space?: string }>} */
  const out = [];
  const cards = registry.cards('graphics');
  spaces.forEach((s, i) => {
    const views = new Set(registry.get(s.use)?.card.views || []);
    const ranked = cards.map(c => {
      const names = (c.requires?.primitives || []).some(r => s.use === r || s.use.startsWith(r + '.')) ? 10 : 0;
      const capsOk = (c.requires?.capabilities || []).every(x => s.caps.includes(x));
      const overlap = (c.views || []).filter(v => views.has(v) || v === 'any').length;
      return { id: c.id, score: capsOk ? names + overlap * 2 : -1, overlay: (c.views || []).includes('overlay') };
    }).filter(c => c.score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    if (ranked[0]) out.push({ id: ranked[0].id, space: i ? s.id : undefined });
  });
  for (const c of cards) if ((c.views || []).includes('overlay') && !out.some(o => o.id === c.id) && out.length < spaces.length + 2 && /\.ui\./.test(c.id)) out.push({ id: c.id });
  return out;
}

const DECIDE = 'Which listed primitive implements this mechanic as the game needs it? Answer "none" if none of them really does (a related but different mechanic is "none").';

/**
 * @param {{ decomposition: Decomposition, registry: RegistryLike, decisions?: DecisionClient | null, writer?: Writer | null, log?: (msg: string) => void, excludeSpaces?: string[], attempts?: number }} options
 * @returns {Promise<Selection>}
 */
export async function selectPrimitives({ decomposition, registry, decisions = null, writer = null, log = () => {}, excludeSpaces = [], attempts = 2 }) {
  const started = performance.now();
  // Spaces compete too: a mechanic a space provides (travelling between places) prefers that space.
  const cards = registry.cards().filter(c => !isGraphics(c.id));
  // primitives, source and score are set for every mechanic in the loop below (in this key order).
  /** @type {SelectedMechanic[]} */
  const mechanics = decomposition.mechanics.map(m => ({ ...m, candidates: rankCandidates(m, cards), primitives: [], source: '', score: 0 }));
  // The model maps onto the cards that serve the play spec's interaction (no avatar locomotion for pieces moved in turns).
  const playedAs = decomposition.core?.interaction || null;
  // With a model, the collection is built iteratively (build.js): the space first, then one mechanic at a time, each
  // pick checked (composition, closure, adapters) before the next. Offline, decisions or the lexical ranking map them.
  const built = writer?.complete ? await buildSelection({ decomposition, registry, writer, log, excludeSpaces, attempts }) : null;
  /** @type {Record<string, DecisionAnswer> | null} */
  let decided = null;
  /** @type {string | null} */
  let provider = built ? 'build' : null;
  if (!built && decisions && mechanics.some(m => m.candidates.length)) {
    try {
      const questions = Object.fromEntries(mechanics.filter(m => m.candidates.length).map(m => [m.id, { type: 'choice', instructions: `${DECIDE}\nMechanic: ${m.description}`,
        criteria: { ...Object.fromEntries(m.candidates.map(c => [c.id, /** @type {RegisteredPrimitive} */ (registry.get(c.id)).card.intent.slice(0, 300)])), none: 'None of these implements it.' } }]));
      const r = await decisions.decide({ state: `Game idea: ${decomposition.premise}`, questions });
      decided = r.answers; provider = r.provider;
    } catch (error) { log(`selection decisions failed: ${messageOf(error)}`); }
  }
  /** @type {Set<string>} */
  const chosen = new Set(built?.systems || []);
  /** @type {Gap[]} */
  const gaps = [...(built?.gaps || [])];
  for (const m of mechanics) {
    const map = built?.mapping[m.id];
    if (map) {
      m.primitives = [...map.primitives]; m.candidates = map.candidates;
      m.source = 'build'; m.score = map.primitives.length ? 1 : 0;
      continue;
    }
    const top = m.candidates[0];
    const answer = decided?.[m.id];
    /** @type {string | null} */
    let pick = null, source = 'lexical';
    if (answer?.choice) {
      const probabilities = answer.probabilities; // choice answers carry { option: p }
      const p = (probabilities && !Array.isArray(probabilities) ? probabilities[answer.choice] : undefined) ?? answer.confidence ?? 0;
      source = provider || 'decision';
      if (answer.choice !== 'none' && p >= DECISION_ACCEPT && registry.has(answer.choice)) pick = answer.choice;
      else if (answer.choice === 'none' && p >= 0.5) pick = null;
      else pick = top && top.score >= LEXICAL_ACCEPT ? top.id : null;
    } else pick = top && top.score >= LEXICAL_ACCEPT ? top.id : null;
    // Co-providers: other cards nearly as relevant (a combat mechanic usually needs health too).
    const extra = pick ? m.candidates.filter(c => c.id !== pick && c.score >= Math.max(LEXICAL_ACCEPT * 1.5, (m.candidates.find(x => x.id === pick)?.score || 0) * 0.85)) : [];
    m.primitives = pick ? [pick, ...extra.map(c => c.id)] : [];
    m.source = source; m.score = m.candidates.find(c => c.id === pick)?.score ?? top?.score ?? 0;
    m.primitives.forEach(id => chosen.add(id));
    if (!pick) gaps.push({ mechanic: m.id, description: m.description, importance: m.importance, kind: 'no_primitive', why: m.candidates.length ? `closest primitives (${m.candidates.slice(0, 3).map(c => c.id).join(', ')}) don't implement it` : 'no primitive covers it' });
  }
  // The mapping fits how the idea is played: what does not serve the interaction leaves its mechanic, and what it did
  // is served by the loop declared for the interaction (fitInteraction), else the mechanic is a gap.
  const joinedBy = (/** @type {string} */ id) => (decomposition.core?.mashup || []).some(x => x.mechanics.includes(id));
  const interactionFit = fitInteraction({ mechanics, interaction: playedAs, registry, cards, joined: joinedBy });
  for (const c of interactionFit.changes) {
    if (!mechanics.some(m => m.primitives.includes(c.removed))) chosen.delete(c.removed);
    if (c.by) chosen.add(c.by);
    const m = mechanics.find(x => x.id === c.mechanic);
    if (m && !m.primitives.length && !gaps.some(g => g.mechanic === m.id)) gaps.push({ mechanic: m.id, description: m.description, importance: m.importance, kind: 'no_primitive', why: c.why });
  }
  // The play spec's post-check: joined ideas whose loops each declare their own win need a mashup relation. Only that
  // field goes back to the model (askMashup, field-level); without a model the finding is recorded, never guessed.
  /** @type {MashupCheck | undefined} */
  let mashupCheck;
  const core = decomposition.core;
  const primitivesOf = (/** @type {string} */ id) => mechanics.find(m => m.id === id)?.primitives || [];
  const problem = core ? mashupProblem(decomposition, primitivesOf, registry) : null;
  if (core && problem) {
    if (writer?.complete) {
      const r = await askMashup({ writer, decomposition, registry, problem, attempts, recheck: mashup => mashupProblem({ mechanics: decomposition.mechanics, core: { ...core, mashup } }, primitivesOf, registry) });
      core.mashup = r.mashup;
      mashupCheck = { problem: problem.message, asked: r.attempts, mashup: r.mashup, model: r.model, ms: r.ms };
    } else {
      core.problems = [...new Set([...(core.problems || []), problem.message])];
      mashupCheck = { problem: problem.message, asked: 0, mashup: core.mashup, unresolved: true };
    }
  }
  // Foundations: the story runner (reads plot.storyboard) only when the play spec says the idea has a story told in
  // acts (an undecided spec leaves it to the mechanics' mapping), and whatever registers the item vocabulary.
  const vocab = vocabIndex(registry);
  if (decomposition.core?.narrative === true) for (const c of cards) if ((c.reads || []).includes('plot.storyboard')) { chosen.add(c.id); break; }
  for (const k of ['give_item']) if (vocab.effects[k]) chosen.add(vocab.effects[k]);
  // Requirements closure and conflicts.
  for (let changed = true; changed;) {
    changed = false;
    for (const id of [...chosen]) for (const req of requirementsOf(registry, id).primitives) {
      if ([...chosen].some(x => x === req || x.startsWith(req + '.'))) continue;
      const s = satisfying(registry, req); if (s) { chosen.add(s); changed = true; }
    }
  }
  for (const id of [...chosen]) for (const c of registry.get(id)?.card.conflicts || []) if (chosen.has(c) && c !== id) chosen.delete(c);
  // Input mapping: when anything offers player actions, the catalogue's input primitive (if one is registered) binds them.
  if ([...chosen].some(id => registry.get(id)?.card.provides?.actions?.length)) {
    const input = registry.cards('engine').filter(c => c.id.startsWith('engine.input.') && servesInteraction(c, playedAs)).map(c => ({ id: c.id, score: relevance({ verb: 'map', description: 'map device keys and buttons to player verbs and actions' }, c) })).sort((a, b) => b.score - a.score)[0];
    if (input) chosen.add(input.id);
  }

  // The core loops declare the spaces they are made for (card.loop / card.mode space). The first core primitive (in the
  // idea's order) played the way the play spec says (its declared interaction) and declaring a registered space that
  // shows the idea's views (a card table for a ui-only card battle, a board for chess) makes it the world: primitives
  // it cannot host become adapter gaps below rather than pulling the game into another space. A declared space that
  // does not show the idea's views, or a loop the spec does not say is played that way, is not forced.
  const wantViews = decomposition.views || [];
  const coreLoops = mechanics.filter(m => m.importance === 'core').flatMap(m => m.primitives).map(id => cardLoop(registry.get(id)?.card)).filter(l => l && playedAs && l.interaction === playedAs);
  const modeSpace = coreLoops.map(l => (l?.space || []).find(e => typeof e === 'string' && registry.has(e) && !excludeSpaces.includes(e)
    && (registry.get(e)?.card.views || []).some((/** @type {string} */ v) => v === 'any' || wantViews.includes(v)))).find(Boolean);
  const prefer = [...chosen].filter(isSpace);
  for (const id of prefer) chosen.delete(id);
  const lockOut = modeSpace ? registry.ids('engine').filter(id => isSpace(id) && id !== modeSpace) : [];
  // A built collection keeps the space it was built on (never swapped): only what was added after it (the story
  // runner, the vocabulary owner, the input) is checked against it here.
  const { spaces, bind, unmet, excluded: excludedSpaces = [] } = built
    ? { spaces: [built.space], bind: { ...built.bind }, unmet: unhosted(registry, [...chosen], built.space, built.bind, built.adapters), excluded: [] }
    : chooseSpaces(registry, [...chosen], decomposition, prefer, [...new Set([...excludeSpaces, ...lockOut])]);
  // A primitive no chosen space can host stays the user's intent: a core mechanic's primitive becomes an adapter gap
  // (the gap layer writes the adapter that projects it onto the space, gated by tests and the playtest agent), never
  // a quiet downgrade. The document published meanwhile leaves it out (it could not install).
  /** @type {AdapterInstance[]} */
  const adapters = [...(built?.adapters || [])];
  // Bindings to the chosen spaces (not to adapter regions): adapters are resolved from them, for the whole collection.
  const spaceIds = new Set(spaces.map(s => s.id));
  for (const u of unmet) {
    chosen.delete(u.id);
    // A registered adapter that projects what the space lacks keeps the primitive: its instances (with their config)
    // replace the selection's and the primitive is bound to the adapter's region (adapters.js resolveAdapters, run on
    // the whole collection so the adapters already chosen are resolved again with it).
    /** @type {import('./adapters.js').AdapterResolution | null} */
    let r = null;
    const own = Object.fromEntries(Object.entries(bind).filter(([, s]) => spaceIds.has(s)));
    try { r = resolveAdapters({ spaces, systems: [...chosen, u.id], bind: own }, registry); } catch { r = null; }
    if (r?.verdict === 'compatible-via-adapter') {
      chosen.add(u.id);
      for (const k of Object.keys(bind)) delete bind[k];
      Object.assign(bind, own, r.bind);
      adapters.splice(0, adapters.length, ...r.adapters);
      continue;
    }
    // An adapter projects a primitive onto a space that lacks what it needs; when NO registered space provides it,
    // the missing piece is a space capability (a capability gap), not an adapter.
    const hostable = registry.ids('engine').filter(isSpace).some(id => spaceVariants(registry, id).some(v => u.missing.every(c => v.caps.has(c))));
    const core = hostable && mechanics.some(m => m.importance === 'core' && m.primitives.includes(u.id));
    // The adapter that would fix it (adapterSignature, an AdapterSpec card) goes to the gap layer; it is described in one line.
    const adapter = r?.gaps[0] || r?.before.signature || undefined;
    const signature = `${u.id} -> ${spaces[0]?.use || 'space'} (${u.missing.join(', ')})${adapter?.id ? ` as ${adapter.id}` : ''}`;
    const verdict = r ? { verdict: r.verdict } : null;
    for (const m of mechanics) if (m.primitives.includes(u.id)) {
      m.primitives = m.primitives.filter(x => x !== u.id);
      if (core && m.importance === 'core') gaps.push({ mechanic: m.id, description: `needs adapter: ${signature}`, importance: 'core', kind: 'adapter', primitive: u.id, signature, ...(adapter ? { adapter } : {}), verdict: verdict?.verdict || 'incompatible-needs-adapter', why: `${u.id} needs ${u.missing.join(', ')}, which ${spaces[0]?.use || 'the space'} does not provide; an adapter primitive can project it` });
      else if (!m.primitives.length) gaps.push({ mechanic: m.id, description: m.description, importance: m.importance, kind: 'capability', why: `${u.id} needs ${u.missing.join(', ')}, which no registered space provides` });
    }
  }
  // Base locomotion follows the idea: the primary view and the avatar's medium (cards declare locomotion and medium).
  const loco = locomotionCompleteness({ decomposition, registry, chosen, space: spaces[0], mechanics });
  if (loco.gap) gaps.push({ mechanic: 'movement', description: `needs movement: ${loco.gap}`, importance: 'core', kind: 'no_primitive', why: `${loco.gap}; the world is kept, not swapped` });
  // Mechanics the chosen space itself provides (travelling between its places) are not gaps: ask the decision
  // model once for every no-primitive gap, else fall back to lexical relevance against the space card.
  // A built collection already offered the space for each mechanic it may serve (build.js): its gaps stand.
  const noPrim = built ? [] : gaps.filter(g => g.kind === 'no_primitive');
  if (noPrim.length && spaces.length) {
    const spaceCards = spaces.map(s => ({ id: s.use, .../** @type {RegisteredPrimitive} */ (registry.get(s.use)).card }));
    /** @type {Set<string>} */
    let covered = new Set();
    if (decisions) {
      try {
        const r = await decisions.decide({ state: `Game idea: ${decomposition.premise}\nSpaces: ${spaceCards.map(c => `${c.id}: ${c.intent}`).join(' | ')}`, questions: Object.fromEntries(noPrim.map((g, i) => [`g${i}`, { type: 'noul', instructions: `Does one of these spaces, on its own, give the player this mechanic as the game needs it? Mechanic: ${g.description}` }])) });
        const bar = r.provider === 'd1' ? 0.7 : 0.5;
        noPrim.forEach((g, i) => { if ((r.answers[`g${i}`]?.noul ?? 0) >= bar) covered.add(g.mechanic); });
      } catch { covered = new Set(); }
    } else for (const g of noPrim) if (spaceCards.some(c => relevance({ verb: '', description: g.description }, c) >= LEXICAL_ACCEPT)) covered.add(g.mechanic);
    for (const g of noPrim) if (covered.has(g.mechanic)) {
      gaps.splice(gaps.indexOf(g), 1);
      const m = mechanics.find(x => x.id === g.mechanic); if (m) { m.primitives = [spaces[0].use]; m.source = `${m.source}+space`; }
    }
  }
  // A generator a mechanic named goes to the first chosen space its card targets (card.spaces); one that targets
  // none of them is dropped, never bound to a space it can't build.
  /** @type {GeneratorChoice[]} */
  const generators = [];
  /** @type {DroppedGenerator[]} */
  const dropped = [];
  for (const id of [...chosen].filter(isGenerator)) {
    const s = spaces.find(x => targets(registry, id, x.use));
    if (s) generators.push({ id, space: s.id }); else { dropped.push({ id, why: `targets ${(/** @type {RegisteredPrimitive} */ (registry.get(id)).card.spaces || []).join(', ') || 'no space'}; chosen: ${spaces.map(x => x.use).join(', ')}` }); chosen.delete(id); }
  }
  for (const d of dropped) for (const m of mechanics) m.primitives = m.primitives.filter(x => x !== d.id);
  const systems = [...chosen].filter(id => !isGenerator(id) && !isSpace(id)).sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  // A space something moves through gets a world even when no mechanic mapped to a generator (the mapping rarely
  // names one): the generators whose cards declare the content the space card says it needs (planWorld). Zones
  // are the outline's own; the outline's scaffold pass fills each generator's params.
  const movers = systems.filter(id => isMovement(registry, id));
  for (const s of spaces) {
    if (!needSets(registry, s.use).length || !movers.some(id => (bind[id] ?? spaces[0].id) === s.id)) continue;
    const have = [...OUTLINE_AUTHORS, ...generators.filter(g => g.space === s.id).flatMap(g => contentOfGenerator(registry, g.id))];
    const intent = [decomposition.premise, ...(decomposition.mechanics || []).map(m => m.description)].filter(Boolean).join('. ');
    const plan = planWorld(registry, s, { view: decomposition.views?.[0], have, intent, exclude: generators.filter(g => g.space === s.id).map(g => g.id) });
    for (const id of plan.generators) generators.push({ id, space: s.id, auto: true });
  }
  return {
    version: SELECT_VERSION, mechanics: mechanics.map(({ candidates, ...m }) => ({ ...m, candidates: candidates.slice(0, 3) })),
    // Renderers, UI and audio are chosen by the host from the document's systems and spaces
    // (graphics/ui-defaults.js withDefaultGraphics); the planner adds graphics only when a mechanic needs one.
    systems, generators, graphics: [], spaces, bind, gaps, provider, ...(adapters.length ? { adapters } : {}), completeness: { locomotion: loco, ...(interactionFit.changes.length ? { interaction: interactionFit } : {}), ...(mashupCheck ? { mashup: mashupCheck } : {}) }, ...(dropped.length ? { droppedGenerators: dropped } : {}), ...(excludedSpaces.length ? { excludedSpaces } : {}),
    ...(built ? { build: { version: built.version, loop: built.loop, spaceStep: built.spaceStep, steps: built.steps, contracts: built.contracts, calls: built.calls, ms: built.ms } } : {}), ms: Math.round(performance.now() - started),
  };
}
/**
 * Primitives of a collection the space does not host (capabilities it lacks, with the adapters already chosen), from
 * the composition check's capability failures. @param {RegistryLike} registry @param {string[]} ids @param {SpaceChoice} space
 * @param {Record<string, string>} bind @param {AdapterInstance[]} adapters @returns {Unmet[]}
 */
function unhosted(registry, ids, space, bind, adapters) {
  const r = checkComposition({ spaces: [space], systems: ids.filter(id => !isSpace(id)), bind, adapters }, registry, { resolve: false });
  /** @type {Map<string, string[]>} */
  const missing = new Map();
  for (const f of r.failures) if (f.code === 'capability_missing' && f.need && ids.includes(f.unit)) missing.set(f.unit, [...(missing.get(f.unit) || []), f.need.item]);
  return [...missing].map(([id, caps]) => ({ id, missing: caps, why: `${space.use} does not provide ${caps.join(', ')}` }));
}
// Install order inside systems[]: engine runtime first, then gameplay, then plot (catalog §0 convention).
/** @param {string} id */
const order = id => id.startsWith('engine.') ? 0 : id.startsWith('gameplay.') ? 1 : 2;

// ---------- selection completeness ----------

/** @param {{ views?: string[] }} decomposition @returns {string | null} */
const primaryOf = decomposition => (decomposition.views || []).find(v => v !== 'ui') || null;
/** @param {{ views?: string[] }} card @param {string | null} view */
const supportsView = (card, view) => !view || (card.views || []).includes(view) || (card.views || []).includes('any');

/**
 * How a movement card moves, from its own envelope declaration ('discrete' = cell by cell, else continuous); null when
 * the card declares no envelope. @param {any} card @returns {string | null}
 */
export function movementStyle(card) {
  try { const m = typeof card?.envelope === 'function' ? card.envelope({}, new Set(), {})?.mode : null; return typeof m === 'string' ? m : null; } catch { return null; }
}
/**
 * Does a movement card match the play spec's interaction? avatar-grid steps cell by cell (a discrete envelope);
 * any other avatar interaction (avatar-realtime) never does. Other interactions and unknown styles do not constrain.
 * @param {any} card @param {string | null | undefined} interaction
 */
export function fitsInteraction(card, interaction) {
  if (!interaction || !interaction.startsWith('avatar')) return true;
  const style = movementStyle(card);
  if (!style) return true;
  return interaction === 'avatar-grid' ? style === 'discrete' : style !== 'discrete';
}

/**
 * Base locomotion cards that fit a space, a primary view and a medium, best first. Hard filters: base locomotion,
 * capabilities the space provides, the primary view. Preference: the wanted medium, then specialisation.
 * Cards declare `locomotion` and `medium` outside the kernel's CardInput fields (read through its index signature).
 * @param {RegistryLike} registry
 * @param {{ caps?: string[], view?: string | null, medium?: string | null, exclude?: string[], interaction?: string | null }} [options]
 * @returns {Array<{ id: string, medium: string | null, score: number }>}
 */
export function baseLocomotion(registry, { caps = [], view = null, medium = null, exclude = [], interaction = null } = {}) {
  const have = new Set(caps);
  return registry.cards('gameplay').filter(c => c.locomotion === 'base' && !exclude.includes(c.id) && fitsInteraction(c, interaction) && (c.requires?.capabilities || []).every(x => have.has(x)) && supportsView(c, view))
    // Specialisation breaks ties: a card that needs more of what this space provides (gravity for jumping) and is made
    // for fewer views fits it better than a general one (the side-view platformer over walking, on a side-view tilemap).
    .map(c => ({ id: c.id, medium: str(c.medium) || null, score: ((c.views || []).includes(/** @type {string} */ (view)) ? 10 : 1) + (medium && c.medium === medium ? 5 : 0) + (c.requires?.capabilities || []).length + 2 / Math.max(1, (c.views || []).length) }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/**
 * The avatar moves the way the idea says: a base locomotion that lacks the primary view is replaced; a lone base
 * locomotion in the wrong medium (flying through a walking dungeon) is replaced by one in the right medium; an idea
 * whose avatar moves but has no base locomotion gets one. movement 'none' (cards, boards, falling pieces) adds nothing.
 * Mutates `chosen` and the mechanics' primitive lists; returns what it did.
 * @param {{ decomposition: { views?: string[], movement?: string, core?: { interaction?: string | null } | null }, registry: RegistryLike, chosen: Set<string>, space: SpaceChoice | undefined, mechanics?: SelectedMechanic[] }} options
 * @returns {LocomotionResult}
 */
export function locomotionCompleteness({ decomposition, registry, chosen, space, mechanics = [] }) {
  const view = primaryOf(decomposition), medium = decomposition.movement || null;
  const interaction = decomposition.core?.interaction || null;
  /** @type {LocomotionResult} */
  const out = { view, medium, removed: [], added: null };
  // ids below come from `chosen`, which holds registered ids only.
  const cardOf = (/** @type {string} */ id) => /** @type {RegisteredPrimitive} */ (registry.get(id)).card;
  if (!space) return out;
  const present = [...chosen].filter(id => registry.get(id)?.card.locomotion === 'base');
  const drop = (/** @type {string} */ id) => { chosen.delete(id); out.removed.push(id); for (const m of mechanics) if (Array.isArray(m.primitives)) m.primitives = m.primitives.filter(x => x !== id); };
  for (const id of present) if (!supportsView(cardOf(id), view) || !fitsInteraction(cardOf(id), interaction)) drop(id);
  let left = present.filter(id => chosen.has(id));
  // Exactly one base locomotion: the best fit stays, the rest were guesses.
  if (left.length > 1) {
    const rank = baseLocomotion(registry, { caps: space.caps, view, medium, interaction }).map(c => c.id);
    const at = (/** @type {string} */ id) => rank.includes(id) ? rank.indexOf(id) : Infinity;
    const keep = [...left].sort((a, b) => at(a) - at(b) || a.localeCompare(b))[0];
    for (const id of left) if (id !== keep) drop(id);
    left = [keep];
  }
  // No avatar (cards, boards, falling pieces): nothing to add.
  if (interaction && !interaction.startsWith('avatar')) return out;
  const wrongMedium = Boolean(medium && medium !== 'none' && left.length && left.every(id => cardOf(id).medium && cardOf(id).medium !== medium));
  if (medium === 'none' || (left.length && !wrongMedium)) return out;
  const best = baseLocomotion(registry, { caps: space.caps, view, medium, exclude: left, interaction }).find(c => !medium || c.medium === medium || !c.medium);
  // A space that navigates its own places (travel between zones) moves the avatar itself; agency is then checked on the
  // built game (ensureAgency, the publish gate). Otherwise no fitting base movement is a gap.
  if (!best) { if (!left.length && !space.caps.includes('navigate')) out.gap = `no base movement fits ${space.id || 'the space'}${interaction ? ` for ${interaction}` : ''}${medium ? ` (${medium})` : ''}`; return out; }
  if (wrongMedium) for (const id of left) drop(id);
  chosen.add(best.id); out.added = best.id;
  const host = mechanics.find(m => m.importance === 'core' && /\b(move|walk|run|jump|explor|navigat|travel|climb|platform|roam|fly|swim|drive)\w*/i.test(`${m.verb} ${m.description}`)) || mechanics.find(m => m.importance === 'core');
  if (host && Array.isArray(host.primitives) && !host.primitives.includes(best.id)) host.primitives.push(best.id);
  return out;
}
