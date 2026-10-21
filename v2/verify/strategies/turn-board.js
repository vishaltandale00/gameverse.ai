// Turn-board search for options-driven games where the player picks moves and
// an AI answers: tactics (gameplay.turns), card battles, RTS orders. A
// depth-limited max search over the runtime's legal options (rt.options):
// each option is applied on a snapshot and the world advanced to the next
// decision (the AI side's reply is the game's own AI, so the search plays
// against the real opponent policy); chance is sampled by reseeding state.rng
// at the root so hit rolls are not peeked at. The top `width` first moves are
// searched one ply deeper. Leaves are scored by the document objective
// (primitives' progress hooks, goal leaves, won/lost) plus a small pull toward
// the nearest opponent. Games that keep running between decisions (RTS) are
// detected by idling: each choice is then held for `dwell` frames, and
// waiting is a choice too.
import { applyOption, hold, optionLabels, foes, posOf } from '../drive.js';
import { objective } from '../objective.js';
import { budget as makeBudget, stableStringify, stateHash } from '../util.js';
import { untilDecision, chanceSeeds, multiSeed, ownerPath, problem } from './common.js';

const WIN = 1e6;

/** True when the world keeps changing with no input (real time) once the start has settled (1 s): entities or primitive state differ while idling. */
export function runsOnItsOwn(rt, frames = 30) {
  const snap = rt.snapshot(), view = () => stableStringify([rt.state.entities, rt.state.prim]);
  hold(rt, {}, 60); const a = view(); hold(rt, {}, frames); const changed = rt.state.status === 'playing' && view() !== a; rt.restore(snap);
  return changed;
}

/** Choices at the current state: [{ label, option? }] (+ 'wait' when the game runs in real time). */
export function macrosOf(rt, realtime) {
  const options = rt.availableOptions(), labels = optionLabels(options);
  const out = options.map((option, i) => ({ label: labels[i], option }));
  if (realtime) out.push({ label: 'wait' });
  return out;
}

/** Play one choice and advance to the next decision (turn games) or for `dwell` frames (real time). */
export function playMacro(rt, m, { realtime, dwell = 60, maxWait = 900, b = null } = {}) {
  if (m.option) applyOption(rt, m.option, b);
  // A choice that takes the options away (a shot in flight, the AI's turn) resolves to the next decision.
  if (!realtime || !rt.availableOptions().length) untilDecision(rt, maxWait, b);
  else hold(rt, {}, m.option ? Math.max(0, dwell - 1) : dwell, b);
}

/** Replay a recorded path of choice labels from a fresh world; returns the world. */
export function replayMacros(make, seed, path, { realtime, dwell = 60, maxWait = 900 } = {}) {
  const rt = make(seed);
  untilDecision(rt, maxWait);
  for (const label of path) {
    if (rt.state.status !== 'playing') break;
    const m = macrosOf(rt, realtime).find(x => x.label === label);
    if (!m) break;
    playMacro(rt, m, { realtime, dwell, maxWait });
  }
  return rt;
}

/** Leaf value: won/lost, the objective, and a small pull toward the nearest opponent. */
export function leafValue(rt, score) {
  if (rt.state.status === 'won') return WIN - rt.state.frame;
  if (rt.state.status === 'lost') return -WIN;
  let v = score(rt);
  const p = rt.player();
  if (p?.space && typeof rt.space(p.space).distance === 'function') {
    const at = posOf(rt, p), api = rt.space(p.space), d = foes(rt).filter(e => e.components.health?.hp !== 0).map(e => api.distance(at, e.at)).filter(Number.isFinite);
    if (d.length) v -= 0.01 * Math.min(...d);
  }
  return v;
}

/** Best choice index at the current state: { i, v, label }, or null when there is none. */
export function chooseMacro(rt, score, { realtime, depth = 2, width = 4, samples = 2, maxBranch = 24, dwell, maxWait, b } = {}) {
  const snap = rt.snapshot(), macros = macrosOf(rt, realtime).slice(0, maxBranch);
  if (!macros.length) return null;
  const evalAfter = (m, rng) => {
    rt.restore(snap);
    if (rng !== null) rt.state.rng = rng >>> 0 || 1;
    playMacro(rt, m, { realtime, dwell, maxWait, b });
    b?.state();
    return leafValue(rt, score);
  };
  const first = macros.map((m, i) => {
    const seeds = samples > 1 ? chanceSeeds(rt, samples, `tb${i}`) : [null];
    let total = 0;
    for (const s of seeds) total += evalAfter(m, s);
    return { i, label: m.label, v: total / seeds.length };
  });
  rt.restore(snap);
  if (depth > 1) {
    const heads = first.slice().sort((x, y) => y.v - x.v || x.i - y.i).slice(0, width);
    for (const h of heads) {
      if (b?.over()) break;
      rt.restore(snap); playMacro(rt, macros[h.i], { realtime, dwell, maxWait, b });
      if (rt.state.status !== 'playing') continue;
      const inner = rt.snapshot(), next = macrosOf(rt, realtime).slice(0, maxBranch);
      let best = -Infinity;
      for (const m of next) {
        rt.restore(inner); playMacro(rt, m, { realtime, dwell, maxWait, b }); b?.state();
        best = Math.max(best, leafValue(rt, score));
      }
      if (next.length) h.v = Math.max(h.v, best);
    }
    rt.restore(snap);
  }
  return first.reduce((m, c) => (c.v > m.v ? c : m));
}

export default {
  id: 'turn-board',
  intent: 'Turn and order games driven by legal options (tactics, card battles, RTS orders): a depth-limited search over rt.options against the game\'s own AI must win at the pass rate.',
  requires: { options: true },
  hints: ['gameplay.turns', 'gameplay.cards', 'gameplay.rts'],
  detect(ctx) { const rt = ctx.make(ctx.seed); untilDecision(rt, 600); return rt.availableOptions().length > 0 && foes(rt).length > 0; },
  run(ctx, { seeds = [1, 2, 3], passRate = 0.67, maxDecisions = 200, depth = 2, width = 4, samples = 2, maxBranch = 24, dwell = 60, maxWait = 900, budgetMs = 2000, maxSteps = Infinity } = {}) {
    const b = makeBudget({ ms: budgetMs, steps: maxSteps });
    // Every side emits the same loop events here, so the score is the primitives' side-aware progress hooks when the
    // document has them (event counts would reward letting the opponent act).
    const sided = objective(ctx.doc, ctx.registry, ctx.logic, { counts: false });
    const { score } = sided.hooks ? sided : objective(ctx.doc, ctx.registry, ctx.logic);
    const probe = ctx.make(ctx.seed); untilDecision(probe, maxWait);
    const realtime = runsOnItsOwn(probe), where = ownerPath(ctx, probe, ['gameplay.turns', 'gameplay.cards', 'gameplay.rts']);
    const play = seed => {
      const rt = ctx.make(seed), path = [];
      untilDecision(rt, maxWait, b);
      while (rt.state.status === 'playing' && path.length < maxDecisions && !b.over()) {
        const c = chooseMacro(rt, score, { realtime, depth, width, samples, maxBranch, dwell, maxWait, b });
        if (!c) break;
        const m = macrosOf(rt, realtime)[c.i];
        playMacro(rt, m, { realtime, dwell, maxWait, b });
        path.push(m.label);
      }
      const won = rt.state.status === 'won';
      return { seed, won, status: rt.state.status, ending: rt.state.ending, decisions: path.length, frames: rt.state.frame, path, hash: stateHash(rt.state), budget: !won && rt.state.status === 'playing' && Boolean(b.hit) };
    };
    const r = multiSeed(play, { seeds, passRate, b });
    const finished = r.runs.filter(x => !x.budget), problems = [];
    if (!finished.length) problems.push(problem('budget_exhausted', where, 'turn-board search ran out of budget before a game finished', { severity: 'warning' }));
    else if (finished.filter(x => x.won).length / finished.length < passRate) problems.push(problem('too_hard', where, `a turn-board search won ${finished.filter(x => x.won).length}/${finished.length} seeded games (it usually ended '${finished.find(x => !x.won)?.ending || finished.find(x => !x.won)?.status}')`, { hint: 'weaker or fewer opponent units, more player units or AP, or stronger player actions' }));
    return { ok: !problems.some(p => p.severity === 'error'), proven: r.ok ? [`a turn-board search (depth ${depth}) won ${r.wins}/${r.runs.length} seeded games`] : [], problems, metrics: { realtime, runs: r.runs, rate: r.rate }, exhaustive: false, budget: b.report() };
  },
};
