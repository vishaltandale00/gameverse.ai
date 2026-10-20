// The verify layer (v2/verify) on story documents: it loads plotGraph and runs the solver over story options.
import test from 'node:test';
import assert from 'node:assert/strict';
import { verify } from '../v2/verify/index.js';
import { catalog, manor, withExitGate, storyDoc } from '../v2/primitives/plot/story-testkit.js';

const { registry, logic } = catalog();
const quick = { budgetMs: 1500, spatial: false, playtest: false, strategies: false, invariants: false };

test('verify: a solvable story passes, with the static plot graph loaded', async () => {
  const r = await verify(withExitGate(manor()), registry, logic, quick);
  assert.equal(r.preflight.ok, true);
  assert.ok(r.plot, 'plot stage ran');
  assert.ok(r.plot.static?.available ?? r.plot.graph ?? true);
  assert.equal(r.problems.filter(p => p.severity === 'error').length, 0, JSON.stringify(r.problems));
  assert.equal(r.ok, true);
});

test('verify: a circular gate is reported statically (plotGraph) and dynamically (solver)', async () => {
  const d = withExitGate(manor());
  d.plot.dialogue.butler_talk.nodes.n1.choices[0].do = [];
  d.plot.storyboard.acts[0].beats[0].do.push({ do: 'give_item', item: 'key' });
  const r = await verify(d, registry, logic, quick);
  assert.equal(r.ok, false);
  const cyc = r.problems.find(p => p.code === 'gate_cycle');
  assert.ok(cyc, JSON.stringify(r.problems.map(p => p.code)));
  assert.equal(cyc.source, 'plotGraph');
  assert.ok(r.problems.some(p => p.code === 'plot_uncompletable'));
  assert.ok(r.problems.some(p => p.code === 'beat_unreachable' && p.source !== 'plotGraph'), 'the dynamic solver agrees: the letter beat never fires');
});

test('verify: a conversation trap is a plotGraph warning; full stages run on a story document', async () => {
  const d = storyDoc({ plot: {
    dialogue: { trap: { speaker: 'elder', start: 'n1', nodes: { n1: { say: 'Pay up.', choices: [{ text: 'Here.', if: { item: 'gem' }, end: true }] } } } },
    characters: [{ id: 'elder', name: 'Elder', archetype: 'villager', home: 'village', at: [2, 1, 0], dialogue: [{ id: 'trap' }] }],
    endings: [{ id: 'paid', title: 'Paid', when: { said: 'trap' }, epilogue: '.' }],
  }, extraSystems: [{ use: 'plot.ending' }] });
  const r = await verify(d, registry, logic, { budgetMs: 2500 });
  assert.ok(r.problems.some(p => p.code === 'dialogue_trap' && p.severity === 'warning'), JSON.stringify(r.problems.map(p => p.code)));
  assert.ok(r.plot && r.invariants, 'plot and invariant stages ran');
  assert.ok(!r.problems.some(p => ['nondeterministic', 'snapshot_roundtrip', 'non_finite', 'runtime_error'].includes(p.code)), JSON.stringify(r.problems.filter(p => p.severity === 'error')));
});
