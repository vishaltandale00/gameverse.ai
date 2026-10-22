// Catalogue conformance (ARCHITECTURE.md §6.2, KERNEL_API §4): every generator that declares a traversability
// guarantee (card.traversal) proves it for the movers documents actually have. For every such generator, on each
// declared space with the `reachable` capability, with each base locomotion card (card.locomotion 'base' with an
// envelope) that moves in that space's view and the body that card declares (card.body), a layout generated on world
// seeds 1–5 reports no traversal problem and every target it publishes is reached by the verifier's own reachability
// (v2/verify/movement.js navOptions → space.reachable), from its published start, taking its published passes.
// Both lists come from the registry; a new traversal generator without a fixture below fails the suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { preflight } from '../v2/kernel/document.js';
import { createWorld } from '../v2/kernel/world.js';
import { navOptions, navFrom } from '../v2/verify/movement.js';
import { withDefaults, entityAt } from '../v2/primitives/engine/generate2d-lib.js';

const { registry, logic } = buildCatalogue();
const card = id => registry.get(id).card;
const GENERATORS = registry.ids().filter(id => card(id).traversal);
const MOVERS = registry.ids().filter(id => card(id).locomotion === 'base' && (card(id).envelope || registry.get(id).envelope));
const SEEDS = [1, 2, 3, 4, 5];

const solid = ids => ids.map(id => ({ id, name: id, solid: true }));
const zonesRow = (n, w, h) => Array.from({ length: n }, (_, i) => ({ id: `z${i}`, name: `Zone ${i}`, rect: [i * w, 0, (i + 1) * w, h] }));
/**
 * Fixtures: per traversal generator, the spaces it is proven on, each { use, with, zones?, view } plus the generator
 * config (from the card's scaffold hook where it has one) and the content it needs.
 */
const FIXTURES = {
  'engine.generate.tilemap.rooms': () => ['side', 'topdown'].map(mode => {
    const space = { id: 'w', use: 'engine.space.tilemap', with: { size: [72, 16], mode }, zones: zonesRow(3, 24, 16) };
    const doc = { content: { blocks: [{ id: 'stone', name: 'Stone', solid: true }, { id: 'ledge', name: 'Ledge', solid: false, tags: ['one_way'] }, { id: 'spikes', name: 'Spikes', solid: false, tags: ['hazard'], hazard: 'spikes' }] }, player: { archetype: 'hero', space: 'w', at: [3, 3] } };
    const made = registry.get('engine.generate.tilemap.rooms').scaffold(space, doc, {});
    // Pits and floor spikes in every room but the first: what the mover must clear.
    const rooms = made.with.rooms.map((r, i) => (i ? { ...r, gaps: 1, hazards: ['spikes'] } : r));
    return { space, view: mode === 'side' ? 'side' : 'td', with: { ...made.with, rooms }, blocks: [...doc.content.blocks, ...(made.content?.blocks || [])], at: made.start };
  }),
  'engine.generate.grid.maze': () => [
    { space: { id: 'w', use: 'engine.space.tilemap', with: { size: [28, 31], mode: 'topdown' } }, view: 'td', with: {} },
    { space: { id: 'w', use: 'engine.space.grid', with: { size: [28, 31], wrap: 'x', rules: { house_door: { pass: ['hunter'] } } } }, view: 'td', with: {} },
  ].map(f => ({ ...f, with: registry.get('engine.generate.grid.maze').scaffold(f.space, { content: { blocks: solid(['wall', 'house_wall', 'house_door']) } }).with, blocks: solid(['wall', 'house_wall', 'house_door']), archetypes: [{ id: 'pellet', components: {} }, { id: 'power_pellet', components: {} }] })),
  'engine.generate.dungeon.rooms': () => [
    { id: 'w', use: 'engine.space.tilemap', with: { size: [40, 40], mode: 'topdown' } },
    { id: 'w', use: 'engine.space.grid', with: { size: [40, 40] } },
  ].map(space => {
    const doc = { content: { blocks: solid(['stone', 'locked_door']), archetypes: [] }, player: { archetype: 'hero' } };
    const made = registry.get('engine.generate.dungeon.rooms').scaffold(space, doc, { registry });
    return { space, view: 'td', with: { ...made.with, keys: ['k1'], palette: { ...made.with.palette, door: 'locked_door' }, archetypes: { ...made.with.archetypes, key: 'key', lock: 'locked_door' } }, blocks: doc.content.blocks, archetypes: [{ id: 'key', components: {} }, { id: 'locked_door', components: {} }, ...(made.content?.archetypes || [])], items: [{ id: 'k1', name: 'Key' }] };
  }),
  'engine.generate.tilemap.overworld': () => [{
    space: { id: 'w', use: 'engine.space.tilemap', with: { size: [256, 256], mode: 'topdown' } }, view: 'td',
    with: { areas: [
      { id: 'home', kind: 'town', services: ['heal', 'mart'], connects: [{ to: 'route1' }] },
      { id: 'route1', kind: 'route', length: 40, connects: [{ to: 'home' }, { to: 'city' }], trainers: [{ id: 'youngster' }], items: ['potion'] },
      { id: 'city', kind: 'town', services: ['heal'], connects: [{ to: 'route1' }] },
    ], starters: ['sprout'] },
    blocks: [...solid(['tree', 'rock', 'wall', 'roof', 'window', 'fence', 'sign', 'counter', 'shelf', 'statue', 'barrier', 'boulder', 'pc', 'heal_machine', 'table']), { id: 'water', name: 'Water', solid: false, tags: ['liquid'] }, { id: 'ledge', name: 'Ledge', solid: false, tags: ['one_way'] }],
    items: [{ id: 'potion', name: 'Potion' }],
  }],
};

/** A locomotion card's declared body in a space's view: side views read [w, h], top-down ones [w, d]. */
const bodyIn = (size, view) => (view === 'side' ? [size[0], size[1]] : [size[0], size[2]]);
const spaceCaps = (space) => { const p = registry.get(space.use), config = withDefaults(p.card, space.with); return new Set(p.capabilities ? p.capabilities(config) : p.card.provides.capabilities || []); };
const fits = (mover, gen, f) => {
  const c = card(mover), caps = spaceCaps(f.space);
  return (c.views || []).includes(f.view) && card(gen).views.includes(f.view) && (c.requires?.capabilities || []).every(k => caps.has(k));
};

test('traversal: generators declaring the guarantee and the locomotion they are proven for come from the registry', () => {
  assert.ok(GENERATORS.length >= 4, GENERATORS.join());
  assert.ok(MOVERS.length >= 4, MOVERS.join());
  for (const id of GENERATORS) {
    const t = card(id).traversal;
    assert.equal(t.mover, 'player', `${id}: the mover a proof holds for`);
    assert.ok(t.problems.length && t.problems.every(c => card(id).problems.includes(c)), `${id}: its traversal codes are declared problems`);
    assert.ok(FIXTURES[id], `${id}: a fixture proves it here`);
  }
  for (const id of MOVERS) {
    const s = card(id).body?.size;
    assert.ok(Array.isArray(s) && s.length === 3 && s.every(v => v > 0), `${id}: declares the body it is tuned for (card.body.size)`);
  }
});

const cases = GENERATORS.flatMap(gen => FIXTURES[gen]().flatMap(f => (spaceCaps(f.space).has('reachable') ? MOVERS.filter(m => fits(m, gen, f)).map(mover => ({ gen, f, mover })) : [])));

test('traversal: every declared space and view is paired with at least one locomotion card', () => {
  for (const gen of GENERATORS) for (const f of FIXTURES[gen]()) assert.ok(cases.some(c => c.gen === gen && c.f.space.use === f.space.use && c.f.view === f.view), `${gen} on ${f.space.use} (${f.view})`);
});

for (const { gen, f, mover } of cases) {
  test(`traversal: ${gen} on ${f.space.use} (${f.view}) is passable for ${mover} with its body, seeds ${SEEDS.join(', ')}`, () => {
    const size = bodyIn(card(mover).body.size, f.view), codes = new Set(card(gen).traversal.problems);
    for (const seed of SEEDS) {
      const doc = {
        schema: 'gameverse.v2.game/0.2', id: 'traversal', title: 'Traversal', seed,
        spaces: [{ ...structuredClone(f.space), generators: [{ use: gen, with: structuredClone(f.with) }] }],
        systems: [{ use: mover }],
        content: { blocks: f.blocks || [], archetypes: [{ id: 'hero', components: { body: { size } } }, ...(f.archetypes || [])], items: f.items || [] },
        player: { archetype: 'hero', space: 'w', ...(f.at ? { at: f.at } : {}) },
      };
      const pre = preflight(doc, registry, logic);
      assert.ok(pre.ok, `${mover} seed ${seed}: ${JSON.stringify(pre.errors.slice(0, 3))}`);
      const rt = createWorld(pre.doc, registry, logic, { seed });
      const st = rt.store('spaces.w.generators[0]'), where = `${gen} × ${mover} seed ${seed}`;
      assert.deepEqual(st.problems.filter(p => codes.has(p.code)), [], `${where}: the proof holds for this mover`);
      // Locked doors open once their keys are reached (the generator's proof walks keys before locks).
      for (const open of rt.caches.dungeonLocks?.values() || []) open(rt);
      const api = rt.space('w'), p = rt.player(), nav = navOptions(rt, registry, p);
      assert.ok(Array.isArray(st.from) && st.targets.length, `${where}: the proof publishes its start and targets`);
      // The verifier's reachability from the start, continuing through every pass (door, warp) it reaches.
      const cell = k => k.split(',').map(Number), keyOf = c => `${Math.floor(c[0])},${Math.floor(c[1])}`;
      const foot = api.anchor === 'cell' ? [1, 1] : size.map(v => Math.max(1, Math.ceil(v - 1e-6)));
      const covered = new Set(), entered = new Set(), queue = [st.from];
      while (queue.length) {
        const at = queue.shift(), k = keyOf(at); if (entered.has(k)) continue; entered.add(k);
        const set = api.reachable(navFrom(api, { at: entityAt({ api }, [Math.floor(at[0]), Math.floor(at[1])], size), components: { body: { size } } }), rt, nav.opts);
        for (const n of set) { const [x, y] = cell(n); for (let j = 0; j < foot[1]; j++) for (let i = 0; i < foot[0]; i++) covered.add(`${x + i},${y + j}`); }
        for (const pass of st.passes || []) if (covered.has(keyOf(pass.from))) queue.push(pass.to);
      }
      const missed = st.targets.filter(t => !t.cells.some(c => covered.has(keyOf(c))));
      assert.deepEqual(missed.map(t => t.id), [], `${where}: targets the verifier cannot reach`);
    }
  });
}
