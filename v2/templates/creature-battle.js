// Creature battle (the Pokémon family's battles): the player's trainer leads a party of creatures against a rival
// trainer's party, turn by turn in a battle arena. Each turn the player picks a move (typed: the type chart doubles or
// halves its damage, a move of the creature's own type hits harder), switches creatures or uses a tonic; the rival's
// creatures answer with the best move they know. Creatures level up, learn moves and evolve from the experience they
// earn. Defeating every creature of the rival's party wins; losing all of yours loses. Seeded from the creature-battle
// mode's minimal document (tests/v2-p-modes-bots.test.js), with the creature kit's species, moves and type chart.
// Its loop is gameplay.creature.battle, which declares what a battle's result means for an encounter's participants
// (card.loop.outcome) and how an encounter starts it (card.engage.encounter), so it is entered as an inner loop: a board
// game nesting it decides each capture with a battle.
const won = [{ do: 'end_game', outcome: 'won' }], lost = [{ do: 'end_game', outcome: 'lost' }];
const B = (hp, atk, def, spa, spd, spe) => ({ hp, atk, def, spa, spd, spe });
const learn = (...moves) => moves.map(([level, move]) => ({ level, move }));

export default {
  id: 'creature-battle',
  concept: 'Creature battle (Pokémon-style): lead a party of typed creatures in turn-based battles against a rival trainer, picking moves, switching and healing; defeat the rival\'s whole party to win.',
  doc: {
    schema: 'gameverse.v2.game/0.2', id: 'creature-battle', title: 'Creature battle', seed: 1,
    views: { primary: 'ui' },
    spaces: [{ id: 'arena', use: 'engine.space.none', with: { scenery: 'meadow' }, zones: [{ id: 'ring', name: 'Battle ring' }] }],
    systems: [
      { use: 'gameplay.inventory', with: { start: [{ item: 'tonic', count: 2 }] } },
      { use: 'gameplay.creature.party', with: { start: [{ species: 'tide_pup', level: 9 }, { species: 'sprout', level: 8 }] } },
      { use: 'gameplay.creature.battle', with: {
        space: 'arena', onWin: won, onLose: lost,
        opening: { kind: 'trainer', trainer: { id: 'rival', name: 'Rival', prize: 200 }, foe: [{ species: 'ember_cub', level: 6 }, { species: 'thorn_stag', level: 5 }] } } },
    ],
    content: {
      archetypes: [{ id: 'trainer', name: 'Trainer', components: {} }],
      species: [
        { id: 'ember_cub', name: 'Ember Cub', types: ['fire'], base: B(45, 52, 43, 60, 50, 65), catchRate: 90, expYield: 64, growth: 'medium', learnset: learn([1, 'tackle'], [4, 'ember'], [7, 'growl'], [10, 'flame_burst']) },
        { id: 'cinder_hound', name: 'Cinder Hound', types: ['fire'], base: B(60, 70, 55, 65, 55, 70), catchRate: 90, expYield: 64, growth: 'medium', learnset: learn([1, 'tackle'], [4, 'ember'], [7, 'flame_burst']) },
        { id: 'tide_pup', name: 'Tide Pup', types: ['water'], base: B(50, 48, 65, 50, 64, 43), catchRate: 90, expYield: 64, growth: 'medium', learnset: learn([1, 'tackle'], [4, 'water_gun'], [7, 'growl'], [10, 'bubble_beam']), evolves: { level: 16, to: 'reef_turtle' } },
        { id: 'reef_turtle', name: 'Reef Turtle', types: ['water'], base: B(70, 60, 75, 55, 70, 40), catchRate: 90, expYield: 64, growth: 'medium', learnset: learn([1, 'tackle'], [4, 'water_gun'], [7, 'bubble_beam']) },
        { id: 'sprout', name: 'Sprout', types: ['grass'], base: B(45, 49, 49, 65, 65, 45), catchRate: 90, expYield: 64, growth: 'medium', learnset: learn([1, 'tackle'], [4, 'vine_whip'], [7, 'growl'], [10, 'leaf_blade']), evolves: { level: 16, to: 'thorn_stag' } },
        { id: 'thorn_stag', name: 'Thorn Stag', types: ['grass'], base: B(65, 72, 60, 55, 60, 62), catchRate: 90, expYield: 64, growth: 'medium', learnset: learn([1, 'tackle'], [4, 'vine_whip'], [7, 'leaf_blade']) },
      ],
      moves: [
        { id: 'tackle', name: 'Tackle', type: 'normal', category: 'physical', power: 40, accuracy: 100, pp: 35 },
        { id: 'growl', name: 'Growl', type: 'normal', category: 'status', power: 0, accuracy: 100, pp: 40, effect: { kind: 'stat', stat: 'atk', stages: -1, target: 'foe' } },
        { id: 'ember', name: 'Ember', type: 'fire', category: 'special', power: 40, accuracy: 100, pp: 25 },
        { id: 'flame_burst', name: 'Flame Burst', type: 'fire', category: 'special', power: 70, accuracy: 100, pp: 15 },
        { id: 'water_gun', name: 'Water Gun', type: 'water', category: 'special', power: 40, accuracy: 100, pp: 25 },
        { id: 'bubble_beam', name: 'Bubble Beam', type: 'water', category: 'special', power: 65, accuracy: 100, pp: 20 },
        { id: 'vine_whip', name: 'Vine Whip', type: 'grass', category: 'physical', power: 45, accuracy: 100, pp: 25 },
        { id: 'leaf_blade', name: 'Leaf Blade', type: 'grass', category: 'physical', power: 70, accuracy: 100, pp: 15 },
      ],
      types: { normal: {}, fire: { grass: 2, water: 0.5, fire: 0.5 }, water: { fire: 2, grass: 0.5, water: 0.5 }, grass: { water: 2, fire: 0.5, grass: 0.5 } },
      items: [{ id: 'tonic', name: 'Tonic', creature: { kind: 'heal', value: 20 } }],
    },
    player: { archetype: 'trainer', at: 'ring' },
  },
  tune: ['engine.space.none.scenery', 'gameplay.creature.battle.difficulty'],
};
