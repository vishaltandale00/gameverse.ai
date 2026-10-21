// First-playable attribution (v2/planner/first-playable.js): a primitive whose install or early step throws is
// identified directly (errors are attributed to the owning primitive) and, by default, reported as an error naming
// it and install vs step: nothing is removed, and writeOutline feeds it back to the model as a repair error. Removal
// of the thrower with what requires it (references neutralised) happens only when a caller explicitly asks for it
// (maxIsolations > 0); no generation path does. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { preflight } from '../v2/kernel/document.js';
import { firstPlayable, tracingRegistry } from '../v2/planner/first-playable.js';
import { writeOutline, coreLossProblems } from '../v2/planner/outline.js';
import { selectPrimitives } from '../v2/planner/select.js';
import { createWorld } from '../v2/kernel/world.js';
import { testCatalogue, fakeWriter, decomposition } from './v2-p-pipeline-fixtures.js';

/** Registers the effect 'shatter' (so a beat can depend on it) and throws while installing. */
const fragile = {
  id: 'gameplay.test.fragile',
  card: { intent: 'Shatters glass panes with a resonant hum.', params: {} },
  logic(l) { l.effect('shatter', () => {}); },
  install() { throw Error('glass everywhere'); },
};
/** Requires the fragile primitive: goes with it. */
const shard = { id: 'gameplay.test.shard', card: { intent: 'Collects glass shards.', params: {}, requires: { primitives: ['gameplay.test.fragile'] } }, install() {} };
/** Installs fine; its movement system throws on the first step. */
const wobbly = {
  id: 'gameplay.test.wobbly',
  card: { intent: 'Wobbles the floor.', params: {} },
  logic(l) { l.predicate('wobbling', () => true); },
  install(rt) { rt.system('movement', () => { throw Error('floor fell off'); }, 'gameplay.test.wobbly'); },
};
/** A space whose install throws: it cannot be isolated. */
const brokenSpace = { id: 'engine.space.boom', card: { intent: 'A space that explodes.', params: {}, provides: { capabilities: ['position'] } }, install() { throw Error('kaboom'); } };

const { registry, logic } = testCatalogue([fragile, shard, wobbly, brokenSpace]);
const doc = (systems, beats, space = 'engine.space.graph') => ({
  schema: 'gameverse.v2.game/0.2', id: 'glass-house', title: 'Glass House', seed: 5,
  spaces: [{ id: 'house', use: space, zones: [{ id: 'hall', exits: [{ to: 'attic' }] }, { id: 'attic', exits: [{ to: 'hall' }] }] }],
  systems: [...systems.map(use => ({ use })), { use: 'plot.storyboard' }],
  plot: { premise: 'A house of glass.', storyboard: { acts: [{ id: 'a1', beats: [
    ...beats, { id: 'end', when: { zone: 'attic' }, do: [{ do: 'end_game', ending: 'out' }] },
  ] }] }, endings: [{ id: 'out', title: 'Out', outcome: 'won' }] },
  content: { archetypes: [{ id: 'hero', components: {} }] },
  player: { archetype: 'hero', space: 'house', at: 'hall' },
});

test('tracing attributes a throw to its primitive and says whether it was install or step', () => {
  const tracing = tracingRegistry(registry);
  assert.throws(() => createWorld(preflight(doc(['gameplay.test.fragile'], []), registry, logic).doc, tracing, logic, { seed: 1 }), e => e.gvPrimitive === 'gameplay.test.fragile' && e.gvPhase === 'install');
  const rt = createWorld(preflight(doc(['gameplay.test.wobbly'], []), registry, logic).doc, tracing, logic, { seed: 1 });
  assert.throws(() => rt.step(), e => e.gvPrimitive === 'gameplay.test.wobbly' && e.gvPhase === 'step' && e.gvDetail === 'movement');
});

test('an install that throws is an error naming it by default; removal happens only when explicitly asked', () => {
  const input = doc(['gameplay.test.fragile', 'gameplay.test.shard'], [{ id: 'smash', title: 'Smash', do: [{ do: 'shatter' }, { do: 'set_flag', flag: 'smashed' }] }]);
  assert.ok(preflight(input, registry, logic).ok);
  const plain = firstPlayable(input, registry, logic, { seed: 1 });
  assert.equal(plain.ok, false);
  assert.deepEqual(plain.removed, [], 'nothing is removed');
  assert.deepEqual(plain.errors.map(e => [e.code, e.primitive, e.phase]), [['install_threw', 'gameplay.test.fragile', 'install']]);
  const fp = firstPlayable(input, registry, logic, { seed: 1, maxIsolations: 6 });
  assert.ok(fp.ok, JSON.stringify(fp.errors));
  assert.deepEqual(fp.removed.map(r => r.use).sort(), ['gameplay.test.fragile', 'gameplay.test.shard']);
  const r = fp.removed.find(x => x.use === 'gameplay.test.fragile');
  assert.equal(r.phase, 'install');
  assert.match(r.why, /'gameplay\.test\.fragile' threw while installing: glass everywhere/);
  assert.match(fp.removed.find(x => x.use === 'gameplay.test.shard').why, /requires 'gameplay\.test\.fragile'/);
  const smash = fp.doc.plot.storyboard.acts[0].beats.find(b => b.id === 'smash');
  assert.deepEqual(smash.do.map(e => e.do), ['set_flag'], 'the dangling effect is dropped, the rest of the beat kept');
  assert.ok(fp.beatsFired.includes('smash'));
  assert.ok(preflight(fp.doc, registry, logic).ok);
});

test('a step that throws is named too (and, only when asked, removed with its predicate neutralised)', () => {
  const input = doc(['gameplay.test.wobbly'], [{ id: 'quake', when: { all: [{ wobbling: true }, { zone: 'hall' }] }, do: [{ do: 'set_flag', flag: 'shook' }] }]);
  assert.equal(firstPlayable(input, registry, logic, { seed: 1 }).errors[0]?.primitive, 'gameplay.test.wobbly');
  const fp = firstPlayable(input, registry, logic, { seed: 1, maxIsolations: 6 });
  assert.ok(fp.ok, JSON.stringify(fp.errors));
  assert.deepEqual(fp.removed.map(r => [r.use, r.phase]), [['gameplay.test.wobbly', 'step']]);
  assert.match(fp.removed[0].why, /threw during a step \('movement'\): floor fell off/);
  assert.deepEqual(fp.doc.plot.storyboard.acts[0].beats[0].when, { all: [{ zone: 'hall' }] });
});

test('when the thrower cannot be removed (the space), the error names it, says install, and reaches the model', async () => {
  const fp = firstPlayable(doc([], [], 'engine.space.boom'), registry, logic, { seed: 1 });
  assert.equal(fp.ok, false);
  assert.deepEqual(fp.errors.map(e => [e.code, e.primitive, e.phase, e.path]), [['install_threw', 'engine.space.boom', 'install', 'spaces[0]']]);
  assert.match(fp.errors[0].message, /'engine\.space\.boom' threw while installing: kaboom/);

  const d = decomposition(['find and collect items']);
  const selection = await selectPrimitives({ decomposition: d, registry });
  const good = doc([], []);
  const writer = fakeWriter([doc([], [], 'engine.space.boom'), good]);
  const o = await writeOutline({ forms: 'single', writer, prompt: 'a glass house', decomposition: d, selection, registry, logic, seed: 1, maxRounds: 1, verify: false });
  assert.equal(writer.calls.length, 2);
  assert.match(writer.calls[1].user, /\[install_threw\] spaces\[0\]: 'engine\.space\.boom' threw while installing: kaboom/);
  assert.ok(o.ok && o.source === 'fake-writer');
  assert.equal(o.doc.spaces[0].use, 'engine.space.graph');
});

test('the diagnostic: a draft that lost a core primitive is named (mechanic, primitive, failing fields)', () => {
  const mechanics = [{ id: 'm1', description: 'shatter the glass', importance: 'core', primitives: ['gameplay.test.fragile'] }];
  const keep = new Set(['gameplay.test.fragile']);
  const intact = doc(['gameplay.test.fragile'], []);
  assert.deepEqual(coreLossProblems(intact, [], mechanics, keep), []);
  const dropped = doc([], []);
  const [p] = coreLossProblems(dropped, [], mechanics, keep, [{ path: 'systems[0]', message: 'gameplay.test.fragile.rate must be a number' }]);
  assert.equal(p.code, 'core_degraded');
  assert.match(p.message, /core mechanic "shatter the glass" lost primitive gameplay\.test\.fragile/);
  assert.match(p.message, /systems\[0\]: gameplay\.test\.fragile\.rate must be a number/);
  const isolated = coreLossProblems(intact, [{ use: 'gameplay.test.fragile', why: 'threw while installing' }], mechanics, keep);
  assert.match(isolated[0].message, /removed: threw while installing/);
});
