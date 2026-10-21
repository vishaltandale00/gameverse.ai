// Rest: sleep, wait or meditate at beds, benches and campfires. Resting skips
// time (through engine.time's skip_time when present, else the time.hour /
// time.day vars), heals, refills pools, can reset ambient enemies and saves.
// Entities with a `rest` component (true | { hours?, skipTo?, heal? }) rest the
// player when used through gameplay.interact; the `rest` effect does it from plot.
import { restoreAll, runIf, whoKey, hostile, dist } from './items-lib.js';

const KEY = 'gameplay.rest';

export default {
  id: 'gameplay.rest',
  card: {
    loop: { verbs: [], progress: ['rested'] },
    intent: 'Sleep/rest/wait at beds, benches and campfires (entities with a `rest` component, or the rest effect): skip time to a named hour, heal, refill resources, optionally respawn enemies and save; can require no hostiles nearby.',
    views: ['any'],
    params: {
      healFull: { type: 'boolean', default: true, effect: 'resting heals fully and refills resource pools; false heals healPerHour × hours' },
      healPerHour: { type: 'number', default: 0, min: 0, max: 10000, unit: 'hp/h', effect: 'healing per hour slept when healFull is false' },
      skipTo: { type: 'string', default: '', effect: "named time to wake at (a key of `times`); '' uses `hours`" },
      hours: { type: 'number', default: 8, min: 0, max: 240, unit: 'h', effect: 'hours slept when no skipTo applies' },
      times: { type: 'object', open: true, default: { dawn: 6, morning: 8, noon: 12, dusk: 18, evening: 19, night: 21, midnight: 0 }, fields: {}, effect: 'named wake times → hour of day' },
      safeRequired: { type: 'boolean', default: false, effect: 'refuse to rest while a hostile is within safeRadius' },
      safeRadius: { type: 'number', default: 12, min: 0, max: 500, unit: 'space units', effect: 'radius checked for hostiles (archetype kind enemy|boss or components.hostile)' },
      respawnsEnemies: { type: 'boolean', default: false, effect: 'resting emits respawn_enemies for spawners' },
      save: { type: 'boolean', default: true, effect: 'resting runs save_game when engine.save registers it' },
    },
    provides: { events: ['rested', 'rest_denied', 'respawn_enemies'] },
    requires: { capabilities: ['position'] },
    reads: ['content.archetypes'],
  },
  validate(config, doc, ctx, inst = {}) {
    const P = inst.path ? `${inst.path}.with` : undefined; // errors about this instance point at its `with`
    const errors = [];
    if (config.skipTo && !(config.skipTo in config.times)) errors.push({ code: 'rest_invalid', path: P, message: `with.skipTo '${config.skipTo}' is not a key of times`, hint: Object.keys(config.times).join(', ') });
    for (const [k, h] of Object.entries(config.times)) if (!(Number.isFinite(h) && h >= 0 && h < 24)) errors.push({ code: 'rest_invalid', path: P, message: `with.times.${k}: hours must be in [0, 24)` });
    return errors;
  },
  logic(logic) {
    logic.effect('rest', {
      check: (e, path, errors) => { if (e.hours !== undefined && !(Number.isFinite(e.hours) && e.hours >= 0)) errors.push({ code: 'effect_invalid', path: `${path}.hours`, message: 'hours must be a non-negative number' }); },
      run: (e, rt, c) => rt.caches.restRun?.(whoKey(e.who, c), { hours: e.hours, skipTo: e.skipTo, force: true }),
    });
  },
  install(rt, config) {
    function hoursFor(skipTo, hours) {
      if (hours != null) return hours;
      const name = skipTo ?? config.skipTo;
      if (name && name in config.times) { const now = rt.state.vars['time.hour'] ?? 0, d = ((config.times[name] - now) % 24 + 24) % 24; return d || 24; }
      return config.hours;
    }
    function rest(who, { hours, skipTo, heal, force = false, at = null } = {}) {
      const actor = rt.entity(who);
      if (config.safeRequired && actor && !force) {
        const near = Object.values(rt.state.entities).find(e => e !== actor && hostile(rt, e) && dist(rt, actor, e) <= config.safeRadius);
        if (near) { rt.emit('rest_denied', { who, reason: 'unsafe', by: near.id }); return false; }
      }
      const h = hoursFor(skipTo, hours);
      if (!runIf(rt, { do: 'skip_time', hours: h })) {
        const v = rt.state.vars, total = (v['time.hour'] ?? 0) + h;
        v['time.hour'] = +(total % 24).toFixed(4); v['time.day'] = (v['time.day'] ?? 0) + Math.floor(total / 24);
      }
      if (heal ?? config.healFull) restoreAll(rt, who);
      else if (config.healPerHour) runIf(rt, { do: 'heal', who, amount: config.healPerHour * h });
      if (config.respawnsEnemies) rt.emit('respawn_enemies', { reason: 'rest' });
      if (config.save) runIf(rt, { do: 'save_game' });
      const s = rt.store(KEY); s.count = (s.count || 0) + 1; s.last = rt.state.frame;
      rt.emit('rested', { who, hours: h, at });
      return true;
    }
    rt.caches.restRun = rest;
    rt.on('interacted', d => {
      const t = rt.entity(d.target), c = t?.components.rest; if (!c) return;
      const o = typeof c === 'object' ? c : {};
      rest(d.who, { hours: o.hours, skipTo: o.skipTo, heal: o.heal, at: t.id });
    });
  },
};
