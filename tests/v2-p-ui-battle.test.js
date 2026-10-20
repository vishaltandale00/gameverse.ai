import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, run } from '../v2/kernel/testing.js';
import battle, { battleMenu, targetsFor, battleAction } from '../v2/primitives/graphics/ui-battle.js';
import cards, { handLayout, cardTargets, cardArt } from '../v2/primitives/graphics/ui-cards.js';
import { mount } from './v2-p-ui-dom.js';
import { baseDoc, BASE } from './v2-p-ui-fixtures.js';

// A battle fixture speaking the battle contract: service view() + `battle` verb, state in a store.
const fight = {
  id: 'gameplay.fixture.battle',
  card: { intent: 'Fixture turn-based battle.', provides: { services: ['battle', 'cards'], actions: ['battle', 'start_fight', 'play_card', 'end_turn'], events: ['battle_message', 'battle_end'] } },
  install(rt) {
    const peek = () => rt.state.prim['fixture.battle'] || {}, st = () => rt.store('fixture.battle');
    rt.provide('battle', { view: () => {
      const s = peek(); if (!s.on) return null;
      return { active: true, turn: 'player', sides: [{ id: 'me', player: true, units: [{ id: 'sprout', name: 'Sprout', hp: s.myHp ?? 20, hpMax: 20, level: 5, active: true }] }, { id: 'wild', units: [{ id: 'bat_a', name: 'Bat', hp: s.batA ?? 12, hpMax: 12, level: 3 }, { id: 'bat_b', name: 'Bat', hp: 12, hpMax: 12, level: 3 }] }],
        menu: [{ id: 'tackle', label: 'Tackle', kind: 'move', target: 'enemy', pp: 30, ppMax: 35, type: 'normal' }, { id: 'leaf', label: 'Leaf Gust', kind: 'move', target: 'all', type: 'grass' }, { id: 'berry', label: 'Berry', kind: 'item', target: 'ally', count: 2 }, { id: 'run', label: 'Run', kind: 'run' }] };
    } });
    rt.provide('cards', { view: () => {
      const s = peek(); if (!s.cards) return null;
      return { hand: [{ uid: 'c1', card: 'strike', cost: 1, playable: true, target: 'enemy' }, { uid: 'c2', card: 'guard', cost: 1, playable: true, target: 'self' }, { uid: 'c3', card: 'nova', cost: 3, playable: false }], piles: { draw: 7, discard: 2 }, energy: 2, energyMax: 3, enemies: [{ id: 'bat_a', name: 'Bat', intent: { kind: 'attack', value: 6 } }, { id: 'bat_b', name: 'Bat', intent: { kind: 'block', value: 5 } }] };
    } });
    rt.action('start_fight', kind => { st()[kind === 'cards' ? 'cards' : 'on'] = true; rt.emit('battle_message', { text: 'Wild bats appeared!' }); });
    for (const v of ['battle', 'play_card', 'end_turn']) rt.action(v, x => { (st().log ??= []).push([v, x]); if (v === 'battle' && x.kind === 'run') { st().on = false; rt.emit('battle_end', { outcome: 'fled' }); } });
  },
};
const content = { cards: [{ id: 'strike', name: 'Strike', cost: 1, type: 'attack', text: 'Deal 6 damage.', target: 'enemy' }, { id: 'guard', name: 'Guard', type: 'skill', text: 'Gain 5 block.' }, { id: 'nova', name: 'Nova', type: 'power', cost: 3 }],
  archetypes: [{ id: 'hero', kind: 'player', components: {} }, { id: 'bat', kind: 'enemy', components: { health: { max: 12 } } }] };
const P = [...BASE, fight, battle, cards];
const doc = () => baseDoc({ content, systems: [{ use: 'gameplay.fixture.battle' }], graphics: [{ use: 'graphics.ui.battle', with: { layout: 'screen', cps: 0 } }, { use: 'graphics.ui.cards' }] });

test('battle helpers: categories, targets and the action shape for either source', () => {
  const view = { source: 'battle', sides: [{ id: 'me', player: true, units: [{ id: 'a' }] }, { id: 'foe', units: [{ id: 'x' }, { id: 'y', down: true }] }], menu: [{ id: 'run', kind: 'run' }, { id: 'hit', kind: 'move', target: 'enemy' }, { id: 'potion', kind: 'item', target: 'ally' }] };
  assert.deepEqual(battleMenu(view).map(c => [c.label, c.items.length, c.direct]), [['Fight', 1, false], ['Bag', 1, false], ['Run', 1, true]]);
  assert.deepEqual(targetsFor(view, view.menu[1]), ['x'], 'downed units are not targets');
  assert.deepEqual(targetsFor(view, view.menu[2]), ['a']);
  assert.deepEqual(battleAction(view, view.menu[1], 'x'), { battle: { kind: 'move', id: 'hit', target: 'x' } });
  assert.deepEqual(battleAction({ ...view, source: 'turns' }, { id: 'shoot' }, 'x'), { turn_act: { action: 'shoot', target: 'x' } });
});

test('battle: screen opens with the fight, menus navigate, targets are picked, the action reaches the game', () => {
  const m = mount(doc(), { primitives: P });
  m.frame(1, { actions: { start_fight: true } }); m.frame(2);
  assert.equal(m.view.modal, 'battle');
  assert.equal(m.qa('.gv-bunit').length, 3);
  assert.match(m.text('.gv-bmsg'), /Wild bats appeared!/);
  assert.deepEqual([...m.qa('.gv-bmenu .gv-btn')].map(b => b.textContent), ['Fight', 'Bag', 'Run']);
  m.key('Enter'); m.frame(1);
  assert.match(m.text('.gv-bmenu'), /Tackle[\s\S]*PP 30\/35[\s\S]*Leaf Gust/);
  m.key('Enter'); m.frame(1); // Tackle -> choose a target
  assert.ok(m.q('.gv-bunit.is-target[data-unit=bat_a]'));
  m.key('ArrowRight'); m.frame(1);
  assert.ok(m.q('.gv-bunit.is-target[data-unit=bat_b]'));
  m.key('Enter'); m.frame(1);
  assert.deepEqual(m.rt.state.prim['fixture.battle'].log.at(-1), ['battle', { kind: 'move', id: 'tackle', target: 'bat_b' }]);
  // HP drain: the bar follows the view.
  m.rt.state.prim['fixture.battle'].batA = 3; m.frame(1);
  assert.equal(m.q('.gv-bunit[data-unit=bat_a] .gv-meter-fill').style.getPropertyValue('transform'), 'scaleX(0.2500)');
  // Run ends the battle and closes the screen.
  m.key('ArrowDown'); m.key('ArrowDown'); m.frame(1);
  const runBtn = [...m.qa('.gv-bmenu .gv-btn')].findIndex(b => b.textContent === 'Run');
  assert.ok(runBtn >= 0);
  m.key('Escape'); m.frame(1);
  for (let i = 0; i < 3; i++) m.key('ArrowRight');
  [...m.qa('.gv-bmenu .gv-btn')].find(b => b.textContent === 'Run').click(); m.frame(2);
  assert.ok(m.q('.gv-battle').classList.contains('gv-hide'));
  assert.equal(m.view.modal, null);
});

test('cards helpers: fan layout is symmetric; targets only for targeted cards; art is stable', () => {
  const lay = handLayout(5, { width: 700 });
  assert.equal(lay.length, 5); assert.equal(lay[2].x, 0); assert.equal(lay[0].x, -lay[4].x); assert.equal(lay[0].rot, -lay[4].rot); assert.ok(lay[0].y > lay[2].y);
  assert.deepEqual(handLayout(1), [{ x: 0, y: 0, rot: 0 }]);
  const v = { enemies: [{ id: 'a' }, { id: 'b', dead: true }] };
  assert.deepEqual(cardTargets(v, { target: 'enemy' }), ['a']); assert.deepEqual(cardTargets(v, { target: 'self' }), []);
  assert.equal(cardArt('strike', 'attack'), cardArt('strike', 'attack'));
});

test('cards: hand renders, unplayable cards refuse, targeted cards pick an enemy, end turn', () => {
  const m = mount(doc(), { primitives: P });
  m.frame(1, { actions: { start_fight: 'cards' } }); m.frame(1);
  assert.equal(m.view.modal, 'cards');
  assert.equal(m.qa('.gv-card').length, 3);
  assert.equal(m.text('.gv-energy'), '2/3');
  assert.match(m.text('.gv-intent'), /6/);
  assert.ok(m.q('.gv-card.is-unplayable'));
  m.key('Enter'); m.frame(1); // Strike needs a target among two enemies
  assert.ok(m.q('.gv-foe.is-target[data-foe=bat_a]'));
  m.key('Enter'); m.frame(1);
  assert.deepEqual(m.rt.state.prim['fixture.battle'].log.at(-1), ['play_card', { uid: 'c1', target: 'bat_a' }]);
  m.key('ArrowRight'); m.key('Enter'); m.frame(1);
  assert.deepEqual(m.rt.state.prim['fixture.battle'].log.at(-1), ['play_card', { uid: 'c2' }]);
  m.key('ArrowRight'); m.key('Enter'); m.frame(1);
  assert.equal(m.rt.state.prim['fixture.battle'].log.length, 2, 'Nova costs too much');
  m.key('r'); m.frame(1);
  assert.deepEqual(m.rt.state.prim['fixture.battle'].log.at(-1), ['end_turn', true]);
});

test('battle/cards: state-neutral replay and bad configs', () => {
  const a = mount(doc(), { primitives: P }); a.frame(1, { actions: { start_fight: true } }); a.frame(3); a.key('Enter'); a.frame(2);
  const { rt } = compile(doc(), { primitives: P }); run(rt, 1, { actions: { start_fight: true } }); run(rt, 5);
  assert.deepEqual(a.rt.snapshot(), rt.snapshot());
  const codes = g => { try { compile(baseDoc({ content, systems: [{ use: 'gameplay.fixture.battle' }], graphics: g }), { primitives: P }); return []; } catch (e) { return e.errors.map(x => x.code); } };
  assert.ok(codes([{ use: 'graphics.ui.battle', with: { layout: 'grid' } }]).includes('param_option'));
  assert.ok(codes([{ use: 'graphics.ui.cards', with: { maxHand: 0 } }]).includes('param_range'));
});
