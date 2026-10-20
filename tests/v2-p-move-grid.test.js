// gameplay.move.grid on engine.space.grid (and engine.space.test): Pac-Man lane
// movement and creature/hop step movement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeReal, realDoc, picture, run, move, testSpace, doc, make } from './v2-p-move-helpers.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import { preflight } from '../v2/kernel/document.js';
import spaces2d from '../v2/primitives/engine/spaces2d.index.js';
import { BASE_SPEED, CORNER } from '../v2/primitives/gameplay/move-grid.js';

const L = { '#': 'stone', 'v': 'ledge', 'D': 'door', 'T': 'tunnel' };
const MAZE = ['#########', '#.......#', '#.#.#.#.#', '#.......#', '#########'];
const board = (rows, w, o = {}) => realDoc({ space: 'engine.space.grid', with: { size: [rows[0].length, rows.length], rules: o.rules || {} }, cells: picture(rows, L), body: { size: [1, 1] }, systems: [{ use: 'gameplay.move.grid', with: w }], at: o.at || [1, 1], zones: o.zones || [], archetypes: o.archetypes || [] });
const near = (a, b, eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < eps);

test('grid lane: constants ported from the maze kit', () => {
  assert.equal(BASE_SPEED, 9.47); assert.equal(CORNER, 0.45);
  const { checked } = makeReal(board(MAZE, { mode: 'lane' }));
  assert.ok(Math.abs(checked.doc.systems[0].with.speed - 0.8 * 9.47) < 1e-6);
});

test('grid lane: runs along the lane and stops at the wall; reverses instantly', () => {
  const { rt } = makeReal(board(MAZE, { mode: 'lane', speed: 6 }));
  const p = rt.player();
  run(rt, 10, { axes: { move: [1, 0] } });
  assert.ok(near(p.at, [2, 1]), `6 cells/s for 1/6 s (${p.at})`);
  run(rt, 60, {});
  assert.deepEqual(p.at, [7, 1], 'kept going on the buffered direction until the wall');
  assert.equal(p.components.body.state, 'idle');
  run(rt, 10, { axes: { move: [-1, 0] } });
  rt.step({ axes: { move: [1, 0] } });
  assert.ok(p.components.body.vel[0] > 0, 'reversed on the spot');
});

test('grid lane: a turn pressed early is buffered and taken at the junction; corner window', () => {
  const { rt } = makeReal(board(MAZE, { mode: 'lane', speed: 6 }));
  const p = rt.player();
  run(rt, 12, { axes: { move: [1, 0] } });
  rt.step({ axes: { move: [0, 1] } });
  run(rt, 60, {});
  assert.deepEqual(p.at, [3, 3], 'turned up at x=3 and ran to the top corridor');
  assert.equal(rt.state.counts.turned, 1);
  // Past the centre by more than CORNER: the turn waits for the next junction.
  const { rt: r2 } = makeReal(board(MAZE, { mode: 'lane', speed: 6, corner: 0.2 }));
  run(r2, 21, { axes: { move: [1, 0] } }); // x ≈ 3.1..3.3
  const x = r2.player().at[0];
  r2.step({ axes: { move: [0, 1] } }); run(r2, 60, {});
  assert.ok(x - 3 > 0.2 ? r2.player().at[0] === 5 : r2.player().at[0] === 3, `turn ${x - 3 > 0.2 ? 'deferred to x=5' : 'taken at 3'} (${r2.player().at})`);
});

test('grid lane: the space speed rule slows tunnels; class-only doors via cell rules', () => {
  const rows = ['#########', '#TTTTTTT#', '#########'];
  const { rt } = makeReal(board(rows, { mode: 'lane', speed: 6 }, { rules: { tunnel: { speed: 0.5 } } }));
  run(rt, 20, { axes: { move: [1, 0] } });
  assert.ok(Math.abs(rt.player().at[0] - 2) < 0.05, `half speed in the tunnel (${rt.player().at})`);
  const doorRows = ['#####', '#.D.#', '#####'];
  const d = board(doorRows, { mode: 'step' }, { rules: { door: { pass: ['ghost'] } }, archetypes: [{ id: 'ghost', components: { body: { size: [1, 1] }, move: {} } }] });
  const { rt: r2 } = makeReal(d);
  run(r2, 30, { axes: { move: [1, 0] } });
  assert.deepEqual(r2.player().at, [1, 1], 'the player may not pass the house door');
  assert.ok(r2.state.counts.bump >= 1);
  const g = r2.spawn('ghost', { at: [3, 1] });
  r2.run([{ do: 'move_to', who: g.id, at: [1, 1] }]);
  r2.player().at = [3, 1]; r2.space('map').setPos(r2.player(), [3, 1], r2);
  run(r2, 40, {});
  assert.equal(r2.state.counts.arrived, 1, `ghost walked through the door (${g.at})`);
});

test('grid step: walk 8 frames, run 4, turn in place, queued hops', () => {
  const { rt } = makeReal(board(MAZE, { mode: 'step', turnFrames: 4 }));
  const p = rt.player();
  rt.step({ axes: { move: [0, 1] } });
  assert.deepEqual(p.at, [1, 1], 'a tap toward a new direction only turns');
  assert.equal(rt.state.counts.turned, 1);
  run(rt, 4, {});
  run(rt, 16, { axes: { move: [1, 0] } });
  assert.ok(p.at[0] >= 2 && p.at[0] <= 3, `walking ≈ one cell per 8 frames (${p.at})`);
  const x0 = p.at[0];
  run(rt, 16, { axes: { move: [1, 0] }, held: { run: true } });
  assert.ok(p.at[0] - x0 >= 3, `running is twice as fast (${p.at[0] - x0})`);
  const { rt: r2 } = makeReal(board(MAZE, { mode: 'step', queue: true }));
  r2.step({ actions: { right: true } });
  r2.step({});
  r2.step({ actions: { right: true } });
  run(r2, 20, {});
  assert.deepEqual(r2.player().at, [3, 1], 'the press mid-hop was queued');
});

test('grid step: one-way ledges are jumped going down and bump going up', () => {
  const rows = ['#####', '#...#', '#.v.#', '#...#', '#####'];
  const { rt } = makeReal(board(rows, { mode: 'step' }, { at: [2, 3] }));
  run(rt, 20, { axes: { move: [0, -1] } });
  assert.equal(rt.state.counts.ledge_jump, 1);
  assert.deepEqual(rt.player().at, [2, 1], 'landed beyond the ledge');
  run(rt, 30, { axes: { move: [0, 1] } });
  assert.deepEqual(rt.player().at, [2, 1], 'cannot climb back up');
  assert.ok(rt.state.counts.bump >= 1);
});

test('grid: NPC moveTo across the board, travel macro, unique option labels; test space too', () => {
  const d = board(MAZE, { mode: 'lane', speed: 8 }, { zones: [{ id: 'corner', rect: [7, 3, 8, 4] }], archetypes: [{ id: 'ghost', components: { body: { size: [1, 1] }, move: {} } }] });
  const { rt } = makeReal(d);
  const g = rt.spawn('ghost', { at: [1, 3] });
  rt.run([{ do: 'move_to', who: g.id, zone: 'corner' }]);
  run(rt, 120, {});
  assert.equal(rt.state.counts['arrived:corner'], 1, `ghost reached the corner (${g.at})`);
  const labels = rt.availableOptions().map(o => o.label);
  assert.equal(new Set(labels).size, labels.length);
  assert.ok(labels.includes('travel to corner') && labels.includes('step up'));
  const o = rt.availableOptions().find(o => o.label === 'travel to corner');
  assert.equal(o.apply(rt).ok, true);
  const { rt: t } = make(doc({ gravity: 0, size: [6, 6, 1], solid: [], at: [0, 0, 0], body: { size: [1, 1, 1] }, systems: [{ use: 'gameplay.move.grid', with: { mode: 'step' } }] }));
  run(t, 24, { axes: { move: [1, 0] } });
  assert.deepEqual(t.player().at, [3, 0, 0], 'test space: 3 steps in 24 frames');
});

test('grid: deterministic replay and stable preflight codes', () => {
  const mk = () => makeReal(board(MAZE, { mode: 'lane' })).rt;
  const a = mk(), b = mk();
  for (let i = 0; i < 400; i++) { const inp = { axes: { move: [[1, 0], [0, 1], [-1, 0], [0, -1]][Math.floor(i / 37) % 4] } }; a.step(inp); b.step(inp); }
  assert.deepEqual(a.snapshot(), b.snapshot());
  const reg = new Registry([...spaces2d, testSpace, ...move]), logic = buildLogic(reg, Logic);
  const codes = w => preflight(board(MAZE, w), reg, logic).errors.map(e => e.code);
  assert.ok(codes({ mode: 'slide' }).includes('param_option'));
  assert.ok(codes({ corner: 0.9 }).includes('param_range'));
  assert.ok(codes({ walkFrames: 2.5 }).includes('param_type'));
});
