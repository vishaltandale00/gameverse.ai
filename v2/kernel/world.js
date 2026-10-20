// Space-agnostic runtime. Holds JSON state and the hooks primitives install:
// phase-ordered systems, event handlers, player actions, spaces (each space
// primitive registers an API implementing the capabilities it provides) and
// per-instance state. The same runtime runs headless (verification) or under
// a renderer (graphics primitives install only when not headless).
import { random, seedFrom } from './rng.js';

export const PHASES = ['input', 'ai', 'movement', 'physics', 'interaction', 'rules', 'plot', 'late'];
export const KERNEL_EVENTS = ['game_start', 'game_end', 'spawn', 'despawn', 'action'];
export const DT = 1 / 60;

export function buildLogic(registry, Logic) {
  const logic = new Logic();
  for (const id of registry.ids()) registry.get(id).logic?.(logic);
  return logic;
}

/** doc must be the normalized document returned by preflight(). */
export function createWorld(doc, registry, logic, { seed, headless = true } = {}) {
  const state = {
    schema: 'gameverse.v2.state/0.1', docId: doc.id, frame: 0, time: 0, status: 'playing', ending: null,
    rng: seedFrom(seed ?? doc.seed ?? doc.id), vars: {}, flags: {}, counts: {}, events: [],
    entities: {}, nextId: 1, spaces: {}, prim: {},
  };
  const systems = [], handlers = new Map(), actions = new Map(), spaces = new Map(), restorers = [];
  let order = 0;

  const rt = {
    doc, registry, logic, headless, dt: DT, input: {}, caches: {},
    get state() { return state; },
    random: () => random(state),
    emit(name, data = {}) {
      state.counts[name] = (state.counts[name] || 0) + 1;
      state.events.push({ name, ...data });
      for (const h of handlers.get(name) || []) h(data, rt);
      for (const h of handlers.get('*') || []) h({ name, ...data }, rt);
    },
    on(name, fn) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(fn); },
    system(phase, fn, owner = '') {
      const p = PHASES.indexOf(phase);
      if (p < 0) throw Error(`unknown phase '${phase}' from ${owner}`);
      systems.push({ p, order: order++, fn, owner });
      systems.sort((a, b) => a.p - b.p || a.order - b.order);
    },
    action(name, fn) { actions.set(name, fn); },
    actions: () => [...actions.keys()],
    defineSpace(id, api) { spaces.set(id, api); state.spaces[id] ??= {}; },
    space(id = doc.spaces?.[0]?.id) { const s = spaces.get(id); if (!s) throw Error(`no space '${id}'`); return s; },
    onRestore(fn) { restorers.push(fn); },
    /** Per-instance JSON state: rt.store('gameplay.inventory') -> object kept in snapshots.
     *  Fetch it inside each system/handler call; never cache it at install (restore() replaces it). */
    store(key) { return (state.prim[key] ??= {}); },
    archetype(id) { return doc.content?.archetypes?.find(a => a.id === id); },
    spawn(archetype, { space, at, components = {}, id } = {}) {
      const base = rt.archetype(archetype)?.components || {};
      const entity = { id: id || `e${state.nextId++}`, archetype, space: space ?? doc.spaces?.[0]?.id ?? null, at: at ?? null, components: { ...structuredClone(base), ...components } };
      state.entities[entity.id] = entity;
      if (entity.space && spaces.get(entity.space)?.place) spaces.get(entity.space).place(entity, rt);
      rt.emit('spawn', { id: entity.id, archetype });
      return entity;
    },
    despawn(id) {
      const e = state.entities[id]; if (!e) return;
      if (e.space && spaces.get(e.space)?.remove) spaces.get(e.space).remove(e, rt);
      delete state.entities[id]; rt.emit('despawn', { id, archetype: e.archetype });
    },
    entity: id => state.entities[id],
    player: () => state.entities.player || null,
    query: (...components) => Object.values(state.entities).filter(e => components.every(c => c in e.components)),
    test: predicate => logic.test(predicate, rt),
    run: (effects, context) => logic.run(effects, rt, context),
    /** Advance one fixed step. input = { actions: { name: value }, axes: {...} }. */
    step(input = {}) {
      if (state.status !== 'playing') return state;
      state.events = []; rt.input = input;
      for (const [name, value] of Object.entries(input.actions || {})) {
        if (!value) continue;
        const fn = actions.get(name);
        if (fn) { fn(value, rt); rt.emit('action', { action: name }); }
      }
      for (const s of systems) { s.fn(rt); if (state.status !== 'playing') break; }
      state.frame++; state.time = +(state.frame * DT).toFixed(6);
      return state;
    },
    snapshot: () => structuredClone(state),
    restore(snapshot) {
      for (const k of Object.keys(state)) delete state[k];
      Object.assign(state, structuredClone(snapshot));
      for (const fn of restorers) fn(rt);
    },
  };

  const install = (instance, key) => {
    const p = registry.get(instance.use);
    if (!p?.install || (p.family === 'graphics' && headless)) return;
    p.install(rt, instance.with || {}, { key, ...instance });
  };
  // Spaces first (with their generators), then systems in document order, then graphics.
  (doc.spaces || []).forEach((s, i) => {
    install(s, `spaces.${s.id}`);
    (s.generators || []).forEach((g, j) => install({ ...g, space: s.id }, `spaces.${s.id}.generators[${j}]`));
  });
  (doc.systems || []).forEach((s, i) => install(s, `systems[${i}]`));
  (doc.graphics || []).forEach((g, i) => install(g, `graphics[${i}]`));
  if (doc.player) rt.spawn(doc.player.archetype, { id: 'player', space: doc.player.space, at: doc.player.at, components: doc.player.components || {} });
  rt.emit('game_start');
  return rt;
}
