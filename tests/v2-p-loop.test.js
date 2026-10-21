// The game's loop is the composition of what its primitives' cards declare (card.loop, card.mode the richer form).
// Declarations are checked against each card's own events, actions and params; loopOf reads a document's loop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogue } from '../v2/planner/catalog.js';
import { cardLoop, loopOf, composeLoop, winProviders, endsGame, loopServes } from '../v2/planner/loop.js';

const { registry } = buildCatalogue();
const cards = registry.cards();

test('every declared loop names its card\'s own events, actions and effects params', () => {
  const bad = [];
  for (const c of cards) {
    if (!c.loop) continue;
    const events = new Set(c.provides?.events || []), actions = new Set(c.provides?.actions || []);
    for (const e of c.loop.progress || []) if (!events.has(e)) bad.push(`${c.id}: progress '${e}' is not a provided event`);
    for (const v of c.loop.verbs || []) if (!actions.has(v)) bad.push(`${c.id}: verb '${v}' is not a provided action`);
    for (const side of ['win', 'lose']) {
      const p = c.loop[side]?.param; if (!p) continue;
      const [k, f] = p.split('.'), s = c.params?.[k];
      if (!s || (f ? s.of?.fields?.[f]?.type !== 'effects' : s.type !== 'effects')) bad.push(`${c.id}: ${side}.param '${p}' is not an effects param`);
    }
    if (!(c.loop.progress || []).length) bad.push(`${c.id}: no progress events`);
  }
  assert.deepEqual(bad, []);
});

test('the primitives that carry play declare a loop with progress (loop owners and the gameplay the planner composes)', () => {
  const must = ['gameplay.farming', 'gameplay.collectible', 'gameplay.crafting', 'gameplay.blocks.mine', 'gameplay.blocks.place', 'gameplay.encounter', 'gameplay.economy',
    'gameplay.match', 'gameplay.ai.brain', 'gameplay.ai.motion', 'gameplay.mechanism', 'gameplay.interact', 'gameplay.inventory', 'gameplay.equipment', 'gameplay.loot', 'gameplay.destructible',
    ...cards.filter(c => /^gameplay\.(combat|creature)\./.test(c.id)).map(c => c.id), ...cards.filter(c => c.mode).map(c => c.id)];
  for (const id of must) assert.ok(cardLoop(registry.get(id)?.card)?.progress.length, `${id} declares card.loop.progress`);
});

test('card.mode is the richer form: cardLoop merges it under card.loop, field by field', () => {
  const turns = cardLoop(registry.get('gameplay.turns').card);
  assert.equal(turns.win.param, 'onVictory', 'the mode\'s win');
  assert.ok(turns.progress.includes('unit_moved'), 'the loop\'s progress');
  assert.equal(turns.interaction, 'pieces-turns');
  const battle = cardLoop(registry.get('gameplay.creature.battle').card);
  assert.equal(battle.win.scope, 'encounter', 'a battle win resolves an encounter, not the game');
  assert.equal(endsGame(battle.win), false);
  const coins = cardLoop(registry.get('gameplay.collectible').card);
  assert.deepEqual(coins.win.applies, { param: 'counters', field: 'clearsLevel', is: true }, 'the counter the win needs');
});

test('a loop declares the set of interactions it serves: cardLoop reads a string or a list, loopServes tests membership', () => {
  const coins = cardLoop(registry.get('gameplay.collectible').card);
  assert.deepEqual(coins.interactions, ['avatar-grid', 'avatar-realtime'], 'counting pickups does not care how the avatar moves');
  assert.equal(coins.interaction, 'avatar-grid', 'the first entry, for display');
  for (const i of ['avatar-grid', 'avatar-realtime']) assert.equal(loopServes(coins, i), true, i);
  assert.equal(loopServes(coins, 'cursor-board'), false);
  const board = cardLoop(registry.get('gameplay.match').card);
  assert.deepEqual(board.interactions, ['cursor-board']);
  assert.equal(loopServes(board, 'avatar-realtime'), false);
  const listed = cardLoop({ mode: { interaction: ['menu', 'pieces-turns', 'menu', ''] } });
  assert.deepEqual(listed.interactions, ['menu', 'pieces-turns'], 'a list, deduplicated');
  const wrapper = cardLoop(registry.get('gameplay.stage.sequence').card);
  assert.deepEqual(wrapper.interactions, [], "'any': a wrapper takes the interaction of the loop it wraps");
  assert.equal(loopServes(wrapper, 'cursor-board'), true);
  assert.equal(loopServes(board, null), true, 'an undecided interaction constrains nothing');
});

test('loopOf: a document\'s core collection, its progress events and the wins and losses that apply to its config', () => {
  const doc = { systems: [{ use: 'gameplay.farming' }, { use: 'gameplay.collectible', with: { counters: [] } }, { use: 'gameplay.inventory' }, { use: 'engine.input.actions' }],
    spaces: [{ id: 'w', use: 'engine.space.voxel', generators: [] }] };
  const l = loopOf(doc, registry);
  assert.deepEqual(l.primitives.map(p => p.use), ['gameplay.farming', 'gameplay.collectible', 'gameplay.inventory']);
  assert.equal(l.primitives[0].path, 'systems[0]');
  assert.ok(l.progress.includes('harvested') && l.progress.includes('collected') && l.progress.includes('item_gained'));
  assert.deepEqual(l.win.map(w => w.use), ['gameplay.farming'], 'the collectible has no counter that completes, so no win');
  const only = loopOf(doc, registry, { core: ['gameplay.collectible'] });
  assert.deepEqual(only.primitives.map(p => p.use), ['gameplay.collectible']);
});

test('a collection without a declared win is a type hole naming its primitives; winProviders lists what could add one', () => {
  const c = composeLoop(['gameplay.blocks.mine', 'gameplay.blocks.place', 'gameplay.inventory'], registry, { core: ['gameplay.blocks.mine', 'gameplay.blocks.place'] });
  assert.equal(c.win, null);
  assert.deepEqual(c.holes.map(h => h.code), ['loop_win_undeclared']);
  assert.deepEqual(c.holes[0].primitives, ['gameplay.blocks.mine', 'gameplay.blocks.place']);
  const voxel = registry.get('engine.space.voxel').card.provides.capabilities;
  const add = winProviders(registry, { caps: [voxel] });
  assert.ok(add.length && add.every(p => endsGame(p.end)));
  assert.ok(add.every(p => (registry.get(p.id).card.requires?.capabilities || []).every(x => voxel.includes(x))));
  const chess = composeLoop(['gameplay.turns', 'gameplay.creature.battle'], registry, { core: ['gameplay.creature.battle', 'gameplay.turns'] });
  assert.equal(chess.win.use, 'gameplay.turns', 'the battle resolves captures; the turns victory ends the game');
});
