// Lane runner movement (Subway Surfers, Temple Run), ported from the runner kit
// lanes mode: auto-run forward along a track, edge-triggered lane switches
// (0.15 s), a jump of 1.35 over 0.62 s (g = 8h/T², v0 = 4h/T), a 0.62 s slide,
// a dive from the air into a slide (drop 16), and a chaser. Hitting a low
// barrier (the `trip` effect, used by hazards) stumbles you, slowing you to
// 0.72× for 0.45 s and bringing the chaser for 7 s. A second trip while the
// chaser is near catches you. Switching into a blocked lane is also a stumble.
// Works on any continuous space: in 3D with gravity the jump goes through
// space.slide; without gravity the jump height is virtual (body.lift).
import {
  round6, mv, bodyOf, state, spaceApi, frameOf, claim, ownedBy, registerBase, isBaseFor, driven, ownerKey, controls, verbs,
  ensureShared, motor, settle, boxHits, canProbe, v3, setFacing, COMMON_PARAMS, MACRO_PARAMS,
} from './move-lib-core.js';

const ID = 'gameplay.move.lanes';
export const LANES = { switchTime: 0.15, jumpH: 1.35, air: 0.62, slide: 0.62, drop: 16, chase: 7, tripSec: 0.45, tripSlow: 0.72, jumpBuffer: 0.14, stand: 1.7, slideH: 0.6, bumpInvuln: 0.7, clearHeight: 2.7 };
const num = (min, max, d, unit, effect) => ({ type: 'number', min, max, default: d, unit, effect });
const AXIS = { x: 0, y: 1, z: 2 };

function envelope(config) {
  const g = (8 * config.jumpHeight) / (config.airTime ** 2);
  return { mode: 'lanes', run: config.maxSpeed || config.speed, jumpHeight: config.jumpHeight, jumpGap: round6((config.maxSpeed || config.speed) * config.airTime), lanes: config.lanes, gravity: round6(g) };
}

export default {
  id: ID,
  card: {
    intent: 'Endless-runner lanes: auto-run forward with a speed ramp, switch lanes, jump low barriers, slide under high ones, dive from the air into a slide, and stumble on trips with a chaser that catches you on a second stumble.',
    views: ['3p', 'td'],
    actionSpace: { move: { type: 'vector', min: -1, max: 1 } },
    params: {
      lanes: { type: 'integer', min: 2, max: 9, default: 3, effect: 'number of lanes' },
      laneWidth: num(0.2, 20, 1, 'units', 'distance between lane centres'),
      switchTime: num(0.02, 2, LANES.switchTime, 's', 'time to cross one lane'),
      jumpHeight: num(0.1, 20, LANES.jumpH, 'units', 'jump apex'),
      airTime: num(0.1, 4, LANES.air, 's', 'time in the air for a jump'),
      slideSec: num(0.05, 4, LANES.slide, 's', 'slide duration'),
      drop: num(0, 100, LANES.drop, 'units/s', 'downward speed of a dive from the air'),
      speed: num(0, 200, 10, 'units/s', 'starting forward speed'),
      maxSpeed: num(0, 400, 0, 'units/s', 'forward speed at the end of the ramp (0 = no ramp)'),
      rampSec: num(1, 3600, 60, 's', 'time to reach maxSpeed'),
      tripSec: num(0, 5, LANES.tripSec, 's', 'stumble duration'), tripSlow: num(0, 1, LANES.tripSlow, '', 'speed fraction while stumbling'),
      chaseSec: num(0, 60, LANES.chase, 's', 'how long the chaser stays close after a stumble'),
      forward: { type: 'string', options: ['auto', '+x', '-x', '+y', '-y', '+z', '-z'], default: 'auto', effect: 'run direction; auto: +z in 3D, +y in 2D' },
      blockers: { type: 'list', of: { type: 'string' }, default: [], effect: 'archetype ids that block a lane switch (trains, walls)' },
      onCaught: { type: 'effects', default: [], effect: 'effects when the chaser catches you (an `caught` event is always emitted)' },
      ...COMMON_PARAMS, npcs: { ...COMMON_PARAMS.npcs, default: false }, ...MACRO_PARAMS,
    },
    provides: { events: ['lane_switch', 'jumped', 'landed', 'slide', 'stumble', 'caught'], vars: ['move.speed', 'move.distance'], actions: ['left', 'right', 'jump', 'slide', 'crouch', 'move'] },
    requires: { capabilities: ['position'] },
    optional: { capabilities: ['gravity', 'overlap', 'editCells'] },
    envelope,
  },
  envelope,
  logic(logic) {
    logic.effect('trip', { run: (e, rt, c) => { const ent = rt.resolve(e.who, c); if (ent) trip(rt, ent); } });
    logic.predicate('lane', {
      check(p, path, errors) { if (!Number.isInteger(p.lane) && p.lane !== true) errors.push({ code: 'predicate_invalid', path, message: 'lane takes a lane index' }); },
      test(p, rt, c) { const e = rt.resolve(p.who, c), l = e?.components.move?.lanes?.lane; return l !== undefined && (p.lane === true || l === p.lane); },
    });
  },
  validate(config) {
    if (config.maxSpeed && config.maxSpeed < config.speed) return [{ code: 'lanes_speed_order', field: 'maxSpeed', message: 'maxSpeed is below the starting speed' }];
    return [];
  },
  install(rt, c, instance) {
    const owner = ownerKey(instance);
    registerBase(rt, owner, 'lanes', instance);
    ensureShared(rt, { speed: c.speed, ...c.macro, max: c.macro?.max ?? 0 });
    verbs(rt, ['left', 'right', 'jump', 'slide', 'crouch', 'move']);
    rt.caches.moveLanes = c;
    const g = (8 * c.jumpHeight) / (c.airTime ** 2), v0 = (4 * c.jumpHeight) / c.airTime, mid = (c.lanes - 1) / 2;
    rt.system('input', rt => { for (const e of driven(rt, c, instance)) if (isBaseFor(rt, e, owner, ID, 'lanes')) claim(rt, e, 'lanes', 0, owner); }, ID);
    rt.system('movement', rt => {
      for (const e of driven(rt, c, instance)) {
        if (!ownedBy(rt, e, owner)) continue;
        const api = spaceApi(rt, e); if (!api || !Array.isArray(e.at)) continue;
        const fr = frameOf(api, e), dims = e.at.length;
        const fwdSpec = c.forward === 'auto' ? (dims === 3 ? '+z' : '+y') : c.forward;
        const F = AXIS[fwdSpec[1]], fs = fwdSpec[0] === '-' ? -1 : 1;
        const L = dims === 3 ? (F === 0 ? 2 : 0) : (F === 0 ? 1 : 0);
        const U = fr.up !== null && fr.up !== F && fr.up !== L ? fr.up : null;
        const b = bodyOf(e), s = state(e, 'lanes'), ctl = controls(rt, e), dt = rt.dt, now = rt.state.time;
        if (s.origin == null) { s.lane = Math.round(mid); s.x = s.lane - mid; s.y = 0; s.vy = 0; s.air = false; s.slideT = 0; s.jumpQ = 0; s.chaseT = 0; s.tripT = 0; s.dist = 0; s.from = s.lane; s.origin = round6(e.at[L] - s.x * c.laneWidth); }
        // Edge-triggered lane switch; switching into a blocked lane stumbles.
        const press = ctl ? (ctl.pressed('left') ? -1 : 0) + (ctl.pressed('right') ? 1 : 0) || stickEdge(ctl, s) : npcSwitch(e, s, L, c, mid);
        if (press) {
          const to = s.lane + press;
          if (to >= 0 && to < c.lanes) {
            if (s.y < LANES.clearHeight && laneBlocked(rt, e, api, s, to, L, c, mid)) { if (now >= (s.invulnUntil ?? -1)) trip(rt, e); }
            else { s.from = s.lane; s.lane = to; rt.emit('lane_switch', { who: e.id, lane: to, dir: press }); }
          }
        }
        const up = Boolean(ctl?.pressed('jump') || ctl?.pressed('up')), down = Boolean(ctl?.pressed('slide') || ctl?.pressed('crouch') || ctl?.pressed('down'));
        if (up) s.jumpQ = LANES.jumpBuffer;
        if (down) {
          if (s.air) { s.vy = -c.drop; s.slideQ = true; }
          else { s.slideT = c.slideSec; s.jumpQ = 0; rt.emit('slide', { who: e.id }); }
        }
        if (s.jumpQ > 0 && !s.air) { s.slideT = 0; s.air = true; s.jumpQ = 0; s.vy = v0; rt.emit('jumped', { who: e.id }); }
        s.jumpQ = Math.max(0, round6(s.jumpQ - dt));
        // Lateral approach to the lane centre.
        const tx = s.lane - mid, dx = tx - s.x, maxStep = dt / c.switchTime;
        s.x = round6(s.x + (Math.abs(dx) <= maxStep ? dx : Math.sign(dx) * maxStep));
        // Vertical: kit ballistic arc.
        let dy = 0;
        if (s.air || s.y > 0) {
          s.vy -= g * dt; const ny = s.y + s.vy * dt;
          dy = ny - s.y; s.y = ny;
          if (s.y <= 0) { dy -= s.y; s.y = 0; s.air = false; s.vy = 0; rt.emit('landed', { who: e.id, speed: 0, height: 0 }); if (s.slideQ) { s.slideQ = false; s.slideT = c.slideSec; rt.emit('slide', { who: e.id }); } }
        }
        if (s.slideT > 0) s.slideT = Math.max(0, round6(s.slideT - dt));
        if (s.chaseT > 0) s.chaseT = Math.max(0, round6(s.chaseT - dt));
        if (s.tripT > 0) s.tripT = Math.max(0, round6(s.tripT - dt));
        // Forward with the speed ramp.
        const base = c.maxSpeed > 0 ? c.speed + (c.maxSpeed - c.speed) * Math.min(1, now / c.rampSec) : c.speed;
        const v = base * (s.tripT > 0 ? c.tripSlow : 1);
        const delta = [0, 0, 0];
        delta[F] = fs * v * dt;
        delta[L] = s.origin + s.x * c.laneWidth - e.at[L];
        if (U !== null) delta[U] = dy * fr.upSign;
        const before = e.at[F];
        const r = motor(rt, e, api, delta.slice(0, Math.max(dims, 2)));
        if (r.blocked[F]) rt.emit('crashed', { who: e.id });
        s.dist = round6(s.dist + Math.abs(e.at[F] - before));
        b.vel = [0, 0, 0]; b.vel[F] = round6(fs * v); if (U !== null) b.vel[U] = round6(s.vy * fr.upSign);
        b.lift = U === null ? round6(s.y) : 0;
        b.height = s.slideT > 0 ? LANES.slideH : LANES.stand;
        b.grounded = !s.air; b.state = s.slideT > 0 ? 'slide' : s.air ? 'air' : s.tripT > 0 ? 'stumble' : 'lanes';
        b.iframes = now < (s.invulnUntil ?? -1);
        const dir = [0, 0, 0]; dir[F] = fs; setFacing(e, fr, dir);
        if (e.id === 'player') { rt.state.vars['move.speed'] = round6(v); rt.state.vars['move.distance'] = s.dist; }
        settle(e, fr);
      }
    }, ID);
    rt.options(rt => {
      const p = rt.player(); if (!p || mv(p).owner !== owner) return [];
      return [['lane left', { left: true }], ['lane right', { right: true }], ['jump', { jump: true }], ['slide', { slide: true }], ['run on', {}]].map(([label, actions]) => ({ label, actions, steps: label === 'run on' ? 12 : 1 }));
    });
  },
};

/** A stick pushed past 0.5 counts as one lane press until it returns to centre. */
function stickEdge(ctl, s) {
  const x = ctl.move[0], cur = Math.abs(x) > 0.5 ? Math.sign(x) : 0;
  const was = s.stick || 0; s.stick = cur;
  return cur !== 0 && cur !== was ? cur : 0;
}
/** NPC runners steer to the lane nearest their steer direction or moveTo target. */
function npcSwitch(e, s, L, c, mid) {
  const target = e.components.moveTo?.at?.[L] ?? (e.components.steer ? e.at[L] + (e.components.steer.dir?.[L] ?? 0) * c.laneWidth : null);
  if (target == null) return 0;
  const want = Math.max(0, Math.min(c.lanes - 1, Math.round((target - s.origin) / c.laneWidth + mid)));
  return want === s.lane ? 0 : Math.sign(want - s.lane);
}

function laneBlocked(rt, e, api, s, lane, L, c, mid) {
  const at = v3(e.at); at[L] = s.origin + (lane - mid) * c.laneWidth;
  const probeAt = at.slice(0, e.at.length);
  if (canProbe(api) && boxHits(rt, api, e, probeAt)) return true;
  if (c.blockers.length && typeof api.overlap === 'function') {
    const size = e.components.body?.size || [0.64, 1.7, 0.64];
    const ids = api.overlap({ kind: 'aabb', at: probeAt, size }, o => o.id !== e.id && c.blockers.includes(o.archetype));
    if (ids.length) return true;
  }
  return false;
}

/** Stumble: slow down and bring the chaser; a stumble while it is still close catches you. */
export function trip(rt, e) {
  const s = mv(e).lanes; if (!s) return;
  const c = rt.caches.moveLanes || { chaseSec: LANES.chase, tripSec: LANES.tripSec, onCaught: [] };
  const now = rt.state.time;
  if (now < (s.invulnUntil ?? -1)) return;
  s.invulnUntil = round6(now + LANES.bumpInvuln);
  if (s.chaseT > 0) { rt.emit('caught', { who: e.id }); if (c.onCaught?.length) rt.run(c.onCaught, { self: e.id }); return; }
  s.chaseT = c.chaseSec; s.tripT = c.tripSec;
  rt.emit('stumble', { who: e.id });
}
