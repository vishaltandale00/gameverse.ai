// Shared fixtures for the items workstream tests (tests/v2-p-items-*.test.js).
import { readFileSync, readdirSync } from 'node:fs';
import { testSpace, compile } from '../v2/kernel/testing.js';
import { PRIMITIVES } from '../v2/primitives/index.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import { preflight } from '../v2/kernel/document.js';

export const ALL = [...PRIMITIVES, testSpace];

/** Real owners for the combat vocabulary items primitives call (damage, heal, kill, gain, apply_status). */
export const COMBAT = [{ use: 'gameplay.combat.health', with: { iframes: 0, playerDeath: 'none' } }, { use: 'gameplay.combat.status' }];

/** A small document on the reference test space. */
export function doc(over = {}) {
  const d = {
    schema: 'gameverse.v2.game/0.2', id: 'items-test', title: 'Items test', seed: 3,
    spaces: [{ id: 'world', use: 'engine.space.test', with: { size: [32, 16, 1], ...(over.space || {}) }, zones: over.zones || [{ id: 'yard', rect: [0, 0, 8, 16] }, { id: 'field', rect: [8, 0, 32, 16] }] }],
    systems: [...(over.systems || []), ...(over.combat ? COMBAT : []), ...(over.resources ? [{ use: 'gameplay.resource', with: { pools: over.resources } }] : [])],
    content: { items: [], archetypes: [{ id: 'hero', kind: 'player', components: { body: { size: [1, 1, 1] } } }], ...(over.content || {}) },
    player: { archetype: 'hero', space: 'world', at: over.at || [1, 1, 0] },
  };
  if (over.plot) d.plot = over.plot;
  return structuredClone(d);
}
export const make = (d, extra = []) => compile(d, { primitives: [...ALL, ...extra] });
export const steps = (rt, n, input = {}) => { for (let i = 0; i < n && rt.state.status === 'playing'; i++) rt.step(input); return rt; };

const registry = new Registry(ALL), logic = buildLogic(registry, Logic);
export const check = d => preflight(d, registry, logic);
export const checkWith = (d, extra = []) => { const r = new Registry([...ALL, ...extra]); return preflight(d, r, buildLogic(r, Logic)); };
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
