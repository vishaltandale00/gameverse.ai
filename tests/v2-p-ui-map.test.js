import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, run } from '../v2/kernel/testing.js';
import { preflight } from '../v2/kernel/document.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import map, { zoneInDirection, canTravel } from '../v2/primitives/graphics/ui-map.js';
import minimap, { minimapView } from '../v2/primitives/graphics/ui-minimap.js';
import { mapModel, visitedZones } from '../v2/primitives/graphics/ui-cartography.js';
import { spaceGeometry, graphLayout, zoneShape, heading } from '../v2/primitives/graphics/ui-spatial.js';
import spaceGraph from '../v2/primitives/engine/space-graph.js';
import { mount } from './v2-p-ui-dom.js';
import { baseDoc, BASE, actions, gameInstances, ownErrors } from './v2-p-ui-fixtures.js';

const zones = [
  { id: 'town', name: 'Old Town', rect: [0, 0, 8, 8], tags: ['town', 'start'] },
  { id: 'woods', name: 'Whisper Woods', rect: [8, 0, 16, 8], tags: ['forest'] },
  { id: 'peak', name: 'Frost Peak', rect: [0, 8, 8, 16], tags: ['snow', 'shrine'] },
];
const content = { archetypes: [{ id: 'hero', kind: 'player', components: {} }, { id: 'wolf', kind: 'enemy', components: { health: { max: 3 } } }, { id: 'clerk', kind: 'npc', tags: ['shop'], components: {} }] };
const P = [...BASE, map, minimap, actions(['fast_travel'])];
const doc = (g = [{ use: 'graphics.ui.map', with: { fastTravel: true, markers: [{ tag: 'enemy', color: '#f44' }] } }]) => baseDoc({ zones, content, systems: [{ use: 'gameplay.fixture.actions' }], graphics: g });

test('spatial: every zone description becomes plane geometry; graphs get a layered layout', () => {
  assert.deepEqual(zoneShape({ rect: [0, 0, 2, 2] }, 'xy').points, [[0, 0], [2, 0], [2, 2], [0, 2]]);
  assert.deepEqual(zoneShape({ bounds: { min: [-10, 0, 100], max: [10, 50, 200] } }, 'xz').points, [[-10, -200], [10, -200], [10, -100], [-10, -100]]);
  assert.equal(zoneShape({ bounds: { center: [5, 5], r: 3 } }, 'xz').kind, 'circle');
  const g = spaceGeometry({ use: 'engine.space.voxel', zones: [{ id: 'a', bounds: { min: [0, 0, 0], max: [10, 10, 10] } }] });
  assert.equal(g.plane, 'xz');
  const pos = graphLayout([{ id: 'hall', exits: [{ to: 'study' }, { to: 'cellar' }] }, { id: 'study', exits: [{ to: 'hall' }] }, { id: 'cellar' }, { id: 'attic' }], 'hall');
  assert.equal(pos.hall[0], 0); assert.equal(pos.study[0], 10); assert.equal(pos.cellar[0], 10); assert.notEqual(pos.study[1], pos.cellar[1]);
  assert.deepEqual(graphLayout([{ id: 'x', exits: [{ to: 'y' }] }, { id: 'y' }], 'x'), graphLayout([{ id: 'x', exits: [{ to: 'y' }] }, { id: 'y' }], 'x'), 'deterministic');
  assert.equal(heading({ components: { body: { facing: -1 } } }, 'xy'), -Math.PI / 2);
  assert.ok(Math.abs(heading({ components: { body: { facing: [0, 0, -1] } } }, 'xz')) < 1e-9, '3D facing -z is north');
});

test('map model: fog by discovery, current zone, markers by tag and kind, direction cursor', () => {
  const { rt } = compile(doc(), { primitives: P });
  rt.spawn('wolf', { at: [12, 2, 0] }); rt.spawn('clerk', { at: [2, 2, 0] });
  run(rt, 1);
  let m = mapModel(rt, { fog: true, markers: [{ tag: 'enemy', color: '#f44' }, { tag: 'shop', color: '#4f4' }] });
  assert.deepEqual(m.zones.map(z => [z.id, z.discovered, z.current]), [['town', true, true], ['woods', false, false], ['peak', false, false]]);
  assert.deepEqual(m.markers.map(x => x.tag).sort(), ['enemy', 'shop']);
  assert.deepEqual(m.player.pos, [1.5, 1.5], 'body centre, honouring the space anchor');
  const visited = visitedZones(rt);
  rt.run([{ do: 'teleport', zone: 'peak' }]); rt.run([{ do: 'teleport', zone: 'town' }]);
  m = mapModel(rt, { fog: true, visited });
  assert.equal(m.zones.find(z => z.id === 'peak').discovered, true);
  assert.equal(zoneInDirection(m.zones, 'town', 'right'), 'woods');
  assert.equal(zoneInDirection(m.zones, 'town', 'up'), 'peak');
  assert.equal(zoneInDirection(m.zones, 'town', 'left'), null);
  const cfg = { fastTravel: true, travelTags: [] };
  assert.equal(canTravel(rt, m.zones.find(z => z.id === 'peak'), cfg, 'town'), true, 'discovered shrine is a travel point');
  assert.equal(canTravel(rt, m.zones.find(z => z.id === 'woods'), cfg, 'town'), false);
});

test('minimap: centred transform, heading-up rotation', () => {
  const { rt } = compile(doc(), { primitives: P });
  const v = minimapView(rt, { radius: 4, rotate: true, markers: [], quests: true }, 100);
  assert.deepEqual([v.tf.ou, v.tf.ov, v.tf.scale], [1.5, 1.5, 12.5]);
  rt.player().components.body = { facing: 1 };
  assert.equal(minimapView(rt, { radius: 4, rotate: true, markers: [] }, 100).tf.rot, Math.PI / 2);
});

test('map: opens on M, moves the cursor with the D-pad, fast travels via view.act; minimap draws', () => {
  const m = mount(doc([{ use: 'graphics.ui.map', with: { fastTravel: true } }, { use: 'graphics.ui.minimap', with: { radius: 10 } }]), { primitives: P });
  m.frame(1, { actions: { fx: [{ do: 'teleport', zone: 'peak' }] } });
  m.frame(1, { actions: { fx: [{ do: 'teleport', zone: 'town' }] } });
  assert.ok(m.q('.gv-minimap canvas')._ctx.calls.some(c => c[0] === 'arc'), 'minimap painted');
  assert.equal(m.text('.gv-minimap-label'), 'Old Town');
  m.key('m'); m.frame(1);
  assert.equal(m.view.modal, 'map');
  assert.match(m.text('.gv-map-info'), /You are here[\s\S]*Old Town/);
  m.key('ArrowUp'); m.frame(1);
  assert.match(m.text('.gv-map-info'), /Frost Peak[\s\S]*Travel here/);
  m.key('Enter'); m.frame(1);
  assert.deepEqual(m.acts.at(-1), { fast_travel: 'peak' });
  assert.equal(m.view.modal, null, 'map closes after travelling');
  assert.deepEqual(m.rt.state.prim['fixture.actions'].fast_travel, ['peak']);
});

test('map: graph spaces get a node map', () => {
  const d = { schema: 'gameverse.v2.game/0.2', id: 'g', title: 'G', spaces: [{ id: 'house', use: 'engine.space.graph', zones: [{ id: 'hall', name: 'Hall', exits: [{ to: 'study' }] }, { id: 'study', name: 'Study', exits: [{ to: 'hall' }] }] }], content: { archetypes: [{ id: 'p', kind: 'player', components: {} }] }, player: { archetype: 'p' }, systems: [], graphics: [] };
  const { rt } = compile(d, { primitives: [spaceGraph, map] });
  const m = mapModel(rt, { fog: true });
  assert.equal(m.graph, true); assert.equal(m.edges.length, 1);
  assert.deepEqual(m.zones.map(z => z.discovered), [true, false]);
});

test('map/minimap: state-neutral, bad configs, game instances', () => {
  const g = [{ use: 'graphics.ui.map' }, { use: 'graphics.ui.minimap' }];
  const a = mount(doc(g), { primitives: P }); a.frame(2); a.key('m'); a.key('ArrowRight'); a.key('Escape'); a.frame(2);
  const { rt } = compile(doc(g), { primitives: P }); run(rt, 4);
  assert.deepEqual(a.rt.snapshot(), rt.snapshot());
  const codes = gr => { try { compile(doc(gr), { primitives: P }); return []; } catch (e) { return e.errors.map(x => x.code); } };
  assert.ok(codes([{ use: 'graphics.ui.minimap', with: { markers: [{ tag: 'a' }, { tag: 'a' }] } }]).includes('ui_marker_duplicate'));
  assert.ok(codes([{ use: 'graphics.ui.minimap', with: { shape: 'hex' } }]).includes('param_option'));
  assert.ok(codes([{ use: 'graphics.ui.map', with: { markers: [{ color: '#fff' }] } }]).includes('param_missing'));
  const registry = new Registry(P), logic = buildLogic(registry, Logic);
  for (const use of ['graphics.ui.map', 'graphics.ui.minimap']) {
    const list = gameInstances(use); assert.ok(list.length >= 2, use);
    for (const { file, doc: d } of list) assert.deepEqual(ownErrors(preflight(d, registry, logic).errors), [], `${use} ${file}`);
  }
});
