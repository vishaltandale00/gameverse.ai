// engine.adapt.skin: (e) one concept's content fills another concept's content contract. Species become the
// pieces of a turn board (the turns contract wants archetypes with a turns component, placed), applied with
// planner/adapters.js applySkins, then run headless through the real runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogue } from '../v2/primitives/index.js';
import { preflight } from '../v2/kernel/document.js';
import { createWorld } from '../v2/kernel/world.js';
import { populateProblems } from '../v2/planner/content.js';
import { applySkins } from '../v2/planner/adapters.js';
import { skin } from '../v2/primitives/engine/adapt-skin.js';

const { registry, logic } = catalogue();
const won = [{ do: 'end_game', outcome: 'won' }], lost = [{ do: 'end_game', outcome: 'lost' }];
const rule = (id, archetype, at) => ({ id, archetype, at, space: 'board', unique: true, activation: 'always', respawnSec: 0 });
const doc = (maps) => ({
  schema: 'gameverse.v2.game/0.2', id: 'species-chess', title: 'Species chess', seed: 4,
  spaces: [{ id: 'board', use: 'engine.space.grid', with: { size: [6, 6] } }],
  systems: [
    { use: 'gameplay.combat.health' },
    { use: 'gameplay.turns', with: { grain: 'unit', ap: 1, movePerAp: 1, overwatch: false, sides: [{ id: 'white', control: 'player', members: ['player'] }, { id: 'black', control: 'ai' }], onVictory: won, onDefeat: lost } },
    { use: 'engine.adapt.skin', with: { maps } },
    { use: 'engine.spawner', with: { intervalSec: 0, rules: [rule('a', 'piece_sprout', [5, 5]), rule('b', 'piece_ember_pup', [4, 5]), rule('c', 'piece_sprout', [3, 5]), rule('d', 'piece_ember_pup', [2, 5])] } },
  ],
  content: {
    species: [{ id: 'sprout', name: 'Sprout', types: ['grass'], model: 'leafy' }, { id: 'ember_pup', name: 'Ember Pup', types: ['fire'], model: 'pup' }],
    archetypes: [{ id: 'knight', components: { health: { max: 3 }, turns: { side: 'white' } } }],
  },
  player: { archetype: 'knight', space: 'board', at: [0, 0] },
});
// Species as black pieces: every species becomes a piece archetype (name and model from the species).
const PIECES = [{ from: 'content.species', to: 'content.archetypes', prefix: 'piece_', fields: { name: 'name', 'components.model': 'model' }, template: { kind: 'npc', components: { health: { max: 1 }, turns: { side: 'black' } } } }];
const turnsContract = problems => problems.filter(p => p.uses.includes('gameplay.turns') && p.path === 'content.archetypes');

test('(e) a skin fills the turns content contract from species', () => {
  const raw = doc(PIECES);
  assert.ok(turnsContract(populateProblems(raw, registry)).some(p => p.code === 'content_missing'), 'without the skin the board has no pieces');
  const skinned = applySkins(raw, registry);
  assert.deepEqual(turnsContract(populateProblems(skinned, registry)), []);
  const pieces = skinned.content.archetypes.filter(a => a.id.startsWith('piece_'));
  assert.deepEqual(pieces.map(a => a.id), ['piece_sprout', 'piece_ember_pup']);
  assert.deepEqual(pieces[1], { id: 'piece_ember_pup', kind: 'npc', name: 'Ember Pup', components: { health: { max: 1 }, turns: { side: 'black' }, model: 'pup', skin: { from: 'content.species', id: 'ember_pup' } } });
  assert.equal(raw.content.archetypes.length, 1, 'applying a skin does not mutate the input');
});

test('(e) the skinned pieces play: they spawn, take turns and carry their source', () => {
  const pf = preflight(applySkins(doc(PIECES), registry), registry, logic);
  assert.ok(pf.ok, JSON.stringify(pf.errors));
  assert.ok(!pf.warnings.some(w => w.code === 'skin_unapplied'));
  const rt = createWorld(pf.doc, registry, logic, { seed: 1 });
  rt.step({}); rt.step({});
  assert.deepEqual(rt.entity('b').components.skin, { from: 'content.species', id: 'ember_pup' });
  assert.deepEqual(rt.service('skin').sourceOf('content.archetypes', 'piece_sprout'), { from: 'content.species', id: 'sprout' });
  assert.deepEqual(rt.service('skin').targetsOf('content.species', 'sprout'), [{ to: 'content.archetypes', id: 'piece_sprout' }]);
  assert.equal(Object.keys(rt.state.prim['gameplay.turns'].units).filter(id => rt.state.prim['gameplay.turns'].units[id].side === 'black').length, 4);
  const before = ['a', 'b', 'c', 'd'].map(id => rt.entity(id).at.join(','));
  rt.step({ actions: { end_turn: true } });
  for (let i = 0; i < 6; i++) rt.step({});
  assert.ok(['a', 'b', 'c', 'd'].some((id, i) => rt.entity(id).at.join(',') !== before[i]), 'a black piece moved');
  const replay = () => { const w = createWorld(pf.doc, registry, logic, { seed: 1 }); w.step({}); w.step({}); w.step({ actions: { end_turn: true } }); for (let i = 0; i < 6; i++) w.step({}); return JSON.stringify(w.snapshot()); };
  assert.equal(replay(), replay());
});

test('(e) explicit pairs, keyed targets and existing fields', () => {
  const d = doc([{ from: 'content.species', to: 'content.archetypes', pairs: [{ from: 'sprout', to: 'knight', with: { name: 'Sprout Knight' } }], fields: { 'components.model': 'model' } }]);
  const out = skin(d, d.systems[2].with);
  const knight = out.content.archetypes.find(a => a.id === 'knight');
  assert.equal(knight.name, 'Sprout Knight');
  assert.deepEqual(knight.components.turns, { side: 'white' }, 'existing target fields win');
  assert.equal(knight.components.model, 'leafy');
  // Id-keyed sections stay id-keyed.
  const keyed = skin({ content: { species: { sprout: { name: 'Sprout' } }, carts: {} } }, { maps: [{ from: 'content.species', to: 'content.carts', fields: { label: 'name' } }] });
  assert.deepEqual(keyed.content.carts, { sprout: { label: 'Sprout' } });
});

test('(e) preflight rejects bad skins with stable codes', () => {
  const codes = maps => preflight(doc(maps), registry, logic).errors.map(e => e.code);
  assert.ok(codes([{ from: 'content.monsters', to: 'content.archetypes' }]).includes('skin_source_empty'));
  assert.ok(codes([{ from: 'content.species', to: 'content.archetypes', pairs: [{ from: 'dragon', to: 'piece_dragon' }] }]).includes('skin_pair_unknown'));
  assert.ok(codes([{ from: 'species', to: 'content.archetypes' }]).includes('skin_section'));
  assert.ok(preflight(doc(PIECES), registry, logic).warnings.some(w => w.code === 'skin_unapplied'), 'an unapplied skin is reported');
});
