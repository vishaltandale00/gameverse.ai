// Fighting kit: 2D one-on-one fighting with frame data, motion-input specials, blocking,
// throws, supers, combos and rounds, an arcade ladder with a boss, and a Smash-style platform
// mode. See v2/kits/KIT_CONTRACT.md for the shape.
import { schema, prompt, sample, validate } from './content.js';
import { createGame } from './sim.js';
import { createRenderer } from './render.js';
import { verify } from './verify.js';
import { world } from './world.js';

function cast(content) {
  const ids = content.fighters.map(f => f.id), boss = content.fighters.find(f => f.id === content.boss.fighter) || content.fighters[content.fighters.length - 1];
  const hero = content.fighters.find(f => f.id !== boss.id) || content.fighters[0];
  const stage = content.stages.find(s => s.id === content.boss.stage) || content.stages[0];
  return {
    brief: {
      player: { name: hero.name }, enemy: { name: boss.name },
      pickup: { name: 'Super meter spark' }, hazard: { name: 'Energy blast' }, goal: { name: 'Champion trophy' },
    },
    entities: { [hero.id]: { tags: ['player'] }, [boss.id === hero.id ? `${boss.id}-boss` : boss.id]: { tags: ['enemy'] }, trophy: { tags: ['goal'] } },
    stage: stage?.theme, roster: ids,
  };
}

export default {
  id: 'fighting',
  name: 'Fighting',
  version: '0.1.0',
  summary: 'One-on-one fighting: frame data, hitboxes, motion-input specials, blocking high and low, throws, supers, combos, best-of-3 rounds, an arcade ladder and CPU rivals; plus a platform-fighter mode with percent and ring-outs.',
  examples: ['Street Fighter II', 'Street Fighter IV', 'Mortal Kombat II', 'King of Fighters', 'Darkstalkers', 'Super Smash Bros.'],
  content: { schema, prompt, sample },
  validate,
  cast,
  createGame,
  createRenderer,
  verify,
  // What cross-genre mods (v2/kits/mods) can see and do in this world; see world.js.
  world,
  controls: [
    { input: 'move', label: 'Walk, jump, crouch; hold back to block' },
    { input: 'a', label: 'Punch (A+B close: throw)' },
    { input: 'b', label: 'Kick' },
  ],
  goal: content => content.mode === 'platform'
    ? 'Knock your rival off the stage. Damage raises their percent; higher percent flies farther.'
    : 'Win two rounds per match and climb the ladder. Motions like down, down-forward, forward + punch fire specials.',
  stats: state => [['Max combo', String(state.stats?.maxCombo || 0)], ['Rounds', String(state.stats?.rounds || 0)], ['Perfects', String(state.stats?.perfects || 0)]],
};
