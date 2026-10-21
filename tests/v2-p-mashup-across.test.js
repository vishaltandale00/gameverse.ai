// Mashups relate mechanics ACROSS concepts (v2/planner/play-spec.js mashupProblem, decompose.js): when an idea joins
// concepts (mechanic.from) whose loops each declare a win, every core.mashup entry must name mechanics of both, the
// one joined into first. An entry within one concept relates nothing: it is rejected and only that field is asked
// again. The preset then adds the adapter that realises the relation (card.adapts.relation), its params filled from
// declarations: nested (engine.adapt.nested: trigger, inner loops, outcomes), skin (engine.adapt.skin: maps), union
// (engine.adapt.projection: a region of the joined loop's space kind). Real catalogue; fake writers; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalize } from '../v2/planner/decompose.js';
import { mashupProblem, mashupSides } from '../v2/planner/play-spec.js';
import { selectPrimitives } from '../v2/planner/select.js';
import { preset } from '../v2/planner/presets.js';
import { loopProblems } from '../v2/planner/loop-check.js';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { preflight } from '../v2/kernel/document.js';
import { fakeWriter, buildAnswer } from './v2-p-pipeline-fixtures.js';

const { registry, logic } = buildCatalogue();
const live = JSON.parse(readFileSync(new URL('./fixtures/v2-live/chess-pokemon-failed.json', import.meta.url), 'utf8'));
const decomposition = () => normalize(structuredClone(live.decomposition), live.prompt, registry);
const mappedOf = id => live.selection.mechanics.find(m => m.id === id).primitives;
/** The published failure's shape: one union entry per concept, each relating that concept's own mechanics. */
const WITHIN = [{ relation: 'union', mechanics: ['turn_based_piece_movement'], why: 'chess core' }, { relation: 'union', mechanics: ['unique_abilities', 'type_advantages'], why: 'pokemon abilities' }];
const ACROSS = [{ relation: 'nested', mechanics: ['turn_based_piece_movement', 'type_advantages'], why: 'a creature battle decides each capture' }];

test('entries within one concept are rejected; an entry across the concepts completes the spec', () => {
  const d = decomposition();
  const within = mashupProblem({ ...d, core: { ...d.core, mashup: WITHIN } }, mappedOf, registry);
  assert.equal(within?.code, 'mashup_within_concept');
  assert.deepEqual(within.within, WITHIN);
  assert.match(within.message, /ACROSS concepts/);
  assert.equal(mashupProblem({ ...d, core: { ...d.core, mashup: ACROSS } }, mappedOf, registry), null);
  // A cross entry that leaves one idea out still misses it.
  const third = { ...d, mechanics: [...d.mechanics, { id: 'kart_race', verb: 'race', description: 'race karts', from: 'Mario Kart', importance: 'core' }] };
  const of = id => (id === 'kart_race' ? ['gameplay.race'] : mappedOf(id));
  assert.equal(mashupProblem({ ...third, core: { ...third.core, mashup: ACROSS } }, of, registry)?.code, 'mashup_missing');
  // The sides of an entry: the concept joined into (its first mechanic's), and the joined one.
  assert.deepEqual(mashupSides(ACROSS[0], d.mechanics), { outer: ['turn_based_piece_movement'], inner: ['type_advantages'] });
});

test('selection re-asks only core.mashup until the model relates the concepts across; then it is accepted', async () => {
  const d = decomposition();
  const answers = [WITHIN, ACROSS];
  let asked = 0;
  const writer = fakeWriter([req => {
    const name = String(req.schema?.name || '');
    // The iterative builder asks per mechanic: each picks the first primitive the live model mapped it to that is on offer.
    const built = buildAnswer(req, { picks: Object.fromEntries(live.selection.mechanics.map(m => [m.id, m.primitives])) });
    if (built) return built;
    if (name === 'decomposition_fields') return JSON.stringify({ field_1: answers[Math.min(asked++, answers.length - 1)] });
    throw Error(`unexpected form ${name}`);
  }]);
  d.core.mashup = structuredClone(WITHIN);
  const sel = await selectPrimitives({ decomposition: d, registry, writer, attempts: 3 });
  const asks = writer.calls.filter(c => c.schema.name === 'decomposition_fields');
  assert.equal(asks.length, 2, 'the within-concept answer was rejected and the field asked again');
  assert.match(asks[0].user, /one concept only/);
  assert.match(asks[1].user, /one concept only/);
  assert.deepEqual(d.core.mashup, ACROSS);
  assert.equal(sel.completeness.mashup.asked, 2);
});

test('the preset adds the matching adapters with params filled from declarations: nested and skin across chess × pokemon', () => {
  const FX = JSON.parse(readFileSync(new URL('./fixtures/v2-chess-pokemon-selection.json', import.meta.url), 'utf8'));
  const d = structuredClone(FX.decomposition);
  d.core.mashup = [...ACROSS, { relation: 'skin', mechanics: ['turn_based_piece_movement', 'unique_abilities'], why: 'creatures are the pieces' }];
  const p = preset({ decomposition: d, selection: { ...structuredClone(FX.selection), generators: [], bind: {} }, registry, logic, seed: FX.seed, prompt: FX.prompt });
  assert.equal(p.ok, true, JSON.stringify(p.errors));
  assert.deepEqual(p.gaps, []);
  // nested: the joined loop (the creature battle) is entered on the outer turn loop's declared progress event, and its
  // declared encounter outcome (card.loop.outcome) emits the results the adapter maps back, each with its sides' fates.
  const nested = p.doc.systems.find(s => s.use === 'engine.adapt.nested');
  assert.deepEqual(nested.with.inner, ['gameplay.creature.battle']);
  assert.ok(registry.get('gameplay.turns').card.loop.progress.includes(nested.with.on), nested.with.on);
  const declared = registry.get('gameplay.creature.battle').card.loop.outcome.results;
  assert.deepEqual(nested.with.outcomes.map(o => o.result), Object.keys(declared));
  const battle = p.doc.systems.find(s => s.use === 'gameplay.creature.battle');
  for (const o of nested.with.outcomes) {
    const r = declared[o.result];
    assert.ok(battle.with[r.param].some(e => e.do === 'emit' && e.event === o.on), o.on);
    assert.deepEqual(o.fates, { player: r.player, opponent: r.opponent });
    // A side defeated in the battle is taken out of play on the board the way the document declares (combat.health: kill).
    assert.deepEqual(o.do, Object.values(o.fates).includes('defeated') ? [{ do: 'kill', who: '$loser' }] : [], o.result);
  }
  // The player's side on the board: the turn loop's player-controlled sides, read from the pieces' turns.side.
  const turns = p.doc.systems.find(s => s.use === 'gameplay.turns');
  assert.deepEqual(nested.with.player, { component: 'turns', field: 'side', is: turns.with.sides.filter(x => x.control === 'player').map(x => x.id) });
  // skin: the joined concept's content fills the turn loop's pieces.
  assert.deepEqual(p.doc.systems.find(s => s.use === 'engine.adapt.skin').with.maps.map(m => [m.from, m.to]), [['content.species', 'content.archetypes']]);
  // The game it composes is the outer loop's: the turns win owns the game, the structure passes, the document preflights.
  assert.equal(p.structure.loopCheck.owner, 'gameplay.turns');
  assert.deepEqual(loopProblems(p.doc, registry, { logic }), []);
  assert.ok(preflight(p.doc, registry, logic).ok);
});

test('union across concepts: the joined race gets a region of the space kind it declares, projected by the adapter', () => {
  const caps = [...registry.get('engine.space.tilemap').capabilities({ mode: 'side' })];
  const mechanics = [{ id: 'run', verb: 'run', description: 'run and jump through the level', from: 'Mario', importance: 'core' }, { id: 'kart', verb: 'race', description: 'race rivals to the finish', from: 'Mario Kart', importance: 'core' }];
  const selection = { systems: ['engine.input.actions', 'gameplay.move.platformer', 'gameplay.race'], spaces: [{ id: 'level', use: 'engine.space.tilemap', with: { mode: 'side', size: [64, 24] }, role: 'level', caps }], generators: [], graphics: [], bind: {}, gaps: [], adapters: [],
    mechanics: [{ ...mechanics[0], primitives: ['gameplay.move.platformer'] }, { ...mechanics[1], primitives: ['gameplay.race'] }] };
  const d = { version: 't', title: 'Kart Bros', premise: 'Platform racing.', tone: '', references: [], views: ['side'], spaces: [], movement: 'ground', mechanics,
    core: { interaction: 'avatar-realtime', opponent: 'ai-rival', win: 'win the race', lose: '', theme: '', narrative: false, mashup: [{ relation: 'union', mechanics: ['run', 'kart'], why: 'the race runs through the level' }] } };
  const p = preset({ decomposition: d, selection, registry, logic, seed: 3 });
  assert.equal(p.ok, true, JSON.stringify(p.errors));
  const region = p.doc.systems.find(s => s.use === 'engine.adapt.projection');
  assert.equal(region.with.kind, 'engine.space.track', 'the kind gameplay.race declares (card.mode.space)');
  assert.equal(region.space, 'level');
  assert.equal(p.doc.systems.find(s => s.use === 'gameplay.race').space, region.id, 'the joined loop runs in the region');
  // The race's rivals are AI-controlled participants: the driver that steers by the target service the race declares
  // (card.drives.targets, card.mode.targets) joins, so they are never published standing still.
  assert.deepEqual(p.loop, []);
  assert.ok(p.doc.systems.some(s => s.use === 'gameplay.ai.seek'), JSON.stringify(p.doc.systems.map(s => s.use)));
  assert.ok(preflight(p.doc, registry, logic).ok);
});
