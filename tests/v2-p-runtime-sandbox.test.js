// engine.script.sandbox: model-written code in node:vm over a JSON read-model, applying only declared effects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, run, testSpace } from '../v2/kernel/testing.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import { preflight } from '../v2/kernel/document.js';
import runtime from '../v2/primitives/engine/runtime.index.js';
import { createHost } from '../v2/primitives/engine/runtime-lib-sandbox.js';

const PRIMS = [testSpace, ...runtime];
const doc = scripts => ({
  schema: 'gameverse.v2.game/0.2', id: 'rt-script', title: 'Runtime scripts', seed: 2,
  spaces: [{ id: 'w', use: 'engine.space.test', with: { size: [32, 16, 1] }, zones: [{ id: 'yard', rect: [0, 0, 32, 16] }] }],
  content: { archetypes: [{ id: 'hero', components: { health: { hp: 10, max: 10 } } }, { id: 'coin', components: {} }] },
  player: { archetype: 'hero', at: [2, 2, 0] },
  systems: [{ use: 'engine.input.actions', with: { verbs: ['move', 'jump', 'zap'] } }, { use: 'engine.spawner' }, { use: 'engine.script.sandbox', with: { scripts } }],
});
const make = scripts => compile(doc(scripts), { primitives: PRIMS });
const codes = d => { const r = new Registry(PRIMS); return preflight(d, r, buildLogic(r, Logic)).errors.map(e => e.code); };

// A coin rain: every 30 steps drop a coin near the player using the script's own rng; count presses of its button.
const COINS = `
let leaked = 0; // module-level state never survives between calls
export default {
  label: 'Coin rain',
  init(world, rng) { return { drops: 0, presses: 0, first: world.player.at } },
  step(state, world, input, rng) {
    leaked++;
    const effects = [];
    if (input.pressed) { state.presses++; effects.push({ do: 'add_var', var: 'zaps', value: 1 }); }
    if (world.frame % 30 === 0) {
      state.drops++;
      const x = world.player.at[0] + Math.floor(rng() * 6), y = 3 + Math.floor(rng() * 4);
      effects.push({ do: 'spawn', archetype: 'coin', at: [x, y, 0] });
      effects.push({ do: 'set_var', var: 'leaked', value: leaked });
    }
    return { state, effects };
  },
};`;

test('engine.script.sandbox: runs a script over the read-model and applies its declared effects', () => {
  const { rt } = make([{ id: 'coins', code: COINS, effects: ['spawn', 'add_var', 'set_var'], button: 'zap' }]);
  run(rt, 61);
  const coins = Object.values(rt.state.entities).filter(e => e.archetype === 'coin');
  assert.equal(coins.length, 3);
  assert.equal(rt.service('scripts').state('coins').drops, 3);
  assert.deepEqual(rt.service('scripts').state('coins').first, [2, 2, 0]);
  assert.equal(rt.state.vars.leaked, 1, 'module re-instantiated every call');
  rt.step({ actions: { zap: true } });
  assert.equal(rt.state.vars.zaps, 1);
  assert.equal(rt.service('scripts').status('coins').applied, 7);
  assert.equal(rt.service('scripts').sandbox(), 'vm');
});

test('engine.script.sandbox: undeclared, malformed and too many effects are dropped; failures disable the script', () => {
  const sneaky = `export default { step(s, w) { return { state: s, effects: [
    { do: 'end_game', outcome: 'won' }, { do: 'spawn' }, { do: 'add_var', var: 'ok' },
    { do: 'spawn', archetype: 'dragon' }, { do: 'add_var', var: 'ok' }, { do: 'add_var', var: 'ok' } ] } } };`;
  const { rt } = make([{ id: 'sneaky', code: sneaky, effects: ['spawn', 'add_var'], maxEffects: 5 }]);
  run(rt, 1);
  assert.equal(rt.state.status, 'playing', 'undeclared end_game dropped');
  assert.equal(rt.state.vars.ok, 2, 'valid effects applied up to maxEffects');
  assert.equal(rt.service('scripts').status('sneaky').dropped, 4);
  assert.ok(rt.state.counts.script_rejected >= 1);
  const broken = `export default { step(s, w) { if (w.frame > 2) throw new Error('boom'); return { state: s, effects: [] } } };`;
  const b = make([{ id: 'broken', code: broken, effects: ['add_var'] }]).rt;
  run(b, 10);
  assert.equal(b.state.counts['script_disabled:broken'], 1);
  assert.match(b.service('scripts').status('broken').disabled, /boom/);
});

test('sandbox realm: no clock, randomness, network, eval, globals or runaway loops', () => {
  const probe = body => { const h = createHost(`export default { step(s, w) { ${body} } };`, { timeoutMs: 20 }); return h.call('step', { state: {}, world: {}, input: {}, seed: 1 }); };
  assert.match(probe('return { state: Math.random() }').error, /Math.random/);
  for (const g of ['Date', 'fetch', 'process', 'require', 'setTimeout', 'Function', 'eval', 'performance', 'globalThis.constructor.constructor']) {
    const r = probe(`let v; try { v = typeof ${g}; } catch (e) { v = 'blocked'; } return { state: { v } };`);
    assert.ok(r.ok && ['undefined', 'blocked'].includes(r.value.state.v) || (g.includes('constructor') && r.ok), `${g}: ${JSON.stringify(r)}`);
  }
  assert.ok(!probe("return { state: { f: (function(){}).constructor('return process')() } }").ok, 'no code generation from strings');
  const call = h => h.call('step', { state: {}, world: {}, input: {}, seed: 1 });
  const sticky = createHost('export default { step(s) { const seen = typeof globalThis.keep; globalThis.keep = 1; return { state: { seen } } } };');
  call(sticky);
  assert.equal(call(sticky).value.state.seen, 'undefined', 'globals a call adds are swept');
  const pinned = createHost("export default { step(s) { Object.defineProperty(globalThis, 'pin', { value: 1 }); return { state: {} } } };");
  call(pinned);
  assert.match(call(pinned).error, /cannot define globals/);
  const intl = createHost('export default { step(s) { const before = typeof Intl === "object" ? Intl.x : 0; try { Intl.x = 1; } catch {} return { state: { before: before ?? 0 } } } };');
  call(intl);
  assert.equal(call(intl).value.state.before, 0, 'global objects are frozen');
  assert.ok(probe('while (true) {}').timeout, 'time limit');
  assert.match(probe('return { state: { x: 1 / 0 } }').error, /Infinity/);
  assert.ok(createHost('import x from "y"; export default {}').error);
});

test('engine.script.sandbox replays deterministically across snapshot/restore', () => {
  const scripts = [{ id: 'coins', code: COINS, effects: ['spawn', 'add_var', 'set_var'], button: 'zap', every: 2 }];
  const a = make(scripts).rt, b = make(scripts).rt;
  const input = i => (i % 17 === 0 ? { actions: { zap: true } } : {});
  for (let i = 0; i < 200; i++) a.step(input(i));
  for (let i = 0; i < 100; i++) b.step(input(i));
  const snap = b.snapshot(); for (let i = 0; i < 31; i++) b.step({}); b.restore(snap);
  for (let i = 100; i < 200; i++) b.step(input(i));
  assert.deepEqual(a.snapshot(), b.snapshot());
});

test('preflight rejects bad scripts with stable codes', () => {
  const bad = doc([
    { id: 'a', code: 'import fs from "fs"; export default {}', effects: ['add_var'] },
    { id: 'b', code: 'export default { async step() {} }', effects: ['add_var'] },
    { id: 'c', code: 'export default { step( }', effects: ['add_var'] },
    { id: 'd', code: 'const x = 1;', effects: ['teleport_to_moon'] },
    { id: 'a', code: 'export default { step(s) { return { state: s } } }', effects: ['end_game'] },
  ]);
  const c = codes(bad);
  for (const code of ['script_import', 'script_async', 'script_syntax', 'script_export', 'script_effect_unknown', 'script_duplicate', 'script_effect_unsafe']) assert.ok(c.includes(code), code);
});
