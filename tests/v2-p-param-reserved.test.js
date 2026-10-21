// A string param may declare reserved values: validation rejects them by name and the model's strict form says so.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalogue } from '../v2/planner/catalog.js';
import { preflight } from '../v2/kernel/document.js';

test("turns rejects a reserved action id ('move') with a param_reserved error naming the reserved ids", async () => {
  const { registry, logic } = await loadCatalogue();
  const doc = { schema: 'gameverse.v2.game/0.2', id: 't', title: 't', seed: 1, spaces: [{ id: 'board', use: 'engine.space.grid', with: { size: [8, 8] } }],
    systems: [{ use: 'gameplay.combat.health' }, { use: 'gameplay.turns', with: { sides: [{ id: 'player', control: 'player', members: ['player'] }], actions: [{ id: 'move', range: 1 }] } }],
    content: { archetypes: [{ id: 'hero', components: { health: { max: 5 } } }] }, player: { archetype: 'hero', at: [1, 1] } };
  const r = preflight(doc, registry, logic);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.code === 'param_reserved' && /move, overwatch, pass/.test(e.message)), JSON.stringify(r.errors));
});
