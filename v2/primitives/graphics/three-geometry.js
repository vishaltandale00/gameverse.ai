// Geometry assembly for generated models: lowpoly parts and voxel part meshes
// become ONE non-indexed BufferGeometry per model with vertex colors, an
// emissive mask, skin indices/weights (rigid per part, blended across limb
// joints) and draw groups per material class (matte, metal, transparent).
import { colorOf, hash01 } from './three-util.js';
import { resolveColor } from './model-lowpoly.js';

export const MATERIAL_CLASSES = ['matte', 'metal', 'transparent'];

export class GeoBuilder {
  constructor() { this.groups = Object.fromEntries(MATERIAL_CLASSES.map(k => [k, { pos: [], nor: [], col: [], emi: [], alpha: [], si: [], sw: [] }])); }
  /** Append triangles (non-indexed arrays) with a uniform material class. */
  push(cls, pos, nor, col, emi, alpha, skin) {
    const g = this.groups[cls]; const n = pos.length / 3;
    for (let i = 0; i < pos.length; i++) { g.pos.push(pos[i]); g.nor.push(nor[i]); g.col.push(col[i]); }
    for (let i = 0; i < n; i++) {
      g.emi.push(typeof emi === 'number' ? emi : emi[i]); g.alpha.push(typeof alpha === 'number' ? alpha : alpha[i]);
      const s = typeof skin === 'function' ? skin(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]) : skin;
      g.si.push(s[0], s[1], 0, 0); g.sw.push(s[2], s[3], 0, 0);
    }
  }
  get vertexCount() { return MATERIAL_CLASSES.reduce((s, k) => s + this.groups[k].pos.length / 3, 0); }
  bounds() {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const k of MATERIAL_CLASSES) { const p = this.groups[k].pos; for (let i = 0; i < p.length; i += 3) for (let a = 0; a < 3; a++) { if (p[i + a] < min[a]) min[a] = p[i + a]; if (p[i + a] > max[a]) max[a] = p[i + a]; } }
    return Number.isFinite(min[0]) ? { min, max } : { min: [0, 0, 0], max: [0, 0, 0] };
  }
  /** Build a THREE.BufferGeometry with groups (materialIndex = MATERIAL_CLASSES index). */
  toGeometry(THREE, { skinned = true } = {}) {
    const all = { pos: [], nor: [], col: [], emi: [], alpha: [], si: [], sw: [] };
    const geo = new THREE.BufferGeometry(); let start = 0;
    MATERIAL_CLASSES.forEach((k, mi) => {
      const g = this.groups[k], n = g.pos.length / 3; if (!n) return;
      for (const key of Object.keys(all)) for (const v of g[key]) all[key].push(v);
      geo.addGroup(start, n, mi); start += n;
    });
    geo.setAttribute('position', new THREE.Float32BufferAttribute(all.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(all.nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(all.col, 3));
    geo.setAttribute('emissiveMask', new THREE.Float32BufferAttribute(all.emi, 1));
    geo.setAttribute('alphaMask', new THREE.Float32BufferAttribute(all.alpha, 1));
    if (skinned) {
      geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(all.si, 4));
      geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(all.sw, 4));
    }
    geo.computeBoundingBox(); geo.computeBoundingSphere();
    return geo;
  }
}

const shapeCache = new Map();
/** Unit-sized THREE geometry for a shape (non-indexed), cached by shape/segments/taper. */
function unitShape(THREE, shape, segments, taper = 1, flat = true) {
  const key = `${shape}:${segments}:${taper}:${flat}`;
  if (shapeCache.has(key)) return shapeCache.get(key);
  let g;
  const seg = Math.max(3, segments | 0);
  switch (shape) {
    case 'cyl': g = new THREE.CylinderGeometry(0.5 * taper, 0.5, 1, seg, 1); break;
    case 'cone': g = new THREE.ConeGeometry(0.5, 1, seg, 1); break;
    case 'sphere': g = new THREE.SphereGeometry(0.5, seg, Math.max(3, seg >> 1)); break;
    case 'cap': g = new THREE.CapsuleGeometry(0.5, 1, 2, Math.max(5, Math.min(seg, 8))); break;
    default: {
      g = new THREE.BoxGeometry(1, 1, 1);
      if (taper !== 1) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * taper); p.setZ(i, p.getZ(i) * taper); } }
    }
  }
  if (g.index) g = g.toNonIndexed();
  if (flat) g.computeVertexNormals();
  shapeCache.set(key, g);
  return g;
}

/**
 * Append lowpoly parts to a builder.
 * opts: { palette, boneIndex: Map, segments, flatShade, emissiveKeys:Set, rig }
 */
export function appendParts(THREE, builder, parts, opts = {}) {
  const { palette = {}, boneIndex = null, segments = 12, flatShade = true, emissiveKeys = new Set(), alpha: specAlpha } = opts;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), nrm = new THREE.Matrix3(), sc = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (const p of parts) {
    const shape = p.shape || 'box';
    let size = p.size || [1, 1, 1], at = p.at || [0, 0, 0];
    if (p.from && p.to) {
      const a = new THREE.Vector3(...p.from), b = new THREE.Vector3(...p.to), d = b.clone().sub(a), L = Math.max(1e-4, d.length());
      q.setFromUnitVectors(up, d.normalize());
      at = [(p.from[0] + p.to[0]) / 2, (p.from[1] + p.to[1]) / 2, (p.from[2] + p.to[2]) / 2];
      const dia = p.size?.[0] ?? 0.1;
      // The unit capsule is 2 tall (body 1 + two 0.5 caps): scale y by L/2 so its ends sit on the joints.
      size = [dia, shape === 'cap' ? L / 2 : L, p.size?.[2] ?? dia];
    } else {
      e.set(...(p.rot || [0, 0, 0])); q.setFromEuler(e);
    }
    const unit = unitShape(THREE, shape, p.segments || segments, p.taper ?? 1, flatShade);
    if (shape === 'cap' && !(p.from && p.to)) size = [size[0], size[1] / 2, size[2]];
    m.compose(new THREE.Vector3(...at), q, sc.set(size[0], size[1], size[2]));
    if (opts.matrix) m.premultiply(opts.matrix); // place the whole model (merged static batches)
    nrm.getNormalMatrix(m);
    const src = unit.attributes.position, srcN = unit.attributes.normal, n = src.count;
    const pos = new Array(n * 3), nor = new Array(n * 3), col = new Array(n * 3);
    const hex = resolveColor(p.c, palette), rgb = colorOf(hex);
    const glow = p.mat === 'glow' || p.glow || emissiveKeys.has(p.c);
    // Small per-part value variation keeps flat colors from looking pasted on.
    const vary = 0.94 + hash01(`${p.name || ''}${p.c}${at.join()}`) * 0.1;
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(src, i).applyMatrix4(m); pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
      v.fromBufferAttribute(srcN, i).applyMatrix3(nrm).normalize(); nor[i * 3] = v.x; nor[i * 3 + 1] = v.y; nor[i * 3 + 2] = v.z;
      col[i * 3] = rgb[0] * vary; col[i * 3 + 1] = rgb[1] * vary; col[i * 3 + 2] = rgb[2] * vary;
    }
    const alpha = p.alpha ?? specAlpha ?? 1;
    const cls = alpha < 0.999 ? 'transparent' : p.mat === 'metal' ? 'metal' : 'matte';
    let skin = [0, 0, 1, 0];
    if (boneIndex) {
      const bi = boneIndex.get(p.bone) ?? 0;
      if (p.chain && p.chain.bones.every(b => boneIndex.has(b))) {
        const ids = p.chain.bones.map(b => boneIndex.get(b)), n = ids.length, top = p.chain.top, span = Math.max(1e-4, p.chain.top - p.chain.bottom);
        skin = (x, y) => { const s = Math.min(n - 1e-6, Math.max(0, (top - y) / span * n)); const i = Math.floor(s), f = s - i; return [ids[i], ids[Math.min(n - 1, i + 1)], 1 - f * 0.5, f * 0.5]; };
      } else if (p.blendTo && boneIndex.has(p.blendTo) && p.from && p.to) {
        const bj = boneIndex.get(p.blendTo), f = p.from, t = p.to, d = [t[0] - f[0], t[1] - f[1], t[2] - f[2]], dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1;
        skin = (x, y, z) => { const s = ((x - f[0]) * d[0] + (y - f[1]) * d[1] + (z - f[2]) * d[2]) / dd; const k = Math.min(1, Math.max(0, (s - 0.72) / 0.4)); const w = k * k * (3 - 2 * k) * 0.5; return [bi, bj, 1 - w, w]; };
      } else skin = [bi, 0, 1, 0];
    }
    builder.push(cls, pos, nor, col, glow ? 1 : 0, alpha, skin);
  }
  return builder;
}

/** Append a meshVolume() result (indexed) as triangles. */
export function appendVoxelMesh(builder, mesh, cls, skin, alphaOverride) {
  const { positions: P, normals: N, colors: C, emissive: E, alphas: A, indices: I } = mesh;
  const pos = [], nor = [], col = [], emi = [], alpha = [];
  for (let k = 0; k < I.length; k++) { const i = I[k]; pos.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); nor.push(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]); col.push(C[i * 3], C[i * 3 + 1], C[i * 3 + 2]); emi.push(E[i]); alpha.push(alphaOverride ?? A[i]); }
  if (pos.length) builder.push(cls, pos, nor, col, emi, alpha, skin);
  return builder;
}
