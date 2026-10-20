// Side-view player body: run, gravity, variable-height jump with coyote time
// and input buffering. Units: tiles and seconds.
const approach = (v, target, delta) => v < target ? Math.min(target, v + delta) : Math.max(target, v - delta);

export default {
  id: 'platformer',
  card: {
    intent: 'Side-view player movement: run, fall under gravity, and jump with coyote time, jump buffering and variable jump height.',
    phase: 'motion',
    tunables: {
      runSpeed: { default: 8, min: 1, max: 30, unit: 'tiles/s', effect: 'top horizontal speed' },
      accel: { default: 70, min: 5, max: 400, unit: 'tiles/s²', effect: 'how quickly the player reaches top speed' },
      friction: { default: 60, min: 5, max: 400, unit: 'tiles/s²', effect: 'how quickly the player stops; low values feel slippery' },
      airControl: { default: 0.75, min: 0, max: 1, unit: 'ratio', effect: 'steering strength while airborne' },
      gravity: { default: 48, min: 5, max: 200, unit: 'tiles/s²', effect: 'higher feels heavier and snappier' },
      jumpSpeed: { default: 16, min: 2, max: 60, unit: 'tiles/s', effect: 'initial jump velocity; jump height ≈ jumpSpeed²/(2·gravity)' },
      maxFall: { default: 24, min: 5, max: 80, unit: 'tiles/s', effect: 'terminal falling speed' },
      coyoteTime: { default: 0.08, min: 0, max: 0.3, unit: 's', effect: 'grace period to jump after leaving a ledge' },
      jumpBuffer: { default: 0.1, min: 0, max: 0.3, unit: 's', effect: 'early jump presses still count when landing' },
      jumpCut: { default: 0.45, min: 0.1, max: 1, unit: 'ratio', effect: 'upward speed kept when jump is released early (1 = fixed height)' },
      airJumps: { default: 0, min: 0, max: 3, unit: 'count', effect: 'extra mid-air jumps (1 = double jump)' },
    },
    provides: { events: ['jump', 'land'] },
    requires: { tags: ['player'] },
    conflicts: ['topdown'],
  },
  step(state, cfg, api) {
    const p = api.player(); if (!p) return;
    const { input, dt } = api, d = p.data;
    const target = input.x * cfg.runSpeed;
    const rate = (input.x ? cfg.accel : cfg.friction) * (d.grounded ? 1 : cfg.airControl);
    p.vx = approach(p.vx, target, rate * dt);
    if (input.x) p.face = Math.sign(input.x);
    d.coyote = d.grounded ? cfg.coyoteTime : Math.max(0, (d.coyote || 0) - dt);
    d.buffer = input.aPressed ? cfg.jumpBuffer : Math.max(0, (d.buffer || 0) - dt);
    if (d.buffer > 0 && d.coyote > 0) {
      p.vy = -cfg.jumpSpeed; d.buffer = 0; d.coyote = 0; d.cut = false; d.grounded = false; api.emit('jump');
    } else if (input.aPressed && !d.grounded && (d.airJumps || 0) > 0) {
      p.vy = -cfg.jumpSpeed; d.airJumps--; d.cut = false; api.emit('jump', { air: true });
    }
    if (!input.a && p.vy < 0 && !d.cut) { p.vy *= cfg.jumpCut; d.cut = true; }
    p.vy = Math.min(cfg.maxFall, p.vy + cfg.gravity * dt);
    const hit = api.move(p, p.vx * dt, p.vy * dt);
    if (hit.left || hit.right) p.vx = 0;
    if (hit.up) p.vy = 0;
    if (hit.down) {
      if (!d.grounded && p.vy > cfg.maxFall * 0.6) api.emit('land');
      p.vy = 0; d.grounded = true; d.airJumps = cfg.airJumps;
    } else d.grounded = false;
  },
};
