// Top-down player body: eight-direction movement with acceleration.
export default {
  id: 'topdown',
  card: {
    intent: 'Top-down player movement in eight directions with acceleration and friction; walls block.',
    phase: 'motion',
    tunables: {
      speed: { default: 7, min: 1, max: 30, unit: 'tiles/s', effect: 'top speed' },
      accel: { default: 60, min: 5, max: 400, unit: 'tiles/s²', effect: 'responsiveness' },
      friction: { default: 60, min: 5, max: 400, unit: 'tiles/s²', effect: 'stopping power; low values slide like ice' },
    },
    requires: { tags: ['player'] },
    conflicts: ['platformer'],
  },
  step(state, cfg, api) {
    const p = api.player(); if (!p) return;
    const { input, dt } = api;
    const len = Math.hypot(input.x, input.y) || 1;
    const tx = (input.x / len) * cfg.speed, ty = (input.y / len) * cfg.speed;
    const toward = (v, t) => { const rate = (t ? cfg.accel : cfg.friction) * dt; return v < t ? Math.min(t, v + rate) : Math.max(t, v - rate); };
    p.vx = toward(p.vx, tx); p.vy = toward(p.vy, ty);
    if (input.x) p.face = Math.sign(input.x);
    const hit = api.move(p, p.vx * dt, p.vy * dt);
    if (hit.left || hit.right) p.vx = 0;
    if (hit.up || hit.down) p.vy = 0;
  },
};
