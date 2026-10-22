// ARC-AGI-3-style benchmark harness, native track (ARCHITECTURE.md §7):
// levels are Gameverse documents on engine.space.grid authored here; ARC
// game sources are never copied into this repository. An agent plays each
// level through rt.options() (one option = one action: ACTION1–5 moves and
// interactions, ACTION6 a click carrying x,y, ACTION7 undo when offered).
// Each level scores min(115, (baseline_actions / actions)² × 100) when
// solved, 0 otherwise; levels are averaged with weights by level index
// (level k, 1-based, weighs k).
import { preflight } from '../kernel/document.js';
import { solve } from './solve.js';
import { playtest } from './playtest.js';
import { problem } from './util.js';

export const ARC_SPACES = ['engine.space.grid'];
export const levelScore = (baseline, actions, solved) => (solved && actions > 0 ? Math.min(115, (baseline / actions) ** 2 * 100) : 0);
/** Weighted mean of level scores; weight = 1-based level index. */
export function arcScore(levels) {
  let num = 0, den = 0;
  levels.forEach((l, i) => { const w = l.weight ?? i + 1; num += w * levelScore(l.baseline, l.actions, l.solved); den += w; });
  return den ? +(num / den).toFixed(2) : 0;
}

/** Built-in agents. Each returns { solved, actions, path }. */
export const AGENTS = {
  /** Breadth-first plot solver: optimal option count on small levels. */
  solver: (doc, registry, logic, { maxStates = 50000, seed } = {}) => {
    const r = solve(doc, registry, logic, { maxStates, seed, settleSteps: 0, checkReplay: false });
    const path = Object.entries(r.endings).filter(([k]) => r.outcomes[k] !== 'lost').sort((a, b) => a[1].length - b[1].length)[0]?.[1] || null;
    return { solved: Boolean(path), actions: path ? path.length : null, path, exhaustive: r.exhaustive, states: r.states };
  },
  /** Best-first solver: fewer states, not always the shortest path. */
  'best-first': (doc, registry, logic, { maxStates = 50000, seed } = {}) => {
    const r = solve(doc, registry, logic, { search: 'best-first', maxStates, seed, settleSteps: 0, checkReplay: false });
    const path = Object.entries(r.endings).filter(([k]) => r.outcomes[k] !== 'lost').sort((a, b) => a[1].length - b[1].length)[0]?.[1] || null;
    return { solved: Boolean(path), actions: path ? path.length : null, path, states: r.states };
  },
  /** Go-Explore playtester restricted to options. */
  playtest: (doc, registry, logic, { maxRounds = 4000, maxFrames = 200000, seed } = {}) => {
    const r = playtest(doc, registry, logic, { maxRounds, maxFrames, seed, optionsOnly: true, idleSeconds: 0 });
    return { solved: r.winnable, actions: r.win ? r.win.path.length : null, path: r.win?.path || null };
  },
};

/**
 * runArc(levels, registry, logic, opts) → { score, levels, problems, track }
 * levels: [{ doc, baseline }] in order; opts: { agent: name|fn, allowSpaces, maxCells, ...agent opts }
 */
export function runArc(levels, registry, logic, { agent = 'solver', allowSpaces = ARC_SPACES, maxCells = 64, ...opts } = {}) {
  const play = typeof agent === 'function' ? agent : AGENTS[agent];
  if (!play) throw Error(`unknown ARC agent '${agent}'`);
  const problems = [], out = [];
  levels.forEach((level, i) => {
    const path = `levels[${i}]`;
    const checked = preflight(level.doc, registry, logic);
    if (!checked.ok) { problems.push(problem('preflight', path, checked.errors.map(e => `${e.code} ${e.path}`).join('; '))); out.push({ level: i + 1, baseline: level.baseline, solved: false, actions: null, score: 0 }); return; }
    const doc = checked.doc;
    for (const [j, s] of doc.spaces.entries()) {
      if (!allowSpaces.includes(s.use)) problems.push(problem('arc_space', `${path}.doc.spaces[${j}]`, `ARC-style levels use ${allowSpaces.join(' or ')}; got '${s.use}'`));
      const size = s.with?.size;
      if (Array.isArray(size) && size.slice(0, 2).some(n => n < 1 || n > maxCells)) problems.push(problem('arc_size', `${path}.doc.spaces[${j}].with.size`, `ARC grids are 1–${maxCells} cells per side`));
    }
    if (!(level.baseline > 0)) problems.push(problem('arc_baseline', `${path}.baseline`, 'each level needs a positive baseline action count'));
    const r = play(doc, registry, logic, opts);
    out.push({ level: i + 1, baseline: level.baseline, solved: r.solved, actions: r.actions, score: +levelScore(level.baseline, r.actions, r.solved).toFixed(2), path: r.path, ...(r.exhaustive !== undefined ? { exhaustive: r.exhaustive } : {}) });
  });
  return { track: 'native', agent: typeof agent === 'function' ? agent.name || 'custom' : agent, score: arcScore(out), levels: out, problems };
}
