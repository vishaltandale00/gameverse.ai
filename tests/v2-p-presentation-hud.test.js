// What a person plays toward is on screen: the quantity a loop's win reads and the quantity its lose reads (card.loop
// win/lose reads; the win's is planner/loop.js winQuantity, the one the gate measures), as the end declares a person
// watches it (end.shown, end.once). Derived for the HUD by graphics/ui-defaults.js hudGoals, never from a list of
// primitives; displayed by the HUD or by another mounted UI whose card declares it displays it (card.displays).
import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES } from '../v2/templates/registry.js';
import { catalogue, PRIMITIVES } from '../v2/primitives/index.js';
import { hostDocument } from '../v2/web/host-doc.js';
import { cardLoop, readsOf, winQuantity, loopInstances, endsGame } from '../v2/planner/loop.js';
import { hudGoals } from '../v2/primitives/graphics/ui-defaults.js';
import { hudModel } from '../v2/primitives/graphics/ui-hud.js';
import { mount } from './v2-p-ui-dom.js';

const { registry } = catalogue();

test('every loop end reading an event says how a person watches it: counted by its when, shown, or once', () => {
  let n = 0;
  for (const card of registry.cards()) {
    const l = cardLoop(card); if (!l) continue;
    for (const [side, e] of [['win', l.win], ['lose', l.lose]]) {
      const r = readsOf(e); if (!r?.event) continue;
      n++;
      assert.ok(e.once === true || e.shown !== undefined || e.when, `${card.id} ${side} reads the event '${r.event}' and declares neither a when count, end.shown nor end.once`);
    }
  }
  assert.ok(n > 10);
});

const covered = (doc, g) => (doc.graphics || []).some(x => (registry.get(x.use)?.card?.displays || []).some(d => (d.component && d.component === g.component && (d.of ?? g.of) === g.of) || (d.var && d.var === g.var) || (d.count && d.count === g.count)));

for (const t of TEMPLATES) {
  test(`${t.id}: the quantities its win and lose read are on screen`, () => {
    const host = hostDocument(t.doc, registry), goals = hudGoals(t.doc, registry);
    // Derived from the loop ends: one goal per game-ending end that is not `once`; the win's is winQuantity's read
    // unless its end declares what a person watches instead.
    const loops = loopInstances(t.doc, registry), win = winQuantity(t.doc, registry), owner = win && loops.find(l => l.use === win.use);
    if (owner && !owner.loop.win.once && !owner.loop.win.shown) {
      const g = goals.find(x => x.end === 'win');
      assert.ok(g && (g.var === win.var || (win.event && g.count?.split(':')[0] === win.event) || g.component === win.component), `the win goal ${JSON.stringify(g)} is the quantity the win reads ${JSON.stringify(win)}`);
    }
    for (const l of loops) if (l.loop.lose && endsGame(l.loop.lose) && readsOf(l.loop.lose) && !l.loop.lose.once && !l.loop.lose.shown)
      assert.ok(goals.some(g => g.end === 'lose' && (g.use === l.use || (g.component && g.component === readsOf(l.loop.lose).component && g.of === (readsOf(l.loop.lose).of || 'opponents')))), `${l.use}'s lose (${JSON.stringify(readsOf(l.loop.lose))}) has a goal`);
    // Displayed: by another mounted UI's declared displays, else by the HUD, which shows it once play runs.
    const hud = host.graphics.find(g => g.use === 'graphics.ui.hud');
    const onHud = goals.filter(g => !covered(host, g));
    for (const g of onHud) assert.ok(hud?.with?.goals?.some(x => JSON.stringify([x.var, x.count, x.component, x.of, x.bar]) === JSON.stringify([g.var, g.count, g.component, g.of, g.bar])), `the HUD carries ${JSON.stringify(g)}`);
    if (!onHud.length) return;
    const m = mount(host, { primitives: PRIMITIVES, seed: 1 }); m.key('Enter'); m.frame(90);
    const cfg = m.checked.doc.graphics.find(g => g.use === 'graphics.ui.hud').with;
    const vm = hudModel(m.rt, cfg, {});
    for (const g of vm.goals) assert.ok(g.shown, `${JSON.stringify(g)} is not shown after 90 frames`);
    // And the HUD a person sees has a visible widget for each (readouts, meters, counters, lives, the boss bar's slot).
    const visible = m.qa('.gv-hud .gv-readout, .gv-hud .gv-meter, .gv-hud .gv-counter, .gv-hud .gv-lives, .gv-hud .gv-scoreboard').filter(n => { for (let x = n; x; x = x.parentNode) if (x.hidden) return false; return true; });
    assert.ok(visible.length > 0, 'the HUD shows its widgets');
  });
}
