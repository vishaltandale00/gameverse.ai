// Card hygiene for the runtime workstream: registered once, no vocabulary collisions in the full catalogue,
// every param documented, and every runtime instance in the example games within its params.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { catalogue } from '../v2/primitives/index.js';
import { checkFields } from '../v2/kernel/params.js';
import runtime from '../v2/primitives/engine/runtime.index.js';

const IDS = ['engine.blocks', 'engine.time', 'engine.weather', 'engine.zones', 'engine.spawner', 'engine.portal', 'engine.save', 'engine.stream', 'engine.input.actions', 'engine.input.motions',
  'engine.physics.body', 'engine.physics.character', 'engine.physics.rigid', 'engine.beat', 'engine.replay', 'engine.assist', 'engine.script.sandbox'];

test('runtime primitives are all registered in the full catalogue without vocabulary collisions', () => {
  const { registry } = catalogue();
  assert.deepEqual(runtime.map(p => p.id).sort(), [...IDS].sort());
  for (const id of IDS) assert.ok(registry.has(id), id);
});

test('every runtime param documents its effect or is self-describing, and cards list what they provide', () => {
  for (const p of runtime) {
    assert.ok(p.card.intent.length > 40, `${p.id} intent`);
    for (const [k, s] of Object.entries(p.card.params)) assert.ok(s.effect || s.type === 'boolean' || s.unit || s.options || s.fields || ['number', 'integer', 'ref', 'predicate', 'string'].includes(s.type), `${p.id}.${k} needs an effect`);
    assert.ok(Array.isArray(p.card.provides.events), `${p.id} provides.events`);
  }
});

test('every runtime instance in v2/games is within its card params', () => {
  let n = 0;
  for (const id of ['blockport', 'emberfall', 'hollow-lantern', 'quiet-manor']) {
    const g = JSON.parse(readFileSync(new URL(`../v2/games/${id}.json`, import.meta.url)));
    (g.systems || []).forEach((s, i) => {
      const p = runtime.find(x => x.id === s.use); if (!p) return;
      const errors = []; checkFields(p.card.params, s.with || {}, `${id}.systems[${i}].with`, errors); n++;
      assert.deepEqual(errors, [], `${id} systems[${i}] ${s.use}`);
    });
  }
  assert.equal(n, 31);
});
