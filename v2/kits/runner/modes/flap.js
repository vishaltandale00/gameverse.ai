// Flap mode (Flappy Bird): constant forward drift, a press flaps, gravity
// pulls. Gate columns are 12 cells tall; moving gates oscillate with the
// hero's progress so their geometry is the same at every speed. Columns sit
// closer together as the run goes on. Units: 1 = one cell.
import { FEEL, joinGap } from '../world.js';

export const FLAP = { g: 34, flap: 9.6, maxFall: 14, r: 0.34, height: 12, pipeHalf: 0.75, spacingRamp: 0.25 };

function physics(content) {
  const f = FEEL[content.feel];
  return { g: FLAP.g * f.g, flap: FLAP.flap * Math.sqrt(f.g * f.j) };
}

function compile(content, chars) {
  return content.chunks.map(k => {
    // Rows are a 12-row picture; read it column by column, top to bottom.
    const columns = [...k.rows[0]].map((_, x) => k.rows.map(r => [...r][x] ?? '.').join(''));
    const cols = columns.map(row => {
      const cells = [...row], pipes = [], coins = [], boxes = [];
      for (let r = 0; r < cells.length; r++) {
        const ch = cells[r], o = chars.get(ch);
        if (ch === '#' || o) {
          let e = r, moving = o?.kind === 'gate' ? o : null;
          while (e + 1 < cells.length && (cells[e + 1] === '#' || chars.get(cells[e + 1]))) { e++; const m = chars.get(cells[e]); if (m?.kind === 'gate') moving = m; }
          // Rows count from the top: row r spans y ∈ [11 - r, 12 - r]. Edge pipes extend off-screen.
          const y1 = r === 0 ? FLAP.height + 8 : FLAP.height - r, y0 = e === cells.length - 1 ? -8 : FLAP.height - 1 - e;
          pipes.push({ y0, y1, amp: moving ? moving.size : 0, period: moving ? moving.period : 0, name: (moving || o)?.name || 'Pipe' });
          r = e;
        } else if (ch === 'o') coins.push(FLAP.height - r - 0.5);
        else if (ch === '*') boxes.push(FLAP.height - r - 0.5);
      }
      return { pipes, coins, boxes };
    });
    const gates = cols.filter(c => c.pipes.length).map(gapCentre);
    return { id: k.id, tier: k.tier, spacing: k.spacing, cols, length: cols.length * k.spacing, firstGap: gates[0] ?? 6, lastGap: gates.at(-1) ?? 6 };
  });
}

/** Centre of a gate column's widest opening, ignoring motion. */
function gapCentre(col) {
  const solid = col.pipes.map(p => [p.y0, p.y1]).sort((a, b) => a[0] - b[0]);
  let lo = 0, best = 0, centre = 6;
  for (const [a, b] of [...solid, [FLAP.height, FLAP.height]]) { const top = Math.min(a, FLAP.height); if (top - lo > best) { best = top - lo; centre = (lo + top) / 2; } lo = Math.max(lo, b); }
  return centre;
}

/** Column spacing scale at time t: wide early, authored spacing at the end of the ramp. */
const spacingScale = (content, t) => 1 + FLAP.spacingRamp * (1 - Math.min(1, t / content.speed.rampSeconds));
// Phase is measured from the gate itself, so a chunk has the same geometry wherever it is placed.
export const offsetOf = (pipe, px, vRef, gx = 0) => pipe.amp ? pipe.amp * Math.sin((2 * Math.PI * (px - gx)) / (pipe.period * vRef)) : 0;

function place(s, chunk, at, G) {
  const c = s.game.content;
  const scale = spacingScale(c, s.trial ? s.trial.time : s.time);
  // Between chunks, leave room to climb or dive from the last gap to the next one (climbing is slower).
  const from = s.p.lastGap ?? chunk.firstGap, dy = chunk.firstGap - from;
  // The ramp widens only the space between chunks, so chunk geometry is exactly what the proof checked.
  const sp = chunk.spacing, join = (joinGap(s, 4, 2) + Math.max(0, dy - 2) * 1.3 + Math.max(0, -dy - 4) * 0.6) * scale;
  s.p.lastGap = chunk.lastGap;
  const list = [];
  chunk.cols.forEach((col, j) => {
    const x = at + join + j * sp;
    if (col.pipes.length) list.push({ t: 'gate', x, pipes: col.pipes, p: x - 2, e: x + 2 });
    for (const y of col.coins) list.push({ t: 'coin', x, y, p: x - 1, e: x + 1 });
    for (const y of col.boxes) list.push({ t: 'box', x, y, p: x - 1, e: x + 1, power: G.pickPower(s) });
  });
  G.add(s, list);
  return join + chunk.cols.length * sp;
}

function init(s, G, { trial = false, entry = 1 } = {}) {
  s.p = { x: trial ? -3 : 0, y: trial ? [3, 6, 9][entry] ?? 6 : 6.5, vy: 0, flapT: 9, gates: 0 };
  s.nextAt = trial ? 0 : 14;
}

function circleRect(cx, cy, r, x0, x1, y0, y1) {
  const nx = Math.max(x0, Math.min(cx, x1)), ny = Math.max(y0, Math.min(cy, y1));
  const dx = cx - nx, dy = cy - ny;
  return Math.sqrt(dx * dx + dy * dy) - r;
}

function step(s, inp, press, dt, G) {
  const p = s.p, c = s.game.content, ph = physics(c);
  // In attract-free play the hero glides until the first flap.
  if (press.a) { p.vy = ph.flap; p.flapT = 0; G.count(s, 'flaps'); G.emit(s, 'jump'); }
  p.flapT += dt;
  p.vy = Math.max(-FLAP.maxFall, p.vy - ph.g * dt);
  p.y += p.vy * dt;
  p.x += s.speed * dt;
  if (p.y + FLAP.r > FLAP.height) { p.y = FLAP.height - FLAP.r; p.vy = Math.min(0, p.vy); }
  if (p.y - FLAP.r <= 0) { if (G.hit(s, 'Hit the ground')) { p.y = FLAP.r + 0.01; p.vy = ph.flap; } if (s.status !== 'playing') return; }
  const magnet = s.powers.magnet > 0, vRef = c.speed.start;
  for (const o of s.objs) {
    if (o.p > p.x + 2) break;
    if (s.gone[o.id] !== undefined) continue;
    if (o.t === 'coin' || o.t === 'box') {
      const dx = o.x - p.x, dy = o.y - p.y;
      if (dx * dx + dy * dy < (magnet ? 9 : 0.5)) o.t === 'coin' ? G.collect(s, o) : G.power(s, o);
      continue;
    }
    // Gate column.
    if (Math.abs(o.x - p.x) > FLAP.pipeHalf + FLAP.r + 0.4) {
      if (p.x > o.x + FLAP.pipeHalf && s.flag[`g${o.id}`] === undefined) { s.flag[`g${o.id}`] = 1; p.gates++; G.emit(s, 'gate', { n: p.gates }); }
      continue;
    }
    let clear = 9;
    for (const pipe of o.pipes) {
      const off = offsetOf(pipe, p.x, vRef, o.x);
      clear = Math.min(clear, circleRect(p.x, p.y, FLAP.r, o.x - FLAP.pipeHalf, o.x + FLAP.pipeHalf, pipe.y0 + off, pipe.y1 + off));
    }
    if (clear < 0 && s.invuln <= 0) {
      if (G.hit(s, `Smacked into the ${o.pipes[0].name}`, o)) continue;
      return;
    }
    if (clear >= 0 && clear < 0.32) G.nearMiss(s, o);
  }
}

export default {
  id: 'flap', ahead: 32, behind: 8, compile, place, init, step,
  progress: s => s.p.x,
  spacingScale,
  respawn(s) { s.p.y = 6; s.p.vy = physics(s.game.content).flap; },
  solver: {
    every: 3,
    actions: [{}, { a: true, tap: true }],
    bucket: s => Math.round(s.p.y * 1.5),
    key: s => `${Math.round(s.p.y * 5)}|${Math.round(s.p.vy)}|${s.invuln > 0 ? 1 : 0}`,
    score: s => -nextGapDistance(s) * 0.3 + s.coins * 0.05,
    entries: () => [0, 1, 2],
  },
  physics,
};

/** Distance from the hero to the middle of the next gate's gap (bot heuristic). */
function nextGapDistance(s) {
  const p = s.p, vRef = s.game.content.speed.start;
  for (const o of s.objs) {
    if (o.t !== 'gate' || o.x + FLAP.pipeHalf < p.x - FLAP.r) continue;
    const solid = o.pipes.map(pp => [pp.y0 + offsetOf(pp, o.x, vRef, o.x), pp.y1 + offsetOf(pp, o.x, vRef, o.x)]).sort((a, b) => a[0] - b[0]);
    // The open interval (clipped to the field) nearest the hero.
    let bestD = 99, lo = 0;
    for (const [a, b] of [...solid, [FLAP.height, FLAP.height]]) {
      const top = Math.min(a, FLAP.height);
      if (top - lo >= 1) { const cen = (lo + top) / 2, d = Math.abs(cen - p.y); if (d < bestD) bestD = d; }
      lo = Math.max(lo, b);
    }
    return bestD === 99 ? Math.abs(p.y - 6) : bestD;
  }
  return Math.abs(p.y - 6);
}
