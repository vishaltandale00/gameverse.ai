// gameplay.progression.abilities: the ability registry. Abilities are unlocked
// and locked by effects (pickups, bosses, shrines, dialogue), may require a
// predicate, and grant verbs that movement/combat primitives check through the
// `abilities` service or the `grants` predicate (doubleJump, dash, drive...).
const ID = 'gameplay.progression.abilities';
const st = rt => rt.store(ID);
const owned = (rt, who = 'player') => ((st(rt).owned ??= {})[who] ??= {});

export default {
  id: ID,
  card: {
    intent: 'Ability registry: unlockable abilities that grant verbs (double jump, dash, drive...), with optional requirement predicates; the `ability` and `grants` predicates gate plot, portals and movement; unlock_ability/lock_ability effects; a service other primitives query.',
    views: ['any'],
    params: {
      abilities: { type: 'list', default: [], of: { type: 'object', fields: {
        id: { type: 'string', required: true }, name: { type: 'string' }, desc: { type: 'string' },
        grants: { type: 'list', default: [], of: { type: 'string' }, effect: 'verbs this ability enables' },
        requires: { type: 'predicate', effect: 'must hold to unlock (unless forced)' },
        onUnlock: { type: 'effects', default: [] },
      } } },
      start: { type: 'list', default: [], of: { type: 'ref', to: 'ability' }, effect: 'abilities the player starts with' },
      baseVerbs: { type: 'list', default: [], of: { type: 'string' }, effect: 'verbs every entity has without any ability' },
    },
    provides: { events: ['ability_unlocked', 'ability_unlocked:*', 'ability_locked', 'ability_locked:*', 'ability_blocked'], vars: ['ability.*'], services: ['abilities'] },
    defines: [{ kind: 'ability', in: 'abilities' }],
    reads: [],
  },
  logic(logic) {
    logic.predicate('ability', { refs: p => [['ability', p.ability]], test: (p, rt, c) => { const e = rt.resolve(p.who, c); return Boolean(e && owned(rt, e.id)[p.ability]); } });
    logic.predicate('grants', { test: (p, rt, c) => { const e = rt.resolve(p.who, c); return Boolean(e && grants(rt, e.id, p.grants)); } });
    logic.effect('unlock_ability', { refs: e => [['ability', e.ability]], run: (e, rt, c) => { const w = rt.resolve(e.who, c); if (w) unlock(rt, w.id, e.ability, Boolean(e.force)); } });
    logic.effect('lock_ability', { refs: e => [['ability', e.ability]], run: (e, rt, c) => { const w = rt.resolve(e.who, c); if (w) lock(rt, w.id, e.ability); } });
  },
  validate(config) {
    const errors = [], ids = new Set();
    config.abilities.forEach((a, i) => { if (ids.has(a.id)) errors.push({ code: 'ability_duplicate', path: `abilities[${i}].id`, message: `duplicate ability '${a.id}'` }); ids.add(a.id); });
    return errors;
  },
  install(rt, config) {
    rt.caches.abilitiesCfg = config;
    if (!rt.state.frame && !st(rt).started) { st(rt).started = true; for (const id of config.start) owned(rt, 'player')[id] = true; publish(rt); }
    rt.provide('abilities', {
      has: (who, ability) => Boolean(owned(rt, who)[ability]),
      grants: (who, verb) => grants(rt, who, verb),
      verbs: who => verbsOf(rt, who),
      unlock: (who, ability, force = false) => unlock(rt, who, ability, force),
      lock: (who, ability) => lock(rt, who, ability),
      list: () => config.abilities.map(a => ({ id: a.id, name: a.name ?? a.id, desc: a.desc ?? '', grants: a.grants })),
    });
  },
};

const defOf = (rt, id) => rt.caches.abilitiesCfg?.abilities.find(a => a.id === id);
export function verbsOf(rt, who) {
  const cfg = rt.caches.abilitiesCfg, out = new Set(cfg?.baseVerbs || []);
  for (const id of Object.keys(owned(rt, who))) for (const v of defOf(rt, id)?.grants || []) out.add(v);
  return [...out].sort();
}
const grants = (rt, who, verb) => verbsOf(rt, who).includes(verb);
function publish(rt) { for (const a of rt.caches.abilitiesCfg.abilities) rt.state.vars[`ability.${a.id}`] = owned(rt, 'player')[a.id] ? 1 : 0; }
function unlock(rt, who, id, force) {
  const def = defOf(rt, id); if (!def) return false;
  const o = owned(rt, who); if (o[id]) return true;
  if (def.requires && !force && !rt.test(def.requires, { self: who })) { rt.emit('ability_blocked', { who, ability: id }); return false; }
  o[id] = true; publish(rt);
  rt.emitTyped('ability_unlocked', id, { who, ability: id, grants: def.grants });
  rt.run(def.onUnlock || [], { self: who });
  return true;
}
function lock(rt, who, id) {
  const o = owned(rt, who); if (!o[id]) return false;
  delete o[id]; publish(rt);
  rt.emitTyped('ability_locked', id, { who, ability: id });
  return true;
}
