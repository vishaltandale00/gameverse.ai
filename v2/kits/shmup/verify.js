// Shmup-kit verification: structural checks (every wave spawns and reaches the
// screen, bosses are beatable with the base weapon inside the time limit) and a
// bot that plays stage 1 headless. The bot dodges by sampling candidate moves
// against predicted bullet and body positions, and shoots the nearest enemy.
import { validate } from './content.js';
import { createGame, HITBOX, BODY, DT, TIMING } from './game.js';

const now = () => globalThis.performance?.now?.() ?? Date.now();
const HORIZONS = [3, 7, 12, 18, 26], WEIGHTS = [8, 6, 4, 2.5, 1.5];
const DIRS = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** Danger of moving with (vx, vy) px/s from the player's position. */
function danger(s, vx, vy) {
  const p = s.player, hb = HITBOX[s.mode], br = BODY[s.mode];
  let cost = 0;
  for (let h = 0; h < HORIZONS.length; h++) {
    const t = HORIZONS[h] * DT, w = WEIGHTS[h];
    const qx = Math.min(s.W - 10, Math.max(10, p.x + vx * t)), qy = Math.min(s.H - 10, Math.max(10, p.y + vy * t));
    for (const b of s.ebullets) {
      const dx = b.x + b.vx * t - qx, dy = b.y + b.vy * t - qy, rr = hb + b.r + 5;
      if (dx * dx + dy * dy < rr * rr) cost += w;
    }
    for (const e of s.enemies) {
      const dx = e.x + e.vx * t - qx, dy = e.y + e.vy * t - qy, rr = e.r + br + 8;
      if (dx * dx + dy * dy < rr * rr) cost += w * 1.5;
      if (e.segs) for (let k = 0; k < e.segs.length; k += 4) { const sx = e.segs[k] - qx, sy = e.segs[k + 1] - qy; if (sx * sx + sy * sy < (br + 12) ** 2) cost += w; }
      if (e.mv === 'gravity') { const d = Math.hypot(e.x - qx, e.y - qy); if (d < 90) cost += w * (1 - d / 90); }
    }
    const b = s.boss;
    if (b && b.st !== 'dying' && b.st !== 'escape') { const dx = b.x + b.vx * t - qx, dy = b.y + b.vy * t - qy, rr = b.r + br + 14; if (dx * dx + dy * dy < rr * rr) cost += w * 2; }
  }
  return cost;
}

function shooterInput(s, game) {
  const p = s.player, sp = game.content.player.speed;
  const fixed = s.mode === 'fixed', arena = s.mode === 'twinstick';
  // Goal position.
  let gx = p.x, gy = p.y;
  if (arena) { gx = s.W / 2; gy = s.H / 2; }
  else {
    let best = null, bd = Infinity;
    for (const e of s.enemies) { if (!e.onScreen || e.y > p.y - 20) continue; const d = Math.abs(e.x - p.x) + (s.H - e.y) * 0.15; if (d < bd) { bd = d; best = e; } }
    if (s.boss && s.boss.st === 'fight') best = s.boss;
    if (best) gx = best.x;
    gy = s.mode === 'vertical' ? s.H - 70 : p.y;
  }
  let pick = [0, 0], low = Infinity;
  for (const [dx0, dy0] of DIRS) {
    if (fixed && dy0) continue;
    const n = dx0 && dy0 ? Math.SQRT1_2 : 1, vx = dx0 * sp * n, vy = dy0 * sp * n;
    let c = danger(s, vx, vy) * 10;
    const qx = p.x + vx * 0.2, qy = p.y + vy * 0.2;
    if (arena) {
      let near = Infinity;
      for (const e of s.enemies) near = Math.min(near, Math.hypot(e.x - qx, e.y - qy) - e.r);
      if (s.boss) near = Math.min(near, Math.hypot(s.boss.x - qx, s.boss.y - qy) - s.boss.r);
      c += Math.max(0, 150 - near) * 0.12 + Math.hypot(qx - gx, qy - gy) * 0.01;
      const wall = Math.min(qx, s.W - qx, qy, s.H - qy);
      if (wall < 50) c += (50 - wall) * 0.15;
    } else c += Math.abs(qx - gx) * 0.03 + Math.abs(qy - gy) * 0.02;
    if (c < low) { low = c; pick = [dx0, dy0]; }
  }
  const bomb = low >= 60 && s.bombs > 0 && p.invuln <= 0;
  return { x: pick[0], y: pick[1], a: true, b: bomb };
}

function wrapDelta(d, size) { return d > size / 2 ? d - size : d < -size / 2 ? d + size : d; }
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

// Asteroids: sample rotate x thrust actions, roll the inertial ship forward, and
// score each against wrapped predictions of rocks, enemies, bullets and the boss.
const AST_ACTIONS = [[0, 0], [-1, 0], [1, 0], [0, -1], [-1, -1], [1, -1]];
const AST_CHECKS = [4, 8, 13, 19, 26, 34];
function asteroidsInput(s, game) {
  const p = s.player, W = s.W, H = s.H, speedCap = game.content.player.speed * 1.5;
  const bodies = [];
  for (const e of s.enemies) bodies.push([e.x, e.y, e.vx, e.vy, e.r * 0.85 + 9 + 10]);
  for (const b of s.ebullets) bodies.push([b.x, b.y, b.vx, b.vy, b.r + 7 + 8]);
  const boss = s.boss;
  if (boss && boss.st !== 'dying' && boss.st !== 'escape') bodies.push([boss.x, boss.y, boss.vx, boss.vy, boss.r * 0.8 + 9 + 10]);
  let target = null, dBest = Infinity;
  const tgt = o => { const rx = wrapDelta(o.x - p.x, W), ry = wrapDelta(o.y - p.y, H), d = Math.hypot(rx, ry); if (d < dBest) { dBest = d; target = { rx, ry, vx: o.vx, vy: o.vy, d }; } };
  for (const e of s.enemies) tgt(e);
  if (boss && boss.st === 'fight') tgt(boss);
  const aimAt = target ? Math.atan2(target.ry + target.vy * target.d / 520, target.rx + target.vx * target.d / 520) : p.ang;
  let best = AST_ACTIONS[0], low = Infinity;
  for (const action of AST_ACTIONS) {
    const [rx, th] = action;
    let x = p.x, y = p.y, vx = p.vx, vy = p.vy, ang = p.ang, cost = 0, ci = 0;
    for (let f = 1; f <= AST_CHECKS[AST_CHECKS.length - 1]; f++) {
      ang += rx * 4.6 * DT;
      if (th) { vx += Math.cos(ang) * 300 * DT; vy += Math.sin(ang) * 300 * DT; }
      vx *= 1 - 0.55 * DT; vy *= 1 - 0.55 * DT;
      const v = Math.hypot(vx, vy);
      if (v > speedCap) { vx *= speedCap / v; vy *= speedCap / v; }
      x += vx * DT; y += vy * DT;
      if (f !== AST_CHECKS[ci]) continue;
      const t = f * DT, w = 6 / (ci + 1);
      for (const [bx, by, bvx, bvy, r] of bodies) {
        const dx = wrapDelta(bx + bvx * t - x, W), dy = wrapDelta(by + bvy * t - y, H);
        if (dx * dx + dy * dy < r * r) cost += w * 10;
      }
      ci++;
    }
    // Keep room: stay well clear of the boss and of anything close at the end of the rollout.
    const tEnd = AST_CHECKS[AST_CHECKS.length - 1] * DT;
    for (const [bx, by, bvx, bvy, r] of bodies) {
      if (r < 20 && bodies.length > 40) continue;
      const d = Math.hypot(wrapDelta(bx + bvx * tEnd - x, W), wrapDelta(by + bvy * tEnd - y, H)) - r;
      if (d < 60) cost += (60 - d) * 0.03;
    }
    if (boss && boss.st !== 'dying') { const d = Math.hypot(wrapDelta(boss.x - x, W), wrapDelta(boss.y - y, H)); if (d < 150) cost += (150 - d) * 0.03; }
    cost += (target ? Math.abs(angDiff(ang, aimAt)) * 0.8 : 0) + Math.hypot(vx, vy) * 0.006 + (th ? 0.15 : 0);
    if (cost < low) { low = cost; best = action; }
  }
  const out = { x: best[0], y: best[1], a: !!target && Math.abs(angDiff(p.ang, aimAt)) < 0.25, b: false };
  if (low >= 30) { if (s.bombs > 0 && p.invuln <= 0) out.b = true; else if (p.hyperCd <= 0 && low >= 60) out.y = 1; }
  if (!best[0] && !best[1] && target && low < 5 && Math.abs(angDiff(p.ang, aimAt)) > 0.06) out.x = Math.sign(angDiff(p.ang, aimAt));
  return out;
}

/** The bot's held input for this state of this game. */
export function botInput(s, game) {
  if (!s.player.alive) return { x: 0, y: 0, a: false, b: false };
  return s.mode === 'asteroids' ? asteroidsInput(s, game) : shooterInput(s, game);
}

/** Rough length of a stage in frames, for the survival ratio. */
function expectedFrames(C, i) {
  const st = C.stages[i], last = st.waves.length ? st.waves[st.waves.length - 1].at : 0;
  let sec = TIMING.intro / 60 + last + (st.mode === 'asteroids' ? 20 + st.rocks * 4 : 10);
  const boss = C.bosses.find(b => b.id === st.boss);
  if (boss) sec += TIMING.warn / 60 + Math.min(TIMING.bossLimit / 60, boss.hp / (C.player.fireRate * 0.6)) + 4;
  return Math.round(sec * 60);
}

/** Run one stage with the bot. */
export function playStage(content, { seed = 1, stage = 0, deadline = Infinity, maxFrames } = {}) {
  const game = createGame(content, { seed });
  const s = game.createState({ stage });
  const cap = maxFrames ?? expectedFrames(content, stage) * 3;
  let frames = 0, cleared = false;
  while (frames < cap && s.status === 'playing') {
    game.step(s, botInput(s, game));
    frames++;
    if (s.phase === 'clear' && s.stage === stage) { cleared = true; break; }
    if ((frames & 255) === 0 && now() > deadline) break;
  }
  return { state: s, frames, cleared, expected: expectedFrames(content, stage), timedOut: !cleared && s.status === 'playing' };
}

/** Spawn audit: run a stage with an invulnerable idle player and count what appears. */
function spawnAudit(content, i, seed) {
  const game = createGame(content, { seed });
  const s = game.createState({ stage: i });
  const st = content.stages[i];
  const expected = st.waves.reduce((n, w) => n + w.count, 0) + (st.mode === 'asteroids' ? st.rocks : 0);
  const seen = new Set();
  const frames = TIMING.intro + Math.round(((st.waves.at(-1)?.at || 0) + 20) * 60);
  for (let f = 0; f < frames && s.status === 'playing'; f++) {
    s.player.invuln = 999; s.player.shield = false; s.lives = 9;
    game.step(s, { x: 0, y: 0, a: false, b: false });
    for (const e of s.enemies) if (e.onScreen) seen.add(e.id);
  }
  return { expected, spawned: s.stats.spawned, seen: seen.size };
}

export function verify(content, { seed = 1, budgetMs = 2000 } = {}) {
  const t0 = now(), deadline = t0 + budgetMs * 0.9;
  const checked = validate(content);
  const problems = checked.errors.map(e => ({ code: e.code, path: e.path, message: e.message }));
  const proven = [];
  if (!checked.ok) return { ok: false, problems, report: { proven, ms: Math.round(now() - t0) } };
  const C = checked.content;
  proven.push('content validates');

  // Bosses: the base weapon at 50% efficiency must finish each boss inside the time limit.
  const baseDps = C.player.fireRate * 1;
  for (const st of C.stages) {
    const boss = C.bosses.find(b => b.id === st.boss);
    if (!boss) continue;
    const need = boss.hp / (baseDps * 0.5);
    if (need > TIMING.bossLimit / 60) problems.push({ code: 'boss_too_tough', path: `$.bosses.${boss.id}`, message: `${boss.name} needs ~${Math.round(need)} s of fire with the base weapon; the limit is ${TIMING.bossLimit / 60} s` });
  }
  if (!problems.length) proven.push('every boss is beatable with the base weapon inside the time limit');

  // Waves: every wave spawns and reaches the screen.
  const waves = [];
  C.stages.forEach((st, i) => {
    const a = spawnAudit(C, i, seed);
    waves.push({ stage: i + 1, ...a });
    if (a.spawned < a.expected) problems.push({ code: 'unspawned', path: `$.stages[${i}].waves`, message: `only ${a.spawned} of ${a.expected} enemies spawned in '${st.name}'` });
    else if (a.seen < a.spawned * 0.9) problems.push({ code: 'offscreen', path: `$.stages[${i}].waves`, message: `${a.spawned - a.seen} enemies in '${st.name}' never reach the screen` });
  });
  if (!problems.some(p => p.code === 'unspawned' || p.code === 'offscreen')) proven.push('every wave spawns and reaches the screen');

  // Bot plays stage 1.
  const run = playStage(C, { seed, stage: 0, deadline });
  const s = run.state;
  const survived = run.cleared ? 1 : Math.min(1, run.frames / run.expected);
  const bot = {
    cleared: run.cleared, seconds: +(run.frames / 60).toFixed(1), expectedSeconds: +(run.expected / 60).toFixed(1), survived: +survived.toFixed(2),
    deaths: s.stats.deaths, kills: s.stats.kills, spawned: s.stats.spawned, killPct: s.stats.spawned ? Math.round(100 * s.stats.kills / s.stats.spawned) : 0,
    bombsUsed: s.stats.bombsUsed, score: s.score, livesLeft: s.lives, status: s.status, timedOut: run.timedOut, reason: s.reason || '',
  };
  if (run.cleared) proven.push('the bot clears stage 1');
  else if (survived >= 0.5) proven.push(`the bot survives ${Math.round(survived * 100)}% of stage 1`);
  else problems.push({ code: 'bot_failed', path: '$.stages[0]', message: `the bot lasted ${bot.seconds} s of ~${bot.expectedSeconds} s in stage 1 (${s.reason || 'timed out'})` });

  return { ok: !problems.length, problems, report: { proven, bot, waves, ms: Math.round(now() - t0) } };
}
