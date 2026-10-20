// Headless playtest: Go-Explore snapshot search over any document. Cells are
// (space, quantized player position, progress bucket); each round restores a
// promising or novel cell and plays a few macros from it: the options the
// primitives expose, or generic input macros (held axes and verbs) when there
// are none. Progress is the document's own objective (objective.js) plus a
// pull toward the zones the plot points at. Every macro is checked against
// the runtime invariants; any win is replayed from a fresh world to prove it.
import { maker, hold, applyOption, optionLabels, inputMacros, posOf } from './drive.js';
import { objective, plotZones } from './objective.js';
import { stepChecker } from './invariants.js';
import { prng, problem, budget as makeBudget, walkJson } from './util.js';

const DT = 1 / 60;

function cellKeyOf(rt, score, quantum) {
  const p = rt.player();
  const at = posOf(rt, p);
  const q = Array.isArray(at) ? at.map(v => Math.floor(v / quantum)).join(',') : String(at);
  return `${p?.space}|${q}|${Math.round(score * 2) / 2}|${rt.state.status}`;
}

/** Replay a playtest path [{o:label}|{i:input,n:frames}] from a fresh world. */
export function replayPlay(make, seed, path) {
  const rt = make(seed);
  for (const r of path) {
    if (rt.state.status !== 'playing') break;
    if (r.o !== undefined) { const options = rt.availableOptions(), j = optionLabels(options).indexOf(r.o); if (j < 0) break; applyOption(rt, options[j]); }
    else { hold(rt, r.i, r.n); hold(rt, {}, 1); }
  }
  return rt;
}

/**
 * playtest(doc, registry, logic, opts) → report
 * opts: { seed, budgetMs, maxFrames, maxRounds, idleSeconds, quantum, macros, limits }
 */
export function playtest(doc, registry, logic, opts = {}) {
  const { seed, budgetMs = 1500, maxFrames = 200000, maxRounds = Infinity, idleSeconds = 10, quantum = 1, limits } = opts;
  const b = makeBudget({ ms: budgetMs, steps: maxFrames, states: maxRounds });
  const make = maker(doc, registry, logic);
  const goal = objective(doc, registry, logic);
  const targets = [...plotZones(doc).keys()];
  const rand = prng(`playtest:${seed ?? doc.seed ?? doc.id}`);
  const problems = [], fired = {};
  const record = rt => { for (const e of rt.state.events) fired[e.name] = (fired[e.name] || 0) + 1; };
  const score = rt => {
    let v = goal.score(rt);
    const p = rt.player();
    if (p?.space && targets.length) {
      const api = rt.space(p.space);
      let best = Infinity;
      for (const z of targets) { if (api.inZone?.(p, z, rt)) continue; const d = api.nearest?.(p, z, rt); if (d != null && d < best) best = d; }
      if (Number.isFinite(best)) v += Math.max(0, 16 - best) / 16;
    }
    return v;
  };

  // 1. Idle: what happens if the player does nothing?
  const idle = make(seed);
  const idleFrames = Math.round(idleSeconds / DT);
  try { hold(idle, {}, idleFrames, b); record(idle); }
  catch (error) { problems.push(problem('runtime_error', 'systems', `idle run threw at frame ${idle.state.frame}: ${error?.message || error}`)); }
  if (idle.state.status === 'won') problems.push(problem('trivially_won', 'plot.endings', `the game is won after ${idle.state.time.toFixed(1)} s with no input`, { hint: 'endings must require player action' }));
  if (idle.state.status === 'lost' && idle.state.time < 2) problems.push(problem('instant_loss', 'systems', `the game is lost after ${idle.state.time.toFixed(2)} s with no input`, { hint: 'give the player a grace period: spawn hazards away from the start' }));

  // 2. Search.
  const start = make(seed);
  const checker = stepChecker(limits);
  const startScore = score(start);
  const archive = new Map([[cellKeyOf(start, startScore, quantum), { snap: start.snapshot(), path: [], frames: 0, visits: 0, score: startScore }]]);
  const rt = start;
  let win = null, rounds = 0, broke = false;
  const losses = {};
  while (!b.over() && !broke) {
    rounds++; b.state();
    const cells = [...archive.values()];
    let cell;
    if (rand() < 0.5) { const best = [...cells].sort((x, y) => y.score - x.score).slice(0, 10); cell = best[rand.int(best.length)]; }
    else {
      const lo = Math.min(...cells.map(c => c.score));
      let total = 0; const w = cells.map(c => (total += (1 + c.score - lo) ** 2 / Math.sqrt(c.visits + 1)));
      const pick = rand() * total; cell = cells[w.findIndex(x => x >= pick)] || cells[0];
    }
    cell.visits++;
    rt.restore(cell.snap);
    const path = cell.path.slice();
    let frames = cell.frames;
    const n = 1 + rand.int(4);
    for (let k = 0; k < n; k++) {
      const options = rt.availableOptions();
      let rec;
      const f0 = rt.state.frame;
      try {
        if (options.length && (opts.optionsOnly || rand() < 0.75)) { const labels = optionLabels(options), j = rand.int(options.length); rec = { o: labels[j] }; applyOption(rt, options[j]); }
        else { const macros = opts.macros || inputMacros(rt); const m = macros[rand.int(macros.length)], len = 4 + rand.int(32); rec = { i: m.input, n: len, label: m.label }; hold(rt, m.input, len); hold(rt, {}, 1); }
      } catch (error) {
        problems.push(problem('runtime_error', 'systems', `step threw at frame ${rt.state.frame}: ${error?.message || error}`, { repro: [...path, rec].filter(Boolean) }));
        broke = true; break;
      }
      b.step(rt.state.frame - f0); frames += rt.state.frame - f0;
      record(rt);
      path.push(rec);
      const bad = checker.check(rt);
      if (bad) { problems.push({ ...bad, repro: path.slice() }); broke = true; break; }
      if (rt.state.status === 'won') { if (!win || frames < win.frames) win = { frames, path: path.slice(), ending: rt.state.ending }; broke = !opts.keepSearching; break; }
      if (rt.state.status === 'lost') { const why = rt.state.ending || rt.state.events.at(-1)?.name || 'lost'; losses[why] = (losses[why] || 0) + 1; break; }
      const sc = score(rt), key = cellKeyOf(rt, sc, quantum), old = archive.get(key);
      if (!old || frames < old.frames) archive.set(key, { snap: rt.snapshot(), path: path.slice(), frames, visits: old?.visits || 0, score: sc });
    }
  }

  // 3. Determinism: the winning path must replay to a win.
  let replayed = null;
  if (win) {
    const r = replayPlay(make, seed, win.path);
    replayed = r.state.status === 'won';
    if (!replayed) problems.push(problem('nondeterministic', '$', 'the winning input path did not reproduce the win on replay', { repro: win.path, hint: 'simulation must depend only on rt.state, inputs and rt.random()' }));
  } else if (!problems.some(p => p.severity === 'error') && (doc.plot?.endings || []).length) {
    problems.push(problem('goal_not_reached', 'plot.endings', `the playtest did not reach an ending within its budget (${archive.size} cells, ${rounds} rounds, stopped by ${b.hit || 'limit'})`, { severity: 'warning', hint: 'budget-limited: not a proof of a softlock' }));
  }
  // Events the document refers to (count predicates) that never happened in play.
  const referenced = new Map();
  walkJson(doc.plot || {}, (o, path) => { if (typeof o.count === 'string' && !referenced.has(o.count)) referenced.set(o.count, `plot.${path}`); });
  for (const [ev, path] of referenced) if (!fired[ev]) problems.push(problem('event_never_seen', path, `'${ev}' never happened during the playtest`, { severity: 'info' }));

  const best = [...archive.values()].reduce((m, c) => (c.score > m.score ? c : m), { score: -Infinity });
  return {
    ok: !problems.some(p => p.severity === 'error'),
    winnable: Boolean(win),
    win: win ? { frames: win.frames, seconds: +(win.frames * DT).toFixed(2), ending: win.ending, path: win.path.map(r => r.o ?? `${r.label}×${r.n}`), replayed } : null,
    idle: { status: idle.state.status, seconds: +idle.state.time.toFixed(2) },
    explored: archive.size, rounds, framesSimulated: b.usedSteps, bestScore: best.score,
    losses, eventsFired: fired, exhaustive: false, budget: b.report(), problems,
  };
}
