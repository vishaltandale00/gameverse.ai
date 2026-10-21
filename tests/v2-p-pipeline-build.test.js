// The iterative build of the primitive collection (v2/planner/build.js): the space first, then one mechanic at a
// time, each pick checked (closure, composition, adapters, content contracts) before the next. Scripted fake writers;
// test primitives and the real catalogue; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSelection, worklist, loopMechanicOf, spaceCandidates, dependencyLayers, MAX_CANDIDATES } from '../v2/planner/build.js';
import { selectPrimitives, servesInteraction } from '../v2/planner/select.js';
import { checkComposition } from '../v2/planner/compose-check.js';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { normalize } from '../v2/planner/decompose.js';
import { testCatalogue, fakeWriter, buildAnswer } from './v2-p-pipeline-fixtures.js';

/** Test loops: each declares what it is played with (card.loop), nothing else is assumed. */
const loopCard = (id, intent, loop, extra = {}) => ({ id, card: { intent, params: {}, loop, provides: { actions: loop.verbs || [], events: loop.progress || [] }, ...extra }, install() {} });
const hop = loopCard('gameplay.test.hop', 'Hop over gaps between platforms.', { verbs: ['hop'], progress: ['hopped'] });
/** Gliding needs lift; the lift adapter fits the flat field but cannot project it there (its adapt() proposes nothing). */
const glide = loopCard('gameplay.test.glide', 'Glide down slowly on warm air.', { verbs: ['glide'], progress: ['glided'] }, { requires: { capabilities: ['lift'] } });
const lift = { id: 'engine.adapt.test.lift', card: { intent: 'Projects lift onto a flat field.', params: {}, adapts: { provides: { capabilities: ['lift'] }, from: { spaces: ['engine.space.flatx'] }, projection: 'warm air columns over cells' } }, adapt() { return null; }, install() {} };
const float = loopCard('gameplay.test.float', 'Float and glide down gently with an umbrella.', { verbs: ['float', 'glide'], progress: ['floated'] });
/** Scoring requires the inventory (its requirements closure). */
const score = loopCard('gameplay.test.score', 'Score points for every hop landed.', { verbs: [], progress: ['scored'] }, { requires: { primitives: ['gameplay.inventory'] } });
/** Wormhole travel: no space provides wormholes and no adapter projects them. */
const wormholes = loopCard('gameplay.test.wormholes', 'Warp through wormholes between distant stars.', { verbs: ['warp'], progress: ['warped'] }, { requires: { capabilities: ['wormholes'] } });
const catalogue = () => testCatalogue([hop, glide, lift, float, score, wormholes]);

const spec = () => normalize({ title: 'Hopper', premise: 'Hop, glide and score across a flat field.', tone: 'bright', references: [{ name: 'hopper', kind: 'game', keeps: [] }],
  mechanics: [
    { id: 'score', verb: 'score', description: 'score points for every hop landed', from: 'hopper', importance: 'supporting' },
    { id: 'hop', verb: 'hop', description: 'hop over gaps between platforms', from: 'hopper', importance: 'core' },
    { id: 'glide', verb: 'glide', description: 'glide down slowly', from: 'hopper', importance: 'core' },
    { id: 'warp', verb: 'warp', description: 'warp through wormholes between distant stars', from: 'hopper', importance: 'supporting' },
  ], spaces: [{ role: 'field', kind: 'continuous-2d', description: '' }], views: ['td'], movement: 'ground', acts: 1, zones: 2 }, 'hopper');

const picks = { hop: ['gameplay.test.hop'], glide: ['gameplay.test.glide', 'gameplay.test.float'], score: ['gameplay.test.score'], warp: ['gameplay.test.wormholes'] };
/** The scripted model: the flat field, then per mechanic the first preferred id still on offer. */
const writer = () => fakeWriter([req => buildAnswer(req, { space: ['engine.space.flatx'], picks }) ?? '{}']);

test('the worklist starts from the core loop mechanic, then core, then supporting', () => {
  const d = spec();
  assert.equal(loopMechanicOf(d), 'hop');
  assert.deepEqual(worklist(d).map(m => m.id), ['hop', 'glide', 'score', 'warp']);
  assert.equal(loopMechanicOf({ ...d, core: { mashup: [], loop: 'glide' } }), 'glide', 'a play spec that names its loop mechanic is followed');
});

test('(a) the collection grows one mechanic at a time, with a composition check after every step', async () => {
  const { registry } = catalogue();
  const w = writer();
  const b = await buildSelection({ decomposition: spec(), registry, writer: w });
  assert.equal(b.space.use, 'engine.space.flatx');
  assert.equal(b.spaceStep.asked, true, 'several spaces show td: one small enum question');
  assert.deepEqual(b.steps.map(s => s.mechanic), ['hop', 'glide', 'score', 'warp']);
  assert.deepEqual(b.steps.map(s => s.collection), [
    ['gameplay.test.hop'],
    ['gameplay.test.hop', 'gameplay.test.float'],
    ['gameplay.test.hop', 'gameplay.test.float', 'gameplay.test.score', 'gameplay.inventory'],
    ['gameplay.test.hop', 'gameplay.test.float', 'gameplay.test.score', 'gameplay.inventory'],
  ]);
  // Every pick was checked as a whole collection; the closure is that card's only.
  for (const s of b.steps.filter(x => x.primitive)) assert.ok(s.checks && ['compatible', 'undeclared', 'compatible-via-adapter'].includes(s.checks.compose), JSON.stringify(s.checks));
  assert.deepEqual(b.steps[2].checks.closure, ['gameplay.inventory']);
  assert.deepEqual(b.steps[0].checks.closure, []);
  // One small strict question per mechanic (plus the space and the one re-ask), never the catalogue.
  assert.deepEqual(w.calls.map(c => c.schema.name), ['pick_space', 'pick_primitive', 'pick_primitive', 'pick_primitive', 'pick_primitive', 'pick_primitive']);
  assert.equal(b.calls, w.calls.length);
  for (const c of w.calls) {
    const field = c.schema.schema.properties.space || c.schema.schema.properties.pick;
    assert.ok(field.enum.length <= MAX_CANDIDATES + 1, `${field.enum.length} options`);
    assert.equal(c.schema.schema.additionalProperties, false);
    assert.ok(c.user.length < 2500, `${c.user.length} chars`);
  }
  // The mechanic with no fitting primitive is a gap with a signature for the gap layer.
  const warp = b.gaps.find(g => g.mechanic === 'warp');
  assert.equal(warp?.kind, 'no_primitive');
  assert.match(warp.signature, /^warp: a primitive whose loop/);
  assert.equal(b.mapping.warp.primitives.length, 0);
});

test('(b) a pick that fails its checks is dropped and the next candidate taken, without restarting', async () => {
  const { registry } = catalogue();
  const w = writer();
  const b = await buildSelection({ decomposition: spec(), registry, writer: w });
  const glideStep = b.steps.find(s => s.mechanic === 'glide');
  assert.deepEqual(glideStep.asks.map(a => [a.pick, a.ok]), [['gameplay.test.glide', false], ['gameplay.test.float', true]]);
  assert.match(glideStep.asks[0].problem, /needs an adapter no registered primitive provides/);
  // The re-ask names the exact problem and no longer offers the dropped pick; the earlier picks stand.
  const reask = w.calls.filter(c => c.schema.name === 'pick_primitive' && /\nMechanic glide /.test(c.user))[1];
  assert.match(reask.user, /Your pick gameplay\.test\.glide was dropped: needs an adapter/);
  assert.ok(!reask.schema.schema.properties.pick.enum.includes('gameplay.test.glide'));
  assert.match(reask.user, /Collection so far: gameplay\.test\.hop\n/);
  assert.equal(w.calls.filter(c => /\nMechanic hop /.test(c.user)).length, 1, 'the earlier mechanic is not asked again');
  assert.deepEqual(b.mapping.glide.primitives, ['gameplay.test.float']);
  assert.ok(!b.systems.includes('gameplay.test.glide'));
});

test('(c) the model is only ever offered candidates that already compose with the collection', async () => {
  const { registry } = catalogue();
  const w = writer();
  const b = await buildSelection({ decomposition: spec(), registry, writer: w });
  const keys = r => new Set([...r.failures.map(f => `${f.code}:${f.unit}`), ...r.holes.map(h => `${h.code}:${h.card}`)]);
  const asks = w.calls.filter(c => c.schema.name === 'pick_primitive');
  assert.ok(asks.length >= 4);
  for (const c of asks) {
    const before = /Collection so far: (.*)\n/.exec(c.user)[1];
    const systems = before === '(empty)' ? [] : before.split(', ');
    const space = { id: b.space.id, use: b.space.use, with: b.space.with };
    const base = keys(checkComposition({ spaces: [space], systems }, registry, { resolve: true }));
    for (const id of c.schema.schema.properties.pick.enum.filter(x => x !== 'none')) {
      const r = checkComposition({ spaces: [space], systems: [...systems, id] }, registry, { resolve: true });
      assert.deepEqual([...keys(r)].filter(k => !base.has(k)), [], `${id} offered with ${systems.join(', ')}`);
    }
  }
  // Wormhole travel never composes on the field: it is never on offer, and the step says why.
  assert.ok(!asks.some(c => c.schema.schema.properties.pick.enum.includes('gameplay.test.wormholes')));
  assert.match(b.steps.find(s => s.mechanic === 'warp').rejected.find(r => r.id === 'gameplay.test.wormholes').why, /wormholes/);
});

test('selectPrimitives with a model builds iteratively, keeps the space it built on and reports every step', async () => {
  const { registry } = catalogue();
  const sel = await selectPrimitives({ decomposition: spec(), registry, writer: writer() });
  assert.equal(sel.provider, 'build');
  assert.deepEqual(sel.spaces.map(s => s.use), ['engine.space.flatx']);
  assert.deepEqual(sel.build.steps.map(s => [s.mechanic, s.outcome]), [['hop', 'added'], ['glide', 'added'], ['score', 'added'], ['warp', 'gap']]);
  assert.deepEqual(sel.mechanics.find(m => m.id === 'glide').primitives, ['gameplay.test.float']);
  for (const id of ['gameplay.test.hop', 'gameplay.test.float', 'gameplay.test.score', 'gameplay.inventory']) assert.ok(sel.systems.includes(id), id);
  assert.ok(sel.gaps.some(g => g.mechanic === 'warp'));
  assert.equal(sel.build.calls, 6);
});

// (e) The same machinery on unrelated ideas, real catalogue: nothing here knows a genre.
const IDEAS = {
  sides: { premise: 'Two armies take turns moving pieces on a board to capture the enemy king.', ref: 'chess', views: ['board'], kind: 'board', movement: 'none',
    core: { interaction: 'pieces-turns', opponent: 'ai-side', win: 'capture the king', lose: 'lose the king', theme: 'war', narrative: false, mashup: [] },
    mechanics: [['move_pieces', 'core', 'move pieces across the board in turns'], ['capture', 'core', 'capture enemy pieces by moving onto them'], ['promote', 'supporting', 'promote a piece that reaches the far side']] },
  collect: { premise: 'Run around a maze collecting gems while ghosts chase you.', ref: 'gem maze', views: ['td'], kind: 'tiles-topdown', movement: 'ground',
    core: { interaction: 'avatar-realtime', opponent: 'hazards', win: 'collect every gem', lose: 'caught by a ghost', theme: 'neon', narrative: false, mashup: [] },
    mechanics: [['collect_gems', 'core', 'collect every gem in the maze'], ['evade', 'core', 'avoid the chasing ghosts'], ['power', 'supporting', 'eat power pellets to turn the tables']] },
  race: { premise: 'Race shopping carts around a supermarket track against rival racers.', ref: 'kart racing', views: ['3p'], kind: 'continuous-3d', movement: 'track',
    core: { interaction: 'avatar-realtime', opponent: 'ai-rival', win: 'finish first', lose: '', theme: 'supermarket', narrative: false, mashup: [] },
    mechanics: [['race', 'core', 'race laps around a track against rival racers'], ['drive', 'core', 'drive and steer a cart'], ['items', 'supporting', 'pick up and use items to hinder rivals']] },
};
const ideaSpec = (x, registry) => normalize({ title: x.ref, premise: x.premise, tone: x.core.theme, references: [{ name: x.ref, kind: 'game', keeps: [] }], views: x.views, movement: x.movement, acts: 1, zones: 3,
  spaces: [{ role: 'world', kind: x.kind, description: '' }], mechanics: x.mechanics.map(([id, importance, description]) => ({ id, verb: description.split(' ')[0], description, from: x.ref, importance })), core: x.core }, x.premise, registry);
/** A model that picks the best-ranked candidate for every question. */
const firstWriter = () => fakeWriter([req => { const p = req.schema.schema.properties; const field = p.space ? 'space' : 'pick'; return JSON.stringify({ [field]: p[field].enum[0], why: 'first', ...(p.spec ? { spec: '' } : {}) }); }]);

test('(e) the same machinery builds a turn-based sides game, a real-time collect game and a race', async () => {
  const { registry } = buildCatalogue();
  const built = {};
  for (const [name, x] of Object.entries(IDEAS)) {
    const d = ideaSpec(x, registry);
    const w = firstWriter();
    const b = await buildSelection({ decomposition: d, registry, writer: w });
    built[name] = b;
    // The space fits how it is played and shows the idea's view; it was chosen before the first mechanic.
    assert.ok((registry.get(b.space.use).card.views || []).some(v => x.views.includes(v) || v === 'any'), `${name}: ${b.space.use}`);
    assert.deepEqual(spaceCandidates(registry, d).map(s => s.use).includes(b.space.use), true);
    // One step per mechanic, the loop mechanic first, each offered only candidates that serve the play spec.
    assert.deepEqual(b.steps.map(s => s.mechanic), worklist(d).map(m => m.id), name);
    assert.equal(b.steps[0].mechanic, x.mechanics[0][0]);
    for (const s of b.steps) {
      assert.ok(s.candidates.length > 0 && s.candidates.length <= MAX_CANDIDATES, `${name}/${s.mechanic}: ${s.candidates.length}`);
      for (const c of s.candidates) if (c.id !== b.space.use) assert.ok(servesInteraction({ id: c.id, ...registry.get(c.id).card }, x.core.interaction), `${name}: ${c.id}`);
      if (s.primitive) assert.ok(s.checks.compose, `${name}/${s.mechanic} checked`);
    }
    // Only small strict questions: the space (when more than one fits) and one per mechanic.
    assert.ok(w.calls.every(c => ['pick_space', 'pick_primitive'].includes(c.schema.name)));
    assert.equal(w.calls.filter(c => c.schema.name === 'pick_primitive').length, x.mechanics.length);
    assert.ok(b.systems.length > 0, name);
  }
  // Each idea built its own collection on its own space: nothing is stamped from one onto another.
  assert.equal(built.sides.space.use, 'engine.space.grid', 'the board the pieces-turns loop declares');
  assert.equal(built.sides.spaceStep.asked, false, 'one space fits: no question');
  assert.ok(built.sides.systems.includes('gameplay.turns'));
  assert.ok(built.race.systems.includes('gameplay.race'));
  assert.notDeepEqual(built.collect.systems, built.race.systems);
});

test('params order: the loop primitive first, then what it requires or what reads its outputs; unrelated ones may share a layer', () => {
  const { registry } = buildCatalogue();
  const layers = dependencyLayers(registry, ['gameplay.inventory', 'gameplay.item.use', 'gameplay.race', 'gameplay.vehicle.core'], ['gameplay.race']);
  assert.deepEqual(layers[0], ['gameplay.race']);
  const at = id => layers.findIndex(l => l.includes(id));
  // item.use requires the inventory: never in the same layer, and the inventory is not asked first.
  assert.ok(at('gameplay.inventory') !== at('gameplay.item.use'));
  assert.ok(layers.flat().length === 4 && new Set(layers.flat()).size === 4);
});
