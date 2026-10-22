import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile, testSpace } from '../v2/kernel/testing.js';
import { preflight } from '../v2/kernel/document.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import modes from '../v2/primitives/gameplay/modes.index.js';
import { stubHealth, doc, gameInstanceErrors } from '../v2/primitives/gameplay/modes-lib-testing.js';

const P = [...modes, testSpace, stubHealth];
const zones = [{ id: 'start', rect: [0, 0, 2, 2] }, { id: 'east', rect: [10, 0, 12, 2] }, { id: 'north', rect: [10, 10, 12, 12] }, { id: 'west', rect: [0, 10, 2, 12] }];
const raceDoc = (w = {}) => doc({ with: { size: [14, 14, 1] }, zones, archetypes: [{ id: 'rival', components: {} }, { id: 'ghosty', components: {} }], player: { archetype: 'hero', at: [1, 1, 0] },
  systems: [{ use: 'gameplay.race', with: { laps: 2, checkpoints: ['start', 'east', 'north', 'west'], racers: ['rival'], countdown: 1, ...w } }] });
// A square lap as waypoints; `speed` waypoints per step.
const LAP = []; for (let x = 1; x <= 11; x++) LAP.push([x, 1, 0]); for (let y = 2; y <= 11; y++) LAP.push([11, y, 0]); for (let x = 10; x >= 1; x--) LAP.push([x, 11, 0]); for (let y = 10; y >= 1; y--) LAP.push([1, y, 0]);
function race(rt, ticks, speeds) {
  const t = {};
  for (let i = 0; i < ticks && rt.state.status === 'playing'; i++) {
    for (const [id, every] of Object.entries(speeds)) { const e = rt.entity(id); if (!e) continue; if (rt.store('gameplay.race:race').state === 'running' && i % every === 0) { t[id] = (t[id] ?? 0) + 1; rt.space('world').setPos(e, LAP[t[id] % LAP.length], rt); } }
    rt.step();
  }
}

test('race: countdown, checkpoints, laps, positions, finish and win', () => {
  const { rt } = compile(raceDoc({ onWin: [{ do: 'set_flag', flag: 'champion' }] }), { primitives: P });
  rt.spawn('rival', { id: 'r1', at: [1, 1, 0] });
  rt.step();
  assert.ok(rt.test({ race: 'race', state: 'countdown' }));
  race(rt, 70, {});
  assert.ok(rt.test({ race: 'race', state: 'running' }));
  race(rt, 200, { player: 1, r1: 2 });
  assert.equal(rt.state.counts['checkpoint:east'] >= 2, true);
  assert.equal(rt.state.vars['race.position'], 1, 'faster racer leads');
  assert.ok(rt.test({ race: 'race', metric: 'position', lte: 1 }));
  race(rt, 400, { player: 1, r1: 2 });
  assert.equal(rt.state.counts['race_finished:player'], 1);
  assert.equal(rt.state.flags.champion, true);
  assert.equal(rt.state.counts.lap >= 2, true);
  assert.ok(rt.state.vars['race.best'] > 0);
  assert.equal(rt.state.counts['race_finished:r1'], 1, 'the rival finishes too');
  assert.ok(rt.test({ race: 'race', state: 'finished' }));
});

test('race: racers that appear during the countdown (a spawner listed after the race) race from the start', () => {
  const { rt } = compile(raceDoc(), { primitives: P });
  rt.step();
  assert.deepEqual(Object.keys(rt.store('gameplay.race:race').racers), ['player'], 'armed before the rival exists');
  rt.spawn('rival', { id: 'r1', at: [1, 1, 0] });
  race(rt, 70, {});
  assert.ok(rt.test({ race: 'race', state: 'running' }));
  assert.deepEqual(Object.keys(rt.store('gameplay.race:race').racers), ['player', 'r1'], 'on the grid at the start');
  race(rt, 600, { player: 2, r1: 1 });
  assert.equal(rt.state.counts['race_finished:r1'], 1);
  assert.equal(rt.store('gameplay.race:race').racers.r1.place, 1);
});

test('race: best-lap ghost is saved and replayed; wrong way warns', () => {
  const { rt } = compile(raceDoc({ ghostArchetype: 'ghosty', ghostEvery: 2, wrongWaySec: 0.2, countdown: 0, racers: [] }), { primitives: P });
  rt.step();
  race(rt, LAP.length + 2, { player: 1 });
  assert.equal(rt.state.counts.ghost_saved, 1);
  const g = rt.entity('ghost-race'); assert.ok(g, 'ghost spawned for lap 2');
  const before = g.at.slice(); race(rt, 10, { player: 1 }); assert.notDeepEqual(rt.entity('ghost-race').at, before, 'ghost follows the trace');
  // Back up: distance to the next checkpoint grows.
  const back = [[3, 1, 0], [2, 1, 0], [1, 1, 0]];
  const { rt: r2 } = compile(raceDoc({ countdown: 0, wrongWaySec: 0.05 }), { primitives: P });
  r2.step(); r2.space('world').setPos(r2.player(), [5, 1, 0], r2); r2.step();
  for (let i = 0; i < 6; i++) { r2.space('world').setPos(r2.player(), back[Math.min(i, 2)], r2); r2.step(); }
  assert.equal(r2.state.counts.wrong_way, 1);
});

test('race: arcade timer with checkpoint bonus runs out', () => {
  const { rt } = compile(raceDoc({ timeLimit: 1, checkpointBonus: 0.5, countdown: 0, racers: [], onLose: [{ do: 'set_flag', flag: 'lost' }] }), { primitives: P });
  rt.step(); race(rt, 200, { player: 4 });
  assert.equal(rt.state.counts.race_timeout, 1);
  assert.equal(rt.state.flags.lost, true);
  assert.ok(rt.state.counts['checkpoint:east'] >= 1, 'bonus extended the clock past the first checkpoint');
});

test('race: single-checkpoint circuits, start_race/reset_race and deterministic replay', () => {
  const d = raceDoc({ checkpoints: ['start'], laps: 2, autoStart: false, countdown: 0, racers: [] });
  const { rt } = compile(d, { primitives: P });
  rt.step(); assert.ok(rt.test({ race: 'race', state: 'idle' }));
  rt.run([{ do: 'start_race', race: 'race' }]); rt.step();
  race(rt, LAP.length * 2 + 4, { player: 1 });
  assert.equal(rt.state.counts.lap, 2);
  rt.run([{ do: 'reset_race' }]); rt.step(); assert.ok(rt.test({ race: 'race', state: 'idle' }));
  const play = () => { const { rt } = compile(raceDoc(), { primitives: P }); rt.spawn('rival', { id: 'r1', at: [1, 1, 0] }); race(rt, 300, { player: 1, r1: 3 }); return rt.snapshot(); };
  assert.deepEqual(play(), play());
});

test('race: preflight rejects bad configs with stable codes', () => {
  const registry = new Registry(P), logic = buildLogic(registry, Logic);
  const bad = raceDoc({ checkpoints: ['start', 'start', 'nowhere'], laps: 0 });
  bad.systems.push({ use: 'gameplay.race', with: { checkpoints: ['east'], includePlayer: false } }, { use: 'gameplay.race', with: {} });
  bad.plot = { endings: [] };
  bad.systems.push({ use: 'gameplay.race', with: { id: 'cup', checkpoints: ['east'], startWhen: { race: 'grand_prix', state: 'flying' } } });
  const codes = new Set(preflight(bad, registry, logic).errors.map(e => e.code));
  for (const c of ['ref_unknown', 'param_range', 'race_checkpoints', 'race_duplicate', 'race_racers', 'param_missing', 'race_state']) assert.ok(codes.has(c), c);
  assert.ok(preflight(raceDoc(), registry, logic).ok);
});

test('race: blockport instance has zero param errors and real checkpoint zones', () => {
  const d = JSON.parse(readFileSync(new URL('../v2/games/blockport.json', import.meta.url)));
  const found = gameInstanceErrors([['blockport.json', d]], modes).filter(f => f.use === 'gameplay.race');
  assert.equal(found.length, 1); assert.deepEqual(found[0].errors, []);
  const zonesIn = new Set(d.spaces.flatMap(s => (s.zones || []).map(z => z.id)));
  for (const z of d.systems.find(s => s.use === 'gameplay.race').with.checkpoints) assert.ok(zonesIn.has(z), z);
});
