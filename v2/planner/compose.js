// @ts-check
// Template composition for mashups (ARCHITECTURE.md §1.3, §5): nested and union, derived from declarations alone.
//
//   prefix   one template's document with every id it defines prefixed (spaces, zones, instance ids, the entries of
//            every section a reference kind indexes: the kernel's base kinds and card.defines `at`, story beats) and
//            every reference to them rewritten. A reference is what the cards declare as one, the same reading the
//            preflight and the content forms use: a param, component or data field `{ type: 'ref', to }`, a string
//            field whose declaration names the section its values are ids of (content.js referenceOf), the fields an
//            effect's or predicate's `refs` declaration reads (found by probing that declaration, never by value),
//            and the kernel's player fields. Ids a primitive defines inside its own instance (card.defines `in`: spawn
//            rules, turn actions, counters) are that instance's and keep their names.
//   merge    the prefixed document appended to another: spaces (a nested inner keeps its own), systems (a primitive
//            both use is one instance: list params joined, equal values kept, a conflicting value is a problem; a
//            primitive that owns a whole loop, card.mode, cannot carry two loops in one instance), content and plot
//            sections joined, the player the host's (the added document's player when the host has none).
//   nested   the inner loop (the inner template's loops that declare card.loop.outcome and card.engage.encounter) is
//            entered on an event the outer loop declares the participants of (card.loop.involves), the roles bound
//            from that declaration; engine.adapt.nested is configured from the inner card (start, encounter config,
//            the outcome events its result params emit: presets.js wireOutcomes) and the outer document (what a
//            defeat does and who is on the player's side: presets.js configureEncounters); the inner loop's results
//            end the encounter, never the game. A skin (engine.adapt.skin) maps the inner concept's content section
//            onto the outer loop's content contract when declarations decide it (presets.js skinSections).
//   union    the secondary's systems re-homed onto the primary's space and its content merged; its space (and the
//            world its generators build there) is the primary's; a list of zone references is re-bound to the zones of
//            the space its loop now runs on; the game's win is the primary's. The result composes only when the
//            composition check passes, else it fails with the adapter compose-check names (adapterSignature).
//
// Every problem has a stable code (COMPOSE_RULES). Nothing here names a primitive, a template or a pair.
import { cardLoop } from './loop.js';
import { modesIn } from '../primitives/gameplay/modes-lib-mode.js';
import { definedSections, sectionOfKind, referenceOf, declaredAt, contractsOf, ZONES, SECTIONS } from './content.js';
import { declaredOutcomes, wireOutcomes, configureInner, configureEncounters, skinSections } from './presets.js';
import { checkComposition } from './compose-check.js';
import { adaptersFor, adapterInstanceId, uniqueId, instanceIds, applySkins } from './adapters.js';
import { isObj, isStr, list, objects, prop } from '../kernel/guards.js';

/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** @typedef {import('../kernel/types.js').LogicLike} LogicLike */
/** @typedef {{ code: string, path: string, message: string, signature?: unknown }} ComposeProblem */
/** @typedef {{ id: string, doc: Record<string, any> }} Part */

export const COMPOSE_VERSION = 'compose/0.1';
/** Every problem code composition emits. */
export const COMPOSE_RULES = Object.freeze({
  compose_prefix_invalid: 'a prefixed id is a lowercase slug of at most 64 characters',
  compose_loop_shared: 'a primitive that owns a whole loop (card.mode) is used by both documents: one instance carries one loop',
  compose_param_conflict: 'a primitive both documents use is one instance, and they set one of its values differently',
  compose_id_collision: 'two entries with one id in a section or list param the documents share',
  nested_no_entry: 'the outer loops declare no event naming enough participants to enter the inner loop on (card.loop.involves)',
  nested_entry_ambiguous: 'the outer loop declares several entry events at the same precedence: the pick must choose one',
  nested_no_inner: 'the inner template has no loop that declares an encounter outcome (card.loop.outcome) and how an encounter starts it (card.engage.encounter.start)',
  nested_unwired: 'an inner result or an outer effect of the encounter cannot be derived from the declarations',
  union_zone_unbound: 'a reference to a zone of the secondary\'s space has no zone on the primary\'s space to re-bind to',
  union_needs_adapter: 'the united loops do not compose on the primary\'s space: the composition check names the adapter that would fix it',
});

const PROBE = '\u0001ref';
const UNBOUND = '\u0002zone:';
const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** @param {string} code @param {string} path @param {string} message @returns {ComposeProblem} */
const problem = (code, path, message) => ({ code, path, message });
/** The value at a dotted section path. @param {unknown} doc @param {string} path */
const at = (doc, path) => path.split('.').reduce((/** @type {any} */ o, k) => (o == null ? undefined : o[k]), doc);
/** The prefix of a template's ids ('creature-battle' -> 'creature_battle_'). @param {string} id */
export const prefixOf = id => `${id.replace(/[^a-z0-9]+/g, '_')}_`;

/** The domain (renaming map) a reference kind's ids live in. @param {RegistryLike} registry @param {unknown} kind @returns {string | null} */
function domainOfKind(registry, kind) {
  if (kind === 'zone') return ZONES;
  if (kind === 'space') return 'spaces';
  if (kind === 'beat') return 'beats';
  return isStr(kind) ? sectionOfKind(registry, kind) : null;
}

/** The ids a document defines, by domain: spaces, zones, instance ids, beats, and every indexed section's entries. @param {Record<string, any>} doc @param {RegistryLike} registry */
export function definedIds(doc, registry) {
  /** @type {Map<string, string[]>} */
  const out = new Map();
  const add = (/** @type {string} */ d, /** @type {unknown} */ id) => { if (isStr(id)) out.set(d, [...(out.get(d) || []), id]); };
  for (const s of objects(doc.spaces)) { add('spaces', s.id); for (const z of objects(s.zones)) add(ZONES, z.id); for (const g of objects(s.generators)) add('instances', g.id); }
  for (const s of [...objects(doc.systems), ...objects(doc.graphics)]) { add('instances', s.id); if (registry.get(String(s.use))?.card.adapts?.subspace) add('spaces', s.id); }
  for (const a of objects(doc.plot?.storyboard?.acts)) for (const b of objects(a.beats)) add('beats', b.id);
  for (const section of definedSections(registry)) {
    const v = at(doc, section);
    if (Array.isArray(v)) for (const e of objects(v)) add(section, e.id);
    else if (isObj(v)) for (const k of Object.keys(v)) add(section, k);
  }
  return out;
}

/**
 * A walker over a document that rewrites every declared reference through `ref(domain, id)`; `list(domain, values)`
 * may re-bind a whole list of references of one domain. Mutates the document it walks.
 * @param {{ registry: RegistryLike, logic: LogicLike, doc: Record<string, any>, ref: (domain: string, id: string) => string, list?: (domain: string, values: string[]) => string[] }} w
 */
function walker(w) {
  const { registry, logic } = w;
  /** @param {unknown} spec @param {unknown} v @returns {unknown} */
  const value = (spec, v) => {
    if (v === undefined || v === null || !isObj(spec)) return v;
    if (spec.type === 'ref') { const d = domainOfKind(registry, spec.to); return d && isStr(v) ? w.ref(d, v) : v; }
    if (spec.type === 'string') { const d = referenceOf(registry, spec); return d && d !== SECTIONS && isStr(v) ? w.ref(d, v) : v; }
    if (spec.type === 'list') {
      if (!Array.isArray(v)) return v;
      const of = isObj(spec.of) ? spec.of : null;
      const d = of?.type === 'ref' ? domainOfKind(registry, of.to) : (!of || of.type === 'string') ? referenceOf(registry, spec) : null;
      if (d && d !== SECTIONS) { const out = v.map(x => (isStr(x) ? w.ref(d, x) : x)); return w.list && out.every(isStr) ? w.list(d, /** @type {string[]} */ (out)) : out; }
      return v.map(x => value(of, x));
    }
    if (spec.type === 'object') return isObj(v) && isObj(spec.fields) ? fields(spec.fields, v) : v;
    if (spec.type === 'effects') { list(v).forEach(effect); return v; }
    if (spec.type === 'predicate') { predicate(v); return v; }
    return v;
  };
  /** @param {Record<string, unknown>} specs @param {Record<string, any>} v */
  const fields = (specs, v) => { for (const k of Object.keys(specs)) if (k in v) v[k] = value(specs[k], v[k]); return v; };
  /** String leaves of a JSON value: [path keys]. @param {unknown} v @param {Array<string | number>} keys @param {Array<Array<string | number>>} out */
  const leaves = (v, keys = [], out = []) => {
    if (isStr(v)) out.push(keys);
    else if (Array.isArray(v)) v.forEach((x, i) => leaves(x, [...keys, i], out));
    else if (isObj(v)) for (const [k, x] of Object.entries(v)) leaves(x, [...keys, k], out);
    return out;
  };
  const setAt = (/** @type {any} */ o, /** @type {Array<string | number>} */ keys, /** @type {unknown} */ x) => { const last = keys[keys.length - 1]; keys.slice(0, -1).reduce((p, k) => p[k], o)[last] = x; };
  const getAt = (/** @type {any} */ o, /** @type {Array<string | number>} */ keys) => keys.reduce((p, k) => p?.[k], o);
  /** Rewrite the fields a refs declaration reads: each string leaf the declaration reports as a reference of a kind. @param {any} def @param {Record<string, any>} x @param {string} skip */
  const probe = (def, x, skip) => {
    if (typeof def?.refs !== 'function') return;
    for (const keys of leaves(x).filter(k => k[0] !== skip)) {
      const trial = structuredClone(x); setAt(trial, keys, PROBE);
      /** @type {unknown} */
      let pairs = [];
      try { pairs = def.refs(trial); } catch { pairs = []; }
      const kind = list(pairs).map(p => (Array.isArray(p) && p[1] === PROBE ? p[0] : null)).find(isStr);
      const d = kind ? domainOfKind(registry, kind) : null;
      if (d) { const cur = getAt(x, keys); if (isStr(cur)) setAt(x, keys, w.ref(d, cur)); }
    }
  };
  // Nested effects and predicates are the ones a declaration's own check walks (ctx.checkEffect / ctx.checkPredicate).
  const nest = { doc: w.doc, registry, warn() {}, noteRef() {}, provides: { events: new Set(), vars: new Set(), services: new Set() },
    checkEffect: (/** @type {unknown} */ e) => effect(e), checkPredicate: (/** @type {unknown} */ p) => predicate(p) };
  /** @param {unknown} e */
  function effect(e) {
    if (!isObj(e)) return;
    const def = /** @type {any} */ (logic).effects?.get(e.do);
    probe(def, e, 'do');
    try { def?.check?.(e, '', [], nest); } catch { /* a malformed effect is preflight's to report */ }
  }
  /** @param {unknown} p */
  function predicate(p) {
    if (!isObj(p)) return;
    const kind = logic.kindOf(p), def = kind ? /** @type {any} */ (logic).predicates?.get(kind) : null;
    probe(def, p, '');
    try { def?.check?.(p, '', [], nest); } catch { /* preflight reports it */ }
  }
  /** A component's declared shape (the card that owns it: card.components). @param {string} c */
  const componentSpec = c => registry.cards().map(card => prop(card.components, c)).find(isObj) ?? null;
  return {
    /** @param {Record<string, any>} inst */
    instance(inst) { const card = registry.get(String(inst.use))?.card; if (card && isObj(inst.with)) fields(card.params || {}, inst.with); },
    /** @param {Record<string, any>} a */
    archetype(a) { if (isObj(a.components)) for (const [c, v] of Object.entries(a.components)) { const spec = componentSpec(c); if (spec) a.components[c] = value(spec, v); } },
    /** @param {string} root @param {string} key */
    section(root, key) { const spec = declaredAt(registry, [root, key]); const v = w.doc[root]?.[key]; if (spec && v !== undefined) w.doc[root][key] = value(spec, v); },
  };
}

/**
 * Rewrite a document's declared references (and rename what it defines) through per-domain maps. Mutates `doc`.
 * @param {Record<string, any>} doc @param {{ registry: RegistryLike, logic: LogicLike, rename: (domain: string, id: string) => string, define?: (domain: string, id: string) => string, list?: (domain: string, values: string[]) => string[] }} o
 */
function rewrite(doc, { registry, logic, rename, define = rename, list: relist }) {
  const w = walker({ registry, logic, doc, ref: rename, list: relist });
  const def = (/** @type {string} */ d, /** @type {unknown} */ id) => (isStr(id) ? define(d, id) : id);
  for (const s of objects(doc.spaces)) {
    w.instance(s);
    for (const g of objects(s.generators)) { w.instance(g); if (isStr(g.id)) g.id = def('instances', g.id); }
    for (const z of objects(s.zones)) z.id = def(ZONES, z.id);
    s.id = def('spaces', s.id);
  }
  for (const s of [...objects(doc.systems), ...objects(doc.graphics)]) {
    w.instance(s);
    if (isStr(s.space)) s.space = rename('spaces', s.space);
    if (isStr(s.id)) s.id = def(registry.get(String(s.use))?.card.adapts?.subspace ? 'spaces' : 'instances', s.id);
  }
  for (const a of objects(doc.content?.archetypes)) w.archetype(a);
  for (const root of ['content', 'plot']) for (const key of Object.keys(isObj(doc[root]) ? doc[root] : {})) w.section(root, key);
  for (const a of objects(doc.plot?.storyboard?.acts)) for (const b of objects(a.beats)) b.id = def('beats', b.id);
  for (const section of definedSections(registry)) {
    const [root, key] = section.split('.'), v = doc[root]?.[key];
    if (Array.isArray(v)) for (const e of objects(v)) e.id = def(section, e.id);
    else if (isObj(v)) doc[root][key] = Object.fromEntries(Object.entries(v).map(([k, x]) => [def(section, k), x]));
  }
  // The kernel's player: an archetype, the space it starts in, and a zone when it starts at one.
  if (isObj(doc.player)) {
    if (isStr(doc.player.archetype)) doc.player.archetype = rename(String(sectionOfKind(registry, 'archetype')), doc.player.archetype);
    if (isStr(doc.player.space)) doc.player.space = rename('spaces', doc.player.space);
    if (isStr(doc.player.at)) doc.player.at = rename(ZONES, doc.player.at);
  }
  return doc;
}

/**
 * A document with every id it defines prefixed and every declared reference to them rewritten (see the header).
 * -> { doc, renamed (domain -> old -> new), problems }
 * @param {Record<string, any>} input @param {string} prefix @param {{ registry: RegistryLike, logic: LogicLike }} cat
 */
export function prefixDocument(input, prefix, { registry, logic }) {
  const doc = structuredClone(input);
  const ids = definedIds(doc, registry);
  /** @type {Map<string, Map<string, string>>} */
  const renamed = new Map([...ids].map(([d, list]) => [d, new Map(list.map(id => [id, `${prefix}${id}`]))]));
  /** @type {ComposeProblem[]} */
  const problems = [];
  for (const [d, m] of renamed) for (const id of m.values()) if (!SLUG.test(id)) problems.push(problem('compose_prefix_invalid', d, `'${id}' is not a lowercase slug of at most 64 characters`));
  rewrite(doc, { registry, logic, rename: (d, id) => renamed.get(d)?.get(id) ?? id });
  return { doc, renamed, problems };
}

/** Deep equality of JSON values. @param {unknown} a @param {unknown} b */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * One instance's config joined with another's for a primitive both documents use: a value one side leaves out is the
 * other's, equal values are kept, lists (and effects) are joined (entries with an id must not collide), objects with
 * declared fields join field by field, and anything else that differs is a conflict. `space`: the added side's host
 * space, written on its list entries that declare a space field and leave it out (they keep where they spawn).
 * @param {Record<string, any>} params @param {Record<string, any>} a @param {Record<string, any>} b @param {string} path @param {ComposeProblem[]} problems @param {string | null} space
 */
function joinConfig(params, a, b, path, problems, space) {
  /** @type {Record<string, any>} */
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const spec = params?.[k], cur = out[k];
    if (cur === undefined) { out[k] = structuredClone(v); continue; }
    if (same(cur, v)) continue;
    if (Array.isArray(cur) && Array.isArray(v)) {
      const of = isObj(spec?.of) ? spec.of : null;
      const own = of?.type === 'object' && prop(prop(of.fields, 'space'), 'type') === 'ref' && space ? v.map(x => (isObj(x) && x.space === undefined ? { ...x, space } : x)) : v;
      const ids = cur.map(x => prop(x, 'id')).filter(isStr);
      for (const x of own) if (isStr(prop(x, 'id')) && ids.includes(String(prop(x, 'id')))) problems.push(problem('compose_id_collision', `${path}.${k}`, `both documents have an entry '${prop(x, 'id')}' in ${path}.${k}`));
      out[k] = [...cur, ...structuredClone(own)];
      continue;
    }
    if (isObj(cur) && isObj(v) && isObj(spec?.fields)) { out[k] = joinConfig(spec.fields, cur, v, `${path}.${k}`, problems, space); continue; }
    problems.push(problem('compose_param_conflict', `${path}.${k}`, `the documents set ${path}.${k} to ${JSON.stringify(cur).slice(0, 80)} and ${JSON.stringify(v).slice(0, 80)}`));
  }
  return out;
}

/**
 * Append a (prefixed) document to a host document: see the header. `keepSpaces`: the added document's spaces join the
 * host's (nested); otherwise they were re-homed onto the host's (union). `bind`: the space the added systems are bound
 * to when they name none (the added document's own first space, which is no longer the document's first).
 * @param {Record<string, any>} host @param {Record<string, any>} add @param {{ registry: RegistryLike, keepSpaces: boolean, bind: string | null }} o
 * @returns {{ doc: Record<string, any>, problems: ComposeProblem[] }}
 */
export function mergeDocuments(host, add, { registry, keepSpaces, bind }) {
  const doc = structuredClone(host);
  /** @type {ComposeProblem[]} */
  const problems = [];
  if (keepSpaces) doc.spaces = [...objects(doc.spaces), ...structuredClone(objects(add.spaces))];
  doc.systems = objects(doc.systems);
  for (const s of objects(add.systems)) {
    const card = registry.get(String(s.use))?.card;
    const twin = card?.adapts ? null : doc.systems.find((/** @type {Record<string, any>} */ x) => x.use === s.use);
    const placed = { ...structuredClone(s), ...(bind && s.space === undefined && !card?.adapts ? { space: bind } : {}) };
    if (!twin) { doc.systems.push(placed); continue; }
    if (card?.mode) { problems.push(problem('compose_loop_shared', `systems[${doc.systems.indexOf(twin)}]`, `${s.use} carries a loop of each document (card.mode); one instance carries one loop (its state is keyed by its primitive id)`)); continue; }
    if ((twin.space ?? null) !== (placed.space ?? null) && !list(card?.params ? Object.values(card.params) : []).some(p => isObj(p) && isObj(p.of) && prop(prop(p.of.fields, 'space'), 'type') === 'ref'))
      problems.push(problem('compose_param_conflict', `systems[${doc.systems.indexOf(twin)}].space`, `${s.use} runs on '${twin.space ?? doc.spaces[0]?.id}' in one document and '${placed.space}' in the other`));
    twin.with = joinConfig(card?.params || {}, isObj(twin.with) ? twin.with : {}, isObj(s.with) ? s.with : {}, `systems[${doc.systems.indexOf(twin)}].with`, problems, bind);
  }
  for (const root of ['content', 'plot']) {
    const from = isObj(add[root]) ? add[root] : {};
    doc[root] = isObj(doc[root]) ? doc[root] : {};
    for (const [k, v] of Object.entries(from)) {
      if (root === 'plot' && k === 'premise') continue;
      const cur = doc[root][k];
      if (cur === undefined) { doc[root][k] = structuredClone(v); continue; }
      if (Array.isArray(cur) && Array.isArray(v)) {
        const ids = new Set(cur.map(x => prop(x, 'id')).filter(isStr));
        for (const x of v) if (isStr(prop(x, 'id')) && ids.has(String(prop(x, 'id')))) problems.push(problem('compose_id_collision', `${root}.${k}`, `both documents define '${prop(x, 'id')}' in ${root}.${k}`));
        doc[root][k] = [...cur, ...structuredClone(v)];
      } else if (isObj(cur) && isObj(v)) {
        for (const [id, x] of Object.entries(v)) {
          if (cur[id] !== undefined && !same(cur[id], x)) problems.push(problem('compose_param_conflict', `${root}.${k}.${id}`, `the documents define ${root}.${k}.${id} differently`));
          else cur[id] = structuredClone(x);
        }
      } else if (!same(cur, v)) problems.push(problem('compose_param_conflict', `${root}.${k}`, `the documents define ${root}.${k} differently`));
    }
    if (!Object.keys(doc[root]).length) delete doc[root];
  }
  // The added document's player starts where it did: its own first space, unless it names one.
  if (!doc.player && isObj(add.player)) doc.player = { ...structuredClone(add.player), ...(add.player.space === undefined && keepSpaces && isStr(objects(add.spaces)[0]?.id) ? { space: objects(add.spaces)[0].id } : {}) };
  return { doc, problems };
}

/** The loop primitives (card.mode) a document plays, as its cards declare them. @param {Record<string, any>} doc @param {RegistryLike} registry */
const playedLoops = (doc, registry) => [...new Set(modesIn(doc, registry).filter(m => !m.mode.wraps).map(m => String(m.use)))];
/** Every instance of a document (systems, spaces, generators). @param {Record<string, any>} doc */
const instancesOf = doc => [...objects(doc.systems), ...objects(doc.spaces), ...objects(doc.spaces).flatMap(s => objects(s.generators))];

/**
 * The events a nested loop can be entered on from a document, as its loops declare them (card.loop.involves): events
 * the loop provides or counts as progress that name at least `sides` participants. The loops the template is played
 * with (card.mode) come first; the document's other loops only when those declare none. -> [{ event, use, roles }]
 * @param {Record<string, any>} doc @param {RegistryLike} registry @param {number} [sides]
 */
export function entryTriggers(doc, registry, sides = 1) {
  const of = (/** @type {string[]} */ uses) => uses.flatMap(use => {
    const card = registry.get(use)?.card, loop = cardLoop(card);
    return Object.entries(loop?.involves || {}).filter(([event, roles]) => (loop?.progress.includes(event) || (card?.provides?.events || []).includes(event)) && Object.keys(roles).length >= sides)
      .map(([event, roles]) => ({ event, use, roles: { ...roles } }));
  });
  const played = playedLoops(doc, registry);
  const first = of(played);
  return first.length ? first : of([...new Set(instancesOf(doc).map(i => String(i.use)))].filter(u => !played.includes(u)));
}

/** The loops of a template that an encounter can enter: they declare an outcome and how an encounter starts them. @param {Record<string, any>} doc @param {RegistryLike} registry */
export const innerLoops = (doc, registry) => playedLoops(doc, registry).filter(u => {
  const card = registry.get(u)?.card;
  return Boolean(cardLoop(card)?.outcome) && list(card?.engage?.encounter?.start).length > 0;
});

/** The effects a param holds on an instance, with the game's end taken out (an inner result ends the encounter). @param {Record<string, any>} inst @param {string} param */
function endsEncounter(inst, param) {
  const [p, field] = param.split('.');
  const strip = (/** @type {unknown} */ v) => list(v).filter(e => prop(e, 'do') !== 'end_game');
  inst.with = isObj(inst.with) ? inst.with : {};
  if (field) inst.with[p] = objects(inst.with[p]).map(x => ({ ...x, [field]: strip(x[field]) }));
  else inst.with[p] = strip(inst.with[p]);
}

/**
 * Nested composition: `inner` entered from `outer` (both template parts). -> { doc, problems, nested } with the
 * engine.adapt.nested instance (and the skin, when declared) added and configured.
 * @param {Part} outer @param {Part} inner @param {{ registry: RegistryLike, logic: LogicLike }} cat
 */
export function composeNested(outer, inner, { registry, logic }) {
  /** @type {ComposeProblem[]} */
  const problems = [];
  const fail = (/** @type {ComposeProblem[]} */ p) => ({ doc: null, problems: [...problems, ...p], nested: null });
  const loops = innerLoops(inner.doc, registry);
  if (!loops.length) return fail([problem('nested_no_inner', inner.id, `'${inner.id}' plays ${playedLoops(inner.doc, registry).join(', ') || 'no loop'}; none declares an encounter outcome (card.loop.outcome) and an encounter start (card.engage.encounter.start)`)]);
  const sides = Math.max(...loops.map(u => cardLoop(registry.get(u)?.card)?.outcome?.sides.length || 1));
  const triggers = entryTriggers(outer.doc, registry, sides);
  if (!triggers.length) return fail([problem('nested_no_entry', outer.id, `no loop of '${outer.id}' declares an event naming ${sides} participants (card.loop.involves) to enter ${loops.join(', ')} on`)]);
  const byUse = new Set(triggers.map(t => t.use));
  if (triggers.length > 1) return fail([problem('nested_entry_ambiguous', outer.id, `'${outer.id}' declares ${triggers.map(t => `${t.event} (${t.use})`).join(', ')} at one precedence${byUse.size > 1 ? ' across loops' : ''}: which one enters '${inner.id}' is a choice`)]);
  const trigger = triggers[0];
  const p = prefixDocument(inner.doc, prefixOf(inner.id), { registry, logic });
  problems.push(...p.problems);
  const first = objects(p.doc.spaces)[0]?.id, own = isStr(first) ? first : null;
  // The inner keeps its own space when its loop declares the spaces it plays on and that space is one of them.
  const merged = mergeDocuments(outer.doc, p.doc, { registry, keepSpaces: true, bind: own });
  problems.push(...merged.problems);
  const doc = merged.doc;
  const id = prefixOf(inner.id).slice(0, -1).slice(0, 40);
  // The inner loops wait for the encounter (card.engage.encounter.config) and their results end it, not the game.
  configureInner(registry, /** @type {any} */ (doc.systems));
  for (const u of loops) {
    const inst = doc.systems.find((/** @type {any} */ s) => s.use === u), o = cardLoop(registry.get(u)?.card)?.outcome;
    if (inst && o) for (const r of Object.values(o.results)) if (registry.get(u)?.card.params?.[r.param.split('.')[0]]) endsEncounter(inst, r.param);
  }
  const wired = wireOutcomes(registry, /** @type {any} */ (doc.systems), { id, inner: loops });
  const declared = declaredOutcomes(registry, { id, inner: loops });
  for (const m of [...wired.problems, ...declared.problems]) problems.push(problem('nested_unwired', 'systems', m));
  const use = adaptersFor(registry, 'nested')[0];
  if (!use) return fail([problem('nested_unwired', 'systems', 'no registered adapter declares the nested relation (card.adapts.relation)')]);
  // Participants are carried into an inner loop on a space of its own when it is played by participants.
  const innerSpace = loops.map(u => doc.systems.find((/** @type {any} */ s) => s.use === u)?.space).find(isStr) ?? null;
  const outerSpace = doc.systems.find((/** @type {any} */ s) => s.use === trigger.use)?.space ?? doc.spaces[0]?.id;
  const participants = loops.some(u => { const c = registry.get(u)?.card; return Boolean(cardLoop(c)?.needs.participants || c?.engage?.participants?.param); });
  const carry = innerSpace && innerSpace !== outerSpace && participants ? Object.keys(trigger.roles).map(role => ({ role })) : [];
  /** @type {Record<string, any>} */
  const w = { id, on: trigger.event, roles: trigger.roles, inner: [...loops], start: loops.flatMap(u => structuredClone(list(registry.get(u)?.card.engage?.encounter?.start))),
    outcomes: declared.outcomes.filter(o => wired.wired.includes(o.on)), ...(carry.length ? { space: innerSpace, carry } : {}) };
  const taken = new Set(instanceIds(doc));
  doc.systems.push({ use, id: uniqueId(adapterInstanceId(registry, { use, with: w }, String(doc.spaces[0]?.id ?? 'world')), taken), with: w });
  for (const m of configureEncounters(doc, registry, [{ id, outer: trigger.use }])) problems.push(problem('nested_unwired', 'systems', m));
  const skin = skinFor(doc, registry, { owners: [...new Set([trigger.use, ...playedLoops(outer.doc, registry)])], joined: [...new Set(objects(inner.doc.systems).map(s => String(s.use)))], taken });
  const out = skin ? applySkins(/** @type {any} */ (doc), registry) : doc;
  return { doc: problems.length ? null : out, problems, nested: { id, on: trigger.event, use: trigger.use, inner: loops, skin: skin ? skin.with.maps.map((/** @type {any} */ m) => ({ from: m.from, to: m.to })) : [] } };
}

/**
 * The skin adapter instance a nested composition adds when declarations decide it (presets.js skinSections): the
 * inner concept's content section with entries maps onto the outer loop's content contract. Onto archetypes, each
 * archetype carrying the contract's component (the outer loop's pieces) stands for a source entry, in order: it keeps
 * its own fields and records which entry it stands for (components.skin). Mutates `doc`; -> the instance or null.
 * @param {Record<string, any>} doc @param {RegistryLike} registry @param {{ owners: string[], joined: string[], taken: Set<string> }} o
 */
function skinFor(doc, registry, { owners, joined, taken }) {
  const use = adaptersFor(registry, 'skin')[0];
  const sections = skinSections(registry, owners, joined);
  const from = sections.from.find(s => objects(at(doc, s)).length > 0);
  if (!use || !sections.to || !from) return null;
  const source = objects(at(doc, from));
  /** @type {Record<string, any>} */
  const map = { from, to: sections.to };
  if (sections.to === 'content.archetypes') {
    const component = owners.flatMap(o => contractsOf(registry, o)).find(c => c.need === 'archetypes' && c.component)?.component;
    const pieces = objects(doc.content?.archetypes).filter(a => component && isObj(a.components) && a.components[component] !== undefined);
    if (!pieces.length) return null;
    map.pairs = pieces.map((a, i) => ({ from: String(source[i % source.length].id), to: String(a.id) }));
  }
  const inst = { use, id: uniqueId(adapterInstanceId(registry, { use, space: String(doc.spaces[0]?.id), with: {} }), taken), space: String(doc.spaces[0]?.id), with: { maps: [map] } };
  doc.systems.push(inst);
  return inst;
}

/**
 * The united document: `secondary` re-homed onto `primary`'s space and merged (see the header), before the composition
 * check. -> { doc, problems, loops (the secondary's loops) }
 * @param {Part} primary @param {Part} secondary @param {{ registry: RegistryLike, logic: LogicLike }} cat
 */
export function uniteDocuments(primary, secondary, { registry, logic }) {
  /** @type {ComposeProblem[]} */
  const problems = [];
  const host = objects(primary.doc.spaces)[0];
  const hostZones = objects(host?.zones).map(z => String(z.id));
  const prefix = prefixOf(secondary.id);
  const doc2 = structuredClone(secondary.doc);
  const ids = definedIds(doc2, registry);
  const own = { spaces: new Set(ids.get('spaces') || []), zones: new Set(ids.get(ZONES) || []) };
  // Re-homing: its spaces are the host; its zones have no place there until a list of them is re-bound to the host's.
  const rename = (/** @type {string} */ d, /** @type {string} */ id) => (d === 'spaces' && own.spaces.has(id) ? String(host?.id) : d === ZONES && own.zones.has(id) ? `${UNBOUND}${id}` : (ids.get(d) || []).includes(id) ? `${prefix}${id}` : id);
  const relist = (/** @type {string} */ d, /** @type {string[]} */ v) => (d === ZONES && v.length && v.every(x => x.startsWith(UNBOUND)) && hostZones.length ? [...hostZones] : v);
  rewrite(doc2, { registry, logic, rename, define: (d, id) => (d === 'spaces' || d === ZONES ? id : `${prefix}${id}`), list: relist });
  const unbound = JSON.stringify(doc2).match(new RegExp(`${UNBOUND}[a-z0-9_-]+`, 'g')) || [];
  for (const z of [...new Set(unbound)]) problems.push(problem('union_zone_unbound', z.slice(UNBOUND.length), `'${secondary.id}' refers to its zone '${z.slice(UNBOUND.length)}', which has no counterpart on '${primary.id}''s space '${host?.id}'`));
  // The secondary's world is the primary's: its spaces (with their generators) are re-homed onto the host.
  doc2.spaces = [];
  // The game's win is the primary's: the secondary's game-ending win ends nothing.
  for (const u of playedLoops(doc2, registry)) {
    const win = cardLoop(registry.get(u)?.card)?.win, inst = doc2.systems.find((/** @type {any} */ s) => s.use === u);
    if (inst && win?.param && registry.get(u)?.card.params?.[win.param.split('.')[0]]) endsEncounter(inst, win.param);
  }
  for (const s of objects(doc2.systems)) if (s.space === host?.id) delete s.space;
  const merged = mergeDocuments(primary.doc, doc2, { registry, keepSpaces: false, bind: null });
  problems.push(...merged.problems);
  return { doc: merged.doc, problems, loops: playedLoops(doc2, registry) };
}

/**
 * Union composition: `secondary`'s loops on `primary`'s space (see the header). -> { doc, problems, union }; a union
 * that does not compose has no document, and `united` is the document the composition check was asked about.
 * @param {Part} primary @param {Part} secondary @param {{ registry: RegistryLike, logic: LogicLike }} cat
 */
export function composeUnion(primary, secondary, { registry, logic }) {
  const u = uniteDocuments(primary, secondary, { registry, logic });
  const host = objects(primary.doc.spaces)[0];
  const problems = [...u.problems];
  if (problems.length) return { doc: null, problems, union: null, united: u.doc };
  const merged = u;
  const check = checkComposition(merged.doc, registry, { logic });
  if (check.failures.length) {
    const sig = check.signature;
    problems.push({ ...problem('union_needs_adapter', 'systems', `'${secondary.id}' on '${primary.id}''s space ${host?.use}: ${check.failures.slice(0, 4).map(f => `[${f.code}] ${f.message}`).join('; ')}${sig ? `; the adapter that would fix it: ${sig.id} (${JSON.stringify(sig.card.adapts.provides)})` : ''}`), ...(sig ? { signature: sig } : {}) });
    return { doc: null, problems, union: null, united: u.doc };
  }
  return { doc: merged.doc, problems, union: { space: host?.id, loops: u.loops }, united: u.doc };
}
