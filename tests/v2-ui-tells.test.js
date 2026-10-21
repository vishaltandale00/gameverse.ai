// What a person is told as the game's events fire (card.tells, declared by each event's owner, read by the UIs that tell
// it: graphics.ui.story's log). Registry-wide: every tell names an event its card provides, a section its card reads and
// the event field holding the entry id. Over every catalogue document whose host mounts the story UI (the templates and
// v2/games/*.json): played through the story UI's own choices (number keys), every told event that fires is in the log
// with its label and the title of the entry it names (a twin world looks one choice ahead so the walk reads on rather than
// ending the story).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TEMPLATES } from '../v2/templates/registry.js';
import { liveCatalogue } from '../v2/planner/catalog.js';
import { hostDocument } from '../v2/web/host-doc.js';
import { uiControls, loopVerbs } from '../v2/primitives/engine/runtime-lib-controls.js';
import { tellsOf, tellWords } from '../v2/primitives/graphics/ui-lib.js';
import { PRIMITIVES } from '../v2/primitives/index.js';
import { mount } from './v2-p-ui-dom.js';
import { compile } from '../v2/kernel/testing.js';

const { registry } = await liveCatalogue();

test('every card.tells entry names an event its card provides, a section it reads and the field holding the id', () => {
  const told = registry.cards().filter(c => c.tells);
  assert.ok(told.length > 0, 'the catalogue tells a person something');
  for (const c of told) for (const [event, t] of Object.entries(c.tells)) {
    assert.ok((c.provides?.events || []).includes(event), `${c.id}: tells '${event}', an event it does not provide`);
    assert.ok(typeof t.label === 'string' && t.label.trim(), `${c.id}.${event}: a label`);
    if (t.entry !== undefined) {
      assert.ok((c.reads || []).includes(t.entry.at), `${c.id}.${event}: its entry section '${t.entry.at}' is one the card reads`);
      assert.ok(typeof t.entry.by === 'string' && t.entry.by, `${c.id}.${event}: the event field holding the entry id`);
    }
    if (t.detail !== undefined) assert.ok(typeof t.detail === 'string' && t.detail && t.entry, `${c.id}.${event}: detail names a field of its entry`);
  }
});

const games = fs.readdirSync(new URL('../v2/games/', import.meta.url)).filter(f => f.endsWith('.json')).map(f => ({ id: `v2/games/${f}`, doc: JSON.parse(fs.readFileSync(new URL(`../v2/games/${f}`, import.meta.url), 'utf8')) }));
const told = [...TEMPLATES.map(t => ({ id: `template ${t.id}`, doc: t.doc })), ...games]
  .map(d => ({ ...d, host: hostDocument(d.doc, registry) }))
  .filter(d => d.host.graphics.some(g => g.use === 'graphics.ui.story') && tellsOf(d.host, registry).length)
  // Played through the story UI: some loop verb is not issued by another mounted UI (a battle's commands are its battle
  // screen's: ui-sources.js unownedOptions), so the walk below has story choices to take.
  .filter(d => { const owned = uiControls(d.host, registry).verbs; return loopVerbs(d.host, registry).some(v => !(owned.get(v) || []).some(u => u !== 'graphics.ui.story')); });

test('the story template is among the documents whose story log tells events', () => assert.ok(told.some(d => d.id === 'template story'), told.map(d => d.id).join(', ')));

for (const d of told) test(`${d.id}: every told event that fires while playing through the story UI is in its log`, () => {
  const tells = tellsOf(d.host, registry), fired = [];
  let seen = 0; const events = new Set();
  // A headless twin of the played world looks one choice ahead, so the walk does not end the story it is reading.
  const twin = compile(structuredClone(d.host), { primitives: PRIMITIVES }).rt;
  const ends = (snap, o) => { twin.restore(snap); twin.step({ actions: o.actions }); twin.step({}); return twin.state.status !== 'playing'; };
  for (let w = 0; w < 4; w++) {
    const m = mount(structuredClone(d.host), { primitives: PRIMITIVES, seed: 1 + w }), taken = new Map();
    m.rt.on('*', e => { const t = tells.find(x => x.event === e.name); if (t) fired.push({ t, e }); });
    // The log keeps its last lines only: what fired is checked after every choice.
    const check = () => {
      const log = [...m.qa('.gv-story .gv-log li')].map(li => li.textContent);
      for (const { t, e } of fired.splice(0)) { const words = tellWords(m.rt.doc, t, e); seen++; events.add(t.event); assert.ok(log.some(l => l.includes(words.label) && l.includes(words.title)), `${t.use} '${t.event}' fired; the log does not tell '${words.label}: ${words.title}'`); }
    };
    m.key('Enter'); m.frame(1); check();
    for (let i = 0; i < 160 && m.rt.state.status === 'playing'; i++) {
      // The choice taken least so far (ties: the walk's own order), so the walk reaches deep into the story.
      const shown = m.rt.availableOptions().slice(0, Math.min(9, m.qa('.gv-story .gv-choices .gv-btn').length)), snap = m.rt.snapshot();
      if (shown.length) {
        const k = shown.map((o, j) => [ends(snap, o) ? 1 : 0, taken.get(o.label) ?? 0, (j + w) % shown.length, j]).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])[0][3];
        taken.set(shown[k].label, (taken.get(shown[k].label) ?? 0) + 1);
        m.key(String(k + 1));
      }
      m.frame(2); check();
    }
  }
  // Every told event that fired is in the log (checked above). Declared tells need not all fire in every document (an
  // inventory's item tells in a game where the walk gains no item); the story template's walk must reach its tells.
  if (d.id === 'template story') assert.ok(seen > 0, 'a told event fired while playing');
  if (d.id === 'template story') assert.deepEqual([...events].sort(), ['clue_found', 'deduced', 'item_gained', 'journal_added', 'quest_started'], 'the walk reads the story deep enough to be told its conclusions');
});

test('every catalogue document with an investigation keeps its clues and conclusions in the journal a person opens', async () => {
  const { journalModel } = await import('../v2/primitives/graphics/ui-journal.js');
  const cases = [...TEMPLATES.map(t => ({ id: `template ${t.id}`, doc: t.doc })), ...games].filter(d => (d.doc.systems || []).some(s => s.use === 'plot.investigation'));
  assert.ok(cases.some(d => d.id === 'template story'), 'the story template investigates');
  for (const d of cases) {
    const host = hostDocument(d.doc, registry), j = host.graphics.find(g => g.use === 'graphics.ui.journal');
    assert.ok(j?.with?.tabs?.includes('clues'), `${d.id}: the journal has a clues tab`);
    const rt = compile(structuredClone(host), { primitives: PRIMITIVES }).rt, clue = d.doc.plot.clues[0], ded = d.doc.plot.deductions.find(x => !x.wrong) ?? d.doc.plot.deductions[0];
    for (const c of ded.clues) rt.run([{ do: 'add_clue', clue: c }]);
    rt.run([{ do: 'add_clue', clue: clue.id }, { do: 'deduce', deduction: ded.id }]);
    const tab = journalModel(rt, j.with).tabs.find(t => t.id === 'clues'), titles = tab.sections.flatMap(s => s.entries.map(e => e.title));
    assert.ok(titles.includes(clue.title) && titles.includes(ded.title), `${d.id}: the clues tab lists '${clue.title}' and '${ded.title}' (${titles.join(', ')})`);
  }
});
