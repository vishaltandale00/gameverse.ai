// engine.adapt.projection: a space kind projected onto a region of another space, run through the real runtime.
// (a) a turns/grid board loop on a patch of a tilemap overworld; (c) a race checkpoint loop on a track laid
// along a path through a tilemap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogue } from '../v2/primitives/index.js';
import { preflight } from '../v2/kernel/document.js';
import { createWorld } from '../v2/kernel/world.js';

const { registry, logic } = catalogue();
const won = [{ do: 'end_game', outcome: 'won' }], lost = [{ do: 'end_game', outcome: 'lost' }];
const base = (id, extra) => ({ schema: 'gameverse.v2.game/0.2', id, title: id, seed: 3, ...extra });
const world = { id: 'world', use: 'engine.space.tilemap', with: { size: [20, 12], mode: 'topdown' } };
const boot = doc => { const r = preflight(doc, registry, logic); assert.ok(r.ok, JSON.stringify(r.errors)); return { r, make: () => createWorld(r.doc, registry, logic, { seed: 1 }) }; };
const codes = doc => preflight(doc, registry, logic).errors.map(e => e.code);
const step = (rt, n, input = {}) => { for (let i = 0; i < n && rt.state.status === 'playing'; i++) rt.step(input); return rt; };

// ---------- (a) a board on a tile overworld ----------
const boardDoc = (projection = {}) => base('board-on-map', {
  spaces: [world],
  systems: [
    { use: 'engine.adapt.projection', id: 'board', space: 'world', with: { kind: 'engine.space.grid', config: { size: [6, 6] }, origin: [4.5, 3.5], zones: [{ id: 'home', rect: [0, 0, 6, 2] }], ...projection } },
    { use: 'gameplay.combat.health' },
    { use: 'gameplay.turns', space: 'board', with: { grain: 'unit', ap: 1, movePerAp: 2, overwatch: false, hitChance: false,
      sides: [{ id: 'white', control: 'player', members: ['player'] }, { id: 'black', control: 'ai', members: ['rook'] }],
      actions: [{ id: 'capture', range: 1, target: 'unit', los: false, onHit: [{ do: 'kill', who: 'target' }] }], onVictory: won, onDefeat: lost } },
    { use: 'engine.spawner', with: { intervalSec: 0, rules: [{ id: 'r1', archetype: 'rook', space: 'board', at: [4, 4], unique: true, activation: 'always', respawnSec: 0 }] } },
  ],
  content: { archetypes: [{ id: 'knight', components: { health: { max: 1 }, turns: { side: 'white' } } }, { id: 'rook', components: { health: { max: 1 }, turns: { side: 'black' } } }], blocks: [{ id: 'shelf', solid: true }] },
  player: { archetype: 'knight', space: 'board', at: [1, 1] },
});

test('(a) a grid board projected onto a tilemap region preflights with the grid capabilities on the region', () => {
  const { r } = boot(boardDoc());
  for (const c of ['navigate', 'pathfind', 'occupancy', 'los', 'cellRules']) assert.ok(r.capabilities.board.includes(c), `board lacks ${c}`);
  assert.ok(!r.capabilities.world.includes('occupancy'), 'the host itself does not gain the projected capabilities');
});

test('(a) pieces move on the projected board, which takes its walls from the host and mirrors host positions', () => {
  const { make } = boot(boardDoc());
  const rt = make(), host = rt.space('world'), board = rt.space('board');
  assert.equal(board.kind, 'grid');
  assert.equal(board.projected.host, 'world');
  assert.deepEqual(board.toHost([2, 1]), [6.5, 4.5]);
  assert.deepEqual(board.fromHost([6.5, 4.5]), [2, 1, 0]);
  // A shelf placed in the overworld under board cell [2,1] becomes a wall on the board.
  host.setCell([6, 4], 'shelf', rt, 'test');
  step(rt, 1);
  assert.equal(board.getCell([2, 1]), 'shelf');
  assert.equal(board.passable([2, 1]), false);
  const path = board.path([1, 1], [3, 1]);
  assert.ok(path && !path.some(c => c[0] === 2 && c[1] === 1), `path avoids the shelf: ${JSON.stringify(path)}`);
  // The player's piece moves on the board through the turn loop; its host position follows.
  assert.ok(board.inZone(rt.player(), 'home'));
  rt.step({ actions: { turn_move: { unit: 'player', to: [1, 3] } } });
  assert.deepEqual(rt.player().at, [1, 3]);
  step(rt, 1);
  assert.deepEqual(rt.player().components.projected, { space: 'world', at: [5.5, 6.5] });
  // The AI's piece takes its turn on the board too.
  const rook0 = rt.entity('r1').at.slice();
  rt.step({ actions: { end_turn: true } });
  step(rt, 4);
  assert.notDeepEqual(rt.entity('r1').at, rook0, 'the rook moved on the board');
  assert.ok(rt.state.counts.turn_start >= 2);
});

test('(a) deterministic replay', () => {
  const { make } = boot(boardDoc());
  const play = () => { const rt = make(); rt.space('world').setCell([6, 4], 'shelf', rt, 'test'); rt.step({ actions: { turn_move: { unit: 'player', to: [1, 3] } } }); step(rt, 20); return JSON.stringify(rt.snapshot()); };
  assert.equal(play(), play());
});

test('(a) preflight rejects bad projections with stable codes', () => {
  const noId = boardDoc(); delete noId.systems[0].id; noId.systems[2].space = 'world'; delete noId.player.space;
  assert.ok(codes(noId).includes('projection_id'));
  assert.ok(codes(boardDoc({ config: { size: [6, 6], topology: 'cube' } })).includes('param_option'));
  assert.ok(codes(boardDoc({ zones: [{ id: 'home', rect: [0, 0, 9, 2] }] })).includes('zone_outside'));
  // A region needs a host with positions (adapts.from): engine.space.none has none.
  const onNone = boardDoc(); onNone.spaces = [{ id: 'world', use: 'engine.space.none' }];
  assert.ok(codes(onNone).includes('adapter_from_mismatch'));
});

// ---------- (c) a race course on a tile overworld ----------
const raceDoc = (projection = {}) => base('race-on-map', {
  spaces: [world],
  systems: [
    { use: 'engine.adapt.projection', id: 'course', space: 'world', with: { kind: 'engine.space.track', config: { lanes: 3, length: 40, loop: true }, path: [[2, 2], [17, 2], [17, 9], [2, 9], [2, 2]],
      zones: [{ id: 'start', range: [0, 2] }, { id: 'far', range: [20, 22] }], ...projection } },
    { use: 'gameplay.move.lanes', with: { speed: 12 } },
    { use: 'gameplay.race', with: { laps: 1, checkpoints: ['start', 'far'], countdown: 0, onWin: won, onLose: lost } },
  ],
  content: { archetypes: [{ id: 'runner', components: { body: { size: [1, 0.8, 1] } } }] },
  player: { archetype: 'runner', space: 'course', at: [1, 1, 0.5] },
});

test('(c) a track projected along a tilemap path runs a checkpoint race to the finish', () => {
  const { r, make } = boot(raceDoc());
  for (const c of ['gravity', 'dynamics', 'wrap']) assert.ok(r.capabilities.course.includes(c), `course lacks ${c}`);
  const rt = make(), course = rt.space('course');
  assert.equal(course.kind, 'track');
  // Progress runs along the path: 40 track units span the 44-tile loop, the middle lane on the path.
  assert.deepEqual(course.toHost([0, 1, 0]), [2, 2]);
  assert.deepEqual(course.toHost([10, 1, 0]), [13, 2]);
  assert.deepEqual(course.fromHost([13, 2]).slice(0, 2), [10, 1]);
  step(rt, 60 * 6);
  assert.ok(rt.state.counts['checkpoint:far'] >= 1, 'passed the far checkpoint');
  assert.ok(rt.state.counts['race_finished:player'] >= 1, 'finished the race');
  assert.equal(rt.state.status, 'won');
  assert.ok(Array.isArray(rt.player().components.projected.at), 'the runner has a host position');
});

test('(c) deterministic replay, and a track needs its path', () => {
  const { make } = boot(raceDoc());
  const play = () => JSON.stringify(step(make(), 200).snapshot());
  assert.equal(play(), play());
  assert.ok(codes(raceDoc({ path: [] })).includes('projection_path'));
  assert.ok(codes(raceDoc({ config: { lanes: 3, length: 40, loop: true }, zones: [{ id: 'start', range: [5, 2] }, { id: 'far', range: [20, 22] }] })).includes('zone_range_invalid'));
});
