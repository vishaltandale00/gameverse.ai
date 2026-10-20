// graphics.ui.inventory and the HUD against the real item primitives (inventory,
// equipment, economy, crafting): equip, craft, buy and sell through view.act.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, run, testSpace } from '../v2/kernel/testing.js';
import { PRIMITIVES } from '../v2/primitives/index.js';
import { mount } from './v2-p-ui-dom.js';
import { fx } from './v2-p-ui-fixtures.js';

const P = [...PRIMITIVES, testSpace, fx];
const doc = () => ({
  schema: 'gameverse.v2.game/0.2', id: 'ui-items', title: 'Shopkeeping', seed: 2,
  spaces: [{ id: 'w', use: 'engine.space.test', with: { size: [10, 10, 1] }, zones: [{ id: 'town', rect: [0, 0, 10, 10] }] }],
  plot: { characters: [{ id: 'mara', name: 'Mara', archetype: 'npc', at: [3, 1, 0] }] },
  content: {
    items: [{ id: 'sword', name: 'Iron Sword', kind: 'weapon', weapon: { damage: 6 }, value: 30 }, { id: 'herb', name: 'Herb', kind: 'material', value: 2 }, { id: 'potion', name: 'Red Potion', kind: 'potion', value: 10 }],
    recipes: [{ id: 'r_potion', inputs: [{ item: 'herb', count: 2 }], output: { item: 'potion', count: 1 } }],
    archetypes: [{ id: 'hero', kind: 'player', components: { health: { max: 10 } } }, { id: 'npc', kind: 'npc', components: {} }],
  },
  player: { archetype: 'hero', space: 'w', at: [1, 1, 0] },
  systems: [{ use: 'gameplay.fixture.fx' }, { use: 'plot.character' },
    { use: 'gameplay.inventory', with: { start: [{ item: 'sword', count: 1 }, { item: 'herb', count: 5 }] } },
    { use: 'gameplay.equipment', with: { slots: [{ id: 'weapon', accepts: ['weapon'], max: 1 }] } },
    { use: 'gameplay.crafting', with: { handCraft: true } },
    { use: 'gameplay.economy', with: { currencies: [{ id: 'gold', name: 'Gold', var: 'money.gold' }], shops: [{ id: 'stall', owner: 'mara', stock: [{ item: 'potion', count: 3, price: 12 }] }] } }],
  graphics: [{ use: 'graphics.ui.inventory', with: { panels: ['items', 'equipment', 'crafting', 'shop'] } }, { use: 'graphics.ui.hud', with: { counters: [{ var: 'money.gold', icon: 'coin' }] } }],
});

test('ui + items: equip, craft and trade against the real primitives', () => {
  const m = mount(doc(), { primitives: P });
  m.frame(1, { actions: { fx: [{ do: 'give_money', amount: 30, currency: 'gold' }] } }); m.frame(1);
  assert.equal(m.text('.gv-counter-value'), '30');
  m.key('i'); m.frame(1);
  assert.match(m.text('.gv-detail'), /Iron Sword/);
  assert.ok(m.rt.test({ equipped: 'sword' }), 'auto-equipped by gameplay.equipment');
  assert.match(m.text('.gv-detail .gv-actions'), /Unequip/);
  m.key('Enter'); m.frame(2);
  assert.equal(m.rt.test({ equipped: 'sword' }), false, 'unequipped through the real primitive');
  assert.match(m.text('.gv-detail .gv-actions'), /Equip/);
  m.key('Enter'); m.frame(2);
  assert.ok(m.rt.test({ equipped: 'sword' }), 'equipped again');
  assert.ok(m.q('.gv-slot.is-equipped'));
  m.key('r'); m.frame(1); // equipment doll
  assert.match(m.text('.gv-detail'), /Iron Sword[\s\S]*Slot: Weapon/);
  m.key('r'); m.frame(1); // crafting
  assert.match(m.text('.gv-rows'), /Red Potion[\s\S]*5\/2 Herb/);
  m.key('Enter'); m.frame(3);
  assert.ok(m.rt.state.counts['crafted:r_potion'] >= 1 || (m.rt.service('inventory').bag('player').potion || 0) >= 1, 'crafted (instant or queued)');
  m.key('Escape'); m.frame(1);
  // Open the stall: the shop panel opens itself; buy one potion.
  m.frame(1, { actions: { fx: [{ do: 'open_shop', shop: 'stall' }] } }); m.frame(1);
  assert.equal(m.view.modal, 'inventory');
  assert.match(m.text('.gv-rows'), /Buy[\s\S]*Red Potion/);
  const before = m.rt.service('inventory').bag('player').potion || 0;
  m.key('Enter'); m.frame(2);
  assert.equal(m.rt.service('inventory').bag('player').potion, before + 1);
  assert.equal(m.rt.state.vars['money.gold'], 18);
  m.key('Escape'); m.frame(2);
  assert.equal(m.rt.service('shop').open('player'), null, 'closing the sheet closes the shop');
});

test('ui + items: browser run equals headless run', () => {
  const a = mount(doc(), { primitives: P }); a.frame(3); a.key('i'); a.frame(2); a.key('Escape'); a.frame(2);
  const { rt } = compile(doc(), { primitives: P }); run(rt, 5);
  assert.deepEqual(a.rt.snapshot(), rt.snapshot());
});
