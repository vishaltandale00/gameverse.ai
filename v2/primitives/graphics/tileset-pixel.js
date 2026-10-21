// graphics.tileset.pixel — generated tile art and autotiling for cell renderers.
// Themes are a pattern (rock, brick, moss, wood, ice, metal, crystal, soil,
// ash...) in a three-color palette with an edge style; blocks bind to themes
// by content.blocks[].tile (a theme id or a pattern), by `bind`, or take the
// theme of the room/zone they sit in. blob47 (47 variants, corner-aware) or
// wang16 (edges only) choose each tile's lit lips, caps, undersides, rounded or
// chamfered corners and outline.
import { hubOf } from './flat-stage.js';
import { PATTERNS, EDGES } from './flat-tiles.js';
import { color as hex, blocksData, docExample } from './model-lib.js';

const color = hex();
export default {
  id: 'graphics.tileset.pixel',
  card: {
    intent: 'Generated pixel tile art with blob47 or wang16 autotiling: named themes (pattern + palette + edge style) bound to blocks, rooms or zones, with lit top lips, grass/moss/snow caps, icicles, shaded undersides and soft overhang shadows.',
    views: ['side', 'td', 'board'],
    params: {
      tileSize: { type: 'integer', default: 16, min: 4, max: 64, unit: 'px', effect: 'art pixels per tile (sprites share this density)' },
      themes: { type: 'list', default: [], of: { type: 'object', fields: { id: { type: 'string', required: true }, palette: { type: 'object', fields: { a: { ...color, effect: 'base color' }, b: { ...color, effect: 'highlight / accent (lips, moss, glints)' }, c: { ...color, effect: 'dark (seams, outline)' } } }, pattern: { type: 'string', default: 'rock', options: PATTERNS }, edge: { type: 'string', default: 'soft', options: EDGES } } }, effect: 'named tile looks' },
      autotile: { type: 'string', default: 'blob47', options: ['blob47', 'wang16', 'none'], effect: 'how tiles adapt to their neighbours' },
      bind: { type: 'object', default: {}, values: { type: 'ref', to: 'tile_theme' }, effect: 'block id → theme id (overrides content.blocks[].tile)' },
      zoneThemes: { type: 'object', default: {}, values: { type: 'ref', to: 'tile_theme' }, effect: 'zone id → theme id for blocks without their own theme' },
      edge: { type: 'string', default: 'soft', options: EDGES, effect: 'edge style for blocks with no theme' },
      decor: { type: 'boolean', default: true, effect: 'grass tufts, hanging moss and icicles on exposed edges' },
      occlusion: { type: 'number', default: 1, min: 0, max: 2, effect: 'multiplier for overhang and wall shadows' },
    },
    reads: ['content.blocks'],
    data: { 'content.blocks': blocksData(['color', 'tags', 'tile']) },
    defines: [{ kind: 'tile_theme', in: 'themes' }],
    rules: {
      flat_bind_block: { fields: ['bind'], message: 'each bind key is a content.blocks id',
        example: docExample({ blocks: [{ id: 'stone', name: 'Stone' }] }, { graphics: [{ use: 'graphics.tileset.pixel', with: { themes: [{ id: 'moss' }], bind: { no_such_block: 'moss' } } }] }) },
    },
  },
  validate(config, doc) {
    // Theme ids (tile_theme: unique slugs), their colors and the themes bind/zoneThemes name are declared; that a bind
    // key names a block is this rule.
    const blocks = new Set((doc.content?.blocks || []).map(b => b?.id));
    return Object.keys(config.bind || {}).filter(b => blocks.size && !blocks.has(b)).map(b => ({ code: 'flat_bind_block', path: `bind.${b}`, message: `unknown block '${b}'` }));
  },
  install(rt, config) {
    if (rt.headless || !rt.view) return;
    const H = hubOf(rt);
    H.cfg.tileset = config;
    H.terrain = null;
  },
};
