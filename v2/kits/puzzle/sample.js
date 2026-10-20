// Hand-written, original sample content: one per mode (the falling one is the kit's
// default sample). Used by tests, offline generation and the lab page.
const music = (mood, tempo, key, scale, instrument) => ({ mood, tempo, key, scale, instrument });
const rules = over => ({ colors: 4, groupSize: 4, nextCount: 5, hold: true, ghost: true, variant: 'classic', pieceSet: 'standard', width: 0, height: 0, endless: false, spawnFour: 0.1, ...over });
const level = over => ({ name: 'Level', intro: '', goal: 'score', target: 0, moves: 0, timeSec: 0, speed: 1, obstacles: 0, layout: [], stars: [], ...over });

export const FALLING_SAMPLE = {
  title: 'Lumen Stack',
  logline: 'Stack glowing crystal shards in a moonlit observatory before the well overflows.',
  artStyle: 'glossy neon crystal blocks',
  background: '#1a2350',
  music: music('energetic', 138, 'A', 'minor', 'synth'),
  mode: 'falling',
  cast: { hero: 'Pip the lamplighter', rival: 'Gloom Moth', item: 'Star shard', blocker: 'Dust block', prize: 'Moon lens' },
  palette: [
    { name: 'Beam', color: '#38d6f5' }, { name: 'Cube', color: '#f7d038' }, { name: 'Tee', color: '#b05cf2' },
    { name: 'Wave', color: '#5ad65e' }, { name: 'Zag', color: '#f2485a' }, { name: 'Hook', color: '#4f74f5' }, { name: 'Crook', color: '#f59d30' },
  ],
  rules: rules({ endless: true, nextCount: 5 }),
  customPieces: [],
  levels: [
    level({ name: 'First Light', intro: 'Clear lines to light the first lamp.', goal: 'lines', target: 10, speed: 1 }),
    level({ name: 'Rising Dust', intro: 'Dust rises from below. Dig down to it.', goal: 'lines', target: 10, speed: 2, obstacles: 3 }),
    level({ name: 'Star Shower', intro: 'The shards fall faster now.', goal: 'lines', target: 10, speed: 4 }),
    level({ name: 'Midnight', intro: 'Hold steady through the darkest hour.', goal: 'lines', target: 10, speed: 6 }),
  ],
};

export const CHAIN_SAMPLE = {
  title: 'Puddle Pop',
  logline: 'Drop pairs of raindrop sprites and set off chain reactions across the garden pond.',
  artStyle: 'soft jelly blobs with shiny highlights',
  background: '#244a3a',
  music: music('playful', 126, 'F', 'major', 'pluck'),
  mode: 'chain',
  cast: { hero: 'Dew the frog', rival: 'Mud Gremlin', item: 'Lily pad', blocker: 'Mud clod', prize: 'Rain bell' },
  palette: [{ name: 'Rose', color: '#f2546a' }, { name: 'Leaf', color: '#4fd06a' }, { name: 'Sky', color: '#46a6f5' }, { name: 'Sun', color: '#f5cf3a' }],
  rules: rules({ colors: 4, groupSize: 4, endless: false }),
  customPieces: [],
  levels: [
    level({ name: 'Drizzle', intro: 'Group four of a color to pop them.', goal: 'score', target: 2500, speed: 1 }),
    level({ name: 'Muddy Bank', intro: 'Pop drops beside the mud to wash it away.', goal: 'blockers', speed: 2, obstacles: 1 }),
    level({ name: 'Downpour', intro: 'Pop one group into another for a chain.', goal: 'chain', target: 2, speed: 3 }),
  ],
};

export const VIRUS_SAMPLE = {
  title: 'Petri Panic',
  logline: 'Drop two-tone capsules into the specimen jar and line them up to wipe out the giggling germs.',
  artStyle: 'clean lab vector art',
  background: '#1d2b48',
  music: music('energetic', 150, 'D', 'mixolydian', 'chip'),
  mode: 'chain',
  cast: { hero: 'Nurse Nimbus', rival: 'Giggle germ', item: 'Capsule', blocker: 'Germ', prize: 'Golden flask' },
  palette: [{ name: 'Cherry', color: '#f2485a' }, { name: 'Lemon', color: '#f5d23a' }, { name: 'Berry', color: '#4a7cf5' }],
  rules: rules({ colors: 3, groupSize: 4, variant: 'virus' }),
  customPieces: [],
  levels: [
    level({ name: 'Swab One', intro: 'Line up four of a color through a germ.', goal: 'viruses', speed: 1, obstacles: 4 }),
    level({ name: 'Swab Two', intro: 'More germs, same steady hands.', goal: 'viruses', speed: 2, obstacles: 8 }),
    level({ name: 'Outbreak', intro: 'Clear the jar before it fills.', goal: 'viruses', speed: 3, obstacles: 12 }),
  ],
};

export const SWAP_SAMPLE = {
  title: 'Gemfall Bazaar',
  logline: 'Trade sparkling gems in a lantern-lit market to free the stalls and win the golden lamp.',
  artStyle: 'faceted jewel tones with soft glow',
  background: '#3a1f4a',
  music: music('playful', 118, 'G', 'pentatonic', 'bell'),
  mode: 'swap',
  cast: { hero: 'Saffi the trader', rival: 'Dust sprite', item: 'Brass key', blocker: 'Crate', prize: 'Golden lamp' },
  palette: [
    { name: 'Ruby', color: '#f2405a' }, { name: 'Topaz', color: '#f5b52e' }, { name: 'Emerald', color: '#3fd07a' },
    { name: 'Sapphire', color: '#3f86f5' }, { name: 'Amethyst', color: '#b45cf2' },
  ],
  rules: rules({ colors: 5 }),
  customPieces: [],
  levels: [
    level({ name: 'Opening Day', intro: 'Match three or more gems.', goal: 'score', target: 3000, moves: 20, stars: [3000, 5000, 8000] }),
    level({ name: 'Sticky Stalls', intro: 'Match on the jelly to clear it.', goal: 'jelly', moves: 25, layout: ['........', '..jjjj..', '.jjJJjj.', '.jJJJJj.', '.jJJJJj.', '.jjJJjj.', '..jjjj..', '........'] }),
    level({ name: 'Crate Alley', intro: 'Match beside crates to break them.', goal: 'blockers', moves: 25, layout: ['........', '........', '........', 'bb....bb', 'bB....Bb', '...bb...', '........', '........'] }),
    level({ name: 'Key Hunt', intro: 'Bring the keys down to the bottom.', goal: 'collect', target: 3, moves: 30 }),
  ],
};

export const SLIDE_SAMPLE = {
  title: 'Moonstone Merge',
  logline: 'Slide moonstones together and merge them into ever brighter gems.',
  artStyle: 'soft pastel stone tiles',
  background: '#2a2f4f',
  music: music('dreamy', 92, 'E', 'major', 'bell'),
  mode: 'slide',
  cast: { hero: 'Lune the owl', rival: 'Night fog', item: 'Moonstone', blocker: 'Boulder', prize: 'Crown of stars' },
  palette: [{ name: 'Dusk', color: '#8fa8ff' }, { name: 'Bloom', color: '#ff8fc8' }, { name: 'Ember', color: '#ffb35a' }, { name: 'Glow', color: '#fff27a' }],
  rules: rules({ width: 4, endless: true, spawnFour: 0.1 }),
  customPieces: [],
  levels: [
    level({ name: 'Pebbles', intro: 'Slide matching stones together.', goal: 'tile', target: 64 }),
    level({ name: 'Gems', intro: 'Keep your biggest stone in a corner.', goal: 'tile', target: 256 }),
    level({ name: 'Moonstone', intro: 'Reach the legendary moonstone.', goal: 'tile', target: 1024 }),
  ],
};

export const SAMPLES = { falling: FALLING_SAMPLE, chain: CHAIN_SAMPLE, virus: VIRUS_SAMPLE, swap: SWAP_SAMPLE, slide: SLIDE_SAMPLE };
