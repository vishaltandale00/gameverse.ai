// Pure geometry and animation math of the three workstream (no WebGL).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { padVolume, meshVolume, countExposedFaces, quadArea, downsample, AO_CURVE } from '../v2/primitives/graphics/three-voxel-mesh.js';
import { chunkPlan } from '../v2/primitives/graphics/render-voxel.js';
import { humanoidRig, fitHumanoidToParts, HUMANOID_BONES } from '../v2/primitives/graphics/rig-humanoid.js';
import { quadrupedRig, QUADRUPED_LEGS } from '../v2/primitives/graphics/rig-quadruped.js';
import { checkRig, forwardKinematics, customRig, addSecondaryChains, chain } from '../v2/primitives/graphics/three-rig.js';
import { solveTwoBone, solveFabrik, lookAtAngles, springStep, ragdollStep, plantFeet, dist } from '../v2/primitives/graphics/three-ik.js';
import { sampleClip, clipEvents, speedWeights, directionWeights, locomotionBlend, presetClip, resolvePreset, PRESETS, blendPoses } from '../v2/primitives/graphics/three-anim.js';
import { humanoidBody, quadrupedBody, lowpolyParts, rigForSpec } from '../v2/primitives/graphics/model-lowpoly.js';
import { voxelBoxes, voxelGroups, voxelizeParts } from '../v2/primitives/graphics/model-voxel.js';
import { GeoBuilder, appendParts } from '../v2/primitives/graphics/three-geometry.js';
import { quadtreePatches, splatSample, buildPatch, scatterPoints } from '../v2/primitives/graphics/three-terrain.js';
import { skyAt, weatherOf } from '../v2/primitives/graphics/sky.js';
import { bodyPlan, synthesizeSpec, itemSpec } from '../v2/primitives/graphics/three-model-gen.js';
import { buildingParts, roadRibbon } from '../v2/primitives/graphics/three-buildings.js';
import { objectRole, shapeParts } from '../v2/primitives/graphics/three-objects.js';
import { blockMaterialOf, blockShape } from '../v2/primitives/graphics/material-palette.js';
import { thirdPersonFrame } from '../v2/primitives/graphics/camera-third-person.js';
import { headBob } from '../v2/primitives/graphics/camera-first-person.js';
import { isoOffset } from '../v2/primitives/graphics/camera-isometric.js';
import { foliageLod } from '../v2/primitives/graphics/foliage-scatter.js';
import { ragdollBody } from '../v2/primitives/graphics/anim-ragdoll.js';
import { readFileSync } from 'node:fs';

const blockport = JSON.parse(readFileSync(new URL('../v2/games/blockport.json', import.meta.url)));
const emberfall = JSON.parse(readFileSync(new URL('../v2/games/emberfall.json', import.meta.url)));
const lcg = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const MATS = [null, { color: [1, 1, 1], opaque: true }, { color: [0.2, 0.3, 1], opaque: false, alpha: 0.7 }, { color: [1, 0.5, 0], opaque: true, emissive: 1 }];

function randomVolume(size, seed, fill = 0.45) {
  const r = lcg(seed), [sx, sy, sz] = size, cells = new Uint16Array(sx * sy * sz);
  for (let i = 0; i < cells.length; i++) { const v = r(); cells[i] = v < fill ? 1 : v < fill + 0.08 ? 2 : v < fill + 0.1 ? 3 : 0; }
  return padVolume(size, (x, y, z) => x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? 0 : cells[x + sx * (y + sy * z)]);
}
const triNormalsAgree = mesh => {
  const P = mesh.positions, N = mesh.normals, I = mesh.indices; let bad = 0;
  for (let i = 0; i < I.length; i += 3) {
    const a = I[i] * 3, b = I[i + 1] * 3, c = I[i + 2] * 3;
    const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (n[0] * N[a] + n[1] * N[a + 1] + n[2] * N[a + 2] <= 0) bad++;
  }
  return bad;
};

test('greedy mesher: merged quads cover exactly the exposed faces, outward winding, fewer quads', () => {
  for (const [size, seed] of [[[8, 8, 8], 1], [[16, 12, 9], 2], [[5, 20, 3], 3]]) {
    const v = randomVolume(size, seed);
    const m = meshVolume(v, size, MATS, { ao: true });
    const area = quadArea(m.opaque) + quadArea(m.transparent);
    assert.equal(Math.round(area), countExposedFaces(v, size, MATS), `area = exposed faces for ${size}`);
    assert.equal(triNormalsAgree(m.opaque) + triNormalsAgree(m.transparent), 0, 'triangles wind outward');
    assert.ok(m.opaque.quads <= m.opaque.faces);
  }
  // A solid slab merges into one quad per side.
  const slab = padVolume([16, 1, 16], (x, y, z) => x >= 0 && z >= 0 && x < 16 && z < 16 && y === 0 ? 1 : 0);
  const m = meshVolume(slab, [16, 1, 16], MATS, { ao: false });
  assert.equal(m.opaque.quads, 6, 'top, bottom and four sides');
  assert.equal(quadArea(m.opaque), 16 * 16 * 2 + 16 * 4);
});

test('greedy mesher: ambient occlusion darkens corners next to solids; same-material water faces cull', () => {
  // Floor 3x3 with one block on top at the corner: the floor vertex under it is occluded.
  const size = [3, 2, 3];
  const v = padVolume(size, (x, y, z) => (y === 0 && x >= 0 && z >= 0 && x < 3 && z < 3) || (x === 0 && y === 1 && z === 0) ? 1 : 0);
  const m = meshVolume(v, size, MATS, { ao: true, faceShade: [1, 1, 1] });
  const P = m.opaque.positions, C = m.opaque.colors, N = m.opaque.normals;
  let darkest = 1, at = null;
  for (let i = 0; i < P.length / 3; i++) if (N[i * 3 + 1] === 1 && P[i * 3 + 1] === 1) if (C[i * 3] < darkest) { darkest = C[i * 3]; at = [P[i * 3], P[i * 3 + 2]]; }
  assert.ok(darkest < 1 && darkest >= AO_CURVE[0], 'some top-face vertex is occluded');
  assert.ok(at[0] <= 1 && at[1] <= 1, 'the occluded vertex is next to the corner block');
  // Two adjacent water cells: no internal face.
  const w = padVolume([2, 1, 1], (x, y, z) => x >= 0 && x < 2 && y === 0 && z === 0 ? 2 : 0);
  assert.equal(quadArea(meshVolume(w, [2, 1, 1], MATS).transparent), 10);
});

test('greedy mesher: emissive passes through; LOD downsampling keeps shape; cross plants emit quads', () => {
  const v = padVolume([4, 4, 4], (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < 4 && y < 2 && z < 4 ? 3 : 0);
  const m = meshVolume(v, [4, 4, 4], MATS);
  assert.ok(m.opaque.emissive.every(e => e === 1));
  const d = downsample(v, [4, 4, 4]);
  assert.deepEqual(d.size, [2, 2, 2]);
  const lod = meshVolume(d.volume, d.size, MATS, { scale: 2 });
  assert.equal(Math.round(quadArea(lod.opaque, 2)), countExposedFaces(d.volume, d.size, MATS));
  const plants = [null, { color: [0, 1, 0], opaque: false, shape: 'cross' }];
  const p = meshVolume(padVolume([1, 1, 1], (x, y, z) => x === 0 && y === 0 && z === 0 ? 1 : 0), [1, 1, 1], plants);
  assert.equal(p.transparent.quads, 4, 'two crossed quads, both sides');
  assert.equal(p.opaque.quads, 0);
});

test('greedy mesher: a 16x64x16 chunk meshes in milliseconds', () => {
  const size = [16, 64, 16];
  const v = padVolume(size, (x, y, z) => y < 20 + ((x * 7 + z * 13) % 5) ? 1 : 0);
  meshVolume(v, size, MATS); // warm
  const t0 = performance.now(); const m = meshVolume(v, size, MATS); const ms = performance.now() - t0;
  assert.ok(m.opaque.quads > 0);
  assert.ok(ms < 250, `chunk mesh took ${ms.toFixed(1)}ms`); // generous bound for loaded CI machines; typical 2-5 ms
});

test('chunk plan: nearest first, LOD rings outward, bounded', () => {
  const plan = chunkPlan([0, 0, 0], { radius: 6, yRange: [0, 1], lodRings: 2 });
  assert.equal(plan[0].lod, 0);
  assert.ok(plan.slice(0, 4).every(p => Math.abs(p.at[0]) + Math.abs(p.at[2]) <= 1));
  assert.ok(plan.some(p => p.lod === 2));
  for (const p of plan) assert.ok(Math.hypot(p.at[0], p.at[2]) <= 6.5);
  const near = plan.filter(p => p.lod === 0).map(p => Math.hypot(p.at[0], p.at[2])), far = plan.filter(p => p.lod === 2).map(p => Math.hypot(p.at[0], p.at[2]));
  assert.ok(Math.max(...near) < Math.min(...far));
  const bounded = chunkPlan([0, 0, 0], { radius: 6, yRange: [0, 0], bounds: { min: [0, 0, 0], max: [2, 0, 2] } });
  assert.equal(bounded.length, 9);
});

test('humanoid rig: 21 bones + sockets, parents first, proportions respected, fits voxel parts', () => {
  const rig = humanoidRig({ height: 1.8, proportions: { legs: 0.5, torso: 0.3, head: 0.13 } });
  assert.deepEqual(checkRig(rig), []);
  for (const b of HUMANOID_BONES) assert.ok(rig.bones.find(x => x.name === b), b);
  const J = Object.fromEntries(rig.bones.map(b => [b.name, b.head]));
  assert.ok(Math.abs(J.hips[1] - 0.9) < 1e-6, 'hips at leg length');
  assert.ok(J.upperArmL[0] > 0 && J.upperArmR[0] < 0, 'left at +x');
  assert.ok(J.toesL[2] > J.footL[2], 'toes forward (+z)');
  assert.deepEqual(chain(rig, 'upperArmR', 'handR'), ['upperArmR', 'lowerArmR', 'handR']);
  const kit = blockport.content.models.kit;
  const fitted = fitHumanoidToParts(rig, voxelBoxes(kit, 0.0625));
  const F = Object.fromEntries(fitted.bones.map(b => [b.name, b.head]));
  assert.ok(Math.abs(F.upperLegL[1] - 0.75) < 1e-6, 'leg hinge at the top of the 12-voxel leg');
  assert.ok(F.upperArmL[1] > 1.3 && F.upperArmL[1] < 1.5, 'shoulder near the top of the arm box');
  assert.ok(F.upperArmL[0] > 0, 'the voxel armL (authored at low x, front -z) maps to the model left (+x)');
});

test('quadruped rig: legs x3 bones, tail and mane chains, saddle socket', () => {
  const rig = quadrupedRig({ length: 2.4, height: 1.6 });
  assert.deepEqual(checkRig(rig), []);
  for (const l of QUADRUPED_LEGS) for (const p of ['upperLeg', 'lowerLeg', 'hoof']) assert.ok(rig.bones.find(b => b.name === p + l), p + l);
  assert.ok(rig.bones.filter(b => b.name.startsWith('tail_')).length === 3);
  const J = Object.fromEntries(rig.bones.map(b => [b.name, b.head]));
  assert.ok(J.head[2] > J.chest[2] && J.tail_3[2] < J.hips[2], 'head forward, tail back');
  assert.ok(J.hoofFL[1] < 0.2 && J.upperLegFL[1] > 0.8);
});

test('forward kinematics: swinging a thigh forward moves the foot forward', () => {
  const rig = humanoidRig({ height: 1.8 });
  const rest = forwardKinematics(rig).get('footL').pos, swung = forwardKinematics(rig, { upperLegL: [-0.6, 0, 0] }).get('footL').pos;
  assert.ok(swung[2] > rest[2] + 0.3);
  const raised = forwardKinematics(rig, { $root: [0, 0.2, 0] }).get('head').pos;
  assert.ok(Math.abs(raised[1] - forwardKinematics(rig).get('head').pos[1] - 0.2) < 1e-9);
});

test('two-bone IK reaches reachable targets, keeps bone lengths, clamps unreachable ones', () => {
  const a = [0, 1, 0], b = [0, 0.5, 0.05], c = [0, 0, 0];
  const l1 = dist(a, b), l2 = dist(b, c);
  const t = [0.2, 0.3, 0.3];
  const s = solveTwoBone(a, b, c, t, [0, 0.5, 1]);
  assert.ok(dist(s.end, t) < 1e-6 && s.reached);
  assert.ok(Math.abs(dist(a, s.mid) - l1) < 1e-6 && Math.abs(dist(s.mid, s.end) - l2) < 1e-6);
  assert.ok(s.mid[2] > 0, 'knee bends toward the pole');
  const far = solveTwoBone(a, b, c, [0, -5, 0], [0, 0.5, 1]);
  assert.ok(!far.reached && Math.abs(dist(a, far.end) - (l1 + l2)) < 1e-3);
});

test('FABRIK converges within its iterations and preserves lengths', () => {
  const joints = [[0, 0, 0], [0, 1, 0], [0, 2, 0], [0, 3, 0], [0, 4, 0]];
  const r = solveFabrik(joints, [1.5, 2.5, 1], { iterations: 16, tolerance: 1e-4 });
  assert.ok(r.reached && r.iterations <= 16, `error ${r.error}`);
  for (let i = 0; i < 4; i++) assert.ok(Math.abs(dist(r.joints[i], r.joints[i + 1]) - 1) < 1e-6);
  assert.deepEqual(r.joints[0], [0, 0, 0]);
  const out = solveFabrik(joints, [0, 10, 0]);
  assert.ok(!out.reached && Math.abs(out.joints[4][1] - 4) < 1e-9, 'unreachable: straight toward the target');
});

test('look-at limits, foot planting, spring settling and ragdoll sleep', () => {
  const l = lookAtAngles([0, 1.6, 0], [0, 0, 1], [0, 1, 0], [5, 1.6, 0.1], 1.2, 0.6);
  assert.ok(l.yaw > 1.1 && l.yaw <= 1.2 && l.weight === 1, 'target at +x (left) turns up to the yaw limit');
  assert.equal(lookAtAngles([0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 0, -5], 1.2, 0.6).weight, 0, 'targets behind are ignored');
  const planted = plantFeet([{ ankle: [0.1, 0.08, 0], height: 0.08 }, { ankle: [-0.1, 0.08, 0], height: 0.08 }], x => ({ y: x > 0 ? 0.3 : -0.2, normal: [0, 1, 0] }), 0);
  assert.ok(Math.abs(planted.feet[0].target[1] - 0.38) < 1e-9 && Math.abs(planted.feet[1].target[1] + 0.12) < 1e-9);
  assert.equal(planted.pelvis, -0.2);
  // Spring chain: lags behind a moving root, settles back onto the pose, falls freely with no stiffness.
  const st = {}, pose = x => [[x, 2, 0], [x, 1.5, 0], [x, 1, 0]];
  for (let i = 0; i < 30; i++) springStep(st, pose(i * 0.05), 1 / 60, { stiffness: 0.15, damping: 0.5, gravity: [0, 0, 0] });
  assert.ok(st.pos[2][0] < 29 * 0.05 - 0.05, 'the tip lags behind the moving root');
  for (let i = 0; i < 300; i++) springStep(st, pose(1.5), 1 / 60, { stiffness: 0.15, damping: 0.5, gravity: [0, 0, 0] });
  assert.ok(Math.abs(st.pos[2][0] - 1.5) < 0.01, 'and settles back onto the animated pose');
  assert.ok(Math.abs(dist(st.pos[1], st.pos[2]) - 0.5) < 1e-6, 'segment lengths hold');
  const loose = {}, flat = [[0, 2, 0], [0.5, 2, 0], [1, 2, 0]];
  for (let i = 0; i < 200; i++) springStep(loose, flat, 1 / 60, { stiffness: 0, damping: 0.3 });
  assert.ok(loose.pos[2][1] < 1.2, 'with no stiffness a chain swings down under gravity');
  const joints = { hips: [0, 1, 0], chest: [0, 1.4, 0], head: [0, 1.7, 0] };
  const body = ragdollBody(joints, ['hips', 'chest', 'head'], { chest: 'hips', head: 'chest' }, [['hips', 'head']], [1, 0, 0]);
  for (let i = 0; i < 600 && !body.asleep; i++) ragdollStep(body, 1 / 60, () => ({ y: 0 }));
  assert.ok(body.asleep, 'comes to rest');
  assert.ok(body.pos.every(p => p[1] >= 0.05), 'stays above the ground');
  assert.ok(Math.abs(dist(body.pos[0], body.pos[1]) - 0.4) < 0.05);
});

test('locomotion blend: speed weights sum to 1 and move idle->walk->run->sprint; states and strafing', () => {
  let prevRun = -1;
  for (let s = 0; s <= 10; s += 0.25) {
    const w = speedWeights(s, [0.2, 3, 6]);
    assert.ok(Math.abs(w.idle + w.walk + w.run + w.sprint - 1) < 1e-9);
    const runish = w.run + w.sprint * 2;
    assert.ok(runish >= prevRun - 1e-9); prevRun = runish;
  }
  assert.equal(speedWeights(0, [0.2, 3, 6]).idle, 1);
  assert.equal(speedWeights(3, [0.2, 3, 6]).walk, 1);
  const d = directionWeights(Math.PI / 2);
  assert.ok(d.left > 0.99);
  assert.deepEqual(Object.keys(locomotionBlend({ speed: 2, grounded: false, vy: 3 }).weights), ['jump']);
  assert.deepEqual(Object.keys(locomotionBlend({ speed: 2, grounded: false, vy: -3 }).weights), ['fall']);
  assert.ok(locomotionBlend({ speed: 3, angle: Math.PI / 2, grounded: true }, { strafe: true }).weights.strafe_left > 0.9);
  assert.ok(locomotionBlend({ speed: 1, state: 'swim' }, { states: ['grounded', 'swim'] }).weights.swim === 1);
  assert.ok(!locomotionBlend({ speed: 1, state: 'swim' }, { states: ['grounded'] }).weights.swim, 'unlisted states fall back');
  const r = locomotionBlend({ speed: 6, grounded: true });
  assert.ok(r.strideRate < locomotionBlend({ speed: 1, grounded: true }).strideRate, 'longer strides when running');
});

test('clips: every preset samples finite poses, loops wrap, frame events fire once per crossing', () => {
  for (const rig of ['humanoid', 'quadruped']) for (const name of PRESETS[rig]) {
    const clip = presetClip(name, rig);
    for (const t of [0, clip.dur * 0.37, clip.dur]) for (const v of Object.values(sampleClip(clip, t))) assert.ok(v.every(Number.isFinite), `${rig}:${name}`);
  }
  const walk = presetClip('walk');
  assert.equal(clipEvents(walk, 0.01, walk.dur * 2 + 0.001).filter(e => e.event === 'step').length, 4, 'two steps per cycle');
  const swing = presetClip('swing');
  assert.deepEqual(clipEvents(swing, 0, swing.dur).map(e => e.event), ['hit']);
  assert.equal(resolvePreset('spin_slash'), 'light_attack_1');
  assert.equal(resolvePreset('cast_fireball'), 'sign_cast');
  assert.equal(resolvePreset('xyzzy'), null);
  const a = sampleClip(walk, 0.1), b = sampleClip(walk, 0.1 + walk.dur);
  assert.deepEqual(a, b);
  const mixed = blendPoses([{ pose: { spine: [1, 0, 0] }, w: 1 }, { pose: { spine: [0, 0, 0] }, w: 3 }]);
  assert.ok(Math.abs(mixed.spine[0] - 0.25) < 1e-9);
});

test('lowpoly assembly: generated humanoid and quadruped bodies sit on their rigs; skinned geometry with groups', () => {
  const sael = emberfall.content.models.sael;
  const rig = rigForSpec(sael, {});
  const parts = lowpolyParts(sael, rig);
  assert.ok(parts.length > 30);
  const top = Math.max(...parts.filter(p => p.at).map(p => p.at[1] + p.size[1] / 2));
  assert.ok(top < sael.height * 1.12 && top > sael.height * 0.9, `top ${top}`);
  const cape = parts.find(p => p.c === 'cape');
  assert.ok(cape.at[1] + cape.size[1] / 2 <= rig.bones.find(b => b.name === 'neck').head[1] + 0.05, 'cape hangs from the shoulders');
  const { rig: rig2, chains } = addSecondaryChains(rig, parts);
  assert.ok(chains.some(c => c.base === 'cape') && rig2.bones.find(b => b.name === 'cape_3'));
  const bi = new Map(rig2.bones.map((b, i) => [b.name, i]));
  const builder = appendParts(THREE, new GeoBuilder(), parts.map(p => ({ ...p, bone: p.bone || 'hips' })), { palette: sael.palette, boneIndex: bi });
  const g = builder.toGeometry(THREE);
  assert.ok(g.attributes.skinIndex && g.attributes.skinWeight && g.groups.length >= 2);
  const w = g.attributes.skinWeight.array;
  for (let i = 0; i < w.length; i += 4) assert.ok(Math.abs(w[i] + w[i + 1] + w[i + 2] + w[i + 3] - 1) < 1e-5);
  const horse = emberfall.content.models.horse_ash;
  const qr = rigForSpec(horse, {});
  const qp = quadrupedBody(qr, horse, { saddle: true });
  assert.ok(qp.find(p => p.name === 'saddle') && qp.filter(p => p.name?.startsWith('hoof')).length === 4);
  assert.ok(humanoidBody(humanoidRig({ height: 1.7 }), { palette: {}, hair: 'braid' }).some(p => p.name === 'braid'));
});

test('voxel models: rig parts group per bone (boots split by leg); lowpoly voxelizes', () => {
  const kit = blockport.content.models.kit;
  const { groups } = voxelGroups(kit, { rigged: true });
  assert.ok(['head', 'chest', 'upperArmL', 'upperArmR', 'upperLegL', 'upperLegR', 'back'].every(g => groups.has(g)), [...groups.keys()].join());
  const [w, h] = kit.size;
  const legL = groups.get('upperLegL');
  // Boots box x 4..11, y 0..1: x 4..7 belongs to legL, x 8..11 to legR.
  assert.ok(legL[5 + w * (0 + h * 3)] > 0 && groups.get('upperLegR')[9 + w * (0 + h * 3)] > 0);
  const sedan = voxelGroups(blockport.content.models.sedan);
  assert.ok([...sedan.groups.keys()].some(k => k.startsWith('spin:wheel')));
  const v = voxelizeParts([{ shape: 'sphere', at: [0, 0.5, 0], size: [1, 1, 1], c: 'body' }], { body: '#ff0000' }, 0.1);
  const filled = v.parts.reduce((s, p) => s + p.box[3], 0);
  assert.ok(Math.abs(filled - (4 / 3) * Math.PI * 125) / ((4 / 3) * Math.PI * 125) < 0.2, `sphere volume ${filled}`);
});

// Corrected expectations: body plans and held shapes came from words in ids (grey_wolf -> quadruped, warden_blade ->
// sword); they come from declarations now (three-model-gen.js; tests/v2-p-presentation-models.test.js holds the
// catalogue-wide property), so these assert the declared kinds and parts.
test('model generation: body plans from declared kinds and parts, deterministic specs for everything', () => {
  assert.equal(bodyPlan({ id: 'grey_wolf', kind: 'npc' }), 'humanoid', 'a name that reads as an animal changes nothing');
  assert.equal(bodyPlan({ id: 'anything', kind: 'mount' }), 'quadruped');
  assert.equal(bodyPlan({ id: 'cart', kind: 'vehicle' }), 'vehicle');
  assert.equal(bodyPlan({ id: 'old_well', kind: 'prop' }), 'prop');
  assert.equal(synthesizeSpec({ id: 'skiff', kind: 'vehicle', components: { vehicle: {}, boat: {} } }).vehicle, 'boat');
  assert.equal(synthesizeSpec({ id: 'police_car', kind: 'vehicle', components: { vehicle: {}, aircraft: {} } }).vehicle, 'plane');
  assert.deepEqual(synthesizeSpec({ id: 'marsh_hag', kind: 'boss' }), synthesizeSpec({ id: 'marsh_hag', kind: 'boss' }));
  for (const a of [...blockport.content.archetypes, ...emberfall.content.archetypes]) {
    const s = synthesizeSpec(a);
    assert.ok(s.kind === 'lowpoly' && (s.rig || s.parts?.length), a.id);
  }
  assert.equal(itemSpec({ id: 'warden_blade', weapon: { damage: 4 } }).item, 'sword');
  assert.equal(itemSpec({ id: 'hunting_bow', ranged: {} }).item, 'bow');
  assert.equal(itemSpec({ id: 'hunting_bow' }).item, 'tool', 'an undeclared item is no bow for its id');
});

test('terrain: quadtree leaves tile the world without overlap and are finer near the camera', () => {
  const bounds = { min: [0, 0], max: [1024, 1024] };
  const leaves = quadtreePatches([100, 0, 100], { patch: 32, levels: 5, bounds });
  const area = leaves.reduce((s, l) => s + l.size * l.size, 0);
  assert.equal(area, 1024 * 1024, 'full coverage, no overlap');
  const near = leaves.find(l => 100 >= l.x && 100 < l.x + l.size && 100 >= l.z && 100 < l.z + l.size);
  assert.equal(near.level, 0);
  assert.ok(leaves.some(l => l.level >= 3), 'coarse patches far away');
  assert.ok(leaves.length < 120);
});

test('terrain: splat rules by biome, slope and height; patches have up normals on flat ground; scatter is deterministic', () => {
  const rules = emberfall.graphics.find(g => g.use === 'graphics.terrain.procedural').with.splat;
  const vale = splatSample({ biome: 'hearth_vale', slope: 5, height: 50 }, rules);
  const cliff = splatSample({ biome: 'hearth_vale', slope: 70, height: 50 }, rules);
  const peak = splatSample({ biome: 'stonecrown', slope: 5, height: 700 }, rules);
  assert.ok(vale.color[1] > vale.color[0], 'meadow is green');
  assert.ok(Math.abs(cliff.color[0] - cliff.color[1]) < 0.05, 'cliffs go grey');
  assert.ok(peak.color[2] > 0.8, 'peaks go snowy');
  const p = buildPatch({ x: 0, z: 0, size: 16, n: 8 }, () => ({ y: 3 }), () => [1, 1, 1]);
  for (let i = 0; i < 81; i++) assert.ok(Math.abs(p.normals[i * 3 + 1] - 1) < 1e-9);
  assert.equal(p.indices.length / 3, 8 * 8 * 2 + 8 * 4 * 4, 'grid plus double-sided skirts');
  assert.deepEqual(scatterPoints(0, 0, 20, 0.5, 9), scatterPoints(0, 0, 20, 0.5, 9));
});

test('sky: sun rises and sets with the hour; night factors; weather presets', () => {
  const noon = skyAt(13, { phases: { dawn: 5, day: 7, dusk: 18, night: 21 } }), midnight = skyAt(1);
  assert.ok(noon.sun[1] > 0.6 && noon.day > 0.9 && noon.night === 0);
  assert.ok(midnight.sun[1] < 0 && midnight.night > 0.9 && midnight.moon[1] > 0);
  const dusk = skyAt(19);
  assert.ok(dusk.twilight > 0.3);
  assert.ok(Math.abs(Math.hypot(...noon.sun) - 1) < 1e-9);
  assert.equal(weatherOf('storm').lightning, true);
  assert.equal(weatherOf('light_drizzle').precip, 'rain');
  assert.equal(weatherOf('ashfall').precip, 'ash');
});

test('buildings, roads, object roles and block materials', () => {
  const b = buildingParts({ size: [10, 6, 8], floors: 2, style: 'thatch', id: 'h' });
  assert.ok(b.parts.find(p => p.name === 'roof') && b.parts.filter(p => p.mat === 'metal').length >= 4);
  const tower = buildingParts({ size: [12, 60, 12], floors: 20, style: 'glass-tower' });
  assert.ok(tower.parts.length < 40, 'towers use glass bands, not thousands of windows');
  const road = roadRibbon({ points: [[0, 0, 0], [10, 0, 0]], width: 6, surface: 'asphalt' }, () => ({ y: 1 }));
  const I = road.indices, P = road.positions;
  const a = I[0] * 3, bb = I[1] * 3, c = I[2] * 3;
  const ny = (P[c] - P[a]) * (P[bb + 2] - P[a + 2]) - (P[c + 2] - P[a + 2]) * (P[bb] - P[a]);
  assert.ok(ny < 0 || ny > 0);
  const e1 = [P[bb] - P[a], P[bb + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 2] - P[a + 2]];
  assert.ok(e1[1] * e2[0] - e1[0] * e2[1] > 0, 'road faces up');
  assert.equal(objectRole({ kind: 'tree' }), 'foliage');
  assert.equal(objectRole({ kind: 'house' }), 'building');
  assert.equal(objectRole({ role: 'wall', group: 'g1', shape: 'box' }), 'shape');
  assert.equal(objectRole({ shape: 'none', group: 'g1', kind: 'house' }), 'marker');
  assert.ok(shapeParts({ role: 'wall', size: [8, 6, 0.3] }, 'stone').length > 4, 'long walls get windows');
  const leaves = blockMaterialOf('leaves', blockport.content.blocks.find(x => x.id === 'leaves'), {});
  assert.ok(!leaves.opaque && leaves.alpha > 0.9);
  assert.ok(blockMaterialOf('lamp', blockport.content.blocks.find(x => x.id === 'lamp'), {}).emissive === 1);
  assert.equal(blockShape({ id: 'crop_wheat', tags: ['crop'] }), 'cross');
  assert.equal(blockMaterialOf('mystery_ore', undefined, {}).opaque, true);
});

test('camera math: third-person frames behind, lock-on turns toward the target; bob and iso offsets', () => {
  const f = thirdPersonFrame({ pivot: [0, 1.6, 0], yaw: 0, pitch: 0, distance: 4 });
  assert.ok(Math.abs(f.pos[2] + 4) < 1e-9, 'behind the player (-z when facing +z)');
  const right = thirdPersonFrame({ pivot: [0, 1.6, 0], yaw: 0, pitch: 0, distance: 4, shoulder: 0.5 });
  assert.ok(right.pos[0] < 0, 'right shoulder is -x when facing +z');
  const lock = thirdPersonFrame({ pivot: [0, 1.6, 0], yaw: 0, pitch: 0, distance: 4, target: [10, 1.6, 0], lockOnBlend: 1 });
  assert.ok(Math.abs(lock.yaw - Math.PI / 2) < 1e-9);
  assert.equal(headBob(0.3, 0, 4).y, 0);
  assert.ok(Math.abs(headBob(0.25, 1, 4).y) > 0);
  const o = isoOffset(35, Math.PI / 4, 100);
  assert.ok(o[1] > 0 && o[0] < 0 && o[2] < 0);
  assert.equal(foliageLod(10, 400, 900), 0); assert.equal(foliageLod(500, 400, 900), 1); assert.equal(foliageLod(1000, 400, 900), -1);
});

test('custom rigs from parts: spine chain and wing bones', () => {
  const wyrm = emberfall.content.models.frost_wyrm;
  const rig = customRig(wyrm.parts, { bones: wyrm.bones });
  assert.deepEqual(checkRig(rig), []);
  assert.ok(rig.bones.find(b => b.name === 'head') && rig.bones.find(b => b.name === 'wingL') && rig.bones.find(b => b.name === 'tail_1'));
});
