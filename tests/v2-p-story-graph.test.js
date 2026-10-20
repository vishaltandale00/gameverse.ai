// Static plot dependency analysis (v2/primitives/plot/story-graph.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { plotGraph } from '../v2/primitives/plot/story-graph.js';
import { catalog, check, manor, withExitGate } from '../v2/primitives/plot/story-testkit.js';
import { solve } from '../v2/verify/solve.js';

const { logic, registry } = catalog();
const codesOf = (r, sev) => r.problems.filter(p => !sev || p.severity === sev).map(p => p.code);

test('a solvable plot: every ending, quest and beat is reachable and nothing is reported', () => {
  const d = withExitGate(manor());
  assert.ok(check(d).ok, JSON.stringify(check(d).errors));
  const r = plotGraph(d, logic);
  assert.deepEqual(r.reachable.endings, ['truth']);
  assert.deepEqual(codesOf(r, 'error'), []);
  assert.ok(r.nodes.length > 10 && r.edges.length > 10);
  assert.ok(r.edges.some(e => e.from === 'gate:study_door' && e.to === 'edge:hall>study' && e.kind === 'requires'));
  const s = solve(check(d).doc, registry, logic);
  assert.equal(s.completable, true, 'the dynamic solver agrees');
});

test('a circular gate: the key is only behind the door it opens', () => {
  const d = withExitGate(manor());
  d.plot.dialogue.butler_talk.nodes.n1.choices[0].do = [];
  d.plot.storyboard.acts[0].beats[0].do.push({ do: 'give_item', item: 'key' });
  const r = plotGraph(d, logic);
  assert.ok(codesOf(r, 'error').includes('gate_cycle'), JSON.stringify(r.problems));
  assert.ok(codesOf(r, 'error').includes('ending_unreachable'));
  assert.ok(codesOf(r, 'error').includes('plot_uncompletable'));
  const cyc = r.problems.find(p => p.code === 'gate_cycle');
  assert.match(cyc.message, /study_door/);
  assert.equal(cyc.path, 'plot.gates[0]');
  assert.equal(solve(check(d).doc, registry, logic).completable, false, 'the dynamic solver agrees');
});

test('unobtainable items and flags are root causes of unreachable endings', () => {
  const d = withExitGate(manor());
  d.plot.storyboard.acts[0].beats[0].do = [{ do: 'set_flag', flag: 'read' }];
  d.plot.endings.push({ id: 'secret', title: 'Secret', when: { all: [{ flag: 'confessed' }, { zone: 'garden' }] }, epilogue: '.' });
  const r = plotGraph(d, logic);
  const item = r.problems.find(p => p.code === 'item_unobtainable');
  assert.equal(item.severity, 'error'); assert.match(item.message, /letter/);
  assert.equal(item.path, 'plot.quests[0].objectives[0]');
  assert.ok(r.problems.some(p => p.code === 'flag_unobtainable' && /confessed/.test(p.message)));
  assert.deepEqual(r.unreachable.endings.sort(), ['secret', 'truth']);
  assert.ok(r.problems.some(p => p.code === 'quest_uncompletable' && p.severity === 'error'), 'main quest stuck');
});

test('locks on zones/portals, scripted quests, prereq chains, dialogue choices and consumed items', () => {
  const d = withExitGate(manor());
  d.plot.quests.push(
    { id: 'q_side', title: 'Side', kind: 'side', prereq: ['q_read'], objectives: [{ id: 'o', kind: 'deliver', item: 'key', to: 'butler' }] },
    { id: 'q_never', title: 'Never', kind: 'side', offer: 'script', objectives: [{ id: 'o', kind: 'until', when: { flag: 'x' } }] },
  );
  d.plot.endings[0].when = { all: [{ quest: 'q_read', state: 'complete' }, { item: 'key' }, { chose: 'butler_talk', choice: 'n1.0' }] };
  const r = plotGraph(d, logic);
  assert.ok(r.problems.some(p => p.code === 'quest_never_starts' && /q_never/.test(p.message) && p.severity === 'warning'));
  assert.ok(r.problems.some(p => p.code === 'item_consumed_then_required' && /'key'/.test(p.message)), 'the deliver consumes the only key the ending needs');
  assert.deepEqual(r.reachable.endings, ['truth'], 'still reachable: ordering is a warning, not a proof');
  // zone lock on a continuous space
  const z = { ...manor(), spaces: [{ id: 'w', use: 'engine.space.test', zones: [{ id: 'hall', rect: [0, 0, 5, 5] }, { id: 'garden', rect: [5, 0, 9, 5] }, { id: 'study', rect: [9, 0, 12, 5] }] }], player: { archetype: 'detective', space: 'w', at: [1, 1, 0] } };
  z.plot.gates[0].locks = ['zone:study'];
  z.plot.dialogue.butler_talk.nodes.n1.choices[0].do = [];
  const zr = plotGraph(z, logic);
  assert.deepEqual(zr.unreachable.zones, ['study']);
  assert.ok(codesOf(zr, 'error').includes('item_unobtainable'), 'no key anywhere');
});

test('the shipped games: every ending reachable, no circular gates or requirements', () => {
  const summary = {};
  for (const g of ['hollow-lantern', 'emberfall', 'blockport', 'quiet-manor']) {
    const doc = JSON.parse(readFileSync(new URL(`../v2/games/${g}.json`, import.meta.url)));
    const r = plotGraph(doc, logic);
    assert.deepEqual(r.unreachable.endings, [], `${g}: ${JSON.stringify(r.problems.filter(p => p.code === 'ending_unreachable'))}`);
    for (const c of ['gate_cycle', 'dependency_cycle', 'plot_uncompletable']) assert.ok(!codesOf(r).includes(c), `${g}: ${c}`);
    summary[g] = r.problems.filter(p => p.severity === 'error').map(p => p.code);
  }
  // Remaining errors are content gaps (quest items no loot table, pickup or effect provides); see the story report.
  for (const list of Object.values(summary)) for (const c of list) assert.ok(['quest_uncompletable', 'quest_never_starts'].includes(c), c);
});
