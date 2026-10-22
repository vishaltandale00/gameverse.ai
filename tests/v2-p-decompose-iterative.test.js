// The iterative decomposition (v2/planner/decompose.js decomposeIdea): small strict forms with a deterministic check
// after each (concepts, each concept's mechanics in parallel, the play spec, the rest); a failing check re-asks only its
// step's failing field, then escalates, then fails 422. Scripted fake writers; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decomposeIdea, conceptProblems, notASentence } from '../v2/planner/decompose.js';
import { conceptMashupProblem } from '../v2/planner/play-spec.js';
import { worklist, loopMechanicOf } from '../v2/planner/build.js';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { fakeWriter, decomposer, planFrom } from './v2-p-pipeline-fixtures.js';

const { registry } = buildCatalogue();
const record = JSON.parse(readFileSync(new URL('./fixtures/v2-live/chess-pokemon-oneshot.json', import.meta.url), 'utf8'));
/** A writer answering from one decomposer (its ask counts shared across calls). */
const writerOf = (plan, options) => { const answer = decomposer(plan); return fakeWriter([req => answer(req) ?? (() => { throw Error(`unexpected form ${req.schema?.name}`); })()], options); };
const forms = writer => writer.calls.map(c => `${c.schema.name}${/\nConcept: (\S+) \(/.exec(c.user)?.[1] ? `:${/\nConcept: (\S+) \(/.exec(c.user)[1]}` : ''}`);
const slotsOf = call => Object.values(call.schema.schema.properties).map(p => p.description.split(':')[0]);

const CHESS = { id: 'chess', name: 'Chess', quote: 'chess', kind: 'game', keeps: ['the board and its pieces', 'checkmate'] };
const POKEMON = { id: 'pokemon', name: 'Pokémon', quote: 'pokemon', kind: 'game', keeps: ['creature battles', 'type advantages'] };
const CHESS_MECHANICS = [
  { id: 'chess_match', verb: 'move', description: 'move pieces by chess rules in turns until one king is checkmated', from: 'chess', role: 'loop' },
  { id: 'capture_pieces', verb: 'capture', description: 'capture an opposing piece by moving onto its square', from: 'chess', role: 'core' },
];
const POKEMON_MECHANICS = [
  { id: 'creature_battle', verb: 'battle', description: 'turn-based battle between two creatures using their moves', from: 'pokemon', role: 'loop' },
  { id: 'type_advantages', verb: 'counter', description: 'creature types beat or resist other types', from: 'pokemon', role: 'supporting' },
];
const CHESS_SPEC = { loop: 'chess_match', interaction: 'pieces-turns', opponent: 'ai-side', win: "checkmate the rival's king", lose: 'your own king is checkmated', theme: 'creature chess', narrative: false,
  mashup: [{ relation: 'nested', mechanics: ['capture_pieces', 'creature_battle', 'type_advantages'], why: 'a creature battle decides each capture' }] };
const CHESS_PLAN = { concepts: [CHESS, POKEMON], mechanics: { chess: CHESS_MECHANICS, pokemon: POKEMON_MECHANICS }, spec: CHESS_SPEC,
  about: { title: 'Pocket Gambit', premise: 'Chess where every capture is a creature battle. Win the battle, take the square.', tone: 'bright, tactical' },
  where: { spaces: [{ role: 'board', kind: 'board', description: '8x8' }, { role: 'arena', kind: 'none', description: 'the battle screen' }], views: ['board', 'ui'] } };

test('the check behind step 1 reads only the answer and the declarations, never the idea\'s words', () => {
  const refs = [{ name: 'Chess', concept: 'chess' }, { name: 'Pokémon', concept: 'pokemon' }];
  assert.deepEqual(conceptProblems([CHESS, POKEMON], refs), []);
  // A reference the answer names but folds into no concept of its own: concepts and references are asked again.
  const folded = conceptProblems([CHESS], refs);
  assert.deepEqual(folded.map(p => p.field), ['concepts', 'references']);
  assert.match(folded[0].message, /'Pokémon' \(concept 'pokemon'\) maps to no concept/);
  // A feature of one concept is not a concept: one reference, one concept, no problem.
  assert.deepEqual(conceptProblems([{ ...CHESS, id: 'platformer', name: 'platformer', kind: 'genre' }], [{ name: 'a platformer', concept: 'platformer' }]), []);
  // Whether a concept has a loop is its kind: an idea with no game or genre has no loop to play.
  assert.match(conceptProblems([{ ...CHESS, kind: 'setting' }], refs.slice(0, 1)).map(p => p.message).join(), /no concept is a game or genre/);
  assert.match(conceptProblems([{ ...CHESS, kind: 'franchise' }], refs.slice(0, 1)).map(p => p.message).join(), /chess \('franchise'\) has no kind/);
  assert.match(conceptProblems([CHESS, CHESS], refs.slice(0, 1)).map(p => p.message).join(), /ids chess are used twice/);
  assert.equal(notASentence('checkmate-win-condition', new Set()), "'checkmate-win-condition' is an id-like token");
  assert.equal(notASentence('checkmate', new Set()), "'checkmate' is an id-like token");
  assert.equal(notASentence("checkmate the rival's king", new Set()), null);
});

test('(a) a two-game idea yields two concepts, each with its own loop, and a mashup spanning them', async () => {
  // In flight together: the per-concept forms are asked in parallel.
  let inflight = 0, peak = 0;
  const answer = decomposer(CHESS_PLAN);
  const writer = { provider: 'fake', model: 'fake-writer', calls: [], async complete(req) {
    this.calls.push(req);
    if (req.schema.name === 'concept_mechanics') { inflight++; peak = Math.max(peak, inflight); await new Promise(r => setTimeout(r, 5)); inflight--; }
    return { text: answer(req), ms: 1, model: 'fake-writer' };
  } };
  const d = await decomposeIdea({ writer, prompt: 'chess but with pokemon', registry });
  assert.equal(peak, 2, 'both concepts\' mechanics were asked at once');
  assert.deepEqual(d.concepts.map(c => [c.id, c.loop]), [['chess', 'chess_match'], ['pokemon', 'creature_battle']]);
  assert.deepEqual(d.references.map(r => r.name), ['Chess', 'Pokémon']);
  for (const c of d.concepts) assert.equal(d.mechanics.filter(m => m.from === c.id && ['chess_match', 'creature_battle'].includes(m.id)).length, 1, `${c.id} has its own loop`);
  assert.equal(d.mechanics.find(m => m.id === 'creature_battle').importance, 'core', 'a joined concept\'s loop is a core mechanic');
  assert.equal(d.core.loop, 'chess_match');
  assert.equal(loopMechanicOf(d), 'chess_match');
  assert.equal(worklist(d)[0].id, 'chess_match');
  assert.deepEqual(d.core.mashup, CHESS_SPEC.mashup);
  assert.equal(conceptMashupProblem({ concepts: d.concepts, mechanics: d.mechanics, mashup: d.core.mashup, loop: d.core.loop }), null);
  assert.equal(d.movement, 'none', 'pieces moved in turns: no avatar movement');
  // Small forms, one per step (and one per concept), every enum built from the steps before.
  assert.deepEqual(forms(writer).sort(), ['concept_mechanics:chess', 'concept_mechanics:pokemon', 'idea_about', 'idea_concepts', 'idea_spaces', 'play_spec']);
  const spec = writer.calls.find(c => c.schema.name === 'play_spec').schema.schema.properties;
  assert.deepEqual(spec.loop.enum, ['chess_match', 'creature_battle']);
  assert.deepEqual(spec.mashup.items.properties.mechanics.items.enum, ['chess_match', 'capture_pieces', 'creature_battle', 'type_advantages']);
  assert.deepEqual(spec.mashup.items.properties.relation.enum, ['nested', 'union', 'skin']);
  assert.deepEqual(writer.calls.find(c => /Concept: pokemon /.test(c.user)).schema.schema.properties.mechanics.items.properties.from.enum, ['pokemon']);
  assert.equal(d.calls.length, 6);
  assert.ok(d.calls.every(c => c.chars > 0 && c.model === 'fake-writer'));
});

test('(a) a mashup that leaves a game concept unlinked is re-asked as that field alone', async () => {
  const writer = writerOf({ ...CHESS_PLAN, spec: (req, n) => (n === 0 ? { ...CHESS_SPEC, mashup: [] } : CHESS_SPEC) });
  const d = await decomposeIdea({ writer, prompt: 'chess but with pokemon', registry });
  const asks = writer.calls.filter(c => c.schema.name.startsWith('play_spec'));
  assert.deepEqual(asks.map(c => c.schema.name), ['play_spec', 'play_spec_fields']);
  assert.deepEqual(slotsOf(asks[1]), ['mashup']);
  assert.match(asks[1].user, /no entry links/);
  assert.deepEqual(d.core.mashup, CHESS_SPEC.mashup);
  // A within-concept entry is rejected the same way.
  const within = conceptMashupProblem({ concepts: [CHESS, POKEMON], mechanics: [...CHESS_MECHANICS, ...POKEMON_MECHANICS], mashup: [{ relation: 'union', mechanics: ['chess_match', 'capture_pieces'], why: '' }] });
  assert.equal(within.code, 'mashup_within_concept');
});

test('(b) a model that tags everything with one concept is re-asked at step 1 and step 2 only', async () => {
  // Step 1: Pokémon named as a reference but folded into chess; step 2: Pokémon's form answered with chess's mechanics.
  const refs = [{ name: 'chess', concept: 'chess' }, { name: 'pokemon', concept: 'pokemon' }];
  const writer = writerOf({ ...CHESS_PLAN,
    concepts: (req, n) => ({ references: refs, concepts: n === 0 ? [{ ...CHESS, quote: 'chess but with pokemon' }] : [CHESS, POKEMON] }),
    mechanics: (req, n, concept) => ({ mechanics: concept === 'chess' ? CHESS_MECHANICS : n === 0 ? CHESS_MECHANICS : POKEMON_MECHANICS }) });
  const d = await decomposeIdea({ writer, prompt: 'chess but with pokemon', registry });
  assert.deepEqual(forms(writer), ['idea_concepts', 'idea_concepts_fields', 'concept_mechanics:chess', 'concept_mechanics:pokemon', 'concept_mechanics_fields:pokemon', 'play_spec', 'idea_about', 'idea_spaces']);
  assert.deepEqual(slotsOf(writer.calls[1]), ['concepts', 'references']);
  assert.match(writer.calls[1].user, /'pokemon' \(concept 'pokemon'\) maps to no concept/);
  const pokemon = writer.calls.find(c => c.schema.name === 'concept_mechanics_fields');
  assert.match(pokemon.user, /chess_match \(from 'chess'\).*not pokemon's/);
  assert.deepEqual(d.concepts.map(c => c.id), ['chess', 'pokemon']);
  assert.deepEqual(d.mechanics.filter(m => m.from === 'pokemon').map(m => m.id), ['creature_battle', 'type_advantages']);
  assert.deepEqual(d.calls.filter(c => c.problems).map(c => c.step), ['concepts', 'mechanics']);
});

test('(b) mechanic ids that clash across concepts re-ask the later concept with the clash', async () => {
  const clash = POKEMON_MECHANICS.map((m, i) => (i === 1 ? { ...m, id: 'capture_pieces' } : m));
  const writer = writerOf({ ...CHESS_PLAN, mechanics: (req, n, concept) => ({ mechanics: concept === 'chess' ? CHESS_MECHANICS : n === 0 ? clash : POKEMON_MECHANICS }) });
  const d = await decomposeIdea({ writer, prompt: 'chess but with pokemon', registry });
  const fix = writer.calls.find(c => c.schema.name === 'concept_mechanics_fields');
  assert.match(fix.user, /Concept: pokemon /);
  assert.match(fix.user, /capture_pieces is already chess's/);
  assert.equal(new Set(d.mechanics.map(m => m.id)).size, d.mechanics.length);
});

test('(c) win and lose written as an id (the live one-shot record) are re-asked as sentences, with the mashup, alone', async () => {
  const plan = planFrom(record.decomposition, { pok_mon: { name: 'Pokémon', quote: 'pokemon' } });
  const fixed = { ...plan.spec, win: "checkmate the rival's king", lose: 'your own king is checkmated', mashup: [{ relation: 'skin', mechanics: ['turn_based_player_moves', 'special_pokemon_abilities'], why: 'creatures are the pieces' }] };
  const writer = writerOf({ ...plan, spec: (req, n) => (n === 0 ? plan.spec : fixed) });
  const d = await decomposeIdea({ writer, prompt: record.prompt, registry });
  const asks = writer.calls.filter(c => c.schema.name.startsWith('play_spec'));
  assert.equal(asks.length, 2);
  // Only the failing fields: win and lose (id-like, identical) and the union with a theme concept (no loop of its own).
  assert.deepEqual(slotsOf(asks[1]).sort(), ['lose', 'mashup', 'win']);
  assert.match(asks[1].user, /'checkmate-win-condition' is an id-like token/);
  assert.match(asks[1].user, /needs a loop from pok_mon/);
  assert.equal(d.core.win, "checkmate the rival's king");
  assert.equal(d.core.lose, 'your own king is checkmated');
  // The same text for win and lose is re-asked for lose.
  const same = writerOf({ ...plan, spec: (req, n) => (n === 0 ? { ...fixed, lose: fixed.win } : fixed) });
  await decomposeIdea({ writer: same, prompt: record.prompt, registry });
  assert.deepEqual(slotsOf(same.calls.find(c => c.schema.name === 'play_spec_fields')), ['lose']);
});

test('(c) a model that keeps writing an id is escalated once, then the decomposition fails 422 with the diagnosis', async () => {
  const plan = planFrom(record.decomposition, { pok_mon: { name: 'Pokémon', quote: 'pokemon' } });
  const stuck = { ...plan, spec: { ...plan.spec, mashup: [] } };
  const writer = writerOf(stuck), escalate = writerOf(stuck, { model: 'escalation' });
  await assert.rejects(decomposeIdea({ writer, escalate, prompt: record.prompt, registry }), e => {
    assert.equal(e.status, 422);
    assert.equal(e.code, 'decomposition_failed');
    assert.equal(e.step, 'play_spec');
    assert.equal(e.attempts.length, 3);
    assert.ok(e.problems.some(p => /^win: .*id-like/.test(p)), JSON.stringify(e.problems));
    return true;
  });
  assert.equal(writer.calls.filter(c => c.schema.name.startsWith('play_spec')).length, 2, 'the default model twice');
  assert.equal(escalate.calls.length, 1, 'then the escalation writer once, for that form only');
  assert.equal(escalate.calls[0].effort, 'low');
  assert.equal(escalate.calls[0].schema.name, 'play_spec_fields');
  // Unparseable replies count the same way and are reported.
  const failing = fakeWriter(['not json at all']);
  await assert.rejects(decomposeIdea({ writer: failing, prompt: 'a mystery' }), e => e.status === 422 && e.code === 'decomposition_failed' && e.step === 'concepts' && /2 call/.test(e.message) && /JSON/.test(e.message));
  assert.equal(failing.calls.length, 2);
  assert.match(failing.calls[1].user, /previous reply failed/);
});

const LIBRARY = { id: 'pac_man', name: 'Pac-Man', quote: 'Pac-Man', kind: 'game', keeps: ['maze chase', 'pellets', 'ghosts'] };
const HAUNTED = { id: 'haunted_library', name: 'haunted library', quote: 'a haunted library', kind: 'setting', keeps: ['shelves as walls', 'ghostly librarians'] };
const PAC_MECHANICS = [
  { id: 'maze_chase', verb: 'eat', description: 'eat every pellet in the maze while ghosts chase you', from: 'pac_man', role: 'loop' },
  { id: 'power_pellets', verb: 'turn', description: 'a power pellet lets you eat the ghosts for a while', from: 'pac_man', role: 'core' },
];
const LIBRARY_PLAN = { concepts: [LIBRARY, HAUNTED], mechanics: { pac_man: PAC_MECHANICS, haunted_library: [] },
  spec: { loop: 'maze_chase', interaction: 'avatar-grid', opponent: 'ai-rival', win: 'eat every pellet in the library', lose: 'a ghost catches you with no lives left', theme: 'haunted library', narrative: false, mashup: [] },
  where: { spaces: [{ role: 'maze', kind: 'tiles-topdown', description: 'stacks of shelves' }], views: ['td'], movement: 'ground' } };

test('(d) a single game in a themed setting: a theme concept without a loop, a mashup of skin or none, no invented second loop', async () => {
  const writer = writerOf(LIBRARY_PLAN);
  const d = await decomposeIdea({ writer, prompt: 'Pac-Man in a haunted library', registry });
  assert.deepEqual(d.concepts.map(c => [c.id, c.kind, c.loop]), [['pac_man', 'game', 'maze_chase'], ['haunted_library', 'setting', undefined]]);
  assert.deepEqual(d.mechanics.map(m => m.id), ['maze_chase', 'power_pellets']);
  assert.deepEqual(d.core.mashup, []);
  assert.deepEqual(writer.calls.find(c => /Concept: haunted_library /.test(c.user)).schema.schema.properties.mechanics.items.properties.role.enum, ['core', 'supporting', 'flavor'], 'no loop on offer for a setting');
  // A model that invents a loop for the setting (step 2) is re-asked there; a nested mashup with it is rejected.
  const invented = writerOf({ ...LIBRARY_PLAN,
    mechanics: (req, n, concept) => ({ mechanics: concept === 'pac_man' ? PAC_MECHANICS : n === 0 ? [{ id: 'ghost_hunt', verb: 'hunt', description: 'hunt the library ghosts', from: 'haunted_library', role: 'loop' }] : [{ id: 'shifting_shelves', verb: 'shift', description: 'shelves slide to open and close paths', from: 'haunted_library', role: 'flavor' }] }),
    spec: (req, n) => ({ ...LIBRARY_PLAN.spec, mashup: [{ relation: n === 0 ? 'nested' : 'skin', mechanics: ['maze_chase', 'shifting_shelves'], why: 'the library is the maze' }] }) });
  const skinned = await decomposeIdea({ writer: invented, prompt: 'Pac-Man in a haunted library', registry });
  assert.deepEqual(forms(invented), ['idea_concepts', 'concept_mechanics:pac_man', 'concept_mechanics:haunted_library', 'concept_mechanics_fields:haunted_library', 'play_spec', 'play_spec_fields', 'idea_about', 'idea_spaces']);
  assert.match(invented.calls[3].user, /haunted_library is a setting, which brings only content, so it has no loop mechanic \(ghost_hunt\)/);
  assert.match(invented.calls[5].user, /needs a loop from haunted_library/);
  assert.equal(skinned.mechanics.filter(m => m.importance === 'core').length, 2, 'Pac-Man\'s loop and power pellets; nothing from the library');
  assert.deepEqual(skinned.core.mashup.map(x => x.relation), ['skin']);
});

test('(e) three unrelated ideas go through the same steps and prompts, none of them special-cased', async () => {
  const ideas = [
    { prompt: 'a farming sim where crops grow by season', plan: {
      concepts: [{ id: 'farming_sim', name: 'farming sim', quote: 'a farming sim', kind: 'genre', keeps: ['planting', 'harvest'] }],
      mechanics: { farming_sim: [{ id: 'tend_crops', verb: 'plant', description: 'plant, water and harvest crops', from: 'farming_sim', role: 'loop' }, { id: 'seasons', verb: 'wait', description: 'crops grow by season', from: 'farming_sim', role: 'supporting' }] },
      spec: { loop: 'tend_crops', interaction: 'avatar-realtime', opponent: 'clock', win: 'harvest every field before winter', lose: 'the crops wither in the frost', theme: 'pastoral', narrative: false, mashup: [] },
      where: { spaces: [{ role: 'farm', kind: 'tiles-topdown', description: 'fields' }], views: ['td'], movement: 'ground' } }, calls: 5 },
    { prompt: 'Mario Kart with shopping carts', plan: {
      concepts: [{ id: 'mario_kart', name: 'Mario Kart', quote: 'Mario Kart', kind: 'game', keeps: ['kart races', 'item boxes'] }, { id: 'shopping_carts', name: 'shopping carts', quote: 'shopping carts', kind: 'theme', keeps: ['carts as the karts'] }],
      mechanics: { mario_kart: [{ id: 'kart_race', verb: 'race', description: 'race laps against rivals', from: 'mario_kart', role: 'loop' }, { id: 'item_boxes', verb: 'use', description: 'pick up and fire items', from: 'mario_kart', role: 'core' }], shopping_carts: [{ id: 'cart_handling', verb: 'drift', description: 'carts drift on wobbly wheels', from: 'shopping_carts', role: 'flavor' }] },
      spec: { loop: 'kart_race', interaction: 'avatar-realtime', opponent: 'ai-rival', win: 'cross the finish line first', lose: 'finish behind the rival carts', theme: 'supermarket', narrative: false, mashup: [{ relation: 'skin', mechanics: ['kart_race', 'cart_handling'], why: 'the karts are carts' }] },
      where: { spaces: [{ role: 'track', kind: 'continuous-3d', description: 'aisles' }], views: ['3p'], movement: 'track' } }, calls: 6 },
    { prompt: 'a detective story in a lighthouse', plan: {
      concepts: [{ id: 'detective_story', name: 'detective story', quote: 'a detective story', kind: 'genre', keeps: ['clues', 'suspects'] }, { id: 'lighthouse', name: 'lighthouse', quote: 'a lighthouse', kind: 'setting', keeps: ['the tower'] }],
      mechanics: { detective_story: [{ id: 'gather_clues', verb: 'search', description: 'search rooms for clues', from: 'detective_story', role: 'loop' }, { id: 'interrogate', verb: 'question', description: 'question suspects', from: 'detective_story', role: 'core' }], lighthouse: [] },
      spec: { loop: 'gather_clues', interaction: 'avatar-realtime', opponent: 'none', win: 'name the culprit with the clues', lose: 'accuse the wrong person', theme: 'storm and salt', narrative: true, mashup: [] },
      where: { spaces: [{ role: 'tower', kind: 'locations', description: 'rooms' }], views: ['td', 'text'], movement: 'ground' }, story: { acts: 3, zones: 5 } }, calls: 7 },
  ];
  /** @type {Map<string, Set<string>>} */
  const systems = new Map();
  for (const { prompt, plan, calls } of ideas) {
    const writer = writerOf(plan);
    const d = await decomposeIdea({ writer, prompt, registry });
    assert.equal(d.calls.length, calls, prompt);
    assert.ok(d.calls.every(c => !c.problems), `${prompt}: every check passed first time`);
    assert.equal(d.core.loop, plan.spec.loop);
    assert.deepEqual(d.concepts.map(c => c.id), plan.concepts.map(c => c.id));
    assert.equal(d.mechanics.filter(m => d.concepts.some(c => c.id === m.from)).length, d.mechanics.length, 'every mechanic comes from a concept');
    // The story's size is asked only for a narrative and never invented: a pure loop carries no act or zone count.
    assert.equal(d.acts, plan.story?.acts, 'acts asked only for a narrative');
    assert.equal(d.zones, plan.story?.zones, 'zones asked only for a narrative');
    if (!plan.spec.narrative) assert.ok(!('acts' in d) && !('zones' in d), `${prompt}: no invented counts`);
    for (const c of writer.calls) { const k = c.schema.name; if (!systems.has(k)) systems.set(k, new Set()); systems.get(k).add(c.system); }
  }
  // One system prompt per form across the three ideas: nothing in the steps depends on the idea.
  for (const [k, s] of systems) assert.equal(s.size, 1, `${k} has ${s.size} system prompts`);
});
