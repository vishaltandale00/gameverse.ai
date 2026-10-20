// Host input defaults (v2/web/input-defaults.js): a document whose engine.input.actions is missing or has
// verbs without bindings still gets conflict-free keys for its primary view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { preflight } from '../v2/kernel/document.js';
import { compile } from '../v2/kernel/testing.js';
import { catalogue, PRIMITIVES } from '../v2/primitives/index.js';
import { withDefaultInput } from '../v2/web/input-defaults.js';

const { registry, logic } = catalogue();
const doc = (systems, primary = 'side', use = 'engine.space.tilemap') => ({ schema: 'gameverse.v2.game/0.2', id: 'm', title: 'M', views: { primary }, spaces: [{ id: 'main', use }], systems, graphics: [] });
const inputOf = systems => systems.find(s => s.use === 'engine.input.actions');
const inputErrors = d => preflight(d, registry, logic).errors.filter(e => /^input_/.test(e.code) || (e.path || '').startsWith('systems[0]'));

test('input defaults: verbs listed without bindings get keys for the primary view', () => {
  // The planner's shape: verbs only, empty bindings (keyboard did nothing).
  const systems = [{ use: 'engine.input.actions', with: { verbs: ['move', 'jump', 'place'], axes: ['move'], bindings: {} } }, { use: 'gameplay.move.platformer', with: {} }, { use: 'gameplay.falling.pieces', with: {} }];
  const out = withDefaultInput(doc(systems), registry);
  const w = inputOf(out).with, side = w.bindings.side;
  assert.deepEqual(side.move.slice(0, 2), ['arrows', 'wasd']);
  assert.ok(side.jump.includes('space'));
  for (const v of ['place', 'rotate_cw', 'rotate_ccw', 'shift_left', 'shift_right', 'hard_drop']) assert.ok(w.verbs.includes(v) && side[v]?.length, `${v} is a verb with a key`);
  for (const v of ['menu', 'inventory']) assert.equal(side[v], undefined, 'UI verbs are left to the UI hotkeys');
  for (const ks of Object.values(side)) for (const k of ks) assert.ok(!['esc', 'i', 'j', 'm', 'p', 'tab'].includes(k), `UI hotkey ${k} kept free`);
  assert.deepEqual(inputErrors({ ...doc(out) }), [], 'conflict-free and valid');
  assert.equal(systems[0].with.bindings.side, undefined, 'input document not mutated');
});

test('input defaults: a missing instance is added (touch on touch devices) and the keys reach the game', () => {
  const systems = [{ use: 'gameplay.move.platformer', with: {} }];
  const out = withDefaultInput(doc(systems), registry, { touch: true });
  assert.equal(out[0].use, 'engine.input.actions', 'installed before the systems that use it');
  assert.equal(out[0].with.touch, true);
  assert.deepEqual(inputErrors(doc(out)), []);
  const { rt } = compile(doc(out), { primitives: PRIMITIVES });
  assert.ok(rt.service('input').bindings().jump.includes('space'));
  assert.deepEqual(withDefaultInput(doc([{ use: 'plot.storyboard', with: {} }]), registry).map(s => s.use), ['plot.storyboard'], 'no device actions: nothing added');
});

test('input defaults: 3D views get mouse look and mouse buttons; existing bindings are kept', () => {
  const out = withDefaultInput(doc([{ use: 'gameplay.move.walk', with: {} }, { use: 'gameplay.combat.melee', with: {} }], '3p', 'engine.space.arena2d'), registry);
  const b = inputOf(out).with.bindings['3p'];
  assert.deepEqual(b.look, ['mouse', 'rstick']);
  assert.ok(b.attack.includes('lmb'));
  for (const f of fs.readdirSync(new URL('../v2/games/', import.meta.url))) {
    const d = JSON.parse(fs.readFileSync(new URL(`../v2/games/${f}`, import.meta.url), 'utf8'));
    const before = inputOf(d.systems || []);
    if (!before) continue;
    const after = inputOf(withDefaultInput(d, registry)).with;
    for (const [view, map] of Object.entries(before.with.bindings || {})) for (const [verb, keys] of Object.entries(map)) assert.deepEqual(after.bindings[view][verb], keys, `${f}: ${view}.${verb} kept`);
  }
});
