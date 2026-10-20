import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, testSpace, run } from '../v2/kernel/testing.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import { preflight } from '../v2/kernel/document.js';
import generators from '../v2/primitives/engine/generate2d.index.js';
import { Raster } from '../v2/primitives/engine/generate2d-lib.js';
import { reachSide, reachTop, movementFor, ROLE } from '../v2/primitives/engine/generate2d-reach.js';

const PRIMS = [testSpace, ...generators];
const KEY = 'spaces.w.generators[0]';
const rooms = () => [
  { id: 'hall', zone: 'a', rect: [0, 0, 30, 20], style: 'hall', gaps: 2, hazards: ['spikes'], exits: [{ side: 'r' }, { side: 't' }], features: [{ kind: 'bench', id: 'bench_1' }, { kind: 'spawn', ref: 'slime', count: 2 }] },
  { id: 'cave', zone: 'a', rect: [30, 0, 60, 20], style: 'cave', platforms: 3, exits: [{ side: 'l' }, { side: 'r', to: 'b' }] },
  { id: 'shaft', zone: 'a', rect: [0, 20, 30, 50], style: 'shaft', exits: [{ side: 'b' }, { side: 'r' }] },
  { id: 'pool', zone: 'a', rect: [30, 20, 60, 40], style: 'flooded', exits: [{ side: 'l' }] },
  { id: 'arena', zone: 'b', rect: [60, 0, 90, 20], style: 'arena', exits: [{ side: 'l', to: 'a' }], features: [{ kind: 'boss_spawn', ref: 'golem' }] },
];
const doc = (w = {}, seed = 3) => ({
  schema: 'gameverse.v2.game/0.2', id: 'rooms', title: 'Rooms', seed,
  spaces: [{ id: 'w', use: 'engine.space.test', with: { size: [100, 60, 1] }, zones: [{ id: 'a', rect: [0, 0, 60, 60] }, { id: 'b', rect: [60, 0, 100, 60] }],
    generators: [{ use: 'engine.generate.tilemap.rooms', with: { rooms: rooms(), ...w } }] }],
  content: { archetypes: [{ id: 'hero', components: {} }, { id: 'slime', components: {} }, { id: 'golem', components: {} }] },
  player: { archetype: 'hero', at: [3, 3] },
});
const codes = d => { const r = new Registry(PRIMS); return preflight(d, r, buildLogic(r, Logic)).errors.map(e => e.code); };

test('tilemap.rooms: generates every room, proves it and announces it', () => {
  const { rt } = compile(doc(), { primitives: PRIMS });
  run(rt, 3);
  const st = rt.store(KEY);
  assert.deepEqual(st.problems, [], JSON.stringify(st.problems));
  assert.equal(rt.state.counts['generated:w'], 1);
  assert.equal(st.rooms.length, 5);
  // Walls on the shell, openings matched between neighbours, a ladder through the shared hall/shaft wall.
  assert.ok(rt.test({ cell: [0, 5], space: 'w', block: 'stone' }));
  const hall = st.rooms.find(r => r.id === 'hall');
  assert.deepEqual(hall.exits.map(e => [e.side, e.peer]), [['r', 'cave'], ['t', 'shaft']]);
  for (const [x, y] of hall.exits[0].cells) assert.equal(rt.space('w').getCell([x, y]), null, 'the shared wall is cut');
  assert.ok(hall.exits[1].cells.some(([x, y]) => rt.space('w').getCell([x, y]) === 'ladder'));
  // Features spawn as entities on reachable tiles, the boss inside its own room.
  assert.equal(rt.entity('bench_1').components.feature.kind, 'bench');
  assert.equal(rt.query('feature').filter(e => e.archetype === 'slime').length, 2);
  const boss = rt.query('feature').find(e => e.archetype === 'golem');
  assert.equal(rt.service('rooms').roomAt(boss.at), 'arena');
  assert.deepEqual(rt.service('rooms:w').graph().edges.length, 4);
});

test('tilemap.rooms: unreachable positions and dangling exits are reported, never hidden', () => {
  const d = doc();
  d.spaces[0].generators[0].with.rooms[3].features = [{ kind: 'chest', at: [45, 38] }]; // in the air under the ceiling
  d.spaces[0].generators[0].with.rooms[4].exits.push({ side: 't' });
  const { rt } = compile(d, { primitives: PRIMS });
  const st = rt.store(KEY), got = st.problems.map(p => p.code);
  assert.ok(got.includes('feature_unreachable'), got.join());
  assert.ok(got.includes('exit_unmatched'), got.join());
  assert.equal(rt.state.counts.generate_problem, st.problems.length);
});

test('tilemap.rooms: the movement model proves jumps, gaps and abilities', () => {
  const floor = () => { const g = new Raster(20, 12, ROLE.EMPTY); g.rect(0, 0, 20, 1, ROLE.SOLID); return g; };
  const at = (g, x, y) => new Map([[y * g.w + x, 'goal']]);
  const plat = h => { const g = floor(); g.rect(8, h, 3, 1, ROLE.SOLID); return g; };
  const base = movementFor({ jumpHeight: 3, jumpDistance: 4 });
  assert.ok(reachSide(plat(3), base, [{ x: 1, y: 1 }], at(plat(3), 9, 4)).hit.has('goal'), 'a 3-high ledge is in reach');
  assert.ok(!reachSide(plat(4), base, [{ x: 1, y: 1 }], at(plat(4), 9, 5)).hit.has('goal'), 'a 4-high ledge is not');
  assert.ok(reachSide(plat(4), movementFor({ jumpHeight: 3 }, ['double_jump']), [{ x: 1, y: 1 }], at(plat(4), 9, 5)).hit.has('goal'));
  const pit = w => { const g = floor(); g.rect(5, 0, w, 1, ROLE.HAZARD); return g; };
  assert.ok(reachSide(pit(3), base, [{ x: 1, y: 1 }], at(pit(3), 15, 1)).hit.has('goal'), 'a 3-wide pit is cleared');
  assert.ok(!reachSide(pit(4), base, [{ x: 1, y: 1 }], at(pit(4), 15, 1)).hit.has('goal'), 'a 4-wide pit is not');
  assert.ok(reachSide(pit(4), movementFor({ jumpHeight: 3, jumpDistance: 4 }, ['ember_step'], { ember_step: { dash: 3 } }), [{ x: 1, y: 1 }], at(pit(4), 15, 1)).hit.has('goal'), 'document abilities extend the model');
  const wall = () => { const g = floor(); g.rect(10, 0, 1, 12, ROLE.SOLID); g.rect(11, 0, 9, 1, ROLE.SOLID); g.set(10, 11, ROLE.EMPTY); return g; };
  assert.ok(!reachSide(wall(), base, [{ x: 1, y: 1 }], at(wall(), 15, 1)).hit.has('goal'));
  assert.ok(reachSide(wall(), movementFor({}, ['climb']), [{ x: 1, y: 1 }], at(wall(), 15, 1)).hit.has('goal'), 'climbing scales the wall');
  const td = new Raster(5, 5, ROLE.EMPTY); td.rect(2, 0, 1, 5, ROLE.WATER);
  assert.ok(!reachTop(td, base, [{ x: 0, y: 0 }], new Map([[4, 'g']])).hit.has('g'));
  assert.ok(reachTop(td, movementFor({}, ['swim']), [{ x: 0, y: 0 }], new Map([[4, 'g']])).hit.has('g'));
});

test('tilemap.rooms: top-down mode generates and proves too', () => {
  const { rt } = compile(doc({ mode: 'topdown' }), { primitives: PRIMS });
  assert.deepEqual(rt.store(KEY).problems, []);
});

test('tilemap.rooms: same seed replays exactly; another seed differs', () => {
  const a = compile(doc(), { primitives: PRIMS }).rt, b = compile(doc(), { primitives: PRIMS }).rt, c = compile(doc({}, 99), { primitives: PRIMS }).rt;
  run(a, 10); run(b, 10); run(c, 10);
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.notDeepEqual(a.snapshot().spaces.w.cells, c.snapshot().spaces.w.cells);
});

test('tilemap.rooms: preflight rejects bad configs with stable codes', () => {
  const d = doc();
  const rs = d.spaces[0].generators[0].with.rooms;
  rs[1].rect = [20, 0, 50, 20];                // overlaps hall
  rs[2].style = 'volcano';                      // unknown style
  rs[3].requiresAbilities = ['teleport_jump'];  // no movement effect
  rs.push({ id: 'tiny', zone: 'b', rect: [90, 50, 93, 52] }, { id: 'out', zone: 'a', rect: [50, 50, 70, 60] });
  const got = codes(d);
  for (const c of ['room_overlap', 'room_style_unknown', 'ability_unknown', 'room_rect_invalid', 'room_outside_zone']) assert.ok(got.includes(c), `${c} in ${got}`);
  const e = doc(); e.spaces[0].generators[0].with.rooms[0].exits[0].side = 'up';
  assert.ok(codes(e).includes('param_option'));
});
