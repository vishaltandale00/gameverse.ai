// Verification: a bot plays the content headless through the real step
// function (fast timers, level-1 gravity where speed matters) and the report
// says what was proven. Per mode:
// - falling: a heuristic-placement bot must clear lines and survive ≥ 150 pieces (or win);
// - chain: a greedy bot with one-pair lookahead must finish each level in ≥ 70% of seeded runs;
// - swap: every level's starting board has a move, and a greedy bot meets each goal in ≥ 70% of runs;
// - slide: an expectimax bot must reach each target in ≥ 70% of runs (tiles ≥ 1024: at least once, and half of it in ≥ 70%).
import { createFalling, fallingBot } from './falling.js';
import { createChain, chainBot } from './chain.js';
import { createSwap, swapBot, hasMove } from './swap.js';
import { createSlide, slideBot } from './slide.js';
import { levelAt } from './common.js';

export const PIECES_TO_SURVIVE = 150, PASS_RATE = 0.7;
const now = () => performance.now();

function run(game, bot, s, until, maxSteps) {
  let steps = 0;
  while (s.status === 'playing' && steps < maxSteps && !until(s)) { game.step(s, bot(s)); steps++; }
  return steps;
}

function verifyFalling(content, seed, deadline) {
  const game = createFalling(content, { seed, fixedSpeed: 1, fast: true }), bot = fallingBot(game), s = game.createState();
  const steps = run(game, bot, s, x => x.stats.pieces >= PIECES_TO_SURVIVE || now() > deadline, 200_000);
  const survived = s.status === 'won' || (s.status === 'playing' && s.stats.pieces >= PIECES_TO_SURVIVE);
  const problems = [];
  if (!survived) problems.push({ code: s.status === 'lost' ? 'bot_topped_out' : 'budget', message: s.status === 'lost' ? `the bot topped out after ${s.stats.pieces} pieces (${s.reason})` : `verification ran out of time after ${s.stats.pieces} pieces` });
  if (!s.lines) problems.push({ code: 'no_lines', message: 'the bot cleared no lines' });
  return {
    problems,
    proven: survived ? [`a heuristic bot survived ${s.stats.pieces} pieces at level-1 gravity${s.status === 'won' ? ' and won' : ''}`, `cleared ${s.lines} lines`] : [],
    bot: { pieces: s.stats.pieces, lines: s.lines, tetrises: s.stats.tetrises, tspins: s.stats.tspins, maxCombo: s.stats.maxCombo, levelReached: s.level + 1, status: s.status, steps, score: s.score },
  };
}

function perLevel(content, seed, deadline, runs, make, botOf, maxSteps, extra) {
  const levels = [], problems = [], proven = [];
  for (let i = 0; i < content.levels.length; i++) {
    let wins = 0, done = 0;
    const detail = [];
    for (let k = 0; k < runs; k++) {
      if (now() > deadline && done >= 3) break;
      const game = make(i, seed + 7919 * k + 31 * i), bot = botOf(game), s = game.createState();
      if (extra) extra(s, i, problems);
      run(game, bot, s, x => x.level > i, maxSteps);
      const ok = s.status === 'won' || s.level > i;
      wins += ok ? 1 : 0; done++;
      detail.push(ok ? 'win' : s.status === 'lost' ? s.reason : 'unfinished');
    }
    const rate = done ? wins / done : 0;
    levels.push({ level: i + 1, goal: content.levels[i].goal, runs: done, wins, rate: +rate.toFixed(2), outcomes: [...new Set(detail)] });
    if (rate < PASS_RATE) problems.push({ code: 'goal_unreached', path: `levels[${i}]`, message: `the bot met level ${i + 1}'s goal in ${wins}/${done} runs (needs ${Math.round(PASS_RATE * 100)}%)` });
    else proven.push(`level ${i + 1} (${content.levels[i].goal}) met in ${wins}/${done} bot runs`);
  }
  return { levels, problems, proven };
}

function verifyChain(content, seed, deadline) {
  const r = perLevel(content, seed, deadline, 6, (i, sd) => createChain(content, { seed: sd, startAt: i, fixedSpeed: 1, fast: true }), chainBot, 60_000);
  return { problems: r.problems, proven: r.proven, bot: { levels: r.levels } };
}

function verifySwap(content, seed, deadline) {
  const r = perLevel(content, seed, deadline, 8, (i, sd) => createSwap(content, { seed: sd, startAt: i, fast: true }), swapBot, 40_000, (s, i, problems) => {
    if (!hasMove(s) && !problems.some(p => p.code === 'no_start_move' && p.path === `levels[${i}]`)) problems.push({ code: 'no_start_move', path: `levels[${i}]`, message: `level ${i + 1} starts with no valid move` });
  });
  if (!r.problems.some(p => p.code === 'no_start_move')) r.proven.unshift('every level starts with at least one valid move');
  return { problems: r.problems, proven: r.proven, bot: { levels: r.levels } };
}

function verifySlide(content, seed, deadline) {
  const runs = [], N = content.levels.length;
  for (let k = 0; k < 8; k++) {
    if (now() > deadline && runs.length >= 3) break;
    const game = createSlide(content, { seed: seed + 104729 * k, fast: true }), bot = slideBot(game), s = game.createState();
    run(game, bot, s, x => x.level >= N || now() > deadline + 400, 30_000);
    runs.push({ level: s.level, maxTile: s.maxTile, status: s.status, moves: s.stats.moves });
  }
  const problems = [], proven = [];
  const levels = content.levels.map((L, i) => {
    const wins = runs.filter(x => x.level > i || x.status === 'won').length, rate = wins / runs.length;
    const half = L.goal === 'tile' ? runs.filter(x => x.maxTile >= L.target / 2).length / runs.length : 0;
    let ok = rate >= PASS_RATE, how = `reached in ${wins}/${runs.length} bot runs`;
    // Big tiles: the bot is weaker than a practiced player, so an existence proof plus a fair half-way point counts.
    if (!ok && L.goal === 'tile' && L.target >= 1024 && wins >= 1 && half >= PASS_RATE) { ok = true; how = `reached in ${wins}/${runs.length} bot runs (half of it in ${Math.round(half * runs.length)}/${runs.length})`; }
    if (ok) proven.push(`level ${i + 1} (${L.goal} ${L.target}) ${how}`);
    else problems.push({ code: 'goal_unreached', path: `levels[${i}]`, message: `the bot reached level ${i + 1}'s goal (${L.goal} ${L.target}) in ${wins}/${runs.length} runs` });
    return { level: i + 1, goal: L.goal, target: L.target, runs: runs.length, wins, rate: +rate.toFixed(2), ok };
  });
  return { problems, proven, bot: { levels, bestTile: Math.max(...runs.map(x => x.maxTile)), runs } };
}

export function verifyContent(content, { seed = 1, budgetMs = 2000 } = {}) {
  const t0 = now(), deadline = t0 + budgetMs * 0.9;
  const fn = { falling: verifyFalling, chain: verifyChain, swap: verifySwap, slide: verifySlide }[content.mode];
  const r = fn(content, seed >>> 0 || 1, deadline);
  const ms = Math.round(now() - t0);
  if (ms > budgetMs) r.problems.push({ code: 'over_budget', message: `verification took ${ms} ms (budget ${budgetMs} ms)` });
  return {
    ok: !r.problems.filter(p => p.code !== 'over_budget').length,
    problems: r.problems,
    report: { mode: content.mode, variant: content.mode === 'chain' ? content.rules.variant : undefined, proven: r.proven, warnings: r.warnings || [], bot: r.bot, levels: content.levels.length, firstGoal: levelAt(content, 0).goal, ms, budgetMs },
  };
}
