// Flat renderers on the real 2D spaces with a recording canvas: each one
// preflights, draws while the game runs, never changes the simulation (state
// is identical to a headless run with the same seed and inputs, and drawing
// frames alone changes nothing), and rejects bad bindings with stable codes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../v2/kernel/testing.js';
import { preflight } from '../v2/kernel/document.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import spaces2d from '../v2/primitives/engine/spaces2d.index.js';
import spaceGraph from '../v2/primitives/engine/space-graph.js';
import flat from '../v2/primitives/graphics/flat.index.js';
import { docFor, mount, play, drawCalls, cellFiller, mover } from './v2-p-flat-stub.js';

const prim = id => flat.find(p => p.id === id);
const draws = c => (c.fill || 0) + (c.stroke || 0) + (c.drawImage || 0) + (c.fillRect || 0);
const CASES = [
  ['graphics.render.tilemap', 'tilemap', {}, ['graphics.camera.side', 'graphics.tileset.pixel']],
  ['graphics.render.tilemap', 'tilemap', { mode: 'topdown' }, ['graphics.camera.top-down']],
  ['graphics.render.grid', 'grid', {}, []],
  ['graphics.render.grid', 'grid', { topology: 'hex' }, []],
  ['graphics.render.grid', 'grid', { topology: 'iso' }, ['graphics.camera.isometric']],
  ['graphics.render.physics2d', 'physics2d', {}, []],
  ['graphics.render.arena2d', 'arena2d', { gravity: -30 }, ['graphics.camera.side']],
  ['graphics.render.arena2d', 'arena2d', {}, []],
  ['graphics.render.track', 'track', {}, []],
  ['graphics.render.dom', 'none', {}, []],
];

for (const [id, kind, spaceWith, extra] of CASES) {
  test(`${id} on ${kind} ${JSON.stringify(spaceWith)}: draws, interpolates and never writes state`, () => {
    const graphics = [{ use: id }, ...extra.map(use => ({ use }))];
    const doc = docFor(kind, { graphics, spaceWith });
    const m = mount(doc, flat);
    play(m, 75);
    const c = drawCalls(m.view);
    assert.ok(draws(c) > 50, `drew (${draws(c)} calls)`);
    assert.deepEqual([...m.rt.caches.flat.errors], [], 'no layer failed');
    // Frames alone never change the simulation.
    const before = JSON.stringify(m.rt.snapshot());
    for (let i = 0; i < 10; i++) m.view.frame(Math.random());
    assert.equal(JSON.stringify(m.rt.snapshot()), before);
    // Same seed and inputs: identical to a headless run (graphics skipped).
    const headless = compile(doc, { primitives: [...spaces2d, cellFiller, mover, ...flat], seed: 1 }).rt;
    for (let i = 0; i < 75; i++) headless.step({});
    assert.deepEqual(m.rt.snapshot(), headless.snapshot());
  });
}

test('renderers draw only while the player is in their space', () => {
  const doc = docFor('tilemap', { graphics: [{ use: 'graphics.render.tilemap' }, { use: 'graphics.render.grid', space: 'board' }] });
  doc.spaces.push({ id: 'board', use: 'engine.space.grid', with: { size: [6, 6] } });
  const m = mount(doc, flat);
  play(m, 5);
  const canvases = m.view.container.children.filter(c => c.getContext);
  assert.equal(canvases.length, 2);
  const shown = canvases.filter(c => c.style.display === 'block');
  assert.equal(shown.length, 1); assert.match(shown[0].className, /tilemap/);
  m.rt.moveToSpace(m.rt.player(), 'board', [2, 2]);
  play(m, 2);
  assert.match(canvases.find(c => c.style.display === 'block').className, /grid/);
});

test('cell edits invalidate cached chunks and grid pieces pop', () => {
  const m = mount(docFor('tilemap', { graphics: [{ use: 'graphics.render.tilemap' }] }), flat);
  play(m, 20);
  const S = m.rt.caches.flat.stages.get('world'), before = S.chunks.size;
  assert.ok(before > 0, 'chunks cached');
  m.rt.space('world').setCell([5, 1], null, m.rt);
  play(m, 10);
  assert.ok(S.chunks.size >= before, 'rebuilt after the edit');
});

test('renderer preflight: missing space and wrong binding have stable codes', () => {
  const registry = new Registry([...spaces2d, spaceGraph, ...flat]), logic = buildLogic(registry, Logic);
  const base = docFor('grid', { graphics: [{ use: 'graphics.render.tilemap' }] });
  const r1 = preflight(base, registry, logic);
  assert.ok(r1.errors.some(e => e.code === 'flat_no_space' && e.path === 'graphics[0]'));
  const r2 = preflight(docFor('grid', { graphics: [{ use: 'graphics.render.grid', with: { wallColor: 'blue' } }] }), registry, logic);
  assert.ok(r2.errors.some(e => e.code === 'flat_color' && e.path === 'graphics[0].with.wallColor'));
  const r3 = preflight(docFor('physics2d', { graphics: [{ use: 'graphics.render.physics2d', with: { materials: { crate: 'cheese' } } }] }), registry, logic);
  assert.ok(r3.errors.some(e => e.code === 'flat_material'));
  const twoSpaces = docFor('tilemap', { graphics: [{ use: 'graphics.render.grid', space: 'world' }] });
  twoSpaces.spaces.push({ id: 'board', use: 'engine.space.grid', with: { size: [4, 4] } });
  assert.ok(preflight(twoSpaces, registry, logic).errors.some(e => e.code === 'flat_space_kind'));
  const r4 = preflight(docFor('tilemap', { graphics: [{ use: 'graphics.render.tilemap', with: { scale: 12 } }] }), registry, logic);
  assert.ok(r4.errors.some(e => e.code === 'param_range'));
});

test('the 2D camera service projects world points for UI overlays', () => {
  const m = mount(docFor('tilemap', { graphics: [{ use: 'graphics.render.tilemap' }] }), flat);
  play(m, 10);
  const cam = m.rt.service('camera');
  assert.equal(cam.kind, '2d');
  const p = cam.projectEntity('player');
  assert.ok(p && p[0] >= 0 && p[0] <= 960 && p[1] >= 0 && p[1] <= 540, 'the player is on screen');
  assert.equal(cam.project([-500, -500]), null, 'off-screen points are null');
});
