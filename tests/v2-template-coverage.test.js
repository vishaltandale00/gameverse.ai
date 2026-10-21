// Catalogue conformance of the templates (ARCHITECTURE.md §5, §6.2): templates are the fast path, so every loop a
// card declares (card.mode) is carried by a template in v2/templates, except wrapper modes (mode.wraps: they sequence
// another loop) and the loops listed in PENDING. PENDING only shrinks: a pending loop that gains a template must leave
// it, and a new card.mode needs a template or an explicit entry here. The pick offers every template, each once, under
// a concept line of its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES } from '../v2/templates/index.js';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { modesIn } from '../v2/primitives/gameplay/modes-lib-mode.js';
import { pickForm, pickSystem, offeredTemplates, templateLoops } from '../v2/planner/templates.js';

const { registry } = buildCatalogue();

/** Loops a card declares (card.mode.loop) that no template carries yet. Remove an entry when its template lands. */
const PENDING = new Set([
  'card-battle', 'creature-battle', 'falling-blocks', 'launcher', 'match-board', 'versus', 'rts', 'slide-merge',
  'ball-sport', 'tactics', 'story',
]);

const modeCards = registry.cards().filter(c => c.mode);
/** Every loop the registry's cards declare as their own (wrappers excluded): loop id -> card ids. */
const declared = new Map();
for (const c of modeCards.filter(c => !c.mode.wraps)) declared.set(String(c.mode.loop), [...(declared.get(String(c.mode.loop)) ?? []), c.id]);
/** Every loop a template carries (its document's card.mode that applies, wrappers excluded): loop id -> template ids. */
const carried = new Map();
for (const t of TEMPLATES) for (const m of modesIn(t.doc, registry).filter(m => !m.mode.wraps)) carried.set(String(m.mode.loop), [...new Set([...(carried.get(String(m.mode.loop)) ?? []), t.id])]);

test('every card.mode loop is carried by a template, or is a wrapper, or is listed PENDING', () => {
  assert.ok(declared.size > 0, 'the catalogue declares loops');
  const uncovered = [...declared].filter(([loop]) => !carried.has(loop) && !PENDING.has(loop)).map(([loop, cards]) => `${loop} (${cards.join(', ')})`);
  assert.deepEqual(uncovered, [], 'a loop no template carries: add its template to v2/templates, or list it in PENDING');
});

test('PENDING only shrinks: no pending loop has a template, and every pending loop is still declared by a card', () => {
  const landed = [...PENDING].filter(loop => carried.has(loop)).map(loop => `${loop} (carried by ${carried.get(loop).join(', ')})`);
  assert.deepEqual(landed, [], 'a pending loop has a template now: remove it from PENDING');
  assert.deepEqual([...PENDING].filter(loop => !declared.has(loop)), [], 'a pending loop no card declares');
  const wrappers = modeCards.filter(c => c.mode.wraps).map(c => String(c.mode.loop));
  assert.deepEqual([...PENDING].filter(loop => wrappers.includes(loop)), [], 'wrapper modes are never pending: they need no template');
});

test('every template carries a loop of its own, and only loops its cards declare', () => {
  for (const t of TEMPLATES) {
    const { loops } = templateLoops(t, registry);
    assert.ok(loops.length, `${t.id}: a card.mode loop`);
    for (const l of loops) assert.ok(declared.has(l.loop), `${t.id}: loop '${l.loop}' is declared by a card`);
  }
});

test('templates: unique ids, unique concept lines, every one offered by the pick form and listed in its prompt', () => {
  const ids = TEMPLATES.map(t => t.id), concepts = TEMPLATES.map(t => t.concept.trim().toLowerCase());
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], 'template ids are unique');
  assert.deepEqual(concepts.filter((c, i) => concepts.indexOf(c) !== i), [], 'concept lines are unique');
  for (const t of TEMPLATES) assert.ok(/\S/.test(t.concept), `${t.id}: a concept line`);
  const offered = offeredTemplates(TEMPLATES, registry);
  assert.deepEqual(offered.map(t => t.id), ids, 'every template composes in this catalogue');
  const p = pickForm(offered).schema.properties;
  for (const at of [p.primary.properties.template, p.games.items.properties.template]) assert.deepEqual(at.enum, [...ids, 'none']);
  const system = pickSystem(offered, registry);
  for (const t of TEMPLATES) assert.equal(system.split('\n').filter(l => l.startsWith(`- ${t.id}: `) && l.includes(t.concept)).length, 1, `${t.id}: listed once with its concept line`);
});
