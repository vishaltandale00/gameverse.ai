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
const versus = w => doc({ with: { size: [20, 10, 1] }, archetypes: [{ id: 'rival', components: { health: { max: 100 } } }], player: { archetype: 'hero', at: [5, 1, 0] },
  systems: [{ use: 'gameplay.combat.health' }, { use: 'gameplay.rounds', with: { fighters: ['player', 'rival'], spawns: [[5, 1, 0], [15, 1, 0]], onRoundStart: [{ do: 'heal', who: 'actor' }], ...w } }] });
const start = w => { const { rt } = compile(versus(w), { primitives: P }); rt.player().components.health = { max: 100 }; rt.spawn('rival', { id: 'cpu' }); rt.step(); return rt; };
const toFight = rt => { while (!rt.test({ round: 'fight' }) && rt.state.frame < 5000) rt.step(); };

test('rounds: intro, FIGHT call, KO, perfect, best of 3 and match result', () => {
  const rt = start({ onWin: [{ do: 'set_flag', flag: 'champ' }] });
  assert.equal(rt.state.counts.match_start, 1); assert.ok(rt.test({ round: 'intro' }));
  assert.equal(rt.state.vars['round.live'], 0);
  toFight(rt);
  assert.equal(rt.state.counts.fight, 1); assert.equal(rt.state.vars['round.live'], 1);
  assert.deepEqual(rt.entity('cpu').at, [15, 1, 0], 'placed at its spawn');
  rt.run([{ do: 'damage', who: 'cpu', amount: 100 }]); rt.step();
  assert.equal(rt.state.counts.ko, 1); assert.ok(rt.test({ round: 'ko' }));
  drive(rt, 120);
  assert.equal(rt.state.counts.perfect, 1, 'player untouched');
  assert.equal(rt.state.vars['round.wins.player'], 1);
  assert.ok(rt.state.vars.score >= 1000 + 5000 + 1000);
  toFight(rt);
  assert.equal(rt.state.vars.round, 2);
  assert.equal(rt.entity('cpu').components.health.hp, 100, 'onRoundStart healed');
  rt.run([{ do: 'damage', who: 'player', amount: 10 }, { do: 'damage', who: 'cpu', amount: 100 }]);
  drive(rt, 400);
  assert.ok(rt.test({ round: 'won' }));
  assert.equal(rt.state.flags.champ, true);
  assert.equal(rt.state.counts.perfect, 1, 'second win was not perfect');
});

test('rounds: with fewer than two fighters the match waits instead of throwing, and starts once an opponent exists', () => {
  // Default fighters is just ['player']: an outline that omits the opponent must not crash the world (regression: "reading 'player'").
  const { rt } = compile(doc({ player: { archetype: 'hero', at: [5, 1, 0] }, archetypes: [{ id: 'rival', components: { health: { max: 100 } } }], systems: [{ use: 'gameplay.combat.health' }, { use: 'gameplay.rounds' }] }), { primitives: P });
  for (let i = 0; i < 5; i++) rt.step();
  assert.ok(!rt.state.counts.match_start, 'no match yet');
  assert.ok(!rt.test({ round: true }), 'still waiting');
  assert.equal(rt.state.vars['round.wins.player'], undefined);
  const { rt: two } = compile(versus({ fighters: ['player', 'rival'] }), { primitives: P });
  for (let i = 0; i < 3; i++) two.step();
  assert.ok(!two.state.counts.match_start, 'the rival is declared as an archetype but not spawned');
  two.spawn('rival', { id: 'cpu' }); two.step();
  assert.equal(two.state.counts.match_start, 1, 'starts when the second fighter exists');
});

test('rounds: time over goes to health; double KO is a draw round; draws extend the match', () => {
  const rt = start({ roundSec: 2, introSec: 0.5, fightCallSec: 0.2 });
  toFight(rt);
  rt.run([{ do: 'damage', who: 'cpu', amount: 30 }]);
  drive(rt, 125);
  assert.equal(rt.state.counts.time_over, 1);
  assert.equal(rt.state.vars['round.wins.player'], 1, 'more health left wins on time');
  toFight(rt);
  rt.run([{ do: 'kill', who: 'cpu' }, { do: 'kill', who: 'player' }]); rt.step();
  assert.equal(rt.state.counts.double_ko, 1);
  drive(rt, 300);
  assert.equal(rt.state.vars.round, 3, 'draw round did not award a win');
  assert.equal(rt.state.vars['round.wins.cpu'], 0);
});

test('rounds: stock mode with respawns', () => {
  const rt = start({ stocks: 2, roundSec: 0, onRespawn: [{ do: 'heal', who: 'actor' }], respawnSec: 0.5 });
  toFight(rt);
  rt.run([{ do: 'kill', who: 'cpu' }]); rt.step();
  assert.equal(rt.state.counts.stock_lost, 1); assert.equal(rt.state.vars['round.stocks.cpu'], 1);
  drive(rt, 31);
  assert.equal(rt.state.counts.respawn, 1); assert.equal(rt.entity('cpu').components.health.hp, 100);
  assert.ok(rt.test({ round: 'fight' }), 'stock mode keeps fighting');
  rt.run([{ do: 'kill', who: 'cpu' }]); rt.step();
  assert.ok(rt.test({ round: 'won' }));
});

test('rounds: blast-zone KO via a zone predicate', () => {
  const d = versus({ stocks: 1, roundSec: 0, koWhen: { not: { zone: 'stage', who: 'self' } } });
  d.spaces[0].zones = [{ id: 'stage', rect: [2, 0, 18, 10] }];
  const { rt } = compile(d, { primitives: P }); rt.player().components.health = { max: 100 }; rt.spawn('rival', { id: 'cpu' }); rt.step();
  toFight(rt);
  rt.space('world').setPos(rt.entity('cpu'), [19, 1, 0], rt); rt.step();
  assert.ok(rt.test({ round: 'won' }), 'knocked out of the stage zone');
});

test('rounds: deterministic replay and preflight codes', () => {
  const play = () => { const rt = start({}); for (let i = 0; i < 6; i++) { toFight(rt); rt.run([{ do: 'damage', who: i % 2 ? 'cpu' : 'player', amount: 100 }]); drive(rt, 300); } return rt.snapshot(); };
  assert.deepEqual(play(), play());
  const registry = new Registry(P), logic = buildLogic(registry, Logic);
  const bad = versus({ timeOver: 'stocks', maxRounds: 1, bestOf: 5, fightCallSec: 5, introSec: 1, roundSec: -3 });
  bad.systems.push({ use: 'gameplay.rounds', with: { onWin: [{ do: 'set_flag', flag: 'x' }], koWhen: { round: 'sudden' } } });
  const codes = new Set(preflight(bad, registry, logic).errors.map(e => e.code));
  for (const c of ['rounds_time_over', 'rounds_max', 'rounds_timing', 'param_range', 'round_phase']) assert.ok(codes.has(c), c);
});
