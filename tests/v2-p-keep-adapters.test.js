// Mashup adapters survive every stage from selection to the published document (v2/planner/adapters.js
// keepMashupAdapters, mashupAdapterProblems), a skin is an adapter only when declarations decide it (build-steps.js
// adapterSteps, presets.js skinSections), and component fields declared with options are enums in the forms
// (outline-form.js). Three live failures on v2-presets 5ed5399f, replayed offline on the real catalogue with scripted
// writers (no network):
//   chess × pokemon   the spec's nested mashup: re-planning a gap (checkmate) re-resolved the selection's adapters and
//                     dropped engine.adapt.nested; v1 published without it. select.js did the same whenever an unmet
//                     primitive was resolved through an adapter after the build.
//   Pac-Man × haunted library   a setting joined as skin got engine.adapt.skin with nothing to map; repair filled its
//                     maps with 'untitled' and the build died on it.
//   interact.kind     'inspect' survived three repair rounds: the component field declared no options, so the cast form
//                     and its field repair offered free text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { catalogue, PRIMITIVES } from '../v2/primitives/index.js';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { selectPrimitives } from '../v2/planner/select.js';
import { proceduralOutline } from '../v2/planner/outline.js';
import { preset, skinSections } from '../v2/planner/presets.js';
import { createKernelPipeline } from '../v2/planner/kernel-pipeline.js';
import { keepMashupAdapters, mashupAdapterProblems } from '../v2/planner/adapters.js';
import { outlineForm, fieldForm, strictSpec } from '../v2/planner/outline-form.js';
import { fakeWriter, buildAnswer, decomposer, stepPick, formAnswer } from './v2-p-pipeline-fixtures.js';

const cat = catalogue();
const { registry, logic } = cat;
const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/v2-live/${name}`, import.meta.url), 'utf8'));
const CHESS = fixture('chess-pokemon-nested.json');
const PAC = fixture('pacman-haunted-skin.json');
const NESTED = 'engine.adapt.nested', SKIN = 'engine.adapt.skin';
/** A form slot without its null alternative. */
const bare = n => (n?.anyOf ? n.anyOf.find(x => x.type !== 'null') : n);

/** The iterative decomposition's forms answered with a recorded decomposition (its concepts, their loop mechanics, the play spec). */
const planOf = d => ({
  concepts: d.concepts.map(c => ({ id: c.id, name: c.name, quote: c.quote, kind: c.kind, keeps: c.keeps })),
  mechanics: Object.fromEntries(d.concepts.map(c => [c.id, d.mechanics.filter(m => m.from === c.id).map(m => ({ id: m.id, verb: m.verb, description: m.description, from: c.id, role: m.id === c.loop ? 'loop' : m.importance }))])),
  spec: structuredClone(d.core),
  about: { title: d.title, premise: d.premise, tone: d.tone }, where: { spaces: d.spaces, views: d.views, movement: d.movement }, story: { acts: 1, zones: 0 },
});
/** The build's scripted answers for a recorded idea: its space, the live mapping, the loop steps and the nested trigger. */
const answersOf = (f, mapping = f.mapping) => ({ space: [f.space || 'engine.space.grid'], picks: mapping, steps: { ...(f.steps || {}), trigger: f.trigger ? [f.trigger] : [] } });
/** The selection the build makes for a recorded idea (scripted model, no network). */
const selectionOf = (f, decomposition = structuredClone(f.decomposition), reg = registry) =>
  selectPrimitives({ decomposition, registry: reg, writer: fakeWriter([req => buildAnswer(req, answersOf(f)) ?? '{}']) });

/**
 * A scripted spec model for an offline create run of a recorded idea: it decomposes it, answers the build's questions
 * from the live mapping (the `gap` mechanics are left a gap by the build and mapped when re-planning asks, as the live
 * model did), and writes the outline's small forms with the content of the scaffold the full mapping makes (its cast,
 * items and content sections; the params keep the scaffold's configuration), plus the archetypes `extra` it themes for
 * the idea, two of the `spawn` archetype placed in every zone.
 */
async function createWriter(f, { gap = [], extra = [], spawn = null } = {}) {
  const scaffold = proceduralOutline({ decomposition: structuredClone(f.decomposition), selection: await selectionOf(f), registry, logic, seed: f.seed, prompt: f.prompt }).doc;
  const decompose = decomposer(planOf(f.decomposition));
  const built = answersOf(f, Object.fromEntries(Object.entries(f.mapping).filter(([id]) => !gap.includes(id))));
  const replanned = answersOf(f);
  const state = { outlining: false };
  const outline = req => {
    const name = String(req.schema?.name || ''), props = req.schema?.schema?.properties || {};
    if (name.endsWith('_frame')) return { title: f.decomposition.title, logline: 'One line.', premise: f.decomposition.premise, spaces: {}, player: { archetype: props.player?.properties.archetype.enum?.[0] ?? 'player_side', zone: props.player?.properties.zone.enum?.[0] ?? '' }, endings: [] };
    const zones = props.spawns?.items?.properties?.zone?.anyOf?.[0]?.enum || props.spawns?.items?.properties?.zone?.enum || [];
    // The cast as the strict form asks it (the declared shapes of archetypes, their components, items and spawn rules).
    if (name.endsWith('_cast')) return formAnswer(req.schema.schema, { archetypes: [...scaffold.content.archetypes, ...extra], items: scaffold.content.items || [], characters: [],
      ...(props.spawns ? { spawns: spawn ? zones.map((zone, i) => ({ id: `${spawn}_${i}`, archetype: spawn, zone, count: [2, 2], respawnSec: 0 })) : [] } : {}) });
    const section = Object.keys(props).find(k => k.startsWith('section_'));
    if (section) { const [, root, key] = section.split('_'); return formAnswer(req.schema.schema, { [section]: scaffold[root]?.[key] ?? [] }); }
    return {};
  };
  const writer = fakeWriter([req => stepPick(req) ?? decompose(req) ?? buildAnswer(req, state.outlining ? replanned : built) ?? JSON.stringify(outline(req))]);
  return { writer, state };
}
/** Run a create job offline: what it published, its stages and checkpoints. */
async function create(f, options = {}) {
  const { writer, state } = await createWriter(f, options);
  const versions = [], stages = [], checkpoints = {};
  const ctx = { stage(name, detail = {}) { if (name === 'outlining') state.outlining = true; stages.push({ name, ...detail }); }, draft() {}, checkpoint(name, value) { checkpoints[name] = value; },
    async publish(p) { versions.push(p); return p; }, store: { async updateMeta() {}, async version(_, v) { return versions[v - 1]; } } };
  const pipeline = createKernelPipeline({ catalogue: async () => cat, writers: { spec: writer }, config: { replanAttempts: 3, maxDetailTasks: 0, outlineRepairRounds: 0 } });
  const out = await pipeline({ gameId: 'g', prompt: f.prompt, kind: 'create', seed: f.seed }, ctx);
  return { out, versions, stages, checkpoints };
}

// ---------- 1. the nested adapter survives selection, re-planning, the outline and publish ----------

test('chess × pokemon: an offline create run re-plans the checkmate gap as live and publishes engine.adapt.nested, wired from declarations', async () => {
  const { out, versions } = await create(CHESS, { gap: ['checkmate_objective'] });
  // The live path: the build left checkmate a gap, re-planning added the turn loop for it, then the outline published.
  assert.deepEqual(out.outline.attempts.map(a => a.stage), ['selection', 'published']);
  assert.ok(out.outline.attempts[0].actions.some(a => a.action === 'add' && a.primitive === 'gameplay.turns'), JSON.stringify(out.outline.attempts[0].actions));
  assert.equal(versions.length, 1);
  const doc = versions[0].doc;
  const nested = doc.systems.filter(s => s.use === NESTED);
  assert.equal(nested.length, 1, JSON.stringify(doc.systems.map(s => s.use)));
  // The trigger the scripted model picked among the declared ones, the joined loop, its declared start, and the outcomes
  // its inner loop declares (card.loop.outcome), each emitted by the battle and mapped back onto the board.
  assert.equal(nested[0].with.on, 'attack_hit');
  assert.deepEqual(nested[0].with.inner, ['gameplay.creature.battle']);
  assert.deepEqual(nested[0].with.start.map(e => e.do), registry.get('gameplay.creature.battle').card.engage.encounter.start.map(e => e.do));
  assert.deepEqual(nested[0].with.outcomes.map(o => o.result), Object.keys(registry.get('gameplay.creature.battle').card.loop.outcome.results));
  const battle = doc.systems.find(s => s.use === 'gameplay.creature.battle');
  for (const o of nested[0].with.outcomes) assert.ok(Object.values(battle.with).some(v => Array.isArray(v) && v.some(e => e?.do === 'emit' && e.event === o.on)), o.on);
  // The invariant the pipeline checks before publishing holds on what it published.
  const sel = await selectionOf(CHESS);
  assert.deepEqual(mashupAdapterProblems(doc, CHESS.decomposition, sel, registry), []);
});

test('select.js: an unmet primitive resolved through an adapter after the build keeps the build\'s nested adapter (it used to replace them all)', async () => {
  // A story runner that needs gravity, which the board lacks: selection adds it after the build (the play spec has a
  // story) and resolves it onto a projected region. The build's mashup adapter must stay beside that region.
  const saga = { id: 'plot.saga', card: { intent: 'A saga told while falling.', params: {}, reads: ['plot.storyboard'], requires: { capabilities: ['gravity'] } }, install() {} };
  const { registry: reg } = buildCatalogue([], [saga, ...PRIMITIVES]);
  const d = structuredClone(CHESS.decomposition);
  d.core.narrative = true;
  const sel = await selectionOf(CHESS, d, reg);
  assert.ok(sel.systems.includes('plot.saga'));
  const region = sel.adapters.find(a => a.use === 'engine.adapt.projection');
  assert.ok(region, 'the saga is hosted by a projected region');
  assert.equal(sel.bind['plot.saga'], region.id);
  const nested = sel.adapters.filter(a => a.use === NESTED);
  assert.equal(nested.length, 1, JSON.stringify(sel.adapters));
  assert.deepEqual(sel.mashupAdapters, [{ relation: 'nested', mechanics: d.core.mashup[0].mechanics, instances: [{ use: NESTED, id: nested[0].id }] }]);
  assert.deepEqual(sel.gaps, []);
});

test('keepMashupAdapters: a re-resolution keeps the mashup instances and the bindings onto their regions; a resolved id they hold moves', () => {
  const union = { use: 'engine.adapt.projection', id: 'track-on-world', space: 'world', with: { kind: 'engine.space.track' } };
  const nested = { use: NESTED, id: 'nested-duel', with: { id: 'duel' } };
  const previous = { adapters: [union, nested, { use: 'engine.adapt.projection', id: 'old', space: 'world', with: {} }], bind: { 'gameplay.race': 'track-on-world', 'gameplay.other': 'old' },
    mashupAdapters: [{ relation: 'union', mechanics: ['run', 'race'], instances: [{ use: union.use, id: union.id }] }, { relation: 'nested', mechanics: ['move', 'duel'], instances: [{ use: NESTED, id: nested.id }] }] };
  // The resolution re-derives a region that happens to take the union's id, and one identical to the union's.
  const clash = { use: 'engine.adapt.projection', id: 'track-on-world', space: 'world', with: { kind: 'engine.space.grid' } };
  const twin = { ...structuredClone(union), id: 'track-on-world-2' };
  const r = keepMashupAdapters({ adapters: [clash, twin], bind: { 'gameplay.cells': 'track-on-world', 'gameplay.race': 'track-on-world-2' } }, previous);
  assert.deepEqual(r.adapters.map(a => a.id).sort(), ['nested-duel', 'track-on-world', 'track-on-world-3'].sort());
  assert.equal(r.adapters.find(a => a.id === 'track-on-world').with.kind, 'engine.space.track', 'the union instance keeps its id');
  assert.deepEqual(r.bind, { 'gameplay.cells': 'track-on-world-3', 'gameplay.race': 'track-on-world' });
});

test('the publish invariant: a mashup entry whose adapter the document lost (or no step realised) fails with that gap', async () => {
  const sel = await selectionOf(CHESS);
  const doc = proceduralOutline({ decomposition: structuredClone(CHESS.decomposition), selection: structuredClone(sel), registry, logic, seed: CHESS.seed, prompt: CHESS.prompt }).doc;
  assert.deepEqual(mashupAdapterProblems(doc, CHESS.decomposition, sel, registry), []);
  const lost = { ...doc, systems: doc.systems.filter(s => s.use !== NESTED) };
  const [p] = mashupAdapterProblems(lost, CHESS.decomposition, sel, registry);
  assert.equal(p.code, 'mashup_adapter_missing');
  assert.match(p.message, /nested mashup \[turn_based_move.*lost engine\.adapt\.nested 'nested-/);
  assert.match(mashupAdapterProblems(doc, CHESS.decomposition, { ...sel, mashupAdapters: [] }, registry)[0].message, /no mashup adapter step realised it/);
});

test('the outline form keeps every instance of an adapter used twice (two encounters), each with its own id and configuration', async () => {
  const sel = await selectionOf(CHESS);
  const skeleton = proceduralOutline({ decomposition: structuredClone(CHESS.decomposition), selection: structuredClone(sel), registry, logic, seed: CHESS.seed, prompt: CHESS.prompt }).doc;
  const first = skeleton.systems.find(s => s.use === NESTED);
  skeleton.systems.push({ ...structuredClone(first), id: 'nested-second', with: { ...structuredClone(first.with), id: 'second' } });
  const draft = outlineForm({ registry, skeleton, selection: sel }).toDoc({});
  assert.deepEqual(draft.systems.filter(s => s.use === NESTED).map(s => [s.id, s.with.id]), [[first.id, first.with.id], ['nested-second', 'second']]);
});

// ---------- 2. a setting joined as skin brings no content: no skin adapter ----------

test('Pac-Man × haunted library: the setting brings no content section, so the skin step adds no adapter, and the game builds', async () => {
  const sel = await selectionOf(PAC);
  const step = sel.build.steps.find(s => s.kind === 'skin');
  assert.equal(step.outcome, 'none');
  assert.ok(!(sel.adapters || []).some(a => a.use === SKIN), JSON.stringify(sel.adapters));
  // Only the flavor mechanics no primitive serves are gaps (as live): nothing core, no adapter.
  assert.deepEqual(sel.gaps.filter(g => g.importance === 'core' || g.kind === 'adapter'), []);
  assert.deepEqual(sel.mashupAdapters, [{ relation: 'skin', mechanics: PAC.decomposition.core.mashup[0].mechanics, instances: [] }]);
  // The joined primitives declare no content section; the core loop's contracts are the targets a skin would fill.
  assert.deepEqual(skinSections(registry, ['gameplay.move.grid', 'gameplay.collectible'], ['gameplay.interact']).from, []);
  // Content species fill chess pieces: a joined concept that brings content does get a skin.
  const party = skinSections(registry, ['gameplay.turns'], ['gameplay.creature.party']);
  assert.equal(party.to, 'content.archetypes');
  assert.ok(party.from.includes('content.species'), JSON.stringify(party));
  // The whole create run publishes, with no skin instance and no placeholder section.
  // The scripted model's cast for the idea: tomes to collect (the collect win counts them), in every zone of the maze.
  const { versions } = await create(PAC, { extra: [{ id: 'tome', kind: 'pickup', components: { name: 'Tome', collectible: { counter: 'win' } } }], spawn: 'tome' });
  assert.equal(versions.length, 1);
  const doc = versions[0].doc;
  assert.ok(!doc.systems.some(s => s.use === SKIN));
});

test('a skin the steps added whose maps the composition cannot derive is a gap, never an \'untitled\' map', async () => {
  const sel = await selectionOf(PAC);
  sel.adapters = [...(sel.adapters || []), { use: SKIN, id: 'skin-on-primary', space: sel.spaces[0].id, with: {} }];
  const p = preset({ decomposition: structuredClone(PAC.decomposition), selection: sel, registry, logic, seed: PAC.seed, prompt: PAC.prompt });
  assert.ok(!p.doc.systems.some(s => s.use === SKIN), 'no unconfigured skin is left for repair to fill with placeholder sections');
  const gap = p.gaps.find(g => /skin adapter/.test(g.description));
  assert.ok(gap, JSON.stringify(p.gaps));
  assert.equal(gap.importance, 'core');
  assert.ok(sel.gaps.includes(gap) || sel.gaps.some(g => g.description === gap.description), 'the build fails with it');
});

// ---------- 3. component fields declared with options are enums in the forms ----------

test('interact.kind is declared with its options: an enum in the cast form and in the field repair of a wrong value', async () => {
  const sel = await selectionOf(PAC);
  const skeleton = proceduralOutline({ decomposition: structuredClone(PAC.decomposition), selection: structuredClone(sel), registry, logic, seed: PAC.seed, prompt: PAC.prompt }).doc;
  const form = outlineForm({ registry, skeleton, selection: sel });
  const cast = form.groups.find(g => g.id === 'cast');
  const kind = bare(bare(bare(cast.schema.schema.properties.archetypes.items.properties.components).properties.interact).properties.kind);
  const declared = registry.get('gameplay.interact').card.components.interact.fields.kind.options;
  assert.ok(declared.includes('talk') && !declared.includes('inspect'));
  assert.deepEqual(kind.enum, declared);
  // The live repair: content.archetypes[4].components.interact.kind 'inspect' goes back as one field slot holding the enum.
  const ff = fieldForm(cast.schema, ['archetypes[4].components.interact.kind']);
  assert.deepEqual(ff.unresolved, []);
  assert.deepEqual(bare(ff.schema.schema.properties.field_1).enum, declared);
});

test('a wide object keeps every declared field strict: a field declared with options is an enum slot, no field travels as JSON text', () => {
  const fields = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`f${i}`, { type: 'number' }]));
  fields.mode = { type: 'string', options: ['a', 'b'] };
  const { schema, codec } = strictSpec({ type: 'object', fields }, 1, null);
  assert.deepEqual(bare(schema.properties.mode).enum, ['a', 'b']);
  assert.deepEqual(Object.keys(schema.properties).sort(), Object.keys(fields).sort(), 'every field has its slot (no more_json catch-all)');
  assert.equal(codec.more, false);
});
