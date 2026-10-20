// boss: one big spawned enemy per level with lots of hp and a health bar. The kit makes it out of
// its own enemies (a giant hunter, the breakout boss block, a heavy gunship), so the genre's own
// attacks hurt it. With mustBeat the level can't be cleared until it falls; otherwise it is a
// bonus worth `reward` points. Where the kit can stun, the boss tires every few seconds: dazed, it
// is harmless and a touch from the player costs it hp, so it can always be beaten.
import { obj, bool, int, str, enumOf, clampInt, color, name, pick, tick, burst, ring, drawFx, badge, hpBar, label, TAU } from './fx.js';

const TOUGH = { easy: 4, normal: 8, hard: 16 };
const FPS = 60, TIRE_EVERY = 9 * FPS, DAZE = 150, TOUCH_COOLDOWN = 50;

export default {
  id: 'boss',
  summary: 'a boss: one big, tough enemy (the genre\'s own kind of enemy, scaled up) arrives `arrivesAfter` seconds into each level with a health bar; mustBeat true holds the level clear until it is beaten, false makes it a bonus worth `reward` points; toughness easy, normal or hard. Use for "add a boss", "final enemy", "big bad".',
  requires: ['enemies', 'spawn', 'boss', 'defeat'],
  button: false,
  schema: obj({
    enabled: bool('true adds the boss.'),
    name: str('Themed name, e.g. "Lord Gloom"; empty for a default.'),
    toughness: enumOf(Object.keys(TOUGH), 'easy, normal or hard.'),
    arrivesAfter: int('0 to 120 seconds into each level.'),
    mustBeat: bool('true: the level is not cleared until the boss is beaten.'),
    reward: int('0 to 20000 points for beating it.'),
    color: str('Hex color for its health bar and aura, e.g. #ff4b5c.'),
  }),
  normalize(c = {}) {
    return { enabled: c?.enabled === true, name: name(c?.name, 'Boss'), toughness: pick(c?.toughness, Object.keys(TOUGH), 'normal'), arrivesAfter: clampInt(c?.arrivesAfter, 0, 120, 5), mustBeat: c?.mustBeat !== false, reward: clampInt(c?.reward, 0, 20000, 3000), color: color(c?.color, '#ff4b5c') };
  },
  enabled: c => c.enabled,
  label: c => c.name,

  init(c, world, s) { return { id: null, t: 0, level: world.level?.(s) ?? 0, beaten: false, hp: 0, maxHp: 0, x: 0, y: 0, r: 1, tire: TIRE_EVERY, daze: 0, touch: 0, px: 0, py: 0, warn: 0 }; },

  step(m, input, c, { world, state, emit }) {
    const level = world.level?.(state) ?? 0;
    if (level !== m.level) Object.assign(m, { level, id: null, t: 0, beaten: false, daze: 0, tire: TIRE_EVERY });
    if (m.warn > 0) m.warn--;
    if (m.touch > 0) m.touch--;
    if (m.beaten) return;
    if (m.id != null && !world.enemies(state).some(q => q.id === m.id)) {
      // Gone: beaten (the kit removes a boss only when it falls; a level change resets above).
      m.beaten = true; m.daze = 0;
      if (c.reward) world.addScore?.(state, c.reward);
      emit('boss_beaten', { boss: c.name, points: c.reward, x: m.x, y: m.y });
      return;
    }
    if (!world.active(state)) return;
    const p = world.player?.(state);
    if (p) { m.px = p.x; m.py = p.y; }
    if (m.id == null) {
      if (++m.t < c.arrivesAfter * FPS) return;
      const id = world.spawn(state, { kind: 'boss', hp: TOUGH[c.toughness], required: c.mustBeat, name: c.name, color: c.color });
      if (id == null) return; // no room yet (or the kit's own boss is out): try again next frame
      m.id = id; m.warn = 120;
      emit('boss_spawn', { boss: c.name });
      return;
    }
    const e = world.enemies(state).find(q => q.id === m.id);
    Object.assign(m, { x: e.x, y: e.y, r: e.radius ?? 1, hp: e.hp ?? m.hp, maxHp: e.maxHp ?? m.maxHp });
    // Tiring (kits that can stun): dazed bosses can't hurt and take damage from a touch.
    if (world.stun) {
      if (m.daze > 0) {
        m.daze--;
        if (p && m.touch === 0 && Math.hypot(p.x - e.x, p.y - e.y) < (e.radius ?? 1) + 0.55) {
          m.touch = TOUCH_COOLDOWN;
          world.defeat(state, m.id, { by: 'stomp' });
          emit('boss_hit', { enemy: c.name, by: 'stomp', x: e.x, y: e.y });
        }
      } else if (--m.tire <= 0) {
        m.tire = TIRE_EVERY; m.daze = DAZE;
        world.stun(state, m.id, DAZE);
        emit('boss_dazed', { boss: c.name, x: e.x, y: e.y });
      }
    }
  },

  render(g, m, c, view, fx, frame) {
    tick(fx, frame);
    const { X, Y, s } = view, reduced = !!frame.reducedMotion;
    for (const e of frame.events || []) {
      if (e.name === 'boss_spawn') { fx.intro = 1.6; }
      if (e.name === 'boss_dazed') { ring(fx, m.x, m.y, '#ffe14a', m.r * 1.6, 0.6); }
      if (e.name === 'boss_hit') { burst(fx, m.x, m.y, c.color, 14, 6); ring(fx, m.x, m.y, '#ffffff', m.r * 1.2, 0.3); }
      if (e.name === 'boss_beaten') { burst(fx, m.x, m.y, c.color, 40, 9, { life: 1.1, size: 0.26 }); burst(fx, m.x, m.y, '#ffffff', 20, 5); ring(fx, m.x, m.y, c.color, m.r * 3, 0.9); fx.beaten = 2; }
    }
    const dt = frame.paused ? 0 : frame.dt ?? 1 / 60;
    if (fx.intro > 0) fx.intro -= dt;
    if (fx.beaten > 0) fx.beaten -= dt;
    g.save();
    if (view.clip) { g.beginPath(); g.rect(view.clip.x, view.clip.y, view.clip.w, view.clip.h); g.clip(); }
    if (m.id != null && !m.beaten) {
      const x = X(m.x), y = Y(m.y), r = s * m.r * 1.35;
      // Menacing aura; gold sparks while dazed.
      const grad = g.createRadialGradient ? g.createRadialGradient(x, y, r * 0.3, x, y, r * 1.4) : null;
      if (grad) { grad.addColorStop(0, c.color + '00'); grad.addColorStop(0.7, c.color + '30'); grad.addColorStop(1, c.color + '00'); g.fillStyle = grad; g.beginPath(); g.arc(x, y, r * 1.4, 0, TAU); g.fill(); }
      if (m.daze > 0) {
        for (let k = 0; k < 3; k++) {
          const a = (fx.t || 0) * 4 + k * TAU / 3;
          g.fillStyle = '#ffe14a'; g.beginPath(); g.arc(x + Math.cos(a) * r * 0.7, y - r * 0.9 + Math.sin(a) * r * 0.2, Math.max(2, s * 0.14), 0, TAU); g.fill();
        }
      }
      if (m.maxHp > 0) hpBar(g, view, m.x, m.y - m.r - 0.6, Math.max(2, m.r * 2.4), m.hp / m.maxHp, c.color);
    }
    drawFx(g, fx, view, reduced);
    g.restore();
    if (fx.intro > 0 && view.clip) {
      const k = Math.min(1, fx.intro * 2, (1.6 - fx.intro) * 4);
      g.globalAlpha = Math.max(0, k);
      label(g, `${c.name.toUpperCase()} APPROACHES`, view.clip.x + view.clip.w / 2, view.clip.y + view.clip.h * 0.32, Math.min(view.clip.w / 14, s * 1.4), c.color, reduced ? 0 : s * 0.8);
      g.globalAlpha = 1;
    }
    if (fx.beaten > 0 && view.clip) {
      g.globalAlpha = Math.min(1, fx.beaten);
      label(g, `${c.name.toUpperCase()} DEFEATED!`, view.clip.x + view.clip.w / 2, view.clip.y + view.clip.h * 0.32, Math.min(view.clip.w / 14, s * 1.4), '#ffffff', reduced ? 0 : s);
      g.globalAlpha = 1;
    }
    const text = m.beaten ? `${c.name.toUpperCase()} ✓` : m.id == null ? `${c.name.toUpperCase()} …` : `${c.name.toUpperCase()} ${Math.ceil(m.hp)}/${Math.ceil(m.maxHp)}`;
    badge(g, view, text, m.beaten ? '#7dff9a' : c.color, { progress: m.id != null && !m.beaten && m.maxHp ? m.hp / m.maxHp : null, alert: m.warn > 0 && Math.floor(m.warn / 10) % 2 === 0 });
  },
};
