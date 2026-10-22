// The play spec and selection against the live "chess but with pokemon" failure
// (tests/fixtures/v2-live/chess-pokemon-failed.json, the real decomposition and selection): the mashup the model left
// empty is caught by the deterministic post-check and re-asked as one field, avatar locomotion never carries piece
// movement for pieces-turns, and falling pieces is never offered for it. Fake writers; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalize, decomposeIdea } from '../v2/planner/decompose.js';
import { mashupProblem } from '../v2/planner/play-spec.js';
import { selectPrimitives, servesInteraction } from '../v2/planner/select.js';
import { servesContext } from '../v2/planner/retrieval.js';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { fakeWriter, buildAnswer, decomposer, planFrom } from './v2-p-pipeline-fixtures.js';

const live = JSON.parse(readFileSync(new URL('./fixtures/v2-live/chess-pokemon-failed.json', import.meta.url), 'utf8'));
const { registry } = buildCatalogue();
const INTERACTION = 'pieces-turns';
/** The live decomposition, narrowed as decomposeIdea does (core.mashup is [] as the model wrote it). */
const decomposition = () => normalize(structuredClone(live.decomposition), live.prompt, registry);
const mappedOf = id => live.selection.mechanics.find(m => m.id === id).primitives;
const card = id => ({ id, ...registry.get(id).card });

/**
 * The live model, scripted for the iterative build: each mechanic picks the first of the primitives the live model mapped
 * it to that is on offer (the live mapping named avatar grid steps first for piece movement), and the mashup field
 * re-ask is answered by `mashup(call)`.
 */
const liveWriter = mashup => fakeWriter([(req, i) => {
  const name = String(req.schema?.name || '');
  const built = buildAnswer(req, { picks: Object.fromEntries(live.selection.mechanics.map(m => [m.id, m.primitives])) });
  if (built) return built;
  if (name === 'decomposition_fields') return JSON.stringify({ field_1: mashup(req, i) });
  throw Error(`unexpected form ${name}`);
}]);

test('the live decomposition left core.mashup empty; the post-check finds two ideas whose loops each declare a win and no relation', () => {
  const d = decomposition();
  assert.deepEqual(d.core.mashup, []);
  const p = mashupProblem(d, mappedOf, registry);
  assert.ok(p, 'chess × Pokémon without a mashup relation is an incomplete spec');
  assert.equal(p.code, 'mashup_missing');
  assert.deepEqual(p.ideas.map(i => i.from).sort(), ['chess', 'pok_mon']);
  assert.ok(p.ideas.find(i => i.from === 'pok_mon').loops.includes('gameplay.creature.battle'));
  assert.ok(p.ideas.find(i => i.from === 'chess').loops.includes('gameplay.turns'));
  // A relation that links the joined idea ACROSS concepts completes it; one within a single concept relates nothing and
  // is rejected; a single idea's loops never ask.
  assert.equal(mashupProblem({ ...d, core: { ...d.core, mashup: [{ relation: 'nested', mechanics: ['turn_based_piece_movement', 'type_advantages'], why: '' }] } }, mappedOf, registry), null);
  const within = mashupProblem({ ...d, core: { ...d.core, mashup: [{ relation: 'nested', mechanics: ['type_advantages'], why: '' }] } }, mappedOf, registry);
  assert.equal(within?.code, 'mashup_within_concept');
  assert.match(within.message, /one concept only/);
  assert.equal(mashupProblem({ ...d, mechanics: d.mechanics.map(m => ({ ...m, from: 'Chess' })) }, mappedOf, registry), null);
});

test('the decomposition asks for a mashup entry per joined concept, its mechanics an enum of the mechanic ids', async () => {
  const plan = planFrom(live.decomposition, { pok_mon: { name: 'Pokémon', quote: 'pokemon' } });
  const answer = decomposer(plan);
  const writer = fakeWriter([req => answer(req)]);
  await decomposeIdea({ writer, prompt: live.prompt, registry });
  const req = writer.calls.find(c => c.schema.name === 'play_spec');
  assert.match(req.system, /exactly one entry per additional game or genre concept, relating mechanics ACROSS concepts/);
  const mashup = req.schema.schema.properties.mashup;
  assert.match(mashup.description, /exactly one entry per additional game or genre concept/);
  assert.deepEqual(mashup.items.properties.relation.enum, ['nested', 'union', 'skin']);
  assert.deepEqual(mashup.items.properties.mechanics.items.enum, live.decomposition.mechanics.map(m => m.id));
  assert.deepEqual(req.schema.schema.properties.loop.enum, ['turn_based_piece_movement']);
});

test('selection: piece movement fits pieces-turns (the turns loop, never offered avatar steps) and the mashup is re-asked as one field', async () => {
  const d = decomposition();
  const writer = liveWriter(() => [{ relation: 'nested', mechanics: ['turn_based_piece_movement', 'type_advantages'], why: 'a creature battle decides each capture' }]);
  const sel = await selectPrimitives({ decomposition: d, registry, writer });
  const move = sel.mechanics.find(m => m.id === 'turn_based_piece_movement');
  assert.deepEqual(move.primitives, ['gameplay.turns'], JSON.stringify(move.primitives));
  // Avatar locomotion is never on offer for pieces moved in turns: the build only offers what serves the play spec.
  const moves = writer.calls.filter(c => c.schema.name === 'pick_primitive' && /\nMechanic turn_based_piece_movement /.test(c.user));
  assert.equal(moves.length, 1);
  for (const c of moves) assert.ok(c.schema.schema.properties.pick.enum.every(id => id === 'none' || servesInteraction(card(id), INTERACTION)), JSON.stringify(c.schema.schema.properties.pick.enum));
  assert.ok(!moves[0].schema.schema.properties.pick.enum.includes('gameplay.move.grid'));
  // The joined idea's mechanic (from Pokémon) is played in its own loop: the creature battle is on offer for it.
  assert.deepEqual(sel.mechanics.find(m => m.id === 'type_advantages').primitives, ['gameplay.creature.battle']);
  // Every mapped primitive and every system serves how the idea is played: no avatar locomotion anywhere.
  for (const id of [...sel.mechanics.flatMap(m => m.primitives), ...sel.systems]) assert.ok(servesInteraction(card(id), INTERACTION), `${id} does not serve ${INTERACTION}`);
  assert.ok(!sel.systems.some(id => card(id).locomotion), JSON.stringify(sel.systems));
  assert.ok(!sel.gaps.some(g => g.mechanic === 'turn_based_piece_movement'), JSON.stringify(sel.gaps));
  assert.equal(sel.spaces[0].use, 'engine.space.grid', 'the board the pieces-turns loop declares, showing the board view');
  // The mashup post-check fired and only core.mashup went back to the model (a field form), with the finding.
  const asks = writer.calls.filter(c => c.schema.name === 'decomposition_fields');
  assert.equal(asks.length, 1);
  assert.deepEqual(Object.keys(asks[0].schema.schema.properties), ['field_1']);
  assert.match(asks[0].schema.schema.properties.field_1.description, /^core\.mashup/);
  assert.match(asks[0].user, /no mashup relation links/);
  assert.deepEqual(d.core.mashup, [{ relation: 'nested', mechanics: ['turn_based_piece_movement', 'type_advantages'], why: 'a creature battle decides each capture' }]);
  assert.equal(sel.completeness.mashup.asked, 1);
});

test('a mashup the model still leaves out is never guessed: the spec fails after the re-asks', async () => {
  const d = decomposition();
  const writer = liveWriter(() => []);
  await assert.rejects(selectPrimitives({ decomposition: d, registry, writer, attempts: 2 }), e => e.status === 422 && e.code === 'play_spec_incomplete' && e.attempts.length === 2);
  assert.equal(writer.calls.filter(c => c.schema.name === 'decomposition_fields').length, 2);
  assert.deepEqual(d.core.mashup, []);
});

test('falling pieces never moves chess pieces: its loop is played another way and owns its game, so it is never offered', async () => {
  const d = decomposition();
  const writer = liveWriter(() => [{ relation: 'nested', mechanics: ['turn_based_piece_movement', 'type_advantages'], why: 'a creature battle decides each capture' }]);
  await selectPrimitives({ decomposition: d, registry, writer });
  const offered = writer.calls.filter(c => c.schema.name === 'pick_primitive' && c.user.includes('\nMechanic turn_based_piece_movement (')).flatMap(c => c.schema.schema.properties.pick.enum);
  assert.ok(offered.includes('gameplay.turns'));
  assert.ok(!offered.includes('gameplay.falling.pieces') && !offered.includes('gameplay.move.grid'), offered.join(', '));
  // By its declarations alone (card.loop interactions, card.locomotion), never by a score.
  assert.equal(servesContext(card('gameplay.falling.pieces'), INTERACTION), false);
  assert.equal(servesContext(card('gameplay.turns'), INTERACTION), true);
});
