// Cities for 3D spaces: each district (a zone) is levelled to a plaza height
// and gets a street network (regular grid, organic jittered grid, or radial
// rings and spokes). The spaces between streets become blocks, blocks split
// into lots facing the street, and lots get buildings whose height rises
// toward the district centre within the district's floor range; named
// landmarks take the most central lots. Streets join the shared road network
// (`roadgraph`, with lanes) and street props line the sidewalks. Buildings
// are prefabs (voxel cells or mesh3d colliders), hollow when `interiors`.
// Provides `lotAt(x, z)` and the lot list.
import { Rng, rand2, subSeed, smoothstep } from './worlds3d-lib-noise.js';
import { STAGES, withDefaults, generatorModel, sharedService, zoneBox, zoneHas, zoneCenter, zoneDistance, rangeRule, reversedRanges } from './worlds3d-lib-world.js';
import { roadNet, addNode, addEdge, ensureRoadLayer, provideRoadgraph } from './worlds3d-lib-roads.js';
import { prefab, addStamp, paletteShape } from './worlds3d-lib-prefab.js';

const card = {
  intent: 'Lays out city districts: levelled ground, street grids (regular, organic or radial) with lanes and sidewalks, blocks split into lots, buildings with floor counts and styles, landmarks and street furniture. Lots are queryable (lotAt) for ownership and building games.',
  views: ['any'],
  spaces: ['engine.space.mesh3d', 'engine.space.voxel'],
  params: {
    districts: {
      type: 'list', min: 1, required: true, effect: 'one entry per district zone',
      of: { type: 'object', fields: {
        zone: { type: 'ref', to: 'zone', required: true }, density: { type: 'number', min: 0, max: 1, default: 0.6, effect: 'share of lots with a building' },
        floors: { type: 'list', of: { type: 'integer', min: 1, max: 200 }, min: 2, max: 2, default: [1, 4] }, style: { type: 'string', default: 'generic' },
        landmarks: { type: 'list', of: { type: 'string' }, default: [] }, grid: { type: 'string', options: ['regular', 'organic', 'radial'], default: 'regular' },
      } },
    },
    block: { type: 'list', of: { type: 'integer', min: 8, max: 400 }, min: 2, max: 2, default: [48, 48], unit: 'm', scale: 'world', effect: 'block size between streets' },
    roadWidth: { type: 'number', min: 3, max: 24, default: 8, unit: 'm' },
    sidewalk: { type: 'number', min: 0, max: 10, default: 2, unit: 'm' },
    interiors: { type: 'boolean', default: false, effect: 'buildings are hollow with doors, floors and ladders' },
    streetProps: { type: 'list', of: { type: 'string' }, default: [], effect: 'props along sidewalks (model ids, voxel block ids, or plain names)' },
    propSpacing: { type: 'number', min: 4, max: 500, default: 24, unit: 'm' },
    lotSize: { type: 'number', min: 4, max: 200, default: 16, unit: 'm', effect: 'target lot frontage' },
    setback: { type: 'number', min: 0, max: 20, default: 1.5, unit: 'm', effect: 'gap between lot edge and building' },
    floorHeight: { type: 'number', min: 2, max: 10, unit: 'm', effect: 'storey height (default 4 cells on voxel, 3.5 m on mesh3d)' },
    margin: { type: 'number', min: 0, max: 400, default: 32, unit: 'm', effect: 'distance over which levelled districts blend back into the terrain' },
    drive: { type: 'string', options: ['right', 'left'], default: 'right' },
    styles: { type: 'object', default: {}, values: paletteShape(), effect: 'style -> {wall, roof, window, floor, trim...} voxel block overrides' },
  },
  provides: { content: ['structures', 'road-network'], extent: 'overlay', services: ['roadgraph', 'lotAt'], events: [] },
  reads: [],
  rules: { range_reversed: rangeRule(['districts[].floors']) },
};

const centroid = q => [q.reduce((s, p) => s + p[0], 0) / q.length, q.reduce((s, p) => s + p[1], 0) / q.length];
const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const inQuad = (q, x, z) => { let inside = false; for (let i = 0, j = q.length - 1; i < q.length; j = i++) { const [xi, zi] = q[i], [xj, zj] = q[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside; } return inside; };
/** Shrink a convex quad toward its centroid by `d` metres (approximate inset). */
const inset = (q, d) => { const c = centroid(q); return q.map(p => { const l = Math.hypot(c[0] - p[0], c[1] - p[1]); return l <= d * 1.42 ? c.slice() : [p[0] + ((c[0] - p[0]) / l) * d * 1.42, p[1] + ((c[1] - p[1]) / l) * d * 1.42]; }); };

export default {
  id: 'engine.generate.city',
  card,
  validate(config) {
    return reversedRanges((Array.isArray(config.districts) ? config.districts : []).map((d, i) => [`with.districts[${i}].floors`, d?.floors]));
  },
  install(rt, raw, instance) {
    const config = withDefaults(card, raw), model = generatorModel(rt, instance);
    if (!model) return;
    model.contribute(`city#${instance.key}`, STAGES.city, (m, seed) => {
      const voxel = m.kind === 'voxel', C = m.opts.cell || 1, fh = config.floorHeight ?? (voxel ? 4 * C : 3.5), t = voxel ? C : 0.3, sea = m.info.sea ?? m.opts.seaLevel ?? 0;
      const net = roadNet(m), lots = (m.data.lots ??= []), props = (m.data.props ??= []);
      const known = new Set((rt.doc.content?.blocks || []).map(b => b.id)), models = rt.doc.content?.models || {};
      const ground = (x, z) => (m.surfaceY ? m.surfaceY(x, z) : m.at('height', x, z, 0));
      const problem = (code, message) => m.problem(code, message, { generator: instance.use });
      let buildings = 0;
      config.districts.forEach((dist, di) => {
        const zone = m.zone(dist.zone);
        if (!zone) { problem('zone_missing', `district zone '${dist.zone}' is not in space '${m.sid}'`); return; }
        const rng = new Rng(subSeed(seed, `district:${dist.zone}`)), box = zoneBox(zone), center = zoneCenter(zone);
        // Plaza height: median ground over the district, kept above the sea.
        const samples = [];
        for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) { const x = box[0] + ((box[2] - box[0]) * (i + 0.5)) / 7, z = box[1] + ((box[3] - box[1]) * (j + 0.5)) / 7; if (zoneHas(zone, x, undefined, z)) samples.push(ground(x, z)); }
        samples.sort((a, b) => a - b);
        let plaza = Math.max(samples[Math.floor(samples.length / 2)] ?? sea, sea + 1.5);
        if (voxel) plaza = Math.round(plaza / C) * C;
        const target = voxel ? plaza - C : plaza, margin = config.margin;
        m.modify('height', { bounds: [box[0] - margin, box[1] - margin, box[2] + margin, box[3] + margin], priority: 15, apply(x, z, h) {
          const d = zoneDistance(zone, x, undefined, z);
          return d <= 0 ? target : d >= margin ? h : target + (h - target) * smoothstep(0, margin, d);
        } });
        // Street lattice.
        const [bw, bd] = config.block, rw = config.roadWidth, px = bw + rw, pz = bd + rw, nodes = new Map(), at3 = ([x, z]) => [x, plaza, z];
        const keep = (k, p) => { if (zoneHas(zone, p[0], undefined, p[1])) nodes.set(k, { p, id: addNode(net, { at: at3(p), kind: 'street', zone: dist.zone }) }); };
        const quads = [], edges = [];
        if (dist.grid === 'radial') {
          const R = Math.min(box[2] - box[0], box[3] - box[1]) / 2, K = Math.max(1, Math.floor(R / px) + 1), S = Math.max(6, Math.round((2 * Math.PI * R) / (2 * px)));
          keep('c', center);
          for (let k = 1; k <= K; k++) for (let s = 0; s < S; s++) { const a = (s / S) * Math.PI * 2, r = k * px; keep(`${k},${s}`, [center[0] + Math.sin(a) * r, center[1] + Math.cos(a) * r]); }
          for (let k = 1; k <= K; k++) for (let s = 0; s < S; s++) {
            edges.push([`${k},${s}`, `${k},${(s + 1) % S}`], [k === 1 ? 'c' : `${k - 1},${s}`, `${k},${s}`]);
            if (k < K) quads.push([`${k},${s}`, `${k + 1},${s}`, `${k + 1},${(s + 1) % S}`, `${k},${(s + 1) % S}`]);
            if (k === 1) quads.push(['c', `1,${s}`, `1,${(s + 1) % S}`, 'c']); // inner sectors (triangles)
          }
        } else {
          const NX = Math.max(1, Math.floor((box[2] - box[0]) / px)), NZ = Math.max(1, Math.floor((box[3] - box[1]) / pz));
          const ox = box[0] + ((box[2] - box[0]) - NX * px) / 2, oz = box[1] + ((box[3] - box[1]) - NZ * pz) / 2, js = subSeed(seed, `jitter:${dist.zone}`);
          for (let i = 0; i <= NX; i++) for (let j = 0; j <= NZ; j++) {
            let p = [ox + i * px, oz + j * pz];
            if (dist.grid === 'organic' && i > 0 && j > 0 && i < NX && j < NZ) p = [p[0] + (rand2(js, i, j) - 0.5) * 0.35 * px, p[1] + (rand2(js ^ 0x55, i, j) - 0.5) * 0.35 * pz];
            keep(`${i},${j}`, p);
          }
          for (let i = 0; i <= NX; i++) for (let j = 0; j <= NZ; j++) { if (i < NX) edges.push([`${i},${j}`, `${i + 1},${j}`]); if (j < NZ) edges.push([`${i},${j}`, `${i},${j + 1}`]); if (i < NX && j < NZ) quads.push([`${i},${j}`, `${i + 1},${j}`, `${i + 1},${j + 1}`, `${i},${j + 1}`]); }
        }
        const streetEdges = [];
        for (const [a, b] of edges) { const A = nodes.get(a), B = nodes.get(b); if (!A || !B) continue; streetEdges.push(addEdge(m, net, { from: A.id, to: B.id, points: [at3(A.p), at3(B.p)], width: rw, sidewalk: config.sidewalk, surface: 'asphalt', lanes: 2, kind: 'street', zone: dist.zone, flatten: false })); }
        if (!streetEdges.length) problem('district_small', `district '${dist.zone}' is smaller than one block; no streets laid`);
        // Blocks -> lots -> buildings.
        const lotsHere = [];
        for (const qk of quads) {
          if (!qk.every(k => nodes.has(k))) continue;
          const q = inset(qk.map(k => nodes.get(k).p), rw / 2 + config.sidewalk);
          const nu = Math.max(1, Math.round(Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]) / config.lotSize)), nv = Math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1]) > 2 * config.lotSize ? 2 : 1;
          for (let u = 0; u < nu; u++) for (let v = 0; v < nv; v++) {
            const P = (a, b) => lerp2(lerp2(q[0], q[1], a), lerp2(q[3], q[2], a), b);
            const poly = [P(u / nu, v / nv), P((u + 1) / nu, v / nv), P((u + 1) / nu, (v + 1) / nv), P(u / nu, (v + 1) / nv)];
            const c = centroid(poly); if (!zoneHas(zone, c[0], undefined, c[1])) continue;
            // Front faces the street on the lot's outer side (v = 0 row faces q0-q1, v = last row faces q3-q2).
            const edge = v === 0 ? [poly[0], poly[1]] : [poly[3], poly[2]], mid = lerp2(edge[0], edge[1], 0.5), f = [mid[0] - c[0], mid[1] - c[1]], fl = Math.hypot(...f) || 1;
            const xs = poly.map(p => p[0]), zs = poly.map(p => p[1]);
            lotsHere.push({ id: `${dist.zone}_lot${lots.length + lotsHere.length + 1}`, zone: dist.zone, district: di, poly: poly.map(p => p.map(n => +n.toFixed(3))), rect: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)].map(n => +n.toFixed(3)), center: c.map(n => +n.toFixed(3)), y: plaza, front: [+(f[0] / fl).toFixed(4), +(f[1] / fl).toFixed(4)], building: null, width: Math.hypot(poly[1][0] - poly[0][0], poly[1][1] - poly[0][1]), depth: Math.hypot(poly[3][0] - poly[0][0], poly[3][1] - poly[0][1]) });
          }
        }
        const R = Math.max(1, Math.hypot(box[2] - box[0], box[3] - box[1]) / 2), centrality = l => 1 - Math.min(1, Math.hypot(l.center[0] - center[0], l.center[1] - center[1]) / R);
        const byCentre = [...lotsHere].sort((a, b) => centrality(b) - centrality(a) || a.id.localeCompare(b.id));
        // Landmarks that a pinned structure of this zone already provides are left to it.
        const pinned = new Set((rt.doc.spaces.find(s => s.id === m.sid)?.generators || []).filter(g => g.use === 'engine.generate.structures').flatMap(g => (g.with?.place || []).filter(p => p.at && p.zone === dist.zone).map(p => p.id)));
        const landmarkOf = new Map(); dist.landmarks.filter(name => !pinned.has(name)).forEach((name, i) => { const lot = byCentre.find(l => !landmarkOf.has(l) && l.width >= 6 && l.depth >= 6); if (lot) landmarkOf.set(lot, name); else problem('landmark_unplaced', `no lot for landmark '${name}' in '${dist.zone}'`); });
        const maxFloors = voxel ? Math.max(1, Math.floor(((m.opts.height ?? 128 * C) - plaza - 6 * C) / fh)) : 200;
        for (const lot of lotsHere) {
          const c = centrality(lot), landmark = landmarkOf.get(lot);
          if (!landmark && rng.next() > dist.density * (0.55 + 0.45 * c)) continue;
          const w = Math.max(4, lot.width - 2 * config.setback), d = Math.max(4, lot.depth - 2 * config.setback);
          let floors = Math.round(dist.floors[0] + (dist.floors[1] - dist.floors[0]) * Math.min(1, c ** 1.2 * 0.75 + rng.next() * 0.35));
          if (landmark) floors = Math.max(floors, Math.round((dist.floors[0] + dist.floors[1]) / 2));
          if (floors > maxFloors) floors = maxFloors;
          let rot = Math.atan2(lot.front[0], lot.front[1]);
          if (voxel) rot = Math.round(rot / (Math.PI / 2)) * (Math.PI / 2);
          const id = landmark ? `${dist.zone}_${landmark}` : `${lot.id}_b`;
          const pf = prefab('building', { w, d, floors, floorH: fh, t, interior: config.interiors, style: dist.style, rng });
          addStamp(m, rt, { id, kind: 'building', zone: dist.zone, at: [lot.center[0], plaza, lot.center[1]], rot, w, d, height: pf.height, parts: pf.parts, style: dist.style, palette: config.styles[dist.style] || {}, tags: landmark ? ['landmark', landmark] : [], flatten: false, model: landmark && models[landmark] ? landmark : undefined }, problem);
          const door = pf.door ? [lot.center[0] + Math.sin(rot) * (d / 2), plaza + (pf.door[1] || 0), lot.center[1] + Math.cos(rot) * (d / 2)].map(n => +n.toFixed(3)) : null;
          lot.building = { id, floors, height: +pf.height.toFixed(3), style: dist.style, ...(landmark ? { landmark } : {}), interior: config.interiors, door, rot: +rot.toFixed(6), size: [+w.toFixed(3), +d.toFixed(3)] };
          buildings++;
        }
        lots.push(...lotsHere);
        // Street furniture along the sidewalks.
        if (config.streetProps.length) for (const eid of streetEdges) {
          const e = net.edges.find(x => x.id === eid), [a, b] = [e.points[0], e.points[1]], len = Math.hypot(b[0] - a[0], b[2] - a[2]), nx = -(b[2] - a[2]) / len, nz = (b[0] - a[0]) / len;
          for (let s = config.propSpacing / 2, k = 0; s < len - 4; s += config.propSpacing, k++) {
            const side = k % 2 ? 1 : -1, off = rw / 2 + config.sidewalk / 2, x = a[0] + ((b[0] - a[0]) * s) / len + nx * off * side, z = a[2] + ((b[2] - a[2]) * s) / len + nz * off * side;
            const kind = config.streetProps[Math.floor(rand2(subSeed(seed, 'props'), Math.round(x), Math.round(z)) * config.streetProps.length)];
            const pid = `${eid}~${kind}${k}`, tall = /lamp|light|sign|stop/.test(kind);
            props.push({ id: pid, kind: 'prop', prop: kind, at: [+x.toFixed(3), plaza, +z.toFixed(3)], zone: dist.zone });
            if (voxel) {
              const parts = tall ? [{ role: 'post', c: [0, 0], y: [0, 3 * C], size: [C, C] }, { role: 'light', c: [0, 0], y: [3 * C, 4 * C], size: [C, C] }] : known.has(kind) ? [{ role: 'decor', c: [0, 0], y: [0, C], size: [C, C] }] : null;
              if (parts) addStamp(m, rt, { id: pid, kind: 'prop', at: [x, plaza, z], rot: 0, w: C, d: C, height: parts[parts.length - 1].y[1], parts, style: '', palette: known.has(kind) ? { decor: kind } : {}, flatten: false }, problem);
            } else m.addObjects([{ id: pid, kind: 'prop', prop: kind, ...(models[kind] ? { model: kind } : {}), shape: 'cylinder', at: [+x.toFixed(3), plaza, +z.toFixed(3)], r: tall ? 0.15 : 0.35, h: tall ? 4 : 1, rot: 0, zone: dist.zone }]);
          }
        }
      });
      m.info.summary = { ...(m.info.summary || {}), lots: lots.length, buildings, streetNodes: net.nodes.filter(n => n.kind === 'street').length };
      ensureRoadLayer(m, rt);
    });
    provideRoadgraph(rt, model, { drive: config.drive });
    const lotIndex = () => {
      const m = model.ensure(); if (m.cache.lotIndex) return m.cache.lotIndex;
      const idx = new Map(), B = 64;
      for (const l of m.data.lots || []) for (let bx = Math.floor(l.rect[0] / B); bx <= Math.floor(l.rect[2] / B); bx++) for (let bz = Math.floor(l.rect[1] / B); bz <= Math.floor(l.rect[3] / B); bz++) { const k = bx * 65536 + bz; if (!idx.has(k)) idx.set(k, []); idx.get(k).push(l); }
      return (m.cache.lotIndex = { idx, B });
    };
    const lotAt = (x, z) => { const { idx, B } = lotIndex(); return (idx.get(Math.floor(x / B) * 65536 + Math.floor(z / B)) || []).find(l => inQuad(l.poly, x, z)) || null; };
    sharedService(rt, 'lotAt', model.sid, { call: lotAt, lots: zone => (model.ensure().data.lots || []).filter(l => !zone || l.zone === zone), get: id => (model.ensure().data.lots || []).find(l => l.id === id) || null, props: () => model.ensure().data.props || [] }, ['lots', 'get', 'props']);
  },
};
