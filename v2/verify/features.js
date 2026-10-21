// Feature checks (ARCHITECTURE.md §6.3): one check per feature a document mixes in, generated from what its primitives
// declare. For every primitive instance whose card declares a loop with verbs or progress events:
//   exists        it installs in the world, and the document sections its loop declares it needs (loop.needs.content)
//                 are not empty;
//   controllable  each of its loop verbs has a control a person has (a key, an axis, or a UI primitive the host mounts:
//                 controls.js uncontrolledVerbs);
//   works         pressing each verb's control (through the controls: controls.js), from states the gate's play
//                 reached (the bots' play and the explorer's archive), produces one of the primitive's declared progress
//                 or provided events more than not pressing it does from the same state (a held axis: moves the player,
//                 or the vehicle it sits in, further than idling does); alone, or while holding a
//                 direction when the move axis is bound (a run or dash modifies a move). A choice verb is pressed with
//                 the values the game offers for it in that state.
// A failing feature is a problem `feature_<code>` naming the primitive and verb; the table of every feature goes into
// the gate's report. A choice verb no reached state offers a value for (travel in a map without zones) is reported as
// a warning (feature_unreached): its control is there, and this game gives it nothing to choose yet. The search is bounded by steps, not wall time, so the same document always gets the same table.
import { cardLoop, loopExists } from '../planner/loop.js';
import { uncontrolledVerbs } from './controls.js';
import { instanceVerbs, choiceValues } from '../primitives/engine/runtime-lib-controls.js';

export const FEATURES_VERSION = 'features/0.1';
/** Problem codes, by check. */
export const FEATURE_CODES = Object.freeze({ exists: ['feature_missing', 'feature_content_empty'], controllable: ['feature_uncontrolled'], works: ['feature_inert', 'feature_unreached'] });

const defaults = card => Object.fromEntries(Object.entries(card?.params || {}).filter(([, s]) => s && typeof s === 'object' && 'default' in s).map(([k, s]) => [k, s.default]));
/** Is a declared content path non-empty in a document ('content.items'; 'spaces.zones': some space has zones)? */
function contentMet(doc, path) {
  const [head, ...rest] = path.split('.');
  if (head === 'spaces') return (doc.spaces || []).some(s => { const v = rest.reduce((o, k) => o?.[k], s); return Array.isArray(v) ? v.length > 0 : v && typeof v === 'object' ? Object.keys(v).length > 0 : Boolean(v); });
  const v = path.split('.').reduce((o, k) => o?.[k], doc);
  return Array.isArray(v) ? v.length > 0 : v && typeof v === 'object' ? Object.keys(v).length > 0 : Boolean(v);
}
/** The pseudo event a run records for how far the player moved (axis verbs are checked by movement, not by events). */
const MOVED = '(moved)';
const matches = (declared, name) => declared.some(d => d === name || (d.endsWith(':*') && name.startsWith(d.slice(0, -1))) || (d.endsWith(':') && name.startsWith(d)));

/** The loop features of a document: [{ use, path, card, loop, config }]. */
export function featuresOf(doc, registry) {
  const out = [];
  const visit = (inst, path) => {
    const card = registry.get(inst?.use)?.card, loop = cardLoop(card);
    if (!loop || (!loop.verbs.length && !loop.progress.length)) return;
    const config = { ...defaults(card), ...(inst.with || {}) };
    if (!loopExists(card, config)) return;
    out.push({ use: inst.use, path, card, loop, config, verbs: instanceVerbs(card, inst, doc) });
  };
  (doc.systems || []).forEach((s, i) => visit(s, `systems[${i}]`));
  (doc.spaces || []).forEach((sp, i) => (sp.generators || []).forEach((g, j) => visit(g, `spaces[${i}].generators[${j}]`)));
  return out;
}

/**
 * Run the feature checks of a preflighted host document.
 * @param {any} doc @param {any} registry @param {(seed: number) => any} make a controlledMaker of the document
 * @param {{ seed?: number, states?: any[], frames?: number, maxStates?: number, stepsPerVerb?: number }} [opts]
 *   states: snapshots play reached (the start state is always one)
 * @returns {{ version: string, table: any[], problems: Array<{ code: string, path: string, message: string, use: string, verb?: string }> }}
 */
export function featureChecks(doc, registry, make, { seed = 1, states = [], frames = 60, maxStates = 12, stepsPerVerb = 40000 } = {}) {
  const rt = make(seed), table = [], problems = [];
  const start = rt.snapshot();
  // Reached states, spread over the order they were reached in: the start, the first second of play (intros and
  // countdowns run then), then the states the play reached.
  const early = [2, 30, 60].map(n => { rt.restore(start); for (let i = 0; i < n && rt.state.status === 'playing'; i++) rt.step({}); return rt.state.status === 'playing' ? rt.snapshot() : null; }).filter(Boolean);
  rt.restore(start);
  const pool = [start, ...early, ...states.filter(Boolean)], picked = [];
  for (let i = 0; i < Math.min(maxStates, pool.length); i++) picked.push(pool[Math.floor((i * pool.length) / Math.min(maxStates, pool.length))]);
  const moves = (rt.controls.controls.map?.axes?.move || []).length ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : [];
  for (const f of featuresOf(doc, registry)) {
    const declared = [...new Set([...f.loop.progress, ...(f.card.provides?.events || [])])];
    const row = { use: f.use, path: f.path, exists: true, controllable: true, verbs: {} };
    const fail = (code, message, verb) => problems.push({ code, path: f.path, message, use: f.use, ...(verb ? { verb } : {}) });
    const warn = (code, message, verb) => problems.push({ code, path: f.path, message, use: f.use, severity: 'warning', ...(verb ? { verb } : {}) });
    if (!rt.has(f.use)) { row.exists = false; fail('feature_missing', `${f.use} is in the document but does not install`); }
    const empty = (f.loop.needs.content || []).filter(p => !contentMet(doc, p));
    if (empty.length) { row.exists = false; fail('feature_content_empty', `${f.use}: the content its loop needs is empty (${empty.join(', ')})`); }
    const loose = uncontrolledVerbs(doc, registry, f.verbs);
    for (const v of loose) { const verb = v.split(' ')[0]; row.controllable = false; row.verbs[verb] = { controllable: false, works: false }; fail('feature_uncontrolled', `${f.use}: no control a person has issues '${v}'`, verb); }
    for (const verb of f.verbs) {
      if (row.verbs[verb]) continue;
      const r = works(rt, verb, declared, picked, moves, frames, stepsPerVerb);
      row.verbs[verb] = { controllable: true, works: r.works, ...(r.event ? { event: r.event } : {}), tried: r.tried };
      if (!r.works && !r.tried) { row.verbs[verb].reached = false; warn('feature_unreached', `${f.use}: no state play reached offers a value for '${verb}' (nothing to choose in this game yet)`, verb); continue; }
      if (!r.works) fail(r.tried ? 'feature_inert' : 'feature_unreached', r.tried ? `${f.use}: pressing '${verb}' produced none of its events (${declared.slice(0, 6).join(', ')}) from ${r.tried} tries over ${picked.length} reached states` : `${f.use}: no reached state offers a value for '${verb}'`, verb);
    }
    if (!f.verbs.length) row.events = declared.slice(0, 8);
    table.push(row);
  }
  rt.restore(start);
  return { version: FEATURES_VERSION, table, problems };
}

/** Does pressing `verb` from one of `states` make a declared event fire more than not pressing it? */
function works(rt, verb, declared, states, moves, frames, budget) {
  let steps = 0, tried = 0;
  // What the player steers (the vehicle it sits in, else itself) and where it is: a held axis's effect is movement.
  const where = () => { const p = rt.player(), seat = p?.components.seat, e = seat ? rt.entity(seat.vehicle) ?? p : p; return Array.isArray(e?.at) ? e.at.slice() : null; };
  // One run: after each frame, the declared events fired so far (an event fired sooner counts, not only more often),
  // and in the end how far the player moved.
  const run = (snap, first, rest, n) => {
    rt.restore(snap);
    const c0 = { ...rt.state.counts }, a = where(), trace = [];
    for (let i = 0; i < n && rt.state.status === 'playing'; i++) {
      rt.step(i === 0 ? first : rest); steps++;
      const at = {};
      for (const [k, v] of Object.entries(rt.state.counts)) if (v > (c0[k] || 0) && matches(declared, k)) at[k] = v - (c0[k] || 0);
      trace.push(at);
    }
    const z = where();
    return { trace, moved: a && z ? Math.hypot(...z.map((v, i) => v - (a[i] ?? 0))) : 0 };
  };
  const sooner = (p, q) => { for (let i = 0; i < p.trace.length; i++) { const k = Object.keys(p.trace[i]).find(e => p.trace[i][e] > (q.trace[Math.min(i, q.trace.length - 1)]?.[e] || 0)); if (k) return k; } return undefined; };
  const axis = (rt.controls.controls.map?.axes?.[verb] || []).length > 0;
  for (const snap of states) {
    rt.restore(snap);
    // The values a person can give the verb here: its keys' values, the four directions of an axis, the options' values.
    const presses = axis ? moves.map(m => ({ axes: { [verb]: m } }))
      : rt.controls.presses(verb).length ? rt.controls.presses(verb).map(v => ({ actions: { [verb]: v } }))
        : choiceValues(rt, verb);
    for (const p of presses) for (const ctx of [null, ...(axis ? [] : moves)]) {
      if (steps > budget) return { works: false, tried };
      const base = ctx ? { axes: { move: ctx } } : {};
      const heldVerbs = Object.fromEntries(Object.entries(p.actions || {}).filter(([, v]) => v === true).map(([k]) => [k, true]));
      const first = { ...base, ...p, axes: { ...(base.axes || {}), ...(p.axes || {}) } };
      const rest = { ...base, ...(Object.keys(heldVerbs).length ? { held: heldVerbs } : {}), ...(p.axes ? { axes: { ...(base.axes || {}), ...p.axes } } : {}) };
      const n = Math.max(frames, p.steps || 0);
      let pressed, idle;
      try { pressed = run(snap, first, rest, n); idle = run(snap, base, base, n); } catch (error) { if (error?.code === 'controls_missing') continue; throw error; }
      tried++;
      // A held axis works when it moves the player (or its vehicle) further than idling does; a press when one of the
      // primitive's declared events fires sooner or more often than without it, or, pressed while moving (a run, a
      // crouch, a focus), when it changes how far the move takes the player.
      const event = axis ? (pressed.moved > idle.moved + 0.05 ? MOVED : undefined)
        : sooner(pressed, idle) ?? (ctx && Math.abs(pressed.moved - idle.moved) > 0.05 ? MOVED : undefined);
      if (event) { rt.restore(snap); return { works: true, event, tried }; }
    }
  }
  return { works: false, tried };
}
