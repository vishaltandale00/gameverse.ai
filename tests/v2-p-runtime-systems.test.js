// engine.save, engine.stream, engine.beat, engine.replay, engine.assist over the reference test space.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile, run, testSpace } from '../v2/kernel/testing.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import { preflight, mergePatch } from '../v2/kernel/document.js';
import { checkFields } from '../v2/kernel/params.js';
import runtime from '../v2/primitives/engine/runtime.index.js';
import spaceGraph from '../v2/primitives/engine/space-graph.js';

const PRIMS = [testSpace, spaceGraph, ...runtime];
const zones = [{ id: 'a', rect: [0, 0, 8, 8] }, { id: 'b', rect: [8, 0, 16, 8] }, { id: 'c', rect: [40, 0, 48, 8] }];
const doc = (systems, extra = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'rt-sys', title: 'Runtime systems', seed: 4,
  spaces: [{ id: 'w', use: 'engine.space.test', with: { size: [64, 16, 1] }, zones }],
  content: { archetypes: [{ id: 'hero', components: {} }, { id: 'ghost', components: {} }] },
  player: { archetype: 'hero', at: [1, 1, 0] }, systems, ...extra,
});
const make = (systems, extra) => compile(doc(systems, extra), { primitives: PRIMS });
const codes = d => { const r = new Registry(PRIMS); return preflight(d, r, buildLogic(r, Logic)).errors.map(e => e.code); };

test('engine.save: slots, load restores state and keeps slots, checkpoints respawn, autosave on events', () => {
  const { rt } = make([{ use: 'engine.save', with: { intervalSec: 1, autosaveOn: ['enter_zone:b'], slots: 2 } }]);
  run(rt, 2);
  assert.ok(rt.test({ checkpoint: 'start' }));
  rt.state.vars.gold = 5;
  rt.step({ actions: { save_game: 1 } });
  assert.equal(rt.state.counts.saved, 1);
  rt.state.vars.gold = 99; rt.space('w').setPos(rt.player(), [20, 1, 0], rt);
  rt.step({ actions: { load_game: 1 } });
  assert.equal(rt.state.vars.gold, 5, 'state restored');
  assert.deepEqual(rt.player().at, [1, 1, 0]);
  assert.ok(rt.test({ has_save: 1 }), 'slots survive the load');
  assert.deepEqual(rt.service('save').slots().map(s => s.slot), [1]);
  rt.run([{ do: 'save_game', slot: 3 }]);
  assert.equal(rt.state.events.at(-1).name, 'save_failed', 'only slots 1..2 and auto');
  rt.space('w').setPos(rt.player(), [10, 1, 0], rt); rt.step();
  assert.ok(rt.test({ has_save: 'auto' }), 'autosave on entering b');
  rt.run([{ do: 'set_checkpoint', id: 'bench' }]);
  rt.space('w').setPos(rt.player(), [30, 3, 0], rt);
  rt.run([{ do: 'return_to_checkpoint' }]);
  assert.deepEqual(rt.player().at, [10, 1, 0]);
  assert.equal(rt.state.counts['checkpoint:bench'], 1);
  const before = rt.state.counts.saved; run(rt, 60);
  assert.ok(rt.state.counts.saved > before, 'interval autosave');
  assert.ok(!JSON.stringify(rt.state.prim['engine.save'].slots['1'].data).includes('"engine.save"'), 'saves never nest');
});

test('engine.stream: loads near regions within budget, unloads far ones, queues hot-loaded zones', () => {
  const { rt } = make([{ use: 'engine.stream', with: { preloadRadius: 8, unloadRadius: 20, loadsPerStep: 1, intervalSec: 0, always: ['c'] } }]);
  const loads = []; rt.service('stream').onLoad(r => loads.push(r.zone));
  run(rt, 1);
  assert.deepEqual(rt.service('stream').loaded(), ['a'], 'one per step, nearest first');
  run(rt, 3);
  assert.deepEqual(rt.service('stream').loaded(), ['a', 'b', 'c']);
  assert.deepEqual(loads, ['a', 'c', 'b'], 'hubs count as distance 0');
  rt.space('w').setPos(rt.player(), [60, 1, 0], rt); run(rt, 3);
  assert.deepEqual(rt.service('stream').loaded(), ['c'], 'always-loaded hub stays');
  assert.equal(rt.state.counts['region_unloaded:a'], 1);
  assert.ok(rt.test({ loaded: 'c' }) && !rt.test({ loaded: 'a' }));
  const { doc: next, added } = mergePatch(rt.doc, { spaces: [{ id: 'w', zones: [{ id: 'd', rect: [56, 0, 64, 8] }] }] });
  const r = new Registry(PRIMS), checked = preflight(next, r, buildLogic(r, Logic));
  assert.ok(checked.ok, JSON.stringify(checked.errors));
  rt.extend(checked.doc, added); run(rt, 1);
  assert.ok(rt.service('stream').isLoaded('d'), 'hot-loaded zone near the player');
});

test('engine.beat: beat and bar events on time, tempo changes, beat window and judged presses', () => {
  // 120 bpm = a beat every 30 frames.
  const { rt } = make([{ use: 'engine.input.actions', with: { verbs: ['move', 'tap'] } }, { use: 'engine.beat', with: { bpm: 120, beatsPerBar: 4, tempoChanges: [{ bar: 3, bpm: 240 }], judge: ['tap'], subdivisions: 2, onBar: [{ do: 'add_var', var: 'bars' }] } }]);
  run(rt, 1);
  assert.equal(rt.state.counts.beat, 1, 'beat 0 at start');
  run(rt, 238);
  assert.equal(rt.state.counts.beat, 8);
  assert.equal(rt.state.counts['beat:1'], 2);
  assert.equal(rt.state.vars.bars, 2);
  run(rt, 60);
  assert.equal(rt.state.counts.beat, 12, 'twice as fast from bar 3');
  assert.equal(rt.state.vars['beat.bpm'], 240);
  assert.equal(rt.state.vars['beat.bar'], 3);
  assert.ok(rt.state.counts.sub_beat >= 10);
  // Press right on the next beat (every 15 frames now).
  while (!(rt.test({ beat_window: 'beat', ms: 10 }))) rt.step();
  rt.step({ actions: { tap: true } });
  assert.equal(rt.state.vars['beat.grade'], 'perfect');
  run(rt, 3); rt.step({ actions: { tap: true } });
  assert.notEqual(rt.state.vars['beat.grade'], undefined);
  rt.run([{ do: 'stop_beat' }]); const n = rt.state.counts.beat; run(rt, 60);
  assert.equal(rt.state.counts.beat, n);
});

test('engine.replay: inputs replay a run exactly; traces become ghosts that follow and finish', () => {
  const sys = [{ use: 'engine.replay', with: { sampleEvery: 2, ghostArchetype: 'ghost', ghosts: [{ id: 'demo', points: [[0, 0, 0], [4, 0, 0]], every: 10, autostart: true }] } }];
  const mover = { id: 'gameplay.testmover', card: { intent: 'moves the player by axes.move for replay tests', provides: {} }, install(rt) { rt.system('movement', rt => { const p = rt.player(), m = rt.input.axes?.move; if (p && m) rt.space(p.space).setPos(p, [p.at[0] + m[0] * 0.1, p.at[1] + m[1] * 0.1, 0], rt); }); } };
  const d = doc([...sys, { use: 'gameplay.testmover' }]);
  const { rt } = compile(d, { primitives: [...PRIMS, mover] });
  run(rt, 1);
  const g = Object.values(rt.state.entities).find(e => e.components.ghost);
  run(rt, 5);
  assert.deepEqual(g.at, [2.4, 0, 0], 'interpolated between samples');
  run(rt, 10);
  assert.equal(rt.entity(g.id), undefined);
  assert.equal(rt.state.counts['ghost_finished:demo'], 1);
  for (let i = 0; i < 60; i++) rt.step({ axes: { move: [i < 30 ? 1 : 0, i >= 30 ? 1 : 0] }, actions: i === 10 ? { jump: true } : {} });
  const inputs = rt.service('replay').inputs();
  assert.equal(inputs.length, 76);
  const replayed = compile(d, { primitives: [...PRIMS, mover] }).rt;
  for (const input of inputs) replayed.step(input);
  assert.deepEqual(replayed.player().at, rt.player().at);
  assert.deepEqual(replayed.snapshot(), rt.snapshot(), 'recorded inputs reproduce the run');
  rt.run([{ do: 'save_ghost', ghost: 'run1' }, { do: 'start_ghost', ghost: 'run1', id: 'me2' }]);
  assert.deepEqual(rt.entity('me2').at, [1, 1, 0]);
  run(rt, 40);
  assert.ok(rt.entity('me2').at[0] > 1.5, 'follows the recorded path');
});

test('engine.assist: presets publish vars, menus respect locks, adaptive rules apply or offer help', () => {
  const { rt } = make([{ use: 'engine.assist', with: { difficulty: 'hard', locked: ['invincible'], rules: [{ when: { count: 'died', gte: 3 }, preset: 'easy' }, { when: { count: 'died', gte: 5 }, set: { invincible: true }, offer: true }] } }]);
  run(rt, 1);
  assert.equal(rt.state.vars['assist.damage_taken'], 1.5);
  assert.equal(rt.state.vars['assist.difficulty'], 'hard');
  rt.step({ actions: { assist: { option: 'game_speed', value: 0.1 } } });
  assert.equal(rt.state.vars['assist.game_speed'], 0.25, 'clamped to its range');
  rt.step({ actions: { assist: { option: 'invincible', value: true } } });
  assert.equal(rt.state.vars['assist.invincible'], false, 'locked option');
  rt.run([{ do: 'set_assist', option: 'invincible', value: true }]);
  assert.equal(rt.state.vars['assist.invincible'], true, 'effects may change locked options');
  for (let i = 0; i < 5; i++) rt.emit('died');
  run(rt, 60);
  assert.equal(rt.state.vars['assist.difficulty'], 'easy');
  assert.equal(rt.state.counts.assist_offered, 1);
});

test('systems primitives replay deterministically across snapshot/restore', () => {
  const sys = [{ use: 'engine.save', with: { intervalSec: 1 } }, { use: 'engine.stream', with: { preloadRadius: 6, unloadRadius: 12 } }, { use: 'engine.beat', with: { bpm: 150, subdivisions: 3, swing: 0.2 } }, { use: 'engine.replay' }, { use: 'engine.assist' }];
  const drive = (rt, from, to) => { for (let i = from; i < to; i++) { if (i % 70 === 0) rt.space('w').setPos(rt.player(), [(i * 7) % 60, 1, 0], rt); rt.step({ axes: { move: [i % 3 - 1, 0] } }); } };
  const a = make(sys).rt, b = make(sys).rt;
  drive(a, 0, 300); drive(b, 0, 150);
  const snap = b.snapshot(); drive(b, 150, 190); b.restore(snap); drive(b, 150, 300);
  assert.deepEqual(a.snapshot(), b.snapshot());
});

test('preflight rejects bad systems configs with stable codes', () => {
  const bad = doc([
    { use: 'engine.stream', with: { preloadRadius: 50, unloadRadius: 10 } },
    { use: 'engine.beat', with: { tempoChanges: [{ bar: 2, bpm: 90 }, { bar: 2, bpm: 100 }], grades: [{ id: 'a', ms: 50 }, { id: 'b', ms: 20 }] } },
    { use: 'engine.replay', with: { ghosts: [{ id: 'g', points: [null] }] } },
    { use: 'engine.assist', with: { options: { speed: 1, mode: 'x' }, presets: { normal: { power: 2 }, easy: { speed: true } }, difficulty: 'nightmare', locked: ['nope'] } },
    { use: 'plot.storyboard' },
  ]);
  bad.plot = { storyboard: { acts: [{ id: 'a', beats: [{ id: 'b', do: [{ do: 'save_game', slot: 0 }, { do: 'set_tempo', bpm: 1 }, { do: 'set_assist', option: 'speed' }, { do: 'save_ghost' }] }] }] } };
  const r = new Registry([...PRIMS, storyboardPrim]); const c = preflight(bad, r, buildLogic(r, Logic)).errors.map(e => e.code);
  for (const code of ['stream_radius', 'beat_tempo_invalid', 'beat_grades_invalid', 'replay_ghost_archetype', 'replay_points_invalid', 'assist_option_type', 'assist_option_unknown', 'assist_preset_unknown', 'save_slot_invalid', 'beat_effect_invalid', 'assist_effect_invalid', 'replay_effect_invalid']) assert.ok(c.includes(code), code);
  void codes;
});
import storyboardPrim from '../v2/primitives/plot/storyboard.js';

test('every engine.save/stream instance in v2/games has valid params', () => {
  let n = 0;
  for (const id of ['blockport', 'emberfall', 'hollow-lantern', 'quiet-manor']) {
    const g = JSON.parse(readFileSync(new URL(`../v2/games/${id}.json`, import.meta.url)));
    (g.systems || []).forEach((s, i) => {
      if (!['engine.save', 'engine.stream', 'engine.beat', 'engine.replay', 'engine.assist', 'engine.script.sandbox'].includes(s.use)) return;
      const p = runtime.find(x => x.id === s.use), errors = [];
      checkFields(p.card.params, s.with || {}, `${id}.systems[${i}].with`, errors); n++;
      assert.deepEqual(errors, [], `${id} systems[${i}]`);
    });
  }
  assert.equal(n, 5);
});
