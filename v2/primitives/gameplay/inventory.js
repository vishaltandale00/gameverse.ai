// Item inventories for any entity (the player by default).
import { compare } from '../../kernel/logic.js';
export default {
  id: 'gameplay.inventory',
  card: {
    intent: 'Entities carry items with counts and stack limits; provides the `item` predicate and give_item/take_item effects used by quests, gates, crafting, shops and dialogue.',
    views: ['any'],
    params: {
      slots: { type: 'integer', default: 36, min: 1, max: 1000, unit: 'stacks', effect: 'distinct item stacks an entity can hold' },
      start: { type: 'list', default: [], of: { type: 'object', fields: { item: { type: 'ref', to: 'item', required: true }, count: { type: 'integer', default: 1, min: 1, max: 9999 } } }, effect: "player's starting items" },
    },
    provides: { events: ['item_gained', 'item_lost', 'inventory_full'] },
    reads: ['content.items'],
  },
  logic(logic) {
    const bag = (rt, who) => (rt.store('gameplay.inventory')[who || 'player'] ??= {});
    logic.predicate('item', { refs: p => [['item', p.item]], test: (p, rt) => compare(bag(rt, p.who)[p.item] || 0, p) });
    logic.effect('give_item', { refs: e => [['item', e.item]], run: (e, rt) => {
      const b = bag(rt, e.who), max = rt.caches.inventorySlots ?? 36;
      if (!b[e.item] && Object.keys(b).length >= max) { rt.emit('inventory_full', { item: e.item }); return; }
      b[e.item] = (b[e.item] || 0) + (e.count ?? 1); rt.emit('item_gained', { item: e.item, count: e.count ?? 1, who: e.who || 'player' });
    } });
    logic.effect('take_item', { refs: e => [['item', e.item]], run: (e, rt) => {
      const b = bag(rt, e.who), n = Math.min(b[e.item] || 0, e.count ?? 1);
      if (!n) return; b[e.item] -= n; if (!b[e.item]) delete b[e.item];
      rt.emit('item_lost', { item: e.item, count: n, who: e.who || 'player' });
    } });
  },
  install(rt, config) {
    rt.caches.inventorySlots = config.slots;
    const b = (rt.store('gameplay.inventory').player ??= {});
    if (!rt.state.frame) for (const { item, count } of config.start) b[item] = (b[item] || 0) + count;
  },
};
