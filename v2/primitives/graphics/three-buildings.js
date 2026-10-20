// Procedural building and road geometry for mesh3d worlds (pure part lists;
// no three.js). Buildings come from placed objects {size, floors, style};
// roads from the roadgraph service's edges.
import { hash01 } from './three-util.js';

export const BUILDING_STYLES = {
  thatch: { wall: '#d8c8a0', trim: '#5a4028', roof: '#b89a50', roofShape: 'gable', window: '#3a3020', chimney: true },
  stone: { wall: '#8a8478', trim: '#5a564e', roof: '#4a4e58', roofShape: 'gable', window: '#2a2a30', chimney: true },
  timber: { wall: '#9a7048', trim: '#4a3020', roof: '#5a3a28', roofShape: 'gable', window: '#2a2018' },
  'brick-historic': { wall: '#9a4a36', trim: '#e0d8c8', roof: '#3a3a40', roofShape: 'flat', window: '#203040', bands: true },
  'glass-tower': { wall: '#5a7a98', trim: '#c8d0d8', roof: '#4a5058', roofShape: 'flat', window: '#9ac8e8', glass: true },
  industrial: { wall: '#7a7a74', trim: '#4a4a48', roof: '#5a5a58', roofShape: 'shed', window: '#303438' },
  'timber-wharf': { wall: '#7a6a58', trim: '#3a3028', roof: '#4a4038', roofShape: 'gable', window: '#2a2420' },
  farmhouse: { wall: '#e8e0d0', trim: '#8a2a20', roof: '#8a2a20', roofShape: 'gable', window: '#30302a' },
  marina: { wall: '#e8eef2', trim: '#3a6a9a', roof: '#3a6a9a', roofShape: 'flat', window: '#4a7a9a' },
  hangar: { wall: '#8a9090', trim: '#5a6060', roof: '#7a8080', roofShape: 'vault', window: '#303438' },
  ruin: { wall: '#7a766c', trim: '#5a564e', roof: null, roofShape: 'none', window: '#1a1a1a', broken: true },
};
const styleOf = s => BUILDING_STYLES[s] || BUILDING_STYLES[Object.keys(BUILDING_STYLES).find(k => (s || '').includes(k.split('-')[0]))] || BUILDING_STYLES.stone;

/** Lowpoly parts for a building in its local frame (bottom centre at origin, front facing +z). */
export function buildingParts(o) {
  const st = styleOf(o.style), seed = o.id || `${o.at}`;
  const floors = Math.max(1, o.floors || Math.round((o.size?.[1] || 6) / 3));
  const [w, , d] = o.size || [8, floors * 3, 8];
  const fh = 3, H = o.size?.[1] && !o.floors ? o.size[1] : floors * fh;
  const P = [];
  const box = (at, size, c, extra = {}) => P.push({ shape: 'box', at, size, c, ...extra });
  box([0, -1.75, 0], [w + 0.4, 4.5, d + 0.4], st.trim, { name: 'plinth' }); // foundation reaching into sloped ground
  box([0, H / 2 + 0.25, 0], [w, H - 0.5, d], st.wall, { name: 'walls' });
  if (st.bands) for (let f = 1; f < floors; f++) box([0, f * fh + 0.1, 0], [w + 0.12, 0.2, d + 0.12], st.trim);
  // Windows: rows per floor on all four sides (capped for towers; glass towers get bands).
  if (st.glass) {
    for (let f = 0; f < floors; f++) box([0, f * fh + 1.6, 0], [w + 0.06, 1.7, d + 0.06], st.window, { mat: 'metal', name: 'glass' });
  } else {
    const perW = Math.max(1, Math.floor(w / 2.6)), perD = Math.max(1, Math.floor(d / 2.6));
    for (let f = 0; f < Math.min(floors, 12); f++) {
      const y = f * fh + 1.7;
      for (let i = 0; i < perW; i++) {
        const x = -w / 2 + (i + 0.5) * w / perW;
        if (!(f === 0 && i === Math.floor(perW / 2))) box([x, y, d / 2 + 0.03], [1, 1.2, 0.08], st.window, { mat: 'metal' });
        box([x, y, -d / 2 - 0.03], [1, 1.2, 0.08], st.window, { mat: 'metal' });
      }
      for (let i = 0; i < perD; i++) { const z = -d / 2 + (i + 0.5) * d / perD; box([w / 2 + 0.03, y, z], [0.08, 1.2, 1], st.window, { mat: 'metal' }); box([-w / 2 - 0.03, y, z], [0.08, 1.2, 1], st.window, { mat: 'metal' }); }
    }
    box([0, 1.2, d / 2 + 0.06], [1.3, 2.3, 0.12], st.trim, { name: 'door' });
  }
  // Roof.
  const top = H + 0.25;
  if (st.roofShape === 'gable') {
    const rh = Math.min(w, d) * 0.45;
    P.push({ shape: 'cone', at: [0, top + rh / 2, 0], size: [w * 1.45, rh, d * 1.45], segments: 4, rot: [0, Math.PI / 4, 0], c: st.roof, name: 'roof' });
  } else if (st.roofShape === 'shed') box([0, top + 0.6, 0], [w + 0.3, 0.3, d + 0.3], st.roof, { rot: [0.12, 0, 0], name: 'roof' });
  else if (st.roofShape === 'vault') P.push({ shape: 'cyl', at: [0, top, 0], size: [w, d * 1.02, w * 0.7], rot: [Math.PI / 2, 0, 0], c: st.roof, segments: 10, name: 'roof' });
  else if (st.roofShape === 'flat') { box([0, top + 0.15, 0], [w + 0.2, 0.3, d + 0.2], st.trim); if (hash01(seed) < 0.6) box([w * 0.2, top + 0.9, -d * 0.15], [w * 0.25, 1.2, d * 0.25], st.roof, { name: 'roof_unit' }); }
  if (st.chimney && hash01(seed, 3) < 0.7) box([w * 0.28, top + Math.min(w, d) * 0.45, d * 0.1], [0.6, Math.min(w, d) * 0.5, 0.6], st.trim, { name: 'chimney' });
  return { kind: 'lowpoly', palette: {}, parts: P, height: top };
}

/**
 * Road ribbon geometry along an edge's points (pure): returns { positions, colors, indices }
 * with width, terrain-following y from groundAt, a centre line for paved roads and kerbs.
 */
export function roadRibbon(edge, groundAt, { surfaceColors = {}, lift = 0.06 } = {}) {
  const pts = edge.points || [];
  const w = (edge.width || 6) / 2;
  const base = surfaceColors[edge.surface] || ({ asphalt: [0.05, 0.05, 0.055], cobble: [0.2, 0.18, 0.15], dirt: [0.28, 0.2, 0.12], gravel: [0.32, 0.3, 0.27] })[edge.surface] || [0.12, 0.11, 0.1];
  const pos = [], col = [], idx = [];
  if (pts.length < 2) return { positions: new Float32Array(), colors: new Float32Array(), indices: new Uint32Array() };
  // Resample to ~2 m steps so the ribbon follows the terrain.
  const dense = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[2] - a[2]), n = Math.max(1, Math.ceil(L / 2));
    for (let k = 0; k < n; k++) { const t = k / n; dense.push([a[0] + (b[0] - a[0]) * t, 0, a[2] + (b[2] - a[2]) * t]); }
  }
  dense.push(pts[pts.length - 1].slice());
  let along = 0;
  dense.forEach((p, i) => {
    const q = dense[Math.min(dense.length - 1, i + 1)], r = dense[Math.max(0, i - 1)];
    const dx = q[0] - r[0], dz = q[2] - r[2], l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
    if (i) along += Math.hypot(p[0] - dense[i - 1][0], p[2] - dense[i - 1][2]);
    const bridge = edge.bridge && Number.isFinite(p[1]) ? p[1] : null;
    for (const [s, shade] of [[-1, 0.85], [-0.06, 1], [0.06, 1], [1, 0.85]]) {
      const x = p[0] + nx * w * s, z = p[2] + nz * w * s;
      const y = (bridge ?? groundAt(x, z).y) + lift;
      pos.push(x, y, z);
      const line = edge.surface === 'asphalt' && Math.abs(s) < 0.1 && (along % 6) < 3;
      const c = line ? [0.75, 0.68, 0.3] : base.map(v => v * shade);
      col.push(c[0], c[1], c[2]);
    }
  });
  for (let i = 0; i < dense.length - 1; i++) for (let k = 0; k < 3; k++) { const a = i * 4 + k, b = a + 1, c = a + 4, d = c + 1; idx.push(a, b, c, b, d, c); }
  return { positions: new Float32Array(pos), colors: new Float32Array(col), indices: new Uint32Array(idx) };
}
