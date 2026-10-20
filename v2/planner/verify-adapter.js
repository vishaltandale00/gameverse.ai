// Verification for generated documents. Uses v2/verify's `verify` export when that
// workstream provides one (feature-detected, never assumed), otherwise preflight plus
// the plot solver (v2/verify/solve.js). Always returns one shape:
//   { ok, verified?, completable, exhaustive, source, preflight: { ok, errors, warnings, ms }, solve?, problems, ms }
// Problems from v2/verify carry { code, path, message, hint, severity, stage } (PROBLEM_CODES).
import { preflight } from '../kernel/document.js';
import { solve } from '../verify/solve.js';
import { createWorld } from '../kernel/world.js';
import { worldProblems } from './world.js';

/** world_empty problems (v2/planner/world.js) for a preflighted document; a world that won't boot is reported elsewhere. */
function worldCheck(doc, registry, logic) {
  try { const rt = createWorld(doc, registry, logic, { seed: doc.seed }); for (let i = 0; i < 3 && rt.state.status === 'playing'; i++) rt.step(); return worldProblems(rt, doc, registry); }
  catch { return []; }
}

let loaded = null;
async function verifyModule() {
  if (loaded) return loaded;
  try { loaded = await import('../verify/index.js'); }
  catch (error) { if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error; loaded = {}; }
  return loaded;
}

export async function verifyDocument(doc, registry, logic, { budgetMs = 1500, maxStates = 20000 } = {}) {
  const started = performance.now();
  const pre = preflight(doc, registry, logic);
  const out = { ok: pre.ok, completable: null, exhaustive: false, source: 'preflight', preflight: { ok: pre.ok, errors: pre.errors, warnings: pre.warnings, ms: pre.ms }, problems: [], doc: pre.doc };
  if (!pre.ok) return { ...out, ms: Math.round(performance.now() - started) };
  // An empty world can be "completable" (zones are rects, the solver walks the map's solid edges): flag it.
  const world = worldCheck(pre.doc, registry, logic);
  out.problems.push(...world);
  const m = await verifyModule();
  if (typeof m.verify === 'function') {
    try {
      const r = await m.verify(pre.doc, registry, logic, { budgetMs, seed: pre.doc.seed, plot: { maxStates } });
      const solved = r?.plot || r?.solve || r;
      // ok stays "the document is valid and runs"; verified is the layer's own verdict (no error-severity problem).
      return { ...out, ok: !(r?.problems || []).some(p => p.stage === 'preflight' && p.severity === 'error'), verified: world.length ? false : r?.ok ?? null, completable: solved?.completable ?? null, exhaustive: Boolean(solved?.exhaustive), source: 'verify',
        solve: solved ? { completable: solved.completable, exhaustive: solved.exhaustive, endings: solved.endings || {}, beatsNeverFired: solved.beatsNeverFired || [], states: solved.states ?? null } : null,
        problems: [...world, ...(r?.problems || [])], timings: r?.timings || null, ms: Math.round(performance.now() - started) };
    } catch (error) { out.problems.push({ code: 'verify_threw', message: String(error?.message || error).slice(0, 200) }); }
  }
  try {
    const s = solve(pre.doc, registry, logic, { budgetMs, maxStates });
    return { ...out, source: 'solve', completable: s.completable, exhaustive: s.exhaustive, solve: s, ms: Math.round(performance.now() - started) };
  } catch (error) {
    return { ...out, ok: false, source: 'solve', problems: [...out.problems, { code: 'solve_threw', message: String(error?.message || error).slice(0, 200) }], ms: Math.round(performance.now() - started) };
  }
}

let graphMod = null;
/**
 * Static plot analysis in milliseconds, before any simulation: plotGraph (v2/primitives/plot/story-graph.js)
 * when that primitive area provides it. -> { available, problems: [{ code, path, message, hint, severity, stage: 'plotGraph' }], ms }
 */
export async function staticPlot(doc, logic) {
  graphMod ??= await import('../primitives/plot/story-graph.js').catch(() => ({}));
  if (typeof graphMod.plotGraph !== 'function') return { available: false, problems: [], ms: 0 };
  try { const g = graphMod.plotGraph(doc, logic); return { available: true, problems: (g.problems || []).map(p => ({ ...p, stage: 'plotGraph' })), ms: Math.round(g.ms ?? 0), unreachable: g.unreachable }; }
  catch (error) { return { available: true, problems: [{ code: 'plot_graph_error', path: 'plot', message: String(error?.message || error).slice(0, 200), severity: 'warning', stage: 'plotGraph' }], ms: 0 }; }
}

const errorsOf = v => new Set((v?.problems || []).filter(p => p.severity === 'error').map(p => `${p.code}|${p.path}`));
/** Problems of any severity a change introduced (context for model repair rounds). */
export const newProblems = (before, after) => { const b = new Set((before?.problems || []).map(p => `${p.code}|${p.path}`)); return (after?.problems || []).filter(p => !b.has(`${p.code}|${p.path}`)); };
/** Error problems whose code the baseline never had at any path (limits shared with a baseline are not the draft's fault). */
export const newErrorCodes = (before, after) => { const b = new Set((before?.problems || []).filter(p => p.severity === 'error').map(p => p.code)); return (after?.problems || []).filter(p => p.severity === 'error' && !b.has(p.code)); };
/** Error problems a change introduced (code|path not present before). */
export const newErrors = (before, after) => { const b = errorsOf(before); return (after?.problems || []).filter(p => p.severity === 'error' && !b.has(`${p.code}|${p.path}`)); };
/**
 * A verified change must not turn a game that provably could be finished into one that provably cannot,
 * nor add error-severity verification problems (softlocks, nondeterminism, runtime errors...) it didn't have.
 */
export const regressed = (before, after) => (before?.completable === true && after?.completable === false && after?.exhaustive === true) || (before ? newErrors(before, after).length > 0 : false);
