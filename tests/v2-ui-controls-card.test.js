// The title screen and the controls card of the document a person plays (ARCHITECTURE.md §6.3): graphics.ui.menu's
// title screen (title: true) holds the world until the confirm key dismisses it, and its controls card lists every
// verb the game's loops are played with (a key, or the UI panel that issues it), for every template as the host
// mounts it (v2/web/host-doc.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { liveCatalogue } from '../v2/planner/catalog.js';
import { TEMPLATES } from '../v2/templates/registry.js';
import { hostDocument } from '../v2/web/host-doc.js';
import { loopVerbs } from '../v2/primitives/engine/runtime-lib-controls.js';
import { controlRows } from '../v2/primitives/graphics/ui-menu.js';
import { MODAL_KEYS } from '../v2/primitives/graphics/ui-input.js';
import { PRIMITIVES } from '../v2/primitives/index.js';
import { mount } from './v2-p-ui-dom.js';

const { registry } = await liveCatalogue();
const KEY = { enter: 'Enter', space: ' ', z: 'z', e: 'e' };

for (const t of TEMPLATES) test(`template ${t.id}: the title holds the world until confirm, and its controls card lists every loop verb`, () => {
  const host = hostDocument(t.doc, registry);
  assert.ok(host.graphics.some(g => g.use === 'graphics.ui.menu' && (g.with?.title ?? true)), 'the host mounts the menu with its title screen');
  const verbs = loopVerbs(host, registry), rows = controlRows(host, id => registry.has(id), registry);
  for (const v of verbs) assert.ok(rows.some(r => r.verb === v && r.keys.length), `${t.id}: the controls card lists '${v}' (${JSON.stringify(rows.map(r => r.verb))})`);
  // The title screen of the host document, with its UI (no world renderer: the DOM stub draws no canvas).
  const ui = { ...host, graphics: host.graphics.filter(g => /^graphics\.ui\./.test(g.use)) };
  const m = mount(ui, { primitives: PRIMITIVES });
  assert.equal(m.view.modal, 'menu', 'the title screen is open');
  const cardText = [...m.qa('.gv-controls dt')].map(n => n.textContent);
  assert.equal(cardText.length, rows.length, 'the title\'s controls card shows every row');
  m.frame(5);
  assert.equal(m.rt.state.frame, 0, 'the world is held while the title is up');
  m.key(KEY[MODAL_KEYS.confirm[0]]); m.frame(1);
  assert.equal(m.q('.gv-title-screen'), null, 'the confirm key dismissed the title');
  // Play runs, unless a screen the game's own events open holds it (a fighting game's VS intro on match_start).
  const f = m.rt.state.frame; m.frame(3);
  if (m.rt.state.frame !== f + 3) assert.ok(m.rt.state.frame > 0 && m.q('.gv-vs, .gv-select'), `play ran after the title (frame ${m.rt.state.frame}) and only a screen play opened holds it now`);
});
