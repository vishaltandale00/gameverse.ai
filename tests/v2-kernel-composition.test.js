// Static composition checker (v2/planner/compose-check.js): card declarations only, no simulation.
// The live catalogue does not yet carry every content declaration (other branches are adding them), so
// decided verdicts are tested through withDeclarations() overlays that state those declarations, and the
// live catalogue is only required never to call an undeclared composition compatible.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { catalogue } from '../v2/primitives/index.js';
import { dataShapes } from '../v2/planner/catalog.js';
import { checkComposition, compositionMatrix, adapterSignature, screenSpaces, typeHoles, withDeclarations, documentedBy, spaceKinds, BUNDLES } from '../v2/planner/compose-check.js';

const { registry, logic } = catalogue();
const documented = documentedBy(dataShapes);

// The declarations the generator/space cards are getting: every generator says where it runs and what it makes.
const GENERATORS = registry.ids('engine').filter(id => id.startsWith('engine.generate.'));
const DECLARED = {
  ...Object.fromEntries(GENERATORS.map(id => [id, { spaces: [], provides: { content: [] } }])),
  'engine.generate.tilemap.rooms': { spaces: ['engine.space.tilemap'], provides: { content: ['terrain', 'rooms'] } },
  'engine.generate.tilemap.overworld': { spaces: ['engine.space.tilemap'], provides: { content: ['terrain', 'areas'] } },
  'engine.generate.terrain.noise': { spaces: ['engine.space.mesh3d', 'engine.space.voxel'], provides: { content: ['terrain'] } },
  'engine.generate.water': { spaces: ['engine.space.mesh3d'], provides: { content: ['water'] } },
  'engine.generate.grid.board': { spaces: ['engine.space.grid'], provides: { content: ['board'] } },
  'engine.space.tilemap': { needs: { content: ['terrain'] } },
  'engine.space.mesh3d': { needs: { content: ['terrain'] } },
  'engine.space.voxel': { needs: { content: ['terrain'] } },
  'engine.space.grid': { needs: { content: [] } },
  'engine.space.graph': { needs: { content: [] } },
  'engine.space.none': { needs: { content: [] } },
  'engine.space.track': { needs: { content: [] }, provides: { content: ['course'] } },
  'engine.space.arena2d': { needs: { content: [] } },
  'engine.space.physics2d': { needs: { content: [] } },
  'gameplay.race': { needs: { content: ['course'] } },
};
const declared = withDeclarations(registry, DECLARED);
const on = (use, primitives, w = {}) => ({ space: { use, with: w }, primitives });
const verdictOf = (reg, sel, opts = {}) => checkComposition(sel, reg, { documented, ...opts });

const courseAdapter = {
  id: 'engine.adapt.mesh3d.course',
  card: { intent: 'Stub: a race course projected onto mesh3d terrain from its zones.', params: {}, provides: {}, requires: { capabilities: ['position'] },
    adapts: { provides: { content: ['course'] }, from: { spaces: ['engine.space.mesh3d'] }, projection: 'checkpoint zones become a course on the heightfield' } },
};
const planeAdapter = {
  id: 'engine.adapt.graph.gravity',
  card: { intent: 'Stub: side-view gravity projected onto a graph space.', params: {}, provides: {}, requires: { capabilities: ['position'] },
    adapts: { provides: { capabilities: ['gravity'] }, from: { spaces: ['engine.space.graph'], capabilities: ['position'] }, projection: 'each zone is a side-view plane' } },
};

test('known-good bundles are compatible once the content declarations exist', () => {
  const platformer = verdictOf(declared, on('engine.space.tilemap', BUNDLES.platformer.primitives, { mode: 'side' }));
  assert.equal(platformer.verdict, 'compatible', platformer.reason);
  assert.ok(platformer.added.includes('engine.generate.tilemap.overworld') || platformer.added.includes('engine.generate.tilemap.rooms'), 'a terrain generator is resolved for the tilemap');
  const puzzle = verdictOf(declared, on('engine.space.grid', BUNDLES['puzzle board'].primitives));
  assert.equal(puzzle.verdict, 'compatible', puzzle.reason);
  assert.equal(verdictOf(declared, on('engine.space.tilemap', ['gameplay.move.platformer'], { mode: 'side' })).verdict, 'compatible');
});

test('the live catalogue never calls a composition compatible through a type hole', () => {
  const r = verdictOf(registry, on('engine.space.tilemap', ['gameplay.move.platformer'], { mode: 'side' }));
  assert.ok(!r.verdict.startsWith('incompatible'), r.reason);
  if (!registry.get('engine.space.tilemap').card.needs) {
    assert.equal(r.verdict, 'undeclared');
    assert.ok(r.holes.some(h => h.card === 'engine.space.tilemap' && h.code === 'space_needs_undeclared'));
  }
});

test('mesh3d + race with no course generator is incompatible on content, with the adapter it needs', () => {
  const r = verdictOf(declared, on('engine.space.mesh3d', ['gameplay.race']));
  assert.equal(r.verdict, 'incompatible-needs-adapter', r.reason);
  assert.equal(r.checks.content, 'needs-adapter');
  assert.ok(r.failures.some(f => f.check === 'content' && f.code === 'content_missing' && /course/.test(f.message)));
  assert.deepEqual(r.signature.card.adapts.provides, { capabilities: [], content: ['course'], services: [] });
  assert.deepEqual(r.signature.card.adapts.from.spaces, ['engine.space.mesh3d']);
  assert.match(r.signature.id, /^engine\.adapt\.mesh3d\.course$/);
  // The terrain it does need is still resolved from the declared generator.
  assert.ok(r.added.includes('engine.generate.terrain.noise'));
});

test('an undeclared generator that might cover the content makes it undeclared, not compatible or incompatible', () => {
  const partly = withDeclarations(registry, { ...DECLARED, 'engine.generate.roads': {} });
  // engine.generate.roads keeps no card.spaces / provides.content in this overlay (the live card has neither).
  if (registry.get('engine.generate.roads').card.spaces) return;
  const r = verdictOf(partly, on('engine.space.mesh3d', ['gameplay.race']));
  assert.equal(r.verdict, 'undeclared', r.reason);
  assert.ok(r.holes.some(h => h.card === 'engine.generate.roads' && h.code === 'generator_spaces_undeclared'));
});

test('a registered adapter turns the incompatible pair into compatible-via-adapter', () => {
  const withCourse = withDeclarations(registry, DECLARED, [courseAdapter]);
  const r = verdictOf(withCourse, on('engine.space.mesh3d', ['gameplay.race']));
  assert.equal(r.verdict, 'compatible-via-adapter', r.reason);
  assert.deepEqual(r.adapters, ['engine.adapt.mesh3d.course']);
  // Capability adapters: a platformer on a graph space needs gravity.
  const before = verdictOf(declared, on('engine.space.graph', ['gameplay.move.platformer']));
  assert.equal(before.verdict, 'incompatible-needs-adapter');
  assert.deepEqual(before.signature.card.adapts.provides.capabilities, ['gravity']);
  const withPlane = withDeclarations(registry, DECLARED, [planeAdapter]);
  const after = verdictOf(withPlane, on('engine.space.graph', ['gameplay.move.platformer']));
  assert.equal(after.verdict, 'compatible-via-adapter', after.reason);
  assert.deepEqual(after.adapters, ['engine.adapt.graph.gravity']);
  // An adapter only projects from the spaces it names.
  const elsewhere = verdictOf(withPlane, on('engine.space.none', ['gameplay.move.platformer']));
  assert.equal(elsewhere.verdict, 'incompatible-needs-adapter');
});

test('adapterSignature describes the missing concept as an adapter card', () => {
  const s = adapterSignature({ space: 'engine.space.mesh3d', spaceCaps: ['position', 'surface'], capabilities: ['gravity', 'navigate'], content: [], services: ['roadgraph'], neededBy: ['gameplay.move.platformer'] });
  assert.equal(s.id, 'engine.adapt.mesh3d.gravity');
  assert.deepEqual(s.card.adapts.provides, { capabilities: ['gravity', 'navigate'], content: [], services: ['roadgraph'] });
  assert.deepEqual(s.card.adapts.from, { spaces: ['engine.space.mesh3d'], capabilities: ['position', 'surface'] });
  assert.deepEqual(s.card.requires.capabilities, ['position']);
  assert.equal(typeof s.card.adapts.projection, 'string');
  assert.deepEqual(s.neededBy, ['gameplay.move.platformer']);
});

test('decided failures: capabilities, conflicts, required primitives and engagement', () => {
  // Capabilities are decided even without content declarations: a platformer in a menu space has no gravity.
  const none = verdictOf(registry, on('engine.space.none', ['gameplay.move.platformer']));
  assert.equal(none.verdict, 'incompatible-needs-adapter');
  assert.equal(none.checks.capabilities, 'needs-adapter');
  // Conflicts are never adaptable.
  const a = { id: 'gameplay.stub-a', card: { intent: 'stub', params: {}, provides: {}, requires: {}, conflicts: ['gameplay.score'] } };
  const reg = withDeclarations(registry, DECLARED, [a]);
  const c = verdictOf(reg, on('engine.space.grid', ['gameplay.stub-a', 'gameplay.score']));
  assert.equal(c.verdict, 'incompatible');
  assert.ok(c.failures.some(f => f.code === 'primitive_conflict'));
  // A document is checked as written: a missing required primitive is not resolved.
  const doc = { schema: 'gameverse.v2.game/0.2', id: 'x', title: 'x', spaces: [{ id: 'world', use: 'engine.space.grid' }], systems: [{ use: 'gameplay.combat.melee' }] };
  const d = verdictOf(declared, doc);
  assert.equal(d.verdict, 'incompatible');
  assert.ok(d.failures.some(f => f.code === 'requires_unmet' && /combat\.health/.test(f.message)));
  // ...while the same selection resolves it from the catalogue.
  const s = verdictOf(declared, { spaces: [{ id: 'world', use: 'engine.space.grid' }], systems: ['gameplay.combat.melee'] });
  assert.ok(s.added.includes('gameplay.combat.health'));
  // Engagement: race participants need the spawner, which resolve adds.
  const race = verdictOf(declared, on('engine.space.track', ['gameplay.race']));
  assert.ok(race.added.includes('engine.spawner'));
});

test('screenSpaces rejects only spaces with decided failures, for select.js to replace', () => {
  const sel = { spaces: [{ id: 'world', use: 'engine.space.mesh3d' }], systems: ['gameplay.race'], generators: [], bind: {} };
  assert.deepEqual(screenSpaces(sel, declared, { documented }).reject, ['engine.space.mesh3d']);
  // A hole is not a reason to reject.
  if (!registry.get('engine.space.mesh3d').card.needs) assert.deepEqual(screenSpaces(sel, registry, { documented }).reject, []);
  assert.deepEqual(screenSpaces({ ...sel, spaces: [{ id: 'world', use: 'engine.space.track' }] }, declared, { documented }).reject, []);
});

test('strict mode lists every card lacking declarations, and only those', () => {
  const holes = typeHoles(registry, { documented });
  for (const h of holes.filter(h => h.code === 'generator_spaces_undeclared')) assert.ok(!Array.isArray(registry.get(h.card).card.spaces));
  for (const id of GENERATORS) if (!Array.isArray(registry.get(id).card.spaces)) assert.ok(holes.some(h => h.card === id && h.code === 'generator_spaces_undeclared'), id);
  const after = typeHoles(declared, { documented });
  assert.ok(!after.some(h => /^(space_needs|generator_)/.test(h.code)), 'the overlay closes the content holes');
});

test('the matrix covers every space kind × primitive and every bundle, from cards alone', () => {
  const m = compositionMatrix(declared, { documented });
  const kinds = spaceKinds(declared);
  assert.ok(kinds.some(k => k.key === 'tilemap{mode:topdown}'), 'param-dependent variants are space kinds');
  assert.equal(m.pairs.length, kinds.length * m.primitives.length);
  assert.equal(m.bundles.length, kinds.length * Object.keys(BUNDLES).length);
  for (const r of [...m.pairs, ...m.bundles]) if (r.verdict === 'compatible') assert.equal(r.holes.length, 0);
  // Each bundle composes on its own space kind once declared (holes only where cards still lack data shapes).
  for (const b of m.bundles.filter(b => b.native)) assert.ok(!b.verdict.startsWith('incompatible'), `${b.bundle}: ${b.reason}`);
});

test('example documents are never incompatible on the checks preflight also makes', () => {
  for (const f of ['quiet-manor.json']) {
    const doc = JSON.parse(readFileSync(new URL(`../v2/games/${f}`, import.meta.url), 'utf8'));
    const r = checkComposition(doc, registry, { logic, documented });
    assert.ok(!r.verdict.startsWith('incompatible'), `${f}: ${r.reason}`);
  }
});
