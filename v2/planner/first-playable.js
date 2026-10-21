// @ts-check
// Layer 2 of ARCHITECTURE.md §4: the first playable. No model calls: the outline
// document is preflighted and instantiated headless (spaces and generators run
// procedurally from their params, the player and the first beat come up), so a
// broken install is caught before publishing. A primitive whose install or early
// step throws is identified directly (every install, system, event handler, action
// and option provider is attributed to its primitive) and reported as an error naming
// it (install or step), for the model or the planner to fix: nothing is removed. Only
// a caller that explicitly asks (maxIsolations > 0) gets the experimental removal of
// the thrower with what requires it. An empty cell world gets a fitting generator.
import { preflight } from '../kernel/document.js';
import { createWorld } from '../kernel/world.js';
import { hashOf } from '../server/store.js';
import { repairDocument, instances } from './repair.js';
import { requirementsOf } from './catalog.js';
import { furnishWorld, worldProblems } from './world.js';
import { hostDocument } from '../web/host-doc.js';
import { isList, isStr, obj, objects, prop } from '../kernel/guards.js';

/** @typedef {import('../kernel/types.js').Doc} Doc */
/** @typedef {import('../kernel/types.js').Runtime} Runtime */
/** @typedef {import('../kernel/types.js').Input} Input */
/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** @typedef {import('../kernel/types.js').RegisteredPrimitive} RegisteredPrimitive */
/** @typedef {import('../kernel/types.js').LogicLike} LogicLike */
/** An error attributed to the primitive that threw it (tracingRegistry). @typedef {Error & { gvPrimitive?: string, gvPhase?: string, gvDetail?: string, original?: unknown }} TracedError */
/** install_threw / step_threw (throwError) and the other first-playable problems. @typedef {{ code: string, path?: string, message: string, hint?: string, primitive?: string | null, phase?: string | null }} PlayableProblem */
/** A primitive instance removed so the world boots (repair's removals carry the same fields). @typedef {{ use: unknown, why: string, phase?: string | null, kind?: string }} Removal */

export const FIRST_PLAYABLE_VERSION = 'first-playable/0.2';
/** @type {Record<string, string>} */
const PHASE_WORDS = { install: 'while installing', step: 'during a step', event: 'in an event handler', action: 'in an action handler', options: 'while listing options', restore: 'while restoring' };

/** A thrown value's message (or the value), as text. @param {unknown} error */
const errorText = error => String(prop(error, 'message') || error);

/** @param {unknown} error @param {string | undefined} id @param {string} phase @param {string} [detail] @returns {TracedError} */
const tag = (error, id, phase, detail) => {
  /** @type {TracedError} */
  const e = error instanceof Error ? error : Object.assign(Error(String(error)), { original: error });
  if (!e.gvPrimitive) { e.gvPrimitive = id; e.gvPhase = phase; if (detail) e.gvDetail = detail; }
  return e;
};
/**
 * fn wrapped so what it throws is attributed to owner(). Arguments and the result pass through untouched.
 * @template {Function} F
 * @param {F} fn @param {(() => string) | null | ''} owner @param {string} phase @param {string} [detail] @returns {F}
 */
const guard = (fn, owner, phase, detail) => typeof fn !== 'function' || !owner ? fn : /** @type {F} */ (/** @type {unknown} */ (
  /** @this {unknown} @param {unknown[]} args */
  function guarded(...args) {
    try { return fn.apply(this, args); } catch (error) { throw tag(error, owner(), phase, detail); }
  }));

/**
 * A registry view whose primitives' install hooks, and everything they register on rt (systems, event handlers,
 * actions, option providers), attribute errors to the primitive: error.gvPrimitive, error.gvPhase. Boot only.
 */
/** @param {RegistryLike} registry @returns {RegistryLike} */
export function tracingRegistry(registry) {
  /** @type {Map<string | undefined, RegisteredPrimitive>} */
  const wrapped = new Map();
  /** @type {RegistryLike} */
  const view = Object.create(registry);
  view.get = id => {
    const p = registry.get(id);
    if (!p?.install) return p;
    const install = p.install;
    if (!wrapped.has(id)) wrapped.set(id, { ...p, install(rt, config, instance) {
      patch(rt);
      const outer = rt.__gvOwner; rt.__gvOwner = id;
      try { return install.call(p, rt, config, instance); }
      catch (error) { throw tag(error, id, 'install'); }
      finally { rt.__gvOwner = outer; }
    } });
    return wrapped.get(id);
  };
  return view;
}
/** @param {Runtime} rt */
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

/** @param {Doc} doc @param {RegistryLike} registry @param {LogicLike} logic @param {unknown} seed @param {number} frames @returns {Runtime} */
function boot(doc, registry, logic, seed, frames) {
  // The world booted is the one a person plays: the document with the host's input and UI (v2/web/host-doc.js), as the
  // gate verifies it; the host document's preflight failing is a defect of the document as played, reported as such.
  const host = preflight(hostDocument(doc, registry), registry, logic);
  if (!host.ok) throw Object.assign(Error(`the document a person plays (the host's input and UI added) does not preflight: ${host.errors.slice(0, 3).map(e => `${e.code} ${e.path}: ${e.message}`).join('; ')}`), { hostErrors: host.errors });
  const rt = createWorld(host.doc, tracingRegistry(registry), logic, { seed });
  for (let i = 0; i < frames && rt.state.status === 'playing'; i++) rt.step();
  rt.availableOptions();
  return rt;
}

/** The error a throwing primitive becomes (stable codes install_threw / step_threw), naming the primitive and when it threw. */
/** @param {unknown} error @param {Doc} doc @returns {PlayableProblem & { path: string, primitive: string | null, phase: string | null }} */
export function throwError(error, doc) {
  // tag() sets these to strings; anything else thrown has none.
  const gp = prop(error, 'gvPrimitive'), gph = prop(error, 'gvPhase'), detail = prop(error, 'gvDetail');
  const id = isStr(gp) && gp ? gp : null, phase = isStr(gph) && gph ? gph : null;
  const at = id ? instances(doc).find(x => x.inst.use === id) : null;
  const what = errorText(error).slice(0, 200);
  const when = phase ? `${PHASE_WORDS[phase] || phase}${detail ? ` ('${detail}')` : ''}` : 'while the world started';
  return {
    code: phase && phase !== 'install' ? 'step_threw' : 'install_threw', path: at ? at.keys.map((/** @type {string | number} */ k, /** @type {number} */ i) => typeof k === 'number' ? `[${k}]` : `${i ? '.' : ''}${k}`).join('') : '$',
    primitive: id, phase, message: id ? `'${id}' threw ${when}: ${what}` : `the world threw ${when}: ${what}`,
    hint: id ? `configure '${id}' differently (its params or the document data it reads), or leave it out` : 'check the document data the primitives read',
  };
}

/** The document without every instance of these primitives, nor of those that require them. */
/** @param {unknown} doc a preflighted document's data @param {RegistryLike} registry @param {string[]} ids @returns {{ doc: Record<string, unknown>, dropped: string[] }} */
function withoutPrimitives(doc, registry, ids) {
  const drop = new Set(ids);
  const kept = (/** @type {unknown} */ x) => { const use = prop(x, 'use'); return !(isStr(use) && drop.has(use)); };
  for (let grew = true; grew;) {
    grew = false;
    for (const x of instances(doc)) { const use = x.inst.use; if (isStr(use) && !drop.has(use) && requirementsOf(registry, use).primitives.some(r => [...drop].some(d => d === r || d.startsWith(r + '.')))) { drop.add(use); grew = true; } }
  }
  // doc passed preflight: spaces are objects and the instance lists are lists.
  const out = obj(structuredClone(doc));
  for (const s of objects(out.spaces)) if (isList(s.generators)) s.generators = s.generators.filter(kept);
  for (const k of ['systems', 'graphics']) { const xs = out[k]; if (isList(xs)) out[k] = xs.filter(kept); }
  return { doc: out, dropped: [...drop].filter(id => instances(doc).some(x => x.inst.use === id)) };
}

/**
 * A world that booted (ok: no error and the player spawned) or one that never did (ok: false, no document).
 * @typedef {{
 *   ok: boolean, doc: Doc, ms: number, version: string, stateHash: string, start: { space: string | undefined, at: unknown, zone: string | null } | null,
 *   options: number, actions: string[], beatsFired: string[], removed: Removal[], problems: PlayableProblem[], errors: PlayableProblem[],
 *   world: { added: Array<{ space: unknown, use: string, problems: string[] }>, problems: import('./world.js').WorldProblem[] },
 * } | { ok: false, doc?: undefined, ms: number, removed: Removal[], problems: PlayableProblem[], errors: PlayableProblem[],
 *   version?: undefined, stateHash?: undefined, start?: undefined, options?: undefined, actions?: undefined, beatsFired?: undefined, world?: undefined }} FirstPlayable
 */
/**
 * -> { ok, doc, ms, stateHash, start, options, beatsFired, removed, problems, errors, world }
 * @param {unknown} input a document (preflighted here) @param {RegistryLike} registry @param {LogicLike} logic
 * @param {{ seed?: unknown, frames?: number, furnish?: boolean, maxIsolations?: number, protect?: Iterable<string> | null }} [opts]
 * @returns {FirstPlayable}
 */
export function firstPlayable(input, registry, logic, { seed, frames = 3, furnish = true, maxIsolations = 0, protect = null } = {}) {
  // protect: primitives of core mechanics, never isolated; a throw in one (or in what it needs) is an error for the model.
  const kept = new Set(protect || []);
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  /** The document as given or as isolation/furnishing changed it; `checked` is always its preflighted form. @type {unknown} */
  let doc = input;
  /** @type {Removal[]} */
  const removed = [];
  /** @type {PlayableProblem[]} */
  const problems = [];
  /** @type {Set<string>} */
  const excluded = new Set();
  let pre = preflight(doc, registry, logic);
  if (!pre.ok) return { ok: false, errors: pre.errors, problems, removed, ms: elapsed() };
  let checked = pre.doc;
  /** @type {Runtime | null} */
  let rt = null;
  for (let attempt = 0; !rt; attempt++) {
    try { rt = boot(checked, registry, logic, seed, frames); break; }
    catch (error) {
      const hostErrors = prop(error, 'hostErrors');
      if (isList(hostErrors)) return { ok: false, errors: /** @type {PlayableProblem[]} */ (hostErrors), problems, removed, ms: elapsed() };
      const err = throwError(error, checked);
      const culprit = err.primitive && registry.has(err.primitive) ? err.primitive : findCulprit(checked, registry, logic, seed, excluded, kept);
      // checked is doc preflighted (same instances and uses).
      const isSpace = culprit && checked.spaces.some(s => s.use === culprit);
      const cutFirst = culprit && !isSpace ? withoutPrimitives(doc, registry, [culprit]) : null;
      const core = culprit && (kept.has(culprit) || (cutFirst?.dropped || []).some(id => kept.has(id)));
      // !cutFirst is !culprit || isSpace (stated for the type checker).
      if (!culprit || isSpace || !cutFirst || core || attempt >= maxIsolations) return { ok: false, errors: [culprit && !err.primitive ? { ...err, primitive: culprit, message: `'${culprit}' made the world throw: ${errorText(error).slice(0, 200)}` } : err], problems, removed, ms: elapsed() };
      // Remove it (and what requires it), then let the deterministic repair neutralise what pointed at it.
      const cut = cutFirst;
      for (const id of cut.dropped) excluded.add(id);
      const why = err.primitive === culprit ? err.message : `made the world throw: ${errorText(error).slice(0, 160)}`;
      for (const id of cut.dropped) removed.push({ use: id, why: id === culprit ? why : `requires '${culprit}', which was removed`, phase: id === culprit ? err.phase : null });
      const fixed = repairDocument(cut.doc, { registry, logic, exclude: excluded, protect: kept });
      for (const r of fixed.removed) if (!removed.some(x => x.use === r.use)) removed.push(r);
      doc = fixed.doc;
      pre = preflight(doc, registry, logic);
      if (!pre.ok) return { ok: false, errors: [{ ...err, message: `${err.message}; removing '${culprit}' left the document invalid` }, ...pre.errors], problems, removed, ms: elapsed() };
      checked = pre.doc;
    }
  }
  // A cell world the player moves through must not be empty.
  /** @type {{ added: Array<{ space: unknown, use: string, problems: string[] }>, problems: import('./world.js').WorldProblem[] }} */
  let world = { added: [], problems: [] };
  if (furnish) {
    const f = furnishWorld(doc, registry, logic, { seed, rt });
    if (f.added.length) {
      const p2 = preflight(f.doc, registry, logic);
      try { if (p2.ok) { const rt2 = boot(p2.doc, registry, logic, seed, frames); doc = f.doc; pre = p2; checked = p2.doc; rt = rt2; world = { added: f.added, problems: f.problems }; } }
      catch { /* the furnished world does not boot: keep the empty one, reported below */ }
    }
  }
  const empty = worldProblems(rt, checked, registry);
  problems.push(...empty.map(p => ({ code: p.code, path: p.path, message: p.message, hint: p.hint })));
  // Errors (never published): no player, a game over on its first frames, a player with nothing to do.
  /** @type {PlayableProblem[]} */
  const errors = [];
  const player = rt.player();
  if (checked.player && !player) problems.push({ code: 'no_player', message: 'the player did not spawn' });
  if (rt.state.status !== 'playing') {
    const events = [...new Set(rt.state.events.map(e => e.name).filter(n => !n.includes(':')))].slice(-8);
    errors.push({ code: 'ended_at_start', path: '$', message: `the game ended on its first ${frames} frames (${rt.state.status}${rt.state.ending ? `, ending '${rt.state.ending}'` : ''}) after events ${events.join(', ') || 'none'}`, hint: 'a primitive ends the game at once: its region may be blocked by generated terrain, or a beat ends the game without a trigger' });
  }
  const options = rt.availableOptions().length;
  if (player && rt.state.status === 'playing' && options === 0) problems.push({ code: 'no_options', path: 'player', message: 'the player starts with no options (no way to act or travel)', hint: 'add a movement or interaction primitive the space supports, or start the player where it can move' });
  const fired = Object.keys(rt.store('plot.storyboard').fired || {});
  return {
    ok: problems.every(p => p.code !== 'no_player') && !errors.length, doc: checked, ms: elapsed(), version: FIRST_PLAYABLE_VERSION,
    stateHash: hashOf(rt.snapshot()), start: player ? { space: player.space, at: player.at, zone: player.zone ?? null } : null,
    options, actions: rt.actions(), beatsFired: fired, removed, problems, errors, world,
  };
}

/** No attribution (the kernel itself threw): the first removable instance whose removal (with repair) lets the world boot. */
/** @param {Doc} doc @param {RegistryLike} registry @param {LogicLike} logic @param {unknown} seed @param {Set<string>} excluded @param {Set<string>} [kept] @returns {string | null} */
function findCulprit(doc, registry, logic, seed, excluded, kept = new Set()) {
  for (const x of instances(doc)) {
    const use = x.inst.use; // a preflighted document's uses are strings
    if (!isStr(use) || (x.keys.length === 2 && x.keys[0] === 'spaces')) continue;
    if (kept.has(use)) continue;
    const cut = withoutPrimitives(doc, registry, [use]);
    const fixed = repairDocument(cut.doc, { registry, logic, exclude: new Set([...excluded, ...cut.dropped]), rounds: 3 });
    if (!fixed.ok) continue;
    // A repaired document that fails preflight cannot boot (createWorld of a null document throws): not this one either.
    try { const p = preflight(fixed.doc, registry, logic); if (p.ok) { boot(p.doc, registry, logic, seed, 1); return use; } } catch { /* not this one */ }
  }
  return null;
}

/**
 * Replay determinism (ARCHITECTURE.md §7): the same document, seed and inputs reach the same
 * state hash. Inputs default to cycling through the options the game itself offers.
 */
/**
 * @param {Doc} doc @param {RegistryLike} registry @param {LogicLike} logic @param {{ seed?: unknown, steps?: number, runs?: number }} [opts]
 * @returns {{ deterministic: boolean, hash: string, runs: number, steps: number }}
 */
export function replayCheck(doc, registry, logic, { seed, steps = 240, runs = 2 } = {}) {
  /** @type {string[]} */
  const hashes = [];
  /** @type {Input[] | null} */
  let script = null;
  for (let r = 0; r < runs; r++) {
    const rt = createWorld(doc, registry, logic, { seed });
    /** @type {Input[]} */
    const inputs = [];
    for (let i = 0; i < steps && rt.state.status === 'playing'; i++) {
      /** @type {Input | undefined} */
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
