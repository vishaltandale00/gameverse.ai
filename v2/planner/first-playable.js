// Layer 2 of ARCHITECTURE.md §4: the first playable. No model calls: the outline
// document is preflighted and instantiated headless (spaces and generators run
// procedurally from their params, the player and the first beat come up), so a
// broken install is caught before publishing. An instance whose install throws
// is isolated and removed (reported as a gap) instead of failing the game.
import { preflight } from '../kernel/document.js';
import { createWorld } from '../kernel/world.js';
import { hashOf } from '../server/store.js';

export const FIRST_PLAYABLE_VERSION = 'first-playable/0.1';

function boot(doc, registry, logic, seed, frames) {
  const rt = createWorld(doc, registry, logic, { seed });
  for (let i = 0; i < frames && rt.state.status === 'playing'; i++) rt.step();
  return rt;
}

/** -> { ok, doc, ms, stateHash, start, options, beatsFired, removed, problems, errors } */
export function firstPlayable(input, registry, logic, { seed, frames = 3 } = {}) {
  const started = performance.now();
  let doc = input;
  const removed = [], problems = [];
  let pre = preflight(doc, registry, logic);
  if (!pre.ok) return { ok: false, errors: pre.errors, problems, removed, ms: Math.round(performance.now() - started) };
  let rt = null;
  for (let attempt = 0; attempt < 4 && !rt; attempt++) {
    try { rt = boot(pre.doc, registry, logic, seed, frames); }
    catch (error) {
      // Isolate the instance that throws: the first systems[] entry whose removal lets the world boot.
      const culprit = (doc.systems || []).findIndex((_, i) => { const trial = { ...doc, systems: doc.systems.filter((__, j) => j !== i) }; const p = preflight(trial, registry, logic); if (!p.ok) return false; try { boot(p.doc, registry, logic, seed, 1); return true; } catch { return false; } });
      if (culprit < 0) return { ok: false, errors: [], problems: [{ code: 'install_threw', message: String(error?.message || error).slice(0, 200) }], removed, ms: Math.round(performance.now() - started) };
      removed.push({ use: doc.systems[culprit].use, why: `install failed: ${String(error?.message || error).slice(0, 160)}` });
      doc = { ...doc, systems: doc.systems.filter((_, j) => j !== culprit) };
      pre = preflight(doc, registry, logic);
      if (!pre.ok) return { ok: false, errors: pre.errors, problems, removed, ms: Math.round(performance.now() - started) };
    }
  }
  if (!rt) return { ok: false, errors: [], problems: [{ code: 'install_threw', message: 'the world would not start' }], removed, ms: Math.round(performance.now() - started) };
  const player = rt.player();
  if (doc.player && !player) problems.push({ code: 'no_player', message: 'the player did not spawn' });
  if (rt.state.status !== 'playing') problems.push({ code: 'ended_at_start', message: `the game ended on its first frames (${rt.state.status})` });
  const fired = Object.keys(rt.store('plot.storyboard').fired || {});
  return {
    ok: problems.every(p => p.code !== 'no_player'), doc: pre.doc, ms: Math.round(performance.now() - started), version: FIRST_PLAYABLE_VERSION,
    stateHash: hashOf(rt.snapshot()), start: player ? { space: player.space, at: player.at, zone: player.zone ?? null } : null,
    options: rt.availableOptions().length, actions: rt.actions(), beatsFired: fired, removed, problems, errors: [],
  };
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
