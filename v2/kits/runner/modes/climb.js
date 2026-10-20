// Climb mode (Doodle Jump): the hero bounces automatically off platforms it
// falls onto; x steers with inertia and wraps around the 9-unit-wide field;
// a shoots straight up. Platforms can move, break, spring or vanish; enemies
// are stomped or shot; holes swallow. The camera only rises: fall below it
// and the run ends. Difficulty raises moving speeds along the run.
import { FEEL } from '../world.js';

export const CLIMB = { width: 9, g: 30, bounce: 15.5, spring: 24, rocket: 13, run: 7.5, accel: 42, half: 0.33, h: 0.8, view: 7, shot: 24 };
const PLATFORM_KINDS = ['platform', 'moving', 'breaking', 'spring', 'vanishing'];

function physics(content) {
  const f = FEEL[content.feel];
  const g = CLIMB.g * f.g, k = Math.sqrt(f.g * f.j);
  return { g, bounce: CLIMB.bounce * k, spring: CLIMB.spring * k, accel: CLIMB.accel / f.air };
}

function compile(content, chars) {
  return content.chunks.map(k => {
    const objs = [];
    k.rows.forEach((row, r) => {
      const y = r * k.spacing, cells = [...row];
      for (let c = 0; c < cells.length; c++) {
        const ch = cells[c], o = chars.get(ch);
        const kind = ch === '=' ? 'platform' : o?.kind;
        if (PLATFORM_KINDS.includes(kind)) {
          let e = c; while (cells[e + 1] === ch) e++;
          const w = Math.max(1.3, e - c + 1);
          objs.push({ t: kind, cx: (c + e + 1) / 2, y, w, speed: o?.speed || 0, range: o?.size || 0, phase: r * 1.7 + c, name: o?.name || 'Platform' });
          c = e;
        } else if (kind === 'enemy') objs.push({ t: 'enemy', cx: c + 0.5, y: y + 0.55, speed: o.speed, range: o.size, phase: r * 1.3, name: o.name });
        else if (kind === 'hole') objs.push({ t: 'hole', cx: c + 0.5, y: y + 0.5, r: o.size, name: o.name });
        else if (ch === 'o') objs.push({ t: 'coin', cx: c + 0.5, y: y + 0.5 });
        else if (ch === '*') objs.push({ t: 'box', cx: c + 0.5, y: y + 0.5 });
      }
    });
    return { id: k.id, tier: k.tier, objs, length: (k.rows.length - 1) * k.spacing + k.spacing, top: (k.rows.length - 1) * k.spacing, spacing: k.spacing };
  });
}

export const wrap = (x, W = CLIMB.width) => ((x % W) + W) % W;
const wrapDelta = (a, b, W) => { let d = a - b; d -= Math.round(d / W) * W; return d; };
/** Horizontal centre of a moving thing at sim time t, scaled by the difficulty factor. */
export const xOf = (o, t, f, W) => o.range > 0 && o.speed > 0 ? wrap(o.cx + o.range * Math.sin((t * o.speed * f) / o.range + o.phase), W) : o.cx;

function place(s, chunk, at, G) {
  G.add(s, chunk.objs.map(o => ({ ...o, y: at + o.y, p: at + o.y - 0.5, e: at + o.y + 0.5, ...(o.t === 'box' ? { power: G.pickPower(s) } : {}) })));
  return chunk.length;
}

function init(s, G, { trial = false, entry = 0 } = {}) {
  const W = s.game.content.rules.width, x = trial ? [W / 2, 0.5][entry] ?? W / 2 : W / 2;
  s.p = { x, y: trial ? -1.6 : 0, vy: trial ? 0 : 15, vx: 0, cam: trial ? -1.6 : 0, shots: [], face: 1, bounceT: 9, rocket: false, landY: trial ? -1.6 : 0 };
  // Start on a floor (game) or a single entry platform (trial).
  if (trial) G.add(s, [{ t: 'platform', cx: x, y: -1.6, w: 1.3, speed: 0, range: 0, phase: 0, p: -2.1, e: -1.1, name: 'Platform' }]);
  else G.add(s, [{ t: 'platform', cx: W / 2, y: 0, w: W, speed: 0, range: 0, phase: 0, p: -0.5, e: 0.5, name: 'Ground', floor: true }]);
  s.nextAt = trial ? 0 : 2;
}

function step(s, inp, press, dt, G) {
  const p = s.p, c = s.game.content, ph = physics(c), f = s.speed;
  const rocket = s.powers.jetpack > 0, W = c.rules.width;
  // Steering with inertia.
  const target = inp.x * CLIMB.run, dv = target - p.vx, a = ph.accel * dt;
  p.vx += Math.abs(dv) <= a ? dv : Math.sign(dv) * a;
  if (inp.x) p.face = inp.x;
  p.x = wrap(p.x + p.vx * dt, W);
  const prevY = p.y;
  if (rocket) { p.vy = CLIMB.rocket; p.rocket = true; }
  else p.vy = Math.max(-24, p.vy - ph.g * dt);
  p.y += p.vy * dt;
  p.bounceT += dt;
  // Shots.
  if (press.a && p.shots.length < 3) { p.shots.push({ x: p.x, y: p.y + CLIMB.h, t: 0 }); G.emit(s, 'shoot'); }
  for (const sh of p.shots) { sh.y += CLIMB.shot * dt; sh.t += dt; }
  p.shots = p.shots.filter(sh => sh.t < 0.6);
  const magnet = s.powers.magnet > 0;
  for (const o of s.objs) {
    if (o.p > p.y + 3) break;
    if (s.gone[o.id] !== undefined) continue;
    const ox = xOf(o, s.time, f, W);
    const dx = wrapDelta(p.x, ox, W);
    if (o.t === 'coin' || o.t === 'box') {
      const dy = o.y - (p.y + CLIMB.h / 2);
      if (magnet ? dx * dx + dy * dy < 9 : Math.abs(dx) < 0.6 && Math.abs(dy) < 0.7) o.t === 'coin' ? G.collect(s, o) : G.power(s, o);
      continue;
    }
    if (o.t === 'enemy') {
      for (const sh of p.shots) if (Math.abs(wrapDelta(sh.x, ox, W)) < 0.7 && Math.abs(sh.y - o.y) < 0.6) { sh.t = 9; kill(s, o, G); break; }
      if (s.gone[o.id] !== undefined || rocket) continue;
      if (Math.abs(dx) < 0.85 && p.y < o.y + 0.4 && p.y + CLIMB.h > o.y - 0.4) {
        if (p.vy < 0 && prevY >= o.y - 0.1) { kill(s, o, G); p.vy = ph.bounce; G.count(s, 'stomps'); G.emit(s, 'jump'); }
        else if (s.invuln <= 0 && G.hit(s, `Caught by the ${o.name}`, o)) { p.vy = ph.bounce; }
        if (s.status !== 'playing') return;
      } else if (Math.abs(dx) < 1.5 && Math.abs(o.y - p.y) < 1.2) G.nearMiss(s, o);
      continue;
    }
    if (o.t === 'hole') {
      const dy = o.y - (p.y + CLIMB.h / 2), d = Math.hypot(dx, dy);
      if (rocket) continue;
      if (d < o.r * 0.85 && s.invuln <= 0) { if (G.hit(s, `Swallowed by the ${o.name}`, o)) p.vy = ph.spring; if (s.status !== 'playing') return; }
      else if (d < o.r + 1.8) { p.vx -= Math.sign(dx) * 5 * dt; if (d < o.r + 0.6) G.nearMiss(s, o); }
      continue;
    }
    // Platforms: land only when falling onto the top.
    if (rocket || p.vy > 0 || prevY < o.y - 0.02 || p.y > o.y + 0.001) continue;
    if (Math.abs(dx) > o.w / 2 + CLIMB.half - 0.12) continue;
    if (o.t === 'breaking') { s.gone[o.id] = s.time; G.emit(s, 'break', { id: o.id }); continue; }
    p.y = o.y; p.landY = o.y;
    p.vy = o.t === 'spring' ? ph.spring : ph.bounce * (s.powers.superjump > 0 ? 1.35 : 1);
    p.bounceT = 0;
    G.count(s, 'jumps');
    G.emit(s, o.t === 'spring' ? 'spring' : 'jump', { id: o.id });
    if (o.t === 'spring') s.flag[`s${o.id}`] = s.time;
    if (o.t === 'vanishing') s.gone[o.id] = s.time;
  }
  p.cam = Math.max(p.cam, p.y);
  if (p.y < p.cam - CLIMB.view) G.die(s, 'Fell off the bottom');
}

/** Horizontal distance to the nearest platform one bounce above the last landing (search guidance). */
function aim(s) {
  const p = s.p, f = s.speed, W = s.game.content.rules.width;
  let best = W / 2;
  for (const o of s.objs) {
    if (o.y > p.landY + 3.8) break;
    if (o.y <= p.landY + 0.3 || s.gone[o.id] !== undefined || !(o.t === 'platform' || o.t === 'moving' || o.t === 'spring' || o.t === 'vanishing')) continue;
    best = Math.min(best, Math.max(0, Math.abs(wrapDelta(p.x, xOf(o, s.time, f, W), W)) - o.w / 2));
  }
  return best;
}

function kill(s, o, G) {
  s.gone[o.id] = s.time;
  s.bonus += 50 * G.mult(s);
  G.emit(s, 'defeated', { id: o.id });
}

export default {
  id: 'climb', ahead: 28, behind: 12, compile, place, init, step,
  progress: s => s.p.cam,
  respawn(s) { const p = s.p; if (p.y < p.cam - 3) { p.y = p.cam - 2; p.vy = physics(s.game.content).spring; } },
  speedOf: s => s.game.content.speed.start + (s.game.content.speed.max - s.game.content.speed.start) * Math.min(1, s.time / s.game.content.speed.rampSeconds),
  trialDone: s => s.p.cam >= s.trial.end - s.game.pool[s.trial.chunk].spacing + 1,
  clonePlayer: p => ({ ...p, shots: p.shots.map(x => ({ ...x })) }),
  powerEnd(s, kind) { if (kind === 'jetpack') { s.p.rocket = false; s.invuln = Math.max(s.invuln, 0.8); } },
  solver: {
    every: 6,
    actions: [{}, { x: -1 }, { x: 1 }, { a: true, tap: true }],
    key: s => `${Math.round(s.p.x * 2)}|${Math.round(s.p.y * 2)}|${Math.round(s.p.vy / 2)}|${Math.round(s.p.vx / 2)}|${s.p.shots.length}|${s.invuln > 0 ? 1 : 0}`,
    score: s => s.p.landY * 2 + s.p.cam * 0.5 + s.p.y * 0.2 - aim(s) * 0.4 + s.coins * 0.05,
    entries: () => [0, 1],
    // Climb is player-paced: a trial is won by standing above the chunk's top row.
  },
  physics,
};
