// Usable items: food, potions, scrolls, tools with an on-use effect list.
// content.items[].use = { fx, cooldown?: s, consume?: b (default true), when?: pred, group?: s }.
// Effects run with self = the user and item = the item id. Crafted items that
// carry merged ingredient effects (gameplay.crafting merge) apply them too.
import { count, take, bag } from './inventory.js';
import { item as itemDef, whoKey, hasEffect } from './items-lib.js';

const KEY = 'gameplay.item.use';
export const META = 'gameplay.inventory.meta';

/** Apply one merged-ingredient effect map {effect|resource|var: amount} to `who`. */
export function applyMerged(rt, who, effects) {
  for (const [k, v] of Object.entries(effects || {}).sort()) {
    if (!v) continue;
    if (hasEffect(rt, k)) rt.run([{ do: k, who, amount: v }], { self: who });
    else if (hasEffect(rt, 'gain') && rt.state.vars[`res.${k}`] != null) rt.run([{ do: 'gain', who, resource: k, amount: v }], { self: who });
    else rt.state.vars[`buff.${k}`] = (rt.state.vars[`buff.${k}`] ?? 0) + v;
  }
}

export default {
  id: 'gameplay.item.use',
  card: {
    loop: { verbs: ['use_item'], progress: ['used_item'] },
    intent: 'Consumables and usable items (food, potions, scrolls, tools): run the item’s use effects with per-item or per-group cooldowns, an optional usability predicate and consumption; merged crafted items apply their ingredient effects.',
    views: ['any'],
    params: {
      cooldown: { type: 'number', default: 0, min: 0, max: 600, unit: 's', effect: 'default cooldown for items without use.cooldown' },
      globalCooldown: { type: 'number', default: 0, min: 0, max: 60, unit: 's', effect: 'minimum gap between any two uses by the same entity' },
      options: { type: 'integer', default: 8, min: 0, max: 64, effect: 'usable items offered to solvers' },
    },
    provides: { events: ['used_item', 'used_item:*', 'use_denied'], actions: ['use_item'] },
    requires: { primitives: ['gameplay.inventory'] },
    reads: ['content.items'],
  },
  logic(logic) {
    logic.effect('use_item', { refs: e => [['item', e.item]], run: (e, rt, c) => rt.caches.useItem?.(whoKey(e.who, c), e.item, { free: e.free }) });
  },
  validate(config, doc, ctx) {
    const errors = [];
    (doc.content?.items || []).forEach((it, i) => {
      const u = it.use; if (u == null) return;
      const path = `content.items[${i}].use`;
      if (typeof u !== 'object' || !Array.isArray(u.fx)) { errors.push({ code: 'item_invalid', path, message: 'use needs an fx list' }); return; }
      u.fx.forEach((e, k) => ctx.checkEffect(e, `${path}.fx[${k}]`, errors));
      if (u.cooldown !== undefined && !(Number.isFinite(u.cooldown) && u.cooldown >= 0)) errors.push({ code: 'item_invalid', path: `${path}.cooldown`, message: 'cooldown must be a non-negative number' });
      if (u.consume !== undefined && typeof u.consume !== 'boolean') errors.push({ code: 'item_invalid', path: `${path}.consume`, message: 'consume must be true or false' });
      if (u.when) ctx.checkPredicate(u.when, `${path}.when`, errors);
    });
    return errors;
  },
  install(rt, config) {
    const st = () => { const s = rt.store(KEY); s.ready ??= {}; s.last ??= {}; return s; };
    st(); // created at install, so reads later never add state
    function use(who, id, { free = false } = {}) {
      const def = itemDef(rt, id), u = def?.use;
      const deny = reason => { rt.emit('use_denied', { who, item: id, reason }); return false; };
      if (!u) return deny('unusable');
      if (!free && count(rt, who, id) < 1) return deny('missing');
      const s = st(), group = `${who}:${u.group ?? id}`;
      if ((s.ready[group] ?? -1) > rt.state.frame) return deny('cooldown');
      if (config.globalCooldown && s.last[who] != null && rt.state.frame - s.last[who] < Math.round(config.globalCooldown / rt.dt)) return deny('cooldown');
      if (u.when && !rt.test(u.when, { self: who, item: id })) return deny('condition');
      const cd = u.cooldown ?? config.cooldown;
      if (cd > 0) s.ready[group] = rt.state.frame + Math.round(cd / rt.dt);
      s.last[who] = rt.state.frame;
      const consume = u.consume ?? true;
      const meta = rt.store(META)[who]?.[id];
      const merged = consume && meta?.length ? meta.shift() : null;
      if (meta && !meta.length) delete rt.store(META)[who][id];
      if (consume && !free) take(rt, who, id, 1);
      rt.run(u.fx, { self: who, item: id });
      if (merged) applyMerged(rt, who, merged.effects);
      rt.emitTyped('used_item', id, { who, item: id, merged: Boolean(merged) });
      return true;
    }
    rt.caches.useItem = use;
    rt.action('use_item', (id, rt) => use('player', typeof id === 'object' ? id.item : id));
    rt.options(rt => {
      const held = bag(rt, 'player'), s = st();
      return Object.keys(held).sort().filter(id => itemDef(rt, id)?.use && (s.ready[`player:${itemDef(rt, id).use.group ?? id}`] ?? -1) <= rt.state.frame && (!itemDef(rt, id).use.when || rt.test(itemDef(rt, id).use.when, { self: 'player', item: id })))
        .slice(0, config.options).map(id => ({ label: `use ${id}`, actions: { use_item: id } }));
    });
  },
};
