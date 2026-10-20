// Shoot-'em-up ship controllers ported from the shmup kit (game.js 176-213),
// for any entity on any continuous space:
//   rail       Galaga / Space Invaders: horizontal only along the rail axis
//   eightway   vertical/horizontal scrollers: normalized 8-way movement, clamped to bounds
//   twinstick  8-way movement plus independent aim (axes.aim / axes.look) with auto-aim at the nearest target
//   inertial   Asteroids: rotate 4.6 rad/s, thrust 300 units/s², drag 0.55/s, max 1.5 × speed, wraparound
// Hyperspace (Asteroids) jumps to a random spot in bounds with rt.random().
// Heading is components.move.ship.ang (radians, 0 = +x) and body.dir; body.facing is ±1 (frozen 2D field). Aim is components.move.ship.aim (radians),
// which combat.projectile can read for twin-stick fire.
import {
  clamp, round6, mv, bodyOf, state, spaceApi, frameOf, intent, claim, ownedBy, registerBase, isBaseFor, driven, ownerKey,
  controls, verbs, ensureShared, motor, settle, v3, setFacing, spaceWraps, COMMON_PARAMS, MACRO_PARAMS, travelAlong,
} from './move-lib-core.js';

const ID = 'gameplay.move.ship';
export const SHIP = { rotate: 4.6, thrust: 300, drag: 0.55, maxSpeed: 1.5, hyperCooldown: 2, hyperInvuln: 20 / 60, hyperKeep: 0.3, hyperMargin: 30, margin: 10, aimRange: 300 };
const num = (min, max, d, unit, effect) => ({ type: 'number', min, max, default: d, unit, effect });

function envelope(config) { return { mode: 'ship', run: config.mode === 'inertial' ? config.speed * config.maxSpeed : config.speed, fly: true, jumpHeight: 0, jumpGap: 0 }; }

export default {
  id: ID,
  card: {
    intent: 'Ship controls for shmups and arena shooters: rail (side to side), eight-way, twin-stick (separate aim with auto-aim) or inertial Asteroids flight (rotate, thrust, drag, wraparound), with a slow focus mode and hyperspace jumps, clamped to or wrapping around the play bounds.',
    views: ['td', 'side'],
    actionSpace: { move: { type: 'vector', min: -1, max: 1, kind: 'continuous' }, aim: { type: 'vector', min: -1, max: 1, kind: 'continuous' } },
    params: {
      mode: { type: 'string', options: ['rail', 'eightway', 'twinstick', 'inertial'], default: 'eightway', effect: 'control scheme' },
      speed: num(1, 2000, 190, 'units/s', 'top speed (kit: 140-240 px/s)'),
      focus: num(0.1, 1, 0.5, '', 'speed multiplier while the focus verb is held'),
      heading: num(-360, 360, 90, 'deg', 'fixed facing for rail/eightway (90 = up the screen)'),
      rotate: num(0.1, 30, SHIP.rotate, 'rad/s', 'inertial turn rate'),
      thrust: num(1, 5000, SHIP.thrust, 'units/s²', 'inertial thrust'),
      drag: num(0, 10, SHIP.drag, '/s', 'inertial velocity decay'),
      maxSpeed: num(0.1, 10, SHIP.maxSpeed, '× speed', 'inertial speed cap'),
      bounds: { type: 'list', of: { type: 'number' }, min: 4, max: 4, effect: '[x0, y0, x1, y1] play area; default: the space bounds() when it has them' },
      margin: num(0, 200, SHIP.margin, 'units', 'distance kept from the bounds edge'),
      wrap: { type: 'boolean', effect: 'wrap at the bounds instead of clamping (default: true for inertial)' },
      hyperspace: { type: 'object', default: {}, effect: 'random jump on the hyperspace verb', fields: {
        enabled: { type: 'boolean', default: false }, cooldown: num(0, 30, SHIP.hyperCooldown, 's'), invuln: num(0, 5, SHIP.hyperInvuln, 's'),
        keep: num(0, 1, SHIP.hyperKeep, '', 'velocity kept'), margin: num(0, 500, SHIP.hyperMargin, 'units', 'minimum distance from the edges') } },
      autoAim: { type: 'boolean', default: true, effect: 'twinstick: aim at the nearest target when there is no aim input' },
      aimRange: num(1, 5000, SHIP.aimRange, 'units', 'auto-aim range'),
      aimTargets: { type: 'list', of: { type: 'string' }, default: ['enemy', 'boss'], effect: 'archetype ids or kinds auto-aim considers' },
      collide: { type: 'boolean', default: false, effect: 'collide with solid cells through space.slide instead of flying over them' },
      ...COMMON_PARAMS, ...MACRO_PARAMS,
    },
    provides: { events: ['hyperspace', 'thrust_start', 'thrust_end'], actions: ['move', 'thrust', 'focus', 'hyperspace', 'aim'] },
    requires: { capabilities: ['position'] },
    optional: { capabilities: ['bounds', 'wrap', 'overlap', 'distance'] },
    envelope,
  },
  envelope,
  /** Verifier travel macro: drive this controller along a space path in real steps; true when it arrived. */
  travel: (rt, path, config, instance) => travelAlong(rt, path, {}),
  install(rt, c, instance) {
    const owner = ownerKey(instance), wrap = c.wrap ?? c.mode === 'inertial';
    const hyper = { enabled: false, cooldown: SHIP.hyperCooldown, invuln: SHIP.hyperInvuln, keep: SHIP.hyperKeep, margin: SHIP.hyperMargin, ...c.hyperspace };
    registerBase(rt, owner, 'ship', instance);
    ensureShared(rt, { speed: c.speed, ...c.macro });
    verbs(rt, ['move', 'thrust', 'focus', 'hyperspace']);
    const kinds = new Map((rt.doc.content?.archetypes || []).map(a => [a.id, a.kind]));
    const boundsOf = api => {
      if (c.bounds) return { min: [c.bounds[0], c.bounds[1]], max: [c.bounds[2], c.bounds[3]] };
      if (typeof api.bounds === 'function') { const b = api.bounds(); if (b?.min && b?.max) return b; }
      return null;
    };
    rt.system('input', rt => { for (const e of driven(rt, c, instance)) if (isBaseFor(rt, e, owner, ID, 'ship')) claim(rt, e, 'ship', 0, owner); }, ID);
    rt.system('movement', rt => {
      for (const e of driven(rt, c, instance)) {
        if (!ownedBy(rt, e, owner)) continue;
        const api = spaceApi(rt, e); if (!api || !Array.isArray(e.at)) continue;
        const fr = frameOf(api, e, c.plane === 'auto' ? 'xy' : c.plane), [A, B] = fr.plane.length > 1 ? fr.plane : [0, 1];
        const b = bodyOf(e), s = state(e, 'ship'), ctl = controls(rt, e), it = intent(rt, e, api, fr), dt = rt.dt;
        s.cool = Math.max(0, round6((s.cool || 0) - dt));
        const bounds = boundsOf(api);
        // Stick in board terms: x right, y up the screen (input y), from player/NPC intent.
        let x = it.dir[A] ?? 0, y = it.dir[B] ?? 0;
        if (it.source === 'moveTo' || it.source === 'steer') { const l = Math.hypot(x, y); if (l > 1e-6) { x /= l; y /= l; } }
        const sp = c.speed * (ctl?.down('focus') ? c.focus : 1) * (it.speed ? it.speed / c.speed : 1);
        let pos = v3(e.at);
        if (c.mode === 'inertial') {
          s.ang ??= (c.heading * Math.PI) / 180;
          const npc = it.source === 'moveTo' || it.source === 'steer';
          let thrusting;
          if (npc) {
            // Steered ships turn toward the wanted heading and thrust once roughly aligned.
            const want = Math.hypot(x, y) > 1e-6 ? Math.atan2(y, x) : s.ang;
            let d = want - s.ang; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
            s.ang = round6(s.ang + Math.max(-c.rotate * dt, Math.min(c.rotate * dt, d)));
            thrusting = Math.hypot(x, y) > 1e-6 && Math.abs(d) < 0.5;
          } else {
            s.ang = round6(s.ang - x * c.rotate * dt);
            thrusting = ctl ? y > 0.3 || ctl.down('thrust') : y > 0.3;
          }
          if (thrusting !== Boolean(s.thrust)) { s.thrust = thrusting; rt.emit(thrusting ? 'thrust_start' : 'thrust_end', { who: e.id }); }
          if (thrusting) { b.vel[A] += Math.cos(s.ang) * c.thrust * dt; b.vel[B] += Math.sin(s.ang) * c.thrust * dt; }
          const k = 1 - c.drag * dt; b.vel[A] *= k; b.vel[B] *= k;
          const v = Math.hypot(b.vel[A], b.vel[B]), max = c.speed * c.maxSpeed;
          if (v > max) { b.vel[A] *= max / v; b.vel[B] *= max / v; }
          if (hyper.enabled && s.cool <= 0 && ctl?.pressed('hyperspace') && bounds) {
            const lo = bounds.min, hi = bounds.max, rx = lo[0] + hyper.margin + rt.random() * Math.max(0, hi[0] - lo[0] - 2 * hyper.margin), ry = lo[1] + hyper.margin + rt.random() * Math.max(0, hi[1] - lo[1] - 2 * hyper.margin);
            pos[A] = round6(rx); pos[B] = round6(ry); b.vel[A] *= hyper.keep; b.vel[B] *= hyper.keep; s.cool = hyper.cooldown;
            mv(e).invulnerableFrom = rt.state.time; mv(e).invulnerableUntil = round6(rt.state.time + hyper.invuln);
            rt.emit('hyperspace', { who: e.id, at: [pos[A], pos[B]] });
          }
        } else {
          // Rail ships take the stick's horizontal as full deflection (the kit's digital input).
          let dx = c.mode === 'rail' ? (Math.abs(x) > 0.2 ? Math.sign(x) * Math.min(1, Math.abs(x) * Math.SQRT2) : 0) : x, dy = c.mode === 'rail' ? 0 : y;
          if (dx && dy) { const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; } }
          b.vel[A] = dx * sp; b.vel[B] = dy * sp;
          if (c.mode === 'twinstick') {
            const aim = ctl?.aim || ctl?.look;
            if (aim && Math.hypot(aim[0], aim[1]) > 0.2) s.aim = round6(Math.atan2(aim[1], aim[0]));
            else {
              if (dx || dy) s.aimMove = round6(Math.atan2(dy, dx));
              const t = c.autoAim ? nearestTarget(rt, e, api, c, kinds, A, B) : null;
              s.aim = t ? round6(Math.atan2(t.at[B] - e.at[B], t.at[A] - e.at[A])) : (s.aimMove ?? (c.heading * Math.PI) / 180);
            }
            s.ang = s.aim;
          } else s.ang = round6((c.heading * Math.PI) / 180);
        }
        if (c.collide) motor(rt, e, api, b.vel.map(v => v * dt));
        else { pos[A] += b.vel[A] * dt; pos[B] += b.vel[B] * dt; }
        if (!c.collide || c.mode === 'inertial') {
          if (bounds && !spaceWraps(api)) {
            if (wrap) { for (const [i, k] of [[A, 0], [B, 1]]) { const lo = bounds.min[k], span = bounds.max[k] - lo; pos[i] = lo + ((((pos[i] - lo) % span) + span) % span); } }
            else { const m = c.margin; pos[A] = clamp(pos[A], bounds.min[0] + m, bounds.max[0] - m); pos[B] = clamp(pos[B], bounds.min[1] + m, bounds.max[1] - m); }
          }
          if (!c.collide) api.setPos(e, pos.slice(0, e.at.length).map(round6), rt);
        }
        s.aim ??= s.ang;
        const dir = [0, 0, 0]; dir[A] = round6(Math.cos(s.ang)); dir[B] = round6(Math.sin(s.ang)); setFacing(e, fr, dir);
        b.state = 'ship'; b.iframes = rt.state.time < (mv(e).invulnerableUntil ?? -1);
        settle(e, fr);
      }
    }, ID);
    rt.options(rt => {
      const p = rt.player(); if (!p || mv(p).owner !== owner) return [];
      const out = [['left', { left: true }], ['right', { right: true }]];
      if (c.mode !== 'rail') out.push(['up', { up: true }], ['down', { down: true }]);
      if (c.mode === 'inertial' && hyper.enabled) out.push(['hyperspace', { hyperspace: true }]);
      return out.map(([label, actions]) => ({ label: `ship ${label}`, actions, steps: 10 }));
    });
  },
};

function nearestTarget(rt, e, api, c, kinds, A, B) {
  let best = null, bd = c.aimRange * c.aimRange;
  const cands = typeof api.overlap === 'function'
    ? api.overlap({ kind: 'circle', at: e.at, r: c.aimRange }, o => o.id !== e.id).map(id => rt.entity(id)).filter(Boolean)
    : Object.values(rt.state.entities).filter(o => o.space === e.space && o.id !== e.id);
  for (const o of cands) {
    if (!c.aimTargets.includes(o.archetype) && !c.aimTargets.includes(kinds.get(o.archetype))) continue;
    if (o.components.health?.dead) continue;
    const d = (o.at[A] - e.at[A]) ** 2 + (o.at[B] - e.at[B]) ** 2;
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}
