// Every registered kit honors the shared contract (v2/kits/KIT_CONTRACT.md), so the pipeline and the
// hosts can treat them alike. Kit-specific depth lives in each kit's own test file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { availableKits } from '../v2/kits/registry.js';
import { composeGame, composeRenderer, modsSchema } from '../v2/kits/mods/compose.js';

const kits = await availableKits();
const strict = (node, path = '$') => {
  if (node?.type === 'object') {
    assert.equal(node.additionalProperties, false, `${path}: additionalProperties must be false`);
    assert.deepEqual([...(node.required || [])].sort(), Object.keys(node.properties || {}).sort(), `${path}: every property must be required`);
    for (const [k, v] of Object.entries(node.properties || {})) strict(v, `${path}.${k}`);
  }
  if (node?.items) strict(node.items, `${path}[]`);
  for (const bad of ['oneOf', 'anyOf', 'minimum', 'maximum', 'minItems', 'maxItems']) assert.ok(!(bad in (node || {})), `${path}: ${bad} is not allowed in strict mode`);
};
const stubCanvas = () => new Proxy({}, { get: (t, k) => k === 'canvas' ? { width: 640, height: 480 } : k === 'measureText' ? () => ({ width: 40 }) : k === 'getTransform' ? () => ({ a: 1 }) : k === 'getImageData' ? () => ({ data: new Uint8ClampedArray(4) }) : k in t ? t[k] : (typeof k === 'string' && k.startsWith('create') ? () => ({ addColorStop() {} }) : () => {}), set: (t, k, v) => { t[k] = v; return true; } });

test('the registry loads every kit', () => assert.ok(kits.length >= 5, kits.map(k => k.id).join(', ')));

for (const { id, kit } of kits) {
  test(`${id}: contract shape, strict schema, idempotent validation`, () => {
    for (const key of ['id', 'name', 'version', 'summary', 'examples', 'content', 'validate', 'cast', 'createGame', 'createRenderer', 'verify']) assert.ok(kit[key] !== undefined, `missing ${key}`);
    assert.equal(kit.id, id);
    strict(kit.content.schema);
    if (kit.world) strict(modsSchema(kit), `${id}.mods`);
    const once = kit.validate(kit.content.sample);
    assert.ok(once.ok, JSON.stringify(once.errors?.slice(0, 3)));
    const twice = kit.validate(once.content);
    assert.ok(twice.ok, `validating normalized content must pass again: ${JSON.stringify(twice.errors?.slice(0, 3))}`);
    assert.deepEqual(twice.content, once.content, 'validation is idempotent');
  });
  test(`${id}: verify passes on the normalized sample; play and render are deterministic and safe`, () => {
    const content = kit.validate(kit.content.sample).content;
    const v = kit.verify(content, { seed: 1, budgetMs: 4000 });
    assert.ok(v.ok, JSON.stringify(v.problems?.slice(0, 3)));
    const { entities } = kit.cast(content);
    assert.ok(entities && Object.keys(entities).length, 'cast gives entities for the art painter');
    const play = () => {
      const game = composeGame(kit, content, { seed: 3 });
      const s = game.createState();
      const render = composeRenderer(kit, game, { art: {} }), ctx = stubCanvas();
      for (let i = 0; i < 300; i++) {
        game.step(s, { x: Math.sign(Math.sin(i / 17)), y: i % 90 < 10 ? 1 : 0, a: i % 23 === 0, b: i % 41 === 0 });
        assert.ok(['playing', 'won', 'lost'].includes(s.status));
        assert.ok(Array.isArray(s.events));
        if (i % 5 === 0) render(ctx, s, { cssWidth: 640, cssHeight: 480, dt: 1 / 60, events: s.events });
      }
      return JSON.stringify(s);
    };
    assert.equal(play(), play(), 'same seed and inputs give the same state');
  });
}
