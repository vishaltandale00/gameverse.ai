// The checks after EVERY mechanic step of the build (v2/planner/build.js, build-steps.js), on the real catalogue with
// scripted writers (no network): never two wins (one small enum question picks the game's win from the play spec's
// win sentence, the others are left unwired), and every wired end whose reads no player verb or effect of the
// collection can change gets the coverage step for its primitive and that primitive's mechanic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { selectPrimitives } from '../v2/planner/select.js';
import { preset, loopCore } from '../v2/planner/presets.js';
import { partialCheck, selectionCollection } from '../v2/planner/build-steps.js';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { normalize } from '../v2/planner/decompose.js';
import { cardLoop, endsGame } from '../v2/kernel/loop.js';
import { loopProblems, playerChanges, readsOf, LOOP_CODES } from '../v2/planner/loop-check.js';
import { servesContext } from '../v2/planner/retrieval.js';
import { fakeWriter, buildAnswer } from './v2-p-pipeline-fixtures.js';

const { registry, logic } = buildCatalogue();
const card = id => registry.get(id).card;

/** A play spec as decompose.js writes it. */
const spec = x => normalize({ title: x.ref, premise: x.premise, tone: x.core.theme, references: [{ name: x.ref, kind: 'game', keeps: [] }], views: x.views, movement: x.movement, acts: 1, zones: 3,
  spaces: [{ role: x.role || 'world', kind: x.kind, description: '' }], mechanics: x.mechanics.map(([id, importance, description]) => ({ id, verb: description.split(' ')[0], description, from: x.ref, importance })), core: x.core }, x.premise, registry);

// The live "Pac-Man in a haunted library" play spec (local-data failed-1.json), reduced to its core mechanics and
// played on the grid: the core loop is navigating the maze; "eat_dots" is a core mechanic that is NOT the loop, and
// its pick (as in the live run) is gameplay.score, whose declared win reads the var "score".
const PACMAN = { premise: 'Pac-Man in a haunted library: navigate the maze, eat every dot and avoid the ghosts.', ref: 'Pac-Man', views: ['td'], kind: 'tiles-topdown', movement: 'ground', role: 'level',
  core: { loop: 'navigate_maze_avoid_ghosts', interaction: 'avatar-grid', opponent: 'hazards', win: 'clear the haunted library maze by eating all dots', lose: 'when a ghost catches Pac-Man', theme: 'spooky haunted library', narrative: false, mashup: [] },
  mechanics: [['navigate_maze_avoid_ghosts', 'core', 'The player moves Pac-Man through a maze, collecting dots while avoiding ghost enemies.'],
    ['eat_dots', 'core', 'Pac-Man collects dots scattered throughout the maze to score points and clear levels.'],
    ['use_power_ups', 'core', 'Pac-Man can consume power-ups that temporarily allow attacking ghosts or other special abilities.'],
    ['ghost_enemy_chase', 'core', 'Ghost enemies pursue Pac-Man through the maze, attempting to catch and end the game.']] };
/** The live run's mechanic picks. */
const PICKS = { navigate_maze_avoid_ghosts: ['gameplay.move.grid'], eat_dots: ['gameplay.score'], use_power_ups: ['gameplay.progression.abilities'], ghost_enemy_chase: ['gameplay.ai.brain'] };

const writer = options => fakeWriter([req => buildAnswer(req, { space: ['engine.space.tilemap'], picks: PICKS, ...options }) ?? '{}']);
const named = (w, name) => w.calls.filter(c => c.schema.name === name);
const stepIndex = (sel, kind, mechanic) => sel.build.steps.findIndex(s => s.kind === kind && s.mechanic === mechanic);

test('(a) a non-loop core mechanic whose pick declares a win play cannot reach gets the coverage step during the build; the collect primitive it offers is added to that mechanic', async () => {
  const d = spec(PACMAN);
  // What the build now notices: the score win's var is produced by nothing player-driven, and no player-driven
  // primitive of the collection declares what changes it (add_score): no content can drive it, so it is not pending.
  const early = partialCheck(registry, d, { space: { id: 'level', use: 'engine.space.tilemap', with: {}, caps: [] }, systems: ['gameplay.move.grid', 'gameplay.score'], adapters: [], bind: {},
    mechanics: [{ id: 'navigate_maze_avoid_ghosts', importance: 'core', primitives: ['gameplay.move.grid'] }, { id: 'eat_dots', importance: 'core', primitives: ['gameplay.score'] }], loop: 'navigate_maze_avoid_ghosts',
    composes: () => ({ ok: true, variant: 0 }), resolve: () => ({ adapters: [], bind: {}, gaps: [] }) });
  const found = early.problems.find(p => p.primitive === 'gameplay.score');
  assert.deepEqual([found?.code, found?.need], [LOOP_CODES.unaffected, { kind: 'var', var: 'score' }]);

  const w = writer({ steps: { lose: ['gameplay.death'], coverage: ['gameplay.collectible'], wins: ['gameplay.collectible'] } });
  const sel = await selectPrimitives({ decomposition: d, registry, writer: w });
  // The coverage step ran right after the eat_dots step, before the next mechanic, for that primitive and its mechanic.
  const at = stepIndex(sel, 'coverage', 'eat_dots');
  assert.equal(at, stepIndex(sel, 'mechanic', 'eat_dots') + 1, JSON.stringify(sel.build.steps.map(s => [s.kind, s.mechanic])));
  assert.ok(at < stepIndex(sel, 'mechanic', 'use_power_ups'));
  const step = sel.build.steps[at];
  assert.match(step.need, /gameplay\.score: its win counts the var "score"/);
  assert.deepEqual([step.outcome, step.primitive], ['added', 'gameplay.collectible']);
  // Every candidate declares a way play changes what the win reads (its player verbs or effects: add_score), is played
  // the spec's way, and was not in the collection; the question is one strict enum with "none".
  const [q] = named(w, 'pick_coverage');
  const offered = q.schema.schema.properties.pick.enum;
  assert.equal(offered[offered.length - 1], 'none');
  assert.ok(offered.includes('gameplay.collectible'));
  const by = readsOf(cardLoop(card('gameplay.score')).win).by;
  for (const c of step.candidates) {
    assert.ok(playerChanges(registry, card(c.id), by, { logic, used: [...step.collection.filter(x => x !== c.id), c.id] }), c.id);
    assert.ok(servesContext(card(c.id), 'avatar-grid'), c.id);
  }
  // The pick joined eat_dots (not the core loop mechanic), and the loop check after it no longer reports the score win.
  assert.ok(sel.mechanics.find(m => m.id === 'eat_dots').primitives.includes('gameplay.collectible'));
  assert.ok(!sel.mechanics.find(m => m.id === 'navigate_maze_avoid_ghosts').primitives.includes('gameplay.collectible'));
  assert.ok(!step.loop.some(x => x.startsWith(LOOP_CODES.unaffected)), step.loop.join('; '));
  // The preset of the whole selection: the collect win is the game's (the wins question below), nothing unaffected.
  const p = preset({ decomposition: d, selection: structuredClone(sel), registry, logic, seed: 1 });
  assert.equal(p.structure.win?.use, 'gameplay.collectible');
  assert.deepEqual(p.loop.filter(x => [LOOP_CODES.unaffected, LOOP_CODES.owner, LOOP_CODES.loseUnproduced].includes(x.code)), []);
  assert.deepEqual(sel.gaps.filter(g => g.importance === 'core'), []);
});

test('(b) two wins in the collection are resolved by one question from the play spec\'s win sentence; the others are left unwired and recorded', async () => {
  const d = spec(PACMAN);
  for (const pick of ['gameplay.collectible', 'gameplay.score']) {
    const w = writer({ steps: { lose: ['gameplay.death'], coverage: ['gameplay.collectible'], wins: [pick] } });
    const sel = await selectPrimitives({ decomposition: d, registry, writer: w });
    const asks = named(w, 'pick_game_win');
    assert.equal(asks.length, 1, 'asked once, when the second win arrived');
    const schema = asks[0].schema.schema;
    assert.deepEqual([schema.additionalProperties, [...schema.required].sort()], [false, ['pick', 'why']]);
    assert.deepEqual([...schema.properties.pick.enum].sort(), ['gameplay.collectible', 'gameplay.score'], 'only the primitives that declare a win; no "none"');
    assert.match(asks[0].user, /Won by: clear the haunted library maze by eating all dots/);
    // Recorded: the pick, what was offered, the wins left unwired, and the step right after the coverage pick.
    const other = pick === 'gameplay.score' ? 'gameplay.collectible' : 'gameplay.score';
    assert.deepEqual([sel.win?.use, sel.win?.unwired], [pick, [other]]);
    const ws = sel.build.steps.find(s => s.kind === 'wins');
    assert.equal(sel.build.steps.indexOf(ws), stepIndex(sel, 'coverage', 'eat_dots') + 1);
    assert.equal(ws.primitive, pick);
    // The pick owns the game's win: first in the core order, the preset wires it, and only it.
    assert.equal(loopCore(d, sel, registry)[0], pick);
    const p = preset({ decomposition: d, selection: structuredClone(sel), registry, logic, seed: 1 });
    assert.equal(p.structure.win?.use, pick);
    assert.equal(p.structure.loopCheck.owner, pick);
  }
  // One pick whose requirements bring a second win (a card duel's cards require the turn loop): asked right after that step.
  const duel = spec({ premise: 'Duel a rival by playing cards from a deck, each turn spending mana on minions and spells.', ref: 'card duel', views: ['ui'], kind: 'none', movement: 'none',
    core: { loop: 'play_cards', interaction: 'menu', opponent: 'ai-side', win: 'reduce the rival to zero health', lose: 'reach zero health', theme: 'arcane', narrative: false, mashup: [] },
    mechanics: [['play_cards', 'core', 'play cards from a deck against a rival'], ['take_turns', 'core', 'take turns with the rival']] });
  const w = fakeWriter([req => buildAnswer(req, { picks: { play_cards: ['gameplay.cards'], take_turns: ['gameplay.cards'] }, steps: { wins: ['gameplay.cards'] } }) ?? '{}']);
  const sel = await selectPrimitives({ decomposition: duel, registry, writer: w });
  assert.ok(sel.systems.includes('gameplay.turns') && endsGame(cardLoop(card('gameplay.turns')).win));
  assert.equal(stepIndex(sel, 'wins', 'play_cards'), stepIndex(sel, 'mechanic', 'play_cards') + 1);
  assert.deepEqual([sel.win?.use, sel.win?.unwired], ['gameplay.cards', ['gameplay.turns']]);
});

// (d) Unrelated ideas: the checks after every mechanic step ask only what each collection lacks.
const IDEAS = {
  farm: { premise: 'Grow crops on a small farm, then sell the harvest at the market to pay off the debt.', ref: 'farm life', views: ['td'], kind: 'tiles-topdown', movement: 'ground',
    core: { loop: 'farm', interaction: 'avatar-realtime', opponent: 'clock', win: 'harvest the crops', lose: '', theme: 'pastoral', narrative: false, mashup: [] },
    mechanics: [['farm', 'core', 'till, plant, water and harvest crops'], ['sell', 'core', 'sell the harvest and buy seeds at the market']],
    picks: { farm: ['gameplay.farming'], sell: ['gameplay.economy'] }, steps: {} },
  race: { premise: 'Race shopping carts around a supermarket track against rival racers.', ref: 'kart racing', views: ['3p'], kind: 'continuous-3d', movement: 'track',
    core: { loop: 'race', interaction: 'avatar-realtime', opponent: 'ai-rival', win: 'finish first', lose: '', theme: 'supermarket', narrative: false, mashup: [] },
    mechanics: [['race', 'core', 'race laps around a track against rival racers'], ['drive', 'core', 'drive and steer a cart']],
    picks: { race: ['gameplay.race'], drive: ['gameplay.vehicle.core'] }, steps: { driver: ['gameplay.ai.seek'] } },
  chase: { premise: 'Chase down the goblins fleeing across a top-down field and slay them with your sword before they wear you down.', ref: 'goblin hunt', views: ['td'], kind: 'continuous-2d', movement: 'ground',
    core: { loop: 'slay', interaction: 'avatar-realtime', opponent: 'ai-rival', win: 'slay every goblin', lose: 'fall in battle', theme: 'folk', narrative: false, mashup: [] },
    mechanics: [['slay', 'core', 'attack goblins with a sword to slay them'], ['chase', 'core', 'run after the fleeing goblins']],
    picks: { slay: ['gameplay.combat.melee'], chase: ['gameplay.move.walk'] }, steps: { win: ['gameplay.waves'], lose: ['gameplay.death'] } },
};

test('(d) a farm, a race and a chase: the check runs after every mechanic step and asks nothing their collections do not lack', async () => {
  const kinds = {};
  for (const [name, x] of Object.entries(IDEAS)) {
    const d = spec(x);
    const w = fakeWriter([req => buildAnswer(req, { picks: x.picks, steps: x.steps }) ?? '{}']);
    const sel = await selectPrimitives({ decomposition: d, registry, writer: w });
    // Every mechanic step recorded the loop check of the partial collection after it.
    for (const s of sel.build.steps.filter(s => s.kind === 'mechanic')) assert.ok(Array.isArray(s.loop), `${name}/${s.mechanic}`);
    // No coverage or wins question between the mechanic steps: nothing a later step or the loop steps answer is asked early.
    const lastMech = sel.build.steps.map(s => s.kind).lastIndexOf('mechanic');
    assert.deepEqual(sel.build.steps.slice(0, lastMech).filter(s => s.kind !== 'mechanic').map(s => s.kind), [], name);
    assert.equal(named(w, 'pick_game_win').length, 0, name);
    assert.equal(sel.win, undefined, name);
    assert.deepEqual(sel.gaps.filter(g => g.importance === 'core'), [], `${name}: ${JSON.stringify(sel.gaps)}`);
    const p = preset({ decomposition: d, selection: structuredClone(sel), registry, logic, seed: 1 });
    assert.ok(p.structure.win && sel.systems.includes(p.structure.win.use), `${name}: ${p.structure.win?.use}`);
    assert.deepEqual(p.loop, [], `${name}: ${JSON.stringify(p.loop.map(q => q.message))}`);
    kinds[name] = sel.build.steps.filter(s => s.kind !== 'mechanic').map(s => [s.kind, s.primitive]);
  }
  assert.deepEqual(kinds.farm, []);
  assert.deepEqual(kinds.race, [['driver', 'gameplay.ai.seek']]);
  assert.deepEqual(kinds.chase.slice(0, 2), [['win', 'gameplay.waves'], ['lose', 'gameplay.death']]);
});
