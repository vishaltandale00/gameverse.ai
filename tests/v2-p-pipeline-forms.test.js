// The outline written form by form (v2/planner/outline.js, outline-form.js): one small strict form per primitive's
// params, in dependency order (the loop's first), each checked as soon as it is written (its instance against its card
// params in a preflight of the partial document) and repaired field by field; then one form per content contract
// section, checked against that contract at once. Scripted fake writers, real catalogue; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { outlineForm } from '../v2/planner/outline-form.js';
import { proceduralOutline, writeOutline } from '../v2/planner/outline.js';
import { normalize } from '../v2/planner/decompose.js';
import { dependencyLayers } from '../v2/planner/build.js';
import { fakeWriter, selectionOf } from './v2-p-pipeline-fixtures.js';

const { registry, logic } = buildCatalogue();
const SYSTEMS = ['engine.input.actions', 'gameplay.combat.health', 'gameplay.combat.melee', 'gameplay.inventory', 'gameplay.move.walk', 'plot.storyboard'];
const MELEE = 'gameplay__combat__melee';

async function setup() {
  const d = normalize({ title: 'Ironhold', premise: 'Fight your way out of a dungeon with a sword.', tone: 'grim', references: [], views: ['td'], movement: 'ground', acts: 1, zones: 4,
    mechanics: [{ id: 'fight', verb: 'fight', description: 'fight monsters with a sword', from: '', importance: 'core' }, { id: 'loot', verb: 'collect', description: 'collect keys and potions', from: '', importance: 'supporting' }],
    spaces: [{ role: 'dungeon', kind: 'tiles-topdown', description: '' }], core: { loop: 'fight', interaction: 'avatar-realtime', opponent: 'hazards', win: 'escape the dungeon', lose: '', theme: 'grim', narrative: true, mashup: [] } }, 'dungeon', registry);
  // A fixed collection (selection is not the point here): the melee loop, what it requires, and the rest.
  const sel = selectionOf(registry, d, { id: 'dungeon', space: 'engine.space.tilemap', map: { fight: ['gameplay.combat.melee'], loot: ['gameplay.inventory'] }, systems: SYSTEMS, generators: ['engine.generate.tilemap.rooms'] });
  const sk = proceduralOutline({ decomposition: d, selection: sel, registry, logic, seed: 5 }).doc;
  return { d, sel, sk, form: outlineForm({ registry, skeleton: sk, selection: sel }) };
}

/** The scripted model's answers: the frame, a cast and a story that pass; melee params with one bad field, fixed when that field alone is asked. */
function scriptedReply(sk, form) {
  const space = sk.spaces[0];
  const zones = space.zones.map((z, i) => ({ id: z.id, name: `Hall ${i}`, description: `hall ${i}`, ...(z.exits ? { exits: z.exits.map(x => ({ to: x.to, gate_json: null })) } : {}) }));
  const comps = form.schema.schema.properties.archetypes.items.properties.components.properties;
  const blank = Object.fromEntries(Object.keys(comps).map(k => [k, null]));
  const ghoul = { id: 'ghoul', kind: 'enemy', name: 'Ghoul', components: { ...blank, health: { max: 4, hp: null, regen: null, iframeSec: null, respawn: null, resist: null, armor: null } } };
  const replies = {
    frame: { title: 'Ironhold', logline: 'l', premise: 'p', spaces: { [space.id]: { zones } }, player: { archetype: 'hero', zone: zones[0].id }, endings: [] },
    cast: { archetypes: [ghoul], spawns: zones.slice(1).map((z, i) => ({ id: `g${i}`, archetype: 'ghoul', zone: z.id, at_json: null, min: 2, max: 2, respawnSec: 0, when_json: null })), items: [{ id: 'key', name: 'Key', kind: 'key', desc: 'k', value: null, more_json: null }, { id: 'potion', name: 'Potion', kind: 'potion', desc: 'p', value: null, more_json: null }], characters: [] },
    story: { acts: [{ id: 'act_1', title: 'Escape', beats: [{ id: 'out', title: 'Out', when_json: JSON.stringify({ zone: zones[1].id }), after: [], optional: false, do_json: JSON.stringify([{ do: 'end_game', ending: 'victory' }]) }] }], dialogue: [], quests: [] },
  };
  return req => {
    const name = req.schema.name.replace('game_outline_', '');
    // The melee params' failing field, asked alone: a value in range.
    if (name === `params_${MELEE}_fields`) return JSON.stringify(Object.fromEntries(Object.keys(req.schema.schema.properties).map(k => [k, 200])));
    if (name === `params_${MELEE}`) return JSON.stringify({ systems: { [MELEE]: { with: { parry: { window: 5000, stagger: null, riposte: null }, block: null, moves: [], tune_json: null } } } });
    if (name.startsWith('params_')) return JSON.stringify({ systems: {} });
    return JSON.stringify(replies[name] ?? {});
  };
}
const scripted = (sk, form) => fakeWriter([scriptedReply(sk, form)]);

test('(d) params are asked one primitive at a time in dependency order; a bad field is re-asked alone, never the other forms', async () => {
  const { d, sel, sk, form } = await setup();
  const params = form.groups.filter(g => g.phase === 'params');
  assert.deepEqual(params.map(g => g.use).sort(), [...SYSTEMS].sort(), 'one small form per chosen primitive');
  for (const g of params) assert.deepEqual(Object.keys(g.schema.schema.properties.systems.properties), [g.sub], `${g.id} holds only its own params`);
  const writer = scripted(sk, form);
  const r = await writeOutline({ writer, prompt: 'dungeon', decomposition: d, selection: sel, registry, logic, seed: 5, verify: false, maxRounds: 1 });
  assert.ok(r.ok, JSON.stringify(r.errors?.slice(0, 3)));
  const names = writer.calls.map(c => c.schema.name.replace('game_outline_', ''));
  const asked = names.filter(n => n.startsWith('params_'));
  // The loop primitive's form first (and its repair), then what it requires, then the rest; no layer before the one it follows.
  const layers = dependencyLayers(registry, SYSTEMS, ['gameplay.combat.melee']);
  assert.deepEqual(layers[0], ['gameplay.combat.melee']);
  assert.deepEqual(asked.slice(0, 2), [`params_${MELEE}`, `params_${MELEE}_fields`]);
  const layerOf = n => layers.findIndex(l => l.some(id => n.startsWith(`params_${id.replace(/\./g, '__')}`)));
  assert.deepEqual(asked.map(layerOf), [...asked.map(layerOf)].sort((a, b) => a - b), `asked in dependency order: ${asked.join(' ')}`);
  assert.ok(asked.indexOf('params_gameplay__combat__health') > asked.indexOf(`params_${MELEE}_fields`), 'health (melee requires it) after the melee form settled');
  // The bad field went back alone, with its problem; no other params form was asked twice.
  const fix = writer.calls.find(c => c.schema.name.endsWith(`params_${MELEE}_fields`));
  assert.deepEqual(Object.values(fix.schema.schema.properties).map(p => p.description.split(':')[0]), [`systems.${MELEE}.with.parry.window`]);
  assert.match(fix.user, /\[param_range\] systems\[\d+\]\.with\.parry\.window/);
  for (const g of params.filter(x => x.use !== 'gameplay.combat.melee')) assert.equal(names.filter(n => n === g.id || n === `${g.id}_fields`).length, 1, g.id);
  assert.deepEqual(names.filter(n => !n.startsWith('params_')).sort(), ['cast', 'frame', 'story'], 'the frame, the cast and the story once each');
  const melee = r.doc.systems.find(s => s.use === 'gameplay.combat.melee');
  assert.equal(melee.with.parry.window, 200);
  const check = r.rounds[1].checks.find(c => c.group === `params_${MELEE}`);
  assert.deepEqual(check, { group: `params_${MELEE}`, phase: 'params', asks: 2, problems: [] });
  assert.deepEqual(r.rounds.map(x => x.kind), ['procedural', 'model'], 'no repair round was needed');
});

test('content is asked one contract section at a time and checked against that contract right away', async () => {
  const { d, sel, sk, form } = await setup();
  const content = form.groups.filter(g => g.phase === 'content');
  assert.ok(content.some(g => g.id === 'cast'));
  for (const g of content.filter(x => x.id.startsWith('section_'))) assert.deepEqual(g.keys, [g.id], 'a section form holds its own section only');
  const base = scriptedReply(sk, form);
  // A hollow first cast: its archetypes contract fails at once and only the failing field goes back.
  let first = true;
  const writer = fakeWriter([req => {
    const name = req.schema.name.replace('game_outline_', '');
    if (name === 'cast' && first) { first = false; return JSON.stringify({ archetypes: [], spawns: [], items: [], characters: [] }); }
    if (name === 'cast_fields') {
      return JSON.stringify(Object.fromEntries(Object.entries(req.schema.schema.properties).map(([k, p]) => [k, p.description.startsWith('archetypes') ? [{ id: 'ghoul', kind: 'enemy', name: 'Ghoul', components: { health: { max: 4 } } }] : p.description.startsWith('items') ? [{ id: 'key', name: 'Key', kind: 'key', desc: 'k', value: null, more_json: null }, { id: 'gem', name: 'Gem', kind: 'misc', desc: 'g', value: null, more_json: null }] : null])));
    }
    return base(req);
  }]);
  const r = await writeOutline({ writer, prompt: 'dungeon', decomposition: d, selection: sel, registry, logic, seed: 5, verify: false, maxRounds: 1 });
  const names = writer.calls.map(c => c.schema.name.replace('game_outline_', ''));
  assert.deepEqual(names.filter(n => n.startsWith('cast')), ['cast', 'cast_fields'], `${names.join(' ')}\n${JSON.stringify(r.rounds)}`);
  const fix = writer.calls.find(c => c.schema.name.endsWith('cast_fields'));
  assert.match(fix.user, /\[content_missing\] content\.archetypes/);
  assert.ok(Object.values(fix.schema.schema.properties).every(p => /^(archetypes|items)/.test(p.description)), 'only the contract\'s fields');
  // The story is asked after the cast settled (its form offers the cast's ids).
  assert.ok(names.indexOf('story') > names.indexOf('cast_fields'));
  assert.ok(r.ok, JSON.stringify(r.errors?.slice(0, 3)));
  assert.ok(r.doc.content.archetypes.some(a => a.id === 'ghoul'));
});
