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
