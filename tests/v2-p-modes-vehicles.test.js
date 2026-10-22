import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { compile, testSpace } from '../v2/kernel/testing.js';
import { preflight } from '../v2/kernel/document.js';
import { checkParam } from '../v2/kernel/params.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import spaceGraph from '../v2/primitives/engine/space-graph.js';
import modes from '../v2/primitives/gameplay/modes.index.js';
import { waterSpace, stubHealth, doc, drive, gameInstanceErrors } from '../v2/primitives/gameplay/modes-lib-testing.js';

const P = [...modes, testSpace, waterSpace, stubHealth];
const ids = p => modes.find(m => m.id === p);
const core = (w = {}) => ({ use: 'gameplay.vehicle.core', with: w });
const wall = Array.from({ length: 12 }, (_, y) => [30, y, 0]);
const coupe = { id: 'coupe', kind: 'vehicle', components: { vehicle: { seats: 2, health: 100, fuel: 50 }, car: { maxSpeed: 72, accel: 10, grip: 1, steer: 30, drift: true, boost: { sec: 1, mult: 1.4, cooldown: 3 } } } };
const kart = { id: 'kart', kind: 'vehicle', components: { vehicle: { seats: 1, health: 100, fuel: 0 }, car: { maxSpeed: 90, accel: 14, preset: 'kart', steer: 28 } } };
const carDoc = (extra = {}) => doc({ with: { size: [40, 12, 1], solid: wall }, archetypes: [coupe, kart, { id: 'npc', components: {} }], player: { archetype: 'hero', at: [3, 5, 0] },
  systems: [core({ stations: ['rock', 'jazz'], ...extra.core }), { use: 'gameplay.vehicle.car', with: { plane: 'xy', ...extra.car } }] });
const gas = { axes: { move: [0, 1] } };

test('vehicle.core: enter, ride along, vars, in_vehicle and exit', () => {
  const { rt } = compile(carDoc(), { primitives: P });
  rt.spawn('coupe', { id: 'car1', at: [4, 5, 0] });
  rt.step({ actions: { enter_vehicle: true } });
  assert.deepEqual(rt.player().components.seat, { vehicle: 'car1', seat: 0 });
  assert.ok(rt.test({ in_vehicle: true }));
  assert.ok(rt.test({ in_vehicle: true, kind: 'car', seat: 'driver' }));
  assert.equal(rt.state.counts['vehicle_entered:coupe'], 1);
  drive(rt, 60, gas);
  assert.ok(rt.entity('car1').at[0] > 8, 'car drove forward');
  assert.deepEqual(rt.player().at, rt.entity('car1').at, 'driver rides along');
  assert.ok(rt.state.vars['vehicle.speed'] > 5);
  assert.ok(rt.state.vars['vehicle.fuel'] < 50, 'fuel burns under throttle');
  rt.step({ actions: { radio: true } });
  assert.equal(rt.state.vars['vehicle.radio'], 'rock');
  rt.step({ actions: { exit_vehicle: true } });
  assert.equal(rt.player().components.seat, undefined);
  assert.notDeepEqual(rt.player().at, rt.entity('car1').at, 'stepped out beside');
  assert.ok(!rt.test({ in_vehicle: true }));
  assert.equal(rt.state.vars['vehicle.in'], 0);
});

test('vehicle.car: steering turns, top speed is bounded, wall crash damages the hull', () => {
  const { rt } = compile(carDoc(), { primitives: P });
  rt.spawn('coupe', { id: 'car1', at: [4, 5, 0] });
  rt.run([{ do: 'enter_vehicle', vehicle: 'car1' }]);
  drive(rt, 400, gas);
  const d = rt.entity('car1').components.drive;
  assert.ok(rt.state.counts.crash >= 1, 'hit the wall at x=30');
  assert.ok(rt.entity('car1').components.vehicle.hp < 100);
  assert.ok(rt.entity('car1').at[0] < 30, 'did not pass through the wall');
  assert.ok(Math.abs(d.vf) <= 20.01);
  const { rt: r2 } = compile(carDoc(), { primitives: P });
  r2.spawn('coupe', { id: 'car1', at: [4, 5, 0] }); r2.run([{ do: 'enter_vehicle', vehicle: 'car1' }]);
  drive(r2, 60, { axes: { move: [1, 1] } });
  assert.ok(r2.entity('car1').components.drive.heading < -0.3, 'steering right turns clockwise');
});

test('vehicle.car: boost and kart drift mini-turbo', () => {
  const { rt } = compile(carDoc(), { primitives: P });
  rt.spawn('coupe', { id: 'car1', at: [3, 4, 0] }); rt.run([{ do: 'enter_vehicle', vehicle: 'car1' }]);
  drive(rt, 30, gas); rt.step({ ...gas, actions: { boost: true } });
  assert.equal(rt.state.counts.boost, 1);
  const { rt: k } = compile(carDoc(), { primitives: P });
  k.spawn('kart', { id: 'k1', at: [3, 4, 0] }); k.run([{ do: 'enter_vehicle', vehicle: 'k1' }]);
  drive(k, 50, gas);
  drive(k, 100, { axes: { move: [-1, 1] }, held: { handbrake: true } });
  assert.equal(k.state.counts.drift, 1);
  k.step({ axes: { move: [0, 1] } });
  assert.equal(k.state.counts.drift_end, 1);
  assert.equal(k.state.counts.drift_boost, 1, 'a long drift banks a mini-turbo');
  assert.ok(k.entity('k1').components.drive.boostT > 0);
});

test('vehicle.core: an AI driver\'s movement intent drives the vehicle it sits in (steer toward the goal, throttle up to its speed)', () => {
  const { rt } = compile(carDoc(), { primitives: P });
  rt.spawn('npc', { id: 'ai1', at: [3, 2, 0] }); rt.spawn('kart', { id: 'k1', at: [3, 2, 0] }); rt.step();
  rt.run([{ do: 'enter_vehicle', who: 'ai1', vehicle: 'k1', force: true }]);
  assert.equal(rt.entity('ai1').components.seat.vehicle, 'k1');
  // moveTo, as gameplay.ai.seek writes it: the kart heads for the goal and never runs much above the intent's speed.
  rt.entity('ai1').components.moveTo = { at: [24, 9, 0], zone: null, run: false, speed: 8, by: 'ai' };
  let closest = Infinity, fastest = 0;
  for (let i = 0; i < 240; i++) {
    rt.step(); const k = rt.entity('k1');
    closest = Math.min(closest, Math.hypot(k.at[0] - 24, k.at[1] - 9)); fastest = Math.max(fastest, Math.abs(k.components.drive.vf));
    assert.deepEqual(rt.entity('ai1').at, k.at, 'the driver rides along');
  }
  assert.ok(closest < 1.5, `reached the goal (closest ${closest})`);
  assert.ok(fastest > 6 && fastest <= 8 * 1.15 + 0.5, `throttle up to the intent's speed (fastest ${fastest})`);
  // steer, as direct-steering AI writes it: a second kart turns to the direction.
  rt.spawn('npc', { id: 'ai2', at: [5, 9, 0] }); rt.spawn('kart', { id: 'k2', at: [5, 9, 0] }); rt.step();
  rt.run([{ do: 'enter_vehicle', who: 'ai2', vehicle: 'k2', force: true }]);
  rt.entity('ai2').components.steer = { dir: [0, -1, 0], speed: 4 };
  for (let i = 0; i < 180; i++) rt.step();
  const h = rt.entity('k2').components.drive.heading;
  assert.ok(Math.abs(Math.atan2(Math.sin(h + Math.PI / 2), Math.cos(h + Math.PI / 2))) < 0.2, `heading turned to -y (${h})`);
  // Without an intent the driver's explicit controls (components.drive.control) still apply.
  delete rt.entity('ai1').components.moveTo;
  assert.equal(rt.service('vehicles').control(rt.entity('k1')).throttle, 0);
  rt.entity('k1').components.drive.control = { throttle: 0.5 };
  assert.equal(rt.service('vehicles').control(rt.entity('k1')).throttle, 0.5);
});

test('vehicle.core: carjacking, locked cars, alarms and theft', () => {
  const { rt } = compile(carDoc({ core: { theftDifficulty: 1 } }), { primitives: P });
  rt.spawn('npc', { id: 'driver', at: [4, 5, 0] });
  const car = rt.spawn('coupe', { id: 'car1', at: [4, 5, 0] });
  rt.run([{ do: 'enter_vehicle', who: 'driver', vehicle: 'car1' }]);
  car.components.drive = { control: { throttle: 0 } };
  rt.step({ actions: { enter_vehicle: 'car1' } });
  assert.equal(rt.state.counts.carjacked, 1);
  assert.equal(rt.state.counts.vehicle_stolen, 1);
  assert.equal(rt.entity('driver').components.seat, undefined);
  assert.equal(rt.entity('car1').components.vehicle.owner, 'player');
  rt.step({ actions: { exit_vehicle: true } });
  const locked = rt.spawn('coupe', { id: 'car2', at: rt.player().at.slice() });
  rt.run([{ do: 'lock_vehicle', vehicle: 'car2', owner: 'someone' }]);
  rt.step({ actions: { enter_vehicle: 'car2' } });
  assert.equal(rt.state.counts.vehicle_alarm, 1, 'theftDifficulty 1 always trips the alarm');
  assert.equal(rt.player().components.seat, undefined);
  void locked;
});

test('vehicle.core: fuel runs out, burning hulls are destroyed and eject occupants', () => {
  const { rt } = compile(carDoc({ core: { fuelUse: 30, burnSec: 1, onDestroyed: [{ do: 'set_flag', flag: 'boom' }] } }), { primitives: P });
  rt.spawn('coupe', { id: 'car1', at: [4, 5, 0] }); rt.run([{ do: 'enter_vehicle', vehicle: 'car1' }]);
  drive(rt, 200, { axes: { move: [0.3, 1] } });
  assert.equal(rt.state.counts.out_of_fuel, 1);
  assert.equal(rt.state.vars['vehicle.fuel'], 0);
  rt.run([{ do: 'damage_vehicle', vehicle: 'car1', amount: 80 }]);
  assert.equal(rt.state.counts.vehicle_burning, 1);
  drive(rt, 61);
  assert.equal(rt.state.counts['vehicle_destroyed:coupe'], 1);
  assert.equal(rt.player().components.seat, undefined, 'ejected');
  assert.equal(rt.state.flags.boom, true);
  rt.step({ actions: { enter_vehicle: 'car1' } });
  assert.equal(rt.player().components.seat, undefined, 'wrecks cannot be entered');
});

test('vehicle.car: rail carts follow rail cells, branch with steering and stop at the end', () => {
  const rail = { id: 'cart', components: { vehicle: { seats: 1, health: 50, fuel: 0 }, car: { maxSpeed: 36, accel: 8, rail: true } } };
  const d = doc({ with: { size: [20, 12, 1] }, archetypes: [rail], player: { archetype: 'hero', at: [2, 2, 0] }, systems: [core(), { use: 'gameplay.vehicle.car', with: { plane: 'xy', railBlocks: ['rail'] } }] });
  const { rt } = compile(d, { primitives: P });
  const api = rt.space('world');
  for (let x = 2; x <= 8; x++) api.setCell([x, 2, 0], 'rail', rt);
  for (let y = 3; y <= 6; y++) api.setCell([8, y, 0], 'rail', rt);
  rt.spawn('cart', { id: 'c1', at: [2, 2, 0] }); rt.run([{ do: 'enter_vehicle', vehicle: 'c1' }]);
  drive(rt, 240, gas);
  assert.deepEqual(rt.entity('c1').at, [8, 6, 0], 'turned the corner and stopped at the rail end');
  assert.equal(rt.state.counts.rail_end >= 1, true);
});

test('vehicle.car: ramps launch the car (xz terrain) and it lands', () => {
  const d = doc({ space: 'engine.space.water-test', with: { size: [60, 20, 60], gravity: 9.8, ramps: [[10, 0, 12, 60, 0.3], [12, 0, 14, 60, 0.6], [14, 0, 16, 60, 0.9], [16, 0, 18, 60, 1.2]] }, archetypes: [coupe], player: { archetype: 'hero', at: [2, 0, 5] }, systems: [core(), { use: 'gameplay.vehicle.car' }] });
  const { rt } = compile(d, { primitives: P });
  rt.spawn('coupe', { id: 'car1', at: [3, 0, 5] }); rt.run([{ do: 'enter_vehicle', vehicle: 'car1' }]);
  drive(rt, 160, gas);
  assert.ok(rt.state.counts.airborne >= 1, 'left the ramp edge');
  assert.ok(rt.state.counts.landed >= 1);
  assert.ok(rt.entity('car1').at[0] > 20);
});

test('vehicle.boat: floats, docks, beaches in the shallows', () => {
  const boat = { id: 'skiff', components: { vehicle: { seats: 2, health: 60, fuel: 20 }, boat: { maxSpeed: 40, accel: 6, turn: 40, draft: 0.4 } } };
  const d = doc({ space: 'engine.space.water-test', with: { size: [80, 20, 40], water: [[0, 0, 40, 40, 3]] }, zones: [], archetypes: [boat, { id: 'pier', components: {} }], player: { archetype: 'hero', at: [5, 0, 5] },
    systems: [core(), { use: 'gameplay.vehicle.boat', with: { dockArchetypes: ['pier'] } }] });
  const { rt } = compile(d, { primitives: P });
  rt.spawn('skiff', { id: 'b1', at: [5, 0, 5] }); rt.run([{ do: 'enter_vehicle', vehicle: 'b1' }]);
  drive(rt, 120, gas);
  const b = rt.entity('b1');
  assert.ok(b.at[0] > 10, 'thrust moves the boat');
  assert.ok(Math.abs(b.at[1] - (-3 + 3 - 0.2)) < 0.3, 'held at the waterline');
  drive(rt, 900, gas);
  assert.ok(rt.state.counts.beached >= 1, 'ran aground past the shoreline');
  const { rt: r2 } = compile(d, { primitives: P });
  r2.spawn('skiff', { id: 'b1', at: [5, 0, 5] }); r2.spawn('pier', { id: 'p1', at: [7, 0, 5] });
  drive(r2, 5);
  assert.equal(r2.state.counts.docked, 1);
});

test('vehicle.aircraft: takeoff roll, climb, stall, soft landing and crash', () => {
  const plane = { id: 'biplane', components: { vehicle: { seats: 1, health: 100, fuel: 100 }, aircraft: { stall: 40, maxSpeed: 180, climb: 6, turn: 28, takeoffSpeed: 55 } } };
  const d = doc({ space: 'engine.space.water-test', with: { size: [512, 400, 512], gravity: 9.8 }, archetypes: [plane], player: { archetype: 'hero', at: [5, 0, 5] }, systems: [core({ fuelUse: 0 }), { use: 'gameplay.vehicle.aircraft' }] });
  const { rt } = compile(d, { primitives: P });
  rt.spawn('biplane', { id: 'a1', at: [5, 0, 5] }); rt.run([{ do: 'enter_vehicle', vehicle: 'a1' }]);
  drive(rt, 900, i => ({ held: { throttle_up: true }, axes: { move: [0, rt.entity('a1').components.drive?.airborne ? 0.3 : 1] } }));
  assert.equal(rt.state.counts.airborne, 1);
  assert.ok(rt.entity('a1').at[1] > 20, 'climbing');
  drive(rt, 600, { held: { throttle_down: true }, axes: { move: [0, 1] } });
  assert.ok(rt.state.counts.stall >= 1, 'no power and nose up stalls');
  drive(rt, 1200, { held: { throttle_down: true } });
  assert.ok((rt.state.counts.crash || 0) + (rt.state.counts.landed || 0) >= 1, 'came down');
  assert.ok(rt.state.counts.crash >= 1, 'a stalled descent is a crash');
});

test('vehicle.aircraft: vtol hover takes off on collective and lands softly', () => {
  const heli = { id: 'heli', components: { vehicle: { seats: 2, health: 100, fuel: 0 }, aircraft: { vtol: true, stall: 0, maxSpeed: 120, climb: 6, turn: 60 } } };
  const d = doc({ space: 'engine.space.water-test', with: { size: [200, 200, 200], gravity: 9.8 }, archetypes: [heli], player: { archetype: 'hero', at: [5, 0, 5] }, systems: [core(), { use: 'gameplay.vehicle.aircraft' }] });
  const { rt } = compile(d, { primitives: P });
  rt.spawn('heli', { id: 'h1', at: [5, 0, 5] }); rt.run([{ do: 'enter_vehicle', vehicle: 'h1' }]);
  drive(rt, 240, { held: { throttle_up: true } });
  assert.equal(rt.state.counts.airborne, 1);
  const top = rt.entity('h1').at[1]; assert.ok(top > 5);
  drive(rt, 90, { held: { throttle_down: true } }); // collective to 0.25: sink 3 m/s
  drive(rt, 600, {});
  assert.equal(rt.state.counts.landed, 1, 'gentle descent lands');
  assert.equal(rt.state.counts.crash ?? 0, 0);
});

test('vehicles: deterministic replay', () => {
  const play = () => { const { rt } = compile(carDoc({ core: { theftDifficulty: 0.5 } }), { primitives: P }); rt.spawn('kart', { id: 'k1', at: [3, 5, 0] }); rt.step({ actions: { enter_vehicle: true } }); drive(rt, 200, i => ({ axes: { move: [Math.sin(i / 20), 1] }, held: { handbrake: i % 50 > 30 } })); return rt.snapshot(); };
  assert.deepEqual(play(), play());
  const { rt } = compile(carDoc(), { primitives: P });
  rt.spawn('coupe', { id: 'car1', at: [4, 5, 0] }); rt.run([{ do: 'enter_vehicle', vehicle: 'car1' }]);
  drive(rt, 30, gas); const snap = rt.snapshot(); drive(rt, 30, gas); const a = rt.snapshot();
  rt.restore(snap); drive(rt, 30, gas); assert.deepEqual(rt.snapshot(), a);
});

test('vehicles: preflight rejects bad configs with stable codes', () => {
  const registry = new Registry(P), logic = buildLogic(registry, Logic);
  const bad = carDoc({ car: { preset: 'hover' } });
  bad.content.archetypes.push({ id: 'junk', components: { vehicle: { seats: 0, health: -1 }, car: { grip: 5, preset: 'warp' } } }, { id: 'bad_boat', components: { boat: { maxSpeed: -2 } } }, { id: 'loose_car', components: { car: {} } });
  bad.systems.push({ use: 'gameplay.vehicle.boat' }, { use: 'gameplay.vehicle.aircraft', with: { ceiling: -5 } });
  bad.content.archetypes.push({ id: 'bad_plane', components: { vehicle: {}, aircraft: { stall: 200, maxSpeed: 100 } } });
  const r = preflight(bad, registry, logic), codes = new Set(r.errors.map(e => e.code));
  for (const c of ['param_option', 'car_no_vehicle', 'boat_no_vehicle', 'aircraft_invalid', 'param_range']) assert.ok(codes.has(c), c);
  // The components' single-field rules are their declared shapes (card.components), checked by preflight's section
  // shapes.
  const shaped = new Set([...r.errors, ...r.warnings].map(e => `${e.code}@${e.path}`)), at = id => `content.archetypes[${bad.content.archetypes.findIndex(a => a.id === id)}].components`;
  for (const c of [`param_range@${at('junk')}.vehicle.seats`, `param_range@${at('junk')}.vehicle.health`, `param_range@${at('junk')}.car.grip`, `param_option@${at('junk')}.car.preset`, `param_range@${at('bad_boat')}.boat.maxSpeed`]) assert.ok(shaped.has(c), c);
  const nodeps = doc({ systems: [{ use: 'gameplay.vehicle.car' }] });
  assert.ok(preflight(nodeps, registry, logic).errors.some(e => e.code === 'requires_unmet'));
  const g = new Registry([...P, spaceGraph]), gl = buildLogic(g, Logic);
  const onGraph = doc({ space: 'engine.space.graph', with: {}, zones: [{ id: 'a', exits: [] }], player: { archetype: 'hero', at: 'a' }, systems: [core(), { use: 'gameplay.vehicle.boat' }] });
  assert.ok(preflight(onGraph, g, gl).errors.some(e => e.code === 'capability_missing'), 'boats need a space with water (surface)');
});

test('vehicles: every instance in v2/games/*.json has zero param errors', () => {
  const dir = new URL('../v2/games/', import.meta.url);
  const games = readdirSync(dir).filter(f => f.endsWith('.json')).map(f => [f, JSON.parse(readFileSync(new URL(f, dir)))]);
  const found = gameInstanceErrors(games, modes);
  assert.ok(found.filter(f => f.name === 'blockport.json').length >= 4, 'blockport uses vehicle.core/car/boat/aircraft (and race)');
  for (const f of found) assert.deepEqual(f.errors, [], `${f.name} ${f.use}`);
  // Archetype specs in the games hold the components' declared shapes (card.components) and pass the cross-field rules.
  for (const [name, d] of games) for (const id of ['gameplay.vehicle.core', 'gameplay.vehicle.car', 'gameplay.vehicle.boat', 'gameplay.vehicle.aircraft']) {
    if (!(d.systems || []).some(s => s.use === id)) continue;
    const card = ids(id).card, errs = [];
    (d.content?.archetypes || []).forEach((a, i) => { for (const [k, spec] of Object.entries(card.components || {})) if (a.components?.[k] !== undefined) checkParam(spec, a.components[k], `content.archetypes[${i}].components.${k}`, errs, null); });
    assert.deepEqual([...errs, ...(ids(id).validate?.({}, d, {}) || [])], [], `${name} ${id} archetypes`);
  }
});
