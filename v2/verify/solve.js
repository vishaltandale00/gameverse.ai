// Plot solver: is the game completable, and how? Searches the real runtime
// (headless, deterministic) over the player options primitives expose
// (rt.options, including macro options with apply(rt)), deduplicating states
// by an abstract key that primitives can shape (solverKey). Search orders:
//   'bfs'        shortest option paths (default; exhaustive on small plots)
//   'best-first' progress heuristic from the document's own triggers
//   'iddfs'      iterative deepening with a depth-indexed transposition table
// Reports endings with option paths, beats that never fired, endings never
// reached, dead ends (no options, game not over) and whether the search was
// exhaustive or stopped by its budget. A state that offers no options while the
// simulation is still resolving (a board cascading, pieces settling, a shot in
// flight) is stepped idle until options appear (waitSteps, as the bots wait for
// a decision): only a state that stays without options is a dead end.
import { maker, applyOption, settle, optionLabels } from './drive.js';
import { abstraction } from './abstraction.js';
import { objective } from './objective.js';
import { budget as makeBudget } from './util.js';
import { withTravel } from './macros.js';

class Heap {
  constructor(less) { this.a = []; this.less = less; }
  get size() { return this.a.length; }
  push(x) { const a = this.a; a.push(x); let i = a.length - 1; while (i) { const p = (i - 1) >> 1; if (!this.less(a[i], a[p])) break; [a[i], a[p]] = [a[p], a[i]]; i = p; } }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && this.less(a[l], a[m])) m = l; if (r < a.length && this.less(a[r], a[m])) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } }
    return top;
  }
}

/** Settle, then step idle while the game plays and offers no options, up to `wait` steps. */
function toDecision(rt, settleSteps, wait) {
  settle(rt, settleSteps);
  let k = 0;
  while (rt.state.status === 'playing' && k < wait && !rt.availableOptions().length) { rt.step({}); k++; }
}

/** Replay a path of option labels from a fresh world, reaching each decision as the search did. */
function replay(make, seed, path, settleSteps, wait) {
  const rt = make(seed);
  toDecision(rt, settleSteps, wait);
  for (const label of path) {
    if (rt.state.status !== 'playing') return { rt, ok: false };
    const options = rt.availableOptions(), j = optionLabels(options).indexOf(label);
    if (j < 0) return { rt, ok: false };
    applyOption(rt, options[j]); toDecision(rt, settleSteps, wait);
  }
  return { rt, ok: true };
}

const pathOf = node => { const out = []; for (let n = node; n?.label !== undefined; n = n.parent) out.push(n.label); return out.reverse(); };

/**
 * solve(doc, registry, logic, opts) — doc must be preflight's normalized document.
 * opts: { search, maxStates, maxSteps, maxDepth, settleSteps, waitSteps, seed, quantum, includeRng, entities, key(rt), heuristic(rt) }
 * The search is bounded by states kept and frames simulated, never wall time: the same document and seed give the same result.
 * `stopAtWin`: stop at the first won ending found (a caller that needs one winning path, not every ending).
 */
export function solve(doc, registry, logic, opts = {}) {
  const { search = 'bfs', maxStates = 20000, maxDepth = Infinity, settleSteps = 2, waitSteps = 600, seed } = opts;
  const b = makeBudget({ states: maxStates, steps: opts.maxSteps ?? Infinity });
  // Spaces without options of their own get travel macros (warp along the space's path, or steer the real controls).
  let make = maker(doc, registry, logic), travel = null;
  if (opts.travel !== false) {
    const probe = make(seed), p = probe.player();
    const wanted = opts.travel ?? (!probe.availableOptions().length && p?.space && typeof probe.space(p.space).path === 'function' ? 'auto' : null);
    if (wanted) travel = withTravel(make, registry, { mode: wanted });
    if (travel) make = travel.make;
  }
  const rt = b.meter(make(seed));
  const abs = abstraction(doc, registry, opts);
  const keyOf = opts.key || abs.key;
  const goal = objective(doc, registry, logic);
  const h = opts.heuristic || goal.score;
  toDecision(rt, settleSteps, waitSteps);

  const beatsFired = new Set(), endings = new Map(), outcomes = {}, deadEnds = [];
  const record = () => { for (const id of Object.keys(rt.store('plot.storyboard').fired || {})) beatsFired.add(id); };
  record();
  let best = { score: h(rt), node: null };
  const root = { snap: rt.snapshot(), parent: null, label: undefined, depth: 0 };
  const startOptions = rt.availableOptions().length;
  let expanded = 0, tries = 0, cutByDepth = false, errors = [], wonFound = false;

  // Expand a node: try each option from its snapshot; returns child nodes (new abstract states).
  const expand = (node, seen, admit) => {
    rt.restore(node.snap);
    const options = rt.availableOptions(), labels = optionLabels(options);
    expanded++;
    if (!options.length) { if (deadEnds.length < 50) deadEnds.push(pathOf(node)); return []; }
    if (node.depth >= maxDepth) { cutByDepth = true; return []; }
    const children = [];
    for (let i = 0; i < options.length; i++) {
      tries++;
      rt.restore(node.snap);
      // A macro option is re-read after restore (its apply() closure may capture state); a data option (actions and
      // steps only) is the same after restore, and re-reading every option for each one tried costs options² reads.
      const opt = typeof options[i].apply === 'function' ? rt.availableOptions()[i] || options[i] : options[i];
      try { applyOption(rt, opt); toDecision(rt, settleSteps, waitSteps); }
      catch (error) { errors.push({ path: [...pathOf(node), labels[i]], message: String(error?.message || error) }); continue; }
      record();
      const child = { parent: node, label: labels[i], depth: node.depth + 1 };
      if (rt.state.status !== 'playing') {
        const k = rt.state.ending || rt.state.status, path = pathOf(child);
        if (!endings.has(k) || endings.get(k).length > path.length) endings.set(k, path);
        outcomes[k] = rt.state.status;
        if (opts.stopAtWin && rt.state.status === 'won') { wonFound = true; break; }
        continue;
      }
      const key = keyOf(rt);
      if (!admit(key, child.depth)) continue;
      b.state();
      child.snap = rt.snapshot();
      child.score = h(rt);
      if (child.score > best.score) best = { score: child.score, node: child };
      children.push(child);
    }
    return children;
  };

  let exhaustive = false;
  if (search === 'iddfs') {
    for (let limit = 1; !b.over(); limit++) {
      const depthSeen = new Map([[keyOf((rt.restore(root.snap), rt)), 0]]);
      cutByDepth = false;
      const stack = [root];
      const admit = (key, d) => { const old = depthSeen.get(key); if (old !== undefined && old <= d) return false; depthSeen.set(key, d); return true; };
      while (stack.length && !b.over() && !wonFound) {
        const node = stack.pop();
        if (node.depth >= limit) { if (rt.restore(node.snap), rt.availableOptions().length) cutByDepth = true; continue; }
        const kids = expand(node, null, admit);
        for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
      }
      if (b.over()) break;
      if (endings.size && !opts.allEndings) { exhaustive = !cutByDepth; break; }
      if (!cutByDepth) { exhaustive = true; break; }
      if (limit >= maxDepth) break;
      // Each iteration re-explores from scratch; dead ends found again are not new.
      deadEnds.splice(50);
    }
  } else {
    const seen = new Set([keyOf((rt.restore(root.snap), rt))]);
    const admit = key => { if (seen.has(key)) return false; seen.add(key); return true; };
    const frontier = search === 'best-first'
      ? new Heap((x, y) => (x.score - x.depth * 0.01) > (y.score - y.depth * 0.01))
      : { a: [], i: 0, push(x) { this.a.push(x); }, pop() { return this.a[this.i++]; }, get size() { return this.a.length - this.i; } };
    root.score = h((rt.restore(root.snap), rt));
    frontier.push(root);
    while (frontier.size && !b.over() && !wonFound) for (const c of expand(frontier.pop(), seen, admit)) frontier.push(c);
    exhaustive = !frontier.size && !cutByDepth && !b.hit && !wonFound;
  }

  const allBeats = (doc.plot?.storyboard?.acts || []).flatMap(a => (a.beats || []).map(x => x.id));
  const declaredEndings = (doc.plot?.endings || []).map(e => e.id);
  // Determinism: the shortest ending path must replay to the same ending from a fresh world.
  let replayed = null;
  const first = [...endings.entries()].filter(([k]) => outcomes[k] !== 'lost').sort((x, y) => x[1].length - y[1].length)[0];
  if (first && opts.checkReplay !== false) {
    const r = replay(make, seed, first[1], settleSteps, waitSteps);
    replayed = r.ok && (r.rt.state.ending || r.rt.state.status) === first[0];
  }
  return {
    completable: [...endings.keys()].some(k => outcomes[k] !== 'lost'),
    endings: Object.fromEntries(endings), outcomes,
    unreachedEndings: declaredEndings.filter(e => !endings.has(e)),
    beatsNeverFired: allBeats.filter(x => !beatsFired.has(x)),
    deadEnds: deadEnds.slice(0, 5), deadEndCount: deadEnds.length,
    states: b.usedStates + 1, expanded, tries, exhaustive, search,
    bestPath: best.node ? pathOf(best.node) : [], bestScore: best.score,
    startOptions, errors: errors.slice(0, 5), replayed, travel: travel ? travel.mode() : null,
    abstraction: { declared: abs.declared },
    budget: b.report(),
    wallMs: Math.round(b.elapsed()),
  };
}
