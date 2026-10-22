// How many places a space gets comes from declarations (presets.js placesFor), never from a default count: the
// space card's needs, the loops played on it (participant groups, the zones their params reference), the content
// placed on it (an archetypes contract's spread) and, only for a narrative idea, the story's places as the model
// wrote them. The decomposition carries act and zone counts only for a narrative idea, and never invents them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { preset, placesFor, zoneShape } from '../v2/planner/presets.js';
import { normalize } from '../v2/planner/decompose.js';
import { contractsOf } from '../v2/planner/content.js';

const { registry, logic } = buildCatalogue();
const graph = () => ({ id: 'map', use: 'engine.space.graph', with: {}, role: 'map', caps: [...registry.get('engine.space.graph').card.provides.capabilities] });
const build = (systems, description, core, extra = {}) => {
  const decomposition = normalize({ title: 'Places', premise: `${description}.`, tone: 'brisk', references: [], views: ['text'], spaces: [], movement: 'none', ...extra,
    mechanics: [{ id: 'core', verb: description.split(' ')[0], description, from: '', importance: 'core' }],
    core: { loop: 'core', theme: '', narrative: false, mashup: [], lose: '', ...core } }, description, registry);
  const selection = { systems: [...systems], spaces: [graph()], generators: [], graphics: [], bind: {}, gaps: [], adapters: [],
    mechanics: [{ id: 'core', verb: 'x', description, importance: 'core', primitives: systems.filter(s => s.startsWith('gameplay.')), candidates: [], source: 'test', score: 1, from: '' }] };
  return { decomposition, p: preset({ decomposition, selection, registry, logic, seed: 4 }) };
};
const shapeOf = () => zoneShape(registry.get('engine.space.graph').card, graph().caps, {});

test('a non-narrative decomposition carries no act or zone count, even when the model wrote one', () => {
  const pure = normalize({ title: 'x', premise: 'x', acts: 3, zones: 7, mechanics: [], core: { interaction: 'avatar-realtime', opponent: 'ai-rival', win: 'w', lose: '', theme: '', narrative: false, mashup: [] } }, 'x', registry);
  assert.ok(!('acts' in pure) && !('zones' in pure), JSON.stringify(pure));
  // A narrative keeps the counts the model wrote, and gets none it did not.
  const told = normalize({ title: 'x', premise: 'x', acts: 3, zones: 7, mechanics: [], core: { interaction: 'avatar-realtime', opponent: 'none', win: 'w', lose: '', theme: '', narrative: true, mashup: [] } }, 'x', registry);
  assert.deepEqual([told.acts, told.zones], [3, 7]);
  const untold = normalize({ title: 'x', premise: 'x', mechanics: [], core: { interaction: 'avatar-realtime', opponent: 'none', win: 'w', lose: '', theme: '', narrative: true, mashup: [] } }, 'x', registry);
  assert.ok(!('acts' in untold) && !('zones' in untold));
});

test('a non-narrative graph-space game gets its places from declarations', () => {
  // The space alone: places joined by exits, two of them.
  assert.equal(placesFor(registry, graph(), shapeOf(), { systems: [], generators: [] }), 2);
  // A race on it: its checkpoints contract asks for at least three distinct zones.
  const checkpoints = contractsOf(registry, 'gameplay.race').find(c => c.param === 'checkpoints')?.min;
  assert.equal(checkpoints, 3);
  const race = build(['gameplay.race'], 'race rivals around the map', { interaction: 'avatar-realtime', opponent: 'ai-rival', win: 'finish first' });
  assert.equal(race.decomposition.zones, undefined);
  assert.equal(race.p.doc.spaces[0].zones.length, checkpoints);
  assert.ok(race.p.doc.spaces[0].zones.every(z => z.exits?.length), 'the places are joined by exits');
  // Pickups spread through three zones (the collectible archetypes contract): three places.
  const spread = contractsOf(registry, 'gameplay.collectible').find(c => c.need === 'archetypes')?.zones;
  assert.equal(spread, 3);
  assert.equal(placesFor(registry, graph(), shapeOf(), { systems: ['gameplay.collectible'], generators: [] }), spread);
  // A turn loop's sides, each seated in its own zone on a space without cells: one place per side (at least the two exits need).
  const sides = registry.get('gameplay.turns').card.params.sides.default.length;
  assert.equal(placesFor(registry, graph(), shapeOf(), { systems: ['gameplay.turns'], generators: [] }), Math.max(2, sides));
  // A generator that lays out the whole space's places (provides zones over extent 'space') takes the space's own floor.
  assert.equal(placesFor(registry, graph(), shapeOf(), { systems: [], generators: ['engine.generate.graph.world'] }), 0);
  assert.equal(placesFor(registry, graph(), shapeOf(), { systems: ['gameplay.race'], generators: ['engine.generate.graph.world'] }), checkpoints);
});

test('a narrative idea adds its story places to what the declarations ask for, and only then', () => {
  const told = build(['plot.storyboard'], 'follow a story told in acts across the map', { interaction: 'avatar-realtime', opponent: 'none', win: 'reach the ending', narrative: true }, { acts: 2, zones: 6 });
  assert.equal(told.decomposition.zones, 6);
  assert.equal(told.p.doc.spaces[0].zones.length, 6);
  assert.equal(placesFor(registry, graph(), shapeOf(), { systems: [], generators: [], story: 6 }), 6);
});
