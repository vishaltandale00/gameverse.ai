// gameplay.vehicle.aircraft: simplified fixed-wing (and, with vtol, rotor)
// flight. Persistent throttle, thrust against quadratic drag, gravity along
// the flight path (climbing bleeds speed), takeoff roll and rotation, banked
// turns (yaw rate = g·tan(bank)/v), stalls below stall speed, a ceiling, and
// landings judged by sink rate, speed and bank: soft ones land, hard ones crash.
// Archetype components.aircraft: { stall km/h, maxSpeed km/h, climb m/s, turn deg/s, takeoffSpeed km/h, vtol? b }.
// Controls: move[1] pitch, move[0] bank; held throttle_up/accelerate, throttle_down/brake.
import { footOffset, has, planeFor, clamp, KMH, DEG, sign, approach, r6, err } from './modes-lib-util.js';
import { initDrive, publish, gravityY, motionVehicles } from './modes-lib-drive.js';

const ID = 'gameplay.vehicle.aircraft';
const SPEC = { stall: 50, maxSpeed: 200, climb: 8, turn: 30, takeoffSpeed: 70, vtol: false };

export default {
  id: ID,
  card: {
    loop: { verbs: [], progress: ['airborne', 'landed'] },
    intent: 'Aircraft flight: throttle, takeoff roll and rotation, pitch and banked turns, climb limits, stalls, a ceiling, and landings that succeed when slow, level and gentle or crash otherwise. vtol aircraft hover (helicopters, drones).',
    views: ['1p', '3p', 'side'],
    params: {
      plane: { type: 'string', options: ['auto', 'xz', 'xy'], default: 'auto', effect: 'xz = 3D flight over terrain; xy = side view (x forward, y up)' },
      ceiling: { type: 'number', default: 400, min: 1, max: 20000, unit: 'm', effect: 'maximum altitude' },
      maxBank: { type: 'number', default: 60, min: 5, max: 85, unit: 'deg', effect: 'bank limit' },
      throttleRate: { type: 'number', default: 0.5, min: 0.05, max: 5, unit: '/s', effect: 'how fast throttle moves' },
      safeSink: { type: 'number', default: 3.5, min: 0, max: 30, unit: 'm/s', effect: 'max sink rate for a safe landing' },
      crashDamage: { type: 'number', default: 8, min: 0, max: 500, unit: 'hp per m/s', effect: 'damage per m/s of a hard landing' },
    },
    actionSpace: { drive: { kind: 'continuous', params: { throttle: { min: -1, max: 1 }, steer: { min: -1, max: 1 } } } },
    provides: { events: ['airborne', 'landed', 'stall', 'stall_recovered', 'crash'] },
    requires: { capabilities: ['position'], primitives: ['gameplay.vehicle.core'] },
    reads: ['content.archetypes'],
    engage: { player: { spawn: { role: 'vehicle', archetype: { id: 'aircraft', kind: 'vehicle', components: { vehicle: { seats: 1, health: 100, fuel: 0 }, aircraft: {} } } } },
      actors: { spawn: { role: 'vehicle', archetype: { id: 'aircraft', kind: 'vehicle', components: { vehicle: { seats: 1, health: 100, fuel: 0 }, aircraft: {} } }, components: { drive: { control: { up: true, pitch: 0.3 } } } } } },
  },
  validate(config, doc) {
    const errors = [];
    (doc.content?.archetypes || []).forEach((a, i) => {
      const s = a.components?.aircraft; if (!s) return;
      const path = `content.archetypes[${i}].components.aircraft`;
      if (!a.components.vehicle) errors.push(err('aircraft_no_vehicle', path, `archetype '${a.id}' has aircraft but no vehicle component`));
      const q = { ...SPEC, ...s };
      if (!(q.maxSpeed > q.stall)) errors.push(err('aircraft_invalid', `${path}.maxSpeed`, 'maxSpeed must exceed stall speed'));
      if (!q.vtol && !(q.takeoffSpeed >= q.stall)) errors.push(err('aircraft_invalid', `${path}.takeoffSpeed`, 'takeoffSpeed must be >= stall speed (or set vtol)'));
    });
    return errors;
  },
  install(rt, config) {
    const groundAt = (api, plane, at, e) => {
      if (plane === 'xz' && has(api, 'groundAt')) return api.groundAt(at[0], at[2]).y + footOffset(api, e);
      if (has(api, 'raycast')) { const r = api.raycast(at, [0, -1, 0], 1000); if (r.hit !== 'none') return at[1] - r.dist + footOffset(api, e); }
      return 0;
    };
    rt.system('movement', rt => {
      const svc = rt.service('vehicles'), dt = rt.dt;
      for (const v of motionVehicles(rt, 'aircraft')) {
        const c = svc.ensure(v); if (c.destroyed) continue;
        const spec = { ...SPEC, ...v.components.aircraft }, api = rt.space(v.space), plane = planeFor(config.plane, api, v), d = initDrive(v);
        d.pitch ??= 0; d.bank ??= 0; d.throttle ??= 0; d.airborne ??= false;
        const ctl = svc.control(v), running = svc.canDrive(v);
        const g = -gravityY(api, v.at), maxV = spec.maxSpeed * KMH, stallV = spec.stall * KMH;
        if (running) d.throttle = clamp(d.throttle + ((ctl.up ? 1 : 0) - (ctl.down ? 1 : 0)) * config.throttleRate * dt, 0, 1);
        else d.throttle = approach(d.throttle, 0, config.throttleRate * dt);
        if (d.throttle && !svc.consume(v, d.throttle, dt)) d.throttle = 0;
        const thrust = (maxV / 6) * d.throttle, k = (maxV / 6) / (maxV * maxV);
        let vy = 0;
        if (spec.vtol) {
          // Rotorcraft: throttle is collective lift, pitch tilts the disc forward.
          d.vf = approach(d.vf, ctl.pitch * maxV * d.throttle, maxV / 4 * dt);
          vy = (d.throttle - 0.5) * 2 * spec.climb;
          if (!running) vy = -spec.climb;
          d.bank = approach(d.bank, -ctl.roll * config.maxBank * DEG * 0.5, 1.5 * dt);
          d.heading += -ctl.roll * spec.turn * DEG * dt;
          if (!d.airborne && vy > 0.1) { d.airborne = true; rt.emit('airborne', { vehicle: v.id }); }
        } else if (!d.airborne) {
          // Takeoff roll: rotate (pull up) above takeoff speed.
          d.vf += (thrust - k * d.vf * d.vf - (ctl.brake && !ctl.up ? 6 : 0.4) * sign(d.vf)) * dt;
          d.vf = Math.max(0, d.vf); d.pitch = 0; d.bank = 0;
          if (plane === 'xz') d.heading += -ctl.roll * 0.6 * clamp(d.vf / 5, 0, 1) * dt; // tail-wheel steering
          if (d.vf >= spec.takeoffSpeed * KMH && ctl.pitch > 0.2) { d.airborne = true; d.pitch = 0.08; vy = Math.max(0.5, d.vf * Math.sin(d.pitch)); rt.emit('airborne', { vehicle: v.id, speed: r6(d.vf) }); }
        } else {
          d.vf += (thrust - k * d.vf * d.vf - g * Math.sin(d.pitch)) * dt;
          const stalled = d.vf < stallV;
          if (stalled && !d.stalled) { d.stalled = true; rt.emit('stall', { vehicle: v.id }); }
          if (!stalled && d.stalled) { d.stalled = false; rt.emit('stall_recovered', { vehicle: v.id }); }
          if (d.stalled) d.pitch = approach(d.pitch, -0.35, 0.6 * dt);
          else d.pitch = clamp(d.pitch + ctl.pitch * 0.9 * dt, -0.6, 0.6);
          d.bank = approach(d.bank, plane === 'xz' ? -ctl.roll * config.maxBank * DEG : 0, 1.2 * dt);
          const yaw = clamp(g * Math.tan(d.bank) / Math.max(d.vf, 1), -spec.turn * DEG, spec.turn * DEG);
          d.heading += yaw * dt;
          vy = d.stalled ? Math.max(-g * 2, (d.vyLast ?? 0) - g * dt) : clamp(d.vf * Math.sin(d.pitch), -spec.climb * 3, spec.climb);
          d.vf = Math.max(0, d.vf);
        }
        d.vyLast = vy;
        // Integrate (no collide-and-slide in the air: terrain contact is a landing or a crash).
        const hs = spec.vtol ? d.vf : d.vf * Math.cos(d.pitch);
        const f = [Math.cos(d.heading), Math.sin(d.heading)];
        const at = v.at.slice();
        if (plane === 'xz') { at[0] += f[0] * hs * dt; at[2] += f[1] * hs * dt; } else at[0] += (f[0] >= 0 ? 1 : -1) * hs * dt;
        at[1] = Math.min(config.ceiling, at[1] + vy * dt);
        const floor = groundAt(api, plane, at, v);
        if (at[1] <= floor && vy <= 0) {
          at[1] = floor;
          if (d.airborne) {
            const sink = -vy, soft = sink <= config.safeSink && Math.abs(d.bank) < 0.35 && (spec.vtol || d.vf <= spec.takeoffSpeed * KMH * 1.4);
            d.airborne = false; d.stalled = false; d.pitch = 0;
            if (soft) rt.emit('landed', { vehicle: v.id, sink: r6(sink), who: c.occupants[0] });
            else { rt.emit('crash', { vehicle: v.id, speed: r6(Math.max(sink, d.vf * 0.3)), kind: 'landing' }); svc.damage(v, Math.max(sink, d.vf * 0.3) * config.crashDamage, { cause: 'crash' }); d.vf *= 0.3; }
          }
          vy = 0;
        }
        if (at[1] < floor) at[1] = floor;
        api.setPos(v, at.map(r6), rt);
        d.vy = vy; d.vl = 0;
        for (const key of ['pitch', 'bank', 'throttle']) d[key] = r6(d[key]);
        d.altitude = r6(at[1] - floor);
        publish(v, plane, d);
      }
    }, ID);
  },
};
