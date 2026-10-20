// Road network shared by engine.generate.roads (zone-to-zone links) and
// engine.generate.city (street grids). Edges are terrain-following polylines
// that flatten the height field (cut and fill) except on bridges; on voxel a
// cell layer paves them, on mesh3d they set the ground material and bridges
// become deck colliders. The finished graph (split at crossings, with lanes
// per direction) is served as `roadgraph` for traffic, crowds and navigation.
import { smoothstep } from './worlds3d-lib-noise.js';
import { segDist2, offsetPolyline, polylineLength, sharedService, MinHeap } from './worlds3d-lib-world.js';

const SPEED = { asphalt: 50, concrete: 50, cobble: 30, gravel: 30, dirt: 25, rail: 40, planks: 20 };
const ALIAS = { cobble: ['cobblestone', 'cobble', 'stone'], asphalt: ['asphalt', 'concrete', 'stone'], gravel: ['gravel', 'dirt'], rail: ['rail'], dirt: ['dirt'], concrete: ['concrete', 'stone'], planks: ['planks'] };

export function roadNet(m) { return (m.data.roads ??= { nodes: [], edges: [], final: false, seq: 0, buckets: null }); }
export function addNode(net, { at, kind = 'junction', zone = null }) {
  const id = `n${net.nodes.length + 1}`;
  net.nodes.push({ id, at: at.map(v => +v.toFixed(3)), kind, zone });
  net.final = false; return id;
}
const near = (net, id) => net.nodes.find(n => n.id === id);

/**
 * Add an edge: points [[x, y, z]...] from node `from` to node `to`.
 * bridge: per-point flags (deck over water/gaps: terrain is left alone).
 * Registers terrain flattening (priority 20) and the ground material.
 */
export function addEdge(m, net, e) {
  const id = `r${net.edges.length + 1}`, bridge = e.bridge || e.points.map(() => false);
  const edge = { id, from: e.from, to: e.to, kind: e.kind || 'road', points: e.points.map(p => p.map(v => +v.toFixed(3))), bridge, width: e.width, surface: e.surface || 'asphalt', lanes: e.lanes ?? 2, speed: e.speed ?? SPEED[e.surface] ?? 40, sidewalk: e.sidewalk || 0, zone: e.zone ?? null, line: e.line ?? true };
  net.edges.push(edge); net.final = false; net.buckets = null;
  const half = edge.width / 2, shoulder = e.shoulder ?? Math.max(2, edge.width * 0.5), reach = half + edge.sidewalk + shoulder;
  for (let k = 1; k < edge.points.length; k++) {
    if (bridge[k - 1] && bridge[k]) continue;
    const a = edge.points[k - 1], b = edge.points[k];
    const bounds = [Math.min(a[0], b[0]) - reach, Math.min(a[2], b[2]) - reach, Math.max(a[0], b[0]) + reach, Math.max(a[2], b[2]) + reach];
    if (e.flatten !== false) m.modify('height', { bounds, priority: 20 + (edge.kind === 'street' ? 0 : 1), apply(x, z, h) {
      const s = segDist2(x, z, a[0], a[2], b[0], b[2]), d = Math.sqrt(s.d2); if (d > reach) return h;
      const y = a[1] + (b[1] - a[1]) * s.t;
      return d <= half + edge.sidewalk ? y : y + (h - y) * smoothstep(half + edge.sidewalk, reach, d);
    } });
    m.modify('material', { bounds, priority: 20, apply(x, z, v) { const s = segDist2(x, z, a[0], a[2], b[0], b[2]); return s.d2 <= half * half ? edge.surface : s.d2 <= (half + edge.sidewalk) ** 2 ? 'sidewalk' : v; } });
  }
  return id;
}

/** Segment-bucket index for nearest-edge queries and the voxel paving layer. */
function buckets(net, size = 32) {
  if (net.buckets) return net.buckets;
  const b = new Map();
  for (const e of net.edges) for (let k = 1; k < e.points.length; k++) {
    const a = e.points[k - 1], c = e.points[k], r = e.width / 2 + e.sidewalk + 2;
    for (let bx = Math.floor((Math.min(a[0], c[0]) - r) / size); bx <= Math.floor((Math.max(a[0], c[0]) + r) / size); bx++) for (let bz = Math.floor((Math.min(a[2], c[2]) - r) / size); bz <= Math.floor((Math.max(a[2], c[2]) + r) / size); bz++) {
      const key = bx * 65536 + bz; if (!b.has(key)) b.set(key, []); b.get(key).push([e, k]);
    }
  }
  return (net.buckets = { size, map: b });
}
export function segmentsNear(net, x, z) { const b = buckets(net); return b.map.get(Math.floor(x / b.size) * 65536 + Math.floor(z / b.size)) || []; }
/** Nearest road point within maxDist: {edge, k, t, point, dist} or null. */
export function nearestRoad(net, x, z, maxDist = Infinity) {
  let best = null; const b = buckets(net), R = Number.isFinite(maxDist) ? Math.ceil(maxDist / b.size) : 2;
  for (let r = 0; r <= R; r++) {
    for (let bx = Math.floor(x / b.size) - r; bx <= Math.floor(x / b.size) + r; bx++) for (let bz = Math.floor(z / b.size) - r; bz <= Math.floor(z / b.size) + r; bz++) {
      if (Math.max(Math.abs(bx - Math.floor(x / b.size)), Math.abs(bz - Math.floor(z / b.size))) !== r) continue;
      for (const [e, k] of b.map.get(bx * 65536 + bz) || []) {
        const a = e.points[k - 1], c = e.points[k], s = segDist2(x, z, a[0], a[2], c[0], c[2]), d = Math.sqrt(s.d2);
        if (d <= maxDist && (!best || d < best.dist)) best = { edge: e.id, k, t: s.t, dist: d, point: a.map((v, i) => v + (c[i] - v) * s.t) };
      }
    }
    if (best && best.dist <= r * b.size) break;
  }
  if (!best && !Number.isFinite(maxDist)) for (const e of net.edges) for (let k = 1; k < e.points.length; k++) { const a = e.points[k - 1], c = e.points[k], s = segDist2(x, z, a[0], a[2], c[0], c[2]), d = Math.sqrt(s.d2); if (!best || d < best.dist) best = { edge: e.id, k, t: s.t, dist: d, point: a.map((v, i) => v + (c[i] - v) * s.t) }; }
  return best;
}

const cross = (p, q, r, s) => {
  const d = (q[0] - p[0]) * (s[2] - r[2]) - (q[2] - p[2]) * (s[0] - r[0]); if (Math.abs(d) < 1e-9) return null;
  const t = ((r[0] - p[0]) * (s[2] - r[2]) - (r[2] - p[2]) * (s[0] - r[0])) / d, u = ((r[0] - p[0]) * (q[2] - p[2]) - (r[2] - p[2]) * (q[0] - p[0])) / d;
  return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6 ? { t, u } : null;
};

/**
 * Split edges where they cross (at-grade: not where exactly one side is a
 * bridge), add junction nodes, and build lanes and adjacency. Idempotent.
 */
export function finalize(net, { drive = 'right' } = {}) {
  if (net.final) return net;
  const raw = net.edges, cuts = new Map(raw.map(e => [e.id, []]));
  const b = buckets(net), seenPair = new Set();
  for (const list of b.map.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const [e1, k1] = list[i], [e2, k2] = list[j]; if (e1 === e2) continue;
    const key = `${e1.id}:${k1}|${e2.id}:${k2}`; if (seenPair.has(key)) continue; seenPair.add(key);
    const x = cross(e1.points[k1 - 1], e1.points[k1], e2.points[k2 - 1], e2.points[k2]); if (!x) continue;
    if ((e1.bridge[k1 - 1] && e1.bridge[k1]) !== (e2.bridge[k2 - 1] && e2.bridge[k2])) continue; // bridge over road: no junction
    const p = e1.points[k1 - 1].map((v, n) => v + (e1.points[k1][n] - v) * x.t);
    const node = addNode(net, { at: p, kind: 'junction' });
    cuts.get(e1.id).push({ k: k1, t: x.t, node, p }); cuts.get(e2.id).push({ k: k2, t: x.u, node, p });
  }
  const edges = [];
  for (const e of raw) {
    const cs = cuts.get(e.id).sort((a, c) => a.k - c.k || a.t - c.t);
    let from = e.from, pts = [e.points[0]], br = [e.bridge[0]], k = 1, part = 0;
    const flush = (to, last, lastBridge) => { pts.push(last); br.push(lastBridge); if (polylineLength(pts) > 1e-6) edges.push({ ...e, id: cs.length ? `${e.id}.${++part}` : e.id, parent: e.id, from, to, points: pts, bridge: br }); };
    for (const c of cs) {
      for (; k < c.k; k++) { pts.push(e.points[k]); br.push(e.bridge[k]); }
      flush(c.node, c.p.map(v => +v.toFixed(3)), e.bridge[c.k - 1] && e.bridge[c.k]);
      from = c.node; pts = [c.p.map(v => +v.toFixed(3))]; br = [e.bridge[c.k - 1] && e.bridge[c.k]];
    }
    for (; k < e.points.length - 1; k++) { pts.push(e.points[k]); br.push(e.bridge[k]); }
    flush(e.to, e.points[e.points.length - 1], e.bridge[e.points.length - 1]);
  }
  const side = drive === 'left' ? 1 : -1;
  for (const e of edges) {
    e.length = +polylineLength(e.points).toFixed(3);
    const L = Math.max(1, e.lanes), lw = e.width / L, fwd = L === 1 ? 1 : Math.ceil(L / 2), back = L === 1 ? 0 : L - fwd;
    e.lanes = [];
    for (let i = 0; i < fwd; i++) { const off = L === 1 ? 0 : side * (i + 0.5) * lw; e.lanes.push({ id: `${e.id}:f${i}`, edge: e.id, dir: L === 1 ? 0 : 1, index: i, offset: +off.toFixed(3), width: +lw.toFixed(3), from: e.from, to: e.to, speed: +(e.speed / 3.6).toFixed(3), points: offsetPolyline(e.points, off).map(p => p.map(v => +v.toFixed(3))) }); }
    for (let i = 0; i < back; i++) { const off = -side * (i + 0.5) * lw; e.lanes.push({ id: `${e.id}:b${i}`, edge: e.id, dir: -1, index: i, offset: +off.toFixed(3), width: +lw.toFixed(3), from: e.to, to: e.from, speed: +(e.speed / 3.6).toFixed(3), points: offsetPolyline(e.points, off).reverse().map(p => p.map(v => +v.toFixed(3))) }); }
  }
  net.raw = raw; net.edges = edges; net.buckets = null; net.final = true;
  net.adj = new Map(net.nodes.map(n => [n.id, []]));
  for (const e of edges) { net.adj.get(e.from)?.push([e.to, e.length, e.id]); net.adj.get(e.to)?.push([e.from, e.length, e.id]); }
  net.edgeIndex = new Map(edges.map(e => [e.id, e]));
  return net;
}

/** Dijkstra between two nodes; {nodes, edges, length} or null. */
export function routeNodes(net, a, b) {
  const dist = new Map([[a, 0]]), prev = new Map(), heap = new MinHeap(); heap.push(0, a);
  while (heap.size) {
    const n = heap.pop(); if (n === b) break;
    for (const [m2, w, eid] of net.adj.get(n) || []) { const d = dist.get(n) + w; if (d < (dist.get(m2) ?? Infinity)) { dist.set(m2, d); prev.set(m2, [n, eid]); heap.push(d, m2); } }
  }
  if (!dist.has(b)) return null;
  const nodes = [b], edges = []; for (let n = b; prev.has(n); n = prev.get(n)[0]) { edges.unshift(prev.get(n)[1]); nodes.unshift(prev.get(n)[0]); }
  return { nodes, edges, length: +dist.get(b).toFixed(3) };
}

/** Register the `roadgraph` service for a model's space (idempotent per space). */
export function provideRoadgraph(rt, model, opts = {}) {
  const key = `worlds3d:roadsvc:${model.sid}`; if (rt.caches[key]) return; rt.caches[key] = true;
  const net = () => finalize(roadNet(model.ensure()), opts);
  const graph = () => { const n = net(); return { nodes: n.nodes, edges: n.edges }; };
  const nearestNode = (at) => { const n = net(); let best = null; for (const node of n.nodes) { const d = Math.hypot(node.at[0] - at[0], node.at[2] - at[at.length === 2 ? 1 : 2]); if (!best || d < best.d) best = { id: node.id, d }; } return best?.id ?? null; };
  sharedService(rt, 'roadgraph', model.sid, {
    call: graph, graph,
    node: id => net().nodes.find(x => x.id === id) || null,
    edge: id => net().edgeIndex.get(id) || null,
    lane: id => { const [eid] = id.split(':'); return net().edgeIndex.get(eid)?.lanes.find(l => l.id === id) || null; },
    lanesFrom: nodeId => net().edges.flatMap(e => e.lanes.filter(l => l.from === nodeId || (l.dir === 0 && l.to === nodeId))),
    nearestNode,
    nearest: (at, maxDist) => nearestRoad(net(), at[0], at[at.length === 2 ? 1 : 2], maxDist),
    /** Road route between two positions: node and edge ids plus the polyline. */
    route(fromAt, toAt) {
      const n = net(), a = nearestNode(fromAt), b = nearestNode(toAt); if (!a || !b) return null;
      const r = routeNodes(n, a, b); if (!r) return null;
      const points = [];
      r.edges.forEach((eid, i) => { const e = n.edgeIndex.get(eid), pts = e.from === r.nodes[i] ? e.points : [...e.points].reverse(); points.push(...(points.length ? pts.slice(1) : pts)); });
      return { ...r, points };
    },
  }, ['graph', 'node', 'edge', 'lane', 'lanesFrom', 'nearestNode', 'nearest', 'route']);
}

/** Voxel block for a road surface name, from content.blocks (non-solid surfaces such as rail sit on a base block). */
export function surfaceBlocks(surface, known, blockDefs) {
  const cand = [surface, ...(ALIAS[surface] || [])];
  const top = cand.find(c => known.has(c)) ?? surface;
  const def = blockDefs.get(top);
  if (def && def.solid === false) return { base: ['gravel', 'stone'].find(c => known.has(c)) ?? 'gravel', over: top };
  return { base: top, over: null };
}

/** Voxel paving layer for every edge in the net (idempotent per model build). */
export function ensureRoadLayer(m, rt, { lineBlock = 'road_line', sidewalkBlock = 'concrete', deckBlock = 'planks', clearance = 4 } = {}) {
  if (m.kind !== 'voxel' || m.data.roadLayer) return;
  m.data.roadLayer = true;
  const blocks = rt.doc.content?.blocks || [], known = new Set(blocks.map(b => b.id)), defs = new Map(blocks.map(b => [b.id, b]));
  const pick = (want, ...alts) => [want, ...alts].find(c => known.has(c)) ?? (known.size ? undefined : want);
  const sidewalk = pick(sidewalkBlock, 'stone'), deck = pick(deckBlock, 'planks', 'stone'), line = known.size ? (known.has(lineBlock) ? lineBlock : undefined) : lineBlock;
  m.addLayer({
    id: 'roads', order: 40,
    chunk(ctx) {
      const net = roadNet(m); if (!net.edges.length) return;
      const { sx, sy, sz, x0, y0, z0, cell: C, cells } = ctx, surf = new Map();
      for (let lz = 0; lz < sz; lz++) for (let lx = 0; lx < sx; lx++) {
        const x = (x0 + lx + 0.5) * C, z = (z0 + lz + 0.5) * C;
        let best = null;
        for (const [e, k] of segmentsNear(net, x, z)) {
          const a = e.points[k - 1], b = e.points[k], s = segDist2(x, z, a[0], a[2], b[0], b[2]), d = Math.sqrt(s.d2);
          if (d <= e.width / 2 + e.sidewalk && (!best || d < best.d)) best = { e, k, s, d, y: a[1] + (b[1] - a[1]) * s.t, bridge: e.bridge[k - 1] && e.bridge[k], along: k + s.t };
        }
        if (!best) continue;
        const e = best.e, top = Math.floor(best.y / C), onRoad = best.d <= e.width / 2;
        let sb = surf.get(e.surface); if (!sb) { sb = surfaceBlocks(e.surface, known, defs); surf.set(e.surface, sb); }
        const put = (y, id) => { if (id !== undefined && y >= y0 && y < y0 + sy) cells[lx + sx * (lz + sz * (y - y0))] = id === null ? 0 : ctx.idx(id); }; // null clears, undefined skips
        if (best.bridge) {
          put(top, deck);
          if (!onRoad || best.d > e.width / 2 - C) put(top + 1, deck); // rail
          if (Math.abs(((x0 + lx) + (z0 + lz)) % 8) === 0 && onRoad && Math.abs(best.d) < C) for (let y = top - 1; y > top - 40 && y >= 1; y--) { if (y < y0 || y >= y0 + sy) continue; const c = cells[lx + sx * (lz + sz * (y - y0))]; if (c && ctx.isSolid(c)) break; put(y, deck); }
          continue;
        }
        const dashed = line && onRoad && e.lanes >= 2 && e.kind !== 'path' && Math.abs(best.d) < C * 0.5 && Math.floor(best.along * 2) % 2 === 0;
        put(top, onRoad ? (dashed ? line : sb.base) : sidewalk);
        if (onRoad && sb.over) put(top + 1, sb.over);
        for (let y = top + (onRoad && sb.over ? 2 : 1); y <= top + clearance; y++) { const k = lx + sx * (lz + sz * (y - y0)); if (y >= y0 && y < y0 + sy && !ctx.isFluid(cells[k])) cells[k] = 0; }
      }
    },
  });
}
