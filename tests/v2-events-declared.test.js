// Declared events (ARCHITECTURE.md §1.4: cards are the only source of truth): every event a primitive's own file emits by
// name (rt.emit / rt.emitTyped with a literal name) is one its card declares (card.provides.events, wildcards included,
// or card.loop.progress). An undeclared event is one no UI, check or composition can know to show or read: a refusal
// that never reaches the person, a request no listener is wired for. Over every primitive file of the live catalogue
// (files named after their primitive id, KERNEL_API.md §1; helper libraries emit on behalf of the cards that use them).
// Refusals: the events a card declares in card.denials are its own events, and the HUD tells the person why.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { liveCatalogue } from '../v2/planner/catalog.js';
import { createWorld } from '../v2/kernel/world.js';
import { hostPreflight } from '../v2/verify/controls.js';
import { denialProblems, declaredDenials } from '../v2/primitives/engine/runtime-lib-controls.js';
import { createDocument } from './v2-p-ui-dom.js';
import { FIXTURES } from './v2-choice-fixtures.js';
import { TEMPLATES } from '../v2/templates/registry.js';

const { registry, logic } = await liveCatalogue();
const root = new URL('../v2/primitives/', import.meta.url);
const matches = (declared, name) => declared.some(d => d === name || (d.endsWith(':*') && name.startsWith(d.slice(0, -1))));

test('declared events: every event a primitive file emits by name is declared on its card', () => {
  const problems = [];
  let files = 0;
  for (const family of fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)) {
    const dir = new URL(`${family}/`, root);
    for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.js') && !n.endsWith('.index.js'))) {
      const id = `${family === 'promoted' ? '' : `${family}.`}${f.replace(/\.js$/, '').replace(/-/g, '.')}`;
      const card = registry.get(id)?.card; if (!card) continue;
      files++;
      const src = fs.readFileSync(new URL(f, dir), 'utf8'), declared = [...(card.provides?.events || []), ...(card.loop?.progress || [])];
      const names = new Set([...src.matchAll(/\brt\.emit(?:Typed)?\('([a-z][a-z0-9_]*)'/g)].map(m => m[1]));
      for (const n of names) if (!matches(declared, n)) problems.push(`${id}: emits '${n}', which its card does not declare (card.provides.events)`);
    }
  }
  assert.ok(files > 150, `checked ${files} primitive files`);
  assert.deepEqual(problems, []);
});

test('denials: every event a card declares as a refusal is one of its events', () => {
  const problems = [], cards = registry.cards().filter(c => c.denials?.length);
  for (const c of registry.cards()) problems.push(...denialProblems(c).map(p => p.message));
  assert.ok(cards.length > 15, `${cards.length} cards declare denials`);
  assert.deepEqual(problems, []);
});

const tellsDenials = (doc) => (doc.graphics || []).filter(g => registry.get(g.use)?.card?.feedback?.denials).map(g => g.use);

test('denials: every document a person plays (templates, choice fixtures) mounts a UI that says why a press was refused', () => {
  const docs = [...TEMPLATES.map(t => [`template ${t.id}`, t.doc]), ...Object.entries(FIXTURES).flatMap(([id, f]) => [f].flat().map((x, i) => [`fixture ${id}#${i}`, x.doc]))];
  const missing = [];
  for (const [name, doc] of docs) {
    const host = hostPreflight(doc, registry, logic); assert.ok(host.ok, name);
    const denials = declaredDenials(host.doc, registry);
    if (denials.length && !tellsDenials(host.doc).length) missing.push(`${name}: declares ${denials.join(', ')} and mounts no UI with card.feedback.denials`);
  }
  assert.deepEqual(missing, []);
});

/** Mount the host document's refusal-telling UIs in a DOM stub, refuse a press, and read what they show. */
function refusalShown(fixture, press, event) {
  const host = hostPreflight(fixture.doc, registry, logic);
  const dom = createDocument(), container = dom.createElement('div'); dom.body.append(container); globalThis.document = dom;
  const frames = [], view = { container, THREE: null, act() {}, onFrame: fn => frames.push(fn), input: null, now: () => 0 };
  const uis = tellsDenials(host.doc);
  const rt = createWorld({ ...host.doc, graphics: host.doc.graphics.filter(g => uis.includes(g.use)) }, registry, logic, { seed: 1, headless: false, view });
  if (fixture.setup) rt.run(fixture.setup);
  rt.step({}); rt.step({ actions: press }); for (const fn of frames) fn(1);
  assert.ok(rt.state.counts[event] >= 1, `${event} fired`);
  return { uis, text: container.textContent };
}

test('denials: the mounted UI says why a press was refused (a toast in the HUD, a note in the choices panel)', () => {
  const shop = refusalShown(FIXTURES['gameplay.economy'], { buy: 'herb' }, 'trade_denied');
  assert.deepEqual(shop.uis, ['graphics.ui.choices']);
  assert.match(shop.text, /Trade denied/);
  const build = refusalShown(FIXTURES['gameplay.build.structure'], { build: { piece: 'tower', at: [8, 6, 0] } }, 'build_denied');
  assert.deepEqual(build.uis.sort(), ['graphics.ui.choices', 'graphics.ui.hud']);
  assert.equal(build.text.match(/Build denied:? ?Piece/g)?.length, 2, 'the HUD toast (kicker and reason) and the panel note');
});
