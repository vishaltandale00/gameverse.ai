// The structural loop check (v2/planner/loop-check.js), the preset that writes loop structure from declarations
// (presets.js repairLoop) and the figure-it-out loop that re-plans from it (replan.js, kernel-pipeline.js), proven on
// three unrelated minimal collections of test primitives, none of which the planner knows by id:
//   sides    a turn-based duel between camps: participants with control, a component the win reads, moves as data;
//   collect  a real-time forage: the win counts an event some player-driven primitive must produce;
//   race     runners on a course: participants as a member list, the win reads laps.
// For each: the check catches a broken structure, the preset produces a passing one, and the replan loop repairs a
// seeded failure with scripted fake writers (no network). The same rules hold for the real catalogue's turn loop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loopProblems, loopReport, LOOP_CODES } from '../v2/planner/loop-check.js';
import { preset, repairLoop } from '../v2/planner/presets.js';
import { diagnose, replan } from '../v2/planner/replan.js';
import { createKernelPipeline } from '../v2/planner/kernel-pipeline.js';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { preflight } from '../v2/kernel/document.js';
import { PRIMITIVES } from '../v2/primitives/index.js';
import { testCatalogue, fakeWriter, buildAnswer, decomposer, planFrom } from './v2-p-pipeline-fixtures.js';

const real = id => PRIMITIVES.find(p => p.id === id);
const hp = e => e.components.vigor.hp ?? e.components.vigor.max;
const bound = (effects, target) => JSON.parse(JSON.stringify(effects).replace(/"who":"target"/g, `"who":${JSON.stringify(target)}`));

// ---------- sides: a turn-based duel between camps ----------
/** Vigor: owns the component the duel's win reads, and the effect that wears it down. */
const vigor = {
  id: 'gameplay.test.vigor',
  card: {
    intent: 'Vigor: units faint when their vigor runs out; sap wears it down.', params: {}, provides: { events: ['fainted'] }, loop: { verbs: [], progress: ['fainted'] },
    components: { vigor: { type: 'object', fields: { max: { type: 'number', min: 1, required: true, effect: 'vigor points' }, hp: { type: 'number' }, out: { type: 'boolean' } }, effect: 'stamina a unit faints without' } },
  },
  logic(l) { l.effect('sap', { run: (e, rt, c) => { const t = rt.resolve(e.who, c); const v = t?.components?.vigor; if (!v || v.out) return; v.hp = hp(t) - (e.amount ?? 1); if (v.hp <= 0) { v.out = true; rt.emit('fainted', { who: t.id }); } } }); },
  install() {},
};
/** A duel loop: camps take part (engage.join seats the player), its win reads the opponents' vigor, moves are data. */
const duelOf = (id, { example = true } = {}) => ({
  id,
  card: {
    intent: 'Two camps trade blows in turns until one camp has no one standing.',
    loop: { verbs: ['duel_move'], progress: ['duel_blow', 'fainted'], interaction: 'pieces-turns', opponent: 'ai-side', needs: { participants: 'camps' },
      win: { param: 'onTriumph', reads: { component: 'vigor', of: 'opponents' } }, lose: { param: 'onRout' } },
    engage: { join: { param: 'camps', field: 'members', where: { control: 'player' } } },
    components: { camp: { type: 'object', fields: { side: { type: 'string', required: true, effect: 'the camps[] id this unit fights for' } } } },
    content: [
      { need: 'param', param: 'camps', min: 2, why: 'a duel needs two camps' },
      { need: 'archetypes', component: 'camp', min: 1, placed: 2, why: 'camps are made of units', example: { id: 'brawler', kind: 'npc', components: { camp: { side: 'red' }, vigor: { max: 2 } } } },
    ],
    params: {
      camps: { type: 'list', default: [{ id: 'red', control: 'player', members: ['player'] }, { id: 'blue', control: 'ai', members: [] }],
        of: { type: 'object', fields: { id: { type: 'string', required: true }, control: { type: 'string', options: ['player', 'ai'], default: 'ai' }, members: { type: 'list', of: { type: 'string' }, default: [] } } } },
      moves: { type: 'list', default: [{ id: 'feint', onHit: [] }], of: { type: 'object', fields: { id: { type: 'string', required: true }, onHit: { type: 'effects', default: [] } } },
        ...(example ? { example: [{ id: 'jab', onHit: [{ do: 'sap', who: 'target', amount: 1 }] }] } : {}) },
      onTriumph: { type: 'effects', default: [] }, onRout: { type: 'effects', default: [] },
    },
    provides: { actions: ['duel_move'], events: ['duel_blow'] },
  },
  install(rt, config) {
    const mine = config.camps.find(c => c.control === 'player')?.id;
    const foes = () => rt.query('camp', 'vigor').filter(e => e.components.camp.side !== mine).sort((a, b) => a.id.localeCompare(b.id));
    rt.store(id).playerCamp = mine;
    rt.action('duel_move', (v, r) => { if (!v) return; const t = foes().find(e => hp(e) > 0); if (!t) return; for (const m of config.moves) r.run(bound(m.onHit, t.id), {}); r.emit('duel_blow', {}); });
    rt.system('rules', () => { const s = rt.store(id), f = foes(); if (!s.done && f.length && f.every(e => hp(e) <= 0)) { s.done = true; rt.run(config.onTriumph); } }, id);
  },
  progress(rt) { return rt.query('camp', 'vigor').filter(e => e.components.camp.side !== rt.store(id).playerCamp && hp(e) <= 0).length; },
});
const duel = duelOf('gameplay.test.duel');
/** The same duel without a declared example move: nothing in it can wear an opponent down. */
const standoff = duelOf('gameplay.test.standoff', { example: false });
/** A player verb that saps an opposing unit (it requires the vigor owner): what re-planning adds to the standoff. */
const jabber = {
  id: 'gameplay.test.jabber',
  card: { intent: 'Jab: a quick blow that saps an opposing unit of its vigor.', loop: { verbs: ['jab'], progress: ['jabbed'] }, params: {}, provides: { actions: ['jab'], events: ['jabbed'] }, requires: { primitives: ['gameplay.test.vigor'] } },
  install(rt) {
    rt.action('jab', (v, r) => {
      if (!v) return;
      const mine = Object.values(r.state.prim).map(s => s?.playerCamp).filter(Boolean);
      const t = r.query('camp', 'vigor').sort((a, b) => a.id.localeCompare(b.id)).find(e => !mine.includes(e.components.camp.side) && hp(e) > 0);
      if (t) { r.run([{ do: 'sap', who: t.id, amount: 1 }], {}); r.emit('jabbed', {}); }
    });
  },
};

// ---------- collect: a real-time forage ----------
/** Forage: the win counts gathered events; it produces none itself (a player-driven primitive must). */
const forage = {
  id: 'gameplay.test.forage',
  card: { intent: 'Forage the meadow for berries while avoiding stinging bees; enough berries wins.', loop: { verbs: [], progress: ['gathered'], interaction: 'avatar-realtime', opponent: 'hazards', win: { when: { count: 'gathered', gte: '$target' } }, lose: { param: 'onStung' } },
    params: { onStung: { type: 'effects', default: [] } }, provides: { events: ['stung'] } },
  install() {},
};
/** Pluck: the player's verb that gathers a berry. */
const pluck = {
  id: 'gameplay.test.pluck',
  card: { intent: 'Pluck a berry from a bush: gathers forage.', loop: { verbs: ['pluck'], progress: ['gathered'] }, params: {}, provides: { actions: ['pluck'], events: ['gathered'] } },
  install(rt) { rt.action('pluck', (v, r) => { if (v) r.emit('gathered', {}); }); },
};

// ---------- race: runners on a course ----------
/** A race whose runners are a member list; its win reads laps. `example`: the runners its content declares. */
const raceOf = (id, { example = true } = {}) => ({
  id,
  card: {
    intent: 'Run laps of the course against rival runners; finish the laps first.',
    loop: { verbs: ['stride'], progress: ['strode', 'lap_done'], interaction: 'avatar-realtime', opponent: 'ai-rival', needs: { participants: 'runners' },
      win: { param: 'onFinish', reads: { event: 'lap_done' } }, lose: { param: 'onBeaten' } },
    content: [{ need: 'param', param: 'runners', min: 2, why: 'a race needs rivals', ...(example ? { example: ['player', 'rival'] } : {}) }],
    params: { runners: { type: 'list', of: { type: 'string' }, default: [] }, laps: { type: 'integer', default: 2, min: 1, max: 9 }, onFinish: { type: 'effects', default: [] }, onBeaten: { type: 'effects', default: [] } },
    provides: { actions: ['stride'], events: ['strode', 'lap_done'] },
  },
  install(rt, config) {
    rt.action('stride', (v, r) => {
      if (!v) return;
      const s = r.store(id); s.n = (s.n || 0) + 1; r.emit('strode', {});
      if (s.n % 3 === 0) { s.laps = (s.laps || 0) + 1; r.emit('lap_done', {}); if (s.laps === config.laps) r.run(config.onFinish); }
    });
  },
  progress(rt) { return rt.store(id).laps || 0; },
});
const sprint = raceOf('gameplay.test.sprint');
/** A race whose card declares no runners at all (no default, no example): its participants cannot be derived. */
const scramble = raceOf('gameplay.test.scramble', { example: false });

const BASE = [real('engine.spawner'), real('plot.ending'), real('engine.input.actions')];
const catalogue = () => testCatalogue([...BASE, vigor, duel, standoff, jabber, forage, pluck, sprint, scramble]);
const graph = registry => ({ id: 'field', use: 'engine.space.graph', with: {}, role: 'field', caps: [...registry.get('engine.space.graph').card.provides.capabilities] });
/** A selection mapping one core mechanic to `systems`. */
const selectionOf = (registry, systems, description) => ({ systems: [...systems], spaces: [graph(registry)], generators: [], graphics: [], bind: {}, gaps: [], adapters: [],
  mechanics: [{ id: 'core', verb: description.split(' ')[0], description, importance: 'core', primitives: systems.filter(s => s.startsWith('gameplay.')), candidates: [], source: 'test', score: 1, from: '' }] });
const decompositionOf = (description, core) => ({ version: 'test', title: 'Test Game', premise: `${description}. A test.`, tone: 'brisk', references: [], views: ['ui'], spaces: [], movement: 'none', acts: 1, zones: 2,
  mechanics: [{ id: 'core', verb: description.split(' ')[0], description, from: '', importance: 'core' }], core: { theme: '', narrative: false, mashup: [], lose: '', ...core } });
const COLLECTIONS = {
  sides: { systems: ['gameplay.test.duel'], description: 'two camps trade blows in turns until one camp falls', core: { interaction: 'pieces-turns', opponent: 'ai-side', win: 'the other camp falls' } },
  collect: { systems: ['gameplay.test.forage', 'gameplay.test.pluck'], description: 'forage berries in real time while avoiding bees', core: { interaction: 'avatar-realtime', opponent: 'hazards', win: 'gather enough berries' } },
  race: { systems: ['gameplay.test.sprint'], description: 'run laps of the course against rival runners', core: { interaction: 'avatar-realtime', opponent: 'ai-rival', win: 'finish the laps first' } },
};
const build = (name, cat = catalogue(), systems = COLLECTIONS[name].systems) => {
  const c = COLLECTIONS[name];
  return preset({ decomposition: decompositionOf(c.description, c.core), selection: selectionOf(cat.registry, systems, c.description), registry: cat.registry, logic: cat.logic, seed: 5 });
};
const codes = (doc, registry, core) => loopProblems(doc, registry, { core }).map(p => p.code).sort();
const inst = (doc, use) => doc.systems.find(s => s.use === use);

test('the preset writes a passing loop structure for three unrelated collections, from their declarations alone', () => {
  const { registry, logic } = catalogue();
  for (const name of Object.keys(COLLECTIONS)) {
    const p = build(name);
    assert.equal(p.ok, true, `${name}: ${JSON.stringify(p.errors)}`);
    assert.deepEqual(p.loop, [], `${name}: ${JSON.stringify(p.loop)}`);
    assert.deepEqual(codes(p.doc, registry, COLLECTIONS[name].systems), [], name);
    assert.ok(preflight(p.doc, registry, logic).ok, name);
  }
  // sides: the default move saps nothing, so the card's declared example joins; the camps keep their declared control;
  // both camps get the content example's units, carrying the vigor the win reads.
  const sides = build('sides');
  assert.deepEqual(inst(sides.doc, 'gameplay.test.duel').with.moves.map(m => m.id), ['feint', 'jab']);
  assert.deepEqual(inst(sides.doc, 'gameplay.test.duel').with.camps?.map(c => c.control) ?? ['player', 'ai'], ['player', 'ai']);
  const seats = inst(sides.doc, 'engine.spawner').with.rules;
  assert.ok(seats.some(r => (r.components?.camp?.side ?? 'red') === 'red') && seats.some(r => r.components?.camp?.side === 'blue'), JSON.stringify(seats));
  assert.ok(sides.doc.content.archetypes.find(a => a.id === 'brawler').components.vigor);
  // collect: the `when` win gets its ending and the evaluator that reads plot.endings.
  const collect = build('collect');
  assert.ok(collect.doc.systems.some(s => s.use === 'plot.ending'));
  assert.ok(collect.doc.plot.endings.some(e => e.outcome === 'won' && e.when?.count === 'gathered'));
  // race: the runners come from the content contract's example; finish and defeat are wired.
  const race = build('race');
  assert.deepEqual(inst(race.doc, 'gameplay.test.sprint').with.runners, ['player', 'rival']);
  assert.ok(inst(race.doc, 'gameplay.test.sprint').with.onFinish.some(e => e.do === 'end_game'));
  assert.ok(inst(race.doc, 'gameplay.test.sprint').with.onBeaten.some(e => e.do === 'end_game'));
});

test('the check catches each broken structure with a stable code, path and hint', () => {
  const { registry } = catalogue();
  const core = ids => ids;
  // sides: no affecting action, no opponent camp, the read component unowned, an opponent without it.
  const sides = build('sides').doc;
  const sidesCore = core(COLLECTIONS.sides.systems);
  const noJab = structuredClone(sides); inst(noJab, 'gameplay.test.duel').with.moves = [{ id: 'feint', onHit: [] }];
  const unaffected = loopProblems(noJab, registry, { core: sidesCore });
  assert.deepEqual(unaffected.map(p => p.code), [LOOP_CODES.unaffected]);
  assert.equal(unaffected[0].path, 'systems[' + noJab.systems.findIndex(s => s.use === 'gameplay.test.duel') + ']');
  assert.match(unaffected[0].hint, /action/);
  assert.deepEqual(unaffected[0].need, { kind: 'action', component: 'vigor', owners: ['gameplay.test.vigor'], of: 'opponents' });
  const allMine = structuredClone(sides); inst(allMine, 'gameplay.test.duel').with.camps = [{ id: 'red', control: 'player', members: ['player'] }, { id: 'blue', control: 'player', members: [] }];
  assert.ok(codes(allMine, registry, sidesCore).includes(LOOP_CODES.opponent));
  const unseated = structuredClone(sides); inst(unseated, 'gameplay.test.duel').with.camps = [{ id: 'red', control: 'ai', members: [] }, { id: 'blue', control: 'ai', members: [] }];
  assert.ok(codes(unseated, registry, sidesCore).includes(LOOP_CODES.seat));
  const unowned = structuredClone(sides); unowned.systems = unowned.systems.filter(s => s.use !== 'gameplay.test.vigor');
  assert.ok(codes(unowned, registry, sidesCore).includes(LOOP_CODES.owner));
  const frail = structuredClone(sides); delete frail.content.archetypes.find(a => a.id === 'brawler').components.vigor;
  assert.ok(codes(frail, registry, sidesCore).includes(LOOP_CODES.component));
  const empty = structuredClone(sides); inst(empty, 'engine.spawner').with.rules = [];
  assert.ok(codes(empty, registry, sidesCore).includes(LOOP_CODES.group));
  // collect: the win unwired (its `when` ending has no evaluator), and nothing player-driven produces what it counts.
  const collect = build('collect').doc;
  const collectCore = COLLECTIONS.collect.systems;
  const noEvaluator = structuredClone(collect); noEvaluator.systems = noEvaluator.systems.filter(s => s.use !== 'plot.ending');
  const unwired = loopProblems(noEvaluator, registry, { core: collectCore });
  assert.deepEqual(unwired.map(p => p.code), [LOOP_CODES.win]);
  assert.match(unwired[0].message, /no evaluator/);
  const noPluck = structuredClone(collect); noPluck.systems = noPluck.systems.filter(s => s.use !== 'gameplay.test.pluck');
  assert.deepEqual(loopProblems(noPluck, registry, { core: ['gameplay.test.forage'] }).map(p => [p.code, p.need.kind, p.need.event]), [[LOOP_CODES.unaffected, 'event', 'gathered']]);
  // race: one runner, and the finish unwired.
  const race = build('race').doc;
  const alone = structuredClone(race); inst(alone, 'gameplay.test.sprint').with.runners = ['player'];
  assert.deepEqual(codes(alone, registry, ['gameplay.test.sprint']), [LOOP_CODES.participants, LOOP_CODES.opponent].sort());
  const unfinished = structuredClone(race); inst(unfinished, 'gameplay.test.sprint').with.onFinish = [];
  assert.deepEqual(codes(unfinished, registry, ['gameplay.test.sprint']), [LOOP_CODES.win]);
  // Every broken structure the declarations can fix, the structural repair fixes (the model's content is kept).
  for (const [doc, core] of [[noJab, sidesCore], [allMine, sidesCore], [unseated, sidesCore], [unowned, sidesCore], [frail, sidesCore], [empty, sidesCore], [noEvaluator, collectCore], [alone, ['gameplay.test.sprint']], [unfinished, ['gameplay.test.sprint']]]) {
    const r = repairLoop(doc, registry, { core });
    assert.deepEqual(r.problems, [], JSON.stringify(r.problems));
    assert.ok(r.fixes.length);
  }
  // What no declaration provides is reported, not invented: the standoff declares no move that saps.
  const stand = build('sides', catalogue(), ['gameplay.test.standoff']);
  assert.deepEqual(stand.loop.map(p => p.code), [LOOP_CODES.unaffected]);
});

test('the published chess x pokemon failure is caught statically; the real turn loop passes once the preset wires it', () => {
  const { registry, logic } = buildCatalogue();
  // The failure class (local-data chess-but-with-pokemon v1): the turns loop's win reads the opponents' health, and its
  // only hostile action had no effects. The document's structure, reduced to what the check reads.
  const doc = { schema: 'gameverse.v2.game/0.2', id: 'x', title: 'x', seed: 1, spaces: [{ id: 'board', use: 'engine.space.grid', with: { size: [8, 8] }, zones: [] }],
    systems: [
      { use: 'engine.spawner', with: { rules: [{ id: 'w1', archetype: 'pawn_w', space: 'board', at: [0, 7], unique: true }, { id: 'b1', archetype: 'pawn_b', space: 'board', at: [0, 0], unique: true }] } },
      { use: 'gameplay.combat.health' },
      { use: 'gameplay.turns', with: { sides: [{ id: 'white', control: 'player', members: ['player'] }, { id: 'black', control: 'ai', members: [] }], actions: [{ id: 'type_strike', target: 'unit', hostile: true, do: [], onHit: [] }], onVictory: [{ do: 'end_game', ending: 'victory' }], onDefeat: [{ do: 'end_game', ending: 'defeat' }] } }],
    plot: { endings: [{ id: 'victory', outcome: 'won' }, { id: 'defeat', outcome: 'lost' }] },
    content: { archetypes: [{ id: 'player_side', kind: 'player' }, { id: 'pawn_w', components: { turns: { side: 'white' }, health: { max: 3 } } }, { id: 'pawn_b', components: { turns: { side: 'black' }, health: { max: 3 } } }] },
    player: { archetype: 'player_side', space: 'board' } };
  const found = loopReport(doc, registry, { logic });
  assert.equal(found.owner, 'gameplay.turns');
  assert.deepEqual(found.problems.filter(p => p.severity === 'error').map(p => p.code), [LOOP_CODES.unaffected]);
  // The repair takes the turn card's declared example action (its effect is owned by the health primitive).
  const fixed = repairLoop(doc, registry, { logic });
  assert.deepEqual(fixed.problems, []);
  const actions = inst(fixed.doc, 'gameplay.turns').with.actions;
  assert.deepEqual(actions.map(a => a.id), ['type_strike', 'strike']);
  assert.equal(actions[1].onHit[0].do, 'damage');
  // The preset on the live chess x pokemon selection writes that structure from the start.
  const FX = JSON.parse(readFileSync(new URL('./fixtures/v2-chess-pokemon-selection.json', import.meta.url), 'utf8'));
  const p = preset({ decomposition: structuredClone(FX.decomposition), selection: { ...structuredClone(FX.selection), generators: [], bind: {} }, registry, logic, seed: FX.seed, prompt: FX.prompt });
  assert.deepEqual(p.loop, []);
  assert.ok(p.doc.systems.some(s => s.use === 'gameplay.combat.health'), 'the owner of what the win reads joins');
  assert.ok(inst(p.doc, 'gameplay.turns').with.actions.some(a => a.onHit?.some(e => e.do === 'damage')));
});

// ---------- the figure-it-out loop ----------
const memoryCtx = () => {
  const versions = [], stages = [], checkpoints = {};
  return { versions, stages, checkpoints, ctx: {
    stage(name, detail = {}) { stages.push({ name, ...detail }); }, draft() {}, checkpoint(name, value) { checkpoints[name] = value; },
    async publish(p) { const r = { version: versions.length + 1, ...p }; versions.push(r); return r; },
    store: { async updateMeta() {}, async version(_, v) { return versions[v - 1]; } },
  } };
};
/** The scripted spec model: decomposes the idea, maps its one core mechanic onto `mapped`, and fills the small forms. */
const scripted = (name, mapped) => {
  const c = COLLECTIONS[name];
  // The iterative decomposition's forms; 'text' is the graph's view (the old 'map' was never a decomposition view).
  const decompose = decomposer(planFrom({ title: 'The Test Game', premise: `${c.description}.`, tone: 'brisk', views: ['text'], acts: 1, zones: 2, movement: 'none',
    mechanics: [{ id: 'core', verb: c.description.split(' ')[0], description: c.description, from: '', importance: 'core' }], spaces: [{ role: 'field', kind: 'locations', description: 'a field' }],
    core: { loop: 'core', lose: '', theme: 'test', narrative: false, mashup: [], ...c.core } }));
  return fakeWriter([(req) => {
    const schema = String(req.schema?.name || '');
    const built = buildAnswer(req, { space: ['engine.space.graph'], picks: { core: mapped } }); // the iterative builder asks per mechanic, so the scripted model picks the mapped primitives
    if (built) return built;
    const decomposed = decompose(req);
    if (decomposed) return decomposed;
    if (schema === 'mechanic_map') return JSON.stringify({ mappings: [{ mechanic: 'core', primitives: mapped, covered: true, why: '' }] });
    if (schema === 'mapping_check') return JSON.stringify({ checks: [] });
    if (schema.endsWith('_fields')) return JSON.stringify(Object.fromEntries(Object.keys(req.schema.schema.properties).map(k => [k, null])));
    if (schema.endsWith('_frame')) return JSON.stringify({ title: 'The Test Game', logline: 'A test.', premise: 'A test.', spaces: {}, player: { archetype: req.schema.schema.properties.player?.properties.archetype.enum?.[0] ?? 'player_side', zone: '' }, endings: [] });
    if (schema.endsWith('_systems')) return JSON.stringify({ systems: {}, extra_systems: [] });
    if (schema.endsWith('_cast')) return JSON.stringify({ archetypes: [], items: [], characters: [] });
    return '{}';
  }]);
};
const run = async (name, mapped, config = {}) => {
  const cat = catalogue();
  const pipeline = createKernelPipeline({ catalogue: async () => cat, writers: { spec: scripted(name, mapped) }, config: { replanAttempts: 3, maxDetailTasks: 0, ...config } });
  const m = memoryCtx();
  const out = await pipeline({ gameId: name, prompt: COLLECTIONS[name].description, kind: 'create', seed: 5 }, m.ctx);
  return { ...m, out };
};

test('sides: the seeded standoff has no move that saps; the loop check fails before any form call, re-planning adds a verb that does', async () => {
  const { out, versions, stages } = await run('sides', ['gameplay.test.standoff']);
  const [first] = out.outline.attempts;
  assert.equal(first.stage, 'outline');
  assert.deepEqual(first.diagnoses.map(d => [d.kind, d.primitive, d.codes]), [['structure', 'gameplay.test.standoff', [LOOP_CODES.unaffected]]]);
  assert.ok(first.actions.some(a => a.action === 'add' && a.primitive === 'gameplay.test.jabber'), JSON.stringify(first.actions));
  assert.ok(stages.some(s => s.name === 'replanned'));
  // Verified again and published: the jabber's verb wears the opposing camp down and the duel's win fires.
  assert.equal(versions.length, 1);
  assert.ok(versions[0].doc.systems.some(s => s.use === 'gameplay.test.jabber'));
  assert.ok(out.base.viable, out.base.viability);
  assert.equal(out.base.playtest?.winnable, true, 'the playtest agent wins it');
});

test('collect: nothing produces what the forage win counts; re-planning adds the player-driven producer and the game publishes', async () => {
  const { out, versions } = await run('collect', ['gameplay.test.forage']);
  const [first] = out.outline.attempts;
  assert.deepEqual(first.diagnoses.map(d => [d.kind, d.primitive, d.codes]), [['structure', 'gameplay.test.forage', [LOOP_CODES.unaffected]]]);
  assert.ok(first.actions.some(a => a.action === 'add' && a.primitive === 'gameplay.test.pluck'), JSON.stringify(first.actions));
  assert.equal(versions.length, 1);
  assert.ok(out.base.viable, out.base.viability);
  assert.equal(out.base.playtest?.winnable, true, 'the playtest agent wins it');
});

test('race: the scramble declares no runners at all; re-planning replaces it for its mechanic with a race whose runners it declares', async () => {
  const { out, versions } = await run('race', ['gameplay.test.scramble']);
  const [first] = out.outline.attempts;
  assert.ok(first.diagnoses.some(d => d.primitive === 'gameplay.test.scramble' && d.codes.includes(LOOP_CODES.participants)), JSON.stringify(first.diagnoses));
  assert.ok(first.actions.some(a => a.action === 'replace' && a.primitive === 'gameplay.test.scramble' && a.by === 'gameplay.test.sprint'), JSON.stringify(first.actions));
  assert.equal(versions.length, 1);
  assert.deepEqual(inst(versions[0].doc, 'gameplay.test.sprint').with.runners.slice(0, 2), ['player', 'rival']);
  assert.ok(out.base.viable, out.base.viability);
  assert.equal(out.base.playtest?.winnable, true, 'the playtest agent wins it');
});

test('when nothing in the catalogue can make the declared win reachable, the build fails with the full diagnosis and publishes nothing', async () => {
  const cat = testCatalogue([...BASE, vigor, standoff]);
  const pipeline = createKernelPipeline({ catalogue: async () => cat, writers: { spec: scripted('sides', ['gameplay.test.standoff']) }, config: { replanAttempts: 3, maxDetailTasks: 0 } });
  const m = memoryCtx();
  await assert.rejects(pipeline({ gameId: 'g', prompt: 'duel', kind: 'create', seed: 5 }, m.ctx), e => {
    assert.equal(e.code, 'not_buildable');
    assert.ok(e.report.missing.some(x => /gameplay\.test\.standoff/.test(x) && /loop_win_unaffected/.test(x) && /vigor/.test(x) && /player verbs change/.test(x)), JSON.stringify(e.report.missing));
    return true;
  });
  assert.equal(m.versions.length, 0);
});

test('gate verdicts are diagnosed through the loop check of the played document: no_progress, loop_absent, plot_uncompletable', () => {
  const { registry } = catalogue();
  const sel = selectionOf(registry, COLLECTIONS.sides.systems, COLLECTIONS.sides.description);
  const doc = build('sides').doc;
  const broken = structuredClone(doc); inst(broken, 'gameplay.test.duel').with.moves = [{ id: 'feint', onHit: [] }];
  for (const verdict of ['no_progress: play makes no progress toward a win beyond what idling reaches', 'loop_absent: none of the loop\'s events happened from play', 'plot_uncompletable: no ending is reachable']) {
    const ds = diagnose([{ code: 'not_playable', path: '$', message: verdict }], { selection: sel, registry, doc: broken, core: COLLECTIONS.sides.systems });
    assert.deepEqual(ds.map(d => [d.kind, d.primitive, d.loop?.code]), [['structure', 'gameplay.test.duel', LOOP_CODES.unaffected]], verdict);
    assert.equal(ds[0].codes[0], `not_playable:${verdict.split(':')[0]}`);
  }
  // A structure that passes leaves the verdict to the existing re-planning (the win, the loop, the fields).
  assert.equal(diagnose([{ code: 'not_playable', path: '$', message: 'no_progress: none' }], { selection: sel, registry, doc, core: COLLECTIONS.sides.systems })[0].kind, 'win');
  assert.equal(diagnose([{ code: 'not_playable', path: '$', message: 'loop_absent: none' }], { selection: sel, registry, doc, core: COLLECTIONS.sides.systems })[0].kind, 'loop');
  // A structure diagnosis re-plans: a primitive whose player verbs change what the win reads is added (with what it requires).
  const ds = diagnose([{ code: 'not_playable', path: '$', message: 'no_progress: x' }], { selection: sel, registry, doc: broken, core: COLLECTIONS.sides.systems });
  const r = replan({ ...sel, systems: ['gameplay.test.duel'] }, ds, { registry, decomposition: decompositionOf(COLLECTIONS.sides.description, COLLECTIONS.sides.core), tried: new Map() });
  assert.deepEqual(r.actions.map(a => [a.action, a.primitive]), [['add', 'gameplay.test.jabber']]);
  assert.ok(r.selection.systems.includes('gameplay.test.vigor'), 'what it requires comes with it');
});
