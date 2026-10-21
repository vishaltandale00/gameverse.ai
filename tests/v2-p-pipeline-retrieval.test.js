// Retrieval in the step path (v2/planner/retrieval.js, build.js, extend.js): coverage by declarations first, then every
// valid option (composition on resolved adapters and preflight on the partial document), in declaration order, one
// model pick. (There is no re-planning: a failing build fails with its problems.) The live "chess but with pokemon" run record
// (tests/fixtures/v2-live/chess-pokemon-retrieval.json) and unrelated specs, on the real catalogue. Scripted fake
// writers; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSelection } from '../v2/planner/build.js';
import { servesContext, MAX_LIST } from '../v2/planner/retrieval.js';
import { checkComposition, documentedBy } from '../v2/planner/compose-check.js';
import { resolveAdapters } from '../v2/planner/adapters.js';
import { buildCatalogue, dataShapes, isSpace, isGenerator, isGraphics } from '../v2/planner/catalog.js';
import { cardLoop } from '../v2/planner/loop.js';
import { normalize } from '../v2/planner/decompose.js';
import { preflight, DOC_SCHEMA } from '../v2/kernel/document.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import { fakeWriter, buildAnswer } from './v2-p-pipeline-fixtures.js';

const live = JSON.parse(readFileSync(new URL('./fixtures/v2-live/chess-pokemon-retrieval.json', import.meta.url), 'utf8'));
const { registry } = buildCatalogue();
const logic = buildLogic(registry, Logic);
const documented = documentedBy(dataShapes);
const decomposition = () => normalize(structuredClone(live.decomposition), live.prompt, registry);
/** Nothing is added by the loop steps here: each answers "none". */
const NO_STEPS = { win: [], lose: [], driver: [], coverage: [] };
const PICKS = { turn_based_move: ['gameplay.turns'], capture_opponent_piece: ['gameplay.turns'], check_and_checkmate: ['gameplay.turns'], pokemon_battle_loop: ['gameplay.creature.battle'],
  deploy_pokemon: ['gameplay.creature.party'], status_effects: ['gameplay.combat.status'] };
const liveWriter = () => fakeWriter([req => buildAnswer(req, { picks: PICKS, steps: NO_STEPS }) ?? '{}']);
/** Calls that ask about a mechanic. */
const callsFor = (w, mechanic) => w.calls.filter(c => c.user.includes(`\nMechanic ${mechanic} (`));
/** Every option id a question listed (a category question lists them on its category lines). */
const listed = c => (c.schema.name === 'pick_category' ? c.user.split('\n').filter(l => /^- \S+ \(\d+\): /.test(l)).flatMap(l => l.split('): ')[1].split(', ')) : c.schema.schema.properties.pick.enum.filter(x => x !== 'none'));

/** Preflight's capability, service, requirement and conflict errors on the partial document (adapters resolved independently). */
function structural(space, systems) {
  const r = resolveAdapters({ spaces: [space], systems }, registry, { documented });
  const doc = { schema: DOC_SCHEMA, id: 'partial', title: 'partial', spaces: [space], systems: [...systems.map(use => ({ use, ...(r.bind[use] ? { space: r.bind[use] } : {}) })), ...r.adapters] };
  return new Set(preflight(doc, registry, logic).errors.filter(e => /^(capability_missing|service_missing|requires_unmet|primitive_conflict|adapter_from_mismatch)$/.test(e.code)).map(e => `${e.code}:${e.message}`));
}
/** The catalogue cards whose declared loop serves an interaction context: what every mechanic step must account for. */
const universe = ctx => registry.cards().filter(c => !isSpace(c.id) && !isGenerator(c.id) && !isGraphics(c.id) && !c.adapts && cardLoop(c) && (cardLoop(c).verbs.length || cardLoop(c).progress.length) && servesContext(c, ctx)).map(c => c.id).sort();
/** Every option a build offered is valid: no new structural preflight error, and a capability the space lacks only comes with an adapter instance (an id when it projects a region, the needy member bound to it). */
function assertValid(b, label) {
  const space = { id: b.space.id, use: b.space.use, with: b.space.with };
  const caps = new Set(b.space.caps);
  for (const [k, s] of b.steps.entries()) {
    if (s.kind !== 'mechanic' || s.outcome === 'covered') continue;
    const before = b.steps.slice(0, k).reverse().find(x => x.kind === 'mechanic')?.collection || [];
    const had = structural(space, before);
    for (const c of s.candidates.filter(c => c.id !== b.space.use)) {
      const after = structural(space, [...new Set([...before, ...c.members])]);
      assert.deepEqual([...after].filter(x => !had.has(x)), [], `${label}/${s.mechanic}: ${c.members.join(' + ')}`);
      const lacks = c.members.flatMap(id => registry.get(id).card.requires?.capabilities || []).filter(x => !caps.has(x));
      if (lacks.length) assert.ok(c.adapters.length > 0 || b.adapters.length > 0, `${label}/${s.mechanic}: ${c.id} needs ${lacks.join(', ')} with no adapter`);
      for (const a of c.adapters) if (registry.get(a.use).card.adapts?.subspace) assert.equal(typeof a.id, 'string', `${label}: ${a.use} projects a region with an id`);
    }
  }
}

test('(a) a mechanic whose verb is a name the chosen battle loop declares is covered without a question; a phrase is asked, never split into words', async () => {
  // The verbs as the live model wrote them ("use moves", "exploit type advantages") name no declaration as a whole: they
  // are asked, and the battle loop already in the collection is among the options (re-used when picked).
  const phrased = decomposition();
  const w0 = fakeWriter([req => buildAnswer(req, { picks: { ...PICKS, pokemon_moves: ['gameplay.creature.battle'] }, steps: NO_STEPS }) ?? '{}']);
  const b0 = await buildSelection({ decomposition: phrased, registry, writer: w0 });
  const moves = b0.steps.find(s => s.kind === 'mechanic' && s.mechanic === 'pokemon_moves');
  assert.notEqual(moves.outcome, 'covered');
  assert.ok(callsFor(w0, 'pokemon_moves').length > 0, 'asked');
  assert.equal(moves.outcome, 'reused');
  assert.deepEqual(b0.mapping.pokemon_moves.primitives, ['gameplay.creature.battle']);
  // The same mechanics with the declared names as their verbs (content.moves -> moves, content.types -> types).
  const d = decomposition();
  for (const m of d.mechanics) if (m.id === 'pokemon_moves') m.verb = 'moves'; else if (m.id === 'type_advantages') m.verb = 'types';
  const w = liveWriter();
  const b = await buildSelection({ decomposition: d, registry, writer: w });
  const step = id => b.steps.find(s => s.kind === 'mechanic' && s.mechanic === id);
  assert.deepEqual(live.offered.pokemon_moves.candidates.slice(0, 2), ['gameplay.launcher', 'gameplay.falling.pieces']);
  for (const [id, section] of [['pokemon_moves', 'content.moves'], ['type_advantages', 'content.types']]) {
    const s = step(id);
    assert.equal(s.outcome, 'covered', `${id}: ${JSON.stringify(s).slice(0, 300)}`);
    assert.equal(s.primitive, 'gameplay.creature.battle');
    assert.equal(s.coverage.asked, false);
    assert.ok(s.coverage.why.includes(section), s.coverage.why);
    assert.equal(callsFor(w, id).length, 0, `${id} is never asked`);
    assert.deepEqual(b.mapping[id].primitives, ['gameplay.creature.battle']);
  }
  assert.equal(step('pokemon_battle_loop').coveredBy, undefined);
  assert.ok(step('pokemon_battle_loop').covers.includes('pokemon_moves'));
  // Statuses: the battle card declares no status section, loop verb, event or effect (only its intent mentions them),
  // and free text never matches: the mechanic is asked, and the primitive that declares content.statuses is on offer.
  assert.notEqual(step('status_effects').outcome, 'covered');
  assert.ok(step('status_effects').candidates.some(c => c.id === 'gameplay.combat.status'));
  // A chess mechanic is never covered by the pokemon loop's declarations (another concept).
  assert.ok(callsFor(w, 'check_and_checkmate').length > 0);
});

test('(b) an option needing a capability the space lacks is never offered, unless its bundle brings a working adapter', async () => {
  // The live failure: blocks.place (raycast) was offered on the grid, checked in the compact form where an adapter
  // without an id lends its host every capability it could project; the document then had the projection without an
  // id and blocks.place on the board, which preflight rejects. compose-check now agrees with preflight on that document.
  assert.ok(live.attempt.problems.some(p => /capability_missing .*blocks\.place.*raycast/.test(p)));
  const doc = { schema: DOC_SCHEMA, id: 'live', title: 'live', spaces: [{ id: 'board', use: 'engine.space.grid', with: {} }],
    systems: [...live.attempt.systems.map(use => ({ use })), { use: 'engine.adapt.projection', space: 'board', with: { kind: 'engine.space.tilemap', config: {} } }] };
  assert.ok(preflight(doc, registry, logic).errors.some(e => e.code === 'capability_missing' && /blocks\.place/.test(e.message)));
  assert.ok(checkComposition(doc, registry).failures.some(f => f.code === 'capability_missing' && f.unit === 'gameplay.blocks.place'), 'compose-check agrees with preflight');
  // The build: every option offered for every step is valid on the partial document.
  const d = decomposition();
  const b = await buildSelection({ decomposition: d, registry, writer: liveWriter() });
  assertValid(b, 'chess-pokemon');
  // Deploying is played in the battle loop's interaction (menu): never falling pieces or grid steps; blocks.place only
  // with the projection region it is bound to.
  const deploy = b.steps.find(s => s.mechanic === 'deploy_pokemon');
  assert.equal(deploy.context, 'menu');
  for (const id of ['gameplay.falling.pieces', 'gameplay.launcher', 'gameplay.move.grid']) assert.ok(!deploy.candidates.some(c => c.id === id), id);
  const place = deploy.candidates.find(c => c.id === 'gameplay.blocks.place');
  assert.deepEqual(place.adapters.map(a => [a.use, typeof a.id]), [['engine.adapt.projection', 'string']]);
  assert.ok(place.adapters[0].id, 'the region the document must carry, with blocks.place bound to it');
});

test('(c) the option list is every valid card that serves the context, with no top-8 cut; a long list asks a category first', async () => {
  const d = decomposition();
  const w = liveWriter();
  const b = await buildSelection({ decomposition: d, registry, writer: w });
  for (const s of b.steps.filter(x => x.kind === 'mechanic' && x.outcome !== 'covered')) {
    const offered = s.candidates.map(c => c.id).filter(id => id !== b.space.use);
    assert.deepEqual([...offered, ...s.rejected.map(r => r.id)].sort(), universe(s.context), s.mechanic);
    assert.ok(offered.length > 8, `${s.mechanic}: ${offered.length}`);
    // Over MAX_LIST the category question lists every option once, and the pick is over the chosen category's options.
    const all = s.candidates.map(c => c.id).sort();
    const calls = callsFor(w, s.mechanic).filter(c => c.schema.name !== 'covered_by');
    if (all.length > MAX_LIST) {
      assert.equal(calls[0].schema.name, 'pick_category');
      assert.deepEqual(listed(calls[0]).sort(), all);
      const chosen = s.asks.find(a => a.question === 'pick_category')?.pick;
      const line = calls[0].user.split('\n').find(l => l.startsWith(`- ${chosen} (`));
      if (chosen !== 'none') assert.deepEqual(listed(calls[1]).sort(), line.split('): ')[1].split(', ').sort(), `${s.mechanic}: the pick is over ${chosen}`);
    } else assert.deepEqual(listed(calls[0]).sort(), all);
  }
});

// (e) Unrelated specs on the real catalogue: nothing here knows a genre.
const IDEAS = {
  sides: { premise: 'Two armies take turns moving pieces on a board to capture the enemy king.', ref: 'chess', views: ['board'], kind: 'board', movement: 'none',
    core: { loop: 'move_pieces', interaction: 'pieces-turns', opponent: 'ai-side', win: 'capture the king', lose: 'lose the king', theme: 'war', narrative: false, mashup: [] },
    mechanics: [['move_pieces', 'core', 'move pieces across the board in turns'], ['capture', 'core', 'capture enemy pieces by moving onto them'], ['promote', 'supporting', 'promote a piece that reaches the far side']] },
  race: { premise: 'Race shopping carts around a supermarket track against rival racers.', ref: 'kart racing', views: ['3p'], kind: 'continuous-3d', movement: 'track',
    core: { loop: 'race', interaction: 'avatar-realtime', opponent: 'ai-rival', win: 'finish first', lose: '', theme: 'supermarket', narrative: false, mashup: [] },
    mechanics: [['race', 'core', 'race laps around a track against rival racers'], ['drive', 'core', 'drive and steer a cart'], ['items', 'supporting', 'pick up and use items to hinder rivals']] },
  cards: { premise: 'Duel a rival by playing cards from a deck, each turn spending mana on minions and spells.', ref: 'card duel', views: ['ui'], kind: 'none', movement: 'none',
    core: { loop: 'play_cards', interaction: 'menu', opponent: 'ai-side', win: 'reduce the rival to zero health', lose: 'reach zero health', theme: 'arcane', narrative: false, mashup: [] },
    mechanics: [['play_cards', 'core', 'play cards from a deck against a rival'], ['take_turns', 'core', 'take turns with the rival'], ['health', 'supporting', 'lose health when hit']] },
};
const ideaSpec = x => normalize({ title: x.ref, premise: x.premise, tone: x.core.theme, references: [{ name: x.ref, kind: 'game', keeps: [] }], views: x.views, movement: x.movement, acts: 1, zones: 3,
  spaces: [{ role: 'world', kind: x.kind, description: '' }], mechanics: x.mechanics.map(([id, importance, description]) => ({ id, verb: description.split(' ')[0], description, from: x.ref, importance })), core: x.core }, x.premise, registry);
/** A model that takes the first option of every question (the best-ordered one). */
const firstWriter = () => fakeWriter([req => { const p = req.schema.schema.properties; const field = p.space ? 'space' : 'pick'; return JSON.stringify({ [field]: p[field].enum[0], why: 'first', ...(p.spec ? { spec: '' } : {}) }); }]);

test('(e) three unrelated specs: every valid option is offered, each valid on the partial document, coverage only by declarations', async () => {
  for (const [name, x] of Object.entries(IDEAS)) {
    const d = ideaSpec(x);
    const w = firstWriter();
    const b = await buildSelection({ decomposition: d, registry, writer: w });
    assert.ok(b.systems.length > 0, name);
    for (const s of b.steps.filter(s => s.kind === 'mechanic')) {
      if (s.outcome === 'covered') { assert.match(s.coverage.why, /declares /, `${name}/${s.mechanic}`); continue; }
      assert.equal(s.context, x.core.interaction, `${name}/${s.mechanic}`);
      assert.deepEqual([...s.candidates.map(c => c.id).filter(id => id !== b.space.use), ...s.rejected.map(r => r.id)].sort(), universe(s.context), `${name}/${s.mechanic}`);
    }
    assertValid(b, name);
  }
});

// (f) A loop declares the set of interactions it serves (card.mode.interaction a list). The live record
// pac-man-in-a-haunted-mvi1ntkm/failed-1: played avatar-realtime, "collect all the pellets" was never offered the
// collect primitive (gameplay.collectible declared only avatar-grid), and the build failed.
const chase = interaction => ideaSpec({ premise: 'Collect all the pellets in a haunted library maze while ghosts chase you.', ref: 'maze chase', views: ['td'], kind: 'tiles-topdown', movement: 'ground',
  core: { loop: 'maze_chase', interaction, opponent: 'hazards', win: 'collect all the scattered pellets in the maze', lose: 'caught by a ghost', theme: 'haunted library', narrative: false, mashup: [] },
  mechanics: [['maze_chase', 'core', 'navigate a maze while avoiding enemies'], ['collect_pellets', 'core', 'collect pellets scattered throughout the maze for points'], ['evade_enemies', 'core', 'avoid being caught by enemies that chase the player']] });

test('(f) the collect primitive is offered for a collect mechanic played avatar-realtime and avatar-grid; a cursor-board loop is not', async () => {
  for (const interaction of ['avatar-realtime', 'avatar-grid']) {
    const b = await buildSelection({ decomposition: chase(interaction), registry, writer: firstWriter() });
    const s = b.steps.find(x => x.kind === 'mechanic' && x.mechanic === 'collect_pellets');
    assert.equal(s.context, interaction);
    assert.ok(universe(interaction).includes('gameplay.collectible'), `${interaction}: collectible serves it`);
    const offered = s.outcome === 'covered' ? [s.primitive] : [...s.candidates.map(c => c.id), ...s.rejected.map(r => r.id)];
    assert.ok(offered.includes('gameplay.collectible'), `${interaction}: ${JSON.stringify(s).slice(0, 400)}`);
    // A loop played only on a cursor board (a match-three board) is another game here: never offered.
    for (const x of b.steps.filter(x => x.kind === 'mechanic')) assert.ok(!(x.candidates || []).some(c => c.id === 'gameplay.match'), `${interaction}/${x.mechanic} offers gameplay.match`);
  }
  assert.equal(servesContext(registry.get('gameplay.match').card, 'avatar-realtime'), false);
  assert.equal(servesContext(registry.get('gameplay.match').card, 'cursor-board'), true);
});
