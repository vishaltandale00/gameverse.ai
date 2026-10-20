// Every instance of a combat-workstream primitive in v2/games/*.json preflights
// with zero errors on its own paths. Spaces and primitives from other
// workstreams may not be registered yet, so capability errors (the space is
// unknown) and effect/predicate kinds owned by other workstreams are filtered;
// every effect/predicate kind registered by combat is still checked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { catalogue } from '../v2/primitives/index.js';
import { preflight } from '../v2/kernel/document.js';
import combat from '../v2/primitives/gameplay/combat.index.js';
import { Logic } from '../v2/kernel/logic.js';

const dir = new URL('../v2/games/', import.meta.url);
const games = readdirSync(dir).filter(f => f.endsWith('.json')).map(f => ({ file: f, doc: JSON.parse(readFileSync(new URL(f, dir), 'utf8')) }));
const mine = new Set(combat.map(p => p.id));
const own = new Logic(); for (const p of combat) p.logic?.(own);
const ownKinds = new Set([...own.predicates.keys(), ...own.effects.keys()]);
const { registry, logic } = catalogue();

test('combat primitives are all registered with cards', () => {
  assert.equal(combat.length, 18);
  for (const p of combat) { assert.ok(registry.has(p.id), p.id); assert.ok(p.card.intent.length > 20, p.id); }
});

for (const { file, doc } of games) {
  const paths = (doc.systems || []).map((s, i) => [s.use, `systems[${i}]`]).filter(([use]) => mine.has(use)).map(([, p]) => p);
  if (!paths.length) continue;
  test(`${file}: combat instances preflight with zero errors`, () => {
    const r = preflight(doc, registry, logic);
    const errs = r.errors.filter(e => paths.some(p => e.path === p || e.path.startsWith(`${p}.`)))
      .filter(e => e.code !== 'capability_missing')
      .filter(e => !(['effect_unknown', 'predicate_unknown'].includes(e.code) && !ownKinds.has(/'([^']+)'/.exec(e.message)?.[1] ?? '')));
    assert.deepEqual(errs, [], JSON.stringify(errs, null, 1));
    // Validation of archetype components and content.statuses owned by combat.
    const contentErrs = r.errors.filter(e => /^content\.(archetypes|statuses)/.test(e.path) && /^(health|melee|status|projectile|versus|boss)_/.test(e.code));
    assert.deepEqual(contentErrs, [], JSON.stringify(contentErrs, null, 1));
  });
}
