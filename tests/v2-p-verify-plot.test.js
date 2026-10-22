import test from 'node:test';
import assert from 'node:assert/strict';
import { verify, solve, staticPlot, beatStructure, verifySpatial, movementEnvelope, abstraction, PROBLEM_CODES } from '../v2/verify/index.js';
import { fixtureCatalogue, normalized, mystery, cellDoc, reachPlot } from './v2-p-verify-fixtures.js';

const codes = r => r.problems.map(p => p.code);
const cat = fixtureCatalogue();

test('verify: a sound document passes every stage with one report', async () => {
  const r = await verify(mystery(), cat.registry, cat.logic, { budgetMs: 3000 });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.equal(r.preflight.ok, true);
  assert.deepEqual(r.plot.endings.truth, ['go garden', 'go hall', 'go library']);
  assert.equal(r.exhaustive.plot, true);
  assert.equal(r.playtest.winnable, true);
  assert.equal(r.playtest.win.replayed, true);
  assert.equal(r.invariants.checks.deterministic, true);
  for (const k of ['preflight', 'plot', 'spatial', 'playtest', 'strategies', 'invariants', 'total']) assert.equal(typeof r.timings[k], 'number', k);
});

test('verify: preflight errors stop the pipeline with stable codes and paths', async () => {
  const bad = mystery();
  bad.spaces[0].zones[0].exits.push({ to: 'attic' });
  const r = await verify(bad, cat.registry, cat.logic);
  assert.equal(r.ok, false);
  assert.equal(r.plot, null);
  const p = r.problems.find(x => x.code === 'ref_unknown');
  assert.equal(p.path, 'spaces[0].zones[0].exits[2].to');
  assert.equal(p.severity, 'error');
  assert.equal(p.stage, 'preflight');
});

test('verify: a softlocked plot reports exhaustive, path-addressed problems', async () => {
  const broken = mystery();
  broken.spaces[0].zones[1].exits = []; // the garden is a trap
  broken.plot.endings.push({ id: 'escape' });
  const r = await verify(broken, cat.registry, cat.logic, { budgetMs: 3000, playtest: { maxRounds: 300 } });
  assert.equal(r.ok, false);
  for (const c of ['plot_uncompletable', 'beat_unreachable', 'softlock']) assert.ok(codes(r).includes(c), c);
  const beat = r.problems.find(p => p.code === 'beat_unreachable' && p.path === 'plot.storyboard.acts[1].beats[2]');
  assert.ok(beat, 'beat solve is addressed by path');
  assert.equal(r.problems.find(p => p.code === 'plot_uncompletable').severity, 'error');
  assert.deepEqual(r.problems.find(p => p.code === 'softlock').repro, ['go garden']);
  for (const p of r.problems) { assert.ok(PROBLEM_CODES[p.code] || /_unreachable$/.test(p.code), `documented code ${p.code}`); assert.ok(p.path && p.message && p.severity); }
});

test('solver: bfs, best-first and iddfs agree on the shortest ending; iddfs is exhaustive', () => {
  const { doc } = normalized(mystery());
  const bfs = solve(doc, cat.registry, cat.logic);
  const best = solve(doc, cat.registry, cat.logic, { search: 'best-first' });
  const iddfs = solve(doc, cat.registry, cat.logic, { search: 'iddfs' });
  assert.deepEqual(bfs.endings.truth, ['go garden', 'go hall', 'go library']);
  assert.equal(best.completable, true);
  assert.deepEqual(iddfs.endings.truth, bfs.endings.truth);
  assert.equal(iddfs.exhaustive, true);
  assert.equal(bfs.replayed, true);
});

test('solver: budgets are honest — a state cap reports a non-exhaustive search', () => {
  const doc = normalized(cellDoc({ size: [12, 12, 1], zones: [{ id: 'exit', rect: [11, 11, 12, 12] }], systems: [{ use: 'gameplay.fixture.step' }, { use: 'plot.storyboard' }], plot: reachPlot('exit') })).doc;
  const capped = solve(doc, cat.registry, cat.logic, { maxStates: 10 });
  assert.equal(capped.exhaustive, false);
  assert.equal(capped.budget.limit, 'states');
  const full = solve(doc, cat.registry, cat.logic, { maxStates: 1000 });
  assert.equal(full.completable, true);
  assert.equal(full.endings.out.length, 22, 'manhattan shortest path to the far corner');
});

test('solver: primitive solverKey shapes the abstraction (dedup) ', () => {
  const plot = reachPlot('exit');
  const mk = keyed => normalized(cellDoc({ size: [4, 4, 1], zones: [{ id: 'exit', rect: [3, 3, 4, 4] }], systems: [{ use: 'gameplay.fixture.step' }, { use: 'gameplay.fixture.clock', with: { keyed } }, { use: 'plot.storyboard' }], plot })).doc;
  const keyed = solve(mk(true), cat.registry, cat.logic, { maxStates: 500 });
  const raw = solve(mk(false), cat.registry, cat.logic, { maxStates: 500 });
  assert.ok(abstraction(mk(true), cat.registry).declared.includes('gameplay.fixture.clock'), 'the fixture declares a key (plot primitives may declare theirs too)');
  assert.equal(keyed.exhaustive, true, 'a constant key collapses the clock');
  assert.ok(keyed.states < 20);
  assert.equal(raw.exhaustive, false, 'without abstraction every frame is a new state');
});

test('solver: macro options with apply(rt) are searched like any option', () => {
  const doc = normalized(cellDoc({ size: [10, 10, 1], solid: [[5, 0, 0], [5, 1, 0], [5, 2, 0], [5, 3, 0]], zones: [{ id: 'camp', rect: [0, 0, 2, 2] }, { id: 'tower', rect: [9, 0, 10, 2] }], systems: [{ use: 'gameplay.fixture.travel' }, { use: 'plot.storyboard' }], plot: reachPlot('tower'), at: [0, 0, 0] })).doc;
  const r = solve(doc, cat.registry, cat.logic);
  assert.deepEqual(r.endings.out, ['travel tower']);
  assert.equal(r.replayed, true);
});

test('static plot checks: beat cycles and later-act prerequisites; plotGraph is feature-detected', async () => {
  const doc = mystery();
  doc.plot.storyboard.acts[1].beats[0].after = ['find_letter']; // find_letter waits on find_key: a cycle
  doc.plot.storyboard.acts[0].beats[0].after = ['find_key'];
  const found = beatStructure(doc, cat.registry).map(p => p.code);
  assert.ok(found.includes('beat_cycle'));
  assert.ok(found.includes('beat_order'));
  const st = await staticPlot(doc, cat.registry, cat.logic);
  assert.equal(typeof st.available, 'boolean');
  assert.ok(st.problems.some(p => p.code === 'beat_cycle' && p.path.startsWith('plot.storyboard.acts[')));
});

test('spatial: gate order — the gated zone becomes reachable only after its key beat', () => {
  const { doc } = normalized(mystery());
  const plot = solve(doc, cat.registry, cat.logic);
  const s = verifySpatial(doc, cat.registry, cat.logic, { plot });
  assert.equal(s.order, 'critical-path');
  const at = id => s.targets.find(t => t.id === id).firstStage;
  assert.equal(at('hall'), 0);
  assert.equal(at('garden'), 0);
  assert.ok(at('library') >= 1, 'library opens after the key');
  assert.deepEqual(s.problems.filter(p => p.severity !== 'info'), []);
});

test('spatial: a bypassed gate and an unreachable plot target are reported with paths', () => {
  const doc = mystery();
  doc.spaces[0].zones[1].exits.push({ to: 'library' }); // garden → library skips the locked door
  doc.spaces[0].zones.push({ id: 'vault', exits: [] });
  doc.plot.storyboard.acts[1].beats.push({ id: 'open_vault', optional: true, when: { zone: 'vault' }, do: [] });
  const n = normalized(doc);
  const s = verifySpatial(n.doc, cat.registry, cat.logic, { plot: solve(n.doc, cat.registry, cat.logic) });
  const bypass = s.problems.find(p => p.code === 'gate_bypassed');
  assert.equal(bypass.path, 'spaces[0].zones[0].exits[1]');
  const vault = s.problems.find(p => p.code === 'target_unreachable');
  assert.equal(vault.path, 'spaces[0].zones[3]');
  assert.match(vault.message, /plot\.storyboard\.acts\[1\]\.beats\[3\]/);
});

test('spatial: movement envelopes merge and ability unlocks open ledges in gate order', () => {
  const plot = {
    storyboard: { acts: [{ id: 'a', beats: [
      { id: 'learn', when: { zone: 'dojo' }, do: [{ do: 'unlock_ability', ability: 'high_jump' }] },
      { id: 'climb', after: ['learn'], when: { zone: 'ledge' }, do: [{ do: 'end_game', ending: 'top' }] },
    ] }] },
    endings: [{ id: 'top' }],
  };
  const base = { size: [5, 6, 1], space: 'engine.space.fixture-ledge', spaceWith: { ledgeY: 3 }, zones: [{ id: 'dojo', rect: [4, 0, 5, 1] }, { id: 'ledge', rect: [0, 5, 5, 6] }], plot };
  const n = normalized(cellDoc({ ...base, systems: [{ use: 'gameplay.fixture.abilities', with: { abilities: [{ id: 'high_jump' }] } }, { use: 'gameplay.fixture.step' }, { use: 'plot.storyboard' }] }));
  assert.deepEqual(movementEnvelope(n.doc, cat.registry, new Set()).envelope, { run: 1, jumpHeight: 1 });
  assert.equal(movementEnvelope(n.doc, cat.registry, new Set(['high_jump'])).envelope.jumpHeight, 5);
  const r = solve(n.doc, cat.registry, cat.logic, { maxStates: 2000 });
  assert.equal(r.completable, true);
  const s = verifySpatial(n.doc, cat.registry, cat.logic, { plot: r });
  const ledge = s.targets.find(t => t.id === 'ledge');
  assert.ok(ledge.firstStage > 0, 'ledge is out of reach until the ability');
  assert.equal(s.envelopeSources, 1);
  assert.equal(s.problems.filter(p => p.severity !== 'info').length, 0);
});

test('verify: determinism — the same document and seed give the same report', async () => {
  const a = await verify(mystery(), cat.registry, cat.logic, { seed: 3, playtest: { maxRounds: 200 } });
  const b = await verify(mystery(), cat.registry, cat.logic, { seed: 3, playtest: { maxRounds: 200 } });
  assert.deepEqual(a.problems, b.problems);
  assert.equal(a.invariants.checks.replayHash, b.invariants.checks.replayHash);
  assert.deepEqual(a.playtest.win, b.playtest.win);
});

test('static plot: an injected plotGraph contributes its problems (feature-detected shape)', async () => {
  const plotGraph = () => ({ nodes: [{ id: 'truth', kind: 'ending' }], edges: [], problems: [{ severity: 'error', code: 'item_unobtainable', path: 'content.items[1]', message: 'nothing gives letter' }], approximation: 'optimistic-monotone' });
  const st = await staticPlot(mystery(), cat.registry, cat.logic, { plotGraph });
  assert.equal(st.available, true);
  assert.equal(st.graph.nodes, 1);
  const p = st.problems.find(x => x.code === 'item_unobtainable');
  assert.equal(p.source, 'plotGraph');
  const r = await verify(mystery(), cat.registry, cat.logic, { plot: { plotGraph }, playtest: { maxRounds: 50 } });
  assert.ok(r.problems.some(x => x.code === 'item_unobtainable' && x.stage === 'plot'));
});

test('spatial: declared places (card.defines … in) and interactables behind walls are reported', () => {
  const doors = { id: 'gameplay.fixture.doors', card: { intent: 'test: doors defined in config', params: { portals: { type: 'json', default: [] } }, defines: [{ kind: 'portal', in: 'portals' }] } };
  const c = fixtureCatalogue([doors]);
  const wall = [[4, 0, 0], [4, 1, 0], [4, 2, 0], [4, 3, 0], [4, 4, 0], [4, 5, 0]];
  const doc = cellDoc({ size: [6, 6, 1], solid: wall, zones: [{ id: 'yard', rect: [0, 0, 4, 6] }, { id: 'vault', rect: [5, 0, 6, 6] }], systems: [{ use: 'gameplay.fixture.step' }, { use: 'gameplay.fixture.spawn', with: { entities: [{ archetype: 'lever', id: 'lever', at: [5, 2, 0], components: { interact: {} } }, { archetype: 'lever', id: 'switch', at: [1, 1, 0], components: { interact: {} } }] } }, { use: 'gameplay.fixture.doors', with: { portals: [{ id: 'hatch', from: { at: [5, 5, 0] } }, { id: 'gate', from: { zone: 'yard' } }] } }] });
  const n = normalized(doc, c);
  const s = verifySpatial(n.doc, c.registry, c.logic, {});
  assert.equal(s.order, 'start-only');
  assert.ok(s.problems.some(p => p.code === 'zone_unreachable' && p.path === 'spaces[0].zones[1]'));
  assert.ok(s.problems.some(p => p.code === 'portal_unreachable' && p.path === 'systems[2].with.portals[0]'));
  assert.ok(!s.problems.some(p => p.path === 'systems[2].with.portals[1]'), 'the yard gate is reachable');
  assert.equal(s.entities.lever, null);
  assert.equal(s.entities.switch, 0);
  assert.ok(s.problems.some(p => p.code === 'entity_unreachable' && /lever/.test(p.message) && p.path === 'systems[1].with'));
});

test('solver: an ending reached with outcome lost does not make the plot completable', () => {
  const plot = { storyboard: { acts: [{ id: 'a', beats: [{ id: 'fall', when: { zone: 'pit' }, do: [{ do: 'end_game', ending: 'doom', outcome: 'lost' }] }] }] }, endings: [{ id: 'doom' }, { id: 'escape' }] };
  const { doc } = normalized(cellDoc({ size: [3, 1, 1], zones: [{ id: 'pit', rect: [2, 0, 3, 1] }], systems: [{ use: 'gameplay.fixture.step' }, { use: 'plot.storyboard' }], plot }));
  const r = solve(doc, cat.registry, cat.logic);
  assert.equal(r.outcomes.doom, 'lost');
  assert.equal(r.completable, false);
  assert.equal(r.exhaustive, true);
});

test('the quiet-manor example document verifies clean on the real catalogue', async () => {
  const { readFileSync } = await import('node:fs');
  const { catalogue } = await import('../v2/primitives/index.js');
  const c = catalogue();
  const doc = JSON.parse(readFileSync(new URL('../v2/games/quiet-manor.json', import.meta.url)));
  const r = await verify(doc, c.registry, c.logic, { playtest: { maxRounds: 300 } });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.equal(r.plot.completable, true);
});

test('solve: a state without options while the board resolves is waited on, not a dead end', async () => {
  const { buildCatalogue } = await import('../v2/planner/catalog.js');
  const { preflight } = await import('../v2/kernel/document.js');
  const { registry, logic } = buildCatalogue();
  // A match board animates each swap (swap, clear and settle frames): no swap is offered until the board is stable again.
  const doc = { schema: 'gameverse.v2.game/0.2', id: 'm', title: 'm', seed: 3, spaces: [{ id: 'g', use: 'engine.space.grid', with: { size: [6, 6] } }],
    systems: [{ use: 'gameplay.match', with: { board: { name: 'board', at: [0, 0], size: [6, 6], axes: [0, 1], fall: -1 }, colors: ['red', 'orange', 'yellow', 'green', 'blue'], moves: 12 } }, { use: 'plot.ending' }],
    content: { archetypes: [], blocks: ['red', 'orange', 'yellow', 'green', 'blue'].map(id => ({ id })) },
    plot: { endings: [{ id: 'scored', title: 'Score', when: { var: 'score', gte: 60 }, outcome: 'won' }] } };
  const d = preflight(doc, registry, logic).doc;
  const s = solve(d, registry, logic, { budgetMs: 2000, seed: 3 });
  assert.equal(s.completable, true, JSON.stringify(s.endings));
  assert.equal(s.replayed, true, 'the ending path replays from a fresh world');
  assert.equal(s.deadEndCount, 0);
  // Without waiting, every resolving board was a dead end and the search claimed an exhaustive proof of no ending.
  const blind = solve(d, registry, logic, { budgetMs: 2000, seed: 3, waitSteps: 0 });
  assert.deepEqual([blind.completable, blind.exhaustive, blind.deadEndCount > 0], [false, true, true]);
});
