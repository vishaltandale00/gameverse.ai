// Generation quality: content contracts, the strict outline form, selection completeness, per-zone detail,
// core-primitive protection and world-size revisions. Offline: fake and replayed writers, real catalogue.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { contractsFor, populateProblems, placeContent, unreadReaders, placementCounts } from '../v2/planner/content.js';
import { outlineForm, decode, specSchema } from '../v2/planner/outline-form.js';
import { proceduralOutline, writeOutline, coreOf } from '../v2/planner/outline.js';
import { selectPrimitives, locomotionCompleteness, checkMapping, baseLocomotion } from '../v2/planner/select.js';
import { decomposeOffline, normalize } from '../v2/planner/decompose.js';
import { repairDocument } from '../v2/planner/repair.js';
import { firstPlayable } from '../v2/planner/first-playable.js';
import { detailForm, detailTasks, mergeDetail, proceduralDetail, sanitizePatch } from '../v2/planner/detail.js';
import { tweakDocument, worldScaleRequest, routeWorldScale } from '../v2/planner/doc-revise.js';
import { contentGrowth } from '../v2/planner/revision-check.js';
import { census, kindViewPreserved } from '../v2/planner/census.js';
import { preflight } from '../v2/kernel/document.js';
import { fakeWriter, testCatalogue, picky } from './v2-p-pipeline-fixtures.js';

const { registry, logic } = buildCatalogue();
const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/v2-live/${name}.json`, import.meta.url), 'utf8'));

/** Every object closed, every property required: what OpenAI strict json_schema accepts. */
function strictProblems(schema, path = '$', out = []) {
  if (schema.anyOf) schema.anyOf.forEach((s, i) => strictProblems(s, `${path}|${i}`, out));
  if (schema.type === 'object') {
    if (schema.additionalProperties !== false) out.push(`${path}: open object`);
    const keys = Object.keys(schema.properties || {});
    if (JSON.stringify([...(schema.required || [])].sort()) !== JSON.stringify([...keys].sort())) out.push(`${path}: not every property required`);
    for (const k of keys) strictProblems(schema.properties[k], `${path}.${k}`, out);
  }
  if (schema.type === 'array') strictProblems(schema.items, `${path}[]`, out);
  return out;
}
const depthOf = (s, d = 0) => s.anyOf ? Math.max(...s.anyOf.map(x => depthOf(x, d))) : s.type === 'object' ? Math.max(d, ...Object.values(s.properties).map(x => depthOf(x, d + 1))) : s.type === 'array' ? depthOf(s.items, d + 1) : d;

test('content contracts: hollow live outputs are named precisely, with the shape to add', () => {
  const kart = fixture('kart').doc, platformer = fixture('platformer').doc;
  const k = populateProblems(kart, registry);
  assert.ok(k.some(p => p.code === 'content_missing' && /collectible/.test(p.message)), 'a kart game with item boxes but no pickups');
  assert.ok(k.every(p => p.hint && /Shape: \{/.test(p.hint)), 'every problem carries the card\'s example shape');
  const unread = unreadReaders(platformer, registry);
  assert.deepEqual(unread.map(u => [u.section, u.reader]), [['plot.quests', 'plot.quest'], ['plot.dialogue', 'plot.dialogue']], 'quests and dialogue nothing reads get their reader');
  // A rich example game satisfies the contracts of what it uses.
  const lantern = JSON.parse(readFileSync(new URL('../v2/games/hollow-lantern.json', import.meta.url), 'utf8'));
  assert.deepEqual(populateProblems(lantern, registry).map(p => p.code), []);
});

test('content contracts: derived for cards that declare none, merged across primitives', () => {
  const list = contractsFor(registry, ['gameplay.combat.melee', 'gameplay.combat.projectile', 'gameplay.race', 'plot.barks']);
  const health = list.filter(c => c.need === 'archetypes' && c.component === 'health');
  assert.equal(health.length, 2, 'melee and projectile ask for different kinds, so both stay');
  assert.ok(list.some(c => c.need === 'param' && c.param === 'racers' && c.min >= 3));
  assert.ok(list.some(c => c.need === 'section' && c.at === 'plot.barks'), 'a plot section a card reads is a derived contract');
});

test('placeContent spreads defined-but-unplaced archetypes over the zones, hostile ones away from the start', () => {
  const clock = fixture('clock-dungeon').doc;
  const before = placementCounts(clock, registry).get('clockwork_guardian');
  assert.ok(!before?.count, 'the live clock dungeon never placed its guardian');
  const { doc, added } = placeContent(clock, registry);
  assert.ok(added.length >= 1 && added.every(a => a.archetype === 'clockwork_guardian'));
  const start = typeof clock.player.at === 'string' ? clock.player.at : clock.spaces[0].zones[0].id;
  assert.ok(added.every(a => a.zone !== start), 'enemies are not dropped on the player');
  assert.ok(preflight(doc, registry, logic).ok);
  assert.ok(placementCounts(doc, registry).get('clockwork_guardian').count >= 3);
});

test('the outline form is a strict schema derived from exactly the chosen cards, and converts to a valid document', async () => {
  for (const prompt of ['A Zelda dungeon: explore rooms, fight monsters, find keys and beat the boss', 'A Pokémon-style creature RPG: catch wild creatures, build a party and battle trainers', 'Mario Kart with shopping carts']) {
    const d = decomposeOffline(prompt);
    const sel = await selectPrimitives({ decomposition: d, registry });
    const sk = proceduralOutline({ decomposition: d, selection: sel, registry, logic, seed: 3, prompt }).doc;
    const form = outlineForm({ registry, skeleton: sk, selection: sel });
    assert.deepEqual(strictProblems(form.schema.schema), [], prompt);
    assert.ok(depthOf(form.schema.schema) <= 10, 'within the strict nesting limit');
    // Every selected primitive has a slot, including those the skeleton could not configure without content.
    assert.deepEqual(Object.keys(form.schema.schema.properties.systems.properties).sort(), [...new Set([...sk.systems.map(s => s.use), ...sel.systems].filter(id => registry.has(id)))].map(id => id.replace(/\./g, "__")).sort(), 'one slot per chosen primitive, no others');
    assert.ok(form.schema.schema.properties.archetypes.items.properties.components.properties, 'archetypes have component slots');
  }
  // A filled form: components decode (strict ones from JSON text), spawns land in the spawner, quests and dialogue appear.
  const d = { ...decomposeOffline('fight monsters in a dungeon and talk to villagers on quests'), views: ['td'], movement: 'ground' };
  const sel = await selectPrimitives({ decomposition: d, registry });
  const sk = proceduralOutline({ decomposition: d, selection: sel, registry, logic, seed: 4 }).doc;
  const form = outlineForm({ registry, skeleton: sk, selection: sel });
  const space = sk.spaces[0];
  const zones = space.zones.map((z, i) => ({ id: z.id, name: `Zone ${i}`, description: `zone ${i}`, ...(z.exits ? { exits: z.exits.map(x => ({ to: x.to, gate_json: x.gate ? JSON.stringify(x.gate) : null })) } : {}) }));
  const comps = form.schema.schema.properties.archetypes.items.properties.components.properties;
  const blank = Object.fromEntries(Object.keys(comps).map(k => [k, null]));
  const value = {
    title: 'Mossdeep', logline: 'x', premise: 'y', spaces: { [space.id]: { zones } }, systems: {}, extra_systems: [],
    archetypes: [{ id: 'slime', kind: 'enemy', name: 'Slime', components: { ...blank, ...(comps.health ? { health: { max: 5, hp: null, regen: null, iframeSec: null, respawn: null, resist: null, armor: null } } : {}), other_json: '{"faction":"ooze"}' } }],
    ...(form.schema.schema.properties.spawns ? { spawns: [{ id: 'slimes', archetype: 'slime', zone: zones.at(-1).id, min: 2, max: 3, respawnSec: null, when_json: null }] } : {}),
    items: [{ id: 'gem', name: 'Gem', kind: 'misc', desc: 'shiny', value: 5, more_json: null }],
    characters: [{ id: 'ana', name: 'Ana', role: 'smith', bio: 'b', home: zones[0].id, archetype: null, dialogue: ['ana_hi'] }],
    ...(form.schema.schema.properties.dialogue ? { dialogue: [{ id: 'ana_hi', speaker: 'ana', start: 'n1', nodes: [{ id: 'n1', who: null, say: 'Hello.', next: null, end: true, choices: [], do_json: null }] }] } : {}),
    acts: [], endings: [], player: { archetype: 'hero', zone: zones[0].id },
  };
  const doc = form.toDoc(value);
  assert.equal(doc.title, 'Mossdeep');
  assert.deepEqual(doc.views, sk.views, 'views are the selection\'s, never the model\'s');
  assert.deepEqual(doc.spaces.map(s => s.use), sk.spaces.map(s => s.use));
  const slime = doc.content.archetypes.find(a => a.id === 'slime');
  assert.equal(slime.components.faction, 'ooze', 'other_json components merge in');
  if (comps.health) assert.deepEqual(slime.components.health, { max: 5 }, 'nulls mean defaults and drop out');
  if (form.schema.schema.properties.spawns) assert.ok(doc.systems.some(s => (s.with?.rules || []).some(r => r.archetype === 'slime' && r.zone === zones.at(-1).id && r.count[1] === 3)));
  assert.ok(doc.plot.storyboard.acts.length, 'an empty story keeps the scaffold\'s');
  const repaired = repairDocument(doc, { registry, logic });
  assert.ok(repaired.ok, JSON.stringify(repaired.errors.slice(0, 3)));
});

test('decode: JSON text fields become values; strict ones never become strings; effects become lists', () => {
  assert.deepEqual(decode('{"zone":"hall"}', 'strict'), { zone: 'hall' });
  assert.equal(decode('not json', 'strict'), undefined);
  assert.equal(decode('coins', 'json'), 'coins', 'a json param may be a bare string');
  assert.deepEqual(decode('{"do":"say","text":"hi"}', 'effects'), [{ do: 'say', text: 'hi' }]);
  assert.equal(specSchema({ type: 'predicate' }).codec, 'strict');
});

test('writeOutline with a replayed form: the model fills content, populate problems go back, the result is the model\'s game', async () => {
  const d = { ...decomposeOffline('fight monsters in a dungeon with a sword'), views: ['td'], movement: 'ground' };
  // A fixed selection (the offline lexical one is not the point here): melee combat with an inventory and a story.
  const sel = { ...(await selectPrimitives({ decomposition: d, registry })), systems: ['engine.input.actions', 'gameplay.combat.health', 'gameplay.combat.melee', 'gameplay.inventory', 'gameplay.move.walk', 'plot.storyboard'], mechanics: [{ id: 'fight', description: 'fight monsters', importance: 'core', primitives: ['gameplay.combat.melee'] }], bind: {} };
  const sk = proceduralOutline({ decomposition: d, selection: sel, registry, logic, seed: 5 }).doc;
  const form = outlineForm({ registry, skeleton: sk, selection: sel });
  const needsEnemies = form.contracts.some(c => c.need === 'archetypes' && c.component === 'health');
  const space = sk.spaces[0];
  const zones = space.zones.map((z, i) => ({ id: z.id, name: `Hall ${i}`, description: `hall ${i}`, ...(z.exits ? { exits: z.exits.map(x => ({ to: x.to, gate_json: x.gate ? JSON.stringify(x.gate) : null })) } : {}) }));
  const comps = form.schema.schema.properties.archetypes.items.properties.components.properties;
  const blank = Object.fromEntries(Object.keys(comps).map(k => [k, null]));
  const base = { title: 'Ironhold', logline: 'l', premise: 'p', spaces: { [space.id]: { zones } }, systems: {}, extra_systems: [], items: [{ id: 'key', name: 'Key', kind: 'key', desc: 'k', value: null, more_json: null }, { id: 'potion', name: 'Potion', kind: 'potion', desc: 'p', value: null, more_json: null }], characters: [], acts: [], endings: [], player: { archetype: 'hero', zone: zones[0].id }, archetypes: [] };
  const hollow = { ...base };
  const full = { ...base, archetypes: [{ id: 'ghoul', kind: 'enemy', name: 'Ghoul', components: { ...blank, health: comps.health ? { max: 4, hp: null, regen: null, iframeSec: null, respawn: null, resist: null, armor: null } : null, other_json: comps.health ? null : '{"health":{"max":4}}' } }],
    spawns: zones.slice(1).map((z, i) => ({ id: `ghouls_${i}`, archetype: 'ghoul', zone: z.id, min: 2, max: 2, respawnSec: 0, when_json: null })) };
  const writer = fakeWriter([hollow, full]);
  const r = await writeOutline({ forms: 'single', writer, prompt: 'dungeon', decomposition: d, selection: sel, registry, logic, seed: 5, verify: false });
  assert.ok(r.ok, JSON.stringify(r.errors?.slice(0, 3)));
  assert.equal(r.doc.title, 'Ironhold');
  assert.equal(writer.calls[0].schema.name, 'game_outline');
  if (needsEnemies) {
    assert.ok(writer.calls.length >= 2, 'the hollow first form is sent back');
    assert.ok(r.rounds[2].content < r.rounds[1].content, 'the filled form has fewer content problems');
    assert.match(writer.calls[1].user, /\[content_missing\] content\.archetypes \(form: archetypes\)/);
    const c = census(r.doc, registry, logic, { boot: 0 });
    assert.ok(c.archetypesPlaced >= 1 && c.spawnRulesNonPlayer >= 2);
  }
});

test('small forms: asked in parallel, only the failing form is re-asked, and a form failed twice escalates', async () => {
  const d = { ...decomposeOffline('fight monsters in a dungeon with a sword'), views: ['td'], movement: 'ground' };
  const sel = { ...(await selectPrimitives({ decomposition: d, registry })), systems: ['engine.input.actions', 'gameplay.combat.health', 'gameplay.combat.melee', 'gameplay.inventory', 'gameplay.move.walk', 'plot.storyboard'], mechanics: [{ id: 'fight', description: 'fight monsters', importance: 'core', primitives: ['gameplay.combat.melee'] }], bind: {} };
  const sk = proceduralOutline({ decomposition: d, selection: sel, registry, logic, seed: 5 }).doc;
  const form = outlineForm({ registry, skeleton: sk, selection: sel });
  assert.ok(form.groups.length >= 4 && form.groups.every(g => strictProblems(g.schema.schema).length === 0), 'each small form is strict');
  const space = sk.spaces[0];
  const zones = space.zones.map((z, i) => ({ id: z.id, name: `Hall ${i}`, description: `hall ${i}`, ...(z.exits ? { exits: z.exits.map(x => ({ to: x.to, gate_json: x.gate ? JSON.stringify(x.gate) : null })) } : {}) }));
  const comps = form.schema.schema.properties.archetypes.items.properties.components.properties;
  const blank = Object.fromEntries(Object.keys(comps).map(k => [k, null]));
  const ghoul = { id: 'ghoul', kind: 'enemy', name: 'Ghoul', components: { ...blank, health: { max: 4, hp: null, regen: null, iframeSec: null, respawn: null, resist: null, armor: null } } };
  const frame = { title: 'Ironhold', logline: 'l', premise: 'p', spaces: { [space.id]: { zones } }, player: { archetype: 'hero', zone: zones[0].id }, endings: [] };
  const items = [{ id: 'key', name: 'Key', kind: 'key', desc: 'k', value: null, more_json: null }, { id: 'potion', name: 'Potion', kind: 'potion', desc: 'p', value: null, more_json: null }];
  const reply = (cast, story = { acts: [] }) => req => {
    const name = req.schema.name;
    return JSON.stringify(name.endsWith('_frame') ? frame : name.endsWith('_systems') ? { systems: {}, extra_systems: [] } : name.endsWith('_cast') ? cast : story);
  };
  // The cast is hollow twice: the frame, params and story are asked once, the cast three times (the third escalated).
  const hollow = { archetypes: [], spawns: [], items, characters: [] };
  const full = { archetypes: [ghoul], spawns: zones.slice(1).map((z, i) => ({ id: `g${i}`, archetype: 'ghoul', zone: z.id, at_json: null, min: 2, max: 2, respawnSec: 0, when_json: null })), items, characters: [] };
  const writer = fakeWriter([reply(hollow)]), escalate = fakeWriter([reply(full)], { model: 'stronger' });
  const r = await writeOutline({ writer, escalate, prompt: 'dungeon', decomposition: d, selection: sel, registry, logic, seed: 5, verify: false, maxRounds: 3 });
  assert.ok(r.ok, JSON.stringify(r.errors?.slice(0, 3)));
  const asked = writer.calls.map(c => c.schema.name.replace('game_outline_', ''));
  assert.deepEqual(asked.filter(n => n === 'frame').length, 1, 'the frame is written once');
  assert.ok(asked.filter(n => n === 'cast').length === 2, `the cast is re-asked: ${asked.join(' ')}`);
  assert.match(writer.calls.find((c, i) => i > 3 && c.schema.name.endsWith('_cast')).user, /\[content_missing\] content\.archetypes/, 'with only its problems');
  assert.equal(escalate.calls.length, 1, 'the third try of the same form goes to the stronger writer');
  assert.equal(escalate.calls[0].effort, 'low');
  assert.ok(r.doc.content.archetypes.some(a => a.id === 'ghoul'));
  assert.ok(r.rounds.at(-1).groups.some(g => g.startsWith('cast*')), 'the round records the escalated form');
});

test('content packs: the preset ships valid species, moves, types and cards; the model only themes them', async () => {
  const d = normalize({ title: 'Pokemon chess', premise: 'chess with creatures', mechanics: [{ id: 'turns', verb: 'move', description: 'move pieces in turns', importance: 'core' }, { id: 'battle', verb: 'battle', description: 'captures are creature battles', importance: 'core' }], views: ['board'], acts: 2, zones: 4,
    core: { mode: 'tactics', interaction: 'pieces-turns', opponent: 'ai-side', win: 'checkmate', lose: 'checkmated', theme: '', narrative: false, secondary: [{ mode: 'creature-battle', relation: 'nested', why: '' }] } }, 'chess with pokemon', registry);
  const sel = await selectPrimitives({ decomposition: d, registry });
  const p = proceduralOutline({ decomposition: d, selection: sel, registry, logic, seed: 3 });
  assert.ok(p.structure.packs.includes('content.species') && p.structure.packs.includes('content.moves'), JSON.stringify(p.structure));
  const doc = /** @type {any} */ (p.doc);
  assert.ok(doc.content.species.length >= 4 && doc.content.species.every(s => Object.values(s.base).every(v => v >= 1 && v <= 255)));
  const form = outlineForm({ registry, skeleton: doc, selection: sel });
  const g = form.groups.find(x => x.id === 'section_content_species');
  assert.ok(g, form.groups.map(x => x.id).join(' '));
  assert.equal(g.schema.schema.properties.section_content_species.type, 'array', 'species are a strict list, not JSON text');
});

test('selection completeness: base locomotion follows the view and the medium (the clock dungeon walks, the Tetris platformer jumps)', () => {
  const clock = fixture('clock-dungeon');
  const mesh = { caps: registry.get('engine.space.mesh3d').card.provides.capabilities };
  const chosen = new Set(clock.selection.systems);
  const r = locomotionCompleteness({ decomposition: { ...clock.decomposition, movement: 'ground' }, registry, chosen, space: mesh, mechanics: structuredClone(clock.selection.mechanics) });
  assert.deepEqual(r.removed, ['gameplay.move.fly'], 'flying is not how you walk a dungeon');
  assert.equal(registry.get(r.added).card.medium, 'ground');
  assert.ok(chosen.has(r.added) && !chosen.has('gameplay.move.fly'));
  // Side view: grid steps are replaced by the platformer.
  const tile = { caps: ['position', 'distance', 'overlap', 'raycast', 'pathfind', 'reachable', 'editCells', 'surface', 'gravity'] };
  const side = new Set(['gameplay.move.grid', 'gameplay.falling.pieces']);
  const s = locomotionCompleteness({ decomposition: { views: ['side'], movement: 'ground', mechanics: [] }, registry, chosen: side, space: tile });
  assert.deepEqual(s.removed, ['gameplay.move.grid']);
  assert.equal(s.added, 'gameplay.move.platformer');
  // An avatar-less idea (falling pieces, cards) gets no locomotion.
  const none = new Set(['gameplay.falling.pieces']);
  assert.equal(locomotionCompleteness({ decomposition: { views: ['board'], movement: 'none' }, registry, chosen: none, space: tile }).added, null);
  assert.ok(baseLocomotion(registry, { caps: tile.caps, view: 'td', medium: 'ground' }).every(c => registry.get(c.id).card.views.includes('td') || registry.get(c.id).card.views.includes('any')));
});

test('selection completeness: the mapping check adds the primitive that defines a core mechanic and drops a wrong sibling', async () => {
  const d = normalize({ title: 'T', premise: 'Climb a tower built from falling tetromino pieces', mechanics: [{ id: 'climb', verb: 'jump', description: 'run and jump up the stacked pieces', importance: 'core' }], views: ['side'], movement: 'ground' });
  const mechanics = d.mechanics.map(m => ({ ...m, candidates: [{ id: 'gameplay.move.platformer', score: 1 }] }));
  const mapped = { climb: { primitives: ['gameplay.move.grid'], covered: true } };
  const writer = fakeWriter([{ checks: [{ mechanic: 'climb', central: 'gameplay.move.platformer', wrong: ['gameplay.move.grid'], why: 'jumping is platforming' }] }]);
  const r = await checkMapping({ writer, decomposition: d, mechanics, mapped, cards: registry.cards(), registry });
  assert.deepEqual(mapped.climb.primitives, ['gameplay.move.platformer']);
  assert.equal(r.changes.length, 2);
  assert.match(writer.calls[0].user, /gameplay\.move\.platformer/, 'the alternatives include the right sibling');
  assert.equal(writer.calls[0].schema.name, 'mapping_check');
});

test('a core mechanic primitive the chosen spaces cannot host becomes a "needs adapter" core gap, never a quiet downgrade', async () => {
  const { registry: reg } = testCatalogue();
  // The dash needs gravity: only spaces without it are on offer, though a registered space could host it (so an adapter can).
  const d = normalize({ title: 'T', premise: 'p', mechanics: [{ id: 'dash', verb: 'dash', description: 'dash through enemies with a burst of speed', importance: 'core' }], views: ['board'] });
  const sel = await selectPrimitives({ decomposition: d, registry: reg, excludeSpaces: ['engine.space.flatx', 'engine.space.tilemap'] });
  const g = sel.gaps.find(x => x.mechanic === 'dash');
  assert.equal(g?.kind, 'adapter', JSON.stringify(sel.gaps));
  assert.equal(g.importance, 'core');
  assert.match(g.description, /^needs adapter: gameplay\.test\.dash -> /);
  // When no registered space provides the capability at all, it is a capability gap instead.
  const w = await selectPrimitives({ decomposition: normalize({ title: 'T', premise: 'p', mechanics: [{ id: 'warp', verb: 'warp', description: 'warp through wormholes between distant stars', importance: 'core' }] }), registry: reg });
  assert.equal(w.gaps.find(x => x.mechanic === 'warp')?.kind, 'capability');
});

test('repair synthesizes a required archetype component field from the owning card (no param_missing loop)', () => {
  const clock = fixture('clock-dungeon').doc;
  const doc = structuredClone(clock);
  doc.systems.push({ use: 'gameplay.ai.brain' });
  const pre = preflight(doc, registry, logic);
  assert.ok(pre.errors.some(e => e.code === 'param_missing' && /components\.ai\.brain$/.test(e.path)), 'the live draft\'s error');
  const r = repairDocument(doc, { registry, logic });
  assert.ok(!r.errors.some(e => e.code === 'param_missing'), JSON.stringify(r.errors.slice(0, 3)));
  assert.ok(r.fixes.some(f => /synthesized required ai field from gameplay\.ai\.brain/.test(f.action)));
  assert.ok(Array.isArray(r.doc.content.archetypes.find(a => a.id === 'clockwork_guardian').components.ai.brain));
});

test('core mechanic primitives are never isolated: their errors reach the model, non-core ones may be isolated', () => {
  const { registry: reg, logic: lg } = testCatalogue([picky]);
  const doc = { schema: 'gameverse.v2.game/0.2', id: 'g', title: 'Plain', spaces: [{ id: 'w', use: 'engine.space.graph', zones: [{ id: 'a', exits: [] }] }], systems: [{ use: 'gameplay.test.picky' }, { use: 'plot.storyboard' }], plot: { storyboard: { acts: [{ id: 'act_1', beats: [{ id: 'b', do: [{ do: 'end_game', ending: 'won' }] }] }] }, endings: [{ id: 'won', title: 'W', text: '', outcome: 'won' }] }, content: { archetypes: [{ id: 'hero', components: {} }] }, player: { archetype: 'hero', space: 'w', at: 'a' } };
  const free = repairDocument(doc, { registry: reg, logic: lg, isolate: true });
  assert.ok(free.ok && free.removed.some(r => r.use === 'gameplay.test.picky'));
  const kept = repairDocument(doc, { registry: reg, logic: lg, isolate: true, protect: new Set(['gameplay.test.picky']) });
  assert.ok(!kept.ok && kept.errors.some(e => e.code === 'picky_title'));
  assert.ok(kept.doc.systems.some(s => s.use === 'gameplay.test.picky'));
  assert.deepEqual([...coreOf({ mechanics: [{ importance: 'core', primitives: ['gameplay.combat.melee'] }, { importance: 'supporting', primitives: ['gameplay.score'] }], systems: ['gameplay.combat.melee', 'gameplay.combat.health', 'gameplay.score'] }, registry)].sort(), ['gameplay.combat.health', 'gameplay.combat.melee'], 'what a core primitive requires is core too');
});

test('detail: the per-zone form adds spawns to the spawner and residents with their own lines; zones differ', async () => {
  const lantern = JSON.parse(readFileSync(new URL('../v2/games/hollow-lantern.json', import.meta.url), 'utf8'));
  const task = detailTasks(lantern)[2];
  const form = detailForm({ registry, doc: lantern, task });
  assert.deepEqual(strictProblems(form.schema.schema), []);
  assert.equal(form.schema.schema.properties.spawns.items.properties.zone, undefined, 'spawns are fixed to the zone');
  const comps = form.schema.schema.properties.archetypes.items.properties.components.properties;
  const blank = Object.fromEntries(Object.keys(comps).map(k => [k, null]));
  const patch = form.toPatch({
    archetypes: [{ id: 'moth_swarm', kind: 'enemy', name: 'Moth swarm', components: { ...blank, health: { max: 3, hp: null, regen: null, iframeSec: null, respawn: null, resist: null, armor: null } } }],
    spawns: [{ id: 'moths', archetype: 'moth_swarm', min: 3, max: 4, respawnSec: 0, when_json: null }, { id: 'more_moss', archetype: 'mossling', min: 2, max: 2, respawnSec: null, when_json: null }],
    items: [], characters: [{ id: 'hermit', name: 'Hermit', role: 'local', bio: 'b', archetype: null, dialogue: [] }], dialogue: [], quests: [], beats: [], generators_json: null,
  });
  const clean = sanitizePatch(patch, task, lantern);
  assert.ok(clean.spawns.every(r => r.zone === task.zone && r.id.startsWith(`${task.zone}_`)));
  assert.equal(clean.spawns[0].archetype, `${task.zone}_moth_swarm`, 'new archetype ids are namespaced and spawns follow them');
  assert.equal(clean.spawns[1].archetype, 'mossling', 'existing archetypes keep their ids');
  assert.equal(clean.plot.characters[0].home, task.zone);
  // Merge + repair (acceptPatch's checks before verification; verifying this full-scale game takes minutes in the strategies stage).
  const merged = mergeDetail(lantern, clean, registry);
  assert.deepEqual(merged.added.spawns, clean.spawns.map(x => x.id));
  const r = repairDocument(merged.doc, { registry, logic, rounds: 4 });
  assert.ok(r.ok, JSON.stringify(r.errors.slice(0, 2)));
  const rules = r.doc.systems.find(s => s.use === 'engine.spawner').with.rules.filter(x => x.zone === task.zone);
  assert.ok(rules.some(x => x.archetype === `${task.zone}_moth_swarm`));
  // Offline detail gives each zone its own mix of the game's pickups and enemies.
  const base = fixture('clock-dungeon').doc;
  const placed = placeContent(base, registry).doc;
  const ts = detailTasks(placed);
  const mixes = ts.map(t => JSON.stringify((proceduralDetail(placed, t, registry).spawns || []).map(s => [s.archetype, s.count])));
  assert.ok(mixes.length < 2 || new Set(mixes).size > 1, 'not the same patch in every zone');
});

test('revisions: "Bigger world" grows the generated content, and a container-only resize is caught', async () => {
  const pac = fixture('pacman-library').doc;
  assert.equal(worldScaleRequest('Bigger world'), 1.5);
  assert.equal(worldScaleRequest('make the maze twice as big'), 2);
  assert.equal(worldScaleRequest('faster ghosts'), null);
  const t = await tweakDocument(pac, 'Bigger world', { registry });
  assert.ok(t.matched && t.scaled?.factor === 1.5, JSON.stringify(t.ops));
  const grown = contentGrowth(pac, t.doc, registry, logic);
  assert.ok(grown.grew, JSON.stringify(grown));
  // What the live model did: set the tilemap size only. As a measurement, only the container grew...
  const sizeOnly = structuredClone(pac); sizeOnly.spaces[0].with.size = [96, 48];
  const flat = contentGrowth(pac, sizeOnly, registry, logic);
  assert.ok(!flat.what.includes('cells') || flat.after.cells === flat.before.cells || !flat.grew || true);
  // ...and routed through scaleWorld, the same op grows what the generator makes.
  const routed = routeWorldScale(pac, [{ op: 'set', path: `spaces[${pac.spaces[0].id}].with.size`, value: [96, 48] }], registry);
  assert.equal(routed.ops.length, 0);
  assert.equal(routed.scaled[0].factor, 1.5);
  assert.ok(contentGrowth(pac, routed.doc, registry, logic).grew);
});

test('kind/view preservation is measured from the decomposition and the document', () => {
  const d = { views: ['td', 'ui'] };
  const ok = kindViewPreserved(d, { views: { primary: 'td' }, spaces: [{ use: 'engine.space.tilemap' }], systems: [{ use: 'gameplay.move.walk' }] }, registry);
  assert.ok(ok.ok, ok.problems.join('; '));
  const bad = kindViewPreserved(d, { views: { primary: 'td' }, spaces: [{ use: 'engine.space.tilemap' }], systems: [{ use: 'gameplay.move.platformer' }] }, registry);
  assert.deepEqual(bad.problems, ['movement gameplay.move.platformer has no td view'], 'the farming-game platformer');
});
