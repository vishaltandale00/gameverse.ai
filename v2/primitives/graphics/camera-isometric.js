// graphics.camera.isometric: one isometric camera for every space kind. 3D spaces
// (voxel, mesh3d) get an orthographic three.js view rotatable in eased quarter turns;
// grid boards and top-down tilemaps get a diamond projection of the 2D renderers.
// The bound space picks the implementation, so documents never name a variant.
import { installIso3d, isoOffset } from './three-camera-iso.js';
import { installIso2d } from './flat-camera-iso.js';

export { isoOffset };
const THREE_D = ['engine.space.voxel', 'engine.space.mesh3d'];
const FLAT = s => s.use === 'engine.space.grid' || (s.use === 'engine.space.tilemap' && s.with?.mode === 'topdown');
const boundSpace = (doc, instance) => doc.spaces?.find(s => s.id === (instance?.space ?? doc.spaces?.[0]?.id));

export default {
  id: 'graphics.camera.isometric',
  card: {
    intent: 'Isometric camera for any space: orthographic 3D view over voxel/mesh3d worlds, or a diamond projection over grid boards and top-down tilemaps. Follows the player (or frames the whole board), rotates in quarter turns.',
    views: ['iso'],
    params: {
      angle: { type: 'number', default: 32, min: 10, max: 89, unit: 'deg', effect: 'view elevation (about 30 is classic isometric)' },
      zoom: { type: 'number', default: 1, min: 0.2, max: 8, effect: 'zoom multiplier' },
      rotatable: { type: 'boolean', default: true, effect: 'allow quarter-turn rotation (rotate_camera action, or Q/E)' },
      follow: { type: 'boolean', default: true, effect: 'follow the target; false frames the whole space (2D boards)' },
      smoothing: { type: 'number', default: 0.14, min: 0, max: 1, effect: 'follow smoothing (2D)' },
      target: { type: 'string', default: 'player', effect: 'entity to follow' },
      yaw: { type: 'number', default: 45, min: 0, max: 360, unit: 'deg', effect: 'initial heading (3D)' },
      perspective: { type: 'boolean', default: false, effect: 'narrow-FOV perspective instead of orthographic (3D)' },
    },
    provides: {},
  },
  validate(config, doc, ctx, where) {
    const s = boundSpace(doc, where);
    return s && (THREE_D.includes(s.use) || FLAT(s)) ? [] : [{ code: 'iso_space', message: 'graphics.camera.isometric needs a voxel, mesh3d or grid space, or a top-down tilemap', hint: `bound space: ${s?.use || 'none'}` }];
  },
  install(rt, config, instance) {
    const s = boundSpace(rt.doc, instance);
    if (s && THREE_D.includes(s.use)) installIso3d(rt, config, instance);
    else installIso2d(rt, config, instance);
  },
};
