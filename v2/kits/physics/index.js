// Physics toy kit: Breakout/Arkanoid, Peggle, slingshot (Angry Birds-like)
// and pinball levels on one deterministic rigid-body engine (physics.js).
import { SCHEMA, PROMPT, SAMPLE, validate } from './content.js';
import { createGame } from './game.js';
import { createRenderer } from './render.js';
import { verify } from './verify.js';
import { findBody, containsPoint, removeBody } from './physics.js';
import { emit, addScore, loseLife } from './flow.js';
import * as breakout from './modes/breakout.js';
import * as peggle from './modes/peggle.js';
import * as slingshot from './modes/slingshot.js';
import * as pinball from './modes/pinball.js';

const GOALS = { breakout: 'break every brick', peggle: 'clear the orange pegs', slingshot: 'topple the foes', pinball: 'finish the table missions' };

export default {
  id: 'physics',
  name: 'Physics toy',
  version: '0.1.0',
  summary: 'Ball-and-body physics games: Breakout/Arkanoid brick breaking with power-ups and bosses, Peggle peg shooting with fever, Angry Birds-style slingshot demolition of wood, stone and glass forts, and pinball tables with flippers, bumpers, ramps, multiball and missions.',
  examples: ['Breakout', 'Arkanoid', 'Peggle', 'Angry Birds', 'Pinball'],
  content: { schema: SCHEMA, prompt: PROMPT, sample: SAMPLE },
  validate,
  cast(content) {
    const c = content.cast || {};
    return {
      brief: { player: { name: c.hero || 'Hero' }, enemy: { name: c.foe || 'Foe' }, pickup: { name: c.prize || 'Gem' }, hazard: { name: c.hazard || 'Bomb' }, goal: { name: c.goal || 'Trophy' } },
      entities: { hero: { tags: ['player'] }, foe: { tags: ['enemy'] }, prize: { tags: ['collectible'] }, hazard: { tags: ['hazard'] }, goal: { tags: ['goal'] } },
    };
  },
  createGame,
  createRenderer,
  verify,
  controls: [
    { input: 'move', label: 'Move, aim, pull back, flippers, plunger (down)' },
    { input: 'a', label: 'Launch, shoot, release, ability, left flipper' },
    { input: 'b', label: 'Right flipper, ability, look ahead' },
  ],
  goal(content) {
    const modes = [...new Set((content?.levels || []).map(l => l.mode))];
    return `${(content?.levels || []).length} levels: ${modes.map(m => GOALS[m]).join(', ')}. Keep your lives!`;
  },
  stats(state) { return [['Level', `${(state.level ?? 0) + 1}`], ['Lives left', String(state.lives ?? 0)]]; },

  // What cross-genre mods (v2/kits/mods) can see and do in this world. Units are the current
  // level's world units. The paddle, cannon, slingshot pouch or flipper pair is the player; bricks,
  // pegs, foes or drop targets are the enemies. 'b' is only an alias here (right flipper is also
  // move-right, the slingshot ability is also 'a'), so mods may take it.
  // Breakout levels also take spawned bricks and a boss, a brick grid and a guard (shield); every
  // mode takes score, hurt and end. capabilitiesFor narrows the list to the content's modes.
  world: {
    capabilities: ['player', 'enemies', 'blocked', 'defeat', 'lives', 'score', 'hurt', 'end', 'spawn', 'boss', 'grid', 'invulnerable'],
    capabilitiesFor(content) {
      const base = ['player', 'enemies', 'blocked', 'defeat', 'lives', 'score', 'hurt', 'end'];
      return (content?.levels || []).some(l => l.mode === 'breakout') ? [...base, 'spawn', 'boss', 'grid', 'invulnerable'] : base;
    },
    buttons: ['a'],
    adapter() {
      const player = s => {
        const m = s.m;
        if (s.mode === 'breakout') { const p = findBody(s.world, m.paddle); return { x: p?.x ?? m.w / 2, y: (p?.y ?? m.h) - 0.4, facing: { x: 0, y: -1 } }; }
        if (s.mode === 'peggle') { const sx = Math.sin(m.aim), sy = Math.cos(m.aim); return { x: m.cannon.x + sx * m.cannon.len, y: m.cannon.y + sy * m.cannon.len, facing: { x: sx, y: sy } }; }
        if (s.mode === 'slingshot') return { x: slingshot.POUCH.x, y: slingshot.POUCH.y, facing: { x: Math.cos(m.angle), y: -Math.sin(m.angle) } };
        return { x: 5.65, y: 16.6, facing: { x: 0, y: -1 } };
      };
      const enemies = s => {
        const m = s.m, out = [];
        for (const b of s.world.bodies) {
          if (b.dead) continue;
          if (s.mode === 'breakout' && b.tag === 'brick' && b.data.kind !== 'm') out.push({ id: b.id, name: 'brick', x: b.x, y: b.y, radius: 0.4, hittable: true });
          else if (s.mode === 'breakout' && b.tag === 'boss') out.push({ id: b.id, name: s.cast.foe, x: b.x, y: b.y, radius: 1.5, hittable: true, kind: 'boss', hp: m.boss?.hp ?? 0, maxHp: m.boss?.max ?? 1 });
          else if (s.mode === 'peggle' && b.tag === 'peg' && !b.data.lit) out.push({ id: b.id, name: `${b.data.kind} peg`, x: b.x, y: b.y, radius: 0.3, hittable: m.phase === 'shot' || m.phase === 'aim' });
          else if (s.mode === 'slingshot' && b.tag === 'target') out.push({ id: b.id, name: s.cast.foe, x: b.x, y: b.y, radius: b.r, hittable: true });
          else if (s.mode === 'pinball' && b.tag === 'drop') out.push({ id: b.id, name: 'drop target', x: b.x, y: b.y, radius: 0.35, hittable: true });
        }
        return out;
      };
      const blocked = (s, x, y) => {
        const m = s.m;
        if (s.mode === 'breakout') return x < 0 || x > m.w || y < 0 || s.world.bodies.some(b => !b.dead && b.tag === 'brick' && b.data.kind === 'm' && Math.abs(b.x - x) < 0.5 && Math.abs(b.y - y) < 0.25);
        if (s.mode === 'peggle') return x < 0 || x > s.m.W || y < 0;
        if (s.mode === 'slingshot') return y > 0 || s.world.bodies.some(b => !b.dead && (b.tag === 'rock' || b.tag === 'block') && containsPoint(b, x, y));
        return x < 0.3 || x > 11.0 || y < 0.2;
      };
      const defeat = (s, id, { by = 'mod' } = {}) => {
        const b = findBody(s.world, id);
        if (!b || b.dead) return 0;
        const before = s.score;
        if (s.mode === 'breakout') {
          if (b.tag === 'boss') { s.m.boss.hp = Math.max(0, s.m.boss.hp - 3); s.m.boss.flash = 0.15; if (s.m.boss.hp <= 0) { emit(s, 'defeated', { x: b.x, y: b.y, kind: 'boss', big: true }); addScore(s, 5000, b.x, b.y); removeBody(s.world, b); s.m.boss = null; } }
          else breakout.breakBrick(s, b, by);
        } else if (s.mode === 'peggle') peggle.lightPeg(s, b, by);
        else if (s.mode === 'slingshot') { b.data.hp = 0; slingshot.damage(s, b, 1, by); }
        else pinball.dropTarget(s, b);
        return s.score - before;
      };
      const breakoutOnly = fn => (s, ...args) => s.mode === 'breakout' && s.m ? fn(s, ...args) : null;
      return {
        active: s => s.status === 'playing' && s.phase === 'play',
        lives: s => s.lives,
        level: s => s.level,
        player, enemies, blocked, defeat,
        // Breakout's brick grid: tiles are brick cells; landed pieces grow upward against the wall (gravity -1).
        size: breakoutOnly(s => ({ ...breakout.grid(s), gravity: -1 })),
        spawn: breakoutOnly((s, o = {}) => o.kind === 'boss' ? breakout.spawnBoss(s, o) : breakout.spawnBrick(s, o)),
        addScore: (s, n) => addScore(s, n),
        hurtPlayer: (s, { by = 'trouble' } = {}) => {
          if (s.phase !== 'play') return false;
          if (s.mode === 'breakout') { if (s.m.guard > 0) { emit(s, 'shielded', {}); return false; } breakout.loseBall(s, by); return true; }
          loseLife(s, by, { retry: true }); return true;
        },
        invulnerable: breakoutOnly((s, frames) => { s.m.guard = Math.max(s.m.guard || 0, frames / 60); }),
        end: (s, { won = false, reason = '' } = {}) => {
          if (s.status !== 'playing') return;
          s.status = won ? 'won' : 'lost'; s.reason = reason || (won ? 'Finished' : 'Game over'); s.phase = 'over';
          emit(s, won ? 'won' : 'lost', { reason: s.reason });
        },
      };
    },
  },
};
