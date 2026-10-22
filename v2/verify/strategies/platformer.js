// Platformer bot (card.mode loop 'platformer'): runs and jumps a side-view level to its goal through the player's real
// controls only (the held move axis and the jump verb a person presses). It plans from the state and the space API: a
// route of the player's feet cells to the goal (api.path with the player's movement envelope, kept to whole tiles, so
// every edge is a walk, a fall or a jump the controller makes), then plays the route segment by segment:
//   - a run of walk edges along one floor: hold the axis toward its last cell;
//   - a jump or a fall: steer toward the landing cell and press jump, held for as long as the candidate says;
// each segment is tried from a snapshot with a few candidates (when to start, how long to hold jump, whether to steer
// at once or after rising, whether to hop over a threat ahead) and the first one that lands the player on the route,
// further along, without losing health or a life is kept. When none does, it waits a moment (threats pace) and plans
// again, with a shorter reach if the route keeps failing. The goal is the entity carrying the component the mode's
// card owns (card.components); touching it wins. It must win.
import { hold, posOf, threats, vitality } from '../drive.js';
import { stateHash } from '../util.js';
import { modesIn } from '../../primitives/gameplay/modes-lib-mode.js';
import { navOptions } from '../movement.js';
import { multiSeed, problem, yieldToEncounter, seedBudgets } from './common.js';

const LOOP = 'platformer';

const keyOf = (x, y) => `${x},${y}`;
const unkey = k => k.split(',').map(Number);
/** Tiles a route still covers from its index `i` (Manhattan between consecutive cells). */
const span = (route, i = 0) => { let d = 0; for (let k = i + 1; k < route.length; k++) { const [a, b] = unkey(route[k - 1]), [c, e] = unkey(route[k]); d += Math.abs(c - a) + Math.abs(e - b); } return d; };

/**
 * The player's movement envelope in whole tiles (the route never asks for more than the controller does), step `k` of
 * a ladder of shorter reaches: each step a tile less distance, every second step a tile less height.
 */
export const REACH_STEPS = 4;
function reachOpts(base, k) {
  const env = { ...base.envelope }, dh = Math.floor(k / 2);
  if (Number.isFinite(env.jumpHeight)) env.jumpHeight = Math.max(1, Math.floor(env.jumpHeight) - dh);
  if (Number.isFinite(env.jumpGap)) env.jumpGap = Math.max(1, Math.floor(env.jumpGap) - k);
  if (Number.isFinite(env.jumpDistance)) env.jumpDistance = Math.max(1, Math.floor(env.jumpDistance) - k);
  if (Number.isFinite(env.dash)) env.dash = Math.floor(env.dash);
  return { ...base, envelope: env };
}

/**
 * The platform runner over one world, through the real controls only (the held move axis and the jump verb): it plans a
 * route of the player's feet cells (api.path with the player's movement envelope, kept to whole tiles) and plays it
 * segment by segment, each segment tried from a snapshot with a few candidates (see the header). Used by the platformer
 * bot (toward the goal entity) and by the race bot on foot on a side-view level (toward the next checkpoint zone).
 * @param {any} ctx @param {any} rt a controlled world @param {any} b its budget
 * @returns {{ advance: (goal: { to: string, x: number } | null) => 'yielded' | 'waited' | 'moved' | 'stuck', counts: Record<string, number>, presses: { jump: number }, step: (input: any, n?: number) => number }}
 */
export function platformRunner(ctx, rt, b) {
  const counts = { segments: 0, tries: 0, replans: 0, waits: 0 }, presses = { jump: 0 }; // presses over every candidate tried
  const step = (input, n = 1) => hold(rt, input, n);
  const feet = (api, e) => api.cellOf(e);
  const grounded = e => Boolean(e?.components?.body?.grounded);
  const worse = (v0, v) => rt.state.status === 'lost' || !v.alive || (v.lives !== null && v0.lives !== null && v.lives < v0.lives) || (v.hp !== null && v0.hp !== null && v.hp < v0.hp);
  /**
   * One controller run from the current state toward route cell `to`: steer the held axis toward its column (now,
   * or once the feet have risen above it), press jump at frame `delay` and hold it `jump` frames (0: no jump),
   * hop when a threat is within `hop` tiles ahead. Ends two frames after landing (or arriving), or at `limit`.
   */
  const control = (to, { delay = 0, jump = 0, steer = 'now', hop = 0, back = 0, limit = 150 }) => {
    const [tx, ty] = unkey(to), cx = tx + 0.5, start = rt.player(), dir = start ? Math.sign(cx - posOf(rt, start)[0]) : 0;
    // `back`: a run-up: hold the axis away from the target for that many frames, then run back and take off where it started.
    const x0 = start ? posOf(rt, start)[0] : 0;
    let f = 0, left = false, onGround = 0, held = 0, returned = back === 0;
    while (f < limit && rt.state.status === 'playing' && !b.over()) {
      const p = rt.player(); if (!p) break;
      const at = posOf(rt, p), vx = p.components.body?.vel?.[0] ?? 0, dx = cx - at[0];
      const api = rt.space(p.space), fy = unkey(feet(api, p))[1];
      const tol = 0.2 + Math.abs(vx) * 0.06;
      const go = steer === 'now' || fy >= ty || (left && (p.components.body?.vel?.[1] ?? 0) <= 0);
      if (!returned && f >= back && (at[0] - x0) * dir >= 0) returned = true;
      // Stepping down off a ledge: keep pushing until the feet leave it (the body overhangs the edge before it drops).
      const x = f < back ? -dir : !left && ty < fy && dir ? dir : go && Math.abs(dx) > tol ? Math.sign(dx) : 0;
      let press = false;
      if (jump > 0 && f >= delay + back && returned && held < jump && (held > 0 || grounded(p))) { press = true; held++; }
      if (hop > 0 && grounded(p) && !press) {
        const dir = Math.sign(dx) || 1;
        if (threats(rt).some(o => { const d = (posOf(rt, o)[0] - at[0]) * dir; return d > 0 && d < hop && Math.abs(posOf(rt, o)[1] - at[1]) < 1.5; })) { press = true; held = 1; jump = Math.max(jump, 10); }
      }
      if (press && held === 1) presses.jump++;
      step({ axes: { move: [x, 0] }, ...(press ? { actions: { jump: true } } : {}) });
      f++;
      const q = rt.player(); if (!q) break;
      if (!grounded(q)) left = true;
      onGround = grounded(q) ? onGround + 1 : 0;
      const arrived = feet(rt.space(q.space), q) === to;
      if (onGround >= 2 && (arrived || left)) break;
    }
    return f;
  };
  let shrink = 0, failures = 0, plan = null, planFor = null;
  /**
   * One decision toward `goal` ({ to: the route's end, a feet cell key or a zone id the space's path accepts, x: the
   * column to push toward at the route's end }): -> 'yielded' | 'waited' | 'moved' | 'stuck' (nothing worked 60 times).
   */
  const advance = goal => {
    if (yieldToEncounter(ctx, rt, ['position', 'gravity', 'pathfind'])) return 'yielded'; // an encounter holds this loop: play the one the player is in
    const p = rt.player();
    if (!p || p.components.health?.dead || !grounded(p)) { step({}, 1); return 'waited'; }
    if (!goal) { step({}, 6); counts.waits++; return 'waited'; }
    const api = rt.space(p.space), here = feet(api, p);
    const nav = reachOpts(navOptions(rt, ctx.registry, p).opts, shrink);
    const target = goal.to;
    if (planFor !== target) { plan = null; planFor = target; }
    if (!plan || !plan.includes(here)) {
      const pts = api.path(here, target, nav);
      counts.replans++;
      plan = pts ? pts.map(w => feet(api, { at: w, components: { body: { size: p.components.body?.size || [1, 1] } } })) : null;
      if (!plan) { shrink = (shrink + 1) % REACH_STEPS; if (shrink) return 'waited'; step({}, 20); counts.waits++; return ++failures > 60 ? 'stuck' : 'waited'; }
    }
    // Standing where the route's graph has no node (on a body, an edge it rounds off): the route starts from its first node.
    if (!plan.includes(here)) plan = [here, ...plan];
    const i = plan.indexOf(here);
    if (i === plan.length - 1) { step({ axes: { move: [Math.sign(goal.x - posOf(rt, p)[0]) || 1, 0] } }, 4); return 'moved'; }
    // The segment: a run of walk edges along one floor, else the next edge (a jump or a fall).
    const [x0, y0] = unkey(here);
    let j = i + 1;
    const walk = k => { const [a, c] = unkey(plan[k - 1]), [d, e] = unkey(plan[k]); return e === c && Math.abs(d - a) === 1 && c === y0 && Math.sign(d - a) === Math.sign(unkey(plan[i + 1])[0] - x0); };
    if (walk(j)) while (j + 1 < plan.length && walk(j + 1)) j++;
    const [tx, ty] = unkey(plan[j]), isWalk = walk(i + 1);
    const rise = ty > y0, far = Math.abs(tx - x0);
    const tries = isWalk
      ? [{}, { hop: 2.5 }, { hop: 3.5 }, { delay: 30 }, { delay: 60, hop: 2.5 }, { jump: 8 }, { jump: 30 }]
      : rise || far > 1
        ? (rise && far <= 2
          ? [{ jump: 40, steer: 'rise' }, { jump: 40 }, { jump: 16, steer: 'rise' }, { jump: 40, back: 10 }, { jump: 40, delay: 30, steer: 'rise' }, { jump: 40, delay: 60 }, { jump: 12 }]
          : [{ jump: 40 }, { jump: 40, back: 12 }, { jump: 16 }, { jump: 40, back: 24 }, { jump: 8 }, { jump: 40, steer: 'rise' }, { jump: 40, delay: 30 }, { jump: 40, back: 12, delay: 45 }])
        : [{}, { jump: 6 }, { delay: 30 }, { jump: 12, delay: 30 }, { delay: 60 }];
    const snap = rt.snapshot(), v0 = vitality(rt), left = span(plan, i);
    let best = null;
    for (const t of tries) {
      rt.restore(snap); counts.tries++;
      control(plan[j], { limit: Math.max(90, far * 12 + (t.delay || 0) + 3 * (t.back || 0) + 60), ...t });
      const q = rt.player(), v = vitality(rt);
      if (rt.state.status === 'won') { best = { plan }; break; }
      if (!q || worse(v0, v) || !grounded(q)) continue;
      const at = feet(rt.space(q.space), q), k = plan.indexOf(at);
      if (k > i) { best = { plan }; break; }
      // Off the route (stepped up onto a ledge, landed short or long): progress when the route from there is shorter.
      if (k < 0) { const pts = rt.space(q.space).path(at, target, nav), route = pts && pts.map(w => feet(api, { at: w, components: { body: { size: q.components.body?.size || [1, 1] } } })); if (route && span(route) < left) { best = { plan: route }; break; } }
    }
    if (best === null) {
      // No candidate made progress: let a moment pass where nothing hurts (stand, back off, or hop in place), then plan again.
      for (const input of [{}, { axes: { move: [-(Math.sign(tx - x0) || 1), 0] } }, { actions: { jump: true } }]) {
        rt.restore(snap); step(input, 15);
        if (!worse(v0, vitality(rt))) break;
      }
      counts.waits++;
      plan = null; failures++;
      if (failures % 2 === 0) shrink = (shrink + 1) % REACH_STEPS;
      return failures > 60 ? 'stuck' : 'waited';
    }
    plan = best.plan;
    counts.segments++; failures = 0;
    return 'moved';
  };
  return { advance, counts, presses, step };
}

export default {
  id: 'platformer',
  intent: 'Side-view platform levels: a runner that plans a route of walks, falls and jumps to the goal and plays it through the real controls (held axis, jump presses) must reach the goal.',
  requires: { capabilities: ['position', 'gravity', 'pathfind'] },
  detect(ctx) { return modesIn(ctx.doc, ctx.registry).some(m => m.mode.loop === LOOP); },
  run(ctx, { seeds = [1], passRate = 1, maxFrames = 20000, maxSteps = Infinity } = {}) {
    const sb = seedBudgets(maxSteps);
    const mode = modesIn(ctx.doc, ctx.registry).find(m => m.mode.loop === LOOP);
    const where = mode?.path || 'systems';
    if (!mode) return { ok: true, proven: [], problems: [], metrics: { skipped: 'no platformer' }, exhaustive: false, budget: sb.report() };
    const marks = Object.keys(ctx.registry.get(mode.use)?.card?.components || {});
    const play = seed => {
      const b = sb.budget(), rt = b.meter(ctx.make(seed)), run = platformRunner(ctx, rt, b);
      // The goal: the entity carrying the component the mode's card owns; the route ends at the cell under its feet.
      const goalOf = p => Object.values(rt.state.entities).filter(e => e !== p && e.space === p.space && marks.some(c => e.components[c] !== undefined)).sort((a, c) => (a.id < c.id ? -1 : 1))[0] || null;
      while (rt.state.status === 'playing' && rt.state.frame < maxFrames && !b.over()) {
        const p = rt.player(), goal = p ? goalOf(p) : null;
        const gs = goal?.components.body?.size || [1, 1], gat = goal ? posOf(rt, goal) : null;
        if (run.advance(goal ? { to: keyOf(Math.floor(gat[0]), Math.floor(gat[1] - gs[1] / 2 + 1e-6)), x: gat[0] } : null) === 'stuck') break;
      }
      const won = rt.state.status === 'won';
      return { seed, won, status: rt.state.status, frames: rt.state.frame, lives: rt.state.vars.lives ?? null, presses: run.presses, decisions: run.counts, hash: stateHash(rt.state), budget: !won && rt.state.status === 'playing' && Boolean(b.hit) };
    };
    const r = multiSeed(play, { seeds, passRate });
    const finished = r.runs.filter(x => !x.budget), problems = [];
    if (!finished.length) problems.push(problem('budget_exhausted', where, 'the platformer bot ran out of budget before the level ended', { severity: 'warning' }));
    else if (finished.filter(x => x.won).length / finished.length < passRate) { const last = finished[finished.length - 1]; problems.push(problem('too_hard', where, `a platformer bot reached the goal in ${finished.filter(x => x.won).length}/${finished.length} levels (last: ${last.status} after ${last.frames} frames)`, { hint: 'narrower pits, fewer hazards or enemies, a stronger jump, more lives' })); }
    return { ok: !problems.some(p => p.severity === 'error'), proven: r.ok ? [`a platformer bot reached the goal in ${r.wins}/${r.runs.length} levels`] : [], problems, metrics: { runs: r.runs, rate: r.rate }, exhaustive: false, budget: sb.report() };
  },
};
