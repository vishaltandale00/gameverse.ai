// @ts-check
// Verification for generated documents. Uses v2/verify's `verify` export when that
// workstream provides one (feature-detected, never assumed), otherwise preflight plus
// the plot solver (v2/verify/solve.js). Always returns one shape:
//   { ok, verified?, completable, exhaustive, source, preflight: { ok, errors, warnings, ms }, solve?, problems, ms }
// Problems from v2/verify carry { code, path, message, hint, severity, stage } (PROBLEM_CODES).
import { preflight } from '../kernel/document.js';
import { solve } from '../verify/solve.js';
import { createWorld } from '../kernel/world.js';
import { worldProblems, spacesNeedingWorld } from './world.js';
import { prop } from '../kernel/guards.js';

/** @typedef {import('../kernel/types.js').Doc} Doc */
/** @typedef {import('../kernel/types.js').Problem} Problem */
/** @typedef {import('../kernel/types.js').RegistryLike} RegistryLike */
/** @typedef {import('../kernel/types.js').LogicLike} LogicLike */
/**
 * A verification problem (v2/verify PROBLEM_CODES, world_empty, plotGraph...). `path` is absent on adapter-made
 * problems (verify_threw, solve_threw).
 * @typedef {{ code: string, path?: string, message: string, hint?: string, severity?: string, stage?: string, [k: string]: unknown }} VerifyProblem
 */
/** Something carrying verification problems: a Verification, a StaticPlot. @typedef {{ problems?: VerifyProblem[] } | null | undefined} WithProblems */
/** A solver result as v2/verify reports it (plot layer or solve.js). @typedef {{ completable?: boolean | null, exhaustive?: unknown, endings?: Record<string, unknown>, beatsNeverFired?: string[], states?: number | null, [k: string]: unknown }} SolveLike */
/** v2/verify's playtest result (the archive sample keeps snapshots). @typedef {{ winnable?: boolean, win?: unknown, losses?: unknown, idle?: unknown, explored?: unknown, framesSimulated?: number, timeline?: unknown, sample?: Array<{ key?: unknown, frames?: unknown, score?: unknown }>, [k: string]: unknown }} PlaytestRun */
/** v2/verify's verify() report, as far as this adapter reads it. @typedef {SolveLike & { ok?: boolean, plot?: SolveLike | null, solve?: SolveLike | null, problems?: VerifyProblem[], playtest?: PlaytestRun | null, strategies?: { ran?: BotRun[] } | null, timings?: Record<string, number> }} VerifyReport */
/** @typedef {{ verify?: (doc: Doc, registry: RegistryLike, logic: LogicLike, opts: Record<string, unknown>) => Promise<VerifyReport | null | undefined> }} VerifyModule */
/** @typedef {{ completable: boolean | null | undefined, exhaustive: unknown, endings: Record<string, unknown>, beatsNeverFired: string[], states: number | null }} SolveSummary */
/**
 * verifyDocument's result. `doc` is the preflighted document; it is null only when preflight failed (source 'preflight',
 * ok false), so `ok` implies a document. playtestRun (the full playtest, non-enumerable) and quality (set by
 * kernel-pipeline's qualityReport) are attached by callers' stages.
 * @typedef {VerificationFields & ({ ok: false, source: 'preflight', doc: null } | { ok: boolean, source: 'verify' | 'solve', doc: Doc })} Verification
 */
/**
 * @typedef {{
 *   verified?: boolean | null, completable: boolean | null | undefined, exhaustive: boolean,
 *   preflight: { ok: boolean, errors: Problem[], warnings: Problem[], ms: number | undefined },
 *   problems: VerifyProblem[], ms: number,
 *   solve?: SolveSummary | ReturnType<typeof solve> | null,
 *   playtest?: { winnable: unknown, win: unknown, losses: unknown, idle: unknown, explored: unknown, framesSimulated: number | null, timeline: unknown, sample: Array<{ key: unknown, frames: unknown, score: unknown }> } | null,
 *   viable?: boolean, viability?: string | null, timings?: Record<string, number> | null,
 *   playtestRun?: PlaytestRun, quality?: unknown,
 * }} VerificationFields
 */

/** A thrown value's message (or the value), as text. @param {unknown} error */
const errorText = error => String(prop(error, 'message') || error);

/** world_empty problems (v2/planner/world.js) for a preflighted document; a world that won't boot is reported elsewhere. */
/** @param {Doc} doc @param {RegistryLike} registry @param {LogicLike} logic @returns {VerifyProblem[]} */
function worldCheck(doc, registry, logic) {
  if (!spacesNeedingWorld(doc, registry).length) return []; // nothing moves through a cell space: no boot needed
  try { const rt = createWorld(doc, registry, logic, { seed: doc.seed }); for (let i = 0; i < 3 && rt.state.status === 'playing'; i++) rt.step(); return worldProblems(rt, doc, registry); }
  catch { return []; }
}

/** @type {VerifyModule | null} */
let loaded = null;
/** @returns {Promise<VerifyModule>} */
async function verifyModule() {
  if (loaded) return loaded;
  try { loaded = /** @type {VerifyModule} */ (await import('../verify/index.js')); }
  catch (error) { if (/** @type {{ code?: unknown } | null} */ (error)?.code !== 'ERR_MODULE_NOT_FOUND') throw error; loaded = {}; }
  return loaded;
}

// The publish gate (ARCHITECTURE.md §1.5, §6.2): the game runs and is viable. A playtest agent plays it headless;
// any thrown step, NaN state, runaway entities or event storm, or a game that is lost the moment it starts, blocks
// publishing. When the playbots' report is given, the game must also be playable: the player can act, the bot its
// modes name (card.mode.bot) plays it, and progress toward a win happens. No time-to-finish requirement.
const CRASH = new Set(['runtime_error', 'non_finite', 'entity_explosion', 'event_storm', 'instant_loss']);
// Only the game running can crash a game: a verifier stage that throws (plot, spatial, strategies) is our bug, reported, never blocking.
/** @type {Set<string | undefined>} */
const GAME_STAGES = new Set(['playtest', 'invariants', undefined]);
/** A strategy run as v2/verify reports it. @typedef {{ id: string, reason?: string, ok?: boolean, proven?: string[], metrics?: Record<string, unknown> | null, error?: string }} BotRun */
/** @param {unknown} v @returns {v is { score?: { high?: unknown } }} */
const isTimeline = v => typeof v === 'object' && v !== null;
/**
 * @param {unknown} play the playtest result, when one ran @param {VerifyProblem[]} [problems]
 * @param {{ ran?: BotRun[] } | null} [strategies] the strategies stage's report; given, the playability checks apply
 * @returns {{ viable: boolean, viability: string | null }}
 */
export function viability(play, problems = [], strategies) {
  const why = problems.filter(p => CRASH.has(p.code) && p.severity !== 'warning' && p.severity !== 'info' && GAME_STAGES.has(p.stage)).map(p => `${p.code}: ${p.message}`);
  if (strategies !== undefined && !why.length) why.push(...unplayable(play, problems, strategies));
  return why.length ? { viable: false, viability: why.slice(0, 3).join('; ') } : { viable: true, viability: null };
}

/** @param {unknown} play @param {VerifyProblem[]} problems @param {{ ran?: BotRun[] } | null} strategies @returns {string[]} */
function unplayable(play, problems, strategies) {
  const pt = /** @type {{ winnable?: unknown, explored?: unknown, timeline?: unknown, idle?: unknown } | null} */ (isObjLike(play) ? play : null);
  if (!pt) return ['not_played: the playtest agent did not play the game'];
  const stuck = problems.find(p => p.code === 'stuck_state');
  if (stuck || (typeof pt.explored === 'number' && pt.explored <= 1)) return [`cannot_act: ${stuck?.message || 'no input moves the game past its first state'}`];
  const bots = (strategies?.ran || []).filter(r => String(r.reason || '').startsWith('mode '));
  if (!bots.length) return ['no_mode_bot: nothing in the game declares its core loop (card.mode), so no bot can prove it plays'];
  // Progress is objective score play reaches beyond what doing nothing reaches (an intro beat is not progress).
  const high = isTimeline(pt.timeline) ? Number(/** @type {{ score?: { high?: unknown } }} */ (pt.timeline).score?.high ?? NaN) : NaN;
  const idle = Number(/** @type {{ idle?: { score?: unknown } }} */ (pt).idle?.score ?? 0);
  const progressed = Boolean(pt.winnable) || (Number.isFinite(high) && high > idle);
  /** @type {string[]} */
  const out = [];
  for (const b of bots) {
    if (b.error) out.push(`bot_failed: the ${b.id} bot (${b.reason}) threw: ${b.error}`);
    else if (b.metrics && 'skipped' in b.metrics) out.push(`mode_absent: the ${b.id} bot (${b.reason}) found nothing to play (${b.metrics.skipped})`);
    else if (!(b.proven || []).length && !progressed) out.push(`no_progress: the ${b.id} bot (${b.reason}) and the explorer made no progress toward a win`);
  }
  return out;
}
/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObjLike = v => typeof v === 'object' && v !== null;

/**
 * @param {unknown} doc a document (preflighted here) @param {RegistryLike} registry @param {LogicLike} logic
 * @param {{ budgetMs?: number, maxStates?: number, playtestMs?: number | null }} [opts]
 * @returns {Promise<Verification>}
 */
export async function verifyDocument(doc, registry, logic, { budgetMs = 1500, maxStates = 20000, playtestMs = null } = {}) {
  const started = performance.now();
  const pre = preflight(doc, registry, logic);
  const summary = { ok: pre.ok, errors: pre.errors, warnings: pre.warnings, ms: pre.ms };
  if (!pre.ok) return { ok: false, completable: null, exhaustive: false, source: 'preflight', preflight: summary, problems: [], doc: null, ms: Math.round(performance.now() - started) };
  // source is set by every return below.
  const out = { ok: pre.ok, completable: null, exhaustive: false, source: 'preflight', preflight: summary, problems: /** @type {VerifyProblem[]} */ ([]), doc: pre.doc };
  // An empty world can be "completable" (zones are rects, the solver walks the map's solid edges): flag it.
  const world = worldCheck(pre.doc, registry, logic);
  out.problems.push(...world);
  const m = await verifyModule();
  if (typeof m.verify === 'function') {
    try {
      const r = await m.verify(pre.doc, registry, logic, { budgetMs: budgetMs + (playtestMs || 0), seed: pre.doc.seed, plot: { maxStates }, ...(playtestMs ? { playtest: { budgetMs: playtestMs } } : {}) });
      const solved = r?.plot || r?.solve || r;
      // ok stays "the document is valid and runs"; verified is the layer's own verdict (no error-severity problem).
      const problems = [...world, ...(r?.problems || [])];
      const pt = r?.playtest;
      /** @type {Verification} */
      const result = { ...out, ok: !(r?.problems || []).some(p => p.stage === 'preflight' && p.severity === 'error'), verified: world.length ? false : r?.ok ?? null, completable: solved?.completable ?? null, exhaustive: Boolean(solved?.exhaustive), source: 'verify',
        playtest: pt ? { winnable: pt.winnable, win: pt.win, losses: pt.losses, idle: pt.idle, explored: pt.explored, framesSimulated: pt.framesSimulated ?? null, timeline: pt.timeline ?? null, sample: (pt.sample || []).map(c => ({ key: c.key, frames: c.frames, score: c.score })) } : null,
        ...(playtestMs ? viability(pt, problems, r?.strategies ?? null) : viability(pt, problems)),
        solve: solved ? { completable: solved.completable, exhaustive: solved.exhaustive, endings: solved.endings || {}, beatsNeverFired: solved.beatsNeverFired || [], states: solved.states ?? null } : null,
        problems, timings: r?.timings || null, ms: Math.round(performance.now() - started) };
      // The full playtest (archive snapshots included) stays in memory for quality measurements (v2/verify/quality.js); it is never serialized.
      if (pt) Object.defineProperty(result, 'playtestRun', { value: pt, enumerable: false });
      return result;
    } catch (error) { out.problems.push({ code: 'verify_threw', message: errorText(error).slice(0, 200) }); }
  }
  try {
    const s = solve(pre.doc, registry, logic, { budgetMs, maxStates });
    return { ...out, source: 'solve', completable: s.completable, exhaustive: s.exhaustive, solve: s, ms: Math.round(performance.now() - started) };
  } catch (error) {
    return { ...out, ok: false, source: 'solve', problems: [...out.problems, { code: 'solve_threw', message: errorText(error).slice(0, 200) }], ms: Math.round(performance.now() - started) };
  }
}

/** @typedef {{ problems?: VerifyProblem[], ms?: number, unreachable?: unknown }} PlotGraph */
/** @typedef {{ available: boolean, problems: VerifyProblem[], ms: number, unreachable?: unknown }} StaticPlot */
/** @type {{ plotGraph?: (doc: Doc, logic: LogicLike) => PlotGraph } | null} */
let graphMod = null;
/**
 * Static plot analysis in milliseconds, before any simulation: plotGraph (v2/primitives/plot/story-graph.js)
 * when that primitive area provides it. -> { available, problems: [{ code, path, message, hint, severity, stage: 'plotGraph' }], ms }
 */
/** @param {Doc} doc @param {LogicLike} logic @returns {Promise<StaticPlot>} */
export async function staticPlot(doc, logic) {
  graphMod ??= await import('../primitives/plot/story-graph.js').then(m => /** @type {{ plotGraph?: (doc: Doc, logic: LogicLike) => PlotGraph }} */ (m)).catch(() => ({}));
  if (typeof graphMod.plotGraph !== 'function') return { available: false, problems: [], ms: 0 };
  try { const g = graphMod.plotGraph(doc, logic); return { available: true, problems: (g.problems || []).map(p => ({ ...p, stage: 'plotGraph' })), ms: Math.round(g.ms ?? 0), unreachable: g.unreachable }; }
  catch (error) { return { available: true, problems: [{ code: 'plot_graph_error', path: 'plot', message: errorText(error).slice(0, 200), severity: 'warning', stage: 'plotGraph' }], ms: 0 }; }
}

/** @param {WithProblems} v */
const errorsOf = v => new Set((v?.problems || []).filter(p => p.severity === 'error').map(p => `${p.code}|${p.path}`));
/** Problems of any severity a change introduced (context for model repair rounds). */
export const newProblems = (/** @type {WithProblems} */ before, /** @type {WithProblems} */ after) => { const b = new Set((before?.problems || []).map(p => `${p.code}|${p.path}`)); return (after?.problems || []).filter(p => !b.has(`${p.code}|${p.path}`)); };
/** Error problems whose code the baseline never had at any path (limits shared with a baseline are not the draft's fault). */
export const newErrorCodes = (/** @type {WithProblems} */ before, /** @type {WithProblems} */ after) => { const b = new Set((before?.problems || []).filter(p => p.severity === 'error').map(p => p.code)); return (after?.problems || []).filter(p => p.severity === 'error' && !b.has(p.code)); };
/** Error problems a change introduced (code|path not present before). */
export const newErrors = (/** @type {WithProblems} */ before, /** @type {WithProblems} */ after) => { const b = errorsOf(before); return (after?.problems || []).filter(p => p.severity === 'error' && !b.has(`${p.code}|${p.path}`)); };
/**
 * A verified change must not turn a game that provably could be finished into one that provably cannot,
 * nor add error-severity verification problems (softlocks, nondeterminism, runtime errors...) it didn't have.
 */
export const regressed = (/** @type {(Verification | { completable?: boolean | null, exhaustive?: boolean, problems?: VerifyProblem[] }) | null | undefined} */ before, /** @type {Verification | { completable?: boolean | null, exhaustive?: boolean, problems?: VerifyProblem[] } | null | undefined} */ after) => (before?.completable === true && after?.completable === false && after?.exhaustive === true) || (before ? newErrors(before, after).length > 0 : false);
