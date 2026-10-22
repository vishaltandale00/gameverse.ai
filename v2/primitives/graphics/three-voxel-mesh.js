// Greedy voxel meshing with ambient occlusion and per-face shade.
// Pure and dependency-free so it runs in Node, in a Worker or on the main
// thread under a time budget. Used for world chunks (graphics.render.voxel)
// and for voxel models (graphics.model.voxel).
//
// Input volume: a padded Uint16Array of material indexes (0 = empty) of size
// (sx+2)*(sy+2)*(sz+2), index = (x+1) + px*((y+1) + py*(z+1)) with
// px = sx+2, py = sy+2. The one-cell border holds the neighbours' cells so
// faces and AO at chunk edges are correct.
//
// materials[i] (i >= 1): { color:[r,g,b] 0..1, opaque:boolean, alpha?, emissive? 0..1 }
// Faces between two cells of the same non-opaque material are culled (water,
// glass); a non-opaque cell next to an opaque one has no face there.

export const AO_CURVE = [0.42, 0.62, 0.82, 1];
// Direction order: +x -x +y -y +z -z.
export const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/** faceShade = [top, x-faces, z-faces]; bottom faces get half the darkest side. */
export function faceShadeTable(faceShade = [1, 0.6, 0.8]) {
  const [t, x, z] = faceShade;
  return [x, x, t, Math.min(x, z) * 0.5 + 0.1, z, z];
}

export function paddedIndex(sx, sy) { const px = sx + 2, py = sy + 2; return (x, y, z) => (x + 1) + px * ((y + 1) + py * (z + 1)); }

/** Build a padded volume from get(x, y, z) → material index for x in [-1, sx]. */
export function padVolume(size, get) {
  const [sx, sy, sz] = size, px = sx + 2, py = sy + 2, pz = sz + 2;
  const v = new Uint16Array(px * py * pz);
  let i = 0;
  for (let z = -1; z <= sz; z++) for (let y = -1; y <= sy; y++) for (let x = -1; x <= sx; x++) v[i++] = get(x, y, z) | 0;
  return v;
}

/** Halve resolution (2×2×2 → one cell) for distant LOD rings; most common non-empty material wins when ≥ 4 of 8 are filled. */
export function downsample(volume, size) {
  const [sx, sy, sz] = size, nx = Math.ceil(sx / 2), ny = Math.ceil(sy / 2), nz = Math.ceil(sz / 2);
  const src = paddedIndex(sx, sy), get = (x, y, z) => (x < -1 || y < -1 || z < -1 || x > sx || y > sy || z > sz) ? 0 : volume[src(x, y, z)];
  const counts = new Map();
  const out = padVolume([nx, ny, nz], (x, y, z) => {
    counts.clear(); let filled = 0, best = 0, bestN = 0;
    for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const m = get(x * 2 + dx, y * 2 + dy, z * 2 + dz); if (!m) continue;
      filled++; const n = (counts.get(m) || 0) + 1; counts.set(m, n); if (n > bestN) { bestN = n; best = m; }
    }
    return filled >= 4 ? best : 0;
  });
  return { volume: out, size: [nx, ny, nz] };
}

/**
 * Mesh a padded volume.
 * opts: { ao=true, faceShade=[1,0.6,0.8], scale=1, origin=[0,0,0], skylight?: (x,y,z)=>0..1, greedy=true }
 * Returns { opaque, transparent }, each { positions:Float32Array, normals:Float32Array,
 *   colors:Float32Array (rgb), alphas:Float32Array, emissive:Float32Array, indices:Uint32Array, quads, faces }.
 * `faces` counts unit faces before merging; `quads` counts emitted quads.
 */
export function meshVolume(volume, size, materials, opts = {}) {
  const { ao = true, scale = 1, origin = [0, 0, 0], skylight = null, greedy = true } = opts;
  const shade = faceShadeTable(opts.faceShade);
  const [sx, sy, sz] = size, px = sx + 2, py = sy + 2;
  // Cells with a non-cube shape (cross plants, panels) are drawn separately and count as air for culling/AO.
  const eff = new Uint16Array(materials.length + 1);
  for (let m = 0; m < materials.length; m++) eff[m] = materials[m]?.shape && materials[m].shape !== 'cube' ? 0 : m;
  const at = (x, y, z) => { const m = volume[(x + 1) + px * ((y + 1) + py * (z + 1))]; return m < eff.length ? eff[m] : m; };
  const opaque = m => m !== 0 && (materials[m]?.opaque ?? true);
  const out = { opaque: buffers(), transparent: buffers() };
  let faces = 0;
  const dims = [sx, sy, sz];
  for (let dir = 0; dir < 6; dir++) {
    const d = dir >> 1, sign = dir & 1 ? -1 : 1;
    const u = (d + 1) % 3, v = (d + 2) % 3;
    const nU = dims[u], nV = dims[v];
    const mask = new Int32Array(nU * nV), aoMask = new Int32Array(nU * nV);
    const c = [0, 0, 0], n = [0, 0, 0];
    for (let s = 0; s < dims[d]; s++) {
      let any = false;
      for (let j = 0; j < nV; j++) for (let i = 0; i < nU; i++) {
        c[d] = s; c[u] = i; c[v] = j;
        const m = at(c[0], c[1], c[2]);
        let key = 0, aok = 0;
        if (m) {
          n[0] = c[0]; n[1] = c[1]; n[2] = c[2]; n[d] += sign;
          const b = at(n[0], n[1], n[2]);
          const visible = opaque(m) ? !opaque(b) : (b === 0 || (!opaque(b) && b !== m));
          if (visible) {
            key = m; faces++; any = true;
            if (ao && opaque(m)) aok = cornerAO(at, opaque, n, d, u, v);
            else aok = 0xff; // all four corners fully lit
            // Sky exposure (quantised to 8 levels) is part of the merge key so caves stay dark.
            if (skylight) aok |= Math.round(Math.min(1, Math.max(0, skylight(n[0], n[1], n[2]))) * 7) << 8;
          }
        }
        mask[i + j * nU] = key; aoMask[i + j * nU] = aok;
      }
      if (!any) continue;
      // Greedy merge cells with the same material and AO pattern.
      for (let j = 0; j < nV; j++) for (let i = 0; i < nU;) {
        const k = mask[i + j * nU];
        if (!k) { i++; continue; }
        const a = aoMask[i + j * nU];
        let w = 1, h = 1;
        if (greedy) {
          while (i + w < nU && mask[i + w + j * nU] === k && aoMask[i + w + j * nU] === a) w++;
          outer: for (; j + h < nV; h++) for (let x = 0; x < w; x++) if (mask[i + x + (j + h) * nU] !== k || aoMask[i + x + (j + h) * nU] !== a) break outer;
        }
        const mat = materials[k] || { color: [1, 0, 1], opaque: true };
        const target = opaque(k) ? out.opaque : out.transparent;
        const p = [0, 0, 0]; p[d] = s + (sign > 0 ? 1 : 0); p[u] = i; p[v] = j;
        const du = [0, 0, 0], dv = [0, 0, 0]; du[u] = w; dv[v] = h;
        const sky = skylight ? SKY_CURVE[(a >> 8) & 7] : 1;
        emitQuad(target, p, du, dv, DIRS[dir], sign, d, mat, shade[dir] * sky, a & 0xff, scale, origin);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[i + x + (j + y) * nU] = 0;
        i += w;
      }
    }
  }
  // Non-cube cells: crossed quads for plants/crops, a thin panel for ladders/rails/doors.
  for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
    const m = volume[(x + 1) + px * ((y + 1) + py * (z + 1))];
    const mat = m && materials[m];
    if (!mat?.shape || mat.shape === 'cube') continue;
    const sky = skylight ? SKY_CURVE[Math.round(Math.min(1, Math.max(0, skylight(x, y, z))) * 7)] : 1;
    emitShape(out.transparent, mat, x, y, z, sky, scale, origin);
    faces++;
  }
  return { opaque: finish(out.opaque, faces), transparent: finish(out.transparent, faces) };
}

export const SKY_CURVE = [0.22, 0.3, 0.4, 0.5, 0.62, 0.74, 0.87, 1];

function emitShape(b, mat, x, y, z, sky, scale, origin) {
  const quads = mat.shape === 'cross'
    ? [[[0.15, 0, 0.15], [0.85, 0, 0.85], [0.85, 0.9, 0.85], [0.15, 0.9, 0.15]], [[0.85, 0, 0.15], [0.15, 0, 0.85], [0.15, 0.9, 0.85], [0.85, 0.9, 0.15]]]
    : mat.shape === 'flat'
      ? [[[0, 0.04, 0], [1, 0.04, 0], [1, 0.04, 1], [0, 0.04, 1]]]
      : [[[0, 0, 0.9], [1, 0, 0.9], [1, 1, 0.9], [0, 1, 0.9]]]; // panel
  const [r, g, bl] = mat.color;
  for (const q of quads) for (const side of [1, -1]) {
    const base = b.positions.length / 3;
    const e1 = q[1].map((v, i) => v - q[0][i]), e2 = q[3].map((v, i) => v - q[0][i]);
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], l = Math.hypot(...n) || 1;
    for (let k = 0; k < 4; k++) {
      const c = q[k];
      b.positions.push(origin[0] + (x + c[0]) * scale, origin[1] + (y + c[1]) * scale, origin[2] + (z + c[2]) * scale);
      b.normals.push(side * n[0] / l, side * n[1] / l, side * n[2] / l);
      const f = sky * (0.75 + 0.25 * c[1]); // darker at the stem
      b.colors.push(r * f, g * f, bl * f); b.alphas.push(mat.alpha ?? 1); b.emissive.push(mat.emissive ?? 0);
    }
    for (const t of side > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]) b.indices.push(base + t);
    b.quads++;
  }
}

/** Per-corner AO (0..3 each, packed 2 bits per corner: c00, c10, c11, c01) for the face whose outside cell is n. */
function cornerAO(at, opaque, n, d, u, v) {
  const q = [0, 0, 0];
  const solid = (du, dv) => { q[0] = n[0]; q[1] = n[1]; q[2] = n[2]; q[u] += du; q[v] += dv; return opaque(at(q[0], q[1], q[2])) ? 1 : 0; };
  const corner = (su, sv) => {
    const s1 = solid(su, 0), s2 = solid(0, sv);
    return s1 && s2 ? 0 : 3 - (s1 + s2 + solid(su, sv));
  };
  return corner(-1, -1) | (corner(1, -1) << 2) | (corner(1, 1) << 4) | (corner(-1, 1) << 6);
}

function buffers() { return { positions: [], normals: [], colors: [], alphas: [], emissive: [], indices: [], quads: 0 }; }

function emitQuad(b, p, du, dv, normal, sign, _d, mat, shade, aoPacked, scale, origin) {
  const base = b.positions.length / 3;
  const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const aov = [aoPacked & 3, (aoPacked >> 2) & 3, (aoPacked >> 4) & 3, (aoPacked >> 6) & 3];
  for (let k = 0; k < 4; k++) {
    const [cu, cv] = corners[k];
    for (let a = 0; a < 3; a++) b.positions.push(origin[a] + (p[a] + du[a] * cu + dv[a] * cv) * scale);
    b.normals.push(normal[0], normal[1], normal[2]);
    const f = shade * AO_CURVE[aov[k]];
    const [r, g, bl] = mat.color;
    b.colors.push(r * f, g * f, bl * f);
    b.alphas.push(mat.alpha ?? 1);
    b.emissive.push(mat.emissive ?? 0);
  }
  // Flip the diagonal when AO is anisotropic so the gradient doesn't crease;
  // wind counter-clockwise when seen from outside.
  const flip = aov[0] + aov[2] < aov[1] + aov[3];
  const ccw = sign > 0; // with u = d+1, v = d+2 (mod 3), u×v always points along +d
  const tri = flip ? [1, 2, 3, 1, 3, 0] : [0, 1, 2, 0, 2, 3];
  const order = ccw ? tri : [tri[0], tri[2], tri[1], tri[3], tri[5], tri[4]];
  for (const t of order) b.indices.push(base + t);
  b.quads++;
}

function finish(b, faces) {
  return {
    positions: new Float32Array(b.positions), normals: new Float32Array(b.normals), colors: new Float32Array(b.colors),
    alphas: new Float32Array(b.alphas), emissive: new Float32Array(b.emissive), indices: new Uint32Array(b.indices), quads: b.quads, faces,
  };
}

/** Count exposed unit faces by brute force (test oracle for the greedy mesher). */
export function countExposedFaces(volume, size, materials) {
  const [sx, sy, sz] = size, px = sx + 2, py = sy + 2;
  const at = (x, y, z) => volume[(x + 1) + px * ((y + 1) + py * (z + 1))];
  const opaque = m => m !== 0 && (materials[m]?.opaque ?? true);
  let n = 0;
  for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
    const m = at(x, y, z); if (!m) continue;
    for (const [dx, dy, dz] of DIRS) { const b = at(x + dx, y + dy, z + dz); if (opaque(m) ? !opaque(b) : (b === 0 || (!opaque(b) && b !== m))) n++; }
  }
  return n;
}

/** Total area of emitted quads (in cells²); equals the exposed face count when meshing is watertight. */
export function quadArea(mesh, scale = 1) {
  const p = mesh.positions; let area = 0;
  for (let q = 0; q < p.length / 12; q++) {
    const o = q * 12, ax = p[o + 3] - p[o], ay = p[o + 4] - p[o + 1], az = p[o + 5] - p[o + 2], bx = p[o + 9] - p[o], by = p[o + 10] - p[o + 1], bz = p[o + 11] - p[o + 2];
    area += Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
  }
  return area / (scale * scale);
}
