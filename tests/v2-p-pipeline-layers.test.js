// Layers 1-3 of ARCHITECTURE.md §4: outline (preflight + repair rounds), first playable
// (no model, <1 s), detail patches (repaired, guarded, verified, hot-loaded via mergePatch + rt.extend).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../v2/kernel/world.js';
import { preflight, mergePatch } from '../v2/kernel/document.js';
import { selectPrimitives } from '../v2/planner/select.js';
import { proceduralOutline, writeOutline, fewShot } from '../v2/planner/outline.js';
import { firstPlayable, replayCheck } from '../v2/planner/first-playable.js';
import { detailTasks, proceduralDetail, acceptPatch, sanitizePatch } from '../v2/planner/detail.js';
import { verifyDocument, regressed } from '../v2/planner/verify-adapter.js';
import { solve } from '../v2/verify/solve.js';
import { testCatalogue, fakeWriter, decomposition, broken, picky } from './v2-p-pipeline-fixtures.js';

const { registry, logic } = testCatalogue();
const plan = async mechanics => { const d = decomposition(mechanics); return { d, sel: await selectPrimitives({ decomposition: d, registry }) }; };

test('the procedural outline is valid, playable and completable on whichever space the selection chose', async () => {
  for (const mechanics of [['find and collect items', 'follow a story told in acts'], ['dash through enemies with a burst of speed']]) {
    const { d, sel } = await plan(mechanics);
    const o = proceduralOutline({ decomposition: d, selection: sel, registry, logic, seed: 3 });
    assert.ok(o.ok, JSON.stringify(o.errors));
    const pre = preflight(o.doc, registry, logic);
    assert.ok(pre.ok);
    assert.equal(o.doc.spaces[0].zones.length, d.zones);
    assert.ok(o.doc.plot.storyboard.acts.length >= 1 && o.doc.plot.endings.length === 1);
    if (o.doc.spaces[0].use === 'engine.space.graph') {
      const s = solve(pre.doc, registry, logic, { budgetMs: 1000 });
      assert.ok(s.completable, 'the graph skeleton is solvable end to end');
      assert.ok(o.doc.spaces[0].zones.some(z => z.exits.some(x => x.gate)), 'key items gate progress');
    } else assert.deepEqual(o.doc.spaces[0].with, { mode: 'side' }, 'the dash needs gravity: side mode');
  }
});

test('few-shot material only teaches registered primitives', () => {
  const shots = fewShot(registry).map(s => JSON.parse(s));
  assert.ok(shots.length >= 1);
  for (const g of shots) for (const i of [...g.spaces, ...g.systems, ...g.graphics]) assert.ok(registry.has(i.use), i.use);
});

test('model outline: errors are repaired by code first, then sent back to the model; fall back to the skeleton if it never validates', async () => {
  const { d, sel } = await plan(['find and collect items']);
  const skeleton = proceduralOutline({ decomposition: d, selection: sel, registry, logic, seed: 1 }).doc;
  // Draft 1: fixable by code (unknown param, near-miss item, out-of-range slots).
  const draft = structuredClone(skeleton);
  draft.title = 'The Drowned Lamp';
  draft.systems.find(s => s.use === 'gameplay.inventory').with = { slots: 99999, sparkle: true };
  const writer = fakeWriter([draft]);
  const r = await writeOutline({ writer, prompt: 'idea', decomposition: d, selection: sel, registry, logic, seed: 1 });
  assert.ok(r.ok);
  assert.equal(r.doc.title, 'The Drowned Lamp');
  assert.equal(r.firstPassOk, false, 'it needed repair');
  assert.equal(writer.calls.length, 1, 'code repair sufficed: no second model call');
  assert.match(writer.calls[0].system, /plot\.storyboard/);
  assert.match(writer.calls[0].user, /A valid skeleton/);
  // A code only the model can fix goes back to it with code, path and hint; the second draft fixes it.
  const p = testCatalogue([picky]);
  const needsModel = { ...structuredClone(skeleton), title: 'Drowned Lamp', systems: [...skeleton.systems, { use: 'gameplay.test.picky' }] };
  const two = fakeWriter([needsModel, { ...needsModel, title: 'The Drowned Lamp' }]);
  const m = await writeOutline({ writer: two, prompt: 'idea', decomposition: d, selection: sel, registry: p.registry, logic: p.logic, seed: 1 });
  assert.ok(m.ok && !m.fellBack);
  assert.equal(two.calls.length, 2);
  assert.match(two.calls[1].user, /\[picky_title\] title: the title must start with "The" \(hint: rename the game\)/, 'the repair round names the stable code, path and hint');
  assert.deepEqual(m.rounds.map(x => x.kind), ['procedural', 'model', 'model_repair']);
  // A model that never validates: bounded rounds, then the valid skeleton, and the report says so.
  const stubborn = fakeWriter([needsModel]);
  const f = await writeOutline({ writer: stubborn, prompt: 'idea', decomposition: d, selection: sel, registry: p.registry, logic: p.logic, seed: 1, maxRounds: 1 });
  assert.equal(stubborn.calls.length, 2);
  assert.ok(f.ok && f.fellBack && f.source === 'procedural');
});

test('first playable: no model, well under a second, deterministic; an install that throws is isolated', async () => {
  const { d, sel } = await plan(['find and collect items']);
  const o = proceduralOutline({ decomposition: d, selection: sel, registry, logic, seed: 9 });
  const t = performance.now();
  const fp = firstPlayable(o.doc, registry, logic, { seed: 9 });
  assert.ok(performance.now() - t < 1000);
  assert.ok(fp.ok && fp.start?.at, JSON.stringify(fp.problems));
  assert.ok(fp.beatsFired.includes('arrival'), 'the first beat ran');
  assert.ok(fp.options > 0, 'the player has choices');
  assert.equal(firstPlayable(o.doc, registry, logic, { seed: 9 }).stateHash, fp.stateHash);
  assert.ok(replayCheck(fp.doc, registry, logic, { seed: 9 }).deterministic);
  const withBroken = testCatalogue([broken]);
  const doc = { ...o.doc, systems: [...o.doc.systems, { use: 'gameplay.test.broken' }] };
  const fp2 = firstPlayable(doc, withBroken.registry, withBroken.logic, { seed: 9 });
  assert.ok(fp2.ok);
  assert.deepEqual(fp2.removed.map(r => r.use), ['gameplay.test.broken']);
});

test('detail patches: sanitized (namespaced ids, optional beats), merged, verified, and hot-loaded into a running world', async () => {
  const { d, sel } = await plan(['find and collect items']);
  const base = firstPlayable(proceduralOutline({ decomposition: d, selection: sel, registry, logic, seed: 2 }).doc, registry, logic, { seed: 2 }).doc;
  const tasks = detailTasks(base);
  assert.equal(tasks.length, d.zones);
  const task = tasks[1];
  const s = sanitizePatch({ plot: { characters: [{ id: 'fisher', name: 'Old Fisher' }], storyboard: { acts: [{ id: 'act_1', beats: [{ id: 'chat', when: { zone: task.zone }, do: [{ do: 'say', character: 'fisher', text: 'Hm.' }] }] }, { id: 'no_such_act', beats: [{ id: 'x' }] }] } }, title: 'hijack' }, task, base);
  assert.equal(s.title, undefined, 'only additive sections survive');
  assert.equal(s.plot.characters[0].id, `${task.zone}_fisher`);
  assert.deepEqual(s.plot.storyboard.acts.map(a => a.id), ['act_1']);
  assert.equal(s.plot.storyboard.acts[0].beats[0].optional, true);
  assert.equal(s.plot.storyboard.acts[0].beats[0].do[0].character, `${task.zone}_fisher`, 'references follow renamed ids');

  const baseVerify = await verifyDocument(base, registry, logic);
  const accepted = await acceptPatch({ current: base, patch: proceduralDetail(base, task, registry), task, registry, logic, baseVerify });
  assert.ok(accepted.ok, JSON.stringify(accepted.errors));
  assert.ok(accepted.added.beats.length === 1 && accepted.added.keys.includes('plot.characters'));
  assert.ok(accepted.verify.completable, 'still completable');
  // Hot-load into a world that is already running, then walk into the zone.
  const rt = createWorld(preflight(base, registry, logic).doc, registry, logic, { seed: 2 });
  rt.step();
  rt.extend(accepted.doc, accepted.added);
  assert.equal(rt.state.counts.content_added, 1);
  const path = rt.space(base.spaces[0].id);
  path.teleport(rt.player(), { zone: task.zone }, rt);
  rt.step(); rt.step();
  assert.ok(rt.store('plot.storyboard').fired[`${task.zone}_welcome`], 'the hot-loaded beat fired');

  const empty = await acceptPatch({ current: base, patch: { title: 'x' }, task, registry, logic, baseVerify });
  assert.equal(empty.reason, 'empty');
  const bad = await acceptPatch({ current: base, patch: { plot: { storyboard: { acts: [{ id: 'act_1', beats: [{ id: 'b', do: [{ do: 'explode' }] }] }] } } }, task, registry, logic, baseVerify });
  assert.ok(bad.ok, 'an unknown effect is repaired away by code (the beat stays, harmless)');
  assert.equal(regressed({ completable: true }, { completable: false, exhaustive: true }), true);
  assert.equal(regressed({ completable: true }, { completable: false, exhaustive: false }), false, 'an unfinished search is not a proof');
});

test('mergePatch keeps the outline intact: parallel zone patches never collide', async () => {
  const { d, sel } = await plan(['find and collect items']);
  const base = proceduralOutline({ decomposition: d, selection: sel, registry, logic, seed: 4 }).doc;
  let current = base;
  for (const task of detailTasks(base)) {
    const r = await acceptPatch({ current, patch: proceduralDetail(base, task, registry), task, registry, logic });
    assert.ok(r.ok, `${task.id}: ${JSON.stringify(r.errors)}`);
    current = r.doc;
  }
  assert.equal(current.plot.characters.length, base.plot.characters.length + detailTasks(base).length);
  assert.deepEqual(mergePatch(current, {}).doc.spaces, current.spaces);
});
