import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compile, run, testSpace } from '../v2/kernel/testing.js';
import { catalogue } from '../v2/primitives/index.js';
import { preflight } from '../v2/kernel/document.js';
import AI from '../v2/primitives/gameplay/ai.index.js';
import { xpToNext } from '../v2/primitives/gameplay/progression-level.js';

const P = [...AI, testSpace];
const doc = (systems, extra = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'prog', title: 'Progression', seed: 1,
  spaces: [{ id: 'w', use: 'engine.space.test', with: { size: [8, 8, 1] } }],
  systems, content: { archetypes: [{ id: 'hero', components: {} }, { id: 'pal', components: { party: true, level: 2 } }, { id: 'slime', kind: 'enemy', components: { level: 3 } }] },
  player: { archetype: 'hero' }, ...extra,
});
const LEVEL = { use: 'gameplay.progression.level', with: {
  curve: { base: 100, growth: 1.5 }, maxLevel: 5, pointsPerLevel: 2,
  stats: [{ id: 'might', base: 10, perPoint: 3, perLevel: 1 }],
  xpSources: [{ event: 'defeated', xp: 20, scaleBy: 'level' }, { event: 'block_mined:*', xp: 1 }, { event: 'quest_complete', xp: 50, to: 'share' }],
  perEntity: true, onLevel: [{ level: 3, do: [{ do: 'set_flag', flag: 'veteran' }] }],
} };

test('level: curve, XP from events (wildcards, level scaling, actor filter, party share), points, stats, level-up effects', () => {
  assert.equal(xpToNext({ kind: 'exp', base: 100, growth: 1.5 }, 3), 225);
  assert.equal(xpToNext({ kind: 'linear', base: 100, growth: 50 }, 3), 200);
  const { rt } = compile(doc([LEVEL]), { primitives: P });
  rt.step();
  assert.equal(rt.state.vars.level, 1); assert.equal(rt.state.vars['xp.next'], 100);
  const slime = rt.spawn('slime', { at: [3, 3, 0] });
  rt.emit('defeated', { who: slime.id, by: 'player' }); // 20 × level 3
  rt.emit('defeated', { who: slime.id, by: slime.id });   // an NPC kill: no XP
  for (let i = 0; i < 40; i++) rt.emitTyped('block_mined', 'stone', { who: 'player' });
  assert.equal(rt.state.vars.level, 2); assert.equal(rt.state.vars.xp, 0);
  assert.equal(rt.state.vars.points, 2);
  rt.step({ actions: { allocate: 'might' } });
  assert.equal(rt.state.vars['stat.might'], 10 + 3 + 1);
  assert.equal(rt.state.vars.points, 1);
  rt.run([{ do: 'give_xp', amount: 150 }]);
  assert.equal(rt.state.vars.level, 3); assert.equal(rt.state.flags.veteran, true);
  rt.run([{ do: 'give_xp', amount: 99999 }]);
  assert.equal(rt.state.vars.level, 5, 'capped'); assert.equal(rt.state.vars['xp.next'], 0);
  // Party members track their own progress.
  const pal = rt.spawn('pal', { at: [1, 1, 0] });
  rt.emit('quest_complete', {});
  assert.ok(rt.test({ level: pal.id, eq: 2 }));
  rt.run([{ do: 'give_xp', who: pal.id, amount: 500 }]);
  assert.ok(rt.test({ level: pal.id, gte: 4 })); assert.equal(pal.components.level, rt.service('progression').level(pal.id));
});

test('abilities: start set, requirements, unlock/lock effects, verbs through the service and predicates', () => {
  const ABIL = { use: 'gameplay.progression.abilities', with: { start: ['lamp'], baseVerbs: ['jump'], abilities: [
    { id: 'lamp', grants: ['light'] }, { id: 'wings', grants: ['doubleJump'] },
    { id: 'flare', grants: ['reveal'], requires: { flag: 'wick' }, onUnlock: [{ do: 'set_flag', flag: 'bright' }] },
  ] } };
  const { rt } = compile(doc([ABIL]), { primitives: P });
  const ab = rt.service('abilities');
  assert.ok(rt.test({ ability: 'lamp' })); assert.equal(rt.state.vars['ability.lamp'], 1);
  assert.deepEqual(ab.verbs('player'), ['jump', 'light']);
  rt.run([{ do: 'unlock_ability', ability: 'flare' }]);
  assert.equal(rt.state.counts.ability_blocked, 1); assert.ok(!rt.test({ grants: 'reveal' }));
  rt.state.flags.wick = true; rt.run([{ do: 'unlock_ability', ability: 'flare' }]);
  assert.ok(rt.test({ grants: 'reveal' })); assert.equal(rt.state.flags.bright, true); assert.equal(rt.state.counts['ability_unlocked:flare'], 1);
  rt.run([{ do: 'unlock_ability', ability: 'wings' }, { do: 'lock_ability', ability: 'lamp' }]);
  assert.ok(ab.grants('player', 'doubleJump')); assert.ok(!ab.grants('player', 'light'));
  const snap = rt.snapshot(); rt.run([{ do: 'lock_ability', ability: 'wings' }]); rt.restore(snap);
  assert.ok(ab.grants('player', 'doubleJump'), 'ability state survives restore');
});

test('tree: costs, prerequisites, ranks, var mods, use-based unlocks, respec', () => {
  const TREE = { use: 'gameplay.progression.tree', with: { useBased: true, nodes: [
    { id: 'blade', cost: 1, mods: { 'stat.melee': 0.1 }, ranks: 2 },
    { id: 'parry', cost: 2, requires: ['blade'], mods: { 'stat.parry': 60 } },
    { id: 'miner', cost: 3, mods: { 'stat.ore': 0.25 }, use: { event: 'block_mined:*', count: 3 } },
  ] } };
  const { rt } = compile(doc([LEVEL, TREE]), { primitives: P });
  rt.step();
  rt.run([{ do: 'unlock_perk', perk: 'blade' }]);
  assert.equal(rt.state.counts.perk_blocked, 1, 'no points yet');
  rt.run([{ do: 'give_xp', amount: 100 }]); // level 2: 2 points
  rt.step({ actions: { unlock_perk: 'parry' } });
  assert.ok(!rt.test({ perk: 'parry' }), 'needs blade first');
  rt.step({ actions: { unlock_perk: 'blade' } }); rt.step({ actions: { unlock_perk: 'blade' } });
  assert.ok(rt.test({ perk: 'blade', rank: 2 })); assert.equal(rt.state.vars['stat.melee'], 0.2); assert.equal(rt.state.vars.points, 0);
  for (let i = 0; i < 3; i++) rt.emitTyped('block_mined', 'iron', {});
  assert.ok(rt.test({ perk: 'miner' }), 'use-based unlock is free'); assert.equal(rt.state.vars['stat.ore'], 0.25);
  rt.run([{ do: 'reset_perks' }]);
  assert.equal(rt.state.vars['stat.melee'], 0); assert.equal(rt.state.vars.points, 2, 'refunded');
  assert.ok(!rt.test({ perk: 'blade' }));
});

test('progression replays deterministically', () => {
  const make = () => { const { rt } = compile(doc([LEVEL]), { primitives: P }); return rt; };
  const a = make(), b = make();
  for (const rt of [a, b]) { rt.step(); for (let i = 0; i < 250; i++) { rt.emitTyped('block_mined', 'stone', {}); rt.step(i % 7 === 0 ? { actions: { allocate: 'might' } } : {}); } }
  assert.deepEqual(a.snapshot(), b.snapshot());
});

test('preflight rejects bad progression configs with stable codes', () => {
  const { registry, logic } = catalogue([testSpace]);
  const bad = doc([
    { use: 'gameplay.progression.level', with: { curve: { kind: 'table' }, maxLevel: 3, start: 9, stats: [{ id: 'a' }, { id: 'a' }], onLevel: [{ do: [] }] } },
    { use: 'gameplay.progression.abilities', with: { start: ['nope'], abilities: [{ id: 'x' }, { id: 'x' }] } },
    { use: 'gameplay.progression.tree', with: { useBased: true, nodes: [{ id: 'a', requires: ['b'] }, { id: 'b', requires: ['a'] }, { id: 'c', requires: ['zz'] }] } },
  ]);
  const codes = preflight(bad, registry, logic).errors.map(e => e.code);
  // Stats, abilities and perks are kinds the cards define: repeated ids are the kernel's id_duplicate (were stat_duplicate,
  // ability_duplicate); start above maxLevel has its own code (level_start, was param_range).
  for (const c of ['level_curve_table', 'level_start', 'id_duplicate', 'level_trigger', 'ref_unknown', 'perk_cycle', 'perk_use_missing']) assert.ok(codes.includes(c), c);
});

test('every progression instance in v2/games preflights without param errors', () => {
  const { registry, logic } = catalogue();
  for (const f of fs.readdirSync('v2/games')) {
    const d = JSON.parse(fs.readFileSync(`v2/games/${f}`, 'utf8'));
    const mine = (d.systems || []).map((s, i) => [s, `systems[${i}]`]).filter(([s]) => s.use?.startsWith('gameplay.progression.')).map(x => x[1]);
    const errs = preflight(d, registry, logic).errors.filter(e => mine.some(p => e.path === p || e.path?.startsWith(p + '.')));
    assert.deepEqual(errs.filter(e => !['capability_missing', 'requires_unmet', 'service_missing'].includes(e.code)), [], f);
  }
});
