// Pick up entities by touching them; tracks score, collected and remaining.
export default {
  id: 'collect',
  card: {
    intent: 'The player collects tagged pickups on touch, adding to a score; tracks how many are collected and remaining.',
    phase: 'interaction',
    tunables: {
      tag: { type: 'string', default: 'collectible', effect: 'entity tag that can be collected' },
      var: { type: 'string', default: 'score', effect: 'variable increased on pickup' },
      amount: { default: 1, min: 0, max: 1000, unit: 'points', effect: 'points per pickup' },
    },
    provides: { vars: ['collected', 'remaining'], events: ['collect'] },
  },
  requiresTags: cfg => [cfg.tag],
  providesVars: cfg => [cfg.var, 'collected', 'remaining'],
  init(state, cfg, api) {
    state.vars[cfg.var] ??= 0; state.vars.collected ??= 0;
    state.vars.remaining = api.tagged(cfg.tag).length;
  },
  step(state, cfg, api) {
    const p = api.player(); if (!p) return;
    for (const e of api.tagged(cfg.tag)) {
      if (!api.overlap(p, e)) continue;
      api.remove(e);
      state.vars[cfg.var] += cfg.amount; state.vars.collected++; state.vars.remaining--;
      api.emit('collect', { kind: e.kind });
    }
  },
};
