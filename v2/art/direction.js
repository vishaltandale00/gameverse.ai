// Art direction: the structured description the model writes and the
// painters draw. It is made once per game and then locked: a revision reuses
// it unchanged unless the change request is about how something looks, and
// even then only the named targets are replaced.
import { BODIES, PARTS, PRESET_NAMES, normalizeLook } from './characters.js';
import { PROPS } from './props.js';
import { MATERIALS, SURFACES, PLATFORMS } from './tiles.js';
import { THEMES, TIMES } from './scenery.js';
import { FEATURES, DEPTHS, normalizeFeatures } from './features.js';
import { hex } from './color.js';
import { LOOK_SCHEMA, LOOK_PRESET_NAMES, resolveLook, presetFor } from './look.js';

export const DIRECTION_SCHEMA_ID = 'gameverse.v2.art-direction/0.2';
export const TARGETS = ['style', 'scenery', 'tiles', 'player', 'enemy', 'pickup', 'hazard', 'goal'];
export const FONTS = ['pixel', 'rounded', 'bold', 'serif', 'hand'];

const color = { type: 'string', description: 'hex color like #3a7bd5' };
const en = list => ({ type: 'string', enum: list });
const obj = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const look = obj({
  preset: { type: 'string', enum: PRESET_NAMES, description: 'A curated look for a well-known character archetype; "none" to build from parts. When set, the parts below are ignored.' },
  recolor: { type: 'boolean', description: 'true only when the player asked to change this preset character\'s colors; then colors below apply.' },
  body: en(BODIES), build: en(['chibi', 'normal', 'stocky', 'tall']),
  colors: obj({ primary: color, secondary: color, accent: color, eye: color, outfit: color, hair: color, hat: color }),
  ears: en(PARTS.ears), top: en(PARTS.top), headwear: en(PARTS.headwear), snout: en(PARTS.snout), eyes: en(PARTS.eyes),
  tail: en(PARTS.tail), feet: en(PARTS.feet), hands: en(PARTS.hands), accessory: en(PARTS.accessory), held: en(PARTS.held),
  facial: en(PARTS.facial), outfit: en(PARTS.outfit), arms: en(PARTS.arms),
});
const prop = role => obj({ kind: en(PROPS[role]), color });

export const DIRECTION_SCHEMA = obj({
  style: en(['pixel', 'vector']),
  styleLabel: { type: 'string' },
  look: LOOK_SCHEMA,
  font: en(FONTS),
  scenery: obj({ theme: en(THEMES), time: en(TIMES), sky: { type: 'array', items: color }, land: color,
    features: { type: 'array', description: 'Parts of the environment, composed on the theme: e.g. leafy-forest (dense, far and mid) with falling-leaves; street with traffic and pedestrians in front of a skyline with neon-signs.', items: obj({ kind: en(FEATURES), density: { type: 'number', description: '0.05 sparse … 1 packed' }, depth: en(DEPTHS) }) } }),
  tiles: obj({ material: en(MATERIALS), surface: en(SURFACES), platform: en(PLATFORMS), groundColor: color, surfaceColor: color, platformColor: color }),
  player: look, enemy: look,
  pickup: prop('pickup'), hazard: prop('hazard'), goal: prop('goal'),
  changed: { type: 'array', items: en(TARGETS) },
});

export const DIRECTION_PROMPT = `You are the art director for a 2D game. Code draws every asset from your description, so choose parts and colors that make each thing instantly recognizable at small size and cohesive as a set.

- style: "pixel" for pixel-art or retro requests (16-bit, 8-bit, SNES), otherwise "vector" (clean cartoon). styleLabel: a short phrase like "crisp 16-bit pixel art".
- look: the art style as rules every asset follows. Pick look.preset from the idea, theme and any style the player asked for: ${LOOK_PRESET_NAMES.join(', ')}. 8-bit for NES-era or chiptune retro; 16-bit for SNES-era or plain "pixel art"; coarse-pixel for lo-fi chunky pixels; monochrome-pixel for four-shade handheld looks; layered-silhouette for moody, misty or shadowy worlds; minimal-geometric for abstract, calm or puzzle ideas; neon-vector for synthwave, cyber, space-arcade or glowing worlds; bold-comic for punchy cartoon action (the default for clean cartoon); rubber-hose for 1930s vintage cartoons; black-figure for ancient Greek myth and pottery. style must agree: pixel presets are "pixel", the rest "vector". Leave every other look field null unless the player asked for something specific (a palette, thicker outlines, no outlines, more glow); then set only that field.
- font: title typography that fits the tone.
- scenery: the background world. Compose it from features on top of the theme: static ones (leafy-forest, pine-forest, palms, bushes, flowers, tall-grass, skyline, houses, street, street-lamps, neon-signs, bridge, mountains, hills, cliffs, river, lake, ocean, waterfall, castle, ruins, windmills, fences, market-stalls) and moving ones animated live (traffic, pedestrians, birds, falling-leaves, fireflies, rain, snow, fog, drifting-clouds, embers, bubbles, train). Requests about environments map here: "leafy forests" → leafy-forest dense at far and mid plus falling-leaves; "busy city streets" → street, traffic dense, pedestrians, skyline, street-lamps. sky: three hex colors top, middle, horizon. land: the main color of distant hills, rock or buildings (an earthy or stone color that differs clearly from the sky, never another sky blue).
- tiles: material is the soil or wall body; surface is the walkable top layer; platform is floating blocks. Ground and platforms must contrast with each other and with the sky.
- player and enemy: build each character from parts. body is the body plan (biped for people and upright animals, quadruped for four-legged animals, blob for slimes, flyer for birds and bats, robot for wheeled machines, ghost for spirits). primary is the main fur, skin or clothing color, secondary the belly, face or skin, accent shoes, hats and trim, eye the iris. Give the player bright, friendly colors and the enemy a contrasting, menacing palette (eyes "angry" or "visor").
- pickup, hazard, goal: the closest kind and a color.
- When the idea names a well-known character, set preset to the matching archetype: plumber-hero (Mario-like), plumber-brother (Luigi-like), blue-hedgehog (Sonic-like), fox-sidekick (Tails-like), spiky-martial-artist (Goku-like), princess (Peach-like), turtle-king (Bowser-like), mushroom-walker (Goomba-like), green-elf-hero (Link-like), space-hunter (Samus-like), ninja, knight, yellow-electric-mouse (Pikachu-like). Keep recolor false unless the player asked for different colors. Otherwise set preset none and rebuild its look from parts so it is instantly recognizable: its silhouette, palette, outfit and signature features. A mustached plumber: build stocky, headwear cap, snout big-nose, facial mustache, outfit overalls (outfit color) over a shirt (primary), hands gloves, feet boots. A blue hedgehog: top quills, ears pointed, snout muzzle, arms skin (secondary peach), eye green, feet shoes red with the white strap, hands gloves, tail spiky. A martial-arts hero: top spikes (hair color), outfit gi, belt in outfit color. Never draw logos, letters or emblems.
- outfit color is overalls, pants or belt; hair color is hair and facial hair.
- changed: when revising an existing direction, list ONLY the targets the change request is about (e.g. "make the hero red" → ["player"]). Copy every other target exactly. When creating new, list all targets.`;

export function directionRequest({ design, previous, change }) {
  const cast = design.cast || {};
  const brief = `Game: ${design.title}. ${design.pitch || ''}\nView: ${design.view}. Art style asked for: ${design.artStyle || 'unspecified'}.\nCast: player ${cast.player?.name} ${cast.player?.glyph || ''}; enemy ${cast.enemy?.name} ${cast.enemy?.glyph || ''}; pickup ${cast.pickup?.name}; hazard ${cast.hazard?.name}; goal ${cast.goal?.name}.\nMood color: ${design.background || ''}.`;
  if (!previous) return brief;
  return `${brief}\n\nCurrent art direction:\n${JSON.stringify(stripChanged(previous))}\n\nChange request: ${change}\nList in "changed" only the targets this request is about; copy the rest exactly.`;
}
const stripChanged = d => { const { changed, ...rest } = d; return rest; };

/** Fill defaults and clamp to known values. */
export function normalizeDirection(input = {}) {
  const d = input || {};
  const pick = (v, list, def) => list.includes(v) ? v : def;
  const propOf = (role, def) => ({ kind: pick(d[role]?.kind, PROPS[role], def), color: hex(d[role]?.color, undefined) });
  // The look decides pixel or vector when it names a preset; otherwise the style picks the look's preset.
  const look = resolveLook(d.look, { style: d.style });
  return {
    schema: DIRECTION_SCHEMA_ID,
    style: d.look?.preset && LOOK_PRESET_NAMES.includes(d.look.preset) ? (look.pixel ? 'pixel' : 'vector') : pick(d.style, ['pixel', 'vector'], look.pixel ? 'pixel' : 'vector'),
    look,
    styleLabel: typeof d.styleLabel === 'string' && d.styleLabel ? d.styleLabel.slice(0, 80) : 'clean cartoon vector art',
    font: pick(d.font, FONTS, 'rounded'),
    scenery: { features: normalizeFeatures(d.scenery?.features), theme: pick(d.scenery?.theme, THEMES, 'meadow'), time: pick(d.scenery?.time, TIMES, 'day'), sky: Array.isArray(d.scenery?.sky) && d.scenery.sky.length === 3 && d.scenery.sky.every(c => hex(c)) ? d.scenery.sky.map(c => hex(c)) : null, land: hex(d.scenery?.land, undefined) },
    tiles: { material: pick(d.tiles?.material, MATERIALS, 'dirt'), surface: pick(d.tiles?.surface, SURFACES, 'grass'), platform: pick(d.tiles?.platform, PLATFORMS, 'brick'), groundColor: hex(d.tiles?.groundColor, '#8a5a2b'), surfaceColor: hex(d.tiles?.surfaceColor, '#4fbf3a'), platformColor: hex(d.tiles?.platformColor, '#c0603a') },
    player: normalizeLook(d.player), enemy: normalizeLook({ eyes: 'angry', ...d.enemy }),
    pickup: propOf('pickup', 'coin'), hazard: propOf('hazard', 'spikes'), goal: propOf('goal', 'flag'),
  };
}

/** Take the model's revision, keeping every target it didn't list in `changed` from the previous direction. */
export function mergeDirection(previous, revised, forced = []) {
  const changed = new Set([...(revised?.changed || []), ...forced].filter(t => TARGETS.includes(t)));
  const next = { ...previous };
  const incoming = normalizeDirection(revised);
  for (const t of changed) {
    if (t === 'style') { next.style = incoming.style; next.styleLabel = incoming.styleLabel; next.font = incoming.font; next.look = incoming.look; }
    else next[t] = incoming[t];
  }
  return { direction: next, changed: [...changed] };
}

/** Which targets a design change forces, because the thing itself changed (a new enemy, a new pickup). */
export function forcedTargets(previousDesign, design) {
  const out = [];
  for (const role of ['player', 'enemy', 'pickup', 'hazard', 'goal']) {
    const a = previousDesign?.cast?.[role], b = design?.cast?.[role];
    if (a && b && (a.name !== b.name || a.glyph !== b.glyph)) out.push(role);
  }
  if (previousDesign && previousDesign.view !== design.view) out.push('scenery', 'tiles');
  return out;
}

// ---------- offline fallback: a reasonable direction from the design alone ----------
const GLYPH_LOOKS = {
  '🦔': { body: 'biped', colors: { primary: '#1f5fd6', secondary: '#f2c79a', accent: '#e0302f', eye: '#1f9a4c' }, ears: 'pointed', top: 'quills', snout: 'muzzle', tail: 'spiky' },
  '🦊': { body: 'biped', colors: { primary: '#e8742a', secondary: '#fff1df', accent: '#3a6fd8', eye: '#3a2a10' }, ears: 'pointed', snout: 'muzzle', tail: 'fluffy' },
  '🐱': { body: 'biped', colors: { primary: '#f0a040', secondary: '#fff1df', accent: '#3a6fd8', eye: '#2a8a3a' }, ears: 'pointed', snout: 'nose', tail: 'thin' },
  '🐰': { body: 'biped', colors: { primary: '#f4f0f0', secondary: '#ffd0e0', accent: '#ff6fa0', eye: '#4a2a6a' }, ears: 'long', snout: 'nose', tail: 'fluffy' },
  '🐧': { body: 'biped', build: 'stocky', colors: { primary: '#2a3048', secondary: '#ffffff', accent: '#f0a020', eye: '#202020' }, snout: 'beak', feet: 'paws', hands: 'paws' },
  '🐸': { body: 'blob', colors: { primary: '#5fd36a', secondary: '#c8ffd0', accent: '#2f8a3a', eye: '#1a1a1a' } },
  '🤖': { body: 'robot', colors: { primary: '#d8352a', secondary: '#202430', accent: '#f5c542', eye: '#ff3b3b' }, eyes: 'visor', accessory: 'spots' },
  '👾': { body: 'blob', colors: { primary: '#9b5cff', secondary: '#d8c0ff', accent: '#ff5ab0', eye: '#101010' }, eyes: 'cyclops' },
  '👻': { body: 'ghost', colors: { primary: '#e8ecff', secondary: '#ffffff', accent: '#7a80ff', eye: '#30306a' }, eyes: 'dots' },
  '🦇': { body: 'flyer', colors: { primary: '#4a3a6a', secondary: '#8a7aa8', accent: '#ff5a5a', eye: '#ff3b3b' }, ears: 'pointed', eyes: 'angry' },
  '🐦': { body: 'flyer', colors: { primary: '#3a8ae8', secondary: '#e8f4ff', accent: '#f0a020', eye: '#202020' } },
  '🐺': { body: 'quadruped', colors: { primary: '#6a7080', secondary: '#c8ccd8', accent: '#3a3040', eye: '#f0c020' }, ears: 'pointed', snout: 'muzzle', tail: 'fluffy', eyes: 'angry' },
  '🐻': { body: 'biped', build: 'stocky', colors: { primary: '#8a5a2b', secondary: '#d8a878', accent: '#3a6fd8', eye: '#202020' }, ears: 'round', snout: 'muzzle', feet: 'paws', hands: 'paws' },
  '🥷': { body: 'biped', colors: { primary: '#2a2a38', secondary: '#f0c8a0', accent: '#d8262c', eye: '#202020' }, headwear: 'bandana', accessory: 'scarf', held: 'sword', feet: 'boots' },
  '🧙': { body: 'biped', build: 'normal', colors: { primary: '#5b3fa8', secondary: '#f1d0b0', accent: '#3a2a80', eye: '#7a40d0' }, headwear: 'wizard-hat', held: 'staff', feet: 'boots' },
  '🤠': { body: 'biped', build: 'normal', colors: { primary: '#a0683a', secondary: '#f0c8a0', accent: '#6b4325', eye: '#3a6fd8' }, headwear: 'cap', feet: 'boots', held: 'blaster' },
  '👺': { body: 'biped', build: 'stocky', colors: { primary: '#d83a2a', secondary: '#ff8a6a', accent: '#3a2a20', eye: '#ffe23a' }, headwear: 'horns', eyes: 'angry', hands: 'claws', feet: 'paws' },
  '🐲': { body: 'quadruped', colors: { primary: '#3fae4a', secondary: '#f0e08a', accent: '#d83a2a', eye: '#f0c020' }, headwear: 'horns', tail: 'spiky', eyes: 'angry', snout: 'muzzle' },
  '🦀': { body: 'blob', colors: { primary: '#e8502a', secondary: '#ffb090', accent: '#a0301a', eye: '#101010' }, eyes: 'angry' },
};
const PROP_GLYPHS = {
  '💍': 'ring', '🪙': 'coin', '💰': 'coin', '💎': 'gem', '⭐': 'star', '🌟': 'star', '❤️': 'heart', '🍎': 'fruit', '🍒': 'fruit', '🔑': 'key', '🔮': 'orb', '🍄': 'mushroom', '🪶': 'feather', '🔋': 'battery', '🌸': 'flower', '📜': 'scroll', '🍬': 'candy', '🌰': 'acorn', '🐚': 'shell', '🎵': 'note',
  '🌵': 'cactus', '🔥': 'fire', '⚡': 'electric', '💣': 'mine', '🧊': 'ice-spikes', '🌋': 'lava', '⚔️': 'spikes', '🗡️': 'spikes', '☠️': 'acid', '🪚': 'saw',
  '🚩': 'flag', '🏁': 'flag', '🚪': 'door', '🌀': 'portal', '🏆': 'trophy', '🏰': 'castle', '📦': 'chest', '🪺': 'nest',
};

/** A deterministic direction from the design, used offline and as the model's fallback. */
export function fallbackDirection(design = {}) {
  const cast = design.cast || {}, text = `${design.title} ${design.pitch} ${design.artStyle}`.toLowerCase();
  const theme = THEMES.find(t => text.includes(t)) || (/ice|frost|winter|penguin/.test(text) ? 'snow' : /lava|fire|volcan/.test(text) ? 'volcano' : /dungeon|cave|mine/.test(text) ? 'cave' : /space|star|galax/.test(text) ? 'space' : /city|urban|street/.test(text) ? 'city' : /spook|haunt|ghost/.test(text) ? 'haunted' : /sand|desert/.test(text) ? 'desert' : 'meadow');
  const tiles = { snow: ['snow', 'snow', 'ice'], volcano: ['lava-rock', 'stone', 'stone'], cave: ['stone', 'moss', 'stone'], space: ['tech', 'metal', 'tech'], city: ['brick', 'stone', 'metal'], haunted: ['stone', 'moss', 'wood'], desert: ['sand', 'sand', 'wood'], factory: ['metal', 'metal', 'metal'], candy: ['candy', 'frosting', 'cloud'] }[theme] || ['dirt', 'grass', 'brick'];
  const preset = presetFor(`${design.artStyle} ${design.title} ${design.pitch} ${theme}`);
  return normalizeDirection({
    style: /pixel|8-bit|16-bit|retro/.test(text) ? 'pixel' : 'vector', styleLabel: design.artStyle,
    look: preset ? { preset } : null,
    font: /pixel|retro/.test(text) ? 'pixel' : 'rounded',
    scenery: { theme, time: /night|dark|spook/.test(text) ? 'night' : /sunset|dusk/.test(text) ? 'sunset' : 'day' },
    tiles: { material: tiles[0], surface: tiles[1], platform: tiles[2], groundColor: design.palette?.ground, surfaceColor: undefined, platformColor: design.palette?.platform },
    player: GLYPH_LOOKS[cast.player?.glyph] || {}, enemy: GLYPH_LOOKS[cast.enemy?.glyph] || { body: 'robot', eyes: 'visor' },
    pickup: { kind: PROP_GLYPHS[cast.pickup?.glyph] }, hazard: { kind: PROP_GLYPHS[cast.hazard?.glyph] }, goal: { kind: PROP_GLYPHS[cast.goal?.glyph] },
  });
}
