// Maze kit verification: structural proofs for every level's maze, and a bot
// that plays level 1 headless with greedy, danger-avoiding pathing (BFS to the
// nearest pellet around tiles near live hunters, hunting frightened ones).
import { validate } from './content.js';
import { createGame, DX, DY, tileOf } from './game.js';
import { checkMaze, isOpen, wrapX, W, H, EXIT } from './maze.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const DANGER = 3, HUNT_FRAMES = 90, SAFE_FRAMES = 60;

/** Multi-source BFS distance (in tiles) over corridors from the given tiles. */
function field(maze, sources, out, queue) {
  out.fill(32767);
  let head = 0, tail = 0;
  for (const t of sources) { const i = t.y * W + t.x; if (out[i] !== 0) { out[i] = 0; queue[tail++] = i; } }
  while (head < tail) {
    const i = queue[head++], x = i % W, y = (i / W) | 0, d = out[i] + 1;
    for (let k = 0; k < 4; k++) {
      const nx = x + DX[k], ny = y + DY[k];
      if (!isOpen(maze, nx, ny)) continue;
      const j = ny * W + wrapX(nx);
      if (out[j] > d) { out[j] = d; queue[tail++] = j; }
    }
  }
  return out;
}

/** A bot's input for this frame. memo carries buffers and the last decision between calls. */
export function botInput(game, s, memo = {}) {
  if (s.phase !== 'play') return { x: 0, y: 0, a: false, b: false };
  const maze = game.mazeFor(s.level), p = tileOf(s.player), here = p.y * W + p.x;
  if (memo.tile === here && memo.level === s.level && s.frame - memo.frame < 4 && memo.input) return memo.input;
  memo.hd ??= new Int16Array(W * H); memo.pd ??= new Int16Array(W * H); memo.first ??= new Int8Array(W * H); memo.q ??= new Int32Array(W * H * 2);
  const threats = [], prey = new Set();
  for (const h of s.hunters) {
    const live = h.state === 'active' || h.state === 'leaving';
    if (!live) continue;
    const t = h.state === 'leaving' ? { x: Math.round(EXIT.x), y: EXIT.y } : tileOf(h);
    if (h.fright && s.frightT > SAFE_FRAMES) { if (h.state === 'active') prey.add(t.y * W + t.x); }
    else {
      threats.push(t);
      // The tile a moving hunter is about to enter is as dangerous as the one it is on.
      if (h.state === 'active' && h.dir >= 0 && isOpen(maze, t.x + DX[h.dir], t.y + DY[h.dir])) threats.push({ x: wrapX(t.x + DX[h.dir]), y: t.y + DY[h.dir] });
    }
  }
  const hd = field(maze, threats, memo.hd, memo.q);
  const hunting = prey.size && s.frightT > HUNT_FRAMES;
  // BFS from the player around danger; first[] remembers the first step of each path.
  const bonusTile = s.bonus ? Math.round(s.bonus.y) * W + Math.floor(s.bonus.x) : -1;
  const search = isGoal => {
    const pd = memo.pd.fill(32767), first = memo.first.fill(-1), q = memo.q;
    let head = 0, tail = 0;
    pd[here] = 0; q[tail++] = here;
    while (head < tail) {
      const i = q[head++], x = i % W, y = (i / W) | 0;
      if (i !== here && isGoal(i, pd[i])) return first[i];
      for (let k = 0; k < 4; k++) {
        const nx = x + DX[k], ny = y + DY[k];
        if (!isOpen(maze, nx, ny)) continue;
        const j = ny * W + wrapX(nx);
        if (pd[j] !== 32767 || hd[j] <= DANGER) continue;
        pd[j] = pd[i] + 1; first[j] = i === here ? k : first[i]; q[tail++] = j;
      }
    }
    return -1;
  };
  let dir = hunting ? search((i, d) => prey.has(i) && d < 14) : -1;
  if (dir < 0) dir = search(i => s.pellets[i] > 0 || i === bonusTile);
  if (dir < 0) {
    // Cornered: step to the neighbour farthest from the hunters, preferring to keep going.
    let best = -1;
    for (let k = 0; k < 4; k++) {
      if (!isOpen(maze, p.x + DX[k], p.y + DY[k])) continue;
      const v = hd[(p.y + DY[k]) * W + wrapX(p.x + DX[k])] * 4 + (k === s.player.dir ? 1 : 0);
      if (v > best) { best = v; dir = k; }
    }
  }
  const input = dir >= 0 ? { x: DX[dir], y: DY[dir], a: false, b: false } : { x: 0, y: 0, a: false, b: false };
  Object.assign(memo, { tile: here, level: s.level, frame: s.frame, input });
  return input;
}

/** Play level 1 with the bot. Returns metrics; stops at a clear, game over, the time cap or the deadline. */
export function runBot(game, { lives = 3, maxSeconds = 300, deadline = Infinity } = {}) {
  const s = game.createState();
  s.lives = lives;
  const total = s.pelletsTotal, memo = {};
  let deaths = 0, frames = 0, cleared = false, timedOut = false, hunted = 0;
  while (s.status === 'playing' && frames < maxSeconds * 60) {
    if ((frames & 127) === 0 && now() > deadline) { timedOut = true; break; }
    game.step(s, botInput(game, s, memo));
    frames++;
    for (const e of s.events) { if (e.name === 'hurt') deaths++; else if (e.name === 'defeated') hunted++; }
    if (s.phase === 'clear' || s.level > 0) { cleared = true; break; }
  }
  const eaten = cleared ? total : total - s.pelletsLeft;
  return { cleared, pellets: eaten, pelletsTotal: total, clearedPct: Math.round((1000 * eaten) / total) / 10, deaths, huntersEaten: hunted, seconds: Math.round(frames / 6) / 10, score: s.score, timedOut };
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
    const found = checkMaze(maze, { powerPellets: lv.maze.powerPellets, tunnels: lv.maze.tunnels }, `levels[${i}].maze`);
    problems.push(...found);
    levels.push({ level: i + 1, style: maze.style, pellets: maze.pellets.length, power: maze.power.length, tunnels: maze.tunnels.length, ok: !found.length });
  });
  if (!problems.length) proven.push('every level maze is mirrored, one tile wide, free of dead ends and fully connected', 'every pellet is reachable from the start', 'the house and door are valid and the tunnels wrap on both sides');
  // The bot always gets 3 lives, so the bound measures the maze and speeds, not the life count.
  const bot = runBot(game, { lives: 3, deadline: t0 + budgetMs * 0.9 });
  if (bot.cleared) proven.push('a greedy bot clears level 1');
  if (!bot.timedOut && bot.clearedPct < 60) problems.push({ code: 'too_hard', path: 'levels[0]', message: `the bot cleared only ${bot.clearedPct}% of level 1 with 3 lives`, hint: 'raise density, add a power pellet or lower the speed' });
  const ms = Math.round(now() - t0);
  return { ok: !problems.length, problems, report: { proven, levels, bot, seed, ms, budgetMs, overBudget: ms > budgetMs } };
}
