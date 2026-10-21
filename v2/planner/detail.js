// @ts-check
// Layer 3 of ARCHITECTURE.md §4: detail patches, one task per zone, written in
// parallel. A patch is additive (kernel mergePatch shape, plus `spawns`: rules for
// the document's spawner). Each one is merged into the current document, repaired
// by stable error code, guarded (it may not drop or rewrite existing content, nor
// put new beats on the critical path), verified (no provable softlock), and then
// hot-loaded by hosts via mergePatch + rt.extend.
//
// With a writer, the model fills a per-zone FORM (strict schema from the game's
// primitives: archetypes with the component slots they own, spawns in this zone,
// residents and their dialogue, items, zone quests, beats, structure generators), so
// a zone gets content the installed primitives actually read and differs from the
// others. Without a writer a procedural detailer adds a resident, a find, and a
// zone-specific mix of the game's existing pickups and enemies.
import { mergePatch } from '../kernel/document.js';
import { cardText, vocabulary, dataShapes, isGenerator } from './catalog.js';
import { vocabIndex } from './select.js';
import { repairDocument, describeErrors, idsOf } from './repair.js';
import { verifyDocument, regressed, newErrors, staticPlot } from './verify-adapter.js';
import { shrunkLists } from './revision-check.js';
import { parseReply } from './writer.js';
import { contentProps, contentFromForm, decode } from './outline-form.js';
import { spawnerId } from './engage.js';
import { contractsFor, contractText } from './content.js';
import { spawnRules } from './census.js';
import { isObj, isList, obj, list, objects, prop } from '../kernel/guards.js';

/** @typedef {import('../kernel/types.js').Doc} Doc */
/** @typedef {import('../kernel/types.js').Problem} Problem */
/** @typedef {import('../kernel/types.js').Effect} Effect */
/** @typedef {import('../kernel/types.js').Added} Added */
/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** @typedef {import('../kernel/types.js').LogicLike} LogicLike */
/** @typedef {import('./types.js').Writer} Writer */
/** @typedef {import('./types.js').ReplySchema} ReplySchema */
/** @typedef {import('./verify-adapter.js').Verification} Verification */
/** @typedef {import('./outline-form.js').JsonSchema} JsonSchema */
/** One detail task: a zone of a space. @typedef {{ id: string, kind: 'zone', space: string, zone: string, name: string }} DetailTask */
/**
 * A patch as sanitizePatch returns it: only the additive sections, still model data (mergePatch and preflight check it).
 * @typedef {Record<string, unknown>} DetailPatch
 */

export const DETAIL_VERSION = 'detail/0.2';
const PATCH_KEYS = ['spaces', 'systems', 'graphics', 'plot', 'content', 'spawns'];

/** @param {Doc} doc @param {{ max?: number }} [options] @returns {DetailTask[]} */
export function detailTasks(doc, { max = 8 } = {}) {
  /** @type {DetailTask[]} */
  const tasks = [];
  for (const s of doc.spaces || []) for (const z of s.zones || []) tasks.push({ id: `zone:${s.id}:${z.id}`, kind: 'zone', space: s.id, zone: z.id, name: z.name || z.id });
  return tasks.slice(0, max);
}

/** @param {unknown} id @param {string} zone @returns {string} */
const prefixed = (id, zone) => (String(id).startsWith(`${zone}_`) ? String(id) : `${zone}_${String(id).replace(/[^a-z0-9_-]/g, '_')}`.slice(0, 63));
/** The act a zone's beats belong to: the act whose beats already trigger in that zone, else the first. @param {Doc} doc @param {string} zone @returns {string | undefined} */
const actFor = (doc, zone) => (doc.plot?.storyboard?.acts || []).find(a => (a.beats || []).some(b => JSON.stringify(b.when || {}).includes(`"${zone}"`)))?.id || doc.plot?.storyboard?.acts?.[0]?.id;

/**
 * Normalize a patch for one zone: only additive sections, new ids namespaced by the zone (parallel
 * patches never collide), new beats optional (detail never changes the critical path) and appended
 * to acts that exist, existing spaces receiving generators only (zones are the outline's), spawns
 * fixed to this zone.
 * @param {unknown} patch model output @param {DetailTask} task @param {Doc} current @returns {DetailPatch}
 */
export function sanitizePatch(patch, task, current) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const k of PATCH_KEYS) { const v = prop(patch, k); if (v !== undefined) out[k] = structuredClone(v); }
  /** @type {Map<unknown, string>} */
  const rename = new Map();
  /** @param {unknown} items @returns {Record<string, unknown>[]} */
  const remap = items => objects(items).map(x => { if (x.id) { const id = prefixed(x.id, task.zone); rename.set(x.id, id); x.id = id; } return x; });
  if (out.plot) {
    const p = obj(out.plot);
    /** @type {Record<string, unknown>} */
    const keep = {};
    if (p.characters) keep.characters = remap(p.characters);
    if (p.quests) keep.quests = remap(p.quests);
    if (p.endings) keep.endings = remap(p.endings);
    if (isObj(p.dialogue) || isList(p.dialogue)) keep.dialogue = Object.fromEntries(Object.entries(p.dialogue).map(([k, v]) => { const id = prefixed(k, task.zone); rename.set(k, id); return [id, v]; }));
    const acts = new Set((current.plot?.storyboard?.acts || []).map(a => a.id));
    const beats = objects(prop(prop(p, 'storyboard'), 'acts')).filter(a => acts.has(/** @type {string} */ (a.id))).map(a => ({ id: a.id, beats: remap(a.beats).map(b => ({ ...b, optional: true })) })).filter(a => a.beats.length);
    if (beats.length) keep.storyboard = { acts: beats };
    out.plot = keep;
  }
  if (out.content) {
    const c = obj(out.content);
    /** @type {Record<string, unknown>} */
    const keep = {};
    for (const k of ['items', 'archetypes', 'recipes', 'blocks']) if (c[k]) keep[k] = remap(c[k]);
    if (isObj(c.models) || isList(c.models)) keep.models = Object.fromEntries(Object.entries(c.models).map(([k, v]) => { const id = prefixed(k, task.zone); rename.set(k, id); return [id, v]; }));
    out.content = keep;
  }
  if (out.spawns) out.spawns = remap(out.spawns).filter(r => typeof r.archetype === 'string').map(r => ({ ...r, zone: task.zone }));
  if (out.spaces) out.spaces = objects(out.spaces).filter(s => current.spaces.some(x => x.id === s.id)).map(s => ({ id: s.id, generators: list(s.generators).filter(g => isObj(g) && typeof g.use === 'string' && isGenerator(g.use)) })).filter(s => s.generators.length);
  for (const k of /** @type {const} */ (['systems', 'graphics'])) if (out[k]) out[k] = list(out[k]).filter(i => prop(i, 'use') && !(current[k] || []).some(x => x.use === prop(i, 'use')));
  // Rewrite references to renamed ids anywhere inside the patch (exact string values only).
  /** @param {unknown} v @returns {unknown} */
  const walk = v => Array.isArray(v) ? v.map(walk) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : typeof v === 'string' && rename.has(v) ? rename.get(v) : v;
  return /** @type {DetailPatch} */ (walk(out));
}

/**
 * mergePatch plus the patch's spawns, appended to the document's spawner (added when the game has none).
 * @param {Doc} current @param {DetailPatch} patch @param {RegistryLike} registry
 * @returns {{ doc: Doc, added: Added & { spawns?: unknown[] } }}
 */
export function mergeDetail(current, patch, registry) {
  const { spawns, ...rest } = patch;
  /** @type {{ doc: Doc, added: Added & { spawns?: unknown[] } }} */
  const merged = mergePatch(current, rest);
  if (!isList(spawns) || !spawns.length) return merged;
  const sid = spawnerId(registry);
  if (!sid) return merged;
  const doc = merged.doc;
  doc.systems = Array.isArray(doc.systems) ? doc.systems : [];
  let sp = doc.systems.find(s => s?.use === sid);
  if (!sp) { sp = { use: sid, with: { rules: [] } }; doc.systems.push(sp); merged.added.systems.push(doc.systems.length - 1); }
  sp.with = isObj(sp.with) ? sp.with : {};
  sp.with.rules = Array.isArray(sp.with.rules) ? sp.with.rules : [];
  const taken = new Set(spawnRules(doc, registry).map((/** @type {unknown} */ r) => prop(r, 'id')));
  const added = spawns.filter(r => !taken.has(prop(r, 'id')));
  sp.with.rules.push(...structuredClone(added));
  merged.added.spawns = added.map(r => prop(r, 'id'));
  return merged;
}

/** Zero-model detail: a resident who speaks on arrival, a find, and a zone-specific mix of the game's own pickups and enemies. */
/** @param {Doc} doc @param {DetailTask} task @param {RegistryLike} registry @returns {DetailPatch} */
export function proceduralDetail(doc, task, registry) {
  const vocab = vocabIndex(registry);
  const firstAct = actFor(doc, task.zone);
  if (!firstAct) return {};
  const local = { id: `${task.zone}_local`, name: `Keeper of ${task.name}`, role: 'local', home: task.zone };
  /** @type {Effect[]} */
  const say = [{ do: 'say', character: local.id, text: `Few travellers reach ${task.name}.` }];
  /** @type {DetailPatch} */
  const patch = { plot: { characters: [local], storyboard: { acts: [{ id: firstAct, beats: [{ id: `${task.zone}_welcome`, title: task.name, when: { zone: task.zone }, optional: true, do: say }] }] } } };
  if (vocab.effects.give_item && (doc.systems || []).some(s => s.use === vocab.effects.give_item)) {
    patch.content = { items: [{ id: `${task.zone}_relic`, name: `${task.name} relic` }] };
    say.push({ do: 'give_item', item: `${task.zone}_relic` });
  }
  // The game's own pickups and enemies, a different mix per zone (the zone's index picks which and how many).
  if (spawnerId(registry) && (doc.systems || []).some(s => s.use === spawnerId(registry))) {
    const zones = (doc.spaces || []).flatMap(s => (s.zones || []).map(z => z.id)), k = Math.max(0, zones.indexOf(task.zone));
    const pool = objects(doc.content?.archetypes).filter(a => a.id && a.id !== doc.player?.archetype && typeof a.kind === 'string' && ['pickup', 'enemy', 'creature', 'prop'].includes(a.kind) && Object.keys(Object(a.components || {})).some(c => c !== 'name' && c !== 'model'));
    const picks = pool.length ? [pool[k % pool.length], ...(pool.length > 1 && k % 2 ? [pool[(k + 1) % pool.length]] : [])] : [];
    const spawns = picks.filter(a => !(a.kind === 'enemy' && k === 0)).map((a, i) => ({ id: `${task.zone}_more_${a.id}`.slice(0, 60), archetype: a.id, count: [1 + ((k + i) % 3), 1 + ((k + i) % 3)], respawnSec: 0 }));
    if (spawns.length) patch.spawns = spawns;
  }
  return patch;
}

/**
 * The per-zone detail form: strict slots for exactly what this game's primitives read.
 * @param {{ registry: RegistryLike, doc: Doc, task: DetailTask }} args
 * @returns {{ schema: ReplySchema, toPatch: (form: unknown) => DetailPatch, used: string[] }}
 */
export function detailForm({ registry, doc, task }) {
  const used = [...new Set([...(doc.spaces || []).flatMap(s => [s.use, ...(s.generators || []).map(g => g.use)]), ...(doc.systems || []).map(s => s.use)])].filter(id => registry.has(id));
  const reads = new Set(used.flatMap(id => (registry.get(id)?.card.reads || []).filter(r => typeof r === 'string')));
  const spawner = spawnerId(registry);
  const { props, comps } = contentProps({ registry, used, hasQuests: reads.has('plot.quests'), hasDialogue: reads.has('plot.dialogue'), spawner, zone: task.zone });
  const S = (/** @type {string} */ d) => ({ type: 'string', description: d }), N = (/** @type {JsonSchema} */ s) => ({ anyOf: [s, { type: 'null' }] });
  const O = (/** @type {Record<string, JsonSchema>} */ p) => ({ type: 'object', additionalProperties: false, required: Object.keys(p), properties: p });
  props.beats = { type: 'array', description: `optional story moments in ${task.zone} (they never block the main story)`, items: O({ id: S('beat id'), title: S('title'), when_json: N(S('trigger predicate as JSON text, e.g. {"zone":"' + task.zone + '"}')), do_json: N(S('effects list as JSON text')) }) };
  const gens = registry.ids('engine').filter(isGenerator);
  props.generators_json = N(S(`structure/prop generators for this zone as a JSON list [{"use": one of ${gens.join(', ')}, "with": {...}}] naming zone "${task.zone}" (usually null)`));
  const schema = { name: 'zone_detail', schema: O(props) };
  /** @param {unknown} form the model's filled form @returns {DetailPatch} */
  const toPatch = form => {
    const c = contentFromForm(isObj(form) ? form : {}, { comps, zone: task.zone });
    const act = actFor(doc, task.zone);
    const beats = objects(prop(form, 'beats')).map(b => {
      /** @type {Record<string, unknown>} */
      const beat = { id: String(b.id || 'moment'), ...(b.title ? { title: String(b.title) } : {}), optional: true }; const w = decode(b.when_json, 'strict'); beat.when = isObj(w) ? w : { zone: task.zone }; const fx = decode(b.do_json, 'effects'); if (fx) beat.do = fx; return beat; });
    const gensList = decode(prop(form, 'generators_json'), 'strict');
    const patch = {
      plot: { characters: c.characters, ...(c.dialogue ? { dialogue: c.dialogue } : {}), ...(c.quests?.length ? { quests: c.quests } : {}), ...(beats.length && act ? { storyboard: { acts: [{ id: act, beats }] } } : {}) },
      content: { archetypes: c.archetypes.filter(a => a.kind !== 'player'), items: c.items },
      ...(c.rules.length ? { spawns: c.rules } : {}),
      ...(Array.isArray(gensList) && gensList.length ? { spaces: [{ id: task.space, generators: gensList }] } : {}),
    };
    return patch;
  };
  return { schema, toPatch, used };
}

/** @param {RegistryLike} registry @param {LogicLike} logic @param {Doc} doc @returns {string} */
export function detailSystem(registry, logic, doc) {
  const v = vocabulary(logic), used = new Set([...doc.spaces.map(s => s.use), ...(doc.systems || []).map(s => s.use), ...(doc.graphics || []).map(g => g.use)]);
  return `You add detail to one zone of a game document (schema ${doc.schema}). You fill a FORM (a JSON object matching the given schema) that becomes an ADDITIVE patch for this zone.
Make the zone its own place: its own enemies, creatures, pickups or props (spawns, using existing archetypes or new ones with the components their role needs), a resident or two with lines (dialogue) when the game has dialogue, a local quest when the game runs quests, items worth finding, and optional moments (beats). Use the components and sections the game's primitives read; content nothing reads is wasted.
Rules:
- Only add. Never repeat or change existing entries. New ids are lowercase slugs (they are prefixed with the zone id for you).
- Spawns may use the game's existing archetypes (listed in the request) or ones you add here.
- Predicates: ${v.predicates.join(', ')}. Effects ({"do": kind}): ${v.effects.join(', ')}. JSON-text fields hold a JSON value encoded as a string, or null.
- Keep it playable: new beats are optional and must not end the game or gate the main story.
Content the game's primitives need (exact shapes):
${contractText(contractsFor(registry, [...used])) || '(none declared)'}
Primitives in this game:
${[...used].filter(id => registry.has(id)).map(id => cardText({ id, .../** @type {import('../kernel/types.js').RegisteredPrimitive} */ (registry.get(id)).card }, { full: true })).join('\n')}
Shapes of the sections they read (follow them exactly):
${dataShapes(registry, [...used]).join('\n')}`;
}

/** @param {Doc} doc @param {DetailTask} task @returns {string} */
function detailUser(doc, task) {
  const zone = doc.spaces.find(s => s.id === task.space)?.zones?.find(z => z.id === task.zone) || {};
  const rules = (doc.systems || []).flatMap(s => list(s.with?.rules)).filter(r => prop(r, 'zone'));
  const summary = {
    title: doc.title, premise: doc.plot?.premise, zone: { space: task.space, ...zone },
    otherZones: doc.spaces.flatMap(s => (s.zones || []).map(z => `${z.id}: ${z.name || ''}${z.description ? ` (${String(z.description).slice(0, 80)})` : ''}`)).filter(z => !z.startsWith(task.zone + ':')),
    archetypes: list(doc.content?.archetypes).map(a => `${prop(a, 'id')} (${prop(a, 'kind') || '?'}: ${Object.keys(Object(prop(a, 'components') || {})).join(', ')})`),
    alreadyHere: rules.filter(r => prop(r, 'zone') === task.zone).map(r => { const count = prop(r, 'count'); return `${prop(r, 'archetype')} x${(isList(count) ? count : [1])[1] ?? (isList(count) ? count[0] : undefined) ?? 1}`; }),
    characters: list(doc.plot?.characters).map(c => `${prop(c, 'id')}: ${prop(c, 'name')} (${prop(c, 'role') || ''})${prop(c, 'home') ? ` @${prop(c, 'home')}` : ''}`), items: list(doc.content?.items).map(i => prop(i, 'id')),
    acts: (doc.plot?.storyboard?.acts || []).map(a => ({ id: a.id, title: a.title, beats: (a.beats || []).map(b => b.id) })),
  };
  return `Game summary: ${JSON.stringify(summary)}\n\nWrite the detail patch for zone "${task.zone}": what makes it unlike the other zones.`;
}

/** A reply in the form's shape (rather than a raw patch). @param {unknown} x @returns {x is Record<string, unknown>} */
const isFormShape = x => isObj(x) && (Array.isArray(x.archetypes) || Array.isArray(x.characters) || Array.isArray(x.spawns)) && !x.plot && !x.content;

/**
 * Ask the writer for a patch (null writer -> procedural). The patch is model output (`unknown`): acceptPatch sanitizes it.
 * @param {{ writer?: Writer | null, doc: Doc, task: DetailTask, registry: RegistryLike, logic: LogicLike, errors?: Problem[] | null, previous?: unknown }} args
 * @returns {Promise<{ patch: unknown, source: string, ms: number, form?: boolean }>}
 */
export async function writeDetail({ writer, doc, task, registry, logic, errors = null, previous = null }) {
  if (!writer) return { patch: proceduralDetail(doc, task, registry), source: 'procedural', ms: 0 };
  const form = detailForm({ registry, doc, task });
  const user = errors ? `${detailUser(doc, task)}\n\nYour previous patch failed checks:\n${describeErrors(errors, 12)}\nPrevious patch:\n${JSON.stringify(previous).slice(0, 12000)}\nReturn a corrected form.` : detailUser(doc, task);
  const reply = await writer.complete({ system: detailSystem(registry, logic, doc), user, schema: form.schema });
  const value = parseReply(reply.text);
  return { patch: isFormShape(value) ? form.toPatch(value) : value, source: reply.model, ms: reply.ms, form: isFormShape(value) };
}

/**
 * Merge, repair, guard and verify one patch against the current document.
 * -> { ok, doc, added, verify, fixes, reason?, errors? }
 * @param {{ current: Doc, patch: unknown, task: DetailTask, registry: RegistryLike, logic: LogicLike, baseVerify?: Verification | null, budgetMs?: number }} args
 */
export async function acceptPatch({ current, patch, task, registry, logic, baseVerify = null, budgetMs = 800 }) {
  const clean = sanitizePatch(patch, task, current);
  const { doc: merged, added } = mergeDetail(current, clean, registry);
  const repaired = repairDocument(merged, { registry, logic, rounds: 4 });
  if (!repaired.ok) return { ok: false, reason: 'preflight', errors: repaired.errors, patch: clean };
  const dropped = shrunkLists(current, repaired.doc).concat(shrunkLists(current.plot || {}, repaired.doc.plot || {}, 'plot'), shrunkLists(current.content || {}, repaired.doc.content || {}, 'content'));
  if (dropped.length) return { ok: false, reason: 'dropped_base_content', errors: dropped.map(d => ({ code: 'dropped_base_content', path: d.path, message: `${d.before} → ${d.after}` })), patch: clean };
  if (!Object.values(added).some(a => a?.length) && !repaired.fixes.length) return { ok: false, reason: 'empty', errors: [{ code: 'empty_patch', path: '$', message: 'the patch added nothing' }], patch: clean };
  // Static plot analysis first (milliseconds): a patch that creates a gate cycle or an unobtainable item never reaches simulation.
  const staticErrors = newErrors(await staticPlot(current, logic), await staticPlot(repaired.doc, logic));
  if (staticErrors.length) return { ok: false, reason: 'plot_static', errors: staticErrors, patch: clean };
  const v = await verifyDocument(repaired.doc, registry, logic, { budgetMs });
  if (!v.ok) return { ok: false, reason: 'verify', errors: v.problems, patch: clean };
  if (regressed(baseVerify, v)) return { ok: false, reason: 'verify_regressed', errors: [...newErrors(baseVerify, v), ...(v.completable === false && baseVerify?.completable ? [{ code: 'plot_regressed', path: '$', message: 'the patch makes the game impossible to finish' }] : [])], patch: clean };
  return { ok: true, doc: v.doc, added, verify: v, fixes: repaired.fixes, patch: clean };
}

export { idsOf };
