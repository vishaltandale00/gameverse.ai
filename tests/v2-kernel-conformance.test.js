import test from 'node:test';
import assert from 'node:assert/strict';
import { spaceConformance, testSpace, compile } from '../v2/kernel/testing.js';
import { PRIMITIVES } from '../v2/primitives/index.js';

const base = (space, zones, extra = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'conf', title: 'Conformance', seed: 7,
  spaces: [{ id: 'world', use: space, zones, ...extra }],
  content: { archetypes: [{ id: 'hero', components: {} }] }, player: { archetype: 'hero' },
});

spaceConformance(test, assert, {
  name: 'engine.space.test', primitives: [testSpace],
  doc: () => base('engine.space.test', [{ id: 'yard', rect: [4, 0, 8, 4] }], { with: { size: [12, 8, 1], solid: [[6, 6, 0]] } }),
  free: [1, 1, 0], other: [3, 1, 0], solid: [6, 6, 0],
});

spaceConformance(test, assert, {
  name: 'engine.space.graph', primitives: PRIMITIVES,
  doc: () => base('engine.space.graph', [{ id: 'hall', exits: [{ to: 'yard' }] }, { id: 'yard', exits: [{ to: 'hall' }] }]),
  free: 'hall', other: 'yard',
});

test('services, typed events and cross-space moves', () => {
  const doc = base('engine.space.test', [{ id: 'yard', rect: [0, 0, 4, 4] }], { with: { size: [8, 8, 1] } });
  doc.spaces.push({ id: 'inside', use: 'engine.space.graph', zones: [{ id: 'room', exits: [] }] });
  const { rt } = compile(doc, { primitives: [...PRIMITIVES, testSpace] });
  rt.provide('echo', { hi: () => 'hi' });
  assert.equal(rt.service('echo').hi(), 'hi');
  rt.emitTyped('defeated', 'slime', { who: 'player' });
  assert.equal(rt.state.counts['defeated:slime'], 1);
  rt.run([{ do: 'teleport', space: 'inside', zone: 'room' }]);
  assert.equal(rt.player().space, 'inside');
  assert.ok(rt.test({ zone: 'room' }));
});

test('graph exits honor plot gates that lock them', () => {
  const doc = base('engine.space.graph', [{ id: 'hall', exits: [{ to: 'vault' }] }, { id: 'vault', exits: [{ to: 'hall' }] }]);
  doc.systems = [{ use: 'plot.gate' }];
  doc.plot = { gates: [{ id: 'vault_door', requires: { flag: 'has_code' }, hint: 'Find the code.', locks: ['exit:hall>vault'] }] };
  const { rt } = compile(doc, { primitives: PRIMITIVES });
  rt.player().at = 'hall';
  assert.equal(rt.space('world').move(rt.player(), 'vault', rt), false, 'locked by the gate');
  assert.ok(!rt.space('world').reachable('hall', rt).has('vault'));
  rt.run([{ do: 'set_flag', flag: 'has_code' }]);
  assert.equal(rt.space('world').move(rt.player(), 'vault', rt), true, 'opens once the requirement holds');
});

test('modal input, deferred work, runtime capabilities and ifAbsent actions', () => {
  const doc = base('engine.space.graph', [{ id: 'hall', exits: [{ to: 'yard' }] }, { id: 'yard', exits: [{ to: 'hall' }] }]);
  const { rt } = compile(doc, { primitives: PRIMITIVES });
  const chose = [];
  rt.action('choose', v => chose.push(v));
  assert.equal(rt.action('choose', () => {}, { ifAbsent: true }), false, 'keeps the first owner');
  rt.openModal('plot.dialogue', { actions: ['choose'] });
  rt.step({ actions: { go: 'yard', choose: 0 } });
  assert.equal(rt.player().at, 'hall', 'movement is blocked while a modal is open');
  assert.deepEqual(chose, [0]);
  assert.deepEqual(rt.availableOptions(), [], 'graph moves are not offered during the modal');
  const snap = rt.snapshot(); assert.equal(snap.modal.owner, 'plot.dialogue');
  rt.closeModal('plot.dialogue');
  let order = [];
  rt.system('rules', rt => { order.push('system'); rt.defer(() => order.push('deferred')); });
  rt.step();
  assert.deepEqual(order, ['system', 'deferred']);
  assert.deepEqual(rt.capabilities('world').sort(), ['distance', 'navigate', 'position', 'reachable']);
});
