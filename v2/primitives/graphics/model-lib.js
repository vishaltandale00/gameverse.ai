// Shared declarations of the graphics family (ARCHITECTURE.md §1.4: cards are the type system). Every graphics card
// that reads a field of content.models, or takes a hex color, declares it from here, so two cards never declare one
// field two ways (kernel/sections.js mergeShape) and a form never allows a color a renderer cannot draw.
//
// content.models is an id-keyed object (model id -> spec, catalog §5.2). Its specs are a family of kinds (pixel,
// vector, rig, art, voxel, lowpoly...) whose renderers fall back on generated art for a kind they do not draw, so
// `kind` is a free string; what one kind requires (a pixel sprite's [w, h] size, a voxel part's box) is a rule of the
// card that draws that kind (card.rules), since the dialect has no per-kind shapes.

/** A #rgb or #rrggbb color (art/color.js isHex). */
export const HEX_COLOR = '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$';
/** A #rrggbb color (the 3D sky and terrain shaders read six digits). */
export const HEX6_COLOR = '^#[0-9a-fA-F]{6}$';
const HEX_RE = new RegExp(HEX_COLOR, 'u');
/** True for a value HEX_COLOR allows. @param {unknown} s */
export const isHexColor = s => typeof s === 'string' && HEX_RE.test(s);
/** A hex color param or field. @param {Record<string, unknown>} [extra] */
export const color = (extra = {}) => ({ type: 'string', pattern: HEX_COLOR, ...extra });

/** Lowpoly part shapes (model-lowpoly.js draws exactly these). */
export const LOWPOLY_SHAPES = ['box', 'cyl', 'sphere', 'cone', 'cap'];
const nums = (extra = {}) => ({ type: 'list', of: { type: 'number' }, ...extra });

/** The fields of a model part, across kinds: pixel rects, voxel boxes, lowpoly shapes. */
const PART_FIELDS = {
  name: { type: 'string', effect: 'part name (rig parts: head, torso, armL, armR, legL, legR)' },
  c: { type: 'string', effect: 'a palette key or a #hex color' },
  rect: nums({ min: 4, max: 4, effect: 'pixel: [x, y, w, h]' }),
  box: nums({ min: 6, max: 6, effect: 'voxel: [x, y, z, w, h, d]' }),
  shape: { type: 'string', options: LOWPOLY_SHAPES, effect: 'lowpoly primitive shape' },
  at: nums({ effect: 'lowpoly: centre [x, y, z]' }),
  size: nums({ effect: 'lowpoly: [w, h, d]' }),
  from: nums({ effect: 'lowpoly: one end of a limb (with to)' }),
  to: nums({ effect: 'lowpoly: the other end of a limb' }),
  mat: { type: 'string', effect: 'lowpoly material: matte, metal, glow' },
  bone: { type: 'string', effect: 'lowpoly: the bone the part follows' },
};

/** 2D rig bone shapes (flat-rig.js). */
export const BONE_SHAPES = ['limb', 'blob', 'head', 'segment', 'wing', 'spike', 'poly'];
/** A bone of a 2D rig (graphics.rig.custom rigs and models of kind rig). */
export const BONE = { type: 'object', open: true, fields: {
  id: { type: 'string', required: true }, parent: { type: 'string' }, at: { type: 'list', of: { type: 'number' }, default: [0, 0], effect: 'offset from the parent tip (roots: from the feet), rig units, y down' },
  len: { type: 'number', default: 10, min: 0, max: 200 }, angle: { type: 'number', default: 0, unit: 'deg', effect: 'rest angle from straight down; + swings forward' },
  w: { type: 'number', default: 6, min: 0.5, max: 80 }, shape: { type: 'string', default: 'limb', options: BONE_SHAPES }, c: { type: 'string', effect: 'palette key or hex' }, z: { type: 'number', default: 0 },
  wave: { type: 'object', fields: { amp: { type: 'number', default: 10 }, freq: { type: 'number', default: 1 }, phase: { type: 'number', default: 0 } }, effect: 'procedural sway when no clip covers the state' },
} };

/** Pose clips of a 2D rig, per presentation state (flat-rig.js). @param {string[]} states @param {Record<string, unknown>} [extra] */
export const rigClips = (states, extra = {}) => ({ type: 'object', ...extra, effect: 'state -> { dur s, loop, keys: [{ t s, pose: { bone: deg } }] }',
  fields: Object.fromEntries(states.map(s => [s, { type: 'object', fields: {
    dur: { type: 'number', min: 0 }, loop: { type: 'boolean' },
    keys: { type: 'list', of: { type: 'object', fields: { t: { type: 'number', min: 0 }, pose: { type: 'object', values: { type: 'number' }, effect: 'bone id -> angle (deg)' } } } },
  } }])) });

/**
 * Every declared field of a content.models spec. `anims` and `clips` need the presentation states (flat-models.js
 * STATES), which import from the flat renderers; cards pass them in through modelsData.
 */
const MODEL_FIELDS = {
  kind: { type: 'string', effect: 'which renderer family draws it: pixel, vector, rig, art, voxel, lowpoly; other kinds get generated art' },
  palette: { type: 'object', values: color(), effect: 'color key -> #hex' },
  parts: { type: 'list', of: { type: 'object', open: true, fields: PART_FIELDS } },
  size: nums({ effect: 'pixel: [w, h] art pixels; voxel: [w, h, d] voxels' }),
  anims: { type: 'object', values: { type: 'object', open: true, fields: { frames: { type: 'integer', min: 1, required: true }, fps: { type: 'number', min: 0 }, loop: { type: 'boolean' } } }, effect: 'pixel: animation name -> { frames, fps, loop }' },
  pivot: nums({ min: 2, max: 2, effect: 'pixel: the feet point [x, y]' }),
  preset: { type: 'string', effect: 'vector: a vector preset; rig: a rig preset' },
  color: color({ effect: 'vector and art props: the main color' }),
  prop: { type: 'string', effect: 'art: the generated prop it is drawn as' },
  shapes: { type: 'list', of: { type: 'object', open: true }, effect: 'vector: author shapes in unit coordinates' },
  rig: { type: 'string', effect: 'rig: a graphics.rig.custom rig id; lowpoly: humanoid, quadruped or custom' },
  bones: { type: 'list', of: BONE, effect: 'rig: an author bone tree' },
  boneCount: { type: 'integer', min: 1, effect: 'lowpoly custom rig: how many bones the generated spine and tail get' },
  look: { type: 'object', open: true, effect: 'rig fighters and art characters: outfit, hair, headwear, build and colors' },
  height: { type: 'number', min: 0, effect: 'model height (m)' },
  // Generated bodies of rigged lowpoly specs (model-lowpoly.js) and their portraits (ui-portrait.js).
  build: { type: 'object', open: true, fields: { width: { type: 'number', min: 0 }, head: { type: 'number', min: 0 }, shoulders: { type: 'number', min: 0 } }, effect: 'body build multipliers' },
  proportions: { type: 'object', open: true, fields: { legs: { type: 'number', min: 0 }, arms: { type: 'number', min: 0 }, torso: { type: 'number', min: 0 }, head: { type: 'number', min: 0 } }, effect: 'humanoid fractions of height' },
  species: { type: 'string', effect: 'quadruped: the animal (horse, wolf, deer...): shapes the generated body' },
  length: { type: 'number', min: 0, effect: 'quadruped body length (m)' },
  material: { type: 'string', effect: "generated clothing material: 'metal' or matte" },
  alpha: { type: 'number', min: 0, max: 1, effect: 'translucency of generated parts (spirits)' },
  eyes: { type: 'string', effect: "'glow' for glowing eyes" },
  hair: { type: 'string', effect: 'generated hair style (short, long, helmet, hood...)' },
  sleeves: { type: 'string', effect: "'long' sleeves" },
  legs: { type: 'string', effect: "'robe' instead of legs" },
  horns: { type: 'boolean' }, mane: { type: 'boolean' }, wings: { type: 'boolean' }, saddle: { type: 'boolean' },
};

/** The model component of an archetype or entity: the content.models id it is drawn with (no model: generated art). */
export const MODEL_COMPONENT = { type: 'ref', to: 'model', effect: 'the content.models id this archetype is drawn with' };

/**
 * The card.data declaration of content.models for a card reading `fields` (names of MODEL_FIELDS, or 'clips' with
 * the states given).
 * @param {string[]} fields @param {{ states?: string[] }} [opts]
 */
export function modelsData(fields, { states } = {}) {
  /** @type {Record<string, unknown>} */
  const picked = {};
  for (const f of fields) {
    if (f === 'clips') { if (!states) throw new Error('modelsData: clips need the states'); picked.clips = rigClips(states); continue; }
    const spec = /** @type {Record<string, unknown>} */ (MODEL_FIELDS)[f];
    if (!spec) throw new Error(`modelsData: no model field '${f}'`);
    picked[f] = spec;
  }
  return { type: 'object', values: { type: 'object', open: true, fields: picked }, effect: 'model id -> spec (catalog §5.2)' };
}

/**
 * A rule example that is a self-contained document fragment (schema-sampler.js mergeFragment): no systems, a probe
 * player archetype, and the content sections given, over the host's spaces and graphics. For rules over sections no
 * form writes whole (content.models is an id-keyed map), so the example names exactly the entries that break the rule.
 * @param {Record<string, unknown>} content @param {Record<string, unknown>} [more] other top-level sections
 */
export const docExample = (content, more = {}) => ({ doc: { systems: [], player: { archetype: 'probe' }, content: { archetypes: [{ id: 'probe', name: 'Probe' }], ...content }, ...more } });

/** The fields of a content.items entry the UI cards read (ui-inventory.js, ui-icons.js, ui-hud.js). */
const ITEM_FIELDS = {
  kind: { type: 'string', effect: 'weapon, tool, armor, charm, potion, food, key, quest, material, block, ammo, currency...: sorts and picks the icon' },
  icon: { type: 'string', effect: 'an icon name (ui-icons.js)' },
  color: { type: 'string', effect: 'the icon color' },
  desc: { type: 'string', display: true, effect: 'the description a person reads' },
  rarity: { type: 'string', effect: 'common, uncommon, rare, epic or legendary: the slot frame color' },
  tags: { type: 'list', of: { type: 'string' } },
  block: { type: 'ref', to: 'block', effect: 'the content.blocks id it places' },
};
/** The card.data declaration of content.items for a card reading `fields` (names of ITEM_FIELDS). @param {string[]} fields */
export function itemsData(fields) {
  /** @type {Record<string, unknown>} */
  const picked = {};
  for (const f of fields) { const spec = /** @type {Record<string, unknown>} */ (ITEM_FIELDS)[f]; if (!spec) throw new Error(`itemsData: no item field '${f}'`); picked[f] = spec; }
  return { type: 'list', of: { type: 'object', open: true, fields: picked } };
}

/** The fields of a content.blocks entry the graphics cards read (material-palette.js, flat-tiles.js, render-tilemap.js). */
const BLOCK_FIELDS = {
  color: { type: 'string', effect: 'a #hex color (else one is derived from the id)' },
  tags: { type: 'list', of: { type: 'string' } },
  solid: { type: 'boolean' },
  transparent: { type: 'boolean' },
  light: { type: 'number', min: 0, effect: 'emitted light level (15 = full glow)' },
  tile: { type: 'string', effect: 'a graphics.tileset.pixel theme id or a tile pattern name' },
};
/** The card.data declaration of content.blocks for a card reading `fields` (names of BLOCK_FIELDS). @param {string[]} fields */
export function blocksData(fields) {
  /** @type {Record<string, unknown>} */
  const picked = {};
  for (const f of fields) { const spec = /** @type {Record<string, unknown>} */ (BLOCK_FIELDS)[f]; if (!spec) throw new Error(`blocksData: no block field '${f}'`); picked[f] = spec; }
  return { type: 'list', of: { type: 'object', open: true, fields: picked } };
}
