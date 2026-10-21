// gameplay.combat.status: buffs and debuffs from content.statuses on any entity.
// A status has a duration, stacks (max), refresh rule, damage ticks, stat
// modifiers and tags. Built-in semantics, through modifiers any primitive reads
// with statOf (combat-lib):
//   stat.stun > 0          can't act (also sets health.stun each frame)
//   stat.invulnerable > 0  hits are ignored (health pipeline)
//   stat.fright > 0        contact reverses: touching it defeats it (maze fright)
//   stat.vulnerable        extra damage taken (health.vulnerableBonus per point)
//   shield: {hits, amount} absorbs hits or damage, then ends
//   hp.max / res.<pool>.max / res.<pool>.regen   read by health and resource
//   res.<pool>             per-second gain (+) or drain (-) of that pool
// Runtime: rt.store(KEY)[entityId] = { active: {id: {left, stacks, tick, absorbed}}, mods };
// components.status mirrors the frozen shape {statusId: secondsLeft}. Immunities: components.immune [ids|tags].
import { frames, resolveWho, targetsOf, statOf, combat, service, intercept, round, err } from './combat-lib.js';

const KEY = 'gameplay.combat.status';
const REFRESH = ['reset', 'extend', 'keep', 'max'];

export default {
  id: KEY,
  card: {
    loop: { verbs: [], progress: ['status_applied'] },
    intent: 'Buffs and debuffs from content.statuses on any entity: duration, stacks, damage ticks, stat modifiers, tags, shields and immunities. Covers burning, poison, slow, stun, fright, invulnerability and shields; other primitives read its modifiers.',
    views: ['any'],
    params: {
      tickSec: { type: 'number', default: 1, min: 0.05, max: 10, unit: 's', effect: 'default interval between damage ticks (status tick.every overrides)' },
      maxActive: { type: 'integer', default: 16, min: 1, max: 128, effect: 'statuses one entity can carry' },
      stunActs: { type: 'boolean', default: true, effect: 'stat.stun keeps components.health.stun up so AI and moves stop' },
    },
    provides: { events: ['status_applied', 'status_applied:*', 'status_ended', 'status_ended:*', 'status_resisted', 'shield_absorbed'], services: ['status', 'stats'] },
    requires: { primitives: ['gameplay.combat.health'] },
    reads: ['content.statuses'],
    defines: [{ kind: 'status', at: 'content.statuses' }],
  },
  logic(logic) {
    logic.predicate('status', {
      refs: p => [['status', p.status]],
      test: (p, rt, c) => {
        const e = resolveWho(rt, p.who, c), a = rt.state.prim[KEY]?.[e?.id]?.active || {};
        const n = p.status === '*' ? Object.keys(a).length : p.tag ? Object.keys(a).filter(id => tagsOf(rt, id).includes(p.tag)).length : a[p.status]?.stacks ?? 0;
        for (const k of ['gte', 'lte', 'gt', 'lt', 'eq', 'ne']) if (p[k] !== undefined) return k === 'gte' ? n >= p[k] : k === 'lte' ? n <= p[k] : k === 'gt' ? n > p[k] : k === 'lt' ? n < p[k] : k === 'eq' ? n === p[k] : n !== p[k];
        return n > 0;
      },
    });
    logic.effect('apply_status', {
      refs: e => [['status', e.status]],
      check: (e, path, errors) => { if (e.sec !== undefined && !(Number.isFinite(e.sec) && e.sec >= 0)) errors.push(err('effect_invalid', `${path}.sec`, 'sec must be >= 0 (0 = the status duration)')); },
      run: (e, rt, c) => { for (const t of targetsOf(rt, e, c)) rt.service('status').apply(t, e.status, { sec: e.sec || undefined, stacks: e.stacks, by: c.self }); },
    });
    logic.effect('clear_status', {
      refs: e => (e.status ? [['status', e.status]] : []),
      run: (e, rt, c) => { for (const t of targetsOf(rt, e, c)) rt.service('status').clear(t, e.status, { tag: e.tag }); },
    });
  },
  validate(config, doc, ctx) {
    const errors = [], types = new Set(doc.systems?.find(s => s.use === 'gameplay.combat.health')?.with?.types || ['phys', 'fire', 'ice', 'shock', 'poison', 'void']);
    (doc.content?.statuses || []).forEach((s, i) => {
      const path = `content.statuses[${i}]`;
      if (!(Number.isFinite(s.duration) && s.duration > 0)) errors.push(err('status_duration_invalid', `${path}.duration`, 'duration must be a positive number of seconds'));
      if (s.stacks !== undefined && !(Number.isInteger(s.stacks) && s.stacks >= 1)) errors.push(err('status_stacks_invalid', `${path}.stacks`, 'stacks must be an integer >= 1'));
      if (s.refresh && !REFRESH.includes(s.refresh)) errors.push(err('status_refresh_invalid', `${path}.refresh`, `refresh must be ${REFRESH.join('|')}`));
      if (s.tick && !(Number.isFinite(s.tick.dps))) errors.push(err('status_tick_invalid', `${path}.tick.dps`, 'tick.dps must be a number'));
      if (s.tick?.type && !types.has(s.tick.type)) errors.push(err('status_type_unknown', `${path}.tick.type`, `unknown damage type '${s.tick.type}'`));
      for (const [k, v] of Object.entries(s.mods || {})) if (!Number.isFinite(v)) errors.push(err('status_mod_invalid', `${path}.mods.${k}`, 'modifier must be a number'));
      for (const k of ['onApply', 'onEnd']) (s[k] || []).forEach((e, j) => ctx?.checkEffect(e, `${path}.${k}[${j}]`, errors));
    });
    return errors;
  },
  install(rt, config) {
    const defs = () => { if (rt.caches.statusDoc !== rt.doc) { rt.caches.statusDoc = rt.doc; rt.caches.statusDefs = new Map((rt.doc.content?.statuses || []).map(s => [s.id, s])); } return rt.caches.statusDefs; };
    // Runtime detail per entity in this primitive's store; components.status mirrors {statusId: secondsLeft} (frozen field).
    const rec = e => { const s = (rt.store(KEY)[e.id] ??= {}); s.active ??= {}; s.mods ??= {}; return s; };
    const peek = e => rt.state.prim[KEY]?.[e?.id];
    const mirror = e => { const s = peek(e); if (!s) return; e.components.status = Object.fromEntries(Object.entries(s.active).map(([id, a]) => [id, round(a.left / 60, 1e3)])); };
    const recompute = e => {
      const s = rec(e), mods = {};
      for (const [id, a] of Object.entries(s.active)) for (const [k, v] of Object.entries(defs().get(id)?.mods || {})) if (!/^res\.[^.]+$/.test(k)) mods[k] = round((mods[k] ?? 0) + v * a.stacks);
      s.mods = mods; mirror(e);
    };
    const immune = (e, d) => { const im = e.components.immune || []; return im.includes(d.id) || (d.tags || []).some(t => im.includes(t)); };
    const api = {
      defs: () => [...defs().values()],
      has: (e, id) => Boolean(peek(e)?.active?.[id]),
      stacks: (e, id) => peek(e)?.active?.[id]?.stacks ?? 0,
      active: e => Object.keys(peek(e)?.active || {}),
      list: e => Object.entries(peek(e)?.active || {}).map(([id, a]) => ({ id, remaining: round(a.left / 60, 1e3), stacks: a.stacks, tags: defs().get(id)?.tags || [] })),
      apply(e, id, { sec, stacks = 1, by = null } = {}) {
        const d = defs().get(id); if (!d || !e) return false;
        if (immune(e, d)) { rt.emit('status_resisted', { who: e.id, status: id }); return false; }
        const s = rec(e), cur = s.active[id], dur = frames(sec ?? d.duration), max = d.stacks ?? 1;
        if (!cur && Object.keys(s.active).length >= config.maxActive) return false;
        if (cur) {
          cur.stacks = Math.min(max, cur.stacks + stacks);
          const rule = d.refresh ?? 'reset';
          cur.left = rule === 'extend' ? cur.left + dur : rule === 'keep' ? cur.left : Math.max(rule === 'max' ? cur.left : 0, dur);
        } else s.active[id] = { left: dur, stacks: Math.min(max, stacks), tick: frames(d.tick?.every ?? config.tickSec), absorbed: 0, by };
        recompute(e);
        rt.emitTyped('status_applied', id, { who: e.id, status: id, stacks: s.active[id].stacks, by });
        if (!cur && d.onApply) rt.run(d.onApply, { self: e.id, by });
        return true;
      },
      clear(e, id, { tag, reason = 'cleared' } = {}) {
        const s = peek(e); if (!s?.active) return 0;
        const ids = id ? [id] : tag ? Object.keys(s.active).filter(x => (defs().get(x)?.tags || []).includes(tag)) : Object.keys(s.active);
        let n = 0;
        for (const x of ids) if (s.active[x]) { delete s.active[x]; n++; rt.emitTyped('status_ended', x, { who: e.id, status: x, reason }); const d = defs().get(x); if (d?.onEnd) rt.run(d.onEnd, { self: e.id }); }
        if (rt.entity(e.id)) recompute(e); return n;
      },
    };
    rt.provide('status', api);
    rt.provide('stats', { get: (e, key) => statOf(rt, e, key) });
    rt.on('despawn', ({ id }) => { if (rt.state.prim[KEY]) delete rt.state.prim[KEY][id]; });
    // Shields absorb hits before damage (after invulnerability and blocks).
    intercept(rt, 50, (target, hit) => {
      const s = peek(target); if (!s?.active || hit.source === 'status') return hit;
      for (const [id, a] of Object.entries(s.active)) {
        const sh = defs().get(id)?.shield; if (!sh) continue;
        if (sh.amount) {
          const take = Math.min(hit.amount, sh.amount * a.stacks - a.absorbed); a.absorbed += take;
          rt.emit('shield_absorbed', { who: target.id, status: id, amount: take });
          if (a.absorbed >= sh.amount * a.stacks - 1e-9) api.clear(target, id, { reason: 'broken' });
          if (take >= hit.amount) return { cancel: true, reason: 'shield' };
          return { ...hit, amount: hit.amount - take };
        }
        a.absorbed++; rt.emit('shield_absorbed', { who: target.id, status: id, hits: 1 });
        if (a.absorbed >= (sh.hits ?? 1) * a.stacks) api.clear(target, id, { reason: 'broken' });
        return { cancel: true, reason: 'shield' };
      }
      return hit;
    }, KEY);
    rt.system('rules', rt => {
      for (const e of Object.values(rt.state.entities)) {
        // Statuses an archetype starts with ({statusId: seconds}) are applied on first sight.
        const comp = e.components.status;
        if (comp && typeof comp === 'object' && !peek(e)) { for (const [id, sec] of Object.entries(comp)) if (defs().has(id)) api.apply(e, id, { sec: Number(sec) || undefined }); if (!peek(e)) rec(e); }
        const s = peek(e); if (!s || !Object.keys(s.active).length) continue;
        const dead = e.components.health?.dead;
        for (const [id, a] of Object.entries(s.active)) {
          const d = defs().get(id); if (!d) { delete s.active[id]; continue; }
          if (dead && !d.persistOnDeath) { api.clear(e, id, { reason: 'death' }); continue; }
          if (d.tick && --a.tick <= 0) {
            a.tick = frames(d.tick.every ?? config.tickSec);
            const amount = d.tick.dps * (d.tick.every ?? config.tickSec) * a.stacks;
            if (amount > 0) combat(rt)?.hit(e, { amount, type: d.tick.type, by: a.by, source: 'status', status: id, ignoreIframes: true, noIframes: true, raw: true });
            else if (amount < 0) combat(rt)?.heal(e, -amount);
          }
          for (const [k, v] of Object.entries(d.mods || {})) { const m = /^res\.([^.]+)$/.exec(k); if (m && service(rt, 'resources')) { const r = rt.service('resources'); if (v < 0) r.drain(e, m[1], -v * a.stacks); else r.gain(e, m[1], v * a.stacks / 60); } }
          if (!rt.entity(e.id)) break;
          if (--a.left <= 0) api.clear(e, id, { reason: 'expired' });
        }
        if (rt.entity(e.id)) mirror(e);
        if (config.stunActs && statOf(rt, e, 'stat.stun') > 0 && e.components.health) { e.components.health.stun = Math.max(e.components.health.stun || 0, 2); e.components.health.stunKind = 'status'; }
      }
    }, KEY);
  },
};
const tagsOf = (rt, id) => (rt.doc.content?.statuses || []).find(s => s.id === id)?.tags || [];
