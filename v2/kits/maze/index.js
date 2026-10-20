// Maze chase kit: the reference implementation of KIT_CONTRACT.md.
import { schema, prompt, sample, validate } from './content.js';
import { createGame } from './game.js';
import { createRenderer } from './render.js';
import { verify } from './verify.js';
import { DX, DY } from './game.js';
import { isOpen, wrapX } from './maze.js';

/** Names for the art director and the entity kinds paintGameArt paints. */
export function cast(content) {
  const c = validate(content).content || content;
  return {
    brief: {
      player: { name: c.hero.name, glyph: c.hero.glyph },
      // The hunters share one painted rig, tinted per hunter by the renderer; a ghost glyph gives a pale base that tints well.
      enemy: { name: `maze hunters (${c.hunters.map(h => h.name).join(', ')})`, glyph: '👻' },
      pickup: { name: c.pellet.name },
      goal: { name: c.power.name },
    },
    entities: {
      hero: { tags: ['player'] },
      hunter: { tags: ['enemy'] },
      pellet: { tags: ['collectible'] },
      bonus: { tags: ['collectible'] },
      power: { tags: ['goal'] },
    },
  };
}

export default {
  id: 'maze',
  name: 'Maze chase',
  version: '0.2.0', // 0.2: map sizes with a scrolling camera; classic-size mazes are unchanged
  summary: 'Grid maze, pellets, power-ups that turn the hunters into the hunted, ghost AI with personalities.',
  examples: ['Pac-Man', 'Ms. Pac-Man'],
  content: { schema, prompt, sample },
  validate,
  cast,
  createGame,
  createRenderer,
  verify,
  controls: [{ input: 'move', label: 'Steer through the maze' }],
  // What cross-genre mods (v2/kits/mods) can see and do in this world. Units are tiles.
  world: {
    capabilities: ['player', 'enemies', 'blocked', 'defeat', 'stun', 'lives', 'grid', 'terrain', 'spawn', 'boss', 'score', 'hurt', 'invulnerable', 'end'],
    buttons: [], // the maze is played with movement only; a and b are free for mods
    adapter(game) {
      const find = (s, id) => s.hunters.find(h => (h.id ?? h.index) === id && h.state !== 'gone');
      return {
        active: s => s.phase === 'play' && !(s.pauseT > 0),
        lives: s => s.lives,
        level: s => s.level,
        player: s => { const p = s.player, d = p.dir >= 0 ? p.dir : p.face > 0 ? 3 : 1; return { x: p.x, y: p.y, facing: { x: DX[d], y: DY[d] } }; },
        enemies: s => s.hunters.filter(h => h.state !== 'gone').map(h => ({
          id: h.id ?? h.index, name: h.name, x: h.x, y: h.y, radius: h.big ? 0.95 : 0.45,
          hittable: (h.state === 'active' || h.state === 'leaving') && !h.fright && !(h.stunT > 0),
          ...(h.spawned ? { kind: h.kind, hp: h.hp, maxHp: h.maxHp } : {}),
        })),
        // Every level has its own dimensions (maze.w × maze.h), and mods may have changed the walls, so terrain reads the live maze.
        blocked: (s, x, y) => { const maze = game.mazeOf(s); return !isOpen(maze, wrapX(Math.round(x), maze.w), Math.round(y)); },
        wrap: (s, x, y) => { const w = game.mazeFor(s.level).w; return [x < -0.5 ? x + w : x >= w - 0.5 ? x - w : x, y]; },
        size: s => { const maze = game.mazeFor(s.level); return { w: maze.w, h: maze.h }; },
        // Defeated hunters go home as eyes, like being eaten while frightened. A spawned one with hp left takes the hit and keeps coming.
        defeat: (s, id) => {
          const h = find(s, id);
          if (!h) return 0;
          if (h.spawned && h.hp > 1) { h.hp--; h.hitT = 20; game.addScore(s, 100); return 100; }
          if (h.spawned) { h.state = 'gone'; h.hp = 0; const pts = h.big ? 2000 : 200; game.addScore(s, pts); return pts; }
          h.state = h.state === 'leaving' ? 'entering' : 'eyes'; h.fright = false; h.stunT = 0; game.addScore(s, 200); return 200;
        },
        stun: (s, id, frames) => { const h = find(s, id); if (h) h.stunT = frames; },
        spawn: (s, o) => game.spawnHunter(s, o),
        setBlocked: (s, x, y, on) => game.setTile(s, x, y, on),
        addScore: (s, n) => game.addScore(s, n),
        hurtPlayer: (s, { by } = {}) => game.hurtPlayer(s, by),
        invulnerable: (s, frames) => { s.invulnT = Math.max(s.invulnT || 0, frames); },
        end: (s, o) => game.endGame(s, o),
      };
    },
  },
};
