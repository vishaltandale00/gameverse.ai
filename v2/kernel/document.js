// Game document preflight (gameverse.v2.game/0.2). Milliseconds, no
// execution: schema, id indexes and duplicates, primitive params, references,
// space capabilities, predicate/effect vocabularies, and data sections that
// no primitive reads. Errors carry stable codes, paths and fix hints.
import { checkFields, REF_KINDS } from './params.js';
import { KERNEL_EVENTS } from './world.js';

export const DOC_SCHEMA = 'gameverse.v2.game/0.2';
const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const BASE_DEFINES = [
  { kind: 'character', at: 'plot.characters' }, { kind: 'quest', at: 'plot.quests' }, { kind: 'ending', at: 'plot.endings' },
  { kind: 'dialogue', at: 'plot.dialogue' }, { kind: 'item', at: 'content.items' }, { kind: 'recipe', at: 'content.recipes' },
  { kind: 'archetype', at: 'content.archetypes' }, { kind: 'block', at: 'content.blocks' }, { kind: 'model', at: 'content.models' },
];
const get = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);

/**
 * Id indexes for every reference kind. Base kinds are listed above; a primitive
 * adds its own with card.defines: [{ kind, at: 'doc.path' }] (a list of {id}
 * or an id-keyed object) or [{ kind, in: 'configKey' }] (a list of {id} in each
 * of its instances' `with`). Nothing here is specific to any primitive.
 */
function buildIndexes(doc, errors, registry, instances) {
  const indexes = Object.fromEntries(REF_KINDS.map(k => [k, new Set()]));
  const add = (kind, id, path) => {
    indexes[kind] ??= new Set();
    if (typeof id !== 'string' || !SLUG.test(id)) { errors.push({ code: 'id_invalid', path, message: `${kind} id must be a lowercase slug` }); return; }
    if (indexes[kind].has(id)) errors.push({ code: 'id_duplicate', path, message: `duplicate ${kind} id '${id}'` });
    indexes[kind].add(id);
  };
  const addAll = (kind, value, path) => {
    if (Array.isArray(value)) value.forEach((v, i) => add(kind, v?.id, `${path}[${i}].id`));
    else if (value && typeof value === 'object') Object.keys(value).forEach(id => add(kind, id, `${path}.${id}`));
  };
  (doc.spaces || []).forEach((s, i) => {
    add('space', s.id, `spaces[${i}].id`);
    (s.zones || []).forEach((z, j) => add('zone', z.id, `spaces[${i}].zones[${j}].id`));
  });
  (doc.plot?.storyboard?.acts || []).forEach((a, i) => (a.beats || []).forEach((b, j) => add('beat', b.id, `plot.storyboard.acts[${i}].beats[${j}].id`)));
  const docDefines = [...BASE_DEFINES];
  for (const id of registry.ids()) for (const d of registry.get(id).card.defines || []) if (d.at && !docDefines.some(x => x.kind === d.kind && x.at === d.at)) docDefines.push(d);
  for (const d of docDefines) addAll(d.kind, get(doc, d.at), d.at);
  for (const { inst, path } of instances) for (const d of registry.get(inst?.use)?.card.defines || []) if (d.in) addAll(d.kind, inst.with?.[d.in], `${path}.with.${d.in}`);
  return indexes;
}

const ROOTS = /^(schema|id|title|logline|seed|views|spaces|systems|graphics|plot|content|player)(\.|\[|$)/;
function absolutePath(path, instancePath) {
  if (!path) return instancePath;
  if (ROOTS.test(path)) return path;
  return path === 'with' || path.startsWith('with.') ? `${instancePath}.${path}` : `${instancePath}.with${path.startsWith('[') ? '' : '.'}${path}`;
}

/** True when `name` is provided directly or by a `prefix:*` wildcard. */
export function provided(set, name) { return set.has(name) || (name.includes(':') && set.has(name.slice(0, name.indexOf(':')) + ':*')); }

export function preflight(doc, registry, logic) {
  const started = performance.now();
  const errors = [], warnings = [];
  if (!doc || typeof doc !== 'object') return { ok: false, errors: [{ code: 'schema', path: '$', message: 'document must be an object' }], warnings };
  if (doc.schema !== DOC_SCHEMA) errors.push({ code: 'schema', path: 'schema', message: `schema must be '${DOC_SCHEMA}'` });
  if (!SLUG.test(doc.id || '')) errors.push({ code: 'schema', path: 'id', message: 'id must be a lowercase slug' });
  if (typeof doc.title !== 'string' || !doc.title) errors.push({ code: 'schema', path: 'title', message: 'title is required' });
  if (!Array.isArray(doc.spaces) || !doc.spaces.length) errors.push({ code: 'schema', path: 'spaces', message: 'at least one space is required', hint: `space primitives: ${registry.ids('engine').filter(id => id.startsWith('engine.space.')).join(', ') || 'none registered'}` });

  const instances = [];
  (doc.spaces || []).forEach((s, i) => {
    instances.push({ inst: s, path: `spaces[${i}]`, family: 'engine.space', space: s.id });
    (s.generators || []).forEach((g, j) => instances.push({ inst: g, path: `spaces[${i}].generators[${j}]`, family: 'engine.generate', space: s.id }));
  });
  (doc.systems || []).forEach((s, i) => instances.push({ inst: s, path: `systems[${i}]`, family: null, space: s.space }));
  (doc.graphics || []).forEach((g, i) => instances.push({ inst: g, path: `graphics[${i}]`, family: 'graphics', space: g.space }));
  const indexes = buildIndexes(doc, errors, registry, instances);
  const vocab = [];
  const refs = { flag: { read: new Map(), write: new Map() }, var: { read: new Map(), write: new Map() }, event: { read: new Map(), write: new Map() } };
  const ctx = {
    doc, registry, indexes,
    /** Validators push non-fatal findings here: ctx.warn({code, path, message, hint}). */
    warn: w => warnings.push(w),
    checkPredicate: (p, path, errs) => { const k = logic.kindOf(p); if (k) vocab.push(['predicate', k, path]); logic.checkPredicate(p, path, errs, ctx); },
    checkEffect: (e, path, errs) => { if (e?.do) vocab.push(['effect', e.do, path]); logic.checkEffect(e, path, errs, ctx); },
    noteRef(kind, id, path, mode) {
      if (refs[kind]) { const m = refs[kind][mode]; if (!m.has(id)) m.set(id, path); return; }
      if (indexes[kind] && !indexes[kind].has(id)) errors.push({ code: 'ref_unknown', path, message: `unknown ${kind} '${id}'` });
    },
    provides: { events: new Set(KERNEL_EVENTS), vars: new Set(), services: new Set() },
  };

  // Which capabilities each space provides.
  const spaceCaps = new Map();

  const used = new Set();
  const normalized = [];
  for (const { inst, path, family, space } of instances) {
    const p = registry.get(inst?.use);
    if (!p) { errors.push({ code: 'primitive_unknown', path: `${path}.use`, message: `unknown primitive '${inst?.use}'`, hint: `${family || 'systems'}: ${registry.ids().filter(id => !family || id.startsWith(family)).slice(0, 40).join(', ')}` }); normalized.push(inst); continue; }
    if (family && !p.id.startsWith(family)) errors.push({ code: 'primitive_slot', path: `${path}.use`, message: `'${p.id}' cannot be used here; expected ${family}.*` });
    if (!family && (p.id.startsWith('engine.space.') || p.id.startsWith('engine.generate.') || p.family === 'graphics')) errors.push({ code: 'primitive_slot', path: `${path}.use`, message: `'${p.id}' belongs in ${p.family === 'graphics' ? 'graphics' : 'spaces'}` });
    const before = errors.length;
    const config = checkFields(p.card.params || {}, inst.with || {}, `${path}.with`, errors, ctx);
    const paramErrors = errors.length - before;
    if (space !== undefined && space !== null && !indexes.space.has(space)) errors.push({ code: 'ref_unknown', path: `${path}.space`, message: `unknown space '${space}'` });
    if (p.id.startsWith('engine.space.')) spaceCaps.set(inst.id, new Set(p.capabilities ? p.capabilities(config) : p.card.provides.capabilities || []));
    for (const e of p.card.provides.events || []) ctx.provides.events.add(e);
    for (const v of p.card.provides.vars || []) ctx.provides.vars.add(v);
    for (const v of p.card.provides.services || []) ctx.provides.services.add(v);
    used.add(p.id);
    normalized.push({ ...inst, with: config, _p: p, _path: path, _space: space, _paramErrors: paramErrors });
  }
  for (const n of normalized) {
    const p = n._p; if (!p) continue;
    const bound = n._space ?? doc.spaces?.[0]?.id;
    const caps = spaceCaps.get(bound) || new Set();
    const missing = (p.card.requires.capabilities || []).filter(c => !caps.has(c));
    if (missing.length) errors.push({ code: 'capability_missing', path: n._path, message: `'${p.id}' needs ${missing.join(', ')} from space '${bound}'`, hint: `space '${bound}' provides: ${[...caps].join(', ') || 'nothing'}` });
    for (const req of p.card.requires.primitives || []) if (![...used].some(id => id === req || id.startsWith(req + '.'))) errors.push({ code: 'requires_unmet', path: n._path, message: `'${p.id}' requires a '${req}' primitive` });
    for (const sv of p.card.requires.services || []) if (!ctx.provides.services.has(sv)) errors.push({ code: 'service_missing', path: n._path, message: `'${p.id}' needs service '${sv}'`, hint: 'add a primitive whose card provides it' });
    for (const c of p.card.conflicts || []) if (used.has(c)) errors.push({ code: 'primitive_conflict', path: n._path, message: `'${p.id}' conflicts with '${c}'` });
    // Validators always run so their stable codes surface alongside param errors, and never throw: a crash on
    // a config whose params already failed is explained by those errors and is not reported again.
    if (p.validate) {
      let found = [];
      try { found = p.validate(n.with, doc, ctx, { path: n._path, id: n.id, use: n.use, space: n._space ?? doc.spaces?.[0]?.id }) || []; }
      catch (error) { found = n._paramErrors ? [] : [{ code: 'validator_crashed', path: n._path, message: `'${p.id}' could not check this instance: ${String(error?.message || error).slice(0, 160)}`, hint: 'a field has the wrong shape; compare it with the card params' }]; }
      // Paths are document-absolute: a validator may report relative to its own config ('rooms[0].rect').
      for (const err of found) errors.push({ ...err, path: absolutePath(err.path, n._path) });
    }
  }

  // Vocabulary in the document must be owned by the kernel or by a primitive the document uses.
  const reported = new Set();
  for (const [type, kind, path] of vocab) {
    const owner = logic.owners?.[type]?.get(kind);
    if (!owner || owner === 'kernel' || used.has(owner) || registry.get(owner)?.card.ambient || reported.has(`${type}:${kind}`)) continue;
    reported.add(`${type}:${kind}`);
    errors.push({ code: 'vocabulary_owner_missing', path, message: `${type} '${kind}' is provided by '${owner}', which this document does not use`, hint: `add { "use": "${owner}" } to the document` });
  }

  // Data sections must be read by some primitive.
  const reads = new Set(['content.archetypes', ...[...used].flatMap(id => registry.get(id).card.reads || [])]); // the kernel spawns archetypes
  const sections = [...Object.keys(doc.plot || {}).filter(k => k !== 'premise').map(k => `plot.${k}`), ...Object.keys(doc.content || {}).map(k => `content.${k}`)];
  for (const s of sections) if (![...reads].some(r => s === r || s.startsWith(r + '.'))) warnings.push({ code: 'data_unused', path: s, message: `no primitive reads ${s}`, hint: 'add the primitive that uses it, or remove it' });

  if (doc.player) {
    if (!indexes.archetype.has(doc.player.archetype)) errors.push({ code: 'ref_unknown', path: 'player.archetype', message: `unknown archetype '${doc.player.archetype}'` });
    if (doc.player.space && !indexes.space.has(doc.player.space)) errors.push({ code: 'ref_unknown', path: 'player.space', message: `unknown space '${doc.player.space}'` });
  }
  for (const [id, path] of refs.flag.read) if (!refs.flag.write.has(id)) warnings.push({ code: 'flag_never_set', path, message: `flag '${id}' is read but nothing sets it` });
  for (const [id, path] of refs.event.read) if (!provided(ctx.provides.events, id)) warnings.push({ code: 'event_never_emitted', path, message: `no primitive emits '${id}'` });

  const ok = !errors.length;
  const out = ok ? { ...doc, spaces: doc.spaces.map((s, i) => ({ ...s, with: normalized.find(n => n._path === `spaces[${i}]`)?.with ?? s.with,
      ...(s.generators ? { generators: s.generators.map((g, j) => ({ ...g, with: normalized.find(n => n._path === `spaces[${i}].generators[${j}]`)?.with ?? g.with })) } : {}) })),
    systems: (doc.systems || []).map((s, i) => ({ ...s, with: normalized.find(n => n._path === `systems[${i}]`).with })),
    graphics: (doc.graphics || []).map((g, i) => ({ ...g, with: normalized.find(n => n._path === `graphics[${i}]`).with })) } : null;
  return { ok, errors, warnings, doc: out, capabilities: Object.fromEntries([...spaceCaps].map(([k, v]) => [k, [...v]])), ms: +(performance.now() - started).toFixed(2) };
}

// Collections a progressive-generation patch may append to (by id where present).
const APPEND = ['spaces', 'systems', 'graphics', 'plot.characters', 'plot.quests', 'plot.endings', 'content.items', 'content.recipes', 'content.archetypes', 'content.blocks'];

/**
 * Merge an additive patch into a document without mutating either.
 * - spaces: an entry with an existing id merges its zones/generators; new ids append.
 * - plot.storyboard.acts: an act with an existing id appends beats; new acts append.
 * - plot.dialogue, content.models: new keys are added.
 * - other APPEND collections: entries are appended.
 * Returns { doc, added } where added lists what was new, for extend hooks.
 */
export function mergePatch(base, patch) {
  const doc = structuredClone(base), added = { spaces: [], zones: [], systems: [], graphics: [], beats: [], acts: [], keys: [] };
  const at = (obj, path, make) => path.split('.').reduce((o, k, i, a) => (o[k] ??= (i === a.length - 1 ? make() : {})), obj);
  for (const s of patch.spaces || []) {
    const existing = doc.spaces.find(x => x.id === s.id);
    if (!existing) { doc.spaces.push(structuredClone(s)); added.spaces.push(s.id); continue; }
    for (const z of s.zones || []) { (existing.zones ??= []).push(structuredClone(z)); added.zones.push({ space: s.id, zone: z.id }); }
    for (const g of s.generators || []) (existing.generators ??= []).push(structuredClone(g));
  }
  for (const path of APPEND.filter(p => p !== 'spaces')) {
    const list = path.split('.').reduce((o, k) => o?.[k], patch);
    if (!Array.isArray(list) || !list.length) continue;
    at(doc, path, () => []).push(...structuredClone(list));
    if (path === 'systems' || path === 'graphics') added[path].push(...list.map((_, i) => at(doc, path, () => []).length - list.length + i));
    else added.keys.push(path);
  }
  for (const act of patch.plot?.storyboard?.acts || []) {
    const acts = at(doc, 'plot.storyboard.acts', () => []);
    const existing = acts.find(a => a.id === act.id);
    if (existing) { (existing.beats ??= []).push(...structuredClone(act.beats || [])); added.beats.push(...(act.beats || []).map(b => b.id)); }
    else { acts.push(structuredClone(act)); added.acts.push(act.id); added.beats.push(...(act.beats || []).map(b => b.id)); }
  }
  for (const path of ['plot.dialogue', 'content.models']) {
    const obj = path.split('.').reduce((o, k) => o?.[k], patch);
    if (obj) { Object.assign(at(doc, path, () => ({})), structuredClone(obj)); added.keys.push(path); }
  }
  for (const key of ['title', 'logline']) if (patch[key] !== undefined) doc[key] = patch[key];
  return { doc, added };
}
