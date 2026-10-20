// Every capability a spaces2d space reports (including the new ones it documents under
// provides.capabilityMethods) is implemented, and shared methods agree across spaces.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, CAPABILITY_METHODS } from '../v2/kernel/testing.js';
import spaces2d from '../v2/primitives/engine/spaces2d.index.js';

const variants = {
  'engine.space.tilemap': [{}, { mode: 'topdown' }, { edges: { left: 'wrap', right: 'wrap', bottom: 'solid', top: 'solid' } }],
  'engine.space.grid': [{}, { topology: 'hex', wrap: 'x' }],
  'engine.space.physics2d': [{}, { edges: { left: 'wrap', right: 'wrap', bottom: 'solid', top: 'solid' } }],
  'engine.space.arena2d': [{}, { solids: [[0, 0, 4, 1]], scroll: { window: [8, 9], speed: 1 } }, { edges: { left: 'wrap', right: 'wrap', bottom: 'wrap', top: 'wrap' } }],
  'engine.space.track': [{}, { loop: true, length: 50 }],
  'engine.space.none': [{}],
};
const doc = (use, w) => ({ schema: 'gameverse.v2.game/0.2', id: 'caps', title: 'Caps', spaces: [{ id: 's', use, with: w }], content: { archetypes: [{ id: 'a', components: {} }] }, player: { archetype: 'a' } });

for (const p of spaces2d) test(`${p.id}: every reported capability is implemented in every configuration`, () => {
  const documented = p.card.provides.capabilityMethods || {};
  for (const w of variants[p.id]) {
    const { rt, checked } = compile(doc(p.id, w), { primitives: spaces2d });
    const api = rt.space('s'), caps = checked.capabilities.s;
    for (const cap of caps) {
      const methods = CAPABILITY_METHODS[cap] || documented[cap];
      assert.ok(methods, `${p.id} reports '${cap}' but documents no methods for it`);
      for (const m of methods) assert.equal(typeof api[m], 'function', `${p.id} ${JSON.stringify(w)} ${cap}.${m}`);
    }
    for (const cap of caps) assert.ok(p.card.provides.capabilities.includes(cap), `${cap} missing from card.provides.capabilities`);
    assert.equal(typeof api.anchor, 'string'); assert.equal(api.kind, p.id.split('.').pop());
  }
});

test('shared capability vocabularies mean the same thing across spaces', () => {
  const bounds = [];
  for (const p of spaces2d) for (const w of variants[p.id]) {
    const { rt, checked } = compile(doc(p.id, w), { primitives: spaces2d }), api = rt.space('s');
    if (checked.capabilities.s.includes('bounds')) { const b = api.bounds(); assert.ok(Array.isArray(b.min) && Array.isArray(b.max) && Array.isArray(b.wrap), p.id); assert.equal(api.inBounds(b.min), true, `${p.id} min corner is in bounds`); bounds.push(p.id); }
    if (checked.capabilities.s.includes('wrap')) { const at = api.bounds().max.map((v, i) => (api.bounds().wrap[i] ? v + 0.25 : 1)); const folded = api.wrapPos(at); assert.ok(api.distance(at, folded) < 1e-9, `${p.id} wrapPos keeps distance zero`); }
    if (checked.capabilities.s.includes('dynamics')) { const e = rt.player(); api.setVelocity(e, [1, 0, 0], rt); assert.equal(api.velocity(e)[0], 1, p.id); }
  }
  assert.ok(bounds.length >= 5);
});
