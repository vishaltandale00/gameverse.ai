// World adapter for cross-genre mods (KIT_CONTRACT.md, "World adapter and mods").
// Mods think in tile-sized units, so this world reports positions in TILE = 40 kit units
// (an average fighter is 2.5 tiles tall), x right and y up from the floor, centered on the body.
// The player is slot 0; the one enemy is the rival in slot 1.
import { ARENA, useArenaOf } from './arena.js';
import { externalHit, hittable } from './sim.js';

export const TILE = 40;
const DEFEAT_DAMAGE = 120;   // a mod "defeat" is a heavy knockdown hit, not an instant KO

export const world = {
  capabilities: ['player', 'enemies', 'blocked', 'defeat', 'stun', 'lives', 'score', 'hurt', 'invulnerable', 'end'],
  // Both buttons drive the fighter (punch and kick), so button mods are not offered here.
  buttons: ['a', 'b'],
  adapter(game) {
    const center = f => ({ x: f.x / TILE, y: (f.y + game.roster[f.fid].phys.h * 0.5) / TILE });
    return {
      active: s => s.phase === 'fight' && !!s.fighters?.length,
      player: s => { const f = s.fighters[0]; return { ...center(f), facing: { x: f.facing, y: 0 } }; },
      enemies: s => s.fighters.slice(1).map(f => ({ id: f.slot, name: game.roster[f.fid].name, ...center(f), radius: game.roster[f.fid].phys.hw * 1.4 / TILE, hittable: hittable(game, f) })),
      blocked: (s, x, y) => {
        useArenaOf(s);
        const wx = x * TILE, wy = y * TILE;
        if (!game.platform) return wy < 0 || wx < ARENA.T.left || wx > ARENA.T.right;
        return wy < 0 && wx >= ARENA.P.main.x0 && wx <= ARENA.P.main.x1;
      },
      defeat: (s, id, { by } = {}) => externalHit(game, s, id, { damage: DEFEAT_DAMAGE, from: s.fighters[0].x, by }),
      stun: (s, id, frames) => { externalHit(game, s, id, { stun: frames }); },
      // A level is a rung of the arcade ladder (versus: the one match).
      level: s => s.arcade?.rung ?? 0,
      addScore: (s, n) => { s.score = Math.max(0, s.score + n); },
      // Hurt is a heavy hit on the player's fighter, through the normal hit path (blocks, KOs and all).
      hurtPlayer: (s, { by } = {}) => {
        const f = s.fighters?.[0];
        if (!f || s.phase !== 'fight') return false;
        if (f.invuln > 0) { s.events.push({ name: 'shielded', x: f.x / TILE, y: f.y / TILE }); return false; }
        return externalHit(game, s, 0, { damage: DEFEAT_DAMAGE * 0.6, from: s.fighters[1]?.x, by }) > 0;
      },
      invulnerable: (s, frames) => { const f = s.fighters?.[0]; if (f) f.invuln = Math.max(f.invuln, frames); },
      end: (s, { won = false, reason = '' } = {}) => {
        if (s.status !== 'playing') return;
        s.status = won ? 'won' : 'lost'; s.reason = reason || (won ? 'Finished' : 'Game over');
        s.events.push({ name: won ? 'won' : 'lost', reason: s.reason });
      },
      // A life is a round you can still afford to lose (platform mode: stocks).
      lives: s => !s.fighters?.length ? null : game.platform ? s.fighters[0].stocks : game.toWin - (s.match?.wins?.[1] || 0),
    };
  },
};
