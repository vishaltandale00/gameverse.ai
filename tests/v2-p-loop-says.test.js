// A game tells a person what to do. Every loop end a card declares says, in words, what a person plays toward or
// against (card.loop / card.mode win and lose `says`, kernel/loop.js), and labels the quantity a person watches for it
// (`label`, or each `shown` entry's); a wrapper declares each part's goal kind the same way (card.mode.parts). The host
// derives from those declarations alone (graphics/ui-defaults.js): the objective (objectiveOf: the how-to-play panel's
// Goal line, graphics/ui-menu.js) and the HUD goals (hudGoals: label and target), never from words in ids.
//   cards      every card of the live catalogue that declares a win or a lose passes kernel/loop.js endTextProblems;
//   documents  over every template's host document and every composed nested and union pair
//              (tests/v2-catalogue-documents.js), the objective exists, says nothing where a declaration is missing, and
//              holds no id-like token; every HUD goal has a label free of them and its target where the win declares one;
//   falling    the falling-blocks host document says its first stage's line target and shows 'Lines 0/<target>', and a
//              standalone falling well won by clearing 10 lines says 'Clear 10 lines' and shows 'Lines 0/10'.
import test from 'node:test';
import assert from 'node:assert/strict';
import { liveCatalogue } from '../v2/planner/catalog.js';
import { cardLoop, endTextProblems, ID_LIKE } from '../v2/kernel/loop.js';
import { TEMPLATES, templateById } from '../v2/templates/registry.js';
import { hostDocument } from '../v2/web/host-doc.js';
import { hudGoals, objectiveOf } from '../v2/primitives/graphics/ui-defaults.js';
import { hudModel } from '../v2/primitives/graphics/ui-hud.js';
import { PRIMITIVES } from '../v2/primitives/index.js';
import { catalogueDocuments } from './v2-catalogue-documents.js';
import { mount } from './v2-p-ui-dom.js';

const cat = await liveCatalogue();
const { registry } = cat;

test('cards: every win and lose says what a person reads and labels what a person watches, with no id in it', () => {
  const ends = registry.cards().filter(c => cardLoop(c)?.win || cardLoop(c)?.lose);
  assert.ok(ends.length >= 31, `the catalogue's loop ends (${ends.length})`);
  const problems = ends.flatMap(c => endTextProblems(c));
  assert.deepEqual(problems, []);
});

test('cards: a card missing its says or its label, or saying an id, fails the check', () => {
  const card = { id: 'gameplay.test.quiet', intent: 'x', params: { laps: { type: 'integer', default: 3 } }, loop: { verbs: [], progress: [], win: { param: 'onWin', reads: { var: 'quiet.count' } }, lose: { param: 'onLose', says: 'Avoid quiet.count', label: 'Count', reads: { var: 'quiet.count' } } } };
  const p = endTextProblems(card);
  assert.ok(p.some(m => /win: declares no says/.test(m)), p.join('; '));
  assert.ok(p.some(m => /win: declares no label/.test(m)), p.join('; '));
  assert.ok(p.some(m => /lose\.says: .*id-like/.test(m)), p.join('; '));
  assert.ok(endTextProblems({ ...card, loop: { ...card.loop, win: { ...card.loop.win, says: 'Finish {target} rounds', label: 'Rounds' } } }).some(m => /'\{target\}' names nothing/.test(m)));
  assert.deepEqual(endTextProblems({ ...card, loop: { ...card.loop, win: { ...card.loop.win, says: 'Finish {laps} laps', label: 'Laps' }, lose: { ...card.loop.lose, says: "Don't stop" } } }), []);
});

/** The id-like tokens in a text a person reads (none expected). */
const idLike = t => typeof t !== 'string' || !t.trim() || ID_LIKE.test(t) || /[{}]/.test(t);
/** Does the loop end a HUD goal shows declare a target (a won ending's `$target`, or a shown max)? */
const declaresTarget = g => {
  if (Array.isArray(g.labels)) return true; // a wrapper's part goal: the part's target var
  const e = cardLoop(registry.get(g.use)?.card)?.[g.end];
  const shown = e?.shown === undefined ? [] : [e.shown].flat();
  return Boolean(e && ((e.shown === undefined && e.when && Object.values(e.when).includes('$target')) || shown.some(q => q && q.max !== undefined && (q.var === g.var || q.count === g.count))));
};

const DOCS = catalogueDocuments(cat);
test('documents: the composed documents are many (every template and every composed pair)', () => assert.ok(DOCS.length > TEMPLATES.length, `${DOCS.length} documents`));
for (const { label, doc } of DOCS) {
  test(`${label}: the objective is said in words and every HUD goal is labelled, with its target`, () => {
    const host = hostDocument(doc, registry);
    const o = objectiveOf(host, registry);
    assert.deepEqual(o.missing, [], 'every end says what it should');
    assert.ok(o.win.length > 0, `a way to win is said (${o.text})`);
    for (const t of [...o.win, ...o.lose, o.text]) assert.ok(!idLike(t), `'${t}' is a sentence a person reads, not an id`);
    for (const g of hudGoals(host, registry)) {
      const labels = Array.isArray(g.labels) ? g.labels.filter(Boolean) : [g.label];
      assert.ok(labels.length > 0, `${JSON.stringify(g)} has a label`);
      for (const l of labels) assert.ok(!idLike(l), `${JSON.stringify(g)}: label '${l}' is a person's word`);
      if (g.end === 'win' && declaresTarget(g)) assert.ok(typeof g.max === 'number' || typeof g.maxVar === 'string', `${JSON.stringify(g)} shows its target`);
    }
  });
}

/** The HUD readouts and the title screen's goal line of a mounted host document after `frames` frames of play. */
function screen(host, frames = 60) {
  const m = mount(host, { primitives: PRIMITIVES, seed: 1 });
  const goal = m.text('.gv-controls .gv-goal');
  m.key('Enter'); m.frame(frames);
  const cfg = m.checked.doc.graphics.find(g => g.use === 'graphics.ui.hud').with;
  const vm = hudModel(m.rt, cfg, {});
  const dom = m.qa('.gv-hud .gv-readout').map(n => n.textContent.replace(/\s+/g, ''));
  return { m, goal, vm, dom };
}

test('falling-blocks: the first screen says the stage\'s line target and the HUD shows lines toward it', () => {
  const t = templateById('falling-blocks'), first = t.doc.systems.find(s => s.use === 'gameplay.stage.sequence').with.stages[0].goal.target;
  const host = hostDocument(t.doc, registry), o = objectiveOf(host, registry);
  assert.equal(o.win[0], `Clear ${first} lines`);
  assert.ok(o.win.includes('Clear all 4 stages'), o.text);
  assert.deepEqual(o.lose, ["Don't let the stack reach the top"]);
  // The stage in play decides the goal said: the second stage asks for its own target.
  const second = t.doc.systems.find(s => s.use === 'gameplay.stage.sequence').with.stages[1].goal.target;
  assert.equal(objectiveOf(host, registry, { 'stage.index': 1 }).win[0], `Clear ${second} lines`);
  const { goal, vm, dom } = screen(host);
  assert.ok(goal?.includes(`Clear ${first} lines`), `the how-to-play panel's goal line: ${goal}`);
  const lines = vm.readouts.find(r => r.label === 'Lines');
  assert.equal(lines?.text, `0/${first}`, JSON.stringify(vm.readouts));
  assert.ok(dom.includes(`Lines0/${first}`), JSON.stringify(dom));
  assert.ok(dom.includes('Stage1/4'), JSON.stringify(dom));
  assert.ok(!vm.readouts.some(r => r.label === 'Moves'), 'no move count where the stage sets no move limit');
});

test('falling: a well won by clearing 10 lines says "Clear 10 lines" and shows "Lines 0/10"', () => {
  const t = templateById('falling-blocks');
  const doc = structuredClone(t.doc);
  doc.systems = [...doc.systems.filter(s => s.use !== 'gameplay.stage.sequence'), { use: 'plot.ending', with: {} }];
  doc.plot = { endings: [{ id: 'cleared', title: 'Cleared', outcome: 'won', when: { var: 'falling.lines', gte: 10 } }] };
  const host = hostDocument(doc, registry), o = objectiveOf(host, registry);
  assert.deepEqual(o.win, ['Clear 10 lines']);
  const { goal, vm, dom } = screen(host);
  assert.ok(goal?.includes('Clear 10 lines'), `the how-to-play panel's goal line: ${goal}`);
  assert.equal(vm.readouts.find(r => r.label === 'Lines')?.text, '0/10', JSON.stringify(vm.readouts));
  assert.ok(dom.includes('Lines0/10'), JSON.stringify(dom));
});
