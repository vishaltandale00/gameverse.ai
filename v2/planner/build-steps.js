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
//             (loop_win_unaffected, loop_component_unowned); at re-planning (a gate verdict: no_progress, loop_absent)
//             the win's reads themselves, when the static check found nothing.
// Each step is ONE small strict enum question: the candidates are catalogue cards whose declarations answer that need
// (a declared win or lose, card.drives serving those participants and that loop, verbs or effects that change the
// win's reads), played the play spec's way, each as a single card or a minimal bundle (bundles.js formBundle) that
// composes with the collection (compose-check) on its space or through a registered adapter, and that passes the loop
// check of the partial collection with it (its need met, nothing new broken); ranked by their declarations against the
// core loop mechanic and the spec's sentence; at most MAX_CANDIDATES. The model picks one id or "none". "none", or no
// candidate, is a gap for the gap layer (the primitive or adapter signature); nothing is added silently.
// Nothing here names a primitive, a genre or a game: everything is read from card declarations.
import { isSpace, isGenerator, isGraphics } from './catalog.js';
import { checkComposition } from './compose-check.js';
import { resolveAdapters } from './adapters.js';
import { cardLoop, endsGame, composeLoop } from './loop.js';
import { readsOf, drivesOf, drivesOwn, drivesLoop, drivesBy, ownersOf, logicOf, LOOP_CODES } from './loop-check.js';
import { preset, coreOf } from './presets.js';
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
/** @typedef {import('./select.js').Gap} Gap */
/** @typedef {import('./loop-check.js').LoopProblem} LoopProblem */
/** @typedef {import('./bundles.js').Composes} Composes */
/** @typedef {'win' | 'lose' | 'driver' | 'coverage'} StepKind */
/** A mechanic as the preset reads it (its core and loops come from the core mechanics' primitives). @typedef {{ id: string, importance: string, primitives: string[] }} StepMechanic */
/**
 * The collection a step reads: its space (the configuration it composes on), systems, adapter instances and bindings,
 * what each mechanic maps to and the core loop mechanic's id (where the win, lose and coverage picks go), and the
 * composition checks bound to it (build.js composes / resolveWith; replan.js the same over a selection).
 * @typedef {{ space: { id: string, use: string, with: Record<string, unknown>, role?: string, caps: string[] }, systems: string[], adapters: AdapterInstance[], bind: Record<string, string>,
 *   mechanics: StepMechanic[], loop: string | null,
 *   composes: (ids: string[]) => Composes, resolve: (ids: string[], variant: number) => { adapters: AdapterInstance[], bind: Record<string, string>, gaps: AdapterSpec[] } }} StepCollection
 */
/** What a step answers: its kind, a stable key, why it is needed, and the loop problem it answers (driver, coverage). @typedef {{ kind: StepKind, key: string, why: string, problem?: LoopProblem }} StepNeed */
/** A candidate a step offers (build.js BuildCandidate without covers). @typedef {{ id: string, score: number, variant: number, members: string[], extra: import('./bundles.js').Companion[], adapters: import('./bundles.js').BundleAdapter[] }} StepCandidate */
/**
 * One loop step as selection.build.steps records it: the need, the candidates offered (and rejected, with why), the
 * question and its answer, what was added, the gap when none fits, and the loop check of the partial collection after it.
 * @typedef {{ kind: StepKind, mechanic: string | null, need: string, candidates: StepCandidate[], rejected: Array<{ id: string, why: string }>,
 *   asks: Array<{ offered: string[], pick: string, why: string, ok: boolean, problem?: string }>, outcome: 'added' | 'reused' | 'gap', primitive: string | null,
 *   members: string[], loop: string[], collection: string[], ms: number }} LoopStep
 */
/** One strict enum question (makeAsk). @typedef {(q: { name: string, system: string, user: string, field: string, options: string[], extra?: Record<string, Record<string, unknown>> }) => Promise<{ pick: string, why: string, reply: Record<string, unknown> }>} Ask */

export const STEPS_VERSION = 'build-steps/0.1';
export const MAX_CANDIDATES = 8;
// The loop codes a driver answers, and those the coverage step answers.
/** @param {string} code (read at call time: loop-check.js and this module import each other through presets.js) */
const isDriverCode = code => code === LOOP_CODES.inert || code === LOOP_CODES.loseUnaffected;
/** @param {string} code */
const isCoverCode = code => code === LOOP_CODES.unaffected || code === LOOP_CODES.owner;
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
    mechanics: (sel.mechanics || []).map(m => ({ id: m.id, importance: m.importance, primitives: [...(m.primitives || [])] })), loop,
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

/** The mechanics with `ids` joined to the core loop mechanic (as a win, lose or coverage pick joins it). @param {StepCollection} c @param {string[]} ids @returns {StepMechanic[]} */
const joinLoop = (c, ids) => c.mechanics.map(m => (m.id === c.loop ? { ...m, primitives: [...m.primitives, ...ids.filter(id => !m.primitives.includes(id))] } : m));
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
    mechanics: mechanics.map(m => ({ ...m, primitives: [...m.primitives] })) };
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
  for (const p of check.problems) if (isCoverCode(p.code)) out.push({ kind: 'coverage', key: `coverage:${problemKey(p)}`, why: p.message, problem: p });
  return out;
}

/** The text of what a loop end reads. @param {import('./loop-check.js').LoopReads | null} r */
const readsText = r => (!r ? 'nothing declared' : r.component ? `the ${r.of || 'opponents'}' "${r.component}"` : r.event ? `the event "${r.event}"` : `the var "${r.var}"`);
/** @param {import('./loop.js').ReadsBy | undefined} by */
const byText = by => (by ? [by.actions?.length && `actions ${by.actions.join('/')}`, by.effects?.length && `effects ${by.effects.join('/')}`, by.events?.length && `events ${by.events.join('/')}`, by.movement && 'movement'].filter(Boolean).join(', ') : '') || 'nothing declared';

/**
 * Cards whose declarations answer a need (before the composition and loop checks): a game-ending win or lose; a
 * driver with the need's control serving those participants and that loop (it names the loop or steers by its target
 * service, or acts by a component the preset puts on them) whose behaviour changes what the lose reads; or, for the
 * coverage of what the win reads, its owner, a primitive with player verbs that requires it, a provider of the event
 * or var it counts, the owner of an effect or the provider of an action its reads.by names.
 * @param {RegistryLike} registry @param {LogicLike} logic @param {StepNeed} need @param {{ reads: import('./loop-check.js').LoopReads | null }} context @returns {(card: any) => boolean}
 */
function answers(registry, logic, need, { reads }) {
  if (need.kind === 'win') return card => endsGame(cardLoop(card)?.win);
  if (need.kind === 'lose') return card => endsGame(cardLoop(card)?.lose);
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
    return (by?.actions || []).some(a => (card.provides?.actions || []).includes(a));
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
    : need.kind === 'driver' ? `opponent: a primitive that declares card.drives { control: '${n?.control || 'ai'}' } for ${n?.loop ? `the ${n.loop} AI participants` : "the play spec's opponent"}${n?.by ? `, whose entities change what the lose reads (${byText(n.by)})` : ''}, ${on}`
    : `loop: a primitive whose player verbs or effects change what the ${owner || 'core loop'} win reads (${readsText(owner ? readsOf(cardLoop(cardOf(registry, owner))?.win) : null)}), ${on}`;
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
  if (kind === 'win' || kind === 'lose') { const end = loop?.[kind]; return end ? `${kind} reads ${readsText(readsOf(end))}${end.reads?.by ? ` (changed by ${byText(end.reads.by)})` : ''}` : ''; }
  if (kind === 'driver') { const d = drivesOf(card); return d ? `drives ${d.loops.length ? `loops ${d.loops.join('/')}` : d.components.length ? `entities with ${d.components.join('/')}` : d.targets ? 'participants by their target service' : 'its own participants'}${d.effects.length || d.actions.length ? `; they ${[...d.actions, ...d.effects].join('/')}` : ''}${d.movement ? '; they move' : ''}` : ''; }
  return loop?.verbs.length ? `verbs: ${loop.verbs.join(', ')}` : '';
}

/**
 * Ask ONE loop step (see the header): the candidates that answer `need`, compose and pass the loop check of the
 * partial collection with them, ranked by declarations; the model picks one or "none". `exclude`: ids never offered
 * (tried before). -> the step record, the pick (null: a gap) and the gap.
 * @param {{ registry: RegistryLike, decomposition: Decomposition, collection: StepCollection, need: StepNeed, ask: Ask, mechanic?: { id: string, verb: string, description: string } | null,
 *   exclude?: Iterable<string>, logic?: LogicLike | null }} options
 * @returns {Promise<{ step: LoopStep, pick: StepCandidate | null, gap: Gap | null }>}
 */
export async function askLoopStep({ registry, decomposition, collection: c, need, ask, mechanic = null, exclude = [], logic = null }) {
  const t0 = performance.now();
  const lg = logic || logicOf(registry);
  const interaction = decomposition.core?.interaction || null;
  const skip = new Set(exclude);
  const before = partialCheck(registry, decomposition, c, { logic: lg });
  const had = new Set(before.problems.map(problemKey));
  const ownerReads = before.owner ? readsOf(cardLoop(cardOf(registry, before.owner))?.win) : null;
  const fits = answers(registry, lg, need, { reads: ownerReads });
  const sentence = need.kind === 'win' || need.kind === 'lose' ? str(decomposition.core?.[need.kind]) : need.kind === 'driver' ? [decomposition.core?.opponent, decomposition.core?.lose].filter(Boolean).join('. ') : str(decomposition.core?.win);
  // The pool: gameplay and plot cards (no space, generator, graphics or adapter) that answer the need and are played the
  // play spec's way: none whose loop is declared for another interaction and ends the game (another game). A member of
  // the collection may answer a win or lose (it joins the core loop); a driver or coverage need it left open, it cannot.
  const pool = registry.cards().filter(card => {
    if (!/^(gameplay|plot)\./.test(card.id) || isSpace(card.id) || isGenerator(card.id) || isGraphics(card.id) || card.adapts || skip.has(card.id)) return false;
    if ((need.kind === 'driver' || need.kind === 'coverage') && c.systems.includes(card.id)) return false;
    if (!servesInteraction(card, interaction)) return false;
    const loop = cardLoop(card);
    if (interaction && loop?.interaction && loop.interaction !== interaction && (endsGame(loop.win) || endsGame(loop.lose))) return false;
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
  const mechanicsWith = (/** @type {string} */ id) => (need.kind === 'driver' ? c.mechanics : joinLoop(c, [id]));
  for (const { card, rank } of pool) {
    if (candidates.length >= MAX_CANDIDATES) break;
    const b = formBundle({ registry, seed: card.id, systems: c.systems, space: c.space.use, adapters: c.adapters, composes: c.composes, resolve: c.resolve });
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
    const gap = { mechanic: need.kind === 'win' ? 'win' : need.kind === 'lose' ? 'lose' : need.kind === 'driver' ? 'opponent' : 'loop', description: `${need.problem ? `[${need.problem.code}] ` : ''}${adapter ? `needs adapter: ${signature}` : signature}`,
      importance: 'core', kind: adapter ? 'adapter' : need.kind === 'win' ? 'win' : 'no_primitive', why: why.slice(0, 400), signature, ...(adapter ? { adapter, verdict: 'incompatible-needs-adapter' } : {}) };
    return gap;
  };
  if (!candidates.length) return done(null, gapOf(`no catalogue primitive answers it, composes with the collection and passes the loop check${rejected.length ? ` (${rejected.slice(0, 2).map(x => `${x.id}: ${x.why}`).join('; ')})` : ''}`));
  const offered = candidates.map(x => x.id);
  const what = need.kind === 'win' ? 'how the game is WON: a primitive that declares the game-ending win the idea describes'
    : need.kind === 'lose' ? 'how the game is LOST: a primitive that declares the game-ending lose the idea describes'
    : need.kind === 'driver' ? 'what makes the AI-controlled opponents act: a primitive that drives them'
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
 * partial collection is recorded on it. `only` limits the kinds; `exclude` maps a kind to ids never offered.
 * @param {{ registry: RegistryLike, decomposition: Decomposition, collection: StepCollection, ask: Ask, commit: (kind: StepKind, pick: StepCandidate) => StepCollection | string,
 *   mechanic?: { id: string, verb: string, description: string } | null, only?: StepKind[], exclude?: (kind: StepKind) => Iterable<string>, needs?: StepNeed[], logic?: LogicLike | null, log?: (msg: string) => void }} options
 * @returns {Promise<{ steps: LoopStep[], gaps: Gap[], collection: StepCollection }>}
 */
export async function loopSteps({ registry, decomposition, collection, ask, commit, mechanic = null, only = ['win', 'lose', 'driver', 'coverage'], exclude = () => [], needs: given, logic = null, log = () => {} }) {
  const lg = logic || logicOf(registry);
  let c = collection;
  /** @type {LoopStep[]} */
  const steps = [];
  /** @type {Gap[]} */
  const gaps = [];
  /** @type {Set<string>} */
  const asked = new Set();
  for (let guard = 0; guard < 4 * MAX_CANDIDATES; guard++) {
    const open = (given && !steps.length ? given : loopNeeds(registry, decomposition, c, partialCheck(registry, decomposition, c, { logic: lg })))
      .filter(n => only.includes(n.kind) && !asked.has(n.key));
    const need = open[0];
    if (!need) break;
    asked.add(need.key);
    const r = await askLoopStep({ registry, decomposition, collection: c, need, ask, mechanic, exclude: exclude(need.kind), logic: lg });
    let gap = r.gap;
    if (r.pick) {
      const next = commit(need.kind, r.pick);
      if (typeof next === 'string') {
        r.step.asks[r.step.asks.length - 1].ok = false; r.step.asks[r.step.asks.length - 1].problem = next;
        r.step.outcome = 'gap'; r.step.primitive = null;
        gap = { mechanic: need.kind === 'win' ? 'win' : need.kind === 'lose' ? 'lose' : need.kind === 'driver' ? 'opponent' : 'loop', description: `${r.pick.id} failed the checks for the ${need.kind} step: ${next}`.slice(0, 400), importance: 'core', kind: need.kind === 'win' ? 'win' : 'no_primitive', why: next.slice(0, 400) };
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
