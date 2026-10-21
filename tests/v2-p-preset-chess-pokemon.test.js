// The structure of "chess but with pokemon" comes from the declarations, not the model: the live run
// (fixtures/v2-chess-pokemon-selection.json, from local-data/v2/games/chess-but-with-pokemon-mvhni0gk/failed-1.json)
// failed because a dungeon rooms generator was put on the 8×8 board (12 rooms requested, 0 slots), the pieces were
// defined but never placed, and the skin adapter's section params were filled with creature ids. Offline: the real
// catalogue, the real selection, fake writers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { preset } from '../v2/planner/presets.js';
import { planWorld, generatorsFor, configureGenerators, contentOfGenerator } from '../v2/planner/world.js';
import { outlineForm, formKey } from '../v2/planner/outline-form.js';
import { placeContent, placeParticipants, populateProblems, referenceOf, idsAt, SECTIONS, SEAT } from '../v2/planner/content.js';
import { writeOutline } from '../v2/planner/outline.js';
import { preflight } from '../v2/kernel/document.js';
import { createWorld } from '../v2/kernel/world.js';
import { fakeWriter } from './v2-p-pipeline-fixtures.js';

const { registry, logic } = buildCatalogue();
const FX = JSON.parse(readFileSync(new URL('./fixtures/v2-chess-pokemon-selection.json', import.meta.url), 'utf8'));
const BOARD = FX.selection.spaces[0];
const intent = [FX.decomposition.premise, ...FX.decomposition.mechanics.map(m => m.description)].join('. ');
/** The selection as the live run had it: select.js planned the board's world for the grid mover (the stored record omits generators and bind). */
const liveSelection = () => ({ ...structuredClone(FX.selection), generators: [{ id: 'engine.generate.dungeon.rooms', space: BOARD.id, auto: true }], bind: {} });
const run = () => preset({ decomposition: structuredClone(FX.decomposition), selection: liveSelection(), registry, logic, seed: FX.seed, prompt: FX.prompt });
const makesRooms = id => contentOfGenerator(registry, id).includes('rooms');
const rulesOf = doc => doc.systems.flatMap(s => (Array.isArray(s.with?.rules) ? s.with.rules : []));
const SKIN = 'engine.adapt.skin';

test('the board gets no rooms generator: what a generator makes must be what the board needs, at a size it fits', () => {
  // The grid declares it needs cells; a dungeon makes rooms and entities nobody asked for and cannot fit 8×8.
  assert.ok(!generatorsFor(registry, BOARD, 'board').some(g => makesRooms(g.id)), 'an 8×8 board holds no room slots');
  const plan = planWorld(registry, BOARD, { view: 'board', have: ['zones'], intent });
  assert.deepEqual(plan.generators, ['engine.generate.grid.board']);
  assert.ok(!planWorld(registry, { ...BOARD, with: { size: [64, 64] } }, { view: 'board', have: ['zones'], intent }).generators.some(makesRooms), 'a big board that fits rooms still needs only cells');
  // The preset re-plans the world for the final collection: no piece is walked (grid movement left with the avatar), so the auto-planned generator goes.
  const p = run();
  assert.equal(p.ok, true, JSON.stringify(p.errors));
  assert.deepEqual(p.doc.spaces[0].generators || [], []);
  assert.ok(!p.errors.some(e => e.code === 'dungeon_area_small'));
});

test('a rooms generator the scaffold cannot configure takes its room count and area from the space extent, never 12', () => {
  const doc = { spaces: [{ id: 's', use: 'engine.space.tilemap', with: { size: [40, 30], mode: 'side' }, zones: [], generators: [{ use: 'engine.generate.dungeon.rooms' }] }], systems: [], content: {} };
  const fixes = configureGenerators(doc, registry);
  const w = doc.spaces[0].generators[0].with;
  assert.deepEqual(w.area, [0, 0, 40, 30]);
  assert.equal(w.rooms, 6, 'floor(40/12) × floor(30/12) room slots');
  assert.ok(fixes.some(f => f.code === 'world_extent_fit'));
});

test('both sides are seated by the preset from the loop declarations, on the board cells', () => {
  const p = run();
  const seats = rulesOf(p.doc).filter(r => r.id.startsWith(SEAT));
  const sides = new Map();
  for (const r of seats) { const side = r.components?.turns?.side ?? p.doc.content.archetypes.find(a => a.id === r.archetype).components.turns.side; sides.set(side, [...(sides.get(side) || []), r]); }
  assert.deepEqual([...sides.keys()].sort(), ['enemy', 'player'], 'gameplay.turns sides (needs.participants) each get pieces');
  for (const [side, rs] of sides) assert.ok(rs.length >= 2, `${side}: ${rs.length} pieces`);
  // The seats are declared edge bands (engine.spawner rule.band), resolved on the board as generated: a side's band is its
  // own edge (side 0 the far row, side 1 the near row); the cells are the world's, read once it is built.
  for (const r of seats) { assert.equal(r.at, undefined, `${r.id}: no position guessed before the world exists`); assert.equal(r.unique, true); assert.equal(r.activation, 'always'); }
  assert.ok(sides.get('player').every(r => r.band === 0) && sides.get('enemy').every(r => r.band === 1), 'each side at its own edge band');
  assert.deepEqual(populateProblems(p.doc, registry).filter(x => x.code === 'content_unplaced'), []);
  // The document preflights and boots with both sides' units in the turn order.
  const pre = preflight(p.doc, registry, logic);
  assert.ok(pre.ok, JSON.stringify(pre.errors));
  const rt = createWorld(pre.doc, registry, logic, { seed: FX.seed });
  for (let i = 0; i < 60; i++) rt.step();
  const units = Object.values(rt.state.prim['gameplay.turns'].units || {}).map(u => u.side);
  // Every seat spawned, one piece per cell, on the board, each side at its own edge (the player's the far row, y 7).
  const placed = seats.map(r => rt.entity(r.id));
  assert.ok(placed.every(Boolean), 'every seated piece is in the world');
  const cells = placed.map(e => e.at.join());
  assert.equal(new Set(cells).size, cells.length, 'one piece per cell');
  for (const e of placed) assert.ok(e.at[0] >= 0 && e.at[0] < 8 && e.at[1] >= 0 && e.at[1] < 8, `${e.id} on the board`);
  const rows = side => seats.filter(r => sides.get(side).includes(r)).map(r => rt.entity(r.id).at[1]);
  assert.ok(Math.min(...rows('player')) > Math.max(...rows('enemy')), `each side at its own edge: ${rows('player')} / ${rows('enemy')}`);
  assert.ok(units.filter(s => s === 'enemy').length >= 2 && units.filter(s => s === 'player').length >= 2, JSON.stringify(units));
});

test('pieces the model writes are seated by code: its placements are replaced, every side gets pieces', () => {
  const doc = structuredClone(run().doc);
  // The model themes three pieces of one side and places them where it likes (or nowhere).
  doc.content.archetypes.push(...['pawn', 'rook', 'knight'].map(id => ({ id, kind: 'npc', components: { name: id, turns: { side: 'player' } } })));
  rulesOf(doc).push({ id: 'model_pawns', archetype: 'pawn', at: [4, 4], count: [3, 3] });
  const placed = placeContent(doc, registry).doc;
  const rules = rulesOf(placed);
  assert.ok(!rules.some(r => r.id === 'model_pawns'), 'placement is not the model\'s');
  for (const piece of ['pawn', 'rook', 'knight']) {
    const rs = rules.filter(r => r.archetype === piece);
    assert.ok(rs.some(r => !r.components), `${piece} for the player's side`);
    assert.ok(rs.some(r => r.components?.turns?.side === 'enemy'), `${piece} mirrored for the enemy side`);
  }
  assert.deepEqual(placeParticipants(placed, registry).doc, placed, 'idempotent');
  assert.ok(preflight(placed, registry, logic).ok);
});

test('skin params are section paths the preset fills; the model has no slot for them', () => {
  const p = run();
  const skin = p.doc.systems.find(s => s.use === SKIN);
  assert.deepEqual(skin.with.maps.map(m => [m.from, m.to]), [['content.species', 'content.archetypes']], 'source concept content -> the turn loop\'s contract section');
  assert.equal(skin.with.maps[0].template.components.turns.side, 'player');
  assert.ok(p.doc.content.species.every(s => p.doc.content.archetypes.some(a => a.id === s.id && a.components.skin?.id === s.id)), 'every species stands as a piece');
  assert.ok(!p.errors.some(e => /^skin_/.test(e.code)));
  const form = outlineForm({ registry, skeleton: p.doc, selection: FX.selection });
  assert.equal(form.schema.schema.properties.systems.properties[formKey(SKIN)], undefined, 'no slot: the model does not write adapter params');
  // A model reply that writes them anyway is ignored.
  const draft = form.toDoc({ systems: { [formKey(SKIN)]: { with: { maps: [{ from: 'ember_cub', to: 'player_side' }] } } } });
  assert.deepEqual(draft.systems.find(s => s.use === SKIN).with.maps, skin.with.maps);
});

test('a section-path param is an enum of the document\'s sections, never of the ids inside one', () => {
  const from = registry.get(SKIN).card.params.maps.of.fields.from;
  assert.equal(referenceOf(registry, from), SECTIONS);
  const p = run();
  const paths = idsAt(p.doc, SECTIONS);
  assert.ok(paths.includes('content.species') && paths.includes('content.archetypes') && !paths.includes('ember_cub'), JSON.stringify(paths));
  // A skin the preset could not configure keeps its slot, with section paths as the only choices.
  const bare = structuredClone(p.doc);
  bare.systems.find(s => s.use === SKIN).with = {};
  const map = outlineForm({ registry, skeleton: bare, selection: FX.selection }).schema.schema.properties.systems.properties[formKey(SKIN)].properties.with.properties.maps.items.properties;
  assert.deepEqual(map.from.enum, paths);
  assert.deepEqual(map.to.enum, paths);
});

test('the outline with a fake writer keeps the preset structure: no rooms, both sides seated, skin from the preset', async () => {
  // The model themes the creature sections the packs filled (as it is shown them) and writes one piece of its own.
  const pack = run().doc.content;
  const writer = fakeWriter([() => JSON.stringify({
    title: 'Pokémon Chess', logline: 'Creatures as chess pieces.', premise: 'Two sides of creatures face off on a board.',
    section_content_species: pack.species, section_content_moves: pack.moves, section_content_types: pack.types,
    systems: { [formKey(SKIN)]: { with: { maps: [{ from: 'ember_cub', to: 'player_side' }] } } },
    archetypes: [{ id: 'pawn', kind: 'npc', name: 'Pawn', components: { turns: { side: 'player', ap: null, initiative: null, speed: null, aim: null, defense: null, actions: null }, other_json: null } }],
    spawns: [], items: [], characters: [], endings: [],
  })]);
  const o = await writeOutline({ writer, prompt: FX.prompt, decomposition: structuredClone(FX.decomposition), selection: liveSelection(), registry, logic, seed: FX.seed, maxRounds: 0, verify: false });
  assert.ok(o.ok, JSON.stringify({ errors: o.errors, rounds: o.rounds }));
  const doc = o.doc;
  assert.ok(!(doc.spaces[0].generators || []).some(g => makesRooms(g.use)));
  assert.deepEqual(doc.systems.find(s => s.use === SKIN).with.maps.map(m => [m.from, m.to]), [['content.species', 'content.archetypes']]);
  const pawns = rulesOf(doc).filter(r => r.archetype === 'pawn');
  assert.ok(pawns.some(r => !r.components) && pawns.some(r => r.components?.turns?.side === 'enemy'), JSON.stringify(pawns));
  assert.ok(preflight(doc, registry, logic).ok);
});
