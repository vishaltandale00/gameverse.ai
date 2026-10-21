// Field-level repair of the small content forms (HANDOFF defect 4). Live failure: "chess but with pokemon" ended with
// species_invalid content.species[0..2].types. The species form offered free strings for `types`, repair dropped the
// unknown types (turning "unknown type" into "no type"), and the re-ask never learned which types exist.
// Offline: the real catalogue, the chess-with-creatures preset and scripted writers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { outlineForm, formPath, fieldForm } from '../v2/planner/outline-form.js';
import { proceduralOutline, writeOutline } from '../v2/planner/outline.js';
import { selectPrimitives } from '../v2/planner/select.js';
import { normalize } from '../v2/planner/decompose.js';
import { repairDocument } from '../v2/planner/repair.js';
import { referenceOf, idsAt } from '../v2/planner/content.js';
import { fakeWriter } from './v2-p-pipeline-fixtures.js';

const { registry, logic } = buildCatalogue();

async function chessWithCreatures() {
  const decomposition = normalize({ title: 'Pokemon chess', premise: 'chess with creatures', mechanics: [{ id: 'turns', verb: 'move', description: 'move pieces in turns', importance: 'core' }, { id: 'battle', verb: 'battle', description: 'captures are creature battles', importance: 'core' }], views: ['board'], acts: 2, zones: 4,
    core: { interaction: 'pieces-turns', opponent: 'ai-side', win: 'checkmate', lose: 'checkmated', theme: '', narrative: false, mashup: [{ relation: 'nested', mechanics: ['battle'], why: 'captures are battles' }] } }, 'chess with pokemon', registry);
  const selection = await selectPrimitives({ decomposition, registry });
  const scaffold = /** @type {any} */ (proceduralOutline({ decomposition, selection, registry, logic, seed: 3 }).doc);
  return { decomposition, selection, scaffold, form: outlineForm({ registry, skeleton: scaffold, selection }) };
}
/** The pack's species in the form's shape, with `types` replaced by what a model wrote. */
const speciesForm = (scaffold, types, n = 3) => scaffold.content.species.slice(0, n).map((s, i) => ({ ...s, types: types(s, i), catchRate: s.catchRate ?? null, expYield: s.expYield ?? null, growth: s.growth ?? null, learnset: s.learnset ?? null, evolves: s.evolves ?? null }));
const invented = (s, i) => [['knight', 'bishop', 'rook'][i % 3]];
/** The types form themes the type names in parallel (as the live run did). */
const themedTypes = ['flame', 'tide', 'leaf', 'normal'];
const errorsOf = (form, filled) => repairDocument(form.toDoc({ section_content_types: themedTypes, ...filled }), { registry, logic }).errors.filter(e => /^content\.species\[\d\]\.types/.test(e.path));

test('the live failure: species keep the pack\'s type ids while the types form themes its own; the types they use stay defined', async () => {
  const { scaffold, form } = await chessWithCreatures();
  const filled = { section_content_species: speciesForm(scaffold, s => s.types), section_content_types: themedTypes };
  const doc = /** @type {any} */ (form.toDoc(filled));
  assert.deepEqual(doc.content.types, [...themedTypes, 'fire', 'water'], 'the referenced scaffold types come back; unreferenced ones do not');
  const r = repairDocument(doc, { registry, logic });
  assert.deepEqual(r.errors.filter(e => /^content\.species/.test(e.path)), [], 'no species_invalid ... types');
  assert.ok(r.doc.content.species.slice(0, 3).every(s => s.types.length === 1));
});

test('reference fields are enums of the document\'s own ids, from the card declarations', async () => {
  const { scaffold, form } = await chessWithCreatures();
  const types = idsAt(scaffold, 'content.types'), moves = idsAt(scaffold, 'content.moves');
  assert.deepEqual(types, ['normal', 'fire', 'water', 'grass']);
  assert.equal(referenceOf(registry, registry.get('gameplay.creature.party')?.card.data?.['content.species']?.of?.fields?.types ?? { type: 'list', of: { type: 'string' }, effect: 'type names from content.types' }), 'content.types');
  const species = form.groups.find(g => g.id === 'section_content_species').schema.schema.properties.section_content_species.items.properties;
  assert.deepEqual(species.types.items.enum, types, 'species types pick from content.types');
  const learn = species.learnset.anyOf[0].items.properties.move;
  assert.deepEqual(learn.enum, moves, 'learnset moves pick from content.moves (strict, not JSON text)');
  assert.equal(species.evolves.anyOf[0].properties.to.enum, undefined, 'a reference into the same form stays free: the form may add ids');
});

test('repair keeps a required reference field and reports it with the allowed ids (no "species needs at least one type")', async () => {
  const { scaffold, form } = await chessWithCreatures();
  const errors = errorsOf(form, { section_content_species: speciesForm(scaffold, invented) });
  assert.ok(errors.length === 3 && errors.every(e => e.code === 'type_unknown'), JSON.stringify(errors));
  assert.ok(errors.every(e => /use only the document's content\.types ids: flame, tide, leaf, normal/.test(e.hint)), errors[0].hint);
  // Near misses are re-pointed by code; a list keeps its valid entries.
  const near = errorsOf(form, { section_content_species: speciesForm(scaffold, (s, i) => [['Flame', 'tides', 'Leaf'][i], ...(i === 2 ? ['rook'] : [])]) });
  assert.deepEqual(near, []);
});

test('field-level repair: only the failing fields go back, as enums; the answer is written at exactly those paths', async () => {
  const { scaffold, form } = await chessWithCreatures();
  const filled = { title: 'Pocket Gambit', section_content_species: speciesForm(scaffold, invented), section_content_types: themedTypes };
  const draft = form.toDoc(filled);
  const errors = errorsOf(form, filled);
  const fields = fieldForm(form.schema, errors.map(e => formPath(e.path, draft)));
  assert.deepEqual(fields.slots.map(s => s.path), ['section_content_species[0].types', 'section_content_species[1].types', 'section_content_species[2].types']);
  assert.deepEqual(fields.unresolved, []);
  const props = fields.schema.schema.properties;
  assert.deepEqual(Object.keys(props), ['field_1', 'field_2', 'field_3']);
  assert.ok(Object.values(props).every(p => p.type === 'array' && p.items.enum.join() === 'normal,fire,water,grass'));
  const fixed = fields.apply(filled, { field_1: ['fire'], field_2: ['fire'], field_3: ['water'] });
  assert.deepEqual(fixed.section_content_species.map(s => s.types), [['fire'], ['fire'], ['water']]);
  assert.deepEqual(fixed.section_content_species.map(s => s.name), filled.section_content_species.map(s => s.name), 'other fields untouched');
  assert.deepEqual(filled.section_content_species[0].types, ['knight'], 'the input is not mutated');
  assert.deepEqual(errorsOf(form, fixed), []);
  // A failing path inside another failing path is covered by it; a path with no slot is returned unresolved.
  const nested = fieldForm(form.schema, ['section_content_species[0]', 'section_content_species[0].types', 'dialogue[id=intro]']);
  assert.deepEqual(nested.slots.map(s => s.path), ['section_content_species[0]']);
  assert.deepEqual(nested.unresolved, ['dialogue[id=intro]']);
});

test('chess with creatures: a model wrong once on species types is corrected by the re-ask of that form alone', async () => {
  const { decomposition, selection, scaffold } = await chessWithCreatures();
  const pack = name => /** @type {any} */ (scaffold.content)[name];
  /** One scripted model for every small form: species types are invented until the problem names the allowed ids. */
  const reply = req => {
    const name = req.schema.name.replace('game_outline_', '');
    // A field-level re-ask: only the failing fields, each slot described by its form path (the allowed ids are its enum).
    if (name.endsWith('_fields')) return JSON.stringify(Object.fromEntries(Object.entries(req.schema.schema.properties).map(([k, p]) => {
      const m = /^section_content_species\[(\d+)\]\.types/.exec(p.description || '');
      return [k, m ? scaffold.content.species[Number(m[1])].types : null];
    })));
    if (name === 'frame') return JSON.stringify({ title: 'Pocket Gambit', logline: 'l', premise: 'p', spaces: {}, player: req.schema.schema.properties.player ? { archetype: req.schema.schema.properties.player.properties.archetype.enum?.[0] ?? 'hero', zone: req.schema.schema.properties.player.properties.zone.enum?.[0] ?? '' } : undefined, endings: [] });
    if (name === 'systems') return JSON.stringify({ systems: {}, extra_systems: [] });
    if (name === 'cast') return JSON.stringify({ archetypes: pack('archetypes').filter(a => a.kind !== 'player').map(a => ({ id: a.id, kind: a.kind, name: a.id, components: { other_json: JSON.stringify(a.components || {}) } })), spawns: [], items: [], characters: [] });
    if (name === 'section_content_species') return JSON.stringify({ section_content_species: speciesForm(scaffold, /use only the document's content\.types ids/.test(req.user) ? s => s.types : invented, 6) });
    if (name === 'section_content_moves') return JSON.stringify({ section_content_moves: pack('moves').map(m => ({ accuracy: null, priority: null, effect: null, ...m })) });
    if (name === 'section_content_types') return JSON.stringify({ section_content_types: themedTypes });
    return JSON.stringify({ acts: [], dialogue: [], quests: [] });
  };
  const writer = fakeWriter([reply]), escalate = fakeWriter([reply], { model: 'stronger' });
  const r = await writeOutline({ writer, escalate, prompt: 'chess but with pokemon', decomposition, selection, registry, logic, seed: 3, verify: false, maxRounds: 2 });
  const asked = writer.calls.map(c => c.schema.name.replace('game_outline_', ''));
  const speciesCalls = writer.calls.filter(c => /section_content_species(_fields)?$/.test(c.schema.name));
  assert.equal(speciesCalls.length, 2, `asked: ${asked.join(' ')}`);
  assert.match(speciesCalls[1].schema.name, /_fields$/, 'the re-ask is a field form: only the failing fields');
  assert.ok(Object.values(speciesCalls[1].schema.schema.properties).every(p => /^section_content_species\[\d\]\.types/.test(p.description)), 'only the species types');
  assert.equal(asked.filter(n => n === 'section_content_types').length, 1, 'the other forms are not re-asked for the species problem');
  assert.match(speciesCalls[1].user, /\[type_unknown\] content\.species\[0\]\.types \(form: section_content_species\[0\]\.types\)/);
  assert.doesNotMatch(speciesCalls[1].user, /species_invalid/, 'the problem is the unknown type, not a dropped field');
  assert.ok(!escalate.calls.some(c => /section_content_species/.test(c.schema.name)), 'fixed before escalation');
  assert.ok(r.ok, JSON.stringify(r.errors?.slice(0, 4)));
  const types = new Set(idsAt(r.doc, 'content.types'));
  assert.ok(r.doc.content.species.every(s => s.types.length && s.types.every(t => types.has(t))), JSON.stringify(r.doc.content.species.map(s => s.types)));
});

test('the story form (wave 2) offers the cast wave 1 wrote as enums: beats, dialogue and quests name real ids', async () => {
  const decomposition = normalize({ title: 'Harbor tales', premise: 'talk to villagers and take their quests', mechanics: [{ id: 'talk', verb: 'talk', description: 'talk to villagers with dialogue choices', importance: 'core' }, { id: 'quests', verb: 'quest', description: 'take quests from villagers and finish them', importance: 'core' }], views: ['td'], acts: 1, zones: 3,
    core: { interaction: 'avatar-realtime', opponent: 'none', win: 'finish the quests', lose: '', theme: '', narrative: true, mashup: [] } }, 'harbor tales', registry);
  const selection = await selectPrimitives({ decomposition, registry });
  const scaffold = /** @type {any} */ (proceduralOutline({ decomposition, selection, registry, logic, seed: 3 }).doc);
  const form = outlineForm({ registry, skeleton: scaffold, selection: { ...selection, systems: [...new Set([...selection.systems, 'plot.dialogue', 'plot.quest'])] } });
  const story = form.storyGroup({ characters: ['ana', 'bo'], archetypes: ['gull'], items: ['net'] });
  assert.ok(story && story.keys.includes('dialogue') && story.keys.includes('quests'), JSON.stringify(story?.keys));
  const props = story.schema.schema.properties;
  const any = s => s.enum || (s.anyOf || []).find(x => x.enum)?.enum;
  assert.deepEqual(any(props.dialogue.items.properties.speaker), ['ana', 'bo']);
  assert.deepEqual(any(props.dialogue.items.properties.nodes.items.properties.who), ['ana', 'bo']);
  assert.deepEqual(any(props.quests.items.properties.giver), ['ana', 'bo']);
  const objective = props.quests.items.properties.objectives.items.properties;
  assert.deepEqual(any(objective.item), ['net']);
  assert.deepEqual(any(objective.archetype), ['gull']);
  assert.ok(any(objective.zone)?.length, 'zones are the scaffold\'s');
  assert.ok(props.acts, 'the story itself is asked when the collection reads plot.storyboard');
});
