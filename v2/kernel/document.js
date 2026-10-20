// Game document preflight (gameverse.v2.game/0.2). Milliseconds, no
// execution: schema, id indexes and duplicates, primitive params, references,
// space capabilities, predicate/effect vocabularies, and data sections that
// no primitive reads. Errors carry stable codes, paths and fix hints.
import { checkFields, REF_KINDS } from './params.js';
import { KERNEL_EVENTS } from './world.js';

export const DOC_SCHEMA = 'gameverse.v2.game/0.2';
const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function buildIndexes(doc, errors) {
  const indexes = Object.fromEntries(REF_KINDS.map(k => [k, new Set()]));
  const add = (kind, id, path) => {
    if (typeof id !== 'string' || !SLUG.test(id)) { errors.push({ code: 'id_invalid', path, message: `${kind} id must be a lowercase slug` }); return; }
    if (indexes[kind].has(id)) errors.push({ code: 'id_duplicate', path, message: `duplicate ${kind} id '${id}'` });
    indexes[kind].add(id);
  };
  (doc.spaces || []).forEach((s, i) => {
    add('space', s.id, `spaces[${i}].id`);
    (s.zones || []).forEach((z, j) => add('zone', z.id, `spaces[${i}].zones[${j}].id`));
  });
  (doc.plot?.characters || []).forEach((c, i) => add('character', c.id, `plot.characters[${i}].id`));
  (doc.plot?.quests || []).forEach((q, i) => add('quest', q.id, `plot.quests[${i}].id`));
  (doc.plot?.endings || []).forEach((e, i) => add('ending', e.id, `plot.endings[${i}].id`));
  (doc.plot?.storyboard?.acts || []).forEach((a, i) => (a.beats || []).forEach((b, j) => add('beat', b.id, `plot.storyboard.acts[${i}].beats[${j}].id`)));
  Object.keys(doc.plot?.dialogue || {}).forEach(id => add('dialogue', id, `plot.dialogue.${id}`));
  (doc.content?.items || []).forEach((it, i) => add('item', it.id, `content.items[${i}].id`));
  (doc.content?.recipes || []).forEach((r, i) => add('recipe', r.id, `content.recipes[${i}].id`));
  (doc.content?.archetypes || []).forEach((a, i) => add('archetype', a.id, `content.archetypes[${i}].id`));
  (doc.content?.blocks || []).forEach((b, i) => add('block', b.id, `content.blocks[${i}].id`));
  Object.keys(doc.content?.models || {}).forEach(id => add('model', id, `content.models.${id}`));
  return indexes;
}

export function preflight(doc, registry, logic) {
  const started = performance.now();
  const errors = [], warnings = [];
  if (!doc || typeof doc !== 'object') return { ok: false, errors: [{ code: 'schema', path: '$', message: 'document must be an object' }], warnings };
  if (doc.schema !== DOC_SCHEMA) errors.push({ code: 'schema', path: 'schema', message: `schema must be '${DOC_SCHEMA}'` });
  if (!SLUG.test(doc.id || '')) errors.push({ code: 'schema', path: 'id', message: 'id must be a lowercase slug' });
  if (typeof doc.title !== 'string' || !doc.title) errors.push({ code: 'schema', path: 'title', message: 'title is required' });
  if (!Array.isArray(doc.spaces) || !doc.spaces.length) errors.push({ code: 'schema', path: 'spaces', message: 'at least one space is required', hint: `space primitives: ${registry.ids('engine').filter(id => id.startsWith('engine.space.')).join(', ') || 'none registered'}` });

  const indexes = buildIndexes(doc, errors);
  const refs = { flag: { read: new Map(), write: new Map() }, var: { read: new Map(), write: new Map() }, event: { read: new Map(), write: new Map() } };
  const ctx = {
    doc, registry, indexes,
    checkPredicate: (p, path, errs) => logic.checkPredicate(p, path, errs, ctx),
    checkEffect: (e, path, errs) => logic.checkEffect(e, path, errs, ctx),
    noteRef(kind, id, path, mode) {
      if (refs[kind]) { const m = refs[kind][mode]; if (!m.has(id)) m.set(id, path); return; }
      if (indexes[kind] && !indexes[kind].has(id)) errors.push({ code: 'ref_unknown', path, message: `unknown ${kind} '${id}'` });
    },
    provides: { events: new Set(KERNEL_EVENTS), vars: new Set() },
  };

  // Which capabilities each space provides.
  const spaceCaps = new Map();
  const instances = [];
  (doc.spaces || []).forEach((s, i) => {
    instances.push({ inst: s, path: `spaces[${i}]`, family: 'engine.space', space: s.id });
    (s.generators || []).forEach((g, j) => instances.push({ inst: g, path: `spaces[${i}].generators[${j}]`, family: 'engine.generate', space: s.id }));
  });
  (doc.systems || []).forEach((s, i) => instances.push({ inst: s, path: `systems[${i}]`, family: null, space: s.space }));
  (doc.graphics || []).forEach((g, i) => instances.push({ inst: g, path: `graphics[${i}]`, family: 'graphics', space: g.space }));

  const used = new Set();
  const normalized = [];
  for (const { inst, path, family, space } of instances) {
    const p = registry.get(inst?.use);
    if (!p) { errors.push({ code: 'primitive_unknown', path: `${path}.use`, message: `unknown primitive '${inst?.use}'`, hint: `${family || 'systems'}: ${registry.ids().filter(id => !family || id.startsWith(family)).slice(0, 40).join(', ')}` }); normalized.push(inst); continue; }
    if (family && !p.id.startsWith(family)) errors.push({ code: 'primitive_slot', path: `${path}.use`, message: `'${p.id}' cannot be used here; expected ${family}.*` });
    if (!family && (p.id.startsWith('engine.space.') || p.id.startsWith('engine.generate.') || p.family === 'graphics')) errors.push({ code: 'primitive_slot', path: `${path}.use`, message: `'${p.id}' belongs in ${p.family === 'graphics' ? 'graphics' : 'spaces'}` });
    const config = checkFields(p.card.params || {}, inst.with || {}, `${path}.with`, errors, ctx);
    if (space !== undefined && space !== null && !indexes.space.has(space)) errors.push({ code: 'ref_unknown', path: `${path}.space`, message: `unknown space '${space}'` });
    if (p.id.startsWith('engine.space.')) spaceCaps.set(inst.id, new Set(p.capabilities ? p.capabilities(config) : p.card.provides.capabilities || []));
    for (const e of p.card.provides.events || []) ctx.provides.events.add(e);
    for (const v of p.card.provides.vars || []) ctx.provides.vars.add(v);
    used.add(p.id);
    normalized.push({ ...inst, with: config, _p: p, _path: path, _space: space });
  }
  for (const n of normalized) {
    const p = n._p; if (!p) continue;
    const bound = n._space ?? doc.spaces?.[0]?.id;
    const caps = spaceCaps.get(bound) || new Set();
    const missing = (p.card.requires.capabilities || []).filter(c => !caps.has(c));
    if (missing.length) errors.push({ code: 'capability_missing', path: n._path, message: `'${p.id}' needs ${missing.join(', ')} from space '${bound}'`, hint: `space '${bound}' provides: ${[...caps].join(', ') || 'nothing'}` });
    for (const req of p.card.requires.primitives || []) if (![...used].some(id => id === req || id.startsWith(req + '.'))) errors.push({ code: 'requires_unmet', path: n._path, message: `'${p.id}' requires a '${req}' primitive` });
    for (const c of p.card.conflicts || []) if (used.has(c)) errors.push({ code: 'primitive_conflict', path: n._path, message: `'${p.id}' conflicts with '${c}'` });
    for (const err of p.validate?.(n.with, doc, ctx) || []) errors.push({ ...err, path: err.path || n._path });
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
  for (const [id, path] of refs.event.read) if (!ctx.provides.events.has(id)) warnings.push({ code: 'event_never_emitted', path, message: `no primitive emits '${id}'` });

  const ok = !errors.length;
  const out = ok ? { ...doc, spaces: doc.spaces.map((s, i) => ({ ...s, with: normalized.find(n => n._path === `spaces[${i}]`)?.with ?? s.with })),
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
