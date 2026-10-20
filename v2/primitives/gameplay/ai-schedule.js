// gameplay.ai.schedule: daily routines. Characters' `schedule` slots
// ({from, to, zone, at, doing}) are matched against the clock (var time.hour,
// published by engine.time; a fallback clock otherwise). On a slot change the
// NPC departs for the slot's place: it walks there (the brain's `work`
// behavior, or this primitive's own intent when it has no brain), or, when
// nobody can see it, it is placed there at once ("offscreen teleport", as open
// worlds do to keep routines cheap). Arrival sets components.schedule.state
// to 'there' and the activity is readable with the `doing` predicate. Combat
// and fleeing interrupt naturally: the brain picks a higher behavior and the
// schedule waits.
import { v3, r6, round6, len, sub, spaceOf, can, continuous, distBetween, zonePoint, dead, moverOwned, ensureLocomotion } from './ai-lib.js';

const ID = 'gameplay.ai.schedule';
const st = rt => rt.store(ID);

export const SLOT = { from: { type: 'number', min: 0, max: 24, required: true }, to: { type: 'number', min: 0, max: 24, required: true }, zone: { type: 'ref', to: 'zone' }, at: { type: 'json' }, doing: { type: 'string' }, space: { type: 'ref', to: 'space' } };

/** Index of the slot covering hour h (wrap-around slots like 22→6 included), or -1. */
export function slotAt(schedule, h) {
  return schedule.findIndex(s => (s.from <= s.to ? h >= s.from && h < s.to : h >= s.from || h < s.to));
}
/** A 2-element `at` on a 3D surface space means ground (x, z); everything else passes through. */
export function toPoint(api, at) {
  if (!Array.isArray(at)) return at;
  if (at.length === 2 && can(api, 'groundAt') && api.kind !== 'test') return r6([at[0], api.groundAt(at[0], at[1]).y, at[1]]);
  return r6(v3(at));
}

export default {
  id: ID,
  card: {
    intent: 'NPC daily routines: character schedule slots by hour (zone, spot, activity); NPCs walk to each slot (through the brain `work` behavior or on their own), are placed there instantly when offscreen, report arrivals and departures, and expose the activity through the `doing` predicate; set_schedule replaces a routine.',
    views: ['any'],
    params: {
      travel: { type: 'string', default: 'walk', options: ['walk', 'teleportOffscreen'], effect: 'walk: always walk; teleportOffscreen: unseen NPCs are placed at once' },
      offscreenTeleport: { type: 'boolean', default: true, effect: 'an NPC still travelling when it goes offscreen is placed at its destination' },
      viewDistance: { type: 'number', default: 60, min: 0, effect: 'beyond this (or in another space) an NPC counts as offscreen' },
      hourVar: { type: 'string', default: 'time.hour' },
      hourLength: { type: 'number', default: 60, min: 0.01, unit: 's', effect: 'fallback clock when the hour var is absent: seconds per game hour' },
      startHour: { type: 'number', default: 8, min: 0, max: 24 },
      speed: { type: 'number', default: 1.6, min: 0, effect: 'walking speed for NPCs without an ai.speed' },
      arrive: { type: 'number', default: 0.25, min: 0, effect: 'arrival radius' },
    },
    provides: { events: ['departed', 'departed:*', 'arrived', 'arrived:*', 'schedule_changed'] },
    requires: { capabilities: ['position'] },
    reads: ['plot.characters'],
  },
  logic(logic) {
    logic.predicate('doing', { test: (p, rt, c) => { const e = rt.resolve(p.who ?? p.character, c); const s = e?.components.schedule; return Boolean(s && s.doing === p.doing && (p.arrived === false || s.state === 'there')); } });
    logic.effect('set_schedule', { refs: e => [['character', e.character]], check: (e, path, errs, ctx) => validateSchedule(e.schedule ?? [], `${path}.schedule`, errs, ctx),
      run: (e, rt) => { (st(rt).overrides ??= {})[e.character] = e.schedule ?? null; const ent = rt.entity(e.character); if (ent?.components.schedule) ent.components.schedule.slot = -2; rt.emit('schedule_changed', { who: e.character }); } });
  },
  validate(config, doc, ctx) {
    const errors = [];
    (doc.plot?.characters || []).forEach((c, i) => { if (c.schedule !== undefined) validateSchedule(c.schedule, `plot.characters[${i}].schedule`, errors, ctx, config); });
    return errors;
  },
  install(rt, config) {
    ensureLocomotion(rt);
    rt.system('ai', rt => tick(rt, config), ID);
  },
};

function validateSchedule(list, path, errors, ctx, config) {
  if (!Array.isArray(list)) { errors.push({ code: 'param_type', path, message: 'schedule must be a list of slots' }); return; }
  list.forEach((s, j) => {
    const p = `${path}[${j}]`;
    if (!s || typeof s !== 'object') { errors.push({ code: 'param_type', path: p, message: 'slot must be an object' }); return; }
    for (const k of Object.keys(s)) if (!(k in SLOT)) errors.push({ code: 'param_unknown', path: `${p}.${k}`, message: `unknown slot field '${k}'` });
    for (const k of ['from', 'to']) if (!(Number.isFinite(s[k]) && s[k] >= 0 && s[k] <= 24)) errors.push({ code: 'schedule_hour', path: `${p}.${k}`, message: `${k} must be an hour 0–24` });
    if (s.zone !== undefined && !ctx.indexes.zone?.has(s.zone)) errors.push({ code: 'ref_unknown', path: `${p}.zone`, message: `unknown zone '${s.zone}'` });
    if (s.at === undefined && s.zone === undefined) errors.push({ code: 'schedule_place', path: p, message: 'a slot needs at or zone' });
    if (s.at !== undefined && !(Array.isArray(s.at) ? s.at.every(Number.isFinite) : typeof s.at === 'string')) errors.push({ code: 'param_type', path: `${p}.at`, message: 'at must be a position or node id' });
  });
  // Overlapping slots make the routine ambiguous.
  for (let h = 0; h < 24; h += 0.5) { const hits = list.filter(s => s && Number.isFinite(s.from) && (s.from <= s.to ? h >= s.from && h < s.to : h >= s.from || h < s.to)); if (hits.length > 1) { errors.push({ code: 'schedule_overlap', path, message: `slots overlap at hour ${h}` }); break; } }
}

const hourOf = (rt, config) => { const v = rt.state.vars[config.hourVar]; return Number.isFinite(v) ? v : (config.startHour + rt.state.time / config.hourLength) % 24; };

function offscreen(rt, config, e) {
  const p = rt.player(); if (!p) return true;
  return p.space !== e.space || distBetween(rt, e, p) > config.viewDistance;
}

function tick(rt, config) {
  const h = hourOf(rt, config), ov = st(rt).overrides || {};
  for (const ch of rt.doc.plot?.characters || []) {
    const routine = ch.id in ov ? ov[ch.id] : ch.schedule;
    const e = rt.entity(ch.id); if (!e || dead(e) || !Array.isArray(routine) || !routine.length) continue;
    const c = e.components, i = slotAt(routine, h);
    if (!c.schedule || c.schedule.slot !== i) {
      const prev = c.schedule;
      if (prev && prev.slot >= 0) rt.emitTyped('departed', ch.id, { who: ch.id, doing: prev.doing ?? null });
      if (i < 0) { c.schedule = { slot: -1, doing: null, at: null, zone: null, state: 'free' }; continue; }
      const s = routine[i], sp = s.space ?? e.space, api = rt.spaces().includes(sp) ? rt.space(sp) : null;
      const at = s.at !== undefined ? toPoint(api, s.at) : (continuous(e) ? zonePoint(rt, sp, s.zone) : s.zone);
      c.schedule = { slot: i, doing: s.doing ?? null, at: at ?? null, zone: s.zone ?? null, space: sp, state: 'travel', since: round6(rt.state.time) };
      if (config.travel === 'teleportOffscreen' && offscreen(rt, config, e)) place(rt, e, c.schedule);
    }
    const s = c.schedule;
    if (s.state !== 'travel') continue;
    if (s.space && s.space !== e.space) { if (offscreen(rt, config, e) || config.offscreenTeleport) place(rt, e, s); continue; }
    const api = spaceOf(rt, e); if (!api) continue;
    const there = s.at == null ? (s.zone ? api.inZone?.(e, s.zone, rt) : true) : continuous(e) ? len(sub(v3(s.at), e.at)) <= config.arrive : e.at === s.at;
    if (there) { arrived(rt, e, s); continue; }
    if (config.offscreenTeleport && offscreen(rt, config, e)) { place(rt, e, s); continue; }
    // NPCs with a brain walk through its `work` behavior; others get their own intent.
    if (!c.ai?.brain && !moverOwned(e) && s.at != null) c.moveTo = { at: s.at, zone: null, run: false, speed: c.ai?.speed ?? config.speed, by: 'ai' };
    else if (!c.ai?.brain && moverOwned(e) && s.at != null) c.moveTo = { at: s.at, zone: s.zone, run: false, speed: config.speed, by: 'ai' };
  }
}

function place(rt, e, s) {
  if (s.space && s.space !== e.space) rt.moveToSpace(e, s.space, s.at ?? null, s.zone ?? undefined);
  else { const api = spaceOf(rt, e); if (api) api.teleport(e, { zone: s.zone ?? undefined, at: s.at ?? undefined }, rt); }
  arrived(rt, e, s, true);
}
function arrived(rt, e, s, placed = false) {
  s.state = 'there'; s.arrivedAt = round6(rt.state.time);
  if (e.components.moveTo?.by === 'ai' && !e.components.ai?.brain) delete e.components.moveTo;
  rt.emitTyped('arrived', s.zone ?? e.id, { who: e.id, doing: s.doing, zone: s.zone, placed });
}
