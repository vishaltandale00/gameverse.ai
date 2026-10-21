// Farm bot for the farming loop (gameplay.farming's card.mode, bot 'farm'). It plays only through the controls a
// person uses: held move axes walk the farmer, and the loop's verbs (till, plant, water, harvest) are pressed as plain
// buttons. It reads the field through the space API (cells, the walker's moves), the plots through the farming
// service and the bag through the inventory service, and plans each decision: water a growing plot that is still dry
// today, harvest a ripe one, plant free farmland while it holds seeds, till more soil while it holds more seeds than
// there is free farmland, else wait for the next day. A press acts on the cell the farming primitive targets from where
// the farmer stands and the way it faces (items-lib.js actionCellAt, the same function the primitive uses): the bot
// searches the farmer's (cell, facing) states (a held direction steps into a free cell, or turns toward a blocked one)
// for the nearest one whose target is the planned plot, walks there and presses; a press is kept only when it acted.
import { hold, posOf, velOf } from '../drive.js';
import { modesIn } from '../../primitives/gameplay/modes-lib-mode.js';
import { actionCellAt, faceDir } from '../../primitives/gameplay/items-lib.js';
import { spaceFrame } from '../../primitives/engine/runtime-lib-frame.js';
import { stepsFrom } from '../../kernel/testing.js';
import { multiSeed, problem, pathOf, yieldToEncounter, seedBudgets } from './common.js';

const FARMING = 'gameplay.farming';
/** Each verb of the farming loop and the event its press emits when it acts. */
const DONE = { till: 'tilled', plant: 'planted', water: 'watered', harvest: 'harvested' };
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const v3 = a => [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0];
const keyOf = c => v3(c).join(',');
/** The cell a position is in, as the space defines it (api.cellOf honours its anchor). */
const cellIn = (api, at) => (typeof api.cellOf === 'function' ? api.cellOf({ at }).split(',').map(Number) : at.map(v => Math.floor(v)));
const playerCell = rt => { const p = rt.player(); return p ? v3(cellIn(rt.space(p.space), posOf(rt))) : null; };

/** Frames a press is watched for its effect: a person's press is down a few frames and the game may act on any of them. */
const PRESS_FRAMES = 8;
/** Press `verb` for real (down, then held while it is watched); kept only when it acted on cell `want` (else the state is restored). */
function press(rt, verb, want) {
  const snap = rt.snapshot();
  for (let f = 0; f < PRESS_FRAMES && rt.state.status === 'playing'; f++) {
    hold(rt, f === 0 ? { actions: { [verb]: true } } : { held: { [verb]: true } }, 1);
    if (rt.state.events.some(e => e.name === DONE[verb] && Array.isArray(e.at) && keyOf(e.at) === keyOf(want))) return true;
  }
  rt.restore(snap);
  return false;
}
/** Hold the move axis `d` until the farmer's cell or facing changes (or maxFrames); true when something changed. */
function pressDir(rt, d, maxFrames = 40) {
  const p0 = rt.player(), from = keyOf(playerCell(rt)), face = JSON.stringify(faceDir(p0));
  for (let f = 0; f < maxFrames && rt.state.status === 'playing'; f++) {
    rt.step({ axes: { move: d } });
    if (keyOf(playerCell(rt)) !== from) break;
    if (JSON.stringify(faceDir(rt.player())) !== face && f > 0) break;
  }
  return keyOf(playerCell(rt)) !== from || JSON.stringify(faceDir(rt.player())) !== face;
}

/**
 * The plan from here: a BFS over the farmer's (cell, facing) states, the moves a held direction makes (its own steps,
 * stepsFrom, else a turn toward the blocked cell); each state is judged by the cell a press there targets
 * (actionCellAt). -> the first direction toward the nearest state per job, the free farmland and soil in reach.
 */
function survey(rt, config, frame, view, skip) {
  const p = rt.player(), api = rt.space(p.space), here = playerCell(rt), dir0 = faceDir(p);
  const plots = new Map(rt.service('farming').plots().filter(x => x.space === p.space).map(x => [keyOf(x.at), x]));
  const crops = new Map(config.crops.map(c => [c.item, c]));
  const bag = rt.service('inventory').bag('player');
  const seeds = config.crops.reduce((n, c) => n + (bag[c.seed ?? c.item] || 0), 0);
  const job = (verb, t) => {
    const k = keyOf(t), plot = plots.get(k), block = api.getCell(t);
    if (skip.has(`${verb}@${k}`)) return false;
    return verb === 'harvest' ? Boolean(plot?.ripe)
      : verb === 'water' ? Boolean(plot && !plot.ripe && !plot.watered && crops.get(plot.crop)?.water !== false)
        : verb === 'plant' ? !plot && block === config.farmland && seeds > 0
          : !plot && config.tillable.includes(block);
  };
  const jobs = {}, start = { cell: here, dir: dir0 ? v3(dir0) : null, first: null }, seen = new Set([`${keyOf(here)}|${JSON.stringify(start.dir)}`]), q = [start];
  const free = new Set(), soil = new Set();
  for (let h = 0; h < q.length && h < 4000; h++) {
    const s = q[h], t = actionCellAt(frame, view, s.cell, s.dir);
    if (t) {
      for (const verb of Object.keys(DONE)) if (!jobs[verb] && job(verb, t)) jobs[verb] = { first: s.first, target: v3(t) };
      if (api.getCell(t) === config.farmland && !plots.has(keyOf(t))) free.add(keyOf(t));
      if (config.tillable.includes(api.getCell(t)) && !plots.has(keyOf(t))) soil.add(keyOf(t));
    }
    const moves = stepsFrom(api, p, s.cell, rt).map(v3);
    for (const d of DIRS) {
      const n = v3([s.cell[0] + d[0], s.cell[1] + d[1], s.cell[2]]), into = moves.some(m => keyOf(m) === keyOf(n));
      const next = { cell: into ? n : s.cell, dir: [d[0], d[1], 0], first: s.first ?? d };
      const k = `${keyOf(next.cell)}|${JSON.stringify(next.dir)}`;
      if (!seen.has(k)) { seen.add(k); q.push(next); }
    }
  }
  // Tilling is worth it only while the bag holds more seeds than there is free farmland to plant them in.
  if (jobs.till && seeds <= free.size) delete jobs.till;
  return { jobs, seeds, plots, freeLand: free.size, soil: soil.size };
}

export default {
  id: 'farm',
  intent: 'Farming loops: walks the farmer with held move axes and presses till, plant, water and harvest like a person, keeping every plot watered each day, until the harvest wins.',
  requires: { capabilities: ['editCells', 'navigate'] },
  run(ctx, { maxFrames = 36000, seeds = [1], passRate = 1, maxSteps = Infinity, settleFrames = 20, waitFrames = 15 } = {}) {
    const sb = seedBudgets(maxSteps);
    /** The budget of the seed being played (seedBudgets: one per seed). @type {any} */
    let b = null;
    const inst = modesIn(ctx.doc, ctx.registry).find(m => m.use === FARMING), where = pathOf(ctx.doc, [FARMING]);
    if (!inst) return { ok: true, proven: [], problems: [], metrics: { skipped: 'no farming loop' }, exhaustive: false, budget: sb.report() };
    const config = inst.config;
    const play = seed => {
      const rt = (b = sb.budget()).meter(ctx.make(seed)), presses = { till: 0, plant: 0, water: 0, harvest: 0 };
      let stuck = '', stalls = 0, skip = new Set(), day = null;
      const axis = [1, 1];
      const frame = spaceFrame(rt, rt.player()?.space ?? ctx.doc.spaces[0].id), view = ctx.doc.views?.primary;
      hold(rt, {}, 1);
      if (!rt.hasService('farming') || !rt.hasService('inventory')) stuck = 'the farming and inventory services are missing';
      while (!stuck && rt.state.status === 'playing' && rt.state.frame < maxFrames && !b.over()) {
        if (yieldToEncounter(ctx, rt, ['editCells', 'navigate'])) continue; // an encounter holds this loop: play the one the player is in
        const p = rt.player(); if (!p) { stuck = 'no player'; break; }
        const today = rt.service('farming').day();
        if (today !== day) { day = today; skip = new Set(); }
        // Stand still before planning: a press acts where the farmer is.
        for (let f = 0; f < settleFrames && velOf(p).some(v => Math.abs(v) > 1e-6); f++) hold(rt, {}, 1);
        const { jobs, seeds: held, plots, freeLand, soil } = survey(rt, config, frame, view, skip);
        const verb = ['water', 'harvest', 'plant', 'till'].find(v => jobs[v]);
        if (!verb) {
          if (!plots.size && !held) { stuck = 'no seeds left and nothing growing'; break; }
          if (!plots.size && !freeLand && !soil) { stuck = 'no tillable soil or free farmland within the farmer\'s reach'; break; }
          hold(rt, {}, waitFrames); continue; // everything tended: wait for the day to turn
        }
        const { first, target } = jobs[verb];
        if (!first) {
          if (press(rt, verb, target)) { presses[verb]++; stalls = 0; } else { skip.add(`${verb}@${keyOf(target)}`); hold(rt, {}, 1); }
          continue;
        }
        // Which way a held axis moves on the board is learned from what it did, never assumed (a grid's rows may grow down).
        const from = playerCell(rt);
        if (pressDir(rt, [first[0] * axis[0], first[1] * axis[1]])) {
          stalls = 0;
          const to = playerCell(rt);
          for (const i of [0, 1]) if (to[i] !== from[i] && Math.sign(to[i] - from[i]) !== Math.sign(first[i])) axis[i] = -axis[i];
        }
        else if (++stalls > 60) { stuck = `cannot walk toward ${keyOf(target)}`; break; }
      }
      const harvested = rt.state.counts.harvested || 0;
      return { seed, won: rt.state.status === 'won', status: rt.state.status, harvested, presses, days: rt.hasService('farming') ? rt.service('farming').day() : null, frames: rt.state.frame, stuck: stuck || null, budget: rt.state.status === 'playing' && Boolean(b.hit) };
    };
    const r = multiSeed(play, { seeds, passRate });
    const best = r.runs.reduce((m, x) => (x.harvested > (m?.harvested ?? -1) ? x : m), null), problems = [];
    if (best && !best.won && !best.budget) problems.push(problem('too_hard', where, `a farming bot harvested ${best.harvested} crop(s) and the game did not end won (${best.status}${best.stuck ? `: ${best.stuck}` : ''}, ${best.frames} frames)`, { hint: 'more seeds or tillable soil within reach, fewer growing days, or a lower harvest target' }));
    if (best?.budget && !best.won) problems.push(problem('budget_exhausted', where, `farming play stopped by its budget after ${best.harvested} harvest(s)`, { severity: 'warning' }));
    return { ok: !problems.some(p => p.severity === 'error'), proven: r.ok ? [`a farming bot won ${r.wins}/${r.runs.length} by harvesting through the controls`] : [], problems, metrics: { runs: r.runs, rate: r.rate }, exhaustive: false, budget: sb.report() };
  },
};
