// No spatial world: card, dialogue, menu and management games. Reports no
// capabilities, so nothing that needs space can bind to it, but it still
// answers the kernel's spatial vocabulary (zone, near, teleport) over named
// slots: zones are slots such as hand, deck, table or office; e.at is the slot
// an entity is in (or null). Order within a slot is entity insertion order.
import { zoneIndex, zoneEditor, inSpace } from './spaces2d-lib.js';

export default {
  id: 'engine.space.none',
  card: {
    intent: 'No spatial state: for card, dialogue, UI and management games (or a battle screen). Entities may sit in named slots (hand, deck, table) declared as zones.',
    views: ['ui'],
    // The coordinate frame (runtime-lib-frame.js): `up` the axis pointing up (null: a plane seen from above, the viewer
    // up), `handed` whether x, y, up (or x, y, toward the viewer) is a right- or left-handed frame.
    frame: null,
    params: {},
    provides: { capabilities: [], events: ['enter_zone', 'leave_zone', 'enter_zone:*', 'leave_zone:*', 'zone_added'] },
    at: 'At = a slot (zone) id or null',
    zones: 'Zone = {id, name?, tags?} — a named slot',
    state: 'rt.state.spaces[id] = {zones?: runtime slots}; positions live on entities',
  },
  validate(config, doc) {
    const errors = [];
    (doc.spaces || []).forEach((s, i) => { if (s.use === 'engine.space.none') (s.zones || []).forEach((z, j) => { for (const k of ['rect', 'cells', 'range', 'exits']) if (k in z) errors.push({ code: 'zone_shape_unsupported', path: `spaces[${i}].zones[${j}].${k}`, message: `engine.space.none zones are named slots; '${k}' has no meaning here`, hint: 'use a spatial space, or drop the field' }); }); });
    return errors;
  },
  install(rt, config, instance) {
    const sid = instance.id, zones = zoneIndex(rt, sid);
    const move = (e, to, rt) => {
      const from = e.at ?? null; to = to ?? null;
      if (to !== null && !zones().byId.has(to)) return false;
      e.at = to; e.zone = to;
      if (from === to) return true;
      if (from !== null) rt.emitTyped('leave_zone', from, { who: e.id, zone: from });
      if (to !== null) rt.emitTyped('enter_zone', to, { who: e.id, zone: to });
      return true;
    };
    const api = {
      kind: 'none', anchor: 'slot', size: [0, 0], config,
      get zones() { return zones().byId; },
      place(e, rt) { const at = zones().byId.has(e.at) ? e.at : null; e.at = null; e.zone = null; move(e, at, rt); },
      remove(e, rt) { move(e, null, rt); },
      pos: e => e.at ?? null,
      setPos: (e, at, rt) => move(e, at, rt),
      entitiesAt: at => inSpace(rt, sid, e => e.at === at).map(e => e.id),
      inZone: (e, zone) => e.at === zone,
      zoneAt: at => (zones().byId.has(at) ? at : null),
      teleport(e, { zone, at }, rt) { move(e, zone ?? at ?? null, rt); },
      nearest(e, target, rt) { if (zones().byId.has(target)) return e.at === target ? 0 : null; return inSpace(rt, sid, o => o !== e && (o.id === target || o.archetype === target) && o.at === e.at && e.at !== null).length ? 0 : null; },
      distance: (a, b) => (a === b ? 0 : Infinity),
      // Removing a slot empties it (its entities leave to no slot); moving a slot only edits its fields.
      ...zoneEditor(rt, sid, zones, () => null, rt => { for (const e of inSpace(rt, sid)) if (e.at != null && !zones().byId.has(e.at)) move(e, null, rt); }),
    };
    rt.defineSpace(sid, api);
  },
};
