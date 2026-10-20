// Character-rig looks (v2/art/characters.js) derived from content text, deterministically:
// creatures from their species look, dex text, types and evolution stage; people from their
// look description ("a kid with a green cap and a satchel"). Pure: runs in Node and the browser.
import { normalizeLook } from '../../../art/characters.js';
import { hex, light, shade, mix, hueShift, saturate } from '../../../art/color.js';
import { seedFrom } from '../../../kernel/rng.js';
import { lookup } from '../rules/stats.js';

const has = (text, re) => re.test(text);
const hashPick = (key, list) => list[seedFrom(key) % list.length];

const COLOR_WORDS = {
  red: '#d8403a', crimson: '#b8202a', scarlet: '#d8302a', orange: '#ec8a2a', amber: '#e8a030', yellow: '#f0c83a', gold: '#e8b830', golden: '#e8b830',
  green: '#3fa84a', lime: '#8ad040', olive: '#7a8a3a', teal: '#2a9a9a', cyan: '#3ac0d8', blue: '#3a6ad8', navy: '#2a3a7a', azure: '#3a8ae8',
  purple: '#8a4ac8', violet: '#8a5ad8', lilac: '#b89ae8', pink: '#f07aa8', magenta: '#d040a0', white: '#f4f4f0', silver: '#c0c8d0', gray: '#8a9098', grey: '#8a9098',
  black: '#2a2a32', brown: '#8a5a32', tan: '#c8a070', beige: '#e0c8a0', cream: '#f0e4c4',
};
const SKIN = ['#f5d0a8', '#e8b88a', '#c8905a', '#9a6a40', '#f0c8a0'];
const HAIR = ['#3a2a20', '#6a4020', '#c8a050', '#2a2a32', '#a04020', '#d8d0c0'];
const CLOTHES = ['#3a6ad8', '#d8403a', '#3fa84a', '#8a4ac8', '#ec8a2a', '#2a9a9a', '#f07aa8', '#5a6070'];

/** The color named right before a noun matching `re` in text, e.g. "green cap" → green. */
function colorBefore(text, re) {
  const m = text.match(new RegExp(`\\b(${Object.keys(COLOR_WORDS).join('|')})[- ](?:[a-z-]+ )?(?:${re})`));
  return m ? COLOR_WORDS[m[1]] : null;
}

/** A biped look for a person from their description. */
export function personLook(desc = '', key = desc, { role } = {}) {
  const t = String(desc).toLowerCase();
  const hair = colorBefore(t, 'hair|braids|ponytail') || hashPick(`${key}:hair`, HAIR);
  const hat = colorBefore(t, 'cap|hat|sunhat|helmet|hood|bandana|beret');
  const top = colorBefore(t, 'coat|jacket|shirt|uniform|apron|dress|cloak|robe|vest|hoodie|sweater|suit|tunic') || (has(t, /lab coat/) ? '#f4f4f0' : null)
    || (has(t, /nurse/) ? '#f4a0c0' : null) || hashPick(`${key}:top`, CLOTHES);
  const skin = hashPick(`${key}:skin`, SKIN);
  const look = {
    body: 'biped', build: has(t, /\b(kid|boy|girl|youngster|child|lass)\b/) ? 'chibi' : has(t, /broad|bearded|hiker|big|burly/) ? 'stocky' : has(t, /tall|lean|sleek/) ? 'tall' : 'normal',
    colors: { primary: top, secondary: skin, accent: hat || shade(top, 0.35), eye: hashPick(`${key}:eye`, ['#3a2a20', '#2a5ad8', '#2a8a4a', '#6a3a20']), detail: hair },
    headwear: has(t, /helmet|headlamp/) ? 'helmet' : has(t, /crown/) ? 'crown' : has(t, /hood/) ? 'hood' : has(t, /bandana/) ? 'bandana' : has(t, /goggle/) ? 'goggles' : has(t, /wizard/) ? 'wizard-hat' : has(t, /\b(cap|hat|sunhat|beret)\b/) ? 'cap' : 'none',
    top: has(t, /spiky|spikes/) ? 'spikes' : has(t, /long hair|braid|ponytail|leaves in her hair|woman|girl|lass|nurse/) ? 'long-hair' : has(t, /mohawk/) ? 'mohawk' : 'tuft',
    snout: 'none', eyes: has(t, /smolder|stern|fierce|angry/) ? 'angry' : has(t, /sleepy|old|calm/) ? 'sleepy' : 'cartoon',
    tail: 'none', feet: has(t, /boot|hiker|miner/) ? 'boots' : 'shoes', hands: 'none',
    accessory: has(t, /cloak|cape|coat/) ? 'cape' : has(t, /satchel|pack|backpack/) ? 'backpack' : has(t, /scarf/) ? 'scarf' : has(t, /belt|uniform/) ? 'belt' : has(t, /stripe/) ? 'stripes' : 'none',
    held: has(t, /fishing rod|cane|staff/) ? 'staff' : has(t, /sword/) ? 'sword' : has(t, /shield/) ? 'shield' : 'none',
  };
  // The hair color rides on the head "top" parts, which the rig paints with the accent color.
  if (look.headwear === 'none') look.colors.accent = hair;
  if (role === 'nurse') { look.colors.primary = '#f4a0c0'; look.headwear = 'cap'; look.colors.accent = '#ffffff'; }
  return normalizeLook(look);
}

/** Evolution stage of a species: 0 base, 1 middle, 2 final (by how many species evolve into it). */
export function stageOf(content, speciesId) {
  const { species } = lookup(content);
  let n = 0, cur = speciesId;
  for (let guard = 0; guard < 4; guard++) {
    const parent = content.species.find(s => s.evolves?.to === cur);
    if (!parent) break;
    n++; cur = parent.id;
  }
  void species;
  return n;
}

const typeColor = (content, id) => hex(content.types.find(t => t.id === id)?.color, '#a8a878');

/** A rig look for a species: body plan, colors and parts from its look text, types and stage. */
export function creatureLook(content, speciesId) {
  const sp = lookup(content).species.get(speciesId);
  const t = `${sp.look || ''} ${sp.dex || ''} ${sp.name}`.toLowerCase();
  const [t1, t2] = sp.types;
  const stage = stageOf(content, speciesId);
  const typeText = sp.types.map(x => `${x} ${content.types.find(y => y.id === x)?.look || ''}`).join(' ').toLowerCase();
  const all = `${t} ${typeText}`;
  const body = has(t, /ghost|spirit|phantom|wisp|specter/) ? 'ghost'
    : has(t, /robot|machine|mech|gear|clockwork/) ? 'robot'
    : has(t, /bird|sparrow|hawk|eagle|owl|crow|wing|feather|bat|moth|butterfly/) ? 'flyer'
    : has(t, /slime|blob|jelly|cotton|puff|pebble|boulder|seedling|round|orb|ball/) ? 'blob'
    : has(t, /turtle|tortoise|pup|hound|dog|fox|wolf|cat|lion|tiger|horse|deer|lizard|beetle|bug|boar|quadruped|lamb|goat|shrub-backed/) ? 'quadruped'
    : has(t, /mouse|rabbit|monkey|ape|bear|giant|golem|humanoid|knight|upright|arms/) ? 'biped'
    : hashPick(speciesId, ['blob', 'quadruped', 'biped']);
  // Colors: the main type tints the body, nudged per species so relatives differ; a second type accents.
  const base = typeColor(content, t1);
  const named = Object.entries(COLOR_WORDS).find(([w]) => new RegExp(`\\b${w}\\b`).test(t));
  const primary = named && stage < 2 ? mix(named[1], base, 0.35) : hueShift(saturate(base, 0.05), (seedFrom(speciesId) % 21) - 10 - stage * 6);
  const secondary = t2 ? light(typeColor(content, t2), 0.25) : light(primary, 0.45);
  const accent = t2 ? typeColor(content, t2) : shade(primary, 0.35);
  const look = {
    body,
    build: stage === 0 ? 'chibi' : has(all, /stone|rock|boulder|giant|broad|sturdy/) ? 'stocky' : stage >= 2 || has(t, /sleek|lean|tall/) ? 'tall' : 'normal',
    colors: { primary, secondary, accent, eye: stage >= 1 && has(all, /fire|flame|ember|stone|fierce/) ? '#d83a2a' : '#1a1a24', detail: '#ffffff' },
    ears: has(t, /leaf ears|leaf-ears/) ? 'pointed' : has(t, /long ears|rabbit/) ? 'long' : has(t, /mouse|bear|round ears/) ? 'round' : has(t, /fox|pup|hound|cat|wolf|pointed ears/) ? 'pointed' : has(t, /fin|fish/) ? 'fins' : has(t, /floppy/) ? 'floppy' : 'none',
    top: has(t, /leaf|sprout|seed|bud|vine/) ? 'leaf' : has(t, /quill/) ? 'quills' : has(t, /spike|thorn|spiky/) ? 'spikes' : has(t, /crest|tuft/) ? 'tuft' : has(t, /antenna|whisker|beetle|bug/) ? 'antenna' : has(t, /mane|mohawk/) ? 'mohawk' : 'none',
    headwear: has(t, /horn/) ? 'horns' : has(t, /crown|regal/) ? 'crown' : has(t, /helmet|armor|shell-head/) ? 'helmet' : 'none',
    snout: body === 'flyer' || has(t, /beak/) ? 'beak' : has(t, /fox|pup|hound|dog|wolf|turtle|muzzle|boar|horse/) ? 'muzzle' : has(t, /mouse|rabbit|nose/) ? 'nose' : 'none',
    eyes: has(t, /sleep|nap|drowsy/) ? 'sleepy' : stage >= 2 && !has(t, /cute|gentle|fluffy/) ? 'angry' : body === 'ghost' ? 'dots' : 'cartoon',
    tail: has(t, /flame tail|flickering flame|fire tail/) || (has(all, /flame|fire|ember/) && body === 'quadruped') ? 'flame'
      : has(t, /fish|fin|tadpole/) ? 'fish' : has(t, /stinger|spiky tail|thorn/) ? 'spiky' : has(t, /mouse|rat|thin tail|lizard/) ? 'thin' : has(t, /fox|squirrel|fluffy|rabbit|cotton|hound|dog|wolf|tail/) ? 'fluffy' : 'none',
    feet: body === 'biped' ? 'paws' : 'paws', hands: has(t, /claw|crab|pincer/) ? 'claws' : 'paws',
    accessory: has(t, /shell|carapace/) ? 'backpack' : has(t, /stripe/) ? 'stripes' : has(t, /spot|moss|dapple|pebbles/) ? 'spots' : has(t, /scarf|mane/) ? 'scarf' : 'none',
    held: 'none',
  };
  return normalizeLook(look);
}
