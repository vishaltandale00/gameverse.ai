// Shared fixtures for the items workstream tests (tests/v2-p-items-*.test.js).
import { readFileSync, readdirSync } from 'node:fs';
import { testSpace, compile } from '../v2/kernel/testing.js';
import { PRIMITIVES } from '../v2/primitives/index.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import { preflight } from '../v2/kernel/document.js';

export const ALL = [...PRIMITIVES, testSpace];

/** Stub owners for vocabulary other workstreams register (damage, heal, gain, add_score...), recording calls in vars. */
export const stubs = {
  id: 'gameplay.stub.vocab',
  card: { intent: 'test stubs for other workstreams', provides: { events: ['damaged', 'defeated', 'defeated:*'] } },
  logic(logic) {
    logic.effect('damage', { run: (e, rt) => { rt.state.vars[`dmg.${e.who ?? 'player'}`] = (rt.state.vars[`dmg.${e.who ?? 'player'}`] ?? 0) + e.amount; if ((e.who ?? 'player') === 'player') rt.state.vars.hp = (rt.state.vars.hp ?? 0) - e.amount; rt.emit('damaged', { who: e.who ?? 'player', amount: e.amount, type: e.type }); } });
    logic.effect('heal', { run: (e, rt) => { rt.state.vars.hp = Math.min(rt.state.vars['hp.max'] ?? Infinity, (rt.state.vars.hp ?? 0) + e.amount); rt.emit('healed', { who: e.who, amount: e.amount }); } });
    logic.effect('gain', { run: (e, rt) => { rt.state.vars[`res.${e.resource}`] = (rt.state.vars[`res.${e.resource}`] ?? 0) + e.amount; } });
    logic.effect('apply_status', { run: (e, rt) => { rt.emit('status_applied', { who: e.who, status: e.status }); rt.state.flags[`status.${e.status}`] = true; } });
  },
};

/** A small document on the reference test space. */
export function doc(over = {}) {
  const d = {
    schema: 'gameverse.v2.game/0.2', id: 'items-test', title: 'Items test', seed: 3,
    spaces: [{ id: 'world', use: 'engine.space.test', with: { size: [32, 16, 1], ...(over.space || {}) }, zones: over.zones || [{ id: 'yard', rect: [0, 0, 8, 16] }, { id: 'field', rect: [8, 0, 32, 16] }] }],
    systems: over.systems || [],
    content: { items: [], archetypes: [{ id: 'hero', kind: 'player', components: { body: { size: [1, 1, 1] } } }], ...(over.content || {}) },
    player: { archetype: 'hero', space: 'world', at: over.at || [1, 1, 0] },
  };
  if (over.plot) d.plot = over.plot;
  return structuredClone(d);
}
export const make = (d, extra = []) => compile(d, { primitives: [...ALL, stubs, ...extra] });
export const steps = (rt, n, input = {}) => { for (let i = 0; i < n && rt.state.status === 'playing'; i++) rt.step(input); return rt; };

const registry = new Registry(ALL), logic = buildLogic(registry, Logic);
export const check = d => preflight(d, registry, logic);
export const checkWith = (d, extra = []) => { const r = new Registry([...ALL, stubs, ...extra]); return preflight(d, r, buildLogic(r, Logic)); };
export const codes = r => r.errors.map(e => e.code);

/** Every instance of `use` in v2/games/*.json: { game, path, errors } where errors are param/ref errors in its `with`. */
export function gameInstances(use) {
  const out = [];
  for (const f of readdirSync(new URL('../v2/games/', import.meta.url))) {
    if (!f.endsWith('.json')) continue;
    const d = JSON.parse(readFileSync(new URL(`../v2/games/${f}`, import.meta.url), 'utf8'));
    const r = preflight(d, registry, logic);
    (d.systems || []).forEach((s, i) => {
      if (s.use !== use) return;
      const path = `systems[${i}]`;
      out.push({ game: f, path, errors: r.errors.filter(e => e.path === path || e.path.startsWith(`${path}.`)), paramErrors: r.errors.filter(e => (e.path === path || e.path.startsWith(`${path}.`)) && /^param_|^ref_unknown$/.test(e.code)), all: r.errors });
    });
  }
  return out;
}
