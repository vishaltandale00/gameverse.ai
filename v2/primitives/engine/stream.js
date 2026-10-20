// Region streaming. Regions are the zones of each space (hot-loaded zones
// join on extend). Each evaluation, regions within preloadRadius of the
// player (distance via the space's `nearest`) are queued for loading,
// nearest first, and loaded at most `loadsPerStep` per step; regions beyond
// unloadRadius unload. Loading and unloading are deterministic state
// changes with events (region_loaded:<zone>), so the simulation agrees in
// every host. Heavy work belongs to hooks: simulation hooks (onLoad /
// onUnload) run inside the step; view hooks (meshing, textures, detail
// requests) run in the browser from view.onFrame within budgetMs of wall
// time and never touch rt.state. `active(entity)` lets AI and spawners skip
// entities in unloaded regions.
const ID = 'engine.stream';

export default {
  id: ID,
  card: {
    intent: 'Streams the world by region: loads zones near the player and unloads far ones within a per-step budget, emits region events, runs load/unload hooks (simulation and render-side within a millisecond budget) and takes newly generated zones as they hot-load.',
    views: ['any'],
    params: {
      budgetMs: { type: 'number', default: 6, min: 1, max: 16, unit: 'ms', effect: 'wall-clock budget per frame for render-side hooks (browser only; never affects simulation)' },
      loadsPerStep: { type: 'integer', default: 2, min: 1, max: 64, effect: 'regions loaded or unloaded per step (the simulation budget)' },
      preloadRadius: { type: 'number', default: 128, min: 0, effect: 'regions closer than this (space units) are loaded' },
      unloadRadius: { type: 'number', default: 256, min: 0, effect: 'regions farther than this are unloaded (must be >= preloadRadius)' },
      intervalSec: { type: 'number', default: 0.25, min: 0, max: 10, unit: 's', effect: 'how often distances are re-evaluated' },
      always: { type: 'list', of: { type: 'ref', to: 'zone' }, default: [], effect: 'regions that never unload (hubs)' },
    },
    provides: { events: ['region_loaded', 'region_loaded:*', 'region_unloaded', 'region_unloaded:*'], vars: ['stream.loaded', 'stream.pending'], services: ['stream'] },
    requires: { capabilities: ['position'] },
  },
  logic(logic) {
    logic.predicate('loaded', { refs: p => [['zone', p.loaded]], test: (p, rt) => Boolean(rt.store(ID).loaded?.[p.loaded]) });
  },
  validate(config) {
    return config.unloadRadius < config.preloadRadius ? [{ code: 'stream_radius', path: 'unloadRadius', message: `unloadRadius ${config.unloadRadius} < preloadRadius ${config.preloadRadius}`, hint: 'unload farther out than you preload, or regions flicker' }] : [];
  },
  install(rt, config) {
    const period = Math.max(1, Math.round(config.intervalSec * 60));
    const st = () => { const s = rt.store(ID); s.loaded ??= {}; s.queue ??= []; return s; };
    const regions = () => (rt.doc.spaces || []).flatMap(sp => (sp.zones || []).map(z => ({ space: sp.id, zone: z.id })));
    const sim = { load: [], unload: [] }, view = { load: [], unload: [] }, viewQueue = [];
    const distance = (p, r) => {
      if (!p || p.space !== r.space) return Infinity;
      const api = rt.space(r.space);
      if (api.inZone?.(p, r.zone, rt)) return 0;
      const d = api.nearest?.(p, r.zone, rt); return d === null || d === undefined ? Infinity : d;
    };
    const change = (r, loaded) => {
      const s = st();
      if (loaded) s.loaded[r.zone] = rt.state.frame + 1; else delete s.loaded[r.zone];
      rt.emitTyped(loaded ? 'region_loaded' : 'region_unloaded', r.zone, { zone: r.zone, space: r.space });
      for (const fn of loaded ? sim.load : sim.unload) fn(r, rt);
      if (!rt.headless) viewQueue.push({ r, loaded });
    };
    const api = {
      isLoaded: zone => Boolean(st().loaded[zone]),
      loaded: () => Object.keys(st().loaded).sort(),
      /** Is this entity in a loaded region (or in no region at all)? */
      active: e => !e?.zone || Boolean(st().loaded[e.zone]) || !regions().some(r => r.zone === e.zone),
      /** Ask for a region now (e.g. a quest target): it goes to the front of the queue. */
      request(zone) { const s = st(); if (!s.loaded[zone] && !s.queue.includes(zone)) s.queue.unshift(zone); },
      onLoad: fn => sim.load.push(fn), onUnload: fn => sim.unload.push(fn),
      /** Render-side hooks, run within budgetMs per frame in the browser. */
      onViewLoad: fn => view.load.push(fn), onViewUnload: fn => view.unload.push(fn),
    };
    rt.provide('stream', api);
    rt.system('late', rt => {
      const s = st(), p = rt.player(), all = regions();
      if (rt.state.frame % period === 0) {
        const want = all.map(r => ({ r, d: config.always.includes(r.zone) ? 0 : distance(p, r) })).filter(x => x.d <= config.preloadRadius && !s.loaded[x.r.zone]).sort((a, b) => a.d - b.d || (a.r.zone < b.r.zone ? -1 : 1));
        for (const { r } of want) if (!s.queue.includes(r.zone)) s.queue.push(r.zone);
        let budget = config.loadsPerStep;
        for (const r of all) if (budget > 0 && s.loaded[r.zone] && !config.always.includes(r.zone) && distance(p, r) > config.unloadRadius) { change(r, false); budget--; }
      }
      let budget = config.loadsPerStep;
      while (budget > 0 && s.queue.length) { const zone = s.queue.shift(), r = all.find(x => x.zone === zone); if (r && !s.loaded[zone]) { change(r, true); budget--; } }
      rt.state.vars['stream.loaded'] = Object.keys(s.loaded).length;
      rt.state.vars['stream.pending'] = s.queue.length;
    }, ID);
    rt.onRestore(() => { viewQueue.length = 0; });
    if (!rt.headless && rt.view?.onFrame) rt.view.onFrame(() => {
      const t0 = performance.now();
      while (viewQueue.length && performance.now() - t0 < config.budgetMs) { const { r, loaded } = viewQueue.shift(); for (const fn of loaded ? view.load : view.unload) fn(r); }
    });
  },
  extend(rt, config, added) {
    // Newly generated zones near the player are queued at once (farther ones load when the player comes close).
    const s = rt.store(ID), p = rt.player(); s.queue ??= []; s.loaded ??= {};
    for (const { space, zone } of added.zones || []) {
      if (s.queue.includes(zone) || s.loaded[zone] || !p || p.space !== space) continue;
      const api = rt.space(space), d = api.inZone?.(p, zone, rt) ? 0 : api.nearest?.(p, zone, rt);
      if (d !== null && d !== undefined && d <= config.preloadRadius) s.queue.push(zone);
    }
  },
};
