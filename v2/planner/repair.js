// Deterministic document repair driven by preflight's stable error codes
// (KERNEL_API.md: errors carry code, path, message, hint). Each code has a
// generic fix: unknown params are dropped, out-of-range values clamped,
// missing required params synthesized from their schema, unknown references
// re-pointed to the nearest existing id or given a stub, missing primitives
// added from the catalogue, capability errors re-select a space configuration
// or another space, and only as a last resort is an instance removed (and
// reported as a gap). Model repair rounds only see what this cannot fix.
import { preflight, DOC_SCHEMA } from '../kernel/document.js';
import { REF_KINDS } from '../kernel/params.js';
import { defaultsOf, isSpace, isGenerator, isGraphics, satisfying, spaceVariants, requirementsOf } from './catalog.js';
import { vocabIndex } from './select.js';

export const REPAIR_VERSION = 'repair/0.1';

// ---------- paths ----------
export function parsePath(path) {
  const keys = [];
  String(path || '').replace(/([^.[\]]+)|\[(\d+)\]/g, (_, name, index) => { keys.push(index !== undefined ? Number(index) : name); return ''; });
  return keys;
}
export const getAt = (obj, keys) => keys.reduce((o, k) => (o == null ? undefined : o[k]), obj);
function setAt(obj, keys, value) {
  let parent = obj;
  for (let i = 0; i < keys.length - 1; i++) { if (parent[keys[i]] == null) parent[keys[i]] = typeof keys[i + 1] === 'number' ? [] : {}; parent = parent[keys[i]]; if (typeof parent !== 'object') return; }
  parent[keys.at(-1)] = value;
}
function deleteAt(obj, keys) {
  const parent = getAt(obj, keys.slice(0, -1)), k = keys.at(-1);
  if (Array.isArray(parent) && typeof k === 'number') parent.splice(k, 1);
  else if (parent && typeof parent === 'object') delete parent[k];
}
const slug = s => (String(s || '').toLowerCase().match(/[a-z0-9]+/g) || ['x']).join('_').slice(0, 60);

// ---------- id indexes (mirrors preflight's, read-only) ----------
const BASE_AT = { character: 'plot.characters', quest: 'plot.quests', ending: 'plot.endings', dialogue: 'plot.dialogue', item: 'content.items', recipe: 'content.recipes', archetype: 'content.archetypes', block: 'content.blocks', model: 'content.models' };
const get = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
export function collectionOf(registry, kind) {
  if (BASE_AT[kind]) return BASE_AT[kind];
  for (const id of registry.ids()) for (const d of registry.get(id).card.defines || []) if (d.kind === kind && d.at) return d.at;
  return null;
}
export function idsOf(doc, registry, kind) {
  if (kind === 'space') return (doc.spaces || []).map(s => s.id);
  if (kind === 'zone') return (doc.spaces || []).flatMap(s => (s.zones || []).map(z => z.id));
  if (kind === 'beat') return (doc.plot?.storyboard?.acts || []).flatMap(a => (a.beats || []).map(b => b.id));
  const at = collectionOf(registry, kind), out = [];
  if (at) { const v = get(doc, at); if (Array.isArray(v)) out.push(...v.map(x => x?.id).filter(Boolean)); else if (v && typeof v === 'object') out.push(...Object.keys(v)); }
  for (const id of registry.ids()) for (const d of registry.get(id).card.defines || []) if (d.kind === kind && d.in) for (const inst of instances(doc)) if (inst.inst.use === id) out.push(...(inst.inst.with?.[d.in] || []).map(x => x?.id).filter(Boolean));
  return out;
}
export function instances(doc) {
  const out = [];
  (doc.spaces || []).forEach((s, i) => { out.push({ inst: s, keys: ['spaces', i] }); (s.generators || []).forEach((g, j) => out.push({ inst: g, keys: ['spaces', i, 'generators', j] })); });
  (doc.systems || []).forEach((s, i) => out.push({ inst: s, keys: ['systems', i] }));
  (doc.graphics || []).forEach((g, i) => out.push({ inst: g, keys: ['graphics', i] }));
  return out;
}
/** The instance an error path points into, and the param schema at that path (when inside `with`). */
function locate(doc, registry, keys) {
  let hit = null;
  for (const x of instances(doc)) if (x.keys.every((k, i) => keys[i] === k) && (!hit || x.keys.length > hit.keys.length)) hit = x;
  if (!hit) return null;
  const rest = keys.slice(hit.keys.length);
  let schema = null;
  if (rest[0] === 'with') {
    let s = { type: 'object', fields: registry.get(hit.inst.use)?.card.params || {} };
    for (const k of rest.slice(1)) { s = s?.type === 'object' ? s.fields?.[k] : s?.type === 'list' ? s.of : null; if (!s) break; }
    schema = s;
  }
  return { ...hit, rest, schema };
}

// ---------- value synthesis from a param schema ----------
export function synthesize(schema, ctx) {
  if (!schema) return null;
  if (schema.default !== undefined) return structuredClone(schema.default);
  switch (schema.type) {
    case 'number': case 'integer': { let v = schema.min ?? 0; if (schema.max !== undefined) v = Math.min(v, schema.max); return schema.type === 'integer' ? Math.ceil(v) : v; }
    case 'boolean': return false;
    case 'string': return schema.options?.[0] ?? 'untitled';
    case 'ref': return ctx.ensureId(schema.to);
    case 'list': return Array.from({ length: schema.min || 0 }, () => synthesize(schema.of, ctx));
    case 'object': return Object.fromEntries(Object.entries(schema.fields || {}).filter(([, f]) => f.required).map(([k, f]) => [k, synthesize(f, ctx)]));
    case 'predicate': return { time: 0, gte: 0 };
    case 'effects': return [];
    default: return null;
  }
}

const near = (a, b) => a === b || slug(a) === slug(b) || (a.length > 3 && b.length > 3 && (a.includes(b) || b.includes(a))) || lev(a, b) <= Math.max(1, Math.floor(Math.min(a.length, b.length) / 5));
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const title = id => String(id).replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const STUB = { character: id => ({ id, name: title(id) }), archetype: id => ({ id, components: {} }), ending: id => ({ id, title: title(id), outcome: 'won' }), item: id => ({ id, name: title(id) }) };
const CREATABLE = new Set(['character', 'archetype', 'ending', 'item', 'quest', 'recipe']);

const asList = v => (v === undefined || v === null ? undefined : Array.isArray(v) ? v : [v]);
/**
 * Coerce the kernel document's own structure (ARCHITECTURE.md §3, not any primitive's params) so that
 * validators never see a beat whose `do` is an object or a space whose `zones` is a map. Models make these
 * slips; primitives' validators may assume the documented shapes.
 */
export function normalizeShape(doc, fixes = []) {
  const fix = (path, what) => fixes.push({ code: 'shape', path, action: what });
  for (const key of ['spaces', 'systems', 'graphics']) if (doc[key] !== undefined && !Array.isArray(doc[key])) { doc[key] = asList(doc[key]).filter(x => x && typeof x === 'object'); fix(key, 'made a list'); }
  (doc.spaces || []).forEach((s, i) => { for (const k of ['zones', 'generators']) if (s[k] !== undefined && !Array.isArray(s[k])) { s[k] = typeof s[k] === 'object' ? Object.entries(s[k]).map(([id, z]) => ({ id, ...(z || {}) })) : []; fix(`spaces[${i}].${k}`, 'made a list'); }
    (s.zones || []).forEach((z, j) => { if (z.exits !== undefined && !Array.isArray(z.exits)) { z.exits = asList(z.exits); fix(`spaces[${i}].zones[${j}].exits`, 'made a list'); } }); });
  const plot = doc.plot;
  if (plot && typeof plot === 'object') {
    for (const k of ['characters', 'quests', 'endings']) if (plot[k] !== undefined && !Array.isArray(plot[k])) { plot[k] = typeof plot[k] === 'object' ? Object.entries(plot[k]).map(([id, x]) => ({ id, ...(x || {}) })) : []; fix(`plot.${k}`, 'made a list'); }
    const acts = plot.storyboard?.acts;
    if (acts !== undefined && !Array.isArray(acts)) { plot.storyboard.acts = asList(acts); fix('plot.storyboard.acts', 'made a list'); }
    (plot.storyboard?.acts || []).forEach((a, i) => {
      if (!Array.isArray(a.beats)) { a.beats = asList(a.beats) || []; fix(`plot.storyboard.acts[${i}].beats`, 'made a list'); }
      a.beats.forEach((b, j) => {
        if (b.do !== undefined && !Array.isArray(b.do)) { b.do = asList(b.do); fix(`plot.storyboard.acts[${i}].beats[${j}].do`, 'made a list'); }
        if (b.after !== undefined && !Array.isArray(b.after)) { b.after = asList(b.after); fix(`plot.storyboard.acts[${i}].beats[${j}].after`, 'made a list'); }
      });
    });
  }
  if (doc.content && typeof doc.content === 'object') for (const k of ['items', 'archetypes', 'recipes']) if (doc.content[k] !== undefined && !Array.isArray(doc.content[k])) { doc.content[k] = typeof doc.content[k] === 'object' ? Object.entries(doc.content[k]).map(([id, x]) => ({ id, ...(x || {}) })) : []; fix(`content.${k}`, 'made a list'); }
  return doc;
}

/** preflight that reports a validator crash as an error instead of throwing. */
function safePreflight(doc, registry, logic) {
  try { return preflight(doc, registry, logic); }
  catch (error) { if (process.env.GV_DEBUG) console.error(error.stack); return { ok: false, errors: [{ code: 'preflight_threw', path: '$', message: `a validator crashed: ${String(error?.message || error).slice(0, 200)}`, hint: 'a section has the wrong shape (a list written as an object, a missing field)' }], warnings: [] }; }
}

/**
 * repairDocument(doc, { registry, logic, rounds }) -> { doc, ok, checked, errors, fixes, removed, rounds }
 * Never mutates its input. `removed` lists primitive instances dropped (reported as gaps by the caller).
 */
// Models often wrap a whole condition in `count` ({count: {var: 'x', gte: 5}}); `count` takes an event name.
// When the value is itself a registered predicate, the intended condition is that predicate: unwrap it.
function unwrapCountPredicates(doc, logic, fixes) {
  const kinds = new Set([...Object.keys(logic?.predicates || {}), 'all', 'any', 'not', 'var', 'flag', 'time', 'zone', 'near', 'cell']);
  const walk = (node, path) => {
    if (Array.isArray(node)) { node.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
    if (!node || typeof node !== 'object') return;
    const inner = node.count;
    if (inner && typeof inner === 'object' && !Array.isArray(inner) && Object.keys(inner).some(k => kinds.has(k))) {
      delete node.count; Object.assign(node, inner);
      fixes.push({ code: 'count_unwrapped', path, action: 'used the condition written inside count' });
    }
    for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
  };
  walk(doc, '');
}

export function repairDocument(input, { registry, logic, rounds = 6, fallbackSpace = null, isolate = false, exclude = new Set() } = {}) {
  const doc = structuredClone(input);
  const fixes = [], removed = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { doc: input, ok: false, checked: null, errors: [{ code: 'schema', path: '$', message: 'document must be an object' }], fixes, removed, version: REPAIR_VERSION };
  normalizeShape(doc, fixes);
  unwrapCountPredicates(doc, logic, fixes);
  const vocab = vocabIndex(registry);
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
  const addToCollection = (at, kind, id) => {
    const keys = at.split('.');
    let parent = doc;
    for (const k of keys.slice(0, -1)) parent = (parent[k] ??= {});
    const last = keys.at(-1);
    if (kind === 'dialogue' || kind === 'model' || (parent[last] && !Array.isArray(parent[last]) && typeof parent[last] === 'object')) { (parent[last] ??= {})[id] ??= {}; }
    else (parent[last] ??= []).push((STUB[kind] || (x => ({ id: x, name: title(x) })))(id));
    fixes.push({ code: 'ref_unknown', path: at, action: `added ${kind} '${id}'` });
  };
  const addSystem = (id, why) => {
    if (!id || !registry.has(id) || exclude.has(id)) return false;
    if (isSpace(id)) return false;
    if (isGenerator(id)) { (doc.spaces?.[0] && (doc.spaces[0].generators ??= []).push({ use: id })); }
    else if (isGraphics(id)) (doc.graphics ??= []).push({ use: id });
    else { if ((doc.systems || []).some(s => s.use === id)) return false; (doc.systems ??= []).push({ use: id }); }
    fixes.push({ code: why, path: 'systems', action: `added ${id}` }); return true;
  };

  let checked = null;
  for (let round = 0; round < rounds; round++) {
    checked = safePreflight(doc, registry, logic);
    // Preflight accepts vocabulary whose owning primitive is registered but not in the document
    // (kernel request: pipeline.md); add the owners so the effects run with their primitive installed.
    if (checked.ok) {
      const missing = missingOwners(doc, registry, vocab);
      if (missing.length && round < rounds - 1) { for (const id of missing) addSystem(id, 'vocabulary_owner'); continue; }
      return { doc, ok: true, checked, errors: [], fixes, removed, rounds: round, version: REPAIR_VERSION };
    }
    const removals = [];
    let progressed = false;
    const done = new Set();
    for (const e of checked.errors) {
      const keys = parsePath(e.path), sig = `${e.code}|${e.path}`;
      if (done.has(sig)) continue; done.add(sig);
      const fix = action => { fixes.push({ code: e.code, path: e.path, action }); progressed = true; };
      const loc = locate(doc, registry, keys);
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
          const inst = loc.inst; removals.push(loc.keys);
          if (isGraphics(inst.use)) (doc.graphics ??= []).push(inst);
          else if (isGenerator(inst.use)) (doc.spaces?.[0]?.generators ?? (doc.spaces[0].generators = [])).push(inst);
          else if (!isSpace(inst.use)) (doc.systems ??= []).push(inst);
          fix(`moved ${inst.use} to its slot`);
          break;
        }
        case 'param_unknown': removals.push(keys); fix('dropped unknown param'); break;
        case 'param_range': {
          const v = getAt(doc, keys), s = loc?.schema;
          if (typeof v === 'number' && s) { setAt(doc, keys, Math.min(s.max ?? Infinity, Math.max(s.min ?? -Infinity, v))); fix('clamped to range'); }
          else if (Array.isArray(v) && s?.type === 'list') { if (s.max !== undefined && v.length > s.max) v.length = s.max; else while (v.length < (s.min || 0)) v.push(synthesize(s.of, ctx)); fix('resized list'); }
          else if (s && !s.required) { removals.push(keys); fix('reset to default'); }
          break;
        }
        case 'param_type': case 'param_option': {
          const s = loc?.schema;
          if (s && !s.required && loc.rest.length > 1) { removals.push(keys); fix('reset to default'); }
          else if (s) { setAt(doc, keys, synthesize(s, ctx)); fix('synthesized value'); }
          break;
        }
        case 'param_missing': {
          if (loc?.schema) { setAt(doc, keys, synthesize(loc.schema, ctx)); fix('synthesized required param'); }
          break;
        }
        case 'ref_unknown': {
          const m = /unknown (\w+) '([^']*)'/.exec(e.message || ''); if (!m) break;
          const [, kind, bad] = m;
          const target = getAt(doc, keys);
          const pointer = typeof target === 'string' ? keys : (target && typeof target === 'object' ? [...keys, Object.keys(target).find(k => target[k] === bad)] : null);
          if (!pointer || pointer.at(-1) === undefined) {
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
          const need = requirementsOf(registry, loc.inst.use).capabilities;
          const boundId = loc.inst.space ?? doc.spaces?.[0]?.id;
          const bound = doc.spaces?.find(s => s.id === boundId);
          const variant = bound && spaceVariants(registry, bound.use).find(v => need.every(c => v.caps.has(c)));
          if (variant && Object.keys(variant.with).length) { bound.with = { ...(bound.with || {}), ...variant.with }; fix(`configured space '${bound.id}' with ${JSON.stringify(variant.with)}`); break; }
          const other = (doc.spaces || []).find(s => s.id !== boundId && spaceVariants(registry, s.use).some(v => need.every(c => v.caps.has(c))));
          if (other && !isSpace(loc.inst.use)) { loc.inst.space = other.id; fix(`bound to space '${other.id}'`); break; }
          removed.push({ use: loc.inst.use, why: e.message, kind: 'capability' }); removals.push(loc.keys); fix(`removed ${loc.inst.use}: ${e.message}`);
          break;
        }
        case 'requires_unmet': {
          const m = /requires a '([^']+)'/.exec(e.message || '');
          const s = m && satisfying(registry, m[1]);
          if (s && addSystem(s, e.code)) progressed = true;
          else if (loc) { removed.push({ use: loc.inst.use, why: e.message }); removals.push(loc.keys); fix(`removed ${loc.inst.use}: ${e.message}`); }
          break;
        }
        case 'service_missing': {
          const m = /service '([^']+)'/.exec(e.message || '');
          const provider = m && registry.ids().find(id => (registry.get(id).card.provides?.services || []).includes(m[1]));
          if (provider && addSystem(provider, e.code)) progressed = true;
          else if (loc) { removed.push({ use: loc.inst.use, why: e.message }); removals.push(loc.keys); fix(`removed ${loc.inst.use}: ${e.message}`); }
          break;
        }
        case 'vocabulary_owner_missing': {
          const m = /provided by '([^']+)'/.exec(e.message || '') || /"use": "([^"]+)"/.exec(e.hint || '');
          if (m && addSystem(m[1], e.code)) progressed = true;
          else if (m && (doc.systems || []).some(s => s.use === m[1])) progressed = true;
          // The owner was isolated (excluded): its vocabulary in document data is neutralised, not left dangling.
          else if (m && exclude.has(m[1]) && keys.length) { removals.push(keys); fix(`dropped ${/^(\w+)/.exec(e.message || '')?.[1] || 'vocabulary'} owned by isolated '${m[1]}'`); }
          break;
        }
        case 'primitive_conflict': if (loc) { removed.push({ use: loc.inst.use, why: e.message }); removals.push(loc.keys); fix(`removed ${loc.inst.use}: ${e.message}`); } break;
        case 'predicate_unknown': case 'effect_unknown': {
          const value = getAt(doc, keys);
          const kind = e.code === 'effect_unknown' ? value?.do : value && typeof value === 'object' ? Object.keys(value)[0] : null;
          const provider = e.code === 'effect_unknown' ? vocab.effects[kind] : vocab.predicates[kind];
          if (provider && !(doc.systems || []).some(s => s.use === provider) && addSystem(provider, e.code)) { progressed = true; break; }
          removals.push(keys); fix(`removed unknown ${e.code === 'effect_unknown' ? 'effect' : 'predicate'} '${kind}'`);
          break;
        }
        case 'predicate_invalid': removals.push(keys); fix('removed invalid predicate'); break;
        case 'plot_missing': {
          doc.plot ??= {}; doc.plot.storyboard ??= {}; doc.plot.storyboard.acts = [{ id: 'act_1', title: 'Act 1', beats: [{ id: 'begin', title: 'Begin' }] }]; fix('added a minimal storyboard');
          break;
        }
        default:
          // A primitive's own validate() code inside an instance's params: fall back to the param's default.
          if (loc?.schema && !loc.schema.required && loc.rest.length > 1) { removals.push(keys); fix(`reset ${e.code} param to default`); }
          // A primitive's "<something>_unknown" on document data is a dangling field or pointer: drop that field
          // (an optional `next`, an unknown key). Only fields, never whole entries, so content is not lost.
          // A malformed entry in document data (a primitive's validator ran checkFields on it): drop the field when
          // optional-looking, else the list element that holds it. Base content is protected by the callers' guards.
          else if (!loc && ['param_type', 'param_missing', 'param_option', 'param_range', 'param_unknown'].includes(e.code) && /^(plot|content)\./.test(e.path)) {
            const parentKeys = keys.slice(0, -1), grand = getAt(doc, parentKeys.slice(0, -1));
            if (e.code === 'param_unknown' || (e.code !== 'param_missing' && !['id', 'kind'].includes(keys.at(-1)) && typeof keys.at(-1) === 'string' && getAt(doc, keys) !== undefined && !Array.isArray(grand))) { removals.push(keys); fix(`dropped malformed field (${e.code})`); }
            else if (Array.isArray(grand) && typeof parentKeys.at(-1) === 'number') { removals.push(parentKeys); fix(`dropped malformed entry (${e.code})`); }
          }
          else if (!loc && /_unknown$/.test(e.code) && /^(plot|content)\./.test(e.path) && typeof keys.at(-1) === 'string' && getAt(doc, keys) !== undefined && !['id', 'kind'].includes(keys.at(-1))) { removals.push(keys); fix(`dropped field (${e.code})`); }
      }
    }
    // Removals last, deepest and highest index first, so earlier paths stay valid.
    const cmp = (a, b) => { for (let i = 0; i < Math.min(a.length, b.length); i++) { if (a[i] === b[i]) continue; return typeof a[i] === 'number' && typeof b[i] === 'number' ? b[i] - a[i] : String(b[i]).localeCompare(String(a[i])); } return b.length - a.length; };
    const unique = [...new Map(removals.map(k => [JSON.stringify(k), k])).values()].sort(cmp);
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
      const cands = instances(doc).filter(x => !(x.keys.length === 2 && x.keys[0] === 'spaces'));
      const keyOf = x => JSON.stringify(x.keys);
      const dependents = x => {
        const out = new Map([[keyOf(x), x]]);
        for (let grew = true; grew;) { grew = false; for (const c of cands) { if (out.has(keyOf(c))) continue; const req = requirementsOf(registry, c.inst.use).primitives; if ([...out.values()].some(o => req.some(r => o.inst.use === r || o.inst.use.startsWith(r + '.')))) { out.set(keyOf(c), c); grew = true; } } }
        return [...out.values()];
      };
      const without = list => { const d = structuredClone(doc); const sorted = list.map(x => x.keys).sort((a, b) => { for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return typeof a[i] === 'number' ? b[i] - a[i] : String(b[i]).localeCompare(String(a[i])); return b.length - a.length; }); for (const k of sorted) deleteAt(d, k); return d; };
      const located = checked.errors.map(e => locate(doc, registry, parsePath(e.path))).find(l => l && !(l.keys.length === 2 && l.keys[0] === 'spaces'));
      let drop = located ? dependents(cands.find(c => keyOf(c) === JSON.stringify(located.keys)) || located) : null;
      // A validator that crashes: find every instance whose validator throws on its own (all other candidates removed).
      if (!drop && checked.errors.some(e => e.code === 'preflight_threw')) {
        const crashers = cands.filter(c => safePreflight(without(cands.filter(o => o !== c)), registry, logic).errors.some(e => e.code === 'preflight_threw'));
        if (crashers.length && crashers.length < cands.length) drop = [...new Map(crashers.flatMap(dependents).map(x => [keyOf(x), x])).values()];
      }
      if (!drop) {
        let bestCount = before;
        // Score each removal after the ordinary repair (which may itself fix what the removal exposes), never re-adding it.
        for (const c of cands) { const list = dependents(c); const trial = repairDocument(without(list), { registry, logic, rounds: 3, fallbackSpace, exclude: new Set([...exclude, ...list.map(x => x.inst.use)]) }); const n = trial.errors.length; if (n < bestCount) { drop = list; bestCount = n; } if (!n) break; }
      }
      if (!drop) break;
      for (const x of drop) {
        removed.push({ use: x.inst.use, why: `could not be configured automatically: ${checked.errors.slice(0, 2).map(e => `${e.code} ${e.path}`).join('; ')}` });
        fixes.push({ code: 'isolate', path: x.keys.join('.'), action: `removed ${x.inst.use}` });
      }
      Object.assign(doc, without(drop));
      for (const x of drop) exclude.add(x.inst.use); // isolated instances are never re-added by the next repair
      const again = repairDocument(doc, { registry, logic, rounds, fallbackSpace, exclude });
      Object.assign(doc, again.doc); fixes.push(...again.fixes); removed.push(...again.removed);
      checked = again.checked || safePreflight(doc, registry, logic);
    }
  }
  return { doc, ok: checked.ok, checked, errors: checked.errors, fixes, removed, version: REPAIR_VERSION };
}

const PREDICATE_KEYS = new Set(['when', 'gate', 'if', 'requires', 'fail', 'condition', 'unless', 'not']);
/** Primitives that register effects/predicates the document uses but that the document does not include. */
export function missingOwners(doc, registry, vocab = vocabIndex(registry)) {
  const used = new Set([...(doc.systems || []), ...(doc.graphics || []), ...(doc.spaces || []).flatMap(s => [s, ...(s.generators || [])])].map(i => i?.use));
  const need = new Set();
  const visit = (v, key) => {
    if (Array.isArray(v)) { v.forEach(x => visit(x, key)); return; }
    if (!v || typeof v !== 'object') return;
    if (typeof v.do === 'string' && vocab.effects[v.do]) need.add(vocab.effects[v.do]);
    if (PREDICATE_KEYS.has(key)) { const k = Object.keys(v)[0]; if (vocab.predicates[k]) need.add(vocab.predicates[k]); }
    for (const [k, x] of Object.entries(v)) visit(x, ['all', 'any'].includes(k) ? key : k);
  };
  visit({ plot: doc.plot, spaces: doc.spaces, systems: doc.systems, content: doc.content }, null);
  return [...need].filter(id => !used.has(id) && registry.has(id));
}

/** Errors as model feedback: code, path, message and hint, one per line. */
export const describeErrors = (errors, limit = 20) => errors.slice(0, limit).map(e => `- [${e.code}] ${e.path}: ${e.message}${e.hint ? ` (hint: ${String(e.hint).slice(0, 200)})` : ''}`).join('\n');

export { defaultsOf, REF_KINDS };
