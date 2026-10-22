// Maze kit verification: structural proofs for every level's maze, and a bot
// that plays level 1 headless with greedy, danger-avoiding pathing (BFS to the
// nearest pellet through tiles it can reach before any live hunter, hunting
// frightened ones and heading for a power pellet when a hunter closes in).
import { validate } from './content.js';
import { createGame, DX, DY, tileOf } from './game.js';
import { checkMaze, isOpen, wrapX } from './maze.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
/** Share of level-1 pellets the bot must clear with 3 lives, at every size. */
export const BOT_BAR = 60;
const DANGER = 3, MARGIN = 2, HUNT_FRAMES = 90, SAFE_FRAMES = 60, FIELD_CAP = 24, FAR = 32767;

/**
 * Multi-source BFS distance (in tiles) over corridors from the given tiles, up to FIELD_CAP;
 * farther tiles read FAR. A stamp array marks this call's writes, so nothing is cleared per call.
 */
function field(maze, sources, m) {
  const W = maze.w, out = m.hd, stamp = m.hs, q = m.q, mark = ++m.hgen;
  let head = 0, tail = 0;
  for (const t of sources) { const i = t.y * W + t.x; if (stamp[i] !== mark || out[i] !== 0) { stamp[i] = mark; out[i] = 0; q[tail++] = i; } }
  while (head < tail) {
    const i = q[head++], d = out[i] + 1;
    if (d > FIELD_CAP) continue;
    const x = i % W, y = (i / W) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = x + DX[k], ny = y + DY[k];
      if (!isOpen(maze, nx, ny)) continue;
      const j = ny * W + wrapX(nx, W);
      if (stamp[j] !== mark || out[j] > d) { stamp[j] = mark; out[j] = d; q[tail++] = j; }
    }
  }
  return i => (stamp[i] === mark ? out[i] : FAR);
}

/** A bot's input for this frame. memo carries buffers and the last decision between calls. */
export function botInput(game, s, memo = {}) {
  if (s.phase !== 'play') return { x: 0, y: 0, a: false, b: false };
  const maze = game.mazeFor(s.level), W = maze.w, H = maze.h, p = tileOf(s.player, W), here = p.y * W + p.x;
  // Re-plan on entering a tile, and every few frames while a hunter is close.
  if (memo.tile === here && memo.level === s.level && memo.input && (!memo.near || s.frame - memo.frame < 4)) return memo.input;
  if (memo.cells !== W * H) Object.assign(memo, { cells: W * H, hd: new Int16Array(W * H), hs: new Int32Array(W * H), hgen: 0, pd: new Int16Array(W * H), ps: new Int32Array(W * H), pgen: 0, first: new Int8Array(W * H), q: new Int32Array(W * H * 2) });
  const threats = [], prey = new Set();
  for (const h of s.hunters) {
    if (!(h.state === 'active' || h.state === 'leaving') || h.stunT > 0) continue;
    const exit = maze.houses[h.home ?? 0].exit;
    const t = h.state === 'leaving' ? { x: Math.round(exit.x), y: exit.y } : tileOf(h, W);
    if (h.fright && s.frightT > SAFE_FRAMES) { if (h.state === 'active') prey.add(t.y * W + t.x); }
    else {
      threats.push(t);
      // The tile a moving hunter is about to enter is as dangerous as the one it is on.
      if (h.state === 'active' && h.dir >= 0 && isOpen(maze, t.x + DX[h.dir], t.y + DY[h.dir])) threats.push({ x: wrapX(t.x + DX[h.dir], W), y: t.y + DY[h.dir] });
    }
  }
  const hd = field(maze, threats, memo);
  const hunting = prey.size && s.frightT > HUNT_FRAMES;
  const bonusTile = s.bonus ? Math.round(s.bonus.y) * W + Math.floor(s.bonus.x) : -1;
  // BFS from the player through tiles it reaches with a margin before any hunter; first[] keeps each path's first step.
  // With `score`, no goal ends the search: it returns the first step toward the best-scoring tile reached.
  const search = (isGoal, limit = Infinity, { danger = DANGER, margin = memo.margin ?? MARGIN, score = null } = {}) => {
    const pd = memo.pd, ps = memo.ps, first = memo.first, q = memo.q, mark = ++memo.pgen;
    let head = 0, tail = 0, best = -1, bestScore = -Infinity;
    ps[here] = mark; pd[here] = 0; first[here] = -1; q[tail++] = here;
    while (head < tail) {
      const i = q[head++];
      if (i !== here && isGoal(i)) return first[i];
      if (score && i !== here) { const v = score(i, pd[i]); if (v > bestScore) { bestScore = v; best = first[i]; } }
      if (pd[i] >= limit) continue;
      const x = i % W, y = (i / W) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = x + DX[k], ny = y + DY[k];
        if (!isOpen(maze, nx, ny)) continue;
        const j = ny * W + wrapX(nx, W);
        if (ps[j] === mark) continue;
        const d = pd[i] + 1, h = hd(j);
        if (h <= danger || h <= d + margin) continue;
        ps[j] = mark; pd[j] = d; first[j] = i === here ? k : first[i]; q[tail++] = j;
      }
    }
    return best;
  };
  const threatened = hd(here) <= 8;
  let why = 'hunt', dir = hunting ? search(i => prey.has(i), 14) : -1;
  if (dir < 0 && threatened && !s.frightT) { why = 'power'; dir = search(i => s.pellets[i] === 2, 16); }
  if (dir < 0) { why = 'eat'; dir = search(i => s.pellets[i] > 0 || i === bonusTile); }
  // No safe pellet: grab a power pellet the hunters can't reach first, else run for the tile with the biggest lead.
  const relaxed = { danger: 0, margin: 0 };
  if (dir < 0 && !s.frightT) { why = 'power!'; dir = search(i => s.pellets[i] === 2, 20, relaxed); }
  if (dir < 0) { why = 'escape'; dir = search(() => false, 30, { ...relaxed, score: (i, d) => Math.min(hd(i), 40) - d * 0.5 }); }
  if (dir < 0) {
    why = 'flee';
    // Cornered: step to the neighbour farthest from the hunters, preferring to keep going.
    let best = -1;
    for (let k = 0; k < 4; k++) {
      if (!isOpen(maze, p.x + DX[k], p.y + DY[k])) continue;
      const v = Math.min(FAR, hd((p.y + DY[k]) * W + wrapX(p.x + DX[k], W))) * 4 + (k === s.player.dir ? 1 : 0);
      if (v > best) { best = v; dir = k; }
    }
  }
  const input = dir >= 0 ? { x: DX[dir], y: DY[dir], a: false, b: false } : { x: 0, y: 0, a: false, b: false };
  Object.assign(memo, { tile: here, level: s.level, frame: s.frame, input, near: hd(here) <= 10, why });
  void H;
  return input;
}


/** Play level 1 with the bot. Returns metrics; stops at a clear, game over, the time cap or the deadline. */
export function runBot(game, { lives = 3, maxSeconds, deadline = Infinity, margin = MARGIN } = {}) {
  const s = game.createState();
  maxSeconds ??= Math.max(300, s.pelletsTotal * 0.6); // bigger mazes take longer to clear
  s.lives = lives;
  const total = s.pelletsTotal, memo = { margin };
  let deaths = 0, frames = 0, cleared = false, timedOut = false, hunted = 0;
  while (s.status === 'playing' && frames < maxSeconds * 60) {
    if ((frames & 127) === 0 && now() > deadline) { timedOut = true; break; }
    game.step(s, botInput(game, s, memo));
    frames++;
    for (const e of s.events) { if (e.name === 'hurt') deaths++; else if (e.name === 'defeated') hunted++; }
    if (s.phase === 'clear' || s.level > 0) { cleared = true; break; }
  }
  const eaten = cleared ? total : total - s.pelletsLeft;
  return { cleared, pellets: eaten, pelletsTotal: total, clearedPct: Math.round((1000 * eaten) / total) / 10, deaths, huntersEaten: hunted, seconds: Math.round(frames / 6) / 10, score: s.score, timedOut, margin };
}

/** Prove content playable: every level's maze is structurally sound, and the bot can make progress on level 1. */
export function verify(content, { seed = 1, budgetMs = 2000 } = {}) {
  const t0 = now();
  const v = validate(content);
  if (!v.ok) return { ok: false, problems: v.errors, report: { proven: [], ms: Math.round(now() - t0) } };
  const c = v.content, game = createGame(c, { seed });
  const problems = [], proven = [], levels = [];
  c.levels.forEach((lv, i) => {
    const maze = game.mazeFor(i);
    const found = checkMaze(maze, { size: lv.maze.size, powerPellets: lv.maze.powerPellets, tunnels: lv.maze.tunnels }, `levels[${i}].maze`);
    problems.push(...found);
    levels.push({ level: i + 1, size: maze.size, width: maze.w, height: maze.h, houses: maze.houses.length, hunters: game.rosterFor(i).length, style: maze.style, pellets: maze.pellets.length, power: maze.power.length, tunnels: maze.tunnels.length, ok: !found.length });
  });
  if (!problems.length) proven.push('every level maze is mirrored, one tile wide, free of dead ends and fully connected', 'every pellet is reachable from the start', 'the house and door are valid and the tunnels wrap on both sides');
  // The bot always gets 3 lives, so the bound measures the maze and speeds, not the life count.
  // A greedy bot is chaotic: one unlucky pincer can end a run. When the first run misses the bar,
  // a second, more cautious policy gets a try (if the budget allows) and the better run counts.
  const deadline = t0 + budgetMs * 0.9, attempts = [runBot(game, { lives: 3, deadline })];
  if (attempts[0].clearedPct < BOT_BAR && !attempts[0].timedOut && now() < deadline) attempts.push(runBot(game, { lives: 3, deadline, margin: 4 }));
  const bot = { ...attempts.reduce((a, b) => (b.clearedPct > a.clearedPct ? b : a)), attempts: attempts.length, size: game.mazeFor(0).size, bar: BOT_BAR };
  if (bot.cleared) proven.push('a greedy bot clears level 1');
  if (!bot.timedOut && bot.clearedPct < BOT_BAR) problems.push({ code: 'too_hard', path: 'levels[0]', message: `the bot cleared only ${bot.clearedPct}% of level 1 with 3 lives`, hint: 'raise density, add a power pellet, lower the speed or use a smaller size' });
  const ms = Math.round(now() - t0);
  return { ok: !problems.length, problems, report: { proven, levels, bot, seed, ms, budgetMs, overBudget: ms > budgetMs } };
}
