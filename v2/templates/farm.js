// Farm: a top-down field on a grid the farmer walks cell by cell. The field is a generated board of grass with rocks:
// every cell no rock covers is grass (the board's `ground`), the open yard along the bottom edge where the farmer starts
// is never rocked, and the board proves every grass cell joins that yard, so tillable soil is in reach at every rock
// `density` the tune range allows; a hoe and two kinds of seed in the inventory; till
// grass into farmland, plant, water each plot every day (a day lasts `daySec`), and harvest what ripens. Turnips are
// done after one harvest, carrots grow back. Harvesting the target number of crops wins (farming's declared
// `when: { count: 'harvested', gte: '$target' }`, wired to a won plot ending evaluated by plot.ending).
export default {
  id: 'farm',
  concept: 'Farming: till soil, plant seeds, water the crops every day and harvest them as they ripen; harvest enough crops to win.',
  doc: {
    schema: 'gameverse.v2.game/0.2', id: 'farm', title: 'Farm', seed: 5, views: { primary: 'td' },
    spaces: [{ id: 'field', use: 'engine.space.grid', with: { scenery: 'meadow', size: [12, 10] },
      generators: [{ use: 'engine.generate.grid.board', with: { kind: 'tactics', ground: 'grass', terrain: [{ block: 'rock', weight: 1, blocks: true }], density: 0.15, symmetry: 'none', teams: 1, deployDepth: 2 } }] }],
    systems: [
      { use: 'gameplay.move.grid', with: { mode: 'step' } },
      { use: 'gameplay.inventory', with: { start: [{ item: 'hoe' }, { item: 'turnip_seed', count: 3 }, { item: 'carrot_seed', count: 3 }] } },
      { use: 'gameplay.farming', with: { crops: [{ item: 'turnip', seed: 'turnip_seed', days: 2 }, { item: 'carrot', seed: 'carrot_seed', days: 3, regrow: 2 }], tillable: ['grass'], farmland: 'farmland', tool: 'tool:hoe', daySec: 6 } },
      { use: 'plot.ending' },
    ],
    content: {
      items: [
        { id: 'hoe', name: 'Hoe', kind: 'tool', tool: { kind: 'hoe', tier: 0 } },
        { id: 'turnip_seed', name: 'Turnip seeds', kind: 'material' },
        { id: 'turnip', name: 'Turnip', kind: 'food' },
        { id: 'carrot_seed', name: 'Carrot seeds', kind: 'material' },
        { id: 'carrot', name: 'Carrot', kind: 'food' },
      ],
      blocks: [{ id: 'grass', name: 'Grass', solid: false, tile: 'grass', color: '#5f9e48' }, { id: 'rock', name: 'Rock', solid: true, tile: 'rock', color: '#8a8478' }, { id: 'farmland', name: 'Farmland', solid: false, tile: 'soil', color: '#7a5434' }],
      archetypes: [{ id: 'farmer', name: 'Farmer', components: {} }],
    },
    plot: { endings: [{ id: 'victory', title: 'Victory', epilogue: 'The harvest is in.', outcome: 'won', when: { count: 'harvested', gte: 8 } }] },
    player: { archetype: 'farmer', at: [1, 0] },
  },
  tune: ['engine.space.grid.scenery', 'gameplay.farming.daySec', 'engine.generate.grid.board.density'],
};
