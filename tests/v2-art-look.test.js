import test from 'node:test';
import assert from 'node:assert/strict';
import { LOOK_PRESETS, LOOK_PRESET_NAMES, LOOK_SCHEMA, resolveLook, presetFor, paintOptions, lookPrimitives, hazeLayers, describeLook, svgColors, nearestIn } from '../v2/art/look.js';
import { paintGameArt } from '../v2/art/paint.js';
import { paintCharacter } from '../v2/art/characters.js';
import { DIRECTION_SCHEMA, fallbackDirection, normalizeDirection, mergeDirection } from '../v2/art/direction.js';
import { artQuality, outlineUnits } from '../v2/verify/art-quality.js';
import { createProceduralArt } from '../v2/planner/art-procedural.js';
import { artPrompts } from '../v2/planner/art.js';
import { quantizeToPalette } from '../v2/primitives/graphics/post.js';
import { pixelFrame, opaqueBox } from '../v2/primitives/graphics/flat-pixel.js';
import post from '../v2/primitives/graphics/post.js';
import spritePixel from '../v2/primitives/graphics/sprite-pixel.js';
import { checkFields } from '../v2/kernel/params.js';

const spec = { id: 'look-test', title: 'Look Test', entities: { ground: { solid: true }, hero: { tags: ['player'] }, ring: { tags: ['collectible'] }, bot: { tags: ['enemy'] }, spikes: { tags: ['hazard'] }, flag: { tags: ['goal'] } } };
const design = { title: 'Look Test', pitch: 'a hedgehog runs through hills', view: 'side', artStyle: 'bright cartoon', cast: { player: { name: 'Hog', glyph: '🦔' }, enemy: { name: 'Bot', glyph: '🤖' }, pickup: { name: 'Ring', glyph: '💍' }, hazard: { name: 'Spikes', glyph: '⚔️' }, goal: { name: 'Flag', glyph: '🚩' } } };
const withPreset = (preset, extra = {}) => normalizeDirection({ ...fallbackDirection(design), look: { preset, ...extra } });
const sane = svg => { assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/); assert.doesNotMatch(svg, /NaN|undefined|Infinity/); };

test('every preset renders headless and passes its own art checks', () => {
  assert.equal(LOOK_PRESET_NAMES.length, 10);
  for (const preset of LOOK_PRESET_NAMES) {
    const painted = paintGameArt(withPreset(preset), spec);
    for (const a of painted.assets) sane(a.svg);
    const q = artQuality(painted.assets, painted.look);
    assert.deepEqual(q.findings, [], `${preset}: ${q.findings.map(f => f.message).join('; ')}`);
    assert.ok(q.palette.used <= q.palette.declared, `${preset} palette ${q.palette.used}/${q.palette.declared}`);
    assert.ok(q.contrast.gap >= painted.look.separation.playerValueGap, `${preset} contrast`);
    assert.equal(q.outline.min, q.outline.max, `${preset} one outline width`);
    assert.equal(q.outline.max, painted.look.outline.width, `${preset} the declared outline width`);
    if (painted.look.pixel) assert.ok(q.pixelScale.spread <= 1.08, `${preset} one pixel scale`);
    else assert.equal(q.pixelScale, null);
    // Every asset paints only palette colors.
    const palette = new Set(painted.palette);
    for (const a of painted.assets) for (const c of svgColors(a.svg)) assert.ok(palette.has(c), `${preset} ${a.key} paints ${c} outside its palette`);
  }
});

test('a preset sets defaults; explicit fields override them and every value is clamped', () => {
  const comic = resolveLook({ preset: 'bold-comic' });
  assert.deepEqual(comic.outline, LOOK_PRESETS['bold-comic'].outline);
  const custom = resolveLook({ preset: 'bold-comic', outline: { width: 3 }, shading: { bands: 9, hueShift: -2, dither: 'swirl' }, pixel: { scale: 40 }, depth: { layers: 1, parallax: [0, 2] }, separation: { glow: 'everything' }, forbid: ['glow', 'nonsense'], palette: { colors: ['#112233', '#445566', 'red', '#778899', '#aabbcc', '#ddeeff'] } });
  assert.equal(custom.outline.width, 3);
  assert.equal(custom.outline.mode, 'black', 'the preset keeps fields not given');
  assert.deepEqual(custom.shading, { bands: 4, hueShift: 0, dither: 'none' });
  assert.deepEqual(custom.pixel, { scale: 8 });
  assert.equal(custom.depth.layers, 2);
  assert.deepEqual(custom.depth.parallax, [0, 1]);
  assert.equal(custom.separation.glow, 'none');
  assert.deepEqual(custom.forbid, ['glow']);
  assert.deepEqual(custom.palette.colors, ['#112233', '#445566', '#778899', '#aabbcc', '#ddeeff'], 'invalid colors dropped, 4..32 kept');
  assert.equal(custom.palette.size, 5);
  assert.equal(resolveLook({ preset: 'bold-comic', palette: { colors: ['#000000', '#ffffff'] } }).palette.colors, null, 'fewer than 4 colors derive a palette');
  assert.equal(resolveLook({ preset: '16-bit', pixel: false }).pixel, null);
  assert.equal(resolveLook({ preset: 'nope' }, { style: 'pixel' }).preset, '16-bit');
  assert.equal(resolveLook(null).preset, 'bold-comic');
  assert.ok(resolveLook({ preset: 'black-figure' }).palette.colors.every(c => c !== '#ffffff'), 'pure white is forbidden');
  for (const input of [...LOOK_PRESET_NAMES.map(preset => ({ preset })), { preset: '16-bit', pixel: false }, { preset: 'neon-vector', outline: { width: 3 }, forbid: ['translucency'] }]) {
    const once = resolveLook(input);
    assert.deepEqual(resolveLook(once), once, `resolving ${JSON.stringify(input)} again changes nothing`);
  }
});

test('an explicit override changes the painted art and the checks measure it', () => {
  const thick = paintGameArt(withPreset('bold-comic', { outline: { mode: 'black', width: 3 } }), spec);
  const q = artQuality(thick.assets, thick.look);
  assert.deepEqual(q.findings, []);
  assert.equal(q.outline.max, 3);
  const coarse = paintGameArt(withPreset('16-bit', { pixel: { scale: 4 } }), spec);
  const qc = artQuality(coarse.assets, coarse.look);
  assert.equal(qc.pixelScale.declared, 8);
  assert.ok(Object.values(qc.pixelScale.values).every(v => Math.abs(v - 8) < 0.6), JSON.stringify(qc.pixelScale.values));
});

test('the checks report broken art as info findings', () => {
  const painted = paintGameArt(withPreset('16-bit'), spec);
  const look = painted.look;
  // An unquantized sprite at another density and outline width, and a player painted as the background itself.
  const odd = paintCharacter(fallbackDirection(design).player, 'idle', { ...paintOptions(look, 'character'), size: 90, ink: { mode: 'dark-hue', width: 6 } });
  const bg = painted.assets.find(a => a.cls === 'background');
  const broken = painted.assets.map(a => (a.key === 'frame-bot-idle' ? { ...a, svg: odd } : a.key === 'frame-hero-idle' ? { ...a, svg: bg.svg } : a));
  const q = artQuality(broken, look);
  const codes = new Set(q.findings.map(f => f.code));
  for (const code of ['art_palette_over', 'art_pixel_scale_mixed', 'art_outline_mixed', 'art_contrast_low']) assert.ok(codes.has(code), `${code} in ${[...codes]}`);
  assert.ok(q.findings.every(f => f.severity === 'info'));
  assert.equal(artQuality(painted.assets, null).unmeasured.all, 'the art direction declares no look');
});

test('a direction without a look paints exactly as before', () => {
  const dir = fallbackDirection({ ...design, artStyle: 'crisp 16-bit pixel art' });
  const { look, ...legacy } = dir;
  const painted = paintGameArt(legacy, spec);
  assert.equal(painted.look, null);
  assert.equal(painted.assets.find(a => a.key === 'frame-hero-idle').svg, paintCharacter(legacy.player, 'idle', { pixel: true }));
});

test('the realized palette is stored and locks later paints', async () => {
  const saved = [];
  const ctx = { store: { saveAsset: async (id, name) => { saved.push(name); return `/api/v2/games/${id}/assets/${name}`; } } };
  const first = createProceduralArt({ client: null });
  const directed = await first.direct({ design: { ...design, artStyle: 'neon synthwave' } });
  assert.equal(directed.direction.look.preset, 'neon-vector');
  const v1 = await first.paint({ job: { gameId: 'g' }, ctx, spec, directed });
  assert.deepEqual(v1.quality.findings, []);
  assert.equal(v1.report.look.preset, 'neon-vector');
  const derived = await first.paint({ job: { gameId: 'g' }, ctx, spec, directed: await first.direct({ design }) });
  const stored = derived.art.direction.look.palette.colors;
  assert.ok(Array.isArray(stored) && stored.length >= 4 && stored.length <= derived.art.direction.look.palette.size);
  const again = paintGameArt(derived.art.direction, spec), before = paintGameArt((await first.direct({ design })).direction, spec);
  assert.deepEqual(again.assets.map(a => a.svg), before.assets.map(a => a.svg), 'painting with the stored palette gives the same files');
  // A style revision replaces the look; other revisions keep it.
  const merged = mergeDirection(derived.art.direction, { ...normalizeDirection({ look: { preset: 'rubber-hose' } }), changed: ['player'] });
  assert.deepEqual(merged.direction.look, derived.art.direction.look);
  assert.equal(mergeDirection(derived.art.direction, { look: { preset: 'rubber-hose' }, changed: ['style'] }).direction.look.preset, 'rubber-hose');
});

test('the art direction picks a preset from the idea and theme', () => {
  assert.equal(presetFor('crisp 16-bit pixel art'), '16-bit');
  assert.equal(presetFor('an NES-style 8-bit platformer'), '8-bit');
  assert.equal(presetFor('Game Boy style dungeon'), 'monochrome-pixel');
  assert.equal(presetFor('a hero of Greek myth'), 'black-figure');
  assert.equal(presetFor('1930s rubber hose cartoon'), 'rubber-hose');
  assert.equal(presetFor('a misty, eerie forest'), 'layered-silhouette');
  assert.equal(presetFor('a calm abstract puzzle'), 'minimal-geometric');
  assert.equal(presetFor('a cyber racer'), 'neon-vector');
  assert.equal(presetFor('plain words'), null);
  assert.equal(fallbackDirection({ ...design, pitch: 'Perseus fights monsters of Greek myth' }).look.preset, 'black-figure');
  const pixel = fallbackDirection({ ...design, artStyle: 'crisp 16-bit pixel art' });
  assert.equal(pixel.look.preset, '16-bit');
  assert.equal(pixel.style, 'pixel');
  assert.equal(normalizeDirection({ style: 'vector', look: { preset: '8-bit' } }).style, 'pixel', 'a named preset decides pixel or vector');
});

test('the direction schema is strict: every object closes and requires all its keys', () => {
  const walk = (s, path) => {
    if (!s || typeof s !== 'object') return;
    if (s.type === 'object') {
      assert.equal(s.additionalProperties, false, path);
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort(), path);
      for (const [k, v] of Object.entries(s.properties)) walk(v, `${path}.${k}`);
    }
    if (s.items) walk(s.items, `${path}[]`);
    for (const alt of s.anyOf || []) walk(alt, path);
  };
  walk(DIRECTION_SCHEMA, 'direction');
  assert.equal(DIRECTION_SCHEMA.properties.look, LOOK_SCHEMA);
  assert.deepEqual(LOOK_SCHEMA.properties.preset.enum, LOOK_PRESET_NAMES);
});

test('image prompts spell out a declared look', () => {
  const look = resolveLook({ preset: 'monochrome-pixel' });
  const text = describeLook(look);
  assert.match(text, /4-color palette \(#0f380f/);
  assert.match(text, /16 pixels per tile/);
  const prompts = artPrompts({ ...design, look: { preset: 'monochrome-pixel' } }, spec);
  assert.ok(Object.values(prompts).every(p => p.prompt.includes('Art rules:')));
  assert.ok(Object.values(artPrompts(design, spec)).every(p => !p.prompt.includes('Art rules:')), 'no look, no rules');
});

test('runtime primitives take the look: locked palette, dithering, outline width, bands, haze', () => {
  const look = resolveLook({ preset: 'monochrome-pixel' });
  const cfg = lookPrimitives(look);
  assert.deepEqual(cfg['graphics.post'].palette, look.palette.colors);
  assert.equal(cfg['graphics.post'].dither, 'bayer4');
  // The look's params pass the cards' declared params (colors are a hex pattern on the card, no longer a validate rule).
  const paramErrors = (p, w) => { const errors = []; checkFields(p.card.params, w, '', errors, null); return errors; };
  assert.deepEqual(paramErrors(post, cfg['graphics.post']), []);
  assert.deepEqual(paramErrors(spritePixel, cfg['graphics.sprite.pixel']), []);
  assert.deepEqual(spritePixel.validate({ ...cfg['graphics.sprite.pixel'] }, { content: {} }), []);
  assert.equal(paramErrors(post, { palette: ['red'] })[0].code, 'param_pattern');
  // Palette quantization: only palette colors come out; a mid gray dithers between two shades.
  const w = 8, h = 8, data = new Uint8ClampedArray(w * h * 4).fill(128);
  quantizeToPalette(data, w, h, look.palette.colors, 'bayer4');
  const out = new Set(); for (let i = 0; i < data.length; i += 4) out.add(`#${[data[i], data[i + 1], data[i + 2]].map(v => v.toString(16).padStart(2, '0')).join('')}`);
  assert.ok([...out].every(c => look.palette.colors.includes(c)), [...out].join());
  assert.ok(out.size >= 2, 'dithered');
  const flat = new Uint8ClampedArray(w * h * 4).fill(128); quantizeToPalette(flat, w, h, look.palette.colors, 'none');
  assert.equal(new Set(Array.from({ length: w * h }, (_, i) => flat[i * 4])).size, 1, 'no dither, one color');
  // Pixel sprites: wider outlines, flat bands and palette snapping.
  const sprite = { size: [8, 10], palette: { a: '#d04030' }, parts: [{ rect: [2, 0, 4, 8], c: 'a', name: 'body' }] };
  const one = opaqueBox(pixelFrame(sprite, 'idle', 0)), two = opaqueBox(pixelFrame(sprite, 'idle', 0, { outlineWidth: 2 }));
  assert.equal(two[2] - two[0], one[2] - one[0] + 2);
  const flatFrame = pixelFrame(sprite, 'idle', 0, { bands: 1, outline: '' });
  const tones = new Set(); for (let i = 0; i < flatFrame.data.length; i += 4) if (flatFrame.data[i + 3]) tones.add(flatFrame.data[i]);
  assert.equal(tones.size, 1);
  const snapped = pixelFrame(sprite, 'idle', 0, { palette: look.palette.colors });
  const near = nearestIn(look.palette.colors);
  for (let i = 0; i < snapped.data.length; i += 4) if (snapped.data[i + 3]) { const c = `#${[0, 1, 2].map(k => snapped.data[i + k].toString(16).padStart(2, '0')).join('')}`; assert.equal(near(c), c); }
  // Parallax layers take the look's scroll factors and haze toward the haze color.
  const layers = hazeLayers([{ pattern: 'mountains', color: '#204060' }, { pattern: 'hills', color: '#306030' }, { pattern: 'forest', color: '#103010' }], look, '#9bbc0f');
  assert.deepEqual(layers.map(l => l.depth), [look.depth.parallax[0], look.depth.parallax[1], look.depth.parallax[2]]);
  assert.equal(layers[0].fogColor, '#9bbc0f');
  assert.equal(layers[2].fogColor, undefined);
});

test('outline measurement reads filled, stroked shapes only', () => {
  assert.equal(outlineUnits('<svg viewBox="0 0 10 10"><path d="M0 0L1 1" fill="#ff0000" stroke="#000000" stroke-width="2"/><path d="M0 0L1 1" fill="#ff0000" stroke="#000000" stroke-width="2"/><path d="M0 0" fill="none" stroke="#000000" stroke-width="9"/></svg>'), 2);
  assert.equal(outlineUnits('<svg viewBox="0 0 10 10"><rect width="1" height="1" fill="#ff0000"/></svg>'), null);
});
