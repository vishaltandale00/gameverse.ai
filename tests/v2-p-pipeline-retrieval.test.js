// Retrieval in the iterative build and re-planning (v2/planner/retrieval.js, build.js, replan.js): coverage by
// declarations first, then every valid option (composition on resolved adapters and preflight on the partial document),
// one model pick, and re-planning through the same functions. The live "chess but with pokemon" run record
// (tests/fixtures/v2-live/chess-pokemon-retrieval.json) and unrelated specs, on the real catalogue. Scripted fake
// writers; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSelection } from '../v2/planner/build.js';
import { replan } from '../v2/planner/replan.js';
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

test('(a) mechanics the chosen battle loop declares as its own content are covered without a question', async () => {
  const d = decomposition();
  const w = liveWriter();
  const b = await buildSelection({ decomposition: d, registry, writer: w });
  const step = id => b.steps.find(s => s.kind === 'mechanic' && s.mechanic === id);
  // The live build offered launcher and falling pieces for the moves; now the battle loop (pokemon's concept loop)
  // declares the content they name: content.moves and content.types (its mode needs them).
  assert.deepEqual(live.offered.pokemon_moves.candidates.slice(0, 2), ['gameplay.launcher', 'gameplay.falling.pieces']);
  for (const [id, section] of [['pokemon_moves', 'content.moves'], ['type_advantages', 'content.types']]) {
    const s = step(id);
    assert.equal(s.outcome, 'covered', `${id}: ${JSON.stringify(s)}`);
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

test('(d) re-planning offers the same valid list the build offered, less the failing primitive', async () => {
  const d = normalize({ title: 'chess', premise: 'Two armies take turns moving pieces on a board to capture the enemy king.', tone: 'war', references: [{ name: 'chess', kind: 'game', keeps: [] }], views: ['board'], movement: 'none', acts: 1, zones: 3,
    spaces: [{ role: 'world', kind: 'board', description: '' }],
    mechanics: [{ id: 'move_pieces', verb: 'move', description: 'move pieces across the board in turns', from: 'chess', importance: 'core' }, { id: 'capture', verb: 'capture', description: 'capture enemy pieces by moving onto them', from: 'chess', importance: 'core' }],
    core: { loop: 'move_pieces', interaction: 'pieces-turns', opponent: 'ai-side', win: 'capture the king', lose: '', theme: 'war', narrative: false, mashup: [] } }, 'chess', registry);
  const picks = { move_pieces: ['gameplay.turns'], capture: ['gameplay.ai.brain'] };
  const w = fakeWriter([req => buildAnswer(req, { picks, steps: NO_STEPS }) ?? '{}']);
  const b = await buildSelection({ decomposition: d, registry, writer: w });
  const capture = b.steps.find(s => s.mechanic === 'capture');
  assert.equal(capture.primitive, 'gameplay.ai.brain');
  assert.deepEqual(capture.checks.closure, []);
  const selection = { spaces: [b.space], systems: [...b.systems], bind: { ...b.bind }, adapters: b.adapters, generators: [], graphics: [], gaps: [],
    mechanics: d.mechanics.map(m => ({ ...m, primitives: [...(b.mapping[m.id]?.primitives || [])], candidates: [], source: 'build', score: 1 })) };
  const w2 = fakeWriter([req => buildAnswer(req, { picks: { capture: ['gameplay.combat.melee'] }, steps: NO_STEPS }) ?? '{}']);
  const r = await replan(selection, [{ kind: 'primitive', primitive: 'gameplay.ai.brain', mechanic: 'capture', codes: ['runtime_error'], message: 'boom' }], { registry, decomposition: d, tried: new Map(), writer: w2 });
  const asked = callsFor(w2, 'capture');
  assert.ok(asked.length > 0);
  const built = capture.candidates.map(c => c.id).filter(id => id !== 'gameplay.ai.brain' && id !== b.space.use);
  assert.deepEqual(listed(asked[0]).sort(), built.sort(), 'the same valid options, the failed one left out');
  assert.match(asked.at(-1).user, /It replaces gameplay\.ai\.brain, which failed: boom/);
  assert.ok(r.actions.some(a => a.action === 'replace' && a.by === 'gameplay.combat.melee'), JSON.stringify(r.actions));
  assert.ok(r.selection.systems.includes('gameplay.combat.health'), 'its bundle (requirements closure) comes with it');
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
