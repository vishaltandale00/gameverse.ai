import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, testSpace } from '../v2/kernel/testing.js';
import { preflight } from '../v2/kernel/document.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import modes from '../v2/primitives/gameplay/modes.index.js';
import { stubHealth, doc, drive } from '../v2/primitives/gameplay/modes-lib-testing.js';

const P = [...modes, testSpace, stubHealth];
const fast = { introSec: 0, clearSec: 0.1, failSec: 0.1 };
const seq = (w, extra = []) => doc({ with: { size: [10, 10, 1] }, zones: [{ id: 'a', rect: [0, 0, 5, 10] }, { id: 'b', rect: [5, 0, 10, 10] }], archetypes: [{ id: 'rival', components: { health: { max: 5 } } }, { id: 'drone', components: {} }],
  systems: [...extra, { use: 'gameplay.stage.sequence', with: { ...fast, ...w } }] });
const run = (d, f) => { const { rt } = compile(d, { primitives: P }); rt.step(); f?.(rt); return rt; };

test('stage.sequence: puzzle goals (lines, score with stars, jelly remaining), clears and completion', () => {
  const rt = run(seq({ stages: [
    { id: 'l1', goal: { kind: 'lines', target: 4 } },
    { id: 'l2', goal: { kind: 'score', target: 500 }, stars: [500, 800, 1200] },
    { id: 'l3', goal: { kind: 'jelly' } },
  ] }));
  assert.ok(rt.test({ stage: 'l1', phase: 'play' }));
  rt.emit('lines_cleared', { count: 3 }); rt.step();
  assert.equal(rt.state.vars['stage.progress'], 0.75);
  rt.emit('lines_cleared', { count: 1 }); rt.step();
  assert.equal(rt.state.counts['stage_clear:l1'], 1);
  drive(rt, 8);
  assert.ok(rt.test({ stage: 'l2' }));
  rt.state.vars.score = 900; rt.step();
  assert.equal(rt.state.counts['stage_clear:l2'], 1);
  assert.equal(rt.state.vars['stage.stars'], 2);
  drive(rt, 8);
  rt.state.vars['match.jelly'] = 6; rt.step();
  assert.equal(rt.state.counts['stage_clear:l3'] ?? 0, 0);
  rt.state.vars['match.jelly'] = 2; rt.step(); assert.ok(Math.abs(rt.state.vars['stage.progress'] - 4 / 6) < 1e-6);
  rt.state.vars['match.jelly'] = 0; rt.step();
  drive(rt, 8);
  assert.equal(rt.state.counts.sequence_complete, 1);
  assert.equal(rt.state.status, 'won');
  assert.equal(rt.state.vars['stage.starsTotal'], 2);
});

test('stage.sequence: move limits fail the stage; lives allow retries, then game over', () => {
  const rt = run(seq({ lives: 1, stages: [{ id: 'm1', goal: { kind: 'chain', target: 3, moves: 2 } }] }));
  rt.emit('move'); rt.emit('chain', { length: 2 }); rt.step();
  assert.equal(rt.state.vars['stage.moves'], 1);
  rt.emit('move'); rt.step();
  assert.equal(rt.state.counts['stage_fail:m1'], 1);
  drive(rt, 8);
  assert.equal(rt.state.counts['stage_intro:m1'], 2, 'retried');
  assert.equal(rt.state.vars['stage.lives'], 0);
  rt.emit('move'); rt.emit('move'); drive(rt, 10);
  assert.equal(rt.state.counts.sequence_over, 1);
  assert.equal(rt.state.status, 'lost');
});

test('stage.sequence: survive and time limits; predicate goals; fail predicates', () => {
  const rt = run(seq({ stages: [{ id: 's1', goal: { kind: 'survive', timeSec: 1 } }, { id: 's2', goal: { kind: 'when', when: { flag: 'switch' }, timeSec: 0.5 } }] }));
  drive(rt, 58); assert.equal(rt.state.counts['stage_clear:s1'] ?? 0, 0); rt.step();
  assert.equal(rt.state.counts['stage_clear:s1'], 1);
  drive(rt, 40);
  assert.equal(rt.state.counts['stage_fail:s2'], 1, 'time ran out');
  drive(rt, 8); rt.state.flags.switch = true; rt.step();
  assert.equal(rt.state.counts['stage_clear:s2'], 1);
});

test('stage.sequence: per-stage tables and params write vars and other primitives\' configs; restore re-applies; loops scale', () => {
  const extra = [{ use: 'gameplay.waves', with: { waves: [{ at: 999, spawn: [{ archetype: 'drone' }] }], maxAlive: 12 } }];
  const d = seq({ loop: true, loopScale: { 'var:ghost.speed': 0.1 }, apply: [{ target: 'var:ghost.speed', table: [0.75, 0.85, 0.95] }, { target: 'use:gameplay.waves.maxAlive', table: [4, 6], op: 'set', loopScale: 0.5 }],
    stages: [{ id: 'one', params: { 'var:fright': 6 }, clear: { flag: 'go' } }, { id: 'two', params: { 'var:fright': 5 }, clear: { flag: 'go' } }] }, extra);
  const { rt } = compile(d, { primitives: P }); rt.step();
  const waves = () => rt.doc.systems.find(s => s.use === 'gameplay.waves').with;
  assert.equal(rt.state.vars['ghost.speed'], 0.75); assert.equal(rt.state.vars.fright, 6); assert.equal(waves().maxAlive, 4);
  const snap = rt.snapshot();
  rt.state.flags.go = true; drive(rt, 3); rt.state.flags.go = false; drive(rt, 8);
  assert.ok(rt.test({ stage: 'two' }));
  assert.equal(rt.state.vars['ghost.speed'], 0.85); assert.equal(rt.state.vars.fright, 5); assert.equal(waves().maxAlive, 6);
  rt.restore(snap);
  assert.equal(waves().maxAlive, 4, 'restore re-applies config writes for the restored stage');
  rt.state.flags.go = true; drive(rt, 3); rt.state.flags.go = false; drive(rt, 8);
  rt.state.flags.go = true; drive(rt, 3); rt.state.flags.go = false; drive(rt, 8);
  assert.equal(rt.state.counts.stage_loop, 1);
  assert.equal(rt.state.vars['stage.loop'], 1);
  assert.equal(rt.state.vars['ghost.speed'], 0.825, 'loop 1: 0.75 x 1.1');
  assert.equal(waves().maxAlive, 6, 'loop 1: 4 x 1.5');
});

test('stage.sequence: arcade ladder spawns the next opponent, clears the last; stage select unlocks', () => {
  const ladder = seq({ select: true, autoStart: true, stages: [
    { id: 'r1', spawn: [{ archetype: 'rival', id: 'foe', at: [6, 1, 0] }], clearOut: ['rival'], clear: { flag: 'beat' }, zone: 'a' },
    { id: 'r2', spawn: [{ archetype: 'rival', id: 'foe', at: [8, 1, 0] }], clearOut: ['rival'], clear: { flag: 'beat2' }, zone: 'b' },
  ] });
  const rt = run(ladder);
  assert.deepEqual(rt.entity('foe').at, [6, 1, 0]);
  assert.ok(rt.test({ zone: 'a' }));
  rt.state.flags.beat = true; drive(rt, 10);
  assert.ok(rt.test({ stage: 'r2' })); assert.deepEqual(rt.entity('foe').at, [8, 1, 0]); assert.ok(rt.test({ zone: 'b' }));
  const sel = run(seq({ select: true, autoStart: false, stages: [{ id: 'x1', clear: { flag: 'ok' } }, { id: 'x2' }, { id: 'x3' }] }));
  assert.deepEqual(sel.availableOptions().map(o => o.label), ['stage x1']);
  sel.step({ actions: { select_stage: 'x3' } }); assert.ok(!sel.test({ stage: 'x3' }), 'locked');
  sel.step({ actions: { select_stage: 'x1' } }); assert.ok(sel.test({ stage: 'x1' }));
  sel.state.flags.ok = true; sel.step();
  assert.ok(sel.test({ stage: 'x1', cleared: true }));
});

test('stage.sequence: endless continues past the last stage and replay is deterministic', () => {
  const rt = run(seq({ endless: true, loopScale: { 'var:speed': 1 }, stages: [{ id: 'e1', params: { 'var:speed': 2 }, goal: { kind: 'collect', target: 1 } }] }));
  for (let i = 0; i < 3; i++) { rt.emit('collected', { count: 1 }); drive(rt, 9); }
  assert.equal(rt.state.vars['stage.number'], 4);
  assert.equal(rt.state.vars.speed, 8, 'endless stage 4 = 2 x (1 + 1 x 3)');
  const play = () => { const r = run(seq({ lives: 3, stages: [{ id: 'a1', goal: { kind: 'tile', target: 64, moves: 5 }, stars: [1, 2] }, { id: 'a2', goal: { kind: 'lines', target: 2 } }] })); for (let i = 0; i < 40; i++) { if (i % 3 === 0) r.emit('move'); if (i % 7 === 0) r.emit('merged', { value: 2 ** (i % 8) }); if (i % 5 === 0) r.emit('lines_cleared', { count: 1 }); r.step(); } return r.snapshot(); };
  assert.deepEqual(play(), play());
});

test('stage.sequence: preflight rejects bad configs with stable codes', () => {
  const registry = new Registry(P), logic = buildLogic(registry, Logic);
  const bad = seq({ loop: true, endless: true, startAt: 7, apply: [{ target: 'nonsense', table: [1] }, { target: 'use:gameplay.nothing.speed', table: [1] }, { target: 'use:gameplay.stage.sequence.bogus', table: [1] }],
    stages: [{ id: 'a', goal: { kind: 'when' }, stars: [3, 2] }, { id: 'a', goal: { kind: 'survive' } }, { id: 'c', goal: { kind: 'tile', target: 100 } }, { id: 'd', goal: { kind: 'sparkle' } }] });
  bad.systems.push({ use: 'gameplay.race', with: { checkpoints: ['a'], startWhen: { stage: 'zzz', phase: 'party' } } });
  const codes = new Set(preflight(bad, registry, logic).errors.map(e => e.code));
  for (const c of ['stage_target', 'stage_goal', 'stage_duplicate', 'stage_stars', 'stage_loop', 'param_option', 'param_range', 'stage_phase', 'ref_unknown']) assert.ok(codes.has(c), c);
  assert.ok(preflight(seq({ stages: [{ id: 'ok', goal: { kind: 'score', target: 10 } }] }), registry, logic).ok);
});
