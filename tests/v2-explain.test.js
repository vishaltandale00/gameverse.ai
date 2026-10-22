// A failed build or change is said to a person in plain words (v2/planner/explain.js): the reason, with the game's own
// goal where it is about the goal; the codes and technical messages stay in the report.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { preflight } from '../v2/kernel/document.js';
import { templateById } from '../v2/templates/registry.js';
import { explainProblems } from '../v2/planner/explain.js';
import { gateError, GATE_CODES } from '../v2/planner/version-gate.js';

const { registry, logic } = buildCatalogue();
/** Words a person never reads: codes, paths, ids. */
const ID = /[a-z]+_[a-z_]+|\$|\bundefined\b|\[\d|\.[a-z]/;

test('the change that blocked a race track says so in plain words, with the race\'s goal', () => {
  const doc = preflight(structuredClone(templateById('race').doc), registry, logic).doc;
  // The gate's failure for "can I have ramps" (the ramps were written as solid walls across the track).
  const g = { ok: false, stage: 'gate', doc, problems: [{ stage: 'gate', code: 'not_playable', path: '$', message: 'no_progress: no win was seen and the win quantity (event lap (player)) never moved toward the win beyond idling (idle 0, play 0)' }] };
  const e = gateError(g, 'That change', { registry });
  assert.match(e.message, /^That change wasn't published\. Playing it, nobody got any closer to the goal \(Finish \d+ laps first\)/);
  assert.doesNotMatch(e.message, ID, e.message);
  assert.equal(e.report.problems[0].code, 'not_playable', 'the report keeps the codes');
});

test('every gate stage code and every viability reason has a plain sentence, free of codes and ids', () => {
  const codes = [...Object.values(GATE_CODES).flat(), 'no_progress', 'loop_absent', 'loop_undeclared', 'not_played', 'plot_uncompletable', 'cannot_act', 'bot_failed', 'runtime_error',
    'trivially_won', 'instant_loss', 'nondeterministic', 'feature_inert', 'feature_uncontrolled', 'feature_missing', 'feature_content_empty', 'feature_participant_absent', 'option_uncontrolled',
    'render_missing', 'shows_undeclared', 'extension_missing', 'extension_unusable', 'extension_unengaged', 'budget_limited'];
  for (const code of codes) {
    const s = explainProblems([{ code, message: code === 'extension_missing' ? '"slide on ice" (extra) is still missing' : `pressing 'cycle' produced nothing`, verb: 'cycle' }]);
    assert.ok(s && s !== 'It did not pass the checks.', `${code}: has a sentence`);
    assert.doesNotMatch(s, ID, `${code}: ${s}`);
  }
  // Several reasons of one not_playable, each said once.
  const s = explainProblems([{ code: 'not_playable', message: 'loop_absent: none of the loop events happened; no_progress: no win was seen' }]);
  assert.match(s, /main action never happened/); assert.match(s, /closer to the goal/);
});
