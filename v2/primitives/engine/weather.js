// Weather as a weighted state machine. Each state lasts a rolled number of
// minutes, then the next one is drawn from its `next` weights (or the global
// weights), filtered to states allowed in the player's biome and season and
// by their `when` predicate. Changes ramp var weather.intensity over
// transitionSec so renderers and gameplay can blend. change_weather forces
// (and optionally locks) a state.
import { frames, round, uniqueIds } from './runtime-lib.js';

const ID = 'engine.weather';

export default {
  id: ID,
  card: {
    intent: 'Weather that changes over time between weighted states (clear, rain, storm, snow...), optionally per biome and season, publishing wind, temperature and intensity vars; effects can force or lock a state.',
    views: ['any'],
    params: {
      states: { type: 'list', min: 1, default: [{ id: 'clear', weight: 1 }], effect: 'weather states',
        of: { type: 'object', fields: {
          id: { type: 'string', required: true }, weight: { type: 'number', default: 1, min: 0 },
          minMin: { type: 'number', default: 3, min: 0.05, unit: 'min', effect: 'shortest duration' }, maxMin: { type: 'number', default: 8, min: 0.05, unit: 'min', effect: 'longest duration' },
          wind: { type: 'number', default: 0, min: 0, max: 1 }, temp: { type: 'number', default: 15, unit: '°C' },
          biomes: { type: 'list', of: { type: 'string' }, effect: 'only in these biomes (with byBiome)' },
          seasons: { type: 'list', of: { type: 'string' }, effect: 'only in these seasons (engine.time var time.season)' },
          when: { type: 'predicate', effect: 'only while it holds' },
          next: { type: 'object', open: true, effect: 'state id -> weight for the following state (Markov chain); default: global weights' },
          vars: { type: 'object', open: true, effect: 'extra vars weather.<key> while active (e.g. visibility, wetness)' },
        } } },
      initial: { type: 'string', effect: 'starting state (default: the first allowed state)' },
      byBiome: { type: 'boolean', default: false, effect: 'filter states by the biome under the player (service biomeAt)' },
      transitionSec: { type: 'number', default: 8, min: 0, max: 120, unit: 's', effect: 'weather.intensity ramps 0 -> 1 over this after a change' },
      season: { type: 'string', effect: 'season override when engine.time is absent' },
    },
    provides: { events: ['weather_changed', 'weather:*', 'weather_unknown'], vars: ['weather', 'weather.wind', 'weather.temp', 'weather.intensity', 'weather.previous', 'weather.*'] },
    requires: {},
  },
  logic(logic) {
    logic.predicate('weather', { test: (p, rt) => (Array.isArray(p.weather) ? p.weather.includes(rt.state.vars.weather) : rt.state.vars.weather === p.weather) });
    logic.effect('change_weather', {
      check: (e, path, errors) => { if (typeof e.weather !== 'string') errors.push({ code: 'weather_effect_invalid', path, message: 'change_weather needs a weather state id' }); if (e.minutes !== undefined && !(e.minutes > 0)) errors.push({ code: 'weather_effect_invalid', path, message: 'minutes must be > 0' }); },
      run: (e, rt) => rt.service('weather').set(e.weather, { lock: e.lock, minutes: e.minutes }),
    });
    logic.effect('unlock_weather', { run: (e, rt) => { rt.store(ID).locked = false; } });
  },
  validate(config) {
    const errors = [], ids = uniqueIds(config.states, 'states', 'weather_state_duplicate', errors);
    config.states.forEach((s, i) => {
      if (s.minMin > s.maxMin) errors.push({ code: 'weather_duration', path: `states[${i}]`, message: `minMin ${s.minMin} > maxMin ${s.maxMin}` });
      for (const k of Object.keys(s.next || {})) if (!ids.has(k)) errors.push({ code: 'weather_unknown', path: `states[${i}].next.${k}`, message: `unknown weather state '${k}'` });
    });
    if (config.initial && !ids.has(config.initial)) errors.push({ code: 'weather_unknown', path: 'initial', message: `unknown weather state '${config.initial}'` });
    if (!config.states.some(s => s.weight > 0)) errors.push({ code: 'weather_weights', path: 'states', message: 'at least one state needs weight > 0' });
    return errors;
  },
  install(rt, config) {
    const byId = Object.fromEntries(config.states.map(s => [s.id, s]));
    const biome = () => {
      if (!config.byBiome || !rt.hasService('biomeAt')) return null;
      const p = rt.player(); if (!p || !Array.isArray(p.at)) return null;
      try { const b = rt.service('biomeAt'); const at = p.at; return (typeof b === 'function' ? b : b.at)(at[0], at.length >= 3 ? at[2] : at[1], p.space); } catch { return null; }
    };
    const allowed = s => {
      if (config.byBiome && s.biomes?.length) { const b = biome(); if (b !== null && !s.biomes.includes(b)) return false; }
      const season = rt.state.vars['time.season'] ?? config.season;
      if (s.seasons?.length && season !== undefined && !s.seasons.includes(season)) return false;
      return !s.when || rt.test(s.when);
    };
    const draw = from => {
      const weights = from?.next ? Object.entries(from.next).map(([id, w]) => [byId[id], w]) : config.states.map(s => [s, s.weight]);
      let list = weights.filter(([s, w]) => s && w > 0 && allowed(s));
      if (!list.length) list = config.states.filter(s => s.weight > 0 && allowed(s)).map(s => [s, s.weight]);
      if (!list.length) return from || config.states[0];
      let r = rt.random() * list.reduce((a, [, w]) => a + w, 0);
      for (const [s, w] of list) { r -= w; if (r < 0) return s; }
      return list[list.length - 1][0];
    };
    const duration = s => frames(60 * (s.minMin + rt.random() * (s.maxMin - s.minMin)));
    const apply = (s, next, minutes) => {
      const from = s.current; s.current = next.id; s.left = minutes ? frames(minutes * 60) : duration(next); s.ramp = 0;
      const v = rt.state.vars;
      for (const k of Object.keys(byId[from]?.vars || {})) delete v[`weather.${k}`];
      v.weather = next.id; v['weather.previous'] = from ?? null; v['weather.wind'] = next.wind; v['weather.temp'] = next.temp;
      for (const [k, val] of Object.entries(next.vars || {})) v[`weather.${k}`] = val;
      if (from !== undefined && from !== next.id) rt.emitTyped('weather', next.id, { from, to: next.id });
      if (from !== next.id) rt.emit('weather_changed', { from: from ?? null, to: next.id });
    };
    const st = () => rt.store(ID);
    rt.provide('weather', {
      current: () => st().current ?? null,
      set(id, { lock = false, minutes } = {}) { if (!byId[id]) { rt.emit('weather_unknown', { weather: id }); return false; } const s = st(); apply(s, byId[id], minutes); s.locked = Boolean(lock); return true; },
    });
    rt.system('rules', rt => {
      const s = st();
      if (s.current === undefined) { apply(s, config.initial ? byId[config.initial] : draw(null)); return; }
      s.ramp = Math.min(1, s.ramp + (config.transitionSec ? 1 / frames(config.transitionSec) : 1));
      rt.state.vars['weather.intensity'] = round(s.ramp, 1000);
      if (s.locked) return;
      if (--s.left <= 0 || !allowed(byId[s.current])) apply(s, draw(byId[s.current]));
    }, ID);
  },
};
