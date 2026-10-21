// Controls (ARCHITECTURE.md §6.3): every player verb a loop declares is issuable through a control a person has, from
// declarations only, over the live catalogue (controls_missing otherwise); the headless input driver turns intents
// into the device state a person produces and samples it exactly as the browser does; touch covers every key verb.
import test from 'node:test';
import assert from 'node:assert/strict';
import { liveCatalogue } from '../v2/planner/catalog.js';
import { TEMPLATES } from '../v2/templates/registry.js';
import { hostDocument } from '../v2/web/host-doc.js';
import { controlsOf, controlledMaker, hostPreflight, ControlsMissing } from '../v2/verify/controls.js';
import { verbControl, verbInstances, loopVerbs } from '../v2/primitives/engine/runtime-lib-controls.js';
import { compile, sample } from '../v2/primitives/engine/runtime-lib-input.js';
import { touchButtons } from '../v2/primitives/engine/input-actions.js';
import { cardLoop } from '../v2/planner/loop.js';
import { INTERACTIONS } from '../v2/primitives/gameplay/modes-lib-mode.js';

const { registry, logic } = await liveCatalogue();
const ANY = ['side', 'td', '3p', '1p', 'iso', 'board'];

/**
 * The verbs of `verbs` no control serving `interaction` issues in a host document: a key (engine.input.actions, whose
 * card serves the interaction) bound to the verb (every value of a closed set; its axis sources for an axis), or a
 * mounted UI primitive whose card.controls issues it and whose card.interactions include the interaction.
 */
export function uncontrolled(host, verbs, interaction) {
  const c = controlsOf(host, registry), inst = verbInstances(host), out = [];
  const inputServes = (registry.get('engine.input.actions').card.interactions || []).includes(interaction);
  for (const verb of verbs) {
    const kind = verbControl(registry, inst, verb);
    const keyed = inputServes && (kind.kind === 'axis' ? (c.map?.axes?.[verb] || []).length > 0
      : kind.kind === 'values' ? kind.options.every(o => Object.values(c.map?.buttons || {}).some(l => l.some(b => b.verb === verb && JSON.stringify(b.value) === JSON.stringify(o))))
        : kind.kind === 'press' ? Object.values(c.map?.buttons || {}).some(l => l.some(b => b.verb === verb && b.value === true)) : false);
    const ui = c.uiFor(verb);
    const byUi = Boolean(ui) && (registry.get(ui).card.interactions || []).includes(interaction);
    if (!keyed && !byUi) out.push(`${verb} (${kind.kind})`);
  }
  return out;
}

test('controls conformance: every loop card × interaction × view: each of its verbs has a control (controls_missing otherwise)', () => {
  const failures = [];
  let checked = 0;
  for (const card of registry.cards()) {
    const loop = cardLoop(card);
    if (!loop?.verbs.length) continue;
    const views = (card.views || ['any']).includes('any') ? ANY : card.views.filter(v => ANY.includes(v));
    for (const interaction of loop.interactions.length ? loop.interactions : INTERACTIONS) for (const view of views.length ? views : ANY) {
      const host = hostDocument({ schema: 'gameverse.v2.game/0.2', id: 'c', title: 'c', views: { primary: view }, spaces: [], systems: [{ use: card.id, with: {} }] }, registry);
      const missing = uncontrolled(host, loop.verbs, interaction);
      checked++;
      if (missing.length) failures.push(`controls_missing: ${card.id} × ${interaction} × ${view}: ${missing.join(', ')}`);
    }
  }
  assert.ok(checked > 100, `checked ${checked} card × interaction × view combinations`);
  assert.deepEqual(failures, []);
});

test('controls conformance: every template, as the host mounts it, gives a control for every verb its loops declare', () => {
  for (const t of TEMPLATES) {
    const host = hostDocument(t.doc, registry), verbs = loopVerbs(host, registry);
    const interactions = [...new Set(verbInstances(host).flatMap(i => cardLoop(registry.get(i.use)?.card)?.interactions || []))];
    for (const i of interactions.length ? interactions : ['avatar-realtime']) assert.deepEqual(uncontrolled(host, verbs, i), [], `${t.id} × ${i}`);
    assert.ok(hostPreflight(t.doc, registry, logic).ok, `${t.id}: the host document preflights`);
  }
});

test('controls: the farm binds till, plant, water and harvest; movement stays on the arrows and WASD', () => {
  const host = hostDocument(TEMPLATES.find(t => t.id === 'farm').doc, registry), c = controlsOf(host, registry);
  for (const v of ['till', 'plant', 'water', 'harvest']) assert.ok(c.map.keys[v]?.length, `${v} has a key`);
  assert.deepEqual(c.map.axes.move, ['arrows', 'wasd', 'dpad', 'lstick']);
  for (const v of ['till', 'plant', 'water', 'harvest']) for (const k of c.map.keys[v]) assert.ok(!['w', 'a', 's', 'd', 'up', 'down', 'left', 'right'].includes(k), `${v}: ${k} is not a movement key`);
});

test('controls driver: intents become the keys a person presses, sampled as the browser samples them; the rest throws', () => {
  const t = TEMPLATES.find(x => x.id === 'farm'), r = hostPreflight(t.doc, registry, logic), rt = controlledMaker(r.doc, registry, logic)(1);
  const c = rt.controls.controls, w = r.doc.systems.find(s => s.use === 'engine.input.actions').with;
  const viaBrowser = (down, pressed) => sample(compile(w.bindings, new Set(w.axes))[c.view], { down: new Set(down), pressed: new Set(pressed), mouse: { dx: 0, dy: 0 }, wheel: 0, sticks: { lstick: [0, 0], rstick: [0, 0] } }, { dt: rt.dt });
  const key = rt.controls.keysFor('till')[0];
  assert.deepEqual(rt.controls.input({ actions: { till: true } }), viaBrowser([key], [key]));
  assert.deepEqual(rt.controls.input({ axes: { move: [1, 0] } }), viaBrowser(['right'], []));
  assert.throws(() => rt.controls.input({ actions: { swap: { a: [0, 0], b: [0, 1] } } }), e => e instanceof ControlsMissing && e.code === 'controls_missing');
  assert.throws(() => rt.step({ actions: { till: { cell: [3, 3] } } }), ControlsMissing, 'a value no key sends and no UI issues');
  assert.deepEqual(rt.controls.missing({ actions: { plant: true }, axes: { move: [0, -1] } }), []);
});

test('controls driver: a choice verb goes through the UI primitive the host mounts for it, as player.js merges view.act', () => {
  const t = TEMPLATES.find(x => x.id === 'tactics'), r = hostPreflight(t.doc, registry, logic), rt = controlledMaker(r.doc, registry, logic)(1);
  assert.ok(r.doc.graphics.some(g => g.use === 'graphics.ui.choices'), 'the choices control is mounted for turn_move and select_unit');
  assert.equal(rt.controls.controls.uiFor('turn_move'), 'graphics.ui.choices');
  assert.equal(rt.controls.controls.uiFor('turn_act'), 'graphics.ui.battle');
  const v = { unit: 'rifleman_1', to: [5, 2] };
  assert.deepEqual(rt.controls.input({ actions: { turn_move: v } }).actions, { turn_move: v });
});

test('touch: every verb a key issues has an on-screen button (no cut-off), one per value of a closed set', () => {
  for (const t of TEMPLATES) {
    const host = hostDocument(t.doc, registry, { touch: true }), c = controlsOf(host, registry);
    const buttons = touchButtons(c.map);
    for (const verb of Object.keys(c.map?.keys || {})) if (!c.map.axes[verb]) assert.ok(buttons.some(b => b.verb === verb), `${t.id}: ${verb} has a touch button`);
    for (const [verb, values] of Object.entries(c.map?.values || {})) for (const v of Object.keys(values)) assert.ok(buttons.some(b => b.verb === verb && String(b.value) === v), `${t.id}: ${verb}=${v}`);
  }
});
