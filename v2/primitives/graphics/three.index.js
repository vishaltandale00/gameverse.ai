// Primitives registered by the graphics three workstream. Append imports and list entries here only.
import renderVoxel from './render-voxel.js';
import materialPalette from './material-palette.js';
import sky from './sky.js';
import cameraFirstPerson from './camera-first-person.js';
import cameraThirdPerson from './camera-third-person.js';
import cameraIsometric from './camera-isometric.js';
import modelVoxel from './model-voxel.js';
import modelLowpoly from './model-lowpoly.js';
import rigHumanoid from './rig-humanoid.js';
import rigQuadruped from './rig-quadruped.js';
import animClips from './anim-clips.js';
import animLocomotion from './anim-locomotion.js';
import animIk from './anim-ik.js';
import animSecondary from './anim-secondary.js';
import animRagdoll from './anim-ragdoll.js';

export default [renderVoxel, materialPalette, sky, cameraFirstPerson, cameraThirdPerson, cameraIsometric, modelVoxel, modelLowpoly,
  rigHumanoid, rigQuadruped, animClips, animLocomotion, animIk, animSecondary, animRagdoll];
