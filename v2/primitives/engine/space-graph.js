// Locations and connections as a graph: adventure, narrative, board and
// management games, world maps, or the "macro" layer above other spaces.
// Zones are nodes; exits are edges, optionally gated by a predicate.
export default {
  id: 'engine.space.graph',
  card: {
    intent: 'A world of named locations connected by exits; entities are at one location at a time. Exits can be gated by predicates (keys, flags, abilities).',
    views: ['text', 'map', 'scene-cards'],
    params: {},
    provides: { capabilities: ['position', 'distance', 'navigate', 'reachable'], events: ['enter_zone', 'leave_zone', 'blocked'] },
    reads: [],
  },
  logic(logic) {
    logic.predicate('zone', {
      refs: p => [['zone', p.zone]],
      test: (p, rt) => (rt.entity(p.who || 'player')?.at) === p.zone,
    });
    logic.effect('teleport', {
      refs: e => [['zone', e.zone]],
      run: (e, rt) => { const ent = rt.entity(e.who || 'player'); if (ent) rt.space(ent.space).move(ent, e.zone, rt, { force: true }); },
    });
  },
  validate(config, doc, ctx) {
    const errors = [];
    doc.spaces.filter(s => s.use === 'engine.space.graph').forEach((s, i) => (s.zones || []).forEach((z, j) => (z.exits || []).forEach((x, k) => {
      const path = `spaces[${doc.spaces.indexOf(s)}].zones[${j}].exits[${k}]`;
      if (!(s.zones || []).some(o => o.id === x.to)) errors.push({ code: 'ref_unknown', path: `${path}.to`, message: `exit to unknown zone '${x.to}' in space '${s.id}'` });
      if (x.gate) ctx.checkPredicate(x.gate, `${path}.gate`, errors);
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
      kind: 'graph', get zones() { return zones(); },
      place(entity) { if (entity.at == null) entity.at = [...zones().keys()][0] ?? null; },
      remove() {},
      neighbors: id => exitsFrom(id).map(x => x.to),
      canMove(entity, to, rt) { const x = exitsFrom(entity.at).find(e => e.to === to); return Boolean(x) && (!x.gate || rt.test(x.gate)); },
      move(entity, to, rt, { force = false } = {}) {
        if (!zones().has(to)) return false;
        if (!force && !api.canMove(entity, to, rt)) { rt.emit('blocked', { who: entity.id, from: entity.at, to }); return false; }
        const from = entity.at; entity.at = to;
        rt.emit('leave_zone', { who: entity.id, zone: from }); rt.emit('enter_zone', { who: entity.id, zone: to });
        return true;
      },
      distance(a, b) { // hop count ignoring gates
        const seen = new Map([[a, 0]]), queue = [a];
        while (queue.length) { const n = queue.shift(); if (n === b) return seen.get(n); for (const m of api.neighbors(n)) if (!seen.has(m)) { seen.set(m, seen.get(n) + 1); queue.push(m); } }
        return Infinity;
      },
      /** Zones reachable from `from` given gates as they evaluate in the current state. */
      reachable(from, rt) {
        const seen = new Set([from]), queue = [from];
        while (queue.length) for (const x of exitsFrom(queue.shift())) if (!seen.has(x.to) && (!x.gate || rt.test(x.gate))) { seen.add(x.to); queue.push(x.to); }
        return seen;
      },
    };
    rt.defineSpace(instance.id, api);
    rt.action('go', (to, rt) => { const p = rt.player(); if (p?.space === instance.id) api.move(p, to, rt); });
  },
};
