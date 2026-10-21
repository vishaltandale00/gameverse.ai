// Deckbuilder battles (the Slay the Spire family): a run of three card battles in a row, the last one a boss. The
// player's deck of ten cards (strikes, defends and a bash that leaves the foe vulnerable) is shuffled into a draw pile;
// each turn draws five cards and gives three energy to play them, attacks deal damage, skills give block that soaks the
// foe's next hits, and the hand is discarded at the end of the turn. Each foe shows its intent (attack, block, buff)
// before it acts. Hit points carry over from battle to battle, and each won battle offers a choice of one of three new
// cards for the deck. Losing all hit points loses; beating the boss wins.
const won = [{ do: 'end_game', outcome: 'won' }], lost = [{ do: 'end_game', outcome: 'lost' }];
const STAGES = [['first_fight', 'slime'], ['second_fight', 'cultist'], ['boss_fight', 'guardian']];
const FOES = STAGES.map(([, archetype]) => archetype);
const card = (id, name, type, cost, target, effects) => ({ id, name, type, cost, target, effects });

export default {
  id: 'card-battle',
  concept: 'Deckbuilder card battles: draw a hand from your deck each turn, spend energy on attack and block cards against foes who show their intents, add cards after each win and beat the boss.',
  doc: {
    schema: 'gameverse.v2.game/0.2', id: 'card-battle', title: 'Card Battle', seed: 1,
    views: { primary: 'ui' },
    spaces: [{ id: 'table', use: 'engine.space.none', zones: [{ id: 'hand', name: 'Hand' }, { id: 'arena', name: 'Arena' }] }],
    systems: [
      { use: 'gameplay.combat.health', with: { iframes: 0 } },
      // Each stage puts its foe in the arena (removing the last one) and starts a battle; a won battle clears the stage.
      { use: 'gameplay.stage.sequence', with: { introSec: 1, clearSec: 1, stages: STAGES.map(([id, archetype], i) => ({
        id, spawn: [{ archetype, id: archetype, zone: 'arena' }], clearOut: FOES.filter((_, k) => k < i),
        onStart: [{ do: 'start_turns' }], clear: { turn: true, state: 'over', winner: 'player' } })), onComplete: won } },
      { use: 'gameplay.turns', with: { actions: [], overwatch: false, movePerAp: 0, autoStart: false,
        sides: [{ id: 'player', control: 'player', members: ['player'] }, { id: 'foes', control: 'external', members: FOES }], onDefeat: lost } },
      { use: 'gameplay.cards', with: { format: 'roguelike', energy: 3, handSize: 5,
        deck: ['strike', 'strike', 'strike', 'strike', 'strike', 'defend', 'defend', 'defend', 'defend', 'bash'],
        rewards: { choices: 3, pool: ['heavy_blow', 'cleave', 'shrug', 'inflame', 'quick_slash'] } } },
    ],
    content: {
      archetypes: [
        { id: 'hero', name: 'Hero', components: { health: { max: 50 } } },
        { id: 'slime', name: 'Slime', kind: 'enemy', components: { health: { max: 24 }, cards: { intents: [{ kind: 'attack', value: 6 }, { kind: 'attack', value: 9 }, { kind: 'block', value: 5 }] } } },
        { id: 'cultist', name: 'Cultist', kind: 'enemy', components: { health: { max: 36 }, cards: { intents: [{ kind: 'buff', mod: 'strength', value: 2 }, { kind: 'attack', value: 6 }, { kind: 'attack', value: 6 }] } } },
        { id: 'guardian', name: 'Guardian', kind: 'boss', components: { health: { max: 52 }, cards: { intents: [{ kind: 'attack', value: 10 }, { kind: 'block', value: 12 }, { kind: 'attack', value: 5, times: 2 }, { kind: 'debuff', mod: 'weak', value: 2 }] } } },
      ],
      cards: [
        card('strike', 'Strike', 'attack', 1, 'enemy', [{ do: 'card_damage', amount: 6, who: 'target' }]),
        card('defend', 'Defend', 'skill', 1, 'self', [{ do: 'card_block', amount: 5 }]),
        card('bash', 'Bash', 'attack', 2, 'enemy', [{ do: 'card_damage', amount: 8, who: 'target' }, { do: 'card_mod', mod: 'vulnerable', amount: 2, who: 'target' }]),
        card('heavy_blow', 'Heavy Blow', 'attack', 2, 'enemy', [{ do: 'card_damage', amount: 14, who: 'target' }]),
        card('cleave', 'Cleave', 'attack', 1, 'all_enemies', [{ do: 'card_damage', amount: 8, who: 'all_enemies' }]),
        card('shrug', 'Shrug It Off', 'skill', 1, 'self', [{ do: 'card_block', amount: 8 }, { do: 'draw_cards', count: 1 }]),
        card('inflame', 'Inflame', 'power', 1, 'self', [{ do: 'card_mod', mod: 'strength', amount: 2, who: 'owner' }]),
        card('quick_slash', 'Quick Slash', 'attack', 1, 'enemy', [{ do: 'card_damage', amount: 8, who: 'target' }, { do: 'draw_cards', count: 1 }]),
      ],
    },
    player: { archetype: 'hero', at: 'hand' },
  },
  tune: [{ path: 'gameplay.stage.sequence.introSec', max: 3 }, { path: 'gameplay.stage.sequence.clearSec', max: 3 }],
};
