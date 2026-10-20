import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FLEET_CAPABILITY_BUNDLES, GAME_RECONSTRUCTION_MAPS } from '../src/game-system-fleet-deliveries.js';
import { retainProofs, render, snapshotRef } from '../scripts/register-game-system-deliveries.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(root, 'ontology/game-system-prefabs/manifest.json')));
const registry = JSON.parse(readFileSync(resolve(root, 'ontology/game-system-prefabs/deliveries.json')));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('registered prefab bytes and delivery descriptors match the published allowlist', () => {
  assert.equal(manifest.schema, 'gameverse.prefab-allowlist/1');
  assert.equal(registry.schema, 'gameverse.game-prefab-deliveries/1');
  assert.equal(GAME_RECONSTRUCTION_MAPS.length, registry.deliveries.length);
  const ids = new Set();
  for (const item of manifest.prefabs) {
    assert.ok(!ids.has(item.id), `duplicate ${item.id}`);
    ids.add(item.id);
    assert.equal(sha(readFileSync(resolve(root, item.path))), item.sha256);
    assert.ok(JSON.parse(readFileSync(resolve(root, item.validation))).valid);
    assert.ok(registry.deliveries.some(entry => entry.ref === item.descriptorRef));
    assert.ok(FLEET_CAPABILITY_BUNDLES.some(bundle => bundle.moduleId === item.moduleId && [bundle.recoveredAssembly, ...(bundle.recoveredAssemblies || []), ...(bundle.assemblyVariants || [])].some(assembly => assembly?.id === item.id && assembly.readyToAdd)));
  }
  for (const bundle of FLEET_CAPABILITY_BUNDLES) {
    if (bundle.recoveredAssembly?.readyToAdd) assert.ok(ids.has(bundle.recoveredAssembly.id));
    for (const facet of bundle.roleFacets) assert.ok(['published-subset', 'source-only', 'missing'].includes(facet.status));
  }
  for (const map of GAME_RECONSTRUCTION_MAPS) {
    assert.equal(map.coreLoop.wholeGameReady, false);
    for (const phase of map.coreLoop.phases) if (phase.status !== 'usable-prefab') assert.deepEqual(phase.prefabIds, []);
  }
});

test('fresh Composer proof is retained immutably and registry hash points to retained bytes', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'gameverse-proof-test-'));
  try {
    const ref = `ontology/game-system-prefabs/registration-proofs/${'a'.repeat(64)}.json`;
    const result = { schema: 'gameverse.mechanic-assembly-validation/0.1', valid: true, request_sha256: 'request', validator_sha256: 'validator', catalog_sha256: 'catalog', statement_sha256: 'statement', interfaces: { actor: { package_id: 'pkg', package_sha256: 'package', behavior_sha256: 'behavior' } }, wall_s: 0.01 };
    const proof = { ref, bytes: Buffer.from(JSON.stringify(result)), requestSha256: 'request', validatorSha256: 'validator', catalogSha256: 'catalog' };
    const checks = [{ statementSha256: 'statement', currentInterfacePins: { actor: { packageId: 'pkg', packageSha256: 'package', behaviorSha256: 'behavior' } } }];
    const entries = [{ ref: 'delivery', validationChecks: checks }];
    retainProofs([{ ref: 'delivery', proofs: [proof] }], entries, directory);
    const retained = readFileSync(resolve(directory, `${'a'.repeat(64)}.json`));
    assert.equal(checks[0].currentReceiptSha256, sha(retained));
    const later = { ...proof, bytes: Buffer.from(JSON.stringify({ ...result, wall_s: 0.02 })) };
    retainProofs([{ ref: 'delivery', proofs: [later] }], entries, directory);
    assert.deepEqual(readFileSync(resolve(directory, `${'a'.repeat(64)}.json`)), retained);
    assert.equal(checks[0].currentReceiptSha256, sha(retained));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('one canonical bundle exposes accepted graph variants through an immutable descriptor', () => {
  const sourceRef = 'research/deep-extraction/example/delivery.json';
  const moduleId = 'example.canonical-actor';
  const descriptor = id => ({ id, assemblyRef: `${id}.assembly.json`, validationRef: `${id}.validation.json`, descriptorRef: sourceRef, readyToAdd: false });
  const delivery = {
    gameId: 'example', blueprintIds: ['character-traversal'],
    coreLoop: { wholeGameReady: false, phases: [] },
    prefabs: ['phase-a', 'phase-b', 'phase-c'].map(id => ({ id, moduleId, path: `${id}.assembly.json`, sha256: 'graph', validation: `${id}.validation.json`, validationSha256: 'receipt', qualificationScope: 'binding only' })),
    bundles: [{ id: 'one-module', moduleId, roleFacets: [{ roleId: 'terrain', status: 'source-only' }], recoveredAssembly: descriptor('phase-a'), recoveredAssemblies: [descriptor('phase-a'), descriptor('phase-b')], assemblyVariants: [descriptor('phase-c')] }],
  };
  const bytes = Buffer.from(JSON.stringify(delivery));
  const digest = sha(bytes), ref = snapshotRef(digest);
  const { manifest: output, module } = render([{ sourceRef, ref, sha256: digest }], new Map([[ref, bytes]]));
  assert.equal(output.prefabs.length, 3);
  assert.ok(output.prefabs.every(item => item.moduleId === moduleId && item.descriptorRef === ref));
  assert.match(module, /"sourceRef": "research\/deep-extraction\/example\/delivery.json"/);
  assert.match(module, /"roleId": "terrain",\n\s+"status": "source-only"/);
  assert.equal((module.match(/"readyToAdd": true/g) || []).length, 4); // singular plus three array entries
});
