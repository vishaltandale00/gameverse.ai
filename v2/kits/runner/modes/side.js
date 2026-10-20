// Side mode (Canabalt / Chrome Dino / Jetpack Joyride): auto-run to +x.
// Jump control: a jumps with variable height (release early to cut), coyote
// time and input buffering; rooftops change height, gaps kill, crates slow
// you, spikes and birds kill. Fly control: hold a to thrust between floor and
// ceiling past lasers and warned missiles. Units: 1 = one cell.
import { FEEL, joinGap } from '../world.js';

export const SIDE = { jumpH: 3.3, g: 62, cut: 0.42, coyote: 0.1, buffer: 0.13, maxFall: 32, half: 0.35, h: 1.1, ceil: 8, flyG: 38, thrust: 92, flyUp: 11, flyDown: 13, step: 0.3 };

function physics(content) {
  const f = FEEL[content.feel];
  const g = SIDE.g * f.g, h = SIDE.jumpH * f.j;
  return { g, v0: Math.sqrt(2 * g * h), flyG: SIDE.flyG * f.g, thrust: SIDE.thrust * f.g };
}

function compile(content, chars) {
  const fly = content.control === 'fly';
  return content.chunks.map(k => {
    const sp = k.spacing, objs = [];
    let prevRuns = [];
    k.rows.forEach((row, j) => {
      const x0 = j * sp, x1 = x0 + sp, xc = x0 + sp / 2, cells = [...row];
      // Solid runs, merged with the same run in the previous slice.
      const runs = [];
      if (!fly) for (let i = 0; i < cells.length; i++) if (cells[i] === '#') { let e = i; while (cells[e + 1] === '#') e++; runs.push([i, e + 1]); i = e; }
      const nextRuns = [];
      for (const [y0, y1] of runs) {
        const prev = prevRuns.find(o => o.y0 === y0 && o.y1 === y1 && o.x1 === x0);
        if (prev) { prev.x1 = x1; nextRuns.push(prev); } else { const o = { t: 'solid', x0, x1, y0, y1 }; objs.push(o); nextRuns.push(o); }
      }
      prevRuns = nextRuns;
      // Lasers: vertical runs within the slice.
      for (let i = 0; i < cells.length; i++) {
        const o = chars.get(cells[i]);
        if (o?.kind === 'laser') {
          let e = i; while (chars.get(cells[e + 1])?.kind === 'laser') e++;
          objs.push({ t: 'laser', x0: xc - 0.16, x1: xc + 0.16, y0: i + 0.08, y1: e + 0.92, name: o.name });
          i = e; continue;
        }
        const ch = cells[i];
        if (ch === 'o') objs.push({ t: 'coin', x: xc, y: i + 0.5 });
        else if (ch === '*') objs.push({ t: 'box', x: xc, y: i + 0.5 });
        else if (o?.kind === 'crate') objs.push({ t: 'crate', x: xc, y: i, slow: o.speed, name: o.name });
        else if (o?.kind === 'spike') objs.push({ t: 'spike', x: xc, y: i, name: o.name });
        else if (o?.kind === 'bird') objs.push({ t: 'bird', x: xc, y: i + 0.5, k: o.speed, period: o.period, name: o.name });
        else if (o?.kind === 'missile') objs.push({ t: 'missile', x: xc, y: i + 0.5, k: o.speed, warn: o.period, name: o.name });
      }
    });
    return { id: k.id, tier: k.tier, objs, length: k.rows.length * sp };
  });
}

const join = s => s.game.content.control === 'fly' ? joinGap(s, Math.max(5, s.game.content.speed.max * 0.4), 3) : joinGap(s, Math.max(3, s.game.content.speed.max * 0.22), 2);
// Where moving things are, as a function of the hero's x (so geometry is speed-independent).
export const birdX = (o, px) => o.x - o.k * Math.max(0, px - (o.x - 30));
export const birdY = (o, px, vRef) => o.y + 0.25 * Math.sin((2 * Math.PI * px) / Math.max(1, o.period * vRef));
export const missileX = (o, px) => o.x + o.k * (o.x - px);

function place(s, chunk, at, G) {
  const J = join(s), fly = s.game.content.control === 'fly';
  const list = [];
  if (!fly) list.push({ t: 'solid', x0: at, x1: at + J, y0: 0, y1: 1, p: at, e: at + J });
  const start = at + J;
  for (const o of chunk.objs) {
    if (o.t === 'solid' || o.t === 'laser') list.push({ ...o, x0: start + o.x0, x1: start + o.x1, p: start + o.x0 - 1, e: start + o.x1 });
    else {
      const x = start + o.x;
      const p = o.t === 'missile' ? x - 48 : o.t === 'bird' ? x - (30 * o.k) / (1 + o.k) - 2 : x - 1.2;
      list.push({ ...o, x, p, e: x + 1.5, ...(o.t === 'box' ? { power: G.pickPower(s) } : {}) });
    }
  }
  // Solids first at equal p keeps landing order stable.
  G.add(s, list);
  return J + chunk.length;
}

function init(s, G, { trial = false, entry = 0 } = {}) {
  const fly = s.game.content.control === 'fly';
  const y = fly ? [0, 3.4, 6.9][entry] ?? 0 : 1;
  s.p = { x: trial ? -2 : 0, y, vy: 0, ground: !fly || y === 0, coyote: 0, buffer: 0, cut: true, slow: 0, slow0: 0, airT: 0, fallV: 0, thrust: false };
  if (!fly) G.add(s, [{ t: 'solid', x0: trial ? -8 : -14, x1: trial ? 0 : 26, y0: 0, y1: 1, p: trial ? -8 : -14, e: trial ? 0 : 26 }]);
  s.nextAt = trial ? 0 : 26;
}

function trialEnd(s, G) {
  if (s.game.content.control !== 'fly') G.add(s, [{ t: 'solid', x0: s.trial.end, x1: s.trial.end + 30, y0: 0, y1: 1, p: s.trial.end, e: s.trial.end + 30 }]);
}

const overlap = (ax0, ax1, ay0, ay1, bx0, bx1, by0, by1) => ax0 < bx1 && ax1 > bx0 && ay0 < by1 && ay1 > by0;

function step(s, inp, press, dt, G) {
  const p = s.p, c = s.game.content, ph = physics(c);
  const flyMode = c.control === 'fly', fly = flyMode || s.powers.jetpack > 0;
  if (p.slow > 0) p.slow = Math.max(0, p.slow - (p.slow0 / 1.2) * dt);
  const v = s.speed * (1 - p.slow);
  p.x += v * dt;
  const prevY = p.y, wasGround = p.ground;
  if (fly) {
    p.thrust = inp.a;
    if (inp.a) p.vy += ph.thrust * dt;
    p.vy = Math.max(-SIDE.flyDown, Math.min(SIDE.flyUp, p.vy - ph.flyG * dt));
    if (press.a) G.count(s, 'jumps');
  } else {
    if (press.a) p.buffer = SIDE.buffer;
    p.coyote = p.ground ? SIDE.coyote : p.coyote - dt;
    if (p.buffer > 0 && p.coyote > 0) {
      p.vy = ph.v0 * (s.powers.superjump > 0 ? 1.3 : 1); p.ground = false; p.coyote = 0; p.buffer = 0; p.cut = false;
      G.count(s, 'jumps'); G.emit(s, 'jump');
    }
    p.buffer -= dt;
    if (!inp.a && !p.cut && p.vy > 0) { p.vy *= SIDE.cut; p.cut = true; }
    p.vy = Math.max(-SIDE.maxFall, p.vy - ph.g * (p.vy < 0 ? 1.12 : 1) * dt);
  }
  p.y += p.vy * dt;
  p.ground = false;
  if (flyMode) {
    if (p.y <= 0) { if (!wasGround && p.vy < -6) G.emit(s, 'land', { impact: Math.min(1, -p.vy / 13) }); p.y = 0; p.vy = 0; p.ground = true; }
    if (p.y + SIDE.h >= SIDE.ceil) { p.y = SIDE.ceil - SIDE.h; p.vy = Math.min(0, p.vy); }
  }
  const x0 = p.x - SIDE.half, x1 = p.x + SIDE.half;
  // Solids: land, bonk, then side hits (with a small step-up assist).
  if (!flyMode) for (const o of s.objs) {
    if (o.p > x1 + 1) break;
    if (o.t !== 'solid' || o.x1 <= x0 + 0.02 || o.x0 >= x1 - 0.02) continue;
    if (p.vy <= 0 && prevY >= o.y1 - 0.06 && p.y <= o.y1 + 0.001) {
      if (!wasGround && p.vy < -8) G.emit(s, 'land', { impact: Math.min(1, -p.vy / 28) });
      p.y = o.y1; p.vy = 0; p.ground = true;
    } else if (p.vy > 0 && prevY + SIDE.h <= o.y0 + 0.02 && p.y + SIDE.h > o.y0) { p.y = o.y0 - SIDE.h; p.vy = 0; }
  }
  if (!flyMode) for (const o of s.objs) {
    if (o.p > x1 + 1) break;
    if (o.t !== 'solid' || !overlap(x0, x1, p.y, p.y + SIDE.h, o.x0, o.x1, o.y0, o.y1)) continue;
    if (o.y1 - p.y <= SIDE.step) { p.y = o.y1; p.vy = 0; p.ground = true; continue; }
    if (G.hit(s, 'Slammed into a wall')) { p.y = o.y1; p.vy = 0; p.ground = true; }
    if (s.status !== 'playing') return;
  }
  p.airT = p.ground ? 0 : p.airT + dt;
  if (p.y < -5) { G.die(s, 'Fell between the rooftops'); return; }
  // Objects.
  const cy = p.y + SIDE.h / 2, magnet = s.powers.magnet > 0, vRef = c.speed.start;
  for (const o of s.objs) {
    if (o.p > x1 + 1) break;
    if (o.t === 'solid' || s.gone[o.id] !== undefined) continue;
    let box = null, deadly = true, reason = '';
    if (o.t === 'coin' || o.t === 'box') {
      const dx = o.x - p.x, dy = o.y - cy;
      if (magnet ? dx * dx + dy * dy < 12 : Math.abs(dx) < 0.62 && Math.abs(dy) < 0.85) o.t === 'coin' ? G.collect(s, o) : G.power(s, o);
      continue;
    }
    if (o.t === 'crate') { box = [o.x - 0.45, o.x + 0.45, o.y, o.y + 0.9]; deadly = false; }
    else if (o.t === 'spike') { box = [o.x - 0.3, o.x + 0.3, o.y, o.y + 0.55]; reason = `Ran into the ${o.name}`; }
    else if (o.t === 'bird') { const bx = birdX(o, p.x), by = birdY(o, p.x, vRef); box = [bx - 0.36, bx + 0.36, by - 0.22, by + 0.22]; reason = `Struck by a ${o.name}`; }
    else if (o.t === 'laser') { box = [o.x0, o.x1, o.y0, o.y1]; reason = `Zapped by the ${o.name}`; }
    else if (o.t === 'missile') {
      const mx = missileX(o, p.x);
      if (mx - p.x > 13 && s.flag[`w${o.id}`] === undefined && mx - p.x < 13 + v * (1 + o.k) * o.warn) { s.flag[`w${o.id}`] = 1; G.emit(s, 'warn', { id: o.id, y: o.y }); }
      box = [mx - 0.5, mx + 0.5, o.y - 0.2, o.y + 0.2]; reason = `Hit by a ${o.name}`;
    }
    if (!box) continue;
    if (overlap(x0, x1, p.y, p.y + SIDE.h, ...box)) {
      if (!deadly) { s.gone[o.id] = s.time; p.slow = Math.max(p.slow, o.slow); p.slow0 = p.slow; G.emit(s, 'crate', { id: o.id }); G.emit(s, 'hit'); continue; }
      if (s.invuln > 0) continue;
      G.hit(s, reason, o);
      if (s.status !== 'playing') return;
    } else if (deadly && s.flag[`n${o.id}`] === undefined && overlap(x0 - 0.3, x1 + 0.3, p.y - 0.3, p.y + SIDE.h + 0.3, ...box)) G.nearMiss(s, o);
  }
}

export default {
  id: 'side', ahead: 44, behind: 12, compile, place, init, step, trialEnd,
  progress: s => s.p.x,
  // A lost life lifts the hero back above the rooftops on a short jetpack.
  respawn(s) { const p = s.p; if (p.y < 0.5 || s.game.content.control !== 'fly') { p.y = Math.max(p.y, 6); p.vy = 0; } if (s.game.content.control !== 'fly') s.powers.jetpack = Math.max(s.powers.jetpack || 0, 1.5); },
  powerEnd(s, kind) {
    if (kind !== 'jetpack' || s.game.content.control === 'fly') return;
    // Keep flying until there is a roof underneath.
    const p = s.p;
    const under = s.objs.some(o => o.t === 'solid' && o.x0 < p.x + 0.3 && o.x1 > p.x + 2 && o.y1 <= p.y + 0.01);
    if (!under) s.powers.jetpack = 0.2;
  },
  solver: {
    every: 4,
    actions: [{}, { a: true }],
    key: s => `${Math.round(s.p.y * 6)}|${Math.round(s.p.vy * 1.5)}|${s.p.ground ? 1 : 0}|${s.p.cut ? 1 : 0}|${Math.round(s.p.slow * 10)}|${s.invuln > 0 ? 1 : 0}|${Math.round(s.p.buffer * 30)}`,
    score: s => (s.game.content.control === 'fly' ? -Math.abs(s.p.y - 3.4) * 0.05 : 0) - s.p.slow * 2 + s.coins * 0.05,
    entries: s => s.game.content.control === 'fly' ? [0, 1, 2] : [0],
  },
  physics,
};
