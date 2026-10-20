// The verification layer on the real 2D spaces (engine.space.tilemap and
// engine.space.grid): spatial checks through their ability-aware reachable,
// travel macros planned with their path, solver, playtest and ARC harness.
import test from 'node:test';
import assert from 'node:assert/strict';
import { verify, solve, verifySpatial, playtest, runArc } from '../v2/verify/index.js';
import { travel, jumpVerb } from '../v2/verify/macros.js';
import { maker } from '../v2/verify/drive.js';
import { navOptions } from '../v2/verify/movement.js';
import { fixtureCatalogue, normalized } from './v2-p-verify-fixtures.js';

const cat = fixtureCatalogue();
const BLOCKS = [{ id: 'stone', solid: true }, { id: 'wall', solid: true }];

// 20×10 side map: a floor with a 2-wide pit (x 8..9) and a stone ledge at row 4 (x 14..17).
// The plot: cross the pit to learn double_jump, then climb the ledge (4 rows up: needs the double jump).
const platformDoc = ({ ability = true } = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'climb', title: 'Climb', seed: 2,
  spaces: [{ id: 'map', use: 'engine.space.tilemap', with: { size: [20, 10], edges: { left: 'solid', right: 'solid', bottom: 'kill', top: 'open' } },
    generators: [{ use: 'engine.generate.fixture-rows', with: { legend: { '#': 'stone' }, rows: [
      '....................', '....................', '....................', '....................', '....................',
      '..............####..', '....................', '....................', '....................', '########..##########'] } }],
    zones: [{ id: 'start', rect: [0, 1, 4, 4] }, { id: 'far', rect: [11, 1, 14, 3] }, { id: 'ledge', rect: [14, 5, 18, 7] }] }],
  systems: [{ use: 'gameplay.fixture.abilities', with: { abilities: [{ id: 'double_jump' }] } }, { use: 'gameplay.fixture.platformer' }, { use: 'plot.storyboard' }],
  plot: { storyboard: { acts: [{ id: 'a', beats: [
    { id: 'learn', when: { zone: 'far' }, do: ability ? [{ do: 'unlock_ability', ability: 'double_jump' }] : [] },
    { id: 'top', after: ['learn'], when: { zone: 'ledge' }, do: [{ do: 'end_game', ending: 'summit' }] },
  ] }] }, endings: [{ id: 'summit' }] },
  content: { blocks: BLOCKS, archetypes: [{ id: 'hero', components: { body: { size: [0.8, 0.9] } } }] },
  player: { archetype: 'hero', at: [1.5, 1.46] },
});

// 7×7 grid maze: walls, an exit zone, a sealed vault, a lever inside the vault and a coin in reach.
const gridDoc = ({ options = true } = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'maze', title: 'Maze', seed: 4,
  spaces: [{ id: 'board', use: 'engine.space.grid', with: { size: [7, 7] },
    generators: [{ use: 'engine.generate.fixture-rows', with: { legend: { '#': 'wall' }, rows: ['.....##', '.###.#.', '...#.##', '##.#...', '...#.#.', '.#...#.', '.#.#...'] } }],
    zones: [{ id: 'home', rect: [0, 0, 1, 1] }, { id: 'exit', rect: [6, 0, 7, 1] }, { id: 'vault', rect: [6, 5, 7, 6] }] }],
  systems: [{ use: 'gameplay.fixture.step', with: { options } }, { use: 'gameplay.fixture.spawn', with: { entities: [{ archetype: 'lever', id: 'lever', at: [6, 5], components: { interact: {} } }, { archetype: 'coin', id: 'coin', at: [2, 2], components: { collectible: {} } }] } }, { use: 'plot.storyboard' }],
  plot: { storyboard: { acts: [{ id: 'a', beats: [{ id: 'out', when: { zone: 'exit' }, do: [{ do: 'end_game', ending: 'free' }] }] }] }, endings: [{ id: 'free' }] },
  content: { blocks: BLOCKS, archetypes: [{ id: 'hero', components: {} }] },
  player: { archetype: 'hero', at: [0, 0] },
});

test('tilemap: spatial checks follow gate order through the ability-aware reachable', () => {
  const { doc } = normalized(platformDoc());
  const plot = solve(doc, cat.registry, cat.logic, { maxStates: 200 });
  assert.equal(plot.travel, 'steer', 'no options on a tilemap: steered travel macros');
  assert.equal(plot.completable, true, JSON.stringify(plot.endings));
  assert.deepEqual(plot.endings.summit, ['travel far', 'travel ledge']);
  assert.equal(plot.replayed, true);
  const s = verifySpatial(doc, cat.registry, cat.logic, { plot });
  const at = id => s.targets.find(t => t.id === id).firstStage;
  assert.equal(at('far'), 0, 'the pit is jumpable from the start');
  assert.ok(at('ledge') >= 1, 'the ledge needs the double jump learned across the pit');
  assert.equal(s.envelopeSources, 1);
  assert.deepEqual(s.problems.filter(p => p.severity !== 'info'), []);
});

test('tilemap: without the ability the ledge is unreachable for both the space and the steering player', () => {
  const { doc } = normalized(platformDoc({ ability: false }));
  const plot = solve(doc, cat.registry, cat.logic, { maxStates: 200 });
  assert.equal(plot.completable, false);
  assert.equal(plot.exhaustive, true);
  const problems = (s => s.problems)(verifySpatial(doc, cat.registry, cat.logic, { plot }));
  const ledge = problems.find(p => p.code === 'target_unreachable');
  assert.equal(ledge.path, 'spaces[0].zones[2]');
  assert.equal(ledge.severity, 'error');
});

test('tilemap: steering macros drive the real controls (jump discovered, pit cleared, no warping)', () => {
  const { doc } = normalized(platformDoc());
  const rt = maker(doc, cat.registry, cat.logic)(2);
  assert.equal(jumpVerb(rt), 'jump');
  assert.equal(travel(rt, cat.registry, 'far', { mode: 'steer', jump: 'jump' }), true);
  assert.equal(rt.state.status, 'playing');
  assert.ok(rt.player().at[0] > 10.5 && rt.player().components.body.grounded);
  const before = rt.state.frame;
  assert.equal(travel(rt, cat.registry, 'ledge', { mode: 'steer', jump: 'jump' }), true, 'double jump onto the ledge');
  assert.ok(rt.state.frame > before);
});

test('tilemap: the playtest wins through steered travel and replays the win', () => {
  const { doc } = normalized(platformDoc());
  const r = playtest(doc, cat.registry, cat.logic, { maxRounds: 300, seed: 1 });
  assert.equal(r.travel, 'steer');
  assert.equal(r.winnable, true);
  assert.equal(r.win.replayed, true);
});

test('grid: reachable keys map to zones and entity cells; sealed places are reported', () => {
  const { doc } = normalized(gridDoc());
  const plot = solve(doc, cat.registry, cat.logic);
  assert.equal(plot.travel, null, 'grid moves come from options here');
  assert.equal(plot.completable, true);
  assert.equal(plot.endings.free.length, 10, 'shortest maze path');
  const s = verifySpatial(doc, cat.registry, cat.logic, { plot });
  assert.ok(s.problems.some(p => p.code === 'zone_unreachable' && p.path === 'spaces[0].zones[2]'));
  assert.equal(s.entities.coin, 0);
  assert.equal(s.entities.lever, null);
  assert.ok(s.problems.some(p => p.code === 'entity_unreachable' && p.path === 'systems[1].with'));
});

test('grid: with real-time axis movement only, travel macros steer the player to the exit', async () => {
  const { doc } = normalized(gridDoc({ options: false }));
  const plot = solve(doc, cat.registry, cat.logic, { maxStates: 50 });
  assert.equal(plot.travel, 'steer');
  assert.deepEqual(plot.endings.free, ['travel exit']);
  const r = await verify(gridDoc({ options: false }), cat.registry, cat.logic, { playtest: { maxRounds: 200 } });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.equal(r.playtest.winnable, true);
});

test('ARC harness on the real engine.space.grid (default allow-list)', () => {
  const level = (exit, baseline) => {
    const d = gridDoc();
    d.spaces[0].zones[1].rect = [exit[0], exit[1], exit[0] + 1, exit[1] + 1];
    return { doc: d, baseline };
  };
  const r = runArc([level([6, 0], 10), level([4, 6], 6)], cat.registry, cat.logic);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.levels.map(l => l.actions), [10, 12]);
  assert.deepEqual(r.levels.map(l => l.score), [100, 25]);
  assert.equal(r.score, 50);
});

test('navigation options expand unlocked abilities into their movement grants', () => {
  const d = platformDoc();
  d.systems[0].with.abilities = [{ id: 'double_jump' }, { id: 'moth_wings', grants: ['doubleJump', 'glide'] }];
  const { doc } = normalized(d);
  const rt = maker(doc, cat.registry, cat.logic)(1);
  assert.equal(navOptions(rt, cat.registry).opts.abilities.doubleJump, undefined);
  rt.run([{ do: 'unlock_ability', ability: 'moth_wings' }]);
  const nav = navOptions(rt, cat.registry);
  assert.ok(nav.abilities.has('moth_wings') && nav.abilities.has('glide'));
  assert.equal(nav.opts.abilities.doubleJump, true, 'tilemap nav reads the grant name');
  assert.equal(nav.opts.who, 'player');
});
