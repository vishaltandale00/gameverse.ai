// Every option a primitive offers can be taken through a control a person has (ARCHITECTURE.md §6.3, KERNEL_API.md §2
// rt.options): its actions are presses and values of the verbs the primitive declares, or the input axis it declares
// held (`move: [x, y]`), issued by the headless input driver from the document a person plays (v2/verify/controls.js);
// an option only a macro realises (apply with no actions) is one a person cannot take, except a travel macro to a
// zone, which the playtest realises as held input. The gate fails `option_uncontrolled` otherwise (verify/playtest.js,
// planner/verify-adapter.js viability, templates/contract.js controls stage).
// Catalogue-wide over worlds: every template, every composed nested and union pair (tests/v2-catalogue-documents.js) and
// every choice fixture (tests/v2-choice-fixtures.js: the minimal documents of the option providers no template uses),
// played a few seeded choices deep through the controls, offer no option the controls cannot issue.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { preflight } from '../v2/kernel/document.js';
import { controlledMaker, hostPreflight } from '../v2/verify/controls.js';
import { applyOption, optionLabels, hold } from '../v2/verify/drive.js';
import { prng } from '../v2/verify/util.js';
import { catalogueDocuments } from './v2-catalogue-documents.js';
import { loopVerbs } from '../v2/primitives/engine/runtime-lib-controls.js';
import { FIXTURES } from './v2-choice-fixtures.js';

const { registry, logic } = buildCatalogue();
const cat = { registry, logic };

/** What no control issues in an option: [] when a person can take it. */
const uncontrolled = (rt, o) => {
  if (o.zone !== undefined && typeof o.apply === 'function') return [];
  const acts = o.actions || {}, issues = Object.keys(acts).some(v => acts[v] !== undefined && acts[v] !== null && acts[v] !== false);
  if (!issues && typeof o.apply === 'function') return [{ verb: o.label, why: 'a macro (apply) that issues no action' }];
  return rt.controls.missing({ actions: acts });
};

const cases = () => [
  ...catalogueDocuments(cat).map(c => ({ ...c, prepare: null })),
  ...Object.entries(FIXTURES).flatMap(([use, f]) => (Array.isArray(f) ? f : [f]).map((c, i) => ({ label: `fixture ${use}${i ? ` #${i}` : ''}`, doc: c.doc,
    prepare: rt => { for (const [archetype, at, id] of c.spawn || []) rt.spawn(archetype, { id, at: structuredClone(at), space: rt.doc.spaces[0].id }); if (c.setup) rt.run(c.setup); } }))),
];

test('every option offered in the catalogue\'s worlds is one a person can take through the controls', t => {
  const t0 = performance.now(), all = cases(), found = [], crashed = [];
  let offered = 0;
  for (const { label, doc, prepare } of all) {
    const pre = preflight(structuredClone(doc), registry, logic);
    assert.ok(pre.ok, `${label}: ${JSON.stringify(pre.errors?.slice(0, 2))}`);
    const host = hostPreflight(pre.doc, registry, logic);
    assert.ok(host.ok, `${label}: the host document preflights`);
    const rt = controlledMaker(host.doc, registry, logic)(host.doc.seed ?? 1), rand = prng(`options:${label}`);
    prepare?.(rt);
    hold(rt, {}, 30);
    for (let k = 0; k < 12 && rt.state.status === 'playing'; k++) {
      const options = rt.availableOptions(), labels = optionLabels(options), takeable = [];
      options.forEach((o, i) => { offered++; const m = uncontrolled(rt, o); if (m.length) found.push(`${label}: '${labels[i]}' (${m.map(x => `${x.verb}: ${x.why}`).join('; ')})`); else if (!(o.zone !== undefined && typeof o.apply === 'function')) takeable.push(o); });
      if (!takeable.length) { hold(rt, {}, 20); continue; }
      const o = rand.pick(takeable);
      // A world that crashes when an option is taken is the gate's runtime_error (verify/playtest.js), reported here as a
      // diagnostic; this property is about what the options offer before that.
      try { applyOption(rt, o); } catch (e) { crashed.push(`${label}: taking '${o.label}' threw ${e?.message || e}`); break; }
    }
  }
  assert.deepEqual([...new Set(found)], [], 'options no control a person has can take');
  assert.ok(offered > 500, `${offered} options checked`);
  for (const c of crashed) t.diagnostic(`crash: ${c}`);
  t.diagnostic(`${all.length} worlds, ${offered} options, ${Math.round(performance.now() - t0)} ms`);
});

test('a shortcut is never a person\'s control: no game option travels, no movement card declares travel, and the verifier\'s travel macros reach zones', () => {
  // Travel to a zone is what a person does with the move axis; the verifier plays it as held input (verify/macros.js).
  for (const c of registry.cards().filter(c => c.id.startsWith('gameplay.move') || c.id === 'gameplay.mount')) {
    assert.ok(!(c.loop?.verbs || []).includes('travel') && !c.actionSpace?.travel, `${c.id} declares no travel verb`);
  }
  let zoned = 0;
  for (const { label, doc, prepare } of cases()) {
    const pre = preflight(structuredClone(doc), registry, logic), host = hostPreflight(pre.doc, registry, logic);
    const rt = controlledMaker(host.doc, registry, logic)(host.doc.seed ?? 1);
    prepare?.(rt);
    hold(rt, {}, 30);
    assert.ok(!loopVerbs(host.doc, registry).includes('travel'), `${label}: no loop verb travels`);
    assert.deepEqual(rt.availableOptions().filter(o => o.actions?.travel !== undefined || /^travel/.test(String(o.label))).map(o => o.label), [], `${label}: no game option travels`);
    const p = rt.player(), space = (host.doc.spaces || []).find(s => s.id === p?.space);
    if (space?.zones?.length && typeof rt.space(p.space).path === 'function') zoned++;
  }
  assert.ok(zoned > 0, 'some catalogue world has zones the verifier\'s travel macros reach (solve.js, playtest.js)');
});
