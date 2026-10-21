// Layer 2 of ARCHITECTURE.md §4: the first playable. No model calls: the outline
// document is preflighted and instantiated headless (spaces and generators run
// procedurally from their params, the player and the first beat come up), so a
// broken install is caught before publishing. A primitive whose install or early
// step throws is identified directly (every install, system, event handler, action
// and option provider is attributed to its primitive), removed with whatever
// requires it, and the references it leaves dangling (story beats using its
// vocabulary...) are neutralised by the deterministic repair, until the world
// boots; it is reported as a gap. An empty cell world gets a fitting generator.
import { preflight } from '../kernel/document.js';
import { createWorld } from '../kernel/world.js';
import { hashOf } from '../server/store.js';
import { repairDocument, instances } from './repair.js';
import { requirementsOf } from './catalog.js';
import { furnishWorld, worldProblems } from './world.js';

export const FIRST_PLAYABLE_VERSION = 'first-playable/0.2';
const PHASE_WORDS = { install: 'while installing', step: 'during a step', event: 'in an event handler', action: 'in an action handler', options: 'while listing options', restore: 'while restoring' };

const tag = (error, id, phase, detail) => {
  const e = error instanceof Error ? error : Object.assign(Error(String(error)), { original: error });
  if (!e.gvPrimitive) { e.gvPrimitive = id; e.gvPhase = phase; if (detail) e.gvDetail = detail; }
  return e;
};
const guard = (fn, owner, phase, detail) => typeof fn !== 'function' || !owner ? fn : function guarded(...args) {
  try { return fn.apply(this, args); } catch (error) { throw tag(error, owner(), phase, detail); }
};

/**
 * A registry view whose primitives' install hooks, and everything they register on rt (systems, event handlers,
 * actions, option providers), attribute errors to the primitive: error.gvPrimitive, error.gvPhase. Boot only.
 */
export function tracingRegistry(registry) {
  const wrapped = new Map();
  const view = Object.create(registry);
  view.get = id => {
    const p = registry.get(id);
    if (!p?.install) return p;
    if (!wrapped.has(id)) wrapped.set(id, { ...p, install(rt, config, instance) {
      patch(rt);
      const outer = rt.__gvOwner; rt.__gvOwner = id;
      try { return p.install.call(p, rt, config, instance); }
      catch (error) { throw tag(error, id, 'install'); }
      finally { rt.__gvOwner = outer; }
    } });
    return wrapped.get(id);
  };
  return view;
}
function patch(rt) {
  if (rt.__gvTraced) return;
  rt.__gvTraced = true;
  const { system, on, action, options, onRestore } = rt;
  // Registrations made outside an install (rare) fall back to the owner argument the kernel already takes.
  rt.system = (phase, fn, owner = '') => { const who = rt.__gvOwner || owner || null; return system.call(rt, phase, guard(fn, who && (() => who), 'step', phase), owner); };
  rt.on = (name, fn) => { const who = rt.__gvOwner || null; return on.call(rt, name, guard(fn, who && (() => who), 'event', name)); };
  rt.action = (name, fn, o) => { const who = rt.__gvOwner || null; return action.call(rt, name, guard(fn, who && (() => who), 'action', name), o); };
  if (typeof options === 'function') rt.options = fn => { const who = rt.__gvOwner || null; return options.call(rt, guard(fn, who && (() => who), 'options')); };
  if (typeof onRestore === 'function') rt.onRestore = fn => { const who = rt.__gvOwner || null; return onRestore.call(rt, guard(fn, who && (() => who), 'restore')); };
}

function boot(doc, registry, logic, seed, frames) {
  const rt = createWorld(doc, tracingRegistry(registry), logic, { seed });
  for (let i = 0; i < frames && rt.state.status === 'playing'; i++) rt.step();
  rt.availableOptions();
  return rt;
}

/** The error a throwing primitive becomes (stable codes install_threw / step_threw), naming the primitive and when it threw. */
export function throwError(error, doc) {
  const id = error?.gvPrimitive || null, phase = error?.gvPhase || null;
  const at = id ? instances(doc).find(x => x.inst.use === id) : null;
  const what = String(error?.message || error).slice(0, 200);
  const when = phase ? `${PHASE_WORDS[phase] || phase}${error.gvDetail ? ` ('${error.gvDetail}')` : ''}` : 'while the world started';
  return {
    code: phase && phase !== 'install' ? 'step_threw' : 'install_threw', path: at ? at.keys.map((k, i) => typeof k === 'number' ? `[${k}]` : `${i ? '.' : ''}${k}`).join('') : '$',
    primitive: id, phase, message: id ? `'${id}' threw ${when}: ${what}` : `the world threw ${when}: ${what}`,
    hint: id ? `configure '${id}' differently (its params or the document data it reads), or leave it out` : 'check the document data the primitives read',
  };
}

/** The document without every instance of these primitives, nor of those that require them. */
function withoutPrimitives(doc, registry, ids) {
  const drop = new Set(ids);
  for (let grew = true; grew;) {
    grew = false;
    for (const x of instances(doc)) if (!drop.has(x.inst.use) && requirementsOf(registry, x.inst.use).primitives.some(r => [...drop].some(d => d === r || d.startsWith(r + '.')))) { drop.add(x.inst.use); grew = true; }
  }
  const out = structuredClone(doc);
  for (const s of out.spaces || []) if (s.generators) s.generators = s.generators.filter(g => !drop.has(g.use));
  for (const k of ['systems', 'graphics']) if (out[k]) out[k] = out[k].filter(x => !drop.has(x.use));
  return { doc: out, dropped: [...drop].filter(id => instances(doc).some(x => x.inst.use === id)) };
}

/** -> { ok, doc, ms, stateHash, start, options, beatsFired, removed, problems, errors, world } */
export function firstPlayable(input, registry, logic, { seed, frames = 3, furnish = true, maxIsolations = 6 } = {}) {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  let doc = input;
  const removed = [], problems = [], excluded = new Set();
  let pre = preflight(doc, registry, logic);
  if (!pre.ok) return { ok: false, errors: pre.errors, problems, removed, ms: elapsed() };
  let rt = null;
  for (let attempt = 0; !rt; attempt++) {
    try { rt = boot(pre.doc, registry, logic, seed, frames); break; }
    catch (error) {
      const err = throwError(error, pre.doc);
      const culprit = err.primitive && registry.has(err.primitive) ? err.primitive : findCulprit(pre.doc, registry, logic, seed, excluded);
      const isSpace = culprit && (doc.spaces || []).some(s => s.use === culprit);
      if (!culprit || isSpace || attempt >= maxIsolations) return { ok: false, errors: [culprit && !err.primitive ? { ...err, primitive: culprit, message: `'${culprit}' made the world throw: ${String(error?.message || error).slice(0, 200)}` } : err], problems, removed, ms: elapsed() };
      // Remove it (and what requires it), then let the deterministic repair neutralise what pointed at it.
      const cut = withoutPrimitives(doc, registry, [culprit]);
      for (const id of cut.dropped) excluded.add(id);
      const why = err.primitive === culprit ? err.message : `made the world throw: ${String(error?.message || error).slice(0, 160)}`;
      for (const id of cut.dropped) removed.push({ use: id, why: id === culprit ? why : `requires '${culprit}', which was removed`, phase: id === culprit ? err.phase : null });
      const fixed = repairDocument(cut.doc, { registry, logic, exclude: excluded });
      for (const r of fixed.removed) if (!removed.some(x => x.use === r.use)) removed.push(r);
      doc = fixed.doc;
      pre = preflight(doc, registry, logic);
      if (!pre.ok) return { ok: false, errors: [{ ...err, message: `${err.message}; removing '${culprit}' left the document invalid` }, ...pre.errors], problems, removed, ms: elapsed() };
    }
  }
  // A cell world the player moves through must not be empty.
  let world = { added: [], problems: [] };
  if (furnish) {
    const f = furnishWorld(doc, registry, logic, { seed, rt });
    if (f.added.length) {
      const p2 = preflight(f.doc, registry, logic);
      try { if (p2.ok) { const rt2 = boot(p2.doc, registry, logic, seed, frames); doc = f.doc; pre = p2; rt = rt2; world = { added: f.added, problems: f.problems }; } }
      catch { /* the furnished world does not boot: keep the empty one, reported below */ }
    }
  }
  const empty = worldProblems(rt, pre.doc, registry);
  problems.push(...empty.map(p => ({ code: p.code, path: p.path, message: p.message, hint: p.hint })));
  // Errors (never published): no player, a game over on its first frames, a player with nothing to do.
  const errors = [];
  const player = rt.player();
  if (doc.player && !player) problems.push({ code: 'no_player', message: 'the player did not spawn' });
  if (rt.state.status !== 'playing') {
    const events = [...new Set(rt.state.events.map(e => e.name).filter(n => !n.includes(':')))].slice(-8);
    errors.push({ code: 'ended_at_start', path: '$', message: `the game ended on its first ${frames} frames (${rt.state.status}${rt.state.ending ? `, ending '${rt.state.ending}'` : ''}) after events ${events.join(', ') || 'none'}`, hint: 'a primitive ends the game at once: its region may be blocked by generated terrain, or a beat ends the game without a trigger' });
  }
  const options = rt.availableOptions().length;
  if (player && rt.state.status === 'playing' && options === 0) problems.push({ code: 'no_options', path: 'player', message: 'the player starts with no options (no way to act or travel)', hint: 'add a movement or interaction primitive the space supports, or start the player where it can move' });
  const fired = Object.keys(rt.store('plot.storyboard').fired || {});
  return {
    ok: problems.every(p => p.code !== 'no_player') && !errors.length, doc: pre.doc, ms: elapsed(), version: FIRST_PLAYABLE_VERSION,
    stateHash: hashOf(rt.snapshot()), start: player ? { space: player.space, at: player.at, zone: player.zone ?? null } : null,
    options, actions: rt.actions(), beatsFired: fired, removed, problems, errors, world,
  };
}

/** No attribution (the kernel itself threw): the first removable instance whose removal (with repair) lets the world boot. */
function findCulprit(doc, registry, logic, seed, excluded) {
  for (const x of instances(doc)) {
    if (x.keys.length === 2 && x.keys[0] === 'spaces') continue;
    const cut = withoutPrimitives(doc, registry, [x.inst.use]);
    const fixed = repairDocument(cut.doc, { registry, logic, exclude: new Set([...excluded, ...cut.dropped]), rounds: 3 });
    if (!fixed.ok) continue;
    try { boot(preflight(fixed.doc, registry, logic).doc, registry, logic, seed, 1); return x.inst.use; } catch { /* not this one */ }
  }
  return null;
}

/**
 * Replay determinism (ARCHITECTURE.md §7): the same document, seed and inputs reach the same
 * state hash. Inputs default to cycling through the options the game itself offers.
 */
export function replayCheck(doc, registry, logic, { seed, steps = 240, runs = 2 } = {}) {
  const hashes = [];
  let script = null;
  for (let r = 0; r < runs; r++) {
    const rt = createWorld(doc, registry, logic, { seed });
    const inputs = [];
    for (let i = 0; i < steps && rt.state.status === 'playing'; i++) {
      let input = script?.[i];
      // Every run observes options at the same steps (as solvers do): reading options should not change state,
      // but a primitive that lazily initializes on first read would otherwise look nondeterministic here.
      if (script && i % 4 === 0) rt.availableOptions();
      // Options may hand out live references (an entity's position); record a copy so the replay gets the same input.
      if (!script) { const opts = i % 4 === 0 ? rt.availableOptions() : []; input = opts.length ? structuredClone({ actions: opts[(i / 4) % opts.length | 0].actions }) : {}; inputs.push(structuredClone(input)); }
      rt.step(structuredClone(input || {}));
    }
    script ??= inputs;
    hashes.push(hashOf(rt.snapshot()));
  }
  return { deterministic: hashes.every(h => h === hashes[0]), hash: hashes[0], runs, steps };
}
