// Locations and connections as a graph: adventure, narrative, board and
// management games, world maps, or the "macro" layer above other spaces.
// Zones are nodes; exits are edges, optionally gated by a predicate.
import { ZONE_FIELDS } from './runtime-lib.js';
/** The fields of a place (a graph zone) beyond the kernel's { id, name }: its exits name zones and may be gated by a predicate. */
const PLACE = {
  description: { type: 'string', display: true, effect: 'what a person reads about the place' }, tags: ZONE_FIELDS.tags,
  exits: { type: 'list', of: { type: 'object', fields: { to: { type: 'ref', to: 'zone', required: true }, gate: { type: 'predicate', effect: 'the exit is open while it holds' } } } },
};

/** A rule example: the story's town (its places kept, the lamp room given one more exit) beside another space. */
const TOWN = [['harbour', 'Harbour', ['town', 'water'], ['inn', 'chapel', 'cliffs']], ['inn', 'Inn', ['town', 'indoors'], ['harbour']], ['chapel', 'Chapel', ['town', 'indoors'], ['harbour']], ['cliffs', 'Cliff path', ['wild'], ['harbour', 'tower']], ['tower', 'Lighthouse', ['indoors'], ['cliffs', 'lamp_room']], ['lamp_room', 'Lamp room', ['indoors', 'high'], ['tower']]]
  .map(([id, name, tags, to]) => ({ id, name, tags, exits: to.map(t => ({ to: t })) }));
const townWith = (space, exit) => ({ doc: { spaces: [{ id: 'town', use: 'engine.space.graph', zones: TOWN.map(z => (z.id === 'lamp_room' ? { ...z, exits: [...z.exits, exit] } : z)) }, space] } });

export default {
  id: 'engine.space.graph',
  card: {
    intent: 'A world of named locations connected by exits; entities are at one location at a time. Exits can be gated by predicates (keys, flags, abilities).',
    views: ['text', 'map', 'scene-cards'],
    // The coordinate frame (runtime-lib-frame.js): `up` the axis pointing up (null: a plane seen from above, the viewer
    // up), `handed` whether x, y, up (or x, y, toward the viewer) is a right- or left-handed frame.
    frame: null,
    needs: { content: ['zones'] },
    // The fields of this space's zones (each a place): its exits name zones and may be gated by a predicate. Composition
    // renames the references they hold with the zones (planner/compose.js).
    zoneFields: { name: { type: 'string', display: true, effect: 'the name a person reads' }, ...PLACE },
    data: { zones: { type: 'list', of: { type: 'object', open: true, fields: PLACE } } },
    rules: {
      graph_exit_space: { fields: ['zones[].exits[].to'], message: "an exit leads to a zone of its own space",
        example: townWith({ id: 'cellar', use: 'engine.space.graph', zones: [{ id: 'vault', name: 'Vault', exits: [] }] }, { to: 'vault' }) },
    },
    params: {},
    provides: { capabilities: ['position', 'distance', 'navigate', 'reachable'], events: ['enter_zone', 'leave_zone', 'enter_zone:*', 'leave_zone:*', 'blocked'], actions: ['go'] },
    reads: [],
  },
  validate(config, doc, ctx) {
    const errors = [];
    doc.spaces.filter(s => s.use === 'engine.space.graph').forEach((s, i) => (s.zones || []).forEach((z, j) => (z.exits || []).forEach((x, k) => {
      const path = `spaces[${doc.spaces.indexOf(s)}].zones[${j}].exits[${k}]`;
      if (typeof x?.to === 'string' && (doc.spaces || []).some(o => o !== s && (o.zones || []).some(z2 => z2?.id === x.to)) && !(s.zones || []).some(o => o.id === x.to)) errors.push({ code: 'graph_exit_space', path: `${path}.to`, message: `exit to zone '${x.to}' of another space than '${s.id}'` });
    })));
    return errors;
  },
  install(rt, config, instance) {
    // Index zones lazily per document version so hot-loaded zones and exits appear.
    let indexed = null, zonesMap = new Map();
    const zones = () => {
      if (indexed !== rt.doc) { indexed = rt.doc; zonesMap = new Map((rt.doc.spaces.find(s => s.id === instance.id)?.zones || []).map(z => [z.id, z])); }
      return zonesMap;
    };
    const exitsFrom = id => zones().get(id)?.exits || [];
    const api = {
      kind: 'graph', anchor: 'slot', get zones() { return zones(); },
      place(entity, rt) {
        const at = zones().has(entity.at) ? entity.at : [...zones().keys()][0] ?? null;
        entity.at = null; entity.zone = null;
        if (at != null) api.move(entity, at, rt, { force: true });
      },
      remove(entity, rt) { const from = entity.at; entity.zone = null; if (from != null && zones().has(from)) rt.emitTyped('leave_zone', from, { who: entity.id, zone: from }); },
      pos: entity => entity.at,
      setPos(entity, at, rt) { api.move(entity, at, rt, { force: true }); },
      entitiesAt: at => Object.values(rt.state.entities).filter(e => e.space === instance.id && e.at === at).map(e => e.id),
      inZone: (entity, zone) => entity.at === zone,
      zoneAt: at => (zones().has(at) ? at : null),
      teleport(entity, { zone, at }, rt) { const to = zone ?? at; if (to != null) api.move(entity, to, rt, { force: true }); },
      /** Hop distance from entity to the nearest matching entity id, archetype or zone; null if none. */
      nearest(entity, target, rt) {
        if (zones().has(target)) { const d = api.distance(entity.at, target); return Number.isFinite(d) ? d : null; }
        let best = null;
        for (const e of Object.values(rt.state.entities)) if (e !== entity && e.space === instance.id && (e.id === target || e.archetype === target)) { const d = api.distance(entity.at, e.at); if (Number.isFinite(d) && (best === null || d < best)) best = d; }
        return best;
      },
      neighbors: id => exitsFrom(id).map(x => x.to),
      // Exit gates: the exit's own predicate, plus any plot gate that locks 'exit:from>to' (plot.gate's service).
      canMove(entity, to, rt, notify = false) {
        const x = exitsFrom(entity.at).find(e => e.to === to);
        if (!x || (x.gate && !rt.test(x.gate))) return false;
        return !rt.hasService('gates') || rt.service('gates').exit(entity.at, to, { who: entity.id, notify });
      },
      move(entity, to, rt, { force = false } = {}) {
        if (!zones().has(to)) return false;
        if (!force && !api.canMove(entity, to, rt, true)) { rt.emit('blocked', { who: entity.id, from: entity.at, to }); return false; }
        const from = entity.at; entity.at = to; entity.zone = to;
        if (from === to) return true;
        // Typed zone events (KERNEL_API §3) so beats and quests can wait on enter_zone:<location>.
        if (from != null) rt.emitTyped('leave_zone', from, { who: entity.id, zone: from });
        rt.emitTyped('enter_zone', to, { who: entity.id, zone: to });
        return true;
      },
      distance(a, b) { // hop count ignoring gates
        const seen = new Map([[a, 0]]), queue = [a];
        while (queue.length) { const n = queue.shift(); if (n === b) return seen.get(n); for (const m of api.neighbors(n)) if (!seen.has(m)) { seen.set(m, seen.get(n) + 1); queue.push(m); } }
        return Infinity;
      },
      /** Zones reachable from `from` given gates as they evaluate in the current state. */
      reachable(from, rt, opts = {}) {
        const seen = new Set([from]), queue = [from];
        while (queue.length) { const at = queue.shift(); for (const x of exitsFrom(at)) if (!seen.has(x.to) && (!x.gate || rt.test(x.gate)) && (!rt.hasService('gates') || rt.service('gates').exit(at, x.to, { notify: false }))) { seen.add(x.to); queue.push(x.to); } }
        return seen;
      },
      canReach: (a, b, rt, opts = {}) => api.reachable(a, rt, opts).has(b),
    };
    rt.defineSpace(instance.id, api);
    rt.action('go', (to, rt) => { const p = rt.player(); if (p?.space === instance.id) api.move(p, to, rt); });
    rt.options(rt => { const p = rt.player(); return p?.space === instance.id ? api.neighbors(p.at).map(to => ({ label: `go ${to}`, text: `Go to ${zones().get(to)?.name || to}`, actions: { go: to } })) : []; });
  },
};
