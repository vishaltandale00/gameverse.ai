// gameplay.ai.traffic and gameplay.ai.crowd on a road graph shaped like
// worlds3d's `roadgraph` service (nodes/edges, optional lane geometry).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compile, run, testSpace } from '../v2/kernel/testing.js';
import { catalogue } from '../v2/primitives/index.js';
import { preflight } from '../v2/kernel/document.js';
import AI from '../v2/primitives/gameplay/ai.index.js';

// 3×3 street lattice, 40 m blocks; the centre junction is signalized.
const lattice = (explicitLanes = false) => {
  const nodes = [], edges = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) nodes.push({ id: `n${i}${j}`, at: [20 + 40 * i, 20 + 40 * j, 0], light: i === 1 && j === 1 });
  const add = (a, b) => {
    const A = nodes.find(n => n.id === a).at, B = nodes.find(n => n.id === b).at, id = `${a}-${b}`;
    const e = { id, from: a, to: b, points: [A, B], width: 6, sidewalk: 2, speed: 36 };
    if (explicitLanes) { const d = [Math.sign(B[0] - A[0]), Math.sign(B[1] - A[1])], r = [d[1], -d[0]];
      e.lanes = [{ id: `${id}:f0`, dir: 1, index: 0, from: a, to: b, speed: 10, points: [[A[0] + r[0] * 1.5, A[1] + r[1] * 1.5, 0], [B[0] + r[0] * 1.5, B[1] + r[1] * 1.5, 0]] },
        { id: `${id}:b0`, dir: -1, index: 0, from: b, to: a, speed: 10, points: [[B[0] - r[0] * 1.5, B[1] - r[1] * 1.5, 0], [A[0] - r[0] * 1.5, A[1] - r[1] * 1.5, 0]] }]; }
    edges.push(e);
  };
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { if (i < 2) add(`n${i}${j}`, `n${i + 1}${j}`); if (j < 2) add(`n${i}${j}`, `n${i}${j + 1}`); }
  return { nodes, edges };
};
const roads = { id: 'engine.generate.testroads', card: { ambient: true, intent: 'test road graph', params: { lanes: { type: 'boolean', default: false } }, provides: { services: ['roadgraph'] } },
  install(rt, cfg) { const g = lattice(cfg.lanes); const fn = () => g; fn.graph = () => g; rt.provide('roadgraph', fn); } };
const P = [...AI, testSpace, roads];
const doc = ({ traffic, crowd, lanes = false, player = [60, 60, 0] } = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'city', title: 'City', seed: 8,
  spaces: [{ id: 'w', use: 'engine.space.test', with: { size: [140, 140, 1] }, generators: [{ use: 'engine.generate.testroads', with: { lanes } }] }],
  systems: [...(traffic ? [{ use: 'gameplay.ai.traffic', with: { archetypes: [{ archetype: 'sedan' }], spawnRadius: [0, 100], despawnRadius: 150, ...traffic } }] : []),
    ...(crowd ? [{ use: 'gameplay.ai.crowd', with: { archetypes: [{ archetype: 'walker' }], spawnRadius: [0, 80], despawnRadius: 150, ...crowd } }] : [])],
  content: { archetypes: [{ id: 'hero', components: {} }, { id: 'sedan', kind: 'vehicle', components: { body: { size: [1, 1, 1] } } }, { id: 'walker', kind: 'npc', components: { ai: { brain: [{ do: 'wander' }], speed: 1.4, crowd: true } } }] },
  player: { archetype: 'hero', at: player },
});
const cars = rt => Object.values(rt.state.entities).filter(e => e.components.traffic);
const peds = rt => Object.values(rt.state.entities).filter(e => e.components.crowdAgent);
/** Distance from p to the nearest street centreline (lattice lines x/y ∈ {20, 60, 100}). */
const nearNode = p => [20, 60, 100].some(x => [20, 60, 100].some(y => Math.hypot(p[0] - x, p[1] - y) < 6.5));
const offLine = p => { const dx = Math.min(...[20, 60, 100].map(v => Math.abs(p[0] - v))), dy = Math.min(...[20, 60, 100].map(v => Math.abs(p[1] - v))); return Math.min(dx, dy); };

for (const lanes of [false, true]) test(`traffic: cars spawn on lanes and drive lane to lane (${lanes ? 'explicit' : 'synthesized'} lanes)`, () => {
  const { rt } = compile(doc({ traffic: { maxCars: 10, density: 1 }, lanes }), { primitives: P });
  run(rt, 30);
  assert.equal(cars(rt).length, 10);
  const prev = new Map(cars(rt).map(e => [e.id, e.at.slice()]));
  let maxStep = 0;
  for (let i = 0; i < 600; i++) { rt.step(); for (const e of cars(rt)) { const p = prev.get(e.id); if (p) maxStep = Math.max(maxStep, Math.hypot(e.at[0] - p[0], e.at[1] - p[1])); prev.set(e.id, e.at.slice()); if (!nearNode(e.at)) assert.ok(Math.abs(offLine(e.at) - 1.5) < 0.05, `on its lane: ${e.at}`); } }
  assert.ok(maxStep <= 10 * 1.6 / 60 + 0.05, `kinematic lane motion (max step ${maxStep})`);
  const moved = cars(rt).filter(e => e.components.body.vel.some(v => Math.abs(v) > 1)).length;
  assert.ok(moved >= 3, 'cars are moving');
});

test('traffic: following keeps a gap, red lights stop cars, the player blocks a lane, panic speeds them up', () => {
  const { rt } = compile(doc({ traffic: { maxCars: 0, lightCycle: 3, amber: 0 }, player: [80, 80, 0] }), { primitives: P });
  rt.step();
  const S = () => rt.store('gameplay.ai.traffic');
  // Two cars on the same lane heading for the signal at n11 (lane n01-n11:f0 runs +x along y=60).
  const lead = rt.spawn('sedan', { at: [30, 58.5, 0], components: { traffic: true } }), tail = rt.spawn('sedan', { at: [22, 58.5, 0], components: { traffic: true } });
  S().cars[lead.id] = { lane: 'n01-n11:f0', s: 12, v: 0, panic: 0 }; S().cars[tail.id] = { lane: 'n01-n11:f0', s: 4, v: 0, panic: 0 };
  let minGap = Infinity, stoppedAtRed = false;
  for (let i = 0; i < 600; i++) {
    rt.step();
    const a = S().cars[lead.id], b = S().cars[tail.id];
    if (a && b && a.lane === b.lane) minGap = Math.min(minGap, a.s - b.s);
    // Axis 0 (x) is green on even cycles; on odd cycles the lead must hold at the stop line.
    if (Math.floor(rt.state.time / 3) % 2 === 1 && a?.lane === 'n01-n11:f0' && a.v < 0.01 && 40 - a.s < 7) stoppedAtRed = true;
  }
  assert.ok(minGap >= 4.5, `gap kept: ${minGap}`);
  assert.ok(stoppedAtRed, 'the lead car held at the red light'); assert.ok(rt.state.counts.light_changed >= 3);
  // Player standing in a lane: an oncoming car stops behind them, and a fast car hitting them reports a collision.
  const { rt: r2 } = compile(doc({ traffic: { maxCars: 0 }, player: [70, 21.5, 0] }), { primitives: P });
  r2.step();
  const c = r2.spawn('sedan', { at: [40, 21.5, 0], components: { traffic: true } });
  r2.store('gameplay.ai.traffic').cars[c.id] = { lane: 'n00-n10:f0', s: 0, v: 10, panic: 0 };
  // Lane n00-n10:f0 runs +x at y = 20 - 1.5 (right of +x is -y in this planar map).
  r2.space('w').setPos(r2.player(), [32, 18.5, 0], r2);
  run(r2, 240);
  assert.ok(c.at[0] < 32, `stopped short of the player: ${c.at}`);
  const { rt: r3 } = compile(doc({ traffic: { maxCars: 0 } }), { primitives: P });
  r3.step();
  const f = r3.spawn('sedan', { at: [22, 18.5, 0], components: { traffic: true } });
  r3.store('gameplay.ai.traffic').cars[f.id] = { lane: 'n00-n10:f0', s: 2, v: 10, panic: 0 };
  r3.emit('shots_fired', { at: [25, 20, 0] }); run(r3, 60);
  assert.equal(r3.state.counts.traffic_panic, 1); assert.ok(r3.store('gameplay.ai.traffic').cars[f.id].v > 10.5, 'panicked cars drive faster');
});

test('crowd: pedestrians stroll sidewalks, keep apart, panic away from gunfire', () => {
  const { rt } = compile(doc({ crowd: { maxPeds: 12, density: 1 } }), { primitives: P });
  run(rt, 30);
  assert.equal(peds(rt).length, 12);
  for (const e of peds(rt)) if (!nearNode(e.at)) assert.ok(Math.abs(offLine(e.at) - 4) < 0.6, `on a sidewalk: ${e.at}`);
  const start = new Map(peds(rt).map(e => [e.id, e.at.slice()]));
  run(rt, 300);
  assert.ok(peds(rt).filter(e => Math.hypot(e.at[0] - start.get(e.id)[0], e.at[1] - start.get(e.id)[1]) > 2).length >= 8, 'they walk');
  assert.ok(peds(rt).every(e => offLine(e.at) < 6), 'and stay by the streets');
  assert.equal(rt.state.prim['gameplay.ai.brain'], undefined, 'no brain needed (and none drives them)');
  const near = peds(rt).map(e => ({ e, d: Math.hypot(e.at[0] - 60, e.at[1] - 60) })).filter(x => x.d < 30);
  rt.emit('shots_fired', { at: [60, 60, 0] }); run(rt, 90);
  assert.ok(rt.state.counts.crowd_panic === 1);
  for (const { e, d } of near) if (rt.entity(e.id)) assert.ok(Math.hypot(e.at[0] - 60, e.at[1] - 60) > d, 'ran away from the shots');
});

test('crowd without roads wanders reachable ground near where it appeared; both replay deterministically', () => {
  const d = doc({ crowd: { maxPeds: 6, density: 1, wanderRadius: 6 } }); delete d.spaces[0].generators;
  const { rt } = compile(d, { primitives: P });
  run(rt, 20); const homes = new Map(peds(rt).map(e => [e.id, e.at.slice()]));
  run(rt, 600);
  for (const e of peds(rt)) if (homes.has(e.id)) assert.ok(Math.hypot(e.at[0] - homes.get(e.id)[0], e.at[1] - homes.get(e.id)[1]) < 13);
  const make = () => compile(doc({ traffic: { maxCars: 8, density: 1 }, crowd: { maxPeds: 8, density: 1 } }), { primitives: P }).rt;
  const a = make(), b = make(); run(a, 300); run(b, 300);
  assert.deepEqual(a.snapshot(), b.snapshot());
});

test('preflight: bad traffic/crowd configs and a missing road graph are rejected with stable codes', () => {
  const { registry, logic } = catalogue([testSpace, roads]);
  const bad = doc({ traffic: { spawnRadius: [50, 10], despawnRadius: 5, archetypes: [{ archetype: 'tank' }] }, crowd: { spawnRadius: [5, 100], despawnRadius: 50 } });
  const codes = preflight(bad, registry, logic).errors.map(e => e.code);
  // spawnRadius [inner, outer] out of order is the card's cross-field rule traffic_spawn_radius (was the kernel's param_range).
  for (const c of ['traffic_spawn_radius', 'traffic_despawn_radius', 'ref_unknown', 'crowd_despawn_radius']) assert.ok(codes.includes(c), c);
  const noRoads = doc({ traffic: {} }); delete noRoads.spaces[0].generators;
  assert.ok(preflight(noRoads, registry, logic).errors.some(e => e.code === 'service_missing'));
});

test('every traffic/crowd instance in v2/games preflights without param errors', () => {
  const { registry, logic } = catalogue();
  for (const f of fs.readdirSync('v2/games')) {
    const d = JSON.parse(fs.readFileSync(`v2/games/${f}`, 'utf8'));
    const mine = (d.systems || []).map((s, i) => [s, `systems[${i}]`]).filter(([s]) => ['gameplay.ai.traffic', 'gameplay.ai.crowd'].includes(s.use)).map(x => x[1]);
    const errs = preflight(d, registry, logic).errors.filter(e => mine.some(p => e.path === p || e.path?.startsWith(p + '.')));
    assert.deepEqual(errs.filter(e => !['capability_missing', 'service_missing'].includes(e.code)), [], f);
  }
});
