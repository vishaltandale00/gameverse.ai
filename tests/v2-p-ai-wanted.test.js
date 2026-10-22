import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compile, run, testSpace } from '../v2/kernel/testing.js';
import { catalogue } from '../v2/primitives/index.js';
import { preflight } from '../v2/kernel/document.js';
import AI from '../v2/primitives/gameplay/ai.index.js';

// Test double for gameplay.economy's take_money.
const economy = { id: 'gameplay.test.economy', card: { ambient: true, intent: 'test money', params: {} }, logic(l) { l.effect('take_money', { run: (e, rt) => { rt.state.vars[`money.${e.currency ?? 'gold'}`] -= e.amount; } }); } };
const P = [...AI, testSpace, economy];
const doc = (wanted = {}, { zones = [] } = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'wanted', title: 'Wanted', seed: 9,
  spaces: [{ id: 'w', use: 'engine.space.test', with: { size: [48, 48, 1] }, zones }],
  systems: [{ use: 'gameplay.ai.brain', with: { tick: 0.1 } }, { use: 'gameplay.ai.attacks' }, { use: 'gameplay.test.economy' },
    { use: 'gameplay.wanted', with: { crimes: { murder: 1, theft: 0.3, cop_assault: 2 }, crimeEvents: [{ event: 'defeated', kind: 'murder' }], reportSec: 1, hideSec: 5, decayPerSec: 0.1, spawnDistance: [10, 14], ...wanted } }],
  content: { archetypes: [
    { id: 'hero', components: {} },
    { id: 'civ', kind: 'npc', components: { ai: { brain: [{ do: 'flee', when: { aware: 'hostile' } }, { do: 'sit' }], perception: { sight: 30, fov: 360, memory: 5 } } } },
    { id: 'cop', kind: 'npc', components: { ai: { brain: [{ do: 'chase', when: { aware: 'hostile' }, distance: 1 }, { do: 'sit' }], perception: { sight: 40, fov: 360, memory: 10 }, speed: 5 } } },
  ] },
  player: { archetype: 'hero', at: [24, 24, 0] },
});

test('crimes need witnesses; civilians report after a delay unless silenced', () => {
  const { rt } = compile(doc(), { primitives: P });
  rt.run([{ do: 'report_crime', kind: 'murder' }]);
  run(rt, 90);
  assert.equal(rt.state.vars.wanted, 0, 'nobody saw it');
  const c = rt.spawn('civ', { at: [30, 24, 0] });
  rt.emit('defeated', { who: 'nobody', by: 'player' });
  assert.equal(rt.state.counts.witness, 1);
  run(rt, 30); assert.equal(rt.state.vars.wanted, 0, 'report not in yet');
  run(rt, 40); assert.equal(rt.state.vars.wanted, 1); assert.equal(rt.state.counts.crime_reported, 1);
  // A second crime, but the witness is silenced before reporting.
  const { rt: r2 } = compile(doc(), { primitives: P });
  const w = r2.spawn('civ', { at: [30, 24, 0] });
  r2.run([{ do: 'report_crime', kind: 'murder' }]); r2.despawn(w.id); run(r2, 120);
  assert.equal(r2.state.vars.wanted, 0);
  // Petty crimes accumulate heat below a star.
  const { rt: r3 } = compile(doc(), { primitives: P });
  r3.spawn('civ', { at: [26, 24, 0] });
  for (let i = 0; i < 3; i++) r3.run([{ do: 'report_crime', kind: 'theft' }]);
  run(r3, 70);
  assert.equal(r3.state.vars.wanted, 0); assert.ok(r3.state.vars['wanted.heat'] > 0.8 && r3.state.vars['wanted.heat'] < 0.9, 'sub-star heat fades');
  r3.run([{ do: 'report_crime', kind: 'theft' }, { do: 'report_crime', kind: 'theft' }]); run(r3, 70);
  assert.equal(r3.state.vars.wanted, 1);
});

test('response units spawn out of reach, hunt the player as law and make an arrest', () => {
  const { rt } = compile(doc({ response: [{ level: 1, archetype: 'cop', count: 2 }] }), { primitives: P });
  rt.run([{ do: 'set_wanted', level: 1 }]);
  run(rt, 3);
  const cops = () => Object.values(rt.state.entities).filter(e => e.components.wantedUnit);
  assert.equal(cops().length, 1);
  const d0 = Math.hypot(cops()[0].at[0] - 24, cops()[0].at[1] - 24);
  assert.ok(d0 >= 9.9 && d0 <= 14.1, `spawned at distance ${d0}`);
  assert.equal(cops()[0].components.ai.faction, 'law');
  run(rt, 70); assert.equal(cops().length, 2, 'kept at the response count');
  assert.ok(rt.service('ai.brain').hostile(cops()[0].id, 'player'), 'law is hostile while wanted');
  run(rt, 400);
  assert.equal(rt.state.counts.busted, 1); assert.equal(rt.state.vars.wanted, 0);
  assert.ok(!rt.service('ai.brain').hostile(cops()[0]?.id ?? 'none', 'player'));
});

test('heat decays unseen; hiding long enough (or a safe zone) escapes; bribes clear it', () => {
  const { rt } = compile(doc({ starDecaySec: 0.8 }), { primitives: P });
  rt.run([{ do: 'set_wanted', level: 3 }]);
  run(rt, 60);
  assert.ok(rt.state.vars['wanted.heat'] < 3 && rt.state.vars.wanted === 2, 'decayed below three stars');
  run(rt, 250);
  assert.equal(rt.state.counts.escaped, 1); assert.equal(rt.state.vars.wanted, 0);
  const { rt: r2 } = compile(doc({ safeZones: ['den'], decayPerSec: 0.5, hideSec: 100 }, { zones: [{ id: 'den', rect: [20, 20, 30, 30] }] }), { primitives: P });
  r2.run([{ do: 'set_wanted', level: 2 }]); run(r2, 70);
  assert.equal(r2.state.vars.wanted, 2);
  const { rt: r4 } = compile(doc({ safeZones: ['den'], hideSec: 2 }, { zones: [{ id: 'den', rect: [20, 20, 30, 30] }] }), { primitives: P });
  r4.run([{ do: 'set_wanted', level: 2 }]); run(r4, 40);
  assert.equal(r4.state.vars.wanted, 0, 'hiding in a safe zone counts 4× (2 s → 0.5 s)');
  const { rt: r3 } = compile(doc({ bribe: { cost: 100 } }), { primitives: P });
  r3.state.vars['money.gold'] = 150;
  r3.run([{ do: 'set_wanted', level: 2 }, { do: 'bribe' }]);
  assert.equal(r3.state.counts.bribe_failed, 1); assert.equal(r3.state.vars.wanted, 2);
  r3.state.vars['money.gold'] = 250; r3.run([{ do: 'bribe' }]);
  assert.equal(r3.state.vars.wanted, 0); assert.equal(r3.state.vars['money.gold'], 50);
});

test('wanted replays deterministically', () => {
  const make = () => { const { rt } = compile(doc({ response: [{ level: 1, archetype: 'cop', count: 3 }] }), { primitives: P }); rt.run([{ do: 'set_wanted', level: 2 }]); return rt; };
  const a = make(), b = make();
  run(a, 200); run(b, 200);
  assert.deepEqual(a.snapshot(), b.snapshot());
});

test('preflight rejects bad wanted configs with stable codes', () => {
  const { registry, logic } = catalogue([testSpace]);
  const bad = doc({ levels: 3, crimes: { arson: -1 }, crimeEvents: [{ event: 'defeated', kind: 'jaywalking' }], spawnDistance: [50, 10], response: [{ level: 5, archetype: 'cop' }, { level: 1, archetype: 'tank' }], safeZones: ['nowhere'] });
  const errors = preflight(bad, registry, logic).errors, codes = errors.map(e => e.code);
  for (const c of ['wanted_crime_unknown', 'wanted_spawn_distance', 'wanted_response_level', 'ref_unknown']) assert.ok(codes.includes(c), c);
  // A crime's heat is the declared shape of crimes' values (≥ 0), checked as a param.
  assert.ok(errors.some(e => e.code === 'param_range' && e.path.endsWith('.with.crimes.arson')), 'negative heat');
  const noBrain = doc(); noBrain.systems = noBrain.systems.filter(s => s.use === 'gameplay.wanted');
  assert.ok(preflight(noBrain, registry, logic).errors.some(e => e.code === 'requires_unmet'));
});

test('every gameplay.wanted instance in v2/games preflights without param errors', () => {
  const { registry, logic } = catalogue();
  for (const f of fs.readdirSync('v2/games')) {
    const d = JSON.parse(fs.readFileSync(`v2/games/${f}`, 'utf8'));
    const mine = (d.systems || []).map((s, i) => [s, `systems[${i}]`]).filter(([s]) => s.use === 'gameplay.wanted').map(x => x[1]);
    const errs = preflight(d, registry, logic).errors.filter(e => mine.some(p => e.path === p || e.path?.startsWith(p + '.')));
    assert.deepEqual(errs.filter(e => !['capability_missing', 'service_missing'].includes(e.code)), [], f);
  }
});
