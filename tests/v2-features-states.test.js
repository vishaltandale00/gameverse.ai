// Feature checks press controls only from states a person can still act in (v2/verify/features.js): a state the play
// ended in (won, lost, neutral) takes no input, so pressing from it shows nothing, and the explorer's sample keeps such
// states. Over every template: adding the ended copy of a reached state never changes the feature table, and the story
// template's deduction, offered in an ended state, is not reported inert because of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, templateById } from '../v2/templates/registry.js';
import { liveCatalogue } from '../v2/planner/catalog.js';
import { hostPreflight, controlledMaker } from '../v2/verify/controls.js';
import { featureChecks } from '../v2/verify/features.js';

const { registry, logic } = await liveCatalogue();
const FEW = { frames: 20, maxStates: 12, stepsPerVerb: 4000 };
const ended = (rt, outcome) => { rt.run([{ do: 'end_game', outcome }]); return rt.snapshot(); };

test('every template: an ended state among the reached states leaves the feature table as it is', () => {
  for (const t of TEMPLATES) {
    const host = hostPreflight(t.doc, registry, logic);
    assert.ok(host.ok, `${t.id}: host document preflights`);
    const make = controlledMaker(host.doc, registry, logic), rt = make(1);
    for (let i = 0; i < 30 && rt.state.status === 'playing'; i++) rt.step({});
    const reached = rt.snapshot(), over = ended(rt, 'neutral');
    const a = featureChecks(host.doc, registry, make, { states: [reached], ...FEW }), b = featureChecks(host.doc, registry, make, { states: [reached, over], ...FEW });
    assert.deepEqual(b.table, a.table, `${t.id}: an ended state changed the feature table`);
  }
});

test('story: a deduction offered in an ended state is not pressed there (no feature_inert)', () => {
  const t = templateById('story'), host = hostPreflight(t.doc, registry, logic), make = controlledMaker(host.doc, registry, logic), rt = make(1);
  for (const id of ['boot_prints', 'salvage_money', 'cut_wick', 'logbook']) rt.run([{ do: 'add_clue', clue: id }]);
  assert.ok(rt.availableOptions().some(o => o.actions?.deduce), 'deductions are offered once their clues are found');
  const r = featureChecks(host.doc, registry, make, { states: [ended(rt, 'neutral')], ...FEW });
  assert.deepEqual(r.problems.filter(p => p.verb === 'deduce' && p.code === 'feature_inert'), []);
});
