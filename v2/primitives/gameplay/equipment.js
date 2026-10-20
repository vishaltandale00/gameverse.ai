// Equipment: slots that accept item tokens (kind, tags, armor:<slot>, charm...),
// several items per slot (charm rows), a cost budget (charm notches, var
// budget.<pool> raises it), stat modifiers published as vars stat.* for the
// player (additively, so other primitives can also write stat vars), durability
// worn down by events and repaired by effects. Equipped items stay in the bag.
// Each entity's worn set is mirrored in components.equipment.worn for readers.
import { compare } from '../../kernel/logic.js';
import { count, take } from './inventory.js';
import { item as itemDef, matches, whoKey } from './items-lib.js';

const KEY = 'gameplay.equipment';
const parse = v => (typeof v === 'string' ? { item: v } : v || {});
const statKey = k => (k.startsWith('stat.') ? k : `stat.${k}`);
/** Stat modifiers an item grants when worn. */
export function modsOf(def) {
  const out = {};
  const addm = (k, v) => { if (Number.isFinite(v)) out[k] = (out[k] ?? 0) + v; };
  for (const [k, v] of Object.entries(def?.stats || {})) addm(statKey(k), v);
  for (const [k, v] of Object.entries(def?.charm?.mods || {})) addm(statKey(k), v);
  for (const [k, v] of Object.entries(def?.armor?.def || {})) addm(`stat.def.${k}`, v);
  return out;
}
const maxDurability = def => def?.weapon?.durability ?? def?.armor?.durability ?? def?.tool?.durability ?? def?.durability ?? null;

export default {
  id: 'gameplay.equipment',
  card: {
    intent: 'Equip slots with item-token filters and capacities, a loadout cost budget (charm notches), stat modifiers as vars stat.*, durability with breakage and repair; equip/unequip actions and effects.',
    views: ['any'],
    params: {
      slots: { type: 'list', default: [{ id: 'hand', accepts: ['weapon', 'tool'], max: 1 }], min: 1, of: { type: 'object', fields: {
        id: { type: 'string', required: true }, accepts: { type: 'list', default: ['*'], of: { type: 'string' }, effect: 'item tokens: kind, tags, armor:<slot>, tool:<kind>, charm, item ids, *' },
        max: { type: 'integer', default: 1, min: 1, max: 64, effect: 'items the slot holds at once' },
        swap: { type: 'boolean', default: true, effect: 'equipping into a full single slot replaces the worn item' },
      } }, effect: 'equipment slots' },
      budget: { type: 'object', fields: { pool: { type: 'string', required: true }, total: { type: 'integer', default: 3, min: 0, max: 100 }, slots: { type: 'list', of: { type: 'string' }, effect: 'slots whose items cost budget (default every slot)' } }, effect: 'loadout budget: items cost charm.cost (or `cost`); var budget.<pool> holds the capacity' },
      durability: { type: 'boolean', default: false, effect: 'items with a durability lose it on wear events and break at 0' },
      breakRemoves: { type: 'boolean', default: true, effect: 'a broken item leaves the bag (else it stays, unequipped, at 0)' },
      statMods: { type: 'boolean', default: true, effect: 'worn items add their stats/charm mods/armor def to vars stat.*' },
      wear: { type: 'list', default: [{ event: 'tool_used', amount: 1 }, { event: 'weapon_used', amount: 1 }], of: { type: 'object', fields: {
        event: { type: 'string', required: true }, slots: { type: 'list', of: { type: 'string' }, effect: "wear every item worn in these slots (default: the event's item)" },
        amount: { type: 'number', default: 1, min: 0 }, who: { type: 'string', default: 'who', effect: 'event field naming the wearer' },
      } }, effect: 'events that wear items down: {who, item} events wear that item; slot rules wear what is worn there' },
      autoEquip: { type: 'boolean', default: true, effect: "starting items (and components.equipment.start) fill empty slots that accept them" },
    },
    provides: { events: ['equipped', 'equipped:*', 'unequipped', 'equip_denied', 'broke', 'broke:*', 'repaired'], vars: ['stat.*', 'budget.*'], actions: ['equip', 'unequip'], services: ['equipment'] },
    requires: { primitives: ['gameplay.inventory'] },
    reads: ['content.items'],
  },
  logic(logic) {
    const api = rt => rt.caches.equipment;
    logic.predicate('equipped', { refs: p => [['item', p.equipped]], test: (p, rt, c) => {
      const worn = api(rt)?.worn(whoKey(p.who, c)) || {};
      const n = Object.entries(worn).filter(([s]) => !p.slot || s === p.slot).reduce((k, [, items]) => k + items.filter(i => i === p.equipped).length, 0);
      return compare(n, p);
    } });
    logic.effect('equip', { refs: e => [['item', e.item]], run: (e, rt, c) => api(rt)?.equip(whoKey(e.who, c), e.item, e.slot) });
    logic.effect('unequip', { run: (e, rt, c) => api(rt)?.unequip(whoKey(e.who, c), e.slot ?? e.item) });
    logic.effect('repair', { refs: e => (e.item ? [['item', e.item]] : []), run: (e, rt, c) => api(rt)?.repair(whoKey(e.who, c), e.item, e.amount) });
    logic.effect('wear', { refs: e => (e.item ? [['item', e.item]] : []), run: (e, rt, c) => api(rt)?.wear(whoKey(e.who, c), e.item, e.amount ?? 1) });
  },
  validate(config, doc) {
    const errors = [], ids = new Set();
    for (const s of config.slots) { if (ids.has(s.id)) errors.push({ code: 'id_duplicate', message: `duplicate slot '${s.id}'` }); ids.add(s.id); }
    for (const s of config.budget?.slots || []) if (!ids.has(s)) errors.push({ code: 'equipment_invalid', message: `budget slot '${s}' is not a slot` });
    (doc.content?.archetypes || []).forEach((a, i) => {
      const eq = a.components?.equipment; if (!eq) return;
      for (const s of eq.slots || []) if (!ids.has(s)) errors.push({ code: 'equipment_invalid', path: `content.archetypes[${i}].components.equipment.slots`, message: `unknown slot '${s}'`, hint: [...ids].join(', ') });
    });
    return errors;
  },
  install(rt, config) {
    const slots = new Map(config.slots.map(s => [s.id, s]));
    const st = () => { const s = rt.store(KEY); s.worn ??= {}; s.dur ??= {}; s.applied ??= {}; s.started ??= false; return s; };
    const slotsFor = who => { const allow = rt.entity(who)?.components?.equipment?.slots; return config.slots.filter(s => !allow || allow.includes(s.id)); };
    const wornOf = who => (st().worn[who] ??= {});
    const wornCount = (who, id) => Object.values(wornOf(who)).reduce((n, l) => n + l.filter(x => x === id).length, 0);
    const pool = config.budget?.pool, budgetVar = pool ? `budget.${pool}` : null;
    const costed = slot => config.budget && (!config.budget.slots || config.budget.slots.includes(slot));
    const costOf = id => { const d = itemDef(rt, id); return d?.charm?.cost ?? d?.cost ?? 0; };
    const capacity = () => (budgetVar ? rt.state.vars[budgetVar] ?? config.budget.total : Infinity);
    const used = who => Object.entries(wornOf(who)).reduce((n, [s, l]) => n + (costed(s) ? l.reduce((k, i) => k + costOf(i), 0) : 0), 0);
    if (budgetVar && rt.state.vars[budgetVar] == null) rt.state.vars[budgetVar] = config.budget.total;

    function sync(who) {
      const worn = wornOf(who), e = rt.entity(who);
      const mods = {};
      if (config.statMods) for (const l of Object.values(worn)) for (const id of l) for (const [k, v] of Object.entries(modsOf(itemDef(rt, id)))) mods[k] = (mods[k] ?? 0) + v;
      if (who === 'player') {
        const prev = st().applied[who] || {};
        for (const k of new Set([...Object.keys(prev), ...Object.keys(mods)])) { const d = (mods[k] ?? 0) - (prev[k] ?? 0); if (d) rt.state.vars[k] = +((rt.state.vars[k] ?? 0) + d).toFixed(6); }
        st().applied[who] = mods;
        if (budgetVar) rt.state.vars[`${budgetVar}.used`] = used(who);
      }
      if (e) { e.components.equipment = { ...(e.components.equipment || {}), worn: structuredClone(worn), stats: mods }; }
    }
    function equip(who, id, slotId) {
      const def = itemDef(rt, id), deny = reason => { rt.emit('equip_denied', { who, item: id, slot: slotId ?? null, reason }); return false; };
      if (!def) return deny('unknown');
      if (count(rt, who, id) <= wornCount(who, id)) return deny('missing');
      const options = slotsFor(who).filter(s => (!slotId || s.id === slotId) && matches(def, s.accepts));
      if (!options.length) return deny('slot');
      const worn = wornOf(who);
      let slot = options.find(s => (worn[s.id]?.length ?? 0) < s.max);
      let swapped = null;
      if (!slot) { slot = options.find(s => s.max === 1 && s.swap); if (!slot) return deny('full'); swapped = worn[slot.id][0]; }
      if (costed(slot.id)) { const after = used(who) + costOf(id) - (swapped ? costOf(swapped) : 0); if (after > capacity()) return deny('budget'); }
      if (swapped) unequip(who, slot.id);
      (worn[slot.id] ??= []).push(id);
      if (config.durability && maxDurability(def) != null && st().dur[`${who}:${id}`] == null) st().dur[`${who}:${id}`] = maxDurability(def);
      sync(who);
      rt.emitTyped('equipped', id, { who, item: id, slot: slot.id });
      return true;
    }
    function unequip(who, ref) {
      const worn = wornOf(who);
      let slot = ref && slots.has(ref) ? ref : Object.keys(worn).find(s => worn[s].includes(ref));
      if (!slot || !worn[slot]?.length) return false;
      const id = slots.has(ref) ? worn[slot][worn[slot].length - 1] : ref;
      worn[slot].splice(worn[slot].lastIndexOf(id), 1);
      if (!worn[slot].length) delete worn[slot];
      sync(who);
      rt.emit('unequipped', { who, item: id, slot });
      return true;
    }
    function wear(who, id, amount) {
      if (!config.durability || !id) return;
      const def = itemDef(rt, id), max = maxDurability(def); if (max == null || !count(rt, who, id)) return;
      const k = `${who}:${id}`, d = st().dur;
      d[k] = (d[k] ?? max) - amount;
      if (d[k] > 0) return;
      rt.emitTyped('broke', id, { who, item: id });
      if (wornCount(who, id)) unequip(who, id);
      if (config.breakRemoves) { take(rt, who, id, 1); d[k] = count(rt, who, id) ? max : undefined; if (d[k] === undefined) delete d[k]; }
      else d[k] = 0;
    }
    function repair(who, id, amount) {
      const targets = id ? [id] : Object.keys(rt.store('gameplay.inventory')[who] || {});
      for (const t of targets) {
        const max = maxDurability(itemDef(rt, t)); if (max == null) continue;
        const k = `${who}:${t}`; st().dur[k] = Math.min(max, amount == null ? max : (st().dur[k] ?? max) + amount);
        rt.emit('repaired', { who, item: t, durability: st().dur[k] });
      }
    }
    rt.caches.equipment = { equip, unequip, repair, wear: (who, id, n) => wear(who, id, n), worn: who => wornOf(who) };
    for (const rule of config.wear) rt.on(rule.event, d => {
      const who = d[rule.who] ?? 'player';
      if (rule.slots) { for (const s of rule.slots) for (const id of [...(wornOf(who)[s] || [])]) wear(who, id, rule.amount); }
      else if (d.item) wear(who, d.item, rule.amount);
    });
    // Items that leave the bag can no longer be worn.
    rt.on('item_lost', d => { while (wornCount(d.who, d.item) > count(rt, d.who, d.item)) unequip(d.who, d.item); });
    rt.on('spawn', ({ id }) => {
      const e = rt.entity(id); if (!config.autoEquip || !e || id === 'player') return;
      for (const item of e.components.equipment?.start || []) equip(id, item);
    });
    rt.system('input', rt => {
      const s = st(); if (s.started) return; s.started = true;
      if (!config.autoEquip) return;
      for (const id of Object.keys(rt.store('gameplay.inventory').player || {})) {
        const def = itemDef(rt, id); if (!def || wornCount('player', id)) continue;
        const slot = slotsFor('player').find(sl => matches(def, sl.accepts) && !(wornOf('player')[sl.id]?.length) && !costed(sl.id));
        if (slot) equip('player', id, slot.id);
      }
    }, KEY);
    rt.action('equip', (v, rt) => { const { item, slot } = parse(v); equip('player', item, slot); });
    rt.action('unequip', (v, rt) => unequip('player', typeof v === 'object' ? v.slot ?? v.item : v));
    rt.options(rt => {
      const out = [];
      for (const id of Object.keys(rt.store('gameplay.inventory').player || {}).sort()) {
        const def = itemDef(rt, id); if (!def || wornCount('player', id) >= count(rt, 'player', id)) continue;
        const slot = slotsFor('player').find(s => matches(def, s.accepts) && (wornOf('player')[s.id]?.length ?? 0) < s.max && (!costed(s.id) || used('player') + costOf(id) <= capacity()));
        if (slot) out.push({ label: `equip ${id}`, actions: { equip: id } });
      }
      return out.slice(0, 8);
    });
    rt.provide('equipment', {
      slots: (who = 'player') => slotsFor(who).map(s => ({ id: s.id, accepts: s.accepts, max: s.max, items: [...(wornOf(who)[s.id] || [])], item: wornOf(who)[s.id]?.[0] ?? null })),
      budget: (who = 'player') => (pool ? { pool, used: used(who), total: capacity() } : null),
      worn: (who = 'player') => structuredClone(wornOf(who)),
      durability: (who, id) => st().dur[`${who}:${id}`] ?? null,
    });
  },
};
