// @ts-check
// Space-agnostic runtime. Holds JSON state and the hooks primitives install:
// phase-ordered systems, event handlers, player actions, spaces (each space
// primitive registers an API implementing the capabilities it provides) and
// per-instance state. The same runtime runs headless (verification) or under
// a renderer (graphics primitives install only when not headless).
import { random, seedFrom } from './rng.js';

/** @typedef {import('./types.js').Runtime} Runtime */
/** @typedef {import('./types.js').State} State */
/** @typedef {import('./types.js').Doc} Doc */
/** @typedef {import('./types.js').Instance} Instance */
/** @typedef {import('./types.js').View} View */
/** @typedef {import('./types.js').SpaceApi} SpaceApi */
/** @typedef {import('./types.js').Option} Option */
/** @typedef {import('./types.js').RegistryLike} RegistryLike */
/** @typedef {import('./types.js').LogicLike} LogicLike */

export const PHASES = ['input', 'ai', 'movement', 'physics', 'interaction', 'rules', 'plot', 'late'];
export const KERNEL_EVENTS = ['game_start', 'game_end', 'spawn', 'despawn', 'action', 'content_added', 'space_changed'];
export const DT = 1 / 60;

/**
 * @template {LogicLike} L
 * @param {RegistryLike} registry @param {new () => L} Logic @returns {L}
 */
export function buildLogic(registry, Logic) {
  const logic = new Logic();
  // Real owners first; ambient providers (stand-ins, pure vocabulary libraries) only fill kinds nobody owns.
  const ids = registry.ids(), ambient = (/** @type {string} */ id) => Boolean(/** @type {import('./types.js').RegisteredPrimitive} */ (registry.get(id)).card.ambient);
  for (const id of [...ids.filter(i => !ambient(i)), ...ids.filter(ambient)]) { logic.owner = id; logic.ambient = ambient(id); /** @type {import('./types.js').RegisteredPrimitive} */ (registry.get(id)).logic?.(logic); }
  logic.owner = null; logic.ambient = false;
  // One owner per vocabulary kind: a silent overwrite would change behavior by load order.
  if (logic.duplicates.length) throw Error(`vocabulary registered twice: ${logic.duplicates.map(d => `${d.type} '${d.kind}' by ${d.first} and ${d.second}`).join('; ')}`);
  return logic;
}

/**
 * The part of a step's input a modal lets through: its actions, held verbs and axes named in `allowed`.
 * @param {any} input @param {string[]} allowed @returns {any}
 */
function modalInput(input, allowed) {
  const only = (/** @type {Record<string, any> | undefined} */ rec) => Object.fromEntries(Object.entries(rec || {}).filter(([k]) => allowed.includes(k)));
  return { ...input, actions: only(input.actions), held: only(input.held), axes: only(input.axes) };
}

/** doc must be the normalized document returned by preflight(). */
/**
 * view (browser only, when headless is false) is supplied by the host page:
 *   { container: HTMLElement, act(actions), onFrame(fn(alpha)), input?() }
 * Graphics primitives render into view.container, register per-frame draws
 * with view.onFrame, and send player choices through view.act({ name: value }).
 */
/**
 * @param {Doc} source @param {RegistryLike} registry @param {LogicLike} logic
 * @param {{ seed?: unknown, headless?: boolean, view?: View | null }} [opts]
 * @returns {Runtime}
 */
export function createWorld(source, registry, logic, { seed, headless = true, view = null } = {}) {
  // Each world owns its document: a primitive that sets params at run time (stage tables) changes this world's
  // document only, never another world made from the same document (the gate's bots make many).
  const doc = structuredClone(source);
  /** @type {State} */
  const state = {
    schema: 'gameverse.v2.state/0.1', docId: doc.id, frame: 0, time: 0, status: 'playing', ending: null,
    rng: seedFrom(seed ?? doc.seed ?? doc.id), modal: null, vars: {}, flags: {}, counts: {}, events: [],
    entities: {}, nextId: 1, spaces: {}, prim: {},
  };
  const deferred = /** @type {Array<(rt: Runtime) => void>} */ ([]), installed = /** @type {Set<string>} */ (new Set());
  const ownerInstalled = (/** @type {string | undefined} */ owner) => !owner || owner === 'kernel' || installed.has(owner) || Boolean(registry.get(owner)?.card.ambient);
  const systems = /** @type {Array<{ p: number, order: number, fn: (rt: Runtime) => void, owner: string }>} */ ([]), handlers = /** @type {Map<string, Array<(data: any, rt: Runtime) => void>>} */ (new Map()),
    actions = /** @type {Map<string, (value: any, rt: Runtime) => void>} */ (new Map()), spaces = /** @type {Map<string, SpaceApi>} */ (new Map()), services = /** @type {Map<string, any>} */ (new Map()),
    restorers = /** @type {Array<(rt: Runtime) => void>} */ ([]), optionProviders = /** @type {Array<(rt: Runtime) => Option[]>} */ ([]);
  let order = 0, reading = 0;
  // A read (listing options, a host drawing a frame, a UI handling a key) never changes state: while one runs, a store
  // nobody created yet reads as a fresh empty object instead of being created. Lazily initialised state is then made
  // by the steps alone, at the same moment in every host, however often presentation and bots read.
  /** @template T @param {() => T} fn @returns {T} */
  // Randomness a read draws is given back (the rng is restored), so a read never shifts what the steps draw.
  const read = fn => { const rng = state.rng; reading++; try { return fn(); } finally { reading--; state.rng = rng; } };
  const listing = read;

  /** @type {Runtime} */
  const rt = {
    doc, registry, logic, headless, view, dt: DT, input: {}, caches: {},
    get state() { return state; },
    random: () => random(state),
    emit(name, data = {}) {
      state.counts[name] = (state.counts[name] || 0) + 1;
      state.events.push({ name, ...data });
      for (const h of handlers.get(name) || []) h(data, rt);
      for (const h of handlers.get('*') || []) h({ name, ...data }, rt);
    },
    /** Emit `name` with subject, then the qualified `name:<subject>` (counts and objectives address it). */
    emitTyped(name, subject, data = {}) { rt.emit(name, { ...data, subject }); if (subject != null) rt.emit(`${name}:${subject}`, data); },
    on(name, fn) { if (!handlers.has(name)) handlers.set(name, []); /** @type {Array<(data: any, rt: Runtime) => void>} */ (handlers.get(name)).push(fn); },
    system(phase, fn, owner = '') {
      const p = PHASES.indexOf(phase);
      if (p < 0) throw Error(`unknown phase '${phase}' from ${owner}`);
      systems.push({ p, order: order++, fn, owner });
      systems.sort((a, b) => a.p - b.p || a.order - b.order);
    },
    /** Register a player verb. { ifAbsent: true } keeps an existing registration (shared verbs like `interact`). */
    action(name, fn, { ifAbsent = false } = {}) { if (ifAbsent && actions.has(name)) return false; actions.set(name, fn); return true; },
    /** Run fn(rt) at the end of the current step, after every system (state-replacing effects such as load_game). */
    defer(fn) { deferred.push(fn); },
    /**
     * Modal input: while a modal is open (dialogue, menu, battle prompt), only its `actions` are dispatched and
     * only options that use them are offered. State lives in state.modal so snapshots keep it.
     */
    openModal(owner, { actions: allowed = [], kind = owner } = {}) { state.modal = { owner, kind, actions: [...allowed] }; rt.emit('modal_open', { owner, kind }); },
    closeModal(owner) { if (state.modal && (!owner || state.modal.owner === owner)) { const m = state.modal; state.modal = null; rt.emit('modal_close', { owner: m.owner, kind: m.kind }); } },
    get modal() { return state.modal || null; },
    /**
     * Hold the systems registered by `owners` (their rt.system owner, usually the primitive id) until release(by):
     * a nested loop holds the outer loop while it runs. Event handlers and actions are not held. Kept in
     * state.held (only while something is held), so snapshots and replays keep it.
     */
    hold(by, owners) { (state.held ??= {})[by] = [...new Set(owners)]; },
    release(by) { if (!state.held) return; delete state.held[by]; if (!Object.keys(state.held).length) delete state.held; },
    /** Capabilities a space instance reports (same as preflight's). */
    /** True when the document installed this primitive (directly, as a space/generator, or as graphics). */
    has: id => installed.has(id),
    /** Whether an effect/predicate kind can run in THIS world: registered, and its owner is installed (or the kernel). */
    canRun: kind => logic.effects.has(kind) && ownerInstalled(logic.owners.effect.get(kind)),
    canTest: kind => logic.predicates.has(kind) && ownerInstalled(logic.owners.predicate.get(kind)),
    capabilities(spaceId = doc.spaces?.[0]?.id) {
      const s = rt.doc.spaces.find(x => x.id === spaceId); const p = s && registry.get(s.use);
      return p ? (p.capabilities ? p.capabilities(s.with || {}) : p.card.provides.capabilities || []) : [];
    },
    /** Register fn(rt) -> [{ label, actions: { name: value }, steps? }] of meaningful player choices now.
     *  Used by solvers and playtesters; continuous spaces offer macro options (travel to a zone). */
    options(fn) { optionProviders.push(fn); },
    /** Options from every provider except `skip` (lets a provider defer to others without recursing). */
    optionsExcept(skip) { return listing(() => optionProviders.filter(fn => fn !== skip).flatMap(fn => fn(rt) || [])); },
    /** Run fn as a read: stores it touches are not created (presentation, bots and tests reading the world). */
    read,
    availableOptions() {
      const all = listing(() => optionProviders.flatMap(fn => fn(rt) || [])), m = state.modal;
      return m ? all.filter(o => o.modal === m.owner || Object.keys(o.actions || {}).some(a => m.actions.includes(a))) : all;
    },
    actions: () => [...actions.keys()],
    /** Named services shared between primitives (roadgraph, surface, biomeAt...). Declared in card.provides.services. */
    provide(name, api) { services.set(name, api); },
    service(name) { const s = services.get(name); if (!s) throw Error(`no service '${name}'`); return s; },
    hasService: name => services.has(name),
    spaces: () => [...spaces.keys()],
    defineSpace(id, api) { spaces.set(id, api); state.spaces[id] ??= {}; },
    space(id = doc.spaces?.[0]?.id) { const s = spaces.get(id); if (!s) throw Error(`no space '${id}'`); return s; },
    onRestore(fn) { restorers.push(fn); },
    /** Per-instance JSON state: rt.store('gameplay.inventory') -> object kept in snapshots.
     *  Fetch it inside each system/handler call; never cache it at install (restore() replaces it).
     *  Inside an option provider an absent store is not created (a fresh empty object is returned). */
    store(key) { return state.prim[key] ?? (reading ? {} : (state.prim[key] = {})); },
    archetype(id) { return doc.content?.archetypes?.find((/** @type {any} */ a) => a.id === id); },
    spawn(archetype, { space, at, components = {}, id } = {}) {
      const base = rt.archetype(archetype)?.components || {};
      const entity = { id: id || `e${state.nextId++}`, archetype, space: space ?? doc.spaces?.[0]?.id ?? null, at: at ?? null, components: { ...structuredClone(base), ...components } };
      state.entities[entity.id] = entity;
      if (entity.space && spaces.get(entity.space)?.place) /** @type {SpaceApi} */ (spaces.get(entity.space)).place(entity, rt);
      rt.emit('spawn', { id: entity.id, archetype });
      return entity;
    },
    despawn(id) {
      const e = state.entities[id]; if (!e) return;
      if (e.space && spaces.get(e.space)?.remove) /** @type {SpaceApi} */ (spaces.get(e.space)).remove(e, rt);
      delete state.entities[id]; rt.emit('despawn', { id, archetype: e.archetype });
    },
    entity: id => state.entities[id],
    /** who: undefined|'player' -> player; 'self' -> context.self; else an entity id (characters spawn with their id). */
    resolve(who, context = {}) {
      if ((who === undefined || who === null) && context.defaultWho) who = context.defaultWho; // e.g. AI rules: subject is the agent
      if (who === undefined || who === null || who === 'player') return state.entities.player || null;
      if (who === 'self') return state.entities[/** @type {string} */ (context.self)] || null;
      return state.entities[/** @type {string} */ (who)] || null;
    },
    /** Move an entity into another space (portals, interiors, battle screens). */
    moveToSpace(entity, spaceId, at = null, zone = undefined) {
      const from = entity.space;
      if (from && spaces.get(from)?.remove) /** @type {SpaceApi} */ (spaces.get(from)).remove(entity, rt);
      entity.space = spaceId; entity.at = at;
      const api = rt.space(spaceId);
      api.place(entity, rt);
      if (zone || at) api.teleport(entity, { zone, at }, rt);
      rt.emit('space_changed', { who: entity.id, from, to: spaceId });
    },
    player: () => state.entities.player || null,
    query: (...components) => Object.values(state.entities).filter(e => components.every(c => c in e.components)),
    test: (predicate, context) => logic.test(predicate, rt, context),
    run: (effects, context) => logic.run(effects, rt, context),
    /** Advance one fixed step. input = { actions: { name: value }, axes: {...} }. */
    step(input = {}) {
      if (state.status !== 'playing') return state;
      // While a modal is open, the step's input is only its actions (as actions, held verbs or axes): every host
      // and every system sees the same input, so headless verification and the browser agree.
      state.events = []; rt.input = state.modal ? modalInput(input, state.modal.actions) : input;
      for (const [name, value] of Object.entries(rt.input.actions || {})) {
        if (value === undefined || value === null || value === false) continue; // 0 and '' are real choices
        if (state.modal && !state.modal.actions.includes(name)) continue; // a modal an earlier action opened
        const fn = actions.get(name);
        if (fn) { fn(value, rt); rt.emit('action', { action: name }); }
      }
      const held = state.held ? new Set(Object.values(state.held).flat()) : null;
      for (const s of systems) { if (held?.has(s.owner)) continue; s.fn(rt); if (state.status !== 'playing') break; }
      while (deferred.length) /** @type {(rt: Runtime) => void} */ (deferred.shift())(rt);
      state.frame++; state.time = +(state.frame * DT).toFixed(6);
      return state;
    },
    /**
     * Hot-load generated content into the running game. `normalizedDoc` is the
     * preflighted merge (document.js mergePatch + preflight); `added` comes from
     * mergePatch. New primitive instances are installed. Existing primitives
     * should read document data lazily from rt.doc (re-index when rt.doc
     * changes); those that keep derived caches implement extend(rt, cfg, added).
     */
    extend(source, added) {
      const normalizedDoc = structuredClone(source); // this world's own copy, as at creation
      const before = { systems: (rt.doc.systems || []).length, graphics: (rt.doc.graphics || []).length, spaces: new Set((rt.doc.spaces || []).map(s => s.id)),
        generators: new Map((rt.doc.spaces || []).map(s => [s.id, (s.generators || []).length])) };
      rt.doc = normalizedDoc;
      for (const s of normalizedDoc.spaces) {
        if (!before.spaces.has(s.id)) install(s, `spaces.${s.id}`);
        // New generators run on new spaces and on existing ones (detail patches add rooms, structures, scatter...).
        (s.generators || []).forEach((g, j) => { if (j >= (before.generators.get(s.id) ?? 0)) install({ ...g, space: s.id }, `spaces.${s.id}.generators[${j}]`); });
      }
      for (const instance of [...normalizedDoc.spaces, ...(normalizedDoc.systems || []).slice(0, before.systems), ...(headless ? [] : (normalizedDoc.graphics || []).slice(0, before.graphics))]) {
        registry.get(instance.use)?.extend?.(rt, instance.with || {}, added, instance);
      }
      (normalizedDoc.systems || []).slice(before.systems).forEach((s, i) => install(s, `systems[${before.systems + i}]`));
      (normalizedDoc.graphics || []).slice(before.graphics).forEach((g, i) => install(g, `graphics[${before.graphics + i}]`));
      rt.emit('content_added', { zones: added.zones.length, beats: added.beats.length, systems: added.systems.length });
    },
    snapshot: () => structuredClone(state),
    restore(snapshot) {
      for (const k of Object.keys(state)) delete /** @type {Record<string, any>} */ (state)[k];
      Object.assign(state, structuredClone(snapshot));
      for (const fn of restorers) fn(rt);
    },
  };

  /** @param {Instance} instance @param {string} key */
  const install = (instance, key) => {
    const p = registry.get(instance.use);
    if (p && !(p.family === 'graphics' && headless)) installed.add(p.id);
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
