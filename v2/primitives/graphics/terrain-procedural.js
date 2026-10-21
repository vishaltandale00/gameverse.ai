// graphics.terrain.procedural: the 3D outdoor look over a heightfield space:
// quadtree LOD patches with crack-hiding skirts built under a per-frame
// budget, slope/height/biome splat colours with procedural detail noise and
// shoreline foam, instanced grass that sways with the wind (and the weather's
// wind var), an animated water plane with fresnel sky reflection, and
// distance fog for atmosphere. graphics.render.mesh3d uses the same system
// with defaults when no terrain.procedural instance is present.
import { joinStage, presentationOnly } from './three-stage.js';
import { quadtreePatches, splatSample, buildPatch, scatterPoints } from './three-terrain.js';
import { colorOf, hash3 } from './three-util.js';
import { HEX6_COLOR } from './model-lib.js';

const DEFAULTS = { lodLevels: 4, patch: 64, resolution: 32, splat: [], grass: { density: 0.6, height: 0.45, windSway: 0.3, radius: 42 }, water: null, fog: null, budgetMs: 3 };

function terrainMaterial(stage, cfg) {
  const THREE = stage.THREE, toon = stage.palette?.style === 'toon';
  const mat = toon ? new THREE.MeshToonMaterial({ vertexColors: true }) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const u = stage.terrainUniforms ??= { uTime: { value: 0 }, uWater: { value: -1e6 }, uFoam: { value: 0 } };
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'varying vec3 vTW;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vTW = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = 'uniform float uTime, uWater, uFoam; varying vec3 vTW;\nfloat th(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\nfloat tn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(th(i), th(i+vec2(1,0)), f.x), mix(th(i+vec2(0,1)), th(i+vec2(1,1)), f.x), f.y); }\n' +
      sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
  { float d = tn(vTW.xz * 0.45) * 0.5 + tn(vTW.xz * 1.7) * 0.3 + tn(vTW.xz * 6.0) * 0.2;
    diffuseColor.rgb *= 0.86 + d * 0.28;
    float above = vTW.y - uWater;
    diffuseColor.rgb *= mix(0.72, 1.0, smoothstep(0.0, 0.6, above));                 // wet band
    float wave = 0.12 * sin(uTime * 1.3 + vTW.x * 0.35 + vTW.z * 0.21);
    float foam = (1.0 - smoothstep(0.0, 0.35, abs(above - 0.1 - wave))) * uFoam * (0.6 + 0.4 * tn(vTW.xz * 3.0 + uTime * 0.4));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 0.97), foam * 0.75); }`);
  };
  return mat;
}

function waterMesh(stage, water) {
  const THREE = stage.THREE;
  const geo = new THREE.PlaneGeometry(1, 1, 1, 1); geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: water.color || '#2a5a7a', transparent: true, opacity: 0.84, roughness: 0.12, metalness: 0.05, depthWrite: false });
  const u = { uTime: stage.terrainUniforms.uTime, uSky: { value: new THREE.Color('#9ab8d8') }, uReflect: { value: water.reflect === false ? 0 : 1 } };
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'varying vec3 vWW;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vWW = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = 'uniform float uTime, uReflect; uniform vec3 uSky; varying vec3 vWW;\n' + sh.fragmentShader
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
  { vec2 p = vWW.xz; float t = uTime;
    vec2 g = vec2(cos(p.x * 0.21 + t * 1.1) * 0.6 + cos(p.x * 0.53 - p.y * 0.31 + t * 1.7) * 0.4, sin(p.y * 0.19 + t * 0.9) * 0.6 + sin(p.y * 0.47 + p.x * 0.27 + t * 1.5) * 0.4);
    normal = normalize(normal + (viewMatrix * vec4(g.x * 0.08, 0.0, g.y * 0.08, 0.0)).xyz); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  { vec3 v = normalize(cameraPosition - vWW); float fres = pow(1.0 - max(dot(v, vec3(0.0, 1.0, 0.0)), 0.0), 3.0);
    totalEmissiveRadiance += uSky * fres * 0.55 * uReflect; diffuseColor.a = mix(diffuseColor.a, 0.97, fres); }`);
  };
  const mesh = new THREE.Mesh(geo, mat); mesh.renderOrder = 3; mesh.receiveShadow = true; mesh.name = 'water';
  mesh.userData.uniforms = u;
  return mesh;
}

function grassLayer(stage, cfg) {
  const THREE = stage.THREE;
  // A clump: three crossed tapered blades, coloured dark at the root and light at the tip.
  const pos = [], col = [], sway = [];
  for (let b = 0; b < 3; b++) {
    const a = b * Math.PI / 3, cx = Math.cos(a) * 0.5, cz = Math.sin(a) * 0.5;
    const quad = [[-cx * 0.35, 0, -cz * 0.35], [cx * 0.35, 0, cz * 0.35], [cx * 0.08, 1, cz * 0.08], [-cx * 0.08, 1, -cz * 0.08]];
    for (const i of [0, 1, 2, 0, 2, 3]) { const q = quad[i]; pos.push(q[0], q[1], q[2]); const t = q[1]; col.push(0.75 + 0.55 * t, 0.8 + 0.6 * t, 0.65 + 0.35 * t); sway.push(t); /* darker root, sunlit tip */ }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('sway', new THREE.Float32BufferAttribute(sway, 1));
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const u = { uTime: stage.terrainUniforms.uTime, uWind: { value: cfg.windSway ?? 0.3 } };
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'attribute float sway; uniform float uTime, uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  { vec4 ip = instanceMatrix[3]; float ph = uTime * 2.1 + ip.x * 0.37 + ip.z * 0.29;
    float gust = 0.6 + 0.4 * sin(uTime * 0.6 + ip.x * 0.05);
    transformed.x += sin(ph) * sway * sway * uWind * gust * 0.9; transformed.z += cos(ph * 0.8) * sway * sway * uWind * gust * 0.45; }`);
    // Normals point up so blades light like the ground they grow from.
    sh.vertexShader = sh.vertexShader.replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);');
    // Both blade faces light like the ground (no dark back faces).
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  normal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);');
  };
  const MAX = 14000;
  const mesh = new THREE.InstancedMesh(geo, mat, MAX); mesh.count = 0; mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.name = 'grass';
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
  return { mesh, uniforms: u, MAX };
}

/** Create (once per space) the terrain system. Returns its controller. */
export function ensureTerrain(stage, spaceId, root) {
  stage.terrains ??= new Map();
  if (stage.terrains.get(spaceId)?.system) return stage.terrains.get(spaceId).system;
  const entry = stage.terrains.get(spaceId) || {};
  const cfg = { ...DEFAULTS, ...(entry.config || {}) };
  cfg.grass = cfg.grass === false ? null : { ...DEFAULTS.grass, ...(cfg.grass || {}) };
  const THREE = stage.THREE, rt = stage.rt;
  const group = new THREE.Group(); group.name = 'terrain'; root.add(group);
  stage.terrainUniforms ??= { uTime: { value: 0 }, uWater: { value: -1e6 }, uFoam: { value: 0 } };
  const material = terrainMaterial(stage, cfg);
  const patches = new Map();
  let queue = [], want = new Set(), lastPlan = null, bounds = null, biomeDefs = null;
  const stats = stage.stats.terrain = { patches: 0, queued: 0, buildMs: 0, built: 0 };
  const api = () => stage.spaceApi(spaceId);
  const getBounds = () => {
    const a = api(); if (!a) return null;
    if (a.bounds) { const b = a.bounds(); return { min: [b.min[0], b.min[2] ?? b.min[1]], max: [b.max[0], b.max[2] ?? b.max[1]], minY: b.min[1], maxY: b.max[1] }; }
    if (a.size) { const s = a.size; return { min: [0, 0], max: [s[0], s.length === 3 ? s[2] : s[1]] }; }
    return { min: [-2048, -2048], max: [2048, 2048] };
  };
  const biomeColor = id => {
    if (!id) return null;
    if (!biomeDefs) { biomeDefs = new Map(); try { const svc = rt.service('biomeAt'); biomeDefs.def = svc.def; } catch {} }
    if (!biomeDefs.has(id)) biomeDefs.set(id, biomeDefs.def?.(id)?.color ?? null);
    return biomeDefs.get(id);
  };
  const sampler = (x, z) => { const g = stage.groundAt(spaceId, x, z); return { y: g.y, biome: g.biome, material: g.material, biomeColor: biomeColor(g.biome) }; };
  const colorAt = (s, x, z, slope, y) => {
    const out = splatSample({ ...s, slope, height: y }, cfg.splat).color;
    const j = 0.94 + hash3(Math.floor(x / 3), 0, Math.floor(z / 3), 5) * 0.12; // patchy variation
    return [out[0] * j, out[1] * j, out[2] * j];
  };
  let water = null;
  if (cfg.water && Number.isFinite(cfg.water.level)) {
    water = waterMesh(stage, cfg.water); group.add(water);
    stage.terrainUniforms.uWater.value = cfg.water.level; stage.terrainUniforms.uFoam.value = cfg.water.foam === false ? 0 : 1;
  }
  const grass = cfg.grass && cfg.grass.density > 0 ? grassLayer(stage, cfg.grass) : null;
  if (grass) group.add(grass.mesh);
  let grassAt = null;
  if (cfg.fog) stage.fogLinear = cfg.fog;
  else if (!stage.scene.fog) stage.scene.fog = new THREE.Fog('#b8c8d8', stage.settings.drawDistance * 0.4, stage.settings.drawDistance);

  const build = p => {
    const t0 = performance.now();
    const n = Math.max(4, Math.round(cfg.resolution));
    const data = buildPatch({ x: p.x, z: p.z, size: p.size, n, skirt: Math.max(2, p.size / n * 2) }, sampler, colorAt);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    g.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
    g.setIndex(new THREE.BufferAttribute(data.indices, 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.receiveShadow = true; m.castShadow = p.level <= 1; m.matrixAutoUpdate = false; m.updateMatrix(); m.name = `patch:${p.key}`;
    group.add(m); patches.set(p.key, m); stage.collidables.add(m);
    const ms = performance.now() - t0; stats.buildMs = stats.buildMs ? stats.buildMs * 0.9 + ms * 0.1 : ms; stats.built++;
  };
  const drop = key => { const m = patches.get(key); if (!m) return; group.remove(m); stage.collidables.delete(m); m.geometry.dispose(); patches.delete(key); };

  const refreshGrass = c => {
    if (!grass) return;
    const R = cfg.grass.radius, key = `${Math.round(c.x / 6)},${Math.round(c.z / 6)}`;
    if (grassAt === key) return; grassAt = key;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), p3 = new THREE.Vector3();
    let n = 0;
    const density = Math.min(4, cfg.grass.density * 1.2);
    const onRoad = stage.roadMasks?.get(spaceId);
    const pts = scatterPoints(c.x - R, c.z - R, R * 2, density, 11, (x, z) => (x - c.x) ** 2 + (z - c.z) ** 2 < R * R && !onRoad?.(x, z));
    for (const pt of pts) {
      if (n >= grass.MAX) break;
      const s = sampler(pt.x, pt.z);
      if (water && s.y < cfg.water.level + 0.25) continue;
      const nx = sampler(pt.x + 0.5, pt.z).y - s.y, nz = sampler(pt.x, pt.z + 0.5).y - s.y;
      if (Math.hypot(nx, nz) > 0.35) continue; // too steep
      const col = splatSample({ ...s, slope: 0, height: s.y }, cfg.splat).color;
      if (!(col[1] > col[0] * 0.95 && col[1] > col[2] * 1.05)) continue; // grassy ground only
      const h = cfg.grass.height * (0.6 + pt.r * 0.8);
      q.setFromAxisAngle(up, pt.r * 6.283); sc.set(h * 0.8, h, h * 0.8); p3.set(pt.x, s.y - 0.02, pt.z);
      m4.compose(p3, q, sc); grass.mesh.setMatrixAt(n, m4);
      const k = 0.85 + hash3(Math.floor(pt.x), 1, Math.floor(pt.z), 3) * 0.3;
      grass.mesh.instanceColor.setXYZ(n, col[0] * k * 1.25, col[1] * k * 1.35, col[2] * k * 1.1);
      n++;
    }
    grass.mesh.count = n; grass.mesh.instanceMatrix.needsUpdate = true; grass.mesh.instanceColor.needsUpdate = true;
    stats.grass = n;
  };

  const system = {
    cfg, group, patches,
    frame(ctx) {
      stage.terrainUniforms.uTime.value = ctx.time;
      if (!bounds) { bounds = getBounds(); if (!bounds) return; }
      const c = stage.viewCenter();
      const radius = stage.settings.drawDistance;
      const moved = !lastPlan || Math.hypot(c.x - lastPlan[0], c.z - lastPlan[2]) > cfg.patch * 0.25 || Math.abs(c.y - lastPlan[1]) > cfg.patch * 0.5;
      if (moved) {
        lastPlan = [c.x, c.y, c.z];
        const plan = quadtreePatches([c.x, c.y - stage.groundAt(spaceId, c.x, c.z).y, c.z], { patch: cfg.patch, levels: cfg.lodLevels, bounds, radius });
        want = new Set(plan.map(p => (p.key = `${p.x},${p.z},${p.size}`)));
        queue = plan.filter(p => !patches.has(p.key));
      }
      const t0 = performance.now();
      while (queue.length && performance.now() - t0 < cfg.budgetMs) { const p = queue.shift(); if (!patches.has(p.key)) build(p); }
      if (!queue.length) for (const key of [...patches.keys()]) if (!want.has(key)) drop(key);
      stats.patches = patches.size; stats.queued = queue.length;
      if (water) {
        const s = Math.max(400, radius * 2.2);
        water.scale.set(s, 1, s); water.position.set(Math.round(c.x / 32) * 32, cfg.water.level, Math.round(c.z / 32) * 32);
        const sky = stage.skyState; if (sky) water.userData.uniforms.uSky.value.setRGB(...sky.horizon, THREE.SRGBColorSpace);
      }
      if (grass) {
        const wind = Number.isFinite(rt.state.vars['weather.wind']) ? rt.state.vars['weather.wind'] : null;
        grass.uniforms.uWind.value = (cfg.grass.windSway ?? 0.3) * (wind != null ? 0.5 + wind * 1.5 : 1);
        refreshGrass(c);
      }
    },
    invalidate() { for (const k of [...patches.keys()]) drop(k); lastPlan = null; grassAt = null; bounds = null; },
  };
  stage.restoreHooks.push(() => system.invalidate());
  stage.terrains.set(spaceId, { ...entry, config: cfg, system });
  return system;
}

export default {
  id: 'graphics.terrain.procedural',
  card: {
    intent: 'Rich 3D outdoor terrain over a heightfield space: quadtree LOD patches with skirts, splat colours by biome/slope/height with detail noise and shoreline foam, wind-swayed instanced grass, an animated reflective water plane, and distance fog.',
    views: ['1p', '3p', 'iso', 'td'],
    params: {
      lodLevels: { type: 'integer', default: 4, min: 1, max: 6, effect: 'quadtree levels (more = farther terrain at the same detail budget)' },
      patch: { type: 'integer', default: 64, min: 16, max: 256, unit: 'm', effect: 'finest patch edge length' },
      resolution: { type: 'integer', default: 32, min: 4, max: 128, effect: 'quads per patch edge at every level' },
      splat: { type: 'list', default: [], effect: 'surface colour rules; biome/material rules set the base, slope/height rules layer on top', of: { type: 'object', fields: {
        biome: { type: 'string' }, material: { type: 'string' },
        slope: { type: 'list', of: { type: 'number', min: 0, max: 90 }, min: 2, max: 2, unit: 'deg' },
        height: { type: 'list', of: { type: 'number' }, min: 2, max: 2, unit: 'm' },
        color: { type: 'string', required: true, pattern: HEX6_COLOR }, roughness: { type: 'number', min: 0, max: 1, default: 0.9 },
      } } },
      grass: { type: 'object', default: {}, effect: 'instanced grass near the camera', fields: {
        density: { type: 'number', default: 0.6, min: 0, max: 4, unit: '/m²' }, height: { type: 'number', default: 0.45, min: 0.05, max: 3, unit: 'm' },
        windSway: { type: 'number', default: 0.3, min: 0, max: 2 }, radius: { type: 'number', default: 42, min: 5, max: 200, unit: 'm' },
      } },
      water: { type: 'object', effect: 'water plane', fields: {
        level: { type: 'number', required: true, unit: 'm' }, color: { type: 'string', default: '#2a5a7a' }, foam: { type: 'boolean', default: true }, reflect: { type: 'boolean', default: true },
      } },
      fog: { type: 'object', effect: 'linear distance fog (graphics.sky tints it by hour and weather)', fields: { near: { type: 'number', default: 300, min: 0 }, far: { type: 'number', default: 1800, min: 1 }, color: { type: 'string', default: '#a8b8c8' } } },
      budgetMs: { type: 'number', default: 3, min: 0.5, max: 16, unit: 'ms', effect: 'patch building time per frame' },
    },
    provides: {},
    requires: { capabilities: ['surface'] },
    rules: {
      splat_rule: { fields: ['splat[].biome', 'splat[].material', 'splat[].slope', 'splat[].height'], message: 'a splat rule names at least one of biome, material, slope and height', example: { doc: { graphics: [{ use: 'graphics.terrain.procedural', with: { splat: [{ color: '#557744' }] } }] } } },
      splat_range: { fields: ['splat[].slope', 'splat[].height'], message: 'a slope or height range is [low, high] with low < high' },
      fog_range: { fields: ['fog.near', 'fog.far'], message: 'fog near is below fog far' },
    },
  },
  validate(config) {
    const errs = [];
    (config.splat || []).forEach((r, i) => {
      if (!r.biome && !r.material && !r.slope && !r.height) errs.push({ code: 'splat_rule', path: `splat[${i}]`, message: 'a splat rule needs biome, material, slope or height' });
      for (const k of ['slope', 'height']) if (Array.isArray(r[k]) && !(r[k][0] < r[k][1])) errs.push({ code: 'splat_range', path: `splat[${i}].${k}`, message: `${k} range must be [low, high]` });
    });
    if (config.fog && !(config.fog.near < config.fog.far)) errs.push({ code: 'fog_range', path: 'fog', message: 'fog near must be below far' });
    return errs;
  },
  install(rt, config, instance) {
    if (presentationOnly(rt)) return;
    const stage = joinStage(rt, instance);
    const spaceId = instance.space ?? rt.doc.spaces?.[0]?.id;
    stage.terrains ??= new Map();
    const entry = stage.terrains.get(spaceId) || {};
    stage.terrains.set(spaceId, { ...entry, config: { ...config } });
    if (config.fog) stage.fogLinear = config.fog;
  },
};

export { colorOf };
