// Farm bot for the farming loop (gameplay.farming's card.mode, bot 'farm'). It plays only through the controls a
// person uses: held move axes walk the farmer, and the loop's verbs (till, plant, water, harvest) are pressed as plain
// buttons. It reads the field through the space API (cells, the walker's moves), the plots through the farming
// service and the bag through the inventory service, and plans each decision: water a growing plot that is still dry
// today, harvest a ripe one, plant free farmland while it holds seeds, till more soil while it holds more seeds than
// there is free farmland, else wait for the next day. A press acts on the cell the farming primitive targets from where
// the farmer stands: the bot learns that cell by pressing on a snapshot (the event names it), walks to a cell from which
// the press lands on the planned plot, and keeps a press only when it acted there.
import { hold, posOf, velOf } from '../drive.js';
import { budget as makeBudget } from '../util.js';
import { modesIn } from '../../primitives/gameplay/modes-lib-mode.js';
import { stepsFrom } from '../../kernel/testing.js';
import { multiSeed, problem, pathOf } from './common.js';

const FARMING = 'gameplay.farming';
/** Each verb of the farming loop and the event its press emits when it acts. */
const DONE = { till: 'tilled', plant: 'planted', water: 'watered', harvest: 'harvested' };
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const v3 = a => [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0];
const keyOf = c => c.join(',');
/** The cell a position is in, as the space defines it (api.cellOf honours its anchor). */
const cellIn = (api, at) => (typeof api.cellOf === 'function' ? api.cellOf({ at }).split(',').map(Number) : at.map(v => Math.floor(v)));
const playerCell = rt => { const p = rt.player(); return p ? cellIn(rt.space(p.space), posOf(rt)) : null; };

/** Press `verb` on a snapshot: the cell the press targets from here (the farming event's `at`), or null. */
function aimOf(rt, verb) {
  const snap = rt.snapshot();
  rt.step({ actions: { [verb]: true } });
  const ev = rt.state.events.find(e => (e.name === DONE[verb] || (e.name === 'farm_denied' && e.action === verb)) && Array.isArray(e.at));
  rt.restore(snap);
  return ev ? v3(ev.at) : null;
}
/** Press `verb` for real; kept only when it acted on cell `want` (else the state is restored). */
function press(rt, verb, want, b) {
  const snap = rt.snapshot();
  hold(rt, { actions: { [verb]: true } }, 1, b);
  if (rt.state.events.some(e => e.name === DONE[verb] && Array.isArray(e.at) && keyOf(v3(e.at)) === keyOf(want))) return true;
  rt.restore(snap);
  return false;
}
/** Walk to the adjacent cell `want` with a held move axis (each tried on a snapshot); true when the farmer got there. */
function stepTo(rt, want, b, maxFrames = 40) {
  const snap = rt.snapshot(), from = keyOf(playerCell(rt));
  for (const [x, y] of DIRS) {
    rt.restore(snap);
    const f0 = rt.state.frame;
    for (let f = 0; f < maxFrames && rt.state.status === 'playing'; f++) { rt.step({ axes: { move: [x, y] } }); if (keyOf(playerCell(rt)) !== from) break; }
    if (keyOf(playerCell(rt)) === keyOf(want)) { b?.step(rt.state.frame - f0); return true; }
  }
  rt.restore(snap);
  hold(rt, {}, 1, b);
  return false;
}

/**
 * The plan from here: a BFS over the cells the farmer can walk to (its own moves, stepsFrom), each judged by the cell
 * a press made there would target (aim offset). -> the nearest standing cell per job, and the free farmland in reach.
 */
function survey(rt, config, aim, skip) {
  const p = rt.player(), api = rt.space(p.space), here = playerCell(rt);
  const plots = new Map(rt.service('farming').plots().filter(x => x.space === p.space).map(x => [keyOf(v3(x.at)), x]));
  const crops = new Map(config.crops.map(c => [c.item, c]));
  const bag = rt.service('inventory').bag('player');
  const seeds = config.crops.reduce((n, c) => n + (bag[c.seed ?? c.item] || 0), 0);
  const jobs = {}, seen = new Map([[keyOf(here), here]]), q = [here];
  let freeLand = 0, soil = 0;
  for (let h = 0; h < q.length; h++) {
    const s = q[h];
    for (const verb of Object.keys(DONE)) {
      if (jobs[verb] || !aim[verb]) continue;
      const t = v3(s).map((v, i) => v + aim[verb][i]), k = keyOf(t);
      if (skip.has(`${verb}@${k}`)) continue;
      const plot = plots.get(k), block = api.getCell(t);
      const ok = verb === 'harvest' ? plot?.ripe
        : verb === 'water' ? plot && !plot.ripe && !plot.watered && crops.get(plot.crop)?.water !== false
          : verb === 'plant' ? !plot && block === config.farmland && seeds > 0
            : !plot && config.tillable.includes(block);
      if (ok) jobs[verb] = { stand: s, target: t };
    }
    const t = aim.plant && v3(s).map((v, i) => v + aim.plant[i]);
    if (t && api.getCell(t) === config.farmland && !plots.has(keyOf(t))) freeLand++;
    const u = aim.till && v3(s).map((v, i) => v + aim.till[i]);
    if (u && config.tillable.includes(api.getCell(u)) && !plots.has(keyOf(u))) soil++;
    for (const n of stepsFrom(api, p, s, rt)) { const nk = keyOf(n); if (!seen.has(nk)) { seen.set(nk, s); q.push(n); } }
  }
  // Tilling is worth it only while the bag holds more seeds than there is free farmland to plant them in.
  if (jobs.till && seeds <= freeLand) delete jobs.till;
  return { jobs, seen, seeds, plots, freeLand, soil };
}
/** First step on the BFS tree from here toward `goal` (the parent map the survey built). */
function firstStep(seen, here, goal) {
  let c = goal;
  while (seen.get(keyOf(c)) && keyOf(seen.get(keyOf(c))) !== keyOf(here)) c = seen.get(keyOf(c));
  return c;
}

export default {
  id: 'farm',
  intent: 'Farming loops: walks the farmer with held move axes and presses till, plant, water and harvest like a person, keeping every plot watered each day, until the harvest wins.',
  requires: { capabilities: ['editCells', 'navigate'] },
  run(ctx, { maxFrames = 36000, seeds = [1], passRate = 1, budgetMs = 2000, maxSteps = Infinity, settleFrames = 20, waitFrames = 15 } = {}) {
    const b = makeBudget({ ms: budgetMs, steps: maxSteps });
    const inst = modesIn(ctx.doc, ctx.registry).find(m => m.use === FARMING), where = pathOf(ctx.doc, [FARMING]);
    if (!inst) return { ok: true, proven: [], problems: [], metrics: { skipped: 'no farming loop' }, exhaustive: false, budget: b.report() };
    const config = inst.config;
    const play = seed => {
      const rt = ctx.make(seed), presses = { till: 0, plant: 0, water: 0, harvest: 0 };
      let stuck = '', stalls = 0, skip = new Set(), day = null;
      hold(rt, {}, 1, b);
      if (!rt.hasService('farming') || !rt.hasService('inventory')) stuck = 'the farming and inventory services are missing';
      while (!stuck && rt.state.status === 'playing' && rt.state.frame < maxFrames && !b.over()) {
        const p = rt.player(); if (!p) { stuck = 'no player'; break; }
        const today = rt.service('farming').day();
        if (today !== day) { day = today; skip = new Set(); }
        // Stand still before aiming: a press acts where the farmer is.
        for (let f = 0; f < settleFrames && velOf(p).some(v => Math.abs(v) > 1e-6); f++) hold(rt, {}, 1, b);
        const aim = Object.fromEntries(Object.keys(DONE).map(v => [v, aimOf(rt, v)]).filter(([, t]) => t).map(([v, t]) => [v, t.map((x, i) => x - (v3(playerCell(rt))[i]))]));
        if (!Object.keys(aim).length) { stuck = 'no farming verb targets a cell from where the farmer stands'; break; }
        const { jobs, seen, seeds: held, plots, freeLand, soil } = survey(rt, config, aim, skip);
        const verb = ['water', 'harvest', 'plant', 'till'].find(v => jobs[v]);
        if (!verb) {
          if (!plots.size && !held) { stuck = 'no seeds left and nothing growing'; break; }
          if (!plots.size && !freeLand && !soil) { stuck = 'no tillable soil or free farmland within the farmer\'s reach'; break; }
          hold(rt, {}, waitFrames, b); continue; // everything tended: wait for the day to turn
        }
        const { stand, target } = jobs[verb], here = playerCell(rt);
        if (keyOf(stand) === keyOf(here)) {
          if (press(rt, verb, target, b)) { presses[verb]++; stalls = 0; } else { skip.add(`${verb}@${keyOf(target)}`); hold(rt, {}, 1, b); }
          continue;
        }
        if (stepTo(rt, firstStep(seen, here, stand), b)) stalls = 0;
        else if (++stalls > 60) { stuck = `cannot walk toward ${keyOf(stand)}`; break; }
      }
      const harvested = rt.state.counts.harvested || 0;
      return { seed, won: rt.state.status === 'won', status: rt.state.status, harvested, presses, days: rt.hasService('farming') ? rt.service('farming').day() : null, frames: rt.state.frame, stuck: stuck || null, budget: rt.state.status === 'playing' && Boolean(b.hit) };
    };
    const r = multiSeed(play, { seeds, passRate, b });
    const best = r.runs.reduce((m, x) => (x.harvested > (m?.harvested ?? -1) ? x : m), null), problems = [];
    if (best && !best.won && !best.budget) problems.push(problem('too_hard', where, `a farming bot harvested ${best.harvested} crop(s) and the game did not end won (${best.status}${best.stuck ? `: ${best.stuck}` : ''}, ${best.frames} frames)`, { hint: 'more seeds or tillable soil within reach, fewer growing days, or a lower harvest target' }));
    if (best?.budget && !best.won) problems.push(problem('budget_exhausted', where, `farming play stopped by its budget after ${best.harvested} harvest(s)`, { severity: 'warning' }));
    return { ok: !problems.some(p => p.severity === 'error'), proven: r.ok ? [`a farming bot won ${r.wins}/${r.runs.length} by harvesting through the controls`] : [], problems, metrics: { runs: r.runs, rate: r.rate }, exhaustive: false, budget: b.report() };
  },
};
