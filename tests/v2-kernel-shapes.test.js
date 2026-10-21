// The kernel's declaration dialect (KERNEL_API.md §1, §8): a later declaration of a section field may refine the
// kernel's base or another card's (kernel/sections.js mergeShape), and an object's `variants` (fields chosen by a
// discriminating field) are checked by preflight (kernel/params.js checkParam) and asked by the strict forms
// (planner/outline-form.js strictSpec) from the one declaration.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeShape, SECTIONS } from '../v2/kernel/sections.js';
import { checkParam } from '../v2/kernel/params.js';
import { strictSpec, decode, answerProblems } from '../v2/planner/outline-form.js';
import { formValues } from '../v2/planner/schema-sampler.js';

/** @param {any} a @param {any} b */
const merged = (a, b) => { const conflicts = []; const shape = mergeShape(a, b, 'x', conflicts); return { shape, conflicts }; };

test('a card refines a base field: required, a narrower range or set, an added pattern', () => {
  const base = /** @type {any} */ (SECTIONS['plot.characters']).of.fields.name;
  const r = merged(base, { type: 'string', display: true, required: true });
  assert.deepEqual(r.conflicts, []);
  assert.equal(r.shape.required, true);
  assert.equal(r.shape.pattern, base.pattern, 'the base\'s pattern stays');
  assert.deepEqual(merged({ type: 'number', min: 0, max: 10 }, { type: 'number', min: 2, max: 8 }), { shape: { type: 'number', min: 2, max: 8 }, conflicts: [] });
  assert.deepEqual(merged({ type: 'string', options: ['a', 'b', 'c'] }, { type: 'string', options: ['a', 'b'] }).shape.options, ['a', 'b']);
  assert.equal(merged({ type: 'string' }, { type: 'string', pattern: '^[a-z]+$' }).shape.pattern, '^[a-z]+$');
  assert.deepEqual(merged({ type: 'string', reserved: ['player'] }, { type: 'string', reserved: ['self'] }).shape.reserved, ['player', 'self']);
});

test('a contradiction conflicts: a different type, a widened range or set, a different pattern', () => {
  for (const [a, b] of [
    [{ type: 'string' }, { type: 'number' }],
    [{ type: 'number', min: 0 }, { type: 'number', min: -1 }],
    [{ type: 'number', max: 10 }, { type: 'number', max: 11 }],
    [{ type: 'string', options: ['a', 'b'] }, { type: 'string', options: ['a', 'z'] }],
    [{ type: 'string', pattern: '^a$' }, { type: 'string', pattern: '^b$' }],
    [{ type: 'ref', to: 'zone' }, { type: 'ref', to: 'item' }],
  ]) assert.equal(merged(a, b).conflicts.length, 1, JSON.stringify([a, b]));
  assert.deepEqual(merged({ type: 'string', effect: 'one' }, { type: 'string', effect: 'other words' }).conflicts, [], 'prose is not a contradiction');
});

const OBJECTIVE = { type: 'object', fields: { id: { type: 'string', required: true }, kind: { type: 'string', required: true, options: ['reach', 'collect'] } },
  variants: { by: 'kind', of: { reach: { zone: { type: 'string', required: true } }, collect: { item: { type: 'string', required: true }, count: { type: 'integer', min: 1 } } } } };
/** @param {unknown} v */
const problems = v => { const errors = []; checkParam(/** @type {any} */ (OBJECTIVE), v, 'o', errors, null); return errors.map(e => `${e.code} ${e.path}`); };

test('checkParam: an object with variants holds its fields and its kind\'s, and nothing else', () => {
  assert.deepEqual(problems({ id: 'a', kind: 'reach', zone: 'hall' }), []);
  assert.deepEqual(problems({ id: 'a', kind: 'collect', item: 'key', count: 2 }), []);
  assert.deepEqual(problems({ id: 'a', kind: 'collect', count: 0 }), ['param_missing o.item', 'param_range o.count']);
  assert.deepEqual(problems({ id: 'a', kind: 'reach', zone: 'hall', item: 'key' }), ['param_unknown o.item'], 'another kind\'s field is unknown');
  assert.deepEqual(problems({ id: 'a', kind: 'fly', zone: 'hall' }), ['param_option o.kind'], 'an unknown kind is its discriminator\'s finding alone');
});

test('strictSpec: one branch per variant, the discriminator fixed; every answer it allows decodes to a value preflight accepts', () => {
  const s = strictSpec(OBJECTIVE, 1, null);
  assert.ok(s && Array.isArray(s.schema.anyOf) && s.schema.anyOf.length === 2);
  const answers = formValues(s.schema, 12);
  assert.ok(answers.some(v => /** @type {any} */ (v).kind === 'reach') && answers.some(v => /** @type {any} */ (v).kind === 'collect'));
  for (const v of answers) {
    assert.deepEqual(answerProblems(s.schema, v), []);
    assert.deepEqual(problems(decode(v, s.codec)), [], JSON.stringify(v));
  }
  assert.ok(answerProblems(s.schema, { id: 'a', kind: 'reach', item: 'key', count: 1 }).length > 0, 'a branch holds only its kind\'s fields');
});
