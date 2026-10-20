// Space-agnostic geometry for maps, minimaps and compasses. Every space kind
// describes zones its own way (catalog §2): rect [x0,y0,x1,y1] (tilemap, grid,
// test), bounds {min,max} or {center,r} or polygon (voxel, mesh3d), or graph
// nodes with exits and no coordinates. This module turns all of them into 2D
// map geometry on one plane, and lays out graphs deterministically.

/** Which world axes form the map plane: 'xz' for 3D spaces, 'xy' for 2D. */
export function planeOf(space) {
  if (/voxel|mesh3d/.test(space?.use || '')) return 'xz';
  const zones = space?.zones || [];
  if (zones.some(z => z.bounds || z.polygon || z.center)) return 'xz';
  return 'xy';
}
export const isGraph = space => /space\.(graph|none)/.test(space?.use || '') || ((space?.zones || []).length > 0 && (space.zones || []).every(z => !z.rect && !z.bounds && !z.polygon && !z.center && !z.at));

/** Project a world position onto the map plane: [u, v] with v pointing "north" (up on the map). */
export function project(at, plane) {
  if (!Array.isArray(at)) return null;
  return plane === 'xz' ? [at[0] ?? 0, -(at[2] ?? 0)] : [at[0] ?? 0, at[1] ?? 0];
}

/** Zone outline on the plane: { kind:'poly', points:[[u,v]..] } or { kind:'circle', c:[u,v], r }, or null. */
export function zoneShape(zone, plane) {
  if (zone.rect) { const [x0, y0, x1, y1] = zone.rect; return { kind: 'poly', points: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] }; }
  const b = zone.bounds;
  if (b?.min && b?.max) { const p = [project(b.min, plane), project(b.max, plane)]; const [u0, u1] = [Math.min(p[0][0], p[1][0]), Math.max(p[0][0], p[1][0])], [v0, v1] = [Math.min(p[0][1], p[1][1]), Math.max(p[0][1], p[1][1])]; return { kind: 'poly', points: [[u0, v0], [u1, v0], [u1, v1], [u0, v1]] }; }
  const c = b?.center || zone.center;
  if (c) { const r = b?.r ?? zone.r ?? 10; return { kind: 'circle', c: c.length === 2 ? (plane === 'xz' ? [c[0], -c[1]] : c) : project(c, plane), r }; }
  if (zone.polygon) return { kind: 'poly', points: zone.polygon.map(p => (plane === 'xz' ? [p[0], -p[1]] : p)) };
  if (Array.isArray(zone.at)) { const p = project(zone.at, plane); return { kind: 'circle', c: p, r: zone.r ?? 4 }; }
  return null;
}
export function shapeCenter(s) {
  if (!s) return null;
  if (s.kind === 'circle') return s.c;
  const n = s.points.length; return [s.points.reduce((a, p) => a + p[0], 0) / n, s.points.reduce((a, p) => a + p[1], 0) / n];
}
export function shapeBounds(shapes) {
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
  for (const s of shapes) {
    if (!s) continue;
    const pts = s.kind === 'circle' ? [[s.c[0] - s.r, s.c[1] - s.r], [s.c[0] + s.r, s.c[1] + s.r]] : s.points;
    for (const [u, v] of pts) { u0 = Math.min(u0, u); v0 = Math.min(v0, v); u1 = Math.max(u1, u); v1 = Math.max(v1, v); }
  }
  return Number.isFinite(u0) ? [u0, v0, u1, v1] : [0, 0, 1, 1];
}
export function insideShape(s, [u, v]) {
  if (!s) return false;
  if (s.kind === 'circle') return Math.hypot(u - s.c[0], v - s.c[1]) <= s.r;
  let inside = false;
  for (let i = 0, j = s.points.length - 1; i < s.points.length; j = i++) {
    const [ui, vi] = s.points[i], [uj, vj] = s.points[j];
    if ((vi > v) !== (vj > v) && u < ((uj - ui) * (v - vi)) / (vj - vi) + ui) inside = !inside;
  }
  return inside;
}

/**
 * Deterministic layered layout for graph spaces: BFS depth from the start
 * zone gives the column, discovery order gives the row. Returns { zoneId: [u, v] }.
 */
export function graphLayout(zones, start) {
  const ids = zones.map(z => z.id), byId = new Map(zones.map(z => [z.id, z]));
  const depth = new Map(), order = [];
  const root = byId.has(start) ? start : ids[0];
  const visit = from => {
    const q = [from]; depth.set(from, depth.get(from) ?? 0);
    while (q.length) {
      const id = q.shift(); order.push(id);
      for (const e of byId.get(id)?.exits || []) { const to = e.to ?? e; if (byId.has(to) && !depth.has(to)) { depth.set(to, depth.get(id) + 1); q.push(to); } }
    }
  };
  if (root) visit(root);
  for (const id of ids) if (!depth.has(id)) { depth.set(id, 0); visit(id); }
  const rows = new Map(), pos = {};
  for (const id of order) { const d = depth.get(id), r = rows.get(d) || 0; rows.set(d, r + 1); pos[id] = [d * 10, -r * 7]; }
  // Centre each column vertically.
  for (const [d, n] of rows) for (const id of order) if (depth.get(id) === d) pos[id] = [pos[id][0], pos[id][1] + ((n - 1) * 7) / 2];
  return pos;
}

/** Map geometry for one space: { plane, graph, zones:[{id,name,tags,shape,center}], edges:[[a,b]], bounds }. */
export function spaceGeometry(space, start) {
  const zones = space?.zones || [];
  if (isGraph(space)) {
    const pos = graphLayout(zones, start);
    const out = zones.map(z => ({ id: z.id, name: z.name || z.id, tags: z.tags || [], shape: { kind: 'circle', c: pos[z.id], r: 2.2 }, center: pos[z.id], exits: z.exits || [] }));
    const edges = []; const seen = new Set();
    for (const z of zones) for (const e of z.exits || []) { const to = e.to ?? e, k = [z.id, to].sort().join('>'); if (pos[to] && !seen.has(k)) { seen.add(k); edges.push([z.id, to, Boolean(e.gate)]); } }
    return { plane: 'graph', graph: true, zones: out, edges, bounds: shapeBounds(out.map(z => z.shape)) };
  }
  const plane = planeOf(space);
  const out = zones.map(z => { const shape = zoneShape(z, plane); return { id: z.id, name: z.name || z.id, tags: z.tags || [], shape, center: shapeCenter(shape) }; }).filter(z => z.shape);
  return { plane, graph: false, zones: out, edges: [], bounds: shapeBounds(out.map(z => z.shape)) };
}

/** Player heading in radians on the map plane (0 = north/up, clockwise), or null. */
export function heading(entity, plane) {
  const f = entity?.components?.body?.facing ?? entity?.components?.facing;
  if (typeof f === 'number') return plane === 'xz' ? f : (f < 0 ? -Math.PI / 2 : Math.PI / 2);
  if (Array.isArray(f)) { const [x, z] = f.length >= 3 ? [f[0], f[2]] : f; return Math.atan2(x, plane === 'xz' ? -z : z); }
  if (f === 'left') return -Math.PI / 2; if (f === 'right') return Math.PI / 2;
  return null;
}
/** Bearing (radians, 0 = north, clockwise) from a to b on the map plane. */
export const bearing = (a, b) => Math.atan2(b[0] - a[0], b[1] - a[1]);
