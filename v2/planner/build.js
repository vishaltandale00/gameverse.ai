// @ts-check
// Iterative build of the primitive collection (ARCHITECTURE.md §5 selection): the game is a collection of primitives,
// grown one mechanic at a time with the static checks after every step, never mapped in one shot.
//
//   1. The primary space is chosen first, from the play spec's interaction and views: the space cards that fit (loops
//      declared for the interaction name them, card.views shows the idea's views) are offered as an enum; one that
//      fits alone is taken without a question. It is never swapped later: a pick that needs what it lacks comes with an
//      adapter, or is not offered. Only its configuration (spaceVariants) may change, when the whole collection still
//      composes on it.
//   2. A worklist of mechanics: the core loop mechanic named by the play spec (core.loop, else the primary idea's first
//      core mechanic), the other core mechanics, then supporting and flavour ones. For each:
//      - candidates: cards whose declared loop serves the play spec's interaction (select.js declaredFit's structural
//        part), that compose with the collection so far (compose-check, resolve:true) without a new failure or type
//        hole, ranked by their declarations (declaredFit, then lexical relevance); at most MAX_CANDIDATES;
//      - ONE small strict question: pick one candidate id (enum) or "none", with a one-line why;
//      - the pick is added with its requirements closure (that card only), the whole collection is checked again
//        (checkComposition) and its adapters resolved (resolveAdapters); the card's content contracts are recorded;
//      - a pick that fails a check is dropped and the model is asked again with the exact problem, over the candidates
//        left; when none fits (or the model says none) the mechanic is a gap with the primitive or adapter signature.
//   Every step is logged (mechanic, candidates, asks, checks, outcome) in the selection report.
//
// Nothing here names a primitive, a genre or a game: everything is read from card declarations.
import { checkComposition, documentedBy } from './compose-check.js';
import { resolveAdapters } from './adapters.js';
import { spaceVariants, requirementsOf, satisfying, isSpace, isGenerator, isGraphics, dataShapes } from './catalog.js';
import { contractsOf } from './content.js';
import { cardLoop, endsGame } from './loop.js';
import { isAvatar, mashupSides } from './play-spec.js';
import { declaredFit, servesInteraction, relevance, spaceSlug, KIND_HINTS } from './select.js';
import { unfurnishable } from './world.js';
import { parseReply } from './writer.js';
import { str, isStr, isObj, prop, messageOf } from '../kernel/guards.js';

/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** @typedef {import('../kernel/types.js').Card} Card */
/** @typedef {import('./types.js').Writer} Writer */
/** @typedef {import('./decompose.js').Decomposition} Decomposition */
/** @typedef {import('./decompose.js').Mechanic} Mechanic */
/** @typedef {import('./compose-check.js').CompositionResult} CompositionResult */
/** @typedef {import('./compose-check.js').AdapterInstance} AdapterInstance */
/** @typedef {import('./compose-check.js').AdapterSpec} AdapterSpec */
/** @typedef {import('./select.js').SpaceChoice} SpaceChoice */
/** @typedef {import('./select.js').Gap} Gap */
/** A candidate offered for a mechanic: its id, declared-fit score and the space configuration it composes on. @typedef {{ id: string, score: number, variant: number }} BuildCandidate */
/** One model question and what came of it. @typedef {{ offered: string[], pick: string, why: string, ok: boolean, problem?: string }} BuildAsk */
/**
 * The checks run after a pick: the closure it brought, the whole-collection verdict, the adapters resolved and the content
 * contracts recorded. @typedef {{ closure: string[], compose: string, adapters: string[], contracts: string[], variant: Record<string, unknown> }} BuildChecks
 */
/**
 * One worklist step. @typedef {{ mechanic: string, importance: string, candidates: BuildCandidate[], rejected: Array<{ id: string, why: string }>, asks: BuildAsk[],
 *   checks: BuildChecks | null, outcome: 'added' | 'reused' | 'gap', primitive: string | null, collection: string[], ms: number }} BuildStep
 */
/** The space step. @typedef {{ candidates: Array<{ use: string, score: number }>, asked: boolean, pick: string, why: string }} SpaceStep */
/**
 * buildSelection()'s result: what each mechanic maps to, the space, the collection (picks and their closures), adapter
 * instances and bindings, gaps, the recorded content contracts and the step log.
 * @typedef {{ version: string, loop: string | null, space: SpaceChoice, spaceStep: SpaceStep, mapping: Record<string, { primitives: string[], candidates: Array<{ id: string, score: number }>, why: string }>,
 *   systems: string[], adapters: AdapterInstance[], bind: Record<string, string>, gaps: Gap[], contracts: string[], steps: BuildStep[], calls: number, ms: number }} BuildResult
 */

export const BUILD_VERSION = 'build/0.1';
export const MAX_CANDIDATES = 8;

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
 * The worklist: the core loop mechanic, the other core mechanics, then supporting, then flavour (each in the idea's order).
 * @param {{ mechanics: Mechanic[], core?: { mashup?: Array<{ mechanics: string[] }>, [k: string]: unknown } | null }} decomposition @returns {Mechanic[]}
 */
export function worklist(decomposition) {
  const loop = loopMechanicOf(decomposition);
  const rank = (/** @type {Mechanic} */ m) => (m.id === loop ? 0 : m.importance === 'core' ? 1 : m.importance === 'supporting' ? 2 : 3);
  return decomposition.mechanics.map((m, i) => ({ m, i })).sort((a, b) => rank(a.m) - rank(b.m) || a.i - b.i).map(x => x.m);
}

/** Does a space variant satisfy a loop's declared space entry (a space id, a capability, or a capability list)? @param {RegistryLike} registry @param {string | string[]} entry @param {string} use @param {Set<string>} caps */
const entryFits = (registry, entry, use, caps) => (Array.isArray(entry) ? entry.every(c => caps.has(c)) : registry.has(entry) ? entry === use : caps.has(entry));

/**
 * The space cards that fit the play spec, best first (at most MAX_CANDIDATES): card.views shows one of the idea's views
 * (or 'any'), and, when loops are declared for the play spec's interaction, one of their declared spaces (an id, or the
 * capabilities a configuration of the space provides). An avatar interaction needs a space some registered generator
 * can furnish. Ranked by the declarations: named by a loop for the interaction, the primary view, the decomposed space
 * kind's capabilities.
 * @param {RegistryLike} registry @param {Decomposition} decomposition @param {string[]} [exclude]
 * @returns {Array<{ use: string, score: number, why: string }>}
 */
export function spaceCandidates(registry, decomposition, exclude = []) {
  const interaction = decomposition.core?.interaction || null;
  const views = (decomposition.views || []).filter(v => v !== 'ui' || decomposition.views.length === 1);
  const primary = views[0] || null;
  // Declared spaces (ids) that are not registered here name nothing to build on; capabilities stay.
  const declared = interaction ? registry.ids().map(id => cardLoop(cardOf(registry, id))).filter(l => l && l.interaction === interaction).flatMap(l => l?.space || []).filter(e => !(isStr(e) && isSpace(e) && !registry.has(e))) : [];
  const kind = decomposition.spaces?.[0]?.kind ? KIND_HINTS[decomposition.spaces[0].kind] : null;
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
    const caps = new Set(variants.flatMap(v => [...v.caps]));
    const score = (byId ? 6 : byCaps ? 3 : 0) + (primary && own.includes(primary) ? 4 : 0) + views.filter(v => own.includes(v)).length
      + (kind ? kind.caps.filter(c => caps.has(c)).length - (kind.caps.length && !kind.caps.some(c => caps.has(c)) ? 2 : 0) : 0);
    out.push({ use, score, why: [byId ? `named by a loop played as ${interaction}` : byCaps ? `provides what loops played as ${interaction} declare` : '', views.length ? `shows ${views.filter(v => own.includes(v)).join(', ') || 'any view'}` : ''].filter(Boolean).join('; ') });
  }
  return out.sort((a, b) => b.score - a.score || a.use.localeCompare(b.use)).slice(0, MAX_CANDIDATES);
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

/** Stable keys of a check's failures and holes, to compare a step against the collection before it. @param {CompositionResult} r */
const keysOf = r => ({
  failures: new Map(r.failures.map(f => [`${f.check}:${f.code}:${f.unit}:${f.need ? `${f.need.kind}:${f.need.item}` : ''}`, `${f.check}: ${f.message}`])),
  holes: new Map(r.holes.map(h => [`${h.card}:${h.field}:${h.code}`, `${h.card} ${h.field}: ${h.message}`])),
});
/** What `after` has that `before` did not. @param {ReturnType<typeof keysOf>} before @param {ReturnType<typeof keysOf>} after @returns {string[]} */
const added = (before, after) => [...[...after.failures].filter(([k]) => !before.failures.has(k)).map(([, m]) => m), ...[...after.holes].filter(([k]) => !before.holes.has(k)).map(([, m]) => `type hole: ${m}`)];

/** Conflicts inside a collection (card.conflicts), as problem lines. @param {RegistryLike} registry @param {string[]} ids */
const conflictsIn = (registry, ids) => ids.flatMap(id => (cardOf(registry, id)?.conflicts || []).filter(c => c !== id && ids.includes(c)).map(c => `'${id}' conflicts with '${c}' (card.conflicts)`));

/**
 * The primitive signature the gap layer writes when no catalogue primitive fits a mechanic (replan.js uses the same words).
 * @param {Mechanic} m @param {string | null} interaction @param {SpaceChoice} space @param {string} [spec]
 */
const primitiveSignature = (m, interaction, space, spec = '') => `${m.id}: a primitive whose loop (card.loop) ${interaction ? `is played as ${interaction}, ` : ''}with verbs and progress events for "${m.description}", on ${space.use} (${space.caps.join(', ')})${spec ? `. Spec: ${spec}` : ''}`.slice(0, 600);

/** @param {AdapterSpec} a */
const adapterLine = a => `${a.id} (provides ${[...a.card.adapts.provides.capabilities, ...a.card.adapts.provides.content, ...a.card.adapts.provides.services].join(', ') || 'nothing'} from ${a.card.adapts.from.spaces.join(', ')})`;

/**
 * Grow the collection mechanic by mechanic (see the header). A writer is required: without one selection is the offline
 * mode (select.js). A reply that is not one of the offered ids is asked again up to `attempts` times; then selection
 * fails (status 422, code selection_failed): nothing stands in for the model.
 * @param {{ decomposition: Decomposition, registry: RegistryLike, writer: Writer, log?: (msg: string) => void, excludeSpaces?: string[], attempts?: number }} options
 * @returns {Promise<BuildResult>}
 */
export async function buildSelection({ decomposition, registry, writer, log = () => {}, excludeSpaces = [], attempts = 2 }) {
  const started = performance.now();
  const interaction = decomposition.core?.interaction || null;
  const documented = documentedBy(dataShapes);
  let calls = 0;
  const premise = `Game idea: ${decomposition.premise}\nPlayed as: ${interaction || 'undecided'}; opponent: ${decomposition.core?.opponent || 'none'}${decomposition.core?.win ? `; won by: ${decomposition.core.win}` : ''}`;

  /**
   * One strict enum question; a reply outside the enum is asked again (attempts), then selection fails.
   * @param {{ name: string, system: string, user: string, field: string, options: string[], extra?: Record<string, Record<string, unknown>> }} q
   * @returns {Promise<{ pick: string, why: string, reply: Record<string, unknown> }>}
   */
  const ask = async ({ name, system, user, field, options, extra = {} }) => {
    const props = { [field]: { type: 'string', enum: options }, why: { type: 'string', description: 'one line' }, ...extra };
    const schema = { name, schema: { type: 'object', additionalProperties: false, required: Object.keys(props), properties: props } };
    /** @type {string[]} */
    const failed = [];
    for (let i = 0; i < Math.max(1, attempts); i++) {
      calls++;
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
  const spaceOn = (/** @type {number} */ v) => ({ id: sid, use, with: variants[v]?.with || {} });
  /** The collection's composition on a space configuration (adapters proposed by the checker, resolve:true). @param {string[]} ids @param {number} v */
  const compose = (ids, v) => checkComposition({ spaces: [spaceOn(v)], systems: ids }, registry, { resolve: true, documented });
  let baseline = keysOf(compose(systems, variant));
  /** @type {string[]} */
  const contracts = [];
  /** @type {BuildStep[]} */
  const steps = [];
  /** @type {Gap[]} */
  const gaps = [];
  /** @type {BuildResult['mapping']} */
  const mapping = {};
  // A mechanic of a joined idea (a mashup relation names it, or it comes from another reference than the core loop
  // mechanic's) is played in its own loop, its own way (nested or union, realised by adapters): its candidates are not
  // held to the primary interaction.
  const ideaOf = (/** @type {unknown} */ from) => (String(from || '').toLowerCase().match(/[a-z0-9]+/g) || []).join('_');
  const primaryIdea = ideaOf(decomposition.mechanics.find(m => m.id === loopMechanicOf(decomposition))?.from);
  // Only an entry across concepts joins an idea (select.js joinedBy): an entry within one concept relates nothing
  // (mashup_within_concept, asked again after the build) and must not free its mechanics from the primary interaction.
  const joined = (/** @type {Mechanic} */ m) => (decomposition.core?.mashup || []).some(x => { const s = mashupSides(x, decomposition.mechanics); return s.outer.length > 0 && s.inner.includes(m.id); }) || Boolean(primaryIdea && ideaOf(m.from) && ideaOf(m.from) !== primaryIdea);
  const pool = registry.cards().filter(c => !isSpace(c.id) && !isGenerator(c.id) && !isGraphics(c.id));

  /**
   * Can `id` join the collection: the space configuration (current first) on which the collection plus it has no new
   * failure or type hole, or the problems on the current one. @param {string} id
   * @returns {{ ok: true, variant: number } | { ok: false, why: string }}
   */
  const composes = id => {
    if (systems.includes(id)) return { ok: true, variant };
    /** @type {string[]} */
    let first = [];
    for (const v of [variant, ...variants.map((_, i) => i).filter(i => i !== variant)]) {
      const extra = added(baseline, keysOf(compose([...systems, id], v)));
      if (!extra.length) return { ok: true, variant: v };
      if (v === variant) first = extra;
    }
    return { ok: false, why: first.slice(0, 3).join('; ') };
  };

  for (const m of worklist(decomposition)) {
    const t0 = performance.now();
    // Candidates: a declared loop that serves the interaction (and is not another interaction's game-owning loop the
    // spec does not join), ranked by declarations; only those that compose with the collection are offered.
    const own = joined(m);
    const playedAs = own ? null : interaction;
    const fits = pool.map(card => {
      const loop = cardLoop(card);
      if (!loop || (!loop.verbs.length && !loop.progress.length) || !servesInteraction(card, playedAs)) return null;
      if (playedAs && loop.interaction && loop.interaction !== playedAs && endsGame(loop.win)) return null;
      // related: the card's own declarations (loop verbs, progress, names) speak of the mechanic, before how it is played.
      return { id: card.id, score: declaredFit(m, card, { interaction: playedAs, joined: own }) ?? 0, related: (declaredFit(m, card, { joined: own }) ?? 0) > 0 ? 1 : 0, rel: relevance(m, card) };
    }).filter(/** @returns {x is { id: string, score: number, related: number, rel: number }} */ x => x !== null)
      .sort((a, b) => b.related - a.related || b.score - a.score || b.rel - a.rel || a.id.localeCompare(b.id));
    /** @type {BuildCandidate[]} */
    const candidates = [];
    /** @type {Array<{ id: string, why: string }>} */
    const rejected = [];
    for (const f of fits) {
      if (candidates.length >= MAX_CANDIDATES) break;
      const c = composes(f.id);
      if (c.ok) candidates.push({ id: f.id, score: f.score, variant: c.variant }); else rejected.push({ id: f.id, why: c.why });
    }
    // The space itself may be what a mechanic is (travelling between its places): offered when its card relates to it.
    const host = registry.cards().find(c => c.id === use);
    if (host && candidates.length < MAX_CANDIDATES && relevance(m, host) > 0) candidates.push({ id: use, score: 0, variant });
    /** @type {BuildStep} */
    const step = { mechanic: m.id, importance: m.importance, candidates, rejected: rejected.slice(0, 6), asks: [], checks: null, outcome: 'gap', primitive: null, collection: [], ms: 0 };
    steps.push(step);
    /** @type {Gap | null} */
    let gap = null;
    let open = [...candidates];
    /** @type {string | null} */
    let problem = null;
    /** @type {AdapterSpec | undefined} */
    let lastAdapter;
    while (open.length) {
      const offered = open.map(c => c.id);
      const a = await ask({ name: 'pick_primitive', field: 'pick', options: [...offered, 'none'],
        extra: { spec: { type: 'string', description: 'when pick is "none": what a new primitive must do for this mechanic (its rules, inputs, state, events, how it is won), precise enough to build it; else ""' } },
        system: 'You build a game from composable primitives, one mechanic at a time. Pick the ONE listed primitive that implements this mechanic as the game needs it, or "none" when none of them does (a related but different mechanic is "none"). Every listed primitive already composes with the collection so far.',
        user: `${premise}\nSpace: ${use} (${role})\nCollection so far: ${systems.join(', ') || '(empty)'}\n\nMechanic ${m.id} (${m.importance}): ${m.description}\n\nCandidates:\n${open.map(c => { const card = cardOf(registry, c.id); const loop = cardLoop(card); return `- ${c.id}: ${String(card?.intent || '').replace(/\s+/g, ' ').slice(0, 180)}${loop?.verbs.length ? ` (verbs: ${loop.verbs.join(', ')})` : ''}`; }).join('\n')}${problem ? `\n\n${problem}` : ''}` });
      /** @type {BuildAsk} */
      const asked = { offered, pick: a.pick, why: a.why, ok: false };
      step.asks.push(asked);
      if (a.pick === 'none') {
        const spec = str(prop(a.reply, 'spec')).slice(0, 600);
        gap = { mechanic: m.id, description: m.description, importance: m.importance, kind: 'no_primitive', why: a.why || 'no listed primitive implements it', signature: primitiveSignature(m, interaction, { id: sid, use, with: variants[variant]?.with || {}, role, caps: [...(variants[variant]?.caps || [])] }, spec) };
        break;
      }
      const cand = /** @type {BuildCandidate} */ (open.find(c => c.id === a.pick));
      // The pick with its closure, checked as a whole collection, its adapters resolved (the space is already in it).
      const have = systems.includes(a.pick) || a.pick === use;
      const closure = have ? [] : closureOf(registry, a.pick, systems);
      const next = have ? systems : [...systems, a.pick, ...closure];
      const whole = compose(next, cand.variant);
      const fresh = [...conflictsIn(registry, next), ...added(baseline, keysOf(whole))];
      /** @type {ReturnType<typeof resolveAdapters> | null} */
      const r = fresh.length ? null : resolveAdapters({ spaces: [spaceOn(cand.variant)], systems: next }, registry, { documented });
      if (r?.gaps.length) lastAdapter = r.gaps[0];
      const why = fresh.length ? fresh.slice(0, 3).join('; ') : r && (r.gaps.length || r.verdict === 'incompatible-needs-adapter')
        ? `needs an adapter no registered primitive provides: ${r.gaps.map(adapterLine).join('; ') || r.result.reason}` : '';
      if (why) {
        asked.problem = why;
        open = open.filter(c => c.id !== a.pick);
        problem = `Your pick ${a.pick} was dropped: ${why}. Pick another listed primitive, or "none".`;
        log(`build ${m.id}: ${a.pick} dropped (${why})`);
        continue;
      }
      asked.ok = true;
      const reused = have;
      systems = next; variant = cand.variant; baseline = keysOf(whole);
      adapters = r?.adapters || []; bind = r?.bind || {};
      const own = [a.pick, ...closure].flatMap(id => contractsOf(registry, id).map(c => c.key));
      for (const k of own) if (!contracts.includes(k)) contracts.push(k);
      step.checks = { closure, compose: r?.verdict || whole.verdict, adapters: adapters.map(x => x.use), contracts: own, variant: variants[variant]?.with || {} };
      step.outcome = reused ? 'reused' : 'added'; step.primitive = a.pick;
      mapping[m.id] = { primitives: [a.pick], candidates: candidates.map(({ id, score }) => ({ id, score })), why: a.why };
      break;
    }
    if (!step.primitive) {
      const tried = step.asks.filter(x => x.problem).map(x => `${x.pick}: ${x.problem}`);
      gap ??= lastAdapter && step.asks.length && step.asks.every(x => x.problem)
        ? { mechanic: m.id, description: `needs adapter: ${adapterLine(lastAdapter)}`, importance: m.importance, kind: 'adapter', why: tried.join('; ').slice(0, 400), primitive: step.asks[step.asks.length - 1].pick, adapter: lastAdapter, signature: `adapter ${lastAdapter.id}: ${lastAdapter.card.adapts.projection}`, verdict: 'incompatible-needs-adapter' }
        : { mechanic: m.id, description: m.description, importance: m.importance, kind: 'no_primitive', why: tried.length ? `every candidate failed its checks: ${tried.join('; ')}`.slice(0, 400) : candidates.length ? 'no listed primitive implements it' : `no catalogue primitive whose declared loop serves ${interaction || 'the play spec'} composes with the collection${rejected.length ? ` (${rejected.slice(0, 2).map(x => `${x.id}: ${x.why}`).join('; ')})` : ''}`,
          signature: primitiveSignature(m, interaction, { id: sid, use, with: variants[variant]?.with || {}, role, caps: [...(variants[variant]?.caps || [])] }) };
      gaps.push(gap);
      mapping[m.id] = { primitives: [], candidates: candidates.map(({ id, score }) => ({ id, score })), why: gap.why };
    }
    step.collection = [...systems];
    step.ms = Math.round(performance.now() - t0);
  }
  const caps = [...(variants[variant]?.caps || [])];
  return {
    version: BUILD_VERSION, loop: loopMechanicOf(decomposition), space: { id: sid, use, with: variants[variant]?.with || {}, role, caps }, spaceStep,
    mapping, systems, adapters, bind, gaps, contracts, steps, calls, ms: Math.round(performance.now() - started),
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
