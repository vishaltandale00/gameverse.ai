// graphics.foliage.scatter: instanced trees, bushes, rocks and plants from
// the space's scattered objects (engine.generate.scatter) with wind sway in
// the vertex shader (stronger toward the crown, gusting, scaled by the
// weather's wind), a cheaper far LOD, distance culling, and optional
// decorative ground cover (flowers, pebbles, ferns) that never collides.
import { joinStage, presentationOnly } from './three-stage.js';
import { propModel } from './three-model-gen.js';
import { objectPropType } from './three-objects.js';
import { paletteFor } from './material-palette.js';
import { scatterPoints, splatSample } from './three-terrain.js';
import { hash3 } from './three-util.js';
import { modelsData } from './model-lib.js';

/** LOD tier for a distance (pure; tested): 0 full, 1 far, -1 culled. */
export const foliageLod = (d, lodDistance, cull) => d > cull ? -1 : d > lodDistance ? 1 : 0;

export default {
  id: 'graphics.foliage.scatter',
  card: {
    intent: 'Instanced trees, bushes, rocks and plants from the space\'s scattered objects, swaying in the wind (crown-weighted, gusting, scaled by the weather wind var), with a far LOD, distance culling and optional non-colliding decorative ground cover.',
    views: ['1p', '3p', 'iso', 'td'],
    params: {
      windSway: { type: 'number', default: 0.3, min: 0, max: 2, effect: 'sway amount' },
      lodDistance: { type: 'number', default: 400, min: 10, max: 5000, unit: 'm', effect: 'beyond this, trees use the simple far model' },
      cull: { type: 'number', default: 900, min: 20, max: 10000, unit: 'm', effect: 'beyond this, foliage is not drawn' },
      decor: { type: 'number', default: 0.25, min: 0, max: 3, unit: '/m²', effect: 'decorative flowers, pebbles and ferns near the camera (0 = none; never collides)' },
      decorRadius: { type: 'number', default: 30, min: 5, max: 120, unit: 'm' },
    },
    provides: {},
    requires: { capabilities: ['surface'] },
    reads: ['content.models'],
    data: { 'content.models': modelsData(['kind', 'palette', 'parts', 'size', 'rig', 'height', 'length', 'species', 'alpha', 'saddle']) },
  },
  install(rt, config, instance) {
    if (presentationOnly(rt)) return;
    const stage = joinStage(rt, instance);
    const THREE = stage.THREE;
    const spaceId = instance.space ?? rt.doc.spaces?.[0]?.id;
    const root = stage.spaceRoot(spaceId);
    const group = new THREE.Group(); group.name = 'foliage'; root.add(group);
    const uniforms = { uTime: { value: 0 }, uWind: { value: config.windSway } };
    const swayMats = new Map();
    // Wind: displacement grows with height above the instance origin; trunks stay planted.
    const swaying = base => {
      if (swayMats.has(base)) return swayMats.get(base);
      const m = base.clone();
      m.onBeforeCompile = sh => {
        base.onBeforeCompile?.(sh);
        Object.assign(sh.uniforms, uniforms);
        sh.vertexShader = 'uniform float uTime, uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  #ifdef USE_INSTANCING
  { vec4 ip = instanceMatrix[3]; float h = max(0.0, position.y); float ph = uTime * 1.3 + ip.x * 0.11 + ip.z * 0.07;
    float gust = 0.55 + 0.45 * sin(uTime * 0.45 + ip.x * 0.013);
    float k = h * h * 0.012 * uWind * gust; transformed.x += sin(ph) * k; transformed.z += cos(ph * 0.7) * k * 0.6; }
  #endif`);
      };
      m.customProgramCacheKey = () => `sway:${base.type}:${base.transparent}`;
      swayMats.set(base, m); return m;
    };
    const cells = new Map(); // `${space}|${cell}` -> { meshes:[{mesh, lod, center}] }
    const templates = new Map();
    const templateFor = (o, lod) => {
      const k = `${o.model || o.kind || 'tree'}|${o.style || ''}|${lod}`;
      if (templates.has(k)) return templates.get(k);
      const models = rt.doc.content?.models || {};
      let id, spec;
      if (o.model && models[o.model]) { id = o.model; spec = models[o.model]; }
      else { id = `foliage:${o.kind}:${o.style || ''}`; spec = propModel(`${o.kind || 'tree'}${o.style ? '_' + o.style : ''}`, objectPropType({ ...o, kind: o.kind || 'tree' })); }
      if (lod === 1) spec = { ...spec, parts: (spec.parts || []).map(p => ({ ...p, segments: 4 })) };
      const t = stage.models.template(`${id}|lod${lod}`, spec);
      templates.set(k, t); return t;
    };
    stage.foliage = {
      add(space, cellKey, objects) {
        const byT = new Map();
        for (const o of objects) for (const lod of [0, 1]) {
          const t = templateFor(o, lod);
          if (!byT.has(t)) byT.set(t, { lod, list: [] });
          byT.get(t).list.push(o);
        }
        const meshes = [];
        const mats = paletteFor(stage).actorMaterials({ skinned: false }).map(swaying);
        for (const [t, { lod, list }] of byT) {
          const im = new THREE.InstancedMesh(t.geometry, mats, list.length);
          const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
          let cx = 0, cz = 0;
          list.forEach((o, i) => {
            const s = Array.isArray(o.scale) ? o.scale : [o.scale ?? 1, o.scale ?? 1, o.scale ?? 1];
            const fit = o.size && !o.scale && t.height > 0 ? o.size[1] / t.height : 1;
            const y = Number.isFinite(o.at[1]) ? o.at[1] : stage.groundAt(space, o.at[0], o.at[2]).y;
            q.setFromAxisAngle(up, o.rot ?? hash3(Math.floor(o.at[0] * 10), 0, Math.floor(o.at[2] * 10)) * 6.283);
            m4.compose(new THREE.Vector3(o.at[0], y - 0.05, o.at[2]), q, new THREE.Vector3(s[0] * fit, s[1] * fit, s[2] * fit));
            im.setMatrixAt(i, m4); cx += o.at[0]; cz += o.at[2];
          });
          im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
          im.castShadow = lod === 0; im.receiveShadow = true;
          group.add(im);
          meshes.push({ mesh: im, lod, center: new THREE.Vector3(cx / list.length, 0, cz / list.length) });
        }
        cells.set(`${space}|${cellKey}`, { meshes });
      },
      remove(space, cellKey) {
        const c = cells.get(`${space}|${cellKey}`); if (!c) return;
        for (const { mesh } of c.meshes) { group.remove(mesh); mesh.dispose(); }
        cells.delete(`${space}|${cellKey}`);
      },
    };
    // Decorative ground cover around the camera (presentation only).
    const DECOR = [
      { kind: 'flower', parts: [{ shape: 'cyl', at: [0, 0.12, 0], size: [0.02, 0.24, 0.02], c: '#3a6a2a' }, { shape: 'sphere', at: [0, 0.26, 0], size: [0.09, 0.06, 0.09], c: 'petal' }] },
      { kind: 'pebble', parts: [{ shape: 'sphere', at: [0, 0.04, 0], size: [0.18, 0.09, 0.14], c: '#8a8680', segments: 5 }] },
      { kind: 'fern', parts: [0, 1, 2, 3, 4].map(i => ({ shape: 'box', at: [Math.sin(i * 1.26) * 0.15, 0.14, Math.cos(i * 1.26) * 0.15], size: [0.06, 0.02, 0.32], rot: [0.6, i * 1.26, 0], c: '#3f7a32' })) },
    ];
    const decorMeshes = DECOR.map((d, i) => {
      const petals = ['#e8d040', '#e86a8a', '#f0f0f0', '#9a7ae8'];
      const t = stage.models.template(`decor:${d.kind}`, { kind: 'lowpoly', palette: { petal: petals[i % petals.length] }, parts: d.parts });
      const im = new THREE.InstancedMesh(t.geometry, paletteFor(stage).actorMaterials({ skinned: false }).map(swaying), 4000);
      im.count = 0; im.frustumCulled = false; im.receiveShadow = true; group.add(im);
      return im;
    });
    let decorKey = null;
    const refreshDecor = c => {
      if (!config.decor) return;
      const key = `${Math.round(c.x / 5)},${Math.round(c.z / 5)}`; if (key === decorKey) return; decorKey = key;
      const R = config.decorRadius, counts = decorMeshes.map(() => 0), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
      const splat = stage.terrains?.get(spaceId)?.config?.splat || [];
      const water = stage.terrains?.get(spaceId)?.config?.water?.level ?? -Infinity;
      const onRoad = stage.roadMasks?.get(spaceId);
      for (const p of scatterPoints(c.x - R, c.z - R, R * 2, config.decor, 23, (x, z) => (x - c.x) ** 2 + (z - c.z) ** 2 < R * R && !onRoad?.(x, z))) {
        const g = stage.groundAt(spaceId, p.x, p.z); if (g.y < water + 0.3) continue;
        const col = splatSample({ biome: g.biome, material: g.material, slope: 0, height: g.y }, splat).color;
        const grassy = col[1] > col[0] && col[1] > col[2];
        const kind = grassy ? (p.r < 0.55 ? 0 : p.r < 0.8 ? 2 : 1) : 1;
        const im = decorMeshes[kind]; if (counts[kind] >= 4000) continue;
        q.setFromAxisAngle(up, p.r * 40); const s = 0.7 + hash3(Math.floor(p.x * 7), 2, Math.floor(p.z * 7)) * 0.8;
        m4.compose(new THREE.Vector3(p.x, g.y, p.z), q, new THREE.Vector3(s, s, s)); im.setMatrixAt(counts[kind]++, m4);
      }
      decorMeshes.forEach((im, i) => { im.count = counts[i]; im.instanceMatrix.needsUpdate = true; });
    };
    stage.hook('world', ctx => {
      if (stage.activeSpace !== spaceId) return;
      uniforms.uTime.value = ctx.time;
      const wind = rt.state.vars['weather.wind'];
      uniforms.uWind.value = config.windSway * (Number.isFinite(wind) ? 0.5 + wind * 1.5 : 1);
      const c = stage.viewCenter();
      for (const { meshes } of cells.values()) for (const m of meshes) {
        const d = Math.hypot(m.center.x - c.x, m.center.z - c.z);
        const tier = foliageLod(d, config.lodDistance, config.cull);
        m.mesh.visible = tier === m.lod;
      }
      refreshDecor(c);
    }, 'graphics.foliage.scatter');
  },
};
