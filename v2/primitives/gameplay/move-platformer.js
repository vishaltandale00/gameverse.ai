// Side-view platforming for any entity on any space with gravity (tilemap
// side, arena2d, voxel/mesh3d 2.5D, engine.space.test). Ports the runner kit's
// side/flap/climb/jetpack physics and the fighting kit's ledge hang, plus the
// catalog verbs: variable jump with jump cut, coyote time, input buffer, double
// jump, dash with i-frames, wall slide/jump/climb (with stamina), glide, swim,
// crouch, auto-bounce (Doodle Jump), flap (Flappy Bird), thrust (jetpack) and
// auto-run (endless runners).
//
// Ability-gated verbs (`abilities.<name>` false by default) are on when
// move-lib-core hasAbility() says so: components.move.abilities, flag
// `ability.<name>`, or a gameplay.progression.abilities ability whose id or
// `grants` names it (so `unlock_ability {ability: "briar_grip"}` with
// grants ["wallSlide","wallJump","wallClimb"] turns all three on).
import {
  clamp, approach, round6, mv, bodyOf, state, spaceApi, frameOf, intent, motor, claim, ownedBy, registerBase, isBaseFor,
  driven, ownerKey, pool, canSpend, setFacing, settle, trackAir, verbs, ensureShared, withPreset, hasAbility, wallBeside,
  ledgeAt, submersion, probe, boxOf, canProbe, COMMON_PARAMS, MACRO_PARAMS, travelAlong,
} from './move-lib-core.js';

const ID = 'gameplay.move.platformer';
export const ABILITIES = ['doubleJump', 'dash', 'wallSlide', 'wallJump', 'wallClimb', 'glide', 'swim', 'crouch', 'ledgeGrab', 'thrust'];
/** Runner kit FEEL multipliers: gravity g, jump height j, air time. */
export const FEEL = { snappy: { g: 1, j: 1 }, floaty: { g: 0.82, j: 1.04 }, heavy: { g: 1.18, j: 0.97 } };

const BASE = {
  run: 9, accel: 70, decel: 90, airControl: 0.85, jump: 22, jumpCut: 0.5, gravity: 0, gravityScale: 1, fallMax: 30, fallMultiplier: 1,
  coyoteMs: 90, bufferMs: 100, doubleJumps: 1, doubleJumpScale: 0.9, autoRun: 0, stompBounce: 0.6,
  dash: { speed: 30, sec: 0.18, cooldown: 0.55, airOnce: true, iframes: 0.12, eightWay: false, keep: 0.5 },
  wallSlide: 3.5, wallJump: { x: 9, y: 0.9, lockMs: 160 }, wallClimb: { speed: 4 }, wallClimbStamina: 0, climbPool: 'stamina', climbStaminaMax: 110,
  glide: { fall: 2.5 }, swim: { speed: 5, stroke: 8, buoyancy: 0.25, drag: 4 }, crouchSpeed: 0.35,
  autoBounce: { velocity: 0, spring: 0, springTag: 'spring' }, flap: { velocity: 0 }, thrust: { accel: 0, up: 11, down: 13 },
  ledgeGrab: { enabled: false, climbSec: 0.23, hangSec: 5, dropCooldown: 0.5 },
};
const runnerV0 = (g, h) => round6(Math.sqrt(2 * g * h));
export const PLATFORMER_PRESETS = {
  custom: {},
  // Runner kit side mode: jumpH 3.3, g 62, cut 0.42, coyote 0.1 s, buffer 0.13 s, maxFall 32, fall gravity ×1.12, auto-run.
  runner: { gravity: 62, jump: runnerV0(62, 3.3), jumpCut: 0.42, coyoteMs: 100, bufferMs: 130, fallMax: 32, fallMultiplier: 1.12, autoRun: 9, doubleJumps: 0 },
  // Runner kit flap mode (Flappy Bird): g 34, flap 9.6, maxFall 14.
  flap: { gravity: 34, jump: 0, flap: { velocity: 9.6 }, fallMax: 14, autoRun: 4, run: 0, doubleJumps: 0, jumpCut: 1 },
  // Runner kit climb mode (Doodle Jump): g 30, bounce 15.5, spring 24, run 7.5, accel 42.
  bounce: { gravity: 30, jump: 0, autoBounce: { velocity: 15.5, spring: 24 }, run: 7.5, accel: 42, decel: 42, airControl: 1, fallMax: 24, doubleJumps: 0 },
  // Runner kit fly control (Jetpack Joyride): flyG 38, thrust 92, up 11, down 13.
  jetpack: { gravity: 38, jump: 0, thrust: { accel: 92, up: 11, down: 13 }, fallMax: 13, autoRun: 9, doubleJumps: 0 },
  // Tight precision platforming: fast accel, short coyote, eight-way dash, climbable walls.
  precision: { run: 9, accel: 120, decel: 140, airControl: 0.9, jump: 16, jumpCut: 0.4, coyoteMs: 80, bufferMs: 120, fallMax: 24, fallMultiplier: 1.3, dash: { eightWay: true, speed: 24, sec: 0.15, cooldown: 0.2 }, wallClimbStamina: 45 },
};

export function platformerConfig(config) {
  const c = withPreset(config, PLATFORMER_PRESETS, structuredClone(BASE));
  const f = FEEL[config.feel] || FEEL.snappy;
  if (f.g !== 1 || f.j !== 1) { c.gravityScale *= f.g; c.jump = round6(c.jump * Math.sqrt(f.g * f.j)); c.flap = { ...c.flap, velocity: round6(c.flap.velocity * Math.sqrt(f.g * f.j)) }; c.autoBounce = { ...c.autoBounce, velocity: round6(c.autoBounce.velocity * Math.sqrt(f.g * f.j)), spring: round6(c.autoBounce.spring * Math.sqrt(f.g * f.j)) }; }
  c.abilities = { ...Object.fromEntries(ABILITIES.map(a => [a, false])), ...(config.abilities || {}) };
  if (c.ledgeGrab.enabled) c.abilities.ledgeGrab = true;
  if (c.thrust.accel > 0 && config.preset === 'jetpack') c.abilities.thrust = true;
  return c;
}

/**
 * Reach for the spatial verifier and tilemap navigation, given unlocked abilities
 * (ctx.gravity: space gravity magnitude, default 60 tiles/s²). Field meanings follow
 * engine.space.tilemap navigation: jumpHeight and jumpGap are one ground jump,
 * doubleJump adds air jumps, dash adds that many tiles, climb = climbable tiles,
 * wallJump = any wall is climbable. reachHeight/reachGap combine everything for
 * spaces that only read one number.
 */
function envelope(config, abilities = new Set(), ctx = {}) {
  const c = platformerConfig(config), has = a => c.abilities[a] || abilities.has(a);
  const g = (c.gravity || ctx.gravity || 60) * c.gravityScale;
  const h = v => (v * v) / (2 * g), t = v => (2 * v) / g;
  const lift = Math.max(c.jump, c.autoBounce.velocity);
  const jumpHeight = h(lift), speed = Math.max(c.run, c.autoRun);
  let air = t(lift), jumpGap = speed * air;
  if (has('glide')) jumpGap += speed * (jumpHeight / Math.max(0.1, c.glide.fall));
  const doubleJump = has('doubleJump') && c.doubleJumps > 0;
  let reachHeight = jumpHeight;
  if (doubleJump) { reachHeight += c.doubleJumps * h(c.jump * c.doubleJumpScale); air += c.doubleJumps * t(c.jump * c.doubleJumpScale); }
  if (c.autoBounce.spring > 0) reachHeight = Math.max(reachHeight, h(c.autoBounce.spring));
  const dash = has('dash') ? c.dash.speed * c.dash.sec : 0;
  const flying = c.flap.velocity > 0 || (has('thrust') && c.thrust.accel > 0);
  return {
    mode: 'continuous', run: speed, jumpHeight: round6(jumpHeight), jumpGap: round6(jumpGap), doubleJump, dash: round6(dash),
    reachHeight: round6(reachHeight), reachGap: round6(speed * air + dash),
    climb: has('wallClimb'), wallJump: has('wallJump'), swim: has('swim'), fly: flying, glideRatio: has('glide') ? round6(speed / c.glide.fall) : 0,
  };
}

// The envelope of an installed controller's resolved config, computed once per config (stepPlatformer runs per entity per frame).
const ENVELOPES = new WeakMap();
const envelopeOf = c => { let env = ENVELOPES.get(c); if (!env) { env = envelope(c); ENVELOPES.set(c, env); } return env; };
const num = (min, max, unit, effect) => ({ type: 'number', min, max, unit, effect });
export default {
  id: ID,
  card: {
    loop: { verbs: ['move', 'jump', 'dash', 'grab', 'glide', 'crouch', 'travel'], progress: ['jumped', 'double_jumped', 'wall_jumped', 'dashed', 'arrived'] },
    locomotion: 'base', medium: 'ground', // base: moves the player on its own; modifier: adds a move on top of base locomotion
    intent: 'Side-view platforming for the player or NPCs: run, variable jump with jump cut, coyote time and buffer, plus ability-gated double jump, dash with i-frames, wall slide/jump/climb, glide, swim, crouch and ledge grab. Presets cover runners, Flappy-style flap, Doodle-style auto-bounce, jetpack thrust and precision platformers. Abilities turn on through unlock_ability grants.',
    views: ['side'],
    actionSpace: { move: { type: 'vector', min: -1, max: 1, kind: 'continuous' } },
    params: {
      preset: { type: 'string', options: Object.keys(PLATFORMER_PRESETS), default: 'custom', effect: 'base tuning; explicit params override it' },
      feel: { type: 'string', options: Object.keys(FEEL), default: 'snappy', effect: 'runner feel: scales gravity and jump (floaty 0.82/1.04, heavy 1.18/0.97)' },
      run: num(0, 40, 'units/s', 'run speed (9)'), accel: num(1, 600, 'units/s²', 'ground acceleration (70)'), decel: num(1, 600, 'units/s²', 'ground braking (90)'),
      airControl: num(0, 1, '', 'fraction of accel in the air (0.85)'),
      jump: num(0, 80, 'units/s', 'take-off speed (22); 0 disables ground jumps'), jumpCut: num(0, 1, '', 'rising speed kept when jump is released early (0.5)'),
      gravity: num(0, 400, 'units/s²', 'override gravity magnitude; 0 uses the space gravity'), gravityScale: num(0, 5, '', 'multiplies gravity (1)'),
      fallMax: num(1, 200, 'units/s', 'terminal fall speed (30)'), fallMultiplier: num(0.2, 4, '', 'extra gravity while falling (1)'),
      coyoteMs: num(0, 400, 'ms', 'jump grace after leaving a ledge (90)'), bufferMs: num(0, 400, 'ms', 'early jump press still fires on landing (100)'),
      autoRun: num(0, 60, 'units/s', 'constant forward run (endless runners); 0 = player-controlled'),
      stompBounce: num(0, 2, '× jump', 'take-off speed after stomping a body (combat touch.stomp), as a fraction of jump (0.6); 0 = no bounce'),
      abilities: { type: 'object', default: {}, effect: 'abilities on from the start (otherwise granted by unlock_ability)', fields: Object.fromEntries(ABILITIES.map(a => [a, { type: 'boolean', default: false }])) },
      doubleJumps: { type: 'integer', min: 0, max: 3, effect: 'extra air jumps with doubleJump (1)' }, doubleJumpScale: num(0.2, 1.5, '', 'air jump speed × jump (0.9)'),
      dash: { type: 'object', effect: 'dash tuning', fields: { speed: num(1, 120, 'units/s'), sec: num(0.02, 1, 's'), cooldown: num(0, 5, 's'), airOnce: { type: 'boolean' }, iframes: num(0, 1, 's'), eightWay: { type: 'boolean' }, keep: num(0, 1, '', 'speed kept after the dash') } },
      wallSlide: num(0, 30, 'units/s', 'fall speed cap while sliding down a wall (3.5)'),
      wallJump: { type: 'object', effect: 'wall jump kick', fields: { x: num(0, 60, 'units/s'), y: num(0, 2, '× jump'), lockMs: num(0, 600, 'ms', 'horizontal control lock after the kick') } },
      wallClimb: { type: 'object', fields: { speed: num(0, 30, 'units/s') } },
      wallClimbStamina: num(0, 200, '/s', 'stamina per second climbing up (a quarter of that while holding); 0 = free'),
      climbPool: { type: 'string', effect: 'gameplay.resource pool for climbing (res.<pool>), else an internal pool refilled on landing' },
      climbStaminaMax: num(1, 1000, '', 'internal climb stamina (110)'),
      glide: { type: 'object', fields: { fall: num(0.2, 20, 'units/s', 'fall speed while gliding') } },
      swim: { type: 'object', fields: { speed: num(0, 30, 'units/s'), stroke: num(0, 40, 'units/s'), buoyancy: num(0, 2, '× gravity'), drag: num(0, 20, '/s') } },
      crouchSpeed: num(0, 1, '', 'run fraction while crouched (0.35)'),
      autoBounce: { type: 'object', effect: 'bounce automatically on landing (Doodle Jump)', fields: { velocity: num(0, 80, 'units/s'), spring: num(0, 120, 'units/s', 'bounce from cells tagged springTag'), springTag: { type: 'string' } } },
      flap: { type: 'object', effect: 'jump presses in the air flap (Flappy Bird)', fields: { velocity: num(0, 60, 'units/s') } },
      thrust: { type: 'object', effect: 'hold jump to thrust upward (needs the thrust ability or the jetpack preset)', fields: { accel: num(0, 400, 'units/s²'), up: num(0, 60, 'units/s'), down: num(0, 60, 'units/s') } },
      ledgeGrab: { type: 'object', effect: 'hang from ledges while falling past them, then climb up or drop', fields: { enabled: { type: 'boolean' }, climbSec: num(0, 2, 's'), hangSec: num(0.2, 60, 's'), dropCooldown: num(0, 5, 's') } },
      ...COMMON_PARAMS, plane: { ...COMMON_PARAMS.plane, default: 'x' }, ...MACRO_PARAMS,
    },
    provides: { events: ['jumped', 'double_jumped', 'flapped', 'dashed', 'wall_jumped', 'wall_slide', 'landed', 'bounced', 'ledge_grab', 'ledge_climb', 'glide_start', 'glide_end', 'submerged', 'surfaced', 'arrived', 'arrived:*', 'move_failed', 'move_mode', 'travelled'], actions: ['move', 'jump', 'dash', 'grab', 'glide', 'crouch', 'travel'] },
    requires: { capabilities: ['position', 'gravity'] },
    optional: { capabilities: ['overlap', 'raycast', 'editCells', 'pathfind'], services: ['character'] },
    envelope,
  },
  envelope,
  /** Verifier travel macro: drive this controller along a space path in real steps; true when it arrived. */
  travel: (rt, path, config, instance) => travelAlong(rt, path, {}),
  validate(config) {
    const errors = [], c = platformerConfig(config);
    if (c.jump === 0 && c.flap.velocity === 0 && c.autoBounce.velocity === 0 && c.thrust.accel === 0) errors.push({ code: 'platformer_no_lift', field: 'jump', message: 'no way to leave the ground: jump, flap, autoBounce and thrust are all 0', hint: 'set jump > 0 or pick a preset' });
    if (c.autoBounce.spring && c.autoBounce.spring < c.autoBounce.velocity) errors.push({ code: 'platformer_spring_weak', field: 'autoBounce.spring', message: 'spring bounce is weaker than a normal bounce' });
    if (c.abilities.wallClimb && !(c.wallClimb.speed > 0)) errors.push({ code: 'platformer_climb_speed', field: 'wallClimb.speed', message: 'wallClimb is on but climb speed is 0' });
    return errors;
  },
  install(rt, config, instance) {
    const c = platformerConfig(config), owner = ownerKey(instance);
    registerBase(rt, owner, 'platformer', instance);
    ensureShared(rt, { speed: Math.max(c.run, c.autoRun, 1), ...config.macro });
    verbs(rt, ['move', 'jump', 'dash', 'grab', 'glide', 'crouch']);
    rt.system('input', rt => { for (const e of driven(rt, c, instance)) if (isBaseFor(rt, e, owner, ID, 'platformer')) claim(rt, e, 'platformer', 0, owner); }, ID);
    // A stomp (gameplay.combat.health touch.stomp) bounces the stomper this controller drives on its next movement step.
    rt.on('stomped', d => { const e = d.by && rt.entity(d.by); if (e && ownedBy(rt, e, owner)) state(e, 'plat').stomp = true; });
    rt.system('movement', rt => { for (const e of driven(rt, c, instance)) if (ownedBy(rt, e, owner)) stepPlatformer(rt, e, c); }, ID);
    rt.options(rt => {
      const p = rt.player(); if (!p || mv(p).owner !== owner) return [];
      // The solver repeats an option's actions for `steps` frames, so a jump held for its whole rise is a full jump.
      const rise = Math.max(1, Math.round((c.jump || c.flap.velocity || c.autoBounce.velocity || 1) / ((c.gravity || 60) * c.gravityScale) / rt.dt));
      const lift = c.jump > 0 || c.flap.velocity > 0 || c.thrust.accel > 0, dashing = c.abilities.dash || hasAbility(rt, p, 'dash'), dashSteps = Math.max(1, Math.round(c.dash.sec / rt.dt));
      // Auto-run (endless runners) sets the horizontal speed itself: left and right change nothing, so the choices are
      // to run on, jump or dash ahead, and when: running on lasts half a cell of travel, so a jump can be timed to the cell.
      if (c.autoRun > 0) return [{ label: 'run on', actions: {}, steps: Math.max(1, Math.ceil(0.5 / (c.autoRun * rt.dt))) }, ...(lift ? [{ label: 'jump', actions: { jump: true }, steps: rise }] : []), ...(dashing ? [{ label: 'dash', actions: { dash: true }, steps: dashSteps }] : [])];
      const out = [{ label: 'run right', actions: { right: true }, steps: 12 }, { label: 'run left', actions: { left: true }, steps: 12 }];
      if (lift) out.push({ label: 'jump', actions: { jump: true }, steps: rise }, { label: 'jump right', actions: { jump: true, right: true }, steps: rise }, { label: 'jump left', actions: { jump: true, left: true }, steps: rise });
      if (dashing) out.push({ label: 'dash right', actions: { dash: true, right: true }, steps: dashSteps }, { label: 'dash left', actions: { dash: true, left: true }, steps: dashSteps });
      return out;
    });
  },
};

export function stepPlatformer(rt, e, c) {
  const api = spaceApi(rt, e); if (!api) return;
  const fr = frameOf(api, e, c.plane);
  if (fr.vert === null || !fr.plane.length) return;
  const X = fr.plane[0], Y = fr.vert, up = fr.upSign, b = bodyOf(e), s = state(e, 'plat'), dt = rt.dt, now = rt.state.time;
  const has = a => c.abilities[a] || hasAbility(rt, e, a);
  const it = intent(rt, e, api, fr, { envelope: envelopeOf(c) }), ctl = it.ctl;
  const gBase = c.gravity > 0 ? c.gravity : fr.gmag || 60, g = gBase * c.gravityScale;
  let x = clamp(it.dir[X] ?? 0, -1, 1);
  const y = ctl ? ctl.move[1] : it.vert;
  if (it.source === 'moveTo' || it.source === 'steer') x = Math.abs(x) > 0.05 ? Math.sign(x) : 0;
  let jumpP = it.jump, jumpH = it.jumpHeld;
  if (it.source === 'moveTo' && it.wp && jumpP && b.grounded) {
    // Launch when the waypoint is within the horizontal distance covered while rising.
    const reach = Math.max(1.2, Math.max(c.run, c.autoRun) * (c.jump / Math.max(1, (c.gravity > 0 ? c.gravity : fr.gmag || 60) * c.gravityScale)) * 1.1);
    if (Math.abs(it.wp[X] - e.at[X]) > reach) jumpP = jumpH = false;
  }
  // Path jumps are held through the rise unless that would overshoot the waypoint by a body height.
  if (it.source === 'moveTo' && it.wp && !b.grounded && b.vel[Y] * up > 0 && it.wp[Y] * up + 1 > e.at[Y] * up) jumpH = true;
  const dashP = Boolean(ctl?.pressed('dash')), grab = Boolean(ctl?.down('grab') || ctl?.down('climb'));
  const glideH = Boolean(ctl?.down('glide')) || jumpH;
  let vx = b.vel[X], vy = b.vel[Y] * up;
  if (s.stomp) { s.stomp = false; if (c.stompBounce > 0) { vy = c.jump * c.stompBounce; s.cut = true; s.jumps = c.doubleJumps; rt.emit('bounced', { who: e.id, stomp: true }); } }
  const grounded = Boolean(b.grounded);
  s.jumps ??= c.doubleJumps; s.cut ??= true;
  const facing = s.face ?? 1;
  // ---- timers
  s.buffer = jumpP ? c.bufferMs / 1000 : Math.max(0, round6((s.buffer || 0) - dt));
  s.coyote = grounded ? c.coyoteMs / 1000 : Math.max(0, round6((s.coyote || 0) - dt));
  s.dashCd = Math.max(0, round6((s.dashCd || 0) - dt));
  s.lock = Math.max(0, round6((s.lock || 0) - dt));
  s.ledgeCd = Math.max(0, round6((s.ledgeCd || 0) - dt));
  const iUntil = mv(e).invulnerableUntil ?? -1; b.iframes = now < iUntil;
  // ---- ledge hang (fighting kit: hang up to hangSec, climb after climbSec, drop away with a cooldown)
  if (s.hang) {
    const H = s.hang; H.t = round6(H.t + dt);
    b.vel = [0, 0, 0];
    if (H.climb != null) {
      H.climb = round6(H.climb + dt);
      if (H.climb >= c.ledgeGrab.climbSec) { api.setPos(e, H.stand, rt); s.hang = null; b.grounded = true; rt.emit('ledge_climb', { who: e.id }); mv(e).invulnerableUntil = now + 0.1; }
    } else if (H.t > 4 * dt && (y > 0.5 || jumpP || x * H.side > 0.5)) H.climb = 0;
    else if ((H.t > 4 * dt && (y < -0.5 || x * H.side < -0.5)) || H.t > c.ledgeGrab.hangSec) { s.hang = null; s.ledgeCd = c.ledgeGrab.dropCooldown; }
    b.state = 'ledge'; settle(e, fr); return;
  }
  // ---- environment
  const water = has('swim') ? submersion(rt, api, e, fr) : { frac: 0 };
  const swimming = water.frac >= 0.5;
  if (swimming !== Boolean(s.swim)) { s.swim = swimming; rt.emit(swimming ? 'submerged' : 'surfaced', { who: e.id }); }
  const wallAbility = has('wallSlide') || has('wallJump') || has('wallClimb') || has('ledgeGrab');
  const wallL = wallAbility && !grounded ? wallBeside(rt, api, e, X, -1) : null, wallR = wallAbility && !grounded ? wallBeside(rt, api, e, X, 1) : null;
  const wallSide = wallR && (x > 0 || !wallL) ? 1 : wallL ? -1 : 0;
  // ---- dash
  if (dashP && has('dash') && s.dashCd <= 0 && !(c.dash.airOnce && !grounded && s.airDash)) {
    const d = c.dash.eightWay && (Math.abs(x) > 0.3 || Math.abs(y) > 0.3) ? [Math.abs(x) > 0.3 ? Math.sign(x) : 0, Math.abs(y) > 0.3 ? Math.sign(y) : 0] : [x ? Math.sign(x) : facing, 0];
    const l = Math.hypot(d[0], d[1]);
    s.dash = { t: c.dash.sec, d: [d[0] / l, d[1] / l] }; s.dashCd = c.dash.cooldown;
    if (!grounded) s.airDash = true;
    mv(e).invulnerableUntil = now + c.dash.iframes; b.iframes = c.dash.iframes > 0;
    rt.emit('dashed', { who: e.id, dir: s.dash.d });
  }
  let mode = 'run';
  if (s.dash) {
    s.dash.t = round6(s.dash.t - dt);
    vx = s.dash.d[0] * c.dash.speed; vy = s.dash.d[1] * c.dash.speed; mode = 'dash';
    if (s.dash.t <= 0) { vx = clamp(vx * c.dash.keep, -Math.max(c.run, c.autoRun), Math.max(c.run, c.autoRun)); vy = vy > 0 ? vy * c.dash.keep : 0; s.dash = null; }
  } else if (swimming) {
    // ---- swim: buoyant, damped, strokes upward on jump
    mode = 'swim';
    vx = approach(vx, x * c.swim.speed, c.accel * 0.5 * dt);
    vy = approach(vy, y * c.swim.speed, c.swim.drag * c.swim.speed * dt) - g * c.swim.buoyancy * dt * (y < -0.3 ? 1 : 0.2);
    if (jumpP) { vy = water.head === false ? c.jump : c.swim.stroke; rt.emit('jumped', { who: e.id, swim: true }); }
  } else {
    // ---- wall climb / slide / jump
    const climbStam = c.wallClimbStamina > 0 ? pool(rt, e, c.climbPool, { max: c.climbStaminaMax }) : null;
    const climbing = has('wallClimb') && grab && wallSide !== 0 && canSpend(climbStam, c.wallClimbStamina * dt * 0.25);
    if (climbing) {
      mode = 'climb';
      vy = y * c.wallClimb.speed; vx = wallSide * 0.5;
      if (climbStam) climbStam.spend(c.wallClimbStamina * dt * (y > 0.1 ? 1 : 0.25));
      if (jumpP && has('wallJump')) { vx = -wallSide * c.wallJump.x; vy = c.jump * c.wallJump.y; s.lock = c.wallJump.lockMs / 1000; s.cut = false; rt.emit('wall_jumped', { who: e.id, side: wallSide }); mode = 'air'; }
      // Pull up over the top of a climbable wall.
      if (y > 0.3 && wallSide && !wallBeside(rt, api, e, X, wallSide, 0.08, [0.95])) { const L = ledgeAt(rt, api, e, X, wallSide); if (L) { api.setPos(e, L.stand, rt); vy = 0; rt.emit('ledge_climb', { who: e.id }); } }
    } else {
      // Ledge grab while falling past a wall top.
      if ((has('ledgeGrab')) && !grounded && vy <= 0 && s.ledgeCd <= 0 && wallSide && x * wallSide >= 0 && canProbe(api)) {
        const L = ledgeAt(rt, api, e, X, wallSide);
        if (L) { s.hang = { side: wallSide, t: 0, climb: null, stand: L.stand }; b.vel = [0, 0, 0]; s.jumps = c.doubleJumps; s.airDash = false; rt.emit('ledge_grab', { who: e.id, side: wallSide }); mv(e).invulnerableUntil = now + 0.5; b.state = 'ledge'; settle(e, fr); return; }
      }
      // ---- jumps: ground (buffer + coyote), wall, flap, double
      if (s.buffer > 0 && s.coyote > 0 && c.jump > 0) {
        vy = c.jump; s.buffer = 0; s.coyote = 0; s.cut = false; rt.emit('jumped', { who: e.id });
      } else if (jumpP && !grounded && wallSide && has('wallJump')) {
        vx = -wallSide * c.wallJump.x; vy = c.jump * c.wallJump.y; s.lock = c.wallJump.lockMs / 1000; s.cut = false; s.buffer = 0; s.jumps = c.doubleJumps;
        rt.emit('wall_jumped', { who: e.id, side: wallSide });
      } else if (jumpP && !grounded && c.flap.velocity > 0) {
        vy = c.flap.velocity; s.buffer = 0; rt.emit('flapped', { who: e.id }); rt.emit('jumped', { who: e.id, flap: true });
      } else if (jumpP && !grounded && s.coyote <= 0 && s.jumps > 0 && has('doubleJump')) {
        vy = c.jump * c.doubleJumpScale; s.jumps--; s.buffer = 0; s.cut = false; rt.emit('double_jumped', { who: e.id, left: s.jumps });
      }
      if (!jumpH && !s.cut && vy > 0) { vy *= c.jumpCut; s.cut = true; }
      // ---- thrust (jetpack)
      if (has('thrust') && c.thrust.accel > 0 && jumpH) { vy += c.thrust.accel * dt; mode = 'fly'; }
      // ---- gravity
      vy -= g * (vy < 0 ? c.fallMultiplier : 1) * dt;
      if (has('thrust') && c.thrust.accel > 0) vy = clamp(vy, -c.thrust.down, c.thrust.up);
      vy = Math.max(vy, -c.fallMax);
      // ---- wall slide and glide caps
      if (!grounded && vy < 0 && wallSide && x * wallSide > 0 && has('wallSlide')) { vy = Math.max(vy, -c.wallSlide); mode = 'wall'; if (!s.sliding) rt.emit('wall_slide', { who: e.id, side: wallSide }); }
      s.sliding = mode === 'wall';
      const gliding = has('glide') && !grounded && vy < 0 && glideH && mode !== 'wall';
      if (gliding) { vy = Math.max(vy, -c.glide.fall); mode = 'glide'; }
      if (gliding !== Boolean(s.glide)) { s.glide = gliding; rt.emit(gliding ? 'glide_start' : 'glide_end', { who: e.id }); }
      // ---- horizontal
      const crouch = has('crouch') && grounded && (ctl?.down('crouch') || y < -0.5);
      if (crouch) mode = 'crouch';
      const top = c.autoRun > 0 ? c.autoRun : c.run * (crouch ? c.crouchSpeed : 1);
      const target = c.autoRun > 0 ? c.autoRun : x * top;
      if (s.lock <= 0) vx = approach(vx, target, (target !== 0 ? c.accel : c.decel) * (grounded ? 1 : c.airControl) * dt);
      if (!grounded && mode === 'run') mode = 'air';
    }
  }
  // ---- integrate through the space
  b.vel[X] = vx; b.vel[Y] = vy * up;
  const r = motor(rt, e, api, b.vel.map(v => v * dt));
  if (r.blocked[X]) b.vel[X] = 0;
  if (r.blocked[Y]) { b.vel[Y] = 0; if (s.dash && s.dash.d[1]) s.dash = null; }
  const nowGrounded = r.grounded;
  if (nowGrounded && b.vel[Y] * up < 0) b.vel[Y] = 0;
  if (nowGrounded && !grounded) {
    s.jumps = c.doubleJumps; s.airDash = false;
    if (c.wallClimbStamina > 0) { const p = pool(rt, e, c.climbPool, { max: c.climbStaminaMax }); if (p && !p.external) p.refill(); }
    if (c.autoBounce.velocity > 0) {
      const bx = boxOf(api, e), feet = bx.min.map((m, i) => m + bx.size[i] / 2); feet[Y] = up > 0 ? bx.min[Y] - 0.05 : bx.max[Y] + 0.05;
      const spring = c.autoBounce.spring > 0 && canProbe(api) && probe(rt, api, feet).tags.includes(c.autoBounce.springTag);
      b.vel[Y] = up * (spring ? c.autoBounce.spring : c.autoBounce.velocity);
      rt.emit('bounced', { who: e.id, spring });
    }
  }
  trackAir(rt, e, fr, grounded, nowGrounded && !(c.autoBounce.velocity > 0 && !grounded), vy);
  b.grounded = nowGrounded && !(c.autoBounce.velocity > 0 && !grounded);
  if (Math.abs(x) > 0.1 || c.autoRun) { s.face = c.autoRun ? 1 : Math.sign(x); const d = [0, 0, 0]; d[X] = s.face; setFacing(e, fr, d); }
  b.state = mode === 'run' ? (Math.abs(b.vel[X]) < 0.05 ? 'idle' : 'run') : mode;
  settle(e, fr);
}
