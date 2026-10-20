// graphics.render.voxel: three.js renderer for voxel spaces. Chunks are
// greedy-meshed with ambient occlusion, per-face shade and sky exposure
// (three-voxel-mesh.js, a pure worker-friendly function) under a per-frame
// time budget, nearest and in-view chunks first; edits re-mesh the touched
// chunk and its neighbours ahead of streaming; distant rings use
// downsampled LOD meshes; three.js frustum culling plus distance unloading
// keep draw calls bounded. Entities in the space are drawn as rigged actors.
import { joinStage, presentationOnly } from './three-stage.js';
import { padVolume, meshVolume, downsample } from './three-voxel-mesh.js';
import { paletteFor } from './material-palette.js';
import { syncActors } from './three-actors.js';
import { ensureDefaultCamera } from './three-camera.js';
import { createObjectLayer } from './three-objects.js';
import thirdPerson from './camera-third-person.js';

const key3 = (x, y, z) => `${x},${y},${z}`;

/** Chunk keys to keep around a camera chunk, nearest first, with their LOD level (pure; tested). */
export function chunkPlan(center, { radius, yRange, lodRings = 1, forward = null, bounds = null }) {
  const [cx, , cz] = center, out = [];
  const ringR = [1, 0.55, 0.4, 0.3][Math.min(3, lodRings)] * radius;
  for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
    const d = Math.hypot(dx, dz);
    if (d > radius + 0.5) continue;
    const x = cx + dx, z = cz + dz;
    if (bounds && (x < bounds.min[0] || z < bounds.min[2] || x > bounds.max[0] || z > bounds.max[2])) continue;
    const lod = d <= ringR || !lodRings ? 0 : Math.min(lodRings, 1 + Math.floor((d - ringR) / Math.max(1, (radius - ringR) / lodRings)));
    let prio = d;
    if (forward) { const l = d || 1; prio -= ((dx / l) * forward[0] + (dz / l) * forward[2]) * Math.min(3, d * 0.5); }
    for (let y = yRange[0]; y <= yRange[1]; y++) out.push({ key: key3(x, y, z), at: [x, y, z], lod, prio: prio + Math.abs(y - center[1]) * 0.35 });
  }
  return out.sort((a, b) => a.prio - b.prio);
}

export default {
  id: 'graphics.render.voxel',
  card: {
    intent: 'three.js renderer for voxel spaces: greedy chunk meshing with ambient occlusion, per-face shade and sky exposure under a per-frame time budget, edit re-meshing ahead of streaming, LOD rings, frustum and distance culling, sun shadows, an aimed-block outline, and rigged actors for every entity in the space.',
    views: ['1p', '3p', 'iso'],
    params: {
      meshBudgetMs: { type: 'number', default: 4, min: 1, max: 16, unit: 'ms', effect: 'chunk meshing time allowed per frame (higher streams faster, may drop frames)' },
      ao: { type: 'boolean', default: true, effect: 'per-vertex ambient occlusion' },
      lodRings: { type: 'integer', default: 1, min: 0, max: 3, effect: 'outer rings meshed at 2x/4x/8x coarser resolution' },
      shadows: { type: 'string', options: ['none', 'sun'], default: 'sun', effect: 'sun shadow map near the camera' },
      viewDistance: { type: 'integer', min: 2, max: 32, unit: 'chunks', effect: 'override the space viewDistance' },
      highlight: { type: 'boolean', default: true, effect: 'outline the block the player is aiming at (1p/3p)' },
      reach: { type: 'number', default: 6, min: 1, max: 20, unit: 'm', effect: 'aim outline distance' },
    },
    provides: { services: ['camera'] },
    reads: ['content.blocks'],
    requires: { capabilities: ['editCells'] },
  },
  install(rt, config, instance) {
    if (presentationOnly(rt)) return;
    const stage = joinStage(rt, instance);
    const THREE = stage.THREE;
    const spaceId = instance.space ?? rt.doc.spaces?.[0]?.id;
    const root = stage.spaceRoot(spaceId);
    const world = new THREE.Group(); world.name = 'voxel-chunks'; root.add(world);
    const actorsRoot = new THREE.Group(); actorsRoot.name = 'actors'; root.add(actorsRoot);
    stage.worldStyle = 'voxel';
    ensureDefaultCamera(stage, () => thirdPerson.install(rt, { distance: 5, height: 1.7, fov: 70, lockOnBlend: 0.6, shoulder: 'center', collide: true, recenter: 1.5, pitch: -0.25 }, { key: 'default-camera' }));
    stage.settings.shadows = config.shadows;
    const chunks = new Map(), cellCache = new Map(), columnTop = new Map();
    const materials = [null], matIndex = new Map();
    let api = null, info = null, queue = [], planKey = '', dirty = new Set(), paletteRef = null, docRef = rt.doc;
    const objects = createObjectLayer(stage, spaceId, root, { distance: 160, cell: 64, stats: stage.stats.voxelObjects = {} });
    const stats = stage.stats.voxel = { chunks: 0, queued: 0, meshMs: 0, meshed: 0, lastMs: 0, quads: 0, faces: 0 };

    const setup = () => {
      api = stage.spaceApi(spaceId);
      if (!api) return false;
      const cfg = api.config || {};
      const size = api.size;
      const chunk = api.chunkSize || cfg.chunk || [16, Math.min(64, size?.[1] || 64), 16];
      const height = cfg.height ?? size?.[1] ?? 128;
      info = {
        chunk, cell: api.cell ?? cfg.cell ?? 1, height, seaLevel: cfg.seaLevel,
        view: config.viewDistance ?? cfg.viewDistance ?? (size ? Math.ceil(Math.max(size[0], size[2] || 1) / chunk[0]) : 8),
        bounds: size && size.length === 3 ? { min: [0, 0, 0], max: [Math.ceil(size[0] / chunk[0]) - 1, 0, Math.ceil(size[2] / chunk[2]) - 1] } : null,
        sky: (cfg.lightModel ?? 'sky') !== 'none',
      };
      stage.spaceDef = id => api.blockDef?.(id);
      const dist = info.view * chunk[0] * info.cell;
      stage.settings.drawDistance = Math.max(stage.settings.drawDistance === 1200 ? 0 : stage.settings.drawDistance, dist);
      stage.shadowExtent = Math.min(64, dist * 0.5);
      stage.camera.far = Math.max(stage.camera.far, dist * 1.6); stage.camera.updateProjectionMatrix();
      world.scale.setScalar(info.cell);
      return true;
    };
    const mi = id => {
      if (id == null) return 0;
      let i = matIndex.get(id);
      if (i === undefined) { i = materials.length; materials.push(paletteFor(stage).block(id)); matIndex.set(id, i); }
      return i;
    };
    const resetMaterials = () => { materials.length = 1; matIndex.clear(); cellCache.clear(); };

    /** Local material indexes for a chunk (x + sx*(z + sz*y)). */
    const chunkCells = (cx, cy, cz) => {
      const k = key3(cx, cy, cz);
      let c = cellCache.get(k); if (c) return c;
      const [sx, sy, sz] = info.chunk, cells = new Uint16Array(sx * sy * sz);
      const ox = cx * sx, oy = cy * sy, oz = cz * sz;
      if (cy < 0 || oy >= info.height) { /* air */ }
      else if (api.chunkCells) {
        const src = api.chunkCells(cx, cy, cz);
        const remap = (src.palette || []).map(id => mi(id));
        const n = Math.min(cells.length, src.cells.length);
        if (src.palette) for (let i = 0; i < n; i++) cells[i] = remap[src.cells[i]] || 0;
        else for (let i = 0; i < n; i++) cells[i] = src.cells[i];
      } else if (api.cellsIn) {
        for (const { at, block } of api.cellsIn([[ox, oy, oz], [ox + sx - 1, oy + sy - 1, oz + sz - 1]])) cells[(at[0] - ox) + sx * ((at[2] - oz) + sz * (at[1] - oy))] = mi(block);
      } else for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) cells[x + sx * (z + sz * y)] = mi(api.getCell([ox + x, oy + y, oz + z]));
      if (cellCache.size > 4096) cellCache.delete(cellCache.keys().next().value);
      cellCache.set(k, cells);
      return cells;
    };
    const cellAt = (wx, wy, wz) => {
      const [sx, sy, sz] = info.chunk;
      if (wy < 0 || wy >= info.height) return 0;
      const cx = Math.floor(wx / sx), cy = Math.floor(wy / sy), cz = Math.floor(wz / sz);
      return chunkCells(cx, cy, cz)[(wx - cx * sx) + sx * ((wz - cz * sz) + sz * (wy - cy * sy))];
    };
    const topAt = (wx, wz) => {
      const k = `${wx},${wz}`; let t = columnTop.get(k);
      if (t === undefined) {
        const g = api.groundAt?.(wx + 0.5, wz + 0.5);
        t = g && Number.isFinite(g.y) ? Math.round(g.y / (info.cell || 1)) : -Infinity;
        if (columnTop.size > 200000) columnTop.clear();
        columnTop.set(k, t);
      }
      return t;
    };

    const build = (entry) => {
      const t0 = performance.now();
      const [cx, cy, cz] = entry.at, [sx, sy, sz] = info.chunk, ox = cx * sx, oy = cy * sy, oz = cz * sz;
      const own = chunkCells(cx, cy, cz);
      let any = false; for (let i = 0; i < own.length; i++) if (own[i]) { any = true; break; }
      const old = chunks.get(entry.key);
      if (old?.group) { world.remove(old.group); old.group.traverse(o => o.geometry?.dispose()); }
      const rec = { key: entry.key, at: entry.at, lod: entry.lod, group: null, empty: !any };
      chunks.set(entry.key, rec);
      if (!any) { stats.lastMs = performance.now() - t0; return; }
      let volume = padVolume(info.chunk, (x, y, z) => (x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz) ? own[x + sx * (z + sz * y)] : cellAt(ox + x, oy + y, oz + z));
      let size = info.chunk, scale = 1;
      for (let l = 0; l < entry.lod; l++) { const d = downsample(volume, size); volume = d.volume; size = d.size; scale *= 2; }
      const skylight = info.sky ? (x, y, z) => { const wy = oy + y * scale, top = topAt(ox + Math.floor(x * scale), oz + Math.floor(z * scale)); const depth = top - wy; return depth <= 0 ? 1 : depth <= 8 ? 1 - depth * 0.055 : Math.max(0, 0.5 - (depth - 8) * 0.06); } : null;
      const mesh = meshVolume(volume, size, materials, { ao: config.ao && entry.lod < 2, faceShade: paletteFor(stage).faceShade, scale, skylight });
      const group = new THREE.Group(); group.position.set(ox, oy, oz); group.name = `chunk:${entry.key}`;
      const [opaqueMat, transMat] = paletteFor(stage).worldMaterials();
      for (const [m, mat, opaque] of [[mesh.opaque, opaqueMat, true], [mesh.transparent, transMat, false]]) {
        if (!m.indices.length) continue;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
        g.setAttribute('color', new THREE.BufferAttribute(m.colors, 3));
        g.setAttribute('emissiveMask', new THREE.BufferAttribute(m.emissive, 1));
        g.setAttribute('alphaMask', new THREE.BufferAttribute(m.alphas, 1));
        g.setIndex(new THREE.BufferAttribute(m.indices, 1));
        g.computeBoundingSphere();
        const o = new THREE.Mesh(g, mat);
        o.castShadow = opaque && entry.lod === 0 && config.shadows !== 'none'; o.receiveShadow = true;
        if (!opaque) o.renderOrder = 2;
        o.matrixAutoUpdate = false; o.updateMatrix();
        group.add(o);
        stats.quads += m.quads;
      }
      group.matrixAutoUpdate = false; group.updateMatrix();
      world.add(group); rec.group = group; stage.collidables.add(group);
      const ms = performance.now() - t0;
      stats.lastMs = ms; stats.meshMs = stats.meshMs ? stats.meshMs * 0.9 + ms * 0.1 : ms; stats.meshed++;
      stage.stats.meshMs = stats.meshMs; stage.stats.meshCount = stats.meshed;
    };

    const markDirty = (wx, wy, wz, to) => {
      if (!info) return;
      const [sx, sy, sz] = info.chunk, cx = Math.floor(wx / sx), cy = Math.floor(wy / sy), cz = Math.floor(wz / sz);
      // Patch the cached cells in place (no refetch): re-meshing is then the mesher alone.
      const cached = cellCache.get(key3(cx, cy, cz));
      if (cached && to !== undefined) cached[(wx - cx * sx) + sx * ((wz - cz * sz) + sz * (wy - cy * sy))] = mi(to);
      else cellCache.delete(key3(cx, cy, cz));
      columnTop.delete(`${wx},${wz}`);
      const lx = wx - cx * sx, ly = wy - cy * sy, lz = wz - cz * sz;
      // The chunk itself plus neighbours sharing the edited cell's faces or AO corners.
      for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) for (const dz of [-1, 0, 1]) {
        if ((dx === -1 && lx > 0) || (dx === 1 && lx < sx - 1) || (dy === -1 && ly > 0) || (dy === 1 && ly < sy - 1) || (dz === -1 && lz > 0) || (dz === 1 && lz < sz - 1)) continue;
        const k = key3(cx + dx, cy + dy, cz + dz); if (chunks.has(k)) dirty.add(k);
      }
      // Sky exposure below the edit changes too.
      for (let y = cy - 1; y >= Math.max(0, cy - 3); y--) { const k = key3(cx, y, cz); if (chunks.has(k)) dirty.add(k); }
    };
    rt.on('cell_changed', e => { const at = e.at || []; markDirty(Math.floor(at[0]), Math.floor(at[1]), Math.floor(at[2]), e.to); });
    stage.restoreHooks.push(() => { cellCache.clear(); columnTop.clear(); for (const k of chunks.keys()) dirty.add(k); });

    // Aim outline.
    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)), new THREE.LineBasicMaterial({ color: '#101010', transparent: true, opacity: 0.55 }));
    outline.visible = false; root.add(outline);

    stage.hook('pre', () => {
      if (stage.activeSpace !== spaceId) return;
      syncActors(stage, spaceId, actorsRoot, { drawDistance: stage.settings.drawDistance });
    }, 'graphics.render.voxel');

    stage.hook('world', () => {
      if (stage.activeSpace !== spaceId) return;
      if (!info && !setup()) return;
      const pal = paletteFor(stage);
      // A new palette or hot-loaded content (new blocks/colors) re-resolves materials and re-meshes.
      if (pal !== paletteRef || rt.doc !== docRef) { paletteRef = pal; docRef = rt.doc; resetMaterials(); for (const k of chunks.keys()) dirty.add(k); }
      const cam = stage.viewCenter(), [sx, sy, sz] = info.chunk, cell = info.cell;
      const center = [Math.floor(cam.x / cell / sx), Math.floor(cam.y / cell / sy), Math.floor(cam.z / cell / sz)];
      const yMax = Math.max(0, Math.ceil(info.height / sy) - 1);
      const fwd = new THREE.Vector3(); stage.camera.getWorldDirection(fwd);
      const pk = `${center[0]},${center[2]},${Math.round(Math.atan2(fwd.x, fwd.z) * 2)}`;
      if (pk !== planKey) {
        planKey = pk;
        const plan = chunkPlan(center, { radius: info.view, yRange: [0, yMax], lodRings: config.lodRings, forward: [fwd.x, 0, fwd.z], bounds: info.bounds });
        const want = new Set(plan.map(p => p.key));
        queue = plan.filter(p => { const c = chunks.get(p.key); return !c || c.lod !== p.lod; });
        for (const [k, c] of chunks) if (!want.has(k)) { if (c.group) { world.remove(c.group); stage.collidables.delete(c.group); c.group.traverse(o => o.geometry?.dispose()); } chunks.delete(k); }
      }
      // Edits first (they are what the player is looking at), then streaming, within the budget.
      const budget = config.meshBudgetMs, t0 = performance.now();
      for (const k of dirty) {
        const c = chunks.get(k); dirty.delete(k); if (!c) continue;
        build({ key: k, at: c.at, lod: c.lod });
        if (performance.now() - t0 > budget) break;
      }
      while (queue.length && performance.now() - t0 < budget) {
        const e = queue.shift(); const c = chunks.get(e.key);
        if (c && c.lod === e.lod) continue;
        build(e);
      }
      stats.chunks = chunks.size; stats.queued = queue.length + dirty.size; stage.stats.chunks = stats.chunks;
      objects.frame();
      // Aim outline from the player's eye along its look.
      outline.visible = false;
      const p = rt.player();
      if (config.highlight && p && api.raycast && !stage.isometric) {
        const pose = stage.pose('player'), look = p.components?.body?.look;
        const yaw = look?.[0] ?? stage.viewYaw, pitch = look?.[1] ?? stage.viewPitch;
        const eye = [pose.at[0], pose.at[1] + (stage.eyeHeight ?? 1.6), pose.at[2]], dir = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
        const hit = api.raycast(eye, dir, config.reach);
        if (hit?.hit === 'cell' && hit.cell) { outline.position.set((hit.cell[0] + 0.5) * cell, (hit.cell[1] + 0.5) * cell, (hit.cell[2] + 0.5) * cell); outline.scale.setScalar(cell); outline.visible = true; }
      }
    }, 'graphics.render.voxel');
  },
};
