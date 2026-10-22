// World adapter for cross-genre mods (KIT_CONTRACT.md, "World adapter and mods").
// Scrolling modes (lanes, side, flap, rhythm-dash) report positions relative to
// the hero along the run axis, so a shot fired at mod speed keeps ahead of an
// auto-running hero. Climb and hop report absolute field coordinates.
// Shootable things are enemies: lanes barriers and oncoming trains, side birds,
// missiles and crates, climb monsters. Parked trains, rooftops, pipes, blocks
// and trees are blocking terrain. Flap, hop and rhythm-dash have no shootable
// enemies (pipes, traffic and spikes are terrain or indestructible).
import { zOf, mid } from './modes/lanes.js';
import { birdX, birdY, missileX } from './modes/side.js';
import { offsetOf, FLAP } from './modes/flap.js';
import { xOf, wrap, CLIMB } from './modes/climb.js';
import { G } from './world.js';
import { random } from '../../kernel/rng.js';

/** Which world operations each mode honors (see EXTENDING.md): every mode scores, hurts and ends; lanes and climb spawn; all but the beat-locked dash can be shielded. */
export function capabilitiesFor(content) {
  const mode = content?.mode;
  const caps = ['player', 'enemies', 'blocked', 'defeat', 'lives', 'score', 'hurt', 'end'];
  if (mode === 'lanes' || mode === 'climb') caps.push('spawn');
  if (mode !== 'rhythm-dash') caps.push('invulnerable');
  return caps;
}

const inBox = (x, y, x0, x1, y0, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

export function worldAdapter(game) {
  const mode = game.content.mode;
  const live = s => s.status === 'playing' && s.time > 0.9;
  const defeat = (s, id) => { s.gone[id] = s.time; const pts = 100 * s.mult; s.bonus += pts; return pts; };
  // World operations shared by every mode. Score lands in the bonus pool the kit adds to distance points.
  const ops = {
    addScore: (s, n) => { s.bonus += n; },
    hurtPlayer: (s, { by = 'trouble' } = {}) => { if (s.status !== 'playing') return false; if (s.invuln > 0) { G.emit(s, 'shielded'); return false; } G.hit(s, by); return true; },
    invulnerable: (s, frames) => { if (mode !== 'rhythm-dash') s.invuln = Math.max(s.invuln, frames / 60); },
    end: (s, { won = false, reason = '' } = {}) => {
      if (s.status !== 'playing') return;
      s.status = won ? 'won' : 'lost'; s.reason = reason || (won ? 'Finished' : 'Game over'); s.deathT = s.time;
      G.emit(s, won ? 'won' : 'lost', { reason: s.reason });
    },
  };
  // Spawned obstacles join the placed objects, ahead of the hero: a low barrier to jump (lanes) or a monster above the view (climb).
  const name = kind => game.content.obstacles.find(o => o.kind === kind)?.name;
  const spawn = mode === 'lanes' ? (s, { x, y } = {}) => {
    const w = game.content.rules.width, m = mid(game.content);
    const lane = Number.isFinite(x) ? Math.max(0, Math.min(w - 1, Math.round(x + s.p.x + m))) : Math.floor(random(s) * w);
    const z = s.p.z + (Number.isFinite(y) ? Math.max(30, y) : 42);
    G.add(s, [{ t: 'low', lane, z, len: 0.5, name: name('low') || 'Barrier', p: z - 0.5, e: z + 0.5, spawned: true }]);
    return s.nextId - 1;
  } : mode === 'climb' ? (s, { x, y } = {}) => {
    const W = game.content.rules.width, cy = Number.isFinite(y) ? Math.max(s.p.cam + 9, y) : s.p.cam + 11;
    const cx = Number.isFinite(x) ? wrap(x, W) : 0.5 + random(s) * (W - 1);
    G.add(s, [{ t: 'enemy', cx, y: cy, speed: 1.2, range: 1.5, phase: random(s) * 6, name: name('enemy') || 'Monster', p: cy - 0.5, e: cy + 0.5, spawned: true }]);
    return s.nextId - 1;
  } : undefined;
  const base = { active: live, defeat, lives: s => s.lives, ...ops, ...(spawn ? { spawn } : {}) };
  if (mode === 'lanes') return {
    ...base,
    player: s => ({ x: 0, y: 0, facing: { x: 0, y: 1 } }),
    enemies: s => s.objs.filter(o => (o.t === 'low' || o.t === 'high' || o.t === 'mover') && s.gone[o.id] === undefined)
      .map(o => ({ id: o.id, name: o.name, x: o.lane - mid(game.content) - s.p.x, y: zOf(o, s.p.z) - s.p.z, radius: 0.5, hittable: zOf(o, s.p.z) > s.p.z })).filter(e => e.y < 70),
    blocked: (s, x, y) => {
      const lane = s.p.x + x, z = s.p.z + y;
      if (Math.abs(lane) > mid(game.content) + 0.5) return true;
      return s.objs.some(o => o.t === 'wall' && s.gone[o.id] === undefined && Math.abs(o.lane - mid(game.content) - lane) < 0.5 && z >= o.z && z <= o.z + o.len);
    },
  };
  if (mode === 'side') return {
    ...base,
    player: s => ({ x: 0, y: s.p.y + 0.55, facing: { x: 1, y: 0 } }),
    enemies: s => s.objs.filter(o => (o.t === 'bird' || o.t === 'missile' || o.t === 'crate') && s.gone[o.id] === undefined).map(o => {
      const x = o.t === 'bird' ? birdX(o, s.p.x) : o.t === 'missile' ? missileX(o, s.p.x) : o.x;
      const y = o.t === 'bird' ? birdY(o, s.p.x, game.content.speed.start) : o.t === 'crate' ? o.y + 0.45 : o.y;
      return { id: o.id, name: o.name, x: x - s.p.x, y, radius: 0.45, hittable: x > s.p.x && x - s.p.x < 16 };
    }),
    blocked: (s, x, y) => y < -5 || y > 12 || s.objs.some(o => o.t === 'solid' && inBox(s.p.x + x, y, o.x0, o.x1, o.y0, o.y1)),
  };
  if (mode === 'flap') return {
    ...base,
    player: s => ({ x: 0, y: s.p.y, facing: { x: 1, y: 0 } }),
    enemies: () => [],
    blocked: (s, x, y) => {
      const X = s.p.x + x;
      if (y < 0 || y > FLAP.height) return true;
      return s.objs.some(o => o.t === 'gate' && Math.abs(o.x - X) < FLAP.pipeHalf && o.pipes.some(pp => { const off = offsetOf(pp, s.p.x, game.content.speed.start, o.x); return y >= pp.y0 + off && y <= pp.y1 + off; }));
    },
  };
  if (mode === 'climb') return {
    ...base,
    player: s => ({ x: s.p.x, y: s.p.y + 0.4, facing: { x: 0, y: 1 } }),
    enemies: s => s.objs.filter(o => o.t === 'enemy' && s.gone[o.id] === undefined).map(o => ({ id: o.id, name: o.name, x: xOf(o, s.time, s.speed, game.content.rules.width), y: o.y, radius: 0.55, hittable: true })),
    blocked: (s, x, y) => y > s.p.cam + 10,
    wrap: (s, x, y) => [wrap(x, game.content.rules.width), y],
    defeat: (s, id) => { s.gone[id] = s.time; s.stats.stomps++; const pts = 50 * s.mult; s.bonus += pts; return pts; },
  };
  if (mode === 'hop') return {
    ...base,
    player: s => ({ x: s.p.x, y: s.p.r, facing: { x: 0, y: 1 } }),
    enemies: () => [],
    blocked: (s, x, y) => {
      if (x < -0.5 || x > game.content.rules.width - 0.5) return true;
      const r = Math.round(y), row = s.objs.find(o => o.t === 'row' && o.r === r);
      return !!row && row.kind === 'grass' && !!row.trees[Math.round(x)];
    },
  };
  // rhythm-dash
  return {
    ...base,
    player: s => ({ x: 0, y: s.p.y, facing: { x: 1, y: 0 } }),
    enemies: () => [],
    blocked: (s, x, y) => s.objs.some(o => o.t === 'block' && inBox(s.p.x + x, y, o.x0, o.x1, o.y0, o.y1)),
  };
}
void CLIMB;
