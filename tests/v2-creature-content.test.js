import test from 'node:test';
import assert from 'node:assert/strict';
import { validate, areaStages, gymOrder, levelCurve } from '../v2/kits/creature/content.js';
import { SAMPLE_CONTENT } from '../v2/kits/creature/fixtures/sample.js';

const codes = r => r.errors.map(e => e.code);

test('the sample creature game validates, with gyms in badge order', () => {
  const r = validate(SAMPLE_CONTENT);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(gymOrder(r.content).map(g => g.id), ['brookside-gym', 'cindertop-gym']);
  assert.equal(areaStages(r.content).get('summit'), 2);
  assert.equal(levelCurve(1), 12);
});

test('validation catches broken references, starter cycles, gym gating and the level curve', () => {
  const broken = structuredClone(SAMPLE_CONTENT);
  broken.species[0].learnset.push({ level: 3, move: 'nope' });
  assert.ok(codes(validate(broken)).includes('ref_move'));

  const starters = structuredClone(SAMPLE_CONTENT);
  starters.starters = ['sproutle', 'bramblet', 'drizzlet'];
  assert.ok(codes(validate(starters)).includes('starter_not_base'));

  const open = structuredClone(SAMPLE_CONTENT);
  open.areas.find(a => a.id === 'brookside').connects.find(c => c.to === 'route-2').gate = undefined;
  assert.ok(codes(validate(open)).includes('gym_order'));

  const strong = structuredClone(SAMPLE_CONTENT);
  strong.areas.find(a => a.id === 'brookside-gym').leader.party[1].level = 30;
  assert.ok(codes(validate(strong)).includes('level_curve'));
});
