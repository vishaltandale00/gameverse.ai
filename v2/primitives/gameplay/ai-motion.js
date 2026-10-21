// gameplay.ai.motion: scripted motion programs for kinematic movers (shmup
// enemies, hazards, platforms, critters). An entity's `motion` component is a
// program: a sequence of steps, each one of fifteen behaviors ported from the
// shmup kit (v2/kits/shmup/game.js actStep/diveStep/snakeStep/gravityStep):
//   straight sine zigzag dive hover turret orbit chase wander split snake
//   gravity saucer rock path
// Steps advance after `sec` seconds or when `until` holds, and may loop. All
// motion runs in a 2D plane of the space (xy or xz) with arena or scroller
// variants, then bounds apply (bounce, wrap, exit). Timing is in frames as in
// the kit; speeds are space units per second.
import { v3, add, sub, mul, len, norm, dot, r6, round6, clamp, wrapAng, steerAng, spaceOf, can, continuous, moverOwned, dead, between, selfRelative, cleanupOnDespawn, TAU } from './ai-lib.js';

import { checkParam } from '../../kernel/params.js';
import { DECLARATIONS_ENFORCED } from '../../kernel/document.js';

const ID = 'gameplay.ai.motion';
export const MOTIONS = ['straight', 'sine', 'zigzag', 'dive', 'hover', 'turret', 'orbit', 'chase', 'wander', 'split', 'snake', 'gravity', 'saucer', 'rock', 'path'];
const n = (extra = {}) => ({ type: 'number', ...extra });
const STEP = {
  kind: { type: 'string', options: MOTIONS, required: true }, sec: n({ min: 0 }), until: { type: 'predicate' },
  speed: n({ min: 0 }), ang: n({ effect: 'initial heading, degrees in the plane' }), amp: n({ min: 0 }), period: n({ min: 1, unit: 'frames' }),
  turn: n({ unit: 'rad/s' }), turnFrames: { type: 'integer', min: 0 }, turnAt: { type: 'integer', min: 0 }, turnRate: n({ min: 0, unit: 'rad/s' }), limit: { type: 'integer', min: 0, unit: 'frames' },
  hoverAt: n({ effect: 'distance along `down` from the bounds edge where hovering starts' }), stay: { type: 'boolean' }, radius: n({ min: 0 }),
  pts: { type: 'list', of: { type: 'list', of: { type: 'number' }, min: 2 }, min: 2 }, relative: { type: 'boolean' },
  segments: { type: 'integer', min: 0, max: 64 }, spacing: n({ min: 0 }),
  pull: n({ min: 0 }), reach: n({ min: 0 }), swallow: { type: 'boolean' }, burstInto: { type: 'ref', to: 'archetype' }, burstAfter: { type: 'integer', min: 1 },
  spin: n(), vel: { type: 'list', of: { type: 'number' } },
};
// A component is either a program of steps or one step written inline ({kind:'sine', amp: 30}).
export const MOTION_COMPONENT = {
  ...STEP, kind: { type: 'string', options: MOTIONS },
  program: { type: 'list', of: { type: 'object', fields: STEP }, min: 1 },
  loop: { type: 'boolean' }, target: { type: 'string', effect: "entity the motion reacts to (default 'player')" },
};
/**
 * Rule examples' fields left unset (null): every field of the strict form (predicates and nested point lists are not
 * asked there). @param {Record<string, unknown>} fields @param {string[]} unasked
 */
const unset = (fields, unasked) => Object.fromEntries(Object.keys(fields).filter(k => !unasked.includes(k)).map(k => [k, null]));
/** The archetype component this primitive owns. */
const MOTION = { type: 'object', fields: MOTION_COMPONENT, effect: 'a motion program (program: steps) or one step written inline (kind and its fields)' };

const st = rt => rt.store(ID);

export default {
  id: ID,
  card: {
    loop: { verbs: [], progress: ['motion_step', 'motion_done', 'swallow'] },
    // It moves every entity with a `motion` component through its motion program.
    drives: { control: 'ai', components: ['motion'], movement: true, events: ['motion_step', 'swallow'] },
    components: { motion: MOTION },
    intent: 'Kinematic motion programs for movers (`motion` component): sequences of straight, sine, zigzag, dive, hover, turret, orbit, chase-steer, wander, split, snake, gravity-well, saucer, rock and spline-path steps, with arena/scroller variants and bounce/wrap/exit bounds. Ported from the shmup kit.',
    views: ['side', 'td', 'any'],
    params: {
      plane: { type: 'string', default: 'xy', options: ['xy', 'xz'], effect: 'the 2D plane motion runs in' },
      down: { type: 'list', of: { type: 'number' }, default: [0, 1], min: 2, max: 2, effect: 'plane vector of "down the screen" (scrollers advance this way)' },
      arena: { type: 'boolean', default: false, effect: 'arena variants (twin-stick/asteroids) instead of scroller variants' },
      bounds: { type: 'object', fields: { min: { type: 'list', of: { type: 'number' }, min: 2, required: true }, max: { type: 'list', of: { type: 'number' }, min: 2, required: true } }, effect: 'plane rectangle used by hover, bounce, wrap and exit' },
      edges: { type: 'string', default: 'none', options: ['none', 'bounce', 'wrap', 'exit'], effect: 'what happens at the bounds' },
      scroll: n({ default: 40, min: 0, effect: 'scroll speed carried by turrets in scroller mode (units/s)' }),
      speed: n({ default: 60, min: 0, effect: 'default mover speed (units/s)' }),
      exitAfter: { type: 'integer', default: 420, min: 1, effect: 'frames before a mover that never came on screen is removed (edges: exit)' },
    },
    provides: { events: ['motion_step', 'motion_exit', 'motion_done', 'swallow', 'burst'] },
    requires: { capabilities: ['position'] },
    reads: ['content.archetypes'],
    rules: {
      motion_bounds_missing: { fields: ['edges', 'bounds'], message: 'edges bounce, wrap and exit act at the bounds: set bounds with them', example: { doc: { systems: [{ use: ID, with: { edges: 'wrap' } }] } } },
      motion_program_missing: { fields: ['content.archetypes[].components.motion.program', 'content.archetypes[].components.motion.kind'], message: 'a motion component has a program or an inline step kind', example: { 'components.motion': unset(MOTION_COMPONENT, ['until']) } },
      motion_path_points: { fields: ['content.archetypes[].components.motion.program[].pts'], message: 'a path step has pts (its spline points)', example: { 'components.motion': { ...unset(MOTION_COMPONENT, ['until']), program: [{ ...unset(STEP, ['until', 'pts', 'vel']), kind: 'path' }] } } },
    },
  },
  validate(config, doc, ctx) {
    const errors = [];
    if (['bounce', 'wrap', 'exit'].includes(config.edges) && !config.bounds) errors.push({ code: 'motion_bounds_missing', path: 'edges', message: `edges '${config.edges}' needs bounds` });
    (doc.content?.archetypes || []).forEach((a, i) => {
      const m = a?.components?.motion; if (m === undefined) return;
      const path = `content.archetypes[${i}].components.motion`;
      // The declared component shape, checked as errors here only until preflight enforces declared shapes itself
      // (kernel/document.js DECLARATIONS_ENFORCED): delete this re-check with the flag.
      if (!DECLARATIONS_ENFORCED) checkParam(MOTION, m, path, errors, ctx);
      if (!m || typeof m !== 'object' || Array.isArray(m)) return;
      if (!m.program && !m.kind) errors.push({ code: 'motion_program_missing', path, message: 'motion needs a program or a kind' });
      (Array.isArray(m.program) ? m.program : []).forEach((s, j) => { if (s?.kind === 'path' && !s.pts) errors.push({ code: 'motion_path_points', path: `${path}.program[${j}].pts`, message: 'a path step needs pts' }); });
    });
    return errors;
  },
  install(rt, config) {
    cleanupOnDespawn(rt, [ID]);
    const P = planeOf(config);
    rt.system('movement', rt => {
      for (const e of Object.values(rt.state.entities)) {
        const m = e.components.motion; if (!m || !continuous(e) || dead(e)) continue;
        const api = spaceOf(rt, e); if (!api) continue;
        step(rt, e, m, api, config, P);
      }
    }, ID);
    rt.provide('motion', { state: id => st(rt).agents?.[id] ?? null, segments: id => st(rt).agents?.[id]?.segs ?? null });
  },
};

// ---------- plane helpers ----------
function planeOf(config) {
  const [ax, bx] = config.plane === 'xz' ? [[1, 0, 0], [0, 0, 1]] : [[1, 0, 0], [0, 1, 0]];
  return { ax, bx, DOWN: Math.atan2(config.down[1], config.down[0]), down: norm([config.down[0], config.down[1], 0]) };
}
const to2 = (P, at) => [dot(at, P.ax), dot(at, P.bx)];
const to3 = (P, base, xy) => { const off = sub(v3(base), add(mul(P.ax, dot(base, P.ax)), mul(P.bx, dot(base, P.bx)))); return r6(add(off, add(mul(P.ax, xy[0]), mul(P.bx, xy[1])))); };
/** Plane coordinate along "down" (screen y for the default down [0,1]). */
const along = (P, xy) => xy[0] * Math.cos(P.DOWN) + xy[1] * Math.sin(P.DOWN);
/** Where the bounds begin along `down` (the top of the screen): the least `along` over the four corners, for any down vector. */
const topOf = (P, B) => Math.min(...[[B.min[0], B.min[1]], [B.max[0], B.min[1]], [B.min[0], B.max[1]], [B.max[0], B.max[1]]].map(c => along(P, c)));

/** Catmull-Rom path follower (kit followPath): advances P.{i,u} by speed·dt, returns [x,y, done]. */
export function followPath(path, speed, dt) {
  const pts = path.pts; let move = speed * dt;
  while (move > 0 && path.i < pts.length - 1) {
    const a = pts[path.i], b = pts[path.i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, du = move / l;
    if (path.u + du >= 1) { move -= (1 - path.u) * l; path.u = 0; path.i++; } else { path.u = round6(path.u + du); move = 0; }
  }
  if (path.i >= pts.length - 1) { const l = pts[pts.length - 1]; return [l[0], l[1], true]; }
  const i = path.i, p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)], u = path.u, u2 = u * u, u3 = u2 * u;
  const cr = k => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * u + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * u3);
  return [round6(cr(0)), round6(cr(1)), false];
}

// ---------- the program runner ----------
const inline = new WeakMap();
function programOf(m) {
  if (m.program) return m.program;
  if (!inline.has(m)) inline.set(m, [{ ...m, kind: m.kind || 'straight' }]);
  return inline.get(m);
}

function step(rt, e, m, api, config, P) {
  const s = ((st(rt).agents ??= {})[e.id] ??= null) || initAgent(rt, e, m, config, P);
  const prog = programOf(m);
  let cur = prog[s.i];
  if (!cur) return;
  // Advance the program on time or predicate.
  const elapsed = s.t / 60;
  if ((cur.sec !== undefined && elapsed >= cur.sec - 1e-9) || (cur.until && rt.test(selfRelative(cur.until), { self: e.id })) || s.done) {
    if (s.i + 1 < prog.length || m.loop) {
      s.i = (s.i + 1) % prog.length; s.t = 0; s.sub = 0; s.subT = 0; s.done = false; cur = prog[s.i];
      const xy = to2(P, e.at); s.bx = xy[0]; s.by = xy[1];
      if (cur.ang !== undefined) s.ang = round6(cur.ang * Math.PI / 180);
      if (cur.kind === 'path') s.path = { pts: pathPts(cur, xy), i: 0, u: 0 };
      rt.emit('motion_step', { who: e.id, step: s.i, kind: cur.kind });
    } else if (!s.finished && (cur.sec !== undefined || s.done)) { s.finished = true; rt.emit('motion_done', { who: e.id }); }
  }
  s.t++; s.T++;
  const speed = cur.speed ?? m.speed ?? config.speed;
  const before = to2(P, e.at), pos = before.slice();
  const t = rt.resolve(m.target ?? 'player', { self: e.id }), tgt = t && t.space === e.space && !dead(t) && continuous(t) ? to2(P, t.at) : null;
  const B = config.bounds, W = B ? B.max[0] - B.min[0] : 0, H = B ? B.max[1] - B.min[1] : 0;
  const center = B ? [(B.min[0] + B.max[0]) / 2, (B.min[1] + B.max[1]) / 2] : before;
  const tx = tgt ? tgt[0] : center[0], ty = tgt ? tgt[1] : center[1];
  const arena = config.arena, dt = rt.dt;
  if (cur.turnFrames > 0 && s.t >= (cur.turnAt ?? 0) && s.turnLeft > 0) { s.ang = round6(s.ang + cur.turn * dt); s.turnLeft--; }
  const fwd = sp => { pos[0] += Math.cos(s.ang) * sp * dt; pos[1] += Math.sin(s.ang) * sp * dt; };
  const lateral = lat => { s.bx += Math.cos(s.ang) * speed * dt; s.by += Math.sin(s.ang) * speed * dt; pos[0] = s.bx - Math.sin(s.ang) * lat; pos[1] = s.by + Math.cos(s.ang) * lat; };
  const k = s.t;
  switch (cur.kind) {
    case 'straight': fwd(speed); break;
    case 'sine': if (arena) { s.ang += Math.sin(k * 0.08) * 0.05; fwd(speed); } else lateral(Math.sin(k * (TAU / (cur.period ?? 90))) * (cur.amp ?? 34)); break;
    case 'zigzag': if (arena) { s.ang += (Math.floor(k / 30) % 2 ? 1 : -1) * 0.04; fwd(speed); } else { const per = cur.period ?? 100, ph = (k / (per / 2)) % 2; lateral(((ph < 1 ? ph : 2 - ph) * 2 - 1) * (cur.amp ?? 40)); } break;
    case 'dive':
      if (s.sub === 0) { fwd(speed); if ((s.onScreen || !B) && k > (arena ? 50 : 40)) { s.sub = 1; s.subT = 0; } }
      else if (s.sub === 1) { s.subT++; fwd(speed * Math.max(0, 1 - s.subT / 14)); if (s.subT > 20) { s.sub = 2; s.subT = 0; s.ang = Math.atan2(ty - pos[1], tx - pos[0]); } }
      else { s.subT++; fwd(speed * 1.9); if (arena && s.subT > 70) { s.sub = 1; s.subT = 0; } }
      break;
    case 'hover':
      if (arena) {
        if (s.sub === 0) { const d = Math.hypot(s.tx - pos[0], s.ty - pos[1]); if (d < 6 || s.subT++ > 240) { s.sub = 1; s.subT = 0; } else { pos[0] += (s.tx - pos[0]) / d * speed * dt; pos[1] += (s.ty - pos[1]) / d * speed * dt; } }
        else if (++s.subT > 90) { s.sub = 0; s.subT = 0; [s.tx, s.ty] = randIn(rt, B, center); }
      } else if (s.sub === 0) { fwd(speed); const line = (B ? topOf(P, B) : along(P, s.start)) + (cur.hoverAt ?? 100); if (along(P, pos) >= line && (s.onScreen || !B)) { s.sub = 1; s.subT = 0; s.bx = pos[0]; s.by = pos[1]; } }
      else if (s.sub === 1) {
        s.subT++;
        const side = [-Math.sin(P.DOWN), Math.cos(P.DOWN)], dn = [Math.cos(P.DOWN), Math.sin(P.DOWN)];
        const sweep = cur.stay && B ? Math.sin(s.subT * 0.012) * W * 0.3 : Math.sin(s.subT * 0.03) * 10, bob = Math.sin(s.subT * 0.05) * 4;
        pos[0] = s.bx + side[0] * sweep + dn[0] * bob; pos[1] = s.by + side[1] * sweep + dn[1] * bob;
        if (cur.stay && B) { pos[0] = clamp(pos[0], B.min[0] + 16, B.max[0] - 16); }
        if (s.subT > 260 && !cur.stay) { s.sub = 2; s.ang = P.DOWN + Math.PI + (along(P, [pos[1], -pos[0]]) < 0 ? -0.4 : 0.4); }
      } else fwd(speed * 0.9);
      break;
    case 'turret': if (!arena) { pos[0] += Math.cos(P.DOWN) * config.scroll * dt; pos[1] += Math.sin(P.DOWN) * config.scroll * dt; } break;
    case 'orbit':
      if (arena) { s.spin += 1.4 * dt; const R = Math.max(cur.radius ? cur.radius * 0.47 : 70, (cur.radius ?? 150) - k * 0.2); const ox = tx + Math.cos(s.spin) * R, oy = ty + Math.sin(s.spin) * R; const d = Math.hypot(ox - pos[0], oy - pos[1]) || 1, v = Math.min(d, speed * dt * 1.3); pos[0] += (ox - pos[0]) / d * v; pos[1] += (oy - pos[1]) / d * v; }
      else { s.spin += 2 * dt; s.bx += Math.cos(s.ang) * speed * 0.45 * dt; s.by += Math.sin(s.ang) * speed * 0.45 * dt; const R = cur.radius ?? 36; pos[0] = s.bx + Math.cos(s.spin) * R; pos[1] = s.by + Math.sin(s.spin) * R; }
      break;
    case 'chase': {
      const limit = cur.limit ?? (arena ? Infinity : 240);
      if (k < limit && tgt && (arena || s.onScreen || !B)) s.ang = steerAng(s.ang, Math.atan2(ty - pos[1], tx - pos[0]), (cur.turnRate ?? (arena ? 3 : 1.6)) * dt);
      fwd(speed); break;
    }
    case 'wander': case 'split':
      if (--s.subT <= 0) { s.subT = 40 + Math.floor(rt.random() * 60); s.tx = arena ? rt.random() * TAU : P.DOWN + between(rt, -0.9, 0.9); }
      s.ang = steerAng(s.ang, s.tx, 1.5 * dt); s.spin += (cur.kind === 'split' ? 4 : 1.5) * dt; fwd(speed); break;
    case 'snake':
      if (tgt) s.ang = steerAng(s.ang, Math.atan2(ty - pos[1], tx - pos[0]), (cur.turnRate ?? 1.5) * dt);
      s.ang += Math.sin(k * 0.12) * 0.045; fwd(speed); break;
    case 'gravity': s.spin += 2.5 * dt; fwd(arena ? speed : Math.max(18, speed)); if (!arena) s.ang = steerAng(s.ang, P.DOWN, dt); break;
    case 'saucer': {
      if (--s.subT <= 0) { s.subT = 50 + Math.floor(rt.random() * 40); s.sub = Math.floor(rt.random() * 3) - 1; }
      const side = [-Math.sin(P.DOWN), Math.cos(P.DOWN)], dn = [Math.cos(P.DOWN), Math.sin(P.DOWN)];
      pos[0] += Math.cos(s.ang) * speed * dt + dn[0] * s.sub * speed * 0.5 * dt; pos[1] += Math.sin(s.ang) * speed * dt + dn[1] * s.sub * speed * 0.5 * dt;
      if (B && !arena) { const a0 = topOf(P, B) + 20, a1 = topOf(P, B) + (Math.abs(W * Math.cos(P.DOWN)) + Math.abs(H * Math.sin(P.DOWN))) * 0.7, a = along(P, pos); if (a < a0 || a > a1) { const fix = clamp(a, a0, a1) - a; pos[0] += dn[0] * fix; pos[1] += dn[1] * fix; } }
      break;
    }
    case 'rock': { const v = cur.vel || [Math.cos(s.ang) * speed, Math.sin(s.ang) * speed]; pos[0] += v[0] * dt; pos[1] += v[1] * dt; s.spin += (cur.spin ?? 0) * dt; break; }
    case 'path': { s.path ??= { pts: pathPts(cur, s.start), i: 0, u: 0 }; const [x, y, done] = followPath(s.path, speed, dt); pos[0] = x; pos[1] = y; if (done) s.done = true; break; }
  }
  s.ang = round6(wrapAng(s.ang)); s.spin = round6(s.spin % TAU);
  if (cur.kind === 'gravity') gravityWell(rt, e, s, cur, P, arena, config);
  // Bounds.
  if (B) {
    if (!s.onScreen && pos[0] > B.min[0] && pos[0] < B.max[0] && pos[1] > B.min[1] && pos[1] < B.max[1]) s.onScreen = true;
    if (config.edges === 'bounce') {
      for (const i of [0, 1]) if (pos[i] < B.min[i]) { pos[i] = B.min[i]; s.ang = i === 0 ? Math.PI - s.ang : -s.ang; if (i === 0) s.bx = pos[0]; else s.by = pos[1]; } else if (pos[i] > B.max[i]) { pos[i] = B.max[i]; s.ang = i === 0 ? Math.PI - s.ang : -s.ang; if (i === 0) s.bx = pos[0]; else s.by = pos[1]; }
      if (cur.kind === 'wander' || cur.kind === 'split') s.tx = s.ang;
    } else if (config.edges === 'wrap' && cur.kind !== 'saucer') {
      const wrapC = (v, lo, hi) => (v < lo - 30 ? v + (hi - lo) + 60 : v > hi + 30 ? v - (hi - lo) - 60 : v);
      pos[0] = wrapC(pos[0], B.min[0], B.max[0]); pos[1] = wrapC(pos[1], B.min[1], B.max[1]); s.bx = pos[0]; s.by = pos[1];
    } else if (config.edges === 'exit') {
      const out = pos[0] < B.min[0] - 40 || pos[0] > B.max[0] + 40 || pos[1] < B.min[1] - 60 || pos[1] > B.max[1] + 40;
      if ((s.onScreen && out) || (!s.onScreen && s.T > config.exitAfter)) { rt.emit('motion_exit', { who: e.id }); rt.despawn(e.id); return; }
    }
  }
  s.ang = round6(s.ang);
  if (cur.segments || cur.kind === 'snake') snakeTrail(s, pos, cur);
  const delta = [pos[0] - before[0], pos[1] - before[1]];
  if (moverOwned(e)) { const d3 = add(mul(P.ax, delta[0]), mul(P.bx, delta[1])); e.components.steer = { dir: r6(norm(d3)), speed: round6(len(d3) / dt), fly: true, by: 'ai' }; return; }
  if (Math.abs(delta[0]) + Math.abs(delta[1]) > 0) api.setPos(e, to3(P, e.at, [round6(pos[0]), round6(pos[1])]), rt);
}

function initAgent(rt, e, m, config, P) {
  const xy = to2(P, e.at), first = programOf(m)[0];
  const ang = (first.ang ?? m.ang) !== undefined ? (first.ang ?? m.ang) * Math.PI / 180 : P.DOWN;
  const s = { i: 0, t: 0, T: 0, ang: round6(ang), sub: 0, subT: 0, bx: xy[0], by: xy[1], start: xy, spin: round6(rt.random() * TAU), onScreen: false, eaten: 0, turnLeft: first.turnFrames ?? 0 };
  [s.tx, s.ty] = config.arena && config.bounds ? randIn(rt, config.bounds, xy) : xy;
  if (first.kind === 'path') s.path = { pts: pathPts(first, xy), i: 0, u: 0 };
  st(rt).agents[e.id] = s;
  return s;
}
const pathPts = (step, origin) => (step.relative ? step.pts.map(p => [origin[0] + p[0], origin[1] + p[1]]) : step.pts.map(p => [p[0], p[1]]));
function randIn(rt, B, fallback) { if (!B) return fallback; return [round6(between(rt, B.min[0] + 40, B.max[0] - 40)), round6(between(rt, B.min[1] + 40, B.max[1] - 40))]; }

function snakeTrail(s, pos, cur) {
  const n = cur.segments ?? 10, gap = cur.spacing ?? 9;
  if (!s.segs) { s.segs = []; for (let k = 0; k < n; k++) s.segs.push(pos[0], pos[1]); }
  let px = pos[0], py = pos[1];
  for (let k = 0; k < s.segs.length; k += 2) {
    const dx = s.segs[k] - px, dy = s.segs[k + 1] - py, d = Math.hypot(dx, dy);
    if (d > gap) { s.segs[k] = round6(px + dx / d * gap); s.segs[k + 1] = round6(py + dy / d * gap); }
    px = s.segs[k]; py = s.segs[k + 1];
  }
}

/** Black hole: pulls the player and hostile shots; in arenas swallows movers and bursts. */
function gravityWell(rt, e, s, cur, P, arena, config) {
  const api = spaceOf(rt, e), R = cur.reach ?? 150, here = to2(P, e.at), p = rt.player();
  if (p && p.space === e.space && !dead(p)) {
    const q = to2(P, p.at), dx = here[0] - q[0], dy = here[1] - q[1], d = Math.hypot(dx, dy);
    if (d < R && d > 1) { const pull = (cur.pull ?? 80) * (1 - d / R) + 12, step = add(mul(P.ax, dx / d * pull * rt.dt), mul(P.bx, dy / d * pull * rt.dt)); if (can(api, 'slide')) api.slide(p, r6(step), rt); else api.setPos(p, r6(add(p.at, step)), rt); }
  }
  for (const b of Object.values(rt.state.entities)) {
    const sh = b.components.aiShot || b.components.projectile; if (!sh || b.space !== e.space || !Array.isArray(sh.vel)) continue;
    const q = to2(P, b.at), dx = here[0] - q[0], dy = here[1] - q[1], d2 = dx * dx + dy * dy;
    if (d2 < R * R && d2 > 1) { const d = Math.sqrt(d2), k = 1100 * (1 - d / R) * rt.dt; sh.vel = r6(add(sh.vel, add(mul(P.ax, dx / d * k), mul(P.bx, dy / d * k)))); }
  }
  if (!arena || cur.swallow === false) return;
  for (const o of Object.values(rt.state.entities)) {
    if (o === e || !o.components.motion || o.space !== e.space || dead(o)) continue;
    const os = st(rt).agents?.[o.id]; if (!os?.onScreen) continue;
    const ok = programOf(o.components.motion)[os.i]?.kind; if (ok === 'gravity' || ok === 'rock') continue;
    const q = to2(P, o.at), r = (cur.radius ?? 15) + (s.eaten * 1.2);
    if ((q[0] - here[0]) ** 2 + (q[1] - here[1]) ** 2 < (r + 4) ** 2) {
      rt.despawn(o.id); s.eaten++;
      rt.emit('swallow', { who: e.id, ate: o.id, eaten: s.eaten });
      if (s.eaten >= (cur.burstAfter ?? 6)) {
        rt.emit('burst', { who: e.id });
        if (cur.burstInto) for (let k = 0; k < 4; k++) { const a = k / 4 * TAU; rt.spawn(cur.burstInto, { space: e.space, at: to3(P, e.at, [here[0] + Math.cos(a) * 14, here[1] + Math.sin(a) * 14]), components: { motion: { program: [{ kind: 'chase' }], speed: 115, ang: a * 180 / Math.PI } } }); }
        rt.despawn(e.id);
        return;
      }
    }
  }
}
