import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, testSpace } from '../v2/kernel/testing.js';
import { preflight } from '../v2/kernel/document.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import modes from '../v2/primitives/gameplay/modes.index.js';
import { doc } from '../v2/primitives/gameplay/modes-lib-testing.js';

const P = [...modes, testSpace];
const rwDoc = w => doc({ with: { size: [200, 10, 1] }, archetypes: [{ id: 'key', components: { time: { rule: 'immune' } } }, { id: 'goomba', components: {} }, { id: 'shadow', components: {} }], player: { archetype: 'hero', at: [0, 1, 0] },
  systems: [{ use: 'gameplay.rewind', with: { maxSec: 2, sampleEvery: 2, ...w } }] });
// Walk the player one cell right per frame (a stand-in for a movement primitive) and count frames in a var.
const walk = (rt, n, input = {}) => { for (let i = 0; i < n; i++) { const p = rt.player(); rt.space('world').setPos(p, [p.at[0] + 1, 1, 0], rt); rt.state.vars.t = (rt.state.vars.t ?? 0) + 1; rt.step(input); } };
const hold = (rt, n) => { for (let i = 0; i < n; i++) rt.step({ held: { rewind: true } }); };

test('rewind: holding rewind walks the world back; spawns are undone; vars and flags restore', () => {
  const { rt } = compile(rwDoc({}), { primitives: P });
  walk(rt, 45);
  rt.spawn('goomba', { id: 'g1', at: [5, 1, 0] }); rt.state.flags.door = true;
  walk(rt, 15);
  assert.equal(rt.player().at[0], 60);
  hold(rt, 10);
  assert.equal(rt.state.counts.rewind_start, 1);
  assert.equal(rt.player().at[0], 41, '10 samples (every 2 frames) back; the newest sample is from the last even frame');
  assert.equal(rt.entity('g1'), undefined, 'the goomba spawned later is undone');
  assert.equal(rt.state.flags.door, undefined);
  assert.equal(rt.state.vars.t, 41);
  rt.step();
  assert.equal(rt.state.counts.rewind_end, 1);
  walk(rt, 300); const far = rt.player().at[0];
  hold(rt, 200);
  assert.equal(rt.state.counts.rewind_empty >= 1, true);
  assert.ok(far - rt.player().at[0] <= 122 && far - rt.player().at[0] >= 116, 'history is bounded to 2 s (120 frames)');
});

test('rewind: immune entities keep their timeline; the echo replays the undone path', () => {
  const { rt } = compile(rwDoc({ echo: 'shadow' }), { primitives: P });
  const key = rt.spawn('key', { id: 'k', at: [0, 5, 0] });
  for (let i = 0; i < 30; i++) { rt.space('world').setPos(key, [i, 5, 0], rt); walk(rt, 1); }
  hold(rt, 5);
  assert.deepEqual(rt.entity('k').at, [29, 5, 0], 'immune key ignores the rewind');
  assert.equal(rt.player().at[0], 21);
  rt.step();
  assert.equal(rt.state.counts.echo_spawned, 1);
  const echo = Object.values(rt.state.entities).find(e => e.archetype === 'shadow');
  const start = echo.at[0];
  for (let i = 0; i < 6; i++) rt.step();
  assert.ok(rt.entity(echo.id).at[0] > start, 'echo moves forward along the undone path');
  for (let i = 0; i < 20; i++) rt.step();
  assert.equal(rt.state.counts.echo_done, 1);
});

test('rewind: charges, cooldown, cell edits, deterministic replay', () => {
  const { rt } = compile(rwDoc({ charges: 1, cells: true }), { primitives: P });
  walk(rt, 10); rt.space('world').setCell([3, 3, 0], 'crate', rt); walk(rt, 10);
  hold(rt, 8); rt.step();
  assert.equal(rt.space('world').getCell([3, 3, 0]), null, 'cell edit undone');
  assert.equal(rt.state.vars['rewind.charges'], 0);
  walk(rt, 10); const x = rt.player().at[0]; hold(rt, 3);
  assert.equal(rt.player().at[0], x, 'no charges left');
  const play = () => { const { rt } = compile(rwDoc({ cooldownSec: 0.2, echo: 'shadow' }), { primitives: P }); for (let k = 0; k < 4; k++) { walk(rt, 25); hold(rt, 6); rt.step(); } return rt.snapshot(); };
  assert.deepEqual(play(), play());
  const registry = new Registry(P), logic = buildLogic(registry, Logic);
  const codes = new Set(preflight(rwDoc({ speed: 16, maxSec: 0.5, sampleEvery: 30, vars: ['*', 'hp'], echo: 'nobody' }), registry, logic).errors.map(e => e.code));
  for (const c of ['rewind_speed', 'rewind_vars', 'ref_unknown']) assert.ok(codes.has(c), c);
});
