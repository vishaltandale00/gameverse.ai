// A reference never has a default (ARCHITECTURE §3: defaults are tuning values, never stand-ins for structure). A
// default id names an entry the document may not have: preflight applies it into the normalized document unchecked,
// so a generator writes undeclared blocks/archetypes and the re-preflighted document fails ref_unknown. Over the
// whole live catalogue, no card's params, components or card.data declare a default that is, or holds, a reference
// (a `ref` spec's own default, or an object/list default carrying a value at a ref position).
import test from 'node:test';
import assert from 'node:assert/strict';
import { liveCatalogue } from '../v2/planner/catalog.js';

/** @typedef {import('../v2/kernel/types.js').ParamSchema} ParamSchema */

const isObj = (/** @type {unknown} */ v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** The paths inside `value` that sit at a ref position of `schema`. @param {any} schema @param {any} value @param {string} at @returns {string[]} */
function refsIn(schema, value, at) {
  if (!isObj(schema) || value === undefined || value === null) return [];
  if (schema.type === 'ref') return [at];
  if (schema.type === 'list' && Array.isArray(value)) return value.flatMap((v, i) => refsIn(schema.of, v, `${at}[${i}]`));
  if (schema.type === 'object' && isObj(value)) {
    const variant = isObj(schema.variants?.of) ? schema.variants.of[value[schema.variants.by]] : undefined;
    const fields = { ...(schema.fields || {}), ...(isObj(variant) ? variant : {}) };
    return Object.entries(value).flatMap(([k, v]) => refsIn(fields[k] ?? schema.values, v, `${at}.${k}`));
  }
  return [];
}

/** Every spec under `schema` (itself included) whose default holds a reference. @param {any} schema @param {string} at @returns {string[]} */
function refDefaults(schema, at) {
  if (!isObj(schema)) return [];
  const own = schema.default !== undefined ? refsIn(schema, schema.default, `${at} default`) : [];
  const subs = [
    ...(schema.of ? refDefaults(schema.of, `${at}[]`) : []),
    ...Object.entries(isObj(schema.fields) ? schema.fields : {}).flatMap(([k, s]) => refDefaults(s, `${at}.${k}`)),
    ...(schema.values ? refDefaults(schema.values, `${at}.*`) : []),
    ...Object.entries(isObj(schema.variants?.of) ? schema.variants.of : {}).flatMap(([v, fs]) =>
      Object.entries(isObj(fs) ? fs : {}).flatMap(([k, s]) => refDefaults(s, `${at}<${v}>.${k}`))),
  ];
  return [...own, ...subs];
}

const { registry } = await liveCatalogue();

test('the walk finds a reference default', () => {
  const spec = { type: 'object', fields: { wall: { type: 'ref', to: 'block' }, n: { type: 'integer', default: 2 } }, default: { wall: 'stone', n: 3 } };
  assert.deepEqual(refDefaults(spec, 'p'), ['p default.wall']);
  assert.deepEqual(refDefaults({ type: 'list', of: { type: 'ref', to: 'block' }, default: ['a'] }, 'l'), ['l default[0]']);
  assert.deepEqual(refDefaults({ type: 'ref', to: 'block', default: 'a' }, 'r'), ['r default']);
});

test('no card declares a default on a reference (params, components, card.data)', () => {
  const found = registry.cards().flatMap(card => {
    const c = /** @type {any} */ (card);
    return [
      ...Object.entries(c.params || {}).flatMap(([k, s]) => refDefaults(s, `params.${k}`)),
      ...Object.entries(c.components || {}).flatMap(([k, s]) => refDefaults(s, `components.${k}`)),
      ...Object.entries(c.data || {}).flatMap(([k, s]) => refDefaults(s, `data['${k}']`)),
    ].map(p => `${c.id}: ${p}`);
  });
  assert.ok(registry.cards().length > 50, 'the catalogue is loaded');
  assert.deepEqual(found, []);
});
