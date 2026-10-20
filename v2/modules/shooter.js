// Fire projectiles with B; projectiles defeat targets and stop at walls.
export default {
  id: 'shooter',
  card: {
    intent: 'The player fires projectiles with the B button in the facing direction; projectiles defeat tagged targets and stop at walls.',
    phase: 'interaction',
    tunables: {
      target: { type: 'string', default: 'enemy', effect: 'entity tag projectiles defeat' },
      speed: { default: 16, min: 2, max: 60, unit: 'tiles/s', effect: 'projectile speed' },
      cooldown: { default: 0.25, min: 0.03, max: 3, unit: 's', effect: 'time between shots' },
      lifetime: { default: 1.2, min: 0.1, max: 10, unit: 's', effect: 'how long a projectile flies' },
      aim: { type: 'string', default: 'facing', options: ['facing', 'stick'], effect: 'facing = horizontal; stick = eight directions (top-down)' },
    },
    provides: { vars: ['shots_hit'], events: ['shoot', 'hit'] },
    requires: { tags: ['player'] },
  },
  init(state) { state.vars.shots_hit ??= 0; state.modules.shooter = { cooldown: 0 }; },
  step(state, cfg, api) {
    const m = state.modules.shooter, p = api.player(), dt = api.dt;
    m.cooldown = Math.max(0, m.cooldown - dt);
    if (p && api.input.bPressed && m.cooldown === 0) {
      let dx = p.face || 1, dy = 0;
      if (cfg.aim === 'stick' && (api.input.x || api.input.y)) { const l = Math.hypot(api.input.x, api.input.y); dx = api.input.x / l; dy = api.input.y / l; }
      const b = api.spawn('projectile', p.x + p.w / 2 - 0.5, p.y + p.h / 2 - 0.5);
      Object.assign(b, { w: 0.3, h: 0.3, x: p.x + p.w / 2 - 0.15, y: p.y + p.h / 2 - 0.15, vx: dx * cfg.speed, vy: dy * cfg.speed });
      b.tags.push('projectile'); b.data.life = cfg.lifetime; m.cooldown = cfg.cooldown; api.emit('shoot');
    }
    const targets = api.tagged(cfg.target);
    for (const b of api.tagged('projectile')) {
      b.data.life -= dt;
      const hit = api.move(b, b.vx * dt, b.vy * dt);
      if (b.data.life <= 0 || hit.left || hit.right || hit.up || hit.down) { api.remove(b); continue; }
      const t = targets.find(t => !t.dead && api.overlap(b, t));
      if (t) { api.remove(b); api.remove(t); state.vars.shots_hit++; api.emit('hit', { kind: t.kind }); }
    }
  },
};
