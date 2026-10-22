// What a person reads is display text the document declares, never an id (KERNEL_API §2 rt.options `text`, §6). Two
// properties over the catalogue, every document as the host mounts it (v2/web/host-doc.js):
// 1. Every option a mounted UI lists to a person carries a text of its own, written by the primitive that offers it with
//    the document's names (`label` is the solvers' unique key, ids allowed): a UI listing whole options
//    (card.controls.options: graphics.ui.story) lists them all; otherwise the options whose verbs a mounted UI issues
//    (card.controls.verbs: the battle screen, the card table) or the choices panel serves (graphics.ui.choices: the
//    choice verbs no other UI names). Over the templates and v2/games/*.json, along deterministic walks.
// 2. Nothing any UI or renderer shows a person (every text in the overlay, every text drawn on a canvas: choices, battle,
//    cards, HUD banners and toasts, minimap, map, journal, scene cards) is an id the document gives an entry (content
//    entries, zones, stages, sides, cards, entities spawned from them), over every template mounted in a fake browser
//    with every themed text (the display text the cards declare) rewritten so that none can contain an id, along a walk through its options as a person
//    picks them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TEMPLATES } from '../v2/templates/registry.js';
import { liveCatalogue } from '../v2/planner/catalog.js';
import { hostPreflight, controlledMaker } from '../v2/verify/controls.js';
import { uiControls, unclaimedChoices } from '../v2/primitives/engine/runtime-lib-controls.js';
import { applyOption } from '../v2/verify/drive.js';
import { PRIMITIVES } from '../v2/primitives/index.js';
import { hostDocument } from '../v2/web/host-doc.js';
import { textSections } from '../v2/planner/templates.js';
import { mount } from './v2-p-ui-dom.js';

const { registry, logic } = await liveCatalogue();
const games = fs.readdirSync(new URL('../v2/games/', import.meta.url)).filter(f => f.endsWith('.json')).map(f => ({ id: `v2/games/${f}`, doc: JSON.parse(fs.readFileSync(new URL(`../v2/games/${f}`, import.meta.url), 'utf8')) }));
const docs = [...TEMPLATES.map(t => ({ id: `template ${t.id}`, doc: t.doc })), ...games];
const WALKS = 6, STEPS = 120;

/** Whether a mounted UI lists an option to a person, from the UI cards' controls (one predicate per host document). */
function listedBy(doc) {
  const ui = uiControls(doc, registry);
  if (ui.options.length) return () => true;
  const verbs = new Set([...ui.verbs.keys(), ...(ui.choice.length ? unclaimedChoices(doc, registry) : [])]);
  return o => Object.keys(o.actions || {}).some(v => verbs.has(v));
}
const hosted = docs.map(d => ({ ...d, host: hostPreflight(d.doc, registry, logic) })).filter(d => d.host.ok);
const listing = hosted.filter(d => { const u = uiControls(d.host.doc, registry); return u.options.length || u.verbs.size || u.choice.length; });

test('the catalogue has documents whose options a UI lists to a person', () => {
  for (const id of ['template story', 'template board', 'template rts', 'template card-battle']) assert.ok(listing.some(d => d.id === id), `${id}: ${listing.map(d => d.id).join(', ')}`);
});

for (const d of listing) test(`${d.id}: every option a mounted UI lists carries its own text`, () => {
  const make = controlledMaker(d.host.doc, registry, logic), listed = listedBy(d.host.doc), missing = new Set();
  for (let w = 0; w < WALKS; w++) {
    const rt = make(1 + w);
    for (let i = 0; i < STEPS && rt.state.status === 'playing'; i++) {
      const options = rt.availableOptions().filter(listed);
      for (const o of options) { if (typeof o.text !== 'string' || !o.text.trim() || o.text === o.label) missing.add(o.label); }
      if (!options.length) { rt.step({}); continue; }
      applyOption(rt, options[(i * (w + 3) + w) % options.length]);
      rt.step({});
    }
  }
  assert.deepEqual([...missing], [], 'options a person is shown with no text of their own');
});

// ---------------------------------------------------------------------------------------------------------------
// 2. No id on screen.
const fnv = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h.toString(36); };
globalThis.Blob = class { constructor(parts) { this.text = parts.join(''); } };
URL.createObjectURL = b => `blob:${fnv(b.text)}`;
globalThis.Image = class { set src(v) { this._src = v; this.width = this.naturalWidth = 64; this.height = this.naturalHeight = 64; this.onload?.(); } get src() { return this._src; } };
const titleCase = s => String(s).replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase());
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const contexts = el => { const out = []; const walk = n => { for (const c of n.children) { if (c._ctx) out.push(c._ctx); walk(c); } }; walk(el); return out; };

/** Every id the document gives an entry: the `id` of every object in it (content, zones, stages, sides, cards...). */
function idsOf(doc) {
  const out = new Set();
  const walk = v => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') { if (typeof v.id === 'string') out.add(v.id); Object.values(v).forEach(walk); } };
  walk(doc.spaces); walk(doc.systems); walk(doc.content); walk(doc.plot); walk(doc.player);
  return out;
}
/**
 * The display text the document declares: every string it holds that is no id (names, titles, lines, prompts...),
 * longest first. Such a string shows what its author wrote, whatever words it shares with ids.
 */
function declaredText(doc, ids) {
  const out = new Set();
  const walk = (v, key) => { if (typeof v === 'string') { if (key !== 'id' && !ids.has(v) && /[A-Z\s]/.test(v)) out.add(v); } else if (Array.isArray(v)) v.forEach(x => walk(x, key)); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k); };
  walk(doc, null);
  return [...out].sort((a, b) => b.length - a.length);
}
/** What a person sees now: visible overlay text (hidden panels left out) and canvas text drawn since the last look. */
function shownText(m) {
  const out = [];
  const walk = n => { for (const c of n.childNodes) { if (c.data !== undefined) { if (c.data.trim()) out.push(c.data.trim()); } else if (!/\bgv-hide\b/.test(c.className || '') && !c.hidden) walk(c); } };
  walk(m.container);
  for (const c of contexts(m.container)) { for (const [k, s] of c.calls) if (k === 'fillText' || k === 'strokeText') out.push(String(s)); c.calls.length = 0; }
  return out;
}

for (const t of TEMPLATES) test(`${t.id}: nothing on screen is an id the document gives an entry`, () => {
  const doc = structuredClone(t.doc);
  let k = 0;
  // Every display text the cards declare on the document's entries (the text the content forms theme) is rewritten.
  for (const s of textSections(doc, registry)) {
    const v = s.at.split(/\.|\[(\d+)\]/).filter(Boolean).reduce((o, key) => o?.[key], doc);
    for (const e of s.entries) {
      const entry = Array.isArray(v) ? v.find(x => x?.id === e.id) : v?.[e.id];
      for (const t of e.slots) { const parent = t.path.slice(0, -1).reduce((o, key) => o[key], entry); parent[t.path[t.path.length - 1]] = `Zq${(k++).toString(36)}x`; }
    }
  }
  doc.title = 'Zqtitlex';
  // An all-digit id (a 2048 tile's) cannot be told from the numbers the HUD shows; a block's declared label is display text.
  const labels = new Set((doc.content?.blocks || []).map(b => b.label).filter(l => l != null).map(String));
  const all = idsOf(doc), prose = declaredText(doc, all);
  const ids = [...all].filter(id => !/^\d+$/.test(id) && id.length > 1);
  const undeclared = s => prose.reduce((x, p) => x.split(p).join(' '), s);
  const pattern = id => new RegExp(`(^|[^a-z0-9_])(${escape(id)}(_\\d+)?|${escape(titleCase(id))}( \\d+)?)([^a-z0-9_]|$)`, 'i');
  const tests = ids.map(id => [id, pattern(id)]);
  const m = mount(hostDocument(doc, registry), { primitives: PRIMITIVES, seed: 1 });
  m.key('Enter'); m.frame(30);
  const leaks = new Map();
  const look = () => {
    const entities = Object.keys(m.rt.state.entities).filter(id => !/^\d+$/.test(id) && id.length > 1 && !ids.includes(id)).map(id => [id, pattern(id)]);
    for (const s of shownText(m)) if (!labels.has(s)) { const rest = undeclared(s); for (const [id, re] of [...tests, ...entities]) if (re.test(rest) && !leaks.has(s)) leaks.set(s, id); }
  };
  look();
  for (let i = 0; i < 160 && m.rt.state.status === 'playing'; i++) {
    const options = m.rt.availableOptions().filter(o => o.actions && Object.keys(o.actions).length);
    if (options.length) m.view.act(options[(i * 7 + 3) % options.length].actions);
    m.frame(4);
    look();
  }
  assert.deepEqual([...leaks].map(([s, id]) => `'${s}' shows the id '${id}'`), [], 'text a person sees that is an id, not the display text declared for it');
});
