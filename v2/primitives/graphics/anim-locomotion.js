// graphics.anim.locomotion: blend tree over speed (idle/walk/run/sprint),
// direction (strafe and backpedal while locked on or aiming), grounded vs
// airborne (jump/fall), and movement states (swim, climb, glide, ride, drive,
// crouch), with gait phase advanced by distance travelled so feet don't
// slide, and lean into speed and turns.
import { joinStage, presentationOnly } from './three-stage.js';

export const LOCOMOTION_STATES = ['grounded', 'airborne', 'swim', 'climb', 'glide', 'ride', 'drive', 'crouch', 'lockon'];

export default {
  id: 'graphics.anim.locomotion',
  card: {
    intent: 'Locomotion blend tree for rigged characters: idle/walk/run/sprint by speed, strafing and backpedalling by direction, jump/fall when airborne, and swim/climb/glide/ride/drive/crouch states from body.state; gait phase follows distance travelled so feet stay planted; leans into speed and turns.',
    views: ['1p', '3p', 'iso', 'td'],
    params: {
      idleWalkRun: { type: 'list', of: { type: 'number', min: 0, max: 100 }, min: 2, max: 3, default: [0.2, 3, 6], unit: 'm/s', effect: '[idle below, walk at, run at] speeds (2 values = walk, run)' },
      turnLean: { type: 'number', default: 0.25, min: 0, max: 1, effect: 'roll into turns' },
      strafe: { type: 'boolean', default: false, effect: 'strafe/backpedal clips instead of turning to face movement' },
      states: { type: 'list', of: { type: 'string', options: LOCOMOTION_STATES }, default: LOCOMOTION_STATES, effect: 'movement states that get their own pose' },
    },
    provides: {},
    requires: { primitives: ['graphics.anim.clips'] },
  },
  validate(config) {
    const t = config.idleWalkRun;
    const errs = [];
    for (let i = 1; i < t.length; i++) if (!(t[i] > t[i - 1])) errs.push({ code: 'speeds_order', path: `idleWalkRun[${i}]`, message: 'speeds must increase (idle < walk < run)' });
    return errs;
  },
  install(rt, config, instance) {
    if (presentationOnly(rt)) return;
    const stage = joinStage(rt, instance);
    const t = config.idleWalkRun.length === 2 ? [Math.min(0.2, config.idleWalkRun[0] * 0.2), ...config.idleWalkRun] : config.idleWalkRun;
    stage.anim.locomotion = { ...config, idleWalkRun: t };
  },
};
