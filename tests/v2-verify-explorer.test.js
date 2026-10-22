// The playtest explorer plays through the controls a person has (ARCHITECTURE.md §6.3), catalogue-wide over the
// discovered templates: its worlds are the host document's controlled worlds (v2/verify/controls.js), every verb it
// pressed has a control in that document (a key, an axis or a mounted UI), it never asked for one that has none
// (controls_missing), and its winning path, when it found one, replays to the win on fresh controlled worlds. Options
// the game offers that no control can take are never taken; they are reported (option_uncontrolled, an error that
// blocks publishing) and no template offers one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES } from '../v2/templates/registry.js';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { playtest, explorerWorlds } from '../v2/verify/playtest.js';
import { hostPreflight, uncontrolledVerbs, controlsOf } from '../v2/verify/controls.js';

const { registry, logic } = buildCatalogue();

for (const t of TEMPLATES) test(`explorer: ${t.id} is explored only through the controls a person has`, () => {
  const host = hostPreflight(t.doc, registry, logic).doc, seed = host.seed ?? 1;
  const w = explorerWorlds(host, registry, logic, { seed });
  assert.ok(w.ok && w.make(seed).controls, 'controlled worlds of the host document');
  const r = playtest(t.doc, registry, logic, { seed, maxRounds: 40, maxFrames: 1500 });
  assert.deepEqual(r.problems.filter(p => p.code === 'controls_missing' || p.code === 'runtime_error').map(p => p.message), [], t.id);
  // Every verb it pressed has a key, an axis or a UI naming it; a UI that lists the game's options (the story's choices)
  // sends an option's whole record, so verbs in those records have that control (the driver checked each record).
  const listed = controlsOf(host, registry).ui.options.length > 0;
  assert.deepEqual(listed ? [] : uncontrolledVerbs(host, registry, Object.keys(r.verbsUsed)), [], `${t.id}: every verb the explorer pressed has a control`);
  if (r.win) assert.equal(r.win.replayed, true, `${t.id}: the win replays`);
  assert.deepEqual(r.problems.filter(x => x.code === 'option_uncontrolled').map(p => p.message), [], `${t.id}: every option it offers is one a person can take`);
});
