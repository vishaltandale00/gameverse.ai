import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {emptyAssembly} from '../src/mechanic-assembly-model.js';
import {addRecoveredPrefab, configureRecoveredPrefab} from '../src/game-system-prefabs.js';
const root = new URL('../', import.meta.url);
const prefab = JSON.parse(fs.readFileSync(new URL('../research/ir-workshop/game-system-assembly-20261016/progression/learning.assembly.json', import.meta.url)));
test('adding learning prefab preserves shared bank, pinned components, repeated phases and captured result', () => {
  const original = emptyAssembly();
  const result = addRecoveredPrefab(original, prefab, {id: 'learned-sword'});
  const {graph, componentMap: c, stateMap: s} = result;
  assert.equal(graph.components[c.transaction].collection_bindings.collection_0, s.inventory);
  assert.equal(graph.components[c.refresh].collection_bindings.dependency_0_collection_0, s.inventory);
  assert.equal(graph.components[c.transaction].package_sha256, prefab.components.transaction.package_sha256);
  assert.deepEqual(graph.invocations.map(call => call.component), [c.transaction, c.refresh, c.transaction, c.refresh, c.held]);
  assert.equal(graph.invocations.at(-1).result.slot, s.held_result);
  assert.deepEqual(graph.initialize[s.inventory], prefab.initialize.inventory);
  assert.equal(graph.state[s.held_result].owner, c.held);
  const again = addRecoveredPrefab(graph, prefab, {id: 'learned-sword'});
  assert.notEqual(again.stateMap.inventory, s.inventory);
  assert.equal(Object.keys(again.graph.components).length, 6);
  assert.deepEqual(original, emptyAssembly());
});
test('configured one-click prefabs pass actual Composer symbolic binding validation', () => {
  const mzm = JSON.parse(fs.readFileSync(new URL('../research/ir-workshop/game-system-assembly-20261016/closure/damage-reaction-compat-20261016.assembly.json', import.meta.url)));
  const prefabs = [
    [prefab, 'tmc.learned_sword_charge_release', {baseLearned: false, fastLearned: true}],
    [mzm, 'mzm.enemy.accepted-damage-and-reaction', {hp: 9, damage: 4}],
  ];
  for (const [recorded, id, configuration] of prefabs) {
    const configured = configureRecoveredPrefab(recorded, id, configuration);
    const {graph} = addRecoveredPrefab(emptyAssembly(), configured, {id});
    const check = spawnSync('python3', ['-c', 'import json,sys;sys.path.insert(0,"tools/behavior_ir");from assembly import validate;r=validate(json.load(sys.stdin));print(json.dumps({"valid":r["valid"],"errors":r["errors"]}));sys.exit(0 if r["valid"] else 1)'], {cwd: root, input: JSON.stringify(graph), encoding: 'utf8', timeout: 30000});
    assert.equal(check.status, 0, check.stderr || check.stdout);
    assert.equal(JSON.parse(check.stdout).valid, true);
  }
});

test('learning prefab controls change learned-state entry inputs while preserving explicit refresh', () => {
  const configured = configureRecoveredPrefab(prefab, 'tmc.learned_sword_charge_release', {baseLearned: false, fastLearned: true});
  assert.equal(configured.invocations[0].arguments.param_1.value, 0);
  assert.equal(configured.invocations[2].arguments.param_1.value, 1);
  assert.deepEqual(configured.invocations.filter(item => item.component === 'refresh'), prefab.invocations.filter(item => item.component === 'refresh'));
  assert.equal(prefab.invocations[0].arguments.param_1.value, 1);
  assert.throws(() => configureRecoveredPrefab(prefab, 'tmc.learned_sword_charge_release', {baseLearned: 2}), /true or false/);
  assert.throws(() => configureRecoveredPrefab(prefab, 'mzm.enemy.accepted-damage-and-reaction', {hp: -1}), /u16/);
});

test('reconfiguring one added prefab preserves the other prefab instance and its source inputs', () => {
  const first = addRecoveredPrefab(emptyAssembly(), prefab, {id: 'learning'});
  const second = addRecoveredPrefab(first.graph, prefab, {id: 'learning'});
  const changed = configureRecoveredPrefab(second.graph, 'tmc.learned_sword_charge_release', {baseLearned: false}, first);
  const firstCall = changed.invocations.find(call => call.component === first.componentMap.transaction);
  const secondCall = changed.invocations.find(call => call.component === second.componentMap.transaction);
  assert.equal(firstCall.arguments.param_1.value, 0);
  assert.equal(secondCall.arguments.param_1.value, 1);
});

test('additional acquisition, protection-query and geometry prefabs preserve valid bindings after import', () => {
  for (const stem of ['aria-category0', 'aria-category1', 'aria-category2', 'aria-category3', 'wario-protection', 'tekken-geometry']) {
    const recorded = JSON.parse(fs.readFileSync(new URL(`../research/ir-workshop/game-system-assembly-20261016/combat-progression-bundles/${stem}.assembly.json`, import.meta.url)));
    const {graph} = addRecoveredPrefab(emptyAssembly(), recorded, {id: stem});
    const check = spawnSync('python3', ['-c', 'import json,sys;sys.path.insert(0,"tools/behavior_ir");from assembly import validate;r=validate(json.load(sys.stdin));print(json.dumps({"valid":r["valid"],"errors":r["errors"]}));sys.exit(0 if r["valid"] else 1)'], {cwd: root, input: JSON.stringify(graph), encoding: 'utf8', timeout: 30000});
    assert.equal(check.status, 0, `${stem}: ${check.stderr || check.stdout}`);
  }
});
