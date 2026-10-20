// Plot verification = static checks on the plot data + the dynamic solver.
// Static checks come from the plot workstream's plotGraph(doc, logic) in
// v2/primitives/plot/story-graph.js when it exists (feature-detected with a
// dynamic import), plus the verifier's own structural checks of the catalog
// plot shapes (beat prerequisite cycles and ordering across sequential acts).
import { solve } from './solve.js';
import { problem } from './util.js';

let graphModule;
/** Load plotGraph if the plot workstream has shipped it; null otherwise. */
export async function loadPlotGraph() {
  if (graphModule === undefined) {
    try { graphModule = await import('../primitives/plot/story-graph.js'); }
    catch { graphModule = null; }
  }
  const fn = graphModule?.plotGraph || graphModule?.default?.plotGraph || (typeof graphModule?.default === 'function' ? graphModule.default : null);
  return typeof fn === 'function' ? fn : null;
}

/** Structural checks the verifier owns: `after` cycles, prerequisites in later sequential acts. */
export function beatStructure(doc, registry) {
  const out = [], acts = doc.plot?.storyboard?.acts || [];
  const where = new Map();
  acts.forEach((a, i) => (a.beats || []).forEach((b, j) => where.set(b.id, { i, j, b })));
  const sequential = (doc.systems || []).find(s => s.use === 'plot.storyboard')?.with?.sequentialActs ?? registry?.get('plot.storyboard')?.card.params?.sequentialActs?.default ?? true;
  // Cycles through `after`.
  const state = new Map();
  const visit = (id, stack) => {
    if (state.get(id) === 2) return; if (state.get(id) === 1) { const cyc = stack.slice(stack.indexOf(id)); const w = where.get(id); out.push(problem('beat_cycle', `plot.storyboard.acts[${w.i}].beats[${w.j}].after`, `beats wait on each other in a cycle: ${[...cyc, id].join(' → ')}`, { hint: 'remove one of the `after` links' })); return; }
    state.set(id, 1);
    for (const d of where.get(id)?.b.after || []) if (where.has(d)) visit(d, [...stack, id]);
    state.set(id, 2);
  };
  for (const id of where.keys()) visit(id, []);
  if (sequential) for (const [id, w] of where) for (const d of w.b.after || []) {
    const dw = where.get(d);
    if (dw && dw.i > w.i && !w.b.optional) out.push(problem('beat_order', `plot.storyboard.acts[${w.i}].beats[${w.j}].after`, `beat '${id}' in act ${w.i + 1} waits for '${d}' in a later act; with sequential acts act ${w.i + 1} never completes`, { hint: `move '${d}' earlier, mark '${id}' optional, or set sequentialActs false` }));
  }
  return out;
}

/** Static plot analysis: { available, graph?, problems }. */
export async function staticPlot(doc, registry, logic, { plotGraph: injected = null } = {}) {
  const problems = beatStructure(doc, registry);
  const plotGraph = injected || await loadPlotGraph();
  if (!plotGraph) return { available: false, problems };
  try {
    const g = await plotGraph(doc, logic, { registry });
    for (const p of g?.problems || []) problems.push(problem(p.code || 'plot_graph', p.path, p.message || String(p.code), { hint: p.hint, severity: p.severity || 'error', source: 'plotGraph' }));
    return { available: true, graph: { nodes: g?.nodes?.length ?? (g?.nodes ? Object.keys(g.nodes).length : null), edges: g?.edges?.length ?? null, approximation: g?.approximation ?? null, unreachable: g?.unreachable ?? null }, problems };
  } catch (error) {
    problems.push(problem('plot_graph_error', 'plot', `plotGraph threw: ${error?.message || error}`, { severity: 'warning' }));
    return { available: true, problems };
  }
}

/** Translate a solver result into problems with document paths. */
export function solverProblems(doc, r) {
  const out = [];
  const certain = r.exhaustive;
  const sev = certain ? 'error' : 'warning';
  const why = certain ? 'no sequence of player options reaches it (exhaustive search)' : `not reached within the search budget (${r.states} states, stopped by ${r.budget.limit || 'depth'})`;
  if (r.startOptions === 0) { out.push(problem('solver_no_options', 'systems', 'no primitive offers player options at the start, so the plot solver cannot search; only the playtest covers this game', { severity: 'info', hint: 'expose rt.options() (macro options for continuous spaces)' })); return out; }
  const declared = doc.plot?.endings || [];
  if (declared.length && !r.completable) out.push(problem(certain ? 'plot_uncompletable' : 'plot_unproven', 'plot.endings', `no ending is reachable: ${why}`, { severity: sev, hint: 'check gates, key items and beat triggers on the path to an ending' }));
  declared.forEach((e, i) => { if (r.unreachedEndings.includes(e.id) && r.completable) out.push(problem('ending_unreachable', `plot.endings[${i}]`, `ending '${e.id}' is ${why}`, { severity: certain ? 'warning' : 'info', hint: 'make its trigger reachable or remove it' })); });
  (doc.plot?.storyboard?.acts || []).forEach((a, i) => (a.beats || []).forEach((b, j) => {
    if (r.beatsNeverFired.includes(b.id) && !b.optional) out.push(problem('beat_unreachable', `plot.storyboard.acts[${i}].beats[${j}]`, `beat '${b.id}' never fires: ${why}`, { severity: certain && !r.completable ? 'error' : certain ? 'warning' : 'info', hint: 'its `when` or `after` can never hold on any explored path' }));
  }));
  if (r.deadEndCount) out.push(problem('softlock', 'spaces', `${r.deadEndCount} reachable state(s) offer no options while the game is still running, e.g. after: ${r.deadEnds[0].join(' → ') || '(start)'}`, { severity: 'error', repro: r.deadEnds[0], hint: 'add a way back (exit, portal) or end the game there' }));
  for (const e of r.errors) out.push(problem('runtime_error', 'systems', `an option threw: ${e.message}`, { severity: 'error', repro: e.path }));
  if (r.replayed === false) out.push(problem('nondeterministic', '$', 'the shortest ending path did not reproduce its ending on replay from a fresh world', { severity: 'error', hint: 'simulation must use rt.random() and rt.state only' }));
  return out;
}

/** Full plot stage: static + dynamic. */
export async function verifyPlot(doc, registry, logic, opts = {}) {
  const st = await staticPlot(doc, registry, logic, { plotGraph: opts.plotGraph });
  const r = solve(doc, registry, logic, opts);
  return { ...r, static: { available: st.available, graph: st.graph }, problems: [...st.problems, ...solverProblems(doc, r)] };
}
