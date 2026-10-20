// timer: time attack for any kit that keeps score and can end the game. Each level (or the whole
// run, in kits without levels) gets a clock that runs only during live play. Clearing a level
// banks points for every second left; at zero the run is lost, finished (a score attack), or the
// clock just stops paying out.
import { obj, bool, int, str, enumOf, clampInt, color, name, pick, tick, drawFx, badge, label } from './fx.js';

const ON_ZERO = ['lose', 'finish', 'nothing'];
const FPS = 60;

export default {
  id: 'timer',
  summary: 'time attack: a countdown of `seconds` per level (the whole run when the game has no levels) that runs only during play; clearing a level banks `pointsPerSecond` for each second left; at zero the player loses (lose), the run ends with the score so far (finish, for score attacks) or nothing happens (nothing). Use for "time limit", "beat the clock", "speedrun", "hurry".',
  requires: ['score', 'end'],
  button: false,
  schema: obj({
    enabled: bool('true switches the clock on.'),
    seconds: int('10 to 900 per level.'),
    pointsPerSecond: int('0 to 1000 banked per second left when a level is cleared.'),
    onZero: enumOf(ON_ZERO, 'lose, finish (end the run keeping the score) or nothing.'),
    name: str('HUD label, e.g. "Oxygen"; empty for "Time".'),
    color: str('Hex color of the clock, e.g. #ffd23f.'),
  }),
  normalize(c = {}) {
    return { enabled: c?.enabled === true, seconds: clampInt(c?.seconds, 10, 900, 90), pointsPerSecond: clampInt(c?.pointsPerSecond, 0, 1000, 50), onZero: pick(c?.onZero, ON_ZERO, 'lose'), name: name(c?.name, 'Time'), color: color(c?.color, '#ffd23f') };
  },
  enabled: c => c.enabled,
  label: c => c.name,

  init(c, world, s) { return { left: c.seconds * FPS, level: world.level?.(s) ?? 0, out: false, done: false, banked: 0, pop: 0 }; },

  step(m, input, c, { world, state, emit }) {
    if (m.pop > 0) m.pop--;
    const level = world.level?.(state) ?? 0;
    // A cleared level (the level index moved on) or a won game banks the time left.
    const bank = () => {
      const secs = Math.ceil(m.left / FPS), points = secs * c.pointsPerSecond;
      if (points > 0 && !m.out) { world.addScore(state, points); emit('time_bonus', { seconds: secs, points }); m.banked += points; m.pop = 40; }
    };
    if (level !== m.level) { if (level > m.level) bank(); m.level = level; m.left = c.seconds * FPS; m.out = false; return; }
    if (state.status === 'won' && !m.done) { m.done = true; bank(); return; }
    if (state.status !== 'playing' || m.out || !world.active(state)) return;
    m.left--;
    if (m.left > 0 && m.left <= 5 * FPS && m.left % FPS === 0) emit('tick', { seconds: m.left / FPS });
    if (m.left > 0) return;
    m.left = 0; m.out = true;
    emit('time_up', {});
    if (c.onZero === 'lose') world.end(state, { won: false, reason: `${c.name === 'Time' ? 'Time' : c.name} ran out` });
    else if (c.onZero === 'finish') world.end(state, { won: true, reason: "Time's up" });
  },

  render(g, m, c, view, fx, frame) {
    tick(fx, frame);
    const secs = Math.ceil(m.left / FPS), low = secs <= 10 && !m.out;
    for (const e of frame.events || []) {
      if (e.name === 'tick' && view.hud) fx.flash = 1;
      if (e.name === 'time_bonus') fx.bonus = { text: `+${e.points}`, t: 1.4 };
    }
    if (fx.bonus) fx.bonus.t -= frame.paused ? 0 : frame.dt ?? 1 / 60;
    if (fx.bonus?.t <= 0) fx.bonus = null;
    drawFx(g, fx, view, frame.reducedMotion);
    const mm = Math.floor(secs / 60), ss = String(secs % 60).padStart(2, '0');
    const pulse = low && !frame.reducedMotion ? 0.5 + 0.5 * Math.sin((fx.t || 0) * 12) : 0;
    badge(g, view, `${c.name.toUpperCase()} ${mm}:${ss}`, m.out ? '#ff6b6b' : low ? '#ff6b6b' : c.color, { progress: m.left / (c.seconds * FPS), pop: Math.max(pulse * 0.6, m.pop / 40), alert: low });
    if (fx.bonus && view.hud) label(g, `TIME BONUS ${fx.bonus.text}`, view.hud.x, view.hud.y - view.s * (1.6 + (1.4 - fx.bonus.t) * 0.8), view.s * 0.9, c.color, frame.reducedMotion ? 0 : view.s * 0.5);
    if (fx.flash > 0 && view.clip && !frame.reducedMotion) { g.fillStyle = `rgba(255,80,80,${0.12 * fx.flash})`; g.fillRect(view.clip.x, view.clip.y, view.clip.w, view.clip.h); }
  },
};
