// graphics.ui.battle against the real gameplay.creature.battle (no view service yet):
// the UI reads its store, builds the menu from its `battle` options, and plays a battle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, run, testSpace } from '../v2/kernel/testing.js';
import inventory from '../v2/primitives/gameplay/inventory.js';
import party from '../v2/primitives/gameplay/creature-party.js';
import creatureBattle from '../v2/primitives/gameplay/creature-battle.js';
import battleUi from '../v2/primitives/graphics/ui-battle.js';
import { battleView } from '../v2/primitives/graphics/ui-sources.js';
import { mount } from './v2-p-ui-dom.js';
import { fx } from './v2-p-ui-fixtures.js';

const B = (hp, atk, def, spa, spd, spe) => ({ hp, atk, def, spa, spd, spe });
const doc = () => ({
  schema: 'gameverse.v2.game/0.2', id: 'monsters-ui', title: 'Monsters', seed: 21,
  spaces: [{ id: 'world', use: 'engine.space.test', with: { size: [10, 10, 1] }, zones: [{ id: 'route', rect: [0, 0, 10, 10] }] }, { id: 'arena', use: 'engine.space.test', with: { size: [2, 2, 1] } }],
  systems: [{ use: 'gameplay.fixture.fx' }, { use: 'gameplay.inventory', with: { start: [{ item: 'tonic', count: 2 }] } }, { use: 'gameplay.creature.party', with: { start: [{ species: 'sprout', level: 8 }] } }, { use: 'gameplay.creature.battle', with: { space: 'arena' } }],
  content: {
    types: { grass: { water: 2 }, normal: {} },
    moves: [{ id: 'tackle', name: 'Tackle', type: 'normal', category: 'physical', power: 40, accuracy: 100, pp: 35 }, { id: 'vine', name: 'Vine', type: 'grass', category: 'special', power: 45, accuracy: 100, pp: 25 }],
    species: [{ id: 'sprout', name: 'Sprout', types: ['grass'], base: B(45, 49, 49, 65, 65, 45), catchRate: 45, expYield: 64, growth: 'medium', learnset: [{ level: 1, move: 'tackle' }, { level: 1, move: 'vine' }] },
      { id: 'mote', name: 'Mote', types: ['normal'], base: B(1, 1, 1, 1, 1, 1), catchRate: 255, expYield: 200, growth: 'fast', learnset: [{ level: 1, move: 'tackle' }] }],
    items: [{ id: 'tonic', name: 'Tonic', creature: { kind: 'heal', value: 20 } }],
    archetypes: [{ id: 'hero', components: {} }],
  },
  player: { archetype: 'hero', space: 'world', at: [1, 1, 0] },
  graphics: [{ use: 'graphics.ui.battle', with: { cps: 0 } }],
});
const P = [testSpace, fx, inventory, party, creatureBattle, battleUi];
const start = { actions: { fx: [{ do: 'start_battle', foe: [{ species: 'mote', level: 3 }] }] } };

test('creature battle: view from the real primitive, menu from its options', () => {
  const { rt } = compile(doc(), { primitives: P });
  run(rt, 1, start);
  const v = battleView(rt);
  assert.equal(v.source, 'battle', 'the battle.view() service of the primitive is preferred over reading its store');
  assert.deepEqual(v.sides.map(s => s.units.map(u => u.name)), [['Sprout'], ['Mote']]);
  assert.ok(v.sides[0].units[0].hpMax >= v.sides[0].units[0].hp && v.sides[0].units[0].hp > 0);
  assert.deepEqual(v.menu.filter(m => m.kind === 'move').map(m => [m.name ?? m.label, m.pp]), [['Tackle', 35], ['Vine', 25]]);
  assert.ok(v.menu.some(m => m.kind === 'run'));
});

test('creature battle: the UI plays a real battle to its end through view.act', () => {
  const m = mount(doc(), { primitives: P });
  m.frame(1, start); m.frame(2);
  assert.equal(m.view.modal, 'battle');
  assert.match(m.text('.gv-bmsg'), /A wild Mote appeared!/);
  assert.deepEqual([...m.qa('.gv-bmenu .gv-btn')].map(b => b.textContent.replace(/[0-9/ PA·]+$/, '')), ['Fight', 'Run'], 'Bag appears only when an item is usable (full HP: no tonic)');
  for (let turn = 0; turn < 10 && m.rt.state.prim['gameplay.creature.battle'].battle; turn++) {
    if (!m.q('.gv-bmenu .gv-btn')) { m.frame(1); continue; }
    if (/Fight/.test(m.q('.gv-bmenu .gv-btn').textContent)) { m.key('Enter'); m.frame(1); }
    m.key('Enter'); m.frame(2); // first move
  }
  assert.equal(m.rt.state.prim['gameplay.creature.battle'].battle, null, 'battle finished');
  assert.ok(m.rt.state.counts['battle_end'] >= 1);
  m.frame(2);
  assert.ok(m.q('.gv-battle').classList.contains('gv-hide'));
  assert.equal(m.view.modal, null);
});
