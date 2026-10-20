// Layer 5 (tweaks without a model) and targeted revisions with the revision-check guards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tweakDocument, tweakCandidates, applyOps, resolvePath, reviseDocument, guardRevision } from '../v2/planner/doc-revise.js';
import { contentDiff } from '../v2/planner/revision-check.js';
import { testCatalogue, fakeWriter, fakeDecisions } from './v2-p-pipeline-fixtures.js';

const { registry, logic } = testCatalogue();
const manor = () => ({ ...JSON.parse(readFileSync(new URL('../v2/games/quiet-manor.json', import.meta.url), 'utf8')), graphics: [{ use: 'graphics.ui.story', with: { log: 40 } }] });

test('tweaks change only matching params of the instances in the document, clamped, in milliseconds', async () => {
  const doc = manor();
  const t = performance.now();
  const more = await tweakDocument(doc, 'more inventory slots', { registry });
  assert.ok(performance.now() - t < 1000);
  assert.ok(more.matched);
  assert.ok(more.ops.some(o => o.use === 'gameplay.inventory' && o.param === 'slots' && o.from === 36 && o.to === 49), JSON.stringify(more.ops));
  assert.ok(more.ops.every(o => o.use === 'gameplay.inventory'));
  assert.ok(contentDiff(doc, more.doc).every(line => line.startsWith('systems[0].with')), 'nothing else changed');
  const longer = await tweakDocument(doc, 'keep a longer story log', { registry });
  assert.deepEqual(longer.ops.map(o => [o.use, o.param, o.to]), [['graphics.ui.story', 'log', 54]]);
  const set = await tweakDocument(doc, 'set the slots to 2000', { registry });
  assert.equal(set.ops[0].to, 1000, 'clamped to the declared max');
  const unrelated = await tweakDocument(doc, 'add a dragon', { registry });
  assert.equal(unrelated.matched, false);
  assert.equal(tweakCandidates(doc, 'faster cars', registry).length, 0, 'no instance here has a speed param');
});

test('a decision model confirms which candidate params a tweak means', async () => {
  const doc = manor();
  const decisions = fakeDecisions(q => Object.fromEntries(Object.entries(q).map(([k, x]) => [k, { type: 'noul', noul: /slots/.test(x.instructions) ? 0.9 : 0.1 }])));
  const r = await tweakDocument(doc, 'more room: bigger inventory and a longer log', { registry, decisions });
  assert.equal(r.source, 'fake');
  assert.deepEqual(r.ops.map(o => o.param), ['slots']);
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

test('guards: dropped content and repainting are refused unless asked; the change summary comes from the document diff', async () => {
  const before = manor();
  const dropped = structuredClone(before); dropped.content.items = dropped.content.items.slice(0, 1);
  const g1 = await guardRevision({ before, after: dropped, change: 'make the butler friendlier' });
  assert.deepEqual([g1.ok, g1.reason], [false, 'dropped_content']);
  const g2 = await guardRevision({ before, after: dropped, change: 'remove the letter' });
  assert.ok(g2.ok, 'asked for: allowed');
  const repainted = structuredClone(before); repainted.graphics[0].with.style = 'comic';
  assert.equal((await guardRevision({ before, after: repainted, change: 'more inventory slots' })).reason, 'art_locked');
  assert.ok((await guardRevision({ before, after: repainted, change: 'make it look like a comic' })).ok);
  const renamed = structuredClone(before); renamed.plot.characters[0].name = 'Mr. Hobbs';
  const g3 = await guardRevision({ before, after: renamed, change: 'rename the butler' });
  assert.ok(g3.ok);
  assert.deepEqual(g3.changes, ['characters name']);
  assert.equal(g3.revisionCheck.applied, null, 'no decision model: applied is unknown, not guessed');
});

test('a writer proposes targeted ops and names what no primitive can do', async () => {
  const writer = fakeWriter([{ ops: [{ op: 'set', path: 'plot.characters[butler].name', value: 'Jeeves' }], unsupported: [{ request: 'a grappling hook', why: 'no primitive provides grappling' }], summary: 'renamed' }]);
  const r = await reviseDocument({ writer, doc: manor(), change: 'call the butler Jeeves and add a grappling hook', registry, logic });
  assert.equal(r.ops.length, 1);
  assert.deepEqual(r.unsupported.map(u => u.request), ['a grappling hook']);
  assert.match(writer.calls[0].system, /systems\[gameplay\.inventory\]\.with\.slots/);
  assert.match(writer.calls[0].system, /list it in "unsupported"/);
});
