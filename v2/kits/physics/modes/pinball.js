// Pinball: a table from a preset plus content parameters (pop bumpers,
// slingshot kickers, ramps, drop targets, rollover lanes, a multiball lock),
// motorized flippers on revolute joints, a plunger, nudge and tilt, ball save,
// ball search, and missions completed in order.
import { createWorld, addBody, addArc, addChain, stepWorld, removeBody, bodyIndex, findBody, addRevoluteJoint, applyImpulse } from '../physics.js';
import { random } from '../../../kernel/rng.js';
import { emit, addScore, loseLife, clearLevel, banner } from '../flow.js';

export const W = 12, H = 20, BALL_R = 0.26;
const BALL = 1, WALL = 2, FLIP = 4, GATE = 8, SENSE = 16;
const FLIP_LEN = 2.1, REST = 0.5, SWING = 0.95, UP_SPEED = 20, DOWN_SPEED = 16;
const ARC = { cx: 6, cy: 5.9, r: 5.7 };
const LANE = { x0: 11.0, x1: 11.7, top: 7.2, floor: 19.6 };
export const MIRROR = 11.3; // the playfield (left wall to lane wall) mirrors about x = 5.65
export const PIVOT_L = [3.2, 17.75], PIVOT_R = [MIRROR - 3.2, 17.75];

// Table presets: where the features go. Ramps are habitrails: a fast ball moving up through the
// entry rides the rail and drops out at the exit (feeding the opposite inlane).
export const PRESETS = {
  classic: {
    outlanes: true, bumpers: [[4.3, 6.4], [7.7, 6.4], [6.0, 8.5], [3.1, 9.3], [8.9, 9.3]], bank: { x: 4.1, y: 11.1, dir: [1, 0] }, lock: [7.7, 11.8],
    ramps: [
      { entry: [1.15, 8.2], path: [[1.15, 8.2], [0.9, 4.8], [2.2, 2.2], [5.0, 1.2], [8.4, 1.6], [10.0, 4.2], [10.2, 9.5], [9.7, 13.8]], exit: [9.7, 14.1], v: [0, 2.5] },
      { entry: [10.35, 9.6], path: [[10.35, 9.6], [10.5, 5.6], [9.2, 2.8], [6.0, 2.0], [3.0, 2.8], [1.7, 5.5], [1.8, 10.5], [2.3, 13.8]], exit: [1.6, 14.1], v: [0, 2.5] },
    ],
    walls: [], color: '#3a1f6e',
  },
  cosmic: {
    outlanes: false, bumpers: [[6.0, 5.2], [4.2, 7.0], [7.8, 7.0], [5.0, 9.0], [7.0, 9.0]], bank: { x: 8.9, y: 10.2, dir: [0, 1] }, lock: [6.0, 11.6],
    ramps: [
      { entry: [1.2, 9.0], path: [[1.2, 9.0], [1.0, 4.4], [3.6, 1.6], [8.4, 1.6], [10.4, 4.6], [10.3, 10.0], [9.7, 13.8]], exit: [10.2, 14.0], v: [0, 2.5] },
      { entry: [10.2, 12.0], path: [[10.2, 12.0], [10.6, 6.4], [8.0, 2.4], [4.0, 2.4], [1.6, 6.4], [1.8, 11.0], [2.3, 13.8]], exit: [1.1, 14.0], v: [0, 2.5] },
    ],
    walls: [[[0.3, 11.6], [1.0, 12.6]], [[11.0, 11.6], [10.3, 12.6]]], color: '#0f2a5a',
  },
  cavern: {
    outlanes: true, bumpers: [[3.4, 6.2], [5.2, 5.4], [4.4, 7.9], [8.6, 7.4], [7.0, 6.2]], bank: { x: 7.0, y: 10.6, dir: [1, 0] }, lock: [3.2, 11.4],
    ramps: [
      { entry: [1.2, 8.4], path: [[1.2, 8.4], [1.0, 3.6], [4.0, 1.4], [8.0, 1.4], [10.2, 4.0], [10.2, 9.5], [9.7, 13.8]], exit: [9.7, 14.1], v: [0, 2.5] },
      { entry: [10.3, 8.4], path: [[10.3, 8.4], [10.4, 4.6], [7.6, 2.2], [4.4, 2.2], [1.8, 4.8], [1.8, 10.6], [2.3, 13.8]], exit: [1.6, 14.1], v: [0, 2.5] },
    ],
    walls: [[[0.3, 9.8], [0.9, 10.6]], [[11.0, 9.8], [10.4, 10.6]], [[5.6, 13.0], [6.4, 13.0]]], color: '#2c2a1c',
  },
};

export const SLING = [[1.95, 14.5], [1.95, 15.7], [2.95, 16.39]];
export const mirror = (pts, side) => side < 0 ? pts : pts.map(([x, y]) => [MIRROR - x, y]);
const wallDef = { e: 0.45, mu: 0.15, cat: WALL, mask: BALL, tag: 'wall' };

function addFlipper(world, side, [px, py]) {
  const L = FLIP_LEN;
  const verts = [[-0.22, -0.16], [0, -0.25], [L, -0.1], [L + 0.09, 0], [L, 0.1], [0, 0.25], [-0.22, 0.16]];
  const v = side < 0 ? verts : verts.map(([x, y]) => [-x, y]);
  const a = side < 0 ? REST : -REST;
  const body = addBody(world, { shape: 'poly', verts: v, x: px, y: py, a, density: 3, gs: 0, e: 0.25, mu: 0.4, adamp: 0, cat: FLIP, mask: BALL, tag: 'flipper', data: { side, awake: true } });
  // addBody moved the body to its centroid; the joint pins the pivot.
  const joint = addRevoluteJoint(world, { b: body.id, x: px, y: py, motor: true, speed: side < 0 ? DOWN_SPEED : -DOWN_SPEED, maxTorque: 340, limit: true, lower: side < 0 ? -SWING : 0, upper: side < 0 ? 0 : SWING, tag: side < 0 ? 'flipL' : 'flipR' });
  return { body: body.id, joint: joint.id };
}

export const SPLIT = 12, TALL_EXTRA = 7, GRAVITY = { gentle: 7, normal: 9, steep: 11.5 };

export function build(S, level) {
  const cfg = level.pinball, P = PRESETS[cfg.table];
  // A tall table stretches the field at y = SPLIT: the upper features stay, the lower field moves down.
  const E = cfg.size === 'tall' ? TALL_EXTRA : 0, ty = y => y >= SPLIT ? y + E : y, tp = ([x, y]) => [x, ty(y)];
  const world = createWorld({ gy: GRAVITY[cfg.slope] || 9, substeps: 6, iterations: 6, cell: 1.5, sleep: false });
  const chain = pts => addChain(world, pts.map(tp), wallDef);
  // Shell: left wall, top arc, right outer wall, plunger lane.
  const bottom = P.outlanes ? 20.8 : 14.4, laneFloor = ty(LANE.floor);
  chain([[0.3, bottom], [0.3, ARC.cy]]);
  addArc(world, ARC.cx, ARC.cy, ARC.r, Math.PI, Math.PI * 2, 20, wallDef);
  chain([[11.7, ARC.cy], [11.7, 20.4]]);
  // The orbit deflector turns a ball coming down the left wall back toward the bumpers.
  addBody(world, { ...wallDef, shape: 'seg', x1: 0.3, y1: 6.4, x2: 1.9, y2: 7.6, r: 0.06, tag: 'wall' });
  chain([[LANE.x0, 20.4], [LANE.x0, LANE.top]]);
  addBody(world, { ...wallDef, shape: 'seg', x1: LANE.x0, y1: laneFloor, x2: LANE.x1, y2: laneFloor, e: 0.1, tag: 'plunger' });
  addBody(world, { ...wallDef, shape: 'seg', x1: LANE.x0, y1: LANE.top, x2: LANE.x1, y2: LANE.top - 0.9, cat: GATE, tag: 'gate' });
  const pivotL = tp(PIVOT_L), pivotR = tp(PIVOT_R);
  // Lower playfield: inlane guides to the flippers (with outlanes outside them, or walls funneling straight in).
  const guide = P.outlanes ? [[1.2, 14.5], [1.2, 16.2], [PIVOT_L[0] - 0.12, PIVOT_L[1] - 0.25]] : [[0.3, 14.4], [0.3, 15.6], [PIVOT_L[0] - 0.12, PIVOT_L[1] - 0.25]];
  for (const side of [-1, 1]) chain(mirror(guide, side));
  for (const [a, b] of P.walls) { const [x1, y1] = tp(a), [x2, y2] = tp(b); addBody(world, { ...wallDef, shape: 'seg', x1, y1, x2, y2, r: 0.06 }); }
  // Slingshot kickers above the flippers.
  if (cfg.slingshots) for (const side of [-1, 1]) addBody(world, { shape: 'poly', type: 'static', verts: mirror(SLING, side).map(tp), x: 0, y: 0, e: 0.4, mu: 0.2, cat: WALL, mask: BALL, tag: 'sling', data: { side } });
  // Pop bumpers (a tall table adds a pair in its long mid-field).
  const bumpers = [...P.bumpers.slice(0, cfg.bumpers), ...(E ? [[3.0, 13.6], [8.3, 13.6], [5.65, 15.8]] : [])];
  bumpers.forEach(([x, y], i) => addBody(world, { shape: 'circle', type: 'static', r: 0.55, x, y, e: 0.5, mu: 0, cat: WALL, mask: BALL, tag: 'bumper', data: { index: i } }));
  // Rollover lanes under the arc.
  const lanes = [];
  for (let i = 0; i < cfg.rollovers; i++) {
    const x = ARC.cx + (i - (cfg.rollovers - 1) / 2) * 1.15;
    addBody(world, { shape: 'circle', type: 'static', r: 0.24, x, y: 2.1, sensor: true, cat: SENSE, mask: BALL, tag: 'rollover', data: { index: i } });
    lanes.push(x);
  }
  for (let i = 0; i <= cfg.rollovers && cfg.rollovers > 0; i++) {
    const x = ARC.cx + (i - cfg.rollovers / 2) * 1.15;
    addBody(world, { ...wallDef, shape: 'seg', x1: x, y1: 1.55, x2: x, y2: 2.55, r: 0.07, tag: 'post' });
  }
  // Ramps and the lock.
  const ramps = P.ramps.slice(0, cfg.ramps).map(r => ({ entry: tp(r.entry), path: r.path.map(tp), exit: tp(r.exit), v: r.v }));
  ramps.forEach((r, i) => addBody(world, { shape: 'circle', type: 'static', r: 0.55, x: r.entry[0], y: r.entry[1], sensor: true, cat: SENSE, mask: BALL, tag: 'ramp', data: { index: i } }));
  const lock = tp(P.lock);
  if (cfg.lock) addBody(world, { shape: 'circle', type: 'static', r: 0.32, x: lock[0], y: lock[1], sensor: true, cat: SENSE, mask: BALL, tag: 'lock' });
  S.world = world;
  S.m = {
    table: cfg.table, flippers: [addFlipper(world, -1, pivotL), addFlipper(world, 1, pivotR)], balls: [], lane: null, plunge: 0, plunging: false,
    bank: [], bankDown: 0, bankReset: -1, lanes: lanes.map(() => false), laneSets: 0, bumperHits: 0, rampRides: 0, rides: [], lastRamp: -9,
    lockCount: cfg.lock, locked: 0, lockLit: cfg.targets === 0, lockHeld: null, multiball: false, mission: 0, missions: cfg.missions.map(x => ({ ...x, progress: 0 })),
    missionScore: 0, saveT: 0, tilt: 0, tilted: false, bonus: 0, bonusX: 1, still: {}, searches: 0, flash: {}, t: 0, nudges: 0, drains: 0, launched: 0,
    targets: cfg.targets, preset: cfg.table, E, H: H + E, laneFloor, ramps, lock, pivots: [pivotL, pivotR], outlanes: P.outlanes,
  };
  raiseBank(S);
  serve(S);
}

function raiseBank(S) {
  const m = S.m, P = PRESETS[m.preset], b = P.bank;
  for (const id of m.bank) { const t = findBody(S.world, id); if (t) removeBody(S.world, t); }
  m.bank = [];
  for (let i = 0; i < m.targets; i++) {
    const off = (i - (m.targets - 1) / 2) * 0.72, x = b.x + b.dir[0] * off, y = b.y + b.dir[1] * off;
    const t = addBody(S.world, { shape: 'box', type: 'static', w: b.dir[0] ? 0.58 : 0.22, h: b.dir[0] ? 0.22 : 0.58, x, y, e: 0.3, mu: 0.1, cat: WALL, mask: BALL, tag: 'drop', data: { index: i } });
    m.bank.push(t.id);
  }
  m.bankDown = 0; m.bankReset = -1;
}

/** Knock down a drop target; the last one in the bank scores, lights the lock and counts for missions. */
export function dropTarget(S, t) {
  const m = S.m;
  if (!t || t.dead) return 0;
  removeBody(S.world, t); m.bank = m.bank.filter(id => id !== t.id); m.bankDown++;
  score(S, 250, t.x, t.y); m.bonus += 250; emit(S, 'break', { x: t.x, y: t.y, kind: 'drop' });
  if (!m.bank.length) {
    score(S, 2000, t.x, t.y - 0.6); m.bankReset = 1.5; emit(S, 'bank', {});
    if (m.lockCount && !m.lockLit) { m.lockLit = true; emit(S, 'lock_lit', {}); banner(S, 'LOCK IS LIT', 'good'); }
    missionEvent(S, 'targets');
  }
  return 250;
}

function newBall(S, x, y, vx = 0, vy = 0, out = true) {
  const b = addBody(S.world, { shape: 'circle', r: BALL_R, x, y, vx, vy, density: 2, e: 0.35, mu: 0.12, adamp: 0.05, bullet: true, cat: BALL, mask: BALL | WALL | FLIP | SENSE | (out ? GATE : 0), tag: 'ball', data: { out } });
  S.m.balls.push(b.id);
  return b;
}

function serve(S) {
  const m = S.m;
  const b = newBall(S, (LANE.x0 + LANE.x1) / 2, S.m.laneFloor - BALL_R - 0.02, 0, 0, false);
  m.lane = b.id; m.plunge = 0; m.tilted = false; m.tilt = 0;
  emit(S, 'ready', { x: b.x, y: b.y });
}

const pressedL = (inp) => inp.x < 0 || inp.a, pressedR = (inp) => inp.x > 0 || inp.b;

export function ambient(S) {
  driveFlippers(S, { x: 0, y: 0, a: false, b: false });
  stepWorld(S.world, 1 / 60);
}

function driveFlippers(S, inp) {
  const m = S.m;
  for (const [i, f] of m.flippers.entries()) {
    const j = S.world.joints.find(x => x.id === f.joint), side = i === 0 ? -1 : 1;
    const up = !m.tilted && (side < 0 ? pressedL(inp) : pressedR(inp));
    const before = f.up;
    j.speed = side < 0 ? (up ? -UP_SPEED : DOWN_SPEED) : (up ? UP_SPEED : -DOWN_SPEED);
    f.up = up;
    if (up && !before) emit(S, 'flip', { side });
  }
}

function missionEvent(S, kind, amount = 1) {
  const m = S.m, cur = m.missions[m.mission];
  if (!cur || cur.kind !== kind) return;
  cur.progress = Math.min(cur.count, cur.progress + amount);
  if (cur.progress >= cur.count) {
    const reward = 10000 * (m.mission + 1);
    addScore(S, reward);
    emit(S, 'mission', { index: m.mission, name: cur.name, reward });
    emit(S, 'reach_goal', {});
    banner(S, `${cur.name.toUpperCase()} COMPLETE`, 'good');
    m.mission++; m.missionScore = 0;
    if (m.mission >= m.missions.length) clearLevel(S, { missions: m.missions.length });
  }
}

function score(S, n, x, y) {
  addScore(S, n, x, y);
  const m = S.m, cur = m.missions[m.mission];
  m.missionScore += n;
  if (cur?.kind === 'score') { cur.progress = Math.min(cur.count, m.missionScore); if (cur.progress >= cur.count) missionEvent(S, 'score', 0); }
}

export function step(S, level, inp, press) {
  const m = S.m, dt = 1 / 60;
  m.t += dt;
  // Plunger: hold down to pull, release to launch.
  const laneBall = m.lane && findBody(S.world, m.lane);
  if (inp.y > 0 && laneBall) { m.plunge = Math.min(1, m.plunge + dt * 1.15); m.plunging = true; }
  else if (m.plunging) {
    m.plunging = false;
    if (laneBall && laneBall.y > m.laneFloor - 1.2) { laneBall.vy = -(10 + 14 * m.plunge); emit(S, 'launch', { x: laneBall.x, y: laneBall.y, power: m.plunge }); m.launched++; }
    m.plunge = 0;
  }
  // Nudge (up) and tilt.
  m.tilt = Math.max(0, m.tilt - dt * 0.45);
  if (press.up && !m.tilted) {
    m.tilt += 1; m.nudges++;
    const dir = m.nudges % 2 ? 1 : -1;
    for (const id of m.balls) { const b = findBody(S.world, id); if (b && b.id !== m.lane) applyImpulse(b, dir * 0.55 * b.m * 2, -0.9 * b.m * 2); }
    emit(S, 'nudge', { dir });
    if (m.tilt > 2.6) { m.tilted = true; m.bonus = 0; emit(S, 'tilt', {}); banner(S, 'TILT', 'bad'); }
  }
  driveFlippers(S, inp);
  // Rollover lane change with the flipper buttons (Space Cadet style).
  if ((press.left || press.a) && m.lanes.length) m.lanes.push(m.lanes.shift());
  if ((press.right || press.b) && m.lanes.length) m.lanes.unshift(m.lanes.pop());
  // Ramp rides in progress.
  for (const r of m.rides) {
    r.t += dt;
    if (r.t >= r.dur) {
      const ramp = m.ramps[r.index];
      newBall(S, ramp.exit[0], ramp.exit[1], ramp.v[0], ramp.v[1]);
      r.done = true; emit(S, 'ramp_exit', { index: r.index, x: ramp.exit[0], y: ramp.exit[1] });
    }
  }
  m.rides = m.rides.filter(r => !r.done);
  // Locked ball kickout.
  if (m.lockHeld) {
    m.lockHeld.t += dt;
    if (m.lockHeld.t > 1.1) {
      const [x, y] = m.lock;
      newBall(S, x, y + 0.45, (random(S) - 0.5) * 4, 4);
      m.lockHeld = null; emit(S, 'kickout', { x, y });
    }
  }
  if (m.bankReset >= 0) { m.bankReset -= dt; if (m.bankReset < 0) { raiseBank(S); emit(S, 'bank_up', {}); } }
  stepWorld(S.world, dt);
  const by = bodyIndex(S.world);
  for (const c of S.world.contacts) {
    const A = by.get(c.a), B = by.get(c.b);
    if (!A || !B) continue;
    const ball = A.tag === 'ball' ? A : B.tag === 'ball' ? B : null, other = ball === A ? B : A;
    if (!ball || ball.dead) continue;
    const nx = ball === A ? -c.nx : c.nx, ny = ball === A ? -c.ny : c.ny; // normal pointing from other to ball
    switch (other.tag) {
      case 'bumper':
        if (!c.begin) break;
        ball.vx = nx * 12.5; ball.vy = ny * 12.5;
        m.bumperHits++; m.flash[other.id] = 0.25; score(S, 100, other.x, other.y - 0.7);
        emit(S, 'bumper', { x: other.x, y: other.y, index: other.data.index }); emit(S, 'hit', { x: c.x, y: c.y, kind: 'bumper' });
        missionEvent(S, 'bumpers');
        if (m.targets === 0 && !m.lockLit && m.bumperHits % 10 === 0) { m.lockLit = true; emit(S, 'lock_lit', {}); banner(S, 'LOCK IS LIT', 'good'); }
        break;
      case 'sling': {
        if (!c.begin || c.speed < 0.6) break;
        // Only the inner face kicks.
        if ((other.data.side < 0 ? nx > 0.3 : nx < -0.3) && ny < 0.2) {
          ball.vx = nx * 10.5; ball.vy = ny * 10.5 - 1.5;
          m.flash[other.id] = 0.2; score(S, 30, c.x, c.y); emit(S, 'sling', { x: c.x, y: c.y, side: other.data.side });
        }
        break;
      }
      case 'drop':
        if (c.begin) dropTarget(S, other);
        break;
      case 'rollover':
        if (!c.begin) break;
        if (!m.lanes[other.data.index]) {
          m.lanes[other.data.index] = true; score(S, 500, other.x, other.y + 0.5); emit(S, 'rollover', { x: other.x, y: other.y, index: other.data.index });
          if (m.lanes.every(Boolean)) { m.lanes = m.lanes.map(() => false); m.laneSets++; m.bonusX = Math.min(5, m.bonusX + 1); score(S, 3000); emit(S, 'power', { kind: 'bonus_x' }); banner(S, `BONUS ${m.bonusX}X`, 'good'); missionEvent(S, 'rollovers'); }
        } else score(S, 50);
        break;
      case 'ramp':
        if (ball.vy < -5.5 && ball.data.out) {
          const ramp = m.ramps[other.data.index], combo = m.t - m.lastRamp < 4;
          removeBody(S.world, ball); m.balls = m.balls.filter(id => id !== ball.id);
          m.rides.push({ index: other.data.index, t: 0, dur: 1.0 });
          m.rampRides++; m.lastRamp = m.t;
          const pts = m.multiball ? 25000 : combo ? 3000 : 1500;
          score(S, pts, ramp.entry[0], ramp.entry[1] - 0.8); m.bonus += 500;
          emit(S, 'ramp', { index: other.data.index, combo, jackpot: m.multiball });
          if (m.multiball) { emit(S, 'jackpot', { x: ramp.entry[0], y: ramp.entry[1] }); banner(S, 'JACKPOT!', 'good'); }
          missionEvent(S, 'ramps');
        }
        break;
      case 'lock': {
        const d = Math.hypot(ball.x - other.x, ball.y - other.y);
        if (d > 0.3 || Math.hypot(ball.vx, ball.vy) > 14 || m.lockHeld) break;
        removeBody(S.world, ball); m.balls = m.balls.filter(id => id !== ball.id);
        if (m.lockLit && m.lockCount && !m.multiball) {
          m.locked++;
          if (m.locked >= m.lockCount) {
            // Multiball: every locked ball comes back at once.
            m.multiball = true; m.lockLit = false;
            for (let i = 0; i < m.locked; i++) newBall(S, other.x + (i - (m.locked - 1) / 2) * 0.6, other.y + 0.5, (i - (m.locked - 1) / 2) * 3, 5 + i);
            m.locked = 0; emit(S, 'multiball', { x: other.x, y: other.y }); banner(S, 'MULTIBALL!', 'power'); score(S, 5000, other.x, other.y);
            missionEvent(S, 'lock');
          } else {
            emit(S, 'lock', { x: other.x, y: other.y, count: m.locked }); banner(S, `BALL ${m.locked} LOCKED`, 'good'); score(S, 2500, other.x, other.y);
            m.lockLit = m.targets === 0; if (m.targets) raiseBank(S);
            if (!m.lane) serve(S);
          }
        } else { m.lockHeld = { t: 0 }; score(S, 750, other.x, other.y); emit(S, 'saucer', { x: other.x, y: other.y }); }
        break;
      }
      case 'flipper':
        if (c.begin && c.speed > 3) emit(S, 'hit', { x: c.x, y: c.y, kind: 'flipper', speed: c.speed });
        break;
      case 'wall': case 'post':
        if (c.begin && c.speed > 6) emit(S, 'tick', { x: c.x, y: c.y, speed: c.speed });
        break;
      default: break;
    }
  }
  for (const k of Object.keys(m.flash)) { m.flash[k] -= dt; if (m.flash[k] <= 0) delete m.flash[k]; }
  m.saveT = Math.max(0, m.saveT - dt);
  // Balls: leaving the lane, ball search, draining.
  const anyUp = m.flippers.some(f => f.up);
  for (const id of [...m.balls]) {
    const b = by.get(id);
    if (!b || b.dead) { m.balls = m.balls.filter(x => x !== id); continue; }
    if (!b.data.out && b.y < LANE.top - 1.35) { b.data.out = true; b.mask |= GATE; if (m.lane === b.id) { m.lane = null; m.saveT = 7; } }
    const held = m.lane === b.id;
    const slow = Math.hypot(b.vx, b.vy) < 0.3 && !held && !anyUp;
    m.still[id] = slow ? (m.still[id] || 0) + dt : 0;
    if (m.still[id] > 4) { m.still[id] = 0; m.searches++; b.vx = (random(S) - 0.5) * 6; b.vy = -7; emit(S, 'search', { x: b.x, y: b.y }); }
    if (b.y > m.H + 0.6 || b.x < -1 || b.x > W + 1 || b.y < -2) {
      removeBody(S.world, b); m.balls = m.balls.filter(x => x !== id); delete m.still[id];
      emit(S, 'drain', { x: b.x, y: H });
    }
  }
  if (m.balls.length === 1 && m.multiball && !m.rides.length) { m.multiball = false; emit(S, 'power_end', { kind: 'multiball' }); }
  if (!m.balls.length && !m.rides.length && !m.lockHeld && S.phase === 'play') {
    if (m.saveT > 0 && !m.tilted) { m.saveT = 0; emit(S, 'save', {}); banner(S, 'BALL SAVED', 'good'); serve(S); return; }
    if (m.bonus && !m.tilted) { const bonus = m.bonus * m.bonusX; addScore(S, bonus); emit(S, 'bonus', { value: bonus, x: m.bonusX }); }
    m.bonus = 0; m.bonusX = 1; m.drains++; m.multiball = false;
    if (loseLife(S, 'The last ball drained')) serve(S);
  }
}

/** Ball positions currently riding a ramp (for drawing). */
export function rideAt(m, r) {
  const path = m.ramps[r.index].path, k = Math.min(1, r.t / r.dur) * (path.length - 1), i = Math.min(path.length - 2, Math.floor(k)), f = k - i;
  return [path[i][0] + (path[i + 1][0] - path[i][0]) * f, path[i][1] + (path[i + 1][1] - path[i][1]) * f];
}

/** Bot: flip when a ball nears a flipper, plunge when the ball waits in the lane. */
export function bot(S) {
  const m = S.m, out = { x: 0, y: 0, a: false, b: false };
  if (m.lane) { out.y = m.plunge < 0.75 ? 1 : 0; return out; }
  for (const id of m.balls) {
    const b = findBody(S.world, id);
    if (!b || b.vy < -1) continue;
    if (b.y > m.pivots[0][1] - 1.55 && b.y < m.pivots[0][1] + 1.05) { if (b.x < 6.2 && b.x > 3) out.a = true; if (b.x > 5.8 && b.x < 9) out.b = true; }
  }
  return out;
}
