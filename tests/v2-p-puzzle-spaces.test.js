// Puzzle primitives on the real spaces (engine.space.grid / tilemap / physics2d / none).
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, run } from '../v2/kernel/testing.js';
import { PRIMITIVES } from '../v2/primitives/index.js';
import { applyOption } from '../v2/verify/drive.js';

const go = d => compile(d, { primitives: PRIMITIVES });
const base = (spaces, systems, extra = {}) => ({ schema: 'gameverse.v2.game/0.2', id: 'real', title: 'Real', seed: 9, spaces, systems, ...extra });
/** A match board's gem colours: content.blocks ids the document defines (gameplay.match colors is a required reference list). */
const GEMS = ['red', 'orange', 'yellow', 'green', 'blue'];
const board = (w, h, more = {}) => ({ name: 'board', at: [0, 0], size: [w, h], axes: [0, 1], fall: -1, ...more });

test('real grid: guideline falling pieces play through options and replay deterministically', () => {
  const doc = base([{ id: 'g', use: 'engine.space.grid', with: { size: [10, 24] } }], [{ use: 'gameplay.falling.pieces', with: { board: board(10, 24), clearFrames: 0 } }]);
  const play = () => { const { rt } = go(doc); for (let i = 0; i < 25 && rt.state.status === 'playing'; i++) { let o = rt.availableOptions(); for (let k = 0; k < 10 && !o.length; k++) { rt.step(); o = rt.availableOptions(); } if (!o.length) break; applyOption(rt, o[(i * 7) % o.length]); } return rt; };
  const a = play(), b = play();
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.ok(a.state.counts.piece_locked >= 10);
  assert.ok(a.space('g').editLog().length > 0, 'cells written through the grid');
  const labels = a.availableOptions().map(o => o.label);
  assert.equal(new Set(labels).size, labels.length, 'option labels are unique');
});

test('real grid: puyo pairs pop and settle through the grid settle capability', () => {
  const doc = base([{ id: 'g', use: 'engine.space.grid', with: { size: [6, 12] } }], [
    { use: 'gameplay.falling.pieces', with: { board: board(6, 12), sets: ['pairs'], pairColors: ['red', 'green'], hidden: 1, clearRows: 'none', scoring: 'none', onTopOut: [] } },
    { use: 'gameplay.match', with: { board: board(6, 12), rule: 'group', min: 4, colors: ['red', 'green'], trigger: ['land'], refill: false, scoring: 'chain', clearFrames: 1, settleFrames: 1 } },
  ], { content: { blocks: [{ id: 'red' }, { id: 'green' }] } }); // the match colours are board cells (content.blocks)
  const { rt } = go(doc);
  const api = rt.space('g');
  for (const [x, y, t] of [[0, 0, 'green'], [1, 0, 'green'], [1, 1, 'green'], [0, 1, 'red'], [0, 2, 'red'], [0, 3, 'red']]) api.setCell([x, y], t, rt);
  rt.step();
  const s = rt.state.prim['gameplay.falling.pieces:board'];
  s.piece = { ...s.piece, x: 0, r: 0, colors: ['red', 'green'] };
  rt.step({ actions: { hard_drop: true } });
  for (let i = 0; i < 40 && !rt.state.counts.board_idle; i++) rt.step();
  assert.equal(rt.state.counts.chain, 1, 'a 2-chain');
  assert.equal(rt.state.vars.score, 360);
  assert.ok(rt.state.counts.settled >= 1, 'the grid settled the cells');
});

test('real grid: match-3 swaps resolve with grid gravity and refill; slide boards slide', () => {
  const m = go(base([{ id: 'g', use: 'engine.space.grid', with: { size: [8, 8] } }], [{ use: 'gameplay.match', with: { board: board(8, 8), colors: GEMS, clearFrames: 1, settleFrames: 1, swapFrames: 1 } }], { content: { blocks: GEMS.map(id => ({ id })) } })).rt;
  for (let i = 0; i < 3; i++) { const o = m.availableOptions(); assert.ok(o.length); m.step({ actions: o[0].actions }); for (let k = 0; k < 200 && !m.availableOptions().length; k++) m.step(); }
  assert.equal(m.state.counts.move, 3);
  assert.ok(m.state.counts.settled >= 1, 'grid settle ran');
  assert.equal(m.space('g').cellsIn([[0, 0], [7, 7]]).length, 64, 'refilled');
  const sl = go(base([{ id: 'g', use: 'engine.space.grid', with: { size: [4, 4] } }], [{ use: 'gameplay.slide.merge', with: { board: board(4, 4), slideFrames: 0 } }])).rt;
  for (let i = 0; i < 20 && sl.state.status === 'playing'; i++) sl.step({ actions: sl.availableOptions()[0].actions });
  assert.ok(sl.state.vars['slide.max'] >= 4);
  assert.equal(typeof sl.service('board').get(0, 0) === 'string' || sl.service('board').get(0, 0) === null, true);
});

test('real tilemap: blocks drop into a platformer level and never cut the player off', () => {
  const W = 12, H = 8;
  const doc = base([{ id: 'lvl', use: 'engine.space.tilemap', with: { size: [W, H], mode: 'side' } }],
    [{ use: 'gameplay.falling.pieces', with: { board: board(W, H, { at: [0, 0] }), hidden: 0, sets: ['small'], steer: 'follow', every: 0.2, rowsPerSecond: 20, lockDelay: 0, passThrough: true, guard: 'reachable', clearRows: 'none', scoring: 'flat', onTopOut: [], tokens: { m1: 'stone', m2: 'stone', m3: 'stone', m4: 'stone' } } }],
    { content: { archetypes: [{ id: 'hero', components: { body: { size: [0.8, 0.8] } } }], blocks: [{ id: 'stone', name: 'Stone', solid: true }] }, player: { archetype: 'hero', space: 'lvl', at: [5.5, 0.5] } });
  const { rt } = go(doc);
  run(rt, 900);
  assert.ok(rt.state.counts.piece_locked >= 5, `${rt.state.counts.piece_locked} pieces landed`);
  const api = rt.space('lvl');
  assert.equal(api.getCell([5, 0]), null, 'nothing landed on the player');
  // The player's open region (flood over open board cells) is never split off from the top.
  const open = (x, y) => x >= 0 && y >= 0 && x < W && y < H && api.getCell([x, y]) == null;
  const seen = new Set(['5,0']), q = [[5, 0]];
  while (q.length) { const [x, y] = q.pop(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = [x + dx, y + dy]; if (open(...n) && !seen.has(n.join())) { seen.add(n.join()); q.push(n); } } }
  let empties = 0; for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (open(x, y)) empties++;
  assert.equal(seen.size, empties, 'every open cell is still reachable from the player');
});

test('real physics2d: paddle returns the ball and bricks break by contact impulse', () => {
  const doc = base([{ id: 'p', use: 'engine.space.physics2d', with: { gravity: [0, 0], bounds: [13, 20], edges: { bottom: 'open' } } }], [
    { use: 'gameplay.paddle', with: { ball: 'ball', bounds: [0, 13] } },
    { use: 'gameplay.destructible', with: { materials: { brick: { hp: 0.5, score: 50 } } } },
  ], { content: { archetypes: [
    { id: 'pad', components: { body: { size: [2.2, 0.4], type: 'kinematic', restitution: 1, friction: 0 } } },
    { id: 'ball', components: { body: { size: [0.36, 0.36], shape: { kind: 'circle', r: 0.18 }, restitution: 1, friction: 0, gravityScale: 0, bullet: true } } },
    { id: 'brick', components: { body: { size: [1, 0.5], type: 'static', restitution: 1, friction: 0 }, destructible: { material: 'brick' } } },
  ] }, player: { archetype: 'pad', space: 'p', at: [6.5, 1.5] } });
  const { rt } = go(doc);
  for (let x = 0; x < 13; x++) rt.spawn('brick', { space: 'p', at: [x + 0.5, 16] });
  rt.step(); rt.step({ actions: { launch: true } });
  const s = () => rt.state.prim['gameplay.paddle'];
  for (let i = 0; i < 900; i++) {
    const b = rt.entity(s().balls[0]);
    const d = b ? b.at[0] - rt.player().at[0] : 0;
    rt.step(s().held ? { actions: { launch: true } } : { axes: { move: [Math.abs(d) < 0.2 ? 0 : Math.sign(d), 0] } });
  }
  assert.ok(rt.state.counts['destroyed:brick'] >= 1, 'bricks broke on impact');
  assert.ok(rt.state.counts.paddle_hit >= 1, 'the paddle returned the ball');
});

test('real physics2d: a sling shot topples and breaks a glass structure', () => {
  const doc = base([{ id: 'p', use: 'engine.space.physics2d', with: { gravity: [0, -10], bounds: [40, 20] } }], [
    { use: 'gameplay.launcher', with: { mode: 'sling', origin: [2, 3], forward: [1, 0], aim: [-0.5, 1.4], speed: 22, shots: [{ archetype: 'bird', count: 2 }] } },
    { use: 'gameplay.destructible', with: {} },
  ], { content: { archetypes: [
    { id: 'bird', kind: 'projectile', components: { body: { size: [0.8, 0.8], shape: { kind: 'circle', r: 0.4 }, density: 2.6, bullet: true } } },
    { id: 'pane', components: { body: { size: [0.5, 2], density: 1 }, destructible: { material: 'glass' } } },
  ] } });
  const { rt } = go(doc);
  rt.spawn('pane', { space: 'p', at: [15, 1] });
  run(rt, 60); // let it settle
  rt.step({ actions: { aim: 0.12, power: 0.8 } });
  rt.step({ actions: { fire: true } });
  for (let i = 0; i < 700 && !rt.state.counts.shot_end; i++) rt.step();
  assert.equal(rt.state.counts.launched, 1);
  assert.equal(rt.state.counts['destroyed:glass'], 1, 'the glass broke on impact');
  assert.ok(rt.state.counts.shot_end >= 1);
});

test('real spaces: an encounter on a grid overworld battles in an engine.space.none screen and returns', () => {
  const B = (n) => ({ hp: n, atk: n, def: n, spa: n, spd: n, spe: n });
  const doc = base([
    { id: 'route', use: 'engine.space.grid', with: { size: [10, 10] }, zones: [{ id: 'grass_zone', rect: [0, 0, 5, 10] }] },
    { id: 'screen', use: 'engine.space.none', zones: [{ id: 'field' }] },
  ], [
    { use: 'gameplay.creature.party', with: { start: [{ species: 'pup', level: 12 }] } },
    { use: 'gameplay.creature.battle', with: { space: 'screen' } },
    { use: 'gameplay.encounter', with: { areas: [{ id: 'tall', zone: 'grass_zone', rate: 1, table: [{ species: 'mite', minLevel: 2, maxLevel: 3 }] }] } },
  ], { content: {
    types: { normal: {} },
    moves: [{ id: 'bite', name: 'Bite', type: 'normal', category: 'physical', power: 60, accuracy: 100, pp: 25 }],
    species: [{ id: 'pup', name: 'Pup', types: ['normal'], base: B(60), learnset: [{ level: 1, move: 'bite' }], growth: 'fast' }, { id: 'mite', name: 'Mite', types: ['normal'], base: B(10), learnset: [{ level: 1, move: 'bite' }], growth: 'fast' }],
    archetypes: [{ id: 'hero', components: {} }],
  }, player: { archetype: 'hero', space: 'route', at: [7, 5] } });
  const { rt } = go(doc);
  rt.step();
  rt.space('route').setPos(rt.player(), [4, 5], rt); rt.step();
  assert.equal(rt.state.counts['encounter:mite'], 1);
  assert.equal(rt.player().space, 'screen');
  for (let i = 0; i < 50 && rt.state.prim['gameplay.creature.battle'].battle; i++) rt.step({ actions: rt.availableOptions()[0].actions });
  assert.equal(rt.state.counts['battle_end:win'], 1);
  assert.equal(rt.player().space, 'route');
  assert.deepEqual(rt.player().at, [4, 5]);
});
