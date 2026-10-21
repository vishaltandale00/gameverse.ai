// @ts-check
// Iterative build of the primitive collection (ARCHITECTURE.md §5 selection): the game is a collection of primitives,
// grown one mechanic at a time with the static checks after every step, never mapped in one shot.
//
//   1. The primary space is chosen first, from the play spec's interaction and views: the space cards that fit (loops
//      declared for the interaction name them, card.views shows the idea's views) are offered as an enum; one that
//      fits alone is taken without a question. It is never swapped later: a pick that needs what it lacks comes with an
//      adapter, or is not offered. Only its configuration (spaceVariants) may change, when the whole collection still
//      composes on it.
//   2. A worklist of mechanics: the core loop mechanic named by the play spec (core.loop), the other concepts' loop
//      mechanics (concept.loop), the other core mechanics, then supporting and flavour ones. For each (retrieval.js):
//      - coverage first: a primitive already in the collection of the mechanic's own concept (mechanic.from), its loop
//        primitive first, may cover it by its declarations (the content sections it needs or reads, its loop verbs,
//        progress events, the effects it owns, as the mechanic's verb names them): covered with the reason, no
//        question; a weaker declared match is one small yes/no-with-enum question (covered_by);
//      - otherwise EVERY valid option: each card whose declared loop serves the mechanic's interaction context (for a
//        joined concept, its own loop's interaction), as a single card or the smallest BUNDLE (bundles.js formBundle)
//        that is valid: no new failure or type hole in checkComposition (resolve:true) on the adapter instances
//        resolveAdapters gives it (ids, configuration, bindings), and no new capability, service, requirement or
//        conflict error from preflight on the partial document. The list is in declaration order (retrieval.js
//        declarationOrder: cards whose loop declares the mechanic's verb first, then the catalogue's order); nothing
//        cuts it and nothing ranks it by text;
//      - ONE small strict question: pick one option id (enum: id, one-line intent, bundle members) or "none" with a
//        reason; over MAX_LIST options, a category question (id namespaces) comes first;
//      - the pick is added with its bundle, the whole collection is checked again and its adapters resolved; the
//        members' content contracts are recorded;
//      - when the model says none the mechanic is a gap with the primitive signature (adapter signatures come from
//        the options that were not valid only because an adapter is missing);
//      - after EVERY mechanic step, before the next: never two wins (build-steps.js askWins: when the collection now
//        declares more than one game-ending win, one small enum question picks the one the play spec's win sentence
//        describes; the others are left unwired, recorded), then the loop check of the partial collection
//        (build-steps.js partialCheck): every wired end (the game's win, the core loops' loses) whose reads no player
//        verb or effect of the collection can change (loop_win_unaffected, loop_component_unowned,
//        loop_lose_unproduced) gets the coverage step for that primitive and its mechanic: the candidates are that
//        mechanic's valid options (retrieval.js validOptions) whose declarations change the reads, the model picks one
//        or "none" (a gap), and the pick joins that mechanic. A coverage gap a later step resolved is marked settled.
//        The core loop mechanic's own ends are left to the loop steps (3.), once the other mechanics built its loop.
//        The check's problems are recorded on the mechanic step (loop).
//   3. The loop steps (build-steps.js), after the mechanic steps: the win (when nothing in the collection declares one
//      that can be wired), the lose (when the play spec has one and no core loop declares it), the drivers of AI
//      opponents (loop_opponent_inert) and the coverage of what the win reads (loop_win_unaffected), each a small strict
//      enum question over checked candidates, with the loop check of the partial collection after it. The preset never
//      picks these itself.
//   Every step is logged (mechanic, candidates, asks, checks, outcome) in the selection report.
//
// Nothing here names a primitive, a genre or a game: everything is read from card declarations.
import { documentedBy } from './compose-check.js';
import { spaceVariants, requirementsOf, satisfying, isSpace, dataShapes } from './catalog.js';
import { contractsOf } from './content.js';
import { cardLoop } from './loop.js';
import { isAvatar, unplayedLoops } from './play-spec.js';
import { spaceSlug } from './select.js';
import { unfurnishable } from './world.js';
import { makeAsk, loopSteps, adapterSteps, askWins, askLoopStep, partialCheck, loopNeeds } from './build-steps.js';
import { keepMashupAdapters } from './adapters.js';
import { collectionChecks, collectionState, coverageOf, askCoverage, validOptions, pickOption, declaresVerb, MAX_LIST } from './retrieval.js';
import { isStr, prop } from '../kernel/guards.js';

/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** @typedef {import('../kernel/types.js').Card} Card */
/** @typedef {import('./types.js').Writer} Writer */
/** @typedef {import('./decompose.js').Decomposition} Decomposition */
/** @typedef {import('./decompose.js').Mechanic} Mechanic */
/** @typedef {import('./compose-check.js').AdapterInstance} AdapterInstance */
/** @typedef {import('./select.js').SpaceChoice} SpaceChoice */
/** @typedef {import('./select.js').Gap} Gap */
/** An option offered for a mechanic (retrieval.js Option): seed id, ordering score, configuration, members, companions, adapters. @typedef {import('./retrieval.js').Option} BuildCandidate */
/** One model question and what came of it; `question` names a category or coverage question (else the pick). @typedef {{ offered: string[], pick: string, why: string, ok: boolean, problem?: string, question?: string }} BuildAsk */
/**
 * The checks run after a pick: the primitives its bundle brought beyond the pick (closure), the whole bundle, the
 * whole-collection verdict, the adapters resolved and the content contracts recorded.
 * @typedef {{ closure: string[], bundle: string[], compose: string, adapters: string[], contracts: string[], variant: Record<string, unknown> }} BuildChecks
 */
/**
 * One worklist step: every valid option offered (candidates) and the cards that serve its interaction context but are
 * not valid (rejected, with why). A mechanic covered by a primitive already in the collection has outcome 'covered',
 * names the step that brought that primitive (coveredBy) and why (coverage: by declarations, or asked); that step lists
 * the mechanics it covers (covers).
 * @typedef {{ kind: 'mechanic', mechanic: string, importance: string, candidates: BuildCandidate[], rejected: Array<{ id: string, why: string }>, asks: BuildAsk[],
 *   checks: BuildChecks | null, outcome: 'added' | 'reused' | 'gap' | 'covered', primitive: string | null, collection: string[], ms: number,
 *   covers?: string[], coveredBy?: string, coverage?: { by: string, why: string, asked: boolean }, context?: string | null, loop?: string[] }} BuildStep
 */
/** The space step. @typedef {{ candidates: Array<{ use: string, score: number }>, asked: boolean, pick: string, why: string }} SpaceStep */
/**
 * buildSelection()'s result: what each mechanic maps to, the space, the collection (picks and their closures), adapter
 * instances and bindings, how each mashup entry was realised (mashupAdapters), the game's win when several were
 * declared (win), gaps, the recorded content contracts and the step log.
 * @typedef {{ version: string, loop: string | null, space: SpaceChoice, spaceStep: SpaceStep, win: import('./build-steps.js').WinDecision | null, mapping: Record<string, { primitives: string[], candidates: Array<{ id: string, score: number }>, why: string }>,
 *   systems: string[], adapters: AdapterInstance[], bind: Record<string, string>, mashupAdapters: import('./adapters.js').MashupRealisation[], gaps: Gap[], contracts: string[], steps: Array<BuildStep | import('./build-steps.js').LoopStep>, calls: number, ms: number }} BuildResult
 */

export const BUILD_VERSION = 'build/0.4';
/**
 * Loop-check needs a pick's own declarations must answer (loop-check.js LoopNeed kinds): its participants, the player's
 * seat, an opponent, a group to seat, the component its win reads. No later step adds them, so a pick that lacks one is
 * dropped from its step and the step asked again without it.
 */
export const OWN_NEEDS = new Set(['participants', 'seat', 'opponent', 'group', 'component']);
/** Options are never cut (over MAX_LIST a category question comes first). */
export { MAX_LIST };

/** @param {RegistryLike} registry @param {string} id @returns {Card | null} */
const cardOf = (registry, id) => registry.get(id)?.card ?? null;

/**
 * The core loop mechanic the play spec names: core.loop when it is a mechanic id, else the primary idea's first core
 * mechanic (one no mashup relation joins), else the first core mechanic; null without one.
 * @param {{ mechanics: Mechanic[], core?: { mashup?: Array<{ mechanics: string[] }>, [k: string]: unknown } | null }} decomposition
 * @returns {string | null}
 */
export function loopMechanicOf(decomposition) {
  const named = prop(decomposition.core, 'loop');
  // The play spec names it (decompose.js asks again until it does); a spec that names none has no loop, never a guessed one.
  return isStr(named) && decomposition.mechanics.some(m => m.id === named) ? named : null;
}

/**
 * The worklist: the core loop mechanic, the other concepts' loop mechanics (concept.loop: a concept's other mechanics
 * are covered by, or played in, its loop), the other core mechanics, then supporting, then flavour (each in the idea's
 * order). A concept's loop the idea does not play (a skin relation marked it flavor: play-spec.js unplayedLoops) is never built.
 * @param {{ mechanics: Mechanic[], concepts?: Array<{ loop?: string }>, core?: { mashup?: Array<{ mechanics: string[] }>, [k: string]: unknown } | null }} decomposition @returns {Mechanic[]}
 */
export function worklist(decomposition) {
  const loop = loopMechanicOf(decomposition);
  const unplayed = unplayedLoops(decomposition);
  const loops = new Set((decomposition.concepts || []).map(c => c.loop).filter(isStr));
  const rank = (/** @type {Mechanic} */ m) => (m.id === loop ? 0 : loops.has(m.id) ? 1 : m.importance === 'core' ? 2 : m.importance === 'supporting' ? 3 : 4);
  return decomposition.mechanics.filter(m => !unplayed.has(m.id)).map((m, i) => ({ m, i })).sort((a, b) => rank(a.m) - rank(b.m) || a.i - b.i).map(x => x.m);
}

/** Does a space variant satisfy a loop's declared space entry (a space id, a capability, or a capability list)? @param {RegistryLike} registry @param {string | string[]} entry @param {string} use @param {Set<string>} caps */
const entryFits = (registry, entry, use, caps) => (Array.isArray(entry) ? entry.every(c => caps.has(c)) : registry.has(entry) ? entry === use : caps.has(entry));

/**
 * The space cards that fit the play spec, every one (nothing is cut): card.views shows one of the idea's views
 * (or 'any'), and, when loops are declared for the play spec's interaction, one of their declared spaces (an id, or the
 * capabilities a configuration of the space provides). An avatar interaction needs a space some registered generator
 * can furnish. Ordered by the declarations alone: named by a loop for the interaction, the primary view, the views it
 * shows, then the catalogue's order.
 * @param {RegistryLike} registry @param {Decomposition} decomposition @param {string[]} [exclude]
 * @returns {Array<{ use: string, score: number, why: string }>}
 */
export function spaceCandidates(registry, decomposition, exclude = []) {
  const interaction = decomposition.core?.interaction || null;
  const views = (decomposition.views || []).filter(v => v !== 'ui' || decomposition.views.length === 1);
  const primary = views[0] || null;
  // Declared spaces (ids) that are not registered here name nothing to build on; capabilities stay.
  const declared = interaction ? registry.ids().map(id => cardLoop(cardOf(registry, id))).filter(l => l && l.interactions.includes(interaction)).flatMap(l => l?.space || []).filter(e => !(isStr(e) && isSpace(e) && !registry.has(e))) : [];
  /** @type {Array<{ use: string, score: number, why: string }>} */
  const out = [];
  for (const use of registry.ids('engine').filter(id => isSpace(id) && !exclude.includes(id))) {
    const card = cardOf(registry, use); if (!card) continue;
    const own = card.views || [];
    if (views.length && !own.includes('any') && !views.some(v => own.includes(v))) continue;
    const variants = spaceVariants(registry, use);
    const byId = declared.some(e => e === use);
    const byCaps = declared.some(e => !(isStr(e) && registry.has(e)) && variants.some(v => entryFits(registry, e, use, v.caps)));
    if (declared.length && !byId && !byCaps) continue;
    if (isAvatar(interaction) && unfurnishable(registry, use).length) continue;
    const score = (byId ? 6 : byCaps ? 3 : 0) + (primary && own.includes(primary) ? 4 : 0) + views.filter(v => own.includes(v)).length;
    out.push({ use, score, why: [byId ? `named by a loop played as ${interaction}` : byCaps ? `provides what loops played as ${interaction} declare` : '', views.length ? `shows ${views.filter(v => own.includes(v)).join(', ') || 'any view'}` : ''].filter(Boolean).join('; ') });
  }
  // Stable: equal scores keep the catalogue's order.
  return out.sort((a, b) => b.score - a.score);
}

/**
 * The requirements closure of one card: the registered primitives its card requires (card.requires.primitives), and
 * theirs, that `have` does not already satisfy. @param {RegistryLike} registry @param {string} id @param {Iterable<string>} have @returns {string[]}
 */
export function closureOf(registry, id, have) {
  const got = new Set(have);
  /** @type {string[]} */
  const added = [];
  const visit = (/** @type {string} */ x) => {
    for (const req of requirementsOf(registry, x).primitives) {
      if ([...got].some(g => g === req || g.startsWith(req + '.'))) continue;
      const s = satisfying(registry, req, [...got]);
      if (!s) continue;
      got.add(s); added.push(s); visit(s);
    }
  };
  visit(id);
  return added;
}

/** Conflicts inside a collection (card.conflicts), as problem lines. @param {RegistryLike} registry @param {string[]} ids */
const conflictsIn = (registry, ids) => ids.flatMap(id => (cardOf(registry, id)?.conflicts || []).filter(c => c !== id && ids.includes(c)).map(c => `'${id}' conflicts with '${c}' (card.conflicts)`));

/**
 * The primitive signature the gap layer writes when no catalogue primitive fits a mechanic.
 * @param {Mechanic} m @param {string | null} interaction @param {SpaceChoice} space @param {string} [spec]
 */
const primitiveSignature = (m, interaction, space, spec = '') => `${m.id}: a primitive whose loop (card.loop) ${interaction ? `is played as ${interaction}, ` : ''}with verbs and progress events for "${m.description}", on ${space.use} (${space.caps.join(', ')})${spec ? `. Spec: ${spec}` : ''}`.slice(0, 600);

/**
 * Grow the collection mechanic by mechanic (see the header). A writer is required: without one selection is the offline
 * mode (select.js). A reply that is not one of the offered ids is asked again up to `attempts` times; then selection
 * fails (status 422, code selection_failed): nothing stands in for the model.
 * deadline: the step path's time box (a performance.now() value): a question asked after it fails the build (422
 * step_path_timeout, build-steps.js makeAsk) naming the step it stopped at.
 * @param {{ decomposition: Decomposition, registry: RegistryLike, writer: Writer, log?: (msg: string) => void, excludeSpaces?: string[], attempts?: number, deadline?: number | null }} options
 * @returns {Promise<BuildResult>}
 */
export async function buildSelection({ decomposition, registry, writer, log = () => {}, excludeSpaces = [], attempts = 2, deadline = null }) {
  const started = performance.now();
  const interaction = decomposition.core?.interaction || null;
  const documented = documentedBy(dataShapes);
  let calls = 0;
  const premise = `Game idea: ${decomposition.premise}\nPlayed as: ${interaction || 'undecided'}; opponent: ${decomposition.core?.opponent || 'none'}${decomposition.core?.win ? `; won by: ${decomposition.core.win}` : ''}`;
  // One strict enum question; a reply outside the enum is asked again (attempts), then selection fails.
  const ask = makeAsk({ writer, attempts, log, count: () => { calls++; }, deadline });

  // 1. The primary space, before the first mechanic.
  const offeredSpaces = spaceCandidates(registry, decomposition, excludeSpaces);
  if (!offeredSpaces.length) throw Object.assign(Error(`No registered space fits the play spec: played as ${interaction || 'undecided'}, views ${(decomposition.views || []).join(', ') || 'none'}${excludeSpaces.length ? ` (excluded: ${excludeSpaces.join(', ')})` : ''}. A space primitive (card.views, and a loop for that interaction declaring it in card.loop.space) is missing.`), { status: 422, code: 'no_space_fits' });
  /** @type {SpaceStep} */
  let spaceStep;
  if (offeredSpaces.length === 1) spaceStep = { candidates: offeredSpaces.map(({ use, score }) => ({ use, score })), asked: false, pick: offeredSpaces[0].use, why: offeredSpaces[0].why || 'the only space that fits' };
  else {
    const a = await ask({ name: 'pick_space', field: 'space', options: offeredSpaces.map(s => s.use),
      system: 'You choose the world a game is played in, from composable space primitives. Pick the ONE listed space the idea is played in (its primary view and how it is played). Other mechanics are fitted to it later, through adapters when needed: never pick a space for a secondary mechanic.',
      user: `${premise}\nViews: ${(decomposition.views || []).join(', ') || 'unspecified'}\nSpaces the idea names: ${(decomposition.spaces || []).map(s => `${s.role} (${s.kind}): ${s.description}`).join('; ') || 'none'}\n\nSpaces that fit:\n${offeredSpaces.map(s => `- ${s.use}: ${String(cardOf(registry, s.use)?.intent || '').replace(/\s+/g, ' ').slice(0, 200)} [${s.why}]`).join('\n')}` });
    spaceStep = { candidates: offeredSpaces.map(({ use, score }) => ({ use, score })), asked: true, pick: a.pick, why: a.why };
  }
  const use = spaceStep.pick;
  const variants = spaceVariants(registry, use);
  const sid = spaceSlug(decomposition.spaces?.[0]?.role, 0);
  const role = decomposition.spaces?.[0]?.role || 'world';

  // The collection so far.
  /** @type {string[]} */
  let systems = [];
  let variant = 0;
  /** @type {AdapterInstance[]} */
  let adapters = [];
  /** @type {Record<string, string>} */
  let bind = {};
  // Validity (retrieval.js): the composition on the adapter instances resolveAdapters gives it, and preflight on the
  // partial document; the same checks decide the options and the whole collection after a pick.
  const checks = collectionChecks({ registry, space: { id: sid, use }, variants, documented, interaction: decomposition.core?.interaction || null });
  const stateOf = () => collectionState({ checks, systems, variant, variants });
  let state = stateOf();
  /** @type {string[]} */
  const contracts = [];
  /** @type {Array<BuildStep | import('./build-steps.js').LoopStep>} */
  const steps = [];
  /** @type {Gap[]} */
  const gaps = [];
  /** @type {BuildResult['mapping']} */
  const mapping = {};
  /** Collection primitive -> the mechanics it was added or mapped for (coverage reads a mechanic's own concept). @type {Map<string, Set<string>>} */
  const owners = new Map();
  const own = (/** @type {string} */ id, /** @type {string} */ m) => { owners.set(id, new Set([...(owners.get(id) || []), m])); };
  const spaceChoice = () => ({ id: sid, use, with: variants[variant]?.with || {}, role, caps: [...(variants[variant]?.caps || [])] });

  /**
   * Add a picked option with its bundle: checked as a whole collection (conflicts, and the same validity as the
   * options) with its adapters resolved; on success the collection, its adapters and content contracts are updated.
   * @param {{ id: string, variant: number, members: string[], adapters: Array<{ use: string }> }} cand
   * @returns {{ ok: true, have: boolean, closure: string[], checks: BuildChecks } | { ok: false, why: string }}
   */
  const tryAdd = cand => {
    const have = systems.includes(cand.id) || cand.id === use;
    const closure = have ? [] : cand.members.slice(1).filter(id => !systems.includes(id));
    const next = have ? systems : [...systems, cand.id, ...closure];
    const whole = state.evaluate(next.filter(id => !systems.includes(id)), cand.variant);
    const fresh = [...conflictsIn(registry, next), ...[...whole.problems].filter(([k]) => !state.baseline.problems.has(k)).map(([, x]) => x)];
    if (fresh.length) return { ok: false, why: fresh.slice(0, 3).join('; ') };
    systems = next; variant = cand.variant;
    adapters = whole.adapters; bind = whole.bind;
    state = stateOf();
    const own = [cand.id, ...closure].flatMap(id => contractsOf(registry, id).map(c => c.key));
    for (const k of own) if (!contracts.includes(k)) contracts.push(k);
    return { ok: true, have, closure, checks: { closure, bundle: [...cand.members, ...cand.adapters.map(x => x.use)], compose: whole.verdict, adapters: adapters.map(x => x.use), contracts: own, variant: variants[variant]?.with || {} } };
  };

  const loopId = loopMechanicOf(decomposition);
  const loopMechanic = loopId ? decomposition.mechanics.find(m => m.id === loopId) || null : null;
  // Adapters the mashup steps added keep their own list: tryAdd re-resolves the collection's adapters on each pick, and
  // the mashup instances are kept through it (adapters.js keepMashupAdapters), with the records of what each realises.
  /** @type {AdapterInstance[]} */
  const stepAdapters = [];
  /** @type {Record<string, string>} */
  const stepBind = {};
  /** @type {import('./adapters.js').MashupRealisation[]} */
  const realised = [];
  /** The game's win when the collection declares several (build-steps.js askWins). @type {import('./build-steps.js').WinDecision | null} */
  let win = null;
  const joined = () => keepMashupAdapters({ adapters, bind }, { adapters: stepAdapters, bind: stepBind, mashupAdapters: [{ relation: 'step', mechanics: [], instances: stepAdapters.map(a => ({ use: a.use, ...(a.id ? { id: a.id } : {}) })) }] });
  const collection = () => ({ space: { id: sid, use, with: variants[variant]?.with || {}, role, caps: [...(variants[variant]?.caps || [])] }, systems: [...systems],
    ...joined(),
    mechanics: decomposition.mechanics.map(m => ({ id: m.id, importance: m.importance, primitives: [...(mapping[m.id]?.primitives || [])] })), loop: loopMechanic?.id ?? null, win: win?.use ?? null,
    composes: (/** @type {string[]} */ ids) => state.composes(ids), resolve: (/** @type {string[]} */ ids, /** @type {number} */ v) => state.resolve(ids, v) });
  /**
   * The loop problems a pick brings that only its own declarations could answer (loop-check needs of the kinds in
   * OWN_NEEDS on one of its members), on the partial collection with it mapped to its mechanic.
   * @param {BuildCandidate} cand @param {string} mech @returns {import('./loop-check.js').LoopProblem[]}
   */
  const ownHoles = (cand, mech) => {
    const c = /** @type {any} */ (collection());
    const had = new Set(partialCheck(registry, decomposition, c).problems.map(p => `${p.code}:${p.primitive}`));
    const mechanics = c.mechanics.map((/** @type {{ id: string, primitives: string[] }} */ x) => (x.id === mech ? { ...x, primitives: [...x.primitives, cand.id] } : x));
    return partialCheck(registry, decomposition, c, { more: cand.members, adapters: /** @type {any} */ (cand.adapters), mechanics }).problems
      .filter(p => cand.members.includes(p.primitive) && OWN_NEEDS.has(String(p.need?.kind)) && !had.has(`${p.code}:${p.primitive}`));
  };
  /** Loop-step needs asked so far (their keys): none is asked twice in the build. @type {Set<string>} */
  const askedNeeds = new Set();
  /** The coverage gaps of the steps after a mechanic, with their need's key (a later step may resolve them). @type {Array<{ key: string, gap: Gap, step: import('./build-steps.js').LoopStep }>} */
  const coverGaps = [];
  /** Never two wins: when the collection declares several, one question picks the game's (build-steps.js askWins). @param {string | null} mechanic */
  const settleWins = async mechanic => {
    const r = await askWins({ registry, decomposition, collection: /** @type {any} */ (collection()), ask, decided: win, mechanic });
    if (r) { win = r.decision; steps.push(r.step); log(`build: the game's win is ${win.use} (unwired: ${win.unwired.join(', ')})`); }
  };
  /**
   * After a mechanic step, before the next: the wins, then the loop check of the partial collection (recorded on the
   * step). Each wired end whose reads play cannot change gets the coverage step for its primitive's mechanic (that
   * mechanic's valid options, retrieval.js validOptions, that answer the need; the model picks one or "none"), and the
   * wins again after a pick. The core loop mechanic's own ends are completed by the loop steps, once every mechanic
   * step has run (the other mechanics build its loop: asked earlier, the step would add what one of them brings).
   * @param {BuildStep} after the mechanic step that just ran
   */
  const settle = async after => {
    await settleWins(after.mechanic);
    for (let guard = 0; guard < 16; guard++) {
      const c = /** @type {any} */ (collection());
      const needs = loopNeeds(registry, decomposition, c, partialCheck(registry, decomposition, c));
      after.loop = needs.filter(n => n.problem).map(n => `${n.problem?.code} ${n.problem?.primitive}`);
      const need = needs.find(n => n.kind === 'coverage' && !askedNeeds.has(n.key) && n.join && n.join !== loopMechanic?.id);
      if (!need) break;
      askedNeeds.add(need.key);
      const mech = decomposition.mechanics.find(x => x.id === need.join) || null;
      const among = mech ? validOptions({ registry, decomposition, mechanic: mech, mapping, state, systems, space: use, adapters }).options.map(o => o.id) : null;
      const r = await askLoopStep({ registry, decomposition, collection: c, need, ask, mechanic: mech && { id: mech.id, verb: mech.verb, description: mech.description }, among });
      let gap = r.gap;
      if (r.pick) {
        const t = tryAdd(r.pick);
        if (!t.ok) {
          const last = r.step.asks[r.step.asks.length - 1];
          last.ok = false; last.problem = t.why; r.step.outcome = 'gap'; r.step.primitive = null;
          gap = { mechanic: 'loop', description: `${r.pick.id} failed the checks for the coverage step: ${t.why}`.slice(0, 400), importance: 'core', kind: 'no_primitive', why: t.why.slice(0, 400) };
        } else if (mech) {
          const mapped = mapping[mech.id];
          if (mapped && !mapped.primitives.includes(r.pick.id)) mapped.primitives.push(r.pick.id);
          for (const id of [r.pick.id, ...t.closure]) own(id, mech.id);
        }
      }
      if (gap) { gaps.push(gap); coverGaps.push({ key: need.key, gap, step: r.step }); }
      r.step.loop = partialCheck(registry, decomposition, /** @type {any} */ (collection())).problems.map(p => `${p.code} ${p.primitive}`);
      r.step.collection = [...systems];
      steps.push(r.step);
      if (r.step.primitive) await settleWins(mech?.id ?? after.mechanic);
    }
  };

  for (const m of worklist(decomposition)) {
    const t0 = performance.now();
    const header = `${premise}\nSpace: ${use} (${role})\nCollection so far: ${systems.join(', ') || '(empty)'}`;
    /** @type {BuildStep} */
    const step = { kind: 'mechanic', mechanic: m.id, importance: m.importance, candidates: [], rejected: [], asks: [], checks: null, outcome: 'gap', primitive: null, collection: [], ms: 0 };
    steps.push(step);
    // Coverage first: a primitive already in the collection of the mechanic's own concept, by its declarations.
    const cov = coverageOf({ registry, decomposition, mechanic: m, mapping, owners });
    let covered = cov.covered;
    if (!covered && cov.ambiguous.length) {
      const r = await askCoverage({ ask, registry, header, mechanic: m, ambiguous: cov.ambiguous });
      step.asks.push({ offered: r.asked.offered, pick: r.asked.pick, why: r.asked.why, ok: Boolean(r.covered), question: 'covered_by' });
      covered = r.covered;
    }
    if (covered) {
      const by = [...(owners.get(covered.primitive) || [])][0] || '';
      Object.assign(step, { outcome: 'covered', primitive: covered.primitive, coveredBy: by, coverage: { by: covered.primitive, why: covered.why, asked: step.asks.length > 0 } });
      mapping[m.id] = { primitives: [covered.primitive], candidates: [], why: covered.why };
      own(covered.primitive, m.id);
      const owner = steps.find(s => s.kind === 'mechanic' && s.mechanic === by);
      if (owner && owner.kind === 'mechanic') owner.covers = [...(owner.covers || []), m.id];
      step.collection = [...systems];
      step.ms = Math.round(performance.now() - t0);
      await settle(step);
      continue;
    }
    // Every valid option, in declaration order; the space itself when its card declares the mechanic's verb.
    const found = validOptions({ registry, decomposition, mechanic: m, mapping, state, systems, space: use, adapters });
    /** @type {BuildCandidate[]} */
    const candidates = found.options;
    if (declaresVerb(registry, use, m.verb)) candidates.push({ id: use, score: 1, variant, members: [use], extra: [], adapters: [] });
    step.candidates = candidates;
    step.rejected = found.rejected;
    step.context = found.context;
    /** @type {Gap | null} */
    let gap = null;
    let open = [...candidates];
    /** @type {string | null} */
    let problem = null;
    while (open.length) {
      const a = await pickOption({ ask, registry, header, mechanic: m, options: open, problem });
      for (const x of a.asked) step.asks.push({ offered: x.offered, pick: x.pick, why: x.why, ok: false, ...(x.name !== 'pick_primitive' ? { question: x.name } : {}) });
      const asked = step.asks[step.asks.length - 1];
      if (a.pick === 'none') {
        gap = { mechanic: m.id, description: m.description, importance: m.importance, kind: 'no_primitive', why: a.why || 'no listed primitive implements it', signature: primitiveSignature(m, found.context, spaceChoice(), a.spec) };
        break;
      }
      const cand = /** @type {BuildCandidate} */ (open.find(c => c.id === a.pick));
      // The pick's own loop must be playable from its declarations: a need no later step can answer (its participants,
      // the player's seat, an opponent, a group, the component its win reads) drops it, and the step is asked again
      // without it (the step path retries the step, never re-plans the collection afterwards).
      const holes = ownHoles(cand, m.id);
      const t = holes.length ? { ok: /** @type {const} */ (false), why: holes.slice(0, 2).map(p => `[${p.code}] ${p.message}`).join('; ') } : tryAdd(cand);
      if (!t.ok) {
        // Valid when offered; the whole-collection check (card.conflicts) still decides.
        asked.problem = t.why;
        open = open.filter(c => c.id !== a.pick);
        problem = `Your pick ${cand.members.length > 1 ? cand.members.join(' + ') : a.pick} was dropped: ${t.why}. Pick another listed option, or "none".`;
        log(`build ${m.id}: ${a.pick} dropped (${t.why})`);
        continue;
      }
      asked.ok = true;
      step.checks = t.checks;
      step.outcome = t.have ? 'reused' : 'added'; step.primitive = a.pick;
      for (const id of [cand.id, ...t.closure]) own(id, m.id);
      // The mechanic maps to the pick and the companions its declarations name (its requirements closure stays the pick's).
      mapping[m.id] = { primitives: [a.pick, ...cand.extra.filter(x => x.kind === 'declared').map(x => x.id)], candidates: candidates.map(({ id, score }) => ({ id, score })), why: a.why };
      break;
    }
    if (!step.primitive) {
      const tried = step.asks.filter(x => x.problem).map(x => `${x.pick}: ${x.problem}`);
      gap ??= { mechanic: m.id, description: m.description, importance: m.importance, kind: 'no_primitive', why: tried.length ? `every pick failed its checks: ${tried.join('; ')}`.slice(0, 400) : `no catalogue primitive whose declared loop serves ${found.context || 'the play spec'} is valid with the collection${found.rejected.length ? ` (${found.rejected.slice(0, 2).map(x => `${x.id}: ${x.why}`).join('; ')})` : ''}`.slice(0, 400),
        signature: primitiveSignature(m, found.context, spaceChoice()) };
      gaps.push(gap);
      mapping[m.id] = { primitives: [], candidates: candidates.map(({ id, score }) => ({ id, score })), why: gap.why };
    }
    step.collection = [...systems];
    step.ms = Math.round(performance.now() - t0);
    await settle(step);
  }
  // 3. The loop steps (build-steps.js), once the core loop mechanic has its primitive: the win, the lose, the drivers
  //    of AI opponents and what lets play change the win's reads, each one small strict question with the loop check
  //    of the partial collection after it. Their picks join the core loop mechanic (the driver joins the collection
  //    only); what none answers is a gap for the gap layer.
  if (loopMechanic && mapping[loopMechanic.id]?.primitives.length) {
    const r = await loopSteps({ registry, decomposition, collection: /** @type {any} */ (collection()), ask, mechanic: loopMechanic, log, asked: askedNeeds,
      commit: (kind, pick, mech) => {
        const t = tryAdd(pick);
        if (!t.ok) return t.why;
        // A win or lose joins the core loop mechanic; a coverage pick the mechanic of the primitive whose end it serves.
        if (kind !== 'driver') { const own = mapping[mech && mapping[mech] ? mech : loopMechanic.id]; if (!own.primitives.includes(pick.id)) own.primitives.push(pick.id); }
        return /** @type {any} */ (collection());
      } });
    steps.push(...r.steps);
    gaps.push(...r.gaps);
    // A win step that added a win beside one that cannot be wired: the game still has one win.
    await settleWins(loopMechanic.id);
  }
  // 4. The mashup's adapters (build-steps.js adapterSteps): a nested entry asks which declared outer event enters the
  //    joined loop and adds engine.adapt.nested wired from declarations; union and skin entries are decided by them.
  {
    const m = await adapterSteps({ registry, decomposition, collection: /** @type {any} */ (collection()), ask, log,
      commit: (kind, pick, mech) => { const t = tryAdd(pick); if (!t.ok) return t.why; const own = mech && mapping[mech]; if (own && !own.primitives.includes(pick.id)) own.primitives.push(pick.id); return /** @type {any} */ (collection()); },
      adopt: (insts, b) => { stepAdapters.push(...insts); Object.assign(stepBind, b); return /** @type {any} */ (collection()); } });
    steps.push(...m.steps);
    gaps.push(...m.gaps);
    realised.push(...m.realised);
    await settleWins(null);
  }
  // A coverage gap of the steps after a mechanic that a later step resolved (its need is gone from the loop check of the
  // whole collection) is no longer missing: its step is marked settled and its gap leaves the list.
  if (coverGaps.length) {
    const c = /** @type {any} */ (collection());
    const open = new Set(loopNeeds(registry, decomposition, c, partialCheck(registry, decomposition, c)).map(n => n.key));
    for (const x of coverGaps) if (!open.has(x.key)) { x.step.settled = 'a later step resolved it'; gaps.splice(gaps.indexOf(x.gap), 1); }
  }
  const all = collection();
  const caps = [...(variants[variant]?.caps || [])];
  return {
    version: BUILD_VERSION, loop: loopMechanicOf(decomposition), space: { id: sid, use, with: variants[variant]?.with || {}, role, caps }, spaceStep, win,
    mapping, systems, adapters: all.adapters, bind: all.bind, mashupAdapters: realised, gaps, contracts, steps, calls, ms: Math.round(performance.now() - started),
  };
}

/**
 * The order the params forms are asked in, from declarations: the loop primitives first, then the primitives related
 * to what is already ordered (one requires the other, card.requires.primitives; one reads what the other defines,
 * card.reads against card.defines/data; one needs a service the other provides; a mode played through another,
 * card.mode.via), breadth first; primitives related to nothing come last. Each layer is split so no two related
 * primitives share one: the primitives of a layer are independent and may be asked in parallel.
 * @param {RegistryLike} registry @param {string[]} ids @param {Iterable<string>} loopIds @returns {string[][]}
 */
export function dependencyLayers(registry, ids, loopIds) {
  const all = [...new Set(ids)].filter(id => registry.has(id));
  const outputs = (/** @type {string} */ id) => { const c = cardOf(registry, id); return new Set([...(c?.defines || []).map(d => d.at).filter(isStr), ...Object.keys(c?.data || {}), ...Object.keys(c?.dataShapes || {})]); };
  /** @param {string} a @param {string} b a's declarations depend on b's */
  const uses = (a, b) => {
    const ca = cardOf(registry, a), cb = cardOf(registry, b);
    if (!ca || !cb) return false;
    if ((ca.requires.primitives || []).some(r => b === r || b.startsWith(r + '.'))) return true;
    if ((ca.requires.services || []).some(s => (cb.provides.services || []).includes(s))) return true;
    const out = outputs(b);
    if ((ca.reads || []).some(r => out.has(r) || [...out].some(o => o.startsWith(r + '.') || r.startsWith(o + '.')))) return true;
    return prop(ca.mode, 'via') === b;
  };
  const related = (/** @type {string} */ a, /** @type {string} */ b) => a !== b && (uses(a, b) || uses(b, a));
  const loops = [...new Set(loopIds)].filter(id => all.includes(id));
  /** @type {string[][]} */
  const layers = [];
  const seen = new Set(loops);
  let frontier = loops;
  while (frontier.length) {
    layers.push(frontier);
    const next = all.filter(id => !seen.has(id) && frontier.some(f => related(f, id)));
    next.forEach(id => seen.add(id));
    frontier = next;
  }
  const rest = all.filter(id => !seen.has(id));
  if (rest.length) layers.push(rest);
  // Split each layer into independent sets (in order): a primitive related to one already in the set waits for the next.
  /** @type {string[][]} */
  const out = [];
  for (const layer of layers) {
    let left = [...layer];
    while (left.length) {
      /** @type {string[]} */
      const set = [];
      for (const id of left) if (!set.some(x => related(x, id))) set.push(id);
      out.push(set);
      left = left.filter(id => !set.includes(id));
    }
  }
  return out;
}
