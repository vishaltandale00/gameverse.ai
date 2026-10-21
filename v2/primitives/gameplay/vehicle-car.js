// gameplay.vehicle.car: wheeled handling for any continuous space.
// Presets: arcade (forgiving grip, handbrake slides), sim (friction circle,
// gearbox, aero drag, sliding past the grip limit) and kart (hop-drift with
// mini-turbo tiers). Per-archetype spec in components.car:
//   { maxSpeed km/h, accel m/s², grip 0..2, mass kg, steer deg, brake ×,
//     drift b, boost {sec, mult, cooldown}, rail b, lean b, preset?, wheelbase? m }
// Terrain: follows surface/gravity (ramps launch, landings hurt), surface
// materials change grip/drag/top speed, deep water stalls the engine. Rail
// cars follow rail cells (editCells) and pick branches with steering.
import { cellPos, has, planeFor, clamp, KMH, DEG, sign, approach, r6, err, cellKey } from './modes-lib-util.js';
import { initDrive, reproject, moveVehicle, resolveBlock, publish, material, waterDepth, motionVehicles } from './modes-lib-drive.js';

const ID = 'gameplay.vehicle.car';
export const CAR_PRESETS = {
  arcade: { gripK: 9, driftGrip: 0.3, steerFalloff: 0.03, rolling: 0.6, aero: 0.0008, reverse: 0.35, brakeDecel: 16, driftSteer: 1.25, airControl: 0.15, frictionCircle: false, gears: 0, hop: 0, tiers: [] },
  sim: { gripK: 0, driftGrip: 0.65, steerFalloff: 0.045, rolling: 0.25, aero: 0.0012, reverse: 0.25, brakeDecel: 11, driftSteer: 1, airControl: 0, frictionCircle: true, mu: 1, gears: 6, hop: 0, tiers: [] },
  kart: { gripK: 14, driftGrip: 0.5, steerFalloff: 0.01, rolling: 0.8, aero: 0.0005, reverse: 0.4, brakeDecel: 20, driftSteer: 1.45, airControl: 0.3, frictionCircle: false, gears: 0, hop: 2.4, tiers: [[0.7, 0.6], [1.4, 1.1], [2.2, 1.6]] },
};
const SPEC = { maxSpeed: 120, accel: 12, grip: 1, mass: 1200, steer: 32, brake: 1, drift: false, boost: null, rail: false, lean: false, wheelbase: 2.6 };

export default {
  id: ID,
  card: {
    intent: 'Wheeled vehicle handling (cars, bikes, karts, minecarts) over any continuous space: throttle, brake, reverse, steering with speed falloff, grip and lateral slide, handbrake drifts, boosts and kart drift mini-turbos, gearbox (sim), ramp jumps and landings, surface grip, water stalls, wall crashes that damage the hull, bike lean and rail following.',
    views: ['1p', '3p', 'td', 'iso', 'side'],
    params: {
      preset: { type: 'string', options: ['arcade', 'sim', 'kart'], default: 'arcade', effect: 'handling model; archetype car.preset overrides' },
      plane: { type: 'string', options: ['auto', 'xz', 'xy'], default: 'auto', effect: 'ground plane: xz = 3D y-up, xy = 2D top-down; auto from the space' },
      surfaces: { type: 'object', open: true, default: {}, effect: 'material id -> {grip, drag, maxSpeed} multipliers (e.g. sand {grip:0.6, drag:3, maxSpeed:0.6})' },
      stallDepth: { type: 'number', default: 0.6, min: 0, max: 10, unit: 'm', effect: 'water deeper than this floods the engine' },
      restitution: { type: 'number', default: 0.2, min: 0, max: 1, effect: 'bounce off walls' },
      crashEvent: { type: 'number', default: 2, min: 0, max: 100, unit: 'm/s', effect: 'impacts above this emit crash' },
      landingDamage: { type: 'number', default: 9, min: 0, max: 200, unit: 'm/s', effect: 'vertical landing speed above which landings count as crashes' },
      maxLean: { type: 'number', default: 45, min: 0, max: 80, unit: 'deg', effect: 'bike lean limit' },
      railBlocks: { type: 'list', of: { type: 'string' }, default: ['rail'], effect: 'cell ids rail cars may run on (cell or the one below)' },
      minDriftSpeed: { type: 'number', default: 6, min: 0, max: 100, unit: 'm/s', effect: 'speed needed to start a drift' },
    },
    actionSpace: { drive: { kind: 'continuous', params: { throttle: { min: -1, max: 1 }, steer: { min: -1, max: 1 } } } },
    provides: { events: ['crash', 'drift', 'drift_end', 'drift_boost', 'boost', 'landed', 'airborne', 'rail_end', 'stalled', 'gear'], vars: [] },
    requires: { capabilities: ['position'], primitives: ['gameplay.vehicle.core'] },
    reads: ['content.archetypes'],
    // A car for the player to drive from the first frame; AI participants get one with a steady throttle (the vehicle.core AI interface).
    engage: { player: { spawn: { role: 'vehicle', archetype: { id: 'car', kind: 'vehicle', components: { vehicle: { seats: 1, health: 100, fuel: 0 }, car: {} } } } },
      actors: { spawn: { role: 'vehicle', archetype: { id: 'car', kind: 'vehicle', components: { vehicle: { seats: 1, health: 100, fuel: 0 }, car: {} } }, components: { drive: { control: { throttle: 0.9 } } } } } },
  },
  validate(config, doc) {
    const errors = [];
    (doc.content?.archetypes || []).forEach((a, i) => {
      const c = a.components?.car; if (!c) return;
      const path = `content.archetypes[${i}].components.car`;
      if (!a.components.vehicle) errors.push(err('car_no_vehicle', path, `archetype '${a.id}' has car but no vehicle component`, 'add components.vehicle {seats, health, fuel}'));
      for (const k of ['maxSpeed', 'accel', 'mass']) if (c[k] !== undefined && !(c[k] > 0)) errors.push(err('car_invalid', `${path}.${k}`, `${k} must be > 0`));
      if (c.grip !== undefined && !(c.grip >= 0 && c.grip <= 2)) errors.push(err('car_invalid', `${path}.grip`, 'grip must be within 0..2'));
      if (c.steer !== undefined && !(c.steer >= 0 && c.steer <= 80)) errors.push(err('car_invalid', `${path}.steer`, 'steer must be within 0..80 deg'));
      if (c.preset !== undefined && !CAR_PRESETS[c.preset]) errors.push(err('car_invalid', `${path}.preset`, `unknown preset '${c.preset}'`, Object.keys(CAR_PRESETS).join('|')));
      if (c.boost && !(c.boost.sec > 0 && c.boost.mult >= 1)) errors.push(err('car_invalid', `${path}.boost`, 'boost needs sec > 0 and mult >= 1'));
    });
    return errors;
  },
  install(rt, config) {
    rt.system('movement', rt => {
      const svc = rt.service('vehicles'), dt = rt.dt;
      for (const v of motionVehicles(rt, 'car')) {
        const c = svc.ensure(v); if (c.destroyed) continue;
        const spec = { ...SPEC, ...v.components.car }, P = CAR_PRESETS[spec.preset] || CAR_PRESETS[config.preset];
        const api = rt.space(v.space), plane = planeFor(config.plane, api, v), d = initDrive(v);
        const ctl = svc.control(v), running = svc.canDrive(v);
        if (!running && Math.abs(d.vf) < 0.01 && Math.abs(d.vl) < 0.01 && !d.airborne) { if (d.vf || d.vl) { d.vf = 0; d.vl = 0; publish(v, plane, d); } continue; }
        let throttle = running ? ctl.throttle : 0;
        if (throttle && !svc.consume(v, throttle, dt)) throttle = 0;
        if (spec.rail && has(api, 'getCell')) { stepRail(rt, v, api, plane, d, spec, P, ctl, throttle, config, dt, svc); continue; }

        // Surface and water.
        const mat = material(api, plane, v.at), surf = { grip: 1, drag: 1, maxSpeed: 1, ...(config.surfaces[mat] || {}) };
        const deep = waterDepth(api, plane, v.at) > config.stallDepth;
        if (deep) { if (!d.stalled) rt.emit('stalled', { vehicle: v.id }); d.stalled = true; throttle = 0; } else d.stalled = false;

        // Boost (item or archetype boost, and kart drift mini-turbos).
        d.boostT = Math.max(0, (d.boostT ?? 0) - dt); d.boostCd = Math.max(0, (d.boostCd ?? 0) - dt);
        if (ctl.boost && spec.boost && d.boostCd <= 0 && running) { d.boostT = spec.boost.sec; d.boostCd = spec.boost.cooldown ?? 0; rt.emit('boost', { vehicle: v.id, sec: spec.boost.sec }); }
        const boostMult = d.boostT > 0 ? (spec.boost?.mult ?? 1.3) : 1;
        const maxV = spec.maxSpeed * KMH * surf.maxSpeed * boostMult;

        // Longitudinal: engine, gears, brakes, reverse, drag.
        let accel = spec.accel * (d.boostT > 0 ? 1.5 : 1);
        if (P.gears) {
          const gear = clamp(Math.floor(Math.abs(d.vf) / (maxV / P.gears)) + 1, 1, P.gears);
          if (gear !== d.gear) { d.gear = gear; rt.emit('gear', { vehicle: v.id, gear }); }
          accel *= 1.6 / (0.6 + gear * 0.5);
        }
        if (!d.airborne) {
          if (throttle > 0) {
            if (d.vf < -0.5) d.vf = approach(d.vf, 0, P.brakeDecel * spec.brake * throttle * dt);
            else d.vf += accel * throttle * Math.max(0, 1 - (d.vf / maxV) ** 2) * dt;
          } else if (throttle < 0) {
            if (d.vf > 0.5) d.vf = approach(d.vf, 0, P.brakeDecel * spec.brake * -throttle * dt);
            else d.vf -= accel * -throttle * Math.max(0, 1 - (d.vf / (maxV * P.reverse)) ** 2) * dt;
          }
          if (ctl.brake) d.vf = approach(d.vf, 0, P.brakeDecel * spec.brake * dt);
          const drag = (P.rolling * surf.drag + P.aero * d.vf * d.vf + (deep ? 6 : 0)) * dt;
          d.vf = approach(d.vf, 0, drag);
          if (d.vf > maxV) d.vf = approach(d.vf, maxV, 8 * dt); // shed speed after a boost ends
        }

        // Drift state machine.
        const canDrift = spec.drift || spec.preset === 'kart' || (!spec.preset && config.preset === 'kart');
        const wantDrift = canDrift && ctl.handbrake && Math.abs(d.vf) > config.minDriftSpeed && !d.airborne;
        if (wantDrift && !d.drifting && Math.abs(ctl.steer) > 0.2) {
          d.drifting = true; d.driftT = 0; d.driftDir = sign(ctl.steer);
          if (P.hop && plane === 'xz') { d.vy = P.hop; d.airborne = true; }
          rt.emit('drift', { vehicle: v.id, dir: d.driftDir });
        } else if (d.drifting && (!ctl.handbrake || Math.abs(d.vf) < config.minDriftSpeed * 0.5)) {
          d.drifting = false;
          const tier = P.tiers.filter(([sec]) => d.driftT >= sec).length;
          rt.emit('drift_end', { vehicle: v.id, sec: r6(d.driftT), tier });
          if (tier && ctl.handbrake === false) { d.boostT = Math.max(d.boostT, P.tiers[tier - 1][1]); rt.emit('drift_boost', { vehicle: v.id, tier, sec: P.tiers[tier - 1][1] }); }
        }
        if (d.drifting) d.driftT = r6((d.driftT ?? 0) + dt);

        // Steering: geometric yaw with speed falloff; bikes steer through lean.
        const h0 = d.heading;
        let steer = ctl.steer;
        if (d.drifting) steer = clamp(steer * P.driftSteer * 0.6 + d.driftDir * 0.55, -P.driftSteer, P.driftSteer);
        const angle = steer * spec.steer * DEG / (1 + P.steerFalloff * Math.abs(d.vf));
        let yaw = -d.vf / spec.wheelbase * Math.tan(angle);
        if (spec.lean) {
          const target = -ctl.steer * config.maxLean * DEG * clamp(Math.abs(d.vf) / 8, 0, 1);
          d.lean = r6(approach(d.lean ?? 0, target, 2.5 * dt));
          yaw = 9.81 * Math.tan(d.lean) / Math.max(Math.abs(d.vf), 2) * sign(d.vf) * clamp(Math.abs(d.vf) / 2, 0, 1);
        }
        if (d.airborne) yaw *= P.airControl;
        d.heading = h0 + yaw * dt;
        reproject(d, h0, d.heading);

        // Lateral grip: exponential (arcade/kart) or friction circle (sim).
        const g = spec.grip * surf.grip * (ctl.handbrake || d.drifting ? P.driftGrip : 1);
        if (!d.airborne) {
          if (P.frictionCircle) {
            const avail = P.mu * g * 9.81 * dt;
            d.sliding = Math.abs(d.vl) > avail;
            d.vl = Math.abs(d.vl) <= avail ? 0 : d.vl - sign(d.vl) * avail;
          } else d.vl *= Math.exp(-P.gripK * g * dt);
        }

        // Integrate, collide, land.
        const wasAir = d.airborne;
        const hit = moveVehicle(rt, v, api, plane, d, dt);
        if (hit.tookOff) rt.emit('airborne', { vehicle: v.id });
        if (hit.landed && wasAir) {
          rt.emit('landed', { vehicle: v.id, speed: r6(hit.impactY) });
          if (hit.impactY > config.landingDamage) { rt.emit('crash', { vehicle: v.id, speed: r6(hit.impactY), kind: 'landing' }); svc.crash(v, hit.impactY); }
        }
        const impact = resolveBlock(d, hit, config.restitution);
        if (impact > config.crashEvent) { rt.emit('crash', { vehicle: v.id, speed: r6(impact), kind: 'wall', who: c.occupants[0] }); svc.crash(v, impact); }
        publish(v, plane, d);
      }
    }, ID);
  },
};

// Rail following: the car moves cell to cell along rail cells. At each cell it
// keeps going straight when it can, otherwise turns; steering picks the branch
// at junctions. Slopes up and down one cell are followed. No rail ahead: stop.
function stepRail(rt, v, api, plane, d, spec, P, ctl, throttle, config, dt, svc) {
  const isRail = cell => { const b = api.getCell(cell), under = api.getCell([cell[0], cell[1] - 1, cell[2] ?? 0]); return config.railBlocks.includes(b) || (plane === 'xz' && config.railBlocks.includes(under)); };
  const maxV = spec.maxSpeed * KMH;
  if (throttle > 0) d.vf = Math.min(maxV, d.vf + spec.accel * throttle * dt);
  else if (throttle < 0 || ctl.brake) d.vf = approach(d.vf, 0, P.brakeDecel * dt);
  d.vf = approach(d.vf, 0, P.rolling * 0.3 * dt); d.vl = 0;
  const dir = d.railDir ?? [Math.round(Math.cos(d.heading)), Math.round(Math.sin(d.heading))];
  d.railDir = dir;
  d.railP = (d.railP ?? 0) + Math.abs(d.vf) * dt * sign(d.vf || 1);
  const to3 = (u, w) => (plane === 'xz' ? [u, 0, w] : [u, w, 0]);
  while (Math.abs(d.railP) >= 1) {
    const back = d.railP < 0, s = back ? -1 : 1, here = v.at.map(Math.floor);
    const fwd = [dir[0] * s, dir[1] * s];
    const left = [-fwd[1], fwd[0]], right = [fwd[1], -fwd[0]];
    const pref = ctl.steer > 0.3 ? [right, fwd, left] : ctl.steer < -0.3 ? [left, fwd, right] : [fwd, left, right];
    let next = null;
    for (const o of pref) for (const dy of [0, 1, -1]) {
      if (next) break;
      const off = to3(o[0], o[1]); if (plane === 'xz') off[1] = dy; else if (dy) continue;
      const cell = here.map((x, i) => x + (off[i] ?? 0));
      if (isRail(cell)) next = { cell, o };
    }
    if (!next) { d.vf = 0; d.railP = 0; rt.emit('rail_end', { vehicle: v.id, at: here }); break; }
    api.setPos(v, cellPos(api, next.cell), rt);
    d.railDir = [next.o[0] * s, next.o[1] * s];
    d.heading = Math.atan2(d.railDir[1], d.railDir[0]);
    d.railP -= s;
    d.railCell = cellKey(next.cell);
  }
  publish(v, plane, d);
}
