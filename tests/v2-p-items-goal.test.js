// gameplay.goal: touching a goal entity reaches it once (goal_reached, typed by its id) and runs onReach; the
// platformer mode it declares is played by its bot in tests/v2-p-modes-bots.test.js and tests/v2-templates.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, testSpace, run } from '../v2/kernel/testing.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import { preflight } from '../v2/kernel/document.js';
import { PRIMITIVES } from '../v2/primitives/index.js';

const won = [{ do: 'end_game', outcome: 'won' }];
const floor = []; for (let x = 0; x < 24; x++) floor.push([x, 0, 0]);
const doc = (goal = { onReach: won }, flag = { goal: true }) => ({
  schema: 'gameverse.v2.game/0.2', id: 'goaltest', title: 'Goal test', seed: 3,
  spaces: [{ id: 'w', use: 'engine.space.test', with: { size: [24, 12, 1], gravity: 60, solid: floor } }],
  systems: [{ use: 'gameplay.move.platformer' }, { use: 'gameplay.goal', with: goal }, { use: 'engine.spawner', with: { intervalSec: 0, rules: [{ id: 'flag', archetype: 'flag', at: [10, 1, 0], unique: true, activation: 'always', respawnSec: 0 }] } }],
  content: { archetypes: [{ id: 'hero', components: { body: { size: [0.8, 0.95, 1] } } }, { id: 'flag', kind: 'prop', components: { ...flag, body: { size: [1, 3, 1] } } }] },
  player: { archetype: 'hero', at: [2, 1, 0] },
});
const make = d => compile(d, { primitives: [testSpace, ...PRIMITIVES] }).rt;
const registry = new Registry([testSpace, ...PRIMITIVES]), logic = buildLogic(registry, Logic);

test('goal: preflights; running into the goal reaches it once and runs onReach (the game is won)', () => {
  assert.ok(preflight(doc(), registry, logic).ok);
  const rt = make(doc());
  run(rt, 20, {});
  assert.equal(rt.state.counts.goal_reached ?? 0, 0, 'standing away from the goal reaches nothing');
  run(rt, 120, { axes: { move: [1, 0] } });
  assert.equal(rt.state.status, 'won');
  assert.equal(rt.state.counts.goal_reached, 1);
  assert.equal(rt.state.counts['goal_reached:flag'], 1, 'typed by the goal id (its archetype)');
  assert.deepEqual(rt.service('goal').reached(), ['flag']);
});

test('goal: a goal is reached once, onReach may do anything; goal.id names it; replay is deterministic', () => {
  const d = doc({ onReach: [{ do: 'add_var', var: 'goals', value: 1 }] }, { goal: { id: 'castle' } });
  const play = () => { const rt = make(d); run(rt, 200, { axes: { move: [1, 0] } }); return rt; };
  const a = play(), b = play();
  assert.equal(a.state.status, 'playing');
  assert.equal(a.state.vars.goals, 1, 'onReach ran once although the player kept touching it');
  assert.equal(a.state.counts['goal_reached:castle'], 1);
  assert.deepEqual(a.snapshot(), b.snapshot());
});

test('goal: preflight rejects a bad config with stable codes', () => {
  const codes = w => preflight(doc(w), registry, logic).errors.map(e => `${e.code}@${e.path}`);
  assert.deepEqual(codes({ onReach: 'win' }), ['param_type@systems[1].with.onReach'], 'onReach must be effects');
  assert.deepEqual(codes({ onReach: won, reachers: 'player' }), ['param_type@systems[1].with.reachers'], 'reachers must be a list');
  assert.deepEqual(codes({ onReach: won }), []);
});
