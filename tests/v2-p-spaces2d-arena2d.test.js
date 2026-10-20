import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spaceConformance, compile, run } from '../v2/kernel/testing.js';
import { checkFields } from '../v2/kernel/params.js';
import { preflight } from '../v2/kernel/document.js';
import { catalogue } from '../v2/primitives/index.js';
import spaces2d from '../v2/primitives/engine/spaces2d.index.js';

const arena = spaces2d.find(p => p.id === 'engine.space.arena2d');
// Fighter boxes (local, x forward from the body centre): a jab reaches 1.2 ahead at chest height.
const POSES = { idle: { hurt: [[-0.5, -1, 1, 2]] }, jab: { hurt: [[-0.5, -1, 1, 2]], hit: [[0.4, 0.2, 0.8, 0.3]] }, crouch: { hurt: [[-0.5, -1, 1, 1.2]], push: [[-0.5, -1, 1, 1.2]] } };
const doc = (w = {}, extra = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'arena', title: 'Arena', seed: 6,
  spaces: [{ id: 'stage', use: 'engine.space.arena2d', with: { size: [20, 10], gravity: -30, solids: [[4, 0, 16, 1]], platforms: [{ x0: 6, x1: 9, y: 3 }], ...w },
    zones: [{ id: 'center', rect: [8, 1, 12, 5] }, { id: 'left', rect: [4, 1, 8, 5] }] }],
  content: { archetypes: [{ id: 'fighter', components: { body: { size: [1, 2], poses: POSES, pose: 'idle', layer: 'fighter' } } },
    { id: 'shot', components: { body: { size: [0.2, 0.2], ballistic: true, gravityScale: 0, collide: false, cull: true } } },
    { id: 'rock', components: { body: { size: [1, 1], ballistic: true, bounce: 0.5 } } }] },
  player: { archetype: 'fighter', at: [7, 2] }, ...extra,
});
const make = (w, extra) => compile(doc(w, extra), { primitives: spaces2d }).rt;

spaceConformance(test, assert, { name: 'engine.space.arena2d', primitives: spaces2d, doc: () => doc(), free: [7, 2], other: [11, 2] });

test('arena2d: slide lands on solids and one-way platforms, drops through, walls block', () => {
  const rt = make(), api = rt.space('stage'), p = rt.player();
  api.setPos(p, [7.5, 6], rt);
  let r = api.slide(p, [0, -5], rt);
  assert.ok(r.grounded && Math.abs(p.at[1] - 4) < 1e-6, `lands on the platform top (y=3): ${p.at}`);
  assert.equal(r.surface, 'platform:0');
  r = api.slide(p, [0, -2], rt, { drop: true });
  assert.ok(Math.abs(p.at[1] - 2) < 1e-5 && r.grounded, `drops through onto the stage: ${p.at}`);
  assert.equal(r.surface, 'solid:0');
  r = api.slide(p, [0, 4], rt);
  assert.equal(r.blocked.y, false, 'jumps up through the platform');
  api.setPos(p, [3, 1.5], rt);
  r = api.slide(p, [3, 0], rt);
  assert.equal(r.blocked.x, true, 'the stage side is solid');
  assert.ok(p.at[0] <= 3.5);
  const rock = rt.spawn('rock', { at: [12, 6] });
  run(rt, 180);
  assert.ok(Math.abs(rock.at[1] - 1.5) < 1e-3 && rock.components.body.grounded, 'ballistic rock bounces to rest on the stage');
  assert.ok(rt.state.counts.landed >= 1);
});

test('arena2d: pose-keyed box sets mirror with facing; boxHits reports attacker → defender', () => {
  const rt = make(), api = rt.space('stage'), p = rt.player();
  const foe = rt.spawn('fighter', { at: [8.4, 2], id: 'foe' });
  foe.components.body.facing = -1;
  assert.deepEqual(api.boxHits(), [], 'idle: no hit boxes');
  api.setPose(p, 'jab');
  const [h] = api.boxHits();
  assert.equal(h.a, 'player'); assert.equal(h.b, 'foe');
  assert.deepEqual(h.boxA.map(v => +v.toFixed(6)), [7.4, 2.2, 8.2, 2.5]);
  p.components.body.facing = -1;
  assert.deepEqual(api.boxHits(), [], 'jab now points away');
  api.setPose(foe, 'jab');
  assert.deepEqual(api.boxHits().map(x => [x.a, x.b]), [['foe', 'player']], 'mirrored hit box reaches back');
  api.setPose(p, 'crouch');
  assert.deepEqual(api.boxHits(), [], 'crouching ducks under the jab');
  api.setBoxes(p, { hurt: [[-2, -1, 4, 2]] }); assert.equal(api.boxHits().length, 1, 'explicit boxes override the pose');
  api.setBoxes(p, null);
  assert.deepEqual(api.overlap({ kind: 'aabb', at: [8.6, 2.3], size: [0.1, 0.1] }, null, 'hit'), [], 'overlap by box kind');
  assert.deepEqual(api.overlap({ kind: 'circle', at: [8.4, 2], r: 0.1 }), ['foe']);
});

test('arena2d: push-apart with wall pushes, leash keeps fighters within the screen', () => {
  const rt = make({ separate: { classes: ['fighter'] }, leash: { classes: ['fighter'], maxSpan: 6 }, edges: { left: 'solid', right: 'solid', bottom: 'solid', top: 'open' } });
  const p = rt.player(), foe = rt.spawn('fighter', { at: [7.6, 2], id: 'foe' });
  run(rt, 1);
  assert.ok(Math.abs(foe.at[0] - p.at[0] - 1) < 1e-9, 'push boxes no longer overlap');
  assert.ok(Math.abs((p.at[0] + foe.at[0]) / 2 - 7.3) < 1e-9, 'each moved half');
  rt.space('stage').setPos(p, [0.5, 6], rt); rt.space('stage').setPos(foe, [0.9, 6], rt);
  run(rt, 1);
  assert.ok(p.at[0] >= 0.5 - 1e-9 && foe.at[0] - p.at[0] >= 1 - 1e-9, `pinned body pushes the other out: ${p.at} ${foe.at}`);
  rt.space('stage').setPos(foe, [14, 6], rt);
  run(rt, 1);
  assert.ok(Math.abs(foe.at[0] - p.at[0]) <= 6 + 1e-9, 'leash');
});

test('arena2d: wrap edges (asteroids) fold positions and distances', () => {
  const rt = make({ gravity: 0, solids: [], platforms: [], edges: { left: 'wrap', right: 'wrap', bottom: 'wrap', top: 'wrap' } }), api = rt.space('stage');
  const rock = rt.spawn('rock', { at: [19.8, 9.8], components: { body: { size: [1, 1], ballistic: true, vel: [6, 6] } } });
  run(rt, 5);
  assert.ok(rock.at[0] < 1 && rock.at[1] < 1, `wrapped: ${rock.at}`);
  assert.equal(api.distance([0.5, 5], [19.5, 5]), 1);
  assert.deepEqual(api.bounds().wrap, [true, true]);
  assert.ok(compile(doc({ gravity: 0, solids: [], platforms: [], edges: { left: 'wrap', right: 'wrap', bottom: 'solid', top: 'solid' } }), { primitives: spaces2d }).checked.capabilities.stage.includes('wrap'));
});

test('arena2d: scroll window clamps and carries the ship, kills stragglers, culls bullets', () => {
  const rt = make({ gravity: 0, solids: [], platforms: [], size: [100, 10], scroll: { axis: 'x', speed: 5, window: [16, 10], clamp: ['fighter'], carry: ['fighter'], kill: 'behind', cull: 1 } }), api = rt.space('stage');
  const p = rt.player(); api.setPos(p, [2, 5], rt);
  const wreck = rt.spawn('rock', { at: [3, 5], id: 'wreck', components: { body: { size: [1, 1] } } });
  const bullet = rt.spawn('shot', { at: [10, 5], id: 'b', components: { body: { size: [0.2, 0.2], ballistic: true, gravityScale: 0, collide: false, cull: true, vel: [20, 0] } } });
  run(rt, 60);
  const b = api.bounds();
  assert.ok(Math.abs(b.min[0] - 5) < 1e-6 && Math.abs(b.max[0] - 21) < 1e-6, `window moved 5 units: ${JSON.stringify(b)}`);
  assert.ok(Math.abs(p.at[0] - 7) < 1e-6, `ship carried with the window: ${p.at}`);
  assert.ok(rt.state.counts.scrolled_out >= 1 && rt.state.events.length >= 0);
  assert.equal(rt.entity('b'), undefined, 'bullet culled outside the window');
  assert.ok(rt.state.counts.culled >= 1);
  api.setPos(p, [-10, 5], rt); run(rt, 1);
  assert.ok(p.at[0] >= api.bounds().min[0] + 0.5 - 1e-9, 'clamped inside the window');
  assert.equal(api.setScroll({ speed: 0 }, rt), true); const at = api.bounds().min[0]; run(rt, 10); assert.equal(api.bounds().min[0], at);
  void wreck;
});

test('arena2d: kill edges, blast zones and ledges', () => {
  const rt = make({ edges: { left: 'open', right: 'open', bottom: 'kill', top: 'open' }, blast: [0, -4, 20, 14] }), api = rt.space('stage');
  const rock = rt.spawn('rock', { at: [2, 3], id: 'r' });
  run(rt, 30);
  assert.equal(rt.state.counts['out_of_bounds:bottom'], 1);
  run(rt, 30);
  assert.equal(rt.state.counts.blasted, 1); assert.equal(rt.state.events.length >= 0, true);
  assert.ok(rock.at[1] < -4);
  assert.deepEqual(api.ledgeNear([3.5, 0.5], [1, 1]), { at: [4, 1], side: -1 });
  assert.deepEqual(api.ledgeNear(rt.player(), [10, 10]).side, -1);
  assert.equal(api.ledgeNear([10, 8], [1, 1]), null);
});

test('arena2d: raycast against solids, platforms and entities', () => {
  const rt = make(), api = rt.space('stage');
  let h = api.raycast([12, 8], [0, -1], 20);
  assert.equal(h.hit, 'cell'); assert.equal(h.solid, 0); assert.equal(h.dist, 7); assert.deepEqual(h.normal, [0, 1]);
  h = api.raycast([7, 8], [0, -1], 20, { oneway: true });
  assert.equal(h.solid, 'platform:0'); assert.equal(h.dist, 5);
  h = api.raycast([0.5, 0.5], [1, 0], 20, { entities: true });
  assert.equal(h.hit, 'cell', 'stage side before the player');
  h = api.raycast([7, 8], [0, -1], 20, { entities: true });
  assert.equal(h.hit, 'entity'); assert.equal(h.id, 'player'); assert.equal(h.dist, 5);
});

test('arena2d: deterministic replay', () => {
  const go = () => { const rt = make({ separate: { classes: ['fighter'] } }); rt.spawn('fighter', { at: [7.5, 6], id: 'foe' }); for (let i = 0; i < 4; i++) rt.spawn('rock', { at: [5 + i * 2, 8] }); run(rt, 120); return rt.snapshot(); };
  assert.deepEqual(go(), go());
});

test('arena2d: preflight rejects bad configs with stable codes', () => {
  const { registry, logic } = catalogue();
  const codes = w => preflight(doc(w), registry, logic).errors.map(e => e.code);
  assert.ok(codes({ solids: [[5, 5, 4, 6]] }).includes('rect_invalid'));
  assert.ok(codes({ platforms: [{ x0: 3, x1: 1, y: 2 }] }).includes('rect_invalid'));
  assert.ok(codes({ scroll: { window: [40, 10] } }).includes('scroll_window_invalid'));
  assert.ok(codes({ scroll: { window: [10, 10] }, edges: { left: 'wrap', right: 'wrap', bottom: 'solid', top: 'solid' } }).includes('scroll_wrap_conflict'));
  assert.ok(codes({ edges: { left: 'wrap', right: 'kill', bottom: 'solid', top: 'solid' } }).includes('edges_wrap_unpaired'));
  assert.ok(codes({ scroll: { axis: 'z', window: [10, 10] } }).includes('param_option'));
  assert.ok(codes({ scroll: { speed: 1 } }).includes('param_missing'));
  assert.ok(codes({ solids: [[1, 2, 3]] }).includes('param_range'));
});

test('arena2d: solid entities (doors, crates) block slide until opened and show up in raycasts', () => {
  const rt = make(), api = rt.space('stage'), p = rt.player();
  const door = rt.spawn('rock', { id: 'door', at: [9, 2.5], components: { mechanism: 'd1', body: { size: [0.5, 3], solid: true } } });
  let r = api.slide(p, [4, 0], rt);
  assert.equal(r.blocked.x, true); assert.deepEqual(r.touched, ['door']);
  assert.ok(Math.abs(p.at[0] - (8.75 - 0.5)) < 1e-5, `stopped at the door: ${p.at}`);
  const h = api.raycast([5, 2], [1, 0], 10);
  assert.equal(h.id, 'door'); assert.equal(h.solid, true); assert.ok(Math.abs(h.dist - 3.75) < 1e-9);
  door.components.body.solid = false;
  r = api.slide(p, [4, 0], rt);
  assert.equal(r.blocked.x, false, 'open door lets it through');
  rt.spawn('rock', { id: 'crate', at: [13, 1.5], components: { body: { size: [1, 1], solid: true } } });
  api.setPos(p, [13, 6], rt);
  r = api.slide(p, [0, -6], rt);
  assert.ok(r.grounded && r.on === 'crate' && r.surface === 'entity:crate' && Math.abs(p.at[1] - 3) < 1e-5, `stands on the crate: ${p.at}`);
});

test('arena2d: a rider on a one-way moving platform is carried; jump through and drop through', () => {
  const rt = make(), api = rt.space('stage');
  const plat = rt.spawn('rock', { id: 'plat', at: [13, 4], components: { body: { size: [3, 0.4], solid: true, oneWay: true, ballistic: true, collide: false, gravityScale: 0, vel: [0, 0] } } });
  const rider = rt.spawn('rock', { id: 'rider', at: [13, 7], components: { body: { size: [1, 1], ballistic: true } } });
  run(rt, 60);
  assert.ok(Math.abs(rider.at[1] - 4.7) < 1e-5 && rider.components.body.standingOn === 'plat', `rides: ${rider.at}`);
  plat.components.body.vel = [-2, 1]; run(rt, 30);
  assert.ok(Math.abs(rider.at[0] - 12) < 1e-5 && Math.abs(rider.at[1] - 5.2) < 1e-4, `carried along: ${rider.at}`);
  plat.components.body.vel = [0, 0];
  const p = rt.player(); api.setPos(p, [12, 2], rt);
  let r = api.slide(p, [0, 4], rt); assert.equal(r.blocked.y, false, 'jumps up through it');
  api.setPos(p, [12, 7], rt); r = api.slide(p, [0, -3], rt); assert.equal(r.on, 'plat');
  r = api.slide(p, [0, -1], rt, { drop: true }); assert.equal(r.on, null, 'drops through');
});

test('arena2d: removeZone and moveZone', () => {
  const rt = make(), api = rt.space('stage');
  assert.ok(rt.test({ zone: 'left' }));
  api.moveZone('left', { rect: [10, 1, 14, 5] }, rt);
  assert.equal(rt.test({ zone: 'left' }), false); assert.ok(rt.state.events.some(e => e.name === 'leave_zone:left'));
  api.addZone({ id: 'hot', rect: [6, 1, 8, 4] }, rt); assert.ok(rt.test({ zone: 'hot' }));
  api.removeZone('hot', rt); assert.equal(rt.test({ zone: 'hot' }), false);
});

test('arena2d: every instance in v2/games preflights its params with zero errors', () => {
  for (const f of readdirSync('v2/games').filter(f => f.endsWith('.json'))) {
    const g = JSON.parse(readFileSync(`v2/games/${f}`, 'utf8'));
    for (const s of g.spaces || []) if (s.use === arena.id) { const errors = []; errors.push(...arena.validate(checkFields(arena.card.params, s.with || {}, 'with', errors, null), g, {})); assert.deepEqual(errors, [], `${f} ${s.id}`); }
  }
});
