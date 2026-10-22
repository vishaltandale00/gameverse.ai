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
  side: { depth: 10, beam: 8, replan: 3, proofBeam: 32 },
  flap: { depth: 14, beam: 10, replan: 3, proofBeam: 40 },
  climb: { depth: 12, beam: 10, replan: 3, proofBeam: 40 },
  hop: { depth: 6, beam: 14, replan: 2, proofBeam: 48 },
  'rhythm-dash': { depth: 24, beam: 6, replan: 4, proofBeam: 24 },
};

/**
 * Keep the beam diverse: the best state of each bucket (a height band, lane or column) first,
 * then the rest by score. Without this the beam fills with near-copies and loses the one
 * line through a chunk that starts off looking worse.
 */
function select(list, beam, bucket, score = n => n.sc) {
  list.sort((a, b) => score(b) - score(a));
  if (!bucket || list.length <= beam) return list.slice(0, beam);
  const seen = new Set(), out = [], rest = [];
  for (const n of list) { const b = bucket(n.s || n); if (seen.has(b)) rest.push(n); else { seen.add(b); out.push(n); } }
  return out.slice(0, beam).concat(rest.slice(0, Math.max(0, beam - out.length)));
}

function act(game, s, a, every) {
  for (let f = 0; f < every; f++) {
    game.step(s, a.tap && f > 0 ? NONE : a);
    if (s.status !== 'playing') return;
  }
}

/** Beam search from s until done(state); returns { ok, frames, best, path? } (best = furthest progress; path = action indexes when ok). */
export function prove(game, s0, { done, maxFrames, beam, deadline }) {
  const pathOf = (tr) => { const out = []; for (let t = tr; t; t = t.up) out.push(t.a); return out.reverse(); };
  const sv = game.impl.solver, every = sv.every;
  let layer = [s0], best = game.progress(s0), won = null;
  for (let f = 0; f < maxFrames; f += every) {
    if (performance.now() > deadline) return { ok: false, frames: f, best, timeout: true };
    const next = new Map();
    for (const s of layer) sv.actions.forEach((a, ai) => {
      const c = game.clone(s);
      c.tr = { up: s.tr || null, a: ai };
      act(game, c, a, every);
      if (done(c)) { won = { ok: true, frames: f + every, best: game.progress(c), path: pathOf(c.tr) }; return; }
      if (won) return;
      if (c.status !== 'playing') return;
      const k = sv.key(c), sc = sv.score(c);
      const old = next.get(k);
      if (!old || sc > old.sc) { c.sc = sc; next.set(k, c); }
    });
    if (won) return won;
    if (!next.size) return { ok: false, frames: f, best };
    layer = select([...next.values()], beam, sv.bucket);
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
    last = layer = select([...next.values()], beam, sv.bucket);
  }
  return last[0]?.path.length ? last[0].path : dead?.path || [0];
}

/** Bot play for `seconds` of sim time across as many runs as it takes. */
export function botPlay(content, { seed = 1, seconds = 60, deadline = Infinity, cfg = BOT[content.mode] } = {}) {
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

/** Play a recorded action path (the proof of a finite level) and report it like a bot run. */
export function replay(content, path) {
  const game = createGame(content, { seed: 1 }), sv = game.impl.solver, s = game.createState();
  for (const i of path) { act(game, s, sv.actions[i], sv.every); if (s.status !== 'playing') break; }
  const run = { distance: Math.round(s.distance * 10) / 10, seconds: Math.round(s.time * 10) / 10, score: s.score, coins: s.coins, nearMisses: s.stats.near_misses, status: s.status, reason: s.reason || null, chunks: 0 };
  return { runs: [run], frames: s.frame, deaths: s.status === 'lost' ? 1 : 0, timeout: false, bestDistance: run.distance, distance: run.distance, nearMisses: run.nearMisses, coins: run.coins, won: s.status === 'won' };
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
    return [{ id: 'level', tier: 0, maxSpeed: null, passable: r.ok, path: r.path || null, timeout: !!r.timeout, frames: r.frames, reached: Math.round(r.best), segment: r.ok ? null : seg?.type || null, segmentIndex: r.ok || !seg ? null : Math.max(0, Math.min(content.segments.length - 1, game.level.segs.indexOf(seg) - 1)) }];
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
    return { id: chunk.id, index: i, tier: chunk.tier, maxSpeed: Math.round(lim.speed * 100) / 100, passable: results.every(r => r.ok), timeout: results.some(r => r.timeout), entries: results.map(r => r.ok) };
  });
}

export function verify(input, { seed = 1, budgetMs = 2000 } = {}) {
  const started = performance.now(), deadline = started + budgetMs;
  const checked = validate(input);
  if (!checked.ok) return { ok: false, problems: checked.errors.map(e => ({ code: e.code, path: e.path, message: e.message })), report: { proven: [], wallMs: Math.round(performance.now() - started) } };
  const content = checked.content, problems = [];
  const chunks = structural(content, { deadline: started + budgetMs * 0.45 });
  // Problems name the content at fault, so the pipeline can send them back for repair.
  const HINTS = { lanes: 'leave a free or jumpable/slidable lane in every row and more spacing between rows', side: 'narrower gaps (≤ 3 units), climbs of at most 2 cells, fewer hazards in a row', flap: 'bigger gaps (4-5 rows) and smaller jumps between neighbouring gaps', climb: 'more platforms and smaller spacing', hop: 'fewer consecutive road or river rows, or slower traffic' };
  for (const c of chunks) if (!c.passable) problems.push(c.timeout ? { code: 'budget', path: c.index != null ? `chunks[${c.index}]` : 'segments', message: `ran out of time proving '${c.id}'`, hint: 'use fewer or shorter chunks' }
    : content.mode === 'rhythm-dash' ? { code: 'segment_impassable', path: `segments[${c.segmentIndex ?? 0}]`, message: `no way through the ${c.segment} segment (stuck at x=${c.reached})`, hint: 'lower its intensity or follow it with a run segment' }
    : { code: 'chunk_impassable', chunk: c.id, path: `chunks[${c.index}]`, message: `chunk '${c.id}' has no way through at speed ${c.maxSpeed}`, hint: HINTS[content.mode] });
  const structuralMs = Math.round(performance.now() - started);
  // A finite rhythm-dash level is played to its end along the solver's winning line (deterministic,
  // so the replay is an honest run). Endless modes play 60 s; if the lookahead falls short it gets
  // one deeper, wider retry before the content is blamed.
  const need = threshold(content);
  let bot, escalated = false;
  if (content.mode === 'rhythm-dash') bot = chunks[0].path ? replay(content, chunks[0].path) : { runs: [], frames: 0, deaths: 0, timeout: false, bestDistance: 0, distance: 0, nearMisses: 0, coins: 0, won: false };
  else {
    bot = botPlay(content, { seed, seconds: 60, deadline });
    const short = b => b.bestDistance < (content.rules.goalDistance > 0 ? Math.min(content.rules.goalDistance, need) : need) && !b.won;
    if (short(bot) && !bot.timeout && chunks.every(c => c.passable)) {
      const base = BOT[content.mode];
      const deep = botPlay(content, { seed, seconds: 60, deadline, cfg: { ...base, depth: Math.round(base.depth * 1.7), beam: Math.round(base.beam * 1.5), replan: base.replan } });
      escalated = true;
      if (!deep.timeout || deep.bestDistance > bot.bestDistance) bot = deep;
    }
  }
  if (bot.timeout) problems.push({ code: 'budget', path: 'chunks', message: 'ran out of time during bot play', hint: 'use fewer, shorter chunks' });
  const goal = content.rules.goalDistance;
  if (content.mode === 'rhythm-dash' ? !bot.won && chunks[0].passable : goal > 0 ? !bot.won && bot.bestDistance < Math.min(goal, need) : bot.bestDistance < need) problems.push({ code: 'bot_short', path: content.mode === 'rhythm-dash' ? 'segments' : 'speed', message: content.mode === 'rhythm-dash' ? 'the bot could not finish the level' : `the bot reached ${bot.bestDistance} of the ${need} needed (${bot.runs.at(-1)?.reason || 'too slow'})`, hint: content.mode === 'rhythm-dash' ? 'lower segment intensities' : 'lower speed.max or ease the tier 3 chunks', reason: bot.runs.at(-1)?.reason || null });
  return {
    ok: problems.length === 0,
    problems,
    report: {
      proven: [`${chunks.filter(c => c.passable).length}/${chunks.length} ${content.mode === 'rhythm-dash' ? 'level' : 'chunks'} passable at their max speed`, content.mode === 'rhythm-dash' ? 'bot finishes the level' : `bot best run ${bot.bestDistance} ≥ ${need}`],
      mode: content.mode, chunks: chunks.map(({ path, ...c }) => c), threshold: need,
      bot: { escalated, replayedProof: content.mode === 'rhythm-dash', seconds: Math.round((bot.frames / 60) * 10) / 10, distance: bot.distance, bestDistance: bot.bestDistance, deaths: bot.deaths, nearMisses: bot.nearMisses, coins: bot.coins, won: bot.won, runs: bot.runs },
      cleared: chunks.every(c => c.passable), time: Math.round(bot.frames / 60), deaths: bot.deaths,
      structuralMs, wallMs: Math.round(performance.now() - started),
    },
  };
}
