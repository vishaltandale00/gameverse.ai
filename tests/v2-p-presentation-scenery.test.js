// The look of a world is a checked choice among declared options, never a default (ARCHITECTURE §1: no defaults
// standing in for decisions). The space cards the 2D renderers paint declare `scenery` (engine/spaces2d-scenery.js: the
// scenery themes v2/art/scenery.js paints, cosmetic, no default); every template sets it and tunes it, so the frame_tune
// form offers exactly those values (template contract: look_undeclared, look_untuned). Over every template, mounted as
// the host mounts it (v2/web/host-doc.js) in a fake browser: each declared value draws its own look, and a space that
// declares none draws a look no declared value draws (nothing stands in for the choice).
import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES } from '../v2/templates/registry.js';
import { catalogue, PRIMITIVES } from '../v2/primitives/index.js';
import { hostDocument } from '../v2/web/host-doc.js';
import { frameTuneForm } from '../v2/planner/templates.js';
import { buildLogic } from '../v2/kernel/world.js';
import { Logic } from '../v2/kernel/logic.js';
import { THEMES } from '../v2/art/scenery.js';
import { SCENERY_PARAM } from '../v2/primitives/engine/spaces2d-scenery.js';
import { mount } from './v2-p-ui-dom.js';

const { registry } = catalogue();
const logic = buildLogic(registry, Logic);
const fnv = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h.toString(36); };
globalThis.Blob = class { constructor(parts) { this.text = parts.join(''); } };
URL.createObjectURL = b => `blob:${fnv(b.text)}`;
globalThis.Image = class { set src(v) { this._src = v; this.width = this.naturalWidth = 64; this.height = this.naturalHeight = 64; this.onload?.(); } get src() { return this._src; } };
const contexts = el => { const out = []; const walk = n => { for (const c of n.children) { if (c._ctx) out.push(c._ctx); walk(c); } }; walk(el); return out; };
/** What the renderers' canvases drew in the first frames (calls with their arguments, images by their content). */
const drawn = doc => { const m = mount(hostDocument(doc, registry), { primitives: PRIMITIVES, seed: 1 }); m.frame(3); return contexts(m.container).flatMap(c => c.calls.map(([k, ...a]) => `${k}(${a.map(x => (x && typeof x === 'object' ? (x._src || 'obj') : String(x))).join(',')})`)).join('\n'); };
const withLook = (doc, i, value) => { const d = structuredClone(doc); d.spaces[i].with = { ...(d.spaces[i].with || {}) }; if (value === undefined) delete d.spaces[i].with.scenery; else d.spaces[i].with.scenery = value; return d; };

test('scenery: the space cards the 2D renderers paint declare the closed set of scenery themes, cosmetic, with no default', () => {
  assert.deepEqual([...SCENERY_PARAM.options], THEMES);
  assert.equal(SCENERY_PARAM.default, undefined, 'no default stands in for the choice');
  const spaces = new Set(TEMPLATES.flatMap(t => t.doc.spaces.map(s => s.use)));
  for (const use of spaces) assert.equal(registry.get(use).card.params?.scenery, SCENERY_PARAM, `${use} declares scenery`);
});

for (const t of TEMPLATES) {
  test(`${t.id}: the frame_tune form offers exactly the declared looks; each draws its own, and none declared draws none of them`, () => {
    const i = t.doc.spaces.findIndex(s => registry.get(s.use).card.params?.scenery);
    assert.ok(i >= 0 && THEMES.includes(t.doc.spaces[i].with?.scenery), 'the template sets its look');
    const slot = frameTuneForm(t, t.doc, { registry, logic }).slots.find(s => s.path === `${t.doc.spaces[i].use}.scenery`);
    assert.ok(slot, 'the frame_tune form asks for the look');
    assert.deepEqual(slot.schema.enum ?? slot.schema.anyOf?.find(x => x.enum)?.enum, THEMES, 'the form offers the declared looks');
    const none = drawn(withLook(t.doc, i, undefined)), looks = new Map(THEMES.map(v => [v, drawn(withLook(t.doc, i, v))]));
    for (const [v, d] of looks) assert.notEqual(d, none, `scenery '${v}' draws what an undeclared look draws: a default stands in for it`);
    assert.ok(new Set(looks.values()).size > 1, 'the declared looks are drawn differently');
  });
}
