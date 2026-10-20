// Maze chase kit: the reference implementation of KIT_CONTRACT.md.
import { schema, prompt, sample, validate } from './content.js';
import { createGame } from './game.js';
import { createRenderer } from './render.js';
import { verify } from './verify.js';

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
};
