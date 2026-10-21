// gameplay.vehicle.boat: displacement and planing boats on any space with water.
// Buoyancy holds the hull at the waterline (with deterministic swell bob),
// thrust fights quadratic water drag that drops once the hull planes, the
// rudder needs flow, the keel resists sideways slip, shallow water beaches the
// hull, and coming to rest in a dock zone (or near a dock archetype) docks it.
// Archetype components.boat: { maxSpeed km/h, accel m/s², turn deg/s, drag, draft m, planing km/h }.
import { ENTITY_KINDS } from '../../kernel/params.js';
import { footOffset, has, planeFor, planeUW, clamp, KMH, DEG, sign, approach, r6, err, matchesAny, dist, sortedEntities } from './modes-lib-util.js';
import { initDrive, reproject, moveVehicle, resolveBlock, publish, motionVehicles } from './modes-lib-drive.js';

const ID = 'gameplay.vehicle.boat';
const SPEC = { maxSpeed: 60, accel: 8, turn: 35, drag: 0.7, draft: 0.4, planing: 35 };

export default {
  id: ID,
  card: {
    loop: { verbs: [], progress: ['docked', 'undocked'] },
    intent: 'Boat handling on water: buoyancy at the waterline with swell bob, planing above a speed, rudder authority that grows with flow, keel slip, beaching in shallows and docking in dock zones.',
    views: ['3p', 'td', 'iso'],
    params: {
      plane: { type: 'string', options: ['auto', 'xz', 'xy'], default: 'auto', effect: 'ground plane: xz = 3D y-up, xy = 2D top-down' },
      swell: { type: 'number', default: 0.15, min: 0, max: 3, unit: 'm', effect: 'bob amplitude at rest' },
      keel: { type: 'number', default: 2.5, min: 0, max: 20, effect: 'sideways slip damping' },
      docks: { type: 'list', of: { type: 'ref', to: 'zone' }, default: [], effect: 'zones where a stopped boat docks' },
      dockArchetypes: { type: 'list', of: { type: 'string', selects: ENTITY_KINDS }, default: [], effect: 'entities (archetype/tag) a stopped boat docks beside' },
      dockRange: { type: 'number', default: 3, min: 0, max: 50, unit: 'm', effect: 'range for dockArchetypes' },
      dockSpeed: { type: 'number', default: 0.6, min: 0, max: 10, unit: 'm/s', effect: 'speed below which a boat counts as stopped' },
    },
    actionSpace: { drive: { kind: 'continuous', params: { throttle: { min: -1, max: 1 }, steer: { min: -1, max: 1 } } } },
    provides: { events: ['docked', 'undocked', 'beached', 'refloated', 'crash'] },
    requires: { capabilities: ['position', 'surface'], primitives: ['gameplay.vehicle.core'] },
    reads: ['content.archetypes'],
    components: {
      boat: { type: 'object', effect: 'boat handling of a vehicle', fields: {
        maxSpeed: { type: 'number', min: 1, unit: 'km/h' }, accel: { type: 'number', min: 0.1, unit: 'm/s²' }, turn: { type: 'number', min: 0, unit: 'deg/s' },
        drag: { type: 'number', min: 0, effect: 'water drag' }, draft: { type: 'number', min: 0, unit: 'm', effect: 'depth the hull needs to float' }, planing: { type: 'number', min: 0, unit: 'km/h', effect: 'speed above which the hull planes' },
      } },
    },
    rules: {
      boat_no_vehicle: { fields: ['content.archetypes[].components.boat', 'content.archetypes[].components.vehicle'], message: 'an archetype with a boat component also has a vehicle component' },
    },
    // movement: the player's body moves by this primitive from the start: it moves the vehicle it spawns for the player,
    // which vehicle.core seats the player in (its engage.player.enter) and carries the player along (loop-check.js movesPlayer).
    engage: { player: { movement: true, spawn: { role: 'vehicle', archetype: { id: 'boat', kind: 'vehicle', components: { vehicle: { seats: 1, health: 100, fuel: 0 }, boat: {} } } } },
      actors: { spawn: { role: 'vehicle', archetype: { id: 'boat', kind: 'vehicle', components: { vehicle: { seats: 1, health: 100, fuel: 0 }, boat: {} } }, components: { drive: { control: { throttle: 0.9 } } } } } },
  },
  validate(config, doc) {
    const errors = [];
    (doc.content?.archetypes || []).forEach((a, i) => {
      const b = a.components?.boat; if (!b) return;
      const path = `content.archetypes[${i}].components.boat`;
      if (!a.components.vehicle) errors.push(err('boat_no_vehicle', path, `archetype '${a.id}' has boat but no vehicle component`));
    });
    return errors;
  },
  install(rt, config) {
    rt.system('movement', rt => {
      const svc = rt.service('vehicles'), dt = rt.dt;
      for (const v of motionVehicles(rt, 'boat')) {
        const c = svc.ensure(v); if (c.destroyed) continue;
        const spec = { ...SPEC, ...v.components.boat }, api = rt.space(v.space), plane = planeFor(config.plane, api, v), d = initDrive(v);
        const ctl = svc.control(v), running = svc.canDrive(v);
        let throttle = running ? ctl.throttle : 0;
        if (throttle && !svc.consume(v, throttle, dt)) throttle = 0;
        const [u, w] = planeUW(plane, v.at);
        const depth = has(api, 'waterDepthAt') ? api.waterDepthAt(u, w) || 0 : 0;
        const afloat = depth >= spec.draft;
        if (!afloat && !d.beached) { d.beached = true; rt.emit('beached', { vehicle: v.id }); }
        if (afloat && d.beached) { d.beached = false; rt.emit('refloated', { vehicle: v.id }); }
        const maxV = spec.maxSpeed * KMH;
        // Thrust and drag: drag k chosen so full throttle tops out at maxSpeed; planing halves it.
        const planing = Math.abs(d.vf) > spec.planing * KMH;
        const k = spec.accel / (maxV * maxV) * (planing ? 0.5 : 1) * (0.5 + spec.drag);
        if (d.beached) {
          d.vf = approach(d.vf, 0, 12 * dt);
          if (throttle < 0) d.vf -= spec.accel * 0.3 * -throttle * dt; // push off backwards
        } else {
          d.vf += spec.accel * throttle * (throttle < 0 ? 0.4 : 1) * dt;
          d.vf -= sign(d.vf) * k * d.vf * d.vf * dt;
          d.vf = approach(d.vf, 0, 0.15 * dt);
          d.vf = clamp(d.vf, -maxV * 0.4, maxV * (planing ? 1.05 : 1));
        }
        // Rudder: authority from water flow over it (plus a little from prop wash).
        const flow = clamp(Math.abs(d.vf) / 4, 0, 1) + (throttle ? 0.2 : 0);
        const h0 = d.heading;
        d.heading = h0 - ctl.steer * spec.turn * DEG * Math.min(1, flow) * sign(d.vf || throttle || 1) * dt;
        reproject(d, h0, d.heading);
        d.vl *= Math.exp(-config.keel * (planing ? 0.6 : 1) * dt);
        // Buoyancy: hold the hull at the waterline, bobbing less as it speeds up.
        let keepY = null;
        if (plane === 'xz' && has(api, 'groundAt')) {
          const surfaceY = api.groundAt(u, w).y + depth;
          const bob = config.swell * Math.sin(rt.state.time * 1.7 + (v.id.length % 7)) * (1 - clamp(Math.abs(d.vf) / maxV, 0, 0.8));
          keepY = afloat ? r6(surfaceY - spec.draft * 0.5 + bob + footOffset(api, v)) : null;
        }
        const hit = moveVehicle(rt, v, api, plane, d, dt, { keepY, gravity: !afloat, stepUp: 0.3 });
        const impact = resolveBlock(d, hit, 0.3);
        if (impact > 2) { rt.emit('crash', { vehicle: v.id, speed: r6(impact), kind: 'hull' }); svc.crash(v, impact); }
        publish(v, plane, d);
        // Docking.
        const stopped = Math.abs(d.vf) < config.dockSpeed && Math.abs(d.vl) < config.dockSpeed;
        const dock = !stopped ? null : config.docks.find(z => api.inZone(v, z, rt))
          ?? (config.dockArchetypes.length ? sortedEntities(rt).find(e => e !== v && matchesAny(e, config.dockArchetypes) && dist(rt, v, e) <= config.dockRange)?.id : null);
        if (dock && d.docked !== dock) { d.docked = dock; rt.emit('docked', { vehicle: v.id, dock, who: c.occupants[0] }); }
        else if (!dock && d.docked && !stopped) { rt.emit('undocked', { vehicle: v.id, dock: d.docked }); d.docked = null; }
      }
    }, ID);
  },
};
