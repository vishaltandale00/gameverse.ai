// Catalogue conformance of the card-derived schemas (ARCHITECTURE.md §1.4, §6.2; v2/planner/schema-sampler.js): over
// every card of the live catalogue, any answer its forms allow (each param's strict schema, each component it owns,
// each section entry it declares) passes preflight and every validate except for the cross-field rules the cards
// declare (card.rules), every code a primitive emits is declared, no validate crashes, every declared rule is
// reachable by an answer the forms allow, and every card is hosted by a template document (with what it requires).
// The cards' declarations themselves are well formed: rules (kernel/rules.js) and section shapes that do not conflict
// (kernel/sections.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES } from '../v2/templates/registry.js';
import { liveCatalogue } from '../v2/planner/catalog.js';
import { sampleCatalogue, sampleExamples, formValues, PROBE, KERNEL_EXAMPLES } from '../v2/planner/schema-sampler.js';
import { ruleShapeProblems, kindCodeProblems, KERNEL_CODES } from '../v2/kernel/rules.js';
import { sectionShape, BASE_SECTIONS } from '../v2/kernel/sections.js';
import { answerProblems } from '../v2/planner/outline-form.js';

// The live catalogue with the sampler's probe (an ambient stand-in carrying the declared examples into documents).
const { registry, logic } = await liveCatalogue({ extra: [PROBE] });
const corpus = TEMPLATES.map(t => ({ id: t.id, doc: t.doc }));
const r = sampleCatalogue({ corpus, registry, logic });
const ex = sampleExamples({ corpus, registry, logic });
const lines = list => list.map(x => JSON.stringify(x)).slice(0, 25).join('\n');

test('sampler: the values it draws are answers the form allows', () => {
  const schemas = [{ type: 'integer', minimum: 2, maximum: 9 }, { type: 'number' }, { type: 'array', items: { type: 'string', enum: ['a', 'b'] }, minItems: 1, maxItems: 2 },
    { type: 'object', additionalProperties: false, required: ['x', 'y'], properties: { x: { anyOf: [{ type: 'boolean' }, { type: 'null' }] }, y: { type: 'string', pattern: '^[a-z]+$' } } }];
  for (const s of schemas) {
    const values = formValues(s);
    assert.ok(values.length >= 2, JSON.stringify(s));
    for (const v of values) assert.deepEqual(answerProblems(s, v), [], `${JSON.stringify(v)} under ${JSON.stringify(s)}`);
  }
});

test('declarations: every card\'s rules and every vocabulary kind\'s declared codes are well formed', () => {
  const bad = registry.ids().flatMap(id => ruleShapeProblems(registry.get(id)?.card, id));
  assert.deepEqual(bad, []);
  const kinds = [...logic.predicates].map(([k, d]) => kindCodeProblems(d, `predicate ${k}`)).concat([...logic.effects].map(([k, d]) => kindCodeProblems(d, `effect ${k}`))).flat();
  assert.deepEqual(kinds, []);
});

test('every kernel code and every vocabulary kind\'s declared code has an example that emits exactly it in a document', () => {
  assert.deepEqual(Object.keys(KERNEL_EXAMPLES).sort(), [...KERNEL_CODES].sort(), 'every kernel code has its example');
  assert.ok(ex.checked >= KERNEL_CODES.length);
  assert.deepEqual(ex.findings, [], lines(ex.findings));
});

test('declarations: the section shapes of the catalogue do not conflict (the kernel\'s base and every card\'s card.data and card.components)', () => {
  const sections = [...new Set([...BASE_SECTIONS, ...registry.ids().flatMap(id => Object.keys(registry.get(id)?.card.data || {}))])];
  const conflicts = sections.flatMap(s => sectionShape(registry, registry.ids(), s).conflicts);
  assert.deepEqual(conflicts, []);
});

test('every card is hosted by a template document', () => assert.deepEqual(r.unhosted, [], lines(r.unhosted)));

test('every answer the forms allow passes preflight and validate except declared cross-field rules', () => {
  const rejected = r.findings.filter(f => f.code === 'form_rejected');
  assert.deepEqual(rejected, [], `${rejected.length} answers the forms allow fail a declared shape:\n${lines(rejected)}`);
});

test('every code a primitive emits is declared on its card (card.rules), and no validate crashes on an answer its forms allow', () => {
  const found = r.findings.filter(f => f.code === 'rule_undeclared' || f.code === 'validator_crashed');
  assert.deepEqual(found, [], lines(found));
});

test('every declared rule is reachable: an answer the forms allow (or the rule\'s declared example, itself such an answer) emits it', () => {
  const bad = r.findings.filter(f => f.code === 'example_invalid');
  assert.deepEqual(bad, [], lines(bad));
  assert.deepEqual(r.unreached, [], lines(r.unreached));
});
