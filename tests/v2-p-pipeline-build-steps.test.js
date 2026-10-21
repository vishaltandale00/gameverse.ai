// The loop steps of the iterative build (v2/planner/build-steps.js), on the real catalogue with scripted fake writers
// (no network): after the mechanic steps, the win, the lose, the drivers of AI opponents and what lets play change
// the win's reads are each one small strict enum question over candidates that compose and pass the loop check of the
// partial collection. The preset only wires what selection chose; re-planning asks the same questions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { selectPrimitives } from '../v2/planner/select.js';
import { preset } from '../v2/planner/presets.js';
import { diagnose, replan } from '../v2/planner/replan.js';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { normalize } from '../v2/planner/decompose.js';
import { cardLoop, endsGame } from '../v2/planner/loop.js';
import { readsOf, drivesOf, loopProblems, LOOP_CODES } from '../v2/planner/loop-check.js';
import { fakeWriter, buildAnswer } from './v2-p-pipeline-fixtures.js';

const { registry, logic } = buildCatalogue();
const card = id => registry.get(id).card;
const STEP = /^pick_(win|lose|driver|coverage)$/;

/** A play spec as decompose.js writes it. */
const spec = x => normalize({ title: x.ref, premise: x.premise, tone: x.core.theme, references: [{ name: x.ref, kind: 'game', keeps: [] }], views: x.views, movement: x.movement, acts: 1, zones: 3,
  spaces: [{ role: x.role || 'world', kind: x.kind, description: '' }], mechanics: x.mechanics.map(([id, importance, description, from = x.ref]) => ({ id, verb: description.split(' ')[0], description, from, importance })), core: x.core }, x.premise, registry);

// The live "Pac-Man in a haunted library" play spec (local-data failed-1.json), reduced to what selection reads: the
// core loop is navigating a grid maze, eating pellets and avoiding enemies; the win is eating all the pellets.
const PACMAN = { premise: 'Navigate a maze-like haunted library as Pac-Man, eating all the pellets while avoiding ghostly enemies.', ref: 'Pac-Man', views: ['td', 'ui'], kind: 'tiles-topdown', movement: 'ground', role: 'level',
  core: { loop: 'pacman_core_loop', interaction: 'avatar-grid', opponent: 'hazards', win: 'eat all the pellets in the haunted library maze', lose: 'get caught by a ghost in the haunted library', theme: 'haunted library', narrative: false, mashup: [] },
  mechanics: [['pacman_core_loop', 'core', 'navigate a maze while eating pellets and avoiding enemies'], ['trigger_haunted_events', 'flavor', 'Random haunted events such as floating books or ghostly apparitions appear to surprise the player.', 'haunted library']] };
/** The live run's mechanic picks: grid movement for the core loop (nothing in it declares a win), random events for the flavour. */
const PACMAN_PICKS = { pacman_core_loop: ['gameplay.move.grid'], trigger_haunted_events: ['plot.events.random'] };

/** A scripted model: the build's preferences (fixtures buildAnswer), recording every call. */
const writer = options => fakeWriter([req => buildAnswer(req, options) ?? '{}']);
const asked = (w, name) => w.calls.filter(c => c.schema.name === name);
const loopStepsOf = sel => sel.build.steps.filter(s => s.kind !== 'mechanic');
/** Every loop-step question is one strict enum over at most 8 options and "none". */
const assertStrict = w => {
  for (const c of w.calls.filter(x => STEP.test(x.schema.name))) {
    assert.equal(c.schema.schema.additionalProperties, false);
    assert.deepEqual(c.schema.schema.required.sort(), ['pick', 'spec', 'why']);
    const options = c.schema.schema.properties.pick.enum;
    assert.ok(options.length >= 2 && options.length <= 9 && options[options.length - 1] === 'none', options.join(', '));
    assert.ok(c.user.length < 4000, `${c.user.length} chars`);
  }
};
/** No candidate is another game: none whose loop is declared for another interaction and ends the game. */
const assertPlayedThisWay = (sel, interaction) => {
  for (const s of loopStepsOf(sel)) for (const c of s.candidates) {
    const loop = cardLoop(card(c.id));
    assert.ok(!loop?.interaction || loop.interaction === interaction || !(endsGame(loop.win) || endsGame(loop.lose)), `${s.kind}: ${c.id} is played as ${loop?.interaction}`);
  }
};
/** The preset added no gameplay or plot primitive that declares a win or drives AI: those are selection's. */
const assertPresetAddsNone = (p, sel) => {
  const extra = p.doc.systems.map(s => s.use).filter(u => !sel.systems.includes(u) && /^(gameplay|plot)\./.test(u));
  for (const u of extra) assert.ok(!endsGame(cardLoop(card(u))?.win) && !drivesOf(card(u)), `the preset added ${u}`);
};

test('(a) a grid collect-and-evade spec: the win step offers wins played on the grid, and the collection is won by what the player collects, never a line clear', async () => {
  const d = spec(PACMAN);
  const w = writer({ space: ['engine.space.grid'], picks: PACMAN_PICKS, steps: { lose: ['gameplay.death'] } });
  const sel = await selectPrimitives({ decomposition: d, registry, writer: w });
  // The mechanic step took grid movement only (as in the live run); then the win step was asked once.
  assert.deepEqual(sel.mechanics.find(m => m.id === 'pacman_core_loop').primitives.slice(0, 1), ['gameplay.move.grid']);
  const [win] = asked(w, 'pick_win');
  assert.ok(win, 'the win step is asked');
  assert.match(win.user, /Won by: eat all the pellets in the haunted library maze/, 'the prompt carries the spec\'s win sentence');
  const offered = win.schema.schema.properties.pick.enum;
  assert.ok(!offered.includes('gameplay.falling.pieces'), offered.join(', '));
  assertPlayedThisWay(sel, 'avatar-grid');
  // The pick: the collect win, which joins the core loop mechanic; what it reads (collected) the player's movement changes.
  const step = loopStepsOf(sel).find(s => s.kind === 'win');
  assert.deepEqual([step.outcome, step.primitive], ['added', 'gameplay.collectible']);
  const reads = readsOf(cardLoop(card('gameplay.collectible')).win);
  assert.equal(reads.event, 'collected');
  assert.equal(reads.by.movement, true);
  assert.ok(sel.mechanics.find(m => m.id === 'pacman_core_loop').primitives.includes('gameplay.collectible'));
  assert.ok(!step.loop.some(x => /^loop_win_/.test(x)), step.loop.join('; '));
  // The preset wires that win; nothing adds a line clear (or any other win) behind selection's back.
  const p = preset({ decomposition: d, selection: structuredClone(sel), registry, logic, seed: 1 });
  assert.equal(p.structure.win?.use, 'gameplay.collectible');
  assert.ok(!p.doc.systems.some(s => s.use === 'gameplay.falling.pieces'));
  assert.deepEqual(p.loop.filter(x => [LOOP_CODES.unaffected, LOOP_CODES.owner, LOOP_CODES.win].includes(x.code)), []);
  assertPresetAddsNone(p, sel);
  assertStrict(w);
});

test('(b) when no candidate fits, the step is a gap for the gap layer and nothing is added: in the build, in the preset and in re-planning', async () => {
  const d = spec(PACMAN);
  // The model finds no listed win fits ("none"): a core win gap with the primitive signature, carrying the spec's sentence.
  const w = writer({ space: ['engine.space.grid'], picks: PACMAN_PICKS, steps: { win: [], lose: [] } });
  const sel = await selectPrimitives({ decomposition: d, registry, writer: w });
  const step = loopStepsOf(sel).find(s => s.kind === 'win');
  assert.deepEqual([step.outcome, step.primitive, step.asks.map(a => a.pick)], ['gap', null, ['none']]);
  assert.ok(step.candidates.length > 0, 'there were candidates; the model rejected them');
  const gap = sel.gaps.find(g => g.kind === 'win');
  assert.equal(gap?.importance, 'core');
  assert.match(gap.signature, /^win: a primitive whose loop declares a game-ending win \(card\.loop\.win\) for "eat all the pellets/);
  assert.match(gap.signature, /played as avatar-grid/);
  assert.ok(!sel.systems.some(id => endsGame(cardLoop(card(id))?.win)), sel.systems.join(', '));
  // The lose the model also declined is a gap of its own.
  assert.ok(sel.gaps.some(g => g.mechanic === 'lose' && g.kind === 'no_primitive' && /game-ending lose/.test(g.signature)));
  // The preset never fills it: no win, a core win gap, and no primitive that declares one.
  const p = preset({ decomposition: d, selection: structuredClone(sel), registry, logic, seed: 1 });
  assert.equal(p.structure.win, null);
  assert.ok(p.gaps.some(g => g.kind === 'win' && g.importance === 'core'));
  assert.ok(!p.doc.systems.some(s => endsGame(cardLoop(card(s.use))?.win)));
  // Re-planning asks the same win step, never offering what the build's step already offered; without a model it
  // chooses nothing at all. Either way the need is unresolved with the signature, for the gap layer.
  const ds = diagnose([], { selection: sel, registry });
  assert.ok(ds.some(x => x.kind === 'win'));
  const w2 = writer({ steps: { win: [] } });
  const again = await replan(sel, ds.filter(x => x.kind === 'win'), { registry, decomposition: d, tried: new Map(), writer: w2 });
  for (const c of asked(w2, 'pick_win')) for (const id of step.candidates.map(x => x.id)) assert.ok(!c.schema.schema.properties.pick.enum.includes(id), id);
  assert.deepEqual(again.actions.filter(a => a.action === 'add'), []);
  assert.deepEqual(again.unresolved.map(x => x.kind), ['win']);
  const offline = await replan(sel, ds.filter(x => x.kind === 'win'), { registry, decomposition: d, tried: new Map() });
  assert.deepEqual([offline.actions, offline.unresolved.length], [[], 1]);
  assert.match(offline.unresolved[0].signature, /game-ending win/);
});

test('(c) AI opponents nothing drives: the driver step adds a driver, offered only drivers; re-planning asks the same question', async () => {
  const d = spec({ ...PACMAN, core: { ...PACMAN.core, opponent: 'ai-rival' } });
  const w = writer({ space: ['engine.space.grid'], picks: PACMAN_PICKS, steps: { lose: ['gameplay.death'], driver: ['gameplay.ai.brain'] } });
  const sel = await selectPrimitives({ decomposition: d, registry, writer: w });
  const [q] = asked(w, 'pick_driver');
  assert.ok(q, 'the driver step is asked');
  for (const id of q.schema.schema.properties.pick.enum.filter(x => x !== 'none')) assert.equal(drivesOf(card(id))?.control, 'ai', id);
  const step = loopStepsOf(sel).find(s => s.kind === 'driver');
  assert.deepEqual([step.outcome, step.primitive], ['added', 'gameplay.ai.brain']);
  assert.match(step.need, /play spec's opponent \(ai-rival\)/);
  assert.ok(!step.loop.some(x => x.startsWith(LOOP_CODES.inert)), step.loop.join('; '));
  assert.ok(sel.systems.includes('gameplay.ai.brain'));
  assert.ok(!sel.mechanics.find(m => m.id === 'pacman_core_loop').primitives.includes('gameplay.ai.brain'), 'a driver joins the collection, not the core loop');
  // The preset wires the chosen driver; the structure passes (its ghosts are content the model writes: pending).
  const p = preset({ decomposition: d, selection: structuredClone(sel), registry, logic, seed: 1 });
  assert.deepEqual(p.loop.filter(x => x.code === LOOP_CODES.inert), []);
  assertPresetAddsNone(p, sel);
  // The gate later finds ghosts placed and nothing driving them (a selection made without the step): re-planning goes
  // through the same driver step, and the model's pick is added.
  const undriven = { ...structuredClone(sel), systems: sel.systems.filter(id => id !== 'gameplay.ai.brain'), build: undefined };
  const doc = structuredClone(preset({ decomposition: d, selection: structuredClone(undriven), registry, logic, seed: 1 }).doc);
  doc.content.archetypes.push({ id: 'ghost', kind: 'enemy', components: { name: 'Ghost' } });
  doc.systems.find(s => s.use === 'engine.spawner')?.with.rules.push({ id: 'g1', archetype: 'ghost', count: [2, 2] }) ?? doc.systems.unshift({ use: 'engine.spawner', with: { rules: [{ id: 'g1', archetype: 'ghost', count: [2, 2] }] } });
  assert.deepEqual(loopProblems(doc, registry, { logic, opponent: 'ai-rival' }).map(x => x.code), [LOOP_CODES.inert]);
  const ds = diagnose([{ code: 'not_playable', path: '$', message: 'no_progress: the ghosts never moved' }], { selection: undriven, registry, doc, opponent: 'ai-rival' });
  assert.deepEqual(ds.map(x => [x.kind, x.loop?.code]), [['structure', LOOP_CODES.inert]]);
  const w2 = writer({ steps: { driver: ['gameplay.ai.brain'] } });
  const r = await replan(undriven, ds, { registry, decomposition: d, tried: new Map(), writer: w2 });
  assert.deepEqual(r.actions.map(a => [a.action, a.primitive]), [['add', 'gameplay.ai.brain']]);
  assert.deepEqual(w2.calls.map(c => c.schema.name), ['pick_driver']);
  assertStrict(w);
});

// (d) The same steps on unrelated ideas: nothing here knows a genre.
const IDEAS = {
  chase: { premise: 'Chase down the goblins fleeing across a top-down field and slay them with your sword before they wear you down.', ref: 'goblin hunt', views: ['td'], kind: 'continuous-2d', movement: 'ground',
    core: { loop: 'slay', interaction: 'avatar-realtime', opponent: 'ai-rival', win: 'slay every goblin', lose: 'fall in battle', theme: 'folk', narrative: false, mashup: [] },
    mechanics: [['slay', 'core', 'attack goblins with a sword to slay them'], ['chase', 'core', 'run after the fleeing goblins']],
    picks: { slay: ['gameplay.combat.melee'], chase: ['gameplay.move.walk'] }, steps: { win: ['gameplay.waves'], lose: ['gameplay.death'] } },
  race: { premise: 'Race shopping carts around a supermarket track against rival racers.', ref: 'kart racing', views: ['3p'], kind: 'continuous-3d', movement: 'track',
    core: { loop: 'race', interaction: 'avatar-realtime', opponent: 'ai-rival', win: 'finish first', lose: '', theme: 'supermarket', narrative: false, mashup: [] },
    mechanics: [['race', 'core', 'race laps around a track against rival racers'], ['drive', 'core', 'drive and steer a cart']],
    picks: { race: ['gameplay.race'], drive: ['gameplay.vehicle.core'] }, steps: { driver: ['gameplay.ai.seek'] } },
  sides: { premise: 'Two armies take turns moving pieces on a board to capture the enemy king.', ref: 'chess', views: ['board'], kind: 'board', movement: 'none',
    core: { loop: 'move_pieces', interaction: 'pieces-turns', opponent: 'ai-side', win: 'capture the king', lose: 'lose the king', theme: 'war', narrative: false, mashup: [] },
    mechanics: [['move_pieces', 'core', 'move pieces across the board in turns'], ['capture', 'core', 'capture enemy pieces by moving onto them']],
    picks: { move_pieces: ['gameplay.turns'], capture: ['gameplay.turns'] }, steps: {} },
};

test('(d) the same loop steps complete a chase, a race and a turn-based sides game, each asked only what its collection lacks', async () => {
  const built = {};
  for (const [name, x] of Object.entries(IDEAS)) {
    const d = spec(x);
    const w = writer({ picks: x.picks, steps: x.steps });
    const sel = await selectPrimitives({ decomposition: d, registry, writer: w });
    built[name] = { sel, w };
    assertPlayedThisWay(sel, x.core.interaction);
    assertStrict(w);
    // Every loop step is recorded with its need, its candidates and the loop check of the partial collection after it.
    for (const s of loopStepsOf(sel)) assert.ok(s.need && Array.isArray(s.loop) && Array.isArray(s.collection), `${name}: ${s.kind}`);
    assert.equal(w.calls.filter(c => STEP.test(c.schema.name)).length, loopStepsOf(sel).filter(s => s.asks.length).length, name);
    assert.deepEqual(sel.gaps.filter(g => g.importance === 'core'), [], `${name}: ${JSON.stringify(sel.gaps)}`);
    // The preset wires what was chosen: a declared win, a structure that passes, nothing added.
    const p = preset({ decomposition: d, selection: structuredClone(sel), registry, logic, seed: 1 });
    assert.ok(p.structure.win && sel.systems.includes(p.structure.win.use), `${name}: ${p.structure.win?.use}`);
    assert.deepEqual(p.loop, [], `${name}: ${JSON.stringify(p.loop.map(x => x.message))}`);
    assertPresetAddsNone(p, sel);
  }
  const kinds = name => loopStepsOf(built[name].sel).map(s => [s.kind, s.primitive]);
  // chase: the melee pick declares no win: the win step (the waves of foes whose health the sword's damage wears down),
  // the lose the spec names, and a driver for the goblins the play spec's opponent needs.
  assert.deepEqual(kinds('chase').slice(0, 2), [['win', 'gameplay.waves'], ['lose', 'gameplay.death']]);
  const chaseDriver = loopStepsOf(built.chase.sel).find(s => s.kind === 'driver');
  assert.ok(chaseDriver?.primitive && drivesOf(card(chaseDriver.primitive))?.control === 'ai', JSON.stringify(kinds('chase')));
  // race: the race declares its win (no win step) and no lose is asked for; its rivals get the target driver.
  assert.deepEqual(kinds('race'), [['driver', 'gameplay.ai.seek']]);
  // sides: the turn loop declares its win and lose and drives its own side: nothing to ask.
  assert.deepEqual(kinds('sides'), []);
  assert.equal(asked(built.sides.w, 'pick_win').length + asked(built.sides.w, 'pick_driver').length, 0);
});
