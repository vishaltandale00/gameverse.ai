// Places prefab structures (houses, huts, towers, camps, ruins, shrines,
// bridges, gates, arenas, cabins, mines, empty lots...) in 3D spaces: pinned
// at a position or scattered `count` times in a zone on flat, dry ground
// clear of roads, lots and other structures. Footprints are flattened;
// prefabs become voxel cells or mesh3d colliders (worlds3d-lib-prefab), with
// hollow interiors, doors and floors when `interior` is set. Underground
// positions are hollowed out. Spawns appear at game start; the `structures`
// service lists ids, bounds, doors, rooms, loot tables and tags.
import { Rng, subSeed } from './worlds3d-lib-noise.js';
import { STAGES, withDefaults, generatorModel, sharedService, zoneBox, zoneHas, zoneYRange } from './worlds3d-lib-world.js';
import { prefab, addStamp, clearFootprint, footprintsOverlap, KINDS, DEFAULT_SIZE, toWorld, toLocal } from './worlds3d-lib-prefab.js';
import { roadNet, nearestRoad } from './worlds3d-lib-roads.js';

const card = {
  intent: 'Places buildings and landmarks (houses, towers, camps, ruins, shrines, bridges, gates, arenas, mines, lots) at fixed spots or scattered in zones, with optional walk-in interiors, loot tables and spawned occupants.',
  views: ['any'],
  params: {
    place: {
      type: 'list', min: 1, required: true, effect: 'structures to place',
      of: { type: 'object', fields: {
        id: { type: 'string', required: true }, kind: { type: 'string', options: KINDS, required: true }, zone: { type: 'ref', to: 'zone', required: true },
        count: { type: 'list', of: { type: 'integer', min: 0, max: 500 }, min: 2, max: 2, effect: '[min, max] copies scattered in the zone (instead of at)' },
        at: { type: 'list', of: { type: 'number' }, min: 2, max: 3, effect: '[x, z] or [x, y, z] (m); a y below ground places it underground' },
        style: { type: 'string', default: '', effect: 'look: brick, glass, timber, stone, log, industrial, ruin... (picks blocks/materials)' },
        size: { type: 'list', of: { type: 'number', min: 1, max: 2000 }, min: 2, max: 3, effect: '[width, depth] or [width, depth, height] (m)' },
        floors: { type: 'list', of: { type: 'integer', min: 1, max: 200 }, min: 2, max: 2, effect: '[min, max] storeys for houses/towers' },
        interior: { type: 'boolean', default: false, effect: 'hollow, enterable inside with a door and floors' },
        rot: { type: 'number', min: -360, max: 360, unit: 'deg', effect: 'facing (default: toward the nearest road, else seeded)' },
        loot: { type: 'string', effect: 'loot table id for containers inside' }, spawns: { type: 'list', of: { type: 'ref', to: 'archetype' }, default: [] },
        tags: { type: 'list', of: { type: 'string' }, default: [] }, prefab: { type: 'string', effect: 'id in content.structures whose parts replace the built-in prefab' },
        palette: { type: 'object', open: true, default: {}, effect: 'voxel role -> block overrides (wall, roof, floor, window, trim...)' },
      } },
    },
    spacing: { type: 'number', min: 0, max: 200, default: 6, unit: 'm', effect: 'minimum gap between structures' },
    maxSlope: { type: 'number', min: 0, max: 60, default: 18, unit: 'deg', effect: 'steepest ground a scattered structure accepts' },
    avoidRoads: { type: 'boolean', default: true, effect: 'scattered structures keep off roads and built lots' },
    floorHeight: { type: 'number', min: 2, max: 10, unit: 'm', effect: 'storey height (default 4 cells on voxel, 3.5 m on mesh3d)' },
    attempts: { type: 'integer', min: 1, max: 1000, default: 60, effect: 'site tries per scattered copy' },
  },
  provides: { services: ['structures'], events: [] },
  reads: ['content.structures', 'content.tables'],
};

export default {
  id: 'engine.generate.structures',
  card,
  validate(config, doc) {
    const errors = [], tables = new Set((doc.content?.tables || []).map(t => t.id)), prefabs = new Set((doc.content?.structures || []).map(s => s.id)), ids = new Set();
    (config.place || []).forEach((p, i) => {
      const path = `with.place[${i}]`;
      if (ids.has(p.id)) errors.push({ code: 'id_duplicate', path: `${path}.id`, message: `duplicate structure id '${p.id}'` }); ids.add(p.id);
      if (!p.at && !p.count) errors.push({ code: 'structure_position_missing', path, message: `structure '${p.id}' needs at or count` });
      if (p.at && p.count) errors.push({ code: 'structure_position_ambiguous', path, message: `structure '${p.id}' has both at and count` });
      if (p.count && p.count[0] > p.count[1]) errors.push({ code: 'param_range', path: `${path}.count`, message: 'count must be [min, max]' });
      if (p.loot && doc.content?.tables && !tables.has(p.loot)) errors.push({ code: 'ref_unknown', path: `${path}.loot`, message: `unknown loot table '${p.loot}'` });
      if (p.prefab && !prefabs.has(p.prefab)) errors.push({ code: 'ref_unknown', path: `${path}.prefab`, message: `unknown prefab '${p.prefab}' (content.structures)` });
    });
    return errors;
  },
  install(rt, raw, instance) {
    const config = withDefaults(card, raw), model = generatorModel(rt, instance);
    if (!model) return;
    model.contribute(`structures#${instance.key}`, STAGES.structures, (m, seed) => {
      const C = m.opts.cell || 1, voxel = m.kind === 'voxel', fh = config.floorHeight ?? (voxel ? 4 * C : 3.5), t = voxel ? C : 0.3;
      const ground = (x, z) => (m.surfaceY ? m.surfaceY(x, z) : m.at('height', x, z, 0));
      const water = (x, z) => { const w = m.at('water', x, z, null); return w == null ? 0 : Math.max(0, w - m.at('height', x, z, 0)); };
      const placed = (m.data.structures ??= []), net = m.data.roads ? roadNet(m) : null;
      const lots = m.data.lots || [];
      const problem = (code, message) => m.problem(code, message, { generator: instance.use });
      config.place.forEach((p, pi) => {
        const zone = m.zone(p.zone);
        if (!zone) { problem('zone_missing', `structure '${p.id}' zone '${p.zone}' is not in space '${m.sid}'`); return; }
        const rng = new Rng(subSeed(seed, p.id)), dflt = DEFAULT_SIZE[p.kind] || [10, 10];
        const size = p.size || dflt, w = size[0], d = size.length === 3 ? size[1] : p.kind === 'tower' ? size[0] : size[1] ?? dflt[1];
        const h = size.length === 3 ? size[2] : p.kind === 'tower' && size.length === 2 ? size[1] : undefined;
        const custom = p.prefab && (rt.doc.content?.structures || []).find(s => s.id === p.prefab);
        const n = p.count ? rng.int(p.count[0], p.count[1]) : 1, box = zoneBox(zone), [zy0, zy1] = zoneYRange(zone);
        let made = 0; const why = { outside: 0, slope: 0, water: 0, road: 0, lot: 0, crowded: 0 };
        for (let k = 0; k < n; k++) {
          let site = null;
          for (let a = 0; a < (p.at ? 1 : config.attempts) && !site; a++) {
            let x, z, y = null;
            if (p.at) { x = p.at[0]; z = p.at.length === 3 ? p.at[2] : p.at[1]; if (p.at.length === 3) y = p.at[1]; }
            else { x = rng.range(box[0] + w / 2, box[2] - w / 2); z = rng.range(box[1] + d / 2, box[3] - d / 2); if (!zoneHas(zone, x, undefined, z)) { why.outside++; continue; } }
            const g = ground(x, z);
            const under = (y != null && y < g - 2) || (!p.at && Number.isFinite(zy1) && zy1 < g - 2);
            if (under && y == null) y = Math.max(zy0 + 4, 4);
            // facing
            let rot = p.rot != null ? (p.rot * Math.PI) / 180 : rng.int(0, 3) * (Math.PI / 2);
            if (p.rot == null && p.kind === 'mine') { const e = 2, gx = ground(x + e, z) - ground(x - e, z), gz = ground(x, z + e) - ground(x, z - e); if (Math.hypot(gx, gz) > 1e-6) rot = Math.atan2(-gx, -gz); }
            else if (p.rot == null && net?.edges.length && !under) { const r = nearestRoad(net, x, z, 80); if (r && r.dist > 1e-6) rot = Math.atan2(r.point[0] - x, r.point[2] - z); }
            if (voxel) rot = Math.round(rot / (Math.PI / 2)) * (Math.PI / 2);
            const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]].map(([lx, lz]) => toWorld([x, 0, z], rot, lx, lz));
            if (!p.at && !under) {
              const hs = corners.map(([cx, cz]) => ground(cx, cz)), slope = (Math.max(...hs, g) - Math.min(...hs, g)) / (Math.hypot(w, d) / 2);
              // Later tries relax the slope limit (up to 3x): the footprint is levelled anyway, so steep zones still get their buildings.
              const limit = Math.min(60, config.maxSlope * (1 + (2 * a) / config.attempts));
              if (p.kind !== 'mine' && slope > Math.tan((limit * Math.PI) / 180)) { why.slope++; continue; }
              if (water(x, z) > 0.3 || corners.filter(([cx, cz]) => water(cx, cz) > 0.3).length > 2) { why.water++; continue; } // a wet corner stands on its foundation
              if (config.avoidRoads && net?.edges.length) { const r = nearestRoad(net, x, z, Math.hypot(w, d) / 2 + 12); if (r && r.dist < Math.hypot(w, d) / 2 + 3) { why.road++; continue; } }
              if (config.avoidRoads && lots.some(l => l.building && x > l.rect[0] - w / 2 && x < l.rect[2] + w / 2 && z > l.rect[1] - d / 2 && z < l.rect[3] + d / 2)) { why.lot++; continue; }
            }
            if (!p.at && placed.some(o => Math.hypot(o.at[0] - x, o.at[2] - z) < (Math.hypot(w, d) + Math.hypot(o.size[0], o.size[1])) / 2 + config.spacing)) { why.crowded++; continue; }
            const gy = under ? (voxel ? Math.floor(y / C) * C : y) : voxel ? Math.round([[x, z], ...corners].reduce((s, [cx, cz]) => s + ground(cx, cz), 0) / 5 / C) * C : [[x, z], ...corners].reduce((s, [cx, cz]) => s + ground(cx, cz), 0) / 5;
            site = { x, z, y: gy, rot, under, corners };
          }
          if (!site) continue;
          const floors = p.floors ? rng.int(p.floors[0], p.floors[1]) : undefined;
          const pf = custom?.parts ? { parts: structuredClone(custom.parts), height: custom.height ?? Math.max(...custom.parts.map(q => q.y[1])), door: custom.door ?? null, rooms: custom.rooms ?? [] } : prefab(p.kind, { w, d, h, floors, floorH: fh, t, interior: p.interior, style: p.style, rng });
          if (site.under) pf.parts.unshift({ role: 'carve', c: [0, 0], y: [0, pf.height + 2 * C], size: [w + 2 * C, d + 2 * C] });
          const id = n > 1 || p.count ? `${p.id}_${k + 1}` : p.id, at = [+site.x.toFixed(3), +site.y.toFixed(3), +site.z.toFixed(3)];
          const st = { id, kind: p.kind, zone: p.zone, at, rot: +site.rot.toFixed(6), w, d, height: pf.height, parts: pf.parts, style: p.style, palette: p.palette, tags: p.tags, flatten: !site.under };
          if (p.at) {
            clearFootprint(m, st);
            const clash = placed.find(o => o.pinned && footprintsOverlap(st, { at: o.at, rot: o.rot, w: o.size[0], d: o.size[1] }));
            if (clash) problem('structure_overlap', `pinned structure '${id}' overlaps pinned '${clash.id}'`);
          }
          addStamp(m, rt, st, problem);
          const W = (l) => { const [wx, wz] = toWorld(at, st.rot, l[0], l[2]); return [+wx.toFixed(3), +(at[1] + l[1]).toFixed(3), +wz.toFixed(3)]; };
          placed.push({
            id, group: p.id, kind: p.kind, zone: p.zone, at, rot: st.rot, pinned: Boolean(p.at), size: [w, d, +pf.height.toFixed(3)], style: p.style, interior: p.interior, underground: site.under,
            door: pf.door ? W(pf.door) : null, rooms: pf.rooms.map(r => { const a = W(r.min), b = W(r.max); return { min: a.map((v, i) => Math.min(v, b[i])), max: a.map((v, i) => Math.max(v, b[i])) }; }),
            loot: p.loot ?? null, spawns: p.spawns, tags: p.tags, footprint: site.corners.map(([cx, cz]) => [+cx.toFixed(3), +cz.toFixed(3)]),
          });
          made++;
        }
        if (made < (p.count ? p.count[0] : 1)) problem('structure_unplaced', `placed ${made} of ${p.count ? `${p.count[0]}..${p.count[1]}` : 1} '${p.id}' in zone '${p.zone}' (rejected sites: ${Object.entries(why).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'})`);
      });
      m.info.summary = { ...(m.info.summary || {}), structures: placed.length };
    });
    const list = () => model.ensure().data.structures || [];
    sharedService(rt, 'structures', model.sid, {
      call: () => list(),
      get: id => list().find(s => s.id === id) || null,
      at: (x, z) => list().find(s => { const [lx, lz] = toLocal(s.at, s.rot, x, z); return Math.abs(lx) <= s.size[0] / 2 && Math.abs(lz) <= s.size[1] / 2; }) || null,
      tagged: tag => list().filter(s => s.tags?.includes(tag)),
    }, ['get', 'at', 'tagged']);
    // Occupants appear once, at game start (after every space and the player exist).
    rt.on('game_start', (data, rt) => {
      const s = rt.store(instance.key); if (s.spawned) return; s.spawned = true;
      const mine = new Set(config.place.map(p => p.id));
      for (const st of list()) {
        if (!mine.has(st.group) || !st.spawns?.length) continue;
        st.spawns.forEach((arch, i) => {
          const room = st.rooms[0], at = room ? [(room.min[0] + room.max[0]) / 2 + (i % 3) - 1, room.min[1], (room.min[2] + room.max[2]) / 2] : st.door ? [st.door[0] + Math.sin(st.rot) * 2, st.door[1], st.door[2] + Math.cos(st.rot) * 2] : [st.at[0] + Math.sin(st.rot) * (st.size[1] / 2 + 2), st.at[1], st.at[2] + Math.cos(st.rot) * (st.size[1] / 2 + 2)];
          const api = rt.space(model.sid), body = rt.archetype(arch)?.components?.body;
          rt.spawn(arch, { space: model.sid, at: api.standAt(at, { components: { body: body?.size ? body : undefined } }).map(v => +v.toFixed(3)) });
        });
      }
    });
  },
};
