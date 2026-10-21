import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, testSpace, run } from '../v2/kernel/testing.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import { preflight } from '../v2/kernel/document.js';
import { PRIMITIVES } from '../v2/primitives/index.js';
import { passable, eligible, chunkLimits, tierAt } from '../v2/primitives/engine/generate-chunks.js';

const ALL = [...PRIMITIVES, testSpace];
const KEY = 'spaces.run.generators[0]';
const LEGEND = { '.': {}, '#': { block: 'crate', blocks: true }, 'o': { archetype: 'coin' }, 'X': { archetype: 'barrier', blocks: true } };
const CHUNKS = [
  { id: 'easy', tier: 1, rows: ['o.o', '...', '.X.'] },
  { id: 'coins', tier: 1, rows: ['ooo', '...'] },
  { id: 'mid', tier: 2, rows: ['X..', '.o#', '..X'] },
  { id: 'hard', tier: 3, spacing: 2, rows: ['.XX', '..X', 'X..'] },
  { id: 'wall', tier: 3, rows: ['###'] },
];
const doc = (w = {}, seed = 5) => ({
  schema: 'gameverse.v2.game/0.2', id: 'runner', title: 'Runner', seed,
  spaces: [{ id: 'run', use: 'engine.space.test', with: { size: [3, 512, 1] }, generators: [{ use: 'engine.generate.chunks', with: { chunks: CHUNKS, legend: LEGEND, axis: 'y', cross: 'x', ahead: 40, behind: 8, speed: { start: 10, max: 30, rampSeconds: 3 }, gap: { base: 4, min: 2 }, ...w } }] }],
  content: { archetypes: [{ id: 'hero', components: {} }, { id: 'coin', components: {} }, { id: 'barrier', components: {} }] },
  player: { archetype: 'hero', at: [1, 0, 0] },
});
// Run forward at a steady 0.5 units per frame (30 units/s), as a movement primitive would.
const runForward = (rt, frames) => { for (let i = 0; i < frames; i++) { const p = rt.player(); rt.space('run').setPos(p, [1, p.at[1] + 0.5, 0], rt); rt.step({}); } };

test('chunks: the proof keeps only chunks with a passable line', () => {
  assert.equal(passable(CHUNKS[0], 'rows', LEGEND, 1), true);
  assert.equal(passable(CHUNKS[3], 'rows', LEGEND, 1), true, 'a zig-zag lane with single sidesteps');
  assert.equal(passable(CHUNKS[3], 'rows', LEGEND, 0), false, 'no line without sidesteps');
  assert.equal(passable(CHUNKS[4], 'rows', LEGEND, 1), false);
  const { rt } = compile(doc(), { primitives: ALL });
  const st = rt.store(KEY);
  assert.deepEqual(st.problems.map(p => [p.code, p.severity]), [['chunk_impassable', 'warning']]);
  assert.deepEqual(st.pool, ['easy', 'coins', 'mid', 'hard']);
});

test('chunks: tiers follow the speed ramp, never repeat back to back, stream ahead and clean up behind', () => {
  const { rt } = compile(doc(), { primitives: ALL });
  run(rt, 1);
  const placed = [];
  rt.on('chunk_placed', d => placed.push({ id: d.subject, tier: d.tier, at: d.at, t: rt.state.time }));
  runForward(rt, 400);
  assert.ok(placed.length > 20);
  assert.equal(rt.store(KEY).log.length, 8);
  for (let i = 1; i < placed.length; i++) assert.notEqual(placed[i].id, placed[i - 1].id, 'no immediate repeat');
  for (const c of placed) { const tier = CHUNKS.find(k => k.id === c.id).tier; assert.ok(tier <= c.tier && tier >= c.tier - 1, `${c.id} in tier ${c.tier}`); }
  assert.ok(placed.some(c => c.id === 'hard'), 'tier 3 arrives once the ramp is done');
  assert.ok(!placed.some(c => c.id === 'wall'), 'the impassable chunk never appears');
  const p = rt.player().at[1];
  assert.ok(rt.store(KEY).nextAt >= p + 40, 'streamed ahead');
  assert.ok(rt.query('chunk').every(e => e.at[1] >= p - 8), 'nothing left behind');
  assert.ok(rt.query('chunk').some(e => e.archetype === 'coin'));
  assert.ok(rt.space('run').cellsIn([[0, Math.floor(p - 8)], [2, 511]]).length > 0, 'crates ahead');
  assert.equal(rt.space('run').cellsIn([[0, 0], [2, Math.floor(p - 9)]]).length, 0, 'cells behind are cleared');
});

test('chunks: tier and eligibility rules match the runner port', () => {
  const pool = CHUNKS.slice(0, 4);
  assert.deepEqual(eligible(pool, 1).map(c => c.id), ['easy', 'coins']);
  assert.deepEqual(eligible(pool, 2).map(c => c.id), ['easy', 'coins', 'mid']);
  assert.deepEqual(eligible(pool, 3).map(c => c.id), ['mid', 'hard']);
  assert.deepEqual(chunkLimits({ start: 10, max: 30, rampSeconds: 90 }, pool).map(l => l.tier), [2, 2, 3, 3]);
  assert.equal(tierAt({ rampSeconds: 90 }, 61), 3);
});

test('chunks: side view on the tilemap writes cells along x and spawns at cell centres', () => {
  const d = { schema: 'gameverse.v2.game/0.2', id: 'side', title: 'Side', seed: 2,
    spaces: [{ id: 'run', use: 'engine.space.tilemap', with: { size: [400, 12], mode: 'side' }, generators: [{ use: 'engine.generate.chunks', with: { chunks: [{ id: 'floor', rows: ['..o.', '....', '####'] }], legend: LEGEND, along: 'columns', axis: 'x', cross: 'y', origin: [0, 0], ahead: 30, chunkZones: true } }] }],
    content: { archetypes: [{ id: 'hero', components: {} }, { id: 'coin', components: {} }], blocks: [{ id: 'crate', solid: true }] }, player: { archetype: 'hero', at: [2.5, 5.5] } };
  const { rt } = compile(d, { primitives: ALL });
  run(rt, 1);
  const api = rt.space('run');
  assert.equal(api.getCell([10, 0]), 'crate');
  assert.equal(api.getCell([10, 1]), null);
  const coin = rt.query('chunk').find(e => e.archetype === 'coin');
  assert.equal(coin.at[0] % 1, 0.5); assert.equal(coin.at[1], 2.5);
  assert.deepEqual(rt.state.spaces.run.zones[0].rect, [10, 0, 14, 3], 'each chunk is a zone a solver can name');
});

test('chunks: same seed and run replay exactly; another seed differs', () => {
  const go = seed => { const { rt } = compile(doc({}, seed), { primitives: ALL }); runForward(rt, 300); return rt; };
  const a = go(5), b = go(5), c = go(6);
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.notDeepEqual(a.store(KEY).log, c.store(KEY).log);
});

test('chunks: preflight rejects bad configs with stable codes', () => {
  const r = new Registry(ALL), logic = buildLogic(r, Logic), codes = d => preflight(d, r, logic).errors.map(e => e.code);
  const bad = doc({ chunks: [{ id: 'a', rows: ['ab', '...'] }, { id: 'a', rows: ['.'] }], cross: 'y', axis: 'y', legend: { '.': {}, ab: {} } });
  for (const c of ['chunk_rows_ragged', 'chunk_char_unknown', 'chunk_duplicate', 'chunk_axis_invalid', 'chunk_legend_invalid']) assert.ok(codes(bad).includes(c), c);
  assert.ok(codes(doc({ density: 9 })).includes('param_range'));
});

test('chunks: the course owns the distance run; a goal wins once on reaching it and must end inside the space', () => {
  const { rt } = compile(doc({ goal: 30, onGoal: [{ do: 'end_game', outcome: 'won' }] }), { primitives: ALL });
  const goals = []; rt.on('course_goal', d => goals.push(d));
  runForward(rt, 40);
  assert.equal(rt.state.vars['course.distance'], 20, 'distance from where the follower started (0.5 a frame)');
  assert.equal(rt.state.status, 'playing');
  runForward(rt, 30);
  assert.equal(rt.state.status, 'won');
  assert.deepEqual(goals.map(g => g.goal), [30]);
  const r = new Registry(ALL), logic = buildLogic(r, Logic), codes = d => preflight(d, r, logic).errors.map(e => e.code);
  assert.ok(codes(doc({ goal: 512 })).includes('chunk_goal_outside'), 'a run of 512 from 0 leaves the 512-long space');
  assert.ok(!codes(doc({ goal: 500 })).includes('chunk_goal_outside'));
});
