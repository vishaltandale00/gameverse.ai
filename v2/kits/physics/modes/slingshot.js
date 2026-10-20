// Slingshot (Angry Birds-like): pull back and release projectiles at
// structures of wood, stone, glass and TNT built from content block lists.
// Damage comes from contact impulses (projectiles in far-reaching levels are lighter, so a stronger
// launch carries the same momentum), foes fall to impacts and collapses,
// projectiles have abilities (split, boost, bomb, heavy dive), and stars come
// from score.
import { createWorld, addBody, stepWorld, removeBody, bodyIndex, findBody, applyImpulse, addDistanceJoint, wake } from '../physics.js';
import { emit, addScore, loseLife, clearLevel, banner } from '../flow.js';

export const POUCH = { x: 0, y: -2.6 }, MAX_PULL = 1.9, SPEED_MAX = 22, GRAVITY = 10;
export const MATERIAL = {
  wood: { density: 0.7, hp: 5, mu: 0.7, e: 0.08, score: 500 },
  stone: { density: 2.2, hp: 18, mu: 0.85, e: 0.04, score: 1000 },
  glass: { density: 1.0, hp: 1.8, mu: 0.35, e: 0.1, score: 300 },
  tnt: { density: 0.8, hp: 2.2, mu: 0.7, e: 0.08, score: 500 },
  rock: { density: 0, hp: Infinity, mu: 0.9, e: 0.05, score: 0 },
};
export const TARGET = { small: { r: 0.38, hp: 1.6 }, medium: { r: 0.55, hp: 2.6 }, large: { r: 0.75, hp: 4.2 } };
export const PROJECTILE = {
  normal: { r: 0.42, density: 2.6 }, split: { r: 0.34, density: 2.6 }, boost: { r: 0.38, density: 2.6 },
  bomb: { r: 0.5, density: 2.3 }, heavy: { r: 0.55, density: 5.5 },
};
const DAMAGE_FLOOR = 0.9;  // per-step impulse a piece shrugs off (resting loads stay below this)
const QUIET_MIN = 1.2, FLIGHT_MAX = 9;

export function build(S, level) {
  const cfg = level.slingshot;
  const world = createWorld({ gy: GRAVITY, substeps: 4, iterations: 6, cell: 2 });
  addBody(world, { shape: 'seg', type: 'static', x1: -40, y1: 0, x2: 220, y2: 0, mu: 0.9, e: 0.05, tag: 'ground' });
  let potential = 0, right = 0;
  const tough = { soft: 0.6, normal: 1, tough: 1.6 }[cfg.toughness] || 1;
  for (const b of cfg.blocks) {
    const mat = MATERIAL[b.material], isStatic = b.material === 'rock';
    const scale = Math.max(0.5, Math.min(2.2, Math.sqrt(b.w * b.h)));
    const data = { kind: 'block', material: b.material, shape: b.shape, hp: mat.hp * scale * tough, max: mat.hp * scale * tough, w: b.w, h: b.h };
    const common = { type: isStatic ? 'static' : 'dynamic', density: mat.density, mu: mat.mu, e: mat.e, tag: isStatic ? 'rock' : 'block', data, adamp: 0.3 };
    let body;
    if (b.shape === 'ball') body = addBody(world, { ...common, shape: 'circle', r: b.w / 2, x: b.x, y: -(b.y + b.w / 2), adamp: 1.2 });
    else if (b.shape === 'triangle') body = addBody(world, { ...common, shape: 'poly', x: b.x, y: -(b.y + b.h / 2), verts: [[-b.w / 2, b.h / 2], [b.w / 2, b.h / 2], [0, -b.h / 2]] });
    else body = addBody(world, { ...common, shape: 'box', w: b.w, h: b.h, x: b.x, y: -(b.y + b.h / 2) });
    if (b.rope > 0 && !isStatic) {
      const top = b.shape === 'ball' ? b.w / 2 : b.h / 2;
      addDistanceJoint(world, { a: 0, la: [b.x, -(b.y + (b.shape === 'ball' ? b.w : b.h)) - b.rope], b: body.id, lb: [0, b.shape === 'triangle' ? -2 * b.h / 3 : -top], length: b.rope, rope: true, tag: 'rope' });
    }
    if (!isStatic) potential += mat.score;
    right = Math.max(right, b.x + b.w);
  }
  cfg.targets.forEach((t, i) => {
    const T = TARGET[t.size], hp = T.hp * (t.armor === 'helmet' ? 2.2 : 1) * tough;
    addBody(world, { shape: 'circle', r: T.r, x: t.x, y: -(t.y + T.r), density: 0.8, mu: 0.8, e: 0.15, adamp: 1.5, tag: 'target', data: { kind: 'target', size: t.size, armor: t.armor, hp, max: hp, index: i, hurt: 0 } });
    potential += 5000;
    right = Math.max(right, t.x + 1);
  });
  potential += Math.max(0, cfg.shots.length - 1) * 10000;
  S.world = world;
  S.m = {
    phase: 'aim', angle: 0.62, power: 0.82, queue: [...cfg.shots], shot: null, active: [], flightT: 0, quietT: 0, firstHit: -1,
    ability: false, targetsLeft: cfg.targets.length, speedMax: speedFor(cfg), potential, stars: 0, right: Math.max(right, 20), calm: true, trail: [], lastTrail: [], winT: -1, shotsFired: 0,
  };
  settle(S);
}

/** Let the structure come to rest before play (no damage), then put it to sleep. */
function settle(S) {
  const world = S.world;
  for (let i = 0; i < 180; i++) {
    stepWorld(world, 1 / 60);
    if (i > 30 && world.bodies.every(b => b.type !== 'dynamic' || b.sleeping)) break;
  }
  for (const b of world.bodies) if (b.type === 'dynamic') { b.vx = b.vy = b.av = 0; b.sleeping = true; b.idle = 0; }
  S.m.calm = false;
}

/** Launch speed at full pull: stronger when the level reaches far out, so every target is in range. */
export function speedFor(cfg) {
  const far = Math.max(0, ...cfg.targets.map(t => t.x), ...cfg.blocks.map(b => b.x));
  return Math.max(SPEED_MAX, Math.sqrt(GRAVITY * (far + 6)) * 1.15);
}

export function launchVelocity(angle, power, speedMax = SPEED_MAX) {
  const sp = speedMax * Math.max(0.2, Math.min(1, power));
  return [Math.cos(angle) * sp, -Math.sin(angle) * sp];
}

/** Launch the next projectile at an angle (radians above horizontal) and power (0..1). */
export function fire(S, angle = S.m.angle, power = S.m.power) {
  const m = S.m;
  if (m.phase !== 'aim' || !m.queue.length) return false;
  const kind = m.queue.shift(), P = PROJECTILE[kind];
  const [vx, vy] = launchVelocity(angle, power, m.speedMax);
  const b = addBody(S.world, { shape: 'circle', r: P.r, x: POUCH.x, y: POUCH.y, vx, vy, density: P.density * SPEED_MAX / m.speedMax, mu: 0.6, e: 0.3, adamp: 0.8, bullet: true, tag: 'projectile', data: { kind, hp: Infinity, impacts: 0, hurt: 0 } });
  m.shot = kind; m.active = [b.id]; m.phase = 'flight'; m.flightT = 0; m.quietT = 0; m.firstHit = -1; m.ability = kind !== 'normal'; m.shotsFired++;
  m.angle = angle; m.power = power; m.lastTrail = m.trail; m.trail = [[b.x, b.y]];
  emit(S, 'shoot', { x: b.x, y: b.y, kind, power });
  return true;
}

function explode(S, x, y, radius, strength, cause) {
  emit(S, 'explode', { x, y, r: radius, cause });
  for (const b of [...S.world.bodies]) {
    if (b.type !== 'dynamic' || b.dead) continue;
    const dx = b.x - x, dy = b.y - y, d = Math.hypot(dx, dy);
    if (d > radius + b.bound) continue;
    const k = Math.max(0, 1 - Math.max(0, d - b.bound) / radius), nx = d > 1e-6 ? dx / d : 0, ny = d > 1e-6 ? dy / d : -1;
    wake(b);
    applyImpulse(b, nx * strength * k * Math.min(2.5, b.m + 0.3), (ny - 0.35) * strength * k * Math.min(2.5, b.m + 0.3));
    if (b.data.kind === 'block' || b.data.kind === 'target') damage(S, b, 9 * k, 'blast');
  }
}

export function damage(S, b, amount, cause) {
  if (b.dead || !(amount > 0) || S.m.calm) return;
  const d = b.data;
  d.hp -= amount; d.hurt = 0.4;
  if (d.kind === 'target') emit(S, 'hit', { x: b.x, y: b.y, kind: 'target', hp: d.hp });
  if (d.hp > 0) { if (d.kind === 'block' && amount > d.max * 0.15) emit(S, 'crack', { x: b.x, y: b.y, material: d.material }); return; }
  removeBody(S.world, b);
  if (d.kind === 'target') {
    S.m.targetsLeft--;
    addScore(S, 5000, b.x, b.y - 0.6);
    emit(S, 'defeated', { x: b.x, y: b.y, r: b.r, kind: 'target', size: d.size, cause });
    if (S.m.targetsLeft === 0) { S.timeScale = 0.35; S.m.slowT = 1.1; emit(S, 'slowmo', {}); }
  } else {
    addScore(S, MATERIAL[d.material].score, b.x, b.y);
    emit(S, 'break', { x: b.x, y: b.y, material: d.material, shape: d.shape, w: d.w, h: d.h, a: b.a, cause });
    if (d.material === 'tnt') explode(S, b.x, b.y, 3.4, 13, 'tnt');
  }
}

function useAbility(S) {
  const m = S.m, b = findBody(S.world, m.active[0]);
  if (!b || !m.ability) return;
  m.ability = false;
  emit(S, 'power', { kind: m.shot, x: b.x, y: b.y });
  if (m.shot === 'split') {
    for (const turn of [-0.2, 0.2]) {
      const c = Math.cos(turn), s = Math.sin(turn);
      const nb = addBody(S.world, { shape: 'circle', r: 0.3, x: b.x, y: b.y, vx: c * b.vx - s * b.vy, vy: s * b.vx + c * b.vy, density: 2.6, mu: 0.6, e: 0.3, adamp: 0.8, bullet: true, tag: 'projectile', data: { kind: 'split', hp: Infinity, impacts: 0, hurt: 0, child: true } });
      m.active.push(nb.id);
    }
  } else if (m.shot === 'boost') { b.vx *= 2.1; b.vy *= 2.1; }
  else if (m.shot === 'heavy') { b.vx *= 0.35; b.vy = Math.max(b.vy, 0) + 24; b.invM /= 2.5; b.invI /= 2.5; b.m *= 2.5; }
  else if (m.shot === 'bomb') { removeBody(S.world, b); m.active = m.active.filter(id => id !== b.id); explode(S, b.x, b.y, 3.6, 15, 'bomb'); }
}

export function ambient(S) { stepWorld(S.world, 1 / 60); }

export function step(S, level, inp, press) {
  const m = S.m, base = 1 / 60;
  if (m.phase === 'aim') {
    m.angle = Math.max(-0.5, Math.min(1.4, m.angle - inp.y * 0.85 * base));
    m.power = Math.max(0.2, Math.min(1, m.power - inp.x * 0.7 * base));
    stepWorld(S.world, base);
    if (m.targetsLeft === 0) { endShot(S); return; } // foes defeated between shots (e.g. by a mod)
    if (press.a) fire(S);
    return;
  }
  // Slow motion after the last foe falls.
  if (m.slowT > 0) { m.slowT -= base; S.timeScale = m.slowT > 0 ? 0.35 : 1; }
  const dt = base * S.timeScale;
  if (m.phase === 'flight' && (press.a || press.b) && m.ability && m.flightT > 0.08) useAbility(S);
  stepWorld(S.world, dt);
  m.flightT += dt;
  const by = bodyIndex(S.world);
  const lead = by.get(m.active[0]);
  if (lead && m.flightT < 6 && S.frame % 2 === 0) m.trail.push([lead.x, lead.y]);
  // Impacts: damage both sides by the impulse beyond what a piece shrugs off.
  for (const c of S.world.contacts) {
    const A = by.get(c.a), B = by.get(c.b);
    if (!A || !B || c.sensor) continue;
    const dmg = c.impulse - DAMAGE_FLOOR;
    for (const [X, Y] of [[A, B], [B, A]]) {
      if (X.tag === 'projectile' && c.begin && c.speed > 2) {
        X.data.impacts++;
        if (m.firstHit < 0) { m.firstHit = m.flightT; if (m.shot === 'split' && m.ability) m.ability = false; }
        emit(S, 'impact', { x: c.x, y: c.y, speed: c.speed, material: Y.data?.material || Y.tag, impulse: c.impulse });
      }
      if (dmg > 0 && (X.tag === 'block' || X.tag === 'target')) damage(S, X, dmg * (Y.tag === 'projectile' ? 1.15 : 1), Y.tag === 'projectile' ? 'shot' : 'impact');
    }
    if (c.begin && c.speed > 3 && (A.tag === 'block' || B.tag === 'block') && A.tag !== 'projectile' && B.tag !== 'projectile') emit(S, 'thud', { x: c.x, y: c.y, speed: c.speed, material: (A.tag === 'block' ? A : B).data.material });
  }
  // Bombs go off shortly after their first impact.
  if (m.shot === 'bomb' && m.ability && m.firstHit >= 0 && m.flightT - m.firstHit > 0.9) useAbility(S);
  // Foes that fall off the world or out of bounds are defeated; stray projectiles are removed.
  for (const b of [...S.world.bodies]) {
    if (b.dead || b.type !== 'dynamic') continue;
    if (b.y > 6 || b.x < -30 || b.x > m.right + 30) {
      if (b.tag === 'target') { b.data.hp = 0; damage(S, b, 1, 'fall'); }
      else removeBody(S.world, b);
    }
    if (b.data?.hurt > 0) b.data.hurt = Math.max(0, b.data.hurt - dt);
  }
  m.active = m.active.filter(id => by.get(id) && !by.get(id).dead);
  if (m.phase === 'flight') {
    const moving = S.world.bodies.some(b => b.type === 'dynamic' && !b.sleeping && !b.dead && (b.tag !== 'projectile' || Math.hypot(b.vx, b.vy) > 0.4));
    m.quietT = moving ? 0 : m.quietT + dt;
    const done = m.targetsLeft === 0 ? (m.winT < 0 ? (m.winT = m.flightT, false) : m.flightT - m.winT > 1.6)
      : (m.flightT > QUIET_MIN && m.quietT > 0.35) || m.flightT > FLIGHT_MAX;
    if (done) endShot(S);
  }
}

function endShot(S) {
  const m = S.m;
  m.active = []; S.timeScale = 1;
  if (m.targetsLeft === 0) {
    const bonus = m.queue.length * 10000;
    if (bonus) addScore(S, bonus);
    m.stars = 1 + (S.levelScore >= m.potential * 0.42 ? 1 : 0) + (S.levelScore >= m.potential * 0.62 ? 1 : 0);
    m.phase = 'done';
    emit(S, 'stars', { stars: m.stars, bonus });
    banner(S, 'LEVEL CLEAR', 'stars');
    clearLevel(S, { stars: m.stars });
    return;
  }
  if (!m.queue.length) { m.phase = 'done'; loseLife(S, `Out of shots: ${m.targetsLeft} ${S.cast.foe} still standing`, { retry: true }); return; }
  m.phase = 'aim';
  emit(S, 'ready', { kind: m.queue[0] });
}

/** Points along the launch arc for the aiming preview. */
export function preview(angle, power, seconds = 0.75, speedMax = SPEED_MAX) {
  const [vx, vy] = launchVelocity(angle, power, speedMax), pts = [];
  for (let t = 0.06; t <= seconds; t += 0.06) pts.push([POUCH.x + vx * t, POUCH.y + vy * t + 0.5 * GRAVITY * t * t]);
  return pts;
}

/** Launch angles (radians above horizontal) that put the projectile through (x, y) at this power. */
export function aimAt(x, y, power, speedMax = SPEED_MAX) {
  const v = speedMax * power, dx = x - POUCH.x, dy = -(y - POUCH.y), g = GRAVITY;
  const disc = v ** 4 - g * (g * dx * dx + 2 * dy * v * v);
  if (disc < 0 || dx <= 0) return [];
  const r = Math.sqrt(disc);
  return [Math.atan((v * v - r) / (g * dx)), Math.atan((v * v + r) / (g * dx))];
}

/** Bot: aim the low arc at the nearest standing foe at full power, then release. */
export function bot(S) {
  const m = S.m, out = { x: 0, y: 0, a: false, b: false };
  if (m.phase !== 'aim') return out;
  const t = S.world.bodies.find(b => b.tag === 'target' && !b.dead);
  if (!t) return out;
  if (m.power < 0.99) { out.x = -1; return out; }
  const want = aimAt(t.x, t.y, m.power, m.speedMax)[0];
  if (want == null) { out.a = true; return out; }
  const d = want - m.angle;
  if (Math.abs(d) > 0.012) out.y = d > 0 ? -1 : 1; else out.a = S.frame % 2 === 0;
  return out;
}
