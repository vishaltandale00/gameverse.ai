// @ts-check
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
import { contractsFor, referenceOf, idsAt, ZONES, SECTIONS } from './content.js';
import { isObj, isList, isStr, list, strings, obj as asObject, prop } from '../kernel/guards.js';

/** @typedef {import('../kernel/types.js').Doc} Doc */
/** @typedef {import('../kernel/types.js').Card} Card */
/** @typedef {import('../kernel/types.js').Instance} Instance */
/** @typedef {import('../kernel/types.js').SpaceInstance} SpaceInstance */
/** @typedef {import('../kernel/types.js').ParamSchema} ParamSchema */
/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** @typedef {import('../kernel/types.js').RegisteredPrimitive} RegisteredPrimitive */
/** @typedef {import('./types.js').ReplySchema} ReplySchema */
/** @typedef {import('./content.js').MergedContract} MergedContract */
/** A JSON schema node (the strict structured-output dialect). @typedef {Record<string, unknown>} JsonSchema */
/** @typedef {{ type: 'object', additionalProperties: false, required: string[], properties: Record<string, JsonSchema>, description?: string }} ObjectSchema */
/** A param/field spec as cards write it (any field may be missing). @typedef {Partial<ParamSchema>} Spec */
/**
 * How a form value decodes back to document JSON: as is, JSON text (lenient, strict object/list, effects list),
 * a list of a codec, or an object of field codecs (more: a more_json catch-all; tune: a tune_json catch-all).
 * @typedef {'raw' | 'json' | 'strict' | 'effects' | { list: Codec } | FieldsCodec} Codec
 */
/** @typedef {{ fields: Record<string, Codec>, more: boolean, tune?: boolean }} FieldsCodec */
/** @typedef {{ id: string, exits: boolean, count: number }} SpaceLayout */
/**
 * Where a strict slot's reference fields get their enums: the ids a field may hold (the document's own ids of the
 * section its declaration names), or null when the field stays free text.
 * @typedef {{ allowed: (spec: Spec) => string[] | null }} RefContext
 */
/** Component slots: the archetype components schema and each component's codec. @typedef {{ schema: ObjectSchema, codecs: Record<string, Codec> }} ComponentSlots */
/**
 * The outline form: the strict schema, the converter of a filled form (model output) into a draft document, and what it was built from.
 * @typedef {{ schema: ReplySchema, toDoc: (form: unknown) => Record<string, unknown>, contracts: MergedContract[], systems: string[], sections: string[], groups: FormGroup[],
 *   storyGroup: (cast: { characters?: string[], archetypes?: string[], items?: string[] }) => FormGroup | null, version: string }} OutlineForm
 */
/**
 * One small part of the form, asked for on its own. `phase` orders them (frame, then params one primitive at a time in
 * dependency order, then content one contract section at a time, then the story); `wave` 2 (the story) waits for wave
 * 1's ids. A params group writes one primitive's slot (`use`, at systems.<sub>).
 * @typedef {{ id: string, keys: string[], wave: number, phase: 'frame' | 'params' | 'content' | 'story', schema: ReplySchema, use?: string, sub?: string }} FormGroup
 */

export const FORM_VERSION = 'outline-form/0.1';
const WIDE = 32;           // objects with more fields than this keep their required + first fields; the rest go to more_json
const KEEP = 28;           // (validators read fields like a turn action's `hit`: they must stay structured, not hide in more_json)
const MAX_DEPTH = 4;       // nesting inside a param before values travel as JSON strings
const SMALL_CARD = 12;     // cards with at most this many params expose every param
const MAX_ENUM = 64;       // reference fields with more ids than this stay free text (the ids go in the description)
/** @param {unknown} s @returns {string} */
const slug = s => (String(s || '').toLowerCase().match(/[a-z0-9]+/g) || ['x']).join('_').slice(0, 48);
/** @param {string} [description] @returns {JsonSchema} */
export const str = (description) => ({ type: 'string', ...(description ? { description } : {}) });
/** @param {JsonSchema} s @returns {JsonSchema} */
export const nul = s => ({ anyOf: [s, { type: 'null' }] });
/** @param {Record<string, JsonSchema>} properties @param {string} [description] @returns {ObjectSchema} */
export const obj = (properties, description) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties, ...(description ? { description } : {}) });
/** @param {JsonSchema} items @param {string} [description] @returns {JsonSchema} */
export const arr = (items, description) => ({ type: 'array', items, ...(description ? { description } : {}) });
const JSON_HINT = 'JSON text (a JSON value encoded as a string), or null to leave it unset';
/** @param {Spec} spec @returns {string | undefined} */
const describe = spec => [spec.effect, spec.unit && `unit ${spec.unit}`, (spec.min !== undefined || spec.max !== undefined) && `range ${spec.min ?? ''}..${spec.max ?? ''}`, spec.default !== undefined && `default ${JSON.stringify(spec.default).slice(0, 60)}`].filter(Boolean).join('; ').slice(0, 200) || undefined;

/** A string slot restricted to ids (an enum) with its description. @param {string[]} ids @param {string | undefined} d @returns {JsonSchema} */
const idEnum = (ids, d) => ({ type: 'string', enum: ids, ...(d ? { description: d } : {}) });
/** A spec whose values are single strings (no fixed options): a reference may restrict them. @param {Spec | undefined} s */
const plainString = s => Boolean(s && (s.type === 'ref' || (s.type === 'string' && !s.options?.length)));

/**
 * Schema + codec for one param/field spec. codec: 'raw' | 'json' | { fields, more } | { list }. With `refs`, reference
 * fields (refs and strings whose declaration names a section) become enums of the document's ids.
 * @param {Spec} spec @param {number} [depth] @param {RefContext | null} [refs] @returns {{ schema: JsonSchema, codec: Codec }}
 */
export function specSchema(spec, depth = 0, refs = null) {
  let d = describe(spec);
  const t = spec?.type;
  const ids = refs && (plainString(spec) || (t === 'list' && plainString(spec.of))) ? refs.allowed(spec) : null;
  if (ids && t !== 'list') return { schema: idEnum(ids, d), codec: 'raw' };
  if (ids && t === 'list' && depth < MAX_DEPTH) return { schema: arr(idEnum(ids, describe(spec.of || {})), d), codec: { list: 'raw' } };
  // The card's range is the slot's range (minimum/maximum), so the form never allows a number preflight rejects.
  if (t === 'number' || t === 'integer') return { schema: { type: t, ...(typeof spec.min === 'number' ? { minimum: spec.min } : {}), ...(typeof spec.max === 'number' ? { maximum: spec.max } : {}), ...(d ? { description: d } : {}) }, codec: 'raw' };
  if (t === 'boolean') return { schema: { type: 'boolean', ...(d ? { description: d } : {}) }, codec: 'raw' };
  if (t === 'string' && Array.isArray(spec.reserved) && spec.reserved.length) d = `${d ? d + '; ' : ''}never ${spec.reserved.join(', ')} (reserved)`;
  if (t === 'string') return { schema: spec.options?.length ? { type: 'string', enum: spec.options.map(String), ...(d ? { description: d } : {}) } : str(d), codec: 'raw' };
  if (t === 'ref') return { schema: str(`id of a ${spec.to}${d ? `; ${d}` : ''}`), codec: 'raw' };
  if (t === 'list' && depth < MAX_DEPTH) {
    const inner = specSchema(spec.of || { type: 'json' }, depth + 1, refs);
    return { schema: arr(inner.schema, d), codec: { list: inner.codec } };
  }
  if (t === 'object' && spec.fields && !spec.open && depth < MAX_DEPTH && Object.keys(spec.fields).length) return objectSchema(spec.fields, depth + 1, d, refs);
  // json params may hold a bare string ("coins"); predicates, effects and objects must parse as JSON.
  return { schema: nul(str(`${d ? d + '. ' : ''}${JSON_HINT}`)), codec: t === 'json' || !t ? 'json' : t === 'effects' ? 'effects' : 'strict' };
}

/**
 * A strict object over fields: optional ones nullable; wide objects keep required + first fields and a more_json.
 * @param {Record<string, Spec> | undefined} fields @param {number} [depth] @param {string} [description] @param {RefContext | null} [refs]
 * @returns {{ schema: ObjectSchema, codec: FieldsCodec }}
 */
export function objectSchema(fields, depth = 0, description, refs = null) {
  const entries = Object.entries(fields || {});
  // A field with declared options stays a strict enum slot even in a wide object (never JSON text the model may fill freely).
  const keep = entries.length > WIDE ? entries.filter(([, f], i) => f?.required || (f?.type === 'list' && (f.min || 0) > 0) || (Array.isArray(f?.options) && f.options.length > 0) || i < KEEP) : entries;
  /** @type {Record<string, JsonSchema>} */
  const props = {};
  /** @type {Record<string, Codec>} */
  const codecs = {};
  for (const [k, f] of keep) { const s = specSchema(f || {}, depth, refs); props[k] = f?.required || (f?.type === 'list' && (f.min || 0) > 0) || (typeof s.codec === 'string' && s.codec !== 'raw') ? s.schema : nul(s.schema); codecs[k] = s.codec; }
  const more = entries.length > keep.length;
  if (more) props.more_json = nul(str(`other fields as one JSON object: ${entries.filter(e => !keep.includes(e)).map(([k]) => k).join(', ').slice(0, 300)}`));
  return { schema: obj(props, description), codec: { fields: codecs, more } };
}

/** Decode a form value back to document JSON with its codec (nulls drop out: they mean "use the default"). @param {unknown} value model output @param {Codec} codec @returns {unknown} */
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
  if (typeof codec === 'object' && 'list' in codec) return Array.isArray(value) ? value.map(v => decode(v, codec.list)).filter(v => v !== undefined) : undefined;
  if (typeof codec === 'object' && 'fields' in codec) {
    if (!isObj(value)) return undefined;
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, c] of Object.entries(codec.fields)) { const v = decode(value[k], c); if (v !== undefined) out[k] = v; }
    if (codec.more && typeof value.more_json === 'string') { const m = decode(value.more_json, 'json'); if (isObj(m)) for (const [k, v] of Object.entries(m)) if (out[k] === undefined) out[k] = v; }
    return out;
  }
  return value;
}

/** A card's params as a form slot: which params are exposed directly; the rest travel in tune_json. @param {Card} card @param {{ skip?: string[], refs?: RefContext | null }} [options] */
function paramsSlot(card, { skip = [], refs = null } = {}) {
  const params = Object.entries(card.params || {}).filter(([k]) => !skip.includes(k));
  const small = params.length <= SMALL_CARD;
  const direct = params.filter(([, s]) => small || s.required || ['list', 'object', 'ref'].includes(s.type) || (s.type === 'string' && s.options));
  const { schema, codec } = objectSchema(Object.fromEntries(direct), 1, undefined, refs);
  const rest = params.filter(p => !direct.includes(p)).map(([k]) => k);
  if (rest.length) { schema.properties.tune_json = nul(str(`other params of this primitive as one JSON object (only those to change from the defaults): ${rest.join(', ').slice(0, 400)}`)); schema.required.push('tune_json'); codec.tune = true; }
  return { schema, codec };
}

/** Component slots for archetypes: every component a chosen primitive owns (card.components), strict. @param {RegistryLike} registry @param {string[]} ids @param {RefContext | null} [refs] @returns {ComponentSlots} */
export function componentSlots(registry, ids, refs = null) {
  /** @type {Record<string, JsonSchema>} */
  const props = {};
  /** @type {Record<string, Codec>} */
  const codecs = {};
  // card.components is written by primitive authors (program code): component name -> field spec.
  for (const id of ids) for (const [k, spec] of Object.entries(/** @type {Record<string, Spec>} */ (registry.get(id)?.card.components || {}))) {
    if (props[k]) continue;
    const s = specSchema(spec, 1, refs);
    props[k] = typeof s.codec === 'string' && s.codec !== 'raw' ? s.schema : nul(s.schema); codecs[k] = s.codec;
  }
  props.other_json = nul(str('other components as one JSON object (model, loot, faction, cpu, item...)'));
  return { schema: obj(props, 'components keyed by owning primitive; null = this archetype has none of it'), codecs };
}

export const ITEM_KINDS = ['material', 'tool', 'weapon', 'armor', 'food', 'potion', 'key', 'quest', 'currency', 'charm', 'ammo', 'block', 'prop', 'misc'];
export const ARCH_KINDS = ['player', 'npc', 'creature', 'enemy', 'boss', 'vehicle', 'prop', 'projectile', 'pickup', 'mount'];
const KERNEL_SECTIONS = new Set(['plot.characters', 'plot.storyboard', 'plot.endings', 'plot.quests', 'plot.dialogue', 'content.items', 'content.archetypes', 'content.models']);

/** Spawn-rule list params (card.defines spawn_rule) are filled from the form's spawns, not written per instance. */
/** @param {Card} card @returns {string[]} */
const spawnParams = card => (card.defines || []).flatMap(d => (d.kind === 'spawn_rule' && d.in ? [d.in] : []));

/**
 * outlineForm({ registry, skeleton, selection }) -> { schema: {name, schema}, toDoc(form) -> doc, contracts, systems, sections, layout }
 * skeleton: the procedural scaffold document (its spaces, zone shapes, systems and views are the frame).
 * @param {{ registry: RegistryLike, skeleton: Doc, selection?: unknown }} args @returns {OutlineForm}
 */
export function outlineForm({ registry, skeleton, selection = null }) {
  // Every selected primitive is in the form, including those the skeleton had to drop for lack of content
  // (turns without sides, battles without species): the model writes that content, so it must be asked for.
  const systems = [...new Set([...(skeleton.systems || []).map(s => s.use), ...strings(prop(selection, 'systems'))])].filter(id => typeof id === 'string' && registry.has(id));
  const used = [...new Set([...(skeleton.spaces || []).flatMap(s => [s.use, ...(s.generators || []).map(g => g.use)]), ...systems])];
  const contracts = contractsFor(registry, used);
  const reads = new Set(used.flatMap(id => (registry.get(id)?.card.reads || []).filter(r => typeof r === 'string')));
  const hasQuests = reads.has('plot.quests'), hasDialogue = reads.has('plot.dialogue');
  const sections = [...new Set([...reads, ...contracts.filter(c => c.need === 'section').map(c => c.at)])].filter(/** @returns {r is string} */ r => typeof r === 'string' && /^(plot|content)\.[a-zA-Z]+$/.test(r) && !KERNEL_SECTIONS.has(r) && r !== 'content.blocks');
  const spawner = registry.ids().find(id => { const card = registry.get(id)?.card; return Boolean(card && spawnParams(card).length && card.params?.rules); });
  /** @type {Record<string, JsonSchema>} */
  const props = {};
  props.title = str('an evocative title for THIS idea');
  props.logline = str('one sentence');
  props.premise = str('two or three sentences: the world, the player, the goal');

  // References: a field whose declaration names where its ids come from picks from the scaffold's ids (an enum), unless
  // the same small form writes that collection (then its own new ids are valid). Zones are structure: always the
  // scaffold's. The sections offered this way keep the entries the filled form refers to (keepReferenced).
  /** @type {Map<string, Set<string>>} */
  const offered = new Map();
  const zoneIds = [...new Set(idsAt(skeleton, ZONES))];
  /** @param {string} slot a top-level form slot @returns {RefContext} */
  const refsFor = slot => ({
    allowed(spec) {
      const at = referenceOf(registry, spec);
      if (!at) return null;
      if (at === ZONES) return zoneIds.length && zoneIds.length <= MAX_ENUM ? zoneIds : null;
      // A section path (an adapter's source/target) is one of the document's own sections, never an id inside one.
      if (at === SECTIONS) { const paths = [...new Set(idsAt(skeleton, SECTIONS))]; return paths.length ? paths : null; }
      if (groupOfSlot(slotOfSection(at)) === groupOfSlot(slot)) return null;
      const ids = [...new Set(idsAt(skeleton, at))];
      if (!ids.length || ids.length > MAX_ENUM) return null;
      const seen = offered.get(at) || new Set(); ids.forEach(id => seen.add(id)); offered.set(at, seen);
      return ids;
    },
  });

  // Spaces: fixed by the selection (ids, primitives, params); the model names and describes the zones (the ids are the scaffold's).
  /** @type {SpaceLayout[]} */
  const layout = [];
  /** @type {Record<string, JsonSchema>} */
  const spaceProps = {};
  for (const s of skeleton.spaces || []) {
    const exits = (s.zones || []).some(z => Array.isArray(z.exits));
    const own = [...new Set((s.zones || []).map(z => z.id).filter(isStr))];
    const zoneId = (/** @type {string} */ d) => (own.length && own.length <= MAX_ENUM ? idEnum(own, d) : str(d));
    const zone = obj({
      id: zoneId('the zone id (each once)'), name: str(), description: str('one line: what is here that no other zone has (terrain, hazards, who and what you meet)'),
      ...(exits ? { exits: arr(obj({ to: zoneId('zone id in this space'), gate_json: nul(str(`predicate that must hold to pass (${JSON_HINT}), e.g. {"item":"brass_key"}`)) })) } : {}),
    });
    // A space the preset gave no zones (a board, a card table) has none to name: places exist only where the structure needs them.
    if ((s.zones || []).length) spaceProps[s.id] = obj({ zones: arr(zone, `${(s.zones || []).length} zones, one per zone id, each distinct`) }, `space ${s.id} (${s.use})`);
    layout.push({ id: s.id, exits, count: (s.zones || []).length });
  }
  props.spaces = obj(spaceProps, 'every space of the game, by id');

  // Systems: one slot per chosen primitive, with its real params. An adapter (card.adapts) whose every required param
  // the preset wrote (a skin's maps from the mashup and the contracts) is structure: it has no slot, and the document
  // keeps the preset's configuration. One that still needs content (a nested encounter's trigger) keeps its slot.
  /** @type {Record<string, JsonSchema>} */
  const sysProps = {};
  /** @type {Record<string, FieldsCodec>} */
  const sysCodecs = {};
  const configured = (/** @type {string} */ id) => {
    const card = registry.get(id)?.card;
    if (!card?.adapts) return false;
    const need = Object.entries(card.params || {}).filter(([, s]) => s.required).map(([k]) => k);
    return (skeleton.systems || []).some(s => s.use === id && isObj(s.with) && Object.keys(s.with).length > 0 && need.every(k => s.with?.[k] !== undefined));
  };
  for (const id of systems) {
    if (configured(id)) continue;
    const card = /** @type {RegisteredPrimitive} */ (registry.get(id)).card;
    const slot = paramsSlot(card, { skip: spawnParams(card), refs: refsFor('systems') });
    sysProps[formKey(id)] = obj({ with: slot.schema }, `${id}: ${String(card.intent || '').slice(0, 300)}`);
    sysCodecs[id] = slot.codec;
  }
  // Primitives are the selection's (built and checked mechanic by mechanic): the form writes their params, never adds one.
  props.systems = obj(sysProps, 'every chosen primitive with its params; null means the default');

  // Content.
  const { props: content, comps } = contentProps({ registry, used, hasQuests, hasDialogue, spawner, refs: refsFor('archetypes'), zones: zoneIds });
  Object.assign(props, content);
  // Sections a chosen card's content contract requires are required here too (never an empty "[]").
  const sectionNeeds = new Map(contractsFor(registry, systems).filter(c => c.at).map(c => [c.at, c]));
  /** @type {Record<string, Codec>} */
  const sectionCodecs = {};
  for (const sec of sections) {
    const c = sectionNeeds.get(sec);
    // A card that declares this section's shape (card.data) makes it a strict slot; otherwise JSON text.
    const declared = used.map(id => /** @type {Record<string, Spec> | undefined} */ (registry.get(id)?.card.data)?.[sec]).find(Boolean);
    if (declared) { const d = specSchema({ ...declared, ...(c ? { min: Math.max(declared.min || 0, c.min || 1) } : {}) }, 0, refsFor(slotOfSection(sec))); props[`section_${sec.replace('.', '_')}`] = d.schema; sectionCodecs[sec] = d.codec; continue; }
    props[`section_${sec.replace('.', '_')}`] = str(c
      ? `${sec} as JSON text. REQUIRED by ${c.uses.join(', ')}: at least ${c.min || 1} entries in the shape the system prompt documents for ${sec}${c.why ? ` (${c.why})` : ''}; never "[]"`
      : `${sec} as JSON text (the list or id-keyed object the primitives read; "[]" if this game needs none)`);
  }
  if (reads.has('plot.storyboard')) props.acts = arr(obj({ id: str(), title: str(), beats: arr(obj({ id: str(), title: str(), when_json: nul(str(`trigger predicate (${JSON_HINT}), e.g. {"zone":"hall"}`)), after: arr(str('beat id')), optional: { type: 'boolean' }, do_json: nul(str(`effects list (${JSON_HINT}), e.g. [{"do":"say","character":"guide","text":"..."}]`)) })) }), 'the story: acts of beats, completable, the last one ending the game');
  props.endings = arr(obj({ id: str(), title: str(), text: str(), outcome: { type: 'string', enum: ['won', 'lost', 'neutral'] } }));
  // The player's body: one of the scaffold's player archetypes (kept in the document when chosen), or the cast's own player.
  const players = [...new Set(list(skeleton.content?.archetypes).filter(a => prop(a, 'kind') === 'player').map(a => prop(a, 'id')).filter(isStr))];
  if (players.length) { const seen = offered.get('content.archetypes') || new Set(); players.forEach(id => seen.add(id)); offered.set('content.archetypes', seen); }
  props.player = obj({ archetype: players.length ? idEnum(players, 'the player archetype id') : str('the player archetype id (an archetypes entry of kind player)'), zone: zoneIds.length ? idEnum(zoneIds, 'start zone id') : str('start zone id') });

  const schema = { name: 'game_outline', schema: obj(props) };
  const toDoc = (/** @type {unknown} */ form) => formToDoc(form, { registry, skeleton, systems, sysCodecs, comps, sections, spawner, layout, sectionCodecs, offered });
  // The story form (wave 2) once the cast is written: its references to characters, archetypes, items and zones are
  // enums of the ids wave 1 wrote, so beats, dialogue and quests name real ones.
  const storyGroup = (/** @type {{ characters?: string[], archetypes?: string[], items?: string[] }} */ cast) => {
    const story = GROUPS.find(g => g.id === 'story');
    if (!story) return null;
    const { props: again } = contentProps({ registry, used, hasQuests, hasDialogue, spawner, refs: refsFor('archetypes'), zones: zoneIds, cast });
    const p = Object.fromEntries(story.keys.map(k => [k, k === 'acts' ? props.acts : again[k]]).filter(([, v]) => v));
    return Object.keys(p).length ? { id: story.id, keys: Object.keys(p), wave: story.wave, phase: story.phase, schema: { name: `game_outline_${story.id}`, schema: obj(p) } } : null;
  };
  const uses = Object.fromEntries(Object.keys(sysCodecs).map(id => [formKey(id), id]));
  return { schema, toDoc, contracts, systems, sections, groups: formGroups(props, uses), storyGroup, version: FORM_VERSION };
}

// The small forms the outline is asked in: each a strict schema of a few top-level slots. The world frame; one form
// per chosen primitive's params (systems.<id>), asked in dependency order (build.js dependencyLayers); the cast
// (archetypes, their spawns, items, characters) and each content section, each checked against its content contract
// as soon as it is written; then the story, which refers to the cast and places (wave 2).
/** @type {Array<{ id: string, keys: string[], wave: number, phase: FormGroup['phase'] }>} */
const GROUPS = [
  { id: 'frame', keys: ['title', 'logline', 'premise', 'spaces', 'player', 'endings'], wave: 1, phase: 'frame' },
  { id: 'cast', keys: ['archetypes', 'spawns', 'items', 'characters'], wave: 1, phase: 'content' },
  { id: 'story', keys: ['acts', 'dialogue', 'quests'], wave: 2, phase: 'story' },
];
/** The params form of a primitive: its group id. @param {string} id */
export const paramsGroupId = id => `params_${formKey(id)}`;
/**
 * The form split into small strict forms: the frame, one per primitive's params (`uses`: form key -> primitive id),
 * the cast, one per section, the story. @param {Record<string, JsonSchema>} props @param {Record<string, string>} [uses] @returns {FormGroup[]}
 */
export function formGroups(props, uses = {}) {
  /** @type {FormGroup[]} */
  const out = [];
  const pick = (/** @type {string[]} */ keys) => Object.fromEntries(keys.filter(k => props[k]).map(k => [k, props[k]]));
  const named = (/** @type {string} */ id) => `game_outline_${id}`.slice(0, 64);
  for (const g of GROUPS) { const p = pick(g.keys); if (Object.keys(p).length) out.push({ id: g.id, keys: Object.keys(p), wave: g.wave, phase: g.phase, schema: { name: named(g.id), schema: obj(p) } }); }
  const sys = /** @type {ObjectSchema | undefined} */ (props.systems);
  for (const [key, slot] of Object.entries(sys?.properties || {})) {
    const use = uses[key] || key.replace(/__/g, '.');
    out.push({ id: paramsGroupId(use), keys: ['systems'], sub: key, use, wave: 1, phase: 'params', schema: { name: named(paramsGroupId(use)), schema: obj({ systems: obj({ [key]: slot }, sys?.description) }) } });
  }
  for (const k of Object.keys(props)) if (k.startsWith('section_')) out.push({ id: k, keys: [k], wave: 1, phase: 'content', schema: { name: named(k), schema: obj({ [k]: props[k] }) } });
  return out;
}
/**
 * The group a form path belongs to (its top-level slot; a primitive's params form for systems.<key>), or null.
 * @param {FormGroup[]} groups @param {string} path
 */
export function groupOfPath(groups, path) {
  const [top, sub] = String(path || '').split(/[.[\]"]+/).filter(Boolean);
  return groups.find(g => g.keys.includes(top) && (!g.sub || g.sub === sub)) || null;
}
/** The small form a top-level slot is asked in (a section slot is its own). @param {string} slot */
const groupOfSlot = slot => (slot.startsWith('section_') ? slot : GROUPS.find(g => g.keys.includes(slot))?.id ?? slot);
/** @type {Record<string, string>} the form slot that writes a kernel section */
const SECTION_SLOTS = { 'content.archetypes': 'archetypes', 'content.items': 'items', 'plot.characters': 'characters', 'plot.dialogue': 'dialogue', 'plot.quests': 'quests', 'plot.endings': 'endings', 'plot.storyboard': 'acts' };
/** The top-level form slot that writes a document section. @param {string} section */
const slotOfSection = section => SECTION_SLOTS[section] || `section_${section.replace('.', '_')}`;

/**
 * A filled form's references stay valid across the small forms: a section whose scaffold ids another form offered as
 * an enum keeps (or regains, from the scaffold) every entry the document refers to, even when its own form dropped
 * or renamed it. Only entries something refers to come back, so a themed section is not padded with the defaults.
 * @param {{ plot: Record<string, unknown>, content: Record<string, unknown> }} out the document being built
 * @param {Doc} skeleton @param {Map<string, Set<string>>} offered section -> the ids its enums offered
 */
function keepReferenced(out, skeleton, offered) {
  for (const [section, ids] of offered) {
    const [root, key] = section.split('.');
    const target = root === 'plot' ? out.plot : root === 'content' ? out.content : null;
    const source = prop(prop(skeleton, root), key);
    if (!target || source === undefined) continue;
    const have = new Set(idsAt(out, section));
    /** @type {Set<string>} */
    const used = new Set();
    const cur = target[key];
    /** @param {unknown} v */
    const walk = v => { if (v === cur) return; if (isStr(v)) used.add(v); else if (Array.isArray(v)) v.forEach(walk); else if (isObj(v)) Object.values(v).forEach(walk); };
    walk(out);
    const missing = [...ids].filter(id => used.has(id) && !have.has(id));
    if (!missing.length) continue;
    if (Array.isArray(source)) {
      const entries = structuredClone(source.filter(x => missing.includes(isStr(x) ? x : String(prop(x, 'id')))));
      if (cur === undefined) target[key] = entries; else if (Array.isArray(cur)) cur.push(...entries);
    } else if (isObj(source)) {
      const entries = Object.fromEntries(missing.filter(id => id in source).map(id => [id, structuredClone(source[id])]));
      if (cur === undefined) target[key] = entries;
      else if (isObj(cur)) Object.assign(cur, entries);
      else if (Array.isArray(cur)) cur.push(...(cur.every(isStr) ? Object.keys(entries) : Object.entries(entries).map(([id, v]) => ({ ...(isObj(v) ? v : {}), id }))));
    }
  }
}

/**
 * Field-level repair: a strict form over exactly the failing fields of a filled form. Each failing form path (as
 * formPath names it, e.g. section_content_species[0].types) becomes one slot holding that field's own schema (its
 * enums included); apply(filled, reply) writes the answers back at those paths and leaves every other field as it was.
 * A path inside another failing path is covered by it; paths the form has no slot for come back in `unresolved` (the
 * caller re-asks their small form).
 * @param {ReplySchema} schema the whole form's (or a small form's) schema @param {string[]} paths failing form paths
 * @returns {{ schema: ReplySchema, slots: Array<{ name: string, path: string }>, unresolved: string[], apply: (filled: unknown, reply: unknown) => Record<string, unknown> }}
 */
export function fieldForm(schema, paths) {
  /** @param {string} p @returns {Array<string | number>} */
  const keysOf = p => {
    /** @type {Array<string | number>} */
    const keys = [];
    String(p).replace(/\["([^"]*)"\]|\[(\d+)\]|([^.[\]]+)/g, (_, q, i, n) => { keys.push(q !== undefined ? q : i !== undefined ? Number(i) : n); return ''; }); return keys; };
  /** @param {unknown} n @returns {Record<string, any> | null} */
  const bare = n => { if (!isObj(n)) return null; const any = n.anyOf; return Array.isArray(any) ? /** @type {Record<string, any> | undefined} */ (any.find(x => prop(x, 'type') !== 'null')) ?? null : n; };
  /** @param {Array<string | number>} keys @returns {Record<string, any> | null} */
  const nodeAt = keys => {
    /** @type {Record<string, any> | null} */
    let n = /** @type {Record<string, any>} */ (schema.schema);
    for (const k of keys) {
      const b = bare(n); if (!b) return null;
      n = typeof k === 'number' ? (b.type === 'array' ? b.items : null) : (b.type === 'object' && isObj(b.properties) && k in b.properties ? b.properties[k] : null);
    }
    return n;
  };
  const resolved = [...new Set(paths.map(String))].map(path => ({ path, keys: keysOf(path), node: nodeAt(keysOf(path)) }));
  const unresolved = resolved.filter(r => !r.node || !r.keys.length).map(r => r.path);
  const ok = resolved.filter(r => r.node && r.keys.length);
  const inside = (/** @type {Array<string | number>} */ a, /** @type {Array<string | number>} */ b) => b.length < a.length && b.every((k, i) => a[i] === k);
  const kept = ok.filter(r => !ok.some(o => inside(r.keys, o.keys)));
  const slots = kept.map((r, i) => ({ name: `field_${i + 1}`, path: r.path, keys: r.keys, node: /** @type {Record<string, any>} */ (r.node) }));
  /** @type {Record<string, JsonSchema>} */
  const props = Object.fromEntries(slots.map(s => [s.name, { ...s.node, description: `${s.path}${s.node.description ? `: ${s.node.description}` : ''}`.slice(0, 300) }]));
  const apply = (/** @type {unknown} */ filled, /** @type {unknown} */ reply) => {
    /** @type {Record<string, unknown>} */
    const out = isObj(filled) ? structuredClone(filled) : {};
    for (const s of slots) {
      const v = prop(reply, s.name);
      if (v === undefined) continue;
      /** @type {any} */
      let parent = out;
      for (let i = 0; i < s.keys.length - 1; i++) { const k = s.keys[i]; if (parent[k] == null || typeof parent[k] !== 'object') parent[k] = typeof s.keys[i + 1] === 'number' ? [] : {}; parent = parent[k]; }
      parent[s.keys[s.keys.length - 1]] = v;
    }
    return out;
  };
  return { schema: { name: `${schema.name}_fields`.slice(0, 64), schema: obj(props, 'only the fields that failed checks, each at the path its description names') }, slots: slots.map(({ name, path }) => ({ name, path })), unresolved, apply };
}

/** A primitive id as a form property name (strict schemas want plain names: dots become double underscores). @param {string} id */
export const formKey = id => id.replace(/\./g, '__');
/** @param {unknown} v */
const parseJson = v => decode(v, 'json');
/** @param {unknown} v @returns {unknown[]} */
const listOf = v => (Array.isArray(v) ? v : []);

/**
 * Form slots for content (shared by the outline and the per-zone detail form): archetypes with the component slots
 * of every primitive in `used`, spawns (when a spawner exists; `zone` fixes their zone), items, characters, and
 * dialogue / quests when a primitive reads them. -> { props, comps }
 * With `refs`, component fields that refer to other forms' collections are enums of the document's ids; with `zones`, zone fields are;
 * with `cast` (the ids another form already wrote), the story's references to characters, archetypes and items are.
 * @param {{ registry: RegistryLike, used: string[], hasQuests: boolean, hasDialogue: boolean, spawner: string | null | undefined, zone?: string | null, refs?: RefContext | null, zones?: string[] | null,
 *   cast?: { characters?: string[], archetypes?: string[], items?: string[] } | null }} args
 * @returns {{ props: Record<string, JsonSchema>, comps: ComponentSlots }}
 */
export function contentProps({ registry, used, hasQuests, hasDialogue, spawner, zone = null, refs = null, zones = null, cast = null }) {
  /** @type {Record<string, JsonSchema>} */
  const props = {};
  const comps = componentSlots(registry, used, refs);
  /** A zone reference: the document's zone ids when known. @param {string} d */
  const zoneRef = d => (zones?.length && zones.length <= MAX_ENUM ? idEnum(zones, d) : str(d));
  /** A reference into the cast another form wrote: an enum of its ids when known. @param {'characters' | 'archetypes' | 'items'} kind @param {string} d */
  const castRef = (kind, d) => { const ids = [...new Set(cast?.[kind] || [])]; return ids.length && ids.length <= MAX_ENUM ? idEnum(ids, d) : str(d); };
  props.archetypes = arr(obj({ id: str('lowercase slug'), kind: { type: 'string', enum: ARCH_KINDS }, name: str(), components: comps.schema }), 'every kind of entity: enemies, creatures, pickups, props, vehicles, NPC bodies; give each the components its role needs');
  if (spawner) props.spawns = arr(obj({ id: str('rule id'), archetype: str('archetype id'), ...(zone ? {} : { zone: nul(zoneRef('zone id where they appear (null on a space without zones)')), at_json: nul(str('where exactly, as JSON: a point [x, y] or a list of points (cells on a board); null to scatter them in the zone')) }), min: { type: 'integer' }, max: { type: 'integer' }, respawnSec: nul({ type: 'number', description: '0 = never respawn' }), when_json: nul(str(`predicate that must hold (${JSON_HINT})`)) }), zone ? `what appears in ${zone}: its own enemies, pickups and props` : 'what appears where: every enemy, pickup and prop archetype placed in the zones it belongs to');
  props.items = arr(obj({ id: str('lowercase slug'), name: str(), kind: { type: 'string', enum: ITEM_KINDS }, desc: str(), value: nul({ type: 'number' }), more_json: nul(str('other item fields as a JSON object (weapon, use, creature, stats...)')) }));
  props.characters = arr(obj({ id: str('lowercase slug'), name: str(), role: str(), bio: str(), ...(zone ? {} : { home: nul(zoneRef('zone id')) }), archetype: nul(str('archetype id for their body, if any')), dialogue: arr(str('dialogue id')) }));
  if (hasDialogue) props.dialogue = arr(obj({ id: str('dialogue id'), speaker: castRef('characters', 'character id'), start: str('first node id'), nodes: arr(obj({ id: str('node id'), who: nul(castRef('characters', 'character id; null = the speaker')), say: str(), next: nul(str('node id')), end: { type: 'boolean' }, choices: arr(obj({ text: str(), next: nul(str('node id')), do_json: nul(str(`effects list (${JSON_HINT})`)) })), do_json: nul(str(`effects list (${JSON_HINT})`)) })) }), 'conversations as node graphs');
  if (hasQuests) {
    // The plot primitive's objective kinds (program code): kind -> { fields }.
    const objectives = /** @type {Record<string, { fields?: object }>} */ (OBJECTIVES);
    const kinds = Object.keys(objectives);
    props.quests = arr(obj({ id: str('lowercase slug'), title: str(), kind: { type: 'string', enum: ['main', 'side', 'contract', 'bounty', 'challenge'] }, giver: nul(castRef('characters', 'character id')), ...(zone ? {} : { zone: nul(zoneRef('zone id')) }), summary: str(), autoStart: { type: 'boolean' },
      objectives: arr(obj({ id: str(), kind: { type: 'string', enum: kinds }, text: str(), zone: nul(zone ? str() : zoneRef('zone id')), item: nul(castRef('items', 'item id')), character: nul(castRef('characters', 'character id')), archetype: nul(castRef('archetypes', 'archetype id')), count: nul({ type: 'integer' }), more_json: nul(str(`other fields of this objective kind (${kinds.map(k => `${k}: ${Object.keys(objectives[k].fields || {}).join('/')}`).join('; ').slice(0, 500)})`)) })),
      rewards_json: nul(str('{"xp"?, "money"?, "items"?: [{"item","count"}]} as JSON')) }), 'quests the quest primitive runs; objectives use the goal kinds');
  }
  return { props, comps };
}

/**
 * Content from a filled form (see contentProps): document-shaped lists, plus spawn rules for the spawner.
 * @param {Record<string, unknown>} f the filled form (model output, unchecked) @param {{ comps: { codecs: Record<string, Codec> }, zone?: string | null }} options
 */
export function contentFromForm(f, { comps, zone = null }) {
  const archetypes = listOf(f.archetypes).filter(isObj).map(a => {
    /** @type {Record<string, unknown>} */
    const components = {};
    for (const [k, c] of Object.entries(comps.codecs)) { const v = decode(prop(a.components, k), c); if (v !== undefined && !(isObj(v) && !Object.keys(v).length && typeof c !== 'string')) components[k] = v; }
    const other = parseJson(prop(a.components, 'other_json')); if (isObj(other)) for (const [k, v] of Object.entries(other)) if (components[k] === undefined) components[k] = v;
    if (a.name && components.name === undefined) components.name = String(a.name);
    return { id: slug(a.id || a.name), kind: typeof a.kind === 'string' && ARCH_KINDS.includes(a.kind) ? a.kind : 'prop', components };
  });
  const items = listOf(f.items).filter(isObj).map(i => { const more = parseJson(i.more_json); return { ...(isObj(more) ? more : {}), id: slug(i.id || i.name), name: String(i.name || i.id), kind: typeof i.kind === 'string' && ITEM_KINDS.includes(i.kind) ? i.kind : 'misc', ...(i.desc ? { desc: String(i.desc) } : {}), ...(Number.isFinite(i.value) ? { value: i.value } : {}) }; });
  const characters = listOf(f.characters).filter(isObj).map(c => { const home = zone || (c.home ? slug(c.home) : null); return { id: slug(c.id || c.name), name: String(c.name || c.id), role: String(c.role || ''), ...(c.bio ? { bio: String(c.bio) } : {}), ...(home ? { home } : {}), ...(c.archetype ? { archetype: slug(c.archetype) } : {}), ...(listOf(c.dialogue).length ? { dialogue: listOf(c.dialogue).filter(x => typeof x === 'string').map(id => ({ id })) } : {}) }; });
  /** @type {Record<string, unknown> | undefined} */
  let dialogue;
  if (Array.isArray(f.dialogue)) {
    dialogue = {};
    for (const d of f.dialogue.filter(isObj)) {
      /** @type {Record<string, Record<string, unknown>>} */
      const nodes = {};
      for (const n of listOf(d.nodes).filter(isObj)) {
        /** @type {Record<string, unknown>} */
        const node = { ...(n.who ? { who: n.who } : {}), say: String(n.say || '') };
        if (n.next) node.next = n.next; if (n.end) node.end = true;
        const doFx = decode(n.do_json, 'effects'); if (isList(doFx) && doFx.length) node.do = doFx;
        const choices = listOf(n.choices).filter(isObj).map(c => ({ text: String(c.text || ''), ...(c.next ? { next: c.next } : {}), ...(decode(c.do_json, 'effects') ? { do: decode(c.do_json, 'effects') } : {}) }));
        if (choices.length) node.choices = choices;
        if (!node.next && !node.choices && !node.end) node.end = true;
        nodes[String(n.id || `n${Object.keys(nodes).length + 1}`)] = node;
      }
      if (Object.keys(nodes).length) dialogue[slug(d.id)] = { speaker: d.speaker || 'player', start: nodes[String(d.start)] ? d.start : Object.keys(nodes)[0], nodes };
    }
  }
  const quests = Array.isArray(f.quests) ? f.quests.filter(isObj).map(q => {
    const rewards = parseJson(q.rewards_json), qz = zone || (q.zone ? slug(q.zone) : null);
    return { id: slug(q.id || q.title), title: String(q.title || q.id), kind: q.kind || 'main', ...(q.giver ? { giver: slug(q.giver) } : {}), ...(qz ? { zone: qz } : {}), summary: String(q.summary || ''), ...(q.autoStart ? { autoStart: true } : {}),
      objectives: listOf(q.objectives).filter(isObj).map(o => {
        const more = parseJson(o.more_json);
        /** @type {Record<string, unknown>} */
        const out = { ...(isObj(more) ? more : {}), id: slug(o.id || o.kind), kind: o.kind, text: String(o.text || '') }; for (const k of ['zone', 'item', 'character', 'archetype']) if (o[k]) out[k] = o[k]; if (Number.isInteger(o.count)) out.count = o.count; return out; }),
      ...(isObj(rewards) ? { rewards } : {}) };
  }) : undefined;
  const rules = listOf(f.spawns).filter(isObj).map((r, i) => {
    const lo = typeof r.min === 'number' && Number.isInteger(r.min) ? Math.max(0, r.min) : 1, hi = typeof r.max === 'number' && Number.isInteger(r.max) ? Math.max(lo, r.max) : lo;
    const when = decode(r.when_json, 'strict'), rz = zone || (r.zone ? slug(r.zone) : null);
    const at = decode(r.at_json, 'strict');
    return { id: slug(r.id || `spawn_${i + 1}`), archetype: slug(r.archetype), ...(rz ? { zone: rz } : {}), ...(Array.isArray(at) && at.length ? { at } : {}), count: [Math.max(1, lo), Math.max(1, hi)], ...(typeof r.respawnSec === 'number' && Number.isFinite(r.respawnSec) ? { respawnSec: Math.max(0, r.respawnSec) } : {}), ...(isObj(when) ? { when } : {}) };
  }).filter((r, i, a) => a.findIndex(x => x.id === r.id) === i);
  return { archetypes, items, characters, dialogue, quests, rules };
}

/** Zone geometry for shapes the model does not write (rects, ranges, bounds): laid out by index like the skeleton. @param {SpaceInstance} skeletonSpace @param {Record<string, unknown>[]} zones */
function geometry(skeletonSpace, zones) {
  const ref = skeletonSpace.zones || [];
  const n = zones.length;
  /** @returns {{ kind: 'rect', W: number, H: number, y0: number } | { kind: 'range', L: number } | { kind: 'bounds', template: typeof ref } | null} */
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
    if (e.kind === 'bounds') { const t = e.template[i % e.template.length].bounds; const b = structuredClone(t); z.bounds = b; if (i >= e.template.length) { b.min[0] += 64 * Math.floor(i / e.template.length); b.max[0] += 64 * Math.floor(i / e.template.length); } }
  });
}

/**
 * A start position inside a zone (bounds, rect or range), else null (as outline.js zoneStart). A shape that is not a
 * list of coordinates is skipped.
 * @param {unknown} z @returns {number[] | null}
 */
const zoneStart = z => {
  const min = prop(prop(z, 'bounds'), 'min'), rect = prop(z, 'rect'), range = prop(z, 'range');
  const nums = (/** @type {unknown[]} */ v) => v.map(Number);
  if (isList(min)) { const m = nums(min); return [m[0] + 1, m[1] + 1, m[2] + 1]; }
  if (isList(rect)) { const r = nums(rect); return [r[0] + Math.min(1, (r[2] - r[0]) / 2), r[1] + Math.min(1, (r[3] - r[1]) / 2)]; }
  if (isList(range)) return [Number(range[0]) + 0.5, 0, 0];
  return null;
};

/**
 * A filled form -> a game document in the kernel's shape (references are checked later by preflight and repair).
 * @param {unknown} form the model's filled form
 * @param {{ registry: RegistryLike, skeleton: Doc, systems: string[], sysCodecs: Record<string, FieldsCodec>, comps: ComponentSlots, sections: string[], spawner: string | undefined, layout: SpaceLayout[], sectionCodecs?: Record<string, Codec>, offered?: Map<string, Set<string>> }} frame
 * @returns {Record<string, unknown>} a draft document (unchecked)
 */
export function formToDoc(form, { registry, skeleton, systems, sysCodecs, comps, sections, spawner, layout, sectionCodecs = {}, offered = new Map() }) {
  /** @type {Record<string, unknown>} */
  const f = isObj(form) ? form : {};
  const title = typeof f.title === 'string' && f.title.trim() ? f.title.trim() : skeleton.title;
  const spaces = (skeleton.spaces || []).map(s => {
    const slot = prop(f.spaces, s.id);
    const shape = layout.find(l => l.id === s.id);
    /** @type {Record<string, unknown>[]} */
    let zones = listOf(prop(slot, 'zones')).filter(isObj).map(z => ({ id: slug(z.id || z.name), name: String(z.name || z.id || ''), description: String(z.description || ''),
      ...(shape?.exits ? { exits: listOf(z.exits).filter(isObj).map(x => ({ to: slug(x.to), ...(parseJson(x.gate_json) !== undefined ? { gate: parseJson(x.gate_json) } : {}) })) } : {}) }));
    const seen = new Set(); zones = zones.filter(z => !seen.has(z.id) && seen.add(z.id));
    if (!zones.length) zones = structuredClone(s.zones || []);
    else geometry(s, zones);
    return { ...structuredClone(s), zones };
  });
  /**
   * @type {{ schema: string, id: string, title: string, logline: string, seed: unknown, views: unknown, spaces: Record<string, unknown>[],
   *   systems: Record<string, unknown>[], graphics?: unknown, plot: Record<string, unknown>, content: Record<string, unknown>, player?: unknown }}
   */
  const out = {
    schema: DOC_SCHEMA, id: slug(title).replace(/_/g, '-'), title, logline: String(f.logline || skeleton.logline || ''), seed: skeleton.seed,
    views: structuredClone(skeleton.views), spaces,
    systems: [],
    ...(skeleton.graphics ? { graphics: structuredClone(skeleton.graphics) } : {}),
    plot: { premise: String(f.premise || skeleton.plot?.premise || '') },
    content: {},
  };
  // The scaffold's instances of each primitive: an adapter may have several (two encounters, two regions), each its own.
  /** @type {Map<string, Array<Partial<Instance>>>} */
  const skelSys = new Map();
  for (const s of skeleton.systems || []) skelSys.set(s.use, [...(skelSys.get(s.use) || []), s]);
  for (const id of systems) {
    const slot = prop(f.systems, formKey(id)) ?? prop(f.systems, id), codec = sysCodecs[id];
    // A primitive without a slot (an adapter the preset configured) takes nothing from the model's reply.
    const decoded = codec ? decode(prop(slot, 'with'), codec) : undefined, given = isObj(decoded) ? decoded : {};
    const tune = prop(prop(slot, 'with'), 'tune_json');
    if (codec?.tune && typeof tune === 'string') { const t = parseJson(tune); if (isObj(t)) for (const [k, v] of Object.entries(t)) if (given[k] === undefined && registry.get(id)?.card.params?.[k]) given[k] = v; }
    for (const base of skelSys.get(id) || [{}]) {
      const w = structuredClone(given);
      // Spawn-rule params keep what the scaffold had (start spawns are re-derived by engage); the form's spawns are added below.
      for (const k of spawnParams(/** @type {RegisteredPrimitive} */ (registry.get(id)).card)) if (base.with?.[k] !== undefined) w[k] = structuredClone(base.with[k]);
      // The scaffold's configuration (the preset's mode wiring, engagement) stays unless the model sets a param itself.
      for (const [k, v] of Object.entries(base.with || {})) if (w[k] === undefined) w[k] = structuredClone(v);
      // Instance fields are the scaffold's (an adapter's id names its region or encounter): the form never drops them.
      out.systems.push({ use: id, ...(typeof base.id === 'string' ? { id: base.id } : {}), ...(base.space ? { space: base.space } : {}), ...(Object.keys(w).length ? { with: w } : {}) });
    }
  }
  const content = contentFromForm(f, { comps });
  /** @type {Record<string, unknown>[]} */
  const archetypes = content.archetypes;
  const pid = slug(prop(f.player, 'archetype') || '');
  let playerArch = archetypes.find(a => a.id === pid) || archetypes.find(a => a.kind === 'player');
  if (!playerArch) { const made = asObject(structuredClone(list(skeleton.content?.archetypes).find(a => prop(a, 'id') === skeleton.player?.archetype) || { id: 'hero', components: { name: 'You' } })); made.kind ??= 'player'; playerArch = made; archetypes.push(made); }
  out.content.archetypes = archetypes;
  const items = content.items;
  for (const it of skeleton.content?.items || []) if (!items.some(x => x.id === it.id)) items.push(structuredClone(it));
  if (items.length) out.content.items = items;
  out.plot.characters = content.characters;
  if (content.dialogue) out.plot.dialogue = content.dialogue;
  if (content.quests) out.plot.quests = content.quests;
  for (const sec of sections) {
    const raw = f[`section_${sec.replace('.', '_')}`], v = sectionCodecs[sec] ? decode(raw, sectionCodecs[sec]) : parseJson(raw);
    if (v === undefined || (Array.isArray(v) && !v.length) || (isObj(v) && !Object.keys(v).length)) continue;
    const [root, key] = sec.split('.');
    const target = root === 'plot' ? out.plot : root === 'content' ? out.content : null; // sections are plot.* or content.*
    if (target) target[key] = v;
  }
  const acts = listOf(f.acts).filter(isObj).map(a => ({ id: slug(a.id || a.title), title: String(a.title || a.id || ''), beats: listOf(a.beats).filter(isObj).map(b => {
    /** @type {Record<string, unknown>} */
    const beat = { id: slug(b.id || b.title), ...(b.title ? { title: String(b.title) } : {}) };
    const when = parseJson(b.when_json); if (isObj(when)) beat.when = when;
    const after = listOf(b.after).filter(x => typeof x === 'string').map(slug); if (after.length) beat.after = after;
    if (b.optional) beat.optional = true;
    const fx = parseJson(b.do_json); if (Array.isArray(fx)) beat.do = fx; else if (isObj(fx)) beat.do = [fx];
    return beat;
  }) }));
  // The story is the model's: no acts written means no story (the content checks ask for it), never the scaffold's.
  if (acts.length) out.plot.storyboard = { acts };
  const endings = listOf(f.endings).filter(isObj).map(e => ({ id: slug(e.id || e.title), title: String(e.title || e.id), text: String(e.text || ''), outcome: typeof e.outcome === 'string' && ['won', 'lost', 'neutral'].includes(e.outcome) ? e.outcome : 'won' }));
  if (endings.length) out.plot.endings = endings; else if (skeleton.plot?.endings) out.plot.endings = structuredClone(skeleton.plot.endings);
  // Spawns -> the spawner's rules.
  const rules = content.rules;
  if (rules.length && spawner) {
    let sp = out.systems.find(s => s.use === spawner);
    if (!sp) { sp = { use: spawner, with: {} }; out.systems.unshift(sp); }
    sp.with = { ...asObject(sp.with), rules: [...listOf(prop(sp.with, 'rules')), ...rules] };
  }
  // The player: its archetype, in its start zone (zone id in exit spaces, a point in positional ones).
  const space = out.spaces.find(s => s.id === skeleton.player?.space) || out.spaces[0];
  const startZone = listOf(space.zones).find(z => prop(z, 'id') === slug(prop(f.player, 'zone'))) || listOf(space.zones)[0];
  const exits = layout.find(l => l.id === space.id)?.exits;
  out.player = { ...structuredClone(skeleton.player || {}), archetype: playerArch.id, space: space.id, at: exits ? prop(startZone, 'id') : (startZone && zoneStart(startZone)) || skeleton.player?.at };
  keepReferenced(out, skeleton, offered);
  return out;
}

/** A document path as the form names it, for repair problems (best effort; the doc path is always kept too). @param {unknown} path @param {unknown} doc a draft @returns {string} */
export function formPath(path, doc) {
  const p = String(path || '');
  let m;
  if ((m = /^systems\[(\d+)\](.*)$/.exec(p))) { const use = prop(listOf(prop(doc, 'systems'))[+m[1]], 'use'); return use ? `systems.${formKey(String(use))}${m[2]}` : p; }
  if ((m = /^spaces\[(\d+)\]\.zones(.*)$/.exec(p))) { const id = prop(listOf(prop(doc, 'spaces'))[+m[1]], 'id'); return id ? `spaces["${id}"].zones${m[2]}` : p; }
  return p.replace(/^content\.archetypes/, 'archetypes').replace(/^content\.items/, 'items').replace(/^plot\.quests/, 'quests').replace(/^plot\.characters/, 'characters')
    .replace(/^plot\.storyboard\.acts/, 'acts').replace(/^plot\.endings/, 'endings').replace(/^plot\.dialogue\.([a-z0-9_-]+)/, 'dialogue[id=$1]').replace(/^(plot|content)\.([a-zA-Z]+)/, 'section_$1_$2');
}
