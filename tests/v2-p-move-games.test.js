// Every gameplay.move.* / gameplay.mount instance in v2/games/*.json preflights
// with zero param errors; the merged movement envelope follows ability grants.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gameInstanceErrors, games, move } from './v2-p-move-helpers.js';
import { movementEnvelope } from '../v2/primitives/gameplay/move.index.js';
import { catalogue } from '../v2/primitives/index.js';

const ids = move.map(p => p.id);
// Spaces built by other workstreams (voxel, mesh3d) may not be registered yet: capability checks
// against an unregistered space are reported by the kernel as "provides: nothing" and are not ours.
const ours = errs => errs.filter(e => !(e.code === 'capability_missing' && /provides: nothing/.test(e.hint || '')));

for (const f of games()) {
  test(`games: ${f} move instances preflight with zero param errors`, () => {
    const { errors, count } = gameInstanceErrors(f, ids);
    assert.deepEqual(ours(errors), [], JSON.stringify(ours(errors), null, 1));
    if (/hollow|ember|blockport/.test(f)) assert.ok(count > 0, 'the document uses movement primitives');
  });
}

test('games: the merged envelope of hollow-lantern grows with unlocked abilities (grants)', () => {
  const doc = JSON.parse(fs.readFileSync(new URL('../v2/games/hollow-lantern.json', import.meta.url), 'utf8'));
  const { registry } = catalogue();
  const base = movementEnvelope(doc, registry, []), grip = movementEnvelope(doc, registry, ['briar_grip', 'moth_wings']);
  assert.equal(base.wallJump, false); assert.equal(base.doubleJump, false);
  assert.equal(grip.wallJump, true, 'briar_grip grants wallJump');
  assert.equal(grip.climb, true, 'and wallClimb');
  assert.equal(grip.doubleJump, true, 'moth_wings grants doubleJump');
  assert.ok(grip.reachHeight > base.reachHeight);
  assert.equal(base.swim, true, 'swim is on from the start in this game');
});

test('games: every move card has an intent, an envelope, an actionSpace and a travel macro', () => {
  for (const p of move) {
    assert.ok(p.card.intent.length > 40, p.id);
    assert.equal(typeof p.card.envelope, 'function', p.id);
    assert.ok(p.card.actionSpace?.move?.kind === 'continuous', p.id);
    assert.equal(typeof p.travel, 'function', `${p.id} travel`);
    const env = p.card.envelope({ ...defaults(p) }, new Set());
    assert.ok(env && typeof env === 'object' && env.mode, `${p.id} envelope mode`);
  }
});

function defaults(p) { return Object.fromEntries(Object.entries(p.card.params).filter(([, s]) => s.default !== undefined).map(([k, s]) => [k, structuredClone(s.default)])); }
