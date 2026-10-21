// Flight for any entity: free flight (creative mode, wings, drones, birds,
// ghosts) or thrust against gravity (jetpacks; runner kit fly control: flyG 38,
// thrust 92, up 11, down 13). Flight is either always on (the entity's base
// locomotion) or toggled by a verb or a double tap of jump. It may burn fuel
// from a resource pool or an internal tank that refills on the ground.
import {
  round6, mv, bodyOf, state, spaceApi, frameOf, intent, claim, ownedBy, registerBase, isBaseFor, driven, ownerKey, pool, canSpend,
  hasAbility, verbs, ensureShared, steerPlane, integrate, setFacing, settle, installOverlay, COMMON_PARAMS, MACRO_PARAMS, len, travelAlong, MOVE_COMPONENTS,
} from './move-lib-core.js';

const ID = 'gameplay.move.fly';
const num = (min, max, d, unit, effect) => ({ type: 'number', min, max, default: d, unit, effect });

function envelope(config, abilities = new Set()) {
  const ok = config.toggle === 'always' || !config.ability || abilities.has(config.ability);
  const range = config.fuel > 0 ? config.speed * config.fuel : Infinity;
  // fly:true is what spaces read; no huge jump numbers (navigation iterates over jump reach).
  return { mode: 'continuous', fly: ok, run: config.speed, flyRange: ok && Number.isFinite(range) ? round6(range) : 0 };
}

export default {
  id: ID,
  card: {
    loop: { verbs: ['fly', 'ascend', 'descend', 'jump', 'sprint'], progress: ['fly_start', 'arrived'] },
    locomotion: 'base', medium: 'air', // base: moves the player on its own; modifier: adds a move on top of base locomotion
    // The body this controller is tuned for, [width, height, depth] in space units (a side view reads [w, h], a top-down
    // one [w, d]): traversal conformance proves generated worlds for a player of this size (v2-p-generate2d-traversal).
    body: { size: [0.8, 1.4, 0.8] },
    intent: 'Flight: free 3D/side flight with ascend and descend, or jetpack thrust against gravity, always on or toggled by a verb or a double jump, optionally burning fuel. Use it for creative-mode flying, wings, jetpacks, flying NPCs and drones.',
    views: ['1p', '3p', 'side', 'td', 'iso'],
    actionSpace: { move: { type: 'vector', min: -1, max: 1, kind: 'continuous' } },
    params: {
      style: { type: 'string', options: ['free', 'thrust'], default: 'free', effect: 'free: no gravity while flying; thrust: hold jump/ascend to push against gravity' },
      toggle: { type: 'string', options: ['verb', 'double_jump', 'always'], default: 'verb', effect: 'how flight starts: the fly verb, a double tap of jump in the air, or always flying' },
      speed: num(0.5, 200, 8, 'units/s', 'cruise speed'), sprint: num(0, 400, 14, 'units/s', 'speed with sprint held'),
      vertical: num(0, 100, 6, 'units/s', 'climb/descend speed (free style)'), accel: num(0.5, 400, 30, 'units/s²', 'steering response'),
      thrust: { type: 'object', default: { accel: 92, up: 11, down: 13 }, effect: 'thrust style tuning', fields: { accel: num(0, 600, 92, 'units/s²'), up: num(0, 100, 11, 'units/s'), down: num(0, 100, 13, 'units/s') } },
      fuel: num(0, 3600, 0, 's', 'seconds of flight (free) or thrust (thrust style); 0 = unlimited'),
      fuelPool: { type: 'string', default: '', effect: 'gameplay.resource pool to burn instead of the internal tank (res.<pool>)' },
      fuelRegen: num(0, 100, 1, '×/s', 'internal tank refill rate on the ground (fraction of the tank per second)'),
      landOnGround: { type: 'boolean', default: true, effect: 'touching ground while descending ends a toggled flight' },
      ability: { type: 'string', default: '', effect: 'ability required to fly (via unlock_ability grants); empty = always' },
      ...COMMON_PARAMS, ...MACRO_PARAMS,
    },
    provides: { events: ['evaded', 'fly_start', 'fly_end', 'fuel_empty', 'landed', 'arrived', 'arrived:*', 'move_failed'], actions: ['fly', 'ascend', 'descend', 'jump', 'sprint'] },
    requires: { capabilities: ['position'] },
    optional: { capabilities: ['gravity', 'pathfind'], services: ['character'] },
    components: MOVE_COMPONENTS,
    envelope,
  },
  envelope,
  /** Verifier travel macro: drive this controller along a space path in real steps; true when it arrived. */
  travel: (rt, path, config, instance) => travelAlong(rt, path, {}),
  install(rt, c, instance) {
    verbs(rt, ['fly', 'ascend', 'descend', 'jump', 'sprint']);
    ensureShared(rt, { speed: c.speed, ...c.macro });
    const tank = e => (c.fuelPool ? pool(rt, e, c.fuelPool) : c.fuel > 0 ? pool(rt, e, 'fly_fuel', { max: c.fuel, regen: c.fuel * c.fuelRegen }) : null);
    const fly = (e, api, fr, s) => {
      const b = bodyOf(e), dt = rt.dt, it = intent(rt, e, api, fr, { free3d: true, jumpIsUp: true, crouchIsDown: true }), ctl = it.ctl;
      const fuel = tank(e), speed = ctl?.down('sprint') ? c.sprint || c.speed : it.speed ?? c.speed;
      const V = fr.vert;
      if (c.style === 'free' || fr.up === null) {
        steerPlane(b, fr, it.dir.map(v => v * speed), c.accel * dt);
        if (V !== null) { const up = fr.upSign || 1, cur = b.vel[V] * up, t = it.vert * c.vertical; b.vel[V] = up * (cur + Math.max(-c.accel * dt, Math.min(c.accel * dt, t - cur))); }
        if (fuel) { fuel.spend(fuel.external ? dt : dt); if (fuel.value <= 0) { s.endReason = 'fuel'; rt.emit('fuel_empty', { who: e.id }); } }
      } else {
        steerPlane(b, fr, it.dir.map(v => v * speed), c.accel * dt);
        const up = fr.upSign, U = fr.up;
        let vy = b.vel[U] * up;
        const thrusting = (ctl ? ctl.down('jump') || ctl.down('ascend') : it.vert > 0.2) && canSpend(fuel, dt);
        if (thrusting) { vy += c.thrust.accel * dt; if (fuel) fuel.spend(dt); }
        vy += fr.g[U] * up * dt;
        vy = Math.max(-c.thrust.down, Math.min(c.thrust.up, vy));
        b.vel[U] = vy * up;
        if (fuel && fuel.value <= 0 && !s.empty) { s.empty = true; rt.emit('fuel_empty', { who: e.id }); }
        if (fuel && fuel.value > 0) s.empty = false;
      }
      integrate(rt, e, api, fr, { fly: true });
      if (len(it.dir) > 0.1) setFacing(e, fr, it.dir);
      b.state = 'fly';
    };
    if (c.toggle === 'always') {
      const owner = ownerKey(instance);
      registerBase(rt, owner, 'fly', instance);
      rt.system('input', rt => { for (const e of driven(rt, c, instance)) if (isBaseFor(rt, e, owner, ID, 'fly')) claim(rt, e, 'fly', 0, owner); }, ID);
      rt.system('movement', rt => {
        for (const e of driven(rt, c, instance)) {
          if (!ownedBy(rt, e, owner)) continue;
          const api = spaceApi(rt, e); if (!api) continue;
          const fr = frameOf(api, e, c.plane), s = state(e, 'fly');
          if (!s.on) { s.on = true; rt.emit('fly_start', { who: e.id }); }
          fly(e, api, fr, s); settle(e, fr);
        }
      }, ID);
      return;
    }
    installOverlay(rt, c, instance, {
      id: ID, mode: 'fly', pri: 25,
      wants(e, api, fr, s, active) {
        const it = intent(rt, e, api, fr, { free3d: true }), ctl = it.ctl, b = bodyOf(e);
        if (!active) {
          const fuel = tank(e); if (fuel && !fuel.external && b.grounded) fuel.regen(rt.dt);
          if (c.ability && !hasAbility(rt, e, c.ability)) return false;
          if (fuel && !canSpend(fuel, rt.dt)) return false;
          let go = false;
          if (c.toggle === 'verb') go = Boolean(ctl?.pressed('fly')) || Boolean(e.components.steer?.fly);
          else if (ctl?.pressed('jump') && !b.grounded) { go = s.lastTap != null && rt.state.time - s.lastTap < 0.3; s.lastTap = rt.state.time; }
          else if (ctl?.pressed('jump')) s.lastTap = rt.state.time;
          return go;
        }
        if (s.endReason) return false;
        if (c.toggle === 'verb' && ctl?.pressed('fly')) { s.endReason = 'toggled'; return false; }
        if (c.toggle === 'double_jump' && ctl?.pressed('jump')) { if (s.lastTap != null && rt.state.time - s.lastTap < 0.3) { s.endReason = 'toggled'; s.lastTap = null; return false; } s.lastTap = rt.state.time; }
        if (c.landOnGround && b.grounded && s.t > 0.2 && it.vert <= 0) { s.endReason = 'landed'; return false; }
        return true;
      },
      start(e, api, fr, s) { s.endReason = null; s.empty = false; rt.emit('fly_start', { who: e.id }); },
      end(e, api, s, reason) { rt.emit('fly_end', { who: e.id, reason }); mv(e).req = null; },
      step: fly,
    });
  },
};
