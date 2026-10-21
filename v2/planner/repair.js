// @ts-check
// Deterministic document repair driven by preflight's stable error codes
// (KERNEL_API.md: errors carry code, path, message, hint). Each code has a
// generic fix: unknown params are dropped, out-of-range values clamped,
// missing required params synthesized from their schema, unknown references
// re-pointed to the nearest existing id or given a stub, missing primitives
// added from the catalogue, capability errors re-select a space configuration
// or another space, and only as a last resort is an instance removed (and
// reported as a gap). Model repair rounds only see what this cannot fix.
import { preflight, DOC_SCHEMA } from '../kernel/document.js';
import { REF_KINDS, checkFields } from '../kernel/params.js';
import { defaultsOf, isSpace, isGenerator, isGraphics, satisfying, spaceVariants, requirementsOf } from './catalog.js';
import { vocabIndex } from './select.js';
import { isObj, isStr, list, obj, objects, prop, str } from '../kernel/guards.js';
import { referenceOf, idsAt, declaredAt, ZONES } from './content.js';

/** @typedef {import('../kernel/types.js').Doc} Doc */
/** @typedef {import('../kernel/types.js').Instance} Instance */
/** @typedef {import('../kernel/types.js').LogicLike} LogicLike */
/** @typedef {import('../kernel/types.js').ParamSchema} ParamSchema */
/** @typedef {import('../kernel/types.js').PreflightResult} PreflightResult */
/** @typedef {import('../kernel/types.js').Problem} Problem */
/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** A path step: an object key or a list index. @typedef {string | number} Key */
/** A JSON container (object or list) indexed by path steps. @typedef {Record<Key, unknown>} Bag */
/**
 * An instance (space, generator, system, graphic) as found in a draft document: any fields, since a model
 * may have written it; narrow `use`, `with`, `space` before relying on them.
 * @typedef {Record<string, unknown>} DraftInstance
 */
/** @typedef {{ inst: DraftInstance, keys: Key[] }} InstanceEntry */
/** @typedef {InstanceEntry & { rest: Key[], schema: ParamSchema | null | undefined }} Located */
/** @typedef {{ code: string, path: string, action: string }} Fix */
/** An instance repair dropped (`use` is whatever the document had there). @typedef {{ use: unknown, why: string, kind?: string }} Removed */
/** @typedef {{ ensureId(kind: string): string }} SynthContext */
/**
 * repairDocument's result. `doc` is the repaired draft; when `ok`, preflight accepted exactly that draft (`checked`).
 * @typedef {{ checked: PreflightResult | null, errors: Problem[], fixes: Fix[], removed: Removed[], rounds?: number, version: string }
 *   & ({ ok: true, doc: Doc } | { ok: false, doc: unknown })} RepairResult
 */

export const REPAIR_VERSION = 'repair/0.1';

/** @param {unknown} v @returns {v is Bag} a non-null object or list */
const isBag = v => typeof v === 'object' && v !== null;
/** Property access that never throws, like `o?.[k]` (primitives read through their wrapper). @param {unknown} o @param {Key} k @returns {unknown} */
const step = (o, k) => (o == null ? undefined : /** @type {Bag} */ (Object(o))[k]);
/** The list at obj[key], created when absent; null when something else is there. @param {Bag} o @param {Key} key @returns {unknown[] | null} */
const listAt = (o, key) => { const v = (o[key] ??= []); return Array.isArray(v) ? v : null; };
/** An instance's primitive id when it is a string, else ''. @param {DraftInstance} inst */
const useOf = inst => str(inst.use);

// ---------- paths ----------
/** @param {unknown} path @returns {Key[]} */
export function parsePath(path) {
  /** @type {Key[]} */
  const keys = [];
  String(path || '').replace(/([^.[\]]+)|\[(\d+)\]/g, (_, name, index) => { keys.push(index !== undefined ? Number(index) : name); return ''; });
  return keys;
}
/** @param {unknown} obj @param {Key[]} keys @returns {unknown} */
export const getAt = (obj, keys) => keys.reduce((/** @type {unknown} */ o, k) => step(o, k), obj);
/** @param {unknown} obj @param {Key[]} keys @param {unknown} value */
function setAt(obj, keys, value) {
  let parent = obj;
  for (let i = 0; i < keys.length - 1; i++) { if (!isBag(parent)) return; if (parent[keys[i]] == null) parent[keys[i]] = typeof keys[i + 1] === 'number' ? [] : {}; parent = parent[keys[i]]; }
  if (isBag(parent)) parent[keys[keys.length - 1]] = value;
}
/** @param {unknown} obj @param {Key[]} keys */
function deleteAt(obj, keys) {
  const parent = getAt(obj, keys.slice(0, -1)), k = keys[keys.length - 1];
  if (Array.isArray(parent) && typeof k === 'number') parent.splice(k, 1);
  else if (isBag(parent)) delete parent[k];
}
/** @param {unknown} s */
const slug = s => (String(s || '').toLowerCase().match(/[a-z0-9]+/g) || ['x']).join('_').slice(0, 60);

// ---------- id indexes (mirrors preflight's, read-only) ----------
/** @type {Record<string, string>} */
const BASE_AT = { character: 'plot.characters', quest: 'plot.quests', ending: 'plot.endings', dialogue: 'plot.dialogue', item: 'content.items', recipe: 'content.recipes', archetype: 'content.archetypes', block: 'content.blocks', model: 'content.models' };
/** @param {unknown} o @param {string} path @returns {unknown} */
const get = (o, path) => path.split('.').reduce((/** @type {unknown} */ v, k) => step(v, k), o);
/** @param {RegistryLike} registry @param {string} kind @returns {string | null} */
export function collectionOf(registry, kind) {
  if (BASE_AT[kind]) return BASE_AT[kind];
  for (const id of registry.ids()) for (const d of registry.get(id)?.card.defines || []) if (d.kind === kind && d.at) return d.at;
  return null;
}
/** Ids of `kind` in a (draft) document; ids that are not strings are not ids. @param {unknown} doc @param {RegistryLike} registry @param {string} kind @returns {string[]} */
export function idsOf(doc, registry, kind) {
  const d = obj(doc);
  if (kind === 'space') return objects(d.spaces).map(s => s.id).filter(isStr);
  if (kind === 'zone') return objects(d.spaces).flatMap(s => objects(s.zones).map(z => z.id)).filter(isStr);
  if (kind === 'beat') return objects(prop(prop(d.plot, 'storyboard'), 'acts')).flatMap(a => objects(a.beats).map(b => b.id)).filter(isStr);
  /** @type {string[]} */
  const out = [];
  const at = collectionOf(registry, kind);
  if (at) { const v = get(d, at); if (Array.isArray(v)) out.push(...v.map(x => prop(x, 'id')).filter(isStr).filter(Boolean)); else if (v && typeof v === 'object') out.push(...Object.keys(v)); }
  for (const id of registry.ids()) for (const def of registry.get(id)?.card.defines || []) { const field = def.in; if (def.kind === kind && field) for (const inst of instances(d)) if (inst.inst.use === id) out.push(...list(prop(inst.inst.with, field)).map(x => prop(x, 'id')).filter(isStr).filter(Boolean)); }
  return out;
}
/** Every object instance in a (draft) document with its path keys. @param {unknown} doc @returns {InstanceEntry[]} */
export function instances(doc) {
  const d = obj(doc);
  /** @type {InstanceEntry[]} */
  const out = [];
  list(d.spaces).forEach((s, i) => { if (!isObj(s)) return; out.push({ inst: s, keys: ['spaces', i] }); list(s.generators).forEach((g, j) => { if (isObj(g)) out.push({ inst: g, keys: ['spaces', i, 'generators', j] }); }); });
  list(d.systems).forEach((s, i) => { if (isObj(s)) out.push({ inst: s, keys: ['systems', i] }); });
  list(d.graphics).forEach((g, i) => { if (isObj(g)) out.push({ inst: g, keys: ['graphics', i] }); });
  return out;
}
/**
 * The instance an error path points into, and the param schema at that path (when inside `with`).
 * @param {unknown} doc @param {RegistryLike} registry @param {Key[]} keys @returns {Located | null}
 */
function locate(doc, registry, keys) {
  /** @type {InstanceEntry | null} */
  let hit = null;
  for (const x of instances(doc)) if (x.keys.every((k, i) => keys[i] === k) && (!hit || x.keys.length > hit.keys.length)) hit = x;
  if (!hit) return null;
  const rest = keys.slice(hit.keys.length);
  /** @type {ParamSchema | null | undefined} */
  let schema = null;
  if (rest[0] === 'with') {
    /** @type {ParamSchema | null | undefined} */
    let s = { type: 'object', fields: registry.get(isStr(hit.inst.use) ? hit.inst.use : undefined)?.card.params || {} };
    for (const k of rest.slice(1)) { s = s?.type === 'object' ? s.fields?.[k] : s?.type === 'list' ? s.of : null; if (!s) break; }
    schema = s;
  }
  return { ...hit, rest, schema };
}
/** @typedef {{ component: string, owner: string, rest: Key[], schema: ParamSchema, keys: Key[] }} ComponentField */
/**
 * An archetype component field (content.archetypes[i].components.<component>...): its schema from the card that
 * owns the component (card.components), so a missing or mistyped component field is synthesized, not looped on.
 * @param {RegistryLike} registry @param {Key[]} keys @returns {ComponentField | null}
 */
function componentAt(registry, keys) {
  const name = keys[4];
  if (keys[0] !== 'content' || keys[1] !== 'archetypes' || typeof keys[2] !== 'number' || keys[3] !== 'components' || typeof name !== 'string') return null;
  const owner = registry.cards().find(c => prop(c.components, name));
  // card.components (component name -> field schema) is primitive-authored card data, not model output.
  /** @type {ParamSchema | null | undefined} */
  let schema = owner ? /** @type {ParamSchema | undefined} */ (prop(owner.components, name)) : undefined;
  for (const k of keys.slice(5)) { schema = schema?.type === 'object' ? schema.fields?.[k] : schema?.type === 'list' ? schema.of : null; if (!schema) break; }
  return schema && owner ? { component: name, owner: owner.id, rest: keys.slice(5), schema, keys: keys.slice(0, 5) } : null;
}

// ---------- value synthesis from a param schema ----------
/** @param {ParamSchema | null | undefined} schema @param {SynthContext} ctx @returns {unknown} */
export function synthesize(schema, ctx) {
  if (!schema) return null;
  if (schema.default !== undefined) return structuredClone(schema.default);
  switch (schema.type) {
    case 'number': case 'integer': { let v = schema.min ?? 0; if (schema.max !== undefined) v = Math.min(v, schema.max); return schema.type === 'integer' ? Math.ceil(v) : v; }
    case 'boolean': return false;
    case 'string': return schema.options?.[0] ?? 'untitled';
    case 'ref': return ctx.ensureId(String(schema.to));
    case 'list': return Array.from({ length: schema.min || 0 }, () => synthesize(schema.of, ctx));
    // Required fields, plus lists without a default (validators iterate them): an empty or minimal list, never undefined.
    case 'object': return Object.fromEntries(Object.entries(schema.fields || {}).filter(([, f]) => f.required || (f.type === 'list' && f.default === undefined)).map(([k, f]) => [k, synthesize(f, ctx)]));
    case 'predicate': return { time: 0, gte: 0 };
    case 'effects': return [];
    default: return null;
  }
}

/** @param {string} a @param {string} b */
const near = (a, b) => a === b || slug(a) === slug(b) || (a.length > 3 && b.length > 3 && (a.includes(b) || b.includes(a))) || lev(a, b) <= Math.max(1, Math.floor(Math.min(a.length, b.length) / 5));
/** @param {string} a @param {string} b @returns {number} */
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
/** @param {unknown} id */
const title = id => String(id).replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
/** @type {Record<string, (id: string) => Record<string, unknown>>} */
const STUB = { character: id => ({ id, name: title(id) }), archetype: id => ({ id, components: {} }), ending: id => ({ id, title: title(id), outcome: 'won' }), item: id => ({ id, name: title(id) }) };
const CREATABLE = new Set(['character', 'archetype', 'ending', 'item', 'quest', 'recipe']);

/** @param {unknown} v @returns {unknown[] | undefined} */
const asList = v => (v === undefined || v === null ? undefined : Array.isArray(v) ? v : [v]);
/**
 * Coerce the kernel document's own structure (ARCHITECTURE.md §3, not any primitive's params) so that
 * validators, repair and the planner never see a beat whose `do` is an object, a space whose `zones` is a
 * map, a null list entry or an id that is not a string. Models make these slips; everything downstream may
 * assume the documented shapes. Total: any JSON value in, a document of the documented shape out.
 * @param {Record<string, unknown>} doc @param {Fix[]} [fixes] @returns {Record<string, unknown>}
 */
export function normalizeShape(doc, fixes = []) {
  const fix = (/** @type {string} */ path, /** @type {string} */ what) => fixes.push({ code: 'shape', path, action: what });
  // A list of objects: maps become lists (key -> id), scalars and nulls are dropped, non-string ids are dropped.
  /** @param {Bag} owner @param {string} key @param {string} path @param {{ keyed?: boolean, ids?: boolean }} [options] */
  const objectList = (owner, key, path, { keyed = true, ids = true } = {}) => {
    const v = owner[key];
    if (v === undefined) return;
    if (v === null) { delete owner[key]; fix(path, 'removed null'); return; }
    /** @type {unknown[]} */
    let items;
    if (!Array.isArray(v)) { items = isObj(v) && keyed && !('id' in v) ? Object.entries(v).map(([id, x]) => (isObj(x) ? { id, ...x } : null)) : [v]; fix(path, 'made a list'); }
    else items = v;
    const kept = items.filter(x => isObj(x)).filter(x => !ids || x.id === undefined || typeof x.id === 'string' || (typeof x.id === 'number' && (x.id = String(x.id))));
    if (kept.length !== items.length) fix(path, `dropped ${items.length - kept.length} malformed entr${items.length - kept.length === 1 ? 'y' : 'ies'}`);
    owner[key] = kept;
  };
  const section = (/** @type {string} */ key) => { if (doc[key] !== undefined && !isObj(doc[key])) { doc[key] = {}; fix(key, 'made an object'); } };
  for (const key of ['spaces', 'systems', 'graphics']) objectList(doc, key, key, { keyed: key === 'spaces' });
  list(doc.spaces).forEach((s, i) => {
    if (!isObj(s)) return;
    objectList(s, 'zones', `spaces[${i}].zones`); objectList(s, 'generators', `spaces[${i}].generators`, { keyed: false });
    if (s.with !== undefined && !isObj(s.with)) { delete s.with; fix(`spaces[${i}].with`, 'removed non-object'); }
    list(s.zones).forEach((z, j) => { if (isObj(z) && z.exits !== undefined) { if (!Array.isArray(z.exits)) { z.exits = asList(z.exits) || []; fix(`spaces[${i}].zones[${j}].exits`, 'made a list'); } z.exits = list(z.exits).filter(isObj); } });
  });
  for (const key of ['systems', 'graphics']) list(doc[key]).forEach((x, i) => { if (isObj(x) && x.with !== undefined && !isObj(x.with)) { delete x.with; fix(`${key}[${i}].with`, 'removed non-object'); } });
  section('plot'); section('content'); section('player');
  const plot = doc.plot;
  if (isObj(plot)) {
    for (const k of ['characters', 'quests', 'endings']) objectList(plot, k, `plot.${k}`);
    if (plot.storyboard !== undefined && !isObj(plot.storyboard)) { plot.storyboard = Array.isArray(plot.storyboard) ? { acts: plot.storyboard } : { acts: [] }; fix('plot.storyboard', 'made an object'); }
    const storyboard = plot.storyboard;
    if (isObj(storyboard)) objectList(storyboard, 'acts', 'plot.storyboard.acts', { keyed: true });
    list(step(plot.storyboard, 'acts')).forEach((a, i) => {
      if (!isObj(a)) return;
      if (a.beats === undefined || a.beats === null) a.beats = [];
      objectList(a, 'beats', `plot.storyboard.acts[${i}].beats`);
      list(a.beats).forEach((b, j) => {
        if (!isObj(b)) return;
        if (b.do !== undefined && !Array.isArray(b.do)) { b.do = asList(b.do) || []; fix(`plot.storyboard.acts[${i}].beats[${j}].do`, 'made a list'); }
        if (Array.isArray(b.do)) b.do = b.do.filter(isObj);
        if (b.after !== undefined && !Array.isArray(b.after)) { b.after = asList(b.after) || []; fix(`plot.storyboard.acts[${i}].beats[${j}].after`, 'made a list'); }
        if (Array.isArray(b.after)) b.after = b.after.filter(x => typeof x === 'string');
      });
    });
    if (plot.dialogue !== undefined && !isObj(plot.dialogue)) { plot.dialogue = Array.isArray(plot.dialogue) ? Object.fromEntries(plot.dialogue.filter(isObj).filter(d => typeof d.id === 'string').map(({ id, ...d }) => /** @type {const} */ ([String(id), d]))) : {}; fix('plot.dialogue', 'made an id-keyed object'); }
  }
  const content = doc.content;
  if (isObj(content)) {
    for (const k of ['items', 'archetypes', 'recipes', 'blocks']) objectList(content, k, `content.${k}`);
    for (const a of objects(content.archetypes)) if (a.components !== undefined && !isObj(a.components)) { a.components = {}; fix(`content.archetypes.${a.id}.components`, 'made an object'); }
    if (content.models !== undefined && !isObj(content.models)) { delete content.models; fix('content.models', 'removed non-object'); }
  }
  return doc;
}

/**
 * List params whose validators assume complete entries: an unset list with a default gets its default entries with
 * their field defaults applied (a card default like [{id:'attack', hit:{...}}] that omits a defaulted field), and an
 * unset list the card needs at least one entry of (min >= 1, no default) gets a synthesized entry, so validators
 * never run on undefined. Instances only; values the document sets are left alone.
 * @param {any} doc @param {RegistryLike} registry @param {Fix[]} fixes
 */
function materializeLists(doc, registry, fixes) {
  /** @type {Array<[any, string]>} */
  const all = [...(doc.spaces || []).flatMap((/** @type {any} */ s, /** @type {number} */ i) => (s.generators || []).map((/** @type {any} */ g, /** @type {number} */ j) => [g, `spaces[${i}].generators[${j}]`])), ...(doc.systems || []).map((/** @type {any} */ x, /** @type {number} */ i) => [x, `systems[${i}]`])];
  for (const [inst, path] of all) {
    const params = registry.get(inst?.use)?.card.params || {};
    for (const [k, spec] of Object.entries(params)) {
      if (spec.type !== 'list' || inst.with?.[k] !== undefined) continue;
      const fields = spec.of?.type === 'object' ? spec.of.fields : null;
      if (Array.isArray(spec.default) && spec.default.length && fields) {
        const filled = spec.default.map((/** @type {unknown} */ item) => (item && typeof item === 'object' ? checkFields(fields, structuredClone(item), '', [], null) : item));
        if (JSON.stringify(filled) !== JSON.stringify(spec.default)) { inst.with = { ...(inst.with || {}), [k]: filled }; fixes.push({ code: 'list_defaults', path: `${path}.with.${k}`, action: 'filled the default entries\' field defaults' }); }
      } else if (spec.default === undefined && (spec.min || 0) > 0) {
        inst.with = { ...(inst.with || {}), [k]: synthesize({ ...spec, min: spec.min }, { ensureId: kind => `${kind}_1` }) };
        fixes.push({ code: 'list_required', path: `${path}.with.${k}`, action: `synthesized ${spec.min} entr${spec.min === 1 ? 'y' : 'ies'} the primitive needs` });
      }
    }
  }
}

/** preflight that reports a validator crash as an error instead of throwing. */
/** preflight that reports a validator crash as an error instead of throwing. @param {unknown} doc @param {RegistryLike} registry @param {LogicLike} logic @returns {PreflightResult} */
function safePreflight(doc, registry, logic) {
  try { return preflight(doc, registry, logic); }
  catch (error) {
    const stack = error instanceof Error ? error.stack : undefined;
    if (process.env.GV_DEBUG) console.error(stack);
    // Where it threw (first v2 frame), so a crash is diagnosable from a stored record without a debugger.
    const at = String(stack || '').split('\n').find(l => /\/v2\//.test(l))?.replace(/^.*\/v2\//, 'v2/').replace(/\)$/, '') || null;
    return { ok: false, doc: null, errors: [{ code: 'preflight_threw', path: '$', message: `a validator crashed: ${String(prop(error, 'message') || error).slice(0, 200)}${at ? ` (at ${at})` : ''}`, hint: 'a section has the wrong shape (a list written as an object, a missing field)' }], warnings: [] };
  }
}

// Models often wrap a whole condition in `count` ({count: {var: 'x', gte: 5}}); `count` takes an event name.
// When the value is itself a registered predicate, the intended condition is that predicate: unwrap it.
/** @param {unknown} doc @param {LogicLike} logic @param {Fix[]} fixes */
function unwrapCountPredicates(doc, logic, fixes) {
  const kinds = new Set([...Object.keys(logic?.predicates || {}), 'all', 'any', 'not', 'var', 'flag', 'time', 'zone', 'near', 'cell']);
  /** @param {unknown} node @param {string} path */
  const walk = (node, path) => {
    if (Array.isArray(node)) { node.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
    if (!isObj(node)) return;
    const inner = node.count;
    if (isObj(inner) && Object.keys(inner).some(k => kinds.has(k))) {
      delete node.count; Object.assign(node, inner);
      fixes.push({ code: 'count_unwrapped', path, action: 'used the condition written inside count' });
    }
    for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
  };
  walk(doc, '');
}

/** The space instance used when a document has none or an unknown one (any shape the caller built). @typedef {{ use?: unknown, with?: unknown, id?: unknown, [k: string]: unknown }} FallbackSpace */
/**
 * @typedef {object} RepairOptions
 * @property {RegistryLike} registry
 * @property {LogicLike} logic
 * @property {number} [rounds]
 * @property {FallbackSpace | null} [fallbackSpace]
 * @property {boolean} [isolate]
 * @property {Set<unknown>} [exclude] primitive ids never (re-)added; isolation adds the ones it removes
 * @property {Set<unknown> | unknown[] | null} [protect] primitives of core mechanics: never removed
 */
/**
 * Never mutates its input. `removed` lists primitive instances dropped (reported as gaps by the caller).
 * @param {unknown} input @param {RepairOptions} options @returns {RepairResult}
 */
export function repairDocument(input, { registry, logic, rounds = 6, fallbackSpace = null, isolate = false, exclude = new Set(), protect: protectIn = new Set() }) {
  // protect: primitives of core mechanics; never removed (isolation, capability or requirement fixes): their errors stay for the model.
  const protect = protectIn instanceof Set ? protectIn : new Set(protectIn || []);
  const kept = (/** @type {unknown} */ id) => protect.has(id);
  const doc = structuredClone(input);
  /** @type {Fix[]} */
  const fixes = [];
  /** @type {Removed[]} */
  const removed = [];
  if (!isObj(doc)) return { doc: input, ok: false, checked: null, errors: [{ code: 'schema', path: '$', message: 'document must be an object' }], fixes, removed, version: REPAIR_VERSION };
  normalizeShape(doc, fixes);
  materializeLists(doc, registry, fixes);
  unwrapCountPredicates(doc, logic, fixes);
  const vocab = vocabIndex(registry);
  /** @type {SynthContext} */
  const ctx = {
    ensureId(kind) {
      const have = idsOf(doc, registry, kind);
      if (have.length) return have[0];
      const at = collectionOf(registry, kind);
      if (!at || !CREATABLE.has(kind)) return `${kind}_1`;
      const id = `${kind}_1`;
      addToCollection(at, kind, id); return id;
    },
  };
  /** @param {string} at @param {string} kind @param {string} id */
  const addToCollection = (at, kind, id) => {
    const keys = at.split('.');
    /** @type {Bag} */
    let parent = doc;
    for (const k of keys.slice(0, -1)) { const next = (parent[k] ??= {}); if (!isBag(next)) return; parent = next; }
    const last = keys[keys.length - 1], here = parent[last];
    if (kind === 'dialogue' || kind === 'model' || (here && !Array.isArray(here) && typeof here === 'object')) { const map = (parent[last] ??= {}); if (!isBag(map)) return; map[id] ??= {}; }
    else { const items = listAt(parent, last); if (!items) return; items.push((STUB[kind] || ((/** @type {string} */ x) => ({ id: x, name: title(x) })))(id)); }
    fixes.push({ code: 'ref_unknown', path: at, action: `added ${kind} '${id}'` });
  };
  /** @param {string | null | undefined} id @param {string} why @returns {boolean} */
  const addSystem = (id, why) => {
    if (!id || !registry.has(id) || exclude.has(id)) return false;
    if (isSpace(id)) return false;
    if (isGenerator(id)) { const first = list(doc.spaces)[0]; if (isBag(first)) listAt(first, 'generators')?.push({ use: id }); }
    else if (isGraphics(id)) listAt(doc, 'graphics')?.push({ use: id });
    else { if (list(doc.systems).some(s => prop(s, 'use') === id)) return false; listAt(doc, 'systems')?.push({ use: id }); }
    fixes.push({ code: why, path: 'systems', action: `added ${id}` }); return true;
  };

  /** @type {PreflightResult | null} */
  let checked = null;
  for (let round = 0; round < rounds; round++) {
    checked = safePreflight(doc, registry, logic);
    // Preflight accepts vocabulary whose owning primitive is registered but not in the document
    // (kernel request: pipeline.md); add the owners so the effects run with their primitive installed.
    if (checked.ok) {
      const missing = missingOwners(doc, registry, vocab);
      if (missing.length && round < rounds - 1) { for (const id of missing) addSystem(id, 'vocabulary_owner'); continue; }
      // preflight has just accepted this very object: it is a document.
      return { doc: /** @type {Doc} */ (doc), ok: true, checked, errors: [], fixes, removed, rounds: round, version: REPAIR_VERSION };
    }
    /** @type {Key[][]} */
    const removals = [];
    let progressed = false;
    const done = new Set();
    for (const e of checked.errors) {
      const keys = parsePath(e.path), sig = `${e.code}|${e.path}`;
      if (done.has(sig)) continue; done.add(sig);
      const fix = (/** @type {string} */ action) => { fixes.push({ code: e.code, path: e.path, action }); progressed = true; };
      const loc = locate(doc, registry, keys), comp = loc ? null : componentAt(registry, keys), field = loc || comp;
      switch (e.code) {
        case 'schema':
          if (e.path === 'schema') { doc.schema = DOC_SCHEMA; fix('set schema'); }
          else if (e.path === 'id') { doc.id = slug(doc.title || doc.id || 'game').replace(/_/g, '-').slice(0, 60) || 'game'; fix('slugged id'); }
          else if (e.path === 'title') { doc.title = title(doc.id || 'Untitled game'); fix('titled from id'); }
          else if (e.path === 'spaces' && fallbackSpace) { doc.spaces = [structuredClone(fallbackSpace)]; fix(`added space ${fallbackSpace.use}`); }
          break;
        case 'id_invalid': {
          const v = getAt(doc, keys);
          if (typeof v === 'string' || v === undefined) { setAt(doc, keys, slug(v || `id_${round}`)); fix('slugged id'); }
          break;
        }
        case 'id_duplicate': {
          const v = getAt(doc, keys);
          if (typeof v === 'string') { let n = 2; const all = new Set(JSON.stringify(doc).match(/"id":"[^"]+"/g)); while (all.has(`"id":"${v}_${n}"`)) n++; setAt(doc, keys, `${v}_${n}`); fix(`renamed duplicate to ${v}_${n}`); }
          break;
        }
        case 'primitive_unknown': {
          if (!loc) break;
          if (isSpace(String(loc.inst.use)) || loc.keys.length === 2 && loc.keys[0] === 'spaces') {
            if (fallbackSpace) { loc.inst.use = fallbackSpace.use; loc.inst.with = structuredClone(fallbackSpace.with || {}); fix(`space replaced by ${fallbackSpace.use}`); }
          } else { removed.push({ use: loc.inst.use, why: 'not in the catalogue' }); removals.push(loc.keys); fix(`removed unknown primitive ${loc.inst.use}`); }
          break;
        }
        case 'primitive_slot': {
          if (!loc || loc.keys.length !== 2) break;
          const inst = loc.inst, use = useOf(inst), first = list(doc.spaces)[0];
          // Where it belongs (a space in the wrong slot is only removed); null when there is nowhere to put it.
          const slot = isGraphics(use) ? listAt(doc, 'graphics') : isGenerator(use) ? (isBag(first) ? listAt(first, 'generators') : null) : isSpace(use) ? undefined : listAt(doc, 'systems');
          if (slot === null) break;
          removals.push(loc.keys);
          slot?.push(inst);
          fix(`moved ${inst.use} to its slot`);
          break;
        }
        case 'param_unknown': removals.push(keys); fix('dropped unknown param'); break;
        case 'param_range': {
          const v = getAt(doc, keys), s = field?.schema;
          if (typeof v === 'number' && s) { setAt(doc, keys, Math.min(s.max ?? Infinity, Math.max(s.min ?? -Infinity, v))); fix('clamped to range'); }
          else if (Array.isArray(v) && s?.type === 'list') { if (s.max !== undefined && v.length > s.max) v.length = s.max; else while (v.length < (s.min || 0)) v.push(synthesize(s.of, ctx)); fix('resized list'); }
          else if (s && !s.required) { removals.push(keys); fix('reset to default'); }
          break;
        }
        case 'param_type': case 'param_option': {
          const s = field?.schema;
          if (field && s && !s.required && field.rest.length > 1) { removals.push(keys); fix('reset to default'); }
          else if (s) { setAt(doc, keys, synthesize(s, ctx)); fix('synthesized value'); }
          break;
        }
        case 'param_missing': {
          if (field?.schema) { setAt(doc, keys, synthesize(field.schema, ctx)); fix(comp ? `synthesized required ${comp.component} field from ${comp.owner}` : 'synthesized required param'); }
          break;
        }
        case 'ref_unknown': {
          const m = /unknown (\w+) '([^']*)'/.exec(e.message || ''); if (!m) break;
          const [, kind, bad] = m;
          const target = getAt(doc, keys);
          /** @type {Key[] | null} */
          let pointer = null;
          if (typeof target === 'string') pointer = keys;
          else if (isBag(target)) { const k = Object.keys(target).find(k => target[k] === bad); if (k !== undefined) pointer = [...keys, k]; }
          if (!pointer || !pointer.length) {
            if (kind === 'archetype' && e.path === 'player.archetype') { addToCollection('content.archetypes', 'archetype', bad); progressed = true; }
            break;
          }
          const existing = idsOf(doc, registry, kind);
          const close = existing.find(id => near(id, bad));
          if (close) { setAt(doc, pointer, close); fix(`re-pointed to ${kind} '${close}'`); break; }
          const at = collectionOf(registry, kind);
          if (at && CREATABLE.has(kind)) { addToCollection(at, kind, slug(bad)); if (slug(bad) !== bad) setAt(doc, pointer, slug(bad)); progressed = true; break; }
          // Not creatable (zones, beats, spaces...): drop the dangling element, else point at an existing id.
          const parentKeys = pointer.slice(0, -1), parent = getAt(doc, parentKeys), grand = getAt(doc, parentKeys.slice(0, -1));
          if (Array.isArray(parent)) { removals.push(pointer); fix(`dropped reference to unknown ${kind}`); }
          else if (Array.isArray(grand) && typeof parentKeys.at(-1) === 'number' && !loc?.schema?.required) { removals.push(parentKeys); fix(`dropped element pointing at unknown ${kind}`); }
          else if (existing.length) { setAt(doc, pointer, existing[0]); fix(`pointed at ${kind} '${existing[0]}'`); }
          break;
        }
        case 'capability_missing': {
          if (!loc) break;
          const need = requirementsOf(registry, useOf(loc.inst)).capabilities;
          const boundId = loc.inst.space ?? prop(list(doc.spaces)[0], 'id');
          const bound = objects(doc.spaces).find(s => s.id === boundId);
          const variant = bound && spaceVariants(registry, useOf(bound)).find(v => need.every(c => v.caps.has(c)));
          if (bound && variant && Object.keys(variant.with).length) { bound.with = { ...obj(bound.with), ...variant.with }; fix(`configured space '${bound.id}' with ${JSON.stringify(variant.with)}`); break; }
          const other = objects(doc.spaces).find(s => s.id !== boundId && spaceVariants(registry, useOf(s)).some(v => need.every(c => v.caps.has(c))));
          if (other && !isSpace(useOf(loc.inst))) { loc.inst.space = other.id; fix(`bound to space '${other.id}'`); break; }
          if (kept(loc.inst.use)) break;
          removed.push({ use: loc.inst.use, why: e.message, kind: 'capability' }); removals.push(loc.keys); fix(`removed ${loc.inst.use}: ${e.message}`);
          break;
        }
        case 'requires_unmet': {
          const m = /requires a '([^']+)'/.exec(e.message || '');
          const s = m && satisfying(registry, m[1]);
          if (s && addSystem(s, e.code)) progressed = true;
          else if (loc && !kept(loc.inst.use)) { removed.push({ use: loc.inst.use, why: e.message }); removals.push(loc.keys); fix(`removed ${loc.inst.use}: ${e.message}`); }
          break;
        }
        case 'service_missing': {
          const m = /service '([^']+)'/.exec(e.message || '');
          const provider = m && registry.ids().find(id => (registry.get(id)?.card.provides?.services || []).includes(m[1]));
          if (provider && addSystem(provider, e.code)) progressed = true;
          else if (loc && !kept(loc.inst.use)) { removed.push({ use: loc.inst.use, why: e.message }); removals.push(loc.keys); fix(`removed ${loc.inst.use}: ${e.message}`); }
          break;
        }
        case 'vocabulary_owner_missing': {
          const m = /provided by '([^']+)'/.exec(e.message || '') || /"use": "([^"]+)"/.exec(e.hint || '');
          if (m && addSystem(m[1], e.code)) progressed = true;
          else if (m && list(doc.systems).some(s => prop(s, 'use') === m[1])) progressed = true;
          // The owner was isolated (excluded): its vocabulary in document data is neutralised, not left dangling.
          else if (m && exclude.has(m[1]) && keys.length) { removals.push(keys); fix(`dropped ${/^(\w+)/.exec(e.message || '')?.[1] || 'vocabulary'} owned by isolated '${m[1]}'`); }
          break;
        }
        case 'primitive_conflict': if (loc && !kept(loc.inst.use)) { removed.push({ use: loc.inst.use, why: e.message }); removals.push(loc.keys); fix(`removed ${loc.inst.use}: ${e.message}`); } break;
        case 'predicate_unknown': case 'effect_unknown': {
          const value = getAt(doc, keys);
          const kind = e.code === 'effect_unknown' ? step(value, 'do') : value && typeof value === 'object' ? Object.keys(value)[0] : null;
          const provider = e.code === 'effect_unknown' ? vocab.effects[String(kind)] : vocab.predicates[String(kind)];
          if (provider && !list(doc.systems).some(s => prop(s, 'use') === provider) && addSystem(provider, e.code)) { progressed = true; break; }
          removals.push(keys); fix(`removed unknown ${e.code === 'effect_unknown' ? 'effect' : 'predicate'} '${kind}'`);
          break;
        }
        case 'predicate_invalid': removals.push(keys); fix('removed invalid predicate'); break;
        // A malformed effect inside story or dialogue data (a missing target): the effect goes, the beat or line stays.
        case 'effect_invalid': if (/^plot\./.test(e.path) && typeof keys.at(-1) === 'number') { removals.push(keys); fix('removed invalid effect'); } break;
        case 'character_unspawnable': {
          // A character with no body: the body most other characters use (the game's NPC archetype), else no body.
          const c = getAt(doc, keys); if (!isBag(c)) break;
          /** @type {Map<unknown, number>} */
          const counts = new Map();
          for (const o of list(prop(doc.plot, 'characters'))) { const body = prop(o, 'archetype'); if (body) counts.set(body, (counts.get(body) || 0) + 1); }
          const common = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
          if (common) { c.archetype = common; fix(`gave the character the common body '${common}'`); } else { c.spawn = false; fix('character has no body (spawn: false)'); }
          break;
        }
        case 'plot_missing': {
          const plot = (doc.plot ??= {}); if (!isBag(plot)) break;
          const storyboard = (plot.storyboard ??= {}); if (!isBag(storyboard)) break;
          storyboard.acts = [{ id: 'act_1', title: 'Act 1', beats: [{ id: 'begin', title: 'Begin' }] }]; fix('added a minimal storyboard');
          break;
        }
        default: {
          const last = keys.at(-1);
          // "archetype 'x' has no <component> component": give it the component, synthesized from the owning card's shape.
          if (/has no (\w+) component/.test(String(e.message || '')) && /archetype '([^']+)'/.test(String(e.message || ''))) {
            const comp = /has no (\w+) component/.exec(String(e.message))?.[1] || '', id = /archetype '([^']+)'/.exec(String(e.message))?.[1] || '';
            const owner = registry.cards().find(c => c.components?.[comp]);
            const arch = /** @type {any[]} */ (/** @type {any} */ (doc.content)?.archetypes || []).find(a => a?.id === id);
            if (owner?.components && arch) { arch.components = arch.components && typeof arch.components === 'object' ? arch.components : {}; arch.components[comp] = synthesize(owner.components[comp], ctx); fix(`gave '${id}' a ${comp} component (${owner.id})`); break; }
          }
          // A primitive's own validate() code inside an instance's params: fall back to the param's default.
          if (loc?.schema && !loc.schema.required && loc.rest.length > 1) { removals.push(keys); fix(`reset ${e.code} param to default`); }
          // A primitive's "<something>_unknown" on document data is a dangling field or pointer: drop that field
          // (an optional `next`, an unknown key). Only fields, never whole entries, so content is not lost.
          // A malformed entry in document data (a primitive's validator ran checkFields on it): drop the field when
          // optional-looking, else the list element that holds it. Base content is protected by the callers' guards.
          else if (!loc && ['param_type', 'param_missing', 'param_option', 'param_range', 'param_unknown'].includes(e.code) && /^(plot|content)\./.test(e.path)) {
            const parentKeys = keys.slice(0, -1), grand = getAt(doc, parentKeys.slice(0, -1));
            if (e.code === 'param_unknown' || (e.code !== 'param_missing' && last !== 'id' && last !== 'kind' && typeof last === 'string' && getAt(doc, keys) !== undefined && !Array.isArray(grand))) { removals.push(keys); fix(`dropped malformed field (${e.code})`); }
            else if (Array.isArray(grand) && typeof parentKeys.at(-1) === 'number') { removals.push(parentKeys); fix(`dropped malformed entry (${e.code})`); }
          }
          // A reference field (its declared shape names where its ids come from) is re-pointed at the document's ids when a
          // value is close to one; a required one is never dropped (that only turns "unknown id" into "missing field"):
          // its error, with the allowed ids, goes to the model.
          else if (!loc && /_unknown$/.test(e.code) && /^(plot|content)\./.test(e.path) && typeof last === 'string' && getAt(doc, keys) !== undefined && last !== 'id' && last !== 'kind') {
            const declared = declaredAt(registry, keys);
            if (repointRef(doc, registry, keys, declared)) fix(`re-pointed to the document's ids (${e.code})`);
            else if (!required(declared)) { removals.push(keys); fix(`dropped field (${e.code})`); }
          }
        }
      }
    }
    // Removals last, deepest and highest index first, so earlier paths stay valid.
    const cmp = (/** @type {Key[]} */ a, /** @type {Key[]} */ b) => { for (let i = 0; i < Math.min(a.length, b.length); i++) { const x = a[i], y = b[i]; if (x === y) continue; return typeof x === 'number' && typeof y === 'number' ? y - x : String(y).localeCompare(String(x)); } return b.length - a.length; };
    const unique = [...new Map(removals.map(k => /** @type {[string, Key[]]} */ ([JSON.stringify(k), k]))).values()].sort(cmp);
    for (const k of unique) deleteAt(doc, k);
    if (!progressed) break;
  }
  checked = safePreflight(doc, registry, logic);
  // Last resort (procedural skeletons): an error no generic fix handles comes from some primitive's own
  // validate(); find the instance (system, generator or graphic) whose removal clears it, remove it, and report it as a gap.
  if (!checked.ok && isolate) {
    for (let pass = 0; pass < 6 && !checked.ok; pass++) {
      const before = checked.errors.length;
      // An instance and everything that requires it go together (removing a dependency alone just re-adds it).
      // Candidates: every instance but the spaces themselves (systems, generators, graphics), keyed by path.
      const cands = instances(doc).filter(x => !(x.keys.length === 2 && x.keys[0] === 'spaces') && !kept(x.inst.use));
      const keyOf = (/** @type {InstanceEntry} */ x) => JSON.stringify(x.keys);
      /** @param {InstanceEntry} x @returns {InstanceEntry[]} */
      const dependents = x => {
        const out = new Map([[keyOf(x), x]]);
        for (let grew = true; grew;) { grew = false; for (const c of cands) { if (out.has(keyOf(c))) continue; const req = requirementsOf(registry, useOf(c.inst)).primitives; if ([...out.values()].some(o => req.some(r => { const u = o.inst.use; return u === r || (isStr(u) && u.startsWith(r + '.')); }))) { out.set(keyOf(c), c); grew = true; } } }
        return [...out.values()];
      };
      /** @param {InstanceEntry[]} entries */
      const without = entries => { const d = structuredClone(doc); const sorted = entries.map(x => x.keys).sort((a, b) => { for (let i = 0; i < Math.min(a.length, b.length); i++) { const x = a[i], y = b[i]; if (x !== y) return typeof x === 'number' ? Number(y) - x : String(y).localeCompare(String(x)); } return b.length - a.length; }); for (const k of sorted) deleteAt(d, k); return d; };
      const located = checked.errors.map(e => locate(doc, registry, parsePath(e.path))).find(l => l && !(l.keys.length === 2 && l.keys[0] === 'spaces'));
      /** @type {InstanceEntry[] | null} */
      let drop = located ? dependents(cands.find(c => keyOf(c) === JSON.stringify(located.keys)) || located) : null;
      // A validator that crashes: find every instance whose validator throws on its own (all other candidates removed).
      if (!drop && checked.errors.some(e => e.code === 'preflight_threw')) {
        const crashers = cands.filter(c => safePreflight(without(cands.filter(o => o !== c)), registry, logic).errors.some(e => e.code === 'preflight_threw'));
        if (crashers.length && crashers.length < cands.length) drop = [...new Map(crashers.flatMap(x => dependents(x)).map(x => /** @type {[string, InstanceEntry]} */ ([keyOf(x), x]))).values()];
      }
      if (!drop) {
        let bestCount = before;
        // Score each removal after the ordinary repair (which may itself fix what the removal exposes), never re-adding it.
        for (const c of cands) { const group = dependents(c); if (group.some(x => kept(x.inst.use))) continue; const trial = repairDocument(without(group), { registry, logic, rounds: 3, fallbackSpace, protect, exclude: new Set([...exclude, ...group.map(x => x.inst.use)]) }); const n = trial.errors.length; if (n < bestCount) { drop = group; bestCount = n; } if (!n) break; }
      }
      if (drop && drop.some(x => kept(x.inst.use))) drop = null;
      if (!drop) break;
      for (const x of drop) {
        removed.push({ use: x.inst.use, why: `could not be configured automatically: ${checked.errors.slice(0, 2).map(e => `${e.code} ${e.path}`).join('; ')}` });
        fixes.push({ code: 'isolate', path: x.keys.join('.'), action: `removed ${x.inst.use}` });
      }
      Object.assign(doc, without(drop));
      for (const x of drop) exclude.add(x.inst.use); // isolated instances are never re-added by the next repair
      const again = repairDocument(doc, { registry, logic, rounds, fallbackSpace, exclude, protect });
      Object.assign(doc, again.doc); fixes.push(...again.fixes); removed.push(...again.removed);
      checked = again.checked || safePreflight(doc, registry, logic);
    }
  }
  // When ok, preflight accepted this draft (directly, or as the nested repair's result merged into it).
  return checked.ok
    ? { doc: /** @type {Doc} */ (doc), ok: true, checked, errors: checked.errors, fixes, removed, version: REPAIR_VERSION }
    : { doc, ok: false, checked, errors: withAllowed(doc, registry, checked.errors), fixes, removed, version: REPAIR_VERSION };
}

/** A declared field the document must fill (required, or a list with a minimum). @param {Record<string, unknown> | null | undefined} spec */
const required = spec => Boolean(spec && (spec.required || (spec.type === 'list' && Number(spec.min) > 0)));

/**
 * Re-point a reference field (string or list of strings) at the document's ids: values close to an allowed id take it,
 * list entries matching none are dropped while others remain. -> whether it changed anything.
 * @param {Bag} doc @param {RegistryLike} registry @param {Key[]} keys @param {unknown} spec the field's declared shape
 */
function repointRef(doc, registry, keys, spec) {
  const ref = referenceOf(registry, spec);
  const allowed = ref ? idsAt(doc, ref) : [];
  if (!allowed.length) return false;
  const pick = (/** @type {unknown} */ v) => (typeof v !== 'string' ? null : allowed.includes(v) ? v : allowed.find(id => near(id, v)) ?? null);
  const v = getAt(doc, keys);
  if (typeof v === 'string') { const p = pick(v); if (p && p !== v) { setAt(doc, keys, p); return true; } return false; }
  if (!Array.isArray(v)) return false;
  const next = [...new Set(v.map(pick).filter(isStr))];
  if (!next.length || JSON.stringify(next) === JSON.stringify(v)) return false;
  setAt(doc, keys, next); return true;
}

/**
 * The ids a field's declaration says its values come from, in this document: a data section's field (card.data),
 * an instance param or an archetype component field; a list element refers through its list. -> { ref, ids } or null.
 * @param {unknown} doc @param {RegistryLike} registry @param {Key[]} keys
 */
function allowedAt(doc, registry, keys) {
  for (const k of typeof keys.at(-1) === 'number' ? [keys, keys.slice(0, -1)] : [keys]) {
    const spec = declaredAt(registry, k) ?? locate(doc, registry, k)?.schema ?? componentAt(registry, k)?.schema;
    const ref = referenceOf(registry, spec);
    const ids = ref ? [...new Set(idsAt(doc, ref))] : [];
    if (ref && ids.length) return { ref, ids };
  }
  return null;
}

/**
 * Errors on reference fields carry the allowed ids in their hint, so a repair round can pick instead of guessing.
 * @param {unknown} doc @param {RegistryLike} registry @param {Problem[]} errors @returns {Problem[]}
 */
export function withAllowed(doc, registry, errors) {
  return errors.map(e => {
    const a = e.path ? allowedAt(doc, registry, parsePath(e.path)) : null;
    if (!a) return e;
    const what = a.ref === ZONES ? 'zone ids' : `${a.ref} ids`;
    return { ...e, hint: `${e.hint ? `${e.hint}; ` : ''}use only the document's ${what}: ${a.ids.slice(0, 40).join(', ')}` };
  });
}

const PREDICATE_KEYS = new Set(['when', 'gate', 'if', 'requires', 'fail', 'condition', 'unless', 'not']);
/**
 * Primitives that register effects/predicates the document uses but that the document does not include.
 * @param {unknown} doc @param {RegistryLike} registry @param {ReturnType<typeof vocabIndex>} [vocab] @returns {string[]}
 */
export function missingOwners(doc, registry, vocab = vocabIndex(registry)) {
  const d = obj(doc);
  const used = new Set([...list(d.systems), ...list(d.graphics), ...list(d.spaces).flatMap(s => [s, ...list(prop(s, 'generators'))])].map(i => prop(i, 'use')));
  /** @type {Set<string>} */
  const need = new Set();
  /** @param {unknown} v @param {string | null} key */
  const visit = (v, key) => {
    if (Array.isArray(v)) { v.forEach(x => visit(x, key)); return; }
    if (!isObj(v)) return;
    if (typeof v.do === 'string' && vocab.effects[v.do]) need.add(vocab.effects[v.do]);
    if (key !== null && PREDICATE_KEYS.has(key)) { const k = Object.keys(v)[0]; if (vocab.predicates[k]) need.add(vocab.predicates[k]); }
    for (const [k, x] of Object.entries(v)) visit(x, ['all', 'any'].includes(k) ? key : k);
  };
  visit({ plot: d.plot, spaces: d.spaces, systems: d.systems, content: d.content }, null);
  return [...need].filter(id => !used.has(id) && registry.has(id));
}

/** Errors as model feedback: code, path, message and hint, one per line. @param {Array<{ code: string, path?: string, message: string, hint?: unknown }>} errors @param {number} [limit] */
export const describeErrors = (errors, limit = 20) => errors.slice(0, limit).map(e => `- [${e.code}] ${e.path}: ${e.message}${e.hint ? ` (hint: ${String(e.hint).slice(0, 200)})` : ''}`).join('\n');

export { defaultsOf, REF_KINDS };
