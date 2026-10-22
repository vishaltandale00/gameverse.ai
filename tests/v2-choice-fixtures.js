// Minimal documents for the choice-verb conformance (tests/v2-choice-providers.test.js): for each loop card with a
// verb whose value is chosen and that no template uses with that verb, the smallest game in which the verb's declared
// provider has something to offer. Each entry is { doc, spawn?, setup?, choose? }:
//   doc     a complete game document on a real space of the catalogue;
//   spawn   entities placed at the start ([archetype, at, id]) and
//   setup   effects run once at the start: what the game would have done by then (a shop opened, a clue found), the
//           state the verb is used in, not a play of it;
//   choose  { verb: [verbs] }: verbs whose first provided value is chosen through the controls before `verb` is
//           checked (build before demolish, accept a quest before tracking one).
// The test derives the cases from the registry: a loop card with a choice verb that neither a template nor an entry
// here covers fails, naming it.
const HEAD = { schema: 'gameverse.v2.game/0.2', title: 'Choice fixture', seed: 1 };
const hero = { id: 'hero', kind: 'player', components: {} };
/** A document with one space and the player in it. */
const game = (id, { space = { use: 'engine.space.none', zones: [{ id: 'home' }, { id: 'yard' }] }, view = 'ui', systems = [], content = {}, plot, player = { archetype: 'hero', at: 'home' } }) => ({
  ...HEAD, id, views: { primary: view }, spaces: [{ id: 'world', ...space }], systems,
  content: { archetypes: [hero], ...content }, ...(plot ? { plot } : {}), player,
});
const grid = (size = [12, 12]) => ({ use: 'engine.space.grid', with: { size }, zones: [{ id: 'home', rect: [0, 0, 6, size[1]] }, { id: 'yard', rect: [6, 0, size[0], size[1]] }] });
const B = (hp, atk, def, spa, spd, spe) => ({ hp, atk, def, spa, spd, spe });
const TURNS = { sides: [{ id: 'player', control: 'player', members: ['player'] }, { id: 'enemy', control: 'external' }], actions: [], overwatch: false, movePerAp: 0, ap: 1 };
const CARDS = [
  { id: 'strike', name: 'Strike', cost: 1, type: 'attack', target: 'enemy', effects: [{ do: 'card_damage', amount: 6, who: 'target' }] },
  { id: 'raider', name: 'Raider', cost: 1, type: 'minion', target: 'none', power: 3, health: 1, keywords: ['charge'], effects: [] },
];

export const FIXTURES = {
  'gameplay.blocks.place': {
    doc: game('choice-blocks', {
      space: { use: 'engine.space.tilemap', with: { size: [16, 12], mode: 'topdown' }, zones: [{ id: 'home', rect: [0, 0, 8, 12] }, { id: 'yard', rect: [8, 0, 16, 12] }] }, view: 'td',
      systems: [{ use: 'gameplay.inventory', with: { start: [{ item: 'stone_block', count: 4 }, { item: 'plank', count: 4 }] } }, { use: 'gameplay.blocks.place' }],
      content: { blocks: [{ id: 'stone', solid: true }, { id: 'wood', solid: true }], items: [{ id: 'stone_block', name: 'Stone', block: 'stone' }, { id: 'plank', name: 'Plank', block: 'wood' }] },
      player: { archetype: 'hero', at: [3.5, 3.5] },
    }),
  },
  'gameplay.build.structure': {
    doc: game('choice-build', {
      space: grid([16, 16]), view: 'td',
      systems: [{ use: 'gameplay.inventory', with: { start: [{ item: 'b_planks', count: 40 }] } }, { use: 'gameplay.build.structure', with: { pieces: ['wall', 'pillar'], block: 'planks' } }],
      content: { items: [{ id: 'b_planks', name: 'Planks', kind: 'block', block: 'planks', stack: 64 }], blocks: [{ id: 'planks', name: 'Planks', solid: true }] },
      player: { archetype: 'hero', at: [6, 6] },
    }),
    choose: { demolish: ['build'] },
  },
  // Travel: zones the walker can reach.
  'gameplay.move.grid': {
    doc: game('choice-travel', { space: grid(), view: 'td', systems: [{ use: 'gameplay.move.grid' }], player: { archetype: 'hero', at: [1, 1] } }),
  },
  'gameplay.checkpoint': {
    doc: game('choice-checkpoint', {
      space: grid(), view: 'td',
      systems: [{ use: 'gameplay.move.grid' }, { use: 'gameplay.checkpoint', with: { fastTravelBetween: true, save: false } }],
      content: { archetypes: [hero, { id: 'bench', name: 'Bench', kind: 'prop', components: { checkpoint: true } }] },
      player: { archetype: 'hero', at: [1, 1] },
    }),
    spawn: [['bench', [2, 2], 'bench_a'], ['bench', [9, 9], 'bench_b']],
    setup: [{ do: 'activate_checkpoint', checkpoint: 'bench_a' }, { do: 'activate_checkpoint', checkpoint: 'bench_b' }],
  },
  'gameplay.container': {
    doc: game('choice-container', {
      space: grid(), view: 'td',
      systems: [{ use: 'gameplay.inventory', with: { start: [{ item: 'apple', count: 2 }] } }, { use: 'gameplay.container' }],
      content: { archetypes: [hero, { id: 'chest', kind: 'prop', components: { container: { slots: 8, items: [{ item: 'coin', count: 3 }] } } }], items: [{ id: 'coin', name: 'Coin' }, { id: 'apple', name: 'Apple' }] },
      player: { archetype: 'hero', at: [1, 1] },
    }),
    spawn: [['chest', [2, 1], 'chest_1']],
    setup: [{ do: 'open_container', container: 'chest_1' }],
  },
  'gameplay.crafting': {
    doc: game('choice-crafting', {
      systems: [{ use: 'gameplay.inventory', with: { start: [{ item: 'stick', count: 2 }, { item: 'resin', count: 2 }, { item: 'stone', count: 1 }] } }, { use: 'gameplay.crafting', with: { discover: 'experiment' } }],
      content: { items: [{ id: 'stick', name: 'Stick' }, { id: 'resin', name: 'Resin' }, { id: 'stone', name: 'Stone' }, { id: 'torch', name: 'Torch' }, { id: 'axe', name: 'Axe' }],
        recipes: [{ id: 'torch', inputs: [{ item: 'stick', count: 1 }, { item: 'resin', count: 1 }], output: { item: 'torch', count: 1 }, learned: true }, { id: 'axe', inputs: [{ item: 'stick', count: 1 }, { item: 'stone', count: 1 }], output: { item: 'axe', count: 1 } }] },
    }),
  },
  'gameplay.economy': {
    doc: game('choice-economy', {
      systems: [{ use: 'gameplay.inventory', with: { start: [{ item: 'herb', count: 2 }] } }, { use: 'gameplay.economy', with: { currencies: [{ id: 'gold', start: 30 }], shops: [{ id: 'shop', stock: [{ item: 'ale', count: 3, price: 5 }], buys: ['*'] }] } }],
      content: { items: [{ id: 'ale', name: 'Ale', value: 5 }, { id: 'herb', name: 'Herb', value: 10 }] },
    }),
    setup: [{ do: 'open_shop', shop: 'shop' }],
  },
  'gameplay.equipment': {
    doc: game('choice-equipment', {
      systems: [{ use: 'gameplay.inventory', with: { start: [{ item: 'sword', count: 1 }] } }, { use: 'gameplay.equipment', with: { autoEquip: false } }],
      content: { items: [{ id: 'sword', name: 'Sword', kind: 'weapon' }] },
    }),
    choose: { unequip: ['equip'] },
  },
  'gameplay.item.use': {
    doc: game('choice-item-use', {
      systems: [{ use: 'gameplay.inventory', with: { start: [{ item: 'potion', count: 2 }] } }, { use: 'gameplay.item.use' }],
      content: { items: [{ id: 'potion', name: 'Potion', use: { fx: [{ do: 'add_var', var: 'drunk', amount: 1 }] } }] },
    }),
  },
  'gameplay.minigame': {
    doc: game('choice-minigame', {
      systems: [{ use: 'gameplay.minigame', with: { games: [{ id: 'hack', kind: 'sequence', sequence: { length: 3, verbs: ['up', 'down'], timePerKey: 5, mistakes: 2 } }] } }],
    }),
    setup: [{ do: 'start_minigame', game: 'hack' }],
  },
  'gameplay.paddle': {
    doc: game('choice-paddle', {
      space: { use: 'engine.space.physics2d', with: { gravity: [0, 0], bounds: [13, 20], edges: { bottom: 'open' } } }, view: 'side',
      systems: [{ use: 'gameplay.paddle', with: { ball: 'ball', bounds: [0, 13] } }],
      content: { archetypes: [{ id: 'pad', kind: 'player', components: { body: { size: [2.2, 0.4], type: 'kinematic', restitution: 1, friction: 0 } } }, { id: 'ball', components: { body: { size: [0.36, 0.36], shape: { kind: 'circle', r: 0.18 }, restitution: 1, friction: 0, gravityScale: 0, bullet: true } } }] },
      player: { archetype: 'pad', at: [6.5, 1.5] },
    }),
  },
  'gameplay.progression.level': {
    doc: game('choice-level', {
      systems: [{ use: 'gameplay.progression.level', with: { pointsPerLevel: 2, stats: [{ id: 'strength' }, { id: 'wits' }] } }],
    }),
    setup: [{ do: 'give_xp', amount: 150 }],
  },
  'gameplay.progression.tree': {
    doc: game('choice-tree', {
      systems: [{ use: 'gameplay.progression.tree', with: { nodes: [{ id: 'tough', cost: 1 }, { id: 'tougher', cost: 1, requires: ['tough'] }] } }],
    }),
    setup: [{ do: 'set_var', var: 'points', value: 2 }],
  },
  'plot.character': {
    doc: game('choice-character', {
      space: grid(), view: 'td',
      systems: [{ use: 'plot.character' }],
      content: { archetypes: [hero, { id: 'villager', kind: 'npc', components: {} }] },
      plot: { characters: [{ id: 'maren', name: 'Maren', archetype: 'villager', home: 'home' }, { id: 'tobin', name: 'Tobin', archetype: 'villager', home: 'yard' }] },
      player: { archetype: 'hero', at: [1, 1] },
    }),
  },
  'plot.dialogue': {
    doc: game('choice-dialogue', {
      systems: [{ use: 'plot.dialogue', with: { lineSpeed: 0 } }],
      plot: { dialogue: { greet: { start: 'n1', nodes: { n1: { say: 'Hello there.', choices: [{ text: 'Hi.', next: 'n2' }, { text: 'Bye.', next: 'n3' }] }, n2: { say: 'Nice day.', end: true }, n3: { say: 'Farewell.', end: true } } } } },
    }),
    setup: [{ do: 'start_dialogue', dialogue: 'greet' }],
  },
  'plot.events.random': {
    doc: game('choice-events', {
      systems: [{ use: 'plot.events.random', with: { rate: 0 } }],
      plot: { randomEvents: [{ id: 'storm', text: 'A storm rolls in.', choices: [{ text: 'Shelter', do: [{ do: 'set_flag', flag: 'sheltered' }] }, { text: 'Press on' }] }] },
    }),
    setup: [{ do: 'trigger_event', event: 'storm' }],
  },
  'plot.investigation': {
    doc: game('choice-investigation', {
      systems: [{ use: 'plot.investigation' }],
      plot: { clues: [{ id: 'mud', title: 'Muddy boots' }, { id: 'note', title: 'Torn note' }], deductions: [{ id: 'gardener', title: 'The gardener did it', clues: ['mud', 'note'] }] },
    }),
    setup: [{ do: 'add_clue', clue: 'mud' }, { do: 'add_clue', clue: 'note' }],
  },
  'plot.quest': {
    doc: game('choice-quest', {
      systems: [{ use: 'plot.quest' }],
      plot: { quests: [
        { id: 'q_herbs', title: 'Herbs', summary: 'Gather herbs.', objectives: [{ id: 'o1', kind: 'reach', zone: 'yard', text: 'Go to the yard.' }] },
        { id: 'q_well', title: 'The well', summary: 'Look at the well.', objectives: [{ id: 'o1', kind: 'reach', zone: 'yard', text: 'Go to the yard.' }] },
      ] },
    }),
    choose: { track_quest: ['accept_quest', 'accept_quest'] },
  },
  // A cannon is aimed (the launcher template is a sling).
  'gameplay.launcher': {
    doc: game('choice-cannon', {
      space: { use: 'engine.space.physics2d', with: { gravity: [0, -10], bounds: [40, 20] } }, view: 'side',
      systems: [{ use: 'gameplay.launcher', with: { mode: 'cannon', origin: [2, 3], forward: [1, 0], aim: [-0.5, 1.4], speed: 22, shots: [{ archetype: 'ball', count: 2 }] } }],
      content: { archetypes: [{ id: 'gunner', kind: 'player', components: {} }, { id: 'ball', kind: 'projectile', components: { body: { size: [0.8, 0.8], shape: { kind: 'circle', r: 0.4 }, density: 2.6, bullet: true } } }] },
      player: { archetype: 'gunner', at: [1, 1] },
    }),
  },
  'gameplay.stage.sequence': {
    doc: game('choice-stages', {
      systems: [{ use: 'gameplay.stage.sequence', with: { select: true, autoStart: false, introSec: 0, clearSec: 0.1, failSec: 0.1, stages: [{ id: 's1', goal: { kind: 'when', when: { var: 'never' } } }, { id: 's2', goal: { kind: 'when', when: { var: 'never' } } }] } }],
    }),
  },
  // Cards: a duel whose charge minions attack at once, and a roguelike battle already won, offering its reward.
  'gameplay.cards': [{
    doc: game('choice-duel', {
      systems: [{ use: 'gameplay.combat.health' }, { use: 'gameplay.turns', with: TURNS }, { use: 'gameplay.cards', with: { format: 'duel', energy: 1, handSize: 3, deck: ['raider', 'raider', 'raider', 'raider'], owners: ['rival'] } }],
      content: { cards: CARDS, archetypes: [{ id: 'hero', kind: 'player', components: { health: { max: 30 } } }, { id: 'rival', kind: 'npc', components: { health: { max: 30 }, turns: { side: 'enemy' }, cards: { deck: ['raider', 'raider', 'raider'] } } }] },
    }),
    spawn: [['rival', 'home', 'r1']],
    choose: { attack_with: ['play_card'] },
  }, {
    doc: game('choice-reward', {
      systems: [{ use: 'gameplay.combat.health' }, { use: 'gameplay.turns', with: TURNS }, { use: 'gameplay.cards', with: { deck: ['strike', 'strike', 'strike', 'strike', 'strike'], rewards: { choices: 2, pool: ['strike', 'raider'] } } }],
      content: { cards: CARDS, archetypes: [{ id: 'hero', kind: 'player', components: { health: { max: 30 } } }, { id: 'cultist', kind: 'enemy', components: { health: { max: 5 }, turns: { side: 'enemy' }, cards: { intents: [{ kind: 'attack', value: 1 }] } } }] },
    }),
    spawn: [['cultist', 'home', 'c1']],
    choose: { pick_card: ['play_card'] },
  }],
  // The creature party outside battle: a party of two and one creature in the box (party size 2).
  'gameplay.creature.party': {
    doc: game('choice-party', {
      systems: [{ use: 'gameplay.creature.party', with: { size: 2, start: [{ species: 'sprout', level: 5 }, { species: 'pup', level: 5 }, { species: 'pup', level: 6 }] } }],
      content: {
        types: { fire: { grass: 2, fire: 0.5 }, grass: { fire: 0.5 }, normal: {} },
        moves: [{ id: 'tackle', name: 'Tackle', type: 'normal', category: 'physical', power: 40, accuracy: 100, pp: 35 }, { id: 'ember', name: 'Ember', type: 'fire', category: 'special', power: 40, accuracy: 100, pp: 25 }],
        species: [{ id: 'sprout', name: 'Sprout', types: ['grass'], base: B(45, 49, 49, 65, 65, 45), learnset: [{ level: 1, move: 'tackle' }] }, { id: 'pup', name: 'Pup', types: ['fire'], base: B(39, 52, 43, 60, 50, 65), learnset: [{ level: 1, move: 'tackle' }, { level: 4, move: 'ember' }] }],
      },
    }),
    choose: { withdraw: ['deposit'] },
  },
};
