// The renderer the host picks draws what the document's loops need a person to see (graphics/presentation.js):
// every loop with a win or lose declares card.loop.shows, consistent with what its card reads; every renderer declares
// card.draws; every template's host document passes the check (and a renderer short of what a loop shows fails it);
// and what the renderers declare they draw is drawn, over every template mounted as the host mounts it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES } from '../v2/templates/registry.js';
import { catalogue, PRIMITIVES } from '../v2/primitives/index.js';
import { hostDocument } from '../v2/web/host-doc.js';
import { cardLoop } from '../v2/planner/loop.js';
import { readsOf } from '../v2/planner/loop-check.js';
import { DRAWS, showsOf, drawsOf, mustShow, presentationProblems, shownZones, loopSpaces } from '../v2/primitives/graphics/presentation.js';
import { loopInstances } from '../v2/planner/loop.js';
import { Registry } from '../v2/kernel/registry.js';
import { mount } from './v2-p-ui-dom.js';

const { registry } = catalogue();
const contexts = el => { const out = []; const walk = n => { for (const c of n.children) { if (c._ctx) out.push(c._ctx); walk(c); } }; walk(el); return out; };
const canvasText = m => contexts(m.container).flatMap(c => c.calls.filter(([k]) => k === 'fillText').map(([, s]) => String(s)));
const play = (doc, frames = 30) => { const m = mount(hostDocument(doc, registry), { primitives: PRIMITIVES, seed: 1 }); m.key('Enter'); m.frame(frames); return m; };

test('every loop with a win or lose declares what a person must see, consistent with what its card reads', () => {
  let n = 0;
  for (const card of registry.cards()) {
    const shows = showsOf(card);
    if (!mustShow(card)) continue;
    n++;
    assert.ok(shows, `${card.id} has a win or lose and declares no card.loop.shows`);
    for (const x of shows) assert.ok(DRAWS.includes(x), `${card.id} shows '${x}', not one of ${DRAWS.join(', ')}`);
    const l = cardLoop(card), needs = l.needs.content;
    if (needs.includes('spaces.zones')) assert.ok(shows.includes('zones'), `${card.id} needs spaces.zones: a person must see its zones`);
    if (needs.includes('content.archetypes')) assert.ok(shows.includes('entities') || !l.space.some(s => s !== 'engine.space.none'), `${card.id} plays with archetypes: a person must see the entities`);
    for (const end of [l.win, l.lose]) if (readsOf(end)?.component && l.space.some(s => s !== 'engine.space.none')) assert.ok(shows.includes('entities'), `${card.id}'s end reads the ${readsOf(end).component} of entities: a person must see them`);
    if (card.marks) assert.ok(shows.includes('marks'), `${card.id} publishes marks: it shows them`);
  }
  assert.ok(n > 20);
});

test('every renderer declares what it draws', () => {
  const renderers = registry.ids('graphics').filter(id => id.startsWith('graphics.render.'));
  assert.ok(renderers.length >= 8);
  for (const id of renderers) {
    const d = drawsOf(registry.get(id).card, {});
    assert.ok(d, `${id} declares no card.draws`);
    for (const x of d) assert.ok(DRAWS.includes(x), `${id} draws '${x}', not one of ${DRAWS.join(', ')}`);
  }
});

test('a renderer short of what a loop shows fails the check, naming what is missing', () => {
  const race = TEMPLATES.find(t => t.id === 'race');
  const host = hostDocument(race.doc, registry);
  const track = registry.get('graphics.render.track');
  const short = new Registry(registry.ids().map(id => (id === 'graphics.render.track' ? { ...track, card: { ...track.card, draws: ['entities'] } } : registry.get(id))));
  const p = presentationProblems(host, short);
  assert.ok(p.some(x => x.code === 'render_missing' && x.use === 'gameplay.race' && x.missing.includes('zones')), JSON.stringify(p));
  const unlabelled = structuredClone(TEMPLATES.find(t => t.id === 'slide-merge').doc);
  delete unlabelled.content.blocks[0].label;
  assert.ok(presentationProblems(hostDocument(unlabelled, registry), registry).some(x => x.missing.includes('labels')));
});

for (const t of TEMPLATES) {
  test(`${t.id}: the host's renderers draw everything its loops show`, () => {
    const host = hostDocument(t.doc, registry);
    assert.deepEqual(presentationProblems(host, registry).map(p => p.message), []);
    const shows = new Set(loopInstances(host, registry).filter(l => loopSpaces(host, registry, l).some(s => !/space\.(none|graph)$/.test(s.use))).flatMap(l => showsOf(l.card) || []));
    if (!shows.size) return;
    const m = play(t.doc), text = canvasText(m);
    // Zones: each zone the loops name is drawn with its name (a gate, an outlined area) while it is in view.
    if (shows.has('zones')) {
      const zones = host.spaces.flatMap(s => s.zones || []).filter(z => shownZones(host, registry).has(z.id));
      assert.ok(zones.length, 'the loops name zones');
      assert.ok(zones.some(z => text.includes(z.name)), `no zone name drawn (zones ${zones.map(z => z.name).join(', ')}; text ${text.slice(0, 8).join(' | ')})`);
    }
    // Labels: every label of a block on the board is drawn on it.
    if (shows.has('labels')) {
      const api = m.rt.space(host.spaces[0].id), [W, H] = api.size, present = new Set();
      for (const c of api.cellsIn([[0, 0], [W - 1, H - 1]])) if (c.block != null) present.add(c.block);
      assert.ok(present.size, 'tiles on the board');
      for (const b of present) { const label = host.content.blocks.find(x => x.id === b)?.label; assert.ok(text.includes(String(label)), `the label '${label}' of block '${b}' is drawn`); }
    }
  });
}

test('farm: the crops a person plants are drawn on the field (card.marks)', () => {
  const farm = TEMPLATES.find(t => t.id === 'farm');
  const ellipses = m => contexts(m.container).reduce((n, c) => n + c.calls.filter(([k]) => k === 'ellipse').length, 0);
  const reset = m => { for (const c of contexts(m.container)) c.calls.length = 0; };
  // Two plays to the same frame: one tills and plants the faced cell through the farming verbs, the other idles.
  const planted = play(farm.doc, 2), idle = play(farm.doc, 2);
  const api = planted.rt.space(planted.rt.player().space), at = planted.rt.player().at;
  const cell = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [2, 0]].map(([dx, dy]) => [at[0] + dx, at[1] + dy]).find(c => api.getCell(c) === 'grass');
  for (const verb of ['till', 'plant']) { planted.frame(1, { actions: { [verb]: { cell } } }); idle.frame(1); }
  const marks = planted.rt.service('farming').marks(planted.rt.player().space);
  assert.ok(marks.length === 1 && marks[0].stage === 0 && marks[0].ready === false, JSON.stringify(marks));
  assert.equal(idle.rt.service('farming').marks(idle.rt.player().space).length, 0);
  reset(planted); reset(idle); planted.frame(1); idle.frame(1);
  // drawMark: a stem and two leaves per plot.
  assert.ok(ellipses(planted) >= ellipses(idle) + 2, `the plot is drawn (${ellipses(planted)} ellipses with it, ${ellipses(idle)} without)`);
});

// Whose side an entity is on is drawn (kernel/sides.js, from card.sides): over every template whose primitives put
// entities on sides, the player's side reads as allies and the other side as enemies.
test('sides: the player\'s side and the other side are drawn apart, in every template with sides', async () => {
  const { sideOf } = await import('../v2/kernel/sides.js');
  const { lookOf } = await import('../v2/primitives/graphics/flat-models.js');
  let n = 0;
  for (const t of TEMPLATES) {
    const host = hostDocument(t.doc, registry);
    if (!host.systems.some(s => registry.get(s.use)?.card?.sides)) continue;
    const m = play(t.doc, 5), H = m.rt.caches.flat;
    if (!H) continue; // drawn by the DOM scene card only
    const sided = Object.values(m.rt.state.entities).filter(e => e.id !== 'player').map(e => ({ e, side: sideOf(m.rt, e) })).filter(x => x.side);
    const mine = sided.filter(x => x.side.mine), theirs = sided.filter(x => !x.side.mine);
    assert.ok(theirs.length, `${t.id}: entities on the other side`);
    for (const { e } of theirs) { const L = lookOf(H, e, 'td'); assert.ok(L.role === 'enemy' || L.side === false, `${t.id}: ${e.id} is on the other side and reads as ${L.role}`); }
    for (const { e } of mine) { const L = lookOf(H, e, 'td'); assert.ok(L.role !== 'enemy' && L.side === true, `${t.id}: ${e.id} is on the player's side and reads as ${L.role}`); }
    n++;
  }
  assert.ok(n >= 3, `templates with sides checked: ${n}`);
});

// A person can see the game as the host mounts it: no renderer layer fails (flat-stage swallows a throwing layer, so a
// failure would only show as something missing), the renderer serves the document's view, the player is on screen and
// large enough to read, and the camera keeps the player in view after it crosses the space.
const MIN_BODY_PX = 12;
for (const t of TEMPLATES) {
  test(`${t.id}: the view the host mounts shows the player, readable, wherever it goes`, async () => {
    const { rendererOf } = await import('../v2/primitives/graphics/presentation.js');
    const host = hostDocument(t.doc, registry);
    const view = host.views?.primary;
    for (const s of host.spaces) {
      const r = rendererOf(host, registry, s), views = r ? registry.get(r.use).card.views || [] : [];
      if (r && view) assert.ok(views.includes(view) || views.includes('any') || (r.use === 'graphics.render.dom' && ['ui', 'text'].includes(view)), `${r.use} draws ${views.join(', ')}, not the document's view '${view}'`);
    }
    const m = play(t.doc, 60), H = m.rt.caches.flat;
    assert.deepEqual([...(H?.errors || [])], [], 'no renderer layer failed');
    const inView = (F, what) => { const s = F.toScreen(F.playerPos); assert.ok(s[0] >= 0 && s[0] <= F.w && s[1] >= 0 && s[1] <= F.h, `${what}: the player is drawn at ${s.map(Math.round)}, outside the ${Math.round(F.w)}x${Math.round(F.h)} view`); };
    const F = H?.lastFrame, p = m.rt.player();
    if (!F?.playerPos || !p || !Array.isArray(p.at)) return; // no avatar in a drawn world (boards, menus, cards)
    inView(F, 'at the start');
    const size = p.components?.body?.size || [1, 1];
    assert.ok(F.unit * Math.max(size[0], size[1] ?? size[0]) >= MIN_BODY_PX, `the player is ${(F.unit * Math.max(size[0], size[1] ?? size[0])).toFixed(1)} px across (at least ${MIN_BODY_PX})`);
    const api = m.rt.space(p.space), sz = Array.isArray(api.size) ? api.size : null;
    if (!sz || api.kind === 'track') return; // the track's camera rides behind the player by construction
    api.setPos(p, [Math.max(1, sz[0] - 2), Math.max(1, (sz[1] ?? 2) - 2), ...(p.at.length > 2 ? [p.at[2]] : [])], m.rt);
    m.frame(60);
    inView(H.lastFrame, 'after crossing the space');
  });
}

// The three.js renderers draw the zones the loops name (three-zones.js, called from render-mesh3d and render-voxel's
// world hooks): one outlined column per zone, rebuilt when the document changes.
test('3D: the zones a race names on a heightfield are marked, each named', async () => {
  const THREE = await import('three');
  const { syncZones } = await import('../v2/primitives/graphics/three-zones.js');
  const zones = [{ id: 'gate_a', name: 'Gate A', center: [10, 10], r: 4 }, { id: 'gate_b', name: 'Gate B', bounds: { min: [30, 0, 30], max: [36, 4, 34] } }, { id: 'scenery', center: [50, 50], r: 3 }];
  const doc = { spaces: [{ id: 'world', use: 'engine.space.mesh3d', with: {}, zones }], systems: [{ use: 'gameplay.race', with: { checkpoints: ['gate_a', 'gate_b'], laps: 2 } }] };
  const root = new THREE.Group(), state = {};
  const g = syncZones({ doc, registry }, THREE, root, 'world', () => 1, state);
  assert.deepEqual(g.children.map(c => c.name), ['zone:gate_a', 'zone:gate_b'], 'the zones the race names, not the scenery zone');
  assert.ok(root.children.includes(g));
  assert.equal(syncZones({ doc, registry }, THREE, root, 'world', () => 1, state), g, 'kept while the document is the same');
  assert.equal(drawsOf(registry.get('graphics.render.mesh3d').card, {}).includes('zones') && drawsOf(registry.get('graphics.render.voxel').card, {}).includes('zones'), true);
});
