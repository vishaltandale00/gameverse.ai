// Zones as gameplay: discovery, per-zone rules and effects, and dynamic
// zones opened and closed at runtime. Static zones come from spaces[].zones
// (the space emits enter_zone / leave_zone and answers the kernel `zone`
// predicate); this primitive tracks the player's current zone, discovers
// zones on entry or within discoverRadius, applies each zone's `rules` as
// vars (zone.rule.<key>) while inside, and runs onEnter/onLeave/onDiscover
// effects. Dynamic zones are regions ({at, size|r} or {zone}) whose
// membership this primitive computes through the space's overlap/distance
// capabilities; they emit the same enter_zone / leave_zone events.
import { frames, inRegion, checkFx, uniqueIds, isVec } from './runtime-lib.js';

const ID = 'engine.zones';
const effectsField = { type: 'effects', default: [] };

export default {
  id: ID,
  card: {
    intent: 'Named regions with gameplay: discovery (on entry or within a radius), per-zone rules exposed as vars while inside (safe, music, light...), enter/leave/discover effects, and dynamic zones that can be opened, moved and closed at runtime (bonus areas, storm circles, temporary arenas).',
    views: ['any'],
    params: {
      discoverRadius: { type: 'number', default: 0, min: 0, unit: 'space units', effect: 'zones within this distance of the player are discovered; 0 = on entry only' },
      checkSec: { type: 'number', default: 0.25, min: 0, max: 5, unit: 's', effect: 'how often radius discovery and dynamic membership are checked (0 = every step)' },
      rulesDefault: { type: 'object', open: true, default: {}, effect: 'rule values outside any zone that sets them (var zone.rule.<key>)' },
      rules: { type: 'list', default: [], effect: 'effects per zone (static or dynamic)',
        of: { type: 'object', fields: {
          zone: { type: 'string', required: true, effect: 'static zone or dynamic zone id' }, who: { type: 'string', options: ['player', 'any'], default: 'player' },
          onEnter: effectsField, onLeave: effectsField, onDiscover: effectsField,
          while: effectsField, everySec: { type: 'number', default: 1, min: 0.05, unit: 's', effect: 'period of `while` effects' },
          when: { type: 'predicate', effect: 'rule applies only while it holds' },
        } } },
      dynamic: { type: 'list', default: [], effect: 'zones created by this primitive',
        of: { type: 'object', fields: {
          id: { type: 'string', required: true }, name: { type: 'string' }, space: { type: 'ref', to: 'space' },
          at: { type: 'json', effect: 'centre in the space\'s coordinates' }, size: { type: 'json', effect: 'box size (with at)' }, r: { type: 'number', min: 0, effect: 'radius (with at)' },
          zone: { type: 'ref', to: 'zone', effect: 'cover a static zone instead of a shape' },
          open: { type: 'boolean', default: true, effect: 'open at start' }, lifetimeSec: { type: 'number', min: 0, effect: 'closes this long after opening' },
          rules: { type: 'object', open: true, default: {}, effect: 'rule vars while inside' }, tags: { type: 'list', of: { type: 'string' }, default: [] },
        } } },
      trackAll: { type: 'boolean', default: false, effect: 'also track dynamic-zone membership for non-player entities (costlier)' },
    },
    provides: { events: ['discovered', 'discovered:*', 'enter_zone', 'enter_zone:*', 'leave_zone', 'zone_opened', 'zone_opened:*', 'zone_closed', 'zone_closed:*'], vars: ['zone.current', 'zone.previous', 'zones.discovered', 'zone.rule.*', 'zone.dynamic'] },
    requires: { capabilities: ['position'] },
    defines: [{ kind: 'zone', in: 'dynamic' }, { kind: 'region', in: 'dynamic' }],
  },
  logic(logic) {
    logic.predicate('discovered', { refs: p => [['zone', p.discovered]], test: (p, rt) => Boolean(rt.store(ID).discovered?.[p.discovered]) });
    // {region: id, who?}: inside an open dynamic zone.
    logic.predicate('region', { refs: p => [['region', p.region]], test: (p, rt, c) => { const e = rt.resolve(p.who, c); return Boolean(e && rt.store(ID).inside?.[e.id]?.includes(p.region)); } });
    logic.predicate('region_open', { refs: p => [['region', p.region_open]], test: (p, rt) => Boolean(rt.store(ID).dyn?.[p.region_open]?.open) });
    logic.effect('discover', { refs: e => [['zone', e.zone]], run: (e, rt, c) => rt.service('zones').discover(e.zone, rt.resolve(e.who, c)?.id ?? 'player') });
    const region = (e, path, errors) => { if (typeof e.zone !== 'string') errors.push({ code: 'zone_effect_invalid', path, message: `${e.do} needs a dynamic zone id` }); };
    logic.effect('open_zone', { refs: e => [['region', e.zone]], check: region, run: (e, rt) => rt.service('zones').open(e.zone, e) });
    logic.effect('close_zone', { refs: e => [['region', e.zone]], check: region, run: (e, rt) => rt.service('zones').close(e.zone) });
    logic.effect('move_zone', { refs: e => [['region', e.zone]], check: (e, path, errors) => { region(e, path, errors); if (e.at === undefined && !e.follow) errors.push({ code: 'zone_effect_invalid', path, message: 'move_zone needs at or follow' }); }, run: (e, rt, c) => rt.service('zones').move(e.zone, e.follow ? rt.resolve(e.follow, c)?.at : e.at) });
  },
  validate(config, doc, ctx) {
    const errors = [], statics = new Set((doc.spaces || []).flatMap(s => (s.zones || []).map(z => z.id)));
    const dyn = uniqueIds(config.dynamic, 'dynamic', 'zone_dynamic_duplicate', errors);
    config.dynamic.forEach((d, i) => {
      if (statics.has(d.id)) errors.push({ code: 'zone_dynamic_duplicate', path: `dynamic[${i}].id`, message: `dynamic zone '${d.id}' reuses a static zone id` });
      if (d.zone === undefined && (d.at === undefined || (d.size === undefined && d.r === undefined && isVec(d.at)))) errors.push({ code: 'zone_dynamic_shape', path: `dynamic[${i}]`, message: 'a dynamic zone needs at with size or r, or a zone' });
      if (d.size !== undefined && !isVec(d.size)) errors.push({ code: 'zone_dynamic_shape', path: `dynamic[${i}].size`, message: 'size must be a vector' });
    });
    config.rules.forEach((r, i) => {
      if (!statics.has(r.zone) && !dyn.has(r.zone)) errors.push({ code: 'ref_unknown', path: `rules[${i}].zone`, message: `unknown zone '${r.zone}'` });
    });
    (doc.spaces || []).forEach((s, i) => (s.zones || []).forEach((z, j) => { if (z.rules !== undefined && (typeof z.rules !== 'object' || Array.isArray(z.rules))) errors.push({ code: 'zone_rules_invalid', path: `spaces[${i}].zones[${j}].rules`, message: 'zone rules must be an object of name -> value' }); }));
    return errors;
  },
  install(rt, config) {
    const period = Math.max(1, frames(config.checkSec));
    const st = () => { const s = rt.store(ID); s.discovered ??= {}; s.inside ??= {}; s.dyn ??= Object.fromEntries(config.dynamic.map(d => [d.id, { open: false, at: d.at ?? null, size: d.size ?? null, r: d.r ?? null, until: null }])); s.timers ??= {}; return s; };
    const dynDef = id => config.dynamic.find(d => d.id === id);
    const rulesFor = (zone, who) => config.rules.filter(r => r.zone === zone && (r.who === 'any' || who === 'player') && (!r.when || rt.test(r.when, { self: who, zone })));
    const zoneRules = id => { for (const s of rt.doc.spaces || []) { const z = (s.zones || []).find(x => x.id === id); if (z) return z.rules || {}; } return dynDef(id)?.rules || {}; };
    // Rule vars: rulesDefault, then the static zone's rules, then dynamic zones the player is in (in definition order).
    const publishRules = () => {
      const s = st(), v = rt.state.vars, p = rt.player();
      const merged = { ...config.rulesDefault, ...(v['zone.current'] ? zoneRules(v['zone.current']) : {}) };
      for (const id of s.inside.player || []) Object.assign(merged, zoneRules(id));
      for (const k of Object.keys(v)) if (k.startsWith('zone.rule.') && !(k.slice(10) in merged)) delete v[k];
      for (const [k, val] of Object.entries(merged)) v[`zone.rule.${k}`] = val;
      v['zone.dynamic'] = (s.inside[p?.id] || [])[0] ?? null;
    };
    const discover = (zone, who = 'player') => {
      const s = st(); if (s.discovered[zone]) return false;
      s.discovered[zone] = rt.state.frame + 1; rt.state.vars['zones.discovered'] = Object.keys(s.discovered).length;
      rt.emitTyped('discovered', zone, { who, zone });
      for (const r of rulesFor(zone, who)) rt.run(r.onDiscover, { self: who, zone });
      return true;
    };
    const entered = (who, zone, dynamic) => {
      if (who === 'player') { const v = rt.state.vars; if (!dynamic) { v['zone.previous'] = v['zone.current'] ?? null; v['zone.current'] = zone; } discover(zone, who); }
      for (const r of rulesFor(zone, who)) rt.run(r.onEnter, { self: who, zone });
      if (who === 'player') publishRules();
    };
    const left = (who, zone, dynamic) => {
      if (who === 'player' && !dynamic && rt.state.vars['zone.current'] === zone) { rt.state.vars['zone.previous'] = zone; rt.state.vars['zone.current'] = rt.player()?.zone ?? null; }
      for (const r of rulesFor(zone, who)) rt.run(r.onLeave, { self: who, zone });
      if (who === 'player') publishRules();
    };
    // Space zone events (static zones). Events we emit ourselves carry dynamic:true and are skipped here.
    rt.on('enter_zone', (e, rt) => { if (!e.dynamic && e.zone && e.who) entered(e.who, e.zone, false); });
    rt.on('leave_zone', (e, rt) => { if (!e.dynamic && e.zone && e.who) left(e.who, e.zone, false); });
    const api = {
      discover, discovered: id => Boolean(st().discovered[id]), current: () => rt.state.vars['zone.current'] ?? null,
      open(id, { at, size, r, lifetimeSec } = {}) {
        const d = st().dyn[id]; if (!d) return false;
        if (at !== undefined) d.at = at; if (size !== undefined) d.size = size; if (r !== undefined) d.r = r;
        const life = lifetimeSec ?? dynDef(id)?.lifetimeSec;
        d.until = life ? rt.state.frame + frames(life) : null;
        if (!d.open) { d.open = true; rt.emitTyped('zone_opened', id, { zone: id, at: d.at }); }
        return true;
      },
      close(id) {
        const s = st(), d = s.dyn[id]; if (!d?.open) return false;
        d.open = false; d.until = null;
        for (const [who, list] of Object.entries(s.inside)) if (list.includes(id)) { s.inside[who] = list.filter(x => x !== id); rt.emit('leave_zone', { who, zone: id, dynamic: true }); left(who, id, true); }
        rt.emitTyped('zone_closed', id, { zone: id });
        return true;
      },
      move(id, at) { const d = st().dyn[id]; if (d && at !== undefined) d.at = structuredClone(at); },
      inside: (id, who = 'player') => (st().inside[who] || []).includes(id),
      regions: () => Object.entries(st().dyn).filter(([, d]) => d.open).map(([id, d]) => ({ id, ...d })),
    };
    rt.provide('zones', api);
    rt.system('interaction', rt => {
      const s = st();
      if (!s.started) { s.started = true; for (const d of config.dynamic) if (d.open) api.open(d.id); publishRules(); }
      // Expiring dynamic zones.
      for (const [id, d] of Object.entries(s.dyn)) if (d.open && d.until !== null && rt.state.frame >= d.until) api.close(id);
      // Periodic `while` effects for entities inside zones.
      for (const [i, r] of config.rules.entries()) {
        if (!r.while.length) continue;
        const who = r.who === 'any' ? Object.keys(rt.state.entities) : ['player'];
        for (const id of who) {
          const e = rt.entity(id); if (!e) continue;
          const inside = e.zone === r.zone || (s.inside[id] || []).includes(r.zone);
          const key = `${i}:${id}`;
          if (!inside || (r.when && !rt.test(r.when, { self: id, zone: r.zone }))) { delete s.timers[key]; continue; }
          s.timers[key] = (s.timers[key] ?? 0) + 1;
          if (s.timers[key] >= frames(r.everySec)) { s.timers[key] = 0; rt.run(r.while, { self: id, zone: r.zone }); }
        }
      }
      if (rt.state.frame % period) return;
      const p = rt.player();
      // Radius discovery of static zones in the player's space.
      if (config.discoverRadius > 0 && p?.space) {
        const sp = rt.doc.spaces.find(x => x.id === p.space), api_ = rt.space(p.space);
        for (const z of sp?.zones || []) if (!s.discovered[z.id]) { const d = api_.nearest?.(p, z.id, rt); if (d !== null && d !== undefined && d <= config.discoverRadius) discover(z.id, 'player'); }
      }
      // Dynamic membership.
      const open = Object.entries(s.dyn).filter(([, d]) => d.open);
      const who = config.trackAll ? Object.values(rt.state.entities) : (p ? [p] : []);
      for (const e of who) {
        const before = s.inside[e.id] || [], now = [];
        for (const [id, d] of open) {
          const def = dynDef(id);
          const region = def.zone && d.at === null ? { zone: def.zone, space: def.space } : { at: d.at, size: d.size ?? undefined, r: d.r ?? undefined, space: def.space };
          if (inRegion(rt, e, region)) now.push(id);
        }
        for (const id of now) if (!before.includes(id)) { s.inside[e.id] = [...(s.inside[e.id] || []), id]; rt.emitTyped('enter_zone', id, { who: e.id, zone: id, dynamic: true }); entered(e.id, id, true); }
        for (const id of before) if (!now.includes(id)) { s.inside[e.id] = (s.inside[e.id] || []).filter(x => x !== id); rt.emit('leave_zone', { who: e.id, zone: id, dynamic: true }); left(e.id, id, true); }
        if (!s.inside[e.id]?.length) delete s.inside[e.id];
      }
    }, ID);
  },
};
