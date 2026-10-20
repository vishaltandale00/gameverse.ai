// Offline planner: no model, no network. Picks the closest example, then
// reskins and retunes it from the request's wording. Used when no Claude
// credentials are configured and as the fallback when a model spec can't be
// repaired, so a request always yields something playable in milliseconds.
import { tweakSpec } from './tweak.js';

const STOP = new Set('a an the of in on with and or to for my me i want make game where that is are be it its like who which some about into as at by'.split(' '));

// Nouns -> emoji for reskinning. Order matters: first match wins per role.
const GLYPHS = [
  ['cat', '🐱'], ['kitten', '🐱'], ['dog', '🐶'], ['puppy', '🐶'], ['fox', '🦊'], ['frog', '🐸'], ['penguin', '🐧'], ['bunny', '🐰'], ['rabbit', '🐰'],
  ['bear', '🐻'], ['panda', '🐼'], ['monkey', '🐵'], ['robot', '🤖'], ['ninja', '🥷'], ['knight', '🛡️'], ['wizard', '🧙'], ['witch', '🧙'],
  ['astronaut', '🧑‍🚀'], ['pilot', '🧑‍🚀'], ['alien', '👽'], ['ghost', '👻'], ['zombie', '🧟'], ['vampire', '🧛'], ['dragon', '🐉'], ['dinosaur', '🦖'],
  ['dino', '🦖'], ['bee', '🐝'], ['bird', '🐦'], ['duck', '🦆'], ['chicken', '🐔'], ['snail', '🐌'], ['octopus', '🐙'], ['shark', '🦈'], ['fish', '🐟'],
  ['mouse', '🐭'], ['slime', '🟢'], ['spider', '🕷️'], ['bat', '🦇'], ['skeleton', '💀'], ['pirate', '🏴‍☠️'], ['princess', '👸'], ['chef', '🧑‍🍳'],
  ['coin', '🪙'], ['gold', '🪙'], ['gem', '💎'], ['diamond', '💎'], ['crystal', '💎'], ['star', '⭐'], ['apple', '🍎'], ['banana', '🍌'], ['cherry', '🍒'],
  ['pizza', '🍕'], ['donut', '🍩'], ['cookie', '🍪'], ['cake', '🍰'], ['candy', '🍬'], ['carrot', '🥕'], ['mushroom', '🍄'], ['flower', '🌸'],
  ['heart', '💖'], ['key', '🗝️'], ['egg', '🥚'], ['bone', '🦴'], ['cheese', '🧀'], ['acorn', '🌰'], ['shell', '🐚'], ['sock', '🧦'],
  ['fire', '🔥'], ['lava', '🔥'], ['spike', '🔺'], ['bomb', '💣'], ['cactus', '🌵'], ['snowman', '⛄'], ['crab', '🦀'], ['scorpion', '🦂'], ['snake', '🐍'],
];
const PICKUP = new Set(['coin', 'gold', 'gem', 'diamond', 'crystal', 'star', 'apple', 'banana', 'cherry', 'pizza', 'donut', 'cookie', 'cake', 'candy', 'carrot', 'mushroom', 'flower', 'heart', 'key', 'egg', 'bone', 'cheese', 'acorn', 'shell', 'sock', 'fish']);
const HAZARD = new Set(['fire', 'lava', 'spike', 'bomb', 'cactus']);
const THEMES = [
  [/space|galaxy|planet|moon|star ?ship|cosmic/, { background: '#0d0b24', solid: '#3d3a6b' }],
  [/ocean|sea|underwater|beach|reef/, { background: '#0b2a3d', solid: '#1f5a6e' }],
  [/forest|jungle|garden|woods/, { background: '#11281a', solid: '#2f5d3a' }],
  [/snow|ice|winter|arctic|frozen/, { background: '#1c2b3a', solid: '#9fc4d9' }],
  [/lava|volcano|hell|fire|desert/, { background: '#2b1208', solid: '#7a3b1d' }],
  [/candy|sweet|dessert|cake/, { background: '#2e1631', solid: '#c45a9b' }],
  [/city|street|neon|cyber/, { background: '#120f1f', solid: '#4a4470' }],
];
const UNSUPPORTED = [
  [/multiplayer|co-?op|versus|pvp|online/, 'multiplayer', 'needs more than one human player'],
  [/boss/, 'boss fight', 'needs a boss with attack phases'],
  [/dialog|talk|npc|quest|story/, 'dialogue and quests', 'needs talking characters and quest state'],
  [/inventory|craft|shop|buy|upgrade/, 'inventory and upgrades', 'needs items, crafting or a shop'],
  [/race|racing|car|kart|drive/, 'driving', 'needs vehicle physics and a track'],
  [/puzzle|push (the )?block|sokoban|switch/, 'puzzle objects', 'needs pushable blocks or switches'],
  [/card|deck|turn-?based|chess/, 'turn-based rules', 'needs turn order instead of real-time play'],
  [/swim|water physics/, 'swimming', 'needs buoyancy physics'],
];

const words = text => text.toLowerCase().match(/[a-z]+/g) || [];
const singular = w => w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;
const titleCase = s => s.replace(/\b[a-z]/g, c => c.toUpperCase());

export function pickExample(prompt, examples) {
  const text = prompt.toLowerCase();
  const topdown = /top[- ]?down|overhead|maze|dungeon|zelda|bird'?s[- ]eye|arena|garden|twin[- ]stick/.test(text);
  const shooting = /shoot|blast|laser|gun|zap|fire at|projectile|bullet/.test(text);
  const score = e => {
    const uses = new Set(e.modules.map(m => m.use));
    let s = 0;
    if (topdown === uses.has('topdown')) s += 4;
    if (shooting === uses.has('shooter')) s += 3;
    const hay = `${e.title} ${e.pitch} ${e.modules.map(m => m.use).join(' ')}`.toLowerCase();
    for (const w of words(text)) if (w.length > 3 && hay.includes(singular(w))) s += 1;
    return s;
  };
  return [...examples].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))[0];
}

export function planOffline(prompt, examples, registry) {
  const text = prompt.toLowerCase();
  const base = structuredClone(pickExample(prompt, examples));
  const tokens = words(text).map(singular);
  const nouns = tokens.filter(w => GLYPHS.some(([n]) => n === w));
  const glyph = n => GLYPHS.find(([k]) => k === n)?.[1];
  const roles = { player: nouns.find(n => !PICKUP.has(n) && !HAZARD.has(n)), pickup: nouns.find(n => PICKUP.has(n)), hazard: nouns.find(n => HAZARD.has(n)) };
  const enemy = nouns.filter(n => !PICKUP.has(n) && !HAZARD.has(n))[1];
  const kindWith = tag => Object.entries(base.entities).find(([, d]) => (d.tags || []).includes(tag))?.[1];
  if (roles.player) kindWith('player').glyph = glyph(roles.player);
  if (roles.pickup && kindWith('collectible')) kindWith('collectible').glyph = glyph(roles.pickup);
  if (roles.hazard && kindWith('hazard')) kindWith('hazard').glyph = glyph(roles.hazard);
  if (enemy && kindWith('enemy')) kindWith('enemy').glyph = glyph(enemy);
  const theme = THEMES.find(([re]) => re.test(text))?.[1];
  if (theme) {
    base.background = theme.background;
    for (const d of Object.values(base.entities)) if (d.solid) d.color = theme.solid;
  }
  const titleWords = words(prompt).filter(w => !STOP.has(w)).slice(0, 4);
  base.title = titleWords.length ? titleCase(titleWords.join(' ')) : base.title;
  base.id = (titleWords.join('-') || base.id).slice(0, 60);
  base.pitch = prompt.trim().slice(0, 160);
  // Adjectives and feature words become tweaks so offline and online tweaks agree.
  const { spec } = tweakSpec(base, prompt, registry);
  const gaps = UNSUPPORTED.filter(([re]) => re.test(text)).map(([, capability, why]) => ({ capability, why }));
  return { spec, gaps, summary: `Offline draft based on “${pickExample(prompt, examples).title}”, reskinned and tuned for your idea.`, base: pickExample(prompt, examples).id };
}
