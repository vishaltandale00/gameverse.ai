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
// and the selection carries `adapters` (instances: { use, id?, space, with }) for the outline/preset stage to
// write into doc.systems. A document works too: resolveAdapters(doc, registry).composition is the document with
// the instances appended to systems and the needy instances re-bound (instance.space) to the region.
import { checkComposition, compositionSpaces, adapterFits, adapterSignature } from './compose-check.js';
import { Registry } from '../kernel/registry.js';

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
  const taken = new Set([...spaces.map(s => s.id)]);
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
      let id = proposal.id;
      if (id !== undefined) { let n = 2; const base = id; while (taken.has(id)) id = `${base}-${n++}`; taken.add(id); }
      adapters.push({ use: pick, ...(id !== undefined ? { id } : {}), space: sid, with: isObj(proposal.with) ? proposal.with : {} });
      // Primitives whose every lack this adapter covers move onto its region (sub-space adapters).
      if (id !== undefined && p.card.adapts?.subspace) for (const use of users) if ([...(need.by.get(use) || [])].every(x => got.includes(x))) bind[use] = id;
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
