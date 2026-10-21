// @ts-check
// Parameter schemas for primitive cards, and validation of instance configs.
// Types: number, integer, boolean, string, ref, list, object, predicate,
// effects, json. Refs are checked against document indexes (character, item,
// zone, quest, model, archetype, space, beat, ending, recipe).

// Base kinds indexed by the kernel. Primitives add kinds with card.defines
// (see KERNEL_API.md), so this list never needs editing for a new primitive.
/** @typedef {import('./types.js').ParamSchema} ParamSchema */
/** @typedef {import('./types.js').Params} Params */
/** @typedef {import('./types.js').Problem} Problem */
/**
 * What param checking needs from preflight's context (all optional: defaults-only callers pass null).
 * @typedef {{ indexes?: Record<string, Set<string>>, checkPredicate?(p: unknown, path: string, errors: Problem[]): void, checkEffect?(e: unknown, path: string, errors: Problem[]): void } | null | undefined} ParamContext
 */

export const REF_KINDS = ['character', 'item', 'zone', 'quest', 'model', 'archetype', 'space', 'beat', 'ending', 'recipe', 'block', 'dialogue'];
/**
 * The kinds whose ids name entities: characters spawn with id = character id, archetypes are what an entity is made
 * of. A string param declaring `selects: ENTITY_KINDS` is an entity selector (an entity id, an archetype id or a tag,
 * as gameplay/modes-lib-util.js `matches` reads it): a value that is an id of one of these kinds refers to that entry
 * (composition renames it with the entry), any other value is free (an entity id a spawn names, a tag).
 */
export const ENTITY_KINDS = Object.freeze(['archetype', 'character']);
/** @type {Set<string>} */
const NONE = new Set();

/**
 * Validate value against schema; push errors; return the value with defaults applied.
 * @param {ParamSchema} schema @param {any} value @param {string} path @param {Problem[]} errors @param {ParamContext} ctx
 * @returns {any}
 */
export function checkParam(schema, value, path, errors, ctx) {
  /** @param {string} code @param {string} message @param {string} [hint] */
  const fail = (code, message, hint) => errors.push({ code, path, message, ...(hint ? { hint } : {}) });
  // An explicit null on an optional param means "not set" (models and cards both write it): use the default.
  if (value === null && !schema.required) value = undefined;
  if (value === undefined) {
    if (schema.required) fail('param_missing', `required ${schema.type}`, schema.effect);
    if (schema.default === undefined) return undefined;
    // An omitted object with a default still gets its fields' defaults (default: {} means "all field defaults").
    if (schema.type === 'object' && schema.fields && schema.default && typeof schema.default === 'object' && !Array.isArray(schema.default))
      return checkFields(schema.fields, structuredClone(schema.default), path, [], ctx, schema.open);
    return structuredClone(schema.default);
  }
  switch (schema.type) {
    case 'number': case 'integer':
      if (!Number.isFinite(value) || (schema.type === 'integer' && !Number.isInteger(value))) fail('param_type', `must be ${schema.type === 'integer' ? 'an integer' : 'a number'}`);
      else if ((schema.min !== undefined && value < schema.min) || (schema.max !== undefined && value > schema.max)) fail('param_range', `${value} outside [${schema.min ?? '-∞'}, ${schema.max ?? '∞'}] ${schema.unit || ''}`.trim(), `default ${schema.default}`);
      else if (typeof schema.multipleOf === 'number' && value % schema.multipleOf !== 0) fail('param_range', `${value} is not a multiple of ${schema.multipleOf}`);
      return value;
    case 'boolean':
      if (typeof value !== 'boolean') fail('param_type', 'must be true or false');
      return value;
    case 'string':
      if (typeof value !== 'string') fail('param_type', 'must be a string');
      else if (schema.options && !schema.options.includes(value)) fail('param_option', `'${value}' is not one of ${schema.options.join('|')}`);
      else if (Array.isArray(schema.reserved) && schema.reserved.includes(value)) fail('param_reserved', `'${value}' is reserved (${schema.reserved.join(', ')}): pick another`);
      else if (schema.maxLength && value.length > schema.maxLength) fail('param_range', `longer than ${schema.maxLength} characters`);
      else if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value)) fail('param_pattern', `'${value.slice(0, 60)}' does not match ${schema.pattern}`);
      return value;
    case 'ref': {
      const to = /** @type {string} */ (schema.to); // a ref schema without `to` indexes nothing: every id is unknown
      if (typeof value !== 'string') fail('param_type', `must be a ${schema.to} id`);
      else if (ctx?.indexes && !(ctx.indexes[to] || NONE).has(value)) fail('ref_unknown', `unknown ${schema.to} '${value}'`, `defined: ${[...(ctx.indexes[to] || [])].slice(0, 20).join(', ') || 'none'}`);
      return value;
    }
    case 'list': {
      if (!Array.isArray(value)) { fail('param_type', 'must be a list'); return value; }
      if (schema.min !== undefined && value.length < schema.min) fail('param_range', `needs at least ${schema.min} entries`);
      if (schema.max !== undefined && value.length > schema.max) fail('param_range', `at most ${schema.max} entries`);
      return value.map((/** @type {any} */ v, /** @type {number} */ i) => checkParam(/** @type {ParamSchema} */ (schema.of), v, `${path}[${i}]`, errors, ctx));
    }
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) { fail('param_type', 'must be an object'); return value; }
      // An object with variants whose discriminator names none: the discriminator's error says so; its other keys are not judged.
      const variant = variantFields(schema, value), unmatched = Boolean(schema.variants) && !variant;
      return checkFields(variant ?? schema.fields ?? {}, value, path, errors, ctx, schema.open || unmatched, schema.values);
    }
    case 'predicate':
      ctx?.checkPredicate?.(value, path, errors);
      return value;
    case 'effects':
      if (!Array.isArray(value)) { fail('param_type', 'must be a list of effects'); return value; }
      value.forEach((e, i) => ctx?.checkEffect?.(e, `${path}[${i}]`, errors));
      return value;
    case 'json':
      return value;
    default:
      fail('schema_invalid', `unknown param type '${schema.type}'`);
      return value;
  }
}

/**
 * An object's fields for one value when the object declares `variants: { by, of: { <value>: fields } }` (fields that
 * depend on a discriminating field, a quest objective's `kind`): its own fields and those of the variant the value's
 * `by` field names. undefined when it declares none, or the value names no variant (the discriminator's own declaration,
 * its options, reports that).
 * @param {ParamSchema} schema @param {Record<string, any>} value @returns {Params | undefined}
 */
export function variantFields(schema, value) {
  const v = schema.variants;
  if (!v || typeof v !== 'object' || typeof v.by !== 'string' || !v.of || typeof v.of !== 'object') return undefined;
  const key = value?.[v.by];
  const own = typeof key === 'string' && Object.hasOwn(v.of, key) ? v.of[key] : undefined;
  return own && typeof own === 'object' ? { ...(schema.fields || {}), ...own } : undefined;
}

/**
 * Validate an object of fields against a field-schema map. Unknown keys are errors unless open, or checked against
 * `values` (a map whose keys are free and whose values share one declared shape: a legend's char -> entry).
 * @param {Params} fields @param {Record<string, any>} value @param {string} path @param {Problem[]} errors @param {ParamContext} ctx @param {boolean} [open] @param {ParamSchema} [values]
 * @returns {Record<string, any>}
 */
export function checkFields(fields, value = {}, path, errors, ctx, open = false, values = undefined) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const [key, schema] of Object.entries(fields)) {
    const v = checkParam(schema, value[key], path ? `${path}.${key}` : key, errors, ctx);
    if (v !== undefined) out[key] = v;
  }
  for (const key of Object.keys(value)) {
    if (key in fields) continue;
    if (values) out[key] = checkParam(values, value[key], path ? `${path}.${key}` : key, errors, ctx);
    else if (open) out[key] = value[key];
    else errors.push({ code: 'param_unknown', path: path ? `${path}.${key}` : key, message: `unknown parameter '${key}'`, hint: `known: ${Object.keys(fields).join(', ') || 'none'}` });
  }
  return out;
}
