// Choice verbs (ARCHITECTURE.md §6.3, KERNEL_API.md §2 solver conventions): every loop verb whose value is chosen
// declares where its values come from (card.actionSpace[verb].from 'options', or selects a field another choice
// picks) and what choosing one produces (emits), and over the live catalogue:
//   - the declarations are well formed (choiceDeclarationProblems) on every card;
//   - for every such verb of every loop card, a minimal document using it (a template whose instance has the verb, or
//     tests/v2-choice-fixtures.js) offers at least one value through the declared provider;
//   - the headless input driver issues that value through the controls a person has, and it fires one of the verb's
//     declared events (more or sooner than not choosing it);
//   - where graphics.ui.choices is the verb's control, the panel lists the value (paging on when the list is long) and
//     clicking it fires the same events.
import test from 'node:test';
import assert from 'node:assert/strict';
import { liveCatalogue } from '../v2/planner/catalog.js';
import { TEMPLATES } from '../v2/templates/registry.js';
import { hostPreflight, controlledMaker } from '../v2/verify/controls.js';
import { createWorld, KERNEL_EVENTS } from '../v2/kernel/world.js';
import { choiceDeclarationProblems, choiceValues, instanceVerbs, verbInstances, actionSpaceOf, specControl } from '../v2/primitives/engine/runtime-lib-controls.js';
import { panelRows, pageOf, picksOf, servedVerbs, groupNameOf } from '../v2/primitives/graphics/ui-choices.js';
import { createDocument } from './v2-p-ui-dom.js';
import { FIXTURES } from './v2-choice-fixtures.js';

const { registry, logic } = await liveCatalogue();
const CHOICES = 'graphics.ui.choices';

/** The loop verbs of a card whose value is chosen (whatever the instance). */
const choiceLoopVerbs = card => (Array.isArray(card?.loop?.verbs) ? card.loop.verbs : []).filter(v => { const s = actionSpaceOf(card, { with: {} })[v]; return s && specControl(v, s).kind === 'choice'; });
const emitsOf = (card, verb) => actionSpaceOf(card, { with: {} })[verb]?.emits || [];
const matches = (declared, name) => declared.some(d => d === name || (d.endsWith(':*') && name.startsWith(d.slice(0, -1))));
/** The declared events a run fired: { event: times }. */
const fired = (rt, before, emits) => Object.fromEntries(Object.entries(rt.state.counts).filter(([k, v]) => v > (before[k] || 0) && matches(emits, k)).map(([k, v]) => [k, v - (before[k] || 0)]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

test('choice declarations: every loop verb whose value is chosen declares its provider and the events it emits', () => {
  const problems = [];
  let verbs = 0;
  for (const card of registry.cards()) { verbs += choiceLoopVerbs(card).length; problems.push(...choiceDeclarationProblems(card, registry).map(p => `${p.code}: ${p.message}`)); }
  assert.ok(verbs > 40, `checked ${verbs} choice verbs`);
  assert.deepEqual(problems, []);
});

/** The documents a (card, verb) case can use: its fixture(s), then every template with an instance offering the verb. */
function candidates(card, verb) {
  const own = [FIXTURES[card.id]].flat().filter(Boolean).map((f, i) => ({ source: `fixture ${card.id}${i ? ` #${i + 1}` : ''}`, ...f }));
  const offers = doc => verbInstances(doc).some(inst => inst.use === card.id && instanceVerbs(card, inst, doc).includes(verb));
  return [...own, ...TEMPLATES.filter(t => offers(t.doc)).map(t => ({ source: `template ${t.id}`, doc: t.doc }))].filter(c => offers(c.doc));
}

/** Bring a world to the state the case checks: the fixture's spawns and setup, then the verbs it chooses first. */
function prepare(rt, c, verb, step) {
  for (const [archetype, at, id] of c.spawn || []) rt.spawn(archetype, { id, at: structuredClone(at), space: rt.doc.spaces[0].id });
  if (c.setup) rt.run(c.setup);
  step({});
  for (const v of c.choose?.[verb] || []) {
    const [first] = choiceValues(rt, v, 1);
    if (!first) return `the prerequisite '${v}' has no value`;
    step({ actions: first.actions });
    for (let i = 0; i < Math.max(30, first.steps || 0) && rt.state.status === 'playing'; i++) step({});
  }
  return null;
}
/** Idle until the verb has a value (at most two seconds: intros and countdowns). -> the frames idled, or -1. */
function reach(rt, verb, step) {
  for (let i = 0; i <= 120 && rt.state.status === 'playing'; i++) { if (choiceValues(rt, verb, 1).length) return i; step({}); }
  return -1;
}
const framesFor = value => Math.max(120, (value.steps || 0) + 30);

/** The events a document's primitives declare (card.provides.events, loop progress) and the kernel's. */
const declaredEvents = doc => [...KERNEL_EVENTS, ...[...new Set(verbInstances(doc).map(i => i.use))].flatMap(id => { const c = registry.get(id)?.card; return [...(c?.provides?.events || []), ...(c?.loop?.progress || [])]; })];
/** Events a world fired that no primitive of its document declares (what no UI can know to show). */
const undeclared = rt => { const d = declaredEvents(rt.doc); return Object.keys(rt.state.counts).filter(k => !matches(d, k)); };

/** One case through the controls: -> { ok, why?, value?, frames? } */
function viaControls(card, verb, c, make) {
  const rt = make(c.doc.seed ?? 1), step = i => rt.step(i);
  const pre = prepare(rt, c, verb, step); if (pre) return { ok: false, why: pre };
  const idled = reach(rt, verb, step);
  if (idled < 0) return { ok: false, why: 'its provider offers no value' };
  const [value] = choiceValues(rt, verb, 1), snap = rt.snapshot(), n = framesFor(value), emits = emitsOf(card, verb);
  const run = first => { rt.restore(snap); const c0 = { ...rt.state.counts }; for (let i = 0; i < n && rt.state.status === 'playing'; i++) rt.step(i === 0 ? first : {}); return fired(rt, c0, emits); };
  let chosen;
  try { chosen = run({ actions: value.actions }); } catch (error) { return { ok: false, why: `the controls cannot issue ${JSON.stringify(value.actions)}: ${error.message}` }; }
  const loose = undeclared(rt);
  if (loose.length) return { ok: false, why: `it fired events no primitive of the document declares: ${loose.join(', ')}` };
  const idle = run({});
  const more = Object.keys(chosen).filter(k => chosen[k] > (idle[k] || 0));
  return more.length ? { ok: true, value, idled } : { ok: false, why: `choosing ${JSON.stringify(value.actions)} fired none of ${JSON.stringify(emits)} beyond idling` };
}

/** The same case through the mounted graphics.ui.choices panel: find the value's button (opening its group, paging on), click it. */
function viaPanel(card, verb, c, host, idled) {
  const dom = createDocument(), container = dom.createElement('div'); dom.body.append(container);
  globalThis.document = dom;
  const frames = [], pending = [];
  const view = { container, THREE: null, act: a => pending.push(a), onFrame: fn => frames.push(fn), input: null, now: () => 0 };
  const doc = { ...host, graphics: (host.graphics || []).filter(g => g.use === CHOICES) };
  const rt = createWorld(doc, registry, logic, { seed: c.doc.seed ?? 1, headless: false, view });
  const paint = () => { for (const fn of frames) fn(1); };
  const step = input => { const a = pending.shift() || {}; rt.step({ ...input, actions: { ...(input.actions || {}), ...a } }); paint(); };
  paint();
  const pre = prepare(rt, c, verb, step); if (pre) return { ok: false, why: pre };
  for (let i = 0; i < idled; i++) step({});
  const served = servedVerbs(doc, registry), { pick } = picksOf(doc, registry, served);
  const want = choiceValues(rt, verb, 1)[0]; if (!want) return { ok: false, why: 'no value in the mounted world' };
  const buttons = () => container.querySelectorAll('.gv-choice-panel .gv-btn');
  // The rows on screen, as the panel builds them: open the value's group first, then page until its row shows.
  const nameOf = groupNameOf(rt), rows = panelRows(rt.availableOptions(), served, pick, null, { nameOf });
  const target = rows.find(r => r.kind === 'option' && r.actions?.[verb] !== undefined) ?? rows.find(r => r.kind === 'group' && (same(want.actions[verb], r.value) || panelRows(rt.availableOptions(), served, pick, r.group, { nameOf }).some(x => x.actions?.[verb] !== undefined)));
  if (!target) return { ok: false, why: 'the panel lists no row for it' };
  const click = text => { for (let k = 0; k < 20; k++) { const b = buttons().find(x => x.textContent.endsWith(text)); if (b) { b.click(); paint(); return true; } const more = buttons().find(x => x.textContent.includes('More ›')); if (!more) return false; more.click(); paint(); } return false; };
  if (!click(target.text)) return { ok: false, why: `no button '${target.text}' on any page` };
  if (target.kind === 'group' && !pending.some(a => a[verb] !== undefined)) {
    const inner = panelRows(rt.availableOptions(), served, pick, target.group, { nameOf }).find(r => r.kind === 'option' && r.actions?.[verb] !== undefined);
    if (!inner || !click(inner.text)) return { ok: false, why: `group '${target.group}' shows no button for it` };
  }
  if (!pending.some(a => a[verb] !== undefined)) return { ok: false, why: 'clicking sent no value for it' };
  const c0 = { ...rt.state.counts }, emits = emitsOf(card, verb);
  for (let i = 0; i < framesFor(want) && rt.state.status === 'playing'; i++) step({});
  const got = fired(rt, c0, emits);
  return Object.keys(got).length ? { ok: true } : { ok: false, why: `clicking fired none of ${JSON.stringify(emits)}` };
}

test('choice providers: every choice verb of every loop card offers a value in a minimal document, issued through the controls and the choices panel', () => {
  const failures = [], passed = [];
  const hosts = new Map();
  for (const card of registry.cards()) for (const verb of choiceLoopVerbs(card)) {
    const cands = candidates(card, verb);
    if (!cands.length) { failures.push(`${card.id}.${verb}: no minimal document uses it (add one to tests/v2-choice-fixtures.js)`); continue; }
    const tried = [];
    let ok = false;
    for (const c of cands) {
      if (!hosts.has(c.doc)) { const h = hostPreflight(c.doc, registry, logic); hosts.set(c.doc, h.ok ? { doc: h.doc, make: controlledMaker(h.doc, registry, logic) } : { errors: h.errors }); }
      const h = hosts.get(c.doc);
      if (!h.doc) { tried.push(`${c.source}: host document does not preflight ${JSON.stringify(h.errors.slice(0, 2))}`); continue; }
      const r = viaControls(card, verb, c, h.make);
      if (!r.ok) { tried.push(`${c.source}: ${r.why}`); continue; }
      const ui = h.make(1).controls.controls.uiFor(verb);
      if (!ui) { tried.push(`${c.source}: no UI issues it`); continue; }
      if (ui === CHOICES) { const p = viaPanel(card, verb, c, h.doc, r.idled); if (!p.ok) { tried.push(`${c.source}: panel: ${p.why}`); continue; } }
      ok = true; passed.push(`${card.id}.${verb} (${c.source}, ${ui})`); break;
    }
    if (!ok) failures.push(`${card.id}.${verb}: ${tried.join(' | ')}`);
  }
  assert.ok(passed.length + failures.length > 40, `checked ${passed.length + failures.length} choice verbs`);
  assert.deepEqual(failures, []);
});

test('choices panel: rows beyond the panel size page on; the last button is More', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ text: `r${i}`, kind: 'option' }));
  const p0 = pageOf(rows, 0, 9), p2 = pageOf(rows, 2, 9), wrap = pageOf(rows, 3, 9);
  assert.equal(p0.rows.length, 9); assert.equal(p0.rows[8].kind, 'more'); assert.equal(p0.pages, 3);
  assert.deepEqual(p2.rows.slice(0, -1).map(r => r.text), ['r16', 'r17', 'r18', 'r19']);
  assert.equal(wrap.page, 0, 'More on the last page wraps to the first');
  assert.equal(pageOf(rows.slice(0, 9), 0, 9).rows.length, 9, 'rows that fit show without More');
});
