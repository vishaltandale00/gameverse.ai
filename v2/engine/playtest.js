// Headless playtest: Go-Explore-style search over cheap JSON snapshots.
// Cells are (player tile, coarse progress); each round restores a cell and
// plays random macro inputs from it. No model calls; runs in milliseconds to
// a couple of seconds, in a worker or in Node.
import { DT, NEUTRAL_INPUT } from './compose.js';
import { seedFrom } from './rng.js';

function prng(seed) {
  let a = seedFrom(seed);
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function macrosFor(spec) {
  const uses = new Set(spec.modules.map(m => m.use));
  const fire = uses.has('shooter');
  const list = [{ name: 'idle', input: NEUTRAL_INPUT }];
  if (uses.has('topdown')) {
    for (const [x, y, name] of [[1, 0, 'right'], [-1, 0, 'left'], [0, -1, 'up'], [0, 1, 'down'], [1, -1, 'up-right'], [-1, -1, 'up-left'], [1, 1, 'down-right'], [-1, 1, 'down-left']]) {
      list.push({ name, input: { x, y, a: false, b: false } });
      if (fire) list.push({ name: name + '+fire', input: { x, y, a: false, b: true } });
    }
  } else {
    list.push({ name: 'right', input: { x: 1, y: 0, a: false, b: false } }, { name: 'left', input: { x: -1, y: 0, a: false, b: false } },
      { name: 'jump', input: { x: 0, y: 0, a: true, b: false } }, { name: 'jump-right', input: { x: 1, y: 0, a: true, b: false } },
      { name: 'jump-left', input: { x: -1, y: 0, a: true, b: false } });
    if (fire) list.push({ name: 'fire-right', input: { x: 1, y: 0, a: false, b: true } }, { name: 'fire-left', input: { x: -1, y: 0, a: false, b: true } });
  }
  return list;
}

// Progress = beneficial events so far; used to favour promising cells.
const PROGRESS_EVENTS = ['collect', 'stomp', 'hit', 'reach_goal', 'checkpoint'];
const needsAll = predicate => !!predicate && (predicate.var === 'remaining' || (predicate.all || predicate.any || []).some(needsAll));
/** What the search should head for: remaining pickups first if the win needs them all, else the goal. */
function targets(state, spec) {
  if (needsAll(spec?.win) && (state.vars.remaining ?? 0) > 0) { const left = state.entities.filter(e => e.tags.includes('collectible')); if (left.length) return left; }
  return state.entities.filter(e => e.tags.includes('goal'));
}
// Progress also rewards getting closer to the current target, so long levels pull the search forward.
function progress(state, spec) {
  let p = PROGRESS_EVENTS.reduce((n, e) => n + (state.counts[e] || 0), 0) * (needsAll(spec?.win) ? 3 : 1);
  const player = state.entities.find(e => e.tags.includes('player')), goals = targets(state, spec);
  if (player && goals.length) {
    const d = Math.min(...goals.map(g => Math.hypot(g.x - player.x, g.y - player.y)));
    p += needsAll(spec?.win) && goals[0]?.tags.includes('collectible') ? Math.max(0, 8 - d) / 8 : Math.max(0, (state.goalStart ??= d) - d) / 4;
  }
  return p;
}

function cellKey(game, state) {
  const p = state.entities.find(e => e.tags.includes('player'));
  const tile = p ? `${Math.floor(p.x + p.w / 2)},${Math.floor(p.y + p.h / 2)}` : 'none';
  const progress = Object.keys(state.vars).sort().filter(k => k !== 'time_left').map(k => `${k}=${Math.round(state.vars[k])}`).join(';');
  return `${tile}|${progress}`;
}

/** Replay a macro path [[macroIndex, frames], …] from a fresh state. */
export function replay(game, path, macros = macrosFor(game.spec)) {
  const state = game.createState();
  for (const [index, frames] of path) {
    for (let f = 0; f < frames && state.status === 'playing'; f++) game.step(state, macros[index].input);
    // A one-frame release between macros so repeated jumps register as presses.
    if (state.status === 'playing') game.step(state, NEUTRAL_INPUT);
  }
  return state;
}

export function playtest(game, { budgetMs = 1500, maxFrames = 600000, idleSeconds = 10, seed = 'playtest' } = {}) {
  const started = performance.now();
  const macros = macrosFor(game.spec), rand = prng(seed);
  const issues = [], fired = {}, record = state => { for (const e of state.events) fired[e.name] = (fired[e.name] || 0) + 1; };
  let frames = 0;

  // 1. Idle: what happens if the player does nothing?
  const idle = game.createState();
  for (let f = 0; f < idleSeconds / DT && idle.status === 'playing'; f++) { game.step(idle, NEUTRAL_INPUT); frames++; }
  if (idle.status === 'won') issues.push({ code: 'trivially_won', severity: 'error', message: `won after ${idle.time.toFixed(1)} s with no input` });
  if (idle.status === 'lost' && idle.time < 2) issues.push({ code: 'instant_loss', severity: 'error', message: `lost after ${idle.time.toFixed(2)} s with no input` });

  // 2. Search.
  const start = game.createState();
  const archive = new Map([[cellKey(game, start), { state: start, path: [], frames: 0, visits: 0, score: progress(start, game.spec) }]]);
  // Bias movement toward the nearest goal 60% of the time.
  const pickMacro = state => {
    const pl = state.entities.find(e => e.tags.includes('player')), gs = targets(state, game.spec);
    if (pl && gs.length && rand() < 0.6) {
      const g = gs.reduce((a, b) => Math.hypot(a.x - pl.x, a.y - pl.y) <= Math.hypot(b.x - pl.x, b.y - pl.y) ? a : b);
      const dx = Math.sign(Math.round(g.x - pl.x)), dy = Math.sign(Math.round(g.y - pl.y));
      const toward = macros.map((m, i) => [m, i]).filter(([m]) => (dx && m.input.x === dx) || (!dx && dy && m.input.y === dy));
      if (toward.length) return toward[Math.floor(rand() * toward.length)][1];
    }
    return Math.floor(rand() * macros.length);
  };
  let win = null, lossCodes = {}, rounds = 0, closest = null;
  outer: while (performance.now() - started < budgetMs && frames < maxFrames) {
    rounds++;
    const cells = [...archive.values()];
    let cell;
    if (rand() < 0.5) {
      // Exploit: resume from one of the most advanced cells.
      const best = [...cells].sort((a, b) => b.score - a.score).slice(0, 10);
      cell = best[Math.floor(rand() * best.length)];
    } else {
      // Explore: novel cells (few visits) and cells with more progress are favoured.
      let total = 0; const weights = cells.map(c => (total += (1 + c.score) ** 2 / Math.sqrt(c.visits + 1)));
      const pick = rand() * total; cell = cells[weights.findIndex(w => w >= pick)] || cells[0];
    }
    cell.visits++;
    const state = game.snapshot(cell.state); const path = cell.path.slice(); let elapsed = cell.frames;
    const steps = 1 + Math.floor(rand() * 4);
    for (let k = 0; k < steps; k++) {
      const index = pickMacro(state), length = 4 + Math.floor(rand() * 32);
      try {
        for (let f = 0; f < length && state.status === 'playing'; f++) { game.step(state, macros[index].input); record(state); frames++; elapsed++; }
        if (state.status === 'playing') { game.step(state, NEUTRAL_INPUT); record(state); frames++; elapsed++; }
      } catch (error) {
        issues.push({ code: 'runtime_error', severity: 'error', message: String(error?.message || error), repro: [...path, [index, length]] });
        break outer;
      }
      path.push([index, length]);
      const problems = game.check(state);
      if (problems.length) { issues.push({ code: 'invariant_violation', severity: 'error', message: problems[0], repro: path }); break outer; }
      if (state.status === 'won') { if (!win || elapsed < win.frames) win = { frames: elapsed, path: path.slice() }; break outer; }
      if (state.status === 'lost') { const why = state.events.at(-1)?.name || 'lose_condition'; lossCodes[why] = (lossCodes[why] || 0) + 1; break; }
      { const pl = state.entities.find(e => e.tags.includes('player')), gs = state.entities.filter(e => e.tags.includes('goal'));
        if (pl && gs.length) { const d = Math.min(...gs.map(g => Math.hypot(g.x - pl.x, g.y - pl.y))); if (!closest || d < closest.d) closest = { d, x: +pl.x.toFixed(1), y: +pl.y.toFixed(1) }; } }
      const key = cellKey(game, state), old = archive.get(key);
      if (!old || elapsed < old.frames) archive.set(key, { state: game.snapshot(state), path: path.slice(), frames: elapsed, visits: old?.visits || 0, score: progress(state, game.spec) });
    }
  }

  // 3. Determinism: the winning path must replay to a win.
  if (win) {
    const replayed = replay(game, win.path, macros);
    if (replayed.status !== 'won') issues.push({ code: 'nondeterministic', severity: 'error', message: 'winning input path did not reproduce the win on replay', repro: win.path });
  } else if (!issues.some(i => i.severity === 'error')) {
    issues.push({ code: 'goal_not_reached', severity: 'warning', message: `search did not reach the win condition within ${budgetMs} ms (${archive.size} places explored)` });
  }
  const provided = new Set(game.spec.modules.flatMap(m => m.use === 'shooter' ? ['shoot'] : m.use === 'collect' ? ['collect'] : m.use === 'goal' ? ['reach_goal'] : m.use === 'patrol' && m.with.stomp ? ['stomp'] : []));
  for (const event of provided) if (!fired[event]) issues.push({ code: 'mechanic_unused', severity: 'warning', message: `'${event}' never happened during search` });

  const wallMs = performance.now() - started;
  return {
    ok: !issues.some(i => i.severity === 'error'),
    winnable: !!win,
    win: win ? { seconds: +(win.frames * DT).toFixed(2), inputs: win.path.map(([i, n]) => `${macros[i].name}×${n}`) } : null,
    idle: { status: idle.status, seconds: +idle.time.toFixed(2) },
    explored: archive.size, rounds, framesSimulated: frames,
    wallMs: Math.round(wallMs), simulatedSeconds: +(frames * DT).toFixed(1), speedup: Math.round(frames * DT / (wallMs / 1000)),
    losses: lossCodes, eventsFired: fired, issues,
    closestToGoal: closest ? { tiles: +closest.d.toFixed(1), at: [closest.x, closest.y] } : null,
  };
}
