import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {emptyAssembly} from '../src/mechanic-assembly-model.js';
import {addRecoveredPrefab} from '../src/game-system-prefabs.js';
import {extendRecoveredPrefab, selectRecoveredPrefabPhase} from '../src/game-system-phase-extension.js';
import {createVerifiedLifecycleAdapter} from '../src/game-system-lifecycle-adapters.js';
const base = 'research/deep-extraction/resume/legend-of-zelda-the-the-minish-cap/';
const read = path => JSON.parse(fs.readFileSync(new URL('../' + path, import.meta.url)));
const oldGraph = read(base + 'prefab-pass/learned-techniques.assembly.json');
const newGraph = read(base + 'next-round/source-closure-20261016/script-beam-benefit.assembly.json');
const mapping = read(base + 'next-round/source-closure-20261016/phase-integration-v1.json');
const evidence = [base + 'next-round/source-closure-20261016/phase-integration-v1.json'];
export function minishFixture() {
  const first = addRecoveredPrefab(emptyAssembly(), oldGraph, {id: 'existingMinish'});
  // Accepted backing is deliberately nonzero and differs from fixture defaults.
  first.graph.initialize[first.stateMap.inventoryBank][0] = 0xa5;
  first.graph.initialize[first.stateMap.learnedSkills] = 0x800;
  const module = {...first, moduleId: mapping.moduleId, phaseId: 'old'};
  const bindings = Object.fromEntries(Object.keys(newGraph.state).map(name => [name, {new: true}]));
  bindings.inventoryBank = {existingSlot: 'inventoryBank', evidence};
  bindings.skillCache = {existingSlot: 'learnedSkills', evidence};
  const specification = {moduleId: mapping.moduleId, sourceGraph: oldGraph, targetGraph: newGraph,
    sourceVersion: mapping.oldAcceptedGraph.sha256, targetVersion: mapping.newValidatedGraph.sha256,
    sourceGraphRef: mapping.oldAcceptedGraph, targetGraphRef: mapping.newValidatedGraph,
    components: {refresh: {existingComponent: 'derive', evidence}},
    slots: {skillCache: {existingSlot: 'learnedSkills', ownerComponent: 'refresh', policy: 'refresh-before-read', refreshInvocationIndexes: [1, 3], consumerInvocationIndexes: [4], evidence},
      beamEligibility: {ownerComponent: 'eligibility', policy: 'phase-local', evidence}}};
  return {first, module, bindings, specification, options: {existingModule: module, moduleId: module.moduleId, phaseId: 'new', sharedStateBindings: bindings}};
}

function verifySourceGraphFiles(specification) {
  for (const [ref, graph] of [[specification.sourceGraphRef, specification.sourceGraph], [specification.targetGraphRef, specification.targetGraph]]) {
    const bytes = fs.readFileSync(new URL('../' + ref.path, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), ref.sha256, 'source graph file byte digest');
    assert.deepEqual(JSON.parse(bytes), graph, 'source graph parsed snapshot');
  }
}

test('real retained Minish extends with one pinned owner, one bank and one refreshed cache', () => {
  const f = minishFixture();
  verifySourceGraphFiles(f.specification);
  const started = performance.now();
  assert.throws(() => extendRecoveredPrefab(f.first.graph, newGraph, f.options), /phase-owned state/);
  const beforeMs = performance.now() - started;
  const after = performance.now();
  const result = extendRecoveredPrefab(f.first.graph, newGraph, {...f.options, lifecycleAdapter: createVerifiedLifecycleAdapter(f.specification)});
  const extensionMs = performance.now() - after;
  const selected = selectRecoveredPrefabPhase(result.graph, {module: result.module, phaseId: 'new'});
  assert.equal(result.componentMap.refresh, f.first.componentMap.derive);
  assert.equal(result.stateMap.skillCache, f.first.stateMap.learnedSkills);
  assert.equal(selected.state[result.stateMap.skillCache].owner, f.first.componentMap.derive);
  assert.equal(selected.state[result.stateMap.skillCache].shared, true);
  assert.equal(selected.initialize[result.stateMap.skillCache], 0x800);
  assert.equal(selected.initialize[result.stateMap.inventoryBank][0], 0xa5);
  assert.deepEqual(selected.invocations.map(call => call.component), [result.componentMap.scriptFull, f.first.componentMap.derive, result.componentMap.scriptLow, f.first.componentMap.derive, result.componentMap.eligibility]);
  assert.deepEqual(f.first.graph.state[f.first.stateMap.learnedSkills].shared, false);
  const back = selectRecoveredPrefabPhase(selected, {module: result.module, phaseId: 'old'});
  assert.equal(back.state[result.stateMap.beamEligibility], undefined);
  assert.equal(back.initialize[result.stateMap.beamEligibility], undefined);
  assert.equal(back.initialize[result.stateMap.skillCache], 0x800);
  const again = selectRecoveredPrefabPhase(back, {module: result.module, phaseId: 'new'});
  assert.equal(again.initialize[result.stateMap.beamEligibility], undefined);
  assert.deepEqual(again.invocations, selected.invocations);
  const validation = spawnSync('python3', ['-c', 'import sys,json;sys.path.insert(0,"tools/behavior_ir");from assembly import validate;r=validate(json.load(sys.stdin));print(json.dumps({"valid":r["valid"],"errors":r["errors"]}));sys.exit(not r["valid"])'], {input: JSON.stringify(selected), encoding: 'utf8'});
  assert.equal(validation.status, 0, validation.stderr || validation.stdout);
  const execution = spawnSync('python3', ['research/ir-workshop/reusable-pipeline-20261016/phase-lifecycle/execute-minish.py'], {input: JSON.stringify({old: f.first.graph, new: selected, bank: result.stateMap.inventoryBank, cache: result.stateMap.skillCache, result: result.stateMap.beamEligibility, adapter: f.specification}), encoding: 'utf8'});
  assert.equal(execution.status, 0, execution.stderr || execution.stdout);
  console.log(execution.stdout.trim());
  console.log(JSON.stringify({runId: 'minish-phase-lifecycle', beforeRejectedMs: beforeMs, afterExtensionMs: extensionMs, extensionAndValidationMs: performance.now() - after, graphSha256: createHash('sha256').update(JSON.stringify(selected)).digest('hex')}));
});

test('adapter rejects stale identities, incompatible field mapping and unrefreshed consumers', () => {
  const f = minishFixture();
  const fakePins = structuredClone(f.specification); fakePins.sourceGraphRef.sha256 = fakePins.sourceVersion = '0'.repeat(64);
  assert.throws(() => verifySourceGraphFiles(fakePins), /source graph file byte digest/);
  const staleRef = structuredClone(f.specification); staleRef.targetVersion = '0'.repeat(64);
  assert.throws(() => createVerifiedLifecycleAdapter(staleRef), /match declared version digests/);
  const stale = structuredClone(f.specification); stale.targetGraph.components.refresh.package_sha256 = '0'.repeat(64);
  assert.throws(() => createVerifiedLifecycleAdapter(stale), /identical pinned/);
  const wrongOutput = structuredClone(f.specification); delete wrongOutput.targetGraph.invocations[4].result;
  assert.throws(() => createVerifiedLifecycleAdapter(wrongOutput), /captured result before consumption/);
  const badOrder = structuredClone(f.specification); badOrder.slots.skillCache.refreshInvocationIndexes = [1];
  assert.throws(() => createVerifiedLifecycleAdapter(badOrder), /refresh immediately/);
  const badConsumers = structuredClone(f.specification); badConsumers.slots.skillCache.consumerInvocationIndexes = [];
  assert.throws(() => createVerifiedLifecycleAdapter(badConsumers), /every cache consumer/);
  const wrong = structuredClone(f.first.graph); wrong.components[f.first.componentMap.derive].bindings.field_0.slot = f.first.stateMap.inventoryBank;
  assert.throws(() => extendRecoveredPrefab(wrong, newGraph, {...f.options, lifecycleAdapter: createVerifiedLifecycleAdapter(f.specification)}), /differs from pinned lifecycle source/);
});
