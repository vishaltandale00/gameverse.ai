// Movement follows the idea and the world: the base locomotion fits the selected space, the medium and the play spec's
// interaction; one base locomotion plus modifiers; no fit is a reported gap, never a swapped world. Offline, real catalogue.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { locomotionCompleteness, baseLocomotion, movementStyle } from '../v2/planner/select.js';
import { preset } from '../v2/planner/presets.js';
import { normalizeCore } from '../v2/planner/modes.js';
import { normalize } from '../v2/planner/decompose.js';

const { registry, logic } = buildCatalogue();
const caps = id => registry.get(id).card.provides.capabilities;
const style = id => movementStyle(registry.get(id).card);
const baseIds = set => [...set].filter(id => registry.get(id)?.card.locomotion === 'base');

test('a voxel farming game played in real time gets a continuous base locomotion that fits voxel, never grid steps', () => {
  const voxel = { id: 'farm', caps: caps('engine.space.voxel') };
  const chosen = new Set(['gameplay.move.grid']);
  const dec = { views: ['3p'], movement: 'ground', core: { interaction: 'avatar-realtime' } };
  const r = locomotionCompleteness({ decomposition: dec, registry, chosen, space: voxel });
  assert.ok(!chosen.has('gameplay.move.grid') && r.removed.includes('gameplay.move.grid'));
  const base = baseIds(chosen);
  assert.equal(base.length, 1, `exactly one base locomotion: ${base}`);
  assert.notEqual(style(base[0]), 'discrete');
  assert.equal(registry.get(base[0]).card.medium, 'ground');
  assert.ok((registry.get(base[0]).card.requires?.capabilities || []).every(c => voxel.caps.includes(c)));
  // Even with the view unconstrained, realtime never ranks a discrete mover.
  assert.ok(baseLocomotion(registry, { caps: voxel.caps, medium: 'ground', interaction: 'avatar-realtime' }).every(c => style(c.id) !== 'discrete'));
});

test('avatar-grid gets grid movement; several base locomotions collapse to one', () => {
  const grid = { id: 'board', caps: caps('engine.space.grid') };
  const chosen = new Set(['gameplay.move.walk', 'gameplay.move.fly']);
  locomotionCompleteness({ decomposition: { views: ['td'], movement: 'ground', core: { interaction: 'avatar-grid' } }, registry, chosen, space: grid });
  const base = baseIds(chosen);
  assert.equal(base.length, 1, `${base}`);
  assert.equal(style(base[0]), 'discrete');
  // A second base locomotion alongside is dropped, not stacked.
  const two = new Set(['gameplay.move.grid', 'gameplay.move.lanes']);
  locomotionCompleteness({ decomposition: { views: ['td'], movement: 'ground', core: { interaction: 'avatar-grid' } }, registry, chosen: two, space: grid });
  assert.equal(baseIds(two).length, 1);
});

test('no movement that fits the space is a reported gap, not a different world', () => {
  const none = { id: 'void', caps: [] };
  const r = locomotionCompleteness({ decomposition: { views: ['3p'], movement: 'ground', core: { interaction: 'avatar-realtime' } }, registry, chosen: new Set(), space: none });
  assert.equal(r.added, null);
  assert.match(r.gap || '', /no base movement fits/);
});

const dec = core => normalize({ title: 'Gem duel', premise: 'A duel.', mechanics: [{ id: 'm0', verb: 'duel', description: 'duel', importance: 'core' }], views: ['board'], acts: 2, zones: 3, core }, 'Gem duel', registry);

test('preset keeps the idea\'s space when the mode prefers another: a needs-adapter gap, no swap', () => {
  const d = dec({ mode: 'match-board', interaction: 'cursor-board', opponent: 'ai-side', win: 'w', lose: 'l', theme: 't', narrative: false, secondary: [] });
  const meshCaps = caps('engine.space.mesh3d');
  const selection = { systems: [], spaces: [{ id: 'world', use: 'engine.space.mesh3d', with: {}, role: 'world', caps: meshCaps }], generators: [], graphics: [], bind: {}, mechanics: [], gaps: [] };
  const p = preset({ decomposition: d, selection, registry, logic, seed: 3 });
  assert.ok(p.doc.spaces.every(s => s.use === 'engine.space.mesh3d') || p.doc.spaces[0].use === 'engine.space.mesh3d', p.doc.spaces.map(s => s.use).join());
  assert.ok(p.gaps.some(g => /^needs adapter: match-board on engine\.space\.mesh3d/.test(g.description) && g.kind === 'adapter'), JSON.stringify(p.gaps));
  assert.ok(selection.gaps.some(g => g.kind === 'adapter'));
});

test('preset never drops a core-mechanic primitive silently: it becomes a gap', () => {
  const d = dec({ mode: 'story', interaction: 'avatar-realtime', opponent: 'none', win: 'w', lose: 'l', theme: 't', narrative: false, secondary: [] });
  // A platformer needs gravity; a grid space provides none.
  const need = 'gameplay.move.platformer';
  assert.ok(!caps('engine.space.grid').includes('gravity'));
  const selection = { systems: [need], spaces: [{ id: 'world', use: 'engine.space.grid', with: {}, role: 'world', caps: caps('engine.space.grid') }], generators: [], graphics: [], bind: {},
    mechanics: [{ id: 'jump', verb: 'jump', description: 'jump', importance: 'core', primitives: [need], candidates: [] }], gaps: [] };
  const p = preset({ decomposition: d, selection, registry, logic, seed: 3 });
  assert.ok(p.gaps.some(g => g.primitive === need && g.importance === 'core'), JSON.stringify(p.gaps));
  assert.ok(!p.structure.removed.some(r => r.use === need), 'reported as a gap, not as a quiet removal');
});

test('an unknown mode is a reported failure, not the story', () => {
  const c = normalizeCore({ mode: 'no-such-loop', interaction: 'menu', opponent: 'none', win: '', lose: '', theme: '', narrative: false, secondary: [] }, registry);
  assert.equal(c.mode, 'no-such-loop');
  assert.match(c.problem, /unknown mode 'no-such-loop'/);
  assert.equal(normalizeCore({ mode: 'story' }, registry).problem, undefined);
  const p = preset({ decomposition: dec({ mode: 'no-such-loop', interaction: 'menu', opponent: 'none', win: '', lose: '', theme: '', narrative: false, secondary: [] }), selection: { systems: [], spaces: [{ id: 'world', use: 'engine.space.grid', with: {}, role: 'world', caps: caps('engine.space.grid') }], generators: [], graphics: [], bind: {}, mechanics: [], gaps: [] }, registry, logic, seed: 3 });
  assert.ok(p.gaps.some(g => /unknown mode/.test(g.description)));
});
