// World adapter for cross-genre mods (KIT_CONTRACT.md "World adapter and mods", EXTENDING.md).
// Mods think in tile-sized units, so this world reports positions in TILE = 20 kit pixels (a
// 300 × 400 scroller is 15 × 20 tiles), x right and y down like the kit. The ship is the player;
// every live enemy, plus the stage boss as id 'boss', is an enemy. The arena edges block (the
// asteroid field wraps instead). Fire and bomb use both buttons, so only button-free mods fit.
export const TILE = 20;

export const world = {
  capabilities: ['player', 'enemies', 'blocked', 'defeat', 'lives', 'spawn', 'boss', 'score', 'hurt', 'invulnerable', 'end'],
  buttons: ['a', 'b'],
  adapter(game) {
    const T = TILE;
    return {
      active: s => s.status === 'playing' && (s.phase === 'play' || s.phase === 'warn' || s.phase === 'boss') && !!s.player?.alive,
      lives: s => s.lives,
      level: s => s.stage + s.loop * game.stageCount,
      player: s => {
        const p = s.player, a = s.mode === 'asteroids' ? p.ang : s.mode === 'twinstick' ? p.aimAng : -Math.PI / 2;
        return { x: p.x / T, y: p.y / T, facing: { x: Math.round(Math.cos(a) * 100) / 100, y: Math.round(Math.sin(a) * 100) / 100 } };
      },
      enemies: s => {
        const out = s.enemies.filter(e => !e.dead && (e.onScreen || e.st !== 'enter')).map(e => ({
          id: e.id, name: game.nameOf(e.type), x: e.x / T, y: e.y / T, radius: e.r / T, hittable: e.onScreen,
          ...(e.spawned ? { kind: e.kind, hp: e.hp, maxHp: e.maxHp } : {}),
        }));
        const b = s.boss;
        if (b && b.st !== 'dying' && b.st !== 'escape') out.push({ id: 'boss', name: game.nameOf(b.type), x: b.x / T, y: b.y / T, radius: b.r / T, hittable: b.st === 'fight', kind: 'stage-boss', hp: b.hp, maxHp: b.maxHp });
        return out;
      },
      blocked: (s, x, y) => s.mode !== 'asteroids' && (x < 0 || y < 0 || x * T > s.W || y * T > s.H),
      wrap: (s, x, y) => s.mode === 'asteroids' ? [((x * T % s.W) + s.W) % s.W / T, ((y * T % s.H) + s.H) % s.H / T] : [x, y],
      defeat: (s, id) => game.strike(s, id),
      spawn: (s, { x, y, kind, hp } = {}) => game.spawnEnemy(s, { x: Number.isFinite(x) ? x * T : undefined, y: Number.isFinite(y) ? y * T : undefined, kind, hp }),
      addScore: (s, n) => game.addScore(s, n),
      hurtPlayer: (s, { by = 'trouble' } = {}) => {
        const p = s.player;
        if (!p?.alive || s.status !== 'playing') return false;
        if (p.invuln > 0) { s.events.push({ name: 'shielded', x: p.x, y: p.y }); return false; }
        game.hitPlayer(s, by); return true;
      },
      invulnerable: (s, frames) => { if (s.player) s.player.invuln = Math.max(s.player.invuln, frames); },
      end: (s, { won = false, reason = '' } = {}) => {
        if (s.status !== 'playing') return;
        s.status = won ? 'won' : 'lost'; s.reason = reason || (won ? 'Finished' : 'Game over');
        s.events.push({ name: won ? 'won' : 'lost', reason: s.reason });
      },
    };
  },
};
