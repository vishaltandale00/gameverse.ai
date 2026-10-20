// Breakout / Arkanoid: paddle, ball launch, brick layouts with hard, metal,
// explosive, sliding and prize bricks, angle control from where the ball hits
// the paddle, power-up capsules, a speed ramp and an optional boss.
import { createWorld, addBody, stepWorld, removeBody, bodyIndex, findBody } from '../physics.js';
import { random } from '../../../kernel/rng.js';
import { emit, addScore, loseLife, clearLevel, banner } from '../flow.js';

export const BRICK_W = 1, BRICK_H = 0.5, TOP = 1.6, BALL_R = 0.18;
const SPEED = { slow: 8.5, normal: 10, fast: 11.5 };
const PADDLE_SPEED = 19, PADDLE_H = 0.34, PADDLE_W = { narrow: 1.6, normal: 2.2, wide: 2.9 };
const POWER_TIME = { wide: 16, catch: 16, laser: 14, slow: 10 };
const POINTS = { n: 50, s: 80, p: 60, x: 70, 2: 100, 3: 150, 4: 200, 5: 250 };

export function fieldSize(level) {
  const cols = level.breakout.rows[0]?.length || 13;
  return { w: cols, h: Math.max(16, Math.round(cols * 1.25)) };
}

export function build(S, level) {
  const cfg = level.breakout, { w, h } = fieldSize(level);
  const world = createWorld({ gy: 0, substeps: 4, iterations: 3, cell: 2, sleep: false });
  const wall = { e: 1, mu: 0, tag: 'wall' };
  addBody(world, { ...wall, shape: 'seg', x1: 0, y1: h + 4, x2: 0, y2: 0 });
  addBody(world, { ...wall, shape: 'seg', x1: 0, y1: 0, x2: w, y2: 0 });
  addBody(world, { ...wall, shape: 'seg', x1: w, y1: 0, x2: w, y2: h + 4 });
  cfg.rows.forEach((row, ry) => [...row].forEach((ch, cx) => {
    if (ch === '.') return;
    const x = cx * BRICK_W + BRICK_W / 2, y = TOP + ry * BRICK_H + BRICK_H / 2;
    const hp = ch >= '2' && ch <= '5' ? Number(ch) : 1;
    const data = { kind: ch, hp, max: hp, row: ry, col: cx };
    if (ch === 's') {
      // Slides along the empty run of its row.
      let lo = cx, hi = cx;
      while (lo > 0 && row[lo - 1] === '.') lo--;
      while (hi < row.length - 1 && row[hi + 1] === '.') hi++;
      data.lo = lo * BRICK_W + BRICK_W / 2; data.hi = hi * BRICK_W + BRICK_W / 2;
      addBody(world, { shape: 'box', type: 'kinematic', w: BRICK_W - 0.04, h: BRICK_H - 0.04, x, y, vx: hi > lo ? 1.6 : 0, e: 1, mu: 0, tag: 'brick', data });
    } else addBody(world, { shape: 'box', type: 'static', w: BRICK_W - 0.04, h: BRICK_H - 0.04, x, y, e: 1, mu: 0, tag: 'brick', data });
  }));
  const paddle = addBody(world, { shape: 'box', type: 'kinematic', w: PADDLE_W[cfg.paddle] || 2.2, h: PADDLE_H, x: w / 2, y: h - 1.4, e: 1, mu: 0, tag: 'paddle' });
  S.world = world;
  S.m = {
    w, h, paddle: paddle.id, pw: PADDLE_W[cfg.paddle] || 2.2, basePw: PADDLE_W[cfg.paddle] || 2.2, balls: [], held: null, base: SPEED[cfg.speed], ramp: 0, capsules: [], lasers: [], laserCd: 0,
    powers: {}, boss: null, shots: [], bricksLeft: 0, cfg: { powers: cfg.powers, powerChance: cfg.powerChance }, hazard: S.cast.hazard,
  };
  if (cfg.boss > 0) {
    const b = addBody(world, { shape: 'box', type: 'kinematic', w: 3.6, h: 2.2, x: w / 2, y: TOP + cfg.rows.length * BRICK_H + 2, e: 1, mu: 0, tag: 'boss', data: { hp: cfg.boss, max: cfg.boss } });
    S.m.boss = { id: b.id, hp: cfg.boss, max: cfg.boss, t: 0, fire: 2.5, flash: 0, y: b.y };
  }
  countBricks(S);
  S.m.rows = cfg.rows.length;
  serve(S);
}

function countBricks(S) { S.m.bricksLeft = S.world.bodies.filter(b => b.tag === 'brick' && !b.dead && b.data.kind !== 'm').length; }

function serve(S) {
  const m = S.m, p = findBody(S.world, m.paddle);
  const ball = addBody(S.world, { shape: 'circle', r: BALL_R, x: p.x, y: p.y - PADDLE_H / 2 - BALL_R - 0.02, e: 1, mu: 0, gs: 0, adamp: 0, bullet: true, tag: 'ball', mask: 0xffff });
  m.balls = [ball.id];
  m.held = { id: ball.id, off: 0.3, t: 0 };
  ball.data.held = true;
}

const speedOf = m => Math.min(m.base * 1.55, m.base * (1 + m.ramp)) * (m.powers.slow > 0 ? 0.72 : 1);

function setPaddleWidth(S, width) {
  const m = S.m, old = findBody(S.world, m.paddle);
  removeBody(S.world, old);
  const p = addBody(S.world, { shape: 'box', type: 'kinematic', w: width, h: PADDLE_H, x: old.x, y: old.y, e: 1, mu: 0, tag: 'paddle' });
  m.paddle = p.id; m.pw = width;
}

function launch(S, ball, dirX) {
  const m = S.m, sp = speedOf(m), ang = Math.max(-0.9, Math.min(0.9, dirX));
  ball.vx = Math.sin(ang) * sp; ball.vy = -Math.cos(ang) * sp; ball.data.held = false;
  m.held = null;
  emit(S, 'shoot', { x: ball.x, y: ball.y });
}

export function breakBrick(S, brick, by) {
  const m = S.m;
  if (brick.dead) return;
  const d = brick.data;
  removeBody(S.world, brick);
  addScore(S, POINTS[d.kind] || 50, brick.x, brick.y);
  emit(S, 'break', { x: brick.x, y: brick.y, kind: d.kind, row: d.row, by });
  m.ramp = Math.min(0.55, m.ramp + 0.012);
  const cfg = m.cfg;
  if (cfg.powers.length && (d.kind === 'p' || random(S) < cfg.powerChance)) {
    const kind = cfg.powers[Math.floor(random(S) * cfg.powers.length)];
    m.capsules.push({ kind, x: brick.x, y: brick.y, t: 0 });
  }
  if (d.kind === 'x') {
    emit(S, 'explode', { x: brick.x, y: brick.y, r: 1.4 });
    for (const o of S.world.bodies) if (o.tag === 'brick' && !o.dead && o.data.kind !== 'm' && Math.abs(o.x - brick.x) < 1.3 && Math.abs(o.y - brick.y) < 0.8) breakBrick(S, o, 'blast');
  }
}

function hitBrick(S, brick, x, y) {
  const d = brick.data;
  if (d.kind === 'm') { emit(S, 'hit', { x, y, kind: 'metal' }); return; }
  d.hp--;
  if (d.hp <= 0) breakBrick(S, brick, 'ball');
  else { emit(S, 'hit', { x, y, kind: 'hard', hp: d.hp }); addScore(S, 10, x, y, true); }
}

function applyPower(S, kind) {
  const m = S.m;
  emit(S, 'collect', { kind, x: findBody(S.world, m.paddle).x, y: m.h - 1.4 });
  emit(S, 'power', { kind });
  addScore(S, 200);
  if (kind === 'life') { S.lives++; emit(S, 'extra_life', {}); return; }
  if (kind === 'multiball') {
    banner(S, 'MULTIBALL!', 'power');
    const by = bodyIndex(S.world), src = m.balls.map(id => by.get(id)).filter(b => b && !b.data.held);
    if (m.held) { const b = by.get(m.held.id); if (b) launch(S, b, m.held.off); src.push(b); }
    for (const b of src.slice(0, 3)) for (const turn of [-0.42, 0.42]) {
      const c = Math.cos(turn), s = Math.sin(turn);
      const nb = addBody(S.world, { shape: 'circle', r: BALL_R, x: b.x, y: b.y, vx: c * b.vx - s * b.vy, vy: s * b.vx + c * b.vy, e: 1, mu: 0, gs: 0, adamp: 0, bullet: true, tag: 'ball' });
      m.balls.push(nb.id);
    }
    return;
  }
  if (kind === 'wide' && !(m.powers.wide > 0)) setPaddleWidth(S, m.basePw * 1.5);
  if (kind === 'laser' || kind === 'catch') { delete m.powers.laser; delete m.powers.catch; }
  m.powers[kind] = POWER_TIME[kind];
}

export function step(S, level, inp, press) {
  const m = S.m, world = S.world, dt = 1 / 60;
  // Power timers.
  for (const k of Object.keys(m.powers)) {
    m.powers[k] -= dt;
    if (m.powers[k] <= 0) { delete m.powers[k]; if (k === 'wide') setPaddleWidth(S, m.basePw); emit(S, 'power_end', { kind: k }); }
  }
  let by = bodyIndex(world);
  const paddle = by.get(m.paddle);
  // Paddle (kinematic: velocity drives it so the ball feels its motion).
  const half = m.pw / 2, target = Math.max(half, Math.min(m.w - half, paddle.x + inp.x * PADDLE_SPEED * dt));
  paddle.vx = (target - paddle.x) / dt; paddle.vy = 0;
  // Sliding bricks ping-pong in their lane.
  for (const b of world.bodies) if (b.tag === 'brick' && b.data.kind === 's' && !b.dead) {
    if (b.x >= b.data.hi && b.vx > 0) b.vx = -1.6; else if (b.x <= b.data.lo && b.vx < 0) b.vx = 1.6;
  }
  // Boss drifts and fires.
  if (m.boss) {
    const boss = by.get(m.boss.id);
    m.boss.t += dt; m.boss.flash = Math.max(0, m.boss.flash - dt);
    if (boss) {
      const tx = m.w / 2 + Math.sin(m.boss.t * 0.7) * (m.w / 2 - 2.4);
      boss.vx = (tx - boss.x) / dt; boss.vy = 0;
      m.boss.fire -= dt;
      if (m.boss.fire <= 0) {
        m.boss.fire = 1.6 + random(S) * 1.4;
        const dx = paddle.x - boss.x, dy = paddle.y - boss.y, l = Math.hypot(dx, dy);
        m.shots.push({ x: boss.x, y: boss.y + 1.2, vx: dx / l * 5, vy: dy / l * 5 });
        emit(S, 'shoot', { x: boss.x, y: boss.y + 1.2, by: 'boss' });
      }
    }
  }
  // Held ball rides the paddle.
  if (m.held) {
    const ball = by.get(m.held.id);
    m.held.t += dt;
    ball.x = paddle.x + m.held.off * half; ball.y = paddle.y - PADDLE_H / 2 - BALL_R - 0.02; ball.vx = ball.vy = 0;
    if (press.a || (m.powers.catch > 0 && m.held.t > 3)) launch(S, ball, m.held.off * 0.9 + inp.x * 0.25);
  }
  // Lasers.
  m.laserCd = Math.max(0, m.laserCd - dt);
  if (m.powers.laser > 0 && (press.a || (inp.a && m.laserCd <= 0)) && !m.held && m.laserCd <= 0) {
    m.laserCd = 0.28;
    for (const side of [-1, 1]) m.lasers.push({ x: paddle.x + side * (half - 0.15), y: paddle.y - 0.3 });
    emit(S, 'shoot', { x: paddle.x, y: paddle.y - 0.3, kind: 'laser' });
  }
  stepWorld(world, dt);
  by = bodyIndex(world);
  // Contacts: paddle steering, bricks, boss.
  const sp = speedOf(m);
  for (const c of world.contacts) {
    const A = by.get(c.a), B = by.get(c.b);
    if (!A || !B) continue;
    const ball = A.tag === 'ball' ? A : B.tag === 'ball' ? B : null, other = ball === A ? B : A;
    if (!ball || !c.begin) continue;
    if (other.tag === 'paddle') {
      const p = by.get(m.paddle) || other, off = Math.max(-1, Math.min(1, (ball.x - p.x) / (m.pw / 2)));
      if (m.powers.catch > 0) { m.held = { id: ball.id, off, t: 0 }; ball.data.held = true; emit(S, 'land', { x: ball.x, y: ball.y }); continue; }
      const ang = off * 1.05 + p.vx * 0.012;
      ball.vx = Math.sin(ang) * sp; ball.vy = -Math.abs(Math.cos(ang) * sp);
      emit(S, 'bounce', { x: ball.x, y: ball.y + BALL_R, off });
    } else if (other.tag === 'brick') hitBrick(S, other, c.x, c.y);
    else if (other.tag === 'boss') {
      m.boss.hp--; m.boss.flash = 0.15; other.data.hp = m.boss.hp;
      emit(S, 'hit', { x: c.x, y: c.y, kind: 'boss', hp: m.boss.hp });
      addScore(S, 100, c.x, c.y);
      if (m.boss.hp <= 0) { emit(S, 'defeated', { x: other.x, y: other.y, kind: 'boss', big: true }); addScore(S, 5000, other.x, other.y); removeBody(world, other); m.boss = { ...m.boss, dead: true }; }
    } else if (other.tag === 'wall') emit(S, 'wall', { x: c.x, y: c.y });
  }
  if (m.boss?.dead) m.boss = null;
  // A mod's guard (shield) bounces balls back up from the bottom instead of losing them.
  if (m.guard > 0) {
    m.guard = Math.max(0, m.guard - dt);
    for (const id of m.balls) { const b = by.get(id); if (b && !b.data.held && b.y > m.h - 0.5 && b.vy > 0) { b.vy = -Math.abs(b.vy); b.y = m.h - 0.5; emit(S, 'shielded', { x: b.x, y: b.y }); } }
  }
  // Keep every free ball at the ramped speed and never too flat.
  let lowest = 0;
  for (const id of m.balls) {
    const b = by.get(id);
    if (!b || b.data.held) continue;
    let v = Math.hypot(b.vx, b.vy) || 1;
    let vx = b.vx / v, vy = b.vy / v;
    if (Math.abs(vy) < 0.26) { vy = vy < 0 ? -0.26 : 0.26; vx = Math.sign(vx || 1) * Math.sqrt(1 - vy * vy); }
    b.vx = vx * sp; b.vy = vy * sp;
    lowest = Math.max(lowest, b.y);
  }
  m.ramp = Math.min(0.55, m.ramp + dt * 0.0025);
  // Lasers move up and break the first brick they touch.
  for (const l of m.lasers) {
    l.y -= 30 * dt;
    for (const b of world.bodies) {
      if (b.dead || (b.tag !== 'brick' && b.tag !== 'boss')) continue;
      const hw = b.tag === 'boss' ? 1.8 : BRICK_W / 2, hh = b.tag === 'boss' ? 1.1 : BRICK_H / 2;
      if (Math.abs(l.x - b.x) < hw && Math.abs(l.y - b.y) < hh) {
        l.dead = true;
        if (b.tag === 'boss') { m.boss.hp--; m.boss.flash = 0.12; emit(S, 'hit', { x: l.x, y: l.y, kind: 'boss' }); if (m.boss.hp <= 0) { emit(S, 'defeated', { x: b.x, y: b.y, kind: 'boss', big: true }); addScore(S, 5000, b.x, b.y); removeBody(world, b); m.boss = null; } }
        else hitBrick(S, b, l.x, l.y);
        break;
      }
    }
    if (l.y < 0) l.dead = true;
  }
  m.lasers = m.lasers.filter(l => !l.dead);
  // Capsules fall; the paddle catches them.
  const p = by.get(m.paddle);
  for (const cap of m.capsules) {
    cap.y += 4.2 * dt; cap.t += dt;
    if (Math.abs(cap.x - p.x) < m.pw / 2 + 0.45 && Math.abs(cap.y - p.y) < 0.4) { cap.dead = true; applyPower(S, cap.kind); }
    else if (cap.y > m.h + 1) cap.dead = true;
  }
  m.capsules = m.capsules.filter(c => !c.dead);
  // Boss shots.
  for (const s of m.shots) {
    s.x += s.vx * dt; s.y += s.vy * dt;
    if (Math.abs(s.x - p.x) < m.pw / 2 + 0.25 && Math.abs(s.y - p.y) < 0.4) {
      s.dead = true;
      if (m.guard > 0) { emit(S, 'shielded', { x: s.x, y: s.y }); continue; }
      emit(S, 'hurt', { x: s.x, y: s.y, by: 'shot' }); loseBall(S, `Hit by the ${m.hazard}`); return;
    }
    if (s.y > m.h + 1) s.dead = true;
  }
  m.shots = m.shots.filter(s => !s.dead);
  // Balls that fall past the paddle are lost.
  for (const id of [...m.balls]) {
    const b = by.get(id);
    if (b && b.y > m.h + 0.6) { removeBody(world, b); m.balls = m.balls.filter(x => x !== id); emit(S, 'drain', { x: b.x, y: m.h }); }
  }
  if (!m.balls.length) { loseBall(S, 'The ball got past the paddle'); return; }
  countBricks(S);
  if (m.bricksLeft === 0 && (!m.boss || m.boss.bonus)) clearLevel(S);
}

// ---------- world operations for mods (v2/kits/EXTENDING.md) ----------
/** The brick grid mods see: columns × rows of BRICK_W × BRICK_H cells from TOP, ending well above the paddle. */
export function grid(S) {
  const m = S.m;
  return { w: m.w, h: Math.max(4, Math.floor((m.h - 1.4 - 3 - TOP) / BRICK_H)), cell: { x0: 0, y0: TOP, w: BRICK_W, h: BRICK_H } };
}
const brickAt = (S, col, row) => S.world.bodies.some(b => !b.dead && b.tag === 'brick' && b.data.col === col && Math.abs(b.y - (TOP + row * BRICK_H + BRICK_H / 2)) < BRICK_H / 2);
function cellFree(S, col, row) {
  const m = S.m, x = col * BRICK_W + BRICK_W / 2, y = TOP + row * BRICK_H + BRICK_H / 2;
  if (col < 0 || col >= m.w || row < 0 || row >= grid(S).h || brickAt(S, col, row)) return false;
  const by = bodyIndex(S.world);
  if (m.balls.some(id => { const b = by.get(id); return b && Math.abs(b.x - x) < 0.75 && Math.abs(b.y - y) < 0.5; })) return false;
  const boss = m.boss && by.get(m.boss.id);
  return !(boss && Math.abs(boss.x - x) < 2.4 && Math.abs(boss.y - y) < 1.5);
}
/**
 * A new brick in the grid cell holding world x, y (or a random free cell among the brick rows).
 * hp counts standard hits, which bricks take one ball hit each for. Returns the body id or null.
 */
export function spawnBrick(S, { x, y, hp } = {}) {
  const m = S.m, rows = Math.min(grid(S).h, (m.rows || 0) + 3);
  let col, row;
  if (Number.isFinite(x) && Number.isFinite(y)) { col = Math.floor(x / BRICK_W); row = Math.floor((y - TOP) / BRICK_H); }
  else {
    const free = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < m.w; c++) if (cellFree(S, c, r)) free.push([c, r]);
    if (!free.length) return null;
    [col, row] = free[Math.floor(random(S) * free.length)];
  }
  if (!cellFree(S, col, row)) return null;
  const h = Math.max(1, Math.min(5, Math.round(Number(hp) || 1))), kind = h > 1 ? String(h) : 'n';
  const b = addBody(S.world, { shape: 'box', type: 'static', w: BRICK_W - 0.04, h: BRICK_H - 0.04, x: col * BRICK_W + BRICK_W / 2, y: TOP + row * BRICK_H + BRICK_H / 2, e: 1, mu: 0, tag: 'brick', data: { kind, hp: h, max: h, row, col, spawned: true } });
  countBricks(S);
  emit(S, 'spawn', { id: b.id, kind: 'brick', x: b.x, y: b.y });
  return b.id;
}
/** A mod's boss: the kit's own boss body, drifting and firing below the bricks. bonus: it no longer holds the clear. */
export function spawnBoss(S, { hp, required = true } = {}) {
  const m = S.m;
  if (m.boss) return null;
  let low = TOP;
  for (const b of S.world.bodies) if (!b.dead && b.tag === 'brick') low = Math.max(low, b.y + BRICK_H / 2);
  const y = Math.min(low + 1.5, m.h - 1.4 - 4.5), max = Math.max(1, Math.min(60, Math.round(Number(hp) || 8)));
  const b = addBody(S.world, { shape: 'box', type: 'kinematic', w: 3.6, h: 2.2, x: m.w / 2, y, e: 1, mu: 0, tag: 'boss', data: { hp: max, max } });
  m.boss = { id: b.id, hp: max, max, t: 0, fire: 2.5, flash: 0, y, bonus: !required, spawned: true };
  emit(S, 'spawn', { id: b.id, kind: 'boss', x: b.x, y: b.y });
  return b.id;
}

export function loseBall(S, reason) {
  const m = S.m;
  for (const id of m.balls) { const b = findBody(S.world, id); if (b) removeBody(S.world, b); }
  m.balls = []; m.capsules = []; m.lasers = []; m.shots = [];
  if (m.powers.wide > 0) setPaddleWidth(S, m.basePw);
  m.powers = {}; m.ramp = Math.max(0, m.ramp - 0.2);
  if (!loseLife(S, reason)) return;
  serve(S);
}

/** Bot: track the predicted landing point, aiming the bounce at the bricks that remain. */
export function bot(S) {
  const m = S.m, by = bodyIndex(S.world), p = by.get(m.paddle);
  const out = { x: 0, y: 0, a: false, b: false };
  if (m.held) { out.a = (S.frame % 20) === 0; return out; }
  // Catch capsules when no ball is coming soon.
  let target = null, soonest = Infinity;
  for (const id of m.balls) {
    const b = by.get(id);
    if (!b) continue;
    if (b.vy > 0) {
      const t = (p.y - 0.4 - b.y) / b.vy;
      if (t < soonest) { soonest = t; let x = b.x + b.vx * t; const lo = BALL_R, span = m.w - 2 * BALL_R; x = ((x - lo) % (2 * span) + 2 * span) % (2 * span); target = lo + (x > span ? 2 * span - x : x); }
    } else if (soonest === Infinity) target = b.x;
  }
  if (target == null) return out;
  // Offset so the ball heads toward the column with the most remaining bricks.
  const cols = new Array(m.w).fill(0);
  for (const b of S.world.bodies) if (b.tag === 'brick' && !b.dead && b.data.kind !== 'm') cols[b.data.col] += 1;
  if (m.boss) cols[Math.max(0, Math.min(m.w - 1, Math.floor(by.get(m.boss.id)?.x || m.w / 2)))] += 6;
  let best = 0; cols.forEach((n, i) => { if (n > cols[best]) best = i; });
  const aim = Math.max(-0.7, Math.min(0.7, (best + 0.5 - target) / m.w * 2.4));
  const want = target - aim * m.pw / 2;
  const d = want - p.x;
  out.x = Math.abs(d) > 0.12 ? Math.sign(d) : 0;
  if (m.powers.laser > 0) out.a = (S.frame % 18) === 0;
  return out;
}
