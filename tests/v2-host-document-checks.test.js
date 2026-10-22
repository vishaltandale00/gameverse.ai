// The static checks judge the document a person plays, and read each declaration one way (ARCHITECTURE.md §1.4, §6;
// KERNEL_API.md §6: the host mounts hostDocument(doc), the gate verifies the same document). Catalogue-wide: the cases
// are every discovered template and every document the composer makes from a pair of them (nested and union).
//   hosting       hostDocument is idempotent (a hosted document hosted again is itself);
//   composition   checkComposition judges a document as its host document (the same verdict for both);
//   loop          the host's additions carry no loop, participants, drivers or endings: the loop report of a document
//                 and of its host document are the same (loop-check reads the document so its paths name its own
//                 instances);
//   controls      the composition check's interaction failures are exactly the loop instances the controls reading
//                 (v2/verify/controls.js documentUncontrolled) finds uncontrolled;
//   world         the composition check and the gate's world check read world content one way (space-content.js): a
//                 space the composition check finds content for gets no world_empty / world_incomplete, and a space
//                 lacking its declared content is reported by both;
//   boots         every such document a person plays boots and steps;
//   contentParams every space card's provides.contentParams names params it declares, for content kinds it needs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, templateById } from '../v2/templates/registry.js';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { preflight } from '../v2/kernel/document.js';
import { createWorld } from '../v2/kernel/world.js';
import { checkComposition } from '../v2/planner/compose-check.js';
import { loopReport } from '../v2/planner/loop-check.js';
import { composeNested, composeUnion } from '../v2/planner/compose.js';
import { worldProblems, spacesNeedingWorld } from '../v2/planner/world.js';
import { hostDocument } from '../v2/web/host-doc.js';
import { documentUncontrolled } from '../v2/verify/controls.js';

const { registry, logic } = buildCatalogue();
const cat = { registry, logic };
const part = id => ({ id, doc: templateById(id).doc });

/** Every template's document and every document composed from an ordered pair of templates, preflighted. */
const CASES = (() => {
  const out = TEMPLATES.map(t => ({ label: t.id, doc: t.doc }));
  for (const a of TEMPLATES) for (const b of TEMPLATES) {
    if (a === b) continue;
    const n = composeNested(part(a.id), part(b.id), cat); if (n.doc) out.push({ label: `${a.id} × ${b.id}`, doc: n.doc });
    const u = composeUnion(part(a.id), part(b.id), cat); if (u.doc) out.push({ label: `${a.id} ∪ ${b.id}`, doc: u.doc });
  }
  return out.map(c => {
    const pre = preflight(structuredClone(c.doc), registry, logic);
    assert.ok(pre.ok, `${c.label}: ${JSON.stringify(pre.errors.slice(0, 3))}`);
    const host = preflight(hostDocument(pre.doc, registry), registry, logic);
    assert.ok(host.ok, `${c.label} (host): ${JSON.stringify(host.errors.slice(0, 3))}`);
    return { label: c.label, doc: pre.doc, host: host.doc };
  });
})();
const verdict = r => ({ verdict: r.verdict, checks: r.checks, failures: r.failures, holes: r.holes, adapters: r.adapters });
/** A loop problem without its path (hosting puts the host's input first, so instance indices differ). */
const unplaced = p => ({ code: p.code, severity: p.severity, primitive: p.primitive, need: p.need });

test(`hosting: hostDocument is idempotent on every template and composed document (${CASES.length})`, () => {
  assert.ok(CASES.length > TEMPLATES.length, 'composed documents are cases');
  for (const c of CASES) assert.deepEqual(preflight(hostDocument(c.host, registry), registry, logic).doc, c.host, c.label);
});

test('composition: a document is judged as the document a person plays', () => {
  for (const c of CASES) assert.deepEqual(verdict(checkComposition(c.doc, registry, { logic })), verdict(checkComposition(c.host, registry, { logic })), c.label);
});

test('loop: the loop report of a document is the loop report of the document a person plays', () => {
  for (const c of CASES) {
    const a = loopReport(c.doc, registry, { logic }), b = loopReport(c.host, registry, { logic });
    assert.deepEqual(a.problems.map(unplaced), b.problems.map(unplaced), c.label);
    assert.equal(a.owner, b.owner, c.label);
  }
});

test('controls: the composition check fails a loop instance exactly when the controls reading finds a verb of it uncontrolled', () => {
  for (const c of CASES) {
    const failed = [...new Set(checkComposition(c.doc, registry, { logic }).failures.filter(f => f.code === 'mode_input_mismatch').map(f => f.unit))].sort();
    const uncontrolled = [...new Set(documentUncontrolled(c.host, registry).map(m => m.use))].sort();
    assert.deepEqual(failed, uncontrolled, c.label);
  }
});

test('world: the composition check and the gate\'s world check read a space\'s world content one way', () => {
  let judged = 0;
  for (const c of CASES) {
    const needing = spacesNeedingWorld(c.host, registry);
    if (!needing.length) continue;
    const rt = createWorld(c.host, registry, logic, { seed: c.host.seed });
    for (let i = 0; i < 3 && rt.state.status === 'playing'; i++) rt.step();
    const world = new Set(worldProblems(rt, c.host, registry).filter(p => p.code === 'world_empty' || p.code === 'world_incomplete').map(p => p.space));
    const lacking = new Set(checkComposition(c.doc, registry, { logic }).failures.filter(f => f.code === 'content_missing' && f.unit === c.host.spaces.find(s => s.id === f.space)?.use).map(f => f.space));
    for (const { space } of needing) { judged++; assert.equal(world.has(space.id), lacking.has(space.id), `${c.label}: space '${space.id}' (${space.use}): world check ${world.has(space.id) ? 'reports' : 'accepts'} it, composition check ${lacking.has(space.id) ? 'reports' : 'accepts'} it`); }
  }
  assert.ok(judged > 0);
});

test('boots: every template and composed document a person plays boots and steps', () => {
  for (const c of CASES) {
    const rt = createWorld(c.host, registry, logic, { seed: 1 });
    assert.doesNotThrow(() => { for (let i = 0; i < 5 && rt.state.status === 'playing'; i++) rt.step({}); }, c.label);
  }
});

test('contentParams: every space card names params it declares, for world content kinds it needs', () => {
  let declared = 0;
  for (const id of registry.ids('engine')) {
    const card = registry.get(id).card, cp = card.provides?.contentParams;
    if (!cp) continue;
    const needs = new Set([...(card.needs?.content || []), ...(card.needs?.alternatives || []).flat()]);
    for (const [kind, params] of Object.entries(cp)) {
      declared++;
      assert.ok(needs.has(kind), `${id}: contentParams.${kind} is no content its card.needs declares`);
      assert.ok(Array.isArray(params) && params.length, `${id}: contentParams.${kind} names no param`);
      for (const p of params) assert.ok(['list', 'object'].includes(card.params?.[p]?.type), `${id}: contentParams.${kind} names '${p}', which is no list or object param of the card`);
    }
  }
  assert.ok(declared > 0);
});
