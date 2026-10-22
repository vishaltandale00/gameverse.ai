// What "progress" means for a document, derived from its own data: the
// predicates that fire unfired beats and endings and complete quests, plus
// cumulative counts of progress events and primitive-declared progress hooks.
// Used as the best-first heuristic of the plot solver, the cell score of the
// Go-Explore playtester and the reward of greedy strategies.
import { instancesOf } from './util.js';
import { onPlayerSide } from '../kernel/sides.js';

const COMPARATORS = ['gte', 'gt', 'lte', 'lt', 'eq', 'ne'];
/** Events that mean the player advanced, with weights (wildcards end in ':'). */
export const PROGRESS_EVENTS = { beat: 4, act_complete: 6, objective_done: 3, quest_complete: 5, quest_started: 1, 'ability_unlocked:': 3, 'item_gained:': 1, 'collected:': 1, 'discovered:': 1, 'defeated:': 1, gate_opened: 2, level_complete: 5 };

/** Goal leaves: numeric comparisons on vars or event counts inside the document's triggers. */
function goalLeaves(doc, logic) {
  const leaves = [];
  const visit = (p, where) => {
    if (!p || typeof p !== 'object') return;
    for (const k of ['all', 'any']) if (Array.isArray(p[k])) { p[k].forEach(q => visit(q, where)); return; }
    if (p.not) return; // negations are constraints, not goals
    const c = COMPARATORS.find(k => typeof p[k] === 'number');
    if (p.var !== undefined && c) leaves.push({ kind: 'var', id: p.var, c, target: p[c], where });
    else if (p.count !== undefined && c) leaves.push({ kind: 'count', id: p.count, c, target: p[c], where });
    else if (logic?.kindOf(p)) leaves.push({ kind: 'test', pred: p, where });
  };
  (doc.plot?.storyboard?.acts || []).forEach(a => (a.beats || []).forEach(b => b.when && visit(b.when, `beat:${b.id}`)));
  (doc.plot?.endings || []).forEach(e => e.when && visit(e.when, `ending:${e.id}`));
  (doc.plot?.quests || []).forEach(q => (q.objectives || []).forEach(o => o.when && visit(o.when, `quest:${q.id}`)));
  return leaves;
}

/** Fraction in [0,1] of a numeric leaf satisfied (distance-shaped for gte/lte). */
function fraction(value, { c, target }) {
  if (c === 'gte' || c === 'gt') return target > 0 ? Math.max(0, Math.min(1, value / target)) : value >= target ? 1 : 0;
  if (c === 'lte' || c === 'lt') return value <= target ? 1 : 1 / (1 + Math.abs(value - target));
  if (c === 'eq') return value === target ? 1 : 1 / (1 + Math.abs(value - target));
  return value !== target ? 1 : 0;
}

/**
 * Build the objective of a document: { score(rt) → number, leaves, hooks }.
 * Primitives may contribute `progress(rt, config, instance) → number` (top level or on the card).
 * `counts: false` leaves event counts out: in a game where every side emits the same loop events (turns, cards, RTS),
 * the opponent's actions would count as the player's progress; the primitives' progress hooks measure it by side.
 */
export function objective(doc, registry, logic, { weights: base = PROGRESS_EVENTS, win = null, counts = true } = {}) {
  // The document's primitives declare what their loop's progress is (card.loop.progress): those events count too; the
  // event the core loop's win counts (win.reads, winMeasure) weighs most.
  const weights = { ...Object.fromEntries(loopEvents(doc, registry).map(e => [e, 2])), ...base, ...(typeof win?.event === 'string' ? { [win.event]: WIN_WEIGHT } : {}) };
  const leaves = goalLeaves(doc, logic);
  const hooks = instancesOf(doc).map(x => ({ x, p: registry.get(x.inst?.use) })).map(({ x, p }) => ({ x, fn: p?.progress || p?.card?.progress })).filter(h => typeof h.fn === 'function');
  const wild = Object.entries(weights).filter(([k]) => k.endsWith(':'));
  function score(rt) {
    const s = rt.state;
    let v = 0;
    if (counts) for (const [name, n] of Object.entries(s.counts)) {
      if (weights[name] !== undefined && !name.endsWith(':')) v += weights[name] * n;
      else for (const [prefix, w] of wild) if (name.startsWith(prefix)) { v += w * Math.log2(1 + n); break; }
    }
    for (const l of leaves) {
      if (l.kind === 'var') v += 2 * fraction(Number(s.vars[l.id] ?? 0), l);
      else if (l.kind === 'count') v += 2 * fraction(Number(s.counts[l.id] ?? 0), l);
      else { try { if (rt.test(l.pred)) v += 2; } catch { /* predicates that need context (self) don't count */ } }
    }
    for (const h of hooks) { const n = Number(h.fn(rt, h.x.inst.with || {}, { key: h.x.key, ...h.x.inst })); if (Number.isFinite(n)) v += n; }
    if (s.status === 'won') v += 1000;
    if (s.status === 'lost') v -= 1000;
    return v;
  }
  return { score, leaves, hooks: hooks.length };
}

/** The objective weight of one unit of the win quantity (an event the win counts, a step of its var or component). */
export const WIN_WEIGHT = 5;
const DIRECTION = { gte: 1, gt: 1, lte: -1, lt: -1 };

/**
 * The quantity the core loop's win reads, as a measurement of play: `win` is { event } | { var } | { component, of }
 * (card.loop.win.reads of the loop that owns the win, planner/verify-adapter.js winQuantity) with { cmp, target } when
 * the document's won ending declares one. Its `advance` is how far play moved it toward the win from where it started:
 *   event      occurrences since the start (typed `event:x` occurrences count when the bare name is not counted); a
 *              read of the player's side (`of: 'player'`, with `subjects`) counts only `event:<subject>` of those
 *              subjects (the player's laps, its team's goals), never a rival's;
 *   var        the change toward the target (gte/gt up, lte/lt down, eq closer to it), any change without a target;
 *   component  how many of the entities it reads ('opponents': entities carrying it not on the player's side, 'player': the
 *              player and its side; kernel/sides.js)
 *              had it changed from how they first carried it, plus those removed during play (`carry`: per path).
 * track(rt) is taken before a stretch of play and carry(c, token, rt) after it, so removals count along a path.
 * -> null when there is no win quantity.
 * @param {{ event?: string, var?: string, component?: string, of?: string, subjects?: string[], cmp?: string, target?: number } | null | undefined} win
 */
export function winMeasure(win) {
  if (!win || typeof win !== 'object') return null;
  const target = Number.isFinite(win.target) ? Number(win.target) : null, cmp = typeof win.cmp === 'string' ? win.cmp : null;
  const towards = (q, q0) => {
    if (cmp === 'eq' && target !== null) return Math.abs(q0 - target) - Math.abs(q - target);
    const d = DIRECTION[cmp];
    return d ? d * (q - q0) : Math.abs(q - q0);
  };
  if (typeof win.event === 'string' || typeof win.var === 'string') {
    const name = String(win.event ?? win.var), isEvent = typeof win.event === 'string';
    const mine = isEvent && win.of === 'player' && Array.isArray(win.subjects) ? win.subjects.map(s => `${name}:${s}`) : null;
    const q = mine
      ? rt => mine.reduce((n, k) => n + (rt.state.counts[k] || 0), 0)
      : isEvent
      ? rt => { const c = rt.state.counts; if (c[name] !== undefined) return c[name]; let n = 0; for (const k in c) if (k.startsWith(name + ':')) n += c[k]; return n; }
      : rt => { const v = Number(rt.state.vars[name]); return Number.isFinite(v) ? v : 0; };
    return {
      label: `${isEvent ? 'event' : 'var'} ${name}${mine ? ` (${win.subjects.join(', ')})` : ''}`, target,
      start: rt => ({ q0: q(rt) }), track: () => null, carry: c => c,
      advance: (rt, c) => (isEvent ? q(rt) - c.q0 : towards(q(rt), c.q0)),
    };
  }
  if (typeof win.component !== 'string') return null;
  const C = win.component, of = win.of || 'opponents';
  /** How each entity first carried the component (ids are deterministic per seed). */
  const first = new Map();
  // Sides are the kernel's one reading of the cards' side declarations (kernel/sides.js): 'opponents' are the entities
  // not on the player's side (never its own pieces), 'player' the player and its side.
  const carriers = rt => Object.values(rt.state.entities).filter(e => e?.components?.[C] !== undefined && (of === 'player' ? onPlayerSide(rt, e) : of === 'opponents' ? !onPlayerSide(rt, e) : true));
  const changed = rt => { let n = 0; for (const e of carriers(rt)) { const j = JSON.stringify(e.components[C]); if (!first.has(e.id)) first.set(e.id, j); else if (first.get(e.id) !== j) n++; } return n; };
  return {
    label: `${of}' component ${C}`, target: null,
    start: rt => { changed(rt); return { gone: 0 }; },
    track: rt => carriers(rt).map(e => e.id),
    carry: (c, ids, rt) => ({ gone: c.gone + (ids || []).filter(id => !rt.state.entities[id]).length }),
    advance: (rt, c) => changed(rt) + c.gone,
  };
}

/** Zones the plot points at (predicates `{zone}` and objectives `{zone}`), for distance-shaped exploration. */
export function plotZones(doc) {
  const out = new Map();
  const visit = (p, where) => {
    if (!p || typeof p !== 'object') return;
    if (Array.isArray(p)) { p.forEach(q => visit(q, where)); return; }
    if (typeof p.zone === 'string') { if (!out.has(p.zone)) out.set(p.zone, where); }
    for (const v of Object.values(p)) if (v && typeof v === 'object') visit(v, where);
  };
  (doc.plot?.storyboard?.acts || []).forEach((a, i) => (a.beats || []).forEach((b, j) => visit(b.when, `plot.storyboard.acts[${i}].beats[${j}].when`)));
  (doc.plot?.quests || []).forEach((q, i) => (q.objectives || []).forEach((o, j) => visit(o, `plot.quests[${i}].objectives[${j}]`)));
  (doc.plot?.endings || []).forEach((e, i) => visit(e.when, `plot.endings[${i}].when`));
  return out;
}

/**
 * The progress events the document's primitives declare for their loops (card.loop.progress, and card.mode's
 * when it lists them): the game's core loop, as its collection of primitives defines it. Wildcards end in ':'.
 */
export function loopEvents(doc, registry) {
  const out = new Set();
  for (const x of instancesOf(doc)) {
    const card = registry.get(x.inst?.use)?.card;
    for (const e of [...(card?.loop?.progress || []), ...(card?.mode?.progress || [])]) if (typeof e === 'string' && e) out.add(e);
  }
  return [...out];
}
