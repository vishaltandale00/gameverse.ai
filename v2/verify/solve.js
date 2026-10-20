// Plot solver: is the game completable, and how? Searches the real runtime
// (headless, deterministic) over player options exposed by primitives,
// deduplicating states by an abstract key. Finds endings with input paths,
// beats that never fired, and dead ends (no options, not ended).
import { createWorld } from '../kernel/world.js';

function abstractKey(rt) {
  const s = rt.state, p = rt.player();
  return JSON.stringify([p?.space, p?.at, s.status, s.flags, s.prim, Object.keys(s.vars).sort().map(k => [k, s.vars[k]])]);
}

export function solve(doc, registry, logic, { budgetMs = 2000, maxStates = 20000, settleSteps = 2 } = {}) {
  const started = performance.now();
  const rt = createWorld(doc, registry, logic);
  const settle = () => { for (let i = 0; i < settleSteps && rt.state.status === 'playing'; i++) rt.step(); };
  settle();
  const beatsFired = new Set(), endings = new Map(), deadEnds = [];
  const record = () => { for (const id of Object.keys(rt.store('plot.storyboard').fired || {})) beatsFired.add(id); };
  record();
  const seen = new Set([abstractKey(rt)]);
  const queue = [{ snap: rt.snapshot(), path: [] }];
  let expanded = 0;
  while (queue.length && seen.size < maxStates && performance.now() - started < budgetMs) {
    const { snap, path } = queue.shift(); // breadth-first: shortest paths to endings
    rt.restore(snap);
    const options = rt.availableOptions(); expanded++;
    if (!options.length) { deadEnds.push(path.map(o => o.label)); continue; }
    for (const option of options) {
      rt.restore(snap);
      for (let i = 0; i < (option.steps || 1) && rt.state.status === 'playing'; i++) rt.step({ actions: option.actions });
      settle(); record();
      const next = [...path, option];
      if (rt.state.status !== 'playing') {
        const key = rt.state.ending || rt.state.status;
        if (!endings.has(key) || endings.get(key).length > next.length) endings.set(key, next.map(o => o.label));
        continue;
      }
      const key = abstractKey(rt);
      if (seen.has(key)) continue;
      seen.add(key); queue.push({ snap: rt.snapshot(), path: next });
    }
  }
  const allBeats = (doc.plot?.storyboard?.acts || []).flatMap(a => (a.beats || []).map(b => b.id));
  const declaredEndings = (doc.plot?.endings || []).map(e => e.id);
  const exhausted = !queue.length;
  return {
    completable: endings.size > 0,
    endings: Object.fromEntries(endings),
    unreachedEndings: declaredEndings.filter(e => !endings.has(e)),
    beatsNeverFired: allBeats.filter(b => !beatsFired.has(b)),
    deadEnds: deadEnds.slice(0, 5),
    states: seen.size, expanded, exhaustive: exhausted,
    wallMs: Math.round(performance.now() - started),
  };
}
