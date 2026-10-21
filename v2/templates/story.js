// Story adventure (the point-and-click / text adventure family): a harbour town of named places joined by exits on a
// graph space, drawn as illustrated scene cards. The lighthouse went dark and a ship ran aground. The player walks
// between places, talks to the townsfolk (dialogue with choices), collects items and clues, opens the two locked ways
// up the lighthouse (a key, then lamp oil) and names who put the light out. Four endings: the light relit with the
// culprit named (won), the light relit with nobody named (neutral), the smuggler's bribe taken (lost), the wrong man
// accused (lost). The story's loop is plot.storyboard's (card.mode 'story', bot 'story': the plot solver's path played
// through the controls); talk, choose, deduce and travel are issued by the UI the host mounts for a text game.
export default {
  id: 'story',
  concept: 'Story adventure: explore places, talk to characters and choose what to say, collect items and clues, open locked ways and reach one of several endings.',
  doc: {
    schema: 'gameverse.v2.game/0.2', id: 'story', title: 'Story', seed: 1, views: { primary: 'text' },
    spaces: [{ id: 'town', use: 'engine.space.graph', zones: [
      { id: 'harbour', name: 'Harbour', tags: ['town', 'water'], exits: [{ to: 'inn' }, { to: 'chapel' }, { to: 'cliffs' }] },
      { id: 'inn', name: 'Inn', tags: ['town', 'indoors'], exits: [{ to: 'harbour' }] },
      { id: 'chapel', name: 'Chapel', tags: ['town', 'indoors'], exits: [{ to: 'harbour' }] },
      { id: 'cliffs', name: 'Cliff path', tags: ['wild'], exits: [{ to: 'harbour' }, { to: 'tower' }] },
      { id: 'tower', name: 'Lighthouse', tags: ['indoors'], exits: [{ to: 'cliffs' }, { to: 'lamp_room' }] },
      { id: 'lamp_room', name: 'Lamp room', tags: ['indoors', 'high'], exits: [{ to: 'tower' }] },
    ] }],
    systems: [
      { use: 'gameplay.inventory' },
      { use: 'plot.character', with: { talkRange: 0 } },
      { use: 'plot.dialogue', with: { lineSpeed: 0 } },
      { use: 'plot.gate' },
      { use: 'plot.investigation' },
      { use: 'plot.quest' },
      { use: 'plot.journal' },
      { use: 'plot.storyboard', with: { sequentialActs: false } },
      { use: 'plot.ending' },
    ],
    plot: {
      characters: [
        { id: 'keeper', name: 'Keeper', role: 'lighthouse keeper', archetype: 'townsfolk', home: 'inn', bio: 'Kept the light for forty years.', dialogue: [{ id: 'keeper_talk' }] },
        { id: 'fisher', name: 'Fisher', role: 'fisher', archetype: 'townsfolk', home: 'harbour', bio: 'Saw the ship strike the rocks.', dialogue: [{ id: 'fisher_talk' }] },
        { id: 'priest', name: 'Priest', role: 'priest', archetype: 'townsfolk', home: 'chapel', bio: 'Keeps the parish books.', dialogue: [{ id: 'priest_talk' }] },
        { id: 'smuggler', name: 'Smuggler', role: 'smuggler', archetype: 'townsfolk', home: 'cliffs', bio: 'New in town, always on the cliffs.', dialogue: [{ id: 'smuggler_talk' }] },
      ],
      dialogue: {
        keeper_talk: { speaker: 'keeper', start: 'k1', nodes: {
          k1: { say: 'The light went out on my watch. They will hang it on me.', choices: [
            { text: 'Give me the tower key and I will find out why.', if: { met: 'priest' }, once: true, do: [{ do: 'give_item', item: 'tower_key' }], next: 'k2' },
            { text: 'Where were you last night?', next: 'k3' },
            { text: 'Goodbye.', end: true },
          ] },
          k2: { say: 'Take it. The stair up to the lamp is dark: you will need oil to climb it.', end: true },
          k3: { say: 'Here, drinking. Ask the priest: he saw me.', end: true },
        } },
        fisher_talk: { speaker: 'fisher', start: 'f1', nodes: {
          f1: { say: 'The ship struck the rocks at midnight. Not a glimmer from the tower.', choices: [
            { text: 'Can you spare some lamp oil?', once: true, do: [{ do: 'give_item', item: 'lamp_oil' }], next: 'f2' },
            { text: 'Did you see anyone on the cliffs?', next: 'f3' },
            { text: 'Goodbye.', end: true },
          ] },
          f2: { say: 'A full can. Bring the light back.', end: true },
          f3: { say: 'A stranger with a lantern, walking up to the tower.', do: [{ do: 'add_entry', entry: 'stranger' }], end: true },
        } },
        priest_talk: { speaker: 'priest', start: 'p1', nodes: {
          p1: { say: 'The keeper sat in the inn all night; I saw him there.', choices: [
            { text: 'Who has come to town lately?', next: 'p2' },
            { text: 'Goodbye.', end: true },
          ] },
          p2: { say: 'Only the stranger on the cliffs. He paid the parish for a berth with salvage money.', do: [{ do: 'add_clue', clue: 'salvage_money' }], end: true },
        } },
        smuggler_talk: { speaker: 'smuggler', start: 's1', nodes: {
          s1: { say: 'Lost, friend? The cliffs are no place at night.', choices: [
            { text: 'What do you know about the wreck?', next: 's2' },
            { text: 'Goodbye.', end: true },
          ] },
          s2: { say: 'Wrecks wash up cargo. Keep quiet and half of it is yours.', choices: [
            { text: 'Take the money.', do: [{ do: 'set_flag', flag: 'took_bribe' }], end: true },
            { text: 'I am not for sale.', end: true },
          ] },
        } },
      },
      gates: [
        { id: 'tower_door', requires: { item: 'tower_key' }, hint: 'The lighthouse door is locked.', locks: ['exit:cliffs>tower'] },
        { id: 'dark_stair', requires: { item: 'lamp_oil' }, hint: 'The stair is pitch dark.', locks: ['exit:tower>lamp_room'] },
      ],
      clues: [
        { id: 'boot_prints', title: 'Boot prints on the cliff path', text: 'Fresh prints lead from the cliffs to the tower door.', when: { zone: 'cliffs' } },
        { id: 'salvage_money', title: 'Salvage money', text: 'The stranger paid with money from salvaged cargo.' },
        { id: 'logbook', title: 'The keeper\'s log', text: 'The last entry: the lamp was lit at dusk, as always.', when: { zone: 'tower' } },
        { id: 'cut_wick', title: 'A cut wick', text: 'A length of lamp wick on the stair, cut clean through.', when: { zone: 'tower' } },
      ],
      deductions: [
        { id: 'smuggler_did_it', title: 'The smuggler put the light out to wreck the ship', clues: ['boot_prints', 'salvage_money', 'cut_wick'], conclusion: 'He cut the wick so the ship would strike the rocks, then took its cargo.' },
        { id: 'keeper_did_it', title: 'The keeper let the light die', clues: ['logbook'], wrong: true, conclusion: 'The keeper was in the inn all night: the wrong man.' },
      ],
      entries: [
        { id: 'wreck', title: 'The wreck', text: 'A merchant ship struck the rocks below the dark lighthouse.', tag: 'lore', when: { time: 0 } },
        { id: 'stranger', title: 'The stranger', text: 'Someone walked up to the tower with a lantern on the night of the wreck.', tag: 'note' },
        { id: 'relit', title: 'The light relit', text: 'The lamp burns again over the harbour.', tag: 'lore' },
      ],
      quests: [
        { id: 'relight', title: 'Relight the lighthouse', kind: 'main', autoStart: true, objectives: [{ id: 'climb', kind: 'reach', zone: 'lamp_room' }] },
      ],
      storyboard: { acts: [{ id: 'night', beats: [
        { id: 'arrive', when: { zone: 'harbour' }, do: [{ do: 'say', character: 'fisher', text: 'You came on the morning boat? Then you saw the wreck.' }] },
        { id: 'light_relit', when: { all: [{ zone: 'lamp_room' }, { item: 'lamp_oil' }] }, do: [{ do: 'set_flag', flag: 'light_on' }, { do: 'add_entry', entry: 'relit' }] },
      ] }] },
      endings: [
        { id: 'bribed', title: 'Paid to forget', when: { flag: 'took_bribe' }, outcome: 'lost', epilogue: 'You leave on the next boat with salvage money, and the tower stays dark.' },
        { id: 'wrong_man', title: 'The wrong man', when: { deduced: 'keeper_did_it' }, outcome: 'lost', epilogue: 'The keeper is taken away; the smuggler sails off with the cargo.' },
        { id: 'justice', title: 'Light and justice', when: { all: [{ flag: 'light_on' }, { deduced: 'smuggler_did_it' }] }, outcome: 'won', epilogue: 'The light burns again and the smuggler is caught with the cargo.' },
        { id: 'light_only', title: 'The light alone', when: { flag: 'light_on' }, outcome: 'neutral', epilogue: 'The light burns again, but nobody learns who put it out.' },
      ],
    },
    content: {
      items: [{ id: 'tower_key', name: 'Tower key' }, { id: 'lamp_oil', name: 'Lamp oil' }],
      archetypes: [{ id: 'visitor', name: 'Visitor', components: {} }, { id: 'townsfolk', name: 'Townsfolk', components: {} }],
    },
    player: { archetype: 'visitor', space: 'town', at: 'harbour' },
  },
  tune: [],
};
