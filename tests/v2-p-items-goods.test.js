// gameplay.inventory, gameplay.item.use, gameplay.equipment, gameplay.crafting,
// gameplay.container, gameplay.loot, gameplay.economy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { doc as base, make, steps, checkWith, codes, gameInstances } from './v2-p-items-fixtures.js';

// Item effects heal and gain, so every document here runs the real combat owners.
const doc = (over, ...rest) => base({ combat: true, ...over }, ...rest);

const bagOf = (rt, who = 'player') => rt.state.prim['gameplay.inventory'][who] || {};
const hero = { id: 'hero', kind: 'player', components: { body: { size: [1, 1, 1] }, health: { max: 10, start: 1 }, equipment: { slots: ['weapon', 'head', 'charm'] } } };
const ITEMS = [
  { id: 'apple', name: 'Apple', kind: 'food', stack: 4, value: 3, tags: ['fruit'], ingredient: { tags: ['fruit'], effects: { heal: 2 } }, use: { fx: [{ do: 'heal', who: 'player', amount: 1 }], cooldown: 0.5 } },
  { id: 'meat', name: 'Meat', kind: 'food', value: 5, ingredient: { tags: ['meat'], effects: { heal: 4, stamina: 1 } } },
  { id: 'stew', name: 'Stew', kind: 'food', value: 20, use: { fx: [{ do: 'set_flag', flag: 'ate_stew' }] } },
  { id: 'mush', name: 'Dubious food', kind: 'food', value: 1 },
  { id: 'sword', name: 'Sword', kind: 'weapon', value: 50, stats: { attack: 5 }, weapon: { damage: 5, durability: 3 } },
  { id: 'axe', name: 'Axe', kind: 'tool', value: 30, tool: { kind: 'axe', tier: 1, durability: 2 }, weapon: { damage: 3 } },
  { id: 'helm', name: 'Helm', kind: 'armor', value: 40, armor: { slot: 'head', def: { phys: 2 } } },
  { id: 'c_fast', name: 'Swift charm', kind: 'charm', charm: { cost: 2, mods: { 'stat.speed': 1 } } },
  { id: 'c_strong', name: 'Strong charm', kind: 'charm', charm: { cost: 2, mods: { attack: 2 } } },
  { id: 'notch', name: 'Notch', kind: 'misc', use: { fx: [{ do: 'add_var', var: 'budget.notches', value: 1 }] } },
  { id: 'gold', name: 'Gold coin', kind: 'currency', value: 1 },
  { id: 'pouch', name: 'Coin pouch', kind: 'currency', value: 10 },
  { id: 'key', name: 'Key', kind: 'key' },
  { id: 'gem', name: 'Gem', kind: 'material', value: 100, tags: ['gem'] },
  { id: 'ore', name: 'Ore', kind: 'material', value: 4 },
  { id: 'ingot', name: 'Ingot', kind: 'material', value: 12 },
];

// ---------- inventory ----------
test('inventory: stacks, slot limits, per-entity bags, typed events and transfer', () => {
  const d = doc({ systems: [{ use: 'gameplay.inventory', with: { slots: 2, start: [{ item: 'apple', count: 3 }] } }], content: { items: ITEMS, archetypes: [hero, { id: 'npc', components: { inventory: { slots: 1, start: [{ item: 'gem', count: 2 }] } } }] } });
  assert.ok(checkWith(d).ok);
  const { rt } = make(d);
  rt.run([{ do: 'give_item', item: 'apple', count: 7 }]);      // stack 4: 3+7 = 10 needs 3 stacks; only 2 slots
  assert.equal(bagOf(rt).apple, 8);
  assert.equal(rt.state.counts.inventory_full, 1);
  assert.equal(rt.state.counts['item_gained:apple'], 1);
  assert.equal(rt.service('inventory').stacks(), 2);
  rt.spawn('npc', { id: 'trader' });
  assert.equal(bagOf(rt, 'trader').gem, 2, 'spawned entity seeded its own bag');
  rt.run([{ do: 'take_item', item: 'apple', count: 5 }]);
  rt.run([{ do: 'transfer_item', item: 'gem', count: 1, from: 'trader', to: 'player' }]);
  assert.equal(bagOf(rt).gem, 1); assert.equal(bagOf(rt, 'trader').gem, 1);
  assert.ok(rt.test({ item: 'apple', eq: 3 }));
  assert.ok(rt.test({ item_tag: 'fruit', gte: 3 }));
  assert.ok(rt.test({ item: 'gem', who: 'trader' }));
  assert.equal(rt.state.counts['item_lost:apple'], 1);
  const bad = doc({ systems: [{ use: 'gameplay.inventory', with: { slots: 0, start: [{ item: 'ghost' }] } }], content: { items: [{ id: 'x', name: 'X', stack: 0 }], archetypes: [hero, { id: 'n', components: { inventory: { start: [{ item: 'nope' }] } } }] } });
  const c = codes(checkWith(bad));
  for (const code of ['param_range', 'ref_unknown', 'item_invalid']) assert.ok(c.includes(code), code);
  for (const x of gameInstances('gameplay.inventory')) assert.deepEqual(x.paramErrors, [], x.game);
});

// ---------- item.use + equipment ----------
const kit = () => doc({
  systems: [{ use: 'gameplay.inventory', with: { start: [{ item: 'sword' }, { item: 'helm' }, { item: 'apple', count: 3 }, { item: 'c_fast' }, { item: 'c_strong' }, { item: 'notch' }, { item: 'axe' }] } },
    { use: 'gameplay.item.use' },
    { use: 'gameplay.equipment', with: { slots: [{ id: 'weapon', accepts: ['weapon', 'tool'] }, { id: 'head', accepts: ['armor:head'] }, { id: 'charm', accepts: ['charm'], max: 4 }], budget: { pool: 'notches', total: 3, slots: ['charm'] }, durability: true, wear: [{ event: 'tool_used' }, { event: 'damaged', slots: ['head'] }] } }],
  content: { items: ITEMS, archetypes: [hero] },
}, []);

test('item.use: effects, cooldowns, consumption and denial reasons', () => {
  const { rt } = make(kit());
  rt.step({ actions: { use_item: 'apple' } });
  assert.equal(rt.player().components.health.hp, 2); assert.equal(rt.state.vars.hp, 2); assert.equal(bagOf(rt).apple, 2);
  assert.equal(rt.state.counts['used_item:apple'], 1);
  rt.step({ actions: { use_item: 'apple' } });
  assert.equal(rt.state.events.find(e => e.name === 'use_denied').reason, 'cooldown');
  steps(rt, 30); rt.step({ actions: { use_item: 'apple' } });
  assert.equal(bagOf(rt).apple, 1);
  rt.step({ actions: { use_item: 'stew' } });
  assert.equal(rt.state.events.find(e => e.name === 'use_denied').reason, 'missing');
  rt.step({ actions: { use_item: 'sword' } });
  assert.equal(rt.state.events.find(e => e.name === 'use_denied').reason, 'unusable');
  assert.ok(rt.availableOptions().some(o => o.actions.use_item === 'notch'));
  const bad = kit(); bad.content.items[0].use.cooldown = -1; bad.content.items[2].use.fx.push({ do: 'teleport_home' }); bad.systems[1].with = { cooldown: 'soon' };
  const c = codes(checkWith(bad));
  for (const code of ['item_invalid', 'effect_unknown', 'param_type']) assert.ok(c.includes(code), code);
  for (const x of gameInstances('gameplay.item.use')) assert.deepEqual(x.paramErrors, [], x.game);
});

test('equipment: auto-equip, stat vars, charm budget, durability and breakage', () => {
  const { rt } = make(kit());
  rt.step();
  assert.ok(rt.test({ equipped: 'sword' }), 'starting weapon auto-equipped');
  assert.ok(rt.test({ equipped: 'helm', slot: 'head' }));
  assert.equal(rt.state.vars['stat.attack'], 5); assert.equal(rt.state.vars['stat.def.phys'], 2);
  rt.step({ actions: { equip: 'c_fast' } });
  assert.equal(rt.state.vars['stat.speed'], 1);
  rt.step({ actions: { equip: 'c_strong' } });
  assert.equal(rt.state.events.find(e => e.name === 'equip_denied').reason, 'budget', '2 + 2 notches > 3');
  rt.step({ actions: { use_item: 'notch' } });
  rt.step({ actions: { equip: 'c_strong' } });
  assert.equal(rt.state.vars['stat.attack'], 7);
  assert.deepEqual(rt.service('equipment').budget(), { pool: 'notches', used: 4, total: 4 });
  // Other writers of stat vars are preserved: mods apply as deltas.
  rt.state.vars['stat.attack'] += 10;
  rt.step({ actions: { unequip: 'c_strong' } });
  assert.equal(rt.state.vars['stat.attack'], 15);
  // Swap the weapon slot to the axe and wear it out through tool_used events.
  rt.step({ actions: { equip: 'axe' } });
  assert.ok(rt.test({ equipped: 'axe' })); assert.ok(!rt.test({ equipped: 'sword' }));
  rt.emit('tool_used', { who: 'player', item: 'axe' });
  rt.emit('tool_used', { who: 'player', item: 'axe' });
  assert.equal(rt.state.counts['broke:axe'], 1);
  assert.equal(bagOf(rt).axe, undefined, 'broken tool removed');
  assert.ok(!rt.test({ equipped: 'axe' }));
  // Armor wears from damaged events through the slot rule; repair restores.
  rt.emit('damaged', { who: 'player', amount: 1 });
  assert.equal(rt.service('equipment').durability('player', 'helm'), null, 'helm has no durability');
  rt.step({ actions: { equip: 'sword' } });
  rt.run([{ do: 'wear', item: 'sword', amount: 2 }]);
  assert.equal(rt.service('equipment').durability('player', 'sword'), 1);
  rt.run([{ do: 'repair', item: 'sword' }]);
  assert.equal(rt.service('equipment').durability('player', 'sword'), 3);
  // Losing the item unequips it.
  rt.run([{ do: 'take_item', item: 'sword' }]);
  assert.ok(!rt.test({ equipped: 'sword' }));
  assert.equal(rt.state.vars['stat.attack'], 10);
});

test('equipment: replay, bad config codes and game instances', () => {
  const play = () => { const { rt } = make(kit()); const acts = ['c_fast', 'c_strong', 'axe', 'sword']; for (let i = 0; i < 24; i++) rt.step({ actions: i % 2 ? { equip: acts[i % 4] } : { unequip: 'charm' } }); return rt.snapshot(); };
  assert.deepEqual(play(), play());
  const bad = kit();
  bad.systems[2].with.slots.push({ id: 'weapon', max: 0 });
  bad.systems[2].with.budget.slots = ['ring'];
  bad.content.archetypes[0].components.equipment.slots.push('tail');
  const c = codes(checkWith(bad));
  for (const code of ['id_duplicate', 'param_range', 'equipment_invalid']) assert.ok(c.includes(code), code);
  for (const x of gameInstances('gameplay.equipment')) assert.deepEqual(x.paramErrors, [], x.game);
});

// ---------- crafting ----------
const kitchen = (discover = 'learned') => doc({ resources: [{ id: 'stamina', max: 10, startFull: false, start: 0 }],
  systems: [{ use: 'gameplay.inventory', with: { start: [{ item: 'apple', count: 4 }, { item: 'meat', count: 2 }, { item: 'ore', count: 5 }] } }, { use: 'gameplay.item.use' },
    { use: 'gameplay.crafting', with: { stations: [{ id: 'fire', name: 'Campfire', tags: ['cook'] }, { id: 'forge', name: 'Forge', tags: ['smith'], zone: 'field' }], handCraft: false, queue: true, merge: { enabled: false, stat: 'effects' }, discover, failItem: 'mush' } }],
  content: { items: ITEMS, archetypes: [hero, { id: 'campfire', kind: 'prop', components: { station: 'fire' } }],
    recipes: [
      { id: 'r_stew', station: 'cook', inputs: [{ tag: 'meat', count: 1 }, { tag: 'fruit', count: 1 }], output: { item: 'stew', count: 1 }, time: 0.5, learned: true, merge: true },
      { id: 'r_ingot', station: 'forge', inputs: [{ item: 'ore', count: 2 }], output: { item: 'ingot', count: 1 }, learned: 'smithing' },
      { id: 'r_secret', station: 'fire', inputs: [{ item: 'apple', count: 2 }], output: { item: 'gem', count: 1 } },
    ] },
});

test('crafting: stations, timed queues, merged effects, learning and experiments', () => {
  assert.ok(checkWith(kitchen()).ok, JSON.stringify(checkWith(kitchen()).errors));
  const { rt } = make(kitchen('experiment'));
  rt.step({ actions: { craft: 'r_stew' } });
  assert.equal(rt.state.events.find(e => e.name === 'craft_failed').reason, 'station');
  rt.spawn('campfire', { at: [2, 1, 0] });
  rt.step({ actions: { craft: { recipe: 'r_stew', count: 2 } } });
  assert.equal(rt.state.counts.craft_started, 1);
  assert.equal(bagOf(rt).meat, undefined); assert.equal(bagOf(rt).apple, 2);
  assert.ok(rt.test({ crafting: true, gte: 1 }));
  steps(rt, 60);
  assert.equal(bagOf(rt).stew, 2); assert.equal(rt.state.counts['crafted:r_stew'], 1);
  // The stew carries meat (heal 4, stamina 1) + apple (heal 2): eating it applies them.
  rt.step({ actions: { use_item: 'stew' } });
  assert.equal(rt.state.flags.ate_stew, true);
  assert.equal(rt.player().components.health.hp, 7, '1 + heal 6 from the ingredients');
  assert.equal(rt.state.vars['res.stamina'], 1, 'stamina went through the resource pool');
  // Learned via flag; forge by zone.
  rt.space('world').setPos(rt.player(), [10, 1, 0], rt); rt.step();
  rt.step({ actions: { craft: 'r_ingot' } });
  assert.equal(rt.state.events.find(e => e.name === 'craft_failed').reason, 'unknown');
  rt.state.flags.smithing = true;
  rt.step({ actions: { craft: { recipe: 'r_ingot', count: 2 } } });
  assert.equal(bagOf(rt).ingot, 2);
  assert.ok(rt.test({ knows: 'r_ingot' }));
  // Experiment: two apples at the fire discover the secret; nonsense yields mush.
  rt.space('world').setPos(rt.player(), [1, 1, 0], rt);
  assert.ok(!rt.test({ knows: 'r_secret' }));
  rt.step({ actions: { combine: [{ item: 'apple', count: 2 }] } });
  assert.ok(rt.test({ knows: 'r_secret' })); assert.equal(bagOf(rt).gem, 1);
  assert.equal(rt.state.counts['recipe_learned:r_secret'], 1);
  rt.step({ actions: { combine: ['ore'] } });
  assert.equal(bagOf(rt).mush, 1); assert.equal(bagOf(rt).ore, undefined);
  const opts = make(kitchen()).rt.availableOptions();
  assert.ok(Array.isArray(opts));
});

test('crafting: replay, bad config codes and game instances', () => {
  const play = () => { const { rt } = make(kitchen()); rt.spawn('campfire', { at: [2, 1, 0] }); for (let i = 0; i < 80; i++) rt.step({ actions: i % 20 === 0 ? { craft: 'r_stew' } : {} }); return rt.snapshot(); };
  assert.deepEqual(play(), play());
  const bad = kitchen();
  bad.content.recipes[0].station = 'altar';
  bad.content.recipes[1].inputs.push({ item: 'unobtainium' }, { count: 2 });
  bad.content.recipes[2].output.item = 'nothing';
  bad.systems[2].with.discover = 'osmosis';
  const c = codes(checkWith(bad));
  for (const code of ['recipe_invalid', 'ref_unknown', 'param_option']) assert.ok(c.includes(code), code);
  for (const x of gameInstances('gameplay.crafting')) assert.deepEqual(x.paramErrors, [], x.game);
});

// ---------- loot + container ----------
const dungeon = () => doc({
  systems: [{ use: 'gameplay.inventory' }, { use: 'gameplay.interact' }, { use: 'gameplay.loot', with: { dropTo: 'world', magnet: 3, magnetSpeed: 20, scatter: 0 } }, { use: 'gameplay.container' }],
  content: { items: ITEMS, archetypes: [hero,
    { id: 'slime', kind: 'enemy', components: { body: { size: [1, 1, 1] }, loot: 'slime_drop' } },
    { id: 'chest', kind: 'prop', components: { body: { size: [1, 1, 1] }, interact: { prompt: 'Open' }, container: { slots: 4, items: [{ item: 'gold', count: 5 }], table: 'chest' }, lock: 'key' } },
    { id: 'bush', kind: 'prop', components: { body: { size: [1, 1, 1] }, interact: { prompt: 'Gather' }, container: { slots: 2, table: 'forage', autoTake: true, respawnDays: 2 } } }],
    tables: [
      { id: 'slime_drop', rolls: 1, chance: 0.1, pity: 4, entries: [{ item: 'gem', weight: 1 }] },
      { id: 'chest', rolls: [2, 2], unique: true, entries: [{ item: 'ore', weight: 1, count: [1, 3] }, { item: 'apple', weight: 1 }, { item: 'helm', weight: 1, when: { flag: 'lucky' } }] },
      { id: 'forage', rolls: 1, always: [{ item: 'apple', count: 1 }], entries: [{ table: 'chest', weight: 1 }, { item: null, weight: 1 }] },
    ] },
});

test('loot: weighted tables, when predicates, pity meter, world drops with magnet', () => {
  assert.ok(checkWith(dungeon()).ok, JSON.stringify(checkWith(dungeon()).errors));
  const { rt } = make(dungeon());
  // The pity meter guarantees a drop within 4 kills even at 10% chance.
  let gems = 0;
  for (let i = 0; i < 4; i++) {
    const s = rt.spawn('slime', { at: [8, 1, 0] });
    rt.emitTyped('defeated', 'slime', { id: s.id, by: 'player' }); rt.despawn(s.id);
    gems += Object.values(rt.state.entities).filter(e => e.components.pickup?.item === 'gem').length;
  }
  assert.ok(gems >= 1, 'pity guaranteed a drop');
  assert.equal(rt.state.counts['loot_dropped:slime_drop'], 4);
  // World pickups drift to the player and are collected.
  rt.space('world').setPos(rt.player(), [6, 1, 0], rt);
  steps(rt, 30);
  assert.ok(bagOf(rt).gem >= 1); assert.ok(rt.state.counts['picked_up:gem'] >= 1);
  // drop_loot into the bag; `when` gates entries.
  for (let i = 0; i < 20; i++) rt.run([{ do: 'drop_loot', table: 'chest' }]);
  assert.equal(bagOf(rt).helm, undefined, 'helm needs the lucky flag');
  rt.state.flags.lucky = true;
  for (let i = 0; i < 20; i++) rt.run([{ do: 'drop_loot', table: 'chest' }]);
  assert.ok(bagOf(rt).helm >= 1);
});

test('container: key locks, fill from items and tables, take/store, auto-take and refill', () => {
  const { rt } = make(dungeon());
  rt.spawn('chest', { id: 'chest1', at: [2, 1, 0] });
  rt.step({ actions: { interact: 'chest1' } });
  assert.equal(rt.state.counts.container_locked, 1);
  rt.run([{ do: 'give_item', item: 'key' }]);
  rt.step({ actions: { interact: 'chest1' } });
  assert.equal(rt.service('container').open().id, 'chest1');
  assert.equal(rt.service('container').open().items.gold, 5);
  assert.equal(Object.keys(rt.service('container').open().items).length, 3, 'gold + two unique table rolls');
  rt.step({ actions: { take: { item: 'gold', count: 2 } } });
  assert.equal(bagOf(rt).gold, 2);
  rt.step({ actions: { store: 'key' } });
  assert.equal(bagOf(rt, 'chest1').key, 1);
  assert.ok(rt.availableOptions().some(o => o.actions.take_all));
  rt.step({ actions: { take_all: true } });
  assert.deepEqual(rt.service('container').open().items, {});
  rt.space('world').setPos(rt.player(), [20, 1, 0], rt); rt.step();
  assert.equal(rt.service('container').open(), null, 'walked away: closed');
  // Forage: auto-take, then refills only after two days.
  rt.spawn('bush', { id: 'bush1', at: [21, 1, 0] });
  const before = bagOf(rt).apple ?? 0;
  rt.step({ actions: { interact: 'bush1' } });
  assert.ok(bagOf(rt).apple > before);
  const after = bagOf(rt).apple;
  rt.step({ actions: { interact: 'bush1' } });
  assert.equal(bagOf(rt).apple, after, 'empty until it regrows');
  rt.state.vars['time.day'] = 2;
  rt.step({ actions: { interact: 'bush1' } });
  assert.ok(bagOf(rt).apple > after);
});

test('loot/container: replay, bad config codes and game instances', () => {
  const play = () => { const { rt } = make(dungeon()); rt.spawn('chest', { id: 'c', at: [2, 1, 0] }); rt.run([{ do: 'give_item', item: 'key' }]); for (let i = 0; i < 10; i++) { const s = rt.spawn('slime', { at: [3, 1, 0] }); rt.emit('died', { id: s.id }); rt.step({ actions: { interact: 'c', take_all: true } }); } return rt.snapshot(); };
  assert.deepEqual(play(), play());
  const bad = dungeon();
  bad.content.tables[0].chance = 2; bad.content.tables[0].pity = 0;
  bad.content.tables[1].entries.push({ item: 'dragon', weight: -1 }, { table: 'nowhere' });
  bad.content.tables[2].rolls = [3, 1];
  bad.content.archetypes[1].components.loot = 'missing_table';
  bad.content.archetypes[2].components.container.slots = 0;
  bad.content.archetypes[2].components.lock = 'skeleton_key';
  bad.systems[2].with.dropTo = 'void';
  const c = codes(checkWith(bad));
  for (const code of ['table_invalid', 'ref_unknown', 'container_invalid', 'param_option']) assert.ok(c.includes(code), code);
  for (const use of ['gameplay.loot', 'gameplay.container']) for (const x of gameInstances(use)) assert.deepEqual(x.paramErrors, [], `${use} ${x.game}`);
});

// ---------- economy ----------
const market = () => doc({
  systems: [{ use: 'gameplay.inventory', with: { start: [{ item: 'gold', count: 30 }, { item: 'gem', count: 1 }] } }, { use: 'gameplay.interact' },
    { use: 'gameplay.economy', with: { currencies: [{ id: 'gold', name: 'Gold', items: ['pouch'], perItem: 'value' }], sellRatio: 0.5, haggle: true, haggleChance: 1,
      shops: [{ id: 'smith', owner: 'bram', stock: [{ item: 'sword', count: 1, price: 55 }, { item: 'helm', count: 2, price: 10 }], restock: 'daily', buys: ['gem', 'material'], markup: 1 }, { id: 'stall', stock: [{ item: 'apple', count: 5 }], buys: [] }] } }],
  plot: { characters: [{ id: 'bram', name: 'Bram' }] },
  content: { items: ITEMS, archetypes: [hero, { id: 'smith_npc', kind: 'npc', components: { body: { size: [1, 1, 1] }, interact: { prompt: 'Talk' } } }, { id: 'stall_sign', kind: 'prop', components: { body: { size: [1, 1, 1] }, interact: { prompt: 'Buy' }, shop: 'stall' } }] },
});

test('economy: currency items, buying, selling, haggling, restock and money effects', () => {
  const r = checkWith(market()); assert.ok(r.ok, JSON.stringify(r.errors));
  const { rt } = make(market());
  assert.equal(rt.state.vars['money.gold'], 30, 'starting gold coins converted');
  assert.equal(bagOf(rt).gold, undefined);
  rt.run([{ do: 'give_item', item: 'pouch', count: 2 }]);
  assert.equal(rt.state.vars['money.gold'], 50, 'pouches are worth their value');
  rt.spawn('smith_npc', { id: 'bram', at: [2, 1, 0] });
  rt.step({ actions: { interact: 'bram' } });
  assert.equal(rt.service('shop').open().shop, 'smith', 'talking to the owner opens the shop');
  rt.step({ actions: { buy: 'sword' } });
  assert.equal(rt.state.events.find(e => e.name === 'trade_denied').reason, 'funds');
  rt.step({ actions: { haggle: true } });
  assert.equal(rt.state.events.find(e => e.name === 'haggled').success, true);
  rt.step({ actions: { buy: 'sword' } });
  assert.equal(bagOf(rt).sword, 1); assert.equal(rt.state.vars['money.gold'], 50 - 47, 'price 55 × 0.85');
  rt.step({ actions: { buy: 'sword' } });
  assert.equal(rt.state.events.find(e => e.name === 'trade_denied').reason, 'stock');
  rt.step({ actions: { sell: 'gem' } });
  assert.equal(rt.state.vars['money.gold'], 3 + 50); assert.equal(rt.state.counts['sold:gem'], 1);
  rt.step({ actions: { sell: 'sword' } });
  assert.equal(rt.state.events.find(e => e.name === 'trade_denied').reason, 'refused', 'smith does not buy weapons');
  assert.equal(rt.service('shop').open().stock.find(s => s.item === 'gem').count, 1, 'buyback');
  rt.step({ actions: { close_shop: true } });
  assert.equal(rt.service('shop').open(), null);
  rt.state.vars['time.day'] = 1;
  rt.run([{ do: 'open_shop', shop: 'smith' }]);
  assert.equal(rt.state.counts.restocked, 1);
  assert.equal(rt.service('shop').open().stock.find(s => s.item === 'sword').count, 1);
  assert.ok(rt.availableOptions().some(o => o.actions.close_shop));
  rt.run([{ do: 'take_money', amount: 1000 }]);
  assert.equal(rt.state.counts.insufficient_funds, 2, 'the early failed purchase and this one');
  rt.run([{ do: 'pay', amount: 7, to: 'bram' }, { do: 'give_money', amount: 3, currency: 'gold' }]);
  assert.equal(rt.state.vars['money.gold'], 49);
  // A shop entity opens its shop.
  rt.run([{ do: 'close_shop' }]);
  rt.spawn('stall_sign', { id: 'sign', at: [1, 2, 0] });
  rt.step({ actions: { interact: 'sign' } });
  assert.equal(rt.service('shop').open().shop, 'stall');
});

test('economy: replay, bad config codes and game instances', () => {
  const play = () => { const { rt } = make(market()); rt.run([{ do: 'open_shop', shop: 'smith' }]); for (let i = 0; i < 12; i++) rt.step({ actions: [{ haggle: true }, { buy: 'helm' }, { sell: 'helm' }][i % 3] }); return rt.snapshot(); };
  assert.deepEqual(play(), play());
  const bad = market();
  const e = bad.systems[2].with;
  e.shops[0].currency = 'doubloons'; e.shops[0].owner = 'nobody'; e.shops[1].restock = 'hourly';
  e.currencies.push({ id: 'gold' });
  bad.plot.storyboard = { acts: [{ id: 'a', beats: [{ id: 'b', do: [{ do: 'open_shop', shop: 'bakery' }, { do: 'give_money', amount: -5 }] }] }] };
  bad.systems.push({ use: 'plot.storyboard' });
  const c = codes(checkWith(bad));
  for (const code of ['shop_invalid', 'ref_unknown', 'param_option', 'id_duplicate', 'effect_invalid']) assert.ok(c.includes(code), code);
  for (const x of gameInstances('gameplay.economy')) assert.deepEqual(x.paramErrors, [], x.game);
});
