// Reaching a goal entity emits reach_goal.
export default {
  id: 'goal',
  card: {
    intent: 'Touching a tagged goal (door, flag, exit) emits reach_goal.',
    phase: 'interaction',
    tunables: { tag: { type: 'string', default: 'goal', effect: 'entity tag that ends the level' } },
    provides: { events: ['reach_goal'] },
  },
  requiresTags: cfg => [cfg.tag],
  step(state, cfg, api) {
    const p = api.player(); if (!p) return;
    if (api.tagged(cfg.tag).some(g => api.overlap(p, g))) api.emit('reach_goal');
  },
};
