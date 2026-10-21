// Headless playtest: Go-Explore snapshot search over any document, played through the controls a person has
// (ARCHITECTURE.md §6.3): it plays the document the host mounts (v2/web/host-doc.js) on controlled worlds
// (v2/verify/controls.js), so every input it issues is a key, an axis or a mounted UI's action sampled through the host
// document's bindings, exactly as a person's would be. Cells are (space, quantized player position, progress bucket);
// each round restores a promising or novel cell and plays a few macros from it: the options the primitives expose (hints
// of what the controls issue: an option's actions go through the controls, a travel macro is held input along the
// space's path, an option no control can take is reported as controls_missing and never taken), or generic input
// macros (held axes and the verbs a key presses, a press going down once and staying held) when there are none.
// Progress is the document's own objective (objective.js) plus a pull toward the zones the plot points at, and the
// quantity the core loop's win reads (opts.win: winMeasure), which the search steers by and reports as `progress` (how
// far idling and play moved it toward the win). Every macro is checked against the runtime invariants; any win is
// replayed from a fresh world to prove it. The search is bounded by rounds and simulated frames, never wall time: the
// same document and seed always give the same report.
import { hold, holdInput, optionLabels, inputMacros, posOf } from './drive.js';
import { objective, plotZones, PROGRESS_EVENTS, winMeasure, WIN_WEIGHT, loopShown } from './objective.js';
import { stepChecker } from './invariants.js';
import { withTravel, takeOption, steerable } from './macros.js';
import { controlledMaker, hostPreflight } from './controls.js';
import { prng, problem, budget as makeBudget, walkJson } from './util.js';

/** The explorer's budget when its caller names none: rounds of the search and frames simulated (lookahead included). */
export const PLAYTEST_BUDGET = Object.freeze({ rounds: 1500, frames: 12000 });

const DT = 1 / 60;

function cellKeyOf(rt, score, quantum) {
  const p = rt.player();
  const at = posOf(rt, p);
  // Without an avatar (board, card and strategy games) there is no position to tell states apart: the seconds played
  // are, so a line of play that runs longer (orders playing out in real time) is kept instead of collapsing onto its start.
  const q = Array.isArray(at) ? at.map(v => Math.floor(v / quantum)).join(',') : p ? String(at) : `t${Math.floor(rt.state.time)}`;
  return `${p?.space}|${q}|${Math.round(score * 2) / 2}|${rt.state.status}`;
}

/** Play one playtest record on a world: an option by its label (taken as a person takes it), else held input. -> false when the option is not offered. */
function playRecord(rt, r, registry) {
  if (r.o !== undefined) { const options = rt.availableOptions(), j = optionLabels(options).indexOf(r.o); if (j < 0) return false; takeOption(rt, options[j], registry); return true; }
  holdInput(rt, r.i, r.n); hold(rt, {}, 1);
  return true;
}

/**
 * Replay a playtest path [{o:label}|{i:input,n:frames}] from a fresh world of `make` (the explorer's worlds:
 * explorerWorlds). onRecord(rt, record) runs before each record; onFrame(rt) after every step (macro steps included).
 */
export function replayPlay(make, seed, path, { onFrame = null, onRecord = null, registry = null } = {}) {
  const rt = make(seed);
  if (onFrame) { const step = rt.step; rt.step = input => { const s = step(input); onFrame(rt); return s; }; }
  for (const r of path) {
    if (rt.state.status !== 'playing') break;
    onRecord?.(rt, r);
    if (!playRecord(rt, r, registry)) break;
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
export function progressTimeline(make, seed, path, { goal, isProgress, quantum = 1, source = 'path', step = 0.1, deadFrames = 30, maxMarks = 120, maxStretches = 40, maxNames = 60, registry = null } = {}) {
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
  const rt = replayPlay(make, seed, path, { onFrame, onRecord, registry });
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
 * The worlds the explorer plays: the host document (hosting is idempotent: verify() passes it already), controlled
 * (every input through the controls a person has), with travel macros the controls realize (held move axes along the
 * space's path, never warps) on spaces that offer no options of their own, unless `travel` is false.
 * -> { ok: true, doc, make, travel } | { ok: false, errors } (the host document does not preflight)
 */
export function explorerWorlds(doc, registry, logic, { seed, travel: wanted = true } = {}) {
  const host = hostPreflight(doc, registry, logic);
  if (!host.ok) return { ok: false, errors: host.errors };
  let make = controlledMaker(host.doc, registry, logic), travel = null;
  if (wanted !== false) {
    const probe = make(seed), p = probe.player();
    if (!probe.availableOptions().length && p?.space && typeof probe.space(p.space).path === 'function' && steerable(probe)) { travel = withTravel(make, registry, { mode: 'steer' }); make = travel.make; }
  }
  return { ok: true, doc: host.doc, make, travel };
}

/**
 * playtest(doc, registry, logic, opts) → report
 * opts: { seed, maxFrames, maxRounds, idleSeconds, quantum, macros, limits, sampleSize, timeline, win, prove } (maxFrames and
 * maxRounds default to PLAYTEST_BUDGET; a wall-time budget is not an option: nothing here reads the clock)
 * `prove` ({ loop: events, won?, progress? }): what the search is run to show, for a gate that reads it
 * (verify-adapter.js viability): the loop (one of `loop`'s events fired from play more often than idling fires it:
 * objective.js loopShown) and progress toward the win: a win, or the win quantity moved toward it beyond what idling
 * moves it, by this play or by other playtest agents' (`won`: a bot won the game; `progress`: the furthest a bot's play
 * moved the quantity). The search stops after the round in which both are shown (`stopped: 'proven'`), or at a win or its
 * budget as without `prove`: what it played up to there is decided by the document and seed alone, so the report is.
 * Besides the verdict it returns `timeline` (progressTimeline of the winning path, else of the best-scoring
 * archived path; null when that path is empty), `verbsUsed` (verbs the search pressed, by count) and
 * `sample`: a few archive cells { key, frames, score, path, snap } spread over the search, for quality
 * measurements (v2/verify/quality.js) to restore.
 */
export function playtest(doc, registry, logic, opts = {}) {
  const { seed, maxFrames = PLAYTEST_BUDGET.frames, maxRounds = PLAYTEST_BUDGET.rounds, idleSeconds = 10, quantum = 1, limits } = opts;
  const b = makeBudget({ steps: maxFrames, states: maxRounds });
  const worlds = explorerWorlds(doc, registry, logic, { seed, travel: opts.travel });
  if (!worlds.ok) return { ok: false, winnable: false, win: null, idle: null, explored: 0, rounds: 0, framesSimulated: 0, problems: worlds.errors.map(e => problem('preflight', e.path, `the host document does not preflight: ${e.code} ${e.message}`, { stage: 'preflight' })), budget: b.report(), progress: null, timeline: null, sample: [], eventsFired: {}, verbsUsed: {}, losses: {} };
  doc = worlds.doc;
  const { make, travel } = worlds;
  const goal = objective(doc, registry, logic, { win: opts.win ?? null });
  // The win quantity (null without one): progress toward the win is what play moves it beyond what idling does.
  const wm = winMeasure(opts.win);
  const targets = [...plotZones(doc).keys()];
  const rand = prng(`playtest:${seed ?? doc.seed ?? doc.id}`);
  const problems = [], fired = {};
  // state.events holds only the last step's events (world.js clears them every step): count counts deltas instead.
  const verbs = {};
  const record = (rt, before = {}) => { const c = rt.state.counts; for (const k in c) { const d = c[k] - (before[k] || 0); if (d > 0) fired[k] = (fired[k] || 0) + d; } };
  const used = actions => { for (const [v, val] of Object.entries(actions || {})) if (val !== undefined && val !== null && val !== false) verbs[v] = (verbs[v] || 0) + 1; };
  const score = (rt, carry = null) => {
    let v = goal.score(rt);
    if (wm && carry) v += WIN_WEIGHT * wm.advance(rt, carry);
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
  const idle = b.meter(make(seed));
  const idleFrames = Math.round(idleSeconds / DT);
  let idleCarry = wm ? wm.start(idle) : null;
  try {
    // In stretches, so the win quantity sees what idling removes along the way.
    for (let f = 0; f < idleFrames && idle.state.status === 'playing'; f += 30) {
      const token = wm?.track(idle); hold(idle, {}, Math.min(30, idleFrames - f));
      if (wm) idleCarry = wm.carry(idleCarry, token, idle);
    }
    record(idle);
  }
  catch (error) { problems.push(problem('runtime_error', 'systems', `idle run threw at frame ${idle.state.frame}: ${error?.message || error}`)); }
  // The objective score doing nothing reaches (intro beats, ambient events): progress is only what play adds to it.
  let idleScore = null, idleAdvance = null;
  try { idleScore = round(goal.score(idle)); } catch {}
  try { if (wm) idleAdvance = round(wm.advance(idle, idleCarry)); } catch {}
  const idleCounts = { ...idle.state.counts };
  if (idle.state.status === 'won') problems.push(problem('trivially_won', 'plot.endings', `the game is won after ${idle.state.time.toFixed(1)} s with no input`, { hint: 'endings must require player action' }));
  if (idle.state.status === 'lost' && idle.state.time < 2) problems.push(problem('instant_loss', 'systems', `the game is lost after ${idle.state.time.toFixed(2)} s with no input`, { hint: 'give the player a grace period: spawn hazards away from the start' }));

  // 2. Search.
  const start = b.meter(make(seed));
  const checker = stepChecker(limits);
  const startCarry = wm ? wm.start(start) : null;
  const startScore = score(start, startCarry);
  const startKey = cellKeyOf(start, startScore, quantum);
  const archive = new Map([[startKey, { key: startKey, snap: start.snapshot(), path: [], frames: 0, visits: 0, score: startScore, carry: startCarry }]]);
  /** The furthest play moved the win quantity toward the win. */
  let advanceHigh = wm ? 0 : null;
  const rt = start;
  let win = null, rounds = 0, broke = false, proven = false;
  const losses = {};
  // What the caller runs the search to show (opts.prove): shown once the loop's events fired beyond idling and a win
  // (here or a bot's) or the win quantity moved beyond idling. Read after whole rounds, from the play alone.
  const prove = opts.prove && Array.isArray(opts.prove.loop) && opts.prove.loop.length ? opts.prove : null;
  const idleHigh = Number.isFinite(idleAdvance) ? idleAdvance : 0;
  const others = Number.isFinite(prove?.progress) ? Number(prove.progress) : NaN;
  const shown = () => loopShown(prove.loop, fired, idleCounts) && (prove.won === true || (wm !== null && Math.max(round(advanceHigh ?? 0), Number.isFinite(others) ? others : -Infinity) > idleHigh));
  // Options the game offers that no control a person has can take (a verb nothing issues, a macro with no actions):
  // never taken, reported once each (the game's defect: a choice offered that a person cannot make).
  const uncontrolled = new Map();
  const takeable = (options, labels) => options.map((o, i) => ({ o, label: labels[i] })).filter(({ o, label }) => {
    if (o.zone !== undefined && typeof o.apply === 'function') return true; // a travel macro: held input (takeOption)
    const acts = o.actions || {}, issues = Object.keys(acts).some(v => acts[v] !== undefined && acts[v] !== null && acts[v] !== false);
    const missing = !issues && typeof o.apply === 'function' ? [{ verb: label, why: 'the option is a macro (apply) and issues no action' }] : rt.controls.missing({ actions: acts });
    if (missing.length && !uncontrolled.has(label)) uncontrolled.set(label, missing);
    return !missing.length;
  });
  while (!b.over() && !broke && !proven) {
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
    let frames = cell.frames, carry = cell.carry;
    const n = 1 + rand.int(4);
    for (let k = 0; k < n; k++) {
      const all = rt.availableOptions(), options = takeable(all, optionLabels(all));
      let rec;
      const f0 = rt.state.frame, c0 = { ...rt.state.counts };
      const token = wm?.track(rt);
      try {
        if (options.length && (opts.optionsOnly || rand() < 0.75)) { const j = rand.int(options.length); rec = { o: options[j].label }; used(options[j].o.actions); takeOption(rt, options[j].o, registry); }
        else { const macros = opts.macros || inputMacros(rt); const m = macros[rand.int(macros.length)], len = 4 + rand.int(32); rec = { i: m.input, n: len, label: m.label }; used(m.input.actions); playRecord(rt, rec, registry); }
      } catch (error) {
        // A macro asking for a control a person does not have is the explorer's own request, not the game crashing.
        if (error?.code === 'controls_missing') problems.push(problem('controls_missing', 'systems', `the explorer needed ${String(error.message).replace(/^controls_missing: /, '')}`, { missing: error.missing, repro: [...path, rec].filter(Boolean) }));
        else problems.push(problem('runtime_error', 'systems', `step threw at frame ${rt.state.frame}: ${error?.message || error}`, { repro: [...path, rec].filter(Boolean) }));
        broke = true; break;
      }
      frames += rt.state.frame - f0;
      record(rt, c0);
      path.push(rec);
      if (wm) { carry = wm.carry(carry, token, rt); advanceHigh = Math.max(/** @type {number} */ (advanceHigh), wm.advance(rt, carry)); }
      const bad = checker.check(rt);
      if (bad) { problems.push({ ...bad, repro: path.slice() }); broke = true; break; }
      if (rt.state.status === 'won') { if (!win || frames < win.frames) win = { frames, path: path.slice(), ending: rt.state.ending }; broke = !opts.keepSearching; break; }
      if (rt.state.status === 'lost') { const why = rt.state.ending || rt.state.events.at(-1)?.name || 'lost'; losses[why] = (losses[why] || 0) + 1; break; }
      const sc = score(rt, carry), key = cellKeyOf(rt, sc, quantum), old = archive.get(key);
      if (!old || frames < old.frames) archive.set(key, { key, snap: rt.snapshot(), path: path.slice(), frames, visits: old?.visits || 0, score: sc, carry });
    }
    if (prove && !broke && shown()) proven = true;
  }

  // 3. Determinism: the winning path must replay to a win. The same replay (without a win, a replay of the
  // best-scoring archived path) records the frame-level progress timeline.
  const best = [...archive.values()].reduce((m, c) => (c.score > m.score ? c : m), { score: -Infinity, path: [] });
  const timelinePath = win ? win.path : best.path;
  let timeline = null, replayed = null;
  if (opts.timeline !== false && timelinePath.length) {
    try { timeline = progressTimeline(make, seed, timelinePath, { goal, isProgress: progressMatcher(doc), quantum, source: win ? 'win' : 'best', registry }); }
    catch { timeline = null; } // a throw here replays a path the search already ran; its problem is reported there
  }
  if (win) {
    const r = timeline?.rt ?? replayPlay(make, seed, win.path, { registry });
    replayed = r.state.status === 'won';
    if (!replayed) problems.push(problem('nondeterministic', '$', 'the winning input path did not reproduce the win on replay', { repro: win.path, hint: 'simulation must depend only on rt.state, inputs and rt.random()' }));
  } else if (!proven && !problems.some(p => p.severity === 'error') && (doc.plot?.endings || []).length) {
    problems.push(problem('goal_not_reached', 'plot.endings', `the playtest did not reach an ending within its budget (${archive.size} cells, ${rounds} rounds, stopped by ${b.hit || 'limit'})`, { severity: 'warning', hint: 'budget-limited: not a proof of a softlock' }));
  }
  // A warning, not a block: the option is a hint (ARCHITECTURE §6.3), and the person may still play what it means through
  // other controls (a run hint as the held move axis); the option's provider or the host's bindings must make it issuable.
  for (const [label, missing] of uncontrolled) problems.push(problem('option_uncontrolled', 'systems', `the game offers '${label}', which no control a person has can take: ${missing.map(m => `${m.verb} (${m.why})`).join('; ')}`, { severity: 'warning', missing, hint: 'every option the game offers must be issuable through a key, an axis or a mounted UI' }));
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
    idle: { status: idle.state.status, seconds: +idle.state.time.toFixed(2), score: idleScore, counts: idleCounts },
    explored: archive.size, rounds, framesSimulated: b.usedSteps, bestScore: best.score, travel: travel ? 'steer' : null,
    // Why the search ended: a win, what `prove` asked was shown, a problem it found, or its budget.
    stopped: win ? 'won' : proven ? 'proven' : broke ? 'problem' : 'budget',
    losses, eventsFired: fired, verbsUsed: verbs, timeline, sample, exhaustive: false, budget: b.report(), problems,
    // How far idling and play moved the win quantity toward the win (null: the document declares none).
    progress: wm ? { quantity: wm.label, target: wm.target, idle: idleAdvance, high: round(advanceHigh ?? 0) } : null,
  };
}
