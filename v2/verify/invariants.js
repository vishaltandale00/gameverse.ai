// Runtime invariants, checked on any document:
//   non-finite numbers anywhere in state, entity explosions, event storms,
//   stuck states (no input changes anything), snapshot round-trip
//   (snapshot → restore → identical behavior) and replay determinism
//   (same doc + seed + inputs → identical state hash).
import { maker, hold, inputMacros, applyOption } from './drive.js';
import { problem, prng, stateHash, stableStringify, budget as makeBudget } from './util.js';

export const LIMITS = { maxEntities: 5000, growthFactor: 8, maxEventsPerStep: 2000, confirmFrames: 600, confirmGrowth: 1.5 };

/** First non-finite number in a JSON tree: its path, or null. */
export function findNonFinite(value, path = 'state') {
  if (typeof value === 'number') return Number.isFinite(value) ? null : path;
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) { for (let i = 0; i < value.length; i++) { const p = findNonFinite(value[i], `${path}[${i}]`); if (p) return p; } return null; }
  for (const [k, v] of Object.entries(value)) { const p = findNonFinite(v, `${path}.${k}`); if (p) return p; }
  return null;
}

/**
 * A per-step checker for searches and playtests: call check(rt) after each
 * step or macro; it returns the first violation as a problem, or null.
 */
export function stepChecker(limits = {}) {
  const L = { ...LIMITS, ...limits };
  let base = null, limit = null;
  /**
   * Past the growth limit, the count must keep growing to be an explosion ("grows without bound"): the world runs on
   * from a snapshot for `confirmFrames` with no input; a count that settles (a boss's bullet pattern, a dense wave
   * whose shots expire) raises the limit to half again its plateau, and only growth past that is checked again.
   */
  const grows = (rt, n) => {
    if (!rt.snapshot || !L.confirmFrames) return true;
    const snap = rt.snapshot(); let top = n;
    for (let i = 0; i < L.confirmFrames && rt.state.status === 'playing'; i++) { rt.step({}); top = Math.max(top, Object.keys(rt.state.entities).length); if (top > n * L.confirmGrowth) break; }
    rt.restore(snap);
    if (top > n * L.confirmGrowth) return true;
    limit = Math.ceil(Math.max(top, n) * L.confirmGrowth);
    return false;
  };
  return {
    check(rt) {
      const s = rt.state, n = Object.keys(s.entities).length;
      base ??= Math.max(1, n); limit ??= base * L.growthFactor + 50;
      const bad = findNonFinite(s);
      if (bad) return problem('non_finite', bad.replace(/^state/, 'state'), `non-finite number at ${bad} (frame ${s.frame})`, { hint: 'guard divisions and normalizations in the primitive that owns this field' });
      if (n > L.maxEntities || (n > limit && grows(rt, n))) return problem('entity_explosion', 'systems', `${n} entities at frame ${s.frame} (started with ${base}), still growing`, { hint: 'cap spawners, despawn projectiles and effects' });
      if (s.events.length > L.maxEventsPerStep) return problem('event_storm', 'systems', `${s.events.length} events in one step at frame ${s.frame} (most: ${topEvent(s.events)})`, { hint: 'an event handler is re-emitting or a system emits every step for every entity' });
      return null;
    },
  };
}
const topEvent = events => { const c = {}; for (const e of events) c[e.name] = (c[e.name] || 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.join(' ×'); };

/** A deterministic input script for invariant runs: seeded random macros over options or verbs/axes. */
function script(rt, rand, length) {
  const macros = inputMacros(rt), out = [];
  for (let i = 0; i < length; i++) out.push({ ...macros[rand.int(macros.length)], frames: 1 + rand.int(12) });
  return out;
}

/** Drive an rt with a script, taking a seeded option instead of the scripted input half the time. */
function drive(rt, steps, rand, onStep) {
  for (let k = 0; k < steps.length && rt.state.status === 'playing'; k++) {
    const options = rt.availableOptions();
    if (options.length && rand() < 0.5) applyOption(rt, options[rand.int(options.length)]);
    else hold(rt, steps[k].input, steps[k].frames);
    if (onStep && onStep(rt) === false) break;
  }
}

/**
 * check(doc, registry, logic, opts) → { ok, problems, checks, timings }
 * opts: { seed, steps (macro count), budgetMs, limits }
 */
export function checkInvariants(doc, registry, logic, { seed, steps = 120, budgetMs = 1000, limits } = {}) {
  const b = makeBudget({ ms: budgetMs });
  const make = maker(doc, registry, logic);
  const problems = [], checks = {};
  const L = { ...LIMITS, ...limits };
  const add = p => { if (!problems.some(q => q.code === p.code)) problems.push(p); };

  // 1. Run a seeded random script with per-step checks; record the script for replay.
  const rand = prng(`invariants:${seed ?? doc.seed ?? doc.id}`);
  let rt;
  try { rt = make(seed); } catch (error) { return { ok: false, problems: [problem('runtime_error', '$', `world creation threw: ${error?.message || error}`)], checks, ms: Math.round(b.elapsed()) }; }
  const plan = script(rt, rand, steps);
  const checker = stepChecker(L);
  const decisions = prng(`invariants-options:${seed ?? doc.seed ?? doc.id}`);
  let frames = 0;
  try {
    drive(rt, plan, decisions, rt2 => {
      frames = rt2.state.frame;
      const p = checker.check(rt2);
      if (p) { add(p); return false; }
      return !b.over();
    });
  } catch (error) { add(problem('runtime_error', 'systems', `step threw at frame ${rt.state.frame}: ${error?.message || error}`, { hint: 'see the stack in the primitive named by the message' })); }
  checks.randomRun = { frames, status: rt.state.status };
  // Inputs are inert when there are no options and every input macro leaves the same state as idling.
  {
    const probe = make(seed), snap = probe.snapshot(), flat = () => stateHash({ ...probe.state, events: [], counts: {} });
    // Options opened by the first step (a dialogue or menu a start beat opens) count as something to do.
    let moved = probe.availableOptions().length > 0, idle = null;
    if (!moved) { try { probe.step({}); moved = probe.state.status === 'playing' && probe.availableOptions().length > 0; } catch { /* reported above */ } probe.restore(snap); }
    for (const m of moved ? [] : inputMacros(probe)) {
      probe.restore(snap);
      try { hold(probe, m.input, 10); } catch { /* reported above */ }
      const h = flat();
      if (idle === null) idle = h; else if (h !== idle) { moved = true; break; }
    }
    probe.restore(snap);
    checks.inputsMatter = moved;
    if (!moved) add(problem('stuck_state', 'systems', 'no input or option changes the game state at the start; the player cannot do anything', { hint: 'bind player actions (engine.input.actions / movement primitives) or offer options' }));
  }

  // 2. Snapshot round-trip: restore(snapshot) then continue must equal continuing directly.
  try {
    const a = make(seed), r2 = prng(`roundtrip:${seed ?? doc.seed ?? doc.id}`), prefix = script(a, r2, 10), suffix = script(a, r2, 10);
    for (const m of prefix) hold(a, m.input, m.frames);
    const snap = a.snapshot();
    const json = stableStringify(snap);
    a.restore(snap);
    if (stableStringify(a.snapshot()) !== json) add(problem('snapshot_roundtrip', 'state', 'snapshot() after restore(snapshot) differs from the snapshot', { hint: 'state must be plain JSON in rt.state' }));
    for (const m of suffix) hold(a, m.input, m.frames);
    const direct = stateHash(a.state);
    a.restore(snap);
    for (const m of suffix) hold(a, m.input, m.frames);
    const restored = stateHash(a.state);
    checks.roundTrip = direct === restored;
    if (direct !== restored) add(problem('snapshot_roundtrip', 'state', 'continuing after restore() diverges from continuing without it: some primitive keeps simulation state outside rt.state', { hint: 'move it into rt.store(key) or rebuild caches in rt.onRestore' }));
  } catch (error) { add(problem('runtime_error', 'systems', `round-trip run threw: ${error?.message || error}`)); }

  // 3. Replay determinism: two fresh worlds, same seed and inputs → same state hash.
  try {
    const r3 = prng(`replay:${seed ?? doc.seed ?? doc.id}`), x = make(seed), y = make(seed), steps2 = script(x, r3, 40);
    for (const m of steps2) { hold(x, m.input, m.frames); hold(y, m.input, m.frames); }
    const hx = stateHash(x.state), hy = stateHash(y.state);
    checks.replayHash = hx;
    checks.deterministic = hx === hy;
    if (hx !== hy) add(problem('nondeterministic', '$', 'the same document, seed and inputs produced different states', { hint: 'never use Math.random, Date or performance in simulation; use rt.random()' }));
  } catch (error) { add(problem('runtime_error', 'systems', `replay run threw: ${error?.message || error}`)); }

  return { ok: !problems.some(p => p.severity === 'error'), problems, checks, ms: Math.round(b.elapsed()) };
}
