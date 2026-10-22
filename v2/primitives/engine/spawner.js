// Population: rules keep a rolled number of entities alive per zone (or
// point, or around a target), gated by predicates (time of day, quest
// state), biome and ground material, with per-rule, per-group and global
// caps, respawn timers, distance culling, group spawns and telegraphed
// spawns (a warning event, then the entity after a delay). A rule's
// `release` holds its spawns (components.spawner.held) and lets them go one
// at a time in spawn order by counters (events since the head was queued),
// a global counter switched on by an event, an idle timer, or a predicate:
// the arcade ghost house, waves leaving a gate, a queue at a door.
// The spawn/despawn effects place entities through the same code.
import { ENTITY_KINDS } from '../../kernel/params.js';
import { frames, rollRange, zoneDef, zoneArea, samplePoint, scatter, isVec, pick, standable as standsAt } from './runtime-lib.js';

const ID = 'engine.spawner';
/** A rule example: a document whose systems are this one instance (a fragment replacing the host's systems). */
const only = with_ => ({ doc: { systems: [{ use: ID, with: with_ }] } });

const pair = (effect, dflt) => ({ type: 'list', of: { type: 'integer', min: 0 }, min: 1, max: 2, default: dflt, effect });

export default {
  id: ID,
  card: {
    intent: 'Populates the world from rules: which archetype, where (zone, point, near a target), how many, when (predicate, time of day), with caps, respawn timers, distance culling, groups, telegraphed arrivals and queued release (spawns held in a house and let out by counters, idle time or conditions). Also provides spawn and despawn effects.',
    views: ['any'],
    params: {
      rules: { type: 'list', default: [], effect: 'population rules',
        of: { type: 'object', fields: {
          id: { type: 'string', required: true }, archetype: { type: 'ref', to: 'archetype', required: true },
          space: { type: 'ref', to: 'space', effect: 'the space to spawn in (default: the zone\'s, else the space the spawner is bound to, else the player\'s)' }, zone: { type: 'ref', to: 'zone' },
          at: { type: 'json', scale: 'world', effect: 'a point or a list of points to spawn at, in its space\'s coordinates' },
          band: { type: 'integer', min: 0, effect: 'a seat at an edge of a cell space, resolved on the world as generated when the rule first spawns: 0 the far row, 1 the near row, 2 and 3 the side columns, 4 and up the same bands further in; cells the archetype can stand in, lines from the edge inward, each from its middle out, one per spawn, never a cell another band rule of this spawner, the player or another body holds (used when no at is given)' },
          near:{ type: 'string', selects: ENTITY_KINDS, effect: 'entity id or archetype to spawn around (falls back to the zone)' },
          spread: { type: 'number', default: 0, min: 0, effect: 'scatter radius around at/near/group anchor' },
          count: pair('[min, max] alive target, rolled each time the rule activates', [1, 1]),
          per1000m2: { type: 'number', min: 0, effect: 'density; with a zone of known area the target is area x density, clamped to count' },
          when: { type: 'predicate', effect: 'rule is active only while it holds' },
          activation: { type: 'string', options: ['zone', 'always'], default: 'zone', effect: 'zone: only while the player is in the rule\'s zone' },
          respawnSec: { type: 'number', default: 60, min: 0, unit: 's', effect: 'delay before a killed entity is replaced; 0 = never (until reset_spawner)' },
          despawnDist: { type: 'number', min: 0, effect: 'cull spawns farther than this from the player; also no spawning beyond it' },
          cullWhenInactive: { type: 'boolean', default: false, effect: 'despawn this rule\'s entities when it deactivates' },
          maxAlive: { type: 'integer', min: 0, effect: 'hard cap for the rule' },
          group: { type: 'ref', to: 'spawn_group', effect: 'shared cap group (an id of groups)' },
          groupSize: pair('[min, max] spawned together around one anchor', [1, 1]),
          surface: { type: 'list', of: { type: 'ref', to: 'block' }, effect: 'only on ground of these materials (surface capability)' },
          biome: { type: 'string', effect: 'only where the biomeAt service reports this biome' },
          telegraph: { type: 'number', default: 0, min: 0, unit: 's', effect: 'emit spawn_telegraph, spawn after this delay' },
          unique: { type: 'boolean', default: false, effect: 'one named entity whose id is the rule id' },
          snap: { type: 'boolean', effect: 'put 3D spawns on the ground (surface capability); default: for sampled positions, not for explicit at' },
          components: { type: 'object', open: true, default: {}, effect: 'component overrides for spawned entities' },
          onSpawn: { type: 'effects', default: [], effect: 'run with self = the new entity' },
          release: { type: 'object', effect: 'hold spawns and release them one at a time', fields: {
            counter: { type: 'string', effect: 'event counted toward the head of the queue (e.g. item_gained:pellet)' },
            limits: { type: 'list', of: { type: 'integer', min: 0 }, default: [0], effect: 'counter needed, by spawn index (last value repeats)' },
            globalOn: { type: 'string', effect: 'event that switches to one shared counter until the queue empties' },
            globalLimits: { type: 'list', of: { type: 'integer', min: 0 }, default: [], effect: 'shared counter needed, by spawn index' },
            idleSec: { type: 'number', min: 0, unit: 's', effect: 'release the head when no counter event happened for this long' },
            when: { type: 'predicate', effect: 'release the head while it holds (self = head)' },
            onRelease: { type: 'effects', default: [], effect: 'run with self = released entity' },
          } },
        } } },
      groups: { type: 'list', default: [], of: { type: 'object', fields: { id: { type: 'string', required: true }, maxAlive: { type: 'integer', min: 0, required: true } } }, effect: 'shared caps across rules' },
      globalCap: { type: 'integer', default: 300, min: 1, max: 5000, effect: 'most spawner-managed entities alive at once' },
      intervalSec: { type: 'number', default: 0.25, min: 0, max: 10, unit: 's', effect: 'how often rules are evaluated (0 = every step)' },
      perTick: { type: 'integer', default: 8, min: 1, max: 200, effect: 'most spawns started per evaluation (spreads load)' },
    },
    provides: { events: ['spawned', 'spawned:*', 'spawn_telegraph', 'spawn_telegraph:*', 'released', 'released:*', 'culled', 'spawn_failed'], vars: ['population', 'population.*'] },
    requires: { capabilities: ['position'] },
    reads: [],
    defines: [{ kind: 'spawn_rule', in: 'rules' }, { kind: 'spawn_group', in: 'groups' }],
    rules: {
      spawn_range: { fields: ['rules[].count', 'rules[].groupSize', 'rules[].unique'], message: 'a [min, max] pair has min ≤ max; a unique rule keeps one entity (count at most 1)', example: only({ rules: [{ id: 'balls', archetype: 'ball', count: [3, 1] }] }) },
      spawn_at_invalid: { fields: ['rules[].at'], message: 'at is a point (a list of numbers), a list of points, or a location id (a string)', example: only({ rules: [{ id: 'balls', archetype: 'ball', at: true }] }) },
      spawn_release_invalid: { fields: ['rules[].release', 'rules[].telegraph'], message: 'a release has counter, globalOn, idleSec or when; globalOn comes with globalLimits; held spawns are not telegraphed', example: only({ rules: [{ id: 'balls', archetype: 'ball', release: {} }] }) },
    },
  },
  logic(logic) {
    const codes = (kind, fields, message, example) => [{ code: 'spawn_effect_invalid', fields, message, example: { do: kind, ...example } }];
    const where = (e, path, errors) => { if (e.count !== undefined && !(Number.isInteger(e.count) && e.count >= 1 && e.count <= 100)) errors.push({ code: 'spawn_effect_invalid', path, message: 'count must be an integer in [1, 100]' }); };
    logic.effect('spawn', {
      codes: codes('spawn', ['archetype', 'count'], 'spawn names an archetype; count is an integer in [1, 100]', { archetype: 'ball', count: 200 }),
      refs: e => [['archetype', e.archetype], ...(e.zone ? [['zone', e.zone]] : [])],
      check: (e, path, errors) => { if (typeof e.archetype !== 'string') errors.push({ code: 'spawn_effect_invalid', path, message: 'spawn needs an archetype' }); where(e, path, errors); },
      run: (e, rt, c) => rt.service('spawner').spawn(e, c),
    });
    logic.effect('despawn', {
      codes: codes('despawn', ['who', 'archetype', 'rule'], 'despawn names who, an archetype or a rule', {}),
      refs: e => [...(typeof e.archetype === 'string' ? [['archetype', e.archetype]] : []), ...(typeof e.rule === 'string' ? [['spawn_rule', e.rule]] : [])],
      check: (e, path, errors) => { if (e.who === undefined && e.archetype === undefined && e.rule === undefined) errors.push({ code: 'spawn_effect_invalid', path, message: 'despawn needs who, archetype or rule' }); },
      run: (e, rt, c) => rt.service('spawner').despawn(e, c),
    });
    const ruleRef = e => (typeof e.rule === 'string' ? [['spawn_rule', e.rule]] : []);
    const rule = (e, path, errors) => { if (typeof e.rule !== 'string') errors.push({ code: 'spawn_effect_invalid', path, message: `${e.do} needs a rule id` }); };
    logic.effect('reset_spawner', { codes: codes('reset_spawner', ['rule'], 'rule is a spawn rule id', {}), refs: ruleRef, check: rule, run: (e, rt) => rt.service('spawner').reset(e.rule) });
    logic.effect('rehold', { codes: codes('rehold', ['rule'], 'rule is a spawn rule id', {}), refs: ruleRef, check: rule, run: (e, rt) => rt.service('spawner').rehold(e.rule, { global: e.global }) });
    logic.effect('release', { codes: codes('release', ['rule'], 'rule is a spawn rule id', {}), refs: ruleRef, check: rule, run: (e, rt) => rt.service('spawner').release(e.rule) });
    logic.predicate('held', { test: (p, rt, c) => Boolean(rt.resolve(p.held, c)?.components.spawner?.held) });
  },
  validate(config) {
    const errors = [];
    config.rules.forEach((r, i) => {
      const path = `rules[${i}]`;
      for (const k of ['count', 'groupSize']) if (Array.isArray(r[k]) && r[k].length === 2 && r[k][0] > r[k][1]) errors.push({ code: 'spawn_range', path: `${path}.${k}`, message: `${k} min ${r[k][0]} > max ${r[k][1]}` });
      if (r.at !== undefined && !(isVec(r.at) || typeof r.at === 'string' || (Array.isArray(r.at) && r.at.every(isVec)))) errors.push({ code: 'spawn_at_invalid', path: `${path}.at`, message: 'at must be a point or a list of points' });
      if (r.unique && (r.count?.[1] ?? r.count?.[0]) > 1) errors.push({ code: 'spawn_range', path: `${path}.count`, message: 'a unique rule keeps one entity' });
      if (r.release && typeof r.release === 'object') {
        if (r.release.counter === undefined && r.release.idleSec === undefined && r.release.when === undefined && r.release.globalOn === undefined) errors.push({ code: 'spawn_release_invalid', path: `${path}.release`, message: 'release needs counter, globalOn, idleSec or when (otherwise spawns are held forever)' });
        if (r.release.globalOn && !r.release.globalLimits?.length) errors.push({ code: 'spawn_release_invalid', path: `${path}.release.globalLimits`, message: 'globalOn needs globalLimits' });
        if (r.telegraph) errors.push({ code: 'spawn_release_invalid', path: `${path}.telegraph`, message: 'held spawns cannot be telegraphed' });
      }
    });
    return errors;
  },
  install(rt, config, instance = {}) {
    const period = Math.max(1, frames(config.intervalSec));
    const rules = Object.fromEntries(config.rules.map(r => [r.id, r]));
    const st = () => { const s = rt.store(ID); s.rules ??= {}; s.pending ??= []; s.culling ??= null; return s; };
    const rs = id => (st().rules[id] ??= { alive: [], queue: [], cooling: [], active: false, target: 0, spawned: 0, counter: {}, global: null, idle: 0 });
    const alive = () => Object.values(st().rules).reduce((n, r) => n + r.alive.length, 0) + st().pending.length;
    const groupCount = g => config.rules.filter(r => r.group === g).reduce((n, r) => n + rs(r.id).alive.length + st().pending.filter(p => p.rule === r.id).length, 0);
    const publish = () => { const v = rt.state.vars; let total = 0; for (const [id, r] of Object.entries(st().rules)) { v[`population.${id}`] = r.alive.length; total += r.alive.length; } v.population = total; };
    const biomeOk = (r, at, space) => {
      if (!r.biome) return true;
      if (!rt.hasService('biomeAt') || !isVec(at)) return false;
      const b = rt.service('biomeAt'); return (typeof b === 'function' ? b : b.at)(at[0], at.length >= 3 ? at[2] : at[1], space) === r.biome;
    };
    const spaceOfRule = (r, z = r.zone ? zoneDef(rt.doc, r.zone) : null) => r.space ?? z?.space ?? instance?.space ?? rt.player()?.space ?? rt.doc.spaces[0].id;
    // Can the archetype stand at `at` (runtime-lib standable: inside a cell space, in a cell it may enter)?
    const standable = (api, space, at, archetype) => standsAt(rt, api, space, at, { archetype, components: {} });
    const rectCells = (x0, y0, x1, y1) => { const out = []; for (let y = Math.ceil(y0); y < y1; y++) for (let x = Math.ceil(x0); x < x1; x++) out.push([x, y]); return out; };
    const discCells = (c, rad) => rectCells(c[0] - rad, c[1] - rad, c[0] + rad + 1, c[1] + rad + 1).filter(q => Math.hypot(q[0] - c[0], q[1] - c[1]) <= rad);
    const zoneCells = zone => (Array.isArray(zone.rect) ? rectCells(...zone.rect) : Array.isArray(zone.cells) ? zone.cells.filter(isVec) : []);
    // Edge seats (rule.band) are resolved once, on the world as generated, for every band rule of this spawner on that
    // space together (in rule order, so no two share a cell), and kept in state so a replay or a restore seats the same cells.
    const bandCells = (g, area, n, taken, ok) => {
      const [x0, y0, x1, y1] = area.map(Math.floor), W = x1 - x0, H = y1 - y0, side = g % 4, ring = Math.floor(g / 4);
      const rows = side < 2, len = rows ? W : H, depth = Math.max(1, Math.floor((rows ? H : W) / 2));
      const order = Array.from({ length: len }, (_, i) => i).sort((a, b) => Math.abs(a - (len - 1) / 2) - Math.abs(b - (len - 1) / 2) || a - b);
      const cells = [];
      for (let k = ring * depth; k < depth * (ring + 1) && cells.length < n; k++) for (const i of order) {
        if (cells.length >= n) break;
        const line = side === 0 ? y1 - 1 - k : side === 1 ? y0 + k : side === 2 ? x0 + k : x1 - 1 - k;
        const at = rows ? [x0 + i, line] : [line, y0 + i];
        if (taken.has(at.join()) || !ok(at)) continue;
        taken.add(at.join()); cells.push(at);
      }
      return cells;
    };
    const seatsOn = (space, api) => {
      const s = st(); s.seats ??= {};
      if (s.seats[space]) return s.seats[space];
      const b = api.bounds?.(), area = b && b.min.length >= 2 && [b.min[0], b.min[1], b.max[0], b.max[1]].every(Number.isFinite) ? [b.min[0], b.min[1], b.max[0], b.max[1]] : null;
      const mine = config.rules.filter(r => r.band !== undefined && r.at === undefined && spaceOfRule(r) === space);
      const out = {};
      if (area) {
        // Cells already held: the player's and any other body's (pellets and pickups carry none and hold no cell).
        const player = rt.player();
        const taken = new Set(Object.values(rt.state.entities).filter(e => e.space === space && isVec(e.at) && (e === player || e.components.body)).map(e => e.at.slice(0, 2).map(Math.round).join()));
        for (const g of [...new Set(mine.map(r => r.band))]) {
          const rules = mine.filter(r => r.band === g), need = rules.map(r => (r.unique ? 1 : Math.max(...r.count, 1)));
          rules.forEach((r, j) => { out[r.id] = bandCells(g, area, need[j], taken, at => standable(api, space, at, r.archetype)); });
        }
      }
      return (s.seats[space] = out);
    };
    // Candidate position for a rule-like spec; null when no valid position was found.
    const place = (r, anchor = null, seat = null) => {
      const p = rt.player(), z = r.zone ? zoneDef(rt.doc, r.zone) : null;
      // The rule's space, its zone's, the space the spawner is bound to (a composed document binds an inner template's
      // spawner to the inner space), else the player's.
      const space = spaceOfRule(r, z), api = rt.space(space);
      for (let attempt = 0; attempt < 8; attempt++) {
        // region: the cells a sampled position was drawn from, on a grid (anchor 'cell').
        let at = null, teleportZone = null, sampled = true, region = null;
        if (anchor) { at = scatter(anchor, r.spread || 2, rt.random); region = () => discCells(anchor.map(Math.round), r.spread || 2); }
        else if (r.at !== undefined) sampled = false, at = scatter(Array.isArray(r.at) && r.at.every(isVec) && !isVec(r.at) ? pick(r.at, rt.random) : r.at, r.spread, rt.random);
        else if (r.band !== undefined && r.id && rules[r.id] === r) {
          const seats = seatsOn(space, api)[r.id] || [];
          if (!seats.length) return null;
          sampled = false; at = seats[(seat ?? rs(r.id).spawned) % seats.length].slice();
        } else if (r.near && Object.values(rt.state.entities).some(e => e.space === space && (e.id === r.near || e.archetype === r.near))) {
          const t = Object.values(rt.state.entities).filter(e => e.space === space && (e.id === r.near || e.archetype === r.near)), c = pick(t, rt.random).at;
          at = scatter(c, r.spread || 3, rt.random); if (isVec(c)) region = () => discCells(c.map(Math.round), r.spread || 3);
        } else if (z) {
          at = api.randomPoint?.(r.zone, rt.random, rt) ?? samplePoint(z.zone, rt.random);
          if (at === null || at === undefined) { at = null; teleportZone = r.zone; }
          region = () => zoneCells(z.zone);
        } else if (p && p.space === space) { at = scatter(p.at, r.spread || 4, rt.random); if (isVec(p.at)) region = () => discCells(p.at.map(Math.round), r.spread || 4); }
        if (isVec(at) && api.anchor === 'cell') {
          at = at.map(Math.floor); // cell spaces take integer cells
          // A sampled cell the archetype cannot stand in is drawn again among the cells of the region it came from that it
          // can (uniform over those overall): the region as generated, never a guess retried blind; none there, no spawn.
          if (region && !standable(api, space, at, r.archetype)) { const open = region().filter(c => standable(api, space, c, r.archetype)); if (!open.length) return null; at = pick(open, rt.random); }
        }
        if (isVec(at)) {
          if (api.groundAt && at.length >= 3) { const g = api.groundAt(at[0], at[2]); if (r.surface?.length && !r.surface.includes(g.material)) continue; if (r.snap ?? sampled) at = [at[0], g.y, at[2]]; }
          else if (r.surface?.length && !api.groundAt) return null;
          if (!standable(api, space, at, r.archetype)) continue;
          if (r.despawnDist && p?.space === space && isVec(p.at) && api.distance && api.distance(p.at, at) > r.despawnDist) continue;
          if (!biomeOk(r, at, space)) continue;
        }
        return { space, at, zone: teleportZone };
      }
      return null;
    };
    const make = (spec, where, ruleId = null, extra = {}) => {
      const named = ruleId ? (spec.unique ? ruleId : null) : spec.id ?? null; // rule ids are not entity ids unless unique
      if (named) { if (rt.entity(named)) return null; extra.id = named; }
      const components = { ...structuredClone(spec.components || {}), ...(ruleId ? { spawner: { rule: ruleId, index: extra.index ?? 0, home: where.at ?? null, ...(extra.held ? { held: true } : {}) } } : {}) };
      const e = rt.spawn(spec.archetype, { space: where.space, at: where.at, components, id: extra.id });
      if (where.zone) rt.space(where.space).teleport(e, { zone: where.zone }, rt);
      if (ruleId) { const r = rs(ruleId); r.alive.push(e.id); r.spawned++; if (extra.held) r.queue.push(e.id); }
      rt.emitTyped('spawned', ruleId ?? spec.archetype, { who: e.id, archetype: spec.archetype, rule: ruleId, at: e.at });
      rt.run(spec.onSpawn || [], { self: e.id });
      return e;
    };
    // Start a spawn (or a telegraphed one) for a rule; returns how many entities it started.
    const start = (r, n) => {
      const where = place(r); if (!where) { rt.emit('spawn_failed', { rule: r.id, archetype: r.archetype }); return 0; }
      let started = 0;
      const base = rs(r.id).spawned;
      for (let k = 0; k < n; k++) {
        // Each spawn of a band rule takes its own seat; others scatter around the first.
        const w = k === 0 ? where : r.band !== undefined && r.at === undefined ? place(r, null, base + k) : (isVec(where.at) ? { ...where, at: scatter(where.at, r.spread || 2, rt.random) } : where);
        if (!w) { rt.emit('spawn_failed', { rule: r.id, archetype: r.archetype }); break; }
        const index = rs(r.id).spawned + started;
        if (r.telegraph > 0) { st().pending.push({ rule: r.id, space: w.space, at: w.at, zone: w.zone, due: rt.state.frame + frames(r.telegraph), index }); rt.emitTyped('spawn_telegraph', r.id, { rule: r.id, archetype: r.archetype, at: w.at, seconds: r.telegraph }); }
        else make(r, w, r.id, { index, held: Boolean(r.release) });
        started++;
      }
      return started;
    };
    const rollTarget = r => {
      const z = r.zone ? zoneDef(rt.doc, r.zone) : null, area = z ? zoneArea(z.zone) : null;
      const [lo, hi = lo] = r.count;
      const n = r.per1000m2 !== undefined && area !== null ? Math.round(area * r.per1000m2 / 1000) : rollRange(r.count, rt.random);
      return Math.max(lo, Math.min(hi, n, r.maxAlive ?? Infinity, r.unique ? 1 : Infinity));
    };
    const isActive = r => {
      const p = rt.player();
      if (r.activation === 'zone' && r.zone) { const z = zoneDef(rt.doc, r.zone); if (!p || p.space !== z?.space || !rt.space(p.space).inZone(p, r.zone, rt)) return false; }
      return !r.when || rt.test(r.when);
    };
    const cull = (id, why) => { const s = st(); s.culling = id; rt.despawn(id); s.culling = null; rt.emit('culled', { who: id, reason: why }); };
    const releaseHead = (ruleId) => {
      const r = rs(ruleId), def = rules[ruleId], id = r.queue.shift(); if (!id) return false;
      const e = rt.entity(id); if (e?.components.spawner) delete e.components.spawner.held;
      delete r.counter[id]; r.idle = 0;
      rt.emitTyped('released', ruleId, { who: id, rule: ruleId });
      rt.run(def?.release?.onRelease || [], { self: id });
      return true;
    };
    // Kills (despawns we did not do) start a respawn cooldown; respawnSec 0 never refills.
    rt.on('despawn', (ev) => {
      const s = st();
      for (const [ruleId, r] of Object.entries(s.rules)) {
        const i = r.alive.indexOf(ev.id); if (i < 0) continue;
        r.alive.splice(i, 1); r.queue = r.queue.filter(x => x !== ev.id); delete r.counter[ev.id];
        if (s.culling !== ev.id) { const sec = rules[ruleId]?.respawnSec ?? 0; r.cooling.push(sec > 0 ? rt.state.frame + frames(sec) : -1); }
      }
    });
    for (const def of config.rules) {
      if (def.release?.counter) rt.on(def.release.counter, () => { const r = rs(def.id); r.idle = 0; if (!r.queue.length) return; if (r.global !== null) r.global++; else r.counter[r.queue[0]] = (r.counter[r.queue[0]] || 0) + 1; });
      if (def.release?.globalOn) rt.on(def.release.globalOn, () => { rs(def.id).global = 0; });
    }
    const api = {
      place, alive: ruleId => rs(ruleId).alive.slice(), held: ruleId => rs(ruleId).queue.slice(),
      spawn(e, c = {}) {
        const count = e.count ?? 1, spec = { archetype: e.archetype, zone: e.zone, space: e.space, spread: e.spread, snap: e.snap, components: e.components, onSpawn: e.onSpawn, id: count === 1 ? e.id : undefined };
        if (e.near) { const t = rt.resolve(e.near, c); if (t) spec.at = t.at; else spec.near = e.near; } else if (e.at !== undefined) spec.at = e.at;
        const out = [];
        for (let k = 0; k < count; k++) {
          const where = place(spec); if (!where) { rt.emit('spawn_failed', { archetype: e.archetype }); continue; }
          if (e.telegraph > 0) { st().pending.push({ archetype: e.archetype, spec, space: where.space, at: where.at, zone: where.zone, due: rt.state.frame + frames(e.telegraph) }); rt.emitTyped('spawn_telegraph', e.archetype, { archetype: e.archetype, at: where.at, seconds: e.telegraph }); }
          else { const ent = make(spec, where); if (ent) out.push(ent.id); }
        }
        return out;
      },
      despawn(e, c = {}) {
        if (e.who !== undefined) { const t = rt.resolve(e.who, c); if (t && t.id !== 'player') rt.despawn(t.id); return; }
        const ids = e.rule ? rs(e.rule).alive.slice() : Object.values(rt.state.entities).filter(x => x.archetype === e.archetype && x.id !== 'player').map(x => x.id);
        for (const id of ids) { const x = rt.entity(id); if (x && (!e.zone || (x.space && rt.space(x.space).inZone?.(x, e.zone, rt)))) rt.despawn(id); }
      },
      reset(ruleId) {
        const r = rs(ruleId); for (const id of r.alive.slice()) cull(id, 'reset');
        Object.assign(r, { cooling: [], queue: [], counter: {}, global: null, idle: 0, active: false, spawned: 0 });
        st().pending = st().pending.filter(p => p.rule !== ruleId);
      },
      // Put a rule's live entities back in its queue at their spawn points (arcade death reset).
      rehold(ruleId, { global = false } = {}) {
        const r = rs(ruleId), def = rules[ruleId]; if (!def?.release) return;
        const list = r.alive.map(id => rt.entity(id)).filter(Boolean).sort((a, b) => a.components.spawner.index - b.components.spawner.index);
        r.queue = []; r.counter = {}; r.idle = 0; r.global = global ? 0 : null;
        for (const e of list) { e.components.spawner.held = true; r.queue.push(e.id); if (e.components.spawner.home != null) rt.space(e.space).setPos(e, structuredClone(e.components.spawner.home), rt); }
      },
      release: releaseHead,
    };
    rt.provide('spawner', api);
    rt.system('rules', rt => {
      const s = st(), f = rt.state.frame;
      // Telegraphed spawns that are due.
      if (s.pending.length) for (const p of s.pending.filter(p => p.due <= f)) {
        s.pending.splice(s.pending.indexOf(p), 1);
        if (p.rule) make(rules[p.rule], p, p.rule, { index: p.index }); else make(p.spec, p);
      }
      // Release queues every step (counters and idle timers are frame-exact).
      for (const def of config.rules) {
        if (!def.release) continue;
        const r = rs(def.id), rel = def.release;
        if (!r.queue.length) { r.global = null; continue; }
        r.idle++;
        const head = rt.entity(r.queue[0]), index = head?.components.spawner.index ?? 0;
        const at = (list, i) => list[Math.min(i, list.length - 1)] ?? 0;
        let go = r.global !== null ? r.global >= at(rel.globalLimits, index) : rel.counter !== undefined && (r.counter[r.queue[0]] || 0) >= at(rel.limits, index);
        if (rel.counter === undefined && rel.globalOn === undefined && rel.idleSec === undefined && !rel.when) go = true;
        if (rel.idleSec !== undefined && r.idle >= frames(rel.idleSec)) go = true;
        if (rel.when && rt.test(rel.when, { self: r.queue[0] })) go = true;
        if (go) releaseHead(def.id);
      }
      if (f % period) { publish(); return; }
      let budget = config.perTick;
      const p = rt.player();
      for (const def of config.rules) {
        const r = rs(def.id);
        r.cooling = r.cooling.filter(due => due < 0 || due > f);
        // Distance culling.
        if (def.despawnDist && p && isVec(p.at)) for (const id of r.alive.slice()) { const e = rt.entity(id); if (e && e.space === p.space && isVec(e.at) && rt.space(e.space).distance?.(p.at, e.at) > def.despawnDist) cull(id, 'distance'); }
        const active = isActive(def);
        if (active && !r.active) r.target = rollTarget(def);
        if (!active && r.active && def.cullWhenInactive) for (const id of r.alive.slice()) cull(id, 'inactive');
        r.active = active;
        if (!active || budget <= 0) continue;
        const pending = s.pending.filter(x => x.rule === def.id).length;
        let room = r.target - r.alive.length - pending - r.cooling.length;
        room = Math.min(room, (def.maxAlive ?? Infinity) - r.alive.length - pending, config.globalCap - alive(), budget);
        if (def.group) room = Math.min(room, config.groups.find(g => g.id === def.group).maxAlive - groupCount(def.group));
        while (room > 0 && budget > 0) {
          const n = Math.min(room, rollRange(def.groupSize, rt.random) || 1);
          const made = start(def, n); if (!made) break;
          room -= made; budget -= made;
        }
      }
      publish();
    }, ID);
  },
};
