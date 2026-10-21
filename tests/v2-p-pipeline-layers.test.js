// The step path's outline (preflight + repair rounds) and first playable (no model, <1 s). There is no detail pass
// after publishing (ARCHITECTURE §5: no post-publish pass adds content the declarations did not ask for).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../v2/kernel/world.js';
import { preflight, mergePatch } from '../v2/kernel/document.js';
import { spaceVariants } from '../v2/planner/catalog.js';
import { proceduralOutline, writeOutline, fewShot } from '../v2/planner/outline.js';
import { firstPlayable, replayCheck } from '../v2/planner/first-playable.js';
import { verifyDocument, regressed } from '../v2/planner/verify-adapter.js';
import { solve } from '../v2/verify/solve.js';
import { testCatalogue, fakeWriter, decomposition, broken, picky } from './v2-p-pipeline-fixtures.js';

const { registry, logic } = testCatalogue();
/** A play spec saying the idea has a story told in acts (the rest is decided by the collection). */
const STORY = { interaction: null, opponent: 'none', win: 'reach the lamp', lose: '', theme: '', narrative: true, mashup: [] };
/**
 * The selection these outline tests start from (selection itself is the model's build: v2-p-pipeline-build*.test.js):
 * collecting items is the inventory's, the story told in acts is the story runner's, on the graph of places.
 */
const plan = () => {
  const d = decomposition(['find and collect items', 'follow a story told in acts'], { core: STORY });
  const space = { id: 'world', use: 'engine.space.graph', with: {}, role: 'world', caps: [...spaceVariants(registry, 'engine.space.graph')[0].caps] };
  const by = ['gameplay.inventory', 'plot.storyboard'];
  const sel = { version: 'test', systems: [...by], spaces: [space], generators: [], graphics: [], bind: {}, gaps: [], provider: 'test', ms: 0,
    mechanics: d.mechanics.map((m, i) => ({ ...m, primitives: [by[i]], candidates: [], source: 'test', score: 1 })), completeness: { locomotion: { view: null, medium: null, removed: [], added: null } } };
  return { d, sel };
};
/**
 * The story a model writes on the structure (the preset authors none): a guide, an arrival beat, a beat per zone
 * reached, the second zone's exit gated by a key the first beat gives, and a finale that wins. Test data only.
 */
function authored(structure) {
  const doc = structuredClone(structure);
  const zones = doc.spaces[0].zones;
  doc.plot.characters = [{ id: 'guide', name: 'Guide', role: 'guide' }];
  doc.content.items = [...(doc.content.items || []), { id: 'brass_key', name: 'Brass key' }, { id: 'lantern', name: 'Lantern' }, { id: 'rope', name: 'Rope' }];
  const gate = zones[1]?.exits?.find(x => x.to === zones[2]?.id); if (gate) gate.gate = { item: 'brass_key' };
  doc.plot.storyboard = { acts: [{ id: 'act_1', title: 'Arrival', beats: [
    { id: 'arrival', do: [{ do: 'say', character: 'guide', text: 'Find the lamp.' }, { do: 'give_item', item: 'brass_key' }] },
    ...zones.slice(1).map(z => ({ id: `reach_${z.id}`, when: { zone: z.id }, do: [{ do: 'say', character: 'guide', text: `${z.id}.` }] })),
    { id: 'finale', after: [`reach_${zones[zones.length - 1].id}`], do: [{ do: 'end_game', ending: 'victory' }] },
  ] }] };
  return doc;
}

test('the procedural structure composes what the cards declare and authors no story', async () => {
  const { d, sel } = plan();
  const o = proceduralOutline({ decomposition: d, selection: sel, registry, logic, seed: 3 });
  // The structure has no story until the model writes one: it does not validate, and nothing invents one.
  assert.equal(o.ok, false);
  assert.deepEqual([...new Set(o.errors.map(e => e.code))], ['plot_missing'], JSON.stringify(o.errors));
  assert.equal(o.doc.plot.storyboard, undefined, 'no adventure skeleton, no placeholder act: the story is the model\'s');
  // The story runner is in the collection (a mechanic's pick): its places are the ones the play spec's story asks for,
  // with code-written ids and no names (the model names them).
  assert.equal(o.doc.spaces[0].zones.length, d.zones);
  assert.ok(o.doc.spaces[0].zones.every((z, i) => z.id === `place_${i + 1}` && z.name === undefined));
  assert.ok(preflight(authored(o.doc), registry, logic).ok, 'an authored story on the structure preflights');
  assert.equal(o.structure.win?.use, 'plot.storyboard', 'the story declares the win (its endings)');
  assert.ok(o.doc.plot.endings.some(e => e.id === 'victory' && e.outcome === 'won'));
  const s = solve(preflight(authored(o.doc), registry, logic).doc, registry, logic, { budgetMs: 1000 });
  assert.ok(s.completable, 'the structure carries an authored story end to end');
  // Without the story runner in the collection there is no story and no story places, whatever the play spec's flag says.
  const plain = proceduralOutline({ decomposition: d, selection: { ...sel, systems: ['gameplay.inventory'], mechanics: sel.mechanics.slice(0, 1) }, registry, logic, seed: 3 });
  assert.ok(!plain.doc.systems.some(x => x.use === 'plot.storyboard'));
  assert.equal(plain.structure.narrative, false);
});

test('few-shot material only teaches registered primitives', () => {
  const shots = fewShot(registry).map(s => JSON.parse(s));
  assert.ok(shots.length >= 1);
  for (const g of shots) for (const i of [...g.spaces, ...g.systems, ...g.graphics]) assert.ok(registry.has(i.use), i.use);
});

test('model outline: errors are repaired by code first, then sent back to the model; never substituted by the skeleton', async () => {
  const { d, sel } = plan();
  const skeleton = authored(proceduralOutline({ decomposition: d, selection: sel, registry, logic, seed: 1 }).doc);
  // The drafts carry the content the chosen primitives need (authored: a story and items to hold), so they are not hollow.
  const full = doc => structuredClone(doc);
  // Draft 1: fixable by code (unknown param, near-miss item, out-of-range slots).
  const draft = full(skeleton);
  draft.title = 'The Drowned Lamp';
  draft.systems.find(s => s.use === 'gameplay.inventory').with = { slots: 99999, sparkle: true };
  const writer = fakeWriter([draft]);
  const r = await writeOutline({ forms: 'single', writer, prompt: 'idea', decomposition: d, selection: sel, registry, logic, seed: 1 });
  assert.ok(r.ok);
  assert.equal(r.doc.title, 'The Drowned Lamp');
  assert.equal(r.firstPassOk, false, 'it needed repair');
  assert.equal(writer.calls.length, 1, 'code repair sufficed: no second model call');
  assert.match(writer.calls[0].system, /plot\.storyboard/);
  assert.match(writer.calls[0].user, /A valid skeleton/);
  assert.equal(r.rounds[0].kind, 'procedural');
  assert.equal(writer.calls[0].schema?.name, 'game_outline', 'the model fills a strict form derived from the chosen cards');
  // A code only the model can fix goes back to it with code, path and hint; the second draft fixes it.
  const p = testCatalogue([picky]);
  const needsModel = { ...full(skeleton), title: 'Drowned Lamp', systems: [...skeleton.systems, { use: 'gameplay.test.picky' }] };
  const two = fakeWriter([needsModel, { ...needsModel, title: 'The Drowned Lamp' }]);
  const m = await writeOutline({ forms: 'single', writer: two, prompt: 'idea', decomposition: d, selection: sel, registry: p.registry, logic: p.logic, seed: 1 });
  assert.ok(m.ok && m.source === 'fake-writer');
  assert.equal(two.calls.length, 2);
  assert.match(two.calls[1].user, /\[picky_title\] title: the title must start with "The" \(hint: rename the game\)/, 'the repair round names the stable code, path and hint');
  assert.deepEqual(m.rounds.map(x => x.kind), ['procedural', 'model', 'model_repair']);
  // A model that never validates: bounded rounds, then the outline fails with the exact problem; nothing is isolated,
  // dropped or substituted (no primitive, core or not, leaves to make the draft pass).
  const stubborn = fakeWriter([needsModel]);
  const f = await writeOutline({ forms: 'single', writer: stubborn, prompt: 'idea', decomposition: d, selection: sel, registry: p.registry, logic: p.logic, seed: 1, maxRounds: 1 });
  assert.equal(stubborn.calls.length, 2);
  assert.equal(f.ok, false);
  assert.ok(f.errors.some(e => e.code === 'picky_title'));
  assert.deepEqual(f.removed, []);
  assert.ok(f.doc.systems.some(s => s.use === 'gameplay.test.picky'), 'the primitive stays in the draft');
  // The same for a primitive of a core mechanic: the job fails with the reason.
  const core = { ...sel, mechanics: [...sel.mechanics, { id: 'pick', description: 'picky titles', importance: 'core', primitives: ['gameplay.test.picky'] }] };
  const g = await writeOutline({ forms: 'single', writer: fakeWriter([needsModel]), prompt: 'idea', decomposition: d, selection: core, registry: p.registry, logic: p.logic, seed: 1, maxRounds: 1 });
  assert.equal(g.ok, false);
  assert.ok(g.errors.some(e => e.code === 'picky_title'), 'the reason is the core primitive\'s own error');
  // No usable draft at all: no substitution with the skeleton; the job fails and says why.
  const garbage = await writeOutline({ forms: 'single', writer: fakeWriter(['no json here']), prompt: 'idea', decomposition: d, selection: sel, registry, logic, seed: 1, maxRounds: 1 });
  assert.ok(!garbage.ok && garbage.rounds.every(x => x.kind !== 'isolate'));
  assert.ok(garbage.errors.length);
});

test('model outline: a hollow draft gets the missing content back as concrete problems, with the shape to add', async () => {
  const { d, sel } = plan();
  const skeleton = authored(proceduralOutline({ decomposition: d, selection: sel, registry, logic, seed: 1 }).doc);
  const hollow = structuredClone(skeleton); hollow.content.items = [{ id: 'brass_key', name: 'Brass key' }];
  const filled = structuredClone(skeleton);
  const writer = fakeWriter([hollow, filled]);
  const r = await writeOutline({ forms: 'single', writer, prompt: 'idea', decomposition: d, selection: sel, registry, logic, seed: 1 });
  assert.ok(r.ok);
  assert.equal(writer.calls.length, 2);
  assert.match(writer.calls[1].user, /\[content_(missing|thin)\] content\.items/);
  assert.match(writer.calls[1].user, /Shape: \{"id":"brass_key"/, 'the card\'s example shape reaches the model');
  assert.ok(r.rounds[1].content > 0 && r.rounds[2].content === 0);
  assert.equal(r.doc.content.items.length >= 2, true);
});

test('model outline: static plot analysis (plotGraph) and verification problems drive repair rounds', async () => {
  const { d, sel } = plan();
  const skeleton = authored(proceduralOutline({ decomposition: d, selection: sel, registry, logic, seed: 1 }).doc);
  // Preflight-valid, but the first exit needs an item nothing gives: the story can never be finished.
  const locked = structuredClone(skeleton);
  locked.content.items = [...(locked.content.items || []), { id: 'silver_key', name: 'Silver key' }];
  locked.spaces[0].zones[0].exits.forEach(x => { x.gate = { item: 'silver_key' }; });
  const writer = fakeWriter([locked, skeleton]);
  const r = await writeOutline({ forms: 'single', writer, prompt: 'idea', decomposition: d, selection: sel, registry, logic, seed: 1 });
  assert.ok(r.ok && r.source === 'fake-writer');
  assert.equal(writer.calls.length, 2);
  assert.match(writer.calls[1].user, /\[item_unobtainable\]/, 'the cause, from plotGraph, reaches the model');
  assert.ok(r.rounds[1].staticErrors > 0);
  assert.equal(r.doc.spaces[0].zones[0].exits.some(x => x.gate?.item === 'silver_key'), false, 'the repaired draft, not the locked one, is kept');
});

test('first playable: no model, well under a second, deterministic; an install that throws is named, never removed', async () => {
  const { d, sel } = plan();
  const o = { doc: authored(proceduralOutline({ decomposition: d, selection: sel, registry, logic, seed: 9 }).doc) };
  const t = performance.now();
  const fp = firstPlayable(o.doc, registry, logic, { seed: 9 });
  assert.ok(performance.now() - t < 1000);
  assert.ok(fp.ok && fp.start?.at, JSON.stringify(fp.problems));
  assert.ok(fp.beatsFired.includes('arrival'), 'the first beat ran');
  assert.ok(fp.options > 0, 'the player has choices');
  assert.equal(firstPlayable(o.doc, registry, logic, { seed: 9 }).stateHash, fp.stateHash);
  assert.ok(replayCheck(fp.doc, registry, logic, { seed: 9 }).deterministic);
  const withBroken = testCatalogue([broken]);
  const doc = { ...o.doc, systems: [...o.doc.systems, { use: 'gameplay.test.broken' }] };
  const fp2 = firstPlayable(doc, withBroken.registry, withBroken.logic, { seed: 9 });
  assert.equal(fp2.ok, false);
  assert.deepEqual(fp2.removed, []);
  assert.equal(fp2.errors[0].primitive, 'gameplay.test.broken');
});

test('a regression is a proof: an unfinished search never counts as one', () => {
  assert.equal(regressed({ completable: true }, { completable: false, exhaustive: true }), true);
  assert.equal(regressed({ completable: true }, { completable: false, exhaustive: false }), false, 'an unfinished search is not a proof');
});

test('model outline: data the model writes that no chosen primitive reads is left out and recorded; no primitive is added for it', async () => {
  const { d, sel } = plan();
  const skeleton = authored(proceduralOutline({ decomposition: d, selection: sel, registry, logic, seed: 1 }).doc);
  const extra = { ...structuredClone(skeleton), plot: { ...structuredClone(skeleton.plot), quests: [{ id: 'q', title: 'Q', steps: [] }] } };
  const r = await writeOutline({ forms: 'single', writer: fakeWriter([extra]), prompt: 'idea', decomposition: d, selection: sel, registry, logic, seed: 1, verify: false });
  assert.ok(r.ok, JSON.stringify(r.errors?.slice(0, 2)));
  assert.equal(r.doc.plot.quests, undefined);
  assert.deepEqual(r.doc.systems.map(s => s.use).sort(), [...skeleton.systems.map(s => s.use)].sort(), 'the collection is code\'s');
  assert.ok(r.rounds.some(x => x.unread?.includes('plot.quests')), JSON.stringify(r.rounds));
});
