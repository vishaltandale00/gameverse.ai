// gameplay.move.ship (arena2d), gameplay.move.lanes (arena2d top-down and the
// 3D test space) and gameplay.mount (3D test space).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeReal, realDoc, run, move, testSpace, doc, make } from './v2-p-move-helpers.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import { preflight } from '../v2/kernel/document.js';
import spaces2d from '../v2/primitives/engine/spaces2d.index.js';
import { LANES } from '../v2/primitives/gameplay/move-lanes.js';
import { SHIP } from '../v2/primitives/gameplay/move-ship.js';

const reg = new Registry([...spaces2d, testSpace, ...move]), logic = buildLogic(reg, Logic);
const codes = d => preflight(d, reg, logic).errors.map(e => e.code);
const arena = (w, systems, at, o = {}) => realDoc({ space: 'engine.space.arena2d', with: w, systems, at, body: o.body || { size: [16, 16] }, archetypes: o.archetypes || [] });

// ---------------------------------------------------------------- ship
test('ship: kit constants; rail ignores vertical input; focus slows; twin-stick auto-aims at the nearest enemy', () => {
  assert.deepEqual([SHIP.rotate, SHIP.thrust, SHIP.drag, SHIP.maxSpeed], [4.6, 300, 0.55, 1.5]);
  let { rt } = makeReal(arena({ size: [300, 400] }, [{ use: 'gameplay.move.ship', with: { mode: 'rail', speed: 120 } }], [150, 30]));
  run(rt, 30, { axes: { move: [1, 1] } });
  assert.deepEqual(rt.player().at, [210, 30], 'rail: x only');
  run(rt, 30, { axes: { move: [-1, 0] }, held: { focus: true } });
  assert.deepEqual(rt.player().at, [180, 30], 'focus halves speed');
  const enemies = [{ id: 'gnat', kind: 'enemy', components: { body: { size: [10, 10] } } }];
  ({ rt } = makeReal(arena({ size: [480, 360] }, [{ use: 'gameplay.move.ship', with: { mode: 'twinstick' } }], [100, 100], { archetypes: enemies })));
  rt.spawn('gnat', { at: [100, 250] }); rt.spawn('gnat', { at: [400, 100] });
  run(rt, 2, {});
  const s = rt.player().components.move.ship;
  assert.ok(Math.abs(s.aim - Math.PI / 2) < 1e-6, `aims up at the closer gnat (${s.aim})`);
  run(rt, 2, { axes: { aim: [-1, 0] } });
  assert.ok(Math.abs(Math.abs(rt.player().components.move.ship.aim) - Math.PI) < 1e-6, 'aim stick overrides');
});

test('ship: inertial thrust, drag and the speed cap; NPC ship follows steer; replay', () => {
  const mk = () => makeReal(arena({ size: [2000, 2000] }, [{ use: 'gameplay.move.ship', with: { mode: 'inertial', speed: 100, heading: 0 } }], [1000, 1000], { archetypes: [{ id: 'drone', components: { body: { size: [8, 8] }, move: {} } }] })).rt;
  const rt = mk();
  run(rt, 120, { axes: { move: [0, 1] } });
  const v = rt.player().components.body.vel;
  assert.ok(Math.abs(Math.hypot(v[0], v[1]) - 150) < 1e-6, 'capped at 1.5 × speed');
  run(rt, 60, {});
  assert.ok(Math.hypot(...rt.player().components.body.vel.slice(0, 2)) < 150 * 0.6, 'drag bleeds speed');
  const d = rt.spawn('drone', { at: [500, 500] });
  d.components.steer = { dir: [1, 0, 0] };
  run(rt, 30, {});
  assert.ok(d.at[0] > 500, 'NPC ship steers');
  const a = mk(), b = mk();
  for (let i = 0; i < 200; i++) { const inp = { axes: { move: [Math.sin(i / 9), i % 50 < 30 ? 1 : 0] }, actions: { hyperspace: i === 150 } }; a.step(inp); b.step(inp); }
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.ok(codes(arena({}, [{ use: 'gameplay.move.ship', with: { mode: 'bank' } }], [1, 1])).includes('param_option'));
  assert.ok(codes(arena({}, [{ use: 'gameplay.move.ship', with: { bounds: [0, 0, 5] } }], [1, 1])).includes('param_range'));
});

// ---------------------------------------------------------------- lanes
const track = (w = {}, o = {}) => arena({ size: [3, 4000] }, [{ use: 'gameplay.move.lanes', with: { speed: 10, ...w } }], [1.5, 2], { body: { size: [0.64, 0.64] }, archetypes: o.archetypes });

test('lanes: kit constants; lane switches take switchTime; auto-run forward with a ramp', () => {
  assert.deepEqual([LANES.switchTime, LANES.jumpH, LANES.air, LANES.slide, LANES.drop, LANES.chase], [0.15, 1.35, 0.62, 0.62, 16, 7]);
  const { rt } = makeReal(track({ maxSpeed: 20, rampSec: 10 }));
  const p = rt.player();
  rt.step({ actions: { right: true } });
  run(rt, 9, {});
  assert.ok(Math.abs(p.at[0] - 2.5) < 1e-6, `one lane over in 0.15 s (${p.at[0]})`);
  rt.step({ actions: { right: true } });
  assert.equal(p.components.move.lanes.lane, 2, 'no lane past the edge');
  run(rt, 60, {});
  assert.ok(p.at[1] > 2 + 10, 'ran forward');
  assert.ok(rt.state.vars['move.speed'] > 10 && rt.state.vars['move.distance'] > 10);
  // A stick pushed sideways counts once until it returns to centre.
  run(rt, 5, { axes: { move: [-1, 0] } });
  assert.equal(p.components.move.lanes.lane, 1);
});

test('lanes: jump arc 1.35 over 0.62 s, slide, dive into a slide', () => {
  const { rt } = makeReal(track());
  const p = rt.player();
  rt.step({ actions: { jump: true } });
  let top = 0, frames = 0;
  while (p.components.move.lanes.air && frames < 100) { rt.step({}); top = Math.max(top, p.components.body.lift); frames++; }
  assert.ok(Math.abs(top - 1.35) < 0.1, `apex ${top} (semi-implicit integration, as in the kit)`);
  assert.ok(Math.abs(frames / 60 - 0.62) < 0.05, `air time ${frames / 60}`);
  rt.step({ actions: { slide: true } });
  assert.equal(p.components.body.state, 'slide');
  assert.equal(p.components.body.height, LANES.slideH);
  run(rt, 40, {});
  assert.equal(p.components.body.state, 'lanes');
  rt.step({ actions: { jump: true } }); run(rt, 5, {});
  rt.step({ actions: { slide: true } });
  run(rt, 10, {});
  assert.equal(p.components.body.state, 'slide', 'dove into a slide on landing');
});

test('lanes: trips slow you and bring the chaser; a second trip while it is close catches you', () => {
  const { rt } = makeReal(track({ onCaught: [{ do: 'end_game', outcome: 'lost' }] }));
  run(rt, 10, {});
  rt.run([{ do: 'trip' }]);
  assert.equal(rt.state.counts.stumble, 1);
  rt.step({});
  assert.ok(Math.abs(rt.player().components.body.vel[1] - 10 * LANES.tripSlow) < 1e-6);
  run(rt, 60, {});
  rt.run([{ do: 'trip' }]);
  assert.equal(rt.state.counts.caught, 1);
  assert.equal(rt.state.status, 'lost');
});

test('lanes: switching into a blocked lane stumbles; lane predicate; travel along waypoints', () => {
  const { rt } = makeReal(track({ blockers: ['train'] }, { archetypes: [{ id: 'train', components: { body: { size: [0.9, 6] } } }] }));
  rt.spawn('train', { at: [2.5, 3] });
  rt.step({ actions: { right: true } });
  assert.equal(rt.state.counts.stumble, 1);
  assert.equal(rt.test({ lane: 1 }), true);
  const prim = move.find(p => p.id === 'gameplay.move.lanes');
  const p = rt.player();
  const ok = prim.travel(rt, [p.at.slice(), [0.5, p.at[1] + 30], [2.5, p.at[1] + 60]], { laneWidth: 1 });
  assert.equal(ok, true);
  assert.equal(p.components.move.lanes.lane, 2);
  assert.ok(codes(track({ maxSpeed: 5 })).includes('lanes_speed_order'));
});

test('lanes: 3D test space with gravity, forward +z; deterministic replay', () => {
  const solid = []; for (let x = 0; x < 5; x++) for (let z = 0; z < 120; z++) solid.push([x, 0, z]);
  const mk = () => make(doc({ size: [5, 6, 120], gravity: 30, solid, at: [2, 1, 1], body: { size: [0.6, 1.7, 0.6] }, systems: [{ use: 'gameplay.move.lanes', with: { speed: 8 } }] })).rt;
  const rt = mk();
  run(rt, 30, {});
  const p = rt.player();
  assert.ok(p.at[2] > 4 && Math.abs(p.at[1] - 1) < 0.01, `runs along +z on the floor (${p.at})`);
  rt.step({ actions: { jump: true } }); run(rt, 15, {});
  assert.ok(p.at[1] > 1.8, 'real vertical arc through slide');
  const a = mk(), b = mk();
  for (let i = 0; i < 300; i++) { const inp = { actions: { left: i % 40 === 0, right: i % 40 === 20, jump: i % 33 === 0, slide: i % 51 === 0 } }; a.step(inp); b.step(inp); }
  assert.deepEqual(a.snapshot(), b.snapshot());
});

// ---------------------------------------------------------------- mount
const meadow = (w = {}, extra = []) => {
  const solid = []; for (let x = 0; x < 60; x++) for (let z = 0; z < 60; z++) solid.push([x, 0, z]);
  const d = doc({ size: [60, 6, 60], gravity: 30, solid, at: [10, 1, 10], body: { size: [0.6, 1.8, 0.6] }, systems: [{ use: 'gameplay.move.walk', with: {} }, { use: 'gameplay.mount', with: { gallopCost: 25, staminaRegen: 10, bondGain: 60, callRange: 40, ...w } }] });
  d.content.archetypes.push(
    { id: 'horse', kind: 'mount', components: { body: { size: [1, 1.6, 2] }, mount: { speed: { walk: 3, trot: 7, gallop: 14 }, stamina: { max: 50 }, bond: 0 } } },
    { id: 'wild', kind: 'mount', components: { body: { size: [1, 1.6, 2] }, mount: { tameable: true, bond: 0 } } }, ...extra);
  return d;
};

test('mount: ride with gaits, gallop drains stamina, bond grows, dismount beside the mount', () => {
  const { rt } = make(meadow());
  const h = rt.spawn('horse', { at: [11.5, 1, 10] });
  run(rt, 5, {});
  assert.ok(rt.availableOptions().some(o => o.label === `mount ${h.id}`));
  rt.step({ actions: { mount: true } });
  const p = rt.player();
  assert.equal(rt.state.counts['mounted:horse'], 1);
  assert.equal(rt.test({ mounted: true }), true); assert.equal(rt.test({ mounted: 'horse' }), true);
  run(rt, 60, { axes: { move: [0, 1] } });
  assert.equal(h.components.mount.gait, 'trot');
  assert.ok(Math.abs(Math.hypot(h.components.body.vel[0], h.components.body.vel[2]) - 7) < 0.1, 'trot speed');
  assert.equal(p.components.body.state, 'ride');
  assert.ok(Math.abs(p.at[2] - h.at[2]) < 1e-6 && Math.abs(p.at[1] - h.at[1] - 1) < 1e-6, 'rider sits on the seat');
  run(rt, 150, { axes: { move: [0, 1] }, held: { sprint: true } });
  assert.equal(rt.state.counts.mount_exhausted, 1, 'gallop drained the stamina');
  assert.equal(h.components.mount.gait, 'trot');
  assert.ok(h.components.mount.bond > 2, `bond grew (${h.components.mount.bond})`);
  rt.step({ actions: { mount: true } });
  assert.equal(rt.state.counts.dismounted, 1);
  assert.equal(rt.test({ mounted: true }), false);
  assert.ok(Math.abs(p.at[0] - h.at[0]) > 0.5, 'stepped off to the side');
});

test('mount: untamed mounts buck until bonded; calls bring owned mounts in range', () => {
  const { rt } = make(meadow({ buckChance: 1, tameBond: 10, tameStep: 5 }));
  rt.spawn('wild', { at: [11, 1, 10] });
  run(rt, 3, {});
  let tries = 0;
  while (!rt.test({ mounted: true }) && tries < 30) { rt.run([{ do: 'mount' }]); tries++; }
  assert.ok(rt.state.counts.bucked >= 1, 'bucked at least once');
  assert.equal(rt.test({ mounted: 'wild' }), true, `tamed after ${tries} tries`);
  const { rt: r2 } = make(meadow());
  const h = r2.spawn('horse', { at: [30, 1, 30] });
  h.components.mount.owner = 'player';
  run(r2, 3, {});
  r2.step({ actions: { call: true } });
  assert.equal(r2.state.counts.mount_called, 1);
  run(r2, 600, {});
  assert.equal(r2.state.counts.mount_arrived, 1, `came to the player (${h.at})`);
  const far = r2.spawn('horse', { at: [58, 1, 58] }); far.components.mount.owner = 'player';
  h.components.mount.owner = null;
  r2.run([{ do: 'call_mount' }]);
  assert.equal(r2.state.counts.mount_call_failed, 1, 'beyond callRange');
  const { rt: r3 } = make(meadow({ callBeyond: 'teleport', callRange: 5 }));
  const t = r3.spawn('horse', { at: [50, 1, 50] }); t.components.mount.owner = 'player';
  r3.run([{ do: 'call_mount' }]);
  assert.ok(Math.hypot(t.at[0] - 10, t.at[2] - 10) < 3, 'brought to the player');
});

test('mount: deterministic replay and stable preflight codes', () => {
  const mk = () => { const { rt } = make(meadow()); rt.spawn('wild', { at: [11, 1, 10] }); return rt; };
  const a = mk(), b = mk();
  for (let i = 0; i < 300; i++) { const inp = { actions: { mount: i % 50 === 0 }, axes: { move: [Math.sin(i / 20), 1] }, held: { sprint: i % 90 < 40 } }; a.step(inp); b.step(inp); }
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.ok(codes(meadow({ trot: 20, gallop: 10 })).includes('mount_gait_order'));
  assert.ok(codes(meadow({ callBeyond: 'warp' })).includes('param_option'));
});
