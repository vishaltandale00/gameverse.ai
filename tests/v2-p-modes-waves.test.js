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
const arch = [{ id: 'drone', components: { health: { max: 2 } } }, { id: 'brute', components: { health: { max: 10 } } }];
const wavesDoc = w => doc({ with: { size: [40, 40, 1] }, archetypes: arch, player: { archetype: 'hero', at: [20, 2, 0] },
  systems: [{ use: 'gameplay.combat.health' }, { use: 'gameplay.waves', with: { lanes: [{ id: 'top', at: [20, 35, 0] }, { id: 'left', at: [2, 20, 0] }], ...w } }] });
const wave = (rt, n) => Object.values(rt.state.entities).filter(e => e.components.wave?.wave === n && e.components.health?.hp !== 0);
const killAll = (rt, n) => { for (const e of wave(rt, n)) rt.run([{ do: 'kill', who: e.id }]); };

test('waves: timed waves pour in staggered, in formation at lanes', () => {
  const { rt } = compile(wavesDoc({ stagger: 0.1, waves: [{ at: 1, spawn: [{ archetype: 'drone', count: 5, lane: 'top', pattern: 'line', spacing: 2 }] }, { at: 3, spawn: [{ archetype: 'brute', count: 1, lane: 'left' }] }] }), { primitives: P });
  drive(rt, 59); assert.equal(rt.state.counts.wave_start, undefined);
  rt.step(); assert.equal(rt.state.counts['wave_start:w1'], 1);
  assert.equal(wave(rt, 1).length, 1, 'first of five appears at once');
  drive(rt, 30);
  const xs = wave(rt, 1).map(e => e.at[0]).sort((a, b) => a - b);
  assert.deepEqual(xs, [16, 18, 20, 22, 24], 'line formation centred on the lane');
  assert.ok(rt.test({ wave: 'waves', gte: 1 }));
  drive(rt, 120);
  assert.equal(rt.state.counts['wave_start:w2'], 1);
  assert.deepEqual(wave(rt, 2)[0].at, [2, 20, 0]);
});

test('waves: telegraphs warn first; the live cap holds the queue', () => {
  const { rt } = compile(wavesDoc({ telegraph: 0.5, stagger: 0, maxAlive: 3, waves: [{ spawn: [{ archetype: 'drone', count: 6, lane: 'top', pattern: 'ring', spacing: 3 }] }] }), { primitives: P });
  rt.step();
  assert.equal(rt.state.counts.wave_telegraph, 6);
  assert.equal(wave(rt, 1).length, 0, 'nothing yet: telegraphing');
  drive(rt, 31);
  assert.equal(wave(rt, 1).length, 3, 'capped at maxAlive');
  killAll(rt, 1); drive(rt, 2);
  assert.equal(wave(rt, 1).length, 3, 'the rest pour in as space frees');
  assert.equal(rt.state.vars['waves.alive'], 3);
});

test('waves: mustClear gates the next wave; clears bank bonus; loops scale up', () => {
  const { rt } = compile(wavesDoc({ mustClear: true, stagger: 0, loop: true, bonus: { points: 100, var: 'score' }, waves: [{ spawn: [{ archetype: 'drone', count: 2, lane: 'top' }] }, { delay: 1, spawn: [{ archetype: 'brute', count: 2, lane: 'left' }] }] }), { primitives: P });
  drive(rt, 200);
  assert.equal(rt.state.counts['wave_start:w2'], undefined, 'wave 2 waits for wave 1 to be cleared');
  killAll(rt, 1); drive(rt, 2);
  assert.equal(rt.state.counts['wave_clear:w1'], 1); assert.equal(rt.state.vars.score, 100);
  drive(rt, 59); assert.equal(rt.state.counts['wave_start:w2'], 1, 'delay counts from the clear');
  killAll(rt, 2); drive(rt, 3);
  assert.equal(rt.state.counts.waves_complete, 1); assert.equal(rt.state.counts.waves_loop, 1);
  drive(rt, 2);
  assert.equal(wave(rt, 1).length, 3, 'loop 1: count x1.25 rounded (2 -> 3)');
  assert.equal(wave(rt, 1)[0].components.health.max, 2.6, 'hp x1.3');
});

test('waves: generated waves grow (more and tougher) and entry paths hand over to AI', () => {
  const { rt } = compile(wavesDoc({ stagger: 0, maxAlive: 30, entries: [{ id: 'swoop', points: [[0, -10, 0], [5, -15, 0]], speed: 30, mirror: true }], generate: { count: 4, every: 1, size: 2, grow: 'both', archetypes: ['drone'], lanes: ['top'], entry: 'swoop', pattern: 'line', spacing: 2 } }), { primitives: P });
  drive(rt, 61);
  const first = wave(rt, 1); assert.equal(first.length, 2);
  assert.ok(first.every(e => e.components.waveEntry), 'flying the entry path');
  drive(rt, 60);
  assert.ok(first.every(e => !rt.entity(e.id).components.waveEntry), 'path done');
  assert.equal(rt.state.counts.wave_entered, 2);
  assert.deepEqual(rt.entity(first[0].id).at, [24, 20, 0]); assert.deepEqual(rt.entity(first[1].id).at, [16, 20, 0], 'odd spawns mirror the path');
  drive(rt, 200);
  assert.deepEqual([1, 2, 3, 4].map(n => wave(rt, n).length), [2, 3, 4, 5]);
  assert.equal(wave(rt, 3)[0].components.health.max, 4, 'tougher: +1 hp multiple every two waves');
});

test('waves: start_waves, deterministic replay', () => {
  const d = wavesDoc({ autoStart: false, waves: [{ spawn: [{ archetype: 'drone', count: 3, lane: 'top', pattern: 'random', spacing: 4 }] }] });
  const { rt } = compile(d, { primitives: P });
  drive(rt, 10); assert.ok(rt.test({ wave: 'waves', state: 'idle' }));
  rt.run([{ do: 'start_waves' }]); drive(rt, 60);
  assert.equal(wave(rt, 1).length, 3);
  const play = () => { const { rt } = compile(wavesDoc({ generate: { count: 3, every: 0.5, archetypes: ['drone', 'brute'], lanes: ['top', 'left'], pattern: 'random', spacing: 5 } }), { primitives: P }); drive(rt, 200); return rt.snapshot(); };
  assert.deepEqual(play(), play());
});

test('waves: preflight rejects bad configs with stable codes', () => {
  const registry = new Registry(P), logic = buildLogic(registry, Logic);
  const errorsOf = w => preflight(wavesDoc(w), registry, logic).errors, codes = w => new Set(errorsOf(w).map(e => e.code));
  const a = codes({});
  assert.ok(a.has('waves_empty'));
  const bad = { waves: [{ spawn: [{ archetype: 'ghoul', lane: 'mid', entry: 'loop', pattern: 'blob' }, { archetype: 'drone', lane: 'top', at: [1, 1, 0] }] }, { spawn: [] }], generate: { count: 2, archetypes: [] } };
  const b = codes(bad);
  for (const c of ['ref_unknown', 'param_option', 'waves_spawn_place', 'param_range', 'waves_generate']) assert.ok(b.has(c), c);
  // Lanes and entry paths are reference kinds the card defines (wave_lane, wave_entry): an unknown one is ref_unknown at its field.
  const refs = new Set(errorsOf(bad).filter(e => e.code === 'ref_unknown').map(e => e.path.replace(/^systems\[\d+\]\.with\./, '')));
  for (const p of ['waves[0].spawn[0].lane', 'waves[0].spawn[0].entry']) assert.ok(refs.has(p), p);
  assert.ok(preflight(wavesDoc({ waves: [{ spawn: [{ archetype: 'drone' }] }] }), registry, logic).ok);
});
