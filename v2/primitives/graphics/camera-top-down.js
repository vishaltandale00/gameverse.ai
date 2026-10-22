// graphics.camera.top-down — overhead follow camera with a dead zone, optional
// look-ahead along the direction of motion, bounds and smoothing; `tilt` below
// 90° foreshortens the ground plane (sprites stay upright) for a 3/4 look.
import { ENTITY_KINDS } from '../../kernel/params.js';
import { hubOf, bindAny } from './flat-stage.js';
import { driveTopDown } from './flat-follow.js';

export default {
  id: 'graphics.camera.top-down',
  card: {
    intent: 'Top-down follow camera with dead zone, look-ahead, bounds, smoothing and shake; tilt foreshortens the ground for a three-quarter view; follow:false frames the whole space.',
    views: ['td', 'board'],
    params: {
      zoom: { type: 'number', default: 1, min: 0.25, max: 8, effect: "multiplier on the renderer's base zoom" },
      tilt: { type: 'number', default: 90, min: 30, max: 90, unit: 'deg', effect: '90 = straight down; lower squashes depth' },
      follow: { type: 'boolean', default: true, effect: 'follow the target (false: fit the whole space)' },
      deadzone: { type: 'list', default: [], of: { type: 'number', min: 0, max: 64 }, max: 2, unit: 'tiles', effect: 'free-movement box; empty = a quarter of the view' },
      lookAhead: { type: 'number', default: 0, min: 0, max: 10, unit: 'tiles', effect: 'lead along the direction of travel' },
      smoothing: { type: 'number', default: 0.14, min: 0, max: 1, effect: 'per-frame catch-up' },
      roomLock: { type: 'boolean', default: false, effect: 'keep inside the current room/zone instead of the whole space' },
      target: { type: 'string', selects: ENTITY_KINDS, default: 'player', effect: 'entity id, archetype or tag to follow' },
    },
  },
  install(rt, config, instance) {
    if (rt.headless || !rt.view) return;
    const H = hubOf(rt), space = bindAny(rt, instance);
    H.projOpts.set(space, { ...(H.projOpts.get(space) || {}), tilt: config.tilt });
    const cfg = { ...config, deadzone: config.deadzone.length === 2 ? config.deadzone : null };
    H.cameras.set(space, (F, cam) => driveTopDown(F, cam, cfg, F.stage.renderer?.baseZoom?.(F) ?? 32));
  },
};
