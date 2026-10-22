// Danger-field BFS for any chase game on a navigable space (ported from the
// maze kit's bot). A multi-source BFS from every threat (ai/attacks/hazard
// entities and the cell each is about to enter) gives a danger distance per
// cell; the player BFS only admits cells it reaches with a margin before any
// threat. Priorities: hunt vulnerable threats, grab something when cornered,
// eat the nearest target (collectibles, plot zones), else escape toward the
// cell with the biggest lead, else flee. Moves are executed through the real
// controls: each candidate macro (an option, or a held move axis) is tried on
// a snapshot and the one that lands on the planned cell is played.
import { posOf, threats, collectibles, isVulnerable, vitality, hold, applyOption, optionLabels } from '../drive.js';
import { plotZones } from '../objective.js';
import { multiSeed, problem, yieldToEncounter, seedBudgets } from './common.js';
import { stepsFrom } from '../../kernel/testing.js';

export const DANGER = 3, MARGIN = 2, FIELD_CAP = 24, FAR = 32767, SAFE_LEAD = 8;
const keyOf = c => (Array.isArray(c) ? c.join(',') : String(c));
/** The cell a position is in, as the space defines it (api.cellOf honours its anchor); integer floors only for spaces without one. */
const cellIn = (api, at) => (!Array.isArray(at) ? at : typeof api?.cellOf === 'function' ? api.cellOf({ at }).split(',').map(Number) : at.map(v => Math.floor(v)));
const playerCell = rt => { const p = rt.player(); return p ? cellIn(rt.space(p.space), posOf(rt)) : null; };

/**
 * Danger distance per cell: for each source { at, who } a BFS over the moves that walker can make (stepsFrom: its
 * own passability, so a hunter that may pass a house door does), capped; a cell's distance is the nearest source's.
 */
export function dangerField(api, sources, rt, cap = FIELD_CAP) {
  const d = new Map();
  for (const s of sources) {
    const seen = new Map([[keyOf(s.at), 0]]), q = [s.at];
    for (let h = 0; h < q.length; h++) {
      const c = q[h], n = seen.get(keyOf(c)) + 1;
      if (n > cap) continue;
      for (const m of stepsFrom(api, s.who, c, rt)) { const k = keyOf(m); if (!seen.has(k)) { seen.set(k, n); q.push(m); } }
    }
    for (const [k, n] of seen) if (n < (d.get(k) ?? FAR)) d.set(k, n);
  }
  return k => d.get(k) ?? FAR;
}

/** Safe BFS from `here` over the moves `who` can make: first step toward the first cell satisfying goal, or toward the best-scoring cell. */
export function safeSearch(api, who, rt, here, hd, isGoal, { limit = Infinity, danger = DANGER, margin = MARGIN, score = null } = {}) {
  const start = keyOf(here), dist = new Map([[start, 0]]), first = new Map([[start, null]]), q = [here];
  let best = null, bestScore = -Infinity;
  for (let h = 0; h < q.length; h++) {
    const c = q[h], k = keyOf(c), d = dist.get(k);
    if (k !== start && isGoal(c, k)) return first.get(k);
    if (score && k !== start) { const v = score(k, d); if (v > bestScore) { bestScore = v; best = first.get(k); } }
    if (d >= limit) continue;
    for (const m of stepsFrom(api, who, c, rt)) {
      const mk = keyOf(m);
      if (dist.has(mk)) continue;
      const nd = d + 1, t = hd(mk);
      if (t <= danger || t <= nd + margin) continue;
      dist.set(mk, nd); first.set(mk, k === start ? m : first.get(k)); q.push(m);
    }
  }
  return best;
}

/** Steps from each cell to the nearest goal cell, over the moves `who` can make (a BFS from `here` outward, then from the goals). */
function distanceTo(api, who, rt, here, isGoal) {
  const cells = [here], seen = new Set([keyOf(here)]);
  for (let h = 0; h < cells.length; h++) for (const m of stepsFrom(api, who, cells[h], rt)) { const k = keyOf(m); if (!seen.has(k)) { seen.add(k); cells.push(m); } }
  const d = new Map(), q = cells.filter(c => isGoal(c, keyOf(c)));
  for (const c of q) d.set(keyOf(c), 0);
  for (let h = 0; h < q.length; h++) { const n = d.get(keyOf(q[h])) + 1; for (const m of stepsFrom(api, who, q[h], rt)) { const k = keyOf(m); if (!d.has(k)) { d.set(k, n); q.push(m); } } }
  return k => d.get(k) ?? FAR;
}

/** Candidate move macros: the runtime's options, else held move axes in the 4 grid directions. */
function moveMacros(rt) {
  const options = rt.availableOptions();
  if (options.length) return optionLabels(options).map((label, i) => ({ label, option: i }));
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([x, y]) => ({ label: `move ${x},${y}`, input: { axes: { move: [x, y] } } }));
}
/** Run a macro until the player's cell changes (or maxFrames). */
function runMacro(rt, m, maxFrames) {
  const p0 = keyOf(playerCell(rt));
  if (m.option !== undefined) { const o = rt.availableOptions()[m.option]; if (o) applyOption(rt, o); }
  else for (let f = 0; f < maxFrames && rt.state.status === 'playing'; f++) { hold(rt, m.input, 1); if (keyOf(playerCell(rt)) !== p0) break; }
  return rt.player() ? keyOf(playerCell(rt)) : null;
}
/** Step the player to the adjacent cell `want` through the real controls; returns true if it moved there. */
export function stepTo(rt, want, { maxFrames = 30 } = {}) {
  const snap = rt.snapshot(), macros = moveMacros(rt);
  for (const m of macros) {
    rt.restore(snap);
    if (runMacro(rt, m, maxFrames) === keyOf(want)) return true; // keep this run: it is the real move
  }
  rt.restore(snap);
  hold(rt, {}, 1);
  return false;
}

export default {
  id: 'danger-field',
  intent: 'Chase games on navigable spaces: a danger-field BFS bot collects targets while staying ahead of threats; it must clear most targets.',
  requires: { capabilities: ['navigate'] },
  detect(ctx) { const rt = ctx.make(ctx.seed); return threats(rt).length > 0 && (collectibles(rt).length > 0 || plotZones(ctx.doc).size > 0); },
  run(ctx, { maxFrames = 6000, seeds = [1], bar = 0.6, maxSteps = Infinity, margin = MARGIN } = {}) {
    const sb = seedBudgets(maxSteps);
    /** The budget of the seed being played (seedBudgets: one per seed). @type {any} */
    let b = null;
    const goals = [...plotZones(ctx.doc).keys()];
    const play = seed => {
      // Pickups and threats placed by spawn rules arrive after frame 0: idle until targets exist (up to 1 s).
      const rt = (b = sb.budget()).meter(ctx.make(seed));
      for (let i = 0; i < 60 && rt.state.status === 'playing' && !collectibles(rt).length; i++) rt.step({});
      hold(rt, {}, 2);
      const total = collectibles(rt).length;
      let deaths = 0, hunted = 0, lastHp = vitality(rt).hp, lastLives = vitality(rt).lives, why = '';
      const counts = {};
      while (rt.state.status === 'playing' && rt.state.frame < maxFrames && !b.over()) {
        if (yieldToEncounter(ctx, rt, ['navigate'])) continue; // an encounter holds this loop: play the one the player is in
        const p = rt.player(); if (!p) break;
        const api = rt.space(p.space), here = cellIn(api, posOf(rt));
        // Planning reads the world (rt.read): nothing changes while the bot plans, so the space indexes what it searches once.
        const next = rt.read(() => {
          const hs = threats(rt), sources = [];
          for (const t of hs) { const c = cellIn(api, t.at); sources.push({ at: c, who: t }); const v = t.components.body?.vel; if (Array.isArray(c) && Array.isArray(v)) { const n = c.map((x, i) => x + Math.sign(v[i] || 0)); if (stepsFrom(api, t, c, rt).some(m => keyOf(m) === keyOf(n))) sources.push({ at: n, who: t }); } }
          const hd = dangerField(api, sources, rt);
          const prey = new Set(Object.values(rt.state.entities).filter(e => e.space === p.space && e.components.ai && isVulnerable(rt, e)).map(e => keyOf(cellIn(api, e.at))));
          const food = new Set(collectibles(rt).map(e => keyOf(cellIn(api, e.at))));
          const isFood = (c, k) => food.has(k) || (goals.length > 0 && goals.includes(api.zoneAt?.(c, rt)));
          let next = prey.size ? (why = 'hunt', safeSearch(api, p, rt, here, hd, (c, k) => prey.has(k), { limit: 14, margin })) : null;
          if (!next) { why = 'eat'; next = safeSearch(api, p, rt, here, hd, isFood, { margin }); }
          if (!next) { why = 'eat!'; next = safeSearch(api, p, rt, here, hd, isFood, { limit: 20, danger: 0, margin: 0 }); }
          // Escape to the cell with the biggest lead, closer to the targets among equally safe ones (a lead beyond
          // SAFE_LEAD is safe enough), so a hunter circling the last targets is waited out at their edge, not far away.
          if (!next) { why = 'escape'; const fd = distanceTo(api, p, rt, here, isFood); next = safeSearch(api, p, rt, here, hd, () => false, { limit: 30, danger: 0, margin: 0, score: (k, d) => Math.min(hd(k), SAFE_LEAD) - d * 0.5 - fd(k) * 0.25 }); }
          if (!next) { why = 'flee'; next = stepsFrom(api, p, here, rt).sort((x, y) => hd(keyOf(y)) - hd(keyOf(x)))[0] || null; }
          return next;
        });
        counts[why] = (counts[why] || 0) + 1;
        if (next) stepTo(rt, next); else hold(rt, {}, 1);
        for (const e of rt.state.events) if (e.name.startsWith('defeated') && e.subject !== 'player' && e.who !== 'player') hunted++;
        const v = vitality(rt);
        if ((v.hp !== null && lastHp !== null && v.hp < lastHp) || (v.lives !== null && lastLives !== null && v.lives < lastLives)) deaths++;
        lastHp = v.hp; lastLives = v.lives;
      }
      const left = collectibles(rt).length, collected = total - left;
      const pct = total ? collected / total : rt.state.status === 'won' ? 1 : 0;
      return { seed, won: rt.state.status === 'won' || pct >= bar, status: rt.state.status, collected, total, clearedPct: Math.round(pct * 1000) / 10, deaths, hunted, frames: rt.state.frame, decisions: counts, budget: rt.state.status === 'playing' && Boolean(b.hit) };
    };
    const r = multiSeed(play, { seeds, passRate: 1 / seeds.length });
    const best = r.runs.reduce((m, x) => (x.clearedPct > (m?.clearedPct ?? -1) ? x : m), null);
    const problems = [];
    if (best && !best.won && !best.budget) problems.push(problem('too_hard', 'systems', `a danger-field bot cleared only ${best.clearedPct}% of the targets (${best.status}, ${best.deaths} hits)`, { hint: 'add escape routes, lower threat speed or count, or add power-ups' }));
    if (best?.budget && !best.won) problems.push(problem('budget_exhausted', 'systems', `danger-field play stopped by its budget at ${best.clearedPct}%`, { severity: 'warning' }));
    return { ok: !problems.some(p => p.severity === 'error'), proven: r.ok ? [`a danger-field bot cleared ${best.clearedPct}% of the targets`] : [], problems, metrics: { runs: r.runs }, exhaustive: false, budget: sb.report() };
  },
};
