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
//             applies { param, field?, is } | { param, given: true }: the win exists only when the instance config matches
//                    (the preset makes it), or sets the param at all (`given`: a crawl exists only where the dungeon holds a boss);
//             reads  the state the win condition tests (planner/loop-check.js): { component, of: opponents|player } | { event } | { var },
//                    with `from` (the primitive whose code writes it, when not this one or the component's owner) and
//                    `by` (what changes it: { actions: player verbs that do, directly or through the effects the document
//                    gives them; effects; events its code runs on; movement: the player's body touching or passing });
//                    every loop end declares it, checked against the code (tests/v2-p-loop-reads.test.js);
//             shown  what a person watches for this end when it is not the read itself (a measurement var, an event
//                    every participant emits): { var, max?, label? } | { count } | { bar: 'boss' } | a list; max a number,
//                    a var or { param } of the instance; `applies: { param, gt|gte|lt|lte|eq }` limits it to instances
//                    whose param compares so; `each: { param, where? }` repeats it per entry of a list param with `$id`
//                    the entry's id (data only: cards are cloned; graphics/ui-defaults.js hudGoals);
//             once   the end happens at the first occurrence of what it reads (a finish, a top-out): no quantity to watch;
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
import { isObj, isList, isStr, list, objects, prop } from '../kernel/guards.js';
import { checkFields } from '../kernel/params.js';
import { sideDecl, playerSides } from '../kernel/sides.js';

/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** What changes the state a loop end reads. @typedef {{ actions?: string[], effects?: string[], events?: string[], movement?: boolean }} ReadsBy */
/** @typedef {{ component?: string, of?: string, event?: string, var?: string, from?: string, by?: ReadsBy }} EndReads */
/** @typedef {{ param?: string, end?: string, when?: Record<string, unknown>, ending?: string, scope?: string, shown?: unknown, once?: boolean, applies?: { param: string, field?: string, is?: unknown, given?: boolean }, reads?: EndReads }} LoopEnd */
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
/** A loop instance of a document. @typedef {{ use: string, index: number, path: string, loop: Loop, card: Record<string, any>, config: Record<string, unknown>, inst: Record<string, unknown> }} LoopInstance */

export const LOOP_VERSION = 'loop/0.1';

/**
 * The state a loop end reads: its declared `reads`, else the count or var its `when` template tests.
 * @param {LoopEnd | null | undefined} end @returns {EndReads | null}
 */
export function readsOf(end) {
  if (!end) return null;
  const r = /** @type {unknown} */ (/** @type {Record<string, unknown>} */ (end).reads);
  if (isObj(r)) {
    /** @type {EndReads} */
    const out = {};
    for (const k of /** @type {const} */ (['component', 'of', 'event', 'var', 'from'])) if (isStr(r[k])) out[k] = String(r[k]);
    if (isObj(r.by)) {
      const by = r.by;
      /** @type {ReadsBy} */
      const b = {};
      for (const k of /** @type {const} */ (['actions', 'effects', 'events'])) if (Array.isArray(by[k])) b[k] = by[k].filter(isStr).map(String);
      if (by.movement === true) b.movement = true;
      out.by = b;
    }
    return out.component || out.event || out.var ? out : null;
  }
  const w = end.when;
  if (isObj(w) && isStr(w.count)) return { event: w.count };
  if (isObj(w) && isStr(w.var)) return { var: w.var };
  return null;
}


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
 * Does a space fit one entry of a loop's declared spaces (card.mode.space / card.loop.space; modes-lib-mode.js): a space
 * primitive id fits that space only; a capability list fits any space providing every capability in it. The one reading
 * of the declaration: the composition check and the catalogue's template fit test both use it.
 * @param {string | string[]} entry @param {string} use the space primitive id @param {Set<string>} caps the capabilities it provides
 */
export const spaceFitsEntry = (entry, use, caps) => (typeof entry === 'string' ? entry === use : entry.every(c => caps.has(c)));
/** Does a space fit a loop's declared spaces: one entry fits, or the loop declares none. @param {Loop} loop @param {string} use @param {Set<string>} caps */
export const loopSpaceFits = (loop, use, caps) => !loop.space.length || loop.space.some(e => spaceFitsEntry(e, use, caps));

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
 * entry's field equals `is`; `given: true` holds when the config sets the param (a value, a non-empty list).
 * @param {LoopEnd['applies'] | undefined} a @param {Record<string, unknown>} config
 */
export function appliesTo(a, config) {
  if (!a) return true;
  const v = config?.[a.param];
  if (a.given === true) return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== '';
  if (Array.isArray(v)) return v.some(x => (a.field ? prop(x, a.field) : x) === a.is);
  return (a.field ? prop(v, a.field) : v) === a.is;
}

/**
 * Does a card's loop exist for one instance config (card defaults applied)? A card whose only loop declaration is a
 * card.mode with `applies` carries a loop only where the mode applies (a dungeon without a boss is a world, not a
 * crawl; a course without a goal is not a run to win); every other declared loop always exists.
 * @param {unknown} card @param {Record<string, unknown>} config
 */
export function loopExists(card, config) {
  const own = prop(card, 'loop'), mode = prop(card, 'mode');
  if (isObj(own) || !isObj(mode) || !isObj(mode.applies)) return Boolean(cardLoop(card));
  return appliesTo(/** @type {any} */ (mode.applies), config);
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
    const config = { ...defaults(card), ...(isObj(prop(inst, 'with')) ? /** @type {Record<string, unknown>} */ (prop(inst, 'with')) : {}) };
    if (!loopExists(card, config)) return;
    primitives.push({ use, path, loop });
    for (const e of loop.progress) progress.add(e);
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

// ---------- the game's win in a document: one reading for the loop check and the composition check ----------

/** Every effect object (an object with a string `do`) inside a value. @param {unknown} v @param {Array<Record<string, unknown>>} [out] */
export function effectsIn(v, out = []) {
  if (Array.isArray(v)) for (const x of v) effectsIn(x, out);
  else if (isObj(v)) { if (isStr(v.do)) out.push(v); for (const x of Object.values(v)) if (typeof x === 'object') effectsIn(x, out); }
  return out;
}

/** The loop instances of a document (systems and generators whose card declares a loop that exists for their config). @param {unknown} doc @param {RegistryLike} registry @returns {LoopInstance[]} */
export function loopInstances(doc, registry) {
  /** @type {LoopInstance[]} */
  const out = [];
  /** @param {unknown} s @param {string} path */
  const visit = (s, path) => {
    const use = prop(s, 'use'); if (!isStr(use) || !isObj(s)) return;
    const card = registry.get(use)?.card; const loop = cardLoop(card);
    if (!card || !loop) return;
    /** @type {Record<string, unknown>} */
    let config = {};
    try { config = { ...checkFields(card.params || {}, {}, '', [], null), ...(isObj(s.with) ? s.with : {}) }; } catch { config = isObj(s.with) ? { ...s.with } : {}; }
    if (!loopExists(card, config)) return; // a mode that does not apply to this instance: no loop here
    out.push({ use, index: out.length, path, loop, card, config, inst: s });
  };
  // Systems, then the generators of every space (a generator can carry a loop: a crawl, a course run to a goal), as loopOf reads them.
  list(prop(doc, 'systems')).forEach((s, i) => visit(s, `systems[${i}]`));
  list(prop(doc, 'spaces')).forEach((sp, i) => list(prop(sp, 'generators')).forEach((g, j) => visit(g, `spaces[${i}].generators[${j}]`)));
  return out;
}

/** The instance a loop's params are set on: its card.mode.via host's (the first system using it), else its own. @param {unknown} doc @param {LoopInstance} l @returns {unknown} */
export const hostOf = (doc, l) => (l.loop.via ? list(prop(doc, 'systems')).find(s => prop(s, 'use') === l.loop.via) : l.inst);

/**
 * The loop that owns the game's win. A game is won one way (build-steps.js askWins): of the loops declaring a
 * game-ending win, the planner's core order decides first (`core`: the decided win first, presets.js loopCore); among
 * loops that order does not separate (none core, or no core known), the one whose win the document wires to a won
 * ending owns it: the other declared wins are ways to win this document does not use. With none wired, the first
 * declaring one owns it (and its unwired win is reported). @param {unknown} doc @param {RegistryLike} registry
 * @param {LoopInstance[]} loops @param {Iterable<string> | null} core @returns {LoopInstance | null}
 */
export function winOwner(doc, registry, loops, core) {
  const order = core ? [...core] : [];
  const wins = loops.filter(l => endsGame(l.loop.win));
  const wired = new Set(wins.filter(l => !unwired(doc, l, /** @type {LoopEnd} */ (l.loop.win), 'won', registry)));
  // Then a win that exists in the instance's config (its `applies`) before one that does not (a course without a goal).
  const applies = new Set(wins.filter(l => appliesTo(l.loop.win?.applies, l.config)));
  return wins.sort((a, b) => rank(order, a.use) - rank(order, b.use) || Number(wired.has(b)) - Number(wired.has(a)) || Number(applies.has(b)) - Number(applies.has(a)) || a.index - b.index)[0] || null;
}
/** @param {string[]} order @param {string} id */
const rank = (order, id) => { const i = order.indexOf(id); return i < 0 ? order.length : i; };

/** Does an effect end the game with this outcome (directly, or through the plot ending it names)? @param {Record<string, unknown>} e @param {Map<unknown, Record<string, unknown>>} endings @param {'won' | 'lost'} outcome */
function endsWith(e, endings, outcome) {
  if (e.do !== 'end_game') return false;
  if (isStr(e.outcome)) return e.outcome === outcome;
  if (isStr(e.ending)) return (endings.get(e.ending)?.outcome ?? 'won') === outcome;
  return outcome === 'won';
}

/**
 * The events a document's primitives emit typed (declared `name:*` in card.provides.events): KERNEL_API rt.emitTyped
 * emits `name` and `name:<subject>` together, so `name:<subject>` counts the same events as `name`, narrowed to one subject.
 * @param {unknown} doc @param {RegistryLike} registry @returns {Set<string>}
 */
export function typedEvents(doc, registry) {
  const uses = [...list(prop(doc, 'systems')), ...list(prop(doc, 'spaces')).flatMap(sp => [sp, ...list(prop(sp, 'generators'))])].map(s => prop(s, 'use')).filter(isStr);
  return new Set(uses.flatMap(u => list(registry.get(String(u))?.card.provides?.events)).filter(isStr).filter(e => e.endsWith(':*')).map(e => e.slice(0, -2)));
}

/**
 * Is an ending's `when` trigger this loop end's `when` template filled in: every key the template fixes (the count or
 * var it tests) equal, every placeholder ('$target': a number the content picks) present? An event count the template
 * fixes (the kernel's `count` predicate) is also filled by the typed count of that event (`name:<subject>`) when the
 * event is emitted typed (`typed`, typedEvents): the same quantity narrowed to one subject.
 * @param {Record<string, unknown>} template @param {Record<string, unknown>} when @param {Set<string>} [typed]
 */
export const fills = (template, when, typed = new Set()) => Object.entries(template).every(([k, v]) => {
  if (isStr(v) && v.startsWith('$')) return when[k] !== undefined;
  const w = when[k];
  if (k === 'count' && isStr(v) && typed.has(v) && isStr(w) && w.length > v.length + 1 && w.startsWith(`${v}:`)) return true;
  return JSON.stringify(w) === JSON.stringify(v);
});

/** The primitive that evaluates plot.endings `when` triggers: a loop that reads them and declares no win of its own. @param {unknown} card */
export const evaluatesEndings = card => Boolean(card) && list(prop(card, 'reads')).includes('plot.endings') && Boolean(cardLoop(card)) && !cardLoop(card)?.win && !list(prop(prop(card, 'requires'), 'capabilities')).length;

/**
 * Is a declared loop end wired to an ending of `outcome` in the document? -> null when wired, else why not.
 * @param {unknown} doc @param {LoopInstance} l @param {LoopEnd} end @param {'won' | 'lost'} outcome @param {RegistryLike} registry @returns {string | null}
 */
export function unwired(doc, l, end, outcome, registry) {
  if (!appliesTo(end.applies, l.config)) return `its ${outcome === 'won' ? 'win' : 'lose'} applies only when ${end.applies?.param}${end.applies?.field ? `.${end.applies.field}` : ''} is ${JSON.stringify(end.applies?.is)}`;
  const endings = new Map(objects(prop(prop(doc, 'plot'), 'endings')).map(e => [e.id, e]));
  const systems = list(prop(doc, 'systems'));
  const w = prop(hostOf(doc, l), 'with');
  const wired = (/** @type {unknown} */ v) => effectsIn(v).some(e => endsWith(e, endings, outcome));
  if (isStr(end.param)) {
    const [p, field] = end.param.split('.');
    const v = prop(w, p);
    if (!field && wired(v)) return null;
    if (field && objects(v).some(x => wired(x[field]))) return null;
  }
  if (isStr(end.end) && prop(w, end.end) === true) return null;
  if (isObj(end.when)) {
    const typed = typedEvents(doc, registry);
    const has = [...endings.values()].some(e => isObj(e.when) && (e.outcome ?? 'won') === outcome && fills(/** @type {Record<string, unknown>} */ (end.when), e.when, typed));
    const evaluator = systems.some(s => evaluatesEndings(registry.get(String(prop(s, 'use')))?.card));
    if (has && evaluator) return null;
    if (has) return `its ending's \`when\` trigger has no evaluator in the document (a loop that reads plot.endings)`;
  }
  if (isStr(end.ending) && [...endings.values()].some(e => (e.outcome ?? 'won') === outcome)) return null;
  const how = [isStr(end.param) && `an end_game effect in ${l.loop.via ? `${l.loop.via} ` : ''}with.${end.param}`, isStr(end.end) && `with.${end.end} = true`, isObj(end.when) && 'a plot ending with its `when` and the evaluator', isStr(end.ending) && 'a plot ending'].filter(Boolean).join(' or ');
  return `nothing wires it to a ${outcome} ending (${how || 'no wiring declared'})`;
}

/**
 * The subjects a typed event counts for the player's side (reads.of 'player'): the player, and every side the player is
 * on among the sides the loop's own instance declares (card.sides, or its card.mode.via host's: kernel/sides.js
 * playerSides), so a rival's lap or the other team's goal is not the player's progress.
 * @param {unknown} doc @param {RegistryLike} registry @param {LoopInstance} owner @returns {string[]}
 */
export function playerSubjects(doc, registry, owner) {
  const own = sideDecl(owner.card) ? owner.use : isStr(owner.loop.via) ? owner.loop.via : owner.use;
  return ['player', ...playerSides(doc, registry, own).filter(id => id !== 'player')];
}

/**
 * The quantity the core loop's win reads: card.loop.win.reads of the loop that owns the game's win (loop-check.js
 * winOwner: `core` orders the loops as the planner does, else the win the document wires), with the comparison and target of the won plot ending that
 * tests it, when one does. An event read `of: 'player'` counts the player's side only: `subjects` (playerSubjects) name
 * the typed events (`event:<subject>`) that are its. null when no loop declares a game-ending win with reads.
 * @param {unknown} doc @param {RegistryLike} registry @param {Iterable<string> | null} [core] @returns {{ use: string, event?: string, var?: string, component?: string, of?: string, subjects?: string[], cmp?: string, target?: number } | null}
 */
export function winQuantity(doc, registry, core = null) {
  const owner = winOwner(doc, registry, loopInstances(doc, registry), core);
  const reads = owner ? readsOf(owner.loop.win) : null;
  if (!owner || !reads) return null;
  /** @type {{ use: string, event?: string, var?: string, component?: string, of?: string, subjects?: string[], cmp?: string, target?: number }} */
  const out = reads.component ? { use: owner.use, component: reads.component, of: reads.of || 'opponents' } : reads.event ? { use: owner.use, event: reads.event, ...(reads.of === 'player' ? { of: 'player', subjects: playerSubjects(doc, registry, owner) } : {}) } : { use: owner.use, var: /** @type {string} */ (reads.var) };
  for (const e of objects(prop(prop(doc, 'plot'), 'endings'))) {
    const w = e.when;
    if ((e.outcome ?? 'won') !== 'won' || !isObj(w) || !((out.event && w.count === out.event) || (out.var && w.var === out.var))) continue;
    const cmp = ['gte', 'gt', 'lte', 'lt', 'eq'].find(k => typeof w[k] === 'number');
    if (cmp) return { ...out, cmp, target: Number(w[cmp]) };
  }
  return out;
}
