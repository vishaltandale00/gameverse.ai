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
const ARCH = [
  { id: 'worker', components: { health: { max: 4 }, rts: { speed: 6, worker: true, carry: 5, gatherRate: 10, sight: 5 } } },
  { id: 'marine', components: { health: { max: 6 }, rts: { speed: 4, sight: 6, attack: { range: 3, cooldown: 0.5, effects: [{ do: 'damage', who: 'target', amount: 2 }] } } } },
  { id: 'base', components: { health: { max: 40 }, rts: { building: true, dropoff: true, supplyCap: 3, sight: 6, produces: [{ archetype: 'worker', cost: { minerals: 20 }, time: 1 }, { archetype: 'marine', cost: { minerals: 30 }, time: 1 }] } } },
  { id: 'crystal', components: { rts: { node: { resource: 'minerals', amount: 30 } } } },
];
const rtsDoc = w => doc({ with: { size: [30, 30, 1] }, archetypes: ARCH, player: null,
  systems: [{ use: 'gameplay.combat.health' }, { use: 'gameplay.rts', with: { factions: [{ id: 'blue', control: 'player', start: { minerals: 60 } }, { id: 'red', control: 'external', start: { minerals: 100 } }], ...w } }] });
const make = (w, f) => { const { rt } = compile(rtsDoc(w), { primitives: P }); f(rt); rt.step(); return rt; };
const sp = (rt, a, id, at, faction) => rt.spawn(a, { id, at, components: faction ? { rts: { ...ARCH.find(x => x.id === a).components.rts, faction } } : {} });

test('rts: workers gather, return to the dropoff and deposit until the node is depleted', () => {
  const rt = make({}, rt => { sp(rt, 'base', 'hq', [2, 2, 0], 'blue'); sp(rt, 'worker', 'w1', [3, 2, 0], 'blue'); sp(rt, 'crystal', 'c1', [9, 2, 0]); });
  rt.step({ actions: { select: ['w1'] } });
  assert.deepEqual(rt.service('rts').selection(), ['w1']);
  rt.step({ actions: { order: { kind: 'gather', node: 'c1' } } });
  drive(rt, 300);
  assert.ok(rt.state.counts.deposited >= 2, `deposits: ${rt.state.counts.deposited}`);
  assert.ok(rt.state.vars['rts.blue.minerals'] > 60);
  drive(rt, 600);
  assert.equal(rt.state.counts.node_depleted, 1);
  assert.equal(rt.state.vars['rts.blue.minerals'], 90, 'every mineral banked');
});

test('rts: production queues spend resources, respect supply and send units to the rally point', () => {
  const rt = make({ supply: true }, rt => { sp(rt, 'base', 'hq', [5, 5, 0], 'blue'); });
  rt.step({ actions: { rally: { building: 'hq', at: [10, 5, 0] } } });
  rt.step({ actions: { produce: { building: 'hq', archetype: 'marine' } } });
  assert.equal(rt.state.vars['rts.blue.minerals'], 30);
  rt.step({ actions: { produce: { building: 'hq', archetype: 'marine' } } });
  rt.step({ actions: { produce: { building: 'hq', archetype: 'marine' } } });
  assert.ok(rt.state.events.some(e => e.name === 'rts_invalid' && e.reason === 'resources'));
  drive(rt, 150);
  assert.equal(rt.state.counts['unit_produced:marine'], 2);
  const m = Object.values(rt.state.entities).find(e => e.archetype === 'marine');
  assert.ok(Math.abs(m.at[0] - 10) < 0.01, 'walked to the rally point');
  rt.service('rts').give('blue', 'minerals', 100);
  rt.step({ actions: { produce: { building: 'hq', archetype: 'marine' } } }); drive(rt, 70);
  rt.step({ actions: { produce: { building: 'hq', archetype: 'marine' } } });
  assert.ok(rt.state.events.some(e => e.name === 'rts_invalid' && e.reason === 'supply'), 'supply cap 3');
});

test('rts: attack orders, auto-acquire, fog of war spotting, defeat and victory', () => {
  const rt = make({ onVictory: [{ do: 'set_flag', flag: 'won' }] }, rt => { sp(rt, 'marine', 'm1', [2, 2, 0], 'blue'); sp(rt, 'marine', 'm2', [2, 4, 0], 'blue'); sp(rt, 'marine', 'x1', [20, 2, 0], 'red'); });
  assert.equal(rt.service('rts').visible('blue', rt.entity('x1').at), false, 'far enemy is hidden');
  rt.step({ actions: { select: { box: [[0, 0, 0], [5, 5, 0]] } } });
  assert.equal(rt.service('rts').selection().length, 2);
  rt.step({ actions: { order: { kind: 'attack_move', at: [20, 3, 0] } } });
  drive(rt, 400);
  assert.ok(rt.state.counts.spotted >= 1);
  assert.ok(rt.state.counts.unit_attack >= 3);
  assert.equal(rt.state.counts.faction_defeated, 1);
  assert.equal(rt.state.flags.won, true);
});

test('rts: the AI opponent gathers and builds an army', () => {
  const rt = make({ factions: [{ id: 'blue', control: 'player' }, { id: 'red', control: 'ai', start: { minerals: 60 } }], ai: { attackAt: 2, workers: 2 } }, rt => { sp(rt, 'base', 'rhq', [20, 20, 0], 'red'); sp(rt, 'worker', 'rw', [21, 20, 0], 'red'); sp(rt, 'crystal', 'c2', [24, 20, 0]); sp(rt, 'marine', 'bm', [2, 2, 0], 'blue'); });
  drive(rt, 900);
  assert.ok(rt.state.counts.deposited >= 1, 'AI workers gather');
  assert.ok(rt.state.counts['unit_produced:worker'] >= 1);
  assert.ok((rt.state.counts['unit_produced:marine'] ?? 0) >= 1);
});

test('rts: deterministic replay and preflight codes', () => {
  const play = () => { const rt = make({ factions: [{ id: 'blue', control: 'ai', start: { minerals: 80 } }, { id: 'red', control: 'ai', start: { minerals: 80 } }], ai: { attackAt: 1, workers: 1 } }, rt => { sp(rt, 'base', 'a', [3, 3, 0], 'blue'); sp(rt, 'base', 'b', [25, 25, 0], 'red'); sp(rt, 'crystal', 'c', [14, 14, 0]); }); drive(rt, 240); return rt.snapshot(); };
  assert.deepEqual(play(), play());
  const registry = new Registry(P), logic = buildLogic(registry, Logic);
  const bad = rtsDoc({ factions: [{ id: 'blue', control: 'boss', start: { gold: 3 } }] });
  bad.content.archetypes.push({ id: 'odd', components: { rts: { faction: 'green', produces: [{ archetype: 'ghost', cost: { gas: 1 } }], node: { resource: 'wood' }, attack: { range: 0 } } } });
  const r = preflight(bad, registry, logic), codes = new Set(r.errors.map(e => e.code));
  for (const c of ['param_option', 'rts_resource', 'rts_faction']) assert.ok(codes.has(c), c);
  // The rts component's references and ranges are its declared shape (preflight's section shapes): an unknown produced
  // archetype is ref_unknown, an attack without range > 0 param_range (was rts_unit).
  const at = `content.archetypes[${bad.content.archetypes.length - 1}].components.rts`, shaped = new Set([...r.errors, ...r.warnings].map(e => `${e.code}@${e.path}`));
  for (const c of [`ref_unknown@${at}.produces[0].archetype`, `param_range@${at}.attack.range`]) assert.ok(shaped.has(c), c);
});

test('rts: progress counts what the player paid for in production, armed units above others', () => {
  const rt = make({}, rt => { sp(rt, 'base', 'hq', [5, 5, 0], 'blue'); });
  const rts = P.find(p => p.id === 'gameplay.rts'), cfg = rtsDoc({}).systems[1].with;
  const config = { ...cfg, factions: cfg.factions.map(f => ({ control: 'ai', start: {}, ...f })) };
  const before = rts.progress(rt, config);
  rt.step({ actions: { produce: { building: 'hq', archetype: 'marine' } } });
  const queued = rts.progress(rt, config);
  assert.ok(Math.abs(queued - before - (1 - 0.03)) < 1e-9, `a queued marine counts 1 less the 30 minerals banked (${before} -> ${queued})`);
  drive(rt, 70);
  assert.equal(rt.state.counts.unit_produced, 1);
  assert.ok(Math.abs(rts.progress(rt, config) - queued) < 1e-9, 'trained, it counts the same');
});
