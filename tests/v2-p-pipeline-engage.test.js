// The engagement contract (card.engage, v2/planner/engage.js): real generated documents that nobody could play
// (tests/fixtures/v2-live, copied from local-data/v2/games) must, after engage, boot with options and let a short
// scripted run fire their core mechanic. Offline, no model calls, milliseconds per document.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { engageDocument } from '../v2/planner/engage.js';
import { firstPlayable } from '../v2/planner/first-playable.js';
import { preflight } from '../v2/kernel/document.js';
import { createWorld } from '../v2/kernel/world.js';
import { hashOf } from '../v2/server/store.js';

const { registry, logic } = buildCatalogue();
const live = name => { const f = JSON.parse(readFileSync(new URL(`./fixtures/v2-live/${name}.json`, import.meta.url), 'utf8')); return f.doc || f; };
const boot = doc => createWorld(preflight(doc, registry, logic).doc, registry, logic, { seed: doc.seed });
const steps = (rt, n, input = {}) => { for (let i = 0; i < n && rt.state.status === 'playing'; i++) rt.step(structuredClone(input)); return rt; };

test('kart: the player starts seated in a car, drives under throttle, and races rivals who drive too', () => {
  const doc = live('kart');
  assert.equal(firstPlayable(doc, registry, logic, { seed: doc.seed }).options, 0, 'the live document offers nothing before engage');
  const e = engageDocument(doc, registry, logic);
  assert.ok(e.ok, JSON.stringify(e.errors));
  assert.ok(e.applied.some(a => a.part === 'player.enter'), JSON.stringify(e.applied));
  const fp = firstPlayable(e.doc, registry, logic, { seed: doc.seed });
  assert.ok(fp.ok && fp.options > 0, `options ${fp.options}`);

  const rt = boot(e.doc);
  steps(rt, 2);
  assert.ok(rt.state.counts.vehicle_entered >= 1, 'vehicle_entered fired');
  assert.ok(rt.test({ in_vehicle: true, seat: 'driver' }), 'the player drives');
  const x0 = rt.player().at[0];
  steps(rt, 240, { axes: { move: [0, 1] } });
  assert.ok(rt.state.vars['vehicle.speed'] > 0, 'speed under throttle');
  assert.ok(rt.player().at[0] > x0 + 10, 'the player moved along the track');
  assert.ok(rt.state.counts.race_start >= 1, 'the race started');
  const race = Object.entries(rt.state.prim).find(([k]) => k.startsWith('gameplay.race'))[1];
  for (const id of ['player', 'npc1', 'npc2', 'npc3']) assert.ok(race.racers[id], `${id} races`);
  assert.ok(rt.state.counts['checkpoint'] >= 1 && race.racers.player.next !== 1, 'the player passed a checkpoint');
  for (const id of ['npc1', 'npc2', 'npc3']) {
    assert.ok(rt.entity(id).components.seat, `${id} sits in a vehicle`);
    assert.ok(rt.entity(id).at[0] > 5, `${id} drives`);
  }
});

test('engage is idempotent, deterministic and keeps what the document has', () => {
  const doc = live('kart');
  const once = engageDocument(doc, registry, logic), twice = engageDocument(once.doc, registry, logic);
  assert.equal(hashOf(twice.doc), hashOf(once.doc), 'a second pass changes nothing');
  assert.deepEqual(twice.applied, []);
  assert.equal(hashOf(engageDocument(doc, registry, logic).doc), hashOf(once.doc), 'same input, same output');
  assert.notEqual(hashOf(doc), hashOf(once.doc), 'the input is not modified in place');
  const run = () => hashOf(steps(boot(once.doc), 120, { axes: { move: [0.2, 1] } }).snapshot());
  assert.equal(run(), run(), 'replay determinism');
  // A vehicle archetype the document already has is reused, not duplicated.
  const own = structuredClone(doc);
  own.content.archetypes.push({ id: 'cart', kind: 'vehicle', components: { vehicle: { seats: 2, health: 80, fuel: 0 }, car: { maxSpeed: 60 } } });
  const r = engageDocument(own, registry, logic);
  assert.ok(!r.doc.content.archetypes.some(a => a.id === 'car'));
  assert.equal(r.doc.content.archetypes.find(a => a.id === 'cart').components.car.maxSpeed, 60);
  assert.ok(steps(boot(r.doc), 3).entity('player_cart'), 'the player got the document\'s own cart');
  // A document that already seats the player itself is left alone.
  const seated = structuredClone(r.doc);
  const again = engageDocument(seated, registry, logic);
  assert.ok(!again.applied.some(a => a.part === 'player.enter'));
});
