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
// Every slot is derived from the declarations (strictSpec over params, card.components and the sections' declared
// shapes, kernel/sections.js); a declaration with no strict shape has no slot. The story's predicates and effects
// (zone gates, beat triggers and effects, dialogue effects) still travel as JSON text: the vocabulary declares no field
// shapes for them yet. Nothing here names a primitive.
import { DOC_SCHEMA } from '../kernel/document.js';
import { isGraphics, isSpace, isGenerator } from './catalog.js';
import { contractsFor, referenceOf, idsAt, ZONES, SECTIONS } from './content.js';
import { isObj, isList, isStr, list, strings, obj as asObject, prop } from '../kernel/guards.js';
import { sectionShape, ID_PATTERN } from '../kernel/sections.js';

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
 * a list of a codec, or an object of field codecs (JSON text only for the story's predicates and effects).
 * @typedef {'raw' | 'json' | 'strict' | 'effects' | { list: Codec } | FieldsCodec | VariantsCodec} Codec
 */
/** An object with variants (card `variants`): the fields codec of each value of its discriminating field `by`. @typedef {{ variants: { by: string, of: Record<string, FieldsCodec> } }} VariantsCodec */
/** @typedef {{ fields: Record<string, Codec>, more: boolean }} FieldsCodec */
/** @typedef {{ id: string, exits: boolean, count: number }} SpaceLayout */
/**
 * Where a strict slot's reference fields get their enums: the ids a field may hold (the document's own ids of the
 * section its declaration names; [] when it names none), or null when the field is no reference (free text).
 * @typedef {{ allowed: (spec: Spec) => string[] | null }} RefContext
 */
/** Component slots: the archetype components schema and each component's codec; `entries`: the codec of each content list contentProps derives. @typedef {{ schema: ObjectSchema, codecs: Record<string, Codec>, entries?: Record<string, Codec> }} ComponentSlots */
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
const MAX_DEPTH = 4;       // nesting inside a param before values travel as JSON strings
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

/**
 * Where a value breaks a strict form schema (the dialect above: object, array with minItems/maxItems, string with enum/pattern, number and
 * integer with minimum/maximum/multipleOf, boolean, null, anyOf). The form a model fills and the check of its answer are this one
 * schema (ARCHITECTURE §1.4): a writer that does not enforce the schema (writer.js claudeWriter) is held to it here.
 * Paths are fieldForm paths ('a.b[0].c'; '' is the root). -> [{ path, message }]
 * @param {JsonSchema} schema @param {unknown} value @param {string} [path] @returns {Array<{ path: string, message: string }>}
 */
export function answerProblems(schema, value, path = '') {
  const at = (/** @type {string} */ k) => (path ? `${path}.${k}` : k);
  const shown = (/** @type {unknown} */ v) => JSON.stringify(v)?.slice(0, 60) ?? String(v);
  if (Array.isArray(schema.anyOf)) {
    const branches = /** @type {JsonSchema[]} */ (schema.anyOf).map(s => answerProblems(s, value, path));
    return branches.some(b => !b.length) ? [] : branches.sort((a, b) => a.length - b.length)[0] ?? [];
  }
  const type = schema.type;
  if (type === 'null') return value === null ? [] : [{ path, message: `${shown(value)} is not null` }];
  if (type === 'object') {
    if (!isObj(value)) return [{ path, message: `${shown(value)} is not an object` }];
    const props = isObj(schema.properties) ? /** @type {Record<string, JsonSchema>} */ (schema.properties) : {};
    const out = Object.keys(value).filter(k => !(k in props) && schema.additionalProperties === false).map(k => ({ path: at(k), message: `'${k}' is not a field of this form` }));
    for (const k of strings(schema.required)) if (!(k in value)) out.push({ path: at(k), message: 'required' });
    for (const [k, s] of Object.entries(props)) if (k in value) out.push(...answerProblems(s, value[k], at(k)));
    return out;
  }
  if (type === 'array') {
    if (!Array.isArray(value)) return [{ path, message: `${shown(value)} is not a list` }];
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) return [{ path, message: `needs at least ${schema.minItems} entries` }];
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) return [{ path, message: `at most ${schema.maxItems} entries` }];
    return isObj(schema.items) ? value.flatMap((v, i) => answerProblems(/** @type {JsonSchema} */ (schema.items), v, `${path}[${i}]`)) : [];
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return [{ path, message: `${shown(value)} is not one of ${schema.enum.join(', ')}` }];
  if (type === 'string') {
    if (typeof value !== 'string') return [{ path, message: `${shown(value)} is not text` }];
    return typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value) ? [{ path, message: `${shown(value)} does not match ${schema.pattern}` }] : [];
  }
  if (type === 'boolean') return typeof value === 'boolean' ? [] : [{ path, message: `${shown(value)} is not true or false` }];
  if (type === 'number' || type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (type === 'integer' && !Number.isInteger(value))) return [{ path, message: `${shown(value)} is not ${type === 'integer' ? 'an integer' : 'a number'}` }];
    if (typeof schema.minimum === 'number' && value < schema.minimum) return [{ path, message: `${value} is below ${schema.minimum}` }];
    if (typeof schema.maximum === 'number' && value > schema.maximum) return [{ path, message: `${value} is above ${schema.maximum}` }];
    if (typeof schema.multipleOf === 'number' && value % schema.multipleOf !== 0) return [{ path, message: `${value} is not a multiple of ${schema.multipleOf}` }];
    return [];
  }
  return [{ path, message: `the form declares no type here (${shown(type)})` }];
}

const JSON_HINT = 'JSON text (a JSON value encoded as a string), or null to leave it unset';
/** @param {Spec} spec @returns {string | undefined} */
const describe = spec => [spec.effect, spec.unit && `unit ${spec.unit}`, (spec.min !== undefined || spec.max !== undefined) && `range ${spec.min ?? ''}..${spec.max ?? ''}`, spec.default !== undefined && `default ${JSON.stringify(spec.default).slice(0, 60)}`].filter(Boolean).join('; ').slice(0, 200) || undefined;

/** A string slot restricted to ids (an enum) with its description. @param {string[]} ids @param {string | undefined} d @returns {JsonSchema} */
const idEnum = (ids, d) => ({ type: 'string', enum: ids, ...(d ? { description: d } : {}) });
/** A spec whose values are single strings (no fixed options): a reference may restrict them. @param {Spec | undefined} s */
export const plainString = s => Boolean(s && (s.type === 'ref' || (s.type === 'string' && !s.options?.length)));

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
  if (ids && t === 'list' && depth < MAX_DEPTH) return { schema: { ...arr(idEnum(ids, describe(spec.of || {})), d), ...itemCounts(spec) }, codec: { list: 'raw' } };
  // The card's range is the slot's range (minimum/maximum), so the form never allows a number preflight rejects.
  if (t === 'number' || t === 'integer') return { schema: { type: t, ...(typeof spec.min === 'number' ? { minimum: spec.min } : {}), ...(typeof spec.max === 'number' ? { maximum: spec.max } : {}), ...(typeof spec.multipleOf === 'number' ? { multipleOf: spec.multipleOf } : {}), ...(d ? { description: d } : {}) }, codec: 'raw' };
  if (t === 'boolean') return { schema: { type: 'boolean', ...(d ? { description: d } : {}) }, codec: 'raw' };
  if (t === 'string' && Array.isArray(spec.reserved) && spec.reserved.length) d = `${d ? d + '; ' : ''}never ${spec.reserved.join(', ')} (reserved)`;
  if (t === 'string') return { schema: spec.options?.length ? { type: 'string', enum: spec.options.map(String), ...(d ? { description: d } : {}) } : { ...str(d), ...(typeof spec.pattern === 'string' ? { pattern: spec.pattern, ...(typeof spec.example === 'string' ? { [WITNESS]: spec.example } : {}) } : {}) }, codec: 'raw' };
  if (t === 'ref') return { schema: str(`id of a ${spec.to}${d ? `; ${d}` : ''}`), codec: 'raw' };
  // Lists and objects are strictSpec's (a shape with no strict form has no slot, never JSON text).
  const s = strictSpec(spec, depth, refs);
  if (!s) throw Object.assign(Error(`a ${t} declaration has no strict form`), { code: 'form_unaskable' });
  return s;
}

/**
 * The strict schema and codec of a declared param or field (ARCHITECTURE §1.4: every model form is derived from the
 * card's declarations and has no free-JSON field), or null when its declaration has no strict shape: json, effects,
 * predicates, a map with free keys, nesting past MAX_DEPTH, or a reference with nothing in the document to name (refs:
 * `allowed` gives [] for it). Those stay as the card or the template declares them: no form asks for them. An object's
 * declared fields are asked (an open object's other keys are nobody's to write); a required field without a strict
 * shape makes its object unaskable.
 * @param {unknown} spec @param {number} depth @param {RefContext | null} refs @returns {{ schema: JsonSchema, codec: Codec } | null}
 */
export function strictSpec(spec, depth, refs) {
  if (!isObj(spec)) return null;
  const t = spec.type, s = /** @type {Spec} */ (spec);
  const ids = refs && (plainString(s) || (t === 'list' && plainString(s.of))) ? refs.allowed(s) : null;
  if (ids && !ids.length) return null;
  if (t === 'number' || t === 'integer' || t === 'boolean' || t === 'string' || t === 'ref') return specSchema(s, depth, refs);
  if (depth >= MAX_DEPTH) return null;
  if (t === 'list') {
    if (ids) return specSchema(s, depth, refs);
    const inner = strictSpec(s.of, depth + 1, refs);
    return inner ? { schema: { ...arr(inner.schema, describe(s)), ...itemCounts(s) }, codec: { list: inner.codec } } : null;
  }
  if (t === 'object' && isObj(s.fields) && !s.values && isObj(s.variants)) return variantsSpec(s, depth, refs);
  if (t === 'object' && isObj(s.fields) && !s.values) {
    /** @type {Record<string, JsonSchema>} */
    const props = {};
    /** @type {Record<string, Codec>} */
    const codecs = {};
    for (const [k, f] of Object.entries(s.fields)) {
      const inner = strictSpec(f, depth + 1, refs);
      if (!inner) { if (prop(f, 'required')) return null; continue; }
      props[k] = prop(f, 'required') ? inner.schema : nul(inner.schema); codecs[k] = inner.codec;
    }
    return Object.keys(props).length ? { schema: obj(props, describe(s)), codec: { fields: codecs, more: false } } : null;
  }
  return null;
}

/**
 * The strict schema of an object with variants (`variants: { by, of: { <value>: fields } }`, KERNEL_API §1): one object
 * branch per value of its discriminating field, holding the object's fields and that value's, the discriminator fixed to
 * the value (anyOf). A variant without a strict shape (a required field no form can ask) is not offered; none offered: null.
 * @param {Spec} s @param {number} depth @param {RefContext | null} refs @returns {{ schema: JsonSchema, codec: Codec } | null}
 */
function variantsSpec(s, depth, refs) {
  const by = prop(s.variants, 'by'), of = prop(s.variants, 'of');
  if (!isStr(by) || !isObj(of)) return null;
  /** @type {JsonSchema[]} */
  const branches = [];
  /** @type {Record<string, FieldsCodec>} */
  const codecs = {};
  for (const [value, fields] of Object.entries(of)) {
    if (!isObj(fields)) continue;
    const own = { ...(isObj(s.fields) ? s.fields : {}), ...fields, [by]: { type: 'string', options: [value], required: true } };
    const one = strictSpec({ ...s, variants: undefined, fields: own }, depth, refs);
    if (!one || typeof one.codec !== 'object' || !('fields' in one.codec)) continue;
    branches.push(one.schema); codecs[value] = one.codec;
  }
  return branches.length ? { schema: { anyOf: branches, ...(describe(s) ? { description: describe(s) } : {}) }, codec: { variants: { by, of: codecs } } } : null;
}

/**
 * The declared example of a patterned string, kept on its form slot under a symbol (never serialized into a model's
 * schema): the schema sampler's witness of a value the pattern allows.
 */
export const WITNESS = Symbol('witness');

/** A list declaration's entry counts as the form's minItems/maxItems (the card's min/max of a list). @param {Spec} spec @returns {Record<string, number>} */
export const itemCounts = spec => ({ ...(typeof spec.min === 'number' && spec.min > 0 ? { minItems: spec.min } : {}), ...(typeof spec.max === 'number' ? { maxItems: spec.max } : {}) });

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
  if (typeof codec === 'object' && 'variants' in codec) {
    if (!isObj(value)) return undefined;
    const own = codec.variants.of[String(value[codec.variants.by])];
    return own ? decode(value, own) : undefined;
  }
  if (typeof codec === 'object' && 'list' in codec) return Array.isArray(value) ? value.map(v => decode(v, codec.list)).filter(v => v !== undefined) : undefined;
  if (typeof codec === 'object' && 'fields' in codec) {
    if (!isObj(value)) return undefined;
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, c] of Object.entries(codec.fields)) { const v = decode(value[k], c); if (v !== undefined) out[k] = v; }
    return out;
  }
  return value;
}

/**
 * A card's params as its forms ask them: each declared param, a list that defines a reference kind (card.defines `in`)
 * with its entries' ids held to the kernel's id rule.
 * @param {Record<string, any>} card @returns {Record<string, ParamSchema>}
 */
export function formParams(card) {
  /** @type {Record<string, ParamSchema>} */
  const out = { ...(card.params || {}) };
  for (const d of card.defines || []) {
    const spec = d.in ? out[d.in] : undefined;
    if (spec?.type === 'list' && spec.of?.type === 'object') out[d.in] = { ...spec, of: { ...spec.of, fields: { ...spec.of.fields, id: { ...(spec.of.fields?.id ?? { type: 'string' }), pattern: ID_PATTERN, required: true } } } };
  }
  return out;
}

/**
 * A card's params as a form slot: every param whose declaration has a strict shape (strictSpec, the list defining a
 * kind with its entries' ids held to the kernel's id rule: formParams); optional ones nullable (null keeps the card's
 * declaration). A param with no strict shape (predicates, effects, maps with free keys) has no slot: the scaffold's value
 * or the card's default stands, never free JSON.
 * @param {Card} card @param {{ skip?: string[], refs?: RefContext | null }} [options] @returns {{ schema: ObjectSchema, codec: FieldsCodec }}
 */
function paramsSlot(card, { skip = [], refs = null } = {}) {
  /** @type {Record<string, JsonSchema>} */
  const props = {};
  /** @type {Record<string, Codec>} */
  const codecs = {};
  for (const [k, spec] of Object.entries(formParams(card))) {
    if (skip.includes(k)) continue;
    const s = strictSpec(spec, 1, refs);
    if (!s) continue;
    props[k] = spec.required ? s.schema : nul(s.schema); codecs[k] = s.codec;
  }
  return { schema: obj(props), codec: { fields: codecs, more: false } };
}

/**
 * Component slots for archetypes: every component the chosen primitives' cards declare (card.components, merged as
 * kernel/sections.js sectionShape merges them), each strict (strictSpec); a component without a strict shape has no slot.
 * @param {RegistryLike} registry @param {string[]} ids @param {RefContext | null} [refs] @returns {ComponentSlots}
 */
export function componentSlots(registry, ids, refs = null) {
  /** @type {Record<string, JsonSchema>} */
  const props = {};
  /** @type {Record<string, Codec>} */
  const codecs = {};
  const declared = prop(prop(prop(prop(sectionShape(registry, ids, 'content.archetypes').shape, 'of'), 'fields'), 'components'), 'fields');
  for (const [k, spec] of Object.entries(isObj(declared) ? declared : {})) {
    const s = strictSpec(spec, 1, refs);
    if (!s) continue;
    props[k] = nul(s.schema); codecs[k] = s.codec;
  }
  return { schema: obj(props, 'components keyed by owning primitive; null = this archetype has none of it'), codecs };
}

/** The strict entry form of a kernel section (its merged declared shape), or null. @param {RegistryLike} registry @param {string[]} ids @param {string} section @param {RefContext | null} refs */
const entrySlot = (registry, ids, section, refs) => strictSpec(prop(sectionShape(registry, ids, section).shape, 'of'), 1, refs);

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
    // The section's declared shape (kernel/sections.js: the used cards' card.data) is its strict slot; a section no
    // card declares a strict shape for has none (never JSON text).
    const declared = sectionShape(registry, used, sec).shape;
    const d = declared ? strictSpec({ ...declared, ...(c && declared.type === 'list' ? { min: Math.max(declared.min || 0, c.min || 1) } : {}) }, 0, refsFor(slotOfSection(sec))) : null;
    if (d) { props[`section_${sec.replace('.', '_')}`] = d.schema; sectionCodecs[sec] = d.codec; }
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
  /** @type {Record<string, Codec>} */
  const entries = {};
  /** A reference into the cast another form wrote, or the zones: the ids known, else the document reference context. @type {RefContext} */
  const castRefs = { allowed(spec) {
    const ref = isObj(spec) && spec.type === 'list' && isObj(spec.of) ? spec.of : spec;
    const to = isObj(ref) && ref.type === 'ref' ? ref.to : null;
    const known = to === 'zone' ? zones : to === 'character' ? cast?.characters : to === 'archetype' ? cast?.archetypes : to === 'item' ? cast?.items : null;
    return known?.length ? [...new Set(known)] : refs ? refs.allowed(spec) : null;
  } };
  /** An entry list slot from a section's declared shape (kernel/sections.js), its codec kept. @param {string} key @param {string} section @param {string} description @param {string[]} [drop] fields code fills */
  const section = (key, section, description, drop = []) => {
    const s = entrySlot(registry, used, section, castRefs);
    if (!s || !isObj(s.schema.properties)) return;
    const schema = /** @type {ObjectSchema} */ (structuredClone(s.schema));
    for (const k of drop) { delete schema.properties[k]; schema.required = schema.required.filter(x => x !== k); }
    props[key] = arr(schema, description); entries[key] = s.codec;
  };
  // Every kind of entity, with the components the chosen primitives declare (card.components).
  section('archetypes', 'content.archetypes', 'every kind of entity: enemies, creatures, pickups, props, vehicles, NPC bodies; give each the components its role needs');
  // What appears where: the spawner's own rule shape (card.params rules), the zone fixed when the form is one zone's.
  const rule = spawner ? strictSpec(prop(formParams(/** @type {RegisteredPrimitive} */ (registry.get(spawner)).card).rules, 'of'), 1, castRefs) : null;
  if (rule && isObj(rule.schema.properties)) {
    const schema = /** @type {ObjectSchema} */ (structuredClone(rule.schema));
    if (zone) { delete schema.properties.zone; schema.required = schema.required.filter(x => x !== 'zone'); }
    props.spawns = arr(schema, zone ? `what appears in ${zone}: its own enemies, pickups and props` : 'what appears where: every enemy, pickup and prop archetype placed in the zones it belongs to');
    entries.spawns = rule.codec;
  }
  section('items', 'content.items', 'the items of the game');
  section('characters', 'plot.characters', 'the named characters', zone ? ['home'] : []);
  if (hasDialogue) props.dialogue = arr(obj({ id: str('dialogue id'), speaker: castRef(cast, 'characters', 'character id'), start: str('first node id'), nodes: arr(obj({ id: str('node id'), who: nul(castRef(cast, 'characters', 'character id; null = the speaker')), say: str(), next: nul(str('node id')), end: { type: 'boolean' }, choices: arr(obj({ text: str(), next: nul(str('node id')), do_json: nul(str(`effects list (${JSON_HINT})`)) })), do_json: nul(str(`effects list (${JSON_HINT})`)) })) }), 'conversations as node graphs');
  if (hasQuests) section('quests', 'plot.quests', 'quests the quest primitive runs; objectives use its goal kinds', zone ? ['zone'] : []);
  return { props, comps: { ...comps, entries } };
}

/** A reference into the cast another form wrote: an enum of its ids when known. @param {{ characters?: string[], archetypes?: string[], items?: string[] } | null} cast @param {'characters' | 'archetypes' | 'items'} kind @param {string} d */
const castRef = (cast, kind, d) => { const ids = [...new Set(cast?.[kind] || [])]; return ids.length && ids.length <= MAX_ENUM ? idEnum(ids, d) : str(d); };

/**
 * Content from a filled form (see contentProps): each list decoded through its declared shape's codec (the entries
 * as the cards declare them), the conversations as node graphs, and the spawner's rules.
 * @param {Record<string, unknown>} f the filled form (model output, unchecked) @param {{ comps: { codecs: Record<string, Codec>, entries?: Record<string, Codec> }, zone?: string | null }} options
 */
export function contentFromForm(f, { comps, zone = null }) {
  const codecs = comps.entries ?? {};
  /** @param {string} key @returns {Record<string, any>[]} */
  const decoded = key => (codecs[key] ? listOf(f[key]).map(v => decode(v, /** @type {Codec} */ (codecs[key]))).filter(isObj) : []);
  const archetypes = decoded('archetypes');
  const items = decoded('items');
  const characters = decoded('characters').map(c => (zone && c.home === undefined ? { ...c, home: zone } : c));
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
  const quests = codecs.quests ? decoded('quests').map(q => (zone && q.zone === undefined ? { ...q, zone } : q)) : undefined;
  const rules = decoded('spawns').map(r => (zone && r.zone === undefined ? { ...r, zone } : r)).filter((r, i, a) => a.findIndex(x => x.id === r.id) === i);
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
  // The player's body: the archetype the form names, else the scaffold's player archetype (the structure's); a scaffold
  // without one gets none stamped here.
  let playerArch = archetypes.find(a => a.id === pid);
  if (!playerArch) { const made = list(skeleton.content?.archetypes).find(a => prop(a, 'id') === skeleton.player?.archetype); if (isObj(made)) { playerArch = asObject(structuredClone(made)); archetypes.push(playerArch); } }
  out.content.archetypes = archetypes;
  const items = content.items;
  for (const it of skeleton.content?.items || []) if (!items.some(x => x.id === it.id)) items.push(structuredClone(it));
  if (items.length) out.content.items = items;
  // The cast the form wrote (an empty list is no section: nothing stamps one).
  if (content.characters.length) out.plot.characters = content.characters;
  if (content.dialogue) out.plot.dialogue = content.dialogue;
  if (content.quests) out.plot.quests = content.quests;
  for (const sec of sections) {
    if (!sectionCodecs[sec]) continue;
    const v = decode(f[`section_${sec.replace('.', '_')}`], sectionCodecs[sec]);
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
  out.player = { ...structuredClone(skeleton.player || {}), ...(playerArch ? { archetype: playerArch.id } : {}), space: space.id, at: exits ? prop(startZone, 'id') : (startZone && zoneStart(startZone)) || skeleton.player?.at };
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
