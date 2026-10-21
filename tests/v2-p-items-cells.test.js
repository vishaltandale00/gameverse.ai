// gameplay.blocks.mine, gameplay.blocks.place, gameplay.farming, gameplay.build.structure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { doc, make, steps, checkWith, codes, gameInstances } from './v2-p-items-fixtures.js';

const bagOf = (rt, who = 'player') => rt.state.prim['gameplay.inventory'][who] || {};
const BLOCKS = [
  { id: 'stone', name: 'Stone', hardness: 1, tool: 'pick', tier: 1, drops: [{ item: 'cobble' }] },
  { id: 'dirt', name: 'Dirt', hardness: 0.25, tool: 'shovel', tier: 0 },
  { id: 'leaves', name: 'Leaves', hardness: 0, drops: [{ item: 'stick', p: 0.5, count: [1, 2] }] },
  { id: 'bedrock', name: 'Bedrock', hardness: 9999 },
  { id: 'planks', name: 'Planks', hardness: 1 },
  { id: 'farmland', name: 'Farmland', hardness: 0.3 },
  { id: 'crop_wheat', name: 'Wheat crop', hardness: 0 },
  { id: 'door', name: 'Door', hardness: 1 },
];
const ITEMS = [
  { id: 'cobble', name: 'Cobble', kind: 'block', block: 'stone' },
  { id: 'b_dirt', name: 'Dirt', kind: 'block', block: 'dirt' },
  { id: 'b_planks', name: 'Planks', kind: 'block', block: 'planks', stack: 64 },
  { id: 'stick', name: 'Stick', kind: 'material' },
  { id: 'wood_pick', name: 'Wood pick', kind: 'tool', tool: { kind: 'pick', tier: 0 } },
  { id: 'stone_pick', name: 'Stone pick', kind: 'tool', tool: { kind: 'pick', tier: 1, durability: 10 } },
  { id: 'hoe', name: 'Hoe', kind: 'tool', tool: { kind: 'hoe', tier: 0 } },
  { id: 'seeds', name: 'Seeds', kind: 'material' },
  { id: 'wheat', name: 'Wheat', kind: 'material' },
  { id: 'bench', name: 'Workbench', kind: 'prop', place: 'bench_prop' },
  { id: 'deed', name: 'Deed', kind: 'key' },
];
const hero = { id: 'hero', kind: 'player', components: { body: { size: [1, 1, 1], facing: [1, 0, 0] } } };
const ARCH = [hero, { id: 'bench_prop', kind: 'prop', components: { station: 'bench' } }, { id: 'villager', kind: 'npc', components: { body: { size: [1, 1, 1] } } }];
const world = (systems, start = []) => doc({
  systems: [{ use: 'gameplay.inventory', with: { start } }, ...systems],
  zones: [{ id: 'yard', rect: [0, 0, 8, 16] }, { id: 'park', rect: [8, 0, 16, 16] }, { id: 'lot', rect: [16, 0, 32, 16] }],
  content: { items: ITEMS, blocks: BLOCKS, archetypes: ARCH },
});
const put = (rt, cells) => { for (const [at, b] of cells) rt.space('world').setCell(at, b, rt); };
const goTo = (rt, at) => rt.space('world').setPos(rt.player(), at, rt);

// ---------- mine ----------
test('blocks.mine: hold to mine, tool tiers, drops, unbreakable and protected cells', () => {
  const d = world([{ use: 'gameplay.blocks.mine', with: { reach: 4, hardnessScale: 1, tierSpeed: [2, 4], wrongToolPenalty: 3, protect: ['park'] } }, { use: 'gameplay.equipment', with: { durability: true, slots: [{ id: 'hand', accepts: ['tool'] }] } }], [{ item: 'wood_pick' }]);
  assert.ok(checkWith(d).ok, JSON.stringify(checkWith(d).errors));
  const { rt } = make(d);
  put(rt, [[[3, 1, 0], 'stone'], [[1, 3, 0], 'leaves'], [[4, 4, 0], 'bedrock'], [[9, 1, 0], 'dirt']]);
  // A wood pick is too weak for stone: 1 s × 3 penalty, and no drop.
  for (let i = 0; i < 100; i++) rt.step({ actions: { mine: true } });
  assert.equal(rt.space('world').getCell([3, 1, 0]), 'stone', 'not yet');
  for (let i = 0; i < 90; i++) rt.step({ actions: { mine: true } });
  assert.equal(rt.space('world').getCell([3, 1, 0]), null);
  assert.equal(rt.state.counts['block_mined:stone'], 1);
  assert.equal(bagOf(rt).cobble, undefined, 'wrong tier: no drop');
  // A stone pick mines at 4× and drops cobble; letting go resets progress.
  put(rt, [[[3, 1, 0], 'stone']]); rt.run([{ do: 'give_item', item: 'stone_pick' }]);
  for (let i = 0; i < 10; i++) rt.step({ actions: { mine: true } });
  rt.step();
  for (let i = 0; i < 10; i++) rt.step({ actions: { mine: true } });
  assert.equal(rt.space('world').getCell([3, 1, 0]), 'stone', 'released halfway');
  for (let i = 0; i < 16; i++) rt.step({ actions: { mine: true } });
  assert.equal(bagOf(rt).cobble, 1);
  assert.ok(rt.test({ mined: 'stone', gte: 2 }));
  assert.equal(rt.state.counts.tool_used, 2);
  // Explicit cell targets; instant blocks; bedrock refuses; protected zone refuses.
  rt.step({ actions: { mine: [1, 3, 0] } });
  assert.equal(rt.space('world').getCell([1, 3, 0]), null);
  rt.step({ actions: { mine: [4, 4, 0] } });
  assert.equal(rt.state.events.find(e => e.name === 'mine_denied').reason, 'unbreakable');
  goTo(rt, [7, 1, 0]); rt.step({ actions: { mine: [9, 1, 0] } });
  assert.equal(rt.state.events.find(e => e.name === 'mine_denied').reason, 'protected');
  goTo(rt, [1, 1, 0]); put(rt, [[[3, 1, 0], 'stone']]); rt.step();
  const opt = rt.availableOptions().find(o => o.label === 'mine stone');
  assert.ok(opt?.steps > 1);
  for (let i = 0; i < opt.steps; i++) rt.step({ actions: opt.actions });
  assert.equal(rt.state.counts['block_mined:stone'], 3);
});

test('blocks.mine: replay and bad config codes', () => {
  const d = world([{ use: 'gameplay.blocks.mine' }], [{ item: 'stone_pick' }]);
  const play = () => { const { rt } = make(d); put(rt, [[[3, 1, 0], 'stone'], [[2, 2, 0], 'leaves'], [[2, 1, 0], 'leaves']]); for (let i = 0; i < 120; i++) rt.step({ actions: { mine: i % 3 ? true : [2, 2, 0] } }); return rt.snapshot(); };
  assert.deepEqual(play(), play());
  const bad = world([{ use: 'gameplay.blocks.mine', with: { reach: 0, protect: ['moon'] } }]);
  bad.content.blocks[0].hardness = -1; bad.content.blocks[2].drops = [{ item: 'pearl', p: 3 }];
  const c = codes(checkWith(bad));
  for (const code of ['param_range', 'ref_unknown', 'block_invalid']) assert.ok(c.includes(code), code);
  for (const x of gameInstances('gameplay.blocks.mine')) assert.deepEqual(x.paramErrors, [], x.game);
});

// ---------- place ----------
test('blocks.place: aimed and explicit placement, props, protection, occupancy and set_blocks', () => {
  const d = world([{ use: 'gameplay.blocks.place', with: { reach: 5, protect: ['park'], forbidNear: ['npc'], snap: true } }], [{ item: 'b_planks', count: 10 }, { item: 'bench' }]);
  assert.ok(checkWith(d).ok, JSON.stringify(checkWith(d).errors));
  const { rt } = make(d);
  put(rt, [[[4, 1, 0], 'stone']]);
  rt.step({ actions: { select_item: 'b_planks' } });
  assert.deepEqual(rt.state.prim['gameplay.blocks.place'].ghost.player.at, [3, 1, 0], 'ghost preview in front of the face');
  rt.step({ actions: { place: true } });
  assert.equal(rt.space('world').getCell([3, 1, 0]), 'planks');
  assert.equal(bagOf(rt).b_planks, 9);
  assert.equal(rt.state.counts['block_placed:planks'], 1);
  rt.step({ actions: { place: [3, 1, 0] } });
  assert.equal(rt.state.events.find(e => e.name === 'place_denied').reason, 'occupied');
  rt.step({ actions: { place: [1, 1, 0] } });
  assert.equal(rt.state.events.find(e => e.name === 'place_denied').reason, 'blocked', 'the player stands there');
  rt.step({ actions: { place: [1, 5, 0] } });
  assert.equal(rt.state.events.find(e => e.name === 'place_denied').reason, 'unsupported', 'snap needs a neighbour');
  rt.step({ actions: { place: [3, 2, 0] } });
  assert.equal(rt.space('world').getCell([3, 2, 0]), 'planks');
  goTo(rt, [7, 1, 0]); put(rt, [[[9, 0, 0], 'stone']]);
  rt.step({ actions: { place: [9, 1, 0] } });
  assert.equal(rt.state.events.find(e => e.name === 'place_denied').reason, 'protected');
  rt.spawn('villager', { at: [6, 4, 0] });
  rt.step({ actions: { place: [6, 3, 0] } });
  assert.equal(rt.state.events.find(e => e.name === 'place_denied').reason, 'forbidden');
  // Prop items spawn their archetype.
  rt.step({ actions: { place: { cell: [7, 0, 0], item: 'bench' } } });
  assert.equal(rt.state.counts['prop_placed:bench_prop'], 1);
  assert.ok(Object.values(rt.state.entities).some(e => e.archetype === 'bench_prop'));
  rt.run([{ do: 'set_blocks', box: [[20, 0, 0], [22, 1, 0]], block: 'stone' }]);
  assert.equal(rt.space('world').cellsIn([[20, 0, 0], [22, 1, 0]]).length, 6);
  rt.run([{ do: 'set_blocks', cells: [[20, 0, 0]] }]);
  assert.equal(rt.space('world').getCell([20, 0, 0]), null);
});

test('blocks.place: replay and bad config codes', () => {
  const d = world([{ use: 'gameplay.blocks.place' }], [{ item: 'b_planks', count: 20 }]);
  const play = () => { const { rt } = make(d); put(rt, [[[5, 1, 0], 'stone']]); for (let i = 0; i < 30; i++) rt.step({ actions: { place: i % 2 ? true : [2 + (i % 5), 3, 0] } }); return rt.snapshot(); };
  assert.deepEqual(play(), play());
  const bad = world([{ use: 'gameplay.blocks.place', with: { forbidRadius: -2, snap: 1 } }]);
  bad.content.items[0].block = 'marble'; bad.content.items[9].place = 'castle';
  bad.plot = { storyboard: { acts: [{ id: 'a', beats: [{ id: 'b', do: [{ do: 'set_blocks', block: 'stone' }] }] }] } }; bad.systems.push({ use: 'plot.storyboard' });
  const c = codes(checkWith(bad));
  for (const code of ['param_range', 'param_type', 'ref_unknown', 'effect_invalid']) assert.ok(c.includes(code), code);
  for (const x of gameInstances('gameplay.blocks.place')) assert.deepEqual(x.paramErrors, [], x.game);
});

// ---------- farming ----------
// A side-on world (the test space with depth has up = y, card.frame): the stage block goes in the cell above the farmland.
// (Corrected expectation: this world was a plane seen from above, where [2, 1, 0] is the neighbouring field cell, not
// the cell above; the plane case is the farm template test below.)
const farm = () => { const d = world([{ use: 'gameplay.farming', with: { crops: [{ item: 'wheat', seed: 'seeds', days: 2, seasons: ['spring', 'summer'], yield: [2, 3], block: 'crop_wheat', regrow: 1 }], tillable: ['dirt'] } }], [{ item: 'hoe' }, { item: 'seeds', count: 3 }]); d.spaces[0].with.size = [32, 16, 2]; return d; };

test('farming: till, plant, water, grow by day and season, harvest, regrow, wither', () => {
  assert.ok(checkWith(farm()).ok, JSON.stringify(checkWith(farm()).errors));
  const { rt } = make(farm());
  put(rt, [[[2, 0, 0], 'dirt'], [[3, 0, 0], 'dirt']]);
  rt.state.vars['time.season'] = 0;
  rt.step({ actions: { till: { cell: [2, 0, 0] } } });
  assert.equal(rt.space('world').getCell([2, 0, 0]), 'farmland');
  rt.step({ actions: { plant: { cell: [2, 0, 0] } } });
  assert.equal(rt.space('world').getCell([2, 1, 0]), 'crop_wheat', 'stage block above');
  assert.equal(bagOf(rt).seeds, 2);
  rt.step({ actions: { plant: { cell: [3, 0, 0] } } });
  assert.equal(rt.state.events.find(e => e.name === 'farm_denied').reason, 'soil');
  // Unwatered days do not grow; watered days do.
  rt.state.vars['time.day'] = 1; rt.step();
  assert.ok(rt.test({ crops: 'growing', eq: 1 }));
  for (let day = 2; day <= 3; day++) { rt.step({ actions: { water: { cell: [2, 0, 0] } } }); rt.state.vars['time.day'] = day; rt.step(); }
  assert.equal(rt.state.counts['ripened:wheat'], 1);
  assert.ok(rt.test({ crops: 'ripe', gte: 1 }));
  const opt = rt.availableOptions().find(o => o.label.startsWith('harvest wheat'));
  rt.step({ actions: opt.actions });
  assert.ok(bagOf(rt).wheat >= 2 && bagOf(rt).wheat <= 3);
  // Regrows in one watered day; rain waters it.
  rt.state.vars.weather = 'rain'; rt.state.vars['time.day'] = 4; rt.step();
  assert.equal(rt.state.counts['ripened:wheat'], 2);
  // Autumn withers it.
  rt.step({ actions: { harvest: { cell: [2, 0, 0] } } });
  rt.state.vars['time.season'] = 'autumn'; rt.state.vars['time.day'] = 5; rt.step();
  assert.equal(rt.state.counts.withered, 1);
  assert.equal(rt.space('world').getCell([2, 1, 0]), null, 'stage block cleared');
  // Without a hoe there is no tilling.
  rt.run([{ do: 'take_item', item: 'hoe' }]);
  rt.step({ actions: { till: { cell: [3, 0, 0] } } });
  assert.equal(rt.state.events.find(e => e.name === 'farm_denied').reason, 'tool');
});

test('farming on a plane seen from above (the farm template): a crop\'s stage block never lands on another cell; its mark shows the stage', async () => {
  const { default: tpl } = await import('../v2/templates/farm.js');
  const d = structuredClone(tpl.doc), sid = d.spaces[0].id;
  d.content.blocks.push({ id: 'sprout', name: 'Sprout', solid: false, tile: 'grass', color: '#7ac050' });
  const farming = d.systems.find(s => s.use === 'gameplay.farming');
  for (const c of farming.with.crops) { c.block = 'sprout'; c.water = false; }
  farming.with.daySec = 1;
  const { rt } = make(d), sp = rt.space(sid), [w, h] = d.spaces[0].with.size;
  const cells = () => { const out = {}; for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) out[`${x},${y}`] = sp.getCell([x, y, 0]); return out; };
  // Every cell next to the player gets a plot, so a stage block written "above" any of them would land on a plot or the field.
  const p = rt.player().at, plots = [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([dx, dy]) => [p[0] + dx, p[1] + dy, 0]).filter(c => c[0] >= 0 && c[1] >= 0 && c[0] < w && c[1] < h && farming.with.tillable.includes(sp.getCell(c)));
  assert.ok(plots.length >= 2, 'the yard has grass next to the farmer');
  for (const c of plots) { rt.step({ actions: { till: { cell: c } } }); rt.step({ actions: { plant: { cell: c } } }); }
  // Bare cells (no block) around the plots: a write "above" a plot would fill one.
  for (const c of plots) for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) { const n = [c[0] + dx, c[1] + dy, 0]; if (n[0] >= 0 && n[1] >= 0 && n[0] < w && n[1] < h && !plots.some(q => q[0] === n[0] && q[1] === n[1]) && (n[0] !== p[0] || n[1] !== p[1])) sp.setCell(n, null, rt); }
  const planted = cells();
  for (const c of plots) assert.equal(planted[`${c[0]},${c[1]}`], 'farmland', `the plot at ${c} stays farmland`);
  steps(rt, 60 * 4);
  assert.ok(rt.state.counts.ripened >= 1, 'crops ripened');
  assert.deepEqual(cells(), planted, 'growing and ripening wrote no cell: no stage block on a neighbouring cell');
  const marks = rt.service('farming').marks(sid);
  assert.equal(marks.length, plots.length);
  for (const m of marks) assert.ok(m.stage >= 1 && m.stages >= m.stage, 'the mark carries the growth stage');
});

test('farming: internal day clock, replay and bad config codes', () => {
  const d = farm(); d.systems[1].with.daySec = 1; d.systems[1].with.crops[0].water = false;
  const play = () => { const { rt } = make(d); put(rt, [[[2, 0, 0], 'dirt']]); rt.step({ actions: { till: { cell: [2, 0, 0] } } }); rt.step({ actions: { plant: { cell: [2, 0, 0] } } }); steps(rt, 130); return rt; };
  const a = play(), b = play();
  assert.equal(a.state.counts['ripened:wheat'], 1, 'two internal days');
  assert.deepEqual(a.snapshot(), b.snapshot());
  const bad = farm();
  bad.systems[1].with.farmland = 'mud'; bad.systems[1].with.crops[0].yield = 'lots'; bad.systems[1].with.crops[0].days = 0;
  bad.systems[1].with.crops.push({ item: 'wheat', seed: 'seeds' }, { item: 'ghost_corn' });
  const c = codes(checkWith(bad));
  for (const code of ['farming_invalid', 'param_range', 'ref_unknown']) assert.ok(c.includes(code), code);
  for (const x of gameInstances('gameplay.farming')) assert.deepEqual(x.paramErrors, [], x.game);
});

// ---------- build.structure ----------
const town = () => world([{ use: 'gameplay.build.structure', with: { pieces: ['wall', 'door', { id: 'hut', size: [2, 2, 1], cost: [{ item: 'stick', count: 2 }] }], block: 'planks', ownership: true, plots: [{ zone: 'lot', when: { item: 'deed' } }, { zone: 'yard' }], slots: [{ id: 'gate', zone: 'yard', piece: 'door', onFilled: [{ do: 'set_flag', flag: 'gate_built' }] }], refund: 0.5 } }], [{ item: 'b_planks', count: 20 }, { item: 'stick', count: 2 }]);

test('build.structure: pieces, rotation, costs, plots, slots and demolish refunds', () => {
  assert.ok(checkWith(town()).ok, JSON.stringify(checkWith(town()).errors));
  const { rt } = make(town());
  rt.state.flags['owns.yard'] = true;
  rt.step({ actions: { build: { piece: 'wall', at: [2, 0, 0] } } });
  assert.equal(rt.state.counts['built:wall'], 1);
  assert.equal(rt.space('world').cellsIn([[2, 0, 0], [4, 2, 0]]).length, 9);
  assert.equal(bagOf(rt).b_planks, 11, 'one plank per cell');
  rt.step({ actions: { build: { piece: 'hut', at: [5, 6, 0], rot: 1 } } });
  // Rotated 90° about y the hut runs along -z, out of this one-cell-deep space: rolled back.
  assert.equal(rt.state.events.find(e => e.name === 'build_denied').reason, 'bounds');
  assert.equal(rt.space('world').cellsIn([[5, 6, 0], [6, 7, 0]]).length, 0);
  rt.step({ actions: { build: { piece: 'hut', at: [2, 0, 0] } } });
  assert.equal(rt.state.events.find(e => e.name === 'build_denied').reason, 'occupied');
  rt.step({ actions: { build: { piece: 'hut', at: [5, 6, 0] } } });
  assert.equal(rt.state.counts['built:hut'], 1);
  assert.equal(bagOf(rt).stick, undefined, 'explicit cost paid');
  rt.step({ actions: { build: { piece: 'door', at: [6, 0, 0] } } });
  assert.equal(rt.state.flags.gate_built, true);
  assert.ok(rt.test({ slot_filled: 'gate' }));
  assert.equal(bagOf(rt).b_planks, 11, 'no item places door blocks, so doors cost nothing here');
  // The lot needs a deed.
  rt.space('world').setPos(rt.player(), [17, 1, 0], rt);
  rt.step({ actions: { build: { piece: 'door', at: [18, 0, 0] } } });
  assert.equal(rt.state.events.find(e => e.name === 'build_denied').reason, 'plot');
  rt.run([{ do: 'give_item', item: 'deed' }]);
  rt.step({ actions: { build: { piece: 'door', at: [18, 0, 0] } } });
  assert.ok(rt.test({ structures: 'door', eq: 2 }));
  rt.step({ actions: { demolish: 's2' } });
  assert.equal(bagOf(rt).stick, 1, 'half refunded');
  assert.ok(rt.test({ structures: '*', eq: 3 }), 'wall + two doors');
});

test('build.structure: replay and bad config codes', () => {
  const play = () => { const { rt } = make(town()); rt.state.flags['owns.yard'] = true; for (let i = 0; i < 6; i++) rt.step({ actions: { build: { piece: ['door', 'hut'][i % 2], at: [i, 0, 0] } } }); return rt.snapshot(); };
  assert.deepEqual(play(), play());
  const bad = town();
  const w = bad.systems[1].with;
  w.pieces.push('castle', { id: 'blob' }, { id: 'wall', size: [1, 1, 1], block: 'marble' });
  w.slots.push({ id: 's2', zone: 'yard', piece: 'tower' });
  w.grid = 0;
  const c = codes(checkWith(bad));
  for (const code of ['piece_unknown', 'piece_invalid', 'id_duplicate', 'ref_unknown', 'param_range']) assert.ok(c.includes(code), code);
  for (const x of gameInstances('gameplay.build.structure')) assert.deepEqual(x.paramErrors, [], x.game);
});
