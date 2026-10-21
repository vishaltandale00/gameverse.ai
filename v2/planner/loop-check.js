// @ts-check
// The structural loop check: static, from declarations alone, before any model call or playtest. A game is a
// collection of primitives; for every loop-carrying primitive of a document (card.loop / card.mode, loop.js) it
// verifies that the declared loop can actually be played out and won:
//   participants  the groups its loop declares (needs.participants: a list param of groups or members) exist, the
//                 player is seated as card.engage says (engage.join.where, e.g. a player-controlled side), an
//                 opponent exists when the loop declares one, every group has entities placed in the world, and
//                 the entities its win reads carry the component it reads (win.reads.component), owned by a
//                 primitive of the document (the card that declares card.components[component]);
//   affecting     some declared player verb or action can change the state its win reads (win.reads, or what a
//                 `when` template counts): an effect in its own action params owned by the primitive that owns the
//                 component, a primitive with player verbs that requires that owner, or a player-driven provider of
//                 the event or var the win counts; a win that declares no reads is an error (loop_win_reads_undeclared):
//                 whether play can reach it is unknown;
//   wiring        the win of the loop that owns the game's win is wired to a won ending (an end_game effect in its
//                 declared param, its `end` boolean, a `when` ending with its evaluator in the document, or a won
//                 story ending), and its declared lose (and the core loops' losses) to a lost one.
// Each failure is a stable problem code with a path, a hint and `need` (what is missing, as data) that the preset's
// structural repair (presets.js repairLoop) and the planner's re-planning (replan.js) act on. Nothing here names a
// primitive, a genre or a game: every rule reads a card declaration.
import { cardLoop, endsGame, appliesTo } from './loop.js';
import { contractsOf, participantsOf } from './content.js';
import { spawnRules } from './census.js';
import { defaultsOf } from './catalog.js';
import { Logic } from '../kernel/logic.js';
import { buildLogic } from '../kernel/world.js';
import { isObj, isStr, list, objects, prop } from '../kernel/guards.js';

/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** @typedef {import('../kernel/types.js').LogicLike} LogicLike */
/** @typedef {import('./loop.js').Loop} Loop */
/** @typedef {import('./loop.js').LoopEnd} LoopEnd */
/**
 * The state a loop's win (or lose) reads: a component of its opponents (or the player, or every participant), an
 * event count or a var. Declared as win.reads; a `when` template's count/var is its read when none is declared.
 * `from`: the primitive whose code writes it (when not this one or the component's owner); `by`: what changes it.
 * @typedef {{ component?: string, of?: string, event?: string, var?: string, from?: string, by?: import('./loop.js').ReadsBy }} LoopReads
 */
/**
 * What a problem says is missing, as data for repair and re-planning. `pending`: the list param whose entries (content
 * the model writes) would carry the wiring.
 * @typedef {{ kind: 'participants' | 'seat' | 'opponent' | 'group' | 'component' | 'owner' | 'action' | 'event' | 'var' | 'win' | 'lose' | 'reads',
 *   param?: string, min?: number, where?: Record<string, unknown>, group?: string, component?: string, archetypes?: string[], owners?: string[],
 *   event?: string, var?: string, of?: string, pending?: string }} LoopNeed
 */
/**
 * @typedef {{ code: string, path: string, message: string, hint: string, severity: 'error' | 'warning', stage: 'loop', primitive: string, need: LoopNeed }} LoopProblem
 */
/** A loop instance of a document. @typedef {{ use: string, index: number, path: string, loop: Loop, card: Record<string, any>, config: Record<string, unknown>, inst: Record<string, unknown> }} LoopInstance */

export const LOOP_CHECK_VERSION = 'loop-check/0.1';
/** The stable problem codes. */
export const LOOP_CODES = Object.freeze({
  participants: 'loop_participants_missing', seat: 'loop_player_unseated', opponent: 'loop_opponent_missing', group: 'loop_group_empty',
  component: 'loop_component_missing', owner: 'loop_component_unowned', unaffected: 'loop_win_unaffected', win: 'loop_win_unwired',
  lose: 'loop_lose_unwired', reads: 'loop_win_reads_undeclared',
});

/** @type {WeakMap<object, LogicLike>} */
const logicCache = new WeakMap();
/** The vocabulary owners of a registry (which primitive registers each effect). @param {RegistryLike} registry @returns {LogicLike} */
export function logicOf(registry) {
  let l = logicCache.get(registry);
  if (!l) { l = /** @type {LogicLike} */ (/** @type {unknown} */ (buildLogic(registry, Logic))); logicCache.set(registry, l); }
  return l;
}

/** @param {unknown} id @param {string} req a required primitive id (or prefix) */
const satisfies = (id, req) => id === req || (isStr(id) && id.startsWith(req + '.'));

/**
 * The state a loop end reads: its declared `reads`, else the count or var its `when` template tests.
 * @param {LoopEnd | null | undefined} end @returns {LoopReads | null}
 */
export function readsOf(end) {
  if (!end) return null;
  const r = /** @type {unknown} */ (/** @type {Record<string, unknown>} */ (end).reads);
  if (isObj(r)) {
    /** @type {LoopReads} */
    const out = {};
    for (const k of /** @type {const} */ (['component', 'of', 'event', 'var', 'from'])) if (isStr(r[k])) out[k] = String(r[k]);
    if (isObj(r.by)) {
      const by = r.by;
      /** @type {import('./loop.js').ReadsBy} */
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

/** Cards that own a component (declare card.components[component]). @param {RegistryLike} registry @param {string} component @returns {string[]} */
export const ownersOf = (registry, component) => registry.cards().filter(c => isObj(c.components) && c.components[component] !== undefined).map(c => c.id).sort();

/** Every effect object (an object with a string `do`) inside a value. @param {unknown} v @param {Array<Record<string, unknown>>} [out] */
export function effectsIn(v, out = []) {
  if (Array.isArray(v)) for (const x of v) effectsIn(x, out);
  else if (isObj(v)) { if (isStr(v.do)) out.push(v); for (const x of Object.values(v)) if (typeof x === 'object') effectsIn(x, out); }
  return out;
}

/**
 * The effects an instance's params hold (its data-defined actions, phases, triggers), except the params its win and
 * lose are wired through. -> [{ param, effect }]
 * @param {Record<string, any>} card @param {Record<string, unknown>} config @param {Array<string | undefined>} wiring win/lose params ('p' or 'list.field')
 */
export function actionEffects(card, config, wiring) {
  /** @type {Array<{ param: string, effect: Record<string, unknown> }>} */
  const out = [];
  const skip = wiring.filter(isStr);
  for (const [k, spec] of Object.entries(card.params || {})) {
    if (skip.includes(k)) continue;
    const field = skip.find(w => w.startsWith(k + '.'))?.split('.')[1];
    const v = config[k];
    if (spec?.type === 'effects') for (const e of effectsIn(v)) out.push({ param: k, effect: e });
    else if (spec?.type === 'list' && isObj(spec.of) && spec.of.type === 'object') for (const entry of objects(v)) for (const [f, fs] of Object.entries(spec.of.fields || {})) {
      if (f === field || prop(fs, 'type') !== 'effects') continue;
      for (const e of effectsIn(entry[f])) out.push({ param: k, effect: e });
    }
  }
  return out;
}

/** The loop instances of a document (systems and generators whose card declares a loop). @param {unknown} doc @param {RegistryLike} registry @returns {LoopInstance[]} */
export function loopInstances(doc, registry) {
  /** @type {LoopInstance[]} */
  const out = [];
  list(prop(doc, 'systems')).forEach((s, index) => {
    const use = prop(s, 'use'); if (!isStr(use) || !isObj(s)) return;
    const card = registry.get(use)?.card; const loop = cardLoop(card);
    if (!card || !loop) return;
    /** @type {Record<string, unknown>} */
    let config = {};
    try { config = { ...defaultsOf(/** @type {any} */ (card)), ...(isObj(s.with) ? s.with : {}) }; } catch { config = isObj(s.with) ? { ...s.with } : {}; }
    out.push({ use, index, path: `systems[${index}]`, loop, card, config, inst: s });
  });
  return out;
}

/**
 * The loop that owns the game's win: the first core loop (in `core` order) declaring a game-ending win, else the
 * first such loop of the document. @param {LoopInstance[]} loops @param {Iterable<string> | null} core @returns {LoopInstance | null}
 */
export function winOwner(loops, core) {
  const order = core ? [...core] : [];
  const ranked = [...loops].sort((a, b) => rank(order, a.use) - rank(order, b.use) || a.index - b.index);
  return ranked.find(l => endsGame(l.loop.win)) || null;
}
/** @param {string[]} order @param {string} id */
const rank = (order, id) => { const i = order.indexOf(id); return i < 0 ? order.length : i; };

/** Does an effect end the game with this outcome (directly, or through the plot ending it names)? @param {Record<string, unknown>} e @param {Map<unknown, Record<string, unknown>>} endings @param {'won' | 'lost'} outcome */
function ends(e, endings, outcome) {
  if (e.do !== 'end_game') return false;
  if (isStr(e.outcome)) return e.outcome === outcome;
  if (isStr(e.ending)) return (endings.get(e.ending)?.outcome ?? 'won') === outcome;
  return outcome === 'won';
}

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
  const host = l.loop.via ? systems.find(s => prop(s, 'use') === l.loop.via) : l.inst;
  const w = prop(host, 'with');
  const wired = (/** @type {unknown} */ v) => effectsIn(v).some(e => ends(e, endings, outcome));
  if (isStr(end.param)) {
    const [p, field] = end.param.split('.');
    const v = prop(w, p);
    if (!field && wired(v)) return null;
    if (field && objects(v).some(x => wired(x[field]))) return null;
  }
  if (isStr(end.end) && prop(w, end.end) === true) return null;
  if (isObj(end.when)) {
    const has = [...endings.values()].some(e => isObj(e.when) && (e.outcome ?? 'won') === outcome);
    const evaluator = systems.some(s => evaluatesEndings(registry.get(String(prop(s, 'use')))?.card));
    if (has && evaluator) return null;
    if (has) return `its ending's \`when\` trigger has no evaluator in the document (a loop that reads plot.endings)`;
  }
  if (isStr(end.ending) && [...endings.values()].some(e => (e.outcome ?? 'won') === outcome)) return null;
  const how = [isStr(end.param) && `an end_game effect in ${l.loop.via ? `${l.loop.via} ` : ''}with.${end.param}`, isStr(end.end) && `with.${end.end} = true`, isObj(end.when) && 'a plot ending with its `when` and the evaluator', isStr(end.ending) && 'a plot ending'].filter(Boolean).join(' or ');
  return `nothing wires it to a ${outcome} ending (${how || 'no wiring declared'})`;
}

/**
 * Members of a loop's object groups that are placed in the world: archetype ids (spawned by rules) per group id.
 * A rule belongs to a group through its own component override, its archetype's group field, or the group's members.
 * @param {unknown} doc @param {RegistryLike} registry @param {import('./content.js').Participants} P @returns {Map<string, Set<string>>}
 */
function placedMembers(doc, registry, P) {
  const arches = new Map(objects(prop(prop(doc, 'content'), 'archetypes')).map(a => [a.id, a]));
  const fieldOf = (/** @type {unknown} */ comps) => (P.field ? prop(prop(comps, P.component), P.field) : undefined);
  /** @type {Map<string, Set<string>>} */
  const out = new Map(P.groups.map(g => [g.id, new Set()]));
  for (const r of spawnRules(doc, registry)) {
    const a = prop(r, 'archetype'); if (!isStr(a)) continue;
    const own = fieldOf(prop(r, 'components')), base = fieldOf(prop(arches.get(a), 'components'));
    const g = P.groups.find(x => (own ?? base) === x.id || x.members.includes(a) || x.members.includes(String(prop(r, 'id'))));
    if (g) out.get(g.id)?.add(a);
  }
  const player = prop(prop(doc, 'player'), 'archetype');
  for (const g of P.groups) if (g.members.includes('player') || (isStr(player) && fieldOf(prop(arches.get(player), 'components')) === g.id)) out.get(g.id)?.add('player');
  return out;
}

/**
 * The structural loop report of a document: problems (errors and warnings) and the loop that owns the win.
 * `core` orders the loops (the first core loop declaring a game-ending win owns it) and names the core losses.
 * @param {unknown} doc @param {RegistryLike} registry @param {{ logic?: LogicLike | null, core?: Iterable<string> | null }} [options]
 * @returns {{ problems: LoopProblem[], owner: string | null, loops: string[] }}
 */
export function loopReport(doc, registry, { logic = null, core = null } = {}) {
  const lg = logic || logicOf(registry);
  const coreIds = core ? [...core] : null;
  const loops = loopInstances(doc, registry);
  /** @type {LoopProblem[]} */
  const problems = [];
  /** @param {string} code @param {LoopInstance} l @param {string} path @param {string} message @param {string} hint @param {LoopNeed} need @param {'error' | 'warning'} [severity] */
  const push = (code, l, path, message, hint, need, severity = 'error') => problems.push({ code, path, message: `${l.use}: ${message}`, hint, severity, stage: 'loop', primitive: l.use, need });
  const used = new Set(list(prop(doc, 'systems')).map(s => prop(s, 'use')).filter(isStr));
  const arches = objects(prop(prop(doc, 'content'), 'archetypes'));
  const playerArch = prop(prop(doc, 'player'), 'archetype');
  const participants = participantsOf(doc, registry);
  const owner = winOwner(loops, coreIds);

  for (const l of loops) {
    const P = l.loop.needs.participants;
    const reads = l === owner ? readsOf(l.loop.win) : null;
    /** Opponent members (archetype ids) of this loop, for the component its win reads; null when it has no groups. @type {Set<string> | null} */
    let opponents = null;
    if (isStr(P)) {
      const spec = l.card.params?.[P];
      const entries = list(l.config[P]);
      const contract = contractsOf(registry, l.use).find(c => c.need === 'param' && c.param === P);
      const min = contract?.min ?? 2;
      const path = `${l.path}.with.${P}`;
      if (entries.length < min) push(LOOP_CODES.participants, l, path, `its loop needs at least ${min} ${P} (card.loop needs.participants), the document has ${entries.length}`, `write with.${P} from the card's default or example${contract?.example ? `: ${JSON.stringify(contract.example).slice(0, 200)}` : ''}`, { kind: 'participants', param: P, min });
      const join = prop(l.card.engage, 'join');
      const where = prop(join, 'param') === P && isObj(prop(join, 'where')) ? /** @type {Record<string, unknown>} */ (prop(join, 'where')) : null;
      const groups = objects(entries).filter(g => isStr(g.id));
      const fieldDefault = (/** @type {string} */ k) => prop(prop(prop(prop(spec, 'of'), 'fields'), k), 'default');
      const seats = (/** @type {Record<string, unknown>} */ g) => Boolean(where) && Object.entries(/** @type {Record<string, unknown>} */ (where)).every(([k, v]) => (g[k] ?? fieldDefault(k)) === v);
      const declaresOpponent = Boolean(l.loop.opponent && l.loop.opponent !== 'none');
      if (where && groups.length) {
        if (!groups.some(seats)) push(LOOP_CODES.seat, l, path, `no ${P} entry seats the player (card.engage.join.where ${JSON.stringify(where)})`, `set ${Object.keys(where).join(', ')} on the player's ${P} entry as card.engage says`, { kind: 'seat', param: P, where });
        else if (declaresOpponent && groups.every(seats)) push(LOOP_CODES.opponent, l, path, `every ${P} entry is the player's: its loop declares an opponent (${l.loop.opponent}) and none plays against the player`, `give the opponent its own ${P} entry, not ${JSON.stringify(where)}`, { kind: 'opponent', param: P, where });
      }
      const seated = participants.find(p => p.path === l.path);
      if (seated) {
        const members = placedMembers(doc, registry, seated);
        seated.groups.forEach((g, j) => {
          if (!(members.get(g.id)?.size)) push(LOOP_CODES.group, l, `${path}[${groups.findIndex(x => x.id === g.id) >= 0 ? groups.findIndex(x => x.id === g.id) : j}]`, `${P} '${g.id}' has no entities in the world (archetypes with a "${seated.component}" component on it, placed by spawns)`, `seat ${seated.component} archetypes for '${g.id}' (the card's content example)`, { kind: 'group', param: P, group: g.id, component: seated.component });
        });
        opponents = new Set(seated.groups.filter(g => !(where && seats(objects(entries).find(x => x.id === g.id) || {}))).flatMap(g => [...(members.get(g.id) || [])]).filter(a => a !== 'player' && a !== playerArch));
      } else if (!groups.length && entries.length) {
        const others = entries.filter(isStr).filter(x => x !== 'player' && x !== playerArch);
        if (declaresOpponent && !others.length) push(LOOP_CODES.opponent, l, path, `${P} lists only the player: its loop declares an opponent (${l.loop.opponent})`, `add the opponents' ids or archetypes to with.${P}`, { kind: 'opponent', param: P });
        opponents = new Set(others.filter(x => arches.some(a => a.id === x)));
      }
    }
    if (l !== owner) continue;
    // The state the win reads, and whether play can change it.
    if (!reads) {
      if (l.loop.win) push(LOOP_CODES.reads, l, `${l.path}`, 'its win declares no `reads` (the state the win condition tests), so whether play can reach it cannot be checked', 'declare card.loop.win.reads (or mode.win.reads): { component, of } | { event } | { var }, with `by` (the verbs, effects or events that change it)', { kind: 'reads' });
    } else if (reads.component) {
      const C = reads.component, owners = ownersOf(registry, C);
      if (!owners.some(o => used.has(o))) push(LOOP_CODES.owner, l, 'systems', `its win reads the "${C}" component, which no primitive of the document runs (owners: ${owners.join(', ') || 'none registered'})`, `add ${owners[0] || `a primitive that owns components.${C}`}`, { kind: 'owner', component: C, owners });
      // The entities the win reads carry the component: its opponents (groups), or what its archetypes contract plays with.
      const of = reads.of || 'opponents';
      const pool = of === 'opponents' ? (opponents ?? new Set(contractsOf(registry, l.use).filter(c => c.need === 'archetypes').flatMap(c => arches.filter(a => a.id !== playerArch && a.kind !== 'player' && (!c.component || prop(a.components, c.component) !== undefined) && (!c.kinds?.length || c.kinds.includes(String(a.kind)))).map(a => String(a.id))))) : null;
      if (pool) {
        const lacking = [...pool].filter(id => { const a = arches.find(x => x.id === id); return !a || prop(a.components, C) === undefined; }).filter(id => !seatOverride(doc, registry, id, C));
        if (lacking.length) push(LOOP_CODES.component, l, 'content.archetypes', `its win reads the ${of}' "${C}", which ${lacking.join(', ')} lack${lacking.length === 1 ? 's' : ''}`, `give them a ${C} component (the card's content example)`, { kind: 'component', component: C, archetypes: lacking, of });
      }
      if (!changesComponent(doc, registry, lg, l, C, used)) push(LOOP_CODES.unaffected, l, l.path, `its win reads the ${of}' "${C}", and no player verb or action changes it (no action effect owned by ${owners.join(' or ') || 'its owner'}, no primitive with player verbs that requires it)`, `add an action whose effects change ${C} (the card's declared example), or a primitive whose player verbs do`, { kind: 'action', component: C, owners, of });
    } else if (reads.event || reads.var) {
      const what = reads.event ? 'event' : 'var', name = /** @type {string} */ (reads.event || reads.var);
      const signal = changesSignal(doc, registry, lg, what, name, used);
      // A provider whose drive is content not written yet (the events its config listens to) is pending until a draft.
      if (signal !== true) push(LOOP_CODES.unaffected, l, l.path, `its win counts the ${what} "${name}", which no player-driven primitive of the document produces${signal === 'idle' ? ' (its providers are driven by nothing in the document yet)' : ''}`, `add a primitive whose player verbs (or the player's movement) produce ${what} ${name}`, { kind: what, [what]: name, ...(signal === 'idle' ? { pending: 'drive' } : {}) });
    }
  }
  // Wiring: the owner's win to a won ending; its lose and the core loops' losses to a lost one. (A collection whose
  // loops declare no win at all is the composition's hole, loop.js composeLoop: the planner adds a primitive that does.)
  // A win wired through the entries of a list param that has none yet (bosses the model writes) is `pending` content.
  if (owner?.loop.win) {
    const why = unwired(doc, owner, owner.loop.win, 'won', registry);
    if (why) push(LOOP_CODES.win, owner, owner.path, `its win (card.loop.win) is never reached: ${why}`, 'wire the win to a won ending', { kind: 'win', ...pendingOf(owner, owner.loop.win) });
  }
  for (const l of loops) {
    if (!endsGame(l.loop.lose) || !(l === owner || coreIds?.includes(l.use))) continue;
    const why = unwired(doc, l, /** @type {LoopEnd} */ (l.loop.lose), 'lost', registry);
    if (why && !why.startsWith('its lose applies only')) push(LOOP_CODES.lose, l, l.path, `its declared lose (card.loop.lose) is never wired: ${why}`, 'wire the lose to a lost ending', { kind: 'lose', ...pendingOf(l, /** @type {LoopEnd} */ (l.loop.lose)) });
  }
  return { problems, owner: owner?.use ?? null, loops: loops.map(l => l.use) };
}

/**
 * Errors of the structural loop check (loopReport's warnings left out). `structure: true` leaves out what only the
 * content the model writes can settle (need.pending: a win wired through list entries not written yet): the check
 * before any model call.
 * @param {unknown} doc @param {RegistryLike} registry @param {{ logic?: LogicLike | null, core?: Iterable<string> | null, structure?: boolean }} [options] @returns {LoopProblem[]}
 */
export const loopProblems = (doc, registry, options = {}) => loopReport(doc, registry, options).problems.filter(p => p.severity === 'error' && !(options.structure && p.need.pending));

/** A win or lose wired through the entries of a list param ('list.field') that has none yet: content to write. @param {LoopInstance} l @param {LoopEnd} end @returns {{ pending?: string }} */
function pendingOf(l, end) {
  const [p, field] = isStr(end.param) ? end.param.split('.') : [];
  return field && !list(l.config[p]).length ? { pending: p } : {};
}

/** Does a spawn rule placing this archetype give it the component (a seat's own components)? @param {unknown} doc @param {RegistryLike} registry @param {string} id @param {string} C */
function seatOverride(doc, registry, id, C) {
  const rules = spawnRules(doc, registry).filter(r => prop(r, 'archetype') === id);
  return rules.length > 0 && rules.every(r => prop(prop(r, 'components'), C) !== undefined);
}

/**
 * Can play change component C? An effect owned by an owner of C in the loop's own params (or its via host's), or a
 * primitive of the document with player verbs that requires an owner of C.
 * @param {unknown} doc @param {RegistryLike} registry @param {LogicLike} logic @param {LoopInstance} l @param {string} C @param {Set<unknown>} used
 */
function changesComponent(doc, registry, logic, l, C, used) {
  const owners = new Set(ownersOf(registry, C));
  const hosts = [l, ...(l.loop.via ? loopInstances(doc, registry).filter(x => x.use === l.loop.via) : [])];
  const wiring = [l.loop.win?.param, l.loop.lose?.param];
  for (const h of hosts) if (actionEffects(h.card, h.config, wiring).some(a => owners.has(String(logic.owners.effect.get(String(a.effect.do)))))) return true;
  for (const id of used) {
    const card = registry.get(String(id))?.card; const verbs = cardLoop(card)?.verbs || [];
    if (verbs.length && (card?.requires?.primitives || []).some(r => [...owners].some(o => satisfies(o, r)))) return true;
  }
  return false;
}

/**
 * Does a player-driven primitive of the document produce the event (or var)? A provider is driven by the player
 * through its own player verbs, the player's movement (a primitive with card.locomotion and verbs) when it needs
 * space capabilities (touching, passing), a primitive with player verbs that requires it, an effect it owns written
 * in the document's data, the document's data it plays out (a section of its card.reads the document has written:
 * story beats whose triggers play satisfies), or an event its config names that a driven primitive provides.
 * -> true (driven), 'idle' (provided, but nothing drives it yet: content to write), false (nothing provides it).
 * @param {unknown} doc @param {RegistryLike} registry @param {LogicLike} logic @param {'event' | 'var'} what @param {string} name @param {Set<unknown>} used
 * @returns {true | 'idle' | false}
 */
function changesSignal(doc, registry, logic, what, name, used) {
  const insts = list(prop(doc, 'systems')).filter(isObj);
  const cards = [...used].map(id => registry.get(String(id))?.card).filter(c => c !== undefined);
  const base = (/** @type {string} */ n) => n.split(':')[0];
  const emits = (/** @type {any} */ c, /** @type {string} */ n) => (c.provides?.events || []).some((/** @type {string} */ e) => e === n || e === base(n) || e === `${base(n)}:*`);
  const provides = (/** @type {any} */ c) => (what === 'event' ? emits(c, name) : (c.provides?.vars || []).some((/** @type {string} */ v) => v === name || name.startsWith(v + '.') || v.endsWith('*') && name.startsWith(v.slice(0, -1))));
  const mover = cards.some(c => isStr(c?.locomotion) && (cardLoop(c)?.verbs || []).length);
  const dataEffects = effectsIn([insts.map(s => s.with), prop(doc, 'plot')]).map(e => logic.owners.effect.get(String(e.do)));
  /** @type {Set<string>} */
  const seen = new Set();
  /** @param {any} c @returns {boolean} */
  const driven = c => {
    if (!c || seen.has(c.id)) return false;
    seen.add(c.id);
    if ((cardLoop(c)?.verbs || []).length) return true;
    if (mover && (c.requires?.capabilities || []).length) return true;
    if (cards.some(o => (cardLoop(o)?.verbs || []).length && (o?.requires?.primitives || []).some(r => satisfies(c.id, r)))) return true;
    if (dataEffects.includes(c.id)) return true;
    if ((c.reads || []).some((/** @type {string} */ r) => written(prop(doc, r.split('.')[0]), r.split('.').slice(1)))) return true;
    // The events its config names (rules it runs on) come from a driven primitive.
    const named = new Set(JSON.stringify(insts.filter(s => s.use === c.id).map(s => s.with)).match(/"[a-z][a-z0-9_]*(?::[A-Za-z0-9_*-]+)?"/g)?.map(x => x.slice(1, -1)) || []);
    return cards.some(o => o !== c && [...named].some(n => emits(o, n)) && driven(o));
  };
  const providers = cards.filter(provides);
  if (providers.some(driven)) return true;
  return providers.length ? 'idle' : false;
}

/** Is a document section (a path under a top-level key) written: a non-empty list or object? @param {unknown} v @param {string[]} path @returns {boolean} */
function written(v, path) {
  const x = path.reduce((/** @type {unknown} */ o, k) => prop(o, k), v);
  return Array.isArray(x) ? x.length > 0 : isObj(x) && Object.keys(x).length > 0;
}

/** Problems as one line each (failure reports, model feedback). @param {LoopProblem[]} problems */
export const loopText = problems => problems.map(p => `[${p.code}] ${p.path}: ${p.message}`);
