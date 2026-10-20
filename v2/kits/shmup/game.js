// Shmup-kit simulation: pure, deterministic, fixed 1/60 s steps. All state is
// plain JSON (structuredClone is a save); randomness comes only from
// kernel/rng.js with its state in state.rng.
//
// Four stage modes share one player, weapon, bullet, scoring and boss system:
//   fixed      Galaga/Invaders formation with entry paths, dives, marching, bunkers
//   vertical   scrolling waves on heading+turn entries, behaviors, turrets, bosses
//   twinstick  arena with telegraphed spawns, auto-aim, swarm behaviors, black holes
//   asteroids  inertia ship, wraparound, splitting rocks, saucers
import { random, seedFrom } from '../../kernel/rng.js';
import { FORMATION_CAP } from './content.js';

export const DT = 1 / 60;
const TAU = Math.PI * 2, SQ = Math.SQRT1_2;
export const WORLD = { fixed: { W: 300, H: 400 }, vertical: { W: 300, H: 400 }, twinstick: { W: 480, H: 360 }, asteroids: { W: 480, H: 360 } };
export const TIMING = { intro: 150, warn: 150, clear: 200, respawn: 70, invuln: 150, bossLimit: 80 * 60 };
export const RADIUS = { small: 8, medium: 11, large: 15 };
export const HITBOX = { fixed: 4, vertical: 3, twinstick: 6, asteroids: 7 };
export const BODY = { fixed: 8, vertical: 7, twinstick: 8, asteroids: 9 };
const DIFF = { easy: { bs: 0.8, fr: 0.7 }, normal: { bs: 1, fr: 1 }, hard: { bs: 1.2, fr: 1.3 } };
const BULLET_CAP = { fixed: 24, vertical: 140, twinstick: 80, asteroids: 16 };
const BULLET_SPEED = 115, SCROLL = 40;
export const ROCK_R = [0, 9, 17, 30], ROCK_PTS = [0, 100, 50, 20];
const DIVERS = new Set(['dive', 'swoop', 'zigzag', 'chase', 'sine', 'straight']);
const COLS = 10;
export const WEAPON_DPS = { shot: [1, 2, 3], spread: [2.1, 3.5, 4.9], laser: [1.3, 1.7, 2.2], homing: [1.6, 2.2, 2.8] }; // damage per volley by tier

const rnd = s => random(s);
const range = (s, a, b) => a + rnd(s) * (b - a);
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
const angTo = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
const wrapAng = a => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
const steer = (cur, target, max) => cur + clamp(wrapAng(target - cur), -max, max);
const emit = (s, name, data = {}) => s.events.push({ name, ...data });

export function createGame(content, { seed = 1 } = {}) {
  const C = content;
  const D = DIFF[C.difficulty] || DIFF.normal;
  const enemyById = new Map(C.enemies.map(e => [e.id, e]));
  const bossById = new Map(C.bosses.map(b => [b.id, b]));
  const stageOf = s => C.stages[s.stage];
  const scale = s => ({ hp: 1 + 0.3 * s.loop, speed: 1 + 0.1 * s.loop, fire: 1 + 0.2 * s.loop, pts: 1 + s.loop });
  const nameOf = id => id === '$rock' ? 'an asteroid' : enemyById.get(id)?.name || bossById.get(id)?.name || 'enemy fire';

  // ---------- state ----------
  function createState({ stage = 0 } = {}) {
    const s = {
      status: 'playing', score: 0, events: [], reason: '', t: 0, rng: seedFrom(`shmup|${seed}`),
      loop: 0, stage: 0, mode: 'fixed', W: 300, H: 400, phase: 'intro', phaseT: 0, stageT: 0, freeze: 0,
      lives: C.player.lives, bombs: C.player.bombs, weapon: { kind: 'shot', tier: 1 }, nextLife: C.extraLifeEvery || 0,
      chain: 0, chainT: 0, bestChain: 0, dropMeter: 0, nextId: 1, scroll: 0,
      prev: { x: 0, y: 0, a: false, b: false },
      stats: { kills: 0, spawned: 0, deaths: 0, shots: 0, hits: 0, bombsUsed: 0, escaped: 0 },
      player: null, enemies: [], pbullets: [], ebullets: [], pickups: [], warns: [], queue: [], bunkers: [], boss: null, bossDone: false,
      formation: null, stageStats: null, clear: null,
    };
    startStage(s, clamp(stage | 0, 0, C.stages.length - 1));
    s.events = [];
    return s;
  }

  function spawnPoint(s) {
    const { W, H } = s;
    return s.mode === 'fixed' ? [W / 2, H - 26] : s.mode === 'vertical' ? [W / 2, H - 50] : [W / 2, H / 2];
  }
  function placePlayer(s, invuln = TIMING.invuln) {
    const [x, y] = spawnPoint(s);
    s.player = { x, y, vx: 0, vy: 0, ang: -Math.PI / 2, alive: true, respawn: 0, invuln, fireCd: 0, shield: s.player?.shield || false, aimAng: -Math.PI / 2, thrust: false, hyperCd: 0, pulled: 0 };
  }

  function startStage(s, i) {
    const st = C.stages[i];
    s.stage = i; s.mode = st.mode; s.W = WORLD[st.mode].W; s.H = WORLD[st.mode].H;
    s.phase = 'intro'; s.phaseT = 0; s.stageT = 0; s.waveIdx = 0; s.lastWaveT = 0;
    s.enemies = []; s.pbullets = []; s.ebullets = []; s.pickups = []; s.warns = []; s.queue = []; s.boss = null; s.bossDone = false; s.clear = null;
    s.formation = st.mode === 'fixed' ? { x: s.W / 2, y: 62, dir: 1, stepT: 30, t: 0, used: 0, march: st.march, frame: 0, diveT: 200, breathe: 0 } : null;
    s.bunkers = st.shields ? makeBunkers(s) : [];
    s.stageStats = { kills: 0, spawned: 0, deaths: 0, shots: 0, hits: 0 };
    placePlayer(s, 0);
    emit(s, 'stage_start', { stage: i, mode: st.mode, name: st.name });
  }

  function makeBunkers(s) {
    const out = [], cols = 12, rows = 7, cell = 3;
    for (let k = 0; k < 4; k++) {
      const cells = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const corner = (r === 0 && (c < 2 || c > 9)) || (r === 1 && (c === 0 || c === 11));
        const arch = r >= 4 && c >= 4 && c <= 7;
        cells.push(corner || arch ? 0 : 1);
      }
      out.push({ x: Math.round(s.W * (k + 1) / 5 - cols * cell / 2), y: s.H - 74, cols, rows, cell, cells });
    }
    return out;
  }

  // ---------- step ----------
  function step(s, inp = {}) {
    s.events = [];
    if (s.status !== 'playing') return s;
    if (s.freeze > 0) { s.freeze--; return s; }
    const i = { x: Math.sign(inp.x || 0), y: Math.sign(inp.y || 0), a: !!inp.a, b: !!inp.b };
    const press = { b: i.b && !s.prev.b, down: i.y > 0 && s.prev.y <= 0 };
    s.prev = i;
    s.t++;
    if (s.chainT > 0 && --s.chainT === 0) s.chain = 0;
    phaseStep(s);
    if (s.status !== 'playing') return s;
    playerStep(s, i, press);
    if (s.mode === 'fixed') formationStep(s);
    enemiesStep(s);
    warnStep(s);
    bossStep(s);
    bulletsStep(s);
    collide(s);
    pickupsStep(s);
    s.enemies = s.enemies.filter(e => !e.dead);
    s.pbullets = s.pbullets.filter(b => !b.dead);
    s.ebullets = s.ebullets.filter(b => !b.dead);
    s.pickups = s.pickups.filter(p => !p.dead);
    return s;
  }

  function phaseStep(s) {
    s.phaseT++;
    const st = stageOf(s);
    if (s.mode === 'vertical') s.scroll += SCROLL * DT;
    if (s.phase === 'intro') {
      if (s.phaseT >= TIMING.intro) { s.phase = 'play'; s.phaseT = 0; if (s.mode === 'asteroids') spawnRocks(s, st.rocks); emit(s, 'stage_go'); }
    } else if (s.phase === 'play') {
      s.stageT++;
      while (s.waveIdx < st.waves.length && st.waves[s.waveIdx].at * 60 <= s.stageT) { spawnWave(s, st.waves[s.waveIdx], s.waveIdx); s.waveIdx++; s.lastWaveT = s.stageT; }
      queueStep(s);
      const wavesDone = s.waveIdx >= st.waves.length && !s.queue.length && !s.warns.length;
      if (wavesDone) {
        if (st.boss && !s.bossDone) {
          if (!s.enemies.length || s.stageT - s.lastWaveT > 60 * 10) { s.phase = 'warn'; s.phaseT = 0; emit(s, 'boss_warning', { boss: st.boss }); }
        } else if (!s.enemies.length) stageClear(s);
      }
    } else if (s.phase === 'warn') {
      queueStep(s);
      if (s.phaseT >= TIMING.warn) { s.phase = 'boss'; s.phaseT = 0; spawnBoss(s); }
    } else if (s.phase === 'boss') {
      if (s.bossDone && !s.enemies.length && !s.warns.length) stageClear(s);
    } else if (s.phase === 'clear') {
      if (s.phaseT >= TIMING.clear) {
        let next = s.stage + 1;
        if (next >= C.stages.length) {
          if (!C.endless) { s.status = 'won'; emit(s, 'won'); return; }
          s.loop++; next = 0;
        }
        startStage(s, next);
      }
    }
  }

  function stageClear(s) {
    const st = s.stageStats, acc = st.shots ? Math.min(1, st.hits / st.shots) : 0;
    const bonus = 1000 * (s.stage + 1) * (1 + s.loop) + (st.deaths === 0 ? 5000 : 0) + Math.round(acc * 20) * 100;
    s.clear = { bonus, kills: st.kills, spawned: st.spawned, accuracy: Math.round(acc * 100), perfect: st.deaths === 0 };
    cancelBullets(s);
    addScore(s, bonus);
    s.phase = 'clear'; s.phaseT = 0;
    emit(s, 'level_up', { stage: s.stage }); emit(s, 'stage_clear', { bonus, perfect: st.deaths === 0 });
  }

  function addScore(s, n) {
    s.score += Math.round(n);
    while (s.nextLife > 0 && s.score >= s.nextLife) {
      s.nextLife += C.extraLifeEvery;
      if (s.lives < 9) { s.lives++; emit(s, 'extra_life', { lives: s.lives }); }
    }
  }

  // ---------- player ----------
  function playerStep(s, i, press) {
    const p = s.player, { W, H } = s;
    if (!p.alive) { p.respawn--; if (p.respawn <= 0) tryRespawn(s); return; }
    if (p.invuln > 0) p.invuln--;
    if (p.hyperCd > 0) p.hyperCd--;
    if (p.pulled > 0) p.pulled--;
    const sp = C.player.speed;
    if (s.mode === 'asteroids') {
      p.ang += i.x * 4.6 * DT;
      p.thrust = i.y < 0;
      if (p.thrust) { p.vx += Math.cos(p.ang) * 300 * DT; p.vy += Math.sin(p.ang) * 300 * DT; }
      const drag = 1 - 0.55 * DT; p.vx *= drag; p.vy *= drag;
      const v = Math.hypot(p.vx, p.vy), max = sp * 1.5;
      if (v > max) { p.vx *= max / v; p.vy *= max / v; }
      p.x = (p.x + p.vx * DT + W) % W; p.y = (p.y + p.vy * DT + H) % H;
      if (press.down && p.hyperCd <= 0) {
        p.x = range(s, 30, W - 30); p.y = range(s, 30, H - 30); p.vx *= 0.3; p.vy *= 0.3; p.hyperCd = 120; p.invuln = Math.max(p.invuln, 20);
        emit(s, 'hyperspace', { x: p.x, y: p.y });
      }
    } else {
      let dx = i.x, dy = s.mode === 'fixed' ? 0 : i.y;
      if (dx && dy) { dx *= SQ; dy *= SQ; }
      p.vx = dx * sp; p.vy = dy * sp;
      p.x = clamp(p.x + p.vx * DT, 10, W - 10);
      if (s.mode !== 'fixed') p.y = clamp(p.y + p.vy * DT, s.mode === 'vertical' ? 30 : 10, H - (s.mode === 'vertical' ? 14 : 10));
      if (s.mode === 'twinstick') {
        if (dx || dy) p.aimAng = Math.atan2(dy, dx);
        const t = nearestTarget(s, p.x, p.y, 300);
        p.ang = t ? Math.atan2(t.y - p.y, t.x - p.x) : p.aimAng;
      } else p.ang = -Math.PI / 2;
    }
    if (p.fireCd > 0) p.fireCd--;
    if (i.a && p.fireCd <= 0 && s.phase !== 'clear') {
      if (s.mode !== 'asteroids' || s.pbullets.length < 10) fire(s);
      p.fireCd += 60 / (C.player.fireRate * (s.weapon.kind === 'laser' ? 1.15 : 1));
    } else if (p.fireCd < 0) p.fireCd = 0;
    if (press.b && s.bombs > 0) bomb(s);
  }

  function nearestTarget(s, x, y, maxD = 1e9) {
    let best = null, bd = maxD * maxD;
    for (const e of s.enemies) {
      if (e.dead || !e.onScreen) continue;
      const d = (e.x - x) ** 2 + (e.y - y) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    const b = s.boss;
    if (b && b.st === 'fight') { const d = (b.x - x) ** 2 + (b.y - y) ** 2; if (d < bd) best = b; }
    return best;
  }

  function fire(s) {
    const p = s.player, w = s.weapon, a0 = p.ang, tier = w.tier;
    const nx = p.x + Math.cos(a0) * 10, ny = p.y + Math.sin(a0) * 10, px = -Math.sin(a0), py = Math.cos(a0);
    const life = s.mode === 'asteroids' ? 50 : 120;
    const shot = (off, da = 0, extra = {}) => {
      const a = a0 + da, v = extra.v || 520, inherit = s.mode === 'asteroids' ? 0.6 : 0;
      s.pbullets.push({ x: nx + px * off, y: ny + py * off, vx: Math.cos(a) * v + p.vx * inherit, vy: Math.sin(a) * v + p.vy * inherit, dmg: 1, r: 3, k: 'shot', life, ...extra });
      s.stats.shots++; s.stageStats.shots++;
    };
    if (w.kind === 'spread') {
      const n = [3, 5, 7][tier - 1], span = [0.2, 0.36, 0.5][tier - 1];
      for (let k = 0; k < n; k++) shot(0, -span + (2 * span * k) / (n - 1), { dmg: 0.7, k: 'spread' });
    } else if (w.kind === 'laser') {
      shot(0, 0, { v: 900, dmg: 0.8 + 0.35 * tier, r: 2 + tier, k: 'laser', pierce: true, hit: [] });
      if (tier === 3) { shot(-7, 0, { v: 900, dmg: 0.6, r: 2, k: 'laser', pierce: true, hit: [] }); shot(7, 0, { v: 900, dmg: 0.6, r: 2, k: 'laser', pierce: true, hit: [] }); }
    } else {
      const lanes = [[0], [-4, 4], [-6, 0, 6]][w.kind === 'homing' ? 0 : tier - 1];
      for (const off of lanes) shot(off);
      if (w.kind === 'homing' && (p.volley = (p.volley || 0) + 1) % 2 === 0) {
        const n = tier;
        for (let k = 0; k < n; k++) {
          const side = k % 2 ? 1 : -1, spread = 0.7 + 0.25 * Math.floor(k / 2);
          shot(side * 6, side * spread, { v: 280, dmg: 1.2, r: 3, k: 'missile', life: 150 });
        }
      }
    }
    emit(s, 'shoot', { x: nx, y: ny, kind: w.kind });
  }

  function bomb(s) {
    const p = s.player;
    if (!p.alive) return;
    s.bombs--; s.stats.bombsUsed++;
    cancelBullets(s);
    for (const e of [...s.enemies]) if (!e.dead && e.onScreen && e.st !== 'enter') damageEnemy(s, e, 8, true);
    const b = s.boss;
    if (b && b.st === 'fight') { b.invuln = 0; damageBoss(s, Math.max(10, b.maxHp * 0.05)); }
    p.invuln = Math.max(p.invuln, 90);
    s.freeze = 4;
    emit(s, 'bomb', { x: p.x, y: p.y });
  }

  function cancelBullets(s, near = null) {
    const pts = [];
    for (const b of s.ebullets) {
      if (b.dead) continue;
      if (near && (b.x - near.x) ** 2 + (b.y - near.y) ** 2 > near.r * near.r) continue;
      b.dead = true; if (pts.length < 80) pts.push([Math.round(b.x), Math.round(b.y)]);
    }
    if (pts.length) { if (!near) addScore(s, pts.length * 10); emit(s, 'cancel', { pts }); }
  }

  function hitPlayer(s, cause) {
    const p = s.player;
    if (!p.alive || p.invuln > 0 || s.phase === 'clear' || s.status !== 'playing') return;
    if (p.shield) {
      p.shield = false; p.invuln = 60; cancelBullets(s, { x: p.x, y: p.y, r: 70 });
      emit(s, 'shield_break', { x: p.x, y: p.y }); return;
    }
    p.alive = false; p.respawn = TIMING.respawn; p.vx = p.vy = 0;
    s.lives--; s.stats.deaths++; s.stageStats.deaths++;
    s.chain = 0; s.chainT = 0;
    const w = s.weapon;
    if (w.tier > 1) w.tier--; else w.kind = 'shot';
    s.freeze = 8;
    emit(s, 'hurt', { x: p.x, y: p.y, cause });
    if (s.lives <= 0) { s.status = 'lost'; s.reason = cause; emit(s, 'lost', { cause }); }
  }

  function tryRespawn(s) {
    const [x, y] = spawnPoint(s);
    if (s.mode === 'asteroids' && s.player.respawn > -180 && s.enemies.some(e => (e.x - x) ** 2 + (e.y - y) ** 2 < (e.r + 60) ** 2)) return;
    placePlayer(s);
    cancelBullets(s, { x, y, r: 90 });
    emit(s, 'respawn', { x, y });
  }

  // ---------- spawning ----------
  function makeEnemy(s, type, x, y, ang, extra = {}) {
    const L = scale(s), hp = type.hp * L.hp;
    const e = {
      id: s.nextId++, type: type.id, mv: type.move, x, y, bx: x, by: y, vx: 0, vy: 0, ang, face: ang, r: RADIUS[type.size] || 8,
      hp, maxHp: hp, speed: type.speed * L.speed, fire: type.fire, fireRate: type.fireRate * D.fr * L.fire, points: type.points * L.pts,
      t: 0, st: 'act', slot: -1, fireCd: 40 + rnd(s) * 60, flash: 0, spin: rnd(s) * TAU, turn: 0, turnT: 0, turnAt: 0, onScreen: false,
      gen: 0, sub: 0, subT: 0, burst: 0, burstGap: 0, eaten: 0, hy: 0, tx: x, ty: y, ...extra,
    };
    // Armored tails need room to trail; in a fixed formation a snake is a plain diver.
    if (e.mv === 'snake' && s.mode !== 'fixed') { e.segs = []; for (let k = 0; k < 10; k++) e.segs.push(x, y); }
    s.enemies.push(e); s.stats.spawned++; s.stageStats.spawned++;
    return e;
  }

  function queueStep(s) {
    if (!s.queue.length) return;
    const keep = [];
    for (const q of s.queue) {
      if (--q.d > 0) { keep.push(q); continue; }
      if (q.warn) { s.warns.push({ x: q.x, y: q.y, t: q.warn, total: q.warn, type: q.type, ang: q.ang, extra: q.extra }); emit(s, 'spawn_warn', { x: q.x, y: q.y }); }
      else makeEnemy(s, enemyById.get(q.type), q.x, q.y, q.ang, q.extra);
    }
    s.queue = keep;
  }
  function warnStep(s) {
    if (!s.warns.length) return;
    for (const w of s.warns) if (--w.t <= 0) { const e = makeEnemy(s, enemyById.get(w.type), w.x, w.y, w.ang, w.extra); e.onScreen = true; emit(s, 'spawn', { x: w.x, y: w.y }); }
    s.warns = s.warns.filter(w => w.t > 0);
  }

  function spawnWave(s, w, wi) {
    const type = enemyById.get(w.enemy);
    if (!type) return;
    const n = w.count, { W, H } = s, q = (d, x, y, ang, extra = {}, warn = 0) => s.queue.push({ d: Math.max(1, Math.round(d)), type: type.id, x, y, ang, extra, warn });
    if (type.move === 'saucer') {
      for (let k = 0; k < n; k++) { const left = (wi + k) % 2 === 0; q(k * 90, left ? -20 : W + 20, range(s, H * 0.15, H * 0.55), left ? 0 : Math.PI, { onScreen: s.mode === 'asteroids' }); }
      return;
    }
    if (s.mode === 'fixed') {
      const f = s.formation, dir0 = wi % 2 ? 1 : -1;
      for (let k = 0; k < n; k++) {
        const slot = f.used < FORMATION_CAP ? f.used++ : -1;
        const side = w.entry === 'sides' ? (k % 2 ? 1 : -1) : w.entry === 'left-arc' ? -1 : w.entry === 'right-arc' ? 1 : dir0;
        const pts = entryPath(s, w.entry, side, k, n, slot);
        const gap = w.entry === 'top-line' || w.entry === 'v-formation' ? 3 : w.entry === 'sides' ? 5 : 8;
        q(k * gap, pts[0][0], pts[0][1], Math.PI / 2, { st: slot >= 0 ? 'enter' : 'act', path: { pts, i: 0, u: 0 }, slot });
      }
      return;
    }
    if (s.mode === 'vertical') {
      for (let k = 0; k < n; k++) {
        if (type.move === 'turret') { q(k * 50, W * (0.2 + 0.6 * ((k * 0.618 + wi * 0.3) % 1)), -20, Math.PI / 2); continue; }
        const hy = { hy: range(s, 60, 150) };
        const side = wi % 2 ? 1 : -1;
        switch (w.entry) {
          case 'top-line': q(1 + k * 2, W * (k + 1) / (n + 1), -16, Math.PI / 2, hy); break;
          case 'left-arc': q(k * 12, -16, 50, 0.35, { turn: 0.9, turnT: 100, ...hy }); break;
          case 'right-arc': q(k * 12, W + 16, 50, Math.PI - 0.35, { turn: -0.9, turnT: 100, ...hy }); break;
          case 'loop': q(k * 10, side < 0 ? 60 : W - 60, -16, Math.PI / 2, { turn: side < 0 ? -2.6 : 2.6, turnT: 145, turnAt: 50, ...hy }); break;
          case 'v-formation': { const o = k - (n - 1) / 2; q(1, W / 2 + o * 22, -16 - Math.abs(o) * 16, Math.PI / 2, hy); break; }
          case 'sides': { const sd = k % 2 ? 1 : -1; q((k >> 1) * 10, sd < 0 ? -16 : W + 16, 60 + (k >> 1) * 22, sd < 0 ? 0.4 : Math.PI - 0.4, { turn: sd < 0 ? 0.7 : -0.7, turnT: 80, ...hy }); break; }
          default: q(k * 14, range(s, 20, W - 20), -16, Math.PI / 2 + range(s, -0.2, 0.2), hy);
        }
      }
      return;
    }
    // Arena modes: telegraphed spawns at edges, corners, a portal or a ring around the ship.
    const p = s.player, warn = s.mode === 'twinstick' ? 45 : 30, m = 16;
    let pc = null;
    if (w.entry === 'portal' || type.move === 'gravity') {
      for (let tries = 0; tries < 8; tries++) { pc = [range(s, 60, W - 60), range(s, 60, H - 60)]; if ((pc[0] - p.x) ** 2 + (pc[1] - p.y) ** 2 > 160 * 160) break; }
    }
    for (let k = 0; k < n; k++) {
      let x, y;
      if (pc) { const a = k / n * TAU, r = n > 1 ? 26 : 0; x = pc[0] + Math.cos(a) * r; y = pc[1] + Math.sin(a) * r; }
      else if (w.entry === 'corners') { const c = k % 4; x = c % 2 ? W - m - range(s, 0, 24) : m + range(s, 0, 24); y = c > 1 ? H - m - range(s, 0, 24) : m + range(s, 0, 24); }
      else if (w.entry === 'ring') { const a = k / n * TAU; x = clamp(p.x + Math.cos(a) * 150, m, W - m); y = clamp(p.y + Math.sin(a) * 150, m, H - m); }
      else if (w.entry === 'sides') { x = k % 2 ? W - m : m; y = H * (0.2 + 0.6 * ((k >> 1) + 0.5) / Math.ceil(n / 2)); }
      else if (w.entry === 'top-line') { x = W * (k + 1) / (n + 1); y = m; }
      else {
        const e = Math.floor(rnd(s) * 4), u = rnd(s);
        [x, y] = e === 0 ? [m + u * (W - 2 * m), m] : e === 1 ? [W - m, m + u * (H - 2 * m)] : e === 2 ? [m + u * (W - 2 * m), H - m] : [m, m + u * (H - 2 * m)];
        if ((x - p.x) ** 2 + (y - p.y) ** 2 < 110 * 110) { x = W - x; y = H - y; }
      }
      q(1 + k * 4, x, y, Math.atan2(p.y - y, p.x - x), {}, warn);
    }
  }

  function entryPath(s, entry, side, k, n, slot) {
    const { W } = s, mx = x => side < 0 ? x : W - x;
    const [sx, sy] = slot >= 0 ? slotPos(s, slot) : [W / 2, 80];
    switch (entry) {
      case 'top-line': return [[sx, -20], [sx, 20]];
      case 'v-formation': return [[W / 2 + side * 6, -20], [W / 2 + (k - (n - 1) / 2) * 16, 70]];
      case 'loop': return [[mx(130), -20], [mx(140), 90], [mx(90), 190], [mx(40), 170], [mx(60), 110], [mx(120), 120]];
      default: return [[mx(-20), 330], [mx(50), 280], [mx(110), 210], [mx(120), 140], [mx(80), 110]];
    }
  }

  function spawnRocks(s, n) {
    const p = s.player;
    for (let k = 0; k < n; k++) {
      let x = 0, y = 0;
      for (let tries = 0; tries < 10; tries++) { x = range(s, 0, s.W); y = range(s, 0, s.H); if ((x - p.x) ** 2 + (y - p.y) ** 2 > 140 * 140) break; }
      makeRock(s, x, y, 3, rnd(s) * TAU, range(s, 18, 42) * scale(s).speed);
    }
  }
  function makeRock(s, x, y, tier, ang, speed) {
    const e = { id: s.nextId++, type: '$rock', mv: 'rock', st: 'act', x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, ang, face: 0, r: ROCK_R[tier], tier, hp: tier === 3 ? 2 : 1, maxHp: tier === 3 ? 2 : 1, points: ROCK_PTS[tier] * scale(s).pts, fire: 'none', fireRate: 0, t: 0, flash: 0, spin: range(s, -1.5, 1.5), seed: Math.floor(rnd(s) * 1e6), onScreen: true, slot: -1 };
    s.enemies.push(e); s.stats.spawned++; s.stageStats.spawned++;
    return e;
  }

  // ---------- formation (fixed mode) ----------
  function slotPos(s, slot) {
    const f = s.formation, c = slot % COLS, r = Math.floor(slot / COLS);
    const spread = f.march ? 1 : 1 + 0.07 * Math.sin(f.t * 0.05) * f.breathe;
    return [f.x + (c - (COLS - 1) / 2) * 24 * spread, f.y + r * 22 * (f.march ? 1 : 1 + (spread - 1) * 0.6)];
  }

  function formationStep(s) {
    const f = s.formation, st = stageOf(s);
    f.t++;
    const all = s.enemies.filter(e => e.slot >= 0 && !e.dead), settled = all.filter(e => e.st === 'formation');
    const allIn = s.waveIdx >= st.waves.length && !s.queue.length && all.every(e => e.st !== 'enter' && e.st !== 'join');
    if (f.march) {
      if (--f.stepT <= 0) {
        f.stepT = Math.max(3, Math.round(4 + 36 * all.length / Math.max(1, f.used)));
        let lo = Infinity, hi = -Infinity;
        for (const e of settled) { lo = Math.min(lo, e.x); hi = Math.max(hi, e.x); }
        if (settled.length && ((f.dir > 0 && hi + 6 > s.W - 12) || (f.dir < 0 && lo - 6 < 12))) { f.dir = -f.dir; f.y += 10; }
        else f.x += f.dir * 6;
        f.frame ^= 1;
        emit(s, 'march', { frame: f.frame });
      }
      const p = s.player;
      if (p.alive && settled.some(e => e.y + e.r >= p.y - 14)) { hitPlayerForced(s, 'Overrun by the formation'); f.y = Math.max(62, f.y - 90); }
    } else {
      f.x = s.W / 2 + Math.sin(f.t * 0.018) * 26;
      f.breathe = Math.min(1, f.breathe + (allIn ? 0.01 : 0));
      if (f.t % 30 === 0) f.frame ^= 1;
    }
    // Dive attacks: a leader (plus escorts of its kind beside it) peels off on a curved path.
    if (s.phase === 'play' && --f.diveT <= 0) {
      const frac = all.length / Math.max(1, f.used);
      f.diveT = Math.max(45, Math.round((130 - 70 * (1 - frac)) / D.fr * (f.march ? 2.2 : 1) * range(s, 0.8, 1.2)));
      const cands = settled.filter(e => DIVERS.has(e.mv));
      if (cands.length && s.player.alive) {
        const lead = cands[Math.floor(rnd(s) * cands.length)];
        launchDive(s, lead, 0);
        let escorts = 0;
        for (const e of cands) if (e !== lead && escorts < 2 && e.type === lead.type && Math.abs(e.x - lead.x) < 30 && Math.abs(e.y - lead.y) < 26) { launchDive(s, e, ++escorts); }
      }
    }
  }

  function launchDive(s, e, escort) {
    const p = s.player, { W, H } = s, side = e.x < W / 2 ? -1 : 1, tx = clamp(p.x + escort * side * 14, 20, W - 20), ty = p.y;
    let pts;
    if (e.mv === 'swoop') pts = [[e.x, e.y], [e.x + side * 30, e.y - 24], [e.x + side * 50, e.y + 24], [tx - side * 70, ty - 70], [tx, ty - 34], [tx + side * 60, ty - 80], [W - e.x, 150], [e.x, e.y + 10]];
    else if (e.mv === 'zigzag') pts = [[e.x, e.y], [e.x + side * 20, e.y - 20], [e.x - side * 40, e.y + 60], [e.x + side * 50, e.y + 130], [tx - 40, e.y + 200], [tx + 40, H - 70], [tx, H + 40]];
    else pts = [[e.x, e.y], [e.x + side * 28, e.y - 26], [e.x + side * 48, e.y + 16], [(e.x + tx) / 2, (e.y + ty) / 2], [tx + side * 20, ty - 30], [tx - side * 30, H + 40]];
    e.st = 'dive'; e.path = { pts, i: 0, u: 0 }; e.fireCd = 20 + rnd(s) * 30; e.sub = e.mv === 'chase' ? 1 : 0; e.subT = 0;
    emit(s, 'dive', { x: e.x, y: e.y });
  }

  function followPath(e, speed) {
    const P = e.path, pts = P.pts;
    let move = speed * DT;
    while (move > 0 && P.i < pts.length - 1) {
      const a = pts[P.i], b = pts[P.i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, du = move / len;
      if (P.u + du >= 1) { move -= (1 - P.u) * len; P.u = 0; P.i++; } else { P.u += du; move = 0; }
    }
    if (P.i >= pts.length - 1) { const l = pts[pts.length - 1]; e.x = l[0]; e.y = l[1]; return true; }
    const i = P.i, p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)], u = P.u, u2 = u * u, u3 = u2 * u;
    const cr = k => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * u + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * u3);
    e.x = cr(0); e.y = cr(1);
    return false;
  }

  // ---------- enemies ----------
  function enemiesStep(s) {
    const { W, H } = s, p = s.player;
    for (const e of s.enemies) {
      if (e.dead) continue;
      const ox = e.x, oy = e.y;
      e.t++; if (e.flash > 0) e.flash--;
      if (e.mv === 'rock') {
        e.x = wrapCoord(e.x + e.vx * DT, W); e.y = wrapCoord(e.y + e.vy * DT, H);
        e.face += e.spin * DT;
        continue;
      }
      if (e.st === 'enter') { if (followPath(e, Math.max(150, e.speed * 1.2))) e.st = e.slot >= 0 ? 'join' : 'act'; }
      else if (e.st === 'join') {
        const [sx, sy] = slotPos(s, e.slot), d = Math.hypot(sx - e.x, sy - e.y), v = Math.max(150, e.speed * 1.2) * DT;
        if (d <= v) { e.x = sx; e.y = sy; e.st = 'formation'; } else { e.x += (sx - e.x) / d * v; e.y += (sy - e.y) / d * v; }
      } else if (e.st === 'formation') { const [sx, sy] = slotPos(s, e.slot); e.x = sx; e.y = sy; }
      else if (e.st === 'dive') diveStep(s, e);
      else actStep(s, e);

      e.vx = (e.x - ox) / DT; e.vy = (e.y - oy) / DT;
      if (e.st === 'formation') e.face = Math.PI / 2;
      else if (e.mv === 'turret' || e.mv === 'gravity') e.face = p.alive ? angTo(e, p) : Math.PI / 2;
      else if (e.vx * e.vx + e.vy * e.vy > 25) e.face = Math.atan2(e.vy, e.vx);
      if (!e.onScreen && e.x > -e.r && e.x < W + e.r && e.y > -e.r && e.y < H + e.r) e.onScreen = true;
      if (e.segs) snakeStep(e);
      if (e.mv === 'gravity') gravityStep(s, e);
      // Leaving the screen (scroller and stray movers).
      if (s.mode === 'vertical' || (s.mode !== 'fixed' && e.mv === 'saucer') || (s.mode === 'fixed' && e.st === 'act')) {
        const out = e.x < -40 || e.x > W + 40 || e.y > H + 40 || e.y < -60;
        if ((e.onScreen && out) || (!e.onScreen && e.t > 420)) { e.dead = true; s.stats.escaped++; continue; }
      }
      enemyFire(s, e);
    }
  }
  const wrapCoord = (v, max) => v < -30 ? v + max + 60 : v > max + 30 ? v - max - 60 : v;

  function diveStep(s, e) {
    const p = s.player, { W, H } = s, sp = Math.max(130, e.speed) * 1.1;
    if (e.sub === 1) { // chase-dive: homing for a while, then straight down
      e.subT++;
      if (e.subT < 100 && p.alive) { e.ang = steer(e.ang ?? Math.PI / 2, angTo(e, p), 2.4 * DT); }
      else e.ang = steer(e.ang, Math.PI / 2, 2 * DT);
      e.x += Math.cos(e.ang) * sp * DT; e.y += Math.sin(e.ang) * sp * DT;
      if (e.y > H + 30) { e.y = -24; e.x = slotPos(s, e.slot)[0]; e.st = 'join'; }
      return;
    }
    if (followPath(e, sp)) {
      if (e.y > H) { e.y = -24; e.x = slotPos(s, e.slot)[0]; }
      e.st = 'join';
    }
    e.x = clamp(e.x, -40, W + 40);
  }

  function actStep(s, e) {
    const p = s.player, { W, H } = s, arena = s.mode === 'twinstick' || s.mode === 'asteroids';
    const tx = p.alive ? p.x : W / 2, ty = p.alive ? p.y : H / 2;
    if (e.turnT > 0 && e.t >= e.turnAt) { e.ang += e.turn * DT; e.turnT--; }
    const fwd = sp => { e.x += Math.cos(e.ang) * sp * DT; e.y += Math.sin(e.ang) * sp * DT; };
    const lateral = (lat) => { e.bx += Math.cos(e.ang) * e.speed * DT; e.by += Math.sin(e.ang) * e.speed * DT; e.x = e.bx - Math.sin(e.ang) * lat; e.y = e.by + Math.cos(e.ang) * lat; };
    switch (e.mv) {
      case 'sine': if (arena) { e.ang += Math.sin(e.t * 0.08) * 0.05; fwd(e.speed); } else lateral(Math.sin(e.t * 0.07) * 34); break;
      case 'zigzag': if (arena) { e.ang += (Math.floor(e.t / 30) % 2 ? 1 : -1) * 0.04; fwd(e.speed); } else { const ph = (e.t / 50) % 2; lateral(((ph < 1 ? ph : 2 - ph) * 2 - 1) * 40); } break;
      case 'dive': {
        if (e.sub === 0) { fwd(e.speed); if (e.onScreen && e.t > (arena ? 50 : 40)) { e.sub = 1; e.subT = 0; } }
        else if (e.sub === 1) { e.subT++; fwd(e.speed * Math.max(0, 1 - e.subT / 14)); if (e.subT > 20) { e.sub = 2; e.subT = 0; e.ang = Math.atan2(ty - e.y, tx - e.x); } }
        else { e.subT++; fwd(e.speed * 1.9); if (arena && e.subT > 70) { e.sub = 1; e.subT = 0; } }
        break;
      }
      case 'hover': case 'formation': {
        if (arena) {
          if (e.sub === 0) { const d = Math.hypot(e.tx - e.x, e.ty - e.y); if (d < 6 || e.subT++ > 240) { e.sub = 1; e.subT = 0; } else { e.x += (e.tx - e.x) / d * e.speed * DT; e.y += (e.ty - e.y) / d * e.speed * DT; } }
          else if (++e.subT > 90) { e.sub = 0; e.subT = 0; e.tx = range(s, 40, W - 40); e.ty = range(s, 40, H - 40); }
          if (e.t === 1) { e.tx = range(s, 40, W - 40); e.ty = range(s, 40, H - 40); }
        } else if (e.sub === 0) { fwd(e.speed); if (e.y >= e.hy && e.onScreen) { e.sub = 1; e.subT = 0; e.bx = e.x; e.by = e.y; } }
        else if (e.sub === 1) { e.subT++; e.x = e.bx + Math.sin(e.subT * 0.03) * 10; e.y = e.by + Math.sin(e.subT * 0.05) * 4; if (e.subT > 260) { e.sub = 2; e.ang = -Math.PI / 2 + (e.x < W / 2 ? -0.4 : 0.4); } }
        else fwd(e.speed * 0.9);
        break;
      }
      case 'turret': if (s.mode === 'vertical') e.y += SCROLL * DT; break;
      case 'orbit': {
        if (arena) { e.spin += 1.4 * DT; const R = Math.max(70, 150 - e.t * 0.2); e.tx = tx + Math.cos(e.spin) * R; e.ty = ty + Math.sin(e.spin) * R; const d = Math.hypot(e.tx - e.x, e.ty - e.y) || 1, v = Math.min(d, e.speed * DT * 1.3); e.x += (e.tx - e.x) / d * v; e.y += (e.ty - e.y) / d * v; }
        else { e.spin += 2 * DT; e.bx += Math.cos(e.ang) * e.speed * 0.45 * DT; e.by += Math.sin(e.ang) * e.speed * 0.45 * DT; e.x = e.bx + Math.cos(e.spin) * 36; e.y = e.by + Math.sin(e.spin) * 36; }
        break;
      }
      case 'chase': {
        const limit = arena ? Infinity : 240;
        if (e.t < limit && p.alive && (arena || e.onScreen)) e.ang = steer(e.ang, Math.atan2(ty - e.y, tx - e.x), (arena ? 3 : 1.6) * DT);
        fwd(e.speed);
        break;
      }
      case 'wander': case 'split': {
        if (--e.subT <= 0) { e.subT = 40 + Math.floor(rnd(s) * 60); e.tx = arena ? rnd(s) * TAU : Math.PI / 2 + range(s, -0.9, 0.9); }
        e.ang = steer(e.ang, e.tx, 1.5 * DT);
        e.spin += (e.mv === 'split' ? 4 : 1.5) * DT;
        fwd(e.speed);
        break;
      }
      case 'snake': {
        if (p.alive) e.ang = steer(e.ang, Math.atan2(ty - e.y, tx - e.x), 1.5 * DT);
        e.ang += Math.sin(e.t * 0.12) * 0.045;
        fwd(e.speed);
        break;
      }
      case 'gravity': e.spin += 2.5 * DT; fwd(arena ? e.speed : Math.max(18, e.speed)); if (!arena) e.ang = steer(e.ang, Math.PI / 2, DT); break;
      case 'saucer': {
        if (--e.subT <= 0) { e.subT = 50 + Math.floor(rnd(s) * 40); e.sub = Math.floor(rnd(s) * 3) - 1; }
        e.x += Math.cos(e.ang) * e.speed * DT; e.y += e.sub * e.speed * 0.5 * DT;
        e.y = s.mode === 'asteroids' ? wrapCoord(e.y, H) : clamp(e.y, 20, H * 0.7);
        break;
      }
      default: fwd(e.speed);
    }
    if (s.mode === 'twinstick') {
      if (e.x < e.r) { e.x = e.r; e.ang = Math.PI - e.ang; e.bx = e.x; } else if (e.x > W - e.r) { e.x = W - e.r; e.ang = Math.PI - e.ang; e.bx = e.x; }
      if (e.y < e.r) { e.y = e.r; e.ang = -e.ang; e.by = e.y; } else if (e.y > H - e.r) { e.y = H - e.r; e.ang = -e.ang; e.by = e.y; }
      if (e.mv === 'wander' || e.mv === 'split') e.tx = e.ang;
    } else if (s.mode === 'asteroids' && e.mv !== 'saucer') { e.x = wrapCoord(e.x, W); e.y = wrapCoord(e.y, H); e.bx = e.x; e.by = e.y; }
  }

  function snakeStep(e) {
    let px = e.x, py = e.y;
    for (let k = 0; k < e.segs.length; k += 2) {
      const dx = e.segs[k] - px, dy = e.segs[k + 1] - py, d = Math.hypot(dx, dy);
      if (d > 9) { e.segs[k] = px + dx / d * 9; e.segs[k + 1] = py + dy / d * 9; }
      px = e.segs[k]; py = e.segs[k + 1];
    }
  }

  function gravityStep(s, e) {
    const p = s.player, R = 150;
    if (p.alive) {
      const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy);
      if (d < R && d > 1) { const pull = 80 * (1 - d / R) + 12; p.x = clamp(p.x + dx / d * pull * DT, 10, s.W - 10); p.y = clamp(p.y + dy / d * pull * DT, 10, s.H - 10); p.pulled = 2; }
    }
    for (const b of s.pbullets) {
      const dx = e.x - b.x, dy = e.y - b.y, d2 = dx * dx + dy * dy;
      if (d2 < R * R && d2 > 1) { const d = Math.sqrt(d2), k = 1100 * (1 - d / R) * DT; b.vx += dx / d * k; b.vy += dy / d * k; }
    }
    if (s.mode === 'fixed' || s.mode === 'vertical') return; // swallowing is an arena behavior
    for (const o of s.enemies) {
      if (o === e || o.dead || !o.onScreen || o.mv === 'gravity' || o.mv === 'rock') continue;
      if ((o.x - e.x) ** 2 + (o.y - e.y) ** 2 < (e.r + o.r * 0.5) ** 2) {
        o.dead = true; s.stats.escaped++; e.eaten++; e.hp += 2; e.maxHp += 2; e.r = Math.min(28, e.r + 1.2);
        emit(s, 'swallow', { x: e.x, y: e.y });
        if (e.eaten >= 6) {
          e.dead = true; emit(s, 'burst', { x: e.x, y: e.y, r: e.r });
          const type = enemyById.get(e.type);
          for (let k = 0; k < 4; k++) { const a = k / 4 * TAU; const c = makeEnemy(s, type, e.x + Math.cos(a) * 14, e.y + Math.sin(a) * 14, a, { mv: 'chase', r: 7, hp: 1, maxHp: 1, speed: 115, points: 50, gen: 1, onScreen: true }); c.mini = true; }
          return;
        }
      }
    }
  }

  // ---------- enemy fire ----------
  function enemyFire(s, e) {
    if (e.burst > 0 && --e.burstGap <= 0) { e.burst--; e.burstGap = 5; pattern(s, e, 'aimedOne'); }
    if (e.fire === 'none' || !e.fireRate || !e.onScreen || e.st === 'enter' || e.st === 'join' || e.t < 30) return;
    const p = s.player;
    if (s.mode !== 'twinstick' && s.mode !== 'asteroids' && p.alive && e.y > p.y - 40) return;
    let k = 1;
    if (e.st === 'formation') {
      const col = e.slot % COLS;
      if (s.enemies.some(o => o !== e && !o.dead && o.st === 'formation' && o.slot % COLS === col && o.slot > e.slot)) return;
      k = 2.6;
    }
    if (--e.fireCd > 0) return;
    const spiral = e.fire === 'spiral';
    e.fireCd = 60 / (e.fireRate * (spiral ? 4 : 1)) * k * range(s, 0.8, 1.2);
    pattern(s, e, e.fire);
  }

  function pattern(s, src, kind, boss = false) {
    const p = s.player, cap = BULLET_CAP[s.mode];
    const v = BULLET_SPEED * D.bs * scale(s).speed * (boss ? 1.05 : 1);
    const aim = p.alive ? Math.atan2(p.y - src.y, p.x - src.x) : Math.PI / 2;
    const id = boss ? s.boss.type : src.type;
    const shot = (a, sp = v, k = 'orb', r = boss ? 4 : 3.5) => {
      if (s.ebullets.length >= cap) return;
      s.ebullets.push({ x: src.x + Math.cos(a) * src.r * 0.6, y: src.y + Math.sin(a) * src.r * 0.6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r, k, src: id, life: 0, boss });
    };
    const fan = (a, n, step, k) => { for (let i = 0; i < n; i++) shot(a + (i - (n - 1) / 2) * step, v, k); };
    switch (kind) {
      case 'aimedOne': fan(aim, boss ? 3 : 1, 0.14, 'needle'); break;
      case 'aimed': fan(aim, boss ? 3 + s.boss.phase * 2 : 1, 0.16, 'needle'); break;
      case 'spread': fan(aim, boss ? 7 : 3, boss ? 0.19 : 0.26, 'arrow'); break;
      case 'ring': { const n = boss ? 18 : 8; for (let i = 0; i < n; i++) shot(src.spin + i / n * TAU, v * 0.85); src.spin += 0.17; break; }
      case 'spiral': { const arms = boss ? 3 : 1; for (let i = 0; i < arms; i++) shot(src.spin + i / arms * TAU, v * 0.9, 'orb', boss ? 3.5 : 3); src.spin += boss ? 0.23 : 0.45; break; }
      case 'burst': src.burst = boss ? 5 : 3; src.burstGap = 1; break;
      case 'flower': { const n = boss ? 12 : 6; for (let i = 0; i < n; i++) { shot(src.spin + i / n * TAU, v * 0.95); shot(src.spin + (i + 0.5) / n * TAU, v * 0.65, 'orb', boss ? 5 : 4); } src.spin += 0.21; break; }
    }
    if (kind !== 'burst') emit(s, 'enemy_shoot', { x: src.x, y: src.y, boss });
  }

  // ---------- boss ----------
  function spawnBoss(s) {
    const st = stageOf(s), b = bossById.get(st.boss), L = scale(s);
    if (!b) { s.bossDone = true; return; }
    const arena = s.mode === 'twinstick' || s.mode === 'asteroids';
    s.boss = { type: b.id, x: s.W / 2, y: -60, hp: b.hp * L.hp, maxHp: b.hp * L.hp, r: arena ? 30 : 34, phase: 0, phases: b.phases.length, st: 'enter', t: 0, fightT: 0, dyingT: 0,
      fireCd: 70, spin: 0, flash: 0, invuln: 0, burst: 0, burstGap: 0, homeY: arena ? s.H * 0.3 : 92, mt: 0, cx: 0, cy: 0, vx: 0, vy: 0, points: b.points * L.pts };
    s.stats.spawned++; s.stageStats.spawned++;
    emit(s, 'boss_enter', { boss: b.id });
  }

  function bossStep(s) {
    const b = s.boss;
    if (!b) return;
    const def = bossById.get(b.type), p = s.player, { W, H } = s, ox = b.x, oy = b.y;
    b.t++; if (b.flash > 0) b.flash--; if (b.invuln > 0) b.invuln--;
    if (b.burst > 0 && --b.burstGap <= 0) { b.burst--; b.burstGap = 6; pattern(s, b, 'aimedOne', true); }
    if (b.st === 'enter') {
      b.y += 70 * DT;
      if (b.y >= b.homeY) { b.y = b.homeY; b.st = 'fight'; emit(s, 'boss_fight'); }
    } else if (b.st === 'fight') {
      b.fightT++;
      const n = def.phases.length, phase = Math.min(n - 1, Math.floor((1 - b.hp / b.maxHp) * n));
      if (phase > b.phase) { b.phase = phase; b.invuln = 50; b.mt = 0; cancelBullets(s); s.freeze = 4; emit(s, 'boss_phase', { phase, x: b.x, y: b.y }); }
      const ph = def.phases[b.phase];
      b.mt++;
      let tx = W / 2, ty = b.homeY;
      const arena = s.mode === 'twinstick' || s.mode === 'asteroids';
      if (ph.move === 'hover') { tx = W / 2 + Math.sin(b.mt * 0.012) * 40; ty = b.homeY + Math.sin(b.mt * 0.03) * 10; }
      else if (ph.move === 'sweep') { tx = W / 2 + Math.sin(b.mt * 0.02) * (W / 2 - 50); ty = b.homeY + Math.sin(b.mt * 0.04) * 8; }
      else if (ph.move === 'circle') { const R = arena ? 0.32 : 0.3; tx = W / 2 + Math.cos(b.mt * 0.02) * W * R; ty = (arena ? H / 2 : b.homeY + 30) + Math.sin(b.mt * 0.02) * (arena ? H * 0.28 : 40); }
      else if (ph.move === 'charge') {
        const c = b.mt % 240;
        if (c === 150) { b.cx = p.alive ? p.x : W / 2; b.cy = clamp(p.alive ? p.y : H / 2, b.homeY, arena ? H - 40 : H - 120); emit(s, 'boss_charge', { x: b.x, y: b.y }); }
        if (c >= 150 && c < 200) { tx = b.cx; ty = b.cy; } else { tx = W / 2 + Math.sin(b.mt * 0.015) * 50; }
      }
      const fast = ph.move === 'charge' && b.mt % 240 >= 150 && b.mt % 240 < 200;
      const k = Math.min(1, (fast ? 5 : 2.2) * DT);
      b.x += (tx - b.x) * k; b.y += (ty - b.y) * k;
      if (ph.pattern !== 'none' && b.invuln <= 0 && --b.fireCd <= 0) {
        // The inertial asteroids ship dodges slower, so bosses fire less there.
        const rate = ph.rate * D.fr * scale(s).fire * (ph.pattern === 'spiral' ? 5 : 1) * (s.mode === 'asteroids' ? 0.7 : 1);
        b.fireCd = 60 / rate;
        pattern(s, b, ph.pattern, true);
      }
      if (b.fightT > TIMING.bossLimit) { b.st = 'escape'; emit(s, 'boss_escape'); }
    } else if (b.st === 'dying') {
      b.dyingT++;
      b.x += Math.sin(b.dyingT * 1.7) * 0.8;
      if (b.dyingT % 8 === 0) emit(s, 'boss_blast', { x: b.x + range(s, -1, 1) * b.r, y: b.y + range(s, -0.7, 0.7) * b.r });
      if (b.dyingT >= 100) {
        emit(s, 'defeated', { x: b.x, y: b.y, r: b.r * 2.2, boss: true, type: b.type, points: Math.round(b.points) });
        emit(s, 'boss_defeated', { x: b.x, y: b.y });
        for (let k = 0; k < 2; k++) dropPickup(s, b.x + (k ? 16 : -16), b.y, true);
        s.boss = null; s.bossDone = true; s.freeze = 6;
        return;
      }
    } else if (b.st === 'escape') {
      b.y -= 110 * DT;
      if (b.y < -90) { s.boss = null; s.bossDone = true; return; }
    }
    b.vx = (b.x - ox) / DT; b.vy = (b.y - oy) / DT;
  }

  function damageBoss(s, dmg) {
    const b = s.boss;
    if (!b || b.st !== 'fight') return false;
    if (b.invuln > 0) return true;
    b.hp -= dmg; b.flash = 3;
    if (b.hp <= 0) {
      b.hp = 0; b.st = 'dying'; b.dyingT = 0; s.freeze = 10; cancelBullets(s);
      s.chain++; s.chainT = 100; s.bestChain = Math.max(s.bestChain, s.chain);
      addScore(s, b.points * mult(s)); s.stats.kills++; s.stageStats.kills++;
      emit(s, 'boss_down', { x: b.x, y: b.y, points: Math.round(b.points * mult(s)) });
    }
    return true;
  }

  // ---------- damage, kills, drops ----------
  const mult = s => Math.min(8, 1 + Math.floor(s.chain / 6));

  function damageEnemy(s, e, dmg, bombed = false) {
    if (e.dead) return;
    e.hp -= dmg; e.flash = 4;
    if (e.hp > 1e-6) { emit(s, 'hit', { x: e.x, y: e.y }); return; }
    kill(s, e, bombed);
  }

  function kill(s, e, bombed) {
    e.dead = true;
    s.chain = s.chainT > 0 ? s.chain + 1 : 1; s.chainT = 100; s.bestChain = Math.max(s.bestChain, s.chain);
    const m = mult(s), pts = Math.round(e.points * m * (e.st === 'dive' ? 2 : 1));
    addScore(s, pts);
    s.stats.kills++; s.stageStats.kills++;
    emit(s, 'defeated', { x: e.x, y: e.y, r: e.r, type: e.type, points: pts, mult: m, mini: !!e.mini, tier: e.tier || 0, seed: e.seed || 0 });
    if (e.mv === 'rock' && e.tier > 1) {
      const base = Math.atan2(e.vy, e.vx), sp = Math.hypot(e.vx, e.vy) * 1.35 + 12;
      for (const d of [-1, 1]) makeRock(s, e.x, e.y, e.tier - 1, base + d * range(s, 0.4, 1.0), sp);
      emit(s, 'split', { x: e.x, y: e.y });
    }
    if (e.mv === 'split' && !e.gen) {
      const type = enemyById.get(e.type);
      for (let k = 0; k < 3; k++) {
        const a = e.spin + k / 3 * TAU;
        const c = makeEnemy(s, type, e.x + Math.cos(a) * 6, e.y + Math.sin(a) * 6, a, { r: Math.max(5, e.r * 0.6), hp: 1, maxHp: 1, speed: e.speed * 1.6, points: Math.round(e.points / 4), gen: 1, onScreen: true, mv: 'wander' });
        c.mini = true;
      }
      emit(s, 'split', { x: e.x, y: e.y });
    }
    if (!bombed || rnd(s) < 0.5) dropPickup(s, e.x, e.y, false);
  }

  function dropPickup(s, x, y, force) {
    const kinds = C.powerups.kinds;
    if (!kinds.length) return;
    s.dropMeter++;
    if (!force && rnd(s) >= C.powerups.rate && s.dropMeter < 16) return;
    s.dropMeter = 0;
    const weights = kinds.map(k => ({ spread: 3, laser: 3, homing: 3, shield: 2, bomb: 2, life: 0.6 }[k]));
    let r = rnd(s) * weights.reduce((a, b) => a + b, 0), kind = kinds[0];
    for (let i = 0; i < kinds.length; i++) { r -= weights[i]; if (r <= 0) { kind = kinds[i]; break; } }
    s.pickups.push({ id: s.nextId++, x, y, vx: range(s, -20, 20), vy: s.mode === 'fixed' || s.mode === 'vertical' ? -40 : range(s, -20, 20), kind, t: 0 });
  }

  function pickupsStep(s) {
    const p = s.player, flow = s.mode === 'fixed' || s.mode === 'vertical';
    for (const u of s.pickups) {
      u.t++;
      const dx = p.x - u.x, dy = p.y - u.y, d = Math.hypot(dx, dy);
      if (p.alive && (d < 48 || s.phase === 'clear')) { const v = 240 * DT; u.x += dx / (d || 1) * Math.min(v, d); u.y += dy / (d || 1) * Math.min(v, d); }
      else if (flow) { u.vy = Math.min(45, u.vy + 90 * DT); u.vx *= 0.97; u.x = clamp(u.x + u.vx * DT, 8, s.W - 8); u.y += u.vy * DT; if (u.y > s.H + 20) u.dead = true; }
      else { u.vx *= 0.98; u.vy *= 0.98; u.x = clamp(u.x + u.vx * DT, 8, s.W - 8); u.y = clamp(u.y + u.vy * DT, 8, s.H - 8); if (u.t > 600) u.dead = true; }
      if (p.alive && !u.dead && d < 14 + HITBOX[s.mode]) { u.dead = true; collect(s, u); }
    }
  }

  function collect(s, u) {
    const w = s.weapon, p = s.player;
    if (u.kind === 'spread' || u.kind === 'laser' || u.kind === 'homing') {
      if (w.kind === u.kind && w.tier >= 3) { addScore(s, 1000); emit(s, 'collect', { x: u.x, y: u.y, kind: u.kind, points: 1000 }); return; }
      w.tier = w.kind === u.kind ? w.tier + 1 : Math.max(1, w.tier); w.kind = u.kind;
      emit(s, 'power', { x: u.x, y: u.y, kind: u.kind, tier: w.tier });
    } else if (u.kind === 'shield') { p.shield = true; emit(s, 'power', { x: u.x, y: u.y, kind: 'shield' }); }
    else if (u.kind === 'bomb') { s.bombs = Math.min(5, s.bombs + 1); emit(s, 'collect', { x: u.x, y: u.y, kind: 'bomb' }); }
    else if (u.kind === 'life') { if (s.lives < 9) s.lives++; emit(s, 'extra_life', { x: u.x, y: u.y, lives: s.lives }); }
  }

  // ---------- bullets & collisions ----------
  function bulletsStep(s) {
    const { W, H } = s, wrap = s.mode === 'asteroids';
    for (const b of s.pbullets) {
      if (b.k === 'missile') {
        const t = nearestTarget(s, b.x, b.y, 400);
        if (t) { const a = Math.atan2(b.vy, b.vx), na = steer(a, Math.atan2(t.y - b.y, t.x - b.x), 6 * DT), v = Math.min(420, Math.hypot(b.vx, b.vy) + 300 * DT); b.vx = Math.cos(na) * v; b.vy = Math.sin(na) * v; }
      }
      b.x += b.vx * DT; b.y += b.vy * DT;
      if (--b.life <= 0) b.dead = true;
      if (wrap) { b.x = (b.x + W) % W; b.y = (b.y + H) % H; }
      else if (b.x < -16 || b.x > W + 16 || b.y < -24 || b.y > H + 16) b.dead = true;
    }
    for (const b of s.ebullets) {
      // Enemy fire never wraps, so nothing arrives unseen from the opposite edge.
      b.x += b.vx * DT; b.y += b.vy * DT; b.life++;
      if (b.x < -12 || b.x > W + 12 || b.y < -12 || b.y > H + 12) b.dead = true;
    }
  }

  function bunkerHit(s, x, y, blast) {
    for (const k of s.bunkers) {
      const c = Math.floor((x - k.x) / k.cell), r = Math.floor((y - k.y) / k.cell);
      if (c < 0 || r < 0 || c >= k.cols || r >= k.rows || !k.cells[r * k.cols + c]) continue;
      for (let dr = -blast; dr <= blast; dr++) for (let dc = -blast; dc <= blast; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && cc >= 0 && rr < k.rows && cc < k.cols && (Math.abs(dr) + Math.abs(dc) <= blast || rnd(s) < 0.4)) k.cells[rr * k.cols + cc] = 0;
      }
      emit(s, 'chip', { x, y });
      return true;
    }
    return false;
  }

  function collide(s) {
    const p = s.player, b = s.boss;
    // Player bullets → enemies, boss, bunkers.
    for (const bl of s.pbullets) {
      if (bl.dead) continue;
      if (s.bunkers.length && bl.y > s.H - 90 && bunkerHit(s, bl.x, bl.y, 0)) { bl.dead = true; continue; }
      for (const e of s.enemies) {
        if (e.dead || (bl.pierce && bl.hit.includes(e.id))) continue;
        if (e.st === 'enter' && !e.onScreen) continue;
        const rr = e.r + bl.r;
        if ((e.x - bl.x) ** 2 + (e.y - bl.y) ** 2 > rr * rr) {
          // The head takes the hit first; the armored tail only blocks.
          if (e.segs) {
            let blocked = false;
            for (let k = 0; k < e.segs.length; k += 2) if ((e.segs[k] - bl.x) ** 2 + (e.segs[k + 1] - bl.y) ** 2 < (7 + bl.r) ** 2) { blocked = true; break; }
            if (blocked) { bl.dead = true; emit(s, 'block', { x: bl.x, y: bl.y }); break; }
          }
          continue;
        }
        s.stats.hits++; s.stageStats.hits++;
        damageEnemy(s, e, bl.dmg);
        if (bl.pierce) bl.hit.push(e.id); else { bl.dead = true; break; }
      }
      if (!bl.dead && b && (b.st === 'fight' || b.st === 'enter') && (b.x - bl.x) ** 2 + (b.y - bl.y) ** 2 < (b.r + bl.r) ** 2 && !(bl.pierce && bl.hit.includes('boss'))) {
        if (b.st === 'fight' && b.invuln <= 0) { s.stats.hits++; s.stageStats.hits++; }
        if (b.st === 'enter' || b.invuln > 0) emit(s, 'block', { x: bl.x, y: bl.y }); else { damageBoss(s, bl.dmg); emit(s, 'hit', { x: bl.x, y: bl.y, boss: true }); }
        if (bl.pierce) bl.hit.push('boss'); else bl.dead = true;
      }
    }
    // Enemy bullets → bunkers, player.
    const hb = HITBOX[s.mode];
    for (const bl of s.ebullets) {
      if (bl.dead) continue;
      if (s.bunkers.length && bl.y > s.H - 90 && bunkerHit(s, bl.x, bl.y, 1)) { bl.dead = true; continue; }
      if (p.alive && (bl.x - p.x) ** 2 + (bl.y - p.y) ** 2 < (bl.r + hb) ** 2) {
        if (p.invuln > 0) continue;
        bl.dead = true; hitPlayer(s, `Shot down by ${nameOf(bl.src)}`);
      }
    }
    // Bodies.
    if (p.alive && p.invuln <= 0) {
      const br = BODY[s.mode];
      for (const e of s.enemies) {
        if (e.dead || (e.st === 'enter' && !e.onScreen)) continue;
        const rr = e.r * (e.mv === 'rock' ? 0.85 : 0.8) + br;
        if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 < rr * rr) {
          const cause = e.mv === 'rock' ? 'Smashed by an asteroid' : e.mv === 'gravity' ? `Swallowed by the ${nameOf(e.type)}` : `Rammed by a ${nameOf(e.type)}`;
          if (p.shield && e.mv !== 'gravity') damageEnemy(s, e, 99);
          hitPlayer(s, cause); break;
        }
        if (e.segs) for (let k = 0; k < e.segs.length; k += 2) if ((e.segs[k] - p.x) ** 2 + (e.segs[k + 1] - p.y) ** 2 < (6 + br * 0.7) ** 2) { hitPlayer(s, `Caught in the coils of a ${nameOf(e.type)}`); break; }
        if (!p.alive || p.invuln > 0) break;
      }
      if (p.alive && p.invuln <= 0 && b && b.st !== 'dying' && b.st !== 'escape' && (b.x - p.x) ** 2 + (b.y - p.y) ** 2 < (b.r * 0.8 + br) ** 2) hitPlayer(s, `Destroyed by ${nameOf(b.type)}`);
    }
    // Diving enemies chew through bunkers.
    if (s.bunkers.length) for (const e of s.enemies) if (!e.dead && e.y > s.H - 90) bunkerHit(s, e.x, e.y, 2);
  }

  function hitPlayerForced(s, cause) { const p = s.player; p.invuln = 0; p.shield = false; hitPlayer(s, cause); }

  return {
    content: C, seed, createState, step, enemyType: id => enemyById.get(id), bossType: id => bossById.get(id), nameOf,
    stageCount: C.stages.length, world: mode => WORLD[mode],
  };
}
