// The runner game loop shared by every mode: fixed 60 Hz step, input edges,
// speed curve and difficulty tiers, deterministic chunk scheduling from the
// seeded RNG kept in state, scoring, combos, near-miss slow-mo, power-ups and
// missions. Modes (./modes/*.js) own physics, collisions and geometry.
import { random, seedFrom } from '../../kernel/rng.js';
import lanes from './modes/lanes.js';
import side from './modes/side.js';
import flap from './modes/flap.js';
import climb from './modes/climb.js';
import dash from './modes/dash.js';
import hop from './modes/hop.js';

export const DT = 1 / 60;
export const MODE_IMPL = { lanes, side, flap, climb, 'rhythm-dash': dash, hop };
const STAT_KEYS = ['distance', 'coins', 'jumps', 'slides', 'near_misses', 'powerups', 'lane_switches', 'score', 'flaps', 'stomps', 'hops'];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const FEEL = { snappy: { g: 1, j: 1, air: 1 }, floaty: { g: 0.82, j: 1.04, air: 0.75 }, heavy: { g: 1.18, j: 0.97, air: 1.2 } };

// ---------- speed and tiers ----------
/** Speed (mode units) at sim time t along the content's curve. */
export const speedAt = (content, t) => content.speed.start + (content.speed.max - content.speed.start) * clamp(t / content.speed.rampSeconds, 0, 1);
/** Difficulty tier (1-3) at sim time t: thirds of the ramp. */
export const tierAt = (content, t) => t < content.speed.rampSeconds / 3 ? 1 : t < content.speed.rampSeconds * 2 / 3 ? 2 : 3;
/** Chunks eligible in a tier: their own tier and one above it; falls back to every lower tier. */
export function eligible(chunks, tier) {
  const list = chunks.filter(c => c.tier === tier || c.tier === tier - 1);
  return list.length ? list : chunks.filter(c => c.tier <= tier).length ? chunks.filter(c => c.tier <= tier) : chunks;
}
/** The highest speed (and time) each chunk can appear at, from the eligibility rule. */
export function chunkLimits(content, chunks) {
  const R = content.speed.rampSeconds;
  const end = [R / 3, (R * 2) / 3, Infinity];
  return chunks.map(c => {
    let last = 0;
    for (let tier = 1; tier <= 3; tier++) if (eligible(chunks, tier).includes(c)) last = tier;
    const t = end[last - 1] === Infinity ? R : end[last - 1];
    return { tier: last, time: t, speed: speedAt(content, t) };
  });
}

// ---------- shared helpers the modes call ----------
/** Breathing room between chunks scales with 1 / rules.density, never below `min`. */
export const joinGap = (s, base, min) => Math.max(min, base / s.game.content.rules.density);
export const G = {
  random,
  emit(s, name, data) { s.events.push(data ? { name, ...data } : { name }); },
  count(s, key, n = 1) { s.stats[key] = (s.stats[key] || 0) + n; },
  mult(s) { return s.mult * (s.powers.multiplier > 0 ? 2 : 1); },
  combo(s) { s.combo++; s.comboT = 1.4; if (s.combo >= 5 && s.combo % 5 === 0) G.emit(s, 'combo', { n: s.combo }); },
  collect(s, o, value = 1) {
    s.gone[o.id] = s.time;
    s.coins += value; G.count(s, 'coins', value);
    s.bonus += s.game.content.scoring.coin * value * G.mult(s);
    G.combo(s);
    G.emit(s, 'collect', { id: o.id, combo: s.combo });
  },
  power(s, o) {
    s.gone[o.id] = s.time;
    const p = s.game.powers[o.power];
    if (!p) { G.collect(s, o, 5); return; }
    s.powers[p.kind] = p.seconds; G.count(s, 'powerups');
    G.emit(s, 'power', { kind: p.kind, label: p.name, id: o.id });
    s.game.impl.onPower?.(s, p.kind, G);
  },
  /** A fatal hit: the shield absorbs it (returns true) or the run ends. */
  hit(s, reason, o) {
    if (s.invuln > 0) return true;
    if (s.powers.shield > 0) {
      s.powers.shield = 0; s.invuln = 1;
      if (o) s.gone[o.id] = s.time;
      G.emit(s, 'shield', { id: o?.id }); G.emit(s, 'hit');
      return true;
    }
    G.die(s, reason);
    return s.status === 'playing';
  },
  /** End the run, or spend a life (rules.lives) and respawn safely. Trials never get extra lives. */
  die(s, reason) {
    if (s.status !== 'playing') return;
    if (s.lives > 1 && !s.trial) {
      s.lives--; s.livesLost++; s.invuln = 2;
      G.emit(s, 'hurt'); G.emit(s, 'life_lost', { reason, lives: s.lives });
      s.game.impl.respawn?.(s, G, reason);
      return;
    }
    s.status = 'lost'; s.reason = reason; s.deathT = s.time;
    G.emit(s, 'hurt'); G.emit(s, 'lost', { reason });
  },
  nearMiss(s, o) {
    if (s.flag[`n${o.id}`]) return;
    s.flag[`n${o.id}`] = 1;
    G.count(s, 'near_misses');
    s.bonus += s.game.content.scoring.nearMiss * G.mult(s);
    G.combo(s);
    if (s.game.impl.slowmo !== false && s.slowCD <= 0) { s.slowT = 0.28; s.slowCD = 1.6; }
    G.emit(s, 'near_miss', { id: o.id });
  },
  /** Append placed objects keeping state.objs sorted by p. */
  add(s, list) {
    for (const o of list) {
      o.id = s.nextId++;
      const objs = s.objs;
      if (!objs.length || objs[objs.length - 1].p <= o.p) { objs.push(o); continue; }
      let lo = 0, hi = objs.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (objs[mid].p <= o.p) lo = mid + 1; else hi = mid; }
      objs.splice(lo, 0, o);
    }
  },
  pickPower(s) {
    const list = s.game.content.powerups;
    return list.length ? list[Math.floor(random(s) * list.length)].kind : null;
  },
};

function spawnChunk(s) {
  const { game } = s;
  const pool = game.pool;
  let chunk;
  if (s.chunkN === 0) chunk = pool.find(c => c.tier === 1) || pool[0];
  else {
    let list = eligible(pool, tierAt(game.content, s.time));
    if (list.length > 1) list = list.filter(c => c.index !== s.lastChunk);
    chunk = list[Math.floor(random(s) * list.length)];
  }
  s.lastChunk = chunk.index; s.chunkN++;
  const at = s.nextAt;
  s.nextAt = at + game.impl.place(s, chunk, at, G);
  s.chunkLog.push(chunk.index);
  if (s.chunkLog.length > 8) s.chunkLog.shift();
}

function missionsInit(content) {
  return content.missions.map((m, i) => ({ i, kind: m.kind, target: m.target, label: m.label, base: 0, done: false }));
}
function missionValue(s, m) {
  if (m.kind === 'distance') return Math.floor(s.distance);
  if (m.kind === 'score') return s.score;
  return (s.stats[m.kind] || 0) - m.base;
}
function stepMissions(s) {
  if (!s.missions.length) return;
  let active = 0;
  for (const m of s.missions) {
    if (m.done) continue;
    if (active++ >= 3) break;
    if (missionValue(s, m) >= m.target) {
      m.done = true;
      s.bonus += 100 * (s.missionSet + 1) * (m.i + 1);
      G.emit(s, 'mission', { label: m.label, index: m.i });
    }
  }
  if (s.missions.every(m => m.done)) {
    s.missionSet++; s.mult++;
    G.emit(s, 'level_up', { mult: s.mult });
    for (const m of s.missions) { m.done = false; m.target = m.kind === 'distance' || m.kind === 'score' ? m.target * 2 : m.target; m.base = m.kind === 'distance' || m.kind === 'score' ? 0 : s.stats[m.kind] || 0; }
  }
}

/** Build a game for normalized content. `pool` is the compiled chunk list. */
export function createGame(content, { seed = 1 } = {}) {
  const impl = MODE_IMPL[content.mode];
  const chars = new Map(content.obstacles.map(o => [o.char, o]));
  const powers = Object.fromEntries(content.powerups.map(p => [p.kind, p]));
  const game = { content, impl, chars, powers, mode: content.mode, seed };
  game.pool = impl.compile(content, chars).map((c, index) => ({ ...c, index }));
  game.limits = chunkLimits(content, game.pool);
  game.level = impl.level ? impl.level(content, chars) : null;

  function baseState(seedValue) {
    const s = {
      status: 'playing', score: 0, events: [], reason: '', mode: content.mode,
      frame: 0, time: 0, rng: seedFrom(`runner:${seedValue}`), prev: { x: 0, y: 0, a: false, b: false },
      speed: 0, slowT: 0, slowCD: 0, invuln: 0, deathT: 0,
      distance: 0, distScore: 0, bonus: 0, coins: 0, mult: 1, combo: 0, comboT: 0,
      powers: {}, stats: Object.fromEntries(STAT_KEYS.map(k => [k, 0])), missions: missionsInit(content), missionSet: 0,
      objs: [], gone: {}, flag: {}, nextId: 1, nextAt: 0, chunkN: 0, lastChunk: -1, chunkLog: [],
      p: null, trial: null, lives: content.rules.lives, livesLost: 0,
    };
    Object.defineProperty(s, 'game', { value: game, enumerable: false, writable: true });
    return s;
  }
  game.attach = s => { if (!s.game) Object.defineProperty(s, 'game', { value: game, enumerable: false, writable: true }); return s; };

  game.createState = () => {
    const s = baseState(seed);
    impl.init(s, G);
    if (!game.level) while (s.nextAt < impl.progress(s) + impl.ahead) spawnChunk(s);
    return s;
  };

  /** A state containing only one chunk, run at a fixed speed, for the structural solver. */
  game.trialState = (chunkIndex, { speed, time = 0, entry = 0 } = {}) => {
    const s = baseState(`trial:${chunkIndex}`);
    s.trial = { speed, time, chunk: chunkIndex };
    impl.init(s, G, { trial: true, entry });
    const chunk = game.pool[chunkIndex];
    const at = s.nextAt;
    const len = impl.place(s, chunk, at, G);
    s.trial.start = at; s.trial.end = at + len;
    s.nextAt = at + len;
    if (impl.trialEnd) impl.trialEnd(s, G);
    return s;
  };

  game.step = (s, input) => {
    game.attach(s);
    s.events = [];
    if (s.status !== 'playing') return s;
    const inp = { x: Math.sign(input?.x || 0), y: Math.sign(input?.y || 0), a: !!input?.a, b: !!input?.b };
    const press = { x: inp.x && inp.x !== s.prev.x ? inp.x : 0, y: inp.y && inp.y !== s.prev.y ? inp.y : 0, a: inp.a && !s.prev.a, b: inp.b && !s.prev.b };
    const scale = (s.slowT > 0 ? 0.5 : 1) * (s.powers.slowmo > 0 ? 0.65 : 1);
    const dt = DT * scale;
    s.frame++; s.time += dt;
    const base = s.trial ? s.trial.speed : impl.speedOf ? impl.speedOf(s) : speedAt(content, s.time);
    s.speed = base * (s.trial || impl.noIntro ? 1 : 0.45 + 0.55 * clamp(s.time / 0.9, 0, 1));
    const before = impl.progress(s);
    impl.step(s, inp, press, dt, G);
    const after = impl.progress(s);
    // Chunks ahead, objects behind.
    if (!s.trial && !game.level) while (s.nextAt < after + impl.ahead) spawnChunk(s);
    const behind = after - impl.behind;
    while (s.objs.length && s.objs[0].e < behind) { const o = s.objs.shift(); delete s.gone[o.id]; }
    // Score: distance points plus bonuses.
    const gained = Math.max(0, after - before);
    s.distance += gained;
    s.distScore += gained * content.scoring.perMeter * G.mult(s);
    s.score = Math.floor(s.distScore + s.bonus);
    s.stats.distance = Math.floor(s.distance); s.stats.score = s.score;
    const goal = content.rules.goalDistance;
    if (goal > 0 && !s.trial && s.status === 'playing' && s.distance >= goal) { s.status = 'won'; s.bonus += 500; s.score = Math.floor(s.distScore + s.bonus); G.emit(s, 'reach_goal'); G.emit(s, 'won'); }
    // Timers run on real (unscaled) time so slow-mo stays short.
    for (const k in s.powers) if (s.powers[k] > 0) { s.powers[k] = Math.max(0, s.powers[k] - DT); if (s.powers[k] === 0) { delete s.powers[k]; G.emit(s, 'power_end', { kind: k }); if (impl.powerEnd) impl.powerEnd(s, k, G); } }
    if (s.comboT > 0 && (s.comboT -= DT) <= 0) s.combo = 0;
    if (s.slowT > 0) s.slowT -= DT;
    if (s.slowCD > 0) s.slowCD -= DT;
    if (s.invuln > 0) s.invuln -= DT;
    stepMissions(s);
    s.prev = inp;
    return s;
  };

  /** A fast copy for search: shares immutable placed objects, copies everything that mutates. */
  game.clone = s => {
    const c = { ...s, p: impl.clonePlayer ? impl.clonePlayer(s.p) : { ...s.p }, objs: s.objs.slice(), gone: { ...s.gone }, flag: { ...s.flag }, powers: { ...s.powers }, stats: { ...s.stats }, missions: s.missions.map(m => ({ ...m })), prev: s.prev, events: [], chunkLog: s.chunkLog.slice() };
    Object.defineProperty(c, 'game', { value: game, enumerable: false, writable: true });
    return c;
  };
  game.progress = s => impl.progress(s);
  return game;
}
