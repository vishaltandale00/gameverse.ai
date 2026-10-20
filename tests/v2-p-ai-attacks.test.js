import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compile, run, testSpace } from '../v2/kernel/testing.js';
import { catalogue } from '../v2/primitives/index.js';
import { preflight } from '../v2/kernel/document.js';
import AI from '../v2/primitives/gameplay/ai.index.js';
import { volley } from '../v2/primitives/gameplay/ai-lib-bullets.js';

// Test double for combat.health: the `damage` effect the real one provides.
const health = { id: 'gameplay.test.health', card: { intent: 'test hp', params: {}, provides: { events: ['damaged'] } },
  logic(l) { l.effect('damage', { run: (e, rt) => { const t = rt.entity(e.who); if (!t) return; const h = (t.components.health ??= { max: 10, hp: 10 }); h.hp = (h.hp ?? h.max) - e.amount; rt.emit('damaged', { who: t.id, by: e.by, amount: e.amount }); } }); } };
const P = [...AI, testSpace, health];
const doc = ({ archetypes = [], solid = [], attacks = {}, player = [2, 10, 0], gravity = 0 } = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'atk', title: 'Attacks', seed: 5,
  spaces: [{ id: 'w', use: 'engine.space.test', with: { size: [32, 24, 1], solid, gravity } }],
  systems: [{ use: 'gameplay.ai.brain', with: { tick: 0.1 } }, { use: 'gameplay.ai.attacks', with: attacks }, { use: 'gameplay.test.health' }],
  content: { archetypes: [{ id: 'hero', components: { health: { max: 100, hp: 100 } } }, ...archetypes] },
  player: { archetype: 'hero', at: player },
});
const foe = (attacks, extra = {}) => ({ id: 'foe', kind: 'enemy', components: { ai: { brain: [{ do: 'sit' }], perception: { sight: 40, fov: 360, memory: 5 } }, attacks, ...extra } });
const hp = rt => rt.player().components.health.hp;

test('melee: telegraph, windup before the hit, one hit per swing, cooldown', () => {
  const { rt } = compile(doc({ archetypes: [foe([{ id: 'bite', range: 2, windup: 0.5, active: 0.2, recover: 0.3, cooldown: 1, damage: 3 }])] }), { primitives: P });
  rt.spawn('foe', { at: [3, 10, 0] });
  let telegraphAt = null, hitAt = null;
  for (let i = 0; i < 200; i++) { rt.step(); if (telegraphAt === null && rt.state.events.some(e => e.name === 'telegraph')) telegraphAt = i; if (hitAt === null && rt.state.events.some(e => e.name === 'attack_hit')) hitAt = i; }
  assert.ok(telegraphAt !== null && hitAt - telegraphAt >= 29 && hitAt - telegraphAt <= 31, `windup 0.5 s (${telegraphAt}→${hitAt})`);
  // 200 frames = 3.33 s; each cycle = 0.5+0.2+0.3+1 = 2 s → 2 swings.
  assert.equal(rt.state.counts.attack_hit, 2);
  assert.equal(hp(rt), 94);
});

test('out of range, wrong phase or failing `when`: no attack; boss phase unlocks patterns', () => {
  const atks = [{ id: 'slam', range: 3, windup: 0.1, active: 0.1, recover: 0.1, damage: 5, phase: 2 }, { id: 'jab', range: 3, windup: 0.1, active: 0.1, recover: 0.1, damage: 1, when: { flag: 'angry' } }];
  const { rt } = compile(doc({ archetypes: [foe(atks)] }), { primitives: P });
  const f = rt.spawn('foe', { at: [4, 10, 0] });
  run(rt, 60);
  assert.equal(rt.state.counts.attack_hit ?? 0, 0);
  rt.state.flags.angry = true; run(rt, 30);
  assert.ok(rt.state.counts.attack_hit >= 1); assert.equal(hp(rt) % 1, 0);
  const before = hp(rt); rt.state.flags.angry = false; f.components.boss = { phase: 2 }; run(rt, 30);
  assert.ok(before - hp(rt) >= 5, 'phase-2 slam lands');
  rt.space('w').setPos(rt.player(), [20, 10, 0], rt); const h = hp(rt); run(rt, 60);
  assert.equal(hp(rt), h, 'out of range');
});

test('projectiles travel, hit, and are stopped by walls; lobbed shots arc', () => {
  const shooter = foe([{ id: 'bolt', range: 20, windup: 0.2, active: 0.05, recover: 2, damage: 4, shape: 'projectile', projectile: { speed: 12 } }]);
  const { rt } = compile(doc({ archetypes: [shooter] }), { primitives: P });
  rt.spawn('foe', { at: [14, 10, 0] });
  run(rt, 15);
  assert.equal(Object.values(rt.state.entities).filter(e => e.components.aiShot).length, 1, 'a shot is in flight');
  run(rt, 70);
  assert.equal(rt.state.counts.shot_hit, 1); assert.equal(hp(rt), 96);
  const walled = compile(doc({ archetypes: [shooter], solid: Array.from({ length: 24 }, (_, y) => [8, y, 0]) }), { primitives: P }).rt;
  walled.spawn('foe', { at: [14, 10, 0] });
  // The wall also blocks sight; give the shooter its target anyway (it heard the player).
  walled.service('ai.brain').remember('e1', 'player');
  run(walled, 120);
  assert.equal(walled.state.counts.shot_hit ?? 0, 0);
  assert.ok(walled.state.counts.shot_blocked >= 1);
  // With gravity the shooter aims high and the arcing shot still lands.
  const lobber = foe([{ id: 'lob', range: 20, windup: 0.2, active: 0.05, recover: 3, damage: 4, shape: 'projectile', projectile: { speed: 10, gravity: 9.8 } }]);
  const lob = compile(doc({ archetypes: [lobber], gravity: 9.8 }), { primitives: P }).rt;
  lob.spawn('foe', { at: [12, 10, 0] });
  let apex = 10; for (let i = 0; i < 120; i++) { lob.step(); const s = Object.values(lob.state.entities).find(e => e.components.aiShot); if (s) apex = Math.max(apex, s.at[1]); }
  assert.ok(apex > 11, `arced upward (apex ${apex})`);
  assert.equal(lob.state.counts.shot_hit, 1, 'and landed on target');
});

test('bullet emitters: kit patterns, caps and difficulty', () => {
  const mem = {};
  assert.equal(volley('ring', 0, mem).length, 8);
  const spin = mem.spin; volley('ring', 0, mem); assert.notEqual(mem.spin, spin, 'rings rotate between volleys');
  assert.equal(volley('flower', 0, {}).length, 12);
  assert.equal(volley('aimed', 0, {}, { boss: true, phase: 2 }).length, 7, 'boss aimed fans grow with phase');
  assert.equal(volley('spread', 0, {}).length, 3);
  const turret = mode => foe([{ id: 'rings', range: 30, windup: 0, active: 3, recover: 1, damage: 1, emitter: { pattern: 'ring', rate: 2, speed: 6 } }]);
  const { rt } = compile(doc({ archetypes: [turret()], attacks: { bulletCap: 12 } }), { primitives: P });
  rt.spawn('foe', { at: [16, 12, 0] });
  let peak = 0;
  for (let i = 0; i < 120; i++) { rt.step(); peak = Math.max(peak, Object.values(rt.state.entities).filter(e => e.components.aiShot).length); }
  assert.equal(peak, 12, 'live bullets never exceed the cap');
  const speedOf = difficulty => { const { rt } = compile(doc({ archetypes: [turret()], attacks: { difficulty } }), { primitives: P }); rt.spawn('foe', { at: [16, 12, 0] }); run(rt, 3); return Math.hypot(...Object.values(rt.state.entities).find(e => e.components.aiShot).components.aiShot.vel); };
  assert.ok(Math.abs(speedOf('hard') / speedOf('normal') - 1.2) < 1e-3);
  const capped = compile(doc({ archetypes: [turret()], attacks: { capBy: { var: 'stage.mode' } } }), { primitives: P }).rt;
  capped.state.vars['stage.mode'] = 'asteroids'; capped.spawn('foe', { at: [16, 12, 0] });
  let p2 = 0; for (let i = 0; i < 90; i++) { capped.step(); p2 = Math.max(p2, Object.values(capped.state.entities).filter(e => e.components.aiShot).length); }
  assert.equal(p2, 16, 'per-mode cap (asteroids 16)');
});

test('lunges move the attacker during the active window; summons are capped; blasts edit cells and self-destruct', () => {
  const lunger = foe([{ id: 'lunge', range: 6, windup: 0.2, active: 0.5, recover: 1, damage: 2, move: 'lunge' }]);
  const { rt } = compile(doc({ archetypes: [lunger] }), { primitives: P });
  const f = rt.spawn('foe', { at: [7, 10, 0] });
  run(rt, 15); const x0 = f.at[0]; run(rt, 30);
  assert.ok(f.at[0] < x0 - 1, `lunged toward the player: ${x0} → ${f.at[0]}`);
  const caller = { id: 'caller', kind: 'boss', components: { ai: { brain: [{ do: 'sit' }] }, attacks: [{ id: 'call', windup: 0.1, active: 0.1, recover: 0.1, summon: 'foe', count: 3, shape: 'summon' }] } };
  const r2 = compile(doc({ archetypes: [caller, foe([])], attacks: { maxSummons: 4 } }), { primitives: P }).rt;
  r2.spawn('caller', { at: [20, 10, 0] }); run(r2, 120);
  assert.equal(Object.values(r2.state.entities).filter(e => e.components.summonedBy).length, 4);
  const boomer = foe([{ id: 'fuse', range: 3, windup: 0.3, active: 0.1, recover: 0, damage: 7, shape: 'blast', blastBlocks: 2, selfDestruct: true }]);
  const r3 = compile(doc({ archetypes: [boomer], solid: [[4, 11, 0], [4, 9, 0], [9, 9, 0]] }), { primitives: P }).rt;
  r3.spawn('foe', { at: [4, 10, 0] }); run(r3, 40);
  assert.equal(r3.space('w').getCell([4, 11, 0]), null, 'nearby cells cleared'); assert.equal(r3.space('w').getCell([9, 9, 0]), 'solid', 'far cells kept');
  assert.equal(r3.entity('e1'), undefined, 'exploded'); assert.equal(hp(r3), 93);
});

test('attacks replay deterministically through snapshot/restore', () => {
  const mix = foe([{ id: 'a', range: 8, windup: 0.2, active: 0.4, recover: 0.2, damage: 1, weight: 2, emitter: { pattern: 'spiral', rate: 3 } }, { id: 'b', range: 3, windup: 0.3, active: 0.2, recover: 0.3, damage: 2, weight: 1 }]);
  const make = () => { const { rt } = compile(doc({ archetypes: [mix] }), { primitives: P }); rt.spawn('foe', { at: [5, 10, 0] }); return rt; };
  const a = make(), b = make();
  run(a, 150); run(b, 150);
  assert.deepEqual(a.snapshot(), b.snapshot());
  const snap = a.snapshot(); run(a, 90); const end = a.snapshot(); a.restore(snap); run(a, 90);
  assert.deepEqual(a.snapshot(), end);
});

test('preflight rejects bad attack patterns with stable codes', () => {
  const { registry, logic } = catalogue([testSpace]);
  const bad = doc({ archetypes: [foe([{ id: 'x', shape: 'spaghetti', windup: -1 }, { id: 'x', summon: 'ghost', shape: 'summon' }, { range: 2, spped: 3 }, { id: 'e', emitter: { pattern: 'zigzag' } }, { id: 's', shape: 'summon' }])], attacks: { shapes: { goo: { kind: 'blob' } } } });
  const codes = preflight(bad, registry, logic).errors.map(e => e.code);
  for (const c of ['attack_shape_unknown', 'param_range', 'attack_duplicate', 'ref_unknown', 'param_missing', 'param_unknown', 'param_option', 'attack_summon_missing', 'attack_shape_kind']) assert.ok(codes.includes(c), c);
});

test('every gameplay.ai.attacks instance and attacks component in v2/games preflights without param errors', () => {
  const { registry, logic } = catalogue();
  for (const f of fs.readdirSync('v2/games')) {
    const d = JSON.parse(fs.readFileSync(`v2/games/${f}`, 'utf8'));
    const mine = (d.systems || []).map((s, i) => [s, `systems[${i}]`]).filter(([s]) => s.use === 'gameplay.ai.attacks').map(x => x[1]);
    const errs = preflight(d, registry, logic).errors.filter(e => mine.some(p => e.path?.startsWith(p)) || /components\.attacks\b/.test(e.path || ''));
    const ours = errs.filter(e => !['capability_missing', 'requires_unmet', 'service_missing', 'predicate_unknown'].includes(e.code));
    assert.deepEqual(ours, [], f);
  }
});
