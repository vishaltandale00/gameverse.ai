// Kernel contract (KERNEL_API.md §2): what keeps headless verification and the browser host on the same simulation.
// - Reads never change state: rt.read, and option listing, never create a primitive's store.
// - While a modal is open, the step's input is only its actions (as actions, held verbs or axes), in every host.
// - Each world owns a copy of its document: changing one world's rt.doc never reaches another world.
import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogue } from '../v2/primitives/index.js';
import { preflight } from '../v2/kernel/document.js';
import { createWorld, cloneState } from '../v2/kernel/world.js';

const probe = {
  id: 'gameplay.test.reads', card: { intent: 'Kernel read and modal fixture: lazily made state, an option, a modal.', views: ['any'], params: {}, provides: { actions: ['ask', 'answer', 'poke'] } },
  install(rt) {
    const st = () => { const s = rt.store('gameplay.test.reads'); s.made ??= rt.random(); return s; };
    rt.options(() => [{ label: `poke ${st().made.toFixed(3)}`, actions: { poke: true } }]);
    rt.action('poke', () => { st().pokes = (st().pokes || 0) + 1; });
    rt.action('ask', () => rt.openModal('gameplay.test.reads', { actions: ['answer'] }));
    rt.action('answer', () => rt.closeModal('gameplay.test.reads'));
    rt.system('rules', r => { st().seen = { held: Object.keys(r.input.held || {}), axes: Object.keys(r.input.axes || {}) }; }, 'gameplay.test.reads');
  },
};
const { registry, logic } = catalogue([probe]);
const doc = () => ({
  schema: 'gameverse.v2.game/0.2', id: 'reads', title: 'Reads', seed: 3,
  spaces: [{ id: 'room', use: 'engine.space.graph', zones: [{ id: 'hall', name: 'Hall' }] }],
  systems: [{ use: 'gameplay.test.reads' }],
  content: { archetypes: [{ id: 'hero', components: {} }] }, player: { archetype: 'hero', space: 'room', at: 'hall' },
});
const world = () => { const c = preflight(doc(), registry, logic); assert.ok(c.ok, JSON.stringify(c.errors)); return createWorld(c.doc, registry, logic); };

test('reads: listing options and rt.read create no store and consume no randomness', () => {
  const rt = world(), before = structuredClone(rt.state);
  assert.equal(rt.availableOptions().length, 1);
  rt.read(() => rt.store('gameplay.test.reads').x = 1);
  assert.deepEqual(rt.state, before, 'a read leaves the state as it was');
  rt.step({});
  const listed = world(); listed.availableOptions(); listed.step({});
  assert.deepEqual(listed.state, rt.state, 'a world that was read before its first step equals one that was not');
  assert.ok(rt.state.prim['gameplay.test.reads'].made !== undefined, 'the step makes the state');
});

test('modal: while a modal is open the step input is only its actions, as actions, held verbs or axes', () => {
  const rt = world();
  rt.step({ actions: { ask: true } });
  assert.equal(rt.modal?.owner, 'gameplay.test.reads');
  rt.step({ actions: { poke: true }, held: { poke: true, answer: true }, axes: { move: [1, 0] } });
  assert.equal(rt.state.prim['gameplay.test.reads'].pokes, undefined, 'an action the modal does not take is not dispatched');
  assert.deepEqual(rt.state.prim['gameplay.test.reads'].seen, { held: ['answer'], axes: [] }, 'systems see only the modal\'s verbs');
  rt.step({ actions: { answer: true } });
  assert.equal(rt.modal, null);
  rt.step({ held: { poke: true }, axes: { move: [1, 0] } });
  assert.deepEqual(rt.state.prim['gameplay.test.reads'].seen, { held: ['poke'], axes: ['move'] }, 'and everything once it closes');
});

test('documents: each world owns a copy of its document', () => {
  const c = preflight(doc(), registry, logic);
  const a = createWorld(c.doc, registry, logic), b = createWorld(c.doc, registry, logic);
  a.doc.systems[0].with.changed = true;
  assert.equal(b.doc.systems[0].with.changed, undefined);
  assert.equal(c.doc.systems[0].with.changed, undefined, 'nor the document it was made from');
  const next = structuredClone(c.doc);
  a.extend(next, { zones: [], beats: [], systems: [] }); b.extend(next, { zones: [], beats: [], systems: [] });
  a.doc.systems[0].with.changed = true;
  assert.equal(b.doc.systems[0].with.changed, undefined, 'and so is a document hot-loaded into it');
});

test('snapshots: cloneState copies JSON state exactly (NaN, Infinity, -0, holes) and shares nothing with it', () => {
  const sparse = [1, , 3]; // eslint-disable-line no-sparse-arrays
  const src = { a: [1, 2.5, NaN, -Infinity, -0, null, 'x', true], o: { n: { deep: [[1], { k: 2 }] } }, sparse, map: new Map([[1, 2]]) };
  const out = /** @type {any} */ (cloneState(src));
  assert.deepEqual(out, structuredClone(src));
  assert.ok(Object.is(out.a[4], -0) && Number.isNaN(out.a[2]));
  assert.equal(1 in out.sparse, false, 'a hole stays a hole');
  assert.ok(out.map instanceof Map && out.map !== src.map, 'a non-JSON value is copied by structuredClone');
  out.o.n.deep[1].k = 9; out.a.push(4);
  assert.equal(src.o.n.deep[1].k, 2); assert.equal(src.a.length, 8);
  const rt = world(); rt.step({});
  const snap = rt.snapshot(); rt.step({ actions: { poke: true } }); rt.restore(snap);
  assert.deepEqual(rt.state, snap, 'restore gives back the snapshot');
  assert.notEqual(rt.state.prim, snap.prim, 'and keeps none of its objects');
});

test('derived: built once per read and key, dropped when the read ends and by a step or restore; null outside a read', () => {
  const rt = world();
  let builds = 0;
  const build = () => ({ n: ++builds });
  assert.equal(rt.derived('k', build), null, 'outside a read the state may change between lookups: nothing is kept');
  assert.equal(builds, 0);
  const [a, b, nested] = rt.read(() => [rt.derived('k', build), rt.derived('k', build), rt.read(() => rt.derived('k', build))]);
  assert.equal(builds, 1, 'one build serves the whole read, nested reads included');
  assert.equal(a, b); assert.equal(a, nested);
  rt.read(() => rt.derived('k', build));
  assert.equal(builds, 2, 'a new read builds again');
  const snap = rt.snapshot();
  rt.read(() => { rt.derived('k', build); rt.step({}); rt.derived('k', build); rt.restore(snap); rt.derived('k', build); });
  assert.equal(builds, 5, 'a step or a restore inside a read changes the state: what was derived is dropped');
});
