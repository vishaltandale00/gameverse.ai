// Ground locomotion for any entity in any space: walk/run/sprint/crouch/jump
// with acceleration, air control, coyote time, jump buffering and feel
// presets. On continuous spaces it integrates gravity from space.gravityAt and
// moves through space.slide (or the engine.physics.character service). On
// discrete spaces (grid cells, graph zones) it steps with navigate.move.
// Without gravity (top-down) a jump is a virtual hop: body.lift rises and falls
// and the body counts as airborne.
import {
  clamp, len, norm, round6, mv, bodyOf, state, spaceApi, dimsOf, isContinuous, frameOf, intent, motor, claim, ownedBy,
  registerBase, isBaseFor, driven, ownerKey, pool, canSpend, setFacing, settle, trackAir, verbs, ensureShared, withPreset,
  discreteNext, planeVector, controls, COMMON_PARAMS, RETIRED_PARAMS, travelAlong, MOVE_COMPONENTS,
} from './move-lib-core.js';
import { compare } from '../../kernel/logic.js';

const COMPARATORS = ['gte', 'lte', 'gt', 'lt', 'eq', 'ne'];

export const WALK_PRESETS = {
  arcade: { accel: 40, decel: 50, airControl: 0.5, coyoteMs: 100, bufferMs: 120, gravityScale: 1, fallMultiplier: 1.4 },
  realistic: { accel: 14, decel: 12, airControl: 0.15, coyoteMs: 40, bufferMs: 60, gravityScale: 1, fallMultiplier: 1 },
  floaty: { accel: 24, decel: 6, airControl: 0.8, coyoteMs: 160, bufferMs: 150, gravityScale: 0.55, fallMultiplier: 0.8 },
};
const ID = 'gameplay.move.walk';

export function walkConfig(config) { return withPreset(config, WALK_PRESETS, WALK_PRESETS.arcade); }

function envelope(config, abilities = new Set(), ctx = {}) {
  const c = walkConfig(config), g = (ctx.gravity ?? 9.8) * c.gravityScale;
  const top = Math.max(c.run, c.sprintCost >= 0 ? c.sprint : c.run);
  const air = c.jump > 0 && g > 0 ? (2 * c.jump) / g : 0;
  return { mode: 'continuous', run: top, jumpHeight: g > 0 ? round6((c.jump * c.jump) / (2 * g)) : 0, jumpGap: round6(top * air), climb: false, swim: false, fly: false };
}

export default {
  id: ID,
  card: {
    // Running is the pace the move axis gives (walk slows it, sprint speeds it): there is no run press to declare.
    loop: { verbs: ['move', 'jump', 'sprint', 'crouch', 'walk'], progress: ['jumped', 'travelled', 'arrived'] },
    locomotion: 'base', medium: 'ground', // base: moves the player on its own; modifier: adds a move on top of base locomotion
    // The body this controller is tuned for, [width, height, depth] in space units (a side view reads [w, h], a top-down
    // one [w, d]): traversal conformance proves generated worlds for a player of this size (v2-p-generate2d-traversal).
    body: { size: [0.6, 1.8, 0.6] },
    intent: 'Ground locomotion for the player and NPCs: walk, run, sprint (drains a stamina pool), crouch and jump, with acceleration, air control, coyote time, jump buffer and feel presets. Works in 3D, side and top-down continuous spaces and steps cell by cell on grid or graph spaces.',
    views: ['1p', '3p', 'td', 'iso', 'side'],
    actionSpace: { move: { type: 'vector', min: -1, max: 1, kind: 'continuous' }, look: { type: 'vector', min: -1, max: 1, kind: 'continuous' } },
    retired: RETIRED_PARAMS,
    params: {
      walk: { type: 'number', min: 0.5, max: 8, default: 3, unit: 'units/s', effect: 'speed with a light stick or the walk verb' },
      run: { type: 'number', min: 0.5, max: 20, default: 6, unit: 'units/s', effect: 'default moving speed' },
      sprint: { type: 'number', min: 0.5, max: 30, default: 8, unit: 'units/s', effect: 'speed while the sprint verb is held' },
      crouch: { type: 'number', min: 0, max: 8, default: 1.5, unit: 'units/s', effect: 'speed while crouching' },
      jump: { type: 'number', min: 0, max: 30, default: 6, unit: 'units/s', effect: 'take-off speed; 0 disables jumping' },
      preset: { type: 'string', options: ['arcade', 'realistic', 'floaty'], default: 'arcade', effect: 'feel: sets accel, decel, airControl, coyoteMs, bufferMs, gravityScale and fallMultiplier unless given' },
      accel: { type: 'number', min: 1, max: 400, unit: 'units/s²', effect: 'acceleration toward the target speed (preset: 40/14/24)' },
      decel: { type: 'number', min: 1, max: 400, unit: 'units/s²', effect: 'braking with no input (preset: 50/12/6)' },
      airControl: { type: 'number', min: 0, max: 1, effect: 'fraction of accel available in the air (preset: 0.5/0.15/0.8)' },
      coyoteMs: { type: 'number', min: 0, max: 400, unit: 'ms', effect: 'jump still allowed this long after leaving ground (preset: 100/40/160)' },
      bufferMs: { type: 'number', min: 0, max: 400, unit: 'ms', effect: 'a jump pressed this long before landing still fires (preset: 120/60/150)' },
      gravityScale: { type: 'number', min: 0, max: 5, effect: 'multiplies the space gravity (preset: 1/1/0.55)' },
      fallMultiplier: { type: 'number', min: 0.2, max: 4, effect: 'extra gravity while falling (preset: 1.4/1/0.8)' },
      maxFall: { type: 'number', min: 1, max: 200, default: 50, unit: 'units/s', effect: 'terminal fall speed' },
      sprintCost: { type: 'number', min: 0, max: 100, default: 0, unit: '/s', effect: 'stamina drained per second of sprinting (0 = free)' },
      sprintPool: { type: 'string', default: 'stamina', effect: 'gameplay.resource pool sprint draws (res.<pool>); internal pool if absent' },
      sprintMin: { type: 'number', min: 0, max: 100, default: 10, effect: 'stamina needed to start a sprint' },
      walkThreshold: { type: 'number', min: 0, max: 1, default: 0.5, effect: 'stick magnitude below which you walk' },
      steer: { type: 'string', options: ['auto', 'look'], default: 'auto', effect: 'look: axes.look turns body.look (yaw, pitch) and move axes follow it; auto: follow body.look or axes.camera if present' },
      lookRate: { type: 'number', min: 0.1, max: 20, default: 3, unit: 'rad/s', effect: 'turn speed per unit of axes.look when steer=look' },
      hopGravity: { type: 'number', min: 1, max: 200, default: 30, unit: 'units/s²', effect: 'gravity of the virtual hop in spaces without gravity' },
      ...COMMON_PARAMS, 
    },
    rules: {
      walk_speed_order: { fields: ['walk', 'run', 'sprint', 'crouch'], message: 'walk ≤ run ≤ sprint and crouch ≤ run (after the preset)' },
    },
    // Events it emits when it refuses a player's verb, with a reason (graphics.ui.hud says why).
    denials: ['move_failed'],
    provides: { events: ['evaded', 'jumped', 'landed', 'sprint_start', 'sprint_end', 'arrived', 'arrived:*', 'move_failed', 'move_mode', 'travelled', 'depleted:*'], actions: ['move', 'jump', 'sprint', 'run', 'crouch', 'walk', 'travel'] },
    requires: { capabilities: ['position'] },
    optional: { capabilities: ['gravity', 'overlap', 'pathfind', 'navigate', 'editCells'], services: ['character'] },
    components: MOVE_COMPONENTS,
    envelope,
  },
  envelope,
  /** Verifier travel macro: drive this controller along a space path in real steps; true when it arrived. */
  travel: (rt, path, config, instance) => travelAlong(rt, path, {}),
  logic(logic) {
    logic.predicate('moving', {
      check(p, path, errors) { if (p.moving !== true && p.moving !== false && typeof p.moving !== 'string') errors.push({ code: 'predicate_invalid', path, message: 'moving takes true/false or an entity id', hint: '{ "moving": true } or { "moving": "self", "gte": 2 }' }); },
      test(p, rt, c) {
        const e = rt.resolve(typeof p.moving === 'string' ? p.moving : p.who, c);
        if (!e) return false;
        const v = e.components.body?.vel || [0, 0, 0], speed = dimsOf(e) === 3 ? Math.hypot(v[0] || 0, v[2] || 0) : Math.hypot(v[0] || 0, v[1] || 0);
        if (COMPARATORS.some(k => p[k] !== undefined)) return compare(speed, p);
        return (speed > 0.1) === (p.moving !== false);
      },
    });
  },
  validate(config) {
    const errors = [], c = walkConfig(config);
    if (c.walk > c.run) errors.push({ code: 'walk_speed_order', field: 'walk', message: `walk (${c.walk}) is faster than run (${c.run})`, hint: 'walk ≤ run ≤ sprint' });
    if (c.run > c.sprint) errors.push({ code: 'walk_speed_order', field: 'sprint', message: `sprint (${c.sprint}) is slower than run (${c.run})`, hint: 'walk ≤ run ≤ sprint' });
    if (c.crouch > c.run) errors.push({ code: 'walk_speed_order', field: 'crouch', message: 'crouch is faster than run' });
    return errors;
  },
  install(rt, config, instance) {
    const c = walkConfig(config), owner = ownerKey(instance);
    registerBase(rt, owner, 'walk', instance);
    ensureShared(rt);
    verbs(rt, ['move', 'jump', 'sprint', 'run', 'crouch', 'walk']);
    rt.system('input', rt => { for (const e of driven(rt, c, instance)) if (isBaseFor(rt, e, owner, ID, 'walk')) claim(rt, e, 'walk', 0, owner); }, ID);
    rt.system('movement', rt => { for (const e of driven(rt, c, instance)) if (ownedBy(rt, e, owner)) stepWalk(rt, e, c); }, ID);
  },
};

/** One walk step (exported so mount and other controllers reuse the same ground model). */
export function stepWalk(rt, e, c, over = {}) {
  const api = spaceApi(rt, e);
  if (!api) return;
  if (!isContinuous(api, e)) return stepDiscrete(rt, e, api, c);
  const fr = frameOf(api, e, c.plane), b = bodyOf(e), w = state(e, 'walk'), dt = rt.dt;
  const it = over.intent || intent(rt, e, api, fr, { envelope: envelope(c, new Set(), { gravity: fr.gmag || 9.8 }) });
  const ctl = it.ctl;
  if (c.steer === 'look' && ctl?.look && fr.dims === 3) {
    const l = Array.isArray(b.look) ? b.look : [0, 0];
    b.look = [round6(l[0] + (ctl.look[0] || 0) * c.lookRate * dt), round6(clamp(l[1] + (ctl.look[1] || 0) * c.lookRate * dt, -1.4, 1.4))];
  }
  const grounded = fr.up === null ? !(w.hop?.h > 0) : Boolean(b.grounded);
  const mag = Math.min(1, len(it.dir)), crouching = Boolean(ctl?.down('crouch')) && grounded;
  // Speed tier and sprint stamina.
  const stam = pool(rt, e, c.sprintPool);
  let tier = 'run';
  if (crouching) tier = 'crouch';
  else if (ctl ? ctl.down('walk') || mag < c.walkThreshold : !it.run) tier = 'walk';
  const wantSprint = Boolean(ctl?.down('sprint')) && mag > 0.1 && !crouching;
  let sprinting = false;
  if (wantSprint && (c.sprintCost <= 0 || (w.sprinting ? canSpend(stam, c.sprintCost * dt) : canSpend(stam, Math.max(c.sprintMin, c.sprintCost * dt))))) { sprinting = true; tier = 'sprint'; if (c.sprintCost > 0 && stam) stam.spend(c.sprintCost * dt); }
  if (sprinting !== Boolean(w.sprinting)) { w.sprinting = sprinting; rt.emit(sprinting ? 'sprint_start' : 'sprint_end', { who: e.id }); }
  if (!sprinting && stam && !stam.external) stam.regen(dt);
  let speed = over.speed ?? it.speed ?? c[tier];
  // Path following brakes for corners and the destination (v² = 2·decel·d).
  if (it.brake != null && grounded) speed = Math.min(speed, Math.sqrt(2 * c.decel * Math.max(0, it.brake)) + 1);
  const want = mag > 1e-3 ? norm(it.dir).map(v => v * speed * (ctl && tier !== 'walk' ? Math.max(mag, c.walkThreshold) : 1)) : [0, 0, 0];
  // Horizontal acceleration on the plane.
  const rate = (mag > 1e-3 ? c.accel : c.decel) * (grounded ? 1 : c.airControl) * dt;
  const dv = fr.plane.map(i => want[i] - b.vel[i]), dl = Math.hypot(...dv);
  fr.plane.forEach((i, k) => { b.vel[i] += dl <= rate ? dv[k] : (dv[k] / dl) * rate; });
  // Vertical: jump with coyote time and buffer, then gravity.
  w.buffer = it.jump ? c.bufferMs / 1000 : Math.max(0, (w.buffer || 0) - dt);
  w.coyote = grounded ? c.coyoteMs / 1000 : Math.max(0, (w.coyote || 0) - dt);
  const vUp = fr.up === null ? 0 : b.vel[fr.up] * fr.upSign;
  let jumped = false;
  if (c.jump > 0 && w.buffer > 0 && w.coyote > 0 && !crouching && !over.noJump) {
    w.buffer = 0; w.coyote = 0; jumped = true;
    if (fr.up !== null) b.vel[fr.up] = fr.upSign * (over.jump ?? c.jump);
    else w.hop = { h: 0.0001, v: over.jump ?? c.jump };
    rt.emit('jumped', { who: e.id });
  }
  if (fr.up !== null) {
    const falling = b.vel[fr.up] * fr.upSign < 0;
    b.vel[fr.up] += fr.g[fr.up] * c.gravityScale * (falling ? c.fallMultiplier : 1) * dt;
    if (b.vel[fr.up] * fr.upSign < -c.maxFall) b.vel[fr.up] = -c.maxFall * fr.upSign;
  } else if (w.hop) {
    w.hop.v -= c.hopGravity * dt; w.hop.h += w.hop.v * dt;
    if (w.hop.h <= 0) { w.hop = null; b.lift = 0; rt.emit('landed', { who: e.id, speed: 0, height: 0 }); } else b.lift = round6(w.hop.h);
  }
  const before = vUp;
  const r = motor(rt, e, api, b.vel.map(v => v * dt), over.motorOpts || {});
  r.blocked.forEach((bl, i) => { if (bl) b.vel[i] = 0; });
  const nowGrounded = fr.up === null ? !w.hop : r.grounded;
  if (fr.up !== null) { if (nowGrounded && b.vel[fr.up] * fr.upSign < 0) b.vel[fr.up] = 0; trackAir(rt, e, fr, grounded && !jumped, nowGrounded, before); }
  b.grounded = nowGrounded;
  setFacing(e, fr, it.face || (mag > 0.1 ? it.dir : [0, 0, 0]));
  b.state = !nowGrounded ? 'air' : crouching ? 'crouch' : mag < 1e-3 ? 'idle' : tier;
  b.crouch = crouching;
  settle(e, fr);
}

/** Cell-by-cell walking on navigate spaces: one neighbour per 1/speed seconds. */
function stepDiscrete(rt, e, api, c) {
  const w = state(e, 'walk'), b = bodyOf(e);
  w.cool = Math.max(0, round6((w.cool || 0) - rt.dt));
  if (w.cool > 0) return;
  let to = null, speed = c.run;
  if (e.components.moveTo && (e.id === 'player' || e.components.move)) { speed = e.components.moveTo.run ? c.run : c.walk; to = discreteNext(rt, e, api); }
  else if (dimsOf(e)) {
    const ctl = controls(rt, e);
    if (ctl) {
      const [x, y] = ctl.move; if (Math.abs(x) < 0.3 && Math.abs(y) < 0.3) { b.state = 'idle'; return; }
      const fr = frameOf(api, e, c.plane), d = planeVector(fr, Math.abs(x) >= Math.abs(y) ? Math.sign(x) : 0, Math.abs(y) > Math.abs(x) ? Math.sign(y) : 0);
      to = e.at.map((v, i) => Math.round(v + d[i])); setFacing(e, fr, d);
      if (ctl.down('sprint')) speed = c.sprint; else if (ctl.down('walk')) speed = c.walk;
    }
  }
  if (to == null) return;
  if (api.move(e, to, rt)) { w.cool = round6(1 / Math.max(0.1, speed)); b.state = 'walk'; }
  else { w.cool = 0.1; if (e.components.moveTo) mv(e).path = null; }
  b.controller = 'move';
}
