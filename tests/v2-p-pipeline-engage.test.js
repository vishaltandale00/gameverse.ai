// The engagement contract (card.engage, v2/planner/engage.js): real generated documents that nobody could play
// (tests/fixtures/v2-live, copied from local-data/v2/games) must, after engage, boot with options and let a short
// scripted run fire their core mechanic. Offline, no model calls, milliseconds per document.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { engageDocument } from '../v2/planner/engage.js';
import { firstPlayable } from '../v2/planner/first-playable.js';
import { proceduralOutline } from '../v2/planner/outline.js';
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

test('kart skeleton: the procedural outline for the same selection is drivable, and once engaged the player can act from the start', async () => {
  const { decomposition, selection: stored } = JSON.parse(readFileSync(new URL('./fixtures/v2-live/kart.json', import.meta.url), 'utf8')).report;
  // The report keeps the selection's chosen ids; the planner's working fields start empty.
  // The recorded selection carries plot.storyboard, which the play spec's narrative flag used to add (the HANDOFF's
  // kart failure): no mechanic maps to it, and the preset no longer removes it, so it is left out of the fixture here.
  const selection = { generators: [], graphics: [], gaps: [], bind: {}, ...stored, systems: stored.systems.filter(id => id !== 'plot.storyboard'), spaces: stored.spaces.map(s => ({ caps: [], ...s })) };
  const o = proceduralOutline({ decomposition, selection, registry, logic, seed: 5, prompt: 'Mario Kart with shopping carts' });
  assert.ok(o.ok);
  assert.equal(firstPlayable(o.doc, registry, logic, { seed: 5 }).options, 0, 'the skeleton alone offers nothing');
  const rt = steps(boot(engageDocument(o.doc, registry, logic).doc), 120, { axes: { move: [0, 1] } });
  assert.ok(rt.state.counts.vehicle_entered >= 1 && rt.state.vars['vehicle.speed'] > 0);
  // Agency is the engaged document's (the publish gate's cannot_act): the player has options from the first frame.
  assert.ok(firstPlayable(engageDocument(o.doc, registry, logic).doc, registry, logic, { seed: 5 }).options > 0);
});

test('platformer: the player runs and jumps from the first frames', () => {
  const doc = live('platformer');
  const e = engageDocument(doc, registry, logic);
  assert.ok(e.ok);
  assert.ok(firstPlayable(e.doc, registry, logic, { seed: doc.seed }).options > 0);
  // The falling-pieces board tops out on frame 1 in this document (the generator walls over it; fixed in the
  // world generator, not here), so the movement check runs without that one instance.
  const d = structuredClone(e.doc); d.systems = d.systems.filter(s => s.use !== 'gameplay.falling.pieces');
  const rt = steps(boot(d), 30);
  assert.equal(rt.state.status, 'playing');
  const [x0, y0] = rt.player().at;
  steps(rt, 30, { axes: { move: [1, 0] } });
  assert.ok(rt.player().at[0] > x0 + 2, 'the player runs right');
  rt.step({ actions: { jump: true }, held: { jump: true } });
  let top = rt.player().at[1];
  for (let i = 0; i < 20; i++) { rt.step({ held: { jump: true } }); top = Math.max(top, rt.player().at[1]); }
  assert.ok(top > y0 + 2 && rt.state.counts.jumped >= 1, 'the player jumps');
});

// ---------- the contracts on small documents ----------
const doc0 = (systems, extra = {}) => ({ schema: 'gameverse.v2.game/0.2', id: 'e', title: 'E', seed: 3,
  spaces: [{ id: 'world', use: 'engine.space.tilemap', with: { size: [24, 12], mode: 'topdown' }, zones: [{ id: 'all', rect: [0, 0, 24, 12] }] }],
  systems, content: { archetypes: [{ id: 'hero', components: { name: 'You' } }, ...(extra.archetypes || [])], ...(extra.content || {}) }, player: { archetype: 'hero', space: 'world', at: [4.5, 4.5] } });

test('combat: the player gets health and a basic attack that hurts an enemy', () => {
  const doc = doc0([{ use: 'gameplay.combat.health' }, { use: 'gameplay.combat.melee' }], { archetypes: [{ id: 'dummy', kind: 'enemy', components: { health: { max: 20 }, team: 'enemy' } }] });
  const e = engageDocument(doc, registry, logic);
  assert.ok(e.ok, JSON.stringify(e.errors));
  const hero = e.doc.content.archetypes.find(a => a.id === 'hero');
  assert.ok(hero.components.health && hero.components.melee, JSON.stringify(e.applied));
  const rt = boot(e.doc);
  rt.spawn('dummy', { id: 'd1', space: 'world', at: [5.4, 4.5] });
  steps(rt, 2);
  assert.equal(rt.state.vars.hp, 10);
  for (let i = 0; i < 4; i++) { rt.step({ actions: { attack: true } }); steps(rt, 30); }
  assert.ok(rt.entity('d1').components.health.hp < 20, 'the attack connected');
  // A moveset the document chose is kept as it is.
  const own = structuredClone(doc); own.content.archetypes[0].components.melee = { moves: ['jab'] };
  assert.deepEqual(engageDocument(own, registry, logic).doc.content.archetypes[0].components.melee, { moves: ['jab'] });
});

test('config and join contracts fill only what the document left empty', () => {
  const species = [{ id: 'sprout', name: 'Sprout', types: ['normal'], base: { hp: 45, atk: 49, def: 49, spa: 65, spd: 65, spe: 45 }, catchRate: 45, expYield: 64, growth: 'medium', learnset: [] }];
  const moves = [{ id: 'tackle', name: 'Tackle', type: 'normal', category: 'physical', power: 40, accuracy: 100, pp: 35 }];
  const party = engageDocument(doc0([{ use: 'gameplay.creature.party' }], { content: { species, moves, types: { normal: {} } } }), registry, logic);
  assert.ok(party.ok, JSON.stringify(party.errors));
  assert.deepEqual(party.doc.systems.find(s => s.use === 'gameplay.creature.party').with.start, [{ species: 'sprout', level: 5 }]);
  const kept = engageDocument(doc0([{ use: 'gameplay.creature.party', with: { start: [{ species: 'sprout', level: 9 }] } }], { content: { species, moves, types: { normal: {} } } }), registry, logic);
  assert.equal(kept.doc.systems[0].with.start[0].level, 9);
  // Nothing to fill from: left alone and reported.
  const none = engageDocument(doc0([{ use: 'gameplay.combat.projectile' }]), registry, logic);
  assert.ok(none.skipped.some(s => s.what === 'playerWeapon'));
  const turns = engageDocument(doc0([{ use: 'gameplay.combat.health' }, { use: 'gameplay.turns', with: { sides: [{ id: 'heroes', control: 'player', members: [] }, { id: 'foes', control: 'ai', members: [] }], actions: [] } }]), registry, logic);
  assert.ok(turns.ok, JSON.stringify(turns.errors));
  assert.deepEqual(turns.doc.systems[1].with.sides[0].members, ['player']);
  assert.deepEqual(turns.doc.systems[1].with.sides[1].members, []);
});
