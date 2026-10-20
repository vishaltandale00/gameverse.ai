// Countdown clock.
export default {
  id: 'timer',
  card: {
    intent: 'A countdown clock; emits time_up when it reaches zero.',
    phase: 'rules',
    tunables: { seconds: { default: 60, min: 1, max: 900, unit: 's', effect: 'time limit' } },
    provides: { vars: ['time_left'], events: ['time_up'] },
  },
  init(state, cfg) { state.vars.time_left = cfg.seconds; },
  step(state, cfg, api) {
    const before = state.vars.time_left;
    state.vars.time_left = Math.max(0, cfg.seconds - state.time - api.dt);
    if (before > 0 && state.vars.time_left === 0) api.emit('time_up');
  },
};
