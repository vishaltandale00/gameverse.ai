// Touching a hazard hurts the player.
export default {
  id: 'hazard',
  card: {
    intent: 'Touching a tagged hazard (spikes, lava, enemies without stomping) emits a hurt event.',
    phase: 'interaction',
    tunables: {
      tag: { type: 'string', default: 'hazard', effect: 'entity tag that hurts on touch' },
      damage: { default: 1, min: 1, max: 100, unit: 'hp', effect: 'damage per touch' },
    },
    provides: { events: ['hurt'] },
  },
  requiresTags: cfg => [cfg.tag],
  step(state, cfg, api) {
    const p = api.player(); if (!p) return;
    for (const e of api.tagged(cfg.tag)) if (api.overlap(p, e)) { api.emit('hurt', { damage: cfg.damage, from: e.kind }); break; }
  },
};
