// Runtime primitives over the real 2D spaces (tilemap side view, grid) and with plot.gate locks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, run } from '../v2/kernel/testing.js';
import runtime from '../v2/primitives/engine/runtime.index.js';
import spaces2d from '../v2/primitives/engine/spaces2d.index.js';
import story from '../v2/primitives/plot/story.index.js';
import storyboard from '../v2/primitives/plot/storyboard.js';
import inventory from '../v2/primitives/gameplay/inventory.js';

// Bakes a level through the space's bake() (generator-shaped helper for these tests only).
const baker = cells => ({ id: 'engine.generate.rtlevel', card: { intent: 'test level baker for runtime tests' }, install(rt, cfg, inst) { rt.space(inst.space).bake(cells, rt); } });
const floorCells = (w, extra = []) => [...Array.from({ length: w }, (_, x) => ({ at: [x, 0], block: 'stone' })), ...extra.map(at => ({ at, block: 'stone' }))];
const PRIMS = (cells = floorCells(40)) => [...spaces2d, ...runtime, ...story, storyboard, inventory, baker(cells)];
const side = (systems, { cells, zones = [], archetypes = [], plot, player = { archetype: 'hero', at: [2, 3] } } = {}) => ({
  doc: {
    schema: 'gameverse.v2.game/0.2', id: 'rt-real', title: 'Runtime on real spaces', seed: 6,
    spaces: [{ id: 'map', use: 'engine.space.tilemap', with: { size: [40, 16], gravity: -40 }, zones, generators: [{ use: 'engine.generate.rtlevel' }] }],
    content: { blocks: [{ id: 'stone', solid: true }], archetypes: [{ id: 'hero', components: { body: { size: [0.8, 1.6] } } }, ...archetypes] },
    player, systems, ...(plot ? { plot } : {}),
  },
  prims: PRIMS(cells),
});

test('physics.character on a side-view tilemap: lands, steps up a tile, stops at a wall', () => {
  const { doc, prims } = side([{ use: 'engine.physics.character', with: { stepHeight: 1.05 } }], { cells: floorCells(40, [[8, 1], [14, 1], [14, 2], [14, 3]]) });
  const { rt } = compile(doc, { primitives: prims });
  run(rt, 60);
  const p = rt.player();
  assert.equal(p.components.body.grounded, true);
  assert.ok(Math.abs(p.at[1] - 1.8) < 0.02, `standing on the floor (centre y ${p.at[1]})`);
  assert.equal(rt.state.counts.landed >= 1, true);
  for (let i = 0; i < 200; i++) { p.components.body.vel[0] = 4; rt.step(); }
  assert.ok(p.at[0] > 12.5 && p.at[0] < 13.7, `stepped over x=8 and stopped at the wall, x=${p.at[0]}`);
});

test('physics.rigid on a space with dynamics hands bodies to the space solver', () => {
  const { doc, prims } = side([{ use: 'engine.physics.rigid' }], { archetypes: [{ id: 'crate', components: { body: { size: [1, 1] }, rigid: { mass: 3, restitution: 0 } } }] });
  const { rt } = compile(doc, { primitives: prims });
  const crate = rt.spawn('crate', { at: [10, 8] });
  run(rt, 90);
  assert.equal(crate.components.body.ballistic, true);
  assert.ok(Math.abs(crate.at[1] - 1.5) < 0.05, `landed via the tilemap, y=${crate.at[1]}`);
  rt.run([{ do: 'impulse', who: crate.id, v: [6, 0] }]);
  assert.ok(Math.abs(crate.components.body.vel[0] - 2) < 1e-9, 'impulse / mass through the space');
});

test('plot.gate locks: zones bounce entities out, portals refuse with the gate hint', () => {
  const zones = [{ id: 'town', rect: [0, 0, 10, 16] }, { id: 'vault', rect: [20, 0, 30, 16] }];
  const plot = { gates: [{ id: 'vault_gate', requires: { flag: 'has_pass' }, hint: 'Show your pass.', locks: ['zone:vault', 'portal:lift'] }], storyboard: { acts: [{ id: 'a', beats: [{ id: 'b', when: { flag: 'never' } }] }] } };
  const systems = [{ use: 'plot.gate' }, { use: 'plot.storyboard' }, { use: 'engine.zones' }, { use: 'engine.portal', with: { portals: [{ id: 'lift', from: { at: [3, 1.8], r: 1 }, to: { at: [25, 1.8] } }] } }];
  const { doc, prims } = side(systems, { zones, plot });
  const { rt } = compile(doc, { primitives: prims });
  run(rt, 30);
  const p = rt.player(), api = rt.space('map');
  api.setPos(p, [3, 1.8], rt); rt.step({ actions: { use_portal: 'lift' } });
  assert.deepEqual(p.at, [3, 1.8]);
  assert.equal(rt.state.counts['gate_blocked:vault_gate'], 1);
  api.setPos(p, [15, 1.8], rt); run(rt, 2);
  api.setPos(p, [22, 1.8], rt); run(rt, 2);
  assert.deepEqual(p.at, [15, 1.8], 'bounced back out of the locked zone');
  assert.ok(rt.state.counts.blocked >= 2);
  assert.ok(!rt.test({ discovered: 'vault' }));
  rt.state.flags.has_pass = true; run(rt, 1);
  api.setPos(p, [22, 1.8], rt); run(rt, 2);
  assert.deepEqual(p.at, [22, 1.8]);
  assert.ok(rt.test({ discovered: 'vault' }));
});

test('engine.spawner on a grid places entities on whole cells inside zones', () => {
  const doc = {
    schema: 'gameverse.v2.game/0.2', id: 'rt-grid', title: 'Runtime on grid', seed: 8,
    spaces: [{ id: 'board', use: 'engine.space.grid', with: { size: [12, 12] }, zones: [{ id: 'nest', rect: [6, 6, 12, 12] }] }],
    content: { archetypes: [{ id: 'hero', components: {} }, { id: 'ant', components: {} }] },
    player: { archetype: 'hero', at: [7, 7] }, systems: [{ use: 'engine.spawner', with: { intervalSec: 0, rules: [{ id: 'ants', archetype: 'ant', zone: 'nest', count: [5, 5] }] } }],
  };
  const { rt } = compile(doc, { primitives: [...spaces2d, ...runtime] });
  run(rt, 2);
  const ants = Object.values(rt.state.entities).filter(e => e.archetype === 'ant');
  assert.equal(ants.length, 5);
  for (const a of ants) { assert.ok(a.at.every(Number.isInteger), `cell ${a.at}`); assert.ok(rt.test({ zone: 'nest', who: a.id })); }
});
