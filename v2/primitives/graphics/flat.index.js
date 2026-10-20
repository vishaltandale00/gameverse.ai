// Primitives registered by the graphics flat workstream. Append imports and list entries here only.
// Validator paths are made absolute (instance path + .with.) here, once for all flat primitives.
import { withPath } from './flat-stage.js';
import renderTilemap from './render-tilemap.js';
import renderGrid from './render-grid.js';
import renderPhysics2d from './render-physics2d.js';
import renderArena2d from './render-arena2d.js';
import renderTrack from './render-track.js';
import renderDom from './render-dom.js';
import cameraSide from './camera-side.js';
import cameraTopDown from './camera-top-down.js';
import cameraIsometric from './camera-isometric.js';
import spritePixel from './sprite-pixel.js';
import spriteVector from './sprite-vector.js';
import tilesetPixel from './tileset-pixel.js';
import animSprite from './anim-sprite.js';
import rigCustom from './rig-custom.js';
import backgroundParallax from './background-parallax.js';
import lighting2d from './lighting-2d.js';
import particles from './particles.js';
import post from './post.js';
import fxFeedback from './fx-feedback.js';

const absolute = p => (p.validate ? { ...p, validate: (config, doc, ctx, info) => withPath(p.validate(config, doc, ctx, info) || [], info) } : p);

export default [
  renderTilemap, renderGrid, renderPhysics2d, renderArena2d, renderTrack, renderDom,
  cameraSide, cameraTopDown, cameraIsometric,
  spritePixel, spriteVector, tilesetPixel, animSprite, rigCustom,
  backgroundParallax, lighting2d, particles, post, fxFeedback,
].map(absolute);
