// Headless playtest: Go-Explore snapshot search over any document. Cells are
// (space, quantized player position, progress bucket); each round restores a
// promising or novel cell and plays a few macros from it: the options the
// primitives expose, or generic input macros (held axes and verbs) when there
// are none. Progress is the document's own objective (objective.js) plus a
// pull toward the zones the plot points at. Every macro is checked against
// the runtime invariants; any win is replayed from a fresh world to prove it.
import { maker, hold, applyOption, optionLabels, inputMacros, posOf } from './drive.js';
import { objective, plotZones, PROGRESS_EVENTS } from './objective.js';
import { stepChecker } from './invariants.js';
import { withTravel } from './macros.js';
import { prng, problem, budget as makeBudget, walkJson } from './util.js';

const DT = 1 / 60;

function cellKeyOf(rt, score, quantum) {
  const p = rt.player();
  const at = posOf(rt, p);
  const q = Array.isArray(at) ? at.map(v => Math.floor(v / quantum)).join(',') : String(at);
  return `${p?.space}|${q}|${Math.round(score * 2) / 2}|${rt.state.status}`;
}

/**
 * Replay a playtest path [{o:label}|{i:input,n:frames}] from a fresh world.
 * onRecord(rt, record) runs before each record; onFrame(rt) after every step (macro steps included).
 */
export function replayPlay(make, seed, path, { onFrame = null, onRecord = null } = {}) {
  const rt = make(seed);
  if (onFrame) { const step = rt.step; rt.step = input => { const s = step(input); onFrame(rt); return s; }; }
  for (const r of path) {
    if (rt.state.status !== 'playing') break;
    onRecord?.(rt, r);
    if (r.o !== undefined) { const options = rt.availableOptions(), j = optionLabels(options).indexOf(r.o); if (j < 0) break; applyOption(rt, options[j]); }
    else { hold(rt, r.i, r.n); hold(rt, {}, 1); }
  }
  return rt;
}

const round = (v, d = 2) => (Number.isFinite(v) ? +v.toFixed(d) : null);

/** Event names that count as progress: the objective's weighted events (wildcards end in ':') plus events the plot counts. */
export function progressMatcher(doc, weights = PROGRESS_EVENTS) {
  const exact = new Set(Object.keys(weights).filter(k => !k.endsWith(':'))), prefixes = Object.keys(weights).filter(k => k.endsWith(':'));
  walkJson(doc.plot || {}, o => { if (typeof o.count === 'string') exact.add(o.count); });
  return name => exact.has(name) || prefixes.some(p => name.startsWith(p));
}

/**
 * Replay one path frame by frame and keep a compact progress timeline: progress marks (a progress event,
 * or the document objective reaching a new high by `step`), stretches of at least `deadFrames` with no
 * player movement and no event besides `action` (dead time), and the cells, zones, event names and choice
 * labels the path touched. Returns the timeline plus the replayed world as `rt` (callers drop it).
 */
export function progressTimeline(make, seed, path, { goal, isProgress, quantum = 1, source = 'path', step = 0.1, deadFrames = 30, maxMarks = 120, maxStretches = 40, maxNames = 60 } = {}) {
  const marks = [], dead = [], zones = new Set(), cells = new Set(), names = new Set(), labels = new Set();
  let prev = null, prevPos = null, high = 0, start = 0, still = null, deadTotal = 0, marksTotal = 0, stretches = 0, longest = 0;
  const posKey = (rt, q) => {
    const p = rt.player(), at = posOf(rt, p);
    if (at == null) return null;
    return `${p.space}|${Array.isArray(at) ? at.map(v => (q ? Math.floor(v / q) : round(v, 3))).join(',') : String(at)}`;
  };
  const init = rt => { prev = { ...rt.state.counts }; prevPos = posKey(rt, 0); high = start = goal.score(rt); };
  const close = f => {
    if (still == null) return;
    const len = f - still;
    if (len >= deadFrames) { stretches++; deadTotal += len; longest = Math.max(longest, len); if (dead.length < maxStretches) dead.push([still, len]); }
    still = null;
  };
  const onFrame = rt => {
    if (!prev) init(rt);
    const c = rt.state.counts, f = rt.state.frame;
    let active = false, hit = null;
    for (const k in c) {
      if (c[k] <= (prev[k] || 0)) continue;
      if (k !== 'action') active = true;
      if (names.size < maxNames) names.add(k);
      if (!hit && isProgress(k)) hit = k;
    }
    prev = { ...c };
    const pos = posKey(rt, 0);
    if (pos !== prevPos) active = true;
    prevPos = pos;
    const cell = posKey(rt, quantum); if (cell) cells.add(cell);
    const z = rt.player()?.zone; if (z && zones.size < maxNames) zones.add(z);
    const sc = goal.score(rt);
    if (!hit && sc >= high + step) hit = 'objective';
    if (sc > high) high = sc;
    if (hit) { marksTotal++; if (marks.length < maxMarks) marks.push({ f, e: hit }); }
    if (active) close(f); else still ??= f;
  };
  const onRecord = (rt, r) => { if (!prev) init(rt); if (labels.size < maxNames) labels.add(r.o ?? r.label ?? 'input'); };
  const rt = replayPlay(make, seed, path, { onFrame, onRecord });
  const frames = rt.state.frame;
  close(frames);
  return {
    source, frames, seconds: round(frames * DT), status: rt.state.status, ending: rt.state.ending ?? null, records: path.length,
    marks, marksTotal, dead, deadFrames: deadTotal, deadStretches: stretches, longestDeadFrames: longest, deadThresholdFrames: deadFrames,
    cells: cells.size, zones: [...zones], eventNames: [...names], labels: [...labels],
    score: { start: round(start), high: round(high) }, truncated: marksTotal > marks.length || stretches > dead.length, rt,
  };
}

/**
 * playtest(doc, registry, logic, opts) → report
 * opts: { seed, budgetMs, maxFrames, maxRounds, idleSeconds, quantum, macros, limits, sampleSize, timeline }
 * Besides the verdict it returns `timeline` (progressTimeline of the winning path, else of the best-scoring
 * archived path; null when that path is empty), `verbsUsed` (verbs the search pressed, by count) and
 * `sample`: a few archive cells { key, frames, score, path, snap } spread over the search, for quality
 * measurements (v2/verify/quality.js) to restore.
 */
export function playtest(doc, registry, logic, opts = {}) {
  const { seed, budgetMs = 1500, maxFrames = 200000, maxRounds = Infinity, idleSeconds = 10, quantum = 1, limits } = opts;
  const b = makeBudget({ ms: budgetMs, steps: maxFrames, states: maxRounds });
  // Spaces without options get steered travel macros (real controls, never warps): they extend the
  // reach of the random macros without claiming anything the controls cannot do.
  let make = maker(doc, registry, logic), travel = null;
  if (opts.travel !== false) {
    const probe = make(seed), p = probe.player();
    if (!probe.availableOptions().length && p?.space && typeof probe.space(p.space).path === 'function') { travel = withTravel(make, registry, { mode: 'steer' }); make = travel.make; }
  }
  const goal = objective(doc, registry, logic);
  const targets = [...plotZones(doc).keys()];
  const rand = prng(`playtest:${seed ?? doc.seed ?? doc.id}`);
  const problems = [], fired = {};
  // state.events holds only the last step's events (world.js clears them every step): count counts deltas instead.
  const verbs = {};
  const record = (rt, before = {}) => { const c = rt.state.counts; for (const k in c) { const d = c[k] - (before[k] || 0); if (d > 0) fired[k] = (fired[k] || 0) + d; } };
  const used = actions => { for (const [v, val] of Object.entries(actions || {})) if (val !== undefined && val !== null && val !== false) verbs[v] = (verbs[v] || 0) + 1; };
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
  // The objective score doing nothing reaches (intro beats, ambient events): progress is only what play adds to it.
  let idleScore = null;
  try { idleScore = round(goal.score(idle)); } catch {}
  if (idle.state.status === 'won') problems.push(problem('trivially_won', 'plot.endings', `the game is won after ${idle.state.time.toFixed(1)} s with no input`, { hint: 'endings must require player action' }));
  if (idle.state.status === 'lost' && idle.state.time < 2) problems.push(problem('instant_loss', 'systems', `the game is lost after ${idle.state.time.toFixed(2)} s with no input`, { hint: 'give the player a grace period: spawn hazards away from the start' }));

  // 2. Search.
  const start = make(seed);
  const checker = stepChecker(limits);
  const startScore = score(start);
  const startKey = cellKeyOf(start, startScore, quantum);
  const archive = new Map([[startKey, { key: startKey, snap: start.snapshot(), path: [], frames: 0, visits: 0, score: startScore }]]);
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
      const f0 = rt.state.frame, c0 = { ...rt.state.counts };
      try {
        if (options.length && (opts.optionsOnly || rand() < 0.75)) { const labels = optionLabels(options), j = rand.int(options.length); rec = { o: labels[j] }; used(options[j].actions); applyOption(rt, options[j]); }
        else { const macros = opts.macros || inputMacros(rt); const m = macros[rand.int(macros.length)], len = 4 + rand.int(32); rec = { i: m.input, n: len, label: m.label }; used(m.input.actions); hold(rt, m.input, len); hold(rt, {}, 1); }
      } catch (error) {
        problems.push(problem('runtime_error', 'systems', `step threw at frame ${rt.state.frame}: ${error?.message || error}`, { repro: [...path, rec].filter(Boolean) }));
        broke = true; break;
      }
      b.step(rt.state.frame - f0); frames += rt.state.frame - f0;
      record(rt, c0);
      path.push(rec);
      const bad = checker.check(rt);
      if (bad) { problems.push({ ...bad, repro: path.slice() }); broke = true; break; }
      if (rt.state.status === 'won') { if (!win || frames < win.frames) win = { frames, path: path.slice(), ending: rt.state.ending }; broke = !opts.keepSearching; break; }
      if (rt.state.status === 'lost') { const why = rt.state.ending || rt.state.events.at(-1)?.name || 'lost'; losses[why] = (losses[why] || 0) + 1; break; }
      const sc = score(rt), key = cellKeyOf(rt, sc, quantum), old = archive.get(key);
      if (!old || frames < old.frames) archive.set(key, { key, snap: rt.snapshot(), path: path.slice(), frames, visits: old?.visits || 0, score: sc });
    }
  }

  // 3. Determinism: the winning path must replay to a win. The same replay (without a win, a replay of the
  // best-scoring archived path) records the frame-level progress timeline.
  const best = [...archive.values()].reduce((m, c) => (c.score > m.score ? c : m), { score: -Infinity, path: [] });
  const timelinePath = win ? win.path : best.path;
  let timeline = null, replayed = null;
  if (opts.timeline !== false && timelinePath.length) {
    try { timeline = progressTimeline(make, seed, timelinePath, { goal, isProgress: progressMatcher(doc), quantum, source: win ? 'win' : 'best' }); }
    catch { timeline = null; } // a throw here replays a path the search already ran; its problem is reported there
  }
  if (win) {
    const r = timeline?.rt ?? replayPlay(make, seed, win.path);
    replayed = r.state.status === 'won';
    if (!replayed) problems.push(problem('nondeterministic', '$', 'the winning input path did not reproduce the win on replay', { repro: win.path, hint: 'simulation must depend only on rt.state, inputs and rt.random()' }));
  } else if (!problems.some(p => p.severity === 'error') && (doc.plot?.endings || []).length) {
    problems.push(problem('goal_not_reached', 'plot.endings', `the playtest did not reach an ending within its budget (${archive.size} cells, ${rounds} rounds, stopped by ${b.hit || 'limit'})`, { severity: 'warning', hint: 'budget-limited: not a proof of a softlock' }));
  }
  // Events the document refers to (count predicates) that never happened in play.
  const referenced = new Map();
  walkJson(doc.plot || {}, (o, path) => { if (typeof o.count === 'string' && !referenced.has(o.count)) referenced.set(o.count, `plot.${path}`); });
  for (const [ev, path] of referenced) if (!fired[ev]) problems.push(problem('event_never_seen', path, `'${ev}' never happened during the playtest`, { severity: 'info' }));

  if (timeline) delete timeline.rt;
  // A small archive sample spread over discovery order (the start cell first), plus the best cell.
  const cells = [...archive.values()], k = Math.min(opts.sampleSize ?? 6, cells.length), picked = new Set();
  for (let i = 0; i < k; i++) picked.add(cells[Math.floor(i * cells.length / k)]);
  if (best.snap) picked.add(best);
  const sample = [...picked].map(c => ({ key: c.key, frames: c.frames, score: round(c.score), path: c.path, snap: c.snap }));
  return {
    ok: !problems.some(p => p.severity === 'error'),
    winnable: Boolean(win),
    win: win ? { frames: win.frames, seconds: +(win.frames * DT).toFixed(2), ending: win.ending, path: win.path.map(r => r.o ?? `${r.label}×${r.n}`), replayed } : null,
    idle: { status: idle.state.status, seconds: +idle.state.time.toFixed(2), score: idleScore },
    explored: archive.size, rounds, framesSimulated: b.usedSteps, bestScore: best.score, travel: travel ? 'steer' : null,
    losses, eventsFired: fired, verbsUsed: verbs, timeline, sample, exhaustive: false, budget: b.report(), problems,
  };
}
