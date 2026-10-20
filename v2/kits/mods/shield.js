// shield: a free button raises a brief bubble of invulnerability around the player, then needs a
// cooldown. The kit decides what a shield stops (a hunter bounces off, a lost ball bounces back,
// a crash is ignored) through world.invulnerable; kits emit 'shielded' when it saves the player.
import { obj, bool, int, str, clampInt, color, name, tick, burst, ring, drawFx, badge, TAU } from './fx.js';

const FPS = 60;

export default {
  id: 'shield',
  summary: 'a shield on a free button: brief invulnerability for `seconds` (what it stops is the genre\'s own danger: a chaser bounces off, a lost ball bounces back, a crash is ignored), then `cooldown` seconds before it can be used again. Use for "shield", "force field", "invincibility", "block".',
  requires: ['player', 'invulnerable'],
  button: true,
  schema: obj({
    enabled: bool('true gives the player the shield.'),
    name: str('Themed name, e.g. "force field"; empty for "Shield".'),
    seconds: int('1 to 6 seconds of protection.'),
    cooldown: int('2 to 40 seconds to recharge.'),
    color: str('Hex color of the bubble, e.g. #7fd4ff.'),
  }),
  normalize(c = {}) {
    return { enabled: c?.enabled === true, name: name(c?.name, 'Shield'), seconds: clampInt(c?.seconds, 1, 6, 2), cooldown: clampInt(c?.cooldown, 2, 40, 8), color: color(c?.color, '#7fd4ff') };
  },
  enabled: c => c.enabled,
  label: c => `Raise ${c.name.toLowerCase()}`,

  init() { return { on: 0, cd: 0, saves: 0, px: 0, py: 0 }; },

  step(m, input, c, { world, state, events, emit }) {
    if (m.on > 0) m.on--;
    if (m.cd > 0) m.cd--;
    if (m.on > 0) for (const e of events) if (e.name === 'shielded') { m.saves++; emit('shield_block', { by: 'shield' }); }
    if (!world.active(state)) return;
    const p = world.player(state);
    m.px = p.x; m.py = p.y;
    if (!input.pressed) return;
    if (m.cd > 0) { emit('empty', { item: c.name }); return; }
    const frames = c.seconds * FPS;
    world.invulnerable(state, frames);
    m.on = frames; m.cd = frames + c.cooldown * FPS;
    emit('shield_up', { item: c.name, x: p.x, y: p.y });
  },

  render(g, m, c, view, fx, frame) {
    tick(fx, frame);
    const { X, Y, s } = view, reduced = !!frame.reducedMotion;
    for (const e of frame.events || []) {
      if (e.name === 'shield_up') { ring(fx, m.px, m.py, c.color, 1.6, 0.5); burst(fx, m.px, m.py, c.color, 14, 5); }
      if (e.name === 'shield_block') { ring(fx, m.px, m.py, '#ffffff', 1.3, 0.3); burst(fx, m.px, m.py, '#ffffff', 10, 6, { life: 0.35 }); fx.hit = 1; }
    }
    if (fx.hit > 0) fx.hit = Math.max(0, fx.hit - (frame.dt || 1 / 60) * 4);
    g.save();
    if (view.clip) { g.beginPath(); g.rect(view.clip.x, view.clip.y, view.clip.w, view.clip.h); g.clip(); }
    if (m.on > 0) {
      const ending = m.on < 45 && Math.floor(m.on / 5) % 2 === 0;
      const r = s * (0.95 + (reduced ? 0 : 0.06 * Math.sin((fx.t || 0) * 9))) * (1 + (fx.hit || 0) * 0.25), x = X(m.px), y = Y(m.py);
      const grad = g.createRadialGradient ? g.createRadialGradient(x, y, r * 0.35, x, y, r) : null;
      if (grad) { grad.addColorStop(0, c.color + '00'); grad.addColorStop(0.75, c.color + '33'); grad.addColorStop(1, c.color + 'aa'); }
      g.globalAlpha = ending ? 0.35 : 1;
      g.fillStyle = grad || c.color + '44'; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
      g.strokeStyle = c.color; g.lineWidth = Math.max(1.5, s * 0.08);
      if (!reduced) { g.shadowColor = c.color; g.shadowBlur = s * 0.5; }
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke();
      // A glint orbiting the bubble.
      const a = (fx.t || 0) * 3;
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.8, Math.max(1.5, s * 0.08), 0, TAU); g.fill();
      g.shadowBlur = 0; g.globalAlpha = 1;
    }
    drawFx(g, fx, view, reduced);
    g.restore();
    const total = c.seconds * FPS + c.cooldown * FPS;
    const text = m.on > 0 ? `${c.name.toUpperCase()} ON` : m.cd > 0 ? `${c.name.toUpperCase()} ${Math.ceil(m.cd / FPS)}s` : `${c.name.toUpperCase()} READY`;
    badge(g, view, text, m.cd > 0 && m.on <= 0 ? '#8a93a8' : c.color, { progress: m.on > 0 ? m.on / (c.seconds * FPS) : 1 - m.cd / total, pop: fx.hit || 0 });
  },
};
