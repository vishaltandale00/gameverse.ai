// Rhythm-dash mode (Geometry Dash): auto-run on a beat grid synced to the
// content's tempo. Holding a jumps whenever grounded; jumps last one beat and
// cover one beat of cells, so features authored on beats line up with the
// music. Segments (run, spikes, blocks, stairs, pads, orbs, gravity, speed,
// gaps) are expanded from templates by intensity; the level is finite and
// reaching the goal wins. Units: 1 = one cell, 4 cells per beat at 1x.

export const DASH = { cellsPerBeat: 4, jumpH: 2.1, half: 0.45, padK: 1.5, ceil: 6, spikeHalf: 0.2, spikeH: 0.5, countIn: 2, outro: 2 };
const SPEEDS = [0.8, 1.25, 1.5];

export function physics(content) {
  const beat = 60 / content.music.tempo, T = beat;
  return { beat, v: DASH.cellsPerBeat / beat, g: (8 * DASH.jumpH) / (T * T), v0: (4 * DASH.jumpH) / T };
}

/** Expand segments into level objects. Deterministic from content alone (the level is the same for every seed). */
function level(content) {
  const objs = [], segs = [];
  let x = 0, sf = 1;
  const floorCuts = [];
  const spike = (cx, base = 0, dir = 1) => objs.push({ t: 'spike', x: cx, y: base, dir });
  const spikes = (x0, n, base = 0, dir = 1) => { for (let i = 0; i < n; i++) spike(x0 + i + 0.5, base, dir); };
  const block = (x0, x1, y0, y1) => objs.push({ t: 'block', x0, x1, y0, y1 });
  const coin = (cx, y) => objs.push({ t: 'coin', x: cx, y });
  const add = (type, bars, intensity) => {
    const cpb = DASH.cellsPerBeat * sf, X = x, at = b => X + b * cpb, beats = bars * 4, I = intensity;
    const cells = n => Math.max(1, Math.round(n * sf)), maxRun = Math.max(1, Math.floor(3.65 * sf - 0.15));
    const run = (x0, n, base, dir) => spikes(x0, Math.min(n, maxRun), base, dir);
    const seg = { type, x0: X, x1: X + beats * cpb, sf, intensity: I, bars };
    for (let k = 0; k < bars; k++) {
      const B = 4 * k;
      if (type === 'run') { for (let b = 1; b <= 3; b++) coin(at(B + b) + 0.5, 0.6); }
      else if (type === 'spikes') {
        const plan = [[[2, 1]], [[1, 1], [3, 2]], [[1, 2], [3, 3]]][I - 1];
        for (const [b, n] of plan) run(Math.round(at(B + b)), n);
        if (k % 2) coin(Math.round(at(B + plan[0][0])) + 0.5, 2.4);
      } else if (type === 'blocks') {
        const x0 = Math.round(at(B + 1)), x1 = Math.round(at(B + 2.5));
        block(x0, x1, 0, 1);
        if (I >= 2) spike(Math.round(at(B + 1.75)) + 0.5, 1);
        if (I >= 3) block(Math.round(at(B + 2)), x1, 1, 2);
        if (I >= 2) spikes(Math.round(at(B + 3.5)), 1);
        coin((x0 + x1) / 2, I >= 3 ? 3 : 2);
      } else if (type === 'stairs') {
        if (k === 0) {
          const steps = I === 1 ? 2 : 3;
          for (let i = 0; i < steps; i++) block(Math.round(at(1 + i)), Math.round(at(1 + steps)), 0, i + 1);
          coin(Math.round(at(steps + 0.5)) + 0.5, steps + 1);
          if (I >= 3) spikes(Math.round(at(steps + 2)), 1);
        } else run(Math.round(at(B + 2)), I >= 2 ? 2 : 1);
      } else if (type === 'pads') {
        if (I === 1 && k % 2) continue;
        const xp = Math.round(at(B + 1));
        objs.push({ t: 'pad', x: xp + 0.5, y: 0 });
        spikes(xp + cells(1.5), cells(3));
        coin(xp + cells(3.5), 4.2);
        if (I >= 3) spikes(Math.round(at(B + 3.25)), 1);
      } else if (type === 'orbs') {
        const x0 = Math.round(at(B + 1)), len = cells(4 + I);
        spikes(x0, len);
        objs.push({ t: 'orb', x: x0 + cells(3), y: 1.6 });
        coin(x0 + cells(3), 2.9);
      } else if (type === 'gravity') {
        if (k === 0) { objs.push({ t: 'portal', x: at(0.25), kind: 'gravity', value: -1 }); block(X, X + beats * cpb, DASH.ceil, DASH.ceil + 3); }
        if (k === bars - 1) objs.push({ t: 'portal', x: at(beats - 0.75), kind: 'gravity', value: 1 });
        const plan = [[2], [2, 3.5], [1.75, 3]][I - 1];
        for (const b of plan) if (B + b > 1.5 && B + b < beats - 1) run(Math.round(at(B + b)), I >= 3 && b === 3 ? 2 : 1, DASH.ceil, -1);
        if (k % 2 === 0) coin(Math.round(at(B + 1)) + 0.5, DASH.ceil - 0.6);
      } else if (type === 'speed') {
        if (k === 0) { sf = SPEEDS[I - 1]; seg.sf = sf; objs.push({ t: 'portal', x: X + 1, kind: 'speed', value: sf }); }
        const cpb2 = DASH.cellsPerBeat * sf;
        if (B > 0 || k === 0) spikes(Math.round(X + 1 + (B + 2) * cpb2), 1);
      } else if (type === 'gaps') {
        const w = cells(I + 1);
        floorCuts.push([Math.round(at(B + 1)), Math.round(at(B + 1)) + w]);
        if (I >= 2) floorCuts.push([Math.round(at(B + 3)), Math.round(at(B + 3)) + Math.min(w, 3)]);
      }
    }
    // A speed segment's own length runs at its new speed.
    if (type === 'speed') { seg.x1 = X + 1 + beats * DASH.cellsPerBeat * sf; x = seg.x1; }
    else x = seg.x1;
    segs.push(seg);
  };
  add('run', DASH.countIn, 1);
  for (const s of content.segments) add(s.type, s.bars, s.intensity);
  add('run', DASH.outro, 1);
  const end = x;
  objs.push({ t: 'goal', x: end - 4 });
  // Floor with gaps cut out.
  floorCuts.sort((a, b) => a[0] - b[0]);
  let fx = -12;
  for (const [a, b] of floorCuts) { if (a > fx) block(fx, a, -3, 0); fx = Math.max(fx, b); }
  block(fx, end + 30, -3, 0);
  for (const o of objs) {
    if (o.t === 'block') { o.p = o.x0 - 1; o.e = o.x1; }
    else { o.p = o.x - 1.5; o.e = o.x + 1.5; }
  }
  objs.sort((a, b) => a.p - b.p);
  return { objs, segs, end: end - 4 };
}

function init(s, G) {
  s.p = { x: 0, y: DASH.half, vy: 0, grav: 1, ground: true, sf: 1, buffer: 0, rot: 0, padT: 9, airT: 0 };
  G.add(s, s.game.level.objs.map(o => ({ ...o })));
}

const overlap = (ax0, ax1, ay0, ay1, bx0, bx1, by0, by1) => ax0 < bx1 && ax1 > bx0 && ay0 < by1 && ay1 > by0;

function step(s, inp, press, dt, G) {
  const p = s.p, ph = physics(s.game.content), H = DASH.half;
  const prevX = p.x, prevY = p.y;
  p.x += s.speed * dt;
  if (press.a) p.buffer = 0.1;
  // Orbs: a press while overlapping jumps again in mid-air.
  for (const o of s.objs) {
    if (o.p > p.x + 1) break;
    if (o.t === 'orb' && s.flag[`o${o.id}`] === undefined && p.buffer > 0 && Math.hypot(o.x - p.x, o.y - p.y) < 1.05) {
      s.flag[`o${o.id}`] = 1; p.vy = p.grav * ph.v0; p.ground = false; p.buffer = 0; G.emit(s, 'orb', { id: o.id }); G.count(s, 'jumps');
    }
  }
  if (p.ground && (inp.a || p.buffer > 0)) { p.vy = p.grav * ph.v0; p.ground = false; p.buffer = 0; G.count(s, 'jumps'); G.emit(s, 'jump'); }
  p.buffer -= dt;
  p.vy -= p.grav * ph.g * dt;
  p.vy = Math.max(-2.6 * ph.v0, Math.min(2.6 * ph.v0, p.vy));
  p.y += p.vy * dt;
  const wasGround = p.ground;
  p.ground = false;
  const x0 = p.x - H + 0.04, x1 = p.x + H - 0.04;
  for (const o of s.objs) {
    if (o.p > x1 + 1) break;
    if (o.t !== 'block' || o.x1 <= x0 || o.x0 >= x1) continue;
    if (p.grav > 0 && p.vy <= 0 && prevY - H >= o.y1 - 0.12 && p.y - H <= o.y1) { p.y = o.y1 + H; p.vy = 0; p.ground = true; }
    else if (p.grav < 0 && p.vy >= 0 && prevY + H <= o.y0 + 0.12 && p.y + H >= o.y0) { p.y = o.y0 - H; p.vy = 0; p.ground = true; }
  }
  if (p.ground && !wasGround && p.airT > 0.12) G.emit(s, 'land');
  p.airT = p.ground ? 0 : p.airT + dt;
  for (const o of s.objs) {
    if (o.p > x1 + 1) break;
    if (o.t === 'block' && overlap(x0, x1, p.y - H + 0.08, p.y + H - 0.08, o.x0, o.x1, o.y0, o.y1)) { G.die(s, 'Crashed into a block'); return; }
  }
  // Spikes, pads, portals, coins, goal.
  for (const o of s.objs) {
    if (o.p > x1 + 1) break;
    if (o.t === 'spike') {
      const by0 = o.dir > 0 ? o.y : o.y - DASH.spikeH, by1 = o.dir > 0 ? o.y + DASH.spikeH : o.y;
      const hx0 = p.x - 0.3, hx1 = p.x + 0.3, hy0 = p.y - 0.3, hy1 = p.y + 0.3;
      if (overlap(hx0, hx1, hy0, hy1, o.x - DASH.spikeHalf, o.x + DASH.spikeHalf, by0, by1)) { G.die(s, `Spiked`); return; }
      if (overlap(hx0 - 0.22, hx1 + 0.22, hy0 - 0.22, hy1 + 0.22, o.x - DASH.spikeHalf, o.x + DASH.spikeHalf, by0, by1)) G.nearMiss(s, o);
    } else if (o.t === 'pad') {
      if (s.flag[`p${o.id}`] === undefined && Math.abs(o.x - p.x) < 0.75 && p.y - H < 0.35) { s.flag[`p${o.id}`] = 1; p.vy = DASH.padK * ph.v0; p.ground = false; p.padT = 0; G.emit(s, 'pad', { id: o.id }); }
    } else if (o.t === 'portal') {
      if (prevX < o.x && p.x >= o.x) {
        if (o.kind === 'gravity') { if (p.grav !== o.value) { p.grav = o.value; p.ground = false; } }
        else p.sf = o.value;
        G.emit(s, 'portal', { kind: o.kind, value: o.value });
      }
    } else if (o.t === 'coin') {
      if (s.gone[o.id] === undefined && Math.abs(o.x - p.x) < 0.8 && Math.abs(o.y - p.y) < 0.9) G.collect(s, o);
    } else if (o.t === 'goal' && p.x >= o.x) {
      s.status = 'won'; s.bonus += 1000; G.emit(s, 'reach_goal'); G.emit(s, 'won'); return;
    }
  }
  p.padT += dt;
  s.progress = Math.min(100, Math.floor((100 * p.x) / s.game.level.end));
  if (p.y < -4 || p.y > DASH.ceil + 6) G.die(s, 'Fell out of the level');
}

export default {
  id: 'rhythm-dash', ahead: 0, behind: 12, slowmo: false, noIntro: true,
  compile: () => [], level, init, step,
  place: () => 0,
  progress: s => s.p.x,
  // A lost life restarts the current segment (a checkpoint), with its orbs and pads fresh.
  respawn(s) {
    const p = s.p, seg = s.game.level.segs.find(g => p.x >= g.x0 && p.x < g.x1) || s.game.level.segs[0];
    Object.assign(p, { x: seg.x0 + 0.5, y: DASH.half, vy: 0, grav: 1, ground: true, sf: seg.sf, buffer: 0, airT: 0 });
    for (const o of s.objs) if (o.x >= seg.x0) { delete s.flag[`o${o.id}`]; delete s.flag[`p${o.id}`]; }
    s.invuln = 0;
  },
  speedOf: s => physics(s.game.content).v * s.p.sf,
  solver: {
    every: 2,
    actions: [{}, { a: true }],
    bucket: s => `${Math.round(s.p.y * 2)}|${s.p.grav}`,
    key: s => `${Math.round(s.p.y * 8)}|${Math.round(s.p.vy)}|${s.p.grav}|${s.p.ground ? 1 : 0}|${s.p.buffer > 0 ? 1 : 0}|${s.p.sf}`,
    score: s => (s.p.ground ? 0.5 : 0) + s.coins * 0.05,
  },
  physics,
};
