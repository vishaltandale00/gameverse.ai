// @ts-check
// Retrieval for the step path: the iterative build (build.js) and the extensions onto a template (extend.js).
//   1. coverageOf: before asking about a mechanic, a primitive already in the collection may cover it by what it
//      declares. Only primitives of the mechanic's own concept (mechanic.from) count, the concept's loop primitive
//      first. The mechanic's verb (a structured field) is compared, as a whole name, with declared names: the content
//      sections a card needs or reads (their own name: content.moves -> moves; card.loop/mode needs.content,
//      card.content, card.reads, card.defines, card.data, card.dataShapes), its loop verbs and actions, progress events
//      (their base: captured:* -> captured) and the effects it owns. Covered without a question when the concept's loop
//      primitive needs a content section or declares a loop verb the verb is, or when a primitive's loop verb is it; a
//      weaker declared match (a section it reads, an event, an effect) is ambiguous and asked as one small
//      yes/no-with-enum question. No text is split into words or stemmed, and free text (intents, descriptions) never
//      matches anything.
//   2. validOptions: EVERY catalogue card whose declared loop serves the mechanic's interaction context (the play
//      spec's interaction; for a joined concept, the interaction its own loop primitive declares), each as a single card
//      or the smallest bundle (bundles.js) that is valid: the collection with it has no new failure or type hole in
//      checkComposition (resolve:true, on the adapter instances resolveAdapters gives it, with their ids and bindings),
//      no adapter nobody registers, and no new capability, service, requirement or conflict error from the same
//      preflight (kernel/document.js) the published document passes, run on the partial document. The list is in
//      declaration order (declarationOrder: cards whose loop declares the mechanic's verb first, then the catalogue's
//      order); nothing is cut from it and nothing is ranked by text.
//   3. pickOption: one strict enum question over that whole list (id, one-line intent, bundle members), plus "none"
//      with a reason; a list longer than MAX_LIST is first narrowed by one question over the cards' id namespaces.
// Nothing here names a primitive, a genre or a game.
import { resolveAdapters } from './adapters.js';
import { isSpace, isGenerator, isGraphics } from './catalog.js';
import { cardLoop, loopServes } from '../kernel/loop.js';
import { servesInteraction, vocabIndex } from './select.js';
import { formBundle, bundleLabel } from './bundles.js';
import { mashupSides } from './play-spec.js';
import { preflight, DOC_SCHEMA } from '../kernel/document.js';
import { Logic } from '../kernel/logic.js';
import { buildLogic } from '../kernel/world.js';
import { isStr, str, prop } from '../kernel/guards.js';

/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** @typedef {import('../kernel/types.js').LogicLike} LogicLike */
/** @typedef {import('../kernel/types.js').Card} Card */
/** @typedef {import('./decompose.js').Mechanic} Mechanic */
/** @typedef {import('./compose-check.js').AdapterInstance} AdapterInstance */
/** @typedef {import('./compose-check.js').AdapterSpec} AdapterSpec */
/** The decomposition fields retrieval reads. @typedef {{ mechanics: Mechanic[], concepts?: Array<{ id: string, name?: string, loop?: string }>, core?: { loop?: unknown, interaction?: string | null, mashup?: import('./play-spec.js').Mashup[], [k: string]: unknown } | null }} Spec */
/** A mechanic's mapped primitives (build mapping or selection mechanics). @typedef {Record<string, { primitives: string[] }>} Mapping */
/**
 * The collection evaluated on one space configuration: its problems (stable key -> line), the adapter instances and
 * bindings resolveAdapters gives it, and the adapters nobody registers. @typedef {{ problems: Map<string, string>, adapters: AdapterInstance[], bind: Record<string, string>, gaps: AdapterSpec[], verdict: string }} Evaluation
 */
/**
 * An option offered for a mechanic: its id (the seed card's, the enum value), score (1 when its loop declares the
 * mechanic's verb: declarationOrder; reported only), the space configuration it is valid on, its members (the seed first), the companions and
 * adapter instances beyond the seed with why each is there.
 * @typedef {{ id: string, score: number, variant: number, members: string[], extra: import('./bundles.js').Companion[], adapters: import('./bundles.js').BundleAdapter[] }} Option
 */
/** One question and its answer. @typedef {{ name: string, offered: string[], pick: string, why: string }} Asked */
/** The strict enum question (build-steps.js makeAsk). @typedef {import('./build-steps.js').Ask} Ask */

export const RETRIEVAL_VERSION = 'retrieval/0.1';
/** A list longer than this is narrowed by a category question first. */
export const MAX_LIST = 40;
/** Preflight codes the validity check shares with the published document (capabilities, services, requirements). */
export const STRUCTURAL = new Set(['capability_missing', 'service_missing', 'requires_unmet', 'primitive_conflict', 'adapter_from_mismatch', 'primitive_unknown', 'primitive_slot']);

/** @param {RegistryLike} registry @param {string} id @returns {Card | null} */
const cardOf = (registry, id) => registry.get(id)?.card ?? null;
/** A concept key: the slug of mechanic.from or a concept id/name. @param {unknown} from */
export const ideaOf = from => (String(from || '').toLowerCase().match(/[a-z0-9]+/g) || []).join('_');

/** @type {WeakMap<object, LogicLike>} */
const logicCache = new WeakMap();
/** @param {RegistryLike} registry @returns {LogicLike} */
function logicOf(registry) {
  let l = logicCache.get(registry);
  if (!l) { l = /** @type {LogicLike} */ (/** @type {unknown} */ (buildLogic(registry, Logic))); logicCache.set(registry, l); }
  return l;
}

/** @param {AdapterSpec} a */
export const adapterLine = a => `${a.id} (provides ${[...a.card.adapts.provides.capabilities, ...a.card.adapts.provides.content, ...a.card.adapts.provides.services].join(', ') || 'nothing'} from ${a.card.adapts.from.spaces.join(', ')})`;

/**
 * The validity checks of a collection on one space (its configurations `variants`): evaluate(ids, v) resolves the
 * adapters the collection needs (resolveAdapters: instances with their ids, configuration and bindings), checks the
 * resolved composition (checkComposition, resolve:true) and runs preflight on the partial document the collection is
 * (the space, the systems on their bound spaces, the adapter instances), keeping its capability, service, requirement
 * and conflict errors. Memoized per call site. The composition is never checked in the compact form where an adapter
 * without an id lends the host what it could project: the document never gets that.
 * `interaction` is the play spec's (compose-check: the input a loop serving it needs is the one for it).
 * @param {{ registry: RegistryLike, space: { id: string, use: string }, variants: Array<{ with: Record<string, unknown> }>, documented?: (section: string) => boolean, interaction?: string | null }} options
 */
export function collectionChecks({ registry, space, variants, documented, interaction = null }) {
  const logic = logicOf(registry);
  /** @type {Map<string, Evaluation>} */
  const memo = new Map();
  /** @param {string[]} ids @param {number} v @returns {Evaluation} */
  const evaluate = (ids, v) => {
    const key = `${v}|${[...new Set(ids)].sort().join(',')}`;
    const hit = memo.get(key); if (hit) return hit;
    const sp = { id: space.id, use: space.use, with: variants[v]?.with || {} };
    const r = resolveAdapters({ spaces: [sp], systems: ids }, registry, { ...(documented ? { documented } : {}), ...(interaction ? { interaction } : {}) });
    /** @type {Map<string, string>} */
    const problems = new Map();
    for (const f of r.result.failures) problems.set(`${f.check}:${f.code}:${f.unit}:${f.need ? `${f.need.kind}:${f.need.item}` : ''}`, `${f.check}: ${f.message}`);
    for (const h of r.result.holes) problems.set(`hole:${h.card}:${h.field}:${h.code}`, `type hole: ${h.card} ${h.field}: ${h.message}`);
    for (const g of r.gaps) problems.set(`adapter:${g.id}`, `needs an adapter no registered primitive provides: ${adapterLine(g)}`);
    const doc = { schema: DOC_SCHEMA, id: 'partial', title: 'partial', spaces: [{ id: sp.id, use: sp.use, with: sp.with }],
      systems: [...ids.map(use => ({ use, ...(r.bind[use] ? { space: r.bind[use] } : {}) })), ...r.adapters.map(a => structuredClone(a))] };
    for (const e of preflight(doc, registry, logic).errors) if (STRUCTURAL.has(e.code)) problems.set(`preflight:${e.code}:${e.message}`, `preflight ${e.code}: ${e.message}`);
    const out = { problems, adapters: r.adapters, bind: r.bind, gaps: r.gaps, verdict: r.verdict };
    memo.set(key, out);
    return out;
  };
  return { evaluate };
}

/**
 * The collection as options are checked against it: its baseline evaluation, composes(ids) (the space configuration,
 * current first, on which the collection plus `ids` adds no problem, or the problems on the current one) and
 * resolve(ids, v) (the adapter instances and bindings of the collection plus `ids`), as formBundle reads them.
 * @param {{ checks: ReturnType<typeof collectionChecks>, systems: string[], variant: number, variants: unknown[] }} options
 */
export function collectionState({ checks, systems, variant, variants }) {
  const baseline = checks.evaluate(systems, variant);
  /** @param {string[]} ids */
  const withIds = ids => [...systems, ...ids.filter(id => !systems.includes(id))];
  /** @param {string[]} ids @returns {{ ok: true, variant: number } | { ok: false, why: string }} */
  const composes = ids => {
    if (!ids.some(id => !systems.includes(id))) return { ok: true, variant };
    /** @type {string[]} */
    let first = [];
    for (const v of [variant, ...variants.map((_, i) => i).filter(i => i !== variant)]) {
      const extra = [...checks.evaluate(withIds(ids), v).problems].filter(([k]) => !baseline.problems.has(k)).map(([, m]) => m);
      if (!extra.length) return { ok: true, variant: v };
      if (v === variant) first = extra;
    }
    return { ok: false, why: first.slice(0, 3).join('; ') };
  };
  /** @param {string[]} ids @param {number} v */
  const resolve = (ids, v) => { const e = checks.evaluate(withIds(ids), v); return { adapters: e.adapters, bind: e.bind, gaps: e.gaps }; };
  return { baseline, composes, resolve, evaluate: (/** @type {string[]} */ ids, /** @type {number} */ v) => checks.evaluate(withIds(ids), v) };
}

/** The concept a mechanic comes from (decomposition.concepts by id or name), or null. @param {Spec} d @param {string} key */
const conceptOf = (d, key) => (d.concepts || []).find(c => ideaOf(c.id) === key || ideaOf(c.name) === key) || null;

/**
 * The loop mechanic of a concept: concept.loop, else the play spec's core loop mechanic when it comes from the same
 * concept. @param {Spec} d @param {unknown} from @returns {string | null}
 */
export function conceptLoopOf(d, from) {
  const key = ideaOf(from);
  const own = conceptOf(d, key)?.loop;
  if (isStr(own) && d.mechanics.some(m => m.id === own)) return own;
  const core = prop(d.core, 'loop');
  return isStr(core) && d.mechanics.some(m => m.id === core && ideaOf(m.from) === key) ? core : null;
}

/**
 * Is a mechanic played in a joined idea's own loop (the inner side of a mashup entry across concepts, or a source
 * other than the core loop mechanic's)? Its options are held to that loop's interaction, not the primary one.
 * @param {Spec} d @param {Mechanic} m
 */
export function joinedMechanic(d, m) {
  const loop = prop(d.core, 'loop');
  const primary = ideaOf(d.mechanics.find(x => x.id === loop)?.from);
  return (d.core?.mashup || []).some(x => { const s = mashupSides(x, d.mechanics); return s.outer.length > 0 && s.inner.includes(m.id); }) || Boolean(primary && ideaOf(m.from) && ideaOf(m.from) !== primary);
}

/**
 * The interaction a mechanic's options must serve: the play spec's interaction; for a joined concept's mechanic, the
 * interaction its concept's loop primitive is played in (card.loop / card.mode interactions): the play spec's when that
 * loop serves it, else the first it declares, once that is mapped; null (unconstrained) for the joined concept's loop
 * mechanic itself or before its loop is mapped.
 * @param {RegistryLike} registry @param {Spec} d @param {Mechanic} m @param {Mapping} mapping @returns {string | null}
 */
export function interactionContext(registry, d, m, mapping) {
  const played = d.core?.interaction || null;
  if (!joinedMechanic(d, m)) return played;
  const loop = conceptLoopOf(d, m.from);
  if (!loop || loop === m.id) return null;
  for (const id of mapping[loop]?.primitives || []) {
    const l = cardLoop(cardOf(registry, id));
    if (!l?.interactions.length) continue;
    return played && l.interactions.includes(played) ? played : l.interactions[0];
  }
  return null;
}

/** Does a card's declared loop serve an interaction context: no avatar locomotion for non-avatar play, the inputs it lists, and a loop whose declared interactions include it (or that declares none). @param {Card | null} card @param {string | null} ctx */
export function servesContext(card, ctx) {
  return servesInteraction(card, ctx) && loopServes(cardLoop(card), ctx);
}

/** A declared name or a mechanic's verb as compared, whole: trimmed and lowercased (never split into words). @param {unknown} text */
export const nameOf = text => String(text ?? '').trim().toLowerCase();

/** Declared names of a card by kind, each token with the declaration it comes from. @typedef {{ needs: Map<string, string>, reads: Map<string, string>, verbs: Map<string, string>, progress: Map<string, string>, effects: Map<string, string> }} Declared */
/** @type {WeakMap<object, Map<string, Declared>>} */
const declaredCache = new WeakMap();
/** @param {RegistryLike} registry @param {string} id @returns {Declared} */
export function declaredNames(registry, id) {
  let byId = declaredCache.get(registry);
  if (!byId) { byId = new Map(); declaredCache.set(registry, byId); }
  const hit = byId.get(id); if (hit) return hit;
  const c = cardOf(registry, id), loop = cardLoop(c);
  /** @param {Iterable<unknown>} names @param {(n: string) => string} key */
  const index = (names, key) => { /** @type {Map<string, string>} */ const m = new Map(); for (const n of names) if (isStr(n)) { const k = nameOf(key(n)); if (k && !m.has(k)) m.set(k, n); } return m; };
  // A section's own name (content.moves -> moves), never its root; an event's base (captured:* -> captured).
  const section = (/** @type {string} */ s) => s.split('.').slice(1).join('.');
  const plain = (/** @type {string} */ s) => s.split(':')[0];
  const needs = [...(Array.isArray(loop?.needs?.content) ? loop.needs.content : []), .../** @type {unknown[]} */ (Array.isArray(c?.content) ? c.content : []).map(x => prop(x, 'at'))].filter(x => isStr(x) && x.includes('.'));
  const reads = [...(c?.reads || []), ...(c?.defines || []).map(x => x.at), ...Object.keys(c?.data || {}), ...Object.keys(c?.dataShapes || {})].filter(x => isStr(x) && x.includes('.'));
  const effects = Object.entries(vocabIndex(registry).effects).filter(([, owner]) => owner === id).map(([k]) => k);
  const out = { needs: index(needs, section), reads: index(reads, section), verbs: index([...(loop?.verbs || []), ...(c?.provides?.actions || [])], plain), progress: index(loop?.progress || [], plain), effects: index(effects, plain) };
  byId.set(id, out);
  return out;
}

/**
 * Whether a primitive already in the collection covers a mechanic, from declarations (see the header). `owners` maps
 * each collection primitive to the mechanics it was added or mapped for; only those of the mechanic's own concept are
 * considered, never one in `exclude`.
 * -> covered: the one primitive that clearly covers it and why; ambiguous: primitives a weaker declared match names
 *    (to ask about); both empty when nothing declared matches.
 * @param {{ registry: RegistryLike, decomposition: Spec, mechanic: Mechanic, mapping: Mapping, owners: Map<string, Set<string>>, exclude?: Iterable<string> }} options
 * @returns {{ covered: { primitive: string, why: string } | null, ambiguous: Array<{ primitive: string, why: string }> }}
 */
export function coverageOf({ registry, decomposition, mechanic: m, mapping, owners, exclude = [] }) {
  const none = { covered: null, ambiguous: [] };
  const key = ideaOf(m.from);
  const loopMechanic = conceptLoopOf(decomposition, m.from);
  if (loopMechanic === m.id || prop(decomposition.core, 'loop') === m.id) return none;
  const verb = nameOf(m.verb);
  if (!verb) return none;
  const skip = new Set(exclude);
  const fromOf = new Map(decomposition.mechanics.map(x => [x.id, ideaOf(x.from)]));
  const loopPrims = new Set(loopMechanic ? mapping[loopMechanic]?.primitives || [] : []);
  const own = [...owners].filter(([id, ms]) => !skip.has(id) && registry.has(id) && [...ms].some(x => x !== m.id && fromOf.get(x) === key)).map(([id]) => id)
    .sort((a, b) => Number(loopPrims.has(b)) - Number(loopPrims.has(a)));
  /** @type {Array<{ primitive: string, why: string }>} */
  const clear = [];
  /** @type {Array<{ primitive: string, why: string }>} */
  const weak = [];
  for (const id of own) {
    const n = declaredNames(registry, id);
    const named = (/** @type {Map<string, string>} */ at) => (at.has(verb) ? [/** @type {string} */ (at.get(verb))] : []);
    const needs = named(n.needs), verbs = named(n.verbs);
    const all = [...new Set([...needs, ...named(n.reads), ...verbs, ...named(n.progress), ...named(n.effects)])];
    if (!all.length) continue;
    const whole = verbs.length > 0;
    const loopOwn = loopPrims.has(id) && (needs.length > 0 || verbs.length > 0);
    const why = `${id} declares ${all.join(', ')}, which "${m.verb}" is${loopPrims.has(id) ? ` (the loop primitive of ${m.from || 'its concept'})` : ''}`;
    (whole || loopOwn ? clear : weak).push({ primitive: id, why });
  }
  if (clear.length === 1) return { covered: clear[0], ambiguous: [] };
  return { covered: null, ambiguous: clear.length ? clear : weak };
}

/**
 * Ask whether one of the ambiguous primitives already implements the mechanic (one strict enum: their ids or "no").
 * @param {{ ask: Ask, registry: RegistryLike, header: string, mechanic: Mechanic, ambiguous: Array<{ primitive: string, why: string }> }} options
 * @returns {Promise<{ covered: { primitive: string, why: string } | null, asked: Asked }>}
 */
export async function askCoverage({ ask, registry, header, mechanic: m, ambiguous }) {
  const options = [...ambiguous.map(a => a.primitive), 'no'];
  const a = await ask({ name: 'covered_by', field: 'pick', options,
    system: 'You build a game from composable primitives. A primitive already in the game may already implement a mechanic through what it declares (its content, its loop verbs and events). Pick the ONE listed primitive that already implements this mechanic as the game needs it, or "no" when none does (a related but different thing is "no").',
    user: `${header}\n\nMechanic ${m.id} (${m.importance}): ${m.description}\n\nAlready in the game:\n${ambiguous.map(x => `- ${x.primitive}: ${oneLine(cardOf(registry, x.primitive)?.intent)} [${x.why}]`).join('\n')}` });
  const asked = { name: 'covered_by', offered: options, pick: a.pick, why: a.why };
  return { covered: a.pick === 'no' ? null : { primitive: a.pick, why: `${a.why || 'the model says it already implements it'} (asked: ${ambiguous.find(x => x.primitive === a.pick)?.why})` }, asked };
}

/** @param {unknown} text */
const oneLine = text => { const s = String(text || '').replace(/\s+/g, ' ').trim(); const dot = s.search(/[.:;](\s|$)/); return (dot > 20 ? s.slice(0, dot) : s).slice(0, 140); };

/**
 * Declaration order for a step's options: an option whose seed card's loop declares the mechanic's verb (or provides
 * it as an action) first, then the catalogue's own order (registry.cards()). Nothing is scored by text.
 * @param {RegistryLike} registry @param {string} verb @returns {(a: { id: string }, b: { id: string }) => number}
 */
export function declarationOrder(registry, verb) {
  const at = new Map(registry.cards().map((c, i) => [c.id, i]));
  const named = (/** @type {string} */ id) => Number(declaresVerb(registry, id, verb));
  return (a, b) => named(b.id) - named(a.id) || (at.get(a.id) ?? Infinity) - (at.get(b.id) ?? Infinity);
}

/** Does a card's loop declare this verb, or the card provide it as an action (whole names)? @param {RegistryLike} registry @param {string} id @param {unknown} verb */
export function declaresVerb(registry, id, verb) {
  const v = nameOf(verb), c = cardOf(registry, id);
  return Boolean(v) && [...(cardLoop(c)?.verbs || []), ...(c?.provides?.actions || [])].some(x => nameOf(x) === v);
}

/**
 * Every valid option for a mechanic (see the header), in declaration order (declarationOrder), and the cards that serve
 * its context but are not valid, with why. `exclude` cards are never offered (already in the collection is fine: re-used).
 * @param {{ registry: RegistryLike, decomposition: Spec, mechanic: Mechanic, mapping: Mapping, state: ReturnType<typeof collectionState>, systems: string[], space: string, adapters: AdapterInstance[], exclude?: Iterable<string> }} options
 * @returns {{ context: string | null, options: Option[], rejected: Array<{ id: string, why: string }> }}
 */
export function validOptions({ registry, decomposition, mechanic: m, mapping, state, systems, space, adapters, exclude = [] }) {
  const context = interactionContext(registry, decomposition, m, mapping);
  const skip = new Set(exclude);
  const fits = registry.cards().filter(c => !isSpace(c.id) && !isGenerator(c.id) && !isGraphics(c.id) && !c.adapts && !skip.has(c.id)).filter(card => {
    const loop = cardLoop(card);
    return Boolean(loop && (loop.verbs.length || loop.progress.length) && servesContext(card, context));
  });
  const order = declarationOrder(registry, m.verb);
  /** @type {Option[]} */
  const ranked = [];
  /** @type {Array<{ id: string, why: string }>} */
  const rejected = [];
  for (const f of fits) {
    const b = formBundle({ registry, seed: f.id, systems, space, adapters, composes: state.composes, resolve: state.resolve, interaction: context });
    if (!b.ok) { rejected.push({ id: f.id, why: b.why }); continue; }
    ranked.push({ id: f.id, score: Number(declaresVerb(registry, f.id, m.verb)), variant: b.variant, members: b.members, extra: b.extra, adapters: b.adapters });
  }
  ranked.sort(order);
  return { context, options: ranked, rejected };
}

/** The category a card belongs to among `ids`: its id namespace (two segments) when another option shares it, else its family. @param {string} id @param {string[]} ids */
const categoryOf = (id, ids) => { const two = id.split('.').slice(0, 2).join('.'); return ids.filter(x => x.startsWith(two + '.') || x === two).length > 1 ? two : id.split('.')[0]; };

/** The option line the model reads: its members (bundleLabel), a one-line intent and its loop verbs. @param {RegistryLike} registry @param {Option} o */
const optionLine = (registry, o) => { const card = cardOf(registry, o.id), loop = cardLoop(card); return `- ${bundleLabel(o)}: ${oneLine(card?.intent)}${loop?.verbs.length ? ` (verbs: ${loop.verbs.join(', ')})` : ''}`; };

const PICK_SYSTEM = 'You build a game from composable primitives, one mechanic at a time. Pick the ONE listed option (by its first id) that implements this mechanic as the game needs it, or "none" when none of them does (a related but different mechanic is "none"). An option written "a + b (why) + ..." is a bundle: the primitive with the companions it only works with; picking it adds them all. Every listed option is valid with the collection so far.';
const SPEC = { spec: { type: 'string', description: 'when pick is "none": what a new primitive must do for this mechanic (its rules, inputs, state, events, how it is won), precise enough to build it; else ""' } };

/**
 * One enum pick over every option (see the header): the option id or "none" with a reason and, for none, what a new
 * primitive must do (spec). A list longer than `max` is narrowed first: one question over the options' categories
 * (their id namespaces), then the pick within the chosen one; "none" within a category asks the category again without it.
 * @param {{ ask: Ask, registry: RegistryLike, header: string, mechanic: Mechanic, options: Option[], problem?: string | null, max?: number }} options
 * @returns {Promise<{ pick: string, why: string, spec: string, asked: Asked[] }>}
 */
export async function pickOption({ ask, registry, header, mechanic: m, options, problem = null, max = MAX_LIST }) {
  /** @type {Asked[]} */
  const asked = [];
  const head = `${header}\n\nMechanic ${m.id} (${m.importance}): ${m.description}`;
  const note = problem ? `\n\n${problem}` : '';
  /** @param {Option[]} list @param {string} more */
  const within = async (list, more) => {
    const ids = list.map(o => o.id);
    const a = await ask({ name: 'pick_primitive', field: 'pick', options: [...ids, 'none'], extra: SPEC, system: PICK_SYSTEM,
      user: `${head}\n\nOptions${more}:\n${list.map(o => optionLine(registry, o)).join('\n')}${note}` });
    asked.push({ name: 'pick_primitive', offered: ids, pick: a.pick, why: a.why });
    return { pick: a.pick, why: a.why, spec: str(prop(a.reply, 'spec')).slice(0, 600) };
  };
  if (options.length <= max) return { ...(await within(options, '')), asked };
  const ids = options.map(o => o.id);
  /** @type {Map<string, Option[]>} */
  const groups = new Map();
  for (const o of options) { const k = categoryOf(o.id, ids); groups.set(k, [...(groups.get(k) || []), o]); }
  /** @type {string[]} */
  const declined = [];
  while (true) {
    const cats = [...groups.keys()].filter(k => !declined.includes(k));
    if (!cats.length) return { pick: 'none', why: `none of ${declined.join(', ')} implements it`, spec: '', asked };
    const a = await ask({ name: 'pick_category', field: 'pick', options: [...cats, 'none'], extra: SPEC,
      system: `${PICK_SYSTEM} There are many options, so first pick the ONE category (an id namespace) whose options may implement this mechanic, or "none" when no category does.`,
      user: `${head}\n\nCategories:\n${cats.map(k => `- ${k} (${groups.get(k)?.length}): ${(groups.get(k) || []).map(o => o.id).join(', ')}`).join('\n')}${declined.length ? `\n\nNone of ${declined.join(', ')} implements it.` : ''}${note}` });
    asked.push({ name: 'pick_category', offered: cats, pick: a.pick, why: a.why });
    if (a.pick === 'none') return { pick: 'none', why: a.why, spec: str(prop(a.reply, 'spec')).slice(0, 600), asked };
    const r = await within(groups.get(a.pick) || [], ` in ${a.pick}`);
    if (r.pick !== 'none') return { ...r, asked };
    declined.push(a.pick);
  }
}

/** Owners from mapped mechanics (a selection's mechanics or a build mapping). @param {Array<{ id: string, primitives?: string[] }>} mechanics @returns {Map<string, Set<string>>} */
export function ownersOf(mechanics) {
  /** @type {Map<string, Set<string>>} */
  const out = new Map();
  for (const m of mechanics) for (const id of m.primitives || []) out.set(id, new Set([...(out.get(id) || []), m.id]));
  return out;
}

