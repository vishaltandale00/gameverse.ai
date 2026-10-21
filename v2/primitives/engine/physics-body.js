// Collision layers and contacts for bodies in any space with `overlap`.
// Each entity with components.body (layer, size, sensor?, solid?) is checked
// against the space's overlap query; pairs whose layers collide per the
// matrix produce `collide` once when contact begins and `separate` when it
// ends (typed collide:<other archetype>). Solid, non-sensor pairs can be
// pushed apart along the axis of least penetration through the space's
// slide (so walls still win). The `bodies` service answers layer questions
// for other primitives (projectiles, pickups, hazards).
import { isVec, boxOf, boxShape, BODY } from './runtime-lib.js';

const ID = 'engine.physics.body';

export default {
  id: ID,
  card: {
    intent: 'Collision layers, a layer collision matrix and contact events (collide / separate) for every body, plus optional push-apart of solid bodies. Other primitives ask it whether two layers collide and what an entity touches.',
    views: ['any'],
    params: {
      layers: { type: 'list', of: { type: 'string' }, min: 1, default: ['default', 'player', 'npc', 'enemy', 'prop', 'projectile', 'pickup'], effect: 'layer names; body.layer picks one (player defaults to "player" when listed)' },
      matrix: { type: 'list', default: [], of: { type: 'object', fields: { a: { type: 'string', required: true }, b: { type: 'string', required: true }, collide: { type: 'boolean', required: true } } }, effect: 'overrides of the default (every pair collides)' },
      friction: { type: 'number', default: 0.5, min: 0, max: 2, effect: 'default surface friction for bodies (read by rigid bodies)' },
      restitution: { type: 'number', default: 0, min: 0, max: 1, effect: 'default bounciness for bodies (read by rigid bodies)' },
      separate: { type: 'boolean', default: false, effect: 'push overlapping solid bodies apart' },
      maxBodies: { type: 'integer', default: 400, min: 1, max: 20000, effect: 'bodies checked per step (in id order)' },
    },
    provides: { events: ['collide', 'collide:*', 'separate'], services: ['bodies'] },
    requires: { capabilities: ['overlap'] },
    components: { body: BODY },
    rules: {
      body_layer_duplicate: { fields: ['layers'], message: 'layer names are distinct' },
      body_layer_unknown: { fields: ['matrix[].a', 'matrix[].b', 'content.archetypes[].components.body.layer'], message: 'matrix pairs and archetype body layers name layers of layers' },
    },
  },
  logic(logic) {
    // {touching: archetype|id, who?}: the subject is in contact with it now.
    logic.predicate('touching', { test: (p, rt, c) => { const e = rt.resolve(p.who, c); return Boolean(e) && rt.service('bodies').contacts(e.id).some(id => id === p.touching || rt.entity(id)?.archetype === p.touching); } });
  },
  validate(config, doc) {
    const errors = [], layers = new Set(config.layers);
    if (layers.size !== config.layers.length) errors.push({ code: 'body_layer_duplicate', path: 'layers', message: 'duplicate layer names' });
    config.matrix.forEach((m, i) => { for (const k of ['a', 'b']) if (!layers.has(m[k])) errors.push({ code: 'body_layer_unknown', path: `matrix[${i}].${k}`, message: `unknown layer '${m[k]}'`, hint: `layers: ${config.layers.join(', ')}` }); });
    (doc.content?.archetypes || []).forEach((a, i) => { const l = a.components?.body?.layer; if (l !== undefined && !layers.has(l)) errors.push({ code: 'body_layer_unknown', path: `content.archetypes[${i}].components.body.layer`, message: `unknown layer '${l}'` }); });
    return errors;
  },
  install(rt, config) {
    const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const rules = new Map(config.matrix.map(m => [pairKey(m.a, m.b), m.collide]));
    const collides = (a, b) => rules.get(pairKey(a, b)) ?? true;
    const layerOf = e => e.components.body?.layer ?? (e.id === 'player' && config.layers.includes('player') ? 'player' : config.layers.includes('default') ? 'default' : config.layers[0]);
    const st = () => { const s = rt.store(ID); s.contacts ??= []; return s; };
    const isBody = e => e.components.body && !e.components.ghost && e.space && isVec(e.at);
    const api = {
      collides, layerOf, layers: () => config.layers.slice(),
      contacts: id => st().contacts.filter(k => k.split('|').includes(id)).map(k => k.split('|').find(x => x !== id)),
      /** Entities overlapping `shape` in `space` whose layer collides with `layer`. */
      query(space, shape, layer = null) { return rt.space(space).overlap(shape, e => isBody(e) && (layer === null || collides(layer, layerOf(e)))); },
      material: e => ({ friction: e.components.body?.friction ?? config.friction, restitution: e.components.body?.restitution ?? config.restitution }),
    };
    rt.provide('bodies', api);
    rt.system('physics', rt => {
      const s = st(), now = new Set();
      const list = Object.values(rt.state.entities).filter(isBody).sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, config.maxBodies);
      const ids = new Set(list.map(e => e.id));
      for (const e of list) {
        const sp = rt.space(e.space); if (!sp.overlap) continue;
        const la = layerOf(e);
        const shape = boxShape(sp, e);
        for (const id of sp.overlap(shape, o => o.id !== e.id && ids.has(o.id))) {
          if (id < e.id && now.has(pairKey(id, e.id))) continue;
          const o = rt.entity(id), lb = layerOf(o);
          if (!collides(la, lb)) continue;
          now.add(pairKey(e.id, id));
        }
      }
      const before = new Set(s.contacts);
      for (const k of [...now].sort()) if (!before.has(k)) {
        const [a, b] = k.split('|'), ea = rt.entity(a), eb = rt.entity(b);
        rt.emitTyped('collide', eb.archetype, { who: a, other: b, layer: layerOf(ea), otherLayer: layerOf(eb) });
        rt.emitTyped('collide', ea.archetype, { who: b, other: a, layer: layerOf(eb), otherLayer: layerOf(ea) });
      }
      for (const k of before) if (!now.has(k)) { const [a, b] = k.split('|'); rt.emit('separate', { who: a, other: b }); }
      s.contacts = [...now].sort();
      if (!config.separate) return;
      // Push solid pairs apart along the axis of least penetration, split by mass (static bodies do not move).
      for (const k of s.contacts) {
        const [ea, eb] = k.split('|').map(id => rt.entity(id));
        if (!ea || !eb || ea.space !== eb.space) continue;
        const A = ea.components.body, Bb = eb.components.body;
        if (A.sensor || Bb.sensor || A.solid === false || Bb.solid === false) continue;
        const sp = rt.space(ea.space), ba = boxOf(sp, ea), bb = boxOf(sp, eb);
        let axis = -1, pen = Infinity;
        for (let i = 0; i < Math.min(ea.at.length, 3); i++) { const p = Math.min(ba.max[i], bb.max[i]) - Math.max(ba.min[i], bb.min[i]); if (p > 0 && p < pen) { pen = p; axis = i; } }
        if (axis < 0) continue;
        const ia = A.static ? 0 : 1 / (A.mass ?? 1), ib = Bb.static ? 0 : 1 / (Bb.mass ?? 1); if (!ia && !ib) continue;
        const dir = (ba.min[axis] + ba.max[axis]) < (bb.min[axis] + bb.max[axis]) ? -1 : 1;
        const push = (e, share, sign) => { if (!share || !sp.slide) return; const d = e.at.map(() => 0); d[axis] = sign * pen * share; sp.slide(e, d, rt); };
        push(ea, ia / (ia + ib), dir); push(eb, ib / (ia + ib), -dir);
      }
    }, ID);
  },
};
