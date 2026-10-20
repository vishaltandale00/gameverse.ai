import test from 'node:test';
import assert from 'node:assert/strict';
import {attachCapabilityBundles, gameSystemModuleId} from '../src/game-system-capability-bundles.js';
test('one implementation is discoverable through several roles without promoting source-only facets', () => {
  const plans = [{roles: [{id: 'control', candidates: [{id: 'old-control', sourceSystemId: 'source.player', availability: 'published-subset'}]}, {id: 'terrain', candidates: []}]}];
  const bundles = [{id: 'player', moduleId: 'source.player', existingCandidateIds: ['old-control'], packageIds: ['motion.core'], evidence: ['source.json'], gaps: ['terrain producer remains open'], roleFacets: [{roleId: 'control', status: 'published-subset', scope: 'bounded motion'}, {roleId: 'terrain', status: 'source-only', scope: 'shared grounded admission; map solver still open'}]}];
  attachCapabilityBundles(plans, bundles);
  const [control, terrain] = plans[0].roles.map(role => role.candidates[0]);
  assert.equal(gameSystemModuleId(control), gameSystemModuleId(terrain));
  assert.equal(terrain.availability, 'source-only');
  assert.deepEqual(terrain.packageIds, []);
  assert.equal(terrain.scope, 'shared grounded admission; map solver still open');
  attachCapabilityBundles(plans, bundles);
  assert.equal(plans[0].roles[0].candidates.length, 1);
  assert.equal(plans[0].roles[1].candidates.length, 1);
});
