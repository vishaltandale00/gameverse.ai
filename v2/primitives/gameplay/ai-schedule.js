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

import { checkParam } from '../../kernel/params.js';

const ID = 'gameplay.ai.schedule';
const st = rt => rt.store(ID);

export const SLOT = {
  from: { type: 'number', min: 0, max: 24, required: true, effect: 'hour the slot starts' }, to: { type: 'number', min: 0, max: 24, required: true, effect: 'hour it ends (a slot may wrap past midnight)' },
  zone: { type: 'ref', to: 'zone', effect: 'where the NPC goes' }, at: { type: 'list', of: { type: 'number' }, min: 2, max: 3, effect: 'the spot it goes to (a 2D point on a 3D surface is ground x, z)' },
  doing: { type: 'string', effect: 'the activity token the doing predicate reads' }, space: { type: 'ref', to: 'space', effect: 'the space of the place (default the NPC\'s)' },
};
/** A routine: the slots of a day. */
const ROUTINE = { type: 'list', of: { type: 'object', fields: SLOT }, effect: 'daily routine slots by hour' };
/** The kind examples' document fragment: the character a set_schedule names. */
const BAKER = { plot: { characters: [{ id: 'baker', name: 'Bea' }] } };

/** Index of the slot covering hour h (wrap-around slots like 22→6 included), or -1. */
export function slotAt(schedule, h) {
  return schedule.findIndex(s => (s.from <= s.to ? h >= s.from && h < s.to : h >= s.from || h < s.to));
}
/** A slot's `at` point: 2 elements on a 3D surface space mean ground (x, z). */
export function toPoint(api, at) {
  if (at.length === 2 && can(api, 'groundAt') && api.kind !== 'test') return r6([at[0], api.groundAt(at[0], at[1]).y, at[1]]);
  return r6(v3(at));
}

export default {
  id: ID,
  card: {
    loop: { verbs: [], progress: ['departed', 'arrived'] },
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
    data: { 'plot.characters': { type: 'list', of: { type: 'object', open: true, fields: { schedule: ROUTINE } } } },
    rules: {
      schedule_place: { fields: ['plot.characters[].schedule[].at', 'plot.characters[].schedule[].zone'], message: 'a slot names its place: at or zone' },
      schedule_overlap: { fields: ['plot.characters[].schedule[].from', 'plot.characters[].schedule[].to'], message: 'the slots of a routine do not overlap (one slot per hour of the day)' },
    },
  },
  logic(logic) {
    logic.predicate('doing', { test: (p, rt, c) => { const e = rt.resolve(p.who ?? p.character, c); const s = e?.components.schedule; return Boolean(s && s.doing === p.doing && (p.arrived === false || s.state === 'there')); } });
    // Effects carry no declared shape the kernel checks: the check holds the routine to ROUTINE and its rules.
    logic.effect('set_schedule', { refs: e => [['character', e.character]],
      codes: [
        { code: 'schedule_place', fields: ['schedule[].at', 'schedule[].zone'], message: 'a slot names its place: at or zone', example: { doc: BAKER, example: { do: 'set_schedule', character: 'baker', schedule: [{ from: 1, to: 2 }] } } },
        { code: 'schedule_overlap', fields: ['schedule[].from', 'schedule[].to'], message: 'the slots of a routine do not overlap', example: { doc: BAKER, example: { do: 'set_schedule', character: 'baker', schedule: [{ from: 1, to: 5, at: [0, 0] }, { from: 2, to: 3, at: [0, 0] }] } } },
      ],
      check: (e, path, errs, ctx) => { const p = `${path}.schedule`, list = e.schedule ?? []; checkParam(ROUTINE, list, p, errs, ctx); routineRules(list, p, errs); },
      run: (e, rt) => { (st(rt).overrides ??= {})[e.character] = e.schedule ?? null; const ent = rt.entity(e.character); if (ent?.components.schedule && !Array.isArray(ent.components.schedule)) { ent.components.schedule.slot = -2; if (e.schedule) ent.components.schedule.routine = structuredClone(e.schedule); } rt.emit('schedule_changed', { who: e.character }); } });
  },
  validate(config, doc, ctx) {
    const errors = [];
    (doc.plot?.characters || []).forEach((c, i) => {
      if (c?.schedule === undefined) return;
      const path = `plot.characters[${i}].schedule`;
      // The routine's shape is its declaration (card.data plot.characters), which preflight enforces.
      routineRules(c.schedule, path, errors);
    });
    return errors;
  },
  install(rt, config) {
    ensureLocomotion(rt);
    rt.system('ai', rt => tick(rt, config), ID);
  },
};

/** The cross-slot rules of a routine (its shape is ROUTINE): every slot has a place, no two slots overlap. */
function routineRules(list, path, errors) {
  if (!Array.isArray(list)) return;
  list.forEach((s, j) => { if (s && typeof s === 'object' && s.at == null && s.zone == null) errors.push({ code: 'schedule_place', path: `${path}[${j}]`, message: 'a slot needs at or zone' }); });
  // Overlapping slots make the routine ambiguous.
  for (let h = 0; h < 24; h += 0.5) { const hits = list.filter(s => s && Number.isFinite(s.from) && (s.from <= s.to ? h >= s.from && h < s.to : h >= s.from || h < s.to)); if (hits.length > 1) { errors.push({ code: 'schedule_overlap', path, message: `slots overlap at hour ${h}` }); break; } }
}

const hourOf = (rt, config) => { const v = rt.state.vars[config.hourVar]; return Number.isFinite(v) ? v : (config.startHour + rt.state.time / config.hourLength) % 24; };

function offscreen(rt, config, e) {
  const p = rt.player(); if (!p) return true;
  return p.space !== e.space || distBetween(rt, e, p) > config.viewDistance;
}

/**
 * Entities with routines: any entity whose `schedule` component holds one (plot.character
 * seeds it as the routine list; this primitive keeps it under `routine`), plus document
 * characters whose entity exists. set_schedule overrides win.
 */
function routines(rt) {
  const ov = st(rt).overrides || {}, out = new Map();
  for (const e of Object.values(rt.state.entities)) {
    const c = e.components.schedule; if (!c) continue;
    if (Array.isArray(c)) e.components.schedule = { routine: c, slot: -2 };
    else if (!Array.isArray(c.routine)) continue;
    out.set(e.id, e.components.schedule.routine);
  }
  for (const ch of rt.doc.plot?.characters || []) if (Array.isArray(ch.schedule) && rt.entity(ch.id) && !out.has(ch.id)) out.set(ch.id, ch.schedule);
  for (const [id, r] of Object.entries(ov)) if (rt.entity(id)) out.set(id, r);
  return out;
}

function tick(rt, config) {
  const h = hourOf(rt, config);
  for (const [id, routine] of routines(rt)) {
    const e = rt.entity(id); if (!e || dead(e) || !Array.isArray(routine) || !routine.length) continue;
    const c = e.components, i = slotAt(routine, h);
    if (!c.schedule || c.schedule.slot !== i) {
      const prev = c.schedule;
      if (prev && prev.slot >= 0) rt.emitTyped('departed', id, { who: id, doing: prev.doing ?? null });
      const keep = Array.isArray(prev?.routine) ? { routine: prev.routine } : {};
      if (i < 0) { c.schedule = { ...keep, slot: -1, doing: null, at: null, zone: null, state: 'free' }; continue; }
      const s = routine[i], sp = s.space ?? e.space, api = rt.spaces().includes(sp) ? rt.space(sp) : null;
      const at = s.at !== undefined ? toPoint(api, s.at) : (continuous(e) ? zonePoint(rt, sp, s.zone) : s.zone);
      c.schedule = { ...keep, slot: i, doing: s.doing ?? null, at: at ?? null, zone: s.zone ?? null, space: sp, state: 'travel', since: round6(rt.state.time) };
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
