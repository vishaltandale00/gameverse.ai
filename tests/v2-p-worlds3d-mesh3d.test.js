import test from 'node:test';
import assert from 'node:assert/strict';
import { spaceConformance, compile, run } from '../v2/kernel/testing.js';
import { PRIMITIVES } from '../v2/primitives/index.js';

const flat = (extra = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'mesh', title: 'Mesh', seed: 11,
  spaces: [{ id: 'land', use: 'engine.space.mesh3d', with: { size: [256, 256], heightRes: 2 }, zones: [{ id: 'meadow', center: [64, 64], r: 20 }, { id: 'hall', bounds: { min: [150, 0, 150], max: [200, 30, 200] } }], ...extra }],
  content: { archetypes: [{ id: 'hero', components: {} }] },
  player: { archetype: 'hero', at: [100, 100] },
});

spaceConformance(test, assert, { name: 'engine.space.mesh3d', primitives: PRIMITIVES, doc: () => flat(), free: [100, 0, 100], other: [120, 0, 110] });
