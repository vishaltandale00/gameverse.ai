import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, testSpace, run } from '../v2/kernel/testing.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import { preflight } from '../v2/kernel/document.js';
import { PRIMITIVES } from '../v2/primitives/index.js';
import { generateDungeon } from '../v2/primitives/engine/generate-dungeon-rooms.js';
import { withDefaults, placeOn, spaceOf } from '../v2/primitives/engine/generate2d-lib.js';
import dungeon from '../v2/primitives/engine/generate-dungeon-rooms.js';

const ALL = [...PRIMITIVES, testSpace];
const KEY = 'spaces.d.generators[0]';
const doc = ({ space = 'engine.space.test', size = [80, 80, 1], w = {}, seed = 6, systems = [] } = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'dungeon', title: 'Dungeon', seed,
  spaces: [{ id: 'd', use: space, with: { size }, zones: [], generators: [{ use: 'engine.generate.dungeon.rooms', with: { rooms: 14, keys: ['bronze_key', 'iron_key'], branching: 0.4, boss: 'warden', loot: 'chest_common', ...w } }] }],
  systems,
  content: { items: [{ id: 'bronze_key', name: 'Bronze key' }, { id: 'iron_key', name: 'Iron key' }], archetypes: [{ id: 'hero', components: {} }, { id: 'warden', components: {} }, { id: 'key', components: {} }, { id: 'locked_door', components: {} }, { id: 'chest', components: {} }], blocks: [{ id: 'stone', solid: true }, { id: 'locked_door', solid: true }] },
  player: { archetype: 'hero' },
});

test('dungeon.rooms: keys always come before their locks, across seeds and shapes', () => {
  const cfg = s => withDefaults(dungeon.card, { rooms: 20, keys: ['a', 'b', 'c'], branching: s });
  for (const branching of [0, 0.3, 0.9]) for (let seed = 1; seed <= 6; seed++) {
    const d = generateDungeon(cfg(branching), [0, 0, 96, 96], seed);
    assert.deepEqual(d.problems, [], `branching ${branching} seed ${seed}`);
    assert.equal(d.locks.length, 3);
    // A key's room region is never past its own lock.
    for (const k of d.keys) assert.ok(d.rooms[k.room].region <= k.lock);
    assert.equal(d.rooms[d.boss].region, 3, 'the boss sits behind every lock');
  }
});

test('dungeon.rooms: walking to the keys opens the locks (flags without an inventory)', () => {
  const { rt } = compile(doc(), { primitives: ALL });
  run(rt, 1);
  const st = rt.store(KEY), svc = rt.service('dungeon'), space = spaceOf(rt, { space: 'd' });
  assert.deepEqual(st.problems, []);
  assert.equal(rt.query('boss').length, 1);
  assert.equal(rt.query('chest').length, st.rooms.filter(r => r.kind === 'dead_end').length, 'loot in every dead end');
  assert.ok(rt.query('chest').every(e => e.components.loot.table === 'chest_common'));
  const lock = st.locks[0];
  assert.equal(rt.space('d').getCell(lock.cells[0]), 'locked_door');
  placeOn(rt, space, rt.player(), lock.at); run(rt, 1);
  assert.equal(svc.isOpen(lock.id), false, 'no key, no entry');
  placeOn(rt, space, rt.player(), st.keys[0].at); run(rt, 1);
  assert.equal(rt.state.counts['key_found:bronze_key'], 1);
  assert.equal(rt.state.flags['has:bronze_key'], true);
  placeOn(rt, space, rt.player(), lock.at); run(rt, 1);
  assert.equal(rt.state.counts['unlocked:lock_1'], 1);
  assert.equal(rt.space('d').getCell(lock.cells[0]), null, 'the door cells are cleared');
  assert.equal(rt.entity(lock.id), undefined);
  // The open_lock effect opens the other one from story data.
  rt.run([{ do: 'open_lock', lock: 'lock_2' }]);
  assert.ok(svc.isOpen('lock_2'));
});

test('dungeon.rooms: on the grid space the doors really block until opened, and the inventory holds the keys', () => {
  const { rt } = compile(doc({ space: 'engine.space.grid', size: [80, 80], systems: [{ use: 'gameplay.inventory' }] }), { primitives: ALL });
  run(rt, 1);
  const st = rt.store(KEY), api = rt.space('d'), space = spaceOf(rt, { space: 'd' });
  assert.deepEqual(st.problems, []);
  const bossCell = st.rooms[st.boss].rect.slice(0, 2).map(v => v + 1);
  const keyOf = c => `${c[0]},${c[1]}`;
  assert.ok(!api.reachable(rt.player().at, rt, {}).has(keyOf(bossCell)), 'the boss is sealed at the start');
  assert.ok(api.reachable(rt.player().at, rt, {}).has(keyOf(st.keys[0].at)), 'the first key is reachable at the start');
  for (const k of st.keys) { placeOn(rt, space, rt.player(), k.at); run(rt, 1); placeOn(rt, space, rt.player(), st.locks[k.lock].at); run(rt, 1); }
  assert.ok(rt.test({ item: 'iron_key' }));
  assert.ok(api.reachable(rt.player().at, rt, {}).has(keyOf(bossCell)), 'both locks open: the boss room is reachable');
});

test('dungeon.rooms: without editCells it lays markers in a continuous space', () => {
  const { rt } = compile(doc({ space: 'engine.space.arena2d', size: [120, 120], w: { plane: 'xy' } }), { primitives: ALL });
  const st = rt.store(KEY);
  assert.equal(st.carved, false);
  assert.deepEqual(st.problems, []);
  assert.equal(rt.query('lock').length, 2);
  assert.equal(rt.space('d').anchor, 'center');
  assert.equal(rt.query('lock')[0].at[0] % 1, 0.5, 'markers sit at cell centres in centre-anchored spaces');
});

test('dungeon.rooms: same seed replays exactly; another seed differs', () => {
  const a = compile(doc(), { primitives: ALL }).rt, b = compile(doc(), { primitives: ALL }).rt, c = compile(doc({ seed: 8 }), { primitives: ALL }).rt;
  run(a, 10); run(b, 10); run(c, 10);
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.notDeepEqual(a.store(KEY).rooms, c.store(KEY).rooms);
});

test('dungeon.rooms: preflight rejects bad configs with stable codes', () => {
  const r = new Registry(ALL), logic = buildLogic(r, Logic), codes = d => preflight(d, r, logic).errors.map(e => e.code);
  const a = doc({ size: [20, 20, 1] }); assert.ok(codes(a).includes('dungeon_area_small'));
  const b = doc({ w: { rooms: 3, keys: ['bronze_key', 'iron_key'] } }); assert.ok(codes(b).includes('dungeon_keys_many'));
  const c = doc({ w: { keys: ['silver_key'] } }); assert.ok(codes(c).includes('ref_unknown'));
  const d = doc({ w: { rooms: 200 } }); assert.ok(codes(d).includes('param_range'));
});
