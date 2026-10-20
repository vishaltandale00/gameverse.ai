import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spaceConformance, compile, run } from '../v2/kernel/testing.js';
import { checkFields } from '../v2/kernel/params.js';
import { preflight } from '../v2/kernel/document.js';
import { catalogue } from '../v2/primitives/index.js';
import spaces2d from '../v2/primitives/engine/spaces2d.index.js';

const phys = spaces2d.find(p => p.id === 'engine.space.physics2d');
const ball = r => ({ shape: { kind: 'circle', r }, restitution: 0.5 });
const doc = (w = {}, extra = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'phys', title: 'Physics', seed: 4,
  spaces: [{ id: 'lab', use: 'engine.space.physics2d', with: { bounds: [20, 12], ...w }, zones: [{ id: 'goal', rect: [16, 0, 20, 4] }, { id: 'pad', rect: [2, 2, 6, 6] }] }],
  content: { archetypes: [{ id: 'probe', components: { body: { shape: { kind: 'circle', r: 0.25 }, type: 'kinematic' } } }, { id: 'ball', components: { body: ball(0.3) } }, { id: 'crate', components: { body: { shape: { kind: 'box', w: 1, h: 1 }, restitution: 0, friction: 0.8 } } }] },
  player: { archetype: 'probe', at: [3, 9] }, ...extra,
});
const make = (w, extra) => compile(doc(w, extra), { primitives: spaces2d }).rt;

spaceConformance(test, assert, { name: 'engine.space.physics2d', primitives: spaces2d, doc: () => doc(), free: [3, 9], other: [5, 9] });

test('physics2d: a ball falls, bounces with restitution, reports contacts and impacts, then sleeps', () => {
  const rt = make(), b = rt.spawn('ball', { at: [10, 6], id: 'b' });
  const contacts = [], ends = [], impacts = [];
  rt.on('contact', c => contacts.push(c)); rt.on('contact_end', c => ends.push(c)); rt.on('impact', c => impacts.push(c));
  let peak = 0, landed = false;
  for (let i = 0; i < 600; i++) { rt.step(); if (contacts.length) landed = true; if (landed) peak = Math.max(peak, b.at[1]); }
  const first = contacts[0];
  assert.equal(first.a === 'b' ? first.b : first.a, 'edge:bottom');
  assert.equal(first.begin, true); assert.ok(first.impulse > 0 && first.speed > 5);
  assert.ok(impacts.length >= 1 && ends.length >= 1, 'impact on landing and contact_end when it bounces off');
  assert.ok(peak > 1 && peak < 6 * 0.5, `bounce peak ${peak} below the drop height`);
  assert.ok(Math.abs(b.at[1] - 0.3) < 0.02, 'rests on the floor');
  assert.equal(b.components.body.sleeping, true, 'sleeps at rest');
  assert.ok(b.components.body.mass > 0);
});

test('physics2d: stacked boxes stay put (warm start, block solver, no drift)', () => {
  const rt = make();
  for (let i = 0; i < 4; i++) rt.spawn('crate', { at: [10, 0.5 + i * 1.001], id: `c${i}` });
  run(rt, 300);
  const top = rt.entity('c3');
  assert.ok(Math.abs(top.at[0] - 10) < 0.02 && Math.abs(top.at[1] - 3.5) < 0.05, `top crate at ${top.at}`);
  assert.ok(Math.abs(top.components.body.angle) < 0.01);
});

test('physics2d: Coulomb friction holds a box on a gentle ramp and lets it slide on ice', () => {
  const ramp = mu => make({ walls: [{ id: 'ramp', kind: 'box', at: [10, 3], size: [16, 0.4], angle: 0.25, friction: mu }] });
  const grippy = ramp(1), icy = ramp(0);
  for (const rt of [grippy, icy]) rt.spawn('crate', { at: [10, 4.2], id: 'c' });
  grippy.entity('c').components.body.friction = 1; icy.entity('c').components.body.friction = 0;
  run(grippy, 120); run(icy, 120);
  assert.ok(Math.abs(grippy.entity('c').at[0] - 10) < 0.3, `held by friction: ${grippy.entity('c').at}`);
  assert.ok(icy.entity('c').at[0] < 8, `slides on ice: ${icy.entity('c').at}`);
});

test('physics2d: joints — pendulum, rope slack, motor with limits; joints() for renderers', () => {
  const rt = make({ gravity: [0, -9.8], bodies: [{ id: 'bob', archetype: 'ball', at: [13, 8] }, { id: 'hang', archetype: 'ball', at: [4, 9] }, { id: 'flip', at: [10, 2], body: { shape: { kind: 'box', w: 2, h: 0.3 }, density: 2 } }],
    joints: [{ id: 'arm', kind: 'distance', b: 'bob', anchor: [10, 8] }, { id: 'line', kind: 'rope', b: 'hang', anchor: [4, 11], length: 3 },
      { id: 'hinge', kind: 'revolute', b: 'flip', anchor: [9, 2], motor: true, speed: 8, maxTorque: 400, limit: true, lower: -0.5, upper: 0.5 }] });
  const api = rt.space('lab');
  let maxDev = 0, minHang = Infinity;
  for (let i = 0; i < 180; i++) { rt.step(); const b = rt.entity('bob').at; maxDev = Math.max(maxDev, Math.abs(Math.hypot(b[0] - 10, b[1] - 8) - 3)); minHang = Math.min(minHang, rt.entity('hang').at[1]); }
  assert.ok(maxDev < 0.08, `pendulum keeps its length (dev ${maxDev})`);
  assert.ok(rt.entity('bob').at[1] < 8, 'it swung down');
  assert.ok(minHang > 8 - 0.1 && minHang < 8.2, `rope goes taut at length 3 below the anchor (${minHang})`);
  const a = api.jointAngle('hinge');
  assert.ok(a <= 0.5 + 0.03 && a > 0.4, `motor drives to the upper limit: ${a}`);
  api.setMotor('hinge', { speed: -8 }); run(rt, 60);
  assert.ok(api.jointAngle('hinge') < -0.4 && api.jointAngle('hinge') >= -0.53);
  const js = api.joints();
  assert.deepEqual(js.map(j => j.id), ['arm', 'line', 'hinge']);
  assert.ok(js[0].anchorA[0] === 10 && js[0].a === null && js[0].b === 'bob');
  assert.equal(api.removeJoint('line'), true); assert.equal(api.joints().length, 2);
  rt.spawn('ball', { at: [15, 9], id: 'late' });
  assert.equal(api.addJoint({ id: 'late_arm', kind: 'distance', a: 'bob', b: 'late' }, rt), 'late_arm');
});

test('physics2d: sensors report overlap without pushing; bullets do not tunnel; kinematic bodies push', () => {
  const rt = make({ gravity: [0, 0], walls: [{ id: 'gate', kind: 'box', at: [10, 6], size: [0.5, 4], sensor: true }, { id: 'thin', kind: 'box', at: [17, 6], size: [0.1, 6] }] });
  const shot = rt.spawn('ball', { at: [5, 6], id: 'shot', components: { body: { shape: { kind: 'circle', r: 0.05 }, bullet: true, vel: [400, 0], restitution: 0 } } });
  const seen = [];
  rt.on('contact', c => seen.push(c));
  run(rt, 30);
  assert.ok(seen.some(c => c.sensor && (c.a === 'gate' || c.b === 'gate')), 'sensor contact reported');
  assert.ok(shot.at[0] < 17, `bullet stopped by the thin wall: ${shot.at}`);
  const rt2 = make({ gravity: [0, 0] });
  const pusher = rt2.spawn('probe', { at: [4, 6], id: 'pusher', components: { body: { shape: { kind: 'box', w: 1, h: 2 }, type: 'kinematic', vel: [3, 0] } } });
  const target = rt2.spawn('ball', { at: [6, 6], id: 't' });
  run(rt2, 60);
  assert.ok(Math.abs(pusher.at[0] - 7) < 0.01, 'kinematic body moves by its velocity');
  assert.ok(target.at[0] > 7.5, 'and pushes the dynamic ball');
});

test('physics2d: raycast, overlap, entitiesAt, contacts', () => {
  const rt = make({ walls: [{ id: 'shelf', kind: 'seg', points: [[2, 5], [8, 5]], r: 0.1 }] }), api = rt.space('lab');
  rt.spawn('crate', { at: [12, 0.5], id: 'c' });
  let h = api.raycast([5, 9], [0, -1], 20);
  assert.equal(h.hit, 'cell'); assert.equal(h.wall, 'shelf'); assert.ok(Math.abs(h.dist - 3.9) < 1e-6); assert.deepEqual(h.normal.map(v => Math.round(v)), [0, 1]);
  h = api.raycast([12, 9], [0, -1], 20);
  assert.equal(h.hit, 'entity'); assert.equal(h.id, 'c'); assert.ok(Math.abs(h.dist - 8) < 1e-6);
  h = api.raycast([12, 9], [0, -1], 20, { entities: false });
  assert.equal(h.wall, 'edge:bottom');
  assert.deepEqual(api.overlap({ kind: 'circle', at: [12.9, 0.5], r: 0.5 }), ['c']);
  assert.deepEqual(api.overlap({ kind: 'aabb', at: [11, 0], size: [0.4, 0.4] }), [], 'exact: box corner region misses');
  assert.deepEqual(api.entitiesAt([12, 0.7]), ['c']);
  run(rt, 5);
  assert.ok(api.contacts(rt.entity('c')).some(c => c.wall === 'edge:bottom' && c.normal[1] > 0.9));
});

test('physics2d: slide for controlled bodies, grounded, dynamics, wrap and kill edges', () => {
  const rt = make({ walls: [{ id: 'wall', kind: 'box', at: [8, 6], size: [1, 12] }] }), api = rt.space('lab'), p = rt.player();
  api.setPos(p, [6, 0.25], rt);
  let r = api.slide(p, [3, 0], rt);
  assert.equal(r.blocked.x, true); assert.ok(p.at[0] <= 7.25 + 1e-3, `stopped at the wall: ${p.at}`);
  assert.equal(r.grounded, true); assert.equal(api.grounded(p), true);
  const b = rt.spawn('ball', { at: [3, 6], id: 'b' });
  api.impulse(b, [0, 5], rt);
  assert.ok(api.velocity(b)[1] > 0);
  api.setVelocity(b, [0, 0], rt); assert.deepEqual(api.velocity(b), [0, 0]);
  const w = make({ gravity: [0, 0], edges: { left: 'wrap', right: 'wrap', bottom: 'kill', top: 'solid' } }), wa = w.space('lab');
  const s = w.spawn('ball', { at: [19.9, 6], id: 's', components: { body: { ...ball(0.3), vel: [6, 0] } } });
  const k = w.spawn('ball', { at: [5, 1], id: 'k', components: { body: { ...ball(0.3), vel: [0, -20] } } });
  run(w, 10);
  assert.ok(s.at[0] < 2, `wrapped to the left side: ${s.at}`);
  assert.equal(wa.distance([0.5, 6], [19.5, 6]), 1);
  run(w, 20);
  assert.equal(w.state.counts['out_of_bounds:bottom'], 1);
  assert.ok(k.at[1] < 0);
});

test('physics2d: deterministic replay and exact restore mid-simulation', () => {
  const go = () => { const rt = make(); for (let i = 0; i < 6; i++) rt.spawn(i % 2 ? 'crate' : 'ball', { at: [6 + i * 1.3, 3 + i] }); return rt; };
  const a = go(), b = go();
  run(a, 200); run(b, 200);
  assert.deepEqual(a.snapshot(), b.snapshot());
  const c = go(); run(c, 80); const snap = c.snapshot(); run(c, 120);
  const d = go(); run(d, 10); d.restore(snap); run(d, 120);
  assert.deepEqual(d.snapshot(), c.snapshot(), 'restore (fresh caches, warm starts from state) replays identically');
});

test('physics2d: preflight rejects bad configs with stable codes', () => {
  const { registry, logic } = catalogue();
  const codes = w => preflight(doc(w), registry, logic).errors.map(e => e.code);
  assert.ok(codes({ joints: [{ id: 'j', kind: 'distance', b: 'ghost' }] }).includes('joint_body_unknown'));
  assert.ok(codes({ bodies: [{ id: 'x', at: [1, 1] }], joints: [{ id: 'j', kind: 'revolute', b: 'x' }] }).includes('joint_anchor_missing'));
  assert.ok(codes({ bodies: [{ id: 'x', at: [1, 1] }], joints: [{ id: 'j', kind: 'revolute', b: 'x', anchor: [1, 1], limit: true, lower: 1, upper: 0 }] }).includes('joint_limit_invalid'));
  assert.ok(codes({ walls: [{ kind: 'seg', points: [[0, 0]] }] }).includes('wall_invalid'));
  assert.ok(codes({ bodies: [{ id: 'x', at: [1, 1], body: { shape: { kind: 'blob' } } }] }).includes('shape_invalid'));
  assert.ok(codes({ edges: { left: 'wrap', right: 'open', bottom: 'solid', top: 'solid' } }).includes('edges_wrap_unpaired'));
  assert.ok(codes({ substeps: 9 }).includes('param_range'));
  assert.ok(codes({ joints: [{ id: 'j', kind: 'spring', b: 'x' }] }).includes('param_option'));
});

test('physics2d: every instance in v2/games preflights its params with zero errors', () => {
  for (const f of readdirSync('v2/games').filter(f => f.endsWith('.json'))) {
    const g = JSON.parse(readFileSync(`v2/games/${f}`, 'utf8'));
    for (const s of g.spaces || []) if (s.use === phys.id) { const errors = []; errors.push(...phys.validate(checkFields(phys.card.params, s.with || {}, 'with', errors, null), g, {})); assert.deepEqual(errors, [], `${f} ${s.id}`); }
  }
});
