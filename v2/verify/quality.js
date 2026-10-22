// Quality report: how a document plays, measured headless on the real runtime and never used to block
// publishing (the publish gate stays crash-only, planner/verify-adapter.js `viability`). It reuses the
// playtest's archive sample and progress timeline (playtest.js) and adds one bounded measurement of its
// own, agency, by restoring sampled cells and trying each choice there.
//   agency       share of options / input macros that change the state compared with doing nothing
//   coverage     selected mechanics (selection.mechanics → primitives → card events/actions) seen in play
//   progression  how far the timeline path got (ending, objective, progress marks)
//   pacing       median / p90 gap between progress marks and the longest stretch without one
//   deadTime     stretches with no player movement and no event
//   variety      cells, zones, event names and choice labels per simulated minute
// A value that was not measured is null, never 0 (AGENTS.md); `unmeasured` says why. Findings carry a
// stable code, a document path and severity 'info'.
import { hold, holdInput, optionLabels, inputMacros, optionVerbs } from './drive.js';
import { takeOption } from './macros.js';
import { playtest as runPlaytest, explorerWorlds } from './playtest.js';
import { INPUT } from './controls.js';
import { budget as makeBudget, stableStringify, hashString, instancesOf, usedPrimitives } from './util.js';

export const QUALITY_VERSION = 'quality/0.1';
const DT = 1 / 60;

/** Stable finding codes (all severity 'info'). */
export const QUALITY_CODES = {
  agency_low: 'few sampled choices change the state',
  agency_inert_cell: 'a sampled state where no choice changes anything',
  verb_inert: 'a verb never changed the state at any sampled state',
  mechanic_absent: 'none of a selected mechanic\'s primitives is in the document',
  mechanic_unexercised: 'a selected mechanic\'s events never fired and its verbs were never used',
  pacing_sparse: 'fewer than two progress marks on the measured path',
  pacing_long_gap: 'a long stretch with no progress',
  dead_time_high: 'a large share of the measured path has no movement and no events',
  variety_single_zone: 'the measured path stays in one zone of several',
};

/**
 * Provisional finding thresholds. They only decide which info findings are reported; they are not budgets,
 * and should be revisited once representative baselines exist (AGENTS.md).
 */
export const QUALITY_THRESHOLDS = Object.freeze({ agencyShare: 0.5, longGapSeconds: 30, deadShare: 0.25 });

const round = (v, d = 2) => (Number.isFinite(v) ? +v.toFixed(d) : null);
const finding = (code, path, message, extra = {}) => ({ code, path: path || '$', message, severity: 'info', ...extra });
/**
 * State hash for agency: everything but this step's event list, the generic `action` count (pressing an unbound verb
 * still emits it) and the input primitive's memory of what the devices held (a key pressed is not the game changing).
 */
const choiceHash = state => hashString(stableStringify({ ...state, events: undefined, counts: { ...state.counts, action: undefined }, prim: { ...state.prim, [INPUT]: undefined } }));
const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null);
const median = sorted => (sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : null);
const matches = (patterns, name) => patterns.some(p => (p.endsWith('*') ? name.startsWith(p.slice(0, -1)) : p === name));

/** Agency at sampled archive cells: each option and input macro against idling for the same frames. */
function measureAgency(make, sample, { b, maxChoices, macroFrames, registry }) {
  const cells = (sample || []).filter(c => c.snap);
  if (!cells.length) return { value: null, why: 'no archive sample' };
  const rt = make();
  const tally = { options: { choices: 0, effective: 0 }, macros: { choices: 0, effective: 0 } }, verbs = {}, perCell = [];
  let truncated = false, errors = 0;
  for (const cell of cells) {
    if (b.over()) { truncated = true; break; }
    rt.restore(cell.snap);
    if (rt.state.status !== 'playing') continue;
    const labels = optionLabels(rt.availableOptions());
    // Each verb alone first, then the four axis moves, then diagonals and combos: a cap still tries every verb.
    const rank = m => (!m.input.axes ? 0 : !m.input.actions && Object.values(m.input.axes)[0].some(v => v === 0) ? 1 : 2);
    const macros = inputMacros(rt).filter(m => m.label !== 'idle').map((m, i) => ({ m, i })).sort((a, b) => rank(a.m) - rank(b.m) || a.i - b.i).map(x => x.m);
    const choices = [...labels.slice(0, Math.ceil(maxChoices / 2)).map(label => ({ kind: 'options', label })), ...macros.map(m => ({ kind: 'macros', label: m.label, m }))].slice(0, maxChoices);
    const baseline = new Map(), outcomes = new Set();
    const idle = n => { if (!baseline.has(n)) { rt.restore(cell.snap); hold(rt, {}, n); baseline.set(n, choiceHash(rt.state)); } return baseline.get(n); };
    let tried = 0, effective = 0;
    for (const c of choices) {
      if (b.over()) { truncated = true; break; }
      rt.restore(cell.snap);
      const f0 = rt.state.frame;
      let acts;
      try {
        if (c.kind === 'options') {
          const options = rt.availableOptions(), j = optionLabels(options).indexOf(c.label);
          if (j < 0) continue;
          acts = optionVerbs(options[j]); takeOption(rt, options[j], registry);
        } else { acts = Object.keys(c.m.input.actions || {}); if (!acts.length) acts = Object.keys(c.m.input.axes || {}); holdInput(rt, c.m.input, macroFrames); hold(rt, {}, 1); }
      } catch { errors++; continue; } // crashes are the publish gate's business; here the choice is just not measured
      const h = choiceHash(rt.state), changed = h !== idle(rt.state.frame - f0);
      tried++; tally[c.kind].choices++;
      if (changed) { effective++; tally[c.kind].effective++; outcomes.add(h); }
      for (const v of acts) { const t = (verbs[v] ??= { tried: 0, effective: 0 }); t.tried++; if (changed) t.effective++; }
    }
    if (tried) perCell.push({ key: cell.key, choices: tried, effective, distinct: outcomes.size });
  }
  const choices = tally.options.choices + tally.macros.choices, effective = tally.options.effective + tally.macros.effective;
  if (!choices) return { value: null, why: truncated ? 'budget exhausted before any choice was measured' : 'no choices at the sampled states' };
  const distinct = perCell.reduce((s, c) => s + c.distinct, 0);
  return { value: {
    cells: perCell.length, choices, effective, share: round(effective / choices),
    distinctShare: round(distinct / choices), inertCells: perCell.filter(c => !c.effective).length,
    options: tally.options, macros: tally.macros, verbs, perCell, truncated, errors,
  } };
}

/** Selected mechanics against what the playtest saw: provided events fired (counts) and provided verbs used. */
function measureCoverage(doc, registry, mechanics, pt, agency) {
  if (!Array.isArray(mechanics) || !mechanics.length) return { value: null, why: 'no selected mechanics given' };
  if (!pt) return { value: null, why: 'no playtest' };
  const inDoc = usedPrimitives(doc), fired = Object.keys(pt.eventsFired || {}), used = pt.verbsUsed || {};
  const pathOf = new Map(); for (const x of instancesOf(doc)) if (x.inst?.use && !pathOf.has(x.inst.use)) pathOf.set(x.inst.use, x.path);
  const items = mechanics.map((m, i) => {
    const prims = (m.primitives || []).filter(p => inDoc.has(p));
    const events = [...new Set(prims.flatMap(p => registry.get(p)?.card?.provides?.events || []))];
    const actions = [...new Set(prims.flatMap(p => registry.get(p)?.card?.provides?.actions || []))];
    const seen = events.filter(e => fired.some(n => matches([e], n)));
    const verbs = actions.filter(a => used[a]);
    const effective = agency ? actions.filter(a => agency.verbs[a]?.effective) : null;
    const measurable = prims.length && (events.length || actions.length);
    return {
      id: m.id ?? `mechanic_${i}`, description: m.description ?? null, importance: m.importance ?? null, primitives: prims, missing: (m.primitives || []).filter(p => !inDoc.has(p)),
      events: { provided: events.length, seen }, verbs: { provided: actions.length, used: verbs, effective },
      exercised: measurable ? Boolean(seen.length || verbs.length) : null, path: pathOf.get(prims[0]) ?? '$',
    };
  });
  const measured = items.filter(x => x.exercised !== null);
  return { value: { mechanics: items.length, measured: measured.length, exercised: measured.filter(x => x.exercised).length, share: measured.length ? round(measured.filter(x => x.exercised).length / measured.length) : null, items } };
}

/** Frames the agency measurement simulates when its caller names no budget (a sample of ~7 cells × 24 choices × 13 frames fits). */
export const QUALITY_STEPS = 6000;

/**
 * quality(doc, registry, logic, { playtest, mechanics, seed, maxSteps, maxChoices, macroFrames, thresholds })
 * `doc` is preflighted. `playtest` is a playtest() result with its archive sample (snapshots); without one a
 * playtest runs here. `mechanics` is selection.mechanics. Agency is measured on the explorer's worlds (the controls a
 * person has) within `maxSteps` simulated frames, never wall time.
 */
export function quality(doc, registry, logic, opts = {}) {
  const { mechanics = null, seed = doc.seed, maxSteps = QUALITY_STEPS, maxChoices = 24, macroFrames = 12 } = opts;
  const th = { ...QUALITY_THRESHOLDS, ...(opts.thresholds || {}) };
  const b = makeBudget({ steps: maxSteps });
  const findings = [], unmeasured = {};
  let pt = opts.playtest || null, ranPlaytest = false;
  if (!pt) { pt = runPlaytest(doc, registry, logic, { seed }); ranPlaytest = true; }
  // The worlds the playtest played (its archive snapshots restore into them).
  const worlds = explorerWorlds(doc, registry, logic, { seed, travel: pt?.travel === 'steer' });
  if (!worlds.ok) throw Error(`quality: the host document does not preflight: ${JSON.stringify(worlds.errors.slice(0, 2))}`);
  const fresh = () => b.meter(worlds.make(seed));
  const tl = pt?.timeline || null;
  const pathOf = new Map(); for (const x of instancesOf(doc)) if (x.inst?.use && !pathOf.has(x.inst.use)) pathOf.set(x.inst.use, x.path);
  const inputPath = pathOf.get('engine.input.actions') ?? 'systems';

  // Agency.
  let agency = null;
  try { const a = measureAgency(fresh, pt?.sample, { b, maxChoices, macroFrames, registry }); agency = a.value; if (!agency) unmeasured.agency = a.why; }
  catch (error) { unmeasured.agency = `threw: ${String(error?.message || error).slice(0, 120)}`; }
  if (agency) {
    if (agency.share < th.agencyShare) findings.push(finding('agency_low', 'systems', `${Math.round(agency.share * 100)}% of ${agency.choices} sampled choices change the game (at ${agency.cells} states)`, { hint: 'give the player verbs that matter where they start' }));
    for (const c of agency.perCell.filter(c => !c.effective).slice(0, 3)) findings.push(finding('agency_inert_cell', 'systems', `nothing the player tries at ${c.key} changes the game (${c.choices} choices)`, { cell: c.key }));
    for (const [v, t] of Object.entries(agency.verbs).filter(([v, t]) => v !== 'move' && t.tried && !t.effective).slice(0, 6)) findings.push(finding('verb_inert', inputPath, `'${v}' changed nothing at ${t.tried} sampled states`, { verb: v }));
  }

  // Mechanic coverage.
  const cov = measureCoverage(doc, registry, mechanics, pt, agency), coverage = cov.value;
  if (!coverage) unmeasured.coverage = cov.why;
  for (const m of coverage?.items || []) {
    if (!m.primitives.length) findings.push(finding('mechanic_absent', '$', `'${m.description || m.id}' has none of its primitives in the document${m.missing.length ? ` (${m.missing.join(', ')})` : ''}`, { mechanic: m.id }));
    else if (m.exercised === false) findings.push(finding('mechanic_unexercised', m.path, `'${m.description || m.id}' never showed up in play: no ${m.primitives.join(', ')} event fired and none of its verbs was used`, { mechanic: m.id }));
  }

  // Progression, pacing, dead time and variety come from the timeline path.
  let progression = null, pacing = null, deadTime = null, variety = null;
  if (!tl || !tl.frames) { for (const k of ['progression', 'pacing', 'deadTime', 'variety']) unmeasured[k] = pt ? 'no timeline: the playtest kept no path beyond the start' : 'no playtest'; }
  else {
    const minutes = tl.frames * DT / 60, frames = tl.marks.map(m => m.f);
    progression = { source: tl.source, status: tl.status, ending: tl.ending, seconds: tl.seconds, marks: tl.marksTotal, marksPerMinute: round(tl.marksTotal / minutes, 1), score: tl.score, winnable: Boolean(pt.winnable) };
    const gaps = frames.slice(1).map((f, i) => (f - frames[i]) * DT).sort((x, y) => x - y);
    const spans = [frames[0] ?? tl.frames, ...frames.slice(1).map((f, i) => f - frames[i]), tl.frames - (frames.at(-1) ?? tl.frames)].map(f => f * DT);
    pacing = { marks: tl.marksTotal, medianGap: round(median(gaps)), p90Gap: round(quantile(gaps, 0.9)), longestGap: round(Math.max(...spans)), truncated: Boolean(tl.truncated) };
    if (tl.marksTotal < 2) findings.push(finding('pacing_sparse', 'plot', `the ${tl.source === 'win' ? 'winning' : 'best'} path (${tl.seconds} s) has ${tl.marksTotal} progress mark${tl.marksTotal === 1 ? '' : 's'}`, { hint: 'beats, pickups or objectives along the way give the player feedback' }));
    if (pacing.longestGap > th.longGapSeconds) findings.push(finding('pacing_long_gap', 'plot', `${pacing.longestGap} s pass without progress on the ${tl.source === 'win' ? 'winning' : 'best'} path`));
    deadTime = { share: round(tl.deadFrames / tl.frames), seconds: round(tl.deadFrames * DT), longest: round(tl.longestDeadFrames * DT), stretches: tl.deadStretches, thresholdSeconds: round(tl.deadThresholdFrames * DT) };
    if (deadTime.share > th.deadShare) findings.push(finding('dead_time_high', 'systems', `${Math.round(deadTime.share * 100)}% of the path has no movement and no events (longest ${deadTime.longest} s)`));
    variety = { minutes: round(minutes, 3), cells: tl.cells, zones: tl.zones.length, eventNames: tl.eventNames.length, labels: tl.labels.length,
      perMinute: { cells: round(tl.cells / minutes, 1), zones: round(tl.zones.length / minutes, 1), eventNames: round(tl.eventNames.length / minutes, 1), labels: round(tl.labels.length / minutes, 1) },
      search: pt.framesSimulated ? { cellsPerMinute: round(pt.explored / (pt.framesSimulated * DT / 60), 1) } : null };
    const docZones = new Set((doc.spaces || []).flatMap(s => (s.zones || s.with?.zones || []).map(z => z?.id).filter(Boolean)));
    if (tl.zones.length <= 1 && docZones.size > 1 && (tl.source === 'win' || tl.seconds >= 10)) findings.push(finding('variety_single_zone', 'spaces', `the path stays in ${tl.zones[0] ? `'${tl.zones[0]}'` : 'one zone'} of ${docZones.size} zones`));
  }

  return {
    version: QUALITY_VERSION, agency, coverage, progression, pacing, deadTime, variety,
    budget: { limitSteps: maxSteps, ...b.report(), playtest: ranPlaytest ? 'ran' : 'reused', truncated: Boolean(agency?.truncated) || b.hit !== null },
    exhaustive: false, findings, unmeasured,
  };
}
