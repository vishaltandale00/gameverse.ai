import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, testSpace } from '../v2/kernel/testing.js';
import { preflight } from '../v2/kernel/document.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import modes from '../v2/primitives/gameplay/modes.index.js';
import { stubHealth, doc, drive } from '../v2/primitives/gameplay/modes-lib-testing.js';

const P = [...modes, testSpace, stubHealth];
const CARDS = [
  { id: 'strike', name: 'Strike', cost: 1, type: 'attack', effects: [{ do: 'card_damage', amount: 6 }] },
  { id: 'defend', name: 'Defend', cost: 1, type: 'skill', target: 'self', effects: [{ do: 'card_block', amount: 5 }] },
  { id: 'bash', name: 'Bash', cost: 2, type: 'attack', effects: [{ do: 'card_damage', amount: 8 }, { do: 'card_mod', mod: 'vulnerable', amount: 2, who: 'target' }] },
  { id: 'pommel', name: 'Pommel', cost: 1, type: 'attack', effects: [{ do: 'card_damage', amount: 9 }, { do: 'draw_cards', count: 1 }] },
  { id: 'rage', name: 'Rage', cost: 0, type: 'power', target: 'self', effects: [{ do: 'card_mod', mod: 'strength', amount: 2 }] },
  { id: 'squire', name: 'Squire', cost: 1, type: 'minion', power: 2, health: 3 },
  { id: 'wall', name: 'Wall', cost: 1, type: 'minion', power: 0, health: 5, keywords: ['taunt'] },
  { id: 'raider', name: 'Raider', cost: 1, type: 'minion', power: 3, health: 1, keywords: ['charge'] },
];
const turnsWith = { sides: [{ id: 'player', control: 'player', members: ['player'] }, { id: 'enemy', control: 'external' }], actions: [], overwatch: false, movePerAp: 0, ap: 1 };
const rogue = (w = {}) => doc({ archetypes: [{ id: 'cultist', components: { health: { max: 40 }, turns: { side: 'enemy' }, cards: { intents: [{ kind: 'buff', mod: 'strength', value: 3 }, { kind: 'attack', value: 6 }] } } }],
  content: { cards: structuredClone(CARDS) }, player: { archetype: 'hero', at: [1, 1, 0] },
  systems: [{ use: 'gameplay.combat.health' }, { use: 'gameplay.turns', with: turnsWith }, { use: 'gameplay.cards', with: { deck: ['strike', 'strike', 'strike', 'defend', 'defend', 'bash', 'rage', 'pommel'], rewards: { choices: 2, pool: ['pommel', 'rage', 'bash'] }, ...w } }] });
const start = (d, f = () => {}) => { const r = compile(d, { primitives: P }); r.rt.player().components.health = { max: 50 }; f(r.rt); r.rt.step(); return r.rt; };
const hand = rt => rt.service('cards').view().hand;
const play = (rt, card, target) => { const c = hand(rt).find(h => h.card === card); assert.ok(c, `${card} in hand`); rt.step({ actions: { play_card: { uid: c.uid, target } } }); };

test('cards roguelike: draw, energy, damage, block, vulnerable, strength, enemy intents', () => {
  const rt = start(rogue({ deck: ['strike', 'strike', 'defend', 'bash', 'rage'] }), rt => rt.spawn('cultist', { id: 'c1' }));
  const v = rt.service('cards').view();
  assert.equal(v.hand.length, 5); assert.equal(v.energy, 3);
  assert.equal(v.enemies[0].intent.kind, 'buff', 'intent shown before the player acts');
  play(rt, 'bash', 'c1');
  assert.equal(rt.entity('c1').components.health.hp, 32);
  play(rt, 'strike', 'c1');
  assert.equal(rt.entity('c1').components.health.hp, 23, 'vulnerable: 6 x 1.5 = 9');
  play(rt, 'strike', 'c1');
  assert.equal(rt.state.counts.card_invalid, 1, 'out of energy');
  play(rt, 'rage');
  assert.equal(rt.service('cards').view().mods.strength, 2);
  rt.step({ actions: { end_turn: true } });
  rt.step();
  assert.equal(rt.state.counts.intent_executed, 1, 'enemy buffed on its turn');
  assert.ok(rt.test({ turn: 'player' }), 'external enemy side handed the turn back');
  assert.equal(rt.service('cards').view().enemies[0].intent.kind, 'attack');
  play(rt, 'defend');
  assert.equal(rt.state.vars['cards.block'], 5);
  rt.step({ actions: { end_turn: true } }); rt.step();
  assert.equal(rt.player().components.health.hp, 50 - (6 + 3 - 5), 'attack 6 + strength 3, 5 blocked');
  assert.equal(rt.state.vars['cards.block'], 0, 'block decays at turn start');
});

test('cards roguelike: piles reshuffle, victory offers a card reward, deck persists', () => {
  const rt = start(rogue(), rt => rt.spawn('cultist', { id: 'c1' }));
  for (let turn = 0; turn < 8 && rt.state.counts.turns_over === undefined; turn++) {
    for (const c of hand(rt)) if (c.type === 'attack' && rt.state.vars['cards.energy'] >= c.cost) rt.step({ actions: { play_card: { uid: c.uid, target: 'c1' } } });
    rt.step({ actions: { end_turn: true } }); rt.step();
  }
  assert.ok(rt.state.counts.shuffle >= 1, 'discard reshuffled into the draw pile');
  assert.equal(rt.state.counts.turns_over, 1);
  assert.equal(rt.state.counts.card_reward, 1);
  assert.equal(rt.availableOptions().length, 3, 'two choices and skip');
  const before = rt.state.vars['cards.deck'];
  rt.step({ actions: { pick_card: rt.service('cards').view().reward[0] } });
  assert.equal(rt.state.vars['cards.deck'], before + 1);
  assert.ok(rt.test({ card_owned: 'strike', gte: 3 }));
});

test('cards duel: growing mana, minions, summoning sickness, charge, taunt, hero attacks and greedy AI', () => {
  const d = doc({ archetypes: [{ id: 'rival', components: { health: { max: 30 }, turns: { side: 'enemy' }, cards: { deck: ['wall', 'wall', 'wall', 'wall', 'wall', 'wall'] } } }], content: { cards: structuredClone(CARDS) }, player: { archetype: 'hero', at: [1, 1, 0] },
    systems: [{ use: 'gameplay.combat.health' }, { use: 'gameplay.turns', with: turnsWith }, { use: 'gameplay.cards', with: { format: 'duel', energy: 1, handSize: 3, deck: ['raider', 'raider', 'raider', 'raider', 'squire', 'squire'], owners: ['rival'] } }] });
  const rt = start(d, rt => rt.spawn('rival', { id: 'r1' }));
  let v = rt.service('cards').view();
  assert.equal(v.energy, 1); assert.equal(v.hand.length, 3);
  const raider = v.hand.find(h => h.card === 'raider');
  assert.ok(raider, 'four of six cards are raiders');
  rt.step({ actions: { play_card: { uid: raider.uid } } });
  const m = rt.service('cards').view().board[0];
  assert.equal(m.canAttack, true, 'charge attacks at once');
  rt.step({ actions: { attack_with: { uid: m.uid, target: 'hero' } } });
  assert.equal(rt.entity('r1').components.health.hp, 27);
  rt.step({ actions: { attack_with: { uid: m.uid, target: 'hero' } } });
  assert.equal(rt.entity('r1').components.health.hp, 27, 'one attack per turn');
  rt.step({ actions: { end_turn: true } });
  drive(rt, 6);
  v = rt.service('cards').view();
  assert.ok(v.opponents[0].board.length >= 1, 'rival AI summoned a minion');
  assert.ok(rt.test({ turn: 'player' }));
  assert.equal(v.energy, 2, 'mana grew');
  const wall = v.opponents[0].board.find(x => x.keywords.includes('taunt'));
  const mine = v.board.find(x => x.canAttack);
  assert.ok(wall && mine);
  rt.step({ actions: { attack_with: { uid: mine.uid, target: 'hero' } } });
  assert.ok(rt.state.events.some(e => e.name === 'card_invalid' && e.reason === 'taunt'), 'taunt guards the hero');
  rt.step({ actions: { attack_with: { uid: mine.uid, target: wall.uid } } });
  assert.equal(rt.service('cards').view().opponents[0].board.find(x => x.uid === wall.uid).health, 2, 'raider (3 power) hits the 0/5 wall');
  assert.equal(rt.service('cards').view().board.find(x => x.uid === mine.uid).health, 1, 'a 0-power wall deals nothing back');
});

test('cards: deterministic replay', () => {
  const playOut = () => { const rt = start(rogue(), rt => rt.spawn('cultist', { id: 'c1' })); for (let t = 0; t < 4; t++) { for (const c of hand(rt)) rt.step({ actions: { play_card: { uid: c.uid, target: 'c1' } } }); rt.step({ actions: { end_turn: true } }); rt.step(); } return rt.snapshot(); };
  assert.deepEqual(playOut(), playOut());
});

test('cards: preflight rejects bad configs with stable codes', () => {
  const registry = new Registry(P), logic = buildLogic(registry, Logic);
  const bad = rogue({ deck: ['strike', 'ghost_card'], format: 'duel' });
  bad.content.cards.push({ id: 'broken', cost: 1.5, type: 'trap', target: 'everyone', effects: [{ do: 'explode' }] }, { id: 'blob', type: 'minion', cost: 1 });
  bad.content.archetypes.push({ id: 'odd', components: { cards: { intents: [{ kind: 'dance' }, { kind: 'buff', mod: 'luck' }, { kind: 'debuff' }] } } });
  const codes = new Set(preflight(bad, registry, logic).errors.map(e => e.code));
  for (const c of ['ref_unknown', 'card_invalid', 'intent_invalid', 'cards_owners']) assert.ok(codes.has(c), c);
  // A card's cost, type, target and effects and an intent's kind and mod are the declared shapes of content.cards and
  // the cards component, reported at their paths (warnings until kernel/document.js DECLARATIONS_ENFORCED).
  const r = preflight(bad, registry, logic), at = [...r.errors, ...r.warnings].map(e => `${e.code}@${e.path}`), card = `content.cards[${bad.content.cards.length - 2}]`, odd = `content.archetypes[${bad.content.archetypes.length - 1}].components.cards.intents`;
  for (const x of [`param_type@${card}.cost`, `param_option@${card}.type`, `param_option@${card}.target`, `effect_unknown@${card}.effects[0]`, `param_option@${odd}[0].kind`, `param_option@${odd}[1].mod`]) assert.ok(at.includes(x), `${x} in ${at}`);
  const noTurns = rogue(); noTurns.systems = noTurns.systems.filter(s => s.use !== 'gameplay.turns');
  assert.ok(preflight(noTurns, registry, logic).errors.some(e => e.code === 'requires_unmet'));
  const empty = rogue({ deck: [] }); empty.content.cards = [];
  const c2 = new Set(preflight(empty, registry, logic).errors.map(e => e.code));
  assert.ok(c2.has('cards_missing') && c2.has('cards_deck_empty'));
  assert.ok(preflight(rogue(), registry, logic).ok, JSON.stringify(preflight(rogue(), registry, logic).errors));
});
