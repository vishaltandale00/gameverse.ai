// Template-pair conformance for mashups (ARCHITECTURE.md §1.3, §5; v2/planner/compose.js): templates compose through
// adapters, from declarations alone, for every pair of templates in the catalogue.
//   prefix   every template's document prefixed still preflights and defines only prefixed ids;
//   nested   for every ordered pair whose outer loop declares an entry event and whose inner loop declares an
//            encounter outcome, composition never throws, keeps both loops and wires engine.adapt.nested from the
//            declarations, and the result preflights and passes the loop check; a pair whose documents cannot share
//            one instance of a primitive fails with that named problem (never a dropped loop);
//   union    for every ordered pair, composition never throws: it composes into a document that passes the checks and
//            keeps both loops, or fails with a named problem (the adapter compose-check names, the zone it cannot
//            re-bind, the instance both would share);
//   play     the representative pairs (board × creature-battle nested, platformer ∪ race union) through the gate and
//            the bots their loops name, on world seeds 1-3, with replay;
//   create   "chess but with pokemon" and "Sonic racing" through createKernelPipeline with a fake writer.
// Bots run only on the representative pairs (AGENTS.md: routine CI stays lean); the static checks run on every pair.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { TEMPLATES, templateById } from '../v2/templates/registry.js';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { preflight } from '../v2/kernel/document.js';
import { createWorld } from '../v2/kernel/world.js';
import { checkComposition } from '../v2/planner/compose-check.js';
import { loopProblems } from '../v2/planner/loop-check.js';
import { verifyDocument } from '../v2/planner/verify-adapter.js';
import { createKernelPipeline } from '../v2/planner/kernel-pipeline.js';
import { composeTemplates, tuneTarget } from '../v2/planner/templates.js';
import { composeNested, composeUnion, prefixDocument, definedIds, entryTriggers, innerLoops, prefixOf, COMPOSE_RULES } from '../v2/planner/compose.js';
import { playContext, SEEDS, GATE, BOT_STEPS } from '../v2/templates/contract.js';
import { strategies, select, modeBots } from '../v2/verify/strategies/index.js';
import { modesIn } from '../v2/primitives/gameplay/modes-lib-mode.js';
import { fakeWriter } from './v2-p-pipeline-fixtures.js';

const { registry, logic } = buildCatalogue();
const cat = { registry, logic };
const part = id => ({ id, doc: templateById(id).doc });
const CODES = new Set(Object.keys(COMPOSE_RULES));
/** The loops a document plays (card.mode, wrappers left out). */
const loopsOf = doc => [...new Set(modesIn(doc, registry).filter(m => !m.mode.wraps).map(m => m.use))];
const uses = doc => new Set([...(doc.systems || []), ...(doc.spaces || []).flatMap(s => s.generators || [])].map(s => s.use));
/** Every ordered pair of distinct templates. */
const PAIRS = TEMPLATES.flatMap(a => TEMPLATES.filter(b => b !== a).map(b => [a.id, b.id]));
/** The ordered pairs a nested composition applies to: an entry event on the outer, an enterable loop in the inner. */
const NESTED = PAIRS.filter(([a, b]) => entryTriggers(templateById(a).doc, registry).length && innerLoops(templateById(b).doc, registry).length);
/** Problems that say two documents cannot share one instance of a primitive (one loop each, one value each, one id each). */
const SHARED = new Set(['compose_loop_shared', 'compose_param_conflict', 'compose_id_collision']);
const timings = {};

test('prefix: every template\'s document prefixed preflights, defines only prefixed ids and keeps its loops', () => {
  const t0 = performance.now();
  for (const t of TEMPLATES) {
    const p = prefixDocument(t.doc, 'px_', cat);
    assert.deepEqual(p.problems, [], t.id);
    const r = preflight(structuredClone(p.doc), registry, logic);
    assert.ok(r.ok, `${t.id}: ${JSON.stringify(r.errors.slice(0, 4))}`);
    for (const [domain, ids] of definedIds(p.doc, registry)) assert.deepEqual(ids.filter(id => !id.startsWith('px_')), [], `${t.id}: ${domain} ids are prefixed`);
    assert.deepEqual(loopsOf(p.doc), loopsOf(t.doc), `${t.id}: the same loops`);
    assert.deepEqual(loopProblems(r.doc, registry, { logic }), [], `${t.id}: the loop check passes prefixed`);
    assert.deepEqual(t.doc, templateById(t.id).doc, 'the template is never mutated');
  }
  timings.prefixMs = Math.round(performance.now() - t0);
});

// A reference the prefixer misses (a field the cards do not declare as one, or a declaration it does not read) leaves the
// prefixed world pointing at ids that no longer exist: pieces spawned bare, cells drawn with no block. Booting both
// documents a few steps and comparing what exists, with the prefix taken off, finds that class on every template.
test('prefix: every template\'s world boots the same prefixed: the same entities (archetype and components) and spaces', () => {
  const t0 = performance.now();
  const world = doc => {
    const rt = createWorld(preflight(structuredClone(doc), registry, logic).doc, registry, logic, { seed: 1 });
    for (let i = 0; i < 3; i++) rt.step({});
    const bare = v => JSON.parse(JSON.stringify(v, (k, x) => (k === 'vh' ? undefined : x)).split('px_').join(''));
    return { entities: Object.values(rt.state.entities).map(e => `${String(e.archetype).replace(/^px_/, '')}:${Object.keys(e.components || {}).sort()}`).sort(), spaces: bare(rt.state.spaces) };
  };
  for (const t of TEMPLATES) assert.deepEqual(world(prefixDocument(t.doc, 'px_', cat).doc), world(t.doc), t.id);
  timings.prefixWorldMs = Math.round(performance.now() - t0);
});

test(`nested: every ordered pair with an entry event and an enterable inner loop (${NESTED.length} pairs) composes from declarations, or names why the documents cannot share an instance`, t => {
  assert.ok(NESTED.length > 0);
  const t0 = performance.now(), composed = [], refused = [];
  for (const [a, b] of NESTED) {
    const r = composeNested(part(a), part(b), cat);
    const label = `${a} × ${b}`;
    if (!r.doc) {
      assert.ok(r.problems.length, `${label}: no document and no problem`);
      for (const p of r.problems) assert.ok(SHARED.has(p.code), `${label}: ${p.code} ${p.message}`);
      refused.push(`${label}: ${[...new Set(r.problems.map(p => p.code))].join(', ')}`);
      continue;
    }
    composed.push(label);
    const pre = preflight(structuredClone(r.doc), registry, logic);
    assert.ok(pre.ok, `${label}: ${JSON.stringify(pre.errors.slice(0, 4))}`);
    assert.deepEqual(loopProblems(pre.doc, registry, { logic }), [], `${label}: the loop check`);
    // Both loops are there, the inner one entered on the outer's declared event with its declared outcomes.
    for (const u of [...loopsOf(templateById(a).doc), ...loopsOf(templateById(b).doc)]) assert.ok(uses(r.doc).has(u), `${label}: ${u} is in the composed document`);
    const nested = r.doc.systems.filter(s => s.use === 'engine.adapt.nested');
    assert.equal(nested.length, 1, label);
    const trigger = entryTriggers(templateById(a).doc, registry)[0];
    assert.deepEqual([nested[0].with.on, nested[0].with.roles], [trigger.event, trigger.roles], `${label}: the entry event and its roles from card.loop.involves`);
    assert.deepEqual(nested[0].with.inner, innerLoops(templateById(b).doc, registry));
    for (const u of nested[0].with.inner) {
      const card = registry.get(u).card;
      assert.deepEqual(nested[0].with.outcomes.map(o => o.result), Object.keys(card.loop.outcome.results), `${label}: every declared result`);
      const inst = r.doc.systems.find(s => s.use === u);
      for (const [k, v] of Object.entries(card.engage.encounter.config || {})) assert.deepEqual(inst.with[k], v, `${label}: ${u} waits for the encounter (${k})`);
      for (const res of Object.values(card.loop.outcome.results)) assert.ok(!(inst.with[res.param] || []).some(e => e.do === 'end_game'), `${label}: ${u}.${res.param} ends the encounter, not the game`);
    }
  }
  t.diagnostic(`composed ${composed.length}: ${composed.join('; ')}`);
  t.diagnostic(`refused ${refused.length}: ${refused.join('; ')}`);
  timings.nestedMs = Math.round(performance.now() - t0);
});

// Every composed nested pair passes the composition check except for the inputs: a template whose input primitive
// (engine.input.motions, the fighting template's) declares only its own interactions makes compose-check require that
// every loop's interaction (pieces-turns, menu, cursor-board) be served by an input primitive, which the UI primitives
// that serve them do not declare yet (controls, HANDOFF item 3). The second test holds the rest of the check meanwhile:
// it found compose-check reading the first instance of a primitive for every unit of it (the race's goal-less course
// read with the runner's goal), fixed by reading each unit's own instance.
test('nested: every composed pair passes the composition check', { todo: "controls (HANDOFF item 3): \"mode_input_mismatch: no input primitive supports the 'pieces-turns' interaction\" (board, card-battle, tactics with fighting), \"... the 'menu' interaction\" (card-battle, creature-battle with fighting), \"... the 'cursor-board' interaction\" (rts × fighting): the UI primitives serving them declare no input interactions" }, () => {
  for (const [a, b] of NESTED) {
    const r = composeNested(part(a), part(b), cat);
    if (r.doc) assert.deepEqual(checkComposition(preflight(structuredClone(r.doc), registry, logic).doc, registry, { logic }).failures.map(f => `${f.code}: ${f.message}`), [], `${a} × ${b}`);
  }
});

test('nested: every composed pair passes the composition check but for the input interactions the controls work declares', () => {
  for (const [a, b] of NESTED) {
    const r = composeNested(part(a), part(b), cat);
    if (r.doc) assert.deepEqual(checkComposition(preflight(structuredClone(r.doc), registry, logic).doc, registry, { logic }).failures.filter(f => f.code !== 'mode_input_mismatch').map(f => `${f.code}: ${f.message}`), [], `${a} × ${b}`);
  }
});

test(`union: every ordered pair (${PAIRS.length}) composes into a document that passes the checks with both loops, or fails with a named problem; never throws`, t => {
  const t0 = performance.now(), composed = [], failed = {};
  for (const [a, b] of PAIRS) {
    const label = `${a} ∪ ${b}`;
    const r = composeUnion(part(a), part(b), cat);
    if (r.united) for (const u of [...loopsOf(templateById(a).doc), ...loopsOf(templateById(b).doc).filter(u => !r.problems.some(p => p.code === 'union_world_loop' && p.path === u))])
      assert.ok(uses(r.united).has(u), `${label}: ${u} is never dropped`);
    if (!r.doc) {
      assert.ok(r.problems.length, `${label}: no document and no problem`);
      for (const p of r.problems) assert.ok(CODES.has(p.code), `${label}: ${p.code} is a declared composition problem`);
      for (const p of r.problems.filter(x => x.code === 'union_needs_adapter')) assert.match(p.message, /\[[a-z_]+\]/, `${label}: names the composition check's failure`);
      for (const code of new Set(r.problems.map(p => p.code))) (failed[code] ??= []).push(label);
      continue;
    }
    composed.push(label);
    const pre = preflight(structuredClone(r.doc), registry, logic);
    assert.ok(pre.ok, `${label}: ${JSON.stringify(pre.errors.slice(0, 4))}`);
    assert.deepEqual(checkComposition(pre.doc, registry, { logic }).failures, [], label);
    assert.deepEqual(loopProblems(pre.doc, registry, { logic }), [], label);
    assert.deepEqual(r.doc.spaces.map(s => s.id), templateById(a).doc.spaces.map(s => s.id), `${label}: one world, the primary's`);
    for (const u of [...loopsOf(templateById(a).doc), ...loopsOf(templateById(b).doc)]) assert.ok(uses(r.doc).has(u), `${label}: ${u} in the united document`);
  }
  t.diagnostic(`composed ${composed.length}: ${composed.join('; ')}`);
  for (const [code, labels] of Object.entries(failed)) t.diagnostic(`${code} ${labels.length}: ${labels.join('; ')}`);
  timings.unionMs = Math.round(performance.now() - t0);
});

/** The gate and the bots the document's loops name: viable, the gate plays those bots, and each of `run` (default: all of them) wins on SEEDS and replays. */
async function plays(doc, run = null) {
  const v = await verifyDocument(structuredClone(doc), registry, logic, { ...GATE });
  assert.ok(v.viable, `${v.viability} ${JSON.stringify((v.problems || []).filter(p => p.severity === 'error')).slice(0, 600)}`);
  const ctx = playContext(preflight(structuredClone(doc), registry, logic), registry, logic);
  const named = modeBots(ctx).map(x => x.s.id);
  assert.deepEqual(select(ctx).chosen.map(c => c.s.id), named, 'the gate plays the bots the loops name');
  for (const id of run ?? named) {
    const opts = { maxSteps: BOT_STEPS, seeds: [...SEEDS] };
    const a = strategies.get(id).run(ctx, opts), b = strategies.get(id).run(ctx, opts);
    assert.equal(a.ok, true, `${id}: ${JSON.stringify(a.problems).slice(0, 400)}`);
    const runs = a.metrics.runs ?? a.metrics.matches;
    assert.deepEqual(runs.map(r => [r.seed, r.status]), SEEDS.map(s => [s, 'won']), `${id} wins every world seed`);
    const strip = rs => rs.map(({ budget, ...x }) => x);
    assert.ok(isDeepStrictEqual(strip(b.metrics.runs ?? b.metrics.matches), strip(runs)), `${id} replays`);
  }
  return named;
}

test('play: board × creature-battle nested on attack_hit, species skinned onto the pieces; the gate finds it viable and both bots win', async () => {
  const t0 = performance.now();
  const r = composeNested(part('board'), part('creature-battle'), cat);
  assert.deepEqual(r.problems, []);
  assert.equal(r.nested.on, 'attack_hit');
  assert.deepEqual(r.nested.skin, [{ from: 'content.species', to: 'content.archetypes' }]);
  // Every piece stands for a species of the battle (the skin's pairs), and the battle runs in the creature arena.
  const pieces = r.doc.content.archetypes.filter(a => a.components?.turns);
  assert.ok(pieces.length >= 2 && pieces.every(a => r.doc.content.species.some(s => s.id === a.components.skin?.id)), JSON.stringify(pieces.map(a => a.components.skin)));
  assert.deepEqual(r.doc.spaces.map(s => [s.id, s.use]), [['board', 'engine.space.grid'], [`${prefixOf('creature-battle')}arena`, 'engine.space.none']]);
  assert.deepEqual(await plays(r.doc), ['turn-board', 'balance']);
  timings.playNestedMs = Math.round(performance.now() - t0);
});

// The union of the platformer and the race: the race's loop on the platformer's level. Its checkpoints are the level's
// zones, its rivals are seated beside the player, the kart its template moved its own player in is not carried (the
// player and how it moves are the primary's), and its win ends nothing (the game's win is the primary's goal).
test('play: platformer ∪ race on the level; the gate finds it viable and the primary\'s bot wins', async () => {
  const t0 = performance.now();
  const r = composeUnion(part('platformer'), part('race'), cat);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.union.replaced.movement, ['gameplay.vehicle.car', 'gameplay.vehicle.core']);
  assert.deepEqual(r.doc.systems.find(s => s.use === 'gameplay.race').with.checkpoints, templateById('platformer').doc.spaces[0].zones.map(z => z.id));
  const ctx = playContext(preflight(structuredClone(r.doc), registry, logic), registry, logic);
  assert.deepEqual(modeBots(ctx).map(x => x.s.id), ['platformer', 'race'], 'the gate plays both loops\' bots');
  await plays(r.doc, ['platformer']);
  timings.playUnionMs = Math.round(performance.now() - t0);
});

// The race on the platformer's level is run on foot: the course crosses pits and hazards that only the jump key clears,
// so the race bot runs to each checkpoint zone the way the platformer bot runs to its goal (race.js: platformRunner on a
// space with gravity and paths), through the level's controls. The race's win ends nothing in the union (the game's win
// is the primary's goal), so winning the race is finishing first: place 1 after every lap, on world seeds 1-3, the
// same runs on a second play.
test('play: platformer ∪ race: the race bot wins the race on foot through the level\'s controls on world seeds 1-3', () => {
  const t0 = performance.now();
  const r = composeUnion(part('platformer'), part('race'), cat);
  const ctx = playContext(preflight(structuredClone(r.doc), registry, logic), registry, logic);
  const race = r.doc.systems.find(s => s.use === 'gameplay.race').with;
  const opts = { maxSteps: BOT_STEPS, seeds: [...SEEDS] };
  const a = strategies.get('race').run(ctx, opts), b = strategies.get('race').run(ctx, opts);
  assert.equal(a.ok, true, JSON.stringify(a.problems).slice(0, 400));
  assert.deepEqual(a.metrics.runs.map(x => [x.seed, x.place, x.lap]), SEEDS.map(s => [s, 1, race.laps]), JSON.stringify(a.metrics.runs.map(({ path, ...x }) => x)));
  assert.ok(a.metrics.runs.every(x => x.path.some(m => m.startsWith('run '))), 'on foot: the platform runner ran the course');
  const strip = rs => rs.map(({ budget, ...x }) => x);
  assert.deepEqual(strip(b.metrics.runs), strip(a.metrics.runs), 'replays');
  timings.playUnionRaceMs = Math.round(performance.now() - t0);
});

// ---------- create, end to end, with a fake writer ----------

/** A fake model for a mashup idea: the pick, each tune slot at its composed value, a themed name for every entry. */
function mashupWriter(pick) {
  const composed = composeTemplates(pick, { templates: TEMPLATES, registry, logic });
  return fakeWriter([req => {
    const name = req.schema.name, props = req.schema.schema.properties;
    if (name === 'pick_templates') return JSON.stringify(pick);
    if (name === 'frame_tune') return JSON.stringify(Object.fromEntries(Object.entries(props).map(([k, p]) => {
      if (k === 'logline') return [k, `${pick.title}.`];
      const target = tuneTarget(composed.doc, String(p.description).split(':')[0], registry);
      return [k, target.instances[0].with?.[target.param] ?? target.spec.default];
    })));
    const names = ps => Object.fromEntries(Object.entries(ps).map(([k, p]) => [k, p.type === 'object' ? names(p.properties) : `Mon ${k}`.slice(0, 40)]));
    return JSON.stringify(names(props));
  }]);
}
function memoryCtx() {
  const versions = [], stages = [];
  return { versions, stages, ctx: {
    stage(name, detail = {}) { stages.push({ name, ...detail }); }, draft() {}, checkpoint() {},
    async publish(p) { const r = { version: versions.length + 1, ...p }; versions.push(r); return r; },
    store: { async updateMeta() {}, async version(_, v) { return versions[v - 1]; } },
  } };
}
const CHESS = { title: 'Pocket Gambit', premise: 'Chess where every capture is a creature battle between the two pieces. Win the battle to take the square.',
  primary: { name: 'chess', kind: 'game', template: 'board' }, games: [{ name: 'Pokémon', kind: 'game', template: 'creature-battle', relation: 'nested' }], themes: [], readings: [], mechanics: [] };
const SONIC = { title: 'Sonic Racing', premise: 'Sonic races his rivals through a level of loops and pits.',
  primary: { name: 'Sonic the Hedgehog', kind: 'game', template: 'platformer' }, games: [{ name: 'Racing', kind: 'genre', template: 'race', relation: 'union' }], themes: [], readings: [], mechanics: [] };

test('create "chess but with pokemon": board primary, creature-battle nested, species skinned; publishes in at most 6 calls and 2 rounds', async () => {
  const t0 = performance.now();
  const writer = mashupWriter(CHESS), m = memoryCtx();
  const pipeline = createKernelPipeline({ catalogue: async () => cat, writers: { spec: writer } });
  const out = await pipeline({ gameId: 'g', prompt: 'chess but with pokemon', kind: 'create', seed: 7 }, m.ctx);
  assert.equal(m.versions.length, 1);
  const v = m.versions[0], report = v.report;
  assert.equal(report.path, 'template');
  assert.deepEqual(report.templates, ['board', 'creature-battle']);
  assert.ok(report.modelCalls <= 6, `${report.modelCalls} calls`); assert.equal(report.modelCalls, writer.calls.length);
  assert.equal(report.modelRounds, 2);
  assert.deepEqual(report.content.map(f => f.form), ['frame_tune', 'names_board', 'names_creature_battle']);
  assert.equal(report.verified, true);
  for (const use of ['gameplay.turns', 'gameplay.creature.battle', 'engine.adapt.nested', 'engine.adapt.skin']) assert.ok(v.doc.systems.some(s => s.use === use), use);
  assert.ok(v.doc.content.species.every(s => s.name.startsWith('Mon ')), 'the species are themed');
  assert.equal(out.path, 'template');
  timings.createChessMs = Math.round(performance.now() - t0);
  timings.chessRequestToFirstPlayableMs = report.timings.requestToFirstPlayableMs;
});

test('create "Sonic racing": platformer ∪ race publishes the union, or fails loudly naming what is missing; never a substitute', async () => {
  const writer = mashupWriter(SONIC), m = memoryCtx();
  const pipeline = createKernelPipeline({ catalogue: async () => cat, writers: { spec: writer } });
  let error = null;
  try { await pipeline({ gameId: 'g', prompt: 'Sonic racing', kind: 'create', seed: 7 }, m.ctx); } catch (e) { error = e; }
  if (!error) {
    assert.deepEqual(m.versions[0].report.templates, ['platformer', 'race']);
    assert.ok(m.versions[0].report.modelCalls <= 6);
    return;
  }
  assert.equal(m.versions.length, 0, 'nothing publishes');
  assert.equal(error.status, 422);
  assert.ok(CODES.has(error.code) || ['not_playable', 'composition_defect'].includes(error.code), error.code);
  assert.match(error.message, /'race'.*'platformer'|union/);
  assert.ok(m.stages.some(s => s.name === 'not_buildable' && s.missing.length), 'the build says what is missing');
  if (error.report?.stage === 'composition') assert.equal(writer.calls.length, 1, 'only the pick was asked: a composition that fails asks no content');
});

test('create "Sonic racing" publishes platformer ∪ race in at most 6 calls and 2 rounds', async () => {
  const t0 = performance.now();
  const writer = mashupWriter(SONIC), m = memoryCtx();
  await createKernelPipeline({ catalogue: async () => cat, writers: { spec: writer } })({ gameId: 'g', prompt: 'Sonic racing', kind: 'create', seed: 7 }, m.ctx);
  assert.equal(m.versions.length, 1);
  assert.ok(m.versions[0].report.modelCalls <= 6);
  assert.equal(m.versions[0].report.modelRounds, 2);
  assert.deepEqual(m.versions[0].report.templates, ['platformer', 'race']);
  assert.equal(m.versions[0].report.verified, true);
  for (const use of ['gameplay.race', 'gameplay.goal', 'gameplay.move.platformer']) assert.ok(m.versions[0].doc.systems.some(s => s.use === use), use);
  timings.createSonicMs = Math.round(performance.now() - t0);
  timings.sonicModelCalls = m.versions[0].report.modelCalls;
  timings.sonicRequestToFirstPlayableMs = m.versions[0].report.timings.requestToFirstPlayableMs;
});

test('timings (AGENTS.md: reported, not budgeted)', t => { t.diagnostic(JSON.stringify(timings)); });
