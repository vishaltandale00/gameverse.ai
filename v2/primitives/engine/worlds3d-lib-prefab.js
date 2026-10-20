// Procedural prefabs for 3D structures (worlds3d workstream), shared by
// engine.generate.structures and engine.generate.city. A prefab is a list of
// parts in structure-local metres (x = width, z = depth with the front door at
// +z, y = up from the ground) tagged with a material role. The same parts
// become voxel cells (via a style palette of block ids) or mesh3d colliders,
// so a house or tower is defined once for both kinds of space.
//
// Part: { role, c: [x, z], y: [y0, y1], size: [sx, sz], rot? } (oriented box)
//     | { role, c: [x, z], y: [y0, y1], r }                     (cylinder)
// Roles: foundation floor wall window roof trim post deck fence light ladder
// decor (solid) and door carve (cleared to air).
import { smoothstep } from './worlds3d-lib-noise.js';

export const KINDS = ['house', 'hut', 'tower', 'camp', 'ruin', 'shrine', 'bridge', 'gate', 'arena', 'cabin', 'mine', 'building', 'lot', 'plaza'];
export const DEFAULT_SIZE = { house: [10, 8], hut: [6, 6], tower: [8, 24], camp: [16, 16], ruin: [10, 8], shrine: [4, 4], bridge: [6, 24], gate: [16, 4], arena: [40, 32], cabin: [8, 7], mine: [4, 4], building: [12, 12], lot: [16, 16], plaza: [20, 20] };
const AIR = new Set(['door', 'carve']);
const PITCHED = /thatch|timber|farm|cabin|log|plank|rotted|stilt|wayside|wharf|marina|cottage/;

const box = (role, x0, y0, z0, x1, y1, z1, extra = {}) => ({ role, c: [(x0 + x1) / 2, (z0 + z1) / 2], y: [y0, y1], size: [x1 - x0, z1 - z0], ...extra });
const cyl = (role, x, z, r, y0, y1) => ({ role, c: [x, z], y: [y0, y1], r });

/** Four walls of a w x d footprint, height H, thickness t; front (+z) wall gets a door opening when door is set. */
function walls(w, d, H, t, { door = true, y0 = 0, role = 'wall' } = {}) {
  const out = [box(role, -w / 2, y0, -d / 2, w / 2, H, -d / 2 + t), box(role, -w / 2, y0, -d / 2 + t, -w / 2 + t, H, d / 2 - t), box(role, w / 2 - t, y0, -d / 2 + t, w / 2, H, d / 2 - t)];
  if (door) { const dw = Math.max(t, 1.2) / 2; out.push(box(role, -w / 2, y0, d / 2 - t, -dw, H, d / 2), box(role, dw, y0, d / 2 - t, w / 2, H, d / 2), box(role, -dw, Math.min(H, 2.2 + y0 + t), d / 2 - t, dw, H, d / 2)); }
  else out.push(box(role, -w / 2, y0, d / 2 - t, w / 2, H, d / 2));
  return out;
}
/** Window strips on every floor of each side, spaced about every 3 m. */
function windows(w, d, F, fh, t) {
  const out = [];
  for (let f = 0; f < F; f++) {
    const y0 = f * fh + Math.min(1, fh * 0.3), y1 = y0 + Math.min(1.4, fh * 0.45);
    for (let x = -w / 2 + 2; x <= w / 2 - 2; x += 3) { out.push(box('window', x - 0.5, y0, -d / 2, x + 0.5, y1, -d / 2 + t)); if (f > 0 || Math.abs(x) > 1.5) out.push(box('window', x - 0.5, y0, d / 2 - t, x + 0.5, y1, d / 2)); }
    for (let z = -d / 2 + 2; z <= d / 2 - 2; z += 3) out.push(box('window', -w / 2, y0, z - 0.5, -w / 2 + t, y1, z + 0.5), box('window', w / 2 - t, y0, z - 0.5, w / 2, y1, z + 0.5));
  }
  return out;
}
function roof(w, d, H, t, pitched) {
  if (!pitched) return [box('roof', -w / 2, H, -d / 2, w / 2, H + t, d / 2), ...walls(w, d, H + t + 1, t, { door: false, y0: H + t, role: 'trim' })];
  const out = []; let k = 0;
  for (let half = w / 2 + t; half > t / 2 && k < 64; half -= t, k++) out.push(box('roof', -half, H + k * t, -d / 2 - t, half, H + (k + 1) * t, d / 2 + t));
  return out;
}
function interiorFloors(w, d, F, fh, t) {
  const out = [box('floor', -w / 2 + t, 0, -d / 2 + t, w / 2 - t, t, d / 2 - t)];
  for (let f = 1; f < F; f++) out.push(box('floor', -w / 2 + t, f * fh - t, -d / 2 + t, w / 2 - t, f * fh, d / 2 - t));
  if (F > 1) { // ladder shaft in the back-left corner
    const lx = -w / 2 + t, lz = -d / 2 + t;
    for (let f = 1; f < F; f++) out.push(box('carve', lx, f * fh - t, lz, lx + Math.max(t, 1), f * fh, lz + Math.max(t, 1)));
    out.push(box('ladder', lx, t, lz, lx + Math.max(t, 1), (F - 1) * fh + t, lz + Math.max(t, 0.3)));
  }
  return out;
}

/**
 * Parts for a structure kind. o: { w, d, h?, floors?, floorH, t (wall/cell thickness), interior, style, rng }.
 * Returns { parts, height, door: [x, y, z] local | null, rooms: [{min, max}] local }.
 */
export function prefab(kind, o) {
  const { w, d, t, rng, floorH: fh } = o, style = o.style || '';
  const pitched = PITCHED.test(style) || kind === 'hut' || kind === 'cabin';
  const parts = [box('foundation', -w / 2, -6, -d / 2, w / 2, 0, d / 2)];
  let height = 0, door = null; const rooms = [];
  const building = (F) => {
    const H = F * fh; height = H;
    if (o.interior) { parts.push(...walls(w, d, H, t), ...windows(w, d, F, fh, t), ...interiorFloors(w, d, F, fh, t)); door = [0, t, d / 2]; for (let f = 0; f < F; f++) rooms.push({ min: [-w / 2 + t, f * fh + t, -d / 2 + t], max: [w / 2 - t, (f + 1) * fh - t, d / 2 - t] }); }
    else parts.push(box('wall', -w / 2, 0, -d / 2, w / 2, H, d / 2), ...windows(w, d, F, fh, t), box('trim', -0.6, 0, d / 2 - t, 0.6, Math.min(H, 2.2), d / 2));
    parts.push(...roof(w, d, H, t, pitched));
    height = parts.reduce((m, p) => Math.max(m, p.y[1]), 0);
  };
  switch (kind) {
    case 'house': case 'cabin': case 'building': building(o.floors ?? (kind === 'cabin' ? 1 : rng.int(1, 2))); break;
    case 'hut': building(1); break;
    case 'tower': {
      const H = o.h ?? 24, F = Math.max(1, Math.floor(H / fh));
      building(F);
      for (let x = -w / 2; x < w / 2; x += 2 * Math.max(t, 0.5)) parts.push(box('trim', x, F * fh + t, -d / 2, x + Math.max(t, 0.5), F * fh + t + 1.5, -d / 2 + t), box('trim', x, F * fh + t, d / 2 - t, x + Math.max(t, 0.5), F * fh + t + 1.5, d / 2));
      height = F * fh + t + 1.5; break;
    }
    case 'ruin': {
      const H = fh * (o.floors ?? 1) * 1.2;
      parts.push(box('floor', -w / 2, -0.2, -d / 2, w / 2, 0, d / 2));
      for (const seg of walls(w, d, H, t, { door: true })) {
        const along = seg.size[0] > seg.size[1] ? 0 : 1, len = seg.size[along], n = Math.max(1, Math.round(len / 2));
        for (let k = 0; k < n; k++) {
          if (rng.next() < 0.3) continue;
          const c = seg.c.slice(); c[along] = seg.c[along] - len / 2 + (k + 0.5) * (len / n);
          const size = seg.size.slice(); size[along] = len / n;
          parts.push({ role: 'wall', c, y: [0, H * rng.range(0.25, 1)], size });
        }
      }
      for (let k = 0; k < 4; k++) { const x = rng.range(-w / 2, w / 2 - 1), z = rng.range(-d / 2, d / 2 - 1); parts.push(box('decor', x, 0, z, x + 1, 1, z + 1)); } // rubble
      height = H; break;
    }
    case 'camp': {
      const R = Math.min(w, d) / 2, n = Math.max(8, Math.round((2 * Math.PI * R) / 1.5));
      for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.35) continue; parts.push(cyl('post', Math.sin(a) * R, Math.cos(a) * R, Math.max(0.2, t / 2), 0, 2.6)); }
      const tents = rng.int(2, 4);
      for (let k = 0; k < tents; k++) { const a = Math.PI + ((k - (tents - 1) / 2) / tents) * 2.2, r = R * 0.55, x = Math.sin(a) * r, z = Math.cos(a) * r; parts.push(box('roof', x - 1.5, 0, z - 1.5, x + 1.5, 1.2, z + 1.5), box('roof', x - 0.75, 1.2, z - 1.5, x + 0.75, 2.2, z + 1.5)); }
      parts.push(box('light', -0.5, 0, -0.5, 0.5, 0.5, 0.5));
      parts.splice(0, 1); height = 2.6; break;
    }
    case 'shrine': {
      parts.splice(0, 1, box('foundation', -w / 2, -3, -d / 2, w / 2, 0.5, d / 2));
      parts.push(box('post', -0.5, 0.5, -0.5, 0.5, 2.5, 0.5), box('light', -0.5, 2.5, -0.5, 0.5, 3, 0.5));
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) parts.push(box('post', sx * (w / 2) - (sx > 0 ? t : 0), 0.5, sz * (d / 2) - (sz > 0 ? t : 0), sx * (w / 2) + (sx < 0 ? t : 0), 3.5, sz * (d / 2) + (sz < 0 ? t : 0)));
      parts.push(box('roof', -w / 2 - t, 3.5, -d / 2 - t, w / 2 + t, 3.5 + t, d / 2 + t));
      height = 3.5 + t; break;
    }
    case 'bridge': {
      parts.splice(0, 1);
      parts.push(box('deck', -w / 2, -t, -d / 2, w / 2, 0, d / 2), box('fence', -w / 2, 0, -d / 2, -w / 2 + t, 1, d / 2), box('fence', w / 2 - t, 0, -d / 2, w / 2, 1, d / 2));
      for (let z = -d / 2 + 2; z < d / 2; z += 6) parts.push(box('post', -w / 2, -14, z, -w / 2 + t, -t, z + t), box('post', w / 2 - t, -14, z, w / 2, -t, z + t));
      if (/broken/.test(style)) parts.push(box('carve', -w / 2 - 1, -t - 1, -1.5, w / 2 + 1, 2, 1.5));
      height = 1; break;
    }
    case 'gate': {
      const H = o.h ?? 8, open = Math.min(4, w / 3);
      parts.push(box('wall', -w / 2, 0, -d / 2, -open / 2, H, d / 2), box('wall', open / 2, 0, -d / 2, w / 2, H, d / 2), box('wall', -open / 2, 5, -d / 2, open / 2, H, d / 2));
      for (const s of [-1, 1]) parts.push(box('wall', s * w / 2 - 2, 0, -d / 2 - 1, s * w / 2 + 2, H + 3, d / 2 + 1));
      height = H + 3; break;
    }
    case 'arena': {
      const H = o.h ?? 6, n = 20, rx = w / 2, rz = d / 2;
      parts.push(box('floor', -rx, -0.2, -rz, rx, 0, rz));
      for (let k = 0; k < n; k++) {
        const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
        if (Math.abs(Math.sin(am)) < 0.16) continue; // entrances front and back (+z / -z)
        const p0 = [Math.sin(a0) * rx, Math.cos(a0) * rz], p1 = [Math.sin(a1) * rx, Math.cos(a1) * rz], len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + t;
        parts.push({ role: 'wall', c: [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2], y: [0, H], size: [t * 1.5, len], rot: Math.atan2(p1[0] - p0[0], p1[1] - p0[1]) });
      }
      if (o.interior) parts.push(box('roof', -rx, H, -rz, rx, H + t, rz));
      rooms.push({ min: [-rx + t, 0, -rz + t], max: [rx - t, H, rz - t] }); door = [0, 0, rz];
      height = H + (o.interior ? t : 0); break;
    }
    case 'mine': {
      parts.splice(0, 1);
      parts.push(box('post', -2, 0, 1, -1.5, 3.5, 1.5), box('post', 1.5, 0, 1, 2, 3.5, 1.5), box('trim', -2, 3.5, 1, 2, 4, 1.5));
      for (let k = 0; k < 14; k++) parts.push(box('carve', -1.5, -k * 0.8, 1.5 - (k + 1) * 2, 1.5, 3.2 - k * 0.8, 1.5 - k * 2 + 0.5));
      door = [0, 0, 1.5]; height = 4; break;
    }
    case 'lot': {
      parts.splice(0, 1, box('foundation', -w / 2, -2, -d / 2, w / 2, 0, d / 2));
      for (const [x0, z0, x1, z1] of [[-w / 2, -d / 2, w / 2, -d / 2 + t], [-w / 2, d / 2 - t, -1, d / 2], [1, d / 2 - t, w / 2, d / 2], [-w / 2, -d / 2, -w / 2 + t, d / 2], [w / 2 - t, -d / 2, w / 2, d / 2]]) parts.push(box('fence', x0, 0, z0, x1, 1, z1));
      height = 1; break;
    }
    case 'plaza': parts.splice(0, 1, box('floor', -w / 2, -2, -d / 2, w / 2, 0, d / 2)); parts.push(box('light', -0.5, 0, -0.5, 0.5, 3, 0.5)); height = 3; break;
    default: building(1);
  }
  return { parts, height, door, rooms };
}

// ---------- materials ----------
const ROLE_DEFAULTS = {
  foundation: ['cobblestone', 'stone'], floor: ['planks', 'concrete', 'stone'], wall: ['planks', 'brick', 'stone'], window: ['glass'], roof: ['planks', 'brick', 'stone'],
  trim: ['log', 'cobblestone', 'stone'], post: ['log', 'planks', 'stone'], deck: ['planks', 'stone'], fence: ['planks', 'log'], light: ['lamp', 'neon', 'glass'], ladder: ['ladder'], decor: ['cobblestone', 'gravel', 'stone'],
};
const STYLE_WORDS = [
  [/glass/, { wall: ['glass', 'concrete'], window: ['glass'], floor: ['concrete'], roof: ['concrete'], trim: ['steel_beam', 'concrete'] }],
  [/brick|historic/, { wall: ['brick'], roof: ['brick', 'stone'], trim: ['stone', 'cobblestone'], floor: ['planks'] }],
  [/industrial|hangar|scrap|steel/, { wall: ['concrete', 'steel_beam'], roof: ['steel_beam', 'concrete'], trim: ['steel_beam'], floor: ['concrete'] }],
  [/stone|dome|vault|crypt|cairn|giant|warden|spire|niche/, { wall: ['stone', 'cobblestone', 'brick'], roof: ['stone', 'cobblestone'], floor: ['cobblestone', 'stone'], trim: ['cobblestone'] }],
  [/log|cabin|timber-arch/, { wall: ['log', 'planks'], trim: ['log'], post: ['log'] }],
  [/timber|plank|wharf|marina|farm|stilt|thatch|rotted|wayside/, { wall: ['planks'], roof: ['planks', 'brick'], trim: ['log'] }],
  [/overgrown|ruin|charred|ash|icebound|rust/, { wall: ['cobblestone', 'stone'], decor: ['gravel', 'cobblestone'] }],
  [/neon|radio|diner/, { light: ['neon', 'lamp'] }],
];
/** role -> block id for a style, restricted to content.blocks when it lists any. */
export function stylePalette(style = '', known, overrides = {}, problem) {
  const words = STYLE_WORDS.filter(([re]) => re.test(style)).map(([, v]) => v), out = {};
  for (const role of Object.keys(ROLE_DEFAULTS)) {
    const cand = [...[].concat(overrides[role] ?? []), ...words.flatMap(w => w[role] || []), ...ROLE_DEFAULTS[role]];
    out[role] = known.size ? cand.find(c => known.has(c)) ?? (known.has('stone') ? 'stone' : [...known][0]) : cand[0];
    if (known.size && overrides[role] && !known.has(overrides[role])) problem?.('block_unknown', `style '${style}' ${role} block '${overrides[role]}' is not in content.blocks`);
  }
  return out;
}

// ---------- transforms ----------
/** World footprint corners of an oriented part (three.js yaw: local +z faces (sin rot, cos rot)). */
export const toWorld = (at, rot, lx, lz) => [at[0] + lx * Math.cos(rot) + lz * Math.sin(rot), at[2] - lx * Math.sin(rot) + lz * Math.cos(rot)];
export const toLocal = (at, rot, x, z) => { const dx = x - at[0], dz = z - at[2]; return [dx * Math.cos(rot) - dz * Math.sin(rot), dx * Math.sin(rot) + dz * Math.cos(rot)]; };
export function stampBox(st) {
  const r = Math.hypot(st.w, st.d) / 2 + 2;
  return [st.at[0] - r, st.at[2] - r, st.at[0] + r, st.at[2] + r];
}

/** Register a placed structure: flattens its footprint and stamps voxel cells or adds mesh3d colliders. */
export function addStamp(m, rt, st, problem) {
  st.bbox = stampBox(st);
  const [x0, z0, x1, z1] = st.bbox, gy = st.at[1], hw = st.w / 2 + 1, hd = st.d / 2 + 1, blend = 4;
  if (st.flatten !== false) m.modify('height', { bounds: [x0 - blend, z0 - blend, x1 + blend, z1 + blend], priority: 30, apply(x, z, h) {
    const [lx, lz] = toLocal(st.at, st.rot, x, z), dx = Math.max(0, Math.abs(lx) - hw), dz = Math.max(0, Math.abs(lz) - hd), d = Math.hypot(dx, dz);
    if (d === 0) return gy - (m.kind === 'voxel' ? (m.opts.cell || 1) : 0);
    return d >= blend ? h : (gy - (m.kind === 'voxel' ? (m.opts.cell || 1) : 0)) + (h - gy) * smoothstep(0, blend, d);
  } });
  if (m.kind === 'voxel') {
    const known = new Set((rt.doc.content?.blocks || []).map(b => b.id));
    st.blocks = stylePalette(st.style, known, st.palette || {}, problem);
    (m.data.stamps ??= []).push(st);
    m.data.stampIndex = null;
    if (!m.data.stampLayer) { m.data.stampLayer = true; m.addLayer({ id: 'structures', order: 50, chunk: ctx => rasterize(m, ctx) }); }
  } else {
    const objs = [{ id: st.id, kind: st.kind, shape: 'none', at: st.at.slice(), size: [st.w, st.height, st.d], rot: st.rot, style: st.style, tags: st.tags || [], structure: true, ...(st.model ? { model: st.model } : {}) }];
    st.parts.forEach((p, k) => {
      if (AIR.has(p.role) || p.role === 'window' || p.role === 'foundation' || p.role === 'ladder' || p.role === 'decor' || p.role === 'light') return;
      const [cx, cz] = toWorld(st.at, st.rot, p.c[0], p.c[1]), at = [+cx.toFixed(3), +(gy + p.y[0]).toFixed(3), +cz.toFixed(3)];
      if (p.r !== undefined) objs.push({ id: `${st.id}#${k}`, kind: st.kind, group: st.id, role: p.role, shape: 'cylinder', at, r: p.r, h: p.y[1] - p.y[0], rot: 0 });
      else objs.push({ id: `${st.id}#${k}`, kind: st.kind, group: st.id, role: p.role, shape: 'box', at, size: [p.size[0], p.y[1] - p.y[0], p.size[1]], rot: +(st.rot + (p.rot || 0)).toFixed(6) });
    });
    m.addObjects(objs);
  }
}

function stampIndex(m) {
  if (m.data.stampIndex) return m.data.stampIndex;
  const idx = new Map(), B = 32;
  for (const st of m.data.stamps || []) for (let bx = Math.floor(st.bbox[0] / B); bx <= Math.floor(st.bbox[2] / B); bx++) for (let bz = Math.floor(st.bbox[1] / B); bz <= Math.floor(st.bbox[3] / B); bz++) { const k = bx * 65536 + bz; if (!idx.has(k)) idx.set(k, []); idx.get(k).push(st); }
  return (m.data.stampIndex = { idx, B });
}
/** Voxel: rasterise every stamp overlapping a chunk; a cell is in a part when its centre is. */
function rasterize(m, ctx) {
  const { sx, sy, sz, x0, y0, z0, cell: C, cells } = ctx, { idx, B } = stampIndex(m), seen = new Set();
  const wx0 = x0 * C, wz0 = z0 * C, wx1 = (x0 + sx) * C, wz1 = (z0 + sz) * C;
  for (let bx = Math.floor(wx0 / B); bx <= Math.floor((wx1 - 1e-9) / B); bx++) for (let bz = Math.floor(wz0 / B); bz <= Math.floor((wz1 - 1e-9) / B); bz++) for (const st of idx.get(bx * 65536 + bz) || []) {
    if (seen.has(st)) continue; seen.add(st);
    if (st.bbox[2] < wx0 || st.bbox[0] > wx1 || st.bbox[3] < wz0 || st.bbox[1] > wz1) continue;
    const ids = {}; for (const [role, id] of Object.entries(st.blocks)) ids[role] = ctx.idx(id);
    for (const p of st.parts) {
      const y0w = st.at[1] + p.y[0], y1w = st.at[1] + p.y[1];
      const ya = Math.max(y0, Math.ceil(y0w / C - 0.5)), yb = Math.min(y0 + sy - 1, Math.floor(y1w / C - 0.5)); if (ya > yb) continue;
      const rr = p.r !== undefined ? p.r : Math.hypot(p.size[0], p.size[1]) / 2, [cx, cz] = toWorld(st.at, st.rot, p.c[0], p.c[1]);
      const xa = Math.max(x0, Math.floor((cx - rr) / C)), xb = Math.min(x0 + sx - 1, Math.floor((cx + rr) / C)), za = Math.max(z0, Math.floor((cz - rr) / C)), zb = Math.min(z0 + sz - 1, Math.floor((cz + rr) / C));
      const value = AIR.has(p.role) ? 0 : ids[p.role] ?? ids.wall, foundation = p.role === 'foundation', pr = st.rot + (p.rot || 0);
      for (let x = xa; x <= xb; x++) for (let z = za; z <= zb; z++) {
        const wx = (x + 0.5) * C, wz = (z + 0.5) * C;
        if (p.r !== undefined) { if ((wx - cx) ** 2 + (wz - cz) ** 2 > p.r * p.r) continue; }
        else { const dx = wx - cx, dz = wz - cz, lx = dx * Math.cos(pr) - dz * Math.sin(pr), lz = dx * Math.sin(pr) + dz * Math.cos(pr); if (Math.abs(lx) > p.size[0] / 2 || Math.abs(lz) > p.size[1] / 2) continue; }
        for (let y = ya; y <= yb; y++) {
          const k = (x - x0) + sx * ((z - z0) + sz * (y - y0));
          if (foundation && cells[k] && ctx.isSolid(cells[k])) continue; // foundations only fill gaps under the floor
          cells[k] = value;
        }
      }
    }
  }
}

/** mesh3d: deck colliders (and piers) for every bridge span of a road network. */
export function addBridgeObjects(m, net) {
  const objs = [];
  for (const e of net.edges) for (let k = 1; k < e.points.length; k++) {
    if (!(e.bridge[k - 1] && e.bridge[k])) continue;
    const a = e.points[k - 1], b = e.points[k], dx = b[0] - a[0], dz = b[2] - a[2], len = Math.hypot(dx, dz), y = Math.min(a[1], b[1]) - 0.5;
    objs.push({ id: `${e.id}~deck${k}`, kind: 'bridge', role: 'deck', group: e.id, shape: 'box', at: [+((a[0] + b[0]) / 2).toFixed(3), +y.toFixed(3), +((a[2] + b[2]) / 2).toFixed(3)], size: [e.width + 1, 0.5 + Math.abs(a[1] - b[1]), len + 0.2], rot: +Math.atan2(dx, dz).toFixed(6) });
    if (k % 3 === 0) objs.push({ id: `${e.id}~pier${k}`, kind: 'bridge', role: 'post', group: e.id, shape: 'cylinder', at: [a[0], y - 30, a[2]], r: 0.8, h: 30 });
  }
  if (objs.length) m.addObjects(objs);
}
