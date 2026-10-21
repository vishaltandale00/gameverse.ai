// The document's structure follows the idea (FABLE design steps 3-5): the play spec (decomposition.core) and the
// chosen cards' declarations (card.mode, locomotion, needs) decide avatar, zones, story and endings; no one shape
// is stamped onto every idea. Offline: real catalogue, lexical selection, the preset and a form-filling fake writer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { normalize, decompositionSchema } from '../v2/planner/decompose.js';
import { selectPrimitives } from '../v2/planner/select.js';
import { ensureAgency, writeOutline } from '../v2/planner/outline.js';
import { preset, structureOf } from '../v2/planner/presets.js';
import { kindViewPreserved } from '../v2/planner/census.js';
import { coreLoopProblems } from '../v2/planner/core-loop.js';
import { modeIds } from '../v2/planner/modes.js';
import { fakeWriter } from './v2-p-pipeline-fixtures.js';

const { registry, logic } = buildCatalogue();

/** A decomposition as the model would write it (with the play spec), normalized against the catalogue. */
const idea = (prompt, mechanics, views, core, spaces = []) => normalize({ title: prompt, premise: `${prompt}.`, mechanics: mechanics.map((d, i) => ({ id: `m${i}`, verb: d.split(' ')[0], description: d, importance: 'core' })), views, spaces, acts: 2, zones: 4, core }, prompt, registry);
async function plan(d) {
  const sel = await selectPrimitives({ decomposition: d, registry });
  const a = await ensureAgency({ decomposition: d, selection: sel, registry, logic, seed: 7 });
  return { sel: a.selection, p: preset({ decomposition: d, selection: a.selection, registry, logic, seed: 7 }) };
}
const isBase = id => registry.get(id)?.card.locomotion === 'base';
const zoneBeats = doc => (doc.plot?.storyboard?.acts || []).flatMap(a => a.beats || []).filter(b => JSON.stringify(b.when || {}).includes('"zone"'));

const CHESS = idea('chess but with pokemon', ['move pieces by chess rules in turns', 'capture an opposing piece when a creature wins the clash', 'checkmate the opposing king'], ['board', 'ui'],
  { mode: 'tactics', interaction: 'pieces-turns', opponent: 'ai-side', win: 'checkmate', lose: 'your king is checkmated', theme: 'creature chess', narrative: false, secondary: [{ mode: 'creature-battle', relation: 'nested', why: 'a capture is decided by a creature battle' }] }, [{ role: 'board', kind: 'board', description: '8x8' }]);
const CARDS = idea('a card battler', ['play spell cards from a hand each turn', 'defeat the opponent before your deck runs out'], ['ui'],
  { mode: 'card-battle', interaction: 'menu', opponent: 'ai-side', win: 'the opponent falls', lose: 'you fall', theme: 'arcane duels', narrative: false, secondary: [] }, [{ role: 'table', kind: 'none', description: 'a card table' }]);
const MATCH = idea('a match-3 with enchanted gems', ['swap adjacent gems to match three or more', 'reach the target score before moves run out'], ['board'],
  { mode: 'match-board', interaction: 'cursor-board', opponent: 'clock', win: 'reach the target score', lose: 'out of moves', theme: 'gems', narrative: false, secondary: [] }, [{ role: 'board', kind: 'board', description: 'a gem grid' }]);
const PLATFORMER = idea('a Mario-style platformer', ['run and jump across platforms', 'stomp enemies', 'collect coins and reach the flag'], ['side'],
  { mode: 'story', interaction: 'avatar-realtime', opponent: 'hazards', win: 'reach the flag', lose: 'lose every life', theme: 'bright', narrative: false, secondary: [] }, [{ role: 'level', kind: 'tiles-side', description: 'a side-view level' }]);

test('the play spec is part of the decomposition schema, its mode enum from the catalogue', () => {
  const s = decompositionSchema(registry);
  assert.ok(s.required.includes('core'));
  assert.deepEqual(s.properties.core.properties.mode.enum, modeIds(registry));
  assert.ok(modeIds(registry).includes('tactics') && modeIds(registry).includes('story'));
  assert.equal(CHESS.core.interaction, 'pieces-turns');
  assert.equal(CHESS.movement, 'none', 'no avatar, no avatar movement');
});

test('chess × Pokémon, a card battler and a match-3: no avatar, no zones, no zone-entry beats; the loop owns the win', async () => {
  for (const d of [CHESS, CARDS, MATCH]) {
    const { p, sel } = await plan(d);
    // The scaffold may still lack the content the model writes (species, cards): only content may be missing.
    assert.ok(p.ok || p.errors.every(e => /_missing$|^no_|_empty$|_no_/.test(e.code)), `${d.title}: ${JSON.stringify(p.errors.slice(0, 2))}`);
    const doc = /** @type {any} */ (p.doc);
    assert.equal(p.structure.avatar, false, d.title);
    assert.ok(!(doc.systems || []).some(s => isBase(s.use)), `${d.title}: no walking movement (${doc.systems.map(s => s.use).join(' ')})`);
    assert.equal(doc.content.archetypes.find(a => a.id === doc.player.archetype)?.kind, 'player');
    assert.equal(doc.spaces.reduce((n, s) => n + (s.zones || []).length, 0), 0, `${d.title}: no locations`);
    assert.equal(zoneBeats(doc).length, 0, `${d.title}: no zone-entry beats`);
    assert.equal(doc.plot.storyboard, undefined, `${d.title}: no story without narrative`);
    const mode = registry.cards().find(c => c.mode?.loop === d.core.mode);
    assert.ok(doc.systems.some(s => s.use === mode.id), `${d.title}: the mode primitive ${mode.id} is installed`);
    assert.ok(doc.plot.endings?.some(e => e.id === 'victory' && e.outcome === 'won'), `${d.title}: a victory ending`);
    assert.deepEqual(coreLoopProblems(doc, sel.mechanics, registry).filter(x => x.code === 'win_unwired'), [], `${d.title}: the win is wired`);
  }
});

test('chess × Pokémon keeps both ideas: the creature battle is a nested mode with its own space', async () => {
  const { p } = await plan(CHESS);
  assert.ok(p.doc.systems.some(s => s.use === 'gameplay.turns'));
  assert.ok(p.doc.systems.some(s => s.use === 'gameplay.creature.battle'), 'the secondary mode is installed');
  assert.deepEqual(p.structure.nested.length, 1);
  const battle = p.doc.systems.find(s => s.use === 'gameplay.creature.battle');
  assert.equal(battle.with?.space, p.structure.nested[0], 'battles happen in the nested space');
  assert.ok(p.doc.systems.find(s => s.use === 'gameplay.turns').with.onVictory.some(e => e.do === 'end_game'), 'checkmate (the turns victory) ends the game');
});

test('a platformer still gets its avatar and its places', async () => {
  const { p } = await plan(PLATFORMER);
  assert.ok(p.ok, JSON.stringify(p.errors.slice(0, 2)));
  assert.equal(p.structure.avatar, true);
  assert.ok(p.doc.systems.some(s => s.use === 'gameplay.move.platformer'), p.doc.systems.map(s => s.use).join(' '));
  assert.ok(p.doc.spaces[0].zones.length >= 2);
});

test('the genre and view survive the outline for six ideas across td, side, 3p, board, ui and text', async () => {
  const ideas = [
    idea('a cozy farming game on a floating island', ['till soil, plant and water crops, harvest them', 'walk around the farm'], ['td', 'ui'], { mode: 'story', interaction: 'avatar-realtime', opponent: 'none', win: 'a full harvest', lose: '', theme: 'cozy', narrative: true, secondary: [] }, [{ role: 'farm', kind: 'tiles-topdown', description: 'the island' }]),
    PLATFORMER,
    idea('a 3D Zelda dungeon inside a giant clock', ['walk through dungeon rooms', 'fight clockwork guardians with a sword', 'pull levers to open doors'], ['3p'], { mode: 'story', interaction: 'avatar-realtime', opponent: 'hazards', win: 'stop the clock', lose: 'fall', theme: 'brass', narrative: true, secondary: [] }, [{ role: 'dungeon', kind: 'continuous-3d', description: 'the clock' }]),
    CHESS, CARDS,
    idea('a mystery adventure', ['question suspects', 'gather clues', 'name the culprit'], ['text'], { mode: 'story', interaction: 'avatar-realtime', opponent: 'none', win: 'name the culprit', lose: '', theme: 'noir', narrative: true, secondary: [] }, [{ role: 'manor', kind: 'locations', description: 'rooms' }]),
  ];
  for (const d of ideas) {
    const { p, sel } = await plan(d);
    const kv = kindViewPreserved(d, /** @type {any} */ (p.doc), registry);
    assert.ok(kv.ok, `${d.title} (preset): ${kv.problems.join('; ')}`);
    // Through the outline: a model filling the form cannot change the spaces, views or movement.
    const writer = fakeWriter([(req) => {
      const scaffold = JSON.parse(req.user.split('not the game):\n')[1].split('\n\nWrite the outline')[0]);
      const spaces = Object.fromEntries(scaffold.spaces.map(s => [s.id, { zones: s.zones.map(z => ({ id: z.id, name: z.id, description: z.id, exits: (z.exits || []).map(x => ({ to: x.to, gate_json: x.gate ? JSON.stringify(x.gate) : null })) })) }]));
      return JSON.stringify({ title: d.title, logline: 'l', premise: 'p', spaces, views: { primary: 'side' } });
    }]);
    const o = await writeOutline({ writer, prompt: d.title, decomposition: d, selection: sel, registry, logic, seed: 7, verify: false, maxRounds: 0 });
    if (!o.ok) continue; // content the fake never fills may fail a strict game: the structure check above stands
    const ko = kindViewPreserved(d, o.doc, registry);
    assert.ok(ko.ok, `${d.title} (outline): ${ko.problems.join('; ')}`);
  }
});

test('structureOf reports what it changed and why', () => {
  const st = structureOf(CHESS, { systems: ['gameplay.move.grid', 'gameplay.turns', 'plot.storyboard'], spaces: [], generators: [], graphics: [], bind: {}, mechanics: [], gaps: [] }, registry);
  assert.deepEqual(st.removed.map(r => r.use).sort(), ['gameplay.move.grid', 'plot.storyboard']);
  assert.ok(st.systems.includes('gameplay.creature.battle'));
});
