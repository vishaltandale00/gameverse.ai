// Shared fixtures for the move workstream tests (tests/v2-p-move-*.test.js).
import fs from 'node:fs';
import { compile, testSpace, run } from '../v2/kernel/testing.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import { preflight } from '../v2/kernel/document.js';
import { PRIMITIVES } from '../v2/primitives/index.js';
import move from '../v2/primitives/gameplay/move.index.js';

export { compile, testSpace, run, move };

/** A floor along y=0 from x0..x1 plus extra solid cells. */
export function floor(x0, x1, extra = [], z = 0) { const out = []; for (let x = x0; x <= x1; x++) out.push([x, 0, z]); return [...out, ...extra]; }

export function doc({ size = [24, 12, 1], gravity = 30, solid = floor(0, 23), zones = [], systems = [], body = { size: [0.8, 1.6, 1] }, at = [2, 1, 0], archetypes = [], blocks, extra = {} } = {}) {
  return {
    schema: 'gameverse.v2.game/0.2', id: 'movetest', title: 'Move test', seed: 3,
    spaces: [{ id: 'w', use: 'engine.space.test', with: { size, gravity, solid }, zones }],
    systems,
    content: { archetypes: [{ id: 'hero', components: { body } }, ...archetypes], ...(blocks ? { blocks } : {}) },
    player: { archetype: 'hero', at }, ...extra,
  };
}

export const make = (d, extra = []) => compile(d, { primitives: [testSpace, ...move, ...extra] });

/** Preflight a document and return only errors raised by the given primitive ids' instances. */
export function gameInstanceErrors(file, ids) {
  const d = JSON.parse(fs.readFileSync(new URL(`../v2/games/${file}`, import.meta.url), 'utf8'));
  const registry = new Registry(PRIMITIVES), logic = buildLogic(registry, Logic);
  const r = preflight(d, registry, logic);
  const paths = new Set((d.systems || []).map((s, i) => (ids.includes(s.use) ? `systems[${i}]` : null)).filter(Boolean));
  return { errors: r.errors.filter(e => [...paths].some(p => e.path === p || e.path.startsWith(p + '.'))), count: paths.size };
}

export function hold(rt, n, input) { return run(rt, n, input); }
export const games = () => fs.readdirSync(new URL('../v2/games/', import.meta.url)).filter(f => f.endsWith('.json'));
