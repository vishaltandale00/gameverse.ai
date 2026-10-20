import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultRegistry } from '../v2/modules/index.js';
import { preflight, SPEC_SCHEMA } from '../v2/engine/spec.js';
import { compose, DT } from '../v2/engine/compose.js';
import { playtest, replay, macrosFor } from '../v2/engine/playtest.js';

const registry = defaultRegistry();
const example = JSON.parse(readFileSync(new URL('../v2/examples/coin-cavern.json', import.meta.url)));
const build = spec => { const r = preflight(spec, registry); assert.ok(r.ok, JSON.stringify(r.errors)); return compose(r.spec, registry); };
const codes = spec => preflight(spec, registry).errors.map(e => e.code);

function arena(rows, extra = {}) {
  return {
    schema: SPEC_SCHEMA, id: 'arena', title: 'Arena',
    level: { rows, legend: { '#': 'wall', P: 'hero', G: 'flag', C: 'gem', E: 'bug' } },
    entities: { wall: { solid: true }, hero: { tags: ['player'] }, flag: { tags: ['goal'] }, gem: { tags: ['collectible'] }, bug: { tags: ['enemy'] } },
    modules: [{ use: 'platformer' }, { use: 'goal' }],
    win: { count: 'reach_goal', gte: 1 },
    ...extra,
  };
}

test('example spec passes preflight in milliseconds and fills tunable defaults', () => {
  const started = performance.now();
  const r = preflight(example, registry);
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.ok(performance.now() - started < 50);
  assert.equal(r.spec.modules[0].with.gravity, registry.get('platformer').card.tunables.gravity.default);
  assert.ok(r.provides.vars.includes('remaining') && r.provides.events.includes('stomp'));
});

test('preflight reports stable codes with hints', () => {
  const base = arena(['#####', '#P.G#', '#####']);
  assert.deepEqual(codes(base), []);
  assert.ok(codes({ ...base, modules: [{ use: 'warp-drive' }] }).includes('unknown_module'));
  assert.ok(codes({ ...base, modules: [{ use: 'platformer', with: { gravity: 9999 } }, { use: 'goal' }] }).includes('tunable_range'));
  assert.ok(codes({ ...base, modules: [{ use: 'platformer', with: { gravty: 3 } }, { use: 'goal' }] }).includes('unknown_tunable'));
  assert.ok(codes({ ...base, level: { ...base.level, rows: ['#####', '#PXG#', '#####'] } }).includes('legend_missing'));
  assert.ok(codes({ ...base, level: { ...base.level, rows: ['#####', '#PPG#', '#####'] } }).includes('player_count'));
  assert.ok(codes({ ...base, win: { var: 'gold', gte: 3 } }).includes('predicate_unknown_var'));
  assert.ok(codes({ ...base, modules: [{ use: 'platformer' }, { use: 'goal' }, { use: 'collect' }] }).includes('requires_unmet'));
  assert.ok(codes({ ...base, modules: [{ use: 'platformer' }, { use: 'topdown' }, { use: 'goal' }] }).includes('module_conflict'));
  const missing = preflight({ ...base, modules: [{ use: 'warp-drive' }] }, registry).errors.find(e => e.code === 'unknown_module');
  assert.match(missing.hint, /platformer/);
});

test('simulation is deterministic for the same seed and inputs', () => {
  const game = build(example), macros = macrosFor(game.spec);
  const path = [[1, 30], [4, 20], [2, 15], [3, 25], [1, 40]];
  assert.deepEqual(replay(game, path, macros), replay(game, path, macros));
});

test('jump height follows jumpSpeed²/(2·gravity) and fast falls do not tunnel', () => {
  const rows = ['#..........#', '#..........#', '#..........#', '#..........#', '#..........#', '#..........#', '#....P....G#', '############'];
  const game = build({ ...arena(rows), modules: [{ use: 'platformer', with: { jumpSpeed: 16, gravity: 48, jumpCut: 1, maxFall: 80 } }, { use: 'goal' }] });
  const state = game.createState();
  for (let f = 0; f < 30; f++) game.step(state, { x: 0, y: 0, a: false, b: false });
  const p = () => state.entities.find(e => e.tags.includes('player'));
  const floorY = p().y; let top = floorY;
  for (let f = 0; f < 120; f++) { game.step(state, { x: 0, y: 0, a: true, b: false }); top = Math.min(top, p().y); }
  assert.ok(Math.abs((floorY - top) - 16 ** 2 / 96) < 0.4, `rose ${floorY - top}`);
  assert.equal(p().y, floorY, 'landed back on the floor without falling through');
});

test('playtest proves the example winnable and the win path replays', () => {
  const game = build(example);
  const report = playtest(game, { budgetMs: 3000 });
  assert.ok(report.ok, JSON.stringify(report.issues));
  assert.ok(report.winnable);
  assert.equal(report.idle.status, 'playing');
  assert.ok(report.framesSimulated > 1000 && report.speedup > 100);
});

test('playtest flags a game that is won without input', () => {
  const spec = arena(['#####', '#PG.#', '#####']);
  spec.entities.flag = { tags: ['goal'], w: 2 }; // wide enough to overlap the spawn point
  const report = playtest(build(spec), { budgetMs: 200 });
  assert.ok(report.issues.some(i => i.code === 'trivially_won'));
  assert.equal(report.ok, false);
});

test('playtest reports an unreachable goal as a warning', () => {
  const rows = ['#######', '#..G..#', '#.....#', '#.....#', '#.....#', '#.....#', '#P....#', '#######'];
  const report = playtest(build({ ...arena(rows), modules: [{ use: 'platformer', with: { jumpSpeed: 6 } }, { use: 'goal' }] }), { budgetMs: 300 });
  assert.equal(report.winnable, false);
  assert.ok(report.issues.some(i => i.code === 'goal_not_reached' && i.severity === 'warning'));
});

test('stomping, hazards, health and shooting interact through events', () => {
  const rows = ['############', '#..........#', '#P...E...G.#', '############'];
  const game = build({ ...arena(rows), modules: [{ use: 'platformer' }, { use: 'patrol', with: { speed: 0 } }, { use: 'shooter' }, { use: 'health', with: { hp: 2 } }, { use: 'goal' }], lose: { var: 'hp', lte: 0 } });
  const state = game.createState();
  for (let f = 0; f < 10; f++) game.step(state, { x: 1, y: 0, a: false, b: f === 2 });
  for (let f = 0; f < 60; f++) game.step(state, { x: 0, y: 0, a: false, b: false });
  assert.equal(state.vars.shots_hit, 1);
  assert.equal(state.entities.some(e => e.tags.includes('enemy')), false);
  assert.ok(Math.abs(state.time - 70 * DT) < 1e-9);
});
