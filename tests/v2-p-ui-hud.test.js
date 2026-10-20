import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, run } from '../v2/kernel/testing.js';
import hud, { hudModel, counterDisplay, iconFills, meterVars } from '../v2/primitives/graphics/ui-hud.js';
import { mount } from './v2-p-ui-dom.js';
import { baseDoc, BASE, services, gameInstances, ownErrors } from './v2-p-ui-fixtures.js';
import { preflight } from '../v2/kernel/document.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';

const P = [...BASE, hud];
const setVars = vars => ({ actions: { fx: Object.entries(vars).map(([k, v]) => ({ do: 'set_var', var: k, value: v })) } });
const hudDoc = (w = {}, extra = {}) => baseDoc({ graphics: [{ use: 'graphics.ui.hud', with: w }], ...extra });

test('hud: preflight applies defaults and the model binds meters, counters and icon rows', () => {
  const { rt, checked } = compile(hudDoc({ meters: [{ pool: 'stamina' }], counters: [{ var: 'money.gold', icon: 'coin' }, { var: 'hp', icon: 'mask' }] }), { primitives: P });
  const cfg = checked.doc.graphics[0].with;
  assert.equal(cfg.crosshair, 'none'); assert.equal(cfg.meters[0].pos, 'top-left');
  run(rt, 1, setVars({ 'res.stamina': 30, 'res.stamina.max': 120, 'money.gold': 42, hp: 3, 'hp.max': 5 }));
  const vm = hudModel(rt, cfg);
  assert.deepEqual(vm.meters.map(m => [m.id, m.value, m.max, m.frac]), [['stamina', 30, 120, 0.25]]);
  assert.equal(vm.meters[0].low, true);
  const gold = vm.counters.find(c => c.key === 'c0'), hp = vm.counters.find(c => c.key === 'c1');
  assert.deepEqual([gold.value, gold.display.kind], [42, 'number']);
  assert.deepEqual([hp.display.kind, hp.fills], ['icons', [1, 1, 1, 0, 0]]);
  assert.equal(vm.counters.some(c => c.key === 'auto-hp'), false, 'hp is bound explicitly, so no auto hp widget');
});

test('hud: unbound vars stay hidden until the owning primitive publishes them', () => {
  const { rt, checked } = compile(hudDoc({ meters: [{ pool: 'mana' }] }), { primitives: P });
  assert.equal(hudModel(rt, checked.doc.graphics[0].with).meters.length, 0);
});

test('hud: counter display rules (hearts, half hearts, numbers)', () => {
  assert.deepEqual(counterDisplay('auto', 5), { kind: 'icons', per: 1, slots: 5 });
  assert.deepEqual(counterDisplay('auto', 20), { kind: 'icons', per: 2, slots: 10 });
  assert.deepEqual(counterDisplay('auto', 100), { kind: 'number' });
  assert.deepEqual(counterDisplay('number', 5), { kind: 'number' });
  assert.deepEqual(iconFills(7, 2, 5), [1, 1, 1, 0.5, 0]);
  assert.deepEqual(meterVars({ pool: 'hp' }), { value: 'hp', max: 'hp.max' });
  assert.deepEqual(meterVars({ pool: 'stamina', max: 50 }), { value: 'res.stamina', max: 50 });
});

test('hud: auto widgets, boss bar, statuses, prompt and objective come from the agreed contracts', () => {
  const svc = services({
    status: { list: () => [{ id: 'burning', remaining: 1.5, stacks: 2 }] },
    interact: { focus: () => ({ target: 'door', label: 'Open the door', verb: 'interact' }) },
    quests: { list: () => [{ id: 'q1', title: 'Find the bell', kind: 'main', state: 'active', objectives: [{ id: 'a', text: 'Talk to Mara', state: 'done' }, { id: 'b', text: 'Collect shards', state: 'active', progress: 2, count: 5 }] }] },
  });
  const doc = hudDoc({}, { content: { statuses: [{ id: 'burning', duration: 3 }] } });
  doc.systems.push({ use: 'gameplay.fixture.services' });
  const { rt, checked } = compile(doc, { primitives: [...P, svc] });
  run(rt, 1, setVars({ hp: 6, 'hp.max': 10, score: 1200, lives: 3, 'boss.hp': 50, 'boss.hp.max': 200, 'boss.id': 'warden' }));
  const vm = hudModel(rt, checked.doc.graphics[0].with, { bossNames: { warden: 'The Ash Warden' } });
  assert.deepEqual(vm.counters.find(c => c.key === 'auto-hp').fills, [1, 1, 1, 1, 1, 1, 0, 0, 0, 0]);
  assert.equal(vm.score.value, 1200); assert.equal(vm.lives.value, 3);
  assert.deepEqual([vm.boss.name, vm.boss.frac], ['The Ash Warden', 0.25]);
  assert.deepEqual(vm.status.map(s => [s.id, s.frac, s.stacks]), [['burning', 0.5, 2]]);
  assert.equal(vm.prompt.label, 'Open the door');
  assert.deepEqual([vm.objective.title, vm.objective.text, vm.objective.progress], ['Find the bell', 'Collect shards', ' 2/5']);
});

test('hud: readouts for timers, laps, positions and team scores, configured or automatic', () => {
  const { rt, checked } = compile(hudDoc({ readouts: [{ var: 'moves.left', label: 'Moves', pos: 'top-right' }] }), { primitives: P });
  run(rt, 1, setVars({ 'moves.left': 12, 'round.timer': 8, 'race.position': 2, 'race.lap': 1, 'race.laps': 3, 'score.red': 2, 'score.blue': 1, 'match.clock': 754 }));
  const vm = hudModel(rt, checked.doc.graphics[0].with);
  assert.deepEqual(vm.readouts.map(r => [r.label, r.text, r.low]), [['Moves', '12', false], ['Time', '0:08', true], ['Pos', '2nd', false], ['Lap', '1/3', false]]);
  assert.deepEqual([vm.scoreboard.teams.map(t => [t.name, t.value]), vm.scoreboard.clock], [[['Red', 2], ['Blue', 1]], '12:34']);
});

test('hud: renders in the browser host, animates changes and never touches simulation state', () => {
  const doc = hudDoc({ meters: [{ pool: 'stamina' }], counters: [{ var: 'money.gold', icon: 'coin' }], stars: { var: 'wanted', max: 5 }, crosshair: 'cross' });
  const m = mount(doc, { primitives: P });
  m.frame(1, setVars({ 'res.stamina': 50, 'res.stamina.max': 100, 'money.gold': 5, wanted: 2 }));
  m.frame(1);
  const meter = m.q('.gv-meter[data-var=stamina]');
  assert.ok(meter, 'meter rendered');
  assert.equal(meter.querySelector('.gv-meter-fill').style.getPropertyValue('transform'), 'scaleX(0.5000)');
  assert.equal(m.text('.gv-counter-value'), '5');
  assert.equal(m.qa('.gv-stars .gv-icon.is-on').length, 2);
  m.frame(1, setVars({ 'money.gold': 9 }));
  assert.equal(m.text('.gv-counter-value'), '9');
  assert.equal(m.text('.gv-counter-delta'), '+4');
  assert.ok(m.q('.gv-counter-value').classList.contains('is-pop'));
  // Notifications from the notify effect, and the zone banner on entering a zone.
  m.frame(1, { actions: { fx: [{ do: 'notify', text: 'Bridge repaired', kind: 'quest' }, { do: 'teleport', zone: 'caves' }] } });
  assert.match(m.text('.gv-toasts'), /Bridge repaired/);
  assert.match(m.text('.gv-banner'), /Echo Caves/);
  // Same inputs headless give the same simulation state: the HUD wrote nothing.
  const { rt } = compile(doc, { primitives: P });
  run(rt, 1, setVars({ 'res.stamina': 50, 'res.stamina.max': 100, 'money.gold': 5, wanted: 2 })); run(rt, 1);
  run(rt, 1, setVars({ 'money.gold': 9 }));
  run(rt, 1, { actions: { fx: [{ do: 'notify', text: 'Bridge repaired', kind: 'quest' }, { do: 'teleport', zone: 'caves' }] } });
  assert.deepEqual(m.rt.snapshot(), rt.snapshot());
});

test('hud: deterministic replay with the HUD mounted', () => {
  const doc = hudDoc({ meters: [{ pool: 'hp' }] });
  const a = mount(doc, { primitives: P }), b = mount(doc, { primitives: P });
  for (const x of [a, b]) { x.frame(3, setVars({ hp: 4, 'hp.max': 10 })); x.frame(5); }
  assert.deepEqual(a.rt.snapshot(), b.rt.snapshot());
});

test('hud: preflight rejects bad configs with stable codes', () => {
  const codes = w => { try { compile(hudDoc(w), { primitives: P }); return []; } catch (e) { return e.errors.map(x => x.code); } };
  assert.ok(codes({ meters: [{ color: '#fff' }] }).includes('ui_meter_unbound'));
  assert.ok(codes({ counters: [{ icon: 'coin' }] }).includes('ui_counter_unbound'));
  assert.ok(codes({ crosshair: 'laser' }).includes('param_option'));
  assert.ok(codes({ meters: [{ pool: 'hp', pos: 'middle' }] }).includes('param_option'));
  assert.ok(codes({ counters: [{ item: 'nope' }] }).includes('ref_unknown'));
  const notify = baseDoc({ graphics: [{ use: 'graphics.ui.hud' }], plot: { storyboard: { acts: [{ id: 'a', beats: [{ id: 'b', do: [{ do: 'notify' }] }] }] } } });
  const registry = new Registry(P), logic = buildLogic(registry, Logic);
  // notify has no text: the effect check reports ui_notify_text (beats are checked by plot.storyboard when present).
  const errors = []; logic.checkEffect({ do: 'notify' }, 'x', errors, {}); assert.equal(errors[0].code, 'ui_notify_text');
  assert.ok(preflight(notify, registry, logic));
});

test('hud: every v2/games instance preflights with zero param errors', () => {
  const registry = new Registry(P), logic = buildLogic(registry, Logic);
  const list = gameInstances('graphics.ui.hud');
  assert.ok(list.length >= 3);
  for (const { file, doc } of list) assert.deepEqual(ownErrors(preflight(doc, registry, logic).errors), [], file);
});
