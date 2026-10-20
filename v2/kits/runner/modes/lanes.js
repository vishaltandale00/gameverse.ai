// Lanes mode (Subway Surfers / Temple Run): three lanes along z, x switches
// lane, a or up jumps, down slides (or dives from the air). Low barriers are
// jumped, high barriers slid under, parked and oncoming trains dodged by lane.
// Hitting a low barrier trips you and the chaser closes in; a second trip
// while it is near, or any crash, ends the run. Units are metres along z.
import { FEEL, joinGap } from '../world.js';

/** Centre lane index: lane L sits at x = L - mid(content). */
export const mid = c => (c.rules.width - 1) / 2;
export const LANES = { switchTime: 0.15, jumpH: 1.35, air: 0.62, slide: 0.62, drop: 16, chase: 7, act: 46, hero: { half: 0.32, stand: 1.7, slide: 0.6 }, fly: 4.2 };
const OBST_Y = { low: [0, 0.85], high: [1.05, 3.3], wall: [0, 2.75], mover: [0, 2.75] };
const LEN = { low: 0.5, high: 0.5 };

function physics(content) {
  const f = FEEL[content.feel];
  const T = LANES.air * f.air, h = LANES.jumpH * f.j;
  return { g: (8 * h) / (T * T), v0: (4 * h) / T };
}

/** Compile chunks to lane objects relative to the chunk start (z = 0 is the first row). */
function compile(content, chars) {
  return content.chunks.map(k => {
    const objs = [];
    const sp = k.spacing;
    const walls = Array(content.rules.width).fill(null);
    k.rows.forEach((row, r) => {
      const z = r * sp;
      [...row].forEach((ch, lane) => {
        const o = chars.get(ch);
        if (ch === 'o') for (let i = 0; i < 4; i++) objs.push({ t: 'coin', lane, z: z + (i * sp) / 4, y: 0.6 });
        else if (ch === '*') objs.push({ t: 'box', lane, z, y: 0.7 });
        if (o?.kind === 'wall' || o?.kind === 'mover') {
          const w = walls[lane];
          if (w && w.ch === ch && o.kind === 'wall' && w.endRow === r - 1) { w.len = z - w.z + o.size; w.endRow = r; return; }
          walls[lane] = { t: o.kind, lane, z, len: o.size, k: o.kind === 'mover' ? o.speed : 0, name: o.name, ch, endRow: r };
          objs.push(walls[lane]);
        } else if (o) {
          objs.push({ t: o.kind, lane, z, len: LEN[o.kind], name: o.name });
          // A coin arc over every low barrier.
          if (o.kind === 'low') for (let i = -2; i <= 2; i++) objs.push({ t: 'coin', lane, z: z + i * 1.6, y: 0.6 + 1.25 * (1 - (i / 2.6) ** 2) });
        }
      });
    });
    for (const o of objs) delete o.ch, delete o.endRow;
    // Oncoming trains meet the hero before their row; push the chunk so they meet inside it.
    const lead = Math.max(0, ...objs.filter(o => o.t === 'mover').map(o => (o.k * LANES.act) / (1 + o.k) + 2 - o.z));
    for (const o of objs) o.z += lead;
    const last = Math.max(...objs.map(o => o.z + (o.len || 0)), lead + (k.rows.length - 1) * sp);
    return { id: k.id, tier: k.tier, objs, length: last + 2, lead };
  });
}

const join = s => joinGap(s, Math.max(8, s.game.content.speed.max * 0.55), 6);

function place(s, chunk, at, G) {
  const start = at + join(s);
  G.add(s, chunk.objs.map(o => {
    const z = start + o.z;
    if (o.t === 'box') return { ...o, z, p: z - 0.5, e: z + 0.4, power: G.pickPower(s) };
    const len = o.len || 0.4;
    // Movers park until the hero is `act` metres away, then close in at k × hero speed; p bounds the earliest point they reach.
    const p = o.t === 'mover' ? z - (o.k * LANES.act) / (1 + o.k) - 1 : z - 0.5;
    return { ...o, z, p, e: z + len };
  }));
  return join(s) + chunk.length;
}

/** Where an object is now along z. */
export const zOf = (o, pz) => o.t === 'mover' ? o.z - o.k * Math.max(0, pz - (o.z - LANES.act)) : o.z;

function init(s, G, { trial = false, entry = 1 } = {}) {
  const m = mid(s.game.content), start = Math.round(m);
  s.p = { z: 0, lane: trial ? entry : start, x: (trial ? entry : start) - m, y: 0, vy: 0, air: false, slideT: 0, slideQ: false, jumpQ: 0, switchT: 9, from: start, jumpT: 9, chaseT: 0, tripT: 0, flyY: 0 };
  s.nextAt = trial ? 0 : 30;
}

function bump(s, G) {
  s.invuln = Math.max(s.invuln, 0.7);
  if (s.p.chaseT > 0) { G.die(s, `Caught by ${s.game.content.cast.chaser.name}`); return; }
  s.p.chaseT = LANES.chase; s.p.tripT = 0.45;
  G.emit(s, 'stumble'); G.emit(s, 'hurt');
}

function blockedAt(s, lane, pz) {
  for (const o of s.objs) {
    if (o.p > pz + LANES.act + 4) break;
    if (o.lane !== lane || (o.t !== 'wall' && o.t !== 'mover') || s.gone[o.id] !== undefined) continue;
    const z = zOf(o, pz);
    if (z - 0.2 < pz + LANES.hero.half && z + o.len > pz - LANES.hero.half) return o;
  }
  return null;
}

function step(s, inp, press, dt, G) {
  const p = s.p, ph = physics(s.game.content);
  const flying = s.powers.jetpack > 0;
  // Lane switch: edge-triggered; switching into a train's side is a stumble.
  if (press.x && s.status === 'playing') {
    const to = p.lane + press.x;
    if (to >= 0 && to < s.game.content.rules.width) {
      if (!flying && p.y < 2.7 && blockedAt(s, to, p.z)) { if (s.invuln <= 0) bump(s, G); }
      else { p.from = p.lane; p.lane = to; p.switchT = 0; G.count(s, 'lane_switches'); G.emit(s, 'lane', { dir: press.x }); }
    }
  }
  const up = press.a || press.y < 0, down = press.y > 0;
  if (up) p.jumpQ = 0.14;
  if (down) {
    if (p.air && !flying) { p.vy = -LANES.drop; p.slideQ = true; }
    else if (!flying) { p.slideT = LANES.slide; p.jumpQ = 0; G.count(s, 'slides'); G.emit(s, 'slide'); }
  }
  if (p.jumpQ > 0 && !p.air && !flying) {
    p.slideT = 0; p.air = true; p.jumpQ = 0; p.jumpT = 0;
    p.vy = ph.v0 * (s.powers.superjump > 0 ? 1.55 : 1);
    G.count(s, 'jumps'); G.emit(s, 'jump');
  }
  p.jumpQ = Math.max(0, p.jumpQ - dt);
  p.switchT += dt; p.jumpT += dt;
  // Lateral move toward the lane.
  const tx = p.lane - mid(s.game.content), dx = tx - p.x, maxStep = dt / LANES.switchTime;
  p.x += Math.abs(dx) <= maxStep ? dx : Math.sign(dx) * maxStep;
  // Vertical.
  if (flying) { p.flyY += (LANES.fly - p.flyY) * Math.min(1, dt * 5); p.y = p.flyY; p.vy = 0; p.air = true; }
  else if (p.air || p.y > 0) {
    p.vy -= ph.g * dt; p.y += p.vy * dt;
    if (p.y <= 0) {
      p.y = 0; p.air = false; p.vy = 0;
      G.emit(s, 'land');
      if (p.slideQ) { p.slideQ = false; p.slideT = LANES.slide; G.count(s, 'slides'); G.emit(s, 'slide'); }
    }
  }
  if (p.slideT > 0) p.slideT -= dt;
  if (p.chaseT > 0) p.chaseT -= dt;
  if (p.tripT > 0) p.tripT -= dt;
  // Forward.
  const v = s.speed * (p.tripT > 0 ? 0.72 : 1);
  p.z += v * dt;
  collide(s, G);
}

function collide(s, G) {
  const p = s.p, pz = p.z, half = LANES.hero.half;
  const h = p.slideT > 0 ? LANES.hero.slide : LANES.hero.stand;
  const magnet = s.powers.magnet > 0, flying = s.powers.jetpack > 0, m = mid(s.game.content);
  for (const o of s.objs) {
    if (o.p > pz + LANES.act + 4) break;
    if (s.gone[o.id] !== undefined) continue;
    if (o.t === 'coin' || o.t === 'box') {
      const dz = o.z - pz, lat = Math.abs(o.lane - m - p.x);
      const hitC = magnet ? (lat < 1.7 && dz > -0.6 && dz < 6) : (lat < 0.6 && Math.abs(dz) < 0.65 && o.y > p.y - 0.4 && o.y < p.y + h + 0.4);
      if (hitC) o.t === 'coin' ? G.collect(s, o) : G.power(s, o);
      continue;
    }
    const z = zOf(o, pz);
    if (z > pz + half || z + o.len < pz - half) continue;
    const lat = Math.abs(o.lane - m - p.x);
    const [y0, y1] = OBST_Y[o.t];
    const vert = p.y < y1 && p.y + h > y0;
    if (lat < 0.55 && vert && !flying) {
      if (s.invuln > 0) continue;
      if (o.t === 'low') { s.gone[o.id] = s.time; bump(s, G); }
      else if (G.hit(s, `Crashed into the ${o.name}`, o) && s.status === 'playing') s.gone[o.id] = s.time;
      if (s.status !== 'playing') return;
      continue;
    }
    // Near misses: a last-moment lane dodge, or a barrier cleared by a hair.
    if (!flying && s.flag[`n${o.id}`] === undefined) {
      if ((o.t === 'wall' || o.t === 'mover') && lat >= 0.55 && lat < 1.2 && p.switchT < 0.3 && o.lane === p.from) G.nearMiss(s, o);
      else if (o.t === 'low' && lat < 0.55 && p.y > 0 && p.y - y1 < 0.3) G.nearMiss(s, o);
      else if (o.t === 'high' && lat < 0.55 && p.slideT > LANES.slide - 0.22) G.nearMiss(s, o);
    }
  }
}

function powerStart(s, kind, G) {
  if (kind !== 'jetpack') return;
  const p = s.p;
  p.flyY = p.y; p.slideT = 0;
  // A coin line along the high path.
  const list = [];
  const secs = s.powers.jetpack;
  for (let d = 6; d < s.speed * secs - 4; d += 2.2) list.push({ t: 'coin', lane: p.lane, z: p.z + d, y: LANES.fly + 0.4, p: p.z + d - 0.5, e: p.z + d + 0.4, sky: true });
  G.add(s, list);
}

export default {
  id: 'lanes', ahead: 150, behind: 10, compile, place, init, step,
  progress: s => s.p.z,
  onPower: powerStart,
  respawn(s) { s.p.chaseT = 0; s.p.tripT = 0; },
  powerEnd(s, kind) { if (kind === 'jetpack') { s.p.air = true; s.p.vy = 0; s.invuln = Math.max(s.invuln, 0.6); } },
  solver: {
    every: 6,
    actions: [{}, { x: -1 }, { x: 1 }, { a: true }, { y: 1 }],
    key: s => `${s.p.lane}|${Math.round(s.p.x * 4)}|${Math.round(s.p.y * 4)}|${Math.round(s.p.vy)}|${s.p.slideT > 0 ? Math.ceil(s.p.slideT * 10) : 0}|${s.p.chaseT > 0 ? 1 : 0}|${s.invuln > 0 ? 1 : 0}`,
    score: s => -Math.abs(s.p.x) * 0.2 - (s.p.chaseT > 0 ? 2 : 0) + s.coins * 0.05,
    entries: s => Array.from({ length: s.game.content.rules.width }, (_, i) => i),
  },
  physics,
};
