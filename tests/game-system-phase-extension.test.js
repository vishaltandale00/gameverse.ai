import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {emptyAssembly} from '../src/mechanic-assembly-model.js';
import {addRecoveredPrefab} from '../src/game-system-prefabs.js';
import {extendRecoveredPrefab, selectRecoveredPrefabPhase} from '../src/game-system-phase-extension.js';

const root = new URL('../', import.meta.url);
const read = name => JSON.parse(fs.readFileSync(new URL(`../research/deep-extraction/source-game-prefabs/sonic-advance/${name}`, import.meta.url)));
const steering = read('air-steering.assembly.json');
const advance = read('air-advance-normal.assembly.json');
const delivery = read('delivery.json');
const moduleId = 'sonic.usa.character_traversal.air_phase';
const steerPhase = delivery.prefabs.find(item => item.id === 'sonic-source-air-steering').phases[0];
const advancePhase = delivery.prefabs.find(item => item.id === 'sonic-source-air-advance').phases[0];
const metadata = JSON.parse(fs.readFileSync(new URL('../research/ir-workshop/game-system-phase-extensions-20261016/sonic.json', import.meta.url)));
const extension = metadata.extensions[0];
const sharedStateBindings = extension.sharedStateBindings;

function installed() {
  const first = addRecoveredPrefab(emptyAssembly(), steering, {id: 'sonic_air'});
  return {first, module: {...first, moduleId, phaseId: steerPhase.id, phase: {...steerPhase, requiredServices: delivery.prefabs[1].requiredServices}}};
}

function extend(input = {}) {
  const {first, module} = installed();
  return {first, result: extendRecoveredPrefab(first.graph, advance, {
    existingModule: module, moduleId, phaseId: advancePhase.id,
    phase: extension.targetPhase,
    sharedStateBindings, id: 'sonic_advance', ...input,
  })};
}

function validate(graph) {
  const check = spawnSync('python3', ['-c', 'import json,sys;sys.path.insert(0,"tools/behavior_ir");from assembly import validate;r=validate(json.load(sys.stdin));print(json.dumps({"valid":r["valid"],"errors":r["errors"]}));sys.exit(0 if r["valid"] else 1)'], {cwd: root, input: JSON.stringify(graph), encoding: 'utf8', timeout: 30000});
  assert.equal(check.status, 0, check.stderr || check.stdout);
}

test('Sonic same-source extension shares live actor backing while retaining distinct callable phase graphs', () => {
  const {first, result} = extend();
  const {graph, stateMap, componentMap, module, phaseTemplates} = result;
  assert.equal(extension.moduleId, moduleId);
  assert.equal(extension.existingPrefabId, 'sonic-source-air-steering');
  assert.equal(extension.targetPrefabId, 'sonic-source-air-advance');
  assert.deepEqual(extension.targetPhase.invocations, advance.invocations.map(call => call.component));
  for (const slot of ['actor_vx', 'actor_vy', 'actor_flags']) {
    assert.equal(stateMap[slot], first.stateMap[slot]);
    assert.equal(graph.initialize[stateMap[slot]], first.graph.initialize[first.stateMap[slot]]);
  }
  assert.notEqual(stateMap.actor_x, first.stateMap.actor_vx);
  assert.equal(phaseTemplates[advancePhase.id].components[componentMap.integrate].bindings.field_2.slot, first.stateMap.actor_vx);
  assert.equal(phaseTemplates[advancePhase.id].components[componentMap.gravity].bindings.field_1.slot, first.stateMap.actor_flags);
  assert.equal(phaseTemplates[advancePhase.id].components[componentMap.integrate].package_sha256, advance.components.integrate.package_sha256);
  assert.deepEqual(graph.invocations, first.graph.invocations);
  assert.deepEqual(phaseTemplates[advancePhase.id].invocations.map(call => call.component), [componentMap.integrate, componentMap.gravity]);
  assert.ok(phaseTemplates[advancePhase.id].requiredServices.some(service => service.id === 'source_world_boundary'));
  assert.equal(graph.services.length, 0);
  const selected = selectRecoveredPrefabPhase(graph, {module, phaseId: advancePhase.id});
  assert.equal(selected.initialize[first.stateMap.actor_vx], first.graph.initialize[first.stateMap.actor_vx]);
  assert.deepEqual(selected.invocations.map(call => call.component), [componentMap.integrate, componentMap.gravity]);
  assert.deepEqual(graph.invocations, first.graph.invocations);
  const back = selectRecoveredPrefabPhase(selected, {module, phaseId: steerPhase.id});
  assert.deepEqual(back.invocations, first.graph.invocations);
  validate(graph);
  validate(selected);
});

test('extension rejects missing or incompatible aliases instead of cloning same-source actor state', () => {
  const {first, module} = installed();
  const options = {existingModule: module, moduleId, phaseId: advancePhase.id,
    phase: extension.targetPhase, sharedStateBindings};
  const run = changes => extendRecoveredPrefab(first.graph, advance, {...options, ...changes});
  assert.throws(() => run({sharedStateBindings: {actor_x: {new: true}}}), /adapter required.*classify every source state/i);
  assert.throws(() => run({sharedStateBindings: {...sharedStateBindings, actor_vx: {new: true}}}), /adapter required.*already belongs/i);
  assert.throws(() => run({sharedStateBindings: {...sharedStateBindings, actor_vx: {existingSlot: 'actor_vx'}}}), /adapter required.*source evidence/i);
  assert.throws(() => run({moduleId: 'different.actor'}), /adapter required.*same canonical moduleId/i);
  const wrong = structuredClone(advance);
  wrong.state.actor_vx.semantic_type.frame = 'screen.x.right';
  assert.throws(() => extendRecoveredPrefab(first.graph, wrong, options), /adapter required.*incompatible storage, semantic or count/i);
  const countMismatch = structuredClone(advance);
  countMismatch.state.actor_vx.count = 2;
  assert.throws(() => extendRecoveredPrefab(first.graph, countMismatch, options), /adapter required.*incompatible storage, semantic or count/i);
  const signedMismatch = structuredClone(advance);
  signedMismatch.state.actor_vx.semantic_type.signed_encoding = 'different-signed-representation';
  assert.throws(() => extendRecoveredPrefab(first.graph, signedMismatch, options), /adapter required.*incompatible storage, semantic or count/i);
  const requiredHost = structuredClone(advance);
  requiredHost.services = ['source_world_boundary'];
  assert.throws(() => extendRecoveredPrefab(first.graph, requiredHost, options), /adapter required.*explicitly supplied by the host/i);
  assert.deepEqual(first.graph, addRecoveredPrefab(emptyAssembly(), steering, {id: 'sonic_air'}).graph);
});

test('phase-owned result storage requires a lifecycle adapter before switching', () => {
  const damage = JSON.parse(fs.readFileSync(new URL('../research/ir-workshop/game-system-assembly-20261016/closure/damage-reaction.assembly.json', import.meta.url)));
  const installedDamage = addRecoveredPrefab(emptyAssembly(), damage, {id: 'damage'});
  assert.equal(installedDamage.graph.state[installedDamage.stateMap.hit_lethal].owner, installedDamage.componentMap.damage);
  const bindings = Object.fromEntries(Object.keys(damage.state).map(slot => [slot, {existingSlot: slot, evidence: ['recorded source alias']}]));
  assert.throws(() => extendRecoveredPrefab(installedDamage.graph, damage, {
    existingModule: {...installedDamage, moduleId: 'mzm.enemy.accepted-damage-and-reaction', phaseId: 'accepted-hit'},
    moduleId: 'mzm.enemy.accepted-damage-and-reaction', phaseId: 'guard-reaction', sharedStateBindings: bindings,
  }), /adapter required.*phase-owned state.*lifecycle adapter/i);
  assert.equal(installedDamage.graph.invocations[0].result.slot, installedDamage.stateMap.hit_lethal);
});

test('choosing a phase preserves unrelated module invocations and captured results', () => {
  const {first, result} = extend();
  const unrelated = structuredClone(result.graph);
  unrelated.components.observer = structuredClone(steering.components.steering);
  unrelated.invocations.push({component: 'observer', arguments: {}, result: {slot: first.stateMap.actor_pose}});
  const selected = selectRecoveredPrefabPhase(unrelated, {module: result.module, phaseId: advancePhase.id});
  assert.equal(selected.invocations.at(-1).component, 'observer');
  assert.deepEqual(selected.invocations.at(-1).result, unrelated.invocations.at(-1).result);
});
