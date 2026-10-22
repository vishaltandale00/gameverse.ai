// Doors, lifts and warps between places in one space or across spaces.
// A portal has a `from` region ({space?, zone?, at?, size?|r?}) and a `to`
// destination ({space?, zone?, at?, facing?}). It is used by the use_portal
// action (nearest usable portal, or a named one), the use_portal effect, or
// on touch. Gates are predicates (or plot.gate ids via the `gate`
// predicate), keys are items (gameplay.inventory's `item` predicate,
// optionally consumed). Portals can be two-way, single-use, locked and
// unlocked at runtime, delayed (the traveller is held in transit) and
// cooled down. Solvers get options for every usable portal in reach, plus
// macro options (walk there and use it) where the space can path.
import { frames, inRegion, isVec, checkFx, uniqueIds, SLUG } from './runtime-lib.js';

const ID = 'engine.portal';
const TRANSITION_SEC = { cut: 0, fade: 0.5, elevator: 1.5, load: 1 };
const end = { space: { type: 'ref', to: 'space' }, zone: { type: 'ref', to: 'zone' }, at: { type: 'json', effect: 'position in the space\'s coordinates' } };

export default {
  id: ID,
  card: {
    intent: 'Doors, lifts and warps between zones, interiors and spaces, with gates (predicates or plot gates), keys, two-way or single-use travel, runtime locks, transition timing and solver options to use them.',
    views: ['any'],
    params: {
      portals: { type: 'list', default: [], effect: 'portals',
        of: { type: 'object', fields: {
          id: { type: 'string', required: true },
          from: { type: 'object', required: true, fields: { ...end, size: { type: 'json', effect: 'trigger box size' }, r: { type: 'number', min: 0, effect: 'trigger radius' } } },
          to: { type: 'object', required: true, fields: { ...end, facing: { type: 'number', effect: 'facing after arrival (degrees, or ±1 in side views)' } } },
          gate: { type: 'json', effect: 'plot.gate id (string) or a predicate that must hold' },
          key: { type: 'ref', to: 'item', effect: 'item the traveller must carry' }, consumeKey: { type: 'boolean', default: false },
          prompt: { type: 'string', default: '' }, lockedText: { type: 'string', default: '' },
          transition: { type: 'string', options: ['cut', 'fade', 'elevator', 'load'], default: 'cut' },
          delaySec: { type: 'number', min: 0, max: 30, unit: 's', effect: 'transit time (default from transition: cut 0, fade 0.5, elevator 1.5, load 1)' },
          oneWay: { type: 'boolean', default: true, effect: 'false: also usable from `to` back to `from`' },
          once: { type: 'boolean', default: false, effect: 'closes after the first use' },
          trigger: { type: 'string', options: ['use', 'touch'], default: 'use', effect: 'use: needs use_portal; touch: on entering the from region' },
          locked: { type: 'boolean', default: false, effect: 'starts locked (unlock_portal opens it)' },
          cooldownSec: { type: 'number', default: 0.5, min: 0, unit: 's', effect: 'per traveller, after arriving' },
          who: { type: 'string', options: ['player', 'any'], default: 'player', effect: 'who may use it on touch' },
          do: { type: 'effects', default: [], effect: 'run on arrival (self = traveller)' },
        } } },
      useRadius: { type: 'number', default: 1.5, min: 0, effect: 'reach for portals given as a point without size or r' },
    },
    provides: { events: ['portal_used', 'portal_used:*', 'portal_start', 'portal_near', 'portal_locked', 'portal_locked:*', 'blocked'], actions: ['use_portal'], services: ['portals'] },
    requires: { capabilities: ['position'] },
    defines: [{ kind: 'portal', in: 'portals' }],
  },
  logic(logic) {
    logic.effect('use_portal', {
      refs: e => [['portal', e.portal]],
      check: (e, path, errors) => { if (typeof e.portal !== 'string') errors.push({ code: 'portal_effect_invalid', path, message: 'use_portal needs a portal id' }); },
      run: (e, rt, c) => { const who = rt.resolve(e.who, c); if (who) rt.service('portals').use(e.portal, who, { force: Boolean(e.force), reverse: Boolean(e.reverse) }); },
    });
    const lock = locked => ({ refs: e => [['portal', e.portal]], check: (e, path, errors) => { if (typeof e.portal !== 'string') errors.push({ code: 'portal_effect_invalid', path, message: 'needs a portal id' }); }, run: (e, rt) => { rt.store(ID).locked ??= {}; rt.store(ID).locked[e.portal] = locked; } });
    logic.effect('lock_portal', lock(true));
    logic.effect('unlock_portal', lock(false));
    logic.predicate('portal_open', { refs: p => [['portal', p.portal_open]], test: (p, rt, c) => rt.service('portals').usable(p.portal_open, rt.resolve(p.who, c)).ok });
  },
  validate(config, doc, ctx) {
    const errors = [];
    uniqueIds(config.portals, 'portals', 'portal_duplicate', errors);
    config.portals.forEach((p, i) => {
      const path = `portals[${i}]`;
      if (!SLUG.test(p.id || '')) errors.push({ code: 'id_invalid', path: `${path}.id`, message: 'portal id must be a slug' });
      if (p.from.at === undefined && p.from.zone === undefined) errors.push({ code: 'portal_endpoint', path: `${path}.from`, message: 'from needs at or zone' });
      if (p.to.at === undefined && p.to.zone === undefined && p.to.space === undefined) errors.push({ code: 'portal_endpoint', path: `${path}.to`, message: 'to needs at, zone or space' });
      for (const k of ['from', 'to']) {
        const z = p[k].zone, sp = p[k].space;
        if (z && sp && !doc.spaces.find(s => s.id === sp)?.zones?.some(x => x.id === z)) errors.push({ code: 'portal_endpoint', path: `${path}.${k}.zone`, message: `zone '${z}' is not in space '${sp}'` });
        if (p[k].size !== undefined && !isVec(p[k].size)) errors.push({ code: 'portal_endpoint', path: `${path}.${k}.size`, message: 'size must be a vector' });
      }
      if (!p.oneWay && p.to.at === undefined && p.to.zone === undefined) errors.push({ code: 'portal_endpoint', path: `${path}.to`, message: 'a two-way portal needs a destination at or zone to use it back' });
      if (p.gate !== undefined) {
        if (typeof p.gate === 'string') ctx.checkPredicate({ gate: p.gate }, `${path}.gate`, errors);
        else if (p.gate && typeof p.gate === 'object') ctx.checkPredicate(p.gate, `${path}.gate`, errors);
        else errors.push({ code: 'portal_gate_invalid', path: `${path}.gate`, message: 'gate is a plot.gate id or a predicate' });
      }
      if (p.key && p.consumeKey) ctx.checkEffect({ do: 'take_item', item: p.key }, `${path}.key`, errors);
      if (p.key) ctx.checkPredicate({ item: p.key, gte: 1 }, `${path}.key`, errors);
    });
    return errors;
  },
  install(rt, config) {
    const byId = Object.fromEntries(config.portals.map(p => [p.id, p]));
    const st = () => { const s = rt.store(ID); s.locked ??= {}; s.used ??= {}; s.transit ??= {}; s.cool ??= {}; s.near ??= {}; s.touching ??= {}; return s; };
    const region = (end, fallbackSpace) => ({ space: end.space ?? fallbackSpace, zone: end.zone, at: end.at, size: end.size, r: end.r });
    const ends = (p, reverse) => (reverse ? { from: { ...p.to, size: p.from.size, r: p.from.r }, to: { ...p.from, at: p.from.at } } : { from: p.from, to: p.to });
    const gatePred = p => (p.gate === undefined ? null : typeof p.gate === 'string' ? { gate: p.gate } : p.gate);
    /** Can `e` use portal `id` now (ignoring range)? -> { ok, reason } */
    const usable = (id, e, { reverse = false } = {}) => {
      const p = byId[id], s = st(); if (!p || !e) return { ok: false, reason: 'unknown' };
      if (s.locked[id] ?? p.locked) return { ok: false, reason: 'locked' };
      if (p.once && s.used[id]) return { ok: false, reason: 'used' };
      if (reverse && p.oneWay) return { ok: false, reason: 'one_way' };
      if ((s.cool[e.id] ?? -1) > rt.state.frame) return { ok: false, reason: 'cooldown' };
      if (s.transit[e.id]) return { ok: false, reason: 'transit' };
      const g = gatePred(p); if (g && !rt.test(g, { self: e.id })) return { ok: false, reason: 'gate' };
      if (rt.hasService('gates') && rt.service('gates').locked(`portal:${id}`)) return { ok: false, reason: 'gate' }; // plot.gates locks
      if (p.key && !rt.test({ item: p.key, gte: 1, who: e.id === 'player' ? undefined : e.id }, { self: e.id })) return { ok: false, reason: 'key' };
      return { ok: true };
    };
    const inReach = (p, e, reverse) => { const { from } = ends(p, reverse); return inRegion(rt, e, region(from, p.from.space ?? e.space), config.useRadius); };
    const arrive = (id, e, reverse) => {
      const p = byId[id], { to } = ends(p, reverse), s = st();
      const fromSpace = e.space, space = to.space ?? (reverse ? p.from.space : undefined) ?? e.space;
      if (space !== e.space) rt.moveToSpace(e, space, to.at !== undefined ? structuredClone(to.at) : null, to.zone);
      else rt.space(space).teleport(e, { zone: to.zone, at: to.at !== undefined ? structuredClone(to.at) : undefined }, rt);
      if (to.facing !== undefined && e.components.body) e.components.body.facing = to.facing;
      if (e.components.body?.vel) e.components.body.vel = e.components.body.vel.map(() => 0);
      delete e.components.moveTo;
      s.cool[e.id] = rt.state.frame + frames(p.cooldownSec);
      s.used[id] = (s.used[id] || 0) + 1;
      rt.emitTyped('portal_used', id, { who: e.id, portal: id, from: fromSpace, to: space, transition: p.transition, reverse });
      rt.run(p.do, { self: e.id, portal: id });
    };
    const use = (id, e, { force = false, reverse = false } = {}) => {
      const p = byId[id]; if (!p || !e) return false;
      const u = force ? { ok: true } : usable(id, e, { reverse });
      if (!u.ok) {
        if (u.reason === 'gate' && rt.hasService('gates')) rt.service('gates').allows(`portal:${id}`, { who: e.id }); // emits gate_blocked with the gate's hint
        rt.emit('blocked', { who: e.id, portal: id, reason: u.reason });
        rt.emitTyped('portal_locked', id, { who: e.id, portal: id, reason: u.reason, text: p.lockedText });
        return false;
      }
      if (p.key && p.consumeKey) rt.run([{ do: 'take_item', item: p.key, ...(e.id !== 'player' ? { who: e.id } : {}) }], { self: e.id });
      const delay = frames(p.delaySec ?? TRANSITION_SEC[p.transition]);
      rt.emit('portal_start', { who: e.id, portal: id, transition: p.transition, seconds: delay / 60 });
      if (delay > 0) { st().transit[e.id] = { portal: id, due: rt.state.frame + delay, reverse }; return true; }
      arrive(id, e, reverse); return true;
    };
    /** Portals whose `from` (or `to`, for two-way) region `e` is in now, nearest-defined first. */
    const reachable = e => {
      const out = [];
      for (const p of config.portals) {
        if (inReach(p, e, false)) out.push({ id: p.id, reverse: false });
        else if (!p.oneWay && inReach(p, e, true)) out.push({ id: p.id, reverse: true });
      }
      return out;
    };
    rt.provide('portals', { use, usable, reachable, list: () => config.portals.map(p => ({ id: p.id, prompt: p.prompt, from: p.from, to: p.to })), inTransit: e => Boolean(st().transit[e?.id]) });
    rt.action('use_portal', (value, rt) => {
      const e = rt.player(); if (!e) return;
      if (typeof value === 'string') { const r = reachable(e).find(x => x.id === value); if (r) use(value, e, { reverse: r.reverse }); else rt.emit('blocked', { who: e.id, portal: value, reason: 'out_of_reach' }); return; }
      const r = reachable(e)[0]; if (r) use(r.id, e, { reverse: r.reverse });
    });
    rt.system('interaction', rt => {
      const s = st(), f = rt.state.frame;
      // Travellers in transit arrive when due; until then they do not move.
      for (const [who, t] of Object.entries(s.transit)) {
        const e = rt.entity(who); if (!e) { delete s.transit[who]; continue; }
        if (e.components.body?.vel) e.components.body.vel = e.components.body.vel.map(() => 0);
        if (t.due <= f) { delete s.transit[who]; arrive(t.portal, e, t.reverse); }
      }
      // Prompts and touch triggers.
      const touchers = config.portals.some(p => p.trigger === 'touch' && p.who === 'any') ? Object.values(rt.state.entities) : [rt.player()].filter(Boolean);
      for (const e of touchers) {
        const here = reachable(e), ids = here.map(x => x.id);
        if (e.id === 'player') { for (const x of here) if (!s.near[x.id]) rt.emit('portal_near', { portal: x.id, prompt: byId[x.id].prompt, usable: usable(x.id, e, x).ok }); s.near = Object.fromEntries(ids.map(i => [i, true])); }
        const before = s.touching[e.id] || [];
        for (const x of here) {
          const p = byId[x.id];
          if (p.trigger !== 'touch' || before.includes(x.id) || (p.who === 'player' && e.id !== 'player')) continue;
          use(x.id, e, { reverse: x.reverse });
        }
        if (ids.length) s.touching[e.id] = ids; else delete s.touching[e.id];
      }
    }, ID);
    // Solver options: what a person does, pressing use_portal (its key sends a press, which uses the first portal in
    // reach): offered when that portal is usable. Getting to a portal is the movement's (its declared travel, or the
    // move axis), never a macro no control issues.
    rt.options(rt => {
      const e = rt.player(); if (!e) return [];
      const x = reachable(e)[0];
      return x && usable(x.id, e, x).ok ? [{ label: `use portal ${x.id}${x.reverse ? ' (back)' : ''}`, actions: { use_portal: true } }] : [];
    });
  },
};
