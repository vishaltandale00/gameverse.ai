// @ts-check
// Adapter resolution (ARCHITECTURE.md §1.3, §5): concepts that don't natively fit are combined through adapters,
// never by swapping the world or dropping the mechanic. When the static composition check says a space lacks
// capabilities, content or services (incompatible-needs-adapter), resolveAdapters looks up the registered
// adapters whose card.adapts fits that space and covers what it lacks, from their declarations alone, and returns
// the adapter instances to add (with their configuration, from the adapter's adapt() hook) plus the bindings
// that move the needy primitives onto an adapter's region. The composition then checks compatible-via-adapter.
// When nothing registered fits, the gap is the adapterSignature of the adapter that would (the pipeline's gap
// layer may write it).
//
// Selection call site (select.js, owned elsewhere): for an unmet primitive `u` before it becomes a gap,
//     const r = resolveAdapters({ spaces, systems: [...chosen, u.id], bind }, registry);
//     if (r.verdict === 'compatible-via-adapter') { chosen.add(u.id); Object.assign(bind, r.bind); adapters.push(...r.adapters); }
//     else gaps.push(...r.gaps.map(adapter => ({ mechanic, kind: 'adapter', adapter, ... })));
// and the selection carries `adapters` (instances: { use, id, space, with }; the id from the adapt() hook, else from the
// adapter's declaration: adapterInstanceId) for the outline/preset stage to
// write into doc.systems. A document works too: resolveAdapters(doc, registry).composition is the document with
// the instances appended to systems and the needy instances re-bound (instance.space) to the region.
import { checkComposition, compositionSpaces, adapterFits, adapterSignature } from './compose-check.js';
import { Registry } from '../kernel/registry.js';
import { mashupSides } from './play-spec.js';

/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** @typedef {import('../kernel/types.js').RegisteredPrimitive} RegisteredPrimitive */
/** @typedef {import('../kernel/types.js').Card} Card */
/** @typedef {import('../kernel/types.js').Doc} Doc */
/** @typedef {import('./compose-check.js').Selection} Selection */
/** @typedef {import('./compose-check.js').CompositionResult} CompositionResult */
/** @typedef {import('./compose-check.js').CheckOptions} CheckOptions */
/** @typedef {import('./compose-check.js').AdapterSpec} AdapterSpec */
/** @typedef {import('./compose-check.js').AdapterInstance} AdapterInstance */
/** @typedef {{ capabilities: string[], content: string[], services: string[] }} Needs */
/**
 * @typedef {object} AdapterResolution
 * @property {CompositionResult['verdict']} verdict  compatible-via-adapter when every lack is adapted
 * @property {Array<AdapterInstance & { space: string, with: Record<string, any> }>} adapters  instances to add
 * @property {Record<string, string>} bind  primitive id -> region space id (primitives moved onto an adapter's region)
 * @property {AdapterSpec[]} gaps  adapters that would be needed but are not registered (adapterSignature)
 * @property {Doc | Selection} composition  the input with the adapters added and the bindings applied
 * @property {CompositionResult} before  the verdict without adapters
 * @property {CompositionResult} result  the verdict with them
 * @property {number} ms
 */

export const ADAPTERS_VERSION = 'adapters/0.1';
const KINDS = /** @type {const} */ (['capabilities', 'content', 'services']);
/** @param {unknown} v @returns {v is Record<string, any>} */
const isObj = v => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** Registered adapter primitive ids (cards declaring adapts). @param {RegistryLike} registry */
export const adaptersOf = registry => registry.ids().filter(id => Boolean(registry.get(id)?.card.adapts));
/** Adapters realising a play-spec mashup relation (union | nested | skin). @param {RegistryLike} registry @param {string} relation */
export const adaptersFor = (registry, relation) => adaptersOf(registry).filter(id => registry.get(id)?.card.adapts?.relation === relation);

/** @type {WeakMap<object, RegistryLike>} */
const plainCache = new WeakMap();
/** The registry without adapters: what the composition lacks before any adapter is considered. @param {RegistryLike} registry @returns {RegistryLike} */
function withoutAdapters(registry) {
  let r = plainCache.get(registry);
  if (!r) { r = new Registry(registry.ids().filter(id => !registry.get(id)?.card.adapts).map(id => /** @type {RegisteredPrimitive} */ (registry.get(id)))); plainCache.set(registry, r); }
  return r;
}

/**
 * Resolve an incompatible-needs-adapter composition into adapter instances. Pure and static (declarations plus
 * the adapters' adapt() hooks); no model calls, no simulation.
 * @param {Doc | Selection} composition  a document, a select.js selection, or a compact { space, primitives }
 * @param {RegistryLike} registry
 * @param {CheckOptions} [opts]  passed to checkComposition
 * @returns {AdapterResolution}
 */
export function resolveAdapters(composition, registry, opts = {}) {
  const started = performance.now();
  const before = checkComposition(composition, withoutAdapters(registry), opts);
  /** @param {CompositionResult} result @param {Partial<AdapterResolution>} [extra] @returns {AdapterResolution} */
  const done = (result, extra = {}) => ({ verdict: result.verdict, adapters: [], bind: {}, gaps: [], composition, before, result, ...extra, ms: +(performance.now() - started).toFixed(3) });
  if (before.verdict !== 'incompatible-needs-adapter') return done(before);

  const spaces = compositionSpaces(composition, registry);
  /** @type {Map<string, Needs & { by: Map<string, Set<string>> }>} space id -> what it lacks, and which unit needs each item */
  const lacking = new Map();
  for (const f of before.failures) {
    if (!f.adaptable || !f.need) continue;
    const sid = f.space ?? spaces[0]?.id; if (sid === undefined) continue;
    const m = lacking.get(sid) || { capabilities: /** @type {string[]} */ ([]), content: /** @type {string[]} */ ([]), services: /** @type {string[]} */ ([]), by: /** @type {Map<string, Set<string>>} */ (new Map()) };
    if (!m[f.need.kind].includes(f.need.item)) m[f.need.kind].push(f.need.item);
    const by = m.by.get(f.unit) || new Set(); by.add(`${f.need.kind}:${f.need.item}`); m.by.set(f.unit, by);
    lacking.set(sid, m);
  }

  /** @type {AdapterResolution['adapters']} */
  const adapters = [];
  /** @type {Record<string, string>} */
  const bind = {};
  /** @type {AdapterSpec[]} */
  const gaps = [];
  const taken = new Set([...spaces.map(s => s.id), ...instanceIds(composition)]);
  for (const [sid, need] of lacking) {
    const space = spaces.find(s => s.id === sid); if (!space) continue;
    const unit = { use: space.use, with: space.with, caps: new Set(space.caps), base: new Set(space.caps), zones: 0 };
    const items = KINDS.flatMap(k => need[k].map(item => `${k}:${item}`));
    let open = new Set(items);
    const tried = new Set();
    while (open.size) {
      // The fitting adapter covering most of what is still open (ties: id order), from card.adapts alone.
      const covers = (/** @type {string} */ id) => { const a = registry.get(id)?.card.adapts; return a ? [...open].filter(x => { const [k, item] = x.split(':'); return (a.provides?.[/** @type {keyof Needs} */ (k)] || []).includes(item); }) : []; };
      const pick = adaptersOf(registry).filter(id => !tried.has(id) && adapterFits(/** @type {Card} */ (registry.get(id)?.card), unit) && covers(id).length)
        .sort((a, b) => covers(b).length - covers(a).length || a.localeCompare(b))[0];
      if (!pick) break;
      tried.add(pick);
      const p = /** @type {RegisteredPrimitive} */ (registry.get(pick)), got = covers(pick);
      const missing = { capabilities: got.filter(x => x.startsWith('capabilities:')).map(x => x.slice(13)), content: got.filter(x => x.startsWith('content:')).map(x => x.slice(8)), services: got.filter(x => x.startsWith('services:')).map(x => x.slice(9)) };
      const users = [...need.by].filter(([, s]) => [...s].some(x => got.includes(x))).map(([use]) => use);
      const proposal = typeof p.adapt === 'function'
        ? p.adapt({ space: { id: sid, use: space.use, with: space.with, caps: space.caps }, missing, neededBy: users.map(use => ({ use, card: /** @type {Card} */ (registry.get(use)?.card) })).filter(n => n.card), registry })
        : { with: {} };
      if (!proposal) continue;
      const w = isObj(proposal.with) ? proposal.with : {};
      // Every instance gets its id: the hook's, else the deterministic one its declaration gives (adapterInstanceId).
      const id = uniqueId(typeof proposal.id === 'string' && proposal.id ? proposal.id : adapterInstanceId(registry, { use: pick, space: sid, with: w }), taken);
      adapters.push({ use: pick, id, space: sid, with: w });
      // Primitives whose every lack this adapter covers move onto its region (sub-space adapters).
      if (p.card.adapts?.subspace) for (const use of users) if ([...(need.by.get(use) || [])].every(x => got.includes(x))) bind[use] = id;
      open = new Set([...open].filter(x => !got.includes(x)));
    }
    if (open.size) {
      const left = [...open], of = (/** @type {string} */ k) => left.filter(x => x.startsWith(k + ':')).map(x => x.slice(k.length + 1));
      gaps.push(adapterSignature({ space: space.use, spaceCaps: space.caps, capabilities: of('capabilities'), content: of('content'), services: of('services'), neededBy: [...need.by].filter(([, s]) => [...s].some(x => open.has(x))).map(([use]) => use) }));
    }
  }
  const resolved = applyAdapters(composition, adapters, bind);
  const result = checkComposition(resolved, registry, opts);
  return done(result, { verdict: gaps.length ? 'incompatible-needs-adapter' : result.verdict, adapters, bind, gaps, composition: resolved });
}

/**
 * How the mashup adapter steps (build-steps.js adapterSteps) realised one core.mashup entry across concepts: the
 * instances that realise it (use, and the instance id when the step added one); [] when the relation needs none (a union
 * whose loops share the space, a skin whose joined concept brings no content: its theme flows to the content forms).
 * A collection (build.js, select.js Selection) keeps one record per entry the steps decided, in `mashupAdapters`.
 * @typedef {{ relation: string, mechanics: string[], instances: Array<{ use: string, id?: string }> }} MashupRealisation
 */
/** The adapter instance ids realising mashup relations. @param {{ mashupAdapters?: MashupRealisation[] }} c @returns {Set<string>} */
export const mashupIds = c => new Set((c.mashupAdapters || []).flatMap(r => r.instances.map(i => i.id)).filter(/** @returns {x is string} */ x => typeof x === 'string'));

/**
 * A collection's adapters after they are resolved again (resolveAdapters re-derives what the spaces lack on every
 * change to the collection, and never a mashup relation): the resolution's instances and bindings, with the instances
 * that realise mashup relations (the previous collection's `mashupAdapters`) and the bindings onto their regions kept
 * as they were. A resolved instance identical to a kept one (same adapter, host and configuration) is that one (its
 * bindings follow it); one whose id a kept one holds gets another id (and its bindings follow). Pure.
 * @param {{ adapters: AdapterInstance[], bind: Record<string, string> }} resolved
 * @param {{ adapters?: AdapterInstance[], bind?: Record<string, string>, mashupAdapters?: MashupRealisation[] }} previous
 * @returns {{ adapters: AdapterInstance[], bind: Record<string, string> }}
 */
export function keepMashupAdapters(resolved, previous) {
  const ids = mashupIds(previous);
  const kept = (previous.adapters || []).filter(a => typeof a.id === 'string' && ids.has(a.id));
  const same = (/** @type {AdapterInstance} */ a, /** @type {AdapterInstance} */ b) => a.use === b.use && (a.space ?? null) === (b.space ?? null) && JSON.stringify(a.with ?? {}) === JSON.stringify(b.with ?? {});
  const taken = new Set([...kept.map(a => /** @type {string} */ (a.id)), ...resolved.adapters.map(a => a.id).filter(/** @returns {x is string} */ x => typeof x === 'string')]);
  /** @type {Map<string, string>} resolved id -> the id it has now */
  const moved = new Map();
  /** @type {AdapterInstance[]} */
  const adapters = [];
  for (const a of resolved.adapters) {
    const twin = kept.find(k => same(k, a));
    if (twin) { if (typeof a.id === 'string') moved.set(a.id, /** @type {string} */ (twin.id)); continue; }
    if (typeof a.id === 'string' && ids.has(a.id)) { const id = uniqueId(a.id, taken); moved.set(a.id, id); adapters.push({ ...structuredClone(a), id }); continue; }
    adapters.push(structuredClone(a));
  }
  const bind = Object.fromEntries(Object.entries(resolved.bind).map(([use, to]) => [use, moved.get(to) ?? to]));
  for (const [use, to] of Object.entries(previous.bind || {})) if (ids.has(to)) bind[use] = to;
  return { adapters: [...adapters, ...kept.map(a => structuredClone(a))], bind };
}

/**
 * The publish invariant of the mashup relations: every core.mashup entry across concepts with a relation an adapter
 * realises (card.adapts.relation: nested, union, skin) was decided by the adapter steps (a record in
 * selection.mashupAdapters), and every instance realising it is in the document's systems (its adapter, and its id when
 * the step gave it one). -> one problem per entry the document lost ([] when every relation is there).
 * @param {unknown} doc @param {{ mechanics?: Array<{ id: string, from: string }>, core?: { mashup?: import('./play-spec.js').Mashup[] } | null }} decomposition
 * @param {{ mashupAdapters?: MashupRealisation[] }} selection @param {RegistryLike} registry
 * @returns {Array<{ code: string, path: string, message: string }>}
 */
export function mashupAdapterProblems(doc, decomposition, selection, registry) {
  const systems = (isObj(doc) && Array.isArray(doc.systems) ? doc.systems : []).filter(isObj);
  /** @type {Set<string | undefined>} */
  const realised = new Set(adaptersOf(registry).map(id => registry.get(id)?.card.adapts?.relation));
  /** @type {Array<{ code: string, path: string, message: string }>} */
  const out = [];
  for (const entry of decomposition.core?.mashup || []) {
    if (!entry.relation || !realised.has(entry.relation) || !mashupSides(entry, decomposition.mechanics || []).outer.length) continue;
    const label = `${entry.relation} mashup [${entry.mechanics.join(', ')}]`;
    const rec = (selection.mashupAdapters || []).find(r => r.relation === entry.relation && r.mechanics.join('\n') === entry.mechanics.join('\n'));
    if (!rec) { out.push({ code: 'mashup_adapter_missing', path: 'systems', message: `${label}: no mashup adapter step realised it (selection.mashupAdapters)` }); continue; }
    const lost = rec.instances.filter(i => !systems.some(s => s.use === i.use && (i.id === undefined || s.id === i.id)));
    if (lost.length) out.push({ code: 'mashup_adapter_missing', path: 'systems', message: `${label}: the document lost ${lost.map(i => `${i.use}${i.id ? ` '${i.id}'` : ''}`).join(', ')}, which the adapter steps added to realise it` });
  }
  return out;
}

/**
 * The composition with adapter instances added and primitives re-bound: a document gets them in systems (and
 * its instances of re-bound primitives get instance.space); a selection or compact form gets `adapters` and `bind`.
 * @param {Doc | Selection} composition @param {AdapterInstance[]} adapters @param {Record<string, string>} bind
 * @returns {Doc | Selection}
 */
export function applyAdapters(composition, adapters, bind) {
  const c = /** @type {Record<string, any>} */ (structuredClone(composition));
  const isDoc = typeof c.schema === 'string' || (Array.isArray(c.systems) && c.systems.some((/** @type {unknown} */ s) => isObj(s) && typeof s.use === 'string'));
  if (isDoc) {
    c.systems = [...(c.systems || []).map((/** @type {any} */ s) => (isObj(s) && typeof s.use === 'string' && bind[s.use] ? { ...s, space: bind[s.use] } : s)), ...adapters.map(a => structuredClone(a))];
    return /** @type {Doc} */ (c);
  }
  c.adapters = [...(Array.isArray(c.adapters) ? c.adapters : []), ...adapters.map(a => structuredClone(a))];
  c.bind = { ...(isObj(c.bind) ? c.bind : {}), ...bind };
  return /** @type {Selection} */ (c);
}

/**
 * A document with every skin adapter instance applied (card.adapts.relation 'skin' primitives' skin() hook):
 * content mapped from one concept onto another's slots, before preflight and content contracts are checked.
 * @param {Doc} doc @param {RegistryLike} registry @returns {Doc}
 */
export function applySkins(doc, registry) {
  let out = doc;
  for (const inst of doc.systems || []) {
    const p = registry.get(inst?.use);
    if (p?.card.adapts?.relation === 'skin' && typeof p.skin === 'function') out = p.skin(out, inst.with || {});
  }
  return out;
}

// Instance-level fields of adapter instances (id, the host space binding) are the planner's, never the model's:
// every instance the planner adds (resolveAdapters, a build step, the preset) carries them, derived from its
// declaration, and repair (repair.js) fills them by code when a document lacks them. A document form never asks for them.
const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** @param {unknown} s */
const idSlug = s => (String(s || '').toLowerCase().match(/[a-z0-9_]+/g) || ['x']).join('-').replace(/^[_-]+/, '').slice(0, 64) || 'x';
/** The last segment of a primitive id ('engine.space.grid' -> 'grid'). @param {unknown} id */
const lastOf = id => String(id || '').split('.').pop() || 'x';

/**
 * The instance fields an adapter's declaration requires: every adapter instance has an `id`; a sub-space adapter
 * (card.adapts.subspace) is also bound to its host space (`space`). [] for a primitive that is no adapter.
 * @param {Card | null | undefined} card @returns {Array<'id' | 'space'>}
 */
export const requiredInstanceFields = card => (!card?.adapts ? [] : card.adapts.subspace ? ['id', 'space'] : ['id']);

/**
 * The deterministic id of an adapter instance, from its declaration: a sub-space adapter's is the projected kind and
 * the host space ('grid-on-world'); any other's is the adapter and what it configures (its `with.id`, else its host:
 * 'nested-duel', 'skin-on-board'). Not yet unique: uniqueId makes it so within a document.
 * @param {RegistryLike} registry @param {{ use: string, space?: string, with?: Record<string, any> }} inst @param {string} [host] the host when the instance names none
 */
export function adapterInstanceId(registry, inst, host = 'world') {
  const a = registry.get(inst.use)?.card.adapts;
  const w = isObj(inst.with) ? inst.with : {};
  const on = typeof inst.space === 'string' && inst.space ? inst.space : host;
  if (a?.subspace) return idSlug(`${lastOf(typeof w[a.subspace.kind] === 'string' ? w[a.subspace.kind] : inst.use)}-on-${on}`);
  return idSlug(typeof w.id === 'string' && w.id ? `${lastOf(inst.use)}-${w.id}` : `${lastOf(inst.use)}-on-${on}`);
}
/** `id`, or `id-2`, `id-3`... the first not taken; marks it taken. @param {string} id @param {Set<string>} taken */
export function uniqueId(id, taken) {
  let out = id, n = 2;
  while (taken.has(out)) { const suffix = `-${n++}`; out = `${id.slice(0, 64 - suffix.length)}${suffix}`; }
  taken.add(out);
  return out;
}
/** Ids a document or selection already uses for spaces and instances (a new instance id must differ). @param {unknown} composition @returns {string[]} */
export function instanceIds(composition) {
  const c = isObj(composition) ? composition : {};
  return [...(Array.isArray(c.spaces) ? c.spaces : []), ...(Array.isArray(c.systems) ? c.systems : []), ...(Array.isArray(c.adapters) ? c.adapters : [])]
    .map(x => (isObj(x) ? x.id : undefined)).filter(/** @returns {x is string} */ x => typeof x === 'string');
}

/**
 * Adapter instances lacking a required instance field (requiredInstanceFields), in a document's systems or a
 * selection's adapters: the check that no planner-added instance goes without one.
 * @param {unknown} composition @param {RegistryLike} registry @returns {Array<{ at: string, use: string, field: string, message: string }>}
 */
export function instanceFieldProblems(composition, registry) {
  const c = isObj(composition) ? composition : {};
  const spaces = new Set((Array.isArray(c.spaces) ? c.spaces : []).map(s => (isObj(s) ? s.id : undefined)));
  /** @type {Array<{ at: string, use: string, field: string, message: string }>} */
  const out = [];
  for (const key of ['systems', 'adapters']) {
    const items = Array.isArray(c[key]) ? c[key] : [];
    items.forEach((/** @type {unknown} */ s, /** @type {number} */ i) => {
      if (!isObj(s) || typeof s.use !== 'string') return;
      for (const field of requiredInstanceFields(registry.get(s.use)?.card)) {
        const v = s[field];
        if (field === 'id' && !(typeof v === 'string' && SLUG.test(v))) out.push({ at: `${key}[${i}].id`, use: s.use, field, message: `${s.use} instance has no id (a lowercase slug)` });
        if (field === 'space' && !(typeof v === 'string' && (!spaces.size || spaces.has(v)))) out.push({ at: `${key}[${i}].space`, use: s.use, field, message: `${s.use} instance is bound to no host space of the document` });
      }
    });
  }
  return out;
}

/**
 * Fill the instance fields the planner owns on a document's adapter instances (repair by code, never the model):
 * a missing or malformed id gets the deterministic one (adapterInstanceId, unique in the document); a sub-space
 * adapter bound to no document space is bound to the first one (the host the adapter defaults to). Mutates `doc`.
 * @param {any} doc @param {RegistryLike} registry @returns {Array<{ code: string, path: string, action: string }>} the fixes
 */
export function ensureInstanceFields(doc, registry) {
  /** @type {Array<{ code: string, path: string, action: string }>} */
  const fixes = [];
  if (!isObj(doc) || !Array.isArray(doc.systems)) return fixes;
  const spaces = (Array.isArray(doc.spaces) ? doc.spaces : []).filter(isObj);
  const host = typeof spaces[0]?.id === 'string' ? spaces[0].id : undefined;
  const taken = new Set(instanceIds(doc).filter(id => SLUG.test(id)));
  doc.systems.forEach((/** @type {unknown} */ s, /** @type {number} */ i) => {
    if (!isObj(s) || typeof s.use !== 'string') return;
    const need = requiredInstanceFields(registry.get(s.use)?.card);
    if (need.includes('space') && host && !(typeof s.space === 'string' && spaces.some(x => x.id === s.space))) { s.space = host; fixes.push({ code: 'instance_space', path: `systems[${i}].space`, action: `bound ${s.use} to host space '${host}'` }); }
    if (need.includes('id') && !(typeof s.id === 'string' && SLUG.test(s.id))) {
      s.id = uniqueId(adapterInstanceId(registry, /** @type {any} */ (s), host), taken);
      fixes.push({ code: 'instance_id', path: `systems[${i}].id`, action: `gave ${s.use} the id '${s.id}'` });
    }
  });
  return fixes;
}
