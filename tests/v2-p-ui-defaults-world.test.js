// Host defaults for world presentation: a document whose graphics[] is empty still gets a renderer
// bound to each of its spaces (and the camera its view asks for), so no space renders blank.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { preflight } from '../v2/kernel/document.js';
import { catalogue } from '../v2/primitives/index.js';
import { defaultGraphics, rendererFor, isTextual } from '../v2/primitives/graphics/ui-defaults.js';

const { registry, logic } = catalogue();
const minimal = (use, primary, extra = {}) => ({ schema: 'gameverse.v2.game/0.2', id: 'm', title: 'M', views: { primary }, spaces: [{ id: 'main', use }], systems: [], graphics: [], ...extra });
const VIEW = { tilemap: 'side', grid: 'board', physics2d: 'side', arena2d: 'side', track: '3p', graph: 'text', none: 'ui', voxel: '1p', mesh3d: '3p' };
const spaceIds = registry.ids('engine').filter(id => id.startsWith('engine.space.') && id !== 'engine.space.test');

test('world defaults: every registered space kind gets a renderer bound to it', () => {
  assert.ok(spaceIds.length >= 7, 'the 2D, graph and none spaces are registered');
  for (const use of spaceIds) {
    const kind = use.slice('engine.space.'.length);
    const g = defaultGraphics(minimal(use, VIEW[kind] || 'td'), registry);
    const r = g.find(x => /^graphics\.render\./.test(x.use));
    assert.ok(r, `${use}: a renderer`);
    assert.equal(r.space, 'main', `${use}: bound to its space`);
    assert.equal(r.use, rendererFor({ use }, registry));
    assert.ok(g.indexOf(r) < g.findIndex(x => x.use.startsWith('graphics.ui.')), `${use}: drawn beneath the UI`);
    const errs = preflight({ ...minimal(use, VIEW[kind] || 'td'), graphics: g }, registry, logic).errors.filter(e => e.path?.startsWith('graphics') && /^(param_|flat_|iso_)/.test(e.code));
    assert.deepEqual(errs, [], `${use}: defaults preflight`);
  }
});

test('world defaults: the camera follows views.primary and the renderer card', () => {
  const pick = (use, primary, spaceWith) => defaultGraphics(minimal(use, primary, spaceWith ? { spaces: [{ id: 'main', use, with: spaceWith }] } : {}), registry).map(g => g.use);
  assert.ok(pick('engine.space.grid', 'iso').includes('graphics.camera.isometric'), 'iso board -> isometric camera');
  for (const [use, v] of [['engine.space.tilemap', 'side'], ['engine.space.grid', 'board'], ['engine.space.arena2d', 'side'], ['engine.space.physics2d', 'td']]) {
    const g = pick(use, v);
    assert.ok(!g.some(u => u.startsWith('graphics.camera.')), `${use}/${v}: the canvas renderer frames its own space`);
    assert.ok(g.includes('graphics.particles') && g.includes('graphics.fx.feedback') && g.includes('graphics.post'), `${use}: juice and post`);
  }
  assert.ok(!pick('engine.space.track', '3p').some(u => u.startsWith('graphics.camera.')), 'pseudo-3D track keeps its chase camera');
  // three.js renderers get the camera rig for their view (when those spaces are registered).
  const r3 = { id: 'graphics.render.fake3d', card: { intent: 'x', views: ['1p', '3p', 'iso'], provides: { services: ['camera'] } } };
  const sp = { id: 'engine.space.fake3d', card: { intent: 'x', params: {}, provides: {} } };
  const withFake = catalogue([r3, sp]).registry;
  for (const [v, cam] of [['1p', 'graphics.camera.first-person'], ['3p', 'graphics.camera.third-person'], ['iso', 'graphics.camera.isometric']])
    assert.ok(defaultGraphics(minimal('engine.space.fake3d', v), withFake).some(g => g.use === cam && g.space === 'main'), `3D ${v} -> ${cam}`);
});

test('world defaults: graph and none get the DOM scene before the story; listed renderers are kept', () => {
  const g = defaultGraphics(minimal('engine.space.graph', 'text'), registry).map(x => x.use);
  assert.ok(g.indexOf('graphics.render.dom') >= 0 && g.indexOf('graphics.render.dom') < g.indexOf('graphics.ui.story'));
  assert.equal(isTextual({ spaces: [{ use: 'engine.space.graph' }], graphics: [{ use: 'graphics.render.dom' }] }), true, 'the scene card keeps a text game textual');
  const listed = defaultGraphics(minimal('engine.space.tilemap', 'side', { graphics: [{ use: 'graphics.render.tilemap', with: {} }] }), registry);
  assert.ok(!listed.some(x => x.use === 'graphics.render.tilemap'), 'a listed renderer is not doubled');
  const two = defaultGraphics({ ...minimal('engine.space.tilemap', 'side'), spaces: [{ id: 'a', use: 'engine.space.tilemap' }, { id: 'b', use: 'engine.space.tilemap' }] }, registry);
  assert.deepEqual(two.filter(x => x.use === 'graphics.render.tilemap').map(x => x.space), ['a', 'b'], 'one renderer per space');
});

test('world defaults: example games with graphics emptied get a renderer for every space', () => {
  for (const f of fs.readdirSync(new URL('../v2/games/', import.meta.url))) {
    const d = { ...JSON.parse(fs.readFileSync(new URL(`../v2/games/${f}`, import.meta.url), 'utf8')), graphics: [] };
    const g = defaultGraphics(d, registry);
    for (const s of d.spaces) if (rendererFor(s, registry)) assert.ok(g.some(x => x.space === s.id && /^graphics\.render\./.test(x.use)), `${f}: ${s.id}`);
  }
});
