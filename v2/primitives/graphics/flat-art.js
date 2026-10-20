// Generated art for entities with no art data: the shared procedural painters
// in v2/art (six character body plans, props, scenery) rasterized for canvas.
// Archetype kind, id, name and tags pick a role, body plan, parts and colors,
// so a document with zero art still shows a cast that reads at a glance.
// SVGs are rasterized through Blob URLs (the CSP allows blob: images) and
// cached per look and pose; until an image decodes, callers draw a placeholder.
import { paintCharacter, POSE_NAMES } from '../../art/characters.js';
import { paintProp, PROPS } from '../../art/props.js';
import { paintScenery, THEMES } from '../../art/scenery.js';
import { rng, seedOf, words, hash, surface, ctx2d } from './flat-util.js';

const images = new Map();
const canRaster = () => typeof Image !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL;

/** A decoded image for an SVG (made on first request) or null while it loads / in Node. */
export function svgImage(key, make) {
  let e = images.get(key);
  if (!e) {
    e = { img: null, ready: false, box: null };
    images.set(key, e);
    if (canRaster()) {
      try {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => { e.ready = true; e.box = opaqueBox(img); };
        img.onerror = () => { e.failed = true; };
        img.src = URL.createObjectURL(new Blob([make()], { type: 'image/svg+xml' }));
        e.img = img;
      } catch { e.failed = true; }
    }
  }
  return e.ready ? e : null;
}
/** Opaque bounding box of an image as fractions [x0,y0,x1,y1]. */
function opaqueBox(img) {
  const N = 64, c = surface(N, N), g = ctx2d(c);
  if (!g?.getImageData) return [0, 0, 1, 1];
  try {
    g.drawImage(img, 0, 0, N, N);
    const a = g.getImageData(0, 0, N, N).data;
    let x0 = N, y0 = N, x1 = -1, y1 = -1;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (a[(y * N + x) * 4 + 3] > 24) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return x1 >= x0 ? [x0 / N, y0 / N, (x1 + 1) / N, (y1 + 1) / N] : [0, 0, 1, 1];
  } catch { return [0, 0, 1, 1]; }
}

// ---------- roles ----------
const ROLE_WORDS = [
  ['player', /^(player|hero|avatar)$/], ['boss', /^(boss|miniboss)$/], ['enemy', /^(enemy|hostile|monster|foe|mob)$/],
  ['npc', /^(npc|villager|merchant|friend|ally|citizen|pedestrian|character)$/], ['pickup', /^(pickup|item|collectible|coin|gem|loot|powerup|power-up|token)$/],
  ['hazard', /^(hazard|trap|spike|spikes|lava|saw)$/], ['goal', /^(goal|exit|door|portal|flag|finish)$/], ['projectile', /^(projectile|bullet|shot|missile|arrow|bolt|fireball)$/],
  ['vehicle', /^(vehicle|car|truck|boat|ship|plane|cart|bike)$/], ['mount', /^(mount|horse|steed)$/], ['prop', /^(prop|object|decor|furniture|sign|bench|crate|barrel)$/],
];
/** The cast role of an archetype from its kind, tags, id and components. */
export function roleOf(arch = {}, id = arch.id) {
  if (id === 'player') return 'player';
  const comps = arch.components || {};
  const cands = [arch.kind, ...(arch.tags || []), ...words(arch.id), ...words(arch.name)].filter(Boolean).map(String);
  for (const [role, re] of ROLE_WORDS) if (cands.some(w => re.test(w.toLowerCase()))) return role;
  if (comps.projectile || comps.bullet) return 'projectile';
  if (comps.item || comps.collectible || comps.pickup) return 'pickup';
  if (comps.ai && (comps.touch || comps.attacks || comps.melee)) return 'enemy';
  if (comps.interact) return 'npc';
  if (comps.health) return 'enemy';
  return 'prop';
}

// ---------- character looks ----------
const PLAN_WORDS = [
  ['ghost', /ghost|wraith|wisp|spirit|shade|phantom|specter|spectre|soul|gloam|banshee|haunt/],
  ['flyer', /bat|bird|moth|fly|wasp|bee|owl|crow|raven|hawk|eagle|dragonfly|pixie|fairy|parrot|duck|gull/],
  ['blob', /slime|blob|ooze|jelly|goo|spore|bloom|frog|toad|mushroom|leech|crab|mossling|puff|bubble|snail|worm|grub/],
  ['robot', /robot|automaton|drone|mech|bot|android|turret|machine|sentry|cyborg/],
  ['quadruped', /wolf|dog|hound|horse|cat|deer|boar|beast|bear|rat|mouse|lion|tiger|crawler|lizard|dragon|fox|pony|goat|sheep|cow|pig|stag|panther|hyena|stalker/],
];
const HEAD_WORDS = [['crown', /king|queen|regent|sovereign|prince|princess|royal|emperor/], ['helmet', /knight|soldier|guard|warden|paladin|trooper|automaton/], ['wizard-hat', /wizard|mage|witch|sorcer|cantor|warlock|seer/], ['bandana', /ninja|rogue|thief|bandit|pirate|assassin/], ['horns', /imp|demon|devil|horn|minotaur|fiend|beast/], ['hood', /hood|monk|veil|cultist|reaper|hermit|keeper/], ['cap', /plumber|miner|worker|scout|kid|boy/]];
const HELD_WORDS = [['sword', /knight|warrior|sword|blade|paladin|samurai|ninja|hunter|stalker/], ['hammer', /hammer|smith|forge|anvil|ogre|brute/], ['staff', /mage|wizard|witch|staff|sage|priest|cantor|shaman/], ['blaster', /gunner|soldier|trooper|sniper|robot|space/], ['shield', /guard|shield|defender|warden/]];
const FRIENDLY = ['#3a7bd5', '#e8742a', '#2ea84a', '#d8352a', '#9b5cff', '#f0b429', '#1fb5a8', '#ff6fa0'];
const MENACE = ['#6a2a8a', '#3a3a4a', '#8a2a2a', '#2a5a3a', '#5a3a2a', '#2a3a6a', '#7a1a3a', '#4a4a1a'];
const SKIN = ['#f2d2a9', '#e8b48c', '#c8906a', '#8a5a3c', '#f5dcc4', '#d8a878'];

/** A normalizeLook()-compatible character look for an archetype, from words and a seed. */
export function lookFor(arch = {}, role = roleOf(arch), colors = null) {
  const text = [arch.id, arch.name, arch.kind, ...(arch.tags || [])].join(' ').toLowerCase();
  const r = rng(seedOf(arch.id || text)), pick = a => a[Math.floor(r() * a.length)];
  const body = (PLAN_WORDS.find(([, re]) => re.test(text)) || ['biped'])[0];
  const hostile = role === 'enemy' || role === 'boss';
  const primary = colors?.primary || pick(hostile ? MENACE : FRIENDLY);
  const look = {
    body, build: role === 'boss' ? 'stocky' : pick(['chibi', 'chibi', 'normal', 'stocky']),
    colors: { primary, secondary: colors?.secondary || (body === 'biped' ? pick(SKIN) : '#f0e8d8'), accent: colors?.accent || pick(hostile ? ['#ff3b3b', '#f0c020', '#9cff3a'] : ['#f5c542', '#ffffff', '#3ad0e8', '#ff5a7a']), eye: colors?.eye || (hostile ? '#ff3b3b' : pick(['#1f8a4c', '#2a5ad8', '#3a2a10'])), hair: colors?.hair || pick(['#3a2418', '#1a1418', '#e8c040', '#c84a2a']) },
    eyes: hostile ? pick(['angry', 'angry', 'visor', 'cyclops']) : pick(['cartoon', 'cartoon', 'dots']),
    headwear: (HEAD_WORDS.find(([, re]) => re.test(text)) || ['none'])[0], held: (HELD_WORDS.find(([, re]) => re.test(text)) || ['none'])[0],
    ears: body === 'quadruped' ? pick(['pointed', 'round', 'floppy']) : r() < 0.25 ? pick(['pointed', 'round']) : 'none',
    snout: body === 'quadruped' ? 'muzzle' : body === 'flyer' ? 'beak' : r() < 0.3 ? pick(['nose', 'muzzle']) : 'none',
    tail: body === 'quadruped' ? pick(['fluffy', 'thin', 'spiky']) : 'none',
    top: body === 'biped' && r() < 0.5 ? pick(['tuft', 'spikes', 'long-hair', 'mohawk']) : 'none',
    accessory: role === 'boss' ? 'cape' : r() < 0.2 ? pick(['scarf', 'belt', 'backpack']) : 'none',
    feet: body === 'quadruped' ? 'paws' : pick(['shoes', 'boots']), hands: hostile && r() < 0.4 ? 'claws' : 'gloves',
  };
  if (/thorn|spike|bramble/.test(text)) look.accessory = 'spots';
  return look;
}
const PROP_WORDS = {
  pickup: { coin: /coin|gold|money|cash|ash|ember|shard/, gem: /gem|jewel|diamond|ruby|emerald|sapphire/, key: /key/, heart: /heart|health|life|heal|potion|flask|sip/, star: /star/, ring: /ring/, fruit: /fruit|apple|cherry|berry|food/, orb: /orb|soul|essence|spirit/, mushroom: /mushroom|shroom/, crystal: /crystal|ore|mana/, feather: /feather/, battery: /battery|energy|power|fuel/, flower: /flower|petal|seed/, scroll: /scroll|map|fragment|page|tablet|note|letter|lore/, candy: /candy|sweet/, acorn: /acorn|nut/, shell: /shell/, note: /music|song/ },
  hazard: { spikes: /spike/, lava: /lava|magma|slag/, saw: /saw|blade/, fire: /fire|flame|burn/, thorns: /thorn|bramble/, electric: /electric|shock|zap|volt/, 'ice-spikes': /ice|frost/, cactus: /cactus/, acid: /acid|poison|toxic/, mine: /mine|bomb/ },
  decor: { bench: /bench|seat|pew/, crate: /crate|box|cargo/, barrel: /barrel|keg|cask/, signpost: /sign|post|notice/, lantern: /lantern|lamp|torch|light/, tablet: /tablet|tomb|grave|stele|monument|lore/, well: /well|fountain/, pot: /pot|vase|urn|jar/, statue: /statue|idol|bust/, campfire: /campfire|fire|bonfire|hearth/, bush: /bush|shrub|plant|hedge/, rock: /rock|boulder|stone/ },
  goal: { flag: /flag|finish|checkpoint/, door: /door|gate|exit/, portal: /portal|warp|teleport/, chest: /chest|treasure|loot/, trophy: /trophy|cup|prize/, castle: /castle/, beacon: /beacon|lantern|lamp|light|bench|shrine|altar/, 'exit-sign': /sign/, nest: /nest|egg/ },
};
/** A prop kind (v2/art/props) for an archetype of a prop-like role. */
export function propFor(arch = {}, role = roleOf(arch)) {
  const text = [arch.id, arch.name, arch.kind, ...(arch.tags || [])].join(' ').toLowerCase();
  const table = PROP_WORDS[role] || (role === 'prop' ? { ...PROP_WORDS.decor, ...PROP_WORDS.goal, ...PROP_WORDS.pickup } : PROP_WORDS.pickup);
  const hit = Object.entries(table).find(([, re]) => re.test(text));
  if (hit) return hit[0];
  const list = PROPS[role === 'prop' ? 'decor' : role] || PROPS.pickup;
  return list[Math.floor(hash(seedOf(arch.id || 'x')) * list.length)];
}

// ---------- images ----------
const lookKey = look => JSON.stringify(look);
/** Image entry for a character pose (null until decoded). */
export function characterImage(look, pose, pixel = false) {
  const p = POSE_NAMES.includes(pose) ? pose : 'idle';
  return svgImage(`c|${lookKey(look)}|${p}|${pixel}`, () => paintCharacter(look, p, { pixel }));
}
export function propImage(kind, color, pixel = false) { return svgImage(`p|${kind}|${color || ''}|${pixel}`, () => paintProp(kind, { color, pixel })); }
export function sceneryImage(opts, pixel = false, seed = 'scenery') { return svgImage(`s|${JSON.stringify(opts)}|${pixel}|${seed}`, () => paintScenery(opts, { pixel, seed })); }

/** Pose name for a presentation state over time (art characters have 9 poses). */
export function poseFor(state, t, speed = 1) {
  switch (state) {
    case 'run': case 'walk': case 'dash': return ['runA', 'runB', 'runC', 'runD'][Math.floor(t * (state === 'walk' ? 7 : 10) * Math.max(0.6, Math.min(1.8, speed))) % 4];
    case 'jump': return 'jump';
    case 'fall': return 'fall';
    case 'hurt': case 'die': return 'hurt';
    case 'attack': return 'runA';
    default: return Math.floor(t * 1.6) % 2 ? 'idleB' : 'idle';
  }
}
/** Best-guess scenery theme for a document (title, logline, zone tags). */
export function themeFor(doc, zone = null) {
  const text = `${doc.title || ''} ${doc.logline || ''} ${zone?.name || ''} ${(zone?.tags || []).join(' ')}`.toLowerCase();
  const direct = THEMES.find(t => new RegExp(`\\b${t}\\b`).test(text));
  if (direct) return direct;
  const map = [['cave', /cave|mine|dungeon|underground|crypt|cistern|catacomb|lantern|hollow/], ['snow', /snow|ice|frost|winter|frozen/], ['volcano', /lava|fire|ember|volcan|forge|ash/], ['space', /space|star|galax|alien|orbit|asteroid/], ['city', /city|street|urban|neon|cyber/], ['haunted', /ghost|haunt|spook|manor|grave|night/], ['desert', /desert|sand|dune/], ['ocean', /ocean|sea|beach|island|water/], ['jungle', /jungle|tropic/], ['forest', /forest|wood|grove/], ['factory', /factory|robot|machine|steam/], ['castle', /castle|kingdom|knight/], ['candy', /candy|sweet/], ['sky', /sky|cloud|air/]];
  return (map.find(([, re]) => re.test(text)) || ['meadow'])[0];
}
