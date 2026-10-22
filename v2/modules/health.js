// Player hit points with invulnerability frames and knockback.
export default {
  id: 'health',
  card: {
    intent: 'Gives the player hit points; hurt events remove hp with brief invulnerability and knockback; zero hp emits defeated.',
    phase: 'rules',
    tunables: {
      hp: { default: 3, min: 1, max: 100, unit: 'hp', effect: 'starting and maximum hit points' },
      invulnerable: { default: 1, min: 0, max: 5, unit: 's', effect: 'grace period after being hurt' },
      knockback: { default: 9, min: 0, max: 40, unit: 'tiles/s', effect: 'upward/backward push when hurt' },
    },
    provides: { vars: ['hp'], events: ['defeated'] },
    requires: { tags: ['player'] },
  },
  init(state, cfg) { state.vars.hp = cfg.hp; state.modules.health = { invuln: 0 }; },
  step(state, cfg, api) { const m = state.modules.health; m.invuln = Math.max(0, m.invuln - api.dt); },
  on: {
    hurt(state, data, cfg, api) {
      const m = state.modules.health;
      if (m.invuln > 0 || state.vars.hp <= 0) return;
      state.vars.hp = Math.max(0, state.vars.hp - (data.damage || 1)); m.invuln = cfg.invulnerable;
      const p = api.player();
      if (p && cfg.knockback) { p.vy = -cfg.knockback * 0.6; p.vx = -p.face * cfg.knockback * 0.5; }
      if (state.vars.hp <= 0) api.emit('defeated');
    },
  },
};
