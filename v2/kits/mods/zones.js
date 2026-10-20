// zones: score multiplier zones. Every so often a glowing zone opens near where the player has
// been moving; while the player is inside it, every point the game awards is multiplied. Works in
// any kit that reports the player and takes extra score.
import { random, seedFrom } from '../../kernel/rng.js';
import { obj, bool, int, str, clampInt, color, name, tick, burst, ring, drawFx, badge, label, TAU } from './fx.js';

const FPS = 60;

export default {
  id: 'zones',
  summary: 'score multiplier zones: every `every` seconds a glowing zone opens near the player\'s path for `lasts` seconds; points scored while standing in it are multiplied by `multiplier`. Use for "bonus zones", "double points", "score multiplier", "hot spots".',
  requires: ['player', 'score'],
  button: false,
  schema: obj({
    enabled: bool('true opens the zones.'),
    name: str('Themed name, e.g. "lucky ring"; empty for "Bonus zone".'),
    multiplier: int('2 to 5.'),
    every: int('5 to 60 seconds between zones.'),
    lasts: int('3 to 20 seconds each zone stays open.'),
    color: str('Hex color, e.g. #ffe14a.'),
  }),
  normalize(c = {}) {
    return { enabled: c?.enabled === true, name: name(c?.name, 'Bonus zone'), multiplier: clampInt(c?.multiplier, 2, 5, 2), every: clampInt(c?.every, 5, 60, 12), lasts: clampInt(c?.lasts, 3, 20, 8), color: color(c?.color, '#ffe14a') };
  },
  enabled: c => c.enabled,
  label: c => c.name,

  init(c, world, s, { seed = 1 } = {}) {
    return { rng: seedFrom(`zones:${seed}`), t: Math.round(c.every * FPS * 0.5), zone: null, inside: false, last: s.score || 0, earned: 0, box: null, px: 0, py: 0 };
  },

  step(m, input, c, { world, state, emit }) {
    // Points the kit awarded since last step, multiplied while inside an open zone.
    const gained = (state.score || 0) - m.last;
    m.last = state.score || 0;
    if (!world.active(state)) { m.inside = false; return; }
    const p = world.player(state);
    m.px = p.x; m.py = p.y;
    // Where the player moves: the zone opens inside that range, so a paddle that only slides sideways gets one on its row.
    m.box = m.box ? { x0: Math.min(m.box.x0, p.x), x1: Math.max(m.box.x1, p.x), y0: Math.min(m.box.y0, p.y), y1: Math.max(m.box.y1, p.y) } : { x0: p.x, x1: p.x, y0: p.y, y1: p.y };
    if (m.zone) {
      m.inside = Math.hypot(p.x - m.zone.x, p.y - m.zone.y) <= m.zone.r;
      if (m.inside && gained > 0) {
        const extra = gained * (c.multiplier - 1);
        world.addScore(state, extra);
        m.last += extra; m.earned += extra;   // our own extra never multiplies again (kits that total score next step included)
        emit('zone_points', { value: extra, x: p.x, y: p.y, mult: c.multiplier });
      }
      if (--m.zone.t <= 0) { m.zone = null; m.inside = false; emit('zone_close', {}); }
      return;
    }
    if (--m.t > 0) return;
    m.t = c.every * FPS;
    const r = 1.6, b = m.box, size = world.size?.(state);
    for (let k = 0; k < 10; k++) {
      const x = b.x0 - 2 + random(m) * (b.x1 - b.x0 + 4), y = b.y0 - 1 + random(m) * (b.y1 - b.y0 + 2);
      if (size && !size.cell && (x < 1 || y < 1 || x > size.w - 2 || y > size.h - 2)) continue;
      if (Math.hypot(x - p.x, y - p.y) < 2.5 && k < 9) continue;   // not right on top of the player
      m.zone = { x, y, r, t: c.lasts * FPS };
      emit('zone_open', { x, y });
      break;
    }
  },

  render(g, m, c, view, fx, frame) {
    tick(fx, frame);
    const { X, Y, s } = view, reduced = !!frame.reducedMotion;
    for (const e of frame.events || []) {
      if (e.name === 'zone_open') { ring(fx, e.x, e.y, c.color, 2.4, 0.7); burst(fx, e.x, e.y, c.color, 16, 4); }
      if (e.name === 'zone_points') { burst(fx, m.px, m.py, c.color, 6, 3, { life: 0.5 }); fx.pop = 1; }
    }
    if (fx.pop > 0) fx.pop = Math.max(0, fx.pop - (frame.dt || 1 / 60) * 3);
    g.save();
    if (view.clip) { g.beginPath(); g.rect(view.clip.x, view.clip.y, view.clip.w, view.clip.h); g.clip(); }
    const z = m.zone;
    if (z) {
      const x = X(z.x), y = Y(z.y), r = z.r * s, closing = z.t < 90 && Math.floor(z.t / 6) % 2 === 0;
      const grad = g.createRadialGradient ? g.createRadialGradient(x, y, 0, x, y, r) : null;
      if (grad) { grad.addColorStop(0, c.color + (m.inside ? '55' : '22')); grad.addColorStop(1, c.color + '00'); }
      g.globalAlpha = closing ? 0.4 : 1;
      g.fillStyle = grad || c.color + '22'; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
      g.strokeStyle = c.color; g.lineWidth = Math.max(1.5, s * 0.08);
      g.setLineDash?.([s * 0.4, s * 0.25]); g.lineDashOffset = reduced ? 0 : -(fx.t || 0) * s * 2;
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke();
      g.setLineDash?.([]);
      label(g, `×${c.multiplier}`, x, y, s * 0.9, c.color, reduced ? 0 : s * 0.5);
      g.globalAlpha = 1;
    }
    drawFx(g, fx, view, reduced);
    g.restore();
    const text = z ? (m.inside ? `×${c.multiplier} SCORING` : `${c.name.toUpperCase()} OPEN`) : `${c.name.toUpperCase()} · ${Math.ceil(m.t / FPS)}s`;
    badge(g, view, text, m.inside ? '#ffffff' : c.color, { progress: z ? z.t / (c.lasts * FPS) : 1 - m.t / (c.every * FPS), pop: fx.pop || 0, alert: m.inside });
  },
};
