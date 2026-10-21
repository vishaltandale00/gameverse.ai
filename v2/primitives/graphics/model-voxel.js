// graphics.model.voxel: layered palette grids -> voxel meshes for characters,
// mobs, vehicles and props, greedy-meshed with ambient occlusion (the same
// mesher as world chunks). Parts named for the rig (head, torso, armL...) are
// meshed per bone so graphics.rig.* can animate them; wheels and rotors become
// spin nodes. Lowpoly and generated specs can be voxelized for voxel worlds.
import { joinStage, presentationOnly } from './three-stage.js';
import { padVolume, meshVolume } from './three-voxel-mesh.js';
import { PART_ALIASES } from './rig-humanoid.js';
import { eulerMatrix } from './three-rig.js';
import { colorOf } from './three-util.js';
import { resolveColor } from './model-lowpoly.js';
import { modelsData, docExample } from './model-lib.js';

/** Primary rig part names (their own bone); everything else attaches by alias or to the nearest primary part. */
export const PRIMARY = { head: 'head', torso: 'chest', body: 'chest', armL: 'upperArmL', armR: 'upperArmR', legL: 'upperLegL', legR: 'upperLegR' };
export const SPIN = /wheel|rotor|propeller|prop$|fan/;

/**
 * Convert a voxel spec to model-space part boxes (metres, feet at y=0, facing +z, left at +x).
 * Spec convention (authored): front at z=0 (-z), right at +x, y up, units = voxels.
 */
export function voxelBoxes(spec, voxelSize = 0.0625) {
  const [w, , d] = spec.size || [16, 16, 16];
  return (spec.parts || []).map(p => {
    const [x, y, z, bw, bh, bd] = p.box;
    const x0 = -(x + bw - w / 2) * voxelSize, x1 = -(x - w / 2) * voxelSize, z0 = -(z + bd - d / 2) * voxelSize, z1 = -(z - d / 2) * voxelSize;
    return { name: p.name, c: p.c, min: [x0, y * voxelSize, z0], max: [x1, (y + bh) * voxelSize, z1], box: p.box };
  });
}

/**
 * Assign every voxel of the spec to a group (bone or spin node) and return
 * { size, groups: Map group -> Uint16 grid (palette index per voxel, x fastest then y then z), keys: palette keys }.
 * group(name) chooses a part's group: primary parts map to bones, aliases to their bone,
 * others to the nearest primary part per voxel (boots split across both legs).
 */
export function voxelGroups(spec, { rigged = false } = {}) {
  const [w, h, d] = spec.size || [16, 16, 16];
  const keys = [null, ...Object.keys(spec.palette || {})];
  const keyIndex = c => { let i = keys.indexOf(c); if (i < 0) { keys.push(c); i = keys.length - 1; } return i; };
  const owner = new Int16Array(w * h * d).fill(-1), color = new Uint16Array(w * h * d);
  const groupNames = [];
  const gi = name => { let i = groupNames.indexOf(name); if (i < 0) { groupNames.push(name); i = groupNames.length - 1; } return i; };
  const primaries = rigged ? spec.parts.filter(p => PRIMARY[p.name]) : [];
  const idx = (x, y, z) => x + w * (y + h * z);
  for (const p of spec.parts || []) {
    const [bx, by, bz, bw, bh, bd] = p.box;
    let fixed = null;
    if (SPIN.test(p.name || '')) fixed = `spin:${p.name}`;
    else if (rigged) fixed = PRIMARY[p.name] || (PART_ALIASES[p.name] && !['hips'].includes(PART_ALIASES[p.name]) ? PART_ALIASES[p.name] : null);
    else fixed = 'body';
    for (let z = Math.max(0, bz); z < Math.min(d, bz + bd); z++) for (let y = Math.max(0, by); y < Math.min(h, by + bh); y++) for (let x = Math.max(0, bx); x < Math.min(w, bx + bw); x++) {
      let g = fixed;
      if (!g) {
        // Nearest primary part box to this voxel centre.
        let best = null, bd2 = Infinity;
        for (const q of primaries) {
          const [qx, qy, qz, qw, qh, qd] = q.box;
          const dx = Math.max(qx - (x + 0.5), 0, (x + 0.5) - (qx + qw)), dy = Math.max(qy - (y + 0.5), 0, (y + 0.5) - (qy + qh)), dz = Math.max(qz - (z + 0.5), 0, (z + 0.5) - (qz + qd));
          const dd = dx * dx + dy * dy * 0.25 + dz * dz; if (dd < bd2) { bd2 = dd; best = q; }
        }
        g = best ? PRIMARY[best.name] : 'chest';
      }
      owner[idx(x, y, z)] = gi(g); color[idx(x, y, z)] = keyIndex(p.c);
    }
  }
  const groups = new Map();
  groupNames.forEach((name, g) => {
    const grid = new Uint16Array(w * h * d);
    for (let i = 0; i < grid.length; i++) if (owner[i] === g) grid[i] = color[i];
    groups.set(name, grid);
  });
  return { size: [w, h, d], groups, keys };
}

/** Greedy-mesh each group; returns Map group -> { opaque, transparent, origin (spec voxel space) }. */
export function meshVoxelGroups(spec, { rigged = false, ao = true, faceShade = [1, 0.75, 0.88], emissiveKeys = new Set(), palette } = {}) {
  const { size, groups, keys } = voxelGroups(spec, { rigged });
  const [w, h] = size;
  const pal = palette || spec.palette || {};
  const materials = keys.map(k => k == null ? null : { color: colorOf(resolveColor(k, pal)), opaque: true, emissive: emissiveKeys.has(k) || /glow|light|lamp|eye_glow/.test(k) ? 1 : 0 });
  const out = new Map();
  for (const [name, grid] of groups) {
    const get = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= w || y >= h || z >= size[2]) ? 0 : grid[x + w * (y + h * z)];
    const mesh = meshVolume(padVolume(size, get), size, materials, { ao, faceShade });
    out.set(name, mesh);
  }
  return { meshes: out, size, keys };
}

/** Rasterize lowpoly parts into a voxel spec (for voxel-styled worlds). res = voxel edge in metres. */
export function voxelizeParts(parts, palette, res = 0.0625) {
  if (!parts.length) return { kind: 'voxel', size: [1, 1, 1], palette, parts: [] };
  const inv = parts.map(p => {
    let at = p.at || [0, 0, 0], size = p.size || [1, 1, 1], R = eulerMatrix(p.rot || [0, 0, 0]);
    if (p.from && p.to) {
      const d = [p.to[0] - p.from[0], p.to[1] - p.from[1], p.to[2] - p.from[2]], L = Math.hypot(...d) || 1e-6, u = d.map(v => v / L);
      at = p.from.map((v, i) => (v + p.to[i]) / 2); size = [p.size?.[0] ?? 0.1, L, p.size?.[2] ?? p.size?.[0] ?? 0.1];
      // Rotation taking +y to u (Rodrigues).
      const ax = [u[2], 0, -u[0]], s = Math.hypot(ax[0], ax[2]), c = u[1];
      if (s < 1e-6) R = c > 0 ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : [1, 0, 0, 0, -1, 0, 0, 0, -1];
      else { const k = ax.map(v => v / s), t = 1 - c; R = [t * k[0] * k[0] + c, -s * k[2], t * k[0] * k[2], s * k[2], c, -s * k[0], t * k[0] * k[2], s * k[0], t * k[2] * k[2] + c]; }
    }
    const half = Math.max(size[0], size[1], size[2]) * 0.6;
    return { p, at, size, R, lo: at.map(v => v - half), hi: at.map(v => v + half) };
  });
  const lo = [0, 1, 2].map(a => Math.min(...inv.map(i => i.lo[a]))), hi = [0, 1, 2].map(a => Math.max(...inv.map(i => i.hi[a])));
  lo[1] = Math.min(0, lo[1]);
  const dims = [0, 1, 2].map(a => Math.max(1, Math.ceil((hi[a] - lo[a]) / res)));
  const inside = (q, x, y, z) => {
    const dx = x - q.at[0], dy = y - q.at[1], dz = z - q.at[2], R = q.R;
    // local = R^T * d, normalised to half-size
    let lx = (R[0] * dx + R[3] * dy + R[6] * dz) / (q.size[0] / 2), ly = (R[1] * dx + R[4] * dy + R[7] * dz) / (q.size[1] / 2), lz = (R[2] * dx + R[5] * dy + R[8] * dz) / (q.size[2] / 2);
    const shape = q.p.shape || 'box';
    if (shape === 'box') { const t = q.p.taper ? 1 + (q.p.taper - 1) * (ly + 1) / 2 : 1; return Math.abs(ly) <= 1 && Math.abs(lx) <= t && Math.abs(lz) <= t; }
    if (shape === 'sphere') return lx * lx + ly * ly + lz * lz <= 1;
    if (shape === 'cone') return Math.abs(ly) <= 1 && Math.hypot(lx, lz) <= (1 - ly) / 2;
    if (shape === 'cyl') return Math.abs(ly) <= 1 && lx * lx + lz * lz <= 1;
    // capsule
    const ry = q.size[0] / q.size[1]; const cy = Math.max(-1 + ry, Math.min(1 - ry, ly));
    return lx * lx + ((ly - cy) / ry) ** 2 + lz * lz <= 1;
  };
  // Emit one voxel part per filled cell run along x (keeps the spec format; names keep bones).
  const out = [];
  const grid = new Array(dims[0] * dims[1] * dims[2]).fill(null);
  for (let z = 0; z < dims[2]; z++) for (let y = 0; y < dims[1]; y++) for (let x = 0; x < dims[0]; x++) {
    const px = lo[0] + (x + 0.5) * res, py = lo[1] + (y + 0.5) * res, pz = lo[2] + (z + 0.5) * res;
    for (let k = inv.length - 1; k >= 0; k--) if (inside(inv[k], px, py, pz)) { grid[x + dims[0] * (y + dims[1] * z)] = inv[k].p; break; }
  }
  // Model space (+z front, +x left) -> voxel spec space (front at z=0, right at +x): flip x and z.
  for (let z = 0; z < dims[2]; z++) for (let y = 0; y < dims[1]; y++) {
    let x = 0;
    while (x < dims[0]) {
      const p = grid[x + dims[0] * (y + dims[1] * z)]; if (!p) { x++; continue; }
      let run = 1; while (x + run < dims[0] && grid[x + run + dims[0] * (y + dims[1] * z)] === p) run++;
      out.push({ box: [dims[0] - x - run, y, dims[2] - 1 - z, run, 1, 1], c: p.c, name: p.name || p.bone });
      x += run;
    }
  }
  return { kind: 'voxel', size: dims, palette, parts: out, offset: [lo[0], lo[1], lo[2]], voxelized: true };
}

export default {
  id: 'graphics.model.voxel',
  card: {
    intent: 'Layered palette grids turned into greedy-meshed, ambient-occluded voxel models for characters, mobs, vehicles and props. Parts named for the rig (head, torso, armL, armR, legL, legR) animate through graphics.rig.*; wheels and rotors spin; lowpoly or generated models are voxelized in voxel-styled worlds.',
    views: ['1p', '3p', 'iso'],
    params: {
      voxelSize: { type: 'number', default: 0.0625, min: 0.01, max: 1, unit: 'm', effect: 'edge length of one model voxel' },
      bake: { type: 'boolean', default: true, effect: 'merge unrigged models into one mesh and instance repeated props' },
      fitBody: { type: 'boolean', default: true, effect: 'scale models so their height matches the entity body height when it has one' },
      ao: { type: 'boolean', default: true, effect: 'ambient occlusion inside models' },
      voxelizeOthers: { type: 'boolean', default: true, effect: 'voxelize lowpoly and generated models so a voxel world stays one style' },
    },
    provides: {},
    reads: ['content.models'],
    data: { 'content.models': modelsData(['kind', 'palette', 'parts', 'size', 'rig', 'height']) },
    rules: {
      model_size: { fields: ['content.models.*.size', 'content.models.*.kind'], message: 'a voxel model has size [w, h, d]',
        example: docExample({ models: { crate: { kind: 'voxel', size: [4, 4], parts: [] } } }) },
      model_part: { fields: ['content.models.*.parts[].box', 'content.models.*.kind'], message: 'every part of a voxel model has box [x, y, z, w, h, d]',
        example: docExample({ models: { crate: { kind: 'voxel', size: [4, 4, 4], parts: [{ c: '#806040' }] } } }) },
      model_color: { fields: ['content.models.*.parts[].c', 'content.models.*.palette'], message: "a voxel part's c is a key of the model's palette or a #hex color",
        example: docExample({ models: { crate: { kind: 'voxel', size: [4, 4, 4], palette: { w: '#806040' }, parts: [{ box: [0, 0, 0, 4, 4, 4], c: 'stone' }] } } }) },
    },
  },
  validate(config, doc) {
    const errs = [];
    for (const [id, m] of Object.entries(doc.content?.models || {})) {
      if (m?.kind !== 'voxel') continue;
      if (!Array.isArray(m.size) || m.size.length !== 3) errs.push({ code: 'model_size', path: `content.models.${id}.size`, message: 'voxel models need size [w,h,d]' });
      (Array.isArray(m.parts) ? m.parts : []).forEach((p, i) => {
        if (!p || typeof p !== 'object') return;
        // box's [x, y, z, w, h, d] shape is the card's (content.models); that a voxel part has one is this rule.
        if (p.box === undefined) errs.push({ code: 'model_part', path: `content.models.${id}.parts[${i}].box`, message: 'a voxel part needs box [x,y,z,w,h,d]' });
        else if (p.c && m.palette && !(p.c in m.palette) && !String(p.c).startsWith('#')) errs.push({ code: 'model_color', path: `content.models.${id}.parts[${i}].c`, message: `'${p.c}' is not in the model palette`, hint: Object.keys(m.palette).join(', ') });
      });
    }
    return errs;
  },
  install(rt, config, instance) {
    if (presentationOnly(rt)) return;
    const stage = joinStage(rt, instance);
    stage.models.configure('voxel', config);
  },
};
