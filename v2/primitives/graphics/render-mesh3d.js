// graphics.render.mesh3d: three.js scene for heightfield + placed-object
// spaces. Terrain comes from graphics.terrain.procedural (or its defaults);
// placed objects stream in 128 m cells: buildings are generated from
// {size, floors, style} and merged per cell, props and repeated models are
// instanced, foliage goes to graphics.foliage.scatter when present; roads
// from the roadgraph service become terrain-following ribbons; entities are
// skinned, animated actors. Shadows: none | sun | cascade (wider, sharper).
import { joinStage, presentationOnly } from './three-stage.js';
import { ensureTerrain } from './terrain-procedural.js';
import { syncActors } from './three-actors.js';
import { roadRibbon, roadMask } from './three-buildings.js';
import { createObjectLayer } from './three-objects.js';
import { ensureDefaultCamera } from './three-camera.js';
import thirdPerson from './camera-third-person.js';

export { objectRole } from './three-objects.js';

export default {
  id: 'graphics.render.mesh3d',
  card: {
    intent: 'three.js scene for heightfield + placed-object spaces: LOD terrain, streamed placed objects (generated buildings merged per cell, instanced props and models, foliage via graphics.foliage.scatter), terrain-following roads from the roadgraph, skinned animated actors, and sun or cascade shadows.',
    views: ['1p', '3p', 'iso', 'td'],
    params: {
      shadows: { type: 'string', options: ['none', 'sun', 'cascade'], default: 'cascade', effect: 'sun shadow quality (cascade = wider, higher resolution)' },
      drawDistance: { type: 'number', default: 1200, min: 50, max: 20000, unit: 'm', effect: 'terrain and object draw distance (fog hides the edge)' },
      instancing: { type: 'boolean', default: true, effect: 'instance repeated props and models' },
      objectDistance: { type: 'number', default: 500, min: 50, max: 5000, unit: 'm', effect: 'distance within which placed objects stream in' },
      roads: { type: 'boolean', default: true, effect: 'draw roads from the roadgraph service' },
    },
    provides: { services: ['camera'] },
    requires: { capabilities: ['surface'] },
    reads: ['content.models'],
  },
  install(rt, config, instance) {
    if (presentationOnly(rt)) return;
    const stage = joinStage(rt, instance);
    const THREE = stage.THREE;
    const spaceId = instance.space ?? rt.doc.spaces?.[0]?.id;
    const root = stage.spaceRoot(spaceId);
    const actorsRoot = new THREE.Group(); actorsRoot.name = 'actors'; root.add(actorsRoot);
    stage.worldStyle ??= 'lowpoly';
    stage.settings.shadows = config.shadows;
    stage.settings.drawDistance = config.drawDistance;
    stage.shadowExtent = config.shadows === 'cascade' ? 70 : 45;
    stage.camera.far = Math.max(stage.camera.far, config.drawDistance * 1.25); stage.camera.updateProjectionMatrix();
    ensureDefaultCamera(stage, () => thirdPerson.install(rt, { distance: 4.5, height: 1.6, fov: 65, lockOnBlend: 0.6, shoulder: 'center', collide: true, recenter: 1.5, pitch: -0.25 }, { key: 'default-camera' }));
    let terrain = null, roadsBuilt = false;
    const stats = stage.stats.mesh3d = {};
    const api = () => stage.spaceApi(spaceId);
    const objects = createObjectLayer(stage, spaceId, root, { distance: config.objectDistance, instancing: config.instancing, stats });

    const buildRoads = () => {
      roadsBuilt = true;
      if (!config.roads || !rt.hasService('roadgraph')) return;
      let graph; try { const svc = rt.service('roadgraph'); graph = typeof svc === 'function' ? svc(spaceId) : svc.of?.(spaceId) ?? svc; } catch { return; }
      const edges = graph?.edges || [];
      if (!edges.length) return;
      const mask = roadMask(edges, 2);
      (stage.roadMasks ??= new Map()).set(spaceId, (x, z) => mask.has(`${Math.floor(x / 2)},${Math.floor(z / 2)}`));
      const all = { pos: [], col: [], idx: [] };
      for (const e of edges) {
        const r = roadRibbon(e, (x, z) => stage.groundAt(spaceId, x, z));
        const base = all.pos.length / 3;
        for (const v of r.positions) all.pos.push(v); for (const v of r.colors) all.col.push(v); for (const i of r.indices) all.idx.push(base + i);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(all.pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(all.col, 3));
      g.setIndex(all.idx); g.computeVertexNormals(); g.computeBoundingSphere();
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const mesh = new THREE.Mesh(g, mat); mesh.receiveShadow = true; mesh.name = 'roads';
      root.add(mesh);
      stats.roads = edges.length;
    };

    stage.hook('pre', () => {
      if (stage.activeSpace !== spaceId) return;
      syncActors(stage, spaceId, actorsRoot, { drawDistance: Math.min(config.drawDistance, 400) });
    }, 'graphics.render.mesh3d');

    stage.hook('world', ctx => {
      if (stage.activeSpace !== spaceId || !api()) return;
      if (!roadsBuilt) buildRoads(); // first: grass and decor read the road mask
      terrain ??= ensureTerrain(stage, spaceId, root);
      terrain.frame(ctx);
      objects.frame();
    }, 'graphics.render.mesh3d');
  },
};
