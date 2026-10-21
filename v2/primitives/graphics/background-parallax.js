// graphics.background.parallax — layered 2D backdrops per zone. Each layer is a
// seeded pattern (painted scenery with live ambient features, mountains, hills,
// forest, city, clouds, stars, caves, rafters, hanging lanterns, roots, spores,
// arches, caustics, pipes, sparks, organ pipes, thorns, columns, shelves, void,
// ruins, waves, dunes, bubbles, grid, gradients) scrolling at its depth, with
// drift, fog and crossfades as the player moves between zones.
import { hubOf, bindAny, ORDER } from './flat-stage.js';
import { PATTERNS, normalizeLayers, drawBackdrop } from './flat-backdrop.js';
import { THEMES } from '../../art/scenery.js';
import { FEATURES, DEPTHS } from '../../art/features.js';
import { color } from './model-lib.js';

export default {
  id: 'graphics.background.parallax',
  card: {
    intent: 'Layered parallax backdrops per zone: painted scenery with live ambient features or seeded patterns (mountains, forest, city, stars, caves, rafters, lanterns, roots, spores, arches, caustics, pipes, sparks, columns, shelves, void...) scrolling by depth with drift, fog and zone crossfades.',
    views: ['side', 'td'],
    params: {
      layers: { type: 'list', default: [{ pattern: 'scenery', depth: 0.08, color: '#000000' }, { pattern: 'hills', depth: 0.3, color: '#3a6a4a' }], of: { type: 'object', fields: {
        zone: { type: 'ref', to: 'zone', effect: 'shown only while the player is in this zone (crossfades)' },
        depth: { type: 'number', default: 0.4, min: 0, max: 1, effect: '0 = infinitely far (static), 1 = moves with the world' },
        pattern: { type: 'string', default: 'hills', options: PATTERNS },
        color: color({ default: '#2a2838', effect: 'silhouette (or sky) color' }),
        drift: { type: 'number', default: 0, min: -2, max: 2, effect: 'constant scroll, for clouds and currents' },
        fogColor: color({ effect: 'haze toward the bottom of this layer' }),
        theme: { type: 'string', options: THEMES, effect: "scenery: the painted theme (default from the game's text)" },
        features: { type: 'list', of: { type: 'object', fields: { kind: { type: 'string', options: FEATURES, required: true }, density: { type: 'number', default: 0.5, min: 0, max: 1 }, depth: { type: 'string', options: DEPTHS, default: 'mid' } } }, effect: 'scenery: composed static and live features (forest, street with traffic, rain...)' },
      } }, effect: 'back-to-front layers' },
      base: color({ effect: 'color behind all layers (unset: from the farthest layer)' }),
    },
  },
  install(rt, config, instance) {
    if (rt.headless || !rt.view) return;
    const H = hubOf(rt), space = bindAny(rt, instance);
    (H.cfg.backgrounds ??= new Set()).add(space);
    const layers = normalizeLayers(config.layers);
    H.layer(ORDER.background, F => drawBackdrop(F, layers, { base: config.base || null }), { space, name: 'background.parallax' });
  },
};
