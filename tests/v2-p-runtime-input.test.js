// engine.input.actions and engine.input.motions: per-entity input views, press edges, claims,
// the pure device sampler, and motion recognition through rt.step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile, run, testSpace } from '../v2/kernel/testing.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import { preflight } from '../v2/kernel/document.js';
import { checkFields } from '../v2/kernel/params.js';
import runtime from '../v2/primitives/engine/runtime.index.js';
import { compile as compileKeys, sample, glyph, keyName } from '../v2/primitives/engine/runtime-lib-input.js';

const PRIMS = [testSpace, ...runtime];
const doc = (systems, extra = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'rt-input', title: 'Runtime input', seed: 1, views: { primary: 'side' },
  spaces: [{ id: 'w', use: 'engine.space.test', with: { size: [16, 8, 1] } }],
  content: { archetypes: [{ id: 'hero', components: { body: { facing: 1 } } }, { id: 'cpu', components: { body: { facing: -1 }, input: {} } }] },
  player: { archetype: 'hero', at: [1, 1, 0] }, systems, ...extra,
});
const make = systems => compile(doc(systems), { primitives: PRIMS });
const codes = d => { const r = new Registry(PRIMS); return preflight(d, r, buildLogic(r, Logic)).errors.map(e => e.code); };
const actions = { use: 'engine.input.actions', with: { verbs: ['move', 'jump', 'attack', 'alt_attack', 'use', 'dash'], bindings: { side: { move: ['arrows', 'lstick'], jump: ['space', 'pad_a'], attack: ['j'], alt_attack: ['k'], use: ['e'] } } } };

test('engine.input.actions: player and AI entities get the same input view with press edges', () => {
  const { rt } = make([actions]);
  const input = rt.service('input');
  rt.step({ held: { jump: true }, axes: { move: [1, 0] } });
  assert.equal(input.pressed('player', 'jump'), true);
  assert.deepEqual(input.axis('player'), [1, 0]);
  rt.step({ held: { jump: true } });
  assert.equal(input.pressed('player', 'jump'), false, 'held, not pressed again');
  assert.equal(input.held('player', 'jump'), true);
  rt.step({ actions: { attack: true } });
  assert.equal(input.pressed('player', 'attack'), true);
  assert.equal(rt.state.counts.action, 1, 'every verb is a kernel action');
  const cpu = rt.spawn('cpu', { at: [5, 1, 0] });
  cpu.components.input = { held: { jump: true }, actions: { use: true }, axes: { move: [-1, 0] } };
  rt.step();
  assert.equal(input.pressed(cpu.id, 'jump'), true);
  assert.equal(input.pressed(cpu.id, 'use'), true);
  assert.deepEqual(cpu.components.input.actions, {}, 'one-shot actions are consumed');
  rt.step();
  assert.equal(input.pressed(cpu.id, 'use'), false);
  assert.equal(input.held(cpu.id, 'jump'), true);
});

test('engine.input.actions: claims hand out free verbs; glyphs follow the device; bindings per view', () => {
  const { rt } = make([actions]);
  const input = rt.service('input');
  assert.equal(input.claim('gameplay.bomb', { prefer: ['use'] }), 'use');
  assert.equal(input.claim('gameplay.shield', { prefer: ['use'] }), null, 'taken');
  assert.equal(input.claim('gameplay.shield', { prefer: ['use'], any: true }), 'jump');
  assert.equal(input.claim('gameplay.bomb', { prefer: ['use'] }), 'use', 'idempotent per owner');
  assert.ok(!input.free().includes('use'));
  assert.equal(input.glyph('jump'), 'Space');
  assert.equal(input.glyph('jump', 'gamepad'), 'A');
  assert.deepEqual(input.keys('attack'), ['j']);
});

test('input sampler: keys, axes, sticks, mouse look, ranges and wheel map to verbs', () => {
  const map = compileKeys({ '1p': { move: ['wasd', 'lstick'], look: ['mouse', 'rstick'], jump: ['space'], hotbar: ['1-9', 'wheel'], mine: ['lmb'] } }, new Set(['move', 'look']))['1p'];
  const dev = { down: new Set(['w', 'd', 'space', 'lmb']), pressed: new Set(['space', '3']), mouse: { dx: 100, dy: -40 }, wheel: 0, sticks: { lstick: [0, 0], rstick: [0, 0] } };
  const out = sample(map, dev);
  assert.ok(Math.abs(Math.hypot(...out.axes.move) - 1) < 1e-9, 'diagonal normalized');
  assert.ok(out.axes.move[0] > 0 && out.axes.move[1] > 0);
  assert.ok(Math.abs(out.axes.look[0] - 0.25) < 1e-9 && out.axes.look[1] > 0, 'mouse in radians, up is positive pitch');
  assert.deepEqual(out.held, { jump: true, mine: true });
  assert.equal(out.actions.jump, true);
  assert.equal(out.actions.hotbar, 3);
  const pad = sample(map, { down: new Set(), pressed: new Set(), sticks: { lstick: [0.1, -0.9], rstick: [0, 0] }, wheel: 1 });
  assert.deepEqual(pad.axes.move, [0, 0.9], 'deadzone and y flip');
  assert.equal(pad.actions.hotbar, 1);
  assert.equal(keyName('KeyW'), 'w'); assert.equal(keyName('ArrowLeft'), 'left'); assert.equal(glyph('pad_b'), 'B');
});

test('engine.input.motions: quarter circle, dragon punch priority, charge, double-tap dash, facing and AI input', () => {
  const { rt } = make([actions, { use: 'engine.input.motions' }]);
  const m = rt.service('motions');
  const feed = (frames, who = 'player') => { for (const f of frames) { if (who === 'player') rt.step(f); else { rt.entity(who).components.input = structuredClone(f); rt.step(); } } };
  feed(m.frames('qcf', 'attack'));
  assert.equal(rt.state.counts['motion:qcf'], 1);
  assert.equal(m.last('player').button, 'attack');
  feed(Array.from({ length: 20 }, () => ({})));
  feed(m.frames('dp', 'alt_attack'));
  assert.equal(rt.state.counts['motion:dp'], 1, 'dp wins over qcf on the same press');
  assert.equal(rt.state.counts['motion:qcf'], 1);
  feed(Array.from({ length: 20 }, () => ({})));
  feed(m.frames('charge-bf', 'attack'));
  assert.equal(rt.state.counts['motion:charge-bf'], 1);
  feed(Array.from({ length: 20 }, () => ({})));
  // Too short a charge does nothing.
  feed([...Array.from({ length: 10 }, () => ({ axes: { move: [-1, -1] } })), { axes: { move: [1, 0] }, actions: { attack: true }, held: { attack: true } }]);
  assert.equal(rt.state.counts['motion:charge-bf'], 1);
  feed(Array.from({ length: 20 }, () => ({})));
  feed(m.frames('dash-f'));
  assert.equal(rt.state.counts['motion:dash-f'], 1, 'buttonless double tap');
  assert.ok(rt.test({ motion: 'dash-f', within: 2 }));
  // AI fighter facing left: absolute input, mirrored by the parser.
  const cpu = rt.spawn('cpu', { at: [8, 1, 0] });
  feed([{}, ...m.frames('qcf', 'attack', -1)], cpu.id);
  assert.equal(m.last(cpu.id)?.motion, 'qcf');
  // Every library motion is enterable through the real input path for both facings.
  for (const id of m.list()) for (const facing of [1, -1]) {
    const { rt: r } = make([actions, { use: 'engine.input.motions' }]);
    r.player().components.body.facing = facing;
    for (const f of r.service('motions').frames(id, 'attack', facing)) r.step(f);
    assert.equal(r.service('motions').last('player')?.motion, id, `${id} facing ${facing}`);
  }
});

test('input primitives replay deterministically across snapshot/restore', () => {
  const sys = [actions, { use: 'engine.input.motions' }];
  const script = i => (i % 9 < 3 ? { axes: { move: [i % 3 - 1, -1] } } : i % 9 === 4 ? { actions: { attack: true }, held: { attack: true }, axes: { move: [1, 0] } } : { held: { jump: i % 2 === 0 } });
  const a = make(sys).rt, b = make(sys).rt;
  for (let i = 0; i < 300; i++) a.step(script(i));
  for (let i = 0; i < 150; i++) b.step(script(i));
  const snap = b.snapshot(); for (let i = 0; i < 20; i++) b.step({}); b.restore(snap);
  for (let i = 150; i < 300; i++) b.step(script(i));
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.ok(a.state.counts.motion > 0);
});

test('preflight rejects bad input configs with stable codes', () => {
  const bad = doc([
    { use: 'engine.input.actions', with: { verbs: ['move', 'jump', 'Jump!'], bindings: { side: { jump: ['space', 'warp_key'], fly: ['f'], move: ['wasd'] }, td: { jump: ['w'], move: ['wasd'] } }, shareKeys: [['nope']] } },
    { use: 'engine.input.motions', with: { motions: [{ id: 'x', steps: ['2', 'sideways'], buttons: ['kick'] }, { id: 'x', charge: 'down' }, { id: 'y' }], sets: { bad: [0, 12] } } },
  ]);
  const c = codes(bad);
  for (const code of ['input_verb_invalid', 'input_key_unknown', 'input_verb_unknown', 'motion_set_unknown', 'motion_button_unknown', 'motion_duplicate', 'motion_invalid', 'motion_set_invalid']) assert.ok(c.includes(code), code);
  const conflict = doc([{ use: 'engine.input.actions', with: { verbs: ['move', 'jump'], bindings: { td: { jump: ['w'], move: ['wasd'] } } } }]);
  assert.ok(codes(conflict).includes('input_binding_conflict'));
  // An axis verb is bound to axis sources: a single key would send a press (`move: true`), not a direction.
  const keyed = doc([{ use: 'engine.input.actions', with: { verbs: ['move', 'jump'], bindings: { side: { move: ['left', 'right', 'wasd'], jump: ['space'] } } } }]);
  assert.deepEqual(codes(keyed).filter(c => c === 'input_axis_key'), ['input_axis_key', 'input_axis_key']);
  const sourced = doc([{ use: 'engine.input.actions', with: { verbs: ['move', 'jump'], bindings: { side: { move: ['arrows', 'wasd', 'lstick'], jump: ['space'] } } } }]);
  assert.ok(!codes(sourced).includes('input_axis_key'));
});

test('every engine.input.* instance in v2/games has valid params and no binding conflicts', () => {
  let n = 0;
  const ctx = { checkPredicate() {}, checkEffect() {}, noteRef() {} };
  for (const id of ['blockport', 'emberfall', 'hollow-lantern', 'quiet-manor']) {
    const g = JSON.parse(readFileSync(new URL(`../v2/games/${id}.json`, import.meta.url)));
    (g.systems || []).forEach((s, i) => {
      if (!s.use.startsWith('engine.input.')) return;
      const p = runtime.find(x => x.id === s.use), errors = [];
      const cfg = checkFields(p.card.params, s.with || {}, `${id}.systems[${i}].with`, errors); n++;
      errors.push(...p.validate(cfg, g, ctx));
      assert.deepEqual(errors, [], `${id} systems[${i}]`);
    });
  }
  assert.equal(n, 3);
});
