// Race driver for checkpoint races (gameplay.race) on foot, mounted or in a
// vehicle. Every `every` frames it looks ahead on snapshots over the player's
// real controls (the held move axis a seated driver steers with, else held move
// directions), and picks the line that makes the most race progress
// (checkpoints passed) and ends nearest the next checkpoint, searching two
// choices deep. It presses the enter key when a vehicle is in reach (vehicle-only
// races need it). On foot in a space with gravity and paths (a side-view level: the
// race united onto a platformer's world), the course is pits, ledges and hazards a
// held direction cannot cross: it runs to the next checkpoint zone the way the
// platformer bot runs to its goal (platformer.js platformRunner: a route of walks,
// falls and jumps through the move axis and the jump key). It must finish first.
import { hold, DIRS8, posOf } from '../drive.js';
import { platformRunner } from './platformer.js';
import { stateHash } from '../util.js';
import { modesIn } from '../../primitives/gameplay/modes-lib-mode.js';
import { multiSeed, problem, pathOf, yieldToEncounter, seedBudgets } from './common.js';

const RACE = 'gameplay.race';

/** The player's race state and its next checkpoint zone ({ s, r, cp, done }). */
export function raceView(rt, doc, config) {
  const s = rt.state.prim[`${RACE}:${config.id ?? 'race'}`], r = s?.racers?.player;
  const cp = config.checkpoints[r ? r.next : 1 % config.checkpoints.length];
  return { s, r, cp, done: Boolean(r?.finished) };
}

/** Race score: checkpoints passed (laps included) dominate; then closeness to the next checkpoint, measured by the space. */
export function raceScore(rt, doc, config) {
  if (rt.state.status === 'won') return 1e9 - rt.state.frame;
  if (rt.state.status === 'lost') return -1e9;
  const v = raceView(rt, doc, config), N = config.checkpoints.length;
  if (!v.r) return -1e6;
  if (v.r.finished) return (v.r.place === 1 ? 1e8 : 1e7) - rt.state.frame;
  const passed = v.r.lap * N + ((v.r.next - 1 + N) % N);
  // Closeness as the space measures it (the position capability's nearest: the race's own wrong-way measure), so a
  // looped track is measured the short way round, never across the lap's raw coordinates.
  const p = rt.player(), d = rt.space(p.space).nearest(p, v.cp, rt);
  return passed * 1e4 - d;
}

/**
 * The player's controls now, as a person holds them: press the enter key when a vehicle is in reach and the player is
 * on foot (the options hint that one is: vehicle-only races need it), then the held move axis the seated driver steers
 * with (forward, forward and left, forward and right, back to brake), else held move directions on foot. Never exit.
 */
export function raceMacros(rt, every) {
  const seated = Boolean(rt.player()?.components.seat);
  if (!seated && rt.availableOptions().some(o => o.actions?.enter_vehicle !== undefined)) return [{ label: 'enter vehicle', input: { actions: { enter_vehicle: true } }, frames: 1 }];
  if (seated) return [['drive', [0, 1], 45], ['drive left', [-1, 1], 20], ['drive right', [1, 1], 20], ['brake', [0, -1], 15]].map(([label, move, frames]) => ({ label, input: { axes: { move } }, frames }));
  const walk = DIRS8.slice(1).map(([x, y]) => ({ label: `move ${x},${y}`, input: { axes: { move: [x, y] } }, frames: every }));
  // On foot where a key presses jump (a side-view level's pits and ledges): a jump that goes down on the first frame and
  // stays held, with each horizontal direction or none.
  const jump = rt.controls ? rt.controls.presses('jump').includes(true) : rt.actions().includes('jump');
  const hops = jump ? [[1, 0], [-1, 0], [0, 0]].map(([x, y]) => ({ label: `jump ${x},${y}`, first: { actions: { jump: true }, axes: { move: [x, y] } }, input: { held: { jump: true }, axes: { move: [x, y] } }, frames: every * 2 })) : [];
  return [...walk, ...hops];
}

/** A macro: its first frame's input (a press going down), then its held input for the rest of its frames. */
const playMacro = (rt, m) => { if (m.first) { hold(rt, m.first, 1); hold(rt, m.input, m.frames - 1); } else hold(rt, m.input, m.frames); };

/** Replay a recorded path of macro labels from a fresh world. */
export function replayRace(make, seed, path, { every = 12 } = {}) {
  const rt = make(seed);
  for (const label of path) {
    if (rt.state.status !== 'playing') break;
    if (label === 'wait') { hold(rt, {}, every); continue; }
    const m = raceMacros(rt, every).find(x => x.label === label); if (!m) break;
    playMacro(rt, m);
  }
  return rt;
}

export default {
  id: 'race',
  intent: 'Checkpoint races: a lookahead driver over the player\'s real controls (vehicle driver options or held directions) must finish the race first.',
  requires: { capabilities: ['position'] },
  hints: [RACE],
  detect(ctx) { return modesIn(ctx.doc, ctx.registry).some(m => m.use === RACE); },
  run(ctx, { seeds = [1], passRate = 1, every = 12, depth = 2, maxFrames = 7200, maxSteps = Infinity } = {}) {
    const sb = seedBudgets(maxSteps);
    /** The budget of the seed being played (seedBudgets: one per seed). @type {any} */
    let b = null;
    const inst = modesIn(ctx.doc, ctx.registry).find(m => m.use === RACE), where = pathOf(ctx.doc, [RACE]);
    if (!inst) return { ok: true, proven: [], problems: [], metrics: { skipped: 'no race' }, exhaustive: false, budget: sb.report() };
    const config = inst.config, score = rt => raceScore(rt, ctx.doc, config);
    const best = (rt, d) => {
      const snap = rt.snapshot(), ms = raceMacros(rt, every);
      let top = { v: -Infinity, m: null };
      for (const m of ms) {
        rt.restore(snap); playMacro(rt, m); b.state();
        const v = d > 1 && rt.state.status === 'playing' ? best(rt, d - 1).v : score(rt);
        if (v > top.v) top = { v, m };
      }
      rt.restore(snap);
      return top;
    };
    const play = seed => {
      const rt = (b = sb.budget()).meter(ctx.make(seed)), path = [];
      // On foot on a side-view level: the platform runner, toward the next checkpoint zone.
      const caps = new Set(ctx.capabilities?.[rt.player()?.space] || []), runner = ['gravity', 'pathfind'].every(c => caps.has(c)) ? platformRunner(ctx, rt, b) : null;
      const zoneX = id => { const z = (ctx.doc.spaces || []).flatMap(sp => sp.zones || []).find(x => x.id === id); return Array.isArray(z?.rect) ? (z.rect[0] + z.rect[2]) / 2 : posOf(rt)?.[0] ?? 0; };
      // Countdown: wait until the race runs (positions only start counting then).
      while (rt.state.status === 'playing' && raceView(rt, ctx.doc, config).s?.state !== 'running' && rt.state.frame < 600) { hold(rt, {}, every); path.push('wait'); }
      while (rt.state.status === 'playing' && rt.state.frame < maxFrames && !raceView(rt, ctx.doc, config).done && !b.over()) {
        if (yieldToEncounter(ctx, rt, ['position'])) continue; // an encounter holds this loop: play the one the player is in
        const onFoot = !rt.player()?.components.seat && !rt.availableOptions().some(o => o.actions?.enter_vehicle !== undefined);
        if (runner && onFoot) { const cp = raceView(rt, ctx.doc, config).cp; path.push(`run ${cp}`); if (runner.advance({ to: cp, x: zoneX(cp) }) === 'stuck') break; continue; }
        const { m } = best(rt, depth); if (!m) break;
        playMacro(rt, m); path.push(m.label);
      }
      const v = raceView(rt, ctx.doc, config), won = rt.state.status === 'won' || v.r?.place === 1;
      return { seed, won, status: rt.state.status, place: v.r?.place ?? null, lap: v.r?.lap ?? 0, frames: rt.state.frame, path, hash: stateHash(rt.state), budget: !won && Boolean(b.hit) };
    };
    const r = multiSeed(play, { seeds, passRate });
    const finished = r.runs.filter(x => !x.budget), problems = [];
    if (!finished.length) problems.push(problem('budget_exhausted', where, 'the race driver ran out of budget before the race ended', { severity: 'warning' }));
    else if (finished.filter(x => x.won).length / finished.length < passRate) problems.push(problem('too_hard', where, `a lookahead driver won ${finished.filter(x => x.won).length}/${finished.length} races (best: place ${finished.map(x => x.place).filter(Boolean).sort()[0] ?? 'none'}, lap ${Math.max(...finished.map(x => x.lap))})`, { hint: 'wider checkpoints, fewer laps, a longer time limit, or slower rivals' }));
    return { ok: !problems.some(p => p.severity === 'error'), proven: r.ok ? [`a lookahead driver won ${r.wins}/${r.runs.length} races`] : [], problems, metrics: { runs: r.runs, rate: r.rate }, exhaustive: false, budget: sb.report() };
  },
};
