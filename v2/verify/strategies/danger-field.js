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
import { budget as makeBudget } from '../util.js';
import { multiSeed, problem } from './common.js';

export const DANGER = 3, MARGIN = 2, FIELD_CAP = 24, FAR = 32767;
const keyOf = c => (Array.isArray(c) ? c.map(v => Math.floor(v)).join(',') : String(c));
const cellOf = at => (Array.isArray(at) ? at.map(v => Math.floor(v)) : at);

/** Multi-source BFS distance from sources over api.neighbors, capped. */
export function dangerField(api, sources, cap = FIELD_CAP) {
  const d = new Map(), q = [];
  for (const s of sources) { const k = keyOf(s); if (!d.has(k)) { d.set(k, 0); q.push(s); } }
  for (let h = 0; h < q.length; h++) {
    const c = q[h], n = d.get(keyOf(c)) + 1;
    if (n > cap) continue;
    for (const m of api.neighbors(c) || []) { const k = keyOf(m); if (!d.has(k)) { d.set(k, n); q.push(m); } }
  }
  return k => d.get(k) ?? FAR;
}

/** Safe BFS from `here`: first step toward the first cell satisfying goal, or toward the best-scoring cell. */
export function safeSearch(api, here, hd, isGoal, { limit = Infinity, danger = DANGER, margin = MARGIN, score = null } = {}) {
  const start = keyOf(here), dist = new Map([[start, 0]]), first = new Map([[start, null]]), q = [here];
  let best = null, bestScore = -Infinity;
  for (let h = 0; h < q.length; h++) {
    const c = q[h], k = keyOf(c), d = dist.get(k);
    if (k !== start && isGoal(c, k)) return first.get(k);
    if (score && k !== start) { const v = score(k, d); if (v > bestScore) { bestScore = v; best = first.get(k); } }
    if (d >= limit) continue;
    for (const m of api.neighbors(c) || []) {
      const mk = keyOf(m);
      if (dist.has(mk)) continue;
      const nd = d + 1, t = hd(mk);
      if (t <= danger || t <= nd + margin) continue;
      dist.set(mk, nd); first.set(mk, k === start ? m : first.get(k)); q.push(m);
    }
  }
  return best;
}

/** Candidate move macros: the runtime's options, else held move axes in the 4 grid directions. */
function moveMacros(rt) {
  const options = rt.availableOptions();
  if (options.length) return optionLabels(options).map((label, i) => ({ label, option: i }));
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([x, y]) => ({ label: `move ${x},${y}`, input: { axes: { move: [x, y] } } }));
}
/** Run a macro until the player's cell changes (or maxFrames). */
function runMacro(rt, m, maxFrames, b) {
  const p0 = keyOf(cellOf(posOf(rt))), f0 = rt.state.frame;
  if (m.option !== undefined) { const o = rt.availableOptions()[m.option]; if (o) applyOption(rt, o); }
  else for (let f = 0; f < maxFrames && rt.state.status === 'playing'; f++) { hold(rt, m.input, 1); if (keyOf(cellOf(posOf(rt))) !== p0) break; }
  b?.step(rt.state.frame - f0);
  return rt.player() ? keyOf(cellOf(posOf(rt))) : null;
}
/** Step the player to the adjacent cell `want` through the real controls; returns true if it moved there. */
export function stepTo(rt, want, { maxFrames = 30, b = null } = {}) {
  const snap = rt.snapshot(), macros = moveMacros(rt);
  for (const m of macros) {
    rt.restore(snap);
    if (runMacro(rt, m, maxFrames, b) === keyOf(want)) return true; // keep this run: it is the real move
  }
  rt.restore(snap);
  hold(rt, {}, 1, b);
  return false;
}

export default {
  id: 'danger-field',
  intent: 'Chase games on navigable spaces: a danger-field BFS bot collects targets while staying ahead of threats; it must clear most targets.',
  requires: { capabilities: ['navigate'] },
  detect(ctx) { const rt = ctx.make(ctx.seed); return threats(rt).length > 0 && (collectibles(rt).length > 0 || plotZones(ctx.doc).size > 0); },
  run(ctx, { maxFrames = 6000, seeds = [1], bar = 0.6, budgetMs = 2000, maxSteps = Infinity, margin = MARGIN } = {}) {
    const b = makeBudget({ ms: budgetMs, steps: maxSteps });
    const goals = [...plotZones(ctx.doc).keys()];
    const play = seed => {
      // Pickups and threats placed by spawn rules arrive after frame 0: idle until targets exist (up to 1 s).
      const rt = ctx.make(seed);
      for (let i = 0; i < 60 && rt.state.status === 'playing' && !collectibles(rt).length; i++) rt.step({});
      hold(rt, {}, 2);
      const total = collectibles(rt).length;
      let deaths = 0, hunted = 0, lastHp = vitality(rt).hp, lastLives = vitality(rt).lives, why = '';
      const counts = {};
      while (rt.state.status === 'playing' && rt.state.frame < maxFrames && !b.over()) {
        const p = rt.player(); if (!p) break;
        const api = rt.space(p.space), here = cellOf(posOf(rt));
        const hs = threats(rt), sources = [];
        for (const t of hs) { const c = cellOf(t.at); sources.push(c); const v = t.components.body?.vel; if (Array.isArray(c) && Array.isArray(v)) { const n = c.map((x, i) => x + Math.sign(v[i] || 0)); if ((api.neighbors(c) || []).some(m => keyOf(m) === keyOf(n))) sources.push(n); } }
        const hd = dangerField(api, sources);
        const prey = new Set(Object.values(rt.state.entities).filter(e => e.space === p.space && e.components.ai && isVulnerable(e)).map(e => keyOf(cellOf(e.at))));
        const food = new Set(collectibles(rt).map(e => keyOf(cellOf(e.at))));
        const isFood = (c, k) => food.has(k) || (goals.length > 0 && goals.includes(api.zoneAt?.(c, rt)));
        let next = prey.size ? (why = 'hunt', safeSearch(api, here, hd, (c, k) => prey.has(k), { limit: 14, margin })) : null;
        if (!next) { why = 'eat'; next = safeSearch(api, here, hd, isFood, { margin }); }
        if (!next) { why = 'eat!'; next = safeSearch(api, here, hd, isFood, { limit: 20, danger: 0, margin: 0 }); }
        if (!next) { why = 'escape'; next = safeSearch(api, here, hd, () => false, { limit: 30, danger: 0, margin: 0, score: (k, d) => Math.min(hd(k), 40) - d * 0.5 }); }
        if (!next) { why = 'flee'; next = (api.neighbors(here) || []).sort((x, y) => hd(keyOf(y)) - hd(keyOf(x)))[0] || null; }
        counts[why] = (counts[why] || 0) + 1;
        if (next) stepTo(rt, next, { b }); else hold(rt, {}, 1, b);
        for (const e of rt.state.events) if (e.name.startsWith('defeated') && e.subject !== 'player' && e.who !== 'player') hunted++;
        const v = vitality(rt);
        if ((v.hp !== null && lastHp !== null && v.hp < lastHp) || (v.lives !== null && lastLives !== null && v.lives < lastLives)) deaths++;
        lastHp = v.hp; lastLives = v.lives;
      }
      const left = collectibles(rt).length, collected = total - left;
      const pct = total ? collected / total : rt.state.status === 'won' ? 1 : 0;
      return { seed, won: rt.state.status === 'won' || pct >= bar, status: rt.state.status, collected, total, clearedPct: Math.round(pct * 1000) / 10, deaths, hunted, frames: rt.state.frame, decisions: counts, budget: rt.state.status === 'playing' && Boolean(b.hit) };
    };
    const r = multiSeed(play, { seeds, passRate: 1 / seeds.length, b });
    const best = r.runs.reduce((m, x) => (x.clearedPct > (m?.clearedPct ?? -1) ? x : m), null);
    const problems = [];
    if (best && !best.won && !best.budget) problems.push(problem('too_hard', 'systems', `a danger-field bot cleared only ${best.clearedPct}% of the targets (${best.status}, ${best.deaths} hits)`, { hint: 'add escape routes, lower threat speed or count, or add power-ups' }));
    if (best?.budget && !best.won) problems.push(problem('budget_exhausted', 'systems', `danger-field play stopped by its budget at ${best.clearedPct}%`, { severity: 'warning' }));
    return { ok: !problems.some(p => p.severity === 'error'), proven: r.ok ? [`a danger-field bot cleared ${best.clearedPct}% of the targets`] : [], problems, metrics: { runs: r.runs }, exhaustive: false, budget: b.report() };
  },
};
