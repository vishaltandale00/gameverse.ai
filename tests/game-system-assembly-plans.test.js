import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {GAME_SYSTEM_PLANS, gameSystemPlan, gameSystemPlanProgress, nextGameSystemRole} from '../src/game-system-assembly-plans.js';
const recovered = JSON.parse(fs.readFileSync(new URL('../ontology/recovered-systems/index.json', import.meta.url))).systems;
const published = JSON.parse(fs.readFileSync(new URL('../ontology/executable-components/index.json', import.meta.url))).entries;
test('plans reference real source systems and published parts without promoting them to complete games', () => {
  for (const plan of GAME_SYSTEM_PLANS) {
    assert.equal(plan.runtimeQualified, false);
    const roleIds = new Set(plan.roles.map(role => role.id));
    for (const edge of plan.dependencies) assert.ok(roleIds.has(edge.from) && roleIds.has(edge.to));
    for (const state of plan.sharedState) assert.ok(roleIds.has(state.owner));
    for (const role of plan.roles) for (const candidate of role.candidates) {
      assert.equal(candidate.runtimeQualified, false);
      assert.ok(candidate.gaps.length);
      if (candidate.availability === 'missing') { assert.deepEqual(candidate.packageIds, []); continue; }
      if (candidate.sourceSystemId) assert.ok(recovered.some(system => system.id === candidate.sourceSystemId), candidate.sourceSystemId);
      else assert.ok(candidate.sourceContractRef && fs.existsSync(new URL(`../${candidate.sourceContractRef}`, import.meta.url)), candidate.id);
      for (const ref of candidate.evidence) assert.ok(fs.existsSync(new URL(`../${ref}`, import.meta.url)), ref);
      for (const id of candidate.packageIds) assert.ok(published.some(record => record.id === id), id);
    }
  }
});
test('choosing every available module never certifies a runtime, and missing roles remain actionable', () => {
  const plan = gameSystemPlan('combat-encounter');
  const selections = Object.fromEntries(plan.roles.map(role => [role.id, role.candidates[0].id]));
  assert.deepEqual(gameSystemPlanProgress(plan, selections), {chosen: 2, required: 4, runtimeQualified: false, canBuildGame: false});
  assert.equal(nextGameSystemRole(plan, selections).id, 'attack');
  assert.equal(gameSystemPlan('unknown'), null);
});
