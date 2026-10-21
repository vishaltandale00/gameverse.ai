// The play spec, selection and re-planning against the live "chess but with pokemon" failure
// (tests/fixtures/v2-live/chess-pokemon-failed.json, the real decomposition and selection): the mashup the model left
// empty is caught by the deterministic post-check and re-asked as one field, avatar locomotion never carries piece
// movement for pieces-turns, and re-planning never replaces piece movement with falling pieces. Fake writers; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalize, decomposeIdea } from '../v2/planner/decompose.js';
import { mashupProblem } from '../v2/planner/play-spec.js';
import { selectPrimitives, declaredFit, servesInteraction } from '../v2/planner/select.js';
import { replan, gapRequest } from '../v2/planner/replan.js';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { fakeWriter } from './v2-p-pipeline-fixtures.js';

const live = JSON.parse(readFileSync(new URL('./fixtures/v2-live/chess-pokemon-failed.json', import.meta.url), 'utf8'));
const { registry } = buildCatalogue();
const INTERACTION = 'pieces-turns';
/** The live decomposition, narrowed as decomposeIdea does (core.mashup is [] as the model wrote it). */
const decomposition = () => normalize(structuredClone(live.decomposition), live.prompt, registry);
/** The live selection with the fields a fresh selection carries. */
const selection = () => ({ generators: [], graphics: [], bind: {}, ...structuredClone(live.selection) });
const mappedOf = id => live.selection.mechanics.find(m => m.id === id).primitives;
const card = id => ({ id, ...registry.get(id).card });

/**
 * The live model, scripted: the catalogue mapping and the mapping check as recorded (the check named avatar grid
 * steps as the central primitive of piece movement), and the mashup field re-ask answered by `mashup(call)`.
 */
const liveWriter = mashup => fakeWriter([(req, i) => {
  const name = String(req.schema?.name || '');
  if (name === 'mechanic_map') return JSON.stringify({ mappings: live.selection.mechanics.map(m => ({ mechanic: m.id, primitives: m.primitives, covered: true, why: '' })) });
  if (name === 'mapping_check') return JSON.stringify({ checks: [{ mechanic: 'turn_based_piece_movement', central: 'gameplay.move.grid', wrong: [], why: live.selection.completeness.mapping.changes[0].why, spec: '' }] });
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

test('the decomposition asks for a mashup entry per joined idea, by mechanic id', async () => {
  const writer = fakeWriter([JSON.stringify(live.decomposition)]);
  await decomposeIdea({ writer, prompt: live.prompt, registry });
  const req = writer.calls[0];
  assert.match(req.system, /IS a mashup: give one entry per joined idea/);
  const mashup = req.schema.schema.properties.core.properties.mashup;
  assert.match(mashup.description, /one entry per joined idea/);
  assert.deepEqual(mashup.items.properties.relation.enum, ['nested', 'union', 'skin']);
  assert.match(mashup.items.properties.mechanics.description, /mechanics\[\]\.id/);
});

test('selection: piece movement fits pieces-turns (the turns loop, not avatar steps) and the mashup is re-asked as one field', async () => {
  const d = decomposition();
  const writer = liveWriter(() => [{ relation: 'nested', mechanics: ['turn_based_piece_movement', 'type_advantages'], why: 'a creature battle decides each capture' }]);
  const sel = await selectPrimitives({ decomposition: d, registry, writer });
  const move = sel.mechanics.find(m => m.id === 'turn_based_piece_movement');
  assert.ok(!move.primitives.includes('gameplay.move.grid'), JSON.stringify(move.primitives));
  assert.ok(move.primitives.includes('gameplay.turns'));
  // Every mapped primitive and every system serves how the idea is played: no avatar locomotion anywhere.
  for (const id of [...sel.mechanics.flatMap(m => m.primitives), ...sel.systems]) assert.ok(servesInteraction(card(id), INTERACTION), `${id} does not serve ${INTERACTION}`);
  assert.ok(!sel.systems.some(id => card(id).locomotion), JSON.stringify(sel.systems));
  assert.ok(!sel.gaps.some(g => g.mechanic === 'turn_based_piece_movement'), JSON.stringify(sel.gaps));
  assert.deepEqual(sel.completeness.interaction.changes.map(c => [c.mechanic, c.removed, c.by]), [['turn_based_piece_movement', 'gameplay.move.grid', 'gameplay.turns']]);
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

test('re-planning the live failure: piece movement stays with the turns loop, never falling pieces', () => {
  const d = decomposition();
  const diagnosis = { kind: 'primitive', mechanic: 'turn_based_piece_movement', primitive: 'gameplay.move.grid', codes: ['core_degraded'], message: live.attempt.problems[0] };
  const r = replan(selection(), [diagnosis], { registry, decomposition: d, tried: new Map() });
  const action = r.actions.find(a => a.action === 'replace');
  assert.equal(action.by, 'gameplay.turns', JSON.stringify(r.actions));
  assert.ok(!r.selection.systems.includes('gameplay.move.grid') && !r.selection.systems.includes('gameplay.falling.pieces'));
  assert.ok(!r.selection.mechanics.find(m => m.id === 'turn_based_piece_movement').primitives.includes('gameplay.move.grid'));
});

test('re-planning ranks replacements by declarations and the composition check: falling pieces never moves chess pieces', () => {
  const d = decomposition();
  const m = d.mechanics.find(x => x.id === 'turn_based_piece_movement');
  // Falling pieces' loop is played on a cursor board and owns its game: it does not fit pieces moved in turns.
  assert.equal(declaredFit(m, card('gameplay.falling.pieces'), { interaction: INTERACTION, verbs: card('gameplay.move.grid').loop.verbs }), null);
  assert.ok(declaredFit(m, card('gameplay.turns'), { interaction: INTERACTION, verbs: card('gameplay.move.grid').loop.verbs }) > 0);
  // Without the turns loop in the collection, the declared fit brings it in.
  const sel = selection();
  sel.systems = sel.systems.filter(id => id !== 'gameplay.turns');
  for (const x of sel.mechanics) x.primitives = x.primitives.filter(id => id !== 'gameplay.turns');
  const diagnosis = { kind: 'primitive', mechanic: 'turn_based_piece_movement', primitive: 'gameplay.move.grid', codes: ['core_degraded'], message: 'lost' };
  const r = replan(sel, [diagnosis], { registry, decomposition: d, tried: new Map() });
  const action = r.actions.find(a => a.action === 'replace');
  assert.equal(action?.by, 'gameplay.turns', JSON.stringify(r));
  // When nothing declared fits, the gap layer is asked for the primitive signature, never a word match.
  const tried = new Map([['turn_based_piece_movement', new Set(registry.ids().filter(id => id !== 'gameplay.falling.pieces'))]]);
  const none = replan(sel, [diagnosis], { registry, decomposition: d, tried });
  assert.equal(none.actions.filter(a => a.action === 'replace').length, 0, JSON.stringify(none.actions));
  assert.equal(none.unresolved.length, 1);
  assert.match(none.unresolved[0].signature, /played as pieces-turns/);
  const { request, gap } = gapRequest(none.unresolved[0], none.selection, d);
  assert.match(request, /be played as pieces-turns/);
  assert.match(request, /Signature: /);
  assert.equal(gap.kind, 'no_primitive');
});
