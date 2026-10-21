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
//                 whether play can reach it is unknown. A provider only content could drive is pending content when
//                 a player-driven primitive declares what its reads.by names (playerChanges), else an error; a wired
//                 lose whose reads nothing in the document produces -> loop_lose_unproduced;
//   wiring        the win of the loop that owns the game's win (winOwner: the core order's, else the one the document
//                 wires; another loop's declared win the document does not use is no problem) is wired to a won
//                 ending (an end_game effect in its declared param, its `end` boolean, a plot ending filling its `when`
//                 template with its evaluator in the document, or a won story ending), and its declared lose (and the
//                 core loops' losses) to a lost one;
//   opponents     AI-controlled participants act: a loop whose groups have AI control (a group not seating the player
//                 whose engage.join.where field is 'ai'; with no `where`, the non-player participants of a loop whose
//                 declared opponent is 'ai-*'), and a play spec whose opponent is 'ai-*' (options.opponent), need a
//                 primitive that drives them (card.drives, control 'ai': the loop itself, one that names the loop, one
//                 that steers the participants of loops declaring a target service (drives.targets, card.loop.targets),
//                 or one whose components they carry; for the play spec, a driving core loop or a component driver with
//                 a placed carrier) -> loop_opponent_inert (pending content while no carrier is placed and a component
//                 driver of the document declares its archetypes contract); and when such a loop declares a game-ending lose, what its drivers make
//                 the opponents do (drives.actions/effects/events/movement, and the effects in their action data) must
//                 be something that changes what the lose reads (lose.reads.by) -> loop_lose_unaffected_by_opponent.
// Each failure is a stable problem code with a path, a hint and `need` (what is missing, as data) that the preset's
// structural repair (presets.js repairLoop) and the planner's re-planning (replan.js) act on. Nothing here names a
// primitive, a genre or a game: every rule reads a card declaration.
import { readsOf, cardLoop, endsGame, effectsIn, loopInstances, winOwner, unwired, evaluatesEndings, hostOf } from './loop.js';
import { contractsOf, participantsOf } from './content.js';
import { spawnRules, placedBy } from './census.js';
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
 * the model writes) would carry the wiring. A 'driver' need: a primitive that drives AI-controlled participants
 * (card.drives with `control`), of `loop` when the loop declares them (else the play spec's opponent), the opponent
 * archetypes it would drive, and `by`: what its driven entities must be able to do (the loop's lose.reads.by).
 * @typedef {{ kind: 'participants' | 'seat' | 'opponent' | 'group' | 'component' | 'owner' | 'action' | 'event' | 'var' | 'win' | 'lose' | 'reads' | 'driver',
 *   param?: string, min?: number, where?: Record<string, unknown>, group?: string, component?: string, archetypes?: string[], owners?: string[],
 *   event?: string, var?: string, of?: string, pending?: string, control?: string, loop?: string, by?: import('./loop.js').ReadsBy }} LoopNeed
 */
/**
 * A card's drives declaration, normalised (card.drives; types.d.ts Drives).
 * @typedef {{ control: string, components: string[], loops: string[], targets: boolean, actions: string[], effects: string[], events: string[], movement: boolean }} Driving
 */
/**
 * @typedef {{ code: string, path: string, message: string, hint: string, severity: 'error' | 'warning', stage: 'loop', primitive: string, need: LoopNeed }} LoopProblem
 */
/** @typedef {{ logic?: LogicLike | null, core?: Iterable<string> | null, opponent?: string | null }} LoopCheckOptions */
/** @typedef {import('./loop.js').LoopInstance} LoopInstance */

// The win reading the composition check shares (planner/loop.js): re-exported for this module's callers.
export { effectsIn, loopInstances, winOwner, unwired, evaluatesEndings };

export const LOOP_CHECK_VERSION = 'loop-check/0.1';
/** The stable problem codes. */
export const LOOP_CODES = Object.freeze({
  participants: 'loop_participants_missing', seat: 'loop_player_unseated', opponent: 'loop_opponent_missing', group: 'loop_group_empty',
  component: 'loop_component_missing', owner: 'loop_component_unowned', unaffected: 'loop_win_unaffected', win: 'loop_win_unwired',
  lose: 'loop_lose_unwired', reads: 'loop_win_reads_undeclared', inert: 'loop_opponent_inert', loseUnaffected: 'loop_lose_unaffected_by_opponent',
  loseUnproduced: 'loop_lose_unproduced',
});

/** Does a play spec opponent (or a loop's declared opponent) mean AI-controlled participants ('ai-rival', 'ai-side')? @param {unknown} o */
export const aiOpponent = o => isStr(o) && o.startsWith('ai-');
/** @param {unknown} v @returns {string[]} */
const strs = v => (Array.isArray(v) ? v.filter(isStr).map(String) : []);
/** A card's drives declaration (card.drives), or null when it drives nothing. @param {unknown} card @returns {Driving | null} */
export function drivesOf(card) {
  const d = prop(card, 'drives');
  if (!isObj(d) || !isStr(d.control)) return null;
  return { control: String(d.control), components: strs(d.components), loops: strs(d.loops), targets: d.targets === true, actions: strs(d.actions), effects: strs(d.effects), events: strs(d.events), movement: d.movement === true };
}
/** Does a driver drive the participants of its own loop (it names no components, loops or target services)? @param {Driving} d */
export const drivesOwn = d => !d.components.length && !d.loops.length && !d.targets;
/**
 * Does a driver serve a loop by what the loop declares: it names the loop (drives.loops), or it steers the participants
 * of loops with a target service and the loop declares one (drives.targets, card.loop.targets)?
 * @param {Driving} d @param {string} use the loop primitive's id @param {Loop | null | undefined} loop
 */
export const drivesLoop = (d, use, loop) => d.loops.some(r => satisfies(use, r)) || (d.targets && Boolean(loop?.targets));
/**
 * Can what a driver's entities do change what a loop end reads (its reads.by)? Their declared actions, effects, events
 * or movement, plus `effects`: the effects its instance's action data runs. @param {Driving} d @param {import('./loop.js').ReadsBy} by @param {string[]} [effects]
 */
export function drivesBy(d, by, effects = []) {
  const has = (/** @type {string[] | undefined} */ want, /** @type {string[]} */ got) => (want || []).some(x => got.includes(x));
  return has(by.actions, d.actions) || has(by.effects, [...d.effects, ...effects]) || (by.events || []).includes('*') || has(by.events, d.events) || Boolean(by.movement && d.movement);
}

/** @type {WeakMap<object, LogicLike>} */
const logicCache = new WeakMap();
/** The vocabulary owners of a registry (which primitive registers each effect). @param {RegistryLike} registry @returns {LogicLike} */
export function logicOf(registry) {
  let l = logicCache.get(registry);
  if (!l) { l = /** @type {LogicLike} */ (/** @type {unknown} */ (buildLogic(registry, Logic))); logicCache.set(registry, l); }
  return l;
}

/** A registered card with its id (registry.get's card does not carry it; registry.cards() adds it). @param {RegistryLike} registry @param {unknown} id */
const cardWithId = (registry, id) => { const c = registry.get(String(id))?.card; return c ? { ...c, id: String(id) } : undefined; };
/** @param {unknown} id @param {string} req a required primitive id (or prefix) */
const satisfies = (id, req) => id === req || (isStr(id) && id.startsWith(req + '.'));

// readsOf lives with the loop declarations (loop.js), so browser-side readers (the host's HUD) share it.
export { readsOf };

/** Cards that own a component (declare card.components[component]). @param {RegistryLike} registry @param {string} component @returns {string[]} */
export const ownersOf = (registry, component) => registry.cards().filter(c => isObj(c.components) && c.components[component] !== undefined).map(c => c.id).sort();

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

/**
 * Members of a loop's object groups that are placed in the world: archetype ids per group id, placed by any instance
 * of the document that declares an archetype reference in its params (census.js placedBy: spawner rules, a stage's
 * spawns, waves...). A placement belongs to a group through its own component override, its archetype's group field,
 * or the group's members (its archetype or its entity id).
 * @param {unknown} doc @param {RegistryLike} registry @param {import('./content.js').Participants} P @returns {Map<string, Set<string>>}
 */
function placedMembers(doc, registry, P) {
  const arches = new Map(objects(prop(prop(doc, 'content'), 'archetypes')).map(a => [a.id, a]));
  const fieldOf = (/** @type {unknown} */ comps) => (P.field ? prop(prop(comps, P.component), P.field) : undefined);
  /** @type {Map<string, Set<string>>} */
  const out = new Map(P.groups.map(g => [g.id, new Set()]));
  for (const r of placedBy(doc, registry)) {
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
 * `core` orders the loops (the first core loop declaring a game-ending win owns it, else the wired one: winOwner) and
 * names the core losses;
 * `opponent` is the play spec's opponent ('ai-*': AI-controlled participants play against the player).
 * @param {unknown} doc @param {RegistryLike} registry @param {LoopCheckOptions} [options]
 * @returns {{ problems: LoopProblem[], owner: string | null, loops: string[] }}
 */
export function loopReport(doc, registry, { logic = null, core = null, opponent = null } = {}) {
  const lg = logic || logicOf(registry);
  const coreIds = core ? [...core] : null;
  const loops = loopInstances(doc, registry);
  /** @type {LoopProblem[]} */
  const problems = [];
  /** @param {string} code @param {LoopInstance} l @param {string} path @param {string} message @param {string} hint @param {LoopNeed} need @param {'error' | 'warning'} [severity] */
  const push = (code, l, path, message, hint, need, severity = 'error') => problems.push({ code, path, message: `${l.use}: ${message}`, hint, severity, stage: 'loop', primitive: l.use, need });
  // The document's primitives: its systems and the generators of its spaces.
  const used = new Set([...list(prop(doc, 'systems')), ...list(prop(doc, 'spaces')).flatMap(sp => list(prop(sp, 'generators')))].map(s => prop(s, 'use')).filter(isStr));
  const arches = objects(prop(prop(doc, 'content'), 'archetypes'));
  const playerArch = prop(prop(doc, 'player'), 'archetype');
  const participants = participantsOf(doc, registry);
  const owner = winOwner(doc, registry, loops, coreIds);
  // The primitives of the document that act for AI-controlled entities (card.drives), with the effects their action data runs.
  const drivers = driversIn(doc, registry);
  const rules = spawnRules(doc, registry);
  /** Does an archetype carry component C (its own components, or a spawn rule's override placing it)? @param {string} a @param {string} C */
  const carries = (a, C) => prop(prop(arches.find(x => x.id === a), 'components'), C) !== undefined || rules.some(r => prop(r, 'archetype') === a && prop(prop(r, 'components'), C) !== undefined);
  /** The drivers of a loop's AI participants (the loop, or the host it plays through, driving its own). @param {LoopInstance} l @param {Set<string>} ai @returns {DriverInstance[]} */
  const driving = (l, ai) => drivers.filter(d => ((d.use === l.use || d.use === l.loop.via) && drivesOwn(d.drives)) || drivesLoop(d.drives, l.use, l.loop) || [...ai].some(a => d.drives.components.some(C => carries(a, C))));
  /** Core loops that declare AI-controlled participants or an AI opponent: they answer the play spec's opponent (checked above). @type {Set<string>} */
  const aiCore = new Set();
  const isCore = (/** @type {LoopInstance} */ l) => l === owner || !coreIds || coreIds.includes(l.use);

  /**
   * The participants a loop's `needs.participants` param seats, on the instance that holds the param (`l`: the loop,
   * or the card.mode.via host it plays through): its problems pushed once per holder, and the opponents and AI-controlled
   * archetypes it seats. @param {LoopInstance} l
   * @returns {{ opponents: Set<string> | null, hasAI: boolean, aiArch: Set<string> }}
   */
  const seat = l => {
    const P = l.loop.needs.participants;
    /** Opponent members (archetype ids) of this loop, for the component its win reads; null when it has no groups. @type {Set<string> | null} */
    let opponents = null;
    /** Whether the loop declares AI-controlled participants, and their archetypes placed in the world. */
    let hasAI = false;
    /** @type {Set<string>} */
    let aiArch = new Set();
    const loopAI = aiOpponent(l.loop.opponent);
    if (!isStr(P)) return { opponents, hasAI, aiArch };
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
      // AI control: a group that does not seat the player whose seating field (engage.join.where) is 'ai'; with no
      // `where`, every group without the player when the loop's declared opponent is AI-controlled.
      const ai = seated.groups.filter(g => {
        const entry = objects(entries).find(x => x.id === g.id) || {};
        if (where) return !seats(entry) && Object.keys(where).some(k => (entry[k] ?? fieldDefault(k)) === 'ai');
        return loopAI && !g.members.includes('player') && !members.get(g.id)?.has('player');
      });
      hasAI = ai.length > 0;
      aiArch = new Set(ai.flatMap(g => [...(members.get(g.id) || [])]).filter(a => a !== 'player' && a !== playerArch));
    } else if (!groups.length && entries.length) {
      const others = entries.filter(isStr).filter(x => x !== 'player' && x !== playerArch);
      if (declaresOpponent && !others.length) push(LOOP_CODES.opponent, l, path, `${P} lists only the player: its loop declares an opponent (${l.loop.opponent})`, `add the opponents' ids or archetypes to with.${P}`, { kind: 'opponent', param: P });
      opponents = new Set(others.filter(x => arches.some(a => a.id === x)));
      hasAI = loopAI && others.length > 0;
      aiArch = opponents;
    } else if (groups.length && isStr(prop(join, 'field')) && prop(join, 'param') === P) {
      // Groups that list their members (engage.join.field) with no component seating them: the AI-controlled ones
      // are those not seating the player whose seating field is 'ai', or (no `where`, an AI opponent) those whose
      // members do not include the player.
      const field = String(prop(join, 'field'));
      const isPlayer = (/** @type {string} */ m) => m === 'player' || m === playerArch;
      const ai = groups.filter(g => (where ? !seats(g) && Object.keys(where).some(k => (g[k] ?? fieldDefault(k)) === 'ai') : loopAI && !list(g[field]).some(m => isStr(m) && isPlayer(m))));
      const others = ai.flatMap(g => list(g[field]).filter(isStr).map(String)).filter(m => !isPlayer(m));
      hasAI = others.length > 0;
      aiArch = new Set(others.filter(x => arches.some(a => a.id === x)));
    }
    return { opponents, hasAI, aiArch };
  };
  /** @type {Map<string, { opponents: Set<string> | null, hasAI: boolean, aiArch: Set<string> }>} */
  const seated = new Map();
  /**
   * A loop played through another primitive (card.mode.via) seats the participants its host's params hold: the host's
   * loop instance (checked once, as that loop), or the host's instance read with this loop's declaration.
   * @param {LoopInstance} l @returns {LoopInstance}
   */
  const holder = l => {
    if (!l.loop.via) return l;
    const host = loops.find(x => x.use === l.loop.via);
    if (host) return host;
    const systems = list(prop(doc, 'systems')), i = systems.findIndex(s => prop(s, 'use') === l.loop.via), inst = systems[i];
    const card = registry.get(String(l.loop.via))?.card;
    if (!isObj(inst) || !card) return l;
    /** @type {Record<string, unknown>} */
    let config = {};
    try { config = { ...defaultsOf(/** @type {any} */ (card)), ...(isObj(inst.with) ? inst.with : {}) }; } catch { config = isObj(inst.with) ? { ...inst.with } : {}; }
    return { ...l, use: String(l.loop.via), path: `systems[${i}]`, card, config, inst };
  };

  for (const l of loops) {
    const reads = l === owner ? readsOf(l.loop.win) : null;
    const H = holder(l);
    if (!seated.has(H.path)) seated.set(H.path, seat(H));
    const { opponents, aiArch } = /** @type {{ opponents: Set<string> | null, hasAI: boolean, aiArch: Set<string> }} */ (seated.get(H.path));
    // The host's own loop checks that its AI participants are driven; a loop through it shares them.
    const hasAI = Boolean(seated.get(H.path)?.hasAI) && (H === l || !loops.includes(H));
    const loopAI = aiOpponent(l.loop.opponent);
    const P = H.loop.needs.participants;
    // Its AI-controlled participants act: a primitive drives them, and (when its lose ends the game) what they do can
    // change what that lose reads.
    if (hasAI) {
      const by = endsGame(l.loop.lose) && isCore(l) ? readsOf(l.loop.lose)?.by : undefined;
      const lose = by && Object.keys(by).length ? by : null;
      const ds = driving(l, aiArch);
      // A driver acting by a component (whose behaviour can change the lose) while none of the loop's AI participants
      // is placed yet: its carriers are content the model writes from its archetypes contract (whose declared example
      // the structural repair puts on them), pending until a draft.
      const carriers = !ds.length && !aiArch.size && drivers.some(d => (!lose || drivesBy(d.drives, lose, d.effects))
        && d.drives.components.some(C => contractsOf(registry, d.use).some(c => c.need === 'archetypes' && c.component === C && c.example !== undefined)));
      const need = /** @type {LoopNeed} */ ({ kind: 'driver', control: 'ai', loop: l.use, archetypes: [...aiArch].sort(), ...(lose ? { by: lose } : {}), ...(carriers ? { pending: 'archetypes' } : {}) });
      const does = lose ? ` and can change what its lose reads (${byText(lose)})` : '';
      if (!ds.length) push(LOOP_CODES.inert, l, l.path, `its loop has AI-controlled participants (${need.archetypes?.join(', ') || P}) and no primitive of the document drives them (card.drives control 'ai': this loop, one naming it, one steering by its target service, or one whose components they carry)`, `add a primitive that drives them${does} (card.drives), with its component on them`, need);
      else if (lose && !ds.some(d => drivesBy(d.drives, lose, d.effects))) push(LOOP_CODES.loseUnaffected, l, l.path, `its lose reads ${readsText(readsOf(l.loop.lose))}, changed by ${byText(lose)}, and nothing its AI participants' drivers (${ds.map(d => d.use).join(', ')}) make them do changes it`, `give the opponents an action whose effects change it (the card's declared example), or add a driver whose entities do (${byText(lose)})`, need);
    }
    if ((hasAI || loopAI) && isCore(l)) aiCore.add(l.use);
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
      const signal = changesSignal(doc, registry, lg, what, name, used, reads);
      // A provider whose drive is content not written yet (the events its config listens to, the effects data runs) is
      // pending until a draft, but only when the document declares a player-driven way to change it (what its reads.by
      // names: playerChanges, or the player's own movement, which selection completes with a base locomotion for avatar
      // play); otherwise no content can drive it and the collection lacks a primitive.
      const hooked = signal === 'idle' && (!reads.by || Boolean(reads.by.movement) || [...used].some(id => playerChanges(registry, cardWithId(registry, id), /** @type {import('./loop.js').ReadsBy} */ (reads.by), { logic: lg, used })));
      if (signal !== true) push(LOOP_CODES.unaffected, l, l.path, `its win counts the ${what} "${name}", which no player-driven primitive of the document produces${signal === 'idle' ? hooked ? ' (its providers are driven by nothing in the document yet)' : ` (its providers are driven by nothing in the document, and no player-driven primitive of it declares what changes it: ${byText(reads.by || {})})` : ''}`, `add a primitive whose player verbs (or the player's movement) produce ${what} ${name}`, { kind: what, [what]: name, ...(hooked ? { pending: 'drive' } : {}) });
    }
  }
  // Every game-ending lose that is wired (the owner's, the core loops'): something in the document produces what it
  // reads (the component's owner runs, or a primitive provides the event or var); a lose nothing can produce never happens.
  for (const l of loops) {
    if (!endsGame(l.loop.lose) || !(l === owner || coreIds?.includes(l.use))) continue;
    const r = readsOf(l.loop.lose);
    if (!r) continue;
    if (r.component) {
      const owners = ownersOf(registry, r.component);
      // (Once per component: the win's unowned component, reported above, is the same missing owner.)
      if (!owners.some(o => used.has(o)) && !problems.some(p => p.code === LOOP_CODES.owner && p.need.component === r.component)) push(LOOP_CODES.loseUnproduced, l, 'systems', `its lose reads the "${r.component}" component, which no primitive of the document runs (owners: ${owners.join(', ') || 'none registered'})`, `add ${owners[0] || `a primitive that owns components.${r.component}`}`, { kind: 'owner', component: r.component, owners });
    } else if (r.event || r.var) {
      const what = r.event ? 'event' : 'var', name = /** @type {string} */ (r.event || r.var);
      if (changesSignal(doc, registry, lg, what, name, used) === false) push(LOOP_CODES.loseUnproduced, l, l.path, `its lose counts the ${what} "${name}", which no primitive of the document produces`, `add a primitive that produces ${what} ${name}`, { kind: what, [what]: name });
    }
  }
  // The play spec's AI opponent plays against the player in the core loop: a core loop that declares AI participants
  // (their drivers are checked above), or a driver acting on any entity that carries its components, with a placed
  // carrier. A component driver whose carriers are not placed yet is `pending` content (its archetypes contract: the
  // model writes them).
  const host = owner || loops.find(isCore) || loops[0];
  if (aiOpponent(opponent) && host && !aiCore.size) {
    const placed = [...new Set(rules.map(r => prop(r, 'archetype')).filter(isStr).map(String))].filter(a => a !== playerArch && prop(arches.find(x => x.id === a), 'kind') !== 'player').sort();
    const components = drivers.filter(d => d.drives.components.length);
    if (!components.some(d => placed.some(a => d.drives.components.some(C => carries(a, C))))) {
      push(LOOP_CODES.inert, host, 'systems', `the play spec's opponent (${opponent}) plays against the player, and no primitive drives it: no core loop's AI participants are driven and no driver's components (card.drives) are on a placed entity${components.length ? ` (${components.map(d => `${d.use}: ${d.drives.components.join('/')}`).join(', ')})` : ''}`,
        components.length ? `place opponents carrying ${components[0].drives.components[0]} (the ${components[0].use} content example)` : 'add a primitive that drives AI-controlled entities (card.drives), with its component on the opponents',
        { kind: 'driver', control: 'ai', archetypes: placed, ...(components.length ? { pending: 'archetypes' } : {}) });
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
 * @param {unknown} doc @param {RegistryLike} registry @param {LoopCheckOptions & { structure?: boolean }} [options] @returns {LoopProblem[]}
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

/** Does a card run effects written in its params (an effects param, or an effects field of a list param), its loop's win and lose wiring left out? @param {any} card */
export function runsEffects(card) {
  const loop = cardLoop(card);
  const wiring = [loop?.win?.param, loop?.lose?.param].filter(isStr);
  return Object.entries(card?.params || {}).some(([k, spec]) => (spec?.type === 'effects' && !wiring.includes(k))
    || (spec?.type === 'list' && isObj(spec.of) && Object.entries(spec.of.fields || {}).some(([f, fs]) => prop(fs, 'type') === 'effects' && !wiring.includes(`${k}.${f}`))));
}

/**
 * Does a card move the player's body under the player's controls? A locomotion (card.locomotion) with player verbs, or a
 * primitive that moves the entity the player is seated in from the start (card.engage.player.movement: a vehicle).
 * The one source of "the player's movement" for the loop check (reads.by.movement). @param {any} card
 */
export const movesPlayer = card => Boolean(card) && ((isStr(card.locomotion) && (cardLoop(card)?.verbs || []).length > 0) || prop(prop(card.engage, 'player'), 'movement') === true);

/**
 * Does a card, played by the player, declare a way to change what a loop end reads (its reads.by)? It is player-driven
 * (its own player verbs, or a space capability it needs while the collection moves the player's body: movesPlayer) and
 * provides one of the actions or events `by` names (any event for '*'), moves the player's body when `by` names movement, or
 * runs effects from its params when `by` names an effect a primitive of `used` (or the card itself) owns.
 * @param {RegistryLike} registry @param {any} card @param {import('./loop.js').ReadsBy} by @param {{ logic: LogicLike, used: Iterable<unknown> }} context
 */
export function playerChanges(registry, card, by, { logic, used }) {
  if (!card) return false;
  const ids = new Set([...used].map(String));
  const verbs = cardLoop(card)?.verbs || [];
  const moves = [...ids, card.id].some(id => movesPlayer(registry.get(id)?.card));
  if (!verbs.length && !movesPlayer(card) && !(moves && (card.requires?.capabilities || []).length)) return false;
  const events = card.provides?.events || [];
  if ((by.actions || []).some(a => (card.provides?.actions || []).includes(a))) return true;
  if ((by.events || []).some(e => (e === '*' ? events.length > 0 : events.includes(e)))) return true;
  if (by.movement && movesPlayer(card)) return true;
  return (by.effects || []).some(e => { const o = logic.owners.effect.get(e); return isStr(o) && (o === card.id || ids.has(o)); }) && runsEffects(card);
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
 * through its own player verbs, the player's movement (a primitive that moves the player's body: movesPlayer) when it needs
 * space capabilities (touching, passing), a primitive with player verbs that requires it, an effect it owns written
 * in the document's data, the document's data it plays out (a section of its card.reads the document has written:
 * story beats whose triggers play satisfies), an event its config names that a driven primitive provides, or an event
 * its code runs on that a driven primitive provides: the reads.by.events of the read being checked (for its `from`
 * writer, or every provider when it names none) and of the provider's own loop ends reading the same quantity ('*': any
 * event). -> true (driven), 'idle' (provided, but nothing drives it yet: content to write), false (nothing provides it).
 * @param {unknown} doc @param {RegistryLike} registry @param {LogicLike} logic @param {'event' | 'var'} what @param {string} name @param {Set<unknown>} used
 * @param {LoopReads | null} [reads] the read being checked
 * @returns {true | 'idle' | false}
 */
function changesSignal(doc, registry, logic, what, name, used, reads = null) {
  const insts = list(prop(doc, 'systems')).filter(isObj);
  // The used cards with their ids (a registered card does not carry its own id: registry.cards() adds it).
  const cards = [...used].flatMap(id => { const c = registry.get(String(id))?.card; return c ? [{ ...c, id: String(id) }] : []; });
  const base = (/** @type {string} */ n) => n.split(':')[0];
  const emits = (/** @type {any} */ c, /** @type {string} */ n) => (c.provides?.events || []).some((/** @type {string} */ e) => e === n || e === base(n) || e === `${base(n)}:*`);
  const provides = (/** @type {any} */ c) => (what === 'event' ? emits(c, name) : (c.provides?.vars || []).some((/** @type {string} */ v) => v === name || name.startsWith(v + '.') || v.endsWith('*') && name.startsWith(v.slice(0, -1))));
  const mover = cards.some(movesPlayer);
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
    if (cards.some(o => o !== c && [...named].some(n => emits(o, n)) && driven(o))) return true;
    // The events its code runs on (declared reads.by.events) come from a driven primitive.
    const on = runsOn(c);
    return cards.some(o => o !== c && (on.has('*') ? (o.provides?.events || []).length > 0 : [...on].some(n => emits(o, n))) && driven(o));
  };
  /** The same quantity as the signal: its event (typed or not) or its var. @param {LoopReads | null} r */
  const same = r => Boolean(r) && (what === 'event' ? isStr(r?.event) && base(String(r?.event)) === base(name) : r?.var === name);
  /** @param {any} c @returns {Set<string>} */
  const runsOn = c => new Set([
    ...(same(reads) && (!reads?.from || reads.from === c.id) ? reads?.by?.events || [] : []),
    ...[cardLoop(c)?.win, cardLoop(c)?.lose].map(readsOf).filter(same).flatMap(r => r?.by?.events || []),
  ]);
  const providers = cards.filter(provides);
  if (providers.some(driven)) return true;
  return providers.length ? 'idle' : false;
}

/** Is a document section (a path under a top-level key) written: a non-empty list or object? @param {unknown} v @param {string[]} path @returns {boolean} */
function written(v, path) {
  const x = path.reduce((/** @type {unknown} */ o, k) => prop(o, k), v);
  return Array.isArray(x) ? x.length > 0 : isObj(x) && Object.keys(x).length > 0;
}

/** A driver instance of a document. @typedef {{ use: string, index: number, card: Record<string, any>, drives: Driving, effects: string[] }} DriverInstance */
/**
 * The primitives of a document that drive AI-controlled entities (card.drives control 'ai'), with the effects their
 * instance's action data runs (its loop's win and lose params left out). @param {unknown} doc @param {RegistryLike} registry @returns {DriverInstance[]}
 */
export function driversIn(doc, registry) {
  /** @type {DriverInstance[]} */
  const out = [];
  list(prop(doc, 'systems')).forEach((s, index) => {
    const use = prop(s, 'use'); if (!isStr(use)) return;
    const card = registry.get(use)?.card; const drives = drivesOf(card);
    if (!card || !drives || drives.control !== 'ai') return;
    /** @type {Record<string, unknown>} */
    let config = {};
    try { config = { ...defaultsOf(/** @type {any} */ (card)), ...(isObj(prop(s, 'with')) ? /** @type {Record<string, unknown>} */ (prop(s, 'with')) : {}) }; } catch { config = {}; }
    const loop = cardLoop(card);
    out.push({ use, index, card, drives, effects: [...new Set(actionEffects(card, config, [loop?.win?.param, loop?.lose?.param]).map(a => String(a.effect.do)))] });
  });
  return out;
}
/** @param {import('./loop.js').ReadsBy} by */
const byText = by => [by.actions?.length && `actions ${by.actions.join('/')}`, by.effects?.length && `effects ${by.effects.join('/')}`, by.events?.length && `events ${by.events.join('/')}`, by.movement && 'movement'].filter(Boolean).join(', ') || 'nothing declared';
/** @param {LoopReads | null} r */
const readsText = r => (!r ? 'nothing declared' : r.component ? `the ${r.of || 'opponents'}' "${r.component}"` : r.event ? `the event "${r.event}"` : `the var "${r.var}"`);

/** Problems as one line each (failure reports, model feedback). @param {LoopProblem[]} problems */
export const loopText = problems => problems.map(p => `[${p.code}] ${p.path}: ${p.message}`);
