// Verification for runner content, using the real step function throughout.
// 1. Structural proof: every chunk in the pool is run alone at the highest
//    speed (and latest ramp time) it can appear at, from each entry state,
//    and a beam search over the mode's action set must find a way through.
//    Rhythm-dash proves the whole authored level the same way.
// 2. Lookahead bot: plays ≥ 60 s headless, replanning by searching the next
//    few actions with the real physics; reports distance, deaths and
//    near-misses. ok needs every chunk passable and the bot past a threshold.
import { createGame, speedAt, DT } from './world.js';
import { validate } from './content.js';

const NONE = { x: 0, y: 0, a: false, b: false };
export const BOT = {
  lanes: { depth: 7, beam: 8, replan: 2, proofBeam: 20 },
  side: { depth: 10, beam: 8, replan: 3, proofBeam: 20 },
  flap: { depth: 14, beam: 10, replan: 3, proofBeam: 28 },
  climb: { depth: 12, beam: 10, replan: 3, proofBeam: 40 },
  hop: { depth: 6, beam: 14, replan: 2, proofBeam: 48 },
  'rhythm-dash': { depth: 24, beam: 6, replan: 4, proofBeam: 24 },
};

function act(game, s, a, every) {
  for (let f = 0; f < every; f++) {
    game.step(s, a.tap && f > 0 ? NONE : a);
    if (s.status !== 'playing') return;
  }
}

/** Beam search from s until done(state); returns { ok, frames, best } (best = furthest progress). */
export function prove(game, s0, { done, maxFrames, beam, deadline }) {
  const sv = game.impl.solver, every = sv.every;
  let layer = [s0], best = game.progress(s0);
  for (let f = 0; f < maxFrames; f += every) {
    if (performance.now() > deadline) return { ok: false, frames: f, best, timeout: true };
    const next = new Map();
    for (const s of layer) for (const a of sv.actions) {
      const c = game.clone(s);
      act(game, c, a, every);
      if (done(c)) return { ok: true, frames: f + every, best: game.progress(c) };
      if (c.status !== 'playing') continue;
      const k = sv.key(c), sc = sv.score(c);
      const old = next.get(k);
      if (!old || sc > old.sc) { c.sc = sc; next.set(k, c); }
    }
    if (!next.size) return { ok: false, frames: f, best };
    layer = [...next.values()].sort((a, b) => b.sc - a.sc).slice(0, beam);
    best = Math.max(best, game.progress(layer[0]));
  }
  return { ok: false, frames: maxFrames, best };
}

/** Depth-limited lookahead: the action path to the best surviving leaf (or the longest survivor). */
export function plan(game, s0, { depth, beam }) {
  const sv = game.impl.solver, every = sv.every;
  let layer = [{ s: s0, path: [] }], last = layer, dead = null;
  for (let d = 0; d < depth; d++) {
    const next = new Map();
    for (const node of layer) sv.actions.forEach((a, i) => {
      const c = game.clone(node.s);
      act(game, c, a, every);
      const path = [...node.path, i];
      if (c.status === 'won') { next.clear(); next.set('won', { s: c, path, sc: Infinity }); return; }
      if (c.status !== 'playing' || c.livesLost > s0.livesLost) { if (!dead || path.length > dead.path.length) dead = { path }; return; }
      const k = sv.key(c), sc = sv.score(c);
      const old = next.get(k);
      if (!old || sc > old.sc) next.set(k, { s: c, path, sc });
    });
    if (next.has('won')) return next.get('won').path;
    if (!next.size) break;
    last = layer = [...next.values()].sort((a, b) => b.sc - a.sc).slice(0, beam);
  }
  return last[0]?.path.length ? last[0].path : dead?.path || [0];
}

/** Bot play for `seconds` of sim time across as many runs as it takes. */
export function botPlay(content, { seed = 1, seconds = 60, deadline = Infinity } = {}) {
  const cfg = BOT[content.mode];
  const runs = [];
  let frames = 0, deaths = 0, timeout = false;
  while (frames < seconds * 60) {
    const game = createGame(content, { seed: seed + deaths * 7919 });
    const sv = game.impl.solver;
    const s = game.createState();
    let queue = [];
    while (s.status === 'playing' && frames < seconds * 60) {
      if (performance.now() > deadline) { timeout = true; break; }
      if (queue.length <= cfg.depth - cfg.replan || !queue.length) queue = plan(game, s, cfg);
      act(game, s, sv.actions[queue.shift() ?? 0], sv.every);
      frames += sv.every;
    }
    runs.push({ distance: Math.round(s.distance * 10) / 10, seconds: Math.round(s.time * 10) / 10, score: s.score, coins: s.coins, nearMisses: s.stats.near_misses, status: s.status, reason: s.reason || null, chunks: s.chunkN });
    deaths += s.livesLost || 0;
    if (s.status === 'lost') deaths++;
    if (timeout || s.status === 'won') break;
  }
  const best = runs.reduce((m, r) => Math.max(m, r.distance), 0);
  return { runs, frames, deaths, timeout, bestDistance: best, distance: Math.round(runs.reduce((a, r) => a + r.distance, 0) * 10) / 10, nearMisses: runs.reduce((a, r) => a + r.nearMisses, 0), coins: runs.reduce((a, r) => a + r.coins, 0), won: runs.some(r => r.status === 'won') };
}

/** Distance the bot must reach in one run. */
export function threshold(content) {
  if (content.mode === 'climb') return 60;
  if (content.mode === 'hop') return 40;
  if (content.mode === 'rhythm-dash') return null; // must finish the level
  let d = 0;
  for (let t = 0; t < 45; t += 0.5) d += speedAt(content, t) * 0.5;
  return Math.round(d * 0.7);
}

/** Structural check: every chunk passable at the highest speed it can appear at. */
export function structural(content, { deadline = Infinity } = {}) {
  const game = createGame(content, { seed: 1 });
  const sv = game.impl.solver, cfg = BOT[content.mode];
  if (content.mode === 'rhythm-dash') {
    const s = game.createState();
    const r = prove(game, s, { done: c => c.status === 'won', maxFrames: Math.ceil(game.level.end / game.impl.physics(content).v / DT / 0.8) + 600, beam: cfg.proofBeam, deadline });
    const seg = game.level.segs.find(g => r.best >= g.x0 && r.best < g.x1);
    return [{ id: 'level', tier: 0, maxSpeed: null, passable: r.ok, timeout: !!r.timeout, frames: r.frames, reached: Math.round(r.best), segment: r.ok ? null : seg?.type || null }];
  }
  return game.pool.map((chunk, i) => {
    const lim = game.limits[i];
    const entries = sv.entries(game.createState());
    const results = entries.map(entry => {
      const s = game.trialState(i, { speed: lim.speed, time: lim.time, entry });
      const span = s.trial.end - game.progress(s);
      const done = game.impl.trialDone || (c => game.progress(c) >= c.trial.end + 1);
      const maxFrames = content.mode === 'climb' ? Math.ceil(span / 2 / DT) + 900 : content.mode === 'hop' ? Math.ceil(span * 2.5 / DT) + 600 : Math.ceil((span + 4) / lim.speed / DT) + 240;
      return prove(game, s, { done, maxFrames, beam: cfg.proofBeam, deadline });
    });
    return { id: chunk.id, tier: chunk.tier, maxSpeed: Math.round(lim.speed * 100) / 100, passable: results.every(r => r.ok), timeout: results.some(r => r.timeout), entries: results.map(r => r.ok) };
  });
}

export function verify(input, { seed = 1, budgetMs = 2000 } = {}) {
  const started = performance.now(), deadline = started + budgetMs;
  const checked = validate(input);
  if (!checked.ok) return { ok: false, problems: checked.errors.map(e => ({ code: e.code, path: e.path, message: e.message })), report: { proven: [], wallMs: Math.round(performance.now() - started) } };
  const content = checked.content, problems = [];
  const chunks = structural(content, { deadline: started + budgetMs * 0.45 });
  for (const c of chunks) if (!c.passable) problems.push(c.timeout ? { code: 'budget', message: `ran out of time proving '${c.id}'` } : { code: 'chunk_impassable', chunk: c.id, message: content.mode === 'rhythm-dash' ? `no way through the level past x=${c.reached} (${c.segment} segment)` : `chunk '${c.id}' has no way through at speed ${c.maxSpeed}` });
  const structuralMs = Math.round(performance.now() - started);
  const bot = botPlay(content, { seed, seconds: 60, deadline });
  const need = threshold(content);
  if (bot.timeout) problems.push({ code: 'budget', message: 'ran out of time during bot play' });
  const goal = content.rules.goalDistance;
  if (content.mode === 'rhythm-dash' ? !bot.won : goal > 0 ? !bot.won && bot.bestDistance < Math.min(goal, need) : bot.bestDistance < need) problems.push({ code: 'bot_short', message: content.mode === 'rhythm-dash' ? 'the bot could not finish the level' : `the bot reached ${bot.bestDistance} of the ${need} needed`, reason: bot.runs.at(-1)?.reason || null });
  return {
    ok: problems.length === 0,
    problems,
    report: {
      proven: [`${chunks.filter(c => c.passable).length}/${chunks.length} ${content.mode === 'rhythm-dash' ? 'level' : 'chunks'} passable at their max speed`, content.mode === 'rhythm-dash' ? 'bot finishes the level' : `bot best run ${bot.bestDistance} ≥ ${need}`],
      mode: content.mode, chunks, threshold: need,
      bot: { seconds: Math.round((bot.frames / 60) * 10) / 10, distance: bot.distance, bestDistance: bot.bestDistance, deaths: bot.deaths, nearMisses: bot.nearMisses, coins: bot.coins, won: bot.won, runs: bot.runs },
      cleared: chunks.every(c => c.passable), time: Math.round(bot.frames / 60), deaths: bot.deaths,
      structuralMs, wallMs: Math.round(performance.now() - started),
    },
  };
}
