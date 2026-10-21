// What a person reads for a choice (KERNEL_API §2 rt.options `text`): a UI that lists the game's options to a person
// (a UI primitive whose card.controls has `options: true`, graphics.ui.story) shows each option's `text`, written by the
// primitive that offers it with the document's names; `label` is the solvers' unique key (ids such as
// 'choose keeper_talk.k1.0'). Over every catalogue document that mounts such a UI (the templates and v2/games/*.json, as
// the host mounts them): every option offered along a deterministic walk through its options carries a text of its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TEMPLATES } from '../v2/templates/registry.js';
import { liveCatalogue } from '../v2/planner/catalog.js';
import { hostPreflight, controlledMaker } from '../v2/verify/controls.js';
import { uiControls } from '../v2/primitives/engine/runtime-lib-controls.js';
import { applyOption } from '../v2/verify/drive.js';

const { registry, logic } = await liveCatalogue();
const games = fs.readdirSync(new URL('../v2/games/', import.meta.url)).filter(f => f.endsWith('.json')).map(f => ({ id: `v2/games/${f}`, doc: JSON.parse(fs.readFileSync(new URL(`../v2/games/${f}`, import.meta.url), 'utf8')) }));
const docs = [...TEMPLATES.map(t => ({ id: `template ${t.id}`, doc: t.doc })), ...games];
const WALKS = 6, STEPS = 120;

const listed = docs.map(d => ({ ...d, host: hostPreflight(d.doc, registry, logic) })).filter(d => d.host.ok && uiControls(d.host.doc, registry).options.length);

test('the catalogue has documents whose options a UI lists to a person', () => assert.ok(listed.some(d => d.id === 'template story'), listed.map(d => d.id).join(', ')));

for (const d of listed) test(`${d.id}: every option the ${uiControls(d.host.doc, registry).options.join(', ')} lists carries its own text`, () => {
  const make = controlledMaker(d.host.doc, registry, logic), missing = new Set();
  let seen = 0;
  for (let w = 0; w < WALKS; w++) {
    const rt = make(1 + w);
    for (let i = 0; i < STEPS && rt.state.status === 'playing'; i++) {
      const options = rt.availableOptions();
      for (const o of options) { seen++; if (typeof o.text !== 'string' || !o.text.trim() || o.text === o.label) missing.add(o.label); }
      if (!options.length) { rt.step({}); continue; }
      applyOption(rt, options[(i * (w + 3) + w) % options.length]);
      rt.step({});
    }
  }
  assert.ok(seen > 0, 'the walk was offered options');
  assert.deepEqual([...missing], [], 'options a person is shown with no text of their own');
});
