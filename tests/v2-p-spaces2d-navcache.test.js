// Navigation caching: graphs are built once per map version and reused; reads never change state.
// Bounds are on graph builds and expanded nodes, never wall time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../v2/kernel/testing.js';
import spaces2d from '../v2/primitives/engine/spaces2d.index.js';

const W = 200, H = 60;
const bake = { id: 'engine.generate.navfloors', card: { intent: 'floors with gaps', params: {} },
  install(rt, cfg, inst) { rt.space(inst.space).bake(([x, y]) => (y === 0 || (y % 6 === 0 && x % 23 > 6) ? 'stone' : undefined), rt); } };
const tdoc = () => ({ schema: 'gameverse.v2.game/0.2', id: 'nav', title: 'Nav', seed: 1,
  spaces: [{ id: 'm', use: 'engine.space.tilemap', with: { size: [W, H] }, generators: [{ use: 'engine.generate.navfloors' }], zones: [{ id: 'far', rect: [150, 1, 160, 3] }, { id: 'up', rect: [40, 7, 60, 10] }] }],
  content: { blocks: [{ id: 'stone', solid: true }], archetypes: [{ id: 'h', components: { body: { size: [0.8, 0.9] } } }] }, player: { archetype: 'h', at: [10.5, 1.45] } });

test('tilemap: 100 path/reachable/canReach calls without edits build the graph once', () => {
  const { rt } = compile(tdoc(), { primitives: [...spaces2d, bake] }), api = rt.space('m');
  const p = rt.player();
  const first = api.path(p.at, 'far', { abilities: { jumpHeight: 7 } });
  assert.ok(first && first.length > 10, 'reachable along the floor');
  const s1 = api.navStats();
  for (let i = 0; i < 100; i++) { api.path(p.at, 'far', { abilities: { jumpHeight: 7 } }); api.reachable(p.at, rt, { abilities: { jumpHeight: 7 } }); api.canReach(p.at, 'up', rt, { abilities: { jumpHeight: 7 } }); }
  const s2 = api.navStats();
  assert.equal(s2.builds, 1, 'one graph for one envelope and map version');
  assert.equal(s2.nodes, Math.max(s1.nodes, s2.nodes), 'no node is expanded twice');
  assert.ok(s2.hits >= 300);
  api.path(p.at, 'far', { abilities: { jumpHeight: 2 } });
  assert.equal(api.navStats().builds, 2, 'a different envelope is its own graph');
  api.setCell([30, 1], 'stone', rt);
  api.path(p.at, 'far', { abilities: { jumpHeight: 7 } });
  assert.equal(api.navStats().builds, 3, 'an edit invalidates the cache');
  const snap = rt.snapshot(); rt.space('m').setCell([31, 1], 'stone', rt); rt.restore(snap);
  api.path(p.at, 'far', { abilities: { jumpHeight: 7 } });
  assert.equal(api.navStats().builds, 3, 'restoring to an already-seen map version reuses its graph');
  // A static obstacle entity changes the graph; a dynamic (mechanism) one does not.
  rt.spawn('h', { id: 'gate', at: [40.5, 2], components: { mechanism: 'g', body: { size: [1, 2], solid: true } } });
  api.path(p.at, 'far', { abilities: { jumpHeight: 7 } });
  assert.equal(api.navStats().builds, 3);
  rt.spawn('h', { id: 'rock', at: [41.5, 2], components: { body: { size: [1, 2], solid: true } } });
  api.path(p.at, 'far', { abilities: { jumpHeight: 7 } });
  assert.equal(api.navStats().builds, 4);
});

test('grid: repeated reachable/path calls reuse one adjacency graph', () => {
  const doc = { schema: 'gameverse.v2.game/0.2', id: 'g', title: 'G', spaces: [{ id: 'b', use: 'engine.space.grid', with: { size: [40, 40] } }], content: { archetypes: [{ id: 'u', components: {} }] }, player: { archetype: 'u', at: [0, 0] } };
  const { rt } = compile(doc, { primitives: spaces2d }), api = rt.space('b');
  for (let i = 0; i < 100; i++) { api.path([0, 0], [39, 39]); api.reachable([0, 0], rt); api.cellsInRange([5, 5], 4, 'steps', { passable: true }); }
  const s = api.navStats();
  assert.equal(s.builds, 1); assert.ok(s.nodes <= 1600);
  api.setCell([3, 3], 'wall', rt); api.reachable([0, 0], rt);
  assert.equal(api.navStats().builds, 2);
});

test('reads never change state: options, cells, bounds and navigation leave the snapshot untouched', () => {
  const { rt } = compile(tdoc(), { primitives: [...spaces2d, bake] }), api = rt.space('m');
  const before = JSON.stringify(rt.snapshot());
  rt.availableOptions(); api.getCell([3, 0]); api.cellsIn([[0, 0], [5, 5]]); api.bounds(); api.tagsAt([1, 1]); api.raycast([5, 5], [0, -1], 10);
  api.reachable(rt.player().at, rt); api.path(rt.player().at, 'far'); api.groundAt(5); api.editLog();
  assert.equal(JSON.stringify(rt.snapshot()), before);
});
