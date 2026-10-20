import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, testSpace } from '../v2/kernel/testing.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import { preflight } from '../v2/kernel/document.js';
import inventory from '../v2/primitives/gameplay/inventory.js';
import party from '../v2/primitives/gameplay/creature-party.js';
import battle from '../v2/primitives/gameplay/creature-battle.js';
import catcher from '../v2/primitives/gameplay/creature-catch.js';
import encounter from '../v2/primitives/gameplay/encounter.js';
import { calcDamage, statsOf, effectiveness, captureOdds, expToLevel } from '../v2/primitives/gameplay/puzzle-lib-creature.js';

const PRIMS = [testSpace, inventory, party, battle, catcher, encounter];
const B = (hp, atk, def, spa, spd, spe) => ({ hp, atk, def, spa, spd, spe });
const content = () => ({
  types: { fire: { grass: 2, water: 0.5, fire: 0.5 }, water: { fire: 2, grass: 0.5 }, grass: { water: 2, fire: 0.5 }, normal: {} },
  moves: [
    { id: 'tackle', name: 'Tackle', type: 'normal', category: 'physical', power: 40, accuracy: 100, pp: 35 },
    { id: 'quick', name: 'Quick Hit', type: 'normal', category: 'physical', power: 40, accuracy: 100, pp: 30, priority: 1 },
    { id: 'vine', name: 'Vine', type: 'grass', category: 'special', power: 45, accuracy: 100, pp: 25 },
    { id: 'ember', name: 'Ember', type: 'fire', category: 'special', power: 40, accuracy: 100, pp: 25, effect: { kind: 'status', status: 'burn', chance: 10 } },
    { id: 'growl', name: 'Growl', type: 'normal', category: 'status', power: 0, accuracy: 100, pp: 40, effect: { kind: 'stat', stat: 'atk', stages: -1, target: 'foe' } },
    { id: 'leaf', name: 'Leaf Storm', type: 'grass', category: 'special', power: 90, accuracy: 100, pp: 10 },
  ],
  species: [
    { id: 'sprout', name: 'Sprout', types: ['grass'], base: B(45, 49, 49, 65, 65, 45), catchRate: 45, expYield: 64, growth: 'medium', learnset: [{ level: 1, move: 'tackle' }, { level: 3, move: 'growl' }, { level: 7, move: 'vine' }, { level: 10, move: 'quick' }, { level: 16, move: 'leaf' }], evolves: { level: 16, to: 'bloom' } },
    { id: 'bloom', name: 'Bloom', types: ['grass'], base: B(60, 62, 63, 80, 80, 60), catchRate: 45, expYield: 142, growth: 'medium', learnset: [{ level: 1, move: 'tackle' }] },
    { id: 'ember_pup', name: 'Ember Pup', types: ['fire'], base: B(39, 52, 43, 60, 50, 65), catchRate: 45, expYield: 62, growth: 'medium', learnset: [{ level: 1, move: 'tackle' }, { level: 4, move: 'ember' }] },
    { id: 'mote', name: 'Mote', types: ['normal'], base: B(1, 1, 1, 1, 1, 1), catchRate: 255, expYield: 200, growth: 'fast', learnset: [{ level: 1, move: 'growl' }] },
  ],
  items: [{ id: 'orb', name: 'Orb', creature: { kind: 'ball', value: 1 } }, { id: 'tonic', name: 'Tonic', creature: { kind: 'heal', value: 20 } }],
  archetypes: [{ id: 'hero', components: {} }],
});
const doc = ({ start = [{ species: 'sprout', level: 8 }], systems = [], partyWith = {} } = {}) => ({
  schema: 'gameverse.v2.game/0.2', id: 'monsters', title: 'Monsters', seed: 21,
  spaces: [
    { id: 'world', use: 'engine.space.test', with: { size: [10, 10, 1], solid: [[5, 5, 0]] }, zones: [{ id: 'route', rect: [0, 0, 5, 10] }, { id: 'town', rect: [5, 0, 10, 10] }] },
    { id: 'arena', use: 'engine.space.test', with: { size: [2, 2, 1] } },
  ],
  systems: [
    { use: 'gameplay.inventory', with: { start: [{ item: 'orb', count: 3 }, { item: 'tonic', count: 2 }] } },
    { use: 'gameplay.creature.party', with: { start, ...partyWith } },
    { use: 'gameplay.creature.battle', with: { space: 'arena' } },
    { use: 'gameplay.creature.catch', with: { balls: [{ item: 'orb', bonus: 1 }] } },
    ...systems,
  ],
  content: content(),
  player: { archetype: 'hero', space: 'world', at: [8, 1, 0] },
});
const P = rt => rt.state.prim['gameplay.creature.party'].owners.player;
const BT = rt => rt.state.prim['gameplay.creature.battle'];
/** Play the battle by taking the first option each turn (moves first). */
const playOut = (rt, pick = o => o[0]) => { for (let i = 0; i < 400 && BT(rt).battle; i++) { const o = rt.availableOptions(); if (!o.length) { rt.step(); continue; } rt.step({ actions: pick(o).actions }); } };

test('creature party: starting creatures follow the stat formula, learnset and dex', () => {
  const { rt, checked } = compile(doc(), { primitives: PRIMS });
  assert.ok(checked.ok, JSON.stringify(checked.errors));
  const c = P(rt).party[0], sp = content().species[0];
  assert.equal(c.level, 8);
  assert.deepEqual(c.moves.map(m => m.id), ['tackle', 'growl', 'vine'], 'moves learned by level 8');
  const hp = Math.floor((2 * sp.base.hp + c.ivs.hp) * 8 / 100) + 8 + 10;
  assert.equal(statsOf(rt.doc.content, c).hp, hp);
  assert.equal(c.hp, hp);
  assert.equal(c.exp, expToLevel('medium', 8));
  assert.equal(rt.state.vars['dex.caught'], 1);
  assert.ok(rt.test({ has_creature: 'sprout' }));
  assert.ok(rt.test({ dex: 'sprout', state: 'caught' }));
});

test('creature party: overflow goes to the box; exp levels up, learns and evolves', () => {
  const { rt } = compile(doc({ start: [{ species: 'sprout', level: 15 }], partyWith: { size: 1 } }), { primitives: PRIMS });
  rt.run([{ do: 'give_creature', species: 'ember_pup', level: 5 }]);
  assert.equal(P(rt).box.length, 1);
  assert.equal(rt.state.counts.creature_boxed, 1);
  rt.run([{ do: 'creature_exp', amount: expToLevel('medium', 16) - expToLevel('medium', 15) }]);
  const c = P(rt).party[0];
  assert.equal(c.level, 16);
  assert.equal(c.species, 'bloom');
  assert.equal(rt.state.counts['creature_evolved:bloom'], 1);
  assert.ok(c.moves.some(m => m.id === 'leaf'), 'learned the level-16 move (oldest forgotten)');
  assert.equal(c.moves.length, 4);
});

test('creature rules: damage formula, STAB, type chart and capture odds are exact', () => {
  const ct = content();
  const att = { species: 'sprout', level: 10, ivs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, status: null };
  const def = { species: 'ember_pup', level: 10, ivs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, status: null, hp: 1 };
  const A = statsOf(ct, att).spa, D = statsOf(ct, def).spd;
  const base = Math.floor(Math.floor(Math.floor(2 * 10 / 5 + 2) * 45 * A / D) / 50) + 2;
  const want = Math.floor(Math.floor(base * 1.5) * 0.5); // STAB grass, grass vs fire 0.5
  const r = calcDamage(ct, { attacker: att, defender: def, move: ct.moves[2], rand: () => 0.5, crit: false, roll: 100 });
  assert.equal(r.damage, want); assert.equal(r.stab, true); assert.equal(r.eff, 0.5);
  const crit = calcDamage(ct, { attacker: att, defender: def, move: ct.moves[2], rand: () => 0.5, crit: true, roll: 85 });
  assert.equal(crit.damage, Math.floor(Math.floor(Math.floor(Math.floor(base * 1.5) * 85 / 100) * 1.5) * 0.5));
  assert.equal(effectiveness(ct, 'water', ['fire']), 2);
  assert.equal(captureOdds(ct, { ...def, species: 'mote' }, 2).probability, 1, 'a >= 255 always catches');
  assert.ok(captureOdds(ct, { ...def, species: 'mote' }, 1).probability < 1);
  const o = captureOdds(ct, { ...def, hp: statsOf(ct, def).hp }, 1);
  assert.equal(o.a, Math.floor((3 * statsOf(ct, def).hp - 2 * statsOf(ct, def).hp) * 45 / (3 * statsOf(ct, def).hp)));
});

test('creature battle: a wild battle moves the player to the battle space and back, with exp', () => {
  const { rt } = compile(doc(), { primitives: PRIMS });
  const exp0 = P(rt).party[0].exp;
  rt.run([{ do: 'start_battle', foe: [{ species: 'mote', level: 3 }] }]);
  assert.equal(rt.player().space, 'arena');
  assert.equal(rt.state.counts['battle_start:wild'], 1);
  assert.ok(rt.test({ in_battle: true }));
  playOut(rt, o => o.find(x => x.actions.battle.kind === 'move' && x.label !== 'use growl') || o[0]);
  assert.equal(rt.state.counts['battle_end:win'], 1);
  assert.equal(rt.player().space, 'world');
  assert.deepEqual(rt.player().at, [8, 1, 0]);
  assert.ok(P(rt).party[0].exp > exp0, 'experience written back to the party');
  assert.ok(rt.state.counts.turn_start >= 1 && rt.state.counts.turn_end >= 1);
  assert.equal(rt.state.counts['creature_defeated:mote'], 1);
});

test('creature battle: balls capture through the capture service and use up inventory', () => {
  const d = doc(); d.systems[3].with.balls = [{ item: 'orb', bonus: 10 }];
  const { rt } = compile(d, { primitives: PRIMS });
  rt.run([{ do: 'start_battle', foe: [{ species: 'mote', level: 2 }] }]);
  const ball = rt.availableOptions().find(o => o.actions.battle.item === 'orb');
  assert.ok(ball);
  rt.step({ actions: ball.actions });
  assert.equal(rt.state.counts['caught:mote'], 1);
  assert.equal(rt.state.counts['battle_end:capture'], 1);
  assert.equal(P(rt).party.length, 2);
  assert.equal(rt.state.prim['gameplay.inventory'].player.orb, 2);
});

test('creature battle: escape from wild battles; trainers cannot be fled and pay prizes once', () => {
  const trainers = [{ id: 'kid', name: 'Kid', party: [{ species: 'mote', level: 2 }], prize: 120, onDefeat: [{ do: 'set_flag', flag: 'beat_kid' }] }];
  const { rt } = compile(doc({ start: [{ species: 'sprout', level: 12 }], systems: [{ use: 'gameplay.encounter', with: { trainers } }] }), { primitives: PRIMS });
  rt.run([{ do: 'start_battle', foe: [{ species: 'mote', level: 2 }] }]);
  rt.step({ actions: { battle: { kind: 'run' } } });
  assert.equal(rt.state.counts['battle_end:run'], 1, 'faster creature always escapes');
  rt.run([{ do: 'trainer_battle', trainer: 'kid' }]);
  assert.equal(rt.state.counts['battle_start:trainer'], 1);
  assert.ok(!rt.availableOptions().some(o => o.actions.battle.kind === 'run'));
  rt.step({ actions: { battle: { kind: 'run' } } });
  assert.equal(rt.state.counts.battle_invalid, 1);
  playOut(rt, o => o.find(x => x.label === 'use tackle') || o[0]);
  assert.equal(rt.state.counts['trainer_defeated:kid'], 1);
  assert.equal(rt.state.vars['money.gold'], 120);
  assert.ok(rt.test({ trainer_defeated: 'kid' }));
  assert.equal(rt.state.flags.beat_kid, true);
  rt.run([{ do: 'trainer_battle', trainer: 'kid' }]);
  assert.equal(rt.state.counts['battle_start:trainer'], 1, 'no rematch');
});

test('creature battle: level-ups queue learn prompts answered through options', () => {
  const { rt } = compile(doc({ start: [{ species: 'sprout', level: 15 }] }), { primitives: PRIMS });
  rt.run([{ do: 'start_battle', foe: [{ species: 'mote', level: 60 }] }]);
  let prompted = false;
  for (let i = 0; i < 300 && BT(rt).battle; i++) {
    const o = rt.availableOptions();
    if (o.some(x => x.actions.battle.kind === 'learn')) { prompted = true; rt.step({ actions: o.find(x => x.actions.battle.kind === 'learn' && x.label.endsWith(' growl')).actions }); continue; }
    rt.step({ actions: (o.find(x => x.label === 'use vine') || o[0]).actions });
  }
  assert.ok(prompted, 'learn prompt offered');
  const c = P(rt).party[0];
  assert.ok(c.level >= 16);
  assert.ok(c.moves.some(m => m.id === 'leaf') && !c.moves.some(m => m.id === 'growl'));
  assert.equal(c.species, 'bloom', 'evolved after the battle');
});

test('encounter: stepping through tall grass rolls the table after the grace steps', () => {
  const grass = { id: 'grass', block: 'tall_grass', rate: 1, table: [{ species: 'mote', minLevel: 2, maxLevel: 4, weight: 1 }] };
  const d = doc({ systems: [{ use: 'gameplay.encounter', with: { areas: [grass], grace: 1 } }] });
  const { rt } = compile(d, { primitives: PRIMS });
  const api = rt.space('world');
  for (let x = 0; x < 5; x++) api.setCell([x, 1, 0], 'tall_grass', rt);
  const walk = x => { api.setPos(rt.player(), [x, 1, 0], rt); rt.step(); };
  rt.step();
  walk(7); assert.ok(!rt.state.counts.encounter, 'not grass');
  walk(4);
  assert.equal(rt.state.counts['encounter:mote'], 1);
  assert.ok(BT(rt).battle);
  const lv = BT(rt).battle.foe.party[0].level;
  assert.ok(lv >= 2 && lv <= 4);
  rt.run([{ do: 'repel_encounters', steps: 5 }]);
  rt.step({ actions: { battle: { kind: 'run' } } });
  walk(2); walk(1);
  assert.equal(rt.state.counts.encounter, 1, 'repel and grace hold');
});

test('creature: deterministic replay of a battle', () => {
  const play = () => { const { rt } = compile(doc(), { primitives: PRIMS }); rt.run([{ do: 'start_battle', foe: [{ species: 'ember_pup', level: 6 }] }]); playOut(rt); return rt.snapshot(); };
  assert.deepEqual(play(), play());
});

test('creature: preflight rejects bad data and configs with stable codes', () => {
  const registry = new Registry(PRIMS), logic = buildLogic(registry, Logic);
  const codes = d => preflight(d, registry, logic).errors.map(e => e.code);
  const bad = doc(); bad.content.species[0].base.hp = 0; bad.content.species[0].learnset.push({ level: 5, move: 'nope' });
  assert.ok(codes(bad).includes('species_invalid'));
  assert.ok(codes(bad).includes('ref_unknown'));
  const badMove = doc(); badMove.content.moves[0].category = 'magic';
  assert.ok(codes(badMove).includes('move_invalid'));
  assert.ok(codes(doc({ systems: [{ use: 'gameplay.encounter', with: { areas: [{ id: 'a', rate: 0.1, table: [{ species: 'mote', minLevel: 5, maxLevel: 2 }] }] } }] })).includes('encounter_area'));
  assert.ok(codes(doc({ systems: [{ use: 'gameplay.encounter', with: { areas: [{ id: 'a', zone: 'route', table: [{ species: 'mote', minLevel: 5, maxLevel: 2 }] }] } }] })).includes('encounter_levels'));
  assert.ok(codes(doc({ systems: [{ use: 'gameplay.encounter', with: { areas: [{ id: 'a', zone: 'route', table: [{ species: 'ghost' }] }] } }] })).includes('ref_unknown'));
  const noBalls = doc(); noBalls.content.items = []; noBalls.systems[0].with.start = []; noBalls.systems[3].with.balls = [];
  assert.ok(codes(noBalls).includes('catch_no_balls'));
  const badItem = doc(); badItem.content.items[1].creature.kind = 'candy';
  assert.ok(codes(badItem).includes('battle_item_invalid'));
  const fx = doc(); fx.systems.push({ use: 'gameplay.encounter', with: { trainers: [{ id: 't', party: [{ species: 'mote' }], onDefeat: [{ do: 'start_battle' }] }] } });
  assert.ok(codes(fx).includes('effect_invalid'));
  const noParty = doc(); noParty.systems.splice(1, 1);
  assert.ok(codes(noParty).includes('requires_unmet'));
});

test('creature battle: the battle service gives a pure-read view; every log line has text', () => {
  const { rt } = compile(doc({ start: [{ species: 'sprout', level: 8 }, { species: 'ember_pup', level: 8 }] }), { primitives: PRIMS });
  assert.equal(rt.service('battle').view(), null);
  rt.run([{ do: 'start_battle', foe: [{ species: 'mote', level: 3 }] }]);
  const snap = rt.snapshot(), v = rt.service('battle').view();
  assert.deepEqual(rt.snapshot(), snap, 'view() does not mutate state');
  assert.equal(v.turn, 'player');
  assert.deepEqual(v.sides.map(s => s.id), ['player', 'foe']);
  const me = v.sides[0].units[0];
  assert.equal(me.active, true); assert.equal(me.hpMax, statsOf(rt.doc.content, P(rt).party[0]).hp);
  assert.ok(v.menu.some(m => m.kind === 'move' && m.pp > 0 && m.type === 'normal'));
  assert.ok(v.menu.some(m => m.kind === 'switch') && v.menu.some(m => m.kind === 'run') && v.menu.some(m => m.kind === 'item'));
  assert.deepEqual(v.menu.filter(m => m.enabled).map(m => m.label), rt.availableOptions().map(o => o.label), 'options are the enabled menu');
  const lines = [];
  rt.on('battle_log', e => lines.push(e));
  playOut(rt, o => o.find(x => x.label === 'use tackle') || o[0]);
  assert.ok(lines.length > 3);
  assert.deepEqual(lines.filter(e => !e.text).map(e => e.type), [], 'every battle_log line has text');
});

test('creature battle: stat-stage moves change stages; switching resets them', () => {
  const { rt } = compile(doc({ start: [{ species: 'sprout', level: 8 }, { species: 'ember_pup', level: 8 }] }), { primitives: PRIMS });
  rt.run([{ do: 'start_battle', foe: [{ species: 'mote', level: 30 }] }]);
  rt.step({ actions: { battle: { kind: 'move', index: 1 } } }); // growl
  const b = BT(rt).battle;
  assert.equal(b.foe.stages.atk, -1, 'growl lowered the foe attack');
  assert.equal(b.player.stages.atk, -1, 'the foe growled back');
  rt.step({ actions: { battle: { kind: 'switch', index: 1 } } });
  assert.equal(BT(rt).battle.player.active, 1);
  assert.ok(BT(rt).battle.player.stages.atk >= -1, 'fresh stages after the switch');
  assert.ok(rt.state.events.some(e => e.name === 'battle_log' && e.type === 'switch'));
});
