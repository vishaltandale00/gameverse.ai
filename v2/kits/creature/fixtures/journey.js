// A compact journey in the model's schema (generate/schema.js), as a generator would write it:
// rough base stats, levels left to the engine, a couple of deliberate rough edges (an unknown
// move, an out-of-range power) that balance() must repair. Used by the generation tests.
const route = (id, name, kind, theme, encounters, trainers, extra = {}) => ({ id, name, kind, theme, description: `${name}.`, length: 0, encounterRate: 0, encounters, trainers, ...extra });
const tr = (id, name, cls, look, party, intro, defeat) => ({ id, name, class: cls, look, party: party.map(species => ({ species })), intro, defeat });
const fx = (kind = 'none', o = {}) => ({ kind, status: 'none', target: 'foe', stat: 'atk', stages: 0, chance: 0, fraction: 0, hitsMin: 2, hitsMax: 5, ...o });
const mv = (id, name, type, category, power, accuracy, pp, effect = fx(), priority = 0) => ({ id, name, type, category, power, accuracy, pp, priority, effect, description: name });
const sp = (id, name, types, stage, base, learnset, evolvesTo, evolveLevel, look, dex) => ({ id, name, types, stage, growth: 'medium', base: { hp: base[0], atk: base[1], def: base[2], spa: base[3], spd: base[4], spe: base[5] }, learnset: learnset.map(([level, move]) => ({ level, move })), evolvesTo, evolveLevel, look, dex });

export const JOURNEY = {
  settings: { routeLength: 50, encounterRate: 10, difficulty: 'normal', levelStep: 7 },
  title: 'Tidewind Isles', logline: 'Sail a chain of islands, befriend tide spirits and win the lighthouse crowns.', artStyle: 'sunny 16-bit pixel art',
  music: { mood: 'playful', tempo: 120, key: 'G', scale: 'major', instrument: 'square' },
  region: { name: 'Tidewind', description: 'Sunny islands linked by sandbars and coral caves.' },
  player: { name: 'Juno', look: 'a kid with a yellow cap and a blue vest' },
  rival: { name: 'Corin', look: 'a tall kid with black spiky hair and a red jacket', personality: 'boastful' },
  mentor: { name: 'Captain Mara', look: 'an old sailor woman with a white coat', role: 'creature cartographer' },
  types: [
    { id: 'plain', name: 'Plain', color: '#b0a890', look: 'simple' }, { id: 'bloom', name: 'Bloom', color: '#62c062', look: 'petals and leaves' },
    { id: 'blaze', name: 'Blaze', color: '#ec6a32', look: 'flames' }, { id: 'surf', name: 'Surf', color: '#3c8ee6', look: 'water' },
    { id: 'coral', name: 'Coral', color: '#e88aa8', look: 'coral and shells' }, { id: 'zephyr', name: 'Zephyr', color: '#9ab0f0', look: 'wind and feathers' },
    { id: 'volt', name: 'Volt', color: '#f2d23a', look: 'sparks' },
  ],
  chart: [
    { attacking: 'bloom', defending: 'surf', multiplier: '2' }, { attacking: 'surf', defending: 'blaze', multiplier: '2' }, { attacking: 'blaze', defending: 'bloom', multiplier: '2' },
    { attacking: 'bloom', defending: 'blaze', multiplier: '0.5' }, { attacking: 'surf', defending: 'bloom', multiplier: '0.5' }, { attacking: 'blaze', defending: 'surf', multiplier: '0.5' },
    { attacking: 'volt', defending: 'surf', multiplier: '2' }, { attacking: 'volt', defending: 'zephyr', multiplier: '2' }, { attacking: 'zephyr', defending: 'bloom', multiplier: '2' },
    { attacking: 'coral', defending: 'blaze', multiplier: '2' }, { attacking: 'coral', defending: 'zephyr', multiplier: '2' }, { attacking: 'bloom', defending: 'coral', multiplier: '2' },
    { attacking: 'plain', defending: 'coral', multiplier: '0.5' }, { attacking: 'volt', defending: 'coral', multiplier: '0' },
  ],
  moves: [
    mv('bump', 'Bump', 'plain', 'physical', 40, 100, 35), mv('glare', 'Glare', 'plain', 'status', 0, 100, 30, fx('stat', { stat: 'def', stages: -1, chance: 100 })),
    mv('dash', 'Dash', 'plain', 'physical', 40, 100, 30, fx(), 1), mv('mend', 'Mend', 'plain', 'status', 0, 0, 10, fx('heal', { fraction: 0.5, target: 'self' })),
    mv('petal-flick', 'Petal Flick', 'bloom', 'special', 40, 100, 25), mv('vine-crush', 'Vine Crush', 'bloom', 'physical', 85, 95, 10),
    mv('pollen', 'Pollen', 'bloom', 'status', 0, 75, 15, fx('status', { status: 'sleep', chance: 100 })),
    mv('spark-flick', 'Spark Flick', 'blaze', 'special', 40, 100, 25, fx('status', { status: 'burn', chance: 10 })), mv('flare-dive', 'Flare Dive', 'blaze', 'physical', 220, 95, 10, fx('recoil', { fraction: 0.25 })),
    mv('splash-shot', 'Splash Shot', 'surf', 'special', 40, 100, 25), mv('breaker', 'Breaker', 'surf', 'physical', 85, 95, 10),
    mv('shell-toss', 'Shell Toss', 'coral', 'physical', 45, 95, 25), mv('reef-bash', 'Reef Bash', 'coral', 'physical', 80, 90, 10, fx('flinch', { chance: 20 })),
    mv('gust-cut', 'Gust Cut', 'zephyr', 'special', 40, 100, 30), mv('cyclone', 'Cyclone', 'zephyr', 'special', 80, 95, 10, fx('status', { status: 'confusion', chance: 20 })),
    mv('zap-tap', 'Zap Tap', 'volt', 'special', 40, 100, 30, fx('status', { status: 'paralysis', chance: 10 })), mv('jolt-wave', 'Jolt Wave', 'volt', 'status', 0, 90, 20, fx('status', { status: 'paralysis', chance: 100 })),
    mv('thunderclap', 'Thunderclap', 'volt', 'special', 85, 100, 10),
  ],
  species: [
    sp('budling', 'Budling', ['bloom'], 'base', [45, 49, 49, 65, 65, 45], [[1, 'bump'], [1, 'glare'], [4, 'petal-flick'], [12, 'pollen'], [22, 'vine-crush']], 'thornova', 16, 'a round sprout creature with two leaf ears', 'It sunbathes on rooftops.'),
    sp('thornova', 'Thornova', ['bloom'], 'middle', [60, 62, 63, 80, 80, 60], [[1, 'bump'], [1, 'petal-flick'], [22, 'vine-crush']], 'grovezar', 32, 'a four-legged leafy creature with a flower on its back', 'Its flower blooms in battle.'),
    sp('grovezar', 'Grovezar', ['bloom'], 'final', [80, 82, 83, 100, 100, 80], [[1, 'petal-flick'], [1, 'vine-crush']], '', 0, 'a huge four-legged beast with a tree on its back', 'Forests grow where it rests.'),
    sp('cindle', 'Cindle', ['blaze'], 'base', [39, 52, 43, 60, 50, 65], [[1, 'bump'], [1, 'glare'], [4, 'spark-flick'], [14, 'dash'], [24, 'flare-dive']], 'pyrrux', 16, 'a lizard pup with a flame tail', 'Its tail flame never goes out.'),
    sp('pyrrux', 'Pyrrux', ['blaze'], 'middle', [58, 64, 58, 80, 65, 80], [[1, 'bump'], [1, 'spark-flick']], 'infernox', 32, 'a fierce red lizard with ember scales', 'It roars sparks.'),
    sp('infernox', 'Infernox', ['blaze', 'zephyr'], 'final', [78, 84, 78, 109, 85, 100], [[1, 'spark-flick'], [1, 'flare-dive']], '', 0, 'a winged fire lizard', 'It flies above volcanoes.'),
    sp('dribbit', 'Dribbit', ['surf'], 'base', [44, 48, 65, 50, 64, 43], [[1, 'bump'], [1, 'glare'], [4, 'splash-shot'], [20, 'breaker']], 'tidlet', 16, 'a small blue frog with fins', 'It sings before rain.'),
    sp('tidlet', 'Tidlet', ['surf'], 'middle', [59, 63, 80, 65, 80, 58], [[1, 'bump'], [1, 'splash-shot']], 'surgeon', 32, 'a sleek frog with a shell back', 'It rides waves.'),
    sp('surgeon', 'Surgeon', ['surf'], 'final', [79, 83, 100, 85, 105, 78], [[1, 'splash-shot'], [1, 'breaker']], '', 0, 'a giant armored toad with water cannons', 'Its cannons pierce steel.'),
    sp('puffin', 'Puffinch', ['plain', 'zephyr'], 'base', [40, 45, 40, 35, 35, 56], [[1, 'bump'], [1, 'glare'], [9, 'gust-cut'], [18, 'dash']], 'skyfinch', 18, 'a round little seabird with a crest', 'It nests on cliffs.'),
    sp('skyfinch', 'Skyfinch', ['plain', 'zephyr'], 'final', [63, 70, 60, 60, 55, 92], [[1, 'gust-cut'], [1, 'cyclone']], '', 0, 'a sleek white seabird', 'It glides for days.'),
    sp('shellby', 'Shellby', ['coral'], 'base', [50, 60, 80, 30, 50, 25], [[1, 'bump'], [1, 'nope'], [6, 'shell-toss'], [20, 'reef-bash']], 'reefhorn', 22, 'a pink coral crab with a shell', 'It hides in reefs.'),
    sp('reefhorn', 'Reefhorn', ['coral'], 'final', [70, 95, 110, 45, 60, 40], [[1, 'shell-toss'], [1, 'reef-bash']], '', 0, 'a big coral crab with horns', 'Its horns grow back.'),
    sp('zapling', 'Zapling', ['volt'], 'base', [35, 50, 35, 65, 45, 90], [[1, 'zap-tap'], [1, 'glare'], [5, 'dash'], [12, 'jolt-wave'], [22, 'thunderclap']], '', 0, 'a yellow mouse with lightning whiskers', 'It stores static.'),
    sp('mossnail', 'Mossnail', ['bloom', 'coral'], 'base', [55, 45, 70, 45, 60, 20], [[1, 'bump'], [1, 'glare'], [8, 'petal-flick']], '', 0, 'a slow snail with a mossy shell', 'It naps for weeks.'),
  ],
  starters: ['budling', 'cindle', 'dribbit'],
  items: [
    { id: 'net-ball', name: 'Net Ball', kind: 'ball', price: 200, value: 1, description: 'Catches wild creatures.' },
    { id: 'reef-ball', name: 'Reef Ball', kind: 'ball', price: 600, value: 1.5, description: 'A better chance to catch.' },
    { id: 'kelp-tea', name: 'Kelp Tea', kind: 'heal', price: 300, value: 20, description: 'Restores 20 HP.' },
    { id: 'sea-tonic', name: 'Sea Tonic', kind: 'heal', price: 700, value: 50, description: 'Restores 50 HP.' },
    { id: 'salt-cure', name: 'Salt Cure', kind: 'status', price: 400, value: 0, description: 'Cures any status.' },
    { id: 'pearl', name: 'Revive Pearl', kind: 'revive', price: 1500, value: 0.5, description: 'Revives a fainted creature.' },
  ],
  home: { id: 'harbor', name: 'Harbor Town', theme: 'sunny harbor village with docks', description: 'Your home port.', npcs: [{ id: 'dad', name: 'Dad', look: 'a man with a fishing hat', lines: ['Good winds, Juno!'] }] },
  chapters: [
    {
      routes: [route('sandbar', 'Sandbar Path', 'route', 'sunny beach path', [{ species: 'puffin', weight: 50 }, { species: 'shellby', weight: 30 }, { species: 'mossnail', weight: 20 }], [tr('kid-ola', 'Ola', 'Beach Kid', 'a girl with a pink sunhat', ['puffin'], 'The sea breeze is on my side!', 'Aww, salty!')])],
      town: { id: 'palmport', name: 'Palmport', theme: 'palm-tree market town', description: 'A busy market.', npcs: [{ id: 'trader', name: 'Trader', look: 'a merchant with a green vest', lines: ['Coral creatures hate Bloom moves!'] }] },
      gym: { id: 'palmport-gym', name: 'Palmport Gym', theme: 'coral hall', description: 'The Coral Crown gym.', trainers: [tr('diver-pell', 'Pell', 'Diver', 'a diver with goggles', ['shellby'], 'Dive in!', 'Glub...')],
        leader: { id: 'leader-reva', name: 'Reva', look: 'a woman with pink coral hair', type: 'coral', badge: 'Coral Crown', party: [{ species: 'shellby' }, { species: 'reefhorn' }], intro: 'My reef is unbreakable!', defeat: 'You broke through. Take the Coral Crown.' } },
    },
    {
      routes: [route('gull-cliffs', 'Gull Cliffs', 'route', 'windy cliffs over the sea', [{ species: 'puffin', weight: 40 }, { species: 'zapling', weight: 40 }, { species: 'mossnail', weight: 20 }], [tr('sailor-bo', 'Bo', 'Sailor', 'a sailor with a striped shirt', ['puffin', 'zapling'], 'Ahoy!', 'Sunk!')]),
        route('coral-cave', 'Coral Cave', 'cave', 'glowing coral cave', [{ species: 'shellby', weight: 60 }, { species: 'zapling', weight: 40 }], [tr('miner-tes', 'Tes', 'Miner', 'a miner with a headlamp', ['shellby', 'shellby'], 'Watch your step!', 'Caved in...')])],
      town: { id: 'stormhaven', name: 'Stormhaven', theme: 'stormy fishing town on stilts', description: 'Lightning crackles over the bay.', npcs: [] },
      gym: { id: 'stormhaven-gym', name: 'Stormhaven Gym', theme: 'lightning tower', description: 'The Storm Crown gym.', trainers: [],
        leader: { id: 'leader-vik', name: 'Vik', look: 'a stern man with a yellow raincoat', type: 'volt', badge: 'Storm Crown', party: [{ species: 'zapling' }, { species: 'zapling' }, { species: 'skyfinch' }], intro: 'Feel the storm!', defeat: 'The storm passes. The Storm Crown is yours.' } },
    },
  ],
  finale: {
    routes: [route('lighthouse-way', 'Lighthouse Way', 'route', 'misty seaside trail', [{ species: 'skyfinch', weight: 40 }, { species: 'reefhorn', weight: 30 }, { species: 'zapling', weight: 30 }], [tr('ace-nia', 'Nia', 'Ace', 'a trainer in a sleek blue coat', ['skyfinch', 'zapling'], 'Only the best reach the light.', 'Go on.')])],
    league: { id: 'lighthouse', name: 'Great Lighthouse', theme: 'grand stone hall atop a lighthouse', description: 'Where the champion waits.' },
    champion: { name: 'Champion Sol', look: 'a radiant woman in a white cloak', party: [{ species: 'skyfinch' }, { species: 'reefhorn' }, { species: 'zapling' }], intro: 'Show me the islands in your heart.', defeat: 'A new champion of the tides!' },
  },
  moments: [{ area: 'palmport', who: 'mentor', text: 'Palmport! The gym here uses Coral types. Bloom moves work wonders.' }],
};
