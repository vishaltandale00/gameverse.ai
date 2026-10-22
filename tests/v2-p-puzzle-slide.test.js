import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, run, testSpace } from '../v2/kernel/testing.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import { preflight } from '../v2/kernel/document.js';
import slide, { slideGrid, solverKey } from '../v2/primitives/gameplay/slide-merge.js';

const PRIMS = [testSpace, slide];
const doc = (w = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'tiles', title: 'Tiles', seed: 11,
  spaces: [{ id: 'b', use: 'engine.space.test', with: { size: [4, 4, 1] } }],
  systems: [{ use: 'gameplay.slide.merge', with: { board: { name: 'board', at: [0, 0, 0], size: [4, 4], axes: [0, 1], fall: -1 }, slideFrames: 0, ...w } }],
});
const row = (rt, y) => [0, 1, 2, 3].map(x => rt.space('b').getCell([x, y, 0]));

test('slide: merges once per move and spawns a tile after a move', () => {
  const { rt, checked } = compile(doc({ layout: ['1111', '....', '....', '....'], start: 0 }), { primitives: PRIMS });
  assert.ok(checked.ok);
  assert.deepEqual(row(rt, 3), ['2', '2', '2', '2']);
  rt.step({ actions: { slide: 'left' } });
  assert.deepEqual(row(rt, 3).slice(0, 2), ['4', '4'], 'pairs merge once: 2222 -> 44');
  assert.equal(rt.state.vars.score, 8);
  assert.equal(rt.state.counts['merged:4'], 2);
  assert.equal(rt.space('b').cellsIn([[0, 0, 0], [3, 3, 0]]).length, 3, 'one tile spawned');
  assert.equal(rt.state.counts.move, 1);
  assert.equal(rt.service('board').get(0, 3), '4', 'board service reads y-up board-local cells');
});

test('slide: rocks split lines; a blocked direction is not a move and not an option', () => {
  const r = slideGrid([2, -1, 2, 0], 4, 1, 'left');
  assert.deepEqual(r.grid, [2, -1, 2, 0]);
  assert.equal(r.moved, false);
  assert.deepEqual(slideGrid([2, 2, 4, 4], 4, 1, 'right').grid, [0, 0, 4, 8]);
  const { rt } = compile(doc({ layout: ['1x..', '....', '....', '....'], start: 0 }), { primitives: PRIMS });
  rt.step({ actions: { slide: 'left' } });
  assert.equal(rt.state.counts.slide_blocked, 1);
  assert.deepEqual(rt.availableOptions().map(o => o.actions.slide).sort(), ['down']);
});

test('slide: a move that leaves no merge or space ends in onStuck', () => {
  const { rt } = compile(doc({ layout: ['1212', '2121', '1212', '.312'], start: 0, spawnFour: 0 }), { primitives: PRIMS });
  rt.step({ actions: { slide: 'left' } });
  assert.equal(rt.state.counts.board_stuck, 1);
  assert.equal(rt.state.status, 'lost');
});

test('slide: deterministic replay through options; target tile event', () => {
  const play = () => { const { rt } = compile(doc({ target: 8 }), { primitives: PRIMS }); for (let i = 0; i < 40 && rt.state.status === 'playing'; i++) { const o = rt.availableOptions(); rt.step({ actions: o[i % o.length].actions }); } return rt; };
  const a = play(), b = play();
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.equal(solverKey(a), solverKey(b));
  assert.ok(a.state.vars['slide.max'] >= 8);
  assert.equal(a.state.counts['tile_reached:8'] ?? a.state.counts['tile_reached:16'], 1);
});

test('slide: move limit and input queued during the slide animation', () => {
  const { rt } = compile(doc({ moves: 2, slideFrames: 3, layout: ['1...', '....', '....', '...1'], start: 0 }), { primitives: PRIMS });
  rt.step({ actions: { slide: 'right' } });
  rt.step({ actions: { slide: 'up' } });
  run(rt, 4);
  assert.equal(rt.state.counts.slid, 2);
  assert.equal(rt.state.vars['slide.moves'], 0);
  assert.equal(rt.state.status, 'lost');
});

test('slide: preflight rejects bad configs with stable codes', () => {
  const registry = new Registry(PRIMS), logic = buildLogic(registry, Logic);
  const codes = w => preflight(doc(w), registry, logic).errors.map(e => e.code);
  assert.ok(codes({ layout: ['11'] }).includes('slide_layout_size'));
  assert.ok(codes({ layout: ['1z..', '....', '....', '....'] }).includes('param_pattern'), 'layout characters are the declared pattern');
  assert.ok(codes({ rocks: 5 }).includes('slide_rocks'));
  assert.ok(codes({ target: 100 }).includes('slide_target'));
  assert.ok(codes({ spawnFour: 2 }).includes('param_range'));
});
