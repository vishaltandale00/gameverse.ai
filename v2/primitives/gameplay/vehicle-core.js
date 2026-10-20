// gameplay.vehicle.core: what every vehicle has regardless of how it moves.
// Seats and occupants, entering/exiting (with carjacking, locks and theft),
// ownership, hull damage with burning and destruction, fuel, horn and radio.
// Motion primitives (vehicle.car / boat / aircraft) read driver controls and
// fuel through the 'vehicles' service; AI drivers write components.drive.control.
import { alive, dist, spaceOf, bindRoles, planeFor, fromPlane, matches, sortedEntities, err, needFields, clamp, r6 } from './modes-lib-util.js';

const ID = 'gameplay.vehicle.core';
const MOTION = ['car', 'boat', 'aircraft'];

/** Runtime fields live beside the archetype spec in components.vehicle. */
function ensure(v) {
  const c = v.components.vehicle;
  if (c.hp === undefined) {
    c.max = c.health ?? 100; c.hp = c.max;
    c.tank = c.fuel ?? 0; c.fuelLeft = c.tank; // tank 0 = no fuel system (carts, gliders)
    c.occupants = Array(Math.max(1, c.seats ?? 1)).fill(null);
    c.owner ??= null; c.locked ??= false; c.destroyed = false; c.burning = 0;
  }
  return c;
}
const kindOf = v => v.components.vehicle.kind ?? MOTION.find(k => v.components[k]) ?? 'vehicle';

/** Controls for a vehicle: the player's input when the player drives, else components.drive.control (AI). */
function controlsFor(rt, v) {
  const c = v.components.vehicle, driver = c?.occupants?.[0];
  const zero = { throttle: 0, steer: 0, brake: false, handbrake: false, boost: false, jump: false, up: false, down: false, pitch: 0, roll: 0 };
  if (!driver || c.destroyed) return zero;
  if (driver === 'player') {
    const inp = rt.input || {}, held = inp.held || {}, act = inp.actions || {}, dv = act.drive && typeof act.drive === 'object' ? act.drive : null;
    const mv = dv ? [dv.steer ?? 0, dv.throttle ?? 0] : inp.axes?.move || [0, 0];
    const throttle = clamp((mv[1] ?? 0) + (held.accelerate ? 1 : 0) - (held.reverse ? 1 : 0), -1, 1);
    const steer = clamp((mv[0] ?? 0) + (held.right ? 1 : 0) - (held.left ? 1 : 0), -1, 1);
    return { throttle, steer, pitch: mv[1] ?? 0, roll: mv[0] ?? 0, brake: Boolean(held.brake), handbrake: Boolean(held.handbrake || held.drift),
      boost: Boolean(act.boost || held.boost), jump: Boolean(act.jump || held.jump), up: Boolean(held.throttle_up || held.accelerate), down: Boolean(held.throttle_down || held.brake) };
  }
  return { ...zero, ...(v.components.drive?.control || {}) };
}

export default {
  id: ID,
  card: {
    intent: 'Vehicles anyone can enter and exit: seats (driver + passengers), carjacking NPC drivers, locked cars with theft attempts and alarms, ownership, hull damage with burning and explosion, fuel, horn and radio. Motion comes from gameplay.vehicle.car/boat/aircraft; AI drives by writing components.drive.control.',
    views: ['any'],
    params: {
      enterRange: { type: 'number', default: 3, min: 0.5, max: 50, unit: 'm', effect: 'how close an entity must be to enter' },
      theftDifficulty: { type: 'number', default: 0.3, min: 0, max: 1, effect: 'chance that breaking into a locked vehicle fails per attempt (failure trips the alarm)' },
      carjack: { type: 'boolean', default: true, effect: 'entering an NPC-driven vehicle pulls the driver out' },
      damage: { type: 'boolean', default: true, effect: 'crashes and effects damage vehicles' },
      crashSpeed: { type: 'number', default: 6, min: 0, max: 100, unit: 'm/s', effect: 'impact speed below which crashes do no damage' },
      crashDamage: { type: 'number', default: 2, min: 0, max: 100, unit: 'hp per m/s', effect: 'damage per m/s of impact above crashSpeed' },
      burnAt: { type: 'number', default: 0.25, min: 0, max: 1, effect: 'hull fraction at which a vehicle starts burning' },
      burnSec: { type: 'number', default: 4, min: 0, max: 60, unit: 's', effect: 'seconds a burning vehicle lasts before it is destroyed' },
      ejectOnDestroy: { type: 'boolean', default: true, effect: 'occupants are thrown out when the vehicle is destroyed' },
      onDestroyed: { type: 'effects', default: [], effect: 'run when a vehicle is destroyed; self = the vehicle, $driver = its last driver' },
      exitOffset: { type: 'number', default: 1.5, min: 0, max: 20, unit: 'm', effect: 'how far beside the vehicle occupants step out' },
      fuelUse: { type: 'number', default: 0.1, min: 0, max: 100, unit: 'fuel/s', effect: 'fuel burned per second at full throttle (archetype vehicle.fuelUse overrides)' },
      stations: { type: 'list', of: { type: 'string' }, default: [], effect: 'radio stations cycled by the radio action' },
      plane: { type: 'string', options: ['auto', 'xz', 'xy'], default: 'auto', effect: 'ground plane used for exit offsets' },
    },
    provides: {
      events: ['vehicle_entered', 'vehicle_entered:*', 'vehicle_exited', 'vehicle_destroyed', 'vehicle_destroyed:*', 'vehicle_stolen', 'vehicle_damaged', 'vehicle_burning', 'vehicle_locked', 'vehicle_alarm', 'out_of_fuel', 'horn', 'radio_changed', 'carjacked'],
      vars: ['vehicle.in', 'vehicle.hp', 'vehicle.fuel', 'vehicle.speed', 'vehicle.radio'],
      services: ['vehicles'],
      actions: ['enter_vehicle', 'exit_vehicle', 'horn', 'radio'],
    },
    requires: { capabilities: ['position'] },
    reads: ['content.archetypes'],
  },
  logic(logic) {
    logic.predicate('in_vehicle', {
      test: (p, rt, c) => {
        const who = rt.resolve(p.who, c), seat = who?.components.seat;
        if (!seat) return p.in_vehicle === false;
        const v = rt.entity(seat.vehicle); if (!v) return p.in_vehicle === false;
        const ok = (!p.vehicle || matches(v, p.vehicle)) && (!p.kind || p.kind === kindOf(v) || p.kind === v.archetype)
          && (p.seat === undefined || (p.seat === 'driver' ? seat.seat === 0 : p.seat === 'passenger' ? seat.seat > 0 : seat.seat === p.seat));
        return p.in_vehicle === false ? !ok : ok;
      },
    });
    const svc = rt => rt.service('vehicles');
    logic.effect('enter_vehicle', { check: (e, path, errors) => needFields(e, ['vehicle'], path, errors), run: (e, rt, c) => { const who = rt.resolve(e.who, c); if (who) svc(rt).enter(who, e.vehicle, { seat: e.seat, force: e.force }); } });
    logic.effect('exit_vehicle', { run: (e, rt, c) => { const who = rt.resolve(e.who, c); if (who) svc(rt).exit(who); } });
    const target = (e, rt, c) => (e.vehicle ? rt.entity(e.vehicle) : rt.entity(rt.resolve(e.who, c)?.components.seat?.vehicle));
    logic.effect('damage_vehicle', { check: (e, path, errors) => needFields(e, ['amount'], path, errors), run: (e, rt, c) => { const v = target(e, rt, c); if (v) svc(rt).damage(v, e.amount, { cause: e.cause || 'effect' }); } });
    logic.effect('repair_vehicle', { run: (e, rt, c) => { const v = target(e, rt, c); if (v) svc(rt).repair(v, e.amount); } });
    logic.effect('refuel_vehicle', { run: (e, rt, c) => { const v = target(e, rt, c); if (v) svc(rt).refuel(v, e.amount); } });
    logic.effect('lock_vehicle', { run: (e, rt, c) => { const v = target(e, rt, c); if (v?.components.vehicle) { ensure(v).locked = e.locked ?? true; if (e.owner !== undefined) v.components.vehicle.owner = e.owner; } } });
  },
  validate(config, doc) {
    const errors = [];
    (doc.content?.archetypes || []).forEach((a, i) => {
      const v = a.components?.vehicle; if (!v) return;
      const path = `content.archetypes[${i}].components.vehicle`;
      if (v.seats !== undefined && (!Number.isInteger(v.seats) || v.seats < 1 || v.seats > 64)) errors.push(err('vehicle_invalid', `${path}.seats`, 'seats must be an integer 1..64'));
      if (v.health !== undefined && !(v.health > 0)) errors.push(err('vehicle_invalid', `${path}.health`, 'health must be > 0'));
      if (v.fuel !== undefined && !(v.fuel >= 0)) errors.push(err('vehicle_invalid', `${path}.fuel`, 'fuel must be >= 0 (0 = no fuel system)'));
    });
    return errors;
  },
  install(rt, config) {
    const vehicles = () => sortedEntities(rt).filter(e => e.components.vehicle);
    const seatedVehicle = who => rt.entity(who?.components.seat?.vehicle) || null;

    const exitPos = (v, side) => {
      const api = spaceOf(rt, v); if (!Array.isArray(v.at)) return v.at;
      const plane = planeFor(config.plane, api, v), h = v.components.drive?.heading ?? 0;
      const o = config.exitOffset * side, d = fromPlane(plane, -Math.sin(h) * o, Math.cos(h) * o, 0, v.at.length);
      return v.at.map((x, i) => r6(x + (d[i] ?? 0)));
    };

    const service = {
      ensure, kindOf,
      vehicleOf: who => seatedVehicle(typeof who === 'string' ? rt.entity(who) : who),
      driver: v => ensure(v).occupants[0],
      occupants: v => ensure(v).occupants.filter(Boolean),
      control: v => controlsFor(rt, v),
      canDrive: v => { const c = ensure(v); return !c.destroyed && c.occupants[0] != null && (c.tank === 0 || c.fuelLeft > 0); },
      /** Burn fuel for |throttle| over dt; returns false when the tank is empty. */
      consume(v, throttle, dt) {
        const c = ensure(v); if (c.tank === 0) return true;
        if (c.fuelLeft <= 0) return false;
        c.fuelLeft = r6(Math.max(0, c.fuelLeft - Math.abs(throttle) * (c.fuelUse ?? config.fuelUse) * dt));
        if (c.fuelLeft === 0) rt.emit('out_of_fuel', { vehicle: v.id, who: c.occupants[0] });
        return true;
      },
      refuel(v, amount) { const c = ensure(v); c.fuelLeft = r6(Math.min(c.tank, c.fuelLeft + (amount ?? c.tank))); },
      repair(v, amount) { const c = ensure(v); if (c.destroyed) return; c.hp = r6(Math.min(c.max, c.hp + (amount ?? c.max))); if (c.hp > c.max * config.burnAt) c.burning = 0; },
      damage(v, amount, { cause = 'damage', by = null } = {}) {
        const c = ensure(v); if (!config.damage || c.destroyed || !(amount > 0)) return;
        c.hp = r6(Math.max(0, c.hp - amount));
        rt.emit('vehicle_damaged', { vehicle: v.id, amount: r6(amount), hp: c.hp, cause, by });
        if (c.hp <= 0) service.destroy(v);
        else if (!c.burning && c.hp <= c.max * config.burnAt && config.burnSec > 0) { c.burning = Math.round(config.burnSec * 60); rt.emit('vehicle_burning', { vehicle: v.id }); }
      },
      /** Impact from a motion primitive: damage above crashSpeed, passed to occupants as an event. */
      crash(v, speed) {
        if (speed > config.crashSpeed) service.damage(v, (speed - config.crashSpeed) * config.crashDamage, { cause: 'crash' });
      },
      destroy(v) {
        const c = ensure(v); if (c.destroyed) return;
        const driver = c.occupants[0];
        c.destroyed = true; c.hp = 0; c.burning = 0;
        if (config.ejectOnDestroy) for (const id of c.occupants.filter(Boolean)) { const o = rt.entity(id); if (o) service.exit(o, { forced: true }); }
        rt.emitTyped('vehicle_destroyed', v.archetype, { vehicle: v.id, who: driver });
        if (config.onDestroyed.length) rt.run(bindRoles(config.onDestroyed, { driver: driver ?? v.id, actor: v.id }), { self: v.id });
      },
      /** Seat `who` in vehicle (id or archetype: nearest in range). Returns true on success. */
      enter(who, vehicleSel, { seat, force = false } = {}) {
        if (who.components.seat) return false;
        let v = rt.entity(vehicleSel);
        if (!v || !v.components.vehicle) v = service.nearest(who, vehicleSel);
        if (!v || !v.components.vehicle || v.space !== who.space) return false;
        const c = ensure(v);
        if (c.destroyed) return false;
        if (!force && dist(rt, who, v) > config.enterRange) return false;
        let s = seat ?? (c.occupants[0] == null ? 0 : -1);
        if (s === -1) {
          const npcDriver = c.occupants[0] && c.occupants[0] !== who.id ? rt.entity(c.occupants[0]) : null;
          if (seat === undefined && config.carjack && npcDriver && who.id === 'player') {
            service.exit(npcDriver, { forced: true });
            rt.emit('carjacked', { vehicle: v.id, who: who.id, victim: npcDriver.id });
            rt.emit('vehicle_stolen', { vehicle: v.id, who: who.id, owner: c.owner, carjack: true });
            c.owner = who.id; s = 0;
          } else s = c.occupants.findIndex((o, i) => i > 0 && o == null);
        }
        if (s < 0 || s >= c.occupants.length || c.occupants[s] != null) return false;
        if (s === 0 && !force) {
          if (c.locked && c.owner !== who.id) {
            if (rt.random() < config.theftDifficulty) { rt.emit('vehicle_locked', { vehicle: v.id, who: who.id }); rt.emit('vehicle_alarm', { vehicle: v.id, who: who.id }); return false; }
            c.locked = false;
            rt.emit('vehicle_stolen', { vehicle: v.id, who: who.id, owner: c.owner, carjack: false }); c.owner = who.id;
          } else if (c.owner && c.owner !== who.id && !rt.entity(c.owner)?.components.seat) {
            rt.emit('vehicle_stolen', { vehicle: v.id, who: who.id, owner: c.owner, carjack: false }); c.owner = who.id;
          }
        }
        c.occupants[s] = who.id;
        who.components.seat = { vehicle: v.id, seat: s };
        if (who.components.body?.vel) who.components.body.vel = who.components.body.vel.map(() => 0);
        rt.space(v.space).setPos(who, Array.isArray(v.at) ? v.at.slice() : v.at, rt);
        rt.emitTyped('vehicle_entered', v.archetype, { who: who.id, vehicle: v.id, seat: s });
        return true;
      },
      exit(who, { forced = false } = {}) {
        const v = seatedVehicle(who); if (!v) { delete who.components.seat; return false; }
        const c = ensure(v), s = who.components.seat.seat;
        c.occupants[s] = null; delete who.components.seat;
        const api = spaceOf(rt, v);
        if (api && who.space === v.space) api.setPos(who, exitPos(v, s % 2 === 0 ? -1 : 1), rt);
        rt.emit('vehicle_exited', { who: who.id, vehicle: v.id, seat: s, forced });
        return true;
      },
      nearest(who, sel) {
        let best = null, bd = Infinity;
        for (const v of vehicles()) {
          if (v.space !== who.space || (sel && sel !== true && !matches(v, sel)) || ensure(v).destroyed) continue;
          const d = dist(rt, who, v); if (d < bd) { bd = d; best = v; }
        }
        return bd <= config.enterRange ? best : null;
      },
    };
    rt.provide('vehicles', service);

    rt.action('enter_vehicle', (value, rt) => { const p = rt.player(); if (p) service.enter(p, typeof value === 'string' ? value : true); });
    rt.action('exit_vehicle', (value, rt) => { const p = rt.player(); if (p) service.exit(p); });
    rt.action('horn', (value, rt) => { const v = seatedVehicle(rt.player()); if (v) rt.emit('horn', { vehicle: v.id, who: 'player' }); });
    rt.action('radio', (value, rt) => {
      const v = seatedVehicle(rt.player()); if (!v || !config.stations.length) return;
      const s = rt.store(ID); s.radio = typeof value === 'string' && config.stations.includes(value) ? config.stations.indexOf(value) : ((s.radio ?? -1) + 1) % config.stations.length;
      rt.state.vars['vehicle.radio'] = config.stations[s.radio];
      rt.emit('radio_changed', { station: config.stations[s.radio] });
    });

    // Burning, destruction by combat.health, occupants riding along, player vars.
    rt.system('late', rt => {
      for (const v of vehicles()) {
        const c = ensure(v);
        if (!c.destroyed && v.components.health && !alive(v)) service.destroy(v);
        if (c.burning > 0 && !c.destroyed && --c.burning === 0) service.destroy(v);
        for (const id of c.occupants) {
          if (!id) continue;
          const o = rt.entity(id);
          if (!o) { c.occupants[c.occupants.indexOf(id)] = null; continue; }
          if (o.space !== v.space) rt.moveToSpace(o, v.space, Array.isArray(v.at) ? v.at.slice() : v.at);
          else if (JSON.stringify(o.at) !== JSON.stringify(v.at)) rt.space(v.space).setPos(o, Array.isArray(v.at) ? v.at.slice() : v.at, rt);
        }
      }
      const p = rt.player(), v = seatedVehicle(p), vars = rt.state.vars;
      vars['vehicle.in'] = v ? 1 : 0;
      vars['vehicle.hp'] = v ? v.components.vehicle.hp : 0;
      vars['vehicle.fuel'] = v ? v.components.vehicle.fuelLeft : 0;
      vars['vehicle.speed'] = v ? r6(Math.abs(v.components.drive?.speed ?? 0)) : 0;
    }, ID);

    rt.options(rt => {
      const p = rt.player(); if (!p) return [];
      if (p.components.seat) return [{ label: 'exit vehicle', actions: { exit_vehicle: true } }];
      const v = service.nearest(p, true);
      return v ? [{ label: `enter ${v.id}`, actions: { enter_vehicle: v.id } }] : [];
    });
  },
};

export { controlsFor, ensure as ensureVehicle, kindOf as vehicleKind };
