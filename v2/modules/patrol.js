// Walking enemies that turn at walls and ledges; optionally stompable.
export default {
  id: 'patrol',
  card: {
    intent: 'Tagged enemies walk back and forth, turning at walls (and ledges); touching hurts unless the player stomps from above.',
    phase: 'motion',
    tunables: {
      tag: { type: 'string', default: 'enemy', effect: 'entity tag that patrols' },
      speed: { default: 2.5, min: 0, max: 20, unit: 'tiles/s', effect: 'walking speed' },
      gravity: { type: 'boolean', default: true, effect: 'enemies fall; false makes them float in place vertically' },
      turnAtLedges: { type: 'boolean', default: true, effect: 'turn around instead of walking off edges' },
      stomp: { type: 'boolean', default: true, effect: 'landing on an enemy defeats it' },
      bounce: { default: 11, min: 0, max: 40, unit: 'tiles/s', effect: 'player bounce after a stomp' },
      damage: { default: 1, min: 1, max: 100, unit: 'hp', effect: 'damage on touch' },
    },
    provides: { vars: ['defeated_enemies'], events: ['stomp', 'hurt'] },
  },
  requiresTags: cfg => [cfg.tag],
  init(state) { state.vars.defeated_enemies ??= 0; },
  step(state, cfg, api) {
    const p = api.player(), dt = api.dt;
    for (const e of api.tagged(cfg.tag)) {
      e.data.dir ??= -1;
      e.vx = e.data.dir * cfg.speed; e.face = e.data.dir;
      if (cfg.gravity) e.vy = Math.min(20, e.vy + 45 * dt);
      const hit = api.move(e, e.vx * dt, cfg.gravity ? e.vy * dt : 0);
      if (hit.down) e.vy = 0;
      if (hit.left || hit.right) e.data.dir *= -1;
      else if (cfg.turnAtLedges && hit.down) {
        const ahead = e.data.dir > 0 ? e.x + e.w + 0.05 : e.x - 0.05;
        if (!api.solidAt(ahead, e.y + e.h + 0.1)) e.data.dir *= -1;
      }
      if (!p || !api.overlap(p, e)) continue;
      if (cfg.stomp && p.vy > 0 && p.y + p.h - e.y < 0.5) {
        api.remove(e); p.vy = -cfg.bounce; state.vars.defeated_enemies++; api.emit('stomp', { kind: e.kind });
      } else api.emit('hurt', { damage: cfg.damage, from: e.kind });
    }
  },
};
