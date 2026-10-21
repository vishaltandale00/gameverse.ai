// Bundles in the iterative build (v2/planner/bundles.js, build.js): a step may pick a few primitives that only work
// together (a primitive and the adapter projecting it onto the space, a vehicle and its vehicle core, a primitive and the
// companion its declarations name), offered as ONE enum option labelled with its members and why each is there.
// Scripted fake writers; test primitives and the real catalogue; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSelection, MAX_CANDIDATES } from '../v2/planner/build.js';
import { formBundle, companionsOf, requiredBy, MAX_BUNDLE } from '../v2/planner/bundles.js';
import { selectPrimitives } from '../v2/planner/select.js';
import { checkComposition } from '../v2/planner/compose-check.js';
import { buildCatalogue, spaceVariants } from '../v2/planner/catalog.js';
import { normalize } from '../v2/planner/decompose.js';
import { testCatalogue, fakeWriter, buildAnswer } from './v2-p-pipeline-fixtures.js';

/** Test loops: each declares what it is played with (card.loop), nothing else is assumed. */
const loopCard = (id, intent, loop, extra = {}) => ({ id, card: { intent, params: {}, loop, provides: { actions: loop.verbs || [], events: loop.progress || [] }, ...extra }, install() {} });
/** Soaring needs updrafts, which no space has; the updraft adapter projects them onto the flat field (its adapt() configures it). */
const soar = loopCard('gameplay.test.soar', 'Soar high on rising air.', { verbs: ['soar'], progress: ['soared'] }, { requires: { capabilities: ['updraft'] } });
const updraft = { id: 'engine.adapt.test.updraft', card: { intent: 'Projects rising air columns onto a flat field.', params: { columns: { type: 'integer', default: 2, min: 1, max: 9 } }, adapts: { provides: { capabilities: ['updraft'] }, from: { spaces: ['engine.space.flatx'] }, projection: 'rising air columns over cells' } }, adapt() { return { with: { columns: 3 } }; }, install() {} };
/** Forging needs heat; the only heat source (bellows) needs updrafts, so the composition alone never finds it: forge + bellows. */
const forge = loopCard('gameplay.test.forge', 'Forge blades at an anvil.', { verbs: ['forge'], progress: ['forged'] }, { requires: { services: ['heat'] } });
const bellows = { id: 'gameplay.test.bellows', card: { intent: 'Bellows that fan a fire hot.', params: {}, provides: { services: ['heat'] }, requires: { capabilities: ['updraft'] } }, install() {} };
/** Sailing requires the wind (requires.primitives); the wind's own loop is harnessing gusts. */
const sail = loopCard('gameplay.test.sail', 'Sail a boat across open water.', { verbs: ['sail', 'tack'], progress: ['sailed'] }, { requires: { primitives: ['gameplay.test.wind'] } });
const wind = loopCard('gameplay.test.wind', 'Gusts that can be harnessed for speed.', { verbs: ['harness'], progress: ['gusted'] });
const catalogue = () => testCatalogue([soar, updraft, forge, bellows, sail, wind]);

const spec = mechanics => normalize({ title: 'Bay', premise: 'Soar, forge and sail around a bay.', tone: 'bright', references: [{ name: 'bay', kind: 'game', keeps: [] }],
  mechanics: mechanics.map(([id, importance, description]) => ({ id, verb: description.split(' ')[0], description, from: 'bay', importance })),
  spaces: [{ role: 'field', kind: 'continuous-2d', description: '' }], views: ['td'], movement: 'ground', acts: 1, zones: 2 }, 'bay');
const writer = picks => fakeWriter([req => buildAnswer(req, { space: ['engine.space.flatx'], picks }) ?? '{}']);
/** The options a pick_primitive question offered for a mechanic, by enum id. */
const offeredFor = (w, mechanic) => w.calls.filter(c => c.schema.name === 'pick_primitive' && c.user.includes(`\nMechanic ${mechanic} (`));

/**
 * (d) for a built selection: every option it offered is at most MAX_BUNDLE primitives and already composes with the
 * collection before it (no new failure or type hole), on the configuration it was offered with.
 */
function assertOffersCompose(b, registry, w, label) {
  const keys = r => new Set([...r.failures.map(f => `${f.code}:${f.unit}:${f.need?.item || ''}`), ...r.holes.map(h => `${h.code}:${h.card}`)]);
  const variants = spaceVariants(registry, b.space.use);
  for (const [k, s] of b.steps.entries()) {
    if (s.outcome === 'covered') { assert.equal(s.asks.length, 0, `${label}/${s.mechanic}: a covered mechanic is not asked`); continue; }
    const before = k === 0 ? [] : b.steps[k - 1].collection;
    for (const c of s.candidates) {
      assert.ok(c.members.length + c.adapters.length <= MAX_BUNDLE, `${label}/${s.mechanic}: ${c.members.join(' + ')} is over the limit`);
      assert.equal(c.members[0], c.id);
      if (c.id === b.space.use) continue;
      const space = { id: b.space.id, use: b.space.use, with: variants[c.variant]?.with || {} };
      const base = keys(checkComposition({ spaces: [space], systems: before }, registry, { resolve: true }));
      const r = checkComposition({ spaces: [space], systems: [...new Set([...before, ...c.members])] }, registry, { resolve: true });
      assert.deepEqual([...keys(r)].filter(k => !base.has(k)), [], `${label}/${s.mechanic}: ${c.members.join(' + ')} offered with ${before.join(', ')}`);
    }
  }
  for (const c of w.calls.filter(x => x.schema.name === 'pick_primitive')) assert.ok(c.schema.schema.properties.pick.enum.length <= MAX_CANDIDATES + 1);
}

test('(a) a mechanic whose only fitting primitive needs an adapter on the chosen space is offered with that adapter, and it composes', async () => {
  const { registry } = catalogue();
  const w = writer({ soar: ['gameplay.test.soar'] });
  const b = await buildSelection({ decomposition: spec([['soar', 'core', 'soar high on rising air']]), registry, writer: w });
  assert.equal(b.space.use, 'engine.space.flatx');
  const step = b.steps[0];
  const opt = step.candidates.find(c => c.id === 'gameplay.test.soar');
  assert.ok(opt, JSON.stringify(step));
  assert.deepEqual(opt.adapters.map(a => [a.use, a.with]), [['engine.adapt.test.updraft', { columns: 3 }]]);
  assert.match(opt.adapters[0].why, /updraft onto engine\.space\.flatx/);
  // One enum option, labelled with its members and why the adapter is there.
  const ask = offeredFor(w, 'soar')[0];
  assert.ok(ask.schema.schema.properties.pick.enum.includes('gameplay.test.soar'));
  assert.match(ask.user, /- gameplay\.test\.soar \+ engine\.adapt\.test\.updraft \(adapts updraft onto engine\.space\.flatx: rising air columns over cells\): Soar high/);
  // Picked, it composes through the adapter with the configuration its adapt() hook gave.
  assert.equal(step.outcome, 'added');
  assert.ok(['compatible-via-adapter', 'undeclared'].includes(step.checks.compose), step.checks.compose);
  assert.deepEqual(step.checks.adapters, ['engine.adapt.test.updraft']);
  assert.deepEqual(step.checks.bundle, ['gameplay.test.soar', 'engine.adapt.test.updraft']);
  assert.deepEqual(b.adapters.map(a => [a.use, a.with]), [['engine.adapt.test.updraft', { columns: 3 }]]);
  assert.deepEqual(b.systems, ['gameplay.test.soar']);
  assertOffersCompose(b, registry, w, 'soar');
});

test('(a) a primitive that composes only alongside a declared companion is offered as a bundle, not filtered out', async () => {
  const { registry } = catalogue();
  const space = { id: 'field', use: 'engine.space.flatx', with: {} };
  // Alone the forge never composes (no heat source fits the field); with the bellows its declarations name, it does.
  const alone = checkComposition({ spaces: [space], systems: ['gameplay.test.forge'] }, registry, { resolve: true });
  assert.ok(alone.failures.some(f => f.code === 'service_missing' && f.unit === 'gameplay.test.forge'), alone.reason);
  assert.ok(!checkComposition({ spaces: [space], systems: ['gameplay.test.forge', 'gameplay.test.bellows'] }, registry, { resolve: true }).failures.length);
  assert.deepEqual(companionsOf(registry, ['gameplay.test.forge'], 'engine.space.flatx', []).map(c => c.id), ['gameplay.test.bellows']);
  const w = writer({ forge: ['gameplay.test.forge'] });
  const b = await buildSelection({ decomposition: spec([['forge', 'core', 'forge blades at an anvil']]), registry, writer: w });
  const opt = b.steps[0].candidates.find(c => c.id === 'gameplay.test.forge');
  assert.deepEqual(opt.members, ['gameplay.test.forge', 'gameplay.test.bellows']);
  assert.deepEqual(opt.adapters.map(a => a.use), ['engine.adapt.test.updraft']);
  assert.match(offeredFor(w, 'forge')[0].user, /- gameplay\.test\.forge \+ gameplay\.test\.bellows \(provides service heat for gameplay\.test\.forge\) \+ engine\.adapt\.test\.updraft/);
  assert.equal(b.steps[0].outcome, 'added');
  assert.deepEqual(b.systems, ['gameplay.test.forge', 'gameplay.test.bellows']);
  // The mechanic needs both jointly: it maps to both.
  assert.deepEqual(b.mapping.forge.primitives, ['gameplay.test.forge', 'gameplay.test.bellows']);
  assertOffersCompose(b, registry, w, 'forge');
});

test('(b) a vehicle-style primitive is offered with its declared required companion as one option', async () => {
  const { registry } = buildCatalogue();
  const d = ideaSpec(IDEAS.race, registry);
  const w = firstWriter();
  const b = await buildSelection({ decomposition: d, registry, writer: w });
  const drive = b.steps.find(s => s.mechanic === 'drive');
  const car = drive.candidates.find(c => c.id === 'gameplay.vehicle.car');
  assert.ok(car, drive.candidates.map(c => c.id).join(', '));
  assert.deepEqual(car.members, ['gameplay.vehicle.car', 'gameplay.vehicle.core']);
  assert.deepEqual(car.extra.map(x => [x.id, x.kind]), [['gameplay.vehicle.core', 'requires']]);
  const ask = offeredFor(w, 'drive')[0];
  assert.ok(ask.schema.schema.properties.pick.enum.includes('gameplay.vehicle.car'));
  assert.match(ask.user, /- gameplay\.vehicle\.car \+ gameplay\.vehicle\.core \(required by gameplay\.vehicle\.car \(card\.requires\.primitives\)\)/);
  // The same requirements closure, by declarations alone (no bundle table).
  assert.deepEqual(requiredBy(registry, ['gameplay.vehicle.car'], []).map(x => x.id), ['gameplay.vehicle.core']);
});

test('(b) picking the vehicle bundle adds both members and checks them as one collection', async () => {
  const { registry } = buildCatalogue();
  const d = ideaSpec(IDEAS.race, registry);
  const w = fakeWriter([req => buildAnswer(req, { picks: { race: ['gameplay.race'], drive: ['gameplay.vehicle.car'] } })]);
  const b = await buildSelection({ decomposition: d, registry, writer: w });
  const drive = b.steps.find(s => s.mechanic === 'drive');
  assert.equal(drive.outcome, 'added');
  assert.deepEqual(drive.checks.closure, ['gameplay.vehicle.core']);
  assert.ok(['compatible', 'compatible-via-adapter', 'undeclared'].includes(drive.checks.compose), drive.checks.compose);
  for (const id of ['gameplay.race', 'gameplay.vehicle.car', 'gameplay.vehicle.core']) assert.ok(b.systems.includes(id), id);
  assertOffersCompose(b, registry, w, 'race');
});

test('(c) one bundle covering two mechanics marks both covered; the second is skipped without a question', async () => {
  const { registry } = catalogue();
  const w = writer({ sail: ['gameplay.test.sail'] });
  const d = spec([['sail', 'core', 'sail across open water'], ['wind', 'supporting', 'harness gusts for speed']]);
  const b = await buildSelection({ decomposition: d, registry, writer: w });
  const opt = b.steps[0].candidates.find(c => c.id === 'gameplay.test.sail');
  assert.deepEqual(opt.members, ['gameplay.test.sail', 'gameplay.test.wind']);
  assert.deepEqual(opt.covers, [{ mechanic: 'wind', by: 'gameplay.test.wind' }]);
  assert.match(offeredFor(w, 'sail')[0].user, /\[also covers wind via gameplay\.test\.wind\]/);
  assert.deepEqual(b.steps.map(s => [s.mechanic, s.outcome]), [['sail', 'added'], ['wind', 'covered']]);
  assert.deepEqual(b.steps[0].covers, ['wind']);
  assert.equal(b.steps[1].coveredBy, 'sail');
  assert.equal(b.steps[1].primitive, 'gameplay.test.wind');
  assert.deepEqual(b.mapping.sail.primitives, ['gameplay.test.sail']);
  assert.deepEqual(b.mapping.wind.primitives, ['gameplay.test.wind']);
  assert.equal(offeredFor(w, 'wind').length, 0, 'the covered mechanic is never asked');
  assert.deepEqual(w.calls.map(c => c.schema.name), ['pick_space', 'pick_primitive']);
  assert.ok(!b.gaps.length, JSON.stringify(b.gaps));
  // The selection keeps the log and maps both mechanics.
  const sel = await selectPrimitives({ decomposition: d, registry, writer: writer({ sail: ['gameplay.test.sail'] }) });
  assert.deepEqual(sel.build.steps.map(s => s.outcome), ['added', 'covered']);
  assert.deepEqual(sel.mechanics.find(m => m.id === 'wind').primitives, ['gameplay.test.wind']);
  assertOffersCompose(b, registry, w, 'sail');
});

test('(c) a companion never covers a mechanic of another source concept: that mechanic is asked on its own', async () => {
  const { registry } = catalogue();
  const w = writer({ sail: ['gameplay.test.sail'], wind: ['gameplay.test.wind'] });
  const d = spec([['sail', 'core', 'sail across open water'], ['wind', 'supporting', 'harness gusts for speed']]);
  d.mechanics.find(m => m.id === 'wind').from = 'weather';
  const b = await buildSelection({ decomposition: d, registry, writer: w });
  assert.deepEqual(b.steps[0].candidates.find(c => c.id === 'gameplay.test.sail').covers, []);
  assert.deepEqual(b.steps.map(s => [s.mechanic, s.outcome]), [['sail', 'added'], ['wind', 'reused']]);
  assert.equal(offeredFor(w, 'wind').length, 1);
});

test('(d) bundles never exceed the size limit; a seed whose smallest bundle would is not offered, with why', () => {
  const { registry } = catalogue();
  const composes = () => ({ ok: true, variant: 0 });
  const resolve = () => ({ adapters: [], bind: {}, gaps: [] });
  const ok = formBundle({ registry, seed: 'gameplay.test.sail', systems: [], space: 'engine.space.flatx', adapters: [], composes, resolve });
  assert.equal(ok.ok, true);
  const over = formBundle({ registry, seed: 'gameplay.test.sail', systems: [], space: 'engine.space.flatx', adapters: [], composes, resolve, limit: 1 });
  assert.equal(over.ok, false);
  assert.match(over.why, /exceeds 1 primitives/);
  // A seed that composes with nothing its declarations name stays out, with the check's own problem.
  const never = formBundle({ registry, seed: 'gameplay.test.forge', systems: [], space: 'engine.space.flatx', adapters: [], composes: () => ({ ok: false, why: 'services: no heat' }), resolve });
  assert.equal(never.ok, false);
  assert.match(never.why, /no heat/);
});

// (e) Unrelated ideas on the real catalogue: nothing here knows a genre.
const IDEAS = {
  sides: { premise: 'Two armies take turns moving pieces on a board to capture the enemy king.', ref: 'chess', views: ['board'], kind: 'board', movement: 'none',
    core: { interaction: 'pieces-turns', opponent: 'ai-side', win: 'capture the king', lose: 'lose the king', theme: 'war', narrative: false, mashup: [], loop: 'move_pieces' },
    mechanics: [['move_pieces', 'core', 'move pieces across the board in turns'], ['capture', 'core', 'capture enemy pieces by moving onto them'], ['promote', 'supporting', 'promote a piece that reaches the far side']] },
  race: { premise: 'Race shopping carts around a supermarket track against rival racers.', ref: 'kart racing', views: ['3p'], kind: 'continuous-3d', movement: 'track',
    core: { interaction: 'avatar-realtime', opponent: 'ai-rival', win: 'finish first', lose: '', theme: 'supermarket', narrative: false, mashup: [], loop: 'race' },
    mechanics: [['race', 'core', 'race laps around a track against rival racers'], ['drive', 'core', 'drive and steer a cart'], ['items', 'supporting', 'pick up and use items to hinder rivals']] },
  farm: { premise: 'Grow crops on a small farm, then sell the harvest at the market to pay off the debt.', ref: 'farm life', views: ['td'], kind: 'tiles-topdown', movement: 'ground',
    core: { interaction: 'avatar-realtime', opponent: 'clock', win: 'pay off the debt', lose: '', theme: 'pastoral', narrative: false, mashup: [], loop: 'farm' },
    mechanics: [['farm', 'core', 'till, plant, water and harvest crops'], ['sell', 'core', 'sell the harvest and buy seeds at the market'], ['craft', 'supporting', 'craft tools from gathered materials']] },
  cards: { premise: 'Duel a rival by playing cards from a deck, each turn spending mana on minions and spells.', ref: 'card duel', views: ['ui'], kind: 'none', movement: 'none',
    core: { interaction: 'menu', opponent: 'ai-side', win: 'reduce the rival to zero health', lose: 'reach zero health', theme: 'arcane', narrative: false, mashup: [], loop: 'play_cards' },
    mechanics: [['play_cards', 'core', 'play cards from a deck against a rival'], ['take_turns', 'core', 'take turns with the rival'], ['health', 'supporting', 'lose health when hit']] },
};
const ideaSpec = (x, registry) => normalize({ title: x.ref, premise: x.premise, tone: x.core.theme, references: [{ name: x.ref, kind: 'game', keeps: [] }], views: x.views, movement: x.movement, acts: 1, zones: 3,
  spaces: [{ role: 'world', kind: x.kind, description: '' }], mechanics: x.mechanics.map(([id, importance, description]) => ({ id, verb: description.split(' ')[0], description, from: x.ref, importance })), core: x.core }, x.premise, registry);
/** A model that picks the best-ranked option for every question. */
const firstWriter = () => fakeWriter([req => { const p = req.schema.schema.properties; const field = p.space ? 'space' : 'pick'; return JSON.stringify({ [field]: p[field].enum[0], why: 'first', ...(p.spec ? { spec: '' } : {}) }); }]);

test('(e) bundles work the same on unrelated ideas: every option composes, within the limit, and covered steps are logged', async () => {
  const { registry } = buildCatalogue();
  let bundled = 0;
  for (const [name, x] of Object.entries(IDEAS)) {
    const d = ideaSpec(x, registry);
    const w = firstWriter();
    const b = await buildSelection({ decomposition: d, registry, writer: w });
    assert.ok(b.systems.length > 0, name);
    // One step per mechanic, in worklist order (the loop steps after them); a covered one names the step whose bundle covered it.
    const mech = b.steps.filter(s => s.kind === 'mechanic');
    assert.equal(mech.length, x.mechanics.length, name);
    assert.ok(b.steps.slice(mech.length).every(s => s.kind !== 'mechanic'), name);
    for (const s of mech.filter(s => s.outcome === 'covered')) assert.ok(mech.find(t => t.mechanic === s.coveredBy)?.covers?.includes(s.mechanic), `${name}/${s.mechanic}`);
    assert.equal(w.calls.filter(c => c.schema.name === 'pick_primitive').length, mech.filter(s => s.outcome !== 'covered').length + mech.reduce((n, s) => n + Math.max(0, s.asks.length - 1), 0), name);
    // Every bundle member the collection gained is in it, and every option shown is labelled with its members.
    for (const s of b.steps.filter(s => s.checks)) for (const id of s.checks.bundle.filter(id => !id.startsWith('engine.adapt.'))) assert.ok(b.systems.includes(id) || id === b.space.use, `${name}: ${id}`);
    for (const c of w.calls.filter(c => c.schema.name === 'pick_primitive')) {
      const step = mech.find(s => c.user.includes(`\nMechanic ${s.mechanic} (`));
      for (const o of step.candidates.filter(o => o.members.length > 1)) { bundled++; assert.ok(c.user.includes(`- ${o.members[0]} + ${o.members[1]} (`) || !c.schema.schema.properties.pick.enum.includes(o.id), `${name}: ${o.members.join(' + ')}`); }
    }
    assertOffersCompose(b, registry, w, name);
  }
  assert.ok(bundled > 0, 'some idea was offered a bundle');
});
