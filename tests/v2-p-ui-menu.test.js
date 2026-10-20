import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, run } from '../v2/kernel/testing.js';
import { preflight } from '../v2/kernel/document.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import menu, { titleParts, controlRows, selectOptions, resultsModel } from '../v2/primitives/graphics/ui-menu.js';
import hud from '../v2/primitives/graphics/ui-hud.js';
import { mount } from './v2-p-ui-dom.js';
import { baseDoc, BASE, actions, gameInstances, ownErrors } from './v2-p-ui-fixtures.js';

const P = [...BASE, menu, hud, actions(['select_character', 'select_stage'])];
const content = { archetypes: [{ id: 'hero', kind: 'player', name: 'Ada', components: {} }, { id: 'rogue', kind: 'player', name: 'Bram', components: {} }, { id: 'bat', kind: 'enemy', components: {} }] };
const plot = { endings: [{ id: 'good', title: 'Dawn Returns', epilogue: 'The lantern burns again.', when: { flag: 'x' } }] };
const doc = (w = {}) => {
  const d = baseDoc({ title: 'Hollow Lantern: Ember Path', content, plot, systems: [{ use: 'gameplay.fixture.actions' }], graphics: [{ use: 'graphics.ui.menu', with: w }, { use: 'graphics.ui.hud' }] });
  d.systems.push({ use: 'gameplay.inventory' });
  return d;
};

test('menu helpers: title split, controls from bindings, select options, results', () => {
  assert.deepEqual(titleParts('Hollow Lantern: Ember Path'), ['Hollow Lantern', 'Ember Path']);
  assert.deepEqual(titleParts('Blockport'), ['Blockport', '']);
  const d = doc(); d.systems.push({ use: 'engine.input.actions', with: { bindings: { side: { jump: ['z', 'space'], attack: ['c'], map: ['tab'] } } } });
  d.graphics.push({ use: 'graphics.ui.map' });
  const rows = controlRows(d, () => true);
  assert.deepEqual(rows.map(r => [r.label, r.keys.join(' ')]), [['Jump', 'Z Space'], ['Attack', 'C'], ['Pause', 'Esc'], ['Map', 'Tab']]);
  assert.deepEqual(selectOptions(doc(), { kind: 'character' }).map(o => o.name), ['Ada', 'Bram']);
  assert.deepEqual(selectOptions(doc(), { kind: 'stage' }).map(o => o.name), ['Sunny Meadow', 'Echo Caves']);
  const { rt } = compile(doc(), { primitives: P });
  run(rt, 30, { actions: { fx: [{ do: 'emit', event: 'defeated' }] } });
  rt.run([{ do: 'end_game', ending: 'good', outcome: 'won' }]);
  const r = resultsModel(rt, { ending: 'good', outcome: 'won' });
  assert.deepEqual([r.won, r.title, r.text], [true, 'Dawn Returns', 'The lantern burns again.']);
  assert.deepEqual(r.stats.slice(0, 2), [['Time', '0:00'], ['Defeated', '30']]);
});

test('menu: title holds the sim, press start runs character select, the choice reaches the game', () => {
  const m = mount(doc({ select: [{ id: 'hero', kind: 'character', action: 'select_character' }] }), { primitives: P });
  assert.equal(m.text('.gv-title-name'), 'Hollow Lantern');
  assert.equal(m.text('.gv-title-sub'), 'Ember Path');
  assert.equal(m.view.modal, 'menu');
  m.frame(5); assert.equal(m.rt.state.frame, 0, 'held on the title screen');
  m.key('Enter'); m.frame(1);
  assert.equal(m.qa('.gv-select-card').length, 2);
  m.key('ArrowRight'); m.key('Enter'); m.frame(1);
  assert.deepEqual(m.rt.state.prim['fixture.actions'].select_character, ['rogue']);
  assert.equal(m.view.modal, null);
  const f = m.rt.state.frame; m.frame(3); assert.equal(m.rt.state.frame, f + 3, 'play runs after the menus close');
});

test('menu: pause, settings sliders, local save/load, restart and results', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  try {
    const m = mount(doc({ title: false }), { primitives: P });
    m.frame(10);
    m.key('Escape'); m.frame(1);
    assert.equal(m.text('.gv-menu-card h2'), 'Paused');
    const f = m.rt.state.frame; m.frame(4); assert.equal(m.rt.state.frame, f, 'paused');
    const labels = [...m.qa('.gv-menu-card .gv-btn')].map(b => b.textContent);
    assert.deepEqual(labels, ['Resume', 'Save game', 'Load game', 'Settings', 'Controls', 'Restart']);
    // Settings: Master volume slider moves with left/right and persists.
    m.key('ArrowDown'); m.key('ArrowDown'); m.key('ArrowDown'); m.key('Enter');
    assert.equal(m.text('.gv-menu-card h2'), 'Settings');
    m.key('ArrowLeft'); m.key('ArrowLeft');
    assert.equal(JSON.parse(store.get('gv.ui.settings')).master, 0.6);
    m.key('Escape'); assert.equal(m.text('.gv-menu-card h2'), 'Paused');
    // Save to slot 1 (no engine.save: host snapshot in localStorage), then play on and load it back.
    m.key('ArrowDown'); m.key('Enter'); m.key('Enter');
    assert.ok(store.get('gv.save.ui-test.1'));
    m.frame(20, { actions: { fx: [{ do: 'set_var', var: 'score', value: 5 }] } });
    const saved = JSON.parse(store.get('gv.save.ui-test.1')).snapshot;
    m.key('Escape'); m.key('ArrowDown'); m.key('ArrowDown'); m.key('Enter');
    assert.match(m.text('.gv-slots'), /Slot 1/);
    m.key('Enter'); m.frame(1);
    assert.equal(m.rt.state.vars.score, undefined, 'loaded the slot');
    assert.ok(m.rt.state.frame <= saved.frame + 1);
  } finally { delete globalThis.localStorage; }
});

test('menu: results screen appears after the game ends and play again restarts', () => {
  const m = mount(doc({ title: false }), { primitives: P });
  m.frame(3);
  m.frame(1, { actions: { fx: [{ do: 'end_game', ending: 'good', outcome: 'won' }] } });
  m.frame(1); assert.equal(m.q('.gv-results'), null, 'a beat before the results');
  m.tick(1); m.frame(1);
  assert.equal(m.text('.gv-results h2'), 'Dawn Returns');
  assert.match(m.text('.gv-results'), /The lantern burns again/);
  m.key('Enter'); m.frame(1);
  assert.equal(m.rt.state.status, 'playing', 'restarted');
  assert.ok(m.rt.state.frame <= 2);
});

test('menu: state-neutral replay, bad configs, game instances', () => {
  const a = mount(doc({ title: false }), { primitives: P }); a.frame(4); a.key('Escape'); a.frame(3); a.key('Escape'); a.frame(2);
  const { rt } = compile(doc({ title: false }), { primitives: P }); run(rt, 6);
  assert.deepEqual(a.rt.snapshot(), rt.snapshot());
  const codes = w => { try { compile(doc(w), { primitives: P }); return []; } catch (e) { return e.errors.map(x => x.code); } };
  assert.ok(codes({ select: [{ id: 'a', action: 'x' }, { id: 'a', action: 'y' }] }).includes('ui_select_duplicate'));
  assert.ok(codes({ select: [{ id: 'a', kind: 'custom', action: 'x' }] }).includes('ui_select_empty'));
  assert.ok(codes({ select: [{ id: 'a' }] }).includes('param_missing'));
  assert.ok(codes({ slots: 99 }).includes('param_range'));
  const registry = new Registry(P), logic = buildLogic(registry, Logic);
  const list = gameInstances('graphics.ui.menu');
  assert.ok(list.length >= 3);
  for (const { file, doc: d } of list) assert.deepEqual(ownErrors(preflight(d, registry, logic).errors), [], file);
});
