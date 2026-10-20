import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spaceConformance, compile } from '../v2/kernel/testing.js';
import { checkFields } from '../v2/kernel/params.js';
import { preflight } from '../v2/kernel/document.js';
import { catalogue } from '../v2/primitives/index.js';
import spaces2d from '../v2/primitives/engine/spaces2d.index.js';

const none = spaces2d.find(p => p.id === 'engine.space.none');
const doc = () => ({
  schema: 'gameverse.v2.game/0.2', id: 'cards', title: 'Cards', seed: 1,
  spaces: [{ id: 'table', use: 'engine.space.none', zones: [{ id: 'hand' }, { id: 'deck' }, { id: 'discard' }] }],
  content: { archetypes: [{ id: 'dealer', components: {} }, { id: 'card', components: {} }] },
  player: { archetype: 'dealer', at: 'hand' },
});

spaceConformance(test, assert, { name: 'engine.space.none', primitives: spaces2d, doc, free: 'hand', other: 'deck' });

test('none: reports no capabilities, so spatial primitives cannot bind to it', () => {
  const needs = { id: 'gameplay.test.walker', card: { intent: 'needs position', requires: { capabilities: ['position'] } } };
  const { registry, logic } = catalogue([needs]);
  const d = doc(); d.systems = [{ use: 'gameplay.test.walker' }];
  const r = preflight(d, registry, logic);
  assert.deepEqual(r.capabilities.table, []);
  assert.ok(r.errors.some(e => e.code === 'capability_missing'));
});

test('none: slots answer the kernel zone/near/teleport vocabulary with typed events', () => {
  const { rt } = compile(doc(), { primitives: spaces2d }), api = rt.space('table');
  assert.equal(rt.player().at, 'hand');
  for (let i = 0; i < 3; i++) rt.spawn('card', { id: `c${i}`, space: 'table', at: 'deck' });
  assert.deepEqual(api.entitiesAt('deck'), ['c0', 'c1', 'c2'], 'insertion order within a slot');
  rt.run([{ do: 'teleport', who: 'c1', zone: 'hand' }]);
  assert.ok(rt.test({ zone: 'hand', who: 'c1' }));
  assert.ok(rt.state.events.some(e => e.name === 'leave_zone:deck') && rt.state.events.some(e => e.name === 'enter_zone:hand'));
  assert.ok(rt.test({ near: 'card', within: 0 }), 'a card shares the player slot');
  assert.equal(api.setPos(rt.entity('c2'), 'nowhere', rt), false, 'unknown slot');
  assert.equal(rt.entity('c2').at, 'deck');
  api.addZone({ id: 'stack' }, rt);
  assert.equal(api.setPos(rt.entity('c2'), 'stack', rt), true);
  rt.despawn('c2');
  assert.ok(rt.state.events.some(e => e.name === 'leave_zone:stack'));
  const snap = rt.snapshot(); rt.restore(snap); assert.deepEqual(rt.snapshot(), snap);
});

test('none: deterministic replay', () => {
  const go = () => { const { rt } = compile(doc(), { primitives: spaces2d }); for (let i = 0; i < 4; i++) rt.spawn('card', { space: 'table', at: i % 2 ? 'deck' : 'discard' }); for (let i = 0; i < 10; i++) rt.step(); return rt.snapshot(); };
  assert.deepEqual(go(), go());
});

test('none: preflight rejects spatial zone shapes with a stable code', () => {
  const { registry, logic } = catalogue();
  const d = doc(); d.spaces[0].zones.push({ id: 'pit', rect: [0, 0, 1, 1] });
  assert.ok(preflight(d, registry, logic).errors.some(e => e.code === 'zone_shape_unsupported'));
  const d2 = doc(); d2.spaces[0].with = { size: 3 };
  assert.ok(preflight(d2, registry, logic).errors.some(e => e.code === 'param_unknown'));
});

test('none: every instance in v2/games preflights its params with zero errors', () => {
  for (const f of readdirSync('v2/games').filter(f => f.endsWith('.json'))) {
    const g = JSON.parse(readFileSync(`v2/games/${f}`, 'utf8'));
    for (const s of g.spaces || []) if (s.use === none.id) { const errors = []; errors.push(...none.validate(checkFields(none.card.params, s.with || {}, 'with', errors, null), g, {})); assert.deepEqual(errors, [], `${f} ${s.id}`); }
  }
});
