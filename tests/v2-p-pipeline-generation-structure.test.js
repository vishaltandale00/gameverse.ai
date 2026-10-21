// The document's structure is composed from the idea's collection of primitives: the play spec (decomposition.core,
// no mode) and what the chosen cards declare (card.loop / card.mode, locomotion, needs) decide avatar, zones, story,
// the win and endings; no one shape is stamped onto every idea. Offline: real catalogue, the collection each idea's
// mechanics map to (a fixed selection: selection itself is the model's build), the preset and a form-filling fake writer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { normalize, decompositionSchema } from '../v2/planner/decompose.js';
import { adapterStepsOnSelection, makeAsk } from '../v2/planner/build-steps.js';
import { writeOutline } from '../v2/planner/outline.js';
import { preset, structureOf } from '../v2/planner/presets.js';
import { kindViewPreserved } from '../v2/planner/census.js';
import { coreLoopProblems } from '../v2/planner/core-loop.js';
import { cardLoop, endsGame, loopOf } from '../v2/planner/loop.js';
import { preflight } from '../v2/kernel/document.js';
import { fakeWriter, selectionOf } from './v2-p-pipeline-fixtures.js';

const { registry, logic } = buildCatalogue();

/** A decomposition as the model would write it (with the play spec), normalized against the catalogue. */
const idea = (prompt, mechanics, views, core, spaces = []) => normalize({ title: prompt, premise: `${prompt}.`, mechanics: mechanics.map((d, i) => ({ id: `m${i}`, verb: d.split(' ')[0], description: d, importance: 'core' })), views, spaces, acts: 2, zones: 4, core }, prompt, registry);
/** What each idea's mechanics map to (by title): the collection the preset composes. @type {Map<string, Parameters<typeof selectionOf>[2]>} */
const COLLECTIONS = new Map();
async function plan(d) {
  const sel = selectionOf(registry, d, /** @type {any} */ (COLLECTIONS.get(d.title)));
  return { sel, p: preset({ decomposition: d, selection: sel, registry, logic, seed: 7 }) };
}
const isBase = id => registry.get(id)?.card.locomotion === 'base';
const zoneBeats = doc => (doc.plot?.storyboard?.acts || []).flatMap(a => a.beats || []).filter(b => JSON.stringify(b.when || {}).includes('"zone"'));
/** A fake writer filling the small forms from the scaffold it is shown (zones named; everything else left to the scaffold). */
const formFiller = title => fakeWriter([(req) => {
  const scaffold = JSON.parse(req.user.split('not the game):\n')[1].split('\n\nWrite the outline')[0]);
  const spaces = Object.fromEntries(scaffold.spaces.map(s => [s.id, { zones: s.zones.map(z => ({ id: z.id, name: z.id, description: z.id, exits: (z.exits || []).map(x => ({ to: x.to, gate_json: x.gate ? JSON.stringify(x.gate) : null })) })) }]));
  return JSON.stringify({ title, logline: 'l', premise: 'p', spaces, views: { primary: 'side' } });
}]);

const CHESS = idea('chess but with pokemon', ['move pieces by chess rules in turns', 'capture an opposing piece when a creature wins the clash', 'checkmate the opposing king'], ['board', 'ui'],
  { interaction: 'pieces-turns', opponent: 'ai-side', win: 'checkmate', lose: 'your king is checkmated', theme: 'creature chess', narrative: false, mashup: [{ relation: 'nested', mechanics: ['m1'], why: 'a capture is decided by a creature battle' }] }, [{ role: 'board', kind: 'board', description: '8x8' }]);
const CARDS = idea('a card battler', ['play spell cards from a hand each turn', 'defeat the opponent before your deck runs out'], ['ui'],
  { interaction: 'menu', opponent: 'ai-side', win: 'the opponent falls', lose: 'you fall', theme: 'arcane duels', narrative: false, mashup: [] }, [{ role: 'table', kind: 'none', description: 'a card table' }]);
const MATCH = idea('a match-3 with enchanted gems', ['swap adjacent gems to match three or more', 'reach the target score before moves run out'], ['board'],
  { interaction: 'cursor-board', opponent: 'clock', win: 'reach the target score', lose: 'out of moves', theme: 'gems', narrative: false, mashup: [] }, [{ role: 'board', kind: 'board', description: 'a gem grid' }]);
const PLATFORMER = idea('a Mario-style platformer', ['run and jump across platforms', 'stomp enemies', 'collect coins and reach the flag'], ['side'],
  { interaction: 'avatar-realtime', opponent: 'hazards', win: 'reach the flag', lose: 'lose every life', theme: 'bright', narrative: false, mashup: [] }, [{ role: 'level', kind: 'tiles-side', description: 'a side-view level' }]);
const MINE = idea('mine and build in a blocky world', ['mine blocks', 'place blocks to build'], ['3p'],
  { interaction: 'avatar-realtime', opponent: 'none', win: 'build the biggest castle', lose: '', theme: 'blocky', narrative: false, mashup: [] }, [{ role: 'world', kind: 'continuous-3d', description: '' }]);
COLLECTIONS.set(CHESS.title, { id: 'board', space: 'engine.space.grid', map: { m0: ['gameplay.turns'], m1: ['gameplay.creature.battle'], m2: ['gameplay.turns'] }, systems: ['gameplay.creature.party'] });
COLLECTIONS.set(CARDS.title, { id: 'table', space: 'engine.space.none', map: { m0: ['gameplay.cards'], m1: ['gameplay.cards'] } });
COLLECTIONS.set(MATCH.title, { id: 'board', space: 'engine.space.grid', map: { m0: ['gameplay.match'], m1: ['gameplay.match'] } });
COLLECTIONS.set(PLATFORMER.title, { id: 'level', space: 'engine.space.tilemap', map: { m0: ['gameplay.move.platformer'], m1: ['gameplay.combat.health'], m2: ['gameplay.collectible', 'gameplay.goal'] }, generators: ['engine.generate.tilemap.rooms'] });
COLLECTIONS.set(MINE.title, { space: 'engine.space.voxel', map: { m0: ['gameplay.blocks.mine'], m1: ['gameplay.blocks.place'] }, systems: ['gameplay.move.walk'], generators: ['engine.generate.terrain.noise'] });

test('the play spec has no mode: interaction, opponent, win, lose, theme, narrative and mashup relations', () => {
  const s = decompositionSchema(registry);
  assert.ok(s.required.includes('core'));
  assert.equal(s.properties.core.properties.mode, undefined, 'no closed list of modes');
  assert.deepEqual(s.properties.core.required.sort(), ['interaction', 'loop', 'lose', 'mashup', 'narrative', 'opponent', 'theme', 'win']);
  assert.equal(CHESS.core.interaction, 'pieces-turns');
  assert.equal(CHESS.movement, 'none', 'no avatar, no avatar movement');
  assert.deepEqual(CHESS.core.mashup, [{ relation: 'nested', mechanics: ['m1'], why: 'a capture is decided by a creature battle' }]);
  // Nothing is guessed from words when no model wrote a spec: the collection decides.
  const offline = normalize({ title: 'x', premise: 'chess', mechanics: [{ id: 'm', verb: 'move', description: 'move pieces in turns', importance: 'core' }] }, 'chess', registry);
  assert.equal(offline.core.interaction, null);
  assert.equal(offline.core.narrative, null);
});

test('chess × Pokémon, a card battler and a match-3: no avatar, no zones, no story; the collection\'s declared win ends the game', async () => {
  for (const d of [CHESS, CARDS, MATCH]) {
    const { p, sel } = await plan(d);
    // The scaffold may still lack the content the model writes (species, cards): only content may be missing.
    assert.ok(p.ok || p.errors.every(e => /_missing$|^no_|_empty$|_no_|_invalid$/.test(e.code)), `${d.title}: ${JSON.stringify(p.errors.slice(0, 2))}`);
    const doc = /** @type {any} */ (p.doc);
    assert.equal(p.structure.avatar, false, d.title);
    assert.ok(!(doc.systems || []).some(s => isBase(s.use)), `${d.title}: no walking movement (${doc.systems.map(s => s.use).join(' ')})`);
    assert.equal(doc.content.archetypes.find(a => a.id === doc.player.archetype)?.kind, 'player');
    assert.equal(doc.spaces.reduce((n, s) => n + (s.zones || []).length, 0), 0, `${d.title}: no locations`);
    assert.equal(zoneBeats(doc).length, 0, `${d.title}: no zone-entry beats`);
    assert.equal(doc.plot.storyboard, undefined, `${d.title}: no story without narrative`);
    // The win: a core primitive that declares one, installed and wired.
    const win = p.structure.win;
    assert.ok(win && doc.systems.some(s => s.use === win.use), `${d.title}: the win owner is installed (${JSON.stringify(win)})`);
    assert.ok(endsGame(cardLoop(registry.get(win.use).card).win));
    assert.ok(sel.mechanics.some(m => m.importance === 'core' && m.primitives.includes(win.use)), `${d.title}: ${win.use} serves a core mechanic`);
    assert.ok(doc.plot.endings?.some(e => e.id === 'victory' && e.outcome === 'won'), `${d.title}: a victory ending`);
    assert.deepEqual(coreLoopProblems(doc, sel.mechanics, registry).filter(x => x.code === 'win_unwired'), [], `${d.title}: the win is wired`);
    assert.ok(loopOf(doc, registry).progress.length, `${d.title}: the document declares its loop's progress`);
  }
});

// The same idea with its concepts told apart (mechanic.from) and its loop named, as decompose.js now writes it: the nested
// entry joins the creature clash (its own concept's loop) into the chess loop.
const CHESS_X = { ...structuredClone(CHESS), concepts: [{ id: 'chess', name: 'chess', quote: 'chess', kind: 'game', keeps: [], loop: 'm0' }, { id: 'pokemon', name: 'pokemon', quote: 'pokemon', kind: 'game', keeps: [], loop: 'm1' }],
  mechanics: CHESS.mechanics.map(m => ({ ...m, from: m.id === 'm1' ? 'pokemon' : 'chess' })),
  core: { ...CHESS.core, loop: 'm0', mashup: [{ relation: 'nested', mechanics: ['m0', 'm1'], why: 'a capture is decided by a creature battle' }] } };
/** The selection with the build's adapter steps run over it (build-steps.js adapterSteps; a scripted model picks the trigger). */
async function planNested(d) {
  const sel = selectionOf(registry, d, { id: 'board', space: 'engine.space.grid', map: { m0: ['gameplay.turns'], m1: ['gameplay.creature.battle'], m2: ['gameplay.turns'] }, systems: ['gameplay.creature.party'] });
  const writer = fakeWriter([req => JSON.stringify({ pick: req.schema.schema.properties.pick.enum.find(x => x === 'attack_hit' || x === 'gameplay.creature.battle') || 'none', why: 'scripted', spec: '' })]);
  const steps = await adapterStepsOnSelection({ registry, decomposition: d, selection: sel, ask: makeAsk({ writer }) });
  return { sel, steps, p: preset({ decomposition: d, selection: sel, registry, logic, seed: 7 }) };
}

test('chess × creatures: the nested step adds the nested adapter for the battle loop, and the document preflights', async () => {
  const { p, steps } = await planNested(CHESS_X);
  const doc = /** @type {any} */ (p.doc);
  assert.ok(doc.systems.some(s => s.use === 'gameplay.turns'));
  assert.equal(p.structure.win.use, 'gameplay.turns', 'checkmate (the turns victory) owns the win, not the battle');
  assert.ok(doc.systems.find(s => s.use === 'gameplay.turns').with.onVictory.some(e => e.do === 'end_game'));
  const nested = doc.systems.find(s => registry.get(s.use)?.card.adapts?.relation === 'nested');
  assert.ok(nested, `the nested adapter joins: ${doc.systems.map(s => s.use).join(' ')}`);
  assert.ok(nested.with.inner.includes('gameplay.creature.battle') && !nested.with.inner.includes('gameplay.turns'), JSON.stringify(nested.with));
  assert.ok(steps.steps.some(s => s.kind === 'nested' && s.outcome === 'added'), 'the build step added it, not the preset');
  assert.ok(p.ok, JSON.stringify(p.errors.slice(0, 3)));
  assert.ok(preflight(doc, registry, logic).ok, JSON.stringify(preflight(doc, registry, logic).errors.slice(0, 3)));
  // Through the outline with a fake model that themes the scaffold: the adapter stays and the model's document preflights.
  const { sel } = await planNested(CHESS_X);
  const themed = { ...structuredClone(doc), title: 'Pocket Gambit', systems: doc.systems.filter(s => s.use !== nested.use) };
  const o = await writeOutline({ forms: 'single', writer: fakeWriter([JSON.stringify(themed)]), prompt: CHESS_X.title, decomposition: CHESS_X, selection: sel, registry, logic, seed: 7, verify: false, maxRounds: 0 });
  assert.ok(o.ok, JSON.stringify(o.errors?.slice(0, 3)));
  assert.equal(o.doc.title, 'Pocket Gambit');
  assert.ok(o.doc.systems.some(s => s.use === nested.use), 'the collection is code\'s: a draft that drops the adapter gets it back');
  assert.ok(preflight(o.doc, registry, logic).ok);
});

test('a platformer gets its avatar and its places; its loop and win come from what its primitives declare', async () => {
  const { p } = await plan(PLATFORMER);
  assert.ok(p.ok, JSON.stringify(p.errors.slice(0, 2)));
  assert.equal(p.structure.avatar, true);
  assert.ok(p.doc.systems.some(s => s.use === 'gameplay.move.platformer'), p.doc.systems.map(s => s.use).join(' '));
  assert.ok(p.doc.spaces[0].zones.length >= 2);
  assert.ok(p.structure.win, 'a declared win');
  assert.equal(p.doc.plot.storyboard, undefined, 'no adventure skeleton: no acts, no reach-zone beats');
});

test('a collection that declares no win is a core gap: the preset never picks a primitive that declares one (selection\'s win step does)', async () => {
  const { p, sel } = await plan(MINE);
  assert.equal(p.structure.win, null, JSON.stringify(p.structure));
  const gap = p.gaps.find(g => g.kind === 'win');
  assert.equal(gap?.importance, 'core');
  assert.match(gap.why, /win step/);
  // Nothing was added for a win: the document runs only what selection chose.
  assert.deepEqual(p.structure.added.filter(a => /win/.test(a.why)), []);
  const winners = p.doc.systems.map(s => s.use).filter(u => !sel.systems.includes(u) && endsGame(cardLoop(registry.get(u)?.card)?.win));
  assert.deepEqual(winners, []);
});

test('the genre and view survive the outline for ideas across td, side, 3p, board and ui', async () => {
  const ideas = [
    idea('a cozy farming game on a floating island', ['till soil, plant and water crops, harvest them', 'walk around the farm'], ['td', 'ui'], { interaction: 'avatar-realtime', opponent: 'none', win: 'a full harvest', lose: '', theme: 'cozy', narrative: false, mashup: [] }, [{ role: 'farm', kind: 'tiles-topdown', description: 'the island' }]),
    PLATFORMER,
    idea('a 3D Zelda dungeon inside a giant clock', ['walk through dungeon rooms', 'fight clockwork guardians with a sword', 'pull levers to open doors'], ['3p'], { interaction: 'avatar-realtime', opponent: 'hazards', win: 'stop the clock', lose: 'fall', theme: 'brass', narrative: true, mashup: [] }, [{ role: 'dungeon', kind: 'continuous-3d', description: 'the clock' }]),
    CHESS, CARDS,
  ];
  COLLECTIONS.set(ideas[0].title, { id: 'farm', space: 'engine.space.grid', map: { m0: ['gameplay.farming'], m1: ['gameplay.move.walk'] }, generators: ['engine.generate.grid.board'] });
  COLLECTIONS.set(ideas[2].title, { id: 'dungeon', space: 'engine.space.mesh3d', map: { m0: ['gameplay.move.walk'], m1: ['gameplay.combat.melee', 'gameplay.combat.health'], m2: ['gameplay.mechanism'] }, generators: ['engine.generate.dungeon.rooms'] });
  for (const d of ideas) {
    const { p, sel } = await plan(d);
    const kv = kindViewPreserved(d, /** @type {any} */ (p.doc), registry);
    assert.ok(kv.ok, `${d.title} (preset): ${kv.problems.join('; ')}`);
    // Through the outline: a model filling the form cannot change the spaces, views or movement.
    const o = await writeOutline({ writer: formFiller(d.title), prompt: d.title, decomposition: d, selection: sel, registry, logic, seed: 7, verify: false, maxRounds: 0 });
    if (!o.ok) continue; // content the fake never fills may fail a strict game: the structure check above stands
    const ko = kindViewPreserved(d, o.doc, registry);
    assert.ok(ko.ok, `${d.title} (outline): ${ko.problems.join('; ')}`);
  }
});

test('structureOf reports what it changed and why', () => {
  const st = structureOf(CHESS, { systems: ['gameplay.move.grid', 'gameplay.turns', 'plot.storyboard'], spaces: [], generators: [], graphics: [], bind: {}, mechanics: [{ id: 'm0', importance: 'core', primitives: ['gameplay.turns'] }], gaps: [] }, registry);
  // No avatar: its base locomotion leaves, with why. The story runner the selection chose stays (the play spec's
  // narrative flag removes nothing): a chosen story reader is what makes the game tell a story.
  assert.deepEqual(st.removed.map(r => r.use).sort(), ['gameplay.move.grid']);
  assert.ok(st.removed.every(r => r.why));
  assert.ok(st.systems.includes('plot.storyboard') && st.narrative === true);
  assert.equal(st.win.use, 'gameplay.turns');
});
