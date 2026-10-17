import test from 'node:test';
import assert from 'node:assert/strict';
import { playableUrl, safeLocalUrl, stageState, runMessage, refinementIntent } from '../src/conversation-model.js';
test('play remains unavailable until backend qualifies a completed candidate', () => {
  const artifact = { url: '/create?play=abc' };
  for (const status of ['building', 'playtesting', 'failed', 'cancelled', 'blocked']) assert.equal(playableUrl({ status, playable: true, artifact }), null);
  assert.equal(playableUrl({ status: 'completed', playable: false, artifact }), null);
  assert.equal(playableUrl({ status: 'completed', playable: true, artifact }), '/create?play=abc');
});
test('returned artifact cannot navigate to arbitrary origins or executable URLs', () => {
  for (const value of ['https://example.com', '//example.com', '/\\example.com', 'javascript:alert(1)', '/\n/example.com']) assert.equal(safeLocalUrl(value), null);
  assert.equal(safeLocalUrl('/mashup-player?id=a%20b'), '/mashup-player?id=a%20b');
});
test('repair status and completion reflect actual run evidence', () => {
  assert.equal(stageState({ status: 'repairing' }, 'building'), 'current');
  assert.equal(stageState({ status: 'playtesting' }, 'planning'), 'done');
  assert.equal(stageState({ status: 'completed', playable: false }, 'completed'), '');
  assert.match(runMessage({ status: 'completed', playable: false }), /not available/);
  assert.equal(runMessage({ status: 'failed', error: { message: 'Toolchain unavailable' } }), 'Toolchain unavailable');
});
test('refinement carries forward original intent', () => {
  assert.equal(refinementIntent('Sonic meets Metroid', 'Make jumps forgiving'), 'Sonic meets Metroid\n\nRefinement: Make jumps forgiving');
});

test('native readiness does not imply that the bot objective or campaign was verified', () => {
  assert.match(runMessage({ status: 'completed', playable: true, objective_validated: false }), /Bot objective incomplete/);
  assert.match(runMessage({ status: 'completed', playable: true, objective_validated: true }), /bot objective was verified/);
  assert.equal(runMessage({ status: 'repairing' }), 'Inspecting native observations for a supported repair.');
});
test('graphics consumer qualification never claims bot or complete conversion from partial coverage',()=>{
 const run={status:'completed',playable:true,routing:{backend:'pokemon-overworld'},qualification:{outcome:'pass',scope:'native-graphics-consumer'},objective_validated:false};
 assert.match(runMessage(run),/mapped sprites/);assert.match(runMessage(run),/remains incomplete/);assert.doesNotMatch(runMessage(run),/bot objective/);
 assert.match(runMessage({...run,objective_validated:true}),/graphics change passed native checks/);
});
