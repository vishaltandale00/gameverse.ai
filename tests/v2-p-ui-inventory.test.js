import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, run } from '../v2/kernel/testing.js';
import { preflight } from '../v2/kernel/document.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import inv, { inventoryLayout, dollLayout, craftRows, shopRows } from '../v2/primitives/graphics/ui-inventory.js';
import { mount } from './v2-p-ui-dom.js';
import { baseDoc, BASE, gameInstances, ownErrors } from './v2-p-ui-fixtures.js';

const content = {
  items: [
    { id: 'sword', name: 'Iron Sword', kind: 'weapon', weapon: { damage: 6, reach: 1.5, type: 'phys' }, value: 30 },
    { id: 'herb', name: 'Herb', kind: 'material', value: 2, tags: ['plant'] },
    { id: 'potion', name: 'Red Potion', kind: 'potion', use: { fx: [] }, value: 10 },
    { id: 'gold', name: 'Gold', kind: 'currency' },
    { id: 'charm_a', name: 'Swift Charm', kind: 'charm', charm: { cost: 2 } },
  ],
  recipes: [{ id: 'r_potion', inputs: [{ item: 'herb', count: 3 }], output: { item: 'potion', count: 1 } }, { id: 'r_sword', station: 'forge', inputs: [{ item: 'herb', count: 1 }], output: { item: 'sword' } }],
  archetypes: [{ id: 'hero', kind: 'player', components: {} }],
};
// Item-primitive fixtures speaking ws-items' contract: equipment, shop and crafting services plus actions.
const items = {
  id: 'gameplay.fixture.items',
  card: { intent: 'Fixture item services.', provides: { services: ['equipment', 'shop', 'crafting'], actions: ['equip', 'unequip', 'use_item', 'craft', 'buy', 'sell', 'close_shop'] } },
  install(rt) {
    const st = () => rt.store('fixture.items'), peek = () => rt.state.prim['fixture.items'] || {}; // service reads never create state
    const log = (verb, v) => (st().log ??= []).push([verb, v]);
    rt.provide('equipment', { slots: () => [{ id: 'weapon', accepts: ['weapon'], items: peek().weapon ? [peek().weapon] : [] }, { id: 'head', accepts: ['armor:head'], items: [] }, { id: 'charm', accepts: ['charm'], max: 4, items: [] }], budget: () => ({ pool: 'notches', used: 0, total: 3 }) });
    rt.provide('shop', { open: () => (peek().shop ? { shop: 'mart', owner: 'mara', currency: 'gold', stock: [{ item: 'potion', count: 5, price: 12 }, { item: 'sword', count: 1, price: 99 }] } : null) });
    rt.provide('crafting', { station: () => null });
    rt.action('equip', v => { st().weapon = v; log('equip', v); });
    for (const v of ['unequip', 'use_item', 'craft', 'buy', 'sell']) rt.action(v, x => log(v, x));
    rt.action('close_shop', () => { st().shop = false; log('close_shop', true); });
    rt.action('open_mart', () => { st().shop = true; });
  },
};
const P = [...BASE, items, inv];
const econ = { id: 'gameplay.fixture.econ', card: { intent: 'economy config holder', params: { currencies: { type: 'json', default: [] }, sellRatio: { type: 'number', default: 0.5 } } } };
const doc = (w = { panels: ['items', 'equipment', 'crafting', 'loadout', 'shop'] }) => {
  const d = baseDoc({ content, plot: { characters: [{ id: 'mara', name: 'Mara' }] }, systems: [{ use: 'gameplay.inventory', with: { start: [{ item: 'sword', count: 1 }, { item: 'herb', count: 4 }, { item: 'potion', count: 2 }, { item: 'gold', count: 50 }, { item: 'charm_a', count: 1 }] } }, { use: 'gameplay.fixture.items' }], graphics: [{ use: 'graphics.ui.inventory', with: w }] });
  return d;
};

test('inventory layout: sorts by kind then name, hides currency, pads whole rows', () => {
  const { rt } = compile(doc(), { primitives: P });
  const cells = inventoryLayout(rt.state.prim['gameplay.inventory'].player, rt.doc, { columns: 4, slots: 8 });
  assert.deepEqual(cells.map(c => c?.id ?? null), ['sword', 'charm_a', 'potion', 'herb', null, null, null, null]);
  assert.equal(inventoryLayout({}, rt.doc, { columns: 4, slots: 2 }).length, 4);
  const pos = dollLayout([{ id: 'head' }, { id: 'weapon' }, { id: 'odd' }, { id: 'odd2' }]);
  assert.deepEqual(pos.slice(0, 2).map(p => [p.x, p.y]), [[50, 7], [13, 40]]);
  assert.notDeepEqual([pos[2].x, pos[2].y], [pos[3].x, pos[3].y], 'unknown slots get distinct places');
});

test('inventory: crafting rows report have/need, station and craftability', () => {
  const { rt } = compile(doc(), { primitives: P });
  const rows = craftRows(rt);
  assert.deepEqual(rows.map(r => [r.id, r.craftable, r.inputs[0].have, r.inputs[0].need]), [['r_potion', true, 4, 3], ['r_sword', false, 4, 1]]);
  assert.equal(rows[1].atStation, false);
  const s = shopRows(rt, { currency: 'gold', stock: [{ item: 'potion', price: 12, count: 5 }, { item: 'sword', price: 99, count: 1 }] });
  assert.deepEqual(s.buy.map(b => b.afford), [false, false], 'gold item is not money unless an economy publishes money vars');
  run(rt, 1, { actions: { fx: [{ do: 'set_var', var: 'money.gold', value: 50 }] } });
  assert.deepEqual(shopRows(rt, { currency: 'gold', stock: [{ item: 'potion', price: 12 }, { item: 'sword', price: 99 }] }).buy.map(b => b.afford), [true, false]);
  assert.ok(s.sell.every(r => r.item !== 'gold'));
});

test('inventory: grid navigation, equip via view.act, doll and recipes', () => {
  const m = mount(doc(), { primitives: P });
  m.frame(1);
  m.key('i'); m.frame(1);
  assert.equal(m.view.modal, 'inventory');
  assert.equal(m.qa('.gv-grid button.gv-slot').length, 4);
  assert.match(m.text('.gv-detail'), /Iron Sword[\s\S]*Damage6/);
  m.key('Enter'); m.frame(1);
  assert.deepEqual(m.acts.at(-1), { equip: 'sword' });
  m.frame(1);
  assert.ok(m.q('.gv-slot.is-equipped'), 'equipped marker after the item primitive equips');
  m.key('ArrowRight'); m.key('ArrowRight'); m.frame(1);
  assert.match(m.text('.gv-detail'), /Red Potion/);
  m.key('Enter'); assert.deepEqual(m.acts.at(-1), { use_item: 'potion' });
  m.key('r'); m.frame(1); // equipment tab
  assert.ok(m.q('.gv-doll .gv-slot'));
  assert.match(m.text('.gv-detail'), /Iron Sword/);
  m.key('Enter'); assert.deepEqual(m.acts.at(-1), { unequip: 'weapon' });
  m.key('r'); m.frame(1); // crafting
  assert.match(m.text('.gv-rows'), /Red Potion[\s\S]*4\/3 Herb/);
  m.key('Enter'); assert.deepEqual(m.acts.at(-1), { craft: 'r_potion' });
  m.key('r'); m.frame(1); // charms
  assert.equal(m.qa('.gv-notch').length, 3);
  m.key('Enter'); assert.deepEqual(m.acts.at(-1), { equip: { item: 'charm_a', slot: 'charm' } });
  m.key('Escape'); m.frame(1);
  assert.equal(m.view.modal, null);
});

test('inventory: the shop panel opens itself, buys through view.act and closes the shop on exit', () => {
  const m = mount(doc(), { primitives: P });
  m.frame(1, { actions: { fx: [{ do: 'set_var', var: 'money.gold', value: 50 }] } });
  m.frame(1, { actions: { open_mart: true } });
  m.frame(1);
  assert.equal(m.view.modal, 'inventory');
  assert.ok(m.q('.gv-tab.is-active').textContent.includes('Mara'));
  assert.match(m.text('.gv-rows'), /Buy[\s\S]*Red Potion[\s\S]*Sell/);
  m.key('Enter'); assert.deepEqual(m.acts.at(-1), { buy: { item: 'potion', count: 1 } });
  m.key('ArrowDown'); m.key('Enter'); assert.notDeepEqual(m.acts.at(-1), { buy: { item: 'sword', count: 1 } }, 'cannot buy what you cannot afford');
  m.key('Escape'); m.frame(2);
  assert.deepEqual(m.acts.at(-1), { close_shop: true });
  assert.equal(m.rt.state.prim['fixture.items'].shop, false);
});

test('inventory: deterministic, state-neutral, rejects bad configs, accepts game instances', () => {
  const a = mount(doc(), { primitives: P }); a.key('i'); a.frame(3); a.key('Escape'); a.frame(2);
  const { rt } = compile(doc(), { primitives: P }); run(rt, 2);
  assert.deepEqual(a.rt.snapshot(), rt.snapshot());
  const codes = w => { try { compile(doc(w), { primitives: P }); return []; } catch (e) { return e.errors.map(x => x.code); } };
  assert.ok(codes({ panels: ['items', 'items'] }).includes('ui_tab_duplicate'));
  assert.ok(codes({ panels: ['bank'] }).includes('param_option'));
  assert.ok(codes({ columns: 40 }).includes('param_range'));
  const registry = new Registry(P), logic = buildLogic(registry, Logic);
  const list = gameInstances('graphics.ui.inventory');
  assert.ok(list.length >= 3);
  for (const { file, doc: d } of list) assert.deepEqual(ownErrors(preflight(d, registry, logic).errors), [], file);
  void econ;
});
