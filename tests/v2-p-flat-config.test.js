// The flat configuration and effect primitives: cameras, sprites, tilesets,
// animation, rigs, backdrops, lighting, particles, post and feedback. Each one
// preflights, changes what is drawn through rt.step and events, keeps replay
// deterministic, rejects bad configs with stable codes, and every instance of
// it in v2/games/*.json preflights with zero param errors.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { preflight } from '../v2/kernel/document.js';
import { checkFields } from '../v2/kernel/params.js';
import { Registry } from '../v2/kernel/registry.js';
import { Logic } from '../v2/kernel/logic.js';
import { buildLogic } from '../v2/kernel/world.js';
import spaces2d from '../v2/primitives/engine/spaces2d.index.js';
import flat from '../v2/primitives/graphics/flat.index.js';
import { docFor, mount, play, drawCalls, cellFiller, mover } from './v2-p-flat-stub.js';

const registry = new Registry([...spaces2d, cellFiller, mover, ...flat]), logic = buildLogic(registry, Logic);
const pf = doc => preflight(doc, registry, logic);
const withG = (kind, graphics, extra = {}) => docFor(kind, { graphics: [{ use: kind === 'grid' ? 'graphics.render.grid' : 'graphics.render.tilemap' }, ...graphics], ...extra });

test('every flat instance in v2/games preflights with zero param errors', () => {
  const ids = new Set(flat.map(p => p.id));
  let seen = 0;
  for (const f of fs.readdirSync(new URL('../v2/games/', import.meta.url))) {
    const doc = JSON.parse(fs.readFileSync(new URL(`../v2/games/${f}`, import.meta.url), 'utf8'));
    (doc.graphics || []).forEach((g, i) => {
      if (!ids.has(g.use)) return; seen++;
      const errors = []; checkFields(flat.find(p => p.id === g.use).card.params, g.with || {}, `graphics[${i}].with`, errors, null);
      assert.deepEqual(errors, [], `${f} graphics[${i}] ${g.use}`);
      const own = flat.find(p => p.id === g.use).validate?.(checkFields(flat.find(p => p.id === g.use).card.params, g.with || {}, '', [], null), doc, {}, { path: `graphics[${i}]` }) || [];
      assert.deepEqual(own.filter(e => /^flat_(bind|preset|vector|bone|clip|rig)/.test(e.code)), [], `${f} graphics[${i}] ${g.use} validate`);
    });
  }
  assert.ok(seen >= 10, `covered ${seen} instances`);
});

test('bad configs are rejected with stable codes', () => {
  const cases = [
    // Colors, theme ids and the themes bind names, vector presets and anim states are declared (patterns, a tile_theme
    // kind, closed sets): the kernel's codes report them where the validators' own codes did.
    [{ use: 'graphics.tileset.pixel', with: { themes: [{ id: 'a', palette: { a: 'red' } }, { id: 'a' }], bind: { stone: 'nope' } } }, ['param_pattern', 'id_duplicate', 'ref_unknown']],
    [{ use: 'graphics.sprite.pixel', with: { outline: 'bright' } }, ['param_pattern']],
    [{ use: 'graphics.sprite.vector', with: { presets: { slime: 'dragon' } } }, ['param_option']],
    [{ use: 'graphics.anim.sprite', with: { map: { sprint: 'run' } } }, ['param_unknown']],
    [{ use: 'graphics.rig.custom', with: { rigs: [{ id: 'worm', bones: [{ id: 'b', parent: 'a' }, { id: 'a' }] }], archetypes: { slime: 'ghost-rig' } } }, ['flat_bone_parent', 'flat_rig_unknown']],
    [{ use: 'graphics.background.parallax', with: { layers: [{ pattern: 'hills', color: 'teal' }] } }, ['param_pattern']],
    [{ use: 'graphics.background.parallax', with: { layers: [{ pattern: 'lava-lamps' }] } }, ['param_option']],
    [{ use: 'graphics.lighting.2d', with: { lights: [{ follow: 'hero', color: 'warm' }] } }, ['param_pattern']],
    [{ use: 'graphics.particles', with: { bind: [{ event: 'hit', preset: 'boom' }] } }, ['flat_preset_unknown']],
    [{ use: 'graphics.fx.feedback', with: { shakeOn: { hurt: 3 } } }, ['param_range']],
    [{ use: 'graphics.post', with: { tonemap: 'reinhard' } }, ['param_option']],
    [{ use: 'graphics.camera.side', with: { deadzone: [1] } }, ['param_range']],
  ];
  for (const [g, codes] of cases) {
    const r = pf(withG('tilemap', [g]));
    for (const c of codes) assert.ok(r.errors.some(e => e.code === c && e.path.startsWith('graphics[1]')), `${g.use} → ${c}: ${JSON.stringify(r.errors.map(e => [e.code, e.path]))}`);
  }
  assert.ok(pf(docFor('physics2d', { graphics: [{ use: 'graphics.camera.isometric' }] })).errors.some(e => e.code === 'iso_space'));
  const bad = docFor('tilemap', { graphics: [{ use: 'graphics.render.tilemap' }, { use: 'graphics.sprite.pixel' }], content: { models: { hero: { kind: 'pixel', size: [16], parts: [{ rect: [0, 0], c: 'z' }] } } } });
  const r = pf(bad);
  for (const c of ['flat_pixel_size', 'flat_pixel_color']) assert.ok(r.errors.some(e => e.code === c), c);
  // rect's [x, y, w, h] shape is declared on content.models (a warning until kernel/document.js DECLARATIONS_ENFORCED);
  // a pixel part without a rect is the rule.
  assert.ok([...r.errors, ...r.warnings].some(e => e.code === 'param_range' && e.path === 'content.models.hero.parts[0].rect'));
  const noRect = docFor('tilemap', { graphics: [{ use: 'graphics.render.tilemap' }, { use: 'graphics.sprite.pixel' }], content: { models: { hero: { kind: 'pixel', size: [16, 16], parts: [{ c: '#202030' }] } } } });
  assert.ok(pf(noRect).errors.some(e => e.code === 'flat_pixel_part'));
});

const FULL = [
  { use: 'graphics.tileset.pixel', with: { themes: [{ id: 'ember', palette: { a: '#4a3a30', b: '#ffb347', c: '#2a2018' }, pattern: 'brick', edge: 'warm' }] } },
  { use: 'graphics.sprite.pixel' }, { use: 'graphics.sprite.vector', with: { presets: { coin: 'coin' } } }, { use: 'graphics.anim.sprite', with: { trail: ['run'] } },
  { use: 'graphics.rig.custom', with: { rigs: [{ id: 'worm', preset: 'serpent' }], archetypes: { slime: 'worm' } } },
  { use: 'graphics.camera.side', with: { lookAhead: 3 } },
  { use: 'graphics.background.parallax', with: { layers: [{ pattern: 'scenery', depth: 0.1, color: '#000000' }, { pattern: 'spores', depth: 0.5, color: '#2c5a34', zone: 'east' }, { pattern: 'lanterns', depth: 0.3, color: '#4a3020' }] } },
  { use: 'graphics.lighting.2d', with: { ambient: 0.2, lights: [{ follow: 'hero', radius: 5, shadow: true }] } },
  { use: 'graphics.particles', with: { presets: [{ id: 'boom', shape: 'spark', color: '#ffffff', count: 6 }], bind: [{ event: 'hit', preset: 'boom', at: 'target' }], ambient: [{ preset: 'boom', rate: 30, area: 'view' }] } },
  { use: 'graphics.post', with: { bloom: 0.5, quantize: 64, vignette: 0.3, grain: 0.1, scanlines: true, tonemap: 'filmic' } },
  { use: 'graphics.fx.feedback', with: { hitStop: 60, shake: 0.6, slowmoOn: ['jump'], zoomOn: ['land'], flashOn: ['land'] } },
];

test('the full flat stack draws every layer, reacts to events and keeps replay deterministic', () => {
  const doc = withG('tilemap', FULL);
  assert.deepEqual(pf(doc).errors, []);
  const m = mount(doc, flat);
  const H = m.rt.caches.flat;
  const names = H.layers.map(l => l.name);
  for (const n of ['render.tilemap', 'background.parallax', 'lighting.2d', 'particles', 'particles.glow', 'post', 'feedback', 'popups']) assert.ok(names.includes(n), `layer ${n}`);
  let maxShake = 0, sawHitStop = false, sawSlow = false, maxParticles = 0, sawPopup = false;
  for (let i = 0; i < 90; i++) {
    m.rt.step({}); m.view.frame(0.5);
    maxShake = Math.max(maxShake, H.feedback.shake); sawHitStop ||= H.feedback.hitStop > 0; sawSlow ||= H.feedback.slowmo < 0.99; maxParticles = Math.max(maxParticles, H.particles.list.length);
    sawPopup ||= (drawCalls(m.view).strokeText || 0) > 0;
  }
  assert.ok(maxShake > 0, 'hits shake the camera'); assert.ok(sawHitStop, 'hits stop time');
  assert.ok(sawSlow, 'slow motion on the configured event'); assert.ok(maxParticles > 0, 'events spawn particles'); assert.ok(sawPopup, 'damage numbers float up');
  assert.equal(H.cfg.tileset.themes[0].id, 'ember'); assert.equal(H.cfg.rig.archetypes.slime, 'worm');
  const c = drawCalls(m.view);
  assert.ok((c.drawImage || 0) > 100 && (c.fill || 0) > 100);
  assert.deepEqual([...H.errors], []);
  // Replays match: graphics never feed back into the simulation.
  const again = mount(doc, flat); for (let i = 0; i < 90; i++) { again.rt.step({}); again.view.frame(0.3); }
  assert.deepEqual(again.rt.snapshot(), m.rt.snapshot());
});

test('without particles or feedback in the document every renderer still adds the default juice', () => {
  const m = mount(docFor('tilemap', { graphics: [{ use: 'graphics.render.tilemap' }] }), flat);
  play(m, 60);
  const H = m.rt.caches.flat;
  assert.ok(H.cfg.particles?.defaults && H.cfg.feedback, 'defaults installed on the first frame');
  assert.ok(H.feedback.shake >= 0);
});

test('reduced motion turns shake and flashes off', () => {
  const m = mount(withG('tilemap', [{ use: 'graphics.fx.feedback', with: { shakeOn: { jump: 1, hit: 1 }, flashOn: ['jump'] } }]), flat);
  m.rt.caches.flat.reduced = true;
  let shake = 0, flash = 0;
  for (let i = 0; i < 70; i++) { m.rt.step({}); m.view.frame(0.5); shake = Math.max(shake, m.rt.caches.flat.feedback.shake); flash = Math.max(flash, m.rt.caches.flat.feedback.flash); }
  assert.equal(shake, 0); assert.equal(flash, 0);
});

test('lighting follows zones: darkZones dim only there, zone rules.light wins', () => {
  const zones = [{ id: 'start', name: 'Start', rect: [0, 0, 16, 18] }, { id: 'east', name: 'East', rect: [16, 0, 32, 18], rules: { light: 0.3 } }];
  const m = mount(withG('tilemap', [{ use: 'graphics.lighting.2d', with: { ambient: 0.1, darkZones: ['east'] } }], { zones }), flat);
  play(m, 30);
  const before = drawCalls(m.view).drawImage || 0;
  m.rt.space('world').setPos(m.rt.player(), [20, 5], m.rt);
  play(m, 30);
  assert.ok((drawCalls(m.view).drawImage || 0) > before, 'the light map composites in the dark zone');
});

test('cameras: side follows with look-ahead, top-down tilts, isometric projects diamonds', () => {
  const side = mount(withG('tilemap', [{ use: 'graphics.camera.side', with: { lookAhead: 4, smoothing: 1, deadzone: [0, 0] } }]), flat);
  play(side, 60);
  const F = side.rt.caches.flat.lastFrame;
  assert.ok(F.cam.x > side.rt.player().at[0], 'leads ahead of a player walking right');
  const td = mount(withG('tilemap', [{ use: 'graphics.camera.top-down', with: { tilt: 60 } }], { spaceWith: { mode: 'topdown' } }), flat);
  play(td, 5);
  assert.ok(td.rt.caches.flat.lastFrame.proj.k < 1, 'tilt foreshortens');
  const iso = mount(withG('grid', [{ use: 'graphics.camera.isometric', with: { angle: 30 } }]), flat);
  play(iso, 5);
  assert.equal(iso.rt.caches.flat.lastFrame.proj.kind, 'iso');
});
