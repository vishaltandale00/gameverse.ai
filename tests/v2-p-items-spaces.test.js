// Items primitives on the real spaces (grid, tilemap, arena2d, graph), beyond testSpace.
import test from 'node:test';
import assert from 'node:assert/strict';
import { make, steps, checkWith } from './v2-p-items-fixtures.js';

const base = (space, extra = {}) => ({ schema: 'gameverse.v2.game/0.2', id: 'spaces', title: 'Spaces', seed: 2, spaces: [space], ...extra });

test('grid maze: cell pellets, entity power pellets, a prize at a count, level clear', () => {
  const d = base({ id: 'board', use: 'engine.space.grid', with: { size: [9, 5], wrap: 'x' }, zones: [{ id: 'all', rect: [0, 0, 9, 5] }] }, {
    systems: [{ use: 'gameplay.collectible', with: { counters: [
      { id: 'dots', block: 'pellet', points: 10, includes: ['power'], clearsLevel: true, spawnAtCount: [{ count: 3, archetype: 'fruit', at: [8, 3], sec: 2 }] },
      { id: 'power', points: 50, onCollect: [{ do: 'set_flag', flag: 'fright' }] }, { id: 'fruit', total: 9, points: 100 }] } }],
    content: { blocks: [{ id: 'wall', solid: true }, { id: 'pellet', solid: false }], archetypes: [{ id: 'pac', components: {} }, { id: 'energizer', components: { collectible: { counter: 'power', value: 1 } } }, { id: 'fruit', components: { collectible: { counter: 'fruit' } } }] },
    player: { archetype: 'pac', at: [0, 1] },
  });
  assert.ok(checkWith(d).ok, JSON.stringify(checkWith(d).errors));
  const { rt } = make(d), api = rt.space('board');
  for (let x = 1; x <= 6; x++) api.setCell([x, 1], 'pellet', rt);
  rt.spawn('energizer', { at: [7, 1] });
  rt.step();
  for (let x = 1; x <= 7; x++) { api.setPos(rt.player(), [x, 1], rt); rt.step(); }
  assert.equal(rt.state.vars['collected.dots'], 7, 'six cell pellets and the energizer');
  assert.equal(api.getCell([3, 1]), null, 'eaten pellets leave the cells');
  assert.equal(rt.state.flags.fright, true);
  assert.equal(rt.state.counts.level_cleared, 1);
  assert.equal(rt.state.counts.prize_spawned, 1);
  api.setPos(rt.player(), [8, 3], rt); rt.step();
  assert.equal(rt.state.counts['collected:fruit'], 1);
  assert.equal(rt.state.vars.score, 60 + 50 + 100);
});

test('tilemap: mining and placing cells, block hazards by tag, collectibles and pickups by centre anchor', () => {
  const d = base({ id: 'map', use: 'engine.space.tilemap', with: { size: [20, 12], gravity: 0, edges: { left: 'solid', right: 'solid', bottom: 'solid', top: 'open' } }, zones: [{ id: 'cave', rect: [0, 0, 20, 12] }] }, {
    systems: [{ use: 'gameplay.inventory', with: { start: [{ item: 'pick' }] } }, { use: 'gameplay.blocks.mine', with: { hardnessScale: 0.5 } }, { use: 'gameplay.blocks.place' },
      { use: 'gameplay.hazard', with: { types: [{ id: 'spikes', damage: 1 }] } }, { use: 'gameplay.loot', with: { magnet: 3, magnetSpeed: 30 } }],
    content: { items: [{ id: 'pick', name: 'Pick', kind: 'tool', tool: { kind: 'pick', tier: 1 } }, { id: 'ore', name: 'Ore', kind: 'block', block: 'ore' }],
      blocks: [{ id: 'ore', name: 'Ore', hardness: 1, tool: 'pick', tier: 1 }, { id: 'spikes', name: 'Spikes', solid: false, tags: ['hazard'] }],
      archetypes: [{ id: 'miner', components: { body: { size: [0.8, 0.9], facing: 1 }, health: { hp: 3, max: 3 } } }] },
    player: { archetype: 'miner', at: [2.5, 2.5] },
  });
  assert.ok(checkWith(d).ok, JSON.stringify(checkWith(d).errors));
  const { rt } = make(d), api = rt.space('map');
  api.setCell([4, 2], 'ore', rt);
  for (let i = 0; i < 40 && api.getCell([4, 2]); i++) rt.step({ actions: { mine: true } });
  assert.equal(api.getCell([4, 2]), null, 'mined the tile the player faces');
  assert.equal(rt.state.prim['gameplay.inventory'].player.ore, 1);
  rt.step({ actions: { place: [4, 2] } });
  assert.equal(api.getCell([4, 2]), 'ore');
  // A world pickup drifts to the centre-anchored player.
  rt.spawn(null, { space: 'map', at: [3.5, 4.5], components: { pickup: { item: 'ore', count: 2 } } });
  steps(rt, 20);
  assert.equal(rt.state.prim['gameplay.inventory'].player.ore, 2);
  // A spikes block (tag hazard, id = hazard type) hurts on entry.
  api.setCell([8, 2], 'spikes', rt);
  api.setPos(rt.player(), [8.5, 2.5], rt); rt.step();
  assert.equal(rt.state.counts['hazard_hit:spikes'], 1);
});

test('graph space: interact at the same node, owner shops, containers', () => {
  const d = base({ id: 'town', use: 'engine.space.graph', zones: [{ id: 'square', exits: [{ to: 'inn' }] }, { id: 'inn', exits: [{ to: 'square' }] }] }, {
    systems: [{ use: 'gameplay.inventory' }, { use: 'gameplay.interact' }, { use: 'gameplay.container' },
      { use: 'gameplay.economy', with: { currencies: [{ id: 'gold', start: 20 }], shops: [{ id: 'inn_shop', owner: 'mara', stock: [{ item: 'ale', count: 3, price: 5 }] }] } }],
    plot: { characters: [{ id: 'mara', name: 'Mara' }] },
    content: { items: [{ id: 'ale', name: 'Ale', value: 5 }, { id: 'coin', name: 'Coin', value: 1 }],
      archetypes: [{ id: 'traveller', components: {} }, { id: 'keeper', kind: 'npc', components: { interact: { prompt: 'Talk' } } }, { id: 'chest', components: { interact: { prompt: 'Open' }, container: { items: [{ item: 'ale', count: 2 }] } } }] },
    player: { archetype: 'traveller', at: 'square' },
  });
  assert.ok(checkWith(d).ok, JSON.stringify(checkWith(d).errors));
  const { rt } = make(d);
  rt.spawn('keeper', { id: 'mara', space: 'town', at: 'inn' });
  rt.spawn('chest', { id: 'box', space: 'town', at: 'inn' });
  rt.step();
  assert.equal(rt.service('interact').focus(), null, 'nothing in reach in another node');
  rt.step({ actions: { go: 'inn' } }); rt.step();
  const labels = rt.availableOptions().map(o => o.label);
  assert.ok(labels.includes('interact mara') && labels.includes('interact box'), labels.join('|'));
  assert.equal(new Set(labels).size, labels.length, 'labels are unique');
  rt.step({ actions: { interact: 'mara' } });
  rt.step({ actions: { buy: { item: 'ale', count: 2 } } });
  assert.equal(rt.state.vars['money.gold'], 10);
  rt.step({ actions: { close_shop: true, interact: 'box' } });
  rt.step({ actions: { take_all: true } });
  assert.equal(rt.state.prim['gameplay.inventory'].player.ale, 4);
});

test('the plot solver finishes an interactable puzzle through interact, container and mechanism options', async () => {
  const { solve } = await import('../v2/verify/solve.js');
  // Entities normally come from engine.spawner; a tiny test primitive places them here.
  const placer = { id: 'gameplay.test.place', card: { intent: 'test placement' }, install(rt) { rt.spawn('urn', { id: 'urn1', space: 'crypt', at: 'hall' }); rt.spawn('seal_stone', { id: 'stone1', space: 'crypt', at: 'vault' }); } };
  const d = base({ id: 'crypt', use: 'engine.space.graph', zones: [{ id: 'hall', exits: [{ to: 'vault' }] }, { id: 'vault', exits: [{ to: 'hall' }] }] }, {
    systems: [{ use: 'gameplay.inventory' }, { use: 'gameplay.interact' }, { use: 'gameplay.container' },
      { use: 'gameplay.mechanism', with: { mechanisms: [{ id: 'seal', kind: 'lever', at: [0, 0], signal: 'open' }, { id: 'crypt_door', kind: 'door', at: [0, 0], opens: ['open'], do: [{ do: 'end_game', ending: 'free' }] }] } },
      { use: 'gameplay.test.place' }],
    plot: { endings: [{ id: 'free' }] },
    content: { items: [{ id: 'key', name: 'Key' }],
      archetypes: [{ id: 'ghost', components: {} }, { id: 'urn', components: { interact: { prompt: 'Search' }, container: { items: [{ item: 'key' }], autoTake: true } } },
        { id: 'seal_stone', components: { interact: { prompt: 'Turn', when: { item: 'key' } }, mechanism: 'seal' } }] },
    player: { archetype: 'ghost', at: 'hall' },
  });
  const c = make(d, [placer]);
  const r = solve(c.checked.doc, c.registry, c.logic);
  assert.equal(r.completable, true, JSON.stringify(r).slice(0, 600));
  assert.deepEqual(r.endings.free, ['interact urn1', 'go vault', 'interact seal (stone1)']);
  assert.equal(r.exhaustive, true, 'solver keys keep the state space finite');
});
