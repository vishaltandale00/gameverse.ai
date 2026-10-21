// The typed boundary: preflight takes `unknown` (model replies, stored versions, request bodies) and is the only
// way such data becomes a Doc. Malformed containers are stable errors, never crashes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogue } from '../v2/primitives/index.js';
import { preflight, provided } from '../v2/kernel/document.js';

const { registry, logic } = catalogue();
const base = () => ({ schema: 'gameverse.v2.game/0.2', id: 'b', title: 'B', spaces: [{ id: 'world', use: 'engine.space.graph', zones: [{ id: 'a' }] }] });

test('preflight rejects malformed containers with schema errors instead of throwing', () => {
  const cases = [
    [null, '$'], [[], '$'], ['doc', '$'],
    [{ ...base(), spaces: 'world' }, 'spaces'],
    [{ ...base(), systems: [null] }, 'systems[0]'],
    [{ ...base(), systems: [{ use: 'gameplay.score', with: 'x' }] }, 'systems[0].with'],
    [{ ...base(), spaces: [{ id: 'world', use: 'engine.space.graph', zones: [3] }] }, 'spaces[0].zones[0]'],
    [{ ...base(), spaces: [{ id: 'world', use: 'engine.space.graph', generators: {} }] }, 'spaces[0].generators'],
    [{ ...base(), plot: { storyboard: { acts: [{ id: 'a', beats: 'x' }] } } }, 'plot.storyboard.acts[0].beats'],
    [{ ...base(), plot: 'story' }, 'plot'],
    [{ ...base(), content: { items: 'sword' } }, 'content.items'],
  ];
  for (const [input, path] of cases) {
    const r = preflight(input, registry, logic);
    assert.equal(r.ok, false, path);
    assert.equal(r.doc, null);
    assert.ok(r.errors.some(e => e.code === 'schema' && e.path === path), `${path}: ${JSON.stringify(r.errors)}`);
  }
});

test('a valid document still preflights, and ok implies a doc', () => {
  const r = preflight(base(), registry, logic);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.ok(r.doc && r.doc.spaces[0].id === 'world');
});

test('provided() takes unknown event refs: a non-string is never provided', () => {
  const set = new Set(['hit', 'defeated:*']);
  assert.equal(provided(set, 'defeated:boss'), true);
  assert.equal(provided(set, { count: 'hit' }), false);
  assert.equal(provided(set, 3), false);
});
