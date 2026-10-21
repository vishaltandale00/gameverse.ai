// Tweaks (one strict model choice among the declared params) and targeted revisions with the revision-check guards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tweakDocument, tweakOptions, applyOps, resolvePath, reviseDocument, reviewChange, declaredDocument } from '../v2/planner/doc-revise.js';
import { contentDiff } from '../v2/planner/revision-check.js';
import { testCatalogue, fakeWriter, fakeDecisions } from './v2-p-pipeline-fixtures.js';

const { registry, logic } = testCatalogue();
const manor = () => ({ ...JSON.parse(readFileSync(new URL('../v2/games/quiet-manor.json', import.meta.url), 'utf8')), graphics: [{ use: 'graphics.ui.story', with: { log: 40 } }] });

/** A model answering the tweak form: the param `pick(options)` names (an option id, or 'none') and its value. */
const tweaker = (pick, number = null, flag = null) => fakeWriter([req => JSON.stringify({ param: pick(req.schema.schema.properties.param.enum), number, flag, why: 'scripted' })]);

test('a tweak is one strict choice among the params the cards declare on the instances; the value keeps the declared range or is asked again', async () => {
  const doc = manor();
  const options = tweakOptions(doc, registry);
  // Every declared number, integer or boolean param of every instance, in document order, with its declared range.
  assert.ok(options.some(o => o.use === 'gameplay.inventory' && o.param === 'slots' && o.max === 1000));
  assert.ok(options.every(o => ['number', 'integer', 'boolean'].includes(o.schema.type)));
  const slots = options.find(o => o.param === 'slots');
  const w = tweaker(() => slots.path, 49);
  const t = performance.now();
  const more = await tweakDocument(doc, 'more inventory slots', { registry, writer: w });
  assert.ok(performance.now() - t < 1000);
  assert.deepEqual(w.calls.map(c => c.schema.name), ['tweak_param']);
  assert.deepEqual(w.calls[0].schema.schema.properties.param.enum, [...options.map(o => o.path), 'none'], 'the options are the declarations, nothing ranked by words');
  assert.deepEqual(more.ops, [{ path: slots.path, use: 'gameplay.inventory', param: 'slots', from: 36, to: 49 }]);
  assert.ok(contentDiff(doc, more.doc).every(line => line.startsWith('systems[0].with')), 'nothing else changed');
  // Outside the declared range: asked again with the range, never clamped; a second answer outside it changes nothing.
  const w2 = fakeWriter([() => JSON.stringify({ param: slots.path, number: 2000, flag: null, why: 'x' })]);
  const set = await tweakDocument(doc, 'set the slots to 2000', { registry, writer: w2 });
  assert.equal(set.matched, false);
  assert.equal(w2.calls.length, 2);
  assert.match(w2.calls[1].user, /needs an integer from .* to 1000/);
  // "none": the request is not one param (a dragon is a mechanic): nothing is tweaked.
  const unrelated = await tweakDocument(doc, 'add a dragon', { registry, writer: tweaker(() => 'none') });
  assert.equal(unrelated.matched, false);
});

test('without a model nothing is tweaked: no word of the request is matched against param names', async () => {
  const r = await tweakDocument(manor(), 'more inventory slots', { registry });
  assert.deepEqual([r.matched, r.ops, r.source], [false, [], 'no_model']);
});

test('revision ops use identity-aware paths; nothing else in the document moves', () => {
  const doc = manor();
  assert.equal(resolvePath(doc, 'plot.characters[butler].name').key, 'name');
  const { doc: out, applied, failed } = applyOps(doc, [
    { op: 'set', path: 'plot.characters[butler].name', value: 'Mr. Hobbs' },
    { op: 'add', path: 'content.items', value: { id: 'lamp', name: 'Lamp' } },
    { op: 'set', path: 'systems[gameplay.inventory].with.slots', value: 10 },
    { op: 'add', path: 'plot.storyboard.acts[search].beats', value: { id: 'lamp_found', optional: true, when: { zone: 'hall' }, do: [{ do: 'give_item', item: 'lamp' }] } },
    { op: 'set', path: 'spaces[nowhere].zones', value: [] },
  ]);
  assert.equal(applied.length, 4);
  assert.deepEqual(failed.map(f => f.why), ['path not found']);
  assert.equal(out.plot.characters[0].name, 'Mr. Hobbs');
  assert.equal(out.systems[0].with.slots, 10);
  assert.equal(out.plot.storyboard.acts[1].beats.length, 4);
  assert.equal(doc.plot.characters[0].name, 'Hobbs', 'input not mutated');
});

test('review: removals and look changes the request did not ask for are notes, never refusals; only a game that cannot run is blocked', async () => {
  const before = manor();
  const dropped = structuredClone(before); dropped.content.items = dropped.content.items.slice(0, 1);
  const g1 = await reviewChange({ before, after: dropped, change: 'make the butler friendlier' });
  assert.equal(g1.block, null);
  assert.ok(g1.notes.some(n => n.startsWith('removed content.items')), g1.notes.join('; '));
  // Whether the request asked for it is the decision model's: without one it is noted (never read from the request's words).
  const g2 = await reviewChange({ before, after: dropped, change: 'remove the letter' });
  assert.ok(g2.notes.some(n => n.startsWith('removed content.items')), 'not known to be asked for: noted');
  const asked = fakeDecisions(() => ({ remove: { type: 'noul', noul: 0.95 } }));
  const g2b = await reviewChange({ before, after: dropped, change: 'remove the letter', decisions: asked });
  assert.ok(!g2b.notes.some(n => n.startsWith('removed')), 'asked for: no note');
  // A look change is a fact the review states, whatever the request says.
  const repainted = structuredClone(before); repainted.graphics[0].with.style = 'comic';
  assert.ok((await reviewChange({ before, after: repainted, change: 'make it look like a comic' })).notes.includes('changed the look (graphics or models)'));
  const renamed = structuredClone(before); renamed.plot.characters[0].name = 'Mr. Hobbs';
  const g3 = await reviewChange({ before, after: renamed, change: 'rename the butler' });
  assert.equal(g3.block, null);
  assert.deepEqual(g3.changes, ['characters name']);
  assert.equal(g3.revisionCheck.applied, null, 'no decision model: applied is unknown, not guessed');
  assert.equal((await reviewChange({ before, after: renamed, change: 'x', verifyAfter: { ok: false } })).block.code, 'invalid');
  assert.equal((await reviewChange({ before, after: renamed, change: 'x', verifyAfter: { ok: true, viable: false, viability: 'runtime_error: boom' } })).block.code, 'not_playable');
});

test('a writer proposes targeted ops and names what no primitive can do', async () => {
  const writer = fakeWriter([{ ops: [{ op: 'set', path: 'plot.characters[butler].name', value: 'Jeeves' }], unsupported: [{ request: 'a grappling hook', why: 'no primitive provides grappling' }], summary: 'renamed' }]);
  const r = await reviseDocument({ writer, doc: manor(), change: 'call the butler Jeeves and add a grappling hook', registry, logic });
  assert.equal(r.ops.length, 1);
  assert.deepEqual(r.unsupported.map(u => u.request), ['a grappling hook']);
  assert.match(writer.calls[0].system, /systems\[gameplay\.inventory\]\.with\.slots/);
  assert.match(writer.calls[0].system, /list it in "unsupported"/);
  // The document it is written against is whole (no cut): every instance and every section a primitive it uses reads.
  assert.ok(writer.calls[0].user.includes(JSON.stringify(declaredDocument(manor(), registry))));
  const extra = { ...manor(), content: { ...manor().content, unread_notes: [{ id: 'n' }] } };
  assert.equal(declaredDocument(extra, registry).content.unread_notes, undefined, 'a section no primitive reads is no part of it');
});
