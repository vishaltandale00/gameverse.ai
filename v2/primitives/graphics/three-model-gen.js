// Generated model specs for anything that has no content.models entry: an
// archetype (by kind, id, name and tags), an item (by name: sword, lantern) or
// a placed object (by kind: tree, rock, lamp). Output is an ordinary lowpoly
// spec (catalog §5.2), so it is built, rigged and animated like authored ones,
// and can be voxelized for voxel worlds. Deterministic from the name.
import { hash01 } from './three-util.js';

const hsl = (h, s, l) => {
  h = ((h % 360) + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return '#' + [f(h + 1 / 3), f(h), f(h - 1 / 3)].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
};
const SKINS = ['#f1c9a5', '#e0ac85', '#c68a62', '#a86b45', '#7d4a2c', '#5a3420'];
const HAIRS = ['#1e1612', '#3a2618', '#6a4424', '#a87838', '#d8b868', '#8a8a90', '#e8e4dc', '#7a2a1a'];
const HAIR_STYLES = ['short', 'short-tied', 'bun', 'braid', 'long', 'ponytail', 'spiky', 'bald'];

const RULES = [
  // [plan, regex over "id name tags kind"]
  ['bird', /\b\w*(bird|crow|raven|hawk|eagle|owl|gull|bat|moth|parrot|pigeon|duck|chicken|hen|rooster|phoenix)\w*\b/],
  ['dragon', /\b\w*(dragon|wyvern|wyrm|drake)\w*\b/],
  ['serpent', /\b\w*(serpent|snake|worm|eel|leech|naga|viper|slug)\w*\b/],
  ['arthropod', /\b\w*(spider|crab|skitter|beetle|insect|ant|scorp|tick|crawler|mantis|centipede)\w*\b/],
  ['blob', /\b\w*(slime|blob|ooze|jelly|gloomer|boomling|bloom|spore|puff|mushroom|fungus)\w*\b/],
  ['ghost', /\b\w*(ghost|wisp|wraith|shade|spirit|specter|spectre|phantom|wight|soul)\w*\b/],
  ['golem', /\b\w*(golem|titan|automaton|robot|construct|colossus|mech|sentinel|warden|giant)\w*\b/],
  ['fish', /\b\w*(fish|shark|whale|dolphin|carp|trout|salmon)\w*\b/],
  ['quadruped', /\b\w*(horse|pony|mare|stallion|deer|stag|elk|moose|boar|pig|hog|wolf|dog|hound|fox|cat|lion|tiger|bear|cow|bull|ox|sheep|goat|ram|mule|donkey|camel|rat|mouse|rabbit|hare|lizard|croc|beast)\w*\b/],
];
const VEHICLES = [
  ['plane', /plane|jet|aircraft|biplane|glider|airship/], ['heli', /heli|copter|chopper/], ['boat', /boat|ship|yacht|raft|canoe|ferry|barge|sub/],
  ['bike', /bike|motorbike|motorcycle|scooter|bicycle/], ['cart', /cart|minecart|wagon|carriage|train|tram/],
  ['truck', /truck|van|bus|lorry|armored|armoured|tank|delivery/], ['car', /./],
];
const PROPS = [
  ['campfire', /campfire|fire|brazier|bonfire|hearth/], ['lamp', /lamp|lantern|torch|light|candle|beacon/], ['chest', /chest|coffer|loot|cache|trunk/],
  ['crate', /crate|box|package|cargo|supply/], ['barrel', /barrel|keg|cask|drum/], ['bed', /bed|cot|bunk/],
  ['table', /table|desk|bench|workbench|counter|altar|alchemy/], ['anvil', /anvil|forge|furnace|kiln|oven|smelter/],
  ['door', /door|gate|portal|vault/], ['tree', /tree|oak|pine|palm|birch|willow/], ['bush', /bush|shrub|hedge|plant|forage|herb|flower/],
  ['rock', /rock|stone|boulder|ore|crystal/], ['sign', /sign|tablet|ledger|book|note|board|scroll|map/], ['statue', /statue|shrine|idol|totem|monument|seal/],
  ['machine', /vending|machine|terminal|console|computer|generator|engine/], ['barricade', /barricade|fence|wall|barrier/],
  ['crown', /crown|relic|artifact|trophy|chalice|orb/],
];
const ITEMS = [
  ['sword', /sword|blade|sabre|saber|katana|dagger|knife|machete/], ['axe', /axe|hatchet/], ['pick', /pick/], ['hammer', /hammer|mace|maul|club/],
  ['spear', /spear|lance|pike|halberd|trident|staff|wand|rod/], ['bow', /bow/], ['shield', /shield|buckler/], ['gun', /gun|pistol|rifle|blaster|shotgun/],
  ['torch', /torch|lantern|lamp/], ['backpack', /backpack|pack|bag|satchel/], ['potion', /potion|flask|bottle|vial|elixir/], ['tool', /./],
];

// Never the name: the content forms theme names, and a themed name must not change artwork (ARCHITECTURE §1.2).
const words = a => `${a.id || ''} ${(a.tags || []).join(' ')} ${a.kind || ''}`.toLowerCase().replace(/_/g, ' ');

/** Choose a body plan for an archetype. */
export function bodyPlan(archetype) {
  const w = words(archetype), kind = archetype.kind || '';
  if (kind === 'vehicle' || archetype.components?.vehicle) return 'vehicle';
  if (kind === 'prop') return 'prop';
  if (kind === 'pickup' || kind === 'item') return 'pickup';
  if (kind === 'projectile') return 'projectile';
  for (const [plan, re] of RULES) if (re.test(w)) return plan;
  if (kind === 'mount') return 'quadruped';
  if (kind === 'creature') return 'quadruped';
  return 'humanoid';
}

function palette(name, plan, kind) {
  const r = i => hash01(name, i);
  const hostile = /enemy|boss/.test(kind);
  const hue = hostile ? (r(1) < 0.5 ? 350 + r(2) * 30 : 260 + r(2) * 60) : r(1) * 360;
  return {
    skin: SKINS[Math.floor(r(3) * SKINS.length)], hair: HAIRS[Math.floor(r(4) * HAIRS.length)],
    cloth: hsl(hue, 0.35 + r(5) * 0.3, 0.28 + r(6) * 0.22), trim: hsl(hue + 150 + r(7) * 60, 0.45, 0.55),
    boots: hsl(25 + r(8) * 20, 0.3, 0.16 + r(9) * 0.1), pants: hsl(hue + 30 * (r(10) - 0.5), 0.2, 0.2 + r(11) * 0.12),
    coat: plan === 'quadruped' ? hsl(20 + r(12) * 30, 0.25 + r(13) * 0.3, 0.2 + r(14) * 0.35) : hsl(hue, 0.4, 0.35 + r(12) * 0.2),
    mane: hsl(20 + r(15) * 20, 0.2, 0.12 + r(16) * 0.2), hooves: '#262220', belly: hsl(30, 0.2, 0.6),
    body: hsl(hue, 0.5, 0.42 + r(17) * 0.15), accent: hsl(hue + 180, 0.6, 0.55), glow: hostile ? hsl(10 + r(18) * 40, 1, 0.6) : hsl(180 + r(18) * 60, 0.9, 0.65),
    metal: hsl(210, 0.08, 0.55 + r(19) * 0.15), wood: hsl(28, 0.45, 0.28 + r(20) * 0.12), stone: hsl(40, 0.06, 0.45 + r(21) * 0.15),
  };
}

/** A complete lowpoly spec for an archetype with no model of its own. */
export function synthesizeSpec(archetype) {
  const name = archetype.id || 'thing', kind = archetype.kind || 'npc';
  const plan = bodyPlan(archetype), pal = palette(name, plan, kind), w = words(archetype), r = i => hash01(name, 40 + i);
  const big = kind === 'boss' ? 1.6 + r(1) * 0.8 : 1;
  const P = (shape, at, size, c, extra = {}) => ({ shape, at, size, c, ...extra });
  switch (plan) {
    case 'humanoid': return { kind: 'lowpoly', rig: 'humanoid', height: (1.6 + r(2) * 0.25) * big, build: { width: 0.85 + r(3) * 0.4, shoulders: 0.9 + r(4) * 0.3, head: 1 }, palette: pal, hair: kind === 'enemy' && r(5) < 0.4 ? 'helmet' : HAIR_STYLES[Math.floor(r(5) * HAIR_STYLES.length)], parts: [], generated: plan };
    case 'golem': return { kind: 'lowpoly', rig: 'humanoid', height: 2.6 * big, build: { width: 1.6, shoulders: 1.5, head: 0.8 }, palette: { ...pal, skin: pal.stone, cloth: pal.stone, pants: pal.stone, boots: pal.metal, trim: pal.glow, hair: pal.stone }, hair: 'bald', material: /automaton|robot|mech|construct/.test(w) ? 'metal' : 'matte', eyes: 'glow', parts: [], generated: plan };
    case 'ghost': return { kind: 'lowpoly', rig: 'humanoid', height: 1.7 * big, build: { width: 0.9, shoulders: 0.9, head: 1 }, palette: { ...pal, skin: '#cfe0ea', cloth: '#9ab0c8', pants: '#9ab0c8', boots: '#9ab0c8' }, hair: 'hood', legs: 'robe', alpha: 0.65, eyes: 'glow', float: 0.35, parts: [], generated: plan };
    case 'quadruped': {
      const tall = /horse|pony|mare|stallion|deer|stag|elk|moose|camel|mule|donkey/.test(w), small = /rat|mouse|rabbit|hare|cat|fox|lizard/.test(w);
      const length = (small ? 0.6 : tall ? 2.2 : 1.4) * big, height = (small ? 0.35 : tall ? 1.55 : 0.95) * big;
      return { kind: 'lowpoly', rig: 'quadruped', length, height, palette: pal, parts: [], species: w, generated: plan };
    }
    case 'dragon': return { kind: 'lowpoly', rig: 'quadruped', length: 4 * big, height: 1.8 * big, palette: { ...pal, coat: pal.body, mane: pal.accent }, wings: true, horns: true, parts: [], species: w, generated: plan };
    case 'bird': {
      const s = (/chicken|hen|duck/.test(w) ? 0.45 : /crow|raven|bat|moth|pigeon/.test(w) ? 0.4 : 0.8) * big;
      return { kind: 'lowpoly', rig: 'custom', palette: pal, flier: true, parts: [
        P('sphere', [0, 0.5 * s, 0], [0.45 * s, 0.4 * s, 0.7 * s], 'body', { name: 'body' }),
        P('sphere', [0, 0.72 * s, 0.32 * s], [0.3 * s, 0.3 * s, 0.3 * s], 'body', { name: 'head' }),
        P('cone', [0, 0.7 * s, 0.52 * s], [0.08 * s, 0.18 * s, 0.08 * s], 'accent', { rot: [Math.PI / 2, 0, 0], name: 'beak' }),
        P('box', [0.42 * s, 0.55 * s, 0], [0.7 * s, 0.04 * s, 0.4 * s], 'body', { name: 'wingL' }),
        P('box', [-0.42 * s, 0.55 * s, 0], [0.7 * s, 0.04 * s, 0.4 * s], 'body', { name: 'wingR' }),
        P('box', [0, 0.5 * s, -0.42 * s], [0.25 * s, 0.03 * s, 0.3 * s], 'body', { name: 'tail' }),
        P('cyl', [0.08 * s, 0.15 * s, 0], [0.03 * s, 0.3 * s, 0.03 * s], 'hooves', { name: 'legL' }), P('cyl', [-0.08 * s, 0.15 * s, 0], [0.03 * s, 0.3 * s, 0.03 * s], 'hooves', { name: 'legR' }),
        P('sphere', [0.09 * s, 0.78 * s, 0.42 * s], [0.05 * s, 0.05 * s, 0.05 * s], 'glow', { mat: 'glow' }), P('sphere', [-0.09 * s, 0.78 * s, 0.42 * s], [0.05 * s, 0.05 * s, 0.05 * s], 'glow', { mat: 'glow' }),
      ], generated: plan };
    }
    case 'serpent': {
      const n = 7, seg = 0.5 * big, parts = [];
      for (let i = 0; i < n; i++) { const t = i / (n - 1), rad = (0.3 - 0.18 * t) * big; parts.push(P('sphere', [Math.sin(i * 0.9) * 0.25 * big, rad, 1.2 * big - i * seg], [rad * 2, rad * 1.6, seg * 1.4], i % 2 ? 'body' : 'accent', { name: i === 0 ? 'head' : `seg_${i}` })); }
      parts.push(P('sphere', [0.12 * big, 0.38 * big, 1.45 * big], [0.08 * big, 0.08 * big, 0.08 * big], 'glow', { mat: 'glow' }), P('sphere', [-0.12 * big, 0.38 * big, 1.45 * big], [0.08 * big, 0.08 * big, 0.08 * big], 'glow', { mat: 'glow' }));
      return { kind: 'lowpoly', rig: 'custom', palette: pal, slither: true, parts, generated: plan };
    }
    case 'arthropod': {
      const s = (/spider|scorp|crab/.test(w) ? 0.9 : 0.6) * big, parts = [
        P('sphere', [0, 0.45 * s, -0.25 * s], [0.7 * s, 0.5 * s, 0.8 * s], 'body', { name: 'abdomen' }),
        P('sphere', [0, 0.4 * s, 0.3 * s], [0.45 * s, 0.35 * s, 0.45 * s], 'cloth', { name: 'head' }),
      ];
      for (let i = 0; i < 3; i++) for (const x of [1, -1]) parts.push(P('box', [x * 0.5 * s, 0.25 * s, (0.3 - i * 0.3) * s], [0.6 * s, 0.06 * s, 0.06 * s], 'hooves', { rot: [0, 0, x * -0.5], name: `leg${x > 0 ? 'L' : 'R'}${i}` }));
      for (const x of [1, -1]) parts.push(P('sphere', [x * 0.1 * s, 0.5 * s, 0.5 * s], [0.07 * s, 0.07 * s, 0.07 * s], 'glow', { mat: 'glow' }));
      return { kind: 'lowpoly', rig: 'custom', palette: pal, scuttle: true, parts, generated: plan };
    }
    case 'blob': {
      const s = (0.6 + r(6) * 0.5) * big;
      return { kind: 'lowpoly', palette: pal, squash: true, alpha: /slime|jelly|ooze/.test(w) ? 0.8 : 1, parts: [
        P('sphere', [0, 0.42 * s, 0], [1 * s, 0.84 * s, 1 * s], 'body', { name: 'body' }),
        /bloom|mushroom|spore|fungus/.test(w) ? P('sphere', [0, 0.95 * s, 0], [1.3 * s, 0.5 * s, 1.3 * s], 'accent', { name: 'cap' }) : P('sphere', [0, 0.3 * s, 0], [0.85 * s, 0.4 * s, 0.85 * s], 'accent', { name: 'belly' }),
        P('sphere', [0.18 * s, 0.6 * s, 0.42 * s], [0.14 * s, 0.18 * s, 0.08 * s], 'glow', { mat: 'glow', name: 'eyeL' }), P('sphere', [-0.18 * s, 0.6 * s, 0.42 * s], [0.14 * s, 0.18 * s, 0.08 * s], 'glow', { mat: 'glow', name: 'eyeR' }),
      ], generated: plan };
    }
    case 'fish': return { kind: 'lowpoly', palette: pal, swim: true, parts: [P('sphere', [0, 0.3, 0], [0.3 * big, 0.4 * big, 1 * big], 'body'), P('box', [0, 0.3, -0.6 * big], [0.04, 0.4 * big, 0.3 * big], 'accent', { name: 'tail' })], generated: plan };
    case 'vehicle': return vehicleSpec(name, w, pal, r);
    case 'prop': return propSpec(name, w, pal, r);
    case 'pickup': return { kind: 'lowpoly', palette: pal, spin: true, bob: true, parts: [P('sphere', [0, 0.45, 0], [0.32, 0.42, 0.32], 'glow', { mat: 'glow' }), P('cyl', [0, 0.05, 0], [0.4, 0.04, 0.4], 'accent', { mat: 'glow', alpha: 0.4 })], generated: plan };
    case 'projectile': return { kind: 'lowpoly', palette: pal, parts: /arrow|bolt|dart/.test(w) ? [P('cyl', [0, 0, 0], [0.03, 0.7, 0.03], 'wood', { rot: [Math.PI / 2, 0, 0] }), P('cone', [0, 0, 0.38], [0.06, 0.1, 0.06], 'metal', { rot: [Math.PI / 2, 0, 0], mat: 'metal' })] : [P('sphere', [0, 0, 0], [0.25, 0.25, 0.25], 'glow', { mat: 'glow' })], generated: plan };
    default: return { kind: 'lowpoly', palette: pal, parts: [P('box', [0, 0.5, 0], [1, 1, 1], 'body')], generated: plan };
  }
}

function vehicleSpec(name, w, pal, r) {
  const type = VEHICLES.find(([, re]) => re.test(w))[0];
  const P = (shape, at, size, c, extra = {}) => ({ shape, at, size, c, ...extra });
  const paint = { ...pal, paint: /police/.test(w) ? '#1e2a48' : /taxi/.test(w) ? '#e8c020' : pal.body, glass: '#8ab8d0', tire: '#1a1a1c', light: '#fff4c0', tail: '#ff3030' };
  const wheels = (L, W, R, y = R) => ['FL', 'FR', 'BL', 'BR'].map(k => P('cyl', [(k[1] === 'L' ? 1 : -1) * W / 2, y, (k[0] === 'F' ? 1 : -1) * L * 0.32], [R * 2, 0.22, R * 2], 'tire', { rot: [0, 0, Math.PI / 2], name: `wheel${k}` }));
  switch (type) {
    case 'car': case 'truck': {
      const L = type === 'truck' ? 5.6 : 4.3, W = type === 'truck' ? 2.2 : 1.8, H = type === 'truck' ? 1.4 : 0.75, R = type === 'truck' ? 0.45 : 0.34;
      return { kind: 'lowpoly', palette: paint, vehicle: type, parts: [
        P('box', [0, R + H / 2, 0], [W, H, L], 'paint', { name: 'body', mat: 'metal' }),
        P('box', [0, R + H + 0.32, type === 'truck' ? L * 0.3 : -0.1], [W * 0.88, 0.62, type === 'truck' ? L * 0.32 : L * 0.5], 'glass', { name: 'cabin', alpha: 0.7, mat: 'metal' }),
        P('box', [0, R + H * 0.55, L / 2 + 0.01], [W * 0.8, 0.12, 0.04], 'light', { mat: 'glow', name: 'lights' }),
        P('box', [0, R + H * 0.55, -L / 2 - 0.01], [W * 0.8, 0.1, 0.04], 'tail', { mat: 'glow', name: 'taillights' }),
        ...(/police/.test(w) ? [P('box', [0.3, R + H + 0.68, -0.1], [0.4, 0.12, 0.25], 'tail', { mat: 'glow', name: 'siren' }), P('box', [-0.3, R + H + 0.68, -0.1], [0.4, 0.12, 0.25], 'glass', { mat: 'glow', name: 'siren' })] : []),
        ...wheels(L, W, R),
      ] };
    }
    case 'bike': return { kind: 'lowpoly', palette: paint, vehicle: type, parts: [P('box', [0, 0.7, 0], [0.3, 0.35, 1.3], 'paint', { mat: 'metal', name: 'body' }), P('cyl', [0, 0.33, 0.7], [0.66, 0.12, 0.66], 'tire', { rot: [0, 0, Math.PI / 2], name: 'wheelF' }), P('cyl', [0, 0.33, -0.7], [0.66, 0.12, 0.66], 'tire', { rot: [0, 0, Math.PI / 2], name: 'wheelB' }), P('box', [0, 1.05, 0.55], [0.7, 0.05, 0.05], 'metal', { mat: 'metal', name: 'bars' })] };
    case 'boat': return { kind: 'lowpoly', palette: paint, vehicle: type, parts: [P('box', [0, 0.4, 0], [2.2, 0.8, 6], 'paint', { taper: 0.75, name: 'hull' }), P('cone', [0, 0.4, 3.4], [2.2, 1.2, 0.8], 'paint', { rot: [Math.PI / 2, 0, 0], name: 'bow' }), P('box', [0, 1.1, -0.6], [1.6, 0.7, 1.8], 'glass', { alpha: 0.7, name: 'cabin' }), P('box', [0, 0.5, -3.05], [0.5, 0.6, 0.3], 'metal', { mat: 'metal', name: 'motor' })] };
    case 'plane': return { kind: 'lowpoly', palette: paint, vehicle: type, parts: [P('cyl', [0, 1.2, 0], [1, 5.5, 1], 'paint', { rot: [Math.PI / 2, 0, 0], taper: 0.5, name: 'body' }), P('box', [0, 1.2, 0.6], [8, 0.1, 1.3], 'paint', { name: 'wings' }), ...(/bi/.test(w) ? [P('box', [0, 2.1, 0.6], [8, 0.1, 1.3], 'paint', { name: 'wings2' })] : []), P('box', [0, 1.6, -2.5], [2.6, 0.08, 0.8], 'paint', { name: 'tailplane' }), P('box', [0, 2, -2.6], [0.08, 1, 0.8], 'accent', { name: 'fin' }), P('box', [0, 1.2, 2.85], [2.2, 0.15, 0.08], 'metal', { mat: 'metal', name: 'propeller' }), P('cyl', [0.9, 0.3, 0.6], [0.5, 0.12, 0.5], 'tire', { rot: [0, 0, Math.PI / 2], name: 'wheelL' }), P('cyl', [-0.9, 0.3, 0.6], [0.5, 0.12, 0.5], 'tire', { rot: [0, 0, Math.PI / 2], name: 'wheelR' })] };
    case 'heli': return { kind: 'lowpoly', palette: paint, vehicle: type, parts: [P('sphere', [0, 1.4, 0], [2, 1.8, 3.4], 'paint', { name: 'body' }), P('cyl', [0, 1.6, -2.8], [0.3, 3, 0.3], 'paint', { rot: [Math.PI / 2, 0, 0], name: 'boom' }), P('box', [0, 2.45, 0], [7, 0.05, 0.25], 'metal', { mat: 'metal', name: 'rotor' }), P('box', [0, 0.25, 0], [1.8, 0.08, 2.6], 'metal', { name: 'skids' })] };
    case 'cart': return { kind: 'lowpoly', palette: { ...paint, paint: pal.wood }, vehicle: type, parts: [P('box', [0, 0.65, 0], [1.2, 0.7, 1.6], 'paint', { taper: 1.15, name: 'body' }), ...wheels(1.6, 1.2, 0.25)] };
  }
  return { kind: 'lowpoly', palette: paint, parts: [P('box', [0, 0.6, 0], [1.8, 1, 4], 'paint')] };
}

function propSpec(name, w, pal, r) {
  const type = PROPS.find(([, re]) => re.test(w))?.[0] || 'crate';
  const P = (shape, at, size, c, extra = {}) => ({ shape, at, size, c, ...extra });
  const s = 0.9 + r(9) * 0.3;
  const T = {
    campfire: [P('cyl', [0, 0.05, 0], [0.8, 0.1, 0.8], 'stone'), P('cyl', [0.1, 0.12, 0], [0.12, 0.7, 0.12], 'wood', { rot: [0, 0, 1.3] }), P('cyl', [-0.1, 0.12, 0.05], [0.12, 0.7, 0.12], 'wood', { rot: [0.4, 0, -1.3] }), P('cone', [0, 0.38, 0], [0.32, 0.55, 0.32], 'glow', { mat: 'glow', flicker: true, name: 'flame' })],
    lamp: [P('cyl', [0, 1.4, 0], [0.12, 2.8, 0.12], 'metal', { mat: 'metal' }), P('box', [0, 2.9, 0], [0.4, 0.45, 0.4], 'glow', { mat: 'glow', flicker: true, name: 'light' }), P('cone', [0, 3.2, 0], [0.55, 0.25, 0.55], 'metal', { mat: 'metal' })],
    chest: [P('box', [0, 0.3 * s, 0], [0.9 * s, 0.6 * s, 0.6 * s], 'wood'), P('box', [0, 0.62 * s, 0], [0.92 * s, 0.1 * s, 0.62 * s], 'metal', { mat: 'metal', name: 'lid' }), P('box', [0, 0.42 * s, 0.31 * s], [0.12, 0.16, 0.04], 'trim', { mat: 'metal', name: 'lock' })],
    crate: [P('box', [0, 0.5 * s, 0], [s, s, s], 'wood'), P('box', [0, 0.5 * s, 0], [s * 1.02, s * 0.12, s * 1.02], 'boots')],
    barrel: [P('cyl', [0, 0.5, 0], [0.7, 1, 0.7], 'wood', { taper: 0.92 }), P('cyl', [0, 0.25, 0], [0.74, 0.06, 0.74], 'metal', { mat: 'metal' }), P('cyl', [0, 0.75, 0], [0.74, 0.06, 0.74], 'metal', { mat: 'metal' })],
    bed: [P('box', [0, 0.25, 0], [1, 0.3, 2.1], 'wood'), P('box', [0, 0.45, 0], [0.95, 0.15, 2], 'cloth'), P('box', [0, 0.55, 0.8], [0.7, 0.1, 0.35], 'belly')],
    table: [P('box', [0, 0.85, 0], [1.6, 0.1, 0.9], 'wood'), ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([x, z]) => P('box', [x * 0.7, 0.4, z * 0.35], [0.1, 0.8, 0.1], 'wood')), P('box', [0.3, 0.97, 0.1], [0.3, 0.14, 0.2], 'trim')],
    anvil: [P('box', [0, 0.25, 0], [0.5, 0.5, 0.4], 'stone'), P('box', [0, 0.62, 0], [0.9, 0.24, 0.35], 'metal', { mat: 'metal' }), P('cone', [0.55, 0.62, 0], [0.2, 0.3, 0.2], 'metal', { mat: 'metal', rot: [0, 0, -Math.PI / 2] })],
    door: [P('box', [0, 1.1, 0], [1.2, 2.2, 0.15], 'wood', { name: 'door' }), P('sphere', [0.45, 1.05, 0.1], [0.08, 0.08, 0.08], 'metal', { mat: 'metal' })],
    tree: [P('cyl', [0, 1.6 * s, 0], [0.35 * s, 3.2 * s, 0.35 * s], 'wood', { taper: 0.7 }), P('cone', [0, 3.6 * s, 0], [2.6 * s, 3 * s, 2.6 * s], 'coat', { name: 'crown' }), P('cone', [0, 4.8 * s, 0], [1.8 * s, 2.2 * s, 1.8 * s], 'coat', { name: 'crown' })],
    bush: [P('sphere', [0, 0.4 * s, 0], [1.1 * s, 0.8 * s, 1.1 * s], 'coat'), P('sphere', [0.25, 0.6 * s, 0.1], [0.6 * s, 0.5 * s, 0.6 * s], 'coat'), P('sphere', [0.2, 0.7 * s, 0.35], [0.12, 0.12, 0.12], 'accent')],
    rock: [P('sphere', [0, 0.35 * s, 0], [1.2 * s, 0.75 * s, 0.95 * s], 'stone', { segments: 5 }), P('sphere', [0.4 * s, 0.25 * s, 0.25 * s], [0.6 * s, 0.45 * s, 0.5 * s], 'stone', { segments: 5 })],
    sign: [P('box', [0, 0.6, 0], [0.12, 1.2, 0.12], 'wood'), P('box', [0, 1.15, 0], [0.9, 0.55, 0.08], 'wood'), P('box', [0, 1.15, 0.045], [0.7, 0.35, 0.01], 'belly')],
    statue: [P('box', [0, 0.3, 0], [1.2, 0.6, 1.2], 'stone'), P('cyl', [0, 1.4, 0], [0.6, 1.6, 0.6], 'stone', { taper: 0.6 }), P('sphere', [0, 2.4, 0], [0.5, 0.5, 0.5], 'glow', { mat: 'glow' })],
    machine: [P('box', [0, 0.95, 0], [0.9, 1.9, 0.7], 'body', { mat: 'metal' }), P('box', [0, 1.3, 0.36], [0.6, 0.7, 0.02], 'glow', { mat: 'glow', name: 'screen' }), P('box', [0, 0.5, 0.36], [0.5, 0.2, 0.02], 'boots')],
    barricade: [P('box', [0, 0.5, 0], [2, 0.3, 0.2], 'accent', { rot: [0, 0, 0.12] }), P('box', [0, 0.9, 0], [2, 0.3, 0.2], 'belly', { rot: [0, 0, -0.12] }), P('box', [0.8, 0.5, 0], [0.12, 1, 0.12], 'wood'), P('box', [-0.8, 0.5, 0], [0.12, 1, 0.12], 'wood')],
    crown: [P('cyl', [0, 1, 0], [0.35, 0.18, 0.35], 'trim', { mat: 'metal' }), ...[0, 1, 2, 3, 4].map(i => P('cone', [Math.sin(i * 1.2566) * 0.15, 1.15, Math.cos(i * 1.2566) * 0.15], [0.07, 0.15, 0.07], 'trim', { mat: 'metal' })), P('sphere', [0, 1.05, 0.17], [0.06, 0.06, 0.06], 'glow', { mat: 'glow' }), P('cyl', [0, 0.45, 0], [0.5, 0.9, 0.5], 'stone')],
  };
  return { kind: 'lowpoly', palette: { ...pal, coat: hsl(95 + r(10) * 50, 0.45, 0.28 + r(11) * 0.1) }, prop: type, bob: type === 'crown', parts: T[type] };
}

/** A model for an item or attachment name ('sword', 'lantern', 'hand_axe'), in hand space (grip at origin, blade along +y). */
export function itemSpec(item) {
  const w = `${item.id || ''} ${item.kind || ''} ${(item.tags || []).join(' ')}`.toLowerCase().replace(/_/g, ' '); // never the themed name
  const type = ITEMS.find(([, re]) => re.test(w))[0], name = item.id || 'item', r = i => hash01(name, 70 + i);
  const pal = { metal: '#c8ccd4', wood: '#6a4424', grip: '#3a2418', gem: hsl(r(1) * 360, 0.8, 0.6), cloth: hsl(r(2) * 360, 0.4, 0.35), glow: '#ffc060' };
  const P = (shape, at, size, c, extra = {}) => ({ shape, at, size, c, ...extra });
  const T = {
    sword: [P('cyl', [0, 0, 0], [0.05, 0.2, 0.05], 'grip'), P('box', [0, 0.11, 0], [0.24, 0.04, 0.05], 'metal', { mat: 'metal' }), P('box', [0, 0.55, 0], [0.07, 0.85, 0.02], 'metal', { mat: 'metal', taper: 0.6 }), P('sphere', [0, -0.11, 0], [0.06, 0.06, 0.06], 'gem', { mat: 'metal' })],
    axe: [P('cyl', [0, 0.25, 0], [0.05, 0.7, 0.05], 'wood'), P('box', [0.1, 0.52, 0], [0.22, 0.2, 0.03], 'metal', { mat: 'metal' })],
    pick: [P('cyl', [0, 0.25, 0], [0.05, 0.7, 0.05], 'wood'), P('box', [0, 0.58, 0], [0.55, 0.06, 0.05], 'metal', { mat: 'metal', taper: 0.4 })],
    hammer: [P('cyl', [0, 0.22, 0], [0.05, 0.6, 0.05], 'wood'), P('box', [0, 0.52, 0], [0.24, 0.14, 0.14], 'metal', { mat: 'metal' })],
    spear: [P('cyl', [0, 0.5, 0], [0.04, 1.7, 0.04], 'wood'), P('cone', [0, 1.45, 0], [0.07, 0.25, 0.07], 'metal', { mat: 'metal' })],
    bow: [P('box', [0, 0.35, 0.04], [0.03, 0.4, 0.04], 'wood', { rot: [0.35, 0, 0] }), P('box', [0, -0.35, 0.04], [0.03, 0.4, 0.04], 'wood', { rot: [-0.35, 0, 0] }), P('cyl', [0, 0, -0.03], [0.005, 1.25, 0.005], 'metal')],
    shield: [P('cyl', [0, 0, 0.06], [0.6, 0.05, 0.6], 'cloth', { rot: [Math.PI / 2, 0, 0] }), P('cyl', [0, 0, 0.09], [0.15, 0.04, 0.15], 'metal', { rot: [Math.PI / 2, 0, 0], mat: 'metal' })],
    gun: [P('box', [0, 0.02, 0.1], [0.06, 0.1, 0.32], 'grip', { mat: 'metal' }), P('box', [0, -0.08, 0.0], [0.05, 0.14, 0.06], 'grip'), P('cyl', [0, 0.04, 0.3], [0.03, 0.2, 0.03], 'metal', { rot: [Math.PI / 2, 0, 0], mat: 'metal' })],
    torch: [P('cyl', [0, 0.15, 0], [0.05, 0.45, 0.05], 'wood'), P('cone', [0, 0.45, 0], [0.12, 0.22, 0.12], 'glow', { mat: 'glow', flicker: true, name: 'flame' })],
    backpack: [P('box', [0, 0, 0], [0.38, 0.5, 0.2], 'cloth'), P('box', [0, -0.12, 0.11], [0.3, 0.18, 0.06], 'cloth'), P('box', [0, 0.22, 0], [0.4, 0.08, 0.22], 'grip')],
    potion: [P('sphere', [0, 0.06, 0], [0.12, 0.12, 0.12], 'gem', { alpha: 0.75 }), P('cyl', [0, 0.15, 0], [0.04, 0.08, 0.04], 'wood')],
    tool: [P('cyl', [0, 0.2, 0], [0.05, 0.5, 0.05], 'wood'), P('box', [0, 0.45, 0], [0.12, 0.12, 0.12], 'metal', { mat: 'metal' })],
  };
  return { kind: 'lowpoly', palette: pal, item: type, parts: T[type] };
}
