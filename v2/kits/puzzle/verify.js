// Verification: bots play the content headless through the real step function
// and the report says what was proven. Every level is played in isolation
// (fresh board, that level's speed, obstacles, layout and limits), so a
// problem always points at the level at fault, with a hint the model can act on.
// - falling: a two-piece-lookahead placement bot (El-Tetris weights, hold) at the level's real
//   gravity and a human-like pace must meet each level's goal; level 1 must also be survived for
//   150 pieces. Lines and score goals past 1000 pieces are extrapolated from a steady clear rate.
// - chain / virus: a greedy bot with one-pair lookahead must finish each level in ≥ 70% of runs.
// - swap: every level starts with a move, and a greedy bot meets each goal in ≥ 70% of runs.
// - slide: an expectimax bot must reach each target in ≥ 70% of runs (tiles ≥ 1024: at least
//   once, and half of it in ≥ 70%).
// Running out of budget is the kit's limit, not the content's: it is reported as a warning.
import { createFalling, fallingBot } from './falling.js';
import { createChain, chainBot } from './chain.js';
import { createSwap, swapBot, hasMove } from './swap.js';
import { createSlide, slideBot } from './slide.js';
import { levelAt } from './common.js';

export const PIECES_TO_SURVIVE = 150, PASS_RATE = 0.7, MAX_PIECES = 1000;
const now = () => performance.now();
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function run(game, bot, s, until, maxSteps, deadline) {
  let steps = 0;
  while (s.status === 'playing' && steps < maxSteps && !until(s)) {
    game.step(s, bot(s)); steps++;
    if ((steps & 1023) === 0 && now() > deadline) return { steps, budget: true };
  }
  return { steps, budget: false };
}

// ---------- falling ----------
function stackHeight(game, s) { for (let i = 0; i < s.board.length; i++) if (s.board[i]) return game.H - Math.floor(i / game.W); return 0; }

function playFallingLevel(content, i, seed, deadline) {
  const L = content.levels[i], game = createFalling(content, { seed, startAt: i, fast: true, stay: true }), bot = fallingBot(game), s = game.createState();
  const need = i === 0 ? PIECES_TO_SURVIVE : 0;
  let maxH = 0, budget = false;
  const timed = L.goal === 'survive' || L.timeSec > 0;
  for (let steps = 0; s.status === 'playing' && steps < 2_000_000; steps++) {
    game.step(s, bot(s));
    if (!s.events.some(e => e.name === 'land')) continue;
    maxH = Math.max(maxH, stackHeight(game, s));
    if (s.goalMet && s.stats.pieces >= need) break;
    if (!timed && s.stats.pieces >= MAX_PIECES) break;
    if ((s.stats.pieces & 15) === 0 && now() > deadline) { budget = true; break; }
  }
  const rate = s.stats.pieces ? s.levelLines / s.stats.pieces : 0;
  // Untimed goals beyond MAX_PIECES: a bot clearing steadily with a low stack will get there.
  const steady = !timed && s.status === 'playing' && !s.goalMet && s.stats.pieces >= MAX_PIECES && maxH <= (game.H - 4) * 0.7 && (L.goal === 'score' ? s.levelScore > 0 : rate >= 0.25);
  const ok = s.status === 'playing' && (!!s.goalMet || steady) && s.stats.pieces >= need;
  return { ok, steady, budget: budget && !ok, status: s.status, reason: s.reason, pieces: s.stats.pieces, lines: s.levelLines, score: s.levelScore, goalAt: s.goalMet?.pieces ?? null, maxHeight: maxH, tetrises: s.stats.tetrises, tspins: s.stats.tspins };
}

function fallingHint(L, r) {
  if (r.reason === 'Time up') return `raise timeSec or lower the target (the bot had ${r.lines} lines when time ran out)`;
  const tips = [];
  if (L.speed >= 19) tips.push('lower speed to 18 or less (19-20 drop pieces instantly)');
  else if (L.speed >= 14) tips.push('lower speed');
  if (L.obstacles >= 3) tips.push('use fewer garbage rows (obstacles)');
  if (L.layout.length >= 6) tips.push('use a shorter starting layout');
  return tips.length ? tips.join('; ') : 'lower speed or use fewer garbage rows';
}

function verifyFalling(content, seed, deadline) {
  const problems = [], proven = [], warnings = [], levels = [];
  for (let i = 0; i < content.levels.length; i++) {
    const L = content.levels[i], path = `levels[${i}]`;
    // One run usually settles it; a failure is re-checked on two more seeds before it is blamed on the content.
    const runs = [playFallingLevel(content, i, seed + 7919 * i, deadline)];
    if (!runs[0].ok && !runs[0].budget) for (let k = 1; k < 3 && now() < deadline; k++) runs.push(playFallingLevel(content, i, seed + 7919 * i + 104729 * k, deadline));
    const wins = runs.filter(r => r.ok).length, done = runs.filter(r => !r.budget).length;
    const r = runs.find(x => !x.ok && !x.budget) || runs[0];
    levels.push({ level: i + 1, goal: L.goal, speed: L.speed, runs: runs.length, wins, pieces: runs[0].pieces, lines: runs[0].lines, maxHeight: runs[0].maxHeight, goalAt: runs[0].goalAt, extrapolated: runs[0].steady });
    if (!done) { warnings.push(`level ${i + 1} was not fully played within the time budget`); continue; }
    if (wins >= Math.min(2, runs.length) || (runs.length === 1 && wins === 1)) {
      const g = runs.find(x => x.ok);
      proven.push(`level ${i + 1} (${L.goal}, speed ${L.speed}${L.obstacles ? `, ${L.obstacles} garbage rows` : ''}): ${g.steady ? `steady clearing over ${g.pieces} pieces (goal extrapolated)` : `goal met after ${g.goalAt} pieces`}${i === 0 ? `, survived ${g.pieces} pieces` : ''}`);
      continue;
    }
    const what = r.status === 'lost' ? (r.reason === 'Time up' ? `ran out of time with ${r.lines} of ${L.target} lines` : `topped out after ${plural(r.pieces, 'piece')}${r.goalAt != null ? ` (the goal was met at piece ${r.goalAt}, but level 1 must be survivable for ${PIECES_TO_SURVIVE})` : ''}`) : `did not reach the goal in ${MAX_PIECES} pieces`;
    problems.push({ code: r.reason === 'Time up' ? 'level_too_slow' : 'level_too_hard', path, message: `level ${i + 1} (speed ${L.speed}${L.obstacles ? `, ${L.obstacles} garbage rows` : ''}): the bot ${what} in ${runs.length - wins}/${runs.length} runs`, hint: fallingHint(L, r) });
  }
  return { problems, proven, warnings, bot: { kind: 'placement search, hold, next-piece lookahead (El-Tetris weights)', pace: '3 pieces/s', levels } };
}

// ---------- level-by-level runs for chain and swap ----------
function perLevel(content, seed, deadline, runs, make, botOf, maxSteps, describe, extra) {
  const levels = [], problems = [], proven = [], warnings = [];
  for (let i = 0; i < content.levels.length; i++) {
    let wins = 0, done = 0;
    const outcomes = {};
    for (let k = 0; k < runs; k++) {
      if (now() > deadline && done >= 3) break;
      const game = make(i, seed + 7919 * k + 31 * i), bot = botOf(game), s = game.createState();
      if (extra) extra(s, i, problems);
      const r = run(game, bot, s, x => x.level > i, maxSteps, deadline + 300);
      const ok = s.status === 'won' || s.level > i;
      if (!ok && r.budget) continue;
      wins += ok ? 1 : 0; done++;
      const key = ok ? 'win' : s.status === 'lost' ? s.reason : 'unfinished';
      outcomes[key] = (outcomes[key] || 0) + 1;
    }
    const rate = done ? wins / done : 0, L = content.levels[i];
    levels.push({ level: i + 1, goal: L.goal, runs: done, wins, rate: +rate.toFixed(2), outcomes });
    if (!done) { warnings.push(`level ${i + 1} was not played within the time budget`); continue; }
    if (rate >= PASS_RATE) { proven.push(`level ${i + 1} (${L.goal}) met in ${wins}/${done} bot runs`); continue; }
    const fail = Object.entries(outcomes).filter(([k]) => k !== 'win').sort((a, b) => b[1] - a[1])[0]?.[0] || 'unfinished';
    const { what, hint } = describe(L, fail);
    problems.push({ code: 'goal_unreached', path: `levels[${i}]`, message: `level ${i + 1} (${L.goal}): the bot met the goal in ${wins}/${done} runs; ${what}`, hint });
  }
  return { levels, problems, proven, warnings };
}

function chainDescribe(content) {
  const virus = content.rules.variant === 'virus';
  return (L, fail) => {
    const topped = /full|top/i.test(fail), timeUp = fail === 'Time up';
    const what = timeUp ? 'time ran out first' : topped ? `it usually ${virus ? 'filled the jar' : 'stacked to the top'} (speed ${L.speed})` : 'it could not finish';
    const hint = timeUp ? 'raise timeSec or lower the target'
      : L.goal === 'viruses' ? `fewer viruses (obstacles, now ${L.obstacles}) or lower speed`
      : L.goal === 'chain' ? `a shorter chain (target, now ${L.target})${topped ? ' or lower speed' : ''}`
      : L.goal === 'blockers' ? `fewer garbage rows (obstacles, now ${L.obstacles})${topped ? ' or lower speed' : ''}`
      : L.goal === 'survive' ? 'a shorter timeSec or lower speed'
      : topped ? 'lower speed or a lower target' : 'a lower target';
    return { what, hint };
  };
}
function verifyChain(content, seed, deadline) {
  const r = perLevel(content, seed, deadline, 6, (i, sd) => createChain(content, { seed: sd, startAt: i, fast: true }), chainBot, 120_000, chainDescribe(content));
  return { problems: r.problems, proven: r.proven, warnings: r.warnings, bot: { levels: r.levels } };
}

const SWAP_HINT = { score: 'a lower target or more moves', jelly: 'less jelly in the layout or more moves', blockers: 'fewer blockers in the layout or more moves', collect: 'fewer items (target) or more moves' };
function verifySwap(content, seed, deadline) {
  const r = perLevel(content, seed, deadline, 8, (i, sd) => createSwap(content, { seed: sd, startAt: i, fast: true }), swapBot, 40_000,
    (L, fail) => ({ what: fail === 'Out of moves' ? `it ran out of moves (${L.moves})` : fail === 'Time up' ? `time ran out (${L.timeSec}s)` : 'it could not finish', hint: fail === 'Time up' ? `raise timeSec or ${SWAP_HINT[L.goal].replace(' or more moves', '')}` : SWAP_HINT[L.goal] }),
    (s, i, problems) => {
      if (!hasMove(s) && !problems.some(p => p.code === 'no_start_move' && p.path === `levels[${i}]`)) problems.push({ code: 'no_start_move', path: `levels[${i}].layout`, message: `level ${i + 1} starts with no valid move`, hint: 'use fewer holes and blockers so gems can line up' });
    });
  if (!r.problems.some(p => p.code === 'no_start_move')) r.proven.unshift('every level starts with at least one valid move');
  return { problems: r.problems, proven: r.proven, warnings: r.warnings, bot: { levels: r.levels } };
}

// ---------- slide ----------
function verifySlide(content, seed, deadline) {
  const runs = [], N = content.levels.length;
  for (let k = 0; k < 8; k++) {
    if (now() > deadline && runs.length >= 3) break;
    const game = createSlide(content, { seed: seed + 104729 * k, fast: true }), bot = slideBot(game), s = game.createState();
    run(game, bot, s, x => x.level >= N, 30_000, deadline + 400);
    runs.push({ level: s.level, maxTile: s.maxTile, status: s.status, reason: s.reason, moves: s.stats.moves });
  }
  const problems = [], proven = [];
  const levels = content.levels.map((L, i) => {
    const wins = runs.filter(x => x.level > i || x.status === 'won').length, rate = wins / runs.length;
    const half = L.goal === 'tile' ? runs.filter(x => x.maxTile >= L.target / 2).length / runs.length : 0;
    let ok = rate >= PASS_RATE, how = `reached in ${wins}/${runs.length} bot runs`;
    // Big tiles: the bot is weaker than a practiced player, so an existence proof plus a fair half-way point counts.
    if (!ok && L.goal === 'tile' && L.target >= 1024 && wins >= 1 && half >= PASS_RATE) { ok = true; how = `reached in ${wins}/${runs.length} bot runs (half of it in ${Math.round(half * runs.length)}/${runs.length})`; }
    if (ok) proven.push(`level ${i + 1} (${L.goal} ${L.target}) ${how}`);
    else {
      const stuck = runs.filter(x => x.level === i);
      const outOfMoves = stuck.some(x => x.reason === 'Out of moves'), timeUp = stuck.some(x => x.reason === 'Time up');
      const best = Math.max(0, ...runs.map(x => x.maxTile)), sorted = runs.map(x => x.maxTile).sort((m, n) => n - m);
      const fair = Math.max(8, sorted[Math.max(0, Math.ceil(sorted.length * PASS_RATE) - 1)] || 8); // reached in ≥ 70% of runs
      problems.push({ code: 'goal_unreached', path: `levels[${i}]`, message: `level ${i + 1} (${L.goal} ${L.target}): the bot reached it in ${wins}/${runs.length} runs (best tile ${best})${outOfMoves ? `; it ran out of moves (${L.moves})` : timeUp ? `; time ran out (${L.timeSec}s)` : ''}`, hint: outOfMoves ? 'more moves or a lower target' : timeUp ? 'raise timeSec or lower the target' : L.goal === 'tile' ? `a lower target (like ${fair})${L.obstacles ? ' or fewer rocks' : ''}` : 'a lower target' });
    }
    return { level: i + 1, goal: L.goal, target: L.target, runs: runs.length, wins, rate: +rate.toFixed(2), ok };
  });
  return { problems, proven, warnings: [], bot: { levels, bestTile: Math.max(...runs.map(x => x.maxTile)), runs } };
}

export function verifyContent(content, { seed = 1, budgetMs = 2000 } = {}) {
  const t0 = now(), deadline = t0 + budgetMs * 0.85;
  const fn = { falling: verifyFalling, chain: verifyChain, swap: verifySwap, slide: verifySlide }[content.mode];
  const r = fn(content, (seed >>> 0) || 1, deadline);
  const ms = Math.round(now() - t0);
  const warnings = [...(r.warnings || [])];
  if (ms > budgetMs) warnings.push(`verification took ${ms} ms (budget ${budgetMs} ms)`);
  return {
    ok: !r.problems.length,
    problems: r.problems,
    report: { mode: content.mode, variant: content.mode === 'chain' ? content.rules.variant : undefined, proven: r.proven, warnings, bot: r.bot, levels: content.levels.length, firstGoal: levelAt(content, 0).goal, ms, budgetMs },
  };
}
