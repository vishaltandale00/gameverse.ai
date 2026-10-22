// worlds3d spaces under other workstreams' primitives: engine.physics.character
// (gravity, collide-and-slide, step-up) and gameplay.blocks.mine (editCells + raycast).
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, run, bodyBox } from '../v2/kernel/testing.js';
import { PRIMITIVES } from '../v2/primitives/index.js';

const voxelDoc = () => ({
  schema: 'gameverse.v2.game/0.2', id: 'dig', title: 'Dig', seed: 2,
  spaces: [{ id: 'w', use: 'engine.space.voxel', with: { chunk: [16, 32, 16], height: 64, ground: 8, groundBlock: 'stone' }, zones: [{ id: 'pit', bounds: { min: [0, 0, 0], max: [16, 64, 16] } }] }],
  systems: [{ use: 'engine.physics.character', with: { stepHeight: 1.05 } }, { use: 'gameplay.inventory' }, { use: 'gameplay.blocks.mine', with: { reach: 6, hardnessScale: 0.1 } }],
  content: {
    blocks: [{ id: 'stone', solid: true, hardness: 1.5, drops: [{ item: 'cobble', count: [1, 1] }] }],
    items: [{ id: 'cobble', name: 'Cobble', kind: 'block', block: 'stone' }],
    archetypes: [{ id: 'miner', components: {} }],
  },
  player: { archetype: 'miner', at: [4.5, 14, 4.5] },
});

test('voxel + engine.physics.character: fall, land and walk with step-up through rt.step', () => {
  const { rt } = compile(voxelDoc(), { primitives: PRIMITIVES });
  const api = rt.space('w'), p = rt.player();
  run(rt, 120);
  assert.ok(Math.abs(bodyBox(p, api).min[1] - 8) < 0.05, `stands on the ground: ${p.at}`);
  assert.equal(p.components.body.grounded, true);
  assert.ok(rt.state.counts.landed >= 1);
  api.fill([[7, 8, 0], [12, 8, 9]], 'stone', rt); // a one-cell ledge east of the player
  for (let i = 0; i < 90; i++) { p.components.body.vel[0] = 3; rt.step(); }
  assert.ok(p.at[0] > 7.5, `walked onto the ledge: ${p.at}`);
  assert.ok(bodyBox(p, api).min[1] > 8.5, 'stepped up');
});

test('voxel + gameplay.blocks.mine: holding mine breaks the cell and drops into the bag', () => {
  const { rt } = compile(voxelDoc(), { primitives: PRIMITIVES });
  const api = rt.space('w');
  run(rt, 90);
  const below = [4, 7, 4];
  assert.equal(api.getCell(below), 'stone');
  run(rt, 30, { actions: { mine: below } });
  assert.equal(api.getCell(below), null, 'cell mined');
  assert.equal(rt.state.counts['block_mined:stone'], 1);
  assert.equal(rt.state.prim['gameplay.inventory'].player.cobble, 1);
  assert.ok(api.editLog().some(e => e.by === 'player' && e.from === 'stone'));
  // The player then falls into the hole.
  run(rt, 60);
  assert.ok(bodyBox(rt.player(), api).min[1] < 7.6, `dropped into the hole: ${rt.player().at}`);
});

test('mesh3d + engine.physics.character: lands on terrain and on a collider roof', () => {
  const doc = {
    schema: 'gameverse.v2.game/0.2', id: 'hill', title: 'Hill', seed: 8,
    spaces: [{ id: 'm', use: 'engine.space.mesh3d', with: { size: [256, 256], heightRes: 2 }, zones: [{ id: 'mid', center: [128, 128], r: 40 }],
      generators: [{ use: 'engine.generate.terrain.noise', with: { octaves: 3, scale: 128, amplitude: 6, landBias: 1 } }] }],
    systems: [{ use: 'engine.physics.character' }],
    content: { archetypes: [{ id: 'hero', components: {} }] },
    player: { archetype: 'hero', at: [128, 60, 128] },
  };
  const { rt } = compile(doc, { primitives: PRIMITIVES });
  const api = rt.space('m'), p = rt.player();
  run(rt, 240);
  const g = api.groundAt(p.at[0], p.at[2]).y;
  assert.ok(Math.abs(bodyBox(p, api).min[1] - g) < 0.1, `on the terrain: feet ${bodyBox(p, api).min[1]} ground ${g}`);
  assert.equal(p.components.body.grounded, true);
  api.addObject({ id: 'roof', shape: 'box', at: [140, g - 1, 128], size: [6, 8, 6], rot: 0 }, rt);
  rt.run([{ do: 'teleport', at: [140, g + 20, 128] }]);
  run(rt, 180);
  assert.ok(Math.abs(bodyBox(p, api).min[1] - (g + 7)) < 0.1, `stands on the roof: ${p.at}`);
});
