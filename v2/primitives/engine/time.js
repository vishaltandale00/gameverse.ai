// World clock: game hours advance at 24/dayLength per simulated second
// (times `scale`), giving hour, day, weekday, season and year vars, named
// day phases with events, and timers whose effects run when they finish.
// The clock and timers stop while `pauseWhen` holds (menus, cutscenes,
// hit-stop). Everything lives in rt.store('engine.time') as JSON.
import { compare } from '../../kernel/logic.js';
import { frames, round, SLUG, checkFx, uniqueIds } from './runtime-lib.js';

const ID = 'engine.time';
const DAY_MIN = 24 * 60;

/** Phase (name) at hour h: the last phase whose start hour is <= h, wrapping past midnight. */
export function phaseAt(phases, h) {
  const list = Object.entries(phases).sort((a, b) => a[1] - b[1]);
  if (!list.length) return null;
  let out = list[list.length - 1][0];
  for (const [name, start] of list) if (h >= start) out = name;
  return out;
}
const inWindow = (h, [from, to]) => (from <= to ? h >= from && h < to : h >= from || h < to);

export default {
  id: ID,
  card: {
    intent: 'World clock and calendar: hours, days, weekdays, seasons and years advance as the game runs; named day phases (dawn, day, dusk, night...) fire events; timers count down and run effects. The clock pauses while a predicate holds.',
    views: ['any'],
    params: {
      dayLength: { type: 'number', default: 1200, min: 1, max: 86400, unit: 's', effect: 'real seconds per 24-hour game day at scale 1' },
      startHour: { type: 'number', default: 8, min: 0, max: 24, unit: 'h', effect: 'clock hour when the game starts' },
      startDay: { type: 'integer', default: 1, min: 0, effect: 'number of the first day (var time.day)' },
      scale: { type: 'number', default: 1, min: 0, max: 60, effect: 'clock speed multiplier; 0 freezes the clock (timers still run)' },
      phases: { type: 'object', open: true, default: { dawn: 5, day: 7, dusk: 18, night: 20 }, effect: 'phase name -> start hour; each start fires the event <phase> and phase:<phase>',
        fields: { dawn: { type: 'number', min: 0, max: 24 }, day: { type: 'number', min: 0, max: 24 }, dusk: { type: 'number', min: 0, max: 24 }, night: { type: 'number', min: 0, max: 24 } } },
      daysPerSeason: { type: 'integer', default: 10, min: 1, max: 365, effect: 'days in each season' },
      seasons: { type: 'list', of: { type: 'string' }, default: ['spring', 'summer', 'autumn', 'winter'], min: 1, max: 12, effect: 'season names in order; a year is seasons x daysPerSeason days' },
      weekdays: { type: 'list', of: { type: 'string' }, default: [], max: 14, effect: 'optional weekday names (var time.weekday)' },
      pauseWhen: { type: 'predicate', effect: 'while it holds, the clock and pausable timers stop (menus, dialogue, cutscenes)' },
      timers: { type: 'list', default: [], effect: 'named timers; start them with start_timer or autostart',
        of: { type: 'object', fields: {
          id: { type: 'string', required: true }, seconds: { type: 'number', required: true, min: 0, unit: 's', effect: 'duration' },
          autostart: { type: 'boolean', default: false }, repeat: { type: 'boolean', default: false, effect: 'restart when done' },
          clock: { type: 'string', options: ['sim', 'game'], default: 'sim', effect: 'sim: real seconds; game: game minutes (follows scale)' },
          pausable: { type: 'boolean', default: true, effect: 'stops while pauseWhen holds' },
          do: { type: 'effects', default: [], effect: 'run when the timer finishes' },
        } } },
    },
    provides: {
      events: ['dawn', 'day', 'dusk', 'night', 'phase', 'phase:*', 'new_day', 'midnight', 'season_change', 'season_change:*', 'new_year', 'time_skipped', 'timer', 'timer:*', 'timer_started', 'timer_cancelled', 'timer_unknown'],
      vars: ['time.hour', 'time.minute', 'time.day', 'time.weekday', 'time.season', 'time.season_index', 'time.year', 'time.phase', 'time.paused', 'time.scale'],
      services: ['clock'],
    },
    requires: {},
    defines: [{ kind: 'timer', in: 'timers' }],
  },
  logic(logic) {
    // {daytime: 'night'} phase name, or {daytime: [fromHour, toHour]} window (wraps midnight).
    logic.predicate('daytime', {
      check: (p, path, errors) => { if (!(typeof p.daytime === 'string' || (Array.isArray(p.daytime) && p.daytime.length === 2 && p.daytime.every(Number.isFinite)))) errors.push({ code: 'time_daytime_invalid', path, message: 'daytime is a phase name or [fromHour, toHour]' }); },
      test: (p, rt) => { const v = rt.state.vars; return Array.isArray(p.daytime) ? inWindow(v['time.hour'] ?? 0, p.daytime) : v['time.phase'] === p.daytime; },
    });
    // {timer: id, state?: running|done|cancelled|idle} or {timer: id, lte: 3} (seconds left).
    logic.predicate('timer', {
      check: (p, path, errors) => { if (typeof p.timer !== 'string') errors.push({ code: 'time_timer_invalid', path, message: 'timer needs a timer id' }); if (p.state && !['running', 'done', 'cancelled', 'idle'].includes(p.state)) errors.push({ code: 'time_timer_invalid', path, message: `unknown timer state '${p.state}'` }); },
      test: (p, rt) => {
        const t = rt.store(ID).timers?.[p.timer];
        if (['gte', 'lte', 'gt', 'lt', 'eq', 'ne'].some(k => p[k] !== undefined)) return t?.state === 'running' && compare(rt.service('clock').left(p.timer), p);
        return (t?.state ?? 'idle') === (p.state ?? 'running');
      },
    });
    const num = (k, path, e, errors) => { if (e[k] !== undefined && !Number.isFinite(e[k])) errors.push({ code: 'time_effect_invalid', path, message: `${k} must be a number` }); };
    logic.effect('set_time', { check: (e, path, errors) => { num('hour', path, e, errors); num('day', path, e, errors); if (e.hour === undefined && e.day === undefined) errors.push({ code: 'time_effect_invalid', path, message: 'set_time needs hour and/or day' }); }, run: (e, rt) => rt.service('clock').set(e) }); // {hour, day?, back?}
    logic.effect('skip_time', { check: (e, path, errors) => { num('hours', path, e, errors); num('minutes', path, e, errors); if (!(e.hours > 0 || e.minutes > 0)) errors.push({ code: 'time_effect_invalid', path, message: 'skip_time needs hours or minutes > 0' }); }, run: (e, rt) => rt.service('clock').skip((e.hours || 0) * 60 + (e.minutes || 0)) });
    logic.effect('set_time_scale', { check: (e, path, errors) => { if (!(e.scale >= 0)) errors.push({ code: 'time_effect_invalid', path, message: 'scale must be >= 0' }); }, run: (e, rt) => { rt.store(ID).scale = e.scale; } });
    logic.effect('start_timer', {
      refs: e => (e.seconds === undefined ? [['timer', e.timer]] : []),
      check: (e, path, errors, ctx) => { if (typeof e.timer !== 'string' || !SLUG.test(e.timer)) errors.push({ code: 'time_effect_invalid', path, message: 'start_timer needs a timer slug' }); num('seconds', path, e, errors); if (e.then) checkFx(e.then, `${path}.then`, errors, ctx); },
      run: (e, rt) => rt.service('clock').start(e.timer, e),
    });
    logic.effect('cancel_timer', { check: (e, path, errors) => { if (typeof e.timer !== 'string') errors.push({ code: 'time_effect_invalid', path, message: 'cancel_timer needs a timer id' }); }, run: (e, rt) => rt.service('clock').cancel(e.timer) });
  },
  validate(config) {
    const errors = [];
    const hours = Object.values(config.phases || {});
    if (!hours.length) errors.push({ code: 'time_phases_invalid', path: 'phases', message: 'at least one phase is needed' });
    if (new Set(hours).size !== hours.length) errors.push({ code: 'time_phases_invalid', path: 'phases', message: 'two phases start at the same hour' });
    for (const [k, v] of Object.entries(config.phases || {})) if (!(Number.isFinite(v) && v >= 0 && v < 24)) errors.push({ code: 'time_phases_invalid', path: `phases.${k}`, message: 'phase start must be an hour in [0, 24)' });
    uniqueIds(config.timers, 'timers', 'time_timer_duplicate', errors);
    (config.timers || []).forEach((t, i) => { if (!SLUG.test(t.id || '')) errors.push({ code: 'id_invalid', path: `timers[${i}].id`, message: 'timer id must be a slug' }); });
    if (new Set(config.seasons).size !== config.seasons.length) errors.push({ code: 'time_seasons_invalid', path: 'seasons', message: 'season names must be unique' });
    return errors;
  },
  install(rt, config) {
    const perFrameMin = () => (DAY_MIN / config.dayLength) / 60; // game minutes per frame at scale 1
    const yearDays = config.seasons.length * config.daysPerSeason;
    const st = () => {
      const s = rt.store(ID);
      if (s.minutes === undefined) { s.minutes = config.startHour * 60; s.scale = config.scale; s.timers = {}; s.phase = null; s.paused = false; }
      return s;
    };
    const defs = () => Object.fromEntries((config.timers || []).map(t => [t.id, t]));
    // Calendar from absolute game minutes (minutes since day `startDay` 00:00).
    const calendar = m => {
      const dayIndex = Math.floor(m / DAY_MIN), hour = (m - dayIndex * DAY_MIN) / 60, inYear = ((dayIndex % yearDays) + yearDays) % yearDays;
      const seasonIndex = Math.floor(inYear / config.daysPerSeason);
      return { dayIndex, hour, day: config.startDay + dayIndex, seasonIndex, season: config.seasons[seasonIndex], year: 1 + Math.floor(dayIndex / yearDays), phase: phaseAt(config.phases, hour) };
    };
    const publish = s => {
      const c = calendar(s.minutes), v = rt.state.vars;
      v['time.hour'] = round(c.hour); v['time.minute'] = Math.floor((c.hour % 1) * 60); v['time.day'] = c.day; v['time.season'] = c.season; v['time.season_index'] = c.seasonIndex;
      v['time.year'] = c.year; v['time.phase'] = c.phase; v['time.paused'] = s.paused; v['time.scale'] = s.scale;
      if (config.weekdays.length) v['time.weekday'] = config.weekdays[((c.dayIndex % config.weekdays.length) + config.weekdays.length) % config.weekdays.length];
      return c;
    };
    // Advance the clock by `dm` game minutes, emitting each day/season/year crossed (bounded) and the phase change.
    const advance = (s, dm) => {
      const before = calendar(s.minutes);
      s.minutes = round(s.minutes + dm, 1e6);
      const after = publish(s);
      const days = Math.min(after.dayIndex - before.dayIndex, 366);
      for (let d = 1; d <= days; d++) {
        const c = calendar((before.dayIndex + d) * DAY_MIN);
        rt.emit('midnight', { day: c.day }); rt.emit('new_day', { day: c.day });
        if (c.seasonIndex !== calendar((before.dayIndex + d - 1) * DAY_MIN).seasonIndex) {
          rt.emitTyped('season_change', c.season, { season: c.season, index: c.seasonIndex });
          if (c.seasonIndex === 0) rt.emit('new_year', { year: c.year });
        }
      }
      if (after.phase !== s.phase) { const from = s.phase; s.phase = after.phase; if (from !== null || dm === 0) { rt.emitTyped('phase', after.phase, { from }); rt.emit(after.phase, { from }); } }
    };
    const finish = (s, id, t) => {
      t.state = 'done'; t.left = 0;
      rt.emitTyped('timer', id, { timer: id });
      const effects = t.do || defs()[id]?.do || [];
      if (t.repeat) { t.state = 'running'; t.left = t.total; t.runs = (t.runs || 0) + 1; }
      rt.run(effects, { timer: id });
    };
    const clock = {
      get: () => calendar(st().minutes),
      minutes: () => st().minutes,
      /** Set the clock. With only an hour it moves forward to the next such hour (sleeping until 6 means tomorrow's 6);
       *  with a day it goes to that day; back: true jumps backwards without crossing events. */
      set({ hour, day, back = false }) {
        const s = st(), c = calendar(s.minutes);
        const dayIndex = day !== undefined ? day - config.startDay : c.dayIndex;
        let target = dayIndex * DAY_MIN + (hour ?? c.hour) * 60;
        if (day === undefined && !back && target < s.minutes) target += DAY_MIN;
        // Forward crosses days like skipping; backwards just jumps.
        if (target >= s.minutes) advance(s, target - s.minutes); else { s.minutes = target; const a = publish(s); if (a.phase !== s.phase) { const from = s.phase; s.phase = a.phase; rt.emitTyped('phase', a.phase, { from }); rt.emit(a.phase, { from }); } }
      },
      skip(minutes) { const s = st(); advance(s, minutes); rt.emit('time_skipped', { minutes, hours: round(minutes / 60) }); },
      start(id, e = {}) {
        const s = st(), def = defs()[id] || {}, seconds = e.seconds ?? def.seconds;
        if (!Number.isFinite(seconds)) { rt.emit('timer_unknown', { timer: id }); return false; }
        if (s.timers[id]?.state === 'running' && e.restart === false) return false;
        const clockKind = e.clock ?? def.clock ?? 'sim';
        const total = clockKind === 'game' ? seconds : frames(seconds); // game timers count game minutes
        s.timers[id] = { state: 'running', left: total, total, clock: clockKind, repeat: e.repeat ?? def.repeat ?? false, pausable: e.pausable ?? def.pausable ?? true, ...(e.then ? { do: e.then } : {}) };
        rt.emit('timer_started', { timer: id, seconds });
        return true;
      },
      cancel(id) { const t = st().timers[id]; if (t?.state === 'running') { t.state = 'cancelled'; rt.emit('timer_cancelled', { timer: id }); } },
      left(id) { const t = st().timers[id]; return t?.state === 'running' ? (t.clock === 'game' ? t.left : t.left / 60) : 0; },
      paused: () => st().paused,
    };
    rt.provide('clock', clock);
    rt.system('input', rt => {
      const s = st();
      if (!s.started) { s.started = true; if (s.phase === null) advance(s, 0); for (const t of config.timers) if (t.autostart && !s.timers[t.id]) clock.start(t.id); }
      s.paused = config.pauseWhen ? rt.test(config.pauseWhen) : false;
      const dm = s.paused ? 0 : perFrameMin() * s.scale;
      if (dm) advance(s, dm); else publish(s);
      for (const [id, t] of Object.entries(s.timers)) {
        if (t.state !== 'running' || (s.paused && t.pausable)) continue;
        t.left = round(t.left - (t.clock === 'game' ? dm : 1), 1e6);
        rt.state.vars[`timer.${id}`] = round(t.clock === 'game' ? Math.max(0, t.left) : Math.max(0, t.left) / 60, 100);
        if (t.left <= 0) finish(s, id, t);
        if (rt.state.status !== 'playing') return;
      }
    }, ID);
  },
};

