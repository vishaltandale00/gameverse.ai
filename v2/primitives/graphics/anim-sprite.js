// graphics.anim.sprite — plays sprite animations from entity state. The flat
// renderers derive a presentation state for every entity each frame (idle,
// run, jump, fall, land, dash, attack, hurt, die, wallslide, crouch, block)
// from its body (velocity, grounded, facing) and recent events (hurt, attack,
// dash, land, defeated); this primitive maps those states to a model's anim
// names and tunes squash/stretch, afterimage trails and run lean.
import { hubOf } from './flat-stage.js';
import { STATES } from './flat-models.js';

export default {
  id: 'graphics.anim.sprite',
  card: {
    intent: 'Maps entity presentation states (idle, run, jump, fall, land, dash, attack, hurt, die, wallslide, crouch, block) to sprite animations, with squash and stretch on takeoff and landing, afterimage trails and forward lean.',
    views: ['side', 'td'],
    params: {
      map: { type: 'object', default: {}, open: true, effect: 'state → animation name in the model (e.g. wallslide → wall)' },
      squash: { type: 'boolean', default: true, effect: 'stretch on takeoff, squash on landing (damped spring)' },
      trail: { type: 'list', default: ['dash'], of: { type: 'string', options: STATES }, effect: 'states that leave fading afterimages' },
      lean: { type: 'number', default: 1, min: 0, max: 3, effect: 'forward lean while running and dashing' },
    },
    reads: ['content.models'],
  },
  validate(config) {
    return Object.keys(config.map).filter(k => !STATES.includes(k)).map(k => ({ code: 'flat_anim_state', path: `map.${k}`, message: `unknown state '${k}'`, hint: `states: ${STATES.join(', ')}` }));
  },
  install(rt, config) {
    if (rt.headless || !rt.view) return;
    hubOf(rt).cfg.anim = config;
  },
};
