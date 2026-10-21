// Roads between zones for 3D spaces. Each link is routed by A* over a coarse
// terrain grid (cost: length, grade over maxGrade, water — bridged when
// allowed — and a smooth meander field scaled by curviness), simplified and
// smoothed, given a grade-limited height profile, then added to the shared
// road network (terrain flattened along it, bridges as decks). Endpoints
// snap to a district's street grid when engine.generate.city laid one out.
// Provides `roadgraph` (nodes, edges with lanes, routing) for traffic and crowds.
import { fbm2, subSeed } from './worlds3d-lib-noise.js';
import { STAGES, withDefaults, generatorModel, astar, simplify, chaikin, zoneCenter } from './worlds3d-lib-world.js';
import { roadNet, addNode, addEdge, ensureRoadLayer, provideRoadgraph, finalize } from './worlds3d-lib-roads.js';
import { addBridgeObjects } from './worlds3d-lib-prefab.js';

const card = {
  intent: 'Builds a road network linking zones: terrain-following roads with lanes, bridges over water and grade limits; feeds the road graph that traffic, crowds and route finding use.',
  views: ['any'],
  spaces: ['engine.space.mesh3d', 'engine.space.voxel'],
  params: {
    links: {
      type: 'list', min: 1, required: true, effect: 'roads to build',
      of: { type: 'object', fields: {
        from: { type: 'ref', to: 'zone', required: true }, to: { type: 'ref', to: 'zone', required: true },
        width: { type: 'number', min: 1, max: 30, default: 6, unit: 'm' }, surface: { type: 'string', default: 'asphalt', effect: 'asphalt, gravel, cobble, dirt, rail... (voxel: block id or alias)' },
        curviness: { type: 'number', min: 0, max: 1, default: 0.2, effect: 'how much the road meanders' }, bridge: { type: 'boolean', default: true, effect: 'may cross water on a bridge' },
        lanes: { type: 'integer', min: 1, max: 8, default: 2, effect: 'lanes (split between both directions; 1 = single shared lane)' },
        speed: { type: 'number', min: 5, max: 300, unit: 'km/h', effect: 'speed limit (default by surface)' },
      } },
    },
    snapToTerrain: { type: 'boolean', default: true, effect: 'follow the ground (cut and fill); false keeps a straight grade between ends' },
    maxGrade: { type: 'number', min: 0.01, max: 1, default: 0.12, effect: 'steepest road slope (rise/run) the router prefers' },
    grid: { type: 'number', min: 1, max: 256, unit: 'm', scale: 'world', effect: 'routing grid cell (default: world extent / 192)' },
    drive: { type: 'string', options: ['right', 'left'], default: 'right', effect: 'which side traffic drives on (lane placement)' },
    clearance: { type: 'number', min: 0.5, max: 30, default: 2.5, unit: 'm', effect: 'bridge deck height above water' },
    lineBlock: { type: 'string', default: 'road_line', effect: 'voxel: dashed centre-line block (skipped if absent)' },
    sidewalkBlock: { type: 'string', default: 'concrete', effect: 'voxel: sidewalk block' },
    deckBlock: { type: 'string', default: 'planks', effect: 'voxel: bridge deck block' },
  },
  provides: { content: ['road-network'], extent: 'overlay', services: ['roadgraph'], events: [] },
  reads: [],
};

const ROAD_BLOCKS = [['asphalt', '#3a3a3a'], ['road_line', '#e8e2c8'], ['concrete', '#a9a9a9'], ['planks', '#a0763f']];

export default {
  id: 'engine.generate.roads',
  card,
  /**
   * Planner hook (v2/planner/world.js): roads linking the space's zones in order: the order of a route another
   * primitive declares (a list param of zone refs, such as race checkpoints) when it names at least two of them,
   * else the zone order; zones off the route join their nearest routed zone. null with fewer than two zones.
   */
  scaffold(space, doc, { registry = null } = {}) {
    if (!card.spaces.includes(space.use)) return null;
    const zones = (space.zones || []).filter(z => zoneCenter(z)), ids = new Set(zones.map(z => z.id));
    if (zones.length < 2) return null;
    let route = null;
    for (const inst of doc.systems || []) {
      for (const [k, sch] of Object.entries(registry?.get(inst.use)?.card.params || {})) {
        const v = inst.with?.[k];
        if (sch.type === 'list' && sch.of?.type === 'ref' && sch.of.to === 'zone' && Array.isArray(v) && v.filter(x => ids.has(x)).length >= 2) { route = v.filter(x => ids.has(x)); break; }
      }
      if (route) break;
    }
    route ??= zones.map(z => z.id);
    const links = [], linked = (a, b) => links.some(l => (l.from === a && l.to === b) || (l.from === b && l.to === a));
    for (let i = 1; i < route.length; i++) if (route[i] !== route[i - 1] && !linked(route[i - 1], route[i])) links.push({ from: route[i - 1], to: route[i], width: 8 });
    const at = id => zoneCenter(zones.find(z => z.id === id));
    for (const z of zones) if (!route.includes(z.id)) {
      const c = zoneCenter(z), near = route.reduce((b, id) => (Math.hypot(at(id)[0] - c[0], at(id)[1] - c[1]) < Math.hypot(at(b)[0] - c[0], at(b)[1] - c[1]) ? id : b));
      links.push({ from: near, to: z.id, width: 6 });
    }
    const out = { with: { links } }, known = new Set((doc.content?.blocks || []).map(b => b?.id));
    if (space.use === 'engine.space.voxel' && known.size) { const add = ROAD_BLOCKS.filter(([id]) => !known.has(id)).map(([id, color]) => ({ id, name: id.replace('_', ' '), solid: true, color })); if (add.length) out.content = { blocks: add }; }
    return out;
  },
  validate(config) {
    return (config.links || []).flatMap((l, i) => (l.from === l.to ? [{ code: 'road_link_self', path: `with.links[${i}]`, message: `link from '${l.from}' to itself` }] : []));
  },
  install(rt, raw, instance) {
    const config = withDefaults(card, raw), model = generatorModel(rt, instance);
    if (!model) return;
    model.contribute(`roads#${instance.key}`, STAGES.roads, (m, seed) => {
      const net = roadNet(m), [x0, z0, x1, z1] = m.extent(), cs = config.grid ?? Math.max(4, Math.max(x1 - x0, z1 - z0) / 192);
      const NX = Math.ceil((x1 - x0) / cs) + 1, NZ = Math.ceil((z1 - z0) / cs) + 1, sea = m.info.sea ?? 0;
      const hgrid = new Float32Array(NX * NZ).fill(NaN), wgrid = new Float32Array(NX * NZ).fill(NaN);
      const ground = (x, z) => (m.surfaceY ? m.surfaceY(x, z) : m.at('height', x, z, 0));
      const H = (i, j) => { const k = i + NX * j; if (Number.isNaN(hgrid[k])) { const x = x0 + i * cs, z = z0 + j * cs, h = ground(x, z), w = m.at('water', x, z, null); hgrid[k] = h; wgrid[k] = w == null ? 0 : Math.max(0, w - h); } return hgrid[k]; };
      const Wd = (i, j) => { H(i, j); return wgrid[i + NX * j]; };
      const sMeander = subSeed(seed, 'meander'), mgrid = new Float32Array(NX * NZ).fill(NaN);
      const meander = (i, j) => { const k = i + NX * j; let v = mgrid[k]; if (Number.isNaN(v)) { v = mgrid[k] = 0.5 + 0.5 * fbm2(sMeander, (x0 + i * cs) / 160, (z0 + j * cs) / 160, 2); } return v; };
      const zoneNode = new Map();
      const endpoint = (zoneId, towards) => {
        // Prefer the street node of a city district in that zone nearest the other end.
        const streets = net.nodes.filter(n => n.zone === zoneId && n.kind === 'street');
        if (streets.length) return streets.reduce((b, n) => (Math.hypot(n.at[0] - towards[0], n.at[2] - towards[1]) < Math.hypot(b.at[0] - towards[0], b.at[2] - towards[1]) ? n : b)).id;
        if (zoneNode.has(zoneId)) return zoneNode.get(zoneId);
        const z = m.zone(zoneId), c = z && (z.spawn || z.at || zoneCenter(z));
        if (!c) return null;
        const at = c.length === 3 ? [c[0], ground(c[0], c[2]), c[2]] : [c[0], ground(c[0], c[1]), c[1]];
        const id = addNode(net, { at, kind: 'zone', zone: zoneId }); zoneNode.set(zoneId, id); return id;
      };
      let built = 0;
      config.links.forEach((link, li) => {
        const za = m.zone(link.from), zb = m.zone(link.to);
        if (!za || !zb) { m.problem('zone_missing', `road link ${link.from} -> ${link.to}: zone not in space '${m.sid}'`, { generator: instance.use, link: li }); return; }
        const ca = zoneCenter(za), cb = zoneCenter(zb), na = endpoint(link.from, cb), nb = endpoint(link.to, ca);
        const A = net.nodes.find(n => n.id === na).at, B = net.nodes.find(n => n.id === nb).at;
        const cell = p => [Math.max(0, Math.min(NX - 1, Math.round((p[0] - x0) / cs))), Math.max(0, Math.min(NZ - 1, Math.round((p[2] - z0) / cs)))];
        const s = cell(A), g = cell(B), maxG = config.maxGrade;
        const r = astar({
          start: s, isGoal: c => c[0] === g[0] && c[1] === g[1], key: c => c[0] * 100003 + c[1], maxNodes: NX * NZ,
          h: c => Math.hypot(c[0] - g[0], c[1] - g[1]) * cs * 1.3, // mildly greedy: roads need not be optimal
          neighbors(c, push) {
            for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
              const i = c[0] + di, j = c[1] + dj; if (i < 0 || j < 0 || i >= NX || j >= NZ) continue;
              const d = Math.hypot(di, dj) * cs, grade = Math.abs(H(i, j) - H(c[0], c[1])) / d, wet = Wd(i, j) > 0.2;
              if (wet && !link.bridge) continue;
              let cost = d * (1 + 4 * (grade / maxG) ** 2) * (grade > maxG * 3 ? 20 : 1);
              if (wet) cost *= 6;
              cost *= 1 + link.curviness * 1.5 * meander(i, j);
              push([i, j], cost);
            }
          },
        });
        let pts;
        if (r.path) pts = [[A[0], A[2]], ...r.path.slice(1, -1).map(([i, j]) => [x0 + i * cs, z0 + j * cs]), [B[0], B[2]]];
        else { m.problem('road_unroutable', `no route for ${link.from} -> ${link.to}${link.bridge ? '' : ' without a bridge'}; laid straight`, { generator: instance.use, link: li }); pts = [[A[0], A[2]], [B[0], B[2]]]; }
        pts = chaikin(simplify(pts, cs * 0.75), 2);
        // Resample to at most cs/2 per segment so the height profile follows the land.
        const dense = [pts[0]];
        for (let k = 1; k < pts.length; k++) { const a = pts[k - 1], b = pts[k], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (cs / 2))); for (let q = 1; q <= n; q++) dense.push([a[0] + (b[0] - a[0]) * q / n, a[1] + (b[1] - a[1]) * q / n]); }
        const wl = dense.map(([x, z]) => m.at('water', x, z, null)), gy = dense.map(([x, z]) => ground(x, z));
        const wet = dense.map((p, k) => wl[k] != null && wl[k] - gy[k] > 0.2);
        let ys;
        if (config.snapToTerrain) {
          ys = gy.map((y, k) => (wet[k] ? Math.max(y, wl[k] + config.clearance) : Math.max(y, sea + 0.5)));
          for (let pass = 0; pass < 2; pass++) ys = ys.map((y, k) => (k === 0 || k === ys.length - 1 ? y : (ys[k - 1] + 2 * y + ys[k + 1]) / 4));
        } else ys = dense.map((_, k) => gy[0] + (gy[gy.length - 1] - gy[0]) * k / (dense.length - 1));
        ys[0] = A[1]; ys[ys.length - 1] = B[1];
        // Limit grade both ways (iteratively relaxes toward the steepest allowed slope).
        const dist = k => Math.hypot(dense[k][0] - dense[k - 1][0], dense[k][1] - dense[k - 1][1]);
        for (let it = 0; it < 3; it++) {
          for (let k = 1; k < ys.length - 1; k++) { const lim = maxG * 1.5 * dist(k); ys[k] = Math.max(ys[k - 1] - lim, Math.min(ys[k - 1] + lim, ys[k])); }
          for (let k = ys.length - 2; k > 0; k--) { const lim = maxG * 1.5 * dist(k + 1); ys[k] = Math.max(ys[k + 1] - lim, Math.min(ys[k + 1] + lim, ys[k])); }
        }
        // Bridge spans also cover the banks right next to water.
        const bridge = wet.map((w, k) => w || (link.bridge && (wet[k - 1] || wet[k + 1]) && ys[k] - gy[k] > 1.5));
        if (bridge.some(Boolean) && !link.bridge) m.problem('road_wet', `road ${link.from} -> ${link.to} crosses water without a bridge`, { generator: instance.use, link: li });
        addEdge(m, net, { from: na, to: nb, points: dense.map(([x, z], k) => [x, ys[k], z]), bridge, width: link.width, surface: link.surface, lanes: link.lanes, speed: link.speed, kind: link.surface === 'rail' ? 'rail' : 'road', line: link.lanes >= 2 });
        built++;
      });
      m.info.summary = { ...(m.info.summary || {}), roads: built, roadNodes: net.nodes.length };
      ensureRoadLayer(m, rt, { lineBlock: config.lineBlock, sidewalkBlock: config.sidewalkBlock, deckBlock: config.deckBlock });
      if (m.kind === 'mesh3d') m.data.bridgesPending = true;
      m.data.finalizeRoads = () => finalize(net, { drive: config.drive });
    });
    // Bridge decks for mesh3d once the network is complete (structures stage runs after roads and city).
    model.contribute(`roads-decks#${instance.key}`, STAGES.structures - 1, m => { if (m.kind === 'mesh3d' && m.data.bridgesPending) { m.data.bridgesPending = false; addBridgeObjects(m, roadNet(m)); } });
    provideRoadgraph(rt, model, { drive: config.drive });
  },
};
