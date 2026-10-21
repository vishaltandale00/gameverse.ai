// Checkpoints: benches, bonfires, flags and spawn points. An entity with a
// `checkpoint` component ({ id?, touch?, name? }; card.components) activates when used
// through gameplay.interact or, with touch, when the player overlaps it. The
// active point is where respawn_at_checkpoint (hazards, death rules) returns an
// entity; activated points can be fast-travelled between.
import { restoreAll, runIf, whoKey, pos, boxOf, boxesTouch, isVec, dist } from './items-lib.js';

const KEY = 'gameplay.checkpoint';
const AUTO_ID = /^e\d+$/;
export const checkpointId = e => (typeof e.components.checkpoint === 'object' && e.components.checkpoint.id) || (AUTO_ID.test(e.id) ? e.archetype : e.id);
const st = rt => { const s = rt.store(KEY); s.point ??= {}; s.active ??= {}; s.start ??= {}; return s; };

/** Return an entity to its checkpoint (or its start); returns whether it moved. */
export function respawn(rt, who) {
  const e = rt.entity(who); if (!e) return false;
  const s = st(rt), p = s.point[who] ?? s.start[who]; if (!p) return false;
  if (p.space !== e.space) rt.moveToSpace(e, p.space, structuredClone(p.at));
  else rt.space(e.space).setPos(e, structuredClone(p.at), rt);
  if (Array.isArray(e.components.body?.vel)) e.components.body.vel = e.components.body.vel.map(() => 0);
  rt.emit('respawned', { who, checkpoint: p.id ?? null });
  return true;
}

export default {
  id: 'gameplay.checkpoint',
  card: {
    // fast_travel exists only when the instance turns it on (fastTravelBetween).
    loop: { verbs: ['fast_travel'], verbsOf: config => (config.fastTravelBetween ? ['fast_travel'] : []), progress: ['checkpoint_set'] },
    // Verbs whose action takes a chosen value (card.actionSpace 'choice'): a UI control issues them (graphics.ui.*, card.controls).
    actionSpace: { fast_travel: { type: 'choice', of: 'an active checkpoint', from: 'options', emits: ['fast_traveled'] } },
    // What this primitive needs in the document to be meaningful (planner/content.js reads it).
    content: [
      {"need": "archetypes", "component": "checkpoint", "min": 1, "placed": 1, "why": "checkpoints are entities with a checkpoint component, placed along the way", "example": {"id": "bench", "kind": "prop", "components": {"interact": {"prompt": "Rest", "range": 1.6}, "checkpoint": {}}}},
    ],
    intent: 'Bench/bonfire/flag checkpoints (entities with a `checkpoint` component): set the respawn point, optionally restore health and resources, reset ambient enemies, and fast-travel between activated points.',
    views: ['any'],
    params: {
      restoreAll: { type: 'boolean', default: false, effect: 'activating heals fully and refills resource pools' },
      respawnEnemies: { type: 'boolean', default: false, effect: 'activating emits respawn_enemies (spawners reset ambient enemies)' },
      fastTravelBetween: { type: 'boolean', default: false, effect: 'action fast_travel moves the player to any activated checkpoint' },
      touch: { type: 'boolean', default: false, effect: 'checkpoints activate when the player overlaps them (components.checkpoint.touch overrides)' },
      save: { type: 'boolean', default: true, effect: 'activating also runs save_game when engine.save registers it' },
    },
    // Events it emits when it refuses a player's verb, with a reason (graphics.ui.hud says why).
    denials: ['fast_travel_denied'],
    provides: { events: ['fast_travel_denied', 'checkpoint_set', 'checkpoint_set:*', 'respawned', 'respawn_enemies', 'fast_traveled'], actions: ['fast_travel'], services: ['checkpoint'] },
    requires: { capabilities: ['position'] },
    reads: ['content.archetypes'],
    // Shapes of the archetype components this primitive owns (the planner's schemas and repair read them).
    components: { checkpoint: { type: 'object', fields: {
      id: { type: 'string', effect: 'the checkpoint id (checkpoint_set:<id>, fast travel); default: the entity id, else its archetype' },
      touch: { type: 'boolean', effect: 'activates when the player overlaps it (overrides the touch param)' },
      name: { type: 'string', display: true, effect: 'the name a person reads' },
    }, effect: 'a respawn point the player activates by using or touching it' } },
  },
  logic(logic) {
    logic.predicate('at_checkpoint', { test: (p, rt, c) => { const id = st(rt).point[whoKey(p.who, c)]?.id; return p.at_checkpoint === true ? Boolean(id) : id === p.at_checkpoint; } });
    logic.effect('activate_checkpoint', {
      check: (e, path, errors) => { if (!e.checkpoint) errors.push({ code: 'effect_invalid', path, message: 'activate_checkpoint needs a checkpoint id' }); },
      run: (e, rt, c) => rt.caches.checkpointActivate?.(whoKey(e.who, c), e.checkpoint, null),
    });
    logic.effect('respawn_at_checkpoint', { run: (e, rt, c) => { respawn(rt, whoKey(e.who, c)); } });
  },
  install(rt, config) {
    st(rt); // created at install, so reads later never add state
    function activate(who, id, entity) {
      const s = st(rt), actor = rt.entity(who); if (!actor) return;
      const at = entity && isVec(pos(rt, actor)) ? structuredClone(pos(rt, actor)) : structuredClone(entity ? pos(rt, entity) : pos(rt, actor));
      const point = { id, space: actor.space, at, zone: actor.zone ?? null };
      s.point[who] = point; s.active[id] = point;
      if (config.restoreAll) restoreAll(rt, who);
      if (config.respawnEnemies) rt.emit('respawn_enemies', { reason: 'checkpoint', checkpoint: id });
      if (config.save) runIf(rt, { do: 'save_game' });
      rt.emitTyped('checkpoint_set', id, { who, checkpoint: id });
    }
    rt.caches.checkpointActivate = activate;
    rt.on('spawn', ({ id }) => { const e = rt.entity(id); if (e && e.id === 'player' && !st(rt).start.player) st(rt).start.player = { id: null, space: e.space, at: structuredClone(e.at), zone: e.zone ?? null }; });
    rt.on('interacted', d => { const t = rt.entity(d.target); if (t?.components.checkpoint) activate(d.who, checkpointId(t), t); });
    rt.system('interaction', rt => {
      const p = rt.player(); if (!p || !isVec(p.at)) return;
      for (const e of Object.values(rt.state.entities)) {
        const c = e.components.checkpoint; if (!c || e.space !== p.space) continue;
        if (!(c.touch ?? config.touch)) continue;
        const id = checkpointId(e); if (st(rt).point.player?.id === id) continue;
        if (boxesTouch(boxOf(rt, p), boxOf(rt, e)) || dist(rt, p, e) < 0.5) activate('player', id, e);
      }
    }, KEY);
    if (config.fastTravelBetween) {
      rt.action('fast_travel', (id, rt) => {
        const p = rt.player(), to = st(rt).active[id]; if (!p || !to) { rt.emit('fast_travel_denied', { checkpoint: id }); return; }
        if (to.space !== p.space) rt.moveToSpace(p, to.space, structuredClone(to.at)); else rt.space(p.space).setPos(p, structuredClone(to.at), rt);
        st(rt).point.player = to; rt.emit('fast_traveled', { who: 'player', checkpoint: id });
      });
      rt.options(rt => Object.keys(st(rt).active).filter(id => id !== st(rt).point.player?.id).sort().map(id => ({ label: `fast travel ${id}`, actions: { fast_travel: id } })));
    }
    rt.provide('checkpoint', { point: (who = 'player') => st(rt).point[who] ?? null, activated: () => Object.keys(st(rt).active), respawn: who => respawn(rt, who), activate: (who, id) => activate(who, id, null) });
  },
};
