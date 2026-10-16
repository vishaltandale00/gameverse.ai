import test from 'node:test';
import assert from 'node:assert/strict';
import { certifiedSeparator, certifiedWorld } from '../src/neighborhood-certified.generated.js';
import { encodeGrid, certifyPlayerMove, certifyCameraPose, SAFETY_GRID } from '../src/neighborhood-safety.js';
const bounds = { minX: -20, maxX: 20, minZ: -20, maxZ: 20 };
const wall = { minX: 2, maxX: 2.01, minZ: -5, maxZ: 5, minY: 0, maxY: 6 };

test('IEEE bridge rounds exact dyadics outward, including negative and subnormal values', () => {
  assert.equal(encodeGrid(0.1, 'floor'), 6553n); assert.equal(encodeGrid(0.1, 'ceil'), 6554n);
  assert.equal(encodeGrid(-0.1, 'floor'), -6554n); assert.equal(encodeGrid(-0.1, 'ceil'), -6553n);
  assert.equal(encodeGrid(Number.MIN_VALUE, 'floor'), 0n); assert.equal(encodeGrid(Number.MIN_VALUE, 'ceil'), 1n);
  assert.equal(encodeGrid(-Number.MIN_VALUE, 'floor'), -1n); assert.equal(encodeGrid(-Number.MIN_VALUE, 'ceil'), 0n);
  assert.equal(encodeGrid(0.5 / SAFETY_GRID), 1n); assert.equal(encodeGrid(-0.5 / SAFETY_GRID), 0n);
  for (const n of [NaN, Infinity, -Infinity, 32769]) assert.throws(() => encodeGrid(n));
  for (const n of [-32768, -21.42, 0, 0.32, 32768]) {
    const q = encodeGrid(n), decoded = Number(q) / SAFETY_GRID;
    assert.equal(encodeGrid(decoded), q, 'bounded grid conversion must round-trip exactly');
  }
});

test('generated kernel accepts rounded grazing and rejects zero normals or a crossing segment', () => {
  const rounded = [-7, 0, -3, -3, 0, -3, 0, 0, 0, 4, 0, 4, 4, -1, 0, -1].map(BigInt);
  assert.equal(certifiedSeparator(rounded), true);
  assert.equal(certifiedSeparator([...rounded.slice(0, 13), 0n, 0n, 0n]), false);
  const crossing = [...rounded]; crossing[3] = 5n; crossing[5] = 5n;
  assert.equal(certifiedSeparator(crossing), false);
  assert.equal(certifiedWorld([rounded, crossing]), false, 'a final failed proxy cannot be ignored');
});

test('malicious movement proposal cannot tunnel through a thin wall or escape bounds', () => {
  const p = certifyPlayerMove({ x: 0, z: 0 }, { x: 9, z: 0 }, [wall], 0.32, bounds);
  assert.ok(p.x <= wall.minX - 0.32 && p.x >= 0);
  const edge = certifyPlayerMove({ x: 0, z: 0 }, { x: 999, z: 999 }, [], 0.32, bounds);
  assert.ok(edge.x <= bounds.maxX - 0.32 && edge.z <= bounds.maxZ - 0.32);
  const aerial = certifyPlayerMove({ x: 0, y: 100, z: 0 }, { x: 9, y: 100, z: 0 }, [wall], 0.32, bounds);
  assert.ok(aerial.x <= wall.minX - 0.32, 'player API must enforce the XZ footprint');
});

test('mutable and malformed proxies cannot bypass the encoded-world guard', () => {
  const boxes = [{ ...wall, minX: 10, maxX: 11 }];
  assert.equal(certifyPlayerMove({ x: 0, z: 0 }, { x: 4, z: 0 }, boxes, 0.32, bounds).x, 4);
  boxes[0].minX = 2; boxes[0].maxX = 2.01;
  assert.ok(certifyPlayerMove({ x: 0, z: 0 }, { x: 4, z: 0 }, boxes, 0.32, bounds).x < 2);
  assert.throws(() => certifyPlayerMove({ x: 0, z: 0 }, { x: 1, z: 0 }, [{ ...wall, minX: 2.0000001, maxX: 2 }], 0.32, bounds));
  assert.throws(() => certifyPlayerMove({ x: 0, z: 0 }, { x: NaN, z: 0 }, [], 0.32, bounds));
  let near = false;
  const accessor = Object.freeze({ ...wall, get minX() { return near ? 2 : 10; }, get maxX() { return near ? 2.01 : 11; } });
  const frozenAccessors = Object.freeze([accessor]);
  assert.equal(certifyPlayerMove({ x: 0, z: 0 }, { x: 4, z: 0 }, frozenAccessors, 0.32, bounds).x, 4);
  near = true;
  assert.ok(certifyPlayerMove({ x: 0, z: 0 }, { x: 4, z: 0 }, frozenAccessors, 0.32, bounds).x < 2, 'frozen getters are not immutable geometry');
});

test('unsafe camera proposals are shortened before final XYZ is committed, and impossible targets fail closed', () => {
  const target = { x: 0, y: 1.55, z: 0 }, proposed = { x: 8, y: 1.8, z: 0 };
  const result = certifyCameraPose(target, proposed, [wall], 0.25);
  assert.ok(result.position.x <= wall.minX - 0.25);
  for (const p of [result.position, result.target]) for (const value of Object.values(p)) assert.equal(value * SAFETY_GRID, Math.trunc(value * SAFETY_GRID));
  assert.throws(() => certifyCameraPose({ x: 2.005, y: 1.55, z: 0 }, proposed, [wall], 0.25), /No safe camera/);
  assert.throws(() => certifyCameraPose(target, { ...proposed, x: Infinity }, [wall], 0.25));
});

test('normal selection admits a useful non-axis corner certificate', () => {
  const box = { minX: 0, maxX: 4, minZ: 0, maxZ: 4 };
  const p = certifyPlayerMove({ x: -7, z: -3 }, { x: -3, z: -3 }, [box], 4, bounds);
  assert.deepEqual(p, { x: -3, z: -3 });
});
