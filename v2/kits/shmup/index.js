// Shoot 'em up kit (see ../KIT_CONTRACT.md): fixed-formation, vertical-scroller,
// twin-stick arena and asteroids stages over one ship, weapon, scoring and boss system.
import { SCHEMA, PROMPT, SAMPLE, validate } from './content.js';
import { createGame } from './game.js';
import { createRenderer } from './render.js';
import { verify } from './verify.js';

function cast(content) {
  const firstBoss = content.bosses?.[0];
  const firstEnemy = content.stages?.[0]?.waves?.[0]?.enemy;
  const foe = content.enemies?.find(e => e.id === firstEnemy) || content.enemies?.[0];
  return {
    brief: {
      player: { name: content.player?.name || 'Pilot' },
      enemy: { name: firstBoss?.name || foe?.name || 'Swarm' },
      pickup: { name: 'Power core' },
      hazard: { name: 'Enemy fire' },
      goal: { name: firstBoss ? `${firstBoss.name}'s core` : 'Stage clear beacon' },
    },
    // The renderer reads art.frames.player (pilot portrait) and art.frames.enemy (foe portrait).
    entities: { player: { tags: ['player'] }, enemy: { tags: ['enemy'] }, powerup: { tags: ['collectible'] }, bullet: { tags: ['hazard'] }, goal: { tags: ['goal'] } },
  };
}

export default {
  id: 'shmup',
  name: "Shoot 'em up",
  version: '0.1.0',
  summary: 'Formation dive-bombers, vertical scrollers, twin-stick swarms and asteroid fields: power-up tiers, bombs, chains, bosses with phased bullet patterns.',
  examples: ['Space Invaders', 'Galaga', 'Galaxian', 'Asteroids', 'Centipede', 'Geometry Wars', 'Ikaruga', '1942'],
  content: { schema: SCHEMA, prompt: PROMPT, sample: SAMPLE },
  validate,
  cast,
  createGame,
  createRenderer,
  verify,
  controls: [{ input: 'move', label: 'Move (asteroids: rotate, thrust, hyperspace)' }, { input: 'a', label: 'Fire' }, { input: 'b', label: 'Bomb' }],
  goal: content => `Survive ${content.stages.length} stage${content.stages.length === 1 ? '' : 's'}${content.endless ? ' and keep looping' : ''}: shoot everything, grab power-ups, and bomb out of trouble.`,
  stats: state => [['Stage', `${state.stage + 1}${state.loop ? ` (loop ${state.loop + 1})` : ''}`], ['Kills', String(state.stats.kills)], ['Best chain', String(state.bestChain)]],
};
