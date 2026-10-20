// Hazards: damage volumes, falls and kill planes. A hazard type
// ({ id, damage, dps, status, respawn, kill }) is applied to an entity that
// touches any of its sources:
//   - static `volumes` [{ type, at, size }] in this instance;
//   - entities with a `hazard` component ("type" | { type }), using their body box;
//   - zones tagged `hazard:<type>` (or zone.rules.hazard = type);
//   - cells whose content.blocks entry has `hazard: type` (editCells spaces);
//   - the kill plane `killY`, a rising camera window (`window`) and the space's
//     `bounds` capability (moving scroll windows), plus the space events
//     out_of_bounds / scrolled_out.
// Entry applies `damage`, `status`, `kill` and, for instant hazards, returns the
// entity to its last safe footing or its checkpoint; staying applies `dps` in
// `interval` chunks. Falls deal (drop - minHeight) × perMeter on landing.
import { runIf, boxAt, boxOf, boxesTouch, center, isVec, api as spaceApi, pos, cellPoint, anchor as anchorOf } from './items-lib.js';
import { respawn as toCheckpoint } from './checkpoint.js';

const KEY = 'gameplay.hazard';
const RESPAWN = ['checkpoint', 'nearest-safe', 'none'];

export default {
  id: 'gameplay.hazard',
  card: {
    intent: 'Damage volumes and falls (spikes, lava, acid, drowning, fall damage, kill planes, a rising camera kill line or the space bounds): typed hazards with entry damage, damage over time, statuses, kills and respawn to safe footing or the checkpoint.',
    views: ['any'],
    params: {
      types: { type: 'list', default: [], of: { type: 'object', fields: {
        id: { type: 'string', required: true },
        damage: { type: 'number', default: 0, min: 0, effect: 'damage on entry' },
        dps: { type: 'number', default: 0, min: 0, unit: 'hp/s', effect: 'damage per second while inside' },
        damageType: { type: 'string', effect: 'damage type passed to damage (default the hazard id)' },
        status: { type: 'string', effect: 'status applied on entry (apply_status)' },
        statusSec: { type: 'number', min: 0, unit: 's' },
        kill: { type: 'boolean', default: false, effect: 'entry kills (kill effect)' },
        respawn: { type: 'string', default: 'none', options: RESPAWN, effect: 'where an instant hazard (damage or kill on entry) returns the entity' },
        points: { type: 'number', default: 0, effect: 'score change on entry (negative for penalties)' },
        fx: { type: 'effects', default: [], effect: 'effects on entry (self = the entity hit)' },
      } }, effect: 'hazard types' },
      volumes: { type: 'list', default: [], of: { type: 'object', fields: { type: { type: 'string', required: true }, at: { type: 'json', required: true }, size: { type: 'json', default: [1, 1, 1] }, space: { type: 'ref', to: 'space' } } }, effect: 'static hazard boxes' },
      affects: { type: 'string', default: 'health', options: ['player', 'health', 'all'], effect: 'who hazards apply to: the player, entities with health (and the player), or every entity with a body' },
      interval: { type: 'number', default: 0.5, min: 0.0167, max: 10, unit: 's', effect: 'damage-over-time tick' },
      fallDamage: { type: 'object', default: { minHeight: 0, perMeter: 0 }, fields: { minHeight: { type: 'number', default: 0, min: 0 }, perMeter: { type: 'number', default: 0, min: 0 }, type: { type: 'string', default: 'fall' } }, effect: 'landing damage; perMeter 0 disables' },
      killY: { type: 'number', effect: 'entities whose centre falls below this y touch hazard killType' },
      killType: { type: 'string', default: '', effect: "hazard type for killY, window and bounds exits ('' = kill without a type)" },
      window: { type: 'object', default: { margin: 0 }, fields: { margin: { type: 'number', default: 0, min: 0, effect: 'rising camera: dying this far below the highest point reached; 0 disables' }, axis: { type: 'integer', default: 1, min: 0, max: 2 } }, effect: 'rising camera kill line (vertical climbers)' },
      bounds: { type: 'boolean', default: true, effect: 'leaving the space bounds() window (if the space has the bounds capability) or its out_of_bounds/scrolled_out events counts as killType' },
      boundsMargin: { type: 'number', default: 0, min: 0, effect: 'how far outside bounds() an entity may be' },
    },
    provides: { events: ['hazard_hit', 'hazard_hit:*', 'hazard_exit', 'fell', 'hazard_killed'] },
    requires: { capabilities: ['position'] },
    reads: ['content.blocks', 'content.archetypes'],
  },
  validate(config, doc, ctx) {
    const errors = [], ids = new Set(config.types.map(t => t.id));
    const known = t => !t || ids.has(t);
    for (const v of config.volumes) if (!known(v.type)) errors.push({ code: 'hazard_unknown', message: `volume uses unknown hazard type '${v.type}'` });
    if (config.killType && !known(config.killType)) errors.push({ code: 'hazard_unknown', message: `killType '${config.killType}' is not a hazard type` });
    (doc.content?.archetypes || []).forEach((a, i) => { const h = a.components?.hazard; const t = typeof h === 'string' ? h : h?.type; if (h != null && !known(t)) errors.push({ code: 'hazard_unknown', path: `content.archetypes[${i}].components.hazard`, message: `unknown hazard type '${t}'` }); });
    (doc.content?.blocks || []).forEach((b, i) => { if (b.hazard != null && !known(b.hazard)) errors.push({ code: 'hazard_unknown', path: `content.blocks[${i}].hazard`, message: `unknown hazard type '${b.hazard}'` }); });
    return errors;
  },
  install(rt, config, instance) {
    const types = new Map(config.types.map(t => [t.id, t]));
    const KILL = '$kill';
    const st = () => { const s = rt.store(KEY); s.in ??= {}; s.acc ??= {}; s.safe ??= {}; s.air ??= {}; s.cam ??= {}; s.pending ??= {}; return s; };
    st(); // created at install, so reads later never add state
    // Blocks name their hazard with `hazard: type`, or carry the tag 'hazard' and share a hazard type's id.
    const blocks = () => { if (rt.caches.hazardBlocksDoc !== rt.doc) { rt.caches.hazardBlocksDoc = rt.doc; rt.caches.hazardBlocks = new Map((rt.doc.content?.blocks || []).map(b => [b.id, b.hazard ?? ((b.tags || []).includes('hazard') && types.has(b.id) ? b.id : null)]).filter(([, t]) => t)); } return rt.caches.hazardBlocks; };
    const zoneDef = e => rt.doc.spaces.find(s => s.id === e.space)?.zones?.find(z => z.id === e.zone);
    const affected = e => !e.components.health?.dead && (config.affects === 'all' ? Boolean(e.components.body) || e.id === 'player' : config.affects === 'player' ? e.id === 'player' : e.id === 'player' || 'health' in e.components);
    const grounded = e => { if (e.components.body?.grounded != null) return e.components.body.grounded; const s = spaceApi(rt, e); if (!s || typeof s.grounded !== 'function') return true; if (typeof s.gravityAt === 'function' && !s.gravityAt(pos(rt, e)).some(Boolean)) return true; return s.grounded(e); };

    function touching(e) {
      const out = new Set(), p = pos(rt, e);
      const z = e.zone && zoneDef(e);
      for (const tag of z?.tags || []) if (tag.startsWith('hazard:')) out.add(tag.slice(7));
      if (z?.rules?.hazard) out.add(z.rules.hazard);
      if (!isVec(p)) return out;
      const box = boxOf(rt, e), c = center(rt, e);
      for (const v of config.volumes) if ((v.space ?? rt.doc.spaces[0].id) === e.space) { const b = boxAt(rt, e.space, [...v.at, 0, 0, 0].slice(0, 3), [...v.size, 1, 1, 1].slice(0, 3)); if (boxesTouch(box, b)) out.add(v.type); }
      for (const o of Object.values(rt.state.entities)) { const h = o.components.hazard; if (h == null || o === e || o.space !== e.space || !isVec(o.at)) continue; if (boxesTouch(box, boxOf(rt, o))) out.add(typeof h === 'string' ? h : h.type); }
      const sp = spaceApi(rt, e);
      if (sp && typeof sp.getCell === 'function' && blocks().size) {
        const feet = cellPoint(rt, e).slice(); feet[1] = anchorOf(rt, e.space) === 'min' ? Math.floor(box.min[1] - 0.01) : feet[1] - (box.max[1] - box.min[1]) / 2 - 0.01;
        for (const cell of [cellPoint(rt, e), feet]) { const t = blocks().get(sp.getCell(cell)); if (t) out.add(t); }
      }
      const kt = config.killType || KILL;
      if (config.killY != null && c[1] < config.killY) out.add(kt);
      if (config.window.margin > 0 && e.id === 'player') {
        const ax = config.window.axis, s = st(); s.cam[e.id] = Math.max(s.cam[e.id] ?? c[ax], c[ax]);
        if (c[ax] < s.cam[e.id] - config.window.margin) out.add(kt);
      }
      if (config.bounds && sp && typeof sp.bounds === 'function') {
        const b = sp.bounds(), m = config.boundsMargin;
        if (b?.min && b.min.some((lo, i) => !b.wrap?.[i] && (c[i] < lo - m || c[i] > b.max[i] + m))) out.add(kt);
      }
      if (st().pending[e.id]) { out.add(kt); delete st().pending[e.id]; }
      return out;
    }

    function hit(e, id, entering) {
      const t = types.get(id) || { id, damage: 0, dps: 0, kill: id === KILL || !types.size, respawn: 'none', points: 0, fx: [] };
      if (!entering) return;
      const name = id === KILL ? 'kill' : id;
      if (t.damage > 0) runIf(rt, { do: 'damage', who: e.id, amount: t.damage, type: t.damageType ?? name }, { self: e.id });
      if (t.status) runIf(rt, { do: 'apply_status', who: e.id, status: t.status, ...(t.statusSec != null ? { sec: t.statusSec } : {}) }, { self: e.id });
      if (t.points) rt.state.vars.score = (rt.state.vars.score ?? 0) + t.points;
      rt.emitTyped('hazard_hit', name, { who: e.id, damage: t.damage, kill: Boolean(t.kill) });
      if (t.fx?.length) rt.run(t.fx, { self: e.id });
      if (!rt.entity(e.id)) return;
      if (t.kill) { if (!runIf(rt, { do: 'kill', who: e.id }, { self: e.id })) rt.emit('hazard_killed', { who: e.id, hazard: name }); }
      if ((t.damage > 0 || t.kill) && t.respawn !== 'none' && rt.entity(e.id) && rt.state.status === 'playing') {
        const safe = st().safe[e.id];
        if (t.respawn === 'checkpoint' && toCheckpoint(rt, e.id)) return;
        if (safe) { if (safe.space !== e.space) rt.moveToSpace(e, safe.space, structuredClone(safe.at)); else rt.space(e.space).setPos(e, structuredClone(safe.at), rt); if (Array.isArray(e.components.body?.vel)) e.components.body.vel = e.components.body.vel.map(() => 0); rt.emit('respawned', { who: e.id, hazard: name }); }
      }
    }

    rt.on('out_of_bounds', d => { if (config.bounds && d.who) st().pending[d.who] = true; });
    rt.on('scrolled_out', d => { if (config.bounds && d.who) st().pending[d.who] = true; });

    rt.system('physics', rt => {
      const s = st(), tick = Math.max(1, Math.round(config.interval / rt.dt));
      for (const e of Object.values(rt.state.entities)) {
        if (!affected(e) || !e.space) continue;
        const now = touching(e), before = new Set(s.in[e.id] || []);
        for (const id of [...now].sort()) {
          if (!rt.entity(e.id) || rt.state.status !== 'playing') break;
          const t = types.get(id);
          if (!before.has(id)) hit(e, id, true);
          if (t?.dps > 0 && rt.entity(e.id)) {
            const k = `${e.id}:${id}`; s.acc[k] = (s.acc[k] || 0) + 1;
            if (s.acc[k] % tick === 0) runIf(rt, { do: 'damage', who: e.id, amount: +(t.dps * tick * rt.dt).toFixed(6), type: t.damageType ?? id }, { self: e.id });
          }
        }
        for (const id of before) if (!now.has(id)) { delete s.acc[`${e.id}:${id}`]; rt.emit('hazard_exit', { who: e.id, hazard: id }); }
        if (!rt.entity(e.id)) { delete s.in[e.id]; continue; }
        // Re-read: an entry may have respawned the entity out of the hazard.
        const after = rt.entity(e.id) ? touching(e) : new Set();
        if (after.size) s.in[e.id] = [...now].sort(); else delete s.in[e.id];
        const p = pos(rt, e);
        if (!isVec(p)) continue;
        const g = grounded(e), y = center(rt, e)[1];
        if (g && !after.size) s.safe[e.id] = { space: e.space, at: structuredClone(p) };
        // Falls: track the peak while airborne, damage on landing.
        if (!g) s.air[e.id] = Math.max(s.air[e.id] ?? y, y);
        else if (s.air[e.id] != null) {
          const drop = s.air[e.id] - y; delete s.air[e.id];
          const f = config.fallDamage;
          if (f.perMeter > 0 && drop > f.minHeight) { const amount = +((drop - f.minHeight) * f.perMeter).toFixed(4); runIf(rt, { do: 'damage', who: e.id, amount, type: f.type }, { self: e.id }); rt.emit('fell', { who: e.id, height: +drop.toFixed(4), damage: amount }); }
        }
      }
    }, KEY);
    rt.provide('hazard', { at: id => [...(st().in[id] || [])], safe: id => st().safe[id] ?? null });
  },
};
