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

// Real 2D spaces (engine.space.tilemap/grid/arena2d...) plus a test-only generator that bakes cells.
import spaces2d from '../v2/primitives/engine/spaces2d.index.js';
export const bakeCells = {
  id: 'engine.generate.movetest', card: { intent: 'test-only: bake listed cells', params: { cells: { type: 'json', default: [] }, layer: { type: 'string', default: '' } } },
  install(rt, cfg, inst) { rt.space(inst.space).bake(cfg.cells, rt, cfg.layer ? { layer: cfg.layer } : {}); },
};
export const makeReal = (d, extra = []) => compile(d, { primitives: [...spaces2d, bakeCells, ...move, ...extra] });
/** Cells from a picture: rows top to bottom, legend char → block id. */
export function picture(rows, legend) {
  const H = rows.length, out = [];
  rows.forEach((line, i) => [...line].forEach((ch, x) => { if (legend[ch]) out.push({ at: [x, H - 1 - i], block: legend[ch] }); }));
  return out;
}
export const BLOCKS = [
  { id: 'stone', solid: true }, { id: 'plank', solid: false, tags: ['one_way'] }, { id: 'ladder', solid: false, tags: ['climbable'] },
  { id: 'water', solid: false, tags: ['liquid'] }, { id: 'ledge', solid: true, tags: ['ledge:down'] }, { id: 'door', solid: false }, { id: 'tunnel', solid: false },
];
export function realDoc({ space, with: w = {}, cells = [], zones = [], systems = [], body = { size: [0.8, 0.9] }, at, archetypes = [], blocks = BLOCKS, layer } = {}) {
  return {
    schema: 'gameverse.v2.game/0.2', id: 'movereal', title: 'Move on real spaces', seed: 5,
    spaces: [{ id: 'map', use: space, with: w, zones, generators: cells.length ? [{ use: 'engine.generate.movetest', with: { cells, ...(layer ? { layer } : {}) } }] : [] }],
    systems, content: { blocks, archetypes: [{ id: 'hero', components: { body } }, ...archetypes] }, player: { archetype: 'hero', at },
  };
}
export const games = () => fs.readdirSync(new URL('../v2/games/', import.meta.url)).filter(f => f.endsWith('.json'));
