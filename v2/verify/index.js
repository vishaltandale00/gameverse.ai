// One verification layer for every document (ARCHITECTURE.md §5):
//   preflight → plot (static + solver) → spatial (gate-ordered reachability)
//   → playtest (Go-Explore) → strategies (generic players chosen by what the
//   document provides) → invariants (finiteness, explosions, storms,
//   round-trip, replay determinism).
// Everything runs headless on the real runtime through options, steps,
// snapshots and space capabilities. Problems carry stable codes, document
// paths and hints so the planner's repair loop can fix the document; each
// stage reports whether it was exhaustive or stopped by its budget.
import { preflight } from '../kernel/document.js';
import { verifyPlot } from './plot.js';
import { verifySpatial } from './spatial.js';
import { playtest } from './playtest.js';
import { checkInvariants } from './invariants.js';
import { select } from './strategies/index.js';
import { maker } from './drive.js';
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
 * Run a bot on the world a person plays: the gate's seed (the document's own seed), never the bot's default seed
 * list. Every caller that proves a document with a bot (this gate, the template suite) runs it through here.
 * `opts` are the bot's other run options; a caller's explicit `seeds` there are not allowed to replace the world.
 */
export function playBot(strategy, ctx, opts = {}) {
  return strategy.run(ctx, { ...opts, seeds: [ctx.seed] });
}

/**
 * verify(doc, registry, logic, opts) → report
 * opts: { seed, budgetMs, plot: {...solver opts} | false, spatial: {...} | false, playtest: {...} | false,
 *         strategies: { only?: [ids], budgetMs?: reserved for the bots, [id]: {...run opts} } | false, invariants: {...} | false }
 */
export async function verify(doc, registry, logic, opts = {}) {
  const t0 = now(), timings = {};
  const total = opts.budgetMs ?? 4000, seed = opts.seed;
  // The bots' own budget (opts.strategies.budgetMs), when given, is reserved: it is not taken from the shared pool the
  // other stages split, and their time does not count against it. The bots the loops name are the gate's players.
  const botBudget = Number.isFinite(opts.strategies?.budgetMs) ? opts.strategies.budgetMs : null;
  let reservedSpent = 0;
  const left = () => Math.max(50, total - (now() - t0 - reservedSpent));
  const time = async (name, fn) => { const t = now(); try { return await fn(); } finally { timings[name] = Math.round(now() - t); } };
  const problems = [];

  const pre = await time('preflight', () => preflight(doc, registry, logic));
  const report = { ok: false, seed: seed ?? null, preflight: { ok: pre.ok, errors: pre.errors, warnings: pre.warnings, ms: pre.ms }, plot: null, spatial: null, playtest: null, strategies: null, invariants: null, problems, timings, exhaustive: {} };
  for (const e of pre.errors) problems.push(problem(e.code, e.path, e.message, { hint: e.hint, severity: 'error', stage: 'preflight' }));
  for (const w of pre.warnings) problems.push(problem(w.code, w.path, w.message, { hint: w.hint, severity: 'warning', stage: 'preflight' }));
  if (!pre.ok) { timings.total = Math.round(now() - t0); return report; }
  const nd = pre.doc;
  const tag = (list, stage) => { for (const p of list) problems.push({ ...p, stage: p.stage || stage }); };
  const guard = async (stage, fn) => { try { return await fn(); } catch (error) { problems.push(problem('runtime_error', 'systems', `${stage} stage threw: ${error?.message || error}`, { stage })); return null; } };

  if (opts.plot !== false) {
    report.plot = await time('plot', () => guard('plot', () => verifyPlot(nd, registry, logic, { seed, budgetMs: left() * 0.35, ...(opts.plot || {}) })));
    if (report.plot) { tag(report.plot.problems, 'plot'); report.exhaustive.plot = report.plot.exhaustive; }
  }
  if (opts.spatial !== false) {
    report.spatial = await time('spatial', () => guard('spatial', () => verifySpatial(nd, registry, logic, { seed, plot: report.plot, settleSteps: opts.plot?.settleSteps ?? 2, ...(opts.spatial || {}) })));
    if (report.spatial) tag(report.spatial.problems, 'spatial');
  }
  if (opts.playtest !== false) {
    report.playtest = await time('playtest', () => guard('playtest', () => playtest(nd, registry, logic, { seed, budgetMs: left() * 0.4, ...(opts.playtest || {}) })));
    if (report.playtest) tag(report.playtest.problems, 'playtest');
  }
  if (opts.strategies !== false) {
    const ts = now();
    report.strategies = await time('strategies', () => guard('strategies', () => {
      // The bots are playtest agents too (§6.3): every runtime they play is measured on the win quantity the playtest
      // steers by (opts.playtest.win), so the gate sees how far their play moved it toward the win.
      const wm = winMeasure(opts.playtest?.win ?? null), reached = { high: wm ? 0 : null };
      const make = wm ? measured(maker(nd, registry, logic), wm, reached) : maker(nd, registry, logic), probe = make(seed);
      const ctx = { doc: nd, registry, logic, make, seed, capabilities: pre.capabilities, used: usedPrimitives(nd), playerSpace: probe.player()?.space ?? nd.spaces[0]?.id, plot: report.plot };
      const { chosen, skipped } = select(ctx, { only: opts.strategies?.only || null });
      const ran = [], tb = now();
      chosen.forEach(({ s, reason }, i) => {
        if (wm) reached.high = 0;
        const share = (botBudget !== null ? Math.max(50, botBudget - (now() - tb)) : left() * 0.6) / (chosen.length - i);
        try {
          const r = playBot(s, ctx, { budgetMs: share, ...(opts.strategies?.[s.id] || {}) });
          ran.push({ id: s.id, reason, ok: r.ok, proven: r.proven, metrics: r.metrics, exhaustive: r.exhaustive, budget: r.budget, ...(wm ? { progress: reached.high } : {}) });
          tag(r.problems.map(p => ({ ...p, strategy: s.id })), 'strategy');
        } catch (error) { ran.push({ id: s.id, reason, ok: false, error: String(error?.message || error) }); problems.push(problem('runtime_error', 'systems', `strategy '${s.id}' threw: ${error?.message || error}`, { stage: 'strategy', strategy: s.id })); }
      });
      return { ran, skipped };
    }));
    if (botBudget !== null) reservedSpent += now() - ts;
  }
  if (opts.invariants !== false) {
    report.invariants = await time('invariants', () => guard('invariants', () => checkInvariants(nd, registry, logic, { seed, budgetMs: left(), ...(opts.invariants || {}) })));
    if (report.invariants) tag(report.invariants.problems, 'invariants');
  }
  // One record per code + path, most severe first.
  const seen = new Map();
  for (const p of problems) { const k = `${p.code}|${p.path}`; const o = seen.get(k); if (!o || RANK[p.severity] < RANK[o.severity]) seen.set(k, p); }
  problems.length = 0; problems.push(...[...seen.values()].sort((a, b) => RANK[a.severity] - RANK[b.severity]));
  report.ok = !problems.some(p => p.severity === 'error');
  timings.total = Math.round(now() - t0);
  return report;
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
export { playtest, replayPlay, progressTimeline } from './playtest.js';
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
