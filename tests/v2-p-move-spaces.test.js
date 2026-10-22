// Movement on the real 2D spaces: engine.space.tilemap (side and top-down) and
// engine.space.arena2d. The controllers only call capability methods, so the
// same primitives that pass on engine.space.test must work here unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeReal, realDoc, picture, run } from './v2-p-move-helpers.js';
import { travel, travelOptions } from '../v2/verify/macros.js';

const L = { '#': 'stone', '=': 'plank', 'H': 'ladder', '~': 'water' };
const side = (rows, systems, o = {}) => realDoc({ space: 'engine.space.tilemap', with: { size: [rows[0].length, rows.length], mode: 'side', edges: { left: 'solid', right: 'solid', bottom: 'kill', top: 'open' } }, cells: picture(rows, L), systems, ...o });
const top = (rows, systems, o = {}) => realDoc({ space: 'engine.space.tilemap', with: { size: [rows[0].length, rows.length], mode: 'topdown' }, cells: picture(rows, L), systems, ...o });
const plat = (w = {}) => ({ use: 'gameplay.move.platformer', with: w });

const SIDE = [
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '....===......####.......',
  '.............####.......',
  '.............####.......',
  '########################',
];

test('tilemap side: platformer runs, jumps onto a block and lands on a one-way plank from below', () => {
  const { rt } = makeReal(side(SIDE, [plat()], { at: [9.5, 1.5] }));
  run(rt, 10, {});
  const p = rt.player();
  assert.ok(p.components.body.grounded && Math.abs(p.at[1] - 1.45) < 0.01, `standing on the floor (${p.at})`);
  rt.step({ actions: { jump: true }, held: { jump: true, right: true } });
  run(rt, 40, { held: { jump: true, right: true } });
  run(rt, 10, {});
  assert.ok(p.at[0] > 13 && Math.abs(p.at[1] - 4.45) < 0.02, `on top of the block (${p.at})`);
  assert.ok(rt.state.counts.landed >= 1);
  const { rt: r2 } = makeReal(side(SIDE, [plat()], { at: [5.5, 1.5] }));
  run(r2, 10, {});
  r2.step({ actions: { jump: true }, held: { jump: true } }); run(r2, 60, { held: { jump: true } });
  assert.ok(Math.abs(r2.player().at[1] - 4.45) < 0.02, `jumped up through the plank and landed on it (${r2.player().at})`);
});

test('tilemap side: NPC platformer follows moveTo along the ability-aware tile path', () => {
  const d = side(SIDE, [plat()], { at: [1.5, 1.5], zones: [{ id: 'block', rect: [13, 4, 17, 7] }], archetypes: [{ id: 'imp', components: { body: { size: [0.8, 0.9] }, move: {} } }] });
  const { rt } = makeReal(d);
  const imp = rt.spawn('imp', { at: [2.5, 1.5] });
  rt.run([{ do: 'move_to', who: imp.id, zone: 'block' }]);
  run(rt, 300, {});
  assert.ok(rt.test({ zone: 'block', who: imp.id }), `imp on the block (${imp.at})`);
  assert.equal(rt.state.counts['arrived:block'], 1);
});

test('tilemap side: ladders (climbable tiles) with walk + climb, liquid tiles with platformer swim', () => {
  const rows = ['............', '............', '.....H......', '.....H......', '.....H......', '.....H......', '############'];
  const { rt } = makeReal(side(rows, [{ use: 'gameplay.move.walk', with: {} }, { use: 'gameplay.move.climb', with: { speed: 3 } }], { at: [5.5, 1.5] }));
  run(rt, 5, {});
  run(rt, 60, { held: { up: true } });
  const p = rt.player();
  assert.equal(p.components.body.state, 'climb');
  assert.ok(p.at[1] > 3, `up the ladder (${p.at})`);
  const pool = ['............', '............', '..~~~~~~~...', '..~~~~~~~...', '..~~~~~~~...', '############'];
  const { rt: r2 } = makeReal(side(pool, [plat({ abilities: { swim: true } })], { at: [5.5, 4.5] }));
  run(r2, 30, {});
  assert.equal(r2.player().components.body.state, 'swim');
  assert.equal(r2.state.counts.submerged, 1);
});

test('tilemap top-down: walls stop walking, water blocks walkers until a swimmer wades in', () => {
  const rows = ['............', '......#..~~~', '......#..~~~', '......#..~~~', '............'];
  const { rt } = makeReal(top(rows, [{ use: 'gameplay.move.walk', with: {} }], { at: [2.5, 2.5] }));
  run(rt, 120, { axes: { move: [1, 0] } });
  assert.ok(Math.abs(rt.player().at[0] - 5.6) < 0.02, `stopped at the wall (${rt.player().at})`);
  const { rt: r2 } = makeReal(top(rows, [{ use: 'gameplay.move.walk', with: {} }], { at: [7.5, 2.5] }));
  run(r2, 90, { axes: { move: [1, 0] } });
  assert.ok(r2.player().at[0] < 8.7, `water blocks a walker (${r2.player().at})`);
  const { rt: r3 } = makeReal(top(rows, [{ use: 'gameplay.move.walk', with: {} }, { use: 'gameplay.move.swim', with: {} }], { at: [7.5, 2.5] }));
  run(r3, 90, { axes: { move: [1, 0] } });
  assert.ok(r3.player().at[0] > 9.5, `swimmer wades in (${r3.player().at})`);
  assert.equal(r3.player().components.body.state, 'swim');
});

test('tilemap top-down: grid lane mode keeps to tile centres (centre anchor offset)', () => {
  const rows = ['#######', '#.....#', '#.###.#', '#.....#', '#######'];
  const { rt } = makeReal(top(rows, [{ use: 'gameplay.move.grid', with: { mode: 'lane', speed: 6 } }], { at: [1.5, 3.5], body: { size: [0.8, 0.8] } }));
  run(rt, 60, { axes: { move: [1, 0] } });
  assert.deepEqual(rt.player().at, [5.5, 3.5], 'ran to the corridor end and stopped');
  run(rt, 60, { axes: { move: [0, -1] } });
  assert.deepEqual(rt.player().at, [5.5, 1.5], 'turned down the side corridor');
});

test('arena2d: platformer on solid rects with arena gravity; ship controllers clamp, wrap and hyperspace', () => {
  const arena = (w, systems, at, body = { size: [0.8, 1] }) => realDoc({ space: 'engine.space.arena2d', with: w, systems, at, body });
  const { rt } = makeReal(arena({ size: [20, 10], gravity: -40, solids: [[0, 0, 20, 1], [8, 1, 10, 3]] }, [plat({ jump: 18 })], [3, 2]));
  run(rt, 20, {});
  const p = rt.player();
  assert.ok(p.components.body.grounded && Math.abs(p.at[1] - 1.5) < 0.02, `on the floor (${p.at})`);
  run(rt, 30, { held: { right: true } });
  assert.ok(p.at[0] < 7.7, 'blocked by the block side');
  rt.step({ actions: { jump: true }, held: { jump: true, right: true } }); run(rt, 50, { held: { jump: true, right: true } });
  assert.ok(Math.abs(p.at[1] - 3.5) < 0.05 || p.at[0] > 10, `over or onto the block (${p.at})`);
  // Eight-way ship clamped to the arena with a margin.
  const { rt: s1 } = makeReal(arena({ size: [300, 400] }, [{ use: 'gameplay.move.ship', with: { mode: 'eightway', speed: 190 } }], [150, 50], { size: [16, 16] }));
  run(s1, 120, { axes: { move: [-1, -1] } });
  assert.deepEqual(s1.player().at, [10, 10]);
  // Inertial ship on a wrapping arena: thrust across the top edge and come back at the bottom.
  const wrapW = { size: [480, 360], edges: { left: 'wrap', right: 'wrap', top: 'wrap', bottom: 'wrap' } };
  const { rt: s2 } = makeReal(arena(wrapW, [{ use: 'gameplay.move.ship', with: { mode: 'inertial', speed: 200, hyperspace: { enabled: true } } }], [240, 300], { size: [18, 18] }));
  let wrapped = false;
  for (let i = 0; i < 120; i++) { const y0 = s2.player().at[1]; s2.step({ axes: { move: [0, 1] } }); if (s2.player().at[1] < y0 - 100) wrapped = true; }
  assert.ok(wrapped, 'wrapped across the edge');
  assert.ok(s2.state.counts.thrust_start >= 1);
  s2.step({ actions: { hyperspace: true } });
  assert.equal(s2.state.counts.hyperspace, 1);
  const at = s2.player().at;
  assert.ok(at[0] >= 30 && at[0] <= 450 && at[1] >= 30 && at[1] <= 330);
});

test('verifier travel macro drives the real platformer along the tilemap path (steer mode uses travel())', async () => {
  const { travel } = await import('../v2/verify/macros.js');
  const d = side(SIDE, [plat()], { at: [1.5, 1.5], zones: [{ id: 'block', rect: [13, 4, 17, 7] }, { id: 'plank', rect: [4, 4, 7, 6] }] });
  const { rt, registry } = makeReal(d);
  run(rt, 5, {});
  assert.equal(travel(rt, registry, 'block', { mode: 'steer' }), true, `steered onto the block (${rt.player().at})`);
  assert.ok(rt.test({ zone: 'block' }));
  // The primitive's own export, given a path straight from the space.
  const prim = registry.get('gameplay.move.platformer');
  const api = rt.space('map'), path = api.path(api.cellOf(rt.player()), 'plank', { envelope: prim.card.envelope({}, new Set()), width: 0.8, height: 0.9 });
  assert.ok(path && path.length > 1);
  assert.equal(prim.travel(rt, path, {}, {}), true, `travelled to the plank (${rt.player().at})`);
});

test('travel macros (verifier): listing makes no path calls; reachable zones are arrived at by the real controller, a sealed one is not', () => {
  const rows = [...SIDE.slice(0, 2), '..........######........', ...SIDE.slice(3)];
  const d = side(rows, [plat()], { at: [1.5, 1.5], zones: [{ id: 'block', rect: [13, 4, 17, 7] }, { id: 'plank', rect: [4, 4, 7, 6] }, { id: 'sky', rect: [11, 12, 15, 14] }] });
  const { rt } = makeReal(d);
  run(rt, 5, {});
  const api = rt.space('map'), calls = { path: 0, reachable: 0 };
  const path = api.path, reachable = api.reachable;
  api.path = (...a) => { calls.path++; return path(...a); };
  api.reachable = (...a) => { calls.reachable++; return reachable(...a); };
  // No game option travels (a person walks there); the verifier's travel macros list the zones and plan on use.
  assert.deepEqual(rt.availableOptions().filter(o => /^travel/.test(o.label)).map(o => o.label), []);
  const provider = travelOptions(rt.registry, { mode: 'steer' });
  rt.options(provider);
  const first = rt.availableOptions().filter(o => o.zone !== undefined).map(o => o.zone);
  assert.deepEqual(first, rt.availableOptions().filter(o => o.zone !== undefined).map(o => o.zone));
  assert.equal(calls.path, 0, 'no path planning while listing');
  assert.deepEqual([...first].sort(), ['block', 'plank', 'sky']);
  const snap = rt.snapshot();
  assert.equal(travel(rt, rt.registry, 'block', { mode: 'steer' }), true, `arrived at the block (${rt.player().at})`);
  assert.ok(calls.path >= 1, 'planned on use');
  rt.restore(snap);
  assert.equal(travel(rt, rt.registry, 'sky', { mode: 'steer' }), false, 'the sealed sky zone is not reached');
});

test('real spaces: deterministic replay (tilemap side platformer)', () => {
  const mk = () => makeReal(side(SIDE, [plat({ abilities: { doubleJump: true, dash: true } })], { at: [2.5, 1.5] })).rt;
  const a = mk(), b = mk();
  for (let i = 0; i < 300; i++) { const inp = { held: { right: i % 120 < 80, left: i % 120 >= 80, jump: i % 37 < 14 }, actions: { jump: i % 37 === 0 || i % 37 === 16, dash: i % 91 === 0 } }; a.step(inp); b.step(inp); }
  assert.deepEqual(a.snapshot(), b.snapshot());
});
