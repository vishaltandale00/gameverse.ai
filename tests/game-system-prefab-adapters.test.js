import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {emptyAssembly, parseAssembly} from '../src/mechanic-assembly-model.js';
import {addRecoveredPrefab} from '../src/game-system-prefabs.js';

const root = new URL('../', import.meta.url);
const source = JSON.parse(readFileSync(new URL('../research/ir-workshop/reconstruction-interoperability-20261016/minish-input-bridge/input-to-equipped-item.assembly.json', import.meta.url)));

test('authored adapter prefab roundtrip preserves mapping, provenance, ownership and ordered data flow', () => {
  const before = structuredClone(source);
  const first = addRecoveredPrefab(emptyAssembly(), source, {id:'input_bridge'});
  const second = addRecoveredPrefab(first.graph, source, {id:'input_bridge'});
  const graph = parseAssembly(JSON.stringify(second.graph));
  for (const imported of [first, second]) {
    const adapterId = imported.adapterMap.map_buttons;
    const adapter = graph.adapters[adapterId];
    assert.equal(adapter.source_slot, imported.stateMap.actor_field_2);
    assert.equal(adapter.target_slot, imported.stateMap.tmc_held);
    assert.equal(graph.state[adapter.target_slot].owner, adapterId);
    assert.deepEqual(adapter.mapping, source.adapters.map_buttons.mapping);
    assert.deepEqual(adapter.provenance, source.adapters.map_buttons.provenance);
    assert.deepEqual(adapter.source_signature, source.adapters.map_buttons.source_signature);
    assert.deepEqual(adapter.target_signature, source.adapters.map_buttons.target_signature);
    const index = graph.invocations.findIndex(call => call.adapter === adapterId);
    assert.equal(graph.invocations[index-1].component, imported.componentMap.actor_input);
    assert.equal(graph.invocations[index+1].component, imported.componentMap.held_equipped_query);
    assert.equal(graph.invocations[index+1].result.slot, imported.stateMap.query_held);
    assert.equal(Object.hasOwn(graph.invocations[index], 'component'), false);
  }
  assert.notEqual(first.adapterMap.map_buttons, second.adapterMap.map_buttons);
  assert.deepEqual(source, before);
  const checked = spawnSync('python3', ['-c', 'import json,sys;sys.path.insert(0,"tools/behavior_ir");from assembly import validate;r=validate(json.load(sys.stdin));print(json.dumps({"valid":r["valid"],"errors":r["errors"]}));sys.exit(0 if r["valid"] else 1)'], {cwd:root,input:JSON.stringify(graph),encoding:'utf8',timeout:30000});
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
});
