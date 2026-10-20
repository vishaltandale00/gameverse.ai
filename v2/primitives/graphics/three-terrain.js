// Terrain math shared by graphics.terrain.procedural, graphics.render.mesh3d
// and graphics.foliage.scatter (no three.js): quadtree LOD patch selection,
// splat weights by biome/slope/height, patch grid building with skirts, and
// deterministic scatter points. Pure, so it is tested in Node and could run
// in a worker.
import { colorOf, hash3, clamp, smoothstep } from './three-util.js';

/**
 * Quadtree LOD selection (CDLOD-style). Root nodes of size patch*2^(levels-1)
 * tile the bounds; a node splits while the camera is within `k * size` of it and
 * it is above the finest level. Returns leaves [{x, z, size, level}] (x,z = min corner),
 * nearest first. level 0 = finest.
 */
export function quadtreePatches(cam, { patch = 64, levels = 4, bounds, k = 1.5, radius = Infinity }) {
  const rootSize = patch * 2 ** (levels - 1);
  const out = [];
  const [x0, z0] = bounds.min, [x1, z1] = bounds.max;
  const distTo = (x, z, s) => { const dx = Math.max(x - cam[0], 0, cam[0] - (x + s)), dz = Math.max(z - cam[2], 0, cam[2] - (z + s)); return Math.hypot(dx, dz, Math.max(0, Math.abs(cam[1]) - 0) * 0.25); };
  const visit = (x, z, size, level) => {
    if (x >= x1 || z >= z1 || x + size <= x0 || z + size <= z0) return;
    const d = distTo(x, z, size);
    if (d > radius) return;
    if (level > 0 && d < k * size) { const h = size / 2; visit(x, z, h, level - 1); visit(x + h, z, h, level - 1); visit(x, z + h, h, level - 1); visit(x + h, z + h, h, level - 1); return; }
    out.push({ x, z, size, level, d });
  };
  const sx = Math.floor((Math.max(x0, cam[0] - radius) - x0) / rootSize) * rootSize + x0, sz = Math.floor((Math.max(z0, cam[2] - radius) - z0) / rootSize) * rootSize + z0;
  for (let z = sz; z < Math.min(z1, cam[2] + radius); z += rootSize) for (let x = sx; x < Math.min(x1, cam[0] + radius); x += rootSize) visit(x, z, rootSize, levels - 1);
  return out.sort((a, b) => a.d - b.d);
}

/** Default surface colors by material/biome name when no splat rule covers it. */
export const SURFACE_COLORS = { grass: '#5f8f3e', meadow: '#6a9a4a', soil: '#6e5236', dirt: '#6e5236', mud: '#4a3c2a', peat: '#3a3022', sand: '#cdb98a', clay: '#a8784e', stone: '#7a7a74', rock: '#6e6c66', snow: '#eef3f8', ice: '#cfe4f0', ash: '#3a3230', basalt: '#2c2828', gravel: '#8a867e', cobble: '#7a746a', asphalt: '#38383c', water: '#2a5a7a' };

/**
 * Splat a terrain sample. sample = { biome, material, slope (deg), height (m), biomeColor? }
 * rules = splat list [{ biome?|material?, slope?:[a,b], height?:[a,b], color, roughness }].
 * Biome/material rules set the base; slope/height rules layer on top with soft edges.
 * Returns { color:'#hex' as linear rgb array, roughness, weights: number[] (per rule) }.
 */
export function splatSample(sample, rules = []) {
  const weights = rules.map(() => 0);
  let base = null, rough = 0.9;
  rules.forEach((r, i) => {
    if ((r.biome && r.biome === sample.biome) || (r.material && r.material === sample.material)) { if (!base) { base = colorOf(r.color); rough = r.roughness ?? rough; weights[i] = 1; } }
  });
  if (!base) base = colorOf(sample.biomeColor || SURFACE_COLORS[sample.material] || SURFACE_COLORS[sample.biome] || '#6a8a4a');
  let col = base;
  rules.forEach((r, i) => {
    let w = 0;
    if (r.slope) { const [a, b] = r.slope; w = smoothstep(a - 4, a + 4, sample.slope) * (1 - smoothstep(b - 2, b + 2, sample.slope)); }
    else if (r.height) { const [a, b] = r.height, e = Math.max(2, (b - a) * 0.08); w = smoothstep(a - e, a + e, sample.height) * (1 - smoothstep(b - e, b + e, sample.height)); }
    else return;
    if (w <= 0) return;
    const c = colorOf(r.color);
    col = col.map((v, k) => v + (c[k] - v) * w);
    rough = rough + ((r.roughness ?? rough) - rough) * w;
    weights[i] = w;
    // Earlier base weights fade by what overrides them.
    for (let j = 0; j < i; j++) weights[j] *= 1 - w;
  });
  return { color: col, roughness: rough, weights };
}

/**
 * Build a terrain patch grid. sampler(x, z) -> { y, normal?, biome?, material? }.
 * n = quads per side; skirt = depth of edge skirts that hide LOD cracks.
 * colorAt(sample, x, z, slopeDeg) -> linear [r,g,b]. Returns typed arrays (indexed).
 */
export function buildPatch({ x, z, size, n = 32, skirt = 4 }, sampler, colorAt) {
  const step = size / n, N = n + 1;
  const heights = new Float32Array((N + 2) * (N + 2));
  const samples = new Array(N * N);
  // Heights with a one-sample border for normals.
  for (let j = -1; j <= N; j++) for (let i = -1; i <= N; i++) {
    const s = sampler(x + i * step, z + j * step);
    heights[(i + 1) + (j + 1) * (N + 2)] = s.y;
    if (i >= 0 && j >= 0 && i < N && j < N) samples[i + j * N] = s;
  }
  const H = (i, j) => heights[(i + 1) + (j + 1) * (N + 2)];
  const vCount = N * N + 4 * N;
  const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3), col = new Float32Array(vCount * 3), slope = new Float32Array(vCount);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const v = i + j * N, px = x + i * step, pz = z + j * step, y = H(i, j);
    const nx = H(i - 1, j) - H(i + 1, j), nz = H(i, j - 1) - H(i, j + 1), ny = 2 * step, l = Math.hypot(nx, ny, nz);
    pos[v * 3] = px; pos[v * 3 + 1] = y; pos[v * 3 + 2] = pz;
    nor[v * 3] = nx / l; nor[v * 3 + 1] = ny / l; nor[v * 3 + 2] = nz / l;
    const sl = Math.acos(clamp(ny / l, -1, 1)) * 180 / Math.PI; slope[v] = sl;
    const c = colorAt(samples[v], px, pz, sl, y);
    col[v * 3] = c[0]; col[v * 3 + 1] = c[1]; col[v * 3 + 2] = c[2];
  }
  // Skirts: duplicate edge vertices pushed down.
  const edges = [];
  for (let i = 0; i < N; i++) edges.push(i, (N - 1) * N + i, i * N, i * N + N - 1);
  edges.forEach((src, k) => {
    const v = N * N + k;
    for (let a = 0; a < 3; a++) { pos[v * 3 + a] = pos[src * 3 + a]; nor[v * 3 + a] = nor[src * 3 + a]; col[v * 3 + a] = col[src * 3 + a] * 0.8; }
    pos[v * 3 + 1] -= skirt; slope[v] = slope[src];
  });
  const idx = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = i + j * N, b = a + 1, c = a + N, d = c + 1;
    // Alternate the diagonal to reduce directional artefacts.
    if ((i + j) & 1) idx.push(a, c, b, b, c, d); else idx.push(a, c, d, a, d, b);
  }
  const sk = (e, k) => N * N + k * 4 + e; // skirt vertex for edge e (0 z-min, 1 z-max, 2 x-min, 3 x-max) at position k
  const quad = (a, b, sa, sb) => idx.push(a, b, sa, b, sb, sa, a, sa, b, b, sa, sb); // both windings: skirts are seen from either side
  for (let k = 0; k < n; k++) {
    quad(k, k + 1, sk(0, k), sk(0, k + 1));
    quad((N - 1) * N + k, (N - 1) * N + k + 1, sk(1, k), sk(1, k + 1));
    quad(k * N, (k + 1) * N, sk(2, k), sk(2, k + 1));
    quad(k * N + N - 1, (k + 1) * N + N - 1, sk(3, k), sk(3, k + 1));
  }
  return { positions: pos, normals: nor, colors: col, slope, indices: vCount > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), samples, step };
}

/**
 * Deterministic jittered scatter points in a square cell grid. density = points per m²
 * (capped per cell); accept(x, z) -> boolean filters by terrain. Returns [{x, z, r}].
 */
export function scatterPoints(x0, z0, size, density, seed, accept = () => true) {
  const cell = Math.max(0.25, 1 / Math.sqrt(Math.max(1e-6, density)));
  const out = [];
  const n = Math.ceil(size / cell);
  const gx0 = Math.floor(x0 / cell), gz0 = Math.floor(z0 / cell);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const gx = gx0 + i, gz = gz0 + j;
    const r = hash3(gx, gz, 7, seed);
    const x = (gx + hash3(gx, gz, 1, seed)) * cell, z = (gz + hash3(gx, gz, 2, seed)) * cell;
    if (x < x0 || z < z0 || x >= x0 + size || z >= z0 + size) continue;
    if (accept(x, z, r)) out.push({ x, z, r });
  }
  return out;
}
