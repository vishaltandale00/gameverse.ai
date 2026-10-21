// Grid-locked movement for any entity on any cell-addressable space (grid,
// tilemap top-down, voxel boards, engine.space.test).
//
// lane: continuous movement along cell lanes. Ported from the maze kit
//   (game.js 179-205): a buffered wanted direction, instant reversal, turns
//   accepted within CORNER (0.45 cell) of a lane centre, the cross axis eased
//   onto the lane while moving (corner cutting), stopping at walls. 100% speed
//   is BASE_SPEED 9.47 cells/s (arcade 75.75 px/s over 8 px tiles).
// step: discrete hops of one cell. Ported from the creature overworld (walk 8
//   frames, run 4, ledge jump 16, turn-in-place 4, bump throttle 16, one-way
//   ledges) and the runner hop mode (0.13 s hops with a queued next hop).
//
// Cell rules come from cell tags (content.blocks[].tags), so any space with
// getCell supports them:
//   ledge:<up|down|left|right>  one-way ledge, jumped over when entered in that direction
//   no:<dir>                    this cell cannot be entered moving <dir> (maze one-way cells)
//   only:<class>                only entities whose components.move.classes include <class> pass (ghost house door)
//   speed tags                  `cellSpeed: {tag: multiplier}` scales lane speed (tunnels)
// Other primitives can scale speed through components.move.grid.speedScale
// (fright mode, eating pauses).
import {
  clamp, round6, mv, bodyOf, state, spaceApi, frameOf, claim, ownedBy, registerBase, isBaseFor, driven, ownerKey, controls, verbs,
  ensureShared, probe, spaceWraps, setFacing, settle, discreteNext, zoneAnchor, dimsOf, COMMON_PARAMS, MACRO_PARAMS, travelAlong,
} from './move-lib-core.js';

const ID = 'gameplay.move.grid';
export const BASE_SPEED = 9.47, CORNER = 0.45;
export const STEP = { walkFrames: 8, runFrames: 4, ledgeFrames: 16, turnFrames: 4, bumpFrames: 16, hopSec: 0.13 };
const NAMES = ['up', 'left', 'down', 'right'];
const D = [[0, 1], [-1, 0], [0, -1], [1, 0]]; // up, left, down, right: the classic tie order
const rev = d => (d + 2) % 4;
const EPS = 1e-6;

function envelope(config) {
  const cps = config.mode === 'lane' ? config.speed : 60 / config.walkFrames;
  return { mode: 'discrete', run: round6(cps), jumpHeight: 0, jumpGap: config.mode === 'step' ? 1 : 0, oneWay: config.mode === 'step', climb: false, swim: false, fly: false };
}

export default {
  id: ID,
  card: {
    locomotion: 'base', medium: 'ground', // base: moves the player on its own; modifier: adds a move on top of base locomotion
    intent: 'Grid-locked movement. lane mode: Pac-Man style continuous movement along cell lanes, with buffered turns, a cornering window, instant reversal and stopping at walls. step mode: one-cell hops with walk/run timing, turn-in-place, queued hops and one-way ledges (Pokémon overworld, Crossy Road). Cell tags add ledges, one-way cells, class-only doors and speed zones.',
    views: ['td', 'board', 'iso'],
    actionSpace: { move: { type: 'vector', min: -1, max: 1, kind: 'continuous' } },
    params: {
      mode: { type: 'string', options: ['lane', 'step'], default: 'step', effect: 'lane: continuous along lanes; step: discrete hops' },
      speed: { type: 'number', min: 0.5, max: 60, default: round6(BASE_SPEED * 0.8), unit: 'cells/s', effect: 'lane speed (classic level 1: 0.8 × 9.47)' },
      corner: { type: 'number', min: 0, max: 0.5, default: CORNER, unit: 'cells', effect: 'how far past a lane centre a turn is still accepted' },
      walkFrames: { type: 'integer', min: 1, max: 120, default: STEP.walkFrames, effect: 'frames per step walking' },
      runFrames: { type: 'integer', min: 1, max: 120, default: STEP.runFrames, effect: 'frames per step with run/sprint held' },
      ledgeFrames: { type: 'integer', min: 1, max: 120, default: STEP.ledgeFrames, effect: 'frames for a ledge jump (two cells)' },
      turnFrames: { type: 'integer', min: 0, max: 30, default: 0, effect: 'a tap toward a new direction turns in place for this many frames first (creature overworld: 4)' },
      queue: { type: 'boolean', default: true, effect: 'a direction pressed mid-step is taken on arrival (runner hop)' },
      up: { type: 'string', options: ['+y', '-y'], default: '+y', effect: 'which way the stick up moves on the board' },
      wrap: { type: 'boolean', default: false, effect: 'wrap around the space bounds (tunnels) when the space does not wrap itself' },
      cellSpeed: { type: 'object', default: {}, open: true, effect: 'lane speed multiplier per cell tag, e.g. {"tunnel": 0.5}' },
      offset: { type: 'number', min: -1, max: 1, effect: 'lane centre offset within a cell; default 0.5 for centre-anchored spaces, else 0' },
      ...COMMON_PARAMS, ...MACRO_PARAMS,
    },
    provides: { events: ['stepped', 'bump', 'ledge_jump', 'turned', 'arrived', 'arrived:*', 'move_failed'], actions: ['up', 'down', 'left', 'right', 'move', 'run', 'travel'] },
    requires: { capabilities: ['position'] },
    optional: { capabilities: ['navigate', 'editCells', 'pathfind', 'bounds', 'wrap'] },
    envelope,
  },
  envelope,
  /** Verifier travel macro: drive this controller along a space path in real steps; true when it arrived. */
  travel: (rt, path, config, instance) => travelAlong(rt, path, { discrete: true, perWaypoint: 60 }),
  install(rt, c, instance) {
    const owner = ownerKey(instance);
    registerBase(rt, owner, 'grid', instance);
    ensureShared(rt, { speed: c.mode === 'lane' ? c.speed : 60 / c.walkFrames, ...c.macro });
    verbs(rt, ['up', 'down', 'left', 'right', 'move', 'run']);
    rt.system('input', rt => { for (const e of driven(rt, c, instance)) if (isBaseFor(rt, e, owner, ID, 'grid')) claim(rt, e, 'grid', 0, owner); }, ID);
    rt.system('movement', rt => {
      for (const e of driven(rt, c, instance)) {
        if (!ownedBy(rt, e, owner) || !dimsOf(e)) continue;
        const api = spaceApi(rt, e); if (!api) continue;
        const G = grid(rt, e, api, c);
        if (c.mode === 'lane') stepLane(rt, e, api, c, G); else stepCell(rt, e, api, c, G);
        settle(e, G.fr);
      }
    }, ID);
    rt.options(rt => {
      const p = rt.player(); if (!p || mv(p).owner !== owner) return [];
      const steps = c.mode === 'lane' ? Math.max(1, Math.round(1 / c.speed / rt.dt)) : c.walkFrames + c.turnFrames;
      return NAMES.map(n => ({ label: `step ${n}`, actions: { [n]: true }, steps }));
    });
  },
};

/** Geometry helpers for one entity: plane axes, lane offset, cell rules. */
function grid(rt, e, api, c) {
  const fr = frameOf(api, e, c.plane), [A, B] = fr.plane.length >= 2 ? fr.plane : [0, 1];
  const off = c.offset ?? (api.anchor === 'center' ? 0.5 : 0);
  const ys = c.up === '-y' ? -1 : 1;
  const toWorld = cell => { const p = e.at.slice(); p[A] = cell[0] + off; p[B] = cell[1] + off; return p; };
  const lanePos = () => [e.at[A] - off, e.at[B] - off];
  const dv = d => [D[d][0], D[d][1] * ys];
  const tagsAtWorld = w => (typeof api.getCell === 'function' ? probe(rt, api, w).tags : []);
  const probeSolid = w => probe(rt, api, w).solid;
  const tagsAt = cell => tagsAtWorld(toWorld(cell));
  const classes = e.components.move?.classes || [];
  const open = (from, d) => {
    const v = dv(d), to = [from[0] + v[0], from[1] + v[1]], w = toWorld(to);
    if (typeof api.inBounds === 'function' && !api.inBounds(w) && !c.wrap && !spaceWraps(api)) return false;
    const tags = tagsAtWorld(w);
    if (tags.includes(`no:${NAMES[d]}`)) return false;
    const only = tags.filter(t => t.startsWith('only:')).map(t => t.slice(5));
    if (only.length && !only.some(k => classes.includes(k))) return false;
    if (tags.some(t => t.startsWith('ledge:'))) return true;
    if (typeof api.canMove === 'function') return api.canMove({ ...e, at: toWorld(from) }, w, rt);
    if (typeof api.getCell === 'function') return !probeSolid(w);
    return true;
  };
  return { fr, A, B, off, toWorld, lanePos, dv, open, tagsAt, api };
}

/** Wanted direction index from input, steer or moveTo; -1 for none. */
function wanted(rt, e, api, c, G, cell) {
  const ctl = controls(rt, e);
  const pick = (x, y) => (Math.abs(x) < 0.3 && Math.abs(y) < 0.3 ? -1 : Math.abs(x) >= Math.abs(y) ? (x > 0 ? 3 : 1) : (y * (c.up === '-y' ? -1 : 1) > 0 ? 0 : 2));
  if (e.components.moveTo && (e.id === 'player' || e.components.move)) {
    const mt = e.components.moveTo, goal = mt.at ?? zoneAnchor(rt, e, mt.zone);
    if (goal == null) { delete e.components.moveTo; rt.emit('move_failed', { who: e.id, reason: 'no_target' }); return -1; }
    const gcell = [Math.round(goal[G.A] - G.off), Math.round(goal[G.B] - G.off)];
    if ((mt.zone && api.inZone?.(e, mt.zone, rt) && !mt.at) || (gcell[0] === cell[0] && gcell[1] === cell[1])) { if (mt.by !== 'ai') { delete e.components.moveTo; mv(e).path = null; rt.emitTyped('arrived', mt.zone ?? null, { who: e.id, zone: mt.zone ?? null }); } return -1; }
    const saved = e.at; e.at = G.toWorld(cell);
    const next = discreteNext(rt, e, api);
    e.at = saved;
    if (!next) return -1;
    return pick(next[G.A] - G.off - cell[0], (next[G.B] - G.off - cell[1]) * (c.up === '-y' ? -1 : 1));
  }
  if (e.id !== 'player' && e.components.steer && e.components.move) { const d = e.components.steer.dir || [0, 0, 0]; return pick(d[G.A] ?? 0, (d[G.B] ?? 0) * (c.up === '-y' ? -1 : 1)); }
  if (!ctl) return -1;
  return pick(ctl.move[0], ctl.move[1]);
}

function laneSpeed(e, c, G) {
  const cell = G.lanePos().map(Math.round), tags = G.tagsAt(cell);
  let k = (e.components.move?.grid?.speedScale ?? 1) * (typeof G.api.speedAt === 'function' ? G.api.speedAt(G.toWorld(cell), e) ?? 1 : 1);
  for (const [tag, mult] of Object.entries(c.cellSpeed || {})) if (tags.includes(tag)) k *= mult;
  return c.speed * k;
}

function stepLane(rt, e, api, c, G) {
  const g = state(e, 'grid'), b = bodyOf(e);
  g.dir ??= -1; g.want ??= -1;
  let [pa, pb] = G.lanePos();
  const cx = Math.round(pa), cy = Math.round(pb);
  const w = wanted(rt, e, api, c, G, [cx, cy]);
  if (w >= 0) g.want = w;
  // tryTurn (maze kit)
  const W = g.want;
  if (W >= 0 && !(W === g.dir && g.moving)) {
    if (g.dir >= 0 && W === rev(g.dir)) { g.dir = W; g.moving = true; }
    else if (W === g.dir) { if (G.open([cx, cy], W)) g.moving = true; }
    else {
      const offAxis = !g.moving || g.dir < 0 ? 0 : D[g.dir][0] ? Math.abs(pa - cx) : Math.abs(pb - cy);
      if (offAxis <= c.corner && G.open([cx, cy], W)) { if (g.dir >= 0 && g.dir !== W) rt.emit('turned', { who: e.id, dir: NAMES[W] }); g.dir = W; g.moving = true; }
    }
  }
  b.vel = [0, 0, 0];
  if (g.moving && g.dir >= 0) {
    const d = laneSpeed(e, c, G) * rt.dt, v = G.dv(g.dir), horiz = v[0] !== 0, sg = horiz ? v[0] : v[1];
    // Cornering: ease the cross axis onto the lane centre while moving.
    if (horiz) pb += clamp(Math.round(pb) - pb, -d, d); else pa += clamp(Math.round(pa) - pa, -d, d);
    let a = horiz ? pa : pb;
    const ctr = sg > 0 ? Math.ceil(a - EPS) : Math.floor(a + EPS);
    const here = horiz ? [ctr, Math.round(pb)] : [Math.round(pa), ctr];
    if (Math.abs(ctr - a) <= d && !G.open(here, g.dir)) { a = ctr; g.moving = false; }
    else a += sg * d;
    if (horiz) pa = a; else pb = a;
    g.travel = round6((g.travel || 0) + d);
    const vel = [0, 0, 0]; vel[G.A] = v[0] * d / rt.dt; vel[G.B] = v[1] * d / rt.dt; b.vel = vel;
    setFacing(e, G.fr, vel);
  }
  let to = G.toWorld([round6(pa), round6(pb)]);
  if (c.wrap && !spaceWraps(api)) to = wrapAt(api, to, G);
  api.setPos(e, to, rt);
  b.state = g.moving ? 'grid' : 'idle';
  b.controller = 'move';
}

function wrapAt(api, at, G) {
  const bounds = typeof api.bounds === 'function' ? api.bounds() : Array.isArray(api.size) ? { min: [0, 0, 0], max: api.size } : null;
  if (!bounds) return at;
  const out = at.slice();
  for (const i of [G.A, G.B]) { const lo = bounds.min[i] ?? 0, hi = bounds.max[i]; if (hi == null) continue; const span = hi - lo; if (out[i] < lo - 0.5) out[i] += span; else if (out[i] >= hi - 0.5) out[i] -= span; }
  return out;
}

function stepCell(rt, e, api, c, G) {
  const g = state(e, 'grid'), b = bodyOf(e), ctl = controls(rt, e);
  g.face ??= 2;
  const running = Boolean(ctl?.down('run') || ctl?.down('sprint') || e.components.moveTo?.run);
  if (g.move) {
    g.move.t++;
    if (c.queue && ctl && !e.components.moveTo) { const q = wanted(rt, e, api, c, G, g.move.to); if (q >= 0 && ctl.pressed(NAMES[q])) g.queue = q; }
    if (g.move.t >= g.move.dur) {
      const m = g.move; g.move = null;
      rt.emit('stepped', { who: e.id, at: e.at, ledge: Boolean(m.ledge) });
      if (g.queue != null) { const q = g.queue; g.queue = null; tryStep(rt, e, api, c, G, g, q, running); }
      else { const held = wanted(rt, e, api, c, G, G.lanePos().map(Math.round)); if (held >= 0 && held === g.face) tryStep(rt, e, api, c, G, g, held, running); } // keep walking without a gap frame
    }
    publish(e, g, G);
    return;
  }
  const cell = G.lanePos().map(Math.round);
  const dir = wanted(rt, e, api, c, G, cell);
  if (dir < 0) { g.turnT = 0; b.vel = [0, 0, 0]; b.state = 'idle'; return; }
  if (c.turnFrames > 0 && ctl) {
    if (dir !== g.face && !g.turnT) { g.face = dir; g.turnT = c.turnFrames; faceTo(e, G, dir); rt.emit('turned', { who: e.id, dir: NAMES[dir] }); return; }
    if (g.turnT > 1) { g.turnT--; return; }
    g.turnT = 0;
  }
  tryStep(rt, e, api, c, G, g, dir, running);
  publish(e, g, G);
}

/** The entity in a cell that blocks a step: pickups (collectible) and bodies with blocking:false do not. */
function blocker(rt, api, at, self) {
  if (typeof api.occupant !== 'function') return null;
  const ids = typeof api.entitiesAt === 'function' ? api.entitiesAt(at) : [api.occupant(at)];
  return ids.find(id => { const o = id && id !== self && rt.entity(id); return o && !o.components.collectible && o.components.body?.blocking !== false; }) ?? null;
}
function faceTo(e, G, dir) { const v = G.dv(dir), d = [0, 0, 0]; d[G.A] = v[0]; d[G.B] = v[1]; setFacing(e, G.fr, d); }

function tryStep(rt, e, api, c, G, g, dir, running) {
  g.face = dir; faceTo(e, G, dir);
  const from = G.lanePos().map(Math.round), v = G.dv(dir), to = [from[0] + v[0], from[1] + v[1]];
  const tags = G.tagsAt(to), ledge = tags.find(t => t.startsWith('ledge:'));
  const bump = () => { if (rt.state.frame - (g.bumpAt ?? -99) > STEP.bumpFrames) { rt.emit('bump', { who: e.id, dir: NAMES[dir] }); g.bumpAt = rt.state.frame; } };
  if (ledge) {
    if (ledge !== `ledge:${NAMES[dir]}`) return bump();
    const land = [to[0] + v[0], to[1] + v[1]];
    if (!G.open(to, dir)) return bump();
    if (blocker(rt, api, G.toWorld(land), e.id)) return bump();
    if (typeof api.move === 'function') api.move(e, G.toWorld(land), rt, { force: true }); else api.setPos(e, G.toWorld(land), rt);
    g.move = { from, to: land, t: 0, dur: c.ledgeFrames, ledge: true };
    rt.emit('ledge_jump', { who: e.id, dir: NAMES[dir] });
    return;
  }
  if (!G.open(from, dir)) return bump();
  if (blocker(rt, api, G.toWorld(to), e.id)) return bump();
  const ok = typeof api.move === 'function' ? api.move(e, G.toWorld(to), rt) : (api.setPos(e, G.toWorld(to), rt), true);
  if (!ok) return bump();
  g.move = { from, to, t: 0, dur: running ? c.runFrames : c.walkFrames, run: running };
}

/** Renderers interpolate from move.from to move.to by t/dur; body.vel carries the step speed. */
function publish(e, g, G) {
  const b = bodyOf(e);
  if (!g.move) { b.vel = [0, 0, 0]; return; }
  const v = [g.move.to[0] - g.move.from[0], g.move.to[1] - g.move.from[1]], k = 60 / g.move.dur, vel = [0, 0, 0];
  vel[G.A] = round6(v[0] * k); vel[G.B] = round6(v[1] * k); b.vel = vel;
  g.frac = round6(g.move.t / g.move.dur);
  b.state = g.move.ledge ? 'air' : g.move.run ? 'run' : 'grid';
}
