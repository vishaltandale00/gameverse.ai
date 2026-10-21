import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compile, run, testSpace } from '../v2/kernel/testing.js';
import { catalogue } from '../v2/primitives/index.js';
import { preflight } from '../v2/kernel/document.js';
import AI from '../v2/primitives/gameplay/ai.index.js';

const P = [...AI, testSpace];
const doc = ({ systems = [], archetypes = [], size = [24, 24, 1], solid = [], zones = [], player = [2, 10, 0], plot } = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'brain', title: 'Brain', seed: 3,
  spaces: [{ id: 'w', use: 'engine.space.test', with: { size, solid }, zones }],
  systems: [{ use: 'gameplay.ai.brain', with: { tick: 0.1 } }, ...systems],
  content: { archetypes: [{ id: 'hero', components: {} }, ...archetypes] },
  player: { archetype: 'hero', at: player }, ...(plot ? { plot } : {}),
});
const wolf = (brain, extra = {}) => ({ id: 'wolf', kind: 'enemy', components: { ai: { brain, perception: { sight: 30, fov: 360, hearing: 10, memory: 3 }, speed: 4, ...extra } } });
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

test('chase: an enemy that sees the player closes in by moving, never jumping', () => {
  const { rt } = compile(doc({ archetypes: [wolf([{ do: 'chase', when: { aware: 'player' } }, { do: 'sit' }])] }), { primitives: P });
  const w = rt.spawn('wolf', { at: [16, 10, 0] });
  let prev = w.at.slice(), maxStep = 0;
  for (let i = 0; i < 260; i++) { rt.step(); maxStep = Math.max(maxStep, dist(prev, w.at)); prev = w.at.slice(); }
  assert.ok(dist(w.at, rt.player().at) <= 1.6, `wolf reached the player: ${w.at}`);
  assert.ok(maxStep <= 4 / 60 + 1e-6, `moves at most speed*dt per frame (${maxStep})`);
  assert.equal(rt.state.counts.aggro, 1);
});

test('flee keeps away; follow keeps a distance; perception respects walls (line of sight)', () => {
  const solid = Array.from({ length: 24 }, (_, y) => [8, y, 0]).filter(c => c[1] !== 0);
  const deer = { id: 'deer', kind: 'creature', components: { ai: { brain: [{ do: 'flee', when: { near: 'player', within: 6 }, range: 10 }, { do: 'sit' }], speed: 3 } } };
  const dog = { id: 'dog', kind: 'ally', components: { ai: { brain: [{ do: 'follow', target: 'player', distance: 2 }], speed: 3 } } };
  const { rt } = compile(doc({ archetypes: [deer, dog, wolf([{ do: 'chase', when: { aware: 'player' } }, { do: 'sit' }])], solid }), { primitives: P });
  const d = rt.spawn('deer', { at: [5, 10, 0] }), g = rt.spawn('dog', { at: [2, 3, 0] }), w = rt.spawn('wolf', { at: [14, 10, 0] });
  run(rt, 240);
  assert.ok(dist(d.at, rt.player().at) > 5.5, `deer fled to ${d.at}`);
  assert.ok(Math.abs(dist(g.at, rt.player().at) - 2) < 0.7, `dog kept ~2 away: ${g.at}`);
  assert.deepEqual(w.at, [14, 10, 0], 'wolf behind a wall never saw the player');
  assert.equal(rt.state.counts.aggro ?? 0, 0);
});

test('hearing, memory, group alert and the aggro leash', () => {
  const pack = wolf([{ do: 'chase', when: { aware: 'hostile' } }, { do: 'sit' }], { alert: 20, leash: 6, perception: { sight: 4, fov: 90, hearing: 12, memory: 2 } });
  const { rt } = compile(doc({ archetypes: [pack], player: [2, 2, 0] }), { primitives: P });
  const a = rt.spawn('wolf', { at: [12, 2, 0] }), b = rt.spawn('wolf', { at: [12, 12, 0] });
  run(rt, 10);
  assert.equal(rt.state.counts.aggro ?? 0, 0, 'out of sight: unaware');
  rt.run([{ do: 'make_noise', who: 'player', radius: 15 }]);
  run(rt, 12);
  assert.ok(rt.test({ aware: 'hostile', who: a.id }), 'heard the noise');
  assert.ok((rt.state.counts.alerted ?? 0) >= 1, 'the pack was alerted');
  run(rt, 200);
  assert.ok((rt.state.counts.leashed ?? 0) >= 1, 'gave up past the leash');
  assert.ok(dist(a.at, [12, 2]) <= 6.5, `stayed within leash range of home: ${a.at}`);
});

test('patrol ping-pongs, wander stays near home, both replay deterministically', () => {
  const guard = { id: 'guard', kind: 'npc', components: { ai: { brain: [{ do: 'patrol', route: [[4, 4, 0], [10, 4, 0]] }], speed: 3 } } };
  const cow = { id: 'cow', kind: 'creature', components: { ai: { brain: [{ do: 'wander', range: 4, pause: 0.2 }], speed: 2 } } };
  const make = () => { const { rt } = compile(doc({ archetypes: [guard, cow] }), { primitives: P }); rt.spawn('guard', { at: [4, 4, 0] }); rt.spawn('cow', { at: [15, 15, 0] }); return rt; };
  const a = make(), b = make();
  const xs = new Set();
  for (let i = 0; i < 360; i++) { a.step(); b.step(); xs.add(Math.round(a.state.entities.e1.at[0])); assert.ok(dist(a.state.entities.e2.at, [15, 15]) <= 4.3); }
  assert.ok(xs.has(4) && xs.has(10), 'guard visited both ends');
  assert.deepEqual(a.snapshot(), b.snapshot());
  const snap = a.snapshot(); run(a, 60); const end = a.snapshot(); a.restore(snap); run(a, 60);
  assert.deepEqual(a.snapshot(), end, 'restore + replay');
});

test('patrol: a point the movement cannot reach is reported and passed over; the agent keeps patrolling the rest', () => {
  // [12, 4] is walled in: the shared AI locomotion stays blocked from it, and so does a move.* controller's path.
  const solid = [];
  for (let x = 11; x <= 13; x++) for (let y = 3; y <= 5; y++) if (x !== 12 || y !== 4) solid.push([x, y, 0]);
  const route = [[4, 4, 0], [12, 4, 0], [4, 12, 0]];
  for (const systems of [[], [{ use: 'gameplay.move.walk' }]]) {
    const guard = { id: 'guard', kind: 'npc', components: { ai: { brain: [{ do: 'patrol', route, pause: 0.1 }], speed: 4 }, ...(systems.length ? { move: {} } : {}) } };
    const { rt } = compile(doc({ archetypes: [guard], solid, systems }), { primitives: [...P, ...catalogue().registry.ids().filter(id => id === 'gameplay.move.walk').map(id => catalogue().registry.get(id))] });
    const g = rt.spawn('guard', { at: [4, 4, 0] }), failed = [];
    rt.on('move_failed', d => { if (d.who === g.id) failed.push({ ...d, t: rt.state.time }); });
    const visits = { a: 0, c: 0 };
    let near = null;
    for (let i = 0; i < 1500; i++) {
      rt.step();
      const at = dist(g.at, route[0]) < 0.6 ? 'a' : dist(g.at, route[2]) < 0.6 ? 'c' : null;
      if (at && at !== near) visits[at]++;
      near = at ?? near;
    }
    const label = systems.length ? 'move.walk' : 'ai locomotion';
    assert.ok(failed.length >= 1 && failed.every(d => d.by === 'ai' && JSON.stringify(d.at) === JSON.stringify(route[1])), `${label}: the unreachable point is reported (${JSON.stringify(failed.slice(0, 2))})`);
    assert.ok(visits.c >= 2 && visits.a >= 2, `${label}: still patrols the reachable points (${JSON.stringify(visits)})`);
  }
});

test('target-tile: greedy target cell, never reversing, tie order U L D R; personalities as data', () => {
  // A plus-shaped junction at (10,10): open arms up, left, down, right.
  const solid = [];
  for (let x = 0; x < 21; x++) for (let y = 0; y < 21; y++) if (x !== 10 && y !== 10) solid.push([x, y, 0]);
  const ghost = personality => ({ id: `g_${personality}`, kind: 'enemy', components: { ai: { brain: [{ do: 'target-tile', personality, scatter: [20, 0, 0] }], speed: 5 } } });
  const { rt } = compile(doc({ size: [21, 21, 1], solid, player: [10, 16, 0], archetypes: ['chaser', 'ambusher', 'shy'].map(ghost) }), { primitives: P });
  const g = rt.spawn('g_chaser', { at: [10, 10, 0] });
  run(rt, 8);
  // Player is straight below (screen y grows down): chaser goes down (dir 2).
  assert.equal(rt.state.prim['gameplay.ai.brain'].agents[g.id].dir, 2);
  run(rt, 30);
  assert.ok(g.at[1] > 10.5 && g.at[0] === 10, `lane-locked down the corridor: ${g.at}`);
  // Tie: target equidistant left/right from up the column: U L D R prefers up.
  const { rt: r2 } = compile(doc({ size: [21, 21, 1], solid, player: [10, 10, 0], archetypes: [ghost('chaser')] }), { primitives: P });
  const g2 = r2.spawn('g_chaser', { at: [10, 10, 0] });
  run(r2, 8);
  assert.equal(r2.state.prim['gameplay.ai.brain'].agents[g2.id].dir, 0, 'ties go up first');
  // Shy ghost close to the player heads to its scatter corner instead.
  const { rt: r3 } = compile(doc({ size: [21, 21, 1], solid, player: [10, 12, 0], archetypes: [ghost('shy')] }), { primitives: P });
  const g3 = r3.spawn('g_shy', { at: [10, 10, 0] });
  run(r3, 8);
  assert.deepEqual(r3.state.prim['gameplay.ai.brain'].agents[g3.id].tile, [20, 0, 0]);
});

test('modeSchedule: scatter/chase tables flip modes and reverse target-tile agents', () => {
  const d = doc({ archetypes: [{ id: 'g', kind: 'enemy', components: { ai: { brain: [{ do: 'target-tile', personality: 'chaser', scatter: [23, 0, 0] }], speed: 4 } } }] });
  d.systems[0].with.modeSchedule = { table: [[0.5, 1, -1]], resetOn: ['reset_modes'] };
  const { rt } = compile(d, { primitives: P });
  run(rt, 2);
  assert.equal(rt.state.vars['ai.mode'], 'scatter');
  run(rt, 30);
  assert.equal(rt.state.vars['ai.mode'], 'chase');
  run(rt, 60);
  assert.equal(rt.state.vars['ai.mode'], 'scatter');
  assert.equal(rt.state.counts['ai_mode:chase'], 1);
  run(rt, 300);
  assert.equal(rt.state.counts.ai_mode, 2, 'the last phase lasts forever');
});

test('modeSchedule tiers by level var, and Elroy speeds a chaser up when its predicate holds', () => {
  const d = doc({ archetypes: [{ id: 'g', kind: 'enemy', components: { ai: { brain: [{ do: 'target-tile', personality: 'chaser', scatter: [23, 0, 0], elroy: [{ when: { var: 'pellets.left', lte: 20 }, speed: 1.5 }] }], speed: 4 } } }] });
  d.systems[0].with.modeSchedule = { table: [[2, -1], [0.5, -1]], tierBy: { var: 'level', above: [1] } };
  const { rt } = compile(d, { primitives: P });
  rt.state.vars.level = 2; rt.state.vars['pellets.left'] = 100; run(rt, 40);
  assert.equal(rt.state.vars['ai.mode'], 'chase', 'level 2 uses the faster second row');
  const g = rt.spawn('g', { at: [10, 10, 0] }); run(rt, 10);
  const step = () => { const x = g.at.slice(); rt.step(); return Math.hypot(g.at[0] - x[0], g.at[1] - x[1]); };
  const normal = step();
  rt.state.vars['pellets.left'] = 10;
  const elroy = step();
  assert.ok(Math.abs(elroy / normal - 1.5) < 1e-3, `Elroy ×1.5 (${normal} → ${elroy})`);
});

test('sight-challenge: a trainer spots the player on its facing line, walks up and runs its effects once', () => {
  const trainer = { id: 'trainer', kind: 'npc', components: { body: { facing: [-1, 0, 0] }, ai: { brain: [{ do: 'sight-challenge', range: 5, then: [{ do: 'set_flag', flag: 'battle' }] }], speed: 4 } } };
  const { rt } = compile(doc({ archetypes: [trainer], player: [2, 10, 0] }), { primitives: P });
  const t = rt.spawn('trainer', { at: [9, 10, 0] });
  run(rt, 30);
  assert.equal(rt.state.flags.battle, undefined, 'player 7 away: not spotted');
  rt.space('w').setPos(rt.player(), [5, 10, 0], rt);
  run(rt, 90);
  assert.equal(rt.state.counts.spotted, 1);
  assert.equal(rt.state.flags.battle, true);
  assert.ok(Math.abs(t.at[0] - 6) < 0.1, `walked up next to the player: ${t.at}`);
  run(rt, 60);
  assert.equal(rt.state.counts['challenge:trainer'], 1, 'once');
  // Behind the trainer (not on its facing line) is never spotted.
  const { rt: r2 } = compile(doc({ archetypes: [trainer], player: [12, 10, 0] }), { primitives: P });
  r2.spawn('trainer', { at: [9, 10, 0] }); run(r2, 60);
  assert.equal(r2.state.counts.spotted ?? 0, 0);
});

test('commands, set_ai, scripted move_to priority and distance LOD', () => {
  const npc = { id: 'npc', kind: 'npc', components: { ai: { brain: [{ do: 'sit' }], speed: 4 } } };
  const d = doc({ archetypes: [npc] });
  d.systems[0].with.maxActive = 2;
  const { rt } = compile(d, { primitives: P });
  const near = rt.spawn('npc', { at: [3, 10, 0] }), mid = rt.spawn('npc', { at: [6, 10, 0] }), far = rt.spawn('npc', { at: [20, 20, 0] });
  rt.run([{ do: 'command', who: near.id, order: { do: 'goto', at: [3, 4, 0] } }]);
  rt.run([{ do: 'move_to', who: mid.id, at: [6, 16, 0] }]);
  rt.run([{ do: 'set_ai', who: far.id, mode: 'wander' }]);
  run(rt, 120);
  assert.ok(dist(near.at, [3, 4]) < 0.2, `order done: ${near.at}`);
  assert.equal(rt.state.counts.order_done, 1);
  assert.ok(dist(mid.at, [6, 16]) < 0.2, 'scripted move_to carried out');
  assert.equal(rt.state.counts.arrived, 1);
  assert.deepEqual(far.at, [20, 20, 0], 'outside maxActive: frozen');
  assert.ok(rt.test({ behavior: 'goto', who: near.id }) || rt.test({ behavior: 'sit', who: near.id }));
});

test('preflight rejects bad ai components and brain params with stable codes', () => {
  const { registry, logic } = catalogue([testSpace]);
  const bad = doc({ archetypes: [wolf([{ do: 'teleport_spin' }, { do: 'chase', when: { bogus: 1 }, rnage: 3 }, { do: 'target-tile' }, { do: 'sight-challenge' }], { perception: { sight: -1, smell: 3 } })] });
  bad.systems[0].with.tick = 0;
  bad.systems[0].with.modeSchedule = { table: [[7, 20]], tierBy: { var: 'level', above: [1, 4] } };
  const codes = preflight(bad, registry, logic).errors.map(e => e.code);
  for (const c of ['ai_behavior_unknown', 'predicate_unknown', 'param_unknown', 'ai_target_rule', 'ai_challenge_then', 'param_range', 'ai_schedule_tiers']) assert.ok(codes.includes(c), c);
  const noBrain = doc({ archetypes: [{ id: 'x', components: { ai: { speed: 2 } } }] });
  assert.ok(preflight(noBrain, registry, logic).errors.some(e => e.code === 'param_missing'));
});

test('every gameplay.ai.brain instance and ai component in v2/games preflights without param errors', () => {
  const { registry, logic } = catalogue();
  for (const f of fs.readdirSync('v2/games')) {
    const d = JSON.parse(fs.readFileSync(`v2/games/${f}`, 'utf8'));
    const mine = (d.systems || []).map((s, i) => [s, `systems[${i}]`]).filter(([s]) => s.use === 'gameplay.ai.brain').map(x => x[1]);
    const errs = preflight(d, registry, logic).errors.filter(e => mine.some(p => e.path?.startsWith(p)) || /components\.ai\b/.test(e.path || ''));
    // Other workstreams' vocabulary and spaces are not registered yet; everything else must be clean.
    const ours = errs.filter(e => !['capability_missing', 'requires_unmet', 'service_missing'].includes(e.code) && (e.code !== 'predicate_unknown' || /\b(aware|behavior)\b/.test(e.message)));
    assert.deepEqual(ours, [], f);
  }
});
