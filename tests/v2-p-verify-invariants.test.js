import test from 'node:test';
import assert from 'node:assert/strict';
import { checkInvariants, findNonFinite, playtest, verify, stateHash, runArc, arcScore, levelScore } from '../v2/verify/index.js';
import { maker, hold } from '../v2/verify/drive.js';
import { fixtureCatalogue, normalized, cellDoc, reachPlot, mystery } from './v2-p-verify-fixtures.js';

const cat = fixtureCatalogue();
const walker = (extra = []) => cellDoc({ id: 'inv', size: [6, 6, 1], systems: [{ use: 'gameplay.fixture.step' }, ...extra] });
const inv = (doc, opts = {}) => { const { doc: d } = normalized(doc); return checkInvariants(d, cat.registry, cat.logic, { steps: 40, ...opts }); };
const has = (r, code) => r.problems.some(p => p.code === code);

test('invariants: a clean document passes round-trip and replay with a stable hash', () => {
  const r = inv(walker());
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.equal(r.checks.roundTrip, true);
  assert.equal(r.checks.deterministic, true);
  assert.equal(r.checks.inputsMatter, true);
  assert.equal(inv(walker()).checks.replayHash, r.checks.replayHash, 'same doc + seed + inputs → same hash');
});

test('invariants: each breaker is caught with its stable code', () => {
  assert.ok(has(inv(walker([{ use: 'gameplay.fixture.nan' }])), 'non_finite'));
  assert.ok(has(inv(walker([{ use: 'gameplay.fixture.mathrandom' }])), 'nondeterministic'));
  assert.ok(has(inv(walker([{ use: 'gameplay.fixture.explode' }])), 'entity_explosion'));
  assert.ok(!has(inv(walker([{ use: 'gameplay.fixture.volley' }])), 'entity_explosion'), 'a count that settles (a bullet pattern) is no explosion');
  assert.ok(has(inv(walker([{ use: 'gameplay.fixture.storm' }])), 'event_storm'));
  assert.ok(has(inv(walker([{ use: 'gameplay.fixture.hidden' }])), 'snapshot_roundtrip'));
  assert.ok(has(inv(cellDoc({ id: 'inert' })), 'stuck_state'));
  const nan = inv(walker([{ use: 'gameplay.fixture.nan' }])).problems.find(p => p.code === 'non_finite');
  assert.match(nan.message, /state\.vars\.speed/);
});

test('findNonFinite and stateHash are stable helpers', () => {
  assert.equal(findNonFinite({ a: [1, { b: Infinity }] }), 'state.a[1].b');
  assert.equal(findNonFinite({ a: 1 }), null);
  assert.equal(stateHash({ b: 1, a: 2 }), stateHash({ a: 2, b: 1 }));
  assert.notEqual(stateHash({ a: NaN }), stateHash({ a: null }));
});

test('playtest: Go-Explore reaches a cell-space exit and proves it by replay', () => {
  const { doc } = normalized(cellDoc({ size: [8, 8, 1], solid: [[3, 0, 0], [3, 1, 0], [3, 2, 0], [3, 3, 0], [3, 4, 0], [3, 5, 0]], zones: [{ id: 'exit', rect: [7, 0, 8, 1] }], systems: [{ use: 'gameplay.fixture.step', with: { options: false } }, { use: 'plot.storyboard' }], plot: reachPlot('exit') }));
  const r = playtest(doc, cat.registry, cat.logic, { maxRounds: 3000, seed: 2 });
  assert.equal(r.winnable, true);
  assert.equal(r.win.replayed, true);
  assert.equal(r.exhaustive, false);
  assert.ok(r.explored > 5);
});

test('playtest: trivially won and instantly lost documents are flagged', () => {
  const won = normalized(cellDoc({ zones: [{ id: 'exit', rect: [0, 0, 1, 1] }], systems: [{ use: 'gameplay.fixture.step' }, { use: 'plot.storyboard' }], plot: reachPlot('exit') })).doc;
  assert.ok(playtest(won, cat.registry, cat.logic, { maxRounds: 10 }).problems.some(p => p.code === 'trivially_won'));
  const lost = normalized(cellDoc({ id: 'doomed', size: [6, 6, 1], components: { health: { hp: 1, max: 1 } }, systems: [{ use: 'gameplay.fixture.glide' }, { use: 'gameplay.fixture.bullets', with: { every: 1, row: true, speed: 1 } }] })).doc;
  assert.ok(playtest(lost, cat.registry, cat.logic, { maxRounds: 10 }).problems.some(p => p.code === 'instant_loss'));
});

test('verify: an invariant breaker fails the whole report, with the stage named', async () => {
  const r = await verify(walker([{ use: 'gameplay.fixture.mathrandom' }]), cat.registry, cat.logic, { plot: { maxStates: 200 }, playtest: { maxRounds: 50 } });
  assert.equal(r.ok, false);
  const p = r.problems.find(x => x.code === 'nondeterministic');
  assert.ok(p.stage === 'invariants' || p.stage === 'plot');
});

// ---------- ARC-style benchmark (native track) ----------

const level = (n, exit) => cellDoc({ id: `arc-${n}`, size: [n, n, 1], zones: [{ id: 'goal', rect: [exit[0], exit[1], exit[0] + 1, exit[1] + 1] }], systems: [{ use: 'gameplay.fixture.step' }, { use: 'plot.storyboard' }], plot: reachPlot('goal') });

test('ARC scoring: min(115, (baseline/actions)²·100), weighted by level index', () => {
  assert.equal(levelScore(10, 10, true), 100);
  assert.equal(levelScore(10, 20, true), 25);
  assert.equal(levelScore(10, 5, true), 115, 'capped');
  assert.equal(levelScore(10, 5, false), 0);
  assert.equal(arcScore([{ baseline: 10, actions: 10, solved: true }, { baseline: 10, actions: 20, solved: true }]), 50, '(1·100 + 2·25) / 3');
});

test('ARC harness: the solver plays native grid levels; baselines set the score', () => {
  const levels = [{ doc: level(4, [3, 3]), baseline: 6 }, { doc: level(6, [5, 0]), baseline: 5 }, { doc: level(5, [4, 4]), baseline: 4 }];
  const r = runArc(levels, cat.registry, cat.logic, { allowSpaces: ['engine.space.grid', 'engine.space.test'] });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.levels.map(l => l.actions), [6, 5, 8]);
  assert.deepEqual(r.levels.map(l => l.score), [100, 100, 25]);
  assert.equal(r.score, +((100 + 200 + 3 * 25) / 6).toFixed(2));
  assert.equal(r.track, 'native');
  const pt = runArc(levels.slice(0, 1), cat.registry, cat.logic, { agent: 'playtest', allowSpaces: ['engine.space.test'], maxRounds: 2000 });
  assert.equal(pt.levels[0].solved, true);
  assert.ok(pt.levels[0].actions >= 6);
});

test('ARC harness: only grid-space levels of ARC size are admitted', () => {
  const r = runArc([{ doc: mystery(), baseline: 3 }, { doc: level(4, [3, 3]), baseline: 6 }], cat.registry, cat.logic);
  assert.ok(r.problems.some(p => p.code === 'arc_space' && p.path === 'levels[0].doc.spaces[0]'));
  assert.ok(r.problems.some(p => p.code === 'arc_space' && p.path === 'levels[1].doc.spaces[0]'), 'the test space is not engine.space.grid');
  const big = runArc([{ doc: level(4, [3, 3]), baseline: 6 }], cat.registry, cat.logic, { allowSpaces: ['engine.space.test'], maxCells: 3 });
  assert.ok(big.problems.some(p => p.code === 'arc_size'));
});

test('budgets: playtest frames and rounds bind deterministically', () => {
  const { doc } = normalized(walker());
  const a = playtest(doc, cat.registry, cat.logic, { maxRounds: 40, seed: 5 }), b = playtest(doc, cat.registry, cat.logic, { maxRounds: 40, seed: 5 });
  assert.equal(a.rounds, 40);
  assert.equal(a.budget.limit, 'states');
  assert.equal(a.explored, b.explored);
  const rt = maker(doc, cat.registry, cat.logic)(1); hold(rt, {}, 3);
  assert.equal(rt.state.frame, 3);
});
