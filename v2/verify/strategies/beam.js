// Beam prover for auto-scrolling courses (ported from the runner kit's chunk
// prover). The run axis is discovered by idling: the player drifts along it.
// A beam over the player's macros (options, or idle/axes/verbs held for
// `every` frames) keeps the best survivor per abstract cell, bucketed by the
// cross-axis band so it never collapses onto one line; it must reach the end
// of the course (the far edge of its zones, a distance, or a win). When it
// fails, the problem names the zone ("chunk") the furthest survivor was in.
import { inputMacros, hold, applyOption, optionLabels, vitality, posOf } from '../drive.js';
import { budget as makeBudget, problem } from '../util.js';

/** Run axis and direction from an idle probe; null when the player does not drift. */
export function runAxis(rt, frames = 30) {
  const a0 = posOf(rt); if (!Array.isArray(a0)) return null;
  const s = rt.snapshot(); hold(rt, {}, frames); const a1 = posOf(rt); rt.restore(s);
  if (!Array.isArray(a1)) return null;
  const d = a1.map((v, i) => v - a0[i]); let axis = 0;
  for (let i = 1; i < d.length; i++) if (Math.abs(d[i]) > Math.abs(d[axis])) axis = i;
  return Math.abs(d[axis]) > 0.05 ? { axis, sign: Math.sign(d[axis]), speed: Math.abs(d[axis]) / frames } : null;
}

function select(list, beam, bucket) {
  list.sort((a, b) => b.sc - a.sc);
  if (list.length <= beam) return list;
  const seen = new Set(), out = [], rest = [];
  for (const n of list) { const k = bucket(n); if (seen.has(k)) rest.push(n); else { seen.add(k); out.push(n); } }
  return out.slice(0, beam).concat(rest.slice(0, Math.max(0, beam - out.length)));
}

/**
 * Beam search from rt's current state until done(rt). Returns { ok, frames, best, path }.
 * macros: [{label, option?|input}] tried every `every` frames.
 */
export function prove(rt, { done, macros, every = 6, beam = 16, maxFrames = 3600, key, score, bucket, b = null }) {
  let layer = [{ snap: rt.snapshot(), path: [], sc: score(rt) }], bestNode = layer[0];
  for (let f = 0; f < maxFrames; f += every) {
    if (b?.over()) return { ok: false, frames: f, best: bestNode, timeout: true };
    const next = new Map();
    for (const node of layer) for (const m of macros) {
      rt.restore(node.snap);
      const v0 = vitality(rt);
      if (m.option !== undefined) { const o = rt.availableOptions().find((_, i) => optionLabels(rt.availableOptions())[i] === m.label); if (!o) continue; applyOption(rt, o, b); }
      else hold(rt, m.input, every, b);
      const path = [...node.path, m.label];
      if (done(rt)) return { ok: true, frames: f + every, best: { snap: rt.snapshot(), path, sc: score(rt) }, path };
      const v = vitality(rt);
      if (rt.state.status !== 'playing' || !v.alive || (v.lives !== null && v0.lives !== null && v.lives < v0.lives) || (v.hp !== null && v0.hp !== null && v.hp < v0.hp)) continue;
      const k = key(rt), sc = score(rt);
      const old = next.get(k);
      if (!old || sc > old.sc) next.set(k, { snap: rt.snapshot(), path, sc, b: bucket(rt) });
    }
    if (!next.size) return { ok: false, frames: f, best: bestNode };
    layer = select([...next.values()], beam, n => n.b);
    if (layer[0].sc > bestNode.sc) bestNode = layer[0];
  }
  return { ok: false, frames: maxFrames, best: bestNode };
}

export default {
  id: 'beam',
  intent: 'Auto-scrolling courses (runners, flappers, scrolling shooters): a beam prover must find a line through every zone to the end of the course.',
  requires: { capabilities: ['position'] },
  detect(ctx) { const rt = ctx.make(ctx.seed); return Boolean(runAxis(rt)); },
  run(ctx, { every = 6, beam = 16, maxFrames = 3600, distance = null, budgetMs = 2000, maxSteps = Infinity, quantum = 0.5 } = {}) {
    const b = makeBudget({ ms: budgetMs, steps: maxSteps });
    const rt = ctx.make(ctx.seed), dir = runAxis(rt);
    if (!dir) return { ok: true, proven: [], problems: [], metrics: { skipped: 'no run axis' }, exhaustive: false, budget: b.report() };
    const p = rt.player(), sIdx = ctx.doc.spaces.findIndex(s => s.id === p.space), space = ctx.doc.spaces[sIdx], api = rt.space(p.space);
    const start = posOf(rt)[dir.axis];
    // Course end: given distance, else the far edge of the zones along the run axis, else the space size.
    const zones = (space.zones || []).filter(z => Array.isArray(z.rect));
    const edge = z => (dir.sign > 0 ? z.rect[dir.axis + 2] : z.rect[dir.axis]);
    const end = distance !== null ? start + dir.sign * distance : zones.length ? (dir.sign > 0 ? Math.max(...zones.map(edge)) : Math.min(...zones.map(edge))) : Array.isArray(api.size) ? (dir.sign > 0 ? api.size[dir.axis] - 1 : 0) : start + dir.sign * dir.speed * maxFrames;
    const along = r => (posOf(r)?.[dir.axis] - start) * dir.sign;
    const goal = (end - start) * dir.sign;
    const options = rt.availableOptions();
    const macros = options.length ? optionLabels(options).map((label, i) => ({ label, option: i })) : inputMacros(rt, { combos: false });
    const cross = r => posOf(r).map((v, i) => (i === dir.axis ? null : Math.round(v / quantum))).filter(v => v !== null).join(',');
    const res = prove(rt, {
      done: r => r.state.status === 'won' || along(r) >= goal, macros, every, beam, maxFrames, b,
      key: r => `${Math.round(along(r) / quantum)}|${cross(r)}|${vitality(r).hp}`,
      score: r => along(r), bucket: cross,
    });
    const problems = [];
    let failedZone = null;
    if (!res.ok) {
      rt.restore(res.best.snap);
      const z = api.zoneAt?.(posOf(rt), rt);
      const zj = (space.zones || []).findIndex(x => x.id === z);
      failedZone = z;
      if (res.timeout) problems.push(problem('budget_exhausted', `spaces[${sIdx}]`, `the beam prover ran out of budget at ${along(rt).toFixed(1)} of ${goal.toFixed(1)}`, { severity: 'warning' }));
      else problems.push(problem('chunk_impassable', zj >= 0 ? `spaces[${sIdx}].zones[${zj}]` : `spaces[${sIdx}]`, `no line through${z ? ` zone '${z}'` : ' the course'}: the furthest survivor stopped at ${along(rt).toFixed(1)} of ${goal.toFixed(1)}`, { hint: 'narrower gaps, fewer hazards in a row, or a slower scroll speed' }));
    }
    return { ok: !problems.some(p => p.severity === 'error'), proven: res.ok ? [`a beam prover found a line through the whole course (${goal.toFixed(1)} units, ${res.frames} frames)`] : [], problems, metrics: { axis: dir.axis, goal, frames: res.frames, reached: res.ok ? goal : null, failedZone, path: res.path || null }, exhaustive: false, budget: b.report() };
  },
};
