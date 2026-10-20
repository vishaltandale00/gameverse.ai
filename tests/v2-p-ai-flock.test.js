// gameplay.ai.flock and gameplay.ai.director.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, run, testSpace } from '../v2/kernel/testing.js';
import { catalogue } from '../v2/primitives/index.js';
import { preflight } from '../v2/kernel/document.js';
import AI from '../v2/primitives/gameplay/ai.index.js';

const P = [...AI, testSpace];
const doc = (systems, { solid = [], player = [5, 5, 0], archetypes = [] } = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'flock', title: 'Flock', seed: 6,
  spaces: [{ id: 'w', use: 'engine.space.test', with: { size: [80, 80, 1], solid } }],
  systems, content: { archetypes: [{ id: 'hero', components: {} }, { id: 'sheep', kind: 'creature', components: {} }, { id: 'ghoul', kind: 'enemy', components: { ai: { brain: [{ do: 'chase', when: { aware: 'player' } }, { do: 'sit' }], speed: 3 } } }, ...archetypes] },
  player: { archetype: 'hero', at: player },
});
const herd = (extra = {}) => ({ use: 'gameplay.ai.flock', with: { flocks: [{ id: 'herd', archetype: 'sheep', count: 12, at: [40, 40, 0], spread: 5, maxSpeed: 4, ...extra }] } });
const members = rt => Object.values(rt.state.entities).filter(e => e.components.boid);
const centroid = es => es.reduce((c, e) => [c[0] + e.at[0] / es.length, c[1] + e.at[1] / es.length], [0, 0]);

test('flock: members stay together without collapsing, stay leashed to home, and scatter from the player', () => {
  const { rt } = compile(doc([herd()]), { primitives: P });
  run(rt, 600);
  const m = members(rt); assert.equal(m.length, 12);
  const c = centroid(m);
  assert.ok(Math.hypot(c[0] - 40, c[1] - 40) < 25, `leashed near home: ${c}`);
  const spread = Math.max(...m.map(e => Math.hypot(e.at[0] - c[0], e.at[1] - c[1])));
  assert.ok(spread < 15, `cohesive (${spread})`);
  let minPair = Infinity; for (const a of m) for (const b of m) if (a !== b) minPair = Math.min(minPair, Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]));
  assert.ok(minPair > 0.3, `separated (${minPair})`);
  // Walk the player into the herd: members near the player move away.
  rt.space('w').setPos(rt.player(), [c[0], c[1], 0], rt);
  const before = members(rt).map(e => Math.hypot(e.at[0] - c[0], e.at[1] - c[1]));
  run(rt, 60);
  assert.equal(rt.state.counts.flock_scatter >= 1, true);
  const after = members(rt).map(e => Math.hypot(e.at[0] - c[0], e.at[1] - c[1]));
  assert.ok(after.reduce((a, b) => a + b) > before.reduce((a, b) => a + b), 'spread away from the player');
});

test('flock: walls are avoided by look-ahead raycasts; replay is deterministic', () => {
  const wall = Array.from({ length: 80 }, (_, y) => [50, y, 0]);
  const { rt } = compile(doc([herd({ maxSpeed: 6, leash: 0, wander: 0.6, avoid: [] })], { solid: wall }), { primitives: P });
  run(rt, 900);
  for (const e of members(rt)) assert.ok(e.at[0] < 50, `never inside or past the wall: ${e.at}`);
  const a = compile(doc([herd()]), { primitives: P }).rt, b = compile(doc([herd()]), { primitives: P }).rt;
  run(a, 200); run(b, 200);
  assert.deepEqual(a.snapshot(), b.snapshot());
});

const RING = (() => { const r = []; for (let x = 25; x <= 55; x++) for (let y = 25; y <= 55; y++) { const d = Math.hypot(x - 40, y - 40); if (d > 6 && d < 7) r.push([x, y, 0]); } return r; })();
const DIRECTOR = (extra = {}) => ({ use: 'gameplay.ai.director', with: { spawns: [{ archetype: 'ghoul', cost: 2, group: [1, 2] }], maxAlive: 6, distance: [10, 20], budgetRate: 2, peak: 50, peakSec: 1, relaxSec: 2, calm: 10, decay: 10, ...extra } });

test('director: builds up by spawning out of sight at range, peaks on intensity, relaxes, then builds again', () => {
  // A wall ring around the player hides the spawn band (spawns must be out of sight).
  const { rt } = compile(doc([{ use: 'gameplay.ai.brain' }, DIRECTOR()], { player: [40, 40, 0], solid: RING }), { primitives: P });
  run(rt, 180);
  const spawned = Object.values(rt.state.entities).filter(e => e.components.directorSpawn);
  assert.ok(spawned.length >= 2 && spawned.length <= 6, `spawned ${spawned.length}`);
  for (const e of spawned) { const d = Math.hypot(e.at[0] - 40, e.at[1] - 40); assert.ok(d >= 8.5 && d <= 21.5, `at range: ${d}`); }
  assert.equal(rt.state.vars['director.phase'], 'build');
  rt.emit('alarm', {}); rt.emit('alarm', {}); rt.emit('alarm', {});
  run(rt, 2);
  assert.equal(rt.state.vars['director.phase'], 'peak');
  run(rt, 70); assert.equal(rt.state.vars['director.phase'], 'relax');
  const n = rt.state.counts.director_spawn; run(rt, 60);
  assert.equal(rt.state.counts.director_spawn, n, 'no spawns while relaxing');
  run(rt, 400); assert.equal(rt.state.vars['director.phase'], 'build', 'calmed down: build again');
  assert.ok(rt.state.counts['director_phase:build'] >= 1);
});

test('director: hidden spawns respect line of sight; set_director overrides; deterministic', () => {
  // Open field: every spot is visible, so nothing may spawn while hidden is required.
  const { rt } = compile(doc([DIRECTOR()], { player: [40, 40, 0] }), { primitives: P });
  run(rt, 200);
  assert.equal(rt.state.counts.director_spawn ?? 0, 0, 'everything is in plain sight');
  const ring = []; for (let x = 25; x <= 55; x++) for (let y = 25; y <= 55; y++) { const d = Math.hypot(x - 40, y - 40); if (d > 6 && d < 7) ring.push([x, y, 0]); }
  const { rt: r2 } = compile(doc([DIRECTOR()], { player: [40, 40, 0], solid: ring }), { primitives: P });
  run(r2, 200);
  assert.ok(r2.state.counts.director_spawn >= 1, 'spawns behind cover');
  r2.run([{ do: 'set_director', phase: 'off' }]); const k = r2.state.counts.director_spawn; run(r2, 120);
  assert.equal(r2.state.counts.director_spawn, k);
  const a = compile(doc([DIRECTOR()], { player: [40, 40, 0], solid: ring }), { primitives: P }).rt, b = compile(doc([DIRECTOR()], { player: [40, 40, 0], solid: ring }), { primitives: P }).rt;
  run(a, 240); run(b, 240); assert.deepEqual(a.snapshot(), b.snapshot());
});

test('preflight rejects bad flock/director configs with stable codes', () => {
  const { registry, logic } = catalogue([testSpace]);
  const bad = doc([{ use: 'gameplay.ai.flock', with: { flocks: [{ id: 'a', archetype: 'sheep' }, { id: 'a', archetype: 'goat', at: [1, 1, 0], altitude: [9, 2] }] } },
    { use: 'gameplay.ai.director', with: { spawns: [{ archetype: 'ghoul', group: [3, 1] }], distance: [30, 10], calm: 90, peak: 50 } }]);
  bad.plot = { storyboard: { acts: [{ id: 'a', beats: [{ id: 'b', do: [{ do: 'set_director', phase: 'chaos' }] }] }] } };
  bad.systems.push({ use: 'plot.storyboard' });
  const codes = preflight(bad, registry, logic).errors.map(e => e.code);
  for (const c of ['flock_duplicate', 'flock_home', 'ref_unknown', 'param_range', 'director_thresholds', 'director_phase']) assert.ok(codes.includes(c), c);
});
