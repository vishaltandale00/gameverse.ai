// Shared fixtures for UI primitive tests: a minimal document on the kernel's
// reference space and a fixture primitive whose `fx` action runs effects, so
// tests drive state changes through rt.step exactly as gameplay would.
import fs from 'node:fs';
import { testSpace } from '../v2/kernel/testing.js';
import inventory from '../v2/primitives/gameplay/inventory.js';
import feedback from '../v2/primitives/graphics/ui-feedback.js';

export const fx = {
  id: 'gameplay.fixture.fx',
  card: { intent: 'Test fixture: the fx action runs a list of effects; optional services are provided from with.services.', params: { services: { type: 'json', default: {} } }, provides: { events: ['*'] } },
  install(rt, config) {
    rt.action('fx', effects => rt.run(effects));
    rt.action('emit', ({ name, data, typed }) => (typed !== undefined ? rt.emitTyped(name, typed, data || {}) : rt.emit(name, data || {})));
    for (const [name, api] of Object.entries(rt.caches.fixtureServices || {})) rt.provide(name, api);
  },
};

/** A fixture primitive providing services (functions closed over test data). */
export function services(map) {
  return { id: 'gameplay.fixture.services', card: { intent: 'Test fixture providing services.', provides: { services: Object.keys(map) } }, install(rt) { for (const [n, api] of Object.entries(map)) rt.provide(n, typeof api === 'function' ? api(rt) : api); } };
}
/** A fixture registering actions that record their values in state (so tests can see what UI sent). */
export function actions(names) {
  return { id: 'gameplay.fixture.actions', card: { intent: 'Test fixture recording actions.' }, install(rt) { for (const n of names) rt.action(n, v => { const s = rt.store('fixture.actions'); (s[n] ??= []).push(v); }); } };
}

export function baseDoc({ graphics = [], systems = [], plot, content = {}, zones, player = {}, title = 'Test Game' } = {}) {
  return {
    schema: 'gameverse.v2.game/0.2', id: 'ui-test', title, logline: 'A small test world.',
    spaces: [{ id: 's', use: 'engine.space.test', with: { size: [16, 16, 1] }, zones: zones || [{ id: 'meadow', name: 'Sunny Meadow', rect: [0, 0, 8, 16], tags: ['start'] }, { id: 'caves', name: 'Echo Caves', rect: [8, 0, 16, 16], tags: ['cave'] }] }],
    plot: plot || undefined,
    content: { archetypes: [{ id: 'hero', kind: 'player', components: { health: { max: 10 } } }], ...content },
    player: { archetype: 'hero', at: [1, 1, 0], ...player },
    systems: [{ use: 'gameplay.fixture.fx' }, ...systems],
    graphics,
  };
}
export const BASE = [testSpace, fx, inventory, feedback];

/** Every instance of primitive `use` in v2/games/*.json, as reduced documents preflighting only that instance. */
export function gameInstances(use) {
  const out = [];
  for (const f of fs.readdirSync(new URL('../v2/games/', import.meta.url))) {
    const d = JSON.parse(fs.readFileSync(new URL(`../v2/games/${f}`, import.meta.url), 'utf8'));
    (d.graphics || []).forEach((g, i) => {
      if (g.use !== use) return;
      const doc = { schema: d.schema, id: d.id, title: d.title, spaces: d.spaces.map(s => ({ id: s.id, use: 'engine.space.test', zones: s.zones })), plot: d.plot, content: d.content, player: d.player && { ...d.player }, systems: [], graphics: [g] };
      out.push({ file: f, index: i, doc });
    });
  }
  return out;
}
/** Errors owned by this instance: param and reference problems and the primitive's own codes. */
export const ownErrors = (errors, prefixes = ['param_', 'ref_', 'ui_', 'audio_']) => errors.filter(e => e.path?.startsWith('graphics[0]') && prefixes.some(p => e.code.startsWith(p)));
