// @ts-check
// The loop steps of the iterative build (build.js), after its mechanic steps, and of re-planning (replan.js): one
// mechanism that completes the core loop the mechanic steps built, never a pick made by the preset or the repair.
//
// After every step the static loop check (loop-check.js) runs on the partial collection: the preset's document of the
// collection alone (presets.js preset: its structure, participants and wiring, which add no primitive), whose
// remaining loop errors (content the model writes later, need.pending, left out) say what is still missing:
//   win       no primitive of the collection declares a game-ending win that can be wired (card.loop.win);
//   lose      the play spec says how the game is lost (core.lose) and no core loop declares a game-ending lose;
//   driver    AI-controlled participants nothing drives, or whose drivers cannot change what the lose reads
//             (loop_opponent_inert, loop_lose_unaffected_by_opponent): the spec's opponent or a loop's participants;
//   coverage  the win's reads that no player verb or effect of the collection changes, or whose component nobody owns
//             (loop_win_unaffected, loop_component_unowned), and a wired lose nothing produces (loop_lose_unproduced);
//             its pick joins the mechanic of the primitive whose end it serves. build.js asks it after every mechanic
//             step (for a mechanic other than the core loop's); at re-planning (a gate verdict: no_progress,
//             loop_absent) the win's reads themselves, when the static check found nothing.
//   wins      never two wins (askWins): when several primitives of the collection declare a game-ending win, one
//             small enum question picks the one the play spec's win sentence describes; the others are left unwired.
// Each step is ONE small strict enum question: the candidates are catalogue cards whose declarations answer that need
// (a declared win or lose, card.drives serving those participants and that loop, verbs or effects that change the
// win's reads), played the play spec's way, each as a single card or a minimal bundle (bundles.js formBundle) that
// composes with the collection (compose-check) on its space or through a registered adapter, and that passes the loop
// check of the partial collection with it (its need met, nothing new broken); ranked by their declarations against the
// core loop mechanic and the spec's sentence for display order only: every candidate that passes is offered (ranking never
// cuts an option: ARCHITECTURE §5, never by text overlap). The model picks one id or "none". "none", or no
// candidate, is a gap for the gap layer (the primitive or adapter signature); nothing is added silently.
// Nothing here names a primitive, a genre or a game: everything is read from card declarations.
import { isSpace, isGenerator, isGraphics } from './catalog.js';
import { checkComposition, capsOf } from './compose-check.js';
import { resolveAdapters, adaptersFor, adapterInstanceId, uniqueId, instanceIds, keepMashupAdapters } from './adapters.js';
import { cardLoop, endsGame, composeLoop, loopServes } from './loop.js';
import { readsOf, drivesOf, drivesOwn, drivesLoop, drivesBy, ownersOf, logicOf, playerChanges, LOOP_CODES } from './loop-check.js';
import { preset, coreOf, declaredOutcomes, skinSections, innerOf } from './presets.js';
import { mashupSides } from './play-spec.js';
import { declaredFit, relevance, servesInteraction } from './select.js';
import { formBundle, bundleLabel, BUNDLE_PENALTY } from './bundles.js';
import { parseReply } from './writer.js';
import { str, isObj, prop, messageOf } from '../kernel/guards.js';

/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** @typedef {import('../kernel/types.js').LogicLike} LogicLike */
/** @typedef {import('./types.js').Writer} Writer */
/** @typedef {import('./decompose.js').Decomposition} Decomposition */
/** @typedef {import('./compose-check.js').AdapterInstance} AdapterInstance */
/** @typedef {import('./compose-check.js').AdapterSpec} AdapterSpec */
/** @typedef {import('./adapters.js').MashupRealisation} MashupRealisation */
/** @typedef {import('./select.js').Gap} Gap */
/** @typedef {import('./loop-check.js').LoopProblem} LoopProblem */
/** @typedef {import('./bundles.js').Composes} Composes */
/** The loop steps' kinds (win, lose, driver, coverage), the game's win among several (wins), the inner loop of a nested mashup, and the mashup adapter steps. @typedef {'win' | 'lose' | 'driver' | 'coverage' | 'wins' | 'inner' | 'nested' | 'union' | 'skin'} StepKind */
/**
 * The game's win when several primitives of the collection declare one (askWins): the one picked, the wins offered,
 * why, and the wins left unwired. @typedef {{ use: string, offered: string[], why: string, unwired: string[] }} WinDecision
 */
/** A mechanic as the preset reads it (its core and loops come from the core mechanics' primitives). @typedef {{ id: string, importance: string, primitives: string[] }} StepMechanic */
/**
 * The collection a step reads: its space (the configuration it composes on), systems, adapter instances and bindings,
 * what each mechanic maps to and the core loop mechanic's id (where the win, lose and coverage picks go), the game's
 * win when several are declared (`win`: the primitive askWins picked; it owns the game's win), and the composition
 * checks bound to it (build.js composes / resolveWith; replan.js the same over a selection).
 * @typedef {{ space: { id: string, use: string, with: Record<string, unknown>, role?: string, caps: string[] }, systems: string[], adapters: AdapterInstance[], bind: Record<string, string>,
 *   mechanics: StepMechanic[], loop: string | null, win?: string | null,
 *   composes: (ids: string[]) => Composes, resolve: (ids: string[], variant: number) => { adapters: AdapterInstance[], bind: Record<string, string>, gaps: AdapterSpec[] } }} StepCollection
 */
/**
 * What a step answers: its kind, a stable key, why it is needed, the loop problem it answers (driver, coverage), and the
 * mechanic its pick joins (default: the core loop mechanic; an inner loop joins the joined concept's loop mechanic).
 * @typedef {{ kind: StepKind, key: string, why: string, problem?: LoopProblem, join?: string }} StepNeed
 */
/** A candidate a step offers (build.js BuildCandidate without covers). @typedef {{ id: string, score: number, variant: number, members: string[], extra: import('./bundles.js').Companion[], adapters: import('./bundles.js').BundleAdapter[] }} StepCandidate */
/**
 * One loop step as selection.build.steps records it: the need, the candidates offered (and rejected, with why), the
 * question and its answer, what was added, the gap when none fits, and the loop check of the partial collection after it.
 * @typedef {{ kind: StepKind, mechanic: string | null, need: string, candidates: StepCandidate[], rejected: Array<{ id: string, why: string }>,
 *   asks: Array<{ offered: string[], pick: string, why: string, ok: boolean, problem?: string }>, outcome: 'added' | 'reused' | 'none' | 'gap', primitive: string | null,
 *   members: string[], loop: string[], collection: string[], ms: number, settled?: string }} LoopStep
 */
/** Add a step's pick to the caller's collection, joined to `mechanic` (the core loop mechanic, or an inner loop's): the collection after it, or why not. @typedef {(kind: StepKind, pick: StepCandidate, mechanic?: string | null) => StepCollection | string} Commit */
/** One strict enum question (makeAsk). @typedef {(q: { name: string, system: string, user: string, field: string, options: string[], extra?: Record<string, Record<string, unknown>> }) => Promise<{ pick: string, why: string, reply: Record<string, unknown> }>} Ask */

export const STEPS_VERSION = 'build-steps/0.1';
/** Bound on the loop steps one call asks (each step answers one need). */
export const MAX_LOOP_STEPS = 32;
// The loop codes a driver answers, and those the coverage step answers.
/** @param {string} code (read at call time: loop-check.js and this module import each other through presets.js) */
const isDriverCode = code => code === LOOP_CODES.inert || code === LOOP_CODES.loseUnaffected;
/** @param {string} code */
const isCoverCode = code => code === LOOP_CODES.unaffected || code === LOOP_CODES.owner || code === LOOP_CODES.loseUnproduced;
/** @param {RegistryLike} registry @param {string} id */
const cardOf = (registry, id) => registry.get(id)?.card ?? null;

/**
 * A strict enum question over a writer: a reply outside the enum is asked again (attempts), then the build fails
 * (status 422, code selection_failed): nothing stands in for the model. `count` is told of every model call.
 * @param {{ writer: Writer, attempts?: number, log?: (msg: string) => void, count?: () => void }} options @returns {Ask}
 */
export function makeAsk({ writer, attempts = 2, log = () => {}, count = () => {} }) {
  return async ({ name, system, user, field, options, extra = {} }) => {
    const props = { [field]: { type: 'string', enum: options }, why: { type: 'string', description: 'one line' }, ...extra };
    const schema = { name, schema: { type: 'object', additionalProperties: false, required: Object.keys(props), properties: props } };
    /** @type {string[]} */
    const failed = [];
    for (let i = 0; i < Math.max(1, attempts); i++) {
      count();
      try {
        const reply = await writer.complete({ system, user: failed.length ? `${user}\n\nYour previous reply failed (${failed[failed.length - 1]}): answer with one of the listed ids.` : user, schema });
        const value = parseReply(reply.text);
        const pick = str(prop(value, field));
        if (options.includes(pick)) return { pick, why: str(prop(value, 'why')).slice(0, 200), reply: isObj(value) ? value : {} };
        failed.push(`'${pick.slice(0, 60)}' is not one of ${options.join(', ').slice(0, 200)}`);
      } catch (error) { failed.push(String(messageOf(error)).slice(0, 160)); log(`${name} failed: ${messageOf(error)}`); }
    }
    throw Object.assign(Error(`Building the collection failed at ${name} after ${failed.length} attempt(s): ${failed.join('; ')}`), { status: 422, code: 'selection_failed', attempts: failed });
  };
}

/** @param {{ check: string, code: string, unit: string, space?: string }} f */
const failureKey = f => `${f.check}:${f.code}:${f.unit}:${f.space ?? ''}`;
/**
 * A selection (select.js) as the loop steps read it, for re-planning: its first space, systems, adapters and bindings,
 * its mechanics and core loop mechanic, and the composition checks over it (a candidate composes when it adds no
 * failure and no type hole of its own; adapters as resolveAdapters projects them).
 * @param {RegistryLike} registry @param {import('./select.js').Selection} sel @param {string | null} loop the core loop mechanic's id
 * @returns {StepCollection}
 */
export function selectionCollection(registry, sel, loop) {
  const space = sel.spaces[0];
  const of = (/** @type {string[]} */ ids) => checkComposition({ spaces: sel.spaces, systems: ids, bind: sel.bind, ...(sel.adapters ? { adapters: sel.adapters } : {}) }, registry, { resolve: true });
  const before = of(sel.systems);
  return {
    space: { id: space?.id || 'world', use: space?.use || '', with: space?.with || {}, role: space?.role, caps: [...(space?.caps || [])] }, systems: [...sel.systems], adapters: [...(sel.adapters || [])], bind: { ...sel.bind },
    mechanics: (sel.mechanics || []).map(m => ({ id: m.id, importance: m.importance, primitives: [...(m.primitives || [])] })), loop, win: sel.win?.use ?? null,
    composes: ids => {
      const more = ids.filter(id => !sel.systems.includes(id));
      if (!more.length) return { ok: true, variant: 0 };
      const after = of([...sel.systems, ...more]);
      const had = new Set(before.failures.map(failureKey));
      const fresh = after.failures.filter(f => !had.has(failureKey(f)));
      const holes = after.holes.filter(h => !before.holes.some(b => b.card === h.card && b.code === h.code && b.field === h.field));
      return !fresh.length && !holes.length ? { ok: true, variant: 0 } : { ok: false, why: (fresh[0]?.message || holes[0]?.message || after.reason).slice(0, 200) };
    },
    resolve: ids => resolveAdapters({ spaces: sel.spaces, systems: [...sel.systems, ...ids.filter(id => !sel.systems.includes(id))] }, registry),
  };
}

/** A loop problem's stable key (its path is left out: indices move as the collection grows). @param {LoopProblem} p */
const problemKey = p => `${p.code}|${p.primitive}|${p.need.kind}|${p.need.loop || ''}|${p.need.component || p.need.event || p.need.var || ''}`;

/** The mechanics with `ids` joined to a mechanic (default the core loop mechanic, as a win, lose or coverage pick joins it). @param {StepCollection} c @param {string[]} ids @param {string | null} [to] @returns {StepMechanic[]} */
const joinLoop = (c, ids, to = c.loop) => c.mechanics.map(m => (m.id === to ? { ...m, primitives: [...m.primitives, ...ids.filter(id => !m.primitives.includes(id))] } : m));
/** The gap's mechanic for a step need. @param {StepNeed} need */
const gapMechanic = need => (need.kind === 'win' ? 'win' : need.kind === 'lose' ? 'lose' : need.kind === 'driver' ? 'opponent' : need.kind === 'coverage' ? 'loop' : need.join || need.kind);
/** The core the preset reads from mechanics (presets.js coreOf). @param {RegistryLike} registry @param {StepMechanic[]} mechanics @param {string[]} systems */
const coreIds = (registry, mechanics, systems) => [...coreOf({ mechanics, systems }, registry)];

/**
 * The static loop check of the partial collection (with `more` and its adapters; `mechanics` as they would map): the
 * preset's document of it (presets.js preset, which adds no primitive), and its loop errors without what content
 * settles later (need.pending). Runs in a few milliseconds.
 * @param {RegistryLike} registry @param {Decomposition} decomposition @param {StepCollection} c
 * @param {{ more?: string[], adapters?: AdapterInstance[], mechanics?: StepMechanic[], logic?: LogicLike | null }} [options]
 * @returns {{ owner: string | null, problems: LoopProblem[] }}
 */
export function partialCheck(registry, decomposition, c, { more = [], adapters = [], mechanics = c.mechanics, logic = null } = {}) {
  const systems = [...c.systems, ...more.filter(id => !c.systems.includes(id))];
  const selection = { systems, spaces: [{ role: 'world', ...c.space, caps: [...c.space.caps] }], generators: [], graphics: [], bind: { ...c.bind }, gaps: [], adapters: [...c.adapters, ...adapters].map(a => structuredClone(a)),
    mechanics: mechanics.map(m => ({ ...m, primitives: [...m.primitives] })), ...(c.win ? { win: { use: c.win } } : {}) };
  const p = preset({ decomposition: structuredClone(decomposition), selection: /** @type {any} */ (selection), registry, logic: logic || logicOf(registry), seed: 1 });
  return { owner: p.structure.loopCheck.owner, problems: p.loop };
}

/**
 * What the collection still needs, in step order (win, lose, driver, coverage), from its declarations and the loop
 * check of the partial collection. @param {RegistryLike} registry @param {Decomposition} decomposition @param {StepCollection} c
 * @param {ReturnType<typeof partialCheck>} check @returns {StepNeed[]}
 */
export function loopNeeds(registry, decomposition, c, check) {
  /** @type {StepNeed[]} */
  const out = [];
  const composed = composeLoop(c.systems, registry, { core: coreIds(registry, c.mechanics, c.systems) });
  const unwired = check.problems.find(p => p.code === LOOP_CODES.win && p.primitive === check.owner);
  if (!composed.win || unwired) out.push({ kind: 'win', key: 'win', why: unwired ? unwired.message : `no primitive of the collection (${c.systems.join(', ') || 'empty'}) declares a game-ending win (card.loop.win)` });
  const lose = str(decomposition.core?.lose).trim();
  const ownerLose = check.owner ? cardLoop(cardOf(registry, check.owner))?.lose : null;
  if (lose && !composed.lose.length && !endsGame(ownerLose)) out.push({ kind: 'lose', key: 'lose', why: `the play spec is lost by "${lose}" and no core loop of the collection declares a game-ending lose (card.loop.lose)` });
  for (const p of check.problems) if (isDriverCode(p.code)) out.push({ kind: 'driver', key: `driver:${problemKey(p)}`, why: p.message, problem: p });
  // What play cannot change of an end's reads: its pick joins the mechanic that primitive was chosen for.
  for (const p of check.problems) if (isCoverCode(p.code)) { const join = mechanicOf(c, p.primitive); out.push({ kind: 'coverage', key: `coverage:${problemKey(p)}`, why: p.message, problem: p, ...(join ? { join } : {}) }); }
  return out;
}

/** The first mechanic (in the collection's order) a primitive maps to, or null. @param {StepCollection} c @param {string} id */
export const mechanicOf = (c, id) => c.mechanics.find(m => m.primitives.includes(id))?.id ?? null;

/** The end of a loop problem's primitive that its reads come from: its lose for loop_lose_unproduced, else its win. @param {RegistryLike} registry @param {LoopProblem} p */
const problemEnd = (registry, p) => { const loop = cardLoop(cardOf(registry, p.primitive)); return p.code === LOOP_CODES.loseUnproduced ? loop?.lose : loop?.win; };

/** The text of what a loop end reads. @param {import('./loop-check.js').LoopReads | null} r */
const readsText = r => (!r ? 'nothing declared' : r.component ? `the ${r.of || 'opponents'}' "${r.component}"` : r.event ? `the event "${r.event}"` : `the var "${r.var}"`);
/** @param {import('./loop.js').ReadsBy | undefined} by */
const byText = by => (by ? [by.actions?.length && `actions ${by.actions.join('/')}`, by.effects?.length && `effects ${by.effects.join('/')}`, by.events?.length && `events ${by.events.join('/')}`, by.movement && 'movement'].filter(Boolean).join(', ') : '') || 'nothing declared';

/**
 * Cards whose declarations answer a need (before the composition and loop checks): a game-ending win or lose; a
 * driver with the need's control serving those participants and that loop (it names the loop or steers by its target
 * service, or acts by a component the preset puts on them) whose behaviour changes what the lose reads; or, for the
 * coverage of what an end reads, its owner, a primitive with player verbs that requires it, a provider of the event
 * or var it counts, the owner of an effect or the provider of an action its reads.by names, or a player-driven card
 * that declares a way to change it (loop-check.js playerChanges: it provides an action or event reads.by names, moves
 * the player, or runs effects from its params when reads.by names an effect the collection owns).
 * @param {RegistryLike} registry @param {LogicLike} logic @param {StepNeed} need @param {{ reads: import('./loop-check.js').LoopReads | null, used: string[] }} context @returns {(card: any) => boolean}
 */
function answers(registry, logic, need, { reads, used }) {
  if (need.kind === 'win') return card => endsGame(cardLoop(card)?.win);
  if (need.kind === 'lose') return card => endsGame(cardLoop(card)?.lose);
  // The inner loop of a nested encounter: a loop that declares what its result means for an encounter's participants.
  if (need.kind === 'inner') return card => Boolean(cardLoop(card)?.outcome) && startOf(card).length > 0;
  const n = need.problem?.need;
  if (need.kind === 'driver' && n) {
    const loop = n.loop ? cardLoop(cardOf(registry, n.loop)) : null;
    return card => {
      const d = drivesOf(card);
      if (!d || d.control !== n.control || (drivesOwn(d) && card.id !== n.loop)) return false;
      if (n.by && !drivesBy(d, n.by)) return false;
      return n.loop ? (card.id === n.loop || drivesLoop(d, n.loop, loop) || d.components.length > 0) : d.components.length > 0;
    };
  }
  // Coverage: what changes the win's reads (the problem's need, else the owner's declared reads).
  const component = n?.component || reads?.component;
  const name = n?.event || n?.var || reads?.event || reads?.var;
  const owners = component ? ownersOf(registry, component) : [];
  const by = reads?.by;
  const base = String(name || '').split(':')[0];
  return card => {
    if (owners.includes(card.id)) return true;
    const verbs = cardLoop(card)?.verbs || [];
    if (verbs.length && owners.length && (card.requires?.primitives || []).some((/** @type {string} */ r) => owners.some(o => o === r || o.startsWith(r + '.')))) return true;
    if (name && (card.provides?.events || []).some((/** @type {string} */ e) => e === name || e === base || e === `${base}:*`)) return true;
    if (name && (card.provides?.vars || []).some((/** @type {string} */ v) => v === name || String(name).startsWith(v + '.') || (v.endsWith('*') && String(name).startsWith(v.slice(0, -1))))) return true;
    if ((by?.effects || []).some(e => logic.owners.effect.get(e) === card.id)) return true;
    if ((by?.actions || []).some(a => (card.provides?.actions || []).includes(a))) return true;
    return Boolean(by) && playerChanges(registry, card, /** @type {import('./loop.js').ReadsBy} */ (by), { logic, used });
  };
}

/**
 * The signature the gap layer writes when no catalogue primitive answers a step.
 * @param {StepNeed} need @param {Decomposition} decomposition @param {StepCollection} c @param {RegistryLike} registry @param {string | null} owner @param {string} [spec]
 */
function signatureOf(need, decomposition, c, registry, owner, spec = '') {
  const interaction = decomposition.core?.interaction || null;
  const on = `on ${c.space.use} (${c.space.caps.join(', ')})`;
  const verbs = [...new Set(c.systems.flatMap(id => cardLoop(cardOf(registry, id))?.verbs || []))];
  const n = need.problem?.need;
  const text = need.kind === 'win' || need.kind === 'lose'
    ? `${need.kind}: a primitive whose loop declares a game-ending ${need.kind} (card.loop.${need.kind}) for "${str(decomposition.core?.[need.kind]) || decomposition.premise}"${interaction ? `, played as ${interaction}` : ''}, whose ${need.kind}.reads ${need.kind === 'win' ? `the collection's player verbs (${verbs.join(', ') || 'none'}) can change` : 'play can change'}, ${on}`
    : need.kind === 'inner' ? `inner loop: a primitive whose loop declares an encounter outcome (card.loop.outcome: each result's effects param and each side's fate) and how an encounter starts it (card.engage.encounter), for "${need.join ? (decomposition.mechanics || []).find(m => m.id === need.join)?.description || need.join : 'the joined concept'}"`
    : need.kind === 'driver' ? `opponent: a primitive that declares card.drives { control: '${n?.control || 'ai'}' } for ${n?.loop ? `the ${n.loop} AI participants` : "the play spec's opponent"}${n?.by ? `, whose entities change what the lose reads (${byText(n.by)})` : ''}, ${on}`
    : need.problem?.code === LOOP_CODES.loseUnproduced ? `loop: a primitive that produces what the ${need.problem.primitive} lose reads (${readsText(readsOf(problemEnd(registry, need.problem)))}), ${on}`
    : `loop: a primitive whose player verbs or effects change what the ${need.problem?.primitive || owner || 'core loop'} win reads (${readsText(need.problem ? readsOf(problemEnd(registry, need.problem)) : owner ? readsOf(cardLoop(cardOf(registry, owner))?.win) : null)}), ${on}`;
  return `${text}${spec ? `. Spec: ${spec}` : ''}`.slice(0, 600);
}

/**
 * The gap layer's request for a step need nothing answers (re-planning without a model, or the step's "none").
 * @param {StepNeed} need @param {Decomposition} decomposition @param {StepCollection} c @param {RegistryLike} registry
 */
export const stepSignature = (need, decomposition, c, registry) => signatureOf(need, decomposition, c, registry, partialCheck(registry, decomposition, c).owner);

/** What a card declares for a step, one line for the model. @param {any} card @param {StepKind} kind */
function declares(card, kind) {
  const loop = cardLoop(card);
  if (kind === 'inner') return loop?.outcome ? `as an encounter: ${Object.entries(loop.outcome.results).map(([r, x]) => `${r} (player ${x.player}${x.opponent ? `, opponent ${x.opponent}` : ''})`).join(', ')}` : '';
  if (kind === 'win' || kind === 'lose') { const end = loop?.[kind]; return end ? `${kind} reads ${readsText(readsOf(end))}${end.reads?.by ? ` (changed by ${byText(end.reads.by)})` : ''}` : ''; }
  if (kind === 'driver') { const d = drivesOf(card); return d ? `drives ${d.loops.length ? `loops ${d.loops.join('/')}` : d.components.length ? `entities with ${d.components.join('/')}` : d.targets ? 'participants by their target service' : 'its own participants'}${d.effects.length || d.actions.length ? `; they ${[...d.actions, ...d.effects].join('/')}` : ''}${d.movement ? '; they move' : ''}` : ''; }
  return loop?.verbs.length ? `verbs: ${loop.verbs.join(', ')}` : '';
}

/**
 * Ask ONE loop step (see the header): the candidates that answer `need`, compose and pass the loop check of the
 * partial collection with them, ranked by declarations; the model picks one or "none". `exclude`: ids never offered
 * (tried before); `among`: when given, only these ids are offered (the build's own retrieval: retrieval.js validOptions
 * for the mechanic the pick joins). -> the step record, the pick (null: a gap) and the gap.
 * @param {{ registry: RegistryLike, decomposition: Decomposition, collection: StepCollection, need: StepNeed, ask: Ask, mechanic?: { id: string, verb: string, description: string } | null,
 *   exclude?: Iterable<string>, among?: Iterable<string> | null, logic?: LogicLike | null }} options
 * @returns {Promise<{ step: LoopStep, pick: StepCandidate | null, gap: Gap | null }>}
 */
export async function askLoopStep({ registry, decomposition, collection: c, need, ask, mechanic = null, exclude = [], among = null, logic = null }) {
  const t0 = performance.now();
  const lg = logic || logicOf(registry);
  const interaction = decomposition.core?.interaction || null;
  const skip = new Set(exclude);
  const before = partialCheck(registry, decomposition, c, { logic: lg });
  const had = new Set(before.problems.map(problemKey));
  const only = among ? new Set(among) : null;
  // What the end reads: the problem's own primitive's (its win, or its lose), else the owner's win.
  const ownerReads = need.problem ? readsOf(problemEnd(registry, need.problem)) : before.owner ? readsOf(cardLoop(cardOf(registry, before.owner))?.win) : null;
  const fits = answers(registry, lg, need, { reads: ownerReads, used: c.systems });
  const sentence = need.kind === 'win' || need.kind === 'lose' ? str(decomposition.core?.[need.kind]) : need.kind === 'driver' ? [decomposition.core?.opponent, decomposition.core?.lose].filter(Boolean).join('. ') : str(decomposition.core?.win);
  // The pool: gameplay and plot cards (no space, generator, graphics or adapter) that answer the need and are played the
  // play spec's way: none whose loop is declared for another interaction and ends the game (another game). A member of
  // the collection may answer a win or lose (it joins the core loop); a driver or coverage need it left open, it cannot.
  const pool = registry.cards().filter(card => {
    if (!/^(gameplay|plot)\./.test(card.id) || isSpace(card.id) || isGenerator(card.id) || isGraphics(card.id) || card.adapts || skip.has(card.id) || (only && !only.has(card.id))) return false;
    // A member of the collection may answer a win or lose; a driver, coverage or inner loop need it left open, it cannot.
    if ((need.kind === 'driver' || need.kind === 'coverage' || need.kind === 'inner') && c.systems.includes(card.id)) return false;
    // An inner loop is played its own way (entered from the outer loop): the spec's interaction does not bind it.
    if (need.kind !== 'inner' && !servesInteraction(card, interaction)) return false;
    const loop = cardLoop(card);
    if (need.kind !== 'inner' && !loopServes(loop, interaction) && (endsGame(loop?.win) || endsGame(loop?.lose))) return false;
    return fits(card);
  }).map(card => ({ card, rank: (mechanic ? declaredFit(mechanic, card, { interaction }) ?? 0 : 0) + (sentence ? relevance({ verb: '', description: sentence }, card) : 0) }))
    .sort((a, b) => b.rank - a.rank || a.card.id.localeCompare(b.card.id));
  /** @type {StepCandidate[]} */
  const candidates = [];
  /** @type {Array<{ id: string, why: string }>} */
  const rejected = [];
  /** @type {AdapterSpec | undefined} */
  let missingAdapter;
  // A win, lose or coverage pick joins the core loop mechanic (the seed: its companions come as its closure); a driver joins the collection only.
  const mechanicsWith = (/** @type {string} */ id) => (need.kind === 'driver' ? c.mechanics : joinLoop(c, [id], need.join ?? c.loop));
  for (const { card, rank } of pool) {
    const b = formBundle({ registry, seed: card.id, systems: c.systems, space: c.space.use, adapters: c.adapters, composes: c.composes, resolve: c.resolve, interaction: need.kind === 'inner' ? null : interaction });
    if (!b.ok) { rejected.push({ id: card.id, why: b.why }); continue; }
    const r = c.resolve(b.members, b.variant);
    if (r.gaps.length) { missingAdapter ??= r.gaps[0]; rejected.push({ id: card.id, why: `needs an adapter no registered primitive provides: ${r.gaps.map(a => a.id).join(', ')}` }); continue; }
    // The loop check of the partial collection with it: the need is met and nothing new breaks (a driver the next step answers aside).
    const mechanics = mechanicsWith(card.id);
    const after = partialCheck(registry, decomposition, c, { more: b.members, adapters: b.adapters, mechanics, logic: lg });
    const fresh = after.problems.filter(p => !had.has(problemKey(p)));
    const breaks = fresh.filter(p => need.kind === 'driver' || !isDriverCode(p.code));
    /** @type {string} */
    let why = breaks.length ? `the loop check fails with it: ${breaks.slice(0, 2).map(p => `[${p.code}] ${p.message}`).join('; ')}` : '';
    if (!why && need.kind === 'win' && !after.owner) why = 'the collection with it still declares no game-ending win';
    if (!why && need.kind === 'lose') {
      const composed = composeLoop([...c.systems, ...b.members], registry, { core: coreIds(registry, mechanics, [...c.systems, ...b.members]) });
      if (!composed.lose.length && !endsGame(after.owner ? cardLoop(cardOf(registry, after.owner))?.lose : null)) why = 'the collection with it still declares no game-ending lose in its core';
    }
    if (!why && need.problem && after.problems.some(p => problemKey(p) === problemKey(/** @type {LoopProblem} */ (need.problem)))) why = `it leaves [${need.problem.code}] ${need.problem.message}`;
    if (why) { rejected.push({ id: card.id, why: why.slice(0, 300) }); continue; }
    const size = b.members.length + b.adapters.length;
    candidates.push({ id: card.id, score: +(rank - BUNDLE_PENALTY * (size - 1)).toFixed(3), variant: b.variant, members: b.members, extra: b.extra, adapters: b.adapters });
  }
  candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  /** @type {LoopStep} */
  const step = { kind: need.kind, mechanic: mechanic?.id ?? null, need: need.why.slice(0, 300), candidates, rejected: rejected.slice(0, 6), asks: [], outcome: 'gap', primitive: null, members: [], loop: [], collection: [...c.systems], ms: 0 };
  const done = (/** @type {StepCandidate | null} */ pick, /** @type {Gap | null} */ gap) => { step.ms = Math.round(performance.now() - t0); return { step, pick, gap }; };
  const gapOf = (/** @type {string} */ why, /** @type {string} */ spec = '') => {
    const adapter = !candidates.length && missingAdapter && rejected.every(x => /needs an adapter/.test(x.why)) ? missingAdapter : undefined;
    const signature = adapter ? `adapter ${adapter.id}: ${adapter.card.adapts.projection}` : signatureOf(need, decomposition, c, registry, before.owner, spec);
    /** @type {Gap} */
    const gap = { mechanic: gapMechanic(need), description: `${need.problem ? `[${need.problem.code}] ` : ''}${adapter ? `needs adapter: ${signature}` : signature}`,
      importance: 'core', kind: adapter ? 'adapter' : need.kind === 'win' ? 'win' : 'no_primitive', why: why.slice(0, 400), signature, ...(adapter ? { adapter, verdict: 'incompatible-needs-adapter' } : {}) };
    return gap;
  };
  if (!candidates.length) return done(null, gapOf(`no catalogue primitive answers it, composes with the collection and passes the loop check${rejected.length ? ` (${rejected.slice(0, 2).map(x => `${x.id}: ${x.why}`).join('; ')})` : ''}`));
  const offered = candidates.map(x => x.id);
  const what = need.kind === 'win' ? 'how the game is WON: a primitive that declares the game-ending win the idea describes'
    : need.kind === 'lose' ? 'how the game is LOST: a primitive that declares the game-ending lose the idea describes'
    : need.kind === 'driver' ? 'what makes the AI-controlled opponents act: a primitive that drives them'
    : need.kind === 'inner' ? 'the joined idea\'s loop, entered from the core loop as an encounter: a primitive whose loop declares what its result means for the participants'
    : "what lets play reach the win: a primitive whose verbs or effects change what the win reads";
  const a = await ask({ name: `pick_${need.kind}`, field: 'pick', options: [...offered, 'none'],
    extra: { spec: { type: 'string', description: 'when pick is "none": what a new primitive must do for this (its rules, inputs, state, events), precise enough to build it; else ""' } },
    system: `You build a game from composable primitives. Its core loop is in the collection; one piece is missing: ${what}. Pick the ONE listed option (by its first id) that gives the game that piece as the idea needs it, or "none" when none of them does (a different way to win, lose or play is "none"). An option written "a + b (why)" is a bundle: picking it adds them all. Every listed option already composes with the collection and passes the loop check with it.`,
    user: `Game idea: ${decomposition.premise}\nPlayed as: ${interaction || 'undecided'}; opponent: ${decomposition.core?.opponent || 'none'}\nWon by: ${str(decomposition.core?.win) || '(unspecified)'}\nLost by: ${str(decomposition.core?.lose) || '(unspecified)'}\nSpace: ${c.space.use}\nCollection so far: ${c.systems.join(', ') || '(empty)'}${mechanic ? `\nCore loop mechanic ${mechanic.id}: ${mechanic.description}` : ''}\n\nMissing: ${need.why.slice(0, 300)}\n\nCandidates:\n${candidates.map(x => { const card = cardOf(registry, x.id); return `- ${bundleLabel(x)}: ${String(card?.intent || '').replace(/\s+/g, ' ').slice(0, 160)}${card ? ` [${declares({ id: x.id, ...card }, need.kind)}]` : ''}`; }).join('\n')}` });
  step.asks.push({ offered, pick: a.pick, why: a.why, ok: a.pick !== 'none' });
  if (a.pick === 'none') return done(null, gapOf(a.why || 'none of the listed primitives fits', str(prop(a.reply, 'spec')).slice(0, 400)));
  const pick = /** @type {StepCandidate} */ (candidates.find(x => x.id === a.pick));
  step.outcome = c.systems.includes(pick.id) ? 'reused' : 'added'; step.primitive = pick.id; step.members = [...pick.members];
  return done(pick, null);
}

/**
 * Run the loop steps on a collection until it needs nothing more the steps answer (each need asked once): win, lose,
 * driver, coverage. `commit` adds a pick to the caller's collection (build.js, replan.js) and returns the collection
 * after it, or why it could not (the step is then a gap with that problem). After each step the loop check of the
 * partial collection is recorded on it. `only` limits the kinds; `exclude` maps a kind to ids never offered; `asked`
 * holds the keys of needs asked before (the build's steps after each mechanic: build.js), never asked again.
 * @param {{ registry: RegistryLike, decomposition: Decomposition, collection: StepCollection, ask: Ask, commit: Commit,
 *   mechanic?: { id: string, verb: string, description: string } | null, only?: StepKind[], exclude?: (kind: StepKind) => Iterable<string>, needs?: StepNeed[], asked?: Set<string>, logic?: LogicLike | null, log?: (msg: string) => void }} options
 * @returns {Promise<{ steps: LoopStep[], gaps: Gap[], collection: StepCollection }>}
 */
export async function loopSteps({ registry, decomposition, collection, ask, commit, mechanic = null, only = ['win', 'lose', 'driver', 'coverage'], exclude = () => [], needs: given, asked = new Set(), logic = null, log = () => {} }) {
  const lg = logic || logicOf(registry);
  let c = collection;
  /** @type {LoopStep[]} */
  const steps = [];
  /** @type {Gap[]} */
  const gaps = [];
  for (let guard = 0; guard < MAX_LOOP_STEPS; guard++) {
    const open = (given && !steps.length ? given : loopNeeds(registry, decomposition, c, partialCheck(registry, decomposition, c, { logic: lg })))
      .filter(n => only.includes(n.kind) && !asked.has(n.key));
    const need = open[0];
    if (!need) break;
    asked.add(need.key);
    const r = await askLoopStep({ registry, decomposition, collection: c, need, ask, mechanic, exclude: exclude(need.kind), logic: lg });
    let gap = r.gap;
    if (r.pick) {
      const next = commit(need.kind, r.pick, need.join ?? c.loop);
      if (typeof next === 'string') {
        r.step.asks[r.step.asks.length - 1].ok = false; r.step.asks[r.step.asks.length - 1].problem = next;
        r.step.outcome = 'gap'; r.step.primitive = null;
        gap = { mechanic: gapMechanic(need), description: `${r.pick.id} failed the checks for the ${need.kind} step: ${next}`.slice(0, 400), importance: 'core', kind: need.kind === 'win' ? 'win' : 'no_primitive', why: next.slice(0, 400) };
        log(`loop step ${need.kind}: ${r.pick.id} failed (${next})`);
      } else c = next;
    }
    if (gap) gaps.push(gap);
    const after = partialCheck(registry, decomposition, c, { logic: lg });
    r.step.loop = after.problems.map(p => `${p.code} ${p.primitive}`);
    r.step.collection = [...c.systems];
    steps.push(r.step);
  }
  return { steps, gaps, collection: c };
}

/**
 * Never two wins. The primitives of the collection whose loops declare a game-ending win (card.loop.win / mode.win),
 * the loops a nested mashup enters from the rest left out (they never own the game's win: presets.js loopCore). With
 * two or more, ONE small strict enum question over them, read against the play spec's win sentence, picks the game's
 * win: it owns the game's win (presets.js loopCore orders it first, loop-check.js winOwner) and only it is wired; the
 * others stay in the collection for what else they do and their wins are left unwired (recorded as `unwired`). Asked
 * again only when the set of wins changes (a later pick declares another). -> the decision and its step, or null
 * when the collection declares fewer than two wins or the decided set is unchanged.
 * @param {{ registry: RegistryLike, decomposition: Decomposition, collection: StepCollection, ask: Ask, decided?: WinDecision | null, mechanic?: string | null, logic?: LogicLike | null }} options
 * @returns {Promise<{ decision: WinDecision, step: LoopStep } | null>}
 */
export async function askWins({ registry, decomposition, collection: c, ask, decided = null, mechanic = null, logic = null }) {
  const t0 = performance.now();
  const inner = innerOf(decomposition, /** @type {any} */ ({ mechanics: c.mechanics }));
  const wins = c.systems.filter(id => !inner.has(id) && endsGame(cardLoop(cardOf(registry, id))?.win));
  if (wins.length < 2) return null;
  if (decided && wins.includes(decided.use) && wins.length === decided.offered.length && wins.every(id => decided.offered.includes(id))) return null;
  const sentence = str(decomposition.core?.win);
  const a = await ask({ name: 'pick_game_win', field: 'pick', options: wins,
    system: 'You build a game from composable primitives. A game is won ONE way, and more than one primitive of its collection declares how the game is won. Pick the ONE listed primitive whose win is the win the idea describes. The others stay in the game for what else they do; their wins are not wired.',
    user: `Game idea: ${decomposition.premise}\nPlayed as: ${decomposition.core?.interaction || 'undecided'}\nWon by: ${sentence || '(unspecified)'}\nCollection so far: ${c.systems.join(', ')}\n\nPrimitives that declare a win:\n${wins.map(id => { const card = cardOf(registry, id); return `- ${id}: ${String(card?.intent || '').replace(/\s+/g, ' ').slice(0, 160)} [${declares({ id, ...card }, 'win')}]`; }).join('\n')}` });
  const decision = { use: a.pick, offered: [...wins], why: a.why, unwired: wins.filter(id => id !== a.pick) };
  /** @type {LoopStep} */
  const step = { kind: 'wins', mechanic, need: `${wins.length} primitives declare a game-ending win (${wins.join(', ')}); the game has one: the one "${sentence || decomposition.premise}" describes`.slice(0, 300),
    candidates: wins.map(id => ({ id, score: 0, variant: 0, members: [id], extra: [], adapters: [] })), rejected: [], asks: [{ offered: [...wins], pick: a.pick, why: a.why, ok: true }],
    outcome: 'reused', primitive: a.pick, members: [a.pick], loop: [], collection: [...c.systems], ms: 0 };
  step.loop = partialCheck(registry, decomposition, { ...c, win: a.pick }, { logic: logic || logicOf(registry) }).problems.map(p => `${p.code} ${p.primitive}`);
  step.ms = Math.round(performance.now() - t0);
  return { decision, step };
}

// ---------------------------------------------------------------------------------------------------------------------
// The mashup adapter steps, after the mechanic and loop steps: each core.mashup entry across concepts is realised by the
// registered adapter that declares its relation (card.adapts.relation), added here by code with its configuration read
// from declarations (the preset only configures what these steps chose: presets.js):
//   nested  the outer loop is the core loop mechanic's loop primitives; the inner loop is the joined concept's loop
//           primitive (its concept.loop, else the entry's first joined mechanic), asked for with the loop step (kind
//           'inner') when the collection has none. ONE strict enum question: which declared outer event enters the
//           inner loop. Offered: the events an outer card declares the participants of (card.loop.involves) among its
//           progress and provided events, naming at least as many participants as the inner loop's card.loop.outcome
//           has sides. Code then writes engine.adapt.nested: the trigger and its roles, the inner loop, its start
//           (card.engage.encounter.start), the participants carried into the inner loop's own space when it is bound
//           elsewhere and played by participants (card.loop.needs.participants, card.engage.participants), and the
//           outcomes (card.loop.outcome, presets.js declaredOutcomes).
//   union   each joined loop whose declared spaces (card.loop.space) do not include the chosen space gets a region of the
//           first one it declares, projected by the union adapter's adapt() hook; the loop is bound to the region.
//   skin    the skin adapter, once, when declarations decide it: the joined concept's primitives declare content
//           sections (section contracts) and the concept joined into declares a contract they can fill (presets.js
//           skinSections); its maps come from the composition (presets.js configureSkins). A joined concept with no
//           content (a theme, a setting) needs none (outcome 'none': its theme flows to the content forms); content with
//           no contract to fill is a gap.
// union and skin ask nothing: their declarations decide. After each, the composition check and the loop check of the
// partial collection run (nothing new may break) and the step is recorded; what cannot be derived is a gap. Every entry
// the steps decide is recorded with the instances that realise it (adapters.js MashupRealisation): the collection keeps
// them through every later re-resolution of its adapters (adapters.js keepMashupAdapters), and the pipeline checks the
// published document still has them (adapters.js mashupAdapterProblems).
//
// Integration (build.js, owned elsewhere), after loopSteps:
//     const m = await adapterSteps({ registry, decomposition, collection: collection(), ask, log,
//       commit: (kind, pick, mechanic) => { const t = tryAdd(pick); if (!t.ok) return t.why;
//         const own = mechanic ? mapping[mechanic] : null; if (own && !own.primitives.includes(pick.id)) own.primitives.push(pick.id); return collection(); },
//       adopt: (instances, b) => { stepAdapters.push(...instances); Object.assign(stepBind, b); return collection(); } });
//     steps.push(...m.steps); gaps.push(...m.gaps);
// stepAdapters / stepBind are kept apart from tryAdd's (which replaces `adapters` and `bind` with resolveAdapters' output
// on every pick) and joined into collection() and the BuildResult with adapters.js keepMashupAdapters; the BuildResult
// carries the records (mashupAdapters). Re-planning (replan.js) calls it over a selection (adapterStepsOnSelection).

/** Add adapter instances (with the bindings onto their regions) to the caller's collection: the collection after it, or why not. @typedef {(instances: AdapterInstance[], bind: Record<string, string>) => StepCollection | string} Adopt */

/** An encounter id from the entry's mechanics. @param {string[]} ids */
const encounterSlug = ids => (ids.join('_').toLowerCase().match(/[a-z0-9]+/g) || ['x']).join('_').slice(0, 40);
/** A concept key as play-spec.js groups mechanics (mechanic.from). @param {unknown} from */
const ideaKey = from => (String(from || '').toLowerCase().match(/[a-z0-9]+/g) || []).join('_');
/** The effects an encounter starts a card's loop with (card.engage.encounter.start). @param {any} card @returns {unknown[]} */
function startOf(card) { const s = card?.engage?.encounter?.start; return Array.isArray(s) ? s : []; }
/** Does a card's loop take part through participants (the entities an encounter would carry)? @param {any} card */
const hasParticipants = card => Boolean(cardLoop(card)?.needs.participants || card?.engage?.participants?.param);

/**
 * The joined concept's loop mechanic of a mashup entry: its concept's declared loop (concept.loop) when the entry names
 * it, else the entry's first joined mechanic (the play spec names the joined idea's own loop first). null for an entry
 * within one concept. @param {Decomposition} decomposition @param {import('./play-spec.js').Mashup} entry
 */
export function joinedLoopOf(decomposition, entry) {
  const sides = mashupSides(entry, decomposition.mechanics || []);
  if (!sides.outer.length || !sides.inner.length) return null;
  const from = ideaKey((decomposition.mechanics || []).find(m => m.id === sides.inner[0])?.from);
  const declared = (decomposition.concepts || []).find(x => ideaKey(x.id) === from)?.loop;
  return typeof declared === 'string' && sides.inner.includes(declared) ? declared : sides.inner[0];
}

/** The collection's loop primitives a mechanic maps to. @param {RegistryLike} registry @param {StepCollection} c @param {string | null} mechanic */
const loopsOf = (registry, c, mechanic) => (c.mechanics.find(m => m.id === mechanic)?.primitives || []).filter(id => c.systems.includes(id) && cardLoop(cardOf(registry, id)));

/**
 * The outer events a nested encounter can be entered on: for each outer loop primitive, the events its loop declares
 * the participants of (card.loop.involves) that it provides or counts as progress, naming at least `sides` participants.
 * @param {RegistryLike} registry @param {string[]} outer @param {number} sides
 * @returns {Array<{ event: string, use: string, roles: Record<string, string> }>}
 */
export function nestedTriggers(registry, outer, sides) {
  /** @type {Array<{ event: string, use: string, roles: Record<string, string> }>} */
  const out = [];
  for (const use of outer) {
    const card = cardOf(registry, use), loop = cardLoop(card);
    if (!loop) continue;
    for (const [event, roles] of Object.entries(loop.involves)) {
      const declared = loop.progress.includes(event) || (card?.provides?.events || []).includes(event);
      if (declared && Object.keys(roles).length >= sides && !out.some(t => t.event === event)) out.push({ event, use, roles: { ...roles } });
    }
  }
  return out;
}

/**
 * The composition check and the loop check of the partial collection with adapter instances (and bindings) added:
 * why it breaks something new ('' when nothing), its verdict and the loop problems after it.
 * @param {RegistryLike} registry @param {Decomposition} decomposition @param {StepCollection} c @param {AdapterInstance[]} instances @param {Record<string, string>} bind @param {LogicLike} logic
 */
function adapterChecks(registry, decomposition, c, instances, bind, logic) {
  const of = (/** @type {AdapterInstance[]} */ extra, /** @type {Record<string, string>} */ b) => checkComposition({ spaces: [{ ...c.space }], systems: [...c.systems], bind: { ...c.bind, ...b }, adapters: [...c.adapters, ...extra] }, registry, { resolve: true });
  const before = of([], {}), after = of(instances, bind);
  const had = new Set(before.failures.map(failureKey));
  const fresh = after.failures.filter(f => !had.has(failureKey(f)));
  const known = new Set(partialCheck(registry, decomposition, c, { logic }).problems.map(problemKey));
  const loop = partialCheck(registry, decomposition, { ...c, bind: { ...c.bind, ...bind } }, { adapters: instances, logic }).problems;
  const breaks = loop.filter(p => !known.has(problemKey(p)) && !isDriverCode(p.code));
  const why = fresh.length ? `the composition check fails with it: ${fresh.slice(0, 2).map(f => `[${f.code}] ${f.message}`).join('; ')}`
    : breaks.length ? `the loop check fails with it: ${breaks.slice(0, 2).map(p => `[${p.code}] ${p.message}`).join('; ')}` : '';
  return { why, verdict: after.verdict, loop: loop.map(p => `${p.code} ${p.primitive}`) };
}

/**
 * Run the mashup adapter steps (see above) on a collection: one per core.mashup entry across concepts. `commit` adds an
 * inner loop the loop step picked (joined to the joined concept's loop mechanic); `adopt` adds the adapter instances.
 * -> the steps recorded, the gaps, the adapter instances added, how each entry was realised and the collection after them.
 * @param {{ registry: RegistryLike, decomposition: Decomposition, collection: StepCollection, ask: Ask, commit: Commit, adopt: Adopt, logic?: LogicLike | null, log?: (msg: string) => void }} options
 * @returns {Promise<{ steps: LoopStep[], gaps: Gap[], adapters: AdapterInstance[], realised: MashupRealisation[], collection: StepCollection }>}
 */
export async function adapterSteps({ registry, decomposition, collection, ask, commit, adopt, logic = null, log = () => {} }) {
  const lg = logic || logicOf(registry);
  let c = collection;
  /** @type {LoopStep[]} */
  const steps = [];
  /** @type {Gap[]} */
  const gaps = [];
  /** @type {AdapterInstance[]} */
  const added = [];
  /** @type {MashupRealisation[]} */
  const realised = [];
  for (const entry of decomposition.core?.mashup || []) {
    const sides = mashupSides(entry, decomposition.mechanics || []);
    const relation = entry.relation;
    // An entry within one concept relates nothing (play-spec.js); an unknown relation has no adapter step.
    if (!sides.outer.length || (relation !== 'nested' && relation !== 'union' && relation !== 'skin')) continue;
    const t0 = performance.now();
    const use = adaptersFor(registry, relation)[0] || null;
    const label = `${relation} [${entry.mechanics.join(', ')}]`;
    /** @type {LoopStep} */
    const step = { kind: relation, mechanic: entry.mechanics[0] || null, need: `${label}: ${entry.why || 'the ideas join'}`.slice(0, 300), candidates: [], rejected: [], asks: [], outcome: 'gap', primitive: use, members: [], loop: [], collection: [...c.systems], ms: 0 };
    /** @param {string} why */
    const finish = why => {
      if (why) {
        step.outcome = 'gap';
        gaps.push({ mechanic: entry.mechanics[0] || 'mashup', description: `needs adapter: ${label}`, importance: 'core', kind: 'adapter', why: why.slice(0, 400), signature: `adapter ${use || relation}: ${relation} mashup of ${entry.mechanics.join(', ')}: ${why}`.slice(0, 600) });
        log(`${relation} step: ${why}`);
      }
      step.collection = [...c.systems];
      if (!step.loop.length) step.loop = partialCheck(registry, decomposition, c, { logic: lg }).problems.map(p => `${p.code} ${p.primitive}`);
      step.ms = Math.round(performance.now() - t0);
      steps.push(step);
    };
    /** The entry is realised by these instances ([] when its relation needs none). @param {Array<{ use: string, id?: string }>} instances */
    const realise = instances => { realised.push({ relation, mechanics: [...entry.mechanics], instances: instances.map(i => ({ use: i.use, ...(typeof i.id === 'string' ? { id: i.id } : {}) })) }); };
    /** Check and add instances; '' when added. @param {AdapterInstance[]} instances @param {Record<string, string>} bind */
    const add = (instances, bind) => {
      const checked = adapterChecks(registry, decomposition, c, instances, bind, lg);
      if (checked.why) return checked.why;
      const next = adopt(instances, bind);
      if (typeof next === 'string') return next;
      c = next; added.push(...instances); step.loop = checked.loop; step.outcome = 'added';
      realise(instances);
      return '';
    };
    const taken = new Set([c.space.id, ...instanceIds({ adapters: c.adapters }), ...added.map(a => a.id).filter(/** @returns {x is string} */ x => typeof x === 'string')]);
    if (!use) { finish(`no registered adapter declares the ${relation} relation (card.adapts.relation)`); continue; }
    const innerMechanic = joinedLoopOf(decomposition, entry);

    if (relation === 'skin') {
      const have = c.adapters.find(a => a.use === use);
      if (have || c.systems.includes(use)) { step.outcome = 'reused'; realise([have || { use }]); finish(''); continue; }
      // A skin maps content: only when the joined concept's primitives declare content sections (section contracts) and
      // the core loop declares a contract they can fill (presets.js skinSections). A concept that brings no content (a
      // theme, a setting) has no skin adapter: its theme flows to the content forms. Content with nothing to fill is a gap.
      const joined = sides.inner.flatMap(id => c.mechanics.find(m => m.id === id)?.primitives || []).filter(id => c.systems.includes(id));
      const owners = [...new Set([...(c.mechanics.find(m => m.id === c.loop)?.primitives || []), ...sides.outer.flatMap(id => c.mechanics.find(m => m.id === id)?.primitives || [])])].filter(id => c.systems.includes(id));
      const sections = skinSections(registry, owners, joined);
      step.members = [...joined];
      if (!sections.from.length) { step.outcome = 'none'; realise([]); finish(''); continue; }
      if (!sections.to) { finish(`the joined concept's content (${sections.from.join(', ')}) has no content contract of the core loop (${owners.join(', ') || 'none'}) to fill (card.content)`); continue; }
      const inst = { use, id: uniqueId(adapterInstanceId(registry, { use, space: c.space.id, with: {} }), taken), space: c.space.id, with: {} };
      finish(add([inst], {}));
      continue;
    }

    if (relation === 'union') {
      const inner = loopsOf(registry, c, innerMechanic);
      if (!inner.length) { finish(`the joined loop mechanic ${innerMechanic || '(none)'} maps to no loop primitive of the collection`); continue; }
      const proj = registry.get(use);
      /** @type {AdapterInstance[]} */
      const instances = [];
      /** @type {Record<string, string>} */
      const bind = {};
      let why = '';
      for (const u of inner) {
        const want = (cardLoop(cardOf(registry, u))?.space || []).filter(/** @returns {e is string} */ e => typeof e === 'string' && registry.has(e));
        // Already placed in a region, or the chosen space is one the loop declares: both loops run in one space as they are.
        if (c.bind[u] || !want.length || want.includes(c.space.use)) continue;
        if (typeof proj?.adapt !== 'function') { why = `${use} declares no adapt() hook to project ${want[0]} for ${u}`; break; }
        const missing = { capabilities: [...capsOf(registry, want[0])].filter(x => !c.space.caps.includes(x)), content: [], services: [] };
        const proposal = proj.adapt({ space: { id: c.space.id, use: c.space.use, with: c.space.with || {}, caps: c.space.caps }, missing, neededBy: [{ use: u, card: /** @type {any} */ (cardOf(registry, u)) }], registry });
        if (!proposal) { why = `${use} cannot project ${want[0]} onto ${c.space.use} for ${u}`; break; }
        const w = isObj(proposal.with) ? proposal.with : {};
        const id = uniqueId(typeof proposal.id === 'string' && proposal.id ? proposal.id : adapterInstanceId(registry, { use, space: c.space.id, with: w }), taken);
        instances.push({ use, id, space: c.space.id, with: w });
        bind[u] = id;
      }
      step.members = [...inner];
      if (why) { finish(why); continue; }
      if (!instances.length) { step.outcome = 'reused'; realise([]); finish(''); continue; }
      finish(add(instances, bind));
      continue;
    }

    // nested: the inner loop (asked for with the loop step when missing), then ONE question for the trigger.
    let inner = loopsOf(registry, c, innerMechanic).filter(id => cardLoop(cardOf(registry, id))?.outcome);
    if (!inner.length && innerMechanic) {
      const m = (decomposition.mechanics || []).find(x => x.id === innerMechanic);
      /** @type {StepNeed} */
      const need = { kind: 'inner', key: `inner:${innerMechanic}`, join: innerMechanic, why: `the ${label} mashup enters ${innerMechanic}'s loop from the core loop, and no primitive of the collection mapped to it declares an encounter outcome (card.loop.outcome) and how an encounter starts it (card.engage.encounter)` };
      const r = await askLoopStep({ registry, decomposition, collection: c, need, ask, mechanic: m ? { id: m.id, verb: m.verb, description: m.description } : null, logic: lg });
      if (r.pick) {
        const next = commit('inner', r.pick, innerMechanic);
        if (typeof next === 'string') { r.step.outcome = 'gap'; r.step.primitive = null; r.gap = { mechanic: innerMechanic, description: `${r.pick.id} failed the checks for the inner loop step: ${next}`.slice(0, 400), importance: 'core', kind: 'no_primitive', why: next.slice(0, 400) }; }
        else c = next;
      }
      if (r.gap) gaps.push(r.gap);
      r.step.collection = [...c.systems];
      r.step.loop = partialCheck(registry, decomposition, c, { logic: lg }).problems.map(p => `${p.code} ${p.primitive}`);
      steps.push(r.step);
      inner = loopsOf(registry, c, innerMechanic).filter(id => cardLoop(cardOf(registry, id))?.outcome);
    }
    step.collection = [...c.systems];
    if (!inner.length) { finish(`the joined loop ${innerMechanic || '(none)'} has no primitive that declares an encounter outcome (card.loop.outcome)`); continue; }
    const noStart = inner.filter(u => !startOf(cardOf(registry, u)).length);
    if (noStart.length) { finish(`${noStart.join(', ')} declare${noStart.length === 1 ? 's' : ''} no way an encounter starts ${noStart.length === 1 ? 'its' : 'their'} loop (card.engage.encounter.start)`); continue; }
    const outer = loopsOf(registry, c, c.loop).filter(id => !inner.includes(id));
    const sideCount = Math.max(...inner.map(u => cardLoop(cardOf(registry, u))?.outcome?.sides.length || 1));
    const triggers = nestedTriggers(registry, outer, sideCount);
    step.members = [...inner];
    if (!triggers.length) { finish(`the outer loop (${outer.join(', ') || 'none'}) declares no event naming ${sideCount} participant${sideCount === 1 ? '' : 's'} (card.loop.involves) to enter ${inner.join(', ')} on`); continue; }
    const offered = triggers.map(t => t.event);
    const a = await ask({ name: 'pick_nested_trigger', field: 'pick', options: [...offered, 'none'],
      system: 'You join two game loops: an event of the outer loop starts the inner loop as an encounter between the participants that event names, and the encounter\'s result comes back to the outer loop (a defeated participant leaves play). Pick the ONE listed outer event that should start the inner loop as the idea describes, or "none" when none of them does.',
      user: `Game idea: ${decomposition.premise}\nHow the ideas join (nested): ${entry.why || entry.mechanics.join(', ')}\nOuter loop: ${outer.join(', ')}\nInner loop: ${inner.map(u => `${u} [${declares({ id: u, ...cardOf(registry, u) }, 'inner')}]`).join('; ')}\n\nOuter events:\n${triggers.map(t => `- ${t.event} (${t.use}): names the ${Object.keys(t.roles).join(' and the ')}`).join('\n')}` });
    step.asks.push({ offered, pick: a.pick, why: a.why, ok: a.pick !== 'none' });
    if (a.pick === 'none') { finish(a.why || 'none of the outer events starts the inner loop as the idea describes'); continue; }
    const trigger = /** @type {{ event: string, use: string, roles: Record<string, string> }} */ (triggers.find(t => t.event === a.pick));
    const id = encounterSlug(entry.mechanics);
    const { outcomes } = declaredOutcomes(registry, { id, inner });
    const start = inner.flatMap(u => structuredClone(startOf(cardOf(registry, u))));
    // Participants are carried only into an inner loop bound to a space of its own and played by participants.
    const outerSpace = c.bind[trigger.use] ?? c.space.id;
    const innerSpace = inner.map(u => c.bind[u]).find(s => typeof s === 'string' && s !== outerSpace);
    const carry = innerSpace && inner.some(u => hasParticipants(cardOf(registry, u))) ? Object.keys(trigger.roles).map(role => ({ role })) : [];
    /** @type {Record<string, any>} */
    const w = { id, on: trigger.event, roles: trigger.roles, inner: [...inner], start, outcomes, ...(carry.length ? { space: innerSpace, carry } : {}) };
    const inst = { use, id: uniqueId(adapterInstanceId(registry, { use, with: w }, c.space.id), taken), with: w };
    finish(add([inst], {}));
  }
  return { steps, gaps, adapters: added, realised, collection: c };
}

/**
 * The mashup adapter steps over a select.js selection (re-planning, and a selection built before these steps existed):
 * an inner loop pick joins sel.systems and the joined loop mechanic; the adapter instances join sel.adapters and their
 * bindings sel.bind. Mutates `sel`. -> adapterSteps' result.
 * @param {{ registry: RegistryLike, decomposition: Decomposition, selection: import('./select.js').Selection, ask: Ask, logic?: LogicLike | null, log?: (msg: string) => void }} options
 */
export async function adapterStepsOnSelection({ registry, decomposition, selection: sel, ask, logic = null, log = () => {} }) {
  const loop = typeof decomposition.core?.loop === 'string' && sel.mechanics.some(m => m.id === decomposition.core?.loop) ? decomposition.core.loop : null;
  /** The instances adopted so far realise the relation being decided: they are kept like the recorded ones. @type {AdapterInstance[]} */
  const own = [];
  const collection = () => selectionCollection(registry, sel, loop);
  const r = await adapterSteps({ registry, decomposition, collection: collection(), ask, logic, log,
    commit: (kind, pick, mechanic) => {
      for (const id of pick.members) if (!sel.systems.includes(id)) sel.systems.push(id);
      if (pick.adapters.length) {
        const pending = [...(sel.mashupAdapters || []), { relation: kind, mechanics: [], instances: own.map(a => ({ use: a.use, ...(a.id ? { id: a.id } : {}) })) }];
        const kept = keepMashupAdapters(resolveAdapters({ spaces: sel.spaces, systems: sel.systems }, registry), { adapters: sel.adapters, bind: sel.bind, mashupAdapters: pending });
        const spaces = new Set(sel.spaces.map(s => s.id));
        sel.adapters = kept.adapters; sel.bind = { ...Object.fromEntries(Object.entries(sel.bind).filter(([, to]) => spaces.has(to))), ...kept.bind };
      }
      const m = sel.mechanics.find(x => x.id === mechanic);
      if (m && !m.primitives.includes(pick.id)) m.primitives = [...m.primitives, pick.id];
      return collection();
    },
    adopt: (instances, bind) => { own.push(...instances); sel.adapters = [...(sel.adapters || []), ...instances]; Object.assign(sel.bind, bind); return collection(); } });
  sel.mashupAdapters = [...(sel.mashupAdapters || []).filter(x => !r.realised.some(y => y.relation === x.relation && y.mechanics.join('\n') === x.mechanics.join('\n'))), ...r.realised];
  return r;
}
