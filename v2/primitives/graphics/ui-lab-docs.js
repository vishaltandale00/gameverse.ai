// Small documents for the UI lab page (ui-lab.html): every UI primitive on
// real spaces and plot primitives, so the browser check runs through
// v2/web/player.js mountGame exactly as games do.
export function villageDoc() {
  return {
    schema: 'gameverse.v2.game/0.2', id: 'ui-lab-village', title: 'Lantern Vale: A UI Test', logline: 'A small valley used to exercise every HUD, dialogue, journal, map, inventory and menu primitive.',
    views: { primary: 'td' }, seed: 7,
    spaces: [{ id: 'vale', use: 'engine.space.tilemap', with: { size: [64, 40], mode: 'topdown' }, zones: [
      { id: 'village', name: 'Emberwick Village', rect: [0, 0, 24, 20], tags: ['town', 'start'], description: 'Smoke curls from a dozen chimneys around a well that never freezes.' },
      { id: 'woods', name: 'Whisper Woods', rect: [24, 0, 48, 20], tags: ['forest'], description: 'Old pines lean together as if sharing a secret.' },
      { id: 'lake', name: 'Glass Lake', rect: [0, 20, 24, 40], tags: ['water'], description: 'Still enough to see the stars at noon.' },
      { id: 'shrine', name: 'Hilltop Shrine', rect: [48, 0, 64, 20], tags: ['shrine'], description: 'A wind-worn shrine where travellers rest.' },
      { id: 'ruins', name: 'Sunken Ruins', rect: [24, 20, 64, 40], tags: ['cave', 'dark'], description: 'Broken arches half swallowed by the marsh.' },
    ] }],
    plot: {
      characters: [{ id: 'mara', name: 'Mara the Smith', role: 'smith; keeper of the forge', bio: 'Mara has kept the village forge burning for thirty winters.', archetype: 'villager', model: 'mara', home: 'village', at: [4, 4], dialogue: [{ id: 'hello' }] }],
      dialogue: { hello: { speaker: 'mara', start: 'n1', nodes: {
        n1: { who: 'mara', say: 'Ah, a new face. The road from the coast is long, and colder every year.', next: 'n2' },
        n2: { who: 'mara', say: 'My lantern went dark in the Whisper Woods. Will you look for it? I can pay, a little.', choices: [
          { text: 'I will find it.', next: 'yes', do: [{ do: 'start_quest', quest: 'lamp' }, { do: 'notify', text: 'Mara marked the woods on your map', kind: 'quest' }] },
          { text: 'Tell me about the woods first.', next: 'woods' }, { text: 'Not today.', next: 'no' }] },
        woods: { who: 'mara', say: 'The pines whisper. Most of it is wind. Most of it.', next: 'n2' },
        yes: { who: 'mara', say: 'Bless you. Take this, the nights are long.', do: [{ do: 'give_item', item: 'potion', count: 2 }], end: true },
        no: { who: 'mara', say: 'The forge will wait. It always does.', end: true } } } },
      quests: [
        { id: 'lamp', title: 'The Dark Lantern', kind: 'main', giver: 'mara', zone: 'woods', summary: 'Mara\'s lantern went dark somewhere in the Whisper Woods.', objectives: [{ id: 'go', kind: 'reach', zone: 'woods', text: 'Search the Whisper Woods' }, { id: 'back', kind: 'talk', character: 'mara', text: 'Return to Mara' }], rewards: { items: [{ item: 'charm_ember', count: 1 }] } },
        { id: 'fish', title: 'A Fish Called Supper', kind: 'side', zone: 'lake', summary: 'Catch something for the inn.', autoStart: false, objectives: [{ id: 'catch', kind: 'reach', zone: 'lake', text: 'Visit Glass Lake' }] },
      ],
      entries: [{ id: 'e_vale', title: 'Lantern Vale', text: 'The valley takes its name from the lanterns hung on every door through winter.', tag: 'lore' }, { id: 'e_pines', title: 'The Whispering Pines', text: 'Locals swear the pines repeat what you say, a day later.', tag: 'lore', when: { zone: 'woods' } }],
    },
    content: {
      items: [
        { id: 'sword', name: 'Ember Blade', kind: 'weapon', weapon: { damage: 7, reach: 1.6, speed: 1.1, type: 'fire' }, value: 40, desc: 'Still warm from the forge.' },
        { id: 'potion', name: 'Red Tonic', kind: 'potion', use: { fx: [] }, value: 8, desc: 'Tastes of cherries and regret.' },
        { id: 'herb', name: 'Frostleaf', kind: 'material', value: 2, desc: 'Grows only where snow lies longest.' },
        { id: 'key', name: 'Rusty Key', kind: 'key', desc: 'Opens something, somewhere.' },
        { id: 'charm_ember', name: 'Ember Charm', kind: 'charm', charm: { cost: 2, mods: { fire: 1 } }, desc: 'A coal that never cools.' },
        { id: 'stone', name: 'Stone', kind: 'block', block: 'stone', value: 1 },
      ],
      recipes: [{ id: 'r_tonic', inputs: [{ item: 'herb', count: 3 }], output: { item: 'potion', count: 1 } }],
      blocks: [{ id: 'stone', name: 'Stone', color: '#8a8f99', solid: true }],
      models: {
        hero: { kind: 'pixel', size: [16, 22], palette: { o: '#1b1626', b: '#e8dcc8', w: '#fff6d8', f: '#ffb347', k: '#2d2640' }, parts: [{ name: 'body', rect: [4, 3, 8, 12], c: 'b' }, { name: 'hood', rect: [3, 12, 10, 8], c: 'k' }, { name: 'eyes', rect: [5, 14, 6, 2], c: 'w' }, { name: 'lantern', rect: [12, 6, 3, 5], c: 'f' }, { name: 'legs', rect: [5, 0, 6, 4], c: 'o' }] },
        mara: { kind: 'voxel', size: [16, 32, 8], palette: { s: '#c89a78', h: '#c0c0c8', t: '#8a3a2a', p: '#2a2a32', b: '#1a1a1a' }, parts: [{ name: 'head', box: [4, 24, 0, 8, 8, 8], c: 's' }, { name: 'hair', box: [4, 30, 0, 8, 2, 8], c: 'h' }, { name: 'torso', box: [4, 12, 2, 8, 12, 4], c: 't' }, { name: 'armL', box: [0, 12, 2, 4, 12, 4], c: 't' }, { name: 'armR', box: [12, 12, 2, 4, 12, 4], c: 't' }, { name: 'legL', box: [4, 0, 2, 4, 12, 4], c: 'p' }, { name: 'legR', box: [8, 0, 2, 4, 12, 4], c: 'p' }, { name: 'boots', box: [4, 0, 2, 8, 2, 4], c: 'b' }] },
      },
      archetypes: [{ id: 'hero', kind: 'player', name: 'Wick', components: { model: 'hero', health: { max: 5 }, resources: { stamina: { max: 100 } } } }, { id: 'villager', kind: 'npc', components: { model: 'mara' } }],
    },
    player: { archetype: 'hero', space: 'vale', at: [3, 3] },
    systems: [
      { use: 'gameplay.inventory', with: { start: [{ item: 'sword', count: 1 }, { item: 'herb', count: 4 }, { item: 'key', count: 1 }, { item: 'stone', count: 24 }] } },
      { use: 'plot.character', with: {} }, { use: 'plot.dialogue', with: { lineSpeed: 40 } }, { use: 'plot.quest', with: {} }, { use: 'plot.journal', with: {} }, { use: 'plot.barks', with: {} },
    ],
    graphics: [
      { use: 'graphics.ui.hud', with: { meters: [{ pool: 'stamina' }], counters: [{ var: 'hp', icon: 'heart', pos: 'top-left' }, { var: 'money.gold', icon: 'coin', pos: 'top-right' }, { item: 'herb', pos: 'top-right' }], stars: { var: 'wanted', max: 5 }, clock: true, compass: true, crosshair: 'none' } },
      { use: 'graphics.ui.dialogue', with: { portrait: true } },
      { use: 'graphics.ui.journal', with: { tabs: ['quests', 'lore', 'characters'] } },
      { use: 'graphics.ui.minimap', with: { radius: 20, markers: [{ tag: 'npc', color: '#7ad8ff' }] } },
      { use: 'graphics.ui.map', with: { fog: true } },
      { use: 'graphics.ui.inventory', with: { panels: ['items', 'crafting', 'loadout'] } },
      { use: 'graphics.ui.menu', with: { slots: 3, autoPause: false } },
      { use: 'graphics.audio.synth', with: { music: [{ zone: 'village', mood: 'playful', layers: ['pad', 'pluck', 'bass', 'perc'] }, { zone: 'woods', mode: 'dorian', bpm: 84, layers: ['drone', 'bell', 'wind'] }, { when: { var: 'danger', gte: 1 }, mode: 'phrygian', bpm: 140, layers: ['bass', 'perc', 'strings'], priority: 5 }] } },
    ],
  };
}
