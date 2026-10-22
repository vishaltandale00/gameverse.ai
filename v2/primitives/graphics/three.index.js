// graphics.camera.isometric (shared 2D/3D) is registered in flat.index.js.
// Primitives registered by the graphics three workstream. Append imports and list entries here only.
import renderVoxel from './render-voxel.js';
import materialPalette from './material-palette.js';
import sky from './sky.js';
import cameraFirstPerson from './camera-first-person.js';
import cameraThirdPerson from './camera-third-person.js';
import modelVoxel from './model-voxel.js';
import modelLowpoly from './model-lowpoly.js';
import rigHumanoid from './rig-humanoid.js';
import rigQuadruped from './rig-quadruped.js';
import animClips from './anim-clips.js';
import animLocomotion from './anim-locomotion.js';
import animIk from './anim-ik.js';
import animSecondary from './anim-secondary.js';
import animRagdoll from './anim-ragdoll.js';
import renderMesh3d from './render-mesh3d.js';
import terrainProcedural from './terrain-procedural.js';
import foliageScatter from './foliage-scatter.js';

export default [renderVoxel, materialPalette, sky, cameraFirstPerson, cameraThirdPerson, modelVoxel, modelLowpoly,
  rigHumanoid, rigQuadruped, animClips, animLocomotion, animIk, animSecondary, animRagdoll, renderMesh3d, terrainProcedural, foliageScatter];
