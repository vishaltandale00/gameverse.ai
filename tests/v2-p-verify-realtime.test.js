import test from 'node:test';
import assert from 'node:assert/strict';
import { select, strategies } from '../v2/verify/strategies/index.js';
import { maker } from '../v2/verify/drive.js';
import { fixtureCatalogue, normalized, cellDoc } from './v2-p-verify-fixtures.js';

const cat = fixtureCatalogue();
const ctxOf = doc => { const n = normalized(doc, cat); return { doc: n.doc, registry: cat.registry, logic: cat.logic, make: maker(n.doc, cat.registry, cat.logic), seed: 1, capabilities: n.checked.capabilities, used: new Set(n.doc.systems.map(s => s.use)), playerSpace: n.doc.spaces[0].id }; };
const chosen = ctx => select(ctx).chosen.map(c => c.s.id);
const run = (id, doc, opts = {}) => { const ctx = ctxOf(doc); return { r: strategies.get(id).run(ctx, opts), ctx }; };
const spawn = entities => ({ use: 'gameplay.fixture.spawn', with: { entities } });

// ---------- documents ----------
const chaseDoc = ({ hard = false } = {}) => {
  if (hard) return cellDoc({ id: 'corridor', size: [9, 1, 1], at: [0, 0, 0], systems: [{ use: 'gameplay.fixture.step', with: { options: false } }, spawn([...[1, 2, 3, 5, 6, 7, 8].map(x => ({ archetype: 'pellet', at: [x, 0, 0], components: { collectible: {} } })), { archetype: 'ghost', at: [4, 0, 0], components: { ai: { every: 3, home: [4, 0, 0] } } }]), { use: 'gameplay.fixture.pellets' }, { use: 'gameplay.fixture.chasers', with: { lives: 1 } }] });
  const pel = [];
  for (let x = 0; x < 7; x++) for (let y = 0; y < 7; y++) if ((x + y) % 2 === 1 && !([2, 4].includes(x) && [2, 4].includes(y))) pel.push({ archetype: 'pellet', at: [x, y, 0], components: { collectible: {} } });
  return cellDoc({ id: 'chase', size: [7, 7, 1], solid: [[2, 2, 0], [4, 2, 0], [2, 4, 0], [4, 4, 0]], at: [0, 0, 0], systems: [{ use: 'gameplay.fixture.step', with: { options: false } }, spawn([...pel, { archetype: 'ghost', at: [6, 6, 0], components: { ai: { every: 9, home: [6, 6, 0] } } }]), { use: 'gameplay.fixture.pellets' }, { use: 'gameplay.fixture.chasers', with: { lives: 3 } }] });
};
const dodgeDoc = ({ row = false } = {}) => cellDoc({ id: 'dodge', size: [16, 12, 1], at: [8, 1, 0], components: { health: { hp: 3, max: 3 } }, systems: [{ use: 'gameplay.fixture.glide', with: { speed: 0.2 } }, { use: 'gameplay.fixture.bullets', with: row ? { every: 40, row: true, frames: 300 } : { every: 12, speed: 0.15, frames: 300 } }] });
const runnerDoc = ({ wall = false } = {}) => cellDoc({ id: 'runner', size: [60, 3, 1], at: [0, 1, 0],
  solid: [[10, 1, 0], [15, 0, 0], [15, 1, 0], [25, 2, 0], [25, 1, 0], [32, 0, 0], [45, 1, 0], [50, 2, 0], [50, 0, 0], ...(wall ? [[30, 0, 0], [30, 1, 0], [30, 2, 0]] : [])],
  zones: [{ id: 'c1', rect: [0, 0, 20, 3] }, { id: 'c2', rect: [20, 0, 40, 3] }, { id: 'c3', rect: [40, 0, 60, 3] }],
  systems: [{ use: 'gameplay.fixture.runner' }] });
const versusDoc = (w = {}, foeHp = 6) => cellDoc({ id: 'versus', size: [12, 3, 1], at: [2, 0, 0], components: { health: { hp: 10, max: 10 }, body: { size: [1, 1, 1] } }, systems: [spawn([{ archetype: 'brute', at: [8, 0, 0], components: { health: { hp: foeHp }, ai: {}, body: { size: [1, 1, 1] } } }]), { use: 'gameplay.combat.fixture', with: w }] });
const aimDoc = ({ boxed = false } = {}) => cellDoc({ id: 'aim', size: [30, 12, 1], at: [0, 0, 0],
  solid: boxed ? [[24, 0, 0], [25, 0, 0], [26, 0, 0], [24, 1, 0], [26, 1, 0], [24, 2, 0], [25, 2, 0], [26, 2, 0]] : [],
  archetypes: [{ id: 'crate', components: { health: { hp: 1 } } }],
  systems: [spawn([{ archetype: 'crate', id: 'near', at: [12.5, 1.5, 0], components: { health: { hp: 1 } } }, { archetype: 'crate', id: 'far', at: boxed ? [25.5, 1.5, 0] : [20.5, 3.5, 0], components: { health: { hp: 1 } } }]), { use: 'gameplay.fixture.launcher', with: { shots: 4 } }] });
const ballDoc = (w = {}) => cellDoc({ id: 'table', size: [10, 10, 1], at: [0, 0, 0], archetypes: [{ id: 'ball', components: {} }], systems: [spawn([{ archetype: 'ball', at: [5, 5, 0], components: { body: { vel: [0.13, 0.17, 0] } } }]), { use: 'gameplay.fixture.balls', with: w }] });
const battleDoc = (w = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'battle', title: 'battle', seed: 1,
  spaces: [{ id: 'arena', use: 'engine.space.graph', zones: [{ id: 'ring', exits: [] }] }],
  systems: [{ use: 'gameplay.fixture.battle', with: w }],
  content: { archetypes: [{ id: 'hero', components: { health: { hp: 20, max: 20 } } }, { id: 'foe', components: {} }] },
  player: { archetype: 'hero', at: 'ring' },
});

test('real-time strategies are chosen by capabilities and observed behavior', () => {
  assert.deepEqual(chosen(ctxOf(chaseDoc())), ['danger-field']);
  assert.deepEqual(chosen(ctxOf(dodgeDoc())), ['dodge']);
  assert.deepEqual(chosen(ctxOf(runnerDoc())), ['beam']);
  assert.deepEqual(chosen(ctxOf(versusDoc())), ['versus']);
  assert.deepEqual(chosen(ctxOf(aimDoc())), ['aim']);
  assert.deepEqual(chosen(ctxOf(ballDoc())), ['random-policy']);
  assert.deepEqual(chosen(ctxOf(battleDoc())), ['balance']);
});

test('danger-field BFS clears a chase maze and fails a corridor blocked by a faster chaser', () => {
  const { r } = run('danger-field', chaseDoc(), { maxFrames: 4000 });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.ok(r.metrics.runs[0].clearedPct >= 60);
  const hard = run('danger-field', chaseDoc({ hard: true }), { maxFrames: 1500 }).r;
  assert.equal(hard.ok, false);
  assert.equal(hard.problems[0].code, 'too_hard');
});

test('rollout dodger survives aimed-free bullet rain and reports an unavoidable wall', () => {
  const { r } = run('dodge', dodgeDoc(), { seconds: 5 });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.equal(r.metrics.runs[0].survived, 1);
  const idle = ctxOf(dodgeDoc()).make(1);
  for (let i = 0; i < 300 && idle.state.status === 'playing'; i++) idle.step({});
  assert.ok(idle.state.status === 'lost' || idle.player().components.health.hp < 3, 'the rain hits a player who does not dodge');
  const wall = run('dodge', dodgeDoc({ row: true }), { seconds: 5 }).r;
  assert.equal(wall.ok, false);
  assert.equal(wall.problems[0].code, 'bot_failed');
});

test('beam prover finds a line through a scrolling course and names the impassable zone', () => {
  const { r } = run('beam', runnerDoc());
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.equal(r.metrics.axis, 0);
  const blocked = run('beam', runnerDoc({ wall: true })).r;
  assert.equal(blocked.ok, false);
  assert.equal(blocked.problems[0].code, 'chunk_impassable');
  assert.equal(blocked.problems[0].path, 'spaces[0].zones[1]');
});

test('versus: attacks connect (a too-short verb whiffs), the AI finishes, a scripted player wins', () => {
  const { r } = run('versus', versusDoc());
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.deepEqual(r.metrics.connected, ['attack']);
  assert.ok(r.problems.some(p => p.code === 'whiff' && /kick/.test(p.message)));
  assert.ok(r.metrics.matches.some(m => m.won));
  const passive = run('versus', versusDoc({ foeAttacks: false })).r;
  assert.ok(passive.problems.some(p => p.code === 'stalemate'));
  const tough = run('versus', versusDoc({ foeDamage: 3 }, 200), { matchFrames: 1200, seeds: [1, 2] }).r;
  assert.ok(tough.problems.some(p => p.code === 'too_hard'));
});

test('aim search clears targets shot by shot and reports a target no aim can touch', () => {
  const { r } = run('aim', aimDoc());
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.ok(r.metrics.shots.length <= 4);
  const boxed = run('aim', aimDoc({ boxed: true })).r;
  assert.equal(boxed.ok, false);
  const t = boxed.problems.find(p => p.code === 'target_unreachable');
  assert.match(t.message, /'far'/);
  assert.equal(t.path, 'content.archetypes[1]');
  assert.ok(boxed.problems.some(p => p.code === 'launch_unsolved'));
});

test('random policy: a bouncing table is clean; glue strands a ball; a missing wall lets it escape', () => {
  assert.deepEqual(run('random-policy', ballDoc(), { runs: 2, seconds: 8 }).r.problems, []);
  const glue = run('random-policy', ballDoc({ glue: Array.from({ length: 10 }, (_, x) => [x, 0, 0]) }), { runs: 1, seconds: 15 }).r;
  assert.ok(glue.problems.some(p => p.code === 'body_stuck' && p.path === 'content.archetypes[1]'));
  const leaky = run('random-policy', ballDoc({ leaky: true }), { runs: 1, seconds: 15 }).r;
  assert.equal(leaky.ok, false);
  assert.ok(leaky.problems.some(p => p.code === 'body_escaped'));
});

test('balance simulation: a fair battle passes, an overtuned foe fails the pass rate', () => {
  const { r } = run('balance', battleDoc(), { seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.ok(r.metrics.rate >= 0.7);
  const hard = run('balance', battleDoc({ foeHp: 60, foeDamage: 6, foeHit: 0.9 }), { seeds: [1, 2, 3, 4, 5, 6] }).r;
  assert.equal(hard.ok, false);
  assert.equal(hard.problems[0].code, 'encounter_too_hard');
});

test('strategy runs are deterministic for the same document and seed', () => {
  const a = run('danger-field', chaseDoc(), { maxFrames: 1500 }).r.metrics, b = run('danger-field', chaseDoc(), { maxFrames: 1500 }).r.metrics;
  assert.deepEqual(a, b);
  const x = run('balance', battleDoc(), { seeds: [1, 2, 3] }).r.metrics, y = run('balance', battleDoc(), { seeds: [1, 2, 3] }).r.metrics;
  assert.deepEqual(x, y);
});
