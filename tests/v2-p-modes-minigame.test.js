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
const mg = games => doc({ with: { size: [10, 10, 1] }, archetypes: [{ id: 'fish', components: {} }], player: { archetype: 'hero', at: [1, 1, 0] },
  extraSpaces: [{ id: 'arena', use: 'engine.space.test', with: { size: [6, 6, 1] }, zones: [{ id: 'ring', rect: [2, 2, 4, 4] }] }],
  systems: [{ use: 'gameplay.minigame', with: { games } }] });
const start = (games, id) => { const { rt } = compile(mg(games), { primitives: P }); rt.spawn('fish', { id: 'f1', at: [5, 5, 0] }); rt.step(); rt.run([{ do: 'start_minigame', game: id }]); rt.step(); return rt; };

test('minigame timing: presses in the sweet spot win; the world stays frozen', () => {
  const rt = start([{ id: 'fishing', kind: 'timing', timing: { speed: 1, width: 0.2, hits: 2, misses: 2 }, onWin: [{ do: 'set_flag', flag: 'caught' }] }], 'fishing');
  assert.ok(rt.test({ minigame: 'fishing', state: 'active' }));
  assert.equal(rt.state.flags.paused, true); assert.equal(rt.service('pause').paused(), true);
  rt.entity('f1').at = [9, 9, 0]; rt.step();
  assert.deepEqual(rt.entity('f1').at, [5, 5, 0], 'frozen entity held in place');
  rt.step({ actions: { mg_press: true } });
  assert.equal(rt.state.counts.minigame_miss, 1, 'cursor starts at 0, far from the spot');
  for (let i = 0; i < 400 && rt.test({ minigame: 'fishing', state: 'active' }); i++) {
    const c = rt.state.vars['minigame.cursor'], next = c + (1 / 30) * (rt.store('gameplay.minigame').active.dir);
    rt.step(Math.abs(next - rt.state.vars['minigame.spot']) < 0.05 ? { actions: { mg_press: true } } : {});
  }
  assert.ok(rt.test({ minigame: 'fishing', state: 'won' }));
  assert.equal(rt.state.flags.caught, true); assert.equal(rt.state.flags.paused, undefined);
  rt.entity('f1').at = [9, 9, 0]; rt.step(); assert.deepEqual(rt.entity('f1').at, [9, 9, 0], 'thawed after the minigame');
});

test('minigame sequence: correct keys win, a wrong key loses, the per-key clock runs out', () => {
  const games = [{ id: 'hack', kind: 'sequence', sequence: { length: 4, verbs: ['up', 'down', 'left'], timePerKey: 1 } }];
  const rt = start(games, 'hack');
  const keys = rt.store('gameplay.minigame').active.keys;
  for (const k of keys) rt.step({ actions: { mg_input: k } });
  assert.ok(rt.test({ minigame: 'hack', state: 'won' }));
  const r2 = start(games, 'hack'); const k0 = r2.store('gameplay.minigame').active.keys[0];
  r2.step({ actions: { mg_input: ['up', 'down', 'left'].find(k => k !== k0) } });
  assert.ok(r2.test({ minigame: 'hack', state: 'lost' }));
  const r3 = start(games, 'hack'); drive(r3, 62);
  assert.ok(r3.test({ minigame: 'hack', state: 'lost' }), 'too slow');
  assert.deepEqual(r3.availableOptions().map(o => o.label), [], 'no options once it ended');
});

test('minigame mash and custom sub-modes in their own space return the player', () => {
  const rt = start([{ id: 'struggle', kind: 'mash', mash: { target: 10, decay: 40, perPress: 1 } }], 'struggle');
  drive(rt, 30, i => (i % 2 ? { actions: { mg_press: true } } : {}));
  assert.ok(rt.test({ minigame: 'struggle', state: 'active' }), 'every other frame loses to the decay (40/s)');
  drive(rt, 40, { actions: { mg_press: true } });
  assert.ok(rt.test({ minigame: 'struggle', state: 'won' }), 'mashing every frame fills it');
  const battle = start([{ id: 'duel', space: 'arena', zone: 'ring', win: { flag: 'beaten' }, timeSec: 5, onLose: [{ do: 'set_flag', flag: 'fled' }] }], 'duel');
  assert.equal(battle.player().space, 'arena'); assert.ok(battle.test({ zone: 'ring' }));
  battle.state.flags.beaten = true; battle.step();
  assert.ok(battle.test({ minigame: 'duel', state: 'won' }));
  assert.equal(battle.player().space, 'world'); assert.deepEqual(battle.player().at, [1, 1, 0]);
  const timeout = start([{ id: 'duel', space: 'arena', win: { flag: 'never' }, timeSec: 1, onLose: [{ do: 'set_flag', flag: 'fled' }] }], 'duel');
  drive(timeout, 61); assert.equal(timeout.state.flags.fled, true);
});

test('minigame: deterministic replay and preflight codes', () => {
  const play = () => { const rt = start([{ id: 'pick', kind: 'timing', timing: { drift: 0.4, hits: 5, misses: 9, accel: 0.2 } }], 'pick'); drive(rt, 300, i => (i % 7 === 0 ? { actions: { mg_press: true } } : {})); return rt.snapshot(); };
  assert.deepEqual(play(), play());
  const registry = new Registry(P), logic = buildLogic(registry, Logic);
  const bad = mg([{ id: 'a', kind: 'custom' }, { id: 'a', kind: 'quiz', zone: 'ring' }]);
  bad.systems.push({ use: 'gameplay.stage.sequence', with: { stages: [{ id: 's', clear: { minigame: 'nope', state: 'done' } }] } });
  const codes = new Set(preflight(bad, registry, logic).errors.map(e => e.code));
  // Game ids are the kind 'minigame': a repeated id is the kernel's id_duplicate (was minigame_duplicate).
  for (const c of ['minigame_kind', 'id_duplicate', 'param_option', 'minigame_place', 'ref_unknown', 'minigame_state']) assert.ok(codes.has(c), c);
});
