// Idea decomposition and capability-aware primitive selection (ARCHITECTURE.md §4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { decomposeIdea, decomposeOffline, DECOMPOSITION_SCHEMA } from '../v2/planner/decompose.js';
import { selectPrimitives, chooseSpaces, rankCandidates, relevance, LEXICAL_ACCEPT, vocabIndex } from '../v2/planner/select.js';
import { buildCatalogue, spaceVariants } from '../v2/planner/catalog.js';
import { testCatalogue, fakeWriter, fakeDecisions, decomposition } from './v2-p-pipeline-fixtures.js';

test('offline decomposition splits references and finds mechanics as verbs, deterministically', () => {
  const a = decomposeOffline('A lighthouse mystery × a fishing village: talk to the keeper and find the missing key');
  assert.deepEqual(a, decomposeOffline('A lighthouse mystery × a fishing village: talk to the keeper and find the missing key'));
  assert.ok(a.references.length >= 2, 'the × splits references');
  const ids = a.mechanics.map(m => m.id);
  for (const m of ['talk', 'collect', 'story', 'explore']) assert.ok(ids.includes(m), `${m} in ${ids}`);
  assert.equal(a.source, 'offline');
});

test('a writer decomposes with a strict schema; a failing writer falls back offline', async () => {
  const reply = { title: 'Ashen Pact', premise: 'Catch creatures; survive brutal bosses.', tone: 'grim', references: [{ name: 'Dark Souls', kind: 'game', keeps: ['stamina combat'] }, { name: 'Pokémon', kind: 'game', keeps: ['catching', 'party'] }],
    mechanics: [{ id: 'Stamina Combat', verb: 'fight', description: 'real-time melee combat with stamina', from: 'Dark Souls', importance: 'core' }, { id: 'catch', verb: 'catch', description: 'catch creatures and keep a party', from: 'Pokémon', importance: 'core' }],
    spaces: [{ role: 'overworld', kind: 'continuous-3d', description: 'ruined kingdom' }], views: ['3p'], acts: 3, zones: 6 };
  const writer = fakeWriter([reply]);
  const d = await decomposeIdea({ writer, prompt: 'Dark Souls Pokémon' });
  assert.equal(writer.calls[0].schema.name, 'decomposition');
  assert.equal(writer.calls[0].schema.schema, DECOMPOSITION_SCHEMA);
  assert.deepEqual(d.references.map(r => r.name), ['Dark Souls', 'Pokémon']);
  assert.equal(d.mechanics[0].id, 'stamina_combat', 'ids are normalized to slugs');
  assert.equal(d.source, 'fake-writer');
  const broken = await decomposeIdea({ writer: fakeWriter(['not json at all']), prompt: 'a mystery' });
  assert.equal(broken.source, 'offline');
  assert.match(broken.error, /JSON/);
});

test('lexical relevance matches mechanics to cards and stays low for unrelated ones', () => {
  const { registry } = testCatalogue();
  const cards = registry.cards();
  const dashCard = cards.find(c => c.id === 'gameplay.test.dash'), inv = cards.find(c => c.id === 'gameplay.inventory');
  assert.ok(relevance({ verb: 'dash', description: 'dash through enemies with a burst of speed' }, dashCard) >= LEXICAL_ACCEPT);
  assert.ok(relevance({ verb: 'collect', description: 'find and collect items' }, inv) >= LEXICAL_ACCEPT);
  assert.ok(relevance({ verb: 'dash', description: 'dash through enemies' }, inv) < LEXICAL_ACCEPT);
  assert.equal(rankCandidates({ verb: 'collect', description: 'collect items' }, cards)[0].id, 'gameplay.inventory');
});

test('spaces are chosen to provide what the chosen primitives require, including param-dependent capabilities', () => {
  const { registry } = testCatalogue();
  const variants = spaceVariants(registry, 'engine.space.flatx');
  assert.ok(variants.some(v => v.with.mode === 'side' && v.caps.has('gravity')), 'the side variant adds gravity');
  const { spaces, unmet } = chooseSpaces(registry, ['gameplay.test.dash', 'plot.storyboard'], decomposition([]));
  assert.ok(['overlap', 'gravity'].every(c => spaces[0].caps.includes(c)), `${spaces[0].use} provides what the dash needs`);
  assert.deepEqual(unmet, []);
  // The real grid provides wrap only when configured for it: the choice includes that configuration.
  const board = chooseSpaces(registry, ['gameplay.test.tunnels'], decomposition([]));
  assert.equal(board.spaces[0].use, 'engine.space.grid');
  assert.ok(['x', 'y', 'both'].includes(board.spaces[0].with.wrap), JSON.stringify(board.spaces[0].with));
  // Excluded spaces are never chosen (agency re-selection uses this).
  assert.notEqual(chooseSpaces(registry, ['gameplay.test.dash'], decomposition([]), [], [spaces[0].use]).spaces[0].use, spaces[0].use);
  const none = chooseSpaces(registry, ['gameplay.test.warp'], decomposition([]));
  assert.deepEqual(none.unmet.map(u => u.id), ['gameplay.test.warp']);
  // Without capability needs, structure hints and views pick the space: locations -> graph.
  const graph = chooseSpaces(registry, ['plot.storyboard'], decomposition([], { spaces: [{ role: 'manor', kind: 'locations', description: '' }] }));
  assert.equal(graph.spaces[0].use, 'engine.space.graph');
});

test('selection maps mechanics to primitives, adds foundations, and reports uncovered mechanics as gaps', async () => {
  const { registry } = testCatalogue();
  const d = decomposition(['dash through enemies with a burst of speed', 'find and collect items', 'warp through wormholes between distant stars', 'brew potions in a cauldron over many days']);
  const sel = await selectPrimitives({ decomposition: d, registry });
  assert.deepEqual(sel.mechanics.map(m => m.primitives[0] || null), ['gameplay.test.dash', 'gameplay.inventory', null, null]);
  assert.ok(sel.systems.includes('plot.storyboard'), 'the story runner is a foundation');
  assert.ok(sel.spaces[0].caps.includes('gravity'), 'a space with what the dash needs');
  const kinds = Object.fromEntries(sel.gaps.map(g => [g.mechanic, g.kind]));
  assert.equal(kinds.m2, 'capability', 'warp: chosen, but no space provides wormholes, so it is dropped as a capability gap');
  assert.equal(kinds.m3, 'no_primitive');
  assert.ok(!sel.systems.includes('gameplay.test.warp'));
});

test('a decision model picks among the candidates per mechanic; "none" makes a gap', async () => {
  const { registry } = testCatalogue();
  const d = decomposition(['collect shiny things', 'dash forward quickly']);
  const decisions = fakeDecisions(questions => Object.fromEntries(Object.entries(questions).map(([k, q]) => {
    const pick = /dash/.test(q.instructions) ? 'none' : Object.keys(q.criteria)[0];
    return [k, { type: 'choice', choice: pick, probabilities: { [pick]: 0.9 } }];
  })));
  const sel = await selectPrimitives({ decomposition: d, registry, decisions });
  assert.equal(decisions.calls.length, 1, 'one batched decision call');
  assert.ok(Object.values(decisions.calls[0].questions).every(q => q.criteria.none), 'every question can answer none');
  assert.equal(sel.mechanics[1].primitives.length, 0);
  assert.equal(sel.gaps[0].mechanic, 'm1');
  assert.equal(sel.provider, 'fake');
});

test('the vocabulary index names which primitive registers each predicate and effect', () => {
  const { registry } = buildCatalogue();
  const v = vocabIndex(registry);
  assert.equal(v.effects.give_item, 'gameplay.inventory');
  assert.equal(v.predicates.item, 'gameplay.inventory');
  assert.equal(v.effects.say, 'plot.storyboard');
  assert.equal(v.effects.set_flag, undefined, 'kernel built-ins are not attributed');
});
