// Placed-object layer shared by graphics.render.mesh3d and graphics.render.voxel.
// Objects (api.objects() eager + api.objects(region) lazy) stream in square
// cells around the view centre under a time budget:
// - structure shapes (role wall|roof|floor|trim|post|deck|fence, grouped by
//   `group`) are coloured from the structure's style and merged per cell, with
//   windows added on long walls; their shape:'none' markers are skipped;
// - building objects without shapes are generated from {size, floors, style};
// - foliage goes to graphics.foliage.scatter when present;
// - everything else is instanced per model template.
import { buildingParts, BUILDING_STYLES } from './three-buildings.js';
import { propModel } from './three-model-gen.js';
import { GeoBuilder, appendParts } from './three-geometry.js';
import { paletteFor } from './material-palette.js';

// The world-object layer still classifies placed objects by words in their kind, prop and tags (FOLIAGE_KINDS,
// BUILDING_KINDS, OBJECT_PROPS): the generators (engine.generate.scatter, city, structures) do not yet declare what
// each object they place is. Archetypes and items never come here (three-model-gen.js reads their declarations).
/** The 3D prop type (three-model-gen PROP_TYPES) a placed object's kind, prop and tags name. */
const OBJECT_PROPS = [
  ['campfire', /campfire|fire|brazier|bonfire|hearth/], ['lamp', /lamp|lantern|torch|light|candle|beacon/], ['chest', /chest|coffer|loot|cache|trunk/],
  ['crate', /crate|box|package|cargo|supply/], ['barrel', /barrel|keg|cask|drum/], ['bed', /bed|cot|bunk/],
  ['table', /table|desk|bench|workbench|counter|altar|alchemy/], ['anvil', /anvil|forge|furnace|kiln|oven|smelter/],
  ['door', /door|gate|portal|vault/], ['tree', /tree|oak|pine|palm|birch|willow/], ['bush', /bush|shrub|hedge|plant|forage|herb|flower/],
  ['rock', /rock|stone|boulder|ore|crystal/], ['sign', /sign|tablet|ledger|book|note|board|scroll|map/], ['statue', /statue|shrine|idol|totem|monument|seal/],
  ['machine', /vending|machine|terminal|console|computer|generator|engine/], ['barricade', /barricade|fence|wall|barrier/],
  ['crown', /crown|relic|artifact|trophy|chalice|orb/],
];
/** The prop type a placed object is built as. @param {{ kind?: string, prop?: string, model?: string, tags?: string[] }} o */
export const objectPropType = o => { const k = `${o.prop || ''} ${o.model || ''} ${o.kind || ''} ${(o.tags || []).join(' ')}`.toLowerCase().replace(/_/g, ' '); return OBJECT_PROPS.find(([, re]) => re.test(k))?.[0] || 'crate'; };
export const FOLIAGE_KINDS = /tree|bush|shrub|rock|boulder|grass|flower|plant|fern|reed|mushroom|stump|cactus|pebble|hedge/;
export const BUILDING_KINDS = /building|house|hut|tower|hall|shop|barn|stable|forge|shrine|temple|church|castle|keep|warehouse|hangar|structure|ruin|inn|tavern|mill|lighthouse|station|cabin|cottage|manor|fort/;
const ROLE_COLOR = { wall: 'wall', roof: 'roof', floor: 'trim', trim: 'trim', post: 'wood', deck: 'wood', fence: 'wood' };

/** How a placed object is drawn (pure; tested): 'shape' | 'marker' | 'foliage' | 'building' | 'model' | 'none'. */
export function objectRole(o, hasModel = false) {
  if (o.role && ROLE_COLOR[o.role]) return 'shape';
  if (o.shape === 'none') return o.group || o.kind ? 'marker' : 'none';
  if (hasModel) return 'model';
  const k = `${o.kind || ''} ${o.prop || ''} ${(o.tags || []).join(' ')}`;
  if (FOLIAGE_KINDS.test(k)) return 'foliage';
  if (BUILDING_KINDS.test(k) || o.floors) return 'building';
  return 'model';
}

/** Lowpoly parts (local frame, bottom centre at origin) for one structure shape. */
export function shapeParts(o, style) {
  const st = BUILDING_STYLES[style] || BUILDING_STYLES.stone;
  const colors = { wall: st.wall, roof: st.roof || st.trim, trim: st.trim, wood: '#7a5a3a' };
  const c = colors[ROLE_COLOR[o.role]];
  const P = [];
  if (o.shape === 'cylinder') { const r = o.r ?? (o.size?.[0] ?? 0.5) / 2, h = o.h ?? o.size?.[1] ?? 2; P.push({ shape: 'cyl', at: [0, h / 2, 0], size: [r * 2, h, r * 2], c, segments: 8 }); return P; }
  const [w, h, d] = o.size || [1, 1, 1];
  P.push({ shape: 'box', at: [0, h / 2, 0], size: [w, h, d], c });
  if (o.role === 'wall' && h >= 2.2 && Math.max(w, d) >= 2.5) {
    const along = w >= d ? 0 : 2, L = Math.max(w, d), n = Math.max(1, Math.floor(L / 2.8)), thick = Math.min(w, d);
    for (let i = 0; i < n; i++) for (let f = 0; f < Math.min(12, Math.floor(h / 3) || 1); f++) for (const side of [1, -1]) {
      const t = -L / 2 + (i + 0.5) * L / n, y = f * 3 + 1.7;
      if (y + 0.6 > h) continue;
      const at = along === 0 ? [t, y, side * (thick / 2 + 0.03)] : [side * (thick / 2 + 0.03), y, t];
      P.push({ shape: 'box', at, size: along === 0 ? [0.95, 1.15, 0.07] : [0.07, 1.15, 0.95], c: st.window, mat: 'metal' });
    }
  }
  return P;
}

export function createObjectLayer(stage, spaceId, root, opts = {}) {
  const { THREE, rt } = stage;
  const CELL = opts.cell ?? 128;
  const group = new THREE.Group(); group.name = 'objects'; root.add(group);
  const cells = new Map(), stats = opts.stats || {};
  Object.assign(stats, { cells: 0, objects: 0, instanced: 0, merged: 0, buildMs: 0 });
  let eager = null, lastCell = null, pending = [], styles = new Map();
  const api = () => stage.spaceApi(spaceId);
  const models = () => rt.doc.content?.models || {};
  const specOf = o => {
    const m = models();
    if (o.model && m[o.model]) return { id: o.model, spec: m[o.model] };
    if (o.archetype) return stage.models.specFor(o.archetype);
    const name = o.prop || o.kind || 'thing';
    return { id: `obj:${name}:${o.style || ''}`, spec: propModel(name, objectPropType(o)) };
  };
  const matrixOf = (o, scale = 1) => {
    const s = Array.isArray(o.scale) ? o.scale : [o.scale ?? 1, o.scale ?? 1, o.scale ?? 1];
    const y = Number.isFinite(o.at?.[1]) ? o.at[1] : stage.groundAt(spaceId, o.at[0], o.at[2]).y;
    return new THREE.Matrix4().compose(new THREE.Vector3(o.at[0], y, o.at[2]), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.rot || 0), new THREE.Vector3(s[0] * scale, s[1] * scale, s[2] * scale));
  };
  const buildCell = (key, list) => {
    const t0 = performance.now();
    const g = new THREE.Group(); g.name = `cell:${key}`;
    const merged = new GeoBuilder(), byTemplate = new Map(), foliage = [];
    for (const o of list) if (o.shape === 'none' && o.group == null && o.id && o.style) styles.set(o.id, o.style);
    for (const o of list) if (o.shape === 'none' && o.group != null && o.style) styles.set(o.group, o.style);
    const shaped = new Set(list.filter(o => o.role && o.group != null).map(o => o.group));
    for (const o of list) {
      const hasModel = !!(o.model && models()[o.model]) || !!o.archetype;
      const role = objectRole(o, hasModel);
      if (role === 'none' || role === 'marker') continue;
      if (role === 'shape') { appendParts(THREE, merged, shapeParts(o, o.style || styles.get(o.group)), { segments: 8, matrix: matrixOf(o) }); stats.merged++; continue; }
      if (role === 'foliage' && stage.foliage) { foliage.push(o); continue; }
      if (role === 'building') { if (shaped.has(o.id)) continue; appendParts(THREE, merged, buildingParts(o).parts, { segments: 8, matrix: matrixOf(o) }); stats.merged++; continue; }
      const { id, spec } = specOf(o);
      const t = stage.models.template(id, spec);
      const fit = o.size && t.height > 0 && o.scale == null ? o.size[1] / t.height : 1;
      if (!byTemplate.has(t)) byTemplate.set(t, []);
      byTemplate.get(t).push(matrixOf(o, fit));
    }
    const mats = paletteFor(stage).actorMaterials({ skinned: false });
    if (merged.vertexCount) {
      const mesh = new THREE.Mesh(merged.toGeometry(THREE, { skinned: false }), mats);
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; g.add(mesh); stage.collidables.add(mesh);
    }
    for (const [t, matrices] of byTemplate) {
      if (opts.instancing !== false) {
        const im = new THREE.InstancedMesh(t.geometry, mats, matrices.length);
        matrices.forEach((m, i) => im.setMatrixAt(i, m)); im.instanceMatrix.needsUpdate = true;
        im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere(); g.add(im); stats.instanced += matrices.length;
      } else for (const m of matrices) { const mesh = new THREE.Mesh(t.geometry, mats); mesh.applyMatrix4(m); mesh.castShadow = true; g.add(mesh); }
    }
    if (foliage.length) stage.foliage.add(spaceId, key, foliage);
    group.add(g);
    cells.set(key, { group: g, n: list.length });
    stats.objects += list.length; stats.buildMs = performance.now() - t0;
  };
  const dropCell = key => {
    const c = cells.get(key); if (!c) return;
    group.remove(c.group);
    c.group.traverse(o => { if (o.isInstancedMesh) o.dispose(); else if (o.isMesh && o.geometry && !o.geometry.userData.template) { stage.collidables.delete(o); o.geometry.dispose(); } });
    stage.foliage?.remove(spaceId, key);
    cells.delete(key);
  };
  const layer = {
    reset() { for (const k of [...cells.keys()]) dropCell(k); eager = null; lastCell = null; },
    frame() {
      const a = api(); if (!a?.objects) return;
      if (!eager) {
        eager = new Map();
        let all = []; try { all = a.objects() || []; } catch { all = []; }
        for (const o of all) { if (!o?.at) continue; const k = `${Math.floor(o.at[0] / CELL)},${Math.floor(o.at[2] / CELL)}`; if (!eager.has(k)) eager.set(k, []); eager.get(k).push(o); }
      }
      const c = stage.viewCenter(), cx = Math.floor(c.x / CELL), cz = Math.floor(c.z / CELL), key = `${cx},${cz}`;
      if (key !== lastCell) {
        lastCell = key;
        const R = Math.ceil((opts.distance ?? 500) / CELL), want = new Set();
        pending = [];
        for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
          if (Math.hypot(dx, dz) > R + 0.5) continue;
          const k = `${cx + dx},${cz + dz}`; want.add(k);
          if (!cells.has(k)) pending.push({ k, x: cx + dx, z: cz + dz, d: Math.hypot(dx, dz) });
        }
        pending.sort((p, q) => p.d - q.d);
        for (const k of [...cells.keys()]) if (!want.has(k)) dropCell(k);
      }
      const t0 = performance.now();
      while (pending.length && performance.now() - t0 < (opts.budgetMs ?? 3)) {
        const p = pending.shift();
        const region = { min: [p.x * CELL, p.z * CELL], max: [(p.x + 1) * CELL, (p.z + 1) * CELL] };
        let lazy = []; try { lazy = a.objects(region) || []; } catch { lazy = []; }
        const own = eager.get(p.k) || [], seen = new Set(own.map(o => o.id));
        buildCell(p.k, [...own, ...lazy.filter(o => o?.at && !seen.has(o.id) && Math.floor(o.at[0] / CELL) === p.x && Math.floor(o.at[2] / CELL) === p.z)]);
      }
      stats.cells = cells.size;
    },
  };
  stage.restoreHooks.push(() => layer.reset());
  return layer;
}
