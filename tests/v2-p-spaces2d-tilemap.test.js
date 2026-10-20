import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spaceConformance, compile, run } from '../v2/kernel/testing.js';
import { checkFields } from '../v2/kernel/params.js';
import { preflight } from '../v2/kernel/document.js';
import { catalogue } from '../v2/primitives/index.js';
import spaces2d from '../v2/primitives/engine/spaces2d.index.js';

const tilemap = spaces2d.find(p => p.id === 'engine.space.tilemap');
const BLOCKS = [
  { id: 'stone', solid: true }, { id: 'plank', solid: false, tags: ['one_way'] }, { id: 'ramp', solid: true, slope: [0, 1] },
  { id: 'spikes', solid: false, tags: ['hazard'] }, { id: 'ladder', solid: false, tags: ['climbable'] }, { id: 'water', solid: false, tags: ['liquid'] },
  { id: 'mud', solid: false, moveCost: 5 },
];
// 20×12 side map: floor rows 0-1 with a 3-wide bottomless pit at x 8..10, spikes at x=6,
// a one-way plank at row 4 (x 3..5), a ramp at (12,2) onto a step at (13,2),
// a high ledge at row 6 (x 14..17) and a ladder at x=18 rows 2..6.
function level() {
  const cells = [];
  for (let x = 0; x < 20; x++) if (x < 8 || x > 10) cells.push({ at: [x, 0], block: 'stone' }, { at: [x, 1], block: 'stone' });
  cells.push({ at: [6, 2], block: 'spikes' }, { at: [12, 2], block: 'ramp' }, { at: [13, 2], block: 'stone' });
  for (let x = 3; x <= 5; x++) cells.push({ at: [x, 4], block: 'plank' });
  for (let x = 14; x <= 17; x++) cells.push({ at: [x, 6], block: 'stone' });
  for (let y = 2; y <= 6; y++) cells.push({ at: [18, y], block: 'ladder' });
  return cells;
}
// A tiny generator-shaped primitive used only by these tests: bakes the level through api.bake.
const bakeLevel = { id: 'engine.generate.testlevel', card: { intent: 'test level baker', params: { mode: { type: 'string', default: 'side' } } },
  install(rt, cfg, inst) { rt.space(inst.space).bake(cfg.mode === 'side' ? level() : topLevel(), rt); } };
function topLevel() {
  const c = [];
  for (let x = 0; x < 20; x++) { c.push({ at: [x, 5], block: x === 6 ? 'plank' : x === 9 ? 'water' : 'stone' }); }
  c.push({ at: [3, 2], block: 'mud' });
  return c;
}
const prims = [...spaces2d, bakeLevel];
const doc = (w = {}, extra = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'tm', title: 'Tilemap', seed: 3,
  spaces: [{ id: 'map', use: 'engine.space.tilemap', with: { size: [20, 12], edges: { left: 'solid', right: 'solid', bottom: 'kill', top: 'open' }, ...w },
    generators: [{ use: 'engine.generate.testlevel', with: { mode: w.mode || 'side' } }],
    zones: [{ id: 'start', rect: [0, 2, 6, 6] }, { id: 'ledge', rect: [14, 7, 18, 9] }, { id: 'yard', rect: [0, 2, 20, 12] }] }],
  content: { blocks: BLOCKS, archetypes: [{ id: 'hero', components: { body: { size: [0.8, 0.9] } } }, { id: 'crate', components: { body: { size: [0.8, 0.8], ballistic: true, bounce: 0 } } }] },
  player: { archetype: 'hero', at: [1.5, 2.45] }, ...extra,
});
const make = (w, extra) => compile(doc(w, extra), { primitives: prims }).rt;

spaceConformance(test, assert, { name: 'engine.space.tilemap', primitives: prims, doc: () => doc(), free: [2.5, 2.5], other: [4.5, 2.5], solid: [0.5, 0.5] });

test('tilemap: ballistic bodies fall under gravity, land on floors and one-way planks, emit landed', () => {
  const rt = make();
  const crate = rt.spawn('crate', { at: [4.5, 9] });
  run(rt, 90);
  assert.ok(Math.abs(crate.at[1] - (5 + 0.4)) < 0.01, `rests on the plank top (y=5), got ${crate.at[1]}`);
  assert.equal(crate.components.body.grounded, true);
  assert.ok(rt.state.events.length >= 0 && rt.state.counts.landed >= 1);
  const c2 = rt.spawn('crate', { at: [1.5, 9] });
  run(rt, 90);
  assert.ok(Math.abs(c2.at[1] - 2.4) < 0.01, 'lands on the stone floor');
});

test('tilemap: slide blocks walls, bumps ceilings, drops through one-way, climbs ramps', () => {
  const rt = make(), api = rt.space('map'), p = rt.player();
  // Jump up through the plank from below: one-way does not block upward motion.
  api.setPos(p, [4.5, 2.45], rt);
  let r = api.slide(p, [0, 3], rt);
  assert.equal(r.blocked.y, false); assert.ok(p.at[1] > 5);
  r = api.slide(p, [0, -3], rt);
  assert.ok(r.grounded && Math.abs(p.at[1] - 5.45) < 1e-3, `lands on the plank from above, ${p.at[1]}`);
  r = api.slide(p, [0, -1], rt, { drop: true });
  assert.ok(p.at[1] < 5.45, 'drop-through passes the plank');
  // Wall: walking right into the step at x=13 from the low side is blocked unless on the ramp.
  api.setPos(p, [16.5, 7.45], rt); p.components.body.grounded = true;
  r = api.slide(p, [-5, 0], rt);
  assert.equal(r.moved, true);
  // Ceiling bump: under the ledge (row 6) jumping up from the floor at x=15 hits its bottom.
  api.setPos(p, [15.5, 2.45], rt);
  r = api.slide(p, [0, 4], rt);
  assert.equal(r.blocked.y, true); assert.deepEqual(r.bumped[0], [15, 6]);
  assert.ok(p.at[1] + 0.45 <= 6 + 1e-6);
  // Ramp: walk right from x=11 up the ramp onto the step top (y=3).
  api.setPos(p, [11.3, 2.45], rt); p.components.body.grounded = true;
  for (let i = 0; i < 30; i++) api.slide(p, [0.1, -0.05], rt);
  assert.ok(p.at[0] > 13 && Math.abs(p.at[1] - 3.45) < 0.02, `crested the ramp onto the step: ${p.at}`);
  assert.equal(api.grounded(p), true);
});

test('tilemap: raycast hits floors, slopes and entities with normals', () => {
  const rt = make(), api = rt.space('map');
  let h = api.raycast([2.5, 8], [0, -1], 20);
  assert.equal(h.hit, 'cell'); assert.equal(h.block, 'stone'); assert.ok(Math.abs(h.dist - 6) < 1e-9); assert.deepEqual(h.normal, [0, 1]);
  h = api.raycast([12.75, 8], [0, -1], 20);
  assert.equal(h.block, 'ramp'); assert.ok(Math.abs(h.at[1] - 2.75) < 1e-9, 'exact slope surface');
  assert.ok(h.normal[0] < 0 && h.normal[1] > 0);
  h = api.raycast([0.5, 2.45], [1, 0], 10, { entities: true, ignore: 'player', cells: false });
  assert.equal(h.hit, 'none');
  rt.spawn('crate', { at: [4.5, 2.4], id: 'box' });
  h = api.raycast([0.5, 2.45], [1, 0], 10, { entities: true, ignore: 'player' });
  assert.equal(h.hit, 'entity'); assert.equal(h.id, 'box'); assert.ok(Math.abs(h.dist - 3.6) < 1e-9);
  assert.equal(api.raycast([2.5, 8], [0, -1], 3).hit, 'none', 'maxDist respected');
});

test('tilemap: ability-aware reachability (gaps, heights, climbing, hazards)', () => {
  const rt = make(), api = rt.space('map');
  const can = ab => api.canReach([1.5, 2.45], 'ledge', { abilities: ab, height: 0.9 });
  assert.equal(api.canReach([1.5, 2.45], [15.5, 2.45], { abilities: { jumpDistance: 2 } }), false, 'a 3-wide pit stops a 2-tile jump');
  assert.equal(api.canReach([1.5, 2.45], [15.5, 2.45], { abilities: { jumpDistance: 4 } }), true, 'a 4-tile jump clears it');
  assert.equal(can({ jumpHeight: 3 }), false, 'a 5-high ledge needs more than jumpHeight 3');
  assert.equal(can({ jumpHeight: 3, doubleJump: true }), true, 'double jump reaches it');
  assert.equal(can({ jumpHeight: 3, climb: true }), true, 'the ladder reaches it');
  const reach = api.reachable([1.5, 2.45], rt, { abilities: { jumpHeight: 3 } });
  assert.ok(reach.has('3,5'), 'can jump up through the one-way plank and stand on it');
  assert.ok(!reach.has('6,2'), 'spikes are avoided by default');
  assert.ok(api.reachable([1.5, 2.45], rt, { abilities: { jumpHeight: 3 }, avoid: [] }).has('6,2'));
  assert.equal(api.zoneAt('3,5'), 'start', 'zoneAt accepts reachable keys');
  // envelope alias used by the spatial verifier
  assert.equal(api.canReach([1.5, 2.45], [15.5, 2.45], { envelope: { jumpGap: 4 } }), true);
  const path = api.path([1.5, 2.45], 'ledge', { abilities: { climb: true }, height: 0.9 });
  assert.ok(path && path.length > 5 && api.inZone({ at: path.at(-1) }, 'ledge'), 'A* path ends in the ledge zone');
  assert.equal(api.path([1.5, 2.45], 'ledge', { abilities: { jumpDistance: 1 } }), null);
});

test('tilemap: zones track membership with typed enter/leave events, nested zones', () => {
  const rt = make(), api = rt.space('map'), p = rt.player();
  assert.equal(p.zone, 'start', 'smallest containing zone');
  assert.ok(rt.test({ zone: 'yard' }) && rt.test({ zone: 'start' }));
  api.setPos(p, [15.5, 7.45], rt);
  assert.equal(p.zone, 'ledge');
  assert.ok(rt.state.events.some(e => e.name === 'leave_zone:start') && rt.state.events.some(e => e.name === 'enter_zone:ledge'));
  assert.ok(!rt.state.events.some(e => e.name === 'leave_zone:yard'), 'still inside the outer zone');
  rt.run([{ do: 'teleport', zone: 'start' }]);
  assert.equal(p.zone, 'start'); assert.ok(api.grounded(p), 'teleport places on a standable cell');
  assert.ok(rt.test({ near: 'ledge', within: 15 }) && !rt.test({ near: 'ledge', within: 5 }));
  api.addZone({ id: 'pit', rect: [8, 0, 11, 2] }, rt);
  assert.equal(api.zoneAt([9, 1]), 'pit');
  const snap = rt.snapshot(); rt.restore(snap);
  assert.equal(api.zoneAt([9, 1]), 'pit', 'runtime zones persist in state');
});

test('tilemap: edit log, cell_changed and baked baseline', () => {
  const rt = make(), api = rt.space('map');
  assert.equal(api.editLog().length, 0, 'baked level is not logged');
  assert.equal(api.getCell([2, 0]), 'stone');
  assert.equal(api.setCell([2, 3], 'stone', rt, 'player'), true);
  assert.equal(api.setCell([2, 3], 'stone', rt), false, 'no-op edit');
  assert.equal(rt.state.counts.cell_changed, 1);
  assert.deepEqual(api.editLog()[0], { t: 0, at: [2, 3], layer: 'solid', from: null, to: 'stone', by: 'player' });
  assert.equal(api.raycast([2.5, 8], [0, -1], 20).dist, 4, 'collision sees the edit');
  api.setCell([2, 3], 'water', rt, null, 'bg');
  assert.deepEqual(api.tagsAt([2, 3]), ['liquid']);
  assert.equal(api.cellsIn([[0, 0], [3, 1]]).length, 8);
  assert.equal(api.fill([[0, 9], [3, 9]], 'stone', rt), 4);
  assert.equal(api.setCell([50, 50], 'stone', rt), false, 'out of bounds');
});

test('tilemap: kill edge emits out_of_bounds once; wrap edges fold positions and distances', () => {
  const rt = make(), api = rt.space('map');
  const c = rt.spawn('crate', { at: [9.5, 3] });
  run(rt, 60);
  assert.equal(rt.state.counts['out_of_bounds:bottom'], 1);
  run(rt, 10); assert.equal(rt.state.counts['out_of_bounds:bottom'], 1, 'once per exit');
  assert.ok(c.at[1] < 0);
  const w = make({ edges: { left: 'wrap', right: 'wrap', bottom: 'solid', top: 'solid' } }), wa = w.space('map');
  assert.ok(w.space('map') && compile(doc({ edges: { left: 'wrap', right: 'wrap', bottom: 'solid', top: 'solid' } }), { primitives: prims }).checked.capabilities.map.includes('wrap'));
  wa.setPos(w.player(), [-0.5, 6], w);
  assert.equal(w.player().at[0], 19.5);
  assert.equal(wa.distance([0.5, 6], [19.5, 6]), 1, 'wrap-aware distance');
  assert.deepEqual(wa.delta([19.5, 6], [0.5, 6]), [1, 0]);
});

test('tilemap: top-down mode walls, water, ledges, move costs; no gravity capability', () => {
  const { rt, checked } = compile(doc({ mode: 'topdown', edges: { left: 'solid', right: 'solid', bottom: 'solid', top: 'solid' } }, { player: { archetype: 'hero', at: [1.5, 1.5] } }), { primitives: prims });
  assert.ok(!checked.capabilities.map.includes('gravity'));
  const api = rt.space('map'), p = rt.player();
  let r = api.slide(p, [0, 6], rt);
  assert.equal(r.blocked.y, true); assert.ok(p.at[1] < 5, 'stone row blocks');
  assert.deepEqual(api.gravityAt(p.at), [0, 0, 0]);
  api.setPos(p, [9.5, 3.5], rt); r = api.slide(p, [0, 3], rt);
  assert.equal(r.blocked.y, true, 'water blocks without swim');
  api.slide(p, [0, 3], rt, { swim: true }); assert.ok(p.at[1] > 5, 'swimming crosses water');
  api.setPos(p, [6.5, 7.5], rt); r = api.slide(p, [0, -3], rt);
  assert.ok(p.at[1] < 5, 'ledge hops down');
  r = api.slide(p, [0, 4], rt); assert.equal(r.blocked.y, true, 'ledge blocks going up');
  assert.equal(api.canReach([1.5, 1.5], [1.5, 7.5]), false, 'the ledge cannot be climbed and water needs swim');
  assert.equal(api.canReach([1.5, 7.5], [1.5, 1.5]), true, 'down via the ledge');
  assert.equal(api.canReach([1.5, 1.5], [1.5, 7.5], { swim: true }), true, 'swimming crosses the water');
  const avoidMud = api.path([1.5, 2.5], [5.5, 2.5]);
  assert.ok(!avoidMud.some(([x, y]) => x === 3.5 && y > 2 && y < 3), 'expensive mud is routed around');
});

test('tilemap: deterministic replay with ballistic bodies and edits', () => {
  const go = () => { const rt = make(); rt.spawn('crate', { at: [4.5, 9] }); rt.spawn('crate', { at: [9.2, 6] }); run(rt, 40); rt.space('map').setCell([1, 5], 'stone', rt); run(rt, 40); return rt.snapshot(); };
  assert.deepEqual(go(), go());
});

test('tilemap: preflight rejects bad configs with stable codes', () => {
  const { registry, logic } = catalogue(prims.filter(p => !spaces2d.includes(p)));
  const codes = w => preflight(doc(w), registry, logic).errors.map(e => e.code);
  assert.ok(codes({ mode: 'sideways' }).includes('param_option'));
  assert.ok(codes({ collision: { stone: 'bouncy' } }).includes('collision_invalid'));
  assert.ok(codes({ collisionLayers: ['walls'] }).includes('layer_unknown'));
  assert.ok(codes({ edges: { left: 'wrap', right: 'solid', bottom: 'solid', top: 'solid' } }).includes('edges_wrap_unpaired'));
  assert.ok(codes({ size: [20] }).includes('param_range'));
  const bad = doc(); bad.spaces[0].zones.push({ id: 'oops', rect: [5, 5, 4, 9] }, { id: 'far', rect: [0, 0, 40, 4] });
  const c = preflight(bad, registry, logic).errors.map(e => e.code);
  assert.ok(c.includes('zone_rect_invalid') && c.includes('zone_outside'));
});

test('tilemap: solid entities block slide until opened (doors), raycasts see them', () => {
  const rt = make(), api = rt.space('map'), p = rt.player();
  const door = rt.spawn('crate', { id: 'door', at: [3.5, 3.5], components: { mechanism: 'door1', body: { size: [1, 3], solid: true } } });
  let r = api.slide(p, [3, 0], rt);
  assert.equal(r.blocked.x, true); assert.deepEqual(r.touched, ['door']);
  assert.ok(Math.abs(p.at[0] - (3 - 0.4)) < 1e-3, `stopped at the door: ${p.at}`);
  let h = api.raycast([0.5, 2.5], [1, 0], 10);
  assert.equal(h.hit, 'entity'); assert.equal(h.id, 'door'); assert.equal(h.solid, true); assert.ok(Math.abs(h.dist - 2.5) < 1e-9);
  assert.equal(api.raycast([0.5, 2.5], [1, 0], 20, { solids: false }).hit, 'cell', 'solids:false looks through it (to the step at x=13)');
  door.components.body.solid = false; // the mechanism opens it
  r = api.slide(p, [3, 0], rt);
  assert.equal(r.blocked.x, false); assert.ok(p.at[0] > 4);
  // components.blocker is not an obstacle flag (only the frozen body.solid is).
  delete door.components.body.solid; door.components.blocker = true;
  api.setPos(p, [1.5, 2.45], rt);
  assert.equal(api.slide(p, [3, 0], rt).blocked.x, false, 'components.blocker alone does not block');
  door.components.body.solid = true;
  // A door closing on a body never traps it.
  api.setPos(p, [3.5, 2.45], rt);
  assert.equal(api.slide(p, [2, 0], rt).blocked.x, false);
  // Standing on a solid crate.
  rt.spawn('crate', { id: 'box', at: [15.5, 2.5], components: { body: { size: [1, 1], solid: true } } });
  api.setPos(p, [15.5, 4.5], rt);
  r = api.slide(p, [0, -3], rt);
  assert.ok(r.grounded && r.on === 'box' && Math.abs(p.at[1] - 3.45) < 1e-3, `stands on the crate: ${p.at}`);
  assert.equal(api.grounded(p), true);
});

test('tilemap: riders on a one-way moving platform; jump through from below; drop through', () => {
  const rt = make(), api = rt.space('map');
  const lift = rt.spawn('crate', { id: 'lift', at: [9.5, 3], components: { body: { size: [3, 0.5], solid: true, oneWay: true, ballistic: true, collide: false, gravityScale: 0, vel: [0, 0] } } });
  const rider = rt.spawn('crate', { id: 'rider', at: [9.5, 6] });
  run(rt, 60);
  assert.ok(Math.abs(rider.at[1] - 3.65) < 1e-3 && rider.components.body.standingOn === 'lift', `lands on the platform: ${rider.at}`);
  lift.components.body.vel = [2, 0]; run(rt, 30);
  assert.ok(Math.abs(lift.at[0] - 10.5) < 1e-6 && Math.abs(rider.at[0] - 10.5) < 1e-3, `rider carried sideways: ${rider.at}`);
  lift.components.body.vel = [0, 1.5]; run(rt, 40);
  assert.ok(Math.abs(lift.at[1] - 4) < 1e-6 && Math.abs(rider.at[1] - 4.65) < 1e-3, `rider carried up: ${rider.at}`);
  lift.components.body.vel = [0, 0];
  api.setPos(lift, [10.5, 4.3], rt); run(rt, 1); // moved by someone else without carrying
  assert.ok(Math.abs(rider.at[1] - 4.95) < 1e-3, 'the rider sticks to the platform it stands on');
  api.setPos(lift, [10.5, 4.6], rt, { carry: true });
  assert.ok(Math.abs(rider.at[1] - 5.25) < 1e-3, 'setPos with carry moves riders');
  const p = rt.player(); api.setPos(p, [10.5, 2.45], rt); p.components.body.grounded = true;
  let r = api.slide(p, [0, 3], rt);
  assert.equal(r.blocked.y, false, 'jumps up through the one-way platform');
  api.setPos(p, [9.5, 6], rt);
  r = api.slide(p, [0, -2], rt);
  assert.ok(r.grounded && r.on === 'lift');
  r = api.slide(p, [0, -0.5], rt, { drop: true });
  assert.ok(p.at[1] < 4.6 + 0.45 - 0.1 && !r.on, 'drops through');
});

test('tilemap: navigation treats static solid entities as walls and dynamic ones as passable', () => {
  const td = () => compile(doc({ mode: 'topdown' }, { player: { archetype: 'hero', at: [6.5, 7.5] } }), { primitives: prims }).rt;
  let rt = td(), api = rt.space('map');
  assert.equal(api.canReach([6.5, 7.5], [1.5, 1.5]), true, 'down the ledge');
  rt.spawn('crate', { id: 'boulder', at: [6.5, 4.5], components: { body: { size: [1, 1], solid: true } } });
  assert.equal(api.canReach([6.5, 7.5], [1.5, 1.5]), false, 'a boulder below the ledge blocks the only way');
  assert.equal(api.canReach([6.5, 7.5], [1.5, 1.5], rt, { obstacles: 'none' }), true);
  rt = td(); api = rt.space('map');
  rt.spawn('crate', { id: 'gate', at: [6.5, 4.5], components: { mechanism: 'gate1', body: { size: [1, 1], solid: true } } });
  assert.equal(api.canReach([6.5, 7.5], [1.5, 1.5]), true, 'a mechanism gate is assumed openable');
  assert.equal(api.canReach([6.5, 7.5], [1.5, 1.5], rt, { obstacles: 'all' }), false, 'unless obstacles: all');
  // Side view: a static one-way ledge entity becomes a platform to stand on.
  const s = make(), sa = s.space('map');
  assert.equal(sa.reachable([1.5, 2.45], s).has('1,6'), false);
  s.spawn('crate', { id: 'shelf', at: [1.5, 5.25], components: { body: { size: [2, 0.5], solid: true, oneWay: true } } });
  assert.equal(sa.reachable([1.5, 2.45], s).has('1,6'), true, 'stand on the one-way shelf');
});

test('tilemap: removeZone and moveZone re-evaluate membership and the kernel zone predicate', () => {
  const rt = make(), api = rt.space('map'), p = rt.player();
  api.addZone({ id: 'aura', rect: [10, 0, 12, 4] }, rt);
  assert.equal(rt.test({ zone: 'aura' }), false);
  api.moveZone('aura', { rect: [0, 2, 3, 4] }, rt);
  assert.equal(rt.test({ zone: 'aura' }), true); assert.ok(rt.state.events.some(e => e.name === 'enter_zone:aura'));
  assert.equal(p.zone, 'aura', 'now the smallest zone');
  api.removeZone('aura', rt);
  assert.equal(rt.test({ zone: 'aura' }), false); assert.ok(rt.state.events.some(e => e.name === 'leave_zone:aura'));
  api.moveZone('start', { rect: [10, 2, 12, 4] }, rt); assert.equal(rt.test({ zone: 'start' }), false, 'document zones can move');
  const snap = rt.snapshot(); api.removeZone('start', rt); assert.equal(api.zoneAt([11, 3]), 'yard');
  rt.restore(snap); assert.equal(api.zoneAt([11, 3]), 'start', 'zone edits are state');
  assert.equal(api.removeZone('nope', rt), false);
  assert.throws(() => api.moveZone('ledge', { rect: [1, 2] }, rt));
});

test('tilemap: every instance in v2/games preflights its params with zero errors', () => {
  let n = 0;
  for (const f of readdirSync('v2/games').filter(f => f.endsWith('.json'))) {
    const g = JSON.parse(readFileSync(`v2/games/${f}`, 'utf8'));
    for (const s of g.spaces || []) if (s.use === tilemap.id) {
      const errors = []; const cfg = checkFields(tilemap.card.params, s.with || {}, 'with', errors, null);
      errors.push(...tilemap.validate(cfg, g, {}));
      assert.deepEqual(errors, [], `${f} ${s.id}`); n++;
    }
  }
  assert.ok(n >= 1);
});
