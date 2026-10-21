// @ts-check
// The game's loop is the composition of what its primitives declare. There is no closed list of modes: a farm, a
// Pac-Man chase, a dungeon crawl or chess × Pokémon is the collection of primitives the idea's core mechanics map to,
// and its loop is what their cards declare.
//
// card.loop = {
//   verbs:    player actions this primitive's loop is played with (a subset of provides.actions);
//   progress: events that show the loop happening (a subset of provides.events; a name ending in ':' matches typed ones);
//   win?:     { param? | end? | when? | ending?, scope?, applies? }
//             param  an effects param ('onWin', or 'list.field' for each entry of a list param) run on victory;
//             end    a boolean param that ends the game itself;
//             when   a predicate template for a plot ending ('$target' is a number the content picks);
//             ending a plot ending section wins (the story);
//             scope  'encounter' when the win resolves one encounter (a battle) rather than the game (default 'game');
//             applies { param, field?, is }: the win exists only when the instance config matches (the preset makes it);
//             reads  the state the win condition tests (planner/loop-check.js): { component, of: opponents|player } | { event } | { var },
//                    with `from` (the primitive whose code writes it, when not this one or the component's owner) and
//                    `by` (what changes it: { actions: player verbs that do, directly or through the effects the document
//                    gives them; effects; events its code runs on; movement: the player's body touching or passing });
//                    every loop end declares it, checked against the code (tests/v2-p-loop-reads.test.js);
//   lose?:    the same, for defeat;
//   outcome?: how this loop's result maps onto the participants of an encounter that runs it as an inner loop
//             (engine.adapt.nested): { sides: ['player', 'opponent'?], results: { <result>: { param, player, opponent? } } }
//             sides    the loop's sides an encounter result is about: 'player' is the side the player plays, 'opponent'
//                      the side it plays against;
//             results  each way the loop ends: `param` the effects param (of this card, or of its card.mode.via host;
//                      'list.field' for every entry of a list param) run when it ends that way, and each side's fate:
//                      'keeps' (stays in play) or 'defeated' (out of play in the outer loop);
//   needs?:   { content: [document sections], participants: param | null };
//   involves?: { <event>: { <role>: <data field> } }: the participants a provided event names (entity ids in its data),
//             e.g. attack_hit: { attacker: 'who', defender: 'target' }; what a nested encounter can be entered on
//             (build-steps.js nestedStep) and the roles it binds (engine.adapt.nested with.roles);
// }
// card.mode is the richer form of the same declaration on primitives that own a whole loop (interaction, opponent,
// preferred spaces, a bot that proves it): cardLoop() merges the two, card.loop winning field by field.
import { isObj, isList, prop } from '../kernel/guards.js';

/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** What changes the state a loop end reads. @typedef {{ actions?: string[], effects?: string[], events?: string[], movement?: boolean }} ReadsBy */
/** @typedef {{ component?: string, of?: string, event?: string, var?: string, from?: string, by?: ReadsBy }} EndReads */
/** @typedef {{ param?: string, end?: string, when?: Record<string, unknown>, ending?: string, scope?: string, applies?: { param: string, field?: string, is: unknown }, reads?: EndReads }} LoopEnd */
/** A side's fate when an inner loop ends one way. @typedef {'keeps' | 'defeated'} Fate */
/** @typedef {{ param: string, player: Fate, opponent?: Fate }} OutcomeResult */
/** @typedef {{ sides: string[], results: Record<string, OutcomeResult> }} LoopOutcome */
/**
 * A primitive's loop declaration (card.loop merged over card.mode).
 * @typedef {{ verbs: string[], progress: string[], win: LoopEnd | null, lose: LoopEnd | null, needs: { content: string[], participants: unknown },
 *   interactions: string[], interaction: string | null, opponent: string | null, space: Array<string | string[]>, via: string | null, bot: string | null, wraps: boolean, outcome: LoopOutcome | null,
 *   targets: string | null, involves: Record<string, Record<string, string>> }} Loop
 * `interactions`: the set of interactions the loop is played in (card.loop / card.mode interaction: a string or a list);
 * empty when it declares none or 'any' (a wrapper takes the interaction of the loop it wraps). `interaction` is its first
 * entry, for display only: compare a loop's interaction with loopServes / interactions.includes, never by equality.
 * `targets`: the service through which the loop tells each of its AI-controlled participants where to go next (its
 * next checkpoint, the ball): kernel/types.d.ts TargetService; a driver with card.drives.targets steers them by it.
 */
/** @typedef {{ use: string, path: string, loop: Loop }} LoopPrimitive */
/** @typedef {LoopEnd & { use: string, path: string }} PlacedEnd */

export const LOOP_VERSION = 'loop/0.1';

/** @param {unknown} d @returns {d is LoopEnd} */
const ends = d => isObj(d) && (typeof d.param === 'string' || typeof d.end === 'string' || isObj(d.when) || typeof d.ending === 'string');
/** @param {unknown} v @returns {string[]} */
const strs = v => (isList(v) ? v.filter(/** @returns {x is string} */ x => typeof x === 'string' && x.length > 0) : []);

/**
 * A card's loop declaration, card.loop merged over card.mode; null when the card declares neither.
 * @param {unknown} card @returns {Loop | null}
 */
export function cardLoop(card) {
  const l = prop(card, 'loop'), m = prop(card, 'mode');
  const own = isObj(l) ? l : null, mode = isObj(m) ? m : null;
  if (!own && !mode) return null;
  /** @param {'win' | 'lose'} side @returns {LoopEnd | null} */
  const end = side => {
    const o = own?.[side], d = mode?.[side];
    if (ends(o)) return { ...o };
    if (!ends(d)) return null;
    // A mode that exists only for one configuration (a counter that clears the level) declares that its win needs it.
    return { ...d, ...(side === 'win' && isObj(mode?.applies) ? { applies: /** @type {any} */ (mode.applies) } : {}) };
  };
  const needs = isObj(own?.needs) ? own.needs : isObj(mode?.needs) ? mode.needs : {};
  const interactions = interactionsOf(own?.interaction ?? mode?.interaction);
  const asList = (/** @type {unknown} */ v) => (isList(v) ? v : typeof v === 'string' ? [v] : null);
  const space = asList(own?.space) || asList(mode?.space) || [];
  return {
    verbs: strs(own?.verbs), progress: [...new Set([...strs(own?.progress), ...strs(mode?.progress)])],
    win: end('win'), lose: end('lose'),
    needs: { content: strs(prop(needs, 'content')), participants: prop(needs, 'participants') ?? null },
    interactions, interaction: interactions[0] ?? null, opponent: typeof (own?.opponent ?? mode?.opponent) === 'string' ? String(own?.opponent ?? mode?.opponent) : null,
    space: /** @type {Array<string | string[]>} */ (space.filter(x => typeof x === 'string' || (isList(x) && x.every(c => typeof c === 'string')))),
    via: typeof mode?.via === 'string' ? mode.via : null, bot: typeof mode?.bot === 'string' ? mode.bot : null, wraps: Boolean(mode?.wraps),
    outcome: outcomeOf(own?.outcome),
    targets: typeof (own?.targets ?? mode?.targets) === 'string' ? String(own?.targets ?? mode?.targets) : null,
    involves: involvesOf(own?.involves),
  };
}

/**
 * The interactions a card.loop / card.mode interaction declares: a string or a list of them, 'any' (a wrapper)
 * and anything that is not a non-empty string left out. @param {unknown} v @returns {string[]}
 */
export const interactionsOf = v => [...new Set((isList(v) ? v : [v]).filter(/** @returns {x is string} */ x => typeof x === 'string' && x.length > 0 && x !== 'any'))];

/**
 * Does a loop serve an interaction? True when its declared set includes it, or when it declares none ('any': a
 * wrapper serves the interaction of the loop it wraps; or no declaration), and for no interaction (undecided). Use
 * `loop.interactions.includes(i)` where only a loop declared for the interaction will do.
 * @param {Loop | null | undefined} loop @param {string | null | undefined} interaction
 */
export const loopServes = (loop, interaction) => !loop || !interaction || !loop.interactions.length || loop.interactions.includes(interaction);

/**
 * A loop's declared event participants (card.loop.involves): event -> role -> data field; entries that are not a
 * non-empty map of strings are left out. @param {unknown} v @returns {Record<string, Record<string, string>>}
 */
export function involvesOf(v) {
  /** @type {Record<string, Record<string, string>>} */
  const out = {};
  if (!isObj(v)) return out;
  for (const [event, roles] of Object.entries(v)) {
    if (!isObj(roles)) continue;
    const r = Object.fromEntries(Object.entries(roles).filter(([k, f]) => k && typeof f === 'string' && f));
    if (Object.keys(r).length) out[event] = /** @type {Record<string, string>} */ (r);
  }
  return out;
}

const FATES = ['keeps', 'defeated'];
/**
 * A loop's declared encounter outcome (card.loop.outcome), or null when it declares none or a malformed one.
 * @param {unknown} o @returns {LoopOutcome | null}
 */
export function outcomeOf(o) {
  if (!isObj(o) || !isObj(o.results)) return null;
  const sides = strs(o.sides);
  if (!sides.includes('player') || sides.some(x => x !== 'player' && x !== 'opponent')) return null;
  /** @type {Record<string, OutcomeResult>} */
  const results = {};
  for (const [k, r] of Object.entries(o.results)) {
    if (!isObj(r) || typeof r.param !== 'string' || !sides.every(x => FATES.includes(String(r[x])))) return null;
    results[k] = /** @type {OutcomeResult} */ ({ param: r.param, ...Object.fromEntries(sides.map(x => [x, r[x]])) });
  }
  return Object.keys(results).length ? { sides, results } : null;
}

/** Does a loop end end the game (rather than one encounter)? @param {LoopEnd | null | undefined} e */
export const endsGame = e => Boolean(e && e.scope !== 'encounter');

/**
 * Does an `applies` condition hold for an instance config (card defaults applied)? A list param matches when any
 * entry's field equals `is`. @param {LoopEnd['applies'] | undefined} a @param {Record<string, unknown>} config
 */
export function appliesTo(a, config) {
  if (!a) return true;
  const v = config?.[a.param];
  if (Array.isArray(v)) return v.some(x => (a.field ? prop(x, a.field) : x) === a.is);
  return (a.field ? prop(v, a.field) : v) === a.is;
}

/** Card defaults of a primitive's params. @param {any} card @returns {Record<string, unknown>} */
const defaults = card => Object.fromEntries(Object.entries(card?.params || {}).filter(([, s]) => isObj(s) && 'default' in s).map(([k, s]) => [k, /** @type {any} */ (s).default]));

/**
 * The document's loop: its core collection's primitives (every system and generator whose card declares a loop, or
 * only those in `core` when the planner knows the core), the union of their progress events, and the win and lose
 * paths they declare that apply to their instance config.
 * -> { primitives: [{ use, path, loop }], progress: [event names], win: [{ use, path, ...end }], lose: [...] }
 * @param {unknown} doc @param {RegistryLike} registry @param {{ core?: Iterable<string> | null }} [options]
 */
export function loopOf(doc, registry, { core = null } = {}) {
  const only = core ? new Set(core) : null;
  /** @type {LoopPrimitive[]} */
  const primitives = [];
  /** @type {PlacedEnd[]} */
  const win = [];
  /** @type {PlacedEnd[]} */
  const lose = [];
  /** @type {Set<string>} */
  const progress = new Set();
  /** @param {unknown} inst @param {string} path */
  const visit = (inst, path) => {
    const use = prop(inst, 'use');
    if (typeof use !== 'string' || (only && !only.has(use))) return;
    const card = registry.get(use)?.card;
    const loop = cardLoop(card);
    if (!loop) return;
    primitives.push({ use, path, loop });
    for (const e of loop.progress) progress.add(e);
    const config = { ...defaults(card), ...(isObj(prop(inst, 'with')) ? /** @type {Record<string, unknown>} */ (prop(inst, 'with')) : {}) };
    if (loop.win && appliesTo(loop.win.applies, config)) win.push({ use, path, ...loop.win });
    if (loop.lose && appliesTo(loop.lose.applies, config)) lose.push({ use, path, ...loop.lose });
  };
  const systems = prop(doc, 'systems'), spaces = prop(doc, 'spaces');
  (isList(systems) ? systems : []).forEach((s, i) => visit(s, `systems[${i}]`));
  (isList(spaces) ? spaces : []).forEach((sp, i) => { const g = prop(sp, 'generators'); (isList(g) ? g : []).forEach((x, j) => visit(x, `spaces[${i}].generators[${j}]`)); });
  return { primitives, progress: [...progress], win, lose };
}

/**
 * The loop a collection of primitive ids composes (for planning, before a document exists): the loops in it, which
 * one owns the game's win and the problems (type holes) that leave it without one. `order` lists the core ids first
 * (core mechanics in the idea's order): the first core primitive that declares a game-ending win owns it, else any
 * other primitive of the collection that does.
 * @param {Iterable<string>} ids @param {RegistryLike} registry @param {{ core?: Iterable<string> }} [options]
 * @returns {{ loops: Array<{ use: string, loop: Loop }>, win: { use: string, end: LoopEnd } | null, lose: Array<{ use: string, end: LoopEnd }>, holes: Array<{ code: string, primitives: string[], message: string }> }}
 */
export function composeLoop(ids, registry, { core = [] } = {}) {
  const all = [...new Set(ids)];
  const coreIds = [...new Set(core)].filter(id => all.includes(id));
  const ordered = [...coreIds, ...all.filter(id => !coreIds.includes(id))];
  const loops = ordered.flatMap(use => { const loop = cardLoop(registry.get(use)?.card); return loop ? [{ use, loop }] : []; });
  const owner = loops.find(l => endsGame(l.loop.win));
  const lose = loops.filter(l => coreIds.includes(l.use) && endsGame(l.loop.lose)).map(l => ({ use: l.use, end: /** @type {LoopEnd} */ (l.loop.lose) }));
  /** @type {Array<{ code: string, primitives: string[], message: string }>} */
  const holes = [];
  const names = coreIds.length ? coreIds : all;
  for (const id of coreIds) if (!cardLoop(registry.get(id)?.card)) holes.push({ code: 'loop_undeclared', primitives: [id], message: `${id} carries a core mechanic but declares no loop (card.loop)` });
  if (!owner) holes.push({ code: 'loop_win_undeclared', primitives: names, message: `no primitive in the collection (${names.join(', ') || 'empty'}) declares a way to win the game (card.loop.win)` });
  return { loops, win: owner ? { use: owner.use, end: /** @type {LoopEnd} */ (owner.loop.win) } : null, lose, holes };
}

/**
 * Catalogue primitives that declare a game-ending win and can join a collection on these spaces (their required
 * capabilities are provided by one of them), best first by `score` (the caller's relevance to the idea's win). A
 * primitive that owns a whole loop (card.mode: its own interaction, opponent and spaces) is not added just for its win:
 * it would make another game.
 * @param {RegistryLike} registry @param {{ caps: string[][], exclude?: Iterable<string>, score?: (card: any) => number }} options
 * @returns {Array<{ id: string, score: number, end: LoopEnd }>}
 */
export function winProviders(registry, { caps, exclude = [], score = () => 0 }) {
  const skip = new Set(exclude);
  /** @type {Array<{ id: string, score: number, end: LoopEnd }>} */
  const out = [];
  for (const card of registry.cards()) {
    if (skip.has(card.id) || !/^(gameplay|plot)\./.test(card.id)) continue;
    const loop = cardLoop(card);
    if (!loop || !endsGame(loop.win) || card.mode) continue;
    const need = card.requires?.capabilities || [];
    if (!caps.some(c => need.every(x => c.includes(x)))) continue;
    out.push({ id: card.id, score: score(card), end: /** @type {LoopEnd} */ (loop.win) });
  }
  return out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
