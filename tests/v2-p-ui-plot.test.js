// UI against the real plot primitives (plot.dialogue, plot.quest, plot.journal):
// the agreed read contracts, end to end in the fake browser host.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, run, testSpace } from '../v2/kernel/testing.js';
import { PRIMITIVES } from '../v2/primitives/index.js';
import { journalModel } from '../v2/primitives/graphics/ui-journal.js';
import { hudModel } from '../v2/primitives/graphics/ui-hud.js';
import { mount } from './v2-p-ui-dom.js';
import { fx } from './v2-p-ui-fixtures.js';

const P = [...PRIMITIVES, testSpace, fx];
const doc = () => ({
  schema: 'gameverse.v2.game/0.2', id: 'ui-plot', title: 'Lantern Test', seed: 1,
  spaces: [{ id: 'w', use: 'engine.space.test', with: { size: [20, 10, 1] }, zones: [{ id: 'village', name: 'Village', rect: [0, 0, 10, 10] }, { id: 'woods', name: 'Woods', rect: [10, 0, 20, 10] }] }],
  plot: {
    characters: [{ id: 'mara', name: 'Mara', archetype: 'villager', home: 'village', at: [2, 1, 0], dialogue: [{ id: 'hello' }] }],
    dialogue: { hello: { speaker: 'mara', start: 'n1', nodes: {
      n1: { who: 'mara', say: 'You came.', next: 'n2' },
      n2: { who: 'mara', say: 'Find my lamp?', choices: [{ text: 'Of course.', next: 'yes', do: [{ do: 'start_quest', quest: 'lamp' }] }, { text: 'Not now.', next: 'no' }] },
      yes: { who: 'mara', say: 'Bless you.', end: true }, no: { who: 'mara', say: 'Another time.', end: true } } } },
    quests: [{ id: 'lamp', title: 'The Lost Lamp', kind: 'main', giver: 'mara', summary: 'Mara lost her lamp in the woods.', objectives: [{ id: 'go', kind: 'reach', zone: 'woods', text: 'Search the woods' }, { id: 'back', kind: 'talk', character: 'mara', text: 'Return to Mara' }] }],
    entries: [{ id: 'e_woods', title: 'The Woods', text: 'Old trees.', tag: 'lore', when: { zone: 'woods' } }],
  },
  content: { archetypes: [{ id: 'hero', kind: 'player', components: {} }, { id: 'villager', kind: 'npc', components: {} }] },
  player: { archetype: 'hero', space: 'w', at: [1, 1, 0] },
  systems: [{ use: 'gameplay.fixture.fx' }, { use: 'gameplay.inventory' }, { use: 'plot.character' }, { use: 'plot.dialogue', with: { lineSpeed: 0 } }, { use: 'plot.quest' }, { use: 'plot.journal' }],
  graphics: [{ use: 'graphics.ui.dialogue', with: { cps: 400 } }, { use: 'graphics.ui.hud' }, { use: 'graphics.ui.journal', with: { tabs: ['quests', 'lore', 'characters'] } }],
});

test('ui + plot: a real conversation, its choice, the quest it starts, HUD objective and journal', () => {
  const m = mount(doc(), { primitives: P });
  m.frame(1, { actions: { talk: 'mara' } });
  m.frame(20);
  assert.equal(m.text('.gv-dlg-name'), 'Mara');
  assert.equal(m.text('.gv-dlg-text span'), 'You came.');
  m.key('Enter'); m.frame(20);
  assert.equal(m.text('.gv-dlg-text span'), 'Find my lamp?');
  assert.equal(m.qa('.gv-choice').length, 2);
  m.key('1'); m.frame(20); // choice index 0 reaches plot.dialogue as { index: 0 }
  assert.equal(m.text('.gv-dlg-text span'), 'Bless you.');
  m.key('Enter'); m.frame(30);
  assert.ok(m.q('.gv-dialogue').classList.contains('gv-hide'), 'conversation over');
  assert.match(m.text('.gv-toasts'), /New quest[\s\S]*The Lost Lamp/);
  assert.equal(m.text('.gv-objective-title'), 'The Lost Lamp');
  assert.equal(m.text('.gv-objective-text'), 'Search the woods');
  const before = m.rt.snapshot();
  const j = journalModel(m.rt, m.checked.doc.graphics[2].with);
  assert.deepEqual(j.tabs[0].sections.map(s => s.id), ['tracked']);
  assert.deepEqual(j.tabs[2].sections[0].entries.map(e => e.title), ['Mara'], 'characters met through dialogue');
  assert.deepEqual(m.rt.snapshot(), before, 'UI reads of the real services do not write state');
  // Walk into the woods: the objective updates and the lore entry becomes known.
  m.frame(1, { actions: { fx: [{ do: 'teleport', zone: 'woods' }] } }); m.frame(2);
  assert.equal(m.text('.gv-objective-text'), 'Return to Mara');
  assert.deepEqual(journalModel(m.rt, m.checked.doc.graphics[2].with).tabs[1].sections.flatMap(s => s.entries.map(e => e.title)), ['The Woods']);
  const hud = hudModel(m.rt, m.checked.doc.graphics[1].with);
  assert.equal(hud.objective.text, 'Return to Mara');
});

test('ui + plot: browser run equals headless run for the same inputs', () => {
  const inputs = [{ actions: { fx: [{ do: 'start_dialogue', dialogue: 'hello', with: 'mara' }] } }, { actions: { choose: 'next' } }, { actions: { choose: { index: 1 } } }, { actions: { choose: 'next' } }, {}];
  const a = mount(doc(), { primitives: P });
  for (const i of inputs) a.frame(1, i);
  const { rt } = compile(doc(), { primitives: P });
  for (const i of inputs) rt.step(i);
  assert.deepEqual(a.rt.snapshot(), rt.snapshot());
  run(rt, 1);
});
