// The nested mashup step (v2/planner/build-steps.js adapterSteps) and adapter instance ids (v2/planner/adapters.js).
// A spec whose mashup entry is `nested` gets engine.adapt.nested from an explicit build step, never from the preset:
// the outer loop is the core loop mechanic's loop primitive, the inner loop the joined concept's (asked for with the loop
// step when the collection has none), ONE strict enum question picks the outer event that enters it (only events the
// outer card declares participants for, card.loop.involves), and code writes the trigger, roles, start
// (card.engage.encounter), carry and outcomes (card.loop.outcome). Three unrelated outer/inner pairs, with scripted
// writers, then the document through the real runtime:
//   board capture -> creature battle   a hit on a piece starts a battle; losing it takes the piece off the board;
//   overworld touch -> turn fight      a brute's touch carries both into an arena for a turn fight; the brute falls;
//   door -> race                       using a door carries the runner onto a course; winning the race beats the door.
// And the instance fields the planner owns: every adapter instance it adds has an id (the live chess x pokemon failure:
// a projection without one, which no field repair could fix), filled by code when a document lacks it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogue } from '../v2/primitives/index.js';
import { Registry } from '../v2/kernel/registry.js';
import { preflight } from '../v2/kernel/document.js';
import { createWorld } from '../v2/kernel/world.js';
import { adapterStepsOnSelection, makeAsk } from '../v2/planner/build-steps.js';
import { resolveAdapters, instanceFieldProblems, ensureInstanceFields } from '../v2/planner/adapters.js';
import { configureInner, wireOutcomes, configureEncounters, encounterOuter, preset } from '../v2/planner/presets.js';
import { repairDocument } from '../v2/planner/repair.js';
import { capsOf } from '../v2/planner/compose-check.js';
import { fakeWriter } from './v2-p-pipeline-fixtures.js';

const { registry, logic } = catalogue();
const NESTED = 'engine.adapt.nested';
const SCHEMA = 'gameverse.v2.game/0.2';
const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const card = id => registry.get(id).card;

/** A scripted model: answers the inner loop step and the trigger question, recording every call. */
const scripted = ({ inner = null, trigger }) => fakeWriter([req => {
  const name = req.schema.name, offered = req.schema.schema.properties.pick.enum;
  const want = name === 'pick_inner' ? inner : name === 'pick_nested_trigger' ? trigger : null;
  return JSON.stringify({ pick: offered.includes(want) ? want : 'none', why: 'scripted', spec: '' });
}]);

/** A two-concept spec as decompose.js writes it: the primary concept's loop mechanic first, the joined one nested in it. */
function spec({ premise, outer, inner, extra = [], interaction, opponent = 'ai-rival' }) {
  const mechanics = [{ id: outer, verb: outer, description: `${outer} through the world`, from: 'primary', importance: 'core' }, ...extra,
    { id: inner, verb: inner, description: `${inner} as an encounter`, from: 'joined', importance: 'core' }];
  return { version: 't', title: premise, premise, tone: '', references: [], views: ['td'], spaces: [], movement: 'none', acts: 1, zones: 0,
    concepts: [{ id: 'primary', name: 'primary', quote: '', kind: 'game', keeps: [], loop: outer }, { id: 'joined', name: 'joined', quote: '', kind: 'game', keeps: [], loop: inner }],
    mechanics,
    core: { loop: outer, interaction, opponent, win: 'win', lose: 'lose', theme: '', narrative: false, mashup: [{ relation: 'nested', mechanics: [extra[0]?.id || outer, inner], why: `${premise}: the encounter decides it` }] } };
}
/** A select.js selection: spaces, systems, each mechanic's primitives and bindings. */
function selection({ spaces, systems, mechanics, bind = {} }) {
  return { version: 't', spaces: spaces.map(s => ({ role: 'world', with: {}, ...s, caps: [...capsOf(registry, s.use, s.with || {})] })), systems: [...systems], generators: [], graphics: [], bind: { ...bind }, gaps: [], adapters: [], provider: null,
    completeness: /** @type {any} */ ({}), ms: 0, mechanics: Object.entries(mechanics).map(([id, primitives]) => ({ id, verb: id, description: id, importance: 'core', primitives: [...primitives] })) };
}
/** Run the adapter steps with the scripted model. */
async function step(d, sel, answers) {
  const writer = scripted(answers);
  const r = await adapterStepsOnSelection({ registry, decomposition: d, selection: sel, ask: makeAsk({ writer }) });  return { r, writer, inst: (sel.adapters || []).find(a => a.use === NESTED) };
}
/** The step's instance in a document, configured the way the preset configures it (presets.js). */
function configure(doc, inst) {
  doc.systems.push(structuredClone(inst));
  configureInner(registry, doc.systems);
  const placed = doc.systems.find(s => s.use === NESTED);
  assert.deepEqual(wireOutcomes(registry, doc.systems, { id: placed.with.id, inner: placed.with.inner }).problems, []);
  assert.deepEqual(configureEncounters(doc, registry, [{ id: placed.with.id, outer: encounterOuter(registry, doc.systems, placed) }]), []);
  return doc;
}
const boot = doc => { const r = preflight(doc, registry, logic); assert.ok(r.ok, JSON.stringify(r.errors)); return createWorld(r.doc, registry, logic, { seed: 2 }); };
const dead = (rt, id) => !rt.entity(id) || Boolean(rt.entity(id).components.health?.dead) || rt.entity(id).components.health?.hp <= 0;
const encounter = (rt, inst) => rt.state.prim[`${NESTED}:${inst.with.id}`];
/** What every nested step guarantees: one strict question, a valid id, the declared start and outcomes, no instance field missing. */
function assertStep({ r, writer, inst }, sel, { inner, trigger, roles }) {
  assert.deepEqual(r.gaps, [], JSON.stringify(r.gaps));
  const nested = r.steps.find(s => s.kind === 'nested');
  assert.equal(nested.outcome, 'added');
  const asks = writer.calls.filter(c => c.schema.name === 'pick_nested_trigger');
  assert.equal(asks.length, 1, 'one trigger question');
  const offered = asks[0].schema.schema.properties.pick.enum;
  assert.equal(offered[offered.length - 1], 'none');
  for (const e of offered.slice(0, -1)) assert.ok(Object.values(registry.cards()).some(c => c.loop?.involves?.[e]), `${e} is an event an outer card declares participants for`);
  assert.ok(inst, 'the nested adapter is in the selection');
  assert.match(inst.id, SLUG);
  assert.deepEqual(instanceFieldProblems(sel, registry), []);
  assert.equal(inst.with.on, trigger);
  assert.deepEqual(inst.with.roles, roles);
  assert.deepEqual(inst.with.inner, [inner]);
  assert.deepEqual(inst.with.start, card(inner).engage.encounter.start, 'start: what the inner card declares');
  assert.deepEqual(inst.with.outcomes.map(o => o.result), Object.keys(card(inner).loop.outcome.results), 'outcomes: what the inner card declares');
}

// ---------- board capture -> creature battle ----------
const B = (hp, atk, def, spa, spd, spe) => ({ hp, atk, def, spa, spd, spe });
const CREATURES = {
  types: { fire: { grass: 2, water: 0.5, fire: 0.5 }, grass: { water: 2, fire: 0.5 }, normal: {} },
  moves: [{ id: 'ember', name: 'Ember', type: 'fire', category: 'special', power: 40, accuracy: 100, pp: 25 }, { id: 'vine', name: 'Vine', type: 'grass', category: 'special', power: 45, accuracy: 100, pp: 25 }],
  species: [
    { id: 'sprout', name: 'Sprout', types: ['grass'], base: B(45, 49, 49, 65, 65, 45), catchRate: 45, expYield: 64, growth: 'medium', learnset: [{ level: 1, move: 'vine' }] },
    { id: 'ember_pup', name: 'Ember Pup', types: ['fire'], base: B(39, 52, 43, 60, 50, 65), catchRate: 45, expYield: 62, growth: 'medium', learnset: [{ level: 1, move: 'ember' }] },
  ],
};
const CHESS = spec({ premise: 'Chess where a capture is a creature battle', outer: 'move_pieces', inner: 'creature_battle', extra: [{ id: 'capture', verb: 'capture', description: 'capture a piece', from: 'primary', importance: 'core' }], interaction: 'pieces-turns' });
const chessSelection = () => selection({ spaces: [{ id: 'board', use: 'engine.space.grid', with: { size: [6, 6] }, role: 'board' }],
  systems: ['engine.input.actions', 'gameplay.combat.health', 'gameplay.creature.party', 'gameplay.turns'],
  mechanics: { move_pieces: ['gameplay.turns', 'gameplay.combat.health'], capture: ['gameplay.turns'], creature_battle: [] } });
const boardDoc = (inst, party) => configure({
  schema: SCHEMA, id: 'capture-battle', title: 'Capture battle', seed: 5,
  spaces: [{ id: 'board', use: 'engine.space.grid', with: { size: [6, 6] } }, { id: 'arena', use: 'engine.space.none', zones: [{ id: 'ring' }] }],
  systems: [
    { use: 'gameplay.combat.health' },
    { use: 'gameplay.turns', space: 'board', with: { grain: 'side', ap: 1, movePerAp: 1, overwatch: false, hitChance: false,
      sides: [{ id: 'white', control: 'player', members: ['player'] }, { id: 'black', control: 'ai', members: ['pawn'] }],
      actions: [{ id: 'capture', range: 1, target: 'unit', los: false, ai: 0 }] } },
    { use: 'gameplay.creature.party', with: { start: party } },
    { use: 'gameplay.creature.battle', with: { space: 'arena' } },
    { use: 'engine.spawner', with: { intervalSec: 0, rules: [
      { id: 'p1', archetype: 'pawn', space: 'board', at: [3, 3], unique: true, activation: 'always', respawnSec: 0 },
      { id: 'k2', archetype: 'squire', space: 'board', at: [3, 2], unique: true, activation: 'always', respawnSec: 0 }] } },
  ],
  content: { ...CREATURES, archetypes: [{ id: 'knight', components: { health: { max: 1 }, turns: { side: 'white' } } }, { id: 'squire', components: { health: { max: 1 }, turns: { side: 'white' } } }, { id: 'pawn', components: { health: { max: 1 }, turns: { side: 'black' } } }] },
  player: { archetype: 'knight', space: 'board', at: [0, 0] },
}, inst);

test('board capture -> creature battle: the inner loop is asked for, the hit enters it, and code writes the adapter', async () => {
  const sel = chessSelection();
  const s = await step(CHESS, sel, { inner: 'gameplay.creature.battle', trigger: 'attack_hit' });
  // The collection had no inner loop: the loop step asked for one, and it joined the joined concept's loop mechanic.
  const innerStep = s.r.steps.find(x => x.kind === 'inner');
  assert.equal(innerStep?.outcome, 'added', JSON.stringify(innerStep?.rejected));
  assert.ok(innerStep.candidates.every(c => card(c.id).loop?.outcome && card(c.id).engage?.encounter?.start), 'only loops an encounter can enter are offered');
  assert.ok(sel.mechanics.find(m => m.id === 'creature_battle').primitives.includes('gameplay.creature.battle'));
  assertStep(s, sel, { inner: 'gameplay.creature.battle', trigger: 'attack_hit', roles: { attacker: 'who', defender: 'target' } });
  assert.deepEqual(s.inst.with.carry ?? [], [], 'the battle moves the player itself: nobody is carried');
  // The preset configures what the step chose (it adds no adapter of its own) and its document preflights.
  const p = preset({ decomposition: CHESS, selection: structuredClone(sel), registry, logic, seed: 1 });
  const placed = p.doc.systems.filter(x => x.use === NESTED);
  assert.equal(placed.length, 1);
  assert.equal(placed[0].id, s.inst.id);
  assert.deepEqual(placed[0].with.start, [{ do: 'heal_party' }, { do: 'start_battle', kind: 'trainer', foe: [{ species: p.doc.content.species[0].id, level: 5 }] }], 'the start the card declares, filled from the document');
  assert.ok(p.ok, JSON.stringify(p.errors.slice(0, 3)));
  assert.ok(preflight(p.doc, registry, logic).ok);
});

test('board capture -> creature battle: the hit starts the battle and losing it takes the attacking piece off the board', async () => {
  const sel = chessSelection();
  const { inst } = await step(CHESS, sel, { inner: 'gameplay.creature.battle', trigger: 'attack_hit' });
  for (const [party, result, loser, keeper] of [[[{ species: 'sprout', level: 2 }], 'lost', 'k2', 'p1'], [[{ species: 'ember_pup', level: 30 }], 'won', 'p1', 'k2']]) {
    const rt = boot(boardDoc(inst, party));
    rt.step({}); rt.step({}); rt.step({ actions: { end_turn: true } });
    for (let i = 0; i < 20 && rt.state.prim['gameplay.turns'].current?.side !== 'white'; i++) rt.step({});
    rt.step({ actions: { turn_act: { unit: 'k2', action: 'capture', target: 'p1' } } });
    assert.ok(encounter(rt, inst).active, 'the hit started the battle');
    assert.ok(!dead(rt, 'p1') && !dead(rt, 'k2'), 'nothing is decided before the battle');
    for (let i = 0; encounter(rt, inst).active && i < 300; i++) { rt.step({ actions: { battle: { kind: 'move', index: 0 } } }); rt.step({}); }
    assert.equal(encounter(rt, inst).last, result);
    assert.ok(dead(rt, loser), `${loser} lost the battle and is out of play on the board`);
    assert.ok(!dead(rt, keeper), `${keeper} keeps its place`);
  }
});

// ---------- overworld touch -> turn fight ----------
const BRAWL = spec({ premise: 'Roam a field where touching a brute starts a turn fight', outer: 'roam', inner: 'turn_fight', interaction: 'avatar-grid', opponent: 'hazards' });
const brawlSelection = () => selection({ spaces: [{ id: 'field', use: 'engine.space.grid', with: { size: [8, 8] } }, { id: 'arena', use: 'engine.space.grid', with: { size: [4, 4] }, role: 'arena' }],
  systems: ['engine.input.actions', 'gameplay.combat.health', 'gameplay.turns'], bind: { 'gameplay.turns': 'arena' },
  mechanics: { roam: ['gameplay.combat.health'], turn_fight: ['gameplay.turns'] } });
const fieldDoc = inst => configure({
  schema: SCHEMA, id: 'touch-fight', title: 'Touch fight', seed: 3,
  spaces: [{ id: 'field', use: 'engine.space.grid', with: { size: [8, 8] } }, { id: 'arena', use: 'engine.space.grid', with: { size: [4, 4] } }],
  systems: [
    { use: 'gameplay.combat.health' },
    { use: 'gameplay.turns', space: 'arena', with: { grain: 'side', ap: 1, movePerAp: 1, overwatch: false, hitChance: false,
      sides: [{ id: 'hero', control: 'player', members: ['player'] }, { id: 'foes', control: 'ai', members: ['brute'] }],
      actions: [{ id: 'strike', range: 3, target: 'unit', hostile: true, los: false, onHit: [{ do: 'damage', who: 'target', amount: 5 }] }] } },
    { use: 'engine.spawner', with: { intervalSec: 0, rules: [{ id: 'b1', archetype: 'brute', space: 'field', at: [3, 3], unique: true, activation: 'always', respawnSec: 0 }] } },
  ],
  content: { archetypes: [{ id: 'hero', components: { health: { max: 40 } } }, { id: 'brute', components: { health: { max: 5 }, touch: { damage: 1 } } }] },
  player: { archetype: 'hero', space: 'field', at: [3, 3] },
}, inst);

test('overworld touch -> turn fight: the touch enters the fight, both are carried into its arena, and the brute falls in the field', async () => {
  const sel = brawlSelection();
  const s = await step(BRAWL, sel, { trigger: 'damaged' });
  assert.ok(!s.r.steps.some(x => x.kind === 'inner'), 'the collection has the inner loop: nothing asked for it');
  assertStep(s, sel, { inner: 'gameplay.turns', trigger: 'damaged', roles: { hurt: 'who', by: 'by' } });
  // The turn fight is bound to its own space and played by participants (card.loop.needs.participants): both are carried there.
  assert.equal(s.inst.with.space, 'arena');
  assert.deepEqual(s.inst.with.carry, [{ role: 'hurt' }, { role: 'by' }]);
  const doc = fieldDoc(s.inst);
  assert.equal(doc.systems.find(x => x.use === 'gameplay.turns').with.autoStart, false, 'the fight waits for the encounter (card.engage.encounter.config)');
  const rt = boot(doc);
  for (let i = 0; i < 5 && !encounter(rt, s.inst)?.active; i++) rt.step({});
  assert.ok(encounter(rt, s.inst).active, 'the touch started the fight');
  assert.deepEqual(encounter(rt, s.inst).active.roles, { hurt: 'player', by: 'b1' });
  assert.equal(rt.player().space, 'arena');
  assert.equal(rt.entity('b1').space, 'arena');
  for (let i = 0; encounter(rt, s.inst).active && i < 60; i++) {
    const t = rt.state.prim['gameplay.turns'];
    rt.step(t.current?.side === 'hero' ? { actions: { turn_act: { unit: 'player', action: 'strike', target: 'b1' } } } : {});
  }
  assert.equal(encounter(rt, s.inst).last, 'won');
  assert.ok(dead(rt, 'b1'), 'the brute is out of play');
  assert.ok(!dead(rt, 'player'));
  assert.equal(rt.player().space, 'field', 'the player is carried back to the field');
});

// ---------- door -> race ----------
const LAP = []; for (let x = 1; x <= 11; x++) LAP.push([x, 1]); for (let y = 2; y <= 11; y++) LAP.push([11, y]); for (let x = 10; x >= 1; x--) LAP.push([x, 11]); for (let y = 10; y >= 1; y--) LAP.push([1, y]);
const GATE = spec({ premise: 'Explore a yard whose doors are races', outer: 'explore', inner: 'race', interaction: 'avatar-grid' });
const gateSelection = () => selection({ spaces: [{ id: 'yard', use: 'engine.space.grid', with: { size: [6, 6] } }, { id: 'course', use: 'engine.space.grid', with: { size: [13, 13] }, role: 'course' }],
  systems: ['engine.input.actions', 'gameplay.combat.health', 'gameplay.interact', 'gameplay.race'], bind: { 'gameplay.race': 'course' },
  mechanics: { explore: ['gameplay.interact'], race: ['gameplay.race'] } });
const yardDoc = inst => configure({
  schema: SCHEMA, id: 'door-race', title: 'Door race', seed: 4,
  spaces: [{ id: 'yard', use: 'engine.space.grid', with: { size: [6, 6] } },
    { id: 'course', use: 'engine.space.grid', with: { size: [13, 13] }, zones: [{ id: 'start', rect: [0, 0, 3, 3] }, { id: 'east', rect: [10, 0, 13, 3] }, { id: 'north', rect: [10, 10, 13, 13] }, { id: 'west', rect: [0, 10, 3, 13] }] }],
  systems: [
    { use: 'gameplay.combat.health' },
    { use: 'gameplay.interact' },
    { use: 'gameplay.race', space: 'course', with: { countdown: 0, laps: 1, checkpoints: ['start', 'east', 'north', 'west'], racers: ['rival'] } },
    { use: 'engine.spawner', with: { intervalSec: 0, rules: [
      { id: 'd1', archetype: 'door', space: 'yard', at: [2, 3], unique: true, activation: 'always', respawnSec: 0 },
      { id: 'r1', archetype: 'rival', space: 'course', at: [1, 1], unique: true, activation: 'always', respawnSec: 0 }] } },
  ],
  content: { archetypes: [{ id: 'runner', components: { health: { max: 3 } } }, { id: 'door', components: { health: { max: 1 }, interact: { prompt: 'Race for the gate', kind: 'use' } } }, { id: 'rival', components: {} }] },
  player: { archetype: 'runner', space: 'yard', at: [2, 2] },
}, inst);
function race(rt, inst, speeds) {
  const t = {};
  for (let i = 0; i < 600 && encounter(rt, inst).active; i++) {
    for (const [id, every] of Object.entries(speeds)) { const e = rt.entity(id); if (e?.space === 'course' && i % every === 0) { t[id] = (t[id] ?? 0) + 1; rt.space('course').setPos(e, LAP[t[id] % LAP.length], rt); } }
    rt.step({});
  }
}

test('door -> race: using the door carries the runner onto the course; the race result decides the door or the runner', async () => {
  const sel = gateSelection();
  const s = await step(GATE, sel, { trigger: 'interacted' });
  assertStep(s, sel, { inner: 'gameplay.race', trigger: 'interacted', roles: { user: 'who', used: 'target' } });
  assert.equal(s.inst.with.space, 'course');
  assert.deepEqual(s.inst.with.carry, [{ role: 'user' }, { role: 'used' }]);
  for (const [speeds, result, loser, keeper] of [[{ player: 1, r1: 3 }, 'won', 'd1', 'player'], [{ player: 3, r1: 1 }, 'lost', 'player', 'd1']]) {
    const rt = boot(yardDoc(s.inst));
    rt.step({}); rt.step({ actions: { interact: true } }); rt.step({});
    assert.ok(encounter(rt, s.inst).active, 'using the door started the race');
    assert.equal(rt.player().space, 'course', 'the runner races on the course');
    race(rt, s.inst, speeds);
    assert.equal(encounter(rt, s.inst).last, result);
    assert.ok(dead(rt, loser), `${loser} is out of play`);
    assert.ok(!dead(rt, keeper), `${keeper} keeps its place`);
    assert.equal(rt.player().space, 'yard', 'the runner comes back to the yard');
  }
});

test('a trigger the outer loop does not declare participants for is never offered: none means a gap, nothing added', async () => {
  const sel = gateSelection();
  const s = await step(GATE, sel, { trigger: 'used' });
  const offered = s.writer.calls.find(c => c.schema.name === 'pick_nested_trigger').schema.schema.properties.pick.enum;
  assert.deepEqual(offered, ['interacted', 'none'], 'used and read name no participants (card.loop.involves)');
  assert.equal(s.inst, undefined);
  assert.equal(s.r.gaps.length, 1);
  assert.equal(s.r.gaps[0].kind, 'adapter');
  assert.equal(s.r.steps.find(x => x.kind === 'nested').outcome, 'gap');
});

// ---------- instance ids ----------
test('a projection resolveAdapters adds always has an id, from its declaration when the adapt() hook gives none', () => {
  // The turn board plays on cell occupancy (stated here as the adapter tests do), which a tile overworld lacks.
  const turns = registry.get('gameplay.turns');
  const needy = { ...turns, card: { ...turns.card, requires: { ...turns.card.requires, capabilities: ['occupancy'] } } };
  const projection = registry.get('engine.adapt.projection');
  const silent = { ...projection, adapt: req => ({ with: projection.adapt(req).with }) };
  const world = { id: 'world', use: 'engine.space.tilemap', with: { size: [20, 12], mode: 'topdown' } };
  for (const p of [projection, silent]) {
    const reg = new Registry(registry.ids().map(id => (id === 'gameplay.turns' ? needy : id === 'engine.adapt.projection' ? p : registry.get(id))));
    const r = resolveAdapters({ spaces: [world], systems: ['gameplay.turns', 'gameplay.combat.health'] }, reg);
    assert.equal(r.verdict, 'compatible-via-adapter', r.result.reason);
    const [a] = r.adapters;
    assert.equal(a.use, 'engine.adapt.projection');
    assert.equal(a.id, 'grid-on-world', 'the projected kind plus the host space');
    assert.equal(r.bind['gameplay.turns'], a.id);
    assert.deepEqual(instanceFieldProblems({ spaces: [world], adapters: r.adapters }, reg), []);
    // Unique within the document: a space already named so pushes the region id on.
    const taken = resolveAdapters({ spaces: [world, { id: 'grid-on-world', use: 'engine.space.none' }], systems: ['gameplay.turns'], bind: { 'gameplay.turns': 'world' } }, reg);
    assert.equal(taken.adapters[0].id, 'grid-on-world-2');
  }
});

test('a projection instance without an id (the live chess x pokemon failure) is repaired by code, never sent to the model', () => {
  const doc = { schema: SCHEMA, id: 'board-on-map', title: 'Board on a map', seed: 1,
    spaces: [{ id: 'map', use: 'engine.space.tilemap', with: { size: [20, 12], mode: 'topdown' } }],
    systems: [{ use: 'engine.adapt.projection', with: { kind: 'engine.space.grid', config: { size: [6, 6] }, origin: [1.5, 1.5] } }, { use: 'gameplay.combat.health' }],
    content: { archetypes: [{ id: 'hero', components: {} }] }, player: { archetype: 'hero', space: 'map', at: [2, 2] } };
  const before = preflight(doc, registry, logic);
  assert.ok(before.errors.some(e => e.code === 'projection_id'), 'preflight names the missing id');
  assert.deepEqual(instanceFieldProblems(doc, registry).map(p => p.field).sort(), ['id', 'space']);
  const r = repairDocument(doc, { registry, logic });
  assert.ok(r.ok, JSON.stringify(r.errors));
  const region = r.doc.systems.find(s => s.use === 'engine.adapt.projection');
  assert.equal(region.id, 'grid-on-map');
  assert.equal(region.space, 'map');
  assert.ok(r.fixes.some(f => f.code === 'instance_id'));
  assert.deepEqual(instanceFieldProblems(r.doc, registry), []);
  // Idempotent: a document with its fields filled is left as it is.
  assert.deepEqual(ensureInstanceFields(structuredClone(r.doc), registry), []);
});
