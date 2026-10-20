// A substantive first-playable world (v2/planner/world.js). Regression for a live run ("a platformer where
// you climb a tower built from falling Tetris pieces"): a valid, verified, "completable" document whose only
// space was an empty engine.space.tilemap (no generator, no tiles); victory was reachable by walking along the
// map's solid bottom edge through full-height zone strips. No network: fake writers only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../v2/kernel/world.js';
import { preflight } from '../v2/kernel/document.js';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { selectPrimitives } from '../v2/planner/select.js';
import { writeOutline } from '../v2/planner/outline.js';
import { firstPlayable } from '../v2/planner/first-playable.js';
import { furnishWorld, worldProblems, spacesNeedingWorld, contentOf } from '../v2/planner/world.js';
import { verifyDocument } from '../v2/planner/verify-adapter.js';
import { PRIMITIVES } from '../v2/primitives/index.js';
import { fakeWriter, decomposition } from './v2-p-pipeline-fixtures.js';

// A fixed slice of the catalogue: the stored game's primitives plus every 2D generator (they compete).
const IDS = ['engine.space.tilemap', 'engine.space.graph', 'engine.input.actions', 'gameplay.move.platformer', 'gameplay.move.climb', 'gameplay.inventory', 'plot.storyboard',
  ...PRIMITIVES.map(p => p.id).filter(id => id.startsWith('engine.generate.'))];
const { registry, logic } = buildCatalogue([], IDS.map(id => PRIMITIVES.find(p => p.id === id)).filter(Boolean));

// The stored v1 document's shape (local-data/v2/games/a-platformer-where-you-climb-mvhb4uy4), trimmed to what matters.
const zone = (id, x0, x1) => ({ id, name: id, rect: [x0, 0, x1, 32] });
const stored = () => ({
  schema: 'gameverse.v2.game/0.2', id: 'towerfall-stacker', title: 'Towerfall Stacker', seed: 1309811577, views: { primary: 'side', alternates: ['ui'] },
  spaces: [{ id: 'main', use: 'engine.space.tilemap', with: { tile: 16, size: [64, 32], mode: 'side', gravity: -60 },
    zones: [zone('ground_floor', 0, 12), zone('piece_sanctum', 12, 24), zone('pixel_wilds', 24, 36), zone('increasingly_hollow', 36, 48), zone('crisp_yard', 48, 64)] }],
  systems: [
    { use: 'engine.input.actions', with: { verbs: ['move', 'jump'], axes: ['move'] } },
    { use: 'gameplay.move.climb', with: { speed: 2, surfaces: 'tagged' }, space: 'main' },
    { use: 'gameplay.move.platformer', with: { preset: 'runner', run: 14, jump: 28, gravity: 140 }, space: 'main' },
    { use: 'plot.storyboard', with: { sequentialActs: true } },
  ],
  plot: {
    premise: 'Stack falling pieces to build and climb a tower.',
    characters: [{ id: 'guide', name: 'The Guide', role: 'mentor' }],
    storyboard: { acts: [{ id: 'act_1', title: 'Up', beats: [
      { id: 'reach_piece_sanctum', when: { zone: 'piece_sanctum' } },
      { id: 'finale', when: { zone: 'crisp_yard' }, do: [{ do: 'end_game', ending: 'victory' }] },
    ] }] },
    endings: [{ id: 'victory', title: 'Victory', text: 'You climbed it.', outcome: 'won' }],
  },
  content: { archetypes: [{ id: 'hero', components: { name: 'The Climber' } }], blocks: [{ id: 'solid_block', name: 'Solid Block', solid: true, tags: ['block', 'climbable'] }] },
  player: { archetype: 'hero', space: 'main', at: [1, 1] },
});
const boot = doc => { const pre = preflight(doc, registry, logic); assert.ok(pre.ok, JSON.stringify(pre.errors)); const rt = createWorld(pre.doc, registry, logic, { seed: doc.seed }); for (let i = 0; i < 3; i++) rt.step(); return { rt, doc: pre.doc }; };
const solidCells = rt => { const api = rt.space('main'); let n = 0; for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) if (api.collisionOf(api.getCell([x, y])) === 'solid') n++; return n; };

test('world_empty: the stored platformer is flagged as an empty world (error), and verification no longer calls it verified', async () => {
  const { rt, doc } = boot(stored());
  assert.deepEqual(contentOf(rt, 'main'), { cells: 0, entities: 0 });
  const problems = worldProblems(rt, doc, registry);
  assert.deepEqual(problems.map(p => [p.code, p.path, p.severity]), [['world_empty', 'spaces[0]', 'error']]);
  assert.match(problems[0].hint, /engine\.generate\.tilemap\.rooms/, 'the hint names generators that fit');
  const v = await verifyDocument(stored(), registry, logic, { budgetMs: 400 });
  assert.ok(v.problems.some(p => p.code === 'world_empty' && p.severity === 'error'));
  assert.notEqual(v.verified, true);
});

test('world_empty applies only where something moves: a cell space with no movement primitive may start empty', () => {
  const doc = stored();
  doc.systems = doc.systems.filter(s => !s.use.startsWith('gameplay.move.'));
  assert.deepEqual(spacesNeedingWorld(doc, registry), []);
  assert.equal(spacesNeedingWorld(stored(), registry).length, 1);
});

test('furnishWorld fills the empty tilemap with a proven rooms layout built from its zones and the movement envelope', () => {
  const f = furnishWorld(stored(), registry, logic, { seed: 7 });
  assert.deepEqual(f.added.map(a => [a.space, a.use, a.problems.length]), [['main', 'engine.generate.tilemap.rooms', 0]]);
  assert.deepEqual(f.problems, []);
  const gen = f.doc.spaces[0].generators[0].with;
  assert.deepEqual(gen.rooms.map(r => r.zone), ['ground_floor', 'piece_sanctum', 'pixel_wilds', 'increasingly_hollow', 'crisp_yard'], 'one room per zone');
  assert.ok(gen.rooms.every(r => r.style === 'shaft'), 'tall zones become climbable shafts');
  assert.deepEqual(gen.rooms[1].exits.map(e => e.to).sort(), ['ground_floor', 'pixel_wilds']);
  // Platformer: jump 28 at gravity 140 → 2.8 tiles high, 5.6 across; the proof assumes no more than that.
  assert.deepEqual(gen.movement, { jumpHeight: 2, jumpDistance: 5 }, 'tagged climbing is not assumed on every wall');
  assert.equal(gen.palette.wall, 'solid_block', "the document's own block");
  assert.ok(f.doc.content.blocks.some(b => b.tags?.includes('one_way')), 'a one-way rung block is declared');
  const { rt } = boot(f.doc);
  assert.ok(solidCells(rt) > 300, 'walls, ground and platforms');
  assert.deepEqual((rt.service('generation').problems() || []).filter(p => p.severity === 'error'), [], 'every room proven traversable');
  assert.ok(rt.player().components.body.grounded || rt.player().at[1] > 2, 'the player starts above the built floor');
  assert.deepEqual(worldProblems(rt, f.doc, registry), []);
  assert.equal(furnishWorld(f.doc, registry, logic, { seed: 7 }).added.length, 0, 'idempotent');
  assert.equal(JSON.stringify(furnishWorld(stored(), registry, logic, { seed: 7 }).doc), JSON.stringify(f.doc), 'deterministic');
});

test('outline → first playable for the stored platformer: selection adds a generator, the skeleton and the model draft both get a world', async () => {
  const d = decomposition(['stack falling blocks to build a tower', 'run and jump through the tower', 'climb the built tower'], { views: ['side'], spaces: [{ role: 'main', kind: 'tiles-side' }], zones: 5, acts: 1 });
  const mapping = { mappings: [{ mechanic: 'm0', primitives: ['engine.space.tilemap'], covered: true, why: '' }, { mechanic: 'm1', primitives: ['gameplay.move.platformer', 'engine.space.tilemap'], covered: true, why: '' }, { mechanic: 'm2', primitives: ['gameplay.move.climb'], covered: true, why: '' }] };
  const selection = await selectPrimitives({ decomposition: d, registry, writer: fakeWriter([mapping]) });
  assert.equal(selection.spaces[0].use, 'engine.space.tilemap');
  assert.deepEqual(selection.generators.map(g => [g.id, g.space]), [['engine.generate.tilemap.rooms', selection.spaces[0].id]], 'no mechanic named a generator; the space still gets one');
  // The model returns the stored document (no generator, and in a second variant no player at all).
  for (const draft of [stored(), Object.fromEntries(Object.entries(stored()).filter(([k]) => k !== 'player'))]) {
    const writer = fakeWriter([draft]);
    const o = await writeOutline({ writer, prompt: 'A platformer where you climb a tower built from falling Tetris pieces', decomposition: d, selection, registry, logic, seed: 11, maxRounds: 1, verify: false });
    assert.ok(o.ok && o.source === 'fake-writer', JSON.stringify(o.rounds));
    assert.deepEqual(o.doc.spaces[0].generators.map(g => g.use), ['engine.generate.tilemap.rooms']);
    assert.ok(o.rounds.some(r => r.worldAdded?.includes('engine.generate.tilemap.rooms')));
    const fp = firstPlayable(o.doc, registry, logic, { seed: 11 });
    assert.ok(fp.ok && fp.start, JSON.stringify(fp.problems));
    assert.ok(fp.options > 0);
    assert.deepEqual(fp.problems.filter(p => p.code === 'world_empty'), []);
    assert.ok(solidCells(boot(fp.doc).rt) > 300);
  }
});

test('first playable furnishes an empty world it is handed and reports world_empty when nothing fits', () => {
  const fp = firstPlayable(stored(), registry, logic, { seed: 3 });
  assert.ok(fp.ok);
  assert.deepEqual(fp.world.added.map(a => a.use), ['engine.generate.tilemap.rooms']);
  const bare = buildCatalogue([], ['engine.space.tilemap', 'engine.input.actions', 'gameplay.move.platformer', 'gameplay.move.climb', 'plot.storyboard'].map(id => PRIMITIVES.find(p => p.id === id)));
  const none = firstPlayable(stored(), bare.registry, bare.logic, { seed: 3 });
  assert.ok(none.ok, 'still playable');
  assert.deepEqual(none.problems.map(p => p.code), ['world_empty']);
});
