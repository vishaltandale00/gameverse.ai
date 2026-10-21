// The template path (ARCHITECTURE.md §5, v2/planner/templates.js and kernel-pipeline.js create): one strict pick,
// composition by code, parallel strict content forms derived from the composed document, the publish gate. Fake
// writers only (no network). The idea fixtures are one line per template id: a template added to v2/templates
// (farm, dungeon...) is covered by adding its line to IDEAS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, templateById } from '../v2/templates/registry.js';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { preflight } from '../v2/kernel/document.js';
import { createKernelPipeline } from '../v2/planner/kernel-pipeline.js';
import {
  pickForm, pickSystem, checkPick, composeTemplates, textSections, conceptForm, frameTuneForm, writeContent, askPick, narrowPick, tuneTarget, tunePaths, offeredTemplates, templateLoops,
  LOOP_KINDS, THEME_KINDS, PICK_KINDS, PLAYED_RELATIONS, PICK_RULES, NAME_PATTERN,
} from '../v2/planner/templates.js';
import { fakeWriter, mazeWriter } from './v2-p-pipeline-fixtures.js';

const { registry, logic } = buildCatalogue();
const cat = { registry, logic };

/** One line per template: the idea, the game it names, and its themes as [name, kind]. */
const IDEAS = {
  'maze-chase': { idea: 'Pac-Man in a haunted library', game: 'Pac-Man', themes: [['haunted library', 'setting']] },
  race: { idea: 'Mario Kart with shopping carts', game: 'Mario Kart', themes: [['shopping carts', 'theme']] },
  dungeon: { idea: 'Zelda-style dungeon inside a giant clock', game: 'Zelda', themes: [['inside a giant clock', 'setting']] },
  farm: { idea: 'A cozy farming game on a floating island', game: 'farming game', themes: [['floating island', 'setting']] },
  platformer: { idea: 'can I have a Mario game but with sonic as the character', game: 'Mario', themes: [['Sonic as the character', 'character']] },
  runner: { idea: 'can I have an infinite runner game with Mario as a playable character', game: 'infinite runner', themes: [['Mario', 'character']] },
  tactics: { idea: 'XCOM-style squad tactics in a sunken city', game: 'XCOM', themes: [['sunken city', 'setting']] },
  board: { idea: 'Checkers with garden gnomes', game: 'checkers', themes: [['garden gnomes', 'theme']] },
  rts: { idea: 'StarCraft with ants in a backyard', game: 'StarCraft', themes: [['ants in a backyard', 'setting']] },
  'match-board': { idea: 'Candy Crush with sushi', game: 'Candy Crush', themes: [['sushi', 'theme']] },
  fighting: { idea: 'Street Fighter with kitchen utensils', game: 'Street Fighter', themes: [['kitchen utensils', 'theme']] },
  'ball-sport': { idea: 'Soccer on the moon', game: 'soccer', themes: [['on the moon', 'setting']] },
  shmup: { idea: 'Galaga in a coral reef', game: 'Galaga', themes: [['coral reef', 'setting']] },
  'card-battle': { idea: 'Slay the Spire in a haunted bakery', game: 'Slay the Spire', themes: [['haunted bakery', 'setting']] },
  launcher: { idea: 'Angry Birds with penguins on an ice shelf', game: 'Angry Birds', themes: [['penguins on an ice shelf', 'theme']] },
  'slide-merge': { idea: '2048 with planets', game: '2048', themes: [['planets', 'theme']] },
  'falling-blocks': { idea: 'Tetris with books on a library shelf', game: 'Tetris', themes: [['books on a library shelf', 'theme']] },
  'creature-battle': { idea: 'Pokémon battles between kitchen appliances', game: 'Pokémon', themes: [['kitchen appliances', 'theme']] },
};
test('every template has an idea fixture', () => assert.deepEqual(TEMPLATES.map(t => t.id).filter(id => !IDEAS[id]), []));

const pickOf = id => ({ title: `${IDEAS[id].game} Remix`, premise: `${IDEAS[id].idea}. Win the game.`,
  primary: { name: IDEAS[id].game, kind: 'game', template: id }, games: [], themes: IDEAS[id].themes.map(([name, kind]) => ({ name, kind })), readings: [], mechanics: [] });
/** A pick from its parts (title and premise filled). */
const pickWith = ({ primary, games = [], themes = [], readings = [], mechanics = [] }) => ({ title: 'T', premise: 'P.', primary, games, themes, readings, mechanics });
const game = (name, kind, template, relation) => ({ name, kind, template, ...(relation ? { relation } : {}) });
const theme = id => IDEAS[id].themes[0][0];
/** A slot's tune path (its description starts with it). */
const slotPath = p => String(p.description).split(':')[0];

/** A reply function for one template's forms: the pick, each tune param at its current value, names from `nameFor`. */
function replies(id, nameFor = k => `${theme(id)} ${k}`.slice(0, 40)) {
  const t = templateById(id);
  return req => {
    const name = req.schema.name, props = req.schema.schema.properties;
    if (name === 'pick_templates') return JSON.stringify(pickOf(id));
    if (name === 'frame_tune') return JSON.stringify(Object.fromEntries(Object.entries(props).map(([k, p]) => {
      if (k === 'logline') return [k, `${IDEAS[id].game} in ${theme(id)}.`];
      const target = tuneTarget(t.doc, slotPath(p), registry);
      return [k, target.instances[0].with?.[target.param] ?? target.spec.default];
    })));
    // A content form: an object per section, per entry, a slot per display-text field (a field re-ask: its slots
    // directly). A slot is answered for its entry ('<entry> <field>', the field left out for a name).
    const names = (ps, entry = null) => Object.fromEntries(Object.entries(ps).map(([k, p]) => [k, p.type === 'object' ? names(p.properties, k) : nameFor(entry === null ? k : k === 'name' ? entry : `${entry} ${k}`, req)]));
    return JSON.stringify(names(props));
  };
}
/** A fake model for one template's idea. */
const ideaWriter = id => fakeWriter([replies(id)]);

function memoryCtx() {
  const versions = [], stages = [], checkpoints = {};
  return { versions, stages, checkpoints, ctx: {
    stage(name, detail = {}) { stages.push({ name, ...detail }); }, draft() {}, checkpoint(name, value) { checkpoints[name] = value; },
    async publish(p) { const r = { version: versions.length + 1, ...p }; versions.push(r); return r; },
    store: { async updateMeta() {}, async version(_, v) { return versions[v - 1]; } },
  } };
}

/** What OpenAI strict json_schema accepts: closed objects, every property required. */
function strictProblems(schema, path = '$', out = []) {
  if (schema.anyOf) schema.anyOf.forEach((s, i) => strictProblems(s, `${path}|${i}`, out));
  if (schema.type === 'object') {
    if (schema.additionalProperties !== false) out.push(`${path}: open object`);
    const keys = Object.keys(schema.properties || {});
    if (JSON.stringify([...(schema.required || [])].sort()) !== JSON.stringify([...keys].sort())) out.push(`${path}: not every property required`);
    for (const k of keys) { if (k.endsWith('_json')) out.push(`${path}.${k}: free JSON`); strictProblems(schema.properties[k], `${path}.${k}`, out); }
  }
  if (schema.type === 'array') strictProblems(schema.items, `${path}[]`, out);
  return out;
}
/** Does a value satisfy a strict schema (the dialect the forms use)? */
function accepts(s, v) {
  if (s.anyOf) return s.anyOf.some(x => accepts(x, v));
  if (s.type === 'null') return v === null;
  if (s.enum && !s.enum.includes(v)) return false;
  if (s.type === 'string') return typeof v === 'string' && (!s.pattern || new RegExp(s.pattern, 'u').test(v));
  if (s.type === 'boolean') return typeof v === 'boolean';
  if (s.type === 'number' || s.type === 'integer') return typeof v === 'number' && Number.isFinite(v) && (s.type !== 'integer' || Number.isInteger(v)) && (s.minimum === undefined || v >= s.minimum) && (s.maximum === undefined || v <= s.maximum);
  if (s.type === 'array') return Array.isArray(v) && v.every(x => accepts(s.items, x));
  if (s.type === 'object') return v && typeof v === 'object' && Object.keys(v).every(k => k in s.properties) && s.required.every(k => k in v && accepts(s.properties[k], v[k]));
  return false;
}

test('pickForm: one strict form; one primary object, other games and themes in their own lists, enums by kind, no free JSON', () => {
  const f = pickForm(TEMPLATES, registry);
  assert.equal(f.name, 'pick_templates');
  assert.deepEqual(strictProblems(f.schema), []);
  const p = f.schema.properties, ids = [...TEMPLATES.map(t => t.id), 'none'];
  assert.deepEqual(Object.keys(p), ['title', 'premise', 'primary', 'games', 'themes', 'readings', 'mechanics']);
  assert.equal(p.primary.type, 'object', 'exactly one primary: an object, not a list');
  assert.deepEqual(Object.keys(p.primary.properties), ['name', 'kind', 'template']);
  assert.deepEqual(p.primary.properties.kind.enum, ['game', 'genre']);
  assert.deepEqual(p.primary.properties.template.enum, ids);
  assert.deepEqual(Object.keys(p.games.items.properties), ['name', 'kind', 'template', 'relation']);
  assert.deepEqual(p.games.items.properties.kind.enum, ['game', 'genre']);
  assert.deepEqual(p.games.items.properties.template.enum, ids);
  assert.deepEqual(p.games.items.properties.relation.enum, ['nested', 'union']);
  assert.deepEqual(Object.keys(p.themes.items.properties), ['name', 'kind'], 'a theme has no template and no relation');
  assert.deepEqual(p.themes.items.properties.kind.enum, ['theme', 'setting', 'character']);
  assert.deepEqual([...LOOP_KINDS], p.primary.properties.kind.enum); assert.deepEqual([...THEME_KINDS], p.themes.items.properties.kind.enum);
  assert.deepEqual([...PICK_KINDS], [...LOOP_KINDS, ...THEME_KINDS]); assert.deepEqual([...PLAYED_RELATIONS], p.games.items.properties.relation.enum);
  for (const k of ['title', 'premise']) assert.ok(p[k].pattern, `${k} must be written`);
  for (const s of [p.primary, p.games.items, p.themes.items]) assert.ok(s.properties.name.pattern, 'a concept is named');
  // The templates offered are those the catalogue can compose.
  assert.deepEqual(offeredTemplates(TEMPLATES, registry).map(t => t.id), TEMPLATES.map(t => t.id));
  assert.deepEqual(offeredTemplates(TEMPLATES, { has: () => false }), []);
});

/** Every concept value the pick form allows at one list: the product of its enums, named 'X'. */
function allowedConcepts(itemSchema) {
  const enums = Object.entries(itemSchema.properties).filter(([, s]) => s.enum);
  return enums.reduce((acc, [k, s]) => acc.flatMap(c => s.enum.map(v => ({ ...c, [k]: v }))), [{ name: 'X' }]);
}

test('the pick form makes every structurally invalid pick inexpressible; every pick it allows passes the structural check', () => {
  const f = pickForm(TEMPLATES, registry), p = f.schema.properties, ctx = { templates: TEMPLATES, registry };
  const ok = pickWith({ primary: game('Pac-Man', 'game', 'maze-chase'), themes: [{ name: 'library', kind: 'setting' }] });
  assert.ok(accepts(f.schema, ok));
  // Each structural mistake of the old flat concept list, written in the new form's terms: the form allows none of them.
  const invalid = {
    'two primaries': { ...ok, primary: [game('Mario', 'game', 'none'), game('platformer', 'genre', 'none')] },
    'no primary': (({ primary, ...rest }) => rest)(ok),
    'a theme as the primary': { ...ok, primary: game('library', 'setting', 'none') },
    'the primary with a relation': { ...ok, primary: game('Pac-Man', 'game', 'maze-chase', 'primary') },
    'a game only a theme (a game in themes)': { ...ok, themes: [{ name: 'Mario game', kind: 'game' }] },
    'a genre only a theme': { ...ok, themes: [{ name: 'platformer', kind: 'genre' }] },
    'a theme with a template': { ...ok, themes: [{ name: 'library', kind: 'setting', template: 'race' }] },
    'a theme with a relation': { ...ok, themes: [{ name: 'library', kind: 'setting', relation: 'nested' }] },
    'a setting played (in games)': { ...ok, games: [game('library', 'setting', 'none', 'nested')] },
    'a character played': { ...ok, games: [game('Sonic', 'character', 'none', 'union')] },
    'a second primary in games': { ...ok, games: [game('Mario Kart', 'game', 'race', 'primary')] },
    'a game related as a theme': { ...ok, games: [game('Mario Kart', 'game', 'race', 'theme')] },
    'a template that does not exist': { ...ok, primary: game('Pac-Man', 'game', 'pacman') },
    'an unknown kind': { ...ok, primary: game('Pac-Man', 'arcade', 'maze-chase') },
    'an unnamed concept': { ...ok, primary: game('', 'game', 'maze-chase') },
    'no title': { ...ok, title: ' ' },
  };
  const EXTRA_FIELD = new Set(['the primary with a relation', 'a theme with a template', 'a theme with a relation']);
  for (const [what, v] of Object.entries(invalid)) {
    assert.equal(accepts(f.schema, v), false, `the form allows ${what}`);
    // The reply as the pipeline narrows it: a field the form does not have (a relation on the primary, a template or
    // relation on a theme) is dropped and never reaches composition; anything else the check (the same schema) rejects.
    const narrowed = narrowPick(v);
    if (EXTRA_FIELD.has(what)) assert.deepEqual(narrowed, narrowPick(ok), `${what}: narrowing drops the field`);
    else assert.ok(checkPick(narrowed, ctx).problems.some(x => x.code === 'pick_form'), `the check rejects ${what}`);
  }
  // Every value the form allows at each slot passes the structural check (pick_form), for every slot combination.
  for (const primary of allowedConcepts(p.primary)) for (const g of [null, ...allowedConcepts(p.games.items)]) for (const t of [null, ...allowedConcepts(p.themes.items)]) {
    const v = pickWith({ primary, games: g ? [g] : [], themes: t ? [t] : [] });
    assert.ok(accepts(f.schema, v));
    assert.deepEqual(checkPick(v, ctx).problems.filter(x => x.code === 'pick_form'), [], JSON.stringify(v));
  }
});
test('checkPick: the form\'s schema (pick_form) and the catalogue rules, each with a declared stable code; a none game goes to the step path', () => {
  const ctx = { templates: TEMPLATES, registry };
  const codes = pick => checkPick(pick, ctx).problems.map(p => `${p.code}@${p.field}`);
  assert.deepEqual(Object.keys(PICK_RULES), ['pick_form', 'pick_nested_no_entry', 'pick_nested_no_outcome', 'pick_reading_unknown', 'pick_reading_duplicate', 'pick_reading_invalid', 'pick_reading_no_primary', 'pick_reading_fails']);
  for (const id of Object.keys(IDEAS)) assert.deepEqual(codes(pickOf(id)), []);
  // A writer that does not enforce the schema is held to it: each finding names its field.
  assert.deepEqual(codes({ ...pickOf('race'), title: ' ', premise: '' }), ['pick_form@title', 'pick_form@premise']);
  assert.deepEqual(codes(pickWith({ primary: game('library', 'setting', 'none') })), ['pick_form@primary.kind']);
  assert.deepEqual(codes(pickWith({ primary: game('Pac-Man', 'game', 'pacman') })), ['pick_form@primary.template']);
  assert.deepEqual(codes(pickWith({ primary: game('Pac-Man', 'game', 'maze-chase'), games: [game('Kart', 'game', 'race', 'theme')], themes: [{ name: 'Mario', kind: 'game' }] })), ['pick_form@games[0].relation', 'pick_form@themes[0].kind']);
  // nested only onto a primary whose loops declare an entry event (card.loop.involves): the race's declare none.
  // (and the maze chase plays no loop an encounter enters: both findings name the field)
  assert.deepEqual(codes(pickWith({ primary: game('Mario Kart', 'game', 'race'), games: [game('Pac-Man', 'game', 'maze-chase', 'nested')] })), ['pick_nested_no_entry@games[0].relation', 'pick_nested_no_outcome@games[0].relation']);
  assert.deepEqual(codes(pickWith({ primary: game('Pac-Man', 'game', 'maze-chase'), games: [game('Mario Kart', 'game', 'race', 'nested')] })), []);
  assert.deepEqual(codes(pickWith({ primary: game('Mario Kart', 'game', 'race'), games: [game('Pac-Man', 'game', 'maze-chase', 'union')] })), []);
  // nested only a game whose template plays a loop an encounter can enter (card.loop.outcome, card.engage.encounter.start).
  assert.deepEqual(codes(pickWith({ primary: game('Chess', 'game', 'board'), games: [game('Pac-Man', 'game', 'maze-chase', 'nested')] })), ['pick_nested_no_outcome@games[0].relation']);
  assert.deepEqual(codes(pickWith({ primary: game('Chess', 'game', 'board'), games: [game('Pokémon', 'game', 'creature-battle', 'nested')] })), []);
  // A game or genre no template is: the step path, not a problem.
  assert.deepEqual(checkPick(pickWith({ primary: game('Tetris', 'game', 'none'), themes: [{ name: 'space', kind: 'setting' }] }), ctx), { problems: [], stepPath: ['Tetris'] });
  assert.deepEqual(checkPick(pickWith({ primary: game('Pac-Man', 'game', 'maze-chase'), games: [game('roguelike', 'genre', 'none', 'union')] }), ctx).stepPath, ['roguelike']);
});

test('"a Mario game but with Sonic as the character": one primary (the game, with its genre\'s template), Sonic a character theme', () => {
  const f = pickForm(TEMPLATES, registry), ctx = { templates: TEMPLATES, registry };
  // The answer the live pick failed with (Mario game and platformer both primary; the game marked theme) cannot be written.
  assert.equal(accepts(f.schema, pickWith({ primary: [game('Mario game', 'game', 'none'), game('platformer', 'genre', 'none')], themes: [{ name: 'Sonic', kind: 'character' }] })), false);
  assert.equal(accepts(f.schema, pickWith({ primary: game('platformer', 'genre', 'none'), themes: [{ name: 'Mario game', kind: 'game' }, { name: 'Sonic', kind: 'character' }] })), false);
  // The answer the form asks for: no template is a platformer in this catalogue, so the game goes to the step path.
  const pick = pickWith({ primary: game('Mario', 'game', 'none'), themes: [{ name: 'Sonic', kind: 'character' }] });
  assert.ok(accepts(f.schema, pick));
  assert.deepEqual(checkPick(pick, ctx), { problems: [], stepPath: ['Mario'] });
  // With a template for the game's genre, the character themes it: no adapter, kept for the content forms.
  const c = composeTemplates(pickWith({ primary: game('Mario', 'game', 'maze-chase'), themes: [{ name: 'Sonic', kind: 'character' }] }), ctx);
  assert.deepEqual(c.problems, []); assert.equal(c.template.id, 'maze-chase');
  assert.deepEqual(c.themes, [{ name: 'Sonic', kind: 'character' }]);
  // The prompt says a named game and its genre are one concept.
  assert.match(pickSystem(TEMPLATES, registry), /A named game and its genre are one concept/);
});

test('pickSystem lists every template under the loops its cards declare (card.mode loop, interaction, opponent), with its concept line', () => {
  const system = pickSystem(TEMPLATES, registry);
  const blocks = system.split('\nLoop ').slice(1).map(b => b.split('\n\n')[0].split('\n'));
  const listed = blocks.flatMap(([header, ...lines]) => lines.map(line => ({ header, line })));
  assert.deepEqual(listed.map(x => x.line.slice(2).split(':')[0]).sort(), TEMPLATES.map(t => t.id).sort(), 'each template once');
  for (const t of TEMPLATES) {
    const { header, line } = listed.find(x => x.line.startsWith(`- ${t.id}: `));
    assert.ok(line.includes(t.concept), `${t.id}: its concept line`);
    const { loops } = templateLoops(t, registry);
    assert.ok(loops.length, `${t.id} carries a loop`);
    for (const l of loops) for (const s of [l.loop, ...l.interactions, String(l.opponent)]) assert.ok(header.includes(s), `${t.id}: '${s}' from its card in '${header}'`);
  }
  // Grouping follows the cards: two templates whose cards declare the same loops share one header.
  const twin = { ...templateById('race'), id: 'race-2', concept: 'Another race.' };
  const twins = pickSystem([...TEMPLATES, twin], registry).split('\nLoop ').find(b => b.includes('- race-2:'));
  assert.ok(twins.includes('- race: '), 'race and race-2 share the race loop header');
});

for (const t of TEMPLATES) test(`compose ${t.id} + theme: the template's document, the pick's title and premise, the theme kept for the content forms`, () => {
  const before = structuredClone(t.doc);
  const c = composeTemplates(pickOf(t.id), { templates: TEMPLATES, registry });
  assert.deepEqual(c.problems, []); assert.deepEqual(c.stepPath, []);
  assert.equal(c.template, t);
  assert.deepEqual(c.themes, IDEAS[t.id].themes.map(([name, kind]) => ({ name, kind })));
  const { title, plot, ...rest } = c.doc, { title: _, plot: tplot, ...trest } = t.doc;
  assert.deepEqual(rest, trest, 'structure is the template\'s, untouched');
  assert.equal(title, pickOf(t.id).title);
  assert.deepEqual(plot, { ...(tplot || {}), premise: pickOf(t.id).premise });
  assert.deepEqual(t.doc, before, 'the template itself is never mutated');
  assert.ok(preflight(structuredClone(c.doc), registry, logic).ok);
});

test('nested and union compose from declarations; one that does not fails with its code, naming both templates and what is missing', () => {
  const ctx = { templates: TEMPLATES, registry, logic };
  const chess = composeTemplates(pickWith({ primary: game('Chess', 'game', 'board'), games: [game('Pokémon', 'game', 'creature-battle', 'nested')], themes: [{ name: 'Pokémon', kind: 'theme' }] }), ctx);
  assert.deepEqual(chess.problems, []);
  assert.deepEqual(chess.parts.map(p => p.template.id), ['board', 'creature-battle']);
  assert.deepEqual(chess.joins.map(j => [j.relation, j.template, j.on]), [['nested', 'creature-battle', 'attack_hit']]);
  const nested = chess.doc.systems.filter(s => s.use === 'engine.adapt.nested');
  assert.equal(nested.length, 1);
  assert.deepEqual([nested[0].with.on, nested[0].with.inner], ['attack_hit', ['gameplay.creature.battle']]);
  assert.ok(chess.doc.systems.some(s => s.use === 'engine.adapt.skin'), 'species skinned onto the pieces');
  assert.deepEqual(chess.template.tune, [...templateById('board').tune, ...templateById('creature-battle').tune], 'the composed tune is every part\'s');
  assert.ok(preflight(structuredClone(chess.doc), registry, logic).ok);
  // A union: the race's loop on the platformer's level. Its checkpoints are bound to the level's zones, its rivals are
  // seated beside the player (their track positions do not carry), and the kart that moved its own player is not
  // carried: the player and how it moves are the primary's (compose.js uniteDocuments).
  const sonic = composeTemplates(pickWith({ primary: game('Sonic', 'game', 'platformer'), games: [game('racing', 'genre', 'race', 'union')] }), ctx);
  assert.deepEqual(sonic.problems, []);
  assert.deepEqual(sonic.doc.spaces.map(s => s.id), ['level']);
  const race = sonic.doc.systems.find(s => s.use === 'gameplay.race');
  assert.deepEqual(race.with.checkpoints, templateById('platformer').doc.spaces[0].zones.map(z => z.id));
  assert.deepEqual(sonic.joins.map(j => [j.relation, j.template, j.replaced.movement, j.replaced.seated.length]), [['union', 'race', ['gameplay.vehicle.car', 'gameplay.vehicle.core'], 3]]);
  assert.ok(preflight(structuredClone(sonic.doc), registry, logic).ok);
  // A union that does not compose fails with its code, naming both templates: the runner's loop is its world's.
  const run = composeTemplates(pickWith({ primary: game('Mario Kart', 'game', 'race'), games: [game('runner', 'genre', 'runner', 'union')] }), ctx);
  assert.equal(run.doc, null);
  assert.deepEqual(run.problems.map(p => [p.code, p.path]), [['union_world_loop', 'games[0]']]);
  for (const x of ["union", "'runner'", "'race'"]) assert.ok(run.problems[0].message.includes(x), `${x}: ${run.problems[0].message}`);
  // The same template twice would repeat its ids: a problem, never a silent merge.
  const twice = composeTemplates(pickWith({ primary: game('Chess', 'game', 'board'), games: [game('Pokémon', 'game', 'creature-battle', 'nested'), game('Pokémon', 'game', 'creature-battle', 'nested')] }), ctx);
  assert.deepEqual(twice.problems.map(p => [p.code, p.path]), [['compose_id_collision', 'games[1].template']]);
});

test('content forms: one strict form per template of the composition (a slot per display-text field of every entry it brought, grouped by section and entry; ids fixed by code), plus frame_tune', () => {
  const expected = { 'maze-chase': ['content_archetypes', 'content_statuses', 'content_blocks'], race: ['content_archetypes', 'zones_circuit'] };
  for (const t of TEMPLATES) {
    const c = composeTemplates(pickOf(t.id), { templates: TEMPLATES, registry }), doc = c.doc;
    const sections = textSections(doc, registry);
    if (expected[t.id]) assert.deepEqual(sections.map(s => s.form), expected[t.id]);
    assert.deepEqual(c.parts.map(p => p.template.id), [t.id]);
    const f = conceptForm(doc, c.parts[0], 0, registry);
    assert.deepEqual(strictProblems(f.schema.schema), []);
    assert.deepEqual(Object.keys(f.schema.schema.properties), sections.map(s => s.form), `${t.id}: one object per section with display text`);
    const all = (n, bad = false) => Object.fromEntries(sections.map((s, si) => [s.form, Object.fromEntries(s.entries.map((e, i) => [e.key, Object.fromEntries(e.slots.map(x => [x.key, bad && si === 0 && i === 0 && x === e.slots[0] ? ' ' : 'x'.repeat(n)]))]))]));
    for (const s of sections) {
      const slots = f.schema.schema.properties[s.form];
      assert.deepEqual(Object.keys(slots.properties), s.entries.map(e => e.key), `${s.form}: an object per entry with display text`);
      for (const e of s.entries) assert.deepEqual(Object.keys(slots.properties[e.key].properties), e.slots.map(x => x.key));
      const name = slots.properties[s.entries[0].key].properties.name;
      if (name) { assert.deepEqual([name.type, name.pattern], ['string', NAME_PATTERN]); assert.equal(accepts(name, ''), false); assert.equal(accepts(name, 'x'.repeat(41)), false); }
    }
    assert.deepEqual(f.check(f.narrow(all(20))), []);
    const first = sections[0].entries[0];
    assert.deepEqual(f.check(f.narrow(all(20, true))).map(p => [p.code, p.field]), [['text_invalid', `${sections[0].form}.${first.key}.${first.slots[0].key}`]]);
    const frame = frameTuneForm(c.template, doc, cat);
    assert.deepEqual(strictProblems(frame.schema.schema), []);
    assert.deepEqual(frame.slots.map(s => s.path), tunePaths(t));
  }
  // Composed: each template themes what it brought, in its own form.
  const chess = composeTemplates(pickWith({ primary: game('Chess', 'game', 'board'), games: [game('Pokémon', 'game', 'creature-battle', 'nested')] }), { templates: TEMPLATES, registry });
  const forms = chess.parts.map((p, i) => conceptForm(chess.doc, p, i, registry));
  assert.deepEqual(forms.map(f => f.schema.name), ['names_board', 'names_creature_battle']);
  const ids = forms.map(f => f.sections.flatMap(s => s.entries.map(e => `${s.at}:${e.id}`)));
  assert.deepEqual(ids[0].filter(id => ids[1].includes(id)), [], 'no entry is themed twice');
  assert.deepEqual([...ids[0], ...ids[1]].sort(), textSections(chess.doc, registry).flatMap(s => s.entries.map(e => `${s.at}:${e.id}`)).sort(), 'every entry with display text is in one form');
});

test('content forms cover every display-text field of every template document, alone and in every declared nested composition', () => {
  const covered = (doc, parts) => {
    const forms = parts.map((p, i) => conceptForm(doc, p, i, registry)).filter(Boolean);
    const slots = forms.flatMap(f => f.sections.flatMap(s => s.entries.flatMap(e => e.slots.map(x => `${s.at}|${e.id}|${x.path.join('.')}`))));
    const all = textSections(doc, registry).flatMap(s => s.entries.flatMap(e => e.slots.map(x => `${s.at}|${e.id}|${x.path.join('.')}`)));
    assert.deepEqual([...slots].sort(), [...all].sort(), 'each display-text field in exactly one form');
    // Applying a themed answer rewrites exactly those fields.
    const out = structuredClone(doc);
    for (const f of forms) f.apply(out, f.narrow(Object.fromEntries(f.sections.map(s => [s.form, Object.fromEntries(s.entries.map(e => [e.key, Object.fromEntries(e.slots.map(x => [x.key, 'Themed']))]))]))));
    assert.ok(textSections(out, registry).every(s => s.entries.every(e => e.slots.every(x => x.text === 'Themed'))));
  };
  for (const t of TEMPLATES) { const c = composeTemplates(pickOf(t.id), { templates: TEMPLATES, registry }); covered(c.doc, c.parts); }
  const chess = composeTemplates(pickWith({ primary: game('Chess', 'game', 'board'), games: [game('Pokémon', 'game', 'creature-battle', 'nested')] }), { templates: TEMPLATES, registry });
  covered(chess.doc, chess.parts);
});

test('content forms are asked in parallel; a failing name re-asks only that field, then escalates that form once', async () => {
  const t = templateById('maze-chase'), doc = composeTemplates(pickOf(t.id), { templates: TEMPLATES, registry }).doc;
  let inFlight = 0, most = 0;
  const base = ideaWriter(t.id);
  const writer = { ...base, async complete(req) { inFlight++; most = Math.max(most, inFlight); await new Promise(r => setTimeout(r, 20)); inFlight--; return base.complete(req); } };
  const calls = [];
  const r = await writeContent({ writer, escalate: null, attempts: 2, template: t, doc, pick: pickOf(t.id), themes: [{ name: 'haunted library', kind: 'setting' }], registry, logic, calls, clock: { codeMs: 0 } });
  assert.equal(most, 2, 'frame_tune and the names form are in flight together');
  assert.equal(r.rounds, 1);
  assert.equal(r.doc.content.archetypes.find(a => a.id === 'hero').name, 'haunted library hero');
  assert.equal(r.doc.logline, 'Pac-Man in haunted library.');
  for (const c of base.calls) assert.match(c.system, /haunted library \(setting\)/), assert.match(c.system, /Premise: Pac-Man in a haunted library/);
  // A bad name: only that field is asked again; still bad, the escalation writer gets that field alone.
  const bad = fakeWriter([replies(t.id, k => (k === 'hero' || k.startsWith('field_') ? '' : 'Fine'))]);
  // (the hero's name slot is answered for 'hero': see replies)
  const code = fakeWriter([req => JSON.stringify(Object.fromEntries(Object.keys(req.schema.schema.properties).map(k => [k, 'Ghost Reader'])))], { model: 'escalation' });
  const c2 = [];
  const r2 = await writeContent({ writer: bad, escalate: code, attempts: 2, template: t, doc, pick: pickOf(t.id), themes: [], registry, logic, calls: c2, clock: { codeMs: 0 } });
  const names = c2.filter(c => c.form === 'names_maze_chase');
  assert.deepEqual(names.map(c => [c.fields ?? null, Boolean(c.escalated)]), [[null, false], [['content_archetypes.hero.name'], false], [['content_archetypes.hero.name'], true]]);
  assert.equal(code.calls.length, 1); assert.deepEqual(Object.keys(code.calls[0].schema.schema.properties), ['field_1']);
  assert.equal(r2.doc.content.archetypes.find(a => a.id === 'hero').name, 'Ghost Reader');
  assert.equal(r2.doc.content.archetypes.find(a => a.id === 'pellet').name, 'Fine', 'answers that passed are kept');
  assert.equal(r2.rounds, 3);
});

test('tune slots conform to their card specs across all templates: every declared value is allowed and preflights; out of range is not allowed', () => {
  for (const t of TEMPLATES) {
    const doc = composeTemplates(pickOf(t.id), { templates: TEMPLATES, registry }).doc;
    const frame = frameTuneForm(t, doc, cat);
    const current = Object.fromEntries(frame.slots.map(s => [s.key, tuneTarget(doc, s.path, registry).instances[0].with?.[s.param] ?? s.spec.default]));
    const answer = (key, value) => ({ logline: 'A line.', ...current, [key]: value });
    for (const s of frame.slots) {
      const slot = frame.schema.schema.properties[s.key], spec = s.spec;
      assert.equal(slot.type, spec.type === 'integer' ? 'integer' : spec.type, `${t.id} ${s.path}: type`);
      /** Values the slot allows (the template's playable range of the card's param: s.spec): its bounds, a midpoint, the template's value, every option. */
      let allowed = [];
      if (spec.type === 'number' || spec.type === 'integer') {
        assert.equal(slot.minimum, spec.min, `${s.path}: minimum`); assert.equal(slot.maximum, spec.max, `${s.path}: maximum`);
        const lo = typeof spec.min === 'number', hi = typeof spec.max === 'number';
        // An open end is declared too: sample past the declared bound (min + 100, max - 100) on that side.
        const mid = lo && hi ? (spec.min + spec.max) / 2 : lo ? spec.min + 100 : hi ? spec.max - 100 : (spec.default ?? 0) + 1;
        allowed = [lo ? spec.min : undefined, hi ? spec.max : undefined, spec.type === 'integer' ? Math.round(mid) : mid, current[s.key]].filter(v => v !== undefined);
        for (const out of [...(lo ? [spec.min - 1] : []), ...(hi ? [spec.max + 1] : []), ...(spec.type === 'integer' ? [Math.round(mid) + 0.5] : [])]) assert.equal(accepts(slot, out), false, `${t.id} ${s.path}: ${out} is outside the playable range, so the form does not allow it`);
      } else if (spec.type === 'boolean') allowed = [true, false];
      else if (spec.type === 'string' && spec.options?.length) { assert.deepEqual(slot.enum, spec.options.map(String)); allowed = spec.options; assert.equal(accepts(slot, '__undeclared__'), false); }
      else if (spec.type === 'string') allowed = [spec.default, current[s.key]].filter(v => v !== undefined);
      else assert.fail(`${t.id} ${s.path}: tune params are scalars (${spec.type})`);
      assert.ok(allowed.length, `${t.id} ${s.path}: sampled`);
      for (const v of allowed) {
        assert.ok(accepts(slot, v), `${t.id} ${s.path}: the form allows ${JSON.stringify(v)}`);
        assert.deepEqual(frame.check(frame.narrow(answer(s.key, v))), [], `${t.id} ${s.path}=${JSON.stringify(v)} preflights`);
      }
      // A free-text param (no declared set): any value preflight rejects comes back as that slot's problem, never into the document.
      if (spec.type === 'string' && !spec.options?.length) {
        const problems = frame.check(frame.narrow(answer(s.key, '__undeclared__')));
        assert.ok(problems.every(p => p.field === s.key), `${t.id} ${s.path}: ${JSON.stringify(problems)}`);
      }
    }
  }
});

test('frame_tune: a slot allows the template\'s playable range, not the card\'s; its check holds writers that ignore the schema to it, and names the card\'s rules on the param', () => {
  const t = TEMPLATES.find(x => x.id === 'race'), doc = composeTemplates(pickOf('race'), { templates: TEMPLATES, registry }).doc;
  const frame = frameTuneForm(t, doc, cat), laps = frame.slots.find(s => s.path === 'gameplay.race.laps');
  assert.equal(laps.spec.max, 5, 'the template\'s playable range');
  assert.equal(registry.get('gameplay.race').card.params.laps.max, 99, 'the card allows more');
  assert.equal(frame.schema.schema.properties[laps.key].maximum, 5);
  const current = Object.fromEntries(frame.slots.map(s => [s.key, tuneTarget(doc, s.path, registry).instances[0].with?.[s.param]]));
  const problems = frame.check(frame.narrow({ logline: 'A line.', ...current, [laps.key]: 99 }));
  assert.deepEqual(problems.map(p => [p.code, p.field]), [['tune_range', laps.key]], '99 laps preflights, but is outside the playable range');
  const dungeon = TEMPLATES.find(x => x.id === 'dungeon'), d = composeTemplates(pickOf('dungeon'), { templates: TEMPLATES, registry }).doc;
  const rooms = frameTuneForm(dungeon, d, cat).schema.schema.properties.engine__generate__dungeon__rooms__rooms;
  assert.match(rooms.description, /rule dungeon_keys_many: rooms is at least the number of keys \+ 2/);
});

test('the pick: a failing field is re-asked alone, then the escalation writer once, then 422 template_pick_failed with the problems', async () => {
  // A catalogue rule the form cannot express (a nested game needs an entry event on the primary's loops).
  const bad = pickWith({ primary: game('Mario Kart', 'game', 'race'), games: [game('Pac-Man', 'game', 'maze-chase', 'nested')] });
  const w = fakeWriter([JSON.stringify(bad)]), code = fakeWriter([JSON.stringify({ field_1: 'nested' })], { model: 'escalation' });
  const calls = [];
  await assert.rejects(askPick({ writer: w, escalate: code, attempts: 2, prompt: 'Mario Kart with a Pac-Man maze', templates: TEMPLATES, registry, calls, clock: { codeMs: 0 } }),
    e => e.status === 422 && e.code === 'template_pick_failed' && e.problems.some(p => p.code === 'pick_nested_no_entry' && p.path === 'games[0].relation'));
  assert.deepEqual(calls.map(c => [c.fields ?? null, Boolean(c.escalated)]), [[null, false], [['games[0].relation'], false], [['games[0].relation'], true]]);
  assert.deepEqual(Object.keys(w.calls[1].schema.schema.properties), ['field_1'], 'the re-ask holds only the failing field');
  assert.deepEqual(w.calls[1].schema.schema.properties.field_1.enum, ['nested', 'union'], 'with the values the form allows there');
  assert.match(w.calls[0].system, /- maze-chase: Maze chase/); assert.match(w.calls[0].system, /- race: Racing/);
  // A field re-ask that fixes it: the pick passes with the other answers kept.
  const fixed = fakeWriter([JSON.stringify(bad), JSON.stringify({ field_1: 'union' })]);
  const ok = await askPick({ writer: fixed, escalate: null, attempts: 2, prompt: 'x', templates: TEMPLATES, registry, calls: [], clock: { codeMs: 0 } });
  assert.deepEqual(ok.pick, { ...bad, games: [{ ...bad.games[0], relation: 'union' }] });
  assert.equal(ok.calls, 2);
  // A writer that ignores the schema (a theme as the primary): the field is re-asked with the form's enum.
  const loose = fakeWriter([JSON.stringify(pickWith({ primary: game('library', 'setting', 'none') })), JSON.stringify({ field_1: 'game' })]);
  const r = await askPick({ writer: loose, escalate: null, attempts: 2, prompt: 'x', templates: TEMPLATES, registry, calls: [], clock: { codeMs: 0 } });
  assert.deepEqual(loose.calls[1].schema.schema.properties.field_1.enum, ['game', 'genre']);
  assert.equal(r.pick.primary.kind, 'game');
});

for (const id of Object.keys(IDEAS)) test(`create "${IDEAS[id].idea}": the template path publishes ${id} + theme in at most 6 calls and 2 rounds`, async () => {
  const writer = ideaWriter(id);
  const pipeline = createKernelPipeline({ catalogue: async () => cat, writers: { spec: writer } });
  const m = memoryCtx();
  const out = await pipeline({ gameId: 'g', prompt: IDEAS[id].idea, kind: 'create', seed: 11 }, m.ctx);
  assert.equal(m.versions.length, 1);
  const v = m.versions[0], report = v.report;
  assert.equal(v.stage, 'first_playable');
  assert.equal(report.path, 'template'); assert.deepEqual(report.templates, [id]);
  assert.equal(report.verified, true);
  assert.ok(report.modelCalls <= 6, `${report.modelCalls} calls`); assert.equal(report.modelCalls, writer.calls.length);
  assert.equal(report.modelRounds, 2);
  assert.ok(report.timings.composeMs < 1000, `composition ${report.timings.composeMs} ms`);
  for (const k of ['pickMs', 'contentMs', 'composeMs', 'gateMs', 'requestToFirstPlayableMs']) assert.equal(typeof report.timings[k], 'number', k);
  const fp = m.stages.find(s => s.name === 'first_playable');
  assert.deepEqual([fp.modelCalls, fp.modelRounds], [report.modelCalls, report.modelRounds]);
  assert.ok(!m.stages.some(s => s.name === 'decomposing' || s.name === 'detail'), 'no step path, no detail tasks');
  assert.equal(v.doc.title, pickOf(id).title); assert.equal(v.doc.seed, 11);
  assert.ok(v.doc.content.archetypes.every(a => a.name.startsWith(theme(id))), 'every archetype is named for the theme');
  assert.deepEqual(v.doc.systems.map(s => s.use), templateById(id).doc.systems.map(s => s.use), 'the template\'s structure, nothing added or dropped');
  assert.equal(out.path, 'template');
});

test('a pick with a game concept no template is runs the step path for the whole idea, and says so', async () => {
  const pipeline = createKernelPipeline({ catalogue: async () => cat, writers: { spec: mazeWriter() }, config: { maxDetailTasks: 0 } });
  const m = memoryCtx();
  await pipeline({ gameId: 'g', prompt: 'collect coins in a maze', kind: 'create', seed: 5 }, m.ctx);
  const v = m.versions[0];
  assert.equal(v.report.path, 'step');
  assert.deepEqual(v.report.templatePick.stepPath, ['coin maze']);
  assert.match(v.report.why, /no template is 'coin maze'/);
  assert.equal(typeof v.report.timings.pickMs, 'number');
  assert.ok(m.stages.some(s => s.name === 'decomposing'));
});
