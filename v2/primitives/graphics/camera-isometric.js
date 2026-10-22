// graphics.camera.isometric: one isometric camera for every space kind. 3D spaces
// (voxel, mesh3d) get an orthographic three.js view rotatable in eased quarter turns;
// grid boards and top-down tilemaps get a diamond projection of the 2D renderers.
// The bound space picks the implementation, so documents never name a variant.
import { installIso3d, isoOffset } from './three-camera-iso.js';
import { installIso2d } from './flat-camera-iso.js';
import { ENTITY_KINDS } from '../../kernel/params.js';

export { isoOffset };
const UNSUPPORTED = ['engine.space.physics2d', 'engine.space.arena2d', 'engine.space.track', 'engine.space.graph', 'engine.space.none'];
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
      target: { type: 'string', selects: ENTITY_KINDS, default: 'player', effect: 'entity id, archetype or tag to follow' },
      yaw: { type: 'number', default: 45, min: 0, max: 360, unit: 'deg', effect: 'initial heading (3D)' },
      perspective: { type: 'boolean', default: false, effect: 'narrow-FOV perspective instead of orthographic (3D)' },
    },
    provides: {},
    rules: { iso_space: { fields: ['space'], message: 'the bound space is voxel, mesh3d, a grid board or a top-down tilemap',
      example: { doc: { systems: [], player: { archetype: 'probe' }, content: { archetypes: [{ id: 'probe', name: 'Probe' }] }, spaces: [{ id: 'other', use: 'engine.space.none' }], graphics: [{ use: 'graphics.ui.feedback' }, { use: 'graphics.camera.isometric' }] }, at: 'graphics[1]' } } },
  },
  validate(config, doc, ctx, where) {
    const s = boundSpace(doc, where);
    const ok = s && !UNSUPPORTED.includes(s.use) && !(s.use === 'engine.space.tilemap' && !FLAT(s));
    return ok ? [] : [{ code: 'iso_space', message: 'graphics.camera.isometric needs a 3D space (voxel, mesh3d), a grid board or a top-down tilemap', hint: `bound space: ${s?.use || 'none'}` }];
  },
  install(rt, config, instance) {
    const s = boundSpace(rt.doc, instance);
    if (s && FLAT(s)) installIso2d(rt, config, instance);
    else installIso3d(rt, config, instance); // voxel, mesh3d and other 3D spaces
  },
};
