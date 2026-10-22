// The three workstream's primitives installed for real (non-headless) in Node:
// a stub WebGL renderer and DOM-less container stand in for the browser, so
// installs, per-frame hooks, meshing, actors and animation run unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { compile, testSpace } from '../v2/kernel/testing.js';
import { PRIMITIVES } from '../v2/primitives/index.js';
import { preflight } from '../v2/kernel/document.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import three from '../v2/primitives/graphics/three.index.js';

const MINE = new Set(three.map(p => p.id));
const GAMES = ['blockport', 'emberfall', 'hollow-lantern', 'quiet-manor'].map(f => [f, JSON.parse(readFileSync(new URL(`../v2/games/${f}.json`, import.meta.url)))]);

function fakeView() {
  const canvas = { style: {}, className: '', tabIndex: 0, addEventListener() {}, requestPointerLock() {}, isConnected: true };
  const container = { clientWidth: 640, clientHeight: 360, style: {}, classList: { add() {} }, prepend() {}, appendChild() {}, dispatchEvent() {}, addEventListener() {} };
  const renderer = { domElement: canvas, shadowMap: {}, info: { render: { calls: 0, triangles: 0 } }, setPixelRatio() {}, setSize() {}, render() {}, dispose() {} };
  const frames = []; let clock = 0;
  const view = { container, THREE, act() {}, onFrame: f => frames.push(f), input: null, createRenderer: () => renderer, now: () => clock };
  return { view, frame: (a = 0.5) => { clock += 1000 / 60; frames.forEach(f => f(a)); } };
}

// Test-only primitives: terrain cells for the test space, a heightfield space shaped like
// engine.space.mesh3d (anchor centre, surface, objects, bounds) and a mover.
const testTerrain = {
  id: 'engine.generate.three-test-terrain', card: { intent: 'test terrain', params: {} },
  install(rt, config, instance) {
    const sid = instance.space, [W, , D] = rt.space(sid).size, cells = {};
    for (let x = 0; x < W; x++) for (let z = 0; z < D; z++) { const h = 4 + ((x >> 2) + (z >> 3)) % 3; for (let y = 0; y <= h; y++) cells[`${x},${y},${z}`] = y === h ? 'grass' : 'stone'; }
    for (let y = 5; y < 9; y++) cells[`20,${y},20`] = 'log';
    rt.state.spaces[sid].cells = cells;
  },
};
const testHeight = {
  id: 'engine.space.three-test-height',
  card: { intent: 'test heightfield', params: {}, provides: { capabilities: ['position', 'distance', 'surface'], services: ['roadgraph'] } },
  install(rt, config, instance) {
    const h = (x, z) => Math.sin(x / 9) * 2 + Math.cos(z / 13) * 2 + (x > 60 ? 4 : 0);
    const groundAt = (x, z) => ({ y: h(x, z), normal: [0, 1, 0], material: 'grass', biome: x > 40 ? 'stonecrown' : 'hearth_vale' });
    rt.defineSpace(instance.id, {
      kind: 'mesh3d', anchor: 'center', size: [256, 256], bounds: () => ({ min: [0, -10, 0], max: [256, 40, 256] }),
      place(e) {}, remove() {}, pos: e => e.at, setPos(e, at) { e.at = at; }, entitiesAt: () => [], inZone: () => false, zoneAt: () => null, teleport() {}, nearest: () => null,
      distance: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), groundAt, slopeAt: () => 0, waterDepthAt: () => 0,
      objects: region => region ? [{ id: `t${region.min[0]}_${region.min[1]}`, kind: 'tree', at: [region.min[0] + 10, NaN, region.min[1] + 10] }, { id: `r${region.min[0]}`, kind: 'barrel', at: [region.min[0] + 20, NaN, region.min[1] + 4] }]
        : [{ id: 'inn', kind: 'house', style: 'timber', at: [30, h(30, 30), 30], size: [10, 6, 8], floors: 2 },
          { id: 'w1', role: 'wall', group: 'mill', shape: 'box', at: [50, h(50, 50), 50], size: [8, 5, 0.4], rot: 0.3 }, { id: 'mill', shape: 'none', group: 'mill', kind: 'mill', style: 'stone', size: [8, 5, 8] }],
    });
    const graph = { nodes: [], edges: [{ id: 'e', points: [[10, 0, 10], [80, 0, 40]], width: 5, surface: 'cobble' }] };
    const svc = () => graph; svc.of = () => svc; rt.provide('roadgraph', svc);
  },
};
const testMover = {
  id: 'gameplay.three-test-mover', card: { intent: 'test mover', params: {}, provides: { events: ['jump', 'attack', 'hit', 'defeated', 'block_mined'] } },
  install(rt) {
    rt.system('movement', rt => {
      for (const e of Object.values(rt.state.entities)) {
        const w = e.components.wander; if (!w) continue;
        const b = e.components.body;
        const t = rt.state.time * w.rate;
        b.vel = [Math.cos(t) * w.speed, 0, Math.sin(t) * w.speed]; b.facing = [Math.cos(t), 0, Math.sin(t)]; b.grounded = true;
        const api = rt.space(e.space);
        e.at = [e.at[0] + b.vel[0] * rt.dt, e.at[1], e.at[2] + b.vel[2] * rt.dt];
        if (api.kind !== 'test') e.at[1] = api.groundAt(e.at[0], e.at[2]).y + b.size[1] / 2;
        api.setPos(e, e.at, rt);
      }
    });
  },
};
const EXTRA = [testSpace, testTerrain, testHeight, testMover];

const blockport = GAMES[0][1], emberfall = GAMES[1][1];
const arch = (id, kind, model, extra = {}) => ({ id, kind, components: { ...(model ? { model } : {}), body: { size: [0.6, 1.8, 0.6] }, ...extra } });
function voxelDoc() {
  return {
    schema: 'gameverse.v2.game/0.2', id: 'three-voxel', title: 'Three voxel test', seed: 5, views: { primary: '3p' },
    spaces: [{ id: 'w', use: 'engine.space.test', with: { size: [32, 16, 32] }, generators: [{ use: 'engine.generate.three-test-terrain' }] }],
    systems: [{ use: 'gameplay.three-test-mover' }],
    content: { blocks: blockport.content.blocks, models: { kit: blockport.content.models.kit, cow: blockport.content.models.cow, sedan: blockport.content.models.sedan },
      archetypes: [arch('kit', 'player', 'kit', { wander: { rate: 0.5, speed: 4 } }), arch('cow', 'creature', 'cow', { wander: { rate: 0.3, speed: 1 } }), arch('sedan', 'vehicle', 'sedan', { wander: { rate: 0.2, speed: 6 } }), arch('goblin', 'npc', null)] },
    graphics: blockport.graphics.filter(g => MINE.has(g.use)),
    player: { archetype: 'kit', at: [10, 6, 10] },
  };
}
function meshDoc() {
  const models = Object.fromEntries(['sael', 'horse_ash', 'wolf', 'frost_wyrm', 'campfire'].map(k => [k, emberfall.content.models[k]]));
  return {
    schema: 'gameverse.v2.game/0.2', id: 'three-mesh', title: 'Three mesh test', seed: 6, views: { primary: '3p' },
    spaces: [{ id: 'realm', use: 'engine.space.three-test-height' }],
    systems: [{ use: 'gameplay.three-test-mover' }],
    content: { models, archetypes: [arch('sael', 'player', 'sael', { wander: { rate: 0.4, speed: 3 }, health: { hp: 10, max: 10 } }), arch('horse_ash', 'mount', 'horse_ash', { wander: { rate: 0.2, speed: 5 } }), arch('wolf', 'creature', 'wolf', { health: { hp: 5, max: 5 } }), arch('frost_wyrm', 'boss', 'frost_wyrm'), arch('campfire', 'prop', 'campfire'), arch('crow', 'creature', null, { wander: { rate: 1, speed: 4 } })] },
    graphics: emberfall.graphics.filter(g => MINE.has(g.use)),
    player: { archetype: 'sael', at: [20, 2, 20] },
  };
}
const make = (doc, opts = {}) => { const v = fakeView(); const r = compile(doc, { primitives: [...PRIMITIVES, ...EXTRA], headless: false, view: v.view, ...opts }); return { ...r, ...v, stage: r.rt.caches.three }; };
const play = (h, steps, frames = steps) => { for (let i = 0; i < Math.max(steps, frames); i++) { if (i < steps) h.rt.step({}); if (i < frames) h.frame(0.5); } };

test('every three instance in v2/games preflights with zero param errors', () => {
  const registry = new Registry([...PRIMITIVES]), logic = buildLogic(registry, Logic);
  for (const [name, doc] of GAMES) {
    const r = preflight(doc, registry, logic);
    const mine = new Set((doc.graphics || []).map((g, i) => MINE.has(g.use) ? `graphics[${i}]` : null).filter(Boolean));
    const errs = r.errors.filter(e => [...mine].some(p => e.path === p || e.path.startsWith(p + '.')) && e.code !== 'capability_missing' && e.code !== 'service_missing');
    assert.deepEqual(errs, [], `${name}: ${errs.map(e => `${e.code} ${e.path} ${e.message}`).join('; ')}`);
    const models = r.errors.filter(e => e.path.startsWith('content.models'));
    assert.deepEqual(models, [], `${name} models`);
  }
});

test('preflight rejects bad configs with stable codes', () => {
  const cases = [
    ['graphics.render.voxel', { meshBudgetMs: 100 }, 'param_range'], ['graphics.material.palette', { colors: { stone: 'red' } }, 'param_pattern'],
    ['graphics.material.palette', { style: 'chrome' }, 'param_option'], ['graphics.anim.clips', { presets: ['xyzzy'] }, 'clip_unknown'],
    ['graphics.anim.clips', { clips: [{ id: 'c', dur: 1, keys: { spine: [[2, 0, 0, 0]] } }] }, 'clip_keys'], ['graphics.anim.locomotion', { idleWalkRun: [3, 1, 2] }, 'speeds_order'],
    ['graphics.terrain.procedural', { splat: [{ color: '#112233' }] }, 'splat_rule'], ['graphics.terrain.procedural', { fog: { near: 900, far: 100 } }, 'fog_range'],
    ['graphics.rig.humanoid', { attach: [{ bone: 'handR' }] }, 'attach_empty'], ['graphics.rig.humanoid', { attach: [{ bone: 'tail', slot: 'x' }] }, 'param_option'],
    ['graphics.sky', { palette: { day: 'blue' } }, 'param_pattern'], ['graphics.camera.first-person', { fov: 200 }, 'param_range'],
    ['graphics.camera.third-person', { shoulder: 'up' }, 'param_option'], ['graphics.render.mesh3d', { shadows: 'ultra' }, 'param_option'],
    ['graphics.foliage.scatter', { windSway: -1 }, 'param_range'], ['graphics.anim.ik', { iterations: 0 }, 'param_range'],
    ['graphics.anim.secondary', { chains: [{ bones: [] }] }, 'param_range'], ['graphics.anim.ragdoll', { maxActive: 0 }, 'param_range'],
    ['graphics.camera.isometric', { angle: 95 }, 'param_range'], ['graphics.rig.quadruped', { legLength: 0 }, 'param_range'],
  ];
  const registry = new Registry([...PRIMITIVES, ...EXTRA]), logic = buildLogic(registry, Logic);
  for (const [use, w, code] of cases) {
    const doc = meshDoc(); doc.graphics = [{ use, with: w }];
    const r = preflight(doc, registry, logic);
    assert.ok(r.errors.some(e => e.code === code), `${use} ${JSON.stringify(w)} -> ${code}; got ${r.errors.map(e => e.code).join(',')}`);
  }
  const bad = voxelDoc(); bad.content.models.broken = { kind: 'voxel', size: [4, 4, 4], palette: { a: '#fff' }, parts: [{ box: [0, 0, 0], c: 'a' }] };
  // A voxel part's box length and a lowpoly part's shape are declared on content.models (model-lib.js): the section shape
  // check reports them; what a kind requires stays a rule.
  const found = r => [...r.errors, ...r.warnings];
  assert.ok(found(preflight(bad, registry, logic)).some(e => e.code === 'param_range' && e.path === 'content.models.broken.parts[0].box'));
  const bad1 = voxelDoc(); bad1.content.models.broken = { kind: 'voxel', size: [4, 4, 4], parts: [{ c: '#fff' }] };
  assert.ok(preflight(bad1, registry, logic).errors.some(e => e.code === 'model_part'));
  const bad2 = meshDoc(); bad2.content.models.broken = { kind: 'lowpoly', parts: [{ shape: 'torus', at: [0, 0, 0], size: [1, 1, 1] }] };
  assert.ok(found(preflight(bad2, registry, logic)).some(e => e.code === 'param_option' && e.path === 'content.models.broken.parts[0].shape'));
  const bad3 = meshDoc(); bad3.content.models.broken = { kind: 'lowpoly', parts: [{ at: [0, 0, 0], size: [1, 1, 1] }] };
  assert.ok(preflight(bad3, registry, logic).errors.some(e => e.code === 'model_shape'));
});

test('voxel world: chunks mesh within budget, actors are rigged and animated, edits re-mesh their chunk', () => {
  const h = make(voxelDoc());
  h.rt.spawn('cow', { space: 'w', at: [14, 6, 14] }); h.rt.spawn('sedan', { space: 'w', at: [6, 6, 20] }); h.rt.spawn('goblin', { space: 'w', at: [16, 6, 8] });
  play(h, 40, 60);
  const s = h.stage, v = s.stats.voxel;
  assert.ok(v.chunks >= 4 && v.queued === 0, `chunks ${v.chunks} queued ${v.queued}`);
  assert.ok(v.meshMs > 0 && v.quads > 0);
  const player = s.actors.get('player');
  assert.ok(player.bones?.get('upperLegL') && player.rig.fitted, 'voxel humanoid is rigged from its parts');
  assert.ok(Object.keys(player.anim.loco.weights).some(k => /walk|run/.test(k)), JSON.stringify(player.anim.loco));
  assert.notEqual(player.bones.get('upperLegL').rotation.x, 0, 'legs swing');
  const sedan = [...s.actors.values()].find(a => a.entity?.archetype === 'sedan');
  assert.ok(sedan.spin.length >= 4, 'wheels are spin nodes');
  const goblin = [...s.actors.values()].find(a => a.entity?.archetype === 'goblin');
  // (Corrected fixture: the goblin was an 'enemy' whose plan came from its id not matching any word; an enemy's plan now
  // varies among the enemy plans by its id seed, so the humanoid rig is checked on an npc, which is always humanoid.)
  assert.equal(goblin.template.spec.generated, 'humanoid', 'a model is generated for an archetype without one');
  assert.equal(goblin.rig?.kind, 'humanoid');
  // Edit: remove the top block under (20,8,20) -> its chunk re-meshes.
  const before = v.meshed;
  const api = h.rt.space('w');
  assert.equal(api.setCell([20, 8, 20], null, h.rt), true);
  play(h, 1, 1);
  assert.ok(v.meshed > before, 're-meshed after the edit');
  const restoreBefore = v.meshed, snap = h.rt.snapshot();
  h.rt.restore(snap); play(h, 1, 3);
  assert.ok(v.meshed > restoreBefore, 're-meshed after restore');
});

test('graphics never write state: snapshots with and without graphics are identical; replay is deterministic', () => {
  const headless = compile(voxelDoc(), { primitives: [...PRIMITIVES, ...EXTRA] }).rt;
  headless.space('w').getCell([0, 0, 0]); // the kernel test space initialises its state lazily on first read
  const a = make(voxelDoc()), b = make(voxelDoc());
  for (let i = 0; i < 90; i++) { headless.step({}); a.rt.step({}); b.rt.step({}); a.frame(0.3); b.frame(0.7); }
  const strip = s => { const c = structuredClone(s); return c; };
  assert.deepEqual(strip(a.rt.snapshot()), strip(headless.snapshot()));
  assert.deepEqual(a.rt.snapshot(), b.rt.snapshot());
  const m1 = make(meshDoc()), m2 = compile(meshDoc(), { primitives: [...PRIMITIVES, ...EXTRA] }).rt;
  for (let i = 0; i < 60; i++) { m1.rt.step({}); m2.step({}); m1.frame(0.5); }
  assert.deepEqual(m1.rt.snapshot(), m2.snapshot());
});

test('mesh3d world: LOD terrain, streamed objects (buildings, shapes, instanced props, foliage), roads, actors', () => {
  const h = make(meshDoc());
  for (const [a, at] of [['horse_ash', [24, 2, 22]], ['wolf', [22, 2, 26]], ['frost_wyrm', [30, 2, 10]], ['campfire', [21, 2, 21]], ['crow', [18, 3, 18]]]) h.rt.spawn(a, { space: 'realm', at });
  play(h, 20, 80);
  const s = h.stage;
  assert.ok(s.stats.terrain.patches > 4 && s.stats.terrain.queued === 0, JSON.stringify(s.stats.terrain));
  assert.ok(s.stats.terrain.grass > 0, 'grass instanced');
  assert.ok(s.stats.mesh3d.cells > 0 && s.stats.mesh3d.merged >= 2, JSON.stringify(s.stats.mesh3d));
  assert.equal(s.stats.mesh3d.roads, 1);
  assert.ok(s.scene.getObjectByName('foliage').children.some(c => c.isInstancedMesh && c.count > 0), 'trees went to foliage.scatter');
  assert.ok(s.scene.getObjectByName('water'), 'water plane');
  const sael = s.actors.get('player');
  assert.ok(sael.bones.get('cape_1'), 'cape spring chain bones');
  const horse = [...s.actors.values()].find(a => a.entity?.archetype === 'horse_ash');
  assert.equal(horse.rig.kind, 'quadruped');
  assert.ok(horse.anim.loco.weights.run || horse.anim.loco.weights.walk || horse.anim.loco.weights.sprint);
  const wyrm = [...s.actors.values()].find(a => a.entity?.archetype === 'frost_wyrm');
  assert.equal(wyrm.rig.kind, 'custom');
  assert.ok(sael.attachments.size >= 1, 'weapon attached');
});

test('anim: events trigger clips; defeat starts a ragdoll that settles; IK plants feet; springs move', () => {
  const h = make(meshDoc());
  const wolf = h.rt.spawn('wolf', { space: 'realm', at: [26, 2, 26] });
  play(h, 5, 5);
  const s = h.stage, sael = s.actors.get('player');
  h.rt.emit('attack', { who: 'player' });
  play(h, 1, 1);
  assert.ok(sael.anim.layers.some(l => /attack/.test(l.clip.id)), 'attack clip layered');
  const events = []; s.animListeners.push(e => events.push(e.event));
  play(h, 30, 30);
  assert.ok(events.includes('hit'), `frame event 'hit' fired: ${events.join()}`);
  assert.ok(events.includes('step'), 'footsteps from the gait');
  wolf.components.health.dead = true;
  h.rt.emit('defeated', { target: wolf.id });
  play(h, 1, 240);
  const wa = s.actors.get(wolf.id);
  assert.ok(wa.anim.ragdoll && wa.anim.ragdoll.body.asleep, 'ragdoll came to rest');
  const hips = new THREE.Vector3(); wa.bones.get('hips').getWorldPosition(hips);
  assert.ok(hips.y < s.groundAt('realm', hips.x, hips.z).y + 0.8, 'the body lies on the ground');
  // Springs: the cape bone rotates away from rest while moving.
  const cape = sael.bones.get('cape_1');
  assert.ok(Math.abs(cape.quaternion.x) + Math.abs(cape.quaternion.z) > 1e-4, 'cape chain is driven by springs');
});

test('cameras: third-person behind and above, swap to first-person at the eye, iso is orthographic; axes.camera published', () => {
  const h = make(voxelDoc());
  play(h, 10, 10);
  const s = h.stage, p = s.pose('player');
  const cam = s.camera.position;
  assert.ok(cam.y > p.at[1] + 1, 'above the player');
  assert.ok(Math.hypot(cam.x - p.at[0], cam.z - p.at[2]) > 1, 'behind at distance');
  assert.ok(Array.isArray(h.view.input().axes.camera), 'view yaw/pitch reach the step input');
  h.rt.step({ actions: { swap_camera: true } }); h.frame(0.5);
  assert.equal(s.cameras[s.activeCamera].view, '1p');
  assert.ok(s.firstPerson && !s.actors.get('player').root.visible, 'player model hidden in first person');
  assert.ok(Math.abs(s.camera.position.y - (s.pose('player').at[1] + 1.6)) < 0.3, 'eye height');
  const iso = voxelDoc(); iso.graphics = iso.graphics.filter(g => !/camera/.test(g.use)); iso.graphics.push({ use: 'graphics.camera.isometric', with: { angle: 35, zoom: 1 } }); iso.views.primary = 'iso';
  const hi = make(iso); play(hi, 3, 3);
  assert.ok(hi.stage.camera.isOrthographicCamera);
  const proj = hi.rt.service('camera').project(hi.stage.pose('player').at);
  assert.ok(proj && proj[0] > 0 && proj[0] < 640 && proj[1] > 0 && proj[1] < 360, `projects on screen ${proj}`);
});

test('camera collision pulls in before walls; 3D particle adapter spawns on bound events', async () => {
  const { clearDistance } = await import('../v2/primitives/graphics/three-camera.js');
  const h = make(voxelDoc());
  play(h, 2, 2);
  const d = clearDistance(h.stage, 'w', [20.5, 6.5, 23.5], [0, 0, -1], 6);
  assert.ok(d < 3.6 && d > 2, `log at z=20..21 blocks the view at ${d}`);
  assert.equal(clearDistance(h.stage, 'w', [20.5, 12, 23.5], [0, 0, -1], 6), 6, 'clear above the log');
  const handle = h.stage.adapters['graphics.particles'](h.rt, { budget: 500, presets: [{ id: 'break', shape: 'debris', color: '#9a9a9a', count: 16, life: 0.6, speed: 4, gravity: 12 }], bind: [{ event: 'block_mined', preset: 'break', at: 'target' }] });
  h.rt.emit('block_mined', { by: 'player', at: [10, 4, 10] });
  play(h, 0, 3);
  assert.equal(h.stage.stats.particles, 16);
  for (let i = 0; i < 60; i++) h.frame(0.5);
  assert.equal(h.stage.stats.particles, 0, 'they expire');
  handle.dispose();
});

test('sky: time.hour drives the sun, weather drives cover and precipitation', () => {
  const h = make(meshDoc());
  h.rt.state.vars['time.hour'] = 12; play(h, 1, 2);
  const noon = h.stage.sunDir.y;
  h.rt.state.vars['time.hour'] = 23.5; play(h, 1, 2);
  assert.ok(noon > 0.5 && h.stage.skyState.night > 0.8);
  h.rt.state.vars.weather = 'rain'; h.rt.state.vars['time.hour'] = 12;
  for (let i = 0; i < 400; i++) h.frame(0.5);
  assert.ok(h.stage.skyState.wet > 0.4);
  assert.ok(h.stage.scene.children.some(c => c.isLineSegments && c.visible), 'rain streaks');
});
