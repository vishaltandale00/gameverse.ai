// Deterministic repair by stable preflight codes, including capability-driven re-selection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { preflight } from '../v2/kernel/document.js';
import { repairDocument, parsePath, synthesize, describeErrors } from '../v2/planner/repair.js';
import { testCatalogue } from './v2-p-pipeline-fixtures.js';

const manor = () => JSON.parse(readFileSync(new URL('../v2/games/quiet-manor.json', import.meta.url), 'utf8'));
const { registry, logic } = testCatalogue();
const codes = doc => preflight(doc, registry, logic).errors.map(e => e.code);

test('paths parse into keys', () => {
  assert.deepEqual(parsePath('systems[2].with.start[0].item'), ['systems', 2, 'with', 'start', 0, 'item']);
  assert.deepEqual(parsePath('plot.storyboard.acts[1].beats[0].when'), ['plot', 'storyboard', 'acts', 1, 'beats', 0, 'when']);
});

test('params: unknown dropped, out of range clamped, wrong type reset, missing required synthesized', () => {
  const doc = manor();
  doc.systems[0].with = { slots: 5000, colour: 'red', start: [{ count: 2 }] }; // slots max 1000, unknown param, start[0].item required
  doc.systems[1].with = { sequentialActs: 'yes' };
  assert.deepEqual(codes(doc).sort(), ['param_missing', 'param_range', 'param_type', 'param_unknown']);
  const r = repairDocument(doc, { registry, logic });
  assert.ok(r.ok, describeErrors(r.errors));
  assert.equal(r.doc.systems[0].with.slots, 1000);
  assert.equal(r.doc.systems[0].with.colour, undefined);
  assert.equal(typeof r.doc.systems[0].with.start[0].item, 'string');
  assert.equal(r.doc.systems[1].with.sequentialActs, undefined, 'reset to the default');
  assert.equal(doc.systems[0].with.slots, 5000, 'the input is not mutated');
  assert.deepEqual(new Set(r.fixes.map(f => f.code)), new Set(['param_missing', 'param_range', 'param_type', 'param_unknown']));
});

test('references: near misses re-pointed, creatable kinds stubbed, dangling zone references dropped', () => {
  const doc = manor();
  doc.plot.storyboard.acts[1].beats[0].do[0].item = 'brass-key';            // near miss of brass_key
  doc.plot.storyboard.acts[0].beats[0].do[0].character = 'gardener';        // new character
  doc.spaces[0].zones[1].exits.push({ to: 'cellar' });                      // unknown zone
  doc.player.archetype = 'inspector';
  const r = repairDocument(doc, { registry, logic });
  assert.ok(r.ok, describeErrors(r.errors));
  assert.equal(r.doc.plot.storyboard.acts[1].beats[0].do[0].item, 'brass_key');
  assert.ok(r.doc.plot.characters.some(c => c.id === 'gardener'));
  assert.ok(!r.doc.spaces[0].zones[1].exits.some(x => x.to === 'cellar'));
  assert.ok(r.doc.content.archetypes.some(a => a.id === 'inspector'));
});

test('primitives: unknown ones removed and reported, missing vocabulary providers added', () => {
  const doc = manor();
  doc.systems = [{ use: 'plot.storyboard' }, { use: 'gameplay.made.up' }]; // give_item and the item predicate now have no provider
  // Preflight only flags the unknown primitive: the logic vocabulary is catalogue-wide (kernel request in v2/kernel/requests/pipeline.md).
  assert.deepEqual(codes(doc), ['primitive_unknown']);
  const r = repairDocument(doc, { registry, logic });
  assert.ok(r.ok, describeErrors(r.errors));
  assert.deepEqual(r.removed.map(x => x.use), ['gameplay.made.up']);
  assert.ok(r.doc.systems.some(s => s.use === 'gameplay.inventory'), 'the primitive registering give_item/item was added');
});

test('capability errors re-select: a space configuration first, then another space, else removal as a capability gap', () => {
  const base = {
    schema: 'gameverse.v2.game/0.2', id: 'field', title: 'Field', seed: 1,
    spaces: [{ id: 'field', use: 'engine.space.flatx', zones: [{ id: 'start', rect: [0, 0, 16, 16] }] }],
    systems: [{ use: 'gameplay.test.dash' }], content: { archetypes: [{ id: 'hero', components: {} }] }, player: { archetype: 'hero', space: 'field', at: [1, 1] },
  };
  assert.deepEqual(codes(base), ['capability_missing']);
  const r = repairDocument(base, { registry, logic });
  assert.ok(r.ok, describeErrors(r.errors));
  assert.deepEqual(r.doc.spaces[0].with, { mode: 'side' });
  const warp = { ...structuredClone(base), systems: [{ use: 'gameplay.test.warp' }] };
  const w = repairDocument(warp, { registry, logic });
  assert.ok(w.ok);
  assert.deepEqual(w.removed.map(x => [x.use, x.kind]), [['gameplay.test.warp', 'capability']]);
});

test('ids: invalid slugged, duplicates renamed; schema fields restored; values synthesize from schemas', () => {
  const doc = manor();
  doc.schema = 'old'; doc.id = 'Quiet Manor!';
  doc.content.items.push({ id: 'letter', name: 'Second letter' });
  doc.plot.characters.push({ id: 'Old Gardener', name: 'Old Gardener' });
  const r = repairDocument(doc, { registry, logic });
  assert.ok(r.ok, describeErrors(r.errors));
  assert.equal(r.doc.schema, 'gameverse.v2.game/0.2');
  assert.match(r.doc.id, /^[a-z0-9][a-z0-9_-]*$/);
  assert.deepEqual(r.doc.content.items.map(i => i.id), ['brass_key', 'letter', 'letter_2']);
  assert.ok(r.doc.plot.characters.some(c => c.id === 'old_gardener'));
  assert.equal(synthesize({ type: 'integer', min: 3, max: 9 }, { ensureId: () => 'x' }), 3);
  assert.deepEqual(synthesize({ type: 'object', fields: { a: { type: 'ref', to: 'item', required: true }, b: { type: 'number' } } }, { ensureId: k => `${k}_1` }), { a: 'item_1' });
});
