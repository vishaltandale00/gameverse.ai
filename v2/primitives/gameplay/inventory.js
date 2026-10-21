// Item inventories for any entity (the player by default). A bag is
// state.prim['gameplay.inventory'][who] = { item: count }, so any primitive or
// UI can read it. Items occupy stacks of content.items[].stack (default
// `stackDefault`); `slots` caps the stacks an entity holds (per entity via
// components.inventory.slots). Gains are typed (item_gained:<item>) so counts,
// quests and gates can address one item. Other primitives use the exported
// functions or the `inventory` service; effects give_item/take_item/transfer_item.
import { compare } from '../../kernel/logic.js';
import { item as itemDef, tokens, whoKey } from './items-lib.js';

const KEY = 'gameplay.inventory';
const cfg = rt => rt.caches.inventory || { slots: 36, stackDefault: 999 };
/** Read-only view of a bag (never creates state; UI and options call this every frame). */
const NONE = Object.freeze({});
export const bag = (rt, who = 'player') => rt.state.prim[KEY]?.[who] || NONE;
const mutable = (rt, who) => (rt.store(KEY)[who] ??= {});
export const count = (rt, who, id) => bag(rt, who)[id] || 0;
/** Count of items in a bag answering to a token (tag, kind, id; see items-lib tokens). */
export const countTag = (rt, who, tag) => Object.entries(bag(rt, who)).reduce((s, [id, n]) => s + (tokens(itemDef(rt, id) || { id }).has(tag) ? n : 0), 0);
export const stackOf = (rt, id) => Math.max(1, itemDef(rt, id)?.stack ?? cfg(rt).stackDefault);
export const slotsOf = (rt, who) => {
  const c = rt.entity(who)?.components;
  return c?.inventory?.slots ?? c?.container?.slots ?? (c?.container ? rt.caches.containerSlots : undefined) ?? (who === 'player' ? cfg(rt).slots : cfg(rt).otherSlots ?? cfg(rt).slots);
};
export const stacksUsed = (rt, who) => Object.entries(bag(rt, who)).reduce((s, [id, n]) => s + Math.ceil(n / stackOf(rt, id)), 0);
/** How many of `id` still fit in who's bag. */
export function room(rt, who, id) {
  const s = stackOf(rt, id), have = count(rt, who, id), free = slotsOf(rt, who) - stacksUsed(rt, who);
  return (Math.ceil(have / s) * s - have) + Math.max(0, free) * s;
}
/** Add up to n items; returns how many were added. Emits item_gained(+:<item>) and inventory_full for the rest. */
export function give(rt, who, id, n = 1, { silent = false } = {}) {
  if (n <= 0) return 0;
  const fit = Math.min(n, room(rt, who, id));
  if (fit > 0) { const b = mutable(rt, who); b[id] = (b[id] || 0) + fit; if (!silent) rt.emitTyped('item_gained', id, { item: id, count: fit, who }); }
  if (fit < n && !silent) rt.emit('inventory_full', { item: id, count: n - fit, who });
  return fit;
}
/** Remove up to n items; returns how many were removed. Emits item_lost(+:<item>). */
export function take(rt, who, id, n = 1, { silent = false } = {}) {
  const k = Math.min(bag(rt, who)[id] || 0, n);
  if (!k) return 0;
  const b = mutable(rt, who);
  b[id] -= k; if (!b[id]) delete b[id];
  // Per-instance data (merged crafted effects) never outlives the items it describes.
  const meta = rt.state.prim['gameplay.inventory.meta']?.[who]?.[id];
  if (meta && meta.length > (b[id] || 0)) meta.length = b[id] || 0;
  if (!silent) rt.emitTyped('item_lost', id, { item: id, count: k, who });
  return k;
}
/** Move up to n items between bags; returns how many moved. */
export function transfer(rt, from, to, id, n = 1) {
  const k = Math.min(count(rt, from, id), n, room(rt, to, id));
  if (k <= 0) { if (count(rt, from, id) && k <= 0) rt.emit('inventory_full', { item: id, count: n, who: to }); return 0; }
  take(rt, from, id, k); give(rt, to, id, k);
  rt.emit('item_transferred', { item: id, count: k, from, to });
  return k;
}

const countCheck = (field) => (e, path, errors) => { if (e.count !== undefined && (!Number.isInteger(e.count) || e.count < 1)) errors.push({ code: 'effect_invalid', path: `${path}.${field}`, message: 'count must be a positive integer' }); };

export default {
  id: 'gameplay.inventory',
  card: {
    // What its events tell a person (the HUD's notices and the story log read it: graphics/ui-lib.js tellsOf).
    tells: { item_gained: { label: 'Got', entry: { at: 'content.items', by: 'item' } }, item_lost: { label: 'Gave', entry: { at: 'content.items', by: 'item' } }, inventory_full: { label: 'Inventory full' } },
    loop: { verbs: [], progress: ['item_gained', 'item_transferred'] },
    // What this primitive needs in the document to be meaningful (planner/content.js reads it).
    content: [
      {"need": "items", "min": 2, "why": "an inventory needs items to hold", "example": {"id": "brass_key", "name": "Brass key", "kind": "key"}},
    ],
    intent: 'Entities carry items in stacks with per-entity slot limits; provides the `item` and `item_tag` predicates and give_item/take_item/transfer_item effects used by quests, gates, crafting, shops and dialogue.',
    views: ['any'],
    params: {
      slots: { type: 'integer', default: 36, min: 1, max: 1000, unit: 'stacks', effect: 'stacks the player can hold (other entities: components.inventory.slots, else otherSlots)' },
      otherSlots: { type: 'integer', default: 36, min: 1, max: 1000, unit: 'stacks', effect: 'stacks a non-player entity (NPC, container without its own size) can hold' },
      stackDefault: { type: 'integer', default: 999, min: 1, max: 100000, effect: 'stack size for items without content.items[].stack' },
      start: { type: 'list', default: [], of: { type: 'object', fields: { item: { type: 'ref', to: 'item', required: true }, count: { type: 'integer', default: 1, min: 1, max: 9999 } } }, effect: "player's starting items" },
    },
    provides: { events: ['item_gained', 'item_gained:*', 'item_lost', 'item_lost:*', 'inventory_full', 'item_transferred'], services: ['inventory'] },
    reads: ['content.items'],
  },
  logic(logic) {
    logic.predicate('item', { refs: p => [['item', p.item]], test: (p, rt, c) => compare(count(rt, whoKey(p.who, c), p.item), p) });
    logic.predicate('item_tag', { test: (p, rt, c) => compare(countTag(rt, whoKey(p.who, c), p.item_tag), p) });
    logic.effect('give_item', { refs: e => [['item', e.item]], check: countCheck('count'), run: (e, rt, c) => { give(rt, whoKey(e.who, c), e.item, e.count ?? 1); } });
    logic.effect('take_item', { refs: e => [['item', e.item]], check: countCheck('count'), run: (e, rt, c) => { take(rt, whoKey(e.who, c), e.item, e.count ?? 1); } });
    logic.effect('transfer_item', { refs: e => [['item', e.item]], check: countCheck('count'), run: (e, rt, c) => { transfer(rt, whoKey(e.from, c), whoKey(e.to, c), e.item, e.count ?? 1); } });
  },
  validate(config, doc) {
    const errors = [];
    (doc.content?.items || []).forEach((it, i) => { if (it.stack !== undefined && (!Number.isInteger(it.stack) || it.stack < 1)) errors.push({ code: 'item_invalid', path: `content.items[${i}].stack`, message: 'stack must be a positive integer' }); });
    (doc.content?.archetypes || []).forEach((a, i) => (a.components?.inventory?.start || []).forEach((s, j) => {
      if (!(doc.content?.items || []).some(it => it.id === s.item)) errors.push({ code: 'ref_unknown', path: `content.archetypes[${i}].components.inventory.start[${j}].item`, message: `unknown item '${s.item}'` });
    }));
    return errors;
  },
  install(rt, config) {
    rt.caches.inventory = config;
    if (!rt.state.frame) { const b = mutable(rt, 'player'); for (const { item, count: n } of config.start) b[item] = (b[item] || 0) + n; }
    // Entities spawned with components.inventory.start get their own bag.
    rt.on('spawn', ({ id }) => {
      const e = rt.entity(id), start = e?.components?.inventory?.start;
      if (!start || id === 'player' || rt.store(KEY)[id]) return;
      for (const s of start) give(rt, id, s.item, s.count ?? 1, { silent: true });
    });
    rt.provide('inventory', {
      bag: (who = 'player') => ({ ...bag(rt, who) }), count: (who, id) => count(rt, who, id), countTag: (who, tag) => countTag(rt, who, tag),
      room: (who, id) => room(rt, who, id), stacks: (who = 'player') => stacksUsed(rt, who), slots: (who = 'player') => slotsOf(rt, who),
      give: (who, id, n) => give(rt, who, id, n), take: (who, id, n) => take(rt, who, id, n), transfer: (from, to, id, n) => transfer(rt, from, to, id, n),
    });
  },
};
