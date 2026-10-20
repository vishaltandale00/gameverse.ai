// Aim/power search for launchers (ported from the physics kit's slingshot
// and peggle checks). A primitive declares an impulse verb on its card:
//   card.actionSpace = { launch: { angle: { min, max }, power: { min, max } } }
// or { verb: { kind: 'impulse'|'continuous', params: {...} } }; continuous
// controls (driving, steering) are skipped.
// The search sweeps the first parameter finely and the others at a few
// levels, simulates each shot on a snapshot until every moving body settles,
// and plays the best shot (defeats first, then damage, then the objective)
// shot by shot until no targets remain. Targets never touched by any sampled
// shot are reported: they are out of reach of every aim.
import { hold, foes, hpOf, velOf } from '../drive.js';
import { budget as makeBudget, instancesOf, stateHash } from '../util.js';
import { problem, entityPath } from './common.js';
import { objective } from '../objective.js';

/** Continuous verbs declared by the document's primitives: [{ verb, params: {name:{min,max}}, path }]. */
export function actionSpaces(ctx) {
  const out = [];
  for (const x of instancesOf(ctx.doc)) {
    const p = ctx.registry.get(x.inst?.use), as = p?.card?.actionSpace;
    if (!as) continue;
    const spec = typeof as === 'function' ? as(x.inst.with || {}) : as;
    for (const [verb, entry] of Object.entries(spec || {})) {
      // Shapes: { param: {min,max} } (an impulse verb) or { kind: 'impulse'|'continuous', params: {...} }.
      const kind = entry?.params ? entry.kind ?? 'impulse' : 'impulse', params = entry?.params ?? entry;
      if (kind !== 'impulse') continue; // continuous controls (driving, steering) are not launches
      const ranges = Object.fromEntries(Object.entries(params || {}).filter(([, r]) => r && typeof r === 'object' && Number.isFinite(r.min) && Number.isFinite(r.max)));
      if (Object.keys(ranges).length) out.push({ verb, params: ranges, path: x.path });
    }
  }
  return out;
}

/** Sample points of a parameter space: `fine` levels on the first parameter, `levels` on the rest (from the top). */
export function samples(params, { fine = 24, levels = [1, 0.86, 0.72] } = {}) {
  const names = Object.keys(params);
  let out = [{}];
  names.forEach((n, i) => {
    const { min = 0, max = 1 } = params[n];
    const vals = i === 0 ? Array.from({ length: fine }, (_, k) => min + (max - min) * (k + 0.5) / fine) : levels.map(f => min + (max - min) * f);
    out = out.flatMap(o => vals.map(v => ({ ...o, [n]: +v.toFixed(5) })));
  });
  return out;
}

const moving = (rt, eps) => Object.values(rt.state.entities).some(e => e.id !== 'player' && velOf(e).some(v => Math.abs(v) > eps));
/** Fire `verb` with `value` and step until bodies settle; returns frames used. */
export function shoot(rt, verb, value, { maxFrames = 720, quiet = 10, eps = 0.05, b = null } = {}) {
  hold(rt, { actions: { [verb]: value } }, 1, b);
  let still = 0, f = 0;
  for (; f < maxFrames && rt.state.status === 'playing' && still < quiet; f++) { hold(rt, {}, 1, b); still = moving(rt, eps) ? 0 : still + 1; }
  return f + 1;
}

export default {
  id: 'aim',
  intent: 'Launchers (slingshot, cannon, golf, pool): a sweep over declared aim/power parameters must clear every target within the shots available.',
  requires: {},
  detect(ctx) { return actionSpaces(ctx).length > 0; },
  run(ctx, { fine = 24, levels, maxShots = 20, budgetMs = 2000, maxSteps = Infinity } = {}) {
    const b = makeBudget({ ms: budgetMs, steps: maxSteps });
    const [space] = actionSpaces(ctx);
    const { score } = objective(ctx.doc, ctx.registry, ctx.logic);
    const rt = ctx.make(ctx.seed);
    const targets = new Map(foes(rt).map(e => [e.id, hpOf(e)]));
    const hitEver = new Set(), plan = [];
    const pts = samples(space.params, { fine, levels });
    let sims = 0;
    const effect = (before, r) => { let kills = 0, dmg = 0; for (const [id, hp] of before) { const e = r.entity(id); if (!e || (hpOf(e) ?? 1) <= 0) { kills++; hitEver.add(id); } else if (hpOf(e) < hp) { dmg += hp - hpOf(e); hitEver.add(id); } } return { kills, dmg }; };
    while (rt.state.status === 'playing' && plan.length < maxShots && !b.over()) {
      const living = new Map(foes(rt).filter(e => (hpOf(e) ?? 1) > 0).map(e => [e.id, hpOf(e)]));
      if (!living.size) break;
      const snap = rt.snapshot(), base = score(rt), h0 = stateHash({ ...rt.state, frame: 0, time: 0, events: [], counts: {} });
      let best = null;
      for (const v of pts) {
        if (b.over()) break;
        rt.restore(snap);
        shoot(rt, space.verb, v, { b }); sims++;
        if (stateHash({ ...rt.state, frame: 0, time: 0, events: [], counts: {} }) === h0) continue;
        const e = effect(living, rt), val = e.kills * 1e6 + e.dmg * 1e3 + (score(rt) - base) + (rt.state.status === 'won' ? 1e9 : 0) - (rt.state.status === 'lost' ? 1e9 : 0);
        if (!best || val > best.val) best = { val, v, snap: rt.snapshot(), ...e };
      }
      if (!best || (best.kills === 0 && best.dmg === 0 && rt.state.status === 'playing' && best.val <= 0)) { rt.restore(snap); break; }
      rt.restore(best.snap);
      plan.push({ value: best.v, defeated: best.kills, damage: best.dmg });
    }
    const left = foes(rt).filter(e => (hpOf(e) ?? 1) > 0);
    const solved = rt.state.status === 'won' || !left.length;
    const problems = [];
    const never = [...targets.keys()].filter(id => !hitEver.has(id));
    for (const id of never) { const e = ctx.make(ctx.seed).entity(id); problems.push(problem('target_unreachable', entityPath(ctx.doc, e), `target '${id}' (${e?.archetype}) is never touched by any sampled ${space.verb} (${pts.length} aims × ${plan.length || 1} shots)`, { severity: 'warning', hint: 'move it out of cover or closer to the launcher' })); }
    if (!solved && !b.hit) problems.push(problem('launch_unsolved', space.path, `no shot plan cleared the targets: ${left.length} of ${targets.size} left after ${plan.length} shots`, { hint: 'add shots, bring targets closer or out of cover, or lower their toughness' }));
    if (!solved && b.hit) problems.push(problem('budget_exhausted', space.path, `aim search stopped by its budget after ${plan.length} shots`, { severity: 'warning' }));
    return { ok: !problems.some(p => p.severity === 'error'), proven: solved ? [`an aim search cleared every target in ${plan.length} shots (${sims} simulated)`] : [], problems, metrics: { verb: space.verb, shots: plan, sims, targets: targets.size, touched: hitEver.size }, exhaustive: false, budget: b.report() };
  },
};
