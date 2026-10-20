import test from 'node:test';
import assert from 'node:assert/strict';
import { paintCharacter, POSE_NAMES, BODIES, PARTS } from '../v2/art/characters.js';
import { paintProp, PROPS } from '../v2/art/props.js';
import { paintTileset, MATERIALS, SURFACES, PLATFORMS } from '../v2/art/tiles.js';
import { paintScenery, THEMES, TIMES } from '../v2/art/scenery.js';
import { paintGameArt } from '../v2/art/paint.js';
import { fallbackDirection, mergeDirection, normalizeDirection, forcedTargets } from '../v2/art/direction.js';
import { createProceduralArt } from '../v2/planner/art-procedural.js';

const sane = svg => { assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/); assert.doesNotMatch(svg, /NaN|undefined|Infinity/); };
const spec = { id: 'art-test', title: 'Art Test', entities: { ground: { solid: true }, platform: { solid: true }, hero: { tags: ['player'] }, ring: { tags: ['collectible'] }, bot: { tags: ['enemy'] }, spikes: { tags: ['hazard'] }, flag: { tags: ['goal'] } } };
const design = { title: 'Art Test', pitch: 'a test', view: 'side', artStyle: 'crisp 16-bit pixel art', cast: { player: { name: 'Hog', glyph: '🦔' }, enemy: { name: 'Bot', glyph: '🤖' }, pickup: { name: 'Ring', glyph: '💍' }, hazard: { name: 'Spikes', glyph: '⚔️' }, goal: { name: 'Flag', glyph: '🚩' } } };

test('every body plan, part and pose paints a well-formed SVG', () => {
  for (const body of BODIES) for (const pose of POSE_NAMES) sane(paintCharacter({ body }, pose));
  for (const [part, options] of Object.entries(PARTS)) for (const value of options) for (const body of ['biped', 'quadruped']) sane(paintCharacter({ body, [part]: value }, 'runA', { pixel: true }));
  for (const role of Object.keys(PROPS)) for (const kind of PROPS[role]) sane(paintProp(kind));
  for (const material of MATERIALS) for (const surface of SURFACES) sane(paintTileset({ material, surface, platform: PLATFORMS[0] }).svg);
  for (const theme of THEMES) for (const time of TIMES) sane(paintScenery({ theme, time }));
});

test('pixel style paints at a small natural size with crisp edges', () => {
  assert.match(paintCharacter({}, 'idle', { pixel: true }), /width="64" height="64"[^>]*shape-rendering="crispEdges"/);
  assert.match(paintCharacter({}, 'idle'), /width="256"/);
});

test('tileset padding is excluded from the sampled cell', () => {
  const { layout, svg } = paintTileset({});
  assert.ok(layout.inset > 0 && layout.inset < 0.1);
  assert.deepEqual(Object.keys(layout.cells).sort(), ['groundFill', 'groundTop', 'platform', 'wall']);
  assert.match(svg, /clip-path/);
});

test('game art is deterministic and maps every cast entity', () => {
  const dir = fallbackDirection(design);
  const a = paintGameArt(dir, spec), b = paintGameArt(dir, spec);
  assert.deepEqual(a.assets.map(x => x.svg), b.assets.map(x => x.svg));
  const art = a.assemble(k => `/${k}`);
  assert.equal(art.procedural, true);
  assert.deepEqual(Object.keys(art.frames).sort(), ['bot', 'hero']);
  for (const kind of ['hero', 'ring', 'bot', 'spikes', 'flag']) assert.ok(art.sprites[kind], kind);
  assert.match(art.style, /pixel/);
  assert.equal(dir.player.top, 'quills', 'the hedgehog glyph gives a hedgehog');
});

test('a revision replaces only the targets it names', () => {
  const prev = fallbackDirection(design);
  const revised = { ...normalizeDirection({}), changed: ['tiles'], tiles: { material: 'wood', surface: 'none', platform: 'wood' } };
  const { direction, changed } = mergeDirection(prev, revised);
  assert.deepEqual(changed, ['tiles']);
  assert.equal(direction.tiles.platform, 'wood');
  for (const t of ['player', 'enemy', 'scenery', 'pickup', 'hazard', 'goal', 'style']) assert.deepEqual(direction[t], prev[t], t);
  assert.deepEqual(forcedTargets(design, { ...design, cast: { ...design.cast, enemy: { name: 'Walrus', glyph: '🦭' } } }), ['enemy']);
});

test('locked assets keep their exact URLs; only changed targets get new files', async () => {
  const saved = [];
  const ctx = { store: { saveAsset: async (id, name) => { saved.push(name); return `/api/v2/games/${id}/assets/${name}`; } } };
  const job = { gameId: 'art-test' };
  const reply = text => ({ complete: async () => ({ text: JSON.stringify(text), ms: 1, model: 'fake' }) });
  const first = createProceduralArt({ client: null });
  const directed = await first.direct({ design });
  const v1 = await first.paint({ job, ctx, spec, directed });
  const previous = { doc: { ...spec, art: v1.art }, report: { design }, provenance: {} };
  // A non-visual change: the model names no targets, nothing is repainted.
  const tweak = createProceduralArt({ client: reply({ ...v1.art.direction, changed: [] }) });
  saved.length = 0;
  const v2 = await tweak.paint({ job, ctx, spec, previous, directed: await tweak.direct({ design, previous, change: 'make it faster' }) });
  assert.equal(saved.length, 0);
  assert.deepEqual(v2.art.frames, v1.art.frames);
  assert.equal(v2.art.tileset.url, v1.art.tileset.url);
  // A platform change: only the tileset is repainted.
  const wood = createProceduralArt({ client: reply({ ...v1.art.direction, tiles: { ...v1.art.direction.tiles, platform: 'wood' }, changed: ['tiles'] }) });
  saved.length = 0;
  const v3 = await wood.paint({ job, ctx, spec, previous, directed: await wood.direct({ design, previous, change: 'wooden platforms' }) });
  assert.deepEqual(saved.map(n => n.split('-')[0]), ['tileset']);
  assert.notEqual(v3.art.tileset.url, v1.art.tileset.url);
  assert.deepEqual(v3.art.frames, v1.art.frames);
  assert.equal(v3.art.background, v1.art.background);
});
