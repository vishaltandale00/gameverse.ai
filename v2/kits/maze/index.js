// Maze chase kit: the reference implementation of KIT_CONTRACT.md.
import { schema, prompt, sample, validate } from './content.js';
import { createGame } from './game.js';
import { createRenderer } from './render.js';
import { verify } from './verify.js';
import { DX, DY } from './game.js';
import { isOpen, wrapX, W } from './maze.js';

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
  version: '0.1.0',
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
    capabilities: ['player', 'enemies', 'blocked', 'defeat', 'stun', 'lives'],
    buttons: [], // the maze is played with movement only; a and b are free for mods
    adapter(game) {
      return {
        active: s => s.phase === 'play' && !(s.pauseT > 0),
        lives: s => s.lives,
        player: s => { const p = s.player, d = p.dir >= 0 ? p.dir : p.face > 0 ? 3 : 1; return { x: p.x, y: p.y, facing: { x: DX[d], y: DY[d] } }; },
        enemies: s => s.hunters.map(h => ({ id: h.index, name: h.name, x: h.x, y: h.y, radius: 0.45, hittable: (h.state === 'active' || h.state === 'leaving') && !h.fright && !(h.stunT > 0) })),
        blocked: (s, x, y) => !isOpen(game.mazeFor(s.level), wrapX(Math.round(x)), Math.round(y)),
        wrap: (s, x, y) => [x < -0.5 ? x + W : x >= W - 0.5 ? x - W : x, y],
        // Defeated hunters go home as eyes, like being eaten while frightened.
        defeat: (s, id) => { const h = s.hunters[id]; h.state = h.state === 'leaving' ? 'entering' : 'eyes'; h.fright = false; h.stunT = 0; game.addScore(s, 200); return 200; },
        stun: (s, id, frames) => { s.hunters[id].stunT = frames; },
      };
    },
  },
};
