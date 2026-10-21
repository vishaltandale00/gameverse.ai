import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, testSpace } from '../v2/kernel/testing.js';
import { preflight } from '../v2/kernel/document.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import modes from '../v2/primitives/gameplay/modes.index.js';
import { stubHealth, doc, drive } from '../v2/primitives/gameplay/modes-lib-testing.js';

const P = [...modes, testSpace, stubHealth];
const shoot = { id: 'shoot', range: 6, hit: { base: 70, optimal: 4, falloff: 5 }, crit: { chance: 0 }, onHit: [{ do: 'damage', who: 'target', amount: 4 }] };
const tactics = (w = {}, units = []) => {
  const d = doc({ with: { size: [12, 12, 1] }, archetypes: [
    { id: 'soldier', components: { health: { max: 8 }, turns: { side: 'player', aim: 10 } } },
    { id: 'alien', components: { health: { max: 6 }, turns: { side: 'enemy', defense: 5, initiative: 3 } } },
  ], player: { archetype: 'hero', at: [1, 1, 0] }, systems: [{ use: 'gameplay.turns', with: { sides: [{ id: 'player', control: 'player', members: ['player'] }, { id: 'enemy', control: 'ai' }], actions: [shoot], ...w } }] });
  d.content.archetypes[0].components = { health: { max: 10 } };
  return d;
};
const setup = (w, extra = rt => {}) => { const { rt } = compile(tactics(w), { primitives: P }); extra(rt); rt.step(); return rt; };
const svc = rt => rt.service('turns');

test('turns: side turns, AP, moving and shooting with hit chance; AI side answers', () => {
  const rt = setup({}, rt => rt.spawn('alien', { id: 'x1', at: [9, 1, 0] }));
  assert.ok(rt.test({ turn: 'player' }));
  assert.equal(rt.state.vars['turns.ap'], 2);
  assert.equal(svc(rt).legal('player').some(l => l.id === 'shoot'), false, 'x1 is 8 cells away, out of range');
  rt.step({ actions: { turn_move: [4, 1, 0] } });
  assert.deepEqual(rt.player().at, [4, 1, 0]);
  assert.equal(rt.state.vars['turns.ap'], 1, 'three cells cost one AP (movePerAp 4)');
  const l = svc(rt).legal('player').find(x => x.id === 'shoot');
  assert.equal(l.hit.x1, 70 - 5 - 5, 'base 70 - defense 5 - falloff 5 per cell past optimal 4');
  rt.step({ actions: { turn_act: { action: 'shoot', target: 'x1' } } });
  assert.equal((rt.state.counts.attack_hit ?? 0) + (rt.state.counts.attack_miss ?? 0), 1);
  assert.ok(rt.test({ turn: 'enemy' }), 'player AP spent: enemy turn');
  drive(rt, 10);
  assert.ok(rt.state.counts['turn_action:shoot'] >= 2, 'AI shot back');
  assert.ok(rt.test({ turn: 'player' }), 'back to the player');
  assert.equal(rt.state.vars['turns.round'], 2);
});

test('turns: overwatch fires on enemy movement in range', () => {
  const rt = setup({ ap: 2, hitChance: false }, rt => rt.spawn('alien', { id: 'x1', at: [10, 1, 0] }));
  rt.step({ actions: { turn_act: 'overwatch' } });
  assert.equal(rt.state.counts.overwatch_set, 1);
  drive(rt, 6);
  assert.equal(rt.state.counts.overwatch_shot, 1, 'alien walked into range and drew fire');
  assert.ok(rt.entity('x1').components.health.hp <= 2);
});

test('turns: permadeath, downed units and bleed-out; victory ends the battle', () => {
  const win = setup({ hitChance: false, onVictory: [{ do: 'set_flag', flag: 'won' }] }, rt => rt.spawn('alien', { id: 'x1', at: [4, 1, 0] }));
  win.step({ actions: { turn_act: { action: 'shoot', target: 'x1' } } });
  win.step({ actions: { turn_act: { action: 'shoot', target: 'x1' } } });
  assert.equal(win.state.counts['unit_fallen:alien'], 1);
  assert.equal(win.state.flags['fallen.x1'], true);
  assert.equal(win.state.counts.turns_over, 1);
  assert.equal(win.state.flags.won, true);
  assert.ok(!win.test({ turn: 'player' }));
  const bleed = setup({ hitChance: false, permadeath: false, bleedout: 2, sides: [{ id: 'player', control: 'player', members: ['player'] }, { id: 'enemy', control: 'ai', ai: 'pass' }] }, rt => { rt.spawn('alien', { id: 'x1', at: [4, 1, 0] }); rt.spawn('soldier', { id: 's2', at: [2, 2, 0] }); });
  bleed.run([{ do: 'damage', who: 's2', amount: 99 }]); bleed.step();
  assert.equal(bleed.state.counts.unit_downed, 1);
  bleed.run([{ do: 'heal', who: 's2', amount: 5 }]); bleed.step();
  assert.equal(bleed.state.counts.unit_revived, 1, 'downed units can be revived');
  bleed.run([{ do: 'damage', who: 's2', amount: 99 }]);
  for (let i = 0; i < 6; i++) { bleed.step({ actions: { end_turn: true } }); drive(bleed, 4); }
  assert.equal(bleed.state.counts.unit_fallen, 1, 'bled out after two rounds');
});

test('turns: initiative order with a seeded roll', () => {
  const d = tactics({ order: 'initiative', ap: 1 });
  d.content.archetypes.push({ id: 'fast', components: { health: { max: 5 }, turns: { side: 'enemy', initiative: 20 } } });
  const { rt } = compile(d, { primitives: P });
  rt.spawn('alien', { id: 'x1', at: [11, 11, 0] }); rt.spawn('fast', { id: 'f1', at: [11, 10, 0] });
  rt.player().components.turns = { side: 'player', initiative: 10 };
  rt.step();
  const starts = () => rt.state.events.filter(e => e.name === 'turn_start').map(e => e.who);
  assert.deepEqual(starts(), ['f1'], 'highest initiative first');
  rt.step(); rt.step();
  assert.ok(rt.test({ turn: 'player' }), 'then the player (10) before x1 (3)');
});

test('turns: simultaneous commit resolves by priority, then speed', () => {
  const acts = [{ id: 'tackle', range: 99, los: false, hit: { base: 100, max: 100 }, onHit: [{ do: 'damage', who: 'target', amount: 3 }] }, { id: 'quick', range: 99, los: false, priority: 1, hit: { base: 100, max: 100 }, onHit: [{ do: 'damage', who: 'target', amount: 1 }] }];
  const d = tactics({ order: 'simultaneous', actions: acts, ap: 1 });
  const { rt } = compile(d, { primitives: P });
  const foe = rt.spawn('alien', { id: 'x1', at: [8, 8, 0] }); foe.components.turns.speed = 50; foe.components.turns.actions = ['tackle'];
  rt.player().components.turns = { side: 'player', speed: 10 };
  rt.step();
  rt.step({ actions: { turn_act: { action: 'quick', target: 'x1' } } });
  const order = rt.state.events.filter(e => e.name === 'turn_action').map(e => `${e.who}:${e.action}`);
  assert.equal(order[0], 'player:quick', 'priority beats speed');
  assert.equal(order.length, 2);
  rt.step({ actions: { turn_act: { action: 'tackle', target: 'x1' } } });
  const o2 = rt.state.events.filter(e => e.name === 'turn_action').map(e => e.who);
  assert.deepEqual(o2, ['x1', 'player'], 'equal priority: faster unit first');
});

test('turns: phases run effects; manual phases wait for next_phase', () => {
  const rt = setup({ phases: [{ id: 'draw', do: [{ do: 'add_var', var: 'draws' }] }, { id: 'main', auto: false }, { id: 'end', do: [{ do: 'add_var', var: 'ends' }] }], actions: [{ ...shoot, phase: 'main' }] }, rt => rt.spawn('alien', { id: 'x1', at: [11, 11, 0] }));
  assert.equal(rt.state.vars.draws, 1);
  assert.equal(rt.state.counts['phase_start:main'], 1);
  rt.step(); assert.ok(rt.test({ turn: 'player' }), 'main waits');
  rt.step({ actions: { next_phase: true } });
  assert.equal(rt.state.vars.ends, 1);
  drive(rt, 3);
  assert.ok(rt.test({ turn: 'enemy' }) || rt.state.vars['turns.round'] === 2);
});

test('turns: solver options and service view', () => {
  const rt = setup({}, rt => rt.spawn('alien', { id: 'x1', at: [5, 1, 0] }));
  const opts = rt.availableOptions().map(o => o.label);
  assert.ok(opts.includes('player shoot x1'));
  assert.ok(opts.some(l => l.startsWith('player move')));
  assert.ok(opts.includes('end turn'));
  const v = svc(rt).view();
  assert.equal(v.side, 'player'); assert.equal(v.sides.length, 2); assert.ok(v.legal.length >= 2);
});

test('turns: deterministic replay and restore', () => {
  const play = () => { const rt = setup({}, rt => { rt.spawn('alien', { id: 'x1', at: [9, 3, 0] }); rt.spawn('alien', { id: 'x2', at: [10, 6, 0] }); }); drive(rt, 60, i => (i % 3 === 0 ? { actions: { turn_act: { action: 'shoot', target: i % 2 ? 'x1' : 'x2' } } } : i % 3 === 1 ? { actions: { turn_move: [3 + (i % 4), 2, 0] } } : { actions: { end_turn: true } })); return rt.snapshot(); };
  assert.deepEqual(play(), play());
});

test('turns: preflight rejects bad configs with stable codes', () => {
  const registry = new Registry(P), logic = buildLogic(registry, Logic);
  const bad = tactics({ order: 'chaos', sides: [{ id: 'a' }, { id: 'a' }], actions: [{ id: 'move' }, { id: 'zap', range: 1, minRange: 3 }, { id: 'zap2', phase: 'nope' }, { id: 'buff', target: 'self', hit: { base: 50 } }], overwatchAction: 'buff', phases: [{ id: 'x' }, { id: 'x' }] });
  const errors = preflight(bad, registry, logic).errors, codes = new Set(errors.map(e => e.code));
  for (const c of ['param_option', 'turns_action', 'turns_overwatch']) assert.ok(codes.has(c), c);
  // Sides, actions and phases are kinds the card defines: repeated ids are the kernel's id_duplicate, a reserved action id
  // param_reserved, an unknown phase ref_unknown (they were turns_sides / turns_action / turns_phase).
  const at = new Set(errors.map(e => `${e.code}@${e.path.replace(/^systems\[\d+\]\.with\./, '')}`));
  for (const c of ['id_duplicate@sides[1].id', 'id_duplicate@phases[1].id', 'param_reserved@actions[0].id', 'ref_unknown@actions[2].phase']) assert.ok(at.has(c), c);
  assert.ok(preflight(tactics(), registry, logic).ok);
});

test('turns: actionsPerTurn passes the turn after that many actions, with any unit of the side; the AI side picks its unit', () => {
  const rt = setup({ actionsPerTurn: 1, ap: 1, movePerAp: 1, hitChance: false, overwatch: false, actions: [{ id: 'capture', range: 1.5, los: false, onHit: [{ do: 'damage', who: 'target', amount: 99 }] }] }, rt => {
    rt.spawn('soldier', { id: 's2', at: [5, 1, 0] }); rt.spawn('alien', { id: 'x1', at: [9, 9, 0] }); rt.spawn('alien', { id: 'x2', at: [6, 3, 0] });
  });
  const labels = rt.availableOptions().map(o => o.label);
  assert.ok(labels.some(l => l.startsWith('player move')) && labels.some(l => l.startsWith('s2 move')), `every unit of the side is offered: ${labels}`);
  rt.step({ actions: { turn_move: { unit: 's2', to: [5, 2, 0] } } });
  assert.deepEqual(rt.entity('s2').at.slice(0, 2), [5, 2]);
  assert.ok(rt.test({ turn: 'enemy' }), 'one action, then the turn passes');
  drive(rt, 3);
  assert.equal(rt.state.counts['turn_action:capture'], 1, 'the AI side took its one action with the unit that could capture');
  assert.equal(rt.state.counts.unit_fallen, 1);
  assert.ok(rt.test({ turn: 'player' }));
});

test('turns: every move option is a move the unit can make (path cost within its AP, nothing in the way)', () => {
  const rt = setup({ ap: 1, movePerAp: 3 }, rt => { rt.spawn('soldier', { id: 's2', at: [2, 1, 0] }); rt.spawn('soldier', { id: 's3', at: [1, 2, 0] }); rt.spawn('alien', { id: 'x1', at: [11, 11, 0] }); });
  const snap = rt.snapshot(), moves = rt.availableOptions().filter(o => o.actions.turn_move);
  assert.ok(moves.length > 0);
  for (const o of moves) {
    rt.restore(snap); rt.step({ actions: o.actions });
    assert.equal(rt.state.counts.turn_invalid ?? 0, 0, `${o.label} was offered but rejected`);
  }
});
