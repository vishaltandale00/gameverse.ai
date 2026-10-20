// Verification for generated documents. Uses v2/verify's `verify` export when that
// workstream provides one (feature-detected, never assumed), otherwise preflight plus
// the plot solver (v2/verify/solve.js). Always returns one shape:
//   { ok, completable, exhaustive, source, preflight: { ok, errors, warnings, ms }, solve?, problems, ms }
import { preflight } from '../kernel/document.js';
import { solve } from '../verify/solve.js';

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
  const m = await verifyModule();
  if (typeof m.verify === 'function') {
    try {
      const r = await m.verify(pre.doc, registry, logic, { budgetMs, maxStates });
      const solved = r?.solve || r?.plot || r;
      return { ...out, ok: r?.ok !== false, completable: solved?.completable ?? r?.completable ?? null, exhaustive: Boolean(solved?.exhaustive), source: 'verify', report: r,
        problems: (r?.problems || r?.errors || []).slice(0, 20), ms: Math.round(performance.now() - started) };
    } catch (error) { out.problems.push({ code: 'verify_threw', message: String(error?.message || error).slice(0, 200) }); }
  }
  try {
    const s = solve(pre.doc, registry, logic, { budgetMs, maxStates });
    return { ...out, source: 'solve', completable: s.completable, exhaustive: s.exhaustive, solve: s, ms: Math.round(performance.now() - started) };
  } catch (error) {
    return { ...out, ok: false, source: 'solve', problems: [...out.problems, { code: 'solve_threw', message: String(error?.message || error).slice(0, 200) }], ms: Math.round(performance.now() - started) };
  }
}

/** A verified change must not turn a game that provably could be finished into one that provably cannot. */
export const regressed = (before, after) => before?.completable === true && after?.completable === false && after?.exhaustive === true;
