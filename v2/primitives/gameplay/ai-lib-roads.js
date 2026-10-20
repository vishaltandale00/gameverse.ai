// Road-graph adapter shared by gameplay.ai.traffic and gameplay.ai.crowd.
// Reads the `roadgraph` service as published by engine.generate.roads/city
// (ws-worlds3d): `rg()` / `rg.graph(space)` → {nodes, edges}; nodes {id, at,
// light, degree}; edges {id, from, to, points (polyline, y = road surface),
// width, sidewalk, speed km/h, lanes: [{id, dir: 1|-1|0, index, offset, width,
// from, to, speed m/s, points (offset, in travel order)}]}. Minimal graphs with
// edges {a, b} and no lanes get lanes synthesized (right-hand drive). A shared
// lane (dir 0) is driven both ways. The normalized graph is cached per source.
import { v3, sub, len, norm, mul, add, r6, round6 } from './ai-lib.js';

function sourceOf(rt, spaceId) {
  if (!rt.hasService('roadgraph')) return null;
  const rg = rt.service('roadgraph');
  const g = typeof rg === 'function' ? rg(spaceId) : typeof rg.graph === 'function' ? rg.graph(spaceId) : rg;
  if (!g) return null;
  const nodes = typeof g.nodes === 'function' ? g.nodes() : g.nodes || [];
  const edges = typeof g.edges === 'function' ? g.edges() : g.edges || [];
  return { nodes: Array.isArray(nodes) ? nodes : Object.entries(nodes).map(([id, n]) => ({ id, ...n })), edges: Array.isArray(edges) ? edges : Object.values(edges) };
}

const cumOf = pts => { const c = [0]; for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + len(sub(pts[i], pts[i - 1]))); return c; };
/** Offset a polyline sideways by `off` (right of travel, `up` the space's up axis or +z for planar maps). */
export function offsetLine(pts, off, up) {
  if (!off) return pts.map(v3);
  return pts.map((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], d = norm(sub(v3(b), v3(a))); return r6(add(v3(p), mul(rightOf(d, up), off))); });
}
/** Unit right of a travel direction (right-hand traffic). */
export function rightOf(dir, up) { const u = up || [0, 0, 1]; return norm([dir[1] * u[2] - dir[2] * u[1], dir[2] * u[0] - dir[0] * u[2], dir[0] * u[1] - dir[1] * u[0]]); }

/**
 * Normalized graph: { nodes: Map id → {id, at, light, out: [laneId]}, lanes: Map id → lane, edges: Map id → edge }
 * lane = {id, edge, from, to, points, cum, length, speed (m/s|null), index, reverseOf?}
 */
export function roadGraph(rt, { spaceId, up = null, laneWidth = 3 } = {}) {
  const src = sourceOf(rt, spaceId); if (!src) return null;
  const c = rt.caches.aiRoads;
  if (c && c.nodesRaw === src.nodes && c.edgesRaw === src.edges && c.n === src.nodes.length && c.m === src.edges.length) return c.graph;
  const nodes = new Map(src.nodes.map(n => [n.id, { id: n.id, at: v3(n.at), light: Boolean(n.light), degree: n.degree ?? 0, out: [] }]));
  const lanes = new Map(), edges = new Map();
  const addLane = l => { l.cum = cumOf(l.points); l.length = l.cum[l.cum.length - 1]; if (!(l.length > 0)) return; lanes.set(l.id, l); nodes.get(l.from)?.out.push(l.id); };
  src.edges.forEach((e, i) => {
    const from = e.from ?? e.a, to = e.to ?? e.b, A = nodes.get(from), B = nodes.get(to); if (!A || !B) return;
    const id = e.id ?? `e${i}`, pts = (e.points?.length >= 2 ? e.points : [A.at, B.at]).map(v3);
    const edge = { id, from, to, points: pts, width: e.width ?? laneWidth * 2, sidewalk: e.sidewalk === undefined ? 2 : e.sidewalk === true ? 2 : e.sidewalk === false ? 0 : e.sidewalk, speed: e.speed ?? null, kind: e.kind ?? 'road' };
    edges.set(id, edge);
    const speed = e.speed ? e.speed / 3.6 : null;
    if (Array.isArray(e.lanes) && e.lanes.length) {
      for (const l of e.lanes) {
        const lp = (l.points?.length >= 2 ? l.points : l.dir === -1 ? [...pts].reverse() : pts).map(v3);
        if (l.dir === 0) { addLane({ id: l.id, edge: id, from, to, points: lp, speed: l.speed ?? speed, index: l.index ?? 0 }); addLane({ id: `${l.id}:r`, edge: id, from: to, to: from, points: [...lp].reverse(), speed: l.speed ?? speed, index: l.index ?? 0, reverseOf: l.id }); }
        else addLane({ id: l.id, edge: id, from: l.from ?? (l.dir === -1 ? to : from), to: l.to ?? (l.dir === -1 ? from : to), points: lp, speed: l.speed ?? speed, index: l.index ?? 0 });
      }
    } else {
      const n = Math.max(1, Number.isInteger(e.lanes) ? e.lanes : 1);
      for (let k = 0; k < n; k++) {
        addLane({ id: `${id}:f${k}`, edge: id, from, to, points: offsetLine(pts, laneWidth * (k + 0.5), up), speed, index: k });
        if (!e.oneway) addLane({ id: `${id}:b${k}`, edge: id, from: to, to: from, points: offsetLine([...pts].reverse(), laneWidth * (k + 0.5), up), speed, index: k });
      }
    }
  });
  const graph = { nodes, lanes, edges };
  rt.caches.aiRoads = { nodesRaw: src.nodes, edgesRaw: src.edges, n: src.nodes.length, m: src.edges.length, graph };
  return graph;
}

/** Point and unit direction at distance s along a lane polyline. */
export function along(lane, s) {
  const c = lane.cum, pts = lane.points, d = Math.max(0, Math.min(lane.length, s));
  let i = 1; while (i < c.length - 1 && c[i] < d) i++;
  const a = pts[i - 1], b = pts[i], seg = c[i] - c[i - 1] || 1, t = (d - c[i - 1]) / seg;
  return { at: r6(add(a, mul(sub(b, a), t))), dir: r6(norm(sub(b, a))) };
}

/** Next lane out of the lane's end node: same lane index when possible, no U-turn unless a dead end. */
export function nextLane(rt, G, lane) {
  const node = G.nodes.get(lane.to); if (!node) return null;
  const outs = node.out.map(id => G.lanes.get(id)).filter(l => l && l.edge !== lane.edge);
  const list = outs.length ? outs : node.out.map(id => G.lanes.get(id)).filter(Boolean);
  if (!list.length) return null;
  const edgesOut = [...new Set(list.map(l => l.edge))];
  const pickEdge = edgesOut[Math.floor(rt.random() * edgesOut.length)];
  const cands = list.filter(l => l.edge === pickEdge);
  return cands.find(l => l.index === lane.index) || cands[0];
}

/** Sidewalk polylines of an edge (both sides), for pedestrians. */
export function sidewalks(edge, up) {
  if (!(edge.sidewalk > 0)) return [];
  const off = edge.width / 2 + edge.sidewalk / 2;
  return [{ side: 1, points: offsetLine(edge.points, off, up) }, { side: -1, points: offsetLine(edge.points, -off, up) }].map(w => ({ ...w, cum: cumOf(w.points), length: cumOf(w.points).at(-1) }));
}
export { round6 };
