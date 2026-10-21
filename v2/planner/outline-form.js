// The outline as a structured form: a strict JSON schema derived from exactly the chosen primitives' cards
// (their params, the archetype components they own, the document sections they read and their content
// contracts), and the conversion of a filled form into a game document.
//
// Why a form and not free JSON: a model writing the whole document freely invents param names (a crop with
// "growthTime"), drops required fields (an ai component without a behavior list) and leaves the content
// sections empty. With the form, every chosen primitive has a slot with its real params, every archetype
// has slots for the components the chosen primitives own, spawns/quests/dialogue/items are required lists,
// and the spaces, views and primitive set come from the selection (so the kind of game cannot drift).
// OpenAI writers enforce the schema (strict json_schema); Claude writers get it in the prompt (writer.js).
//
// Open values (predicates, effects, json params, wide objects) travel as JSON strings ("*_json" fields, or
// a string where the card says json) and are decoded here. Nothing here names a primitive.
import { DOC_SCHEMA } from '../kernel/document.js';
import { OBJECTIVES } from '../primitives/plot/story-objectives.js';
import { isGraphics, isSpace, isGenerator } from './catalog.js';
import { contractsFor } from './content.js';

export const FORM_VERSION = 'outline-form/0.1';
const WIDE = 10;           // objects with more fields than this keep their required + first fields; the rest go to more_json
const KEEP = 8;
const MAX_DEPTH = 4;       // nesting inside a param before values travel as JSON strings
const SMALL_CARD = 12;     // cards with at most this many params expose every param
const isObj = v => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const slug = s => (String(s || '').toLowerCase().match(/[a-z0-9]+/g) || ['x']).join('_').slice(0, 48);
const str = (description) => ({ type: 'string', ...(description ? { description } : {}) });
const nul = s => ({ anyOf: [s, { type: 'null' }] });
const obj = (properties, description) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties, ...(description ? { description } : {}) });
const arr = (items, description) => ({ type: 'array', items, ...(description ? { description } : {}) });
const JSON_HINT = 'JSON text (a JSON value encoded as a string), or null to leave it unset';
const describe = spec => [spec.effect, spec.unit && `unit ${spec.unit}`, (spec.min !== undefined || spec.max !== undefined) && `range ${spec.min ?? ''}..${spec.max ?? ''}`, spec.default !== undefined && `default ${JSON.stringify(spec.default).slice(0, 60)}`].filter(Boolean).join('; ').slice(0, 200) || undefined;

/** Schema + codec for one param/field spec. codec: 'raw' | 'json' | { fields, more } | { list }. */
export function specSchema(spec, depth = 0) {
  const d = describe(spec);
  const t = spec?.type;
  if (t === 'number' || t === 'integer') return { schema: { type: t, ...(d ? { description: d } : {}) }, codec: 'raw' };
  if (t === 'boolean') return { schema: { type: 'boolean', ...(d ? { description: d } : {}) }, codec: 'raw' };
  if (t === 'string') return { schema: spec.options?.length ? { type: 'string', enum: spec.options.map(String), ...(d ? { description: d } : {}) } : str(d), codec: 'raw' };
  if (t === 'ref') return { schema: str(`id of a ${spec.to}${d ? `; ${d}` : ''}`), codec: 'raw' };
  if (t === 'list' && depth < MAX_DEPTH) {
    const inner = specSchema(spec.of || { type: 'json' }, depth + 1);
    return { schema: arr(inner.schema, d), codec: { list: inner.codec } };
  }
  if (t === 'object' && spec.fields && !spec.open && depth < MAX_DEPTH && Object.keys(spec.fields).length) return objectSchema(spec.fields, depth + 1, d);
  // json params may hold a bare string ("coins"); predicates, effects and objects must parse as JSON.
  return { schema: nul(str(`${d ? d + '. ' : ''}${JSON_HINT}`)), codec: t === 'json' || !t ? 'json' : t === 'effects' ? 'effects' : 'strict' };
}

/** A strict object over fields: optional ones nullable; wide objects keep required + first fields and a more_json. */
export function objectSchema(fields, depth = 0, description) {
  const entries = Object.entries(fields || {});
  const keep = entries.length > WIDE ? entries.filter(([, f], i) => f?.required || i < KEEP) : entries;
  const props = {}, codecs = {};
  for (const [k, f] of keep) { const s = specSchema(f || {}, depth); props[k] = f?.required || typeof s.codec === 'string' && s.codec !== 'raw' ? s.schema : nul(s.schema); codecs[k] = s.codec; }
  const more = entries.length > keep.length;
  if (more) props.more_json = nul(str(`other fields as one JSON object: ${entries.filter(e => !keep.includes(e)).map(([k]) => k).join(', ').slice(0, 300)}`));
  return { schema: obj(props, description), codec: { fields: codecs, more } };
}

/** Decode a form value back to document JSON with its codec (nulls drop out: they mean "use the default"). */
export function decode(value, codec) {
  if (value === null || value === undefined) return undefined;
  if (codec === 'json' || codec === 'strict' || codec === 'effects') {
    let v = value;
    if (typeof value === 'string') {
      const t = value.trim(); if (!t || t === 'null') return undefined;
      try { v = JSON.parse(t); } catch { return codec === 'json' ? t : undefined; }
    }
    if (codec === 'effects') return Array.isArray(v) ? v : isObj(v) ? [v] : undefined;
    if (codec === 'strict') return v !== null && typeof v === 'object' ? v : undefined;
    return v === null ? undefined : v;
  }
  if (codec?.list) return Array.isArray(value) ? value.map(v => decode(v, codec.list)).filter(v => v !== undefined) : undefined;
  if (codec?.fields) {
    if (!isObj(value)) return undefined;
    const out = {};
    for (const [k, c] of Object.entries(codec.fields)) { const v = decode(value[k], c); if (v !== undefined) out[k] = v; }
    if (codec.more && typeof value.more_json === 'string') { const m = decode(value.more_json, 'json'); if (isObj(m)) for (const [k, v] of Object.entries(m)) if (out[k] === undefined) out[k] = v; }
    return out;
  }
  return value;
}

/** A card's params as a form slot: which params are exposed directly; the rest travel in tune_json. */
function paramsSlot(card, { skip = [] } = {}) {
  const params = Object.entries(card.params || {}).filter(([k]) => !skip.includes(k));
  const small = params.length <= SMALL_CARD;
  const direct = params.filter(([, s]) => small || s.required || ['list', 'object', 'ref'].includes(s.type) || (s.type === 'string' && s.options));
  const { schema, codec } = objectSchema(Object.fromEntries(direct), 1);
  const rest = params.filter(p => !direct.includes(p)).map(([k]) => k);
  if (rest.length) { schema.properties.tune_json = nul(str(`other params of this primitive as one JSON object (only those to change from the defaults): ${rest.join(', ').slice(0, 400)}`)); schema.required.push('tune_json'); codec.tune = true; }
  return { schema, codec };
}

/** Component slots for archetypes: every component a chosen primitive owns (card.components), strict. */
export function componentSlots(registry, ids) {
  const props = {}, codecs = {};
  for (const id of ids) for (const [k, spec] of Object.entries(registry.get(id)?.card.components || {})) {
    if (props[k]) continue;
    const s = specSchema(spec, 1);
    props[k] = typeof s.codec === 'string' && s.codec !== 'raw' ? s.schema : nul(s.schema); codecs[k] = s.codec;
  }
  props.other_json = nul(str('other components as one JSON object (model, loot, faction, cpu, item...)'));
  return { schema: obj(props, 'components keyed by owning primitive; null = this archetype has none of it'), codecs };
}

export const ITEM_KINDS = ['material', 'tool', 'weapon', 'armor', 'food', 'potion', 'key', 'quest', 'currency', 'charm', 'ammo', 'block', 'prop', 'misc'];
export const ARCH_KINDS = ['player', 'npc', 'creature', 'enemy', 'boss', 'vehicle', 'prop', 'projectile', 'pickup', 'mount'];
const KERNEL_SECTIONS = new Set(['plot.characters', 'plot.storyboard', 'plot.endings', 'plot.quests', 'plot.dialogue', 'content.items', 'content.archetypes', 'content.models']);

/** Spawn-rule list params (card.defines spawn_rule) are filled from the form's spawns, not written per instance. */
const spawnParams = card => (card.defines || []).filter(d => d.kind === 'spawn_rule' && d.in).map(d => d.in);

/**
 * outlineForm({ registry, skeleton, selection }) -> { schema: {name, schema}, toDoc(form) -> doc, contracts, systems, sections, layout }
 * skeleton: the procedural scaffold document (its spaces, zone shapes, systems and views are the frame).
 */
export function outlineForm({ registry, skeleton, selection = null }) {
  const systems = [...new Set((skeleton.systems || []).map(s => s.use))].filter(id => registry.has(id));
  const used = [...new Set([...(skeleton.spaces || []).flatMap(s => [s.use, ...(s.generators || []).map(g => g.use)]), ...systems])];
  const contracts = contractsFor(registry, used);
  const reads = new Set(used.flatMap(id => (registry.get(id)?.card.reads || []).filter(r => typeof r === 'string')));
  const hasQuests = reads.has('plot.quests'), hasDialogue = reads.has('plot.dialogue');
  const sections = [...new Set([...reads, ...contracts.filter(c => c.need === 'section').map(c => c.at)])].filter(r => /^(plot|content)\.[a-zA-Z]+$/.test(r) && !KERNEL_SECTIONS.has(r) && r !== 'content.blocks');
  const spawner = registry.ids().find(id => spawnParams(registry.get(id).card).length && registry.get(id).card.params?.rules);
  const props = {};
  props.title = str('an evocative title for THIS idea');
  props.logline = str('one sentence');
  props.premise = str('two or three sentences: the world, the player, the goal');

  // Spaces: fixed by the selection (ids, primitives, params); the model names and describes the zones.
  const layout = [];
  const spaceProps = {};
  for (const s of skeleton.spaces || []) {
    const exits = (s.zones || []).some(z => Array.isArray(z.exits));
    const zone = obj({
      id: str('lowercase slug, unique'), name: str(), description: str('one line: what is here that no other zone has (terrain, hazards, who and what you meet)'),
      ...(exits ? { exits: arr(obj({ to: str('zone id in this space'), gate_json: nul(str(`predicate that must hold to pass (${JSON_HINT}), e.g. {"item":"brass_key"}`)) })) } : {}),
    });
    spaceProps[s.id] = obj({ zones: arr(zone, `${(s.zones || []).length} or more zones, each distinct`) }, `space ${s.id} (${s.use})`);
    layout.push({ id: s.id, exits, count: (s.zones || []).length });
  }
  props.spaces = obj(spaceProps, 'every space of the game, by id');

  // Systems: one slot per chosen primitive, with its real params.
  const sysProps = {}, sysCodecs = {};
  for (const id of systems) {
    const card = registry.get(id).card;
    const slot = paramsSlot(card, { skip: spawnParams(card) });
    sysProps[id] = obj({ with: slot.schema }, String(card.intent || '').slice(0, 300));
    sysCodecs[id] = slot.codec;
  }
  props.systems = obj(sysProps, 'every chosen primitive with its params; null means the default');
  const extras = registry.ids().filter(id => !isSpace(id) && !isGenerator(id) && !isGraphics(id) && !systems.includes(id) && !registry.get(id).card.ambient);
  props.extra_systems = arr(obj({ use: { type: 'string', enum: extras.length ? extras : ['none'] }, with_json: nul(str(JSON_HINT)) }), 'other catalogue primitives this idea needs (usually none)');

  // Content.
  const { props: content, comps } = contentProps({ registry, used, hasQuests, hasDialogue, spawner });
  Object.assign(props, content);
  for (const sec of sections) props[`section_${sec.replace('.', '_')}`] = str(`${sec} as JSON text (the list or id-keyed object the primitives read; "[]" if this game needs none)`);
  props.acts = arr(obj({ id: str(), title: str(), beats: arr(obj({ id: str(), title: str(), when_json: nul(str(`trigger predicate (${JSON_HINT}), e.g. {"zone":"hall"}`)), after: arr(str('beat id')), optional: { type: 'boolean' }, do_json: nul(str(`effects list (${JSON_HINT}), e.g. [{"do":"say","character":"guide","text":"..."}]`)) })) }), 'the story: acts of beats, completable, the last one ending the game');
  props.endings = arr(obj({ id: str(), title: str(), text: str(), outcome: { type: 'string', enum: ['won', 'lost', 'neutral'] } }));
  props.player = obj({ archetype: str('the player archetype id (an archetypes entry of kind player)'), zone: str('start zone id') });

  const schema = { name: 'game_outline', schema: obj(props) };
  const toDoc = form => formToDoc(form, { registry, skeleton, systems, sysCodecs, comps, sections, spawner, layout });
  return { schema, toDoc, contracts, systems, sections, version: FORM_VERSION };
}

const parseJson = v => decode(v, 'json');
const listOf = v => (Array.isArray(v) ? v : []);

/**
 * Form slots for content (shared by the outline and the per-zone detail form): archetypes with the component slots
 * of every primitive in `used`, spawns (when a spawner exists; `zone` fixes their zone), items, characters, and
 * dialogue / quests when a primitive reads them. -> { props, comps }
 */
export function contentProps({ registry, used, hasQuests, hasDialogue, spawner, zone = null }) {
  const props = {};
  const comps = componentSlots(registry, used);
  props.archetypes = arr(obj({ id: str('lowercase slug'), kind: { type: 'string', enum: ARCH_KINDS }, name: str(), components: comps.schema }), 'every kind of entity: enemies, creatures, pickups, props, vehicles, NPC bodies; give each the components its role needs');
  if (spawner) props.spawns = arr(obj({ id: str('rule id'), archetype: str('archetype id'), ...(zone ? {} : { zone: str('zone id where they appear') }), min: { type: 'integer' }, max: { type: 'integer' }, respawnSec: nul({ type: 'number', description: '0 = never respawn' }), when_json: nul(str(`predicate that must hold (${JSON_HINT})`)) }), zone ? `what appears in ${zone}: its own enemies, pickups and props` : 'what appears where: every enemy, pickup and prop archetype placed in the zones it belongs to');
  props.items = arr(obj({ id: str('lowercase slug'), name: str(), kind: { type: 'string', enum: ITEM_KINDS }, desc: str(), value: nul({ type: 'number' }), more_json: nul(str('other item fields as a JSON object (weapon, use, creature, stats...)')) }));
  props.characters = arr(obj({ id: str('lowercase slug'), name: str(), role: str(), bio: str(), ...(zone ? {} : { home: nul(str('zone id')) }), archetype: nul(str('archetype id for their body, if any')), dialogue: arr(str('dialogue id')) }));
  if (hasDialogue) props.dialogue = arr(obj({ id: str('dialogue id'), speaker: str('character id'), start: str('first node id'), nodes: arr(obj({ id: str('node id'), who: nul(str('character id; null = the speaker')), say: str(), next: nul(str('node id')), end: { type: 'boolean' }, choices: arr(obj({ text: str(), next: nul(str('node id')), do_json: nul(str(`effects list (${JSON_HINT})`)) })), do_json: nul(str(`effects list (${JSON_HINT})`)) })) }), 'conversations as node graphs');
  if (hasQuests) {
    const kinds = Object.keys(OBJECTIVES);
    props.quests = arr(obj({ id: str('lowercase slug'), title: str(), kind: { type: 'string', enum: ['main', 'side', 'contract', 'bounty', 'challenge'] }, giver: nul(str('character id')), ...(zone ? {} : { zone: nul(str('zone id')) }), summary: str(), autoStart: { type: 'boolean' },
      objectives: arr(obj({ id: str(), kind: { type: 'string', enum: kinds }, text: str(), zone: nul(str()), item: nul(str()), character: nul(str()), archetype: nul(str()), count: nul({ type: 'integer' }), more_json: nul(str(`other fields of this objective kind (${kinds.map(k => `${k}: ${Object.keys(OBJECTIVES[k].fields || {}).join('/')}`).join('; ').slice(0, 500)})`)) })),
      rewards_json: nul(str('{"xp"?, "money"?, "items"?: [{"item","count"}]} as JSON')) }), 'quests the quest primitive runs; objectives use the goal kinds');
  }
  return { props, comps };
}

/** Content from a filled form (see contentProps): document-shaped lists, plus spawn rules for the spawner. */
export function contentFromForm(f, { comps, zone = null }) {
  const archetypes = listOf(f.archetypes).filter(isObj).map(a => {
    const components = {};
    for (const [k, c] of Object.entries(comps.codecs)) { const v = decode(a.components?.[k], c); if (v !== undefined && !(isObj(v) && !Object.keys(v).length && typeof c !== 'string')) components[k] = v; }
    const other = parseJson(a.components?.other_json); if (isObj(other)) for (const [k, v] of Object.entries(other)) if (components[k] === undefined) components[k] = v;
    if (a.name && components.name === undefined) components.name = String(a.name);
    return { id: slug(a.id || a.name), kind: ARCH_KINDS.includes(a.kind) ? a.kind : 'prop', components };
  });
  const items = listOf(f.items).filter(isObj).map(i => { const more = parseJson(i.more_json); return { ...(isObj(more) ? more : {}), id: slug(i.id || i.name), name: String(i.name || i.id), kind: ITEM_KINDS.includes(i.kind) ? i.kind : 'misc', ...(i.desc ? { desc: String(i.desc) } : {}), ...(Number.isFinite(i.value) ? { value: i.value } : {}) }; });
  const characters = listOf(f.characters).filter(isObj).map(c => { const home = zone || (c.home ? slug(c.home) : null); return { id: slug(c.id || c.name), name: String(c.name || c.id), role: String(c.role || ''), ...(c.bio ? { bio: String(c.bio) } : {}), ...(home ? { home } : {}), ...(c.archetype ? { archetype: slug(c.archetype) } : {}), ...(listOf(c.dialogue).length ? { dialogue: listOf(c.dialogue).filter(x => typeof x === 'string').map(id => ({ id })) } : {}) }; });
  let dialogue;
  if (Array.isArray(f.dialogue)) {
    dialogue = {};
    for (const d of f.dialogue.filter(isObj)) {
      const nodes = {};
      for (const n of listOf(d.nodes).filter(isObj)) {
        const node = { ...(n.who ? { who: n.who } : {}), say: String(n.say || '') };
        if (n.next) node.next = n.next; if (n.end) node.end = true;
        const doFx = decode(n.do_json, 'effects'); if (doFx?.length) node.do = doFx;
        const choices = listOf(n.choices).filter(isObj).map(c => ({ text: String(c.text || ''), ...(c.next ? { next: c.next } : {}), ...(decode(c.do_json, 'effects') ? { do: decode(c.do_json, 'effects') } : {}) }));
        if (choices.length) node.choices = choices;
        if (!node.next && !node.choices && !node.end) node.end = true;
        nodes[String(n.id || `n${Object.keys(nodes).length + 1}`)] = node;
      }
      if (Object.keys(nodes).length) dialogue[slug(d.id)] = { speaker: d.speaker || 'player', start: nodes[d.start] ? d.start : Object.keys(nodes)[0], nodes };
    }
  }
  const quests = Array.isArray(f.quests) ? f.quests.filter(isObj).map(q => {
    const rewards = parseJson(q.rewards_json), qz = zone || (q.zone ? slug(q.zone) : null);
    return { id: slug(q.id || q.title), title: String(q.title || q.id), kind: q.kind || 'main', ...(q.giver ? { giver: slug(q.giver) } : {}), ...(qz ? { zone: qz } : {}), summary: String(q.summary || ''), ...(q.autoStart ? { autoStart: true } : {}),
      objectives: listOf(q.objectives).filter(isObj).map(o => { const more = parseJson(o.more_json); const out = { ...(isObj(more) ? more : {}), id: slug(o.id || o.kind), kind: o.kind, text: String(o.text || '') }; for (const k of ['zone', 'item', 'character', 'archetype']) if (o[k]) out[k] = o[k]; if (Number.isInteger(o.count)) out.count = o.count; return out; }),
      ...(isObj(rewards) ? { rewards } : {}) };
  }) : undefined;
  const rules = listOf(f.spawns).filter(isObj).map((r, i) => {
    const lo = Number.isInteger(r.min) ? Math.max(0, r.min) : 1, hi = Number.isInteger(r.max) ? Math.max(lo, r.max) : lo;
    const when = decode(r.when_json, 'strict'), rz = zone || (r.zone ? slug(r.zone) : null);
    return { id: slug(r.id || `spawn_${i + 1}`), archetype: slug(r.archetype), ...(rz ? { zone: rz } : {}), count: [Math.max(1, lo), Math.max(1, hi)], ...(Number.isFinite(r.respawnSec) ? { respawnSec: Math.max(0, r.respawnSec) } : {}), ...(isObj(when) ? { when } : {}) };
  }).filter((r, i, a) => a.findIndex(x => x.id === r.id) === i);
  return { archetypes, items, characters, dialogue, quests, rules };
}

/** Zone geometry for shapes the model does not write (rects, ranges, bounds): laid out by index like the skeleton. */
function geometry(skeletonSpace, zones) {
  const ref = skeletonSpace.zones || [];
  const n = zones.length;
  const extentOf = () => {
    const rects = ref.filter(z => Array.isArray(z.rect)); if (rects.length) return { kind: 'rect', W: Math.max(...rects.map(z => z.rect[2])), H: Math.max(...rects.map(z => z.rect[3])), y0: Math.min(...rects.map(z => z.rect[1])) };
    const ranges = ref.filter(z => Array.isArray(z.range)); if (ranges.length) return { kind: 'range', L: Math.max(...ranges.map(z => z.range[1])) };
    const bounds = ref.filter(z => z.bounds); if (bounds.length) return { kind: 'bounds', template: bounds };
    return null;
  };
  const e = extentOf();
  zones.forEach((z, i) => {
    const same = ref[i] && ref.length === n ? ref[i] : null;
    if (same) { for (const k of ['rect', 'range', 'bounds', 'at', 'center', 'r', 'polygon']) if (same[k] !== undefined && z[k] === undefined) z[k] = structuredClone(same[k]); return; }
    if (!e) return;
    if (e.kind === 'rect') { const w = Math.max(1, Math.floor(e.W / n)); z.rect = [i * w, e.y0, i === n - 1 ? e.W : (i + 1) * w, e.H]; }
    if (e.kind === 'range') { const w = e.L / n; z.range = [+(i * w).toFixed(2), +((i + 1) * w).toFixed(2)]; }
    if (e.kind === 'bounds') { const t = e.template[i % e.template.length].bounds; z.bounds = structuredClone(t); if (i >= e.template.length) { z.bounds.min[0] += 64 * Math.floor(i / e.template.length); z.bounds.max[0] += 64 * Math.floor(i / e.template.length); } }
  });
}

const zoneStart = z => z.bounds ? [z.bounds.min[0] + 1, z.bounds.min[1] + 1, z.bounds.min[2] + 1] : z.rect ? [z.rect[0] + Math.min(1, (z.rect[2] - z.rect[0]) / 2), z.rect[1] + Math.min(1, (z.rect[3] - z.rect[1]) / 2)] : z.range ? [z.range[0] + 0.5, 0, 0] : null;

/** A filled form -> a game document in the kernel's shape (references are checked later by preflight and repair). */
export function formToDoc(form, { registry, skeleton, systems, sysCodecs, comps, sections, spawner, layout }) {
  const f = isObj(form) ? form : {};
  const title = typeof f.title === 'string' && f.title.trim() ? f.title.trim() : skeleton.title;
  const spaces = (skeleton.spaces || []).map(s => {
    const slot = f.spaces?.[s.id];
    const shape = layout.find(l => l.id === s.id);
    let zones = listOf(slot?.zones).filter(isObj).map(z => ({ id: slug(z.id || z.name), name: String(z.name || z.id || ''), description: String(z.description || ''),
      ...(shape?.exits ? { exits: listOf(z.exits).filter(isObj).map(x => ({ to: slug(x.to), ...(parseJson(x.gate_json) !== undefined ? { gate: parseJson(x.gate_json) } : {}) })) } : {}) }));
    const seen = new Set(); zones = zones.filter(z => !seen.has(z.id) && seen.add(z.id));
    if (!zones.length) zones = structuredClone(s.zones || []);
    else geometry(s, zones);
    return { ...structuredClone(s), zones };
  });
  const out = {
    schema: DOC_SCHEMA, id: slug(title).replace(/_/g, '-'), title, logline: String(f.logline || skeleton.logline || ''), seed: skeleton.seed,
    views: structuredClone(skeleton.views), spaces,
    systems: [],
    ...(skeleton.graphics ? { graphics: structuredClone(skeleton.graphics) } : {}),
    plot: { premise: String(f.premise || skeleton.plot?.premise || '') },
    content: {},
  };
  const skelSys = new Map((skeleton.systems || []).map(s => [s.use, s]));
  for (const id of systems) {
    const slot = f.systems?.[id], codec = sysCodecs[id];
    const w = decode(slot?.with, codec) || {};
    if (codec?.tune && typeof slot?.with?.tune_json === 'string') { const t = parseJson(slot.with.tune_json); if (isObj(t)) for (const [k, v] of Object.entries(t)) if (w[k] === undefined && registry.get(id).card.params?.[k]) w[k] = v; }
    const base = skelSys.get(id) || {};
    // Spawn-rule params keep what the scaffold had (start spawns are re-derived by engage); the form's spawns are added below.
    for (const k of spawnParams(registry.get(id).card)) if (base.with?.[k] !== undefined) w[k] = structuredClone(base.with[k]);
    out.systems.push({ use: id, ...(base.space ? { space: base.space } : {}), ...(Object.keys(w).length ? { with: w } : {}) });
  }
  for (const x of listOf(f.extra_systems)) if (isObj(x) && registry.has(x.use) && !out.systems.some(s => s.use === x.use) && !isSpace(x.use) && !isGenerator(x.use) && !isGraphics(x.use)) {
    const w = parseJson(x.with_json); out.systems.push({ use: x.use, ...(isObj(w) ? { with: w } : {}) });
  }
  const content = contentFromForm(f, { comps });
  const archetypes = content.archetypes;
  const pid = slug(f.player?.archetype || '');
  let playerArch = archetypes.find(a => a.id === pid) || archetypes.find(a => a.kind === 'player');
  if (!playerArch) { playerArch = structuredClone((skeleton.content?.archetypes || []).find(a => a.id === skeleton.player?.archetype) || { id: 'hero', components: { name: 'You' } }); playerArch.kind ??= 'player'; archetypes.push(playerArch); }
  out.content.archetypes = archetypes;
  const items = content.items;
  for (const it of skeleton.content?.items || []) if (!items.some(x => x.id === it.id)) items.push(structuredClone(it));
  if (items.length) out.content.items = items;
  out.plot.characters = content.characters;
  if (content.dialogue) out.plot.dialogue = content.dialogue;
  if (content.quests) out.plot.quests = content.quests;
  for (const sec of sections) {
    const v = parseJson(f[`section_${sec.replace('.', '_')}`]);
    if (v === undefined || (Array.isArray(v) && !v.length) || (isObj(v) && !Object.keys(v).length)) continue;
    const [root, key] = sec.split('.');
    out[root][key] = v;
  }
  const acts = listOf(f.acts).filter(isObj).map(a => ({ id: slug(a.id || a.title), title: String(a.title || a.id || ''), beats: listOf(a.beats).filter(isObj).map(b => {
    const beat = { id: slug(b.id || b.title), ...(b.title ? { title: String(b.title) } : {}) };
    const when = parseJson(b.when_json); if (isObj(when)) beat.when = when;
    const after = listOf(b.after).filter(x => typeof x === 'string').map(slug); if (after.length) beat.after = after;
    if (b.optional) beat.optional = true;
    const fx = parseJson(b.do_json); if (Array.isArray(fx)) beat.do = fx; else if (isObj(fx)) beat.do = [fx];
    return beat;
  }) }));
  if (acts.length) out.plot.storyboard = { acts };
  else if (skeleton.plot?.storyboard) out.plot.storyboard = structuredClone(skeleton.plot.storyboard);
  const endings = listOf(f.endings).filter(isObj).map(e => ({ id: slug(e.id || e.title), title: String(e.title || e.id), text: String(e.text || ''), outcome: ['won', 'lost', 'neutral'].includes(e.outcome) ? e.outcome : 'won' }));
  if (endings.length) out.plot.endings = endings; else if (skeleton.plot?.endings) out.plot.endings = structuredClone(skeleton.plot.endings);
  // Spawns -> the spawner's rules.
  const rules = content.rules;
  if (rules.length && spawner) {
    let sp = out.systems.find(s => s.use === spawner);
    if (!sp) { sp = { use: spawner, with: {} }; out.systems.unshift(sp); }
    sp.with = { ...(sp.with || {}), rules: [...listOf(sp.with?.rules), ...rules] };
  }
  // The player: its archetype, in its start zone (zone id in exit spaces, a point in positional ones).
  const space = out.spaces.find(s => s.id === skeleton.player?.space) || out.spaces[0];
  const startZone = (space.zones || []).find(z => z.id === slug(f.player?.zone)) || space.zones?.[0];
  const exits = layout.find(l => l.id === space.id)?.exits;
  out.player = { ...structuredClone(skeleton.player || {}), archetype: playerArch.id, space: space.id, at: exits ? startZone?.id : (startZone && zoneStart(startZone)) || skeleton.player?.at };
  return out;
}

/** A document path as the form names it, for repair problems (best effort; the doc path is always kept too). */
export function formPath(path, doc) {
  const p = String(path || '');
  let m;
  if ((m = /^systems\[(\d+)\](.*)$/.exec(p))) { const use = doc?.systems?.[+m[1]]?.use; return use ? `systems["${use}"]${m[2]}` : p; }
  if ((m = /^spaces\[(\d+)\]\.zones(.*)$/.exec(p))) { const id = doc?.spaces?.[+m[1]]?.id; return id ? `spaces["${id}"].zones${m[2]}` : p; }
  return p.replace(/^content\.archetypes/, 'archetypes').replace(/^content\.items/, 'items').replace(/^plot\.quests/, 'quests').replace(/^plot\.characters/, 'characters')
    .replace(/^plot\.storyboard\.acts/, 'acts').replace(/^plot\.endings/, 'endings').replace(/^plot\.dialogue\.([a-z0-9_-]+)/, 'dialogue[id=$1]').replace(/^(plot|content)\.([a-zA-Z]+)/, 'section_$1_$2');
}
