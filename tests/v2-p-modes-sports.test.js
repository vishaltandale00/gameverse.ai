import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, testSpace } from '../v2/kernel/testing.js';
import { preflight } from '../v2/kernel/document.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import modes from '../v2/primitives/gameplay/modes.index.js';
import spaces2d from '../v2/primitives/engine/spaces2d.index.js';
import { doc, drive } from '../v2/primitives/gameplay/modes-lib-testing.js';

const P = [...modes, testSpace, ...spaces2d];
const zones = [{ id: 'left_goal', rect: [0, 6, 1, 10] }, { id: 'right_goal', rect: [29, 6, 30, 10] }];
const teams = [{ id: 'blue', members: ['player'], kickoff: [[10, 7.5, 0]] }, { id: 'red', members: ['rival'], kickoff: [[20, 3, 0]] }];
const goals = [{ zone: 'right_goal', scores: 'blue' }, { zone: 'left_goal', scores: 'red' }];
const field = w => doc({ with: { size: [30, 16, 1] }, zones, archetypes: [{ id: 'ball', components: { body: { size: [0.5, 0.5, 0.5], vel: [0, 0, 0] } } }, { id: 'rival', components: { body: { size: [1, 1, 1], vel: [0, 0, 0] } } }], player: { archetype: 'hero', at: [10, 7.5, 0], components: { body: { size: [1, 1, 1], vel: [0, 0, 0] } } },
  systems: [{ use: 'gameplay.sports', with: { ball: 'ball', ballAt: [15, 7.75, 0], teams, goals, periodSec: 20, periods: 2, kickoffSec: 0.5, resetSec: 0.5, drag: 0.1, ...w } }] });
const play = rt => { while (!rt.test({ sports: 'play' }) && rt.state.frame < 9999) rt.step(); };
const goTo = (rt, at) => rt.space('world').setPos(rt.player(), at, rt);

test('sports: kickoff, kick into the goal, last-touch scorer, reset to kickoff', () => {
  const { rt } = compile(field({ onGoal: [{ do: 'add_var', var: 'goals_by_player' }] }), { primitives: P });
  rt.spawn('rival', { id: 'r1', at: [20, 2, 0] });
  rt.step(); assert.ok(rt.test({ sports: 'kickoff' }));
  play(rt);
  goTo(rt, [14, 7.5, 0]);
  rt.step({ actions: { kick: { dir: [1, 0, 0] } } });
  assert.equal(rt.state.counts.kick, 1);
  drive(rt, 120);
  assert.equal(rt.state.counts['goal:blue'], 1);
  assert.equal(rt.state.vars['score.blue'], 1);
  assert.equal(rt.state.vars.goals_by_player, 1);
  drive(rt, 40);
  assert.deepEqual(rt.entity('ball').at, [15, 7.75, 0], 'ball back on the spot');
  assert.deepEqual(rt.player().at, [10, 7.5, 0], 'teams back on kickoff spots');
  goTo(rt, [25, 7.5, 0]); rt.step({ actions: { kick: { dir: [1, 0, 0] } } });
  assert.equal(rt.state.counts.kick, 1, 'out of kick range');
});

test('sports: bodies running into the ball push it (car football)', () => {
  const { rt } = compile(field({}), { primitives: P });
  rt.step(); play(rt);
  goTo(rt, [13.8, 7.5, 0]); rt.player().components.body.vel = [8, 0, 0];
  rt.step();
  assert.ok(rt.entity('ball').components.body.vel[0] > 8, 'ball leaves faster than the hitter');
  assert.equal(rt.state.counts.ball_touched, 1);
});

test('sports: periods, tied regulation goes to golden goal; mercy ends early', () => {
  const { rt } = compile(field({ periodSec: 1, breakSec: 0.5, overtime: 'golden', onWin: [{ do: 'set_flag', flag: 'won' }] }), { primitives: P });
  drive(rt, 250);
  assert.equal(rt.state.counts.period_end, 2); assert.equal(rt.state.counts.overtime, 1);
  play(rt); goTo(rt, [14, 7.5, 0]); rt.step({ actions: { kick: { dir: [1, 0, 0] } } }); drive(rt, 160);
  assert.ok(rt.test({ sports: 'won' })); assert.equal(rt.state.flags.won, true); assert.equal(rt.state.status, 'won');
  const { rt: m } = compile(field({ mercy: 1, endGame: false }), { primitives: P });
  m.step(); play(m); goTo(m, [16, 7.5, 0]); m.step({ actions: { kick: { dir: [-1, 0, 0] } } }); drive(m, 200);
  assert.equal(m.state.counts['goal:red'], 1, 'own goal for red');
  assert.ok(m.test({ sports: 'lost' }));
});

test('sports: on engine.space.physics2d the space moves the ball (dynamics) and contacts credit touches', () => {
  const d = {
    schema: 'gameverse.v2.game/0.2', id: 'pitch', title: 'Pitch', seed: 3,
    spaces: [{ id: 'pitch', use: 'engine.space.physics2d', with: { bounds: [30, 16], gravity: [0, 0] }, zones: [{ id: 'left_goal', rect: [0, 6, 1, 10] }, { id: 'right_goal', rect: [28.5, 6, 30, 10] }] }],
    content: { archetypes: [{ id: 'hero', components: { body: { shape: { kind: 'circle', r: 0.5 } } } }, { id: 'ball', components: { body: { shape: { kind: 'circle', r: 0.3 }, restitution: 0.6, damping: 0.05 } } }] },
    player: { archetype: 'hero', at: [10, 8] },
    systems: [{ use: 'gameplay.sports', with: { ball: 'ball', ballAt: [15, 8], teams: [{ id: 'blue', members: ['player'], kickoff: [[10, 8]] }, { id: 'red', members: ['nobody'] }], goals: [{ zone: 'right_goal', scores: 'blue' }, { zone: 'left_goal', scores: 'red' }], kickoffSec: 0.2, endGame: false } }],
  };
  const { rt } = compile(d, { primitives: P });
  rt.step(); play(rt);
  rt.space('pitch').setPos(rt.player(), [14.3, 8], rt);
  rt.step({ actions: { kick: { dir: [1, 0], power: 14 } } });
  drive(rt, 120);
  assert.equal(rt.state.counts['goal:blue'], 1, 'physics carried the ball into the goal');
});

test('sports: deterministic replay and preflight codes', () => {
  const run = () => { const { rt } = compile(field({}), { primitives: P }); rt.spawn('rival', { id: 'r1', at: [20, 7.5, 0] }); for (let i = 0; i < 300; i++) { if (i % 40 === 0) { goTo(rt, [14, 7 + (i % 3), 0]); rt.player().components.body.vel = [6, (i % 5) - 2, 0]; } rt.step(i % 40 === 1 ? { actions: { kick: { power: 5 + (i % 7) } } } : {}); } return rt.snapshot(); };
  assert.deepEqual(run(), run());
  const registry = new Registry(P), logic = buildLogic(registry, Logic);
  const bad = field({ teams: [{ id: 'a' }, { id: 'a' }], goals: [{ zone: 'moon', scores: 'z' }], ballAt: 3, overtime: 'penalties' });
  bad.systems.push({ use: 'gameplay.stage.sequence', with: { stages: [{ id: 's', clear: { sports: 'halftime' } }] } });
  const codes = new Set(preflight(bad, registry, logic).errors.map(e => e.code));
  for (const c of ['sports_teams', 'sports_ball', 'ref_unknown', 'param_option', 'sports_state']) assert.ok(codes.has(c), c);
});
