// weapon: a player weapon for any kit whose world reports the player, enemies,
// blocking terrain and a way to defeat or stun an enemy. Bolts fly the way the
// player faces until they hit terrain or an enemy; bombs blast in a plus shape
// along open tiles after a fuse. Ammo can come from the start, from any kit
// event (power pellets, pickups, level-ups), or be unlimited.
const str = description => ({ type: 'string', description });
const obj = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const KINDS = ['none', 'projectile', 'bomb'], AMMO_FROM = ['start', 'event', 'unlimited'], EFFECTS = ['defeat', 'stun'];
// Reload triggers, named for what the player sees, mapped to the shared kit event names.
const RELOAD_ON = { power_up: 'power', any_pickup: 'collect', new_level: 'level_up', extra_life: 'extra_life' };
const LEGACY_RELOAD = { power: 'power_up', collect: 'any_pickup', level_up: 'new_level' };
const SHOT_SPEED = 18, SHOT_LIFE = 90, COOLDOWN = 12, FUSE = 60, RANGE = 3, BLAST_SHOW = 22, STUN = 180;
const TAU = Math.PI * 2;

export default {
  id: 'weapon',
  summary: 'a weapon the player fires with a free button: kind projectile (bolts fly the way the player faces) or bomb (blasts in a plus shape after a fuse); ammo from the start, reloaded by a game event (power_up: big power-ups such as power pellets; any_pickup: every small pickup, very frequent; new_level), or unlimited; a hit defeats or stuns an enemy.',
  requires: ['player', 'enemies', 'blocked', 'defeat'],
  button: true,
  schema: obj({
    kind: { type: 'string', enum: KINDS, description: 'none (off), projectile or bomb.' },
    name: str('Themed name, e.g. "spark wand"; empty when off.'),
    ammoFrom: { type: 'string', enum: AMMO_FROM, description: 'start: `ammo` shots per life; event: `ammo` shots each time reloadOn happens; unlimited.' },
    reloadOn: { type: 'string', enum: Object.keys(RELOAD_ON), description: 'What reloads when ammoFrom is event. power_up: big power-ups ("pick up powers", power pellets); any_pickup: every small pickup such as each pellet (very frequent, use ammo 1); new_level; extra_life.' },
    ammo: { type: 'integer', description: '1 to 20.' },
    effect: { type: 'string', enum: EFFECTS, description: 'defeat sends the enemy away (the genre decides how); stun freezes it for 3 seconds.' },
    color: str('Hex color for the bolt or blast, e.g. #7fe3ff.'),
  }),
  normalize(c = {}) {
    const pick = (v, list, d) => list.includes(v) ? v : d;
    return { kind: pick(c?.kind, KINDS, 'none'), name: typeof c?.name === 'string' && c.name.trim() ? c.name.trim().slice(0, 24) : (c?.kind === 'bomb' ? 'bomb' : 'blaster'), ammoFrom: pick(c?.ammoFrom, AMMO_FROM, 'event'), reloadOn: pick(LEGACY_RELOAD[c?.reloadOn] || c?.reloadOn, Object.keys(RELOAD_ON), 'power_up'),
      ammo: Math.round(Math.min(20, Math.max(1, Number(c?.ammo) || 3))), effect: pick(c?.effect, EFFECTS, 'defeat'), color: /^#[0-9a-f]{6}$/i.test(c?.color || '') ? c.color : '#7fe3ff' };
  },
  enabled: c => c.kind !== 'none',
  label: c => `Fire ${c.name}`,

  init(c) { return { ammo: c.ammoFrom === 'unlimited' ? -1 : c.ammoFrom === 'start' ? c.ammo : 0, shots: [], bombs: [], blasts: [], cooldown: 0, lives: null }; },

  step(m, input, c, { world, state, events, emit }) {
    // Reloads: on the configured event, or a fresh life when ammo comes per life.
    if (c.ammoFrom === 'event') for (const e of events) if (e.name === RELOAD_ON[c.reloadOn] && !(e.item === 'ammo')) { m.ammo = Math.min(99, m.ammo + c.ammo); emit('collect', { item: 'ammo', ammo: m.ammo, points: 0 }); }
    const lives = world.lives?.(state);
    if (c.ammoFrom === 'start' && lives != null && m.lives != null && lives < m.lives) m.ammo = c.ammo;
    m.lives = lives ?? m.lives;
    if (!world.active(state)) { m.shots = []; return; }
    if (m.cooldown > 0) m.cooldown--;
    const p = world.player(state);
    if (input.pressed) {
      if (m.ammo === 0) emit('empty', { item: c.name });
      else if (m.cooldown === 0) {
        const t = { x: Math.round(p.x), y: Math.round(p.y) };
        if (c.kind === 'projectile') m.shots.push({ x: p.x, y: p.y, dx: p.facing.x, dy: p.facing.y, life: SHOT_LIFE });
        else m.bombs.push({ x: t.x, y: t.y, t: FUSE });
        if (m.ammo > 0) m.ammo--;
        m.cooldown = COOLDOWN;
        emit('shoot', { weapon: c.kind, ammo: m.ammo, x: p.x, y: p.y });
      }
    }
    const hit = (enemy, how) => {
      if (c.effect === 'stun' && world.stun) { world.stun(state, enemy.id, STUN); emit('hit', { enemy: enemy.name, by: how, x: enemy.x, y: enemy.y }); }
      else { const points = world.defeat(state, enemy.id, { by: how }) ?? 200; emit('defeated', { enemy: enemy.name, by: how, points, x: enemy.x, y: enemy.y }); }
    };
    const targets = () => world.enemies(state).filter(e => e.hittable);
    m.shots = m.shots.filter(b => {
      let move = SHOT_SPEED / 60;
      while (move > 0) {
        const d = Math.min(move, 0.4); move -= d;
        const nx = b.x + b.dx * d, ny = b.y + b.dy * d;
        if (world.blocked(state, nx, ny)) { emit('spark', { x: b.x, y: b.y }); return false; }
        [b.x, b.y] = world.wrap ? world.wrap(state, nx, ny) : [nx, ny];
        const e = targets().find(q => Math.hypot(q.x - b.x, q.y - b.y) < (q.radius ?? 0.5) + 0.2);
        if (e) { hit(e, 'shot'); return false; }
      }
      return --b.life > 0;
    });
    m.bombs = m.bombs.filter(b => {
      if (--b.t > 0) return true;
      const tiles = [[b.x, b.y]];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let r = 1; r <= RANGE; r++) { const x = b.x + dx * r, y = b.y + dy * r; if (world.blocked(state, x, y)) break; tiles.push([x, y]); }
      m.blasts.push({ tiles, t: BLAST_SHOW });
      emit('blast', { x: b.x, y: b.y });
      for (const e of targets()) if (tiles.some(([x, y]) => Math.abs(e.x - x) < 0.75 && Math.abs(e.y - y) < 0.75)) hit(e, 'bomb');
      return false;
    });
    m.blasts = m.blasts.filter(b => --b.t > 0);
  },

  render(g, m, c, view, fx, frame) {
    const { X, Y, s } = view;
    fx.t = (fx.t || 0) + (frame.paused ? 0 : frame.dt || 1 / 60);
    const reduced = !!frame.reducedMotion;
    g.save();
    if (view.clip) { g.beginPath(); g.rect(view.clip.x, view.clip.y, view.clip.w, view.clip.h); g.clip(); }
    for (const b of m.shots) {
      const x = X(b.x), y = Y(b.y), tx = x - b.dx * s * 0.9, ty = y - b.dy * s * 0.9;
      const grad = g.createLinearGradient ? g.createLinearGradient(tx, ty, x, y) : null;
      if (grad) { grad.addColorStop(0, c.color + '00'); grad.addColorStop(1, c.color); }
      g.strokeStyle = grad || c.color; g.lineWidth = s * 0.28; g.lineCap = 'round';
      if (!reduced) { g.shadowColor = c.color; g.shadowBlur = s * 0.6; }
      g.beginPath(); g.moveTo(tx, ty); g.lineTo(x, y); g.stroke();
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(x, y, s * 0.13, 0, TAU); g.fill();
      g.shadowBlur = 0;
    }
    for (const b of m.bombs) {
      const x = X(b.x), y = Y(b.y), pulse = 1 + (reduced ? 0 : 0.12 * Math.sin(fx.t * (6 + (FUSE - b.t) * 0.4)));
      g.fillStyle = '#2a2f3c'; g.strokeStyle = '#0d0f16'; g.lineWidth = s * 0.08;
      g.beginPath(); g.arc(x, y, s * 0.38 * pulse, 0, TAU); g.fill(); g.stroke();
      g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.arc(x - s * 0.12, y - s * 0.12, s * 0.1, 0, TAU); g.fill();
      g.strokeStyle = '#c8a060'; g.lineWidth = s * 0.07; g.beginPath(); g.moveTo(x + s * 0.2, y - s * 0.3); g.quadraticCurveTo(x + s * 0.4, y - s * 0.55, x + s * 0.3, y - s * 0.65); g.stroke();
      if (b.t % 6 < 3) { g.fillStyle = b.t < 20 ? '#ff5a3a' : '#ffd23f'; g.beginPath(); g.arc(x + s * 0.3, y - s * 0.66, s * 0.1, 0, TAU); g.fill(); }
    }
    for (const b of m.blasts) {
      const k = b.t / BLAST_SHOW;
      g.globalAlpha = Math.min(1, k * 1.6);
      for (const [tx, ty] of b.tiles) {
        const x = X(tx), y = Y(ty), r = s * (0.55 + (1 - k) * 0.25);
        const grad = g.createRadialGradient ? g.createRadialGradient(x, y, 0, x, y, r) : null;
        if (grad) { grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.35, '#ffe14a'); grad.addColorStop(0.7, c.color === '#7fe3ff' ? '#ff7a1a' : c.color); grad.addColorStop(1, 'rgba(255,90,30,0)'); }
        g.fillStyle = grad || '#ff9a3a'; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
      }
      g.globalAlpha = 1;
    }
    g.restore();
    // Ammo badge, top centre under the kit HUD.
    if (view.hud) {
      const label = `${c.name.toUpperCase()}  ${m.ammo < 0 ? '∞' : `×${m.ammo}`}`;
      g.font = `800 ${Math.max(10, s * 0.7)}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      const w = g.measureText ? g.measureText(label).width + s * 1.2 : s * 8, x = view.hud.x, y = view.hud.y;
      g.fillStyle = 'rgba(8,10,20,.72)'; g.beginPath(); g.roundRect ? g.roundRect(x - w / 2, y - s * 0.55, w, s * 1.1, s * 0.55) : g.rect(x - w / 2, y - s * 0.55, w, s * 1.1); g.fill();
      g.fillStyle = m.ammo === 0 ? '#ff6b6b' : c.color; g.fillText(label, x, y + 1);
    }
  },
};
