// Crawler for dungeon crawls (card.mode loop 'crawl'): explore, pick up, open, fight, defeat the boss, through the
// player's real controls only (held move axes and the action verbs a person presses). It plans from the state and
// the space API: a breadth-first search over the moves the player can make (kernel stepsFrom: the space's own
// passability, so a locked door blocks until it opens), with cells from api.cellOf. Each decision:
//   - a foe (an opponent carrying the component the mode's win reads: health) stands next to the player: press
//     toward it and swing the attack verb;
//   - else walk to the nearest pickup or foe it can reach (to a cell next to it: the walker cannot share its cell);
//   - else walk up to an obstacle it has not tried since it last picked something up (a locked door opens when the
//     player arrives holding its key; a chest is tried once);
//   - else wait.
// The attack verbs are the player verbs of the document's loops that act on the component the mode's win reads (the
// loops requiring that component's owner, card.loop.verbs). Moves hold the axis toward the next cell; which way an
// axis moves on the board is learned from what the held axis did, never assumed. It must win (defeat the boss).
import { hold, posOf, threats, collectibles, hpOf } from '../drive.js';
import { stateHash } from '../util.js';
import { modesIn } from '../../primitives/gameplay/modes-lib-mode.js';
import { stepsFrom } from '../../kernel/testing.js';
import { multiSeed, problem, yieldToEncounter, seedBudgets } from './common.js';

const LOOP = 'crawl';

/** The cell key of a position (api.cellOf honours the space's anchor). */
const keyAt = (api, at) => api.cellOf({ at });
const cellOfKey = k => k.split(',').map(Number);

/**
 * The player verbs that change the component the crawl's win reads: the loop verbs of the document's primitives that
 * require an owner of that component, in document order, that the runtime registers.
 */
export function attackVerbs(ctx, rt, mode) {
  const C = mode.win?.reads?.component;
  if (!C) return [];
  const owners = ctx.registry.cards().filter(c => c.components?.[C] !== undefined).map(c => c.id);
  const actions = new Set(rt.actions());
  const out = [];
  for (const s of ctx.doc.systems || []) {
    const card = ctx.registry.get(s.use)?.card;
    if (!(card?.requires?.primitives || []).some(r => owners.some(o => o === r || o.startsWith(`${r}.`)))) continue;
    for (const v of card.loop?.verbs || []) if (actions.has(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

/** BFS over the player's moves from `start` to the nearest cell satisfying goal: the first step of the path, or null. */
function firstStep(api, p, rt, goal, limit = 4000) {
  const start = keyAt(api, posOf(rt, p));
  if (goal(start)) return { at: start, first: null, dist: 0 };
  const first = new Map([[start, null]]), dist = new Map([[start, 0]]), q = [cellOfKey(start)];
  for (let h = 0; h < q.length && h < limit; h++) {
    const c = q[h], k = keyAt(api, c);
    for (const m of stepsFrom(api, p, c, rt)) {
      const mk = keyAt(api, m);
      if (first.has(mk)) continue;
      first.set(mk, k === start ? mk : first.get(k)); dist.set(mk, dist.get(k) + 1); q.push(m);
      if (goal(mk)) return { at: mk, first: first.get(mk), dist: dist.get(mk) };
    }
  }
  return null;
}

export default {
  id: 'crawl',
  intent: 'Dungeon crawls: a crawler that walks to pickups, opens locks, and fights its way to the boss through the real controls must defeat it.',
  requires: { capabilities: ['navigate'] },
  detect(ctx) { return modesIn(ctx.doc, ctx.registry).some(m => m.mode.loop === LOOP); },
  run(ctx, { seeds = [1], passRate = 1, maxFrames = 36000, maxSteps = Infinity, moveFrames = 30 } = {}) {
    const sb = seedBudgets(maxSteps);
    /** The budget of the seed being played (seedBudgets: one per seed). @type {any} */
    let b = null;
    const mode = modesIn(ctx.doc, ctx.registry).find(m => m.mode.loop === LOOP);
    const where = mode?.path || 'spaces';
    if (!mode) return { ok: true, proven: [], problems: [], metrics: { skipped: 'no crawl' }, exhaustive: false, budget: sb.report() };
    const play = seed => {
      const rt = (b = sb.budget()).meter(ctx.make(seed)), verbs = attackVerbs(ctx, rt, mode.mode), C = mode.mode.win?.reads?.component ?? null, counts = { fight: 0, walk: 0, open: 0, wait: 0 };
      // How the move axes map onto the board: learned from what a held axis did ([sign x, sign y] per board axis).
      const axis = [1, 1];
      const tried = new Map();
      let gains = 0, lastPickups = null, blockedFor = 0;
      while (rt.state.status === 'playing' && rt.state.frame < maxFrames && !b.over()) {
        if (yieldToEncounter(ctx, rt, ['navigate'])) continue; // an encounter holds this loop: play the one the player is in
        const p = rt.player();
        if (!p || p.components.health?.dead) { hold(rt, {}, 1); counts.wait++; continue; }
        const api = rt.space(p.space), here = keyAt(api, posOf(rt, p));
        const pickups = collectibles(rt);
        if (lastPickups !== null && pickups.length < lastPickups) gains++;
        lastPickups = pickups.length;
        // Foes: the opponents whose component the win reads (the boss and every guard carrying it), while alive.
        const foes = C ? Object.values(rt.state.entities).filter(e => e !== p && e.space === p.space && e.components[C] !== undefined && !e.components.health?.dead && (hpOf(e) ?? 1) > 0) : threats(rt);
        const near = (k, e) => api.distance(cellOfKey(k), cellOfKey(keyAt(api, e.at))) <= 1 + 1e-9;
        const toward = (from, to) => { const a = cellOfKey(from), c = cellOfKey(to), d = typeof api.delta === 'function' ? api.delta(a, c) : c.map((v, i) => v - a[i]); return [Math.sign(d[0]) * axis[0], Math.sign(d[1] ?? 0) * axis[1]]; };
        // Fight what stands next to the player: face it and swing.
        const adjacent = foes.find(e => near(here, e));
        if (adjacent && verbs.length) {
          hold(rt, { axes: { move: toward(here, keyAt(api, adjacent.at)) }, actions: { [verbs[0]]: true } }, 1);
          counts.fight++; continue;
        }
        // Walk to the nearest pickup or foe, else to an obstacle; what the player stood next to without it changing
        // (a pickup it cannot take, a door without its key, a chest) is not tried again until it next picks something up.
        const fresh = e => (tried.get(e.id) ?? -1) < gains;
        const targets = [...pickups.filter(fresh), ...foes];
        let pool = targets, plan = targets.length ? firstStep(api, p, rt, k => targets.some(e => near(k, e))) : null;
        if (!plan) {
          pool = Object.values(rt.state.entities).filter(e => e !== p && e.space === p.space && !pickups.includes(e) && !foes.includes(e) && fresh(e));
          plan = pool.length ? firstStep(api, p, rt, k => pool.some(e => near(k, e))) : null;
        }
        if (!plan) { hold(rt, {}, 6); counts.wait++; continue; }
        if (!plan.first) { for (const e of pool) if (near(plan.at, e)) tried.set(e.id, gains); hold(rt, {}, 2); counts.open++; continue; }
        // Hold the axis toward the next cell until the player is in it; learn the axis signs from where it went.
        const want = plan.first, input = { axes: { move: toward(here, want) } };
        let moved = null;
        for (let f = 0; f < moveFrames && rt.state.status === 'playing'; f++) {
          hold(rt, input, 1);
          const q = rt.player(); if (!q) break;
          const k = keyAt(api, posOf(rt, q)); if (k !== here) { moved = k; break; }
        }
        counts.walk++;
        if (moved && moved !== want) {
          const a = cellOfKey(here), got = cellOfKey(moved), w = cellOfKey(want);
          for (const i of [0, 1]) if (Math.sign(got[i] - a[i]) === -Math.sign(w[i] - a[i]) && got[i] !== a[i]) axis[i] = -axis[i];
        }
        blockedFor = moved ? 0 : blockedFor + 1;
        if (blockedFor > 20) { hold(rt, {}, 10); blockedFor = 0; }
      }
      const won = rt.state.status === 'won';
      return { seed, won, status: rt.state.status, frames: rt.state.frame, lives: rt.state.vars.lives ?? null, hp: rt.state.vars.hp ?? null, decisions: counts, hash: stateHash(rt.state), budget: !won && rt.state.status === 'playing' && Boolean(b.hit) };
    };
    const r = multiSeed(play, { seeds, passRate });
    const finished = r.runs.filter(x => !x.budget), problems = [];
    if (!finished.length) problems.push(problem('budget_exhausted', where, 'the crawler ran out of budget before the crawl ended', { severity: 'warning' }));
    else if (finished.filter(x => x.won).length / finished.length < passRate) { const last = finished[finished.length - 1]; problems.push(problem('too_hard', where, `a crawler won ${finished.filter(x => x.won).length}/${finished.length} crawls (last: ${last.status} after ${last.frames} frames)`, { hint: 'fewer or weaker guards, a weaker boss, more lives or health' })); }
    return { ok: !problems.some(p => p.severity === 'error'), proven: r.ok ? [`a crawler defeated the boss in ${r.wins}/${r.runs.length} crawls`] : [], problems, metrics: { runs: r.runs, rate: r.rate }, exhaustive: false, budget: sb.report() };
  },
};
