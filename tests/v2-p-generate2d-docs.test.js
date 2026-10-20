import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { checkFields } from '../v2/kernel/params.js';
import { preflight } from '../v2/kernel/document.js';
import { catalogue } from '../v2/primitives/index.js';
import generators from '../v2/primitives/engine/generate2d.index.js';

const IDS = new Set(generators.map(g => g.id));
const games = readdirSync(new URL('../v2/games/', import.meta.url)).filter(f => f.endsWith('.json')).map(f => ({ f, doc: JSON.parse(readFileSync(new URL(`../v2/games/${f}`, import.meta.url))) }));
const mine = doc => (doc.spaces || []).flatMap((s, i) => (s.generators || []).map((g, j) => ({ g, s, path: `spaces[${i}].generators[${j}]` })).filter(x => IDS.has(x.g.use)));

test('generate2d: every generator is registered with a card the planner can read', () => {
  const { registry, logic } = catalogue();
  for (const g of generators) {
    const p = registry.get(g.id);
    assert.ok(p, g.id);
    assert.ok(p.card.intent && p.card.params && p.card.requires.capabilities?.includes('position'), g.id);
    assert.ok(p.card.provides.services.includes('generation') && p.card.provides.events.includes('generated:*'), g.id);
    assert.ok(Array.isArray(p.card.problems) && p.card.problems.length, `${g.id} documents its problem codes`);
  }
  assert.ok(logic.effects.has('open_lock'));
});

test('generate2d: every instance in v2/games preflights with zero param errors', () => {
  const { registry, logic } = catalogue();
  let n = 0;
  for (const { f, doc } of games) for (const { g, s, path } of mine(doc)) {
    n++;
    const card = registry.get(g.use).card, errors = [];
    checkFields(card.params, g.with || {}, `${path}.with`, errors, null);
    assert.deepEqual(errors, [], `${f} ${path}`);
    const config = checkFields(card.params, g.with || {}, '', [], null);
    assert.deepEqual(registry.get(g.use).validate?.(config, doc, { checkPredicate() {}, checkEffect() {} }, { path, space: s.id, use: g.use }) || [], [], `${f} ${path} validate`);
    // The full preflight reports nothing against these instances either (other workstreams' errors are theirs).
    // Not ours: a space primitive that is not registered yet (provides nothing) and gate predicates whose
    // owning primitive (e.g. `ability`) has not landed in the catalogue yet.
    const pre = preflight(doc, registry, logic), spaceMissing = !registry.get(s.use);
    const ours = pre.errors.filter(e => e.path?.startsWith(path) && !(spaceMissing && e.code === 'capability_missing') && e.code !== 'predicate_unknown');
    assert.deepEqual(ours, [], `${f} ${path} preflight`);
  }
  assert.ok(n >= 2, 'the example games use the generators');
});
