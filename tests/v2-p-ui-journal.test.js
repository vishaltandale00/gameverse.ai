import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, run } from '../v2/kernel/testing.js';
import { preflight } from '../v2/kernel/document.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import journal, { journalModel } from '../v2/primitives/graphics/ui-journal.js';
import { mount } from './v2-p-ui-dom.js';
import { baseDoc, BASE, gameInstances, ownErrors } from './v2-p-ui-fixtures.js';

// A quest/journal fixture speaking plot.quest / plot.journal's predicates, state kept in a store.
const plotFix = {
  id: 'plot.fixture.quests',
  card: { intent: 'Fixture quest and journal state.', provides: { actions: ['track_quest'] }, reads: ['plot.quests', 'plot.entries'] },
  logic(logic) {
    const st = rt => rt.store('fixture.quests');
    logic.predicate('quest', { test: (p, rt) => (st(rt).q?.[p.quest] || 'locked') === p.state });
    logic.predicate('objective', { test: (p, rt) => (st(rt).o?.[`${p.quest}.${p.objective}`] || 'inactive') === p.state });
    logic.predicate('known', { test: (p, rt) => Boolean(st(rt).known?.[p.known]) });
    logic.effect('set_q', { run: (e, rt) => { const s = st(rt); (s.q ??= {})[e.quest] = e.state; for (const [k, v] of Object.entries(e.objectives || {})) (s.o ??= {})[`${e.quest}.${k}`] = v; } });
    logic.effect('learn', { run: (e, rt) => { (st(rt).known ??= {})[e.entry] = true; } });
  },
  install(rt) { rt.action('track_quest', id => { rt.state.vars['quests.tracked'] = id; }); },
};
const plot = {
  characters: [{ id: 'mara', name: 'Mara', role: 'smith; old friend', bio: 'Keeps the forge.' }],
  quests: [
    { id: 'q_main', title: 'Light the Beacon', kind: 'main', giver: 'mara', zone: 'caves', summary: 'Climb and light it.', objectives: [{ id: 'a', text: 'Talk to Mara' }, { id: 'b', text: 'Find oil' }, { id: 'h', text: 'Secret', hidden: true }], rewards: { xp: 50, items: [{ item: 'oil', count: 2 }] } },
    { id: 'q_side', title: 'Lost Cat', kind: 'side', objectives: [{ id: 'a', text: 'Find the cat' }] },
    { id: 'q_done', title: 'First Steps', kind: 'side', objectives: [{ id: 'a', text: 'Walk' }] },
  ],
  entries: [{ id: 'e1', title: 'The Old War', text: 'Long ago.', tag: 'lore' }, { id: 'e2', title: 'Unknown', text: 'Hidden.', tag: 'lore' }, { id: 'n1', title: 'Shopping list', text: 'Oil.', tag: 'note' }],
};
const content = { items: [{ id: 'oil', name: 'Lamp Oil', kind: 'material' }], archetypes: [{ id: 'hero', kind: 'player', components: {} }, { id: 'bat', kind: 'enemy', name: 'Cave Bat', components: { health: { max: 4 } } }, { id: 'ghoul', kind: 'enemy', components: {} }] };
const P = [...BASE, plotFix, journal];
const doc = (w = { tabs: ['quests', 'lore', 'bestiary', 'characters', 'notes'] }) => baseDoc({ plot, content, systems: [{ use: 'plot.fixture.quests' }], graphics: [{ use: 'graphics.ui.journal', with: w }] });
const progress = { actions: { fx: [
  { do: 'set_q', quest: 'q_main', state: 'active', objectives: { a: 'done', b: 'active' } }, { do: 'set_q', quest: 'q_side', state: 'available' },
  { do: 'set_q', quest: 'q_done', state: 'complete', objectives: { a: 'done' } }, { do: 'learn', entry: 'e1' }, { do: 'learn', entry: 'n1' },
  { do: 'emit', event: 'defeated:bat' }, { do: 'emit', event: 'talked:mara' }] } };

test('journal model: groups quests by state and shows only what is known', () => {
  const { rt, checked } = compile(doc(), { primitives: P });
  run(rt, 1, progress);
  const m = journalModel(rt, checked.doc.graphics[0].with);
  const tab = id => m.tabs.find(t => t.id === id);
  const q = tab('quests');
  assert.deepEqual(q.sections.map(s => [s.id, s.entries.map(e => e.title)]), [['tracked', ['Light the Beacon']], ['available', ['Lost Cat']], ['complete', ['First Steps']]]);
  assert.equal(q.badge, 1);
  const main = q.sections[0].entries[0].detail;
  assert.deepEqual(main.objectives.map(o => [o.text, o.state]), [['Talk to Mara', 'done'], ['Find oil', 'active']], 'hidden objectives stay hidden');
  assert.deepEqual(main.meta, ['From Mara', 'Echo Caves']);
  assert.deepEqual(main.rewards, ['50 XP', 'Lamp Oil ×2']);
  assert.deepEqual(tab('lore').sections.flatMap(s => s.entries.map(e => e.title)), ['The Old War']);
  assert.deepEqual(tab('notes').sections.flatMap(s => s.entries.map(e => e.title)), ['Shopping list']);
  assert.deepEqual(tab('bestiary').sections[0].entries.map(e => [e.title, e.sub]), [['Cave Bat', '×1']], 'only creatures met appear');
  assert.deepEqual(tab('characters').sections[0].entries.map(e => e.title), ['Mara']);
});

test('journal: opens with its hotkey, holds the sim, navigates tabs and tracks a quest via view.act', () => {
  const m = mount(doc(), { primitives: P });
  m.frame(1, progress); m.frame(1);
  m.key('j'); m.frame(1);
  assert.equal(m.view.modal, 'journal');
  assert.ok(m.q('[data-sheet=journal]') && !m.q('[data-sheet=journal]').classList.contains('gv-hide'));
  assert.equal(m.qa('.gv-tab').length, 5);
  assert.match(m.text('.gv-detail'), /Light the Beacon[\s\S]*Find oil/);
  const frame = m.rt.state.frame; m.frame(3); assert.equal(m.rt.state.frame, frame, 'simulation held while open');
  m.key('ArrowDown'); m.frame(1);
  assert.match(m.text('.gv-detail'), /Lost Cat/);
  m.key('ArrowUp'); m.key('Enter');
  assert.deepEqual(m.acts.at(-1), { track_quest: 'q_main' });
  m.key('r'); m.frame(1); // next tab
  assert.ok(m.q('.gv-tab.is-active').textContent.startsWith('Lore'));
  assert.match(m.text('.gv-detail'), /The Old War/);
  m.key('Escape'); m.frame(1);
  assert.equal(m.view.modal, null);
  m.frame(2); assert.ok(m.rt.state.frame > frame, 'simulation resumes on close');
});

test('journal: deterministic and state-neutral', () => {
  const a = mount(doc(), { primitives: P });
  a.frame(1, progress); a.key('j'); a.key('Escape'); a.frame(3);
  const { rt } = compile(doc(), { primitives: P });
  run(rt, 1, progress); run(rt, 3);
  assert.deepEqual(a.rt.snapshot(), rt.snapshot());
});

test('journal: rejects bad configs and accepts every game instance', () => {
  const codes = w => { try { compile(doc(w), { primitives: P }); return []; } catch (e) { return e.errors.map(x => x.code); } };
  assert.ok(codes({ tabs: ['quests', 'quests'] }).includes('ui_tab_duplicate'));
  assert.ok(codes({ tabs: ['recipes'] }).includes('param_option'));
  assert.ok(codes({ tabs: [] }).includes('param_range'));
  const registry = new Registry(P), logic = buildLogic(registry, Logic);
  const list = gameInstances('graphics.ui.journal');
  assert.ok(list.length >= 3);
  for (const { file, doc: d } of list) assert.deepEqual(ownErrors(preflight(d, registry, logic).errors), [], file);
});
