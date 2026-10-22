// One verification layer for every document (ARCHITECTURE.md §5):
//   preflight → plot (static + solver) → spatial (gate-ordered reachability)
//   → strategies (generic players chosen by what the document provides)
//   → playtest (Go-Explore) → features → invariants (finiteness, explosions,
//   storms, round-trip, replay determinism).
// Each stage ends when what it is run to show is shown (a bot: the game won; the explorer, given opts.playtest.prove:
// the loop and progress toward the win, a bot's win counting as progress; the feature checks: every verb's row
// decided) or at its budget, whichever comes first; both are counted in play, never on the clock.
// Everything runs headless on the real runtime through options, steps,
// snapshots and space capabilities. Problems carry stable codes, document
// paths and hints so the planner's repair loop can fix the document; each
// stage reports whether it was exhaustive or stopped by its budget.
// Every budget that decides what is played is counted in states and simulated frames (GATE_BUDGET), never wall
// time, so the same document and seed always give the same verdict, under load or across a laptop's sleep. The only
// wall-clock limit is an optional total cap (opts.wallMs), checked between whole stages and bots: a stage it stops is
// not run at all and the report says so (budgetLimited), never a different verdict.
import { preflight } from '../kernel/document.js';
import { verifyPlot } from './plot.js';
import { verifySpatial } from './spatial.js';
import { playtest, PLAYTEST_BUDGET } from './playtest.js';
import { checkInvariants } from './invariants.js';
import { select } from './strategies/index.js';
import { maker } from './drive.js';
import { controlledMaker } from './controls.js';
import { featureChecks } from './features.js';
import { hostDocument } from '../web/host-doc.js';
import { winMeasure } from './objective.js';
import { now, usedPrimitives, problem } from './util.js';

/** Stable problem codes this layer emits (planner-facing). */
export const PROBLEM_CODES = {
  // plot
  plot_uncompletable: 'exhaustive search found no path to any ending', plot_unproven: 'no ending found within the search budget',
  ending_unreachable: 'a declared ending is never reached', beat_unreachable: 'a beat never fires', beat_cycle: 'beats wait on each other in a cycle',
  beat_order: 'a beat waits on a beat in a later sequential act', softlock: 'a reachable state offers no options while playing', solver_no_options: 'no options to search',
  // spatial
  target_unreachable: 'a zone the plot needs is not reachable in gate order', zone_unreachable: 'a zone is never reachable', entity_unreachable: 'an interactable/character is never reachable',
  gate_bypassed: 'a gated zone is reachable while its gate is closed', spatial_unsupported: 'a space has no reachable capability', space_unvisited: 'the player never enters a space',
  '<kind>_unreachable': 'a declared place (portal, interactable, station…) is never reachable',
  // playtest
  trivially_won: 'won with no input', instant_loss: 'lost within 2 s with no input', goal_not_reached: 'playtest found no ending (budget-limited)', event_never_seen: 'a referenced event never happened',
  option_uncontrolled: 'the game offers an option whose actions no control a person has issues (blocks publishing)', controls_missing: 'a bot or the explorer needed a verb no control issues',
  // strategies
  level_too_hard: 'placement bot topped out', goal_unreached: 'bots met the goal below the pass rate', no_start_move: 'the board starts with no move', too_hard: 'a bot could not make enough progress',
  bot_failed: 'the dodger died early', chunk_impassable: 'no line through a zone of a scrolling course', no_attack_connects: 'no verb damages an adjacent opponent', whiff: 'a combat verb never connects',
  stalemate: 'the AI never damages an idle player', launch_unsolved: 'no shot plan clears the targets', body_stuck: 'a body comes to rest with no way out',
  body_escaped: 'a body leaves the space', encounter_too_hard: 'battles are won below the pass rate', battle_stalemate: 'battles do not end',
  // invariants and general
  non_finite: 'NaN or Infinity in state', entity_explosion: 'entity count grows without bound', event_storm: 'too many events in one step', stuck_state: 'no input changes the state',
  snapshot_roundtrip: 'restore(snapshot) does not reproduce behavior', nondeterministic: 'same doc + seed + inputs gave different states', runtime_error: 'a step or option threw',
  budget_exhausted: 'a stage stopped at its budget (warning, not a content fault)', preflight: 'see the preflight code in the message',
  plot_graph_error: 'the static plotGraph threw', arc_space: 'an ARC level is not on engine.space.grid', arc_size: 'an ARC grid is outside 1–64 cells', arc_baseline: 'an ARC level lacks a baseline',
  // plotGraph (v2/primitives/plot/story-graph.js) problems pass through with source: 'plotGraph'; preflight codes pass through with stage: 'preflight'.
};

const RANK = { error: 0, warning: 1, info: 2 };

/**
 * What each stage of the gate plays when its caller names nothing else: plot solver states and frames, the explorer's rounds and
 * frames, each bot's frames (per seed, lookahead included), the feature checks' frames per verb and the invariant
 * script's macros. Sized from the template
 * suite's measured runs so a gate spends about what it spent when its stages were cut by wall time (the turnaround
 * report in the change that introduced it); override per call with opts.budget.
 */
export const GATE_BUDGET = Object.freeze({ plotStates: 2000, plotSteps: 2000, playtestRounds: PLAYTEST_BUDGET.rounds, playtestFrames: PLAYTEST_BUDGET.frames, botSteps: 10000, featureSteps: 40000, invariantMacros: 120 });

/**
 * Run a bot on the world a person plays: the gate's seed (the document's own seed), never the bot's default seed
 * list. Every caller that proves a document with a bot (this gate, the template suite) runs it through here.
 * `opts` are the bot's other run options; a caller's explicit `seeds` there are not allowed to replace the world.
 */
export function playBot(strategy, ctx, opts = {}) {
  return strategy.run(ctx, { ...opts, seeds: [ctx.seed] });
}

/**
 * verify(doc, registry, logic, opts) → report
 * opts: { seed, budget: Partial<GATE_BUDGET>, wallMs, plot: {...solver opts} | false, spatial: {...} | false,
 *         playtest: { win?, prove?: { loop }, ... } | false, strategies: { only?: [ids], [id]: {...run opts} } | false, invariants: {...} | false }
 * `wallMs` (default none) caps total wall time between stages: a stage or bot not started because it passed is listed
 * in report.budgetLimited, with a budget_exhausted warning.
 */
export async function verify(doc, registry, logic, opts = {}) {
  const t0 = now(), timings = {};
  const seed = opts.seed, B = { ...GATE_BUDGET, ...(opts.budget || {}) };
  const wallMs = Number.isFinite(opts.wallMs) ? opts.wallMs : Infinity;
  const time = async (name, fn) => { const t = now(); try { return await fn(); } finally { timings[name] = Math.round(now() - t); } };
  const problems = [], budgetLimited = [];
  /** Has the total wall cap passed? Then `what` does not run, and the report says so. */
  const capped = what => {
    if (now() - t0 < wallMs) return false;
    budgetLimited.push(what);
    return true;
  };

  // Every stage verifies the document a person plays: the host's default input and UI added (v2/web/host-doc.js).
  const reachedStates = [];
  const pre = await time('preflight', () => preflight(hostDocument(doc, registry), registry, logic));
  const report = { ok: false, seed: seed ?? null, budget: B, budgetLimited, preflight: { ok: pre.ok, errors: pre.errors, warnings: pre.warnings, ms: pre.ms }, plot: null, spatial: null, playtest: null, strategies: null, invariants: null, problems, timings, exhaustive: {} };
  for (const e of pre.errors) problems.push(problem(e.code, e.path, e.message, { hint: e.hint, severity: 'error', stage: 'preflight' }));
  for (const w of pre.warnings) problems.push(problem(w.code, w.path, w.message, { hint: w.hint, severity: 'warning', stage: 'preflight' }));
  if (!pre.ok) { timings.total = Math.round(now() - t0); return report; }
  const nd = pre.doc;
  const tag = (list, stage) => { for (const p of list) problems.push({ ...p, stage: p.stage || stage }); };
  const guard = async (stage, fn) => { try { return await fn(); } catch (error) { problems.push(problem('runtime_error', 'systems', `${stage} stage threw: ${error?.message || error}`, { stage })); return null; } };

  if (opts.plot !== false && !capped('plot')) {
    report.plot = await time('plot', () => guard('plot', () => verifyPlot(nd, registry, logic, { seed, maxStates: B.plotStates, maxSteps: B.plotSteps, ...(opts.plot || {}) })));
    if (report.plot) { tag(report.plot.problems, 'plot'); report.exhaustive.plot = report.plot.exhaustive; }
  }
  if (opts.spatial !== false && !capped('spatial')) {
    report.spatial = await time('spatial', () => guard('spatial', () => verifySpatial(nd, registry, logic, { seed, plot: report.plot, settleSteps: opts.plot?.settleSteps ?? 2, ...(opts.spatial || {}) })));
    if (report.spatial) tag(report.spatial.problems, 'spatial');
  }
  if (opts.strategies !== false && !capped('strategies')) {
    report.strategies = await time('strategies', () => guard('strategies', () => {
      // The bots are playtest agents too (§6.3): every runtime they play is measured on the win quantity the playtest
      // steers by (opts.playtest.win), so the gate sees how far their play moved it toward the win.
      const wm = winMeasure(opts.playtest?.win ?? null), reached = { high: wm ? 0 : null };
      // The bots play through the controls a person has (controls.js): every step they take is device input sampled
      // through the document's bindings, or an action a mounted UI primitive issues.
      const make = recording(wm ? measured(controlledMaker(nd, registry, logic), wm, reached) : controlledMaker(nd, registry, logic), reachedStates), probe = make(seed);
      const ctx = { doc: nd, registry, logic, make, seed, capabilities: pre.capabilities, used: usedPrimitives(nd), playerSpace: probe.player()?.space ?? nd.spaces[0]?.id, plot: report.plot };
      const { chosen, skipped } = select(ctx, { only: opts.strategies?.only || null });
      const ran = [];
      chosen.forEach(({ s, reason }) => {
        if (capped(`strategies:${s.id}`)) { ran.push({ id: s.id, reason, ok: null, budgetLimited: true }); return; }
        if (wm) reached.high = 0;
        try {
          const r = playBot(s, ctx, { maxSteps: B.botSteps, ...(opts.strategies?.[s.id] || {}) });
          // won: the game itself ended won in one of its runs (status 'won'), never a bot's own pass criterion
          // (surviving, a share collected, the opponents down while the game plays on).
          const won = (r.metrics?.runs ?? r.metrics?.matches ?? []).some(x => x?.status === 'won');
          ran.push({ id: s.id, reason, ok: r.ok, won, proven: r.proven, metrics: r.metrics, exhaustive: r.exhaustive, budget: r.budget, ...(wm ? { progress: reached.high } : {}) });
          tag(r.problems.map(p => ({ ...p, strategy: s.id })), 'strategy');
        } catch (error) {
          ran.push({ id: s.id, reason, ok: false, error: String(error?.message || error) });
          // A bot asking for a verb no control issues is the game's defect (a loop played with a verb a person cannot
          // give): controls_missing, blocking; any other throw is a runtime error.
          if (error?.code === 'controls_missing') problems.push(problem('controls_missing', 'systems', `the ${s.id} bot needed ${error.message.replace(/^controls_missing: /, '')}`, { stage: 'strategy', strategy: s.id, missing: error.missing }));
          else problems.push(problem('runtime_error', 'systems', `strategy '${s.id}' threw: ${error?.message || error}`, { stage: 'strategy', strategy: s.id }));
        }
      });
      return { ran, skipped };
    }));
  }
  if (opts.playtest !== false && !capped('playtest')) {
    // The explorer runs until it has shown what its caller asks it to (opts.playtest.prove: the loop, and progress toward
    // the win, which the bots' play counts toward: a bot's win, or how far it moved the win quantity), a win, or its budget.
    const ran = report.strategies?.ran || [], moved = ran.map(b => Number(b.progress ?? NaN)).filter(Number.isFinite), won = ran.some(b => b.won === true);
    // The plot solver's exhaustive proof that no ending is reachable blocks unless a player wins (the gate's viability,
    // planner/verify-adapter.js): with that proof and no bot's win, the gate reads the explorer's win, so it plays for one.
    const needsWin = !won && (report.plot?.problems || []).some(p => p.code === 'plot_uncompletable' && p.severity === 'error');
    const prove = opts.playtest?.prove && !needsWin ? { ...opts.playtest.prove, won, ...(moved.length ? { progress: Math.max(...moved) } : {}) } : undefined;
    report.playtest = await time('playtest', () => guard('playtest', () => playtest(nd, registry, logic, { seed, maxRounds: B.playtestRounds, maxFrames: B.playtestFrames, ...(opts.playtest || {}), prove })));
    if (report.playtest) tag(report.playtest.problems, 'playtest');
  }
  // Feature checks (features.js): every primitive the document mixes in exists, is controllable and works when its
  // controls are pressed from states the bots' and the explorer's play reached.
  if (opts.features !== false && opts.strategies !== false && !capped('features')) {
    report.features = await time('features', () => guard('features', () => featureChecks(nd, registry, controlledMaker(nd, registry, logic), { seed, stepsPerVerb: B.featureSteps, states: [...(report.playtest?.sample || []).map(c => c.snap), ...reachedStates], ...(opts.features || {}) })));
    if (report.features) tag(report.features.problems.map(p => ({ severity: 'error', hint: 'every primitive the game mixes in must work through its controls', ...p })), 'features');
  }
  if (opts.invariants !== false && !capped('invariants')) {
    report.invariants = await time('invariants', () => guard('invariants', () => checkInvariants(nd, registry, logic, { seed, steps: B.invariantMacros, ...(opts.invariants || {}) })));
    if (report.invariants) tag(report.invariants.problems, 'invariants');
  }
  if (budgetLimited.length) problems.push(problem('budget_exhausted', 'systems', `the verification's wall-time cap (${wallMs} ms) passed before these ran: ${budgetLimited.join(', ')}`, { severity: 'warning', stage: 'verify', wall: true, skipped: [...budgetLimited] }));
  // One record per code + path, most severe first.
  const seen = new Map();
  for (const p of problems) { const k = `${p.code}|${p.path}`; const o = seen.get(k); if (!o || RANK[p.severity] < RANK[o.severity]) seen.set(k, p); }
  problems.length = 0; problems.push(...[...seen.values()].sort((a, b) => RANK[a.severity] - RANK[b.severity]));
  report.ok = !problems.some(p => p.severity === 'error');
  timings.total = Math.round(now() - t0);
  return report;
}

/**
 * A maker whose runtimes record a snapshot of the state every `every` steps of play (into `out`, at most `max`):
 * states the bots' play reached, for the feature checks.
 */
function recording(make, out, { every = 90, max = 240 } = {}) {
  return seed => {
    const rt = make(seed), step = rt.step.bind(rt);
    let n = 0;
    rt.step = input => { const r = step(input); if (++n % every === 0 && out.length < max && rt.state.status === 'playing') out.push(rt.snapshot()); return r; };
    return rt;
  };
}

/**
 * A maker whose runtimes record, after every step, how far the state has moved the win quantity toward the win since
 * the runtime was made (`reached.high`, the furthest). Only the state is read (never a path-carried tally), so the
 * snapshots and restores a bot's lookahead makes cannot inflate it.
 */
function measured(make, wm, reached) {
  return seed => {
    const rt = make(seed), from = wm.start(rt), step = rt.step.bind(rt);
    rt.step = input => {
      const out = step(input), a = wm.advance(rt, from);
      if (Number.isFinite(a) && a > reached.high) reached.high = a;
      return out;
    };
    return rt;
  };
}

export { solve } from './solve.js';
export { verifyPlot, staticPlot, beatStructure, solverProblems } from './plot.js';
export { verifySpatial, movementEnvelope } from './spatial.js';
export { playtest, replayPlay, progressTimeline, explorerWorlds, PLAYTEST_BUDGET } from './playtest.js';
export { quality, QUALITY_CODES, QUALITY_THRESHOLDS } from './quality.js';
export { artQuality, ART_QUALITY_CODES, ART_QUALITY_TOLERANCE } from './art-quality.js';
export { checkInvariants, stepChecker, findNonFinite } from './invariants.js';
export { strategies, register as registerStrategy, select as selectStrategies } from './strategies/index.js';
export { runArc, arcScore, levelScore, AGENTS as ARC_AGENTS } from './arc.js';
export { objective } from './objective.js';
export { abstraction } from './abstraction.js';
export { travel, travelOptions, withTravel, jumpVerb } from './macros.js';
export { navOptions, navFrom, abilityIds, currentAbilities } from './movement.js';
export { stateHash } from './util.js';
