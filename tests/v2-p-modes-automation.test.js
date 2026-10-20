import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, testSpace } from '../v2/kernel/testing.js';
import { preflight } from '../v2/kernel/document.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import modes from '../v2/primitives/gameplay/modes.index.js';
import { doc, drive } from '../v2/primitives/gameplay/modes-lib-testing.js';

const P = [...modes, testSpace];
const roles = { belts: { belt_e: { dir: 'e', speed: 4 } }, inserters: { arm: { from: 'w', to: 'e', swingSec: 0.25 } }, machines: { press: { recipes: ['gear'], out: 'e', buffer: 4 } }, sources: { drill: { item: 'iron', every: 0.25, out: 'e' } }, sinks: { chest: {} } };
const factoryDoc = (w = {}) => doc({ with: { size: [16, 4, 1] }, player: { archetype: 'hero', at: [0, 3, 0] },
  content: { items: [{ id: 'iron', name: 'Iron' }, { id: 'gear', name: 'Gear' }], recipes: [{ id: 'gear', inputs: [{ item: 'iron', count: 2 }], output: { item: 'gear', count: 1 }, time: 0.5 }] },
  systems: [{ use: 'gameplay.automation', with: { ...roles, ...w } }] });
const build = rt => { const api = rt.space('world'), set = (x, b) => api.setCell([x, 1, 0], b, rt); set(1, 'drill'); for (let x = 2; x <= 5; x++) set(x, 'belt_e'); set(6, 'press'); set(7, 'belt_e'); set(8, 'belt_e'); set(9, 'arm'); set(10, 'chest'); };

test('automation: drill -> belts -> press -> belts -> inserter -> chest delivers gears at a steady rate', () => {
  const { rt } = compile(factoryDoc(), { primitives: P });
  build(rt);
  drive(rt, 600);
  assert.ok(rt.state.vars['auto.produced.gear'] >= 15, `produced ${rt.state.vars['auto.produced.gear']}`);
  assert.ok(rt.state.vars['auto.delivered.gear'] >= 12);
  assert.ok(rt.state.vars['auto.rate.gear'] > 10, 'per-minute rate over the window');
  assert.ok(rt.state.counts['item_delivered:gear'] >= 12);
  const items = rt.service('automation').itemsAt([3, 1, 0]);
  assert.ok(items.length <= 4);
  const ps = items.map(i => i.p).sort((a, b) => a - b);
  for (let i = 1; i < ps.length; i++) assert.ok(ps[i] - ps[i - 1] >= 0.25 - 1e-6, 'items keep their spacing');
});

test('automation: back-pressure fills belts and stalls the source; edits update the layout', () => {
  const { rt } = compile(factoryDoc({ sinks: { chest: { capacity: 2 } } }), { primitives: P });
  build(rt);
  drive(rt, 900);
  assert.equal(rt.state.vars['auto.delivered.gear'], 2, 'chest full');
  const onBelts = rt.state.vars['auto.items'];
  drive(rt, 120);
  assert.equal(rt.state.vars['auto.items'], onBelts, 'nothing more fits: the line is backed up');
  assert.ok(rt.service('automation').machine([6, 1, 0]).inv.iron >= 2, 'press input buffer filled');
  rt.space('world').setCell([3, 1, 0], null, rt); rt.step();
  assert.ok(rt.state.counts.item_lost >= 1, 'items on a removed belt are lost');
  assert.equal(rt.service('automation').insert([3, 1, 0], 'iron'), false);
  rt.space('world').setCell([3, 1, 0], 'belt_e', rt);
  assert.equal(rt.service('automation').insert([3, 1, 0], 'iron'), true, 'rebuilt belt is live again');
});

test('automation: insert_item effect, deterministic replay, restore rebuilds the layout', () => {
  const { rt } = compile(factoryDoc(), { primitives: P }); build(rt);
  rt.run([{ do: 'insert_item', at: [7, 1, 0], item: 'gear', count: 1 }]);
  drive(rt, 30);
  assert.equal(rt.state.vars['auto.delivered.gear'] >= 1, true);
  const snap = rt.snapshot(); drive(rt, 120); const a = rt.snapshot();
  rt.restore(snap); drive(rt, 120); assert.deepEqual(rt.snapshot(), a);
});

test('automation: preflight rejects bad configs with stable codes', () => {
  const registry = new Registry(P), logic = buildLogic(registry, Logic);
  assert.ok(preflight(factoryDoc(), registry, logic).ok);
  const bad = factoryDoc({ belts: { belt_e: { speed: 2 }, belt_x: { dir: 'sideways' } }, machines: { press: { recipes: ['widget'] } }, sources: { drill: { item: 'iron' } }, sinks: { belt_e: {} }, inserters: { arm: { from: 'w' } } });
  const codes = new Set(preflight(bad, registry, logic).errors.map(e => e.code));
  for (const c of ['automation_dir', 'automation_recipe', 'automation_source', 'automation_role']) assert.ok(codes.has(c), c);
  const empty = doc({ systems: [{ use: 'gameplay.automation' }] });
  assert.ok(preflight(empty, registry, logic).errors.some(e => e.code === 'automation_empty'));
});
