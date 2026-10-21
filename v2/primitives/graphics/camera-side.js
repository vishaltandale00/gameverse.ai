// graphics.camera.side — 2D side-view follow camera: smoothed follow with
// look-ahead that eases toward the facing direction, a dead zone, platform
// snapping, room or space bounds (rooms from generators and zones; small rooms
// are centered), screen shake from graphics.fx.feedback, frameTargets that
// center and zoom out to keep several fighters in shot, and a rises-only mode
// for climbers.
import { ENTITY_KINDS } from '../../kernel/params.js';
import { hubOf, bindAny } from './flat-stage.js';
import { driveSide } from './flat-follow.js';

export default {
  id: 'graphics.camera.side',
  card: {
    intent: 'Side-view follow camera with look-ahead, dead zone, room bounds, smoothing and shake; can frame several targets (fighters) or only rise (climbers).',
    views: ['side'],
    params: {
      zoom: { type: 'number', default: 1, min: 0.5, max: 8, effect: "multiplier on the renderer's base zoom" },
      lookAhead: { type: 'number', default: 2, min: 0, max: 12, unit: 'tiles', effect: 'how far ahead of the facing direction the view leads' },
      smoothing: { type: 'number', default: 0.15, min: 0, max: 1, effect: 'per-frame catch-up (1 = locked)' },
      roomLock: { type: 'boolean', default: true, effect: 'keep the view inside the current room (generator rooms, then zones)' },
      deadzone: { type: 'list', default: [1, 1.5], of: { type: 'number', min: 0, max: 40 }, min: 2, max: 2, unit: 'tiles', effect: 'box around the center the target moves in freely' },
      target: { type: 'string', selects: ENTITY_KINDS, default: 'player', effect: 'entity id, archetype or tag to follow' },
      frameTargets: { type: 'list', default: [], of: { type: 'string', selects: ENTITY_KINDS }, effect: 'ids/archetypes/tags kept in shot together (versus fighters); zooms out as they separate' },
      frameMargin: { type: 'number', default: 3, min: 0, max: 40, unit: 'tiles', effect: 'space kept around framed targets' },
      minZoom: { type: 'number', default: 0.45, min: 0.1, max: 1, effect: 'farthest zoom-out when framing targets (fraction of zoom)' },
      risesOnly: { type: 'boolean', default: false, effect: 'never scroll down (vertical climbers)' },
      verticalBias: { type: 'number', default: 0.5, min: -10, max: 10, unit: 'tiles', effect: 'look slightly above (+) or below (−) the target' },
    },
  },
  install(rt, config, instance) {
    if (rt.headless || !rt.view) return;
    const H = hubOf(rt), space = bindAny(rt, instance);
    H.cameras.set(space, (F, cam) => driveSide(F, cam, config, F.stage.renderer?.baseZoom?.(F) ?? 32));
  },
};
