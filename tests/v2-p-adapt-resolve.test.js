// planner/adapters.js resolveAdapters: (d) an incompatible-needs-adapter verdict becomes compatible-via-adapter
// through registered adapters chosen from their card.adapts declarations; with none fitting, the gap is the
// adapter signature. The resolved document preflights and runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogue } from '../v2/primitives/index.js';
import { preflight } from '../v2/kernel/document.js';
import { createWorld } from '../v2/kernel/world.js';
import { checkComposition } from '../v2/planner/compose-check.js';
import { resolveAdapters, adaptersFor } from '../v2/planner/adapters.js';

const { registry, logic } = catalogue();
const world = { id: 'world', use: 'engine.space.tilemap', with: { size: [20, 12], mode: 'topdown' } };

test('(d) a turn board on a tile overworld: needs-adapter becomes compatible-via-adapter with a projected grid', () => {
  const selection = { spaces: [world], systems: ['gameplay.turns', 'gameplay.combat.health'] };
  const r = resolveAdapters(selection, registry);
  assert.equal(r.before.verdict, 'incompatible-needs-adapter', r.before.reason);
  assert.ok(r.before.failures.some(f => f.need?.kind === 'capabilities' && f.need.item === 'occupancy'));
  assert.equal(r.verdict, 'compatible-via-adapter', r.result.reason);
  assert.deepEqual(r.gaps, []);
  assert.equal(r.adapters.length, 1);
  const [a] = r.adapters;
  assert.equal(a.use, 'engine.adapt.projection');
  assert.equal(a.space, 'world');
  assert.equal(a.with.kind, 'engine.space.grid', 'the kind the mode names (turns plays on a grid)');
  assert.deepEqual(r.bind, { 'gameplay.turns': a.id });
  // The resolved selection checks on its own: the region carries the grid capabilities, the host is unchanged.
  const again = checkComposition(r.composition, registry);
  assert.equal(again.verdict, 'compatible-via-adapter', again.reason);
  assert.deepEqual(again.adapters, ['engine.adapt.projection']);
});

test('(d) a race on a tile overworld gets a projected track', () => {
  const r = resolveAdapters({ spaces: [world], systems: ['gameplay.race'] }, registry);
  assert.equal(r.verdict, 'compatible-via-adapter', r.result.reason);
  assert.equal(r.adapters[0].with.kind, 'engine.space.track');
  assert.ok(r.adapters[0].with.path.length >= 2, 'a track region gets a host path');
  assert.equal(r.bind['gameplay.race'], r.adapters[0].id);
});

test('(d) a resolved document preflights and runs with its pieces on the region', () => {
  const won = [{ do: 'end_game', outcome: 'won' }], lost = [{ do: 'end_game', outcome: 'lost' }];
  const map = { ...world, zones: [{ id: 'map', rect: [0, 0, 20, 12] }], generators: [{ use: 'engine.generate.tilemap.rooms', with: { mode: 'topdown', rooms: [{ id: 'hall', zone: 'map', rect: [0, 0, 20, 12] }] } }] };
  const doc = { schema: 'gameverse.v2.game/0.2', id: 'resolved', title: 'Resolved', seed: 1, spaces: [map],
    systems: [{ use: 'gameplay.combat.health' }, { use: 'gameplay.turns', with: { grain: 'unit', ap: 1, movePerAp: 1, overwatch: false, sides: [{ id: 'white', control: 'player', members: ['player'] }, { id: 'black', control: 'ai', members: ['rook'] }], onVictory: won, onDefeat: lost } }],
    content: { archetypes: [{ id: 'knight', components: { health: { max: 1 }, turns: { side: 'white' } } }, { id: 'rook', components: { health: { max: 1 }, turns: { side: 'black' } } }] } };
  const r = resolveAdapters(doc, registry);
  assert.equal(r.verdict, 'compatible-via-adapter', r.result.reason);
  const region = r.adapters[0].id;
  const resolved = /** the outline/preset stage places the pieces on the region */ { ...r.composition, player: { archetype: 'knight', space: region, at: [1, 1] },
    systems: [...r.composition.systems, { use: 'engine.spawner', with: { intervalSec: 0, rules: [{ id: 'r1', archetype: 'rook', space: region, at: [5, 5], unique: true, activation: 'always', respawnSec: 0 }] } }] };
  assert.equal(resolved.systems.find(s => s.use === 'gameplay.turns').space, region, 'the turn loop is re-bound to the region');
  const pf = preflight(resolved, registry, logic);
  assert.ok(pf.ok, JSON.stringify(pf.errors));
  assert.ok(pf.capabilities[region].includes('occupancy'));
  const rt = createWorld(pf.doc, registry, logic, { seed: 1 });
  rt.step({}); rt.step({});
  rt.step({ actions: { turn_move: { unit: 'player', to: [1, 2] } } });
  assert.deepEqual(rt.player().at, [1, 2]);
  assert.equal(rt.player().space, region);
});

test('(d) with no adapter fitting, the gap is the adapter signature', () => {
  const r = resolveAdapters({ space: { use: 'engine.space.none' }, primitives: ['gameplay.move.platformer'] }, registry);
  assert.equal(r.verdict, 'incompatible-needs-adapter');
  assert.deepEqual(r.adapters, []);
  assert.equal(r.gaps.length, 1);
  assert.deepEqual(r.gaps[0].card.adapts.provides.capabilities, ['gravity', 'position']);
  assert.deepEqual(r.gaps[0].card.adapts.from.spaces, ['engine.space.none']);
  // A composition that needs nothing is returned untouched.
  const fine = resolveAdapters({ spaces: [{ id: 'g', use: 'engine.space.grid' }], systems: ['gameplay.turns'] }, registry);
  assert.notEqual(fine.verdict, 'incompatible-needs-adapter');
  assert.deepEqual(fine.adapters, []);
});

test('(d) adapters are found by the mashup relation they declare', () => {
  assert.deepEqual(adaptersFor(registry, 'union'), ['engine.adapt.projection']);
  assert.deepEqual(adaptersFor(registry, 'nested'), ['engine.adapt.nested']);
  assert.deepEqual(adaptersFor(registry, 'skin'), ['engine.adapt.skin']);
});
