// gameplay.goal: where a level ends: a flag pole, an exit door, a finish line. An entity with a `goal` component
// (true | { id? }) is reached when a reacher's body touches it: `goal_reached` (typed by the goal's id) fires once per
// goal and `onReach` runs (end_game won for a single level, clear_stage for a level of a stage sequence). Goals are
// placed by the level (a generator feature at the end of the last room, a spawner) like any other entity.
//
// Platformer mode (card.mode loop 'platformer'): a side-view level the player runs and jumps through, past pits,
// hazards and enemies, to its goal. The win is reaching the goal (goal_reached, changed by the player's movement).
import { ENTITY_KINDS } from '../../kernel/params.js';
import { boxOf, boxesTouch, isVec } from './items-lib.js';

const KEY = 'gameplay.goal';
/** A goal entity's id: components.goal.id, else its archetype. */
export const goalId = e => (typeof e.components.goal === 'object' && e.components.goal?.id) || e.archetype;

export default {
  id: KEY,
  card: {
    loop: { verbs: [], progress: ['goal_reached'] },
    // Shapes of the archetype components this primitive owns (the planner's schemas and repair read them).
    components: { goal: { type: 'json', effect: 'true, or {id?}: touching this entity reaches the level\'s goal' } },
    // What this primitive needs in the document to be meaningful (planner/content.js reads it).
    content: [
      { need: 'archetypes', component: 'goal', kinds: ['prop'], min: 1, placed: 1, why: 'the level ends where the player reaches an entity with a goal component (a flag pole, an exit door), placed at the far end of the level', example: { id: 'flag', kind: 'prop', components: { goal: true, body: { size: [1, 3] } } } },
    ],
    // Platformer mode: run and jump through a side-view level to its goal, past pits, hazards and enemies. The goal is
    // reached by touch, so the player's movement changes what the win reads; the space must give gravity (jumps and
    // falls), overlap (touching the goal) and pathfind (the level's route).
    mode: { loop: 'platformer', interaction: 'avatar-realtime', opponent: 'hazards', space: ['engine.space.tilemap', ['position', 'gravity', 'overlap', 'pathfind']], needs: { content: ['content.archetypes'], participants: null }, win: { param: 'onReach', reads: { event: 'goal_reached', by: { movement: true } } }, lose: { param: null }, bot: 'platformer' },
    intent: 'Level goals (entities with a `goal` component: a flag pole, an exit door, a finish line): touching one fires goal_reached once and runs onReach, which ends the level (end_game won) or clears a stage of a sequence.',
    views: ['any'],
    params: {
      reachers: { type: 'list', default: ['player'], of: { type: 'string', selects: ENTITY_KINDS }, effect: 'entity ids or archetypes that reach goals by touch' },
      onReach: { type: 'effects', default: [], effect: 'effects when a goal is reached (self = the goal, actor = the reacher)' },
    },
    provides: { events: ['goal_reached', 'goal_reached:*'], services: ['goal'] },
    requires: { capabilities: ['position'] },
    reads: ['content.archetypes'],
  },
  install(rt, config) {
    const st = () => { const s = rt.store(KEY); s.reached ??= {}; return s; };
    st(); // created at install, so reads later never add state
    const reacher = e => config.reachers.includes(e.id) || config.reachers.includes(e.archetype);
    rt.system('interaction', rt => {
      const s = st();
      for (const who of Object.values(rt.state.entities)) {
        if (!reacher(who) || !isVec(who.at) || who.components.health?.dead) continue;
        const wb = boxOf(rt, who);
        for (const g of Object.values(rt.state.entities)) {
          if (g === who || !g.components.goal || g.space !== who.space || !isVec(g.at) || s.reached[g.id] !== undefined) continue;
          if (!boxesTouch(wb, boxOf(rt, g))) continue;
          s.reached[g.id] = rt.state.frame;
          rt.emitTyped('goal_reached', goalId(g), { who: who.id, goal: g.id });
          if (config.onReach.length) rt.run(config.onReach, { self: g.id, actor: who.id });
          if (rt.state.status !== 'playing') return;
        }
      }
    }, KEY);
    rt.provide('goal', { reached: () => Object.keys(st().reached), goals: () => Object.values(rt.state.entities).filter(e => e.components.goal).map(e => e.id) });
  },
};
