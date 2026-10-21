// gameplay.resource: named pools (stamina, mana, focus, oxygen, fuel, hunger,
// flame...) for the player and any entity with components.resources. Each pool
// has max, regen (negative = passive drain), a regen delay after spending, an
// exhaustion lockout, conditional drains and depleted/restored effects.
// Other primitives spend through the `resources` service, by pool id or by a
// drain tag ('sprint', 'attack', 'block'...) that maps to every pool listing it.
// Status modifiers `res.<pool>.max` / `res.<pool>.regen` (combat.status) adjust
// pools while active.
import { frames, statOf, resolveWho, round, err } from './combat-lib.js';
import { compare } from '../../kernel/logic.js';

const KEY = 'gameplay.resource';
const POOL = {
  id: { type: 'string', required: true },
  max: { type: 'number', default: 100, min: 0, max: 1e6 },
  regen: { type: 'number', default: 0, min: -1e4, max: 1e4, unit: '/s' },
  regenDelay: { type: 'number', default: 0, min: 0, max: 600, unit: 's' },
  startFull: { type: 'boolean', default: true },
  start: { type: 'number', min: 0, max: 1e6 },
  exhaustLock: { type: 'boolean', default: false },
  unlockAt: { type: 'number', default: 0.3, min: 0, max: 1, effect: 'fraction a locked pool must refill to before it can be spent again' },
  drainTags: { type: 'list', of: { type: 'string' }, default: [] },
  drains: { type: 'list', default: [], of: { type: 'object', fields: { when: { type: 'predicate', required: true }, rate: { type: 'number', required: true, unit: '/s' } } } },
  onDepleted: { type: 'effects', default: [] },
  onRestored: { type: 'effects', default: [] },
  player: { type: 'boolean', default: true, effect: 'the player has this pool even without a resources component' },
};

export default {
  id: KEY,
  card: {
    loop: { verbs: [], progress: ['spent', 'restored'] },
    intent: 'Named resource pools (stamina, mana, focus, oxygen, fuel, hunger) on the player and any entity: max, regen or passive drain, regen delay after spending, exhaustion lockout, drains while a predicate holds, and effects when a pool empties or refills. Movement and combat spend pools through drain tags.',
    views: ['any'],
    params: {
      pools: { type: 'list', min: 1, required: true, of: { type: 'object', fields: POOL }, effect: 'pool definitions; archetype components.resources.<pool> overrides max/regen/regenDelay/start per entity' },
    },
    provides: { events: ['depleted', 'depleted:*', 'restored', 'restored:*', 'exhausted', 'spent'], vars: ['res.*'], services: ['resources'] },
    defines: [{ kind: 'pool', in: 'pools' }],
    components: { resources: { type: 'object', effect: 'the pools this entity has (NPCs carry only those listed), by pools[] id; runtime state lives in each', values: { type: 'object', open: true, fields: {
      max: { type: 'number', min: 0, max: 1e6 }, regen: { type: 'number', min: -1e4, max: 1e4, unit: '/s' }, regenDelay: { type: 'number', min: 0, max: 600, unit: 's' }, start: { type: 'number', min: 0, max: 1e6 },
    } } } },
    rules: { resource_start_invalid: { fields: ['pools[].start', 'pools[].max'], message: 'a pool\'s start is at most its max', example: { pools: [{ id: 'mana', max: 5, regen: null, regenDelay: null, startFull: null, start: 10, exhaustLock: null, unlockAt: null, drainTags: null, player: null }] } } },
  },
  logic(logic) {
    const svc = rt => rt.service('resources');
    logic.predicate('resource', {
      refs: p => [['pool', p.resource]],
      test: (p, rt, c) => { const e = resolveWho(rt, p.who, c); const v = e ? svc(rt).get(e, p.resource) : 0; return compare(p.frac ? v / Math.max(1e-9, svc(rt).max(e, p.resource)) : v, p); },
    });
    const check = (e, path, errors) => { if (e.amount !== undefined && !Number.isFinite(e.amount)) errors.push(err('effect_invalid', `${path}.amount`, 'amount must be a number')); };
    logic.effect('spend', { refs: e => [['pool', e.resource]], check, run: (e, rt, c) => { const t = resolveWho(rt, e.who, c); if (t) svc(rt).spend(t, e.resource, e.amount ?? 1, { force: true }); } });
    logic.effect('gain', { refs: e => [['pool', e.resource]], check, run: (e, rt, c) => { const t = resolveWho(rt, e.who, c); if (t) svc(rt).gain(t, e.resource, e.amount ?? 1); } });
    logic.effect('set_max', { refs: e => [['pool', e.resource]], run: (e, rt, c) => { const t = resolveWho(rt, e.who, c); if (t) svc(rt).setMax(t, e.resource, e.value); } });
    logic.effect('refill', { run: (e, rt, c) => { const t = resolveWho(rt, e.who, c); if (t) svc(rt).refill(t, e.resource); } });
  },
  validate(config) {
    // Pool ids are a kind the card defines (unique slugs): the kernel checks them.
    const errors = [];
    config.pools.forEach((p, i) => {
      if (p.start !== undefined && p.start > p.max) errors.push(err('resource_start_invalid', `with.pools[${i}].start`, 'start exceeds max'));
    });
    return errors;
  },
  install(rt, config) {
    const defs = new Map(config.pools.map(p => [p.id, p]));
    const byTag = tag => config.pools.filter(p => p.drainTags.includes(tag)).map(p => p.id);
    /** Runtime pool state in components.resources[pool] = { value, max?, regen?, delay, locked, empty }. */
    const pool = (e, id) => {
      const d = defs.get(id); if (!d || !e) return null;
      const c = e.components;
      if (!c.resources && !(e.id === 'player' && d.player)) return null;
      const res = (c.resources ??= {});
      if (c.resources && !res[id] && e.id !== 'player') return null; // NPCs carry only the pools they list
      const s = (res[id] ??= {});
      if (s.value === undefined) s.value = s.start ?? d.start ?? (d.startFull ? s.max ?? d.max : 0), s.delay = 0, s.locked = false, s.empty = s.value <= 0;
      return s;
    };
    const maxOf = (e, id) => { const s = pool(e, id); return s ? Math.max(0, (s.max ?? defs.get(id).max) + statOf(rt, e, `res.${id}.max`)) : 0; };
    const regenOf = (e, id) => (pool(e, id)?.regen ?? defs.get(id).regen) + statOf(rt, e, `res.${id}.regen`);
    const ids = (e, ref) => (defs.has(ref) ? [ref] : byTag(ref)).filter(id => pool(e, id));
    const sync = e => { if (e?.id !== 'player') return; for (const id of defs.keys()) if (pool(e, id)) { rt.state.vars[`res.${id}`] = round(pool(e, id).value); rt.state.vars[`res.${id}.max`] = round(maxOf(e, id)); } };
    const changed = (e, id, before) => {
      const s = pool(e, id), d = defs.get(id), max = maxOf(e, id);
      if (s.value <= 0 && before > 0) {
        s.empty = true;
        if (d.exhaustLock) { s.locked = true; rt.emit('exhausted', { who: e.id, resource: id }); }
        rt.emitTyped('depleted', id, { who: e.id, resource: id });
        rt.run(d.onDepleted, { self: e.id });
      }
      if (s.locked && s.value >= max * d.unlockAt) s.locked = false;
      if (s.empty && s.value >= max) { s.empty = false; rt.emitTyped('restored', id, { who: e.id, resource: id }); rt.run(d.onRestored, { self: e.id }); }
    };
    const api = {
      pools: () => [...defs.keys()],
      has: (e, ref) => ids(e, ref).length > 0,
      get: (e, id) => pool(e, id)?.value ?? 0,
      max: (e, id) => maxOf(e, id),
      locked: (e, ref) => ids(e, ref).some(id => pool(e, id).locked),
      /** Can e pay `amount` from every pool behind ref (pool id or drain tag)? */
      can: (e, ref, amount = 0, partial = true) => ids(e, ref).every(id => { const s = pool(e, id); return !s.locked && s.value > 0 && (partial || s.value >= amount); }),
      /**
       * Spend from every pool behind ref. Without force, fails (spending nothing)
       * when a pool is locked or empty; a partial balance is drained to zero, as in
       * soulslikes where the last swing empties stamina. Returns true if paid.
       */
      spend(e, ref, amount, { force = false, partial = true } = {}) {
        const list = ids(e, ref); if (!list.length) return !defs.has(ref); // unknown tag: nothing to pay
        if (!force && list.some(id => pool(e, id).locked || pool(e, id).value <= 0 || (!partial && pool(e, id).value < amount))) return false;
        for (const id of list) {
          const s = pool(e, id), before = s.value;
          s.value = round(Math.max(0, s.value - amount)); s.delay = frames(s.regenDelay ?? defs.get(id).regenDelay);
          rt.emit('spent', { who: e.id, resource: id, amount: round(before - s.value) });
          changed(e, id, before);
        }
        sync(e); return true;
      },
      gain(e, ref, amount) { for (const id of ids(e, ref)) { const s = pool(e, id), before = s.value; s.value = round(Math.min(maxOf(e, id), s.value + amount)); changed(e, id, before); } sync(e); },
      setMax(e, id, value) { const s = pool(e, id); if (!s) return; s.max = value; s.value = Math.min(s.value, maxOf(e, id)); sync(e); },
      refill(e, ref) { for (const id of ref ? ids(e, ref) : [...defs.keys()].filter(id => pool(e, id))) { const s = pool(e, id), before = s.value; s.value = maxOf(e, id); s.locked = false; changed(e, id, before); } sync(e); },
      /** Continuous drain for this step (rate per second), e.g. sprinting. */
      drain(e, ref, rate) { return api.spend(e, ref, rate / 60, { force: true }); },
    };
    rt.provide('resources', api);
    rt.system('rules', rt => {
      for (const e of Object.values(rt.state.entities)) {
        if (!e.components.resources && e.id !== 'player') continue;
        for (const [id, d] of defs) {
          const s = pool(e, id); if (!s) continue;
          const before = s.value, max = maxOf(e, id);
          let rate = 0;
          for (const dr of d.drains) if (rt.test(dr.when, { self: e.id })) rate -= dr.rate;
          if (s.delay > 0) s.delay--;
          else rate += regenOf(e, id);
          if (rate) s.value = round(Math.min(max, Math.max(0, s.value + rate / 60)));
          if (s.value > max) s.value = max;
          if (s.value !== before) changed(e, id, before);
        }
        sync(e);
      }
    }, KEY);
  },
};
