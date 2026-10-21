// What a person sees never depends on the themed names the content forms write (ARCHITECTURE §1.2, §5: the model
// only names a template's entries; ids are code's). Over every template, mounted as the host mounts it
// (v2/web/host-doc.js) in a fake browser: renaming every entry of every named section (planner/templates.js
// namedSections) leaves what the renderers draw call for call identical, even when the new names are other entries'
// ids (so no word list over names can hide); and the themed names, never the ids behind them, are what the
// presentation primitives show. Also the card declarations the renderers read instead of words (card.presents).
import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES } from '../v2/templates/registry.js';
import { catalogue, PRIMITIVES } from '../v2/primitives/index.js';
import { hostDocument } from '../v2/web/host-doc.js';
import { namedSections } from '../v2/planner/templates.js';
import { ROLES } from '../v2/primitives/graphics/flat-art.js';
import { PROPS } from '../v2/art/props.js';
import { PRESETS } from '../v2/primitives/graphics/flat-vector.js';
import { mount } from './v2-p-ui-dom.js';

const { registry } = catalogue();
// Rasterize generated art as a browser does (flat-art.js svgImage), so the draw list names every image by its SVG:
// a look or prop chosen differently draws a different image.
const fnv = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h.toString(36); };
globalThis.Blob = class { constructor(parts) { this.text = parts.join(''); } };
URL.createObjectURL = b => `blob:${fnv(b.text)}`;
globalThis.Image = class { set src(v) { this._src = v; this.width = this.naturalWidth = 64; this.height = this.naturalHeight = 64; this.onload?.(); } get src() { return this._src; } };
const FRAMES = 60;
const titleCase = s => String(s).replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase());
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every canvas context under a node (v2-p-ui-dom.js records each call with its arguments, in order). */
const contexts = el => { const out = []; const walk = n => { for (const c of n.children) { if (c._ctx) out.push(c._ctx); walk(c); } }; walk(el); return out; };
const TEXT = new Set(['fillText', 'strokeText', 'measureText']);
/** The draw list: every canvas call with its arguments (text arguments left out: names may be drawn as text). */
const drawList = m => contexts(m.container).flatMap(c => c.calls.map(([k, ...a]) => (TEXT.has(k) ? k : `${k}(${a.map(x => (typeof x === 'number' ? Math.round(x * 100) / 100 : x && typeof x === 'object' ? (x._src || x.constructor?.name || 'obj') : String(x))).join(',')})`)));
const play = doc => { const m = mount(hostDocument(doc, registry), { primitives: PRIMITIVES, seed: 1 }); m.key('Enter'); m.frame(FRAMES); return m; };
const renamed = (doc, nameOf) => { const d = structuredClone(doc); let k = 0; for (const s of namedSections(d)) for (const e of s.entries) e.name = nameOf(e, k++); return d; };

// Names that would steer any word list: the ids of every named entry of every template.
const POOL = [...new Set(TEMPLATES.flatMap(t => namedSections(t.doc).flatMap(s => s.entries.map(e => e.id))))].sort();

for (const t of TEMPLATES) {
  test(`${t.id}: renaming every named entry, even to other entries' ids, leaves the draw list identical`, () => {
    const base = drawList(play(t.doc));
    assert.ok(base.length > 0, 'it draws');
    const other = drawList(play(renamed(t.doc, (e, k) => { let n = POOL[(k * 7 + 3) % POOL.length]; if (n === e.id) n = POOL[(k * 7 + 4) % POOL.length]; return titleCase(n); })));
    const at = base.findIndex((c, i) => c !== other[i]);
    assert.ok(at < 0 && base.length === other.length, `the draw list changed with the names at call ${at}: ${base[at]} vs ${other[at]}`);
  });

  test(`${t.id}: the presentation shows the themed names, never the ids behind them`, () => {
    const named = namedSections(t.doc).flatMap(s => s.entries.filter(e => typeof e.name === 'string' && e.name));
    const m = play(renamed(t.doc, (e, k) => `Zq${k.toString(36)}x`));
    // What this layer shows: the renderers' canvases and the HUD, battle, cards and scene-card DOM.
    const shown = [];
    for (const c of contexts(m.container)) for (const [k, s] of c.calls) if (k === 'fillText' || k === 'strokeText') shown.push(String(s));
    const walk = (n, inside) => { for (const c of n.childNodes) { if (c.data !== undefined) { if (inside && c.data.trim()) shown.push(c.data.trim()); } else walk(c, inside || /\bgv-(hud|battle-field|bmsg|enemies|hand|scene-card)\b/.test(c.className || '')); } };
    walk(m.container, false);
    // A block's declared label (content.blocks[].label: a 2048 tile's number) is display text the document gives, not an id.
    const labels = new Set((t.doc.content?.blocks || []).map(b => b.label).filter(l => l != null).map(String));
    for (const s of shown.filter(x => !labels.has(x))) for (const e of named) {
      // An entry's id, or the id of an entity spawned from it (`<id>_<n>`), raw or title-cased.
    const words = new RegExp(`(^|[^a-z0-9_])(${escape(e.id)}(_\\d+)?|${escape(titleCase(e.id))}( \\d+)?)([^a-z0-9_]|$)`, 'i');
      assert.ok(!words.test(s), `'${s}' shows the id '${e.id}' where its name '${e.name}' belongs`);
    }
  });
}

test('card.presents: every declared presentation names a role, a prop and a vector preset the renderers draw', () => {
  const props = new Set(Object.values(PROPS).flat());
  let n = 0;
  for (const c of registry.cards()) for (const [key, v] of Object.entries(c.presents || {})) {
    for (const p of Array.isArray(v) ? v : [v]) {
      n++;
      assert.ok(ROLES.includes(p.role), `${c.id} presents ${key} as role '${p.role}', not one of ${ROLES.join(', ')}`);
      if (p.prop !== undefined) assert.ok(props.has(p.prop), `${c.id} presents ${key} as prop '${p.prop}', which v2/art/props has not`);
      if (p.vector !== undefined) assert.ok(PRESETS.includes(p.vector), `${c.id} presents ${key} as vector '${p.vector}', not a preset`);
      if (p.when !== undefined) assert.ok(p.when && typeof p.when === 'object' && !Array.isArray(p.when), `${c.id} presents ${key}: when is a field map`);
    }
    const param = c.params?.[key];
    if (param) assert.ok(param.type === 'ref' && param.to === 'archetype', `${c.id} presents its param '${key}', which is not a ref to an archetype`);
  }
  assert.ok(n > 0);
});
