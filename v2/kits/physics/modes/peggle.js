// Peggle: aim the cannon, shoot one ball per turn through peg layouts built
// from shapes. Orange pegs must all be lit; green pegs grant a power; one blue
// peg turns purple each turn for bonus points. A moving bucket returns the
// ball, the multiplier climbs with oranges hit, the last orange triggers a
// slow-motion zoom and Extreme Fever bonus buckets.
import { createWorld, addBody, stepWorld, removeBody, bodyIndex, findBody } from '../physics.js';
import { random } from '../../../kernel/rng.js';
import { emit, addScore, loseLife, clearLevel, banner } from '../flow.js';

export const PEG_R = 0.22, BALL_R = 0.2;
// Board sizes: content coordinates (100 wide, 120 tall) scale to the board; pegs and the ball keep their size.
export const BOARD_W = { normal: 20, large: 26, huge: 32 };
export function boardDims(board = 'normal') {
  const W = BOARD_W[board] || 20;
  return { W, H: W * 1.2, scale: W / 100, cannon: { x: W / 2, y: 1.1, len: 1.15 } };
}
export const { W, H, scale: SCALE, cannon: CANNON } = boardDims('normal');
export const FEVER_SLOTS = [10000, 50000, 100000, 50000, 10000];
const SHOT_SPEED = 13, GRAVITY = 9.5, AIM_MAX = 1.45;
const BUCKET_SPEED = { slow: 2.2, normal: 3.6, fast: 5.2 };
const PEG_POINTS = { blue: 10, orange: 100, green: 10, purple: 500 };
const DEG = Math.PI / 180;

/** Peg positions (world units) and tangent angles for one content group. */
export function groupPegs(g, SCALE = 0.2) {
  const n = g.count, cx = g.x * SCALE, cy = g.y * SCALE, size = g.size * SCALE, a = g.angle * DEG, span = g.span * DEG;
  const out = [];
  const u = i => n > 1 ? i / (n - 1) : 0.5;
  if (g.shape === 'arc') for (let i = 0; i < n; i++) { const t = a - span / 2 + span * u(i); out.push([cx + Math.cos(t) * size, cy + Math.sin(t) * size]); }
  else if (g.shape === 'circle') for (let i = 0; i < n; i++) { const t = a + i / n * Math.PI * 2; out.push([cx + Math.cos(t) * size, cy + Math.sin(t) * size]); }
  else if (g.shape === 'line') for (let i = 0; i < n; i++) { const d = (u(i) - 0.5) * size; out.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d]); }
  else if (g.shape === 'spiral') for (let i = 0; i < n; i++) { const r = size * (0.25 + 0.75 * u(i)), t = a + span * u(i); out.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]); }
  else if (g.shape === 'wave') for (let i = 0; i < n; i++) { const k = u(i); out.push([cx + (k - 0.5) * size, cy + Math.sin(k * span) * size * 0.12]); }
  else { // grid, staggered rows
    const cols = Math.max(2, Math.round(Math.sqrt(n * 1.6))), rows = Math.ceil(n / cols), sx = size / (cols - 1), sy = Math.max(0.55, sx * 0.8);
    for (let r = 0, k = 0; r < rows; r++) for (let c = 0; c < cols && k < n; c++, k++) out.push([cx - size / 2 + c * sx + (r % 2 ? sx / 2 : 0) - sx / 4, cy + (r - (rows - 1) / 2) * sy]);
  }
  return out.map(([x, y], i) => {
    const p = out[Math.max(0, i - 1)], q = out[Math.min(out.length - 1, i + 1)];
    return { x, y, ang: Math.atan2(q[1] - p[1], q[0] - p[0]) || 0 };
  });
}

function motionAt(g, gi, base, t, SCALE) {
  if (g.motion === 'rotate') {
    const cx = g.x * SCALE, cy = g.y * SCALE, w = (gi % 2 ? -0.5 : 0.5) * t, c = Math.cos(w), s = Math.sin(w), dx = base[0] - cx, dy = base[1] - cy;
    return [cx + c * dx - s * dy, cy + s * dx + c * dy, w];
  }
  if (g.motion === 'slide') return [base[0] + Math.sin(t * 0.7 + gi) * 1.6, base[1], 0];
  return [base[0], base[1], 0];
}

export function build(S, level) {
  const cfg = level.peggle, D = boardDims(cfg.board), { W, H } = D;
  const world = createWorld({ gy: GRAVITY, substeps: 4, iterations: 3, cell: 1.5, sleep: false });
  const wall = { e: 0.6, mu: 0.1, tag: 'wall' };
  addBody(world, { ...wall, shape: 'seg', x1: 0, y1: H + 3, x2: 0, y2: 0 });
  addBody(world, { ...wall, shape: 'seg', x1: 0, y1: 0, x2: W, y2: 0 });
  addBody(world, { ...wall, shape: 'seg', x1: W, y1: 0, x2: W, y2: H + 3 });
  // Pegs, skipping any that would overlap one already placed or leave the board.
  const placed = [];
  cfg.groups.forEach((g, gi) => {
    for (const p of groupPegs(g, D.scale)) {
      if (p.x < 0.5 || p.x > W - 0.5 || p.y < 3.2 || p.y > H - 1.8) continue;
      if (placed.some(q => Math.hypot(q[0] - p.x, q[1] - p.y) < (g.bricks ? 0.62 : 0.52))) continue;
      placed.push([p.x, p.y]);
      const moving = g.motion !== 'none';
      const data = { kind: 'blue', lit: false, group: gi, base: [p.x, p.y], brick: g.bricks, ang: p.ang };
      const common = { type: moving ? 'kinematic' : 'static', x: p.x, y: p.y, e: 0.7, mu: 0.1, tag: 'peg', data };
      if (g.bricks) addBody(world, { ...common, shape: 'box', w: 0.78, h: 0.3, a: p.ang });
      else addBody(world, { ...common, shape: 'circle', r: PEG_R });
    }
  });
  // Assign orange and green pegs from the level's own seed, so every attempt matches what verify proved.
  const pegs = world.bodies.filter(b => b.tag === 'peg');
  const local = { rng: S.levelSeed || 1 };
  const order = pegs.map(p => ({ p, k: random(local) })).sort((a, b) => a.k - b.k).map(x => x.p);
  const oranges = Math.min(cfg.oranges, Math.max(1, pegs.length - 3));
  order.slice(0, oranges).forEach(p => { p.data.kind = 'orange'; });
  order.slice(oranges, oranges + 2).forEach(p => { p.data.kind = 'green'; });
  // The bucket: two posts and a catch sensor riding along the bottom.
  const bx = W / 2, by = H - 0.45;
  const postL = addBody(world, { shape: 'box', type: 'kinematic', w: 0.22, h: 0.7, x: bx - 1.3, y: by, e: 0.5, mu: 0.2, tag: 'bucket' });
  const postR = addBody(world, { shape: 'box', type: 'kinematic', w: 0.22, h: 0.7, x: bx + 1.3, y: by, e: 0.5, mu: 0.2, tag: 'bucket' });
  const mouth = addBody(world, { shape: 'box', type: 'kinematic', w: 2.3, h: 0.3, x: bx, y: by + 0.1, sensor: true, tag: 'bucket_mouth' });
  S.world = world;
  S.m = {
    phase: 'aim', aim: 0.25, balls: cfg.balls, ballIds: [], total: oranges, orangeLeft: oranges, multiplier: 1, shotScore: 0, shotLit: [], litOrder: [],
    guide: 0, power: cfg.power, spooky: 0, purple: null, t: 0, popT: 0, fever: false, feverT: 0, slow: 0, stuck: 0, freeGiven: false,
    W, H, scale: D.scale, cannon: D.cannon, bucket: { x: bx, dir: 1, speed: BUCKET_SPEED[cfg.bucket], ids: [postL.id, postR.id, mouth.id] }, groups: cfg.groups.map(g => ({ motion: g.motion, x: g.x, y: g.y })),
    shots: 0, slotHits: [],
  };
  pickPurple(S);
}

function pickPurple(S) {
  const m = S.m, by = bodyIndex(S.world);
  if (m.purple) { const old = by.get(m.purple); if (old && !old.data.lit && old.data.kind === 'purple') old.data.kind = 'blue'; }
  const blues = S.world.bodies.filter(b => b.tag === 'peg' && !b.data.lit && b.data.kind === 'blue');
  m.purple = blues.length ? blues[Math.floor(random(S) * blues.length)].id : null;
  if (m.purple) by.get(m.purple).data.kind = 'purple';
}

export const multiplierFor = (hit, total) => { const f = total ? hit / total : 0; return f >= 0.88 ? 10 : f >= 0.76 ? 5 : f >= 0.6 ? 3 : f >= 0.4 ? 2 : 1; };

/** Move kinematic pegs and the bucket toward their positions at time t + dt. */
function driveKinematics(S, dt) {
  const m = S.m, t = m.t + dt, { W } = m;
  for (const b of S.world.bodies) {
    if (b.tag !== 'peg' || b.type !== 'kinematic' || b.dead) continue;
    const g = m.groups[b.data.group], [x, y, w] = motionAt(g, b.data.group, b.data.base, t, m.scale);
    b.vx = (x - b.x) / dt; b.vy = (y - b.y) / dt;
    if (b.shape === 'poly') b.av = ((b.data.ang + w) - b.a) / dt;
  }
  const bk = m.bucket;
  if (!m.fever) {
    let nx = bk.x + bk.dir * bk.speed * dt;
    if (nx > W - 1.7) { nx = W - 1.7; bk.dir = -1; } else if (nx < 1.7) { nx = 1.7; bk.dir = 1; }
    const by = bodyIndex(S.world);
    bk.ids.forEach((id, i) => { const b = by.get(id); if (b) { const tx = nx + [-1.3, 1.3, 0][i]; b.vx = (tx - b.x) / dt; b.vy = 0; } });
    bk.x = nx;
  }
  m.t = t;
}

export function ambient(S) {
  if (S.m.phase === 'aim' || S.phase !== 'play') { driveKinematics(S, 1 / 60); stepWorld(S.world, 1 / 60); }
}

export function fire(S, aim = S.m.aim) {
  const m = S.m, CANNON = m.cannon;
  m.aim = Math.max(-AIM_MAX, Math.min(AIM_MAX, aim));
  const sx = Math.sin(m.aim), sy = Math.cos(m.aim);
  const ball = addBody(S.world, { shape: 'circle', r: BALL_R, x: CANNON.x + sx * CANNON.len, y: CANNON.y + sy * CANNON.len, vx: sx * SHOT_SPEED, vy: sy * SHOT_SPEED, e: 0.65, mu: 0.15, bullet: true, adamp: 0.2, tag: 'ball', density: 1 });
  m.ballIds = [ball.id]; m.balls--; m.phase = 'shot'; m.shotScore = 0; m.shotLit = []; m.stuck = 0; m.freeGiven = false; m.shots++;
  m.spooky = 0;
  if (m.guide > 0) m.guide--;
  emit(S, 'shoot', { x: CANNON.x + sx * CANNON.len, y: CANNON.y + sy * CANNON.len, aim: m.aim });
}

export function lightPeg(S, peg, cause = 'ball') {
  const m = S.m, d = peg.data;
  if (d.lit) return;
  d.lit = true; m.shotLit.push(peg.id); m.litOrder.push(peg.id);
  if (d.kind === 'orange') { m.orangeLeft--; m.multiplier = multiplierFor(m.total - m.orangeLeft, m.total); }
  const pts = PEG_POINTS[d.kind] * m.multiplier;
  m.shotScore += pts; addScore(S, pts, peg.x, peg.y);
  emit(S, 'hit', { x: peg.x, y: peg.y, kind: d.kind, cause, combo: m.shotLit.length, multiplier: m.multiplier });
  if (d.kind === 'green') activatePower(S, peg);
  if (d.kind === 'orange' && m.orangeLeft === 0 && !m.fever) startFever(S);
}

function activatePower(S, peg) {
  const m = S.m;
  emit(S, 'power', { kind: m.power, x: peg.x, y: peg.y });
  banner(S, { multiball: 'MULTIBALL!', superguide: 'SUPER GUIDE', zap: 'ZAP!', spooky: 'SPOOKY BALL' }[m.power], 'power');
  if (m.power === 'multiball') {
    const src = findBody(S.world, m.ballIds[0]);
    if (src) { const b = addBody(S.world, { shape: 'circle', r: BALL_R, x: peg.x, y: peg.y - 0.5, vx: -src.vx, vy: Math.min(src.vy, -2), e: 0.65, mu: 0.15, bullet: true, adamp: 0.2, tag: 'ball' }); m.ballIds.push(b.id); }
  } else if (m.power === 'superguide') m.guide += 3;
  else if (m.power === 'spooky') m.spooky = 1;
  else if (m.power === 'zap') {
    const near = S.world.bodies.filter(b => b.tag === 'peg' && !b.data.lit && b !== peg).map(b => ({ b, d: Math.hypot(b.x - peg.x, b.y - peg.y) })).filter(x => x.d < 4).sort((a, b) => a.d - b.d).slice(0, 8);
    emit(S, 'zap', { x: peg.x, y: peg.y, to: near.map(n => [n.b.x, n.b.y]) });
    for (const n of near) lightPeg(S, n.b, 'zap');
  }
}

function startFever(S) {
  const m = S.m, { W, H } = m;
  m.fever = true; m.feverT = 0;
  emit(S, 'fever', {}); banner(S, 'EXTREME FEVER', 'fever');
  // The bucket gives way to five bonus slots.
  for (const id of m.bucket.ids) { const b = findBody(S.world, id); if (b) removeBody(S.world, b); }
  for (let i = 1; i < FEVER_SLOTS.length; i++) addBody(S.world, { shape: 'seg', type: 'static', x1: i * W / 5, y1: H - 1.1, x2: i * W / 5, y2: H + 0.4, r: 0.08, e: 0.4, tag: 'divider' });
  FEVER_SLOTS.forEach((v, i) => addBody(S.world, { shape: 'box', type: 'static', w: W / 5 - 0.3, h: 0.3, x: (i + 0.5) * W / 5, y: H - 0.2, sensor: true, tag: 'slot', data: { value: v, index: i } }));
}

export function step(S, level, inp, press) {
  const m = S.m, base = 1 / 60, { W, H } = m;
  if (m.phase === 'aim') {
    m.aim = Math.max(-AIM_MAX, Math.min(AIM_MAX, m.aim + (inp.x * 1.25 + inp.y * 0.3) * base));
    driveKinematics(S, base); stepWorld(S.world, base);
    if (m.fever) { m.phase = 'pop'; m.popT = 0; return; } // the last orange went out between shots (e.g. by a mod)
    if (press.a) fire(S);
    return;
  }
  if (m.phase === 'done') { driveKinematics(S, base); stepWorld(S.world, base); return; }
  if (m.phase === 'pop') {
    m.popT += base;
    driveKinematics(S, base); stepWorld(S.world, base);
    // Lit pegs pop one by one, in the order they were hit.
    while (m.popT > 0.045 && m.litOrder.length) {
      m.popT -= 0.045;
      const peg = findBody(S.world, m.litOrder.shift());
      if (peg) { emit(S, 'pop', { x: peg.x, y: peg.y, kind: peg.data.kind, brick: peg.data.brick }); removeBody(S.world, peg); }
    }
    if (!m.litOrder.length && m.popT > 0.35) endTurn(S, level);
    return;
  }
  // Shot in flight. Slow motion near the last orange peg (and briefly at fever).
  let scale = 1;
  if (m.fever) { m.feverT += base; scale = m.feverT < 1.4 ? 0.35 : 1; }
  else if (m.orangeLeft === 1) {
    const last = S.world.bodies.find(b => b.tag === 'peg' && b.data.kind === 'orange' && !b.data.lit);
    for (const id of m.ballIds) {
      const b = findBody(S.world, id);
      if (!b || !last) continue;
      const dx = last.x - b.x, dy = last.y - b.y, d = Math.hypot(dx, dy);
      if (d < 2.6 && dx * b.vx + dy * b.vy > 0) scale = 0.3;
    }
    if (scale < 1 && m.slow === 0) emit(S, 'slowmo', {});
    m.slow = scale < 1 ? 1 : 0;
  }
  S.timeScale = scale;
  const dt = base * scale;
  driveKinematics(S, dt);
  stepWorld(S.world, dt);
  const by = bodyIndex(S.world);
  for (const c of S.world.contacts) {
    const A = by.get(c.a), B = by.get(c.b);
    if (!A || !B) continue;
    const ball = A.tag === 'ball' ? A : B.tag === 'ball' ? B : null, other = ball === A ? B : A;
    if (!ball || ball.dead) continue;
    if (other.tag === 'peg' && c.begin) { if (!other.data.lit) lightPeg(S, other); else emit(S, 'tick', { x: c.x, y: c.y }); }
    else if (other.tag === 'bucket_mouth' && ball.vy > 0) {
      removeBody(S.world, ball); m.ballIds = m.ballIds.filter(id => id !== ball.id);
      m.balls++; emit(S, 'collect', { kind: 'free_ball', x: ball.x, y: ball.y }); emit(S, 'reach_goal', { x: ball.x, y: ball.y }); banner(S, 'FREE BALL', 'good');
    } else if (other.tag === 'slot') {
      removeBody(S.world, ball); m.ballIds = m.ballIds.filter(id => id !== ball.id);
      addScore(S, other.data.value, other.x, other.y); m.slotHits.push(other.data.index);
      emit(S, 'jackpot', { x: other.x, y: other.y, value: other.data.value });
    } else if ((other.tag === 'wall' || other.tag === 'bucket') && c.begin && c.speed > 2) emit(S, 'tick', { x: c.x, y: c.y, soft: true });
  }
  // Balls that stall on pegs clear the lit pegs around them early; balls out the bottom end.
  for (const id of [...m.ballIds]) {
    const b = by.get(id);
    if (!b || b.dead) { m.ballIds = m.ballIds.filter(x => x !== id); continue; }
    if (Math.hypot(b.vx, b.vy) < 0.7) m.stuck += dt; else m.stuck = Math.max(0, m.stuck - dt);
    if (m.stuck > 1.2) {
      m.stuck = 0;
      const near = S.world.bodies.filter(p => p.tag === 'peg' && Math.hypot(p.x - b.x, p.y - b.y) < 0.9);
      let freed = false;
      for (const p of near) if (p.data.lit) { emit(S, 'pop', { x: p.x, y: p.y, kind: p.data.kind, brick: p.data.brick }); removeBody(S.world, p); m.litOrder = m.litOrder.filter(x => x !== p.id); freed = true; }
      if (!freed) { b.vx += (b.x < W / 2 ? 1 : -1) * 1.5; b.vy -= 1; }
    }
    if (b.y > H + 0.8) {
      if (m.spooky > 0) { m.spooky = 0; b.y = 0.6; emit(S, 'power', { kind: 'spooky', x: b.x, y: 0.6 }); continue; }
      removeBody(S.world, b); m.ballIds = m.ballIds.filter(x => x !== id);
      emit(S, 'drain', { x: b.x, y: H });
    }
  }
  if (!m.freeGiven && m.shotScore >= 25000) { m.freeGiven = true; m.balls++; emit(S, 'extra_life', { kind: 'free_ball' }); banner(S, 'FREE BALL', 'good'); }
  if (!m.ballIds.length) { m.phase = 'pop'; m.popT = 0; S.timeScale = 1; }
}

function endTurn(S) {
  const m = S.m;
  m.shotLit = [];
  if (m.fever) {
    addScore(S, m.balls * 10000);
    clearLevel(S, { bonus: m.balls * 10000 });
    m.phase = 'done';
    return;
  }
  if (m.balls <= 0) { m.phase = 'done'; loseLife(S, `Out of balls with ${m.orangeLeft} orange peg${m.orangeLeft === 1 ? '' : 's'} left`, { retry: true }); return; }
  m.phase = 'aim';
  pickPurple(S);
}

/** The aiming guide: the ball's path until its first peg (and, with superguide, a bounce beyond). */
export function guide(S, aim = S.m.aim) {
  const m = S.m, { W, H } = m, CANNON = m.cannon;
  // Moving pegs are tracked where they will be when the ball gets there.
  const pegs = S.world.bodies.filter(b => b.tag === 'peg' && !b.dead).map(p => ({ id: p.id, x: p.x, y: p.y, round: p.shape === 'circle', move: p.type === 'kinematic' ? p.data : null }));
  let x = CANNON.x + Math.sin(aim) * CANNON.len, y = CANNON.y + Math.cos(aim) * CANNON.len, vx = Math.sin(aim) * SHOT_SPEED, vy = Math.cos(aim) * SHOT_SPEED;
  const pts = [[x, y]], h = 1 / 120;
  let bounces = m.guide > 0 ? 2 : 0, t = 0;
  while (t < (m.guide > 0 ? 3.2 : 1.6) && y < H + 1) {
    vy += GRAVITY * h; x += vx * h; y += vy * h; t += h;
    if ((Math.round(t / h) & 3) === 0) for (const p of pegs) if (p.move) [p.x, p.y] = motionAt(m.groups[p.move.group], p.move.group, p.move.base, m.t + t, m.scale);
    if (x < BALL_R || x > W - BALL_R) { vx = -vx * 0.6; x = Math.max(BALL_R, Math.min(W - BALL_R, x)); }
    let hit = null;
    for (const p of pegs) {
      const r = (p.round ? PEG_R : 0.36) + BALL_R, dx = x - p.x, dy = y - p.y;
      if (dx * dx + dy * dy < r * r) { hit = { p, d: Math.hypot(dx, dy) || 1, dx, dy }; break; }
    }
    if (pts.length % 3 === 0) pts.push([x, y]);
    if (hit) {
      pts.push([x, y]);
      if (bounces-- <= 0) return { pts, hit: [hit.p.x, hit.p.y], id: hit.p.id };
      const nx = hit.dx / hit.d, ny = hit.dy / hit.d, vn = vx * nx + vy * ny;
      vx -= 1.65 * vn * nx; vy -= 1.65 * vn * ny; const rr = (hit.p.round ? PEG_R : 0.36) + BALL_R + 0.01; x = hit.p.x + nx * rr; y = hit.p.y + ny * rr;
    }
  }
  pts.push([x, y]);
  return { pts, hit: null };
}

/** Bot: aim at the nearest unlit orange peg, adjusting until the guide lines up. */
export function bot(S) {
  const m = S.m, out = { x: 0, y: 0, a: false, b: false }, CANNON = m.cannon;
  if (m.phase !== 'aim') return out;
  const target = S.world.bodies.find(b => b.tag === 'peg' && b.data.kind === 'orange' && !b.data.lit);
  if (!target) { out.a = S.frame % 2 === 0; return out; }
  const want = Math.atan2(target.x - CANNON.x, Math.max(0.5, target.y - CANNON.y)) * 0.92;
  const d = want - m.aim;
  if (Math.abs(d) > 0.02) out.x = d > 0 ? 1 : -1; else out.a = S.frame % 2 === 0;
  return out;
}
