// Idea decomposition and the step path's selection (ARCHITECTURE.md §5): both are the model's; nothing reads the idea's
// words, ranks cards by text or stands in for a choice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decomposeIdea } from '../v2/planner/decompose.js';
import { selectPrimitives, vocabIndex } from '../v2/planner/select.js';
import { buildCatalogue, spaceVariants } from '../v2/planner/catalog.js';
import { testCatalogue, fakeWriter, buildWriter, decomposition, decomposer } from './v2-p-pipeline-fixtures.js';

test('without a model the idea is not decomposed: no words of it are read as mechanics', async () => {
  await assert.rejects(decomposeIdea({ prompt: 'A lighthouse mystery × a fishing village: talk to the keeper and find the missing key' }), e => e.status === 422 && e.code === 'step_path_model_missing');
});

test('a writer decomposes in small strict forms, step by step; a failing writer is asked again, then reported, never replaced offline', async () => {
  const plan = {
    concepts: [{ id: 'dark_souls', name: 'Dark Souls', quote: 'Dark Souls', kind: 'game', keeps: ['stamina combat'] }, { id: 'pokemon', name: 'Pokémon', quote: 'Pokémon', kind: 'game', keeps: ['catching', 'party'] }],
    mechanics: { dark_souls: [{ id: 'Stamina Combat', verb: 'fight', description: 'real-time melee combat with stamina', from: 'dark_souls', role: 'loop' }], pokemon: [{ id: 'catch', verb: 'catch', description: 'catch creatures and keep a party', from: 'pokemon', role: 'loop' }] },
    spec: { loop: 'stamina_combat', interaction: 'avatar-realtime', opponent: 'ai-rival', win: 'defeat the last lord of cinder', lose: 'your whole party falls', theme: 'grim', narrative: false, mashup: [{ relation: 'union', mechanics: ['stamina_combat', 'catch'], why: 'weaken a creature in combat to catch it' }] },
    about: { title: 'Ashen Pact', premise: 'Catch creatures; survive brutal bosses.', tone: 'grim' },
    where: { spaces: [{ role: 'overworld', kind: 'continuous-3d', description: 'ruined kingdom' }], views: ['3p'], movement: 'ground' },
  };
  const answer = decomposer(plan);
  const writer = fakeWriter([req => answer(req)]);
  const d = await decomposeIdea({ writer, prompt: 'Dark Souls Pokémon' });
  assert.deepEqual(writer.calls.map(c => c.schema.name), ['idea_concepts', 'concept_mechanics', 'concept_mechanics', 'play_spec', 'idea_about', 'idea_spaces']);
  assert.ok(writer.calls.every(c => c.schema.schema.additionalProperties === false), 'every form is strict');
  assert.deepEqual(d.references.map(r => r.name), ['Dark Souls', 'Pokémon']);
  assert.deepEqual(d.concepts.map(c => c.id), ['dark_souls', 'pokemon']);
  assert.equal(d.mechanics[0].id, 'stamina_combat', 'ids are normalized to slugs');
  assert.equal(d.core.loop, 'stamina_combat');
  assert.equal(d.source, 'fake-writer');
  assert.equal(d.calls.length, 6);
  const failing = fakeWriter(['not json at all']);
  await assert.rejects(decomposeIdea({ writer: failing, prompt: 'a mystery' }), e => e.status === 422 && e.code === 'decomposition_failed' && e.step === 'concepts' && /2 call/.test(e.message) && /JSON/.test(e.message));
  assert.equal(failing.calls.length, 2, 'asked again before failing');
  assert.match(failing.calls[1].user, /previous reply failed/);
  // A second answer that is valid is used: only that step was asked again.
  const again = decomposer(plan);
  let first = true;
  const once = await decomposeIdea({ writer: fakeWriter([req => (first ? (first = false, 'not json') : again(req))]), prompt: 'Dark Souls Pokémon' });
  assert.equal(once.source, 'fake-writer');
  assert.deepEqual(once.calls.map(c => c.step), ['concepts', 'concepts', 'mechanics', 'mechanics', 'play_spec', 'about', 'spaces']);
  assert.match(once.calls[0].error, /JSON/);
});

test('spaces offer their param-dependent configurations (the side variant adds gravity)', () => {
  const { registry } = testCatalogue();
  const variants = spaceVariants(registry, 'engine.space.flatx');
  assert.ok(variants.some(v => v.with.mode === 'side' && v.caps.has('gravity')), 'the side variant adds gravity');
});

test('selection is the model\'s build: the play spec\'s narrative flag adds no story runner; a primitive joins as a pick; a mechanic the model maps to none is a gap', async () => {
  const { registry } = testCatalogue();
  const core = { interaction: null, opponent: 'none', win: '', lose: '', theme: '', narrative: true, mashup: [] };
  const d = decomposition(['find the lighthouse keeper', 'brew potions in a cauldron over many days'], { core, views: ['text'] });
  const sel = await selectPrimitives({ decomposition: d, registry, writer: buildWriter({ space: ['engine.space.graph'] }) });
  assert.equal(sel.provider, 'build');
  assert.ok(!sel.systems.includes('plot.storyboard'), 'the narrative flag adds no primitive');
  assert.deepEqual(sel.gaps.filter(g => g.kind === 'no_primitive').map(g => g.mechanic).sort(), ['m0', 'm1']);
  assert.ok(sel.mechanics.every(m => m.primitives.length === 0 && m.source === 'build'));
  // A primitive joins as the model's pick among the options offered for the mechanic (here the only valid one).
  const picked = await selectPrimitives({ decomposition: d, registry, writer: buildWriter({ space: ['engine.space.graph'], picks: { m0: ['gameplay.inventory'] } }) });
  assert.deepEqual(picked.mechanics.find(m => m.id === 'm0').primitives, ['gameplay.inventory']);
  assert.ok(!picked.systems.includes('plot.storyboard'));
});

test('a connected model whose answers are not on offer fails selection after a retry; the lexical ranking never stands in', async () => {
  const { registry } = testCatalogue();
  const d = decomposition(['dash through enemies with a burst of speed']);
  const writer = fakeWriter(['{"mappings": []}']);
  await assert.rejects(selectPrimitives({ decomposition: d, registry, writer }), e => e.code === 'selection_failed' && /2 attempt/.test(e.message));
  assert.equal(writer.calls.filter(c => c.schema.name === 'pick_space').length, 2, 'the space question, asked again once');
});

test('the vocabulary index names which primitive registers each predicate and effect', () => {
  const { registry } = testCatalogue();
  const v = vocabIndex(registry);
  assert.equal(v.effects.give_item, 'gameplay.inventory');
  assert.equal(v.predicates.item, 'gameplay.inventory');
  assert.equal(v.effects.say, 'plot.storyboard');
  assert.equal(v.effects.set_flag, undefined, 'kernel built-ins are not attributed');
});
