import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {createIrApi} from '../scripts/ir-api.mjs';
import {configureRecoveredPrefab} from '../src/game-system-prefabs.js';

const id = 'mzm.enemy.accepted-damage-and-reaction';
const source = 'research/ir-workshop/game-system-assembly-20261016/closure/damage-reaction.assembly.json';
const hash = value => createHash('sha256').update(value).digest('hex');

test('legacy MZM prefab imports current reviewed contracts and preserves configurable runner', async () => {
  const started = performance.now(), frozen = await readFile(source);
  const service = createIrApi();
  async function request(path, input) {
    let status, body;
    const req = input === undefined ? {method: 'GET', headers: {}} : {
      method: 'POST', headers: {host: '127.0.0.1:4173', origin: 'http://127.0.0.1:4173', 'content-type': 'application/json'},
      async *[Symbol.asyncIterator]() {yield Buffer.from(JSON.stringify(input));},
    };
    await service.handle(req, {writeHead(code) {status = code;}, end(value) {body = JSON.parse(value);}}, path);
    assert.equal(status, 200, JSON.stringify(body));
    return body;
  }
  const imported = await request('/api/ir/system-prefabs/' + id);
  assert.equal(imported.ready, true, JSON.stringify(imported.validation?.errors));
  assert.equal(imported.validation.valid, true);
  assert.equal(imported.source.ref, 'research/ir-workshop/game-system-assembly-20261016/closure/damage-reaction-compat-20261016.assembly.json');
  const configured = configureRecoveredPrefab(imported.graph, id, {damage: 7, hp: 20});
  assert.equal(configured.initialize.enemy_hp, 20);
  assert.equal(configured.invocations[0].arguments.param_0.value, 7);
  const configuredAdmission = await request('/api/ir/assembly/validate', configured);
  assert.equal(configuredAdmission.valid, true, JSON.stringify(configuredAdmission.errors));
  const ordinary = await request('/api/ir/systems/mzm-damage-reaction', {damage: 7, hp: 20, ticks: 1});
  assert.equal(ordinary.trace[1].state.enemy_hp, 13);
  assert.equal(ordinary.trace[1].state.hit_lethal, 0);
  assert.equal(ordinary.trace[2].phase, 'eligible_reaction');
  const lethal = await request('/api/ir/systems/mzm-damage-reaction', {damage: 3, hp: 2, ticks: 1});
  assert.equal(lethal.trace[1].state.enemy_hp, 0);
  assert.equal(lethal.trace[1].state.enemy_pose, 98);
  assert.equal(lethal.trace[1].state.hit_lethal, 1);
  assert.equal(hash(await readFile(source)), hash(frozen));
  await writeFile('local/ir/legacy-mzm-compatibility/api-runner-check.json', JSON.stringify({
    outcome: 'pass', legacy_id: id, source: imported.source, original_graph_sha256: hash(frozen),
    configured_admission_wall_s: configuredAdmission.wall_s,
    ordinary: {inputs: ordinary.inputs, timing: ordinary.timing, after_damage: ordinary.trace[1].state},
    lethal: {inputs: lethal.inputs, timing: lethal.timing, after_damage: lethal.trace[1].state},
    wall_s: (performance.now() - started) / 1000,
    scope: 'Actual backend admission and two generated-C host traces; no ROM/native qualification, extraction or game generation.',
  }, null, 2) + '\n');
});
