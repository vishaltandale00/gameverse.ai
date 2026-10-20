// waves: timed waves of extra enemies, spawned through the kit's own spawn operation (hunters
// released from the house, bricks dropping into the wall, gunships flying in, barriers or monsters
// ahead of a runner). Each wave is bigger and/or tougher than the last; clearing every wave
// banks a bonus. With mustClear, wave enemies hold the level clear until they are gone.
import { obj, bool, int, str, enumOf, clampInt, color, name, pick, tick, burst, ring, drawFx, badge, label } from './fx.js';

const GROW = ['none', 'more', 'tougher', 'both'];
const FPS = 60, STAGGER = 12, MAX_ALIVE = 12;

export default {
  id: 'waves',
  summary: 'waves of extra enemies of the genre\'s own kind: `waves` waves (per level, or per run without levels), the first after `every` seconds and then every `every` seconds, starting at `size` enemies; grow more adds one enemy per wave, tougher adds hp, both does both; mustClear true holds the level clear until wave enemies are gone; clearing them all banks a bonus. Use for "waves of enemies", "hordes", "survive the onslaught", "more enemies over time".',
  requires: ['enemies', 'spawn'],
  button: false,
  schema: obj({
    enabled: bool('true sends the waves.'),
    name: str('Themed name for a wave, e.g. "swarm"; empty for "Wave".'),
    waves: int('1 to 12 waves.'),
    every: int('4 to 90 seconds between waves.'),
    size: int('1 to 6 enemies in the first wave.'),
    grow: enumOf(GROW, 'none, more (one more enemy each wave), tougher (more hp each wave) or both.'),
    mustClear: bool('true: the level is not cleared while wave enemies remain.'),
    color: str('Hex color for wave warnings, e.g. #ff7a3a.'),
  }),
  normalize(c = {}) {
    return { enabled: c?.enabled === true, name: name(c?.name, 'Wave'), waves: clampInt(c?.waves, 1, 12, 5), every: clampInt(c?.every, 4, 90, 15), size: clampInt(c?.size, 1, 6, 2), grow: pick(c?.grow, GROW, 'more'), mustClear: c?.mustClear === true, color: color(c?.color, '#ff7a3a') };
  },
  enabled: c => c.enabled,
  label: c => c.name,

  init(c, world, s) { return { level: world.level?.(s) ?? 0, wave: 0, t: 0, queue: 0, hp: 1, gap: 0, ids: [], cleared: false, warn: 0, pops: [] }; },

  step(m, input, c, { world, state, emit }) {
    const level = world.level?.(state) ?? 0;
    if (level !== m.level) Object.assign(m, { level, wave: 0, t: 0, queue: 0, ids: [], cleared: false });
    if (m.warn > 0) m.warn--;
    m.pops = [];
    if (!world.active(state)) return;
    // Track the wave enemies still alive.
    if (m.ids.length) { const alive = new Set(world.enemies(state).map(e => e.id)); m.ids = m.ids.filter(id => alive.has(id)); }
    // Spawn the queued enemies a few frames apart, so a wave pours in rather than appearing at once.
    if (m.queue > 0 && --m.gap <= 0) {
      m.gap = STAGGER;
      if (m.ids.length < MAX_ALIVE) {
        const id = world.spawn(state, { kind: 'wave', hp: m.hp, required: c.mustClear });
        if (id != null) { m.ids.push(id); const e = world.enemies(state).find(q => q.id === id); if (e) m.pops.push([e.x, e.y]); }
      }
      m.queue--;
    }
    if (m.wave < c.waves && ++m.t >= c.every * FPS) {
      m.t = 0; m.wave++;
      const k = m.wave - 1, more = c.grow === 'more' || c.grow === 'both', tougher = c.grow === 'tougher' || c.grow === 'both';
      m.queue = Math.min(8, c.size + (more ? k : 0));
      m.hp = 1 + (tougher ? Math.floor(k / 2) : 0);
      m.gap = 0; m.warn = 90;
      emit('wave', { wave: m.wave, of: c.waves, count: m.queue });
    }
    if (!m.cleared && m.wave >= c.waves && m.queue === 0 && m.ids.length === 0) {
      m.cleared = true;
      const points = 250 * c.waves;
      world.addScore?.(state, points);
      emit('waves_cleared', { waves: c.waves, points });
    }
  },

  render(g, m, c, view, fx, frame) {
    tick(fx, frame);
    const reduced = !!frame.reducedMotion, s = view.s;
    for (const e of frame.events || []) {
      if (e.name === 'wave') { fx.banner = { text: `${c.name.toUpperCase()} ${e.wave}/${e.of}`, t: 1.6 }; }
      if (e.name === 'waves_cleared') { fx.banner = { text: `ALL ${c.name.toUpperCase()}S CLEARED +${e.points}`, t: 2 }; }
    }
    if (fx.pops !== m.pops) { fx.pops = m.pops; for (const [x, y] of m.pops || []) { burst(fx, x, y, c.color, 10, 4); ring(fx, x, y, c.color, 1.2, 0.5); } }
    if (fx.banner) { fx.banner.t -= frame.paused ? 0 : frame.dt ?? 1 / 60; if (fx.banner.t <= 0) fx.banner = null; }
    g.save();
    if (view.clip) { g.beginPath(); g.rect(view.clip.x, view.clip.y, view.clip.w, view.clip.h); g.clip(); }
    drawFx(g, fx, view, reduced);
    // Warning stripes along the play area's top edge while a wave pours in.
    if (m.warn > 0 && view.clip && !reduced) {
      const a = Math.min(1, m.warn / 30) * 0.8, h = Math.max(4, s * 0.25);
      g.globalAlpha = a; g.fillStyle = c.color;
      for (let x = view.clip.x - h * 2 + ((fx.t || 0) * 60) % (h * 4); x < view.clip.x + view.clip.w; x += h * 4) { g.beginPath(); g.moveTo(x, view.clip.y); g.lineTo(x + h * 2, view.clip.y); g.lineTo(x + h, view.clip.y + h); g.lineTo(x - h, view.clip.y + h); g.fill(); }
      g.globalAlpha = 1;
    }
    g.restore();
    if (fx.banner && view.clip) {
      const k = Math.min(1, fx.banner.t * 2);
      g.globalAlpha = k;
      label(g, fx.banner.text, view.clip.x + view.clip.w / 2, view.clip.y + view.clip.h * 0.22, Math.min(view.clip.w / 16, s * 1.2), c.color, reduced ? 0 : s * 0.6);
      g.globalAlpha = 1;
    }
    const next = m.wave < c.waves ? Math.ceil((c.every * FPS - m.t) / FPS) : null;
    const text = m.cleared ? `${c.name.toUpperCase()}S ✓` : `${c.name.toUpperCase()} ${m.wave}/${c.waves}${next != null && m.queue === 0 ? ` · ${next}s` : ''}`;
    badge(g, view, text, m.cleared ? '#7dff9a' : c.color, { progress: next != null ? m.t / (c.every * FPS) : null, alert: m.warn > 0 });
  },
};
