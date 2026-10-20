import test from 'node:test';
import assert from 'node:assert/strict';
import { spaceConformance, compile, run } from '../v2/kernel/testing.js';
import { PRIMITIVES } from '../v2/primitives/index.js';

const flat = (extra = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'vox', title: 'Voxel', seed: 7,
  spaces: [{ id: 'world', use: 'engine.space.voxel', with: { chunk: [16, 32, 16], height: 64, ground: 4 }, zones: [{ id: 'yard', bounds: { min: [0, 0, 0], max: [8, 64, 8] } }], ...extra }],
  content: { blocks: [{ id: 'stone', solid: true }, { id: 'water', solid: false }], archetypes: [{ id: 'hero', components: {} }] },
  player: { archetype: 'hero', at: [20.5, 4, 20.5] },
});

spaceConformance(test, assert, { name: 'engine.space.voxel', primitives: PRIMITIVES, doc: () => flat(), free: [20.5, 4, 20.5], other: [24.5, 4, 22.5], solid: [20.5, 2, 20.5], block: 'stone' });
