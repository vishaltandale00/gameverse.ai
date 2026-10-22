// Headless-safe logic of the flat graphics helpers: autotiling, camera math,
// projections, pixel sprite generation, tile patterns, maze contours, track
// projection, light polygons, quantization, particles, rigs and art roles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BLOB47, blobIndex, blobMask, wangMask, wangIndex, canonical, features, N, E, S, W, NE } from '../v2/primitives/graphics/flat-autotile.js';
import { projection, viewTransform, sideCamera, topDownCamera, fitAxis, tileZoom, fitBox, shakeOffset } from '../v2/primitives/graphics/flat-camera.js';
import { pixelFrame, opaqueBox, resolveAnim, frameIndex, animInfo, roleOf as partRole } from '../v2/primitives/graphics/flat-pixel.js';
import { paintTile, normalizeTheme, PATTERNS, patternFor, themeFromBlock } from '../v2/primitives/graphics/flat-tiles.js';
import { wallLoops } from '../v2/primitives/graphics/flat-maze.js';
import { trackView, curves } from '../v2/primitives/graphics/render-track.js';
import { lightPolygon } from '../v2/primitives/graphics/lighting-2d.js';
import { quantizeData, levelsFor } from '../v2/primitives/graphics/post.js';
import { createParticles, DEFAULT_PRESETS, SHAPES } from '../v2/primitives/graphics/flat-particles.js';
import { solveBones, sampleClip, bonePose, BONE_PRESETS, fighterPose, fighterLook, POSES } from '../v2/primitives/graphics/flat-rig.js';
import { roleOf, lookFor, propFor, poseFor, themeFor } from '../v2/primitives/graphics/flat-art.js';
import { drawVector, PRESETS } from '../v2/primitives/graphics/flat-vector.js';
import { buildChunk, chunkCache } from '../v2/primitives/graphics/flat-chunks.js';
import { normalizeLayers, PATTERNS as BACKDROPS } from '../v2/primitives/graphics/flat-backdrop.js';
import { PROPS, paintProp } from '../v2/art/props.js';
import { recordingContext } from './v2-p-flat-stub.js';
import { catalogue } from '../v2/primitives/index.js';
import { testSpace } from '../v2/kernel/testing.js';

test('blob47 has exactly 47 canonical masks; corners count only with both edges', () => {
  assert.equal(BLOB47.length, 47);
  assert.equal(canonical(NE), 0, 'a lone diagonal is not a connection');
  assert.equal(canonical(N | E | NE), N | E | NE);
  assert.equal(blobIndex(255), 46);
  const all = blobMask(() => true), none = blobMask(() => false);
  assert.equal(all, 255); assert.equal(none, 0);
  assert.equal(wangIndex(wangMask((dx, dy) => dy === 1 && dx === 0)), 1, 'only north connects');
  const f = features(N | E | S | W, 'blob47');
  assert.deepEqual(f.inner, { ne: true, se: true, sw: true, nw: true }, 'all four inner corners open when diagonals are missing');
  assert.equal(features(0).outer.ne, true);
});

test('projections invert, iso rotates, tilt foreshortens', () => {
  for (const [kind, o] of [['yup', {}], ['ydown', {}], ['iso', { angle: 30 }], ['iso', { angle: 35, rot: 1 }], ['yup', { tilt: 50 }]]) {
    const P = projection(kind, o);
    for (const p of [[0, 0], [3.5, -2], [10, 7]]) { const q = P.inverse(P(p)); assert.ok(Math.abs(q[0] - p[0]) < 1e-9 && Math.abs(q[1] - p[1]) < 1e-9, `${kind} round trip`); }
  }
  const up = projection('yup'), cam = { x: 5, y: 5, zoom: 10 };
  const X = viewTransform(cam, up, 200, 100);
  assert.deepEqual(X.toScreen([5, 5]), [100, 50], 'camera center maps to view center');
  assert.ok(X.toScreen([5, 6])[1] < 50, 'y up moves up the screen');
  assert.ok(projection('yup', { tilt: 45 })([0, 1])[1] > -1, 'tilt squashes depth');
});

test('camera: dead zone, bounds, rises-only and fighter framing', () => {
  const st = {}, view = [10, 6];
  sideCamera(st, { target: [5, 3], view, zoom: 32, bounds: [0, 0, 100, 20], dt: 1 / 60 }, { deadzone: [2, 2], lookAhead: 0 });
  const x0 = st.x;
  sideCamera(st, { target: [5.5, 3], view, zoom: 32, bounds: [0, 0, 100, 20], dt: 1 / 60 }, { deadzone: [2, 2], lookAhead: 0 });
  assert.equal(st.x, x0, 'inside the dead zone the camera holds');
  for (let i = 0; i < 300; i++) sideCamera(st, { target: [60, 3], view, zoom: 32, bounds: [0, 0, 100, 20], dt: 1 / 60 }, { deadzone: [2, 2], lookAhead: 0, smoothing: 0.2 });
  assert.ok(Math.abs(st.x - 59) < 0.2, 'follows to the dead-zone edge');
  for (let i = 0; i < 300; i++) sideCamera(st, { target: [0, 0], view, zoom: 32, bounds: [0, 0, 100, 20], dt: 1 / 60 }, { lookAhead: 0, smoothing: 0.3 });
  assert.ok(st.x >= 5 - 1e-6 && st.y >= 3 - 1e-6, 'clamped inside the bounds');
  const rise = {};
  sideCamera(rise, { target: [5, 10], view, zoom: 32, dt: 1 / 60 }, { risesOnly: true });
  for (let i = 0; i < 120; i++) sideCamera(rise, { target: [5, 2], view, zoom: 32, dt: 1 / 60 }, { risesOnly: true, deadzone: [1, 1] });
  assert.ok(rise.y >= 10 - 1e-9, 'rises-only never scrolls down');
  const fight = {};
  for (let i = 0; i < 200; i++) sideCamera(fight, { target: [0, 1], targets: [[0, 1], [30, 1]], view, zoom: 32, dt: 1 / 60 }, { frameMargin: 2 });
  assert.ok(fight.zoom < 32 && Math.abs(fight.x - 15) < 0.5, 'centers between fighters and zooms out');
  assert.equal(fitAxis(50, 10, 0, 6), 3, 'rooms smaller than the view are centered');
  assert.equal(tileZoom({ tile: 16, scale: 3, minView: [10, 6] }, 960, 540), 48, 'integer pixel scale');
  assert.equal(tileZoom({ tile: 16, scale: 4, minView: [20, 12] }, 640, 360), 16, 'small screens zoom out to keep the view, snapped');
  const fb = fitBox([0, 0, 10, 5], 200, 100, 0); assert.equal(fb.zoom, 20);
  assert.deepEqual(shakeOffset(0, 1), [0, 0]);
  const td = {}; topDownCamera(td, { target: [3, 3], view, zoom: 20, dt: 1 / 60 }, {}); assert.equal(td.x, 3);
});

test('pixel sprites: outlined, animated per part role, dissolving deaths', () => {
  const spec = { kind: 'pixel', size: [16, 22], palette: { o: '#1b1626', b: '#e8dcc8', k: '#2d2640', f: '#ffb347' }, parts: [{ name: 'body', rect: [4, 3, 8, 12], c: 'b' }, { name: 'hood', rect: [3, 12, 10, 8], c: 'k' }, { name: 'lantern', rect: [12, 6, 3, 5], c: 'f' }, { name: 'legs', rect: [5, 0, 6, 4], c: 'o' }], pivot: [8, 0] };
  const idle = pixelFrame(spec, 'idle', 0), run1 = pixelFrame(spec, 'run', 1), run4 = pixelFrame(spec, 'run', 4);
  assert.equal(idle.w, 20); assert.equal(idle.pivot[1], idle.h - 2, 'pivot at the feet');
  assert.notDeepEqual(run1.data, run4.data, 'run frames differ');
  const box = opaqueBox(idle), plain = opaqueBox(pixelFrame(spec, 'idle', 0, { outline: '' }));
  assert.ok(box[2] - box[0] > plain[2] - plain[0], 'outline grows the silhouette');
  const alive = [...pixelFrame(spec, 'die', 0).data].filter((v, i) => i % 4 === 3 && v).length, gone = [...pixelFrame(spec, 'die', 5).data].filter((v, i) => i % 4 === 3 && v).length;
  assert.ok(gone < alive * 0.5, 'death dissolves');
  assert.equal(partRole('lantern'), 'held'); assert.equal(partRole('wingL'), 'wings'); assert.equal(partRole('legs'), 'legs');
  assert.equal(resolveAnim({ anims: { wall: {} } }, 'wallslide'), 'wall');
  assert.equal(resolveAnim({ anims: { idle: {} } }, 'dash'), 'dash', 'procedural defaults cover missing anims');
  assert.equal(frameIndex(animInfo(spec, 'jump'), 10), 1, 'non-looping anims hold the last frame');
});

test('tile patterns are seamless across tiles and every pattern paints', () => {
  const T = 16;
  for (const pattern of PATTERNS) {
    const th = normalizeTheme({ pattern, palette: { a: '#5a6a4a', b: '#b0e070', c: '#1a2010' }, edge: 'none' });
    const buf = new Uint8ClampedArray(T * 2 * T * 4);
    paintTile(buf, T * 2, 0, 0, T, th, 0, 0, 255); paintTile(buf, T * 2, T, 0, T, th, 1, 0, 255);
    const filled = [...buf].filter((v, i) => i % 4 === 3 && v).length;
    assert.ok(filled > 0, `${pattern} paints`);
  }
  // Same world pixel, same color: tiles painted at different buffer offsets agree.
  const th = normalizeTheme({ pattern: 'brick', palette: { a: '#8a5a3a' } });
  const a = new Uint8ClampedArray(T * T * 4), b = new Uint8ClampedArray(T * 3 * T * 4);
  paintTile(a, T, 0, 0, T, th, 5, 2, 255); paintTile(b, T * 3, T, 0, T, th, 5, 2, 255);
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) assert.equal(a[(y * T + x) * 4], b[(y * T * 3 + T + x) * 4]);
  // A block's pattern is the tile it declares; its id, name and tags never pick one (ARCHITECTURE §1.2).
  assert.equal(patternFor({ id: 'oak_tree', name: 'Oak tree' }), 'rock'); assert.equal(patternFor({ id: 'x', tile: 'metal' }), 'metal');
  assert.equal(themeFromBlock({ id: 'w', color: '#ff0000' }).palette.a, '#ff0000');
});

test('chunks autotile, collect liquids and hazards, and cache with LRU', () => {
  const cells = new Map(), info = b => ({ kind: b === 'water' ? 'liquid' : b === 'spike' ? 'hazard' : 'solid', theme: normalizeTheme({ pattern: 'rock', palette: { a: '#666666' } }) });
  for (let x = 0; x < 8; x++) cells.set(`${x},0`, 'stone');
  cells.set('3,1', 'water'); cells.set('5,1', 'spike');
  const ch = buildChunk({ cells, cx: 0, cy: 0, C: 8, T: 8, info, solidAt: (x, y) => cells.get(`${x},${y}`) === 'stone' });
  assert.equal(ch.liquids.length, 1); assert.equal(ch.hazards.length, 1);
  assert.ok(ch.buf || ch.canvas);
  const lru = chunkCache(2); lru.set('a', 1); lru.set('b', 2); lru.get('a'); lru.set('c', 3);
  assert.deepEqual([...lru.keys()], ['a', 'c'], 'least recently used evicted');
});

test('maze contours trace wall regions into closed loops', () => {
  const wall = (i, j) => i === 0 || j === 0 || i === 6 || j === 4 || (i === 3 && j === 2);
  const loops = wallLoops(7, 5, wall);
  assert.ok(loops.length >= 2, 'outer frame and the island');
  for (const L of loops) assert.ok(L.length >= 4 && L.box.length === 4);
});

test('track projection: farther is higher and smaller; curves are seeded', () => {
  const v = trackView({ w: 800, h: 450, zc: 0 });
  const near = v.proj(0, 0, 3), far = v.proj(0, 0, 60);
  assert.ok(far[1] < near[1] && far[2] < near[2]);
  assert.equal(v.proj(0, 0, 0.1), null, 'behind the camera');
  const a = curves(1), b = curves(1), c = curves(2);
  assert.equal(a.curve(40), b.curve(40)); assert.notEqual(a.curve(40), c.curve(40));
});

test('light polygons stop at solid cells', () => {
  const solid = (x, y) => x === 3;
  const poly = lightPolygon([0.5, 0.5], 6, solid, 32);
  const east = poly[0];
  assert.ok(east[0] < 3.5, 'the eastward ray is blocked by the wall');
  const west = poly[16];
  assert.ok(Math.abs(west[0] - (0.5 - 6)) < 1e-6, 'the westward ray runs the full radius');
});

test('quantize posterizes to the requested levels', () => {
  const d = new Uint8ClampedArray([10, 120, 250, 255, 128, 128, 128, 255]);
  quantizeData(d, 2, 1, 2);
  for (let i = 0; i < 8; i++) if (i % 4 !== 3) assert.ok(d[i] === 0 || d[i] === 255);
  assert.equal(levelsFor(64), 4);
});

test('particles emit, age, respect the budget and every shape draws', () => {
  const P = createParticles({ budget: 50 });
  for (const shape of SHAPES) P.emit({ ...DEFAULT_PRESETS[0], shape, count: 3 }, [0, 0], 's');
  assert.ok(P.list.length <= 50);
  const g = recordingContext({});
  const F = { ctx: g, unit: 20, w: 400, h: 300, toScreen: p => [200 + p[0] * 20, 150 - p[1] * 20] };
  P.draw(F, 's', 'normal'); P.draw(F, 's', 'additive');
  assert.ok((g.calls.get('fill') || 0) + (g.calls.get('stroke') || 0) > 0);
  for (let i = 0; i < 200; i++) P.update(1 / 30);
  assert.equal(P.list.length, 0, 'all particles expire');
});

test('rigs: fighter poses for every state, bone FK, clip sampling, procedural presets', () => {
  for (const state of ['idle', 'run', 'jump', 'fall', 'land', 'dash', 'attack', 'hurt', 'die', 'block', 'crouch', 'win', 'dazed']) {
    const p = fighterPose({ state, age: 0.2, t: 1.3 });
    for (const k of Object.keys(POSES.guard)) assert.ok(Number.isFinite(p[k]), `${state}.${k}`);
  }
  assert.equal(fighterLook('ryu').outfit, fighterLook('ryu').outfit, 'looks are seeded');
  const J = solveBones([{ id: 'a', at: [0, 0], len: 10, angle: 90 }, { id: 'b', parent: 'a', at: [0, 0], len: 5, angle: 90 }]);
  assert.deepEqual(J.get('b').tip.map(v => Math.round(v)), [10, -5], 'child bones chain off their parent tips');
  const clip = { dur: 1, keys: [{ t: 0, pose: { a: 0 } }, { t: 1, pose: { a: 90 } }] };
  assert.equal(Math.round(sampleClip(clip, 0.5).a), 45);
  for (const [name, rig] of Object.entries(BONE_PRESETS)) { const pose = bonePose(rig, 'run', 0.7); assert.ok(Object.keys(pose).length > 0, name); }
});

// Roles come from the declared kind and what the components' cards declare they present (card.presents); looks are a
// variation seeded by the archetype id; names and words never choose either (ARCHITECTURE §1.2: names are themed).
test('generated art picks roles from declarations and looks from a seed, never from words', () => {
  const { registry } = catalogue([testSpace]);
  assert.equal(roleOf({ id: 'mossling', kind: 'enemy' }), 'enemy');
  assert.equal(roleOf({ id: 'ember_coin', kind: 'pickup' }), 'pickup');
  assert.equal(roleOf({ id: 'x', components: { interact: {} } }, 'x', registry), 'npc', 'gameplay.interact presents interact as npc');
  assert.equal(roleOf({ id: 'flag', kind: 'prop', components: { goal: {} } }, 'flag', registry), 'goal', 'a component presenting a goal outranks the generic prop kind');
  assert.equal(roleOf({ id: 'goblin_coin', name: 'Coin of the goblin' }), 'prop', 'words in the id or name never make a role');
  assert.deepEqual(lookFor({ id: 'cave_bat', kind: 'enemy', name: 'A' }), lookFor({ id: 'cave_bat', kind: 'enemy', name: 'Wraith knight' }), 'the name never changes the look');
  assert.equal(propFor({ id: 'k', components: { pickup: { item: 'key' } } }, 'pickup', registry, { content: { items: [{ id: 'key', kind: 'key' }] } }), 'key', 'a pickup draws its declared item kind');
  assert.equal(propFor({ id: 'door', components: { lock: {} } }, 'prop', registry), 'door', 'gameplay.container presents a lock as a door');
  for (const k of PROPS.decor) assert.ok(paintProp(k).startsWith('<svg'), k);
  assert.ok(poseFor('run', 0.3).startsWith('run'));
  // Scenery is the space's declared closed-set param (engine/spaces2d-scenery.js): never read from words, no default.
  assert.equal(themeFor({ title: 'Hollow Lantern', logline: 'a cave', spaces: [{ id: 's', zones: [{ id: 'z', tags: ['cave'] }] }] }, 's'), null, 'the title, logline and zone tags never pick scenery');
  assert.equal(themeFor({ spaces: [{ id: 's', with: { scenery: 'cave' } }] }, 's'), 'cave', 'a space declares its scenery');
  assert.equal(themeFor({ spaces: [{ id: 's', with: { scenery: 'lava lake' } }] }, 's'), null, 'a look outside the closed set is none');
});

test('every vector preset and backdrop pattern draws on a canvas', () => {
  for (const p of PRESETS) { const g = recordingContext({}); drawVector(g, p, 20, '#ff5a7a', { t: 1.2, shapes: [{ shape: 'star', r: 0.5 }, { shape: 'rect', size: [1, 0.5] }] }); assert.ok(g.calls.size > 0, p); }
  const layers = normalizeLayers(BACKDROPS.map((pattern, i) => ({ pattern, depth: i / BACKDROPS.length, color: '#334455' })));
  assert.equal(layers.length, BACKDROPS.length);
});

test('track curves on a looped track repeat every lap (whole cycles per lap); open tracks keep their own waves', () => {
  const c = curves(3, { period: 320 });
  for (const z of [0, 17, 151.5, 300]) { assert.ok(Math.abs(c.curve(z) - c.curve(z + 320)) < 1e-9); assert.ok(Math.abs(c.hill(z) - c.hill(z + 640)) < 1e-9); }
  assert.notEqual(c.curve(40), c.curve(41), 'it still bends');
  assert.equal(curves(3).curve(40), curves(3, { period: 0 }).curve(40));
});
