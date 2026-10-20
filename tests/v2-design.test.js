import test from 'node:test';
import assert from 'node:assert/strict';
import { designToSpec } from '../v2/planner/design.js';
import { buildVerified } from '../v2/planner/design-pipeline.js';
import { tilesetTemplate } from '../v2/planner/png.js';
import { defaultRegistry } from '../v2/modules/index.js';
import { preflight } from '../v2/engine/spec.js';
import { compose } from '../v2/engine/compose.js';
import { playtest } from '../v2/engine/playtest.js';
import { createHash } from 'node:crypto';

const registry = defaultRegistry();
const base = {
  title: 'Test Run', pitch: 'A test', artStyle: 'pixel art', length: 'medium', background: '#203040', palette: { ground: '#506070', platform: '#708090' },
  cast: { player: { name: 'Hero', glyph: '🦊' }, pickup: { name: 'Acorn', glyph: '🌰' }, enemy: { name: 'Goblin', glyph: '👺' }, hazard: { name: 'Thorns', glyph: '🌵' }, goal: { name: 'Gate', glyph: '🚪' } },
  feel: { runSpeed: 10, jumpSpeed: 18, gravity: 52, airJumps: 0, friction: 60, airControl: 0.8 },
  mechanics: { shoot: false, stomp: true, health: 3, timerSeconds: 0, enemySpeed: 2.5, collectAllToWin: false },
};
const side = { ...base, view: 'side', sections: [{ type: 'runway', difficulty: 1 }, { type: 'pits', difficulty: 2 }, { type: 'platforms', difficulty: 2 }, { type: 'gauntlet', difficulty: 2 }, { type: 'hazards', difficulty: 3 }] };
const top = { ...base, view: 'topdown', sections: [{ type: 'garden', difficulty: 1 }, { type: 'maze', difficulty: 2 }, { type: 'arena', difficulty: 2 }] };
const hash = spec => createHash('sha256').update(JSON.stringify(spec)).digest('hex');

test('the same design and seed always produce the identical game', () => {
  assert.equal(hash(designToSpec(side, { seed: 42 })), hash(designToSpec(side, { seed: 42 })));
  assert.notEqual(hash(designToSpec(side, { seed: 42 })), hash(designToSpec(side, { seed: 43 })));
});

test('generated games pass preflight and are proven winnable across views, seeds and win rules', () => {
  const failures = [];
  for (const design of [side, top]) for (const collectAllToWin of [false, true]) for (const seed of [1, 2, 3]) {
    // The pipeline's verified build: layout retries, then relaxing collect-all if it can't be proven.
    const built = buildVerified({ ...design, mechanics: { ...design.mechanics, collectAllToWin } }, { seed, registry });
    assert.ok(preflight(built.spec, registry).ok);
    if (!built.check.ok) failures.push(`${design.view} collectAll=${collectAllToWin} seed=${seed}`);
  }
  assert.deepEqual(failures, []);
});

test('placeholder tiles keep contrast with a matching background', () => {
  const spec = designToSpec({ ...side, background: '#cfe8f5', palette: { ground: '#d5ecf7', platform: '#cde4ef' } }, { seed: 1 });
  assert.notEqual(spec.entities.ground.color, '#d5ecf7');
});

test('the tileset template is a valid 1024x1024 PNG', () => {
  const png = tilesetTemplate();
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 1024); assert.equal(png.readUInt32BE(20), 1024);
});
