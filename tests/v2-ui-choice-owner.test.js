// One list per choice on screen: when a UI that lists the game's options is mounted (card.controls.options:
// graphics.ui.story), the choices panel (graphics.ui.choices) does not list those options again, so a number key picks
// one thing (in a story, '1' for the first place had picked the panel's first character). Over every catalogue document
// whose host mounts both (the templates and v2/games/*.json): no option is on both lists, and, where no other UI names
// choice verbs of its own, pressing 1 takes the options UI's first choice.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TEMPLATES } from '../v2/templates/registry.js';
import { liveCatalogue } from '../v2/planner/catalog.js';
import { hostDocument } from '../v2/web/host-doc.js';
import { PRIMITIVES } from '../v2/primitives/index.js';
import { mount } from './v2-p-ui-dom.js';
import { uiControls } from '../v2/primitives/engine/runtime-lib-controls.js';

const { registry } = await liveCatalogue();
const games = fs.readdirSync(new URL('../v2/games/', import.meta.url)).filter(f => f.endsWith('.json')).map(f => ({ id: `v2/games/${f}`, doc: JSON.parse(fs.readFileSync(new URL(`../v2/games/${f}`, import.meta.url), 'utf8')) }));
const both = [...TEMPLATES.map(t => ({ id: `template ${t.id}`, doc: t.doc })), ...games].map(d => ({ ...d, host: hostDocument(d.doc, registry) }))
  .filter(d => ['graphics.ui.story', 'graphics.ui.choices'].every(u => d.host.graphics.some(g => g.use === u)));

test('the story template mounts the story list and the choices panel', () => assert.ok(both.some(d => d.id === 'template story'), both.map(d => d.id).join(', ')));

for (const d of both) test(`${d.id}: no option is listed twice, and 1 takes the story list's first choice`, () => {
  const m = mount(structuredClone(d.host), { primitives: PRIMITIVES, seed: 1 });
  // A UI naming verbs of its own (a battle menu, a hand of cards) takes the number keys for them: while one of the offered
  // options uses such a verb, only the two option lists are compared.
  const named = new Set(uiControls(d.host, registry).verbs.keys());
  let checked = 0;
  m.key('Enter'); m.frame(2);
  for (let i = 0; i < 12 && m.rt.state.status === 'playing'; i++) {
    const story = [...m.qa('.gv-story .gv-choices .gv-btn')].map(b => b.textContent.replace(/^\d+/, ''));
    const panel = [...m.qa('.gv-choice-panel:not(.gv-hide) .gv-btn')].map(b => b.textContent.replace(/^\d+\.\s/, ''));
    assert.deepEqual(panel.filter(t => story.includes(t)), [], `${d.id}: listed on both`);
    const offered = m.rt.availableOptions(), first = offered[0];
    if (!first || offered.some(o => Object.keys(o.actions || {}).some(v => named.has(v)))) { m.frame(2); continue; }
    checked++;
    m.key('1'); m.frame(1);
    assert.deepEqual(m.acts.at(-1), first.actions, `${d.id}: 1 sent the story list's first choice`);
    m.frame(1);
  }
  if (d.id === 'template story') assert.ok(checked > 0, 'the number keys were checked on the story');
});
