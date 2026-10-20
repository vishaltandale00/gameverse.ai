// Layer 3 of ARCHITECTURE.md §4: detail patches, one task per zone, written in
// parallel. A patch is additive (kernel mergePatch shape). Each one is merged
// into the current document, repaired by stable error code, guarded (it may
// not drop or rewrite existing content, nor put new beats on the critical
// path), verified (no provable softlock), and then hot-loaded by hosts via
// mergePatch + rt.extend. Without a writer a procedural detailer adds local
// characters and finds, so the layer exists at zero model cost too.
import { mergePatch } from '../kernel/document.js';
import { cardText, vocabulary } from './catalog.js';
import { vocabIndex } from './select.js';
import { repairDocument, describeErrors, idsOf } from './repair.js';
import { verifyDocument, regressed, newErrors } from './verify-adapter.js';
import { shrunkLists } from './revision-check.js';
import { parseReply } from './writer.js';

export const DETAIL_VERSION = 'detail/0.1';
const PATCH_KEYS = ['spaces', 'systems', 'graphics', 'plot', 'content'];

export function detailTasks(doc, { max = 8 } = {}) {
  const tasks = [];
  for (const s of doc.spaces || []) for (const z of s.zones || []) tasks.push({ id: `zone:${s.id}:${z.id}`, kind: 'zone', space: s.id, zone: z.id, name: z.name || z.id });
  return tasks.slice(0, max);
}

const prefixed = (id, zone) => (String(id).startsWith(`${zone}_`) ? String(id) : `${zone}_${String(id).replace(/[^a-z0-9_-]/g, '_')}`.slice(0, 63));

/**
 * Normalize a patch for one zone: only additive sections, new ids namespaced by the zone (parallel
 * patches never collide), new beats optional (detail never changes the critical path) and appended
 * to acts that exist, existing spaces receiving generators only (zones are the outline's).
 */
export function sanitizePatch(patch, task, current) {
  const out = {};
  for (const k of PATCH_KEYS) if (patch?.[k] !== undefined) out[k] = structuredClone(patch[k]);
  const rename = new Map();
  const remap = list => (Array.isArray(list) ? list : []).filter(x => x && typeof x === 'object').map(x => { if (x.id) { const id = prefixed(x.id, task.zone); rename.set(x.id, id); x.id = id; } return x; });
  if (out.plot) {
    const p = out.plot; const keep = {};
    if (p.characters) keep.characters = remap(p.characters);
    if (p.quests) keep.quests = remap(p.quests);
    if (p.endings) keep.endings = remap(p.endings);
    if (p.dialogue && typeof p.dialogue === 'object') keep.dialogue = Object.fromEntries(Object.entries(p.dialogue).map(([k, v]) => { const id = prefixed(k, task.zone); rename.set(k, id); return [id, v]; }));
    const acts = new Set((current.plot?.storyboard?.acts || []).map(a => a.id));
    const beats = (p.storyboard?.acts || []).filter(a => acts.has(a.id)).map(a => ({ id: a.id, beats: remap(a.beats).map(b => ({ ...b, optional: true })) })).filter(a => a.beats.length);
    if (beats.length) keep.storyboard = { acts: beats };
    out.plot = keep;
  }
  if (out.content) {
    const c = out.content; const keep = {};
    for (const k of ['items', 'archetypes', 'recipes', 'blocks']) if (c[k]) keep[k] = remap(c[k]);
    if (c.models && typeof c.models === 'object') keep.models = Object.fromEntries(Object.entries(c.models).map(([k, v]) => { const id = prefixed(k, task.zone); rename.set(k, id); return [id, v]; }));
    out.content = keep;
  }
  if (out.spaces) out.spaces = (Array.isArray(out.spaces) ? out.spaces : []).filter(s => current.spaces.some(x => x.id === s.id)).map(s => ({ id: s.id, generators: s.generators || [] })).filter(s => s.generators.length);
  for (const k of ['systems', 'graphics']) if (out[k]) out[k] = (Array.isArray(out[k]) ? out[k] : []).filter(i => i?.use && !(current[k] || []).some(x => x.use === i.use));
  // Rewrite references to renamed ids anywhere inside the patch (exact string values only).
  const walk = v => Array.isArray(v) ? v.map(walk) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : typeof v === 'string' && rename.has(v) ? rename.get(v) : v;
  return walk(out);
}

/** Zero-model detail: a local character who speaks on arrival and, with an item vocabulary, a find. */
export function proceduralDetail(doc, task, registry) {
  const vocab = vocabIndex(registry);
  const firstAct = doc.plot?.storyboard?.acts?.[0]?.id;
  if (!firstAct) return {};
  const local = { id: `${task.zone}_local`, name: `Keeper of ${task.name}`, role: 'local', home: task.zone };
  const say = [{ do: 'say', character: local.id, text: `Few travellers reach ${task.name}.` }];
  const patch = { plot: { characters: [local], storyboard: { acts: [{ id: firstAct, beats: [{ id: `${task.zone}_welcome`, title: task.name, when: { zone: task.zone }, optional: true, do: say }] }] } } };
  if (vocab.effects.give_item && (doc.systems || []).some(s => s.use === vocab.effects.give_item)) {
    patch.content = { items: [{ id: `${task.zone}_relic`, name: `${task.name} relic` }] };
    say.push({ do: 'give_item', item: `${task.zone}_relic` });
  }
  return patch;
}

export function detailSystem(registry, logic, doc) {
  const v = vocabulary(logic), used = new Set([...doc.spaces.map(s => s.use), ...(doc.systems || []).map(s => s.use), ...(doc.graphics || []).map(g => g.use)]);
  return `You add detail to one zone of a game document (schema ${doc.schema}). You write an ADDITIVE patch:
{ plot?: { characters?:[...], dialogue?:{id:{...}}, quests?:[...], storyboard?:{ acts:[{ id: <existing act id>, beats:[...] }] } },
  content?: { items?:[...], archetypes?:[...], models?:{...} }, spaces?:[{ id:<existing space id>, generators:[...] }], systems?:[{use,with}] }
Rules:
- Only add. Never repeat or change existing entries. New ids are lowercase slugs starting with "<zone id>_".
- Characters, items, quests, dialogue and beats must be about this zone; beats trigger in it (e.g. "when": {"zone": "<zone id>"}).
- Predicates: ${v.predicates.join(', ')}. Effects ({"do": kind}): ${v.effects.join(', ')}. Use only primitives the game already uses, or ones listed below.
- Keep it small and playable: 1-3 characters, a few items or interactions, 1-4 beats.
Primitives in this game:
${[...used].filter(id => registry.has(id)).map(id => cardText({ id, ...registry.get(id).card }, { full: true })).join('\n')}`;
}

function detailUser(doc, task) {
  const zone = doc.spaces.find(s => s.id === task.space)?.zones?.find(z => z.id === task.zone) || {};
  const summary = {
    title: doc.title, premise: doc.plot?.premise, zone: { space: task.space, ...zone },
    otherZones: doc.spaces.flatMap(s => (s.zones || []).map(z => `${z.id}: ${z.name || ''}`)).filter(z => !z.startsWith(task.zone + ':')),
    characters: (doc.plot?.characters || []).map(c => `${c.id}: ${c.name} (${c.role || ''})`), items: (doc.content?.items || []).map(i => i.id),
    acts: (doc.plot?.storyboard?.acts || []).map(a => ({ id: a.id, title: a.title, beats: (a.beats || []).map(b => b.id) })),
  };
  return `Game summary: ${JSON.stringify(summary)}\n\nWrite the detail patch for zone "${task.zone}". Reply with the patch JSON object only.`;
}

/** Ask the writer for a patch (null writer -> procedural). */
export async function writeDetail({ writer, doc, task, registry, logic, errors = null, previous = null }) {
  if (!writer) return { patch: proceduralDetail(doc, task, registry), source: 'procedural', ms: 0 };
  const user = errors ? `${detailUser(doc, task)}\n\nYour previous patch failed checks:\n${describeErrors(errors, 12)}\nPrevious patch:\n${JSON.stringify(previous).slice(0, 12000)}\nReturn a corrected patch.` : detailUser(doc, task);
  const reply = await writer.complete({ system: detailSystem(registry, logic, doc), user });
  return { patch: parseReply(reply.text), source: reply.model, ms: reply.ms };
}

/**
 * Merge, repair, guard and verify one patch against the current document.
 * -> { ok, doc, added, verify, fixes, reason?, errors? }
 */
export async function acceptPatch({ current, patch, task, registry, logic, baseVerify = null, budgetMs = 800 }) {
  const clean = sanitizePatch(patch, task, current);
  const { doc: merged, added } = mergePatch(current, clean);
  const repaired = repairDocument(merged, { registry, logic, rounds: 4 });
  if (!repaired.ok) return { ok: false, reason: 'preflight', errors: repaired.errors, patch: clean };
  const dropped = shrunkLists(current, repaired.doc).concat(shrunkLists(current.plot || {}, repaired.doc.plot || {}, 'plot'), shrunkLists(current.content || {}, repaired.doc.content || {}, 'content'));
  if (dropped.length) return { ok: false, reason: 'dropped_base_content', errors: dropped.map(d => ({ code: 'dropped_base_content', path: d.path, message: `${d.before} → ${d.after}` })), patch: clean };
  if (!Object.values(added).some(a => a.length) && !repaired.fixes.length) return { ok: false, reason: 'empty', errors: [{ code: 'empty_patch', path: '$', message: 'the patch added nothing' }], patch: clean };
  const v = await verifyDocument(repaired.doc, registry, logic, { budgetMs });
  if (!v.ok) return { ok: false, reason: 'verify', errors: v.problems, patch: clean };
  if (regressed(baseVerify, v)) return { ok: false, reason: 'verify_regressed', errors: [...newErrors(baseVerify, v), ...(v.completable === false && baseVerify?.completable ? [{ code: 'plot_regressed', path: '$', message: 'the patch makes the game impossible to finish' }] : [])], patch: clean };
  return { ok: true, doc: v.doc, added, verify: v, fixes: repaired.fixes, patch: clean };
}

export { idsOf };
