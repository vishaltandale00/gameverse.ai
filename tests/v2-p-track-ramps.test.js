// Ramps on a track (engine.space.track body.launch): a body that drives onto a launch body while grounded is launched
// upward at its speed, once per contact. The space applies it to the ballistic bodies it integrates; controllers that
// integrate their own vertical motion read it through the space's launchAt (gameplay.vehicle.car flies under the
// track's gravity, gameplay.move.lanes takes the jump's arc). Chunks place ramps as chars whose archetype's body
// declares launch: the passability proof drives over them, and a ramp char that also says it blocks is refused
// (chunk_launch_blocks). A race whose course has ramps still passes the version gate and its race bot still wins.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, run } from '../v2/kernel/testing.js';
import { preflight } from '../v2/kernel/document.js';
import { PRIMITIVES } from '../v2/primitives/index.js';
import spaces2d from '../v2/primitives/engine/spaces2d.index.js';
import { passable, launches } from '../v2/primitives/engine/generate-chunks.js';
import { templateById } from '../v2/templates/registry.js';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { gateVersion, botProof } from '../v2/planner/version-gate.js';

const RAMP = { id: 'ramp', name: 'Ramp', kind: 'prop', components: { body: { size: [2, 1, 0.4], launch: 8 } } };
const trackDoc = (systems = [], archetypes = [], player = { archetype: 'runner', at: [2, 1, 0] }) => ({
  schema: 'gameverse.v2.game/0.2', id: 'ramps', title: 'Ramps', seed: 3,
  spaces: [{ id: 'rail', use: 'engine.space.track', with: { lanes: 3, window: [10, 60] }, zones: [{ id: 'start', range: [0, 10] }] }],
  systems, content: { archetypes: [{ id: 'runner', components: { body: { size: [0.8, 0.6, 1] } } }, RAMP, ...archetypes] }, player,
});

test('track: a ballistic body that rolls onto a launch body is launched at its speed once per contact, and lands beyond it', () => {
  const { rt } = compile(trackDoc(), { primitives: spaces2d });
  const api = rt.space('rail');
  rt.spawn('ramp', { id: 'r1', at: [6, 1, 0] });
  const ball = rt.spawn('runner', { id: 'ball', at: [3, 1, 0], components: { body: { size: [0.6, 0.6, 0.6], ballistic: true, vel: [6, 0, 0] } } });
  const launched = [], landed = []; rt.on('launched_ramp', e => launched.push(e)); rt.on('landed', e => landed.push(e));
  let top = 0;
  for (let i = 0; i < 120; i++) { rt.step(); top = Math.max(top, ball.at[2]); }
  assert.deepEqual(launched.map(e => [e.who, e.by, e.speed]), [['ball', 'r1', 8]], 'one launch for one contact');
  assert.ok(top > 1, `it flew: apex ${top}`);
  assert.ok(landed.some(e => e.who === 'ball') && ball.at[2] === 0.3 && ball.at[0] > 7, `landed beyond the ramp: ${ball.at}`);
  assert.deepEqual(api.launchAt(ball, rt), 0, 'no contact, no launch');
  // A launch body is not solid: nothing blocks against it, and the card declares the field, the event and the method.
  const track = spaces2d.find(p => p.id === 'engine.space.track');
  assert.equal(track.card.components.body.fields.launch.type, 'number');
  assert.ok(track.card.provides.events.includes('launched_ramp'));
  assert.deepEqual(track.card.provides.capabilityMethods.launch, ['launchAt']);
});

test('track: launchAt launches a grounded body once per contact, never an airborne one, and again on a new contact', () => {
  const { rt } = compile(trackDoc(), { primitives: spaces2d });
  const api = rt.space('rail'), p = rt.player();
  rt.spawn('ramp', { id: 'r1', at: [6, 1, 0] });
  api.setPos(p, [6, 1, 3], rt);
  assert.equal(api.launchAt(p, rt), 0, 'above the ramp, not in contact');
  api.setPos(p, [6, 1, 0.5], rt);
  assert.equal(api.launchAt(p, rt), 8, 'grounded on the ramp');
  assert.equal(api.launchAt(p, rt), 0, 'the same contact launches once');
  api.setPos(p, [12, 1, 0.5], rt); api.launchAt(p, rt);
  api.setPos(p, [6, 1, 0.5], rt);
  assert.equal(api.launchAt(p, rt), 8, 'a new contact launches again');
  const r2 = rt.spawn('ramp', { id: 'r2', at: [20, 1, 0] });
  api.setPos(p, [20, 1, 1.2], rt);
  assert.equal(api.slide(p, [0, 0, 0], rt).grounded, false);
  assert.equal(api.launchAt(p, rt), 0, 'an airborne body in contact is not launched');
  api.setPos(p, [20, 1, 0.5], rt);
  assert.equal(api.launchAt(p, rt), 8, 'it is once it touches down in the contact');
  rt.despawn(r2.id);
});

test('vehicle.car on a track: a kart that drives onto a ramp goes airborne, flies under the track\'s gravity, lands beyond it and keeps driving', () => {
  const kart = { id: 'kart', kind: 'vehicle', components: { vehicle: { seats: 1, health: 100, fuel: 0 }, car: { preset: 'kart', maxSpeed: 72, accel: 16 }, body: { size: [1.4, 0.8, 0.6] } } };
  const doc = trackDoc([{ use: 'gameplay.vehicle.core' }, { use: 'gameplay.vehicle.car', with: { plane: 'xy' } }], [kart], { archetype: 'runner', at: [0.5, 1, 0] });
  doc.spaces[0].with = { lanes: 3, length: 200, loop: true, window: [10, 60] };
  const { rt } = compile(doc, { primitives: PRIMITIVES });
  rt.spawn('ramp', { id: 'r1', at: [30, 1, 0] });
  const v = rt.spawn('kart', { id: 'k', at: [2, 1, 0.3] });
  rt.run([{ do: 'enter_vehicle', vehicle: 'k', force: true }]);
  const seen = []; for (const ev of ['airborne', 'landed', 'launched_ramp', 'crash']) rt.on(ev, e => seen.push([ev, e.vehicle ?? e.who]));
  let top = 0, tookOffAt = null, landedAt = null;
  for (let i = 0; i < 360; i++) {
    rt.step({ axes: { move: [0, 1] } }); // the person's throttle, through the controls
    assert.equal(v.at[1], 1, 'stays in its lane');
    top = Math.max(top, v.at[2]);
    if (tookOffAt === null && v.components.drive.airborne) tookOffAt = v.at[0];
    if (tookOffAt !== null && landedAt === null && !v.components.drive.airborne) landedAt = v.at[0];
  }
  assert.deepEqual(seen.filter(([ev]) => ev !== 'crash'), [['launched_ramp', 'k'], ['airborne', 'k'], ['landed', 'k']], JSON.stringify(seen));
  assert.ok(top > 1, `it flew: apex ${top}`);
  assert.ok(tookOffAt > 28 && tookOffAt < 32 && landedAt > 32, `took off on the ramp (${tookOffAt}), landed beyond it (${landedAt})`);
  assert.equal(v.at[2], 0.3, 'back on the ground');
  assert.ok(v.at[0] > landedAt + 10 || rt.space('rail').laps(v) > 0, `kept driving after landing: ${v.at}`);
});

test('move.lanes on a track: a runner that runs onto a ramp is launched into the jump\'s arc and lands', () => {
  const doc = trackDoc([{ use: 'gameplay.move.lanes', with: { speed: 8 } }]);
  const { rt } = compile(doc, { primitives: PRIMITIVES });
  rt.spawn('ramp', { id: 'r1', at: [12, 1, 0] });
  const p = rt.player(), events = [];
  for (const ev of ['launched_ramp', 'landed', 'jumped']) rt.on(ev, e => events.push([ev, e.who]));
  let top = 0;
  for (let i = 0; i < 180; i++) { rt.step(); top = Math.max(top, p.at[2]); }
  assert.deepEqual(events, [['launched_ramp', 'player'], ['landed', 'player']], 'launched by the ramp, not by the jump verb');
  assert.ok(top > 1.5, `in the air: apex ${top}`);
  assert.ok(p.at[0] > 14 && p.components.body.grounded, `ran on past the ramp: ${p.at}`);
});

test('chunks: a ramp char passes the passability proof where a blocking char in the same place does not, and a blocking ramp is refused', () => {
  const chunk = { id: 'wall', rows: ['RRR'] };
  assert.equal(passable(chunk, 'rows', { '.': {}, R: { archetype: 'ramp' } }, 1), true, 'a ramp across every lane is driven over');
  assert.equal(passable(chunk, 'rows', { '.': {}, R: { archetype: 'ramp', blocks: true } }, 1), false, 'a blocking char across every lane closes the way');
  const doc = { content: { archetypes: [RAMP, { id: 'cone', components: { body: { size: [0.6, 0.6, 0.6], solid: true } } }] } };
  assert.equal(launches({ archetype: 'ramp' }, doc), true);
  assert.equal(launches({ archetype: 'cone' }, doc), false);
  assert.equal(launches({ archetype: 'cone', components: { body: { size: [1, 1, 0.3], launch: 5 } } }, doc), true, 'legend components replace the archetype body');
  assert.equal(launches({ archetype: 'ramp', components: { body: { size: [1, 1, 0.3] } } }, doc), false);
  const { registry, logic } = buildCatalogue();
  const race = structuredClone(templateById('race').doc);
  race.content.archetypes.push(RAMP);
  race.spaces[0].generators[0].with.legend.R = { archetype: 'ramp', blocks: true };
  race.spaces[0].generators[0].with.chunks.push({ id: 'jump', spacing: 3, rows: ['.RRR.'] });
  const r = preflight(race, registry, logic);
  assert.deepEqual(r.errors.map(e => [e.code, e.path]), [['chunk_launch_blocks', 'spaces[0].generators[0].with.legend.R.blocks']]);
});

/** The race template with ramps on its obstacle chunks: the legend entry a revision writes and the ramp archetype. */
function raceWithRamps() {
  const doc = structuredClone(templateById('race').doc);
  doc.content.archetypes.push({ id: 'ramp', name: 'Ramp', kind: 'prop', components: { body: { size: [2, 0.6, 0.3], launch: 6 } } });
  const gen = doc.spaces[0].generators[0].with;
  gen.legend.R = { archetype: 'ramp' };
  gen.chunks.push({ id: 'jump', spacing: 3, rows: ['XRRRX'] });
  return doc;
}

test('race template with ramps on its course: passes the version gate (playable) and its race bot still wins, launching off ramps', async () => {
  const { registry, logic } = buildCatalogue();
  const t = templateById('race'), doc = raceWithRamps();
  const base = { doc: preflight(structuredClone(t.doc), registry, logic).doc, verify: null };
  const g = await gateVersion(doc, { registry, logic, template: t, playable: true });
  assert.ok(g.ok, `${g.stage}: ${JSON.stringify(g.problems.slice(0, 3))}`);
  const proof = botProof(g.doc, registry, logic);
  const before = botProof(base.doc, registry, logic);
  for (const b of before.bots.filter(x => x.won)) assert.ok(proof.bots.find(x => x.id === b.id)?.won, `the ${b.id} bot still wins: ${JSON.stringify(proof.bots)}`);
  assert.ok(proof.bots.some(b => b.won), JSON.stringify(proof.bots));
  // Play the race and see karts launched by the ramps and laps still counted.
  const { rt } = compile(g.doc, { primitives: PRIMITIVES });
  const launched = new Set(), laps = []; rt.on('launched_ramp', e => launched.add(e.who)); rt.on('lap', e => laps.push(e.who));
  for (let i = 0; i < 60 * 40 && rt.state.status === 'playing'; i++) rt.step();
  assert.ok(rt.state.entities && Object.values(rt.state.entities).some(e => e.archetype === 'ramp'), 'ramps placed on the course');
  assert.ok(launched.size > 0, 'karts drove onto ramps and were launched');
  assert.ok(laps.length > 0, 'laps still counted');
});
