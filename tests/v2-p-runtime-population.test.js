// engine.spawner and engine.portal over the reference test space (and the graph space for cross-space travel).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile, run, testSpace } from '../v2/kernel/testing.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import { preflight } from '../v2/kernel/document.js';
import { checkFields } from '../v2/kernel/params.js';
import runtime from '../v2/primitives/engine/runtime.index.js';
import spaceGraph from '../v2/primitives/engine/space-graph.js';
import inventory from '../v2/primitives/gameplay/inventory.js';

const PRIMS = [testSpace, spaceGraph, inventory, ...runtime];
const doc = (systems, { archetypes = [], spaces = [], items = [], player = { archetype: 'hero', at: [1, 1, 0] } } = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'rt-pop', title: 'Runtime population', seed: 9,
  spaces: [{ id: 'w', use: 'engine.space.test', with: { size: [64, 32, 1] }, zones: [{ id: 'yard', rect: [0, 0, 16, 16] }, { id: 'field', rect: [16, 0, 64, 32] }] }, ...spaces],
  content: { archetypes: [{ id: 'hero', components: {} }, { id: 'slime', components: {} }, { id: 'ghost', components: {} }, ...archetypes], items },
  player, systems,
});
const make = (systems, opts) => compile(doc(systems, opts), { primitives: PRIMS });
const codes = d => { const r = new Registry(PRIMS); return preflight(d, r, buildLogic(r, Logic)).errors.map(e => e.code); };
const of = (rt, archetype) => Object.values(rt.state.entities).filter(e => e.archetype === archetype);

test('engine.spawner: keeps a rolled population in its zone, respects caps and respawns kills after a delay', () => {
  const { rt } = make([{ use: 'engine.spawner', with: { intervalSec: 0, rules: [{ id: 'slimes', archetype: 'slime', zone: 'yard', count: [4, 6], respawnSec: 1, groupSize: [2, 2], spread: 1 }, { id: 'far', archetype: 'slime', zone: 'field', count: [3, 3] }] } }]);
  run(rt, 2);
  const n = of(rt, 'slime').length;
  assert.ok(n >= 4 && n <= 6, `rolled ${n}`);
  assert.equal(rt.state.vars['population.far'], 0, 'zone activation: the player is not in the field');
  for (const e of of(rt, 'slime')) assert.ok(rt.test({ zone: 'yard', who: e.id }), 'spawned inside the zone');
  assert.equal(rt.state.vars.population, n);
  rt.despawn(of(rt, 'slime')[0].id); run(rt, 2);
  assert.equal(of(rt, 'slime').length, n - 1, 'cooling down');
  run(rt, 60);
  assert.equal(of(rt, 'slime').length, n, 'respawned');
  assert.ok(rt.state.counts['spawned:slimes'] >= n + 1);
  rt.space('w').setPos(rt.player(), [20, 5, 0], rt); run(rt, 2);
  assert.equal(rt.state.vars['population.far'], 3);
});

test('engine.spawner: predicates, respawnSec 0, distance culling, telegraphs, unique and group caps', () => {
  const { rt } = make([{ use: 'engine.spawner', with: { intervalSec: 0, groups: [{ id: 'mobs', maxAlive: 3 }], rules: [
    { id: 'night', archetype: 'slime', activation: 'always', at: [5, 5, 0], spread: 2, count: [5, 5], when: { flag: 'night' }, cullWhenInactive: true, group: 'mobs' },
    { id: 'boss', archetype: 'ghost', activation: 'always', at: [30, 10, 0], count: [1, 1], unique: true, respawnSec: 0, telegraph: 0.5, despawnDist: 100 },
  ] } }]);
  run(rt, 2);
  assert.equal(of(rt, 'slime').length, 0);
  assert.equal(rt.state.counts['spawn_telegraph:boss'], 1);
  assert.equal(rt.entity('boss'), undefined, 'telegraphed, not yet there');
  rt.state.flags.night = true; run(rt, 30);
  assert.equal(of(rt, 'slime').length, 3, 'group cap');
  assert.ok(rt.entity('boss'), 'unique entity id = rule id');
  rt.despawn('boss'); run(rt, 300);
  assert.equal(rt.entity('boss'), undefined, 'respawnSec 0 never refills');
  delete rt.state.flags.night; run(rt, 2);
  assert.equal(of(rt, 'slime').length, 0, 'culled when inactive');
  assert.ok(rt.state.counts.culled >= 3);
  rt.run([{ do: 'reset_spawner', rule: 'boss' }]); run(rt, 40);
  assert.ok(rt.entity('boss'), 'reset refills');
});

test('engine.spawner: release queue by counters, global counter after a death, idle timer and rehold', () => {
  // Arcade house: 4 held ghosts; ghost 0 leaves at once, then 1 needs 0 pellets, 2 needs 3, 3 needs 5.
  const release = { counter: 'pellet', limits: [0, 0, 3, 5], globalOn: 'died', globalLimits: [0, 1, 2, 3], idleSec: 2 };
  const { rt } = make([{ use: 'engine.spawner', with: { rules: [{ id: 'house', archetype: 'ghost', activation: 'always', at: [8, 8, 0], count: [4, 4], respawnSec: 0, release }] } }]);
  run(rt, 1);
  const ghosts = rt.service('spawner').alive('house');
  assert.equal(ghosts.length, 4);
  run(rt, 2);
  assert.equal(rt.service('spawner').held('house').length, 2, 'limits 0 release immediately');
  for (let i = 0; i < 3; i++) { rt.emit('pellet'); run(rt, 1); }
  assert.equal(rt.service('spawner').held('house').length, 1);
  assert.ok(!rt.test({ held: ghosts[2] }));
  run(rt, 125);
  assert.equal(rt.service('spawner').held('house').length, 0, 'idle timer released the last one');
  assert.equal(rt.state.counts['released:house'], 4);
  // Death: everyone back in the house, global counter mode.
  for (const id of ghosts) rt.space('w').setPos(rt.entity(id), [20, 20, 0], rt);
  rt.run([{ do: 'rehold', rule: 'house', global: true }]);
  assert.deepEqual(rt.entity(ghosts[3]).at, [8, 8, 0], 'returned home');
  run(rt, 1);
  assert.equal(rt.service('spawner').held('house').length, 3, 'global limit 0 for the first');
  rt.emit('pellet'); run(rt, 1);
  assert.equal(rt.service('spawner').held('house').length, 2);
});

test('engine.spawner: spawn/despawn effects place through zones, near targets and graph spaces', () => {
  const graph = { id: 'g', use: 'engine.space.graph', zones: [{ id: 'hall', exits: [{ to: 'attic' }] }, { id: 'attic', exits: [] }] };
  const { rt } = make([{ use: 'engine.spawner' }], { spaces: [graph] });
  rt.run([{ do: 'spawn', archetype: 'slime', zone: 'field', count: 3 }, { do: 'spawn', archetype: 'ghost', near: 'player', spread: 2, id: 'buddy' }, { do: 'spawn', archetype: 'ghost', zone: 'attic' }]);
  assert.equal(of(rt, 'slime').length, 3);
  for (const e of of(rt, 'slime')) assert.ok(rt.test({ zone: 'field', who: e.id }));
  assert.ok(rt.space('w').distance(rt.entity('buddy').at, rt.player().at) <= 2.01);
  const ghost = of(rt, 'ghost').find(e => e.space === 'g');
  assert.equal(ghost.at, 'attic');
  rt.run([{ do: 'despawn', archetype: 'slime', zone: 'field' }, { do: 'despawn', who: 'buddy' }]);
  assert.equal(of(rt, 'slime').length, 0);
  assert.equal(rt.entity('buddy'), undefined);
});

test('engine.portal: gates, keys, two-way, single use, touch, locks and transit delay', () => {
  const gate = { id: 'gameplay.testgate', card: { intent: 'gate predicate stand-in for plot.gate', provides: {}, ambient: true }, logic(l) { l.predicate('gate', { test: (p, rt) => Boolean(rt.state.flags[`gate.${p.gate}`]) }); } };
  const portals = [
    { id: 'door', from: { at: [4, 4, 0], size: [1, 1, 1] }, to: { zone: 'field', at: [20, 4, 0] }, gate: 'cellar', oneWay: false },
    { id: 'vault', from: { at: [6, 6, 0], r: 1 }, to: { at: [40, 20, 0] }, key: 'vault_key', consumeKey: true, once: true },
    { id: 'chute', from: { at: [10, 10, 0], size: [1, 1, 1] }, to: { at: [50, 2, 0] }, trigger: 'touch', transition: 'fade', do: [{ do: 'add_var', var: 'slid' }] },
  ];
  const d = doc([{ use: 'gameplay.inventory' }, { use: 'engine.portal', with: { portals } }], { items: [{ id: 'vault_key', name: 'Vault key' }] });
  const { rt } = compile(d, { primitives: [...PRIMS, gate] });
  const p = rt.player(), api = rt.space('w');
  api.setPos(p, [4, 4, 0], rt); rt.step({ actions: { use_portal: true } });
  assert.deepEqual(p.at, [4, 4, 0]);
  assert.equal(rt.state.events.find(e => e.name === 'blocked').reason, 'gate');
  rt.state.flags['gate.cellar'] = true;
  rt.step({ actions: { use_portal: 'door' } });
  assert.deepEqual(p.at, [20, 4, 0]);
  assert.equal(rt.state.counts['portal_used:door'], 1);
  run(rt, 40); rt.step({ actions: { use_portal: true } });
  assert.deepEqual(p.at, [4, 4, 0], 'two-way: back through');
  run(rt, 40);
  api.setPos(p, [6, 6, 0], rt); rt.step({ actions: { use_portal: true } });
  assert.equal(rt.state.events.find(e => e.name === 'blocked').reason, 'key');
  rt.run([{ do: 'give_item', item: 'vault_key' }]);
  assert.ok(rt.availableOptions().some(o => o.label === 'use portal vault'));
  rt.step({ actions: { use_portal: true } });
  assert.deepEqual(p.at, [40, 20, 0]);
  assert.ok(!rt.test({ item: 'vault_key' }), 'key consumed');
  assert.ok(!rt.service('portals').usable('vault', p).ok, 'single use');
  run(rt, 40);
  api.setPos(p, [10, 10, 0], rt); run(rt, 1);
  assert.equal(rt.state.counts.portal_start, 4);
  assert.deepEqual(p.at, [10, 10, 0], 'in transit');
  run(rt, 31);
  assert.deepEqual(p.at, [50, 2, 0]);
  assert.equal(rt.state.vars.slid, 1);
  rt.run([{ do: 'lock_portal', portal: 'door' }]);
  assert.equal(rt.service('portals').usable('door', p).reason, 'locked');
});

test('engine.portal: travels across spaces with moveToSpace and offers walk-and-use options', () => {
  const graph = { id: 'inside', use: 'engine.space.graph', zones: [{ id: 'lobby', exits: [] }] };
  const portals = [{ id: 'enter', from: { space: 'w', at: [12, 3, 0], r: 1 }, to: { space: 'inside', zone: 'lobby' } }, { id: 'leave', from: { space: 'inside', zone: 'lobby' }, to: { space: 'w', at: [12, 4, 0] } }];
  const { rt } = make([{ use: 'engine.portal', with: { portals } }], { spaces: [graph] });
  run(rt, 1);
  const walk = rt.availableOptions().find(o => o.label === 'travel to portal enter');
  assert.ok(walk, 'macro option where the space can path');
  walk.apply(rt);
  assert.equal(rt.player().space, 'inside');
  assert.equal(rt.player().at, 'lobby');
  assert.equal(rt.state.counts.space_changed, 1);
  run(rt, 40); rt.step({ actions: { use_portal: 'leave' } });
  assert.equal(rt.player().space, 'w');
  assert.deepEqual(rt.player().at, [12, 4, 0]);
});

test('spawner and portal replay deterministically across snapshot/restore', () => {
  const sys = [{ use: 'engine.spawner', with: { rules: [{ id: 's', archetype: 'slime', zone: 'yard', count: [3, 8], respawnSec: 0.5, groupSize: [1, 3], spread: 2 }] } },
    { use: 'engine.portal', with: { portals: [{ id: 't', from: { at: [3, 3, 0], r: 1 }, to: { at: [9, 9, 0] }, trigger: 'touch', cooldownSec: 0.2 }] } }];
  const drive = (rt, from, to) => { for (let i = from; i < to; i++) { if (i % 37 === 0) { const s = Object.values(rt.state.entities).find(e => e.archetype === 'slime'); if (s) rt.despawn(s.id); } if (i % 50 === 0) rt.space('w').setPos(rt.player(), [3, 3, 0], rt); rt.step(); } };
  const a = make(sys).rt, b = make(sys).rt;
  drive(a, 0, 400); drive(b, 0, 200);
  const snap = b.snapshot(); drive(b, 200, 260); b.restore(snap); drive(b, 200, 400);
  assert.deepEqual(a.snapshot(), b.snapshot());
});

// Placement on the world as generated (spawner rule.band, sampled grid spawns): a generated maze, whose walls no document
// coordinate knows, seats every band rule on cells its archetype can stand in, each group at its own edge, no two on one
// cell, the same cells on replay and after a restore; a zone spawn sampled over walls lands on an open cell of the zone.
test('engine.spawner: band seats and sampled grid spawns resolve on the generated world, never on a wall', async () => {
  const { templateById } = await import('../v2/templates/registry.js');
  const { buildCatalogue } = await import('../v2/planner/catalog.js');
  const { createWorld } = await import('../v2/kernel/world.js');
  const { standable } = await import('../v2/primitives/engine/runtime-lib.js');
  const cat = buildCatalogue();
  const base = structuredClone(templateById('maze-chase').doc);
  const [W, H] = base.spaces[0].with.size;
  base.spaces[0].zones = [...(base.spaces[0].zones || []), { id: 'whole', rect: [0, 0, W, H] }];
  base.content.archetypes.push({ id: 'piece', kind: 'npc', components: { body: {} } });
  const seats = [0, 1, 2, 3].flatMap(band => [1, 2, 3].map(k => ({ id: `seat_${band}_${k}`, archetype: 'piece', band, unique: true, activation: 'always', respawnSec: 0 })));
  const scattered = { id: 'scattered', archetype: 'piece', zone: 'whole', activation: 'always', count: [40, 40], respawnSec: 0 };
  base.systems.unshift({ use: 'engine.spawner', with: { intervalSec: 0, rules: [...seats, scattered] } });
  const pre = preflight(base, cat.registry, cat.logic);
  assert.ok(pre.ok, JSON.stringify(pre.errors.slice(0, 3)));
  const boot = seed => { const rt = createWorld(pre.doc, cat.registry, cat.logic, { seed }); let failed = 0; rt.on('spawn_failed', () => failed++); for (let i = 0; i < 10; i++) rt.step({}); return { rt, failed }; };
  for (const seed of [1, 2, 3]) {
    const { rt, failed } = boot(seed), api = rt.space('maze');
    assert.equal(failed, 0, `seed ${seed}: every spawn found a place`);
    const placed = Object.values(rt.state.entities).filter(e => e.archetype === 'piece');
    assert.equal(placed.length, seats.length + 40, `seed ${seed}`);
    for (const e of placed) assert.ok(standable(rt, api, 'maze', e.at, e), `seed ${seed}: ${e.id} at ${e.at} stands in an open cell`);
    const cells = seats.map(r => rt.entity(r.id).at.join());
    assert.equal(new Set(cells).size, cells.length, 'one seat per cell');
    assert.ok(!cells.includes(rt.player().at.join()), 'no seat on the player');
    const at = band => seats.filter(r => r.band === band).map(r => rt.entity(r.id).at);
    assert.ok(Math.min(...at(0).map(c => c[1])) > Math.max(...at(1).map(c => c[1])), 'band 0 the far rows, band 1 the near rows');
    assert.ok(Math.max(...at(2).map(c => c[0])) < Math.min(...at(3).map(c => c[0])), 'band 2 the left columns, band 3 the right');
  }
  // The seats are kept in state: a replay and a restore seat the same cells.
  const a = boot(2).rt, b = boot(2).rt, snap = b.snapshot();
  for (let i = 0; i < 30; i++) b.step({});
  b.restore(snap);
  for (let i = 0; i < 30; i++) { a.step({}); b.step({}); }
  assert.deepEqual(a.snapshot(), b.snapshot());
});

test('preflight rejects bad spawner and portal configs with stable codes', () => {
  const bad = doc([
    { use: 'engine.spawner', with: { groups: [{ id: 'g', maxAlive: 1 }], rules: [{ id: 'a', archetype: 'slime', count: [5, 2], group: 'nope', at: 'x', release: {} }, { id: 'a', archetype: 'unicorn', zone: 'mars', unique: true, count: [2, 2] }] } },
    { use: 'engine.portal', with: { portals: [{ id: 'p', from: {}, to: {}, gate: 7 }, { id: 'p', from: { zone: 'yard', space: 'nowhere' }, to: { at: [1, 1] }, oneWay: false, key: 'ghost_key' }] } },
  ]);
  bad.plot = { storyboard: { acts: [] } };
  const c = codes(bad);
  for (const code of ['spawn_rule_duplicate', 'spawn_range', 'spawn_group_unknown', 'spawn_release_invalid', 'ref_unknown', 'portal_duplicate', 'portal_endpoint', 'portal_gate_invalid']) assert.ok(c.includes(code), code);
});

test('every engine.spawner/portal instance in v2/games has valid params', () => {
  let n = 0;
  for (const id of ['blockport', 'emberfall', 'hollow-lantern', 'quiet-manor']) {
    const g = JSON.parse(readFileSync(new URL(`../v2/games/${id}.json`, import.meta.url)));
    (g.systems || []).forEach((s, i) => {
      if (s.use !== 'engine.spawner' && s.use !== 'engine.portal') return;
      const p = runtime.find(x => x.id === s.use), errors = [];
      checkFields(p.card.params, s.with || {}, `${id}.systems[${i}].with`, errors); n++;
      assert.deepEqual(errors, [], `${id} systems[${i}]`);
    });
  }
  assert.equal(n, 6);
});
